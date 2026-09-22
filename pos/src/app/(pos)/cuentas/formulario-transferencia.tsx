'use client';

import { useActionState, useEffect, useState } from 'react';
import { transferirAccion, type EstadoGastos } from '@/app/acciones-gastos';
import { formatearARS } from '@/lib/dinero';
import type { CuentaConSaldo } from '@/gastos/cuentas';

const INICIAL: EstadoGastos = {};

/**
 * Pasar plata de una cuenta a otra.
 *
 * Es lo que pasa cuando se deposita la recaudación: la plata no entra ni sale
 * del negocio, cambia de lugar. Por eso el total de abajo no se mueve y el
 * formulario lo dice.
 */
export default function FormularioTransferencia({ cuentas }: { cuentas: CuentaConSaldo[] }) {
  const [estado, accion, pendiente] = useActionState(transferirAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);
  const [origen, setOrigen] = useState(cuentas[0]?.id ?? '');

  useEffect(() => {
    if (estado.ok) setAbierto(false);
  }, [estado.ok]);

  if (cuentas.length < 2) return null;

  const cuentaOrigen = cuentas.find((c) => c.id === origen);
  const destinos = cuentas.filter((c) => c.id !== origen);

  if (!abierto) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="min-h-11 rounded-(--radius-caja) border border-(--color-borde) px-4 text-sm font-medium"
        >
          Pasar plata de una cuenta a otra
        </button>
        {estado.ok ? (
          <p role="status" className="text-sm font-medium text-(--color-ok)">
            {estado.ok}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={accion}
      aria-label="Pasar plata entre cuentas"
      className="space-y-3 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="origen" className="mb-1 block text-sm font-medium">
            De qué cuenta
          </label>
          <select
            id="origen"
            name="origen"
            value={origen}
            onChange={(e) => setOrigen(e.target.value)}
            className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2"
          >
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          {cuentaOrigen ? (
            <p className="mt-1 text-xs text-(--color-tinta-suave)">
              Tiene {formatearARS(cuentaOrigen.saldoCentavos)}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="destino" className="mb-1 block text-sm font-medium">
            A qué cuenta
          </label>
          <select
            id="destino"
            name="destino"
            className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2"
          >
            {destinos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="monto-transfe" className="mb-1 block text-sm font-medium">
            Cuánto
          </label>
          <input
            id="monto-transfe"
            name="monto"
            type="text"
            inputMode="decimal"
            required
            autoFocus
            placeholder="0"
            className="tabular min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 text-right text-lg"
          />
        </div>
      </div>

      <div>
        <label htmlFor="nota-transfe" className="mb-1 block text-sm font-medium">
          Nota (opcional)
        </label>
        <input
          id="nota-transfe"
          name="nota"
          type="text"
          maxLength={200}
          placeholder="Ej.: depósito de la recaudación del sábado"
          className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3"
        />
      </div>

      {estado.error ? (
        <p role="alert" className="text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}

      <p className="text-xs text-(--color-tinta-suave)">
        La plata no entra ni sale del negocio: cambia de lugar. El total de todas las cuentas queda
        igual. Si sale del cajón, el arqueo del turno la descuenta.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="min-h-11 flex-1 rounded-(--radius-caja) border border-(--color-borde) text-sm font-medium"
        >
          Volver
        </button>
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-11 flex-1 rounded-(--radius-caja) bg-(--color-marca) font-semibold text-(--color-marca-texto) disabled:opacity-60"
        >
          {pendiente ? 'Pasando…' : 'Pasar la plata'}
        </button>
      </div>
    </form>
  );
}
