import Link from 'next/link';
import { auth } from '@/auth';
import { puede } from '@/auth/permisos';
import { db } from '@/db';
import { config } from '@/lib/config';
import { sesionAbierta } from '@/caja/sesion';
import { buscarVentas, TOPE_BUSQUEDA, ventasEnPeriodo } from '@/ventas/anular';
import {
  ErrorPeriodo,
  leerNombreDePeriodo,
  periodoEntre,
  periodoPorNombre,
  PERIODOS,
  type Periodo,
} from '@/reportes/periodo';
import { nombreDelMedio } from '@/ventas/ticket';
import { formatearARS } from '@/lib/dinero';
import { formatearFecha, formatearFechaHora, formatearHora } from '@/lib/fecha';
import { devolucionesPendientes } from '@/fiado/devoluciones';
import { armarComprobantes } from '@/whatsapp/mensajes';
import type { MedioPago } from '@/ventas/carrito';
import BotonWhatsApp from '../boton-whatsapp';
import FormularioAnulacion from './formulario-anulacion';

export const dynamic = 'force-dynamic';

/**
 * Las columnas de la planilla, y cuáles se caen cuando la pantalla achica.
 *
 * En la MacBook entran las seis. En la tablet del mostrador se van el número de
 * comprobante y el medio de pago: son las dos que se miran después, sentado, y
 * las otras cuatro son las que se buscan con el cliente enfrente.
 */
const COLUMNAS =
  'grid grid-cols-[52px_1fr_auto] gap-x-3 ' +
  'sm:grid-cols-[52px_120px_1fr_110px_auto] ' +
  'lg:grid-cols-[52px_120px_1fr_110px_150px_130px]';

/**
 * Historial de ventas.
 *
 * Existe por tres cosas que se necesitan todos los días: volver a imprimir un
 * comprobante —hasta ahora, si se cerraba la ventana, se perdía—, anular una
 * venta mal cargada, y **buscar una venta de otro día**: «la del iPhone de la
 * semana pasada», que es lo que se pregunta cuando el cliente vuelve.
 *
 * Arranca en **hoy** y no en el turno abierto, que es lo que mostraba antes: un
 * turno es una unidad de caja, no de calendario, y quien busca una venta piensa
 * en días. De paso, la pantalla ahora abre con la caja cerrada —mirar lo de ayer
 * a la mañana, antes de abrir, es justo cuando se mira—.
 */
export default async function PaginaVentas({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; desde?: string; hasta?: string; q?: string }>;
}) {
  const sesion = await auth();
  const puedeAnular = sesion?.user ? puede(sesion.user.rol, 'venta.anular') : false;
  const terminal = config().POS_TERMINAL;
  const caja = await sesionAbierta(db, terminal);

  const { periodo: pedido, desde, hasta, q } = await searchParams;
  const termino = (q ?? '').trim();

  /*
   * El período, igual que en Reportes y con el mismo código.
   *
   * Un rango escrito a mano que no se entiende no deja la pantalla en blanco:
   * se muestra el error y se cae a «hoy», que es lo que casi siempre se quiere.
   */
  let error: string | null = null;
  let periodo: Periodo;
  let elegido: string | null = null;

  if (desde && hasta) {
    try {
      periodo = periodoEntre(desde, hasta);
    } catch (e) {
      error = e instanceof ErrorPeriodo ? e.message : 'No se entiende ese rango de fechas.';
      periodo = periodoPorNombre('hoy');
      elegido = 'hoy';
    }
  } else {
    const nombre = pedido ? leerNombreDePeriodo(pedido) : 'hoy';
    periodo = periodoPorNombre(nombre);
    elegido = nombre;
  }

  /*
   * Buscando, el período no corre: se busca en todo el historial.
   *
   * Quien busca «la venta del iPhone» no sabe de qué día es —si lo supiera ya
   * la habría encontrado con los períodos— así que acotar la búsqueda al
   * período sería buscar justo donde ya se miró.
   */
  const ventas = termino
    ? await buscarVentas(db, termino)
    : await ventasEnPeriodo(db, periodo.desde, periodo.hasta);

  // Con un período de un día alcanza la hora; con varios hace falta la fecha,
  // o dos ventas de días distintos se leen como si fueran del mismo. Buscando,
  // siempre la fecha: los resultados son de cualquier día.
  const unSoloDia = !termino && periodo.desdeISO === periodo.hastaISO;
  const vigentes = ventas.filter((v) => v.estado === 'completed');
  const facturado = vigentes.reduce((suma, v) => suma + v.totalCentavos, 0);
  const comprobantes = await armarComprobantes(
    db,
    vigentes.map((v) => v.id),
  );

  // El aviso de «devolvele la plata» lo pone el servidor y no el formulario de
  // anulación: al anular, la página se vuelve a renderizar y ese formulario
  // desaparece con la venta, así que un cartel suyo no lo llega a ver nadie.
  // Además, así sigue estando mañana.
  const aDevolver = new Map(
    (await devolucionesPendientes(db)).map((d) => [d.saleId, d]),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-titulo text-2xl font-bold tracking-tight">Ventas</h1>
          <p className="text-sm text-(--color-tinta-suave)">
            {termino ? `Buscando «${termino}» en todo el historial` : periodo.etiqueta} · Terminal{' '}
            {terminal}
            {caja ? ` · turno abierto desde ${formatearFechaHora(caja.abiertaEn)}` : ' · caja cerrada'}
          </p>
        </div>
      </div>

      <Buscador termino={termino} />

      {/* Buscando no se muestran los períodos: la búsqueda los ignora a
          propósito y dejarlos marcados diría que filtran cuando no filtran. */}
      {termino ? null : <Selector elegido={elegido} periodo={periodo} error={error} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <Dato titulo="Ventas" valor={vigentes.length.toLocaleString('es-AR')} />
        <Dato titulo="Facturado" valor={formatearARS(facturado)} />
      </div>

      {ventas.length === 0 ? (
        <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-6 text-center text-sm text-(--color-tinta-suave)">
          {termino
            ? `No hay ninguna venta que diga «${termino}». Probá con menos palabras: el nombre del cliente, el modelo, o el número del comprobante.`
            : 'No hay ventas en ese período.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel)">
          {/*
            Se lee como una planilla: las columnas caen siempre en el mismo
            lugar y el ojo baja por la de la derecha. En la tablet del mostrador
            se caen las dos que se pueden mirar después —el número de
            comprobante y con qué pagó— y quedan hora, qué se vendió, quién
            vendió y cuánto.
          */}
          <div className={`${COLUMNAS} bg-(--color-papel) px-4 py-2.5 text-xs font-bold tracking-[0.08em] text-(--color-tinta-suave) uppercase`}>
            <div>{unSoloDia ? 'Hora' : 'Fecha'}</div>
            <div className="hidden sm:block">Comprobante</div>
            <div>Qué se vendió</div>
            <div className="hidden sm:block">Cliente</div>
            <div className="hidden lg:block">Pago</div>
            <div className="text-right">Total</div>
          </div>

          <ul>
            {ventas.map((v) => {
              const anulada = v.estado === 'cancelled';
              const comprobante = comprobantes.get(v.id);
              return (
                <li
                  key={v.id}
                  className={`border-t border-(--color-borde) px-4 py-3 ${
                    anulada ? 'opacity-70' : ''
                  }`}
                >
                  <div className={`${COLUMNAS} items-baseline`}>
                    <span className="tabular text-sm text-(--color-tinta-suave)">
                      {unSoloDia ? formatearHora(v.fecha) : formatearFecha(v.fecha)}
                    </span>
                    {/* El número abre la ficha. Es por donde se entra cuando se
                        busca una venta vieja y hay que ver qué pasó adentro. */}
                    <span className="tabular hidden text-sm sm:block">
                      <Link
                        href={`/ventas/${v.id}`}
                        className="text-(--color-tinta-suave) underline underline-offset-2"
                      >
                        {v.numero}
                      </Link>
                    </span>
                    <span className="min-w-0 text-sm">
                      {v.detalle}{' '}
                      <span className="text-(--color-tinta-suave)">
                        · {v.unidades} {v.unidades === 1 ? 'unidad' : 'unidades'}
                      </span>
                      {anulada ? (
                        <span className="ml-1.5 rounded bg-(--color-error-fondo) px-1.5 py-0.5 text-xs font-bold text-(--color-error)">
                          Anulada
                        </span>
                      ) : null}
                      {/* La hora que se muestra es la del cobro, no la de la
                          carga: por eso hay que decir que esta venta entró
                          después, o parece que el correlativo está desordenado. */}
                      {v.offline ? (
                        <span className="ml-1.5 rounded bg-(--color-alerta-fondo) px-1.5 py-0.5 text-xs font-bold text-(--color-alerta-tinta)">
                          Cobrada sin conexión
                        </span>
                      ) : null}
                    </span>
                    <span className="hidden text-sm text-(--color-tinta-suave) sm:block">
                      {v.cliente ?? v.vendedor ?? '—'}
                    </span>
                    <span className="hidden text-sm text-(--color-tinta-suave) lg:block">
                      {v.medios.map((m) => nombreDelMedio(m as MedioPago)).join(' + ') || '—'}
                    </span>
                    <span
                      className={`cifra text-right text-lg ${
                        anulada ? 'text-(--color-tinta-suave) line-through' : ''
                      }`}
                    >
                      {formatearARS(v.totalCentavos)}
                    </span>
                  </div>

                  {anulada && v.motivoAnulacion ? (
                    <p className="mt-2 rounded-(--radius-caja) bg-(--color-papel) p-2 text-sm">
                      <span className="font-medium">Motivo:</span> {v.motivoAnulacion}
                    </p>
                  ) : null}

                  {/* Lo único de una venta diferida que pide una decisión: se
                      cobró un precio y el catálogo dice otro. Se muestra
                      siempre, no en un tooltip, porque hay que hacer algo. */}
                  {v.offlineDesvioCentavos !== 0 ? (
                    <p className="mt-2 rounded-(--radius-caja) bg-(--color-alerta-fondo) p-2 text-sm">
                      Se cobró {formatearARS(Math.abs(v.offlineDesvioCentavos))}{' '}
                      {v.offlineDesvioCentavos > 0 ? 'más' : 'menos'} de lo que decía el catálogo
                      cuando entró. Lo que vale es lo cobrado: es lo que está en el cajón.
                    </p>
                  ) : null}

                  {aDevolver.has(v.id) ? (
                    <div
                      role="alert"
                      className="mt-2 rounded-(--radius-caja) bg-(--color-error-fondo) p-3 text-sm"
                    >
                      <p className="font-bold text-(--color-error)">
                        Devolvele {formatearARS(aDevolver.get(v.id)!.montoCentavos)} a{' '}
                        {aDevolver.get(v.id)!.nombre}
                      </p>
                      <p className="mt-0.5">
                        Ya había pagado esa parte de esta venta y quedó en la caja.
                      </p>
                      <Link
                        href={`/clientes/${aDevolver.get(v.id)!.customerId}`}
                        className="mt-1 inline-block font-medium underline underline-offset-2"
                      >
                        Marcarlo cuando se le devuelva
                      </Link>
                    </div>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {/* En la tablet la columna del número no entra, así que el
                        camino a la ficha también está acá: es el primero,
                        porque mirar la venta es lo que se hace antes de
                        decidir si se reimprime, se anula o se devuelve. */}
                    <Link
                      href={`/ventas/${v.id}`}
                      className="text-sm font-medium underline underline-offset-2"
                    >
                      Ver la venta
                    </Link>
                    <a
                      href={`/ticket/${v.id}`}
                      target="_blank"
                      rel="noopener"
                      className="text-sm font-medium underline underline-offset-2"
                    >
                      Ver e imprimir el comprobante
                    </a>

                    {/* Sin cliente cargado no se dice nada: la mayoría de las
                        ventas del mostrador son así y avisarlo en cada fila
                        sería ruido. Que falte el teléfono sí se avisa. */}
                    {comprobante?.listo ? (
                      <BotonWhatsApp
                        tipo="comprobante"
                        referenciaId={v.id}
                        enlace={comprobante.mensaje.enlace}
                        etiqueta={`Mandarlo por WhatsApp a ${comprobante.mensaje.nombre}`}
                      />
                    ) : comprobante?.codigo === 'sin_telefono' ? (
                      <BotonWhatsApp
                        tipo="comprobante"
                        referenciaId={v.id}
                        enlace=""
                        etiqueta="WhatsApp"
                        motivo={comprobante.motivo}
                      />
                    ) : null}

                    {/*
                      Anular solo dentro del turno abierto: la plata volvió a
                      ese cajón y revertir contra una caja cerrada descuadraría
                      dos arqueos. Lo de otro día se devuelve, que sale del
                      cajón de hoy y el arqueo lo explica.
                    */}
                    {puedeAnular && !anulada ? (
                      caja && v.cashSessionId === caja.id ? (
                        <FormularioAnulacion ventaId={v.id} numero={v.numero} />
                      ) : (
                        <Link
                          href={`/devoluciones/${v.id}`}
                          className="text-sm font-medium underline underline-offset-2"
                        >
                          Devolver
                        </Link>
                      )
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {termino && ventas.length === TOPE_BUSQUEDA ? (
        <p className="text-sm text-(--color-tinta-suave)">
          Se muestran las {TOPE_BUSQUEDA} más nuevas. Si la que buscás no está, agregá una palabra
          más: con dos o tres la lista se achica sola.
        </p>
      ) : null}

      <p className="text-sm text-(--color-tinta-suave)">
        Anular repone el stock y saca la plata de la caja del turno, con el asiento contrario en
        cada libro. La venta no se borra: queda marcada como anulada, con el motivo. Una venta de
        un turno ya cerrado no se anula —descuadraría el arqueo de aquel día—: se{' '}
        <strong>devuelve</strong>, y eso sale del cajón de hoy.
      </p>
    </div>
  );
}

/**
 * Buscar una venta sin saber el día.
 *
 * Es un `GET` con `name="q"`: el resultado queda en la URL, así que se puede
 * recargar, mandar el enlace o dejarlo abierto en una pestaña mientras se
 * atiende, que es lo que pasa en el mostrador.
 */
function Buscador({ termino }: { termino: string }) {
  return (
    <form action="/ventas" aria-label="Buscar una venta" className="flex flex-wrap gap-2">
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={termino}
        // Lo que se recuerda de una venta vieja, en el orden en que se recuerda.
        placeholder="Buscar por cliente, producto o número de comprobante"
        aria-label="Buscar una venta"
        className="min-h-11 min-w-0 flex-1 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-3"
      />
      <button
        type="submit"
        className="min-h-11 rounded-(--radius-caja) bg-(--color-marca) px-4 font-bold text-(--color-marca-texto)"
      >
        Buscar
      </button>
      {termino ? (
        <Link
          href="/ventas"
          className="min-h-11 rounded-(--radius-caja) border border-(--color-borde) px-4 leading-[44px] font-medium"
        >
          Volver a hoy
        </Link>
      ) : null}
    </form>
  );
}

/** Los períodos de un clic, más un rango escrito a mano. Igual que en Reportes. */
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
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {PERIODOS.map((p) => (
          <Link
            key={p.nombre}
            href={`/ventas?periodo=${p.nombre}`}
            className={`min-h-10 rounded-(--radius-caja) border px-3 text-sm leading-10 font-medium ${
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
        action="/ventas"
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

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
      <p className="text-xs font-bold tracking-[0.08em] text-(--color-tinta-suave) uppercase">
        {titulo}
      </p>
      <p className="cifra mt-1 text-[32px] leading-tight">{valor}</p>
    </div>
  );
}
