/**
 * Buscador de la pantalla de venta.
 *
 * Corre contra el espejo local, no contra WooCommerce: la red no puede estar en
 * el camino entre que el cajero tipea y ve el resultado.
 *
 * Busca por nombre, SKU, marca, codigo de barras e IMEI. El IMEI no tiene campo
 * propio: en este catalogo viene dentro del titulo de los usados, asi que lo
 * cubre la busqueda por nombre.
 *
 * Sin acentos y sin distinguir mayusculas, con `translate` en vez de la
 * extension `unaccent`, que no esta garantizada en todos los PostgreSQL.
 */
import { sql } from 'drizzle-orm';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import { normalizar } from '@/lib/texto';

/** Cuántos resultados se muestran. Más que esto no entra en pantalla ni sirve. */
export const TOPE_RESULTADOS = 20;

export interface ResultadoBusqueda {
  id: string;
  variantId: string | null;
  nombre: string;
  sku: string | null;
  marca: string | null;
  categoria: string | null;
  codigoBarras: string | null;
  precioCentavos: number;
  moneda: 'ARS' | 'USD';
  precioUsdCentavos: number | null;
  stock: number;
  stockComprometido: number;
  gestionaStock: boolean;
  precioEditable: boolean;
  esServicio: boolean;
  imagenUrl: string | null;
  /** True si coincidió exactamente por código de barras o SKU. */
  exacto: boolean;
}

/** Quita acentos dentro de PostgreSQL, sin depender de la extensión unaccent. */
const SIN_ACENTOS = (columna: unknown) =>
  sql`translate(lower(${columna}), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc')`;

/**
 * Busca productos y variaciones.
 *
 * Ordena poniendo primero las coincidencias exactas de código de barras y SKU,
 * que es lo que dispara el lector, y después las de texto.
 */
export async function buscarProductos(
  db: BaseDatos,
  termino: string,
  opciones: { limite?: number; incluirSinStock?: boolean } = {},
): Promise<ResultadoBusqueda[]> {
  const limpio = normalizar(termino);
  if (limpio.length === 0) return [];

  const limite = opciones.limite ?? TOPE_RESULTADOS;
  const patron = `%${limpio}%`;
  // El stock de una variación con `gestiona_stock` propio es el suyo; el resto
  // —vidrios y fundas, que en Woo heredan del padre— cuentan contra el producto.
  const gestionaStock = sql`(CASE WHEN v.id IS NOT NULL AND v.gestiona_stock THEN true ELSE p.gestiona_stock END)`;
  const disponible = sql`(CASE WHEN v.id IS NOT NULL AND v.gestiona_stock THEN v.stock ELSE p.stock - p.stock_comprometido END)`;

  const filtroStock = opciones.incluirSinStock
    ? sql``
    : sql`AND (NOT ${gestionaStock} OR ${disponible} > 0)`;

  const crudas = filasDe<{
    id: string;
    variant_id: string | null;
    nombre: string;
    sku: string | null;
    marca: string | null;
    categoria: string | null;
    codigo_barras: string | null;
    precio_centavos: string | number;
    moneda: 'ARS' | 'USD';
    precio_usd_centavos: string | number | null;
    stock: number;
    stock_comprometido: number;
    gestiona_stock: boolean;
    precio_editable: boolean;
    es_servicio: boolean;
    imagen_url: string | null;
    exacto: boolean;
  }>(await db.execute(sql`
    SELECT
      p.id,
      v.id                                            AS variant_id,
      CASE WHEN v.id IS NULL THEN p.nombre
           ELSE p.nombre || ' — ' || v.nombre END     AS nombre,
      COALESCE(v.sku, p.sku)                          AS sku,
      p.marca,
      p.categoria,
      COALESCE(v.codigo_barras, p.codigo_barras)      AS codigo_barras,
      CASE WHEN v.id IS NULL THEN p.precio_centavos
           ELSE v.precio_centavos END                 AS precio_centavos,
      p.moneda,
      p.precio_usd_centavos,
      CASE WHEN v.id IS NOT NULL AND v.gestiona_stock THEN v.stock ELSE p.stock END AS stock,
      CASE WHEN v.id IS NOT NULL AND v.gestiona_stock THEN 0 ELSE p.stock_comprometido END
                                                      AS stock_comprometido,
      ${gestionaStock}                                AS gestiona_stock,
      p.precio_editable,
      p.es_servicio,
      p.imagen_url,
      (
        lower(COALESCE(v.codigo_barras, p.codigo_barras, '')) = ${limpio}
        OR lower(COALESCE(v.sku, p.sku, '')) = ${limpio}
      )                                               AS exacto
    FROM products p
    LEFT JOIN product_variants v ON v.product_id = p.id AND v.activo
    WHERE p.activo
      ${filtroStock}
      AND (
        ${SIN_ACENTOS(sql`p.nombre`)} LIKE ${patron}
        OR ${SIN_ACENTOS(sql`COALESCE(v.nombre, '')`)} LIKE ${patron}
        OR lower(COALESCE(p.sku, '')) LIKE ${patron}
        OR lower(COALESCE(v.sku, '')) LIKE ${patron}
        OR ${SIN_ACENTOS(sql`COALESCE(p.marca, '')`)} LIKE ${patron}
        OR lower(COALESCE(p.codigo_barras, '')) = ${limpio}
        OR lower(COALESCE(v.codigo_barras, '')) = ${limpio}
      )
    ORDER BY exacto DESC, length(p.nombre), p.nombre
    LIMIT ${limite}
  `));

  return (crudas as unknown as Record<string, unknown>[]).map((f) => ({
    id: String(f.id),
    variantId: f.variant_id === null ? null : String(f.variant_id),
    nombre: String(f.nombre),
    sku: f.sku === null ? null : String(f.sku),
    marca: f.marca === null ? null : String(f.marca),
    categoria: f.categoria === null ? null : String(f.categoria),
    codigoBarras: f.codigo_barras === null ? null : String(f.codigo_barras),
    precioCentavos: Number(f.precio_centavos),
    moneda: f.moneda as 'ARS' | 'USD',
    precioUsdCentavos: f.precio_usd_centavos === null ? null : Number(f.precio_usd_centavos),
    stock: Number(f.stock),
    stockComprometido: Number(f.stock_comprometido),
    gestionaStock: Boolean(f.gestiona_stock),
    precioEditable: Boolean(f.precio_editable),
    esServicio: Boolean(f.es_servicio),
    imagenUrl: f.imagen_url === null ? null : String(f.imagen_url),
    exacto: Boolean(f.exacto),
  }));
}

/**
 * Detecta la entrada de un lector de codigo de barras.
 *
 * El lector se comporta como un teclado: escupe todos los caracteres de golpe y
 * termina con Enter. Lo que lo distingue de una persona es la velocidad, no el
 * contenido: nadie tipea doce digitos en menos de cien milisegundos.
 */
export function pareceLectorDeCodigo(
  texto: string,
  msDesdeLaPrimeraTecla: number,
): boolean {
  if (texto.length < 6) return false;
  if (!/^[A-Za-z0-9\-_.]+$/.test(texto)) return false;
  const msPorCaracter = msDesdeLaPrimeraTecla / texto.length;
  return msPorCaracter < 35;
}
