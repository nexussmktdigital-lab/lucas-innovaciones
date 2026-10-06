'use client';

/**
 * Cómo se va a pagar lo que se fía.
 *
 * Sin esto, fiar era «debe $400.000» y nada más: ni el mostrador ni el cliente
 * sabían cuándo le tocaba pagar, así que el recordatorio de WhatsApp terminaba
 * siendo el mismo para el que paga puntual y para el que debe desde marzo.
 *
 * La opción que viene puesta es **sin fechas**, y es a propósito: el fiado de
 * $5.000 del vecino no necesita un plan, y obligar a llenar uno haría más lenta
 * la venta más común. El plan aparece cuando alguien lo elige.
 */
import { useMemo } from 'react';
import { formatearARS } from '@/lib/dinero';
import { fechaLocalISO } from '@/lib/fecha';
import {
  CUOTAS_MAXIMAS,
  cuotasDelPlan,
  DIAS_MAXIMOS,
  FRECUENCIAS,
  type Cadencia,
} from '@/fiado/plan';

export interface PlanElegido extends Cadencia {
  cuotas: number;
}

/** Cuotas que se ofrecen con un toque. Cualquier otra se escribe. */
const ATAJOS = [1, 2, 3, 6, 12];

export default function PlanDeCuotas({
  montoCentavos,
  plan,
  onCambiar,
}: {
  montoCentavos: number;
  plan: PlanElegido | null;
  onCambiar: (plan: PlanElegido | null) => void;
}) {
  const hoy = fechaLocalISO();

  const cuotas = useMemo(() => {
    if (!plan) return [];
    try {
      return cuotasDelPlan(montoCentavos, plan.cuotas, plan, hoy);
    } catch {
      return [];
    }
  }, [montoCentavos, plan, hoy]);

  const primera = cuotas[0];
  const ultima = cuotas[cuotas.length - 1];

  return (
    <div className="mt-3 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) p-3">
      <p className="text-sm font-semibold">¿Cómo lo va a pagar?</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Opcion
          activa={plan === null}
          onClick={() => onCambiar(null)}
          etiqueta="Cuando pueda"
          detalle="sin fechas"
        />
        {FRECUENCIAS.map((f) => (
          <Opcion
            key={f.valor}
            activa={plan?.frecuencia === f.valor}
            onClick={() =>
              onCambiar({ frecuencia: f.valor, dias: null, cuotas: plan?.cuotas ?? 3 })
            }
            etiqueta={f.etiqueta}
          />
        ))}
        {/* El pactado a mano. Los tres de arriba cubren casi todo, pero el
            mostrador acuerda «cada tres días» y «cada dos meses», y con tres
            opciones quien vende elegía la que menos mentía. */}
        <Opcion
          activa={plan?.frecuencia === 'dias'}
          onClick={() =>
            onCambiar({ frecuencia: 'dias', dias: plan?.dias ?? 3, cuotas: plan?.cuotas ?? 3 })
          }
          etiqueta="Cada N días"
        />
      </div>

      {plan?.frecuencia === 'dias' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor="cada-cuantos-dias" className="text-xs text-(--color-tinta-suave)">
            Cada cuántos días
          </label>
          <input
            id="cada-cuantos-dias"
            type="number"
            min={1}
            max={DIAS_MAXIMOS}
            inputMode="numeric"
            value={plan.dias ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value);
              onCambiar({ ...plan, dias: Number.isInteger(n) && n > 0 ? n : null });
            }}
            onFocus={(e) => e.currentTarget.select()}
            className="tabular min-h-10 w-20 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-center"
          />
          <span className="text-xs text-(--color-tinta-suave)">
            Ej.: 3 para cada tres días, 60 para cada dos meses.
          </span>
        </div>
      ) : null}

      {plan ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-(--color-tinta-suave)">En cuántas veces</span>
            {ATAJOS.map((n) => (
              <Opcion
                key={n}
                activa={plan.cuotas === n}
                onClick={() => onCambiar({ ...plan, cuotas: n })}
                etiqueta={String(n)}
              />
            ))}
            <label className="flex items-center gap-1 text-xs text-(--color-tinta-suave)">
              otra
              <input
                type="number"
                min={1}
                max={CUOTAS_MAXIMAS}
                value={plan.cuotas}
                onChange={(e) =>
                  onCambiar({
                    ...plan,
                    cuotas: Math.min(CUOTAS_MAXIMAS, Math.max(1, Number(e.target.value) || 1)),
                  })
                }
                aria-label="Cantidad de cuotas"
                className="tabular min-h-9 w-16 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-center"
              />
            </label>
          </div>

          {primera && ultima ? (
            <p className="mt-2 text-sm">
              <strong className="tabular">
                {plan.cuotas} {plan.cuotas === 1 ? 'pago' : 'cuotas'} de{' '}
                {formatearARS(primera.montoCentavos)}
              </strong>
              . {plan.cuotas === 1 ? 'Vence' : 'La primera vence'} el{' '}
              <strong>{comoSeLee(primera.vencimiento)}</strong>
              {plan.cuotas > 1 ? (
                <>
                  {' '}
                  y la última el <strong>{comoSeLee(ultima.vencimiento)}</strong>
                </>
              ) : null}
              .
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-xs text-(--color-tinta-suave)">
          Queda como saldo en su cuenta, sin fecha de cobro. Es el fiado de siempre.
        </p>
      )}
    </div>
  );
}

/** `2026-10-18` → `18/10`. El año solo si no es el que viene corriendo. */
function comoSeLee(iso: string): string {
  const [a, m, d] = iso.split('-');
  const esteAnio = fechaLocalISO().slice(0, 4);
  return a === esteAnio ? `${d}/${m}` : `${d}/${m}/${a}`;
}

function Opcion({
  activa,
  onClick,
  etiqueta,
  detalle,
}: {
  activa: boolean;
  onClick: () => void;
  etiqueta: string;
  detalle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`min-h-9 rounded-(--radius-caja) border px-2.5 text-sm font-medium ${
        activa
          ? 'border-(--color-marca) bg-(--color-marca) text-(--color-marca-texto)'
          : 'border-(--color-borde) bg-(--color-panel)'
      }`}
    >
      {etiqueta}
      {detalle ? (
        <span className={`ml-1 text-xs ${activa ? 'opacity-80' : 'text-(--color-tinta-suave)'}`}>
          {detalle}
        </span>
      ) : null}
    </button>
  );
}
