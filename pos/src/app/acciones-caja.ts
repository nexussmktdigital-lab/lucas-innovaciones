'use server';

/**
 * Acciones de caja: abrir el turno y cerrarlo con arqueo.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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

  /*
   * El turno se cierra sin arqueo: el local no cuenta los billetes.
   *
   * No quedó un conteo opcional ni un campo escondido. Un arqueo que está pero
   * nadie hace es peor que no tenerlo: la columna se llena de ceros y después
   * alguien los lee como si significaran algo. Fue literalmente lo que pasó en
   * el POS viejo, donde el efectivo contado figuraba siempre en cero.
   *
   * `cerrarCaja` sin `saldoContadoCentavos` cierra con lo que el sistema
   * espera: diferencia cero, sin justificación y sin asiento de ajuste.
   */
  try {
    await cerrarCaja(db, {
      sesionId: abierta.id,
      usuarioId: sesion.user.id,
      nota: String(datos.get('nota') ?? '').trim() || null,
    });
  } catch (e) {
    if (e instanceof ErrorCaja) return { error: e.message };
    console.error('[caja] Falló el cierre:', e);
    return { error: 'No se pudo cerrar la caja.' };
  }

  revalidatePath('/caja');
  revalidatePath('/vender');
  revalidatePath('/');

  /*
   * Al cerrar se va al reporte del turno, no se vuelve a /caja con un cartel.
   *
   * Un `ok` en el estado de la acción no sobrevive a la revalidación: sin turno
   * abierto el formulario de cierre se desmonta entero y el cartel —con su
   * enlace al reporte— se va con él. Ya nos pasó dos veces. El redirect va
   * afuera del try porque `redirect` funciona lanzando.
   */
  redirect(`/caja/${abierta.id}`);
}

/**
 * Cuentas monetarias activas, para elegir sobre cuál se abre el turno.
 *
 * Pide sesión aunque solo devuelva nombres: todo lo que se exporta de un
 * archivo `'use server'` es un punto de entrada al que se le puede pegar desde
 * afuera, y los nombres de las cuentas dicen en qué banco trabaja el local.
 */
export async function cuentasActivas() {
  const sesion = await auth();
  if (!sesion?.user) return [];

  return db
    .select({ id: monetaryAccounts.id, nombre: monetaryAccounts.nombre, tipo: monetaryAccounts.tipo })
    .from(monetaryAccounts)
    .where(eq(monetaryAccounts.activo, true));
}
