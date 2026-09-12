/**
 * Las plantillas guardadas, en `settings`.
 *
 * Van las tres cosas en una sola clave (`whatsapp`) porque se leen juntas en
 * cada pantalla que muestra un boton: una consulta en vez de tres.
 */
import { eq } from 'drizzle-orm';
import { auditLog, settings } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import {
  PLANTILLAS_POR_DEFECTO,
  validarPlantilla,
  type TipoDeMensaje,
} from './plantillas';

export const CLAVE = 'whatsapp';

/**
 * Cada cuantos dias se le puede volver a recordar la deuda al mismo cliente.
 *
 * Es el numero que separa «te aviso» de «te persigo». Una semana es el ritmo
 * del mostrador: el cliente cobra, pasa, paga. Se puede cambiar, pero no se
 * puede sacar.
 */
export const DIAS_POR_DEFECTO = 7;
export const DIAS_MAXIMO = 90;

export interface AjustesDeWhatsApp {
  comprobante: string;
  recordatorio_fiado: string;
  diasEntreRecordatorios: number;
}

function texto(valor: unknown, porDefecto: string): string {
  return typeof valor === 'string' && valor.trim().length > 0 ? valor : porDefecto;
}

/** Lo guardado, completado con los textos por defecto donde falte. */
export async function ajustesDeWhatsApp(db: BaseDatos): Promise<AjustesDeWhatsApp> {
  const [fila] = await db
    .select({ valor: settings.valor })
    .from(settings)
    .where(eq(settings.clave, CLAVE))
    .limit(1);

  const guardado = (fila?.valor ?? {}) as Partial<Record<string, unknown>>;
  const dias = Number(guardado.diasEntreRecordatorios);

  return {
    comprobante: texto(guardado.comprobante, PLANTILLAS_POR_DEFECTO.comprobante),
    recordatorio_fiado: texto(
      guardado.recordatorio_fiado,
      PLANTILLAS_POR_DEFECTO.recordatorio_fiado,
    ),
    diasEntreRecordatorios:
      Number.isInteger(dias) && dias >= 1 && dias <= DIAS_MAXIMO ? dias : DIAS_POR_DEFECTO,
  };
}

/** Guarda los textos. Se validan antes: un `{campo}` inventado no entra. */
export async function guardarAjustesDeWhatsApp(
  db: BaseDatos,
  datos: {
    plantillas: Record<TipoDeMensaje, string>;
    diasEntreRecordatorios: number;
    usuarioId: string;
  },
): Promise<AjustesDeWhatsApp> {
  for (const tipo of Object.keys(datos.plantillas) as TipoDeMensaje[]) {
    validarPlantilla(tipo, datos.plantillas[tipo]);
  }

  const dias = Math.min(Math.max(Math.trunc(datos.diasEntreRecordatorios), 1), DIAS_MAXIMO);

  const nuevo: AjustesDeWhatsApp = {
    comprobante: datos.plantillas.comprobante.trim(),
    recordatorio_fiado: datos.plantillas.recordatorio_fiado.trim(),
    diasEntreRecordatorios: dias,
  };

  return db.transaction(async (tx) => {
    const anterior = await ajustesDeWhatsApp(tx);

    await tx
      .insert(settings)
      .values({ clave: CLAVE, valor: nuevo, updatedBy: datos.usuarioId })
      .onConflictDoUpdate({
        target: settings.clave,
        set: { valor: nuevo, updatedAt: new Date(), updatedBy: datos.usuarioId },
      });

    // Cambiar el texto cambia lo que el local le dice a todos sus clientes:
    // queda quien lo cambio y desde que decia.
    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'whatsapp.plantillas',
      entidad: 'settings',
      valorAnterior: { ...anterior },
      valorNuevo: { ...nuevo },
    });

    return nuevo;
  });
}
