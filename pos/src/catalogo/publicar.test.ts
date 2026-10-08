/**
 * Tests del alta en WooCommerce.
 *
 * Lo que importa probar es el **precio que viaja**. Es la única operación del
 * POS que crea una ficha en la tienda, y si el número sale en la moneda
 * equivocada la vidriera publica un precio mil quinientas veces más alto (o más
 * bajo) sin que nadie lo note hasta que alguien compra.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { products } from '@/db/schema';
import { ClienteWoo } from '@/woo/cliente';
import { publicarProducto } from './publicar';

let db: TestDb;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);
});

/** 15% de recargo de tienda, el que cubre la comisión de Mercado Pago (D31). */
const RECARGO_BP = 1_500;

/** WooCommerce simulado: anota el alta y contesta con un id. */
function wooQueAnotaElAlta() {
  const altas: {
    regular_price?: string;
    meta_data?: { key: string; value: string }[];
    name?: string;
  }[] = [];

  const fetchImpl = (async (entrada: string | URL, init?: RequestInit) => {
    const url = new URL(String(entrada));

    // La búsqueda de categoría: no hay ninguna, así que el alta no manda categoría.
    if (url.pathname.includes('products/categories')) {
      return new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-wp-total': '0' },
      });
    }

    if (init?.method === 'POST') altas.push(JSON.parse(String(init.body)));

    return new Response(JSON.stringify({ id: 8123 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
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

  return { cliente, altas };
}

describe('publicarProducto', () => {
  it('en pesos publica el precio de tienda, con el recargo', async () => {
    const [p] = await db
      .insert(products)
      .values({
        nombre: 'Cable USB tipo C',
        precioCentavos: 10_000_00,
        precioLocalCentavos: 10_000_00,
        stock: 3,
        gestionaStock: true,
      })
      .returning();

    const woo = wooQueAnotaElAlta();
    await publicarProducto(db, woo.cliente, { productId: p!.id }, RECARGO_BP);

    expect(woo.altas).toHaveLength(1);
    expect(woo.altas[0]!.regular_price).toBe('11500.00');
    expect(woo.altas[0]!.meta_data).toEqual([{ key: '_li_moneda', value: '' }]);

    const [enBase] = await db.select().from(products).where(eq(products.id, p!.id));
    expect(enBase!.wooId).toBe(8123);
    expect(enBase!.precioCentavos).toBe(11_500_00);
  });

  it('en dólares publica los dólares con su marca, y sin recargo', async () => {
    /*
     * Dos cosas de una. El número: a la ficha en dólares la web le aplica la
     * cotización al renderizar, así que lo que tiene que guardar son los 630,
     * no los $990.000 que muestra el mostrador. Y el recargo: sobre un precio
     * en dólares no se calcula acá —lo decide el dueño cuando carga el número—
     * porque el recargo sobre el precio convertido se mueve con el dólar.
     */
    const [p] = await db
      .insert(products)
      .values({
        nombre: 'iPhone 13 128GB usado',
        moneda: 'USD',
        precioUsdCentavos: 630_00,
        precioCentavos: 990_000_00,
        stock: 1,
        gestionaStock: true,
      })
      .returning();

    const woo = wooQueAnotaElAlta();
    await publicarProducto(db, woo.cliente, { productId: p!.id }, RECARGO_BP);

    expect(woo.altas[0]!.regular_price).toBe('630.00');
    expect(woo.altas[0]!.meta_data).toEqual([{ key: '_li_moneda', value: 'USD' }]);

    // Y el precio en pesos del espejo no se toca: sigue siendo el calculado.
    const [enBase] = await db.select().from(products).where(eq(products.id, p!.id));
    expect(enBase!.precioCentavos).toBe(990_000_00);
  });

  it('no publica dos veces el mismo producto', async () => {
    const [p] = await db
      .insert(products)
      .values({ nombre: 'Funda', precioCentavos: 9_000_00, wooId: 4321, stock: 1 })
      .returning();

    const woo = wooQueAnotaElAlta();
    await publicarProducto(db, woo.cliente, { productId: p!.id }, RECARGO_BP);

    expect(woo.altas).toHaveLength(0);
  });
});
