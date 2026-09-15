/**
 * Tests del arqueo.
 *
 * Funciones puras: lo que se prueba es que contar billetes dé exactamente lo
 * mismo que contarlos a mano, y que lo que llega de un formulario —cadenas,
 * casilleros vacíos, valores inventados— no rompa el cierre ni invente plata.
 */
import { describe, expect, it } from 'vitest';
import {
  cantidadDeBilletes,
  desgloseDelConteo,
  DENOMINACIONES,
  ErrorArqueo,
  haceCuanto,
  hayConteo,
  horasAbierta,
  leerConteo,
  totalDelConteo,
} from './arqueo';

describe('denominaciones', () => {
  it('van de mayor a menor, como se apilan en el cajón', () => {
    const valores = DENOMINACIONES.map((d) => d.valorCentavos);
    expect(valores).toEqual([...valores].sort((a, b) => b - a));
  });

  it('todas valen un número entero de centavos', () => {
    for (const d of DENOMINACIONES) {
      expect(Number.isInteger(d.valorCentavos)).toBe(true);
      expect(d.valorCentavos).toBeGreaterThan(0);
    }
  });
});

describe('total del conteo', () => {
  it('suma lo mismo que contar a mano', () => {
    // 3 de $10.000, 5 de $1.000 y 2 de $500 = 36.000
    const conteo = { 1_000_000: 3, 100_000: 5, 50_000: 2 };
    expect(totalDelConteo(conteo)).toBe(36_000_00);
  });

  it('el suelto se suma aparte', () => {
    expect(totalDelConteo({ 100_000: 1 }, 350_00)).toBe(1_350_00);
  });

  it('un cajón vacío da cero', () => {
    expect(totalDelConteo({})).toBe(0);
    expect(totalDelConteo({}, 0)).toBe(0);
  });

  it('no acepta cantidades negativas ni con decimales', () => {
    expect(() => totalDelConteo({ 100_000: -1 })).toThrow(ErrorArqueo);
    expect(() => totalDelConteo({ 100_000: 1.5 })).toThrow(ErrorArqueo);
  });

  it('no acepta un suelto negativo', () => {
    expect(() => totalDelConteo({}, -100)).toThrow(ErrorArqueo);
  });

  it('un conteo grande no pierde centavos', () => {
    // Todo el cajón lleno: la plata va en enteros, así que tiene que dar exacto.
    const conteo = Object.fromEntries(DENOMINACIONES.map((d) => [d.valorCentavos, 37]));
    const aMano = DENOMINACIONES.reduce((n, d) => n + d.valorCentavos * 37, 0);
    expect(totalDelConteo(conteo)).toBe(aMano);
  });
});

describe('leer lo que manda el formulario', () => {
  it('convierte las cadenas del navegador en números', () => {
    expect(leerConteo({ '1000000': '3', '100000': '5' })).toEqual({
      1_000_000: 3,
      100_000: 5,
    });
  });

  it('descarta los casilleros vacíos y los ceros', () => {
    expect(leerConteo({ '1000000': '', '100000': '0', '50000': '  ' })).toEqual({});
  });

  it('descarta denominaciones que no existen: el conteo no inventa billetes', () => {
    expect(leerConteo({ '777': '10', '1000000': '1' })).toEqual({ 1_000_000: 1 });
  });

  it('descarta cantidades negativas y con decimales', () => {
    expect(leerConteo({ '1000000': '-3', '100000': '2.5' })).toEqual({});
  });

  it('lo que llega de un formulario vacío no rompe nada', () => {
    expect(totalDelConteo(leerConteo({}))).toBe(0);
  });
});

describe('¿hubo conteo?', () => {
  it('sin billetes ni suelto, no', () => {
    expect(hayConteo({})).toBe(false);
    expect(hayConteo(null)).toBe(false);
  });

  it('con un solo billete, sí', () => {
    expect(hayConteo({ 100_000: 1 })).toBe(true);
  });

  it('solo con suelto también cuenta', () => {
    expect(hayConteo({}, 500_00)).toBe(true);
    expect(hayConteo(null, 500_00)).toBe(true);
  });

  it('cuenta los billetes, no las denominaciones', () => {
    expect(cantidadDeBilletes({ 1_000_000: 3, 100_000: 5 })).toBe(8);
  });
});

describe('desglose para mostrar', () => {
  it('saca los renglones en cero y respeta el orden de las denominaciones', () => {
    const filas = desgloseDelConteo({ 100_000: 5, 2_000_000: 1, 50_000: 0 });

    expect(filas.map((f) => f.etiqueta)).toEqual(['$20.000', '$1.000']);
    expect(filas[0]).toEqual({
      etiqueta: '$20.000',
      valorCentavos: 2_000_000,
      cantidad: 1,
      subtotalCentavos: 2_000_000,
    });
  });

  it('los subtotales suman el total', () => {
    const conteo = { 1_000_000: 3, 100_000: 5, 50_000: 2 };
    const suma = desgloseDelConteo(conteo).reduce((n, f) => n + f.subtotalCentavos, 0);
    expect(suma).toBe(totalDelConteo(conteo));
  });
});

describe('hace cuánto está abierta', () => {
  const ahora = new Date('2026-09-15T20:00:00Z');

  it('cuenta las horas', () => {
    expect(horasAbierta(new Date('2026-09-15T17:00:00Z'), ahora)).toBeCloseTo(3);
  });

  it('una fecha futura no da negativo', () => {
    expect(horasAbierta(new Date('2026-09-15T23:00:00Z'), ahora)).toBe(0);
  });

  /*
   * La auditoría encontró sesiones abiertas días enteros. Que el sistema sepa
   * decirlo en castellano es lo que hace que alguien la cierre.
   */
  it('lo dice como se dice en el mostrador', () => {
    expect(haceCuanto(new Date('2026-09-15T19:40:00Z'), ahora)).toBe('hace menos de una hora');
    expect(haceCuanto(new Date('2026-09-15T19:00:00Z'), ahora)).toBe('hace 1 hora');
    expect(haceCuanto(new Date('2026-09-15T15:00:00Z'), ahora)).toBe('hace 5 horas');
    expect(haceCuanto(new Date('2026-09-14T15:00:00Z'), ahora)).toBe('hace 1 día');
    expect(haceCuanto(new Date('2026-09-12T15:00:00Z'), ahora)).toBe('hace 3 días');
  });
});
