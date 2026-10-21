/**
 * Un recargo: lo que se cobra de más, escrito como porcentaje o como monto.
 *
 * El local cobra recargos en tres momentos —pagar con cheque, fiar «cuando
 * pueda», pagar una cuota tarde— y en los tres la cuenta es la misma y el
 * problema también: quien atiende tiene en la cabeza «le cobro un cinco por
 * ciento» o «le cobro dos mil», según el caso y el cliente, y hasta ahora
 * tenía que hacer la cuenta a mano y subir el precio sin que quedara dicho en
 * ningún lado que ese número no era el precio del producto.
 *
 * **Lo que se guarda es el monto, nunca el porcentaje.** El porcentaje es una
 * forma de escribirlo; el monto es el hecho. Guardar el porcentaje obligaría a
 * recalcular para leer un papel viejo, y el día que cambie el redondeo los
 * comprobantes firmados dejarían de coincidir con lo que el sistema dice.
 */

export class ErrorRecargo extends Error {}

/** Cómo lo escribió quien atiende. */
export type FormaDeRecargo = 'porcentaje' | 'monto';

/**
 * Tope del porcentaje.
 *
 * No es una regla del negocio: es una guarda contra el cero de más. Un 500%
 * sobre un iPhone no es un recargo, es un error de tipeo que nadie revisa
 * hasta que el cliente mira el papel.
 */
export const PORCENTAJE_MAXIMO = 100;

export interface RecargoEscrito {
  forma: FormaDeRecargo;
  /**
   * El número tal como se escribió: `5` si es 5%, `2000` si son $2.000.
   *
   * En pesos (o dólares) enteros y centavos, no en centavos: es lo que se
   * tipea en el campo.
   */
  valor: number;
}

/**
 * Cuánto es ese recargo sobre una base, en centavos.
 *
 * La base va en centavos y en la misma moneda en la que va a quedar el
 * recargo: acá no se convierte nada. Un porcentaje se redondea al centavo más
 * cercano —ni para arriba ni para abajo, que sobre doscientos pagos al año se
 * nota—, y un monto escrito a mano se toma tal cual.
 */
export function calcularRecargo(baseCentavos: number, escrito: RecargoEscrito | null): number {
  if (!escrito) return 0;

  const { forma, valor } = escrito;
  if (!Number.isFinite(valor) || valor <= 0) return 0;

  if (forma === 'monto') {
    const centavos = Math.round(valor * 100);
    if (!Number.isSafeInteger(centavos)) {
      throw new ErrorRecargo('Ese recargo no es un número válido.');
    }
    return Math.max(0, centavos);
  }

  if (valor > PORCENTAJE_MAXIMO) {
    throw new ErrorRecargo(
      `Un recargo de ${valor}% no puede ser lo que se quiso escribir. El máximo es ${PORCENTAJE_MAXIMO}%.`,
    );
  }
  if (baseCentavos <= 0) return 0;

  return Math.round((baseCentavos * valor) / 100);
}

/**
 * Cómo se dice un recargo en una línea, para la pantalla y para el papel.
 *
 * Sale el porcentaje cuando así se escribió, porque es lo que el cliente
 * escuchó: «te cobro un cinco por ciento» y después ve «$ 2.000» en el papel
 * sin saber de dónde salió.
 */
export function comoSeEscribe(
  escrito: RecargoEscrito | null,
  cifra: (centavos: number) => string,
  baseCentavos: number,
): string {
  const centavos = calcularRecargo(baseCentavos, escrito);
  if (centavos === 0) return '';
  return escrito?.forma === 'porcentaje'
    ? `${escrito.valor}% · ${cifra(centavos)}`
    : cifra(centavos);
}

/** Los motivos por los que se cobra un recargo al recibir un pago de fiado. */
export const MOTIVOS_DE_RECARGO = [
  { valor: 'cheque', etiqueta: 'Por pagar con cheque' },
  { valor: 'demora', etiqueta: 'Por la demora' },
  { valor: 'otro', etiqueta: 'Otro motivo' },
] as const;

export type MotivoDeRecargo = (typeof MOTIVOS_DE_RECARGO)[number]['valor'];

export function esMotivoDeRecargo(crudo: unknown): crudo is MotivoDeRecargo {
  return MOTIVOS_DE_RECARGO.some((m) => m.valor === crudo);
}
