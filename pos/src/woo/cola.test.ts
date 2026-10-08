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

/**
 * WooCommerce simulado con un stock por producto que se puede inspeccionar.
 *
 * Entiende las dos formas de tocar el stock: el PUT del valor absoluto (filas
 * viejas) y el ajuste por diferencia de li-tienda, que recuerda las
 * referencias ya aplicadas igual que el plugin real.
 */
function wooSimulado(
  stockInicial: Record<number, number>,
  fallar = false,
  /** Corre en cada llamada, para poder mirar la base mientras se procesa. */
  espiar?: () => Promise<void>,
) {
  const stock = { ...stockInicial };
  const escrituras: { wooId: number; stock: number }[] = [];
  const aplicadas = new Set<string>();

  const fetchImpl = (async (entrada: string | URL, init?: RequestInit) => {
    if (espiar) await espiar();
    if (fallar) return new Response('boom', { status: 503 });

    const url = new URL(String(entrada));

    if (url.pathname.endsWith('/wc-li/v1/stock/ajustar')) {
      const cuerpo = JSON.parse(String(init?.body)) as {
        ref: string;
        items: { product_id: number; variation_id?: number; delta: number }[];
      };
      const items = cuerpo.items.map((it, i) => {
        const id = it.variation_id ?? it.product_id;
        const clave = `${cuerpo.ref}:${i}:${id}`;
        if (aplicadas.has(clave)) return { i, estado: 'ya_aplicado', stock: stock[id] ?? 0 };
        aplicadas.add(clave);
        stock[id] = (stock[id] ?? 0) + it.delta;
        escrituras.push({ wooId: id, stock: stock[id]! });
        return { i, estado: 'aplicado', stock: stock[id]! };
      });
      return new Response(JSON.stringify({ ref: cuerpo.ref, items }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

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
  it('resta en WooCommerce lo vendido y marca la venta sincronizada', async () => {
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

  it('drenar dos veces no vuelve a descontar: Woo recuerda la referencia', async () => {
    await venderDos();
    const woo = wooSimulado({ 6485: 40 });

    await drenarCola(db, woo.cliente);
    // Se fuerza a pendiente para simular un reintento sobre algo ya aplicado.
    await db.update(syncQueue).set({ estado: 'pendiente' });
    await drenarCola(db, woo.cliente);

    expect(woo.stock[6485]).toBe(38);
    // La segunda vez Woo contesta «ya aplicado» y no resta.
    expect(woo.escrituras).toHaveLength(1);
  });

  it('dos ventas encoladas dejan el stock final correcto', async () => {
    await venderDos('v1');
    await venderDos('v2');
    const woo = wooSimulado({ 6485: 40 });

    await drenarCola(db, woo.cliente);
    expect(woo.stock[6485]).toBe(36);
  });

  it('no pisa lo que vendió la web y deja anotada la diferencia', async () => {
    await venderDos();
    // La web vendió 5 que el POS todavía no sabe: Woo tiene 35, no 40.
    const woo = wooSimulado({ 6485: 35 });

    const informe = await drenarCola(db, woo.cliente);

    // Woo resta lo del local sobre lo que ya tenía: las ventas web siguen ahí.
    // Antes se escribía el 38 del POS y las 5 unidades vendidas online volvían.
    expect(woo.stock[6485]).toBe(33);

    expect(informe.conflictos).toBe(1);
    const conflictos = await db.select().from(syncConflicts);
    expect(conflictos).toHaveLength(1);
    expect(conflictos[0]!.stockWoo).toBe(33);
    expect(conflictos[0]!.stockPos).toBe(38);
  });

  it('una fila vieja, sin delta, sigue por el camino del valor absoluto', async () => {
    await db.insert(syncQueue).values({
      operacion: 'venta.descontar_stock',
      idempotencyKey: 'vieja:1',
      payload: {
        ventaId: '00000000-0000-0000-0000-000000000000',
        numero: 'T1-000001',
        items: [{ productId: vidrioId, wooId: 6485, cantidad: 2, stockResultante: 38 }],
      },
    });
    await db.update(products).set({ stock: 38 }).where(eq(products.id, vidrioId));
    const woo = wooSimulado({ 6485: 40 });

    const informe = await drenarCola(db, woo.cliente);

    expect(informe.exitosas).toBe(1);
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

  it('reintentar dos veces no descuenta de más: Woo recuerda la referencia', async () => {
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

describe('stock.empujar', () => {
  it('con delta suma en Woo sin pisar lo que vendió la web', async () => {
    await db.insert(syncQueue).values({
      operacion: 'stock.empujar',
      idempotencyKey: 'stock:ingreso:1',
      payload: { productId: vidrioId, wooId: 6485, delta: 10 },
    });
    // Woo tiene 33: la web vendió mientras tanto. Se suman 10 sobre eso.
    const woo = wooSimulado({ 6485: 33 });

    const informe = await drenarCola(db, woo.cliente);

    expect(informe.exitosas).toBe(1);
    expect(woo.stock[6485]).toBe(43);
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

/**
 * WooCommerce simulado que anota los precios que se le escriben.
 *
 * El de arriba solo mira `stock_quantity`, que para una venta es lo único que
 * viaja. Acá lo que importa son otros dos campos, y **los dos juntos**: el
 * número y la marca de moneda que dice en qué moneda está ese número.
 */
function wooQueAnotaPrecios() {
  const precios: Record<number, string> = {};
  const monedas: Record<number, string | undefined> = {};

  const fetchImpl = (async (entrada: string | URL, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const wooId = Number(url.pathname.split('/').pop());

    if (init?.method === 'PUT') {
      const cuerpo = JSON.parse(String(init.body)) as {
        regular_price?: string;
        meta_data?: { key: string; value: string }[];
      };
      if (cuerpo.regular_price !== undefined) precios[wooId] = cuerpo.regular_price;
      const marca = cuerpo.meta_data?.find((m) => m.key === '_li_moneda');
      if (marca) monedas[wooId] = marca.value;
    }

    return new Response(JSON.stringify({ id: wooId }), {
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

  return { cliente, precios, monedas };
}

describe('precio.empujar', () => {
  it('le escribe a la tienda el precio de ficha que el POS tiene ahora', async () => {
    // Sin esto la web sigue cobrando el precio viejo, y además el próximo
    // `woo:sync` devuelve la ficha a ese precio: el cambio se borra solo.
    await db
      .update(products)
      .set({ precioCentavos: 16_800_00 })
      .where(eq(products.id, vidrioId));
    await db.insert(syncQueue).values({
      operacion: 'precio.empujar',
      idempotencyKey: 'precio:1',
      payload: { productId: vidrioId, wooId: 6485 },
    });

    const woo = wooQueAnotaPrecios();
    const informe = await drenarCola(db, woo.cliente);

    expect(informe.exitosas).toBe(1);
    expect(woo.precios[6485]).toBe('16800.00');
    // En pesos la marca de dólares se limpia, aunque nunca haya estado puesta:
    // es lo que arregla una ficha que quedó marcada de antes.
    expect(woo.monedas[6485]).toBe('');
  });

  it('un producto en dólares viaja en dólares, con su marca al lado', async () => {
    /*
     * La convención del plugin: en una ficha marcada `_li_moneda = USD`, el
     * número de WooCommerce son DÓLARES y la web le aplica la cotización al
     * renderizar. Mandarle los pesos calculados —$990.000— la publicaría como
     * US$ 990.000: mil quinientos millones en la vidriera.
     */
    await db
      .update(products)
      .set({ moneda: 'USD', precioUsdCentavos: 630_00, precioCentavos: 990_000_00 })
      .where(eq(products.id, vidrioId));
    await db.insert(syncQueue).values({
      operacion: 'precio.empujar',
      idempotencyKey: 'precio:usd',
      payload: { productId: vidrioId, wooId: 6485 },
    });

    const woo = wooQueAnotaPrecios();
    await drenarCola(db, woo.cliente);

    expect(woo.precios[6485]).toBe('630.00');
    expect(woo.monedas[6485]).toBe('USD');
  });

  it('manda el precio de ahora, no el que había cuando se encoló', async () => {
    // Dos cambios seguidos antes de que la cola corra: lo que tiene que llegar
    // a la web es el último, y las dos operaciones escriben ese mismo número.
    await db.insert(syncQueue).values({
      operacion: 'precio.empujar',
      idempotencyKey: 'precio:viejo',
      payload: { productId: vidrioId, wooId: 6485 },
    });
    await db
      .update(products)
      .set({ precioCentavos: 20_000_00 })
      .where(eq(products.id, vidrioId));

    const woo = wooQueAnotaPrecios();
    await drenarCola(db, woo.cliente);

    expect(woo.precios[6485]).toBe('20000.00');
  });

  it('no falla si el producto ya no está en el espejo', async () => {
    await db.insert(syncQueue).values({
      operacion: 'precio.empujar',
      idempotencyKey: 'precio:fantasma',
      payload: { productId: '00000000-0000-0000-0000-000000000000', wooId: 9999 },
    });

    const woo = wooQueAnotaPrecios();
    const informe = await drenarCola(db, woo.cliente);

    expect(informe.exitosas).toBe(1);
    expect(informe.fallidas).toBe(0);
    expect(woo.precios[9999]).toBeUndefined();
  });
});

describe('producto.baja', () => {
  it('pasa el producto a borrador en la tienda, sin borrarlo', async () => {
    /*
     * Borrador y no DELETE: la ficha está pegada a las ventas viejas y a la
     * rentabilidad de los meses pasados. Y es lo que hace durar la baja: la
     * sincronización traduce `status` a `activo`, así que con el producto en
     * borrador el espejo lo trae inactivo en vez de devolverlo a la venta.
     */
    await db.insert(syncQueue).values({
      operacion: 'producto.baja',
      idempotencyKey: 'baja:1',
      payload: { productId: vidrioId, wooId: 6485 },
    });

    const enviadas: Record<string, unknown>[] = [];
    const fetchImpl = (async (entrada: string | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') enviadas.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: 6485 }), {
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

    const informe = await drenarCola(db, cliente);

    expect(informe.exitosas).toBe(1);
    expect(enviadas).toEqual([{ status: 'draft' }]);
  });
});
