/**
 * Cambiar el recargo sin mover los precios del mostrador.
 *
 * Lo único que importa acá es una sola cosa, y se prueba en todas las formas
 * que se pueda: **después del cambio, el local cobra lo mismo que antes**. El
 * 21/10 el recargo pasó de 0 a 15% y el mostrador empezó a cobrar 13% menos,
 * dos días, en cada venta. Este archivo existe para que eso no vuelva a pasar
 * sin que falle algo.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { auditLog, products, syncQueue, users } from '@/db/schema';
import { guardarRecargoDeTienda, recargoDeTienda } from './config';
import { precioDeMostrador } from './mostrador';
import { calcularRebase } from './rebase';

let db: TestDb;
let duenio: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);
  const [u] = await db.insert(users).values({ nombre: 'Lucas', rol: 'owner' }).returning();
  duenio = u!.id;
});

async function producto(parcial: Partial<typeof products.$inferInsert> = {}) {
  const [p] = await db
    .insert(products)
    .values({
      wooId: 7001,
      nombre: 'Cargador 20W',
      precioCentavos: 20_000_00,
      stock: 4,
      gestionaStock: true,
      ...parcial,
    })
    .returning();
  return p!;
}

/** Lo que cobraría el mostrador por ese producto con el recargo que esté puesto. */
async function mostradorDe(id: string): Promise<number> {
  const [p] = await db.select().from(products).where(eq(products.id, id));
  return precioDeMostrador(
    {
      precioCentavos: p!.precioCentavos,
      precioLocalCentavos: p!.precioLocalCentavos,
      soloMostrador: p!.soloMostrador,
      enDolares: p!.moneda === 'USD',
    },
    await recargoDeTienda(db),
  );
}

describe('subir el recargo manteniendo el mostrador', () => {
  it('el local cobra lo mismo y el que sube es el precio de la web', async () => {
    const p = await producto({ precioCentavos: 20_000_00 });
    expect(await mostradorDe(p.id)).toBe(20_000_00);

    await guardarRecargoDeTienda(db, { bp: 1500, usuarioId: duenio, mantenerMostrador: true });

    expect(await mostradorDe(p.id)).toBe(20_000_00);
    const [despues] = await db.select().from(products).where(eq(products.id, p.id));
    expect(despues!.precioCentavos).toBe(23_000_00);
  });

  /*
   * El error del 21/10, tal cual pasó, para que quede escrito qué hace la
   * opción apagada: nada en la web, 13% menos en el mostrador.
   */
  it('sin la opción, subir el recargo baja el precio del mostrador', async () => {
    const p = await producto({ precioCentavos: 20_000_00 });

    await guardarRecargoDeTienda(db, { bp: 1500, usuarioId: duenio });

    const [despues] = await db.select().from(products).where(eq(products.id, p.id));
    expect(despues!.precioCentavos).toBe(20_000_00); // la web no se movió
    expect(await mostradorDe(p.id)).toBe(17_400_00); // el mostrador sí
  });

  it('bajar el recargo también mantiene el mostrador', async () => {
    const p = await producto({ precioCentavos: 23_000_00 });
    await guardarRecargoDeTienda(db, { bp: 1500, usuarioId: duenio });
    expect(await mostradorDe(p.id)).toBe(20_000_00);

    await guardarRecargoDeTienda(db, { bp: 0, usuarioId: duenio, mantenerMostrador: true });

    expect(await mostradorDe(p.id)).toBe(20_000_00);
    const [despues] = await db.select().from(products).where(eq(products.id, p.id));
    expect(despues!.precioCentavos).toBe(20_000_00);
  });

  it('manda el precio nuevo a la tienda, o la web sigue cobrando el viejo', async () => {
    const p = await producto();

    await guardarRecargoDeTienda(db, { bp: 1500, usuarioId: duenio, mantenerMostrador: true });

    const cola = await db.select().from(syncQueue);
    expect(cola).toHaveLength(1);
    expect(cola[0]!.operacion).toBe('precio.empujar');
    expect(cola[0]!.payload).toMatchObject({ productId: p.id, wooId: 7001 });
  });

  it('un producto que no está en la tienda no se encola, pero sí se reajusta', async () => {
    const p = await producto({ wooId: null });

    await guardarRecargoDeTienda(db, { bp: 1500, usuarioId: duenio, mantenerMostrador: true });

    expect(await db.select().from(syncQueue)).toHaveLength(0);
    const [despues] = await db.select().from(products).where(eq(products.id, p.id));
    expect(despues!.precioCentavos).toBe(23_000_00);
  });

  it('deja en la bitácora los precios de antes, que es lo que permite volver', async () => {
    const p = await producto();

    await guardarRecargoDeTienda(db, { bp: 1500, usuarioId: duenio, mantenerMostrador: true });

    const [entrada] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.accion, 'precios.rebase_recargo'));
    expect(entrada!.valorAnterior).toMatchObject({ bp: 0, precios: [[p.id, 20_000_00]] });
    expect(entrada!.valorNuevo).toMatchObject({ bp: 1500, productos: 1 });
  });
});

describe('a quiénes no les toca el precio', () => {
  /*
   * Los tres grupos que quedan afuera. En los tres se mira lo mismo: que el
   * precio guardado no se haya movido ni un centavo.
   */
  it('los de solo mostrador: su precio ya es el del local', async () => {
    const p = await producto({ soloMostrador: true, precioCentavos: 7_050_00 });

    await guardarRecargoDeTienda(db, { bp: 1500, usuarioId: duenio, mantenerMostrador: true });

    const [despues] = await db.select().from(products).where(eq(products.id, p.id));
    expect(despues!.precioCentavos).toBe(7_050_00);
    expect(await mostradorDe(p.id)).toBe(7_050_00);
  });

  it('los que están en dólares: el precio lo reescribe la cotización', async () => {
    const p = await producto({
      nombre: 'iPhone 16 Pro',
      moneda: 'USD',
      precioUsdCentavos: 82_000,
      precioCentavos: 1_280_000_00,
    });

    await guardarRecargoDeTienda(db, { bp: 1500, usuarioId: duenio, mantenerMostrador: true });

    const [despues] = await db.select().from(products).where(eq(products.id, p.id));
    expect(despues!.precioCentavos).toBe(1_280_000_00);
    expect(await mostradorDe(p.id)).toBe(1_280_000_00);
  });

  it('los que tienen precio de mostrador propio: ese campo ya fija el del local', async () => {
    const p = await producto({ precioCentavos: 20_000_00, precioLocalCentavos: 18_000_00 });

    await guardarRecargoDeTienda(db, { bp: 1500, usuarioId: duenio, mantenerMostrador: true });

    const [despues] = await db.select().from(products).where(eq(products.id, p.id));
    expect(despues!.precioCentavos).toBe(20_000_00);
    expect(await mostradorDe(p.id)).toBe(18_000_00);
  });

  it('los dados de baja: no se venden por ningún lado', async () => {
    const p = await producto({ activo: false, precioCentavos: 20_000_00 });

    await guardarRecargoDeTienda(db, { bp: 1500, usuarioId: duenio, mantenerMostrador: true });

    const [despues] = await db.select().from(products).where(eq(products.id, p.id));
    expect(despues!.precioCentavos).toBe(20_000_00);
  });
});

describe('la vista previa', () => {
  it('dice lo mismo que después se aplica', async () => {
    await producto({ nombre: 'Uno', precioCentavos: 20_000_00 });
    await producto({ nombre: 'Dos', precioCentavos: 35_500_00, wooId: 7002 });

    const previa = await calcularRebase(db, 0, 1500);
    expect(previa).toHaveLength(2);

    await guardarRecargoDeTienda(db, { bp: 1500, usuarioId: duenio, mantenerMostrador: true });

    for (const c of previa) {
      const [p] = await db.select().from(products).where(eq(products.id, c.id));
      expect(p!.precioCentavos).toBe(c.despuesCentavos);
    }
  });

  it('no escribe nada', async () => {
    const p = await producto();
    await calcularRebase(db, 0, 1500);

    const [igual] = await db.select().from(products).where(eq(products.id, p.id));
    expect(igual!.precioCentavos).toBe(20_000_00);
    expect(await db.select().from(syncQueue)).toHaveLength(0);
  });

  it('con el mismo recargo no hay nada para cambiar', async () => {
    await producto();
    expect(await calcularRebase(db, 1500, 1500)).toEqual([]);
  });
});

describe('ida y vuelta', () => {
  /*
   * El redondeo a cien pesos no se deshace solo: ir y volver puede correr un
   * precio hasta $100. Lo que no puede es correrlo más que eso ni acumular.
   */
  it('volver al recargo anterior deja el mostrador donde estaba, salvo el redondeo', async () => {
    const precios = [1_999_00, 13_333_00, 50_000_00, 410_700_00];
    const ids: string[] = [];
    for (const precio of precios) {
      const p = await producto({ nombre: `P${precio}`, precioCentavos: precio, wooId: null });
      ids.push(p.id);
    }
    const antes = await Promise.all(ids.map(mostradorDe));

    await guardarRecargoDeTienda(db, { bp: 1500, usuarioId: duenio, mantenerMostrador: true });
    await guardarRecargoDeTienda(db, { bp: 0, usuarioId: duenio, mantenerMostrador: true });

    const despues = await Promise.all(ids.map(mostradorDe));
    for (let i = 0; i < antes.length; i++) {
      expect(Math.abs(despues[i]! - antes[i]!)).toBeLessThanOrEqual(100_00);
    }
  });
});
