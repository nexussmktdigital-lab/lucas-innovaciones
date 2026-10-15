/**
 * Plan canje: el cliente paga parte de la compra con su teléfono usado.
 *
 * Lo que importa probar no es el alta —eso ya tiene sus tests— sino las tres
 * cosas que hacen que un canje no sea un pago cualquiera:
 *
 *  1. **No entra plata.** El cajón no se mueve, aunque la venta se cobre
 *     entera. Si entrara, el arqueo pediría justificar una diferencia que no
 *     existe.
 *  2. **Entra mercadería, con su costo.** El equipo queda en stock al valor de
 *     canje, que es contra lo que se va a calcular el margen al venderlo.
 *  3. **Las dos cosas o ninguna.** Misma transacción: un alta sin venta sería
 *     stock que nadie entregó.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { crearBaseDePrueba, rechazaCon, vaciar, type TestDb } from '@/db/test-db';
import {
  cashMovements,
  cashSessions,
  exchangeRates,
  monetaryAccounts,
  products,
  salePayments,
  sales,
  stockMovements,
  syncQueue,
  users,
} from '@/db/schema';
import { usdAPesos } from '@/lib/dinero';
import { confirmarVenta, ErrorVenta, type SolicitudDeVenta } from './confirmar';
import { nombreDelEquipo } from './canje';

const TC = 1_571_00;

let db: TestDb;
let vendedorId: string;
let cajaId: string;
let sesionId: string;
/** El iPhone que se vende: US$ 1.000. */
let iphoneId: string;
/** Un accesorio en pesos, para las ventas mezcladas. */
let fundaId: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const [u] = await db.insert(users).values({ nombre: 'Lucas', rol: 'owner' }).returning();
  vendedorId = u!.id;

  const [caja] = await db
    .insert(monetaryAccounts)
    .values({ nombre: 'Caja en efectivo', tipo: 'efectivo' })
    .returning();
  cajaId = caja!.id;

  const [s] = await db
    .insert(cashSessions)
    .values({
      monetaryAccountId: cajaId,
      terminal: 'T1',
      abiertaPorId: vendedorId,
      saldoInicialCentavos: 0,
    })
    .returning();
  sesionId = s!.id;

  await db
    .insert(exchangeRates)
    .values({ valorCentavos: TC, vigenteDesde: new Date(), origen: 'infodolar' });

  const prods = await db
    .insert(products)
    .values([
      {
        wooId: 7001,
        nombre: 'iPhone 16 Pro 256gb',
        sku: 'IP16P-256',
        categoria: 'Smartphones usados',
        marca: 'Apple',
        moneda: 'USD',
        precioUsdCentavos: 1_000_00,
        precioCentavos: usdAPesos(1_000_00, TC),
        stock: 1,
        costoCentavos: 120_000_000,
      },
      {
        wooId: 6485,
        nombre: 'Funda silicona',
        sku: 'FUN-1',
        precioCentavos: 15_000_00,
        stock: 10,
      },
    ])
    .returning();
  iphoneId = prods[0]!.id;
  fundaId = prods[1]!.id;
});

/** El equipo que entrega el cliente: un iPhone 13, recibido por US$ 600. */
const EQUIPO = {
  nombre: 'iPhone 13 128gb 87%',
  imei: '45039',
  categoria: 'Smartphones usados',
  marca: 'Apple',
};

/** Venta del iPhone de US$ 1.000: US$ 600 en canje y US$ 400 en efectivo. */
function ventaConCanje(parcial: Partial<SolicitudDeVenta> = {}): SolicitudDeVenta {
  const total = usdAPesos(1_000_00, TC);
  const enCanje = Math.round(total * 0.6);

  return {
    lineas: [{ productId: iphoneId, cantidad: 1 }],
    pagos: [
      {
        medio: 'canje',
        montoCentavos: enCanje,
        montoUsdCentavos: 600_00,
        cotizacionCentavos: TC,
        equipoRecibido: EQUIPO,
      },
      { medio: 'efectivo', montoCentavos: total - enCanje, monetaryAccountId: cajaId },
    ],
    vendedorId,
    cashSessionId: sesionId,
    terminal: 'T1',
    idempotencyKey: `canje-${Math.random()}`,
    ...parcial,
  };
}

/** El producto que entró por canje en esa venta. */
async function equipoRecibidoDe(ventaId: string) {
  const [pago] = await db
    .select()
    .from(salePayments)
    .where(and(eq(salePayments.saleId, ventaId), eq(salePayments.medio, 'canje')));
  if (!pago?.productoRecibidoId) return null;
  const [p] = await db.select().from(products).where(eq(products.id, pago.productoRecibidoId));
  return { pago, producto: p! };
}

describe('nombreDelEquipo', () => {
  it('le pega el IMEI al final, como el catálogo nombra los usados', () => {
    expect(nombreDelEquipo({ nombre: 'iPhone 13 128gb 87%', imei: '45039' })).toBe(
      'iPhone 13 128gb 87% (45039)',
    );
  });

  it('no lo repite si ya está escrito en el nombre', () => {
    expect(nombreDelEquipo({ nombre: 'iPhone 13 (45039)', imei: '45039' })).toBe(
      'iPhone 13 (45039)',
    );
  });

  it('sin IMEI deja el nombre como vino', () => {
    expect(nombreDelEquipo({ nombre: 'iPhone 13 128gb', imei: null })).toBe('iPhone 13 128gb');
  });
});

describe('vender con canje', () => {
  it('la venta se registra entera, aunque solo entre parte en plata', async () => {
    const venta = await confirmarVenta(db, ventaConCanje());

    const [enBase] = await db.select().from(sales).where(eq(sales.id, venta.id));
    // El teléfono vale US$ 1.000 y la venta dice US$ 1.000: el canje es una
    // forma de pagarlo, no un descuento.
    expect(enBase!.totalCentavos).toBe(usdAPesos(1_000_00, TC));
  });

  /*
   * El corazón del asunto. Cargar el canje como efectivo dejaba el cajón con
   * seiscientos dólares que no existen, y a quien arquea justificando una
   * diferencia inventada.
   */
  it('al cajón entra solo lo que se pagó en plata', async () => {
    const venta = await confirmarVenta(db, ventaConCanje());
    const total = usdAPesos(1_000_00, TC);
    const enCanje = Math.round(total * 0.6);

    const movimientos = await db
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.referenciaId, venta.id));

    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]!.montoCentavos).toBe(total - enCanje);

    const [cuenta] = await db.select().from(monetaryAccounts).where(eq(monetaryAccounts.id, cajaId));
    expect(cuenta!.saldoCentavos).toBe(total - enCanje);
  });

  it('el equipo entra a stock con el valor de canje como costo', async () => {
    const venta = await confirmarVenta(db, ventaConCanje());
    const recibido = await equipoRecibidoDe(venta.id);

    expect(recibido).not.toBeNull();
    expect(recibido!.producto.nombre).toBe('iPhone 13 128gb 87% (45039)');
    expect(recibido!.producto.stock).toBe(1);
    // El costo es el valor de canje: es lo que el local pagó por ese teléfono,
    // en mercadería. Contra ese número sale el margen cuando lo venda.
    expect(recibido!.producto.costoCentavos).toBe(recibido!.pago.montoCentavos);
  });

  it('el equipo queda en dólares cuando el canje se pactó en dólares', async () => {
    const venta = await confirmarVenta(db, ventaConCanje());
    const recibido = await equipoRecibidoDe(venta.id);

    expect(recibido!.producto.moneda).toBe('USD');
    expect(recibido!.producto.precioUsdCentavos).toBe(600_00);
    expect(recibido!.pago.montoUsdCentavos).toBe(600_00);
    expect(recibido!.pago.cotizacionCentavos).toBe(TC);
  });

  it('en una venta en pesos el equipo entra en pesos', async () => {
    const venta = await confirmarVenta(
      db,
      ventaConCanje({
        lineas: [{ productId: fundaId, cantidad: 4 }],
        pagos: [
          {
            medio: 'canje',
            montoCentavos: 40_000_00,
            equipoRecibido: { nombre: 'Parlante portátil usado' },
          },
          { medio: 'efectivo', montoCentavos: 20_000_00, monetaryAccountId: cajaId },
        ],
      }),
    );

    const recibido = await equipoRecibidoDe(venta.id);
    expect(recibido!.producto.moneda).toBe('ARS');
    expect(recibido!.producto.precioUsdCentavos).toBeNull();
    expect(recibido!.producto.precioCentavos).toBe(40_000_00);
    expect(recibido!.pago.montoUsdCentavos).toBeNull();
  });

  it('deja el movimiento de stock atado a la venta que lo trajo', async () => {
    // Una unidad que aparece en el inventario sin remito ni factura, a cambio
    // de un descuento en otra venta, es justo la que hay que poder explicar
    // seis meses después.
    const venta = await confirmarVenta(db, ventaConCanje());
    const recibido = await equipoRecibidoDe(venta.id);

    const [mov] = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.productId, recibido!.producto.id));

    expect(mov!.tipo).toBe('ingreso');
    expect(mov!.cantidad).toBe(1);
    expect(mov!.motivo).toBe('Recibido en canje');
    expect(mov!.referenciaId).toBe(venta.id);
  });

  it('sale a la venta en la web, sin un paso aparte', async () => {
    // Lo pidió el local: «al momento de recibirlo como medio de pago se
    // publica». La publicación viaja encolada, así que no depende de que
    // WooCommerce conteste con el cliente enfrente.
    const venta = await confirmarVenta(db, ventaConCanje());
    const recibido = await equipoRecibidoDe(venta.id);

    const cola = await db.select().from(syncQueue);
    const publicacion = cola.find((o) => o.operacion === 'producto.publicar');
    expect(publicacion).toBeDefined();
    expect(publicacion!.payload).toEqual({ productId: recibido!.producto.id });
  });

  it('el canje descuenta el stock de lo vendido, como cualquier venta', async () => {
    await confirmarVenta(db, ventaConCanje());
    const [vendido] = await db.select().from(products).where(eq(products.id, iphoneId));
    expect(vendido!.stock).toBe(0);
  });
});

describe('lo que el canje no deja hacer', () => {
  it('un canje sin equipo no entra', async () => {
    await expect(
      confirmarVenta(
        db,
        ventaConCanje({
          pagos: [
            { medio: 'canje', montoCentavos: usdAPesos(1_000_00, TC), equipoRecibido: null },
          ],
        }),
      ),
    ).rejects.toThrow(ErrorVenta);
  });

  /*
   * La guarda está en la base y no solo en el código: un canje contra nada es
   * un descuento disfrazado que no deja ni plata ni mercadería, y el agujero
   * solo se ve al cerrar el mes.
   */
  it('la base rechaza un pago de canje sin producto, aunque se escriba a mano', async () => {
    const venta = await confirmarVenta(db, {
      lineas: [{ productId: fundaId, cantidad: 1 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 15_000_00, monetaryAccountId: cajaId }],
      vendedorId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: 'suelta',
    });

    await rechazaCon(
      db.insert(salePayments).values({
        saleId: venta.id,
        medio: 'canje',
        montoCentavos: 60_000_00,
      }),
      /sale_payments_canje_ck/,
    );
  });

  it('la base rechaza un producto recibido colgado de un pago que no es canje', async () => {
    const venta = await confirmarVenta(db, ventaConCanje());
    const recibido = await equipoRecibidoDe(venta.id);

    await rechazaCon(
      db.insert(salePayments).values({
        saleId: venta.id,
        medio: 'efectivo',
        montoCentavos: 1_000_00,
        productoRecibidoId: recibido!.producto.id,
      }),
      /sale_payments_canje_ck/,
    );
  });

  it('la base rechaza un canje con los dólares a medias', async () => {
    // Con el monto en dólares y sin la cotización no se puede reconstruir nada
    // el día que el dólar se mueva.
    const venta = await confirmarVenta(db, ventaConCanje());
    const recibido = await equipoRecibidoDe(venta.id);

    await rechazaCon(
      db.insert(salePayments).values({
        saleId: venta.id,
        medio: 'canje',
        montoCentavos: 1_000_00,
        montoUsdCentavos: 600_00,
        productoRecibidoId: recibido!.producto.id,
      }),
      /sale_payments_dolares_ck/,
    );
  });

  it('dos equipos con el mismo nombre piden el IMEI en vez de fallar feo', async () => {
    await confirmarVenta(db, ventaConCanje({ pagos: ventaConCanje().pagos }));

    await expect(
      confirmarVenta(
        db,
        ventaConCanje({
          lineas: [{ productId: fundaId, cantidad: 1 }],
          pagos: [
            {
              medio: 'canje',
              montoCentavos: 15_000_00,
              equipoRecibido: { ...EQUIPO, imei: '45039' },
            },
          ],
        }),
      ),
    ).rejects.toThrow(/IMEI/);
  });

  it('si la venta falla, el equipo no queda dado de alta', async () => {
    // Las dos cosas o ninguna: un alta sin venta es stock que nadie entregó.
    const antes = (await db.select().from(products)).length;

    await expect(
      confirmarVenta(
        db,
        ventaConCanje({
          // Un pago que no cubre el total hace fallar la venta entera.
          pagos: [
            {
              medio: 'canje',
              montoCentavos: 1_00,
              equipoRecibido: { nombre: 'iPhone 11 roto' },
            },
          ],
        }),
      ),
    ).rejects.toThrow(ErrorVenta);

    expect((await db.select().from(products)).length).toBe(antes);
  });
});
