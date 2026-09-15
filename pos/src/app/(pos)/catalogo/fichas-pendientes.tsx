'use client';

import { useActionState } from 'react';
import {
  fichaListaAccion,
  publicarProductoAccion,
  type EstadoCatalogo,
} from '@/app/acciones-catalogo';
import { formatearARS } from '@/lib/dinero';
import type { FichaPendiente } from '@/catalogo/crear';

const INICIAL: EstadoCatalogo = {};

/**
 * Las fichas que quedaron a medias.
 *
 * Es la contrapartida del alta rapida: si esta lista no existiera, «rapida»
 * querria decir «a medias y para siempre», que es exactamente como el catalogo
 * llego a tener 93 productos sin SKU.
 */
export default function FichasPendientes({
  fichas,
  total,
  wooUrl,
}: {
  fichas: FichaPendiente[];
  /** Cuántas hay en total: la lista viene cortada. */
  total: number;
  wooUrl: string | null;
}) {
  if (fichas.length === 0) return null;

  return (
    <section aria-label="Fichas por completar" className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-(--color-tinta-suave)">
          Cargados en el mostrador · {total}
          {total > fichas.length ? ` · se muestran ${fichas.length}` : ''}
        </h2>
        <p className="text-xs text-(--color-tinta-suave)">
          Se venden en el local. No están en la tienda online hasta que alguien los publique.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {fichas.map((f) => (
          <Fila key={f.id} ficha={f} wooUrl={wooUrl} />
        ))}
      </ul>
    </section>
  );
}

function Fila({ ficha, wooUrl }: { ficha: FichaPendiente; wooUrl: string | null }) {
  const [publicado, publicar, publicando] = useActionState(publicarProductoAccion, INICIAL);
  const [listo, marcarLista, marcando] = useActionState(fichaListaAccion, INICIAL);

  const estaEnLaTienda = ficha.wooId !== null;

  return (
    <li className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{ficha.nombre}</span>
        {ficha.sku ? (
          <span className="tabular text-xs text-(--color-tinta-suave)">{ficha.sku}</span>
        ) : null}
        {ficha.categoria ? (
          <span className="text-xs text-(--color-tinta-suave)">{ficha.categoria}</span>
        ) : null}
        <span className="tabular ml-auto font-semibold">
          {formatearARS(ficha.precioCentavos)}
        </span>
        {!ficha.esServicio ? (
          <span className="tabular text-xs text-(--color-tinta-suave)">{ficha.stock} u.</span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {estaEnLaTienda ? (
          <>
            <span className="rounded bg-(--color-ok)/15 px-2 py-1 text-xs font-semibold text-(--color-ok)">
              En la tienda
            </span>
            {wooUrl ? (
              <a
                href={`${wooUrl}/wp-admin/post.php?post=${ficha.wooId}&action=edit`}
                target="_blank"
                rel="noreferrer"
                className="text-sm underline underline-offset-2"
              >
                Completar la ficha en WooCommerce
              </a>
            ) : null}
          </>
        ) : (
          <form action={publicar}>
            <input type="hidden" name="productId" value={ficha.id} />
            <button
              type="submit"
              disabled={publicando}
              className="min-h-10 rounded-(--radius-caja) border border-(--color-marca) px-3 text-sm font-medium disabled:opacity-60"
            >
              {publicando ? 'Publicando…' : 'Publicar en la tienda'}
            </button>
          </form>
        )}

        <form action={marcarLista} className="ml-auto">
          <input type="hidden" name="productId" value={ficha.id} />
          <button
            type="submit"
            disabled={marcando}
            className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) px-3 text-sm disabled:opacity-60"
          >
            {marcando ? 'Guardando…' : 'La ficha ya está'}
          </button>
        </form>
      </div>

      {publicado.ok ? (
        <p role="status" className="mt-2 text-sm text-(--color-ok)">
          {publicado.ok}
        </p>
      ) : null}
      {publicado.error ? (
        <p role="alert" className="mt-2 text-sm text-(--color-error)">
          {publicado.error}
        </p>
      ) : null}
      {listo.error ? (
        <p role="alert" className="mt-2 text-sm text-(--color-error)">
          {listo.error}
        </p>
      ) : null}
    </li>
  );
}
