/**
 * Tests del refresco del espejo por webhook.
 *
 * El punto de todos: **el webhook no le toca el stock al POS**. Cada venta
 * empuja el stock a Woo, Woo devuelve un `product.updated` con esa ficha, y si
 * el POS aceptara ese numero una venta hecha en el medio se perderia.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { products, syncConflicts } from '@/db/schema';
import { refrescarFichaDeProducto } from './espejo';

let db: TestDb;

/** Ficha de Woo con los valores por defecto que devuelve la API. */
function ficha(parcial: Record<string, unknown> = {}) {
  return {
    id: 6485,
    name: 'Vidrio templado 9D',
    type: 'simple',
    status: 'publish',
    catalog_visibility: 'visible',
    sku: '531',
    price: '5000',
    manage_stock: true,
    stock_quantity: 40,
    categories: [{ name: 'Vidrios templados' }],
    brands: [],
    images: [],
    meta_data: [],
    ...parcial,
  };
}

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);
  await db.insert(products).values({
    wooId: 6485,
    nombre: 'Vidrio templado 9D',
    sku: '531',
    precioCentavos: 500_000,
    stock: 38,
    gestionaStock: true,
  });
});

describe('refrescarFichaDeProducto', () => {
  it('actualiza la ficha pero deja el stock del POS como está', async () => {
    // Woo manda el stock viejo (40); el POS ya vendió dos y tiene 38.
    const r = await refrescarFichaDeProducto(db, ficha({ name: 'Vidrio 9D premium', price: '6000' }), null);

    expect(r.aplicado).toBe(true);

    const [p] = await db.select().from(products).where(eq(products.wooId, 6485));
    expect(p!.nombre).toBe('Vidrio 9D premium');
    expect(p!.precioCentavos).toBe(600_000);
    expect(p!.stock).toBe(38); // lo que el POS tenía, no lo que dijo Woo
  });

  it('registra la divergencia para que se vea, en vez de resolverla sola', async () => {
    const r = await refrescarFichaDeProducto(db, ficha(), null);

    expect(r.divergencia).toBe(true);
    const [c] = await db.select().from(syncConflicts);
    expect(c!.stockPos).toBe(38);
    expect(c!.stockWoo).toBe(40);
  });

  it('sin diferencia no registra nada', async () => {
    const r = await refrescarFichaDeProducto(db, ficha({ stock_quantity: 38 }), null);

    expect(r.divergencia).toBe(false);
    expect(await db.select().from(syncConflicts)).toHaveLength(0);
  });

  it('un producto que no lleva stock no genera divergencia', async () => {
    await db.update(products).set({ gestionaStock: false }).where(eq(products.wooId, 6485));

    const r = await refrescarFichaDeProducto(db, ficha({ manage_stock: false }), null);
    expect(r.divergencia).toBe(false);
  });

  it('un producto nuevo entra con el stock que dice Woo', async () => {
    // No hay nada local que perder: el INSERT sí trae el stock.
    await refrescarFichaDeProducto(db, ficha({ id: 7001, name: 'Cable', stock_quantity: 12 }), null);

    const [p] = await db.select().from(products).where(eq(products.wooId, 7001));
    expect(p!.stock).toBe(12);
  });

  it('marca «solo mostrador» lo que Woo tiene oculto del catálogo', async () => {
    await refrescarFichaDeProducto(
      db,
      ficha({ id: 7002, name: 'Chip Claro', catalog_visibility: 'hidden' }),
      null,
    );

    const [p] = await db.select().from(products).where(eq(products.wooId, 7002));
    expect(p!.soloMostrador).toBe(true);
  });

  it('una ficha ilegible se ignora sin romper nada', async () => {
    const r = await refrescarFichaDeProducto(db, { hola: 'mundo' }, null);

    expect(r.aplicado).toBe(false);
    const [p] = await db.select().from(products).where(eq(products.wooId, 6485));
    expect(p!.stock).toBe(38);
  });
});
