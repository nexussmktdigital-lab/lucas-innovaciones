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
  /**
   * De dónde salió la sospecha. No es decorativo: decide quién puede seguir.
   *
   *  - `catalogo`: la ficha está mal cargada. Nadie eligió ese precio —es el
   *    caso de los 9 iPhones de agosto, la cifra en dólares leída como pesos—
   *    y lo que corresponde no es cobrar igual sino arreglar la ficha. Sigue
   *    siendo del dueño.
   *  - `escrito`: alguien escribió ese precio a propósito, en el mostrador. Es
   *    una decisión de venta, y la toma quien está atendiendo.
   *
   * Los dos vivían bajo el mismo `motivo` de texto libre, y por eso abrirle uno
   * al vendedor abría el otro sin que nadie lo decidiera.
   */
  tipo: 'catalogo' | 'escrito';
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

/**
 * Marcas cuyos equipos nunca son baratos, aunque la categoría no lo diga.
 *
 * Sirve para un equipo mal categorizado. No alcanza por sí sola: Apple también
 * vende cables y cargadores, y por eso las categorías de accesorio de abajo
 * ganan siempre.
 */
export const PISO_POR_MARCA: { marca: string; pisoCentavos: number }[] = [
  { marca: 'apple', pisoCentavos: 20_000_00 },
];

/**
 * Categorías donde ningún precio es sospechoso, pase lo que pase.
 *
 * Es la mayoría del catálogo: cables, fundas, vidrios, cargadores. Un cable
 * Lightning de Apple a $13.000 es un precio perfectamente normal, y marcarlo
 * como sospechoso solo entrena al cajero a ignorar el cartel.
 */
export const CATEGORIAS_SIN_PISO = [
  'cable',
  'cargador',
  'funda',
  'vidrio',
  'hidrogel',
  'auricular',
  'pendrive',
  'memoria',
  'almacenamiento',
  'periferico',
  'accesorio',
  'soporte',
  'adaptador',
  'servicio',
  'telefonia',
  'cocina',
  'mate',
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

  // Un accesorio no tiene piso ni siquiera si la marca es cara.
  if (CATEGORIAS_SIN_PISO.some((patron) => categoria.includes(patron))) return null;

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
  /*
   * Cero no es un precio, tenga piso el producto o no.
   *
   * Las categorías sin piso —cables, fundas, vidrios, cargadores— son la mayor
   * parte de las unidades que se venden, y para ellas no había ningún control:
   * un producto que llegó de la tienda sin precio, o con el precio en cero por
   * un error de carga, salía del mostrador **gratis** y con el stock
   * descontado. En un renglón suelto se nota; en una venta de seis accesorios,
   * no. El dueño puede confirmarlo igual si de verdad va a regalar algo, que es
   * lo mismo que hace con cualquier otro precio raro.
   */
  if (precioCentavos <= 0) {
    return {
      descripcion: p.nombre,
      precioCentavos,
      pisoCentavos: 1,
      tipo: 'catalogo',
      motivo:
        'Está cargado sin precio y se cobraría $0. Revisá la ficha antes de vender: ' +
        'el stock se descuenta igual.',
    };
  }

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
    tipo: 'catalogo',
    motivo,
  };
}

/**
 * Cuánto puede bajar un precio escrito a mano respecto del de referencia.
 *
 * Los servicios técnicos y los chips se cobran escribiendo el precio en el
 * momento: cada reparación es distinta. Pero el precio del catálogo sirve de
 * referencia, y un servicio de $7.050 cobrado a $1 no es un presupuesto, es un
 * error de tipeo o algo peor.
 */
export const PISO_DEL_PRECIO_ESCRITO = 0.5;

/**
 * Revisa un precio escrito a mano contra el de referencia del catálogo.
 *
 * Devuelve null si el producto no tiene precio de referencia: «Reparación (a
 * presupuestar)» vale lo que diga el técnico y no hay contra qué compararlo.
 */
export function revisarPrecioEscrito(
  descripcion: string,
  precioEscritoCentavos: number,
  precioReferenciaCentavos: number,
): Sospecha | null {
  if (precioReferenciaCentavos <= 0) return null;

  const piso = Math.round(precioReferenciaCentavos * PISO_DEL_PRECIO_ESCRITO);
  if (precioEscritoCentavos >= piso) return null;

  return {
    descripcion,
    precioCentavos: precioEscritoCentavos,
    pisoCentavos: piso,
    tipo: 'escrito',
    motivo:
      `En el catálogo figura a $${(precioReferenciaCentavos / 100).toLocaleString('es-AR')}. ` +
      'Si es un precio acordado está bien: confirmalo y la venta sigue.',
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
