import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { monetaryAccounts } from '@/db/schema';
import { resumenDeSesion, sesionAbierta } from '@/caja/sesion';
import { cierresRecientes, cuantosSeContaron } from '@/caja/reporte';
import { haceCuanto, horasAbierta, HORAS_PARA_AVISAR } from '@/caja/arqueo';
import { config } from '@/lib/config';
import { formatearARS } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/fecha';
import { nombreDelMedio } from '@/ventas/ticket';
import { pendientesDeSincronizar } from '@/woo/cola';
import FormularioApertura from './formulario-apertura';
import FormularioCierre from './formulario-cierre';

export const dynamic = 'force-dynamic';

export default async function PaginaCaja() {
  const terminal = config().POS_TERMINAL;
  const abierta = await sesionAbierta(db, terminal);

  const cuentas = await db
    .select({ id: monetaryAccounts.id, nombre: monetaryAccounts.nombre, tipo: monetaryAccounts.tipo })
    .from(monetaryAccounts)
    .where(eq(monetaryAccounts.activo, true));

  const cola = await pendientesDeSincronizar(db);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Caja</h1>
        <span className="text-sm text-(--color-tinta-suave)">Terminal {terminal}</span>
      </div>

      {abierta ? (
        <TurnoAbierto sesionId={abierta.id} abiertaEn={abierta.abiertaEn} />
      ) : (
        <FormularioApertura cuentas={cuentas} />
      )}

      {cola.pendientes + cola.fallidas > 0 ? (
        <p className="rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-3 text-sm">
          Hay <strong>{cola.pendientes + cola.fallidas}</strong> ajuste
          {cola.pendientes + cola.fallidas === 1 ? '' : 's'} de stock esperando llegar a
          WooCommerce. Las ventas están registradas: lo que falta es que la tienda online se entere.
          {cola.fallidas > 0
            ? ` ${cola.fallidas} agotaron los reintentos y necesitan que se revise la conexión.`
            : ''}{' '}
          <Link href="/sincronizacion" className="font-semibold underline underline-offset-2">
            Ver la cola
          </Link>
        </p>
      ) : null}

      <SesionesAnteriores />
    </div>
  );
}

async function TurnoAbierto({ sesionId, abiertaEn }: { sesionId: string; abiertaEn: Date }) {
  const resumen = await resumenDeSesion(db, sesionId);

  return (
    <section className="space-y-4">
      {/* La auditoría encontró sesiones abiertas días enteros: una caja que
          nunca cierra no tiene arqueo ni reporte de nada. */}
      {horasAbierta(abiertaEn) >= HORAS_PARA_AVISAR ? (
        <p
          role="alert"
          className="rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-3 text-sm"
        >
          Este turno está abierto <strong>{haceCuanto(abiertaEn)}</strong>. Mientras no se cierre
          no hay arqueo ni reporte del día, y todo lo que se vendió queda en la misma bolsa.
        </p>
      ) : null}

      <div className="rounded-(--radius-caja) border border-(--color-ok) bg-(--color-ok)/8 p-4">
        <p className="text-sm font-semibold text-(--color-ok)">Turno abierto</p>
        <p className="text-sm text-(--color-tinta-suave)">
          Desde {formatearFechaHora(abiertaEn)} · {haceCuanto(abiertaEn)}
        </p>
        <Link
          href={`/caja/${sesionId}`}
          className="mt-1 inline-block text-sm font-medium underline underline-offset-2"
        >
          Ver el reporte del turno
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Dato titulo="Ventas del turno" valor={String(resumen.cantidadDeVentas)} />
        <Dato titulo="Facturado" valor={formatearARS(resumen.totalVendidoCentavos)} />
        <Dato
          titulo="Efectivo esperado"
          valor={formatearARS(resumen.efectivoEsperadoCentavos)}
          detalle={
            resumen.efectivoEsperadoCentavos < 0
              ? 'Da negativo: la apertura se declaró corta'
              : `Incluye ${formatearARS(resumen.saldoInicialCentavos)} de apertura`
          }
        />
      </div>

      {resumen.porMedio.length > 0 ||
      resumen.fiadoCentavos > 0 ||
      resumen.gastosCentavos > 0 ||
      resumen.retirosCentavos > 0 ? (
        <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
          <h2 className="mb-1 text-sm font-semibold text-(--color-tinta-suave)">
            Plata que entró, por medio
          </h2>
          <p className="mb-2 text-xs text-(--color-tinta-suave)">
            Neto de vuelto, con los cobros de fiado adentro. El efectivo de acá es contra lo que se
            cuenta el cajón.
          </p>

          <dl className="flex flex-col gap-1 text-sm">
            {resumen.porMedio.map((m) => (
              <div key={m.medio} className="flex justify-between">
                <dt>
                  {nombreDelMedio(m.medio)}{' '}
                  <span className="text-(--color-tinta-suave)">({m.cantidad})</span>
                </dt>
                <dd className="tabular font-medium">{formatearARS(m.totalCentavos)}</dd>
              </div>
            ))}
          </dl>

          {/* Lo que salió del cajón: sin esto el conteo da de menos y nadie
              sabe por qué. */}
          {resumen.gastosCentavos > 0 || resumen.retirosCentavos > 0 ? (
            <dl className="mt-2 flex flex-col gap-1 border-t border-(--color-borde) pt-2 text-sm">
              {resumen.gastosCentavos > 0 ? (
                <div className="flex justify-between">
                  <dt>Gastos pagados del cajón</dt>
                  <dd className="tabular font-medium text-(--color-error)">
                    −{formatearARS(resumen.gastosCentavos)}
                  </dd>
                </div>
              ) : null}
              {resumen.retirosCentavos > 0 ? (
                <div className="flex justify-between">
                  <dt>Salidas a otra cuenta</dt>
                  <dd className="tabular font-medium text-(--color-error)">
                    −{formatearARS(resumen.retirosCentavos)}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {/* Lo que NO entró, separado para que nadie lo sume al cajón. */}
          {resumen.fiadoCentavos > 0 || resumen.cobrosDeFiadoCentavos > 0 ? (
            <dl className="mt-2 flex flex-col gap-1 border-t border-(--color-borde) pt-2 text-sm text-(--color-tinta-suave)">
              {resumen.fiadoCentavos > 0 ? (
                <div className="flex justify-between">
                  <dt>Fiado en el turno · no entró plata</dt>
                  <dd className="tabular">{formatearARS(resumen.fiadoCentavos)}</dd>
                </div>
              ) : null}
              {resumen.cobrosDeFiadoCentavos > 0 ? (
                <div className="flex justify-between">
                  <dt>De lo de arriba, cobros de deudas viejas</dt>
                  <dd className="tabular">{formatearARS(resumen.cobrosDeFiadoCentavos)}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      ) : null}

      <FormularioCierre
        esperadoCentavos={resumen.efectivoEsperadoCentavos}
        terminal={config().POS_TERMINAL}
      />
    </section>
  );
}

/**
 * Los cierres anteriores.
 *
 * La justificación de una diferencia va en la tabla y no en un `title`: un
 * tooltip que solo aparece pasando el mouse no existe para quien lee el listado
 * en una tablet, ni para quien lo imprime. Era el hallazgo 14 de la auditoría.
 */
async function SesionesAnteriores() {
  const cierres = await cierresRecientes(db, 10);
  if (cierres.length === 0) return null;

  const contados = await cuantosSeContaron(db, 10);

  return (
    <section aria-label="Cierres anteriores">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-(--color-tinta-suave)">Cierres anteriores</h2>
        {/* Si esto se va a cero, el arqueo volvió a ser un trámite. */}
        <p className="text-xs text-(--color-tinta-suave)">
          {contados.contados} de los últimos {contados.total} se cerraron contando los billetes
        </p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {cierres.map((c) => (
          <li
            key={c.id}
            className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-3 text-sm"
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Link
                href={`/caja/${c.id}`}
                className="font-medium underline underline-offset-2"
              >
                {formatearFechaHora(c.cerradaEn)}
              </Link>
              <span className="text-xs text-(--color-tinta-suave)">
                {c.terminal}
                {c.cerradaPor ? ` · ${c.cerradaPor}` : ''}
              </span>
              {c.seConto ? (
                <span className="rounded bg-(--color-ok)/15 px-1.5 py-0.5 text-xs font-semibold text-(--color-ok)">
                  Contado
                </span>
              ) : (
                <span className="rounded bg-(--color-papel) px-1.5 py-0.5 text-xs text-(--color-tinta-suave)">
                  Total a mano
                </span>
              )}

              <span
                className={`tabular ml-auto font-semibold ${
                  c.diferenciaCentavos === 0 ? 'text-(--color-ok)' : 'text-(--color-alerta)'
                }`}
              >
                {c.diferenciaCentavos === 0
                  ? 'Cuadró'
                  : `${c.diferenciaCentavos > 0 ? 'Sobró' : 'Faltó'} ${formatearARS(
                      Math.abs(c.diferenciaCentavos),
                    )}`}
              </span>
            </div>

            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-(--color-tinta-suave)">
              <span>Esperado: {formatearARS(c.esperadoCentavos)}</span>
              <span>Contado: {formatearARS(c.contadoCentavos)}</span>
            </div>

            {c.justificacion ? (
              <p className="mt-1 rounded-(--radius-caja) bg-(--color-papel) p-2">
                {c.justificacion}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Dato({
  titulo,
  valor,
  detalle,
}: {
  titulo: string;
  valor: string;
  detalle?: string;
}) {
  return (
    <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
      <p className="text-sm text-(--color-tinta-suave)">{titulo}</p>
      <p className="tabular mt-1 text-xl font-bold">{valor}</p>
      {detalle ? <p className="text-xs text-(--color-tinta-suave)">{detalle}</p> : null}
    </div>
  );
}
