'use server';

/**
 * Acciones de precios.
 *
 * Cambiar el recargo mueve el precio de todo el mostrador de una sola vez, asi
 * que es del dueno y queda en la bitacora.
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { auditar } from '@/lib/auditoria';
import { aCentavos, ErrorDinero } from '@/lib/dinero';
import { products } from '@/db/schema';
import { guardarRecargoDeTienda } from '@/precios/config';
import { ErrorPrecio, formatearRecargo } from '@/precios/mostrador';

export interface EstadoPrecios {
  error?: string;
  ok?: string;
}

/** «12», «12,5» o «12.5» -> puntos basicos. */
function aPuntosBasicos(texto: string): number {
  const limpio = texto.trim().replace(',', '.');
  if (limpio === '' || !/^\d+(\.\d+)?$/.test(limpio)) {
    throw new ErrorPrecio(`«${texto}» no es un porcentaje.`);
  }
  return Math.round(Number(limpio) * 100);
}

export async function guardarRecargoAccion(
  _previo: EstadoPrecios,
  datos: FormData,
): Promise<EstadoPrecios> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'configuracion.editar')) {
    return { error: 'El recargo de la tienda lo cambia el dueño.' };
  }

  try {
    const bp = await guardarRecargoDeTienda(db, {
      bp: aPuntosBasicos(String(datos.get('recargo') ?? '')),
      usuarioId: sesion.user.id,
    });

    revalidatePath('/precios');
    revalidatePath('/vender');

    return {
      ok:
        bp === 0
          ? 'Sin recargo: el mostrador cobra lo mismo que la tienda.'
          : `Recargo guardado en ${formatearRecargo(bp)}. El mostrador ya cobra con el descuento.`,
    };
  } catch (error) {
    if (error instanceof ErrorPrecio) return { error: error.message };
    console.error('[precios] Falló al guardar el recargo:', error);
    return { error: 'No se pudo guardar el recargo.' };
  }
}

const esquemaPrecioLocal = z.object({
  productId: z.string().uuid(),
  precio: z.string().max(20),
});

/**
 * Escribe (o borra) el precio de mostrador propio de un producto.
 *
 * Vaciar el campo devuelve el producto al calculo automatico, que es lo que
 * conviene para casi todo el catalogo.
 */
export async function guardarPrecioLocalAccion(
  _previo: EstadoPrecios,
  datos: FormData,
): Promise<EstadoPrecios> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'producto.editar')) {
    return { error: 'Los precios los cambia el dueño.' };
  }

  const validado = esquemaPrecioLocal.safeParse({
    productId: datos.get('productId'),
    precio: String(datos.get('precio') ?? ''),
  });
  if (!validado.success) return { error: 'No se reconoce ese producto.' };

  const crudo = validado.data.precio.trim();

  let precioLocalCentavos: number | null = null;
  if (crudo !== '') {
    try {
      precioLocalCentavos = aCentavos(crudo);
    } catch (error) {
      return { error: error instanceof ErrorDinero ? `«${crudo}» no es un precio.` : 'Precio inválido.' };
    }
    if (precioLocalCentavos < 0) return { error: 'El precio no puede ser negativo.' };
  }

  const [antes] = await db
    .select({ nombre: products.nombre, previo: products.precioLocalCentavos })
    .from(products)
    .where(eq(products.id, validado.data.productId))
    .limit(1);

  if (!antes) return { error: 'Ese producto ya no está en el catálogo.' };

  await db
    .update(products)
    .set({ precioLocalCentavos, updatedAt: new Date() })
    .where(eq(products.id, validado.data.productId));

  await auditar(db, {
    usuarioId: sesion.user.id,
    accion: 'precios.precio_local',
    entidad: 'products',
    entidadId: validado.data.productId,
    valorAnterior: { precioLocalCentavos: antes.previo },
    valorNuevo: { precioLocalCentavos },
  });

  revalidatePath('/precios');
  revalidatePath('/vender');

  return {
    ok:
      precioLocalCentavos === null
        ? `«${antes.nombre}» vuelve al precio calculado.`
        : `«${antes.nombre}» pasa a cobrarse $${(precioLocalCentavos / 100).toLocaleString('es-AR')} en el mostrador.`,
  };
}
