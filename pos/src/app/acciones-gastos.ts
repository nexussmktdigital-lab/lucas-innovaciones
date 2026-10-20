'use server';

/**
 * Acciones de gastos y cuentas monetarias.
 *
 * Todo esto es del dueño: `gasto.ver` y `gasto.cargar` no están entre los
 * permisos del vendedor. Lo que el negocio paga y lo que tiene en cada cuenta
 * no es información de mostrador.
 *
 * Un gasto en efectivo sale del cajón del turno abierto, así que necesita una
 * caja abierta igual que un cobro: si no, el arqueo no cerraría. Uno pagado por
 * transferencia no, porque el banco no tiene turnos.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { config } from '@/lib/config';
import { aCentavos, ErrorDinero, formatearARS, formatearUSD } from '@/lib/dinero';
import { fechaLocalISO } from '@/lib/fecha';
import { sesionAbierta } from '@/caja/sesion';
import { cotizacionVigente } from '@/cotizacion/cotizacion';
import {
  anularGasto,
  crearBeneficiario,
  ErrorGasto,
  pagarGasto,
  registrarGasto,
} from '@/gastos/gastos';
import { cuentasConSaldo, ErrorCuenta, transferir } from '@/gastos/cuentas';

export interface EstadoGastos {
  error?: string;
  ok?: string;
}

const medios = z.enum([
  'efectivo',
  'transferencia',
  'debito',
  'credito',
  'mercadopago',
  'cheque',
  /*
   * Billetes verdes, del cajón de los dólares.
   *
   * Es con lo que se le paga al proveedor de iPhones, y faltaba: el gasto se
   * cargaba como «efectivo» y salía del cajón de pesos, que no era de donde
   * había salido.
   */
  'dolares',
]);

const uuid = z.string().uuid();

function refrescar() {
  revalidatePath('/gastos');
  revalidatePath('/cuentas');
  revalidatePath('/caja');
  revalidatePath('/');
}

async function duenio() {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' as const };
  if (!puede(sesion.user.rol, 'gasto.cargar')) {
    return { error: 'Los gastos los carga el dueño.' as const };
  }
  return { usuarioId: sesion.user.id };
}

/**
 * Busca la caja abierta cuando el gasto sale del cajón.
 *
 * Solo hace falta para el efectivo: una transferencia sale del banco, que no
 * tiene turnos, y exigir una caja abierta para pagar el alquiler un domingo
 * sería un trámite sin sentido.
 */
async function turnoSiHaceFalta(
  medio: string,
  tipoDeCuenta: string,
): Promise<{ cashSessionId?: string | null; error?: string }> {
  const esEfectivo = medio === 'efectivo' || tipoDeCuenta === 'efectivo';
  const esCajonDeDolares = medio === 'dolares' || tipoDeCuenta === 'dolares';
  if (!esEfectivo && !esCajonDeDolares) return { cashSessionId: null };

  const caja = await sesionAbierta(db, config().POS_TERMINAL);
  if (!caja) {
    /*
     * El cajón verde no entra en el arqueo de la noche: lo que se cuenta
     * contra el sistema son los pesos. Exigir una caja abierta para pagarle
     * al proveedor con billetes sería un trámite que no cuadra nada.
     */
    if (esCajonDeDolares && !esEfectivo) return { cashSessionId: null };
    return {
      error:
        'Para pagar en efectivo tiene que haber una caja abierta: la plata sale del cajón del turno.',
    };
  }
  return { cashSessionId: caja.id };
}

/** El tipo de la cuenta elegida: decide si el gasto pertenece a un turno. */
async function tipoDeCuenta(monetaryAccountId: string): Promise<string> {
  const cuentas = await cuentasConSaldo(db);
  return cuentas.find((c) => c.id === monetaryAccountId)?.tipo ?? 'otra';
}

export async function registrarGastoAccion(
  _previo: EstadoGastos,
  datos: FormData,
): Promise<EstadoGastos> {
  const quien = await duenio();
  if ('error' in quien) return { error: quien.error };

  const categoryId = String(datos.get('categoria') ?? '');
  if (!uuid.safeParse(categoryId).success) return { error: 'Elegí una categoría.' };

  const estado = String(datos.get('estado') ?? 'pagado') === 'pendiente' ? 'pendiente' : 'pagado';

  let importeCentavos: number;
  try {
    importeCentavos = aCentavos(String(datos.get('monto') ?? ''));
  } catch (error) {
    return {
      error: error instanceof ErrorDinero ? 'Escribí cuánto se gastó.' : 'El monto no es válido.',
    };
  }

  /*
   * En qué moneda se pagó, y a cuánto estaba el dólar.
   *
   * La cotización se lee acá y no en el navegador, igual que en el precio de
   * un producto en dólares: los pesos de un gasto en dólares los calcula el
   * servidor y quedan congelados. Si el navegador mandara el tipo de cambio,
   * un gasto podría entrar a la cotización que a alguien le convenga.
   */
  const moneda = datos.get('moneda') === 'USD' ? 'USD' : 'ARS';
  let montoCentavos: number | undefined = importeCentavos;
  let montoUsdCentavos: number | null = null;
  let tcAplicadoCentavos: number | null = null;

  if (moneda === 'USD') {
    const cotizacion = await cotizacionVigente(db);
    if (!cotizacion) {
      return {
        error:
          'No hay cotización cargada y este gasto es en dólares. Cargá el dólar del día y volvé a guardarlo.',
      };
    }
    montoCentavos = undefined;
    montoUsdCentavos = importeCentavos;
    tcAplicadoCentavos = cotizacion.valorCentavos;
  }

  // El beneficiario puede venir elegido de la lista o escrito a mano.
  let payeeId: string | null = null;
  const beneficiarioId = String(datos.get('beneficiario') ?? '');
  const beneficiarioNuevo = String(datos.get('beneficiarioNuevo') ?? '').trim();

  try {
    if (beneficiarioNuevo) {
      payeeId = (await crearBeneficiario(db, { nombre: beneficiarioNuevo })).id;
    } else if (uuid.safeParse(beneficiarioId).success) {
      payeeId = beneficiarioId;
    }
  } catch (error) {
    if (error instanceof ErrorGasto) return { error: error.message };
    throw error;
  }

  let medio: z.infer<typeof medios> | null = null;
  let monetaryAccountId: string | null = null;
  let cashSessionId: string | null = null;

  if (estado === 'pagado') {
    const leido = medios.safeParse(String(datos.get('medio') ?? ''));
    if (!leido.success) return { error: 'Elegí con qué se pagó.' };
    medio = leido.data;

    monetaryAccountId = String(datos.get('cuenta') ?? '');
    if (!uuid.safeParse(monetaryAccountId).success) {
      return { error: 'Elegí de qué cuenta salió la plata.' };
    }

    const turno = await turnoSiHaceFalta(medio, await tipoDeCuenta(monetaryAccountId));
    if (turno.error) return { error: turno.error };
    cashSessionId = turno.cashSessionId ?? null;
  }

  try {
    const g = await registrarGasto(db, {
      fecha: String(datos.get('fecha') ?? '') || fechaLocalISO(),
      categoryId,
      payeeId,
      descripcion: String(datos.get('descripcion') ?? ''),
      montoCentavos,
      montoUsdCentavos,
      tcAplicadoCentavos,
      estado,
      medio,
      chequeNumero: String(datos.get('chequeNumero') ?? '').trim() || null,
      chequeRecibidoDe: String(datos.get('chequeRecibidoDe') ?? '').trim() || null,
      monetaryAccountId,
      cashSessionId,
      vencimiento: String(datos.get('vencimiento') ?? '').trim() || null,
      usuarioId: quien.usuarioId,
    });

    refrescar();

    // Lo que se dice de vuelta es lo que se pagó: en un gasto en dólares, los
    // dólares. Decir los pesos convertidos obligaría a dividir para comprobar
    // que se cargó bien.
    const cifra =
      g.moneda === 'USD' && g.montoUsdCentavos !== null
        ? `${formatearUSD(g.montoUsdCentavos)} (${formatearARS(g.montoCentavos)})`
        : formatearARS(g.montoCentavos);

    return {
      ok:
        g.estado === 'pagado'
          ? `Gasto de ${cifra} registrado y descontado.`
          : `Gasto de ${cifra} anotado como pendiente.`,
    };
  } catch (error) {
    if (error instanceof ErrorGasto) return { error: error.message };
    console.error('[gastos] Falló el alta:', error);
    return { error: 'No se pudo registrar el gasto. No se tocó nada: probá de nuevo.' };
  }
}

/** Paga un gasto que estaba pendiente. */
export async function pagarGastoAccion(
  _previo: EstadoGastos,
  datos: FormData,
): Promise<EstadoGastos> {
  const quien = await duenio();
  if ('error' in quien) return { error: quien.error };

  const gastoId = String(datos.get('gastoId') ?? '');
  if (!uuid.safeParse(gastoId).success) return { error: 'No se reconoce ese gasto.' };

  const medio = medios.safeParse(String(datos.get('medio') ?? ''));
  if (!medio.success) return { error: 'Elegí con qué se paga.' };

  const monetaryAccountId = String(datos.get('cuenta') ?? '');
  if (!uuid.safeParse(monetaryAccountId).success) {
    return { error: 'Elegí de qué cuenta sale la plata.' };
  }

  const turno = await turnoSiHaceFalta(medio.data, await tipoDeCuenta(monetaryAccountId));
  if (turno.error) return { error: turno.error };

  try {
    const g = await pagarGasto(db, {
      gastoId,
      medio: medio.data,
      monetaryAccountId,
      cashSessionId: turno.cashSessionId ?? null,
      chequeNumero: String(datos.get('chequeNumero') ?? '').trim() || null,
      chequeRecibidoDe: String(datos.get('chequeRecibidoDe') ?? '').trim() || null,
      usuarioId: quien.usuarioId,
    });

    refrescar();
    const cifra =
      g.moneda === 'USD' && g.montoUsdCentavos !== null
        ? `${formatearUSD(g.montoUsdCentavos)} (${formatearARS(g.montoCentavos)})`
        : formatearARS(g.montoCentavos);
    return { ok: `Pagado ${cifra}.` };
  } catch (error) {
    if (error instanceof ErrorGasto) return { error: error.message };
    console.error('[gastos] Falló el pago:', error);
    return { error: 'No se pudo registrar el pago.' };
  }
}

/** Anula un gasto. Si había movido plata, la plata vuelve. */
export async function anularGastoAccion(
  _previo: EstadoGastos,
  datos: FormData,
): Promise<EstadoGastos> {
  const quien = await duenio();
  if ('error' in quien) return { error: quien.error };

  const gastoId = String(datos.get('gastoId') ?? '');
  if (!uuid.safeParse(gastoId).success) return { error: 'No se reconoce ese gasto.' };

  const caja = await sesionAbierta(db, config().POS_TERMINAL);

  try {
    const r = await anularGasto(db, {
      gastoId,
      motivo: String(datos.get('motivo') ?? ''),
      usuarioId: quien.usuarioId,
      cashSessionId: caja?.id ?? null,
    });

    refrescar();
    return {
      ok:
        r.devueltoCentavos > 0
          ? `Gasto anulado. Volvieron ${formatearARS(r.devueltoCentavos)} a la cuenta.`
          : 'Gasto anulado. No había movido plata.',
    };
  } catch (error) {
    if (error instanceof ErrorGasto) return { error: error.message };
    console.error('[gastos] Falló la anulación:', error);
    return { error: 'No se pudo anular el gasto.' };
  }
}

/** Pasa plata de una cuenta a otra: depositar la recaudación, por ejemplo. */
export async function transferirAccion(
  _previo: EstadoGastos,
  datos: FormData,
): Promise<EstadoGastos> {
  const quien = await duenio();
  if ('error' in quien) return { error: quien.error };

  const origenId = String(datos.get('origen') ?? '');
  const destinoId = String(datos.get('destino') ?? '');
  if (!uuid.safeParse(origenId).success || !uuid.safeParse(destinoId).success) {
    return { error: 'Elegí las dos cuentas.' };
  }

  let montoCentavos: number;
  try {
    montoCentavos = aCentavos(String(datos.get('monto') ?? ''));
  } catch {
    return { error: 'Escribí cuánto se transfiere.' };
  }

  // Si sale del cajón, la salida es del turno: a la noche esa plata no está.
  const turno =
    (await tipoDeCuenta(origenId)) === 'efectivo'
      ? await turnoSiHaceFalta('efectivo', 'efectivo')
      : { cashSessionId: null };
  if ('error' in turno && turno.error) return { error: turno.error };

  try {
    await transferir(db, {
      origenId,
      destinoId,
      montoCentavos,
      usuarioId: quien.usuarioId,
      nota: String(datos.get('nota') ?? '').trim() || null,
      cashSessionId: turno.cashSessionId ?? null,
    });

    refrescar();
    return { ok: `Transferidos ${formatearARS(montoCentavos)}.` };
  } catch (error) {
    if (error instanceof ErrorCuenta) return { error: error.message };
    console.error('[cuentas] Falló la transferencia:', error);
    return { error: 'No se pudo hacer la transferencia.' };
  }
}
