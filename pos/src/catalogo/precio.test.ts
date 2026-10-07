/**
 * Corregir el precio de una ficha desde el mostrador.
 *
 * Lo que importa no es que el número cambie en la base: es que se cobre lo que
 * se escribió —el campo de precio propio pisa el cálculo y dejarlo puesto haría
 * que no se cobrara— y que la tienda se entere, porque si no la web sigue
 * cobrando el precio viejo y el próximo `woo:sync` devuelve la ficha atrás.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { auditLog, products, syncQueue, users } from '@/db/schema';
import { precioDeMostrador } from '@/precios/mostrador';
import { cambiarPrecio, ErrorPrecioFicha, TECHO_PRECIO_CENTAVOS } from './precio';

/** El recargo real de la tienda: 12%. */
const RECARGO = 1_200;

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

/** Un producto publicado en la tienda, con su id de Woo como los de verdad. */
async function producto(parcial: Partial<typeof products.$inferInsert> = {}) {
  const [p] = await db
    .insert(products)
    .values({
      wooId: 7001,
      nombre: 'Cargador 20W',
      precioCentavos: 11_200_00,
      stock: 4,
      gestionaStock: true,
      ...parcial,
    })
    .returning();
  return p!;
}

describe('cambiar el precio', () => {
  it('guarda el de tienda a partir del de mostrador, con el recargo sumado', async () => {
    const p = await producto();

    const r = await cambiarPrecio(db, {
      productId: p.id,
      mostradorCentavos: 15_000_00,
      recargoTiendaBp: RECARGO,
      usuarioId: duenio,
    });

    expect(r.tiendaCentavos).toBe(16_800_00);
    expect(r.mostradorCentavos).toBe(15_000_00);

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.precioCentavos).toBe(16_800_00);
  });

  it('deja la ficha en un precio que vuelve a dar lo que se escribió', async () => {
    // La prueba que importa de verdad: se escribe lo que se cobra, y lo que la
    // venta calcula después tiene que ser ese mismo número. Si la ida y la
    // vuelta no cierran, el cajero escribe 15.000 y cobra 14.900.
    const p = await producto();

    await cambiarPrecio(db, {
      productId: p.id,
      mostradorCentavos: 15_000_00,
      recargoTiendaBp: RECARGO,
      usuarioId: duenio,
    });

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(
      precioDeMostrador(
        {
          precioCentavos: enBase!.precioCentavos,
          precioLocalCentavos: enBase!.precioLocalCentavos,
          soloMostrador: enBase!.soloMostrador,
        },
        RECARGO,
      ),
    ).toBe(15_000_00);
  });

  it('limpia el precio de mostrador propio, que si no pisaría el nuevo', async () => {
    // Sin esto el cajero cambia el precio, ve que la venta sigue saliendo el
    // viejo y no entiende por qué: `precioLocalCentavos` gana siempre.
    const p = await producto({ precioLocalCentavos: 9_000_00 });

    await cambiarPrecio(db, {
      productId: p.id,
      mostradorCentavos: 15_000_00,
      recargoTiendaBp: RECARGO,
      usuarioId: duenio,
    });

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.precioLocalCentavos).toBeNull();
    expect(
      precioDeMostrador(
        {
          precioCentavos: enBase!.precioCentavos,
          precioLocalCentavos: enBase!.precioLocalCentavos,
          soloMostrador: enBase!.soloMostrador,
        },
        RECARGO,
      ),
    ).toBe(15_000_00);
  });

  it('en un producto que no se publica guarda el precio tal cual, sin recargo', async () => {
    const p = await producto({ wooId: null, soloMostrador: true, nombre: 'Cambio de módulo' });

    const r = await cambiarPrecio(db, {
      productId: p.id,
      mostradorCentavos: 40_000_00,
      recargoTiendaBp: RECARGO,
      usuarioId: duenio,
    });

    expect(r.tiendaCentavos).toBe(40_000_00);
    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.precioCentavos).toBe(40_000_00);
  });

  it('encola el empuje a la tienda, o la web seguiría cobrando el viejo', async () => {
    // Si esto no pasa, además de que la web cobra mal, el próximo `woo:sync`
    // pisa la ficha con el precio de Woo y el cambio se borra solo.
    const p = await producto({ wooId: 7001 });

    await cambiarPrecio(db, {
      productId: p.id,
      mostradorCentavos: 15_000_00,
      recargoTiendaBp: RECARGO,
      usuarioId: duenio,
    });

    const [enCola] = await db.select().from(syncQueue);
    expect(enCola!.operacion).toBe('precio.empujar');
    expect(enCola!.payload).toMatchObject({ productId: p.id, wooId: 7001 });
    expect(enCola!.estado).toBe('pendiente');
  });

  it('no encola nada si el producto todavía no está en la tienda', async () => {
    const p = await producto({ wooId: null, soloMostrador: true });

    await cambiarPrecio(db, {
      productId: p.id,
      mostradorCentavos: 15_000_00,
      recargoTiendaBp: RECARGO,
      usuarioId: duenio,
    });

    expect(await db.select().from(syncQueue)).toHaveLength(0);
  });

  it('dos cambios seguidos encolan dos operaciones, sin tragarse una a la otra', async () => {
    const p = await producto();

    await cambiarPrecio(db, {
      productId: p.id,
      mostradorCentavos: 15_000_00,
      recargoTiendaBp: RECARGO,
      usuarioId: duenio,
    });
    await cambiarPrecio(db, {
      productId: p.id,
      mostradorCentavos: 16_000_00,
      recargoTiendaBp: RECARGO,
      usuarioId: duenio,
    });

    expect(await db.select().from(syncQueue)).toHaveLength(2);
  });

  it('deja en la bitácora de dónde a dónde fue, y quién lo hizo', async () => {
    const p = await producto({ precioCentavos: 11_200_00 });

    await cambiarPrecio(db, {
      productId: p.id,
      mostradorCentavos: 15_000_00,
      recargoTiendaBp: RECARGO,
      usuarioId: duenio,
    });

    const [registro] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.accion, 'precio.cambiar'));

    expect(registro!.usuarioId).toBe(duenio);
    expect(registro!.entidadId).toBe(p.id);
    expect(registro!.valorAnterior).toMatchObject({ precioCentavos: 11_200_00 });
    expect(registro!.valorNuevo).toMatchObject({
      precioCentavos: 16_800_00,
      mostradorCentavos: 15_000_00,
    });
  });

  it('informa el precio de mostrador anterior, para poder compararlo', async () => {
    const p = await producto({ precioCentavos: 11_200_00 });

    const r = await cambiarPrecio(db, {
      productId: p.id,
      mostradorCentavos: 15_000_00,
      recargoTiendaBp: RECARGO,
      usuarioId: duenio,
    });

    expect(r.anteriorMostradorCentavos).toBe(10_000_00);
  });

  it('rechaza un precio en cero o negativo', async () => {
    const p = await producto();

    for (const malo of [0, -1, -5_000_00]) {
      await expect(
        cambiarPrecio(db, {
          productId: p.id,
          mostradorCentavos: malo,
          recargoTiendaBp: RECARGO,
          usuarioId: duenio,
        }),
      ).rejects.toThrow(ErrorPrecioFicha);
    }
  });

  it('rechaza el cero de más', async () => {
    const p = await producto();

    await expect(
      cambiarPrecio(db, {
        productId: p.id,
        mostradorCentavos: TECHO_PRECIO_CENTAVOS + 1,
        recargoTiendaBp: RECARGO,
        usuarioId: duenio,
      }),
    ).rejects.toMatchObject({ motivo: 'techo' });
  });

  it('avisa si el producto ya no está', async () => {
    await expect(
      cambiarPrecio(db, {
        productId: '00000000-0000-0000-0000-000000000000',
        mostradorCentavos: 15_000_00,
        recargoTiendaBp: RECARGO,
        usuarioId: duenio,
      }),
    ).rejects.toMatchObject({ motivo: 'no_existe' });
  });

  it('no deja la ficha tocada si el precio era inválido', async () => {
    const p = await producto({ precioCentavos: 11_200_00 });

    await expect(
      cambiarPrecio(db, {
        productId: p.id,
        mostradorCentavos: 0,
        recargoTiendaBp: RECARGO,
        usuarioId: duenio,
      }),
    ).rejects.toThrow();

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.precioCentavos).toBe(11_200_00);
    expect(await db.select().from(syncQueue)).toHaveLength(0);
  });

  describe('un precio en dólares', () => {
    /*
     * Es el caso del mostrador: compran un iPhone usado en dólares y hasta acá
     * la única forma de que la ficha quedara en dólares era que viniera así de
     * WooCommerce. El que se carga en el local salía en pesos del día, y al
     * otro día ya estaba mal.
     */
    const TC = 1_571_00;

    it('guarda los dólares y calcula los pesos con el dólar del día', async () => {
      const p = await producto({ precioCentavos: 11_200_00 });

      const r = await cambiarPrecio(db, {
        productId: p.id,
        mostradorCentavos: 630_00,
        moneda: 'USD',
        tcCentavos: TC,
        recargoTiendaBp: RECARGO,
        usuarioId: duenio,
      });

      expect(r.moneda).toBe('USD');
      expect(r.mostradorCentavos).toBe(630_00);

      const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
      expect(enBase!.moneda).toBe('USD');
      expect(enBase!.precioUsdCentavos).toBe(630_00);
      // El de pesos es el calculado, no el que estaba.
      expect(enBase!.precioCentavos).toBeGreaterThan(900_000_00);
    });

    it('sin cotización no se guarda: el precio en pesos saldría de la nada', async () => {
      const p = await producto({ precioCentavos: 11_200_00 });

      await expect(
        cambiarPrecio(db, {
          productId: p.id,
          mostradorCentavos: 630_00,
          moneda: 'USD',
          tcCentavos: null,
          recargoTiendaBp: RECARGO,
          usuarioId: duenio,
        }),
      ).rejects.toThrow(/cotización/i);

      const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
      expect(enBase!.precioCentavos).toBe(11_200_00);
      expect(enBase!.moneda).toBe('ARS');
    });

    it('volver a pesos limpia el precio en dólares', async () => {
      /*
       * Si quedara puesto, el repreciado de la cotización lo tomaría como un
       * producto en dólares y le pisaría el precio que se acaba de escribir.
       */
      const p = await producto({
        precioCentavos: 900_000_00,
        moneda: 'USD',
        precioUsdCentavos: 630_00,
      });

      await cambiarPrecio(db, {
        productId: p.id,
        mostradorCentavos: 15_000_00,
        moneda: 'ARS',
        recargoTiendaBp: RECARGO,
        usuarioId: duenio,
      });

      const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
      expect(enBase!.moneda).toBe('ARS');
      expect(enBase!.precioUsdCentavos).toBeNull();
    });

    it('el recargo de la tienda no se le suma: lo repreciaría la cotización', async () => {
      const p = await producto({ precioCentavos: 11_200_00 });

      await cambiarPrecio(db, {
        productId: p.id,
        mostradorCentavos: 100_00,
        moneda: 'USD',
        tcCentavos: TC,
        recargoTiendaBp: RECARGO,
        usuarioId: duenio,
      });

      const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
      // US$ 100 al dólar del fixture, sin el 12% encima.
      expect(enBase!.precioCentavos).toBeLessThan(160_000_00);
    });

    it('el techo también corre en dólares, convertido', async () => {
      const p = await producto({ precioCentavos: 11_200_00 });

      await expect(
        cambiarPrecio(db, {
          productId: p.id,
          // US$ 100.000 al dólar del fixture pasan el techo con holgura.
          mostradorCentavos: 100_000_00,
          moneda: 'USD',
          tcCentavos: TC,
          recargoTiendaBp: RECARGO,
          usuarioId: duenio,
        }),
      ).rejects.toMatchObject({ motivo: 'techo' });
    });

    it('la bitácora guarda en qué moneda y con qué dólar se escribió', async () => {
      const p = await producto({ precioCentavos: 11_200_00 });

      await cambiarPrecio(db, {
        productId: p.id,
        mostradorCentavos: 630_00,
        moneda: 'USD',
        tcCentavos: TC,
        recargoTiendaBp: RECARGO,
        usuarioId: duenio,
      });

      const [fila] = await db.select().from(auditLog);
      const nuevo = fila!.valorNuevo as { moneda: string; tcCentavos: number };
      expect(nuevo.moneda).toBe('USD');
      expect(nuevo.tcCentavos).toBe(TC);
    });
  });
});
