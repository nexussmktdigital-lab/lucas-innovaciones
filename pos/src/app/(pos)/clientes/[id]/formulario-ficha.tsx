'use client';

import { useActionState, useState } from 'react';
import { migrarFichaAccion, type EstadoFiado } from '@/app/acciones-fiado';

const INICIAL: EstadoFiado = {};

/**
 * Carga el saldo de una ficha de papel.
 *
 * Solo aparece cuando el cliente no tiene movimientos: es la puerta de entrada
 * de la libreta al sistema, y se usa una sola vez por cliente. Sumar dos veces
 * la misma deuda es el error que hay que evitar, así que el dominio también lo
 * rechaza.
 */
export default function FormularioFicha({
  clienteId,
  nombre,
}: {
  clienteId: string;
  nombre: string;
}) {
  const [estado, accion, pendiente] = useActionState(migrarFichaAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);

  if (estado.ok) {
    return (
      <p role="status" className="text-sm font-medium text-(--color-ok)">
        {estado.ok}
      </p>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-sm underline underline-offset-2"
      >
        Cargar una ficha de papel
      </button>
    );
  }

  return (
    <form action={accion} className="space-y-2 rounded-(--radius-caja) bg-(--color-papel) p-3">
      <input type="hidden" name="clienteId" value={clienteId} />
      <p className="text-sm">
        ¿Cuánto dice la libreta que debe <strong>{nombre}</strong> hoy? Se carga una sola vez, al
        pasar la ficha al sistema.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`saldo-${clienteId}`} className="mb-1 block text-xs font-medium">
            Saldo de la libreta
          </label>
          <input
            id={`saldo-${clienteId}`}
            name="saldo"
            type="text"
            inputMode="decimal"
            required
            autoFocus
            className="tabular min-h-11 w-40 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-right text-lg"
          />
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor={`nota-ficha-${clienteId}`} className="mb-1 block text-xs font-medium">
            De dónde sale (opcional)
          </label>
          <input
            id={`nota-ficha-${clienteId}`}
            name="nota"
            type="text"
            maxLength={200}
            placeholder="Ej.: libreta, hoja 12"
            className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
          />
        </div>
      </div>

      {estado.error ? (
        <p role="alert" className="text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="min-h-10 flex-1 rounded-(--radius-caja) border border-(--color-borde) text-sm font-medium"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-10 flex-1 rounded-(--radius-caja) bg-(--color-marca) text-sm font-semibold text-white disabled:opacity-60"
        >
          {pendiente ? 'Cargando…' : 'Cargar la ficha'}
        </button>
      </div>
    </form>
  );
}
