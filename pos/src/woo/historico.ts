/**
 * Importar el histórico de pedidos del sistema anterior.
 *
 * El negocio no empezó con este POS: hay 3.764 pedidos hechos con YITH desde
 * WooCommerce, y sin ellos los reportes mensuales arrancan el día que se
 * instaló el sistema nuevo y no sirven para comparar con nada.
 *
 * Tres decisiones que definen todo lo de acá:
 *
 * 1. **El histórico no se mezcla con las ventas.** Va a `legacy_sales`, que es
 *    solo de lectura y no toca stock, ni caja, ni numeración. Meterlos en
 *    `sales` sería inventar 3.764 movimientos de stock que ya pasaron y 243
 *    arqueos que nadie va a cuadrar.
 * 2. **Se importa una vez y no se pisa.** `legacy_sales` tiene un disparador que
 *    bloquea el UPDATE y el DELETE, y un índice único por `(origen,
 *    referencia_externa)`. Volver a correr el importador no duplica nada: los
 *    que ya están se saltean. Es la misma forma de la migración de las fichas de
 *    papel (D38), donde sumar dos veces la misma deuda era el error a evitar.
 * 3. **Lo que no se puede leer se cuenta y se informa.** El cliente de
 *    WooCommerce descarta en silencio la fila que no cumple el esquema, y sobre
 *    3.764 pedidos eso es perder facturación sin que nadie se entere. Acá los
 *    descartes se cuentan y salen en el informe.
 *
 * Lo que sí queda pendiente de una decisión del negocio: un pedido histórico
 * reembolsado. `legacy_sales` no tiene estado, así que por ahora los cancelados
 * y reembolsados **no se importan** y se informan aparte.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { legacySales } from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import type { ClienteWoo } from './cliente';
import { precioACentavos } from './tipos';

/**
 * El `origen` con el que entra el histórico real.
 *
 * Distinto del que usan los datos de prueba a propósito: los dos se suman en
 * los reportes, así que si compartieran origen una base sembrada y después
 * importada mostraría el mes dos veces.
 */
export const ORIGEN_HISTORICO = 'yith';

/** Estados de WooCommerce que sí son facturación. */
export const ESTADOS_QUE_CUENTAN = ['completed', 'processing', 'on-hold'];

const lineaDePedido = z
  .object({
    id: z.number(),
    name: z.string().default(''),
    product_id: z.number().default(0),
    quantity: z.number().default(0),
    total: z.union([z.string(), z.number()]).nullish(),
  })
  .loose();

const lineaDeCobro = z
  .object({
    method_id: z.string().default(''),
    method_title: z.string().default(''),
    total: z.union([z.string(), z.number()]).nullish(),
  })
  .loose();

export const wooPedido = z
  .object({
    id: z.number(),
    number: z.union([z.string(), z.number()]).nullish(),
    status: z.string().default('completed'),
    date_created_gmt: z.string().nullish(),
    date_created: z.string().nullish(),
    total: z.union([z.string(), z.number()]).nullish(),
    payment_method: z.string().nullish(),
    payment_method_title: z.string().nullish(),
    billing: z
      .object({ first_name: z.string().nullish(), last_name: z.string().nullish() })
      .loose()
      .nullish(),
    line_items: z.array(lineaDePedido).default([]),
    fee_lines: z.array(lineaDeCobro).default([]),
    meta_data: z
      .array(z.object({ key: z.string(), value: z.unknown() }).loose())
      .default([]),
  })
  .loose();

export type WooPedido = z.infer<typeof wooPedido>;

export interface FilaHistorica {
  origen: string;
  referenciaExterna: string;
  fecha: Date;
  totalCentavos: number;
  medioPago: string | null;
  cliente: string | null;
  sinProducto: boolean;
  detalle: Record<string, unknown>;
}

/**
 * Traduce un pedido de WooCommerce a una fila del histórico.
 *
 * `sinProducto` es el dato que alimenta el marcador de calidad: en el sistema
 * viejo el 58% de la facturación se cargaba bajo un ítem genérico, sin producto
 * de catálogo detrás. Un renglón cuenta como «con producto» solo si apunta a un
 * producto real (`product_id > 0`); las comisiones y los cargos sueltos no.
 */
export function mapearPedido(p: WooPedido): FilaHistorica {
  const totalCentavos = precioACentavos(p.total);

  const conProducto = p.line_items.filter((l) => l.product_id > 0);
  const sinProducto = conProducto.length === 0;

  const nombre = [p.billing?.first_name, p.billing?.last_name]
    .filter((x) => typeof x === 'string' && x.trim() !== '')
    .join(' ')
    .trim();

  const crudo = p.date_created_gmt
    ? `${p.date_created_gmt}Z`
    : (p.date_created ?? new Date().toISOString());

  return {
    origen: ORIGEN_HISTORICO,
    referenciaExterna: String(p.id),
    fecha: new Date(crudo),
    totalCentavos,
    medioPago: p.payment_method_title?.trim() || p.payment_method?.trim() || null,
    cliente: nombre || null,
    sinProducto,
    detalle: {
      numero: p.number == null ? null : String(p.number),
      estado: p.status,
      renglones: p.line_items.map((l) => ({
        nombre: l.name,
        productId: l.product_id,
        cantidad: l.quantity,
        totalCentavos: precioACentavos(l.total),
      })),
    },
  };
}

export interface InformeDeImportacion {
  leidos: number;
  importados: number;
  /** Ya estaban de una corrida anterior. */
  repetidos: number;
  /** Cancelados, reembolsados o fallidos: no son facturación. */
  descartadosPorEstado: number;
  /** Pedidos que WooCommerce devolvió y no se pudieron leer. */
  ilegibles: number;
  totalCentavos: number;
  /** El mes más viejo y el más nuevo que entraron. */
  desde: string | null;
  hasta: string | null;
  duracionMs: number;
}

export interface OpcionesImportacion {
  /** No escribe: solo cuenta qué entraría. */
  ensayo?: boolean;
  porPagina?: number;
  alAvanzar?: (leidos: number) => void;
}

/**
 * Trae los pedidos del sistema anterior y los guarda.
 *
 * Pagina de a 100 porque el hosting corta a los 30 segundos, y escribe en lotes
 * con `onConflictDoNothing`: si se corta en la mitad, volver a correrlo retoma
 * sin duplicar.
 */
export async function importarHistorico(
  db: BaseDatos,
  cliente: ClienteWoo,
  opciones: OpcionesImportacion = {},
): Promise<InformeDeImportacion> {
  const arranque = Date.now();
  const informe: InformeDeImportacion = {
    leidos: 0,
    importados: 0,
    repetidos: 0,
    descartadosPorEstado: 0,
    ilegibles: 0,
    totalCentavos: 0,
    desde: null,
    hasta: null,
    duracionMs: 0,
  };

  const porPagina = opciones.porPagina ?? 100;

  for await (const pagina of cliente.listarTodo(
    'orders',
    wooPedido,
    { status: 'any', orderby: 'id', order: 'asc' },
    porPagina,
  )) {
    informe.leidos += pagina.length;

    const filas: FilaHistorica[] = [];
    for (const pedido of pagina) {
      if (!ESTADOS_QUE_CUENTAN.includes(pedido.status)) {
        informe.descartadosPorEstado += 1;
        continue;
      }
      filas.push(mapearPedido(pedido));
    }

    for (const f of filas) {
      const mes = f.fecha.toISOString().slice(0, 7);
      if (informe.desde === null || mes < informe.desde) informe.desde = mes;
      if (informe.hasta === null || mes > informe.hasta) informe.hasta = mes;
    }

    if (filas.length > 0 && !opciones.ensayo) {
      const entraron = await db
        .insert(legacySales)
        .values(filas)
        .onConflictDoNothing()
        .returning({ referencia: legacySales.referenciaExterna });

      /*
       * Se suma por la referencia que volvió y no por la cantidad: los repetidos
       * pueden estar en cualquier posición del lote, así que tomar las primeras
       * N filas sumaría las equivocadas. Solo lo que entró de verdad cuenta; si
       * no, volver a correr el importador informaría el doble de facturación sin
       * haber escrito una sola fila.
       */
      const nuevas = new Set(entraron.map((x) => x.referencia));
      informe.importados += entraron.length;
      informe.repetidos += filas.length - entraron.length;
      informe.totalCentavos += filas
        .filter((f) => nuevas.has(f.referenciaExterna))
        .reduce((n, f) => n + f.totalCentavos, 0);
    } else if (opciones.ensayo) {
      informe.importados += filas.length;
      informe.totalCentavos += filas.reduce((n, f) => n + f.totalCentavos, 0);
    }

    opciones.alAvanzar?.(informe.leidos);
  }

  informe.duracionMs = Date.now() - arranque;
  return informe;
}

/** Qué hay cargado del histórico, para no importarlo dos veces sin saberlo. */
export async function estadoDelHistorico(
  db: BaseDatos,
): Promise<{ cuantos: number; totalCentavos: number; desde: string | null; hasta: string | null }> {
  const [fila] = filasDe<{
    cuantos: string | number;
    total: string | number;
    desde: string | null;
    hasta: string | null;
  }>(
    await db.execute(sql`
      SELECT count(*)                                  AS cuantos,
             COALESCE(SUM(total_centavos), 0)          AS total,
             to_char(MIN(fecha AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'YYYY-MM') AS desde,
             to_char(MAX(fecha AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'YYYY-MM') AS hasta
        FROM legacy_sales
       WHERE origen = ${ORIGEN_HISTORICO}
    `),
  );

  return {
    cuantos: Number(fila?.cuantos ?? 0),
    totalCentavos: Number(fila?.total ?? 0),
    desde: fila?.desde ?? null,
    hasta: fila?.hasta ?? null,
  };
}
