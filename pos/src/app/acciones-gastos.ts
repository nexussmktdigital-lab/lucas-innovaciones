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
import { aCentavos, ErrorDinero, formatearARS } from '@/lib/dinero';
import { fechaLocalISO } from '@/lib/fecha';
import { sesionAbierta } from '@/caja/sesion';
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
  tipoDeCuenta: 'efectivo' | 'otra',
): Promise<{ cashSessionId?: string | null; error?: string }> {
  if (medio !== 'efectivo' && tipoDeCuenta !== 'efectivo') return { cashSessionId: null };

  const caja = await sesionAbierta(db, config().POS_TERMINAL);
  if (!caja) {
    return {
      error:
        'Para pagar en efectivo tiene que haber una caja abierta: la plata sale del cajón del turno.',
    };
  }
  return { cashSessionId: caja.id };
}

async function esCuentaDeEfectivo(monetaryAccountId: string): Promise<boolean> {
  const cuentas = await cuentasConSaldo(db);
  return cuentas.find((c) => c.id === monetaryAccountId)?.tipo === 'efectivo';
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

  let montoCentavos: number;
  try {
    montoCentavos = aCentavos(String(datos.get('monto') ?? ''));
  } catch (error) {
    return {
      error: error instanceof ErrorDinero ? 'Escribí cuánto se gastó.' : 'El monto no es válido.',
    };
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

    const turno = await turnoSiHaceFalta(
      medio,
      (await esCuentaDeEfectivo(monetaryAccountId)) ? 'efectivo' : 'otra',
    );
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
      estado,
      medio,
      monetaryAccountId,
      cashSessionId,
      vencimiento: String(datos.get('vencimiento') ?? '').trim() || null,
      usuarioId: quien.usuarioId,
    });

    refrescar();
    return {
      ok:
        g.estado === 'pagado'
          ? `Gasto de ${formatearARS(g.montoCentavos)} registrado y descontado.`
          : `Gasto de ${formatearARS(g.montoCentavos)} anotado como pendiente.`,
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

  const turno = await turnoSiHaceFalta(
    medio.data,
    (await esCuentaDeEfectivo(monetaryAccountId)) ? 'efectivo' : 'otra',
  );
  if (turno.error) return { error: turno.error };

  try {
    const g = await pagarGasto(db, {
      gastoId,
      medio: medio.data,
      monetaryAccountId,
      cashSessionId: turno.cashSessionId ?? null,
      usuarioId: quien.usuarioId,
    });

    refrescar();
    return { ok: `Pagado ${formatearARS(g.montoCentavos)}.` };
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
  const turno = (await esCuentaDeEfectivo(origenId))
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
