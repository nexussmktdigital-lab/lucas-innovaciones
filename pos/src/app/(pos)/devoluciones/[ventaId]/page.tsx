import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { monetaryAccounts } from '@/db/schema';
import { config } from '@/lib/config';
import { sesionAbierta } from '@/caja/sesion';
import { ErrorDevolucion, loDevolvible } from '@/ventas/devolver';
import FormularioDevolucion from '../formulario-devolucion';

export const dynamic = 'force-dynamic';

export default async function PaginaDevolverVenta({
  params,
}: {
  params: Promise<{ ventaId: string }>;
}) {
  const sesion = await auth();
  if (!sesion?.user) redirect('/ingresar');
  if (!puede(sesion.user.rol, 'venta.anular')) redirect('/');

  const { ventaId } = await params;

  let venta;
  let problema: string | null = null;
  try {
    venta = await loDevolvible(db, ventaId);
  } catch (e) {
    if (!(e instanceof ErrorDevolucion)) throw e;
    problema = e.message;
  }

  if (!venta && !problema) notFound();

  const caja = await sesionAbierta(db, config().POS_TERMINAL);

  const cuentas = await db
    .select({
      id: monetaryAccounts.id,
      nombre: monetaryAccounts.nombre,
      tipo: monetaryAccounts.tipo,
    })
    .from(monetaryAccounts)
    .where(eq(monetaryAccounts.activo, true));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/devoluciones" className="text-sm underline underline-offset-2">
          ← Devoluciones
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Devolver</h1>
      </div>

      {problema ? (
        <p role="alert" className="rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-4 text-sm">
          {problema}
        </p>
      ) : !caja ? (
        <p className="rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-4 text-sm">
          No hay una caja abierta. Una devolución mueve plata de un cajón concreto, así que hay que{' '}
          <Link href="/caja" className="font-semibold underline underline-offset-2">
            abrir la caja
          </Link>{' '}
          antes.
        </p>
      ) : (
        <FormularioDevolucion venta={venta!} cuentas={cuentas} />
      )}
    </div>
  );
}
