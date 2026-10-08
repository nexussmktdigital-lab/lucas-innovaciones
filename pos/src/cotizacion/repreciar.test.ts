/**
 * Repreciar lo que está en dólares cuando cambia la cotización.
 *
 * Lo que importa probar no es la multiplicación: es que el espejo del POS
 * quede al día, que una corrida con el dólar quieto no escriba nada y que **a
 * la web no se le empuje nada**. La ficha en dólares de Woo guarda dólares y el
 * plugin le aplica la cotización al renderizar; mandarle los pesos la
 * publicaría multiplicada otra vez.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { products, syncQueue } from '@/db/schema';
import { usdAPesos } from '@/lib/dinero';
import { repreciarEnDolares } from './repreciar';

let db: TestDb;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);
});

/** Un usado del catálogo real: precio en dólares, publicado en la tienda. */
async function enDolares(parcial: Partial<typeof products.$inferInsert> = {}) {
  const [p] = await db
    .insert(products)
    .values({
      wooId: 7001,
      nombre: 'iPhone 15 Pro Max 256GB',
      moneda: 'USD',
      precioUsdCentavos: 745_00,
      precioCentavos: usdAPesos(745_00, 1_500_00),
      stock: 1,
      gestionaStock: true,
      ...parcial,
    })
    .returning();
  return p!;
}

describe('repreciar', () => {
  it('recalcula el precio de ficha con la cotización nueva', async () => {
    const p = await enDolares();

    const r = await repreciarEnDolares(db, 1_571_00);

    expect(r).toMatchObject({ mirados: 1, cambiados: 1 });

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.precioCentavos).toBe(usdAPesos(745_00, 1_571_00));
  });

  it('no le empuja el precio a la tienda: la web convierte sola', async () => {
    /*
     * Esto encolaba `precio.empujar` por cada producto repreciado, con la
     * convención vieja —en la que el POS creía que Woo guardaba pesos—. Con la
     * de verdad, esa escritura le pone $1.170.000 a una ficha que la web lee
     * como US$ 1.170.000: mil ochocientos millones de pesos en la vidriera.
     */
    await enDolares();

    await repreciarEnDolares(db, 1_571_00);

    expect(await db.select().from(syncQueue)).toHaveLength(0);
  });

  it('con el dólar quieto no escribe nada', async () => {
    await enDolares({ precioCentavos: usdAPesos(745_00, 1_500_00) });

    const r = await repreciarEnDolares(db, 1_500_00);

    expect(r).toMatchObject({ mirados: 1, cambiados: 0 });
    expect(await db.select().from(syncQueue)).toHaveLength(0);
  });

  it('un movimiento que no cruza el redondeo no mueve el precio', async () => {
    /*
     * `usdAPesos` redondea a los mil pesos, pero absorbe menos de lo que uno
     * supone: en un usado de u$s745, $1,35 de dólar ya cambian el precio. Cinco
     * centavos no, y esa es la diferencia entre encolar y no encolar.
     */
    const p = await enDolares({ precioCentavos: usdAPesos(745_00, 1_571_00) });

    const r = await repreciarEnDolares(db, 1_571_05);

    expect(r.cambiados).toBe(0);
    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.precioCentavos).toBe(usdAPesos(745_00, 1_571_00));
  });

  it('el mismo precio dos veces en días distintos no falla', async () => {
    // El dólar vuelve sobre sus pasos: sube el martes y baja al mismo valor el
    // jueves. Repreciar es idempotente —el precio sale de la cotización, no de
    // sumar— así que volver al mismo valor vuelve al mismo precio.
    const p = await enDolares();

    await repreciarEnDolares(db, 1_571_00);
    await db
      .update(products)
      .set({ precioCentavos: usdAPesos(745_00, 1_400_00) })
      .where(eq(products.id, p.id));
    const r = await repreciarEnDolares(db, 1_571_00);

    expect(r.cambiados).toBe(1);
    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.precioCentavos).toBe(usdAPesos(745_00, 1_571_00));
  });

  it('no toca los productos en pesos', async () => {
    await db.insert(products).values({
      wooId: 7002,
      nombre: 'Funda común',
      precioCentavos: 9_000_00,
      stock: 5,
    });

    const r = await repreciarEnDolares(db, 1_571_00);

    expect(r.mirados).toBe(0);
    const [enBase] = await db.select().from(products).where(eq(products.wooId, 7002));
    expect(enBase!.precioCentavos).toBe(9_000_00);
  });

  it('no toca los que están inactivos', async () => {
    await enDolares({ activo: false });
    expect((await repreciarEnDolares(db, 1_571_00)).mirados).toBe(0);
  });

  it('también reprecia lo que todavía no está en la tienda', async () => {
    const p = await enDolares({ wooId: null });

    const r = await repreciarEnDolares(db, 1_571_00);

    expect(r).toMatchObject({ cambiados: 1 });
    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.precioCentavos).toBe(usdAPesos(745_00, 1_571_00));
  });

  it('rechaza una cotización imposible en vez de poner todo en cero', async () => {
    await enDolares();
    for (const malo of [0, -1, 1.5]) {
      await expect(repreciarEnDolares(db, malo)).rejects.toThrow();
    }
  });

  it('con el catálogo entero en pesos no hace nada y no falla', async () => {
    // Es el estado de hoy: cero productos en dólares.
    expect(await repreciarEnDolares(db, 1_571_00)).toMatchObject({
      mirados: 0,
      cambiados: 0,
    });
  });
});
