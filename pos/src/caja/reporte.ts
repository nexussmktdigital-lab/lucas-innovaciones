/**
 * El reporte de un turno cerrado.
 *
 * Hasta acá el cierre guardaba tres números —esperado, contado, diferencia— y
 * nada más. El resto del turno quedaba desparramado: las ventas en una
 * pantalla, los gastos en otra, los medios de pago en ninguna una vez cerrada
 * la caja.
 *
 * Esto lo junta en una hoja. Es el «reporte de cierre» que el POS viejo
 * imprimía y que el negocio usa para dos cosas concretas: saber qué pasó ese
 * día y poder discutir una diferencia una semana después.
 *
 * **Se recalcula, no se congela.** Los números salen de los mismos asientos que
 * movieron la plata, así que el reporte de un turno viejo dice hoy lo mismo que
 * decía al cerrarlo. Se puede porque una venta solo se anula dentro del turno
 * abierto (D29): un turno cerrado ya no cambia.
 */
import { desc, eq, isNotNull } from 'drizzle-orm';
import { cashSessions, users } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import { desgloseDelConteo, type Conteo, type RenglonDeConteo } from './arqueo';
import { resumenDeSesion, type ResumenDeSesion } from './sesion';

export interface ReporteDeCierre extends ResumenDeSesion {
  terminal: string;
  abiertaPor: string | null;
  cerradaEn: Date | null;
  cerradaPor: string | null;
  saldoContadoCentavos: number | null;
  diferenciaCentavos: number | null;
  justificacion: string | null;
  nota: string | null;
  /** Con qué billetes se contó, si se contó. Vacío si se escribió el total. */
  desgloseDelConteo: RenglonDeConteo[];
  sueltoCentavos: number;
  /** True mientras el turno siga abierto: el reporte es provisorio. */
  abierta: boolean;
}

interface ConteoGuardado {
  conteo?: Conteo;
  sueltoCentavos?: number;
}

export async function reporteDeCierre(
  db: BaseDatos,
  sesionId: string,
): Promise<ReporteDeCierre | null> {
  const [sesion] = await db
    .select()
    .from(cashSessions)
    .where(eq(cashSessions.id, sesionId))
    .limit(1);

  if (!sesion) return null;

  const resumen = await resumenDeSesion(db, sesionId);

  const nombres = await db
    .select({ id: users.id, nombre: users.nombre })
    .from(users);
  const nombreDe = (id: string | null) =>
    id === null ? null : (nombres.find((u) => u.id === id)?.nombre ?? null);

  const guardado = (sesion.conteo ?? {}) as ConteoGuardado;

  return {
    ...resumen,
    terminal: sesion.terminal,
    abiertaPor: nombreDe(sesion.abiertaPorId),
    cerradaEn: sesion.cerradaEn,
    cerradaPor: nombreDe(sesion.cerradaPorId),
    saldoContadoCentavos: sesion.saldoContadoCentavos,
    diferenciaCentavos: sesion.diferenciaCentavos,
    justificacion: sesion.justificacion,
    nota: sesion.nota,
    desgloseDelConteo: guardado.conteo ? desgloseDelConteo(guardado.conteo) : [],
    sueltoCentavos: guardado.sueltoCentavos ?? 0,
    abierta: sesion.cerradaEn === null,
  };
}

export interface CierreEnLista {
  id: string;
  terminal: string;
  abiertaEn: Date;
  cerradaEn: Date;
  cerradaPor: string | null;
  esperadoCentavos: number;
  contadoCentavos: number;
  diferenciaCentavos: number;
  justificacion: string | null;
  /** True si el cajón se contó billete por billete y no se escribió el total. */
  seConto: boolean;
}

/** Los últimos cierres, del más nuevo al más viejo. */
export async function cierresRecientes(db: BaseDatos, limite = 20): Promise<CierreEnLista[]> {
  const filas = await db
    .select({
      id: cashSessions.id,
      terminal: cashSessions.terminal,
      abiertaEn: cashSessions.abiertaEn,
      cerradaEn: cashSessions.cerradaEn,
      cerradaPor: users.nombre,
      esperado: cashSessions.saldoEsperadoCentavos,
      contado: cashSessions.saldoContadoCentavos,
      diferencia: cashSessions.diferenciaCentavos,
      justificacion: cashSessions.justificacion,
      conteo: cashSessions.conteo,
    })
    .from(cashSessions)
    .leftJoin(users, eq(users.id, cashSessions.cerradaPorId))
    .where(isNotNull(cashSessions.cerradaEn))
    .orderBy(desc(cashSessions.cerradaEn))
    .limit(limite);

  return filas.map((f) => {
    const guardado = (f.conteo ?? {}) as ConteoGuardado;
    const billetes = Object.values(guardado.conteo ?? {}).reduce((n, c) => n + c, 0);

    return {
      id: f.id,
      terminal: f.terminal,
      abiertaEn: f.abiertaEn,
      cerradaEn: f.cerradaEn!,
      cerradaPor: f.cerradaPor,
      esperadoCentavos: f.esperado ?? 0,
      contadoCentavos: f.contado ?? 0,
      diferenciaCentavos: f.diferencia ?? 0,
      justificacion: f.justificacion,
      seConto: billetes > 0 || (guardado.sueltoCentavos ?? 0) > 0,
    };
  });
}

/**
 * Cuántos de los últimos cierres se hicieron contando.
 *
 * Es el número que dice si el arqueo se está haciendo de verdad. La auditoría
 * encontró que en el POS viejo el efectivo contado figuraba siempre en cero:
 * sin esta medida, ese hábito vuelve sin que nadie lo note.
 */
export async function cuantosSeContaron(
  db: BaseDatos,
  ultimos = 10,
): Promise<{ contados: number; total: number }> {
  const cierres = await cierresRecientes(db, ultimos);
  return { contados: cierres.filter((c) => c.seConto).length, total: cierres.length };
}
