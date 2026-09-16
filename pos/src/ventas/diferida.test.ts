/**
 * Tests de la venta cobrada sin conexion (D56).
 *
 * Es la unica parte del sistema donde el precio lo pone la pantalla y donde el
 * stock puede quedar en negativo, asi que lo que se prueba aca es sobre todo
 * que esas excepciones esten acotadas a este camino y no se filtren a la venta
 * de siempre.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  auditLog,
  cashMovements,
  cashSessions,
  exchangeRates,
  monetaryAccounts,
  products,
  saleItems,
  sales,
  users,
} from '@/db/schema';
import { confirmarVenta, ErrorVenta, type SolicitudDeVenta } from './confirmar';
import { resumenDeSesion } from '@/caja/sesion';

let db: TestDb;
let vendedorId: string;
let cajaId: string;
let sesionId: string;
let vidrioId: string;
let iphoneId: string;

/** Ayer a las 20:30, que es cuando se corta la luz en el pueblo. */
function anoche(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(20, 30, 0, 0);
  return d;
}

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const [u] = await db.insert(users).values({ nombre: 'Vendedor', rol: 'seller' }).returning();
  vendedorId = u!.id;

  const [cuenta] = await db
    .insert(monetaryAccounts)
    .values({ nombre: 'Caja en efectivo', tipo: 'efectivo' })
    .returning();
  cajaId = cuenta!.id;

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

  await db
    .insert(exchangeRates)
    .values({ valorCentavos: 156_100, vigenteDesde: new Date(), origen: 'infodolar' });

  const prods = await db
    .insert(products)
    .values([
      { wooId: 6485, nombre: 'Vidrio templado 9D', sku: '531', precioCentavos: 500_000, stock: 3 },
      {
        wooId: 7001,
        nombre: 'iPhone 14 Pro 256GB',
        sku: 'IP14P-256',
        categoria: 'Smartphones nuevos',
        marca: 'Apple',
        moneda: 'USD',
        precioUsdCentavos: 137_000,
        precioCentavos: 213_900_000,
        stock: 1,
      },
    ])
    .returning();
  vidrioId = prods[0]!.id;
  iphoneId = prods[1]!.id;
});

function diferida(parcial: Partial<SolicitudDeVenta> = {}): SolicitudDeVenta {
  return {
    lineas: [{ productId: vidrioId, cantidad: 2 }],
    pagos: [{ medio: 'efectivo', montoCentavos: 1_000_000, monetaryAccountId: cajaId }],
    vendedorId,
    cashSessionId: sesionId,
    terminal: 'T1',
    idempotencyKey: `offline-${Math.random()}`,
    diferida: { capturadaEn: anoche(), preciosCobradosCentavos: [500_000] },
    ...parcial,
  };
}

describe('una venta cobrada sin conexion', () => {
  it('entra con la fecha del cobro y queda marcada', async () => {
    const cuando = anoche();
    const r = await confirmarVenta(
      db,
      diferida({ diferida: { capturadaEn: cuando, preciosCobradosCentavos: [500_000] } }),
    );

    const [venta] = await db.select().from(sales).where(eq(sales.id, r.id));
    expect(venta!.offline).toBe(true);
    expect(venta!.offlineCapturadaEn?.toISOString()).toBe(cuando.toISOString());
    // La fecha es la del cobro y no la de la carga: es cuando ocurrio, y todo
    // reporte se recorta por el calendario del local (D51).
    expect(venta!.fecha.toISOString()).toBe(cuando.toISOString());
    expect(venta!.offlineDesvioCentavos).toBe(0);
  });

  it('cobra el precio que se cobro, no el que dice el catalogo hoy', async () => {
    // Se cobro a $4.000 y mientras no habia internet el catalogo subio a $5.000.
    const r = await confirmarVenta(
      db,
      diferida({ diferida: { capturadaEn: anoche(), preciosCobradosCentavos: [400_000] } }),
    );

    const [venta] = await db.select().from(sales).where(eq(sales.id, r.id));
    expect(venta!.totalCentavos).toBe(800_000);

    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, r.id));
    expect(items[0]!.precioUnitarioCentavos).toBe(400_000);
  });

  /*
   * Lo importante no es que acepte el precio, sino que deje anotado cuanto se
   * aparto. Sin esto, la unica parte del sistema donde el navegador decide un
   * precio seria ademas la unica donde no queda rastro de que lo hizo.
   */
  it('deja anotada la diferencia contra el catalogo, por unidad y con signo', async () => {
    const barato = await confirmarVenta(
      db,
      diferida({ diferida: { capturadaEn: anoche(), preciosCobradosCentavos: [400_000] } }),
    );
    const [v1] = await db.select().from(sales).where(eq(sales.id, barato.id));
    expect(v1!.offlineDesvioCentavos).toBe(-200_000); // $1.000 menos × 2 unidades
    expect(barato.desvioCentavos).toBe(-200_000);

    const caro = await confirmarVenta(
      db,
      diferida({
        pagos: [{ medio: 'efectivo', montoCentavos: 1_100_000, monetaryAccountId: cajaId }],
        diferida: { capturadaEn: anoche(), preciosCobradosCentavos: [550_000] },
      }),
    );
    const [v2] = await db.select().from(sales).where(eq(sales.id, caro.id));
    expect(v2!.offlineDesvioCentavos).toBe(100_000);
  });

  it('la bitacora guarda lo cobrado contra lo del catalogo, renglon por renglon', async () => {
    const r = await confirmarVenta(
      db,
      diferida({ diferida: { capturadaEn: anoche(), preciosCobradosCentavos: [400_000] } }),
    );

    const [linea] = await db.select().from(auditLog).where(eq(auditLog.entidadId, r.id));
    const anotado = linea!.valorNuevo as {
      offline: boolean;
      precios: { cobradoCentavos: number; catalogoCentavos: number }[];
    };
    expect(anotado.offline).toBe(true);
    expect(anotado.precios[0]).toMatchObject({
      cobradoCentavos: 400_000,
      catalogoCentavos: 500_000,
    });
  });

  it('la plata entra a la caja igual que cualquier venta', async () => {
    await confirmarVenta(db, diferida());

    const movs = await db.select().from(cashMovements);
    expect(movs).toHaveLength(1);
    expect(movs[0]!.montoCentavos).toBe(1_000_000);

    const [cuenta] = await db
      .select()
      .from(monetaryAccounts)
      .where(eq(monetaryAccounts.id, cajaId));
    expect(cuenta!.saldoCentavos).toBe(1_000_000);
  });
});

describe('el stock que no habia', () => {
  /*
   * Sin conexion el POS no puede reservar nada, asi que dos terminales pueden
   * haber vendido la ultima unidad. Rechazar la venta al subirla no devuelve el
   * producto que el cliente ya se llevo: solo esconde que faltan dos.
   */
  it('entra aunque no haya stock, y lo deja en negativo', async () => {
    const r = await confirmarVenta(
      db,
      diferida({
        lineas: [{ productId: vidrioId, cantidad: 5 }],
        pagos: [{ medio: 'efectivo', montoCentavos: 2_500_000, monetaryAccountId: cajaId }],
        diferida: { capturadaEn: anoche(), preciosCobradosCentavos: [500_000] },
      }),
    );

    expect(r.dejoStockEnRojo).toBe(true);

    const [prod] = await db.select().from(products).where(eq(products.id, vidrioId));
    expect(prod!.stock).toBe(-2);
  });

  it('con stock de sobra no avisa nada', async () => {
    const r = await confirmarVenta(db, diferida());
    expect(r.dejoStockEnRojo).toBe(false);

    const [prod] = await db.select().from(products).where(eq(products.id, vidrioId));
    expect(prod!.stock).toBe(1);
  });

  /* La excepcion es solo de este camino: la venta de siempre sigue frenando. */
  it('una venta normal sin stock se sigue rechazando', async () => {
    await expect(
      confirmarVenta(db, {
        lineas: [{ productId: vidrioId, cantidad: 5 }],
        pagos: [{ medio: 'efectivo', montoCentavos: 2_500_000, monetaryAccountId: cajaId }],
        vendedorId,
        cashSessionId: sesionId,
        terminal: 'T1',
        idempotencyKey: 'normal-sin-stock',
      }),
    ).rejects.toThrow(ErrorVenta);

    const [prod] = await db.select().from(products).where(eq(products.id, vidrioId));
    expect(prod!.stock).toBe(3);
  });
});

describe('la guarda de precios', () => {
  /*
   * El iPhone en pesos con la cifra del dolar frena una venta normal (el error
   * de agosto). Una diferida ya se cobro: frenarla no deshace nada y la deja
   * trabada en el navegador para siempre. Lo que la reemplaza es el desvio.
   */
  it('no bloquea una venta ya cobrada, pero el desvio la delata', async () => {
    const r = await confirmarVenta(
      db,
      diferida({
        lineas: [{ productId: iphoneId, cantidad: 1 }],
        pagos: [{ medio: 'efectivo', montoCentavos: 630_000, monetaryAccountId: cajaId }],
        diferida: { capturadaEn: anoche(), preciosCobradosCentavos: [630_000] },
      }),
    );

    expect(r.totalCentavos).toBe(630_000);
    expect(r.desvioCentavos).toBeLessThan(0);
  });

  it('en una venta normal el mismo precio se sigue frenando', async () => {
    await expect(
      confirmarVenta(db, {
        lineas: [{ productId: iphoneId, cantidad: 1, precioManualCentavos: 630_000 }],
        pagos: [{ medio: 'efectivo', montoCentavos: 630_000, monetaryAccountId: cajaId }],
        vendedorId,
        cashSessionId: sesionId,
        terminal: 'T1',
        idempotencyKey: 'normal-iphone',
      }),
    ).rejects.toThrow(ErrorVenta);
  });
});

describe('el turno donde cae', () => {
  it('cae en el turno del cobro si sigue abierto', async () => {
    const r = await confirmarVenta(db, diferida());
    const [venta] = await db.select().from(sales).where(eq(sales.id, r.id));
    expect(venta!.cashSessionId).toBe(sesionId);
  });

  /*
   * Se corto internet a las ocho, se conto el cajon a las nueve y la conexion
   * volvio a las diez. Esa plata esta en el cajon igual: la venta entra en el
   * turno abierto ahora y el arqueo lo explica. Rechazarla la dejaria en el
   * navegador para siempre, que es la unica forma de perderla.
   */
  it('si ese turno ya cerro, cae en el que este abierto y el arqueo lo dice', async () => {
    await db
      .update(cashSessions)
      .set({ cerradaEn: new Date(), cerradaPorId: vendedorId })
      .where(eq(cashSessions.id, sesionId));

    const [nueva] = await db
      .insert(cashSessions)
      .values({
        monetaryAccountId: cajaId,
        terminal: 'T1',
        abiertaPorId: vendedorId,
        saldoInicialCentavos: 500_000,
      })
      .returning();

    const r = await confirmarVenta(db, diferida());

    const [venta] = await db.select().from(sales).where(eq(sales.id, r.id));
    expect(venta!.cashSessionId).toBe(nueva!.id);

    const resumen = await resumenDeSesion(db, nueva!.id);
    expect(resumen.ventasDiferidas).toBe(1);
    expect(resumen.ventasDiferidasCentavos).toBe(1_000_000);
    // Y sobre todo: avisa que se cobro antes de que este turno abriera.
    expect(resumen.ventasDeOtroTurno).toBe(1);
  });

  it('sin ningun turno abierto no entra: no hay cajon donde poner la plata', async () => {
    await db
      .update(cashSessions)
      .set({ cerradaEn: new Date(), cerradaPorId: vendedorId })
      .where(eq(cashSessions.id, sesionId));

    await expect(confirmarVenta(db, diferida())).rejects.toThrow(/caja abierta/i);
  });

  it('una venta cobrada dentro del turno no figura como de otro turno', async () => {
    await confirmarVenta(
      db,
      diferida({ diferida: { capturadaEn: new Date(), preciosCobradosCentavos: [500_000] } }),
    );

    const resumen = await resumenDeSesion(db, sesionId);
    expect(resumen.ventasDiferidas).toBe(1);
    expect(resumen.ventasDeOtroTurno).toBe(0);
  });
});

describe('subirla dos veces', () => {
  /* El caso normal: se corto la respuesta y la cola reintenta. */
  it('no cobra dos veces ni descuenta dos veces el stock', async () => {
    const clave = 'la-misma-clave';
    const primera = await confirmarVenta(db, diferida({ idempotencyKey: clave }));
    const segunda = await confirmarVenta(db, diferida({ idempotencyKey: clave }));

    expect(segunda.id).toBe(primera.id);
    expect(segunda.yaExistia).toBe(true);

    expect(await db.select().from(sales)).toHaveLength(1);
    const [prod] = await db.select().from(products).where(eq(products.id, vidrioId));
    expect(prod!.stock).toBe(1);
  });

  /*
   * El caso feo: se confirmo con conexion, la respuesta no llego y la pantalla
   * la guardo en la cola. Al subirla, la clave es la misma.
   */
  it('una venta que ya entro con conexion no vuelve a entrar como diferida', async () => {
    const clave = 'confirmada-y-perdida';
    const online = await confirmarVenta(db, {
      lineas: [{ productId: vidrioId, cantidad: 2 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 1_000_000, monetaryAccountId: cajaId }],
      vendedorId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: clave,
    });

    const desdeLaCola = await confirmarVenta(db, diferida({ idempotencyKey: clave }));

    expect(desdeLaCola.id).toBe(online.id);
    expect(await db.select().from(sales)).toHaveLength(1);

    const [venta] = await db.select().from(sales).where(eq(sales.id, online.id));
    // Y no se convierte en diferida al reintentarla: entro con conexion.
    expect(venta!.offline).toBe(false);
  });
});

describe('lo que no deja pasar', () => {
  it('sin el precio cobrado de un renglon, no entra', async () => {
    await expect(
      confirmarVenta(
        db,
        diferida({
          lineas: [
            { productId: vidrioId, cantidad: 1 },
            { productId: iphoneId, cantidad: 1 },
          ],
          diferida: { capturadaEn: anoche(), preciosCobradosCentavos: [500_000] },
        }),
      ),
    ).rejects.toThrow(/Falta lo que se cobro|Falta lo que se cobró/i);

    expect(await db.select().from(sales)).toHaveLength(0);
  });

  it('un precio cobrado negativo no entra', async () => {
    await expect(
      confirmarVenta(
        db,
        diferida({ diferida: { capturadaEn: anoche(), preciosCobradosCentavos: [-1] } }),
      ),
    ).rejects.toThrow(ErrorVenta);
  });

  /* La base tambien lo impide, no solo el dominio. */
  it('la base rechaza una venta marcada offline sin decir cuando se cobro', async () => {
    await expect(
      db.insert(sales).values({
        numero: 'T1-999999',
        terminal: 'T1',
        vendedorId,
        cashSessionId: sesionId,
        subtotalCentavos: 100,
        totalCentavos: 100,
        idempotencyKey: 'sin-fecha-de-cobro',
        offline: true,
      }),
    ).rejects.toThrow();
  });

  it('la base rechaza un desvio en una venta que no es offline', async () => {
    await expect(
      db.insert(sales).values({
        numero: 'T1-999998',
        terminal: 'T1',
        vendedorId,
        cashSessionId: sesionId,
        subtotalCentavos: 100,
        totalCentavos: 100,
        idempotencyKey: 'desvio-sin-offline',
        offlineDesvioCentavos: 5_000,
      }),
    ).rejects.toThrow();
  });

  /* Los montos de una venta cerrada son de solo lectura (D34). */
  it('la marca de offline no se puede reescribir despues', async () => {
    const r = await confirmarVenta(db, diferida());

    await expect(
      db.update(sales).set({ offline: false }).where(eq(sales.id, r.id)),
    ).rejects.toThrow();

    await expect(
      db.update(sales).set({ offlineDesvioCentavos: 99_999 }).where(eq(sales.id, r.id)),
    ).rejects.toThrow();
  });
});
