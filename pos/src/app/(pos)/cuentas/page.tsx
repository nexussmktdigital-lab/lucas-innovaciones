import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { puede } from '@/auth/permisos';
import { db } from '@/db';
import { formatearARS } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/fecha';
import { cuentasConSaldo, descuadres, extracto } from '@/gastos/cuentas';
import FormularioTransferencia from './formulario-transferencia';

export const dynamic = 'force-dynamic';

const NOMBRE_DEL_TIPO: Record<string, string> = {
  apertura: 'Apertura de caja',
  venta: 'Venta',
  cobro_fiado: 'Cobro de fiado',
  gasto: 'Gasto',
  retiro: 'Salida',
  ingreso: 'Entrada',
  anulacion: 'Anulación',
  ajuste: 'Ajuste',
};

/**
 * Dónde está la plata.
 *
 * El cajón, el banco y Mercado Pago son tres lugares distintos con tres saldos
 * distintos. El arqueo mira solo el cajón porque es lo único que se cuenta a
 * mano; acá está el resto.
 */
export default async function PaginaCuentas({
  searchParams,
}: {
  searchParams: Promise<{ cuenta?: string }>;
}) {
  const sesion = await auth();
  if (!sesion?.user || !puede(sesion.user.rol, 'gasto.ver')) redirect('/');

  const cuentas = await cuentasConSaldo(db);
  const { cuenta } = await searchParams;
  const elegida = cuentas.find((c) => c.id === cuenta) ?? cuentas[0];
  const movimientos = elegida ? await extracto(db, elegida.id, 40) : [];
  const problemas = await descuadres(db);

  const total = cuentas.reduce((n, c) => n + c.saldoCentavos, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-titulo text-2xl font-bold tracking-tight">Cuentas</h1>
          <p className="mt-1 text-sm text-(--color-tinta-suave)">
            Dónde está la plata del negocio. El saldo de cada cuenta es la suma de sus movimientos.
          </p>
        </div>
        <Link href="/gastos" className="text-sm underline underline-offset-2">
          Ver los gastos
        </Link>
      </div>

      {problemas.length > 0 ? (
        <section
          role="alert"
          className="rounded-(--radius-caja) bg-(--color-error-fondo) p-4 text-sm"
        >
          <p className="font-semibold text-(--color-error)">
            Hay {problemas.length === 1 ? 'una cuenta' : `${problemas.length} cuentas`} con el saldo
            despegado de sus movimientos
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {problemas.map((p) => (
              <li key={p.id}>
                {p.nombre}: figura {formatearARS(p.guardadoCentavos)} y los movimientos suman{' '}
                {formatearARS(p.realCentavos)}.
              </li>
            ))}
          </ul>
          <p className="mt-1 text-(--color-tinta-media)">
            El que manda es el movimiento. Esto no debería pasar nunca: si aparece, avisá antes de
            seguir operando.
          </p>
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cuentas.map((c) => (
          <Link
            key={c.id}
            href={`/cuentas?cuenta=${c.id}`}
            aria-current={elegida?.id === c.id ? 'true' : undefined}
            className={`rounded-(--radius-caja) border p-4 ${
              elegida?.id === c.id
                ? 'border-(--color-marca) bg-(--color-marca)/8'
                : 'border-(--color-borde) bg-(--color-panel)'
            }`}
          >
            <p className="text-sm text-(--color-tinta-suave)">{c.nombre}</p>
            <p
              className={`tabular mt-1 text-2xl font-bold ${
                c.saldoCentavos < 0 ? 'text-(--color-error)' : ''
              }`}
            >
              {formatearARS(c.saldoCentavos)}
            </p>
            <p className="text-xs text-(--color-tinta-suave)">
              {c.movimientos === 0
                ? 'Sin movimientos'
                : `${c.movimientos.toLocaleString('es-AR')} movimientos`}
            </p>
          </Link>
        ))}
      </div>

      <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm text-(--color-tinta-suave)">Total en todas las cuentas</span>
          <span className="tabular text-xl font-bold">{formatearARS(total)}</span>
        </div>
      </div>

      <FormularioTransferencia cuentas={cuentas} />

      {elegida ? (
        <section aria-labelledby="extracto">
          <h2 id="extracto" className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
            Movimientos de {elegida.nombre}
          </h2>

          {movimientos.length === 0 ? (
            <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-6 text-center text-sm text-(--color-tinta-suave)">
              Esta cuenta todavía no tuvo movimientos.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {movimientos.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-baseline gap-x-2 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-2.5 text-sm"
                >
                  <span className="text-xs text-(--color-tinta-suave)">
                    {formatearFechaHora(m.fecha)}
                  </span>
                  <span className="font-medium">{NOMBRE_DEL_TIPO[m.tipo] ?? m.tipo}</span>
                  {m.descripcion ? (
                    <span className="text-(--color-tinta-media)">· {m.descripcion}</span>
                  ) : null}

                  <span
                    className={`tabular ml-auto font-semibold ${
                      m.montoCentavos < 0 ? 'text-(--color-error)' : 'text-(--color-ok)'
                    }`}
                  >
                    {m.montoCentavos < 0 ? '−' : '+'}
                    {formatearARS(Math.abs(m.montoCentavos))}
                  </span>
                  <span className="tabular w-full text-right text-xs text-(--color-tinta-suave)">
                    quedó en {formatearARS(m.saldoCentavos)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
