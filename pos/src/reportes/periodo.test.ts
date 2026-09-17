/**
 * Tests de los períodos.
 *
 * Son funciones puras. Lo que importa es que el día del negocio empiece cuando
 * abre el local y no cuando lo dice UTC: con el huso mal aplicado, la última
 * hora de cada día se cuenta en el día siguiente y ningún reporte cierra contra
 * lo que dice la caja.
 */
import { describe, expect, it } from 'vitest';
import {
  comienzoDelDia,
  desfasajeMinutos,
  diaLocal,
  ErrorPeriodo,
  instante,
  mesLocal,
  periodoAnterior,
  periodoEntre,
  periodoPorNombre,
  primerDiaDelMes,
  sumarDias,
  sumarMeses,
  variacion,
} from './periodo';

/** Un martes cualquiera, 15:00 en Villa Santa Rosa. */
const AHORA = new Date('2026-09-15T18:00:00Z');

describe('el huso del negocio', () => {
  it('Argentina está tres horas detrás de UTC', () => {
    expect(desfasajeMinutos(AHORA)).toBe(-180);
  });

  it('y también en enero, que es cuando volvería el horario de verano', () => {
    expect(desfasajeMinutos(new Date('2026-01-15T12:00:00Z'))).toBe(-180);
  });

  it('el día del local arranca a las 03:00 UTC', () => {
    expect(comienzoDelDia('2026-09-15').toISOString()).toBe('2026-09-15T03:00:00.000Z');
  });

  /*
   * El caso que rompe todo si el huso se ignora: una venta de las 22:30 del
   * lunes son las 01:30 del martes en UTC, y tiene que contar como del lunes.
   */
  it('una venta de la noche cuenta en el día que se hizo, no en el siguiente', () => {
    const venta = new Date('2026-09-16T01:30:00Z'); // 22:30 del 15 en el local
    expect(diaLocal(venta)).toBe('2026-09-15');

    const hoy = periodoPorNombre('hoy', AHORA);
    expect(venta >= hoy.desde && venta < hoy.hasta).toBe(true);
  });

  it('una fecha con forma inventada no pasa', () => {
    expect(() => comienzoDelDia('15/09/2026')).toThrow(ErrorPeriodo);
    expect(() => comienzoDelDia('2026-13-40')).toThrow(ErrorPeriodo);
  });
});

describe('moverse por el calendario', () => {
  it('suma y resta días', () => {
    expect(sumarDias('2026-09-15', 1)).toBe('2026-09-16');
    expect(sumarDias('2026-09-01', -1)).toBe('2026-08-31');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('suma meses recortando el día cuando el mes destino es más corto', () => {
    expect(sumarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(sumarMeses('2026-03-31', -1)).toBe('2026-02-28');
    expect(sumarMeses('2026-09-15', -11)).toBe('2025-10-15');
  });

  it('el primer día del mes', () => {
    expect(primerDiaDelMes('2026-09-15')).toBe('2026-09-01');
  });

  it('el mes local de un instante', () => {
    expect(mesLocal(new Date('2026-09-01T02:00:00Z'))).toBe('2026-08');
  });
});

describe('los períodos con nombre', () => {
  it('hoy va de las 00:00 de hoy a las 00:00 de mañana', () => {
    const p = periodoPorNombre('hoy', AHORA);
    expect(p.desde.toISOString()).toBe('2026-09-15T03:00:00.000Z');
    expect(p.hasta.toISOString()).toBe('2026-09-16T03:00:00.000Z');
    expect(p.desdeISO).toBe('2026-09-15');
    expect(p.hastaISO).toBe('2026-09-15');
  });

  it('ayer termina donde empieza hoy', () => {
    const ayer = periodoPorNombre('ayer', AHORA);
    const hoy = periodoPorNombre('hoy', AHORA);
    expect(ayer.hasta.getTime()).toBe(hoy.desde.getTime());
  });

  it('últimos 7 días incluye hoy', () => {
    const p = periodoPorNombre('semana', AHORA);
    expect(p.desdeISO).toBe('2026-09-09');
    expect(p.hastaISO).toBe('2026-09-15');
  });

  it('este mes va del 1 a hoy', () => {
    const p = periodoPorNombre('mes', AHORA);
    expect(p.desdeISO).toBe('2026-09-01');
    expect(p.hastaISO).toBe('2026-09-15');
  });

  it('el mes pasado es el mes entero, no los últimos 30 días', () => {
    const p = periodoPorNombre('mes_pasado', AHORA);
    expect(p.desdeISO).toBe('2026-08-01');
    expect(p.hastaISO).toBe('2026-08-31');
  });

  it('últimos 12 meses arranca el 1 del mes, doce meses atrás', () => {
    const p = periodoPorNombre('anio', AHORA);
    expect(p.desdeISO).toBe('2025-10-01');
    expect(p.hastaISO).toBe('2026-09-15');
  });
});

describe('un período escrito a mano', () => {
  /*
   * Quien escribe «hasta el 15» quiere el 15 incluido. El límite real es el
   * comienzo del 16, si no se pierde el último día entero.
   */
  it('las dos puntas son inclusivas para quien lo escribe', () => {
    const p = periodoEntre('2026-09-01', '2026-09-15');
    expect(p.desde.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(p.hasta.toISOString()).toBe('2026-09-16T03:00:00.000Z');
    expect(p.hastaISO).toBe('2026-09-15');
  });

  it('un solo día también se puede', () => {
    const p = periodoEntre('2026-09-15', '2026-09-15');
    expect(p.hasta.getTime() - p.desde.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('al revés no', () => {
    expect(() => periodoEntre('2026-09-15', '2026-09-01')).toThrow(ErrorPeriodo);
  });

  it('todo el histórico entra: el importado del POS anterior empieza en 2023', () => {
    expect(() => periodoEntre('2023-01-01', '2026-09-15')).not.toThrow();
  });

  it('desde 1970 no: arma la tabla entera en memoria para nada', () => {
    expect(() => periodoEntre('1970-01-01', '2026-09-15')).toThrow(ErrorPeriodo);
  });
});

describe('los instantes que van a la base', () => {
  /*
   * Esto existe por un error que costó caro: el driver de producción rechaza un
   * `Date` suelto como parámetro de una consulta escrita a mano, y PGlite —el
   * de los tests— lo acepta. Todos los tests pasaban y en el local no andaba
   * ni un reporte.
   */
  it('un instante se manda como texto ISO, no como Date', () => {
    const p = periodoPorNombre('hoy', AHORA);
    expect(instante(p.desde)).toBe('2026-09-15T03:00:00.000Z');
    expect(typeof instante(p.hasta)).toBe('string');
  });
});

describe('comparar con el período anterior', () => {
  it('el anterior dura lo mismo y termina donde empieza este', () => {
    const p = periodoPorNombre('semana', AHORA);
    const previo = periodoAnterior(p);

    expect(previo.hasta.getTime()).toBe(p.desde.getTime());
    expect(previo.hasta.getTime() - previo.desde.getTime()).toBe(
      p.hasta.getTime() - p.desde.getTime(),
    );
    expect(previo.desdeISO).toBe('2026-09-02');
    expect(previo.hastaISO).toBe('2026-09-08');
  });

  it('la variación en porcentaje, con un decimal', () => {
    expect(variacion(110, 100)).toBe(10);
    expect(variacion(90, 100)).toBe(-10);
    expect(variacion(1234, 1000)).toBe(23.4);
  });

  /* Crecer desde cero no es «infinito por ciento»: es un período nuevo. */
  it('contra un período vacío no hay porcentaje que valga', () => {
    expect(variacion(5000, 0)).toBeNull();
  });
});
