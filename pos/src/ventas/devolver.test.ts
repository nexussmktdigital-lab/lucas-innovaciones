/**
 * Tests de las devoluciones, contra la base real.
 *
 * Lo que importa: que el turno viejo no se mueva, que la plata salga del cajón
 * de hoy, que no se pueda devolver más de lo que se llevaron, y que a quien
 * todavía debe no se le devuelva efectivo dejándole la deuda entera.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  cashMovements,
  creditAccounts,
  customers,
  monetaryAccounts,
  products,
  returns,
  stockMovements,
  syncQueue,
  users,
} from '@/db/schema';
import { abrirCaja, cerrarCaja, resumenDeSesion } from '@/caja/sesion';
import { confirmarVenta } from '@/ventas/confirmar';
import { anularVenta } from '@/ventas/anular';
import { cobrarFiado } from '@/fiado/cuenta';
import { formatearFechaHora } from '@/lib/fecha';
import {
  buscarVentaPorNumero,
  devolucionesDelTurno,
  devolucionesRecientes,
  ErrorDevolucion,
  loDevolvible,
  registrarDevolucion,
} from './devolver';

let db: TestDb;
let duenio: string;
let caja: string;
let vidrio: string;
let celular: string;
let cliente: string;

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
      { nombre: 'Vidrio templado 9D', precioCentavos: 5_000_00, stock: 100 },
      { nombre: 'Motorola G86', precioCentavos: 380_000_00, stock: 10 },
    ])
    .returning();
  vidrio = prods[0]!.id;
  celular = prods[1]!.id;

  const [cli] = await db.insert(customers).values({ nombre: 'Gaby' }).returning();
  cliente = cli!.id;
});

let n = 0;
function clave() {
  n += 1;
  return `dev-${n}-${Math.random()}`;
}

async function abrirTurno() {
  return abrirCaja(db, {
    terminal: 'T1',
    usuarioId: duenio,
    monetaryAccountId: caja,
    saldoInicialCentavos: 100_000_00,
  });
}

/** Una venta de ayer: se vende, se cierra el turno y se abre otro. */
async function ventaDeUnTurnoCerrado(opciones: { cantidad?: number } = {}) {
  const viejo = await abrirTurno();
  const cantidad = opciones.cantidad ?? 2;

  const venta = await confirmarVenta(db, {
    lineas: [{ productId: vidrio, cantidad }],
    pagos: [
      { medio: 'efectivo', montoCentavos: 5_000_00 * cantidad, monetaryAccountId: caja },
    ],
    vendedorId: duenio,
    cashSessionId: viejo.id,
    terminal: 'T1',
    idempotencyKey: clave(),
  });

  await cerrarCaja(db, {
    sesionId: viejo.id,
    usuarioId: duenio,
    saldoContadoCentavos: 100_000_00 + 5_000_00 * cantidad,
  });

  const hoy = await abrirTurno();
  return { venta, turnoViejo: viejo, turnoDeHoy: hoy };
}

describe('lo que se puede devolver', () => {
  it('trae las líneas con lo que queda por devolver', async () => {
    const { venta } = await ventaDeUnTurnoCerrado({ cantidad: 3 });

    const d = (await loDevolvible(db, venta.id))!;
    expect(d.numero).toBe(venta.numero);
    expect(d.lineas).toHaveLength(1);
    expect(d.lineas[0]!.cantidadVendida).toBe(3);
    expect(d.lineas[0]!.cantidadDisponible).toBe(3);
    expect(d.lineas[0]!.precioUnitarioCentavos).toBe(5_000_00);
  });

  /*
   * Devolver el precio de lista de una venta hecha con descuento es devolverle
   * al cliente más plata de la que entró.
   */
  it('el precio por unidad lleva el descuento global adentro', async () => {
    const turno = await abrirTurno();
    const venta = await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 4 }],
      descuentoGlobal: { tipo: 'porcentaje', porcentaje: 10 },
      pagos: [{ medio: 'efectivo', montoCentavos: 18_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: turno.id,
      terminal: 'T1',
      idempotencyKey: clave(),
    });

    const d = (await loDevolvible(db, venta.id))!;
    expect(d.lineas[0]!.precioUnitarioCentavos).toBe(4_500_00);
  });

  it('una venta anulada no se devuelve', async () => {
    const turno = await abrirTurno();
    const venta = await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 1 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 5_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: turno.id,
      terminal: 'T1',
      idempotencyKey: clave(),
    });
    await anularVenta(db, { ventaId: venta.id, usuarioId: duenio, motivo: 'Mal cargada' });

    await expect(loDevolvible(db, venta.id)).rejects.toThrow(ErrorDevolucion);
  });

  it('una venta que no existe no devuelve nada', async () => {
    expect(await loDevolvible(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('se puede encontrar la venta por su número', async () => {
    const { venta } = await ventaDeUnTurnoCerrado();
    expect((await buscarVentaPorNumero(db, venta.numero))!.id).toBe(venta.id);
    expect((await buscarVentaPorNumero(db, venta.numero.toLowerCase()))!.id).toBe(venta.id);
    expect(await buscarVentaPorNumero(db, 'T1-999999')).toBeNull();
  });
});

describe('devolver una venta de un turno cerrado', () => {
  it('la plata sale del cajón de hoy y el turno viejo no se mueve', async () => {
    const { venta, turnoViejo, turnoDeHoy } = await ventaDeUnTurnoCerrado({ cantidad: 2 });
    const d = (await loDevolvible(db, venta.id))!;

    const antesDeHoy = await resumenDeSesion(db, turnoDeHoy.id);

    const r = await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
      motivo: 'No le andaba',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    expect(r.totalCentavos).toBe(5_000_00);
    expect(r.devueltoCentavos).toBe(5_000_00);
    expect(r.numero).toMatch(/^DEV-T1-\d{6}$/);

    // El arqueo de hoy tiene $5.000 menos.
    const despues = await resumenDeSesion(db, turnoDeHoy.id);
    expect(despues.efectivoEsperadoCentavos).toBe(
      antesDeHoy.efectivoEsperadoCentavos - 5_000_00,
    );

    // Y el turno viejo, que ya estaba cerrado, sigue igual.
    const viejo = await resumenDeSesion(db, turnoViejo.id);
    expect(viejo.totalVendidoCentavos).toBe(10_000_00);
    expect(viejo.cantidadDeVentas).toBe(1);
  });

  /*
   * Que el efectivo esperado baje no alcanza: si nada lo explica, al cerrar el
   * turno falta plata sin motivo y quien cuenta tiene que inventar una
   * justificación. Es justo el descuadre que el arqueo vino a eliminar.
   */
  it('el arqueo explica la plata que salió, no solo la resta', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado();
    const d = (await loDevolvible(db, venta.id))!;

    await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
      motivo: 'Fallado',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    const arqueo = await resumenDeSesion(db, turnoDeHoy.id);
    expect(arqueo.devolucionesCentavos).toBe(5_000_00);

    // Y no se cuela en los otros renglones de salida.
    expect(arqueo.gastosCentavos).toBe(0);
    expect(arqueo.retirosCentavos).toBe(0);

    // La apertura, menos lo devuelto: la cuenta cierra sin nada suelto.
    expect(arqueo.efectivoEsperadoCentavos).toBe(100_000_00 - 5_000_00);
  });

  /* La venta se hizo y se cobró: sigue existiendo tal cual. */
  it('la venta original queda intacta', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado();
    const d = (await loDevolvible(db, venta.id))!;

    await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 2, vuelveAlStock: true }],
      motivo: 'Se arrepintió',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    const d2 = await loDevolvible(db, venta.id);
    expect(d2!.totalCentavos).toBe(10_000_00);
    expect(d2!.yaDevueltoCentavos).toBe(10_000_00);
    expect(d2!.lineas[0]!.cantidadDisponible).toBe(0);
  });

  it('el saldo de la cuenta baja de verdad', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado();
    const d = (await loDevolvible(db, venta.id))!;

    const [antes] = await db.select().from(monetaryAccounts).where(eq(monetaryAccounts.id, caja));

    await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
      motivo: 'Fallado',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    const [despues] = await db.select().from(monetaryAccounts).where(eq(monetaryAccounts.id, caja));
    expect(despues!.saldoCentavos).toBe(antes!.saldoCentavos - 5_000_00);

    const movimientos = await db
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.referenciaTipo, 'returns'));
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]!.montoCentavos).toBe(-5_000_00);
  });
});

describe('el stock', () => {
  it('lo que vuelve a estar vendible suma al stock', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado({ cantidad: 2 });
    const d = (await loDevolvible(db, venta.id))!;

    const [antes] = await db.select().from(products).where(eq(products.id, vidrio));

    const r = await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 2, vuelveAlStock: true }],
      motivo: 'Se arrepintió, están sin abrir',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    expect(r.unidadesAlStock).toBe(2);
    const [despues] = await db.select().from(products).where(eq(products.id, vidrio));
    expect(despues!.stock).toBe(antes!.stock + 2);
  });

  /* Un cargador fallado no se vuelve a vender. */
  it('lo fallado no vuelve al stock, pero la plata se devuelve igual', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado({ cantidad: 2 });
    const d = (await loDevolvible(db, venta.id))!;

    const [antes] = await db.select().from(products).where(eq(products.id, vidrio));

    const r = await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: false }],
      motivo: 'Vino rayado',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    expect(r.devueltoCentavos).toBe(5_000_00);
    expect(r.unidadesAlStock).toBe(0);

    const [despues] = await db.select().from(products).where(eq(products.id, vidrio));
    expect(despues!.stock).toBe(antes!.stock);

    expect(await db.select().from(stockMovements).where(eq(stockMovements.referenciaTipo, 'returns')))
      .toHaveLength(0);
  });

  it('el stock que vuelve se encola para la tienda online', async () => {
    await db.update(products).set({ wooId: 1234 }).where(eq(products.id, vidrio));

    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado();
    const d = (await loDevolvible(db, venta.id))!;

    await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
      motivo: 'Cambio de idea',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    const cola = await db
      .select()
      .from(syncQueue)
      .where(sql`${syncQueue.idempotencyKey} LIKE 'devolucion:%'`);
    expect(cola).toHaveLength(1);
  });
});

describe('cuando el cliente todavía debe', () => {
  /** Vende fiado en un turno, lo cierra y abre otro. */
  async function ventaFiadaDeAyer() {
    const viejo = await abrirTurno();
    const venta = await confirmarVenta(db, {
      lineas: [{ productId: celular, cantidad: 1 }],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: 380_000_00 }],
      clienteId: cliente,
      vendedorId: duenio,
      cashSessionId: viejo.id,
      terminal: 'T1',
      idempotencyKey: clave(),
    });
    await cerrarCaja(db, {
      sesionId: viejo.id,
      usuarioId: duenio,
      saldoContadoCentavos: 100_000_00,
    });
    const hoy = await abrirTurno();
    return { venta, turnoDeHoy: hoy };
  }

  /*
   * Devolverle efectivo a quien todavía debe por esa misma venta deja al
   * negocio sin la plata y con la deuda igual.
   */
  it('por defecto se descuenta de la deuda y no sale plata', async () => {
    const { venta, turnoDeHoy } = await ventaFiadaDeAyer();
    const d = (await loDevolvible(db, venta.id))!;
    expect(d.deudaDelClienteCentavos).toBe(380_000_00);

    const r = await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
      motivo: 'No le gustó',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
    });

    expect(r.descontadoDeDeudaCentavos).toBe(380_000_00);
    expect(r.devueltoCentavos).toBe(0);

    const [cuenta] = await db
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.customerId, cliente));
    expect(cuenta!.saldoCentavos).toBe(0);
  });

  it('si ya pagó una parte, se le descuenta lo que debe y el resto sale en plata', async () => {
    const { venta, turnoDeHoy } = await ventaFiadaDeAyer();

    // Pagó 300.000 de los 380.000: quedan 80.000 de deuda.
    await cobrarFiado(db, {
      customerId: cliente,
      montoCentavos: 300_000_00,
      medio: 'efectivo',
      cashSessionId: turnoDeHoy.id,
      usuarioId: duenio,
      idempotencyKey: clave(),
    });

    const d = (await loDevolvible(db, venta.id))!;
    expect(d.deudaDelClienteCentavos).toBe(80_000_00);

    const r = await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
      motivo: 'Fallado',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    expect(r.descontadoDeDeudaCentavos).toBe(80_000_00);
    expect(r.devueltoCentavos).toBe(300_000_00);

    const [cuenta] = await db
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.customerId, cliente));
    expect(cuenta!.saldoCentavos).toBe(0);
  });

  it('quien atiende puede decidir devolver todo en plata igual', async () => {
    const { venta, turnoDeHoy } = await ventaFiadaDeAyer();
    const d = (await loDevolvible(db, venta.id))!;

    const r = await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
      motivo: 'Lo arregla con el cliente aparte',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      descontarDeDeudaCentavos: 0,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    expect(r.descontadoDeDeudaCentavos).toBe(0);
    expect(r.devueltoCentavos).toBe(380_000_00);
  });
});

describe('lo que no deja pasar', () => {
  it('devolver más unidades de las que se llevaron', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado({ cantidad: 2 });
    const d = (await loDevolvible(db, venta.id))!;

    await expect(
      registrarDevolucion(db, {
        ventaId: venta.id,
        renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 3, vuelveAlStock: true }],
        motivo: 'Tres',
        usuarioId: duenio,
        terminal: 'T1',
        cashSessionId: turnoDeHoy.id,
        medio: 'efectivo',
        monetaryAccountId: caja,
      }),
    ).rejects.toThrow(/se vendieron 2/);
  });

  /* La segunda devolución tiene que contar la primera. */
  it('devolver de a poco hasta pasarse tampoco', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado({ cantidad: 2 });
    const d = (await loDevolvible(db, venta.id))!;
    const linea = d.lineas[0]!.saleItemId;

    const comun = {
      ventaId: venta.id,
      motivo: 'De a uno',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      medio: 'efectivo' as const,
      monetaryAccountId: caja,
    };

    await registrarDevolucion(db, {
      ...comun,
      renglones: [{ saleItemId: linea, cantidad: 1, vuelveAlStock: true }],
    });
    await registrarDevolucion(db, {
      ...comun,
      renglones: [{ saleItemId: linea, cantidad: 1, vuelveAlStock: true }],
    });

    await expect(
      registrarDevolucion(db, {
        ...comun,
        renglones: [{ saleItemId: linea, cantidad: 1, vuelveAlStock: true }],
      }),
    ).rejects.toThrow(/ya se devolvieron 2/);
  });

  it('sin caja abierta no se devuelve', async () => {
    const { venta, turnoViejo } = await ventaDeUnTurnoCerrado();
    const d = (await loDevolvible(db, venta.id))!;

    await expect(
      registrarDevolucion(db, {
        ventaId: venta.id,
        renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
        motivo: 'Fallado',
        usuarioId: duenio,
        terminal: 'T1',
        cashSessionId: turnoViejo.id, // cerrado
        medio: 'efectivo',
        monetaryAccountId: caja,
      }),
    ).rejects.toThrow(/caja abierta/);
  });

  it('sin motivo tampoco', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado();
    const d = (await loDevolvible(db, venta.id))!;

    await expect(
      registrarDevolucion(db, {
        ventaId: venta.id,
        renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
        motivo: '  ',
        usuarioId: duenio,
        terminal: 'T1',
        cashSessionId: turnoDeHoy.id,
        medio: 'efectivo',
        monetaryAccountId: caja,
      }),
    ).rejects.toThrow(/por qué se devuelve/);
  });

  it('si sale plata hay que decir por dónde', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado();
    const d = (await loDevolvible(db, venta.id))!;

    await expect(
      registrarDevolucion(db, {
        ventaId: venta.id,
        renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
        motivo: 'Fallado',
        usuarioId: duenio,
        terminal: 'T1',
        cashSessionId: turnoDeHoy.id,
      }),
    ).rejects.toThrow(/por dónde sale/);
  });

  it('un renglón de otra venta no entra', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado();

    await expect(
      registrarDevolucion(db, {
        ventaId: venta.id,
        renglones: [
          { saleItemId: '00000000-0000-0000-0000-000000000000', cantidad: 1, vuelveAlStock: true },
        ],
        motivo: 'Ajeno',
        usuarioId: duenio,
        terminal: 'T1',
        cashSessionId: turnoDeHoy.id,
        medio: 'efectivo',
        monetaryAccountId: caja,
      }),
    ).rejects.toThrow(/no es de esta venta/);
  });

  /* Si fallara a medias quedaría plata movida sin devolución que la explique. */
  it('una devolución rechazada no deja nada atrás', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado({ cantidad: 1 });
    const d = (await loDevolvible(db, venta.id))!;

    await expect(
      registrarDevolucion(db, {
        ventaId: venta.id,
        renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 5, vuelveAlStock: true }],
        motivo: 'Demasiadas',
        usuarioId: duenio,
        terminal: 'T1',
        cashSessionId: turnoDeHoy.id,
        medio: 'efectivo',
        monetaryAccountId: caja,
      }),
    ).rejects.toThrow();

    expect(await db.select().from(returns)).toHaveLength(0);
    expect(await db.select().from(cashMovements).where(eq(cashMovements.referenciaTipo, 'returns')))
      .toHaveLength(0);
  });
});

describe('una devolución no se edita', () => {
  it('el disparador de la base no deja tocarla', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado();
    const d = (await loDevolvible(db, venta.id))!;

    const r = await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
      motivo: 'Fallado',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    await expect(
      db.execute(sql`UPDATE returns SET motivo = 'otro' WHERE id = ${r.id}`),
    ).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM returns WHERE id = ${r.id}`)).rejects.toThrow();
  });
});

describe('el listado', () => {
  it('trae lo devuelto con su venta y su motivo', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado();
    const d = (await loDevolvible(db, venta.id))!;

    await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
      motivo: 'Vino fallado de fábrica',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    const [ultima] = await devolucionesRecientes(db);
    expect(ultima!.ventaNumero).toBe(venta.numero);
    expect(ultima!.motivo).toBe('Vino fallado de fábrica');
    expect(ultima!.unidades).toBe(1);
    expect(ultima!.detalle).toContain('Vidrio');

    const delTurno = await devolucionesDelTurno(db, turnoDeHoy.id);
    expect(delTurno).toHaveLength(1);
  });

  /*
   * El driver de producción devuelve `timestamptz` como texto desde una
   * consulta escrita a mano, y PGlite —el de estos tests— como `Date`. Sin
   * convertir, la pantalla explotaba con «Invalid time value» y la suite no lo
   * veía. Formatear la fecha acá ata las dos puntas.
   */
  it('la fecha que sale se puede formatear, venga como venga del driver', async () => {
    const { venta, turnoDeHoy } = await ventaDeUnTurnoCerrado();
    const d = (await loDevolvible(db, venta.id))!;

    await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
      motivo: 'Fallado',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    const [ultima] = await devolucionesRecientes(db);
    expect(ultima!.fecha).toBeInstanceOf(Date);
    expect(() => formatearFechaHora(ultima!.fecha)).not.toThrow();
    expect(formatearFechaHora(ultima!.fecha)).toMatch(/^\d{2}\/\d{2}\/\d{4}/);
  });

  it('las de otro turno no figuran en el del turno', async () => {
    const { venta, turnoViejo, turnoDeHoy } = await ventaDeUnTurnoCerrado();
    const d = (await loDevolvible(db, venta.id))!;

    await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [{ saleItemId: d.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true }],
      motivo: 'Fallado',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: turnoDeHoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    expect(await devolucionesDelTurno(db, turnoViejo.id)).toHaveLength(0);
  });
});
