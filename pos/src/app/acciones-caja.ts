'use server';

/**
 * Acciones de caja: abrir el turno y cerrarlo con arqueo.
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { monetaryAccounts } from '@/db/schema';
import { config } from '@/lib/config';
import { aCentavos, ErrorDinero } from '@/lib/dinero';
import { abrirCaja, cerrarCaja, ErrorCaja, sesionAbierta } from '@/caja/sesion';

export interface EstadoCaja {
  error?: string;
  ok?: string;
}

/** Lee un monto escrito por una persona ("20.000" o "20000,50") a centavos. */
function montoDelFormulario(datos: FormData, campo: string): number {
  const crudo = String(datos.get(campo) ?? '').trim();
  if (crudo === '') return 0;
  return aCentavos(crudo);
}

export async function abrirCajaAccion(
  _estado: EstadoCaja,
  datos: FormData,
): Promise<EstadoCaja> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'caja.abrir')) return { error: 'No tenés permiso para abrir la caja.' };

  let saldoInicialCentavos: number;
  try {
    saldoInicialCentavos = montoDelFormulario(datos, 'saldoInicial');
  } catch (e) {
    return { error: e instanceof ErrorDinero ? e.message : 'Monto inválido.' };
  }

  const cuentaId = z.string().uuid().safeParse(datos.get('monetaryAccountId'));
  if (!cuentaId.success) return { error: 'Elegí la caja sobre la que abrís el turno.' };

  try {
    await abrirCaja(db, {
      terminal: config().POS_TERMINAL,
      usuarioId: sesion.user.id,
      monetaryAccountId: cuentaId.data,
      saldoInicialCentavos,
    });
  } catch (e) {
    if (e instanceof ErrorCaja) return { error: e.message };
    console.error('[caja] Falló la apertura:', e);
    return { error: 'No se pudo abrir la caja.' };
  }

  revalidatePath('/caja');
  revalidatePath('/vender');
  return { ok: 'Caja abierta.' };
}

export async function cerrarCajaAccion(
  _estado: EstadoCaja,
  datos: FormData,
): Promise<EstadoCaja> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'caja.cerrar')) return { error: 'No tenés permiso para cerrar la caja.' };

  const abierta = await sesionAbierta(db, config().POS_TERMINAL);
  if (!abierta) return { error: 'No hay ninguna caja abierta.' };

  let saldoContadoCentavos: number;
  try {
    saldoContadoCentavos = montoDelFormulario(datos, 'saldoContado');
  } catch (e) {
    return { error: e instanceof ErrorDinero ? e.message : 'Monto inválido.' };
  }

  try {
    const cierre = await cerrarCaja(db, {
      sesionId: abierta.id,
      usuarioId: sesion.user.id,
      saldoContadoCentavos,
      justificacion: String(datos.get('justificacion') ?? '').trim() || null,
    });

    revalidatePath('/caja');
    revalidatePath('/vender');

    return {
      ok:
        cierre.diferenciaCentavos === 0
          ? 'Caja cerrada. Cuadró exacto.'
          : 'Caja cerrada con la diferencia justificada.',
    };
  } catch (e) {
    if (e instanceof ErrorCaja) return { error: e.message };
    console.error('[caja] Falló el cierre:', e);
    return { error: 'No se pudo cerrar la caja.' };
  }
}

/** Cuentas monetarias activas, para elegir sobre cuál se abre el turno. */
export async function cuentasActivas() {
  return db
    .select({ id: monetaryAccounts.id, nombre: monetaryAccounts.nombre, tipo: monetaryAccounts.tipo })
    .from(monetaryAccounts)
    .where(eq(monetaryAccounts.activo, true));
}
