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
import { and, eq, isNotNull, sql } from 'drizzle-orm';
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
  /** Si no viene, se propone siguiendo la convención del catálogo. */
  sku?: string | null;
  usuarioId: string;
  ip?: string | null;
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
    // Un nombre repetido casi siempre es alguien cargando dos veces lo mismo
    // porque no encontró lo que ya estaba. Se frena y se le muestra cuál es.
    const [gemelo] = await tx
      .select({ id: products.id, nombre: products.nombre })
      .from(products)
      .where(sql`lower(${products.nombre}) = lower(${titulo}) AND ${products.activo}`)
      .limit(1);

    if (gemelo) {
      throw new ErrorCrear(
        `Ya existe un producto que se llama «${gemelo.nombre}». Buscalo en vez de cargarlo de nuevo.`,
        'nombre_repetido',
      );
    }

    const sku = (datos.sku ?? '').trim() || (await proponerSku(tx, { ...datos, nombre: titulo }));

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

    const [creado] = await tx
      .insert(products)
      .values({
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
        activo: true,
        esServicio,
        soloMostrador,
        // El precio que se escribe en el alta es el de mostrador, que es el que
        // sabe quien está atendiendo. No se le descuenta el recargo de tienda.
        precioLocalCentavos: datos.precioCentavos,
        // Un servicio se cotiza en el momento: su precio se escribe al vender.
        precioEditable: esServicio,
        fichaIncompleta: true,
      })
      .returning({ id: products.id });

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
 * Los productos cargados a las apuradas que todavía hay que terminar.
 *
 * Es la contrapartida del alta rápida: si esta lista no existiera, «rápida»
 * significaría «a medias y para siempre».
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
    .where(and(eq(products.fichaIncompleta, true), eq(products.activo, true)))
    .orderBy(products.createdAt)
    .limit(limite);
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
