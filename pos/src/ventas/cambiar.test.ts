/**
 * El cliente cambia un producto por otro.
 *
 * Lo que se prueba, más que los números, es lo que NO pasa: que en un cambio
 * parejo no se mueva un peso del cajón. Hacerlo con las dos pantallas sueltas
 * saca lo que valía lo devuelto y mete lo que vale lo nuevo, y con tarjeta o
 * Mercado Pago eso deja en el sistema una devolución y un cobro que no existen
 * en el resumen del banco.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  cashMovements,
  monetaryAccounts,
  products,
  returns,
  salePayments,
  sales,
  users,
} from '@/db/schema';
import { abrirCaja, cerrarCaja } from '@/caja/sesion';
import { confirmarVenta } from './confirmar';
import { loDevolvible } from './devolver';
import { ErrorCambio, registrarCambio } from './cambiar';

let db: TestDb;
let duenio: string;
let caja: string;
let hembra: string;
let macho: string;
let caro: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const [u] = await db.insert(users).values({ nombre: 'Lucas', rol: 'owner' }).returning();
  duenio = u!.id;

  const [c] = await db
    .insert(monetaryAccounts)
    .values({ nombre: 'Caja en efectivo', tipo: 'efectivo' })
    .returning();
  caja = c!.id;

  const prods = await db
    .insert(products)
    .values([
      { nombre: 'Derivador Y RCA 2 Hembra 1 Macho', precioCentavos: 11_000_00, stock: 10 },
      { nombre: 'Derivador Y RCA 2 Macho 1 Hembra', precioCentavos: 11_000_00, stock: 10 },
      { nombre: 'Kit de cables 1500w', precioCentavos: 59_000_00, stock: 5 },
    ])
    .returning();
  hembra = prods[0]!.id;
  macho = prods[1]!.id;
  caro = prods[2]!.id;
});

let n = 0;
const clave = () => `cam-${(n += 1)}-${Math.random()}`;

/**
 * Lo que de verdad se movió en el turno, sin la apertura.
 *
 * La apertura es un asiento del turno, no plata que entró o salió por atender
 * a alguien: contarla taparía justo lo que estas pruebas miran.
 */
async function movimientosDelTurno(sesionId: string) {
  const todos = await db
    .select()
    .from(cashMovements)
    .where(eq(cashMovements.cashSessionId, sesionId));
  return todos.filter((m) => m.tipo !== 'apertura');
}

const abrirTurno = () =>
  abrirCaja(db, {
    terminal: 'T1',
    usuarioId: duenio,
    monetaryAccountId: caja,
    saldoInicialCentavos: 100_000_00,
  });

/** Se vendieron 2 derivadores hembra ayer, y el turno se cerró. */
async function ventaDeAyer(cantidad = 2) {
  const viejo = await abrirTurno();
  const venta = await confirmarVenta(db, {
    lineas: [{ productId: hembra, cantidad }],
    pagos: [{ medio: 'efectivo', montoCentavos: 11_000_00 * cantidad, monetaryAccountId: caja }],
    vendedorId: duenio,
    cashSessionId: viejo.id,
    terminal: 'T1',
    idempotencyKey: clave(),
  });
  await cerrarCaja(db, {
    sesionId: viejo.id,
    usuarioId: duenio,
    saldoContadoCentavos: 100_000_00 + 11_000_00 * cantidad,
  });
  return { venta, hoy: await abrirTurno() };
}

async function renglon(ventaId: string) {
  const d = (await loDevolvible(db, ventaId))!;
  return d.lineas[0]!;
}

describe('cambio parejo', () => {
  it('no mueve un peso del cajón', async () => {
    const { venta, hoy } = await ventaDeAyer();
    const linea = await renglon(venta.id);
    const movimientosAntes = (await movimientosDelTurno(hoy.id)).length;

    const r = await registrarCambio(db, {
      ventaId: venta.id,
      devuelve: [{ saleItemId: linea.saleItemId, cantidad: 2, vuelveAlStock: true }],
      seLleva: [{ productId: macho, cantidad: 2 }],
      motivo: 'Se llevó el modelo equivocado',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: hoy.id,
      idempotencyKey: clave(),
    });

    expect(r.vueltoCentavos).toBe(22_000_00);
    expect(r.llevadoCentavos).toBe(22_000_00);
    expect(r.diferenciaCentavos).toBe(0);

    // Lo único que importa: la caja no se tocó.
    expect(await movimientosDelTurno(hoy.id)).toHaveLength(movimientosAntes);
  });

  it('el stock se mueve en los dos productos', async () => {
    const { venta, hoy } = await ventaDeAyer();
    const linea = await renglon(venta.id);

    await registrarCambio(db, {
      ventaId: venta.id,
      devuelve: [{ saleItemId: linea.saleItemId, cantidad: 2, vuelveAlStock: true }],
      seLleva: [{ productId: macho, cantidad: 2 }],
      motivo: 'Se llevó el modelo equivocado',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: hoy.id,
      idempotencyKey: clave(),
    });

    const [h] = await db.select().from(products).where(eq(products.id, hembra));
    const [m] = await db.select().from(products).where(eq(products.id, macho));
    expect(h!.stock).toBe(10); // 10 − 2 de la venta + 2 que volvieron
    expect(m!.stock).toBe(8); // 10 − 2 que se llevó
  });

  /*
   * Las dos mitades existen para esto: el que volvió deja de figurar vendido y
   * el que se llevó empieza a figurar. Un «cambio» suelto dejaría la
   * facturación pegada al producto equivocado.
   */
  it('queda una devolución y una venta, atadas entre sí', async () => {
    const { venta, hoy } = await ventaDeAyer();
    const linea = await renglon(venta.id);

    const r = await registrarCambio(db, {
      ventaId: venta.id,
      devuelve: [{ saleItemId: linea.saleItemId, cantidad: 2, vuelveAlStock: true }],
      seLleva: [{ productId: macho, cantidad: 2 }],
      motivo: 'Se llevó el modelo equivocado',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: hoy.id,
      idempotencyKey: clave(),
    });

    const [devolucion] = await db.select().from(returns);
    expect(devolucion!.numero).toBe(r.devolucionNumero);
    expect(devolucion!.totalCentavos).toBe(22_000_00);
    // Nada salió del cajón ni bajó deuda: todo se fue en mercadería.
    expect(devolucion!.devueltoCentavos).toBe(0);
    expect(devolucion!.descontadoDeDeudaCentavos).toBe(0);
    expect(devolucion!.aCambioCentavos).toBe(22_000_00);

    const nueva = (await db.select().from(sales)).find((v) => v.numero === r.ventaNumero)!;
    expect(nueva.totalCentavos).toBe(22_000_00);

    /*
     * El vínculo entre las dos vive en el pago, y alcanza para ir en los dos
     * sentidos: una devolución no se puede modificar después de creada
     * (disparador de 0012), así que anotarlo del otro lado no era posible.
     */
    const pagos = await db.select().from(salePayments).where(eq(salePayments.saleId, nueva.id));
    expect(pagos).toHaveLength(1);
    expect(pagos[0]!.medio).toBe('cambio');
    expect(pagos[0]!.montoCentavos).toBe(22_000_00);
    expect(pagos[0]!.returnId).toBe(devolucion!.id);
    expect(pagos[0]!.monetaryAccountId).toBeNull();
  });
});

describe('cambio con diferencia', () => {
  it('si se lleva algo más caro, paga la diferencia y solo eso entra al cajón', async () => {
    const { venta, hoy } = await ventaDeAyer();
    const linea = await renglon(venta.id);

    const r = await registrarCambio(db, {
      ventaId: venta.id,
      devuelve: [{ saleItemId: linea.saleItemId, cantidad: 2, vuelveAlStock: true }],
      seLleva: [{ productId: caro, cantidad: 1 }],
      motivo: 'Se lo cambió por el kit',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: hoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
      idempotencyKey: clave(),
    });

    expect(r.vueltoCentavos).toBe(22_000_00);
    expect(r.llevadoCentavos).toBe(59_000_00);
    expect(r.diferenciaCentavos).toBe(37_000_00);

    // Entra la diferencia, no los 59.000.
    const delCambio = await movimientosDelTurno(hoy.id);
    expect(delCambio).toHaveLength(1);
    expect(delCambio[0]!.montoCentavos).toBe(37_000_00);
    expect(delCambio[0]!.tipo).toBe('venta');
  });

  it('si se lleva algo más barato, se le devuelve la diferencia', async () => {
    const viejo = await abrirTurno();
    const venta = await confirmarVenta(db, {
      lineas: [{ productId: caro, cantidad: 1 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 59_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: viejo.id,
      terminal: 'T1',
      idempotencyKey: clave(),
    });
    await cerrarCaja(db, {
      sesionId: viejo.id,
      usuarioId: duenio,
      saldoContadoCentavos: 100_000_00 + 59_000_00,
    });
    const hoy = await abrirTurno();
    const linea = await renglon(venta.id);

    const r = await registrarCambio(db, {
      ventaId: venta.id,
      devuelve: [{ saleItemId: linea.saleItemId, cantidad: 1, vuelveAlStock: true }],
      seLleva: [{ productId: hembra, cantidad: 2 }],
      motivo: 'Se arrepintió del kit',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: hoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
      idempotencyKey: clave(),
    });

    expect(r.diferenciaCentavos).toBe(-37_000_00);

    // Negativo: en el libro de caja una salida se anota con su signo.
    const delCambio = await movimientosDelTurno(hoy.id);
    expect(delCambio).toHaveLength(1);
    expect(delCambio[0]!.montoCentavos).toBe(-37_000_00);
    // `anulacion` es como el libro de caja marca lo que sale: el arqueo lo
    // descuenta por el mismo camino que ya usaba.
    expect(delCambio[0]!.tipo).toBe('anulacion');
  });

  it('con diferencia y sin decir por dónde, no se registra nada', async () => {
    const { venta, hoy } = await ventaDeAyer();
    const linea = await renglon(venta.id);

    await expect(
      registrarCambio(db, {
        ventaId: venta.id,
        devuelve: [{ saleItemId: linea.saleItemId, cantidad: 2, vuelveAlStock: true }],
        seLleva: [{ productId: caro, cantidad: 1 }],
        motivo: 'Se lo cambió por el kit',
        usuarioId: duenio,
        terminal: 'T1',
        cashSessionId: hoy.id,
        idempotencyKey: clave(),
      }),
    ).rejects.toThrow(/por dónde entra la diferencia/i);

    expect(await db.select().from(returns)).toHaveLength(0);
  });
});

describe('el descuento de la venta vieja', () => {
  /*
   * Tomarle el precio de lista a algo comprado con descuento sería
   * reconocerle más plata de la que entró.
   */
  it('lo que vuelve vale lo que se cobró, no el precio de lista', async () => {
    const viejo = await abrirTurno();
    // $22.000 de lista, cobrados $19.800: 10% de descuento.
    const venta = await confirmarVenta(db, {
      lineas: [{ productId: hembra, cantidad: 2 }],
      descuentoGlobal: { tipo: 'porcentaje', porcentaje: 10 },
      pagos: [{ medio: 'efectivo', montoCentavos: 19_800_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: viejo.id,
      terminal: 'T1',
      idempotencyKey: clave(),
    });
    await cerrarCaja(db, {
      sesionId: viejo.id,
      usuarioId: duenio,
      saldoContadoCentavos: 100_000_00 + 19_800_00,
    });
    const hoy = await abrirTurno();
    const linea = await renglon(venta.id);

    const r = await registrarCambio(db, {
      ventaId: venta.id,
      devuelve: [{ saleItemId: linea.saleItemId, cantidad: 1, vuelveAlStock: true }],
      seLleva: [{ productId: macho, cantidad: 1 }],
      motivo: 'Cambio de modelo',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: hoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
      idempotencyKey: clave(),
    });

    // Volvió uno que se cobró a $9.900, y se lleva uno que hoy vale $11.000.
    expect(r.vueltoCentavos).toBe(9_900_00);
    expect(r.llevadoCentavos).toBe(11_000_00);
    expect(r.diferenciaCentavos).toBe(1_100_00);
  });
});

describe('lo que no se puede', () => {
  it('sin nada que devolver o sin nada que llevar, frena', async () => {
    const { venta, hoy } = await ventaDeAyer();
    const linea = await renglon(venta.id);
    const base = {
      ventaId: venta.id,
      motivo: 'Cambio',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: hoy.id,
      idempotencyKey: clave(),
    };

    await expect(
      registrarCambio(db, { ...base, devuelve: [], seLleva: [{ productId: macho, cantidad: 1 }] }),
    ).rejects.toBeInstanceOf(ErrorCambio);

    await expect(
      registrarCambio(db, {
        ...base,
        devuelve: [{ saleItemId: linea.saleItemId, cantidad: 1, vuelveAlStock: true }],
        seLleva: [],
      }),
    ).rejects.toBeInstanceOf(ErrorCambio);
  });

  it('un renglón que no es de esa venta frena', async () => {
    const { venta, hoy } = await ventaDeAyer();
    // Otra venta, en el turno de hoy: abrir un segundo turno sobre el mismo
    // terminal no se puede, y tampoco hace falta.
    const otra = await confirmarVenta(db, {
      lineas: [{ productId: macho, cantidad: 1 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 11_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: hoy.id,
      terminal: 'T1',
      idempotencyKey: clave(),
    });
    const lineaDeOtra = await renglon(otra.id);

    await expect(
      registrarCambio(db, {
        ventaId: venta.id,
        devuelve: [{ saleItemId: lineaDeOtra.saleItemId, cantidad: 1, vuelveAlStock: true }],
        seLleva: [{ productId: macho, cantidad: 1 }],
        motivo: 'Cambio',
        usuarioId: duenio,
        terminal: 'T1',
        cashSessionId: hoy.id,
        idempotencyKey: clave(),
      }),
    ).rejects.toThrow(/no es de esta venta/i);
  });
});
