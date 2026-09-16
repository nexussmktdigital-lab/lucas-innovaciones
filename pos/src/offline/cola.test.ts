/**
 * Tests de la cola de ventas cobradas sin conexion (D56).
 *
 * Son funciones puras: lo que decide si una venta se reintenta sola o tiene que
 * verla una persona, y cómo se la nombra en la lista. La parte que habla con
 * IndexedDB no se prueba acá —no existe fuera del navegador— y la cubre el test
 * de punta a punta.
 */
import { describe, expect, it } from 'vitest';
import { convieneReintentar, resumirVenta, tieneAvisos } from './cola';

describe('como se nombra una venta en la cola', () => {
  it('con un solo renglon, ese renglon', () => {
    expect(resumirVenta([{ descripcion: 'Vidrio templado 9D', cantidad: 2 }])).toBe(
      '2 × Vidrio templado 9D',
    );
  });

  it('con varios, el primero y cuantos faltan', () => {
    expect(
      resumirVenta([
        { descripcion: 'Vidrio templado 9D', cantidad: 2 },
        { descripcion: 'Funda antigolpe', cantidad: 1 },
        { descripcion: 'Cargador', cantidad: 1 },
      ]),
    ).toBe('2 × Vidrio templado 9D y 2 más');
  });

  it('una venta sin renglones no rompe la lista', () => {
    expect(resumirVenta([])).toBe('Venta sin renglones');
  });
});

describe('que se reintenta solo y que no', () => {
  /*
   * La distinción evita el peor final posible: una cola que reintenta en loop
   * y nunca avisa que hay plata cobrada sin registrar.
   */
  it('un corte de red se reintenta', () => {
    expect(convieneReintentar('No se pudo subir la venta. Sigue guardada: probá de nuevo.')).toBe(
      true,
    );
    expect(convieneReintentar('Failed to fetch')).toBe(true);
  });

  it('lo que no se arregla reintentando, no se reintenta', () => {
    expect(convieneReintentar('No hay una caja abierta. Abrí la caja antes de vender.')).toBe(false);
    expect(
      convieneReintentar('El producto ya no está en el catálogo. Quitalo del carrito.'),
    ).toBe(false);
    expect(convieneReintentar('No tenés permiso para vender.')).toBe(false);
    expect(convieneReintentar('Se cerró la sesión. Volvé a entrar.')).toBe(false);
  });
});

describe('que venta entro con algo para mirar', () => {
  it('la que entro limpia, ninguna', () => {
    expect(tieneAvisos({ desvioCentavos: 0, dejoStockEnRojo: false })).toBe(false);
  });

  it('un precio distinto del catalogo, en cualquier direccion', () => {
    expect(tieneAvisos({ desvioCentavos: -50_000, dejoStockEnRojo: false })).toBe(true);
    expect(tieneAvisos({ desvioCentavos: 50_000, dejoStockEnRojo: false })).toBe(true);
  });

  it('el stock en negativo', () => {
    expect(tieneAvisos({ desvioCentavos: 0, dejoStockEnRojo: true })).toBe(true);
  });
});
