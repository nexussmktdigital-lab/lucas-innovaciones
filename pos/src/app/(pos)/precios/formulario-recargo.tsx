'use client';

import { useActionState, useState } from 'react';
import { guardarRecargoAccion, type EstadoPrecios } from '@/app/acciones-precios';
import { formatearARS } from '@/lib/dinero';
import { precioDeTienda, recargoParaCubrir } from '@/precios/mostrador';

const INICIAL: EstadoPrecios = {};

/** Precio de ejemplo para que se vea la cuenta mientras se escribe. */
const EJEMPLO_CENTAVOS = 50_000_00;

export default function FormularioRecargo({ recargoBp }: { recargoBp: number }) {
  const [estado, accion, pendiente] = useActionState(guardarRecargoAccion, INICIAL);
  const [texto, setTexto] = useState(String(recargoBp / 100));
  const [comision, setComision] = useState('');

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
          className="min-h-11 rounded-(--radius-caja) bg-(--color-marca) px-4 font-semibold text-white disabled:opacity-60"
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
