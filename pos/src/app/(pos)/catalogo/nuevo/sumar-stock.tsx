'use client';

import { useActionState } from 'react';
import {
  reactivarProductoAccion,
  sumarStockAccion,
  type EstadoStock,
} from '@/app/acciones-catalogo';

const INICIAL: EstadoStock = {};

/**
 * Sumarle unidades a un producto que ya existe, desde el aviso de duplicados.
 *
 * Es la otra mitad del aviso: encontrar que el producto ya está sirve de poco si
 * el camino para usarlo es más largo que cargarlo de nuevo. Si hay que ir a otra
 * pantalla a buscarlo, con el cliente esperando el camino corto vuelve a ser la
 * ficha nueva, y el duplicado igual.
 *
 * Por eso es un renglón, acá mismo: cuántas entraron y listo. Arranca en 1
 * porque es lo más común en un mostrador —llegó una unidad de algo que ya está—
 * y queda seleccionado para poder escribir otro número encima sin borrar.
 */
export default function SumarStock({
  productId,
  activo,
  puedeReactivar,
}: {
  productId: string;
  activo: boolean;
  puedeReactivar: boolean;
}) {
  const [estado, sumar, sumando] = useActionState(sumarStockAccion, INICIAL);
  const [reactivado, reactivar, reactivando] = useActionState(reactivarProductoAccion, INICIAL);

  if (estado.ok) {
    return (
      <p role="status" className="text-sm font-semibold text-(--color-ok)">
        {estado.ok}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!activo && puedeReactivar ? (
        <form action={reactivar}>
          <input type="hidden" name="productId" value={productId} />
          <button
            type="submit"
            disabled={reactivando}
            className="min-h-10 rounded-(--radius-caja) border-2 border-(--color-marca) px-3 text-sm font-semibold disabled:opacity-50"
          >
            {reactivando ? 'Reactivando…' : 'Volver a ponerlo a la venta'}
          </button>
          {reactivado.ok ? (
            <p role="status" className="mt-1 text-sm font-semibold text-(--color-ok)">
              {reactivado.ok}
            </p>
          ) : null}
          {reactivado.error ? (
            <p role="alert" className="mt-1 text-sm text-(--color-error)">
              {reactivado.error}
            </p>
          ) : null}
        </form>
      ) : null}

      <form action={sumar} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="productId" value={productId} />
        <label className="text-sm text-(--color-tinta-suave)">
          <span className="sr-only">Unidades que entraron</span>
          <input
            type="number"
            name="cantidad"
            min={1}
            max={1000}
            defaultValue={1}
            inputMode="numeric"
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Unidades que entraron"
            className="tabular min-h-10 w-20 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2 text-center text-base"
          />
        </label>
        <button
          type="submit"
          disabled={sumando}
          className="min-h-10 rounded-(--radius-caja) bg-(--color-marca) px-3 text-sm font-semibold text-(--color-marca-texto) disabled:opacity-50"
        >
          {sumando ? 'Sumando…' : 'Sumar al stock'}
        </button>
      </form>

      {estado.error ? (
        <p role="alert" className="text-sm text-(--color-error)">
          {estado.error}
        </p>
      ) : null}
    </div>
  );
}
