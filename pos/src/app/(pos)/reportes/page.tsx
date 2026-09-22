import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { formatearARS } from '@/lib/dinero';
import { nombreDelMedio } from '@/ventas/ticket';
import {
  ErrorPeriodo,
  leerNombreDePeriodo,
  PERIODOS,
  periodoAnterior,
  periodoEntre,
  periodoPorNombre,
  variacion,
  type Periodo,
} from '@/reportes/periodo';
import {
  facturacionPorMes,
  gastosPorCategoria,
  productosVendidos,
  rentabilidad,
  resumenDeVentas,
  ventasPorCategoria,
  ventasPorDia,
  ventasPorMedio,
  ventasPorVendedor,
} from '@/reportes/ventas';
import { EXPORTABLES } from '@/reportes/exportar';
import BotonImprimir from '../caja/[id]/boton-imprimir';

export const dynamic = 'force-dynamic';

/**
 * Reportes.
 *
 * Hasta acá los números vivían de a turno: el arqueo dice qué pasó ese día y
 * nada más, y para saber cómo viene el mes había que sumar cierres a mano.
 *
 * La pantalla está ordenada por la pregunta que se hace primero —cuánto
 * vendí— y cada número viene con el del período anterior al lado, porque
 * «$180.000» no dice nada y «$180.000, 12% más que la semana pasada» sí.
 */
export default async function PaginaReportes({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; desde?: string; hasta?: string }>;
}) {
  const sesion = await auth();
  if (!sesion?.user) redirect('/ingresar');
  if (!puede(sesion.user.rol, 'reporte.ventas')) redirect('/');

  const { periodo: nombre, desde, hasta } = await searchParams;

  let periodo: Periodo;
  let errorDeFechas: string | null = null;
  try {
    periodo =
      desde && hasta ? periodoEntre(desde, hasta) : periodoPorNombre(leerNombreDePeriodo(nombre));
  } catch (e) {
    errorDeFechas = e instanceof ErrorPeriodo ? e.message : 'Ese rango de fechas no se entiende.';
    periodo = periodoPorNombre('mes');
  }

  const previo = periodoAnterior(periodo);

  const [resumen, antes, medios, top, categorias, dias, gente, gastos, margen, meses] =
    await Promise.all([
      resumenDeVentas(db, periodo),
      resumenDeVentas(db, previo),
      ventasPorMedio(db, periodo),
      productosVendidos(db, periodo, 15),
      ventasPorCategoria(db, periodo),
      ventasPorDia(db, periodo),
      ventasPorVendedor(db, periodo),
      gastosPorCategoria(db, periodo),
      rentabilidad(db, periodo),
      facturacionPorMes(db, 12),
    ]);

  const gastadoCentavos = gastos.reduce((n, g) => n + g.totalCentavos, 0);
  const elegido = leerNombreDePeriodo(nombre);
  const esRango = Boolean(desde && hasta);
  const queryDelPeriodo = esRango
    ? `desde=${periodo.desdeISO}&hasta=${periodo.hastaISO}`
    : `periodo=${elegido}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-titulo text-2xl font-bold tracking-tight">Reportes</h1>
          <p className="mt-1 text-sm text-(--color-tinta-suave)">
            {periodo.etiqueta} · del {periodo.desdeISO} al {periodo.hastaISO}
          </p>
        </div>
        <BotonImprimir />
      </div>

      <Selector elegido={esRango ? null : elegido} periodo={periodo} error={errorDeFechas} />

      <section aria-label="Lo vendido" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Dato
          titulo="Vendido"
          valor={formatearARS(resumen.totalCentavos)}
          cambio={variacion(resumen.totalCentavos, antes.totalCentavos)}
        />
        <Dato
          titulo="Ventas"
          valor={resumen.cantidadDeVentas.toLocaleString('es-AR')}
          cambio={variacion(resumen.cantidadDeVentas, antes.cantidadDeVentas)}
        />
        <Dato
          titulo="Ticket promedio"
          valor={formatearARS(resumen.ticketPromedioCentavos)}
          cambio={variacion(resumen.ticketPromedioCentavos, antes.ticketPromedioCentavos)}
        />
        <Dato
          titulo="Productos vendidos"
          valor={resumen.unidades.toLocaleString('es-AR')}
          cambio={variacion(resumen.unidades, antes.unidades)}
        />
      </section>

      {resumen.fiadoCentavos > 0 || resumen.anuladas > 0 ? (
        <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-3 text-sm text-(--color-tinta-suave)">
          {resumen.fiadoCentavos > 0 ? (
            <>
              De lo vendido,{' '}
              <strong className="tabular text-(--color-tinta)">
                {formatearARS(resumen.fiadoCentavos)}
              </strong>{' '}
              se fio: está facturado, pero esa plata no entró.
            </>
          ) : null}
          {resumen.anuladas > 0 ? (
            <>
              {resumen.fiadoCentavos > 0 ? ' ' : ''}
              Se anularon <strong>{resumen.anuladas}</strong> venta
              {resumen.anuladas === 1 ? '' : 's'}, que no cuentan en ningún número de esta
              pantalla.
            </>
          ) : null}
        </p>
      ) : null}

      {/* El resultado del período: lo que entró contra lo que salió. */}
      {gastadoCentavos > 0 ? (
        <section
          aria-label="Entró y salió"
          className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4"
        >
          <dl className="flex flex-col gap-1 text-sm">
            <Renglon termino="Vendido" valor={formatearARS(resumen.totalCentavos)} />
            <Renglon termino="Gastos pagados" valor={`−${formatearARS(gastadoCentavos)}`} rojo />
            <div className="mt-1 flex justify-between border-t border-(--color-borde) pt-2 font-bold">
              <dt>Diferencia</dt>
              <dd
                className={`tabular ${
                  resumen.totalCentavos - gastadoCentavos >= 0
                    ? 'text-(--color-ok)'
                    : 'text-(--color-error)'
                }`}
              >
                {formatearARS(resumen.totalCentavos - gastadoCentavos)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-(--color-tinta-suave)">
            No es la ganancia: acá no está descontado lo que costó la mercadería, y lo fiado suma
            sin haber entrado.
          </p>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {medios.length > 0 ? (
          <Panel titulo="Por medio de pago">
            <dl className="flex flex-col gap-1 text-sm">
              {medios.map((m) => (
                <Renglon
                  key={m.medio}
                  termino={`${nombreDelMedio(m.medio)} · ${m.cantidad}`}
                  valor={formatearARS(m.totalCentavos)}
                />
              ))}
            </dl>
            <p className="mt-2 text-xs text-(--color-tinta-suave)">
              Neto de vuelto y sin la cuenta corriente, que es deuda y no plata. No incluye los
              cobros de deudas viejas: eso es movimiento del cajón y está en el reporte del turno.
            </p>
          </Panel>
        ) : null}

        {categorias.length > 0 ? (
          <Panel titulo="Por categoría">
            <Barras
              filas={categorias.map((c) => ({
                etiqueta: c.categoria,
                valor: c.totalCentavos,
                detalle: `${c.unidades} u.`,
              }))}
            />
          </Panel>
        ) : null}
      </div>

      {top.length > 0 ? (
        <Panel titulo="Qué se vendió">
          <p className="mb-2 text-xs text-(--color-tinta-suave)">
            Ordenado por facturación y no por unidades: veinte vidrios son más unidades que un
            celular y mucha menos plata, y lo que hay que reponer primero es lo segundo.
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {top.map((p, i) => (
              <li key={p.productId} className="flex flex-wrap items-baseline gap-x-2">
                <span className="tabular w-6 shrink-0 text-xs text-(--color-tinta-suave)">
                  {i + 1}
                </span>
                <span className="font-medium">{p.descripcion}</span>
                {p.categoria ? (
                  <span className="text-xs text-(--color-tinta-suave)">{p.categoria}</span>
                ) : null}
                <span className="tabular ml-auto text-(--color-tinta-suave)">
                  {p.unidades} u.
                </span>
                <span className="tabular w-32 shrink-0 text-right font-semibold">
                  {formatearARS(p.totalCentavos)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {dias.length > 1 && dias.length <= 62 ? (
        <Panel titulo="Día por día">
          <Barras
            filas={dias.map((d) => ({
              etiqueta: d.dia.slice(8) + '/' + d.dia.slice(5, 7),
              valor: d.totalCentavos,
              detalle: d.ventas > 0 ? `${d.ventas} vta.` : '',
            }))}
          />
        </Panel>
      ) : null}

      <Panel titulo="Cuánto quedó">
        {margen.unidadesConCosto === 0 ? (
          <p className="text-sm text-(--color-tinta-suave)">
            Todavía no hay ningún producto con el costo cargado, así que no hay margen que
            calcular. El costo se carga al dar de alta un producto o en la columna{' '}
            <strong>costo</strong> de la planilla de importación, y queda congelado en cada venta.
          </p>
        ) : (
          <>
            <dl className="flex flex-col gap-1 text-sm">
              <Renglon
                termino="Vendido de lo que tiene costo"
                valor={formatearARS(margen.ventaConCostoCentavos)}
              />
              <Renglon termino="Lo que costó" valor={`−${formatearARS(margen.costoCentavos)}`} rojo />
              <div className="mt-1 flex justify-between border-t border-(--color-borde) pt-2 font-bold">
                <dt>Ganancia</dt>
                <dd className="tabular text-(--color-ok)">
                  {formatearARS(margen.gananciaCentavos)}
                  {margen.margenBp !== null ? (
                    <span className="ml-2 text-sm font-normal text-(--color-tinta-suave)">
                      {(margen.margenBp / 100).toLocaleString('es-AR', {
                        maximumFractionDigits: 1,
                      })}
                      %
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>

            {/* Un margen calculado sobre una parte del movimiento y presentado
                como «el margen del mes» es peor que no tener el número. */}
            <p className="mt-2 rounded-(--radius-caja) bg-(--color-papel) p-2 text-xs text-(--color-tinta-suave)">
              Sobre <strong>{margen.unidadesConCosto}</strong> de las{' '}
              <strong>{margen.unidadesTotales}</strong> unidades vendidas. Las demás no tienen el
              costo cargado y no entran en esta cuenta.
            </p>
          </>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {gastos.length > 0 ? (
          <Panel titulo="Gastos del período">
            <Barras
              filas={gastos.map((g) => ({
                etiqueta: g.categoria,
                valor: g.totalCentavos,
                detalle: `${g.cantidad}`,
              }))}
            />
          </Panel>
        ) : null}

        {gente.length > 1 ? (
          <Panel titulo="Por vendedor">
            <dl className="flex flex-col gap-1 text-sm">
              {gente.map((v) => (
                <Renglon
                  key={v.usuarioId}
                  termino={`${v.nombre} · ${v.ventas}`}
                  valor={formatearARS(v.totalCentavos)}
                />
              ))}
            </dl>
          </Panel>
        ) : null}
      </div>

      {/* Este panel NO sigue el período elegido arriba, y hay que decirlo en el
          título: si no, alguien que mira «mes pasado» ve el mes actual a medias
          al final del gráfico y lo lee como un derrumbe de las ventas. */}
      <Panel titulo="Mes a mes · últimos 12 meses, sin importar el período elegido">
        <p className="mb-2 text-xs text-(--color-tinta-suave)">
          El negocio no empezó con este POS. Lo que quedó del sistema anterior se suma acá para
          poder comparar, y se distingue de lo que registró el POS.
        </p>
        <Barras
          filas={meses.map((m) => ({
            etiqueta: m.mes,
            valor: m.totalCentavos,
            detalle: m.historicoCentavos > 0 && m.posCentavos > 0 ? 'mixto' : m.historicoCentavos > 0 ? 'anterior' : '',
          }))}
        />
      </Panel>

      <section
        aria-label="Bajar planillas"
        className="sin-imprimir rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4"
      >
        <h2 className="mb-1 text-sm font-semibold text-(--color-tinta-suave)">Bajar planillas</h2>
        <p className="mb-3 text-xs text-(--color-tinta-suave)">
          Del período elegido, listas para abrir en Excel o mandarle al contador.
        </p>
        <div className="flex flex-col gap-2">
          {EXPORTABLES.map((e) => (
            <a
              key={e.que}
              href={`/api/reportes/exportar?que=${e.que}&${queryDelPeriodo}`}
              className="flex min-h-12 flex-wrap items-center gap-x-2 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 py-2"
            >
              <span className="font-medium">{e.etiqueta}</span>
              <span className="text-xs text-(--color-tinta-suave)">{e.detalle}</span>
              <span className="ml-auto text-sm font-semibold underline underline-offset-2">
                Bajar
              </span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Los períodos de un clic, más un rango escrito a mano. */
function Selector({
  elegido,
  periodo,
  error,
}: {
  elegido: string | null;
  periodo: Periodo;
  error: string | null;
}) {
  return (
    <div className="sin-imprimir space-y-2">
      <div className="flex flex-wrap gap-2">
        {PERIODOS.map((p) => (
          <Link
            key={p.nombre}
            href={`/reportes?periodo=${p.nombre}`}
            className={`min-h-10 rounded-(--radius-caja) border px-3 leading-10 text-sm font-medium ${
              elegido === p.nombre
                ? 'border-(--color-marca) bg-(--color-marca)/10'
                : 'border-(--color-borde)'
            }`}
          >
            {p.etiqueta}
          </Link>
        ))}
      </div>

      <form
        action="/reportes"
        aria-label="Elegir un rango de fechas"
        className="flex flex-wrap items-end gap-2"
      >
        <div>
          <label htmlFor="desde" className="mb-1 block text-xs text-(--color-tinta-suave)">
            Desde
          </label>
          <input
            id="desde"
            name="desde"
            type="date"
            defaultValue={periodo.desdeISO}
            className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
          />
        </div>
        <div>
          <label htmlFor="hasta" className="mb-1 block text-xs text-(--color-tinta-suave)">
            Hasta
          </label>
          <input
            id="hasta"
            name="hasta"
            type="date"
            defaultValue={periodo.hastaISO}
            className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
          />
        </div>
        <button
          type="submit"
          className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) px-3 text-sm font-medium"
        >
          Ver
        </button>
      </form>

      {error ? (
        <p role="alert" className="text-sm font-medium text-(--color-error)">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Dato({
  titulo,
  valor,
  cambio,
}: {
  titulo: string;
  valor: string;
  cambio: number | null;
}) {
  return (
    <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
      <p className="text-xs font-bold tracking-[0.08em] text-(--color-tinta-suave) uppercase">
        {titulo}
      </p>
      <p className="cifra mt-1 text-[32px] leading-tight">{valor}</p>
      {/* Crecer desde cero no es «infinito por ciento»: es un período nuevo. */}
      {cambio === null ? (
        <p className="text-xs text-(--color-tinta-suave)">sin nada antes para comparar</p>
      ) : (
        <p
          className={`tabular text-xs font-medium ${
            cambio > 0
              ? 'text-(--color-ok)'
              : cambio < 0
                ? 'text-(--color-error)'
                : 'text-(--color-tinta-suave)'
          }`}
        >
          {cambio > 0 ? '▲' : cambio < 0 ? '▼' : '='} {Math.abs(cambio)}% vs. el período anterior
        </p>
      )}
    </div>
  );
}

function Panel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={titulo}
      className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4"
    >
      <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">{titulo}</h2>
      {children}
    </section>
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
    <div className="flex justify-between gap-2">
      <dt>{termino}</dt>
      <dd className={`tabular ${rojo ? 'text-(--color-error)' : ''}`}>{valor}</dd>
    </div>
  );
}

/**
 * Barras proporcionales, en CSS.
 *
 * Sin librería de gráficos: son quince filas y una barra es un `div` con un
 * ancho en porcentaje. Una dependencia de 90 kB para esto sería más código que
 * mantener y una pantalla más lenta en la tablet del mostrador.
 */
function Barras({
  filas,
}: {
  filas: { etiqueta: string; valor: number; detalle?: string }[];
}) {
  const maximo = Math.max(...filas.map((f) => f.valor), 1);

  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {filas.map((f) => (
        <li key={f.etiqueta} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-xs">{f.etiqueta}</span>
          <span className="h-5 min-w-px flex-1 rounded-sm bg-(--color-papel)">
            <span
              className="block h-full rounded-sm bg-(--color-marca)/70"
              style={{ width: `${Math.max((f.valor / maximo) * 100, f.valor > 0 ? 2 : 0)}%` }}
            />
          </span>
          {f.detalle ? (
            <span className="tabular w-16 shrink-0 text-right text-xs text-(--color-tinta-suave)">
              {f.detalle}
            </span>
          ) : null}
          <span className="tabular w-28 shrink-0 text-right font-medium">
            {formatearARS(f.valor)}
          </span>
        </li>
      ))}
    </ul>
  );
}
