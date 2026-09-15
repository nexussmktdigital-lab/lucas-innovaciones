/**
 * Publicar en la tienda un producto que nació en el mostrador.
 *
 * El alta rápida deja el producto vendible en el local y fuera de la web, que
 * es lo correcto mientras la ficha esté a medias. Esto es el paso de después:
 * alguien mira la ficha, decide que ya está, y recién ahí el producto sale a la
 * tienda online.
 *
 * Va por la cola, como el stock de una venta: si WooCommerce no contesta, el
 * pedido queda encolado y se reintenta solo. El mostrador nunca se entera.
 *
 * **Se publica con `status: publish`, no como borrador.** Parece más prudente
 * mandarlo a borrador, pero la sincronización traduce `status` a `activo`, así
 * que un borrador vuelve de la próxima sincronización como producto inactivo y
 * desaparece del buscador del mostrador. Un producto que se publica, se publica.
 *
 * **El precio que se manda es el de la tienda, no el del mostrador** (D31).
 * WooCommerce guarda lo que la web cobra de verdad, con el recargo que cubre la
 * comisión de Mercado Pago. El precio de mostrador queda guardado aparte, en
 * `precioLocalCentavos`, que la sincronización no pisa.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { auditLog, products, syncQueue } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import type { ClienteWoo } from '@/woo/cliente';
import { precioDeTienda } from '@/precios/mostrador';
import { normalizar } from '@/lib/texto';

export class ErrorPublicar extends Error {}

export const payloadPublicacion = z.object({ productId: z.string().uuid() });

/**
 * Encola la publicación. No habla con WooCommerce: eso lo hace la cola.
 *
 * La clave de idempotencia es el id del producto, así que pedir dos veces que
 * se publique el mismo producto encola una sola operación.
 */
export async function encolarPublicacion(
  db: BaseDatos,
  productId: string,
  usuarioId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [producto] = await tx
      .select({ id: products.id, nombre: products.nombre, wooId: products.wooId })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!producto) throw new ErrorPublicar('No se encuentra ese producto.');
    if (producto.wooId !== null) {
      throw new ErrorPublicar(`«${producto.nombre}» ya está en la tienda online.`);
    }

    await tx
      .insert(syncQueue)
      .values({
        operacion: 'producto.publicar',
        idempotencyKey: `producto:${productId}`,
        payload: { productId },
      })
      .onConflictDoNothing({ target: syncQueue.idempotencyKey });

    await tx.insert(auditLog).values({
      usuarioId,
      accion: 'producto.publicar_pedido',
      entidad: 'products',
      entidadId: productId,
      valorNuevo: { nombre: producto.nombre },
    });
  });
}

/** Lo que WooCommerce devuelve al crear un producto. Solo hace falta el id. */
const respuestaAlta = z.object({ id: z.number().int().positive() }).loose();

const categoriaWoo = z.object({ id: z.number().int(), name: z.string() }).loose();

/**
 * Crea el producto en WooCommerce y guarda el `wooId` que devuelve.
 *
 * La llama la cola. Es la única operación del POS que **crea** algo en Woo: lo
 * demás solo lee o corrige stock.
 */
export async function publicarProducto(
  db: BaseDatos,
  cliente: ClienteWoo,
  payloadCrudo: unknown,
  recargoTiendaBp: number,
): Promise<void> {
  const { productId } = payloadPublicacion.parse(payloadCrudo);

  const [p] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!p) throw new ErrorPublicar(`El producto ${productId} ya no existe.`);

  // Si ya tiene id de Woo, alguien lo publicó por otro lado. No se duplica.
  if (p.wooId !== null) return;

  const mostradorCentavos = p.precioLocalCentavos ?? p.precioCentavos;
  const tiendaCentavos = precioDeTienda(mostradorCentavos, recargoTiendaBp);

  const cuerpo: Record<string, unknown> = {
    name: p.nombre,
    type: 'simple',
    status: 'publish',
    catalog_visibility: 'visible',
    regular_price: (tiendaCentavos / 100).toFixed(2),
    manage_stock: p.gestionaStock,
    sku: p.sku ?? '',
  };

  if (p.gestionaStock) cuerpo.stock_quantity = p.stock;
  if (p.codigoBarras) cuerpo.global_unique_id = p.codigoBarras;

  const categoriaId = await idDeCategoria(cliente, p.categoria);
  if (categoriaId !== null) cuerpo.categories = [{ id: categoriaId }];

  const creado = await cliente.enviar('POST', 'products', cuerpo, respuestaAlta);

  await db.transaction(async (tx) => {
    await tx
      .update(products)
      .set({
        wooId: creado.id,
        // Ya está en la tienda: deja de ser solo mostrador, y su precio de Woo
        // pasa a ser el de la tienda. El de mostrador sigue en
        // `precioLocalCentavos`, que la sincronización no toca.
        soloMostrador: false,
        precioCentavos: tiendaCentavos,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(products.id, productId));

    await tx.insert(auditLog).values({
      usuarioId: null,
      accion: 'producto.publicado',
      entidad: 'products',
      entidadId: productId,
      valorNuevo: {
        wooId: creado.id,
        nombre: p.nombre,
        precioTiendaCentavos: tiendaCentavos,
        precioMostradorCentavos: mostradorCentavos,
      },
    });
  });
}

/**
 * Busca la categoría en WooCommerce por nombre, y la crea si no está.
 *
 * El POS guarda la categoría como texto suelto —no hay tabla de categorías— y
 * WooCommerce las quiere por id. Antes de inventar una nueva se busca entre las
 * que ya existen, comparando sin acentos ni mayúsculas: el catálogo real mezcla
 * «Servicio técnico» con «SERVICIO TECNICO» y duplicar categorías por un acento
 * sería empeorar justo lo que esta fase vino a ordenar.
 */
async function idDeCategoria(cliente: ClienteWoo, nombre: string | null): Promise<number | null> {
  const limpio = (nombre ?? '').trim();
  if (limpio === '') return null;

  const buscada = normalizar(limpio);
  const pagina = await cliente.listar('products/categories', categoriaWoo, {
    search: limpio,
    per_page: 20,
  });

  const existente = pagina.datos.find((c) => normalizar(c.name) === buscada);
  if (existente) return existente.id;

  const creada = await cliente.enviar('POST', 'products/categories', { name: limpio }, categoriaWoo);
  return creada.id;
}
