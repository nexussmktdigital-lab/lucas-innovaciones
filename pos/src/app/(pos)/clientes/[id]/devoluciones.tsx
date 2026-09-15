'use client';

import { useActionState, useState } from 'react';
import { marcarDevueltaAccion, type EstadoFiado } from '@/app/acciones-fiado';
import { formatearARS } from '@/lib/dinero';
import { formatearFecha } from '@/lib/fecha';
import type { DevolucionPendiente } from '@/fiado/devoluciones';

const INICIAL: EstadoFiado = {};

/**
 * Plata que el local le quedo debiendo al cliente.
 *
 * Aparece arriba de la deuda y no abajo: si alguien abre esta ficha para
 * cobrarle, lo primero que tiene que ver es que la cuenta va al reves.
 */
export default function Devoluciones({ pendientes }: { pendientes: DevolucionPendiente[] }) {
  if (pendientes.length === 0) return null;

  const total = pendientes.reduce((n, d) => n + d.montoCentavos, 0);

  return (
    <section
      aria-labelledby="devoluciones"
      className="rounded-(--radius-caja) border-2 border-(--color-alerta) bg-(--color-alerta)/8 p-4"
    >
      <h2 id="devoluciones" className="text-sm font-semibold">
        Le debemos {formatearARS(total)}
      </h2>
      <p className="mt-0.5 text-sm text-(--color-tinta-media)">
        Pagó esto a cuenta de una venta que después se anuló. La plata quedó en la caja.
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {pendientes.map((d) => (
          <Fila key={d.id} devolucion={d} />
        ))}
      </ul>
    </section>
  );
}

function Fila({ devolucion }: { devolucion: DevolucionPendiente }) {
  const [estado, accion, pendiente] = useActionState(marcarDevueltaAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);

  return (
    <li className="rounded-(--radius-caja) bg-(--color-panel) p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="tabular text-lg font-bold">{formatearARS(devolucion.montoCentavos)}</span>
        <span className="text-xs text-(--color-tinta-suave)">
          de la venta {devolucion.numero}, anulada el {formatearFecha(devolucion.creadoEn)}
        </span>
      </div>

      {estado.error ? (
        <p role="alert" className="mt-1 text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}

      {!abierto ? (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="mt-2 min-h-10 rounded-(--radius-caja) bg-(--color-ok) px-4 text-sm font-semibold text-white"
        >
          Ya se le devolvió
        </button>
      ) : (
        <form action={accion} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="devolucionId" value={devolucion.id} />
          <div className="min-w-40 flex-1">
            <label
              htmlFor={`nota-dev-${devolucion.id}`}
              className="mb-1 block text-xs font-medium"
            >
              Nota (opcional)
            </label>
            <input
              id={`nota-dev-${devolucion.id}`}
              name="nota"
              type="text"
              maxLength={200}
              autoFocus
              placeholder="Ej.: en efectivo, del cajón"
              className="min-h-10 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2"
            />
          </div>
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) px-3 text-sm font-medium"
          >
            Volver
          </button>
          <button
            type="submit"
            disabled={pendiente}
            className="min-h-10 rounded-(--radius-caja) bg-(--color-ok) px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pendiente ? 'Anotando…' : 'Confirmar'}
          </button>
        </form>
      )}
    </li>
  );
}
