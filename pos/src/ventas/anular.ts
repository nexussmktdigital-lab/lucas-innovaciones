/**
 * Anulacion de una venta.
 *
 * Todo cajero se equivoca: cobra dos veces, marca el producto que no era, carga
 * tres unidades en vez de una. Hasta ahora eso no tenia arreglo, porque la
 * venta es inmutable y el stock ya habia bajado.
 *
 * Nada se borra. Anular es agregar los asientos contrarios y marcar la venta
 * como `cancelled`:
 *
 *  - **El stock se repone leyendo los movimientos que dejo la venta**, no
 *    recalculandolo desde las lineas. Si al vender el descuento fue a una
 *    variacion, la devolucion vuelve a esa misma variacion, aunque hoy la ficha
 *    diga otra cosa.
 *  - **La caja se revierte igual**: por cada movimiento de la venta entra el
 *    opuesto, con lo cual el arqueo del turno cierra solo.
 *  - **Solo se anula dentro del mismo turno.** La plata volvio al cajon de ese
 *    turno; revertir contra una caja cerrada dejaria dos arqueos mal. Una venta
 *    de ayer se resuelve con una devolucion, que es otra cosa y llega despues.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  auditLog,
  cashMovements,
  cashSessions,
  creditAccounts,
  monetaryAccounts,
  productVariants,
  products,
  salePayments,
  sales,
  stockMovements,
  syncQueue,
} from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';

export class ErrorAnulacion extends Error {
  constructor(
    message: string,
    readonly motivo:
      | 'no_existe'
      | 'ya_anulada'
      | 'otro_turno'
      | 'sin_caja'
      | 'datos_invalidos',
  ) {
    super(message);
    this.name = 'ErrorAnulacion';
  }
}

export interface DatosAnulacion {
  ventaId: string;
  usuarioId: string;
  /** Por qué se anula. Obligatorio: sin esto la anulación no es información. */
  motivo: string;
}

export interface VentaAnulada {
  ventaId: string;
  numero: string;
  totalCentavos: number;
  /** Cuánta plata salió de la caja al revertir. */
  revertidoCentavos: number;
  unidadesRepuestas: number;
  /** Cuánta deuda de cuenta corriente se le sacó al cliente. */
  deudaBorradaCentavos: number;
}

const MOTIVO_MINIMO = 4;

export async function anularVenta(
  db: BaseDatos,
  datos: DatosAnulacion,
): Promise<VentaAnulada> {
  const motivo = datos.motivo.trim();
  if (motivo.length < MOTIVO_MINIMO) {
    throw new ErrorAnulacion(
      'Escribí por qué se anula la venta: sin el motivo, la anulación no le sirve a nadie.',
      'datos_invalidos',
    );
  }

  return db.transaction(async (tx) => {
    // Candado sobre la venta: dos anulaciones a la vez no pueden reponer el
    // stock dos veces.
    const [venta] = filasDe<{
      id: string;
      numero: string;
      estado: string;
      total_centavos: string | number;
      cash_session_id: string | null;
      cliente_id: string | null;
    }>(
      await tx.execute(sql`
        SELECT id, numero, estado, total_centavos, cash_session_id, cliente_id
          FROM sales WHERE id = ${datos.ventaId} FOR UPDATE
      `),
    );

    if (!venta) throw new ErrorAnulacion('No se encontró esa venta.', 'no_existe');
    if (venta.estado !== 'completed') {
      throw new ErrorAnulacion(`La venta ${venta.numero} ya está anulada.`, 'ya_anulada');
    }

    // El turno de la venta tiene que seguir abierto.
    const [sesion] = await tx
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(and(eq(cashSessions.id, venta.cash_session_id ?? ''), sql`${cashSessions.cerradaEn} IS NULL`))
      .limit(1);

    if (!sesion) {
      throw new ErrorAnulacion(
        `La venta ${venta.numero} es de un turno que ya se cerró. Una venta de un turno cerrado no se anula: se hace una devolución, para no descuadrar el arqueo de ese día.`,
        'otro_turno',
      );
    }

    // 1. Reponer el stock deshaciendo exactamente lo que la venta descontó.
    const movimientos = await tx
      .select({
        productId: stockMovements.productId,
        variantId: stockMovements.variantId,
        cantidad: stockMovements.cantidad,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.referenciaTipo, 'sale'),
          eq(stockMovements.referenciaId, datos.ventaId),
          eq(stockMovements.tipo, 'venta'),
        ),
      );

    const aSincronizar: {
      productId: string;
      wooId: number | null;
      variantId: string | null;
      variantWooId: number | null;
      cantidad: number;
      stockResultante: number;
    }[] = [];
    let unidadesRepuestas = 0;

    for (const m of movimientos) {
      // Los movimientos de venta son negativos: reponer es sumar su opuesto.
      const cantidad = -m.cantidad;
      if (cantidad <= 0) continue;
      unidadesRepuestas += cantidad;

      if (m.variantId) {
        const [v] = await tx
          .update(productVariants)
          .set({ stock: sql`${productVariants.stock} + ${cantidad}` })
          .where(eq(productVariants.id, m.variantId))
          .returning({ stock: productVariants.stock, wooId: productVariants.wooId });

        const [p] = await tx
          .select({ wooId: products.wooId })
          .from(products)
          .where(eq(products.id, m.productId))
          .limit(1);

        await tx.insert(stockMovements).values({
          productId: m.productId,
          variantId: m.variantId,
          tipo: 'devolucion',
          cantidad,
          stockResultante: v?.stock ?? 0,
          motivo: `Anulación de la venta ${venta.numero}: ${motivo}`,
          usuarioId: datos.usuarioId,
          referenciaTipo: 'sale',
          referenciaId: datos.ventaId,
        });

        if (p?.wooId != null && v?.wooId != null) {
          aSincronizar.push({
            productId: m.productId,
            wooId: p.wooId,
            variantId: m.variantId,
            variantWooId: v.wooId,
            cantidad,
            stockResultante: v.stock,
          });
        }
        continue;
      }

      const [p] = await tx
        .update(products)
        .set({ stock: sql`${products.stock} + ${cantidad}`, updatedAt: new Date() })
        .where(eq(products.id, m.productId))
        .returning({ stock: products.stock, wooId: products.wooId });

      await tx.insert(stockMovements).values({
        productId: m.productId,
        tipo: 'devolucion',
        cantidad,
        stockResultante: p?.stock ?? 0,
        motivo: `Anulación de la venta ${venta.numero}: ${motivo}`,
        usuarioId: datos.usuarioId,
        referenciaTipo: 'sale',
        referenciaId: datos.ventaId,
      });

      if (p?.wooId != null) {
        aSincronizar.push({
          productId: m.productId,
          wooId: p.wooId,
          variantId: null,
          variantWooId: null,
          cantidad,
          stockResultante: p.stock,
        });
      }
    }

    // 2. Revertir la plata: por cada movimiento de caja de la venta, el opuesto.
    const enCaja = await tx
      .select({
        monetaryAccountId: cashMovements.monetaryAccountId,
        cashSessionId: cashMovements.cashSessionId,
        montoCentavos: cashMovements.montoCentavos,
      })
      .from(cashMovements)
      .where(
        and(
          eq(cashMovements.referenciaTipo, 'sale'),
          eq(cashMovements.referenciaId, datos.ventaId),
          eq(cashMovements.tipo, 'venta'),
        ),
      );

    let revertidoCentavos = 0;

    for (const m of enCaja) {
      if (m.montoCentavos === 0) continue;
      revertidoCentavos += m.montoCentavos;

      await tx.insert(cashMovements).values({
        monetaryAccountId: m.monetaryAccountId,
        cashSessionId: m.cashSessionId,
        tipo: 'anulacion',
        montoCentavos: -m.montoCentavos,
        referenciaTipo: 'sale',
        referenciaId: datos.ventaId,
        usuarioId: datos.usuarioId,
        descripcion: `Anulación de la venta ${venta.numero}: ${motivo}`,
      });

      await tx
        .update(monetaryAccounts)
        .set({ saldoCentavos: sql`${monetaryAccounts.saldoCentavos} - ${m.montoCentavos}` })
        .where(eq(monetaryAccounts.id, m.monetaryAccountId));
    }

    // 2 bis. Si la venta era fiada, la deuda se va con ella.
    const [fiado] = await tx
      .select({ montoCentavos: salePayments.montoCentavos })
      .from(salePayments)
      .where(
        and(
          eq(salePayments.saleId, datos.ventaId),
          eq(salePayments.medio, 'cuenta_corriente'),
        ),
      );

    let deudaBorradaCentavos = 0;

    if (fiado && venta.cliente_id) {
      deudaBorradaCentavos = await descontarDeuda(tx, {
        customerId: venta.cliente_id,
        montoCentavos: fiado.montoCentavos,
        usuarioId: datos.usuarioId,
        motivo: `Anulación de la venta ${venta.numero}: ${motivo}`,
      });
    }

    // 3. La venta queda anulada, con el motivo a la vista.
    await tx
      .update(sales)
      .set({ estado: 'cancelled', motivoAnulacion: motivo })
      .where(eq(sales.id, datos.ventaId));

    // 4. WooCommerce se entera del stock repuesto por la misma cola de siempre.
    if (aSincronizar.length > 0) {
      await tx.insert(syncQueue).values({
        operacion: 'venta.descontar_stock',
        idempotencyKey: `anulacion:${datos.ventaId}`,
        payload: { ventaId: datos.ventaId, numero: venta.numero, items: aSincronizar },
      });
    }

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'venta.anular',
      entidad: 'sales',
      entidadId: datos.ventaId,
      valorNuevo: {
        numero: venta.numero,
        motivo,
        revertidoCentavos,
        unidadesRepuestas,
        deudaBorradaCentavos,
      },
    });

    return {
      ventaId: datos.ventaId,
      numero: venta.numero,
      totalCentavos: Number(venta.total_centavos),
      revertidoCentavos,
      unidadesRepuestas,
      deudaBorradaCentavos,
    };
  });
}

/**
 * Le saca al cliente la deuda que dejo una venta anulada.
 *
 * Se descuenta como mucho lo que debe: si en el medio pago parte de esa deuda,
 * el saldo no puede quedar negativo. Devuelve cuanto se descuento de verdad.
 */
async function descontarDeuda(
  tx: BaseDatos,
  datos: { customerId: string; montoCentavos: number; usuarioId: string; motivo: string },
): Promise<number> {
  const [cuenta] = filasDe<{ id: string; saldo_centavos: string | number }>(
    await tx.execute(sql`
      SELECT id, saldo_centavos FROM credit_accounts
       WHERE customer_id = ${datos.customerId} FOR UPDATE
    `),
  );
  if (!cuenta) return 0;

  const saldoAnterior = Number(cuenta.saldo_centavos);
  const descontado = Math.min(datos.montoCentavos, saldoAnterior);
  if (descontado <= 0) return 0;

  await tx
    .update(creditAccounts)
    .set({ saldoCentavos: saldoAnterior - descontado, updatedAt: new Date() })
    .where(eq(creditAccounts.id, String(cuenta.id)));

  await tx.insert(auditLog).values({
    usuarioId: datos.usuarioId,
    accion: 'fiado.anular',
    entidad: 'credit_accounts',
    entidadId: String(cuenta.id),
    valorAnterior: { saldoCentavos: saldoAnterior },
    valorNuevo: { saldoCentavos: saldoAnterior - descontado, motivo: datos.motivo },
  });

  return descontado;
}

/**
 * Ventas del turno abierto, de la mas nueva a la mas vieja.
 *
 * Es la pantalla que faltaba: hasta ahora, una vez cerrada la ventana del
 * comprobante no habia forma de volver a el ni de saber que se vendio.
 */
export interface VentaDelTurno {
  id: string;
  numero: string;
  fecha: Date;
  totalCentavos: number;
  estado: 'completed' | 'cancelled';
  motivoAnulacion: string | null;
  vendedor: string | null;
  medios: string[];
  unidades: number;
  detalle: string;
}

export async function ventasDelTurno(
  db: BaseDatos,
  cashSessionId: string,
): Promise<VentaDelTurno[]> {
  const filas = filasDe<{
    id: string;
    numero: string;
    fecha: string | Date;
    total_centavos: string | number;
    estado: 'completed' | 'cancelled';
    motivo_anulacion: string | null;
    vendedor: string | null;
    medios: string[] | null;
    unidades: string | number | null;
    detalle: string | null;
  }>(
    await db.execute(sql`
      SELECT s.id,
             s.numero,
             s.fecha,
             s.total_centavos,
             s.estado,
             s.motivo_anulacion,
             u.nombre AS vendedor,
             (SELECT array_agg(DISTINCT p.medio::text)
                FROM sale_payments p WHERE p.sale_id = s.id)          AS medios,
             (SELECT COALESCE(SUM(i.cantidad), 0)
                FROM sale_items i WHERE i.sale_id = s.id)             AS unidades,
             (SELECT string_agg(i.descripcion, ' · ' ORDER BY i.descripcion)
                FROM sale_items i WHERE i.sale_id = s.id)             AS detalle
        FROM sales s
        LEFT JOIN users u ON u.id = s.vendedor_id
       WHERE s.cash_session_id = ${cashSessionId}
       ORDER BY s.fecha DESC
    `),
  );

  return filas.map((f) => ({
    id: String(f.id),
    numero: String(f.numero),
    fecha: new Date(f.fecha),
    totalCentavos: Number(f.total_centavos),
    estado: f.estado,
    motivoAnulacion: f.motivo_anulacion,
    vendedor: f.vendedor,
    medios: f.medios ?? [],
    unidades: Number(f.unidades ?? 0),
    detalle: f.detalle ?? '',
  }));
}
