/**
 * Las planillas que salen del POS.
 *
 * Tres, y cada una responde a un pedido concreto que hoy se resuelve a mano:
 *
 *  - **Ventas**: una fila por venta. Es lo que se le manda al contador.
 *  - **Renglones**: una fila por producto vendido. Es con lo que se arma
 *    cualquier análisis que el POS no traiga hecho —qué se vendió con qué, a
 *    qué cliente, con qué margen— sin tener que pedir una pantalla nueva.
 *  - **Gastos**: lo que salió, con su categoría y su comprobante.
 *
 * Todas salen del mismo dialecto de `csv.ts`, que es el que abre bien en Excel
 * en castellano, y todas se arman en memoria: son cientos de filas por mes, no
 * millones, y una descarga que llega entera es mejor que una que se corta.
 */
import { sql } from 'drizzle-orm';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import { nombreDelMedio } from '@/ventas/ticket';
import type { MedioPago } from '@/ventas/carrito';
import { armarCsv, fechaParaPlanilla, montoParaPlanilla } from './csv';
import { instante, type Periodo } from './periodo';

export type QueExportar = 'ventas' | 'renglones' | 'gastos';

export const EXPORTABLES: { que: QueExportar; etiqueta: string; detalle: string }[] = [
  {
    que: 'ventas',
    etiqueta: 'Ventas',
    detalle: 'Una fila por venta: número, fecha, cliente, medios de pago y total.',
  },
  {
    que: 'renglones',
    etiqueta: 'Productos vendidos',
    detalle: 'Una fila por producto vendido, con cantidad, precio y costo.',
  },
  {
    que: 'gastos',
    etiqueta: 'Gastos',
    detalle:
      'Lo que salió en el período, con categoría, beneficiario y cuenta. Incluye lo pendiente de pago, marcado como tal.',
  },
];

export function esExportable(crudo: string | null): crudo is QueExportar {
  return EXPORTABLES.some((e) => e.que === crudo);
}

/**
 * Una fila por venta.
 *
 * Las anuladas van, marcadas como tales y con el motivo: al contador le
 * interesa ver que la venta existió y se anuló, y esconderlas haría que los
 * números del POS y los de la planilla no se puedan conciliar con los números
 * de ningún otro lado.
 */
async function csvDeVentas(db: BaseDatos, p: Periodo): Promise<string> {
  const filas = filasDe<{
    numero: string;
    fecha: Date;
    estado: string;
    tipo: string;
    canal: string;
    terminal: string;
    vendedor: string;
    cliente: string | null;
    medios: string | null;
    unidades: string | number;
    bruto: string | number;
    descuento: string | number;
    total: string | number;
    motivo_anulacion: string | null;
  }>(
    await db.execute(sql`
      SELECT
        s.numero, s.fecha, s.estado, s.tipo, s.canal, s.terminal,
        u.nombre                                                    AS vendedor,
        c.nombre                                                    AS cliente,
        (SELECT string_agg(DISTINCT pg.medio::text, ' + ')
           FROM sale_payments pg WHERE pg.sale_id = s.id)           AS medios,
        COALESCE((SELECT SUM(i.cantidad)
           FROM sale_items i WHERE i.sale_id = s.id), 0)            AS unidades,
        -- Bruto y no subtotal: el contador va a restar las tres columnas, y
        -- el subtotal ya viene neto de los descuentos de línea mientras que la
        -- columna de descuento los incluye, así que restarlas los contaba dos
        -- veces. Con el bruto, Bruto menos Descuento da Total siempre.
        (s.total_centavos + s.descuento_centavos) AS bruto,
        s.descuento_centavos AS descuento,
        s.total_centavos AS total,
        s.motivo_anulacion
      FROM sales s
      JOIN users u ON u.id = s.vendedor_id
      LEFT JOIN customers c ON c.id = s.cliente_id
      WHERE s.fecha >= ${instante(p.desde)} AND s.fecha < ${instante(p.hasta)}
      ORDER BY s.fecha
    `),
  );

  return armarCsv(
    [
      'Numero', 'Fecha', 'Hora', 'Estado', 'Tipo', 'Canal', 'Terminal',
      'Vendedor', 'Cliente', 'Medios de pago', 'Unidades',
      'Bruto', 'Descuento', 'Total', 'Motivo de anulacion',
    ],
    filas.map((f) => {
      const { fecha, hora } = fechaParaPlanilla(new Date(f.fecha));
      return [
        f.numero,
        fecha,
        hora,
        f.estado === 'cancelled' ? 'Anulada' : 'Completada',
        f.tipo === 'fiado' ? 'Fiado' : 'Contado',
        f.canal === 'web' ? 'Web' : 'Local',
        f.terminal,
        f.vendedor,
        f.cliente ?? '',
        (f.medios ?? '')
          .split(' + ')
          .filter(Boolean)
          .map((m) => nombreDelMedio(m as MedioPago))
          .join(' + '),
        Number(f.unidades),
        montoParaPlanilla(Number(f.bruto)),
        montoParaPlanilla(Number(f.descuento)),
        montoParaPlanilla(Number(f.total)),
        f.motivo_anulacion ?? '',
      ];
    }),
  );
}

/**
 * Una fila por producto vendido.
 *
 * Solo de ventas completadas: un renglón de una venta anulada no se vendió, y
 * en un análisis por producto sumaría unidades que nunca salieron del local.
 */
async function csvDeRenglones(db: BaseDatos, p: Periodo): Promise<string> {
  const filas = filasDe<{
    numero: string;
    fecha: Date;
    descripcion: string;
    sku: string | null;
    categoria: string | null;
    marca: string | null;
    cantidad: number;
    precio_unitario: string | number;
    descuento: string | number;
    costo: string | number | null;
    total: string | number;
    cliente: string | null;
    vendedor: string;
  }>(
    await db.execute(sql`
      SELECT
        s.numero, s.fecha,
        i.descripcion, i.cantidad,
        i.precio_unitario_centavos AS precio_unitario,
        i.descuento_centavos       AS descuento,
        i.costo_centavos           AS costo,
        -- Prorrateado: el descuento global vive en la venta y no baja a las
        -- líneas, así que sin esto la columna «Total» suma más que lo cobrado.
        ROUND(
          i.total_centavos::numeric * s.total_centavos / NULLIF(s.subtotal_centavos, 0)
        )::bigint                  AS total,
        pr.sku, pr.categoria, pr.marca,
        c.nombre AS cliente,
        u.nombre AS vendedor
      FROM sale_items i
      JOIN sales s ON s.id = i.sale_id
      JOIN users u ON u.id = s.vendedor_id
      LEFT JOIN products pr ON pr.id = i.product_id
      LEFT JOIN customers c ON c.id = s.cliente_id
      WHERE s.estado = 'completed'
        AND s.fecha >= ${instante(p.desde)} AND s.fecha < ${instante(p.hasta)}
      ORDER BY s.fecha, i.descripcion
    `),
  );

  return armarCsv(
    [
      'Venta', 'Fecha', 'Hora', 'SKU', 'Producto', 'Categoria', 'Marca',
      'Cantidad', 'Precio unitario', 'Descuento', 'Total',
      'Costo unitario', 'Ganancia', 'Cliente', 'Vendedor',
    ],
    filas.map((f) => {
      const { fecha, hora } = fechaParaPlanilla(new Date(f.fecha));
      const costo = f.costo === null ? null : Number(f.costo);
      const total = Number(f.total);
      // Sin costo cargado la ganancia queda vacía, no en cero: cero sería
      // decir que no se ganó nada, y lo que pasa es que no se sabe.
      const ganancia = costo === null ? null : total - costo * f.cantidad;

      return [
        f.numero,
        fecha,
        hora,
        f.sku ?? '',
        f.descripcion,
        f.categoria ?? '',
        f.marca ?? '',
        f.cantidad,
        montoParaPlanilla(Number(f.precio_unitario)),
        montoParaPlanilla(Number(f.descuento)),
        montoParaPlanilla(total),
        costo === null ? '' : montoParaPlanilla(costo),
        ganancia === null ? '' : montoParaPlanilla(ganancia),
        f.cliente ?? '',
        f.vendedor,
      ];
    }),
  );
}

/** Lo que salió, sin lo anulado. */
async function csvDeGastos(db: BaseDatos, p: Periodo): Promise<string> {
  const filas = filasDe<{
    fecha: string;
    categoria: string;
    beneficiario: string | null;
    descripcion: string;
    monto: string | number;
    estado: string;
    medio: string | null;
    cuenta: string | null;
    vencimiento: string | null;
    cargado_por: string;
    comprobante: string | null;
  }>(
    await db.execute(sql`
      SELECT
        to_char(g.fecha, 'DD/MM/YYYY')        AS fecha,
        cat.nombre                            AS categoria,
        b.nombre                              AS beneficiario,
        g.descripcion,
        g.monto_centavos                      AS monto,
        g.estado,
        g.medio::text                         AS medio,
        cu.nombre                             AS cuenta,
        to_char(g.vencimiento, 'DD/MM/YYYY')  AS vencimiento,
        u.nombre                              AS cargado_por,
        g.comprobante_url                     AS comprobante
      FROM expenses g
      JOIN expense_categories cat ON cat.id = g.category_id
      JOIN users u ON u.id = g.cargado_por_id
      LEFT JOIN payees b ON b.id = g.payee_id
      LEFT JOIN monetary_accounts cu ON cu.id = g.monetary_account_id
      WHERE g.estado <> 'anulado'
        AND g.fecha >= (${instante(p.desde)}::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        AND g.fecha <  (${instante(p.hasta)}::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
      ORDER BY g.fecha, cat.nombre
    `),
  );

  return armarCsv(
    [
      'Fecha', 'Categoria', 'Beneficiario', 'Descripcion', 'Monto',
      'Estado', 'Medio', 'Cuenta', 'Vencimiento', 'Cargado por', 'Comprobante',
    ],
    filas.map((f) => [
      f.fecha,
      f.categoria,
      f.beneficiario ?? '',
      f.descripcion,
      montoParaPlanilla(Number(f.monto)),
      f.estado === 'pagado' ? 'Pagado' : 'Pendiente',
      f.medio ? nombreDelMedio(f.medio as MedioPago) : '',
      f.cuenta ?? '',
      f.vencimiento ?? '',
      f.cargado_por,
      f.comprobante ?? '',
    ]),
  );
}

export async function exportar(
  db: BaseDatos,
  que: QueExportar,
  p: Periodo,
): Promise<string> {
  switch (que) {
    case 'ventas':
      return csvDeVentas(db, p);
    case 'renglones':
      return csvDeRenglones(db, p);
    case 'gastos':
      return csvDeGastos(db, p);
  }
}
