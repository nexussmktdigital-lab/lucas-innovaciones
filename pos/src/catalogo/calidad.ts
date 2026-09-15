/**
 * Calidad del catalogo.
 *
 * La sincronizacion ya avisa de los problemas que encuentra al traer las
 * fichas, pero ese informe se va con la consola. Esto los evalua sobre el
 * espejo local, cuando uno quiera, y devuelve la lista para poder arreglarlos.
 *
 * Los criterios son los mismos que usa el mapeo al sincronizar, mas uno que
 * solo se puede evaluar con el catalogo entero delante: el producto cuyo precio
 * esta por debajo del piso plausible de su categoria, que es el que dispara el
 * bloqueo al vender.
 */
import { sql } from 'drizzle-orm';
import { products } from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import { usdAPesos } from '@/lib/dinero';
import { PISO_PRECIO_PLAUSIBLE_CENTAVOS, TECHO_STOCK_PLAUSIBLE } from '@/woo/mapear';
import { revisarLinea } from '@/ventas/cordura';

export type TipoDeProblema =
  | 'precio_sospechoso'
  | 'sin_precio'
  | 'usd_incoherente'
  | 'stock_ficticio'
  | 'sin_sku'
  | 'sin_imagen';

/**
 * Orden de importancia.
 *
 * Un precio sospechoso puede costar millones en una sola venta; una foto que
 * falta no impide vender nada. La lista se ordena por esto y no por cantidad,
 * porque lo que hay que arreglar primero no es lo más numeroso.
 */
export const GRAVEDAD: Record<TipoDeProblema, number> = {
  precio_sospechoso: 1,
  usd_incoherente: 2,
  sin_precio: 3,
  stock_ficticio: 4,
  sin_sku: 5,
  sin_imagen: 6,
};

export const ETIQUETA: Record<TipoDeProblema, string> = {
  precio_sospechoso: 'Precio sospechoso',
  usd_incoherente: 'Dólar incoherente',
  sin_precio: 'Precio sin cargar',
  stock_ficticio: 'Stock imposible',
  sin_sku: 'Sin SKU',
  sin_imagen: 'Sin foto',
};

/** Los que impiden vender bien, frente a los que solo afean la ficha. */
export const BLOQUEANTES: TipoDeProblema[] = [
  'precio_sospechoso',
  'usd_incoherente',
  'sin_precio',
];

export interface ProductoConProblemas {
  id: string;
  wooId: number | null;
  nombre: string;
  sku: string | null;
  categoria: string | null;
  marca: string | null;
  precioCentavos: number;
  moneda: 'ARS' | 'USD';
  precioUsdCentavos: number | null;
  stock: number;
  problemas: { tipo: TipoDeProblema; detalle: string }[];
}

export interface InformeDeCalidad {
  totalProductos: number;
  /** Cuántos productos tienen al menos un problema. */
  conProblemas: number;
  /** Cuántos tienen al menos un problema de los que impiden vender bien. */
  conProblemasBloqueantes: number;
  porTipo: { tipo: TipoDeProblema; cantidad: number }[];
  productos: ProductoConProblemas[];
}

interface FilaProducto {
  id: string;
  woo_id: number | null;
  nombre: string;
  sku: string | null;
  categoria: string | null;
  marca: string | null;
  precio_centavos: string | number;
  moneda: 'ARS' | 'USD';
  precio_usd_centavos: string | number | null;
  stock: number;
  imagen_url: string | null;
  gestiona_stock: boolean;
  es_servicio: boolean;
}

/**
 * Evalúa el catálogo activo.
 *
 * @param tcCentavos Cotización vigente. Sin ella no se puede verificar la
 *   coherencia de los productos en dólares, y esos avisos se omiten.
 */
export async function evaluarCatalogo(
  db: BaseDatos,
  tcCentavos: number | null,
  opciones: { soloBloqueantes?: boolean; limite?: number } = {},
): Promise<InformeDeCalidad> {
  const crudas = filasDe<FilaProducto>(
    await db.execute(sql`
      SELECT id, woo_id, nombre, sku, categoria, marca, precio_centavos, moneda,
             precio_usd_centavos, stock, imagen_url, gestiona_stock, es_servicio
        FROM products
       WHERE activo
       ORDER BY nombre
    `),
  );

  const productos: ProductoConProblemas[] = [];
  const conteo = new Map<TipoDeProblema, number>();

  for (const f of crudas) {
    const precioCentavos = Number(f.precio_centavos);
    const precioUsdCentavos =
      f.precio_usd_centavos === null ? null : Number(f.precio_usd_centavos);
    const problemas: { tipo: TipoDeProblema; detalle: string }[] = [];

    const anotar = (tipo: TipoDeProblema, detalle: string) => {
      problemas.push({ tipo, detalle });
      conteo.set(tipo, (conteo.get(tipo) ?? 0) + 1);
    };

    // Un servicio con precio cero es normal: el cajero lo escribe en la venta.
    const esServicio = Boolean(f.es_servicio);

    if (!esServicio && precioCentavos < PISO_PRECIO_PLAUSIBLE_CENTAVOS && !precioUsdCentavos) {
      anotar(
        'sin_precio',
        `Está en $${(precioCentavos / 100).toLocaleString('es-AR')}: eso no es un precio, es una ficha sin cargar.`,
      );
    }

    // El que importa: un producto que debería estar en dólares y quedó en pesos.
    const sospecha = revisarLinea(
      {
        nombre: f.nombre,
        categoria: f.categoria,
        marca: f.marca,
        moneda: f.moneda,
        precioUsdCentavos,
      },
      precioCentavos,
    );
    if (sospecha && precioCentavos >= PISO_PRECIO_PLAUSIBLE_CENTAVOS) {
      anotar('precio_sospechoso', sospecha.motivo);
    }

    if (precioUsdCentavos && tcCentavos) {
      const esperado = usdAPesos(precioUsdCentavos, tcCentavos);
      const razon = precioCentavos > 0 ? esperado / precioCentavos : Number.POSITIVE_INFINITY;
      if (razon > 1.5 || razon < 0.66) {
        anotar(
          'usd_incoherente',
          `US$ ${(precioUsdCentavos / 100).toLocaleString('es-AR')} al dólar de hoy deberían ser ` +
            `$${(esperado / 100).toLocaleString('es-AR')}, y la ficha dice ` +
            `$${(precioCentavos / 100).toLocaleString('es-AR')}.`,
        );
      }
    }

    if (Boolean(f.gestiona_stock) && f.stock > TECHO_STOCK_PLAUSIBLE) {
      anotar('stock_ficticio', `Figuran ${f.stock.toLocaleString('es-AR')} unidades.`);
    }

    if (!f.sku) anotar('sin_sku', 'No se puede buscar por código ni identificar en el proveedor.');
    if (!f.imagen_url) anotar('sin_imagen', 'No se puede publicar en la tienda online.');

    if (problemas.length > 0) {
      problemas.sort((a, b) => GRAVEDAD[a.tipo] - GRAVEDAD[b.tipo]);
      productos.push({
        id: f.id,
        wooId: f.woo_id === null ? null : Number(f.woo_id),
        nombre: f.nombre,
        sku: f.sku,
        categoria: f.categoria,
        marca: f.marca,
        precioCentavos,
        moneda: f.moneda,
        precioUsdCentavos,
        stock: Number(f.stock),
        problemas,
      });
    }
  }

  const tieneBloqueante = (p: ProductoConProblemas) =>
    p.problemas.some((x) => BLOQUEANTES.includes(x.tipo));

  const filtrados = opciones.soloBloqueantes ? productos.filter(tieneBloqueante) : productos;

  // Lo más grave arriba: es lo que hay que arreglar primero.
  filtrados.sort((a, b) => GRAVEDAD[a.problemas[0]!.tipo] - GRAVEDAD[b.problemas[0]!.tipo]);

  return {
    totalProductos: crudas.length,
    conProblemas: productos.length,
    conProblemasBloqueantes: productos.filter(tieneBloqueante).length,
    porTipo: [...conteo.entries()]
      .map(([tipo, cantidad]) => ({ tipo, cantidad }))
      .sort((a, b) => GRAVEDAD[a.tipo] - GRAVEDAD[b.tipo]),
    productos: opciones.limite ? filtrados.slice(0, opciones.limite) : filtrados,
  };
}

/* -------------------------------------------------------------------------- */
/* Marcador de facturacion con producto real                                  */
/* -------------------------------------------------------------------------- */

export interface MesDeFacturacion {
  /** `YYYY-MM`. */
  mes: string;
  totalCentavos: number;
  /** Facturación cuya línea apunta a un producto real del catálogo. */
  conProductoCentavos: number;
  /** Porcentaje con producto real, redondeado. */
  porcentaje: number;
  origen: 'pos' | 'legacy';
}

/**
 * La metrica que el negocio necesita mirar todos los meses.
 *
 * En el sistema nuevo da 100% por construccion: `sale_items.product_id` es NOT
 * NULL y no hay forma de vender sin producto. El valor esta en el contraste con
 * el historico del POS anterior, donde el 58% de la facturacion se cargaba sin
 * producto asociado. Por eso se leen las dos fuentes y se marca de cual viene
 * cada mes.
 */
export async function marcadorDeProductoReal(
  db: BaseDatos,
  meses = 14,
): Promise<MesDeFacturacion[]> {
  const filas = filasDe<{
    mes: string;
    total: string | number;
    con_producto: string | number;
    origen: 'pos' | 'legacy';
  }>(
    await db.execute(sql`
      -- El mes es el del calendario del local, no el del servidor: una venta
      -- de las 22:30 del 31 en Villa Santa Rosa es del mes siguiente en UTC, y
      -- sin AT TIME ZONE la última noche de cada mes se contaba en el otro.
      SELECT to_char(fecha AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') AS mes,
             SUM(total_centavos)                AS total,
             SUM(total_centavos)                AS con_producto,
             'pos'                              AS origen
        FROM sales
       WHERE estado = 'completed'
       GROUP BY 1

      UNION ALL

      SELECT to_char(fecha AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') AS mes,
             SUM(total_centavos)                                             AS total,
             SUM(total_centavos) FILTER (WHERE NOT sin_producto)             AS con_producto,
             'legacy'                                                        AS origen
        FROM legacy_sales
       GROUP BY 1

       ORDER BY mes DESC
       LIMIT ${meses}
    `),
  );

  return filas.map((f) => {
    const totalCentavos = Number(f.total ?? 0);
    const conProductoCentavos = Number(f.con_producto ?? 0);
    return {
      mes: f.mes,
      totalCentavos,
      conProductoCentavos,
      porcentaje: totalCentavos > 0 ? Math.round((conProductoCentavos / totalCentavos) * 100) : 0,
      origen: f.origen,
    };
  });
}

/** Cuántos productos del catálogo se vendieron alguna vez desde el POS nuevo. */
export async function productosConRotacion(db: BaseDatos): Promise<number> {
  const [r] = filasDe<{ total: string | number }>(
    await db.execute(sql`SELECT count(DISTINCT product_id) AS total FROM sale_items`),
  );
  return Number(r?.total ?? 0);
}

export async function totalDeProductos(db: BaseDatos): Promise<number> {
  const [r] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(products);
  return r?.total ?? 0;
}
