'use client';

import { useState, useTransition } from 'react';
import {
  reactivarProductoAccion,
  sumarStockAccion,
  type EstadoStock,
} from '@/app/acciones-catalogo';

/**
 * Sumarle unidades a un producto que ya existe, desde el aviso de duplicados.
 *
 * Es la otra mitad del aviso: encontrar que el producto ya está sirve de poco si
 * el camino para usarlo es más largo que cargarlo de nuevo. Si hay que ir a otra
 * pantalla a buscarlo, con el cliente esperando el camino corto vuelve a ser la
 * ficha nueva, y el duplicado igual.
 *
 * **Por qué no usa `<form>` ni `useActionState`, que sería lo natural.** Este
 * control se dibuja adentro del formulario del alta, y HTML no permite
 * formularios anidados: el navegador descarta el de adentro y su botón pasa a
 * enviar el de afuera. O sea que «Sumar al stock» terminaba intentando crear el
 * producto a medio llenar. Lo encontró el e2e, no la lectura del código.
 *
 * La salida no es mover el aviso abajo del formulario —el momento de darse
 * cuenta es mientras se escribe el nombre, no después— sino llamar a la acción
 * del servidor como una función, dentro de una transición. Mismo servidor, mismo
 * permiso, misma validación: lo único que no hay es un `<form>` de más.
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
  const [cantidad, setCantidad] = useState('1');
  const [estado, setEstado] = useState<EstadoStock>({});
  const [reactivado, setReactivado] = useState<EstadoStock>({});
  const [enCurso, enTransicion] = useTransition();

  function sumar() {
    const datos = new FormData();
    datos.set('productId', productId);
    datos.set('cantidad', cantidad);
    enTransicion(async () => setEstado(await sumarStockAccion({}, datos)));
  }

  function reactivar() {
    const datos = new FormData();
    datos.set('productId', productId);
    enTransicion(async () => setReactivado(await reactivarProductoAccion({}, datos)));
  }

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
        <div>
          <button
            type="button"
            onClick={reactivar}
            disabled={enCurso}
            className="min-h-10 rounded-(--radius-caja) border-2 border-(--color-marca) px-3 text-sm font-semibold disabled:opacity-50"
          >
            {enCurso ? 'Esperá…' : 'Volver a ponerlo a la venta'}
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
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1}
          max={1000}
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          /* Enter suma, que es lo que la mano espera al venir de tipear un
             número. Sin `<form>` hay que decirlo a mano. */
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              sumar();
            }
          }}
          inputMode="numeric"
          aria-label="Unidades que entraron"
          className="tabular min-h-10 w-20 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2 text-center text-base"
        />
        <button
          type="button"
          onClick={sumar}
          disabled={enCurso}
          className="min-h-10 rounded-(--radius-caja) bg-(--color-marca) px-3 text-sm font-semibold text-(--color-marca-texto) disabled:opacity-50"
        >
          {enCurso ? 'Sumando…' : 'Sumar al stock'}
        </button>
      </div>

      {estado.error ? (
        <p role="alert" className="text-sm text-(--color-error)">
          {estado.error}
        </p>
      ) : null}
    </div>
  );
}
