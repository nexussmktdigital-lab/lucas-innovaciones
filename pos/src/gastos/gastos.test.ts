/**
 * Tests de gastos y cuentas monetarias.
 *
 * Contra PGlite con las migraciones reales: la restricción que impide un gasto
 * pagado sin cuenta y el candado de fila están puestos de verdad.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, rechazaCon, vaciar, type TestDb } from '@/db/test-db';
import {
  cashMovements,
  expenseCategories,
  expenses,
  monetaryAccounts,
  payees,
  users,
} from '@/db/schema';
import { abrirCaja, resumenDeSesion } from '@/caja/sesion';
import {
  anularGasto,
  crearBeneficiario,
  ErrorGasto,
  gastosDelMes,
  gastosDelTurno,
  gastosPendientes,
  pagarGasto,
  registrarGasto,
  resumenDelMes,
  totalPendiente,
} from './gastos';
import { cuentasConSaldo, descuadres, ErrorCuenta, extracto, transferir } from './cuentas';

let db: TestDb;
let duenio: string;
let caja: string;
let banco: string;
let sesion: string;
let alquiler: string;
let proveedores: string;

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
      { nombre: 'Banco', tipo: 'banco' },
    ])
    .returning();
  caja = cuentas[0]!.id;
  banco = cuentas[1]!.id;

  const cats = await db
    .insert(expenseCategories)
    .values([
      { nombre: 'Alquiler', orden: 0 },
      { nombre: 'Compra a proveedores', orden: 1 },
    ])
    .returning();
  alquiler = cats[0]!.id;
  proveedores = cats[1]!.id;

  const s = await abrirCaja(db, {
    terminal: 'T1',
    usuarioId: duenio,
    monetaryAccountId: caja,
    saldoInicialCentavos: 5_000_00,
  });
  sesion = s.id;
});

async function saldo(cuentaId: string): Promise<number> {
  const [c] = await db.select().from(monetaryAccounts).where(eq(monetaryAccounts.id, cuentaId));
  return c!.saldoCentavos;
}

function base() {
  return {
    fecha: '2026-09-15',
    categoryId: alquiler,
    descripcion: 'Alquiler de septiembre',
    montoCentavos: 300_000_00,
    usuarioId: duenio,
  };
}

/* ========================================================================== */

describe('registrar un gasto', () => {
  it('pagado en efectivo sale del cajón y lo ve el arqueo', async () => {
    const antes = await saldo(caja);

    const g = await registrarGasto(db, {
      ...base(),
      montoCentavos: 50_000_00,
      estado: 'pagado',
      medio: 'efectivo',
      monetaryAccountId: caja,
      cashSessionId: sesion,
    });

    expect(g.movioPlata).toBe(true);
    expect(await saldo(caja)).toBe(antes - 50_000_00);

    // Y el arqueo lo descuenta del efectivo esperado, que es el punto de todo,
    // y además lo muestra como salida para que el conteo se explique.
    const r = await resumenDeSesion(db, sesion);
    expect(r.efectivoEsperadoCentavos).toBe(5_000_00 - 50_000_00);
    expect(r.gastosCentavos).toBe(50_000_00);
    expect(r.retirosCentavos).toBe(0);
  });

  it('pagado por transferencia sale del banco y no toca la caja', async () => {
    const enCaja = await saldo(caja);

    await registrarGasto(db, {
      ...base(),
      estado: 'pagado',
      medio: 'transferencia',
      monetaryAccountId: banco,
    });

    expect(await saldo(caja)).toBe(enCaja);
    expect(await saldo(banco)).toBe(-300_000_00);

    // No pertenece a ningún turno: el turno es del cajón.
    expect(await gastosDelTurno(db, sesion)).toHaveLength(0);
  });

  it('pendiente no mueve un peso', async () => {
    const antes = await saldo(caja);

    const g = await registrarGasto(db, {
      ...base(),
      estado: 'pendiente',
      vencimiento: '2026-09-30',
    });

    expect(g.movioPlata).toBe(false);
    expect(await saldo(caja)).toBe(antes);
    expect(await db.select().from(cashMovements).where(eq(cashMovements.tipo, 'gasto'))).toHaveLength(
      0,
    );
  });

  it('un gasto pagado sin cuenta se rechaza antes de tocar la base', async () => {
    await expect(
      registrarGasto(db, { ...base(), estado: 'pagado', medio: 'efectivo' }),
    ).rejects.toBeInstanceOf(ErrorGasto);
  });

  it('y la base tampoco lo deja pasar por SQL directo', async () => {
    // La aplicación valida, pero la regla vive en la base.
    await rechazaCon(
      db.insert(expenses).values({
        fecha: '2026-09-15',
        categoryId: alquiler,
        descripcion: 'Por la ventana',
        montoCentavos: 1_000_00,
        estado: 'pagado',
        cargadoPorId: duenio,
      }),
      /expenses_pagado_ck/,
    );
  });

  it('el monto tiene que ser mayor a cero', async () => {
    await expect(
      registrarGasto(db, { ...base(), montoCentavos: 0, estado: 'pendiente' }),
    ).rejects.toBeInstanceOf(ErrorGasto);

    await expect(
      registrarGasto(db, { ...base(), montoCentavos: -1_000_00, estado: 'pendiente' }),
    ).rejects.toBeInstanceOf(ErrorGasto);
  });

  it('sin descripción no se guarda: dentro de un mes nadie se acuerda', async () => {
    await expect(
      registrarGasto(db, { ...base(), descripcion: 'x', estado: 'pendiente' }),
    ).rejects.toBeInstanceOf(ErrorGasto);
  });
});

describe('pagar un gasto pendiente', () => {
  it('recién ahí sale la plata', async () => {
    const g = await registrarGasto(db, { ...base(), estado: 'pendiente' });
    const antes = await saldo(banco);

    await pagarGasto(db, {
      gastoId: g.id,
      medio: 'transferencia',
      monetaryAccountId: banco,
      usuarioId: duenio,
    });

    expect(await saldo(banco)).toBe(antes - 300_000_00);
    expect(await gastosPendientes(db)).toHaveLength(0);
  });

  it('no se paga dos veces', async () => {
    const g = await registrarGasto(db, { ...base(), estado: 'pendiente' });
    await pagarGasto(db, {
      gastoId: g.id,
      medio: 'transferencia',
      monetaryAccountId: banco,
      usuarioId: duenio,
    });

    const antes = await saldo(banco);
    await expect(
      pagarGasto(db, {
        gastoId: g.id,
        medio: 'transferencia',
        monetaryAccountId: banco,
        usuarioId: duenio,
      }),
    ).rejects.toBeInstanceOf(ErrorGasto);

    expect(await saldo(banco)).toBe(antes);
  });
});

describe('anular un gasto', () => {
  it('la plata vuelve a la cuenta de donde salió', async () => {
    const antes = await saldo(caja);
    const g = await registrarGasto(db, {
      ...base(),
      montoCentavos: 50_000_00,
      estado: 'pagado',
      medio: 'efectivo',
      monetaryAccountId: caja,
      cashSessionId: sesion,
    });
    expect(await saldo(caja)).toBe(antes - 50_000_00);

    const r = await anularGasto(db, {
      gastoId: g.id,
      motivo: 'Cargado dos veces',
      usuarioId: duenio,
      cashSessionId: sesion,
    });

    expect(r.devueltoCentavos).toBe(50_000_00);
    expect(await saldo(caja)).toBe(antes);

    // Y el arqueo deja de contarlo como salida: la plata sigue en el cajón, así
    // que decir «salieron $50.000» sería mentir sobre un cajón que está lleno.
    const arqueo = await resumenDeSesion(db, sesion);
    expect(arqueo.gastosCentavos).toBe(0);
    expect(arqueo.efectivoEsperadoCentavos).toBe(antes);
  });

  it('anular uno pendiente no devuelve nada, porque nada salió', async () => {
    const g = await registrarGasto(db, { ...base(), estado: 'pendiente' });
    const r = await anularGasto(db, { gastoId: g.id, motivo: 'No era nuestro', usuarioId: duenio });

    expect(r.devueltoCentavos).toBe(0);
    expect(await gastosPendientes(db)).toHaveLength(0);
  });

  it('no se anula dos veces ni se duplica la devolución', async () => {
    const g = await registrarGasto(db, {
      ...base(),
      estado: 'pagado',
      medio: 'transferencia',
      monetaryAccountId: banco,
    });
    await anularGasto(db, { gastoId: g.id, motivo: 'Mal cargado', usuarioId: duenio });
    const despues = await saldo(banco);

    await expect(
      anularGasto(db, { gastoId: g.id, motivo: 'Otra vez', usuarioId: duenio }),
    ).rejects.toBeInstanceOf(ErrorGasto);

    expect(await saldo(banco)).toBe(despues);
  });

  it('el gasto no se borra: queda anulado y con el motivo', async () => {
    const g = await registrarGasto(db, { ...base(), estado: 'pendiente' });
    await anularGasto(db, { gastoId: g.id, motivo: 'Llegó duplicada', usuarioId: duenio });

    const [fila] = await db.select().from(expenses).where(eq(expenses.id, g.id));
    expect(fila!.estado).toBe('anulado');
    expect(fila!.motivoAnulacion).toBe('Llegó duplicada');
  });

  it('sin motivo no se anula', async () => {
    const g = await registrarGasto(db, { ...base(), estado: 'pendiente' });
    await expect(
      anularGasto(db, { gastoId: g.id, motivo: 'x', usuarioId: duenio }),
    ).rejects.toBeInstanceOf(ErrorGasto);
  });
});

describe('consultas', () => {
  beforeEach(async () => {
    await registrarGasto(db, {
      ...base(),
      estado: 'pagado',
      medio: 'transferencia',
      monetaryAccountId: banco,
    });
    await registrarGasto(db, {
      ...base(),
      categoryId: proveedores,
      descripcion: 'Fundas y vidrios',
      montoCentavos: 120_000_00,
      estado: 'pagado',
      medio: 'efectivo',
      monetaryAccountId: caja,
      cashSessionId: sesion,
    });
    await registrarGasto(db, {
      ...base(),
      categoryId: proveedores,
      descripcion: 'Cargadores',
      montoCentavos: 80_000_00,
      estado: 'pendiente',
      vencimiento: '2026-09-20',
    });
  });

  it('el resumen del mes agrupa por categoría, de mayor a menor', async () => {
    const r = await resumenDelMes(db, '2026-09');

    expect(r.cantidad).toBe(3);
    expect(r.totalCentavos).toBe(500_000_00);
    expect(r.porCategoria[0]).toEqual({
      categoria: 'Alquiler',
      cantidad: 1,
      totalCentavos: 300_000_00,
    });
    expect(r.porCategoria[1]?.categoria).toBe('Compra a proveedores');
  });

  it('un gasto anulado deja de contar en el resumen', async () => {
    const [uno] = await gastosDelMes(db, '2026-09', { categoryId: alquiler });
    await anularGasto(db, { gastoId: uno!.id, motivo: 'Duplicado', usuarioId: duenio });

    const r = await resumenDelMes(db, '2026-09');
    expect(r.totalCentavos).toBe(200_000_00);
    expect(r.porCategoria.map((c) => c.categoria)).not.toContain('Alquiler');
  });

  it('se puede filtrar por categoría y por estado', async () => {
    expect(await gastosDelMes(db, '2026-09', { categoryId: proveedores })).toHaveLength(2);
    expect(await gastosDelMes(db, '2026-09', { estado: 'pendiente' })).toHaveLength(1);
  });

  it('otro mes no trae nada', async () => {
    expect(await gastosDelMes(db, '2026-08')).toHaveLength(0);
  });

  it('lo pendiente se cuenta aparte y avisa lo vencido', async () => {
    expect(await totalPendiente(db, '2026-09-15')).toEqual({
      totalCentavos: 80_000_00,
      cantidad: 1,
      vencidos: 0,
    });

    // Pasado el vencimiento, el mismo gasto figura vencido.
    expect((await totalPendiente(db, '2026-09-25')).vencidos).toBe(1);
  });

  it('el turno solo ve lo que salió de su cajón', async () => {
    const delTurno = await gastosDelTurno(db, sesion);
    expect(delTurno).toHaveLength(1);
    expect(delTurno[0]!.descripcion).toBe('Fundas y vidrios');
  });

  it('la lista trae el nombre de la categoría y de quién lo cargó', async () => {
    const [g] = await gastosDelMes(db, '2026-09', { categoryId: alquiler });
    expect(g!.categoria).toBe('Alquiler');
    expect(g!.cargadoPor).toBe('Lucas');
    expect(g!.cuenta).toBe('Banco');
  });
});

describe('beneficiarios', () => {
  it('se dan de alta al vuelo y no se duplican', async () => {
    const a = await crearBeneficiario(db, { nombre: 'Distribuidora Sur', tipo: 'proveedor' });
    const b = await crearBeneficiario(db, { nombre: '  Distribuidora Sur  ' });

    expect(b.id).toBe(a.id);
    expect(await db.select().from(payees)).toHaveLength(1);
  });

  it('el gasto guarda a quién se le pagó', async () => {
    const p = await crearBeneficiario(db, { nombre: 'Técnico Pablo', tipo: 'tecnico' });
    await registrarGasto(db, { ...base(), payeeId: p.id, estado: 'pendiente' });

    const [g] = await gastosDelMes(db, '2026-09');
    expect(g!.beneficiario).toBe('Técnico Pablo');
  });
});

/* ========================================================================== */
/* Cuentas monetarias                                                         */
/* ========================================================================== */

describe('cuentas monetarias', () => {
  it('el saldo de cada cuenta sale de sus movimientos', async () => {
    await registrarGasto(db, {
      ...base(),
      montoCentavos: 1_000_00,
      estado: 'pagado',
      medio: 'efectivo',
      monetaryAccountId: caja,
      cashSessionId: sesion,
    });

    const cuentas = await cuentasConSaldo(db);
    const efectivo = cuentas.find((c) => c.tipo === 'efectivo')!;

    expect(efectivo.saldoCentavos).toBe(5_000_00 - 1_000_00);
    expect(efectivo.movimientos).toBe(2); // apertura y gasto
    expect(await descuadres(db)).toEqual([]);
  });

  it('el efectivo va primero, que es lo que se cuenta todos los días', async () => {
    expect((await cuentasConSaldo(db))[0]?.tipo).toBe('efectivo');
  });
});

describe('transferir entre cuentas', () => {
  it('la plata cambia de lugar y el total del negocio no se mueve', async () => {
    const totalAntes = (await cuentasConSaldo(db)).reduce((n, c) => n + c.saldoCentavos, 0);

    await transferir(db, {
      origenId: caja,
      destinoId: banco,
      montoCentavos: 3_000_00,
      usuarioId: duenio,
      nota: 'Depósito de la recaudación',
      cashSessionId: sesion,
    });

    expect(await saldo(caja)).toBe(2_000_00);
    expect(await saldo(banco)).toBe(3_000_00);

    const totalDespues = (await cuentasConSaldo(db)).reduce((n, c) => n + c.saldoCentavos, 0);
    expect(totalDespues).toBe(totalAntes);
    expect(await descuadres(db)).toEqual([]);
  });

  it('la salida la ve el arqueo del turno; la entrada al banco, no', async () => {
    await transferir(db, {
      origenId: caja,
      destinoId: banco,
      montoCentavos: 3_000_00,
      usuarioId: duenio,
      cashSessionId: sesion,
    });

    // En el cajón quedan $2.000 y eso es lo que hay que contar. El depósito
    // figura como retiro y no como gasto: la plata no se gastó, se mudó.
    const r = await resumenDeSesion(db, sesion);
    expect(r.efectivoEsperadoCentavos).toBe(2_000_00);
    expect(r.retirosCentavos).toBe(3_000_00);
    expect(r.gastosCentavos).toBe(0);
  });

  it('no se transfiere más de lo que hay', async () => {
    await expect(
      transferir(db, {
        origenId: caja,
        destinoId: banco,
        montoCentavos: 9_999_00,
        usuarioId: duenio,
      }),
    ).rejects.toBeInstanceOf(ErrorCuenta);

    expect(await saldo(caja)).toBe(5_000_00);
    expect(await saldo(banco)).toBe(0);
  });

  it('no se transfiere a la misma cuenta ni por cero', async () => {
    await expect(
      transferir(db, { origenId: caja, destinoId: caja, montoCentavos: 100, usuarioId: duenio }),
    ).rejects.toBeInstanceOf(ErrorCuenta);

    await expect(
      transferir(db, { origenId: caja, destinoId: banco, montoCentavos: 0, usuarioId: duenio }),
    ).rejects.toBeInstanceOf(ErrorCuenta);
  });

  it('dos transferencias cruzadas a la vez no dejan el saldo mal', async () => {
    // El banco arranca en cero, así que primero se le pasa algo para poder
    // cruzar dos transferencias en sentidos opuestos.
    await transferir(db, {
      origenId: caja,
      destinoId: banco,
      montoCentavos: 2_000_00,
      usuarioId: duenio,
    });

    await Promise.allSettled([
      transferir(db, {
        origenId: caja,
        destinoId: banco,
        montoCentavos: 1_000_00,
        usuarioId: duenio,
      }),
      transferir(db, {
        origenId: banco,
        destinoId: caja,
        montoCentavos: 1_000_00,
        usuarioId: duenio,
      }),
    ]);

    // Pase lo que pase con el orden, el total se conserva y no hay descuadres.
    expect((await saldo(caja)) + (await saldo(banco))).toBe(5_000_00);
    expect(await descuadres(db)).toEqual([]);
  });
});

describe('extracto de una cuenta', () => {
  it('cada renglón muestra el saldo que quedaba después de él', async () => {
    await registrarGasto(db, {
      ...base(),
      montoCentavos: 1_000_00,
      estado: 'pagado',
      medio: 'efectivo',
      monetaryAccountId: caja,
      cashSessionId: sesion,
    });

    const filas = await extracto(db, caja);

    // El más nuevo primero: el gasto, con el saldo de hoy.
    expect(filas[0]!.montoCentavos).toBe(-1_000_00);
    expect(filas[0]!.saldoCentavos).toBe(4_000_00);

    // Y antes de ese gasto había $5.000, los de la apertura.
    expect(filas[1]!.tipo).toBe('apertura');
    expect(filas[1]!.saldoCentavos).toBe(5_000_00);
  });
});
