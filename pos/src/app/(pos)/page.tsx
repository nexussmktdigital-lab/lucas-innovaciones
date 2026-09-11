import { count, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { exchangeRates, products } from '@/db/schema';
import { formatearARS, formatearUSD } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/fecha';

export const dynamic = 'force-dynamic';

/**
 * Inicio: estado del espejo del catalogo y calidad de la carga.
 *
 * En la fase 1 esta pantalla es la prueba de que la sincronizacion con
 * WooCommerce funciona. Las metricas de calidad se quedan: son las que el
 * negocio necesita mirar todos los meses.
 */
export default async function PaginaInicio() {
  const [resumen] = await db
    .select({
      total: count(),
      activos: sql<number>`count(*) filter (where ${products.activo})`.mapWith(Number),
      enDolares: sql<number>`count(*) filter (where ${products.moneda} = 'USD')`.mapWith(Number),
      sinFoto: sql<number>`count(*) filter (where ${products.imagenUrl} is null)`.mapWith(Number),
      sinSku: sql<number>`count(*) filter (where ${products.sku} is null)`.mapWith(Number),
      incompletos: sql<number>`count(*) filter (where ${products.fichaIncompleta})`.mapWith(Number),
      servicios: sql<number>`count(*) filter (where ${products.esServicio})`.mapWith(Number),
    })
    .from(products);

  const [ultimaSync] = await db
    .select({ cuando: products.lastSyncedAt })
    .from(products)
    .where(isNotNull(products.lastSyncedAt))
    .orderBy(desc(products.lastSyncedAt))
    .limit(1);

  const [tc] = await db
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.vigenteDesde))
    .limit(1);

  const [masCaro] = await db
    .select({ nombre: products.nombre, usd: products.precioUsdCentavos, ars: products.precioCentavos })
    .from(products)
    .where(eq(products.moneda, 'USD'))
    .orderBy(desc(products.precioCentavos))
    .limit(1);

  const total = resumen?.total ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Estado del sistema</h1>

      <section aria-labelledby="catalogo">
        <h2 id="catalogo" className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
          Espejo del catálogo
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Dato titulo="Productos" valor={total.toLocaleString('es-AR')} />
          <Dato titulo="Publicados" valor={(resumen?.activos ?? 0).toLocaleString('es-AR')} />
          <Dato titulo="En dólares" valor={(resumen?.enDolares ?? 0).toLocaleString('es-AR')} />
          <Dato titulo="Servicios" valor={(resumen?.servicios ?? 0).toLocaleString('es-AR')} />
        </div>
        <p className="mt-2 text-sm text-(--color-tinta-suave)">
          {ultimaSync?.cuando
            ? `Última sincronización: ${formatearFechaHora(new Date(ultimaSync.cuando))}`
            : 'Todavía no se sincronizó. Corré `npm run woo:sync`.'}
        </p>
      </section>

      <section aria-labelledby="calidad">
        <h2 id="calidad" className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
          Calidad de carga
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Dato
            titulo="Ficha incompleta"
            valor={porcentaje(resumen?.incompletos ?? 0, total)}
            detalle={`${resumen?.incompletos ?? 0} de ${total}`}
            alerta={(resumen?.incompletos ?? 0) / Math.max(total, 1) > 0.3}
          />
          <Dato
            titulo="Sin foto"
            valor={porcentaje(resumen?.sinFoto ?? 0, total)}
            detalle={`${resumen?.sinFoto ?? 0} de ${total}`}
            alerta={(resumen?.sinFoto ?? 0) / Math.max(total, 1) > 0.3}
          />
          <Dato
            titulo="Sin SKU"
            valor={porcentaje(resumen?.sinSku ?? 0, total)}
            detalle={`${resumen?.sinSku ?? 0} de ${total}`}
            alerta={(resumen?.sinSku ?? 0) / Math.max(total, 1) > 0.1}
          />
        </div>
      </section>

      <section aria-labelledby="dolar">
        <h2 id="dolar" className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
          Tipo de cambio
        </h2>
        {tc ? (
          <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
            <p className="tabular text-2xl font-bold">{formatearARS(tc.valorCentavos)}</p>
            <p className="text-sm text-(--color-tinta-suave)">
              por dólar · {tc.origen} · vigente desde{' '}
              {formatearFechaHora(new Date(tc.vigenteDesde))}
            </p>
            {masCaro?.usd ? (
              <p className="mt-3 border-t border-(--color-borde) pt-3 text-sm">
                Ejemplo: <strong>{masCaro.nombre}</strong> ·{' '}
                <span className="tabular">{formatearUSD(masCaro.usd)}</span> ={' '}
                <span className="tabular">{formatearARS(masCaro.ars)}</span>
              </p>
            ) : null}
          </div>
        ) : (
          <p className="rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-4 text-sm">
            No hay cotización cargada. Los productos en dólares no se pueden vender hasta que haya
            una.
          </p>
        )}
      </section>
    </div>
  );
}

function porcentaje(parte: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((parte / total) * 100)}%`;
}

function Dato({
  titulo,
  valor,
  detalle,
  alerta,
}: {
  titulo: string;
  valor: string;
  detalle?: string;
  alerta?: boolean;
}) {
  return (
    <div
      className={`rounded-(--radius-caja) border bg-(--color-panel) p-4 ${
        alerta ? 'border-(--color-alerta)' : 'border-(--color-borde)'
      }`}
    >
      <p className="text-sm text-(--color-tinta-suave)">{titulo}</p>
      <p className="tabular mt-1 text-2xl font-bold">{valor}</p>
      {detalle ? <p className="text-xs text-(--color-tinta-suave)">{detalle}</p> : null}
    </div>
  );
}
