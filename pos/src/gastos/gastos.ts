/**
 * Gastos: la plata que sale.
 *
 * Hasta acá el POS sabía todo lo que entraba y nada de lo que salía, así que el
 * arqueo cerraba de casualidad: el alquiler, el flete y lo que se le paga al
 * técnico salen del mismo cajón que las ventas, y si no se registran, el conteo
 * de la noche siempre da de menos y nadie sabe por qué.
 *
 * Tres decisiones que conviene tener presentes al leer:
 *
 *  - **Un gasto pagado mueve plata en la misma transaccion en que se registra.**
 *    Sale de una cuenta monetaria concreta y, si esa cuenta es la caja del
 *    turno, deja su asiento para que el arqueo lo vea. No hay gasto pagado sin
 *    cuenta: la restriccion `expenses_pagado_ck` lo impide en la base.
 *  - **Un gasto pendiente no mueve nada.** Es una factura que llego y todavia no
 *    se pago; existe para que se pueda ver lo que hay que pagar y para que no se
 *    pase de fecha. Al pagarlo recien ahi sale la plata.
 *  - **Anular es poner el asiento contrario, no borrar** (D29). El gasto queda
 *    con su motivo y la plata vuelve a la cuenta de donde salio.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  auditLog,
  cashMovements,
  expenseCategories,
  expenses,
  monetaryAccounts,
  payees,
} from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import type { MedioPago } from '@/ventas/carrito';

export class ErrorGasto extends Error {
  constructor(
    message: string,
    readonly motivo:
      | 'datos_invalidos'
      | 'sin_cuenta'
      | 'cuenta_inexistente'
      | 'no_existe'
      | 'ya_pagado'
      | 'ya_anulado' = 'datos_invalidos',
  ) {
    super(message);
    this.name = 'ErrorGasto';
  }
}

export type EstadoGasto = 'pagado' | 'pendiente' | 'anulado';

export interface DatosGasto {
  /** `YYYY-MM-DD` del calendario del local. */
  fecha: string;
  categoryId: string;
  payeeId?: string | null;
  descripcion: string;
  montoCentavos: number;
  estado: 'pagado' | 'pendiente';
  /** Obligatorios si el gasto entra pagado. */
  medio?: MedioPago | null;
  monetaryAccountId?: string | null;
  /** La caja del turno, cuando el gasto sale del cajón. */
  cashSessionId?: string | null;
  vencimiento?: string | null;
  comprobanteUrl?: string | null;
  usuarioId: string;
}

export interface GastoRegistrado {
  id: string;
  montoCentavos: number;
  estado: EstadoGasto;
  /** True si el gasto sacó plata de una cuenta en este mismo momento. */
  movioPlata: boolean;
}

const DESCRIPCION_MINIMA = 3;

function validar(datos: DatosGasto): void {
  if (!Number.isInteger(datos.montoCentavos) || datos.montoCentavos <= 0) {
    throw new ErrorGasto('El monto del gasto tiene que ser mayor a cero.');
  }
  if (datos.descripcion.trim().length < DESCRIPCION_MINIMA) {
    throw new ErrorGasto('Escribí en qué se gastó: dentro de un mes nadie se acuerda.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) {
    throw new ErrorGasto('La fecha del gasto no es válida.');
  }
  if (datos.estado === 'pagado' && (!datos.medio || !datos.monetaryAccountId)) {
    throw new ErrorGasto(
      'Un gasto pagado tiene que decir con qué se pagó y de qué cuenta salió.',
      'sin_cuenta',
    );
  }
}

/**
 * Saca la plata de una cuenta y deja el asiento.
 *
 * El signo lo pone quien llama: negativo cuando sale, positivo cuando vuelve.
 * La cuenta se toma con candado de fila para que dos gastos simultáneos no
 * dejen el saldo mal.
 */
async function moverCuenta(
  tx: BaseDatos,
  datos: {
    monetaryAccountId: string;
    cashSessionId?: string | null;
    montoCentavos: number;
    tipo: 'gasto' | 'anulacion' | 'retiro' | 'ingreso';
    referenciaId: string;
    referenciaTipo: string;
    usuarioId: string;
    descripcion: string;
  },
): Promise<void> {
  const [cuenta] = filasDe<{ id: string }>(
    await tx.execute(
      sql`SELECT id FROM monetary_accounts WHERE id = ${datos.monetaryAccountId} FOR UPDATE`,
    ),
  );
  if (!cuenta) throw new ErrorGasto('No se encuentra esa cuenta.', 'cuenta_inexistente');

  await tx.insert(cashMovements).values({
    monetaryAccountId: datos.monetaryAccountId,
    cashSessionId: datos.cashSessionId ?? null,
    tipo: datos.tipo,
    montoCentavos: datos.montoCentavos,
    referenciaTipo: datos.referenciaTipo,
    referenciaId: datos.referenciaId,
    usuarioId: datos.usuarioId,
    descripcion: datos.descripcion,
  });

  await tx
    .update(monetaryAccounts)
    .set({ saldoCentavos: sql`${monetaryAccounts.saldoCentavos} + ${datos.montoCentavos}` })
    .where(eq(monetaryAccounts.id, datos.monetaryAccountId));
}

export async function registrarGasto(
  db: BaseDatos,
  datos: DatosGasto,
): Promise<GastoRegistrado> {
  validar(datos);

  return db.transaction(async (tx) => {
    const [gasto] = await tx
      .insert(expenses)
      .values({
        fecha: datos.fecha,
        categoryId: datos.categoryId,
        payeeId: datos.payeeId ?? null,
        descripcion: datos.descripcion.trim(),
        montoCentavos: datos.montoCentavos,
        medio: datos.estado === 'pagado' ? (datos.medio as MedioPago) : null,
        monetaryAccountId: datos.estado === 'pagado' ? datos.monetaryAccountId : null,
        // La sesión de caja se guarda solo si el gasto salió del cajón: una
        // transferencia del banco no pertenece a ningún turno.
        cashSessionId: datos.estado === 'pagado' ? (datos.cashSessionId ?? null) : null,
        estado: datos.estado,
        vencimiento: datos.vencimiento ?? null,
        comprobanteUrl: datos.comprobanteUrl ?? null,
        cargadoPorId: datos.usuarioId,
        pagadoEn: datos.estado === 'pagado' ? new Date() : null,
      })
      .returning({ id: expenses.id });

    if (datos.estado === 'pagado') {
      await moverCuenta(tx, {
        monetaryAccountId: datos.monetaryAccountId!,
        cashSessionId: datos.cashSessionId ?? null,
        montoCentavos: -datos.montoCentavos,
        tipo: 'gasto',
        referenciaTipo: 'expenses',
        referenciaId: gasto!.id,
        usuarioId: datos.usuarioId,
        descripcion: datos.descripcion.trim(),
      });
    }

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'gasto.crear',
      entidad: 'expenses',
      entidadId: gasto!.id,
      valorNuevo: {
        descripcion: datos.descripcion.trim(),
        montoCentavos: datos.montoCentavos,
        estado: datos.estado,
        medio: datos.medio ?? null,
      },
    });

    return {
      id: gasto!.id,
      montoCentavos: datos.montoCentavos,
      estado: datos.estado,
      movioPlata: datos.estado === 'pagado',
    };
  });
}

/** Paga un gasto que estaba pendiente. Recién acá sale la plata. */
export async function pagarGasto(
  db: BaseDatos,
  datos: {
    gastoId: string;
    medio: MedioPago;
    monetaryAccountId: string;
    cashSessionId?: string | null;
    usuarioId: string;
  },
): Promise<GastoRegistrado> {
  return db.transaction(async (tx) => {
    /*
     * El gasto se toma con candado ANTES de mirar en qué estado está.
     *
     * Sin candado, dos pagos del mismo gasto al mismo tiempo —el dueño que
     * toca dos veces, o dos pantallas abiertas— leen los dos «pendiente», los
     * dos pasan el control de abajo y los dos sacan la plata: el gasto queda
     * pagado una vez y la cuenta pierde el doble. Se reprodujo contra
     * PostgreSQL de verdad, con dos conexiones, y salía siempre.
     *
     * El candado del saldo que pone `moverCuenta` no alcanza: ordena los dos
     * movimientos, no impide que se decidan dos veces.
     */
    const [gasto] = await tx
      .select()
      .from(expenses)
      .where(eq(expenses.id, datos.gastoId))
      .limit(1)
      .for('update');

    if (!gasto) throw new ErrorGasto('No se encuentra ese gasto.', 'no_existe');
    if (gasto.estado === 'pagado') {
      throw new ErrorGasto('Ese gasto ya figura como pagado.', 'ya_pagado');
    }
    if (gasto.estado === 'anulado') {
      throw new ErrorGasto('Ese gasto está anulado.', 'ya_anulado');
    }

    await tx
      .update(expenses)
      .set({
        estado: 'pagado',
        medio: datos.medio,
        monetaryAccountId: datos.monetaryAccountId,
        cashSessionId: datos.cashSessionId ?? null,
        pagadoEn: new Date(),
      })
      .where(eq(expenses.id, datos.gastoId));

    await moverCuenta(tx, {
      monetaryAccountId: datos.monetaryAccountId,
      cashSessionId: datos.cashSessionId ?? null,
      montoCentavos: -gasto.montoCentavos,
      tipo: 'gasto',
      referenciaTipo: 'expenses',
      referenciaId: gasto.id,
      usuarioId: datos.usuarioId,
      descripcion: gasto.descripcion,
    });

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'gasto.pagar',
      entidad: 'expenses',
      entidadId: gasto.id,
      valorAnterior: { estado: 'pendiente' },
      valorNuevo: { estado: 'pagado', medio: datos.medio },
    });

    return {
      id: gasto.id,
      montoCentavos: gasto.montoCentavos,
      estado: 'pagado',
      movioPlata: true,
    };
  });
}

const MOTIVO_MINIMO = 4;

/**
 * Anula un gasto. Si había movido plata, la plata vuelve.
 *
 * No se borra nada: el gasto queda anulado con su motivo y el asiento contrario
 * al lado del original, que es como se corrige un libro.
 */
export async function anularGasto(
  db: BaseDatos,
  datos: { gastoId: string; motivo: string; usuarioId: string; cashSessionId?: string | null },
): Promise<{ id: string; devueltoCentavos: number }> {
  const motivo = datos.motivo.trim();
  if (motivo.length < MOTIVO_MINIMO) {
    throw new ErrorGasto('Escribí por qué se anula el gasto.');
  }

  return db.transaction(async (tx) => {
    // Con candado, por lo mismo que en `pagarGasto`: dos anulaciones a la vez
    // devolvían la plata dos veces.
    const [gasto] = await tx
      .select()
      .from(expenses)
      .where(eq(expenses.id, datos.gastoId))
      .limit(1)
      .for('update');

    if (!gasto) throw new ErrorGasto('No se encuentra ese gasto.', 'no_existe');
    if (gasto.estado === 'anulado') {
      throw new ErrorGasto('Ese gasto ya está anulado.', 'ya_anulado');
    }

    let devueltoCentavos = 0;

    // Solo vuelve la plata que salió. Un gasto pendiente nunca la sacó.
    if (gasto.estado === 'pagado' && gasto.monetaryAccountId) {
      devueltoCentavos = gasto.montoCentavos;
      await moverCuenta(tx, {
        monetaryAccountId: gasto.monetaryAccountId,
        // El asiento contrario va al turno donde se anula, no al original: si
        // fuera al viejo, descuadraría un arqueo que ya se cerró (D29).
        cashSessionId: datos.cashSessionId ?? null,
        montoCentavos: gasto.montoCentavos,
        tipo: 'anulacion',
        referenciaTipo: 'expenses',
        referenciaId: gasto.id,
        usuarioId: datos.usuarioId,
        descripcion: `Anulación del gasto: ${gasto.descripcion}`,
      });
    }

    await tx
      .update(expenses)
      .set({ estado: 'anulado', motivoAnulacion: motivo })
      .where(eq(expenses.id, datos.gastoId));

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'gasto.anular',
      entidad: 'expenses',
      entidadId: gasto.id,
      valorAnterior: { estado: gasto.estado, montoCentavos: gasto.montoCentavos },
      valorNuevo: { estado: 'anulado', motivo, devueltoCentavos },
    });

    return { id: gasto.id, devueltoCentavos };
  });
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                  */
/* -------------------------------------------------------------------------- */

export interface GastoEnLista {
  id: string;
  fecha: string;
  categoria: string;
  beneficiario: string | null;
  descripcion: string;
  montoCentavos: number;
  estado: EstadoGasto;
  medio: string | null;
  cuenta: string | null;
  vencimiento: string | null;
  motivoAnulacion: string | null;
  cargadoPor: string | null;
}

interface FilaGasto {
  id: string;
  fecha: string;
  categoria: string;
  beneficiario: string | null;
  descripcion: string;
  monto_centavos: string | number;
  estado: EstadoGasto;
  medio: string | null;
  cuenta: string | null;
  vencimiento: string | null;
  motivo_anulacion: string | null;
  cargado_por: string | null;
}

function aGasto(f: FilaGasto): GastoEnLista {
  return {
    id: String(f.id),
    fecha: String(f.fecha),
    categoria: String(f.categoria),
    beneficiario: f.beneficiario,
    descripcion: String(f.descripcion),
    montoCentavos: Number(f.monto_centavos),
    estado: f.estado,
    medio: f.medio,
    cuenta: f.cuenta,
    vencimiento: f.vencimiento,
    motivoAnulacion: f.motivo_anulacion,
    cargadoPor: f.cargado_por,
  };
}

const SELECT_GASTO = sql`
  SELECT g.id, g.fecha, c.nombre AS categoria, p.nombre AS beneficiario,
         g.descripcion, g.monto_centavos, g.estado, g.medio::text AS medio,
         m.nombre AS cuenta, g.vencimiento, g.motivo_anulacion,
         u.nombre AS cargado_por
    FROM expenses g
    JOIN expense_categories c ON c.id = g.category_id
    LEFT JOIN payees p ON p.id = g.payee_id
    LEFT JOIN monetary_accounts m ON m.id = g.monetary_account_id
    LEFT JOIN users u ON u.id = g.cargado_por_id
`;

/** Los gastos de un mes (`YYYY-MM`), del más nuevo al más viejo. */
export async function gastosDelMes(
  db: BaseDatos,
  mes: string,
  filtros: { categoryId?: string | null; estado?: EstadoGasto | null } = {},
): Promise<GastoEnLista[]> {
  const condiciones = [sql`to_char(g.fecha, 'YYYY-MM') = ${mes}`];
  if (filtros.categoryId) condiciones.push(sql`g.category_id = ${filtros.categoryId}`);
  if (filtros.estado) condiciones.push(sql`g.estado = ${filtros.estado}`);

  const filas = filasDe<FilaGasto>(
    await db.execute(sql`
      ${SELECT_GASTO}
       WHERE ${sql.join(condiciones, sql` AND `)}
       ORDER BY g.fecha DESC, g.created_at DESC
    `),
  );
  return filas.map(aGasto);
}

export interface ResumenDeGastos {
  totalCentavos: number;
  cantidad: number;
  porCategoria: { categoria: string; cantidad: number; totalCentavos: number }[];
}

/**
 * Lo gastado en el mes, por categoría.
 *
 * Los anulados no cuentan: no son plata que salió.
 */
export async function resumenDelMes(db: BaseDatos, mes: string): Promise<ResumenDeGastos> {
  const filas = filasDe<{ categoria: string; cantidad: string | number; total: string | number }>(
    await db.execute(sql`
      SELECT c.nombre AS categoria, count(*) AS cantidad, SUM(g.monto_centavos) AS total
        FROM expenses g
        JOIN expense_categories c ON c.id = g.category_id
       WHERE to_char(g.fecha, 'YYYY-MM') = ${mes}
         AND g.estado <> 'anulado'
       GROUP BY c.nombre
       ORDER BY SUM(g.monto_centavos) DESC
    `),
  );

  const porCategoria = filas.map((f) => ({
    categoria: String(f.categoria),
    cantidad: Number(f.cantidad),
    totalCentavos: Number(f.total),
  }));

  return {
    totalCentavos: porCategoria.reduce((n, c) => n + c.totalCentavos, 0),
    cantidad: porCategoria.reduce((n, c) => n + c.cantidad, 0),
    porCategoria,
  };
}

/**
 * Lo que falta pagar, de lo que vence antes primero.
 *
 * Un gasto sin vencimiento va al final: está pendiente pero no corre.
 */
export async function gastosPendientes(db: BaseDatos): Promise<GastoEnLista[]> {
  const filas = filasDe<FilaGasto>(
    await db.execute(sql`
      ${SELECT_GASTO}
       WHERE g.estado = 'pendiente'
       ORDER BY g.vencimiento ASC NULLS LAST, g.fecha ASC
    `),
  );
  return filas.map(aGasto);
}

/** Cuánto falta pagar y cuánto de eso ya está vencido. */
export async function totalPendiente(
  db: BaseDatos,
  hoy: string,
): Promise<{ totalCentavos: number; cantidad: number; vencidos: number }> {
  const [r] = filasDe<{
    total: string | number;
    cantidad: string | number;
    vencidos: string | number;
  }>(
    await db.execute(sql`
      SELECT COALESCE(SUM(monto_centavos), 0) AS total,
             count(*) AS cantidad,
             count(*) FILTER (WHERE vencimiento IS NOT NULL AND vencimiento < ${hoy}) AS vencidos
        FROM expenses WHERE estado = 'pendiente'
    `),
  );

  return {
    totalCentavos: Number(r?.total ?? 0),
    cantidad: Number(r?.cantidad ?? 0),
    vencidos: Number(r?.vencidos ?? 0),
  };
}

/** Los gastos que salieron de la caja de este turno, para el arqueo. */
export async function gastosDelTurno(
  db: BaseDatos,
  cashSessionId: string,
): Promise<GastoEnLista[]> {
  const filas = filasDe<FilaGasto>(
    await db.execute(sql`
      ${SELECT_GASTO}
       WHERE g.cash_session_id = ${cashSessionId} AND g.estado = 'pagado'
       ORDER BY g.created_at DESC
    `),
  );
  return filas.map(aGasto);
}

/* -------------------------------------------------------------------------- */
/* Catalogos auxiliares                                                       */
/* -------------------------------------------------------------------------- */

export async function categorias(db: BaseDatos) {
  return db
    .select({ id: expenseCategories.id, nombre: expenseCategories.nombre })
    .from(expenseCategories)
    .where(eq(expenseCategories.activo, true))
    .orderBy(expenseCategories.orden, expenseCategories.nombre);
}

export async function beneficiarios(db: BaseDatos) {
  return db
    .select({ id: payees.id, nombre: payees.nombre, tipo: payees.tipo })
    .from(payees)
    .where(eq(payees.activo, true))
    .orderBy(payees.nombre);
}

/** Da de alta un beneficiario al vuelo, sin salir del formulario de gasto. */
export async function crearBeneficiario(
  db: BaseDatos,
  datos: { nombre: string; tipo?: 'proveedor' | 'tecnico' | 'comisionista' | 'empleado' | 'servicio' | 'otro' },
): Promise<{ id: string; nombre: string }> {
  const nombre = datos.nombre.trim();
  if (nombre.length < 2) throw new ErrorGasto('El nombre del beneficiario es muy corto.');

  const [existente] = await db
    .select({ id: payees.id, nombre: payees.nombre })
    .from(payees)
    .where(and(eq(payees.nombre, nombre), eq(payees.activo, true)))
    .limit(1);
  if (existente) return existente;

  const [fila] = await db
    .insert(payees)
    .values({ nombre, tipo: datos.tipo ?? 'otro' })
    .returning({ id: payees.id, nombre: payees.nombre });

  return fila!;
}

/** El último gasto cargado, para que la pantalla pueda mostrarlo recién guardado. */
export async function ultimoGasto(db: BaseDatos): Promise<GastoEnLista | null> {
  const filas = filasDe<FilaGasto>(
    await db.execute(sql`${SELECT_GASTO} ORDER BY g.created_at DESC LIMIT 1`),
  );
  return filas[0] ? aGasto(filas[0]) : null;
}
