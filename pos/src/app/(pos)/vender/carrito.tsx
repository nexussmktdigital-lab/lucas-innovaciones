'use client';

import { useState } from 'react';
import { aCentavos, formatearARS, formatearUSD } from '@/lib/dinero';
import type { Descuento, TotalesCarrito } from '@/ventas/carrito';
import type { Cliente, LineaEnPantalla } from './pantalla-venta';
import NuevoCliente from './nuevo-cliente';

interface Props {
  lineas: LineaEnPantalla[];
  totales: TotalesCarrito;
  descuentoGlobal: Descuento | null;
  puedeDescontar: boolean;
  clientes: Cliente[];
  clienteId: string | null;
  /** Solo el dueño puede fiar, así que solo a él le sirve ver la deuda. */
  puedeFiar: boolean;
  tcCentavos: number | null;
  onCantidad: (clave: string, cantidad: number) => void;
  onPrecio: (clave: string, centavos: number) => void;
  onDescuentoDeLinea: (clave: string, centavos: number) => void;
  onDescuentoGlobal: (d: Descuento | null) => void;
  onCliente: (id: string | null) => void;
  /** Un cliente recién cargado desde acá, para agregarlo a la lista y elegirlo. */
  onClienteCreado: (cliente: Cliente) => void;
  onQuitar: (clave: string) => void;
  onVaciar: () => void;
  onCobrar: () => void;
}

/** Presets de descuento, los mismos que usa el POS actual. */
const PRESETS = [5, 10, 15, 20];

export default function Carrito({
  lineas,
  totales,
  descuentoGlobal,
  puedeDescontar,
  clientes,
  clienteId,
  puedeFiar,
  tcCentavos,
  onCantidad,
  onPrecio,
  onDescuentoDeLinea,
  onDescuentoGlobal,
  onCliente,
  onClienteCreado,
  onQuitar,
  onVaciar,
  onCobrar,
}: Props) {
  const vacio = lineas.length === 0;
  const elegido = clientes.find((c) => c.id === clienteId) ?? null;
  const [cargandoCliente, setCargandoCliente] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">
          Carrito{' '}
          {!vacio ? (
            <span className="text-sm font-normal text-(--color-tinta-suave)">
              {totales.unidades} {totales.unidades === 1 ? 'unidad' : 'unidades'}
            </span>
          ) : null}
        </h2>
        {!vacio ? (
          <button
            type="button"
            onClick={onVaciar}
            className="text-sm text-(--color-tinta-suave) underline underline-offset-2"
          >
            Vaciar
          </button>
        ) : null}
      </div>

      {vacio ? (
        <p className="py-8 text-center text-sm text-(--color-tinta-suave)">
          Buscá un producto y tocá Enter para agregarlo.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-(--color-borde)">
          {lineas.map((l) => (
            <li key={l.clave} className="py-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{l.descripcion}</div>
                  {l.monedaOriginal === 'USD' && l.precioUsdCentavos ? (
                    <div className="text-xs text-(--color-tinta-suave)">
                      {formatearUSD(l.precioUsdCentavos)} c/u
                      {tcCentavos ? ` · dólar ${formatearARS(tcCentavos)}` : ''}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onQuitar(l.clave)}
                  aria-label={`Quitar ${l.descripcion}`}
                  className="shrink-0 rounded px-1.5 text-(--color-tinta-suave) hover:text-(--color-error)"
                >
                  ✕
                </button>
              </div>

              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex items-center rounded-(--radius-caja) border border-(--color-borde)">
                  <button
                    type="button"
                    onClick={() => onCantidad(l.clave, l.cantidad - 1)}
                    aria-label="Menos uno"
                    className="min-h-9 w-9 text-lg leading-none"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={l.cantidad}
                    onChange={(e) => onCantidad(l.clave, Number(e.target.value))}
                    aria-label={`Cantidad de ${l.descripcion}`}
                    className="tabular w-12 border-x border-(--color-borde) bg-transparent py-1.5 text-center"
                  />
                  <button
                    type="button"
                    onClick={() => onCantidad(l.clave, l.cantidad + 1)}
                    aria-label="Uno más"
                    className="min-h-9 w-9 text-lg leading-none"
                  >
                    +
                  </button>
                </div>

                {l.precioEditable ? (
                  <MontoEditable
                    valor={l.precioUnitarioCentavos}
                    etiqueta={`Precio de ${l.descripcion}`}
                    onCambio={(c) => onPrecio(l.clave, c)}
                  />
                ) : (
                  <span className="tabular whitespace-nowrap text-sm text-(--color-tinta-suave)">
                    × {formatearARS(l.precioUnitarioCentavos)}
                  </span>
                )}

                <span className="tabular ml-auto font-semibold">
                  {formatearARS(Math.max(0, l.precioUnitarioCentavos * l.cantidad - l.descuentoCentavos))}
                </span>
              </div>

              {puedeDescontar ? (
                <div className="mt-1.5 flex items-center gap-2 text-xs">
                  <span className="text-(--color-tinta-suave)">Descuento</span>
                  <MontoEditable
                    valor={l.descuentoCentavos}
                    etiqueta={`Descuento de ${l.descripcion}`}
                    onCambio={(c) => onDescuentoDeLinea(l.clave, c)}
                    chico
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!vacio ? (
        <>
          <div className="border-t border-(--color-borde) pt-3">
            <div className="mb-1 flex items-baseline justify-between">
              <label htmlFor="cliente" className="text-xs text-(--color-tinta-suave)">
                Cliente (opcional en contado, obligatorio para fiar)
              </label>
              {/* Abre el alta acá mismo. Antes esto llevaba a otra pestaña, y
                  volver con el carrito armado dependía de la suerte. */}
              <button
                type="button"
                onClick={() => setCargandoCliente((x) => !x)}
                className="text-xs underline underline-offset-2"
              >
                {cargandoCliente ? 'Cerrar' : '+ Nuevo'}
              </button>
            </div>
            <select
              id="cliente"
              value={clienteId ?? ''}
              onChange={(e) => onCliente(e.target.value || null)}
              className="min-h-10 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2"
            >
              <option value="">Sin cliente</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                  {c.saldoCentavos > 0 ? ` — debe ${formatearARS(c.saldoCentavos)}` : ''}
                </option>
              ))}
            </select>

            {cargandoCliente ? (
              <NuevoCliente
                onCreado={(c) => {
                  onClienteCreado(c);
                  setCargandoCliente(false);
                }}
                onCancelar={() => setCargandoCliente(false)}
              />
            ) : null}

            {puedeFiar && elegido && elegido.saldoCentavos > 0 ? (
              <p className="mt-1 text-xs text-(--color-alerta)">
                Ya debe{' '}
                <span className="tabular font-semibold">
                  {formatearARS(elegido.saldoCentavos)}
                </span>
                {elegido.limiteCentavos !== null
                  ? `, y su tope es ${formatearARS(elegido.limiteCentavos)}.`
                  : '.'}
              </p>
            ) : null}
          </div>

          {puedeDescontar ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-(--color-tinta-suave)">Descuento total</span>
              {PRESETS.map((p) => {
                const activo =
                  descuentoGlobal?.tipo === 'porcentaje' && descuentoGlobal.porcentaje === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      onDescuentoGlobal(activo ? null : { tipo: 'porcentaje', porcentaje: p })
                    }
                    className={`min-h-8 rounded-(--radius-caja) border px-2 font-medium ${
                      activo
                        ? 'border-(--color-marca) bg-(--color-marca) text-white'
                        : 'border-(--color-borde)'
                    }`}
                  >
                    {p}%
                  </button>
                );
              })}
              {descuentoGlobal ? (
                <button
                  type="button"
                  onClick={() => onDescuentoGlobal(null)}
                  className="text-(--color-tinta-suave) underline underline-offset-2"
                >
                  Quitar
                </button>
              ) : null}
            </div>
          ) : null}

          <dl className="flex flex-col gap-1 border-t border-(--color-borde) pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-(--color-tinta-suave)">Subtotal</dt>
              <dd className="tabular">{formatearARS(totales.subtotalCentavos)}</dd>
            </div>
            {totales.descuentoLineasCentavos + totales.descuentoGlobalCentavos > 0 ? (
              <div className="flex justify-between">
                <dt className="text-(--color-tinta-suave)">Descuentos</dt>
                <dd className="tabular">
                  −
                  {formatearARS(
                    totales.descuentoLineasCentavos + totales.descuentoGlobalCentavos,
                  )}
                </dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between pt-1">
              <dt className="font-semibold">Total</dt>
              <dd className="tabular text-2xl font-bold">
                {formatearARS(totales.totalCentavos)}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={onCobrar}
            className="min-h-14 w-full rounded-(--radius-caja) bg-(--color-marca) text-lg font-bold text-white transition hover:bg-(--color-marca-fuerte)"
          >
            Cobrar <kbd className="ml-1 text-sm font-normal opacity-75">F12</kbd>
          </button>
        </>
      ) : null}
    </div>
  );
}

/** Campo de plata: la persona escribe pesos, el sistema guarda centavos. */
function MontoEditable({
  valor,
  etiqueta,
  onCambio,
  chico,
}: {
  valor: number;
  etiqueta: string;
  onCambio: (centavos: number) => void;
  chico?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      defaultValue={valor === 0 ? '' : String(valor / 100)}
      aria-label={etiqueta}
      placeholder="0"
      onBlur={(e) => {
        const crudo = e.target.value.trim();
        try {
          onCambio(crudo === '' ? 0 : aCentavos(crudo));
        } catch {
          e.target.value = String(valor / 100);
        }
      }}
      className={`tabular rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2 text-right ${
        chico ? 'min-h-8 w-24 text-xs' : 'min-h-9 w-28 text-sm'
      }`}
    />
  );
}
