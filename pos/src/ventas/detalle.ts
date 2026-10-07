/**
 * La ficha de una venta: todo lo que pasó, en un solo lugar.
 *
 * La lista de Ventas muestra una línea por venta y el comprobante muestra lo
 * que el cliente se lleva. Entre las dos faltaba lo de adentro: con qué se
 * pagó, cuánto costó cada renglón, qué quedó fiado y en qué cuotas, y si algo
 * se devolvió después. Es lo que se mira cuando el cliente vuelve y hay que
 * reconstruir una venta de hace dos días.
 *
 * **Acá sí van los medios de pago.** En el comprobante no, a propósito: ese es
 * el papel del cliente. Esta pantalla es de adentro.
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  cashSessions,
  creditPlans,
  customers,
  installments,
  returns,
  saleItems,
  salePayments,
  sales,
  users,
} from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import { aFechaISO } from '@/fiado/plan';

export interface RenglonDeVenta {
  /** Congelada al vender: si mañana cambia el nombre del producto, esto no. */
  descripcion: string;
  cantidad: number;
  precioUnitarioCentavos: number;
  descuentoCentavos: number;
  totalCentavos: number;
  monedaOriginal: 'ARS' | 'USD';
  precioUsdCentavos: number | null;
}

export interface PagoDeVenta {
  medio: string;
  montoCentavos: number;
  /** Solo `dolares`: los billetes que entraron, en centavos de dólar. */
  montoUsdCentavos: number | null;
  cotizacionCentavos: number | null;
  marcaTarjeta: string | null;
  cuotas: number | null;
}

export interface CuotaDeVenta {
  numero: number;
  vencimiento: string;
  montoCentavos: number;
  pagadoCentavos: number;
}

export interface DevolucionDeVenta {
  numero: string;
  fecha: Date;
  motivo: string;
  totalCentavos: number;
  devueltoCentavos: number;
  descontadoDeDeudaCentavos: number;
}

export interface DetalleDeVenta {
  id: string;
  numero: string;
  fecha: Date;
  tipo: 'contado' | 'fiado';
  estado: 'completed' | 'cancelled';
  motivoAnulacion: string | null;
  subtotalCentavos: number;
  descuentoCentavos: number;
  totalCentavos: number;
  tcAplicadoCentavos: number | null;
  nota: string | null;
  vendedor: string | null;
  clienteId: string | null;
  cliente: string | null;
  documento: string | null;
  telefono: string | null;
  terminal: string;
  /** El turno en el que se cobró, y si sigue abierto. */
  cashSessionId: string | null;
  turnoAbierto: boolean;
  turnoAbiertoEn: Date | null;
  /** True si se cobró sin conexión y entró después (D56). */
  offline: boolean;
  offlineCapturadaEn: Date | null;
  offlineDesvioCentavos: number;
  renglones: RenglonDeVenta[];
  pagos: PagoDeVenta[];
  /** La moneda del plan de cuotas, si hay plan. */
  monedaDelPlan: 'ARS' | 'USD' | null;
  /** Lo que se cobró por financiar, en la moneda del plan. Cero es lo normal. */
  recargoDelPlanCentavos: number;
  cuotas: CuotaDeVenta[];
  devoluciones: DevolucionDeVenta[];
}

/** La ficha completa, o `null` si no existe esa venta. */
export async function detalleDeVenta(
  db: BaseDatos,
  ventaId: string,
): Promise<DetalleDeVenta | null> {
  const [venta] = await db
    .select({
      id: sales.id,
      numero: sales.numero,
      fecha: sales.fecha,
      tipo: sales.tipo,
      estado: sales.estado,
      motivoAnulacion: sales.motivoAnulacion,
      subtotalCentavos: sales.subtotalCentavos,
      descuentoCentavos: sales.descuentoCentavos,
      totalCentavos: sales.totalCentavos,
      tcAplicadoCentavos: sales.tcAplicadoCentavos,
      nota: sales.nota,
      terminal: sales.terminal,
      cashSessionId: sales.cashSessionId,
      offline: sales.offline,
      offlineCapturadaEn: sales.offlineCapturadaEn,
      offlineDesvioCentavos: sales.offlineDesvioCentavos,
      vendedor: users.nombre,
      clienteId: sales.clienteId,
      cliente: customers.nombre,
      documento: customers.dni,
      telefono: customers.telefono,
      // Decide si la pantalla ofrece «anular» o «devolver»: una venta de un
      // turno cerrado no se anula (D29).
      turnoCerradaEn: cashSessions.cerradaEn,
      turnoAbiertaEn: cashSessions.abiertaEn,
    })
    .from(sales)
    .leftJoin(users, eq(users.id, sales.vendedorId))
    .leftJoin(customers, eq(customers.id, sales.clienteId))
    .leftJoin(cashSessions, eq(cashSessions.id, sales.cashSessionId))
    .where(eq(sales.id, ventaId))
    .limit(1);

  if (!venta) return null;

  const renglones = await db
    .select({
      descripcion: saleItems.descripcion,
      cantidad: saleItems.cantidad,
      precioUnitarioCentavos: saleItems.precioUnitarioCentavos,
      descuentoCentavos: saleItems.descuentoCentavos,
      totalCentavos: saleItems.totalCentavos,
      monedaOriginal: saleItems.monedaOriginal,
      precioUsdCentavos: saleItems.precioUsdCentavos,
    })
    .from(saleItems)
    .where(eq(saleItems.saleId, ventaId))
    .orderBy(asc(saleItems.descripcion));

  const pagos = await db
    .select({
      medio: salePayments.medio,
      montoCentavos: salePayments.montoCentavos,
      montoUsdCentavos: salePayments.montoUsdCentavos,
      cotizacionCentavos: salePayments.cotizacionCentavos,
      marcaTarjeta: salePayments.marcaTarjeta,
      cuotas: salePayments.cuotas,
    })
    .from(salePayments)
    .where(eq(salePayments.saleId, ventaId))
    .orderBy(desc(salePayments.montoCentavos));

  /*
   * Las cuotas del plan de ESTA venta, no de la cuenta del cliente.
   *
   * Quien compró tres veces tiene tres planes. Un plan anulado no cuenta: la
   * venta se dio de baja y sus cuotas con ella.
   */
  const filasDeCuotas = await db
    .select({
      numero: installments.numero,
      vencimiento: installments.vencimiento,
      montoCentavos: installments.montoCentavos,
      pagadoCentavos: installments.pagadoCentavos,
      moneda: creditPlans.moneda,
      recargoCentavos: creditPlans.recargoCentavos,
    })
    .from(installments)
    .innerJoin(creditPlans, eq(creditPlans.id, installments.planId))
    .where(and(eq(creditPlans.saleId, ventaId), isNull(creditPlans.anuladoEn)))
    .orderBy(asc(installments.numero));

  const devoluciones = await db
    .select({
      numero: returns.numero,
      fecha: returns.fecha,
      motivo: returns.motivo,
      totalCentavos: returns.totalCentavos,
      devueltoCentavos: returns.devueltoCentavos,
      descontadoDeDeudaCentavos: returns.descontadoDeDeudaCentavos,
    })
    .from(returns)
    .where(eq(returns.saleId, ventaId))
    .orderBy(desc(returns.fecha));

  return {
    id: venta.id,
    numero: venta.numero,
    fecha: venta.fecha,
    tipo: venta.tipo,
    estado: venta.estado,
    motivoAnulacion: venta.motivoAnulacion,
    subtotalCentavos: venta.subtotalCentavos,
    descuentoCentavos: venta.descuentoCentavos,
    totalCentavos: venta.totalCentavos,
    tcAplicadoCentavos: venta.tcAplicadoCentavos,
    nota: venta.nota,
    vendedor: venta.vendedor,
    clienteId: venta.clienteId,
    cliente: venta.cliente,
    documento: venta.documento,
    telefono: venta.telefono,
    terminal: venta.terminal,
    cashSessionId: venta.cashSessionId,
    turnoAbierto: venta.cashSessionId !== null && venta.turnoCerradaEn === null,
    turnoAbiertoEn: venta.turnoAbiertaEn,
    offline: venta.offline,
    offlineCapturadaEn: venta.offlineCapturadaEn,
    offlineDesvioCentavos: venta.offlineDesvioCentavos,
    renglones,
    pagos,
    monedaDelPlan: filasDeCuotas[0]?.moneda ?? null,
    recargoDelPlanCentavos: filasDeCuotas[0]?.recargoCentavos ?? 0,
    cuotas: filasDeCuotas.map((c) => ({
      numero: c.numero,
      vencimiento: aFechaISO(c.vencimiento),
      montoCentavos: c.montoCentavos,
      pagadoCentavos: c.pagadoCentavos,
    })),
    devoluciones,
  };
}

/**
 * Lo que quedó fiado de una venta, en pesos.
 *
 * Sale de los pagos y no de la cuenta del cliente: la cuenta cambia con el
 * tiempo y acá interesa esta compra. Es el mismo criterio que usa el
 * comprobante.
 */
export function fiadoDeLaVenta(detalle: DetalleDeVenta): number {
  return detalle.pagos
    .filter((p) => p.medio === 'cuenta_corriente')
    .reduce((n, p) => n + p.montoCentavos, 0);
}

/** Cuánto se devolvió de esta venta, sumando todas sus devoluciones. */
export function devueltoDeLaVenta(detalle: DetalleDeVenta): number {
  return detalle.devoluciones.reduce((n, d) => n + d.totalCentavos, 0);
}

/**
 * El vuelto, deducido.
 *
 * No se guarda: se saca de lo cobrado contra el total, acotado al efectivo
 * entregado —no se da vuelto de una transferencia—. Es la misma cuenta que
 * hacía la ruta del comprobante antes de que se dejaran de imprimir los pagos.
 */
export function vueltoDeLaVenta(detalle: DetalleDeVenta): number {
  const pagado = detalle.pagos.reduce((n, p) => n + p.montoCentavos, 0);
  const efectivo = detalle.pagos
    .filter((p) => p.medio === 'efectivo')
    .reduce((n, p) => n + p.montoCentavos, 0);

  return Math.max(0, Math.min(pagado - detalle.totalCentavos, efectivo));
}

/** Por si hace falta contar las ventas de un cliente sin traerlas enteras. */
export async function cuantasVentasTiene(db: BaseDatos, clienteId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(sales)
    .where(and(eq(sales.clienteId, clienteId), eq(sales.estado, 'completed')));

  return r?.n ?? 0;
}
