'use server';

/**
 * Acciones de WhatsApp.
 *
 * El enlace se arma en el servidor y viaja dentro del `href`: el clic abre
 * WhatsApp de una, sin esperar una respuesta. Si el navegador tuviera que
 * esperar a que el servidor conteste para recien despues abrir la ventana,
 * Safari lo tomaria como pop-up y lo bloquearia.
 *
 * Lo que si va al servidor al hacer clic es la constancia, y se arma de nuevo
 * ahi: lo que queda guardado es el texto que el sistema genero, no uno que
 * mando el navegador.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { guardarAjustesDeWhatsApp, DIAS_MAXIMO } from '@/whatsapp/config';
import { armar, registrarPreparado } from '@/whatsapp/mensajes';
import { ErrorPlantilla, type TipoDeMensaje } from '@/whatsapp/plantillas';

export interface EstadoWhatsApp {
  error?: string;
  ok?: string;
}

const tipos = z.enum([
  'comprobante',
  'recordatorio_fiado',
  'recordatorio_cuota',
  'recordatorio_atrasado',
]);

/**
 * Deja constancia de que se abrio el chat con el mensaje puesto.
 *
 * No dice «enviado» en ningun lado y no es casual: quien aprieta enviar es la
 * persona, y el sistema no tiene forma de saber si lo hizo.
 */
export async function registrarPreparadoAccion(
  tipo: TipoDeMensaje,
  referenciaId: string,
): Promise<EstadoWhatsApp> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };

  if (!tipos.safeParse(tipo).success) return { error: 'Ese tipo de mensaje no existe.' };
  if (!z.string().uuid().safeParse(referenciaId).success) {
    return { error: 'No se reconoce a quién iba el mensaje.' };
  }

  try {
    const p = await armar(db, tipo, referenciaId);
    if (!p.listo) return { error: p.motivo };

    await registrarPreparado(db, { mensaje: p.mensaje, usuarioId: sesion.user.id });

    revalidatePath('/fiado');
    revalidatePath('/mensajes');
    revalidatePath(`/clientes/${p.mensaje.clienteId}`);

    return { ok: 'Quedó anotado.' };
  } catch (error) {
    // El chat ya se abrio: que falle la constancia no puede romperle la pantalla
    // a nadie. Se avisa despacio y se sigue.
    console.error('[whatsapp] No se pudo anotar el mensaje:', error);
    return { error: 'El chat se abrió, pero no se pudo dejar la constancia.' };
  }
}

/** Guarda los textos y cada cuánto se puede recordar una deuda. */
export async function guardarPlantillasAccion(
  _previo: EstadoWhatsApp,
  datos: FormData,
): Promise<EstadoWhatsApp> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'configuracion.editar')) {
    return { error: 'Los textos de WhatsApp los cambia el dueño.' };
  }

  const dias = Number(String(datos.get('dias') ?? ''));
  if (!Number.isInteger(dias) || dias < 1 || dias > DIAS_MAXIMO) {
    return { error: `Los días entre recordatorios van de 1 a ${DIAS_MAXIMO}.` };
  }

  const plantillas: Record<TipoDeMensaje, string> = {
    comprobante: String(datos.get('comprobante') ?? ''),
    recordatorio_fiado: String(datos.get('recordatorio_fiado') ?? ''),
    recordatorio_cuota: String(datos.get('recordatorio_cuota') ?? ''),
    recordatorio_atrasado: String(datos.get('recordatorio_atrasado') ?? ''),
  };

  try {
    await guardarAjustesDeWhatsApp(db, {
      plantillas,
      diasEntreRecordatorios: dias,
      usuarioId: sesion.user.id,
    });

    revalidatePath('/mensajes');
    return { ok: 'Textos guardados.' };
  } catch (error) {
    if (error instanceof ErrorPlantilla) return { error: error.message };
    console.error('[whatsapp] Falló al guardar las plantillas:', error);
    return { error: 'No se pudieron guardar los textos.' };
  }
}
