/**
 * Confirmacion de una venta.
 *
 * Es el codigo mas delicado del sistema. Todo lo que toca plata o stock pasa
 * por una sola transaccion: o entra completo, o no entra nada.
 *
 * Decisiones que vale la pena tener presentes al leerlo:
 *
 *  - **El servidor no confia en el precio del cliente.** Recibe que producto y
 *    cuantas unidades, y reconstruye la linea leyendo el catalogo. Un navegador
 *    manipulado no puede cambiar un precio.
 *  - **El stock se toma con candado de fila.** Dos ventas simultaneas de la
 *    ultima unidad no pueden ganar las dos.
 *  - **WooCommerce se encola, no se llama adentro de la transaccion.** Una
 *    llamada de red dentro de la transaccion tiene un modo de falla feo: si Woo
 *    descuenta y despues falla el commit, se pierde stock sin venta. Asi la
 *    venta queda firme y el ajuste viaja despues.
 *  - **La idempotencia se resuelve antes que nada.** Reintentar la misma venta
 *    devuelve la que ya existe en vez de cobrar dos veces.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  auditLog,
  cashMovements,
  cashSessions,
  monetaryAccounts,
  productVariants,
  products,
  saleItems,
  salePayments,
  sales,
  stockMovements,
  syncQueue,
} from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import {
  armarLinea,
  calcularCobro,
  calcularTotales,
  problemasDelCobro,
  type Descuento,
  type LineaCarrito,
  type MedioPago,
  type Pago,
  type ProductoVendible,
} from './carrito';
import { explicarSospechas, revisarVenta, type Sospecha } from './cordura';

export class ErrorVenta extends Error {
  constructor(
    message: string,
    readonly motivo:
      | 'sin_stock'
      | 'producto_inexistente'
      | 'pago_insuficiente'
      | 'carrito_vacio'
      | 'sin_caja'
      | 'precio_sospechoso'
      | 'datos_invalidos',
    /** Detalle estructurado, para que la pantalla pueda ofrecer confirmar. */
    readonly sospechas?: readonly Sospecha[],
  ) {
    super(message);
    this.name = 'ErrorVenta';
  }
}

/** Lo que pide el cliente. El precio NO viene de acá: lo pone el servidor. */
export interface LineaSolicitada {
  productId: string;
  variantId?: string | null;
  cantidad: number;
  /** Solo se acepta en productos marcados como `precioEditable`. */
  precioManualCentavos?: number | null;
  descuentoCentavos?: number;
}

export interface SolicitudDeVenta {
  lineas: readonly LineaSolicitada[];
  pagos: readonly Pago[];
  descuentoGlobal?: Descuento | null;
  clienteId?: string | null;
  vendedorId: string;
  cashSessionId: string;
  terminal: string;
  /** Misma clave, misma venta. La genera el cliente al abrir el cobro. */
  idempotencyKey: string;
  nota?: string | null;
  /** Dueño que autorizó un descuento o un precio editado, si hizo falta. */
  autorizadaPorId?: string | null;
  /** El dueño vio el cartel de precio sospechoso y decidió vender igual. */
  confirmarPreciosSospechosos?: boolean;
  ip?: string | null;
}

export interface VentaConfirmada {
  id: string;
  numero: string;
  totalCentavos: number;
  vueltoCentavos: number;
  tcAplicadoCentavos: number | null;
  /** True si la venta ya existía: se reintentó con la misma clave. */
  yaExistia: boolean;
}

/** Cuenta monetaria que corresponde a cada medio de pago. */
export function tipoDeCuentaPara(medio: MedioPago): 'efectivo' | 'banco' | 'mercadopago' | null {
  switch (medio) {
    case 'efectivo':
    case 'dolares':
      return 'efectivo';
    case 'transferencia':
    case 'debito':
    case 'credito':
    case 'cheque':
      return 'banco';
    case 'mercadopago':
      return 'mercadopago';
    case 'cuenta_corriente':
      // No entra plata: queda como deuda del cliente.
      return null;
  }
}

function numeroDeVenta(terminal: string, correlativo: number): string {
  return `${terminal}-${String(correlativo).padStart(6, '0')}`;
}

export async function confirmarVenta(
  db: BaseDatos,
  solicitud: SolicitudDeVenta,
): Promise<VentaConfirmada> {
  if (solicitud.lineas.length === 0) {
    throw new ErrorVenta('No se puede confirmar una venta sin productos.', 'carrito_vacio');
  }
  if (!solicitud.idempotencyKey) {
    throw new ErrorVenta('Falta la clave de idempotencia.', 'datos_invalidos');
  }

  return db.transaction(async (tx) => {
    // 1. Idempotencia. Si esta venta ya entró, se devuelve tal cual.
    const [existente] = await tx
      .select({
        id: sales.id,
        numero: sales.numero,
        totalCentavos: sales.totalCentavos,
        tcAplicadoCentavos: sales.tcAplicadoCentavos,
      })
      .from(sales)
      .where(eq(sales.idempotencyKey, solicitud.idempotencyKey))
      .limit(1);

    if (existente) {
      return {
        id: existente.id,
        numero: existente.numero,
        totalCentavos: existente.totalCentavos,
        vueltoCentavos: 0,
        tcAplicadoCentavos: existente.tcAplicadoCentavos,
        yaExistia: true,
      };
    }

    // 2. La sesión de caja tiene que estar abierta.
    const [sesion] = await tx
      .select()
      .from(cashSessions)
      .where(and(eq(cashSessions.id, solicitud.cashSessionId), sql`${cashSessions.cerradaEn} IS NULL`))
      .limit(1);

    if (!sesion) {
      throw new ErrorVenta('No hay una caja abierta. Abrí la caja antes de vender.', 'sin_caja');
    }

    // 3. Cotización vigente, congelada en esta venta.
    const [cotizacion] = filasDe<{ valor_centavos: string | number }>(
      await tx.execute(sql`
        SELECT valor_centavos FROM exchange_rates ORDER BY vigente_desde DESC LIMIT 1
      `),
    );
    const tcCentavos = cotizacion ? Number(cotizacion.valor_centavos) : null;

    // 4. Candado sobre los productos del carrito. Se toma en orden de id para
    //    que dos ventas simultáneas no se traben entre sí esperándose.
    const idsProducto = [...new Set(solicitud.lineas.map((l) => l.productId))].sort();
    const filasProducto = filasDe<Record<string, unknown>>(
      await tx.execute(sql`
        SELECT id, nombre, categoria, marca, precio_centavos, moneda, precio_usd_centavos,
               precio_editable, gestiona_stock, stock, stock_comprometido, woo_id, costo_centavos
          FROM products
         WHERE id IN (${sql.join(
           idsProducto.map((id) => sql`${id}`),
           sql`, `,
         )})
         ORDER BY id
           FOR UPDATE
      `),
    );

    const catalogo = new Map<
      string,
      ProductoVendible & {
        wooId: number | null;
        costoCentavos: number | null;
        categoria: string | null;
        marca: string | null;
      }
    >();
    for (const f of filasProducto) {
      catalogo.set(String(f.id), {
        id: String(f.id),
        nombre: String(f.nombre),
        categoria: f.categoria === null ? null : String(f.categoria),
        marca: f.marca === null ? null : String(f.marca),
        precioCentavos: Number(f.precio_centavos),
        moneda: f.moneda as 'ARS' | 'USD',
        precioUsdCentavos: f.precio_usd_centavos === null ? null : Number(f.precio_usd_centavos),
        precioEditable: Boolean(f.precio_editable),
        gestionaStock: Boolean(f.gestiona_stock),
        stock: Number(f.stock),
        stockComprometido: Number(f.stock_comprometido),
        wooId: f.woo_id === null ? null : Number(f.woo_id),
        costoCentavos: f.costo_centavos === null ? null : Number(f.costo_centavos),
      });
    }

    // 5. Reconstruir las líneas desde el catálogo. El precio lo pone el servidor.
    const lineas: LineaCarrito[] = [];
    const pedidoPorProducto = new Map<string, number>();

    for (const solicitada of solicitud.lineas) {
      const p = catalogo.get(solicitada.productId);
      if (!p) {
        throw new ErrorVenta(
          `El producto ya no está en el catálogo. Quitalo del carrito y volvé a buscarlo.`,
          'producto_inexistente',
        );
      }

      const linea = armarLinea(p, solicitada.cantidad, {
        tcCentavos,
        precioManualCentavos: solicitada.precioManualCentavos ?? null,
        variantId: solicitada.variantId ?? null,
      });
      linea.descuentoCentavos = Math.max(0, Math.round(solicitada.descuentoCentavos ?? 0));
      lineas.push(linea);

      pedidoPorProducto.set(
        p.id,
        (pedidoPorProducto.get(p.id) ?? 0) + (p.gestionaStock ? solicitada.cantidad : 0),
      );
    }

    // 6. Cordura de precios. Un producto que debería estar en dólares y quedó
    //    cargado en pesos con la cifra del dólar pasa todas las demás
    //    validaciones: para el sistema es un iPhone barato. Esto lo frena y
    //    pide que el dueño lo confirme a sabiendas.
    if (!solicitud.confirmarPreciosSospechosos) {
      const sospechas = revisarVenta(
        lineas.map((l) => {
          const p = catalogo.get(l.productId)!;
          return {
            producto: {
              nombre: p.nombre,
              categoria: p.categoria,
              marca: p.marca,
              moneda: p.moneda,
              precioUsdCentavos: p.precioUsdCentavos,
            },
            precioCentavos: l.precioUnitarioCentavos,
          };
        }),
      );

      if (sospechas.length > 0) {
        throw new ErrorVenta(explicarSospechas(sospechas), 'precio_sospechoso', sospechas);
      }
    }

    // 7. Stock. Se valida el total pedido por producto, no línea por línea:
    //    el mismo producto puede estar en dos renglones del carrito.
    for (const [productId, pedido] of pedidoPorProducto) {
      if (pedido === 0) continue;
      const p = catalogo.get(productId)!;
      const disponible = p.stock - p.stockComprometido;
      if (pedido > disponible) {
        throw new ErrorVenta(
          `No hay stock de "${p.nombre}": quedan ${Math.max(0, disponible)} y se piden ${pedido}.`,
          'sin_stock',
        );
      }
    }

    // 8. Totales y cobro, recalculados en el servidor.
    const totales = calcularTotales(lineas, solicitud.descuentoGlobal ?? null);
    const problemas = problemasDelCobro(totales, solicitud.pagos, {
      hayCliente: Boolean(solicitud.clienteId),
    });
    if (problemas.length > 0) {
      throw new ErrorVenta(problemas.join(' '), 'pago_insuficiente');
    }
    const cobro = calcularCobro(totales.totalCentavos, solicitud.pagos);

    // 9. Número correlativo. El upsert es atómico y toma el candado de la fila.
    const [contador] = filasDe<{ ultimo: number }>(
      await tx.execute(sql`
        INSERT INTO sale_counters (terminal, ultimo) VALUES (${solicitud.terminal}, 1)
        ON CONFLICT (terminal) DO UPDATE SET ultimo = sale_counters.ultimo + 1
        RETURNING ultimo
      `),
    );
    const numero = numeroDeVenta(solicitud.terminal, Number(contador!.ultimo));

    // 10. La venta.
    const [venta] = await tx
      .insert(sales)
      .values({
        numero,
        terminal: solicitud.terminal,
        vendedorId: solicitud.vendedorId,
        clienteId: solicitud.clienteId ?? null,
        cashSessionId: solicitud.cashSessionId,
        canal: 'local',
        estado: 'completed',
        tipo: solicitud.pagos.some((p) => p.medio === 'cuenta_corriente') ? 'fiado' : 'contado',
        subtotalCentavos: totales.subtotalCentavos,
        descuentoCentavos: totales.descuentoGlobalCentavos + totales.descuentoLineasCentavos,
        totalCentavos: totales.totalCentavos,
        tcAplicadoCentavos: lineas.some((l) => l.monedaOriginal === 'USD') ? tcCentavos : null,
        idempotencyKey: solicitud.idempotencyKey,
        syncedToWoo: false,
        nota: solicitud.nota ?? null,
        autorizadaPorId: solicitud.autorizadaPorId ?? null,
      })
      .returning({ id: sales.id });

    const ventaId = venta!.id;

    // 11. Las líneas.
    await tx.insert(saleItems).values(
      lineas.map((l) => ({
        saleId: ventaId,
        productId: l.productId,
        variantId: l.variantId ?? null,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioUnitarioCentavos: l.precioUnitarioCentavos,
        monedaOriginal: l.monedaOriginal,
        precioUsdCentavos: l.precioUsdCentavos,
        descuentoCentavos: l.descuentoCentavos,
        costoCentavos: catalogo.get(l.productId)?.costoCentavos ?? null,
        totalCentavos: Math.max(0, l.precioUnitarioCentavos * l.cantidad - l.descuentoCentavos),
      })),
    );

    // 12. Los pagos.
    await tx.insert(salePayments).values(
      solicitud.pagos.map((p) => ({
        saleId: ventaId,
        medio: p.medio,
        monetaryAccountId: p.monetaryAccountId ?? null,
        montoCentavos: p.montoCentavos,
        marcaTarjeta: p.marcaTarjeta ?? null,
        cuotas: p.cuotas ?? null,
        ultimos4: p.ultimos4 ?? null,
      })),
    );

    // 13. Stock: se descuenta y queda el asiento.
    for (const [productId, pedido] of pedidoPorProducto) {
      if (pedido === 0) continue;
      const p = catalogo.get(productId)!;
      const resultante = p.stock - pedido;

      await tx.update(products).set({ stock: resultante, updatedAt: new Date() }).where(eq(products.id, productId));

      await tx.insert(stockMovements).values({
        productId,
        tipo: 'venta',
        cantidad: -pedido,
        stockResultante: resultante,
        motivo: `Venta ${numero}`,
        usuarioId: solicitud.vendedorId,
        referenciaTipo: 'sale',
        referenciaId: ventaId,
      });
    }

    // Variaciones: llevan su propio stock.
    for (const l of lineas) {
      if (!l.variantId) continue;
      await tx
        .update(productVariants)
        .set({ stock: sql`${productVariants.stock} - ${l.cantidad}` })
        .where(eq(productVariants.id, l.variantId));
    }

    // 14. Caja. El vuelto sale del efectivo, así que a la caja entra el neto.
    for (const pago of solicitud.pagos) {
      const tipoCuenta = tipoDeCuentaPara(pago.medio);
      if (!tipoCuenta) continue; // cuenta corriente: no entra plata

      const cuentaId = pago.monetaryAccountId ?? (await cuentaPorTipo(tx, tipoCuenta));
      if (!cuentaId) continue;

      const esEfectivo = pago.medio === 'efectivo';
      const monto = esEfectivo ? pago.montoCentavos - cobro.vueltoCentavos : pago.montoCentavos;
      if (monto === 0) continue;

      await tx.insert(cashMovements).values({
        monetaryAccountId: cuentaId,
        cashSessionId: solicitud.cashSessionId,
        tipo: 'venta',
        montoCentavos: monto,
        referenciaTipo: 'sale',
        referenciaId: ventaId,
        usuarioId: solicitud.vendedorId,
        descripcion: `Venta ${numero}${esEfectivo && cobro.vueltoCentavos > 0 ? ' (neto de vuelto)' : ''}`,
      });

      await tx
        .update(monetaryAccounts)
        .set({ saldoCentavos: sql`${monetaryAccounts.saldoCentavos} + ${monto}` })
        .where(eq(monetaryAccounts.id, cuentaId));
    }

    // 15. Cola de sincronización con WooCommerce.
    const aDescontar = [...pedidoPorProducto.entries()]
      .filter(([, pedido]) => pedido > 0)
      .map(([productId, pedido]) => ({
        productId,
        wooId: catalogo.get(productId)?.wooId ?? null,
        cantidad: pedido,
        stockResultante: (catalogo.get(productId)?.stock ?? 0) - pedido,
      }))
      .filter((x) => x.wooId !== null);

    if (aDescontar.length > 0) {
      await tx.insert(syncQueue).values({
        operacion: 'venta.descontar_stock',
        idempotencyKey: `venta:${solicitud.idempotencyKey}`,
        payload: { ventaId, numero, items: aDescontar },
      });
    }

    // 16. Auditoría, dentro de la misma transacción que lo que describe.
    await tx.insert(auditLog).values({
      usuarioId: solicitud.vendedorId,
      accion: 'venta.confirmar',
      entidad: 'sales',
      entidadId: ventaId,
      valorNuevo: {
        numero,
        totalCentavos: totales.totalCentavos,
        unidades: totales.unidades,
        medios: solicitud.pagos.map((p) => p.medio),
        autorizadaPor: solicitud.autorizadaPorId ?? null,
        preciosSospechososConfirmados: solicitud.confirmarPreciosSospechosos ?? false,
      },
      ip: solicitud.ip ?? null,
    });

    return {
      id: ventaId,
      numero,
      totalCentavos: totales.totalCentavos,
      vueltoCentavos: cobro.vueltoCentavos,
      tcAplicadoCentavos: lineas.some((l) => l.monedaOriginal === 'USD') ? tcCentavos : null,
      yaExistia: false,
    };
  });
}

async function cuentaPorTipo(
  tx: BaseDatos,
  tipo: 'efectivo' | 'banco' | 'mercadopago',
): Promise<string | null> {
  const [cuenta] = await tx
    .select({ id: monetaryAccounts.id })
    .from(monetaryAccounts)
    .where(and(eq(monetaryAccounts.tipo, tipo), eq(monetaryAccounts.activo, true)))
    .limit(1);
  return cuenta?.id ?? null;
}
