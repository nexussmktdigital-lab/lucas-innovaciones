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
  moneda: monedaDeLaFicha = 'ARS',
  precioUsdCentavos,
  tcCentavos,
}: {
  productId: string;
  /** Lo que se cobra hoy en el local, para prellenar el campo. */
  mostradorCentavos: number;
  /**
   * En qué moneda está pactado hoy. Arranca en la de la ficha: un usado que ya
   * está en dólares se corrige en dólares sin tener que acordarse de tocar el
   * selector.
   */
  moneda?: 'ARS' | 'USD';
  /** Su precio en dólares, si lo tiene. */
  precioUsdCentavos?: number | null;
  /** El dólar del día, para mostrar a cuánto queda en pesos. */
  tcCentavos?: number | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const [moneda, setMoneda] = useState<'ARS' | 'USD'>(monedaDeLaFicha);
  const [precio, setPrecio] = useState(() =>
    comoSeEscribe(monedaDeLaFicha === 'USD' ? (precioUsdCentavos ?? 0) : mostradorCentavos),
  );
  const [estado, setEstado] = useState<EstadoPrecio>({});
  const [enCurso, enTransicion] = useTransition();

  function cambiarMoneda(nueva: 'ARS' | 'USD') {
    if (nueva === moneda) return;
    setMoneda(nueva);
    /*
     * El número se limpia al cambiar de moneda, a propósito.
     *
     * Convertirlo sería adivinar: quien pasa un producto a dólares tiene el
     * precio en dólares en la cabeza —se lo acaba de pagar al proveedor—, no
     * quiere los pesos de hoy divididos por el dólar de hoy. Y dejar el número
     * viejo es peor: «630» pasaría de pesos a dólares sin que nadie lo note.
     */
    setPrecio(
      nueva === monedaDeLaFicha
        ? comoSeEscribe(nueva === 'USD' ? (precioUsdCentavos ?? 0) : mostradorCentavos)
        : '',
    );
  }

  function guardar() {
    const datos = new FormData();
    datos.set('productId', productId);
    datos.set('precio', precio);
    datos.set('moneda', moneda);
    enTransicion(async () => setEstado(await cambiarPrecioAccion({}, datos)));
  }

  /** A cuánto queda en pesos, para verlo antes de guardar. */
  const enPesos = (() => {
    if (moneda !== 'USD' || !tcCentavos) return null;
    const usd = Number(precio.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(usd) || usd <= 0) return null;
    return Math.round((Math.round(usd * 100) * tcCentavos) / 100 / 100_000) * 100_000;
  })();

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

        {/* Pesos o dólares. Un usado se compra y se vende en dólares, y hasta
            acá la única forma de que una ficha quedara en dólares era que
            viniera así de la tienda. */}
        <div className="flex items-center gap-1">
          <Moneda activa={moneda === 'ARS'} onClick={() => cambiarMoneda('ARS')} etiqueta="$" />
          <Moneda activa={moneda === 'USD'} onClick={() => cambiarMoneda('USD')} etiqueta="US$" />
        </div>

        <div className="flex items-center gap-1">
          <span aria-hidden="true" className="text-(--color-tinta-suave)">
            {moneda === 'USD' ? 'US$' : '$'}
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
            aria-label={`Precio de mostrador en ${moneda === 'USD' ? 'dólares' : 'pesos'}`}
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

      {moneda === 'USD' ? (
        <p className="text-xs text-(--color-tinta-suave)">
          {enPesos
            ? `Queda en ${formatearARS(enPesos)} con el dólar de hoy, y se reajusta solo cuando el dólar cambia.`
            : tcCentavos
              ? 'El precio en pesos lo calcula el dólar del día: no hay que escribirlo.'
              : 'Ojo: no hay cotización cargada. Cargá el dólar antes de guardar un precio en dólares.'}
        </p>
      ) : null}

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

/** Pesos o dólares, en dos botones chicos al lado del campo. */
function Moneda({
  activa,
  onClick,
  etiqueta,
}: {
  activa: boolean;
  onClick: () => void;
  etiqueta: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      aria-label={etiqueta === 'US$' ? 'Precio en dólares' : 'Precio en pesos'}
      className={`min-h-10 rounded-(--radius-caja) border px-2.5 text-sm font-semibold ${
        activa
          ? 'border-(--color-marca) bg-(--color-marca) text-(--color-marca-texto)'
          : 'border-(--color-borde) bg-(--color-papel) text-(--color-tinta-suave)'
      }`}
    >
      {etiqueta}
    </button>
  );
}
