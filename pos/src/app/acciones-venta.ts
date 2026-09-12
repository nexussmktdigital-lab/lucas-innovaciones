'use server';

/**
 * Acciones de venta.
 *
 * Todo lo que decide plata pasa por acá y se valida de nuevo en el servidor.
 * Lo que manda el navegador es una intención —qué producto, cuántas unidades—,
 * nunca un precio.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { config } from '@/lib/config';
import { sesionAbierta } from '@/caja/sesion';
import { confirmarVenta, ErrorVenta } from '@/ventas/confirmar';
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
      confirmarPreciosSospechosos: validado.data.confirmarPreciosSospechosos ?? false,
    });

    // La venta ya está firme. El ajuste a Woo viaja aparte y si falla, espera.
    void drenarEnSegundoPlano(db);

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
    console.error('[venta] Falló la confirmación:', error);
    return {
      ok: false,
      error: 'No se pudo confirmar la venta. No se cobró nada: probá de nuevo.',
    };
  }
}
