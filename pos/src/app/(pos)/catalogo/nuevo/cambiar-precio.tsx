'use client';

import { useState, useTransition } from 'react';
import { cambiarPrecioAccion, type EstadoPrecio } from '@/app/acciones-catalogo';
import { formatearARS } from '@/lib/dinero';

/**
 * Corregir el precio de un producto sin salir de donde se lo encontró.
 *
 * Es la tercera cosa que se hace con una ficha que ya existe, después de
 * sumarle stock y de reactivarla: llegó mercadería con aumento y el precio
 * quedó viejo. Antes la salida era escribirlo en la venta —que arregla esa
 * venta y ninguna de las siguientes— o abrir WordPress con el cliente enfrente.
 *
 * **El número que se escribe es el del mostrador**, que es el que quien atiende
 * tiene en la cabeza. La cuenta del recargo de la tienda la hace el servidor.
 *
 * Arranca cerrado, como un enlace: la mayoría de las veces el precio está bien y
 * un campo editable al lado de cada producto invita a tocarlo sin querer.
 *
 * Igual que `SumarStock`, no usa `<form>`: este control se dibuja adentro del
 * formulario del alta y HTML no permite formularios anidados —el navegador
 * descarta el de adentro y su botón termina enviando el de afuera—.
 */
export default function CambiarPrecio({
  productId,
  mostradorCentavos,
}: {
  productId: string;
  /** Lo que se cobra hoy en el local, para prellenar el campo. */
  mostradorCentavos: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const [precio, setPrecio] = useState(() => comoSeEscribe(mostradorCentavos));
  const [estado, setEstado] = useState<EstadoPrecio>({});
  const [enCurso, enTransicion] = useTransition();

  function guardar() {
    const datos = new FormData();
    datos.set('productId', productId);
    datos.set('precio', precio);
    enTransicion(async () => setEstado(await cambiarPrecioAccion({}, datos)));
  }

  if (estado.resultado) {
    return (
      <p role="status" className="text-sm font-semibold text-(--color-ok)">
        {estado.ok}
      </p>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-sm font-medium text-(--color-marca) underline underline-offset-2"
      >
        Cambiar precio
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor={`precio-${productId}`}>
          Precio de mostrador
        </label>
        <div className="flex items-center gap-1">
          <span aria-hidden="true" className="text-(--color-tinta-suave)">
            $
          </span>
          <input
            id={`precio-${productId}`}
            type="text"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            /* Enter guarda, que es lo que la mano espera al venir de tipear un
               número. Sin `<form>` hay que decirlo a mano. */
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                guardar();
              }
            }}
            autoFocus
            inputMode="decimal"
            aria-label="Precio de mostrador"
            className="tabular min-h-10 w-28 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2 text-right text-base"
          />
        </div>
        <button
          type="button"
          onClick={guardar}
          disabled={enCurso}
          className="min-h-10 rounded-(--radius-caja) bg-(--color-marca) px-3 text-sm font-semibold text-(--color-marca-texto) disabled:opacity-50"
        >
          {enCurso ? 'Guardando…' : 'Guardar precio'}
        </button>
        <button
          type="button"
          onClick={() => {
            setAbierto(false);
            setPrecio(comoSeEscribe(mostradorCentavos));
            setEstado({});
          }}
          className="min-h-10 px-2 text-sm underline underline-offset-2"
        >
          Dejarlo como está
        </button>
      </div>

      <p className="text-xs text-(--color-tinta-suave)">
        Hoy sale {formatearARS(mostradorCentavos)} en el local. El precio de la web se
        recalcula solo.
      </p>

      {estado.error ? (
        <p role="alert" className="text-sm text-(--color-error)">
          {estado.error}
        </p>
      ) : null}
    </div>
  );
}

/** Centavos al texto que alguien escribiría: 5000000 -> «50000», no «$ 50.000,00». */
function comoSeEscribe(centavos: number): string {
  const entero = Math.trunc(centavos / 100);
  const resto = Math.abs(centavos % 100);
  return resto === 0 ? String(entero) : `${entero},${String(resto).padStart(2, '0')}`;
}
