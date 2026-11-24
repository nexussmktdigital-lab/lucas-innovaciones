/**
 * El recargo por financiar que se le saca al que paga antes.
 *
 * Lo que se prueba, más que la aritmética, es qué NO se toca: la venta, su
 * total, el precio del teléfono y la caja del día. Lo único que se mueve es la
 * deuda, porque el recargo era de la deuda desde el principio.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  auditLog,
  cashMovements,
  cashSessions,
  creditCharges,
  creditPayments,
  creditPlans,
  customers,
  monetaryAccounts,
  products,
  sales,
  users,
} from '@/db/schema';
import { confirmarVenta } from '@/ventas/confirmar';
import { cadencia, cuotasDeCuenta } from './plan';
import { cobrarFiado, cuentaDe, ErrorFiado, movimientosDe } from './cuenta';
import { quitarRecargoDeFinanciacion, recargoQuePuedeSacarse } from './quita-recargo';

let db: TestDb;
let duenioId: string;
let cajaId: string;
let sesionId: string;
let clienteId: string;
let telefonoId: string;

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

  const [cli] = await db.insert(customers).values({ nombre: 'El del teléfono' }).returning();
  clienteId = cli!.id;

  const [p] = await db
    .insert(products)
    .values({ nombre: 'Teléfono', precioCentavos: 500_000_00, stock: 5 })
    .returning();
  telefonoId = p!.id;
});

/** El caso real: un teléfono de $500.000 en 2 cuotas, con $50.000 de recargo. */
async function venderElTelefono(recargoCentavos = 50_000_00, cuotas = 2) {
  return confirmarVenta(db, {
    lineas: [{ productId: telefonoId, cantidad: 1 }],
    pagos: [{ medio: 'cuenta_corriente', montoCentavos: 500_000_00 }],
    clienteId,
    vendedorId: duenioId,
    cashSessionId: sesionId,
    terminal: 'T1',
    idempotencyKey: `tel-${Math.random()}`,
    recargoFiadoCentavos: recargoCentavos,
    plan: { cuotas, cadencia: cadencia('mensual') },
  });
}

describe('sacarle el recargo al que paga antes', () => {
  it('la deuda baja por el recargo y la venta no se toca', async () => {
    const venta = await venderElTelefono();
    // Debe el teléfono más el recargo.
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(550_000_00);

    const r = await quitarRecargoDeFinanciacion(db, {
      saleId: venta.id,
      montoCentavos: 50_000_00,
      usuarioId: duenioId,
    });

    expect(r.montoCentavos).toBe(50_000_00);
    expect(r.saldoCentavos).toBe(500_000_00);
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(500_000_00);

    // El teléfono valió lo que valió: su comprobante sigue diciendo lo mismo.
    const [v] = await db.select().from(sales).where(eq(sales.id, venta.id));
    expect(v!.totalCentavos).toBe(500_000_00);
    expect(v!.recargoFinanciacionCentavos).toBe(50_000_00);
    expect(v!.recargoQuitadoCentavos).toBe(50_000_00);
  });

  /*
   * La mitad del diseño. No entró plata: se dejó de cobrar algo. Registrarlo
   * como pago pondría en la caja del día un ingreso que nadie entregó.
   */
  it('no es un pago: no toca la caja ni los cobros', async () => {
    const venta = await venderElTelefono();
    const movimientosAntes = (await db.select().from(cashMovements)).length;

    await quitarRecargoDeFinanciacion(db, {
      saleId: venta.id,
      montoCentavos: 50_000_00,
      usuarioId: duenioId,
    });

    expect(await db.select().from(cashMovements)).toHaveLength(movimientosAntes);
    expect(await db.select().from(creditPayments)).toHaveLength(0);
  });

  it('queda como cargo negativo, con la venta en el detalle', async () => {
    const venta = await venderElTelefono();
    await quitarRecargoDeFinanciacion(db, {
      saleId: venta.id,
      montoCentavos: 50_000_00,
      usuarioId: duenioId,
    });

    const [cargo] = await db.select().from(creditCharges);
    expect(cargo!.montoCentavos).toBe(-50_000_00);
    expect(cargo!.saldoResultanteCentavos).toBe(500_000_00);
    expect(cargo!.moneda).toBe('ARS');
    expect(cargo!.detalle).toContain(venta.numero);

    // Y en la ficha es lo que es, no una devolución: con tres clases de cargo
    // el signo dejó de alcanzar para distinguirlas.
    const movimientos = await movimientosDe(db, clienteId);
    expect(movimientos.filter((m) => m.tipo === 'devolucion')).toHaveLength(0);
    const [movimiento] = movimientos.filter((m) => m.tipo === 'quita_recargo');
    expect(movimiento!.montoCentavos).toBe(50_000_00);
    expect(movimiento!.descripcion).toContain('recargo');
    expect(cargo!.tipo).toBe('quita_recargo');
  });

  /*
   * El que paga antes deja de financiar el FINAL del plan. Las cuotas que ya
   * cobró no se tocan: tienen imputaciones de pagos apuntándoles.
   */
  it('las cuotas que faltan se rehacen desde la última', async () => {
    const venta = await venderElTelefono(60_000_00, 3);
    const cuenta = (await cuentaDe(db, clienteId))!;
    // $560.000 en tres: 186.666,67 · 186.666,67 · 186.666,66 (el resto al final)
    const antes = await cuotasDeCuenta(db, cuenta.id);
    expect(antes).toHaveLength(3);
    expect(antes.reduce((t, c) => t + c.montoCentavos, 0)).toBe(560_000_00);

    await quitarRecargoDeFinanciacion(db, {
      saleId: venta.id,
      montoCentavos: 60_000_00,
      usuarioId: duenioId,
    });

    const despues = await cuotasDeCuenta(db, cuenta.id);
    expect(despues.reduce((t, c) => t + c.montoCentavos, 0)).toBe(500_000_00);
    // La primera no se movió: lo que se saca sale del final.
    expect(despues[0]!.montoCentavos).toBe(antes[0]!.montoCentavos);

    const [plan] = await db.select().from(creditPlans);
    expect(plan!.recargoCentavos).toBe(0);
    expect(plan!.totalAPagarCentavos).toBe(500_000_00);
  });

  it('no pisa lo que ya se cobró de una cuota', async () => {
    const venta = await venderElTelefono(60_000_00, 3);
    const cuenta = (await cuentaDe(db, clienteId))!;

    // Paga la primera cuota entera y algo de la segunda.
    await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 200_000_00,
      medio: 'efectivo',
      monetaryAccountId: cajaId,
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'primera',
    });

    await quitarRecargoDeFinanciacion(db, {
      saleId: venta.id,
      montoCentavos: 60_000_00,
      usuarioId: duenioId,
    });

    const cuotas = await cuotasDeCuenta(db, cuenta.id);
    for (const c of cuotas) {
      expect(c.montoCentavos).toBeGreaterThanOrEqual(c.pagadoCentavos);
    }
    expect(cuotas.reduce((t, c) => t + c.montoCentavos, 0)).toBe(500_000_00);
  });

  /*
   * El cliente puede deber de otras ventas, y entonces la deuda da de sobra
   * mientras que las cuotas de ESTA ya están casi todas cobradas. Lo ya
   * cobrado no se toca, así que la quita no tiene de dónde salir.
   */
  it('no se puede perdonar más de lo que falta cobrar del plan', async () => {
    const venta = await venderElTelefono();
    // Otra venta fiada, para que la deuda total no sea el límite.
    await confirmarVenta(db, {
      lineas: [{ productId: telefonoId, cantidad: 1 }],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: 500_000_00 }],
      clienteId,
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: 'otra-venta',
    });

    // Cobra casi todo el plan del teléfono: quedan $30.000 de sus cuotas.
    await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 520_000_00,
      medio: 'efectivo',
      monetaryAccountId: cajaId,
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'casi-todo',
    });

    // Debe de sobra —queda la otra venta— pero del plan faltan $30.000.
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(530_000_00);

    await expect(
      quitarRecargoDeFinanciacion(db, {
        saleId: venta.id,
        montoCentavos: 50_000_00,
        usuarioId: duenioId,
      }),
    ).rejects.toThrow(/ya se cobró casi todo/i);

    // Y hasta ahí sí se puede, sin pisar ninguna cuota ya cobrada.
    const r = await quitarRecargoDeFinanciacion(db, {
      saleId: venta.id,
      montoCentavos: 30_000_00,
      usuarioId: duenioId,
    });
    expect(r.saldoCentavos).toBe(500_000_00);

    const cuenta = (await cuentaDe(db, clienteId))!;
    for (const c of await cuotasDeCuenta(db, cuenta.id)) {
      expect(c.montoCentavos).toBeGreaterThanOrEqual(c.pagadoCentavos);
    }
  });

  it('se puede sacar una parte, y después el resto', async () => {
    const venta = await venderElTelefono();

    const primera = await quitarRecargoDeFinanciacion(db, {
      saleId: venta.id,
      montoCentavos: 20_000_00,
      usuarioId: duenioId,
    });
    expect(primera.quedaPorQuitarCentavos).toBe(30_000_00);
    expect(await recargoQuePuedeSacarse(db, venta.id)).toBe(30_000_00);

    const segunda = await quitarRecargoDeFinanciacion(db, {
      saleId: venta.id,
      montoCentavos: 30_000_00,
      usuarioId: duenioId,
    });
    expect(segunda.quedaPorQuitarCentavos).toBe(0);
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(500_000_00);
  });

  it('no se puede perdonar más recargo del que se cobró', async () => {
    const venta = await venderElTelefono();
    await expect(
      quitarRecargoDeFinanciacion(db, {
        saleId: venta.id,
        montoCentavos: 50_000_01,
        usuarioId: duenioId,
      }),
    ).rejects.toThrow(/más recargo del que se cobró/i);

    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(550_000_00);
    expect(await db.select().from(creditCharges)).toHaveLength(0);
  });

  it('dos veces entero no se puede', async () => {
    const venta = await venderElTelefono();
    await quitarRecargoDeFinanciacion(db, {
      saleId: venta.id,
      montoCentavos: 50_000_00,
      usuarioId: duenioId,
    });
    await expect(
      quitarRecargoDeFinanciacion(db, {
        saleId: venta.id,
        montoCentavos: 1_00,
        usuarioId: duenioId,
      }),
    ).rejects.toThrow(/ya se le sacó todo el recargo/i);
  });

  it('una venta sin recargo no tiene nada que sacar', async () => {
    const venta = await venderElTelefono(0, 2);
    await expect(
      quitarRecargoDeFinanciacion(db, {
        saleId: venta.id,
        montoCentavos: 1_00,
        usuarioId: duenioId,
      }),
    ).rejects.toThrow(/no tuvo recargo/i);
  });

  it('un monto en cero o negativo frena todo', async () => {
    const venta = await venderElTelefono();
    for (const malo of [0, -1_00, 1.5]) {
      await expect(
        quitarRecargoDeFinanciacion(db, {
          saleId: venta.id,
          montoCentavos: malo,
          usuarioId: duenioId,
        }),
      ).rejects.toBeInstanceOf(ErrorFiado);
    }
    expect(await db.select().from(creditCharges)).toHaveLength(0);
  });

  it('queda en la bitácora con el saldo de antes y el de después', async () => {
    const venta = await venderElTelefono();
    await quitarRecargoDeFinanciacion(db, {
      saleId: venta.id,
      montoCentavos: 50_000_00,
      usuarioId: duenioId,
      nota: 'Canceló a los dos días',
    });

    const [entrada] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.accion, 'fiado.quita_recargo'));
    expect(entrada!.valorAnterior).toMatchObject({ saldoCentavos: 550_000_00 });
    expect(entrada!.valorNuevo).toMatchObject({
      saldoCentavos: 500_000_00,
      montoCentavos: 50_000_00,
      nota: 'Canceló a los dos días',
    });
  });
});

/*
 * El fiado «cuando pueda» no tiene cuotas: su recargo vive solo en la venta.
 * Es el caso donde el tope del plan no existe y el único que queda es la
 * deuda.
 */
describe('sin plan de cuotas', () => {
  async function fiarSinPlan(recargoCentavos = 50_000_00) {
    return confirmarVenta(db, {
      lineas: [{ productId: telefonoId, cantidad: 1 }],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: 500_000_00 }],
      clienteId,
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: `sin-plan-${Math.random()}`,
      recargoFiadoCentavos: recargoCentavos,
    });
  }

  it('se le saca el recargo igual, sin cuotas que rehacer', async () => {
    const venta = await fiarSinPlan();
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(550_000_00);

    const r = await quitarRecargoDeFinanciacion(db, {
      saleId: venta.id,
      montoCentavos: 50_000_00,
      usuarioId: duenioId,
    });

    expect(r.saldoCentavos).toBe(500_000_00);
    expect(await db.select().from(creditPlans)).toHaveLength(0);
  });

  it('no se puede sacar más de lo que debe', async () => {
    const venta = await fiarSinPlan();
    await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 520_000_00,
      medio: 'efectivo',
      monetaryAccountId: cajaId,
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'casi-todo-sin-plan',
    });
    // Debe $30.000 y el recargo sin sacar es $50.000: manda la deuda.
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(30_000_00);

    await expect(
      quitarRecargoDeFinanciacion(db, {
        saleId: venta.id,
        montoCentavos: 50_000_00,
        usuarioId: duenioId,
      }),
    ).rejects.toThrow(/se resuelve aparte/i);

    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(30_000_00);
    expect(await db.select().from(creditCharges)).toHaveLength(0);
  });
});

describe('el caso que lo pidió, de punta a punta', () => {
  it('se llevó el teléfono en dos cuotas, pagó todo a los dos días y la cuenta cierra', async () => {
    const venta = await venderElTelefono();
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(550_000_00);

    // Vuelve a los dos días con el precio de contado.
    await quitarRecargoDeFinanciacion(db, {
      saleId: venta.id,
      montoCentavos: 50_000_00,
      usuarioId: duenioId,
      nota: 'Pagó todo a los dos días',
    });

    await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 500_000_00,
      medio: 'efectivo',
      monetaryAccountId: cajaId,
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'contado',
    });

    // No queda debiendo el recargo, que es exactamente lo que pasaba antes.
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(0);

    const cuenta = (await cuentaDe(db, clienteId))!;
    const cuotas = await cuotasDeCuenta(db, cuenta.id);
    expect(cuotas.every((c) => c.pagadoCentavos >= c.montoCentavos)).toBe(true);

    // Y en la caja entraron los 500.000 que el cliente entregó, ni uno más.
    const cobros = await db.select().from(creditPayments);
    expect(cobros).toHaveLength(1);
    expect(cobros[0]!.montoCentavos).toBe(500_000_00);
  });
});
