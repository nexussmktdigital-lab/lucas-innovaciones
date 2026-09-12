/**
 * Refresco del espejo local cuando WooCommerce avisa que cambio una ficha.
 *
 * Vive aparte de la ruta del webhook para poder probarlo contra una base de
 * verdad, sin levantar un servidor.
 */
import { eq } from 'drizzle-orm';
import { products, syncConflicts } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import { mapearProducto } from './mapear';
import { wooProducto } from './tipos';

export interface ResultadoRefresco {
  aplicado: boolean;
  /** True si Woo traia un stock distinto al del POS y quedo registrado. */
  divergencia: boolean;
  motivo?: string;
}

/**
 * Actualiza la ficha de un producto, **sin tocarle el stock**.
 *
 * El stock es la unica columna que el webhook no escribe, y es a proposito.
 * Cada venta del mostrador deja el ajuste en la cola y lo empuja a Woo; ese
 * mismo PUT hace que Woo dispare `product.updated` y nos devuelva la ficha. Si
 * aceptaramos ese stock, una venta hecha entre el descuento local y el ajuste
 * en Woo se perderia: el eco pisaria el numero nuevo con el viejo.
 *
 * El stock que viene de Woo —una carga a mano, un pedido web— entra por
 * `npm run woo:sync`, que es la reconciliacion explicita. Mientras tanto, si
 * los numeros no coinciden queda en `sync_conflicts` para que la divergencia se
 * vea en vez de resolverse sola y mal.
 */
export async function refrescarFichaDeProducto(
  db: BaseDatos,
  payload: unknown,
  tcCentavos: number | null,
): Promise<ResultadoRefresco> {
  const r = wooProducto.safeParse(payload);
  if (!r.success) {
    return { aplicado: false, divergencia: false, motivo: r.error.issues[0]?.message };
  }

  const { fila } = mapearProducto(r.data, tcCentavos);

  const [local] = await db
    .select({ id: products.id, stock: products.stock, gestionaStock: products.gestionaStock })
    .from(products)
    .where(eq(products.wooId, fila.wooId))
    .limit(1);

  await db
    .insert(products)
    .values({ ...fila, lastSyncedAt: new Date(), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: products.wooId,
      set: {
        sku: fila.sku,
        nombre: fila.nombre,
        marca: fila.marca,
        categoria: fila.categoria,
        precioCentavos: fila.precioCentavos,
        moneda: fila.moneda,
        precioUsdCentavos: fila.precioUsdCentavos,
        gestionaStock: fila.gestionaStock,
        codigoBarras: fila.codigoBarras,
        imagenUrl: fila.imagenUrl,
        activo: fila.activo,
        esServicio: fila.esServicio,
        soloMostrador: fila.soloMostrador,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
        // `stock` no se pisa: manda el POS. Ver el comentario de arriba.
      },
    });

  const divergencia = Boolean(
    local && local.gestionaStock && fila.gestionaStock && local.stock !== fila.stock,
  );

  if (divergencia && local) {
    await db.insert(syncConflicts).values({
      productId: local.id,
      stockPos: local.stock,
      stockWoo: fila.stock,
      detalle: { origen: 'webhook', topico: 'product.updated', nombre: fila.nombre },
    });
  }

  return { aplicado: true, divergencia };
}
