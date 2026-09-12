/**
 * Validacion de cordura de precios.
 *
 * En agosto se cargaron nueve iPhones a US$ 6.300 y se publicaron a $6.300:
 * ~$9,7 millones de diferencia en un mes. El precio en pesos de un producto en
 * dolares ya no se puede tipear —lo calcula el sistema— pero queda un agujero
 * que esa guarda no tapa: **un producto que deberia estar en dolares y quedo
 * cargado en pesos con el numero del dolar**. Para el sistema es un iPhone que
 * vale $6.300 y no tiene nada de raro.
 *
 * Esto lo detecta por lo unico que se puede mirar sin adivinar: un piso de
 * precio plausible por categoria. Un smartphone nuevo a $6.300 no existe.
 *
 * No bloquea de forma definitiva: avisa y pide que el dueno lo confirme, porque
 * un piso mal puesto que impide vender es peor que el error que evita.
 */
import { normalizar } from '@/lib/texto';

export interface ProductoAValidar {
  nombre: string;
  categoria: string | null;
  marca: string | null;
  moneda: 'ARS' | 'USD';
  precioUsdCentavos: number | null;
}

export interface Sospecha {
  descripcion: string;
  precioCentavos: number;
  pisoCentavos: number;
  motivo: string;
}

/**
 * Piso de precio plausible por categoría, en centavos.
 *
 * Salen del catálogo real: el más barato de «Smartphones nuevos» ronda los
 * $380.000, así que $50.000 es holgado y a la vez atrapa cualquier precio que
 * en realidad sea una cifra en dólares.
 */
export const PISOS_POR_CATEGORIA: { patron: string; pisoCentavos: number }[] = [
  { patron: 'smartphones', pisoCentavos: 50_000_00 },
  { patron: 'celulares', pisoCentavos: 50_000_00 },
  { patron: 'notebooks', pisoCentavos: 100_000_00 },
  { patron: 'tablets', pisoCentavos: 30_000_00 },
  { patron: 'smartwatch', pisoCentavos: 15_000_00 },
  { patron: 'consolas', pisoCentavos: 50_000_00 },
];

/** Marcas cuyos equipos nunca son baratos, aunque la categoría no lo diga. */
export const PISO_POR_MARCA: { marca: string; pisoCentavos: number }[] = [
  { marca: 'apple', pisoCentavos: 20_000_00 },
];

/**
 * Piso que le corresponde a un producto, o null si no hay ninguno definido.
 *
 * Un accesorio de $5.000 no tiene piso: la mayoría del catálogo son cables y
 * vidrios, y ponerles uno solo generaría ruido.
 */
export function pisoPara(p: ProductoAValidar): number | null {
  const categoria = normalizar(p.categoria ?? '');
  const marca = normalizar(p.marca ?? '');

  const porCategoria = PISOS_POR_CATEGORIA.find((x) => categoria.includes(x.patron));
  const porMarca = PISO_POR_MARCA.find((x) => marca === x.marca);

  // Si aplican los dos, manda el más alto: es el que mejor describe al producto.
  const pisos = [porCategoria?.pisoCentavos, porMarca?.pisoCentavos].filter(
    (x): x is number => x !== undefined,
  );

  return pisos.length > 0 ? Math.max(...pisos) : null;
}

/**
 * Revisa una línea y devuelve la sospecha si la hay.
 *
 * @param precioCentavos Precio unitario en pesos con el que se va a vender.
 */
export function revisarLinea(
  p: ProductoAValidar,
  precioCentavos: number,
): Sospecha | null {
  const piso = pisoPara(p);
  if (piso === null || precioCentavos >= piso) return null;

  // Un producto en dólares ya tiene el precio calculado por el sistema: si aun
  // así queda bajo, lo que está mal es el precio en dólares.
  const motivo =
    p.moneda === 'USD'
      ? `Está cargado a US$ ${((p.precioUsdCentavos ?? 0) / 100).toLocaleString('es-AR')}, ` +
        'que parece muy poco para este producto. Revisá la ficha en WooCommerce.'
      : 'Está cargado en pesos y el monto parece ser en realidad una cifra en dólares. ' +
        'Es el error que en agosto costó millones: revisá la ficha antes de vender.';

  return {
    descripcion: p.nombre,
    precioCentavos,
    pisoCentavos: piso,
    motivo,
  };
}

/** Revisa todas las líneas de una venta. */
export function revisarVenta(
  lineas: readonly { producto: ProductoAValidar; precioCentavos: number }[],
): Sospecha[] {
  return lineas
    .map((l) => revisarLinea(l.producto, l.precioCentavos))
    .filter((s): s is Sospecha => s !== null);
}

/** Texto para el cartel que ve el cajero. */
export function explicarSospechas(sospechas: readonly Sospecha[]): string {
  const cabeza =
    sospechas.length === 1
      ? 'Hay un producto con un precio sospechoso:'
      : `Hay ${sospechas.length} productos con precios sospechosos:`;

  const detalle = sospechas
    .map(
      (s) =>
        `«${s.descripcion}» a $${(s.precioCentavos / 100).toLocaleString('es-AR')} ` +
        `(se esperaba al menos $${(s.pisoCentavos / 100).toLocaleString('es-AR')}). ${s.motivo}`,
    )
    .join(' ');

  return `${cabeza} ${detalle}`;
}
