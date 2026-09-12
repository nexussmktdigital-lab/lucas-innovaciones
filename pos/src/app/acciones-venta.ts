'use server';

/**
 * Acciones de venta.
 *
 * Todo lo que decide plata pasa por acá y se valida de nuevo en el servidor.
 * Lo que manda el navegador es una intención —qué producto, cuántas unidades—,
 * nunca un precio.
 */
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { config } from '@/lib/config';
import { sesionAbierta } from '@/caja/sesion';
import { confirmarVenta, ErrorVenta } from '@/ventas/confirmar';
import { anularVenta, ErrorAnulacion } from '@/ventas/anular';
import { ErrorFiado } from '@/fiado/cuenta';
import { drenarEnSegundoPlano } from '@/woo/cola';

const medioPago = z.enum([
  'efectivo',
  'transferencia',
  'debito',
  'credito',
  'dolares',
  'cheque',
  'mercadopago',
  'cuenta_corriente',
]);

const esquemaVenta = z.object({
  lineas: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullish(),
        cantidad: z.number().int().positive().max(9999),
        precioManualCentavos: z.number().int().min(0).nullish(),
        descuentoCentavos: z.number().int().min(0).default(0),
      }),
    )
    .min(1, 'El carrito está vacío.'),
  pagos: z
    .array(
      z.object({
        medio: medioPago,
        montoCentavos: z.number().int().positive(),
        monetaryAccountId: z.string().uuid().nullish(),
        marcaTarjeta: z.string().max(40).nullish(),
        cuotas: z.number().int().positive().max(60).nullish(),
        ultimos4: z.string().regex(/^\d{4}$/).nullish(),
      }),
    )
    .min(1, 'Falta indicar cómo se paga.'),
  descuentoGlobal: z
    .discriminatedUnion('tipo', [
      z.object({ tipo: z.literal('monto'), centavos: z.number().int().min(0) }),
      z.object({ tipo: z.literal('porcentaje'), porcentaje: z.number().min(0).max(100) }),
    ])
    .nullish(),
  clienteId: z.string().uuid().nullish(),
  idempotencyKey: z.string().min(8).max(100),
  nota: z.string().max(500).nullish(),
  /** El dueño vio el cartel de precio sospechoso y decidió vender igual. */
  confirmarPreciosSospechosos: z.boolean().optional(),
});

export type DatosDeVenta = z.input<typeof esquemaVenta>;

export type ResultadoDeVenta =
  | { ok: true; ventaId: string; numero: string; totalCentavos: number; vueltoCentavos: number }
  | {
      ok: false;
      error: string;
      /**
       * Cuando es `precio_sospechoso`, la pantalla puede ofrecerle al dueño
       * confirmar y reintentar. Cualquier otro motivo no se puede saltear.
       */
      motivo?: string;
      puedeConfirmar?: boolean;
    };

export async function registrarVenta(datos: DatosDeVenta): Promise<ResultadoDeVenta> {
  const sesion = await auth();
  if (!sesion?.user) return { ok: false, error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'venta.crear')) {
    return { ok: false, error: 'No tenés permiso para vender.' };
  }

  const validado = esquemaVenta.safeParse(datos);
  if (!validado.success) {
    return { ok: false, error: validado.error.issues[0]?.message ?? 'Datos inválidos.' };
  }

  const terminal = config().POS_TERMINAL;
  const caja = await sesionAbierta(db, terminal);
  if (!caja) {
    return { ok: false, error: 'No hay una caja abierta. Abrí la caja antes de vender.' };
  }

  // Un descuento por encima del umbral necesita autorización del dueño. En la
  // fase 2 solo el dueño puede descontar; el pedido de PIN llega con la fase 4.
  const hayDescuento =
    Boolean(validado.data.descuentoGlobal) ||
    validado.data.lineas.some((l) => (l.descuentoCentavos ?? 0) > 0);

  if (hayDescuento && !puede(sesion.user.rol, 'venta.descuento')) {
    return { ok: false, error: 'Los descuentos los tiene que autorizar el dueño.' };
  }

  // El precio de un servicio se escribe en el mostrador: cada reparación es
  // distinta y pedir permiso para cada una frenaría la venta. Lo que sí se
  // controla es cuánto puede alejarse del precio de referencia del catálogo,
  // y eso lo hace la guarda de cordura, que solo el dueño puede saltear. Que
  // el producto admita precio escrito lo comprueba el dominio contra el
  // catálogo, no contra lo que diga el navegador.

  // Fiar es dar crédito, y eso lo decide el dueño: `fiado.crear` no está entre
  // los permisos del vendedor. Se comprueba acá y de nuevo en la transacción.
  const hayFiado = validado.data.pagos.some((p) => p.medio === 'cuenta_corriente');

  if (hayFiado && !puede(sesion.user.rol, 'fiado.crear')) {
    return { ok: false, error: 'Fiar lo tiene que autorizar el dueño.' };
  }
  if (hayFiado && !validado.data.clienteId) {
    return { ok: false, error: 'Para fiar hace falta elegir un cliente.' };
  }

  // Saltear la guarda de precios es decisión del dueño. Si no lo es, se ignora
  // la bandera y la venta vuelve a pasar por el control: la pantalla no es la
  // que decide esto.
  const salteaGuardaDePrecios =
    (validado.data.confirmarPreciosSospechosos ?? false) && sesion.user.rol === 'owner';

  try {
    const venta = await confirmarVenta(db, {
      lineas: validado.data.lineas.map((l) => ({
        productId: l.productId,
        variantId: l.variantId ?? null,
        cantidad: l.cantidad,
        precioManualCentavos: l.precioManualCentavos ?? null,
        descuentoCentavos: l.descuentoCentavos ?? 0,
      })),
      pagos: validado.data.pagos.map((p) => ({
        medio: p.medio,
        montoCentavos: p.montoCentavos,
        monetaryAccountId: p.monetaryAccountId ?? null,
        marcaTarjeta: p.marcaTarjeta ?? null,
        cuotas: p.cuotas ?? null,
        ultimos4: p.ultimos4 ?? null,
      })),
      descuentoGlobal: validado.data.descuentoGlobal ?? null,
      clienteId: validado.data.clienteId ?? null,
      vendedorId: sesion.user.id,
      cashSessionId: caja.id,
      terminal,
      idempotencyKey: validado.data.idempotencyKey,
      nota: validado.data.nota ?? null,
      autorizadaPorId: hayDescuento ? sesion.user.id : null,
      confirmarPreciosSospechosos: salteaGuardaDePrecios,
    });

    // La venta ya está firme. El ajuste a Woo viaja aparte y si falla, espera.
    // Va en `after` y no suelto: en un entorno serverless una promesa huérfana
    // se corta cuando la respuesta sale, y el drenaje quedaba a medio hacer.
    after(() => drenarEnSegundoPlano(db));

    revalidatePath('/caja');

    return {
      ok: true,
      ventaId: venta.id,
      numero: venta.numero,
      totalCentavos: venta.totalCentavos,
      vueltoCentavos: venta.vueltoCentavos,
    };
  } catch (error) {
    if (error instanceof ErrorVenta) {
      return {
        ok: false,
        error: error.message,
        motivo: error.motivo,
        // Saltear la guarda de precios es decisión del dueño, no del vendedor.
        puedeConfirmar: error.motivo === 'precio_sospechoso' && sesion.user.rol === 'owner',
      };
    }
    // El límite de crédito lo frena el dominio: su mensaje explica qué pasó y
    // qué hacer, así que se pasa tal cual en vez de tragarlo.
    if (error instanceof ErrorFiado) {
      return { ok: false, error: error.message, motivo: error.motivo };
    }
    console.error('[venta] Falló la confirmación:', error);
    return {
      ok: false,
      error: 'No se pudo confirmar la venta. No se cobró nada: probá de nuevo.',
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Anulación                                                                  */
/* -------------------------------------------------------------------------- */

export interface EstadoAnulacion {
  error?: string;
  ok?: string;
}

/**
 * Anula una venta del turno abierto.
 *
 * Solo el dueño: reponer stock y sacar plata de la caja no es una operación de
 * mostrador. El motivo es obligatorio y queda en la bitácora.
 */
export async function anularVentaAccion(
  _previo: EstadoAnulacion,
  datos: FormData,
): Promise<EstadoAnulacion> {
  const sesion = await auth();
  if (!sesion?.user) return { error: 'Se cerró la sesión. Volvé a entrar.' };
  if (!puede(sesion.user.rol, 'venta.anular')) {
    return { error: 'Anular una venta lo tiene que hacer el dueño.' };
  }

  const ventaId = String(datos.get('ventaId') ?? '');
  const motivo = String(datos.get('motivo') ?? '');

  if (!z.string().uuid().safeParse(ventaId).success) {
    return { error: 'No se reconoce esa venta.' };
  }

  try {
    const r = await anularVenta(db, { ventaId, usuarioId: sesion.user.id, motivo });

    // El stock repuesto también tiene que llegar a la tienda online.
    after(() => drenarEnSegundoPlano(db));

    revalidatePath('/ventas');
    revalidatePath('/caja');

    return {
      ok:
        `Venta ${r.numero} anulada. Se repusieron ${r.unidadesRepuestas} ` +
        `${r.unidadesRepuestas === 1 ? 'unidad' : 'unidades'} y salieron ` +
        `${(r.revertidoCentavos / 100).toLocaleString('es-AR')} pesos de la caja.`,
    };
  } catch (error) {
    if (error instanceof ErrorAnulacion) return { error: error.message };
    console.error('[venta] Falló la anulación:', error);
    return { error: 'No se pudo anular la venta. No se tocó nada: probá de nuevo.' };
  }
}
