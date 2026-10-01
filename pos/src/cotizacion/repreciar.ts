/**
 * Repreciar lo que está en dólares cuando cambia la cotización.
 *
 * **El mostrador no necesita esto.** Un producto en dólares no tiene el precio
 * en pesos guardado: la venta lo calcula en el momento, `precio USD × dólar`
 * (ver `carrito.ts`). O sea que apenas entra una cotización nueva, el mostrador
 * ya cobra bien, sin tocar una sola ficha.
 *
 * **La web sí.** WooCommerce guarda un número en pesos, y ese número lo
 * recalculaba el plugin `lucas-cotizacion`, que es justamente el que dejó de
 * funcionar. Sin esto, el POS cobraría el precio nuevo y la tienda seguiría
 * publicando el viejo: con el dólar subiendo, se vende por la web a pérdida.
 *
 * Así que esto recalcula el precio de ficha de cada producto en dólares y lo
 * manda a la tienda por la cola de siempre (`precio.empujar`), que lee el valor
 * de la base al drenar y por lo tanto es idempotente.
 *
 * **Solo se toca lo que de verdad cambió**, así que una corrida con el dólar
 * quieto no escribe una fila. El redondeo de `usdAPesos` a los mil pesos ayuda,
 * pero menos de lo que parece: en un usado de u$s745, un movimiento de $1,35 en
 * el dólar ya mueve el precio de mil pesos. Lo que mantiene esto barato es la
 * frecuencia —cada dos horas, no cada diez minutos— y que el catálogo en
 * dólares son los usados, que son pocos.
 */
import { eq, sql } from 'drizzle-orm';
import { products, syncQueue } from '@/db/schema';
import { filas, type BaseDatos } from '@/db/tipos';
import { usdAPesos } from '@/lib/dinero';

export interface Repreciado {
  /** Cuántos productos en dólares se miraron. */
  mirados: number;
  /** Cuántos cambiaron de precio. */
  cambiados: number;
  /** Cuántos se mandaron a la tienda. Los que no están en Woo no se encolan. */
  encolados: number;
}

export async function repreciarEnDolares(
  db: BaseDatos,
  tcCentavos: number,
): Promise<Repreciado> {
  if (!Number.isInteger(tcCentavos) || tcCentavos <= 0) {
    throw new Error(`Cotización inválida para repreciar: ${tcCentavos}`);
  }

  const enDolares = filas<{
    id: string;
    nombre: string;
    precio_centavos: string | number;
    precio_usd_centavos: string | number | null;
    woo_id: number | null;
  }>(
    await db.execute(sql`
      SELECT id, nombre, precio_centavos, precio_usd_centavos, woo_id
        FROM products
       WHERE moneda = 'USD'
         AND activo
         AND precio_usd_centavos IS NOT NULL
         AND precio_usd_centavos > 0
    `),
  );

  const informe: Repreciado = { mirados: enDolares.length, cambiados: 0, encolados: 0 };

  for (const p of enDolares) {
    const nuevo = usdAPesos(Number(p.precio_usd_centavos), tcCentavos);
    if (nuevo <= 0 || nuevo === Number(p.precio_centavos)) continue;

    /*
     * Cada producto en su propia transacción, igual que el resto del catálogo:
     * si uno falla, los demás ya quedaron bien y la corrida siguiente retoma
     * desde donde esté. Repreciar es idempotente —el precio sale de la
     * cotización, no de sumar— así que repetirlo no acumula nada.
     */
    await db.transaction(async (tx) => {
      await tx
        .update(products)
        .set({ precioCentavos: nuevo, updatedAt: new Date() })
        .where(eq(products.id, p.id));

      if (p.woo_id !== null) {
        await tx.insert(syncQueue).values({
          operacion: 'precio.empujar',
          /*
           * La clave lleva la hora, y no solo el producto y el precio.
           * `idempotency_key` es único, y el dólar vuelve sobre sus pasos: sube
           * el martes y baja al mismo valor el jueves. Con la clave armada solo
           * con el precio, esa segunda vez choca contra el índice y la
           * transacción se cae — y con ella el repreciado del producto.
           *
           * Encolar dos veces no hace daño: `precio.empujar` lee el precio de
           * la base al drenar, así que las dos escriben el mismo número.
           */
          idempotencyKey: `precio:usd:${p.id}:${nuevo}:${Date.now()}`,
          payload: { productId: p.id, wooId: p.woo_id },
        });
        informe.encolados += 1;
      }
    });

    informe.cambiados += 1;
  }

  return informe;
}
