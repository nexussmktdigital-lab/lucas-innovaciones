import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { config } from '@/lib/config';
import { sesionAbierta } from '@/caja/sesion';
import { salir } from '../acciones-auth';
import { Proveedores } from '../proveedores';
import Navegacion from './navegacion';
import RegistroSW from './registro-sw';
import BotonSalir from './boton-salir';

export default async function LayoutPos({ children }: { children: React.ReactNode }) {
  const sesion = await auth();
  if (!sesion?.user) redirect('/ingresar');

  /*
   * Si la caja está abierta se dice en la barra, y no en una pantalla.
   *
   * Es el dato que cambia lo que se puede hacer —sin turno no se cobra, no se
   * recibe un pago ni se carga un gasto en efectivo— y hasta ahora había que ir
   * a buscarlo a Caja. Una consulta por pantalla, sobre un índice, contra algo
   * que se mira cien veces por día.
   */
  const caja = await sesionAbierta(db, config().POS_TERMINAL);

  return (
    <Proveedores>
      <RegistroSW />
      <div className="flex min-h-dvh flex-col">
        <header className="sin-imprimir relative flex min-h-12 shrink-0 items-center gap-3 bg-(--color-barra) px-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icono.svg"
            alt=""
            width={28}
            height={28}
            className="hidden shrink-0 rounded-[7px] sm:block"
          />
          <span className="hidden shrink-0 text-sm font-bold text-white lg:block">
            Lucas Innovaciones
          </span>
          <span className="hidden h-5 w-px shrink-0 bg-(--color-barra-borde) lg:block" />

          <Navegacion rol={sesion.user.rol} />

          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <EstadoDeCaja abierta={Boolean(caja)} />
            <span className="hidden text-sm text-(--color-barra-tinta) sm:inline">
              {sesion.user.name}
            </span>
            <BotonSalir salir={salir} />
          </div>
        </header>
        <main className="flex-1 p-4">{children}</main>
      </div>
    </Proveedores>
  );
}

/**
 * El turno, en una pastilla.
 *
 * Con la caja cerrada no se puede cobrar, y eso es lo primero que hay que saber
 * al llegar al mostrador. El punto de color se ve de lejos; el texto dice qué
 * significa, porque un punto solo no lo explica.
 */
function EstadoDeCaja({ abierta }: { abierta: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
        abierta
          ? 'border-[#1d4a1b] bg-[#11240f]'
          : 'border-(--color-barra-borde) bg-transparent'
      }`}
    >
      <span
        aria-hidden
        className={`size-2 rounded-full ${abierta ? 'bg-(--color-accion)' : 'bg-(--color-alerta)'}`}
      />
      <span className="hidden text-xs font-semibold whitespace-nowrap text-white md:inline">
        {abierta ? 'Caja abierta' : 'Caja cerrada'}
      </span>
      <span className="sr-only md:hidden">{abierta ? 'Caja abierta' : 'Caja cerrada'}</span>
    </span>
  );
}
