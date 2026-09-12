import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { syncConflicts } from '@/db/schema';
import { formatearFechaHora } from '@/lib/fecha';
import { operacionesEnCola, pendientesDeSincronizar, MAXIMO_DE_INTENTOS } from '@/woo/cola';
import Botones from './botones';

export const dynamic = 'force-dynamic';

/**
 * Estado de la cola hacia WooCommerce.
 *
 * El cajero ve «N sin sincronizar» en varias pantallas. Acá se ve qué es esa
 * N, por qué no pasó, y se puede hacer algo al respecto.
 */
export default async function PaginaSincronizacion() {
  const sesion = await auth();
  if (sesion?.user.rol !== 'owner') redirect('/');

  const cola = await pendientesDeSincronizar(db);
  const operaciones = await operacionesEnCola(db);
  const conflictos = await db
    .select()
    .from(syncConflicts)
    .orderBy(desc(syncConflicts.detectadoEn))
    .limit(10);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sincronización con la tienda</h1>
        <p className="mt-1 text-sm text-(--color-tinta-suave)">
          Cada venta descuenta el stock en el POS y deja el ajuste acá para que llegue a
          WooCommerce. Pasa sola al vender y cada diez minutos; esta pantalla es para cuando algo
          se queda trabado.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Dato titulo="Esperando" valor={cola.pendientes} />
        <Dato
          titulo="Fallidas"
          valor={cola.fallidas}
          alerta={cola.fallidas > 0}
          detalle={cola.fallidas > 0 ? `Agotaron los ${MAXIMO_DE_INTENTOS} intentos` : undefined}
        />
      </div>

      <Botones hayFallidas={cola.fallidas > 0} />

      {operaciones.length === 0 ? (
        <p className="rounded-(--radius-caja) border border-(--color-ok) bg-(--color-ok)/8 p-6 text-center text-sm">
          Está todo sincronizado. WooCommerce tiene el mismo stock que el POS.
        </p>
      ) : (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">En la cola</h2>
          <ul className="flex flex-col gap-2">
            {operaciones.map((o) => (
              <li
                key={o.id}
                className={`rounded-(--radius-caja) border bg-(--color-panel) p-3 ${
                  o.estado === 'fallido' ? 'border-(--color-error)' : 'border-(--color-borde)'
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium">{o.numero ?? o.operacion}</span>
                  <span className="text-xs text-(--color-tinta-suave)">
                    {formatearFechaHora(o.createdAt)}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                      o.estado === 'fallido'
                        ? 'bg-(--color-error)/15 text-(--color-error)'
                        : 'bg-(--color-papel) text-(--color-tinta-suave)'
                    }`}
                  >
                    {o.estado === 'fallido' ? 'Fallida' : 'Esperando'}
                  </span>
                  {o.intentos > 0 ? (
                    <span className="text-xs text-(--color-tinta-suave)">
                      {o.intentos} {o.intentos === 1 ? 'intento' : 'intentos'}
                    </span>
                  ) : null}
                  {o.estado === 'pendiente' && o.proximoIntento && o.intentos > 0 ? (
                    <span className="ml-auto text-xs text-(--color-tinta-suave)">
                      reintenta {formatearFechaHora(o.proximoIntento)}
                    </span>
                  ) : null}
                </div>

                {o.ultimoError ? (
                  <p className="mt-1.5 rounded-(--radius-caja) bg-(--color-papel) p-2 text-xs text-(--color-tinta-media)">
                    {o.ultimoError}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {conflictos.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
            Stock que no coincide
          </h2>
          <p className="mb-2 text-sm text-(--color-tinta-media)">
            WooCommerce tenía un número que el POS no esperaba: algo movió ese stock por fuera del
            mostrador. El POS manda y lo pisa, pero queda anotado acá.
          </p>
          <ul className="flex flex-col gap-1.5">
            {conflictos.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-baseline gap-x-3 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-2.5 text-sm"
              >
                <span className="text-xs text-(--color-tinta-suave)">
                  {formatearFechaHora(c.detectadoEn)}
                </span>
                <span>
                  POS <strong className="tabular">{c.stockPos}</strong> · Woo{' '}
                  <strong className="tabular">{c.stockWoo}</strong>
                </span>
                <Link
                  href={`/catalogo`}
                  className="ml-auto text-xs underline underline-offset-2"
                >
                  Ver el catálogo
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-sm text-(--color-tinta-suave)">
        El stock que se le escribe a WooCommerce es el que el POS tiene ahora, no la resta: pasarlo
        dos veces escribe el mismo número. Por eso reintentar nunca descuenta de más.
      </p>
    </div>
  );
}

function Dato({
  titulo,
  valor,
  detalle,
  alerta,
}: {
  titulo: string;
  valor: number;
  detalle?: string;
  alerta?: boolean;
}) {
  return (
    <div
      className={`rounded-(--radius-caja) border bg-(--color-panel) p-4 ${
        alerta ? 'border-(--color-error)' : 'border-(--color-borde)'
      }`}
    >
      <p className="text-sm text-(--color-tinta-suave)">{titulo}</p>
      <p className={`tabular mt-1 text-2xl font-bold ${alerta ? 'text-(--color-error)' : ''}`}>
        {valor.toLocaleString('es-AR')}
      </p>
      {detalle ? <p className="text-xs text-(--color-tinta-suave)">{detalle}</p> : null}
    </div>
  );
}
