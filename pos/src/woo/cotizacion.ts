/**
 * Lectura del tipo de cambio.
 *
 * La fuente de verdad es el plugin `lucas-cotizacion` de WooCommerce (D22): el
 * POS no cotiza, solo espeja el valor y lo congela en cada venta.
 *
 * Dos caminos, en este orden:
 *  1. El endpoint `li-cotizacion/v1/actual` del plugin.
 *  2. Si el plugin todavia no esta desplegado, la meta `_li_cotizacion_aplicada`
 *     de cualquier producto en dolares.
 */
import { z } from 'zod';
import { desc } from 'drizzle-orm';
import { exchangeRates } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import type { ClienteWoo } from './cliente';
import { wooProducto } from './tipos';
import { meta } from './tipos';
import { META_COTIZACION_APLICADA, META_PRECIO_USD } from './mapear';

export interface Cotizacion {
  valorCentavos: number;
  vigenteDesde: Date;
  origen: 'infodolar' | 'dolarapi' | 'manual';
}

const respuestaPlugin = z.object({
  venta: z.number().positive(),
  fuente: z.string().optional(),
  ts: z.number().optional(),
});

/** Pide la cotizacion al plugin. Devuelve null si el endpoint no existe todavia. */
export async function cotizacionDesdeWoo(cliente: ClienteWoo): Promise<Cotizacion | null> {
  try {
    const crudo = await cliente.obtener('li-cotizacion/v1/actual', respuestaPlugin);
    return {
      valorCentavos: Math.round(crudo.venta * 100),
      vigenteDesde: crudo.ts ? new Date(crudo.ts * 1000) : new Date(),
      origen: crudo.fuente === 'dolarapi' ? 'dolarapi' : 'infodolar',
    };
  } catch {
    return cotizacionDesdeProductos(cliente);
  }
}

/** Camino de respaldo: lee la meta que el plugin deja en cada producto en USD. */
async function cotizacionDesdeProductos(cliente: ClienteWoo): Promise<Cotizacion | null> {
  try {
    const pagina = await cliente.listar('products', wooProducto, { per_page: 20, search: 'iPhone' });
    for (const p of pagina.datos) {
      if (meta(p, META_PRECIO_USD) === undefined) continue;
      const aplicada = meta(p, META_COTIZACION_APLICADA);
      const n = Number(aplicada);
      if (Number.isFinite(n) && n > 0) {
        return { valorCentavos: Math.round(n * 100), vigenteDesde: new Date(), origen: 'infodolar' };
      }
    }
  } catch {
    /* sin red o sin credenciales: se resuelve con la ultima cotizacion guardada */
  }
  return null;
}

/** Ultima cotizacion guardada en el POS. */
export async function cotizacionVigente(db: BaseDatos): Promise<number | null> {
  const filas = await db
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.vigenteDesde))
    .limit(1);
  return filas[0]?.valorCentavos ?? null;
}
