import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { puede } from '@/auth/permisos';
import { db } from '@/db';
import {
  detalleDeVenta,
  devueltoDeLaVenta,
  fiadoDeLaVenta,
  vueltoDeLaVenta,
} from '@/ventas/detalle';
import { nombreDelMedio } from '@/ventas/ticket';
import { formatearARS, formatearUSD } from '@/lib/dinero';
import { fechaLocalISO, formatearFecha, formatearFechaHora } from '@/lib/fecha';
import FormularioAnulacion from '../formulario-anulacion';

export const dynamic = 'force-dynamic';

/** `2026-10-18` → `18/10/2026`. */
function comoSeLee(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/**
 * La ficha de una venta.
 *
 * Entre la lista —una línea por venta— y el comprobante —lo que el cliente se
 * lleva— faltaba lo de adentro: con qué se pagó, qué se cobró por cada renglón,
 * qué quedó fiado y en qué cuotas, y si algo se devolvió después. Es lo que se
 * mira cuando el cliente vuelve con una compra de hace dos días.
 *
 * **Acá sí van los medios de pago**, que en el comprobante no van a propósito.
 */
export default async function PaginaDetalleDeVenta({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sesion = await auth();
  const puedeAnular = sesion?.user ? puede(sesion.user.rol, 'venta.anular') : false;

  const venta = await detalleDeVenta(db, id);
  if (!venta) notFound();

  const fiadoCentavos = fiadoDeLaVenta(venta);
  const devueltoCentavos = devueltoDeLaVenta(venta);
  const vueltoCentavos = vueltoDeLaVenta(venta);
  const anulada = venta.estado === 'cancelled';
  const cifraDelPlan = venta.monedaDelPlan === 'USD' ? formatearUSD : formatearARS;
  const hoy = fechaLocalISO();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/ventas" className="text-sm underline underline-offset-2">
          ← Ventas
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="font-titulo text-2xl font-bold tracking-tight">
            Venta {venta.numero}
          </h1>
          <p className="cifra text-3xl leading-none">{formatearARS(venta.totalCentavos)}</p>
        </div>
        <p className="mt-1 text-sm text-(--color-tinta-suave)">
          {formatearFechaHora(venta.fecha)} · Terminal {venta.terminal}
          {venta.vendedor ? ` · atendió ${venta.vendedor}` : ''}
        </p>
      </div>

      {anulada ? (
        <section role="alert" className="rounded-(--radius-caja) bg-(--color-error-fondo) p-4">
          <p className="font-bold text-(--color-error)">Esta venta está anulada</p>
          {venta.motivoAnulacion ? (
            <p className="mt-0.5 text-sm">Motivo: {venta.motivoAnulacion}</p>
          ) : null}
          <p className="mt-0.5 text-sm text-(--color-tinta-media)">
            El stock volvió y la plata salió de la caja de aquel turno. La venta no se borra:
            queda acá para poder reconstruir lo que pasó.
          </p>
        </section>
      ) : null}

      {venta.offline ? (
        <section className="rounded-(--radius-caja) bg-(--color-alerta-fondo) p-4 text-sm">
          <p className="font-semibold">Se cobró sin conexión</p>
          <p className="mt-0.5">
            {venta.offlineCapturadaEn
              ? `Se cobró el ${formatearFechaHora(venta.offlineCapturadaEn)} y entró al sistema cuando volvió internet.`
              : 'Entró al sistema cuando volvió internet.'}
          </p>
          {venta.offlineDesvioCentavos !== 0 ? (
            <p className="mt-1">
              Se cobró <strong>{formatearARS(Math.abs(venta.offlineDesvioCentavos))}</strong>{' '}
              {venta.offlineDesvioCentavos > 0 ? 'más' : 'menos'} de lo que decía el catálogo
              cuando entró. Lo que vale es lo cobrado: es lo que está en el cajón.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Quién compró. Sin cliente no se muestra nada: la mayoría de las ventas
          del mostrador son así y un bloque vacío sería ruido. */}
      {venta.cliente ? (
        <section className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
          <p className="text-xs font-bold tracking-[0.08em] text-(--color-tinta-suave) uppercase">
            Cliente
          </p>
          <p className="mt-1 text-lg font-semibold">
            {venta.clienteId ? (
              <Link href={`/clientes/${venta.clienteId}`} className="underline underline-offset-2">
                {venta.cliente}
              </Link>
            ) : (
              venta.cliente
            )}
          </p>
          <p className="text-sm text-(--color-tinta-suave)">
            {[venta.documento ? `DNI ${venta.documento}` : null, venta.telefono]
              .filter(Boolean)
              .join(' · ') || 'Sin DNI ni teléfono cargados'}
          </p>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel)">
        <h2 className="bg-(--color-papel) px-4 py-2.5 text-xs font-bold tracking-[0.08em] text-(--color-tinta-suave) uppercase">
          Qué se vendió
        </h2>
        <ul>
          {venta.renglones.map((r, i) => (
            <li
              key={`${r.descripcion}-${i}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-(--color-borde) px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium">{r.descripcion}</p>
                <p className="text-sm text-(--color-tinta-suave)">
                  {r.cantidad} × {formatearARS(r.precioUnitarioCentavos)}
                  {r.monedaOriginal === 'USD' && r.precioUsdCentavos
                    ? ` · ${formatearUSD(r.precioUsdCentavos)} c/u`
                    : ''}
                  {r.descuentoCentavos > 0
                    ? ` · descuento −${formatearARS(r.descuentoCentavos)}`
                    : ''}
                </p>
              </div>
              <span className="cifra text-lg">{formatearARS(r.totalCentavos)}</span>
            </li>
          ))}
        </ul>

        <div className="space-y-1 border-t border-(--color-borde) bg-(--color-papel) px-4 py-3 text-sm">
          <Fila titulo="Subtotal" valor={formatearARS(venta.subtotalCentavos)} />
          {venta.descuentoCentavos > 0 ? (
            <Fila titulo="Descuento" valor={`−${formatearARS(venta.descuentoCentavos)}`} />
          ) : null}
          <Fila titulo="Total" valor={formatearARS(venta.totalCentavos)} fuerte />
          {venta.tcAplicadoCentavos ? (
            <p className="pt-1 text-xs text-(--color-tinta-suave)">
              Cotización congelada en esta venta: {formatearARS(venta.tcAplicadoCentavos)} por
              dólar.
            </p>
          ) : null}
        </div>
      </section>

      {/* Lo que no sale impreso en el comprobante: cómo se compuso el pago. */}
      <section className="overflow-hidden rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel)">
        <h2 className="bg-(--color-papel) px-4 py-2.5 text-xs font-bold tracking-[0.08em] text-(--color-tinta-suave) uppercase">
          Cómo se pagó
        </h2>
        <ul>
          {venta.pagos.map((p, i) => (
            <li
              key={`${p.medio}-${i}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-(--color-borde) px-4 py-2.5"
            >
              <span>
                {nombreDelMedio(p.medio)}
                {p.marcaTarjeta || p.cuotas ? (
                  <span className="text-sm text-(--color-tinta-suave)">
                    {' '}
                    ({[p.marcaTarjeta, p.cuotas ? `${p.cuotas} cuotas` : null]
                      .filter(Boolean)
                      .join(', ')})
                  </span>
                ) : null}
                {p.montoUsdCentavos ? (
                  <span className="text-sm text-(--color-tinta-suave)">
                    {' '}
                    · entraron {formatearUSD(p.montoUsdCentavos)}
                    {p.cotizacionCentavos
                      ? ` a ${formatearARS(p.cotizacionCentavos)} por dólar`
                      : ''}
                  </span>
                ) : null}
              </span>
              <span className="tabular font-medium">{formatearARS(p.montoCentavos)}</span>
            </li>
          ))}
          {venta.pagos.length === 0 ? (
            <li className="border-t border-(--color-borde) px-4 py-3 text-sm text-(--color-tinta-suave)">
              No quedó registrado ningún pago.
            </li>
          ) : null}
        </ul>

        {vueltoCentavos > 0 || fiadoCentavos > 0 ? (
          <div className="space-y-1 border-t border-(--color-borde) bg-(--color-papel) px-4 py-3 text-sm">
            {vueltoCentavos > 0 ? (
              <Fila titulo="Vuelto" valor={formatearARS(vueltoCentavos)} />
            ) : null}
            {fiadoCentavos > 0 ? (
              <Fila titulo="Quedó fiado" valor={formatearARS(fiadoCentavos)} fuerte />
            ) : null}
          </div>
        ) : null}
      </section>

      {venta.cuotas.length > 0 ? (
        <section className="overflow-hidden rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel)">
          <h2 className="bg-(--color-papel) px-4 py-2.5 text-xs font-bold tracking-[0.08em] text-(--color-tinta-suave) uppercase">
            Cómo lo paga {venta.monedaDelPlan === 'USD' ? '· en dólares' : ''}
          </h2>
          {/* El recargo no está en el total de la venta —el producto vale lo
              que vale— así que si no se dice acá no se ve en ninguna parte. */}
          {venta.recargoDelPlanCentavos > 0 ? (
            <p className="border-t border-(--color-borde) px-4 py-2 text-sm">
              Incluye <strong>{cifraDelPlan(venta.recargoDelPlanCentavos)}</strong> de recargo por
              financiar. El comprobante del cliente no lo muestra: va en el acuerdo de pago.
            </p>
          ) : null}
          <ul>
            {venta.cuotas.map((c) => {
              const falta = Math.max(0, c.montoCentavos - c.pagadoCentavos);
              const vencida = falta > 0 && c.vencimiento < hoy;
              return (
                <li
                  key={c.numero}
                  className="flex flex-wrap items-baseline gap-x-3 border-t border-(--color-borde) px-4 py-2.5 text-sm"
                >
                  <span className="w-12 text-(--color-tinta-suave)">Cuota {c.numero}</span>
                  <span className="tabular font-medium">{cifraDelPlan(c.montoCentavos)}</span>
                  <span
                    className={
                      vencida ? 'font-semibold text-(--color-error)' : 'text-(--color-tinta-media)'
                    }
                  >
                    {falta === 0 ? 'pagada' : `vence el ${comoSeLee(c.vencimiento)}`}
                  </span>
                  {falta > 0 && falta !== c.montoCentavos ? (
                    <span className="tabular text-xs text-(--color-tinta-suave)">
                      falta {cifraDelPlan(falta)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {venta.devoluciones.length > 0 ? (
        <section className="overflow-hidden rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel)">
          <h2 className="bg-(--color-papel) px-4 py-2.5 text-xs font-bold tracking-[0.08em] text-(--color-tinta-suave) uppercase">
            Se devolvió
          </h2>
          <ul>
            {venta.devoluciones.map((d) => (
              <li key={d.numero} className="border-t border-(--color-borde) px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-medium">
                    {d.numero} · {formatearFecha(d.fecha)}
                  </span>
                  <span className="tabular font-medium">{formatearARS(d.totalCentavos)}</span>
                </div>
                <p className="text-(--color-tinta-suave)">
                  {d.motivo}
                  {d.devueltoCentavos > 0
                    ? ` · salieron ${formatearARS(d.devueltoCentavos)} del cajón`
                    : ''}
                  {d.descontadoDeDeudaCentavos > 0
                    ? ` · ${formatearARS(d.descontadoDeDeudaCentavos)} se le descontaron de la deuda`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
          {devueltoCentavos >= venta.totalCentavos ? (
            <p className="border-t border-(--color-borde) bg-(--color-papel) px-4 py-2.5 text-sm">
              Se devolvió la venta entera.
            </p>
          ) : null}
        </section>
      ) : null}

      {venta.nota ? (
        <p className="rounded-(--radius-caja) bg-(--color-papel) p-3 text-sm">
          <span className="font-medium">Nota:</span> {venta.nota}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`/ticket/${venta.id}`}
          target="_blank"
          rel="noopener"
          className="min-h-11 rounded-(--radius-caja) bg-(--color-marca) px-4 leading-[44px] font-bold text-(--color-marca-texto)"
        >
          Ver e imprimir el comprobante
        </a>

        {/* El segundo papel de esta venta: el que lleva las cuotas y queda
            firmado en el local. El del cliente no dice nada de la deuda. */}
        {venta.cuotas.length > 0 ? (
          <a
            href={`/ticket/${venta.id}?copia=acuerdo`}
            target="_blank"
            rel="noopener"
            className="min-h-11 rounded-(--radius-caja) border border-(--color-borde) px-4 leading-[44px] font-medium"
          >
            Imprimir el acuerdo de pago
          </a>
        ) : null}

        {/* Anular solo dentro del turno abierto: la plata volvió a ese cajón y
            revertir contra una caja cerrada descuadraría dos arqueos (D29). */}
        {puedeAnular && !anulada ? (
          venta.turnoAbierto ? (
            <FormularioAnulacion ventaId={venta.id} numero={venta.numero} />
          ) : (
            <Link
              href={`/devoluciones/${venta.id}`}
              className="min-h-11 rounded-(--radius-caja) border border-(--color-borde) px-4 leading-[44px] font-medium"
            >
              Devolver
            </Link>
          )
        ) : null}
      </div>
    </div>
  );
}

function Fila({
  titulo,
  valor,
  fuerte,
}: {
  titulo: string;
  valor: string;
  fuerte?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={fuerte ? 'font-semibold' : 'text-(--color-tinta-suave)'}>{titulo}</span>
      <span className={`tabular ${fuerte ? 'font-bold' : ''}`}>{valor}</span>
    </div>
  );
}
