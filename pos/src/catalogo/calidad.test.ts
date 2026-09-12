import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  cashSessions,
  exchangeRates,
  legacySales,
  monetaryAccounts,
  products,
  users,
} from '@/db/schema';
import { confirmarVenta } from '@/ventas/confirmar';
import { evaluarCatalogo, marcadorDeProductoReal, productosConRotacion } from './calidad';

const TC = 156_100;

let db: TestDb;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);
});

/** Catálogo de muestra con un problema de cada clase. */
async function catalogoSucio() {
  await db.insert(products).values([
    // Sano.
    {
      wooId: 1,
      nombre: 'Vidrio templado 9D',
      sku: '531',
      categoria: 'Vidrios templados',
      precioCentavos: 500_000,
      stock: 40,
      imagenUrl: 'https://x/v.jpg',
    },
    // El error de agosto: iPhone en pesos con la cifra del dólar.
    {
      wooId: 2,
      nombre: 'iPhone 15 Pro Max 1TB',
      sku: 'IP15PM',
      categoria: 'Smartphones nuevos',
      marca: 'Apple',
      precioCentavos: 630_000,
      stock: 9,
      imagenUrl: 'https://x/i.jpg',
    },
    // Precio sin cargar: los 33 productos a $1.
    {
      wooId: 3,
      nombre: 'Atma cup cake maker',
      sku: '314',
      categoria: 'Cocina',
      precioCentavos: 100,
      stock: 1,
      imagenUrl: 'https://x/a.jpg',
    },
    // Stock imposible.
    {
      wooId: 4,
      nombre: 'Hidrogel Clear AAA',
      sku: 'HID',
      categoria: 'Vidrios templados',
      precioCentavos: 800_000,
      stock: 9708,
      imagenUrl: 'https://x/h.jpg',
    },
    // Sin SKU y sin foto.
    { wooId: 5, nombre: 'Cable USB tipo C', categoria: 'Cables de carga', precioCentavos: 600_000, stock: 15 },
    // USD con el precio en pesos desactualizado.
    {
      wooId: 6,
      nombre: 'iPhone 13 128GB',
      sku: 'IP13',
      categoria: 'Smartphones nuevos',
      marca: 'Apple',
      moneda: 'USD',
      precioUsdCentavos: 52_000,
      precioCentavos: 40_000_000, // debería rondar $81.000.000
      stock: 2,
      imagenUrl: 'https://x/i13.jpg',
    },
    // Servicio con precio cero: es normal, no es un problema.
    {
      wooId: 7,
      nombre: 'Servicio técnico · Reparación',
      sku: 'SERV',
      categoria: 'Servicio técnico',
      precioCentavos: 0,
      stock: 0,
      gestionaStock: false,
      esServicio: true,
      precioEditable: true,
      imagenUrl: 'https://x/s.jpg',
    },
    // Despublicado: no se evalúa.
    { wooId: 8, nombre: 'Basura vieja', precioCentavos: 1, stock: 0, activo: false },
  ]);
}

describe('evaluarCatalogo', () => {
  it('encuentra cada clase de problema y deja en paz lo sano', async () => {
    await catalogoSucio();
    const informe = await evaluarCatalogo(db, TC);

    expect(informe.totalProductos).toBe(7); // el despublicado no cuenta

    const tipos = informe.porTipo.map((t) => t.tipo);
    expect(tipos).toContain('precio_sospechoso');
    expect(tipos).toContain('sin_precio');
    expect(tipos).toContain('usd_incoherente');
    expect(tipos).toContain('stock_ficticio');
    expect(tipos).toContain('sin_sku');
    expect(tipos).toContain('sin_imagen');

    const nombres = informe.productos.map((p) => p.nombre);
    expect(nombres).not.toContain('Vidrio templado 9D');
    expect(nombres).not.toContain('Servicio técnico · Reparación');
    expect(nombres).not.toContain('Basura vieja');
  });

  it('pone lo más grave arriba, no lo más numeroso', async () => {
    await catalogoSucio();
    const informe = await evaluarCatalogo(db, TC);
    expect(informe.productos[0]!.nombre).toBe('iPhone 15 Pro Max 1TB');
    expect(informe.productos[0]!.problemas[0]!.tipo).toBe('precio_sospechoso');
  });

  it('un servicio a precio cero no es una ficha sin cargar', async () => {
    await catalogoSucio();
    const informe = await evaluarCatalogo(db, TC);
    const servicio = informe.productos.find((p) => p.nombre.includes('Servicio'));
    expect(servicio).toBeUndefined();
  });

  it('detecta el desfasaje entre el precio en dólares y el de pesos', async () => {
    await catalogoSucio();
    const informe = await evaluarCatalogo(db, TC);
    const iphone13 = informe.productos.find((p) => p.nombre === 'iPhone 13 128GB')!;
    const problema = iphone13.problemas.find((x) => x.tipo === 'usd_incoherente')!;
    expect(problema.detalle).toContain('US$ 520');
    expect(problema.detalle).toContain('812.000');
  });

  it('sin cotización no inventa avisos de dólares', async () => {
    await catalogoSucio();
    const informe = await evaluarCatalogo(db, null);
    expect(informe.porTipo.map((t) => t.tipo)).not.toContain('usd_incoherente');
  });

  it('puede filtrar solo lo que impide vender bien', async () => {
    await catalogoSucio();
    const informe = await evaluarCatalogo(db, TC, { soloBloqueantes: true });

    // El del cable, que solo tiene sin_sku y sin_imagen, queda afuera.
    expect(informe.productos.map((p) => p.nombre)).not.toContain('Cable USB tipo C');
    expect(informe.conProblemasBloqueantes).toBeLessThan(informe.conProblemas);
  });

  it('un catálogo limpio no reporta nada', async () => {
    await db.insert(products).values({
      wooId: 1,
      nombre: 'Vidrio templado',
      sku: '531',
      categoria: 'Vidrios',
      precioCentavos: 500_000,
      stock: 40,
      imagenUrl: 'https://x/v.jpg',
    });

    const informe = await evaluarCatalogo(db, TC);
    expect(informe.conProblemas).toBe(0);
    expect(informe.productos).toEqual([]);
  });
});

describe('marcadorDeProductoReal', () => {
  it('el sistema nuevo da 100% por construcción', async () => {
    const [u] = await db.insert(users).values({ nombre: 'Vendedor', rol: 'seller' }).returning();
    const [c] = await db
      .insert(monetaryAccounts)
      .values({ nombre: 'Caja', tipo: 'efectivo' })
      .returning();
    const [s] = await db
      .insert(cashSessions)
      .values({ monetaryAccountId: c!.id, terminal: 'T1', abiertaPorId: u!.id })
      .returning();
    await db
      .insert(exchangeRates)
      .values({ valorCentavos: TC, vigenteDesde: new Date(), origen: 'infodolar' });
    const [p] = await db
      .insert(products)
      .values({ wooId: 1, nombre: 'Vidrio', precioCentavos: 500_000, stock: 40 })
      .returning();

    await confirmarVenta(db, {
      lineas: [{ productId: p!.id, cantidad: 2 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 1_000_000, monetaryAccountId: c!.id }],
      vendedorId: u!.id,
      cashSessionId: s!.id,
      terminal: 'T1',
      idempotencyKey: 'v1',
    });

    const marcador = await marcadorDeProductoReal(db);
    expect(marcador).toHaveLength(1);
    expect(marcador[0]!.porcentaje).toBe(100);
    expect(marcador[0]!.origen).toBe('pos');
  });

  it('el histórico muestra el problema que el sistema nuevo viene a resolver', async () => {
    await db.insert(legacySales).values([
      {
        referenciaExterna: 'y1',
        fecha: new Date('2026-08-05T15:00:00Z'),
        totalCentavos: 10_000_000,
        sinProducto: true,
      },
      {
        referenciaExterna: 'y2',
        fecha: new Date('2026-08-10T15:00:00Z'),
        totalCentavos: 4_000_000,
        sinProducto: false,
      },
      {
        referenciaExterna: 'y3',
        fecha: new Date('2026-07-10T15:00:00Z'),
        totalCentavos: 5_000_000,
        sinProducto: true,
      },
    ]);

    const marcador = await marcadorDeProductoReal(db);
    const agosto = marcador.find((m) => m.mes === '2026-08')!;
    const julio = marcador.find((m) => m.mes === '2026-07')!;

    expect(agosto.porcentaje).toBe(29); // 4 de 14 millones
    expect(julio.porcentaje).toBe(0);
    expect(agosto.origen).toBe('legacy');
  });

  it('sin ventas devuelve una lista vacía en vez de romper', async () => {
    expect(await marcadorDeProductoReal(db)).toEqual([]);
  });
});

describe('productosConRotacion', () => {
  it('cuenta los productos distintos que se vendieron', async () => {
    expect(await productosConRotacion(db)).toBe(0);
  });
});
