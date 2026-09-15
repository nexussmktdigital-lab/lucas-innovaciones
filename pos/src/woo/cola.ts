/**
 * Cola de sincronizacion hacia WooCommerce.
 *
 * Las ventas se confirman en la base del POS y el ajuste de stock viaja despues
 * por esta cola. Asi el mostrador nunca depende de que Woo responda rapido.
 *
 * **Como se ajusta el stock, y por que.** Se escribe el valor ABSOLUTO que el
 * POS tiene ahora mismo, no la resta. Tiene tres consecuencias buenas:
 *
 *  - Es idempotente: reintentar la misma operacion escribe el mismo numero.
 *  - Se cura sola: si una operacion anterior quedo a medias, la siguiente deja
 *    el valor correcto igual.
 *  - Es simple de razonar: Woo termina espejando al POS.
 *
 * Y una consecuencia a vigilar: si algo cambia el stock en Woo por fuera del
 * POS —hoy, un pedido web— esta escritura lo pisa. Mientras la tienda online no
 * venda no hay riesgo, y cuando venda los pedidos web van a reservar stock en
 * el POS por webhook. Igual, toda divergencia que se detecta al escribir queda
 * registrada en `sync_conflicts` para que se vea.
 */
import { z } from 'zod';
import { and, eq, lte, sql } from 'drizzle-orm';
import { productVariants, products, sales, syncConflicts, syncQueue } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import { ClienteWoo, ErrorWoo } from './cliente';

/** Cuántas veces se reintenta antes de dar la operación por fallida. */
export const MAXIMO_DE_INTENTOS = 6;

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
});

const payloadVenta = z.object({
  ventaId: z.string(),
  numero: z.string(),
  items: z.array(itemDeVenta),
});

const productoWoo = z.object({ id: z.number(), stock_quantity: z.number().nullish() }).loose();

export interface InformeDeDrenaje {
  procesadas: number;
  exitosas: number;
  fallidas: number;
  conflictos: number;
  errores: string[];
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
  opciones: { tope?: number; ahora?: Date } = {},
): Promise<InformeDeDrenaje> {
  const ahora = opciones.ahora ?? new Date();
  const informe: InformeDeDrenaje = {
    procesadas: 0,
    exitosas: 0,
    fallidas: 0,
    conflictos: 0,
    errores: [],
  };

  const pendientes = await db
    .select()
    .from(syncQueue)
    .where(and(eq(syncQueue.estado, 'pendiente'), lte(syncQueue.proximoIntento, ahora)))
    .orderBy(syncQueue.createdAt)
    .limit(opciones.tope ?? 25);

  for (const operacion of pendientes) {
    informe.procesadas += 1;
    try {
      if (operacion.operacion === 'venta.descontar_stock') {
        informe.conflictos += await sincronizarStockDeVenta(db, cliente, operacion.payload);
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
): Promise<number> {
  const payload = payloadVenta.parse(payloadCrudo);
  let conflictos = 0;

  for (const item of payload.items) {
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
    await drenarCola(db, cliente, { tope: 10 });
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
