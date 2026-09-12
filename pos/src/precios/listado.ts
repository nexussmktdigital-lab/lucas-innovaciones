/**
 * Listado de precios para la pantalla del dueno.
 *
 * Muestra, uno al lado del otro, lo que cobra la tienda y lo que cobra el
 * mostrador. Es la pantalla donde se decide un precio, asi que no filtra por
 * stock ni por calidad de ficha: estan todos.
 */
import { sql } from 'drizzle-orm';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import { normalizar } from '@/lib/texto';
import { precioDeMostrador } from './mostrador';

export const TOPE_LISTADO = 50;

export interface PrecioDeProducto {
  id: string;
  nombre: string;
  sku: string | null;
  categoria: string | null;
  moneda: 'ARS' | 'USD';
  precioUsdCentavos: number | null;
  /** Lo que cobra la tienda online. Es el precio que vive en WooCommerce. */
  precioTiendaCentavos: number;
  /** Lo que se cobra en el local: calculado, o escrito a mano. */
  precioMostradorCentavos: number;
  /** El precio escrito a mano, si lo tiene. */
  precioLocalCentavos: number | null;
  soloMostrador: boolean;
  variaciones: number;
}

export interface Listado {
  productos: PrecioDeProducto[];
  total: number;
}

export async function listarPrecios(
  db: BaseDatos,
  opciones: { q?: string; recargoTiendaBp?: number; limite?: number } = {},
): Promise<Listado> {
  const limpio = normalizar(opciones.q ?? '');
  const recargoBp = opciones.recargoTiendaBp ?? 0;
  const limite = opciones.limite ?? TOPE_LISTADO;
  const filtro = limpio
    ? sql`AND (lower(p.nombre) LIKE ${`%${limpio}%`} OR lower(COALESCE(p.sku, '')) LIKE ${`%${limpio}%`})`
    : sql``;

  const [conteo] = filasDe<{ total: string | number }>(
    await db.execute(sql`SELECT count(*) AS total FROM products p WHERE p.activo ${filtro}`),
  );

  const crudas = filasDe<{
    id: string;
    nombre: string;
    sku: string | null;
    categoria: string | null;
    moneda: 'ARS' | 'USD';
    precio_usd_centavos: string | number | null;
    precio_centavos: string | number;
    precio_local_centavos: string | number | null;
    solo_mostrador: boolean;
    variaciones: string | number;
  }>(
    await db.execute(sql`
      SELECT p.id, p.nombre, p.sku, p.categoria, p.moneda, p.precio_usd_centavos,
             p.precio_centavos, p.precio_local_centavos, p.solo_mostrador,
             (SELECT count(*) FROM product_variants v WHERE v.product_id = p.id AND v.activo)
               AS variaciones
        FROM products p
       WHERE p.activo ${filtro}
       ORDER BY p.nombre
       LIMIT ${limite}
    `),
  );

  return {
    total: Number(conteo?.total ?? 0),
    productos: crudas.map((f) => {
      const precioTiendaCentavos = Number(f.precio_centavos);
      const precioLocalCentavos =
        f.precio_local_centavos === null ? null : Number(f.precio_local_centavos);
      const soloMostrador = Boolean(f.solo_mostrador);

      return {
        id: String(f.id),
        nombre: String(f.nombre),
        sku: f.sku === null ? null : String(f.sku),
        categoria: f.categoria === null ? null : String(f.categoria),
        moneda: f.moneda,
        precioUsdCentavos:
          f.precio_usd_centavos === null ? null : Number(f.precio_usd_centavos),
        precioTiendaCentavos,
        precioMostradorCentavos: precioDeMostrador(
          { precioCentavos: precioTiendaCentavos, precioLocalCentavos, soloMostrador },
          recargoBp,
        ),
        precioLocalCentavos,
        soloMostrador,
        variaciones: Number(f.variaciones),
      };
    }),
  };
}
