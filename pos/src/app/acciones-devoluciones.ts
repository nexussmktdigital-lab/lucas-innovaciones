'use server';

/**
 * Acciones de devoluciones.
 *
 * Es del dueño: devolver plata de una venta de otro turno es una decisión sobre
 * el cajón de hoy, no una corrección de carga. Un vendedor que se equivocó
 * cargando una venta la anula dentro del turno; lo de acá es otra cosa.
 */
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { config } from '@/lib/config';
import { aCentavos, ErrorDinero } from '@/lib/dinero';
import { sesionAbierta } from '@/caja/sesion';
import {
  ErrorDevolucion,
  registrarDevolucion,
  type RenglonADevolver,
} from '@/ventas/devolver';
import { drenarEnSegundoPlano } from '@/woo/cola';

export interface EstadoDevolucion {
  error?: string;
  ok?: string;
  /** La devolución recién hecha, para poder mostrarla. */
  hecha?: {
    numero: string;
    totalCentavos: number;
    devueltoCentavos: number;
    descontadoDeDeudaCentavos: number;
    unidadesAlStock: number;
  };
}

const esquema = z.object({
  ventaId: z.string().uuid(),
  motivo: z.string().min(3, 'Escribí por qué se devuelve.').max(300),
  medio: z.string().max(30).optional(),
  monetaryAccountId: z.string().max(64).optional(),
  descontarDeDeuda: z.string().max(20).optional(),
});

export async function devolverAccion(
  _previo: EstadoDevolucion,
  datos: FormData,
): Promise<EstadoDevolucion> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'venta.anular')) {
    return { error: 'Solo el dueño registra devoluciones.' };
  }

  const leido = esquema.safeParse(Object.fromEntries(datos.entries()));
  if (!leido.success) {
    return { error: leido.error.issues[0]?.message ?? 'Faltan datos de la devolución.' };
  }
  const d = leido.data;

  const terminal = config().POS_TERMINAL;
  const caja = await sesionAbierta(db, terminal);
  if (!caja) {
    return { error: 'No hay una caja abierta. Abrí la caja antes de devolver.' };
  }

  /*
   * Los renglones vienen como `cantidad-<saleItemId>` y `stock-<saleItemId>`.
   * Se arman acá y no en el cliente porque lo que decide cuánto se devuelve es
   * el servidor: el navegador manda lo que quiera.
   */
  const renglones: RenglonADevolver[] = [];
  for (const [clave, valor] of datos.entries()) {
    if (!clave.startsWith('cantidad-')) continue;
    const saleItemId = clave.slice('cantidad-'.length);
    const cantidad = Number(String(valor).trim() || '0');
    if (!Number.isInteger(cantidad) || cantidad <= 0) continue;

    renglones.push({
      saleItemId,
      cantidad,
      vuelveAlStock: datos.get(`stock-${saleItemId}`) === 'on',
    });
  }

  if (renglones.length === 0) {
    return { error: 'Elegí qué se devuelve y cuánto.' };
  }

  let descontarDeDeudaCentavos: number | null = null;
  const crudo = (d.descontarDeDeuda ?? '').trim();
  if (crudo !== '') {
    try {
      descontarDeDeudaCentavos = aCentavos(crudo);
    } catch (e) {
      return { error: e instanceof ErrorDinero ? e.message : 'Ese monto no es válido.' };
    }
  }

  try {
    const hecha = await registrarDevolucion(db, {
      ventaId: d.ventaId,
      renglones,
      motivo: d.motivo,
      usuarioId: sesion.user.id,
      terminal,
      cashSessionId: caja.id,
      medio: (d.medio || null) as never,
      monetaryAccountId: d.monetaryAccountId || null,
      descontarDeDeudaCentavos,
    });

    after(() => drenarEnSegundoPlano(db));

    revalidatePath('/devoluciones');
    revalidatePath('/ventas');
    revalidatePath('/caja');
    revalidatePath('/fiado');
    revalidatePath('/clientes');

    return {
      ok: `Devolución ${hecha.numero} registrada.`,
      hecha: {
        numero: hecha.numero,
        totalCentavos: hecha.totalCentavos,
        devueltoCentavos: hecha.devueltoCentavos,
        descontadoDeDeudaCentavos: hecha.descontadoDeDeudaCentavos,
        unidadesAlStock: hecha.unidadesAlStock,
      },
    };
  } catch (e) {
    if (e instanceof ErrorDevolucion) return { error: e.message };
    console.error('[devoluciones] Falló la devolución:', e);
    return { error: 'No se pudo registrar la devolución.' };
  }
}
