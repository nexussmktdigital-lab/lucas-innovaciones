import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  auditLog,
  productVariants,
  products,
  saleItems,
  salePayments,
  sales,
  settings,
  stockMovements,
  syncQueue,
} from '@/db/schema';
import { ClienteWoo } from './cliente';
import { ventasEnPeriodo } from '@/ventas/anular';
import { importarPedidosWeb, medioDePago, type PedidoWeb } from './pedidos-web';

let db: TestDb;
let vidrioId: string;

/** WooCommerce simulado que devuelve una lista fija de pedidos y anota lo que se le pidió. */
function wooConPedidos(pedidos: Partial<PedidoWeb>[]) {
  const pedidas: URL[] = [];
  const fetchImpl = (async (entrada: string | URL) => {
    const url = new URL(String(entrada));
    pedidas.push(url);
    return new Response(JSON.stringify(pedidos), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-wp-totalpages': '1', 'x-wp-total': String(pedidos.length) },
    });
  }) as unknown as typeof fetch;
  const cliente = new ClienteWoo({
    url: 'https://ejemplo.test',
    consumerKey: 'ck',
    consumerSecret: 'cs',
    fetchImpl,
    reintentos: 1,
    timeoutMs: 1000,
  });
  return { cliente, pedidas };
}

function pedido(extra: Partial<PedidoWeb> = {}): Partial<PedidoWeb> {
  return {
    id: 9154,
    number: '9154',
    status: 'on-hold',
    created_via: 'store-api',
    date_created_gmt: '2026-10-07T20:56:00',
    date_modified_gmt: '2026-10-07T20:56:00',
    total: '12000.00',
    shipping_total: '0.00',
    payment_method: 'bacs',
    payment_method_title: 'Transferencia bancaria',
    billing: { first_name: 'Prueba', last_name: 'Demo' },
    line_items: [{ name: 'Vidrio templado 9D', product_id: 6485, variation_id: 0, quantity: 2, total: '12000.00' }],
    ...extra,
  };
}

const ahora = new Date('2026-10-07T21:00:00Z');

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);
  const [p] = await db
    .insert(products)
    .values({ wooId: 6485, nombre: 'Vidrio templado 9D', precioCentavos: 600_000, stock: 40 })
    .returning();
  vidrioId = p!.id;
});

describe('importarPedidosWeb', () => {
  it('trae un pedido web como venta del canal web y descuenta el stock del espejo', async () => {
    const woo = wooConPedidos([pedido()]);

    const informe = await importarPedidosWeb(db, woo.cliente, { ahora });

    expect(informe.importados).toBe(1);
    const [venta] = await db.select().from(sales);
    expect(venta!.canal).toBe('web');
    expect(venta!.terminal).toBe('WEB');
    expect(venta!.numero).toBe('WEB-000001');
    expect(venta!.wooOrderId).toBe(9154);
    expect(venta!.totalCentavos).toBe(1_200_000);
    expect(venta!.cashSessionId).toBeNull();
    expect(venta!.nota).toContain('Pedido web #9154');

    const [item] = await db.select().from(saleItems);
    expect(item!.cantidad).toBe(2);
    expect(item!.totalCentavos).toBe(1_200_000);

    const [pago] = await db.select().from(salePayments);
    expect(pago!.medio).toBe('transferencia');
    expect(pago!.montoCentavos).toBe(1_200_000);

    const [vidrio] = await db.select().from(products).where(eq(products.id, vidrioId));
    expect(vidrio!.stock).toBe(38);
    const [mov] = await db.select().from(stockMovements);
    expect(mov!.tipo).toBe('pedido_web');
    expect(mov!.cantidad).toBe(-2);
    expect(mov!.stockResultante).toBe(38);

    // Woo ya descontó: no se le manda nada.
    expect(await db.select().from(syncQueue)).toHaveLength(0);

    // Y queda en la bitácora como cualquier venta.
    const asientos = await db.select().from(auditLog).where(eq(auditLog.accion, 'venta.confirmar'));
    expect(asientos).toHaveLength(1);
  });

  it('pedirlo de nuevo no lo duplica ni gasta otro número', async () => {
    const woo = wooConPedidos([pedido()]);
    await importarPedidosWeb(db, woo.cliente, { ahora });
    const segunda = await importarPedidosWeb(db, woo.cliente, { ahora });

    expect(segunda.importados).toBe(0);
    expect(await db.select().from(sales)).toHaveLength(1);
    const [vidrio] = await db.select().from(products).where(eq(products.id, vidrioId));
    expect(vidrio!.stock).toBe(38);

    // El siguiente pedido toma el 2: no quedó ningún hueco en el correlativo.
    await importarPedidosWeb(db, wooConPedidos([pedido({ id: 9155, number: '9155' })]).cliente, { ahora });
    const numeros = (await db.select({ numero: sales.numero }).from(sales)).map((x) => x.numero).sort();
    expect(numeros).toEqual(['WEB-000001', 'WEB-000002']);
  });

  it('no trae lo que no nació en la tienda ni lo que todavía no está pago', async () => {
    const woo = wooConPedidos([
      pedido({ id: 1, created_via: 'rest-api' }), // una venta del POS
      pedido({ id: 2, created_via: 'admin' }),
      pedido({ id: 3, status: 'pending' }), // Mercado Pago sin pagar
      pedido({ id: 4, status: 'checkout-draft' }),
    ]);

    const informe = await importarPedidosWeb(db, woo.cliente, { ahora });

    expect(informe.importados).toBe(0);
    expect(informe.salteados).toBe(4);
    expect(await db.select().from(sales)).toHaveLength(0);
  });

  it('un pedido que se cancela en la tienda anula la venta y devuelve el stock', async () => {
    await importarPedidosWeb(db, wooConPedidos([pedido()]).cliente, { ahora });

    const cancelado = pedido({ status: 'cancelled', date_modified_gmt: '2026-10-07T21:30:00' });
    const informe = await importarPedidosWeb(db, wooConPedidos([cancelado]).cliente, {
      ahora: new Date('2026-10-07T22:00:00Z'),
    });

    expect(informe.anulados).toBe(1);
    const [venta] = await db.select().from(sales);
    expect(venta!.estado).toBe('cancelled');
    expect(venta!.motivoAnulacion).toContain('cancelado en la tienda');

    const [vidrio] = await db.select().from(products).where(eq(products.id, vidrioId));
    expect(vidrio!.stock).toBe(40);
    expect(await db.select().from(syncQueue)).toHaveLength(0);
  });

  it('un cancelado que nunca entró no hace nada', async () => {
    const informe = await importarPedidosWeb(db, wooConPedidos([pedido({ status: 'cancelled' })]).cliente, { ahora });
    expect(informe.anulados).toBe(0);
    expect(await db.select().from(sales)).toHaveLength(0);
  });

  it('si un producto no está en el espejo, el pedido espera y la marca no avanza', async () => {
    const raro = pedido({
      line_items: [{ name: 'Algo nuevo', product_id: 777, variation_id: 0, quantity: 1, total: '5000.00' }],
    });
    const informe = await importarPedidosWeb(db, wooConPedidos([raro]).cliente, { ahora });

    expect(informe.sinProducto).toEqual(['#9154']);
    expect(await db.select().from(sales)).toHaveLength(0);
    expect(await db.select().from(settings).where(eq(settings.clave, 'woo.pedidos_web'))).toHaveLength(0);
  });

  it('una variación con stock propio descuenta de la variación, no del padre', async () => {
    const [v] = await db
      .insert(productVariants)
      .values({ productId: vidrioId, wooId: 7001, nombre: 'iPhone 14', stock: 5, gestionaStock: true })
      .returning();
    const conVariacion = pedido({
      line_items: [{ name: 'Vidrio iPhone 14', product_id: 6485, variation_id: 7001, quantity: 1, total: '6000.00' }],
    });

    await importarPedidosWeb(db, wooConPedidos([conVariacion]).cliente, { ahora });

    const [variante] = await db.select().from(productVariants).where(eq(productVariants.id, v!.id));
    expect(variante!.stock).toBe(4);
    const [vidrio] = await db.select().from(products).where(eq(products.id, vidrioId));
    expect(vidrio!.stock).toBe(40);
  });

  it('pide solo lo modificado desde la marca, con margen, y la guarda', async () => {
    const woo = wooConPedidos([pedido()]);
    await importarPedidosWeb(db, woo.cliente, { ahora });

    const params = woo.pedidas[0]!.searchParams;
    expect(params.get('modified_after')).toBeTruthy();
    expect(params.get('dates_are_gmt')).toBe('true');
    expect(params.get('orderby')).toBe('modified');

    const [marca] = await db.select().from(settings).where(eq(settings.clave, 'woo.pedidos_web'));
    expect((marca!.valor as { desde: string }).desde).toBe('2026-10-07T20:56:00.000Z');
  });
});

describe('la lista de ventas', () => {
  it('marca como web lo que vino de la tienda, para pintarlo distinto', async () => {
    await importarPedidosWeb(db, wooConPedidos([pedido()]).cliente, { ahora });
    const ventas = await ventasEnPeriodo(db, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-31T00:00:00Z'));
    expect(ventas).toHaveLength(1);
    expect(ventas[0]!.canal).toBe('web');
  });
});

describe('medioDePago', () => {
  it('traduce las pasarelas de la tienda', () => {
    expect(medioDePago('bacs')).toBe('transferencia');
    expect(medioDePago('cod')).toBe('efectivo');
    expect(medioDePago('woo-mercado-pago-basic')).toBe('mercadopago');
    expect(medioDePago('woo-mercado-pago-custom')).toBe('mercadopago');
  });
});
