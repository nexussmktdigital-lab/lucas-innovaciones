'use client';

import { useActionState } from 'react';
import {
  importarPlanillaAccion,
  revisarPlanillaAccion,
  type EstadoImportacion,
} from '@/app/acciones-catalogo';
import { formatearARS } from '@/lib/dinero';

const INICIAL: EstadoImportacion = {};

/**
 * Importar una planilla, en dos pasos.
 *
 * Primero se mira y despues se guarda. Una importacion que guarda y despues
 * avisa es una importacion que hay que deshacer a mano, renglon por renglon.
 */
export default function FormularioImportar({ ejemplo }: { ejemplo: string }) {
  const [revision, revisar, revisando] = useActionState(revisarPlanillaAccion, INICIAL);
  const [importe, importar, importando] = useActionState(importarPlanillaAccion, INICIAL);

  const r = revision.revision;

  return (
    <div className="space-y-4">
      <form action={revisar} aria-label="Pegar la planilla" className="space-y-2">
        <label htmlFor="csv" className="block text-sm font-medium">
          Pegá la planilla acá
        </label>
        <textarea
          id="csv"
          name="csv"
          rows={8}
          defaultValue={revision.csv}
          placeholder={ejemplo}
          className="w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-3 font-mono text-sm"
        />
        <p className="text-xs text-(--color-tinta-suave)">
          La primera fila son los títulos de las columnas. Hacen falta al menos{' '}
          <strong>nombre</strong> y <strong>precio</strong>; también se leen{' '}
          <strong>sku</strong>, <strong>categoria</strong>, <strong>marca</strong>,{' '}
          <strong>stock</strong> y <strong>codigo de barras</strong>. Sirve tal cual sale de
          Excel.
        </p>

        {revision.error ? (
          <p role="alert" className="text-sm font-medium text-(--color-error)">
            {revision.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={revisando}
          className="min-h-12 w-full rounded-(--radius-caja) border-2 border-(--color-marca) font-semibold disabled:opacity-60"
        >
          {revisando ? 'Leyendo…' : 'Ver qué va a pasar'}
        </button>
      </form>

      {r ? (
        <section
          aria-label="Lo que haría la planilla"
          className="space-y-3 rounded-(--radius-caja) border-2 border-(--color-marca) bg-(--color-panel) p-4"
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <Dato titulo="Se cargan" valor={r.altas} destacado />
            <Dato titulo="Ya estaban" valor={r.repetidos} />
            <Dato titulo="No se pueden leer" valor={r.rechazados} />
          </div>

          {r.categoriasNuevas.length > 0 ? (
            <p className="rounded-(--radius-caja) bg-(--color-alerta-fondo) p-3 text-sm">
              Estas categorías todavía no existen en el catálogo y se van a crear:{' '}
              <strong>{r.categoriasNuevas.join(', ')}</strong>. Si alguna está escrita distinto a
              como ya la tenés, corregila en la planilla antes de importar.
            </p>
          ) : null}

          <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {r.renglones.map((x) => (
              <li
                key={x.linea}
                className={`flex flex-wrap items-baseline gap-x-2 rounded-(--radius-caja) p-2 text-sm ${
                  x.destino === 'alta'
                    ? 'bg-(--color-papel)'
                    : x.destino === 'repetido'
                      ? 'bg-(--color-alerta-fondo)'
                      : 'bg-(--color-error-fondo)'
                }`}
              >
                <span className="tabular w-8 shrink-0 text-xs text-(--color-tinta-suave)">
                  {x.linea}
                </span>
                <span className="font-medium">{x.nombre || '(sin nombre)'}</span>
                {x.categoria ? (
                  <span className="text-xs text-(--color-tinta-suave)">{x.categoria}</span>
                ) : null}
                <span className="tabular ml-auto">{formatearARS(x.precioCentavos)}</span>
                {x.destino === 'alta' ? (
                  <span className="tabular text-xs text-(--color-tinta-suave)">
                    {x.stock} u.
                  </span>
                ) : (
                  <span className="w-full text-xs text-(--color-tinta-suave)">{x.motivo}</span>
                )}
              </li>
            ))}
          </ul>

          {r.altas > 0 ? (
            <form action={importar}>
              <input type="hidden" name="csv" value={revision.csv ?? ''} />
              {importe.error ? (
                <p role="alert" className="mb-2 text-sm font-medium text-(--color-error)">
                  {importe.error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={importando}
                className="min-h-12 w-full rounded-(--radius-caja) bg-(--color-marca) font-semibold text-(--color-marca-texto) disabled:opacity-60"
              >
                {importando ? 'Cargando…' : `Cargar los ${r.altas}`}
              </button>
            </form>
          ) : (
            <p className="text-sm text-(--color-tinta-suave)">
              No hay nada nuevo para cargar en esta planilla.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Dato({
  titulo,
  valor,
  destacado = false,
}: {
  titulo: string;
  valor: number;
  destacado?: boolean;
}) {
  return (
    <div className="rounded-(--radius-caja) bg-(--color-papel) p-3">
      <p className="text-sm text-(--color-tinta-suave)">{titulo}</p>
      <p className={`tabular text-2xl font-bold ${destacado ? 'text-(--color-ok)' : ''}`}>
        {valor}
      </p>
    </div>
  );
}
