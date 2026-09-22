import Link from 'next/link';
import { auth } from '@/auth';
import { db } from '@/db';
import { config } from '@/lib/config';
import { sesionAbierta } from '@/caja/sesion';
import { ventasDelTurno } from '@/ventas/anular';
import { nombreDelMedio } from '@/ventas/ticket';
import { formatearARS } from '@/lib/dinero';
import { formatearFechaHora, formatearHora } from '@/lib/fecha';
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
 * Ventas del turno.
 *
 * Existe por dos cosas que faltaban y que se necesitan todos los días: volver a
 * imprimir un comprobante —hasta ahora, si se cerraba la ventana, se perdía— y
 * anular una venta mal cargada.
 */
export default async function PaginaVentas() {
  const sesion = await auth();
  const esDuenio = sesion?.user.rol === 'owner';
  const terminal = config().POS_TERMINAL;
  const caja = await sesionAbierta(db, terminal);

  if (!caja) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="font-titulo text-2xl font-bold tracking-tight">Ventas del turno</h1>
        <p className="mt-4 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-6 text-sm">
          La caja está cerrada, así que no hay un turno en curso.{' '}
          <Link href="/caja" className="font-semibold underline underline-offset-2">
            Abrir la caja
          </Link>
        </p>
      </div>
    );
  }

  const ventas = await ventasDelTurno(db, caja.id);
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
          <h1 className="font-titulo text-2xl font-bold tracking-tight">Ventas del turno</h1>
          <p className="text-sm text-(--color-tinta-suave)">
            Desde {formatearFechaHora(caja.abiertaEn)} · Terminal {terminal}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Dato titulo="Ventas" valor={vigentes.length.toLocaleString('es-AR')} />
        <Dato titulo="Facturado" valor={formatearARS(facturado)} />
      </div>

      {ventas.length === 0 ? (
        <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-6 text-center text-sm text-(--color-tinta-suave)">
          Todavía no se vendió nada en este turno.
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
            <div>Hora</div>
            <div className="hidden sm:block">Comprobante</div>
            <div>Qué se vendió</div>
            <div className="hidden sm:block">Vendedor</div>
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
                      {formatearHora(v.fecha)}
                    </span>
                    <span className="tabular hidden text-sm text-(--color-tinta-suave) sm:block">
                      {v.numero}
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
                      {v.vendedor ?? '—'}
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

                    {esDuenio && !anulada ? (
                      <FormularioAnulacion ventaId={v.id} numero={v.numero} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-sm text-(--color-tinta-suave)">
        Anular repone el stock y saca la plata de la caja del turno, con el asiento contrario en
        cada libro. La venta no se borra: queda marcada como anulada, con el motivo.
      </p>
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
