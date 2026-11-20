/**
 * El recargo por financiar que se le saca al que paga antes de tiempo.
 *
 * El caso que lo pidió, tal cual pasó: un cliente se llevó un teléfono en dos
 * cuotas y se le hizo el precio con financiación. A los dos días volvió y pagó
 * todo junto. El recargo ya no corresponde —no financió nada— pero la deuda lo
 * seguía incluyendo, así que después de entregar el precio de contado le
 * quedaba debiendo exactamente el recargo. En el mostrador eso se arregla
 * discutiendo; en el sistema, hasta ahora, no se arreglaba.
 *
 * **No se toca la venta ni el precio del teléfono.** El teléfono valió lo que
 * valió y su comprobante dice eso. El recargo por financiar vive aparte desde
 * que se armó —en `sales.recargo_financiacion_centavos` y, si hay plan, en
 * `credit_plans.recargo_centavos`— justo para que se lo pueda mover sin
 * reescribir una venta cerrada. Reabrir la venta para bajarle el precio
 * ensuciaría el margen del producto, el reporte del mes y el ticket que el
 * cliente ya tiene en la mano.
 *
 * **No es un pago.** No entró plata: se dejó de cobrar algo. Registrarlo como
 * cobro pondría en la caja del día un ingreso que nadie entregó, que es de lo
 * que se cuidan las entregas migradas de la libreta y la mercadería devuelta.
 * Queda como un cargo negativo, el mismo mecanismo que la devolución.
 *
 * **Las cuotas que faltan se rehacen desde la última.** El que paga antes deja
 * de financiar el final del plan, no el principio: la quita se descuenta de
 * las cuotas más lejanas hacia atrás. Las que ya cobró nadie las toca.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  auditLog,
  creditAccounts,
  creditCharges,
  creditPlans,
  customers,
  installments,
  saleItems,
  sales,
} from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import { cuentaBloqueada, ErrorFiado } from './cuenta';

export interface QuitaRegistrada {
  /** Lo perdonado, en la moneda de la deuda. */
  montoCentavos: number;
  moneda: 'ARS' | 'USD';
  /** Lo que queda debiendo después de la quita, en esa moneda. */
  saldoCentavos: number;
  /** Lo que todavía se le podría perdonar de esta venta. */
  quedaPorQuitarCentavos: number;
  venta: string;
}

/**
 * La moneda de la deuda de una venta, reconstruida de sus renglones.
 *
 * Es la misma regla que al confirmarla: la venta es en dólares cuando TODO lo
 * que se llevó estaba en dólares. Se recalcula en vez de guardarse porque la
 * venta ya tiene los renglones, y un segundo lugar donde anotar la moneda es
 * un segundo lugar donde puede quedar distinta.
 */
async function monedaDeLaDeuda(tx: BaseDatos, saleId: string): Promise<'ARS' | 'USD'> {
  const renglones = await tx
    .select({ moneda: saleItems.monedaOriginal })
    .from(saleItems)
    .where(eq(saleItems.saleId, saleId));
  return renglones.length > 0 && renglones.every((r) => r.moneda === 'USD') ? 'USD' : 'ARS';
}

export async function quitarRecargoDeFinanciacion(
  db: BaseDatos,
  datos: {
    saleId: string;
    /** Cuánto se le perdona. Lo escribe el mostrador: lo pueden partir. */
    montoCentavos: number;
    usuarioId: string;
    nota?: string | null;
  },
): Promise<QuitaRegistrada> {
  if (!Number.isInteger(datos.montoCentavos) || datos.montoCentavos <= 0) {
    throw new ErrorFiado('Lo que se le saca de recargo tiene que ser mayor a cero.', 'monto_invalido');
  }

  return db.transaction(async (tx) => {
    const [venta] = await tx
      .select({
        id: sales.id,
        numero: sales.numero,
        clienteId: sales.clienteId,
        tipo: sales.tipo,
        estado: sales.estado,
        recargoCentavos: sales.recargoFinanciacionCentavos,
        quitadoCentavos: sales.recargoQuitadoCentavos,
      })
      .from(sales)
      .where(eq(sales.id, datos.saleId))
      .limit(1);

    if (!venta) throw new ErrorFiado('No se encontró esa venta.', 'monto_invalido');
    if (venta.estado === 'cancelled') {
      throw new ErrorFiado(
        'Esa venta está anulada: su deuda ya se dio de baja entera, recargo incluido.',
        'monto_invalido',
      );
    }
    if (venta.tipo !== 'fiado' || !venta.clienteId) {
      throw new ErrorFiado('Esa venta no se fió, así que no tiene recargo por financiar.', 'monto_invalido');
    }

    const quedaba = venta.recargoCentavos - venta.quitadoCentavos;
    if (quedaba <= 0) {
      throw new ErrorFiado(
        venta.recargoCentavos === 0
          ? `La venta ${venta.numero} no tuvo recargo por financiar.`
          : `A la venta ${venta.numero} ya se le sacó todo el recargo.`,
        'monto_invalido',
      );
    }
    if (datos.montoCentavos > quedaba) {
      throw new ErrorFiado(
        `De la venta ${venta.numero} queda por sacar ${quedaba / 100} de recargo y se están ` +
          `sacando ${datos.montoCentavos / 100}. No se puede perdonar más recargo del que se cobró.`,
        'monto_invalido',
      );
    }

    const moneda = await monedaDeLaDeuda(tx, venta.id);

    /*
     * Tampoco más de lo que falta cobrar del plan de ESTA venta.
     *
     * No alcanza con mirar la deuda: el cliente puede deber de otras ventas, y
     * entonces el saldo da de sobra mientras que las cuotas de esta ya están
     * casi todas cobradas. Sin este tope, la quita bajaría la deuda por un
     * número que el plan no tiene de dónde descontar —lo ya cobrado no se
     * toca— y el plan terminaría sumando distinto que la deuda.
     */
    const faltaDelPlan = await loQueFaltaCobrarDelPlan(tx, venta.id, moneda);
    if (faltaDelPlan !== null && datos.montoCentavos > faltaDelPlan) {
      throw new ErrorFiado(
        `De la venta ${venta.numero} ya se cobró casi todo: quedan ${faltaDelPlan / 100} por ` +
          `cobrar y no se puede perdonar más que eso. Si le cobraste de más, eso se resuelve aparte.`,
        'monto_invalido',
      );
    }

    const cuenta = await cuentaBloqueada(tx, venta.clienteId);
    const enDolares = moneda === 'USD';
    const saldoAnterior = enDolares ? cuenta.saldoUsdCentavos : cuenta.saldoCentavos;

    /*
     * Más de lo que debe no se descuenta. El fiado no admite saldo negativo a
     * propósito (D36): si el cliente ya pagó de más, eso es plata que el local
     * le debe y se resuelve aparte, no haciéndola desaparecer acá.
     */
    if (datos.montoCentavos > saldoAnterior) {
      const [cliente] = await tx
        .select({ nombre: customers.nombre })
        .from(customers)
        .where(eq(customers.id, venta.clienteId))
        .limit(1);
      throw new ErrorFiado(
        `${cliente?.nombre ?? 'El cliente'} debe ${saldoAnterior / 100} y se le están sacando ` +
          `${datos.montoCentavos / 100}. Si ya pagó de más, eso se resuelve aparte.`,
        'monto_invalido',
      );
    }

    const saldoCentavos = saldoAnterior - datos.montoCentavos;

    await tx
      .update(sales)
      .set({ recargoQuitadoCentavos: venta.quitadoCentavos + datos.montoCentavos })
      .where(eq(sales.id, venta.id));

    await ajustarPlan(tx, venta.id, moneda, datos.montoCentavos);

    await tx.insert(creditCharges).values({
      creditAccountId: cuenta.id,
      tipo: 'quita_recargo',
      descripcion: 'Quita del recargo por financiar',
      detalle: `Venta ${venta.numero} · pagó antes de tiempo`,
      // Negativo: baja la deuda, igual que la mercadería devuelta.
      montoCentavos: -datos.montoCentavos,
      moneda,
      saldoResultanteCentavos: saldoCentavos,
      cargadoPorId: datos.usuarioId,
      nota: datos.nota ?? null,
    });

    await tx
      .update(creditAccounts)
      .set(
        enDolares
          ? { saldoUsdCentavos: saldoCentavos, updatedAt: new Date() }
          : { saldoCentavos, updatedAt: new Date() },
      )
      .where(eq(creditAccounts.id, cuenta.id));

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'fiado.quita_recargo',
      entidad: 'credit_accounts',
      entidadId: cuenta.id,
      valorAnterior: { saldoCentavos: saldoAnterior, moneda },
      valorNuevo: {
        saldoCentavos,
        moneda,
        montoCentavos: datos.montoCentavos,
        venta: venta.numero,
        saleId: venta.id,
        nota: datos.nota ?? null,
      },
    });

    return {
      montoCentavos: datos.montoCentavos,
      moneda,
      saldoCentavos,
      quedaPorQuitarCentavos: quedaba - datos.montoCentavos,
      venta: venta.numero,
    };
  });
}

/**
 * Baja el recargo del plan y rehace lo que falta pagar.
 *
 * Se descuenta de las cuotas impagas **desde la última hacia atrás**: el que
 * paga antes deja de financiar el final del plan, no el principio. Lo que ya
 * cobró queda intacto, porque tiene imputaciones de pagos apuntándole.
 *
 * Sin plan no hay nada que hacer: el fiado «cuando pueda» no tiene cuotas, y
 * su recargo vive solo en la venta.
 */
async function ajustarPlan(
  tx: BaseDatos,
  saleId: string,
  moneda: 'ARS' | 'USD',
  quitaCentavos: number,
): Promise<void> {
  const [plan] = await tx
    .select({
      id: creditPlans.id,
      recargoCentavos: creditPlans.recargoCentavos,
      totalAPagarCentavos: creditPlans.totalAPagarCentavos,
    })
    .from(creditPlans)
    .where(
      and(
        eq(creditPlans.saleId, saleId),
        eq(creditPlans.moneda, moneda),
        isNull(creditPlans.anuladoEn),
      ),
    )
    .limit(1);

  if (!plan) return;

  await tx
    .update(creditPlans)
    .set({
      recargoCentavos: Math.max(0, plan.recargoCentavos - quitaCentavos),
      totalAPagarCentavos: plan.totalAPagarCentavos - quitaCentavos,
    })
    .where(eq(creditPlans.id, plan.id));

  const cuotas = await tx
    .select({
      id: installments.id,
      montoCentavos: installments.montoCentavos,
      pagadoCentavos: installments.pagadoCentavos,
    })
    .from(installments)
    .where(eq(installments.planId, plan.id))
    .orderBy(asc(installments.numero));

  let falta = quitaCentavos;
  for (let i = cuotas.length - 1; i >= 0 && falta > 0; i--) {
    const c = cuotas[i]!;
    // Lo que todavía se le puede bajar a esta cuota sin pisar lo ya cobrado.
    const bajable = Math.min(falta, Math.max(0, c.montoCentavos - c.pagadoCentavos));
    if (bajable === 0) continue;

    const monto = c.montoCentavos - bajable;
    await tx
      .update(installments)
      .set({
        montoCentavos: monto,
        estado: c.pagadoCentavos >= monto ? 'pagada' : 'pendiente',
      })
      .where(eq(installments.id, c.id));
    falta -= bajable;
  }
}

/**
 * Lo que falta cobrar del plan de una venta, o null si no tiene plan.
 *
 * Es el techo de lo que se le puede perdonar: la quita se descuenta de las
 * cuotas impagas, y lo ya cobrado no se toca porque tiene imputaciones de
 * pagos apuntándole.
 */
async function loQueFaltaCobrarDelPlan(
  tx: BaseDatos,
  saleId: string,
  moneda: 'ARS' | 'USD',
): Promise<number | null> {
  const [plan] = await tx
    .select({ id: creditPlans.id })
    .from(creditPlans)
    .where(
      and(
        eq(creditPlans.saleId, saleId),
        eq(creditPlans.moneda, moneda),
        isNull(creditPlans.anuladoEn),
      ),
    )
    .limit(1);
  if (!plan) return null;

  const cuotas = await tx
    .select({
      montoCentavos: installments.montoCentavos,
      pagadoCentavos: installments.pagadoCentavos,
    })
    .from(installments)
    .where(eq(installments.planId, plan.id));

  return cuotas.reduce((t, c) => t + Math.max(0, c.montoCentavos - c.pagadoCentavos), 0);
}

/** Lo que todavía se le puede sacar de recargo a una venta. */
export async function recargoQuePuedeSacarse(db: BaseDatos, saleId: string): Promise<number> {
  const [v] = await db
    .select({
      recargoCentavos: sales.recargoFinanciacionCentavos,
      quitadoCentavos: sales.recargoQuitadoCentavos,
    })
    .from(sales)
    .where(eq(sales.id, saleId))
    .limit(1);
  return v ? Math.max(0, v.recargoCentavos - v.quitadoCentavos) : 0;
}
