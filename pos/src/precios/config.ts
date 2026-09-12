/**
 * El recargo de la tienda online, guardado en `settings`.
 *
 * Es un solo numero para todo el catalogo, en puntos basicos: 12% se guarda
 * como 1200. Va entero para no arrastrar decimales, igual que la plata.
 */
import { eq, sql } from 'drizzle-orm';
import { auditLog, products, settings } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import { validarRecargo } from './mostrador';

export const CLAVE_RECARGO = 'recargo_tienda_bp';

/** Cero mientras nadie lo configure: sin recargo, los dos precios coinciden. */
export async function recargoDeTienda(db: BaseDatos): Promise<number> {
  const [fila] = await db
    .select({ valor: settings.valor })
    .from(settings)
    .where(eq(settings.clave, CLAVE_RECARGO))
    .limit(1);

  const bp = Number(fila?.valor ?? 0);
  return Number.isInteger(bp) && bp >= 0 ? bp : 0;
}

export async function guardarRecargoDeTienda(
  db: BaseDatos,
  datos: { bp: number; usuarioId: string },
): Promise<number> {
  const bp = validarRecargo(datos.bp);

  return db.transaction(async (tx) => {
    const anterior = await recargoDeTienda(tx);

    await tx
      .insert(settings)
      .values({ clave: CLAVE_RECARGO, valor: bp, updatedBy: datos.usuarioId })
      .onConflictDoUpdate({
        target: settings.clave,
        set: { valor: bp, updatedAt: new Date(), updatedBy: datos.usuarioId },
      });

    // Cambiar este numero mueve el precio de todo el mostrador de una: tiene
    // que quedar quien lo hizo y desde que valor.
    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'precios.recargo_tienda',
      entidad: 'settings',
      valorAnterior: { bp: anterior },
      valorNuevo: { bp },
    });

    return bp;
  });
}

/** Cuantos productos alcanza el recargo y cuantos cobran el mismo precio. */
export async function alcanceDelRecargo(
  db: BaseDatos,
): Promise<{ conRecargo: number; soloMostrador: number; conPrecioPropio: number }> {
  const [r] = await db
    .select({
      soloMostrador: sql<number>`count(*) filter (where ${products.soloMostrador})`.mapWith(Number),
      conPrecioPropio:
        sql<number>`count(*) filter (where ${products.precioLocalCentavos} is not null)`.mapWith(
          Number,
        ),
      conRecargo:
        sql<number>`count(*) filter (where not ${products.soloMostrador} and ${products.precioLocalCentavos} is null)`.mapWith(
          Number,
        ),
    })
    .from(products)
    .where(eq(products.activo, true));

  return {
    conRecargo: r?.conRecargo ?? 0,
    soloMostrador: r?.soloMostrador ?? 0,
    conPrecioPropio: r?.conPrecioPropio ?? 0,
  };
}
