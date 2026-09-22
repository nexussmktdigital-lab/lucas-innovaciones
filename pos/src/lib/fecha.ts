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

/**
 * Reloj de 24 horas a propósito: en un ticket térmico «15:30» ocupa menos que
 * «03:30 p. m.» y no se puede leer mal.
 */
const FORMATO_FECHA_HORA = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_HORARIA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Solo la hora, para las listas donde el día ya está dicho arriba. */
const FORMATO_HORA = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_HORARIA,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatearFecha(d: Date): string {
  return FORMATO_FECHA.format(d);
}

export function formatearHora(d: Date): string {
  return FORMATO_HORA.format(d);
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

/** Suma días a una fecha `YYYY-MM-DD`, en el calendario y no en milisegundos. */
export function sumarDias(fechaISO: string, dias: number): string {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Suma meses, recortando el día si el mes destino es más corto. */
export function sumarMeses(fechaISO: string, meses: number): string {
  const [a, m, d] = fechaISO.split('-').map(Number) as [number, number, number];
  const base = new Date(Date.UTC(a, m - 1 + meses, 1, 12));
  const ultimoDia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0, 12));
  base.setUTCDate(Math.min(d, ultimoDia.getUTCDate()));
  return base.toISOString().slice(0, 10);
}

/** Cuántos días de calendario hay entre dos fechas `YYYY-MM-DD` (b − a). */
export function diasEntre(desdeISO: string, hastaISO: string): number {
  const a = Date.parse(`${desdeISO}T12:00:00Z`);
  const b = Date.parse(`${hastaISO}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
