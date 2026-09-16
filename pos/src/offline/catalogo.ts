/**
 * El catálogo guardado en la tablet, para poder vender sin conexión (D56).
 *
 * Funciones puras: no tocan base, ni red, ni IndexedDB. Reciben la lista que se
 * guardó y devuelven lo mismo que devolvería el buscador del servidor.
 *
 * Que el orden coincida no es un detalle estético: el lector de código de
 * barras termina con Enter y agrega **el primero**. Si offline el primero fuera
 * otro, el mismo gesto vendería otro producto, y nadie lo notaría hasta el
 * arqueo. Por eso el criterio está acá, escrito una vez y probado contra el del
 * servidor: primero la coincidencia exacta de código o SKU, después las de
 * texto, y entre esas la del nombre más corto.
 */
import { normalizar } from '@/lib/texto';
import type { ResultadoBusqueda } from '@/ventas/buscar';

/**
 * Cuántos productos se guardan.
 *
 * El catálogo real son ~800 productos y ~600 variaciones. Guardarlo entero son
 * unos pocos cientos de kilobytes, así que no hace falta elegir cuáles: el
 * producto que falte es exactamente el que se iba a vender.
 */
export const TOPE_CATALOGO = 5_000;

/** Un producto tal como queda guardado en la tablet. */
export type ProductoEnCache = ResultadoBusqueda;

export interface Instantanea {
  /** Cuándo se bajó. Lo que decide si lo que hay sirve o está viejo. */
  bajadaEn: string;
  /** El valor del dólar en ese momento: sin él no se vende nada en USD. */
  tcCentavos: number | null;
  productos: ProductoEnCache[];
}

/**
 * Cuándo el catálogo guardado es demasiado viejo para confiar en él.
 *
 * Doce horas: la cotización del dólar se reescribe dos veces por día (D22), así
 * que más que eso significa vender en dólares a un precio de ayer.
 */
export const HORAS_PARA_AVISAR = 12;

export function horasDesde(bajadaEn: string, ahora: Date = new Date()): number {
  const ms = ahora.getTime() - new Date(bajadaEn).getTime();
  return Math.max(0, ms / 3_600_000);
}

export function estaVieja(instantanea: Instantanea, ahora: Date = new Date()): boolean {
  return horasDesde(instantanea.bajadaEn, ahora) >= HORAS_PARA_AVISAR;
}

/**
 * Todo lo que se puede tipear para encontrar un producto, ya normalizado.
 *
 * El SKU del padre va incluido aunque no se muestre: con conexión, el `LIKE`
 * del servidor corre contra el SKU del producto **y** el de la variación, así
 * que tipear el del padre encuentra la variación. Sin él acá, el mismo término
 * encontraría la funda con internet y no sin él.
 */
function camposBuscables(p: ProductoEnCache): string {
  return normalizar(
    [p.nombre, p.sku ?? '', p.skuProducto ?? '', p.marca ?? '', p.codigoBarras ?? ''].join(' '),
  );
}

function esExacto(p: ProductoEnCache, termino: string): boolean {
  return (
    (p.codigoBarras !== null && normalizar(p.codigoBarras) === termino) ||
    (p.sku !== null && normalizar(p.sku) === termino)
  );
}

/** Lo disponible de un renglón, con la misma regla que usa el servidor. */
export function disponibleDe(p: ProductoEnCache): number {
  return p.gestionaStock ? p.stock - p.stockComprometido : Number.POSITIVE_INFINITY;
}

/**
 * Busca en el catálogo guardado.
 *
 * El stock que muestra es el del momento en que se bajó la instantánea, no el
 * de ahora: sin conexión no hay forma de saber el de ahora. Por eso la pantalla
 * avisa que los números son de hace un rato en vez de fingir que son de hoy.
 */
export function buscarEnCache(
  productos: readonly ProductoEnCache[],
  termino: string,
  opciones: { limite?: number; incluirSinStock?: boolean } = {},
): ProductoEnCache[] {
  const limpio = normalizar(termino);
  if (limpio.length === 0) return [];

  const limite = opciones.limite ?? 20;

  const encontrados = productos.filter((p) => {
    if (!opciones.incluirSinStock && p.gestionaStock && disponibleDe(p) <= 0) return false;
    return esExacto(p, limpio) || camposBuscables(p).includes(limpio);
  });

  return encontrados
    .sort((a, b) => {
      const ea = esExacto(a, limpio) ? 1 : 0;
      const eb = esExacto(b, limpio) ? 1 : 0;
      if (ea !== eb) return eb - ea;
      if (a.nombre.length !== b.nombre.length) return a.nombre.length - b.nombre.length;
      return a.nombre.localeCompare(b.nombre, 'es-AR');
    })
    .slice(0, limite);
}
