import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { exchangeRates, monetaryAccounts } from '@/db/schema';
import { clientesParaVender } from '@/clientes/clientes';
import { sesionAbierta } from '@/caja/sesion';
import { config } from '@/lib/config';
import { puede } from '@/auth/permisos';
import { pendientesDeSincronizar } from '@/woo/cola';
import PantallaVenta from './pantalla-venta';

export const dynamic = 'force-dynamic';

/** Cuántos clientes entran en el selector de la venta. Ver `clientesParaVender`. */
const TOPE_DE_CLIENTES = 1000;

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

  // Los clientes van con su deuda: al elegir a quién fiarle, lo primero que hay
  // que ver es cuánto debe ya. Si la lista se llenó, la pantalla lo dice en vez
  // de esconder a los que no entraron.
  const clientes = await clientesParaVender(db, TOPE_DE_CLIENTES);

  const cola = await pendientesDeSincronizar(db);

  // Lo que puede quien atiende se resuelve acá, en el servidor, y viaja como
  // un sí o un no. La pantalla no tiene por qué saber qué rol tiene nadie.
  const rol = sesion?.user.rol ?? null;
  const puedeEn = (p: Parameters<typeof puede>[1]) => (rol ? puede(rol, p) : false);

  return (
    <PantallaVenta
      terminal={terminal}
      vendedor={sesion?.user.name ?? ''}
      puedeDescontar={puedeEn('venta.descuento')}
      puedeFiar={puedeEn('fiado.crear')}
      puedeEditarPrecio={puedeEn('venta.editar_precio')}
      tcCentavos={tc?.valorCentavos ?? null}
      cuentas={cuentas}
      clientes={clientes}
      faltanClientes={clientes.length >= TOPE_DE_CLIENTES}
      pendientesDeSync={cola.pendientes + cola.fallidas}
      cashSessionId={caja.id}
      puedeCargarProductos={puedeEn('producto.alta_rapida')}
    />
  );
}

function CajaCerrada() {
  return (
    <div className="mx-auto max-w-lg pt-16 text-center">
      <h1 className="font-titulo text-2xl font-bold tracking-tight">La caja está cerrada</h1>
      <p className="mt-2 text-(--color-tinta-suave)">
        Para poder vender hay que abrir el turno declarando con cuánto efectivo arranca la caja.
      </p>
      <Link
        href="/caja"
        className="mt-6 inline-flex min-h-12 items-center rounded-(--radius-caja) bg-(--color-marca) px-6 font-semibold text-(--color-marca-texto)"
      >
        Abrir la caja
      </Link>
    </div>
  );
}
