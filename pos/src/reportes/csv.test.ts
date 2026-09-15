/**
 * Tests de la exportación a planilla.
 *
 * El destino es Excel en castellano. Lo que se prueba es justamente lo que un
 * CSV «correcto» haría distinto: punto y coma, BOM y decimales con coma. Sin
 * esas tres cosas, el archivo se abre roto y nadie lo usa dos veces.
 */
import { describe, expect, it } from 'vitest';
import {
  armarCsv,
  BOM,
  cabecerasDeDescarga,
  celda,
  fechaParaPlanilla,
  montoParaPlanilla,
  nombreDeArchivo,
} from './csv';
import { leerCsv } from '@/catalogo/importar';

describe('las celdas', () => {
  it('lo simple va sin comillas: el archivo se lee a ojo si hace falta', () => {
    expect(celda('Cable tipo C')).toBe('Cable tipo C');
    expect(celda(42)).toBe('42');
  });

  it('entrecomilla solo cuando hay algo que romper la fila', () => {
    expect(celda('Funda; reforzada')).toBe('"Funda; reforzada"');
    expect(celda('Pantalla "AAA"')).toBe('"Pantalla ""AAA"""');
    expect(celda('Dos\nrenglones')).toBe('"Dos\nrenglones"');
  });

  it('lo que no está queda vacío, no «null»', () => {
    expect(celda(null)).toBe('');
    expect(celda(undefined)).toBe('');
  });
});

describe('los montos', () => {
  /* Con punto, Excel lo toma como texto y no se puede sumar la columna. */
  it('van con coma decimal, que es lo que Excel en castellano suma', () => {
    expect(montoParaPlanilla(12_500_50)).toBe('12500,50');
    expect(montoParaPlanilla(9_000_00)).toBe('9000,00');
    expect(montoParaPlanilla(5)).toBe('0,05');
    expect(montoParaPlanilla(0)).toBe('0,00');
  });

  it('sin separador de miles: el que separa es Excel, no nosotros', () => {
    expect(montoParaPlanilla(1_380_000_00)).toBe('1380000,00');
  });

  it('un negativo mantiene el signo adelante', () => {
    expect(montoParaPlanilla(-12_500_50)).toBe('-12500,50');
  });
});

describe('las fechas', () => {
  /*
   * Van en dos columnas porque en una planilla se filtra y se agrupa por fecha,
   * y «15/09/2026 18:42» no deja hacer ninguna de las dos cosas.
   */
  it('se parten en fecha y hora, en el huso del local', () => {
    const r = fechaParaPlanilla(new Date('2026-09-15T18:42:00Z'));
    expect(r.fecha).toBe('15/09/2026');
    expect(r.hora).toBe('15:42');
  });

  it('una venta de la noche queda en el día que se hizo', () => {
    const r = fechaParaPlanilla(new Date('2026-09-16T01:30:00Z'));
    expect(r.fecha).toBe('15/09/2026');
    expect(r.hora).toBe('22:30');
  });
});

describe('el archivo entero', () => {
  const csv = armarCsv(
    ['Numero', 'Producto', 'Total'],
    [
      ['T1-000001', 'Cable tipo C', montoParaPlanilla(12_000_00)],
      ['T1-000002', 'Funda; con punto y coma', montoParaPlanilla(9_500_00)],
    ],
  );

  it('arranca con el BOM, si no Excel rompe los acentos', () => {
    expect(csv.startsWith(BOM)).toBe(true);
  });

  it('separa con punto y coma y corta con saltos de Windows', () => {
    expect(csv).toContain('Numero;Producto;Total');
    expect(csv).toContain('\r\n');
  });

  /*
   * El mismo dialecto que lee la importación de productos: lo que sale de acá
   * se puede volver a cargar sin convertir nada por el camino.
   */
  it('lo vuelve a leer el importador del propio POS', () => {
    const filas = leerCsv(csv);
    expect(filas[0]).toEqual(['Numero', 'Producto', 'Total']);
    expect(filas[1]).toEqual(['T1-000001', 'Cable tipo C', '12000,00']);
    expect(filas[2]![1]).toBe('Funda; con punto y coma');
  });

  it('un archivo sin filas igual trae el encabezado', () => {
    const vacio = armarCsv(['Numero', 'Total'], []);
    expect(leerCsv(vacio)).toEqual([['Numero', 'Total']]);
  });
});

describe('el nombre y la descarga', () => {
  it('lleva las fechas en forma ISO, así la carpeta se ordena sola', () => {
    expect(nombreDeArchivo('ventas', '2026-09-01', '2026-09-15')).toBe(
      'ventas-2026-09-01-a-2026-09-15.csv',
    );
  });

  it('un solo día no repite la fecha', () => {
    expect(nombreDeArchivo('ventas', '2026-09-15', '2026-09-15')).toBe('ventas-2026-09-15.csv');
  });

  it('el navegador lo baja en vez de mostrarlo', () => {
    const h = cabecerasDeDescarga('ventas-2026-09-15.csv');
    expect(h['Content-Disposition']).toContain('attachment');
    expect(h['Content-Type']).toContain('charset=utf-8');
    expect(h['Cache-Control']).toBe('no-store');
  });
});
