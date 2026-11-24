/**
 * Editar una ficha completa desde el buscador del catálogo.
 *
 * Lo que se prueba, más que los campos, son las tres puertas: el stock que no
 * puede quedar en negativo por un dedo, el nombre que no se puede cambiar
 * donde la tienda lo va a pisar, y el borrado que solo existe para la ficha
 * que nunca debió existir.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  auditLog,
  cashSessions,
  customers,
  monetaryAccounts,
  products,
  stockMovements,
  syncQueue,
  users,
} from '@/db/schema';
import { confirmarVenta } from '@/ventas/confirmar';
import { ErrorStock } from './stock';
import {
  editarFicha,
  eliminarProducto,
  LARGO_MAXIMO_NOMBRE,
  motivosParaNoEliminar,
  restarStock,
  TECHO_POR_AJUSTE,
} from './editar';

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

/** Una ficha nacida en el mostrador: sin id de Woo. */
async function producto(parcial: Partial<typeof products.$inferInsert> = {}) {
  const [p] = await db
    .insert(products)
    .values({
      nombre: 'Cargador 20W',
      precioCentavos: 9_000_00,
      stock: 4,
      gestionaStock: true,
      ...parcial,
    })
    .returning();
  return p!;
}

describe('restar stock', () => {
  it('saca las unidades y deja el movimiento como ajuste, no como venta', async () => {
    const p = await producto({ stock: 10 });

    const r = await restarStock(db, {
      productId: p.id,
      cantidad: 3,
      usuarioId: duenio,
      motivo: 'Se rompió una',
    });

    expect(r.stockAnterior).toBe(10);
    expect(r.stockResultante).toBe(7);

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.stock).toBe(7);

    const [mov] = await db.select().from(stockMovements);
    // `ajuste` y no `venta`: no se vendió nada, así que el reporte del día no
    // lo puede contar como facturación.
    expect(mov!.tipo).toBe('ajuste');
    expect(mov!.cantidad).toBe(-3);
    expect(mov!.stockResultante).toBe(7);
    expect(mov!.motivo).toBe('Se rompió una');
  });

  /*
   * El POS admite stock negativo cuando se vendió sin conexión algo que creía
   * agotado: ahí el negativo es un hecho que pasó. Un ajuste a mano no es un
   * hecho, es un número que alguien escribe.
   */
  it('no deja el stock en negativo, y lo explica', async () => {
    const p = await producto({ stock: 3 });

    await expect(
      restarStock(db, { productId: p.id, cantidad: 50, usuarioId: duenio }),
    ).rejects.toThrow(/no puede dejar el stock en negativo/i);

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.stock).toBe(3);
    expect(await db.select().from(stockMovements)).toHaveLength(0);
  });

  it('dejarlo justo en cero sí se puede', async () => {
    const p = await producto({ stock: 3 });
    const r = await restarStock(db, { productId: p.id, cantidad: 3, usuarioId: duenio });
    expect(r.stockResultante).toBe(0);
  });

  it('le avisa a la tienda, o el próximo sync devuelve las unidades', async () => {
    const p = await producto({ stock: 10, wooId: 7001 });
    await restarStock(db, { productId: p.id, cantidad: 2, usuarioId: duenio });

    const [pedido] = await db.select().from(syncQueue);
    expect(pedido!.operacion).toBe('stock.empujar');
    expect(pedido!.payload).toMatchObject({ wooId: 7001, delta: -2 });
  });

  it('lo que nunca salió a la tienda no encola nada', async () => {
    const p = await producto({ stock: 10, wooId: null });
    await restarStock(db, { productId: p.id, cantidad: 2, usuarioId: duenio });
    expect(await db.select().from(syncQueue)).toHaveLength(0);
  });

  it('un número raro, de más, o sobre algo sin control de stock, frena', async () => {
    const p = await producto({ stock: 10 });
    const sinControl = await producto({ nombre: 'Service técnico', gestionaStock: false });

    for (const malo of [0, -1, 1.5, TECHO_POR_AJUSTE + 1]) {
      await expect(
        restarStock(db, { productId: p.id, cantidad: malo, usuarioId: duenio }),
      ).rejects.toBeInstanceOf(ErrorStock);
    }
    await expect(
      restarStock(db, { productId: sinControl.id, cantidad: 1, usuarioId: duenio }),
    ).rejects.toThrow(/no lleva control de stock/i);

    expect(await db.select().from(stockMovements)).toHaveLength(0);
  });
});

describe('editar la ficha', () => {
  it('cambia el nombre y el costo, y deja las dos cosas en la bitácora', async () => {
    const p = await producto({ nombre: 'Cargadr 20w', costoCentavos: null });

    const r = await editarFicha(db, {
      productId: p.id,
      nombre: '  Cargador 20W Samsung  ',
      costoCentavos: 5_500_00,
      usuarioId: duenio,
    });

    expect(r.nombre).toBe('Cargador 20W Samsung');
    expect(r.cambios).toEqual(['nombre', 'costo']);

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.nombre).toBe('Cargador 20W Samsung');
    expect(enBase!.costoCentavos).toBe(5_500_00);

    const [entrada] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.accion, 'producto.editar'));
    expect(entrada!.valorAnterior).toMatchObject({ nombre: 'Cargadr 20w', costoCentavos: null });
    expect(entrada!.valorNuevo).toMatchObject({
      nombre: 'Cargador 20W Samsung',
      costoCentavos: 5_500_00,
    });
  });

  /*
   * El espejo de WooCommerce pisa `nombre` en cada sincronización. Renombrar
   * acá duraría hasta el próximo `woo:sync` y volvería solo: mejor decirlo que
   * dejarlo pasar.
   */
  it('no renombra lo que también vive en la tienda', async () => {
    const p = await producto({ wooId: 7001, nombre: 'Cable USB' });

    await expect(
      editarFicha(db, { productId: p.id, nombre: 'Cable USB tipo C', usuarioId: duenio }),
    ).rejects.toThrow(/Cambialo en la tienda/i);

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.nombre).toBe('Cable USB');
  });

  it('pero el costo sí, porque la tienda no lo tiene', async () => {
    const p = await producto({ wooId: 7001, costoCentavos: null });
    const r = await editarFicha(db, { productId: p.id, costoCentavos: 1_000_00, usuarioId: duenio });
    expect(r.cambios).toEqual(['costo']);

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.costoCentavos).toBe(1_000_00);
  });

  it('el costo se puede borrar: «no sé cuánto costó» es un dato', async () => {
    const p = await producto({ costoCentavos: 1_000_00 });
    const r = await editarFicha(db, { productId: p.id, costoCentavos: null, usuarioId: duenio });
    expect(r.cambios).toEqual(['costo']);

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.costoCentavos).toBeNull();
  });

  it('guardar sin cambiar nada no escribe nada', async () => {
    const p = await producto({ nombre: 'Cargador 20W', costoCentavos: 500_00 });
    const r = await editarFicha(db, {
      productId: p.id,
      nombre: 'Cargador 20W',
      costoCentavos: 500_00,
      usuarioId: duenio,
    });
    expect(r.cambios).toEqual([]);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it('un nombre vacío, uno larguísimo o un costo negativo frenan', async () => {
    const p = await producto();

    await expect(
      editarFicha(db, { productId: p.id, nombre: '   ', usuarioId: duenio }),
    ).rejects.toThrow(/necesita un nombre/i);

    await expect(
      editarFicha(db, { productId: p.id, nombre: 'x'.repeat(LARGO_MAXIMO_NOMBRE + 1), usuarioId: duenio }),
    ).rejects.toBeInstanceOf(ErrorStock);

    await expect(
      editarFicha(db, { productId: p.id, costoCentavos: -1, usuarioId: duenio }),
    ).rejects.toThrow(/no puede ser negativo/i);

    const [enBase] = await db.select().from(products).where(eq(products.id, p.id));
    expect(enBase!.nombre).toBe('Cargador 20W');
  });
});

describe('borrar la ficha del todo', () => {
  it('borra la ficha que nunca movió nada', async () => {
    const p = await producto({ stock: 5 });

    const r = await eliminarProducto(db, { productId: p.id, usuarioId: duenio });
    expect(r.nombre).toBe('Cargador 20W');
    expect(await db.select().from(products)).toHaveLength(0);
  });

  /*
   * El libro de stock es de solo agregado y la base lo impone (migración
   * 0001). Una ficha con movimientos dejó rastro en el depósito, y ese rastro
   * vale: para esa está la baja.
   */
  it('no se borra la que ya tiene movimientos de stock', async () => {
    const p = await producto({ stock: 0 });
    await db.insert(stockMovements).values({
      productId: p.id,
      tipo: 'ingreso',
      cantidad: 5,
      stockResultante: 5,
      usuarioId: duenio,
    });

    expect((await motivosParaNoEliminar(db, p.id)).join(' ')).toMatch(/libro de stock/i);
    await expect(
      eliminarProducto(db, { productId: p.id, usuarioId: duenio }),
    ).rejects.toThrow(/no se puede borrar/i);

    expect(await db.select().from(products)).toHaveLength(1);
    expect(await db.select().from(stockMovements)).toHaveLength(1);
  });

  /*
   * Después de borrar la fila ya no hay de dónde leer qué era, y es justo lo
   * que hay que poder contestar mañana.
   */
  it('queda en la bitácora con el nombre que tenía', async () => {
    const p = await producto({ nombre: 'Prueba que quedó' });
    await eliminarProducto(db, { productId: p.id, usuarioId: duenio });

    const [entrada] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.accion, 'producto.eliminar'));
    expect(entrada!.valorAnterior).toMatchObject({ nombre: 'Prueba que quedó' });
    expect(entrada!.entidadId).toBe(p.id);
  });

  it('no se borra lo que está publicado en la tienda', async () => {
    const p = await producto({ wooId: 7001 });

    expect(await motivosParaNoEliminar(db, p.id)).toHaveLength(1);
    await expect(
      eliminarProducto(db, { productId: p.id, usuarioId: duenio }),
    ).rejects.toThrow(/tienda online/i);

    expect(await db.select().from(products)).toHaveLength(1);
  });

  it('no se borra lo que ya se vendió', async () => {
    const [caja] = await db
      .insert(monetaryAccounts)
      .values({ nombre: 'Caja', tipo: 'efectivo' })
      .returning();
    const [sesion] = await db
      .insert(cashSessions)
      .values({
        monetaryAccountId: caja!.id,
        terminal: 'T1',
        abiertaPorId: duenio,
        saldoInicialCentavos: 0,
      })
      .returning();
    await db.insert(customers).values({ nombre: 'Alguien' });

    const p = await producto({ stock: 5 });
    await confirmarVenta(db, {
      lineas: [{ productId: p.id, cantidad: 1 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 9_000_00 }],
      vendedorId: duenio,
      cashSessionId: sesion!.id,
      terminal: 'T1',
      idempotencyKey: 'una-venta',
    });

    const motivos = await motivosParaNoEliminar(db, p.id);
    expect(motivos.join(' ')).toMatch(/ya se vendió/i);

    await expect(
      eliminarProducto(db, { productId: p.id, usuarioId: duenio }),
    ).rejects.toThrow(/no se puede borrar/i);

    expect(await db.select().from(products)).toHaveLength(1);
  });

  it('una ficha limpia no tiene motivos para no borrarse', async () => {
    const p = await producto();
    expect(await motivosParaNoEliminar(db, p.id)).toEqual([]);
  });

  it('borrar lo que ya no está avisa en vez de romper', async () => {
    await expect(
      eliminarProducto(db, { productId: '11112222-3333-4444-5555-666677778888', usuarioId: duenio }),
    ).rejects.toThrow(/ya no está en el catálogo/i);
  });
});
