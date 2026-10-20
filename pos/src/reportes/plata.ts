/**
 * La plata del período: lo que se facturó, lo que entró y lo que salió.
 *
 * Hasta acá el reporte decía «vendido $20.000.000» y «gastos $12.000.000», y
 * restaba uno del otro. Esa resta es mentira en los dos extremos:
 *
 *  - **Lo facturado no es lo que entró.** Una venta fiada factura y no trae un
 *    peso: la plata llega en los meses que vienen, o no llega. Un canje
 *    tampoco trae plata: trae un teléfono. Contarlos como ingreso del mes es
 *    creer que está en la caja lo que está en la libreta y en la vitrina.
 *  - **Lo que entró no es solo lo que se vendió.** Los cobros de fiado viejo
 *    son plata de verdad que entra este mes, aunque la venta haya sido en
 *    marzo. El reporte de ventas los dejaba afuera, con razón —es un reporte
 *    de ventas—, y así nadie los veía en ninguna parte.
 *
 * Así que son dos cuentas distintas y acá se llevan separadas:
 *
 *     Facturado  = cobrado en el acto + fiado + canje
 *     Entró      = cobrado en el acto + cobros de fiado
 *
 * La primera mide el negocio; la segunda, la caja. La diferencia entre las dos
 * es exactamente lo que se fió y lo que se recibió en especie.
 *
 * **Todo en pesos.** Lo cobrado en dólares —billetes— se informa aparte y no
 * se suma: un total que mezcla dos monedas no es un total (D62).
 */
import { sql } from 'drizzle-orm';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import type { MedioPago } from '@/ventas/carrito';
import { instante, type Periodo } from './periodo';

/**
 * Los medios que facturan sin traer plata.
 *
 * La cuenta corriente es deuda del cliente; el canje es un teléfono que entró
 * al stock. Los dos suman al total de la venta y no mueven ninguna cuenta.
 */
export const MEDIOS_SIN_PLATA: readonly MedioPago[] = ['cuenta_corriente', 'canje'];

export interface MedioDeLoFacturado {
  medio: MedioPago;
  cantidad: number;
  totalCentavos: number;
  /** `false` en cuenta corriente y canje: facturan, pero no entra plata. */
  esPlata: boolean;
}

/**
 * Cómo se pagó lo que se facturó, **neto de vuelto**.
 *
 * La suma de esta tabla da exactamente lo facturado del período, y eso es a
 * propósito: es la única forma de que el desglose se pueda leer contra el
 * número de arriba sin que falte nada. Por eso incluye la cuenta corriente y
 * el canje, que la versión anterior escondía —quedaban afuera del desglose y
 * el lector tenía que creer que la diferencia era redondeo—.
 *
 * El vuelto se resta **una vez por venta y no una por renglón de pago**: si
 * alguien paga con dos billetes cargados por separado, restarlo dos veces deja
 * el número en rojo.
 */
export async function facturadoPorMedio(
  db: BaseDatos,
  p: Periodo,
): Promise<MedioDeLoFacturado[]> {
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
    esPlata: !MEDIOS_SIN_PLATA.includes(f.medio),
  }));
}

export interface CobroDeFiadoPorMedio {
  medio: MedioPago;
  cantidad: number;
  /** En pesos. Los cobros en billetes de dólar van en el campo de al lado. */
  totalCentavos: number;
  /** En centavos de dólar, cuando se cobró con billetes verdes. */
  totalUsdCentavos: number;
}

/**
 * Lo cobrado de deudas viejas, por medio de pago.
 *
 * Es plata que entra en el período aunque la venta sea de antes, y no estaba
 * en ningún reporte: el de ventas la deja afuera a propósito y el del turno
 * solo mira un turno.
 *
 * **Cuál de los dos montos es la plata** depende de con qué se pagó, no de en
 * qué moneda estaba la deuda. Una cuota de US$ 200 pagada por transferencia
 * cancela doscientos dólares de deuda y hace entrar pesos al banco; eso es lo
 * que guarda `monto_caja_centavos`. Pagada con billetes verdes, lo que entra
 * son dólares. Sumar las dos cosas en un solo número da un total que no es de
 * ninguna moneda.
 */
export async function cobrosDeFiadoPorMedio(
  db: BaseDatos,
  p: Periodo,
): Promise<CobroDeFiadoPorMedio[]> {
  const filas = filasDe<{
    medio: MedioPago;
    cantidad: string | number;
    pesos: string | number;
    dolares: string | number;
  }>(
    await db.execute(sql`
      SELECT c.medio::text AS medio,
             count(*)      AS cantidad,
             COALESCE(SUM(COALESCE(c.monto_caja_centavos, c.monto_centavos))
                      FILTER (WHERE c.medio <> 'dolares'), 0) AS pesos,
             COALESCE(SUM(COALESCE(c.monto_caja_centavos, c.monto_centavos))
                      FILTER (WHERE c.medio =  'dolares'), 0) AS dolares
        FROM credit_payments c
       WHERE c.fecha >= ${instante(p.desde)} AND c.fecha < ${instante(p.hasta)}
       GROUP BY c.medio
       ORDER BY 3 DESC, 4 DESC
    `),
  );

  return filas.map((f) => ({
    medio: f.medio,
    cantidad: Number(f.cantidad),
    totalCentavos: Number(f.pesos),
    totalUsdCentavos: Number(f.dolares),
  }));
}

export interface FlujoDelPeriodo {
  /** Lo vendido: la suma de los totales de las ventas del período. */
  facturadoCentavos: number;
  /** De eso, lo que se cobró en el acto con algo que es plata. */
  cobradoDeVentasCentavos: number;
  /** De eso, lo que quedó fiado. Es plata futura: todavía no entró. */
  fiadoCentavos: number;
  /** De eso, lo que se recibió en equipos. No es plata, es mercadería. */
  canjeCentavos: number;
  /** Cobros de deudas viejas, en pesos. Plata del período, venta de antes. */
  cobrosDeFiadoCentavos: number;
  /** Cobros de deudas cobrados con billetes verdes, en centavos de dólar. */
  cobrosDeFiadoUsdCentavos: number;
  /** La plata que de verdad entró: lo cobrado en el acto más lo del fiado. */
  entroCentavos: number;
  /** Gastos pagados en el período. Un pendiente no salió de ningún lado. */
  salioCentavos: number;
  /** Gastos que llegaron en el período y todavía no se pagaron. */
  aPagarCentavos: number;
  /** Lo que entró menos lo que salió. */
  quedoCentavos: number;
}

/**
 * Las dos cuentas del período, juntas: la del negocio y la de la caja.
 *
 * `facturado` sale del desglose por medio y no de la suma de los totales de
 * las ventas, que es la otra forma de calcularlo. Son el mismo número —la
 * suma de los pagos menos el vuelto es el total de la venta— y tomarlo del
 * desglose hace que la pantalla no pueda mostrar un total que sus propios
 * renglones no expliquen.
 */
export async function flujoDelPeriodo(db: BaseDatos, p: Periodo): Promise<FlujoDelPeriodo> {
  const [medios, cobros, gastos] = await Promise.all([
    facturadoPorMedio(db, p),
    cobrosDeFiadoPorMedio(db, p),
    salidasDelPeriodo(db, p),
  ]);

  const suma = (filas: { totalCentavos: number }[]) =>
    filas.reduce((n, f) => n + f.totalCentavos, 0);

  const cobradoDeVentasCentavos = suma(medios.filter((m) => m.esPlata));
  const fiadoCentavos = suma(medios.filter((m) => m.medio === 'cuenta_corriente'));
  const canjeCentavos = suma(medios.filter((m) => m.medio === 'canje'));
  const cobrosDeFiadoCentavos = suma(cobros);
  const entroCentavos = cobradoDeVentasCentavos + cobrosDeFiadoCentavos;

  return {
    facturadoCentavos: suma(medios),
    cobradoDeVentasCentavos,
    fiadoCentavos,
    canjeCentavos,
    cobrosDeFiadoCentavos,
    cobrosDeFiadoUsdCentavos: cobros.reduce((n, c) => n + c.totalUsdCentavos, 0),
    entroCentavos,
    salioCentavos: gastos.pagadoCentavos,
    aPagarCentavos: gastos.pendienteCentavos,
    quedoCentavos: entroCentavos - gastos.pagadoCentavos,
  };
}

/**
 * El día del gasto, en el calendario del local.
 *
 * `expenses.fecha` es un `date`, no un instante: el gasto es del día que
 * alguien escribió, no de la hora en que lo cargó. Comparar un `date` contra
 * un `timestamptz` lo convertiría a medianoche UTC, que en Argentina son las
 * nueve de la noche del día anterior: un gasto del día 1 se caería del mes.
 */
const DESDE = (p: Periodo) =>
  sql`(${instante(p.desde)}::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires')::date`;
const HASTA = (p: Periodo) =>
  sql`(${instante(p.hasta)}::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires')::date`;

/** Lo pagado y lo que quedó a pagar, en pesos. Lo anulado no cuenta. */
export async function salidasDelPeriodo(
  db: BaseDatos,
  p: Periodo,
): Promise<{ pagadoCentavos: number; pendienteCentavos: number }> {
  const [f] = filasDe<{ pagado: string | number; pendiente: string | number }>(
    await db.execute(sql`
      SELECT COALESCE(SUM(monto_centavos) FILTER (WHERE estado = 'pagado'), 0)    AS pagado,
             COALESCE(SUM(monto_centavos) FILTER (WHERE estado = 'pendiente'), 0) AS pendiente
        FROM expenses
       WHERE fecha >= ${DESDE(p)} AND fecha < ${HASTA(p)}
    `),
  );

  return {
    pagadoCentavos: Number(f?.pagado ?? 0),
    pendienteCentavos: Number(f?.pendiente ?? 0),
  };
}

export interface SalidaPorCuenta {
  cuenta: string;
  cantidad: number;
  totalCentavos: number;
}

/**
 * De dónde salió la plata de los gastos.
 *
 * «En qué se gastó» lo contesta la categoría; esto contesta la otra mitad, que
 * es con qué se pagó: cuánto salió del cajón, cuánto del banco y cuánto se
 * pagó con cheques. Son los números que se cruzan contra el resumen bancario.
 */
export async function gastosPorCuenta(db: BaseDatos, p: Periodo): Promise<SalidaPorCuenta[]> {
  const filas = filasDe<{ cuenta: string; cantidad: string | number; total: string | number }>(
    await db.execute(sql`
      SELECT COALESCE(m.nombre, 'Sin cuenta') AS cuenta,
             count(*)                         AS cantidad,
             SUM(g.monto_centavos)            AS total
        FROM expenses g
        LEFT JOIN monetary_accounts m ON m.id = g.monetary_account_id
       WHERE g.estado = 'pagado'
         AND g.fecha >= ${DESDE(p)} AND g.fecha < ${HASTA(p)}
       GROUP BY COALESCE(m.nombre, 'Sin cuenta')
       ORDER BY total DESC
    `),
  );

  return filas.map((f) => ({
    cuenta: f.cuenta,
    cantidad: Number(f.cantidad),
    totalCentavos: Number(f.total),
  }));
}

export interface GastoGrande {
  id: string;
  fecha: string;
  descripcion: string;
  categoria: string;
  beneficiario: string | null;
  /** Siempre en pesos: es lo que suma en el total del período. */
  totalCentavos: number;
  moneda: 'ARS' | 'USD';
  /** Solo en dólares: lo que de verdad salió. */
  montoUsdCentavos: number | null;
}

/**
 * Los gastos más grandes del período, uno por uno.
 *
 * El total por categoría dice «Compra a proveedores: $8.400.000» y ahí se
 * termina; la pregunta que sigue —a quién y por qué— no la contesta nadie, y
 * es la que se hace cualquiera que mire el número. Diez renglones alcanzan:
 * en un mes de gastos, los diez primeros suelen ser casi todo.
 */
export async function gastosMasGrandes(
  db: BaseDatos,
  p: Periodo,
  limite = 10,
): Promise<GastoGrande[]> {
  const filas = filasDe<{
    id: string;
    fecha: string;
    descripcion: string;
    categoria: string;
    beneficiario: string | null;
    total: string | number;
    moneda: 'ARS' | 'USD';
    usd: string | number | null;
  }>(
    await db.execute(sql`
      SELECT g.id, g.fecha, g.descripcion, c.nombre AS categoria, pa.nombre AS beneficiario,
             g.monto_centavos AS total, g.moneda::text AS moneda, g.monto_usd_centavos AS usd
        FROM expenses g
        JOIN expense_categories c ON c.id = g.category_id
        LEFT JOIN payees pa ON pa.id = g.payee_id
       WHERE g.estado = 'pagado'
         AND g.fecha >= ${DESDE(p)} AND g.fecha < ${HASTA(p)}
       ORDER BY g.monto_centavos DESC, g.fecha DESC
       LIMIT ${limite}
    `),
  );

  return filas.map((f) => ({
    id: String(f.id),
    fecha: String(f.fecha),
    descripcion: String(f.descripcion),
    categoria: String(f.categoria),
    beneficiario: f.beneficiario,
    totalCentavos: Number(f.total),
    moneda: f.moneda,
    montoUsdCentavos: f.usd === null ? null : Number(f.usd),
  }));
}
