/**
 * Formas de los datos que devuelve la REST API v3 de WooCommerce.
 *
 * Se validan con Zod porque el catalogo real esta sucio: hay precios vacios,
 * SKU faltantes (93 productos) y stock ficticio. Preferimos que falle una
 * ficha y se registre, a meter basura en la base.
 */
import { z } from 'zod';

/** Convierte el precio de Woo (string tipo "5000.00", a veces "") a centavos. */
export function precioACentavos(valor: unknown): number {
  if (valor === null || valor === undefined || valor === '') return 0;
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

const metaDato = z.object({
  key: z.string(),
  value: z.unknown(),
});

const imagen = z.object({
  src: z.string().optional(),
});

const termino = z.object({
  id: z.number().optional(),
  name: z.string(),
  slug: z.string().optional(),
});

export const wooProducto = z
  .object({
    id: z.number(),
    name: z.string(),
    slug: z.string().optional(),
    /*
     * Obligatorio a propósito, cuando casi todo lo demás tiene valor por
     * defecto.
     *
     * De este campo depende que un producto conserve o pierda sus variaciones.
     * Con `.default('simple')`, una respuesta que no lo trajera aplanaría el
     * catálogo entero sin que nadie se entere: seiscientas variaciones dadas de
     * baja por un campo que no llegó. Prefiero que la ficha se descarte y quede
     * el aviso en la consola, que es la política declarada de este archivo.
     */
    type: z.string(),
    status: z.string().default('publish'),
    catalog_visibility: z.string().default('visible'),
    sku: z.string().nullish(),
    global_unique_id: z.string().nullish(),
    price: z.union([z.string(), z.number()]).nullish(),
    regular_price: z.union([z.string(), z.number()]).nullish(),
    manage_stock: z.union([z.boolean(), z.string()]).default(false),
    stock_quantity: z.number().nullish(),
    stock_status: z.string().default('instock'),
    categories: z.array(termino).default([]),
    brands: z.array(termino).default([]),
    images: z.array(imagen).default([]),
    meta_data: z.array(metaDato).default([]),
  })
  .loose();

export type WooProducto = z.infer<typeof wooProducto>;

export const wooVariacion = z
  .object({
    id: z.number(),
    sku: z.string().nullish(),
    global_unique_id: z.string().nullish(),
    price: z.union([z.string(), z.number()]).nullish(),
    regular_price: z.union([z.string(), z.number()]).nullish(),
    /**
     * En una variacion puede venir `true`, `false` o el string `"parent"`, que
     * significa «lo maneja el producto padre». Solo `true` es stock propio.
     */
    manage_stock: z.union([z.boolean(), z.string()]).default(false),
    stock_quantity: z.number().nullish(),
    status: z.string().default('publish'),
    attributes: z
      .array(z.object({ name: z.string().optional(), option: z.string().optional() }))
      .default([]),
  })
  .loose();

export type WooVariacion = z.infer<typeof wooVariacion>;

/** Busca un valor en `meta_data` por clave. */
export function meta(producto: { meta_data: { key: string; value: unknown }[] }, clave: string) {
  return producto.meta_data.find((m) => m.key === clave)?.value;
}
