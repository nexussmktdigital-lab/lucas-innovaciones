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
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { aCentavos, ErrorDinero } from '@/lib/dinero';
import {
  categoriasDelCatalogo,
  crearProducto,
  darFichaPorCompleta,
  ErrorCrear,
  marcasDelCatalogo,
} from '@/catalogo/crear';
import { encolarPublicacion, ErrorPublicar } from '@/catalogo/publicar';
import { ErrorImportar, importarPlanilla, revisarPlanilla } from '@/catalogo/importar';
import { ErrorIA, hayIA, sugerirFicha, type FichaSugerida } from '@/catalogo/ia';
import { drenarEnSegundoPlano } from '@/woo/cola';

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
    return { error: 'Solo el dueño publica productos en la tienda.' };
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
    return { error: 'Solo el dueño da una ficha por terminada.' };
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
  /** El CSV que se revisó, para poder confirmarlo sin volver a pegarlo. */
  csv?: string;
}

/** Paso 1: mirar. No escribe nada. */
export async function revisarPlanillaAccion(
  _previo: EstadoImportacion,
  datos: FormData,
): Promise<EstadoImportacion> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'producto.editar')) {
    return { error: 'Solo el dueño importa planillas.' };
  }

  const csv = String(datos.get('csv') ?? '');

  try {
    return { revision: await revisarPlanilla(db, csv), csv };
  } catch (e) {
    if (e instanceof ErrorImportar) return { error: e.message };
    console.error('[catalogo] Falló la revisión de la planilla:', e);
    return { error: 'No se pudo leer la planilla.' };
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
    return { error: 'Solo el dueño importa planillas.' };
  }

  const csv = String(datos.get('csv') ?? '');
  let creados = 0;

  try {
    const r = await importarPlanilla(db, csv, sesion.user.id);
    creados = r.creados;

    if (r.fallidos.length > 0) {
      const detalle = r.fallidos.map((f) => `línea ${f.linea}: ${f.motivo}`).join(' · ');
      return {
        error: `Entraron ${r.creados}, pero ${r.fallidos.length} no: ${detalle}`,
        csv,
      };
    }
  } catch (e) {
    if (e instanceof ErrorImportar) return { error: e.message };
    console.error('[catalogo] Falló la importación:', e);
    return { error: 'No se pudo importar la planilla.' };
  }

  revalidatePath('/catalogo');
  revalidatePath('/vender');
  revalidatePath('/precios');

  // Se sale de la pantalla de importar: lo que sigue es completar las fichas,
  // y esa lista vive en el catálogo.
  redirect(`/catalogo?importados=${creados}`);
}
