/**
 * Entrada de mercadería desde el mostrador.
 *
 * Lo que importa no es que el número suba: es que la tienda se entere —si no, el
 * próximo `woo:sync` pisa las unidades y el mostrador vende lo que no tiene— y
 * que dos personas cargando la misma entrega no se tapen entre sí.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { auditLog, products, stockMovements, syncQueue, users } from '@/db/schema';
import { darDeBaja, ErrorStock, reactivarProducto, sumarStock, TECHO_POR_INGRESO } from './stock';

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

/** Un producto del espejo, con su id de Woo como los de verdad. */
async function producto(parcial: Partial<typeof products.$inferInsert> = {}) {
  const [p] = await db
    .insert(products)
    .values({
      wooId: 7001,
      nombre: 'Cable USB tipo C 1 metro',
      precioCentavos: 9_000_00,
      stock: 4,
      gestionaStock: true,
      ...parcial,
    })
    .returning();
  return p!;
}

describe('sumar stock', () => {
  it('suma las unidades y deja el movimiento con el resultante', async () => {
    const p = await producto({ stock: 4 });

    const r = await sumarStock(db, { productId: p.id, cantidad: 10, usuarioId: duenio });

    expect(r.stockAnterior).toBe(4);
    expect(r.stockResultante).toBe(14);

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.stock).toBe(14);

    const [mov] = await db.select().from(stockMovements);
    expect(mov!.tipo).toBe('ingreso');
    expect(mov!.cantidad).toBe(10);
    expect(mov!.stockResultante).toBe(14);
    expect(mov!.usuarioId).toBe(duenio);
  });

  it('encola el empuje a la tienda: sin eso el próximo sync borra las unidades', async () => {
    /*
     * Es la razón de ser de esta prueba. `sincronizarCatalogo` escribe
     * `stock: excluded.stock`, o sea que el stock de Woo pisa el del POS. Si la
     * entrada no viaja a la tienda, las unidades que entraron hoy desaparecen
     * en la próxima corrida y el mostrador vuelve a vender lo que no tiene.
     */
    const p = await producto();
    await sumarStock(db, { productId: p.id, cantidad: 6, usuarioId: duenio });

    const [op] = await db.select().from(syncQueue);
    expect(op!.operacion).toBe('stock.empujar');
    expect(op!.payload).toMatchObject({ productId: p.id, wooId: 7001 });
  });

  it('un producto que no está en la tienda no encola nada', async () => {
    // Nació en el mostrador y todavía no se publicó: no hay a quién avisarle.
    const p = await producto({ wooId: null });
    await sumarStock(db, { productId: p.id, cantidad: 3, usuarioId: duenio });
    expect(await db.select().from(syncQueue)).toHaveLength(0);
  });

  it('dos entradas seguidas encolan dos operaciones, sin taparse', async () => {
    const p = await producto({ stock: 0 });
    await sumarStock(db, { productId: p.id, cantidad: 5, usuarioId: duenio });
    await sumarStock(db, { productId: p.id, cantidad: 5, usuarioId: duenio });

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.stock).toBe(10);
    expect(await db.select().from(syncQueue)).toHaveLength(2);
  });

  it('queda en la bitácora qué había antes y qué quedó', async () => {
    const p = await producto({ stock: 2 });
    await sumarStock(db, {
      productId: p.id,
      cantidad: 8,
      usuarioId: duenio,
      motivo: 'Entrega del martes',
    });

    const [b] = await db.select().from(auditLog);
    expect(b!.accion).toBe('stock.sumar');
    expect(b!.valorNuevo).toMatchObject({
      cantidad: 8,
      stockAnterior: 2,
      stockResultante: 10,
      motivo: 'Entrega del martes',
    });
  });

  it('avisa que un producto sin control de stock no necesita unidades', async () => {
    const p = await producto({ gestionaStock: false, stock: 0 });
    await expect(
      sumarStock(db, { productId: p.id, cantidad: 5, usuarioId: duenio }),
    ).rejects.toMatchObject({ motivo: 'sin_control' });

    // Y no dejó nada a medias.
    expect(await db.select().from(stockMovements)).toHaveLength(0);
  });

  it('rechaza cantidades que no son unidades', async () => {
    const p = await producto();
    for (const cantidad of [0, -3, 1.5]) {
      await expect(
        sumarStock(db, { productId: p.id, cantidad, usuarioId: duenio }),
      ).rejects.toBeInstanceOf(ErrorStock);
    }
  });

  it('frena el dedo: mil unidades de una vez es un cero de más', async () => {
    const p = await producto();
    await expect(
      sumarStock(db, { productId: p.id, cantidad: TECHO_POR_INGRESO + 1, usuarioId: duenio }),
    ).rejects.toMatchObject({ motivo: 'techo' });
  });

  it('un producto que ya no está se dice, no se rompe', async () => {
    await expect(
      sumarStock(db, {
        productId: '00000000-0000-0000-0000-000000000000',
        cantidad: 1,
        usuarioId: duenio,
      }),
    ).rejects.toMatchObject({ motivo: 'no_existe' });
  });

  it('a un inactivo se le puede sumar, y queda anotado que lo estaba', async () => {
    // Llegó mercadería de algo que estaba dado de baja: sumar está bien, y el
    // aviso de la pantalla propone reactivarlo aparte.
    const p = await producto({ activo: false });
    await sumarStock(db, { productId: p.id, cantidad: 4, usuarioId: duenio });

    const [b] = await db.select().from(auditLog);
    expect(b!.valorNuevo).toMatchObject({ estabaInactivo: true });
  });
});

describe('reactivar un producto', () => {
  it('lo vuelve a poner a la venta sin tocarle stock ni precio', async () => {
    const p = await producto({ activo: false, stock: 7, precioCentavos: 9_000_00 });

    await reactivarProducto(db, { productId: p.id, usuarioId: duenio });

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.activo).toBe(true);
    expect(enBase!.stock).toBe(7);
    expect(enBase!.precioCentavos).toBe(9_000_00);

    const [b] = await db.select().from(auditLog);
    expect(b!.accion).toBe('producto.reactivar');
  });

  it('reactivar uno que ya está activo no escribe en la bitácora', async () => {
    // Dos clics del mismo botón no son dos reactivaciones.
    const p = await producto({ activo: true });
    await reactivarProducto(db, { productId: p.id, usuarioId: duenio });
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });
});

describe('dar de baja', () => {
  it('lo saca de la venta sin borrar la ficha', async () => {
    // Borrarla rompería las ventas viejas y la rentabilidad del mes pasado: lo
    // que se pidió es que no se venda más, no que nunca haya existido.
    const p = await producto({ nombre: 'Basura vieja', stock: 3 });

    const r = await darDeBaja(db, { productId: p.id, usuarioId: duenio });
    expect(r.yaEstaba).toBe(false);

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase).toBeDefined();
    expect(enBase!.activo).toBe(false);
    // El stock no se toca: si el producto vuelve, vuelve con lo que tenía.
    expect(enBase!.stock).toBe(3);
  });

  it('lo pasa a borrador en la tienda, o el próximo sync lo devuelve activo', async () => {
    // `activo: status === 'publish'`: una baja solo local no sobrevive al
    // próximo woo:sync porque Woo sigue diciendo que está publicado.
    const p = await producto({ wooId: 7001 });

    await darDeBaja(db, { productId: p.id, usuarioId: duenio });

    const [op] = await db.select().from(syncQueue);
    expect(op!.operacion).toBe('producto.baja');
    expect(op!.payload).toMatchObject({ productId: p.id, wooId: 7001 });
  });

  it('no encola nada si el producto no está en la tienda', async () => {
    const p = await producto({ wooId: null });
    await darDeBaja(db, { productId: p.id, usuarioId: duenio });
    expect(await db.select().from(syncQueue)).toHaveLength(0);
  });

  it('dar de baja dos veces no hace nada la segunda', async () => {
    const p = await producto({ wooId: 7001 });

    await darDeBaja(db, { productId: p.id, usuarioId: duenio });
    const r = await darDeBaja(db, { productId: p.id, usuarioId: duenio });

    expect(r.yaEstaba).toBe(true);
    expect(await db.select().from(syncQueue)).toHaveLength(1);
  });

  it('queda en la bitácora con quién lo hizo', async () => {
    const p = await producto({ nombre: 'Basura vieja' });
    await darDeBaja(db, { productId: p.id, usuarioId: duenio });

    const [registro] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.accion, 'producto.baja'));

    expect(registro!.usuarioId).toBe(duenio);
    expect(registro!.entidadId).toBe(p.id);
    expect(registro!.valorNuevo).toMatchObject({ nombre: 'Basura vieja', activo: false });
  });

  it('se puede volver a activar', async () => {
    const p = await producto();
    await darDeBaja(db, { productId: p.id, usuarioId: duenio });
    await reactivarProducto(db, { productId: p.id, usuarioId: duenio });

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.activo).toBe(true);
  });

  it('avisa si el producto ya no está', async () => {
    await expect(
      darDeBaja(db, {
        productId: '00000000-0000-0000-0000-000000000000',
        usuarioId: duenio,
      }),
    ).rejects.toThrow(ErrorStock);
  });
});
