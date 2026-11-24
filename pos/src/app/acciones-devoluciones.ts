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
import { ErrorCambio, registrarCambio, type SeLleva } from '@/ventas/cambiar';
import { ErrorVenta } from '@/ventas/confirmar';
import { randomUUID } from 'node:crypto';
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
  /** El cambio recién hecho, cuando se llevó algo a cambio. */
  cambio?: {
    devolucionNumero: string;
    ventaNumero: string;
    vueltoCentavos: number;
    llevadoCentavos: number;
    diferenciaCentavos: number;
  };
}

const esquema = z.object({
  ventaId: z.string().uuid(),
  motivo: z.string().min(3, 'Escribí por qué se devuelve.').max(300),
  medio: z.string().max(30).optional(),
  monetaryAccountId: z.string().max(64).optional(),
  descontarDeDeuda: z.string().max(20).optional(),
  /** Lo que se lleva a cambio, como JSON. Vacío es una devolución común. */
  seLleva: z.string().max(4000).optional(),
});

const esquemaSeLleva = z.array(
  z.object({
    productId: z.string().uuid(),
    cantidad: z.number().int().positive().max(1000),
    variantId: z.string().uuid().nullable().optional(),
  }),
);

export async function devolverAccion(
  _previo: EstadoDevolucion,
  datos: FormData,
): Promise<EstadoDevolucion> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'venta.anular')) {
    return { error: 'No tenés permiso para registrar devoluciones.' };
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

  /*
   * Si se lleva algo a cambio, esto es un cambio y no una devolución.
   *
   * Es la misma pantalla y el mismo botón a propósito: quien atiende ya está
   * eligiendo lo que vuelve, y «y se lleva esto» es el renglón siguiente de la
   * misma conversación con el cliente. Lo que cambia es que las dos mitades se
   * graban juntas y la plata se mueve una sola vez, por la diferencia.
   */
  let seLleva: SeLleva[] = [];
  const crudoSeLleva = (d.seLleva ?? '').trim();
  if (crudoSeLleva !== '' && crudoSeLleva !== '[]') {
    const leidoSeLleva = esquemaSeLleva.safeParse(JSON.parse(crudoSeLleva));
    if (!leidoSeLleva.success) {
      return { error: 'No se entiende qué se lleva a cambio.' };
    }
    seLleva = leidoSeLleva.data;
  }

  if (seLleva.length > 0) {
    try {
      const hecho = await registrarCambio(db, {
        ventaId: d.ventaId,
        devuelve: renglones,
        seLleva,
        motivo: d.motivo,
        usuarioId: sesion.user.id,
        terminal,
        cashSessionId: caja.id,
        medio: (d.medio || null) as never,
        monetaryAccountId: d.monetaryAccountId || null,
        idempotencyKey: randomUUID(),
      });

      after(() => drenarEnSegundoPlano(db));
      revalidatePath('/devoluciones');
      revalidatePath('/ventas');
      revalidatePath('/caja');
      revalidatePath('/catalogo');

      return {
        ok: `Cambio registrado: devolución ${hecho.devolucionNumero} y venta ${hecho.ventaNumero}.`,
        cambio: hecho,
      };
    } catch (error) {
      if (error instanceof ErrorCambio) return { error: error.message };
      if (error instanceof ErrorDevolucion) return { error: error.message };
      if (error instanceof ErrorVenta) return { error: error.message };
      console.error('[devoluciones] Falló el cambio:', error);
      return { error: 'No se pudo registrar el cambio.' };
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
