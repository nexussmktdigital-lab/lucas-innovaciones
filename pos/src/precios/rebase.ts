/**
 * Cambiar el recargo sin mover los precios del mostrador.
 *
 * El recargo no es un precio: es la diferencia entre lo que cobra la web y lo
 * que cobra el local. Pero como WooCommerce guarda el precio de la web (D31),
 * tocarlo solo mueve el otro lado de la resta —el mostrador—, que es
 * justamente el que no se quiso tocar.
 *
 * Eso pasó de verdad. El 21/10 el recargo fue de 0 a 15% para que la web
 * cubriera la comisión de Mercado Pago, y lo que ocurrió fue lo contrario: la
 * web siguió cobrando igual y el mostrador empezó a cobrar 13% menos, en cada
 * venta, durante dos días.
 *
 * Lo que hace esto: recalcula el precio de la web para que, con el recargo
 * nuevo, el mostrador siga cobrando lo mismo que antes.
 *
 *     mostrador = precio_web_viejo / (1 + recargo_viejo)   <- lo que se cobra hoy
 *     precio_web_nuevo = mostrador x (1 + recargo_nuevo)   <- lo que hay que guardar
 *
 * Quedan afuera tres grupos, y en los tres el precio de mostrador **y** el de
 * la web se quedan exactamente como están:
 *
 *  - **Solo mostrador.** No se publican: su precio ya es el del local y el
 *    recargo nunca los tocó.
 *  - **En dólares.** Su precio en pesos sale de la cotización y lo reescribe
 *    el repreciado cada dos horas; cualquier número que escribiéramos acá
 *    dura hasta la próxima corrida.
 *  - **Con precio de mostrador propio.** Ese campo fija el precio del local,
 *    así que el recargo tampoco los mueve. Su precio de web pudo haberse
 *    puesto a mano por algo; se listan aparte para mirarlos de a uno.
 *
 * El redondeo a los cien pesos no es reversible al centavo: ir a 15% y volver
 * a 0 puede correr un precio hasta $100. Es el precio de que el mostrador
 * cobre números redondos.
 */
import { sql } from 'drizzle-orm';
import { auditLog, syncQueue } from '@/db/schema';
import { filas, type BaseDatos } from '@/db/tipos';
import { precioDeMostrador, precioDeTienda, type Recargo } from './mostrador';

export interface CambioDePrecio {
  id: string;
  nombre: string;
  wooId: number | null;
  /** El precio de la web de ahora. */
  antesCentavos: number;
  /** El que hay que guardar para que el mostrador no se mueva. */
  despuesCentavos: number;
  /** Lo que cobra el local, que es lo que no cambia. */
  mostradorCentavos: number;
}

interface FilaProducto {
  id: string;
  nombre: string;
  woo_id: number | null;
  precio_centavos: string | number;
}

/**
 * Qué precios habría que reescribir. No escribe nada: es para mirar antes.
 *
 * El cálculo se repite igual dentro de la transacción que aplica, sobre lo que
 * haya en ese momento. Esta lista es para decidir, no la que se guarda.
 */
export async function calcularRebase(
  db: BaseDatos,
  bpAnterior: Recargo,
  bpNuevo: Recargo,
): Promise<CambioDePrecio[]> {
  if (bpAnterior === bpNuevo) return [];

  const crudas = filas<FilaProducto>(
    await db.execute(sql`
      SELECT id, nombre, woo_id, precio_centavos
        FROM products
       WHERE activo
         AND NOT solo_mostrador
         AND precio_local_centavos IS NULL
         AND moneda = 'ARS'
         AND precio_centavos > 0
       ORDER BY nombre
    `),
  );

  const cambios: CambioDePrecio[] = [];
  for (const f of crudas) {
    const antesCentavos = Number(f.precio_centavos);
    const mostradorCentavos = precioDeMostrador(
      {
        precioCentavos: antesCentavos,
        precioLocalCentavos: null,
        soloMostrador: false,
        enDolares: false,
      },
      bpAnterior,
    );
    const despuesCentavos = precioDeTienda(mostradorCentavos, bpNuevo);
    if (despuesCentavos === antesCentavos) continue;

    cambios.push({
      id: String(f.id),
      nombre: String(f.nombre),
      wooId: f.woo_id === null ? null : Number(f.woo_id),
      antesCentavos,
      despuesCentavos,
      mostradorCentavos,
    });
  }
  return cambios;
}

/**
 * Escribe los precios nuevos y los manda a la tienda.
 *
 * Va dentro de la misma transacción que guarda el recargo, y no es un detalle:
 * el recargo guardado sin los precios reescritos es exactamente el error del
 * 21/10, y los precios reescritos sin el recargo guardado cobran de más en el
 * mostrador. O las dos cosas o ninguna.
 */
export async function aplicarRebase(
  tx: BaseDatos,
  cambios: readonly CambioDePrecio[],
  datos: { bpAnterior: Recargo; bpNuevo: Recargo; usuarioId: string },
): Promise<number> {
  if (cambios.length === 0) return 0;

  /*
   * Un UPDATE solo y no uno por producto: son ochocientas filas y cada ida y
   * vuelta a la base se paga en tiempo de transacción, con todo el catálogo
   * bloqueado mientras tanto.
   */
  const valores = sql.join(
    cambios.map((c) => sql`(${c.id}::uuid, ${c.despuesCentavos}::bigint)`),
    sql`, `,
  );
  await tx.execute(sql`
    UPDATE products AS p
       SET precio_centavos = v.nuevo, updated_at = now()
      FROM (VALUES ${valores}) AS v(id, nuevo)
     WHERE p.id = v.id
  `);

  // A la tienda, o la web sigue cobrando el viejo hasta que alguien toque esa
  // ficha. La cola relee el precio al drenar, así que basta con el id.
  const aEmpujar = cambios.filter((c) => c.wooId !== null);
  if (aEmpujar.length > 0) {
    const sello = Date.now();
    await tx.insert(syncQueue).values(
      aEmpujar.map((c) => ({
        operacion: 'precio.empujar' as const,
        idempotencyKey: `rebase:${sello}:${c.id}`,
        payload: { productId: c.id, wooId: c.wooId },
      })),
    );
  }

  /*
   * Una sola entrada con todos los precios de antes. Son ochocientos números
   * en un jsonb, y es lo que hace falta para poder volver atrás: el redondeo
   * a cien pesos no se deshace solo recalculando al revés.
   */
  await tx.insert(auditLog).values({
    usuarioId: datos.usuarioId,
    accion: 'precios.rebase_recargo',
    entidad: 'products',
    valorAnterior: {
      bp: datos.bpAnterior,
      precios: cambios.map((c) => [c.id, c.antesCentavos]),
    },
    valorNuevo: {
      bp: datos.bpNuevo,
      productos: cambios.length,
      precios: cambios.map((c) => [c.id, c.despuesCentavos]),
    },
  });

  return cambios.length;
}
