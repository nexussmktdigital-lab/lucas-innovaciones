'use client';

import { useActionState } from 'react';
import { cargarCotizacion, type EstadoCotizacionForm } from '@/app/acciones-cotizacion';

const INICIAL: EstadoCotizacionForm = {};

export default function FormularioCotizacion() {
  const [estado, accion, pendiente] = useActionState(cargarCotizacion, INICIAL);

  return (
    <form
      action={accion}
      className="space-y-3 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4"
    >
      <div>
        <h2 className="font-semibold">Cargar un valor a mano</h2>
        <p className="text-sm text-(--color-tinta-suave)">
          Solo si el plugin dejó de actualizar. Queda registrado con tu nombre.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label htmlFor="valor" className="mb-1 block text-sm font-medium">
            Pesos por dólar
          </label>
          <input
            id="valor"
            name="valor"
            type="text"
            inputMode="decimal"
            placeholder="1561"
            required
            className="tabular min-h-12 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 text-right text-xl"
          />
        </div>
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-12 rounded-(--radius-caja) bg-(--color-marca) px-5 font-semibold text-(--color-marca-texto) disabled:opacity-60"
        >
          {pendiente ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      {estado.error ? (
        <div
          role="alert"
          className="rounded-(--radius-caja) bg-(--color-alerta-fondo) p-3 text-sm"
        >
          <p className="font-medium">{estado.error}</p>
          {estado.pideConfirmacion ? (
            <label className="mt-2 flex cursor-pointer items-center gap-2 font-medium">
              <input type="checkbox" name="confirmarSalto" value="si" className="size-4" />
              Sí, el valor es correcto. Guardarlo igual.
            </label>
          ) : null}
        </div>
      ) : null}

      {estado.ok ? (
        <p role="status" className="text-sm font-medium text-(--color-ok)">
          {estado.ok}
        </p>
      ) : null}
    </form>
  );
}
