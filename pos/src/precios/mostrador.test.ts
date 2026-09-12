import { describe, expect, it } from 'vitest';
import {
  ErrorPrecio,
  formatearRecargo,
  precioDeMostrador,
  precioDeTienda,
  recargoParaCubrir,
  validarRecargo,
  type ProductoConPrecios,
} from './mostrador';

/** 12%, el ejemplo de Matías: $56.000 en la web, $50.000 en el mostrador. */
const RECARGO = 1200;

function producto(p: Partial<ProductoConPrecios> = {}): ProductoConPrecios {
  return {
    precioCentavos: 56_000_00,
    precioLocalCentavos: null,
    soloMostrador: false,
    ...p,
  };
}

describe('precioDeMostrador', () => {
  it('le descuenta el recargo al precio de la tienda', () => {
    expect(precioDeMostrador(producto(), RECARGO)).toBe(50_000_00);
  });

  it('sin recargo cargado, el precio es el mismo en los dos lados', () => {
    expect(precioDeMostrador(producto(), 0)).toBe(56_000_00);
  });

  it('un producto de solo mostrador no lleva recargo: no se vende por la web', () => {
    // Un servicio de $7.050 se cobra $7.050, no $6.300.
    expect(
      precioDeMostrador(producto({ precioCentavos: 7_050_00, soloMostrador: true }), RECARGO),
    ).toBe(7_050_00);
  });

  it('un precio de mostrador escrito a mano manda sobre el cálculo', () => {
    expect(precioDeMostrador(producto({ precioLocalCentavos: 48_000_00 }), RECARGO)).toBe(
      48_000_00,
    );
  });

  it('un precio escrito en cero es un precio, no un «sin cargar»', () => {
    expect(precioDeMostrador(producto({ precioLocalCentavos: 0 }), RECARGO)).toBe(0);
  });

  it('redondea a los cien pesos: en el mostrador nadie cobra $11.607,14', () => {
    // 13.000 / 1,12 = 11.607,14
    expect(precioDeMostrador(producto({ precioCentavos: 13_000_00 }), RECARGO)).toBe(11_600_00);
  });

  it('siempre devuelve un entero de centavos', () => {
    for (const precio of [1_00, 999_00, 13_000_00, 2_152_000_00]) {
      const r = precioDeMostrador(producto({ precioCentavos: precio }), RECARGO);
      expect(Number.isSafeInteger(r)).toBe(true);
      expect(r % 100).toBe(0);
    }
  });
});

describe('precioDeTienda', () => {
  it('es el camino inverso del de mostrador', () => {
    expect(precioDeTienda(50_000_00, RECARGO)).toBe(56_000_00);
  });

  it('ida y vuelta con los precios redondos del catálogo', () => {
    for (const mostrador of [5_000_00, 13_000_00, 50_000_00, 410_000_00]) {
      const tienda = precioDeTienda(mostrador, RECARGO);
      const vuelta = precioDeMostrador(
        { precioCentavos: tienda, precioLocalCentavos: null, soloMostrador: false },
        RECARGO,
      );
      // El redondeo a cien pesos puede correr el resultado, nunca más que eso.
      expect(Math.abs(vuelta - mostrador)).toBeLessThanOrEqual(100_00);
    }
  });
});

describe('recargoParaCubrir', () => {
  /**
   * La cuenta que casi siempre se hace mal: sumarle la comisión al precio no
   * alcanza, porque la comisión se la lleva del total cobrado.
   */
  it('con 6% de comisión hace falta 6,38% de recargo, no 6%', () => {
    expect(recargoParaCubrir(600)).toBe(638);
    // Y la cuenta cierra: cobrando eso, después de la comisión queda el precio.
    const tienda = precioDeTienda(50_000_00, 638);
    const queda = Math.round(tienda * 0.94);
    expect(Math.abs(queda - 50_000_00)).toBeLessThan(100_00);
  });

  it('sin comisión no hace falta recargo', () => {
    expect(recargoParaCubrir(0)).toBe(0);
  });

  it('una comisión del 100% no se puede cubrir', () => {
    expect(() => recargoParaCubrir(10_000)).toThrow(ErrorPrecio);
  });
});

describe('validarRecargo', () => {
  it('acepta lo razonable', () => {
    expect(validarRecargo(0)).toBe(0);
    expect(validarRecargo(1200)).toBe(1200);
  });

  it('rechaza lo que es un error de tipeo', () => {
    expect(() => validarRecargo(-1)).toThrow(ErrorPrecio);
    expect(() => validarRecargo(50_000)).toThrow(ErrorPrecio);
    expect(() => validarRecargo(12.5)).toThrow(ErrorPrecio);
  });
});

describe('formatearRecargo', () => {
  it('se lee como porcentaje', () => {
    expect(formatearRecargo(1200)).toBe('12%');
    expect(formatearRecargo(629)).toBe('6,29%');
    expect(formatearRecargo(0)).toBe('0%');
  });
});
