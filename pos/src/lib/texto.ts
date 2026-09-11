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
