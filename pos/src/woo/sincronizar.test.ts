/**
 * Sincronizacion contra un WooCommerce simulado.
 *
 * No hace falta el sitio real: se simula `fetch` con fichas calcadas de las que
 * devuelve la API, incluidas las sucias que tiene el catalogo de produccion.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { products, productVariants } from '@/db/schema';
import { ClienteWoo } from './cliente';
import { sincronizarCatalogo } from './sincronizar';

const TC = 157_100;

const CATALOGO = [
  {
    id: 6485,
    name: 'Vidrio templado 9D | glass 9d',
    type: 'variable',
    status: 'publish',
    sku: '531',
    price: '5000',
    manage_stock: true,
    stock_quantity: 53,
    categories: [{ name: 'Vidrios templados e hidrogel' }],
    brands: [],
    images: [{ src: 'https://ejemplo/vidrio.jpg' }],
    meta_data: [],
  },
  {
    id: 7001,
    name: 'iPhone 14 Pro 256GB',
    type: 'simple',
    status: 'publish',
    sku: 'IP14P256',
    price: '2152000',
    manage_stock: true,
    stock_quantity: 1,
    categories: [{ name: 'Smartphones nuevos' }],
    brands: [{ name: 'Apple' }],
    images: [{ src: 'https://ejemplo/iphone.jpg' }],
    meta_data: [{ key: '_li_precio_usd', value: '1370' }],
  },
  {
    id: 6378,
    name: 'Atma cup cake maker CM8910E',
    type: 'simple',
    status: 'publish',
    sku: '314',
    price: '1',
    manage_stock: true,
    stock_quantity: 1,
    categories: [{ name: 'Cocina' }],
    brands: [{ name: 'Atma' }],
    images: [],
    meta_data: [],
  },
];

const VARIACIONES = [
  {
    id: 8801,
    sku: 'VID-IP14',
    price: '5000',
    stock_quantity: 12,
    status: 'publish',
    attributes: [{ name: 'Modelo', option: 'iPhone 14' }],
  },
  {
    id: 8802,
    sku: 'VID-A55',
    price: '5000',
    stock_quantity: 7,
    status: 'publish',
    attributes: [{ name: 'Modelo', option: 'Samsung A55' }],
  },
];

/** `fetch` simulado que responde como WooCommerce, con sus headers de paginado. */
function wooSimulado(catalogo: unknown[] = CATALOGO): typeof fetch {
  return (async (entrada: string | URL) => {
    const url = new URL(String(entrada));
    const cuerpo = url.pathname.includes('/variations') ? VARIACIONES : catalogo;
    return new Response(JSON.stringify(cuerpo), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-wp-totalpages': '1',
        'x-wp-total': String(cuerpo.length),
      },
    });
  }) as unknown as typeof fetch;
}

function clienteDePrueba(catalogo?: unknown[]) {
  return new ClienteWoo({
    url: 'https://ejemplo.test/staging',
    consumerKey: 'ck_test',
    consumerSecret: 'cs_test',
    fetchImpl: wooSimulado(catalogo),
    reintentos: 1,
  });
}

let db: TestDb;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);
});

describe('sincronizarCatalogo', () => {
  it('trae el catalogo y deja el espejo listo para buscar', async () => {
    const informe = await sincronizarCatalogo(db, clienteDePrueba(), { tcCentavos: TC });

    expect(informe.leidos).toBe(3);
    expect(informe.creados).toBe(3);
    expect(informe.actualizados).toBe(0);
    expect(informe.variantes).toBe(2);

    const filas = await db.select().from(products);
    expect(filas).toHaveLength(3);

    const iphone = filas.find((f) => f.wooId === 7001)!;
    expect(iphone.moneda).toBe('USD');
    expect(iphone.precioUsdCentavos).toBe(137_000);
    expect(iphone.precioCentavos).toBe(215_200_000);
    expect(iphone.marca).toBe('Apple');
  });

  it('guarda las variaciones de los productos variables', async () => {
    await sincronizarCatalogo(db, clienteDePrueba(), { tcCentavos: TC });
    const vidrio = (await db.select().from(products).where(eq(products.wooId, 6485)))[0]!;
    const vs = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, vidrio.id));
    expect(vs.map((v) => v.nombre).sort()).toEqual(['Samsung A55', 'iPhone 14']);
  });

  it('informa la calidad de carga del catalogo', async () => {
    const informe = await sincronizarCatalogo(db, clienteDePrueba(), { tcCentavos: TC });
    expect(informe.resumen['sin_precio']).toBe(1); // el Atma a $1
    expect(informe.resumen['sin_imagen']).toBe(1);
    expect(informe.avisos.find((a) => a.tipo === 'sin_precio')?.wooId).toBe(6378);
  });

  it('correrla dos veces actualiza en vez de duplicar', async () => {
    await sincronizarCatalogo(db, clienteDePrueba(), { tcCentavos: TC });

    const conCambio = structuredClone(CATALOGO);
    conCambio[1]!.price = '2200000';
    conCambio[1]!.stock_quantity = 4;

    const segundo = await sincronizarCatalogo(db, clienteDePrueba(conCambio), { tcCentavos: TC });
    expect(segundo.creados).toBe(0);
    expect(segundo.actualizados).toBe(3);

    const filas = await db.select().from(products);
    expect(filas).toHaveLength(3);
    const iphone = filas.find((f) => f.wooId === 7001)!;
    expect(iphone.precioCentavos).toBe(220_000_000);
    expect(iphone.stock).toBe(4);
  });

  it('no pisa el costo ni el stock comprometido, que son del POS', async () => {
    await sincronizarCatalogo(db, clienteDePrueba(), { tcCentavos: TC });
    await db
      .update(products)
      .set({ costoCentavos: 180_000_000, stockComprometido: 1 })
      .where(eq(products.wooId, 7001));

    await sincronizarCatalogo(db, clienteDePrueba(), { tcCentavos: TC });

    const iphone = (await db.select().from(products).where(eq(products.wooId, 7001)))[0]!;
    expect(iphone.costoCentavos).toBe(180_000_000);
    expect(iphone.stockComprometido).toBe(1);
  });

  it('descarta la ficha rota y sigue con el resto en vez de abortar', async () => {
    const conBasura = [...CATALOGO, { name: 'Ficha sin id' }];
    const informe = await sincronizarCatalogo(db, clienteDePrueba(conBasura), { tcCentavos: TC });
    expect(informe.leidos).toBe(3);
  });

  it('una ficha sin `type` se descarta, no se asume simple', async () => {
    // Si se asumiera, una respuesta rara de la tienda aplanaría el catálogo y
    // se llevaría puestas todas las variaciones sin que nadie se entere.
    const sinTipo = structuredClone(CATALOGO).map((p) => {
      const copia: Record<string, unknown> = { ...p };
      delete copia.type;
      return copia;
    });
    const informe = await sincronizarCatalogo(db, clienteDePrueba(sinTipo), { tcCentavos: TC });
    expect(informe.leidos).toBe(0);
    expect(await db.select().from(products)).toHaveLength(0);
  });
});

describe('un producto que dejó de ser variable', () => {
  it('pierde sus variaciones, que si no se siguen vendiendo congeladas', async () => {
    await sincronizarCatalogo(db, clienteDePrueba(), { tcCentavos: TC });
    expect(await db.select().from(productVariants)).toHaveLength(2);

    // Lo mismo que hizo Lucas en la tienda: aplanar el vidrio a producto simple.
    const aplanado = structuredClone(CATALOGO);
    aplanado[0]!.type = 'simple';

    const informe = await sincronizarCatalogo(db, clienteDePrueba(aplanado), { tcCentavos: TC });

    expect(informe.variantesDesactivadas).toBe(2);
    const vs = await db.select().from(productVariants);
    // Siguen en la base, porque una venta vieja puede nombrarlas.
    expect(vs).toHaveLength(2);
    expect(vs.every((v) => v.activo === false)).toBe(true);
  });

  it('mientras siga siendo variable no se le toca ninguna', async () => {
    await sincronizarCatalogo(db, clienteDePrueba(), { tcCentavos: TC });
    const informe = await sincronizarCatalogo(db, clienteDePrueba(), { tcCentavos: TC });

    expect(informe.variantesDesactivadas).toBe(0);
    const vs = await db.select().from(productVariants);
    expect(vs.every((v) => v.activo === true)).toBe(true);
  });

  it('el refresco incremental también las da de baja: no depende de una ausencia', async () => {
    await sincronizarCatalogo(db, clienteDePrueba(), { tcCentavos: TC });

    const aplanado = structuredClone(CATALOGO);
    aplanado[0]!.type = 'simple';

    const informe = await sincronizarCatalogo(db, clienteDePrueba([aplanado[0]!]), {
      tcCentavos: TC,
      modificadoDesde: new Date(Date.now() - 3_600_000),
    });

    expect(informe.variantesDesactivadas).toBe(2);
  });
});

describe('lo que se borró de la tienda', () => {
  /*
   * Acá el catálogo de prueba es grande a propósito.
   *
   * El techo del 20% es una proporción, así que con tres fichas cualquier baja
   * lo pasa: sacar una sola ya es el 33%. Con cuarenta, sacar una es el 2,5% —el
   * orden de magnitud del caso real, donde faltaban catorce de ochocientas— y el
   * techo se puede probar de verdad sacando treinta.
   */
  const CUARENTA = [
    CATALOGO[0]!, // el vidrio, que es el variable y tiene variaciones
    ...Array.from({ length: 39 }, (_, i) => ({
      id: 9000 + i,
      name: `Accesorio de prueba ${i}`,
      type: 'simple',
      status: 'publish',
      sku: `ACC${i}`,
      price: '25000',
      manage_stock: true,
      stock_quantity: 3,
      categories: [{ name: 'Accesorios' }],
      brands: [],
      images: [{ src: 'https://ejemplo/acc.jpg' }],
      meta_data: [],
    })),
  ];

  const sin = (...ids: number[]) => CUARENTA.filter((p) => !ids.includes(p.id));

  async function catalogoInicial() {
    await sincronizarCatalogo(db, clienteDePrueba(CUARENTA), { tcCentavos: TC });
  }

  it('un producto que ya no está en Woo se desactiva, no se borra', async () => {
    await catalogoInicial();

    const informe = await sincronizarCatalogo(db, clienteDePrueba(sin(9000)), {
      tcCentavos: TC,
      desactivarAusentes: true,
    });

    expect(informe.desactivados).toBe(1);
    const [ido] = await db.select().from(products).where(eq(products.wooId, 9000));
    // Sigue en la base —las ventas viejas lo nombran— pero ya no se vende.
    expect(ido).toBeDefined();
    expect(ido!.activo).toBe(false);
  });

  it('y sus variaciones se van con él, que es lo que el mostrador ve', async () => {
    await catalogoInicial();
    expect(await db.select().from(productVariants)).toHaveLength(2);

    await sincronizarCatalogo(db, clienteDePrueba(sin(6485)), {
      tcCentavos: TC,
      desactivarAusentes: true,
    });

    const vs = await db.select().from(productVariants);
    expect(vs).toHaveLength(2);
    expect(vs.every((v) => v.activo === false)).toBe(true);
  });

  it('sin pedirlo no se toca nada: el comportamiento viejo sigue igual', async () => {
    await catalogoInicial();
    const informe = await sincronizarCatalogo(db, clienteDePrueba(sin(9000)), { tcCentavos: TC });

    expect(informe.desactivados).toBe(0);
    const activos = await db.select().from(products).where(eq(products.activo, true));
    expect(activos).toHaveLength(40);
  });

  it('una corrida incremental nunca da de baja: la ausencia ahí no significa nada', async () => {
    await catalogoInicial();

    // Woo devuelve solo el que cambió. Los otros no están «ausentes»:
    // simplemente no se tocaron desde la marca de agua.
    const informe = await sincronizarCatalogo(db, clienteDePrueba([CUARENTA[1]!]), {
      tcCentavos: TC,
      desactivarAusentes: true,
      modificadoDesde: new Date(Date.now() - 3_600_000),
    });

    expect(informe.desactivados).toBe(0);
    const activos = await db.select().from(products).where(eq(products.activo, true));
    expect(activos).toHaveLength(40);
  });

  it('una corrida cortada por tiempo tampoco: lo que faltó no está borrado', async () => {
    await catalogoInicial();
    const informe = await sincronizarCatalogo(db, clienteDePrueba(CUARENTA), {
      tcCentavos: TC,
      desactivarAusentes: true,
      limiteMs: -1,
    });

    expect(informe.incompleto).toBe(true);
    expect(informe.desactivados).toBe(0);
  });

  it('si faltara media tienda no da de baja nada y explica por qué', async () => {
    await catalogoInicial();

    const treintaMenos = CUARENTA.slice(0, 10);
    const informe = await sincronizarCatalogo(db, clienteDePrueba(treintaMenos), {
      tcCentavos: TC,
      desactivarAusentes: true,
    });

    expect(informe.desactivados).toBe(0);
    expect(informe.bajasOmitidas).toMatch(/30 de 40/);
    const activos = await db.select().from(products).where(eq(products.activo, true));
    expect(activos).toHaveLength(40);
  });

  it('un producto nacido en el POS, todavía sin publicar, no se da de baja', async () => {
    await catalogoInicial();
    await db.insert(products).values({
      nombre: 'Funda cargada a mano en el mostrador',
      precioCentavos: 1_500_000,
      moneda: 'ARS',
    });

    const informe = await sincronizarCatalogo(db, clienteDePrueba(sin(9000)), {
      tcCentavos: TC,
      desactivarAusentes: true,
    });

    expect(informe.desactivados).toBe(1);
    const [propio] = await db
      .select()
      .from(products)
      .where(eq(products.nombre, 'Funda cargada a mano en el mostrador'));
    expect(propio!.activo).toBe(true);
  });
});

describe('ClienteWoo', () => {
  it('reintenta ante un 500 y sale adelante', async () => {
    let llamadas = 0;
    const cliente = new ClienteWoo({
      url: 'https://ejemplo.test',
      consumerKey: 'ck',
      consumerSecret: 'cs',
      reintentos: 3,
      timeoutMs: 1000,
      fetchImpl: (async () => {
        llamadas += 1;
        if (llamadas < 2) return new Response('boom', { status: 500 });
        return new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-wp-totalpages': '1', 'x-wp-total': '0' },
        });
      }) as unknown as typeof fetch,
    });

    const r = await cliente.verificar();
    expect(r.ok).toBe(true);
    expect(llamadas).toBe(2);
  });

  it('no reintenta ante un 401: la credencial esta mal y no se arregla insistiendo', async () => {
    let llamadas = 0;
    const cliente = new ClienteWoo({
      url: 'https://ejemplo.test',
      consumerKey: 'ck',
      consumerSecret: 'mal',
      reintentos: 3,
      fetchImpl: (async () => {
        llamadas += 1;
        return new Response('{"code":"woocommerce_rest_authentication_error"}', { status: 401 });
      }) as unknown as typeof fetch,
    });

    await expect(cliente.verificar()).rejects.toThrow(/401/);
    expect(llamadas).toBe(1);
  });
});
