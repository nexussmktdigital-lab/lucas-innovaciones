'use client';

import { useActionState } from 'react';
import { abrirCajaAccion, type EstadoCaja } from '@/app/acciones-caja';

const INICIAL: EstadoCaja = {};

interface Cuenta {
  id: string;
  nombre: string;
  tipo: string;
}

export default function FormularioApertura({ cuentas }: { cuentas: Cuenta[] }) {
  const [estado, accion, pendiente] = useActionState(abrirCajaAccion, INICIAL);
  const efectivo = cuentas.filter((c) => c.tipo === 'efectivo');

  if (efectivo.length === 0) {
    return (
      <p className="rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-4 text-sm">
        No hay ninguna caja en efectivo cargada. Creala antes de abrir el turno.
      </p>
    );
  }

  return (
    <form
      action={accion}
      className="space-y-4 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4"
    >
      <div>
        <h2 className="font-semibold">Abrir el turno</h2>
        <p className="text-sm text-(--color-tinta-suave)">
          Contá el efectivo con el que arranca la caja. Ese número es contra el que se va a comparar
          el arqueo al cerrar.
        </p>
      </div>

      {efectivo.length > 1 ? (
        <div>
          <label htmlFor="cuenta" className="mb-1 block text-sm font-medium">
            Caja
          </label>
          <select
            id="cuenta"
            name="monetaryAccountId"
            required
            className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3"
          >
            {efectivo.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="monetaryAccountId" value={efectivo[0]!.id} />
      )}

      <div>
        <label htmlFor="saldoInicial" className="mb-1 block text-sm font-medium">
          Efectivo inicial
        </label>
        <input
          id="saldoInicial"
          name="saldoInicial"
          type="text"
          inputMode="decimal"
          placeholder="20000"
          autoFocus
          className="tabular min-h-12 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 text-right text-xl"
        />
        <p className="mt-1 text-xs text-(--color-tinta-suave)">
          En pesos. Si arrancás sin cambio, dejalo en cero.
        </p>
      </div>

      {estado.error ? (
        <p role="alert" className="text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pendiente}
        className="min-h-12 w-full rounded-(--radius-caja) bg-(--color-marca) font-semibold text-white disabled:opacity-60"
      >
        {pendiente ? 'Abriendo…' : 'Abrir caja'}
      </button>
    </form>
  );
}
