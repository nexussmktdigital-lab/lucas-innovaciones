/**
 * El papel que se lleva el cliente después de una visita a la cuenta.
 *
 * Lo que se prueba acá, más que el HTML, es de dónde sale el saldo. Un
 * comprobante que recalcula el saldo al imprimirlo es un comprobante que
 * dentro de tres meses dice otro número que el que se entregó, y entonces no
 * sirve para lo único que sirve un papel: para discutirlo.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  cashSessions,
  creditCharges,
  customers,
  monetaryAccounts,
  products,
  creditAccounts,
  users,
} from '@/db/schema';
import { confirmarVenta } from '@/ventas/confirmar';
import { fechaLocalISO } from '@/lib/fecha';
import { cobrarFiado, comprobanteDelDia, cuentaDe, migrarFichaDePapel } from './cuenta';
import { registrarMercaderiaDevuelta } from './mercaderia-devuelta';
import { codigoDeComprobante, generarComprobante } from './comprobante';

let db: TestDb;
let duenioId: string;
let cajaId: string;
let sesionId: string;
let clienteId: string;
let termoId: string;
let vidrioId: string;

const HOY = fechaLocalISO();
const ANTEAYER = fechaLocalISO(new Date(Date.now() - 2 * 86_400_000));

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

  const [cli] = await db.insert(customers).values({ nombre: 'Uriel Duarte' }).returning();
  clienteId = cli!.id;

  const [t] = await db
    .insert(products)
    .values({ nombre: 'Termo Stanley símil', precioCentavos: 28_000_00, stock: 4 })
    .returning();
  termoId = t!.id;

  const [v] = await db
    .insert(products)
    .values({ nombre: 'Vidrio templado', precioCentavos: 5_000_00, stock: 50 })
    .returning();
  vidrioId = v!.id;

  await migrarFichaDePapel(db, {
    customerId: clienteId,
    saldoCentavos: 1_000_000_00,
    usuarioId: duenioId,
  });
});

async function devolver(montoCentavos: number, cantidad = 1) {
  return registrarMercaderiaDevuelta(db, {
    customerId: clienteId,
    usuarioId: duenioId,
    renglones: [{ productId: termoId, cantidad, montoCentavos }],
  });
}

async function cobrar(montoCentavos: number, clave: string, medio = 'efectivo' as const) {
  return cobrarFiado(db, {
    customerId: clienteId,
    montoCentavos,
    medio,
    monetaryAccountId: cajaId,
    cashSessionId: sesionId,
    usuarioId: duenioId,
    idempotencyKey: clave,
  });
}

describe('comprobante del día', () => {
  it('junta lo que devolvió y lo que entregó, del más viejo al más nuevo', async () => {
    await devolver(212_500_00, 2);
    await cobrar(70_000_00, 'pago-1');

    const visita = (await comprobanteDelDia(db, clienteId, HOY))!;

    expect(visita.renglones.map((r) => r.tipo)).toEqual(['devolucion', 'cobro']);
    expect(visita.renglones[0]!.montoCentavos).toBe(212_500_00);
    expect(visita.renglones[1]!.montoCentavos).toBe(70_000_00);
    // 1.000.000 − 212.500 − 70.000
    expect(visita.saldoCentavos).toBe(717_500_00);
    expect(visita.hayPosteriores).toBe(false);
  });

  /*
   * El corazón del papel. El saldo sale congelado del último movimiento de la
   * visita, no de la cuenta: si saliera de la cuenta, reimprimir el
   * comprobante de la semana pasada mostraría el saldo de hoy.
   */
  it('el saldo es el de esa visita, no el de hoy', async () => {
    // La visita de anteayer: devolvió y quedó debiendo 900.000.
    const devuelta = await devolver(100_000_00);
    expect(devuelta.saldoCentavos).toBe(900_000_00);
    await db
      .update(creditCharges)
      .set({ fecha: sql`now() - interval '2 days'` })
      .where(eq(creditCharges.montoCentavos, -100_000_00));

    // Hoy vino de nuevo y pagó: la cuenta ya no dice lo mismo.
    await cobrar(300_000_00, 'pago-de-hoy');
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(600_000_00);

    const reimpreso = (await comprobanteDelDia(db, clienteId, ANTEAYER))!;
    expect(reimpreso.renglones.map((r) => r.tipo)).toEqual(['devolucion']);
    expect(reimpreso.saldoCentavos).toBe(900_000_00);
  });

  /*
   * Una venta no congela saldo, así que no puede cerrar el papel. Lo que pasó
   * después del último movimiento con saldo se avisa y se deja afuera: un
   * renglón debajo de un saldo que no lo incluye es un papel que no cierra.
   */
  it('lo que pasó después del último saldo se avisa y no se lista', async () => {
    await devolver(100_000_00);
    await confirmarVenta(db, {
      lineas: [{ productId: vidrioId, cantidad: 1 }],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: 5_000_00 }],
      clienteId,
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: 'venta-tarde',
    });

    const visita = (await comprobanteDelDia(db, clienteId, HOY))!;
    expect(visita.renglones.map((r) => r.tipo)).toEqual(['devolucion']);
    expect(visita.saldoCentavos).toBe(900_000_00);
    expect(visita.hayPosteriores).toBe(true);
  });

  it('una venta anterior sí entra, porque el saldo que cierra ya la incluye', async () => {
    await confirmarVenta(db, {
      lineas: [{ productId: vidrioId, cantidad: 1 }],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: 5_000_00 }],
      clienteId,
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: 'venta-temprano',
    });
    await cobrar(50_000_00, 'pago-despues-de-venta');

    const visita = (await comprobanteDelDia(db, clienteId, HOY))!;
    expect(visita.renglones.map((r) => r.tipo)).toEqual(['venta', 'cobro']);
    // 1.000.000 + 5.000 − 50.000
    expect(visita.saldoCentavos).toBe(955_000_00);
    expect(visita.hayPosteriores).toBe(false);
  });

  it('un día sin cobro ni cargo no tiene comprobante', async () => {
    await confirmarVenta(db, {
      lineas: [{ productId: vidrioId, cantidad: 1 }],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: 5_000_00 }],
      clienteId,
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: 'solo-venta',
    });

    expect(await comprobanteDelDia(db, clienteId, HOY)).toBeNull();
  });

  it('un día sin nada tampoco', async () => {
    expect(await comprobanteDelDia(db, clienteId, '2020-01-01')).toBeNull();
  });

  it('los movimientos de otro día no entran', async () => {
    const viejo = await devolver(100_000_00);
    expect(viejo.saldoCentavos).toBe(900_000_00);
    await cobrar(10_000_00, 'pago-hoy');

    const otro = await comprobanteDelDia(db, clienteId, '2020-01-01');
    expect(otro).toBeNull();
  });
});

describe('el papel impreso', () => {
  it('dice lo que devolvió, lo que entregó y con cuánto se va', async () => {
    await devolver(212_500_00, 2);
    await cobrar(70_000_00, 'pago-impreso');
    const visita = (await comprobanteDelDia(db, clienteId, HOY))!;

    const html = generarComprobante({
      codigo: codigoDeComprobante(clienteId, HOY),
      dia: HOY,
      cliente: 'Uriel Duarte',
      renglones: visita.renglones,
      saldoCentavos: visita.saldoCentavos,
    });

    expect(html).toContain('COMPROBANTE DE CUENTA');
    expect(html).toContain('Devolvió mercadería');
    expect(html).toContain('2 x Termo Stanley símil');
    expect(html).toContain('Entregó');
    expect(html).toContain('Efectivo');
    expect(html).toContain('SALDO QUE QUEDA');
    expect(html).toContain('717.500');
    // Original y duplicado: uno se lo lleva y el otro queda firmado en el local.
    expect(html.match(/COMPROBANTE DE CUENTA/g)).toHaveLength(2);
  });

  it('con la deuda en cero lo dice, en vez de imprimir un saldo de cero', async () => {
    const html = generarComprobante({
      codigo: 'CC-ABC123-261117',
      dia: HOY,
      cliente: 'Uriel Duarte',
      renglones: [],
      saldoCentavos: 0,
    });
    expect(html).toContain('DEUDA CANCELADA');
    expect(html).not.toContain('SALDO QUE QUEDA');
  });

  it('avisa cuando hubo movimientos que no están en el papel', async () => {
    const html = generarComprobante({
      codigo: 'CC-ABC123-261117',
      dia: HOY,
      cliente: 'Uriel Duarte',
      renglones: [],
      saldoCentavos: 10_000_00,
      hayPosteriores: true,
    });
    expect(html).toContain('HUBO MÁS MOVIMIENTOS ESE DÍA');
  });

  /*
   * Dos deudas, no una (D62). Decirle «le quedan $10.000» a alguien que
   * además debe US$ 600 es mentir por omisión justo en el papel que se lleva.
   */
  it('la deuda en dólares va como aviso aparte y no se suma', async () => {
    const html = generarComprobante({
      codigo: 'CC-ABC123-261117',
      dia: HOY,
      cliente: 'Uriel Duarte',
      renglones: [],
      saldoCentavos: 10_000_00,
      deudaUsdCentavos: 600_00,
    });
    expect(html).toContain('ADEMÁS DEBE EN DÓLARES');
  });

  it('el código es el mismo cada vez que se reimprime', () => {
    const uno = codigoDeComprobante('11112222-3333-4444-5555-666677778888', '2026-11-17');
    expect(uno).toBe(codigoDeComprobante('11112222-3333-4444-5555-666677778888', '2026-11-17'));
    expect(uno).toContain('261117');
    expect(uno).not.toBe(codigoDeComprobante('99998888-3333-4444-5555-666677778888', '2026-11-17'));
  });
});

describe('dos deudas en una visita', () => {
  /*
   * Los dólares no se suman a los pesos ni se restan de ellos (D62). Un cobro
   * de US$ 200 metido como renglón de un papel en pesos sería un descuento de
   * doscientos pesos: mil quinientas veces menos de lo que entregó.
   */
  it('el cobro en dólares no entra en el papel de pesos, y se avisa', async () => {
    const cuenta = (await cuentaDe(db, clienteId))!;
    await db
      .update(creditAccounts)
      .set({ saldoUsdCentavos: 600_00 })
      .where(eq(creditAccounts.id, cuenta.id));

    await devolver(100_000_00);
    await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 200_00,
      monedaDeuda: 'USD',
      medio: 'dolares',
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'pago-verde',
    });

    const visita = (await comprobanteDelDia(db, clienteId, HOY))!;
    expect(visita.renglones.map((r) => r.tipo)).toEqual(['devolucion']);
    expect(visita.saldoCentavos).toBe(900_000_00);
    expect(visita.hayDolares).toBe(true);

    const html = generarComprobante({
      codigo: codigoDeComprobante(clienteId, HOY),
      dia: HOY,
      cliente: 'Uriel Duarte',
      renglones: visita.renglones,
      saldoCentavos: visita.saldoCentavos,
      hayDolares: visita.hayDolares,
    });
    expect(html).toContain('ESE DÍA TAMBIÉN HUBO MOVIMIENTOS EN DÓLARES');
    expect(html).not.toContain('US$ 200');
  });
});
