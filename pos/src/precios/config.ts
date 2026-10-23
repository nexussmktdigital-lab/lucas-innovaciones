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
import { aplicarRebase, calcularRebase } from './rebase';

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
  datos: {
    bp: number;
    usuarioId: string;
    /**
     * Reescribir los precios de la web para que el mostrador cobre lo mismo
     * que antes. Ver `rebase.ts`: sin esto, subir el recargo baja los precios
     * del local, que casi nunca es lo que se quiso hacer.
     */
    mantenerMostrador?: boolean;
  },
): Promise<{ bp: number; reajustados: number }> {
  const bp = validarRecargo(datos.bp);

  return db.transaction(async (tx) => {
    const anterior = await recargoDeTienda(tx);

    /*
     * Dentro de la transacción y recalculando: la vista previa pudo haberse
     * armado hace un minuto y, en el medio, alguien cambió un precio desde la
     * ficha. Vale lo que hay ahora.
     */
    const reajustados = datos.mantenerMostrador
      ? await aplicarRebase(tx, await calcularRebase(tx, anterior, bp), {
          bpAnterior: anterior,
          bpNuevo: bp,
          usuarioId: datos.usuarioId,
        })
      : 0;

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
      valorNuevo: { bp, mantenerMostrador: Boolean(datos.mantenerMostrador), reajustados },
    });

    return { bp, reajustados };
  });
}

/**
 * Cuantos productos alcanza el recargo y cuantos cobran el mismo precio.
 *
 * Las categorias son excluyentes y en este orden, el mismo que usa
 * `precioDeMostrador`: primero el precio propio, que pisa todo; despues solo
 * mostrador y dolares, que no llevan recargo; el resto si.
 */
export async function alcanceDelRecargo(db: BaseDatos): Promise<{
  conRecargo: number;
  soloMostrador: number;
  conPrecioPropio: number;
  enDolares: number;
}> {
  const propio = sql`${products.precioLocalCentavos} is not null`;
  const [r] = await db
    .select({
      conPrecioPropio: sql<number>`count(*) filter (where ${propio})`.mapWith(Number),
      soloMostrador:
        sql<number>`count(*) filter (where not ${propio} and ${products.soloMostrador})`.mapWith(
          Number,
        ),
      enDolares:
        sql<number>`count(*) filter (where not ${propio} and not ${products.soloMostrador} and ${products.moneda} = 'USD')`.mapWith(
          Number,
        ),
      conRecargo:
        sql<number>`count(*) filter (where not ${propio} and not ${products.soloMostrador} and ${products.moneda} = 'ARS')`.mapWith(
          Number,
        ),
    })
    .from(products)
    .where(eq(products.activo, true));

  return {
    conRecargo: r?.conRecargo ?? 0,
    soloMostrador: r?.soloMostrador ?? 0,
    conPrecioPropio: r?.conPrecioPropio ?? 0,
    enDolares: r?.enDolares ?? 0,
  };
}
