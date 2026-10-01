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
  stockDisponible,
  type Descuento,
  type LineaCarrito,
  type MedioPago,
  type Pago,
  type ProductoVendible,
  type VarianteVendible,
} from './carrito';
import { anotarDeuda } from '@/fiado/cuenta';
import { crearPlan, type Frecuencia } from '@/fiado/plan';
import { fechaLocalISO } from '@/lib/fecha';
import { recargoDeTienda } from '@/precios/config';
import { precioDeMostrador } from '@/precios/mostrador';
import { explicarSospechas, revisarPrecioEscrito, revisarVenta, type Sospecha } from './cordura';

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
      | 'variacion_invalida'
      | 'datos_invalidos',
    /** Detalle estructurado, para que la pantalla pueda ofrecer confirmar. */
    readonly sospechas?: readonly Sospecha[],
  ) {
    super(message);
    this.name = 'ErrorVenta';
  }
}

/**
 * Una venta que se cobró sin conexión y entra después (D56).
 *
 * Es la única parte del sistema donde el precio lo pone la pantalla, y no por
 * comodidad: sin conexión no hay catálogo que consultar, así que lo que se
 * cobró es el único dato que existe de esa venta. Reconstruir el precio al
 * entrar cambiaría lo que el cliente ya pagó y el cajón no cerraría.
 *
 * Lo que la guarda hace en vez de bloquear es **dejar anotada la diferencia**
 * contra el catálogo, para que el dueño la vea en vez de que se pierda.
 */
export interface CobroDiferido {
  /** Cuándo se cobró de verdad. Es la fecha que lleva la venta. */
  capturadaEn: Date;
  /** Lo cobrado por unidad en cada línea, en el mismo orden que `lineas`. */
  preciosCobradosCentavos: readonly number[];
}

/** Lo que pide el cliente. El precio NO viene de acá: lo pone el servidor. */
export interface LineaSolicitada {
  productId: string;
  variantId?: string | null;
  cantidad: number;
  /**
   * El precio escrito en el mostrador, en cualquier producto. Lo que lo cuida
   * no es prohibirlo sino la guarda de cordura, que frena lo que quede muy por
   * debajo del catálogo y solo el dueño puede saltear.
   */
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
  /**
   * Qué sospechas viene a confirmar quien cobra, si viene a confirmar alguna.
   *
   *  - `'escritas'`: los precios que alguien escribió a mano. Es una decisión
   *    de venta y la toma el mostrador.
   *  - `'todas'`: incluye las fichas mal cargadas, que no las eligió nadie.
   *    Cobrar igual ahí es tapar un problema de catálogo, así que es del dueño.
   *
   * Era un booleano, y con los dos casos bajo la misma bandera habilitarle uno
   * al vendedor le habilitaba el otro. Quién manda cada valor lo decide
   * `acciones-venta.ts` contra los permisos, nunca la pantalla.
   */
  confirmarSospechas?: 'escritas' | 'todas';
  /** Presente solo si la venta se cobró sin conexión y entra ahora. */
  diferida?: CobroDiferido | null;
  /**
   * Cómo se va a pagar lo que se fía.
   *
   * Opcional a propósito: sin plan, lo fiado queda como saldo abierto, que es
   * el fiado de toda la vida y sigue siendo lo correcto para los $5.000 del
   * vecino. El plan es para la compra grande.
   */
  plan?: { frecuencia: Frecuencia; cuotas: number } | null;
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
  /** Diferencia entre lo cobrado sin conexión y lo que dice el catálogo hoy. */
  desvioCentavos?: number;
  /** True si al entrar dejó algún stock en negativo: se vendió lo que no había. */
  dejoStockEnRojo?: boolean;
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
      // El vuelto se recalcula desde los pagos guardados. Devolver cero acá
      // hacía que un reintento —el navegador que reenvía, la conexión que se
      // cortó— imprimiera un ticket sin el vuelto que realmente se dio: era el
      // hallazgo 20 de la auditoría.
      const pagados = await tx
        .select({ medio: salePayments.medio, montoCentavos: salePayments.montoCentavos })
        .from(salePayments)
        .where(eq(salePayments.saleId, existente.id));

      const cobrado = calcularCobro(existente.totalCentavos, pagados);

      return {
        id: existente.id,
        numero: existente.numero,
        totalCentavos: existente.totalCentavos,
        vueltoCentavos: cobrado.vueltoCentavos,
        tcAplicadoCentavos: existente.tcAplicadoCentavos,
        yaExistia: true,
      };
    }

    // 2. La sesión de caja tiene que estar abierta.
    const [sesion] = await tx
      .select()
      .from(cashSessions)
      .where(
        and(eq(cashSessions.id, solicitud.cashSessionId), sql`${cashSessions.cerradaEn} IS NULL`),
      )
      .limit(1);

    /*
     * Una venta diferida puede llegar con el turno en el que se cobró ya
     * cerrado: se cortó internet a las ocho, se contó el cajón a las nueve y la
     * conexión volvió a las diez. Esa plata está en el cajón igual, así que la
     * venta entra en el turno que esté abierto ahora y el arqueo la explica en
     * su propia línea, igual que una devolución (D54). Rechazarla dejaría la
     * venta en el navegador para siempre, que es la única forma de perderla.
     */
    let cashSessionId = solicitud.cashSessionId;
    if (!sesion) {
      const [abierta] = solicitud.diferida
        ? await tx
            .select({ id: cashSessions.id })
            .from(cashSessions)
            .where(
              and(
                eq(cashSessions.terminal, solicitud.terminal),
                sql`${cashSessions.cerradaEn} IS NULL`,
              ),
            )
            .limit(1)
        : [];

      if (!abierta) {
        throw new ErrorVenta('No hay una caja abierta. Abrí la caja antes de vender.', 'sin_caja');
      }
      cashSessionId = abierta.id;
    }

    // 3. Cotización vigente, congelada en esta venta.
    const [cotizacion] = filasDe<{ valor_centavos: string | number }>(
      await tx.execute(sql`
        SELECT valor_centavos FROM exchange_rates ORDER BY vigente_desde DESC LIMIT 1
      `),
    );
    const tcCentavos = cotizacion ? Number(cotizacion.valor_centavos) : null;

    //    Y el recargo de la tienda online, que es lo que separa el precio de la
    //    web del de mostrador (D31). Se lee acá adentro para que toda la venta
    //    use el mismo valor aunque alguien lo cambie en el medio.
    const recargoTiendaBp = await recargoDeTienda(tx);

    // 4. Candado sobre los productos del carrito. Se toma en orden de id para
    //    que dos ventas simultáneas no se traben entre sí esperándose.
    const idsProducto = [...new Set(solicitud.lineas.map((l) => l.productId))].sort();
    const filasProducto = filasDe<Record<string, unknown>>(
      await tx.execute(sql`
        SELECT id, nombre, categoria, marca, precio_centavos, moneda, precio_usd_centavos,
               precio_editable, gestiona_stock, stock, stock_comprometido, woo_id, costo_centavos,
               solo_mostrador, precio_local_centavos
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
        soloMostrador: Boolean(f.solo_mostrador),
        precioLocalCentavos:
          f.precio_local_centavos === null ? null : Number(f.precio_local_centavos),
        wooId: f.woo_id === null ? null : Number(f.woo_id),
        costoCentavos: f.costo_centavos === null ? null : Number(f.costo_centavos),
      });
    }

    //    Y las variaciones, con su propio candado. Media tienda son variaciones
    //    (vidrios, hidrogeles y fundas): tienen precio propio y a veces stock
    //    propio, y cobrar el del padre es cobrar mal.
    const idsVariante = [
      ...new Set(solicitud.lineas.map((l) => l.variantId).filter((x): x is string => Boolean(x))),
    ].sort();

    const variantes = new Map<
      string,
      VarianteVendible & { productId: string; wooId: number | null }
    >();
    if (idsVariante.length > 0) {
      const filasVariante = filasDe<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT id, product_id, nombre, precio_centavos, stock, gestiona_stock, activo, woo_id
            FROM product_variants
           WHERE id IN (${sql.join(
             idsVariante.map((id) => sql`${id}`),
             sql`, `,
           )})
           ORDER BY id
             FOR UPDATE
        `),
      );
      for (const f of filasVariante) {
        variantes.set(String(f.id), {
          id: String(f.id),
          productId: String(f.product_id),
          nombre: String(f.nombre),
          precioCentavos: Number(f.precio_centavos),
          stock: Number(f.stock),
          gestionaStock: Boolean(f.gestiona_stock),
          activo: Boolean(f.activo),
          wooId: f.woo_id === null ? null : Number(f.woo_id),
        });
      }
    }

    // 5. Reconstruir las líneas desde el catálogo. El precio lo pone el servidor.
    //    El stock se acumula por donde de verdad se lleva: en la variación si
    //    tiene el suyo, y si no en el producto.
    const lineas: LineaCarrito[] = [];
    const pedidoPorProducto = new Map<string, number>();
    const pedidoPorVariante = new Map<string, number>();
    /** Lo cobrado sin conexión menos lo que el catálogo dice ahora. */
    let desvioCentavos = 0;
    /** El precio que habría puesto el catálogo, antes de pisarlo con lo cobrado. */
    const preciosDeCatalogo: number[] = [];

    for (const [indice, solicitada] of solicitud.lineas.entries()) {
      const p = catalogo.get(solicitada.productId);
      if (!p) {
        throw new ErrorVenta(
          `El producto ya no está en el catálogo. Quitalo del carrito y volvé a buscarlo.`,
          'producto_inexistente',
        );
      }

      let variante: VarianteVendible | null = null;
      if (solicitada.variantId) {
        const v = variantes.get(solicitada.variantId);
        // Que la variación sea de este producto se comprueba acá: si no, un
        // navegador manipulado descontaria stock de otro articulo.
        if (!v || v.productId !== p.id) {
          throw new ErrorVenta(
            `La variación elegida de "${p.nombre}" ya no existe. Quitala del carrito y volvé a buscarla.`,
            'variacion_invalida',
          );
        }
        variante = v;
      }

      const linea = armarLinea(p, solicitada.cantidad, {
        tcCentavos,
        precioManualCentavos: solicitada.precioManualCentavos ?? null,
        variante,
        recargoTiendaBp,
      });

      // Un producto de precio escrito se cobra a lo que se escriba, pero algo
      // hay que escribir: dejarlo en cero es haberse olvidado del renglón.
      if (solicitada.precioManualCentavos != null && linea.precioUnitarioCentavos === 0) {
        throw new ErrorVenta(
          `Escribí el precio de "${linea.descripcion}" antes de cobrar.`,
          'datos_invalidos',
        );
      }

      /*
       * Sin conexión el precio que vale es el que se cobró: es lo que el
       * cliente pagó y lo que hay en el cajón. El del catálogo se calculó
       * igual, unas líneas más arriba, y la diferencia queda anotada.
       */
      if (solicitud.diferida) {
        const cobrado = solicitud.diferida.preciosCobradosCentavos[indice];
        if (cobrado === undefined || !Number.isInteger(cobrado) || cobrado < 0) {
          throw new ErrorVenta(
            `Falta lo que se cobró por "${linea.descripcion}".`,
            'datos_invalidos',
          );
        }
        preciosDeCatalogo.push(linea.precioUnitarioCentavos);
        desvioCentavos += (cobrado - linea.precioUnitarioCentavos) * solicitada.cantidad;
        linea.precioUnitarioCentavos = cobrado;
      }

      linea.descuentoCentavos = Math.max(0, Math.round(solicitada.descuentoCentavos ?? 0));
      lineas.push(linea);

      if (variante?.gestionaStock) {
        pedidoPorVariante.set(
          variante.id,
          (pedidoPorVariante.get(variante.id) ?? 0) + solicitada.cantidad,
        );
      } else if (p.gestionaStock) {
        pedidoPorProducto.set(p.id, (pedidoPorProducto.get(p.id) ?? 0) + solicitada.cantidad);
      }
    }

    // 6. Cordura de precios, por dos caminos.
    //
    //    Uno: un producto que debería estar en dólares y quedó cargado en pesos
    //    con la cifra del dólar pasa todas las demás validaciones —para el
    //    sistema es un iPhone barato—, y lo atrapa el piso por categoría.
    //
    //    Dos: un precio escrito a mano muy por debajo del de referencia. Los
    //    servicios se cobran escribiendo el precio, así que no se puede pedir
    //    permiso para escribirlo; lo que sí se puede es frenar el $1.
    //
    //    Ninguno se bloquea de forma definitiva, pero no los confirma el
    //    mismo: el precio escrito lo confirma quien atiende, y la ficha mal
    //    cargada el dueño, porque ahí lo que hay que hacer es arreglarla.
    //
    //    Una venta diferida no pasa por acá: ya se cobró, el cliente se fue con
    //    el producto y frenarla ahora no deshace nada, solo la deja trabada en
    //    el navegador. Lo que la reemplaza es el desvío anotado arriba, que el
    //    dueño ve en la lista de ventas cargadas después.
    if (solicitud.confirmarSospechas !== 'todas' && !solicitud.diferida) {
      const todas = [
        ...revisarVenta(
          lineas.map((l) => {
            const p = catalogo.get(l.productId)!;
            return {
              producto: {
                nombre: l.descripcion,
                categoria: p.categoria,
                marca: p.marca,
                moneda: p.moneda,
                precioUsdCentavos: p.precioUsdCentavos,
              },
              precioCentavos: l.precioUnitarioCentavos,
            };
          }),
        ),
        ...lineas.flatMap((l, i) => {
          if (solicitud.lineas[i]?.precioManualCentavos == null) return [];
          const p = catalogo.get(l.productId)!;
          // La referencia es el precio de mostrador, no el de la tienda.
          const referencia = precioDeMostrador(p, recargoTiendaBp);
          const s = revisarPrecioEscrito(l.descripcion, l.precioUnitarioCentavos, referencia);
          return s ? [s] : [];
        }),
      ];

      // Lo que vino a confirmar se descuenta; lo que quede frena la venta.
      const sospechas =
        solicitud.confirmarSospechas === 'escritas'
          ? todas.filter((s) => s.tipo !== 'escrito')
          : todas;

      if (sospechas.length > 0) {
        throw new ErrorVenta(explicarSospechas(sospechas), 'precio_sospechoso', sospechas);
      }
    }

    // 7. Stock. Se valida el total pedido por producto y por variación, no
    //    línea por línea: el mismo artículo puede estar en dos renglones.
    //
    //    Tampoco frena a una venta diferida, y por el mismo motivo: sin
    //    conexión el POS no puede reservar nada, así que dos terminales pueden
    //    haber vendido la última unidad. Rechazarla no devuelve el producto que
    //    el cliente ya se llevó; lo único que hace es esconder que faltan dos.
    //    El stock queda en negativo, que es exactamente lo que pasó, y se avisa.
    let dejoStockEnRojo = false;

    for (const [productId, pedido] of pedidoPorProducto) {
      if (pedido === 0) continue;
      const p = catalogo.get(productId)!;
      const disponible = stockDisponible(p);
      if (pedido > disponible) {
        if (!solicitud.diferida) {
          throw new ErrorVenta(
            `No hay stock de "${p.nombre}": quedan ${Math.max(0, disponible)} y se piden ${pedido}.`,
            'sin_stock',
          );
        }
        dejoStockEnRojo = true;
      }
    }

    for (const [variantId, pedido] of pedidoPorVariante) {
      if (pedido === 0) continue;
      const v = variantes.get(variantId)!;
      const p = catalogo.get(v.productId)!;
      if (pedido > v.stock) {
        if (!solicitud.diferida) {
          throw new ErrorVenta(
            `No hay stock de "${p.nombre} — ${v.nombre}": quedan ${Math.max(0, v.stock)} y se piden ${pedido}.`,
            'sin_stock',
          );
        }
        dejoStockEnRojo = true;
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
        cashSessionId,
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
        // La fecha de una venta diferida es la del cobro y no la de la carga:
        // es cuando ocurrió, y todo reporte se recorta por el día del local.
        ...(solicitud.diferida
          ? {
              fecha: solicitud.diferida.capturadaEn,
              offline: true,
              offlineCapturadaEn: solicitud.diferida.capturadaEn,
              offlineDesvioCentavos: desvioCentavos,
            }
          : {}),
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

    // 12 bis. Cuenta corriente: lo que se fía queda como deuda del cliente,
    //         en la misma transacción que la venta. Si la venta no entra, la
    //         deuda tampoco. Acá se comprueba el límite de crédito.
    const fiadoCentavos = solicitud.pagos
      .filter((p) => p.medio === 'cuenta_corriente')
      .reduce((suma, p) => suma + p.montoCentavos, 0);

    if (fiadoCentavos > 0) {
      if (!solicitud.clienteId) {
        throw new ErrorVenta('Para fiar hace falta elegir un cliente.', 'datos_invalidos');
      }
      const deuda = await anotarDeuda(tx, {
        customerId: solicitud.clienteId,
        montoCentavos: fiadoCentavos,
        saleId: ventaId,
        numero,
        usuarioId: solicitud.vendedorId,
      });

      /*
       * El plan de cuotas, si se acordó uno. Va en la misma transacción: una
       * venta fiada cuyo plan falló al guardarse sería peor que no tener plan,
       * porque el mostrador creería que hay fechas y no las habría.
       *
       * Las fechas se cuentan desde el día de la venta —el de verdad, que en
       * una venta cobrada sin conexión es el del cobro y no el de hoy.
       */
      if (solicitud.plan) {
        await crearPlan(tx, {
          creditAccountId: deuda.cuentaId,
          saleId: ventaId,
          montoCentavos: fiadoCentavos,
          cantidad: solicitud.plan.cuotas,
          frecuencia: solicitud.plan.frecuencia,
          desdeISO: fechaLocalISO(solicitud.diferida?.capturadaEn ?? new Date()),
          descripcion: `Venta ${numero}`,
        });
      }
    }

    // 13. Stock: se descuenta donde de verdad se lleva y queda el asiento.
    for (const [productId, pedido] of pedidoPorProducto) {
      if (pedido === 0) continue;
      const p = catalogo.get(productId)!;
      const resultante = p.stock - pedido;

      await tx
        .update(products)
        .set({ stock: resultante, updatedAt: new Date() })
        .where(eq(products.id, productId));

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

    // Variaciones con stock propio. El producto padre no se toca: descontar de
    // los dos contaria la misma unidad dos veces.
    for (const [variantId, pedido] of pedidoPorVariante) {
      if (pedido === 0) continue;
      const v = variantes.get(variantId)!;
      const resultante = v.stock - pedido;

      await tx
        .update(productVariants)
        .set({ stock: resultante })
        .where(eq(productVariants.id, variantId));

      await tx.insert(stockMovements).values({
        productId: v.productId,
        variantId,
        tipo: 'venta',
        cantidad: -pedido,
        stockResultante: resultante,
        motivo: `Venta ${numero}`,
        usuarioId: solicitud.vendedorId,
        referenciaTipo: 'sale',
        referenciaId: ventaId,
      });
    }

    // 14. Caja. El vuelto sale del efectivo, así que a la caja entra el neto.
    //     Se descuenta UNA sola vez aunque el cliente pague con dos billetes
    //     cargados por separado: restárselo a cada pago dejaba la caja en rojo.
    let vueltoPorDescontar = cobro.vueltoCentavos;

    for (const pago of solicitud.pagos) {
      const tipoCuenta = tipoDeCuentaPara(pago.medio);
      if (!tipoCuenta) continue; // cuenta corriente: no entra plata

      const cuentaId = pago.monetaryAccountId ?? (await cuentaPorTipo(tx, tipoCuenta));
      if (!cuentaId) continue;

      const esEfectivo = pago.medio === 'efectivo';
      const vueltoDeEstePago = esEfectivo ? Math.min(vueltoPorDescontar, pago.montoCentavos) : 0;
      vueltoPorDescontar -= vueltoDeEstePago;

      const monto = pago.montoCentavos - vueltoDeEstePago;
      if (monto === 0) continue;

      await tx.insert(cashMovements).values({
        monetaryAccountId: cuentaId,
        cashSessionId,
        tipo: 'venta',
        montoCentavos: monto,
        referenciaTipo: 'sale',
        referenciaId: ventaId,
        usuarioId: solicitud.vendedorId,
        descripcion: `Venta ${numero}${vueltoDeEstePago > 0 ? ' (neto de vuelto)' : ''}`,
      });

      await tx
        .update(monetaryAccounts)
        .set({ saldoCentavos: sql`${monetaryAccounts.saldoCentavos} + ${monto}` })
        .where(eq(monetaryAccounts.id, cuentaId));
    }

    // 15. Cola de sincronización con WooCommerce. Cada renglón apunta a donde
    //     vive el stock: al producto, o a la variación con su id de Woo.
    const aDescontar = [
      ...[...pedidoPorProducto.entries()]
        .filter(([, pedido]) => pedido > 0)
        .map(([productId, pedido]) => ({
          productId,
          wooId: catalogo.get(productId)?.wooId ?? null,
          variantId: null as string | null,
          variantWooId: null as number | null,
          cantidad: pedido,
          stockResultante: (catalogo.get(productId)?.stock ?? 0) - pedido,
        })),
      ...[...pedidoPorVariante.entries()]
        .filter(([, pedido]) => pedido > 0)
        .map(([variantId, pedido]) => {
          const v = variantes.get(variantId)!;
          return {
            productId: v.productId,
            wooId: catalogo.get(v.productId)?.wooId ?? null,
            variantId,
            variantWooId: v.wooId,
            cantidad: pedido,
            stockResultante: v.stock - pedido,
          };
        })
        // Una variación sin id de Woo no se puede escribir allá.
        .filter((x) => x.variantWooId !== null),
    ].filter((x) => x.wooId !== null);

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
        preciosSospechososConfirmados: solicitud.confirmarSospechas ?? false,
        // Lo que hace falta para reconstruir qué pasó con una venta diferida.
        ...(solicitud.diferida
          ? {
              offline: true,
              capturadaEn: solicitud.diferida.capturadaEn.toISOString(),
              desvioCentavos,
              dejoStockEnRojo,
              turnoDelCobro: solicitud.cashSessionId,
              turnoDondeEntro: cashSessionId,
              // Lo cobrado contra lo que el catálogo dice hoy, renglón por renglón.
              precios: lineas.map((l, i) => ({
                descripcion: l.descripcion,
                cobradoCentavos: l.precioUnitarioCentavos,
                catalogoCentavos: preciosDeCatalogo[i] ?? l.precioUnitarioCentavos,
              })),
            }
          : {}),
        // Qué precios escribió a mano quien vendió, contra los del catálogo.
        preciosEscritos: lineas
          .map((l, i) => ({ l, solicitada: solicitud.lineas[i]! }))
          .filter(({ solicitada }) => solicitada.precioManualCentavos != null)
          .map(({ l }) => ({
            descripcion: l.descripcion,
            centavos: l.precioUnitarioCentavos,
            referenciaCentavos: (() => {
              const p = catalogo.get(l.productId);
              return p ? precioDeMostrador(p, recargoTiendaBp) : 0;
            })(),
          })),
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
      desvioCentavos: solicitud.diferida ? desvioCentavos : 0,
      dejoStockEnRojo,
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
