'use client';

import { useActionState } from 'react';
import { ponerLimiteAccion, type EstadoFiado } from '@/app/acciones-fiado';

const INICIAL: EstadoFiado = {};

/**
 * Tope de fiado.
 *
 * Vacío es sin tope, que es como funciona la libreta hoy. Ponerle un número es
 * la forma de que el sistema frene antes de que la deuda se vuelva incobrable,
 * en vez de que lo note alguien tres meses después.
 */
export default function FormularioLimite({
  clienteId,
  limiteCentavos,
}: {
  clienteId: string;
  limiteCentavos: number | null;
}) {
  const [estado, accion, pendiente] = useActionState(ponerLimiteAccion, INICIAL);

  return (
    <form action={accion} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="clienteId" value={clienteId} />
      <div>
        <label htmlFor={`limite-${clienteId}`} className="mb-1 block text-sm font-medium">
          Hasta cuánto se le puede fiar
        </label>
        <input
          id={`limite-${clienteId}`}
          name="limite"
          type="text"
          inputMode="decimal"
          defaultValue={limiteCentavos === null ? '' : String(limiteCentavos / 100)}
          placeholder="vacío = sin tope"
          className="tabular min-h-11 w-44 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2 text-right"
        />
      </div>
      <button
        type="submit"
        disabled={pendiente}
        className="min-h-11 rounded-(--radius-caja) border border-(--color-borde) px-4 font-medium disabled:opacity-60"
      >
        {pendiente ? 'Guardando…' : 'Guardar el tope'}
      </button>

      {estado.error ? (
        <p role="alert" className="w-full text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}
      {estado.ok ? (
        <p role="status" className="w-full text-sm font-medium text-(--color-ok)">
          {estado.ok}
        </p>
      ) : null}
    </form>
  );
}
