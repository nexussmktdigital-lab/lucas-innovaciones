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
import {
  drenarCola,
  esperaTrasIntento,
  MAXIMO_DE_INTENTOS,
  MINUTOS_PARA_RETOMAR,
  operacionesEnCola,
  pendientesDeSincronizar,
  reintentarFallidas,
} from './cola';

let db: TestDb;
let usuarioId: string;
let cajaId: string;
let sesionId: string;
let vidrioId: string;

/** WooCommerce simulado con un stock por producto que se puede inspeccionar. */
function wooSimulado(
  stockInicial: Record<number, number>,
  fallar = false,
  /** Corre en cada llamada, para poder mirar la base mientras se procesa. */
  espiar?: () => Promise<void>,
) {
  const stock = { ...stockInicial };
  const escrituras: { wooId: number; stock: number }[] = [];

  const fetchImpl = (async (entrada: string | URL, init?: RequestInit) => {
    if (espiar) await espiar();
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

describe('dos drenajes a la vez', () => {
  /*
   * El drenaje corre desde dos lados: despues de cada venta y cada diez minutos
   * por la tarea programada. Si los dos se llevan las mismas filas, el ajuste de
   * stock da igual —se escribe el valor absoluto— pero publicar un producto no
   * es idempotente y quedaria creado dos veces en la tienda.
   */
  /*
   * La propiedad que importa es que la fila se **tome antes** de procesarla y
   * no despues: si se marcara al final, el otro drenaje la agarraria en el
   * medio y publicaria el producto dos veces.
   *
   * Se comprueba desde adentro: el cliente de Woo, mientras lo llaman, mira en
   * que estado quedo la fila. Un `Promise.all` de dos drenajes no probaria
   * nada, porque la base de los tests corre sobre una sola conexion y los
   * serializa: pasaria igual sin el candado.
   */
  it('la operacion se toma antes de procesarla, no despues', async () => {
    await venderDos('a');

    let estadoMientrasSeProcesa: string | null = null;
    const woo = wooSimulado({ 6485: 40 }, false, async () => {
      if (estadoMientrasSeProcesa !== null) return;
      const [fila] = await db.select().from(syncQueue);
      estadoMientrasSeProcesa = fila?.estado ?? null;
    });

    const informe = await drenarCola(db, woo.cliente);

    expect(informe.exitosas).toBe(1);
    expect(estadoMientrasSeProcesa).toBe('procesando');
  });

  it('una operacion tomada no la agarra otro drenaje', async () => {
    await venderDos('a');

    await db.update(syncQueue).set({ estado: 'procesando', updatedAt: new Date() });

    const woo = wooSimulado({ 6485: 40 });
    const informe = await drenarCola(db, woo.cliente);
    expect(informe.procesadas).toBe(0);
  });

  /*
   * Salvo que haya quedado tomada por alguien que ya no existe: sin esto, un
   * proceso que se corta a la mitad deja la venta sin llegar nunca a la tienda.
   */
  it('pero si quedo tomada hace rato, se retoma', async () => {
    await venderDos('a');

    const hace = new Date(Date.now() - (MINUTOS_PARA_RETOMAR + 1) * 60_000);
    await db.update(syncQueue).set({ estado: 'procesando', updatedAt: hace });

    const woo = wooSimulado({ 6485: 40 });
    const informe = await drenarCola(db, woo.cliente);
    expect(informe.procesadas).toBe(1);
    expect(informe.exitosas).toBe(1);
  });
});

describe('el presupuesto de tiempo', () => {
  /*
   * Cada operacion son un GET y un PUT contra un hosting compartido, y con el
   * timeout y los reintentos del cliente una sola puede tardar un minuto. Sin
   * cortar, la funcion sin servidor se muere a la mitad cada diez minutos y
   * nadie se entera de que la cola no avanza.
   */
  it('corta cuando se acaba el tiempo y deja lo que falta para la proxima', async () => {
    await venderDos('a');
    await venderDos('b');
    await venderDos('c');

    // Un Woo que tarda: con presupuesto cero, ni la primera alcanza a empezar.
    const woo = wooSimulado({ 6485: 40 }, false, async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const informe = await drenarCola(db, woo.cliente, { presupuestoMs: 40 });

    expect(informe.cortadoPorTiempo).toBe(true);
    expect(informe.procesadas).toBeLessThan(3);

    // Y sobre todo: lo que quedo sin procesar vuelve a estar disponible ya, sin
    // esperar el rescate de los cinco minutos.
    const cola = await db.select().from(syncQueue);
    const trabadas = cola.filter((o) => o.estado === 'procesando');
    expect(trabadas).toHaveLength(0);

    const siguiente = await drenarCola(db, wooSimulado({ 6485: 40 }).cliente);
    expect(informe.procesadas + siguiente.procesadas).toBe(3);
  });

  it('sin presupuesto, drena todo de una', async () => {
    await venderDos('a');
    await venderDos('b');

    const informe = await drenarCola(db, wooSimulado({ 6485: 40 }).cliente);
    expect(informe.procesadas).toBe(2);
    expect(informe.cortadoPorTiempo).toBe(false);
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

describe('reintentarFallidas', () => {
  /**
   * Una operación que agotaba los seis intentos quedaba muerta: el cajero veía
   * el contador crecer y no había forma de hacer nada con ese número.
   */
  async function dejarUnaFallida() {
    await venderDos();
    const roto = wooSimulado({ 6485: 40 }, true);

    // Seis corridas con Woo caído la dan por fallida.
    for (let i = 0; i < MAXIMO_DE_INTENTOS; i += 1) {
      await drenarCola(db, roto.cliente, { ahora: new Date(Date.now() + i * 60 * 60_000) });
    }

    const [enCola] = await db.select().from(syncQueue);
    expect(enCola!.estado).toBe('fallido');
  }

  it('las devuelve a la cola con los intentos en cero', async () => {
    await dejarUnaFallida();

    const revividas = await reintentarFallidas(db);

    expect(revividas).toBe(1);
    const [enCola] = await db.select().from(syncQueue);
    expect(enCola!.estado).toBe('pendiente');
    expect(enCola!.intentos).toBe(0);
  });

  it('y con Woo de vuelta, el siguiente drenaje las pasa', async () => {
    await dejarUnaFallida();
    await reintentarFallidas(db);

    const woo = wooSimulado({ 6485: 40 });
    const informe = await drenarCola(db, woo.cliente);

    expect(informe.exitosas).toBe(1);
    expect(woo.stock[6485]).toBe(38);

    const [venta] = await db.select().from(sales);
    expect(venta!.syncedToWoo).toBe(true);
  });

  it('reintentar dos veces no descuenta de más: se escribe el absoluto', async () => {
    await venderDos();
    const woo = wooSimulado({ 6485: 40 });

    await drenarCola(db, woo.cliente);
    await reintentarFallidas(db);
    await drenarCola(db, woo.cliente);

    expect(woo.stock[6485]).toBe(38);
  });

  it('sin fallidas no toca nada', async () => {
    await venderDos();
    expect(await reintentarFallidas(db)).toBe(0);

    const [enCola] = await db.select().from(syncQueue);
    expect(enCola!.estado).toBe('pendiente');
  });
});

describe('operacionesEnCola', () => {
  it('dice qué espera, por qué falló y de qué venta es', async () => {
    const venta = await venderDos();
    const roto = wooSimulado({ 6485: 40 }, true);
    await drenarCola(db, roto.cliente);

    const [op] = await operacionesEnCola(db);

    expect(op!.numero).toBe(venta.numero);
    expect(op!.estado).toBe('pendiente');
    expect(op!.intentos).toBe(1);
    expect(op!.ultimoError).toMatch(/503|WooCommerce|boom/i);
  });

  it('no lista lo que ya se sincronizó', async () => {
    await venderDos();
    const woo = wooSimulado({ 6485: 40 });
    await drenarCola(db, woo.cliente);

    expect(await operacionesEnCola(db)).toHaveLength(0);
  });
});
