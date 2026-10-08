/**
 * Repreciar lo que está en dólares cuando cambia la cotización.
 *
 * **El mostrador no necesita esto.** Un producto en dólares no tiene el precio
 * en pesos guardado: la venta lo calcula en el momento, `precio USD × dólar`
 * (ver `carrito.ts`). O sea que apenas entra una cotización nueva, el mostrador
 * ya cobra bien, sin tocar una sola ficha.
 *
 * **La web tampoco.** En WooCommerce la ficha en dólares guarda el precio en
 * dólares (meta `_li_moneda = USD`) y el plugin `li-dolar` le aplica la
 * cotización al renderizar. El número que la web publica se recalcula solo.
 *
 * Entonces qué reprecia esto: el **espejo** del POS. `products.precio_centavos`
 * de un producto en dólares es un valor calculado —dólares × cotización— que
 * usan las pantallas, el buscador, los listados y el orden por precio. Sin esta
 * corrida ese número se queda viejo hasta la próxima sincronización.
 *
 * Y lo que explícitamente **no** hace es empujar el precio a Woo. Mandarle
 * pesos a una ficha marcada en dólares la publicaría multiplicada otra vez por
 * la cotización: $1.280.000 leídos como US$ 1.280.000. Antes esto encolaba
 * `precio.empujar` por cada producto cambiado —54 escrituras por corrida— con
 * la convención vieja, en la que el POS creía que Woo guardaba pesos.
 *
 * **Solo se toca lo que de verdad cambió**, así que una corrida con el dólar
 * quieto no escribe una fila. El redondeo de `usdAPesos` a los mil pesos ayuda,
 * pero menos de lo que parece: en un usado de u$s745, un movimiento de $1,35 en
 * el dólar ya mueve el precio de mil pesos. Lo que mantiene esto barato es la
 * frecuencia —cada dos horas, no cada diez minutos— y que el catálogo en
 * dólares son los usados, que son pocos.
 */
import { eq, sql } from 'drizzle-orm';
import { products } from '@/db/schema';
import { filas, type BaseDatos } from '@/db/tipos';
import { usdAPesos } from '@/lib/dinero';

export interface Repreciado {
  /** Cuántos productos en dólares se miraron. */
  mirados: number;
  /** Cuántos cambiaron de precio en el espejo. */
  cambiados: number;
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
  }>(
    await db.execute(sql`
      SELECT id, nombre, precio_centavos, precio_usd_centavos
        FROM products
       WHERE moneda = 'USD'
         AND activo
         AND precio_usd_centavos IS NOT NULL
         AND precio_usd_centavos > 0
    `),
  );

  const informe: Repreciado = { mirados: enDolares.length, cambiados: 0 };

  for (const p of enDolares) {
    const nuevo = usdAPesos(Number(p.precio_usd_centavos), tcCentavos);
    if (nuevo <= 0 || nuevo === Number(p.precio_centavos)) continue;

    // Repreciar es idempotente —el precio sale de la cotización, no de sumar—
    // así que repetirlo no acumula nada.
    await db
      .update(products)
      .set({ precioCentavos: nuevo, updatedAt: new Date() })
      .where(eq(products.id, p.id));

    informe.cambiados += 1;
  }

  return informe;
}
