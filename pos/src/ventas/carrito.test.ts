import { describe, expect, it } from 'vitest';
import {
  armarLinea,
  calcularCobro,
  calcularTotales,
  ErrorCarrito,
  problemasDelCobro,
  resolverDescuento,
  stockDisponible,
  type LineaCarrito,
  type ProductoVendible,
  type VarianteVendible,
} from './carrito';

const TC = 156_100; // $1.561,00 — la cotización que devolvió el plugin

function producto(p: Partial<ProductoVendible> = {}): ProductoVendible {
  return {
    id: 'p1',
    nombre: 'Vidrio templado 9D',
    precioCentavos: 500_000,
    moneda: 'ARS',
    precioUsdCentavos: null,
    precioEditable: false,
    gestionaStock: true,
    stock: 40,
    stockComprometido: 0,
    ...p,
  };
}

function linea(l: Partial<LineaCarrito> = {}): LineaCarrito {
  return {
    productId: 'p1',
    descripcion: 'Vidrio templado 9D',
    cantidad: 1,
    precioUnitarioCentavos: 500_000,
    monedaOriginal: 'ARS',
    precioUsdCentavos: null,
    descuentoCentavos: 0,
    ...l,
  };
}

describe('armarLinea', () => {
  it('toma el precio de lista de un producto en pesos', () => {
    const l = armarLinea(producto(), 2);
    expect(l.precioUnitarioCentavos).toBe(500_000);
    expect(l.monedaOriginal).toBe('ARS');
    expect(l.precioUsdCentavos).toBeNull();
  });

  it('calcula el precio en pesos de un producto en dólares, no lo copia', () => {
    const iphone = producto({
      nombre: 'iPhone 14 Pro 256GB',
      moneda: 'USD',
      precioUsdCentavos: 137_000,
      // Un precio en pesos desactualizado en el espejo: no debe usarse.
      precioCentavos: 1,
    });
    const l = armarLinea(iphone, 1, { tcCentavos: TC });

    // USD 1.370 x 1.561 = 2.138.570 -> $2.139.000 redondeado al millar
    expect(l.precioUnitarioCentavos).toBe(213_900_000);
    expect(l.precioUsdCentavos).toBe(137_000);
    expect(l.monedaOriginal).toBe('USD');
  });

  it('se niega a vender en dólares sin cotización, en vez de inventar un precio', () => {
    const iphone = producto({ moneda: 'USD', precioUsdCentavos: 137_000 });
    expect(() => armarLinea(iphone, 1)).toThrow(/cotización/i);
    expect(() => armarLinea(iphone, 1, { tcCentavos: null })).toThrow(ErrorCarrito);
  });

  it('acepta precio manual solo en productos marcados como editables', () => {
    const servicio = producto({
      nombre: 'Servicio técnico · Reparación',
      precioEditable: true,
      gestionaStock: false,
      precioCentavos: 0,
    });
    expect(armarLinea(servicio, 1, { precioManualCentavos: 4_500_000 }).precioUnitarioCentavos).toBe(
      4_500_000,
    );

    expect(() => armarLinea(producto(), 1, { precioManualCentavos: 100 })).toThrow(
      /No se puede cambiar el precio/,
    );
  });

  it('el precio manual no puede ser negativo', () => {
    const servicio = producto({ precioEditable: true });
    expect(() => armarLinea(servicio, 1, { precioManualCentavos: -1 })).toThrow(ErrorCarrito);
  });

  it('rechaza cantidades que no son enteros positivos', () => {
    for (const mala of [0, -1, 1.5, Number.NaN]) {
      expect(() => armarLinea(producto(), mala)).toThrow(ErrorCarrito);
    }
  });
});

describe('stockDisponible', () => {
  it('descuenta lo comprometido por pedidos web', () => {
    expect(stockDisponible(producto({ stock: 5, stockComprometido: 2 }))).toBe(3);
  });

  it('un servicio no tiene tope de stock', () => {
    expect(stockDisponible(producto({ gestionaStock: false }))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('calcularTotales', () => {
  it('suma líneas y cuenta unidades', () => {
    const t = calcularTotales([
      linea({ cantidad: 2, precioUnitarioCentavos: 500_000 }),
      linea({ productId: 'p2', cantidad: 1, precioUnitarioCentavos: 6_500_000 }),
    ]);
    expect(t.brutoCentavos).toBe(7_500_000);
    expect(t.subtotalCentavos).toBe(7_500_000);
    expect(t.totalCentavos).toBe(7_500_000);
    expect(t.unidades).toBe(3);
  });

  it('resta el descuento de línea antes del global', () => {
    const t = calcularTotales(
      [linea({ cantidad: 2, precioUnitarioCentavos: 500_000, descuentoCentavos: 100_000 })],
      { tipo: 'porcentaje', porcentaje: 10 },
    );
    expect(t.brutoCentavos).toBe(1_000_000);
    expect(t.descuentoLineasCentavos).toBe(100_000);
    expect(t.subtotalCentavos).toBe(900_000);
    expect(t.descuentoGlobalCentavos).toBe(90_000);
    expect(t.totalCentavos).toBe(810_000);
  });

  it('un carrito vacío da todo en cero', () => {
    const t = calcularTotales([]);
    expect(t.totalCentavos).toBe(0);
    expect(t.unidades).toBe(0);
  });

  it('el total nunca queda negativo por más grande que sea el descuento', () => {
    const t = calcularTotales([linea({ precioUnitarioCentavos: 100_000 })], {
      tipo: 'monto',
      centavos: 999_999_999,
    });
    expect(t.totalCentavos).toBe(0);
  });

  it('un descuento de línea mayor al bruto de esa línea no arrastra a las otras', () => {
    const t = calcularTotales([
      linea({ precioUnitarioCentavos: 100_000, descuentoCentavos: 500_000 }),
      linea({ productId: 'p2', precioUnitarioCentavos: 300_000 }),
    ]);
    expect(t.descuentoLineasCentavos).toBe(100_000);
    expect(t.totalCentavos).toBe(300_000);
  });
});

describe('resolverDescuento', () => {
  it('calcula el porcentaje sobre la base', () => {
    expect(resolverDescuento({ tipo: 'porcentaje', porcentaje: 15 }, 1_000_000)).toBe(150_000);
  });

  it('nunca supera la base', () => {
    expect(resolverDescuento({ tipo: 'monto', centavos: 5_000_000 }, 1_000_000)).toBe(1_000_000);
  });

  it('rechaza montos negativos', () => {
    expect(() => resolverDescuento({ tipo: 'monto', centavos: -1 }, 1_000_000)).toThrow(
      ErrorCarrito,
    );
  });
});

describe('calcularCobro', () => {
  it('suma pagos de varios medios y dice cuánto falta', () => {
    const c = calcularCobro(8_000_000, [
      { medio: 'efectivo', montoCentavos: 5_000_000 },
      { medio: 'transferencia', montoCentavos: 2_000_000 },
    ]);
    expect(c.pagadoCentavos).toBe(7_000_000);
    expect(c.faltanteCentavos).toBe(1_000_000);
    expect(c.alcanza).toBe(false);
  });

  it('calcula el vuelto cuando el efectivo alcanza y sobra', () => {
    const c = calcularCobro(7_000_000, [{ medio: 'efectivo', montoCentavos: 10_000_000 }]);
    expect(c.vueltoCentavos).toBe(3_000_000);
    expect(c.faltanteCentavos).toBe(0);
    expect(c.alcanza).toBe(true);
  });

  it('el vuelto no puede superar el efectivo entregado', () => {
    // Pagó de más con transferencia: eso no vuelve como cambio.
    const c = calcularCobro(5_000_000, [
      { medio: 'efectivo', montoCentavos: 1_000_000 },
      { medio: 'transferencia', montoCentavos: 6_000_000 },
    ]);
    expect(c.pagadoCentavos).toBe(7_000_000);
    expect(c.vueltoCentavos).toBe(1_000_000);
  });

  it('el pago exacto no genera vuelto', () => {
    const c = calcularCobro(7_000_000, [{ medio: 'efectivo', montoCentavos: 7_000_000 }]);
    expect(c.vueltoCentavos).toBe(0);
    expect(c.alcanza).toBe(true);
  });

  it('rechaza un pago de cero o negativo', () => {
    expect(() => calcularCobro(1000, [{ medio: 'efectivo', montoCentavos: 0 }])).toThrow(
      ErrorCarrito,
    );
  });
});

describe('problemasDelCobro', () => {
  const totales = calcularTotales([linea({ precioUnitarioCentavos: 7_000_000 })]);

  it('un cobro completo en efectivo no tiene problemas', () => {
    expect(
      problemasDelCobro(totales, [{ medio: 'efectivo', montoCentavos: 7_000_000 }]),
    ).toEqual([]);
  });

  it('avisa que el carrito está vacío', () => {
    expect(problemasDelCobro(calcularTotales([]), [])).toContain('El carrito está vacío.');
  });

  it('avisa que falta plata', () => {
    expect(
      problemasDelCobro(totales, [{ medio: 'efectivo', montoCentavos: 1_000_000 }]),
    ).toContain('El pago no cubre el total.');
  });

  it('exige cliente para cobrar en cuenta corriente', () => {
    const p = problemasDelCobro(totales, [
      { medio: 'cuenta_corriente', montoCentavos: 7_000_000 },
    ]);
    expect(p.some((x) => x.includes('cliente'))).toBe(true);

    expect(
      problemasDelCobro(totales, [{ medio: 'cuenta_corriente', montoCentavos: 7_000_000 }], {
        hayCliente: true,
      }),
    ).toEqual([]);
  });

  it('detecta un excedente que no se puede devolver', () => {
    const p = problemasDelCobro(totales, [
      { medio: 'transferencia', montoCentavos: 9_000_000 },
    ]);
    expect(p.some((x) => x.includes('excedente'))).toBe(true);
  });

  it('exige la marca en pagos con tarjeta', () => {
    expect(
      problemasDelCobro(totales, [{ medio: 'credito', montoCentavos: 7_000_000, cuotas: 3 }]),
    ).toContain('Falta la marca de la tarjeta.');

    expect(
      problemasDelCobro(totales, [
        { medio: 'credito', montoCentavos: 7_000_000, cuotas: 3, marcaTarjeta: 'Visa' },
      ]),
    ).toEqual([]);
  });
});

describe('armarLinea con variación', () => {
  const vidrio: ProductoVendible = {
    id: 'p1',
    nombre: 'Vidrio templado 9D',
    precioCentavos: 500_000,
    moneda: 'ARS',
    precioUsdCentavos: null,
    precioEditable: false,
    gestionaStock: true,
    stock: 40,
    stockComprometido: 0,
  };

  const medida: VarianteVendible = {
    id: 'v1',
    nombre: '6.7 pulgadas',
    precioCentavos: 800_000,
    gestionaStock: true,
    stock: 3,
    activo: true,
  };

  it('usa el precio de la variación y no el del padre', () => {
    const l = armarLinea(vidrio, 1, { variante: medida });
    expect(l.precioUnitarioCentavos).toBe(800_000);
    expect(l.variantId).toBe('v1');
  });

  it('el ticket dice qué medida se llevó', () => {
    expect(armarLinea(vidrio, 1, { variante: medida }).descripcion).toBe(
      'Vidrio templado 9D — 6.7 pulgadas',
    );
  });

  it('no arma una línea con una variación dada de baja', () => {
    expect(() => armarLinea(vidrio, 1, { variante: { ...medida, activo: false } })).toThrow(
      ErrorCarrito,
    );
  });

  it('en dólares el precio lo sigue calculando el sistema', () => {
    const iphone: ProductoVendible = {
      ...vidrio,
      moneda: 'USD',
      precioUsdCentavos: 137_000,
      precioCentavos: 0,
    };
    // La variación dice $6.300; el sistema cobra USD 1.370 al cambio.
    const l = armarLinea(iphone, 1, {
      tcCentavos: 157_100,
      variante: { ...medida, precioCentavos: 6_300_00 },
    });
    expect(l.precioUnitarioCentavos).toBe(215_200_000);
  });
});

describe('stockDisponible con variación', () => {
  const p: ProductoVendible = {
    id: 'p1',
    nombre: 'Vidrio',
    precioCentavos: 500_000,
    moneda: 'ARS',
    precioUsdCentavos: null,
    precioEditable: false,
    gestionaStock: true,
    stock: 40,
    stockComprometido: 5,
  };
  const v: VarianteVendible = {
    id: 'v1',
    nombre: '6.7',
    precioCentavos: 800_000,
    gestionaStock: true,
    stock: 3,
    activo: true,
  };

  it('manda el de la variación cuando lleva stock propio', () => {
    expect(stockDisponible(p, v)).toBe(3);
  });

  it('manda el del padre cuando la variación hereda', () => {
    expect(stockDisponible(p, { ...v, gestionaStock: false })).toBe(35);
  });

  it('sin variación, el del producto', () => {
    expect(stockDisponible(p)).toBe(35);
  });
});
