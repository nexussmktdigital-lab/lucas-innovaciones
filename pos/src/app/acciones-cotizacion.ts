'use server';

/**
 * Carga manual del tipo de cambio.
 *
 * El valor normalmente lo pone el plugin de WooCommerce dos veces por día. Esto
 * es para cuando la fuente falla o hay que forzar un valor: solo el dueño, y
 * queda auditado con su nombre.
 */
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { aCentavos, ErrorDinero } from '@/lib/dinero';
import { ErrorCotizacion, registrarCotizacion } from '@/cotizacion/cotizacion';

export interface EstadoCotizacionForm {
  error?: string;
  ok?: string;
  /** True cuando el error es un salto grande y se puede insistir. */
  pideConfirmacion?: boolean;
}

export async function cargarCotizacion(
  _estado: EstadoCotizacionForm,
  datos: FormData,
): Promise<EstadoCotizacionForm> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'cotizacion.cambiar')) {
    return { error: 'Solo el dueño puede cambiar el tipo de cambio.' };
  }

  let valorCentavos: number;
  try {
    valorCentavos = aCentavos(String(datos.get('valor') ?? '').trim());
  } catch (e) {
    return { error: e instanceof ErrorDinero ? e.message : 'Monto inválido.' };
  }

  try {
    await registrarCotizacion(db, {
      valorCentavos,
      origen: 'manual',
      usuarioId: sesion.user.id,
      confirmarSalto: datos.get('confirmarSalto') === 'si',
    });
  } catch (e) {
    if (e instanceof ErrorCotizacion) {
      return { error: e.message, pideConfirmacion: e.message.includes('confirmala') };
    }
    console.error('[cotizacion] Falló la carga:', e);
    return { error: 'No se pudo guardar la cotización.' };
  }

  revalidatePath('/cotizacion');
  revalidatePath('/vender');
  revalidatePath('/');
  return { ok: 'Cotización actualizada.' };
}
