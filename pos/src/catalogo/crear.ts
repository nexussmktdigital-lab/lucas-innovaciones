/**
 * Alta de productos desde el POS.
 *
 * Hasta acá el catálogo entraba **solo** por WooCommerce, y eso deja al
 * mostrador sin salida en el momento exacto en que la necesita: llega
 * mercadería nueva, o alguien pide un servicio que no está catalogado, y como
 * ninguna línea de venta puede existir sin un producto real (D24) la venta se
 * traba. La alternativa que quedaba era inventar un producto en WooCommerce
 * desde el celular, con el cliente esperando.
 *
 * Dos decisiones sostienen esto:
 *
 * 1. **Nace de mostrador, no de tienda.** El producto se crea local, con
 *    `wooId` en nulo, y se vende en el acto. No se espera a WooCommerce ni se
 *    depende de que haya red: si la conexión está caída —que es la razón por la
 *    que existe la cola— el mostrador sigue vendiendo. Es «Solo mostrador»
 *    (D19), que es exactamente lo que es: algo que se vende acá y todavía no
 *    está en la tienda.
 *
 * 2. **Publicar en la tienda es un acto aparte** (ver `publicarProducto`). Una
 *    ficha cargada en veinte segundos no tiene foto ni descripción, y mandarla
 *    sola a la web es ensuciar la tienda. Tampoco se puede publicar como
 *    borrador: la sincronización lee `status` y un borrador vuelve como
 *    `activo: false`, o sea que el producto desaparecería del mostrador que lo
 *    creó. Así que se publica cuando alguien decide publicarlo.
 *
 * El producto queda marcado con `fichaIncompleta`, que es la lista de lo que
 * hay que terminar. La columna ya existía en el esquema desde la fase 1.
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { auditLog, products, syncQueue } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import { limpiarTitulo, sugerirSku } from './alta';
import { CATEGORIAS_SERVICIO } from '@/woo/mapear';
import { normalizar } from '@/lib/texto';

export class ErrorCrear extends Error {
  constructor(
    mensaje: string,
    readonly codigo:
      | 'datos_invalidos'
      | 'sku_repetido'
      | 'nombre_repetido'
      | 'precio_invalido' = 'datos_invalidos',
  ) {
    super(mensaje);
  }
}

export interface DatosDeAlta {
  nombre: string;
  categoria?: string | null;
  marca?: string | null;
  /** Precio de mostrador, en centavos. Cero solo si el precio se escribe al vender. */
  precioCentavos: number;
  stock?: number;
  /** Servicios y chips: sin stock y con precio editable en la venta (D24). */
  esServicio?: boolean;
  codigoBarras?: string | null;
  /**
   * Lo que costó, en centavos.
   *
   * Es lo único que hace posible el reporte de rentabilidad: el costo se copia
   * a cada línea de venta al confirmarla y queda congelado ahí, así que una
   * venta vieja no cambia de margen porque hoy el proveedor cobre otra cosa.
   */
  costoCentavos?: number | null;
  /** Si no viene, se propone siguiendo la convención del catálogo. */
  sku?: string | null;
  usuarioId: string;
  ip?: string | null;
  /**
   * Los SKU ya tomados, cuando quien llama los tiene a mano.
   *
   * Lo usa la importación masiva: sin esto, cada renglón vuelve a leer la
   * columna entera de SKU del catálogo, y en una planilla de 500 renglones
   * sobre 800 productos eso son casi medio millón de filas de ida y vuelta.
   */
  skusTomados?: Iterable<string>;
}

export interface ProductoCreado {
  id: string;
  nombre: string;
  sku: string | null;
  precioCentavos: number;
  esServicio: boolean;
  /** Lo que se sacó del nombre por ser una anotación interna, si hubo algo. */
  notaInterna: string | null;
}

/** El tope de la validación de cordura: nadie carga un cable de diez millones. */
export const TECHO_PRECIO_ALTA_CENTAVOS = 50_000_000_00;
export const TECHO_STOCK_ALTA = 1_000;

/**
 * Da de alta un producto y lo deja vendible en el acto.
 *
 * Todo en una transacción: el producto, la bitácora y el encolado de la
 * publicación. Si algo falla no queda ni un producto a medias ni una operación
 * encolada para un producto que no existe.
 */
export async function crearProducto(
  db: BaseDatos,
  datos: DatosDeAlta,
): Promise<ProductoCreado> {
  const { titulo, notaInterna } = limpiarTitulo(datos.nombre);

  if (!Number.isInteger(datos.precioCentavos) || datos.precioCentavos < 0) {
    throw new ErrorCrear('El precio tiene que ser un número de centavos no negativo.', 'precio_invalido');
  }
  if (datos.precioCentavos > TECHO_PRECIO_ALTA_CENTAVOS) {
    throw new ErrorCrear(
      'Ese precio es demasiado alto para cargarlo de esta forma. Revisá si sobran ceros.',
      'precio_invalido',
    );
  }

  /*
   * El costo se valida igual que el precio, y por una razón más fuerte: se copia
   * congelado a cada línea de venta, así que un costo negativo o con ceros de
   * más envenena la rentabilidad de todas las ventas futuras de ese producto y
   * no hay forma de arreglar las líneas ya escritas.
   */
  const costoCentavos = datos.costoCentavos ?? null;
  if (costoCentavos !== null) {
    if (!Number.isInteger(costoCentavos) || costoCentavos < 0) {
      throw new ErrorCrear('El costo no puede ser negativo.', 'precio_invalido');
    }
    if (costoCentavos > TECHO_PRECIO_ALTA_CENTAVOS) {
      throw new ErrorCrear('Ese costo es imposible. Revisá si sobran ceros.', 'precio_invalido');
    }
  }

  const esServicio = datos.esServicio ?? esCategoriaDeServicio(datos.categoria ?? null);
  const stock = esServicio ? 0 : (datos.stock ?? 0);

  if (!Number.isInteger(stock) || stock < 0) {
    throw new ErrorCrear('El stock tiene que ser un número entero de unidades.', 'datos_invalidos');
  }
  if (stock > TECHO_STOCK_ALTA) {
    throw new ErrorCrear(
      `Más de ${TECHO_STOCK_ALTA} unidades no se cargan de a una. Usá la importación masiva.`,
      'datos_invalidos',
    );
  }

  /*
   * Todo lo que se da de alta acá nace de mostrador. No es una limitación: es
   * lo que el producto realmente es hasta que alguien lo publique. Y tiene una
   * consecuencia de precio que conviene tener presente (D31): al no publicarse,
   * su precio no lleva el recargo de la tienda, así que lo que se escribe en el
   * alta es lo que se cobra en el local, sin cuentas en el medio.
   */
  const soloMostrador = true;

  return db.transaction(async (tx) => {
    /*
     * Un nombre repetido casi siempre es alguien cargando dos veces lo mismo
     * porque no encontró lo que ya estaba.
     *
     * Se miran también los **inactivos**, que es lo que la auditoría encontró:
     * `activo` sale del estado de WooCommerce, así que un producto en borrador
     * allá está inactivo acá y no aparece en el buscador. El vendedor lo carga
     * de nuevo, el dueño publica el borrador, y quedan dos fichas activas con
     * el mismo nombre, dos precios y dos stocks.
     */
    const [gemelo] = await tx
      .select({ id: products.id, nombre: products.nombre, activo: products.activo })
      .from(products)
      .where(sql`lower(${products.nombre}) = lower(${titulo})`)
      .limit(1);

    if (gemelo) {
      throw new ErrorCrear(
        gemelo.activo
          ? `Ya existe un producto que se llama «${gemelo.nombre}». Buscalo en vez de cargarlo de nuevo.`
          : `Ya existe «${gemelo.nombre}», pero está oculto porque en la tienda online figura como borrador. Publicalo allá en vez de cargarlo de nuevo.`,
        'nombre_repetido',
      );
    }

    const sku =
      (datos.sku ?? '').trim() ||
      (datos.skusTomados
        ? sugerirSku({ ...datos, nombre: titulo }, datos.skusTomados)
        : await proponerSku(tx, { ...datos, nombre: titulo }));

    const [repetido] = await tx
      .select({ nombre: products.nombre })
      .from(products)
      .where(sql`upper(${products.sku}) = upper(${sku})`)
      .limit(1);

    if (repetido) {
      throw new ErrorCrear(
        `El SKU ${sku} ya lo usa «${repetido.nombre}».`,
        'sku_repetido',
      );
    }

    const [creado] = await insertarProducto(tx, sku, {
        wooId: null,
        sku,
        nombre: titulo,
        marca: (datos.marca ?? '')?.trim() || null,
        categoria: (datos.categoria ?? '')?.trim() || null,
        tipo: 'simple',
        precioCentavos: datos.precioCentavos,
        moneda: 'ARS',
        stock,
        gestionaStock: !esServicio,
        codigoBarras: (datos.codigoBarras ?? '')?.trim() || null,
        costoCentavos,
        activo: true,
        esServicio,
        soloMostrador,
        // El precio que se escribe en el alta es el de mostrador, que es el que
        // sabe quien está atendiendo. No se le descuenta el recargo de tienda.
        precioLocalCentavos: datos.precioCentavos,
        // Un servicio se cotiza en el momento: su precio se escribe al vender.
        precioEditable: esServicio,
        fichaIncompleta: true,
    });

    const id = creado!.id;

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'producto.alta',
      entidad: 'products',
      entidadId: id,
      valorNuevo: {
        nombre: titulo,
        sku,
        precioCentavos: datos.precioCentavos,
        costoCentavos,
        stock,
        esServicio,
        soloMostrador,
        notaInterna,
        nombreOriginal: datos.nombre.trim() === titulo ? null : datos.nombre.trim(),
      },
      ip: datos.ip ?? null,
    });

    return {
      id,
      nombre: titulo,
      sku,
      precioCentavos: datos.precioCentavos,
      esServicio,
      notaInterna,
    };
  });
}

/**
 * Inserta el producto y traduce el choque de SKU a un mensaje entendible.
 *
 * El control de arriba mira y después escribe, y entre las dos cosas no hay
 * nada: dos tablets cargando lo mismo a la vez pasan las dos, y como el SKU se
 * propone de forma determinista a partir del nombre, las dos calculan el mismo.
 * Lo único que cierra esa ventana es el índice único de la base
 * (`products_sku_uq`); acá se lo traduce para que no llegue a la pantalla como
 * un error de PostgreSQL.
 */
async function insertarProducto(
  tx: BaseDatos,
  sku: string,
  valores: typeof products.$inferInsert,
): Promise<{ id: string }[]> {
  try {
    return await tx.insert(products).values(valores).returning({ id: products.id });
  } catch (e) {
    if (esViolacionDeUnico(e)) {
      throw new ErrorCrear(
        `El SKU ${sku} lo tomó otro producto recién. Probá de nuevo.`,
        'sku_repetido',
      );
    }
    throw e;
  }
}

/** `23505` es «unique_violation» en PostgreSQL. */
function esViolacionDeUnico(e: unknown): boolean {
  const codigo = (e as { code?: unknown; cause?: { code?: unknown } })?.code
    ?? (e as { cause?: { code?: unknown } })?.cause?.code;
  return codigo === '23505';
}

function esCategoriaDeServicio(categoria: string | null): boolean {
  return CATEGORIAS_SERVICIO.includes(normalizar(categoria ?? ''));
}

/** Arma un SKU mirando los que ya están tomados. */
async function proponerSku(
  db: BaseDatos,
  datos: { nombre: string; categoria?: string | null; marca?: string | null },
): Promise<string> {
  const usados = await db
    .select({ sku: products.sku })
    .from(products)
    .where(isNotNull(products.sku));

  return sugerirSku(datos, usados.map((f) => f.sku!));
}

/** Las categorías que ya existen en el catálogo, para ofrecerlas en vez de inventar. */
export async function categoriasDelCatalogo(db: BaseDatos): Promise<string[]> {
  const filas = await db
    .selectDistinct({ categoria: products.categoria })
    .from(products)
    .where(and(isNotNull(products.categoria), eq(products.activo, true)))
    .orderBy(products.categoria);

  return filas.map((f) => f.categoria!).filter((c) => c.trim() !== '');
}

/** Las marcas que ya existen, por lo mismo. */
export async function marcasDelCatalogo(db: BaseDatos): Promise<string[]> {
  const filas = await db
    .selectDistinct({ marca: products.marca })
    .from(products)
    .where(and(isNotNull(products.marca), eq(products.activo, true)))
    .orderBy(products.marca);

  return filas.map((f) => f.marca!).filter((m) => m.trim() !== '');
}

export interface FichaPendiente {
  id: string;
  nombre: string;
  sku: string | null;
  categoria: string | null;
  marca: string | null;
  precioCentavos: number;
  stock: number;
  esServicio: boolean;
  wooId: number | null;
  createdAt: Date;
}

/**
 * Los productos cargados en el mostrador que todavía no están en la tienda.
 *
 * Es la contrapartida del alta rápida: si esta lista no existiera, «rápida»
 * significaría «a medias y para siempre».
 *
 * **Solo los que nacieron acá** (`woo_id` nulo). La marca `ficha_incompleta`
 * también se la pone el mapeo de WooCommerce a cualquier ficha sin SKU, sin
 * foto o con un precio sospechoso, y el catálogo real tiene cientos así: sin
 * este filtro, el panel decía «Cargados en el mostrador» sobre productos que
 * nunca pasaron por el alta, y con el catálogo entero encima quedaba inservible.
 * De las fichas que ya están en la tienda se ocupa Calidad del catálogo, que es
 * donde viven esos mismos criterios.
 */
export async function fichasPendientes(db: BaseDatos, limite = 50): Promise<FichaPendiente[]> {
  return db
    .select({
      id: products.id,
      nombre: products.nombre,
      sku: products.sku,
      categoria: products.categoria,
      marca: products.marca,
      precioCentavos: products.precioCentavos,
      stock: products.stock,
      esServicio: products.esServicio,
      wooId: products.wooId,
      createdAt: products.createdAt,
    })
    .from(products)
    .where(
      and(
        eq(products.fichaIncompleta, true),
        eq(products.activo, true),
        isNull(products.wooId),
      ),
    )
    .orderBy(products.createdAt)
    .limit(limite);
}

/**
 * Cuántas fichas de mostrador hay en total.
 *
 * La lista viene cortada, así que el título no puede contar las filas que
 * recibió: con 200 productos importados diría «50» y nadie sabría que hay más.
 */
export async function cuantasFichasPendientes(db: BaseDatos): Promise<number> {
  const [fila] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(products)
    .where(
      and(
        eq(products.fichaIncompleta, true),
        eq(products.activo, true),
        isNull(products.wooId),
      ),
    );

  return fila?.total ?? 0;
}

/** Marca la ficha como terminada. Lo hace el dueño desde el catálogo. */
export async function darFichaPorCompleta(
  db: BaseDatos,
  productId: string,
  usuarioId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(products)
      .set({ fichaIncompleta: false, updatedAt: new Date() })
      .where(eq(products.id, productId));

    await tx.insert(auditLog).values({
      usuarioId,
      accion: 'producto.ficha_completa',
      entidad: 'products',
      entidadId: productId,
      valorNuevo: { fichaIncompleta: false },
    });
  });
}
