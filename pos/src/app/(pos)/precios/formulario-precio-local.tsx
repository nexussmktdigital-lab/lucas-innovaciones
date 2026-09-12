'use client';

import { useActionState, useState } from 'react';
import { guardarPrecioLocalAccion, type EstadoPrecios } from '@/app/acciones-precios';

const INICIAL: EstadoPrecios = {};

/**
 * Precio de mostrador propio de un producto.
 *
 * Es la excepción, no la regla: sirve para una promo del local o para igualar a
 * la competencia. Vaciarlo lo devuelve al cálculo, que es lo que conviene para
 * casi todo el catálogo.
 */
export default function FormularioPrecioLocal({
  productId,
  nombre,
  precioLocalCentavos,
  esUsd,
}: {
  productId: string;
  nombre: string;
  precioLocalCentavos: number | null;
  esUsd: boolean;
}) {
  const [estado, accion, pendiente] = useActionState(guardarPrecioLocalAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-sm underline underline-offset-2"
      >
        {precioLocalCentavos !== null ? 'Cambiar el precio propio' : 'Poner precio propio'}
      </button>
    );
  }

  return (
    <form action={accion} className="flex flex-col items-end gap-1">
      <input type="hidden" name="productId" value={productId} />
      <div className="flex items-center gap-1.5">
        <label htmlFor={`precio-${productId}`} className="sr-only">
          Precio de mostrador de {nombre}
        </label>
        <input
          id={`precio-${productId}`}
          name="precio"
          type="text"
          inputMode="decimal"
          defaultValue={precioLocalCentavos === null ? '' : String(precioLocalCentavos / 100)}
          placeholder="vacío = calculado"
          autoFocus
          className="tabular min-h-10 w-40 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2 text-right"
        />
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-10 rounded-(--radius-caja) bg-(--color-marca) px-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pendiente ? '…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="px-1 text-sm text-(--color-tinta-suave)"
        >
          ✕
        </button>
      </div>

      {esUsd ? (
        <p className="max-w-72 text-right text-xs text-(--color-alerta)">
          Este producto está en dólares: un precio fijo en pesos deja de seguir la cotización.
        </p>
      ) : null}

      {estado.error ? (
        <p role="alert" className="text-xs font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}
      {estado.ok ? (
        <p role="status" className="text-xs font-medium text-(--color-ok)">
          {estado.ok}
        </p>
      ) : null}
    </form>
  );
}
