import { describe, expect, it } from 'vitest';
import { fechaLocalISO, formatearFecha, formatearFechaHora, ZONA_HORARIA } from './fecha';

describe('formatearFechaHora', () => {
  it('usa el huso de Buenos Aires, no el del servidor', () => {
    // 18:30 UTC son las 15:30 en Argentina.
    expect(formatearFechaHora(new Date('2026-09-11T18:30:00Z'))).toBe('11/09/2026, 15:30');
  });

  it('usa reloj de 24 horas', () => {
    expect(formatearFechaHora(new Date('2026-09-11T23:45:00Z'))).toContain('20:45');
  });

  it('cruza bien el cambio de día', () => {
    // 02:00 UTC del 12 son las 23:00 del 11 en Argentina.
    expect(formatearFechaHora(new Date('2026-09-12T02:00:00Z'))).toBe('11/09/2026, 23:00');
  });
});

describe('formatearFecha', () => {
  it('va en día/mes/año', () => {
    expect(formatearFecha(new Date('2026-09-11T15:00:00Z'))).toBe('11/09/2026');
  });
});

describe('fechaLocalISO', () => {
  it('devuelve el día del calendario del local, no el del servidor', () => {
    expect(fechaLocalISO(new Date('2026-09-12T02:00:00Z'))).toBe('2026-09-11');
    expect(fechaLocalISO(new Date('2026-09-12T12:00:00Z'))).toBe('2026-09-12');
  });
});

describe('ZONA_HORARIA', () => {
  it('es la de Argentina', () => {
    expect(ZONA_HORARIA).toBe('America/Argentina/Buenos_Aires');
  });
});
