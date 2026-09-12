/**
 * Precio de mostrador y precio de la tienda.
 *
 * En la tienda online cobra Mercado Pago, y esa comision no la paga el
 * mostrador. Por eso el mismo producto vale distinto en cada lado: unos
 * auriculares de $50.000 en el local salen $56.000 en la web.
 *
 * Cual es el numero que se guarda y cual el que se calcula (D31): **WooCommerce
 * guarda el precio de la tienda**, que es el que la web cobra de verdad, y el
 * POS le descuenta el recargo para llegar al de mostrador. Asi cada sistema
 * muestra lo que cobra, no hay que tocar el plugin y no hay dos numeros que
 * mantener sincronizados por producto.
 *
 * Tres cosas que el calculo respeta:
 *
 *  - **Lo que no se publica no lleva recargo.** Servicios, chips y todo lo de
 *    «Solo mostrador» (D19) no se venden por la web: su precio de Woo ya es el
 *    de mostrador y se usa tal cual.
 *  - **Se puede escribir un precio de mostrador propio** cuando el porcentaje
 *    no aplica: una promo, un producto que hay que igualar a la competencia.
 *  - **Se redondea a los cien pesos.** Dividir da numeros como $11.607,14 y en
 *    el mostrador nadie cobra eso.
 */

/** El precio de mostrador se redondea a esto. Cien pesos. */
export const REDONDEO_CENTAVOS = 100_00;

/** Tope del recargo. Mas que esto es un error de tipeo, no una politica. */
export const RECARGO_MAXIMO_BP = 10_000; // 100%

/** Puntos basicos: 12% es 1200. Se guarda entero para no arrastrar decimales. */
export type Recargo = number;

export class ErrorPrecio extends Error {}

export interface ProductoConPrecios {
  /** Lo que cobra la tienda online. Es el precio que vive en WooCommerce. */
  precioCentavos: number;
  /** Precio de mostrador escrito a mano, si lo tiene. Pisa el calculo. */
  precioLocalCentavos: number | null;
  /** True si no se publica en la web: entonces su precio ya es el de mostrador. */
  soloMostrador: boolean;
}

export function validarRecargo(bp: number): number {
  if (!Number.isInteger(bp) || bp < 0 || bp > RECARGO_MAXIMO_BP) {
    throw new ErrorPrecio(
      `Recargo fuera de rango: ${bp / 100}%. Tiene que estar entre 0 y ${RECARGO_MAXIMO_BP / 100}%.`,
    );
  }
  return bp;
}

/**
 * Precio al que se cobra en el mostrador.
 *
 * @param recargoBp Recargo de la tienda en puntos basicos. 12% -> 1200.
 */
export function precioDeMostrador(p: ProductoConPrecios, recargoBp: Recargo): number {
  if (p.precioLocalCentavos !== null) return Math.max(0, Math.round(p.precioLocalCentavos));
  if (p.soloMostrador || recargoBp <= 0) return p.precioCentavos;

  const exacto = (p.precioCentavos * 10_000) / (10_000 + recargoBp);
  return Math.round(exacto / REDONDEO_CENTAVOS) * REDONDEO_CENTAVOS;
}

/**
 * El camino inverso: que precio poner en WooCommerce para cobrar `mostrador`
 * en el local. Sirve para mostrarselo al dueno cuando decide un precio.
 *
 * No es `mostrador x (1 + comision)`: si Mercado Pago se queda con un `c`, para
 * que te quede lo mismo hay que cobrar `mostrador / (1 - c)`. Con el recargo
 * expresado como lo que se le suma al precio, la cuenta es directa.
 */
export function precioDeTienda(mostradorCentavos: number, recargoBp: Recargo): number {
  if (recargoBp <= 0) return mostradorCentavos;
  const exacto = (mostradorCentavos * (10_000 + recargoBp)) / 10_000;
  return Math.round(exacto / REDONDEO_CENTAVOS) * REDONDEO_CENTAVOS;
}

/**
 * Recargo que hay que aplicar para que, despues de la comision, quede el precio
 * de mostrador entero.
 *
 * Es la cuenta que casi siempre se hace mal: con una comision del 6%, sumarle
 * 6% al precio no alcanza, porque el 6% se lo lleva del total cobrado. Hay que
 * dividir por (1 - comision).
 *
 * @param comisionBp Comision del medio de pago en puntos basicos. 6,29% -> 629.
 */
export function recargoParaCubrir(comisionBp: number): number {
  if (comisionBp <= 0) return 0;
  if (comisionBp >= 10_000) {
    throw new ErrorPrecio('Una comisión del 100% o más no se puede cubrir con ningún recargo.');
  }
  // 1 / (1 - c) - 1, en puntos basicos.
  return Math.round((comisionBp * 10_000) / (10_000 - comisionBp));
}

/** Para mostrar: 1200 -> "12%", 629 -> "6,29%". */
export function formatearRecargo(bp: Recargo): string {
  return `${(bp / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`;
}
