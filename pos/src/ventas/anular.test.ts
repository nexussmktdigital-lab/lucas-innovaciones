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
import { anularVenta, ErrorAnulacion, ventasDelTurno, ventasEnPeriodo } from './anular';

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

  it('trae el cliente y el turno, que es lo que la pantalla necesita para decidir', async () => {
    // El turno decide si se ofrece «Anular» o «Devolver»: una venta de un turno
    // cerrado no se anula. Y el cliente es por quien se busca una venta vieja.
    const venta = await venderVidrio(1);

    const [fila] = await ventasDelTurno(db, sesionId);

    expect(fila!.id).toBe(venta.id);
    expect(fila!.cashSessionId).toBe(sesionId);
    // Esta venta fue sin cliente, que es el caso del mostrador.
    expect(fila!.cliente).toBeNull();
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

/*
 * El historial. Hasta ahora la pantalla de Ventas solo mostraba el turno
 * abierto, y lo que se pregunta en el mostrador es «la venta del iPhone de la
 * semana pasada».
 */
describe('ventasEnPeriodo', () => {
  /*
   * Una venta con fecha de otro día.
   *
   * No se puede mover una venta ya hecha: un disparador de la 0001 las hace
   * inmutables salvo el estado, y está bien que así sea. La vía legítima es la
   * misma que usa una venta cobrada sin conexión, que entra con la hora en que
   * se cobró y no con la de ahora (D56).
   */
  async function venderEl(fecha: Date, cantidad = 1) {
    return confirmarVenta(db, {
      lineas: [{ productId: vidrioId, cantidad }],
      pagos: [{ medio: 'efectivo', montoCentavos: 500_000 * cantidad, monetaryAccountId: cajaId }],
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: `vieja-${Math.random()}`,
      diferida: {
        capturadaEn: fecha,
        preciosCobradosCentavos: [500_000],
      },
    });
  }

  const UN_DIA = 24 * 60 * 60 * 1000;

  it('trae las de ese rango y deja afuera las de otros días', async () => {
    const ahora = new Date();
    const hoy = await venderVidrio(1);
    const ayer = await venderEl(new Date(ahora.getTime() - UN_DIA));
    await venderEl(new Date(ahora.getTime() - 8 * UN_DIA));

    const ultimaSemana = await ventasEnPeriodo(
      db,
      new Date(ahora.getTime() - 6 * UN_DIA),
      new Date(ahora.getTime() + UN_DIA),
    );

    expect(ultimaSemana.map((v) => v.numero).sort()).toEqual([hoy.numero, ayer.numero].sort());
  });

  it('el límite de arriba es exclusivo, así «ayer» no se come lo de hoy', async () => {
    /*
     * Un límite inclusivo deja afuera la última fracción de segundo del día, y
     * un período que termina a las 00:00 de hoy no tiene que traer la venta de
     * las 00:00 de hoy. Es el mismo criterio que usan los reportes.
     */
    const corte = new Date('2026-06-15T03:00:00Z');
    await venderEl(corte);

    const hasta = await ventasEnPeriodo(db, new Date('2026-06-14T03:00:00Z'), corte);
    const incluye = await ventasEnPeriodo(
      db,
      corte,
      new Date('2026-06-16T03:00:00Z'),
    );

    expect(hasta).toHaveLength(0);
    expect(incluye).toHaveLength(1);
  });

  it('las anuladas siguen apareciendo: el comprobante se reimprime igual', async () => {
    const venta = await venderVidrio(1);
    await anularVenta(db, { ventaId: venta.id, usuarioId: duenioId, motivo: 'Prueba' });

    const ahora = new Date();
    const lista = await ventasEnPeriodo(
      db,
      new Date(ahora.getTime() - UN_DIA),
      new Date(ahora.getTime() + UN_DIA),
    );

    expect(lista).toHaveLength(1);
    expect(lista[0]!.estado).toBe('cancelled');
  });

  it('de la más nueva a la más vieja', async () => {
    const ahora = new Date();
    const vieja = await venderEl(new Date(ahora.getTime() - 3 * UN_DIA));
    const nueva = await venderVidrio(2);

    const lista = await ventasEnPeriodo(
      db,
      new Date(ahora.getTime() - 7 * UN_DIA),
      new Date(ahora.getTime() + UN_DIA),
    );

    expect(lista.map((v) => v.numero)).toEqual([nueva.numero, vieja.numero]);
  });
});
