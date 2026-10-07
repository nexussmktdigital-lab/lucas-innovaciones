/**
 * Tests de la ficha de una venta.
 *
 * Lo que importa: que traiga lo que la lista y el comprobante no muestran —con
 * qué se pagó, en qué cuotas quedó, qué se devolvió después—, que las cuotas
 * sean las de **esta** venta y no las de la cuenta del cliente, y que diga bien
 * si el turno sigue abierto, que es lo que decide si la pantalla ofrece anular o
 * devolver (D29).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  customers,
  exchangeRates,
  monetaryAccounts,
  products,
  users,
} from '@/db/schema';
import { abrirCaja, cerrarCaja } from '@/caja/sesion';
import { confirmarVenta } from '@/ventas/confirmar';
import { anularVenta } from '@/ventas/anular';
import { registrarDevolucion, loDevolvible } from '@/ventas/devolver';
import { cadencia } from '@/fiado/plan';
import {
  detalleDeVenta,
  devueltoDeLaVenta,
  fiadoDeLaVenta,
  vueltoDeLaVenta,
  cuantasVentasTiene,
  type DetalleDeVenta,
} from './detalle';

/** El dólar del fixture: $1.400. */
const TC = 1_400_00;

let db: TestDb;
let duenio: string;
let caja: string;
let dolares: string;
let vidrio: string;
let iphone: string;
let cliente: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const [u] = await db.insert(users).values({ nombre: 'Lucas', rol: 'owner' }).returning();
  duenio = u!.id;

  const cuentas = await db
    .insert(monetaryAccounts)
    .values([
      { nombre: 'Caja en efectivo', tipo: 'efectivo' },
      { nombre: 'Caja en dólares', tipo: 'dolares' },
    ])
    .returning();
  caja = cuentas[0]!.id;
  dolares = cuentas[1]!.id;

  await db
    .insert(exchangeRates)
    .values({ valorCentavos: TC, vigenteDesde: new Date(), origen: 'manual' });

  const prods = await db
    .insert(products)
    .values([
      { nombre: 'Vidrio templado 9D', precioCentavos: 5_000_00, stock: 100 },
      {
        nombre: 'iPhone 14 Pro 256GB',
        moneda: 'USD',
        precioUsdCentavos: 1_370_00,
        precioCentavos: 1_918_000_00,
        stock: 3,
      },
    ])
    .returning();
  vidrio = prods[0]!.id;
  iphone = prods[1]!.id;

  const [c] = await db
    .insert(customers)
    .values({ nombre: 'Gaby Pereyra', dni: '31.456.789', telefono: '3574456139' })
    .returning();
  cliente = c!.id;
});

let n = 0;
function clave() {
  n += 1;
  return `det-${n}-${Math.random()}`;
}

function abrirTurno() {
  return abrirCaja(db, {
    terminal: 'T1',
    usuarioId: duenio,
    monetaryAccountId: caja,
    saldoInicialCentavos: 100_000_00,
  });
}

describe('la ficha de una venta de contado', () => {
  it('trae lo vendido, con qué se pagó y el vuelto', async () => {
    const turno = await abrirTurno();
    const venta = await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 2 }],
      // Pagó con un billete de $20.000 y le quedan $10.000 de vuelto.
      pagos: [{ medio: 'efectivo', montoCentavos: 20_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: turno.id,
      terminal: 'T1',
      idempotencyKey: clave(),
    });

    const d = (await detalleDeVenta(db, venta.id))!;

    expect(d.numero).toBe(venta.numero);
    expect(d.tipo).toBe('contado');
    expect(d.estado).toBe('completed');
    expect(d.totalCentavos).toBe(10_000_00);
    expect(d.terminal).toBe('T1');
    expect(d.vendedor).toBe('Lucas');
    expect(d.cliente).toBeNull();

    expect(d.renglones).toHaveLength(1);
    expect(d.renglones[0]).toMatchObject({
      descripcion: 'Vidrio templado 9D',
      cantidad: 2,
      precioUnitarioCentavos: 5_000_00,
      totalCentavos: 10_000_00,
      monedaOriginal: 'ARS',
    });

    expect(d.pagos).toEqual([
      {
        medio: 'efectivo',
        montoCentavos: 20_000_00,
        montoUsdCentavos: null,
        cotizacionCentavos: null,
        marcaTarjeta: null,
        cuotas: null,
      },
    ]);

    expect(vueltoDeLaVenta(d)).toBe(10_000_00);
    expect(fiadoDeLaVenta(d)).toBe(0);
    expect(devueltoDeLaVenta(d)).toBe(0);
    expect(d.cuotas).toEqual([]);
    expect(d.devoluciones).toEqual([]);
  });

  it('un producto en dólares deja las dos cifras y la cotización congelada', async () => {
    const turno = await abrirTurno();
    const venta = await confirmarVenta(db, {
      lineas: [{ productId: iphone, cantidad: 1 }],
      pagos: [
        {
          medio: 'dolares',
          montoCentavos: 1_918_000_00,
          montoUsdCentavos: 1_370_00,
          cotizacionCentavos: TC,
          monetaryAccountId: dolares,
        },
      ],
      vendedorId: duenio,
      cashSessionId: turno.id,
      terminal: 'T1',
      idempotencyKey: clave(),
    });

    const d = (await detalleDeVenta(db, venta.id))!;

    expect(d.renglones[0]!.monedaOriginal).toBe('USD');
    expect(d.renglones[0]!.precioUsdCentavos).toBe(1_370_00);
    expect(d.tcAplicadoCentavos).toBe(TC);
    // Los dólares que entraron son un hecho aparte de los pesos que valen.
    expect(d.pagos[0]!.montoUsdCentavos).toBe(1_370_00);
    expect(d.pagos[0]!.cotizacionCentavos).toBe(TC);
  });

  it('no inventa una venta que no existe', async () => {
    expect(await detalleDeVenta(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});

describe('la ficha de una venta fiada', () => {
  /** Dos vidrios: la mitad en efectivo y la otra mitad en tres cuotas. */
  async function ventaEnCuotas(turnoId: string) {
    return confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 2 }],
      pagos: [
        { medio: 'efectivo', montoCentavos: 5_000_00, monetaryAccountId: caja },
        { medio: 'cuenta_corriente', montoCentavos: 5_000_00 },
      ],
      clienteId: cliente,
      plan: { cadencia: cadencia('mensual'), cuotas: 3 },
      vendedorId: duenio,
      cashSessionId: turnoId,
      terminal: 'T1',
      idempotencyKey: clave(),
    });
  }

  it('dice quién compró, cuánto quedó fiado y en qué cuotas', async () => {
    const turno = await abrirTurno();
    const venta = await ventaEnCuotas(turno.id);

    const d = (await detalleDeVenta(db, venta.id))!;

    expect(d.tipo).toBe('fiado');
    expect(d.cliente).toBe('Gaby Pereyra');
    expect(d.clienteId).toBe(cliente);
    expect(d.documento).toBe('31.456.789');
    expect(d.telefono).toBe('3574456139');

    expect(fiadoDeLaVenta(d)).toBe(5_000_00);
    expect(d.monedaDelPlan).toBe('ARS');
    expect(d.cuotas).toHaveLength(3);
    expect(d.cuotas.map((c) => c.numero)).toEqual([1, 2, 3]);
    expect(d.cuotas.reduce((s, c) => s + c.montoCentavos, 0)).toBe(5_000_00);
    expect(d.cuotas[0]!.vencimiento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('las cuotas son las de esta venta, no las de la cuenta del cliente', async () => {
    /*
     * Quien compró dos veces tiene dos planes sobre la misma cuenta. Si la
     * consulta saliera de la cuenta y no de la venta, cada ficha mostraría las
     * seis cuotas y ninguna de las dos diría la verdad.
     */
    const turno = await abrirTurno();
    const primera = await ventaEnCuotas(turno.id);
    const segunda = await ventaEnCuotas(turno.id);

    const a = (await detalleDeVenta(db, primera.id))!;
    const b = (await detalleDeVenta(db, segunda.id))!;

    expect(a.cuotas).toHaveLength(3);
    expect(b.cuotas).toHaveLength(3);
    expect(await cuantasVentasTiene(db, cliente)).toBe(2);
  });

  it('lo que se vende en dólares se debe en dólares', async () => {
    const turno = await abrirTurno();
    const venta = await confirmarVenta(db, {
      lineas: [{ productId: iphone, cantidad: 1 }],
      pagos: [
        { medio: 'efectivo', montoCentavos: 918_000_00, monetaryAccountId: caja },
        { medio: 'cuenta_corriente', montoCentavos: 1_000_000_00 },
      ],
      clienteId: cliente,
      plan: { cadencia: cadencia('mensual'), cuotas: 2 },
      vendedorId: duenio,
      cashSessionId: turno.id,
      terminal: 'T1',
      idempotencyKey: clave(),
    });

    const d = (await detalleDeVenta(db, venta.id))!;

    // El plan está en dólares, así que sus cuotas se leen con el símbolo de
    // dólar y no con el de pesos: la pantalla elige el formato con esto.
    expect(d.monedaDelPlan).toBe('USD');
    expect(d.cuotas).toHaveLength(2);
    expect(d.cuotas.reduce((s, c) => s + c.montoCentavos, 0)).toBeLessThan(1_000_00);
  });

  it('las cuotas de un plan anulado no se muestran', async () => {
    const turno = await abrirTurno();
    const venta = await ventaEnCuotas(turno.id);

    await anularVenta(db, {
      ventaId: venta.id,
      usuarioId: duenio,
      motivo: 'Se cargó el modelo equivocado',
    });

    const d = (await detalleDeVenta(db, venta.id))!;

    expect(d.estado).toBe('cancelled');
    expect(d.motivoAnulacion).toBe('Se cargó el modelo equivocado');
    // La venta se dio de baja y sus cuotas con ella: mostrarlas haría creer
    // que el cliente todavía debe algo de esta compra.
    expect(d.cuotas).toEqual([]);
    expect(d.monedaDelPlan).toBeNull();
  });
});

describe('anular o devolver, según el turno', () => {
  it('con el turno abierto, la venta todavía se anula', async () => {
    const turno = await abrirTurno();
    const venta = await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 1 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 5_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: turno.id,
      terminal: 'T1',
      idempotencyKey: clave(),
    });

    const d = (await detalleDeVenta(db, venta.id))!;
    expect(d.cashSessionId).toBe(turno.id);
    expect(d.turnoAbierto).toBe(true);
    expect(d.turnoAbiertoEn).toBeInstanceOf(Date);
  });

  it('cerrado el turno, ya no: eso se devuelve', async () => {
    const turno = await abrirTurno();
    const venta = await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 1 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 5_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: turno.id,
      terminal: 'T1',
      idempotencyKey: clave(),
    });

    await cerrarCaja(db, {
      sesionId: turno.id,
      usuarioId: duenio,
      saldoContadoCentavos: 100_000_00 + 5_000_00,
    });

    const d = (await detalleDeVenta(db, venta.id))!;
    expect(d.turnoAbierto).toBe(false);
  });

  it('la devolución queda en la ficha, con su motivo y de dónde salió la plata', async () => {
    const viejo = await abrirTurno();
    const venta = await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 2 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 10_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: viejo.id,
      terminal: 'T1',
      idempotencyKey: clave(),
    });
    await cerrarCaja(db, {
      sesionId: viejo.id,
      usuarioId: duenio,
      saldoContadoCentavos: 100_000_00 + 10_000_00,
    });
    const hoy = await abrirTurno();

    const devolvible = (await loDevolvible(db, venta.id))!;
    await registrarDevolucion(db, {
      ventaId: venta.id,
      renglones: [
        { saleItemId: devolvible.lineas[0]!.saleItemId, cantidad: 1, vuelveAlStock: true },
      ],
      motivo: 'Vino fallado',
      usuarioId: duenio,
      terminal: 'T1',
      cashSessionId: hoy.id,
      medio: 'efectivo',
      monetaryAccountId: caja,
    });

    const d = (await detalleDeVenta(db, venta.id))!;

    // La venta sigue completa: devolver no la anula.
    expect(d.estado).toBe('completed');
    expect(d.devoluciones).toHaveLength(1);
    expect(d.devoluciones[0]).toMatchObject({
      motivo: 'Vino fallado',
      totalCentavos: 5_000_00,
      devueltoCentavos: 5_000_00,
      descontadoDeDeudaCentavos: 0,
    });
    expect(devueltoDeLaVenta(d)).toBe(5_000_00);
  });
});

describe('el vuelto, deducido de los pagos', () => {
  /*
   * Se deduce porque no se guarda. El cobro no deja pasar un excedente que no
   * se pueda devolver en efectivo, así que estos casos no llegan desde el
   * mostrador; se prueban igual porque la cuenta es la que decide qué dice la
   * pantalla y tiene que coincidir con la del carrito.
   */
  function detalle(pagos: DetalleDeVenta['pagos'], totalCentavos: number): DetalleDeVenta {
    return { totalCentavos, pagos } as DetalleDeVenta;
  }

  function pago(medio: string, montoCentavos: number) {
    return {
      medio,
      montoCentavos,
      montoUsdCentavos: null,
      cotizacionCentavos: null,
      marcaTarjeta: null,
      cuotas: null,
    };
  }

  it('es lo que sobró del efectivo', () => {
    expect(vueltoDeLaVenta(detalle([pago('efectivo', 20_000_00)], 10_000_00))).toBe(10_000_00);
  });

  it('nunca sale de una transferencia', () => {
    // Sobran $9.000 pero de efectivo solo entraron $1.000: de una
    // transferencia no se da vuelto.
    const d = detalle([pago('transferencia', 18_000_00), pago('efectivo', 1_000_00)], 10_000_00);
    expect(vueltoDeLaVenta(d)).toBe(1_000_00);
  });

  it('sin excedente no hay vuelto, aunque haya entrado efectivo', () => {
    expect(vueltoDeLaVenta(detalle([pago('efectivo', 10_000_00)], 10_000_00))).toBe(0);
  });

  it('una venta fiada a medias no tiene vuelto', () => {
    const d = detalle(
      [pago('efectivo', 5_000_00), pago('cuenta_corriente', 5_000_00)],
      10_000_00,
    );
    expect(vueltoDeLaVenta(d)).toBe(0);
    expect(fiadoDeLaVenta(d)).toBe(5_000_00);
  });
});
