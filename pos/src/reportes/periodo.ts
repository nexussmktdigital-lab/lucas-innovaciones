/**
 * Períodos de un reporte.
 *
 * Un reporte es siempre «esto, entre tal día y tal otro», y el día del negocio
 * no es el día del servidor: una venta de las 22:30 del lunes en Villa Santa
 * Rosa son las 01:30 del martes en UTC. Si los límites se calculan mal, la
 * última hora de cada día se va al día siguiente y ningún número cierra con lo
 * que dice la caja.
 *
 * Todo lo de acá convierte entre el calendario local y los instantes UTC que
 * hay en la base, y no usa ninguna librería de fechas: el huso se saca de
 * `Intl`, así que si algún día vuelve el horario de verano esto sigue andando
 * sin tocar nada.
 */
// `sumarDias` y `sumarMeses` viven en `lib/fecha` porque las usan dos dominios:
// los períodos de un reporte y los vencimientos de las cuotas. Se re-exportan
// desde acá para no romper a quien ya las importaba de este módulo.
import { sumarDias, sumarMeses, ZONA_HORARIA } from '@/lib/fecha';

export { sumarDias, sumarMeses };

export class ErrorPeriodo extends Error {}

export type NombreDePeriodo = 'hoy' | 'ayer' | 'semana' | 'mes' | 'mes_pasado' | 'anio';

export interface Periodo {
  /** Instante UTC en que empieza el período, inclusive. */
  desde: Date;
  /** Instante UTC en que termina, exclusivo. */
  hasta: Date;
  /** Cómo se llama en pantalla. */
  etiqueta: string;
  /** `YYYY-MM-DD` local, para los campos de fecha del formulario. */
  desdeISO: string;
  hastaISO: string;
}

export const PERIODOS: { nombre: NombreDePeriodo; etiqueta: string }[] = [
  { nombre: 'hoy', etiqueta: 'Hoy' },
  { nombre: 'ayer', etiqueta: 'Ayer' },
  { nombre: 'semana', etiqueta: 'Últimos 7 días' },
  { nombre: 'mes', etiqueta: 'Este mes' },
  { nombre: 'mes_pasado', etiqueta: 'Mes pasado' },
  { nombre: 'anio', etiqueta: 'Últimos 12 meses' },
];

/**
 * El desfasaje del huso del negocio en ese instante, en minutos.
 *
 * Se pregunta por instante y no se fija en −180: Argentina no tiene horario de
 * verano desde 2009, pero un reporte que lo da por sentado se rompe en silencio
 * el día que vuelva, y el error sería de una hora en los límites de cada día.
 */
export function desfasajeMinutos(instante: Date): number {
  const formato = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HORARIA,
    timeZoneName: 'longOffset',
  });

  const parte = formato.formatToParts(instante).find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(parte ?? '');
  if (!m) return -180; // `GMT` a secas significa cero; acá nunca pasa.

  const signo = m[1] === '-' ? -1 : 1;
  return signo * (Number(m[2]) * 60 + Number(m[3]));
}

/** El instante UTC en que empieza ese día del calendario local. */
export function comienzoDelDia(fechaISO: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) {
    throw new ErrorPeriodo(`«${fechaISO}» no es una fecha con forma AAAA-MM-DD.`);
  }

  // Primera aproximación tomando el día como si fuera UTC, y después se corrige
  // con el desfasaje que rige en ese momento del año.
  const tentativa = new Date(`${fechaISO}T00:00:00Z`);
  if (Number.isNaN(tentativa.getTime())) {
    throw new ErrorPeriodo(`«${fechaISO}» no es una fecha que exista.`);
  }

  const minutos = desfasajeMinutos(tentativa);
  return new Date(tentativa.getTime() - minutos * 60_000);
}

/** `YYYY-MM-DD` del calendario local para ese instante. */
export function diaLocal(instante: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

/** `YYYY-MM` del calendario local. */
export function mesLocal(instante: Date): string {
  return diaLocal(instante).slice(0, 7);
}

/** El primer día de ese mes, en `YYYY-MM-DD`. */
export function primerDiaDelMes(fechaISO: string): string {
  return `${fechaISO.slice(0, 7)}-01`;
}

/**
 * Arma un período con nombre.
 *
 * `hasta` siempre es exclusivo: «hoy» va desde las 00:00 de hoy hasta las 00:00
 * de mañana, no hasta las 23:59:59. Un límite inclusivo deja afuera la última
 * fracción de segundo, que es poco hasta el día que una venta cae justo ahí.
 */
export function periodoPorNombre(nombre: NombreDePeriodo, ahora = new Date()): Periodo {
  const hoy = diaLocal(ahora);
  const etiqueta = PERIODOS.find((p) => p.nombre === nombre)?.etiqueta ?? nombre;

  switch (nombre) {
    case 'hoy':
      return armar(hoy, sumarDias(hoy, 1), etiqueta);
    case 'ayer':
      return armar(sumarDias(hoy, -1), hoy, etiqueta);
    case 'semana':
      return armar(sumarDias(hoy, -6), sumarDias(hoy, 1), etiqueta);
    case 'mes':
      return armar(primerDiaDelMes(hoy), sumarDias(hoy, 1), etiqueta);
    case 'mes_pasado': {
      const inicio = primerDiaDelMes(sumarMeses(primerDiaDelMes(hoy), -1));
      return armar(inicio, primerDiaDelMes(hoy), etiqueta);
    }
    case 'anio':
      return armar(sumarMeses(primerDiaDelMes(hoy), -11), sumarDias(hoy, 1), etiqueta);
  }
}

/**
 * Tope de un período escrito a mano, en días.
 *
 * Las fechas viajan por la URL, y `desde=1970` arma en memoria la tabla entera
 * —ventas, renglones y gastos— para nada. No es un ataque, porque hay que ser
 * el dueño y estar con sesión: es el dueño tocando una URL vieja y viendo la
 * pantalla colgada sin entender por qué.
 *
 * Diez años y no tres: el histórico importado del POS anterior empieza en 2023
 * y «todo» es una pregunta legítima. El tope está para el absurdo, no para
 * discutirle al dueño qué período puede mirar.
 */
export const DIAS_MAXIMOS_DE_UN_PERIODO = 3660;

/** Un período escrito a mano, con las dos puntas inclusivas para quien lo lee. */
export function periodoEntre(desdeISO: string, hastaISO: string): Periodo {
  if (desdeISO > hastaISO) {
    throw new ErrorPeriodo('La fecha de inicio es posterior a la de fin.');
  }
  const dias =
    (comienzoDelDia(hastaISO).getTime() - comienzoDelDia(desdeISO).getTime()) / 86_400_000;
  if (dias > DIAS_MAXIMOS_DE_UN_PERIODO) {
    throw new ErrorPeriodo(
      `Ese período son más de ${Math.round(DIAS_MAXIMOS_DE_UN_PERIODO / 365)} años, ` +
        'más que todo lo que hay cargado. Elegí uno más corto: el reporte se arma en el ' +
        'momento y uno así tarda una eternidad.',
    );
  }
  // `hastaISO` lo escribe una persona pensando «hasta ese día inclusive», así
  // que el límite real es el comienzo del día siguiente.
  return armar(desdeISO, sumarDias(hastaISO, 1), `${desdeISO} a ${hastaISO}`);
}

function armar(desdeISO: string, hastaExclusivoISO: string, etiqueta: string): Periodo {
  return {
    desde: comienzoDelDia(desdeISO),
    hasta: comienzoDelDia(hastaExclusivoISO),
    etiqueta,
    desdeISO,
    hastaISO: sumarDias(hastaExclusivoISO, -1),
  };
}

/**
 * El período de la misma duración, justo antes.
 *
 * Es lo que convierte un número en información: «$180.000» no dice nada;
 * «$180.000, 12% más que la semana pasada» sí.
 */
export function periodoAnterior(p: Periodo): Periodo {
  const duracion = p.hasta.getTime() - p.desde.getTime();
  const desde = new Date(p.desde.getTime() - duracion);

  return {
    desde,
    hasta: p.desde,
    etiqueta: 'período anterior',
    desdeISO: diaLocal(desde),
    hastaISO: diaLocal(new Date(p.desde.getTime() - 1)),
  };
}

/**
 * Cuánto cambió, en porcentaje.
 *
 * `null` cuando antes no hubo nada: el aumento contra cero no es «infinito por
 * ciento», es un período nuevo y así hay que decirlo.
 */
export function variacion(ahora: number, antes: number): number | null {
  if (antes === 0) return null;
  return Math.round(((ahora - antes) / antes) * 1000) / 10;
}

/**
 * Un instante, como lo quiere el driver de PostgreSQL.
 *
 * Parece de más y no lo es: el driver de producción (`postgres`) **rechaza un
 * `Date` suelto** como parámetro de una consulta escrita a mano y falla con
 * «the string argument must be of type string». PGlite, que es el que usan los
 * tests, lo acepta sin chistar. O sea que sin esto todos los tests pasaban y en
 * el local no andaba ni un reporte. Lo encontró el test de punta a punta.
 *
 * Se manda el ISO en UTC y se deja que PostgreSQL lo interprete, que es
 * exactamente lo mismo que guarda la columna.
 */
export function instante(d: Date): string {
  return d.toISOString();
}

/** Lee el nombre de un período de la query, con «este mes» por defecto. */
export function leerNombreDePeriodo(crudo: string | undefined): NombreDePeriodo {
  const encontrado = PERIODOS.find((p) => p.nombre === crudo);
  return encontrado?.nombre ?? 'mes';
}
