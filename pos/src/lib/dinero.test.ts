import { describe, expect, it } from 'vitest';
/** Intl usa espacio duro (U+00A0) despues del simbolo; lo normalizamos al comparar. */
const txt = (s: string) => s.replace(/\u00a0/g, ' ');

import {
  aCentavos,
  aPesos,
  descuentoPorcentual,
  ErrorDinero,
  formatearARS,
  repartir,
  sumar,
  usdAPesos,
} from './dinero';

describe('aCentavos', () => {
  it('convierte numeros sin arrastrar error de coma flotante', () => {
    expect(aCentavos(1234.56)).toBe(123456);
    expect(aCentavos(0.1 + 0.2)).toBe(30);
    expect(aCentavos(70000)).toBe(7_000_000);
  });

  it('acepta el formato que escribe una persona en Argentina', () => {
    expect(aCentavos('1.234,56')).toBe(123456);
    expect(aCentavos('2.152.000')).toBe(215_200_000);
    expect(aCentavos(' 5000 ')).toBe(500_000);
  });

  it('rechaza basura en vez de devolver NaN', () => {
    expect(() => aCentavos('abc')).toThrow(ErrorDinero);
    expect(() => aCentavos('')).toThrow(ErrorDinero);
    expect(() => aCentavos(Number.NaN)).toThrow(ErrorDinero);
  });
});

describe('usdAPesos', () => {
  const TC = 157_100; // $1.571,00 por dolar, blue de Cordoba del 03/08

  it('reproduce el ejemplo de D22: USD 1.370 con TC 1.571 da $2.152.000', () => {
    expect(usdAPesos(137_000, TC)).toBe(215_200_000);
    expect(txt(formatearARS(usdAPesos(137_000, TC)))).toBe('$ 2.152.000,00');
  });

  it('redondea al millar de pesos, no al centavo', () => {
    // USD 195 x 1.571 = 306.345 -> $306.000
    expect(usdAPesos(19_500, TC)).toBe(30_600_000);
    // USD 500 x 1.571 = 785.500 -> $786.000 (medio para arriba)
    expect(usdAPesos(50_000, TC)).toBe(78_600_000);
  });

  it('devuelve cero con entradas no positivas en vez de un precio absurdo', () => {
    expect(usdAPesos(0, TC)).toBe(0);
    expect(usdAPesos(137_000, 0)).toBe(0);
  });

  it('el resultado siempre es un entero de centavos', () => {
    for (const usd of [19_500, 63_000, 137_000, 99_999]) {
      const r = usdAPesos(usd, TC);
      expect(Number.isSafeInteger(r)).toBe(true);
    }
  });

  it('distingue los USD 6.300 de los $6.300 del error de agosto', () => {
    // 9 iPhones cargados como USD 6.300 pero leidos como $6.300.
    const correcto = usdAPesos(630_000, TC); // USD 6.300
    const erroneo = aCentavos(6300); // $6.300
    expect(correcto).toBe(989_700_000); // $9.897.000 tras redondear al millar
    expect(correcto / erroneo).toBeGreaterThan(1000);
  });
});

describe('repartir', () => {
  it('reparte sin perder ni inventar centavos', () => {
    const cuotas = repartir(100_000, 3);
    expect(cuotas).toEqual([33_334, 33_333, 33_333]);
    expect(sumar(...cuotas)).toBe(100_000);
  });

  it('reparte exacto cuando divide', () => {
    expect(repartir(120_000, 4)).toEqual([30_000, 30_000, 30_000, 30_000]);
  });

  it('rechaza una cantidad de cuotas invalida', () => {
    expect(() => repartir(100_000, 0)).toThrow(ErrorDinero);
    expect(() => repartir(100_000, 1.5)).toThrow(ErrorDinero);
  });
});

describe('descuentoPorcentual', () => {
  it('calcula sobre centavos y devuelve entero', () => {
    expect(descuentoPorcentual(7_000_000, 10)).toBe(700_000);
    expect(descuentoPorcentual(333, 33)).toBe(110);
  });

  it('rechaza porcentajes fuera de rango', () => {
    expect(() => descuentoPorcentual(1000, -1)).toThrow(ErrorDinero);
    expect(() => descuentoPorcentual(1000, 101)).toThrow(ErrorDinero);
  });
});

describe('aPesos', () => {
  it('rechaza un valor que no sea entero de centavos', () => {
    expect(() => aPesos(12.5)).toThrow(ErrorDinero);
  });
});
