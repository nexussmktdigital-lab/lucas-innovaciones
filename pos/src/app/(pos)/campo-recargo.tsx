'use client';

import { calcularRecargo, PORCENTAJE_MAXIMO, type RecargoEscrito } from '@/lib/recargo';

/**
 * El campo de un recargo: porcentaje o monto, a elección.
 *
 * El local cobra recargos en tres momentos —el cheque en una venta, el fiado
 * «cuando pueda», la cuota pagada tarde o con cheque— y en los tres quien
 * atiende tiene en la cabeza una de dos cosas: «le cobro un cinco por ciento»
 * o «le cobro dos mil». Hasta ahora había que hacer la cuenta a mano y subir
 * el precio, y entonces el papel decía que el producto valía otra cosa.
 *
 * Es el mismo control en los tres lugares a propósito: tres campos parecidos
 * que se calculan distinto es la forma de que un día uno de los tres quede
 * mal sin que nadie lo note.
 *
 * **Muestra la cuenta hecha.** El número que importa —cuánto es eso en plata,
 * y cuánto queda en total— se ve antes de confirmar, no después en el papel.
 */
export default function CampoRecargo({
  etiqueta,
  baseCentavos,
  valor,
  onCambiar,
  cifra,
  id,
  resumen,
  simbolo = '$',
}: {
  etiqueta: string;
  /** Sobre qué se calcula el porcentaje, en centavos de la misma moneda. */
  baseCentavos: number;
  valor: RecargoEscrito | null;
  onCambiar: (valor: RecargoEscrito | null) => void;
  cifra: (centavos: number) => string;
  id: string;
  /** Qué decir debajo, con el recargo ya calculado. */
  resumen?: (recargoCentavos: number) => string;
  /**
   * El signo del botón de monto fijo: `$` o `US$`.
   *
   * No es decorativo. Una deuda en dólares se recarga en dólares, y un botón
   * que dice `$` al lado de un campo donde se escribe «150» hace que quien
   * atiende crea que está cobrando ciento cincuenta pesos.
   */
  simbolo?: string;
}) {
  /*
   * Un porcentaje imposible no rompe la pantalla: muestra cero y el servidor
   * lo rechaza igual si alguien lo manda. Acá lo que importa es que quien
   * está escribiendo «50» camino a «5» no vea un error a mitad de tipeo.
   */
  let recargoCentavos = 0;
  try {
    recargoCentavos = calcularRecargo(baseCentavos, valor);
  } catch {
    recargoCentavos = 0;
  }

  const forma = valor?.forma ?? 'porcentaje';
  const excedido = forma === 'porcentaje' && (valor?.valor ?? 0) > PORCENTAJE_MAXIMO;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {etiqueta}
      </label>
      <div className="flex items-stretch gap-1">
        {/* Los dos botones, no un desplegable: es un toque y se ve cuál está
            puesto sin abrir nada. */}
        <div className="flex overflow-hidden rounded-(--radius-caja) border border-(--color-borde)">
          {(['porcentaje', 'monto'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={forma === f}
              aria-label={f === 'porcentaje' ? 'Recargo en porcentaje' : 'Recargo en monto fijo'}
              onClick={() => onCambiar(valor ? { ...valor, forma: f } : { forma: f, valor: 0 })}
              className={`min-h-11 min-w-10 px-1 text-sm font-bold ${
                forma === f
                  ? 'bg-(--color-marca) text-(--color-marca-texto)'
                  : 'bg-(--color-panel) text-(--color-tinta-suave)'
              }`}
            >
              {f === 'porcentaje' ? '%' : simbolo}
            </button>
          ))}
        </div>
        <input
          id={id}
          type="number"
          min={0}
          max={forma === 'porcentaje' ? PORCENTAJE_MAXIMO : undefined}
          step="any"
          inputMode="decimal"
          value={valor?.valor ? valor.valor : ''}
          onChange={(e) => {
            const n = Number(e.target.value);
            onCambiar(
              Number.isFinite(n) && n > 0 ? { forma, valor: n } : null,
            );
          }}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="0"
          className="tabular min-h-11 w-24 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-right"
        />
      </div>

      {excedido ? (
        <p className="mt-1 text-xs font-medium text-(--color-error)">
          Un {valor?.valor}% no puede ser: el máximo es {PORCENTAJE_MAXIMO}%. ¿Sobra un cero?
        </p>
      ) : recargoCentavos > 0 ? (
        <p className="mt-1 text-xs text-(--color-tinta-suave)">
          {resumen ? resumen(recargoCentavos) : `Son ${cifra(recargoCentavos)}.`}
        </p>
      ) : null}
    </div>
  );
}
