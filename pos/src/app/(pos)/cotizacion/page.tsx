import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import {
  estadoDeLaCotizacion,
  historialDeCotizaciones,
  productosEnDolares,
} from '@/cotizacion/cotizacion';
import { formatearARS, formatearUSD, usdAPesos } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/fecha';
import FormularioCotizacion from './formulario';

export const dynamic = 'force-dynamic';

const ORIGEN: Record<string, string> = {
  infodolar: 'InfoDolar · blue Córdoba',
  dolarapi: 'DolarAPI · blue nacional',
  manual: 'Cargada a mano',
};

export default async function PaginaCotizacion() {
  const sesion = await auth();
  if (sesion?.user.rol !== 'owner') redirect('/');

  const estado = await estadoDeLaCotizacion(db);
  const historial = await historialDeCotizaciones(db, 20);
  const enDolares = await productosEnDolares(db);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tipo de cambio</h1>
        <p className="mt-1 text-sm text-(--color-tinta-suave)">
          El valor lo actualiza solo el plugin de WooCommerce dos veces por día, con el blue de
          Córdoba. Acá se puede ver el historial y forzar uno a mano si la fuente falla.
        </p>
      </div>

      {estado.vigente ? (
        <div
          className={`rounded-(--radius-caja) border p-4 ${
            estado.vencida
              ? 'border-(--color-alerta) bg-(--color-alerta)/8'
              : 'border-(--color-borde) bg-(--color-panel)'
          }`}
        >
          <p className="tabular text-3xl font-bold">{formatearARS(estado.vigente.valorCentavos)}</p>
          <p className="text-sm text-(--color-tinta-suave)">
            por dólar · {ORIGEN[estado.vigente.origen] ?? estado.vigente.origen} · desde{' '}
            {formatearFechaHora(estado.vigente.vigenteDesde)}
          </p>

          <p className="mt-3 border-t border-(--color-borde) pt-3 text-sm">
            <strong>{enDolares}</strong> producto{enDolares === 1 ? '' : 's'} del catálogo dependen
            de este número. Un iPhone de{' '}
            <span className="tabular">{formatearUSD(137_000)}</span> se vende hoy a{' '}
            <span className="tabular font-semibold">
              {formatearARS(usdAPesos(137_000, estado.vigente.valorCentavos))}
            </span>
            .
          </p>
        </div>
      ) : null}

      {estado.aviso ? (
        <p
          role="alert"
          className="rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-3 text-sm"
        >
          {estado.aviso}
        </p>
      ) : null}

      <FormularioCotizacion />

      {historial.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">Historial</h2>
          <div className="overflow-x-auto rounded-(--radius-caja) border border-(--color-borde)">
            <table className="w-full min-w-md text-sm">
              <thead className="bg-(--color-panel) text-left text-xs text-(--color-tinta-suave)">
                <tr>
                  <th className="px-3 py-2 font-medium">Vigente desde</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 font-medium">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-borde) bg-(--color-panel)">
                {historial.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2">{formatearFechaHora(c.vigenteDesde)}</td>
                    <td className="tabular px-3 py-2 text-right font-medium">
                      {formatearARS(c.valorCentavos)}
                    </td>
                    <td className="px-3 py-2 text-(--color-tinta-suave)">
                      {ORIGEN[c.origen] ?? c.origen}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-(--color-tinta-suave)">
            Las ventas guardan el tipo de cambio con el que se hicieron. Cambiar este valor nunca
            recalcula una venta pasada.
          </p>
        </section>
      ) : null}
    </div>
  );
}
