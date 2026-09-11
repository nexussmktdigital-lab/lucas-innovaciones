/**
 * Sesion de caja.
 *
 * Una sesion por terminal y por turno. Todo lo que entra o sale de la caja
 * durante el turno cuelga de ella, y al cerrarla se compara lo que el sistema
 * espera contra lo que la persona contó.
 *
 * Nota de campo tomada de la auditoria: hoy las sesiones quedan abiertas dias
 * enteros y el efectivo declarado siempre figura en cero, o sea que en la
 * practica no hacen arqueo. Por eso el cierre pide el conteo pero no lo exige
 * perfecto: exige explicar la diferencia, que es lo que convierte el arqueo en
 * un habito util en vez de un tramite que se saltea.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  auditLog,
  cashMovements,
  cashSessions,
  monetaryAccounts,
  sales,
} from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';

export class ErrorCaja extends Error {}

export interface SesionAbierta {
  id: string;
  terminal: string;
  monetaryAccountId: string;
  abiertaPorId: string;
  abiertaEn: Date;
  saldoInicialCentavos: number;
}

export async function sesionAbierta(
  db: BaseDatos,
  terminal: string,
): Promise<SesionAbierta | null> {
  const [s] = await db
    .select({
      id: cashSessions.id,
      terminal: cashSessions.terminal,
      monetaryAccountId: cashSessions.monetaryAccountId,
      abiertaPorId: cashSessions.abiertaPorId,
      abiertaEn: cashSessions.abiertaEn,
      saldoInicialCentavos: cashSessions.saldoInicialCentavos,
    })
    .from(cashSessions)
    .where(and(eq(cashSessions.terminal, terminal), isNull(cashSessions.cerradaEn)))
    .limit(1);

  return s ?? null;
}

export interface DatosApertura {
  terminal: string;
  usuarioId: string;
  monetaryAccountId: string;
  saldoInicialCentavos: number;
  nota?: string | null;
}

export async function abrirCaja(db: BaseDatos, datos: DatosApertura): Promise<SesionAbierta> {
  if (datos.saldoInicialCentavos < 0) {
    throw new ErrorCaja('El saldo inicial no puede ser negativo.');
  }

  return db.transaction(async (tx) => {
    const yaAbierta = await sesionAbierta(tx, datos.terminal);
    if (yaAbierta) {
      throw new ErrorCaja(
        `La caja de ${datos.terminal} ya está abierta desde hace un rato. Cerrala antes de abrir otra.`,
      );
    }

    const [sesion] = await tx
      .insert(cashSessions)
      .values({
        monetaryAccountId: datos.monetaryAccountId,
        terminal: datos.terminal,
        abiertaPorId: datos.usuarioId,
        saldoInicialCentavos: datos.saldoInicialCentavos,
        nota: datos.nota ?? null,
      })
      .returning();

    // El saldo inicial queda como asiento, para que el libro de caja cierre.
    if (datos.saldoInicialCentavos > 0) {
      await tx.insert(cashMovements).values({
        monetaryAccountId: datos.monetaryAccountId,
        cashSessionId: sesion!.id,
        tipo: 'apertura',
        montoCentavos: datos.saldoInicialCentavos,
        usuarioId: datos.usuarioId,
        descripcion: 'Saldo inicial de la caja',
      });

      await tx
        .update(monetaryAccounts)
        .set({
          saldoCentavos: sql`${monetaryAccounts.saldoCentavos} + ${datos.saldoInicialCentavos}`,
        })
        .where(eq(monetaryAccounts.id, datos.monetaryAccountId));
    }

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'caja.abrir',
      entidad: 'cash_sessions',
      entidadId: sesion!.id,
      valorNuevo: { terminal: datos.terminal, saldoInicialCentavos: datos.saldoInicialCentavos },
    });

    return {
      id: sesion!.id,
      terminal: sesion!.terminal,
      monetaryAccountId: sesion!.monetaryAccountId,
      abiertaPorId: sesion!.abiertaPorId,
      abiertaEn: sesion!.abiertaEn,
      saldoInicialCentavos: sesion!.saldoInicialCentavos,
    };
  });
}

export interface ResumenDeSesion {
  sesionId: string;
  abiertaEn: Date;
  saldoInicialCentavos: number;
  /** Lo que debería haber en el cajón: inicial más entradas menos salidas. */
  efectivoEsperadoCentavos: number;
  cantidadDeVentas: number;
  totalVendidoCentavos: number;
  /** Cuánto se cobró por cada medio, para el reporte de cierre. */
  porMedio: { medio: string; cantidad: number; totalCentavos: number }[];
}

export async function resumenDeSesion(
  db: BaseDatos,
  sesionId: string,
): Promise<ResumenDeSesion> {
  const [sesion] = await db.select().from(cashSessions).where(eq(cashSessions.id, sesionId)).limit(1);
  if (!sesion) throw new ErrorCaja('No se encontró esa sesión de caja.');

  // El esperado sale de los movimientos de la cuenta de efectivo de la sesión:
  // incluye la apertura, las ventas netas de vuelto, los gastos y los retiros.
  const [efectivo] = filasDe<{ total: string | number }>(
    await db.execute(sql`
      SELECT COALESCE(SUM(m.monto_centavos), 0) AS total
        FROM cash_movements m
        JOIN monetary_accounts c ON c.id = m.monetary_account_id
       WHERE m.cash_session_id = ${sesionId}
         AND c.tipo = 'efectivo'
    `),
  );

  const [ventas] = await db
    .select({
      cantidad: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`COALESCE(SUM(${sales.totalCentavos}), 0)`.mapWith(Number),
    })
    .from(sales)
    .where(and(eq(sales.cashSessionId, sesionId), eq(sales.estado, 'completed')));

  const porMedio = filasDe<{ medio: string; cantidad: string | number; total: string | number }>(
    await db.execute(sql`
      SELECT p.medio,
             count(*)                 AS cantidad,
             SUM(p.monto_centavos)    AS total
        FROM sale_payments p
        JOIN sales s ON s.id = p.sale_id
       WHERE s.cash_session_id = ${sesionId}
         AND s.estado = 'completed'
       GROUP BY p.medio
       ORDER BY SUM(p.monto_centavos) DESC
    `),
  );

  return {
    sesionId,
    abiertaEn: sesion.abiertaEn,
    saldoInicialCentavos: sesion.saldoInicialCentavos,
    efectivoEsperadoCentavos: Number(efectivo?.total ?? 0),
    cantidadDeVentas: ventas?.cantidad ?? 0,
    totalVendidoCentavos: ventas?.total ?? 0,
    porMedio: porMedio.map((f) => ({
      medio: String(f.medio),
      cantidad: Number(f.cantidad),
      totalCentavos: Number(f.total),
    })),
  };
}

export interface DatosCierre {
  sesionId: string;
  usuarioId: string;
  saldoContadoCentavos: number;
  justificacion?: string | null;
  nota?: string | null;
}

export interface CierreDeCaja {
  esperadoCentavos: number;
  contadoCentavos: number;
  /** Positiva si sobra plata, negativa si falta. */
  diferenciaCentavos: number;
}

export async function cerrarCaja(db: BaseDatos, datos: DatosCierre): Promise<CierreDeCaja> {
  if (datos.saldoContadoCentavos < 0) {
    throw new ErrorCaja('El efectivo contado no puede ser negativo.');
  }

  return db.transaction(async (tx) => {
    const [sesion] = await tx
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.id, datos.sesionId))
      .limit(1);

    if (!sesion) throw new ErrorCaja('No se encontró esa sesión de caja.');
    if (sesion.cerradaEn) throw new ErrorCaja('Esa caja ya está cerrada.');

    const resumen = await resumenDeSesion(tx, datos.sesionId);
    const diferenciaCentavos = datos.saldoContadoCentavos - resumen.efectivoEsperadoCentavos;

    // Si la caja no cuadra hay que decir por qué. Es la única forma de que la
    // diferencia sea información y no ruido.
    if (diferenciaCentavos !== 0 && !datos.justificacion?.trim()) {
      throw new ErrorCaja(
        'La caja no cuadra. Escribí a qué se debe la diferencia antes de cerrar.',
      );
    }

    await tx
      .update(cashSessions)
      .set({
        cerradaEn: new Date(),
        cerradaPorId: datos.usuarioId,
        saldoEsperadoCentavos: resumen.efectivoEsperadoCentavos,
        saldoContadoCentavos: datos.saldoContadoCentavos,
        diferenciaCentavos,
        justificacion: datos.justificacion?.trim() || null,
        nota: datos.nota ?? sesion.nota,
      })
      .where(eq(cashSessions.id, datos.sesionId));

    // La diferencia se ajusta contra la cuenta para que el saldo refleje la
    // plata que hay de verdad, y queda el asiento de por qué.
    if (diferenciaCentavos !== 0) {
      await tx.insert(cashMovements).values({
        monetaryAccountId: sesion.monetaryAccountId,
        cashSessionId: datos.sesionId,
        tipo: 'ajuste',
        montoCentavos: diferenciaCentavos,
        usuarioId: datos.usuarioId,
        descripcion: `Diferencia de arqueo: ${datos.justificacion?.trim()}`,
      });

      await tx
        .update(monetaryAccounts)
        .set({ saldoCentavos: sql`${monetaryAccounts.saldoCentavos} + ${diferenciaCentavos}` })
        .where(eq(monetaryAccounts.id, sesion.monetaryAccountId));
    }

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'caja.cerrar',
      entidad: 'cash_sessions',
      entidadId: datos.sesionId,
      valorNuevo: {
        esperadoCentavos: resumen.efectivoEsperadoCentavos,
        contadoCentavos: datos.saldoContadoCentavos,
        diferenciaCentavos,
        justificacion: datos.justificacion?.trim() ?? null,
        ventas: resumen.cantidadDeVentas,
      },
    });

    return {
      esperadoCentavos: resumen.efectivoEsperadoCentavos,
      contadoCentavos: datos.saldoContadoCentavos,
      diferenciaCentavos,
    };
  });
}
