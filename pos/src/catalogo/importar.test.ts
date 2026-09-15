/**
 * Tests de la importación masiva.
 *
 * Dos cosas que probar: que lea planillas reales —las que exporta Excel en
 * español, con punto y coma y comillas— y que la revisión diga la verdad sobre
 * lo que va a pasar antes de escribir nada.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { products, users } from '@/db/schema';
import {
  ErrorImportar,
  importarPlanilla,
  leerCsv,
  PLANILLA_DE_EJEMPLO,
  revisarPlanilla,
  TOPE_RENGLONES,
} from './importar';
import { crearProducto } from './crear';

let db: TestDb;
let duenio: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);
  const [u] = await db.insert(users).values({ nombre: 'Lucas', rol: 'owner' }).returning();
  duenio = u!.id;
});

describe('leer la planilla', () => {
  it('lee el punto y coma, que es lo que exporta Excel en español', () => {
    const filas = leerCsv('nombre;precio\nCable;1200');
    expect(filas).toEqual([
      ['nombre', 'precio'],
      ['Cable', '1200'],
    ]);
  });

  it('lee la coma también', () => {
    expect(leerCsv('nombre,precio\nCable,1200')[1]).toEqual(['Cable', '1200']);
  });

  it('respeta las comillas y las comas de adentro', () => {
    const filas = leerCsv('nombre,precio\n"Cable tipo C, 2 metros",1200');
    expect(filas[1]).toEqual(['Cable tipo C, 2 metros', '1200']);
  });

  it('entiende las comillas escapadas', () => {
    expect(leerCsv('a\n"Pantalla ""AAA"""')[1]).toEqual(['Pantalla "AAA"']);
  });

  it('se come el BOM que mete Excel y los saltos de Windows', () => {
    expect(leerCsv('﻿nombre;precio\r\nCable;1200')[0]).toEqual(['nombre', 'precio']);
  });

  it('saltea los renglones vacíos del final', () => {
    expect(leerCsv('nombre;precio\nCable;1200\n\n\n')).toHaveLength(2);
  });
});

describe('la revisión previa', () => {
  it('cuenta las altas y devuelve los datos leídos', async () => {
    const r = await revisarPlanilla(db, PLANILLA_DE_EJEMPLO);

    expect(r.altas).toBe(3);
    expect(r.repetidos).toBe(0);
    expect(r.rechazados).toBe(0);

    const primero = r.renglones[0]!;
    expect(primero.nombre).toBe('Cable USB tipo C 2 metros');
    expect(primero.precioCentavos).toBe(12_000_00);
    expect(primero.stock).toBe(20);
    expect(primero.marca).toBe('FoxBox');
  });

  /* La revisión no escribe: es el punto de toda la pantalla previa. */
  it('no toca la base', async () => {
    await revisarPlanilla(db, PLANILLA_DE_EJEMPLO);
    expect(await db.select().from(products)).toHaveLength(0);
  });

  it('acepta los nombres de columna que use la planilla que venga', async () => {
    const r = await revisarPlanilla(db, 'Producto;Rubro;Importe;Cantidad\nCable;Cables;1200;3');
    expect(r.altas).toBe(1);
    expect(r.renglones[0]!.categoria).toBe('Cables');
    expect(r.renglones[0]!.stock).toBe(3);
  });

  it('avisa qué categorías de la planilla no están en el catálogo', async () => {
    const r = await revisarPlanilla(db, 'nombre;categoria;precio\nReloj;Smartwatches;90000');
    expect(r.categoriasNuevas).toEqual(['Smartwatches']);
  });

  it('marca como repetido lo que ya está cargado', async () => {
    await crearProducto(db, {
      nombre: 'Cable USB tipo C 2 metros',
      categoria: 'Cables de carga',
      precioCentavos: 11_000_00,
      usuarioId: duenio,
    });

    const r = await revisarPlanilla(db, PLANILLA_DE_EJEMPLO);
    expect(r.altas).toBe(2);
    expect(r.repetidos).toBe(1);
    expect(r.renglones[0]!.motivo).toMatch(/Ya hay un producto/);
  });

  /* La planilla del distribuidor suele traer el mismo artículo dos veces. */
  it('el mismo renglón dos veces en la planilla entra una sola', async () => {
    const csv = 'nombre;precio\nCable tipo C;1200\nCable tipo C;1200';
    const r = await revisarPlanilla(db, csv);
    expect(r.altas).toBe(1);
    expect(r.repetidos).toBe(1);
  });

  it('un SKU repetido dentro de la misma planilla también', async () => {
    const csv = 'nombre;sku;precio\nCable A;X-1;1200\nCable B;X-1;1300';
    const r = await revisarPlanilla(db, csv);
    expect(r.altas).toBe(1);
    expect(r.renglones[1]!.motivo).toMatch(/X-1 ya existe/);
  });
});

describe('lo que la revisión rechaza', () => {
  it('un renglón sin nombre', async () => {
    const r = await revisarPlanilla(db, 'nombre;precio\n;1200');
    expect(r.rechazados).toBe(1);
    expect(r.renglones[0]!.motivo).toMatch(/no tiene nombre/);
  });

  it('un precio que no es un número', async () => {
    const r = await revisarPlanilla(db, 'nombre;precio\nCable;a consultar');
    expect(r.rechazados).toBe(1);
  });

  it('un precio con ceros de más', async () => {
    const r = await revisarPlanilla(db, 'nombre;precio\nCable;900000000');
    expect(r.renglones[0]!.motivo).toMatch(/sobran ceros/);
  });

  it('un stock que no son unidades', async () => {
    const r = await revisarPlanilla(db, 'nombre;precio;stock\nCable;1200;dos cajas');
    expect(r.renglones[0]!.motivo).toMatch(/no es una cantidad/);
  });

  it('el renglón rechazado dice en qué línea está', async () => {
    const r = await revisarPlanilla(db, 'nombre;precio\nCable;1200\n;900');
    const malo = r.renglones.find((x) => x.destino === 'rechazado')!;
    expect(malo.linea).toBe(3);
  });

  it('una planilla sin encabezado reconocible no se procesa', async () => {
    await expect(revisarPlanilla(db, 'a;b;c\n1;2;3')).rejects.toThrow(ErrorImportar);
  });

  it('una planilla vacía', async () => {
    await expect(revisarPlanilla(db, 'nombre;precio')).rejects.toThrow(/vacía/);
  });

  it('una planilla que en realidad es una migración', async () => {
    const filas = ['nombre;precio'];
    for (let i = 0; i < TOPE_RENGLONES + 1; i += 1) filas.push(`Producto ${i};1000`);
    await expect(revisarPlanilla(db, filas.join('\n'))).rejects.toThrow(/Partila en varias/);
  });
});

describe('importar de verdad', () => {
  it('da de alta lo que la revisión dijo, y nada más', async () => {
    const r = await importarPlanilla(db, PLANILLA_DE_EJEMPLO, duenio);

    expect(r.creados).toBe(3);
    expect(r.salteados).toBe(0);
    expect(r.fallidos).toEqual([]);

    const cargados = await db.select().from(products);
    expect(cargados).toHaveLength(3);
    expect(cargados.every((p) => p.fichaIncompleta)).toBe(true);
    expect(cargados.every((p) => p.wooId === null)).toBe(true);
  });

  it('respeta el SKU que trae la planilla y arma los que faltan', async () => {
    await importarPlanilla(db, PLANILLA_DE_EJEMPLO, duenio);
    const cargados = await db.select().from(products);

    const conSku = cargados.find((p) => p.nombre === 'Cargador 30W tipo C')!;
    expect(conSku.sku).toBe('CAR-BASE-30W');

    const sinSku = cargados.find((p) => p.nombre === 'Funda silicona iPhone 15')!;
    expect(sinSku.sku).toBe('FND-GEN-FUNDASILIC');
  });

  it('un renglón malo no se lleva puesta la entrega entera', async () => {
    const csv = ['nombre;precio', 'Cable bueno;1200', ';900', 'Funda buena;800'].join('\n');
    const r = await importarPlanilla(db, csv, duenio);

    expect(r.creados).toBe(2);
    expect(r.salteados).toBe(1);
  });

  it('importar dos veces la misma planilla no duplica nada', async () => {
    await importarPlanilla(db, PLANILLA_DE_EJEMPLO, duenio);
    const segunda = await importarPlanilla(db, PLANILLA_DE_EJEMPLO, duenio);

    expect(segunda.creados).toBe(0);
    expect(segunda.salteados).toBe(3);
    expect(await db.select().from(products)).toHaveLength(3);
  });
});
