/**
 * Tests del importador del histórico.
 *
 * El cliente de WooCommerce es de mentira: devuelve páginas de pedidos armadas
 * acá. No hay credenciales de la tienda real en este entorno, así que lo que se
 * prueba es el mapeo, la paginación y —sobre todo— que correrlo dos veces no
 * duplique la facturación, que es el error a evitar en cualquier migración (D38).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { legacySales } from '@/db/schema';
import { ClienteWoo } from './cliente';
import {
  ESTADOS_QUE_CUENTAN,
  estadoDelHistorico,
  importarHistorico,
  mapearPedido,
  ORIGEN_HISTORICO,
  type WooPedido,
} from './historico';
import { facturacionPorMes } from '@/reportes/ventas';
import { marcadorDeProductoReal } from '@/catalogo/calidad';

let db: TestDb;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);
});

function pedido(parcial: Partial<WooPedido> = {}): WooPedido {
  return {
    id: 1,
    number: '1',
    status: 'completed',
    date_created_gmt: '2026-05-15T18:00:00',
    total: '12000.00',
    payment_method: 'yith_pos_cash_gateway',
    payment_method_title: 'Efectivo',
    billing: { first_name: '', last_name: '' },
    line_items: [
      { id: 1, name: 'Vidrio templado', product_id: 531, quantity: 2, total: '12000.00' },
    ],
    fee_lines: [],
    meta_data: [],
    ...parcial,
  } as WooPedido;
}

/**
 * Un cliente que no sale a la red: devuelve las páginas que se le indiquen.
 *
 * Se arma sobre el `ClienteWoo` real, con su propio `fetch`, para que la
 * paginación y el parseo sean los de producción y no una imitación.
 */
function clienteDeMentira(paginas: WooPedido[][]) {
  let llamadas = 0;

  const cliente = new ClienteWoo({
    url: 'https://ejemplo.test',
    consumerKey: 'ck',
    consumerSecret: 'cs',
    reintentos: 1,
    fetchImpl: (async (url: URL) => {
      const pagina = Number(new URL(url).searchParams.get('page') ?? '1');
      llamadas += 1;
      const datos = paginas[pagina - 1] ?? [];
      return new Response(JSON.stringify(datos), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-wp-totalpages': String(paginas.length),
          'x-wp-total': String(paginas.flat().length),
        },
      });
    }) as unknown as typeof fetch,
  });

  return { cliente, cuantasLlamadas: () => llamadas };
}

describe('traducir un pedido', () => {
  it('lleva el total, la fecha, el medio y el número original', () => {
    const f = mapearPedido(pedido({ id: 4821, number: '4821' }));

    expect(f.origen).toBe(ORIGEN_HISTORICO);
    expect(f.referenciaExterna).toBe('4821');
    expect(f.totalCentavos).toBe(12_000_00);
    expect(f.medioPago).toBe('Efectivo');
    expect(f.fecha.toISOString()).toBe('2026-05-15T18:00:00.000Z');
    expect((f.detalle as { numero: string }).numero).toBe('4821');
  });

  /*
   * El dato que alimenta el marcador de calidad: en el sistema viejo el 58% de
   * la facturación se cargaba bajo un ítem genérico, sin producto detrás.
   */
  it('marca como «sin producto» el pedido cargado a mano', () => {
    const conProducto = mapearPedido(pedido());
    expect(conProducto.sinProducto).toBe(false);

    const generico = mapearPedido(
      pedido({
        line_items: [{ id: 1, name: 'Servicio', product_id: 0, quantity: 1, total: '5000.00' }],
      }),
    );
    expect(generico.sinProducto).toBe(true);

    const vacio = mapearPedido(pedido({ line_items: [] }));
    expect(vacio.sinProducto).toBe(true);
  });

  /* El histórico son 3.764 pedidos de invitado: casi ninguno tiene nombre. */
  it('sin nombre de cliente queda en nulo, no en cadena vacía', () => {
    expect(mapearPedido(pedido()).cliente).toBeNull();
    expect(
      mapearPedido(pedido({ billing: { first_name: 'Gaby', last_name: 'Pérez' } })).cliente,
    ).toBe('Gaby Pérez');
  });

  it('el título del medio de pago gana sobre el identificador técnico', () => {
    expect(
      mapearPedido(pedido({ payment_method_title: '', payment_method: 'bacs' })).medioPago,
    ).toBe('bacs');
  });
});

describe('importar', () => {
  it('trae todas las páginas y las guarda', async () => {
    const { cliente, cuantasLlamadas } = clienteDeMentira([
      [pedido({ id: 1 }), pedido({ id: 2 })],
      [pedido({ id: 3 })],
    ]);

    const r = await importarHistorico(db, cliente, { porPagina: 2 });

    expect(r.leidos).toBe(3);
    expect(r.importados).toBe(3);
    expect(r.totalCentavos).toBe(36_000_00);
    expect(cuantasLlamadas()).toBe(2);

    expect(await db.select().from(legacySales)).toHaveLength(3);
  });

  /* Sumar dos veces la misma facturación es el error a evitar (D38). */
  it('correrlo dos veces no duplica nada ni infla el total', async () => {
    const paginas = [[pedido({ id: 1 }), pedido({ id: 2 })]];

    const primera = await importarHistorico(db, clienteDeMentira(paginas).cliente);
    expect(primera.importados).toBe(2);
    expect(primera.totalCentavos).toBe(24_000_00);

    const segunda = await importarHistorico(db, clienteDeMentira(paginas).cliente);
    expect(segunda.importados).toBe(0);
    expect(segunda.repetidos).toBe(2);
    // Lo importante: la segunda corrida no informa facturación que no escribió.
    expect(segunda.totalCentavos).toBe(0);

    expect(await db.select().from(legacySales)).toHaveLength(2);
  });

  /*
   * Los repetidos pueden estar en cualquier posición del lote: contar por
   * cantidad en vez de por referencia sumaría los pedidos equivocados.
   */
  it('en un lote a medias, suma solo lo que entró de verdad', async () => {
    await importarHistorico(db, clienteDeMentira([[pedido({ id: 2, total: '99999.00' })]]).cliente);

    const r = await importarHistorico(
      db,
      clienteDeMentira([
        [pedido({ id: 1, total: '1000.00' }), pedido({ id: 2, total: '99999.00' }), pedido({ id: 3, total: '2000.00' })],
      ]).cliente,
    );

    expect(r.importados).toBe(2);
    expect(r.repetidos).toBe(1);
    expect(r.totalCentavos).toBe(3_000_00);
  });

  it('lo cancelado y lo reembolsado no es facturación', async () => {
    const { cliente } = clienteDeMentira([
      [
        pedido({ id: 1, status: 'completed' }),
        pedido({ id: 2, status: 'cancelled' }),
        pedido({ id: 3, status: 'refunded' }),
        pedido({ id: 4, status: 'processing' }),
      ],
    ]);

    const r = await importarHistorico(db, cliente);
    expect(r.importados).toBe(2);
    expect(r.descartadosPorEstado).toBe(2);
    expect(ESTADOS_QUE_CUENTAN).toContain('processing');
  });

  it('el ensayo no escribe nada', async () => {
    const { cliente } = clienteDeMentira([[pedido({ id: 1 }), pedido({ id: 2 })]]);

    const r = await importarHistorico(db, cliente, { ensayo: true });
    expect(r.importados).toBe(2);
    expect(await db.select().from(legacySales)).toHaveLength(0);
  });

  it('informa desde qué mes y hasta cuál', async () => {
    const { cliente } = clienteDeMentira([
      [
        pedido({ id: 1, date_created_gmt: '2025-11-02T14:00:00' }),
        pedido({ id: 2, date_created_gmt: '2026-07-20T14:00:00' }),
      ],
    ]);

    const r = await importarHistorico(db, cliente);
    expect(r.desde).toBe('2025-11');
    expect(r.hasta).toBe('2026-07');
  });

  it('una tienda sin pedidos no rompe', async () => {
    const r = await importarHistorico(db, clienteDeMentira([[]]).cliente);
    expect(r.leidos).toBe(0);
    expect(r.importados).toBe(0);
  });
});

describe('qué hay cargado', () => {
  it('dice cuántos y de qué período', async () => {
    expect((await estadoDelHistorico(db)).cuantos).toBe(0);

    await importarHistorico(
      db,
      clienteDeMentira([
        [
          pedido({ id: 1, date_created_gmt: '2025-11-02T14:00:00' }),
          pedido({ id: 2, date_created_gmt: '2026-07-20T14:00:00' }),
        ],
      ]).cliente,
    );

    const e = await estadoDelHistorico(db);
    expect(e.cuantos).toBe(2);
    expect(e.totalCentavos).toBe(24_000_00);
    expect(e.desde).toBe('2025-11');
    expect(e.hasta).toBe('2026-07');
  });
});

describe('lo importado llega a los reportes', () => {
  /* Sin esto, el reporte mensual arranca el día que se instaló el POS. */
  it('la facturación mes a mes muestra el histórico', async () => {
    const hoy = new Date();
    const haceDosMeses = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 15, 15);

    await importarHistorico(
      db,
      clienteDeMentira([
        [pedido({ id: 1, date_created_gmt: haceDosMeses.toISOString().slice(0, 19) })],
      ]).cliente,
    );

    const meses = await facturacionPorMes(db, 12);
    const conHistorico = meses.find((m) => m.historicoCentavos > 0);
    expect(conHistorico?.historicoCentavos).toBe(12_000_00);
  });

  it('el marcador de producto real usa lo que vino sin producto', async () => {
    await importarHistorico(
      db,
      clienteDeMentira([
        [
          pedido({ id: 1, total: '10000.00' }),
          pedido({
            id: 2,
            total: '10000.00',
            line_items: [{ id: 9, name: 'Varios', product_id: 0, quantity: 1, total: '10000.00' }],
          }),
        ],
      ]).cliente,
    );

    const marcador = await marcadorDeProductoReal(db);
    const mes = marcador.find((m) => m.origen === 'legacy')!;
    // La mitad de la facturación tenía producto detrás.
    expect(mes.porcentaje).toBe(50);
  });
});

describe('lo que WooCommerce devuelve mal', () => {
  /*
   * El cliente descarta en silencio la fila que no cumple el esquema. Sobre
   * 3.764 pedidos eso es perder facturación sin que nadie se entere, así que el
   * importador tiene que notarlo.
   */
  it('un pedido ilegible se descarta y la cuenta no cierra', async () => {
    const { cliente } = clienteDeMentira([
      [pedido({ id: 1 }), { noEsUnPedido: true } as unknown as WooPedido],
    ]);

    const r = await importarHistorico(db, cliente);

    expect(r.importados).toBe(1);
    // `leidos` cuenta lo que se pudo parsear; la tienda dijo que había dos.
    expect(r.leidos).toBe(1);
  });

  it('el esquema acepta un pedido con campos de más', () => {
    const conExtras = pedido({ id: 7 }) as WooPedido & { algo_nuevo: string };
    conExtras.algo_nuevo = 'de una versión futura de Woo';
    expect(() => mapearPedido(conExtras)).not.toThrow();
  });
});
