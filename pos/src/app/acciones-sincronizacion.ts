'use server';

/**
 * Acciones de la cola hacia WooCommerce.
 *
 * El contador «N sin sincronizar» que ve el cajero no servia de nada si no
 * habia forma de hacer algo con ese numero. Estas dos acciones son esa forma.
 */
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { auditar } from '@/lib/auditoria';
import { ClienteWoo, ErrorWoo } from '@/woo/cliente';
import { drenarCola, reintentarFallidas } from '@/woo/cola';

export interface EstadoSincronizacion {
  error?: string;
  ok?: string;
}

function refrescar() {
  revalidatePath('/sincronizacion');
  revalidatePath('/');
  revalidatePath('/caja');
  revalidatePath('/vender');
}

/** Pasa la cola ahora mismo, sin esperar a la próxima venta ni al cron. */
export async function sincronizarAhoraAccion(): Promise<EstadoSincronizacion> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'configuracion.editar')) {
    return { error: 'Esto lo hace el dueño.' };
  }

  try {
    const cliente = ClienteWoo.desdeEntorno();
    const informe = await drenarCola(db, cliente, { tope: 50 });

    if (informe.procesadas === 0) return { ok: 'No había nada esperando.' };

    const partes = [`${informe.exitosas} de ${informe.procesadas} sincronizadas`];
    if (informe.fallidas > 0) partes.push(`${informe.fallidas} fallaron`);
    if (informe.conflictos > 0) {
      partes.push(
        `${informe.conflictos} con el stock distinto en WooCommerce (quedó registrado)`,
      );
    }

    return { ok: `${partes.join(', ')}.` };
  } catch (error) {
    if (error instanceof ErrorWoo) {
      return { error: `WooCommerce no responde: ${error.message}` };
    }
    console.error('[sync] Falló el drenaje manual:', error);
    return { error: 'No se pudo sincronizar.' };
  } finally {
    refrescar();
  }
}

/**
 * Devuelve a la cola lo que agotó los seis reintentos.
 *
 * Se usa después de arreglar lo que fallaba: Woo caído, una clave vencida, el
 * hosting que no respondía.
 */
export async function reintentarFallidasAccion(): Promise<EstadoSincronizacion> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'configuracion.editar')) {
    return { error: 'Esto lo hace el dueño.' };
  }

  const revividas = await reintentarFallidas(db);

  if (revividas === 0) {
    refrescar();
    return { ok: 'No hay ninguna fallida.' };
  }

  await auditar(db, {
    usuarioId: sesion.user.id,
    accion: 'sync.reintentar_fallidas',
    entidad: 'sync_queue',
    valorNuevo: { revividas },
  });

  // Y se intenta de una: esperar al próximo drenaje no aporta nada.
  const r = await sincronizarAhoraAccion();
  refrescar();

  return {
    ok: `${revividas} ${revividas === 1 ? 'operación devuelta' : 'operaciones devueltas'} a la cola. ${r.ok ?? ''}`.trim(),
    error: r.error,
  };
}
