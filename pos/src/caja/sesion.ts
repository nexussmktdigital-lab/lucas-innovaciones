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
  /** Unidades que salieron del stock. Es lo que el cierre llama «productos vendidos». */
  unidadesVendidas: number;
  /**
   * Plata que entró de verdad, por medio.
   *
   * Neto de vuelto, con los cobros de fiado adentro y sin la cuenta corriente,
   * que es una deuda y no un ingreso. La suma de los medios en efectivo tiene
   * que dar el efectivo esperado menos la apertura: es el número contra el que
   * se cuenta el cajón.
   */
  porMedio: { medio: string; cantidad: number; totalCentavos: number }[];
  /** Lo que se fió en el turno. Es facturación, pero no entró plata. */
  fiadoCentavos: number;
  /** Cuánto de lo que entró vino de deudas viejas y no de ventas de hoy. */
  cobrosDeFiadoCentavos: number;
  /**
   * Plata que salió del cajón en el turno, en positivo.
   *
   * Un gasto pagado en efectivo y un depósito al banco salen del mismo cajón
   * que se cuenta a la noche. Sin verlos, el arqueo da de menos y nadie sabe
   * por qué: es la mitad que faltaba del libro.
   */
  gastosCentavos: number;
  retirosCentavos: number;
  /** Lo devuelto a clientes por ventas de turnos anteriores. */
  devolucionesCentavos: number;
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

  const [ventas] = filasDe<{
    cantidad: string | number;
    total: string | number;
    unidades: string | number;
  }>(
    await db.execute(sql`
      SELECT count(*) AS cantidad,
             COALESCE(SUM(s.total_centavos), 0) AS total,
             COALESCE((SELECT SUM(i.cantidad)
                         FROM sale_items i
                         JOIN sales s2 ON s2.id = i.sale_id
                        WHERE s2.cash_session_id = ${sesionId}
                          AND s2.estado = 'completed'), 0) AS unidades
        FROM sales s
       WHERE s.cash_session_id = ${sesionId} AND s.estado = 'completed'
    `),
  );

  /*
   * El desglose por medio tiene que decir qué plata entró, que no es lo mismo
   * que la suma de los renglones de pago:
   *
   *  - El efectivo de una venta con vuelto figura por lo que entregó el
   *    cliente. Lo que entró es el neto, y el vuelto sale siempre del efectivo.
   *  - La cuenta corriente no es plata: es una deuda. Va aparte.
   *  - Un cobro de fiado sí es plata y no tiene venta detrás, así que no
   *    aparecía por ningún lado.
   *
   * Sin esto el desglose suma un número que no existe en ningún cajón.
   */
  const porMedio = filasDe<{ medio: string; cantidad: string | number; total: string | number }>(
    await db.execute(sql`
      WITH vueltos AS (
        SELECT s.id,
               GREATEST(
                 COALESCE((SELECT SUM(p.monto_centavos) FROM sale_payments p WHERE p.sale_id = s.id), 0)
                   - s.total_centavos,
                 0
               ) AS vuelto
          FROM sales s
         WHERE s.cash_session_id = ${sesionId} AND s.estado = 'completed'
      ),
      -- Primero por venta y medio: si una venta lleva dos pagos en efectivo,
      -- el vuelto se resta una sola vez y no una por renglón.
      pagos AS (
        SELECT p.sale_id,
               p.medio::text         AS medio,
               count(*)              AS cantidad,
               SUM(p.monto_centavos) AS bruto
          FROM sale_payments p
          JOIN sales s ON s.id = p.sale_id
         WHERE s.cash_session_id = ${sesionId}
           AND s.estado = 'completed'
           AND p.medio <> 'cuenta_corriente'
         GROUP BY p.sale_id, p.medio
      ),
      de_ventas AS (
        SELECT g.medio,
               SUM(g.cantidad) AS cantidad,
               SUM(
                 g.bruto - CASE WHEN g.medio = 'efectivo'
                                THEN COALESCE(v.vuelto, 0) ELSE 0 END
               ) AS total
          FROM pagos g
          LEFT JOIN vueltos v ON v.id = g.sale_id
         GROUP BY g.medio
      ),
      de_cobros AS (
        SELECT c.medio::text AS medio,
               count(*)      AS cantidad,
               SUM(c.monto_centavos) AS total
          FROM credit_payments c
         WHERE c.cash_session_id = ${sesionId}
         GROUP BY c.medio
      )
      SELECT medio, SUM(cantidad) AS cantidad, SUM(total) AS total
        FROM (SELECT * FROM de_ventas UNION ALL SELECT * FROM de_cobros) t
       GROUP BY medio
       ORDER BY SUM(total) DESC
    `),
  );

  const [fiado] = filasDe<{ total: string | number }>(
    await db.execute(sql`
      SELECT COALESCE(SUM(p.monto_centavos), 0) AS total
        FROM sale_payments p
        JOIN sales s ON s.id = p.sale_id
       WHERE s.cash_session_id = ${sesionId}
         AND s.estado = 'completed'
         AND p.medio = 'cuenta_corriente'
    `),
  );

  const [cobros] = filasDe<{ total: string | number }>(
    await db.execute(sql`
      SELECT COALESCE(SUM(monto_centavos), 0) AS total
        FROM credit_payments WHERE cash_session_id = ${sesionId}
    `),
  );

  /*
   * Las salidas se leen de los movimientos y no de la tabla de gastos: así el
   * número es el mismo que movió el saldo, y una transferencia al banco —que no
   * es un gasto— también aparece.
   *
   * Van netas de anulación. Un gasto cargado y anulado en el mismo turno dejó
   * dos asientos que se cancelan, y contar solo el primero diría que salieron
   * $12.000 del cajón que siguen estando adentro.
   */
  const [salidas] = filasDe<{
    gastos: string | number;
    retiros: string | number;
    devoluciones: string | number;
  }>(
    await db.execute(sql`
      SELECT COALESCE(-SUM(monto_centavos) FILTER (
               WHERE tipo = 'gasto'
                  OR (tipo = 'anulacion' AND referencia_tipo = 'expenses')
             ), 0) AS gastos,
             COALESCE(-SUM(monto_centavos) FILTER (WHERE tipo = 'retiro'), 0) AS retiros,
             -- Lo que se le devolvió a un cliente por una venta de otro turno.
             -- Sin este renglón el efectivo esperado baja y nada lo explica, que
             -- es justo el descuadre sin motivo que el arqueo vino a eliminar.
             COALESCE(-SUM(monto_centavos) FILTER (
               WHERE tipo = 'anulacion' AND referencia_tipo = 'returns'
             ), 0) AS devoluciones
        FROM cash_movements
       WHERE cash_session_id = ${sesionId}
    `),
  );

  return {
    sesionId,
    abiertaEn: sesion.abiertaEn,
    saldoInicialCentavos: sesion.saldoInicialCentavos,
    efectivoEsperadoCentavos: Number(efectivo?.total ?? 0),
    cantidadDeVentas: Number(ventas?.cantidad ?? 0),
    totalVendidoCentavos: Number(ventas?.total ?? 0),
    unidadesVendidas: Number(ventas?.unidades ?? 0),
    porMedio: porMedio.map((f) => ({
      medio: String(f.medio),
      cantidad: Number(f.cantidad),
      totalCentavos: Number(f.total),
    })),
    fiadoCentavos: Number(fiado?.total ?? 0),
    cobrosDeFiadoCentavos: Number(cobros?.total ?? 0),
    gastosCentavos: Number(salidas?.gastos ?? 0),
    retirosCentavos: Number(salidas?.retiros ?? 0),
    devolucionesCentavos: Number(salidas?.devoluciones ?? 0),
  };
}

export interface DatosCierre {
  sesionId: string;
  usuarioId: string;
  saldoContadoCentavos: number;
  justificacion?: string | null;
  nota?: string | null;
  /**
   * Con qué billetes se contó el cajón.
   *
   * Opcional: quien quiera escribir el total directo puede. Se guarda porque es
   * lo que permite entender una diferencia después — un total que no cuadra con
   * cuatro billetes de $10.000 contados cuenta otra historia que uno escrito de
   * memoria.
   */
  conteo?: { conteo: Record<number, number>; sueltoCentavos: number } | null;
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
        conteo: datos.conteo ?? null,
        nota: datos.nota?.trim() || sesion.nota,
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
