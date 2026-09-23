/**
 * El espejo del catálogo, refrescado solo, sin depender de los webhooks.
 *
 * Los webhooks de WooCommerce son la forma natural de enterarse de un cambio de
 * precio: la tienda avisa en el momento. Pero el aviso lo manda el servidor de
 * WordPress con `curl`, y si ese servidor no puede validar el certificado del
 * POS —el hosting de Lucas rechaza los certificados ECDSA por tener el nivel de
 * seguridad de OpenSSL demasiado alto— el webhook no se puede ni dar de alta.
 *
 * Así que se da vuelta la dirección: en vez de que la tienda avise, **el POS
 * pregunta**. Cada diez minutos, junto con el drenaje de la cola, pide a
 * WooCommerce solo lo que cambió desde la última vez. Con el catálogo de 803
 * productos eso es una consulta que casi siempre devuelve cero filas.
 *
 * Tres decisiones que conviene tener presentes:
 *
 *  - **La marca de agua se guarda, y solo avanza si la corrida terminó.** Si el
 *    refresco se corta por tiempo, la marca queda donde estaba y la corrida
 *    siguiente vuelve a pedir la misma ventana. Perder un cambio de precio es
 *    peor que pedirlo dos veces.
 *  - **La ventana lleva un margen de seis horas.** `modified_after` se manda en
 *    UTC con `dates_are_gmt`, pero hay versiones de WooCommerce que ignoran esa
 *    bandera y leen la fecha en el huso del sitio. Acá eso serían tres horas de
 *    corrimiento, justo en la dirección que deja productos afuera. Seis horas de
 *    margen lo cubren, y el costo de pedir de más es una consulta vacía.
 *  - **Un producto borrado del todo en Woo no aparece por acá.** Una ficha que
 *    se manda a la papelera sí —cambia de estado y se marca inactiva—, pero una
 *    borrada definitivamente no figura en ninguna listada. Eso lo resuelve
 *    `npm run woo:sync`, que compara contra el catálogo entero.
 */
import { eq, sql } from 'drizzle-orm';
import { settings } from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import type { ClienteWoo } from './cliente';
import { sincronizarCatalogo, type InformeSincronizacion } from './sincronizar';

/** Dónde vive la marca de agua. */
const CLAVE = 'woo.ultimo_refresco';

/** El margen que absorbe un huso horario mal interpretado del otro lado. */
export const MARGEN_MS = 6 * 60 * 60 * 1000;

export interface InformeRefresco {
  /** False cuando no había desde dónde arrancar: no se hizo nada. */
  corrio: boolean;
  /** Desde cuándo se pidieron los cambios, margen ya aplicado. */
  desde: Date | null;
  motivo?: string;
  sincronizacion?: InformeSincronizacion;
}

/** Lee la marca de agua guardada. `null` la primera vez. */
async function marcaDeAgua(db: BaseDatos): Promise<Date | null> {
  const [fila] = await db
    .select({ valor: settings.valor })
    .from(settings)
    .where(eq(settings.clave, CLAVE))
    .limit(1);

  const crudo = (fila?.valor as { instante?: string } | undefined)?.instante;
  if (!crudo) return null;
  const fecha = new Date(crudo);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

async function guardarMarca(db: BaseDatos, instante: Date): Promise<void> {
  await db
    .insert(settings)
    .values({ clave: CLAVE, valor: { instante: instante.toISOString() } })
    .onConflictDoUpdate({
      target: settings.clave,
      set: { valor: sql`excluded.valor`, updatedAt: sql`now()` },
    });
}

/**
 * De dónde arranca la primera corrida, cuando todavía no hay marca guardada.
 *
 * El catálogo ya está sincronizado desde antes de que existiera este refresco,
 * así que la última vez que se tocó una ficha es el punto de partida correcto.
 * Con la base vacía no hay nada que refrescar y se dice por qué.
 */
async function ultimaSincronizacion(db: BaseDatos): Promise<Date | null> {
  const [fila] = filasDe<{ cuando: string | Date | null }>(
    await db.execute(sql`SELECT MAX(last_synced_at) AS cuando FROM products`),
  );
  return fila?.cuando ? new Date(fila.cuando) : null;
}

export async function refrescarCatalogo(
  db: BaseDatos,
  cliente: ClienteWoo,
  opciones: { tcCentavos?: number | null; limiteMs?: number } = {},
): Promise<InformeRefresco> {
  // Se toma ANTES de pedir nada: lo que cambie mientras corre el refresco entra
  // en la ventana de la corrida siguiente, en vez de perderse en el hueco.
  const arranque = new Date();

  const guardada = await marcaDeAgua(db);
  const referencia = guardada ?? (await ultimaSincronizacion(db));

  if (!referencia) {
    return {
      corrio: false,
      desde: null,
      motivo:
        'No hay catálogo todavía. Corré `npm run woo:sync` una vez y el refresco sigue solo.',
    };
  }

  const desde = new Date(referencia.getTime() - MARGEN_MS);

  const sincronizacion = await sincronizarCatalogo(db, cliente, {
    tcCentavos: opciones.tcCentavos ?? null,
    modificadoDesde: desde,
    limiteMs: opciones.limiteMs,
  });

  if (!sincronizacion.incompleto) await guardarMarca(db, arranque);

  return { corrio: true, desde, sincronizacion };
}
