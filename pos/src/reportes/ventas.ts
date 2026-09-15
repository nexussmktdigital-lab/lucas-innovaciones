/**
 * Reportes de venta.
 *
 * Hasta acá los números del negocio vivían de a turno: el arqueo dice qué pasó
 * en ese turno y nada más. Para saber cómo viene el mes había que sumar cierres
 * a mano.
 *
 * Tres reglas que valen para todo lo de este archivo:
 *
 *  - **Una venta anulada no existe.** Anular no inserta una venta negativa:
 *    marca la original como `cancelled` (D29). Así que todo filtra por
 *    `estado = 'completed'` y no hay que restar nada en ninguna parte.
 *  - **Los límites del día son los del local**, no los de UTC. Una venta de las
 *    22:30 es del día que se hizo aunque en UTC ya sea mañana; eso lo resuelve
 *    `periodo.ts` y acá solo se usan los instantes que devuelve.
 *  - **Lo fiado se factura aunque no entre plata.** Una venta a cuenta
 *    corriente cuenta como venta; lo que no cuenta es como ingreso de caja. Las
 *    dos cosas se informan por separado, porque confundirlas es creer que
 *    entró plata que está en la libreta.
 */
import { sql } from 'drizzle-orm';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import type { MedioPago } from '@/ventas/carrito';
import { instante, type Periodo } from './periodo';

/**
 * Lo que se cobró de verdad por una línea de venta.
 *
 * El descuento global se guarda en la venta y **no baja a las líneas**: una
 * venta de cuatro vidrios de $5.000 con 10% de descuento tiene líneas que suman
 * $20.000 y un total de $18.000. Sumar las líneas sin corregir hace que la misma
 * pantalla diga «vendido $23.000» arriba y «$25.000» en el ranking de productos.
 *
 * Así que se reparte proporcionalmente. Cuando no hubo descuento global el
 * factor es 1 y la cuenta no cambia nada.
 */
const COBRADO_POR_LINEA = sql`ROUND(
  i.total_centavos::numeric * s.total_centavos / NULLIF(s.subtotal_centavos, 0)
)::bigint`;

export interface ResumenDeVentas {
  cantidadDeVentas: number;
  unidades: number;
  totalCentavos: number;
  /** Lo vendido a cuenta corriente: facturado, pero no entró plata. */
  fiadoCentavos: number;
  /** Total dividido por cantidad de ventas. Cero si no hubo ventas. */
  ticketPromedioCentavos: number;
  /** Cuántas ventas se anularon en el período. */
  anuladas: number;
}

/** Lo vendido en un período. */
export async function resumenDeVentas(
  db: BaseDatos,
  p: Periodo,
): Promise<ResumenDeVentas> {
  const [fila] = filasDe<{
    ventas: string | number;
    unidades: string | number;
    total: string | number;
    fiado: string | number;
    anuladas: string | number;
  }>(
    await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE s.estado = 'completed')                       AS ventas,
        COALESCE((
          SELECT SUM(i.cantidad)
            FROM sale_items i
            JOIN sales s2 ON s2.id = i.sale_id
           WHERE s2.estado = 'completed'
             AND s2.fecha >= ${instante(p.desde)} AND s2.fecha < ${instante(p.hasta)}
        ), 0)                                                                AS unidades,
        COALESCE(SUM(s.total_centavos) FILTER (WHERE s.estado = 'completed'), 0)  AS total,
        COALESCE(SUM(s.total_centavos) FILTER (
          WHERE s.estado = 'completed' AND s.tipo = 'fiado'
        ), 0)                                                                AS fiado,
        COUNT(*) FILTER (WHERE s.estado = 'cancelled')                       AS anuladas
      FROM sales s
      WHERE s.fecha >= ${instante(p.desde)} AND s.fecha < ${instante(p.hasta)}
    `),
  );

  const cantidadDeVentas = Number(fila?.ventas ?? 0);
  const totalCentavos = Number(fila?.total ?? 0);

  return {
    cantidadDeVentas,
    unidades: Number(fila?.unidades ?? 0),
    totalCentavos,
    fiadoCentavos: Number(fila?.fiado ?? 0),
    ticketPromedioCentavos:
      cantidadDeVentas === 0 ? 0 : Math.round(totalCentavos / cantidadDeVentas),
    anuladas: Number(fila?.anuladas ?? 0),
  };
}

export interface VentaPorMedio {
  medio: MedioPago;
  cantidad: number;
  totalCentavos: number;
}

/**
 * Lo cobrado por cada medio de pago, **neto de vuelto**.
 *
 * La primera versión de esto sumaba el bruto de los renglones de pago, y en la
 * auditoría quedó a la vista lo que eso produce: una venta de $5.000 pagada con
 * un billete de $10.000 hacía figurar «Efectivo $10.000». Con dos ventas así, la
 * pantalla decía *vendido $23.000* arriba y *efectivo $30.000* abajo. Es el
 * mismo error que el hallazgo 22, ya corregido en el arqueo y reintroducido acá.
 *
 * El vuelto se resta **una vez por venta y no una por renglón de pago**: si
 * alguien paga con dos billetes cargados por separado, restarlo dos veces deja
 * el número en rojo. La cuenta corriente queda afuera porque no es plata que
 * entró, sino deuda; lo fiado se informa por su cuenta en el resumen.
 *
 * Lo que sí no incluye, y el arqueo sí, son los cobros de deudas viejas: esto
 * es un reporte de **ventas** del período, no del movimiento del cajón.
 */
export async function ventasPorMedio(db: BaseDatos, p: Periodo): Promise<VentaPorMedio[]> {
  const filas = filasDe<{ medio: MedioPago; cantidad: string | number; total: string | number }>(
    await db.execute(sql`
      WITH vueltos AS (
        SELECT s.id,
               GREATEST(
                 COALESCE((
                   SELECT SUM(pg.monto_centavos) FROM sale_payments pg WHERE pg.sale_id = s.id
                 ), 0) - s.total_centavos,
                 0
               ) AS vuelto
          FROM sales s
         WHERE s.estado = 'completed'
           AND s.fecha >= ${instante(p.desde)} AND s.fecha < ${instante(p.hasta)}
      ),
      pagos AS (
        SELECT pg.sale_id,
               pg.medio::text         AS medio,
               count(*)               AS cantidad,
               SUM(pg.monto_centavos) AS bruto
          FROM sale_payments pg
          JOIN sales s ON s.id = pg.sale_id
         WHERE s.estado = 'completed'
           AND pg.medio <> 'cuenta_corriente'
           AND s.fecha >= ${instante(p.desde)} AND s.fecha < ${instante(p.hasta)}
         GROUP BY pg.sale_id, pg.medio
      )
      SELECT g.medio,
             SUM(g.cantidad) AS cantidad,
             SUM(
               g.bruto - CASE WHEN g.medio = 'efectivo'
                              THEN COALESCE(v.vuelto, 0) ELSE 0 END
             ) AS total
        FROM pagos g
        LEFT JOIN vueltos v ON v.id = g.sale_id
       GROUP BY g.medio
       ORDER BY total DESC
    `),
  );

  return filas.map((f) => ({
    medio: f.medio,
    cantidad: Number(f.cantidad),
    totalCentavos: Number(f.total),
  }));
}

export interface ProductoVendido {
  productId: string;
  descripcion: string;
  categoria: string | null;
  unidades: number;
  totalCentavos: number;
  /** Cuántas ventas distintas lo incluyeron. */
  ventas: number;
}

/**
 * Qué se vendió, de lo que más facturó a lo que menos.
 *
 * Ordena por plata y no por unidades a propósito: veinte vidrios templados son
 * más unidades que un celular y mucha menos facturación, y lo que hay que
 * reponer primero es lo segundo.
 */
export async function productosVendidos(
  db: BaseDatos,
  p: Periodo,
  limite = 20,
): Promise<ProductoVendido[]> {
  const filas = filasDe<{
    product_id: string;
    descripcion: string;
    categoria: string | null;
    unidades: string | number;
    total: string | number;
    ventas: string | number;
  }>(
    await db.execute(sql`
      SELECT
        i.product_id,
        -- La descripción está congelada en la línea; si el producto ya no
        -- existe con ese nombre, el reporte sigue diciendo qué se vendió.
        MAX(i.descripcion)          AS descripcion,
        MAX(pr.categoria)           AS categoria,
        SUM(i.cantidad)             AS unidades,
        SUM(${COBRADO_POR_LINEA})   AS total,
        COUNT(DISTINCT i.sale_id)   AS ventas
      FROM sale_items i
      JOIN sales s ON s.id = i.sale_id
      LEFT JOIN products pr ON pr.id = i.product_id
      WHERE s.estado = 'completed'
        AND s.fecha >= ${instante(p.desde)} AND s.fecha < ${instante(p.hasta)}
      GROUP BY i.product_id
      ORDER BY total DESC
      LIMIT ${limite}
    `),
  );

  return filas.map((f) => ({
    productId: f.product_id,
    descripcion: f.descripcion,
    categoria: f.categoria,
    unidades: Number(f.unidades),
    totalCentavos: Number(f.total),
    ventas: Number(f.ventas),
  }));
}

export interface VentaPorCategoria {
  categoria: string;
  unidades: number;
  totalCentavos: number;
}

export async function ventasPorCategoria(
  db: BaseDatos,
  p: Periodo,
): Promise<VentaPorCategoria[]> {
  const filas = filasDe<{
    categoria: string | null;
    unidades: string | number;
    total: string | number;
  }>(
    await db.execute(sql`
      SELECT pr.categoria, SUM(i.cantidad) AS unidades, SUM(${COBRADO_POR_LINEA}) AS total
        FROM sale_items i
        JOIN sales s ON s.id = i.sale_id
        LEFT JOIN products pr ON pr.id = i.product_id
       WHERE s.estado = 'completed'
         AND s.fecha >= ${instante(p.desde)} AND s.fecha < ${instante(p.hasta)}
       GROUP BY pr.categoria
       ORDER BY total DESC
    `),
  );

  return filas.map((f) => ({
    categoria: f.categoria ?? 'Sin categoría',
    unidades: Number(f.unidades),
    totalCentavos: Number(f.total),
  }));
}

export interface DiaDeVentas {
  dia: string;
  totalCentavos: number;
  ventas: number;
}

/**
 * Lo vendido día por día.
 *
 * Los días sin ventas también vienen, en cero: un gráfico al que le faltan los
 * días flojos miente sobre la forma de la semana.
 */
export async function ventasPorDia(db: BaseDatos, p: Periodo): Promise<DiaDeVentas[]> {
  const filas = filasDe<{ dia: string; total: string | number; ventas: string | number }>(
    await db.execute(sql`
      SELECT
        to_char(dias.dia, 'YYYY-MM-DD')                        AS dia,
        COALESCE(SUM(s.total_centavos), 0)                     AS total,
        COUNT(s.id)                                            AS ventas
      FROM generate_series(
             ${instante(p.desde)}::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires',
             ${instante(p.hasta)}::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires' - interval '1 day',
             interval '1 day'
           ) AS dias(dia)
      LEFT JOIN sales s
             ON s.estado = 'completed'
            AND (s.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = dias.dia::date
      GROUP BY dias.dia
      ORDER BY dias.dia
    `),
  );

  return filas.map((f) => ({
    dia: f.dia,
    totalCentavos: Number(f.total),
    ventas: Number(f.ventas),
  }));
}

export interface MesDeVentas {
  mes: string;
  /** Lo que registró este POS. */
  posCentavos: number;
  /** Lo que registraba el sistema anterior, del histórico importado. */
  historicoCentavos: number;
  totalCentavos: number;
}

/**
 * Lo facturado mes a mes, juntando el histórico con lo de este POS.
 *
 * El sistema nuevo arrancó hace poco y el negocio no. Un reporte mensual que
 * empieza el día que se instaló el POS no sirve para comparar nada, así que se
 * suma el agregado que quedó del sistema anterior (`legacy_sales`) y se muestra
 * de dónde sale cada parte.
 */
export async function facturacionPorMes(db: BaseDatos, meses = 12): Promise<MesDeVentas[]> {
  const filas = filasDe<{ mes: string; pos: string | number; historico: string | number }>(
    await db.execute(sql`
      WITH limites AS (
        SELECT date_trunc(
                 'month',
                 (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
               ) - make_interval(months => ${meses - 1}) AS inicio
      ),
      meses AS (
        SELECT generate_series(
                 (SELECT inicio FROM limites),
                 date_trunc('month', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')),
                 interval '1 month'
               ) AS mes
      ),
      del_pos AS (
        SELECT date_trunc('month', s.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires') AS mes,
               SUM(s.total_centavos) AS total
          FROM sales s
         WHERE s.estado = 'completed'
         GROUP BY 1
      ),
      del_historico AS (
        SELECT date_trunc('month', l.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires') AS mes,
               SUM(l.total_centavos) AS total
          FROM legacy_sales l
         GROUP BY 1
      )
      SELECT to_char(m.mes, 'YYYY-MM')        AS mes,
             COALESCE(p.total, 0)             AS pos,
             COALESCE(h.total, 0)             AS historico
        FROM meses m
        LEFT JOIN del_pos p        ON p.mes = m.mes
        LEFT JOIN del_historico h  ON h.mes = m.mes
       ORDER BY m.mes
    `),
  );

  return filas.map((f) => {
    const posCentavos = Number(f.pos);
    const historicoCentavos = Number(f.historico);
    return {
      mes: f.mes,
      posCentavos,
      historicoCentavos,
      totalCentavos: posCentavos + historicoCentavos,
    };
  });
}

export interface Rentabilidad {
  /** Lo vendido de lo que sí tiene costo cargado. */
  ventaConCostoCentavos: number;
  costoCentavos: number;
  gananciaCentavos: number;
  /** Margen sobre la venta, en puntos básicos. 3500 = 35%. */
  margenBp: number | null;
  /** Unidades con costo, sobre el total de unidades vendidas. */
  unidadesConCosto: number;
  unidadesTotales: number;
}

/**
 * Cuánto quedó, de lo que se puede saber.
 *
 * El costo se congela en cada línea de venta al confirmarla, así que una venta
 * vieja no cambia de margen porque hoy el proveedor cobre otra cosa. Pero el
 * costo solo está en los productos a los que alguien se lo cargó, y de
 * WooCommerce no viene: por eso el reporte informa **sobre cuántas unidades**
 * está hablando. Un margen calculado sobre el 8% del movimiento y presentado
 * como «el margen del mes» es peor que no tener el número.
 */
export async function rentabilidad(db: BaseDatos, p: Periodo): Promise<Rentabilidad> {
  const [fila] = filasDe<{
    venta: string | number;
    costo: string | number;
    con_costo: string | number;
    total_unidades: string | number;
  }>(
    await db.execute(sql`
      SELECT
        COALESCE(SUM(${COBRADO_POR_LINEA}) FILTER (WHERE i.costo_centavos IS NOT NULL), 0) AS venta,
        COALESCE(SUM(i.costo_centavos * i.cantidad), 0)                                AS costo,
        COALESCE(SUM(i.cantidad) FILTER (WHERE i.costo_centavos IS NOT NULL), 0)       AS con_costo,
        COALESCE(SUM(i.cantidad), 0)                                                   AS total_unidades
      FROM sale_items i
      JOIN sales s ON s.id = i.sale_id
      WHERE s.estado = 'completed'
        AND s.fecha >= ${instante(p.desde)} AND s.fecha < ${instante(p.hasta)}
    `),
  );

  const ventaConCostoCentavos = Number(fila?.venta ?? 0);
  const costoCentavos = Number(fila?.costo ?? 0);
  const gananciaCentavos = ventaConCostoCentavos - costoCentavos;

  return {
    ventaConCostoCentavos,
    costoCentavos,
    gananciaCentavos,
    margenBp:
      ventaConCostoCentavos === 0
        ? null
        : Math.round((gananciaCentavos / ventaConCostoCentavos) * 10_000),
    unidadesConCosto: Number(fila?.con_costo ?? 0),
    unidadesTotales: Number(fila?.total_unidades ?? 0),
  };
}

export interface GastoDelPeriodo {
  categoria: string;
  totalCentavos: number;
  cantidad: number;
}

/**
 * Lo gastado en el período, por categoría.
 *
 * Solo lo pagado: un gasto pendiente es una factura que llegó, no plata que
 * salió. Lo anulado no cuenta, igual que una venta anulada.
 */
export async function gastosPorCategoria(
  db: BaseDatos,
  p: Periodo,
): Promise<GastoDelPeriodo[]> {
  const filas = filasDe<{
    categoria: string;
    total: string | number;
    cantidad: string | number;
  }>(
    await db.execute(sql`
      SELECT c.nombre AS categoria, SUM(g.monto_centavos) AS total, COUNT(*) AS cantidad
        FROM expenses g
        JOIN expense_categories c ON c.id = g.category_id
       WHERE g.estado = 'pagado'
         AND g.fecha >= (${instante(p.desde)}::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
         AND g.fecha <  (${instante(p.hasta)}::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
       GROUP BY c.nombre
       ORDER BY total DESC
    `),
  );

  return filas.map((f) => ({
    categoria: f.categoria,
    totalCentavos: Number(f.total),
    cantidad: Number(f.cantidad),
  }));
}

export interface VendedorDelPeriodo {
  usuarioId: string;
  nombre: string;
  ventas: number;
  totalCentavos: number;
}

export async function ventasPorVendedor(
  db: BaseDatos,
  p: Periodo,
): Promise<VendedorDelPeriodo[]> {
  const filas = filasDe<{
    id: string;
    nombre: string;
    ventas: string | number;
    total: string | number;
  }>(
    await db.execute(sql`
      SELECT u.id, u.nombre, COUNT(*) AS ventas, SUM(s.total_centavos) AS total
        FROM sales s
        JOIN users u ON u.id = s.vendedor_id
       WHERE s.estado = 'completed'
         AND s.fecha >= ${instante(p.desde)} AND s.fecha < ${instante(p.hasta)}
       GROUP BY u.id, u.nombre
       ORDER BY total DESC
    `),
  );

  return filas.map((f) => ({
    usuarioId: f.id,
    nombre: f.nombre,
    ventas: Number(f.ventas),
    totalCentavos: Number(f.total),
  }));
}
