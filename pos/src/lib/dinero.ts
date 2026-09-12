/**
 * Aritmetica de dinero.
 *
 * Todo monto vive en centavos como entero. Ninguna funcion de este archivo
 * devuelve un float: `number` se usa como entero seguro (hasta 2^53, o sea
 * ~90 billones de pesos, de sobra).
 */

export const CENTAVOS_POR_PESO = 100;

/** Un peso, en centavos. Sirve para leer el codigo sin contar ceros. */
export const PESO = 100;

/** Redondeo de gondola: al millar de pesos. Coincide con `LI_Cotizacion::redondear`. */
const CENTAVOS_POR_MILLAR = 1000 * CENTAVOS_POR_PESO;

export class ErrorDinero extends Error {}

function exigirEntero(valor: number, campo: string): number {
  if (!Number.isFinite(valor) || !Number.isSafeInteger(valor)) {
    throw new ErrorDinero(`${campo} tiene que ser un entero de centavos, llego: ${valor}`);
  }
  return valor;
}

/**
 * Convierte pesos escritos por una persona ("1.234,56" o 1234.56) a centavos.
 *
 * En Argentina el punto separa los miles, asi que "20.000" son veinte mil. Pero
 * el teclado numerico tiene punto y no coma, y un cajero apurado escribe
 * "1500.50" queriendo decir mil quinientos con cincuenta. Tomar ese punto como
 * separador de miles daba $150.050: cien veces de mas.
 *
 * La regla que desambigua: si hay coma, manda la coma y los puntos son miles.
 * Si no hay coma y lo que sigue al ultimo punto no son exactamente tres
 * digitos, ese punto es decimal —"1.500" son mil quinientos, "1500.50" son mil
 * quinientos con cincuenta.
 */
export function aCentavos(pesos: number | string): number {
  if (typeof pesos === 'number') {
    if (!Number.isFinite(pesos)) throw new ErrorDinero(`Monto invalido: ${pesos}`);
    return Math.round(pesos * CENTAVOS_POR_PESO);
  }

  const crudo = pesos.trim().replace(/\s/g, '');
  let limpio: string;

  if (crudo.includes(',')) {
    limpio = crudo.replace(/\./g, '').replace(',', '.');
  } else {
    const ultimoPunto = crudo.lastIndexOf('.');
    const decimalesTraselPunto = ultimoPunto === -1 ? -1 : crudo.length - ultimoPunto - 1;
    const esDecimal = decimalesTraselPunto === 1 || decimalesTraselPunto === 2;

    limpio = esDecimal
      ? `${crudo.slice(0, ultimoPunto).replace(/\./g, '')}.${crudo.slice(ultimoPunto + 1)}`
      : crudo.replace(/\./g, '');
  }

  // Un separador colgando al final es alguien a medio escribir: «12,» es 12.
  if (limpio.endsWith('.')) limpio = limpio.slice(0, -1);

  if (limpio === '' || !/^-?\d+(\.\d+)?$/.test(limpio)) {
    throw new ErrorDinero(`Monto invalido: "${pesos}"`);
  }
  return Math.round(Number(limpio) * CENTAVOS_POR_PESO);
}

/** Centavos a pesos como number. Solo para mostrar, nunca para calcular. */
export function aPesos(centavos: number): number {
  return exigirEntero(centavos, 'centavos') / CENTAVOS_POR_PESO;
}

const FORMATO_ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
});

const FORMATO_USD = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

export function formatearARS(centavos: number): string {
  return FORMATO_ARS.format(aPesos(centavos));
}

export function formatearUSD(centavos: number): string {
  return FORMATO_USD.format(aPesos(centavos));
}

/**
 * Convierte un precio en USD a pesos con el tipo de cambio dado y redondea al
 * millar, igual que el plugin `lucas-cotizacion` (D22). Sin margen.
 *
 * @param usdCentavos  Precio en centavos de dolar. USD 1.370 -> 137000.
 * @param tcCentavos   Centavos de ARS por dolar. TC 1.571,00 -> 157100.
 * @returns            Centavos de ARS, redondeados al millar de pesos.
 */
export function usdAPesos(usdCentavos: number, tcCentavos: number): number {
  exigirEntero(usdCentavos, 'usdCentavos');
  exigirEntero(tcCentavos, 'tcCentavos');
  if (usdCentavos <= 0 || tcCentavos <= 0) return 0;

  // (centavos USD / 100) * (centavos ARS por USD) = centavos ARS
  const brutoCentavos = (usdCentavos * tcCentavos) / CENTAVOS_POR_PESO;
  return Math.round(brutoCentavos / CENTAVOS_POR_MILLAR) * CENTAVOS_POR_MILLAR;
}

/**
 * Reparte un monto entre N partes sin perder ni inventar centavos.
 * Se usa para armar las cuotas de un plan de fiado: la ultima absorbe el resto.
 */
export function repartir(totalCentavos: number, partes: number): number[] {
  exigirEntero(totalCentavos, 'totalCentavos');
  if (!Number.isInteger(partes) || partes <= 0) {
    throw new ErrorDinero(`Cantidad de partes invalida: ${partes}`);
  }
  const base = Math.floor(totalCentavos / partes);
  const resto = totalCentavos - base * partes;
  return Array.from({ length: partes }, (_, i) => (i < resto ? base + 1 : base));
}

/**
 * Aplica un descuento porcentual sobre un monto en centavos.
 * @param porcentaje Entero o decimal, 0 a 100.
 */
export function descuentoPorcentual(centavos: number, porcentaje: number): number {
  exigirEntero(centavos, 'centavos');
  if (porcentaje < 0 || porcentaje > 100) {
    throw new ErrorDinero(`Porcentaje fuera de rango: ${porcentaje}`);
  }
  return Math.round((centavos * porcentaje) / 100);
}

export function sumar(...montos: number[]): number {
  return montos.reduce((acc, m) => acc + exigirEntero(m, 'monto'), 0);
}
