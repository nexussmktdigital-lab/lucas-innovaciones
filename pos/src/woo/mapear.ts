/**
 * Traduce una ficha de WooCommerce a una fila de `products`.
 *
 * Funciones puras a proposito: toda la logica delicada (dolares, precios
 * basura, stock ficticio) se puede probar sin red y sin base.
 */
import { usdAPesos } from '@/lib/dinero';
import { normalizar } from '@/lib/texto';
import { meta, precioACentavos, type WooProducto, type WooVariacion } from './tipos';

/**
 * Meta del plugin `li-dolar`: esta ficha tiene el precio en dolares.
 *
 * **Cuando esta puesta, el numero de `price` de Woo SON DOLARES**, no pesos.
 * La web los multiplica por la cotizacion al renderizar; en la base de Woo
 * vive el precio pactado, que es el que no cambia cuando cambia el dolar.
 *
 * Es la convencion que esta en produccion con 54 productos. El POS tenia otra
 * —un meta aparte con el precio en dolares y `price` en pesos— que no usaba
 * ninguna ficha: cero productos. Dos convenciones sobre el MISMO campo, y el
 * POS leia `price = 630` de un iPhone de US$ 630 y mostraba $630 en el
 * mostrador. Una semana de fichas «mal cargadas» que estaban bien.
 */
export const META_MONEDA = '_li_moneda';
export const META_COTIZACION_APLICADA = '_li_cotizacion_aplicada';

/**
 * El cuerpo de precio que WooCommerce tiene que recibir, en la convencion del
 * plugin. Lo usan el alta (`publicar`) y el empuje de precio de la cola.
 *
 * `regular_price` y no `price`: `price` es de solo lectura en la API de
 * WooCommerce —lo calcula ella segun haya oferta o no— y escribirlo no cambia
 * nada.
 *
 * **En dolares viaja el numero en dolares**, con la marca `_li_moneda = USD` al
 * lado: la web lo multiplica por la cotizacion al renderizar. Mandar pesos a una
 * ficha marcada en dolares es el error de mil veces —$990.000 publicados como
 * US$ 990.000, o sea mil quinientos millones— asi que el precio y la marca van
 * SIEMPRE en el mismo PUT: no existe un instante en que la ficha tenga uno sin
 * el otro.
 *
 * Cuando el producto esta en pesos la marca se limpia, en el mismo PUT y aunque
 * nunca haya estado en dolares. Es lo que hace que empujar sea idempotente y
 * que arregle una ficha que quedo marcada de antes.
 *
 * Un producto marcado en dolares pero sin precio en dolares cargado viaja en
 * pesos y sin marca: es lo unico que no publica un numero falso. En `products`
 * ese estado no existe —lo prohibe el CHECK `products_usd_ck`— pero esta
 * funcion tambien la llama el alta, que arma el objeto a mano.
 */
export function cuerpoDePrecioParaWoo(p: {
  moneda: 'ARS' | 'USD';
  precioCentavos: number;
  precioUsdCentavos: number | null;
}): { regular_price: string; meta_data: { key: string; value: string }[] } {
  const enDolares = p.moneda === 'USD' && p.precioUsdCentavos !== null && p.precioUsdCentavos > 0;
  const centavos = enDolares ? p.precioUsdCentavos! : p.precioCentavos;
  return {
    regular_price: (centavos / 100).toFixed(2),
    meta_data: [{ key: META_MONEDA, value: enDolares ? 'USD' : '' }],
  };
}

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

  const precioDeLaFicha = precioACentavos(p.price ?? p.regular_price);

  /* --- Dolares (D22, D62) ----------------------------------------------
   *
   * Con la marca del plugin puesta, el numero de la ficha ES el precio en
   * dolares. Los pesos no se leen: **se calculan**, con la misma cuenta que
   * hace la web al renderizar. Asi el mostrador y la vidriera dicen lo mismo
   * y ninguno de los dos guarda un numero que el dolar deja viejo.
   *
   * Ya no hay nada que cruzar entre dos cifras —antes se comparaba el precio
   * en pesos de la ficha contra el USD por la cotizacion, y se avisaba si no
   * se condecian—: hay un solo numero y una sola fuente.
   */
  const enDolares = String(meta(p, META_MONEDA) ?? '').toUpperCase() === 'USD';
  const precioUsdCentavos = enDolares ? precioDeLaFicha || null : null;
  const moneda: 'ARS' | 'USD' = precioUsdCentavos ? 'USD' : 'ARS';

  /*
   * Sin cotizacion no se inventa el precio en pesos.
   *
   * Dejarlo en cero es lo unico honesto: poner el numero de dolares como si
   * fueran pesos es exactamente el error que esto vino a arreglar —un iPhone
   * de US$ 630 a $630— y es el que se paga caro. La venta ya se niega a cobrar
   * un producto en dolares sin cotizacion, asi que nadie lo vende a ciegas.
   */
  const precioCentavos = precioUsdCentavos
    ? tcCentavos
      ? usdAPesos(precioUsdCentavos, tcCentavos)
      : 0
    : precioDeLaFicha;

  if (enDolares && !precioUsdCentavos) {
    avisar('usd_sin_conversion', 'Marcada en dolares pero sin precio cargado');
  }
  if (precioUsdCentavos && !tcCentavos) {
    avisar(
      'usd_sin_conversion',
      `USD ${precioUsdCentavos / 100} sin cotizacion cargada: no se puede calcular el precio en pesos`,
    );
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
      // Un producto en dolares tiene precio aunque sus pesos sean cero: los
      // pesos son un calculo, y sin cotizacion no se pueden hacer. Mirar esa
      // cifra marcaria los 54 usados como fichas sin precio.
      fichaIncompleta:
        !sku ||
        !imagenUrl ||
        (!precioUsdCentavos && precioCentavos < PISO_PRECIO_PLAUSIBLE_CENTAVOS),
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
