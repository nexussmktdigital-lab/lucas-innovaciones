/**
 * Devoluciones de ventas de turnos cerrados.
 *
 * Anular es para el error de carga y solo dentro del turno abierto (D29):
 * revertir contra una caja cerrada descuadra dos arqueos, el de aquel día y el
 * de hoy. Pero el cliente que vuelve el jueves con el cargador que no anda es
 * real, y hasta esta fase el sistema no tenía nada para él.
 *
 * Una devolución no es una anulación, y la diferencia es lo que sostiene todo
 * el diseño:
 *
 *  - **La venta original no se toca.** Se hizo, se cobró y quedó en el arqueo de
 *    aquel turno. Sigue exactamente como estaba, y ese arqueo no cambia.
 *  - **El movimiento cae en el turno de hoy**, que es cuando la plata sale del
 *    cajón de verdad y cuando la mercadería vuelve al local.
 *  - **Puede ser parcial**: de tres cosas se devuelve una, y de dos unidades
 *    una sola.
 *
 * Dos decisiones que el sistema no puede tomar solo y por eso pregunta:
 *
 *  - **Si vuelve al stock.** Un cargador fallado no se vuelve a vender. Se
 *    decide producto por producto.
 *  - **Si sale plata o baja la deuda.** Cuando el cliente todavía debe de esa
 *    venta, devolverle efectivo y dejarle la deuda entera es dos veces mal. Lo
 *    que se propone es descontar primero y devolver el resto, pero quien
 *    atiende puede elegir.
 */
import { desc, eq, sql } from 'drizzle-orm';
import {
  auditLog,
  cashMovements,
  creditAccounts,
  customers,
  monetaryAccounts,
  productVariants,
  products,
  returnItems,
  returns,
  saleItems,
  sales,
  stockMovements,
  syncQueue,
  users,
} from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import type { MedioPago } from './carrito';

export class ErrorDevolucion extends Error {
  constructor(
    mensaje: string,
    readonly motivo:
      | 'no_existe'
      | 'anulada'
      | 'sin_caja'
      | 'nada_que_devolver'
      | 'de_mas'
      | 'datos_invalidos' = 'datos_invalidos',
  ) {
    super(mensaje);
  }
}

/** Lo que se puede devolver de una línea, ya descontado lo devuelto antes. */
export interface LineaDevolvible {
  saleItemId: string;
  productId: string;
  variantId: string | null;
  descripcion: string;
  cantidadVendida: number;
  cantidadDevuelta: number;
  cantidadDisponible: number;
  /** Lo que se cobró por unidad, con el descuento global ya prorrateado. */
  precioUnitarioCentavos: number;
  gestionaStock: boolean;
}

export interface VentaDevolvible {
  ventaId: string;
  numero: string;
  fecha: Date;
  totalCentavos: number;
  tipo: 'contado' | 'fiado';
  clienteId: string | null;
  cliente: string | null;
  /** Lo que el cliente todavía debe en su cuenta corriente, si tiene. */
  deudaDelClienteCentavos: number;
  lineas: LineaDevolvible[];
  /** Devoluciones que ya se hicieron de esta venta. */
  yaDevueltoCentavos: number;
}

/**
 * Qué se puede devolver de una venta.
 *
 * El precio por unidad sale prorrateando el descuento global, igual que en los
 * reportes: devolver el precio de lista de una venta hecha con 10% de descuento
 * es devolverle al cliente más plata de la que entró.
 */
export async function loDevolvible(
  db: BaseDatos,
  ventaId: string,
): Promise<VentaDevolvible | null> {
  const [venta] = await db
    .select({
      id: sales.id,
      numero: sales.numero,
      fecha: sales.fecha,
      estado: sales.estado,
      tipo: sales.tipo,
      totalCentavos: sales.totalCentavos,
      subtotalCentavos: sales.subtotalCentavos,
      clienteId: sales.clienteId,
    })
    .from(sales)
    .where(eq(sales.id, ventaId))
    .limit(1);

  if (!venta) return null;
  if (venta.estado === 'cancelled') {
    throw new ErrorDevolucion(
      `La venta ${venta.numero} está anulada: no hay nada que devolver.`,
      'anulada',
    );
  }

  const lineas = filasDe<{
    id: string;
    product_id: string;
    variant_id: string | null;
    descripcion: string;
    cantidad: number;
    precio_unitario: string | number;
    devuelta: string | number;
    gestiona_stock: boolean;
  }>(
    await db.execute(sql`
      SELECT
        i.id, i.product_id, i.variant_id, i.descripcion, i.cantidad,
        -- Lo cobrado de verdad por unidad: el descuento global vive en la venta
        -- y no baja a las líneas.
        ROUND(
          (i.total_centavos::numeric / i.cantidad)
          * ${venta.totalCentavos} / NULLIF(${venta.subtotalCentavos}, 0)
        )::bigint                                                   AS precio_unitario,
        COALESCE((
          SELECT SUM(ri.cantidad) FROM return_items ri WHERE ri.sale_item_id = i.id
        ), 0)                                                       AS devuelta,
        COALESCE(pr.gestiona_stock, false)                          AS gestiona_stock
      FROM sale_items i
      LEFT JOIN products pr ON pr.id = i.product_id
      WHERE i.sale_id = ${ventaId}
      ORDER BY i.descripcion
    `),
  );

  const [cliente] = venta.clienteId
    ? await db
        .select({ nombre: customers.nombre })
        .from(customers)
        .where(eq(customers.id, venta.clienteId))
        .limit(1)
    : [];

  const [cuenta] = venta.clienteId
    ? await db
        .select({ saldo: creditAccounts.saldoCentavos })
        .from(creditAccounts)
        .where(eq(creditAccounts.customerId, venta.clienteId))
        .limit(1)
    : [];

  const [ya] = filasDe<{ total: string | number }>(
    await db.execute(
      sql`SELECT COALESCE(SUM(total_centavos), 0) AS total FROM returns WHERE sale_id = ${ventaId}`,
    ),
  );

  return {
    ventaId: venta.id,
    numero: venta.numero,
    fecha: venta.fecha,
    totalCentavos: venta.totalCentavos,
    tipo: venta.tipo,
    clienteId: venta.clienteId,
    cliente: cliente?.nombre ?? null,
    deudaDelClienteCentavos: cuenta?.saldo ?? 0,
    yaDevueltoCentavos: Number(ya?.total ?? 0),
    lineas: lineas.map((l) => ({
      saleItemId: l.id,
      productId: l.product_id,
      variantId: l.variant_id,
      descripcion: l.descripcion,
      cantidadVendida: l.cantidad,
      cantidadDevuelta: Number(l.devuelta),
      cantidadDisponible: l.cantidad - Number(l.devuelta),
      precioUnitarioCentavos: Number(l.precio_unitario),
      gestionaStock: l.gestiona_stock,
    })),
  };
}

export interface RenglonADevolver {
  saleItemId: string;
  cantidad: number;
  /** Un producto fallado no vuelve al stock vendible. */
  vuelveAlStock: boolean;
}

export interface DatosDevolucion {
  ventaId: string;
  renglones: readonly RenglonADevolver[];
  motivo: string;
  usuarioId: string;
  terminal: string;
  /** El turno de hoy, donde cae el movimiento. */
  cashSessionId: string;
  /** Por dónde sale la plata. No hace falta si todo va contra la deuda. */
  medio?: MedioPago | null;
  monetaryAccountId?: string | null;
  /**
   * Cuánto se descuenta de lo que el cliente debe, en vez de devolvérselo.
   *
   * Si no viene, se descuenta todo lo que se pueda: devolverle efectivo a quien
   * todavía debe por esa misma venta es equivocarse dos veces.
   */
  descontarDeDeudaCentavos?: number | null;
  ip?: string | null;
}

export interface DevolucionRegistrada {
  id: string;
  numero: string;
  totalCentavos: number;
  devueltoCentavos: number;
  descontadoDeDeudaCentavos: number;
  unidades: number;
  unidadesAlStock: number;
}

export async function registrarDevolucion(
  db: BaseDatos,
  datos: DatosDevolucion,
): Promise<DevolucionRegistrada> {
  const motivo = datos.motivo.trim();
  if (motivo.length < 3) {
    throw new ErrorDevolucion('Escribí por qué se devuelve.', 'datos_invalidos');
  }
  if (datos.renglones.length === 0) {
    throw new ErrorDevolucion('Elegí qué se devuelve.', 'nada_que_devolver');
  }

  return db.transaction(async (tx) => {
    /*
     * Se traba la venta antes de mirar qué queda por devolver. Sin esto, dos
     * devoluciones de la misma venta a la vez leen las dos que quedan dos
     * unidades y devuelven cuatro, que es plata que el negocio no cobró. Es la
     * misma traba que usa anular, y se pone acá y no en `loDevolvible` porque
     * ese también se lee para mostrar, fuera de transacción.
     */
    const [trabada] = filasDe<{ id: string }>(
      await tx.execute(sql`SELECT id FROM sales WHERE id = ${datos.ventaId} FOR UPDATE`),
    );
    if (!trabada) throw new ErrorDevolucion('No se encuentra esa venta.', 'no_existe');

    const devolvible = await loDevolvible(tx, datos.ventaId);
    if (!devolvible) throw new ErrorDevolucion('No se encuentra esa venta.', 'no_existe');

    // El turno tiene que estar abierto: la plata sale de un cajón concreto.
    const [sesion] = filasDe<{ id: string }>(
      await tx.execute(sql`
        SELECT id FROM cash_sessions
         WHERE id = ${datos.cashSessionId} AND cerrada_en IS NULL
      `),
    );
    if (!sesion) {
      throw new ErrorDevolucion(
        'No hay una caja abierta. Abrí la caja antes de devolver.',
        'sin_caja',
      );
    }

    const porLinea = new Map(devolvible.lineas.map((l) => [l.saleItemId, l]));
    const aGuardar: {
      linea: LineaDevolvible;
      cantidad: number;
      vuelveAlStock: boolean;
      totalCentavos: number;
    }[] = [];

    let totalCentavos = 0;
    let unidades = 0;

    for (const r of datos.renglones) {
      if (r.cantidad <= 0) continue;
      const linea = porLinea.get(r.saleItemId);
      if (!linea) {
        throw new ErrorDevolucion('Ese renglón no es de esta venta.', 'datos_invalidos');
      }
      if (!Number.isInteger(r.cantidad)) {
        throw new ErrorDevolucion('La cantidad tiene que ser un número entero.', 'datos_invalidos');
      }
      if (r.cantidad > linea.cantidadDisponible) {
        throw new ErrorDevolucion(
          linea.cantidadDevuelta > 0
            ? `De «${linea.descripcion}» ya se devolvieron ${linea.cantidadDevuelta} de ${linea.cantidadVendida}: quedan ${linea.cantidadDisponible}.`
            : `De «${linea.descripcion}» se vendieron ${linea.cantidadVendida}, no se pueden devolver ${r.cantidad}.`,
          'de_mas',
        );
      }

      const total = linea.precioUnitarioCentavos * r.cantidad;
      totalCentavos += total;
      unidades += r.cantidad;
      aGuardar.push({
        linea,
        cantidad: r.cantidad,
        vuelveAlStock: r.vuelveAlStock && linea.gestionaStock,
        totalCentavos: total,
      });
    }

    if (aGuardar.length === 0) {
      throw new ErrorDevolucion('Elegí qué se devuelve.', 'nada_que_devolver');
    }
    if (totalCentavos <= 0) {
      throw new ErrorDevolucion(
        'Lo que se devuelve no tiene valor: no hay plata que mover.',
        'nada_que_devolver',
      );
    }

    /*
     * Cuánto se descuenta de la deuda y cuánto sale del cajón.
     *
     * Por defecto se descuenta todo lo que la deuda permita. Devolverle
     * efectivo a quien todavía debe por esa misma venta deja al negocio sin la
     * plata y con la deuda igual.
     */
    const tope = Math.min(devolvible.deudaDelClienteCentavos, totalCentavos);
    const descontadoDeDeudaCentavos =
      datos.descontarDeDeudaCentavos === null || datos.descontarDeDeudaCentavos === undefined
        ? tope
        : Math.max(0, Math.min(datos.descontarDeDeudaCentavos, tope));
    const devueltoCentavos = totalCentavos - descontadoDeDeudaCentavos;

    if (devueltoCentavos > 0 && (!datos.medio || !datos.monetaryAccountId)) {
      throw new ErrorDevolucion(
        'Decí por dónde sale la plata que se le devuelve.',
        'datos_invalidos',
      );
    }

    // Correlativo propio, con el mismo contador atómico que las ventas.
    const [contador] = filasDe<{ ultimo: number }>(
      await tx.execute(sql`
        INSERT INTO sale_counters (terminal, ultimo) VALUES (${`DEV-${datos.terminal}`}, 1)
        ON CONFLICT (terminal) DO UPDATE SET ultimo = sale_counters.ultimo + 1
        RETURNING ultimo
      `),
    );
    const numero = `DEV-${datos.terminal}-${String(Number(contador!.ultimo)).padStart(6, '0')}`;

    const [devolucion] = await tx
      .insert(returns)
      .values({
        numero,
        saleId: datos.ventaId,
        terminal: datos.terminal,
        cashSessionId: datos.cashSessionId,
        usuarioId: datos.usuarioId,
        clienteId: devolvible.clienteId,
        motivo,
        totalCentavos,
        devueltoCentavos,
        descontadoDeDeudaCentavos,
        medio: devueltoCentavos > 0 ? (datos.medio ?? null) : null,
        monetaryAccountId: devueltoCentavos > 0 ? (datos.monetaryAccountId ?? null) : null,
      })
      .returning({ id: returns.id });

    const devolucionId = devolucion!.id;

    await tx.insert(returnItems).values(
      aGuardar.map((x) => ({
        returnId: devolucionId,
        saleItemId: x.linea.saleItemId,
        productId: x.linea.productId,
        variantId: x.linea.variantId,
        descripcion: x.linea.descripcion,
        cantidad: x.cantidad,
        precioUnitarioCentavos: x.linea.precioUnitarioCentavos,
        totalCentavos: x.totalCentavos,
        vuelveAlStock: x.vuelveAlStock,
      })),
    );

    // 1. El stock, solo de lo que vuelve a estar vendible.
    const aSincronizar: {
      productId: string;
      wooId: number;
      variantId: string | null;
      variantWooId: number | null;
      cantidad: number;
      stockResultante: number;
    }[] = [];
    let unidadesAlStock = 0;

    for (const x of aGuardar) {
      if (!x.vuelveAlStock) continue;
      unidadesAlStock += x.cantidad;

      if (x.linea.variantId) {
        const [v] = await tx
          .update(productVariants)
          .set({ stock: sql`${productVariants.stock} + ${x.cantidad}` })
          .where(eq(productVariants.id, x.linea.variantId))
          .returning({ stock: productVariants.stock, wooId: productVariants.wooId });

        const [p] = await tx
          .select({ wooId: products.wooId })
          .from(products)
          .where(eq(products.id, x.linea.productId))
          .limit(1);

        await tx.insert(stockMovements).values({
          productId: x.linea.productId,
          variantId: x.linea.variantId,
          tipo: 'devolucion',
          cantidad: x.cantidad,
          stockResultante: v?.stock ?? 0,
          motivo: `Devolución ${numero} de la venta ${devolvible.numero}: ${motivo}`,
          usuarioId: datos.usuarioId,
          referenciaTipo: 'returns',
          referenciaId: devolucionId,
        });

        if (p?.wooId != null && v?.wooId != null) {
          aSincronizar.push({
            productId: x.linea.productId,
            wooId: p.wooId,
            variantId: x.linea.variantId,
            variantWooId: v.wooId,
            cantidad: x.cantidad,
            stockResultante: v.stock,
          });
        }
        continue;
      }

      const [p] = await tx
        .update(products)
        .set({ stock: sql`${products.stock} + ${x.cantidad}`, updatedAt: new Date() })
        .where(eq(products.id, x.linea.productId))
        .returning({ stock: products.stock, wooId: products.wooId });

      await tx.insert(stockMovements).values({
        productId: x.linea.productId,
        tipo: 'devolucion',
        cantidad: x.cantidad,
        stockResultante: p?.stock ?? 0,
        motivo: `Devolución ${numero} de la venta ${devolvible.numero}: ${motivo}`,
        usuarioId: datos.usuarioId,
        referenciaTipo: 'returns',
        referenciaId: devolucionId,
      });

      if (p?.wooId != null) {
        aSincronizar.push({
          productId: x.linea.productId,
          wooId: p.wooId,
          variantId: null,
          variantWooId: null,
          cantidad: x.cantidad,
          stockResultante: p.stock,
        });
      }
    }

    // 2. La plata que sale del cajón de hoy.
    if (devueltoCentavos > 0) {
      const cuentaId = datos.monetaryAccountId!;

      await tx.insert(cashMovements).values({
        monetaryAccountId: cuentaId,
        cashSessionId: datos.cashSessionId,
        // Es una salida, y va marcada como anulación para que el arqueo la
        // descuente con el mismo camino que ya usa para lo que sale del cajón.
        tipo: 'anulacion',
        montoCentavos: -devueltoCentavos,
        referenciaTipo: 'returns',
        referenciaId: devolucionId,
        usuarioId: datos.usuarioId,
        descripcion: `Devolución ${numero} de la venta ${devolvible.numero}`,
      });

      await tx
        .update(monetaryAccounts)
        .set({ saldoCentavos: sql`${monetaryAccounts.saldoCentavos} - ${devueltoCentavos}` })
        .where(eq(monetaryAccounts.id, cuentaId));
    }

    // 3. La deuda que se le perdona, si corresponde.
    if (descontadoDeDeudaCentavos > 0 && devolvible.clienteId) {
      await tx
        .update(creditAccounts)
        .set({
          saldoCentavos: sql`GREATEST(${creditAccounts.saldoCentavos} - ${descontadoDeDeudaCentavos}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(creditAccounts.customerId, devolvible.clienteId));
    }

    // 4. Que la tienda online se entere del stock que volvió.
    if (aSincronizar.length > 0) {
      await tx.insert(syncQueue).values({
        operacion: 'venta.descontar_stock',
        idempotencyKey: `devolucion:${devolucionId}`,
        payload: { ventaId: datos.ventaId, numero, items: aSincronizar },
      });
    }

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'venta.devolver',
      entidad: 'returns',
      entidadId: devolucionId,
      valorNuevo: {
        numero,
        venta: devolvible.numero,
        motivo,
        totalCentavos,
        devueltoCentavos,
        descontadoDeDeudaCentavos,
        unidades,
        unidadesAlStock,
        renglones: aGuardar.map((x) => ({
          descripcion: x.linea.descripcion,
          cantidad: x.cantidad,
          vuelveAlStock: x.vuelveAlStock,
        })),
      },
      ip: datos.ip ?? null,
    });

    return {
      id: devolucionId,
      numero,
      totalCentavos,
      devueltoCentavos,
      descontadoDeDeudaCentavos,
      unidades,
      unidadesAlStock,
    };
  });
}

export interface DevolucionEnLista {
  id: string;
  numero: string;
  fecha: Date;
  ventaId: string;
  ventaNumero: string;
  cliente: string | null;
  motivo: string;
  totalCentavos: number;
  devueltoCentavos: number;
  descontadoDeDeudaCentavos: number;
  unidades: number;
  usuario: string;
  detalle: string;
}

/**
 * Las últimas devoluciones, de la más nueva a la más vieja.
 *
 * Con `cashSessionId` devuelve solo las de ese turno, que es lo que necesita el
 * reporte de cierre.
 */
export async function devolucionesRecientes(
  db: BaseDatos,
  opciones: { limite?: number; cashSessionId?: string } = {},
): Promise<DevolucionEnLista[]> {
  const limite = opciones.limite ?? 50;
  const delTurno = opciones.cashSessionId
    ? sql`WHERE d.cash_session_id = ${opciones.cashSessionId}`
    : sql``;

  const filas = filasDe<{
    id: string;
    numero: string;
    // Ojo: el driver de producción devuelve `timestamptz` como TEXTO desde una
    // consulta escrita a mano, aunque PGlite —el de los tests— la devuelva como
    // `Date`. Por eso se convierte abajo y el tipo dice lo que llega de verdad.
    fecha: string;
    sale_id: string;
    venta_numero: string;
    cliente: string | null;
    motivo: string;
    total: string | number;
    devuelto: string | number;
    de_deuda: string | number;
    unidades: string | number;
    usuario: string;
    detalle: string | null;
  }>(
    await db.execute(sql`
      SELECT d.id, d.numero, d.fecha, d.sale_id, s.numero AS venta_numero,
             c.nombre AS cliente, d.motivo,
             d.total_centavos                  AS total,
             d.devuelto_centavos               AS devuelto,
             d.descontado_de_deuda_centavos    AS de_deuda,
             u.nombre                          AS usuario,
             COALESCE((SELECT SUM(ri.cantidad) FROM return_items ri
                        WHERE ri.return_id = d.id), 0)          AS unidades,
             (SELECT string_agg(ri.descripcion, ' · ') FROM return_items ri
               WHERE ri.return_id = d.id)                        AS detalle
        FROM returns d
        JOIN sales s ON s.id = d.sale_id
        JOIN users u ON u.id = d.usuario_id
        LEFT JOIN customers c ON c.id = d.cliente_id
       ${delTurno}
       ORDER BY d.fecha DESC
       LIMIT ${limite}
    `),
  );

  return filas.map((f) => ({
    id: f.id,
    numero: f.numero,
    fecha: new Date(f.fecha),
    ventaId: f.sale_id,
    ventaNumero: f.venta_numero,
    cliente: f.cliente,
    motivo: f.motivo,
    totalCentavos: Number(f.total),
    devueltoCentavos: Number(f.devuelto),
    descontadoDeDeudaCentavos: Number(f.de_deuda),
    unidades: Number(f.unidades),
    usuario: f.usuario,
    detalle: f.detalle ?? '',
  }));
}

/** Busca una venta por su número, para devolverla. */
export async function buscarVentaPorNumero(
  db: BaseDatos,
  numero: string,
): Promise<{ id: string; numero: string } | null> {
  const limpio = numero.trim().toUpperCase();
  if (limpio === '') return null;

  const [venta] = await db
    .select({ id: sales.id, numero: sales.numero })
    .from(sales)
    .where(sql`upper(${sales.numero}) = ${limpio}`)
    .limit(1);

  return venta ?? null;
}

/** Las últimas ventas, para elegir una sin saberse el número de memoria. */
export async function ventasRecientes(db: BaseDatos, limite = 30) {
  return db
    .select({
      id: sales.id,
      numero: sales.numero,
      fecha: sales.fecha,
      totalCentavos: sales.totalCentavos,
      estado: sales.estado,
      cliente: customers.nombre,
      vendedor: users.nombre,
    })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.clienteId))
    .innerJoin(users, eq(users.id, sales.vendedorId))
    .where(eq(sales.estado, 'completed'))
    .orderBy(desc(sales.fecha))
    .limit(limite);
}

/** Lo devuelto en un turno, para el reporte de cierre. */
export function devolucionesDelTurno(
  db: BaseDatos,
  cashSessionId: string,
): Promise<DevolucionEnLista[]> {
  return devolucionesRecientes(db, { cashSessionId, limite: 200 });
}
