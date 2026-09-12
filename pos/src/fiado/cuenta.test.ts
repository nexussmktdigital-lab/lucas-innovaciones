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
  customers,
  monetaryAccounts,
  products,
  users,
} from '@/db/schema';
import { confirmarVenta, ErrorVenta } from '@/ventas/confirmar';
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
import { anularVenta } from '@/ventas/anular';

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

    expect(await totalFiado(db)).toEqual({ totalCentavos: 6_000_000, clientes: 2 });
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
