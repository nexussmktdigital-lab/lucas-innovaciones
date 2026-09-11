/**
 * Comprobante imprimible de una venta.
 *
 * Devuelve HTML suelto, fuera del layout del POS: se abre en una ventana aparte
 * que se manda a imprimir sola y se cierra. El ancho del papel va por query
 * (`?ancho=58`), con 80 mm por defecto.
 */
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { customers, saleItems, salePayments, sales, users } from '@/db/schema';
import { generarTicket, type AnchoDeTicket } from '@/ventas/ticket';

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
      vendedor: users.nombre,
      cliente: customers.nombre,
    })
    .from(sales)
    .leftJoin(users, eq(users.id, sales.vendedorId))
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

  // El vuelto no se guarda: se deduce de lo cobrado contra el total.
  const pagado = pagos.reduce((suma, p) => suma + p.montoCentavos, 0);
  const efectivo = pagos
    .filter((p) => p.medio === 'efectivo')
    .reduce((suma, p) => suma + p.montoCentavos, 0);
  const vueltoCentavos = Math.max(0, Math.min(pagado - venta.totalCentavos, efectivo));

  const anchoPedido = new URL(request.url).searchParams.get('ancho');
  const ancho: AnchoDeTicket = anchoPedido === '58' ? 58 : 80;

  const html = generarTicket(
    {
      numero: venta.numero,
      fecha: venta.fecha,
      vendedor: venta.vendedor ?? '—',
      cliente: venta.cliente,
      lineas,
      subtotalCentavos: venta.subtotalCentavos,
      descuentoCentavos: venta.descuentoCentavos,
      totalCentavos: venta.totalCentavos,
      pagos,
      vueltoCentavos,
      tcAplicadoCentavos: venta.tcAplicadoCentavos,
      nota: venta.estado === 'cancelled' ? 'VENTA ANULADA' : venta.nota,
    },
    { ancho },
  );

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
