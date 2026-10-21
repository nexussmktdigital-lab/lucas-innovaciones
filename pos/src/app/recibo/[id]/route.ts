/**
 * Recibo imprimible de un pago de fiado, en A4.
 *
 * Igual que `/ticket/<id>`: HTML suelto, fuera del layout del POS, que se abre
 * en una ventana aparte, se manda a imprimir solo y se cierra.
 *
 * El id es el del pago (`credit_payments`), no el del cliente: un recibo es de
 * un pago concreto, y el que lo trae de vuelta dentro de tres meses tiene que
 * llegar a ese pago y no al último.
 */
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { creditAccounts, creditPayments, customers, users } from '@/db/schema';
import { codigoDeRecibo, generarRecibo } from '@/fiado/recibo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sesion = await auth();
  if (!sesion?.user) return new Response('Sin sesión', { status: 401 });

  const { id } = await params;

  const [pago] = await db
    .select({
      id: creditPayments.id,
      fecha: creditPayments.fecha,
      montoCentavos: creditPayments.montoCentavos,
      monedaDeuda: creditPayments.monedaDeuda,
      montoCajaCentavos: creditPayments.montoCajaCentavos,
      medio: creditPayments.medio,
      nota: creditPayments.nota,
      saldoResultanteCentavos: creditPayments.saldoResultanteCentavos,
      cliente: customers.nombre,
      documento: customers.dni,
      cobradoPor: users.nombre,
      saldoCentavos: creditAccounts.saldoCentavos,
      saldoUsdCentavos: creditAccounts.saldoUsdCentavos,
    })
    .from(creditPayments)
    .innerJoin(creditAccounts, eq(creditAccounts.id, creditPayments.creditAccountId))
    .innerJoin(customers, eq(customers.id, creditAccounts.customerId))
    .leftJoin(users, eq(users.id, creditPayments.cobradoPorId))
    .where(eq(creditPayments.id, id))
    .limit(1);

  if (!pago) return new Response('No se encontró ese pago', { status: 404 });

  const enDolares = pago.monedaDeuda === 'USD';

  /*
   * El saldo que se imprime es el que quedó **en ese momento**, no el de hoy.
   *
   * `saldo_resultante_centavos` se congela al cobrar, y es lo correcto: un
   * recibo reimpreso tres meses después tiene que decir lo mismo que el que se
   * entregó ese día. Si leyera el saldo actual de la cuenta, dos copias del
   * mismo recibo dirían números distintos y ninguno de los dos sería falso,
   * que es la peor forma de que un papel esté mal.
   */
  const saldoCentavos = pago.saldoResultanteCentavos;

  /*
   * La otra deuda, en cambio, se lee de la cuenta: es la de hoy, y va marcada
   * como un aviso aparte y no como parte del pago. Decir que no debe nada
   * cuando debe en la otra moneda sería mentir por omisión.
   */
  const otraDeuda = enDolares
    ? { centavos: pago.saldoCentavos, moneda: 'ARS' as const }
    : { centavos: pago.saldoUsdCentavos, moneda: 'USD' as const };

  const html = generarRecibo({
    codigo: codigoDeRecibo(pago.id),
    fecha: pago.fecha,
    cliente: pago.cliente,
    documento: pago.documento,
    montoCentavos: pago.montoCentavos,
    monedaDeuda: pago.monedaDeuda,
    medio: pago.medio,
    // `monto_caja_centavos` solo está cuando el medio no es de la moneda de la
    // deuda; cuando coinciden es el mismo número y no se repite.
    enCaja:
      pago.montoCajaCentavos !== null && pago.montoCajaCentavos !== pago.montoCentavos
        ? {
            montoCentavos: pago.montoCajaCentavos,
            moneda: enDolares ? ('ARS' as const) : ('USD' as const),
          }
        : null,
    saldoCentavos,
    otraDeuda,
    nota: pago.nota,
    cobradoPor: pago.cobradoPor,
  });

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
