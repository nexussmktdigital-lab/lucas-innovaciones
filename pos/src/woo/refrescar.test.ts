/**
 * El refresco programado del catálogo, contra un WooCommerce simulado.
 *
 * Lo que se prueba acá no es el mapeo de las fichas —eso ya lo cubre
 * `sincronizar.test.ts`— sino la marca de agua: desde cuándo se piden los
 * cambios, cuándo avanza y, sobre todo, cuándo **no** avanza. Un refresco que
 * adelanta la marca sobre una corrida cortada se saltea un cambio de precio
 * para siempre, y eso en el mostrador es vender a un precio viejo.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { products, settings } from '@/db/schema';
import { ClienteWoo } from './cliente';
import { MARGEN_MS, refrescarCatalogo } from './refrescar';
import { sincronizarCatalogo } from './sincronizar';

const TC = 157_100;

const CATALOGO = [
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
    meta_data: [],
  },
  {
    id: 7002,
    name: 'Cargador 20W',
    type: 'simple',
    status: 'publish',
    sku: 'CG20',
    price: '18000',
    manage_stock: true,
    stock_quantity: 9,
    categories: [{ name: 'Accesorios' }],
    brands: [],
    images: [{ src: 'https://ejemplo/cargador.jpg' }],
    meta_data: [],
  },
];

/** Cliente simulado que además anota las URL que se le pidieron. */
function clienteEspia(catalogo: unknown[] = CATALOGO) {
  const pedidos: URL[] = [];
  const cliente = new ClienteWoo({
    url: 'https://ejemplo.test',
    consumerKey: 'ck_test',
    consumerSecret: 'cs_test',
    reintentos: 1,
    fetchImpl: (async (entrada: string | URL) => {
      const url = new URL(String(entrada));
      pedidos.push(url);
      return new Response(JSON.stringify(catalogo), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-wp-totalpages': '1',
          'x-wp-total': String(catalogo.length),
        },
      });
    }) as unknown as typeof fetch,
  });
  return { cliente, pedidos };
}

/** La marca de agua guardada, o null si todavía no hay. */
async function marcaGuardada(db: TestDb): Promise<Date | null> {
  const [fila] = await db
    .select({ valor: settings.valor })
    .from(settings)
    .where(eq(settings.clave, 'woo.ultimo_refresco'));
  const crudo = (fila?.valor as { instante?: string } | undefined)?.instante;
  return crudo ? new Date(crudo) : null;
}

let db: TestDb;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);
});

describe('refrescarCatalogo', () => {
  it('sin catálogo no corre y dice qué hacer', async () => {
    const { cliente, pedidos } = clienteEspia();
    const informe = await refrescarCatalogo(db, cliente, { tcCentavos: TC });

    expect(informe.corrio).toBe(false);
    expect(informe.motivo).toMatch(/woo:sync/);
    // Y no se le pidió nada a la tienda: no hay contra qué comparar.
    expect(pedidos).toHaveLength(0);
  });

  it('la primera vez arranca desde la última sincronización, con el margen', async () => {
    await sincronizarCatalogo(db, clienteEspia().cliente, { tcCentavos: TC });
    const [uno] = await db.select({ cuando: products.lastSyncedAt }).from(products).limit(1);
    const ultima = uno!.cuando!;

    const { cliente, pedidos } = clienteEspia();
    const informe = await refrescarCatalogo(db, cliente, { tcCentavos: TC });

    expect(informe.corrio).toBe(true);
    expect(informe.desde!.getTime()).toBe(ultima.getTime() - MARGEN_MS);

    // Y eso es lo que efectivamente viajó en la consulta.
    const pedido = pedidos[0]!;
    expect(pedido.searchParams.get('dates_are_gmt')).toBe('1');
    expect(pedido.searchParams.get('modified_after')).toBe(
      informe.desde!.toISOString().slice(0, 19),
    );
  });

  it('una corrida completa deja la marca en el arranque, no en el final', async () => {
    await sincronizarCatalogo(db, clienteEspia().cliente, { tcCentavos: TC });

    const antes = Date.now();
    const informe = await refrescarCatalogo(db, clienteEspia().cliente, { tcCentavos: TC });
    const despues = Date.now();

    expect(informe.sincronizacion!.incompleto).toBe(false);
    const marca = (await marcaGuardada(db))!;
    expect(marca.getTime()).toBeGreaterThanOrEqual(antes);
    expect(marca.getTime()).toBeLessThanOrEqual(despues);
  });

  it('la segunda corrida pide desde la marca, no desde el catálogo', async () => {
    await sincronizarCatalogo(db, clienteEspia().cliente, { tcCentavos: TC });
    await refrescarCatalogo(db, clienteEspia().cliente, { tcCentavos: TC });
    const marca = (await marcaGuardada(db))!;

    const { cliente, pedidos } = clienteEspia();
    const informe = await refrescarCatalogo(db, cliente, { tcCentavos: TC });

    expect(informe.desde!.getTime()).toBe(marca.getTime() - MARGEN_MS);
    expect(pedidos[0]!.searchParams.get('modified_after')).toBe(
      informe.desde!.toISOString().slice(0, 19),
    );
  });

  it('si se corta por tiempo la marca NO avanza: lo que faltó se vuelve a pedir', async () => {
    await sincronizarCatalogo(db, clienteEspia().cliente, { tcCentavos: TC });
    await refrescarCatalogo(db, clienteEspia().cliente, { tcCentavos: TC });
    const marca = (await marcaGuardada(db))!;

    const informe = await refrescarCatalogo(db, clienteEspia().cliente, {
      tcCentavos: TC,
      limiteMs: -1,
    });

    expect(informe.sincronizacion!.incompleto).toBe(true);
    expect((await marcaGuardada(db))!.getTime()).toBe(marca.getTime());
  });

  it('trae el cambio de precio que hubo en la tienda', async () => {
    await sincronizarCatalogo(db, clienteEspia().cliente, { tcCentavos: TC });

    const conCambio = structuredClone(CATALOGO);
    conCambio[1]!.price = '25000';
    await refrescarCatalogo(db, clienteEspia(conCambio).cliente, { tcCentavos: TC });

    const [cargador] = await db.select().from(products).where(eq(products.wooId, 7002));
    expect(cargador!.precioCentavos).toBe(2_500_000);
  });
});
