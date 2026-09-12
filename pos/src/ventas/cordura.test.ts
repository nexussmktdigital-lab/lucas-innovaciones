import { describe, expect, it } from 'vitest';
import {
  explicarSospechas,
  pisoPara,
  revisarLinea,
  revisarVenta,
  type ProductoAValidar,
} from './cordura';

function producto(p: Partial<ProductoAValidar> = {}): ProductoAValidar {
  return {
    nombre: 'iPhone 14 Pro 256GB',
    categoria: 'Smartphones nuevos',
    marca: 'Apple',
    moneda: 'ARS',
    precioUsdCentavos: null,
    ...p,
  };
}

describe('pisoPara', () => {
  it('un smartphone tiene piso', () => {
    expect(pisoPara(producto({ marca: null }))).toBe(50_000_00);
  });

  it('un accesorio no tiene piso: la mayoría del catálogo son cables y vidrios', () => {
    expect(
      pisoPara(producto({ nombre: 'Cable USB tipo C', categoria: 'Cables de carga', marca: null })),
    ).toBeNull();
  });

  it('no distingue acentos ni mayúsculas en la categoría', () => {
    expect(pisoPara(producto({ categoria: 'SMARTPHONES NUEVOS', marca: null }))).toBe(50_000_00);
  });

  it('cuando aplican categoría y marca, manda el piso más alto', () => {
    // Apple pone 20.000 y Smartphones 50.000: gana el de la categoría.
    expect(pisoPara(producto())).toBe(50_000_00);
    // Sin categoría con piso propio ni de accesorio, queda el de Apple.
    expect(pisoPara(producto({ categoria: 'Equipos varios' }))).toBe(20_000_00);
  });

  it('un producto sin categoría ni marca no tiene piso', () => {
    expect(pisoPara(producto({ categoria: null, marca: null }))).toBeNull();
  });
});

describe('revisarLinea', () => {
  it('detecta el error de agosto: un iPhone cargado en pesos con la cifra del dólar', () => {
    // US$ 6.300 tipeado como $6.300.
    const s = revisarLinea(producto({ nombre: 'iPhone 15 Pro Max 1TB' }), 6_300_00);

    expect(s).not.toBeNull();
    expect(s!.pisoCentavos).toBe(50_000_00);
    expect(s!.motivo).toMatch(/cifra en dólares/);
    expect(s!.motivo).toMatch(/agosto/);
  });

  it('deja pasar un smartphone con precio normal', () => {
    expect(revisarLinea(producto(), 213_900_000)).toBeNull();
    expect(revisarLinea(producto({ marca: 'Samsung' }), 41_000_000)).toBeNull();
  });

  it('deja pasar un accesorio barato: no tiene piso', () => {
    expect(
      revisarLinea(
        producto({ nombre: 'Vidrio templado', categoria: 'Vidrios templados', marca: null }),
        5_000_00,
      ),
    ).toBeNull();
  });

  it('un producto en dólares con precio en dólares absurdo también salta', () => {
    // Alguien cargó US$ 6,30 en vez de US$ 630: el sistema calcula $9.800.
    const s = revisarLinea(
      producto({ moneda: 'USD', precioUsdCentavos: 630 }),
      9_800_00,
    );
    expect(s).not.toBeNull();
    expect(s!.motivo).toMatch(/US\$ 6,3/);
    expect(s!.motivo).toMatch(/WooCommerce/);
  });

  it('justo en el piso no salta', () => {
    expect(revisarLinea(producto({ marca: null }), 50_000_00)).toBeNull();
    expect(revisarLinea(producto({ marca: null }), 49_999_99)).not.toBeNull();
  });
});

describe('revisarVenta', () => {
  it('devuelve solo las líneas sospechosas', () => {
    const sospechas = revisarVenta([
      { producto: producto({ nombre: 'iPhone barato' }), precioCentavos: 6_300_00 },
      {
        producto: producto({ nombre: 'Vidrio', categoria: 'Vidrios', marca: null }),
        precioCentavos: 5_000_00,
      },
      { producto: producto({ nombre: 'iPhone caro' }), precioCentavos: 213_900_000 },
    ]);

    expect(sospechas).toHaveLength(1);
    expect(sospechas[0]!.descripcion).toBe('iPhone barato');
  });

  it('una venta sana no devuelve nada', () => {
    expect(revisarVenta([{ producto: producto(), precioCentavos: 213_900_000 }])).toEqual([]);
  });
});

describe('explicarSospechas', () => {
  it('arma un cartel legible para una sola', () => {
    const texto = explicarSospechas(
      revisarVenta([{ producto: producto({ nombre: 'iPhone 15' }), precioCentavos: 6_300_00 }]),
    );
    expect(texto).toMatch(/^Hay un producto con un precio sospechoso:/);
    expect(texto).toContain('iPhone 15');
    expect(texto).toContain('6.300');
    expect(texto).toContain('50.000');
  });

  it('cuenta cuando son varias', () => {
    const texto = explicarSospechas(
      revisarVenta([
        { producto: producto({ nombre: 'A' }), precioCentavos: 100 },
        { producto: producto({ nombre: 'B' }), precioCentavos: 200 },
      ]),
    );
    expect(texto).toMatch(/^Hay 2 productos con precios sospechosos:/);
  });
});

describe('falsos positivos', () => {
  /**
   * Apple vende cables y cargadores además de teléfonos. Marcar un cable de
   * $13.000 como sospechoso solo entrena al cajero a ignorar el cartel, que es
   * peor que no tenerlo.
   */
  it('un cable Lightning de Apple a $13.000 no es sospechoso', () => {
    const cable = producto({
      nombre: 'Cable USB TRV iPhone Lightning',
      categoria: 'Cables de carga',
      marca: 'Apple',
    });
    expect(pisoPara(cable)).toBeNull();
    expect(revisarLinea(cable, 13_000_00)).toBeNull();
  });

  it('tampoco lo son los accesorios baratos de marca', () => {
    const casos: [string, string][] = [
      ['Fuente iPhone 20w tipo C original', 'Cargadores de pared'],
      ['Funda iPhone 14', 'Fundas'],
      ['Vidrio templado iPhone', 'Vidrios templados e hidrogel'],
      ['AirPods Pro', 'Auriculares inalámbricos'],
      ['Pendrive', 'Almacenamiento'],
    ];
    for (const [nombre, categoria] of casos) {
      expect(revisarLinea(producto({ nombre, categoria, marca: 'Apple' }), 6_500_00)).toBeNull();
    }
  });

  it('pero un iPhone mal categorizado como accesorio tampoco se pierde del todo', () => {
    // Sin categoría de accesorio, la marca sí aporta el piso.
    const s = revisarLinea(
      producto({ nombre: 'iPhone 15', categoria: 'Sin categoría', marca: 'Apple' }),
      6_300_00,
    );
    expect(s).not.toBeNull();
  });

  it('un chip de telefonía a $2.205 no es sospechoso', () => {
    expect(
      revisarLinea(
        producto({ nombre: 'Chip Claro prepago', categoria: 'Telefonía', marca: 'Claro' }),
        2_205_00,
      ),
    ).toBeNull();
  });
});
