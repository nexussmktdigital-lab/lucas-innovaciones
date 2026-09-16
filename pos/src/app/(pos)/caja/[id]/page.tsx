import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { formatearARS } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/fecha';
import { reporteDeCierre } from '@/caja/reporte';
import { gastosDelTurno } from '@/gastos/gastos';
import { ventasDelTurno } from '@/ventas/anular';
import { nombreDelMedio } from '@/ventas/ticket';
import BotonImprimir from './boton-imprimir';

export const dynamic = 'force-dynamic';

/**
 * El reporte de un turno.
 *
 * Hasta acá el cierre guardaba tres números y el resto del turno quedaba
 * desparramado entre pantallas. Esto es la hoja que el negocio usa para dos
 * cosas: saber qué pasó ese día, y poder discutir una diferencia una semana
 * después.
 */
export default async function PaginaReporte({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await auth();
  if (!sesion?.user) redirect('/ingresar');

  const { id } = await params;
  const r = await reporteDeCierre(db, id);
  if (!r) notFound();

  const ventas = await ventasDelTurno(db, id);
  const gastos = await gastosDelTurno(db, id);
  const anuladas = ventas.filter((v) => v.estado === 'cancelled');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/caja" className="sin-imprimir text-sm underline underline-offset-2">
            ← Caja
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            Lucas Innovaciones · turno de {r.terminal}
            {r.abierta ? ' · abierto' : ''}
          </h1>
          <p className="mt-1 text-sm text-(--color-tinta-suave)">
            Desde {formatearFechaHora(r.abiertaEn)}
            {r.abiertaPor ? ` · abrió ${r.abiertaPor}` : ''}
            {r.cerradaEn ? ` · hasta ${formatearFechaHora(r.cerradaEn)}` : ''}
            {r.cerradaPor ? ` · cerró ${r.cerradaPor}` : ''}
          </p>
        </div>
        <BotonImprimir />
      </div>

      {r.abierta ? (
        <p className="rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-3 text-sm">
          Este turno sigue abierto, así que los números todavía se mueven.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Dato titulo="Ventas" valor={r.cantidadDeVentas.toLocaleString('es-AR')} />
        <Dato titulo="Productos vendidos" valor={r.unidadesVendidas.toLocaleString('es-AR')} />
        <Dato titulo="Facturado" valor={formatearARS(r.totalVendidoCentavos)} />
      </div>

      <section
        aria-label="El arqueo"
        className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4"
      >
        <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">El arqueo</h2>

        <dl className="flex flex-col gap-1 text-sm">
          <Renglon termino="Apertura" valor={formatearARS(r.saldoInicialCentavos)} />
          {r.porMedio.map((m) => (
            <Renglon
              key={m.medio}
              termino={`${nombreDelMedio(m.medio)} · ${m.cantidad}`}
              valor={formatearARS(m.totalCentavos)}
            />
          ))}
          {r.gastosCentavos > 0 ? (
            <Renglon
              termino="Gastos pagados del cajón"
              valor={`−${formatearARS(r.gastosCentavos)}`}
              rojo
            />
          ) : null}
          {r.retirosCentavos > 0 ? (
            <Renglon
              termino="Salidas a otra cuenta"
              valor={`−${formatearARS(r.retirosCentavos)}`}
              rojo
            />
          ) : null}
          {r.devolucionesCentavos > 0 ? (
            <Renglon
              termino="Devuelto por ventas de otros turnos"
              valor={`−${formatearARS(r.devolucionesCentavos)}`}
              rojo
            />
          ) : null}
          {r.ventasDiferidas > 0 ? (
            <Renglon
              termino={
                r.ventasDeOtroTurno > 0
                  ? `De eso, cobrado sin conexión (${r.ventasDeOtroTurno} de antes de este turno)`
                  : 'De eso, cobrado sin conexión'
              }
              valor={formatearARS(r.ventasDiferidasCentavos)}
            />
          ) : null}

          <div className="mt-1 flex justify-between border-t border-(--color-borde) pt-2 font-semibold">
            <dt>Efectivo esperado</dt>
            <dd className="tabular">{formatearARS(r.efectivoEsperadoCentavos)}</dd>
          </div>

          {r.saldoContadoCentavos !== null ? (
            <>
              <div className="flex justify-between font-semibold">
                <dt>Contado</dt>
                <dd className="tabular">{formatearARS(r.saldoContadoCentavos)}</dd>
              </div>
              <div
                className={`flex justify-between font-bold ${
                  (r.diferenciaCentavos ?? 0) === 0
                    ? 'text-(--color-ok)'
                    : 'text-(--color-alerta)'
                }`}
              >
                <dt>Diferencia</dt>
                <dd className="tabular">{formatearARS(r.diferenciaCentavos ?? 0)}</dd>
              </div>
            </>
          ) : null}
        </dl>

        {/* Un esperado negativo no es un error de cuentas: es un turno que se
            abrió declarando menos plata de la que había en el cajón. Dicho
            así se arregla mañana; como un signo menos, no lo mira nadie. */}
        {r.efectivoEsperadoCentavos < 0 ? (
          <p className="mt-3 rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-3 text-sm">
            El esperado da negativo: del cajón salió más plata de la que se declaró al abrir el
            turno. La apertura quedó corta, no es un error de las ventas.
          </p>
        ) : null}

        {/* La justificación va en el cuerpo del reporte y no en un `title`:
            una diferencia sin su explicación a la vista no es información. */}
        {r.justificacion ? (
          <p className="mt-3 rounded-(--radius-caja) bg-(--color-papel) p-3 text-sm">
            <span className="font-medium">Por qué no cuadró:</span> {r.justificacion}
          </p>
        ) : null}

        {r.nota ? (
          <p className="mt-2 rounded-(--radius-caja) bg-(--color-papel) p-3 text-sm">
            <span className="font-medium">Nota:</span> {r.nota}
          </p>
        ) : null}

        {r.fiadoCentavos > 0 || r.cobrosDeFiadoCentavos > 0 ? (
          <dl className="mt-3 flex flex-col gap-1 border-t border-(--color-borde) pt-2 text-sm text-(--color-tinta-suave)">
            {r.fiadoCentavos > 0 ? (
              <Renglon
                termino="Fiado en el turno · no entró plata"
                valor={formatearARS(r.fiadoCentavos)}
              />
            ) : null}
            {r.cobrosDeFiadoCentavos > 0 ? (
              <Renglon
                termino="De lo de arriba, cobros de deudas viejas"
                valor={formatearARS(r.cobrosDeFiadoCentavos)}
              />
            ) : null}
          </dl>
        ) : null}
      </section>

      {r.desgloseDelConteo.length > 0 || r.sueltoCentavos > 0 ? (
        <section
          aria-label="Cómo se contó el cajón"
          className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4"
        >
          <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
            Cómo se contó el cajón
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {r.desgloseDelConteo.map((f) => (
              <li key={f.valorCentavos} className="flex items-baseline gap-2">
                <span className="tabular w-20 shrink-0 font-medium">{f.etiqueta}</span>
                <span className="text-(--color-tinta-suave)">× {f.cantidad}</span>
                <span className="tabular ml-auto">{formatearARS(f.subtotalCentavos)}</span>
              </li>
            ))}
            {r.sueltoCentavos > 0 ? (
              <li className="flex items-baseline gap-2">
                <span className="w-20 shrink-0 font-medium">Monedas</span>
                <span className="tabular ml-auto">{formatearARS(r.sueltoCentavos)}</span>
              </li>
            ) : null}
          </ul>
        </section>
      ) : !r.abierta ? (
        <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-3 text-sm text-(--color-tinta-suave)">
          Este turno se cerró escribiendo el total, sin contar los billetes uno por uno.
        </p>
      ) : null}

      {gastos.length > 0 ? (
        <section aria-label="Gastos del turno">
          <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
            Gastos pagados en el turno
          </h2>
          <ul className="flex flex-col gap-1.5">
            {gastos.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-baseline gap-x-2 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-2.5 text-sm"
              >
                <span className="font-medium">{g.descripcion}</span>
                <span className="text-xs text-(--color-tinta-suave)">{g.categoria}</span>
                <span className="tabular ml-auto font-semibold text-(--color-error)">
                  −{formatearARS(g.montoCentavos)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {anuladas.length > 0 ? (
        <section aria-label="Ventas anuladas">
          <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
            Ventas anuladas en el turno
          </h2>
          <ul className="flex flex-col gap-1.5">
            {anuladas.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-baseline gap-x-2 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-2.5 text-sm"
              >
                <span className="tabular font-medium">{v.numero}</span>
                <span className="text-(--color-tinta-media)">{v.detalle}</span>
                {v.motivoAnulacion ? (
                  <span className="w-full text-xs text-(--color-tinta-suave)">
                    {v.motivoAnulacion}
                  </span>
                ) : null}
                <span className="tabular ml-auto line-through">
                  {formatearARS(v.totalCentavos)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-sm text-(--color-tinta-suave)">
        Los números salen de los mismos asientos que movieron la plata, así que este reporte dice
        hoy lo mismo que decía al cerrar el turno. Impreso el {formatearFechaHora(new Date())}.
      </p>
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
      <p className="text-sm text-(--color-tinta-suave)">{titulo}</p>
      <p className="tabular mt-1 text-2xl font-bold">{valor}</p>
    </div>
  );
}

function Renglon({
  termino,
  valor,
  rojo = false,
}: {
  termino: string;
  valor: string;
  rojo?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <dt>{termino}</dt>
      <dd className={`tabular ${rojo ? 'text-(--color-error)' : ''}`}>{valor}</dd>
    </div>
  );
}
