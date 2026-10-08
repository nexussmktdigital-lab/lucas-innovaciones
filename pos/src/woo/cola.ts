/**
 * Cola de sincronizacion hacia WooCommerce.
 *
 * Las ventas se confirman en la base del POS y el ajuste de stock viaja despues
 * por esta cola. Asi el mostrador nunca depende de que Woo responda rapido.
 *
 * **Como se ajusta el stock, y por que.** Se manda la DIFERENCIA (`delta`:
 * -2 una venta de dos, +1 una devolucion) al endpoint `wc-li/v1/stock/ajustar`
 * del plugin li-tienda, que resta o suma del lado de WooCommerce.
 *
 * Antes se escribia el valor ABSOLUTO que tenia el POS. Era idempotente y
 * simple, pero pisaba todo lo que cambiara el stock en Woo por fuera del POS:
 * con la tienda online vendiendo, un pedido web entre medio volvia a aparecer
 * disponible —con un usado, que es unico, es venderlo dos veces—. El endpoint:
 *
 *  - Es atomico: `stock = stock - n` en una consulta, como los pedidos web.
 *  - Es idempotente: cada operacion lleva la referencia `cola:{id de la fila}`
 *    y Woo recuerda las ya aplicadas, asi que reintentar no resta dos veces.
 *
 * Las filas encoladas antes de este cambio no traen `delta` y siguen por el
 * camino viejo (valor absoluto) para no perderse. Toda divergencia que se ve al
 * escribir queda en `sync_conflicts`: es el lugar donde mirar si Woo y el POS
 * dejan de coincidir.
 */
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { productVariants, products, sales, syncConflicts, syncQueue } from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
// El driver de producción no acepta un `Date` como parámetro de una consulta
// escrita a mano, aunque PGlite —el de los tests— lo acepte. Va como ISO.
import { instante } from '@/reportes/periodo';
import { ClienteWoo, ErrorWoo } from './cliente';
import { cuerpoDePrecioParaWoo } from './mapear';

/** Cuántas veces se reintenta antes de dar la operación por fallida. */
export const MAXIMO_DE_INTENTOS = 6;

/**
 * Cuánto se espera antes de volver a tomar una operación que quedó tomada.
 *
 * Es el caso del proceso que se corta a la mitad: en un entorno sin servidor la
 * función se apaga cuando la respuesta sale, y si eso pasa entre que se toma la
 * fila y que se termina de procesarla, la fila queda en «procesando» sin nadie
 * detrás. Cinco minutos son de sobra para el drenaje más lento y poco para que
 * una venta se quede sin llegar a la tienda.
 */
export const MINUTOS_PARA_RETOMAR = 5;

/** Espera entre reintentos: 1, 2, 4, 8, 16, 32 minutos. */
export function esperaTrasIntento(intentos: number): number {
  return Math.min(2 ** intentos, 32) * 60_000;
}

const itemDeVenta = z.object({
  productId: z.string(),
  /** Id de Woo del producto. En una variación, el del padre. */
  wooId: z.number(),
  /** Presentes solo cuando el stock lo lleva la variación y no el producto. */
  variantId: z.string().nullish(),
  variantWooId: z.number().nullish(),
  cantidad: z.number(),
  stockResultante: z.number(),
  /** Cuánto cambia el stock: negativo en una venta, positivo al reponer. */
  delta: z.number().optional(),
});

const payloadVenta = z.object({
  ventaId: z.string(),
  numero: z.string(),
  items: z.array(itemDeVenta),
});

const productoWoo = z.object({ id: z.number(), stock_quantity: z.number().nullish() }).loose();

/** Respuesta del endpoint de ajuste de li-tienda. */
const respuestaAjuste = z.object({
  ref: z.string(),
  items: z.array(
    z.object({
      i: z.number(),
      estado: z.enum(['aplicado', 'ya_aplicado', 'sin_control', 'no_existe']),
      stock: z.number().nullable(),
    }),
  ),
});

/** Ruta del ajuste por diferencia (plugin li-tienda, autenticado con la clave de Woo). */
export const RUTA_AJUSTE_STOCK = 'wc-li/v1/stock/ajustar';

/**
 * Resta o suma stock en Woo. Devuelve, por item y en el mismo orden, el stock
 * que quedó en Woo (o null si el producto no lleva control de stock allá).
 */
async function ajustarEnWoo(
  cliente: ClienteWoo,
  ref: string,
  items: { wooId: number; variantWooId?: number | null; delta: number }[],
): Promise<(number | null)[]> {
  const r = await cliente.enviar(
    'POST',
    RUTA_AJUSTE_STOCK,
    {
      ref,
      items: items.map((x) => ({
        product_id: x.wooId,
        ...(x.variantWooId ? { variation_id: x.variantWooId } : {}),
        delta: x.delta,
      })),
    },
    respuestaAjuste,
  );
  const porIndice = new Map(r.items.map((x) => [x.i, x.stock]));
  return items.map((_, i) => porIndice.get(i) ?? null);
}

export interface InformeDeDrenaje {
  procesadas: number;
  exitosas: number;
  fallidas: number;
  conflictos: number;
  errores: string[];
  /** True si se corto por tiempo y quedaron operaciones sin procesar. */
  cortadoPorTiempo: boolean;
}

/**
 * Procesa las operaciones pendientes cuyo momento de reintento ya llegó.
 *
 * Se llama después de confirmar una venta y, en producción, desde la tarea
 * programada que pega en `/api/cron/sincronizar` por si alguna quedó trabada.
 */
export async function drenarCola(
  db: BaseDatos,
  cliente: ClienteWoo,
  opciones: {
    tope?: number;
    ahora?: Date;
    /**
     * Cuánto tiempo se le da al drenaje antes de cortar, en milisegundos.
     *
     * No es una optimización: es lo que evita que la función se muera a la
     * mitad. Cada operación son un GET y un PUT contra WooCommerce, que corre
     * en un hosting compartido; con el timeout y los reintentos del cliente,
     * **una sola** puede tardar un minuto. Cincuenta de esas no entran en
     * ninguna función sin servidor, así que se hace lo que entra y el resto
     * queda para la próxima corrida. Es una cola: no hace falta vaciarla de un
     * saque, hace falta que nunca se trabe.
     */
    presupuestoMs?: number;
  } = {},
): Promise<InformeDeDrenaje> {
  const ahora = opciones.ahora ?? new Date();
  const informe: InformeDeDrenaje = {
    procesadas: 0,
    exitosas: 0,
    fallidas: 0,
    conflictos: 0,
    errores: [],
    cortadoPorTiempo: false,
  };

  const hastaCuando = opciones.presupuestoMs
    ? performance.now() + opciones.presupuestoMs
    : Number.POSITIVE_INFINITY;

  /*
   * Las operaciones se **toman** antes de procesarlas, en un solo UPDATE
   * atómico con `SKIP LOCKED`, y no se leen con un SELECT suelto.
   *
   * El drenaje corre desde dos lados a la vez: después de cada venta y cada
   * diez minutos por la tarea programada. Con un SELECT, dos corridas
   * simultáneas se llevan las mismas filas. Para el stock daba igual —lo que se
   * le escribe a Woo es el stock que el POS tiene ahora, así que escribirlo dos
   * veces escribe el mismo número— pero **publicar un producto no es
   * idempotente**: la guarda de `publicarProducto` es un `if (wooId === null)`
   * leído antes de hacer el POST, así que las dos corridas la pasan y el
   * producto queda creado dos veces en la tienda.
   *
   * `SKIP LOCKED` hace que la segunda corrida no espere: se lleva otras filas o
   * ninguna, que es lo que se quiere en un drenaje.
   */
  const limite = opciones.tope ?? 25;
  // El tipo se escribe a mano con los nombres que devuelve la base: un
  // `RETURNING *` de una consulta escrita a mano trae las columnas como estan
  // en PostgreSQL, no como las nombra Drizzle.
  const pendientes = filasDe<{
    id: string;
    operacion: string;
    payload: unknown;
    intentos: number;
  }>(
    await db.execute(sql`
      UPDATE sync_queue
         SET estado = 'procesando', updated_at = ${instante(ahora)}
       WHERE id IN (
         SELECT id FROM sync_queue
          WHERE (estado = 'pendiente' AND proximo_intento <= ${instante(ahora)})
             -- Una corrida que se murió a la mitad —el proceso que se corta
             -- cuando la respuesta sale— deja la fila tomada para siempre. Se
             -- vuelve a tomar pasado un rato: peor que reintentarla es que se
             -- quede esperando a alguien que ya no existe.
             OR (estado = 'procesando' AND updated_at < ${instante(new Date(ahora.getTime() - MINUTOS_PARA_RETOMAR * 60_000))})
          ORDER BY created_at
          LIMIT ${limite}
            FOR UPDATE SKIP LOCKED
       )
      RETURNING *
    `),
  );

  for (const [indice, operacion] of pendientes.entries()) {
    if (performance.now() >= hastaCuando) {
      /*
       * Se acabó el tiempo. Lo que quedó tomado y sin procesar vuelve a
       * «pendiente» ahora mismo, en vez de esperar los cinco minutos del
       * rescate: se sabe que nadie lo está procesando porque el que lo tomó es
       * este mismo código, y acá está, decidiendo cortar.
       */
      const sinProcesar = pendientes.slice(indice).map((o) => o.id);
      await db.execute(sql`
        UPDATE sync_queue SET estado = 'pendiente', updated_at = ${instante(new Date())}
         WHERE id IN (${sql.join(
           sinProcesar.map((id) => sql`${id}`),
           sql`, `,
         )})
      `);
      informe.cortadoPorTiempo = true;
      break;
    }

    informe.procesadas += 1;
    try {
      if (operacion.operacion === 'venta.descontar_stock') {
        informe.conflictos += await sincronizarStockDeVenta(db, cliente, operacion.payload, operacion.id);
      } else if (operacion.operacion === 'stock.empujar') {
        informe.conflictos += await empujarStock(db, cliente, operacion.payload, operacion.id);
      } else if (operacion.operacion === 'precio.empujar') {
        await empujarPrecio(db, cliente, operacion.payload);
      } else if (operacion.operacion === 'producto.baja') {
        await empujarBaja(cliente, operacion.payload);
      } else if (operacion.operacion === 'producto.publicar') {
        // El recargo se lee acá y no al encolar: si el dueño lo cambió entre
        // que pidió publicar y que la cola drenó, vale el de ahora.
        const { publicarProducto } = await import('@/catalogo/publicar');
        const { recargoDeTienda } = await import('@/precios/config');
        await publicarProducto(db, cliente, operacion.payload, await recargoDeTienda(db));
      } else {
        throw new Error(`Operación desconocida: ${operacion.operacion}`);
      }

      await db
        .update(syncQueue)
        .set({ estado: 'ok', ultimoError: null, updatedAt: ahora })
        .where(eq(syncQueue.id, operacion.id));
      informe.exitosas += 1;
    } catch (error) {
      const intentos = operacion.intentos + 1;
      const agotado = intentos >= MAXIMO_DE_INTENTOS;
      const mensaje = error instanceof Error ? error.message : String(error);

      await db
        .update(syncQueue)
        .set({
          estado: agotado ? 'fallido' : 'pendiente',
          intentos,
          proximoIntento: new Date(ahora.getTime() + esperaTrasIntento(intentos)),
          ultimoError: mensaje.slice(0, 1000),
          updatedAt: ahora,
        })
        .where(eq(syncQueue.id, operacion.id));

      informe.fallidas += 1;
      informe.errores.push(mensaje);
    }
  }

  return informe;
}

/** Devuelve cuántas divergencias se detectaron al escribir. */
async function sincronizarStockDeVenta(
  db: BaseDatos,
  cliente: ClienteWoo,
  payloadCrudo: unknown,
  operacionId: string,
): Promise<number> {
  const payload = payloadVenta.parse(payloadCrudo);
  let conflictos = 0;

  // Camino nuevo: los items con `delta` van todos juntos al ajuste por diferencia.
  const conDelta = payload.items.filter((x) => x.delta !== undefined && x.delta !== 0);
  if (conDelta.length > 0) {
    const enWoo = await ajustarEnWoo(
      cliente,
      `cola:${operacionId}`,
      conDelta.map((x) => ({ wooId: x.wooId, variantWooId: x.variantWooId, delta: x.delta! })),
    );
    for (const [i, item] of conDelta.entries()) {
      const stockEnWoo = enWoo[i];
      if (stockEnWoo === null || stockEnWoo === undefined) continue;
      const local = await stockLocal(db, item.productId, item.variantId);
      if (local !== null && local !== stockEnWoo) {
        // No se corrige nada: Woo ya quedó bien (restó lo que vendió el POS sin
        // pisar lo demás). Se anota para que se vea: lo normal es que sea un
        // pedido web que el POS todavía no importó.
        await db.insert(syncConflicts).values({
          productId: item.productId,
          stockPos: local,
          stockWoo: stockEnWoo,
          detalle: { venta: payload.numero, delta: item.delta, tras: 'ajuste' },
        });
        conflictos += 1;
      }
    }
  }

  // Camino viejo, solo para filas encoladas antes del cambio (sin `delta`).
  for (const item of payload.items.filter((x) => x.delta === undefined)) {
    // El valor que se escribe es el que el POS tiene AHORA, no el que tenía
    // cuando se hizo la venta: si hubo más ventas en el medio, esto las lleva
    // todas de una y el resultado sigue siendo correcto.
    //
    // Una variación se lee y se escribe en su propio recurso de Woo: el stock
    // del producto padre no la representa.
    const esVariacion = Boolean(item.variantId && item.variantWooId);
    const recurso = esVariacion
      ? `products/${item.wooId}/variations/${item.variantWooId}`
      : `products/${item.wooId}`;

    const local = esVariacion
      ? (
          await db
            .select({ stock: productVariants.stock, nombre: productVariants.nombre })
            .from(productVariants)
            .where(eq(productVariants.id, item.variantId!))
            .limit(1)
        )[0]
      : (
          await db
            .select({ stock: products.stock, nombre: products.nombre })
            .from(products)
            .where(eq(products.id, item.productId))
            .limit(1)
        )[0];

    if (!local) continue;

    const enWoo = await cliente.obtener(recurso, productoWoo);
    const stockEnWoo = enWoo.stock_quantity ?? 0;

    if (stockEnWoo !== item.stockResultante && stockEnWoo !== local.stock) {
      // Woo tiene un número que no esperábamos: algo lo movió por fuera del POS.
      // Se registra y se sigue: el POS manda, pero la divergencia queda a la vista.
      await db.insert(syncConflicts).values({
        productId: item.productId,
        stockPos: local.stock,
        stockWoo: stockEnWoo,
        detalle: {
          venta: payload.numero,
          esperadoEnWoo: item.stockResultante,
          cantidadVendida: item.cantidad,
        },
      });
      conflictos += 1;
    }

    if (stockEnWoo !== local.stock) {
      await cliente.enviar('PUT', recurso, { stock_quantity: local.stock }, productoWoo);
    }
  }

  await db
    .update(sales)
    .set({ syncedToWoo: true })
    .where(eq(sales.id, payload.ventaId));

  return conflictos;
}

/** Stock que el POS tiene ahora de un producto o variación; null si ya no está. */
async function stockLocal(
  db: BaseDatos,
  productId: string,
  variantId?: string | null,
): Promise<number | null> {
  const [fila] = variantId
    ? await db
        .select({ stock: productVariants.stock })
        .from(productVariants)
        .where(eq(productVariants.id, variantId))
        .limit(1)
    : await db
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
  return fila ? Number(fila.stock) : null;
}

/** Lo que necesita cualquier operación que empuja un producto: cuál, y su id de Woo. */
const payloadDeProducto = z.object({
  productId: z.string(),
  wooId: z.number(),
  /** Solo en `stock.empujar`: cuánto se sumó. Sin esto, camino viejo (absoluto). */
  delta: z.number().optional(),
});
/** Lo único que se le pide a la respuesta: que sea el producto que se tocó. */
const respuestaDeProducto = z.object({ id: z.number() }).loose();

/**
 * Lleva a la tienda el stock que el POS tiene ahora, sin venta detrás.
 *
 * Lo usa la entrada de mercadería desde el mostrador. Hace falta porque la
 * sincronización del catálogo pisa el stock con el de Woo: si el POS suma diez
 * unidades y no se lo cuenta a la tienda, el próximo `woo:sync` las borra.
 *
 * Es la misma idea que el ajuste de una venta —se escribe el valor ABSOLUTO, así
 * que reintentar no suma dos veces— pero sin tocar `sales`: acá no hay ninguna
 * venta que marcar como sincronizada, y esa era la única razón por la que no se
 * podía reusar aquella.
 */
async function empujarStock(
  db: BaseDatos,
  cliente: ClienteWoo,
  payloadCrudo: unknown,
  operacionId: string,
): Promise<number> {
  const payload = payloadDeProducto.parse(payloadCrudo);

  // Camino nuevo: se suma la diferencia en Woo, sin pisar lo que vendió la web.
  if (payload.delta !== undefined) {
    if (payload.delta !== 0) {
      await ajustarEnWoo(cliente, `cola:${operacionId}`, [{ wooId: payload.wooId, delta: payload.delta }]);
    }
    return 0;
  }

  const [local] = await db
    .select({ stock: products.stock, nombre: products.nombre })
    .from(products)
    .where(eq(products.id, payload.productId))
    .limit(1);

  // El producto se borró del espejo entre que se encoló y que drenó: no hay
  // nada que empujar y no es un error que valga reintentar.
  if (!local) return 0;

  const recurso = `products/${payload.wooId}`;
  const enWoo = await cliente.obtener(recurso, productoWoo);
  const stockEnWoo = enWoo.stock_quantity ?? 0;

  if (stockEnWoo === local.stock) return 0;

  /*
   * Acá NO se registra conflicto cuando los números difieren, y es a propósito:
   * difieren siempre. Es la condición normal de esta operación —el POS acaba de
   * sumar unidades que Woo todavía no tiene— y anotarlo llenaría la tabla de
   * conflictos de ruido, justo la que se mira para detectar los de verdad.
   */
  await cliente.enviar('PUT', recurso, { stock_quantity: local.stock }, productoWoo);
  return 0;
}

/**
 * Lleva a la tienda el precio que el POS tiene ahora.
 *
 * Misma razón que el stock, con una consecuencia más cara: si el precio nuevo
 * no llega a la web, la tienda sigue cobrando el viejo —plata que se pierde en
 * cada pedido— y encima la próxima sincronización devuelve la ficha al precio
 * anterior, porque el espejo copia lo que dice Woo.
 *
 * Lo que viaja es el precio de **ficha**, que es el de la tienda: el POS ya hizo
 * la cuenta del recargo al guardarlo. Y se lee de la base al drenar, no del
 * payload: si el precio cambió dos veces antes de que la cola corriera, lo que
 * llega a la web es el último, que es el correcto. Por eso también es
 * idempotente —reintentar escribe el mismo número— igual que el stock.
 *
 * Un producto en dólares viaja **en dólares**, con su marca al lado: es la
 * convención del plugin, y la arma `cuerpoDePrecioParaWoo` en un solo lugar
 * para que leer y escribir no puedan discrepar.
 */
async function empujarPrecio(
  db: BaseDatos,
  cliente: ClienteWoo,
  payloadCrudo: unknown,
): Promise<void> {
  const payload = payloadDeProducto.parse(payloadCrudo);

  const [local] = await db
    .select({
      precioCentavos: products.precioCentavos,
      moneda: products.moneda,
      precioUsdCentavos: products.precioUsdCentavos,
    })
    .from(products)
    .where(eq(products.id, payload.productId))
    .limit(1);

  // El producto se borró del espejo entre que se encoló y que drenó: no hay
  // nada que empujar y no es un error que valga reintentar.
  if (!local) return;

  await cliente.enviar(
    'PUT',
    `products/${payload.wooId}`,
    cuerpoDePrecioParaWoo(local),
    respuestaDeProducto,
  );
}

/**
 * Pasa el producto a borrador en la tienda: es la baja del catálogo.
 *
 * No se usa el DELETE de la API a propósito. La ficha está pegada a las ventas
 * viejas y a la rentabilidad de los meses pasados, y lo que se pidió es que el
 * producto no se venda más, no que nunca haya existido. Borrador lo saca de la
 * web, hace que la sincronización lo traiga inactivo —`activo: status ===
 * 'publish'`— y se puede deshacer.
 *
 * Es idempotente: pasar a borrador algo que ya es borrador no cambia nada.
 */
async function empujarBaja(cliente: ClienteWoo, payloadCrudo: unknown): Promise<void> {
  const { wooId } = payloadDeProducto.parse(payloadCrudo);
  await cliente.enviar('PUT', `products/${wooId}`, { status: 'draft' }, respuestaDeProducto);
}

/**
 * Cuántas operaciones esperan sincronización.
 *
 * Es el número que la pantalla muestra al cajero: si crece y no baja, algo
 * pasa con WooCommerce y hay que mirarlo antes de que la divergencia sea grande.
 */
export async function pendientesDeSincronizar(
  db: BaseDatos,
): Promise<{ pendientes: number; fallidas: number }> {
  const [r] = await db
    .select({
      pendientes: sql<number>`count(*) filter (where ${syncQueue.estado} = 'pendiente')`.mapWith(Number),
      fallidas: sql<number>`count(*) filter (where ${syncQueue.estado} = 'fallido')`.mapWith(Number),
    })
    .from(syncQueue);

  return { pendientes: r?.pendientes ?? 0, fallidas: r?.fallidas ?? 0 };
}

/**
 * Drena la cola sin dejar que un fallo tumbe lo que la llamó.
 * Se usa justo después de confirmar una venta: la venta ya está firme.
 */
export async function drenarEnSegundoPlano(db: BaseDatos): Promise<void> {
  try {
    const cliente = ClienteWoo.desdeEntorno();
    // Corto a propósito: esto corre pegado a una venta y lo que no entre lo
    // levanta la tarea programada. Que el mostrador espere por WooCommerce es
    // exactamente lo que la cola existe para evitar.
    await drenarCola(db, cliente, { tope: 10, presupuestoMs: 8_000 });
  } catch (error) {
    if (error instanceof ErrorWoo) {
      console.warn('[cola] WooCommerce no disponible, queda pendiente:', error.message);
      return;
    }
    console.error('[cola] Fallo drenando la cola:', error);
  }
}

/**
 * Vuelve a poner en cola las operaciones que agotaron los reintentos.
 *
 * Sin esto, una operacion que fallo seis veces quedaba muerta: el cajero veia
 * el contador «N sin sincronizar» crecer y no habia forma de hacer nada con ese
 * numero. Se usa despues de arreglar lo que fallaba —Woo caido, una clave
 * vencida— para que el proximo drenaje las levante.
 */
export async function reintentarFallidas(db: BaseDatos, ahora = new Date()): Promise<number> {
  const revividas = await db
    .update(syncQueue)
    // El error viejo se limpia: la operacion arranca de cero y si vuelve a
    // fallar, el mensaje que se vea va a ser el de ahora y no el de ayer.
    .set({
      estado: 'pendiente',
      intentos: 0,
      proximoIntento: ahora,
      ultimoError: null,
      updatedAt: ahora,
    })
    .where(eq(syncQueue.estado, 'fallido'))
    .returning({ id: syncQueue.id });

  return revividas.length;
}

export interface OperacionEnCola {
  id: string;
  operacion: string;
  estado: 'pendiente' | 'procesando' | 'ok' | 'fallido';
  intentos: number;
  proximoIntento: Date | null;
  ultimoError: string | null;
  createdAt: Date;
  /** Numero de venta al que corresponde, si el payload lo trae. */
  numero: string | null;
}

/** Lo que espera o fallo, de lo mas viejo a lo mas nuevo. */
export async function operacionesEnCola(
  db: BaseDatos,
  limite = 50,
): Promise<OperacionEnCola[]> {
  const filas = await db
    .select()
    .from(syncQueue)
    .where(sql`${syncQueue.estado} IN ('pendiente', 'procesando', 'fallido')`)
    .orderBy(syncQueue.createdAt)
    .limit(limite);

  return filas.map((f) => ({
    id: f.id,
    operacion: f.operacion,
    estado: f.estado,
    intentos: f.intentos,
    proximoIntento: f.proximoIntento,
    ultimoError: f.ultimoError,
    createdAt: f.createdAt,
    numero:
      typeof (f.payload as { numero?: unknown })?.numero === 'string'
        ? String((f.payload as { numero: string }).numero)
        : null,
  }));
}
