'use client';

import { useActionState } from 'react';
import {
  importarPlanillaAccion,
  revisarPlanillaAccion,
  type EstadoImportacion,
} from '@/app/acciones-catalogo';
import { formatearARS } from '@/lib/dinero';
import type { DestinoEntrega } from '@/catalogo/entrega';

const INICIAL: EstadoImportacion = {};

/**
 * Cargar una entrega de mercadería, en dos pasos.
 *
 * Primero se mira y después se guarda. Una carga que guarda y después avisa es
 * una carga que hay que deshacer a mano, renglón por renglón — y acá hay bajas.
 *
 * **Un solo cuadro de texto para las dos formas de pegar la entrega**: la
 * planilla de Excel y la lista escrita a mano. Elegir entre dos cuadros es una
 * decisión más con el proveedor esperando, y es una decisión que el programa
 * toma solo: una planilla siempre arranca con la fila de títulos.
 */
export default function FormularioImportar({
  ejemploPlanilla,
  ejemploLista,
}: {
  ejemploPlanilla: string;
  ejemploLista: string;
}) {
  const [revision, revisar, revisando] = useActionState(revisarPlanillaAccion, INICIAL);
  const [importe, importar, importando] = useActionState(importarPlanillaAccion, INICIAL);

  const r = revision.revision;
  const e = revision.entrega;
  const aAplicar = e ? e.altas + e.sumas + e.bajas : 0;

  return (
    <div className="space-y-4">
      <form action={revisar} aria-label="Pegar la entrega" className="space-y-2">
        <label htmlFor="texto" className="block text-sm font-medium">
          Pegá la lista o la planilla acá
        </label>
        <textarea
          id="texto"
          name="texto"
          rows={10}
          defaultValue={revision.texto}
          placeholder={ejemploLista}
          className="w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-3 font-mono text-sm"
        />

        <details className="text-xs text-(--color-tinta-suave)">
          <summary className="cursor-pointer font-medium text-(--color-tinta)">
            Cómo se escribe cada renglón
          </summary>
          <div className="mt-2 space-y-1.5">
            <p>
              Un producto por renglón: <strong>nombre</strong>, entre paréntesis{' '}
              <strong>cuántos llegaron</strong>, y después el <strong>costo</strong> y el{' '}
              <strong>precio al público</strong>, en ese orden.
            </p>
            <pre className="overflow-x-auto rounded-(--radius-caja) bg-(--color-papel) p-2">
              {ejemploLista}
            </pre>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                <strong>Sin precios</strong> quiere decir que el producto ya está en el catálogo y
                solo hay que sumarle lo que llegó. El precio no se toca.
              </li>
              <li>
                <strong>(eliminar)</strong> lo saca del catálogo y de la tienda. Busca el nombre{' '}
                <strong>exacto</strong>: si no lo encuentra, no da de baja nada parecido.
              </li>
              <li>
                <strong>Sin paréntesis</strong> es una unidad. Un número de cuatro cifras o más
                —un iPhone usado— es el final del IMEI, no una cantidad: entra de a uno y el
                número queda en el nombre.
              </li>
              <li>
                Los precios van <strong>en pesos</strong>. Si la lista viene en dólares, el
                renglón se marca y no se carga.
              </li>
            </ul>
            <p className="pt-1">
              También sirve una <strong>planilla de Excel</strong> tal cual sale: la primera fila
              son los títulos de las columnas, con al menos <strong>nombre</strong> y{' '}
              <strong>precio</strong> (y si están, <strong>sku</strong>,{' '}
              <strong>categoria</strong>, <strong>marca</strong>, <strong>stock</strong>,{' '}
              <strong>costo</strong> y <strong>codigo de barras</strong>).
            </p>
            <pre className="overflow-x-auto rounded-(--radius-caja) bg-(--color-papel) p-2">
              {ejemploPlanilla}
            </pre>
          </div>
        </details>

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

      {e ? (
        <section
          aria-label="Lo que haría la entrega"
          className="space-y-3 rounded-(--radius-caja) border-2 border-(--color-marca) bg-(--color-panel) p-4"
        >
          <div className="grid gap-2 sm:grid-cols-4">
            <Dato titulo="Se cargan" valor={e.altas} destacado />
            <Dato titulo="Suman stock" valor={e.sumas} />
            <Dato titulo="Se dan de baja" valor={e.bajas} />
            <Dato titulo="No se entienden" valor={e.rechazados} />
          </div>

          {e.unidades > 0 ? (
            <p className="text-sm text-(--color-tinta-suave)">
              Entran <strong className="tabular">{e.unidades}</strong> unidades en total.
            </p>
          ) : null}

          <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {e.renglones.map((x) => (
              <li
                key={x.linea}
                className={`flex flex-wrap items-baseline gap-x-2 rounded-(--radius-caja) p-2 text-sm ${fondo(x.destino)}`}
              >
                <span className="tabular w-8 shrink-0 text-xs text-(--color-tinta-suave)">
                  {x.linea}
                </span>
                <span className="font-medium">{x.nombre || '(sin nombre)'}</span>
                <span className="text-xs font-semibold text-(--color-tinta-media)">
                  {etiqueta(x.destino)}
                </span>
                {x.destino !== 'baja' && x.destino !== 'rechazado' ? (
                  <span className="tabular text-xs text-(--color-tinta-suave)">
                    {x.cantidad} u.
                  </span>
                ) : null}
                {x.precioCentavos !== null ? (
                  <span className="tabular ml-auto">{formatearARS(x.precioCentavos)}</span>
                ) : null}
                {x.motivo ? (
                  <span className="w-full text-xs text-(--color-tinta-suave)">{x.motivo}</span>
                ) : null}
              </li>
            ))}
          </ul>

          {aAplicar > 0 ? (
            <form action={importar}>
              <input type="hidden" name="texto" value={revision.texto ?? ''} />
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
                {importando ? 'Aplicando…' : `Aplicar los ${aAplicar} renglones`}
              </button>
            </form>
          ) : (
            <p className="text-sm text-(--color-tinta-suave)">
              No hay nada para aplicar en esta lista.
            </p>
          )}
        </section>
      ) : null}

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
              <input type="hidden" name="texto" value={revision.texto ?? ''} />
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

function fondo(destino: DestinoEntrega): string {
  if (destino === 'rechazado') return 'bg-(--color-error-fondo)';
  if (destino === 'baja') return 'bg-(--color-alerta-fondo)';
  return 'bg-(--color-papel)';
}

function etiqueta(destino: DestinoEntrega): string {
  if (destino === 'alta') return 'nuevo';
  if (destino === 'stock') return 'suma stock';
  if (destino === 'baja') return 'baja';
  return 'no se entiende';
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
