/**
 * Normalizacion de texto.
 *
 * El catalogo mezcla acentos y mayusculas ("Servicio técnico", "SERVICIO
 * TECNICO"), asi que toda comparacion y toda busqueda pasa por aca.
 */

/** Minusculas, sin acentos y sin espacios de sobra. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Cuantas palabras de la busqueda se tienen en cuenta.
 *
 * Ocho alcanza de sobra para el mostrador —«cargador fox box mega 30w tipo c»
 * son siete— y le pone un techo al tamano de la consulta, que se arma con una
 * condicion por palabra a partir de lo que alguien tipea.
 */
export const PALABRAS_MAXIMAS = 8;

/**
 * Las palabras de un termino de busqueda, normalizadas.
 *
 * Vive aca y no en cada buscador porque **los dos tienen que partir igual**: el
 * del servidor y el del catalogo guardado en la tablet. Si uno separara
 * distinto, el mismo termino encontraria una cosa con internet y otra sin el, y
 * eso es lo unico que esta prohibido en el modo sin conexion (D56).
 */
export function palabrasDeBusqueda(termino: string): string[] {
  return normalizar(termino).split(' ').filter(Boolean).slice(0, PALABRAS_MAXIMAS);
}
