'use client';

import { useMemo, useState } from 'react';
import { useActionState } from 'react';
import { cerrarCajaAccion, type EstadoCaja } from '@/app/acciones-caja';
import { aCentavos, formatearARS } from '@/lib/dinero';
import { DENOMINACIONES, totalDelConteo } from '@/caja/arqueo';

const INICIAL: EstadoCaja = {};

/**
 * Cerrar el turno.
 *
 * El cajon se cuenta por denominacion, que es el gesto que ya se hace: se
 * apilan los billetes por valor y se cuentan las pilas. El sistema suma. Antes
 * habia un solo casillero para escribir el total, y escribir un numero redondo
 * es exactamente lo que se hace cuando no se cuenta — la auditoria encontro que
 * en el POS viejo el efectivo contado figuraba siempre en cero.
 *
 * Escribir el total directo sigue estando, abajo y sin friccion: un arqueo que
 * traba el cierre a las nueve de la noche es un arqueo que se saltea.
 */
export default function FormularioCierre({
  esperadoCentavos,
  terminal,
}: {
  esperadoCentavos: number;
  terminal: string;
}) {
  const [estado, accion, pendiente] = useActionState(cerrarCajaAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);
  const [contando, setContando] = useState(true);
  const [billetes, setBilletes] = useState<Record<number, string>>({});
  const [suelto, setSuelto] = useState('');
  const [aMano, setAMano] = useState('');

  const contadoCentavos = useMemo(() => {
    if (!contando) return leerMonto(aMano);

    const conteo: Record<number, number> = {};
    for (const d of DENOMINACIONES) {
      const n = Number(billetes[d.valorCentavos] ?? '');
      if (Number.isInteger(n) && n > 0) conteo[d.valorCentavos] = n;
    }

    try {
      return totalDelConteo(conteo, leerMonto(suelto) ?? 0);
    } catch {
      return null;
    }
  }, [contando, billetes, suelto, aMano]);

  const diferencia = contadoCentavos === null ? null : contadoCentavos - esperadoCentavos;
  const hayAlgoContado =
    contadoCentavos !== null && (contadoCentavos > 0 || aMano.trim() !== '' || !contando);

  // No hay estado de exito: al cerrar, la accion redirige al reporte del turno.
  // Un cartel aca no se veria nunca, porque sin turno abierto este formulario
  // se desmonta entero con la revalidacion.

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
      aria-label="Cerrar el turno"
      className="space-y-4 rounded-(--radius-caja) border-2 border-(--color-marca) bg-(--color-panel) p-4"
    >
      <div>
        <h2 className="font-semibold">Cerrar el turno de {terminal}</h2>
        <p className="text-sm text-(--color-tinta-suave)">
          El sistema espera{' '}
          <strong className="tabular">{formatearARS(esperadoCentavos)}</strong> en el cajón.
        </p>
      </div>

      {contando ? (
        <fieldset className="rounded-(--radius-caja) bg-(--color-papel) p-3">
          <legend className="px-1 text-sm font-medium">Contá los billetes</legend>

          <div className="grid gap-2 sm:grid-cols-2">
            {DENOMINACIONES.map((d) => {
              const cantidad = Number(billetes[d.valorCentavos] ?? '');
              const subtotal =
                Number.isInteger(cantidad) && cantidad > 0 ? cantidad * d.valorCentavos : 0;

              return (
                <div key={d.valorCentavos} className="flex items-center gap-2">
                  <label
                    htmlFor={`billete-${d.valorCentavos}`}
                    className="tabular w-20 shrink-0 text-sm font-medium"
                  >
                    {d.etiqueta}
                  </label>
                  <input
                    id={`billete-${d.valorCentavos}`}
                    name={String(d.valorCentavos)}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={billetes[d.valorCentavos] ?? ''}
                    onChange={(e) =>
                      setBilletes((b) => ({ ...b, [d.valorCentavos]: e.target.value }))
                    }
                    placeholder="0"
                    className="tabular min-h-11 w-20 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-right"
                  />
                  <span className="tabular flex-1 text-right text-sm text-(--color-tinta-suave)">
                    {subtotal > 0 ? formatearARS(subtotal) : ''}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2 border-t border-(--color-borde) pt-3">
            <label htmlFor="suelto" className="w-20 shrink-0 text-sm font-medium">
              Monedas
            </label>
            <input
              id="suelto"
              name="suelto"
              type="text"
              inputMode="decimal"
              value={suelto}
              onChange={(e) => setSuelto(e.target.value)}
              placeholder="0"
              className="tabular min-h-11 w-32 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-right"
            />
            <span className="flex-1 text-right text-xs text-(--color-tinta-suave)">
              y billetes viejos
            </span>
          </div>
        </fieldset>
      ) : (
        <div>
          <label htmlFor="saldoContado" className="mb-1 block text-sm font-medium">
            Efectivo contado
          </label>
          <input
            id="saldoContado"
            name="saldoContado"
            type="text"
            inputMode="decimal"
            value={aMano}
            onChange={(e) => setAMano(e.target.value)}
            placeholder="0"
            autoFocus
            className="tabular min-h-12 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 text-right text-xl"
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => setContando((v) => !v)}
        className="text-xs underline underline-offset-2"
      >
        {contando ? 'Prefiero escribir el total' : 'Prefiero contar los billetes'}
      </button>

      <div className="flex items-baseline justify-between rounded-(--radius-caja) bg-(--color-papel) p-3">
        <span className="text-sm font-medium">Contado</span>
        <span className="tabular text-xl font-bold">
          {contadoCentavos === null ? '—' : formatearARS(contadoCentavos)}
        </span>
      </div>

      {diferencia !== null && hayAlgoContado && diferencia !== 0 ? (
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

      {diferencia === 0 && hayAlgoContado ? (
        <p className="rounded-(--radius-caja) bg-(--color-ok)/10 p-3 text-sm font-semibold text-(--color-ok)">
          Cuadra exacto.
        </p>
      ) : null}

      <div>
        <label htmlFor="nota" className="mb-1 block text-sm font-medium">
          Nota del turno (opcional)
        </label>
        <input
          id="nota"
          name="nota"
          type="text"
          maxLength={300}
          placeholder="Ej.: se cortó la luz de 4 a 6"
          className="min-h-10 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2"
        />
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

/** Lo que escribió una persona, en centavos. `null` si todavía no es un número. */
function leerMonto(texto: string): number | null {
  if (texto.trim() === '') return 0;
  try {
    return aCentavos(texto);
  } catch {
    return null;
  }
}
