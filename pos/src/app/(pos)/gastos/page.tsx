import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { formatearARS } from '@/lib/dinero';
import { fechaLocalISO } from '@/lib/fecha';
import {
  beneficiarios,
  categorias,
  gastosDelMes,
  gastosPendientes,
  resumenDelMes,
  totalPendiente,
  type EstadoGasto,
} from '@/gastos/gastos';
import { cuentasConSaldo } from '@/gastos/cuentas';
import FormularioGasto from './formulario-gasto';
import FilaGasto from './fila-gasto';

export const dynamic = 'force-dynamic';

/**
 * Gastos: la plata que sale.
 *
 * Hasta acá el POS sabía todo lo que entraba y nada de lo que salía, así que
 * el arqueo cerraba de casualidad. El alquiler, el flete y lo que se le paga
 * al técnico salen del mismo cajón que las ventas.
 */
export default async function PaginaGastos({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; categoria?: string; estado?: string }>;
}) {
  const sesion = await auth();
  if (sesion?.user.rol !== 'owner') redirect('/');

  const hoy = fechaLocalISO();
  const { mes = hoy.slice(0, 7), categoria, estado } = await searchParams;

  const estadoValido: EstadoGasto | null =
    estado === 'pagado' || estado === 'pendiente' || estado === 'anulado' ? estado : null;

  const lista = await gastosDelMes(db, mes, {
    categoryId: categoria ?? null,
    estado: estadoValido,
  });
  const resumen = await resumenDelMes(db, mes);
  const pendientes = await gastosPendientes(db);
  const totales = await totalPendiente(db, hoy);
  const cats = await categorias(db);
  const benef = await beneficiarios(db);
  const cuentas = await cuentasConSaldo(db);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gastos</h1>
          <p className="mt-1 text-sm text-(--color-tinta-suave)">
            Lo que sale del negocio. Un gasto en efectivo sale del cajón del turno y el arqueo lo
            descuenta; uno por transferencia sale del banco.
          </p>
        </div>
        <Link href="/cuentas" className="text-sm underline underline-offset-2">
          Ver las cuentas
        </Link>
      </div>

      <FormularioGasto
        categorias={cats}
        beneficiarios={benef}
        cuentas={cuentas}
        hoy={hoy}
      />

      {totales.cantidad > 0 ? (
        <section
          aria-labelledby="pendientes"
          className={`rounded-(--radius-caja) border-2 p-4 ${
            totales.vencidos > 0
              ? 'border-(--color-alerta) bg-(--color-alerta)/8'
              : 'border-(--color-borde) bg-(--color-panel)'
          }`}
        >
          <h2 id="pendientes" className="text-sm font-semibold">
            Falta pagar {formatearARS(totales.totalCentavos)}
            {totales.vencidos > 0
              ? ` · ${totales.vencidos} ${totales.vencidos === 1 ? 'vencido' : 'vencidos'}`
              : ''}
          </h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {pendientes.slice(0, 5).map((g) => (
              <li key={g.id} className="flex flex-wrap items-baseline gap-x-2">
                <span>{g.descripcion}</span>
                {g.vencimiento ? (
                  <span
                    className={`text-xs ${
                      g.vencimiento < hoy
                        ? 'font-semibold text-(--color-alerta)'
                        : 'text-(--color-tinta-suave)'
                    }`}
                  >
                    vence {g.vencimiento}
                  </span>
                ) : null}
                <span className="tabular ml-auto font-medium">
                  {formatearARS(g.montoCentavos)}
                </span>
              </li>
            ))}
          </ul>
          {pendientes.length > 5 ? (
            <p className="mt-1 text-xs text-(--color-tinta-suave)">
              y {pendientes.length - 5} más. Filtrá por «pendientes» para verlos todos.
            </p>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="mes">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="mes" className="text-sm font-semibold text-(--color-tinta-suave)">
            El mes
          </h2>
          <form aria-label="Filtrar los gastos" className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="mes-filtro" className="mb-1 block text-xs font-medium">
                Mes
              </label>
              <input
                id="mes-filtro"
                name="mes"
                type="month"
                defaultValue={mes}
                className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
              />
            </div>
            <div>
              <label htmlFor="categoria-filtro" className="mb-1 block text-xs font-medium">
                Categoría
              </label>
              <select
                id="categoria-filtro"
                name="categoria"
                defaultValue={categoria ?? ''}
                className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
              >
                <option value="">Todas</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="estado-filtro" className="mb-1 block text-xs font-medium">
                Estado
              </label>
              <select
                id="estado-filtro"
                name="estado"
                defaultValue={estado ?? ''}
                className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
              >
                <option value="">Todos</option>
                <option value="pagado">Pagados</option>
                <option value="pendiente">Pendientes</option>
                <option value="anulado">Anulados</option>
              </select>
            </div>
            <button
              type="submit"
              className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) px-4 text-sm font-medium"
            >
              Ver
            </button>
          </form>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Dato titulo="Gastado en el mes" valor={formatearARS(resumen.totalCentavos)} />
          <Dato
            titulo="Cuántos gastos"
            valor={resumen.cantidad.toLocaleString('es-AR')}
            detalle={resumen.cantidad === 0 ? 'Todavía no se cargó ninguno' : undefined}
          />
        </div>

        {resumen.porCategoria.length > 0 ? (
          <section
            aria-label="Gastos por categoría"
            className="mt-3 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4"
          >
            <h3 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
              Por categoría
            </h3>
            <ul className="flex flex-col gap-1.5">
              {resumen.porCategoria.map((c) => (
                <li key={c.categoria} className="flex items-center gap-2 text-sm">
                  <span className="w-44 shrink-0 truncate">{c.categoria}</span>
                  {/* La barra mide contra la categoría más cara del mes. */}
                  <span
                    className="h-3 shrink-0 rounded-sm bg-(--color-marca)"
                    style={{
                      width: `${Math.max(
                        3,
                        (c.totalCentavos / (resumen.porCategoria[0]?.totalCentavos || 1)) * 45,
                      )}%`,
                    }}
                  />
                  <span className="tabular ml-auto font-medium">
                    {formatearARS(c.totalCentavos)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>

      {/* Nombre fijo y no el encabezado, que cambia con la cantidad: un gasto
          pendiente sale dos veces en la página —acá y en «falta pagar»— y hace
          falta poder decir cuál es cuál. */}
      <section aria-label="Gastos cargados">
        <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
          {lista.length === 1 ? '1 gasto' : `${lista.length} gastos`}
        </h2>

        {lista.length === 0 ? (
          <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-6 text-center text-sm text-(--color-tinta-suave)">
            No hay gastos cargados con ese filtro.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lista.map((g) => (
              <FilaGasto key={g.id} gasto={g} cuentas={cuentas} hoy={hoy} />
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm text-(--color-tinta-suave)">
        Anular un gasto devuelve la plata a la cuenta de donde salió, con el asiento contrario. El
        gasto no se borra: queda anulado con el motivo, igual que una venta.
      </p>
    </div>
  );
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
