import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { formatearARS } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/fecha';
import { config } from '@/lib/config';
import { sesionAbierta } from '@/caja/sesion';
import { devolucionesRecientes, ventasRecientes } from '@/ventas/devolver';
import Buscador from './buscador';

export const dynamic = 'force-dynamic';

/**
 * Devoluciones.
 *
 * Anular es para el error de carga y solo dentro del turno abierto (D29). Esto
 * es lo otro: el cliente que vuelve el jueves con el cargador que no anda.
 */
export default async function PaginaDevoluciones() {
  const sesion = await auth();
  if (!sesion?.user) redirect('/ingresar');
  if (!puede(sesion.user.rol, 'venta.anular')) redirect('/');

  const caja = await sesionAbierta(db, config().POS_TERMINAL);
  const hechas = await devolucionesRecientes(db, { limite: 30 });
  const ventas = await ventasRecientes(db, 20);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-titulo text-2xl font-bold tracking-tight">Devoluciones</h1>
        <p className="mt-1 text-sm text-(--color-tinta-suave)">
          Para una venta de un turno que ya se cerró. La venta queda como está y la plata sale del
          cajón de hoy.
        </p>
      </div>

      {!caja ? (
        <p className="rounded-(--radius-caja) bg-(--color-alerta-fondo) p-3 text-sm">
          No hay una caja abierta. Una devolución mueve plata de un cajón concreto, así que hay
          que{' '}
          <Link href="/caja" className="font-semibold underline underline-offset-2">
            abrir la caja
          </Link>{' '}
          primero.
        </p>
      ) : null}

      <Buscador ventas={ventas.map((v) => ({
        id: v.id,
        numero: v.numero,
        fecha: formatearFechaHora(v.fecha),
        total: formatearARS(v.totalCentavos),
        cliente: v.cliente,
      }))} />

      {hechas.length > 0 ? (
        <section aria-label="Devoluciones hechas">
          <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
            Últimas devoluciones
          </h2>
          <ul className="flex flex-col gap-1.5">
            {hechas.map((d) => (
              <li
                key={d.id}
                className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="tabular font-medium">{d.numero}</span>
                  <span className="text-xs text-(--color-tinta-suave)">
                    {formatearFechaHora(d.fecha)} · de la venta {d.ventaNumero}
                    {d.cliente ? ` · ${d.cliente}` : ''}
                  </span>
                  <span className="tabular ml-auto font-semibold text-(--color-error)">
                    −{formatearARS(d.totalCentavos)}
                  </span>
                </div>

                <p className="mt-0.5 text-(--color-tinta-media)">
                  {d.unidades} u. · {d.detalle}
                </p>
                <p className="mt-0.5 text-xs text-(--color-tinta-suave)">{d.motivo}</p>

                {d.descontadoDeDeudaCentavos > 0 ? (
                  <p className="mt-1 text-xs text-(--color-tinta-suave)">
                    {formatearARS(d.descontadoDeDeudaCentavos)} se descontaron de lo que debía
                    {d.devueltoCentavos > 0
                      ? ` y ${formatearARS(d.devueltoCentavos)} salieron del cajón`
                      : ''}
                    .
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-6 text-center text-sm text-(--color-tinta-suave)">
          Todavía no se devolvió nada.
        </p>
      )}
    </div>
  );
}
