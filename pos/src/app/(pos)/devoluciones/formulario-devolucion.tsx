'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { devolverAccion, type EstadoDevolucion } from '@/app/acciones-devoluciones';
import { formatearARS } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/fecha';
import type { VentaDevolvible } from '@/ventas/devolver';

const INICIAL: EstadoDevolucion = {};

interface Cuenta {
  id: string;
  nombre: string;
  tipo: string;
}

/**
 * Devolver una venta de un turno cerrado.
 *
 * Se elige que se devuelve renglon por renglon, y de cada uno si vuelve a estar
 * vendible: un cargador fallado no se vuelve a vender, y el sistema no puede
 * saberlo solo.
 */
export default function FormularioDevolucion({
  venta,
  cuentas,
}: {
  venta: VentaDevolvible;
  cuentas: Cuenta[];
}) {
  const [estado, accion, pendiente] = useActionState(devolverAccion, INICIAL);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [alStock, setAlStock] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(venta.lineas.map((l) => [l.saleItemId, true])),
  );
  const [aDeuda, setADeuda] = useState<string>('');

  const total = useMemo(
    () =>
      venta.lineas.reduce((n, l) => {
        const c = Number(cantidades[l.saleItemId] ?? '0');
        if (!Number.isInteger(c) || c <= 0) return n;
        return n + Math.min(c, l.cantidadDisponible) * l.precioUnitarioCentavos;
      }, 0),
    [cantidades, venta.lineas],
  );

  // Lo que se propone descontar: todo lo que la deuda permita. Devolverle
  // efectivo a quien todavía debe por esa misma venta es equivocarse dos veces.
  const tope = Math.min(venta.deudaDelClienteCentavos, total);
  const descontar = aDeuda === '' ? tope : Math.min(Math.round(Number(aDeuda) * 100) || 0, tope);
  const enPlata = Math.max(0, total - descontar);

  if (estado.ok && estado.hecha) {
    const h = estado.hecha;
    return (
      <div className="space-y-4">
        <div className="rounded-(--radius-caja) border-2 border-(--color-ok) bg-(--color-ok)/8 p-4">
          <p role="status" className="font-semibold text-(--color-ok)">
            {estado.ok}
          </p>
          <dl className="mt-2 flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <dt>Lo devuelto valía</dt>
              <dd className="tabular">{formatearARS(h.totalCentavos)}</dd>
            </div>
            {h.devueltoCentavos > 0 ? (
              <div className="flex justify-between font-semibold">
                <dt>Se le devolvió</dt>
                <dd className="tabular">{formatearARS(h.devueltoCentavos)}</dd>
              </div>
            ) : null}
            {h.descontadoDeDeudaCentavos > 0 ? (
              <div className="flex justify-between">
                <dt>Se le descontó de lo que debía</dt>
                <dd className="tabular">{formatearARS(h.descontadoDeDeudaCentavos)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between text-(--color-tinta-suave)">
              <dt>Volvió al stock</dt>
              <dd className="tabular">{h.unidadesAlStock} u.</dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/devoluciones"
            className="min-h-12 flex-1 rounded-(--radius-caja) border border-(--color-borde) px-4 text-center leading-[3rem] font-medium"
          >
            Volver
          </Link>
          <Link
            href="/caja"
            className="min-h-12 flex-1 rounded-(--radius-caja) border border-(--color-borde) px-4 text-center leading-[3rem] font-medium"
          >
            Ver el arqueo
          </Link>
        </div>
      </div>
    );
  }

  const nadaQueDevolver = venta.lineas.every((l) => l.cantidadDisponible === 0);

  if (nadaQueDevolver) {
    return (
      <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-6 text-center text-sm text-(--color-tinta-suave)">
        De esta venta ya se devolvió todo.
      </p>
    );
  }

  return (
    <form
      action={accion}
      aria-label="Registrar una devolución"
      className="space-y-4 rounded-(--radius-caja) border-2 border-(--color-borde) bg-(--color-panel) p-4"
    >
      <input type="hidden" name="ventaId" value={venta.ventaId} />

      <div>
        <p className="text-sm text-(--color-tinta-suave)">
          Venta <strong className="text-(--color-tinta)">{venta.numero}</strong> ·{' '}
          {formatearFechaHora(venta.fecha)}
          {venta.cliente ? ` · ${venta.cliente}` : ''}
        </p>
        {venta.yaDevueltoCentavos > 0 ? (
          <p className="mt-1 text-sm text-(--color-alerta)">
            De esta venta ya se devolvieron {formatearARS(venta.yaDevueltoCentavos)}.
          </p>
        ) : null}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Qué se devuelve</legend>
        <ul className="flex flex-col gap-2">
          {venta.lineas.map((l) => (
            <li
              key={l.saleItemId}
              className={`rounded-(--radius-caja) bg-(--color-papel) p-3 ${
                l.cantidadDisponible === 0 ? 'opacity-50' : ''
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{l.descripcion}</span>
                <span className="tabular text-xs text-(--color-tinta-suave)">
                  {formatearARS(l.precioUnitarioCentavos)} c/u
                </span>
                <span className="tabular ml-auto text-sm text-(--color-tinta-suave)">
                  {l.cantidadDisponible} de {l.cantidadVendida}
                </span>
              </div>

              {l.cantidadDisponible > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label
                    htmlFor={`cantidad-${l.saleItemId}`}
                    className="text-sm text-(--color-tinta-suave)"
                  >
                    Cuántos vuelven
                  </label>
                  <input
                    id={`cantidad-${l.saleItemId}`}
                    name={`cantidad-${l.saleItemId}`}
                    type="number"
                    min={0}
                    max={l.cantidadDisponible}
                    step={1}
                    inputMode="numeric"
                    value={cantidades[l.saleItemId] ?? ''}
                    onChange={(e) =>
                      setCantidades((c) => ({ ...c, [l.saleItemId]: e.target.value }))
                    }
                    placeholder="0"
                    className="tabular min-h-11 w-20 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-right"
                  />

                  {/* Un cargador fallado no se vuelve a vender. */}
                  {l.gestionaStock ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name={`stock-${l.saleItemId}`}
                        checked={alStock[l.saleItemId] ?? true}
                        onChange={(e) =>
                          setAlStock((s) => ({ ...s, [l.saleItemId]: e.target.checked }))
                        }
                        className="size-5"
                      />
                      Vuelve al stock
                    </label>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1 text-xs text-(--color-tinta-suave)">Ya se devolvió entero.</p>
              )}
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="flex items-baseline justify-between rounded-(--radius-caja) bg-(--color-papel) p-3">
        <span className="text-sm font-medium">Lo que se devuelve vale</span>
        <span className="tabular text-xl font-bold">{formatearARS(total)}</span>
      </div>

      {/* Si el cliente todavía debe de esta venta, lo primero es bajarle la deuda. */}
      {venta.deudaDelClienteCentavos > 0 && total > 0 ? (
        <div className="rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-3 text-sm">
          <p>
            {venta.cliente ?? 'El cliente'} debe{' '}
            <strong className="tabular">{formatearARS(venta.deudaDelClienteCentavos)}</strong>. Se
            le descuenta de la deuda antes de devolverle plata.
          </p>
          <label htmlFor="descontarDeDeuda" className="mt-2 mb-1 block font-medium">
            Cuánto se le descuenta
          </label>
          <input
            id="descontarDeDeuda"
            name="descontarDeDeuda"
            type="text"
            inputMode="decimal"
            value={aDeuda}
            onChange={(e) => setADeuda(e.target.value)}
            placeholder={String(tope / 100)}
            className="tabular min-h-10 w-40 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2 text-right text-(--color-tinta)"
          />
          <p className="mt-1 text-xs">
            Vacío descuenta todo lo que se pueda ({formatearARS(tope)}).
          </p>
        </div>
      ) : null}

      {enPlata > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="medio" className="mb-1 block text-sm font-medium">
              Se le devuelven {formatearARS(enPlata)} por
            </label>
            <select
              id="medio"
              name="medio"
              defaultValue="efectivo"
              className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2"
            >
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="mercadopago">Mercado Pago</option>
            </select>
          </div>
          <div>
            <label htmlFor="monetaryAccountId" className="mb-1 block text-sm font-medium">
              De qué cuenta sale
            </label>
            <select
              id="monetaryAccountId"
              name="monetaryAccountId"
              defaultValue={cuentas.find((c) => c.tipo === 'efectivo')?.id ?? cuentas[0]?.id}
              className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2"
            >
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <div>
        <label htmlFor="motivo" className="mb-1 block text-sm font-medium">
          Por qué se devuelve
        </label>
        <input
          id="motivo"
          name="motivo"
          type="text"
          required
          minLength={3}
          maxLength={300}
          placeholder="Ej.: el cargador no andaba"
          className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3"
        />
      </div>

      {estado.error ? (
        <p role="alert" className="text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pendiente || total === 0}
        className="min-h-12 w-full rounded-(--radius-caja) bg-(--color-marca) font-semibold text-white disabled:opacity-60"
      >
        {pendiente ? 'Registrando…' : 'Registrar la devolución'}
      </button>

      <p className="text-xs text-(--color-tinta-suave)">
        La venta original no se toca: queda como está y el arqueo de aquel turno no cambia. Esto
        sale del cajón de hoy, que es cuando la plata se mueve de verdad.
      </p>
    </form>
  );
}
