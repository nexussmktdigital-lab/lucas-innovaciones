'use client';

import { useActionState, useState } from 'react';
import { guardarRecargoAccion, type EstadoPrecios } from '@/app/acciones-precios';
import { formatearARS } from '@/lib/dinero';
import { formatearRecargo, precioDeTienda, recargoParaCubrir } from '@/precios/mostrador';

const INICIAL: EstadoPrecios = {};

/** Precio de ejemplo para que se vea la cuenta mientras se escribe. */
const EJEMPLO_CENTAVOS = 50_000_00;

export default function FormularioRecargo({ recargoBp }: { recargoBp: number }) {
  const [estado, accion, pendiente] = useActionState(guardarRecargoAccion, INICIAL);
  const [texto, setTexto] = useState(String(recargoBp / 100));
  const [comision, setComision] = useState('');
  const [mantener, setMantener] = useState(true);

  const bp = leerPorcentaje(texto);
  const comisionBp = leerPorcentaje(comision);
  const sugerido = comisionBp === null ? null : recargoParaCubrir(comisionBp);

  return (
    <form
      action={accion}
      className="space-y-3 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4"
    >
      <div>
        <label htmlFor="recargo" className="block font-semibold">
          Recargo de la tienda online
        </label>
        <p className="mt-0.5 text-sm text-(--color-tinta-suave)">
          Cuánto más caro está un producto en la web que en el mostrador. Es un solo número para
          todo el catálogo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          id="recargo"
          name="recargo"
          type="text"
          inputMode="decimal"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="tabular min-h-11 w-28 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 text-right text-lg"
        />
        <span className="text-lg">%</span>
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-11 rounded-(--radius-caja) bg-(--color-marca) px-4 font-semibold text-(--color-marca-texto) disabled:opacity-60"
        >
          {pendiente ? 'Guardando…' : 'Guardar'}
        </button>

        {bp !== null ? (
          <p className="text-sm text-(--color-tinta-suave)">
            Un producto de{' '}
            <span className="tabular font-medium">{formatearARS(EJEMPLO_CENTAVOS)}</span> en el
            mostrador va a{' '}
            <span className="tabular font-medium text-(--color-tinta)">
              {formatearARS(precioDeTienda(EJEMPLO_CENTAVOS, bp))}
            </span>{' '}
            en la tienda.
          </p>
        ) : null}
      </div>

      {/*
        Viene marcada de fábrica, y es la lección del 21/10: sin esto, subir el
        recargo no sube los precios de la web, baja los del mostrador. Casi
        nadie quiere eso, así que es lo que hay que pedir a propósito.
      */}
      <label className="flex items-start gap-2 rounded-(--radius-caja) bg-(--color-papel) p-3 text-sm">
        <input
          type="checkbox"
          name="mantenerMostrador"
          value="si"
          checked={mantener}
          onChange={(e) => setMantener(e.target.checked)}
          className="mt-0.5 size-4 shrink-0"
        />
        <span>
          <span className="font-medium">Que el mostrador siga cobrando lo mismo.</span>{' '}
          <span className="text-(--color-tinta-suave)">
            Reescribe los precios de la web para que el cambio lo absorba la tienda. Sin esto, el
            precio de la web queda igual y el que se mueve es el del local.
          </span>
        </span>
      </label>

      {estado.vistaPrevia ? (
        <div className="space-y-2 rounded-(--radius-caja) border-2 border-(--color-marca) p-3">
          <p className="text-sm">
            Pasar de{' '}
            <span className="font-semibold">{formatearRecargo(estado.vistaPrevia.bpAnterior)}</span>{' '}
            a <span className="font-semibold">{formatearRecargo(estado.vistaPrevia.bpNuevo)}</span>{' '}
            cambia{' '}
            <span className="font-semibold">
              {estado.vistaPrevia.total.toLocaleString('es-AR')} precios de la web
            </span>
            . Ningún precio de mostrador se mueve. Todavía no se guardó nada.
          </p>

          {/*
            La columna del mostrador se esconde en pantalla chica: es la que
            no cambia —lo dice la línea de arriba— y en 375 px lo que importa
            es que entren los dos números que sí se mueven, sin recortarse.
          */}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-(--color-tinta-suave)">
                <th className="font-normal">Producto</th>
                <th className="hidden font-normal sm:table-cell">Mostrador</th>
                <th className="text-right font-normal">Web ahora</th>
                <th className="text-right font-normal">Web después</th>
              </tr>
            </thead>
            <tbody>
              {estado.vistaPrevia.muestra.map((c) => (
                <tr key={c.nombre} className="border-t border-(--color-borde)">
                  <td className="py-1 pr-2">{c.nombre}</td>
                  <td className="tabular hidden py-1 pr-2 whitespace-nowrap sm:table-cell">
                    {formatearARS(c.mostradorCentavos)}
                  </td>
                  <td className="tabular py-1 pr-2 text-right whitespace-nowrap text-(--color-tinta-suave)">
                    {formatearARS(c.antesCentavos)}
                  </td>
                  <td className="tabular py-1 text-right font-semibold whitespace-nowrap">
                    {formatearARS(c.despuesCentavos)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {estado.vistaPrevia.total > estado.vistaPrevia.muestra.length ? (
            <p className="text-xs text-(--color-tinta-suave)">
              …y {(estado.vistaPrevia.total - estado.vistaPrevia.muestra.length).toLocaleString('es-AR')}{' '}
              más, todos con la misma cuenta.
            </p>
          ) : null}

          <input type="hidden" name="bpPrevisto" value={estado.vistaPrevia.bpNuevo} />
          <button
            type="submit"
            name="confirmado"
            value="1"
            disabled={pendiente}
            className="min-h-11 rounded-(--radius-caja) bg-(--color-marca) px-4 font-semibold text-(--color-marca-texto) disabled:opacity-60"
          >
            {pendiente ? 'Aplicando…' : `Aplicar los ${estado.vistaPrevia.total.toLocaleString('es-AR')} cambios`}
          </button>
        </div>
      ) : null}

      {estado.error ? (
        <p role="alert" className="text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}
      {estado.ok ? (
        <p role="status" className="text-sm font-medium text-(--color-ok)">
          {estado.ok}
        </p>
      ) : null}

      <details className="border-t border-(--color-borde) pt-3 text-sm">
        <summary className="cursor-pointer font-medium">
          ¿Qué recargo cubre la comisión de Mercado Pago?
        </summary>
        <div className="mt-2 space-y-2 text-(--color-tinta-media)">
          <p>
            No alcanza con sumarle la comisión al precio: Mercado Pago se la lleva del total
            cobrado, no del precio de lista. Poné la comisión que te figura en tu panel y te digo
            el recargo que la cubre justo.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="comision" className="text-(--color-tinta-suave)">
              Comisión
            </label>
            <input
              id="comision"
              type="text"
              inputMode="decimal"
              value={comision}
              onChange={(e) => setComision(e.target.value)}
              placeholder="6,29"
              className="tabular min-h-10 w-24 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2 text-right"
            />
            <span>%</span>
            {sugerido !== null ? (
              <p>
                → hace falta un recargo de{' '}
                <button
                  type="button"
                  onClick={() => setTexto(String(sugerido / 100))}
                  className="font-semibold underline underline-offset-2"
                >
                  {(sugerido / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%
                </button>{' '}
                para que te quede lo mismo que en el mostrador.
              </p>
            ) : null}
          </div>
          <p className="text-xs text-(--color-tinta-suave)">
            Fijate si el porcentaje que ves en Mercado Pago ya tiene el IVA de la comisión adentro.
            Si no lo tiene, tu costo real es más alto que ese número.
          </p>
        </div>
      </details>
    </form>
  );
}

/** «12», «12,5» o «12.5» a puntos básicos. null si todavía no se puede leer. */
function leerPorcentaje(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (limpio === '' || !/^\d+(\.\d+)?$/.test(limpio)) return null;
  const bp = Math.round(Number(limpio) * 100);
  return bp >= 0 && bp <= 10_000 ? bp : null;
}
