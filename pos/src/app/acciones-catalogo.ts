'use server';

/**
 * Acciones del catálogo: dar de alta, publicar e importar.
 *
 * El alta rápida la puede hacer el vendedor: es la persona que está en el
 * mostrador cuando falta el producto, y el permiso `producto.alta_rapida` ya se
 * lo daba desde la fase 1. Todo lo demás —publicar en la tienda, importar una
 * planilla, dar una ficha por terminada— es del dueño.
 */
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { aCentavos, ErrorDinero, formatearARS } from '@/lib/dinero';
import {
  categoriasDelCatalogo,
  crearProducto,
  darFichaPorCompleta,
  ErrorCrear,
  marcasDelCatalogo,
} from '@/catalogo/crear';
import { encolarPublicacion, ErrorPublicar } from '@/catalogo/publicar';
import { ErrorImportar, importarPlanilla, revisarPlanilla } from '@/catalogo/importar';
import {
  aplicarEntrega,
  ErrorEntrega,
  pareceUnaPlanilla,
  revisarEntrega,
  type RevisionDeEntrega,
} from '@/catalogo/entrega';
import { ErrorIA, hayIA, sugerirFicha, type FichaSugerida } from '@/catalogo/ia';
import { drenarEnSegundoPlano } from '@/woo/cola';
import { ErrorStock, reactivarProducto, sumarStock } from '@/catalogo/stock';
import { cambiarPrecio, ErrorPrecioFicha } from '@/catalogo/precio';
import { recargoDeTienda } from '@/precios/config';

export interface EstadoAlta {
  error?: string;
  ok?: string;
  /** El producto recién creado, para poder ir a venderlo. */
  creado?: { id: string; nombre: string; sku: string | null };
  /** Lo que se sacó del nombre por ser una anotación interna. */
  notaInterna?: string | null;
}

const esquemaAlta = z.object({
  nombre: z.string().min(1, 'Escribí el nombre del producto.').max(200),
  categoria: z.string().max(100).optional(),
  marca: z.string().max(100).optional(),
  precio: z.string().max(20),
  stock: z.string().max(10).optional(),
  codigoBarras: z.string().max(60).optional(),
  costo: z.string().max(20).optional(),
  esServicio: z.string().optional(),
});

export async function crearProductoAccion(
  _previo: EstadoAlta,
  datos: FormData,
): Promise<EstadoAlta> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'producto.alta_rapida')) {
    return { error: 'No tenés permiso para cargar productos.' };
  }

  const leido = esquemaAlta.safeParse(Object.fromEntries(datos.entries()));
  if (!leido.success) {
    return { error: leido.error.issues[0]?.message ?? 'Faltan datos del producto.' };
  }
  const d = leido.data;

  let precioCentavos: number;
  try {
    precioCentavos = d.precio.trim() === '' ? 0 : aCentavos(d.precio);
  } catch (e) {
    return { error: e instanceof ErrorDinero ? e.message : 'El precio no es válido.' };
  }

  let costoCentavos: number | null = null;
  const costoCrudo = (d.costo ?? '').trim();
  if (costoCrudo !== '') {
    try {
      costoCentavos = aCentavos(costoCrudo);
    } catch (e) {
      return { error: e instanceof ErrorDinero ? e.message : 'El costo no es válido.' };
    }
  }

  const stockCrudo = (d.stock ?? '').trim();
  const stock = stockCrudo === '' ? 0 : Number(stockCrudo);
  if (!Number.isInteger(stock) || stock < 0) {
    return { error: 'El stock tiene que ser un número entero de unidades.' };
  }

  try {
    const creado = await crearProducto(db, {
      nombre: d.nombre,
      categoria: d.categoria?.trim() || null,
      marca: d.marca?.trim() || null,
      precioCentavos,
      stock,
      codigoBarras: d.codigoBarras?.trim() || null,
      costoCentavos,
      esServicio: d.esServicio === 'on' ? true : undefined,
      usuarioId: sesion.user.id,
    });

    revalidatePath('/catalogo');
    revalidatePath('/vender');
    revalidatePath('/precios');

    return {
      ok: `«${creado.nombre}» quedó cargado y se puede vender.`,
      creado: { id: creado.id, nombre: creado.nombre, sku: creado.sku },
      notaInterna: creado.notaInterna,
    };
  } catch (e) {
    if (e instanceof ErrorCrear) return { error: e.message };
    console.error('[catalogo] Falló el alta:', e);
    return { error: 'No se pudo cargar el producto.' };
  }
}

export interface EstadoSugerencia {
  error?: string;
  ficha?: FichaSugerida;
  /** True si no hay credencial cargada: se completa a mano y listo. */
  sinAyuda?: boolean;
}

/**
 * Propone la ficha a partir de lo que se tipeó.
 *
 * Nunca frena el alta: si no hay credencial o la sugerencia falla, se devuelve
 * el motivo y el formulario sigue como estaba.
 */
export async function sugerirFichaAccion(
  _previo: EstadoSugerencia,
  datos: FormData,
): Promise<EstadoSugerencia> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'producto.alta_rapida')) {
    return { error: 'No tenés permiso para cargar productos.' };
  }
  if (!hayIA()) return { sinAyuda: true };

  const crudo = String(datos.get('crudo') ?? '');

  try {
    const ficha = await sugerirFicha(crudo, {
      categorias: await categoriasDelCatalogo(db),
      marcas: await marcasDelCatalogo(db),
    });

    if (!ficha) return { sinAyuda: true };
    return { ficha };
  } catch (e) {
    if (e instanceof ErrorIA) return { error: e.message };
    console.error('[catalogo] Falló la sugerencia de ficha:', e);
    return { error: 'No se pudo armar la ficha. Completala a mano, que es lo mismo.' };
  }
}

export interface EstadoCatalogo {
  error?: string;
  ok?: string;
}

export async function publicarProductoAccion(
  _previo: EstadoCatalogo,
  datos: FormData,
): Promise<EstadoCatalogo> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'producto.editar')) {
    return { error: 'No tenés permiso para publicar productos en la tienda.' };
  }

  const id = z.string().uuid().safeParse(datos.get('productId'));
  if (!id.success) return { error: 'No se entiende de qué producto se habla.' };

  try {
    await encolarPublicacion(db, id.data, sesion.user.id);
  } catch (e) {
    if (e instanceof ErrorPublicar) return { error: e.message };
    console.error('[catalogo] Falló el pedido de publicación:', e);
    return { error: 'No se pudo pedir la publicación.' };
  }

  // Se intenta ya; si WooCommerce no contesta, queda encolado y se reintenta.
  await drenarEnSegundoPlano(db);

  revalidatePath('/catalogo');
  revalidatePath('/sincronizacion');
  return { ok: 'Pedido de publicación encolado. Va a la tienda apenas haya conexión.' };
}

export async function fichaListaAccion(
  _previo: EstadoCatalogo,
  datos: FormData,
): Promise<EstadoCatalogo> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'producto.editar')) {
    return { error: 'No tenés permiso para dar una ficha por terminada.' };
  }

  const id = z.string().uuid().safeParse(datos.get('productId'));
  if (!id.success) return { error: 'No se entiende de qué producto se habla.' };

  await darFichaPorCompleta(db, id.data, sesion.user.id);
  revalidatePath('/catalogo');
  return { ok: 'Ficha marcada como terminada.' };
}

export interface EstadoImportacion {
  error?: string;
  ok?: string;
  /** Lo que la planilla haría, antes de escribir nada. */
  revision?: Awaited<ReturnType<typeof revisarPlanilla>>;
  /** Lo mismo, cuando lo que se pegó es la lista escrita a mano. */
  entrega?: RevisionDeEntrega;
  /** El texto que se revisó, para poder confirmarlo sin volver a pegarlo. */
  texto?: string;
}

/**
 * Paso 1: mirar. No escribe nada.
 *
 * Un solo cuadro de texto para las dos formas de cargar una entrega, y el
 * programa decide cuál es. Dos cuadros serían una decisión más que tomar cuando
 * llega la mercadería, y es una decisión que no hace falta que tome una persona:
 * una planilla siempre arranca con la fila de títulos.
 */
export async function revisarPlanillaAccion(
  _previo: EstadoImportacion,
  datos: FormData,
): Promise<EstadoImportacion> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'producto.editar')) {
    return { error: 'No tenés permiso para cargar una entrega.' };
  }

  const texto = String(datos.get('texto') ?? '');

  try {
    return pareceUnaPlanilla(texto)
      ? { revision: await revisarPlanilla(db, texto), texto }
      : { entrega: await revisarEntrega(db, texto), texto };
  } catch (e) {
    if (e instanceof ErrorImportar || e instanceof ErrorEntrega) return { error: e.message, texto };
    console.error('[catalogo] Falló la revisión de la entrega:', e);
    return { error: 'No se pudo leer lo que pegaste.', texto };
  }
}

/** Paso 2: guardar lo que el paso 1 mostró. */
export async function importarPlanillaAccion(
  _previo: EstadoImportacion,
  datos: FormData,
): Promise<EstadoImportacion> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'producto.editar')) {
    return { error: 'No tenés permiso para cargar una entrega.' };
  }

  const texto = String(datos.get('texto') ?? '');
  let destino: string;

  try {
    if (pareceUnaPlanilla(texto)) {
      const r = await importarPlanilla(db, texto, sesion.user.id);
      if (r.fallidos.length > 0) {
        const detalle = r.fallidos.map((f) => `línea ${f.linea}: ${f.motivo}`).join(' · ');
        return { error: `Entraron ${r.creados}, pero ${r.fallidos.length} no: ${detalle}`, texto };
      }
      destino = `/catalogo?importados=${r.creados}`;
    } else {
      const r = await aplicarEntrega(db, texto, sesion.user.id);
      if (r.fallidos.length > 0) {
        const detalle = r.fallidos.map((f) => `línea ${f.linea}: ${f.motivo}`).join(' · ');
        return {
          error: `Se aplicaron ${r.creados + r.stockSumado + r.bajas} renglones, pero ${r.fallidos.length} no: ${detalle}`,
          texto,
        };
      }
      destino = `/catalogo?cargados=${r.creados}&sumados=${r.stockSumado}&bajas=${r.bajas}`;
    }
  } catch (e) {
    if (e instanceof ErrorImportar || e instanceof ErrorEntrega) return { error: e.message, texto };
    console.error('[catalogo] Falló la carga de la entrega:', e);
    return { error: 'No se pudo cargar la entrega.', texto };
  }

  // Que la tienda se entere del stock y de las bajas cuanto antes.
  after(() => drenarEnSegundoPlano(db));

  revalidatePath('/catalogo');
  revalidatePath('/vender');
  revalidatePath('/precios');

  // Se sale de la pantalla: lo que sigue es completar las fichas, y esa lista
  // vive en el catálogo.
  redirect(destino);
}

export interface EstadoStock {
  error?: string;
  ok?: string;
  /** Lo que quedó, para mostrarlo sin recargar la pantalla. */
  resultado?: { nombre: string; stockResultante: number };
}

/**
 * Sumar unidades a un producto que ya existe.
 *
 * La usa el aviso de duplicados del alta: el vendedor ve que la ficha está y en
 * el mismo lugar le suma lo que llegó. Si tuviera que ir a otra pantalla a
 * buscarla, cargar una ficha nueva sería el camino corto, y eso es justo lo que
 * genera el duplicado.
 */
export async function sumarStockAccion(
  _previo: EstadoStock,
  datos: FormData,
): Promise<EstadoStock> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'stock.ajustar')) {
    return { error: 'No tenés permiso para cambiar el stock.' };
  }

  const id = z.string().uuid().safeParse(datos.get('productId'));
  if (!id.success) return { error: 'No se entiende de qué producto se habla.' };

  const cantidad = z.coerce
    .number()
    .int('Las unidades tienen que ser un número entero.')
    .positive('Poné cuántas unidades entraron.')
    .safeParse(datos.get('cantidad'));
  if (!cantidad.success) {
    return { error: cantidad.error.issues[0]?.message ?? 'Cantidad inválida.' };
  }

  try {
    const r = await sumarStock(db, {
      productId: id.data,
      cantidad: cantidad.data,
      usuarioId: sesion.user.id,
      motivo: (datos.get('motivo') as string | null)?.trim() || null,
    });

    /*
     * Que la tienda se entere ahora y no en diez minutos: el stock que el
     * mostrador acaba de sumar es el que se va a vender hoy. Va en `after` para
     * no hacer esperar a quien está atendiendo — si Woo no contesta, la
     * operación queda en la cola y la levanta la tarea programada.
     */
    after(() => drenarEnSegundoPlano(db));
    revalidatePath('/catalogo');

    return {
      ok: `Listo: «${r.nombre}» queda con ${r.stockResultante}. Ya se puede vender.`,
      resultado: { nombre: r.nombre, stockResultante: r.stockResultante },
    };
  } catch (error) {
    if (error instanceof ErrorStock) return { error: error.message };
    console.error('[stock] Falló la suma:', error);
    return { error: 'No se pudo sumar el stock. Probá de nuevo.' };
  }
}

export interface EstadoPrecio {
  error?: string;
  ok?: string;
  /** Lo que quedó, para mostrarlo sin recargar la pantalla. */
  resultado?: { nombre: string; mostradorCentavos: number };
}

/**
 * Corregir el precio de un producto desde el mostrador.
 *
 * Es lo que pidió Fede el primer día: llegó mercadería con aumento y la ficha
 * quedó vieja. Escribir el precio en la venta arregla esa venta y ninguna de
 * las siguientes; esto arregla la ficha.
 *
 * El permiso es el del alta rápida, no `producto.editar`: quien puede crear una
 * ficha con el precio que quiera ya puede poner cualquier número, así que
 * pedirle más para corregir uno existente solo lo empuja a cargar un duplicado
 * —que es exactamente el problema que el aviso vino a resolver—.
 */
export async function cambiarPrecioAccion(
  _previo: EstadoPrecio,
  datos: FormData,
): Promise<EstadoPrecio> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'producto.alta_rapida')) {
    return { error: 'No tenés permiso para cambiar precios.' };
  }

  const id = z.string().uuid().safeParse(datos.get('productId'));
  if (!id.success) return { error: 'No se entiende de qué producto se habla.' };

  let mostradorCentavos: number;
  try {
    mostradorCentavos = aCentavos(String(datos.get('precio') ?? ''));
  } catch {
    return { error: 'Escribí el precio con números, por ejemplo 45000.' };
  }

  try {
    const r = await cambiarPrecio(db, {
      productId: id.data,
      mostradorCentavos,
      // Se lee acá y no en el cliente: el recargo es del negocio, y si el
      // navegador lo mandara se podría tocar.
      recargoTiendaBp: await recargoDeTienda(db),
      usuarioId: sesion.user.id,
    });

    // Que la web deje de cobrar el precio viejo cuanto antes. Va en `after`
    // para no hacer esperar a quien está atendiendo.
    after(() => drenarEnSegundoPlano(db));
    revalidatePath('/catalogo');
    revalidatePath('/vender');
    revalidatePath('/precios');

    return {
      ok: `«${r.nombre}» pasa a ${formatearARS(r.mostradorCentavos)} en el mostrador.`,
      resultado: { nombre: r.nombre, mostradorCentavos: r.mostradorCentavos },
    };
  } catch (error) {
    if (error instanceof ErrorPrecioFicha) return { error: error.message };
    console.error('[catalogo] Falló el cambio de precio:', error);
    return { error: 'No se pudo cambiar el precio. Probá de nuevo.' };
  }
}

/** Volver a poner a la venta una ficha que estaba inactiva. */
export async function reactivarProductoAccion(
  _previo: EstadoStock,
  datos: FormData,
): Promise<EstadoStock> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'producto.editar')) {
    return { error: 'No tenés permiso para reactivar un producto.' };
  }

  const id = z.string().uuid().safeParse(datos.get('productId'));
  if (!id.success) return { error: 'No se entiende de qué producto se habla.' };

  try {
    const r = await reactivarProducto(db, { productId: id.data, usuarioId: sesion.user.id });
    revalidatePath('/catalogo');
    return { ok: `«${r.nombre}» volvió a estar a la venta.` };
  } catch (error) {
    if (error instanceof ErrorStock) return { error: error.message };
    console.error('[stock] Falló la reactivación:', error);
    return { error: 'No se pudo reactivar. Probá de nuevo.' };
  }
}
