/**
 * Tests de la cuenta corriente.
 *
 * Corren contra PGlite con las migraciones reales: los candados de fila, las
 * restricciones y los disparadores de inmutabilidad estan puestos.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, rechazaCon, vaciar, type TestDb } from '@/db/test-db';
import {
  auditLog,
  cashMovements,
  cashSessions,
  creditAccounts,
  creditPayments,
  exchangeRates,
  customers,
  monetaryAccounts,
  products,
  users,
} from '@/db/schema';
import { confirmarVenta, ErrorVenta } from '@/ventas/confirmar';
import { pesosAUsdExacto, usdAPesos } from '@/lib/dinero';
import {
  cobrarFiado,
  cuentaDe,
  deudores,
  ErrorFiado,
  migrarFichaDePapel,
  movimientosDe,
  ponerLimite,
  totalFiado,
} from './cuenta';
import { cadencia, cuotasDeCuenta } from './plan';
import { anularVenta } from '@/ventas/anular';
import {
  devolucionesPendientes,
  ErrorDevolucion,
  historialDeDevoluciones,
  marcarDevuelta,
  totalADevolver,
} from './devoluciones';

let db: TestDb;
let duenioId: string;
let cajaId: string;
let sesionId: string;
let vidrioId: string;
let clienteId: string;

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
    .values({ nombre: 'Vidrio templado 9D', precioCentavos: 500_000, stock: 100 })
    .returning();
  vidrioId = p!.id;

  const [cli] = await db.insert(customers).values({ nombre: 'Gaby González' }).returning();
  clienteId = cli!.id;
});

/** Fía `cantidad` vidrios de $5.000 al cliente. */
async function fiar(cantidad = 2, clave = `fiado-${Math.random()}`) {
  return confirmarVenta(db, {
    lineas: [{ productId: vidrioId, cantidad }],
    pagos: [{ medio: 'cuenta_corriente', montoCentavos: 500_000 * cantidad }],
    clienteId,
    vendedorId: duenioId,
    cashSessionId: sesionId,
    terminal: 'T1',
    idempotencyKey: clave,
  });
}

describe('fiar en una venta', () => {
  it('la deuda del cliente queda registrada, no solo el tipo de venta', async () => {
    await fiar(2);

    const cuenta = await cuentaDe(db, clienteId);
    expect(cuenta?.saldoCentavos).toBe(1_000_000);
  });

  it('no mueve plata: no entró nada a la caja', async () => {
    await fiar(2);

    expect(await db.select().from(cashMovements)).toHaveLength(0);
    const [cuenta] = await db
      .select()
      .from(monetaryAccounts)
      .where(eq(monetaryAccounts.id, cajaId));
    expect(cuenta!.saldoCentavos).toBe(0);
  });

  it('dos compras fiadas se suman en la misma cuenta', async () => {
    await fiar(1, 'a');
    await fiar(3, 'b');

    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(2_000_000);
    expect(await db.select().from(creditAccounts)).toHaveLength(1);
  });

  it('sin cliente no se puede fiar', async () => {
    await expect(
      confirmarVenta(db, {
        lineas: [{ productId: vidrioId, cantidad: 1 }],
        pagos: [{ medio: 'cuenta_corriente', montoCentavos: 500_000 }],
        vendedorId: duenioId,
        cashSessionId: sesionId,
        terminal: 'T1',
        idempotencyKey: 'sin-cliente',
      }),
    ).rejects.toBeInstanceOf(ErrorVenta);
  });

  it('un pago mixto anota como deuda solo la parte fiada', async () => {
    await confirmarVenta(db, {
      // $10.000: $4.000 en efectivo y $6.000 fiados.
      lineas: [{ productId: vidrioId, cantidad: 2 }],
      pagos: [
        { medio: 'efectivo', montoCentavos: 400_000, monetaryAccountId: cajaId },
        { medio: 'cuenta_corriente', montoCentavos: 600_000 },
      ],
      clienteId,
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: 'mixto',
    });

    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(600_000);
    const [mov] = await db.select().from(cashMovements);
    expect(mov!.montoCentavos).toBe(400_000);
  });

  it('queda en la bitácora quién fió y cuánto', async () => {
    const venta = await fiar(2);

    const entradas = await db.select().from(auditLog);
    const anotada = entradas.find((e) => e.accion === 'fiado.anotar');
    expect(anotada).toBeDefined();
    expect((anotada!.valorNuevo as { venta: string }).venta).toBe(venta.numero);
  });
});

describe('límite de crédito', () => {
  it('frena la venta que lo pasa, y explica qué hacer', async () => {
    await ponerLimite(db, { customerId: clienteId, limiteCentavos: 1_500_000, usuarioId: duenioId });
    await fiar(2, 'primera'); // debe $10.000

    await expect(fiar(2, 'segunda')).rejects.toMatchObject({ motivo: 'supera_limite' });

    // Y no quedó ni la venta ni la deuda: la transacción entera se deshizo.
    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(1_000_000);
  });

  it('deja pasar justo hasta el límite', async () => {
    await ponerLimite(db, { customerId: clienteId, limiteCentavos: 1_000_000, usuarioId: duenioId });
    await fiar(2);
    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(1_000_000);
  });

  it('sin límite se puede fiar sin tope, como en la libreta', async () => {
    await fiar(20);
    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(10_000_000);
  });
});

describe('cobrarFiado', () => {
  it('baja la deuda y la plata entra a la caja del turno', async () => {
    await fiar(2);

    const r = await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 400_000,
      medio: 'efectivo',
      monetaryAccountId: cajaId,
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'cobro-1',
    });

    expect(r.saldoCentavos).toBe(600_000);
    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(600_000);

    const [mov] = await db.select().from(cashMovements);
    expect(mov!.tipo).toBe('cobro_fiado');
    expect(mov!.montoCentavos).toBe(400_000);

    const [cuenta] = await db
      .select()
      .from(monetaryAccounts)
      .where(eq(monetaryAccounts.id, cajaId));
    expect(cuenta!.saldoCentavos).toBe(400_000);
  });

  it('cobrar todo deja la cuenta en cero', async () => {
    await fiar(2);
    const r = await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 1_000_000,
      medio: 'efectivo',
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'cobro-todo',
    });
    expect(r.saldoCentavos).toBe(0);
  });

  it('no acepta cobrar más de lo que se debe', async () => {
    await fiar(2);
    await expect(
      cobrarFiado(db, {
        customerId: clienteId,
        montoCentavos: 1_500_000,
        medio: 'efectivo',
        cashSessionId: sesionId,
        usuarioId: duenioId,
        idempotencyKey: 'cobro-de-mas',
      }),
    ).rejects.toMatchObject({ motivo: 'monto_invalido' });
  });

  it('a quien no debe nada no se le cobra', async () => {
    await expect(
      cobrarFiado(db, {
        customerId: clienteId,
        montoCentavos: 100,
        medio: 'efectivo',
        cashSessionId: sesionId,
        usuarioId: duenioId,
        idempotencyKey: 'sin-deuda',
      }),
    ).rejects.toMatchObject({ motivo: 'sin_deuda' });
  });

  it('reintentar el mismo cobro no cobra dos veces', async () => {
    await fiar(2);
    const datos = {
      customerId: clienteId,
      montoCentavos: 400_000,
      medio: 'efectivo' as const,
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'mismo-cobro',
    };

    await cobrarFiado(db, datos);
    const segundo = await cobrarFiado(db, datos);

    expect(segundo.yaExistia).toBe(true);
    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(600_000);
    expect(await db.select().from(creditPayments)).toHaveLength(1);
  });

  it('una deuda no se paga con más deuda', async () => {
    await fiar(2);
    await expect(
      cobrarFiado(db, {
        customerId: clienteId,
        montoCentavos: 100,
        medio: 'cuenta_corriente',
        cashSessionId: sesionId,
        usuarioId: duenioId,
        idempotencyKey: 'circular',
      }),
    ).rejects.toBeInstanceOf(ErrorFiado);
  });

  it('un cobro no se puede modificar ni borrar', async () => {
    await fiar(2);
    const r = await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 400_000,
      medio: 'efectivo',
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'inmutable',
    });

    await rechazaCon(
      db.update(creditPayments).set({ montoCentavos: 1 }).where(eq(creditPayments.id, r.id)),
      /solo agregado/i,
    );
    await rechazaCon(
      db.delete(creditPayments).where(eq(creditPayments.id, r.id)),
      /solo agregado/i,
    );
  });

  it('dos cobros simultáneos no dejan el saldo mal', async () => {
    await fiar(2); // debe $10.000

    const cobro = (clave: string) =>
      cobrarFiado(db, {
        customerId: clienteId,
        montoCentavos: 700_000,
        medio: 'efectivo',
        cashSessionId: sesionId,
        usuarioId: duenioId,
        idempotencyKey: clave,
      });

    const [a, b] = await Promise.allSettled([cobro('sim-a'), cobro('sim-b')]);

    // Uno entra y el otro rebota: $7.000 + $7.000 no caben en una deuda de $10.000.
    const entraron = [a, b].filter((x) => x.status === 'fulfilled').length;
    expect(entraron).toBe(1);
    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(300_000);
  });
});

describe('anular una venta fiada', () => {
  it('le saca al cliente la deuda que esa venta generó', async () => {
    const venta = await fiar(2);
    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(1_000_000);

    const r = await anularVenta(db, {
      ventaId: venta.id,
      usuarioId: duenioId,
      motivo: 'Se arrepintió',
    });

    expect(r.deudaBorradaCentavos).toBe(1_000_000);
    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(0);
  });

  it('si ya pagó parte, solo se le saca lo que todavía debe', async () => {
    const venta = await fiar(2);
    await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 700_000,
      medio: 'efectivo',
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'pago-parcial',
    });

    const r = await anularVenta(db, {
      ventaId: venta.id,
      usuarioId: duenioId,
      motivo: 'Devolución',
    });

    // Debía $3.000; no se le puede sacar más que eso ni dejarle saldo a favor.
    expect(r.deudaBorradaCentavos).toBe(300_000);
    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(0);

    // Y los $7.000 que ya había pagado quedan anotados para devolverle: esa
    // plata está en la caja y el cliente no se llevó nada.
    expect(r.aDevolverCentavos).toBe(700_000);
  });

  /*
   * El hallazgo 21 de la auditoría.
   *
   * Antes de esto, anular una venta fiada ya cobrada en parte dejaba la deuda
   * en cero y la plata del cliente en la caja, sin ninguna pantalla donde eso
   * se viera. El negocio se la quedaba.
   */
  describe('la plata que el cliente ya había pagado', () => {
    it('queda anotada como devolución pendiente, con la venta y el monto', async () => {
      const venta = await fiar(2); // $10.000
      await cobrarFiado(db, {
        customerId: clienteId,
        montoCentavos: 400_000,
        medio: 'efectivo',
        cashSessionId: sesionId,
        usuarioId: duenioId,
        idempotencyKey: 'dev-1',
      });

      await anularVenta(db, { ventaId: venta.id, usuarioId: duenioId, motivo: 'Se arrepintió' });

      const pendientes = await devolucionesPendientes(db);
      expect(pendientes).toHaveLength(1);
      expect(pendientes[0]!.montoCentavos).toBe(400_000);
      expect(pendientes[0]!.customerId).toBe(clienteId);
      expect(pendientes[0]!.numero).toBe(venta.numero);

      expect(await totalADevolver(db)).toEqual({ totalCentavos: 400_000, cuantas: 1 });
    });

    it('si no había pagado nada, no hay nada que devolver', async () => {
      const venta = await fiar(2);
      const r = await anularVenta(db, {
        ventaId: venta.id,
        usuarioId: duenioId,
        motivo: 'Mal cargada',
      });

      expect(r.aDevolverCentavos).toBe(0);
      expect(await devolucionesPendientes(db)).toHaveLength(0);
    });

    it('una venta de contado anulada no genera devolución: la plata ya volvió sola', async () => {
      const venta = await confirmarVenta(db, {
        lineas: [{ productId: vidrioId, cantidad: 1 }],
        pagos: [{ medio: 'efectivo', montoCentavos: 500_000, monetaryAccountId: cajaId }],
        vendedorId: duenioId,
        cashSessionId: sesionId,
        terminal: 'T1',
        idempotencyKey: 'contado-anulada',
      });

      const r = await anularVenta(db, {
        ventaId: venta.id,
        usuarioId: duenioId,
        motivo: 'Mal cargada',
      });

      expect(r.aDevolverCentavos).toBe(0);
      expect(await devolucionesPendientes(db)).toHaveLength(0);
    });

    it('marcarla devuelta la saca de la lista y deja quién la cerró', async () => {
      const venta = await fiar(2);
      await cobrarFiado(db, {
        customerId: clienteId,
        montoCentavos: 400_000,
        medio: 'efectivo',
        cashSessionId: sesionId,
        usuarioId: duenioId,
        idempotencyKey: 'dev-2',
      });
      await anularVenta(db, { ventaId: venta.id, usuarioId: duenioId, motivo: 'Anulada' });

      const [pendiente] = await devolucionesPendientes(db);
      await marcarDevuelta(db, {
        id: pendiente!.id,
        usuarioId: duenioId,
        nota: 'En efectivo, del cajón',
      });

      expect(await devolucionesPendientes(db)).toHaveLength(0);
      expect((await totalADevolver(db)).totalCentavos).toBe(0);

      // Pero no se borra: queda en el historial del cliente.
      const historial = await historialDeDevoluciones(db, clienteId);
      expect(historial).toHaveLength(1);
      expect(historial[0]!.resueltoEn).not.toBeNull();
    });

    it('no se puede marcar devuelta dos veces', async () => {
      const venta = await fiar(2);
      await cobrarFiado(db, {
        customerId: clienteId,
        montoCentavos: 400_000,
        medio: 'efectivo',
        cashSessionId: sesionId,
        usuarioId: duenioId,
        idempotencyKey: 'dev-3',
      });
      await anularVenta(db, { ventaId: venta.id, usuarioId: duenioId, motivo: 'Anulada' });

      const [pendiente] = await devolucionesPendientes(db);
      await marcarDevuelta(db, { id: pendiente!.id, usuarioId: duenioId });

      await expect(
        marcarDevuelta(db, { id: pendiente!.id, usuarioId: duenioId }),
      ).rejects.toBeInstanceOf(ErrorDevolucion);
    });

    it('pagó de más de lo que esta venta dejó: solo se devuelve lo de esta venta', async () => {
      // Dos ventas fiadas de $10.000 cada una y un pago de $15.000.
      const primera = await fiar(2, 'dos-a');
      await fiar(2, 'dos-b');
      await cobrarFiado(db, {
        customerId: clienteId,
        montoCentavos: 1_500_000,
        medio: 'efectivo',
        cashSessionId: sesionId,
        usuarioId: duenioId,
        idempotencyKey: 'dev-4',
      });
      expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(500_000);

      // Se anula la primera: se le saca lo que queda ($5.000) y los otros
      // $5.000 de esa venta ya estaban pagados.
      const r = await anularVenta(db, {
        ventaId: primera.id,
        usuarioId: duenioId,
        motivo: 'Anulada',
      });

      expect(r.deudaBorradaCentavos).toBe(500_000);
      expect(r.aDevolverCentavos).toBe(500_000);
      expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(0);
    });
  });
});

describe('migrar una ficha de papel', () => {
  it('carga el saldo de la libreta y lo marca como migrado', async () => {
    const cuenta = await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 4_500_000,
      usuarioId: duenioId,
      nota: 'Libreta, hoja 12',
    });

    expect(cuenta.saldoCentavos).toBe(4_500_000);
    expect(cuenta.origen).toBe('migrado_papel');
  });

  it('no se carga dos veces sobre la misma cuenta', async () => {
    await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 4_500_000,
      usuarioId: duenioId,
    });

    await expect(
      migrarFichaDePapel(db, {
        customerId: clienteId,
        saldoCentavos: 1_000_000,
        usuarioId: duenioId,
      }),
    ).rejects.toBeInstanceOf(ErrorFiado);
  });

  it('el saldo migrado se cobra igual que cualquier otro', async () => {
    await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 4_500_000,
      usuarioId: duenioId,
    });

    const r = await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 4_500_000,
      medio: 'efectivo',
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'cobro-libreta',
    });

    expect(r.saldoCentavos).toBe(0);
  });
});

describe('consultas', () => {
  it('lista quién debe, de mayor a menor', async () => {
    const [otro] = await db.insert(customers).values({ nombre: 'Mayco' }).returning();
    await fiar(2); // Gaby: $10.000
    await migrarFichaDePapel(db, {
      customerId: otro!.id,
      saldoCentavos: 5_000_000,
      usuarioId: duenioId,
    });

    const lista = await deudores(db);

    expect(lista.map((d) => d.nombre)).toEqual(['Mayco', 'Gaby González']);
    expect(lista[0]!.saldoCentavos).toBe(5_000_000);
    expect(lista[1]!.origen).toBe('sistema');
  });

  it('quien no debe nada no aparece', async () => {
    await fiar(2);
    await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 1_000_000,
      medio: 'efectivo',
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'saldar',
    });

    expect(await deudores(db)).toHaveLength(0);
    expect((await totalFiado(db)).totalCentavos).toBe(0);
  });

  it('el total fiado suma todas las cuentas', async () => {
    const [otro] = await db.insert(customers).values({ nombre: 'Mayco' }).returning();
    await fiar(2);
    await migrarFichaDePapel(db, {
      customerId: otro!.id,
      saldoCentavos: 5_000_000,
      usuarioId: duenioId,
    });

    expect(await totalFiado(db)).toEqual({
      totalCentavos: 6_000_000,
      totalUsdCentavos: 0,
      clientes: 2,
    });
  });

  it('los movimientos muestran lo que se fió y lo que se cobró, juntos', async () => {
    const venta = await fiar(2);
    await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 400_000,
      medio: 'efectivo',
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'mov',
      nota: 'A cuenta',
    });

    const movimientos = await movimientosDe(db, clienteId);

    expect(movimientos).toHaveLength(2);
    expect(movimientos[0]!.tipo).toBe('cobro');
    expect(movimientos[0]!.montoCentavos).toBe(400_000);
    expect(movimientos[1]).toMatchObject({
      tipo: 'venta',
      descripcion: `Venta ${venta.numero}`,
      montoCentavos: 1_000_000,
    });
  });
});

describe('lo que se vende en dólares se debe en dólares (D62)', () => {
  /** $1.571 por dólar: la cotización con la que se hacen todas estas cuentas. */
  const TC = 1_571_00;
  let iphoneId: string;
  let dolaresId: string;

  beforeEach(async () => {
    await db.insert(exchangeRates).values({
      valorCentavos: TC,
      vigenteDesde: new Date(),
      origen: 'infodolar',
    });

    const [p] = await db
      .insert(products)
      .values({
        nombre: 'iPhone 15 Pro Max 256GB',
        moneda: 'USD',
        precioUsdCentavos: 1_500_00,
        precioCentavos: usdAPesos(1_500_00, TC),
        stock: 1,
      })
      .returning();
    iphoneId = p!.id;

    const [c] = await db
      .insert(monetaryAccounts)
      .values({ nombre: 'Caja en dólares', tipo: 'dolares' })
      .returning();
    dolaresId = c!.id;
  });

  /** Vende el iPhone y fía `fiadoCentavos` pesos; el resto entra en efectivo. */
  async function venderIphoneFiando(fiadoCentavos: number) {
    const total = usdAPesos(1_500_00, TC);
    return confirmarVenta(db, {
      lineas: [{ productId: iphoneId, cantidad: 1 }],
      pagos: [
        { medio: 'efectivo', montoCentavos: total - fiadoCentavos, monetaryAccountId: cajaId },
        { medio: 'cuenta_corriente', montoCentavos: fiadoCentavos },
      ],
      clienteId,
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: `usd-${Math.random()}`,
    });
  }

  it('la deuda queda en dólares, no en pesos', async () => {
    // Es el cambio entero: el comprobante dice dólares porque así se pactó, y
    // la base ahora dice lo mismo.
    await venderIphoneFiando(314_200_00);

    const cuenta = await cuentaDe(db, clienteId);
    expect(cuenta!.saldoCentavos).toBe(0);
    expect(cuenta!.saldoUsdCentavos).toBe(pesosAUsdExacto(314_200_00, TC));
  });

  it('la deuda en dólares no se mueve cuando se mueve el dólar', async () => {
    /*
     * El motivo de todo esto. Con la deuda en pesos del día de la venta, el
     * cliente que vuelve con el dólar más caro debía menos de lo que firmó y
     * el sistema le decía «pagaste todo» cuando faltaba.
     */
    await venderIphoneFiando(314_200_00);
    const antes = (await cuentaDe(db, clienteId))!.saldoUsdCentavos;

    await db.insert(exchangeRates).values({
      valorCentavos: 1_800_00,
      vigenteDesde: new Date(Date.now() + 1000),
      origen: 'infodolar',
    });

    expect((await cuentaDe(db, clienteId))!.saldoUsdCentavos).toBe(antes);
  });

  it('un carrito mezclado NO se fía en dólares', async () => {
    /*
     * Un iPhone y una funda en la misma venta: la funda se pactó en pesos y
     * hacerla seguir al dólar sería cambiarle el precio a algo que nadie
     * acordó así. La venta mezclada queda en pesos, entera.
     */
    const total = usdAPesos(1_500_00, TC) + 500_000;
    await confirmarVenta(db, {
      lineas: [
        { productId: iphoneId, cantidad: 1 },
        { productId: vidrioId, cantidad: 1 },
      ],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: total }],
      clienteId,
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: `mezcla-${Math.random()}`,
    });

    const cuenta = await cuentaDe(db, clienteId);
    expect(cuenta!.saldoUsdCentavos).toBe(0);
    expect(cuenta!.saldoCentavos).toBe(total);
  });

  it('las dos deudas conviven y no se suman', async () => {
    // Un cliente que compró un iPhone y después un vidrio debe dos cosas
    // distintas. Juntarlas obligaría a elegir una cotización.
    await venderIphoneFiando(314_200_00);
    await fiar(2, 'vidrios-aparte');

    const cuenta = await cuentaDe(db, clienteId);
    expect(cuenta!.saldoUsdCentavos).toBe(pesosAUsdExacto(314_200_00, TC));
    expect(cuenta!.saldoCentavos).toBe(1_000_000);
  });

  it('se cobra en billetes verdes: la deuda baja en dólares y el cajón verde sube', async () => {
    await venderIphoneFiando(314_200_00);
    const deuda = (await cuentaDe(db, clienteId))!.saldoUsdCentavos;

    const r = await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 100_00,
      monedaDeuda: 'USD',
      medio: 'dolares',
      monetaryAccountId: dolaresId,
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: `cobro-usd-${Math.random()}`,
    });

    expect(r.saldoCentavos).toBe(deuda - 100_00);
    // Mismo signo en los dos lados: no hubo conversión.
    expect(r.montoCajaCentavos).toBe(100_00);

    const [verde] = await db
      .select()
      .from(monetaryAccounts)
      .where(eq(monetaryAccounts.id, dolaresId));
    expect(verde!.saldoCentavos).toBe(100_00);
  });

  it('se cobra en pesos: cancela dólares y entran los pesos de hoy', async () => {
    /*
     * El caso que más va a pasar: el cliente debe dólares y paga con una
     * transferencia. Son dos números —los dólares que se cancelan y los pesos
     * que entraron— y los dos quedan guardados.
     */
    await venderIphoneFiando(314_200_00);
    const deuda = (await cuentaDe(db, clienteId))!.saldoUsdCentavos;

    const r = await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 137_00,
      monedaDeuda: 'USD',
      cotizacionCentavos: TC,
      medio: 'efectivo',
      monetaryAccountId: cajaId,
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: `cobro-pesos-${Math.random()}`,
    });

    expect(r.saldoCentavos).toBe(deuda - 137_00);

    /*
     * US$ 137 al dólar de $1.571 son **$215.227 exactos**.
     *
     * El monto está elegido para que el redondeo al millar de `usdAPesos` dé
     * distinto —$215.000— porque con cifras redondas los dos coinciden y el
     * test no prueba nada. La primera versión usaba US$ 100 a $1.800 y pasaba
     * igual con el redondeo puesto.
     *
     * Son $227 de diferencia en un cobro. Doscientas veces por año, siempre
     * para el mismo lado.
     */
    expect(r.montoCajaCentavos).toBe(215_227_00);
    expect(usdAPesos(137_00, TC)).not.toBe(r.montoCajaCentavos);
  });

  it('sin cotización, cobrar una deuda en dólares con otro medio se frena', async () => {
    await venderIphoneFiando(314_200_00);

    await rechazaCon(
      cobrarFiado(db, {
        customerId: clienteId,
        montoCentavos: 100_00,
        monedaDeuda: 'USD',
        medio: 'transferencia',
        cashSessionId: sesionId,
        usuarioId: duenioId,
        idempotencyKey: `sin-tc-${Math.random()}`,
      }),
      /cotizaci/i,
    );
  });

  it('pagar dólares no marca pagada una cuota en pesos', async () => {
    /*
     * La trampa de tener las dos deudas en la misma cuenta. Sin filtrar por
     * moneda, cobrar US$ 100 encuentra la cuota en pesos más vieja —que para la
     * aritmética es «10000 centavos»— y la marca pagada. La deuda en pesos se
     * borra sola y nadie se entera.
     *
     * Hace falta que la deuda en pesos TENGA cuotas: con un saldo abierto no
     * hay nada que imputar y el filtro no se ejercita. La primera versión de
     * este test no las tenía y pasaba con el filtro sacado.
     */
    await confirmarVenta(db, {
      lineas: [{ productId: vidrioId, cantidad: 2 }],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: 1_000_000 }],
      clienteId,
      vendedorId: duenioId,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: `pesos-con-plan-${Math.random()}`,
      plan: { cadencia: cadencia('mensual'), cuotas: 2 },
    });
    await venderIphoneFiando(314_200_00);

    await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 100_00,
      monedaDeuda: 'USD',
      medio: 'dolares',
      monetaryAccountId: dolaresId,
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: `no-toca-pesos-${Math.random()}`,
    });

    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(1_000_000);

    // Y ninguna cuota en pesos quedó tocada.
    const enPesos = await cuotasDeCuenta(db, (await cuentaDe(db, clienteId))!.id, 'ARS');
    expect(enPesos).toHaveLength(2);
    expect(enPesos.every((c) => c.pagadoCentavos === 0)).toBe(true);
  });

  it('no se puede pagar más dólares de los que se deben', async () => {
    await venderIphoneFiando(314_200_00);

    await rechazaCon(
      cobrarFiado(db, {
        customerId: clienteId,
        montoCentavos: 10_000_00,
        monedaDeuda: 'USD',
        medio: 'dolares',
        monetaryAccountId: dolaresId,
        cashSessionId: sesionId,
        usuarioId: duenioId,
        idempotencyKey: `de-mas-${Math.random()}`,
      }),
      /US\$/,
    );
  });

  it('el que debe SOLO dólares aparece en la lista de Fiado', async () => {
    /*
     * El agujero que dejaba el cambio a medio hacer: la lista filtraba por
     * `saldo_centavos > 0` y el que compró un iPhone en cuotas tiene ese saldo
     * en cero. La deuda existía en la base y no la veía nadie, así que no la
     * cobraba nadie.
     */
    await venderIphoneFiando(314_200_00);

    const lista = await deudores(db);

    expect(lista).toHaveLength(1);
    expect(lista[0]!.saldoCentavos).toBe(0);
    expect(lista[0]!.saldoUsdCentavos).toBe(pesosAUsdExacto(314_200_00, TC));

    // Y cuenta como cliente con saldo en el encabezado: «nadie debe nada» con un
    // iPhone sin cobrar es la misma mentira, más grande.
    expect(await totalFiado(db)).toEqual({
      totalCentavos: 0,
      totalUsdCentavos: pesosAUsdExacto(314_200_00, TC),
      clientes: 1,
    });
  });

  it('el total por cobrar lleva las dos monedas separadas', async () => {
    // Nunca sumadas: un total mezclado sería plata que no es de nadie, y
    // convertirlo acá sería congelar una cotización que cambia cada dos horas.
    await venderIphoneFiando(314_200_00);
    await fiar(2, 'pesos-y-dolares');

    expect(await totalFiado(db)).toEqual({
      totalCentavos: 1_000_000,
      totalUsdCentavos: pesosAUsdExacto(314_200_00, TC),
      clientes: 1,
    });
  });

  it('el que terminó de pagar los dólares sale de la lista', async () => {
    await venderIphoneFiando(314_200_00);
    const deuda = (await cuentaDe(db, clienteId))!.saldoUsdCentavos;

    await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: deuda,
      monedaDeuda: 'USD',
      medio: 'dolares',
      monetaryAccountId: dolaresId,
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: `saldar-usd-${Math.random()}`,
    });

    expect(await deudores(db)).toHaveLength(0);
    expect(await totalFiado(db)).toEqual({
      totalCentavos: 0,
      totalUsdCentavos: 0,
      clientes: 0,
    });
  });
});
