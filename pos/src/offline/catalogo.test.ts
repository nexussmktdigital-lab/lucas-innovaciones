/**
 * Tests del catalogo guardado en la tablet (D56).
 *
 * Lo que de verdad importa acá es una sola cosa: que buscar sin conexión
 * devuelva **lo mismo y en el mismo orden** que buscar con conexión. El lector
 * de código de barras termina con Enter y agrega el primer resultado; si
 * offline el primero fuera otro, el mismo gesto vendería otro producto y nadie
 * lo notaría hasta el arqueo. Por eso los tests comparan las dos búsquedas
 * contra la misma base, en vez de probar cada una por su cuenta.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { products, productVariants } from '@/db/schema';
import { buscarProductos } from '@/ventas/buscar';
import {
  buscarEnCache,
  disponibleDe,
  estaVieja,
  horasDesde,
  HORAS_PARA_AVISAR,
  type Instantanea,
  type ProductoEnCache,
} from './catalogo';

let db: TestDb;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const prods = await db
    .insert(products)
    .values([
      {
        wooId: 1,
        nombre: 'Vidrio templado 9D',
        sku: '531',
        marca: 'Genérico',
        codigoBarras: '7790001112223',
        precioCentavos: 500_000,
        stock: 10,
      },
      {
        wooId: 2,
        nombre: 'Vidrio templado cerámico para iPhone',
        sku: '532',
        precioCentavos: 700_000,
        stock: 4,
      },
      {
        wooId: 3,
        nombre: 'Cargador Fox Box 20W',
        sku: 'CAB-FOXB-20W',
        marca: 'Fox Box',
        precioCentavos: 900_000,
        stock: 0,
      },
      {
        wooId: 4,
        nombre: 'Funda antigolpe',
        sku: '531-A',
        precioCentavos: 300_000,
        stock: 7,
      },
    ])
    .returning();

  await db.insert(productVariants).values({
    productId: prods[3]!.id,
    wooId: 41,
    nombre: 'Negra',
    sku: 'FND-NEG',
    precioCentavos: 320_000,
    gestionaStock: true,
    stock: 5,
  });
});

/** Baja el catálogo entero, igual que hace la instantánea de verdad. */
async function instantanea(): Promise<Instantanea> {
  return {
    bajadaEn: new Date().toISOString(),
    tcCentavos: 156_100,
    productos: await buscarProductos(db, '', { todos: true, incluirSinStock: true, limite: 5_000 }),
  };
}

describe('la instantanea', () => {
  it('trae el catalogo entero, con y sin stock, y las variaciones', async () => {
    const i = await instantanea();

    /*
     * Cuatro renglones y no cinco: la funda tiene una variación, y el `JOIN`
     * la reemplaza por ella. Es lo correcto —lo que se vende es la variación,
     * no el padre— y lo mismo que se ve con conexión.
     */
    expect(i.productos.length).toBe(4);
    expect(i.productos.some((p) => p.nombre === 'Funda antigolpe — Negra')).toBe(true);
    expect(i.productos.some((p) => p.nombre === 'Funda antigolpe')).toBe(false);
    // El cargador está sin stock y viene igual: se puede necesitar buscarlo.
    expect(i.productos.some((p) => p.nombre.includes('Fox Box'))).toBe(true);
  });

  /*
   * Sin término no hay coincidencia exacta. Comparar contra la cadena vacía
   * marcaba como «exacto» todo lo que no tiene código de barras cargado, que en
   * este catálogo es la mayoría, y ese campo es el que decide qué agrega el
   * lector.
   */
  it('nada viene marcado como coincidencia exacta', async () => {
    const i = await instantanea();
    expect(i.productos.every((p) => p.exacto === false)).toBe(true);
  });

  it('el precio que trae es el de mostrador, el mismo que muestra el buscador', async () => {
    const i = await instantanea();
    const [delServidor] = await buscarProductos(db, 'cargador fox', {
      incluirSinStock: true,
      recargoTiendaBp: 0,
    });
    const guardado = i.productos.find((p) => p.id === delServidor!.id);
    expect(guardado!.precioCentavos).toBe(delServidor!.precioCentavos);
  });
});

describe('buscar sin conexion da lo mismo que con conexion', () => {
  const terminos = ['vidrio', 'vidrio templado', 'fox', 'funda', '531', 'negra', 'templado 9d'];

  it.each(terminos)('«%s» devuelve el mismo orden por los dos caminos', async (termino) => {
    const conServidor = await buscarProductos(db, termino, { incluirSinStock: true });
    const { productos } = await instantanea();
    const sinConexion = buscarEnCache(productos, termino, { incluirSinStock: true });

    expect(sinConexion.map((p) => p.nombre)).toEqual(conServidor.map((p) => p.nombre));
  });

  it('el codigo de barras exacto gana, que es lo que dispara el lector', async () => {
    const { productos } = await instantanea();
    const r = buscarEnCache(productos, '7790001112223');

    expect(r).toHaveLength(1);
    expect(r[0]!.nombre).toBe('Vidrio templado 9D');
  });

  it('el filtro de stock se comporta igual', async () => {
    const conServidor = await buscarProductos(db, 'fox');
    const { productos } = await instantanea();
    const sinConexion = buscarEnCache(productos, 'fox');

    // El cargador está en cero: no aparece por ninguno de los dos caminos.
    expect(conServidor).toHaveLength(0);
    expect(sinConexion).toHaveLength(0);
  });

  it('sin acentos y sin distinguir mayusculas, igual que el servidor', async () => {
    const { productos } = await instantanea();
    expect(buscarEnCache(productos, 'CERAMICO')).toHaveLength(1);
    expect(buscarEnCache(productos, 'Cerámico')).toHaveLength(1);
  });

  it('un termino vacio no devuelve el catalogo entero', async () => {
    const { productos } = await instantanea();
    expect(buscarEnCache(productos, '')).toHaveLength(0);
    expect(buscarEnCache(productos, '   ')).toHaveLength(0);
  });
});

describe('que tan vieja esta la instantanea', () => {
  const base: ProductoEnCache[] = [];

  function conFecha(horas: number): Instantanea {
    return {
      bajadaEn: new Date(Date.now() - horas * 3_600_000).toISOString(),
      tcCentavos: null,
      productos: base,
    };
  }

  it('recien bajada no preocupa', () => {
    expect(estaVieja(conFecha(1))).toBe(false);
    expect(Math.round(horasDesde(conFecha(3).bajadaEn))).toBe(3);
  });

  /*
   * El umbral es de doce horas porque la cotización del dólar se reescribe dos
   * veces por día (D22): pasado eso, un producto en dólares se estaría
   * vendiendo al precio de ayer.
   */
  it('pasadas las horas del dolar, avisa', () => {
    expect(estaVieja(conFecha(HORAS_PARA_AVISAR + 1))).toBe(true);
  });

  it('una fecha del futuro no da horas negativas', () => {
    expect(horasDesde(new Date(Date.now() + 60_000).toISOString())).toBe(0);
  });
});

describe('lo disponible de un renglon', () => {
  it('descuenta lo comprometido', () => {
    const p = { gestionaStock: true, stock: 5, stockComprometido: 2 } as ProductoEnCache;
    expect(disponibleDe(p)).toBe(3);
  });

  it('lo que no lleva stock no tiene tope', () => {
    const p = { gestionaStock: false, stock: 0, stockComprometido: 0 } as ProductoEnCache;
    expect(disponibleDe(p)).toBe(Number.POSITIVE_INFINITY);
  });
});
