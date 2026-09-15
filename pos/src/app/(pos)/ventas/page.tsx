import Link from 'next/link';
import { auth } from '@/auth';
import { db } from '@/db';
import { config } from '@/lib/config';
import { sesionAbierta } from '@/caja/sesion';
import { ventasDelTurno } from '@/ventas/anular';
import { nombreDelMedio } from '@/ventas/ticket';
import { formatearARS } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/fecha';
import { devolucionesPendientes } from '@/fiado/devoluciones';
import { armarComprobantes } from '@/whatsapp/mensajes';
import type { MedioPago } from '@/ventas/carrito';
import BotonWhatsApp from '../boton-whatsapp';
import FormularioAnulacion from './formulario-anulacion';

export const dynamic = 'force-dynamic';

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
        <h1 className="text-2xl font-bold tracking-tight">Ventas del turno</h1>
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
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Ventas del turno</h1>
        <p className="text-sm text-(--color-tinta-suave)">
          Desde {formatearFechaHora(caja.abiertaEn)} · Terminal {terminal}
        </p>
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
        <ul className="flex flex-col gap-2">
          {ventas.map((v) => {
            const anulada = v.estado === 'cancelled';
            const comprobante = comprobantes.get(v.id);
            return (
              <li
                key={v.id}
                className={`rounded-(--radius-caja) border bg-(--color-panel) p-3 ${
                  anulada ? 'border-(--color-borde) opacity-70' : 'border-(--color-borde)'
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="tabular font-semibold">{v.numero}</span>
                  <span className="text-xs text-(--color-tinta-suave)">
                    {formatearFechaHora(v.fecha)}
                  </span>
                  {v.vendedor ? (
                    <span className="text-xs text-(--color-tinta-suave)">· {v.vendedor}</span>
                  ) : null}
                  {anulada ? (
                    <span className="rounded bg-(--color-error)/15 px-1.5 py-0.5 text-xs font-semibold text-(--color-error)">
                      Anulada
                    </span>
                  ) : null}
                  <span
                    className={`tabular ml-auto text-lg font-bold ${
                      anulada ? 'text-(--color-tinta-suave) line-through' : ''
                    }`}
                  >
                    {formatearARS(v.totalCentavos)}
                  </span>
                </div>

                <p className="mt-1 text-sm text-(--color-tinta-media)">{v.detalle}</p>

                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-(--color-tinta-suave)">
                  <span>
                    {v.unidades} {v.unidades === 1 ? 'unidad' : 'unidades'}
                  </span>
                  {v.medios.map((m) => (
                    <span key={m}>· {nombreDelMedio(m as MedioPago)}</span>
                  ))}
                </div>

                {anulada && v.motivoAnulacion ? (
                  <p className="mt-2 rounded-(--radius-caja) bg-(--color-papel) p-2 text-sm">
                    <span className="font-medium">Motivo:</span> {v.motivoAnulacion}
                  </p>
                ) : null}

                {aDevolver.has(v.id) ? (
                  <div
                    role="alert"
                    className="mt-2 rounded-(--radius-caja) border-2 border-(--color-error) bg-(--color-error)/10 p-3 text-sm"
                  >
                    <p className="font-semibold text-(--color-error)">
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
                      ventas del mostrador son así y avisarlo en cada fila sería
                      ruido. Que falte el teléfono sí se avisa: eso se arregla. */}
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
      <p className="text-sm text-(--color-tinta-suave)">{titulo}</p>
      <p className="tabular mt-1 text-2xl font-bold">{valor}</p>
    </div>
  );
}
