/**
 * El fiado con fechas: planes de cuotas.
 *
 * Hasta acá el fiado era un saldo abierto —«debe $80.000, que venga cuando
 * pueda»—, que es exactamente como funciona el fiado de barrio de $5.000. Para
 * un celular de $400.000 en seis pagos no alcanza: sin fechas nadie sabe quién
 * está atrasado, y el recordatorio de WhatsApp termina diciéndole lo mismo al
 * que paga puntual que al que debe desde marzo.
 *
 * Tres ideas sostienen este módulo:
 *
 *  1. **El plan no reemplaza al saldo, lo explica.** La deuda del cliente
 *     sigue siendo `credit_accounts.saldo_centavos`, y todo lo que ya estaba
 *     —el tope, el cobro, la anulación— sigue funcionando igual. Las cuotas
 *     dicen *cuándo* se espera cada parte de esa deuda. Un cliente puede tener
 *     deuda sin plan (el fiado de siempre) y eso está bien.
 *  2. **Vencida se calcula, no se guarda.** Una cuota no cambia de estado sola
 *     a la medianoche: se compara su vencimiento con hoy cada vez que se mira.
 *     Guardarlo obligaría a una tarea que corra todas las noches y a que nadie
 *     se olvide de mirarla.
 *  3. **Un pago se imputa a la cuota más vieja primero.** Es lo que hace
 *     cualquiera con una libreta y es lo que espera el cliente: lo que pagás
 *     tapa lo que está atrasado antes que lo que todavía no venció.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { creditAccounts, creditPaymentAllocations, creditPlans, installments } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import { diasEntre, sumarDias, sumarMeses } from '@/lib/fecha';
import { repartir } from '@/lib/dinero';

export class ErrorPlan extends Error {}

export type Frecuencia = 'semanal' | 'quincenal' | 'mensual';

export const FRECUENCIAS: { valor: Frecuencia; etiqueta: string; corta: string }[] = [
  { valor: 'semanal', etiqueta: 'Cada semana', corta: 'por semana' },
  { valor: 'quincenal', etiqueta: 'Cada 15 días', corta: 'cada 15 días' },
  { valor: 'mensual', etiqueta: 'Cada mes', corta: 'por mes' },
];

/** Tope de cuotas. Más que esto no es fiado de mostrador, es otra cosa. */
export const CUOTAS_MAXIMAS = 24;

/** A cuántos días de vencer una cuota ya conviene avisar. */
export const DIAS_PARA_AVISAR = 3;

export function esFrecuencia(x: unknown): x is Frecuencia {
  return x === 'semanal' || x === 'quincenal' || x === 'mensual';
}

/** Cómo se dice la frecuencia en una oración: «cada 15 días». */
export function comoSeDice(f: Frecuencia): string {
  return FRECUENCIAS.find((x) => x.valor === f)!.corta;
}

/** Cuándo vence la cuota número `n` (1 es la primera) de un plan que arranca hoy. */
export function vencimientoDeCuota(desdeISO: string, frecuencia: Frecuencia, n: number): string {
  switch (frecuencia) {
    case 'semanal':
      return sumarDias(desdeISO, 7 * n);
    case 'quincenal':
      return sumarDias(desdeISO, 15 * n);
    case 'mensual':
      // Por calendario y no cada 30 días: si compró un 5, paga los 5.
      return sumarMeses(desdeISO, n);
  }
}

export interface CuotaPlanificada {
  numero: number;
  montoCentavos: number;
  /** `YYYY-MM-DD` del calendario del local. */
  vencimiento: string;
}

/**
 * Arma las cuotas de un plan.
 *
 * La primera vence **una frecuencia después** de la venta, no el mismo día:
 * quien acaba de entregar parte de la plata en el mostrador no debe una cuota
 * en ese instante.
 *
 * El reparto lo hace `repartir`, que no pierde ni inventa centavos: si el total
 * no divide exacto, las primeras cuotas llevan un centavo más.
 */
export function cuotasDelPlan(
  totalCentavos: number,
  cantidad: number,
  frecuencia: Frecuencia,
  desdeISO: string,
): CuotaPlanificada[] {
  if (!Number.isInteger(totalCentavos) || totalCentavos <= 0) {
    throw new ErrorPlan('El monto a financiar tiene que ser mayor a cero.');
  }
  if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > CUOTAS_MAXIMAS) {
    throw new ErrorPlan(`La cantidad de cuotas va de 1 a ${CUOTAS_MAXIMAS}.`);
  }

  return repartir(totalCentavos, cantidad).map((montoCentavos, i) => ({
    numero: i + 1,
    montoCentavos,
    vencimiento: vencimientoDeCuota(desdeISO, frecuencia, i + 1),
  }));
}

/* -------------------------------------------------------------------------- */
/* Estado de una deuda                                                        */
/* -------------------------------------------------------------------------- */

/**
 * El semáforo del mostrador.
 *
 *  - `rojo`     tiene una cuota vencida sin pagar.
 *  - `amarillo` la próxima vence hoy o en los próximos días.
 *  - `verde`    está al día y falta para la próxima.
 *  - `gris`     debe, pero sin plan: el fiado abierto de siempre.
 */
export type Color = 'rojo' | 'amarillo' | 'verde' | 'gris';

/** Una cuota como está guardada, con lo que ya se le imputó. */
export interface CuotaGuardada {
  numero: number;
  montoCentavos: number;
  pagadoCentavos: number;
  vencimiento: string;
}

export interface EstadoDeDeuda {
  color: Color;
  /** Una línea para el mostrador. */
  titulo: string;
  /** La próxima cuota que hay que cobrar, si queda alguna. */
  proxima: { numero: number; faltaCentavos: number; vencimiento: string; enDias: number } | null;
  /** Lo vencido y sin pagar, sumado. */
  vencidoCentavos: number;
  /** Días de atraso de la cuota vencida más vieja. Cero si no hay ninguna. */
  diasDeAtraso: number;
  cuotasPagadas: number;
  cuotasTotales: number;
}

/** Lo que falta de una cuota. Nunca negativo, aunque se haya imputado de más. */
function faltaDe(c: CuotaGuardada): number {
  return Math.max(0, c.montoCentavos - c.pagadoCentavos);
}

/**
 * Mira las cuotas de un cliente y dice en qué estado está.
 *
 * Sin cuotas devuelve `gris`: no es una falla, es el fiado de siempre.
 */
export function estadoDeDeuda(cuotas: readonly CuotaGuardada[], hoyISO: string): EstadoDeDeuda {
  const cuotasTotales = cuotas.length;
  const impagas = cuotas.filter((c) => faltaDe(c) > 0).sort((a, b) => a.numero - b.numero);
  const cuotasPagadas = cuotasTotales - impagas.length;

  if (cuotasTotales === 0) {
    return {
      color: 'gris',
      titulo: 'Sin plan de pago',
      proxima: null,
      vencidoCentavos: 0,
      diasDeAtraso: 0,
      cuotasPagadas: 0,
      cuotasTotales: 0,
    };
  }

  const vencidas = impagas.filter((c) => diasEntre(c.vencimiento, hoyISO) > 0);
  const vencidoCentavos = vencidas.reduce((suma, c) => suma + faltaDe(c), 0);
  const diasDeAtraso = vencidas.reduce(
    (peor, c) => Math.max(peor, diasEntre(c.vencimiento, hoyISO)),
    0,
  );

  const siguiente = impagas[0];
  const proxima = siguiente
    ? {
        numero: siguiente.numero,
        faltaCentavos: faltaDe(siguiente),
        vencimiento: siguiente.vencimiento,
        enDias: diasEntre(hoyISO, siguiente.vencimiento),
      }
    : null;

  if (!proxima) {
    return {
      color: 'verde',
      titulo: 'Terminó de pagar el plan',
      proxima: null,
      vencidoCentavos: 0,
      diasDeAtraso: 0,
      cuotasPagadas,
      cuotasTotales,
    };
  }

  if (vencidas.length > 0) {
    return {
      color: 'rojo',
      titulo:
        vencidas.length === 1
          ? `Atrasado ${diasDeAtraso} ${diasDeAtraso === 1 ? 'día' : 'días'}`
          : `${vencidas.length} cuotas vencidas, la más vieja hace ${diasDeAtraso} días`,
      proxima,
      vencidoCentavos,
      diasDeAtraso,
      cuotasPagadas,
      cuotasTotales,
    };
  }

  if (proxima.enDias <= DIAS_PARA_AVISAR) {
    return {
      color: 'amarillo',
      titulo:
        proxima.enDias === 0
          ? 'La cuota vence hoy'
          : `La cuota vence en ${proxima.enDias} ${proxima.enDias === 1 ? 'día' : 'días'}`,
      proxima,
      vencidoCentavos: 0,
      diasDeAtraso: 0,
      cuotasPagadas,
      cuotasTotales,
    };
  }

  return {
    color: 'verde',
    titulo: `Al día. La próxima vence en ${proxima.enDias} días`,
    proxima,
    vencidoCentavos: 0,
    diasDeAtraso: 0,
    cuotasPagadas,
    cuotasTotales,
  };
}

/* -------------------------------------------------------------------------- */
/* Imputación de un pago                                                      */
/* -------------------------------------------------------------------------- */

export interface Imputacion {
  numero: number;
  montoCentavos: number;
}

/**
 * Reparte lo que el cliente pagó entre sus cuotas, de la más vieja a la más nueva.
 *
 * Lo que sobre después de cubrirlas todas **no se imputa a nada**: se devuelve
 * como `sobrante`. Es plata a cuenta de una deuda sin cuota asignada —o un
 * adelanto—, y el saldo de la cuenta ya lo refleja. Inventarle una cuota sería
 * mentirle al plan.
 */
export function imputar(
  cuotas: readonly CuotaGuardada[],
  montoCentavos: number,
): { imputaciones: Imputacion[]; sobranteCentavos: number } {
  let restante = montoCentavos;
  const imputaciones: Imputacion[] = [];

  for (const c of [...cuotas].sort((a, b) => a.numero - b.numero)) {
    if (restante <= 0) break;
    const falta = faltaDe(c);
    if (falta <= 0) continue;

    const aplica = Math.min(falta, restante);
    imputaciones.push({ numero: c.numero, montoCentavos: aplica });
    restante -= aplica;
  }

  return { imputaciones, sobranteCentavos: restante };
}

/* -------------------------------------------------------------------------- */
/* Lo que toca la base                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Guarda el plan de una venta fiada, con sus cuotas.
 *
 * Va dentro de la transacción de la venta: o entra la venta con su plan, o no
 * entra ninguna de las dos cosas. Un plan sin venta sería una promesa de pago
 * de nada, y una venta fiada cuyo plan falló al guardarse sería peor: el
 * mostrador creería que hay fechas y no las hay.
 */
export async function crearPlan(
  tx: BaseDatos,
  datos: {
    creditAccountId: string;
    saleId: string | null;
    montoCentavos: number;
    cantidad: number;
    frecuencia: Frecuencia;
    desdeISO: string;
    descripcion?: string | null;
  },
): Promise<{ planId: string; cuotas: CuotaPlanificada[] }> {
  const cuotas = cuotasDelPlan(
    datos.montoCentavos,
    datos.cantidad,
    datos.frecuencia,
    datos.desdeISO,
  );

  const [plan] = await tx
    .insert(creditPlans)
    .values({
      creditAccountId: datos.creditAccountId,
      saleId: datos.saleId,
      descripcion: datos.descripcion ?? null,
      montoFinanciadoCentavos: datos.montoCentavos,
      // Sin recargo ni anticipo: el POS no cobra interés por fiar (D38). El día
      // que lo cobre, las columnas ya están.
      cantidadCuotas: datos.cantidad,
      totalAPagarCentavos: datos.montoCentavos,
      frecuencia: datos.frecuencia,
    })
    .returning({ id: creditPlans.id });

  const planId = plan!.id;

  await tx.insert(installments).values(
    cuotas.map((c) => ({
      planId,
      numero: c.numero,
      montoCentavos: c.montoCentavos,
      vencimiento: c.vencimiento,
    })),
  );

  return { planId, cuotas };
}

/** Una cuota tal como vive en la base, con de qué plan y de qué venta viene. */
export interface CuotaDeCuenta extends CuotaGuardada {
  id: string;
  planId: string;
  frecuencia: Frecuencia | null;
}

/**
 * Las cuotas vivas de una cuenta: las de los planes que no se anularon.
 *
 * `vencimiento` es una columna `date`. Drizzle la devuelve como texto
 * `YYYY-MM-DD`, pero un `Date` suelto llegaría de un driver distinto y la
 * comparación con «hoy» quedaría corrida un día — la misma clase de diferencia
 * que ya costó dos hallazgos. Se normaliza acá, en un solo lugar.
 */
export async function cuotasDeCuenta(
  db: BaseDatos,
  creditAccountId: string,
): Promise<CuotaDeCuenta[]> {
  const filas = await db
    .select({
      id: installments.id,
      planId: installments.planId,
      numero: installments.numero,
      montoCentavos: installments.montoCentavos,
      pagadoCentavos: installments.pagadoCentavos,
      vencimiento: installments.vencimiento,
      frecuencia: creditPlans.frecuencia,
    })
    .from(installments)
    .innerJoin(creditPlans, eq(creditPlans.id, installments.planId))
    .where(and(eq(creditPlans.creditAccountId, creditAccountId), isNull(creditPlans.anuladoEn)))
    .orderBy(installments.vencimiento, installments.numero);

  return filas.map((f, i) => ({
    id: f.id,
    planId: f.planId,
    // El número que importa para imputar es el orden por vencimiento: dos
    // planes distintos empiezan los dos en 1.
    numero: i + 1,
    montoCentavos: f.montoCentavos,
    pagadoCentavos: f.pagadoCentavos,
    vencimiento: aFechaISO(f.vencimiento),
    frecuencia: esFrecuencia(f.frecuencia) ? f.frecuencia : null,
  }));
}

/** `YYYY-MM-DD`, venga como texto o como fecha. */
export function aFechaISO(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/**
 * Imputa un cobro a las cuotas del cliente, de la más vieja a la más nueva.
 *
 * Lo que sobra después de cubrirlas todas no se imputa: queda como saldo a
 * cuenta, que el saldo de la cuenta corriente ya refleja.
 */
export async function imputarPago(
  tx: BaseDatos,
  datos: { creditAccountId: string; creditPaymentId: string; montoCentavos: number },
): Promise<{ imputadoCentavos: number }> {
  const cuotas = await cuotasDeCuenta(tx, datos.creditAccountId);
  if (cuotas.length === 0) return { imputadoCentavos: 0 };

  const { imputaciones } = imputar(cuotas, datos.montoCentavos);

  for (const i of imputaciones) {
    const cuota = cuotas[i.numero - 1]!;
    const pagado = cuota.pagadoCentavos + i.montoCentavos;

    await tx
      .update(installments)
      .set({
        pagadoCentavos: pagado,
        estado: pagado >= cuota.montoCentavos ? 'pagada' : 'pendiente',
      })
      .where(eq(installments.id, cuota.id));

    await tx.insert(creditPaymentAllocations).values({
      creditPaymentId: datos.creditPaymentId,
      installmentId: cuota.id,
      montoCentavos: i.montoCentavos,
    });
  }

  return {
    imputadoCentavos: imputaciones.reduce((suma, i) => suma + i.montoCentavos, 0),
  };
}

/**
 * Anula los planes de una venta anulada.
 *
 * No se borran: las cuotas que ya se cobraron tienen imputaciones apuntando a
 * ellas, y borrar el plan dejaría un cobro imputado a una cuota que no existe.
 * Se marca, y todo lo que mira cuotas ignora los planes anulados (D29).
 */
export async function anularPlanesDeVenta(tx: BaseDatos, saleId: string): Promise<void> {
  await tx
    .update(creditPlans)
    .set({ anuladoEn: new Date() })
    .where(and(eq(creditPlans.saleId, saleId), isNull(creditPlans.anuladoEn)));
}

/** El estado de varios clientes de una vez, para la pantalla de Fiado. */
export async function estadosDeClientes(
  db: BaseDatos,
  customerIds: readonly string[],
  hoyISO: string,
): Promise<Map<string, EstadoDeDeuda & { frecuencia: Frecuencia | null }>> {
  const estados = new Map<string, EstadoDeDeuda & { frecuencia: Frecuencia | null }>();
  if (customerIds.length === 0) return estados;

  const filas = await db
    .select({
      customerId: creditAccounts.customerId,
      numero: installments.numero,
      montoCentavos: installments.montoCentavos,
      pagadoCentavos: installments.pagadoCentavos,
      vencimiento: installments.vencimiento,
      frecuencia: creditPlans.frecuencia,
    })
    .from(installments)
    .innerJoin(creditPlans, eq(creditPlans.id, installments.planId))
    .innerJoin(creditAccounts, eq(creditAccounts.id, creditPlans.creditAccountId))
    .where(
      and(inArray(creditAccounts.customerId, [...customerIds]), isNull(creditPlans.anuladoEn)),
    );

  const porCliente = new Map<string, { cuotas: CuotaGuardada[]; frecuencia: Frecuencia | null }>();

  for (const f of filas) {
    const entrada = porCliente.get(f.customerId) ?? { cuotas: [], frecuencia: null };
    entrada.cuotas.push({
      numero: entrada.cuotas.length + 1,
      montoCentavos: f.montoCentavos,
      pagadoCentavos: f.pagadoCentavos,
      vencimiento: aFechaISO(f.vencimiento),
    });
    if (esFrecuencia(f.frecuencia)) entrada.frecuencia = f.frecuencia;
    porCliente.set(f.customerId, entrada);
  }

  for (const [customerId, entrada] of porCliente) {
    // El orden por vencimiento es el que manda: renumerar después de ordenar
    // deja «la más vieja primero» aunque haya dos planes mezclados.
    const ordenadas = entrada.cuotas
      .sort((a, b) => a.vencimiento.localeCompare(b.vencimiento))
      .map((c, i) => ({ ...c, numero: i + 1 }));

    estados.set(customerId, {
      ...estadoDeDeuda(ordenadas, hoyISO),
      frecuencia: entrada.frecuencia,
    });
  }

  return estados;
}
