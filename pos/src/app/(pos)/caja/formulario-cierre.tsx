'use client';

import { useActionState, useState } from 'react';
import { cerrarCajaAccion, type EstadoCaja } from '@/app/acciones-caja';
import { aCentavos, formatearARS } from '@/lib/dinero';

const INICIAL: EstadoCaja = {};

export default function FormularioCierre({ esperadoCentavos }: { esperadoCentavos: number }) {
  const [estado, accion, pendiente] = useActionState(cerrarCajaAccion, INICIAL);
  const [contado, setContado] = useState('');
  const [abierto, setAbierto] = useState(false);

  let diferencia: number | null = null;
  if (contado.trim() !== '') {
    try {
      diferencia = aCentavos(contado) - esperadoCentavos;
    } catch {
      diferencia = null;
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="min-h-12 w-full rounded-(--radius-caja) border-2 border-(--color-borde) font-semibold"
      >
        Cerrar el turno
      </button>
    );
  }

  return (
    <form
      action={accion}
      className="space-y-4 rounded-(--radius-caja) border-2 border-(--color-marca) bg-(--color-panel) p-4"
    >
      <div>
        <h2 className="font-semibold">Cerrar el turno</h2>
        <p className="text-sm text-(--color-tinta-suave)">
          Contá el efectivo que hay en el cajón y escribilo. El sistema espera{' '}
          <strong className="tabular">{formatearARS(esperadoCentavos)}</strong>.
        </p>
      </div>

      <div>
        <label htmlFor="saldoContado" className="mb-1 block text-sm font-medium">
          Efectivo contado
        </label>
        <input
          id="saldoContado"
          name="saldoContado"
          type="text"
          inputMode="decimal"
          value={contado}
          onChange={(e) => setContado(e.target.value)}
          placeholder="0"
          autoFocus
          className="tabular min-h-12 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 text-right text-xl"
        />
      </div>

      {diferencia !== null && diferencia !== 0 ? (
        <div
          className={`rounded-(--radius-caja) p-3 text-sm ${
            diferencia > 0
              ? 'bg-(--color-alerta)/10 text-(--color-alerta)'
              : 'bg-(--color-error)/10 text-(--color-error)'
          }`}
        >
          <p className="font-semibold">
            {diferencia > 0 ? 'Sobra' : 'Falta'}{' '}
            <span className="tabular">{formatearARS(Math.abs(diferencia))}</span>
          </p>
          <label htmlFor="justificacion" className="mt-2 mb-1 block font-medium">
            ¿A qué se debe?
          </label>
          <input
            id="justificacion"
            name="justificacion"
            type="text"
            required
            placeholder="Ej.: vuelto mal dado en la venta T1-000042"
            className="min-h-10 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2 text-(--color-tinta)"
          />
        </div>
      ) : null}

      {diferencia === 0 ? (
        <p className="rounded-(--radius-caja) bg-(--color-ok)/10 p-3 text-sm font-semibold text-(--color-ok)">
          Cuadra exacto.
        </p>
      ) : null}

      {estado.error ? (
        <p role="alert" className="text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}
      {estado.ok ? (
        <p role="status" className="text-sm font-medium text-(--color-ok)">
          {estado.ok}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="min-h-12 flex-1 rounded-(--radius-caja) border border-(--color-borde) font-medium"
        >
          Volver
        </button>
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-12 flex-1 rounded-(--radius-caja) bg-(--color-marca) font-semibold text-white disabled:opacity-60"
        >
          {pendiente ? 'Cerrando…' : 'Cerrar caja'}
        </button>
      </div>
    </form>
  );
}
