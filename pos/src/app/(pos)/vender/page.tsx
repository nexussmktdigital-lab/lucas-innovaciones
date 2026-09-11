import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { customers, exchangeRates, monetaryAccounts } from '@/db/schema';
import { sesionAbierta } from '@/caja/sesion';
import { config } from '@/lib/config';
import { pendientesDeSincronizar } from '@/woo/cola';
import PantallaVenta from './pantalla-venta';

export const dynamic = 'force-dynamic';

export default async function PaginaVender() {
  const sesion = await auth();
  const terminal = config().POS_TERMINAL;

  const caja = await sesionAbierta(db, terminal);
  if (!caja) return <CajaCerrada />;

  const [tc] = await db
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.vigenteDesde))
    .limit(1);

  const cuentas = await db
    .select({ id: monetaryAccounts.id, nombre: monetaryAccounts.nombre, tipo: monetaryAccounts.tipo })
    .from(monetaryAccounts)
    .where(eq(monetaryAccounts.activo, true));

  const clientes = await db
    .select({ id: customers.id, nombre: customers.nombre, telefono: customers.telefono })
    .from(customers)
    .where(eq(customers.activo, true))
    .orderBy(customers.nombre)
    .limit(200);

  const cola = await pendientesDeSincronizar(db);

  return (
    <PantallaVenta
      terminal={terminal}
      vendedor={sesion?.user.name ?? ''}
      esDuenio={sesion?.user.rol === 'owner'}
      tcCentavos={tc?.valorCentavos ?? null}
      cuentas={cuentas}
      clientes={clientes}
      pendientesDeSync={cola.pendientes + cola.fallidas}
    />
  );
}

function CajaCerrada() {
  return (
    <div className="mx-auto max-w-lg pt-16 text-center">
      <h1 className="text-2xl font-bold tracking-tight">La caja está cerrada</h1>
      <p className="mt-2 text-(--color-tinta-suave)">
        Para poder vender hay que abrir el turno declarando con cuánto efectivo arranca la caja.
      </p>
      <Link
        href="/caja"
        className="mt-6 inline-flex min-h-12 items-center rounded-(--radius-caja) bg-(--color-marca) px-6 font-semibold text-white"
      >
        Abrir la caja
      </Link>
    </div>
  );
}
