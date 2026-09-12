'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { cobrarFiadoAccion, type EstadoFiado } from '@/app/acciones-fiado';
import { formatearARS } from '@/lib/dinero';
import { formatearFecha } from '@/lib/fecha';
import type { DeudorEnLista } from '@/fiado/cuenta';

const INICIAL: EstadoFiado = {};

const MEDIOS = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'mercadopago', etiqueta: 'Mercado Pago' },
  { valor: 'debito', etiqueta: 'Débito' },
  { valor: 'credito', etiqueta: 'Crédito' },
] as const;

/** Clave de idempotencia: una por formulario abierto. Reintentar no cobra dos veces. */
function nuevaClave(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random()}`;
}

export default function FilaDeudor({
  deudor,
  hayCaja,
  esDuenio,
}: {
  deudor: DeudorEnLista;
  hayCaja: boolean;
  esDuenio: boolean;
}) {
  const [estado, accion, pendiente] = useActionState(cobrarFiadoAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);
  const [clave] = useState(nuevaClave);

  // Cobrado el pago, el formulario se cierra solo: dejarlo abierto con el monto
  // adentro invita a volver a apretar. La clave de idempotencia igual impide
  // que se cobre dos veces, pero el susto no hace falta.
  useEffect(() => {
    if (estado.ok) setAbierto(false);
  }, [estado.ok]);

  const pasadoDeLimite =
    deudor.limiteCentavos !== null && deudor.saldoCentavos >= deudor.limiteCentavos;

  return (
    <li className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Link
          href={`/clientes/${deudor.customerId}`}
          className="font-medium underline underline-offset-2"
        >
          {deudor.nombre}
        </Link>
        {deudor.telefono ? (
          <span className="text-xs text-(--color-tinta-suave)">{deudor.telefono}</span>
        ) : null}
        {deudor.origen === 'migrado_papel' ? (
          <span className="rounded bg-(--color-papel) px-1.5 py-0.5 text-xs font-semibold text-(--color-tinta-suave)">
            De la libreta
          </span>
        ) : null}
        {pasadoDeLimite ? (
          <span className="rounded bg-(--color-alerta)/15 px-1.5 py-0.5 text-xs font-semibold text-(--color-alerta)">
            En el límite
          </span>
        ) : null}

        <span className="tabular ml-auto text-xl font-bold">
          {formatearARS(deudor.saldoCentavos)}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-(--color-tinta-suave)">
        {deudor.ultimoMovimiento ? (
          <span>Última actividad: {formatearFecha(deudor.ultimoMovimiento)}</span>
        ) : null}
        {deudor.limiteCentavos !== null ? (
          <span>Tope: {formatearARS(deudor.limiteCentavos)}</span>
        ) : esDuenio ? (
          <span>Sin tope</span>
        ) : null}
      </div>

      {estado.ok ? (
        <p role="status" className="mt-2 text-sm font-medium text-(--color-ok)">
          {estado.ok}
        </p>
      ) : null}

      {!abierto ? (
        <button
          type="button"
          disabled={!hayCaja}
          onClick={() => setAbierto(true)}
          title={hayCaja ? undefined : 'Abrí la caja para poder recibir el pago'}
          className="mt-2 min-h-10 rounded-(--radius-caja) bg-(--color-marca) px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Recibir un pago
        </button>
      ) : (
        <form action={accion} className="mt-2 space-y-2 rounded-(--radius-caja) bg-(--color-papel) p-3">
          <input type="hidden" name="clienteId" value={deudor.customerId} />
          <input type="hidden" name="clave" value={clave} />

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label
                htmlFor={`monto-${deudor.customerId}`}
                className="mb-1 block text-xs font-medium"
              >
                ¿Cuánto paga?
              </label>
              <input
                id={`monto-${deudor.customerId}`}
                name="monto"
                type="text"
                inputMode="decimal"
                required
                autoFocus
                defaultValue={String(deudor.saldoCentavos / 100)}
                className="tabular min-h-11 w-36 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-right text-lg"
              />
            </div>

            <div>
              <label
                htmlFor={`medio-${deudor.customerId}`}
                className="mb-1 block text-xs font-medium"
              >
                Con qué
              </label>
              <select
                id={`medio-${deudor.customerId}`}
                name="medio"
                defaultValue="efectivo"
                className="min-h-11 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
              >
                {MEDIOS.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.etiqueta}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-40 flex-1">
              <label
                htmlFor={`nota-${deudor.customerId}`}
                className="mb-1 block text-xs font-medium"
              >
                Nota (opcional)
              </label>
              <input
                id={`nota-${deudor.customerId}`}
                name="nota"
                type="text"
                maxLength={200}
                placeholder="Ej.: a cuenta del celular"
                className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
              />
            </div>
          </div>

          {estado.error ? (
            <p role="alert" className="text-sm font-medium text-(--color-error)">
              {estado.error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="min-h-10 flex-1 rounded-(--radius-caja) border border-(--color-borde) text-sm font-medium"
            >
              Volver
            </button>
            <button
              type="submit"
              disabled={pendiente}
              className="min-h-10 flex-1 rounded-(--radius-caja) bg-(--color-ok) text-sm font-semibold text-white disabled:opacity-60"
            >
              {pendiente ? 'Registrando…' : 'Registrar el pago'}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
