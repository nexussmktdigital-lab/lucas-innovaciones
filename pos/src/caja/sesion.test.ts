import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  auditLog,
  cashSessions,
  exchangeRates,
  monetaryAccounts,
  products,
  users,
} from '@/db/schema';
import { confirmarVenta } from '@/ventas/confirmar';
import { abrirCaja, cerrarCaja, ErrorCaja, resumenDeSesion, sesionAbierta } from './sesion';

let db: TestDb;
let usuarioId: string;
let cajaId: string;
let bancoId: string;
let vidrioId: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const [u] = await db.insert(users).values({ nombre: 'Vendedor', rol: 'seller' }).returning();
  usuarioId = u!.id;

  const cuentas = await db
    .insert(monetaryAccounts)
    .values([
      { nombre: 'Caja en efectivo', tipo: 'efectivo' },
      { nombre: 'Banco', tipo: 'banco' },
    ])
    .returning();
  cajaId = cuentas[0]!.id;
  bancoId = cuentas[1]!.id;

  await db
    .insert(exchangeRates)
    .values({ valorCentavos: 156_100, vigenteDesde: new Date(), origen: 'infodolar' });

  const [p] = await db
    .insert(products)
    .values({ wooId: 6485, nombre: 'Vidrio templado 9D', precioCentavos: 500_000, stock: 100 })
    .returning();
  vidrioId = p!.id;
});

const apertura = () => ({
  terminal: 'T1',
  usuarioId,
  monetaryAccountId: cajaId,
  saldoInicialCentavos: 2_000_000, // $20.000 de cambio
});

describe('abrirCaja', () => {
  it('abre la sesión y deja el saldo inicial como asiento', async () => {
    const s = await abrirCaja(db, apertura());
    expect(s.terminal).toBe('T1');

    const [cuenta] = await db.select().from(monetaryAccounts).where(eq(monetaryAccounts.id, cajaId));
    expect(cuenta!.saldoCentavos).toBe(2_000_000);

    const bitacora = await db.select().from(auditLog);
    expect(bitacora[0]!.accion).toBe('caja.abrir');
  });

  it('no deja abrir dos veces la misma terminal', async () => {
    await abrirCaja(db, apertura());
    await expect(abrirCaja(db, apertura())).rejects.toThrow(/ya está abierta/);
  });

  it('deja abrir otra terminal en paralelo', async () => {
    await abrirCaja(db, apertura());
    const otra = await abrirCaja(db, { ...apertura(), terminal: 'T2' });
    expect(otra.terminal).toBe('T2');
  });

  it('rechaza un saldo inicial negativo', async () => {
    await expect(abrirCaja(db, { ...apertura(), saldoInicialCentavos: -1 })).rejects.toThrow(
      ErrorCaja,
    );
  });
});

describe('sesionAbierta', () => {
  it('devuelve null cuando no hay ninguna', async () => {
    expect(await sesionAbierta(db, 'T1')).toBeNull();
  });

  it('encuentra la abierta y deja de verla al cerrarla', async () => {
    const s = await abrirCaja(db, apertura());
    expect((await sesionAbierta(db, 'T1'))?.id).toBe(s.id);

    await cerrarCaja(db, { sesionId: s.id, usuarioId, saldoContadoCentavos: 2_000_000 });
    expect(await sesionAbierta(db, 'T1')).toBeNull();
  });
});

describe('resumenDeSesion', () => {
  it('cuenta ventas y separa por medio de pago', async () => {
    const s = await abrirCaja(db, apertura());

    await confirmarVenta(db, {
      lineas: [{ productId: vidrioId, cantidad: 2 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 1_000_000, monetaryAccountId: cajaId }],
      vendedorId: usuarioId,
      cashSessionId: s.id,
      terminal: 'T1',
      idempotencyKey: 'v1',
    });

    await confirmarVenta(db, {
      lineas: [{ productId: vidrioId, cantidad: 4 }],
      pagos: [
        { medio: 'efectivo', montoCentavos: 1_000_000, monetaryAccountId: cajaId },
        { medio: 'transferencia', montoCentavos: 1_000_000, monetaryAccountId: bancoId },
      ],
      vendedorId: usuarioId,
      cashSessionId: s.id,
      terminal: 'T1',
      idempotencyKey: 'v2',
    });

    const r = await resumenDeSesion(db, s.id);
    expect(r.cantidadDeVentas).toBe(2);
    expect(r.totalVendidoCentavos).toBe(3_000_000);

    // Apertura 20.000 + 10.000 + 10.000 en efectivo = 40.000
    expect(r.efectivoEsperadoCentavos).toBe(4_000_000);

    const efectivo = r.porMedio.find((m) => m.medio === 'efectivo')!;
    const transferencia = r.porMedio.find((m) => m.medio === 'transferencia')!;
    expect(efectivo.cantidad).toBe(2);
    expect(efectivo.totalCentavos).toBe(2_000_000);
    expect(transferencia.totalCentavos).toBe(1_000_000);
  });

  it('la transferencia no infla el efectivo esperado', async () => {
    const s = await abrirCaja(db, { ...apertura(), saldoInicialCentavos: 0 });

    await confirmarVenta(db, {
      lineas: [{ productId: vidrioId, cantidad: 2 }],
      pagos: [{ medio: 'transferencia', montoCentavos: 1_000_000, monetaryAccountId: bancoId }],
      vendedorId: usuarioId,
      cashSessionId: s.id,
      terminal: 'T1',
      idempotencyKey: 'v3',
    });

    expect((await resumenDeSesion(db, s.id)).efectivoEsperadoCentavos).toBe(0);
  });

  it('el vuelto no queda contado como efectivo en caja', async () => {
    const s = await abrirCaja(db, { ...apertura(), saldoInicialCentavos: 0 });

    // $10.000 de venta, paga con $20.000, vuelto $10.000.
    await confirmarVenta(db, {
      lineas: [{ productId: vidrioId, cantidad: 2 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 2_000_000, monetaryAccountId: cajaId }],
      vendedorId: usuarioId,
      cashSessionId: s.id,
      terminal: 'T1',
      idempotencyKey: 'v4',
    });

    expect((await resumenDeSesion(db, s.id)).efectivoEsperadoCentavos).toBe(1_000_000);
  });
});

describe('cerrarCaja', () => {
  it('cierra en cero cuando el conteo coincide', async () => {
    const s = await abrirCaja(db, apertura());
    await confirmarVenta(db, {
      lineas: [{ productId: vidrioId, cantidad: 2 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 1_000_000, monetaryAccountId: cajaId }],
      vendedorId: usuarioId,
      cashSessionId: s.id,
      terminal: 'T1',
      idempotencyKey: 'v5',
    });

    const cierre = await cerrarCaja(db, {
      sesionId: s.id,
      usuarioId,
      saldoContadoCentavos: 3_000_000,
    });

    expect(cierre.esperadoCentavos).toBe(3_000_000);
    expect(cierre.diferenciaCentavos).toBe(0);

    const [sesion] = await db.select().from(cashSessions).where(eq(cashSessions.id, s.id));
    expect(sesion!.cerradaEn).not.toBeNull();
    expect(sesion!.diferenciaCentavos).toBe(0);
  });

  it('exige explicar la diferencia', async () => {
    const s = await abrirCaja(db, apertura());
    await expect(
      cerrarCaja(db, { sesionId: s.id, usuarioId, saldoContadoCentavos: 1_950_000 }),
    ).rejects.toThrow(/Escribí a qué se debe/);

    // Y con la justificación sí cierra.
    const cierre = await cerrarCaja(db, {
      sesionId: s.id,
      usuarioId,
      saldoContadoCentavos: 1_950_000,
      justificacion: 'Faltaron $500 de vuelto mal dado',
    });
    expect(cierre.diferenciaCentavos).toBe(-50_000);
  });

  it('la diferencia ajusta el saldo de la cuenta y deja asiento', async () => {
    const s = await abrirCaja(db, apertura());
    await cerrarCaja(db, {
      sesionId: s.id,
      usuarioId,
      saldoContadoCentavos: 2_100_000,
      justificacion: 'Apareció un billete de $1.000 de más',
    });

    const [cuenta] = await db.select().from(monetaryAccounts).where(eq(monetaryAccounts.id, cajaId));
    expect(cuenta!.saldoCentavos).toBe(2_100_000);
  });

  it('no se cierra dos veces', async () => {
    const s = await abrirCaja(db, apertura());
    await cerrarCaja(db, { sesionId: s.id, usuarioId, saldoContadoCentavos: 2_000_000 });
    await expect(
      cerrarCaja(db, { sesionId: s.id, usuarioId, saldoContadoCentavos: 2_000_000 }),
    ).rejects.toThrow(/ya está cerrada/);
  });

  it('rechaza un conteo negativo', async () => {
    const s = await abrirCaja(db, apertura());
    await expect(
      cerrarCaja(db, { sesionId: s.id, usuarioId, saldoContadoCentavos: -1 }),
    ).rejects.toThrow(ErrorCaja);
  });
});
