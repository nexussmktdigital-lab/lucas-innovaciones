/**
 * Tests del alta de productos: SKU y limpieza de titulo.
 *
 * Son funciones puras, asi que no hace falta base. Lo que se prueba es que el
 * SKU se parezca a los del catalogo real y que la limpieza saque las notas del
 * vendedor sin comerse partes del nombre.
 */
import { describe, expect, it } from 'vitest';
import { ErrorAlta, limpiarTitulo, prefijoDe, sugerirSku, trozoDeMarca } from './alta';

describe('el prefijo de categoría', () => {
  it('usa el del catálogo cuando la categoría se conoce', () => {
    expect(prefijoDe('Almacenamiento')).toBe('ALM');
    expect(prefijoDe('Vidrios templados e hidrogel')).toBe('VID');
    expect(prefijoDe('Cargadores de pared')).toBe('CAR');
  });

  it('no se marea con acentos ni mayúsculas', () => {
    expect(prefijoDe('SERVICIO TÉCNICO')).toBe('SERV');
    expect(prefijoDe('Auriculares Inalámbricos')).toBe('AUR');
  });

  it('con una categoría nueva toma las tres primeras letras', () => {
    expect(prefijoDe('Relojes inteligentes')).toBe('REL');
  });

  it('sin categoría, genérico', () => {
    expect(prefijoDe(null)).toBe('GEN');
    expect(prefijoDe('')).toBe('GEN');
  });
});

describe('el trozo de marca', () => {
  it('son las primeras cuatro letras, en mayúscula', () => {
    expect(trozoDeMarca('Hiksemi')).toBe('HIKS');
    expect(trozoDeMarca('Apple')).toBe('APPL');
  });

  it('sin marca es GEN, como en el catálogo', () => {
    expect(trozoDeMarca(null)).toBe('GEN');
  });

  it('ignora espacios y signos', () => {
    expect(trozoDeMarca('Fox Box')).toBe('FOXB');
  });
});

describe('el SKU sugerido', () => {
  it('sigue la convención CATEGORÍA-MARCA-NOMBRE', () => {
    const sku = sugerirSku({
      nombre: 'Pendrive 64GB',
      categoria: 'Almacenamiento',
      marca: 'Hiksemi',
    });
    expect(sku).toBe('ALM-HIKS-PENDRIVE64');
  });

  it('esquiva los que ya existen agregando un número', () => {
    const uno = sugerirSku({ nombre: 'Funda común', categoria: 'Fundas' });
    expect(uno).toBe('FND-GEN-FUNDACOMUN');

    const dos = sugerirSku({ nombre: 'Funda común', categoria: 'Fundas' }, [uno]);
    expect(dos).toBe('FND-GEN-FUNDACOMUN-2');

    const tres = sugerirSku({ nombre: 'Funda común', categoria: 'Fundas' }, [uno, dos]);
    expect(tres).toBe('FND-GEN-FUNDACOMUN-3');
  });

  it('compara sin distinguir mayúsculas', () => {
    const sku = sugerirSku({ nombre: 'Funda común', categoria: 'Fundas' }, ['fnd-gen-fundacomun']);
    expect(sku).toBe('FND-GEN-FUNDACOMUN-2');
  });

  it('sin nombre no hay SKU', () => {
    expect(() => sugerirSku({ nombre: '   ' })).toThrow(ErrorAlta);
  });
});

describe('limpiar el título', () => {
  /*
   * Los tres casos son títulos publicados del catálogo real, con precios de
   * compra y nombres de clientes adentro.
   */
  it('saca el precio de compra y el margen', () => {
    const r = limpiarTitulo('iPhone 13 128gb 86% (54265) (Rec en enero $290, hoy a $250)');
    expect(r.titulo).toBe('iPhone 13 128gb 86% (54265)');
    expect(r.notaInterna).toBe('Rec en enero $290, hoy a $250');
  });

  it('saca el nombre del cliente cuando viene con plata', () => {
    const r = limpiarTitulo('iPhone 15 128gb 87% (08331) (Pia, cambio glass idrop $390)');
    expect(r.titulo).toBe('iPhone 15 128gb 87% (08331)');
    expect(r.notaInterna).toBe('Pia, cambio glass idrop $390');
  });

  it('junta varias notas en una sola', () => {
    const r = limpiarTitulo('iPhone 11 (Tello) (bat idrop $365)');
    expect(r.titulo).toBe('iPhone 11 (Tello)');
    expect(r.notaInterna).toBe('bat idrop $365');
  });

  /*
   * Lo importante del otro lado: un paréntesis que es parte del nombre se
   * queda. Sacarlo sería peor que dejar la nota.
   */
  it('no toca los paréntesis que son parte del nombre', () => {
    expect(limpiarTitulo('Servicio técnico · Reparación (a presupuestar)').titulo).toBe(
      'Servicio técnico · Reparación (a presupuestar)',
    );
    expect(limpiarTitulo('Cable tipo C (1 metro)').notaInterna).toBeNull();
  });

  it('normaliza los espacios de más', () => {
    expect(limpiarTitulo('  Funda   común  ').titulo).toBe('Funda común');
  });

  it('si el título era solo la nota, lo deja como estaba', () => {
    const r = limpiarTitulo('($250)');
    expect(r.titulo).toBe('($250)');
    expect(r.notaInterna).toBeNull();
  });

  it('un nombre vacío no pasa', () => {
    expect(() => limpiarTitulo('   ')).toThrow(ErrorAlta);
  });
});
