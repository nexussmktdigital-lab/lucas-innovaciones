/**
 * La cuenta del recargo.
 *
 * Es la misma en los tres lugares donde el local cobra uno —el cheque en una
 * venta, el fiado «cuando pueda», la cuota pagada tarde o con cheque— y por
 * eso vive en un solo lado: tres versiones de esta cuenta se separan en el
 * primer redondeo.
 */
import { describe, expect, it } from 'vitest';
import {
  calcularRecargo,
  comoSeEscribe,
  ErrorRecargo,
  esMotivoDeRecargo,
  PORCENTAJE_MAXIMO,
} from './recargo';
import { formatearARS } from './dinero';

/** `formatearARS` separa con espacio duro; en el test se compara con uno normal. */
const pesos = (c: number) => formatearARS(c).replace(/\u00a0/g, ' ');

describe('calcular el recargo', () => {
  it('un porcentaje sale de la base', () => {
    // 5% de $40.000 son $2.000.
    expect(calcularRecargo(40_000_00, { forma: 'porcentaje', valor: 5 })).toBe(2_000_00);
  });

  it('un monto escrito se toma tal cual, sin mirar la base', () => {
    expect(calcularRecargo(40_000_00, { forma: 'monto', valor: 2_000 })).toBe(2_000_00);
    expect(calcularRecargo(1_00, { forma: 'monto', valor: 2_000 })).toBe(2_000_00);
  });

  it('sin recargo escrito no hay recargo', () => {
    expect(calcularRecargo(40_000_00, null)).toBe(0);
    expect(calcularRecargo(40_000_00, { forma: 'porcentaje', valor: 0 })).toBe(0);
    expect(calcularRecargo(40_000_00, { forma: 'monto', valor: 0 })).toBe(0);
  });

  it('un valor negativo no resta: no es un descuento disfrazado', () => {
    expect(calcularRecargo(40_000_00, { forma: 'porcentaje', valor: -5 })).toBe(0);
    expect(calcularRecargo(40_000_00, { forma: 'monto', valor: -2_000 })).toBe(0);
  });

  /*
   * Al centavo más cercano y no para arriba: sobre doscientos pagos al año,
   * redondear siempre a favor del local es cobrar de más sin que nadie lo
   * haya decidido.
   */
  it('el porcentaje redondea al centavo más cercano', () => {
    // 3% de $333,33 son 9,9999 → 10,00.
    expect(calcularRecargo(333_33, { forma: 'porcentaje', valor: 3 })).toBe(10_00);
    // 1% de $1.005 son 10,05.
    expect(calcularRecargo(1_005_00, { forma: 'porcentaje', valor: 1 })).toBe(10_05);
  });

  it('con base cero un porcentaje da cero y no rompe', () => {
    expect(calcularRecargo(0, { forma: 'porcentaje', valor: 10 })).toBe(0);
  });

  /*
   * La guarda del cero de más. Un 500% sobre un iPhone no es un recargo, es
   * un error de tipeo que nadie revisa hasta que el cliente mira el papel.
   */
  it('un porcentaje imposible se frena, y lo dice', () => {
    expect(() => calcularRecargo(40_000_00, { forma: 'porcentaje', valor: 500 })).toThrow(
      ErrorRecargo,
    );
    expect(() => calcularRecargo(40_000_00, { forma: 'porcentaje', valor: 500 })).toThrow(
      /error de tipeo|no puede ser/i,
    );
    // Justo en el tope sí se puede: duplicar es raro pero no imposible.
    expect(calcularRecargo(40_000_00, { forma: 'porcentaje', valor: PORCENTAJE_MAXIMO })).toBe(
      40_000_00,
    );
  });

  it('un monto absurdo no se convierte en un número roto', () => {
    expect(() => calcularRecargo(1_000_00, { forma: 'monto', valor: 1e18 })).toThrow(ErrorRecargo);
  });
});

describe('cómo se escribe', () => {
  it('un porcentaje se dice con su porcentaje y su plata', () => {
    expect(comoSeEscribe({ forma: 'porcentaje', valor: 5 }, pesos, 40_000_00)).toBe(
      '5% · $ 2.000,00',
    );
  });

  it('un monto se dice solo con su plata', () => {
    expect(comoSeEscribe({ forma: 'monto', valor: 2_000 }, pesos, 40_000_00)).toBe(
      '$ 2.000,00',
    );
  });

  it('sin recargo no dice nada', () => {
    expect(comoSeEscribe(null, pesos, 40_000_00)).toBe('');
    expect(comoSeEscribe({ forma: 'porcentaje', valor: 0 }, pesos, 40_000_00)).toBe('');
  });
});

describe('los motivos', () => {
  it('solo los tres que la base acepta', () => {
    expect(esMotivoDeRecargo('cheque')).toBe(true);
    expect(esMotivoDeRecargo('demora')).toBe(true);
    expect(esMotivoDeRecargo('otro')).toBe(true);
    expect(esMotivoDeRecargo('porque si')).toBe(false);
    expect(esMotivoDeRecargo(null)).toBe(false);
  });
});
