import { describe, expect, it } from 'vitest';
import { cuerpoDePrecioParaWoo, mapearProducto, mapearVariante } from './mapear';
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

  it('reconoce un iPhone en dolares por la marca del plugin', () => {
    const { fila, avisos } = mapearProducto(
      ficha({
        id: 7001,
        name: 'iPhone 14 Pro 256GB',
        sku: 'IP14P256',
        // El numero de la ficha son DOLARES: la web los multiplica al renderizar.
        price: '1370',
        images: [{ src: 'https://ejemplo/iphone.jpg' }],
        meta_data: [{ key: '_li_moneda', value: 'USD' }],
      }),
      TC,
    );

    expect(fila.moneda).toBe('USD');
    expect(fila.precioUsdCentavos).toBe(137_000);
    // 1370 x 1571 = 2.152.270, redondeado al millar.
    expect(fila.precioCentavos).toBe(215_200_000);
    expect(fila.fichaIncompleta).toBe(false);
    expect(avisos).toHaveLength(0);
  });

  /*
   * El bug que esto cierra, que estuvo en produccion una semana: el POS leia la
   * ficha de un iPhone de US$ 630 y mostraba $630 en el mostrador. No estaba
   * mal cargada: el POS buscaba otra meta —`_li_precio_usd`, que no tiene
   * ninguna ficha— y al no encontrarla tomaba el 630 de la ficha como pesos.
   */
  it('un iPhone de US$ 630 no se lee como $630', () => {
    const { fila, avisos } = mapearProducto(
      ficha({
        id: 7002,
        name: 'iPhone 13 128GB usado',
        sku: 'IP13-128-U',
        price: '630',
        images: [{ src: 'https://ejemplo/x.jpg' }],
        meta_data: [{ key: '_li_moneda', value: 'USD' }],
      }),
      TC,
    );

    expect(fila.precioUsdCentavos).toBe(63_000);
    expect(fila.precioCentavos).toBe(99_000_000); // $990.000, no $630
    // Y no se lo confunde con una ficha a medio cargar por tener pocos pesos.
    expect(fila.fichaIncompleta).toBe(false);
    expect(avisos).toHaveLength(0);
  });

  it('la marca del plugin no distingue mayusculas', () => {
    const { fila } = mapearProducto(
      ficha({
        id: 7005,
        name: 'iPhone 11',
        sku: 'IP11',
        price: '380',
        images: [{ src: 'https://ejemplo/x.jpg' }],
        meta_data: [{ key: '_li_moneda', value: 'usd' }],
      }),
      TC,
    );
    expect(fila.moneda).toBe('USD');
  });

  it('avisa cuando la ficha esta marcada en dolares pero sin precio cargado', () => {
    const { fila, avisos } = mapearProducto(
      ficha({
        id: 7003,
        name: 'iPhone 13',
        sku: 'IP13',
        price: '',
        images: [{ src: 'https://ejemplo/x.jpg' }],
        meta_data: [{ key: '_li_moneda', value: 'USD' }],
      }),
      TC,
    );
    expect(avisos.map((a) => a.tipo)).toContain('usd_sin_conversion');
    // Sin numero no hay moneda que respetar: queda como ficha sin precio.
    expect(fila.moneda).toBe('ARS');
    expect(fila.precioUsdCentavos).toBe(null);
    expect(fila.fichaIncompleta).toBe(true);
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

  /*
   * Sin cotizacion los pesos quedan en cero, y es a proposito: el unico numero
   * que hay es el de dolares, y escribirlo como si fueran pesos es justo el
   * error que esto arregla. La venta ya se niega a cobrar un producto en
   * dolares sin cotizacion, asi que nadie lo vende a $600.
   */
  it('sin cotizacion vigente el precio en pesos queda en cero y avisa', () => {
    const { fila, avisos } = mapearProducto(
      ficha({
        id: 7004,
        name: 'iPhone 12',
        sku: 'IP12',
        price: '600',
        images: [{ src: 'https://ejemplo/x.jpg' }],
        meta_data: [{ key: '_li_moneda', value: 'USD' }],
      }),
      null,
    );
    expect(fila.moneda).toBe('USD');
    expect(fila.precioUsdCentavos).toBe(60_000);
    expect(fila.precioCentavos).toBe(0);
    expect(avisos.map((a) => a.tipo)).toContain('usd_sin_conversion');
    // Le falta la cotizacion, no la ficha: no se lo manda a revisar carga.
    expect(fila.fichaIncompleta).toBe(false);
  });
});

describe('cuerpoDePrecioParaWoo', () => {
  it('en pesos manda pesos y limpia la marca del plugin', () => {
    expect(
      cuerpoDePrecioParaWoo({ moneda: 'ARS', precioCentavos: 1_250_000, precioUsdCentavos: null }),
    ).toEqual({ regular_price: '12500.00', meta_data: [{ key: '_li_moneda', value: '' }] });
  });

  /*
   * El numero que viaja son DOLARES. Mandarle los pesos a una ficha marcada en
   * dolares la publica multiplicada otra vez por la cotizacion: $990.000
   * leidos como US$ 990.000 son mil quinientos millones de pesos en la web.
   */
  it('en dolares manda dolares, no los pesos calculados', () => {
    expect(
      cuerpoDePrecioParaWoo({
        moneda: 'USD',
        precioCentavos: 99_000_000, // $990.000, lo que el POS muestra
        precioUsdCentavos: 63_000, // US$ 630, lo que la web tiene que guardar
      }),
    ).toEqual({ regular_price: '630.00', meta_data: [{ key: '_li_moneda', value: 'USD' }] });
  });

  it('marcado en dolares pero sin dolares cargados viaja en pesos y sin marca', () => {
    expect(
      cuerpoDePrecioParaWoo({ moneda: 'USD', precioCentavos: 1_250_000, precioUsdCentavos: null }),
    ).toEqual({ regular_price: '12500.00', meta_data: [{ key: '_li_moneda', value: '' }] });
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

describe('mapearVariante y el stock', () => {
  /**
   * En Woo, una variación puede traer `manage_stock: "parent"`. Tomar eso como
   * stock propio dejaba a los vidrios y las fundas con stock 0 y sin poder
   * venderse; tomarlo al revés descontaba dos veces la misma unidad.
   */
  function variacion(parcial: Record<string, unknown>) {
    return wooVariacion.parse({
      id: 8801,
      price: '5000',
      status: 'publish',
      attributes: [{ name: 'Modelo', option: 'iPhone 14' }],
      ...parcial,
    });
  }

  it('lleva stock propio solo con manage_stock en true', () => {
    expect(mapearVariante(variacion({ manage_stock: true, stock_quantity: 7 })).gestionaStock).toBe(
      true,
    );
  });

  it('«parent» significa que el stock lo lleva el producto padre', () => {
    const v = mapearVariante(variacion({ manage_stock: 'parent', stock_quantity: null }));
    expect(v.gestionaStock).toBe(false);
    expect(v.stock).toBe(0);
  });

  it('sin el campo, tampoco lleva stock propio', () => {
    expect(mapearVariante(variacion({})).gestionaStock).toBe(false);
  });
});
