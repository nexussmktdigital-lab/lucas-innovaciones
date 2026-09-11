/**
 * Fechas y horas.
 *
 * En la base todo se guarda en `timestamptz` (UTC). El huso del negocio se
 * aplica solo al mostrar y al calcular limites de dia (arqueo, reportes).
 */

export const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';

const FORMATO_FECHA = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_HORARIA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const FORMATO_FECHA_HORA = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_HORARIA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatearFecha(d: Date): string {
  return FORMATO_FECHA.format(d);
}

export function formatearFechaHora(d: Date): string {
  return FORMATO_FECHA_HORA.format(d);
}

/** Devuelve `YYYY-MM-DD` segun el calendario del local, no el del servidor. */
export function fechaLocalISO(d: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return partes;
}
