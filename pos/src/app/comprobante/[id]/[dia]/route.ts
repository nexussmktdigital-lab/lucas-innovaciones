/**
 * Comprobante imprimible de una visita a la cuenta corriente, en A4.
 *
 * Igual que `/ticket/<id>` y `/recibo/<id>`: HTML suelto, fuera del layout del
 * POS, que se abre en una ventana aparte, se manda a imprimir solo y se
 * cierra.
 *
 * La dirección lleva el cliente y el día, no un id de movimiento: la visita
 * son varios hechos y ninguno de ellos es «la visita». Con el cliente y el
 * día, imprimir desde cualquiera de los renglones de esa tarde saca el mismo
 * papel, que es lo que hace que una reimpresión sirva.
 */
import { auth } from '@/auth';
import { db } from '@/db';
import { clientePorId } from '@/clientes/clientes';
import { comprobanteDelDia } from '@/fiado/cuenta';
import { codigoDeComprobante, generarComprobante } from '@/fiado/comprobante';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; dia: string }> },
) {
  const sesion = await auth();
  if (!sesion?.user) return new Response('Sin sesión', { status: 401 });

  const { id, dia } = await params;
  if (!DIA.test(dia)) return new Response('Fecha inválida', { status: 400 });

  const cliente = await clientePorId(db, id);
  if (!cliente) return new Response('No se encontró ese cliente', { status: 404 });

  const visita = await comprobanteDelDia(db, id, dia);
  if (!visita) {
    return new Response(
      'Ese día no tuvo movimientos de cuenta con saldo, así que no hay comprobante que imprimir.',
      { status: 404 },
    );
  }

  const html = generarComprobante({
    codigo: codigoDeComprobante(cliente.id, dia),
    dia,
    cliente: cliente.nombre,
    documento: cliente.dni,
    renglones: visita.renglones,
    saldoCentavos: visita.saldoCentavos,
    hayPosteriores: visita.hayPosteriores,
    hayDolares: visita.hayDolares,
    deudaUsdCentavos: cliente.saldoUsdCentavos,
    atendidoPor: sesion.user.name ?? null,
  });

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
