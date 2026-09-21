/**
 * Cuenta corriente: el fiado del mostrador.
 *
 * Hoy el fiado vive en una libreta de papel y en las lineas de venta del POS
 * viejo, cargado como si fuera un producto. Eso es la mitad del 58% de
 * facturacion sin producto real (D24). Aca pasa a ser lo que es: un saldo por
 * cliente, con su historia.
 *
 * El modelo es una **cuenta corriente de saldo**, no un plan de cuotas: el
 * cliente debe una cifra, se le fia y esa cifra sube, paga y baja. Es como
 * funciona la libreta y es lo que el negocio necesita primero. Las tablas de
 * planes y cuotas existen en el esquema para cuando haga falta financiar una
 * compra grande en cuotas fijas; esta fase no las usa.
 *
 * Reglas que se cumplen en la transaccion, no por disciplina:
 *
 *  - **El saldo nunca queda negativo.** Un cobro de mas que la deuda se rechaza:
 *    si el cliente pago de mas, eso es un vuelto, no un saldo a favor.
 *  - **La cuenta se toma con candado de fila.** Dos cobros simultaneos no pueden
 *    dejar el saldo mal.
 *  - **El limite se comprueba antes de fiar**, con la deuda que hay en ese
 *    momento, no con la que habia cuando se abrio la pantalla.
 *  - **Los cobros son inmutables** (disparador de 0001) y llevan clave de
 *    idempotencia: reintentar no cobra dos veces.
 */
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import {
  auditLog,
  cashMovements,
  creditAccounts,
  creditPayments,
  customers,
  monetaryAccounts,
  sales,
} from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import { imputarPago } from './plan';
import type { MedioPago } from '@/ventas/carrito';
import { tipoDeCuentaPara } from '@/ventas/confirmar';

export class ErrorFiado extends Error {
  constructor(
    message: string,
    readonly motivo:
      | 'sin_cliente'
      | 'sin_cuenta'
      | 'supera_limite'
      | 'monto_invalido'
      | 'sin_deuda'
      | 'sin_caja',
  ) {
    super(message);
    this.name = 'ErrorFiado';
  }
}

export interface CuentaCorriente {
  id: string;
  customerId: string;
  saldoCentavos: number;
  limiteCentavos: number | null;
  origen: 'sistema' | 'migrado_papel';
}

/** La cuenta de un cliente, o null si nunca se le fio. */
export async function cuentaDe(db: BaseDatos, customerId: string): Promise<CuentaCorriente | null> {
  const [c] = await db
    .select({
      id: creditAccounts.id,
      customerId: creditAccounts.customerId,
      saldoCentavos: creditAccounts.saldoCentavos,
      limiteCentavos: creditAccounts.limiteCentavos,
      origen: creditAccounts.origen,
    })
    .from(creditAccounts)
    .where(eq(creditAccounts.customerId, customerId))
    .limit(1);

  return c ?? null;
}

/**
 * Devuelve la cuenta del cliente, creandola si es la primera vez, con la fila
 * ya bloqueada para que el saldo no se pise entre operaciones simultaneas.
 */
async function cuentaBloqueada(
  tx: BaseDatos,
  customerId: string,
  origen: 'sistema' | 'migrado_papel' = 'sistema',
): Promise<CuentaCorriente> {
  await tx
    .insert(creditAccounts)
    .values({ customerId, origen })
    .onConflictDoNothing({ target: creditAccounts.customerId });

  const [c] = filasDe<{
    id: string;
    customer_id: string;
    saldo_centavos: string | number;
    limite_centavos: string | number | null;
    origen: 'sistema' | 'migrado_papel';
  }>(
    await tx.execute(sql`
      SELECT id, customer_id, saldo_centavos, limite_centavos, origen
        FROM credit_accounts WHERE customer_id = ${customerId} FOR UPDATE
    `),
  );

  if (!c) throw new ErrorFiado('No se pudo abrir la cuenta corriente.', 'sin_cuenta');

  return {
    id: String(c.id),
    customerId: String(c.customer_id),
    saldoCentavos: Number(c.saldo_centavos),
    limiteCentavos: c.limite_centavos === null ? null : Number(c.limite_centavos),
    origen: c.origen,
  };
}

/**
 * Suma una deuda a la cuenta del cliente. Se llama DENTRO de la transaccion de
 * la venta: si la venta no entra, la deuda tampoco.
 */
export async function anotarDeuda(
  tx: BaseDatos,
  datos: {
    customerId: string;
    montoCentavos: number;
    saleId: string;
    numero: string;
    usuarioId: string;
  },
): Promise<{ saldoCentavos: number; cuentaId: string }> {
  if (datos.montoCentavos <= 0) {
    throw new ErrorFiado('Una deuda tiene que ser mayor a cero.', 'monto_invalido');
  }

  const cuenta = await cuentaBloqueada(tx, datos.customerId);
  const saldoCentavos = cuenta.saldoCentavos + datos.montoCentavos;

  // El limite se mira contra la deuda de este instante, no contra la que habia
  // cuando el cajero abrio la pantalla.
  if (cuenta.limiteCentavos !== null && saldoCentavos > cuenta.limiteCentavos) {
    const [cliente] = await tx
      .select({ nombre: customers.nombre })
      .from(customers)
      .where(eq(customers.id, datos.customerId))
      .limit(1);

    throw new ErrorFiado(
      `${cliente?.nombre ?? 'El cliente'} ya debe $${(cuenta.saldoCentavos / 100).toLocaleString('es-AR')} ` +
        `y su límite es $${(cuenta.limiteCentavos / 100).toLocaleString('es-AR')}. ` +
        'Cobrale algo antes de fiarle de nuevo, o subile el límite.',
      'supera_limite',
    );
  }

  await tx
    .update(creditAccounts)
    .set({ saldoCentavos, updatedAt: new Date() })
    .where(eq(creditAccounts.id, cuenta.id));

  await tx.insert(auditLog).values({
    usuarioId: datos.usuarioId,
    accion: 'fiado.anotar',
    entidad: 'credit_accounts',
    entidadId: cuenta.id,
    valorAnterior: { saldoCentavos: cuenta.saldoCentavos },
    valorNuevo: {
      saldoCentavos,
      montoCentavos: datos.montoCentavos,
      venta: datos.numero,
      saleId: datos.saleId,
    },
  });

  return { saldoCentavos, cuentaId: cuenta.id };
}

export interface DatosCobro {
  customerId: string;
  montoCentavos: number;
  medio: MedioPago;
  monetaryAccountId?: string | null;
  cashSessionId: string;
  usuarioId: string;
  idempotencyKey: string;
  nota?: string | null;
}

export interface CobroRegistrado {
  id: string;
  montoCentavos: number;
  saldoAnteriorCentavos: number;
  saldoCentavos: number;
  yaExistia: boolean;
}

/**
 * Cobra a cuenta de la deuda. La plata entra a la caja del turno.
 */
export async function cobrarFiado(db: BaseDatos, datos: DatosCobro): Promise<CobroRegistrado> {
  if (!Number.isInteger(datos.montoCentavos) || datos.montoCentavos <= 0) {
    throw new ErrorFiado('El monto a cobrar tiene que ser mayor a cero.', 'monto_invalido');
  }
  if (datos.medio === 'cuenta_corriente') {
    throw new ErrorFiado('Una deuda no se paga con más deuda.', 'monto_invalido');
  }

  return db.transaction(async (tx) => {
    // Idempotencia primero: reintentar no cobra dos veces.
    const [existente] = await tx
      .select()
      .from(creditPayments)
      .where(eq(creditPayments.idempotencyKey, datos.idempotencyKey))
      .limit(1);

    if (existente) {
      return {
        id: existente.id,
        montoCentavos: existente.montoCentavos,
        saldoAnteriorCentavos: existente.saldoResultanteCentavos + existente.montoCentavos,
        saldoCentavos: existente.saldoResultanteCentavos,
        yaExistia: true,
      };
    }

    const cuenta = await cuentaBloqueada(tx, datos.customerId);

    if (cuenta.saldoCentavos <= 0) {
      throw new ErrorFiado('Ese cliente no debe nada.', 'sin_deuda');
    }
    if (datos.montoCentavos > cuenta.saldoCentavos) {
      throw new ErrorFiado(
        `Está pagando más de lo que debe: la deuda es $${(cuenta.saldoCentavos / 100).toLocaleString('es-AR')}. ` +
          'Cobrale la deuda y el resto devolveselo: un saldo a favor no se lleva acá.',
        'monto_invalido',
      );
    }

    const saldoCentavos = cuenta.saldoCentavos - datos.montoCentavos;

    await tx
      .update(creditAccounts)
      // `estado` (al dia / vencido) queda para cuando haya vencimientos: hoy la
      // cuenta es un saldo corriente y no hay contra que compararlo.
      .set({ saldoCentavos, updatedAt: new Date() })
      .where(eq(creditAccounts.id, cuenta.id));

    const [cobro] = await tx
      .insert(creditPayments)
      .values({
        creditAccountId: cuenta.id,
        montoCentavos: datos.montoCentavos,
        medio: datos.medio,
        monetaryAccountId: datos.monetaryAccountId ?? null,
        cashSessionId: datos.cashSessionId,
        cobradoPorId: datos.usuarioId,
        saldoResultanteCentavos: saldoCentavos,
        nota: datos.nota ?? null,
        idempotencyKey: datos.idempotencyKey,
      })
      .returning({ id: creditPayments.id });

    /*
     * Lo cobrado se imputa a las cuotas, de la más vieja a la más nueva.
     *
     * Sin esto el semáforo de la pantalla de Fiado mentiría: un cliente que
     * pagó todo seguiría figurando en rojo porque su cuota vencida nunca se
     * habría marcado. Si no tiene plan no hace nada, que es el caso de siempre.
     */
    await imputarPago(tx, {
      creditAccountId: cuenta.id,
      creditPaymentId: cobro!.id,
      montoCentavos: datos.montoCentavos,
    });

    // A la caja entra plata de verdad: es lo que hace que el arqueo cierre.
    const tipoCuenta = tipoDeCuentaPara(datos.medio);
    if (tipoCuenta) {
      const cuentaId = datos.monetaryAccountId ?? (await cuentaPorTipo(tx, tipoCuenta));
      if (cuentaId) {
        await tx.insert(cashMovements).values({
          monetaryAccountId: cuentaId,
          cashSessionId: datos.cashSessionId,
          tipo: 'cobro_fiado',
          montoCentavos: datos.montoCentavos,
          referenciaTipo: 'credit_payment',
          referenciaId: cobro!.id,
          usuarioId: datos.usuarioId,
          descripcion: `Cobro de fiado${datos.nota ? `: ${datos.nota}` : ''}`,
        });

        await tx
          .update(monetaryAccounts)
          .set({ saldoCentavos: sql`${monetaryAccounts.saldoCentavos} + ${datos.montoCentavos}` })
          .where(eq(monetaryAccounts.id, cuentaId));
      }
    }

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'fiado.cobrar',
      entidad: 'credit_payments',
      entidadId: cobro!.id,
      valorAnterior: { saldoCentavos: cuenta.saldoCentavos },
      valorNuevo: { saldoCentavos, montoCentavos: datos.montoCentavos, medio: datos.medio },
    });

    return {
      id: cobro!.id,
      montoCentavos: datos.montoCentavos,
      saldoAnteriorCentavos: cuenta.saldoCentavos,
      saldoCentavos,
      yaExistia: false,
    };
  });
}

/**
 * Carga el saldo de una ficha de papel.
 *
 * No hay venta detras y no tiene que haberla: es lo que la libreta dice que el
 * cliente debe al dia que se migra. Queda marcado como `migrado_papel` para que
 * despues se pueda distinguir de lo que nacio en el sistema.
 */
export async function migrarFichaDePapel(
  db: BaseDatos,
  datos: {
    customerId: string;
    saldoCentavos: number;
    usuarioId: string;
    nota?: string | null;
  },
): Promise<CuentaCorriente> {
  if (!Number.isInteger(datos.saldoCentavos) || datos.saldoCentavos <= 0) {
    throw new ErrorFiado('El saldo de la ficha tiene que ser mayor a cero.', 'monto_invalido');
  }

  return db.transaction(async (tx) => {
    const cuenta = await cuentaBloqueada(tx, datos.customerId, 'migrado_papel');

    if (cuenta.saldoCentavos !== 0) {
      throw new ErrorFiado(
        'Ese cliente ya tiene saldo en el sistema. Cargá la ficha solo la primera vez, ' +
          'para no sumar dos veces la misma deuda.',
        'monto_invalido',
      );
    }

    await tx
      .update(creditAccounts)
      .set({ saldoCentavos: datos.saldoCentavos, origen: 'migrado_papel', updatedAt: new Date() })
      .where(eq(creditAccounts.id, cuenta.id));

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'fiado.migrar_papel',
      entidad: 'credit_accounts',
      entidadId: cuenta.id,
      valorNuevo: { saldoCentavos: datos.saldoCentavos, nota: datos.nota ?? null },
    });

    return { ...cuenta, saldoCentavos: datos.saldoCentavos, origen: 'migrado_papel' as const };
  });
}

/** Cambia el tope de fiado de un cliente. `null` es sin tope. */
export async function ponerLimite(
  db: BaseDatos,
  datos: { customerId: string; limiteCentavos: number | null; usuarioId: string },
): Promise<void> {
  if (
    datos.limiteCentavos !== null &&
    (!Number.isInteger(datos.limiteCentavos) || datos.limiteCentavos < 0)
  ) {
    throw new ErrorFiado('El límite no puede ser negativo.', 'monto_invalido');
  }

  await db.transaction(async (tx) => {
    const cuenta = await cuentaBloqueada(tx, datos.customerId);

    await tx
      .update(creditAccounts)
      .set({ limiteCentavos: datos.limiteCentavos, updatedAt: new Date() })
      .where(eq(creditAccounts.id, cuenta.id));

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'fiado.limite',
      entidad: 'credit_accounts',
      entidadId: cuenta.id,
      valorAnterior: { limiteCentavos: cuenta.limiteCentavos },
      valorNuevo: { limiteCentavos: datos.limiteCentavos },
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                  */
/* -------------------------------------------------------------------------- */

export interface DeudorEnLista {
  customerId: string;
  nombre: string;
  telefono: string | null;
  saldoCentavos: number;
  limiteCentavos: number | null;
  origen: 'sistema' | 'migrado_papel';
  /** Cuando se le fio o se le cobro por ultima vez. */
  ultimoMovimiento: Date | null;
}

/** Quien debe y cuanto, de mayor a menor. */
export async function deudores(db: BaseDatos): Promise<DeudorEnLista[]> {
  const filas = filasDe<{
    customer_id: string;
    nombre: string;
    telefono: string | null;
    saldo_centavos: string | number;
    limite_centavos: string | number | null;
    origen: 'sistema' | 'migrado_papel';
    ultimo: string | Date | null;
  }>(
    await db.execute(sql`
      SELECT c.id AS customer_id, c.nombre, c.telefono,
             a.saldo_centavos, a.limite_centavos, a.origen,
             GREATEST(
               COALESCE((SELECT max(s.fecha) FROM sales s
                          WHERE s.cliente_id = c.id AND s.tipo = 'fiado'
                            AND s.estado = 'completed'), a.created_at),
               COALESCE((SELECT max(p.fecha) FROM credit_payments p
                          WHERE p.credit_account_id = a.id), a.created_at)
             ) AS ultimo
        FROM credit_accounts a
        JOIN customers c ON c.id = a.customer_id
       WHERE a.saldo_centavos > 0
       ORDER BY a.saldo_centavos DESC
    `),
  );

  return filas.map((f) => ({
    customerId: String(f.customer_id),
    nombre: String(f.nombre),
    telefono: f.telefono,
    saldoCentavos: Number(f.saldo_centavos),
    limiteCentavos: f.limite_centavos === null ? null : Number(f.limite_centavos),
    origen: f.origen,
    ultimoMovimiento: f.ultimo ? new Date(f.ultimo) : null,
  }));
}

export async function totalFiado(
  db: BaseDatos,
): Promise<{ totalCentavos: number; clientes: number }> {
  const [r] = await db
    .select({
      totalCentavos: sql<number>`COALESCE(SUM(${creditAccounts.saldoCentavos}), 0)`.mapWith(Number),
      clientes: sql<number>`count(*)`.mapWith(Number),
    })
    .from(creditAccounts)
    .where(gt(creditAccounts.saldoCentavos, 0));

  return { totalCentavos: r?.totalCentavos ?? 0, clientes: r?.clientes ?? 0 };
}

export type MovimientoDeCuenta =
  | {
      tipo: 'venta';
      fecha: Date;
      montoCentavos: number;
      descripcion: string;
      ventaId: string;
      anulada: boolean;
    }
  | {
      tipo: 'cobro';
      fecha: Date;
      montoCentavos: number;
      descripcion: string;
      saldoResultanteCentavos: number;
    };

/** La historia de la cuenta: lo que se fio y lo que se cobro, junto. */
export async function movimientosDe(
  db: BaseDatos,
  customerId: string,
): Promise<MovimientoDeCuenta[]> {
  const cuenta = await cuentaDe(db, customerId);

  const ventas = await db
    .select({
      id: sales.id,
      fecha: sales.fecha,
      numero: sales.numero,
      totalCentavos: sales.totalCentavos,
      estado: sales.estado,
    })
    .from(sales)
    .where(and(eq(sales.clienteId, customerId), eq(sales.tipo, 'fiado')))
    .orderBy(desc(sales.fecha));

  const cobros = cuenta
    ? await db
        .select()
        .from(creditPayments)
        .where(eq(creditPayments.creditAccountId, cuenta.id))
        .orderBy(desc(creditPayments.fecha))
    : [];

  const movimientos: MovimientoDeCuenta[] = [
    ...ventas.map(
      (v): MovimientoDeCuenta => ({
        tipo: 'venta',
        fecha: v.fecha,
        montoCentavos: v.totalCentavos,
        descripcion: `Venta ${v.numero}`,
        ventaId: v.id,
        anulada: v.estado === 'cancelled',
      }),
    ),
    ...cobros.map(
      (c): MovimientoDeCuenta => ({
        tipo: 'cobro',
        fecha: c.fecha,
        montoCentavos: c.montoCentavos,
        descripcion: c.nota ?? 'Cobro',
        saldoResultanteCentavos: c.saldoResultanteCentavos,
      }),
    ),
  ];

  return movimientos.sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
}

async function cuentaPorTipo(
  tx: BaseDatos,
  tipo: 'efectivo' | 'banco' | 'mercadopago',
): Promise<string | null> {
  const [cuenta] = await tx
    .select({ id: monetaryAccounts.id })
    .from(monetaryAccounts)
    .where(and(eq(monetaryAccounts.tipo, tipo), eq(monetaryAccounts.activo, true)))
    .limit(1);
  return cuenta?.id ?? null;
}
