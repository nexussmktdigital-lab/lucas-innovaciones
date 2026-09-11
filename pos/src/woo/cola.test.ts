import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  cashSessions,
  exchangeRates,
  monetaryAccounts,
  products,
  sales,
  syncConflicts,
  syncQueue,
  users,
} from '@/db/schema';
import { confirmarVenta } from '@/ventas/confirmar';
import { ClienteWoo } from './cliente';
import { drenarCola, esperaTrasIntento, pendientesDeSincronizar } from './cola';

let db: TestDb;
let usuarioId: string;
let cajaId: string;
let sesionId: string;
let vidrioId: string;

/** WooCommerce simulado con un stock por producto que se puede inspeccionar. */
function wooSimulado(stockInicial: Record<number, number>, fallar = false) {
  const stock = { ...stockInicial };
  const escrituras: { wooId: number; stock: number }[] = [];

  const fetchImpl = (async (entrada: string | URL, init?: RequestInit) => {
    if (fallar) return new Response('boom', { status: 503 });

    const url = new URL(String(entrada));
    const wooId = Number(url.pathname.split('/').pop());

    if (init?.method === 'PUT') {
      const cuerpo = JSON.parse(String(init.body)) as { stock_quantity: number };
      stock[wooId] = cuerpo.stock_quantity;
      escrituras.push({ wooId, stock: cuerpo.stock_quantity });
    }

    return new Response(JSON.stringify({ id: wooId, stock_quantity: stock[wooId] ?? 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const cliente = new ClienteWoo({
    url: 'https://ejemplo.test/staging',
    consumerKey: 'ck',
    consumerSecret: 'cs',
    fetchImpl,
    reintentos: 1,
    timeoutMs: 1000,
  });

  return { cliente, stock, escrituras };
}

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const [u] = await db.insert(users).values({ nombre: 'Vendedor', rol: 'seller' }).returning();
  usuarioId = u!.id;

  const [c] = await db
    .insert(monetaryAccounts)
    .values({ nombre: 'Caja', tipo: 'efectivo' })
    .returning();
  cajaId = c!.id;

  const [s] = await db
    .insert(cashSessions)
    .values({ monetaryAccountId: cajaId, terminal: 'T1', abiertaPorId: usuarioId })
    .returning();
  sesionId = s!.id;

  await db
    .insert(exchangeRates)
    .values({ valorCentavos: 156_100, vigenteDesde: new Date(), origen: 'infodolar' });

  const [p] = await db
    .insert(products)
    .values({ wooId: 6485, nombre: 'Vidrio templado 9D', precioCentavos: 500_000, stock: 40 })
    .returning();
  vidrioId = p!.id;
});

async function venderDos(clave = 'v1') {
  return confirmarVenta(db, {
    lineas: [{ productId: vidrioId, cantidad: 2 }],
    pagos: [{ medio: 'efectivo', montoCentavos: 1_000_000, monetaryAccountId: cajaId }],
    vendedorId: usuarioId,
    cashSessionId: sesionId,
    terminal: 'T1',
    idempotencyKey: clave,
  });
}

describe('drenarCola', () => {
  it('empuja el stock del POS a WooCommerce y marca la venta sincronizada', async () => {
    const r = await venderDos();
    const woo = wooSimulado({ 6485: 40 });

    const informe = await drenarCola(db, woo.cliente);

    expect(informe.procesadas).toBe(1);
    expect(informe.exitosas).toBe(1);
    expect(woo.stock[6485]).toBe(38);

    const [venta] = await db.select().from(sales).where(eq(sales.id, r.id));
    expect(venta!.syncedToWoo).toBe(true);

    const [cola] = await db.select().from(syncQueue);
    expect(cola!.estado).toBe('ok');
  });

  it('drenar dos veces no vuelve a descontar: escribe el mismo valor absoluto', async () => {
    await venderDos();
    const woo = wooSimulado({ 6485: 40 });

    await drenarCola(db, woo.cliente);
    // Se fuerza a pendiente para simular un reintento sobre algo ya aplicado.
    await db.update(syncQueue).set({ estado: 'pendiente' });
    await drenarCola(db, woo.cliente);

    expect(woo.stock[6485]).toBe(38);
    // La segunda vez ni siquiera escribe: Woo ya coincide con el POS.
    expect(woo.escrituras).toHaveLength(1);
  });

  it('dos ventas encoladas dejan el stock final correcto', async () => {
    await venderDos('v1');
    await venderDos('v2');
    const woo = wooSimulado({ 6485: 40 });

    await drenarCola(db, woo.cliente);
    expect(woo.stock[6485]).toBe(36);
  });

  it('registra un conflicto cuando Woo tiene un número inesperado', async () => {
    await venderDos();
    // Alguien movió el stock en Woo por fuera del POS.
    const woo = wooSimulado({ 6485: 35 });

    const informe = await drenarCola(db, woo.cliente);
    expect(informe.conflictos).toBe(1);

    const conflictos = await db.select().from(syncConflicts);
    expect(conflictos).toHaveLength(1);
    expect(conflictos[0]!.stockWoo).toBe(35);
    expect(conflictos[0]!.stockPos).toBe(38);

    // Y aun así deja Woo espejando al POS.
    expect(woo.stock[6485]).toBe(38);
  });

  it('ante un fallo reintenta con espera creciente y no pierde la operación', async () => {
    await venderDos();
    const caido = wooSimulado({ 6485: 40 }, true);

    const informe = await drenarCola(db, caido.cliente);
    expect(informe.fallidas).toBe(1);

    const [cola] = await db.select().from(syncQueue);
    expect(cola!.estado).toBe('pendiente');
    expect(cola!.intentos).toBe(1);
    expect(cola!.ultimoError).toBeTruthy();
    expect(cola!.proximoIntento.getTime()).toBeGreaterThan(Date.now());

    // Cuando Woo vuelve, la operación se completa.
    const sano = wooSimulado({ 6485: 40 });
    const segundo = await drenarCola(db, sano.cliente, {
      ahora: new Date(Date.now() + 10 * 60_000),
    });
    expect(segundo.exitosas).toBe(1);
    expect(sano.stock[6485]).toBe(38);
  });

  it('después de agotar los intentos la marca como fallida', async () => {
    await venderDos();
    await db.update(syncQueue).set({ intentos: 5 });

    const caido = wooSimulado({ 6485: 40 }, true);
    await drenarCola(db, caido.cliente);

    const [cola] = await db.select().from(syncQueue);
    expect(cola!.estado).toBe('fallido');
  });

  it('no toca operaciones cuyo momento de reintento todavía no llegó', async () => {
    await venderDos();
    await db.update(syncQueue).set({ proximoIntento: new Date(Date.now() + 60 * 60_000) });

    const woo = wooSimulado({ 6485: 40 });
    expect((await drenarCola(db, woo.cliente)).procesadas).toBe(0);
  });
});

describe('pendientesDeSincronizar', () => {
  it('cuenta lo que falta y lo que falló', async () => {
    await venderDos('v1');
    await venderDos('v2');
    expect(await pendientesDeSincronizar(db)).toEqual({ pendientes: 2, fallidas: 0 });

    const woo = wooSimulado({ 6485: 40 });
    await drenarCola(db, woo.cliente);
    expect(await pendientesDeSincronizar(db)).toEqual({ pendientes: 0, fallidas: 0 });
  });
});

describe('esperaTrasIntento', () => {
  it('crece y se planta en 32 minutos', () => {
    expect(esperaTrasIntento(1)).toBe(2 * 60_000);
    expect(esperaTrasIntento(3)).toBe(8 * 60_000);
    expect(esperaTrasIntento(9)).toBe(32 * 60_000);
  });
});
