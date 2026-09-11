import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { cashSessions, monetaryAccounts, users } from '@/db/schema';
import { resumenDeSesion, sesionAbierta } from '@/caja/sesion';
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
            : ''}
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
      <div className="rounded-(--radius-caja) border border-(--color-ok) bg-(--color-ok)/8 p-4">
        <p className="text-sm font-semibold text-(--color-ok)">Turno abierto</p>
        <p className="text-sm text-(--color-tinta-suave)">
          Desde {formatearFechaHora(abiertaEn)}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Dato titulo="Ventas del turno" valor={String(resumen.cantidadDeVentas)} />
        <Dato titulo="Facturado" valor={formatearARS(resumen.totalVendidoCentavos)} />
        <Dato
          titulo="Efectivo esperado"
          valor={formatearARS(resumen.efectivoEsperadoCentavos)}
          detalle={`Incluye ${formatearARS(resumen.saldoInicialCentavos)} de apertura`}
        />
      </div>

      {resumen.porMedio.length > 0 ? (
        <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
          <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">Por medio de pago</h2>
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
        </div>
      ) : null}

      <FormularioCierre esperadoCentavos={resumen.efectivoEsperadoCentavos} />
    </section>
  );
}

async function SesionesAnteriores() {
  const cerradas = await db
    .select({
      id: cashSessions.id,
      abiertaEn: cashSessions.abiertaEn,
      cerradaEn: cashSessions.cerradaEn,
      esperado: cashSessions.saldoEsperadoCentavos,
      contado: cashSessions.saldoContadoCentavos,
      diferencia: cashSessions.diferenciaCentavos,
      justificacion: cashSessions.justificacion,
      cerradaPor: users.nombre,
    })
    .from(cashSessions)
    .leftJoin(users, eq(users.id, cashSessions.cerradaPorId))
    .orderBy(desc(cashSessions.cerradaEn))
    .limit(10);

  const conCierre = cerradas.filter((s) => s.cerradaEn !== null);
  if (conCierre.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">Cierres anteriores</h2>
      <div className="overflow-x-auto rounded-(--radius-caja) border border-(--color-borde)">
        <table className="w-full min-w-lg text-sm">
          <thead className="bg-(--color-panel) text-left text-xs text-(--color-tinta-suave)">
            <tr>
              <th className="px-3 py-2 font-medium">Cerrada</th>
              <th className="px-3 py-2 font-medium">Por</th>
              <th className="px-3 py-2 text-right font-medium">Esperado</th>
              <th className="px-3 py-2 text-right font-medium">Contado</th>
              <th className="px-3 py-2 text-right font-medium">Diferencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--color-borde) bg-(--color-panel)">
            {conCierre.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2">{formatearFechaHora(s.cerradaEn!)}</td>
                <td className="px-3 py-2">{s.cerradaPor ?? '—'}</td>
                <td className="tabular px-3 py-2 text-right">{formatearARS(s.esperado ?? 0)}</td>
                <td className="tabular px-3 py-2 text-right">{formatearARS(s.contado ?? 0)}</td>
                <td
                  className={`tabular px-3 py-2 text-right font-medium ${
                    (s.diferencia ?? 0) === 0 ? 'text-(--color-ok)' : 'text-(--color-alerta)'
                  }`}
                  title={s.justificacion ?? undefined}
                >
                  {formatearARS(s.diferencia ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
