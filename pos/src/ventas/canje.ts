/**
 * Plan canje: el cliente paga parte de la compra con su teléfono usado.
 *
 * Se vende un iPhone de US$ 1.000, se le recibe el suyo por US$ 600 y los
 * US$ 400 restantes entran por donde sea. Para el sistema son **dos hechos**, y
 * esa es toda la dificultad del asunto:
 *
 *  1. Un pago de US$ 600 que **no es plata**. Cierra la venta y no entra a
 *     ningún cajón (`tipoDeCuentaPara` devuelve null, igual que la cuenta
 *     corriente). Cargarlo como efectivo dejaría el arqueo con seiscientos
 *     dólares que no existen y obligaría a quien cuenta a justificar una
 *     diferencia inventada; cargarlo como cuenta corriente le inventaría al
 *     cliente una deuda que no tiene y aparecería en Fiado y en los
 *     recordatorios de WhatsApp.
 *  2. Una **entrada de mercadería con costo US$ 600**. El teléfono va a stock
 *     y el día que se venda el margen se calcula contra ese número.
 *
 * **El valor de canje es el costo.** Es lo que el local pagó por ese teléfono,
 * en mercadería en vez de plata. El precio al que lo va a vender es otra
 * decisión y viaja aparte, porque el local recibe «al costo o menos que el
 * costo» según cómo venga el equipo.
 *
 * **Todo en la transacción de la venta.** Un alta sin venta sería stock que
 * nadie entregó; una venta sin alta sería un pago contra nada. Si algo falla,
 * no pasa ninguna de las dos cosas.
 */
import { eq, sql } from 'drizzle-orm';
import { products, stockMovements } from '@/db/schema';
import { filas, type BaseDatos } from '@/db/tipos';
import { crearProducto, ErrorCrear } from '@/catalogo/crear';
import { encolarPublicacion } from '@/catalogo/publicar';
import type { EquipoRecibido } from './carrito';

export class ErrorCanje extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCanje';
  }
}

/** Categoría por defecto de lo que entra por canje, si nadie dice otra cosa. */
export const CATEGORIA_POR_DEFECTO = 'Smartphones usados';

/**
 * El nombre con el que el equipo entra al catálogo.
 *
 * El IMEI va entre paréntesis al final, que es exactamente como el catálogo
 * real nombra los usados —«iPhone 13 Pro 128gb 100% (5072)»— porque es lo
 * único que distingue dos equipos del mismo modelo. Si quien atiende ya lo
 * escribió en el nombre, no se repite.
 */
export function nombreDelEquipo(equipo: EquipoRecibido): string {
  const nombre = equipo.nombre.trim();
  const imei = (equipo.imei ?? '').trim();
  if (!imei || nombre.includes(imei)) return nombre;
  return `${nombre} (${imei})`;
}

export interface CanjeRegistrado {
  productId: string;
  nombre: string;
}

/**
 * Da de alta el equipo recibido y lo deja listo para vender y publicar.
 *
 * @param montoCentavos Valor de canje en pesos. Es el costo del equipo.
 * @param montoUsdCentavos Valor de canje en dólares, cuando la venta fue en
 *   dólares. El producto queda en dólares, como el resto de los usados: su
 *   precio en pesos es un cálculo que se rehace con cada cotización, y
 *   congelarlo acá lo dejaría viejo mañana.
 */
export async function registrarEquipoRecibido(
  tx: BaseDatos,
  datos: {
    equipo: EquipoRecibido;
    montoCentavos: number;
    montoUsdCentavos?: number | null;
    usuarioId: string;
    ventaId: string;
    ip?: string | null;
  },
): Promise<CanjeRegistrado> {
  const { equipo, montoCentavos, montoUsdCentavos, usuarioId, ventaId } = datos;

  const nombre = nombreDelEquipo(equipo);
  if (nombre.length < 2) {
    throw new ErrorCanje('Falta decir qué equipo entró en el canje.');
  }
  if (!Number.isInteger(montoCentavos) || montoCentavos <= 0) {
    throw new ErrorCanje('El valor del canje tiene que ser mayor a cero.');
  }

  const enDolares = Boolean(montoUsdCentavos && montoUsdCentavos > 0);

  /*
   * El precio de venta, si no lo escribieron, es el valor de canje.
   *
   * Es un precio de arranque, no una decisión: deja el equipo vendible y
   * visible en el acto, que es lo que pidió el local, en vez de frenar el
   * cobro con el cliente enfrente por un número que todavía nadie resolvió.
   * Queda en la lista de fichas a completar junto con la foto.
   */
  const precioVentaCentavos = equipo.precioVentaCentavos ?? null;

  let creado;
  try {
    creado = await crearProducto(tx, {
      nombre,
      categoria: (equipo.categoria ?? '').trim() || CATEGORIA_POR_DEFECTO,
      marca: (equipo.marca ?? '').trim() || null,
      // En pesos el precio es el de mostrador. En dólares este número es un
      // relleno: abajo se reemplaza por el precio en dólares y su conversión.
      precioCentavos: precioVentaCentavos ?? montoCentavos,
      stock: 1,
      costoCentavos: montoCentavos,
      usuarioId,
      ip: datos.ip ?? null,
    });
  } catch (error) {
    /*
     * El alta rechaza un nombre repetido, y acá eso pasa de verdad: dos
     * iPhone 13 Pro del mismo modelo y la misma salud entran con el mismo
     * nombre si nadie escribió el IMEI. El mensaje tiene que decir qué hacer,
     * no repetir el del catálogo.
     */
    if (error instanceof ErrorCrear && error.codigo === 'nombre_repetido') {
      throw new ErrorCanje(
        `Ya hay un producto que se llama «${nombre}». Agregale el IMEI al equipo recibido para distinguirlo.`,
      );
    }
    throw error;
  }

  if (enDolares) {
    /*
     * El equipo queda en dólares, como el resto de los usados.
     *
     * Se escribe acá y no por la pantalla de precios porque el producto se
     * acaba de crear en esta misma transacción: no hay nada que empujar a
     * WooCommerce todavía —la publicación viaja encolada, con el precio ya
     * puesto— y pasar por `cambiarPrecio` encolaría un `precio.empujar` para
     * un producto que aún no existe en la tienda.
     */
    const precioUsd = equipo.precioVentaCentavos ?? montoUsdCentavos!;
    await tx
      .update(products)
      .set({
        moneda: 'USD',
        precioUsdCentavos: precioUsd,
        // Los pesos son un cálculo: la proporción entre lo que vale y lo que
        // se recibió es la misma en las dos monedas, así que sale de ahí sin
        // volver a pedir la cotización.
        precioCentavos: Math.round((precioUsd * montoCentavos) / montoUsdCentavos!),
        precioLocalCentavos: null,
        updatedAt: new Date(),
      })
      .where(eq(products.id, creado.id));
  }

  /*
   * El movimiento de stock, que el alta no registra.
   *
   * Importa más acá que en un alta común: una unidad que aparece en el
   * inventario sin remito ni factura, a cambio de un descuento en otra venta,
   * es justo la que hay que poder explicar seis meses después. Queda atada a
   * la venta que la trajo.
   */
  await tx.insert(stockMovements).values({
    productId: creado.id,
    tipo: 'ingreso',
    cantidad: 1,
    stockResultante: 1,
    motivo: 'Recibido en canje',
    usuarioId,
    referenciaTipo: 'sale',
    referenciaId: ventaId,
  });

  // Sale a la venta en el acto, también en la web: lo pidió el local. La
  // publicación viaja por la cola, así que no depende de que Woo conteste.
  await encolarPublicacion(tx, creado.id, usuarioId);

  return { productId: creado.id, nombre };
}

/**
 * Cuánto de una venta se pagó con mercadería.
 *
 * Lo usa el arqueo: el canje suma al total de la venta y no entra al cajón, y
 * sin separarlo el total del día no coincide con la plata contada y quien
 * cierra tiene que inventar una diferencia.
 */
export async function canjeDelTurno(
  db: BaseDatos,
  cashSessionId: string,
): Promise<number> {
  const [fila] = filas<{ total: string | number }>(
    await db.execute(sql`
    SELECT COALESCE(SUM(sp.monto_centavos), 0) AS total
      FROM sale_payments sp
      JOIN sales s ON s.id = sp.sale_id
     WHERE sp.medio = 'canje'
       AND s.cash_session_id = ${cashSessionId}
       AND s.estado = 'completed'
  `),
  );
  return Number(fila?.total ?? 0);
}
