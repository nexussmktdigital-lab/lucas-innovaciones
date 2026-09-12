/**
 * Tests de la anulacion de venta.
 *
 * Corren contra PGlite con las migraciones reales: los disparadores de
 * inmutabilidad estan puestos, asi que si la anulacion intentara borrar algo,
 * el test lo veria.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  auditLog,
  cashMovements,
  cashSessions,
  monetaryAccounts,
  productVariants,
  products,
  sales,
  stockMovements,
  syncQueue,
  users,
} from '@/db/schema';
import { confirmarVenta } from './confirmar';
import { anularVenta, ErrorAnulacion, ventasDelTurno } from './anular';

let db: TestDb;
let duenioId: string;
let cajaId: string;
let sesionId: string;
let vidrioId: string;
let varianteId: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const [u] = await db.insert(users).values({ nombre: 'Lucas', rol: 'owner' }).returning();
  duenioId = u!.id;

  const [c] = await db
    .insert(monetaryAccounts)
    .values({ nombre: 'Caja en efectivo', tipo: 'efectivo' })
    .returning();
  cajaId = c!.id;

  const [s] = await db
    .insert(cashSessions)
    .values({
      monetaryAccountId: cajaId,
      terminal: 'T1',
      abiertaPorId: duenioId,
      saldoInicialCentavos: 0,
    })
    .returning();
  sesionId = s!.id;

  const [p] = await db
    .insert(products)
    .values({ wooId: 6485, nombre: 'Vidrio templado 9D', precioCentavos: 500_000, stock: 40 })
    .returning();
  vidrioId = p!.id;

  const [v] = await db
    .insert(productVariants)
    .values({
      productId: vidrioId,
      wooId: 6486,
      nombre: '6.7 pulgadas',
      precioCentavos: 800_000,
      stock: 3,
      gestionaStock: true,
    })
    .returning();
  varianteId = v!.id;
});

async function venderVidrio(cantidad = 2) {
  return confirmarVenta(db, {
    lineas: [{ productId: vidrioId, cantidad }],
    pagos: [
      { medio: 'efectivo', montoCentavos: 500_000 * cantidad, monetaryAccountId: cajaId },
    ],
    vendedorId: duenioId,
    cashSessionId: sesionId,
    terminal: 'T1',
    idempotencyKey: `venta-${Math.random()}`,
  });
}

describe('anularVenta', () => {
  it('repone el stock, saca la plata de la caja y deja la venta marcada', async () => {
    const venta = await venderVidrio(2);

    const r = await anularVenta(db, {
      ventaId: venta.id,
      usuarioId: duenioId,
      motivo: 'Se cargó el modelo equivocado',
    });

    expect(r.unidadesRepuestas).toBe(2);
    expect(r.revertidoCentavos).toBe(1_000_000);

    const [p] = await db.select().from(products).where(eq(products.id, vidrioId));
    expect(p!.stock).toBe(40);

    const [cuenta] = await db
      .select()
      .from(monetaryAccounts)
      .where(eq(monetaryAccounts.id, cajaId));
    expect(cuenta!.saldoCentavos).toBe(0);

    const [enBase] = await db.select().from(sales).where(eq(sales.id, venta.id));
    expect(enBase!.estado).toBe('cancelled');
    expect(enBase!.motivoAnulacion).toBe('Se cargó el modelo equivocado');
  });

  it('nada se borra: quedan los asientos contrarios', async () => {
    const venta = await venderVidrio(2);
    await anularVenta(db, { ventaId: venta.id, usuarioId: duenioId, motivo: 'Prueba' });

    const stock = await db.select().from(stockMovements);
    expect(stock).toHaveLength(2);
    expect(stock.map((m) => m.tipo).sort()).toEqual(['devolucion', 'venta']);

    const caja = await db.select().from(cashMovements);
    // Apertura en cero no genera asiento: queda la venta y su anulación.
    expect(caja.map((m) => m.tipo).sort()).toEqual(['anulacion', 'venta']);
    expect(caja.reduce((s, m) => s + m.montoCentavos, 0)).toBe(0);
  });

  it('devuelve el stock a la variación de la que salió', async () => {
    const venta = await confirmarVenta(db, {
      lineas: [{ productId: vidrioId, variantId: varianteId, cantidad: 2 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 1_600_000, monetaryAccountId: cajaId }],
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: 'venta-variante',
    });

    await anularVenta(db, { ventaId: venta.id, usuarioId: duenioId, motivo: 'Se arrepintió' });

    const [v] = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, varianteId));
    const [p] = await db.select().from(products).where(eq(products.id, vidrioId));

    expect(v!.stock).toBe(3);
    expect(p!.stock).toBe(40); // el padre nunca se tocó
  });

  it('le avisa a WooCommerce del stock repuesto', async () => {
    const venta = await venderVidrio(2);
    await anularVenta(db, { ventaId: venta.id, usuarioId: duenioId, motivo: 'Prueba' });

    const cola = await db.select().from(syncQueue);
    expect(cola).toHaveLength(2);
    const anulacion = cola.find((x) => x.idempotencyKey.startsWith('anulacion:'));
    expect((anulacion!.payload as { items: { stockResultante: number }[] }).items[0]).toMatchObject(
      { wooId: 6485, stockResultante: 40 },
    );
  });

  it('queda en la bitácora con el motivo', async () => {
    const venta = await venderVidrio(1);
    await anularVenta(db, { ventaId: venta.id, usuarioId: duenioId, motivo: 'Cobro duplicado' });

    const bitacora = await db.select().from(auditLog);
    const anulacion = bitacora.find((x) => x.accion === 'venta.anular');
    expect(anulacion).toBeDefined();
    expect((anulacion!.valorNuevo as { motivo: string }).motivo).toBe('Cobro duplicado');
  });

  it('no se anula dos veces', async () => {
    const venta = await venderVidrio(1);
    await anularVenta(db, { ventaId: venta.id, usuarioId: duenioId, motivo: 'Prueba' });

    await expect(
      anularVenta(db, { ventaId: venta.id, usuarioId: duenioId, motivo: 'Otra vez' }),
    ).rejects.toMatchObject({ motivo: 'ya_anulada' });

    // Y el stock no se repuso dos veces.
    const [p] = await db.select().from(products).where(eq(products.id, vidrioId));
    expect(p!.stock).toBe(40);
  });

  it('exige un motivo', async () => {
    const venta = await venderVidrio(1);
    await expect(
      anularVenta(db, { ventaId: venta.id, usuarioId: duenioId, motivo: '   ' }),
    ).rejects.toMatchObject({ motivo: 'datos_invalidos' });
  });

  it('no anula una venta de un turno ya cerrado', async () => {
    const venta = await venderVidrio(1);
    await db
      .update(cashSessions)
      .set({ cerradaEn: new Date() })
      .where(eq(cashSessions.id, sesionId));

    await expect(
      anularVenta(db, { ventaId: venta.id, usuarioId: duenioId, motivo: 'Tarde' }),
    ).rejects.toMatchObject({ motivo: 'otro_turno' });
  });

  it('avisa cuando la venta no existe', async () => {
    await expect(
      anularVenta(db, {
        ventaId: '00000000-0000-0000-0000-000000000000',
        usuarioId: duenioId,
        motivo: 'Prueba',
      }),
    ).rejects.toBeInstanceOf(ErrorAnulacion);
  });
});

describe('ventasDelTurno', () => {
  it('lista las ventas del turno con lo que hace falta para reimprimir', async () => {
    await venderVidrio(1);
    const segunda = await venderVidrio(2);
    await anularVenta(db, { ventaId: segunda.id, usuarioId: duenioId, motivo: 'Se arrepintió' });

    const lista = await ventasDelTurno(db, sesionId);

    expect(lista).toHaveLength(2);
    const anulada = lista.find((v) => v.numero === segunda.numero)!;
    expect(anulada.estado).toBe('cancelled');
    expect(anulada.motivoAnulacion).toBe('Se arrepintió');
    expect(anulada.unidades).toBe(2);
    expect(anulada.medios).toEqual(['efectivo']);
    expect(anulada.detalle).toContain('Vidrio templado 9D');
    expect(anulada.vendedor).toBe('Lucas');
  });

  it('una venta anulada no cuenta en el arqueo del turno', async () => {
    const venta = await venderVidrio(2);
    await anularVenta(db, { ventaId: venta.id, usuarioId: duenioId, motivo: 'Prueba' });

    const { resumenDeSesion } = await import('@/caja/sesion');
    const resumen = await resumenDeSesion(db, sesionId);

    expect(resumen.cantidadDeVentas).toBe(0);
    expect(resumen.efectivoEsperadoCentavos).toBe(0);
  });
});
