import Link from 'next/link';
import { count, desc, isNotNull, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { products } from '@/db/schema';
import { marcadorDeProductoReal, type MesDeFacturacion } from '@/catalogo/calidad';
import { estadoDeLaCotizacion, productosEnDolares } from '@/cotizacion/cotizacion';
import { formatearARS, formatearUSD, usdAPesos } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/fecha';
import { chequearProduccion, pendientes, type Chequeo } from '@/lib/produccion';
import { pendientesDeSincronizar } from '@/woo/cola';

export const dynamic = 'force-dynamic';

/**
 * Meta del negocio: que menos del 30% de la facturación se cargue sin producto,
 * o sea que más del 70% tenga producto real. Viene de 30% / 33% / 39%.
 */
const META_CON_PRODUCTO = 70;

export default async function PaginaInicio() {
  const sesion = await auth();
  const esDuenio = sesion?.user.rol === 'owner';

  const [resumen] = await db
    .select({
      total: count(),
      enDolares: sql<number>`count(*) filter (where ${products.moneda} = 'USD')`.mapWith(Number),
      sinFoto: sql<number>`count(*) filter (where ${products.imagenUrl} is null)`.mapWith(Number),
      sinSku: sql<number>`count(*) filter (where ${products.sku} is null)`.mapWith(Number),
      servicios: sql<number>`count(*) filter (where ${products.esServicio})`.mapWith(Number),
    })
    .from(products);

  const [ultimaSync] = await db
    .select({ cuando: products.lastSyncedAt })
    .from(products)
    .where(isNotNull(products.lastSyncedAt))
    .orderBy(desc(products.lastSyncedAt))
    .limit(1);

  const cotizacion = await estadoDeLaCotizacion(db);
  const enDolares = await productosEnDolares(db);
  const marcador = await marcadorDeProductoReal(db, 8);
  const cola = await pendientesDeSincronizar(db);

  // Lo que se configura afuera del repositorio y falla en silencio: si falta,
  // lo reclama la pantalla que el dueño abre todos los días.
  const porConfigurar = esDuenio ? pendientes(chequearProduccion()) : [];

  const total = resumen?.total ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <h1 className="text-2xl font-bold tracking-tight">Estado del sistema</h1>

      {cotizacion.aviso ? (
        <p
          role="alert"
          className="rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-3 text-sm"
        >
          {cotizacion.aviso}{' '}
          {esDuenio ? (
            <Link href="/cotizacion" className="font-semibold underline underline-offset-2">
              Cargar una a mano
            </Link>
          ) : null}
        </p>
      ) : null}

      {cola.pendientes + cola.fallidas > 0 ? (
        <p
          className={`rounded-(--radius-caja) border p-3 text-sm ${
            cola.fallidas > 0
              ? 'border-(--color-error) bg-(--color-error)/10'
              : 'border-(--color-alerta) bg-(--color-alerta)/10'
          }`}
        >
          Hay <strong>{cola.pendientes + cola.fallidas}</strong> ajuste
          {cola.pendientes + cola.fallidas === 1 ? '' : 's'} de stock esperando llegar a
          WooCommerce
          {cola.fallidas > 0
            ? `, ${cola.fallidas} de ellos ya sin reintentos`
            : ''}
          . Las ventas están registradas.{' '}
          {esDuenio ? (
            <Link href="/sincronizacion" className="font-semibold underline underline-offset-2">
              Ver la cola
            </Link>
          ) : null}
        </p>
      ) : null}

      {porConfigurar.length > 0 ? <PorConfigurar chequeos={porConfigurar} /> : null}

      <Marcador meses={marcador} />

      <section aria-labelledby="dolar">
        <h2 id="dolar" className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
          Tipo de cambio
        </h2>
        {cotizacion.vigente ? (
          <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <p className="tabular text-2xl font-bold">
                {formatearARS(cotizacion.vigente.valorCentavos)}
              </p>
              <p className="text-sm text-(--color-tinta-suave)">
                por dólar · {cotizacion.vigente.origen} · desde{' '}
                {formatearFechaHora(cotizacion.vigente.vigenteDesde)}
              </p>
            </div>
            <p className="mt-3 border-t border-(--color-borde) pt-3 text-sm">
              <strong>{enDolares}</strong> productos se venden en dólares. Un iPhone de{' '}
              <span className="tabular">{formatearUSD(137_000)}</span> sale hoy{' '}
              <span className="tabular font-semibold">
                {formatearARS(usdAPesos(137_000, cotizacion.vigente.valorCentavos))}
              </span>
              .
            </p>
          </div>
        ) : (
          <p className="rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-4 text-sm">
            No hay cotización cargada. Los productos en dólares no se pueden vender.
          </p>
        )}
      </section>

      <section aria-labelledby="catalogo">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="catalogo" className="text-sm font-semibold text-(--color-tinta-suave)">
            Espejo del catálogo
          </h2>
          {esDuenio ? (
            <Link href="/catalogo" className="text-sm underline underline-offset-2">
              Ver problemas de carga
            </Link>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Dato titulo="Productos" valor={total.toLocaleString('es-AR')} />
          <Dato titulo="En dólares" valor={(resumen?.enDolares ?? 0).toLocaleString('es-AR')} />
          <Dato
            titulo="Sin foto"
            valor={porcentaje(resumen?.sinFoto ?? 0, total)}
            detalle={`${(resumen?.sinFoto ?? 0).toLocaleString('es-AR')} de ${total.toLocaleString('es-AR')}`}
          />
          <Dato
            titulo="Sin SKU"
            valor={porcentaje(resumen?.sinSku ?? 0, total)}
            detalle={`${(resumen?.sinSku ?? 0).toLocaleString('es-AR')} de ${total.toLocaleString('es-AR')}`}
          />
        </div>
        <p className="mt-2 text-sm text-(--color-tinta-suave)">
          {ultimaSync?.cuando
            ? `Última sincronización: ${formatearFechaHora(new Date(ultimaSync.cuando))}`
            : 'Todavía no se sincronizó. Corré `npm run woo:sync`.'}
        </p>
      </section>
    </div>
  );
}

/**
 * Lo que quedo sin configurar afuera del repositorio.
 *
 * Aparece solo cuando hay algo que arreglar y desaparece cuando se arregla: un
 * panel permanentemente verde se vuelve invisible a la semana, y este tiene que
 * llamar la atencion el dia que aparezca.
 */
function PorConfigurar({ chequeos }: { chequeos: Chequeo[] }) {
  const hayFaltantes = chequeos.some((c) => c.gravedad === 'falta');

  return (
    <section
      aria-labelledby="configuracion"
      className={`rounded-(--radius-caja) border p-4 ${
        hayFaltantes
          ? 'border-(--color-error) bg-(--color-error)/8'
          : 'border-(--color-alerta) bg-(--color-alerta)/8'
      }`}
    >
      <h2 id="configuracion" className="text-sm font-semibold">
        {hayFaltantes ? 'Falta configurar el despliegue' : 'Avisos de configuración'}
      </h2>

      <ul className="mt-2 flex flex-col gap-3">
        {chequeos.map((c) => (
          <li key={c.clave} className="text-sm">
            <p className="font-medium">
              {c.gravedad === 'falta' ? '✕' : '!'} {c.titulo}
            </p>
            <p className="text-(--color-tinta-media)">{c.detalle}</p>
            {c.arreglo ? (
              <p className="mt-0.5 text-(--color-tinta-suave)">→ {c.arreglo}</p>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-(--color-borde) pt-2 text-xs text-(--color-tinta-suave)">
        Esto lo ve solo el dueño y se va solo cuando queda resuelto. El paso a paso está en
        PRODUCCION.md, y se puede verificar antes de desplegar con{' '}
        <code>npm run produccion:chequear</code>.
      </p>
    </section>
  );
}

/**
 * Marcador de facturacion con producto real.
 *
 * Es la metrica que el negocio necesita ver todos los meses: el 58% de la
 * facturacion se cargaba sin producto asociado, y por eso el stock, los
 * reportes y los anuncios eran inservibles.
 */
function Marcador({ meses }: { meses: MesDeFacturacion[] }) {
  if (meses.length === 0) {
    return (
      <section aria-labelledby="marcador">
        <h2 id="marcador" className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
          Facturación con producto real
        </h2>
        <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4 text-sm text-(--color-tinta-suave)">
          Todavía no hay ventas registradas. Este número va a mostrar qué porcentaje de la
          facturación se carga con un producto de verdad, mes a mes.
        </p>
      </section>
    );
  }

  const actual = meses[0]!;
  const maximo = Math.max(...meses.map((m) => m.totalCentavos), 1);
  const cumple = actual.porcentaje >= META_CON_PRODUCTO;

  return (
    <section aria-labelledby="marcador">
      <h2 id="marcador" className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
        Facturación con producto real
      </h2>

      <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <p
            className={`tabular text-4xl font-bold ${
              cumple ? 'text-(--color-ok)' : 'text-(--color-alerta)'
            }`}
          >
            {actual.porcentaje}%
          </p>
          <p className="text-sm text-(--color-tinta-suave)">
            en {actual.mes} · meta: {META_CON_PRODUCTO}% o más
          </p>
        </div>

        <p className="mt-1 text-sm text-(--color-tinta-media)">
          {actual.origen === 'pos'
            ? 'El sistema nuevo no permite vender sin producto, así que da 100% por construcción. El contraste aparece cuando se importe el histórico del POS anterior.'
            : 'Del POS anterior, donde se podía cargar una venta sin producto asociado.'}
        </p>

        <ol className="mt-4 flex flex-col gap-1.5">
          {meses.map((m) => (
            <li key={`${m.origen}-${m.mes}`} className="flex items-center gap-2 text-sm">
              <span className="tabular w-16 shrink-0 text-(--color-tinta-suave)">{m.mes}</span>

              {/* La barra mide facturación; el relleno, la parte con producto. */}
              <span
                className="h-4 shrink-0 rounded-sm bg-(--color-borde)"
                style={{ width: `${Math.max(4, (m.totalCentavos / maximo) * 55)}%` }}
              >
                <span
                  className={`block h-full rounded-sm ${
                    m.porcentaje >= META_CON_PRODUCTO
                      ? 'bg-(--color-ok)'
                      : 'bg-(--color-alerta)'
                  }`}
                  style={{ width: `${m.porcentaje}%` }}
                />
              </span>

              <span className="tabular w-12 shrink-0 text-right font-medium">{m.porcentaje}%</span>
              <span className="tabular ml-auto text-right text-xs text-(--color-tinta-suave)">
                {formatearARS(m.totalCentavos)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function porcentaje(parte: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((parte / total) * 100)}%`;
}

function Dato({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
      <p className="text-sm text-(--color-tinta-suave)">{titulo}</p>
      <p className="tabular mt-1 text-2xl font-bold">{valor}</p>
      {detalle ? <p className="text-xs text-(--color-tinta-suave)">{detalle}</p> : null}
    </div>
  );
}
