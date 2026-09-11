import { beforeAll, describe, expect, it } from 'vitest';
import { crearBaseDePrueba, type TestDb } from '@/db/test-db';
import { productVariants, products } from '@/db/schema';
import { buscarProductos, pareceLectorDeCodigo } from './buscar';

let db: TestDb;
let vidrioId: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();

  const filas = await db
    .insert(products)
    .values([
      {
        wooId: 6485,
        nombre: 'Vidrio templado 9D | glass 9d',
        sku: '531',
        marca: 'Genérico',
        categoria: 'Vidrios templados e hidrogel',
        precioCentavos: 500_000,
        stock: 40,
        tipo: 'variable',
      },
      {
        wooId: 7001,
        nombre: 'iPhone 14 Pro 256GB',
        sku: 'IP14P-256',
        marca: 'Apple',
        moneda: 'USD',
        precioUsdCentavos: 137_000,
        precioCentavos: 213_900_000,
        stock: 1,
        codigoBarras: '190199267145',
      },
      {
        wooId: 7050,
        nombre: 'iPhone 11 64GB usado · IMEI 356938035643809',
        sku: 'IP11-USADO-1',
        marca: 'Apple',
        precioCentavos: 45_000_000,
        stock: 1,
      },
      {
        wooId: 6667,
        nombre: 'Pendrive Hiksemi 32GB',
        sku: 'ALM-HIKS-PENDRI32G',
        marca: 'Hiksemi',
        precioCentavos: 2_800_000,
        stock: 24,
      },
      {
        wooId: 6999,
        nombre: 'Motorola G54 sin stock',
        sku: 'MOT-G54',
        marca: 'Motorola',
        precioCentavos: 38_000_000,
        stock: 0,
      },
      {
        wooId: 6998,
        nombre: 'Producto despublicado',
        sku: 'OCULTO',
        precioCentavos: 100_000,
        stock: 5,
        activo: false,
      },
    ])
    .returning();

  vidrioId = filas[0]!.id;

  await db.insert(productVariants).values([
    {
      productId: vidrioId,
      wooId: 8801,
      nombre: 'iPhone 14',
      sku: 'VID-IP14',
      precioCentavos: 500_000,
      stock: 12,
      codigoBarras: '7790001234567',
    },
    {
      productId: vidrioId,
      wooId: 8802,
      nombre: 'Samsung A55',
      sku: 'VID-A55',
      precioCentavos: 500_000,
      stock: 7,
    },
  ]);
});

describe('buscarProductos', () => {
  it('encuentra por nombre', async () => {
    const r = await buscarProductos(db, 'pendrive');
    expect(r).toHaveLength(1);
    expect(r[0]!.nombre).toBe('Pendrive Hiksemi 32GB');
  });

  it('no distingue mayúsculas ni acentos', async () => {
    const conAcento = await buscarProductos(db, 'GENÉRICO');
    const sinAcento = await buscarProductos(db, 'generico');
    expect(conAcento.length).toBeGreaterThan(0);
    expect(sinAcento.length).toBe(conAcento.length);
  });

  it('encuentra por SKU', async () => {
    const r = await buscarProductos(db, 'ALM-HIKS');
    expect(r[0]!.sku).toBe('ALM-HIKS-PENDRI32G');
  });

  it('encuentra por marca', async () => {
    const r = await buscarProductos(db, 'apple');
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.every((x) => x.marca === 'Apple')).toBe(true);
  });

  it('encuentra por IMEI, que en este catálogo vive dentro del título', async () => {
    const r = await buscarProductos(db, '356938035643809');
    expect(r).toHaveLength(1);
    expect(r[0]!.sku).toBe('IP11-USADO-1');
  });

  it('el código de barras completo da coincidencia exacta y va primero', async () => {
    const r = await buscarProductos(db, '190199267145');
    expect(r[0]!.exacto).toBe(true);
    expect(r[0]!.sku).toBe('IP14P-256');
  });

  it('devuelve cada variación como un resultado propio', async () => {
    const r = await buscarProductos(db, 'vidrio templado');
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.nombre).sort()).toEqual([
      'Vidrio templado 9D | glass 9d — Samsung A55',
      'Vidrio templado 9D | glass 9d — iPhone 14',
    ]);
    expect(r.every((x) => x.variantId !== null)).toBe(true);
  });

  it('el código de barras de una variación la encuentra a ella', async () => {
    const r = await buscarProductos(db, '7790001234567');
    expect(r).toHaveLength(1);
    expect(r[0]!.nombre).toContain('iPhone 14');
    expect(r[0]!.exacto).toBe(true);
  });

  it('esconde lo que no tiene stock, salvo que se pida', async () => {
    expect(await buscarProductos(db, 'motorola')).toHaveLength(0);
    expect(await buscarProductos(db, 'motorola', { incluirSinStock: true })).toHaveLength(1);
  });

  it('nunca muestra productos despublicados', async () => {
    expect(await buscarProductos(db, 'despublicado', { incluirSinStock: true })).toHaveLength(0);
  });

  it('devuelve el precio en dólares junto al de pesos', async () => {
    const r = await buscarProductos(db, 'IP14P-256');
    expect(r[0]!.moneda).toBe('USD');
    expect(r[0]!.precioUsdCentavos).toBe(137_000);
  });

  it('un término vacío no devuelve nada, en vez de todo el catálogo', async () => {
    expect(await buscarProductos(db, '')).toHaveLength(0);
    expect(await buscarProductos(db, '   ')).toHaveLength(0);
  });

  it('respeta el tope de resultados', async () => {
    expect(await buscarProductos(db, 'a', { limite: 2 })).toHaveLength(2);
  });

  it('responde rápido: es la pantalla más usada del sistema', async () => {
    const inicio = performance.now();
    await buscarProductos(db, 'iphone');
    expect(performance.now() - inicio).toBeLessThan(100);
  });
});

describe('pareceLectorDeCodigo', () => {
  it('reconoce la ráfaga de un lector', () => {
    // Doce dígitos en 80 ms: ninguna persona tipea así.
    expect(pareceLectorDeCodigo('190199267145', 80)).toBe(true);
  });

  it('no confunde a alguien tipeando', () => {
    // Doce caracteres en tres segundos.
    expect(pareceLectorDeCodigo('190199267145', 3000)).toBe(false);
  });

  it('ignora términos cortos y con espacios', () => {
    expect(pareceLectorDeCodigo('1234', 20)).toBe(false);
    expect(pareceLectorDeCodigo('vidrio templado', 100)).toBe(false);
  });
});
