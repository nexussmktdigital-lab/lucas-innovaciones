/**
 * Tests de las garantias que da la BASE, no la aplicacion.
 *
 * Corren contra PGlite con las migraciones reales aplicadas, asi que lo que
 * pasa aca es lo que va a pasar en Neon.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, rechazaCon, type TestDb } from './test-db';
import { sembrar } from './seed';
import {
  auditLog,
  cashSessions,
  expenses,
  legacySales,
  monetaryAccounts,
  products,
  sales,
  stockMovements,
  users,
} from './schema';

let db: TestDb;
let usuarioId: string;
let productoId: string;
let cuentaId: string;
let ventaId: string;
let categoriaGastoId: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();

  const [u] = await db
    .insert(users)
    .values({ nombre: 'Dueño de prueba', rol: 'owner', email: 'duenio@test.local' })
    .returning();
  usuarioId = u!.id;

  const [p] = await db
    .insert(products)
    .values({ nombre: 'Vidrio templado 9D', sku: '531', precioCentavos: 500_000, stock: 10 })
    .returning();
  productoId = p!.id;

  const [c] = await db
    .insert(monetaryAccounts)
    .values({ nombre: 'Caja en efectivo', tipo: 'efectivo' })
    .returning();
  cuentaId = c!.id;

  const [v] = await db
    .insert(sales)
    .values({
      numero: 'T1-000001',
      terminal: 'T1',
      vendedorId: usuarioId,
      subtotalCentavos: 500_000,
      totalCentavos: 500_000,
      idempotencyKey: 'venta-de-prueba-1',
    })
    .returning();
  ventaId = v!.id;

  const cat = await db.$cliente.query<{ id: string }>(
    `INSERT INTO expense_categories (nombre) VALUES ('Alquiler') RETURNING id`,
  );
  categoriaGastoId = cat.rows[0]!.id;
});

/** Inserta una linea de venta por SQL crudo, salteando toda validacion de la app. */
function insertarLineaCruda(columnas: string, valores: string, params: unknown[] = []) {
  return db.$cliente.query(
    `INSERT INTO sale_items (${columnas}) VALUES (${valores})`,
    params,
  );
}

describe('linea de venta sin producto (D24)', () => {
  it('un INSERT directo por SQL sin product_id falla', async () => {
    await rechazaCon(
      insertarLineaCruda(
        'sale_id, descripcion, cantidad, precio_unitario_centavos, total_centavos',
        `$1, 'Varios', 1, 8937500, 8937500`,
        [ventaId],
      ),
      /product_id/i,
    );
  });

  it('un INSERT con product_id nulo explicito falla', async () => {
    await rechazaCon(
      insertarLineaCruda(
        'sale_id, product_id, descripcion, cantidad, precio_unitario_centavos, total_centavos',
        `$1, NULL, 'Gaby Gonzalez', 1, 10000000, 10000000`,
        [ventaId],
      ),
      /product_id/i,
    );
  });

  it('un INSERT con un product_id inventado falla por clave foranea', async () => {
    await rechazaCon(
      insertarLineaCruda(
        'sale_id, product_id, descripcion, cantidad, precio_unitario_centavos, total_centavos',
        `$1, '00000000-0000-0000-0000-000000000000', 'Chip', 1, 220500, 220500`,
        [ventaId],
      ),
      /foreign key|foránea/i,
    );
  });

  it('con un producto real entra sin problema', async () => {
    const r = await db.$cliente.query(
      `INSERT INTO sale_items (sale_id, product_id, descripcion, cantidad, precio_unitario_centavos, total_centavos)
       VALUES ($1, $2, 'Vidrio templado 9D', 2, 500000, 1000000) RETURNING id`,
      [ventaId, productoId],
    );
    expect(r.rows).toHaveLength(1);
  });

  it('rechaza cantidad cero o negativa', async () => {
    await rechazaCon(
      insertarLineaCruda(
        'sale_id, product_id, descripcion, cantidad, precio_unitario_centavos, total_centavos',
        `$1, $2, 'Vidrio', 0, 500000, 0`,
        [ventaId, productoId],
      ),
      /sale_items_cantidad_ck/i,
    );
  });
});

describe('bitacora inmutable', () => {
  it('no se puede modificar un registro de auditoria', async () => {
    const [r] = await db
      .insert(auditLog)
      .values({ usuarioId, accion: 'venta.crear', entidad: 'sales', entidadId: ventaId })
      .returning();

    await rechazaCon(
      db.update(auditLog).set({ accion: 'otra.cosa' }).where(eq(auditLog.id, r!.id)),
      /solo agregado/i,
    );
  });

  it('no se puede borrar un registro de auditoria', async () => {
    const [r] = await db
      .insert(auditLog)
      .values({ usuarioId, accion: 'stock.ajustar', entidad: 'products', entidadId: productoId })
      .returning();

    await rechazaCon(db.delete(auditLog).where(eq(auditLog.id, r!.id)), /solo agregado/i);
  });
});

describe('nada se borra jamas', () => {
  it('no se puede borrar una venta', async () => {
    await rechazaCon(db.delete(sales).where(eq(sales.id, ventaId)), /solo agregado/i);
  });

  it('no se puede modificar ni borrar un movimiento de stock', async () => {
    const [m] = await db
      .insert(stockMovements)
      .values({ productId: productoId, tipo: 'venta', cantidad: -2, stockResultante: 8, usuarioId })
      .returning();

    await rechazaCon(
      db.update(stockMovements).set({ cantidad: -1 }).where(eq(stockMovements.id, m!.id)),
      /solo agregado/i,
    );
    await rechazaCon(
      db.delete(stockMovements).where(eq(stockMovements.id, m!.id)),
      /solo agregado/i,
    );
  });

  it('el historico del POS viejo es de solo lectura', async () => {
    const [l] = await db
      .insert(legacySales)
      .values({
        referenciaExterna: 'yith-3764',
        fecha: new Date('2026-07-01T15:00:00Z'),
        totalCentavos: 7_000_000,
        sinProducto: true,
      })
      .returning();

    await rechazaCon(
      db.update(legacySales).set({ totalCentavos: 1 }).where(eq(legacySales.id, l!.id)),
      /solo agregado/i,
    );
  });
});

describe('idempotencia de la venta', () => {
  it('la misma clave de idempotencia no puede entrar dos veces', async () => {
    const base = {
      terminal: 'T1',
      vendedorId: usuarioId,
      subtotalCentavos: 100,
      totalCentavos: 100,
      idempotencyKey: 'clave-repetida',
    };
    await db.insert(sales).values({ ...base, numero: 'T1-000900' });
    await rechazaCon(
      db.insert(sales).values({ ...base, numero: 'T1-000901' }),
      /sales_idempotency_uq/i,
    );
  });

  it('el numero de venta es unico', async () => {
    await rechazaCon(
      db.insert(sales).values({
        numero: 'T1-000001',
        terminal: 'T1',
        vendedorId: usuarioId,
        subtotalCentavos: 100,
        totalCentavos: 100,
        idempotencyKey: 'otra-clave',
      }),
      /sales_numero_uq/i,
    );
  });
});

describe('caja', () => {
  it('no puede haber dos sesiones abiertas en la misma terminal', async () => {
    await db.insert(cashSessions).values({
      monetaryAccountId: cuentaId,
      terminal: 'T9',
      abiertaPorId: usuarioId,
      saldoInicialCentavos: 0,
    });

    await rechazaCon(
      db.insert(cashSessions).values({
        monetaryAccountId: cuentaId,
        terminal: 'T9',
        abiertaPorId: usuarioId,
        saldoInicialCentavos: 0,
      }),
      /cash_sessions_abierta_uq/i,
    );
  });

  it('cerrada la sesion, se puede abrir otra en la misma terminal', async () => {
    await db
      .update(cashSessions)
      .set({ cerradaEn: new Date(), cerradaPorId: usuarioId })
      .where(eq(cashSessions.terminal, 'T9'));

    const [nueva] = await db
      .insert(cashSessions)
      .values({
        monetaryAccountId: cuentaId,
        terminal: 'T9',
        abiertaPorId: usuarioId,
        saldoInicialCentavos: 1_000_000,
      })
      .returning();
    expect(nueva!.cerradaEn).toBeNull();
  });
});

describe('productos en dolares', () => {
  it('un producto marcado USD sin precio en dolares no entra', async () => {
    await rechazaCon(
      db.insert(products).values({ nombre: 'iPhone 14 Pro 256GB', moneda: 'USD' }),
      /products_usd_ck/i,
    );
  });

  it('con precio en dolares cargado, entra', async () => {
    const [p] = await db
      .insert(products)
      .values({
        nombre: 'iPhone 14 Pro 256GB',
        moneda: 'USD',
        precioUsdCentavos: 137_000,
        precioCentavos: 215_200_000,
      })
      .returning();
    expect(p!.precioUsdCentavos).toBe(137_000);
    expect(p!.precioCentavos).toBe(215_200_000);
  });
});

describe('gastos', () => {
  it('un gasto pagado sin cuenta monetaria no entra: la caja no cerraria', async () => {
    await rechazaCon(
      db.insert(expenses).values({
        fecha: '2026-09-01',
        categoryId: categoriaGastoId,
        descripcion: 'Alquiler septiembre',
        montoCentavos: 50_000_000,
        estado: 'pagado',
        cargadoPorId: usuarioId,
      }),
      /expenses_pagado_ck/i,
    );
  });

  it('un gasto pendiente si puede quedar sin cuenta: todavia no salio plata', async () => {
    const [pendiente] = await db
      .insert(expenses)
      .values({
        fecha: '2026-09-01',
        categoryId: categoriaGastoId,
        descripcion: 'Alquiler octubre',
        montoCentavos: 50_000_000,
        estado: 'pendiente',
        vencimiento: '2026-10-05',
        cargadoPorId: usuarioId,
      })
      .returning();
    expect(pendiente!.estado).toBe('pendiente');
  });

  it('un gasto pagado con cuenta y medio entra', async () => {
    const [ok] = await db
      .insert(expenses)
      .values({
        fecha: '2026-09-01',
        categoryId: categoriaGastoId,
        descripcion: 'Alquiler septiembre',
        montoCentavos: 50_000_000,
        estado: 'pagado',
        medio: 'efectivo',
        monetaryAccountId: cuentaId,
        cargadoPorId: usuarioId,
      })
      .returning();
    expect(ok!.montoCentavos).toBe(50_000_000);
  });
});

describe('sembrar', () => {
  it('omite el catálogo de prueba cuando ya hay catálogo real sincronizado', async () => {
    const otra = await crearBaseDePrueba();

    // Simula un catálogo traído de WooCommerce: lo que lo distingue es
    // `lastSyncedAt`, que solo pone la sincronización.
    await otra.insert(products).values(
      Array.from({ length: 60 }, (_, i) => ({
        wooId: 20_000 + i,
        nombre: `Producto real ${i}`,
        precioCentavos: 100_000,
        lastSyncedAt: new Date(),
      })),
    );

    const r = await sembrar(otra);
    expect(r.catalogoOmitido).toBe(true);
    expect(r.productos).toBe(0);

    // Los usuarios y las cuentas sí se crean: hacen falta para poder entrar.
    const usuarios = await otra.select().from(users);
    expect(usuarios.length).toBeGreaterThan(0);

    // Y no se coló ningún producto de prueba.
    const conServicio = await otra.select().from(products).where(eq(products.esServicio, true));
    expect(conServicio).toHaveLength(0);
  });

  it('con la base vacía sí carga el catálogo de prueba', async () => {
    const otra = await crearBaseDePrueba();
    const r = await sembrar(otra);
    expect(r.catalogoOmitido).toBe(false);
    expect(r.productos).toBeGreaterThan(0);
    expect((await otra.select().from(products)).length).toBe(r.productos);
  });
});
