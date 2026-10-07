/**
 * Comprobante imprimible de una venta, en A4.
 *
 * Devuelve HTML suelto, fuera del layout del POS: se abre en una ventana aparte
 * que se manda a imprimir sola y se cierra. Una sola copia, la del cliente.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import {
  creditPlans,
  customers,
  installments,
  saleItems,
  salePayments,
  sales,
} from '@/db/schema';
import { aFechaISO } from '@/fiado/plan';
import { generarTicket } from '@/ventas/ticket';
import { ventaEnDolares } from '@/ventas/carrito';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sesion = await auth();
  if (!sesion?.user) {
    return new Response('Sin sesión', { status: 401 });
  }

  const { id } = await params;

  const [venta] = await db
    .select({
      id: sales.id,
      numero: sales.numero,
      fecha: sales.fecha,
      subtotalCentavos: sales.subtotalCentavos,
      descuentoCentavos: sales.descuentoCentavos,
      totalCentavos: sales.totalCentavos,
      tcAplicadoCentavos: sales.tcAplicadoCentavos,
      nota: sales.nota,
      estado: sales.estado,
      cliente: customers.nombre,
      documento: customers.dni,
    })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.clienteId))
    .where(eq(sales.id, id))
    .limit(1);

  if (!venta) return new Response('No se encontró esa venta', { status: 404 });

  const lineas = await db
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
    .where(eq(saleItems.saleId, id));

  const pagos = await db
    .select({
      medio: salePayments.medio,
      montoCentavos: salePayments.montoCentavos,
      marcaTarjeta: salePayments.marcaTarjeta,
      cuotas: salePayments.cuotas,
    })
    .from(salePayments)
    .where(eq(salePayments.saleId, id));

  // Los medios de pago no se imprimen; de ellos solo sale lo que quedó fiado,
  // que es lo que el cliente necesita saber de esta compra.
  const fiadoCentavos = pagos
    .filter((p) => p.medio === 'cuenta_corriente')
    .reduce((suma, p) => suma + p.montoCentavos, 0);

  /*
   * Las cuotas pactadas en esta venta, si se pactaron.
   *
   * Del plan de ESTA venta y no de la cuenta: un cliente que compró tres veces
   * tiene tres planes, y en el papel de hoy van las cuotas de hoy. Un plan
   * anulado no cuenta: la venta se dio de baja y sus cuotas con ella.
   */
  const cuotas = await db
    .select({
      numero: installments.numero,
      vencimiento: installments.vencimiento,
      montoCentavos: installments.montoCentavos,
      moneda: creditPlans.moneda,
    })
    .from(installments)
    .innerJoin(creditPlans, eq(creditPlans.id, installments.planId))
    .where(and(eq(creditPlans.saleId, id), isNull(creditPlans.anuladoEn)))
    .orderBy(asc(installments.numero));

  /*
   * En qué moneda quedó la deuda (D62).
   *
   * La fuente es el plan, que es donde el sistema la guarda. Sin plan —el
   * fiado «cuando pueda», sin fechas— la responde la misma función que usa la
   * confirmación de la venta, así que el papel y el sistema no pueden diferir.
   */
  const monedaDeLaDeuda = cuotas[0]?.moneda ?? (ventaEnDolares(lineas) ? 'USD' : 'ARS');

  const html = generarTicket({
    numero: venta.numero,
    fecha: venta.fecha,
    cliente: venta.cliente,
    documento: venta.documento,
    lineas,
    subtotalCentavos: venta.subtotalCentavos,
    descuentoCentavos: venta.descuentoCentavos,
    totalCentavos: venta.totalCentavos,
    fiadoCentavos,
    cuotas: cuotas.map((c) => ({
      numero: c.numero,
      vencimiento: aFechaISO(c.vencimiento),
      montoCentavos: c.montoCentavos,
    })),
    monedaDeLaDeuda,
    nota: venta.estado === 'cancelled' ? 'VENTA ANULADA' : venta.nota,
  });

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
