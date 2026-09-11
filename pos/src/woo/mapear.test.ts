import { describe, expect, it } from 'vitest';
import { mapearProducto, mapearVariante } from './mapear';
import { precioACentavos, wooProducto, wooVariacion } from './tipos';

const TC = 157_100; // $1.571,00

/** Arma una ficha de Woo con los valores por defecto que devuelve la API. */
function ficha(parcial: Record<string, unknown>) {
  return wooProducto.parse({
    id: 1,
    name: 'Producto',
    type: 'simple',
    status: 'publish',
    catalog_visibility: 'visible',
    manage_stock: true,
    stock_quantity: 5,
    categories: [],
    brands: [],
    images: [],
    meta_data: [],
    ...parcial,
  });
}

describe('precioACentavos', () => {
  it('convierte el string que devuelve Woo', () => {
    expect(precioACentavos('5000.00')).toBe(500_000);
    expect(precioACentavos('2152000')).toBe(215_200_000);
  });

  it('trata el precio vacio como cero en vez de NaN', () => {
    expect(precioACentavos('')).toBe(0);
    expect(precioACentavos(null)).toBe(0);
    expect(precioACentavos(undefined)).toBe(0);
    expect(precioACentavos('no es un numero')).toBe(0);
  });
});

describe('mapearProducto', () => {
  it('mapea una ficha sana sin avisos', () => {
    const { fila, avisos } = mapearProducto(
      ficha({
        id: 6485,
        name: 'Vidrio templado 9D | glass 9d',
        sku: '531',
        price: '5000',
        stock_quantity: 53,
        categories: [{ name: 'Vidrios templados e hidrogel' }],
        brands: [{ name: 'Genérico' }],
        images: [{ src: 'https://ejemplo/vidrio.jpg' }],
      }),
      TC,
    );

    expect(fila.sku).toBe('531');
    expect(fila.precioCentavos).toBe(500_000);
    expect(fila.moneda).toBe('ARS');
    expect(fila.categoria).toBe('Vidrios templados e hidrogel');
    expect(fila.marca).toBe('Genérico');
    expect(fila.fichaIncompleta).toBe(false);
    expect(avisos).toHaveLength(0);
  });

  it('reconoce un iPhone en dolares por la meta del plugin de cotizacion', () => {
    const { fila, avisos } = mapearProducto(
      ficha({
        id: 7001,
        name: 'iPhone 14 Pro 256GB',
        sku: 'IP14P256',
        price: '2152000',
        images: [{ src: 'https://ejemplo/iphone.jpg' }],
        meta_data: [{ key: '_li_precio_usd', value: '1370' }],
      }),
      TC,
    );

    expect(fila.moneda).toBe('USD');
    expect(fila.precioUsdCentavos).toBe(137_000);
    expect(fila.precioCentavos).toBe(215_200_000);
    expect(avisos).toHaveLength(0);
  });

  it('detecta el error de agosto: 9 iPhones de USD 6.300 publicados a $6.300', () => {
    const { avisos } = mapearProducto(
      ficha({
        id: 7002,
        name: 'iPhone 15 Pro Max 1TB',
        sku: 'IP15PM1T',
        price: '6300',
        images: [{ src: 'https://ejemplo/x.jpg' }],
        meta_data: [{ key: '_li_precio_usd', value: '6300' }],
      }),
      TC,
    );

    expect(avisos.map((a) => a.tipo)).toContain('usd_incoherente');
    expect(avisos[0]!.detalle).toMatch(/9897000/);
  });

  it('avisa cuando el USD esta cargado pero el precio en pesos quedo vacio', () => {
    const { avisos } = mapearProducto(
      ficha({
        id: 7003,
        name: 'iPhone 13',
        sku: 'IP13',
        price: '',
        images: [{ src: 'https://ejemplo/x.jpg' }],
        meta_data: [{ key: '_li_precio_usd', value: '520' }],
      }),
      TC,
    );
    expect(avisos.map((a) => a.tipo)).toContain('usd_sin_conversion');
  });

  it('marca los 32 productos a $1 como precio sin cargar', () => {
    const { fila, avisos } = mapearProducto(
      ficha({ id: 6378, name: 'Atma cup cake maker CM8910E', sku: '314', price: '1' }),
      TC,
    );
    expect(avisos.map((a) => a.tipo)).toContain('sin_precio');
    expect(fila.fichaIncompleta).toBe(true);
  });

  it('marca el stock ficticio de 9.708 unidades', () => {
    const { avisos } = mapearProducto(
      ficha({ id: 6485, name: 'Vidrio templado', sku: '531', price: '5000', stock_quantity: 9708 }),
      TC,
    );
    expect(avisos.map((a) => a.tipo)).toContain('stock_ficticio');
  });

  it('marca ficha incompleta cuando falta SKU o imagen', () => {
    const { fila, avisos } = mapearProducto(
      ficha({ id: 900, name: 'Cargador', sku: '', price: '12000' }),
      TC,
    );
    expect(fila.fichaIncompleta).toBe(true);
    expect(avisos.map((a) => a.tipo)).toEqual(expect.arrayContaining(['sin_sku', 'sin_imagen']));
  });

  it('un producto de servicio queda sin stock y con precio editable (D24)', () => {
    const { fila } = mapearProducto(
      ficha({
        id: 9001,
        name: 'Limpieza de equipo',
        sku: 'SERV-LIMP',
        price: '14750',
        manage_stock: false,
        categories: [{ name: 'Servicio técnico' }],
        images: [{ src: 'https://ejemplo/serv.jpg' }],
      }),
      TC,
    );
    expect(fila.esServicio).toBe(true);
    expect(fila.precioEditable).toBe(true);
    expect(fila.gestionaStock).toBe(false);
    expect(fila.stock).toBe(0);
  });

  it('un borrador de Woo queda inactivo en el espejo', () => {
    const { fila } = mapearProducto(
      ficha({ id: 42, name: 'Borrador', sku: 'X', price: '10000', status: 'draft' }),
      TC,
    );
    expect(fila.activo).toBe(false);
  });

  it('sin cotizacion vigente no revienta: solo no verifica el precio en pesos', () => {
    const { fila, avisos } = mapearProducto(
      ficha({
        id: 7004,
        name: 'iPhone 12',
        sku: 'IP12',
        price: '900000',
        images: [{ src: 'https://ejemplo/x.jpg' }],
        meta_data: [{ key: '_li_precio_usd', value: '600' }],
      }),
      null,
    );
    expect(fila.moneda).toBe('USD');
    expect(avisos).toHaveLength(0);
  });
});

describe('mapearVariante', () => {
  it('arma el nombre a partir de los atributos', () => {
    const v = mapearVariante(
      wooVariacion.parse({
        id: 8801,
        sku: 'VID-IP14',
        price: '5000',
        stock_quantity: 12,
        status: 'publish',
        attributes: [{ name: 'Modelo', option: 'iPhone 14' }],
      }),
    );
    expect(v.nombre).toBe('iPhone 14');
    expect(v.atributos).toEqual({ Modelo: 'iPhone 14' });
    expect(v.precioCentavos).toBe(500_000);
  });
});
