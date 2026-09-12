/**
 * Traduce una ficha de WooCommerce a una fila de `products`.
 *
 * Funciones puras a proposito: toda la logica delicada (dolares, precios
 * basura, stock ficticio) se puede probar sin red y sin base.
 */
import { usdAPesos } from '@/lib/dinero';
import { normalizar } from '@/lib/texto';
import { meta, precioACentavos, type WooProducto, type WooVariacion } from './tipos';

/** Meta del plugin `lucas-cotizacion` (D22): el USD es la fuente de verdad. */
export const META_PRECIO_USD = '_li_precio_usd';
export const META_COTIZACION_APLICADA = '_li_cotizacion_aplicada';

/** Categorias cuyos productos son servicios, no mercaderia (D24). */
export const CATEGORIAS_SERVICIO = ['servicio tecnico', 'servicios', 'telefonia'];

/**
 * Categoria de lo que se vende solo en el local y no se publica (D19).
 *
 * Importa para el precio: un producto de solo mostrador no paga la comision de
 * Mercado Pago, asi que su precio de Woo YA es el de mostrador y no hay que
 * descontarle el recargo de la tienda (D31).
 */
export const CATEGORIA_SOLO_MOSTRADOR = 'solo mostrador';

/** Precio por debajo del cual asumimos "precio sin cargar", no precio real. */
export const PISO_PRECIO_PLAUSIBLE_CENTAVOS = 100_00; // $100

/** Stock por encima del cual asumimos carga erronea (hay fichas con 9.708). */
export const TECHO_STOCK_PLAUSIBLE = 1_000;

export interface Aviso {
  wooId: number;
  nombre: string;
  tipo:
    | 'sin_precio'
    | 'sin_sku'
    | 'sin_imagen'
    | 'stock_ficticio'
    | 'usd_incoherente'
    | 'usd_sin_conversion';
  detalle: string;
}

export interface FilaProducto {
  wooId: number;
  sku: string | null;
  nombre: string;
  marca: string | null;
  categoria: string | null;
  tipo: 'simple' | 'variable';
  precioCentavos: number;
  moneda: 'ARS' | 'USD';
  precioUsdCentavos: number | null;
  stock: number;
  gestionaStock: boolean;
  codigoBarras: string | null;
  imagenUrl: string | null;
  activo: boolean;
  esServicio: boolean;
  soloMostrador: boolean;
  precioEditable: boolean;
  fichaIncompleta: boolean;
}

export interface ResultadoMapeo {
  fila: FilaProducto;
  avisos: Aviso[];
}

function aBooleano(v: unknown): boolean {
  return v === true || v === 'true' || v === '1' || v === 1 || v === 'yes';
}

function limpiar(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
}

/**
 * Convierte una ficha de Woo en una fila del espejo local.
 *
 * @param tcCentavos Cotizacion vigente en centavos de ARS por dolar. Se usa
 *   solo para VERIFICAR el precio en pesos que ya escribio el plugin, no para
 *   pisarlo: la fuente de verdad del precio sigue siendo WooCommerce.
 */
export function mapearProducto(p: WooProducto, tcCentavos: number | null): ResultadoMapeo {
  const avisos: Aviso[] = [];
  const nombre = p.name.trim();
  const avisar = (tipo: Aviso['tipo'], detalle: string) =>
    avisos.push({ wooId: p.id, nombre, tipo, detalle });

  const sku = limpiar(p.sku);
  const categoria = p.categories[0]?.name ?? null;
  const marca = p.brands[0]?.name ?? null;
  const imagenUrl = limpiar(p.images[0]?.src);
  const gestionaStock = aBooleano(p.manage_stock);
  const stock = p.stock_quantity ?? 0;

  const precioCentavos = precioACentavos(p.price ?? p.regular_price);

  // --- Dolares (D22) ---------------------------------------------------
  const usdCrudo = meta(p, META_PRECIO_USD);
  const precioUsdCentavos = usdCrudo === undefined ? null : precioACentavos(usdCrudo) || null;
  const moneda: 'ARS' | 'USD' = precioUsdCentavos ? 'USD' : 'ARS';

  if (precioUsdCentavos && tcCentavos) {
    const esperado = usdAPesos(precioUsdCentavos, tcCentavos);
    if (precioCentavos === 0) {
      avisar('usd_sin_conversion', `USD cargado pero el precio en pesos esta vacio`);
    } else {
      // Tolerancia amplia: la cotizacion se reescribe dos veces por dia y el
      // precio puede quedar de la corrida anterior. Lo que buscamos es el
      // error de magnitud, no la diferencia de unos pesos.
      const razon = esperado / precioCentavos;
      if (razon > 1.5 || razon < 0.66) {
        avisar(
          'usd_incoherente',
          `Precio en pesos ${precioCentavos / 100} no se condice con USD ${
            precioUsdCentavos / 100
          } al TC ${tcCentavos / 100} (esperado ${esperado / 100})`,
        );
      }
    }
  }

  // --- Calidad de carga -------------------------------------------------
  if (precioCentavos < PISO_PRECIO_PLAUSIBLE_CENTAVOS && !precioUsdCentavos) {
    avisar('sin_precio', `Precio ${precioCentavos / 100}: es precio sin cargar, no precio real`);
  }
  if (!sku) avisar('sin_sku', 'Sin SKU');
  if (!imagenUrl) avisar('sin_imagen', 'Sin imagen');
  if (gestionaStock && stock > TECHO_STOCK_PLAUSIBLE) {
    avisar('stock_ficticio', `Stock ${stock}: por encima de lo plausible`);
  }

  const esServicio = categoria !== null && CATEGORIAS_SERVICIO.includes(normalizar(categoria));

  // Lo que no llega a la vidriera de la web no lleva recargo de tienda: los
  // servicios, lo que este en «Solo mostrador» y lo que Woo tenga oculto.
  const soloMostrador =
    esServicio ||
    (categoria !== null && normalizar(categoria) === CATEGORIA_SOLO_MOSTRADOR) ||
    p.catalog_visibility !== 'visible';

  return {
    fila: {
      wooId: p.id,
      sku,
      nombre,
      marca,
      categoria,
      tipo: p.type === 'variable' ? 'variable' : 'simple',
      precioCentavos,
      moneda,
      precioUsdCentavos,
      stock: gestionaStock ? stock : 0,
      gestionaStock,
      codigoBarras: limpiar(p.global_unique_id),
      imagenUrl,
      activo: p.status === 'publish',
      esServicio,
      soloMostrador,
      // Un servicio no lleva stock y su precio lo pone el cajero en la venta.
      precioEditable: esServicio,
      fichaIncompleta: !sku || !imagenUrl || precioCentavos < PISO_PRECIO_PLAUSIBLE_CENTAVOS,
    },
    avisos,
  };
}

export interface FilaVariante {
  wooId: number;
  sku: string | null;
  nombre: string;
  atributos: Record<string, string>;
  precioCentavos: number;
  stock: number;
  /** True solo si la variacion lleva su propio stock; si no, manda el padre. */
  gestionaStock: boolean;
  codigoBarras: string | null;
  activo: boolean;
}

export function mapearVariante(v: WooVariacion): FilaVariante {
  const atributos: Record<string, string> = {};
  for (const a of v.attributes) {
    if (a.name && a.option) atributos[a.name] = a.option;
  }
  const nombre = Object.values(atributos).join(' / ') || `Variacion ${v.id}`;
  return {
    wooId: v.id,
    sku: limpiar(v.sku),
    nombre,
    atributos,
    precioCentavos: precioACentavos(v.price ?? v.regular_price),
    // `manage_stock: "parent"` es lo habitual en las variaciones de vidrios y
    // fundas: el stock lo lleva el producto, no cada medida.
    stock: v.stock_quantity ?? 0,
    gestionaStock: v.manage_stock === true,
    codigoBarras: limpiar(v.global_unique_id),
    activo: v.status === 'publish',
  };
}
