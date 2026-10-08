/**
 * Los pedidos de la tienda online, dentro del POS.
 *
 * La web y el local venden el mismo stock desde dos puntos de venta. WooCommerce
 * descuenta el stock de un pedido web en el momento; el POS, en cambio, no se
 * enteraba: seguía mostrando disponible lo que ya se había vendido online, y
 * los reportes solo veían el mostrador.
 *
 * Esto trae cada pedido web como una venta con `canal = 'web'`:
 *
 *  - **Numeración propia**, terminal `WEB` (`WEB-000001`), consecutiva como la
 *    de cualquier caja. El número del pedido de Woo queda en `woo_order_id` y en
 *    la nota.
 *  - **Descuenta el stock del espejo** con su movimiento (`pedido_web`), pero
 *    **no encola nada para Woo**: Woo ya lo descontó al tomar el pedido.
 *    Encolarlo sería restarlo dos veces.
 *  - **Sin caja**: no hay turno ni movimiento de cajón. La plata de un pedido web
 *    entra por Mercado Pago o transferencia, o en efectivo al retirar.
 *  - **Un pedido que se cancela en la tienda anula la venta** y devuelve el
 *    stock al espejo. Woo devuelve el suyo por su cuenta.
 *
 * Igual que el refresco del catálogo, se pregunta en vez de esperar el webhook
 * (el servidor de la tienda no puede darlo de alta): cada diez minutos se piden
 * los pedidos modificados desde la última marca de agua, con el mismo margen de
 * seis horas. Pedir de más no duplica nada: cada pedido entra una sola vez,
 * por su clave de idempotencia y un candado por pedido.
 *
 * Solo cuentan los pedidos que nacieron en la tienda (`created_via` checkout o
 * store-api): los que crea el propio POS por la REST, o alguien desde el admin,
 * no son ventas web.
 */
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  auditLog,
  productVariants,
  products,
  saleItems,
  salePayments,
  sales,
  settings,
  stockMovements,
  users,
} from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import type { ClienteWoo } from './cliente';
import { MARGEN_MS } from './refrescar';
import { precioACentavos } from './tipos';

export const TERMINAL_WEB = 'WEB';

/** Dónde vive la marca de agua de los pedidos. */
const CLAVE = 'woo.pedidos_web';

/** Mail con el que se identifica el usuario de sistema dueño de las ventas web. */
export const MAIL_USUARIO_WEB = 'tienda-web@pos.local';

/** Los pedidos que nacieron en la tienda online. */
export const VIAS_WEB = ['checkout', 'store-api'];

/** Estados en los que WooCommerce ya descontó el stock: la venta existe. */
export const ESTADOS_QUE_DESCUENTAN = ['on-hold', 'processing', 'completed'];

/** Estados que, si la venta ya había entrado, la anulan. */
export const ESTADOS_QUE_ANULAN = ['cancelled', 'refunded', 'failed'];

/**
 * La primera vez no hay marca: se arranca tres días atrás. Lo anterior, si
 * existe, ya está en el histórico (`legacy_sales`) y traerlo acá lo contaría
 * dos veces.
 */
const ARRANQUE_MS = 3 * 24 * 60 * 60 * 1000;

const lineaWeb = z
  .object({
    name: z.string().default(''),
    product_id: z.number().default(0),
    variation_id: z.number().default(0),
    quantity: z.number().default(0),
    total: z.union([z.string(), z.number()]).nullish(),
  })
  .loose();

export const pedidoWeb = z
  .object({
    id: z.number(),
    number: z.union([z.string(), z.number()]).nullish(),
    status: z.string().default(''),
    created_via: z.string().nullish(),
    date_created_gmt: z.string().nullish(),
    date_modified_gmt: z.string().nullish(),
    total: z.union([z.string(), z.number()]).nullish(),
    shipping_total: z.union([z.string(), z.number()]).nullish(),
    payment_method: z.string().nullish(),
    payment_method_title: z.string().nullish(),
    billing: z
      .object({ first_name: z.string().nullish(), last_name: z.string().nullish() })
      .loose()
      .nullish(),
    line_items: z.array(lineaWeb).default([]),
    /**
     * Cargos sueltos del pedido. La tienda descuenta el pago por transferencia
     * como un cargo negativo ("Descuento por transferencia (10%)").
     */
    fee_lines: z
      .array(z.object({ name: z.string().default(''), total: z.union([z.string(), z.number()]).nullish() }).loose())
      .default([]),
  })
  .loose();

export type PedidoWeb = z.infer<typeof pedidoWeb>;

export interface InformePedidosWeb {
  leidos: number;
  importados: number;
  anulados: number;
  /** Pedidos que no son de la tienda online, o en un estado que todavía no cuenta. */
  salteados: number;
  /** Pedidos que no se pudieron traer porque un producto no está en el espejo. */
  sinProducto: string[];
  desde: Date;
  cortadoPorTiempo: boolean;
}

/** Fecha GMT de Woo ("2026-10-07T20:56:00", sin zona) a Date. */
function fechaGmt(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(valor) ? valor : `${valor}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** El medio de pago del POS que corresponde a la pasarela de la tienda. */
export function medioDePago(pasarela: string | null | undefined): 'transferencia' | 'efectivo' | 'mercadopago' {
  if (pasarela === 'bacs') return 'transferencia';
  if (pasarela === 'cod') return 'efectivo';
  return 'mercadopago';
}

async function leerMarca(db: BaseDatos): Promise<Date | null> {
  const [fila] = await db
    .select({ valor: settings.valor })
    .from(settings)
    .where(eq(settings.clave, CLAVE))
    .limit(1);
  const iso = (fila?.valor as { desde?: unknown } | undefined)?.desde;
  return typeof iso === 'string' ? fechaGmt(iso) : null;
}

async function guardarMarca(db: BaseDatos, desde: Date): Promise<void> {
  await db
    .insert(settings)
    .values({ clave: CLAVE, valor: { desde: desde.toISOString() } })
    .onConflictDoUpdate({
      target: settings.clave,
      set: { valor: { desde: desde.toISOString() }, updatedAt: new Date() },
    });
}

/**
 * El usuario de sistema a cuyo nombre quedan las ventas web. Inactivo y sin
 * clave ni PIN: no puede entrar al POS, solo firma las ventas de la tienda.
 */
async function usuarioWeb(db: BaseDatos): Promise<string> {
  const [ya] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, MAIL_USUARIO_WEB))
    .limit(1);
  if (ya) return ya.id;
  const [nuevo] = await db
    .insert(users)
    .values({ nombre: 'Tienda web', email: MAIL_USUARIO_WEB, rol: 'seller', activo: false })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (nuevo) return nuevo.id;
  const [otra] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, MAIL_USUARIO_WEB))
    .limit(1);
  return otra!.id;
}

/**
 * Trae los pedidos web nuevos o cambiados desde la última corrida.
 *
 * La marca de agua avanza hasta el último pedido procesado. Como se piden de
 * más viejo a más nuevo, cortar a la mitad por tiempo no deja ninguno atrás.
 */
export async function importarPedidosWeb(
  db: BaseDatos,
  cliente: ClienteWoo,
  opciones: { ahora?: Date; limiteMs?: number } = {},
): Promise<InformePedidosWeb> {
  const ahora = opciones.ahora ?? new Date();
  const marca = (await leerMarca(db)) ?? new Date(ahora.getTime() - ARRANQUE_MS);
  const desde = new Date(marca.getTime() - MARGEN_MS);
  const hasta = opciones.limiteMs ? performance.now() + opciones.limiteMs : Number.POSITIVE_INFINITY;

  const informe: InformePedidosWeb = {
    leidos: 0,
    importados: 0,
    anulados: 0,
    salteados: 0,
    sinProducto: [],
    desde,
    cortadoPorTiempo: false,
  };

  let mayor = marca;
  const vendedorId = await usuarioWeb(db);

  for await (const pagina of cliente.listarTodo(
    'orders',
    pedidoWeb,
    {
      status: 'any',
      modified_after: desde.toISOString().slice(0, 19),
      dates_are_gmt: 'true',
      orderby: 'modified',
      order: 'asc',
    },
    50,
  )) {
    for (const pedido of pagina) {
      informe.leidos += 1;
      const resultado = await procesarPedido(db, pedido, vendedorId);
      if (resultado === 'importado') informe.importados += 1;
      else if (resultado === 'anulado') informe.anulados += 1;
      else if (resultado === 'sin_producto') {
        informe.sinProducto.push(`#${String(pedido.number ?? pedido.id)}`);
        // Un pedido que no se pudo traer no deja avanzar la marca más allá de él:
        // cuando el producto llegue al espejo, la corrida siguiente lo reintenta.
        continue;
      } else informe.salteados += 1;

      const modificado = fechaGmt(pedido.date_modified_gmt);
      if (modificado && modificado > mayor && informe.sinProducto.length === 0) mayor = modificado;
    }
    if (performance.now() >= hasta) {
      informe.cortadoPorTiempo = true;
      break;
    }
  }

  if (mayor > marca) await guardarMarca(db, mayor > ahora ? ahora : mayor);
  return informe;
}

type Resultado = 'importado' | 'anulado' | 'sin_producto' | 'nada';

/** Decide qué hacer con un pedido según su origen, su estado y si ya entró. */
export async function procesarPedido(
  db: BaseDatos,
  pedido: PedidoWeb,
  vendedorId: string,
): Promise<Resultado> {
  if (!VIAS_WEB.includes(pedido.created_via ?? '')) return 'nada';

  const descuenta = ESTADOS_QUE_DESCUENTAN.includes(pedido.status);
  const anula = ESTADOS_QUE_ANULAN.includes(pedido.status);
  if (!descuenta && !anula) return 'nada'; // pendiente de pago, borrador: todavía no.

  return db.transaction(async (tx) => {
    // Un candado por pedido: dos corridas a la vez no lo traen dos veces ni
    // gastan dos números del correlativo.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`woo-order:${pedido.id}`}))`);

    const [existente] = await tx
      .select({ id: sales.id, estado: sales.estado, numero: sales.numero })
      .from(sales)
      .where(and(eq(sales.wooOrderId, pedido.id), eq(sales.canal, 'web')))
      .limit(1);

    if (descuenta) {
      if (existente) return 'nada';
      return registrarVenta(tx, pedido, vendedorId);
    }

    if (!existente || existente.estado !== 'completed') return 'nada';
    await anularVenta(tx, pedido, existente, vendedorId);
    return 'anulado';
  });
}

async function registrarVenta(
  tx: BaseDatos,
  pedido: PedidoWeb,
  vendedorId: string,
): Promise<Resultado> {
  // Cada renglón tiene que existir en el espejo: la base no acepta un renglón
  // sin producto (D24). Si falta alguno, el pedido espera a la próxima corrida.
  const renglones: {
    productId: string;
    variantId: string | null;
    /** Dónde se descuenta: la variación si lleva stock propio, si no el padre. */
    stockEnVariante: boolean;
    descripcion: string;
    cantidad: number;
    totalCentavos: number;
  }[] = [];

  for (const linea of pedido.line_items) {
    if (linea.quantity <= 0) continue;
    const totalCentavos = precioACentavos(linea.total);
    if (linea.variation_id > 0) {
      const [v] = await tx
        .select({ id: productVariants.id, productId: productVariants.productId, gestionaStock: productVariants.gestionaStock })
        .from(productVariants)
        .where(eq(productVariants.wooId, linea.variation_id))
        .limit(1);
      if (!v) return 'sin_producto';
      renglones.push({
        productId: v.productId,
        variantId: v.id,
        stockEnVariante: v.gestionaStock,
        descripcion: linea.name,
        cantidad: linea.quantity,
        totalCentavos,
      });
    } else {
      const [p] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.wooId, linea.product_id))
        .limit(1);
      if (!p) return 'sin_producto';
      renglones.push({
        productId: p.id,
        variantId: null,
        stockEnVariante: false,
        descripcion: linea.name,
        cantidad: linea.quantity,
        totalCentavos,
      });
    }
  }
  if (renglones.length === 0) return 'nada';

  const [contador] = filasDe<{ ultimo: number }>(
    await tx.execute(sql`
      INSERT INTO sale_counters (terminal, ultimo) VALUES (${TERMINAL_WEB}, 1)
      ON CONFLICT (terminal) DO UPDATE SET ultimo = sale_counters.ultimo + 1
      RETURNING ultimo
    `),
  );
  const numero = `${TERMINAL_WEB}-${String(Number(contador!.ultimo)).padStart(6, '0')}`;

  // Subtotal = suma de renglones (el auditor lo exige). Los cargos negativos de
  // la tienda —el descuento por transferencia— van como descuento de la venta,
  // así el total es lo que de verdad se cobró. El envío no es venta de
  // producto: queda anotado en la nota.
  const subtotalCentavos = renglones.reduce((n, r) => n + r.totalCentavos, 0);
  const descuentoCentavos = Math.min(
    subtotalCentavos,
    pedido.fee_lines.reduce((n, fl) => {
      const v = Math.round(Number(String(fl.total ?? '0').replace(',', '.')) * 100);
      return Number.isFinite(v) && v < 0 ? n - v : n;
    }, 0),
  );
  const totalCentavos = subtotalCentavos - descuentoCentavos;
  const envioCentavos = precioACentavos(pedido.shipping_total);
  const cliente = [pedido.billing?.first_name, pedido.billing?.last_name].filter(Boolean).join(' ');
  const nota = [
    `Pedido web #${String(pedido.number ?? pedido.id)}`,
    pedido.payment_method_title ?? null,
    envioCentavos > 0 ? `envío $ ${(envioCentavos / 100).toFixed(0)}` : null,
    descuentoCentavos > 0 ? `descuento $ ${(descuentoCentavos / 100).toFixed(0)}` : null,
    cliente || null,
  ]
    .filter(Boolean)
    .join(' · ');

  const [venta] = await tx
    .insert(sales)
    .values({
      numero,
      terminal: TERMINAL_WEB,
      fecha: fechaGmt(pedido.date_created_gmt) ?? new Date(),
      vendedorId,
      canal: 'web',
      estado: 'completed',
      tipo: 'contado',
      subtotalCentavos,
      descuentoCentavos,
      totalCentavos,
      idempotencyKey: `woo-order:${pedido.id}`,
      // Woo ya tiene este stock descontado: no hay nada que mandarle.
      syncedToWoo: true,
      wooOrderId: pedido.id,
      nota,
    })
    .returning({ id: sales.id });
  const ventaId = venta!.id;

  for (const r of renglones) {
    await tx.insert(saleItems).values({
      saleId: ventaId,
      productId: r.productId,
      variantId: r.variantId,
      descripcion: r.descripcion,
      cantidad: r.cantidad,
      precioUnitarioCentavos: Math.round(r.totalCentavos / r.cantidad),
      totalCentavos: r.totalCentavos,
    });
    await moverStock(tx, r, -r.cantidad, `Pedido web #${String(pedido.number ?? pedido.id)} (${numero})`, ventaId, vendedorId);
  }

  await tx.insert(salePayments).values({
    saleId: ventaId,
    medio: medioDePago(pedido.payment_method),
    montoCentavos: totalCentavos,
  });

  await tx.insert(auditLog).values({
    usuarioId: vendedorId,
    accion: 'venta.confirmar',
    entidad: 'sales',
    entidadId: ventaId,
    valorNuevo: {
      numero,
      canal: 'web',
      pedidoWeb: pedido.id,
      estadoEnTienda: pedido.status,
      totalCentavos,
      medios: [medioDePago(pedido.payment_method)],
    },
  });

  return 'importado';
}

async function anularVenta(
  tx: BaseDatos,
  pedido: PedidoWeb,
  venta: { id: string; numero: string },
  vendedorId: string,
): Promise<void> {
  const motivo = `Pedido web #${String(pedido.number ?? pedido.id)} ${pedido.status === 'refunded' ? 'reembolsado' : 'cancelado'} en la tienda`;

  await tx
    .update(sales)
    .set({ estado: 'cancelled', motivoAnulacion: motivo })
    .where(eq(sales.id, venta.id));

  const items = await tx
    .select({
      productId: saleItems.productId,
      variantId: saleItems.variantId,
      cantidad: saleItems.cantidad,
      gestionaStock: productVariants.gestionaStock,
    })
    .from(saleItems)
    .leftJoin(productVariants, eq(productVariants.id, saleItems.variantId))
    .where(eq(saleItems.saleId, venta.id));

  for (const it of items) {
    await moverStock(
      tx,
      { productId: it.productId, variantId: it.variantId, stockEnVariante: Boolean(it.gestionaStock) },
      it.cantidad,
      `${motivo} (${venta.numero})`,
      venta.id,
      vendedorId,
    );
  }

  await tx.insert(auditLog).values({
    usuarioId: vendedorId,
    accion: 'venta.anular',
    entidad: 'sales',
    entidadId: venta.id,
    valorNuevo: { numero: venta.numero, motivo, canal: 'web', pedidoWeb: pedido.id },
  });
}

/** Suma o resta en el espejo y deja el asiento. Nunca encola nada para Woo. */
async function moverStock(
  tx: BaseDatos,
  r: { productId: string; variantId: string | null; stockEnVariante: boolean },
  cantidad: number,
  motivo: string,
  ventaId: string,
  usuarioId: string,
): Promise<void> {
  let resultante: number;
  if (r.variantId && r.stockEnVariante) {
    const [v] = await tx
      .update(productVariants)
      .set({ stock: sql`${productVariants.stock} + ${cantidad}` })
      .where(eq(productVariants.id, r.variantId))
      .returning({ stock: productVariants.stock });
    resultante = Number(v!.stock);
  } else {
    const [p] = await tx
      .update(products)
      .set({ stock: sql`${products.stock} + ${cantidad}`, updatedAt: new Date() })
      .where(eq(products.id, r.productId))
      .returning({ stock: products.stock });
    resultante = Number(p!.stock);
  }

  await tx.insert(stockMovements).values({
    productId: r.productId,
    variantId: r.variantId && r.stockEnVariante ? r.variantId : null,
    tipo: 'pedido_web',
    cantidad,
    stockResultante: resultante,
    motivo,
    usuarioId,
    referenciaTipo: 'sale',
    referenciaId: ventaId,
  });
}
