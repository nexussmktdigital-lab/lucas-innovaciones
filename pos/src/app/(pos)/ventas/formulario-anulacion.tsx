'use client';

import { useActionState, useState } from 'react';
import { anularVentaAccion, type EstadoAnulacion } from '@/app/acciones-venta';

const INICIAL: EstadoAnulacion = {};

/**
 * Anular una venta.
 *
 * Se abre en dos pasos a propósito: anular mueve stock y plata, así que no
 * puede ser un botón que se toque sin querer al pasar el dedo por la lista.
 */
export default function FormularioAnulacion({
  ventaId,
  numero,
}: {
  ventaId: string;
  numero: string;
}) {
  const [estado, accion, pendiente] = useActionState(anularVentaAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);

  /*
   * Anulada la venta, este formulario desaparece con ella: la página se vuelve
   * a renderizar y las ventas anuladas no lo muestran. Por eso el aviso de
   * «devolvele la plata» no vive acá sino en la fila, puesto por el servidor;
   * si no, nadie lo llegaría a leer.
   */
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
        className="text-sm font-medium text-(--color-error) underline underline-offset-2"
      >
        Anular
      </button>
    );
  }

  return (
    <form
      action={accion}
      className="w-full space-y-2 rounded-(--radius-caja) border-2 border-(--color-error) p-3"
    >
      <input type="hidden" name="ventaId" value={ventaId} />
      <label htmlFor={`motivo-${ventaId}`} className="block text-sm font-medium">
        ¿Por qué se anula la venta {numero}?
      </label>
      <input
        id={`motivo-${ventaId}`}
        name="motivo"
        type="text"
        required
        minLength={4}
        autoFocus
        placeholder="Ej.: se cargó el modelo equivocado"
        className="min-h-10 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2"
      />

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
          Volver
        </button>
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-10 flex-1 rounded-(--radius-caja) bg-(--color-error) text-sm font-semibold text-(--color-error-texto) disabled:opacity-60"
        >
          {pendiente ? 'Anulando…' : 'Anular la venta'}
        </button>
      </div>
    </form>
  );
}
