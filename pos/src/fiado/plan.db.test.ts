/**
 * El plan de cuotas contra la base de verdad.
 *
 * `plan.test.ts` prueba la aritmética y el semáforo, que son puros. Acá se
 * prueba lo que solo se ve con tablas: que el plan entre con la venta, que un
 * cobro se impute a la cuota más vieja, y que anular la venta apague el plan
 * sin romper lo que ya se había cobrado.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  cashSessions,
  creditAccounts,
  creditPaymentAllocations,
  creditPlans,
  customers,
  exchangeRates,
  installments,
  monetaryAccounts,
  products,
  users,
} from '@/db/schema';
import { confirmarVenta } from '@/ventas/confirmar';
import { anularVenta } from '@/ventas/anular';
import { cobrarFiado, cuentaDe } from './cuenta';
import {
  cadencia,
  cuotasDeCuenta,
  estadosDeClientes,
  vencimientoDeCuota,
  type Cadencia,
} from './plan';
import { fechaLocalISO, sumarDias } from '@/lib/fecha';
import { usdAPesos } from '@/lib/dinero';

let db: TestDb;
let duenioId: string;
let cajaId: string;
let sesionId: string;
let productoId: string;
let clienteId: string;

const HOY = fechaLocalISO();

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
    .values({ nombre: 'iPhone 11 64GB', precioCentavos: 60_000_00, stock: 10 })
    .returning();
  productoId = p!.id;

  const [cli] = await db.insert(customers).values({ nombre: 'Gaby González' }).returning();
  clienteId = cli!.id;
});

/** Fía un celular de $600.000 en `cuotas` pagos. */
async function fiarEnCuotas(
  cuotas = 6,
  cad: Cadencia = cadencia('mensual'),
) {
  return confirmarVenta(db, {
    lineas: [{ productId: productoId, cantidad: 10 }],
    pagos: [{ medio: 'cuenta_corriente', montoCentavos: 600_000_00 }],
    clienteId,
    vendedorId: duenioId,
    cashSessionId: sesionId,
    terminal: 'T1',
    idempotencyKey: `plan-${Math.random()}`,
    plan: { cadencia: cad, cuotas },
  });
}

async function cobrar(montoCentavos: number) {
  return cobrarFiado(db, {
    customerId: clienteId,
    montoCentavos,
    medio: 'efectivo',
    monetaryAccountId: cajaId,
    cashSessionId: sesionId,
    usuarioId: duenioId,
    idempotencyKey: `cobro-${Math.random()}`,
  });
}

describe('fiar con plan', () => {
  it('la venta deja el plan y sus cuotas, y suman lo fiado', async () => {
    await fiarEnCuotas(6);

    const [plan] = await db.select().from(creditPlans);
    expect(plan!.cantidadCuotas).toBe(6);
    expect(plan!.frecuencia).toBe('mensual');
    expect(plan!.montoFinanciadoCentavos).toBe(600_000_00);

    const cuotas = await db.select().from(installments).where(eq(installments.planId, plan!.id));
    expect(cuotas).toHaveLength(6);
    expect(cuotas.reduce((s, c) => s + c.montoCentavos, 0)).toBe(600_000_00);
  });

  it('la primera vence una frecuencia después de la venta, no hoy', async () => {
    await fiarEnCuotas(3, cadencia('quincenal'));

    const cuotas = await cuotasDeCuenta(db, (await cuentaDe(db, clienteId))!.id);
    expect(cuotas[0]!.vencimiento).toBe(vencimientoDeCuota(HOY, cadencia('quincenal'), 1));
    expect(cuotas[0]!.vencimiento > HOY).toBe(true);
  });

  it('sin plan la venta fiada sigue funcionando igual: saldo abierto y sin cuotas', async () => {
    await confirmarVenta(db, {
      lineas: [{ productId: productoId, cantidad: 1 }],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: 60_000_00 }],
      clienteId,
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: 'sin-plan',
    });

    expect(await db.select().from(creditPlans)).toHaveLength(0);
    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(60_000_00);

    const estado = (await estadosDeClientes(db, [clienteId], HOY)).get(clienteId);
    expect(estado).toBeUndefined();
  });

  it('el plan financia lo fiado, no el total de la venta', async () => {
    await confirmarVenta(db, {
      // $600.000: la mitad en efectivo y la mitad fiada.
      lineas: [{ productId: productoId, cantidad: 10 }],
      pagos: [
        { medio: 'efectivo', montoCentavos: 300_000_00, monetaryAccountId: cajaId },
        { medio: 'cuenta_corriente', montoCentavos: 300_000_00 },
      ],
      clienteId,
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: 'mixto',
      plan: { cadencia: cadencia('mensual'), cuotas: 3 },
    });

    const [plan] = await db.select().from(creditPlans);
    expect(plan!.montoFinanciadoCentavos).toBe(300_000_00);
  });
});

describe('cobrar imputa a las cuotas', () => {
  it('una cuota justa queda pagada y con su imputación', async () => {
    await fiarEnCuotas(6);
    const cobro = await cobrar(100_000_00);

    const cuotas = await cuotasDeCuenta(db, (await cuentaDe(db, clienteId))!.id);
    expect(cuotas[0]!.pagadoCentavos).toBe(100_000_00);
    expect(cuotas[1]!.pagadoCentavos).toBe(0);

    const [fila] = await db.select().from(installments).where(eq(installments.id, cuotas[0]!.id));
    expect(fila!.estado).toBe('pagada');

    const imputaciones = await db
      .select()
      .from(creditPaymentAllocations)
      .where(eq(creditPaymentAllocations.creditPaymentId, cobro.id));
    expect(imputaciones).toHaveLength(1);
    expect(imputaciones[0]!.montoCentavos).toBe(100_000_00);
  });

  it('un pago grande tapa varias cuotas, de la más vieja a la más nueva', async () => {
    await fiarEnCuotas(6);
    await cobrar(250_000_00);

    const cuotas = await cuotasDeCuenta(db, (await cuentaDe(db, clienteId))!.id);
    expect(cuotas.map((c) => c.pagadoCentavos)).toEqual([
      100_000_00, 100_000_00, 50_000_00, 0, 0, 0,
    ]);
  });

  it('un pago chico deja la cuota a medias y la sigue contando', async () => {
    await fiarEnCuotas(6);
    await cobrar(30_000_00);

    const cuotas = await cuotasDeCuenta(db, (await cuentaDe(db, clienteId))!.id);
    expect(cuotas[0]!.pagadoCentavos).toBe(30_000_00);

    const [fila] = await db.select().from(installments).where(eq(installments.id, cuotas[0]!.id));
    expect(fila!.estado).toBe('pendiente');
  });

  it('pagar todo deja las seis cuotas pagadas y la deuda en cero', async () => {
    await fiarEnCuotas(6);
    await cobrar(600_000_00);

    const cuotas = await cuotasDeCuenta(db, (await cuentaDe(db, clienteId))!.id);
    expect(cuotas.every((c) => c.pagadoCentavos === c.montoCentavos)).toBe(true);
    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(0);

    const estado = (await estadosDeClientes(db, [clienteId], HOY)).get(clienteId);
    expect(estado?.color).toBe('verde');
    expect(estado?.proxima).toBeNull();
  });

  it('un cliente sin plan cobra igual que siempre: no rompe nada', async () => {
    await confirmarVenta(db, {
      lineas: [{ productId: productoId, cantidad: 1 }],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: 60_000_00 }],
      clienteId,
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: 'sin-plan-cobro',
    });

    await cobrar(10_000_00);
    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(50_000_00);
    expect(await db.select().from(creditPaymentAllocations)).toHaveLength(0);
  });
});

describe('el semáforo sobre datos de verdad', () => {
  it('con la primera cuota por vencer, amarillo', async () => {
    await fiarEnCuotas(4, cadencia('semanal'));

    // Cinco días después de la venta la cuota de los siete días está a dos.
    const estado = (await estadosDeClientes(db, [clienteId], sumarDias(HOY, 5))).get(clienteId);
    expect(estado?.color).toBe('amarillo');
    expect(estado?.proxima?.enDias).toBe(2);
  });

  it('pasada la fecha sin pagar, rojo y con lo vencido sumado', async () => {
    await fiarEnCuotas(4, cadencia('semanal'));

    // A los veinte días vencieron dos cuotas (7 y 14) y falta la tercera.
    const estado = (await estadosDeClientes(db, [clienteId], sumarDias(HOY, 20))).get(clienteId);
    expect(estado?.color).toBe('rojo');
    expect(estado?.vencidoCentavos).toBe(300_000_00);
    expect(estado?.diasDeAtraso).toBe(13);
  });

  it('pagar lo vencido lo devuelve a verde', async () => {
    await fiarEnCuotas(4, cadencia('semanal'));
    // Son cuatro cuotas de $150.000. A los 16 días vencieron las dos primeras:
    // paga las dos.
    await cobrar(300_000_00);

    const estado = (await estadosDeClientes(db, [clienteId], sumarDias(HOY, 16))).get(clienteId);
    expect(estado?.color).toBe('verde');
    expect(estado?.proxima?.numero).toBe(3);
    expect(estado?.cuotasPagadas).toBe(2);
  });

  it('pero si la siguiente ya está encima, amarillo y no verde', async () => {
    await fiarEnCuotas(4, cadencia('semanal'));
    await cobrar(300_000_00);

    // Al día 20, la tercera vence mañana: sigue estando al día, pero hay que avisarle.
    const estado = (await estadosDeClientes(db, [clienteId], sumarDias(HOY, 20))).get(clienteId);
    expect(estado?.color).toBe('amarillo');
    expect(estado?.proxima?.enDias).toBe(1);
  });
});

describe('anular una venta fiada apaga su plan', () => {
  it('las cuotas dejan de contar y el cliente ya no aparece con estado', async () => {
    const venta = await fiarEnCuotas(6);

    await anularVenta(db, {
      ventaId: venta.id,
      motivo: 'El cliente devolvió el celular',
      usuarioId: duenioId,
    });

    const [plan] = await db.select().from(creditPlans);
    expect(plan!.anuladoEn).not.toBeNull();

    expect(await cuotasDeCuenta(db, (await cuentaDe(db, clienteId))!.id)).toHaveLength(0);
    expect((await estadosDeClientes(db, [clienteId], HOY)).get(clienteId)).toBeUndefined();
  });

  it('no borra las cuotas que ya se habían cobrado: la imputación sigue en pie', async () => {
    const venta = await fiarEnCuotas(6);
    const cobro = await cobrar(100_000_00);

    await anularVenta(db, {
      ventaId: venta.id,
      motivo: 'El cliente devolvió el celular',
      usuarioId: duenioId,
    });

    const imputaciones = await db
      .select()
      .from(creditPaymentAllocations)
      .where(eq(creditPaymentAllocations.creditPaymentId, cobro.id));
    expect(imputaciones).toHaveLength(1);
    expect(await db.select().from(installments)).toHaveLength(6);
  });
});

describe('el semáforo es uno por moneda (D62)', () => {
  /*
   * Un cliente con un plan en pesos y otro en dólares tiene DOS semáforos.
   *
   * Juntarlos pone en la misma fila una cuota de US$ 500 —50.000 centavos— y una
   * de $100.000 —10.000.000 de centavos—, y el «vencido» que sale de sumarlas no
   * es plata de nadie. Peor: el orden por vencimiento mezclado haría que un pago
   * en pesos se impute contra la cuota del iPhone.
   */
  /** $1.571 por dólar, el mismo de los demás tests de dólares. */
  const TC = 1_571_00;

  async function fiarIphoneEnDolares(cuotas = 3) {
    await db.insert(exchangeRates).values({
      valorCentavos: TC,
      vigenteDesde: new Date(),
      origen: 'infodolar',
    });

    const total = usdAPesos(1_500_00, TC);
    const [iphone] = await db
      .insert(products)
      .values({
        nombre: 'iPhone 15 Pro Max 256GB',
        moneda: 'USD',
        precioUsdCentavos: 1_500_00,
        precioCentavos: total,
        stock: 1,
      })
      .returning();

    return confirmarVenta(db, {
      lineas: [{ productId: iphone!.id, cantidad: 1 }],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: total }],
      clienteId,
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: `usd-plan-${Math.random()}`,
      plan: { cadencia: cadencia('mensual'), cuotas },
    });
  }

  it('las cuotas en dólares no entran en el estado de la deuda en pesos', async () => {
    await fiarEnCuotas(3); // $600.000 en 3 cuotas de $200.000
    await fiarIphoneEnDolares(3); // US$ 1.500 en 3 cuotas de US$ 500

    const hoy = sumarDias(HOY, 40); // ya venció la primera de cada plan

    const enPesos = (await estadosDeClientes(db, [clienteId], hoy, 'ARS')).get(clienteId);
    const enDolares = (await estadosDeClientes(db, [clienteId], hoy, 'USD')).get(clienteId);

    expect(enPesos!.cuotasTotales).toBe(3);
    expect(enPesos!.vencidoCentavos).toBe(200_000_00);

    const cuentaId = (await cuentaDe(db, clienteId))!.id;
    const cuotasUsd = await cuotasDeCuenta(db, cuentaId, 'USD');

    expect(enDolares!.cuotasTotales).toBe(3);
    expect(enDolares!.vencidoCentavos).toBe(cuotasUsd[0]!.montoCentavos);
    // Son dólares: quinientos y algo, no doscientos mil. Si los dos estados se
    // mezclaran, acá habría seis cuotas y un vencido que suma las dos monedas.
    expect(enDolares!.vencidoCentavos).toBeLessThan(1_000_00);
  });

  it('el que debe solo dólares no tiene estado en pesos', async () => {
    await fiarIphoneEnDolares(3);

    expect((await estadosDeClientes(db, [clienteId], HOY, 'ARS')).get(clienteId)).toBeUndefined();
    expect((await estadosDeClientes(db, [clienteId], HOY, 'USD')).get(clienteId)).toBeDefined();
  });
});

describe('varios clientes de una sola consulta', () => {
  it('cada uno con su estado, y el que no tiene plan no aparece', async () => {
    await fiarEnCuotas(4, cadencia('semanal'));

    const [otro] = await db.insert(customers).values({ nombre: 'Marcelo Paz' }).returning();
    await db
      .insert(creditAccounts)
      .values({ customerId: otro!.id, saldoCentavos: 50_000 })
      .returning();

    const estados = await estadosDeClientes(db, [clienteId, otro!.id], sumarDias(HOY, 20));

    expect(estados.get(clienteId)?.color).toBe('rojo');
    expect(estados.get(otro!.id)).toBeUndefined();
  });
});
