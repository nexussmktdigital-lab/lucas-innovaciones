/**
 * Tests de la confirmacion de venta.
 *
 * Corren contra PGlite con las migraciones reales, asi que prueban la
 * transaccion de verdad: candados, restricciones y disparadores incluidos.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  auditLog,
  cashMovements,
  cashSessions,
  customers,
  exchangeRates,
  monetaryAccounts,
  products,
  saleItems,
  salePayments,
  sales,
  stockMovements,
  syncQueue,
  users,
} from '@/db/schema';
import { confirmarVenta, ErrorVenta, type SolicitudDeVenta } from './confirmar';

const TC = 156_100; // $1.561,00

let db: TestDb;
let vendedorId: string;
let cajaId: string;
let bancoId: string;
let sesionId: string;
let vidrioId: string;
let iphoneId: string;
let servicioId: string;
let clienteId: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const [u] = await db
    .insert(users)
    .values({ nombre: 'Vendedor', rol: 'seller' })
    .returning();
  vendedorId = u!.id;

  const cuentas = await db
    .insert(monetaryAccounts)
    .values([
      { nombre: 'Caja en efectivo', tipo: 'efectivo' },
      { nombre: 'Banco', tipo: 'banco' },
    ])
    .returning();
  cajaId = cuentas[0]!.id;
  bancoId = cuentas[1]!.id;

  const [s] = await db
    .insert(cashSessions)
    .values({
      monetaryAccountId: cajaId,
      terminal: 'T1',
      abiertaPorId: vendedorId,
      saldoInicialCentavos: 1_000_000,
    })
    .returning();
  sesionId = s!.id;

  await db.insert(exchangeRates).values({
    valorCentavos: TC,
    vigenteDesde: new Date(),
    origen: 'infodolar',
  });

  const prods = await db
    .insert(products)
    .values([
      {
        wooId: 6485,
        nombre: 'Vidrio templado 9D',
        sku: '531',
        precioCentavos: 500_000,
        stock: 40,
        costoCentavos: 200_000,
      },
      {
        wooId: 7001,
        nombre: 'iPhone 14 Pro 256GB',
        sku: 'IP14P-256',
        moneda: 'USD',
        precioUsdCentavos: 137_000,
        precioCentavos: 213_900_000,
        stock: 1,
      },
      {
        wooId: 9001,
        nombre: 'Servicio técnico · Reparación',
        sku: 'SERV-REPAR',
        precioCentavos: 0,
        stock: 0,
        gestionaStock: false,
        esServicio: true,
        precioEditable: true,
      },
    ])
    .returning();
  vidrioId = prods[0]!.id;
  iphoneId = prods[1]!.id;
  servicioId = prods[2]!.id;

  const [c] = await db.insert(customers).values({ nombre: 'Mayco Villafañe' }).returning();
  clienteId = c!.id;
});

function solicitud(parcial: Partial<SolicitudDeVenta> = {}): SolicitudDeVenta {
  return {
    lineas: [{ productId: vidrioId, cantidad: 2 }],
    pagos: [{ medio: 'efectivo', montoCentavos: 1_000_000, monetaryAccountId: cajaId }],
    vendedorId,
    cashSessionId: sesionId,
    terminal: 'T1',
    idempotencyKey: `prueba-${Math.random()}`,
    ...parcial,
  };
}

describe('venta de contado', () => {
  it('registra la venta completa: líneas, pago, stock, caja, cola y auditoría', async () => {
    const r = await confirmarVenta(db, solicitud());

    expect(r.numero).toBe('T1-000001');
    expect(r.totalCentavos).toBe(1_000_000);
    expect(r.yaExistia).toBe(false);

    const [venta] = await db.select().from(sales).where(eq(sales.id, r.id));
    expect(venta!.estado).toBe('completed');
    expect(venta!.tipo).toBe('contado');
    expect(venta!.syncedToWoo).toBe(false);

    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, r.id));
    expect(items).toHaveLength(1);
    expect(items[0]!.cantidad).toBe(2);
    expect(items[0]!.totalCentavos).toBe(1_000_000);
    // El costo del momento queda congelado, para el margen.
    expect(items[0]!.costoCentavos).toBe(200_000);

    const pagos = await db.select().from(salePayments).where(eq(salePayments.saleId, r.id));
    expect(pagos).toHaveLength(1);

    const [prod] = await db.select().from(products).where(eq(products.id, vidrioId));
    expect(prod!.stock).toBe(38);

    const movs = await db.select().from(stockMovements);
    expect(movs).toHaveLength(1);
    expect(movs[0]!.cantidad).toBe(-2);
    expect(movs[0]!.stockResultante).toBe(38);

    const caja = await db.select().from(cashMovements);
    expect(caja).toHaveLength(1);
    expect(caja[0]!.montoCentavos).toBe(1_000_000);

    const [cuenta] = await db.select().from(monetaryAccounts).where(eq(monetaryAccounts.id, cajaId));
    expect(cuenta!.saldoCentavos).toBe(1_000_000);

    const cola = await db.select().from(syncQueue);
    expect(cola).toHaveLength(1);
    expect(cola[0]!.operacion).toBe('venta.descontar_stock');
    expect(cola[0]!.estado).toBe('pendiente');

    const bitacora = await db.select().from(auditLog);
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]!.accion).toBe('venta.confirmar');
  });

  it('numera correlativo por terminal', async () => {
    const a = await confirmarVenta(db, solicitud());
    const b = await confirmarVenta(db, solicitud());
    const c = await confirmarVenta(db, solicitud({ terminal: 'T2' }));

    expect(a.numero).toBe('T1-000001');
    expect(b.numero).toBe('T1-000002');
    expect(c.numero).toBe('T2-000001');
  });
});

describe('idempotencia', () => {
  it('reintentar tres veces la misma venta descuenta el stock una sola vez', async () => {
    const s = solicitud({ idempotencyKey: 'la-misma-clave' });

    const a = await confirmarVenta(db, s);
    const b = await confirmarVenta(db, s);
    const c = await confirmarVenta(db, s);

    expect(a.yaExistia).toBe(false);
    expect(b.yaExistia).toBe(true);
    expect(c.yaExistia).toBe(true);
    expect(b.id).toBe(a.id);
    expect(b.numero).toBe(a.numero);

    expect(await db.select().from(sales)).toHaveLength(1);

    const [prod] = await db.select().from(products).where(eq(products.id, vidrioId));
    expect(prod!.stock).toBe(38);

    const [cuenta] = await db.select().from(monetaryAccounts).where(eq(monetaryAccounts.id, cajaId));
    expect(cuenta!.saldoCentavos).toBe(1_000_000);
  });
});

describe('stock', () => {
  it('dos ventas de la última unidad: la segunda avisa y el stock nunca queda negativo', async () => {
    const primera = await confirmarVenta(
      db,
      solicitud({
        lineas: [{ productId: iphoneId, cantidad: 1 }],
        pagos: [{ medio: 'efectivo', montoCentavos: 213_900_000, monetaryAccountId: cajaId }],
      }),
    );
    expect(primera.numero).toBe('T1-000001');

    await expect(
      confirmarVenta(
        db,
        solicitud({
          lineas: [{ productId: iphoneId, cantidad: 1 }],
          pagos: [{ medio: 'efectivo', montoCentavos: 213_900_000, monetaryAccountId: cajaId }],
        }),
      ),
    ).rejects.toThrow(/No hay stock/);

    const [prod] = await db.select().from(products).where(eq(products.id, iphoneId));
    expect(prod!.stock).toBe(0);
    expect(await db.select().from(sales)).toHaveLength(1);
  });

  it('suma las cantidades cuando el mismo producto está en dos renglones', async () => {
    await expect(
      confirmarVenta(
        db,
        solicitud({
          lineas: [
            { productId: iphoneId, cantidad: 1 },
            { productId: iphoneId, cantidad: 1 },
          ],
          pagos: [{ medio: 'efectivo', montoCentavos: 427_800_000, monetaryAccountId: cajaId }],
        }),
      ),
    ).rejects.toThrow(/quedan 1 y se piden 2/);
  });

  it('una venta fallida no deja nada a medias', async () => {
    await expect(
      confirmarVenta(db, solicitud({ lineas: [{ productId: vidrioId, cantidad: 999 }] })),
    ).rejects.toThrow(ErrorVenta);

    expect(await db.select().from(sales)).toHaveLength(0);
    expect(await db.select().from(stockMovements)).toHaveLength(0);
    expect(await db.select().from(cashMovements)).toHaveLength(0);
    expect(await db.select().from(auditLog)).toHaveLength(0);

    const [prod] = await db.select().from(products).where(eq(products.id, vidrioId));
    expect(prod!.stock).toBe(40);
  });

  it('un servicio no descuenta stock', async () => {
    await confirmarVenta(
      db,
      solicitud({
        lineas: [{ productId: servicioId, cantidad: 1, precioManualCentavos: 1_475_000 }],
        pagos: [{ medio: 'efectivo', montoCentavos: 1_475_000, monetaryAccountId: cajaId }],
      }),
    );
    expect(await db.select().from(stockMovements)).toHaveLength(0);
    // Y no se encola nada a Woo, porque no hay stock que ajustar.
    expect(await db.select().from(syncQueue)).toHaveLength(0);
  });
});

describe('el servidor no confía en el cliente', () => {
  it('ignora el precio que manda el navegador y usa el del catálogo', async () => {
    const r = await confirmarVenta(
      db,
      solicitud({
        // El vidrio no es editable: este precio tiene que ser rechazado.
        lineas: [{ productId: vidrioId, cantidad: 1, precioManualCentavos: 1 }],
        pagos: [{ medio: 'efectivo', montoCentavos: 500_000, monetaryAccountId: cajaId }],
      }),
    ).catch((e: Error) => e);

    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toMatch(/No se puede cambiar el precio/);
  });

  it('acepta el precio escrito solo en un producto editable', async () => {
    const r = await confirmarVenta(
      db,
      solicitud({
        lineas: [{ productId: servicioId, cantidad: 1, precioManualCentavos: 4_500_000 }],
        pagos: [{ medio: 'efectivo', montoCentavos: 4_500_000, monetaryAccountId: cajaId }],
      }),
    );
    expect(r.totalCentavos).toBe(4_500_000);
  });

  it('rechaza un producto que ya no está en el catálogo', async () => {
    await expect(
      confirmarVenta(
        db,
        solicitud({ lineas: [{ productId: '00000000-0000-0000-0000-000000000000', cantidad: 1 }] }),
      ),
    ).rejects.toThrow(/ya no está en el catálogo/);
  });
});

describe('productos en dólares', () => {
  it('calcula el precio en pesos con el TC y lo congela en la venta', async () => {
    const r = await confirmarVenta(
      db,
      solicitud({
        lineas: [{ productId: iphoneId, cantidad: 1 }],
        pagos: [{ medio: 'efectivo', montoCentavos: 213_900_000, monetaryAccountId: cajaId }],
      }),
    );

    // USD 1.370 x 1.561 = 2.138.570 -> $2.139.000
    expect(r.totalCentavos).toBe(213_900_000);
    expect(r.tcAplicadoCentavos).toBe(TC);

    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, r.id));
    expect(item!.monedaOriginal).toBe('USD');
    expect(item!.precioUsdCentavos).toBe(137_000);
  });

  it('una venta sin productos en dólares no guarda cotización', async () => {
    const r = await confirmarVenta(db, solicitud());
    expect(r.tcAplicadoCentavos).toBeNull();
  });
});

describe('cobro', () => {
  it('pago mixto: a la caja entra solo el efectivo, al banco la transferencia', async () => {
    const r = await confirmarVenta(
      db,
      solicitud({
        lineas: [{ productId: vidrioId, cantidad: 16 }], // $80.000
        pagos: [
          { medio: 'efectivo', montoCentavos: 5_000_000, monetaryAccountId: cajaId },
          { medio: 'transferencia', montoCentavos: 3_000_000, monetaryAccountId: bancoId },
        ],
      }),
    );
    expect(r.totalCentavos).toBe(8_000_000);
    expect(r.vueltoCentavos).toBe(0);

    const [caja] = await db.select().from(monetaryAccounts).where(eq(monetaryAccounts.id, cajaId));
    const [banco] = await db.select().from(monetaryAccounts).where(eq(monetaryAccounts.id, bancoId));
    expect(caja!.saldoCentavos).toBe(5_000_000);
    expect(banco!.saldoCentavos).toBe(3_000_000);
  });

  it('con vuelto, a la caja entra el neto y no lo que entregó el cliente', async () => {
    const r = await confirmarVenta(
      db,
      solicitud({
        lineas: [{ productId: vidrioId, cantidad: 14 }], // $70.000
        pagos: [{ medio: 'efectivo', montoCentavos: 10_000_000, monetaryAccountId: cajaId }],
      }),
    );
    expect(r.totalCentavos).toBe(7_000_000);
    expect(r.vueltoCentavos).toBe(3_000_000);

    const [caja] = await db.select().from(monetaryAccounts).where(eq(monetaryAccounts.id, cajaId));
    expect(caja!.saldoCentavos).toBe(7_000_000);
  });

  it('rechaza un pago que no cubre el total', async () => {
    await expect(
      confirmarVenta(
        db,
        solicitud({ pagos: [{ medio: 'efectivo', montoCentavos: 100, monetaryAccountId: cajaId }] }),
      ),
    ).rejects.toThrow(/no cubre el total/);
  });

  it('la cuenta corriente marca la venta como fiado y no mueve plata', async () => {
    const r = await confirmarVenta(
      db,
      solicitud({
        clienteId,
        pagos: [{ medio: 'cuenta_corriente', montoCentavos: 1_000_000 }],
      }),
    );

    const [venta] = await db.select().from(sales).where(eq(sales.id, r.id));
    expect(venta!.tipo).toBe('fiado');
    expect(await db.select().from(cashMovements)).toHaveLength(0);

    const [caja] = await db.select().from(monetaryAccounts).where(eq(monetaryAccounts.id, cajaId));
    expect(caja!.saldoCentavos).toBe(0);
  });

  it('no deja fiar sin cliente', async () => {
    await expect(
      confirmarVenta(
        db,
        solicitud({ pagos: [{ medio: 'cuenta_corriente', montoCentavos: 1_000_000 }] }),
      ),
    ).rejects.toThrow(/cliente/);
  });
});

describe('caja', () => {
  it('no se puede vender sin una caja abierta', async () => {
    await db
      .update(cashSessions)
      .set({ cerradaEn: new Date(), cerradaPorId: vendedorId })
      .where(eq(cashSessions.id, sesionId));

    await expect(confirmarVenta(db, solicitud())).rejects.toThrow(/caja abierta/);
    expect(await db.select().from(sales)).toHaveLength(0);
  });
});

describe('carrito vacío', () => {
  it('no se confirma', async () => {
    await expect(confirmarVenta(db, solicitud({ lineas: [] }))).rejects.toThrow(ErrorVenta);
  });
});
