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
  creditCharges,
  creditPayments,
  exchangeRates,
  customers,
  monetaryAccounts,
  products,
  sales,
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

  /*
   * Las entregas que el cliente ya habia hecho.
   *
   * Un cliente de libreta trae meses de pagos. Sin ellos la cuenta arranca sin
   * historia y no hay forma de contestar «cuando pago la ultima vez», que es
   * lo que se mira antes de reclamarle. Van con su fecha de verdad y sin tocar
   * ninguna caja: esa plata entro meses atras y fuera del sistema.
   */
  const ENTREGAS = [
    { fecha: new Date('2026-06-16T12:00:00Z'), montoCentavos: 22_000_00, medio: 'efectivo' as const },
    { fecha: new Date('2026-07-27T12:00:00Z'), montoCentavos: 106_000_00, medio: 'transferencia' as const },
    { fecha: new Date('2026-10-27T12:00:00Z'), montoCentavos: 50_000_00, medio: 'transferencia' as const },
  ];

  it('el saldo que se escribe es el de antes, y las entregas lo bajan', async () => {
    // 1.979.400 de arrastre − 178.000 de entregas = 1.801.400.
    const cuenta = await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 1_979_400_00,
      usuarioId: duenioId,
      entregas: ENTREGAS,
    });

    expect(cuenta.saldoCentavos).toBe(1_801_400_00);
    expect(cuenta.entregasCargadas).toBe(3);
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(1_801_400_00);
  });

  it('cada entrega queda guardada con su fecha y su medio', async () => {
    await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 1_979_400_00,
      usuarioId: duenioId,
      entregas: ENTREGAS,
    });

    const cobros = (await movimientosDe(db, clienteId)).filter((m) => m.tipo === 'cobro');

    expect(cobros).toHaveLength(3);
    // Del mas nuevo al mas viejo, como toda la lista de movimientos.
    expect(cobros[0]).toMatchObject({ montoCentavos: 50_000_00, medio: 'transferencia' });
    expect(cobros[2]).toMatchObject({ montoCentavos: 22_000_00, medio: 'efectivo' });
    expect(cobros[2]!.fecha.toISOString()).toBe('2026-06-16T12:00:00.000Z');
  });

  /*
   * El saldo de cada recibo es el de ese dia, no el de hoy: si alguien
   * reimprime la entrega de junio, tiene que decir lo que decia en junio.
   */
  it('cada entrega deja anotado el saldo que quedaba ese dia', async () => {
    await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 1_979_400_00,
      usuarioId: duenioId,
      entregas: ENTREGAS,
    });

    const cobros = await db.select().from(creditPayments).orderBy(creditPayments.fecha);
    // Debía 1.979.400 y fue bajando: −22.000, −106.000, −50.000.
    expect(cobros[0]!.saldoResultanteCentavos).toBe(1_957_400_00);
    expect(cobros[1]!.saldoResultanteCentavos).toBe(1_851_400_00);
    expect(cobros[2]!.saldoResultanteCentavos).toBe(1_801_400_00);
  });

  it('no tocan ninguna caja: esa plata entro antes y afuera', async () => {
    await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 1_979_400_00,
      usuarioId: duenioId,
      entregas: ENTREGAS,
    });

    const cobros = await db.select().from(creditPayments);
    for (const c of cobros) {
      expect(c.migrado).toBe(true);
      expect(c.cashSessionId).toBeNull();
      expect(c.monetaryAccountId).toBeNull();
    }
    expect(await db.select().from(cashMovements)).toHaveLength(0);
  });

  it('las entregas van en orden de fecha aunque vengan desordenadas', async () => {
    await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 278_000_00,
      usuarioId: duenioId,
      entregas: [ENTREGAS[2]!, ENTREGAS[0]!, ENTREGAS[1]!],
    });

    const cobros = await db.select().from(creditPayments).orderBy(creditPayments.fecha);
    expect(cobros.map((c) => c.montoCentavos)).toEqual([22_000_00, 106_000_00, 50_000_00]);
    // Y el saldo baja parejo: 278.000 − 178.000 = 100.000.
    expect(cobros.at(-1)!.saldoResultanteCentavos).toBe(100_000_00);
  });

  it('sin entregas se comporta como antes', async () => {
    const cuenta = await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 4_500_000,
      usuarioId: duenioId,
    });

    expect(cuenta.entregasCargadas).toBe(0);
    expect(await db.select().from(creditPayments)).toHaveLength(0);
  });

  /*
   * El caso de Uriel, tal como pasó. El cliente volvió al local y se llevó
   * mercadería antes de que nadie cargara su libreta: tres ventas por
   * $201.000 sacaron la cuenta de cero y, con la regla vieja, cerraron la
   * única puerta que había para meter el saldo viejo.
   */
  it('la libreta entra aunque el cliente ya tenga ventas en el sistema', async () => {
    await fiar(2); // $10.000 de una venta de verdad
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(1_000_000);

    const cuenta = await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 1_600_400_00,
      usuarioId: duenioId,
    });

    // Se suma, no reemplaza: la venta del sistema sigue estando.
    expect(cuenta.saldoCentavos).toBe(1_000_000 + 1_600_400_00);
    expect(cuenta.origen).toBe('migrado_papel');
  });

  it('con ventas previas, cada entrega anota el saldo total de ese día', async () => {
    await fiar(2); // $10.000

    await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 120_000_00,
      usuarioId: duenioId,
      entregas: [
        { fecha: new Date('2026-06-16T12:00:00Z'), montoCentavos: 20_000_00, medio: 'efectivo' },
      ],
    });

    // Debía 10.000 de la venta + 120.000 del cuaderno = 130.000; tras la
    // entrega, 110.000.
    const [cobro] = await db.select().from(creditPayments);
    expect(cobro!.saldoResultanteCentavos).toBe(110_000_00);
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(110_000_00);
  });

  it('pero una libreta ya cargada no se carga de nuevo', async () => {
    await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 100_000_00,
      usuarioId: duenioId,
    });

    await expect(
      migrarFichaDePapel(db, {
        customerId: clienteId,
        saldoCentavos: 50_000_00,
        usuarioId: duenioId,
      }),
    ).rejects.toThrow(/ya se cargó/i);

    // Y no sumó nada en el intento.
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(100_000_00);
  });

  /*
   * Las compras del cuaderno.
   *
   * Es lo que el local pidió ver: qué se llevó y cuándo, no solo cuánto debe.
   * No son ventas —no tocan stock ni facturación— porque salieron del local
   * meses antes de que el sistema existiera.
   */
  const COMPRAS = [
    {
      fecha: new Date('2026-06-16T12:00:00Z'),
      fechaEstimada: false,
      montoCentavos: 731_700_00,
      detalle: '1 x Auricular NETMAK NM Live $22.000\n1 x Silla oficina $87.000',
    },
    {
      fecha: new Date('2026-06-19T12:00:00Z'),
      fechaEstimada: false,
      montoCentavos: 45_000_00,
      detalle: '1 x Glass $3.500\n1 x funda $6.000',
    },
  ];

  it('las compras suben la deuda y las entregas la bajan, en orden', async () => {
    const cuenta = await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 205_500_00,
      usuarioId: duenioId,
      compras: COMPRAS,
      entregas: [ENTREGAS[0]!], // 22.000 el 16/06
    });

    // 205.500 + 731.700 + 45.000 − 22.000 = 960.200.
    expect(cuenta.saldoCentavos).toBe(960_200_00);
    expect(cuenta.comprasCargadas).toBe(2);
  });

  it('cada compra queda con su detalle, su fecha y el saldo de ese día', async () => {
    await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 205_500_00,
      usuarioId: duenioId,
      compras: COMPRAS,
      entregas: [ENTREGAS[0]!],
    });

    const cargos = await db.select().from(creditCharges).orderBy(creditCharges.fecha);
    expect(cargos).toHaveLength(2);
    expect(cargos[0]!.detalle).toContain('Silla oficina');
    // 205.500 + 731.700 = 937.200 justo después de la primera compra.
    expect(cargos[0]!.saldoResultanteCentavos).toBe(937_200_00);
    expect(cargos[0]!.fecha.toISOString()).toBe('2026-06-16T12:00:00.000Z');
  });

  /*
   * Con la misma fecha, primero la compra: el cliente se lleva la mercadería
   * y después paga, que es el orden del cuaderno. Al revés, el saldo anotado
   * en cada papel sería otro.
   */
  it('con la misma fecha, la compra va antes que la entrega', async () => {
    await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 100_000_00,
      usuarioId: duenioId,
      compras: [COMPRAS[0]!],
      entregas: [ENTREGAS[0]!], // misma fecha: 16/06
    });

    const [cargo] = await db.select().from(creditCharges);
    const [cobro] = await db.select().from(creditPayments);
    expect(cargo!.saldoResultanteCentavos).toBe(831_700_00); // 100.000 + 731.700
    expect(cobro!.saldoResultanteCentavos).toBe(809_700_00); // − 22.000
  });

  it('las compras se ven en los movimientos, con su detalle', async () => {
    await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 205_500_00,
      usuarioId: duenioId,
      compras: COMPRAS,
    });

    const compras = (await movimientosDe(db, clienteId)).filter((m) => m.tipo === 'compra');
    expect(compras).toHaveLength(2);
    // De la más nueva a la más vieja, como toda la lista.
    expect(compras[0]!.montoCentavos).toBe(45_000_00);
    expect(compras[1]!.detalle).toContain('Auricular NETMAK NM Live');
  });

  it('una compra con fecha deducida queda marcada como tal', async () => {
    await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 100_000_00,
      usuarioId: duenioId,
      compras: [{ ...COMPRAS[0]!, fechaEstimada: true }],
    });

    const [compra] = (await movimientosDe(db, clienteId)).filter((m) => m.tipo === 'compra');
    expect(compra!.fechaEstimada).toBe(true);
  });

  /*
   * La razón de que esto no sean ventas: la mercadería salió del local hace
   * meses. Descontarla de nuevo dejaría el stock en menos de lo que hay.
   */
  it('cargar la libreta no toca el stock ni factura nada', async () => {
    const antes = (await db.select().from(products))[0]!.stock;

    await migrarFichaDePapel(db, {
      customerId: clienteId,
      saldoCentavos: 205_500_00,
      usuarioId: duenioId,
      compras: COMPRAS,
      entregas: ENTREGAS,
    });

    expect((await db.select().from(products))[0]!.stock).toBe(antes);
    expect(await db.select().from(sales)).toHaveLength(0);
    expect(await db.select().from(cashMovements)).toHaveLength(0);
  });

  it('sin saldo anterior ni compras no hay nada que cargar', async () => {
    await expect(
      migrarFichaDePapel(db, { customerId: clienteId, saldoCentavos: 0, usuarioId: duenioId }),
    ).rejects.toBeInstanceOf(ErrorFiado);
  });

  it('una compra en cero frena toda la carga', async () => {
    await expect(
      migrarFichaDePapel(db, {
        customerId: clienteId,
        saldoCentavos: 100_000_00,
        usuarioId: duenioId,
        compras: [{ ...COMPRAS[0]!, montoCentavos: 0 }],
      }),
    ).rejects.toBeInstanceOf(ErrorFiado);

    expect(await db.select().from(creditCharges)).toHaveLength(0);
    expect((await cuentaDe(db, clienteId))?.saldoCentavos ?? 0).toBe(0);
  });

  it('una entrega en cero o con fecha rota frena toda la carga', async () => {
    await expect(
      migrarFichaDePapel(db, {
        customerId: clienteId,
        saldoCentavos: 100_000_00,
        usuarioId: duenioId,
        entregas: [{ fecha: new Date('2026-06-16'), montoCentavos: 0, medio: 'efectivo' }],
      }),
    ).rejects.toBeInstanceOf(ErrorFiado);

    await expect(
      migrarFichaDePapel(db, {
        customerId: clienteId,
        saldoCentavos: 100_000_00,
        usuarioId: duenioId,
        entregas: [{ fecha: new Date('no es fecha'), montoCentavos: 1_000_00, medio: 'efectivo' }],
      }),
    ).rejects.toBeInstanceOf(ErrorFiado);

    // Y no quedo nada a medio cargar.
    expect((await cuentaDe(db, clienteId))?.saldoCentavos ?? 0).toBe(0);
    expect(await db.select().from(creditPayments)).toHaveLength(0);
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

  /*
   * El cobro trae el id de su pago porque ese id es el recibo: `/recibo/<id>`.
   * Sin él, el recibo solo existía en el momento de cobrar, y si la impresora
   * fallaba el pago se quedaba sin papel para siempre.
   */
  it('cada cobro trae con qué volver a imprimir su recibo', async () => {
    await fiar(2);
    const pago = await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 400_000,
      medio: 'transferencia',
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'mov-recibo',
    });

    const [cobro] = await movimientosDe(db, clienteId);

    expect(cobro).toMatchObject({
      tipo: 'cobro',
      pagoId: pago.id,
      moneda: 'ARS',
      medio: 'transferencia',
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

  /*
   * La ficha del cliente mostraba todos los cobros en pesos. Un pago de
   * US$ 100 figuraba como «$ 100»: mil quinientas veces menos de lo que
   * entró. El movimiento tiene que decir en qué moneda se pagó.
   */
  it('un cobro en dólares se declara en dólares, no en pesos', async () => {
    await venderIphoneFiando(314_200_00);
    await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 100_00,
      monedaDeuda: 'USD',
      medio: 'dolares',
      monetaryAccountId: dolaresId,
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'mov-usd',
    });

    const cobro = (await movimientosDe(db, clienteId)).find((m) => m.tipo === 'cobro');

    expect(cobro).toMatchObject({ moneda: 'USD', montoCentavos: 100_00, medio: 'dolares' });
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

/**
 * El recargo al cobrar una cuota.
 *
 * El local lo cobra en dos casos: el cliente paga con cheque, o paga tarde.
 * Lo que no puede pasar es que el recargo se lleve parte de la deuda: el
 * cliente pagaría de más y seguiría debiendo lo mismo.
 */
describe('cobrar con recargo', () => {
  it('el recargo entra a la caja y NO baja la deuda', async () => {
    await fiar(2); // debe $10.000

    const r = await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 400_000,
      recargoCentavos: 20_000,
      recargoMotivo: 'cheque',
      medio: 'cheque',
      monetaryAccountId: cajaId,
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'cobro-recargo-1',
    });

    // La deuda baja por el monto, no por lo entregado.
    expect(r.saldoCentavos).toBe(600_000);
    expect((await cuentaDe(db, clienteId))?.saldoCentavos).toBe(600_000);

    // Y a la caja entran los dos juntos: es lo que el cliente dio.
    expect(r.montoCajaCentavos).toBe(420_000);
    const [mov] = await db.select().from(cashMovements);
    expect(mov!.montoCentavos).toBe(420_000);
  });

  it('queda anotado cuánto fue de recargo y por qué', async () => {
    await fiar(2);
    const r = await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 100_000,
      recargoCentavos: 15_000,
      recargoMotivo: 'demora',
      medio: 'efectivo',
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'cobro-recargo-2',
    });

    const [enBase] = await db
      .select()
      .from(creditPayments)
      .where(eq(creditPayments.id, r.id));
    expect(enBase!.recargoCentavos).toBe(15_000);
    expect(enBase!.recargoMotivo).toBe('demora');
  });

  /*
   * Un recargo sin motivo es un número que dentro de seis meses nadie le
   * puede explicar al cliente que lo reclama.
   */
  it('un recargo sin motivo no se guarda', async () => {
    await fiar(2);
    await expect(
      cobrarFiado(db, {
        customerId: clienteId,
        montoCentavos: 100_000,
        recargoCentavos: 15_000,
        medio: 'efectivo',
        cashSessionId: sesionId,
        usuarioId: duenioId,
        idempotencyKey: 'cobro-recargo-3',
      }),
    ).rejects.toThrow(/por qué se cobra/);
  });

  it('la base tampoco deja un recargo sin motivo', async () => {
    await fiar(2);
    const cuenta = await cuentaDe(db, clienteId);
    await rechazaCon(
      db.insert(creditPayments).values({
        creditAccountId: cuenta!.id,
        montoCentavos: 100_000,
        recargoCentavos: 15_000,
        monedaDeuda: 'ARS',
        medio: 'efectivo',
        cobradoPorId: duenioId,
        saldoResultanteCentavos: 900_000,
        idempotencyKey: 'cobro-recargo-sql',
      }),
      /credit_payments_recargo_ck/,
    );
  });

  it('sin recargo todo sigue igual que siempre', async () => {
    await fiar(2);
    const r = await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 400_000,
      medio: 'efectivo',
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'cobro-recargo-4',
    });
    expect(r.recargoCentavos).toBe(0);
    expect(r.recargoMotivo).toBeNull();
    expect(r.montoCajaCentavos).toBe(400_000);
  });

  /*
   * Con dos monedas, el recargo se convierte junto con el monto: son una
   * sola entrega. Convertirlos por separado daría dos redondeos donde hay un
   * solo billete.
   */
  it('cobrando una deuda en pesos con dólares, el recargo viaja con el monto', async () => {
    await fiar(2); // $10.000 de deuda en pesos

    const r = await cobrarFiado(db, {
      customerId: clienteId,
      montoCentavos: 300_000, // $3.000 de deuda
      recargoCentavos: 15_000, // $150 de recargo
      recargoMotivo: 'demora',
      medio: 'dolares',
      cotizacionCentavos: 1_500_00,
      cashSessionId: sesionId,
      usuarioId: duenioId,
      idempotencyKey: 'cobro-recargo-5',
    });

    // $3.150 a 1.500 son US$ 2,10: los dos juntos, un solo redondeo.
    expect(r.montoCajaCentavos).toBe(210);
    expect(r.saldoCentavos).toBe(700_000);
  });
});
