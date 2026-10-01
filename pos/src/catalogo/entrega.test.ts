/**
 * Una entrega de mercadería, de la lista pegada al catálogo.
 *
 * Lo que importa acá no es el parseo —eso lo cubre `lista.test.ts`— sino las
 * decisiones: a qué ficha le suma, cuándo se niega a adivinar, y que una baja
 * no borre nada.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { auditLog, products, stockMovements, syncQueue, users } from '@/db/schema';
import { aplicarEntrega, pareceUnaPlanilla, revisarEntrega } from './entrega';

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

async function producto(parcial: Partial<typeof products.$inferInsert> = {}) {
  const [p] = await db
    .insert(products)
    .values({
      wooId: 7001,
      nombre: 'Cable USB tipo C',
      precioCentavos: 9_000_00,
      stock: 4,
      gestionaStock: true,
      ...parcial,
    })
    .returning();
  return p!;
}

describe('qué hace con cada renglón', () => {
  it('da de alta lo que no está y trae precio', async () => {
    const r = await revisarEntrega(db, 'Router TP-Link Archer C86 (5) $68.000 - 98.000');

    expect(r.altas).toBe(1);
    expect(r.renglones[0]).toMatchObject({
      destino: 'alta',
      nombre: 'Router TP-Link Archer C86',
      cantidad: 5,
      costoCentavos: 68_000_00,
      precioCentavos: 98_000_00,
    });
  });

  it('le suma stock a lo que ya está, sin precios de por medio', async () => {
    const p = await producto({ stock: 4 });

    const r = await revisarEntrega(db, 'Cable USB tipo C (4+)');

    expect(r.sumas).toBe(1);
    expect(r.renglones[0]).toMatchObject({ destino: 'stock', productId: p.id, cantidad: 4 });
    expect(r.renglones[0]!.motivo).toContain('de 4 a 8');
  });

  it('si ya está, suma stock y NO toca el precio aunque el renglón lo traiga', async () => {
    // Es lo que se pidió: una lista de entrega trae el costo con el que llegó la
    // mercadería, no una decisión de qué cobrar.
    const p = await producto({ stock: 4, precioCentavos: 9_000_00 });

    const r = await revisarEntrega(db, 'Cable USB tipo C (3) $5.000 - 12.000');
    expect(r.renglones[0]!.destino).toBe('stock');
    // Y lo dice, para que nadie se entere después.
    expect(r.renglones[0]!.motivo).toMatch(/precio de la lista no se aplica/i);

    await aplicarEntrega(db, 'Cable USB tipo C (3) $5.000 - 12.000', duenio);

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.stock).toBe(7);
    expect(enBase!.precioCentavos).toBe(9_000_00);
  });

  it('encuentra la ficha aunque el renglón venga con otras mayúsculas y acentos', async () => {
    await producto({ nombre: 'Teclado mecánico NETMAK' });

    const r = await revisarEntrega(db, 'teclado  MECANICO netmak (2)');
    expect(r.renglones[0]!.destino).toBe('stock');
  });

  it('da de baja lo que dice «(eliminar)», buscando el nombre exacto', async () => {
    const p = await producto({ nombre: 'Memoria Kingston micro sd 128gb' });

    const r = await revisarEntrega(db, 'Memoria Kingston micro sd 128gb (eliminar)');
    expect(r.bajas).toBe(1);
    expect(r.renglones[0]).toMatchObject({ destino: 'baja', productId: p.id });
  });
});

describe('cuándo se niega a adivinar', () => {
  it('un renglón sin precios cuyo producto no existe no se carga en cero', async () => {
    // Un producto a $0 se vende a $0, y eso se descubre cobrando.
    const r = await revisarEntrega(db, 'Cable que no existe (4+)');

    expect(r.altas).toBe(0);
    expect(r.rechazados).toBe(1);
    expect(r.renglones[0]!.motivo).toMatch(/precio/i);
  });

  it('una baja sin coincidencia exacta no da de baja nada parecido', async () => {
    // Lo importante: existe un producto que se parece, y no se lo toca.
    await producto({ nombre: 'Memoria Kingston micro sd 128gb 100Mb/s' });

    const r = await revisarEntrega(db, 'Memoria Kingston (eliminar)');

    expect(r.bajas).toBe(0);
    expect(r.renglones[0]!.motivo).toMatch(/nombre exacto/i);
  });

  it('con dos fichas del mismo nombre no elige una', async () => {
    await producto({ nombre: 'Funda común', wooId: 1 });
    await producto({ nombre: 'FUNDA COMUN', wooId: 2 });

    const r = await revisarEntrega(db, 'Funda común (eliminar)');
    expect(r.renglones[0]!.destino).toBe('rechazado');
    expect(r.renglones[0]!.motivo).toMatch(/2 productos/);
  });

  it('no suma unidades a algo que no lleva control de stock', async () => {
    await producto({ nombre: 'Servicio técnico', gestionaStock: false });

    const r = await revisarEntrega(db, 'Servicio técnico (3)');
    expect(r.renglones[0]!.destino).toBe('rechazado');
    expect(r.renglones[0]!.motivo).toMatch(/sin límite|control de stock/i);
  });

  it('el mismo producto nuevo dos veces en la lista entra una sola', async () => {
    const r = await revisarEntrega(db, 'Funda nueva (2) $1.000 - 3.000\nFunda nueva (1) $1.000 - 3.000');

    expect(r.altas).toBe(1);
    expect(r.renglones[1]!.motivo).toMatch(/dos veces/i);
  });

  it('dice que ya estaba de baja en vez de hacer una baja de más', async () => {
    await producto({ nombre: 'Basura vieja', activo: false });

    const r = await revisarEntrega(db, 'Basura vieja (eliminar)');
    expect(r.bajas).toBe(0);
    expect(r.renglones[0]!.motivo).toMatch(/ya estaba/i);
  });

  it('una lista vacía avisa', async () => {
    await expect(revisarEntrega(db, '   \n\n  ')).rejects.toThrow(/nada escrito/i);
  });
});

describe('la revisión no escribe nada', () => {
  it('mirar una entrega con altas, sumas y bajas deja el catálogo igual', async () => {
    const p = await producto({ stock: 4 });

    await revisarEntrega(
      db,
      ['Router nuevo (5) $68.000 - 98.000', 'Cable USB tipo C (4+)', 'Cable USB tipo C (eliminar)'].join('\n'),
    );

    expect(await db.select().from(products)).toHaveLength(1);
    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.stock).toBe(4);
    expect(enBase!.activo).toBe(true);
    expect(await db.select().from(syncQueue)).toHaveLength(0);
  });
});

describe('aplicar la entrega', () => {
  it('hace las tres cosas de una lista mezclada', async () => {
    const existente = await producto({ nombre: 'Cable USB tipo C', stock: 4 });
    const aBorrar = await producto({ nombre: 'Memoria Kingston', stock: 0, wooId: 7002 });

    const r = await aplicarEntrega(
      db,
      [
        'Router TP-Link Archer C86 (5) $68.000 - 98.000',
        'Cable USB tipo C (4+)',
        'Memoria Kingston (eliminar)',
      ].join('\n'),
      duenio,
    );

    expect(r).toMatchObject({ creados: 1, stockSumado: 1, bajas: 1, fallidos: [] });

    const [cable] = await db.select().from(products).where(eq(products.id, existente.id));
    expect(cable!.stock).toBe(8);

    const [memoria] = await db.select().from(products).where(eq(products.id, aBorrar.id));
    expect(memoria!.activo).toBe(false);

    const [router] = await db
      .select()
      .from(products)
      .where(eq(products.nombre, 'Router TP-Link Archer C86'));
    expect(router!.stock).toBe(5);
    expect(router!.costoCentavos).toBe(68_000_00);
  });

  it('el alta guarda el costo, que es lo que habilita el reporte de margen', async () => {
    await aplicarEntrega(db, 'Router nuevo (5) $68.000 - 98.000', duenio);

    const [p] = await db.select().from(products).where(eq(products.nombre, 'Router nuevo'));
    expect(p!.costoCentavos).toBe(68_000_00);
    // El precio que se guarda es el del renglón: el de mostrador, sin recargo,
    // porque todavía no está en la tienda.
    expect(p!.precioCentavos).toBe(98_000_00);
  });

  it('un usado entra de a uno y con el IMEI en el nombre', async () => {
    await aplicarEntrega(db, 'iPhone 15 Pro Max 256gb 88% (34985) - $1.038.500 - $1.154.750', duenio);

    const [p] = await db.select().from(products);
    expect(p!.nombre).toBe('iPhone 15 Pro Max 256gb 88% (34985)');
    expect(p!.stock).toBe(1);
    expect(p!.precioCentavos).toBe(1_154_750_00);
  });

  it('la suma de stock deja movimiento y encola el empuje a la tienda', async () => {
    // Sin el encolado, el próximo woo:sync pisa las unidades que entraron.
    await producto({ stock: 4, wooId: 7001 });

    await aplicarEntrega(db, 'Cable USB tipo C (4+)', duenio);

    const [mov] = await db.select().from(stockMovements);
    expect(mov!.tipo).toBe('ingreso');
    expect(mov!.cantidad).toBe(4);

    const cola = await db.select().from(syncQueue);
    expect(cola.map((c) => c.operacion)).toContain('stock.empujar');
  });

  it('la baja no borra la ficha y encola el paso a borrador en la tienda', async () => {
    // Borrarla rompería las ventas viejas y la rentabilidad del mes pasado. Y
    // sin el empuje a Woo, el próximo sync la devuelve activa.
    const p = await producto({ nombre: 'Basura vieja', wooId: 7003 });

    await aplicarEntrega(db, 'Basura vieja (eliminar)', duenio);

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase).toBeDefined();
    expect(enBase!.activo).toBe(false);

    const cola = await db.select().from(syncQueue);
    expect(cola.map((c) => c.operacion)).toContain('producto.baja');

    const [registro] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.accion, 'producto.baja'));
    expect(registro!.usuarioId).toBe(duenio);
  });

  it('un renglón que falla no se lleva puesta a la entrega', async () => {
    const r = await aplicarEntrega(
      db,
      ['Router nuevo (5) $68.000 - 98.000', 'Cable que no existe (4+)'].join('\n'),
      duenio,
    );

    expect(r.creados).toBe(1);
    expect(r.salteados).toBe(1);
  });
});

describe('pareceUnaPlanilla', () => {
  it('reconoce la planilla por su fila de títulos', () => {
    expect(pareceUnaPlanilla('nombre;sku;categoria;precio\nFunda;;Fundas;3000')).toBe(true);
    expect(pareceUnaPlanilla('nombre,precio\nFunda,3000')).toBe(true);
  });

  it('no confunde una lista con una planilla', () => {
    // El caso que importa: un renglón de lista con comas adentro.
    expect(pareceUnaPlanilla('Cable interlook Trebol notebook 1,5m (2) $1.500 - 8.000')).toBe(false);
    expect(pareceUnaPlanilla('-Router TP-Link Archer C86 (5) $68.000 - 98.000')).toBe(false);
    expect(pareceUnaPlanilla('')).toBe(false);
  });
});
