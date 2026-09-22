import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { formatearARS, formatearUSD } from '@/lib/dinero';
import { alcanceDelRecargo, recargoDeTienda } from '@/precios/config';
import { formatearRecargo } from '@/precios/mostrador';
import { listarPrecios } from '@/precios/listado';
import FormularioRecargo from './formulario-recargo';
import FormularioPrecioLocal from './formulario-precio-local';

export const dynamic = 'force-dynamic';

/**
 * Precios: mostrador y tienda.
 *
 * En la tienda cobra Mercado Pago y esa comisión no la paga el local, así que
 * el mismo producto vale distinto en cada lado. Acá se ve la diferencia
 * producto por producto y se decide el porcentaje que las separa (D31).
 */
export default async function PaginaPrecios({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sesion = await auth();
  if (sesion?.user.rol !== 'owner') redirect('/');

  const { q } = await searchParams;
  const recargoBp = await recargoDeTienda(db);
  const alcance = await alcanceDelRecargo(db);
  const listado = await listarPrecios(db, { q, recargoTiendaBp: recargoBp });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-titulo text-2xl font-bold tracking-tight">Precios</h1>
        <p className="mt-1 text-sm text-(--color-tinta-suave)">
          En WooCommerce vive el precio de la tienda, que es el que cobra la web. El del mostrador
          se calcula descontándole el recargo, así no hay dos números que mantener por producto.
        </p>
      </div>

      <FormularioRecargo recargoBp={recargoBp} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Dato
          titulo="Con recargo"
          valor={alcance.conRecargo.toLocaleString('es-AR')}
          detalle="Se publican en la tienda"
        />
        <Dato
          titulo="Solo mostrador"
          valor={alcance.soloMostrador.toLocaleString('es-AR')}
          detalle="Servicios y lo que no va a la web: cobran el mismo precio"
        />
        <Dato
          titulo="Con precio propio"
          valor={alcance.conPrecioPropio.toLocaleString('es-AR')}
          detalle="Escrito a mano, no sale del cálculo"
        />
      </div>

      <form className="flex gap-2" action="/precios">
        <label htmlFor="q" className="sr-only">
          Buscar producto
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q ?? ''}
          placeholder="Buscar por nombre o SKU…"
          className="min-h-11 flex-1 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-3"
        />
        <button
          type="submit"
          className="min-h-11 rounded-(--radius-caja) bg-(--color-marca) px-4 font-semibold text-(--color-marca-texto)"
        >
          Buscar
        </button>
      </form>

      {listado.productos.length === 0 ? (
        <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-6 text-center text-sm text-(--color-tinta-suave)">
          No hay productos que coincidan.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {listado.productos.map((p) => (
            <li
              key={p.id}
              className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium">{p.nombre}</span>
                {p.sku ? (
                  <span className="text-xs text-(--color-tinta-suave)">{p.sku}</span>
                ) : null}
                {p.soloMostrador ? (
                  <span className="rounded bg-(--color-papel) px-1.5 py-0.5 text-xs font-semibold text-(--color-tinta-suave)">
                    Solo mostrador
                  </span>
                ) : null}
                {p.variaciones > 0 ? (
                  <span className="text-xs text-(--color-tinta-suave)">
                    · {p.variaciones} variaciones
                  </span>
                ) : null}
              </div>

              <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
                <Precio
                  titulo="Tienda"
                  valor={formatearARS(p.precioTiendaCentavos)}
                  detalle={
                    p.moneda === 'USD' && p.precioUsdCentavos
                      ? formatearUSD(p.precioUsdCentavos)
                      : p.soloMostrador
                        ? 'no se publica'
                        : 'en WooCommerce'
                  }
                />
                <Precio
                  titulo="Mostrador"
                  valor={formatearARS(p.precioMostradorCentavos)}
                  detalle={
                    p.precioLocalCentavos !== null
                      ? 'escrito a mano'
                      : p.soloMostrador
                        ? 'no lleva recargo'
                        : recargoBp > 0
                          ? `menos ${formatearRecargo(recargoBp)}`
                          : 'sin recargo cargado'
                  }
                  fuerte
                />

                <div className="ml-auto">
                  <FormularioPrecioLocal
                    productId={p.id}
                    nombre={p.nombre}
                    precioLocalCentavos={p.precioLocalCentavos}
                    esUsd={p.moneda === 'USD'}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {listado.total > listado.productos.length ? (
        <p className="text-center text-sm text-(--color-tinta-suave)">
          Se muestran {listado.productos.length} de {listado.total.toLocaleString('es-AR')}.
          Buscá por nombre o SKU para llegar al resto.
        </p>
      ) : null}

    </div>
  );
}

function Precio({
  titulo,
  valor,
  detalle,
  fuerte,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  fuerte?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-(--color-tinta-suave)">{titulo}</p>
      <p className={`tabular ${fuerte ? 'text-xl font-bold' : 'text-lg'}`}>{valor}</p>
      <p className="text-xs text-(--color-tinta-suave)">{detalle}</p>
    </div>
  );
}

function Dato({ titulo, valor, detalle }: { titulo: string; valor: string; detalle: string }) {
  return (
    <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
      <p className="text-xs font-bold tracking-[0.08em] text-(--color-tinta-suave) uppercase">
        {titulo}
      </p>
      <p className="cifra mt-1 text-[32px] leading-tight">{valor}</p>
      <p className="text-xs text-(--color-tinta-suave)">{detalle}</p>
    </div>
  );
}
