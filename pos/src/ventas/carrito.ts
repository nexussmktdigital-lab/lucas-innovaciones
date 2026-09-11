/**
 * Aritmetica del carrito y del cobro.
 *
 * Funciones puras: no tocan base ni red. Toda la plata que decide cuanto cobrar
 * se calcula aca, con enteros de centavos, y se prueba sin levantar nada.
 *
 * Reglas que valen para todo el archivo:
 *  - El precio de una linea en dolares se CALCULA con el tipo de cambio; nunca
 *    se tipea en pesos. Es la guarda que hace imposible el error de agosto.
 *  - Ningun descuento puede dejar un total negativo.
 *  - El vuelto sale del efectivo. Si no entregaron efectivo, no hay vuelto.
 */
import { descuentoPorcentual, usdAPesos } from '@/lib/dinero';

export class ErrorCarrito extends Error {}

export type Moneda = 'ARS' | 'USD';

/** Un producto tal como lo necesita el carrito. */
export interface ProductoVendible {
  id: string;
  nombre: string;
  precioCentavos: number;
  moneda: Moneda;
  precioUsdCentavos: number | null;
  /** Servicios y chips: el cajero escribe el precio en la venta. */
  precioEditable: boolean;
  gestionaStock: boolean;
  stock: number;
  stockComprometido: number;
}

export interface LineaCarrito {
  productId: string;
  variantId?: string | null;
  /** Congelada al agregarla: si mañana cambia el nombre, el ticket no. */
  descripcion: string;
  cantidad: number;
  /** Siempre en pesos. En un producto USD lo calculó el sistema. */
  precioUnitarioCentavos: number;
  monedaOriginal: Moneda;
  /** Solo en productos USD: el precio de origen, para el comprobante. */
  precioUsdCentavos: number | null;
  descuentoCentavos: number;
}

export type Descuento =
  | { tipo: 'monto'; centavos: number }
  | { tipo: 'porcentaje'; porcentaje: number };

export interface TotalesCarrito {
  /** Suma de las líneas antes de descuentos. */
  brutoCentavos: number;
  /** Descuentos aplicados línea por línea. */
  descuentoLineasCentavos: number;
  /** Bruto menos los descuentos de línea. */
  subtotalCentavos: number;
  /** Descuento aplicado sobre el subtotal. */
  descuentoGlobalCentavos: number;
  totalCentavos: number;
  unidades: number;
}

/** Cuánto stock hay realmente disponible para vender en el mostrador. */
export function stockDisponible(p: ProductoVendible): number {
  if (!p.gestionaStock) return Number.POSITIVE_INFINITY;
  return p.stock - p.stockComprometido;
}

/**
 * Arma una línea a partir de un producto del catálogo.
 *
 * @param tcCentavos Cotización vigente, obligatoria si el producto está en USD.
 * @param precioManualCentavos Solo se acepta en productos con `precioEditable`.
 */
export function armarLinea(
  p: ProductoVendible,
  cantidad: number,
  opciones: {
    tcCentavos?: number | null;
    precioManualCentavos?: number | null;
    variantId?: string | null;
  } = {},
): LineaCarrito {
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw new ErrorCarrito(`Cantidad inválida: ${cantidad}`);
  }

  let precioUnitarioCentavos: number;

  if (p.moneda === 'USD') {
    if (!p.precioUsdCentavos) {
      throw new ErrorCarrito(`"${p.nombre}" está marcado en dólares pero no tiene precio en dólares.`);
    }
    if (!opciones.tcCentavos) {
      throw new ErrorCarrito(
        `No hay cotización cargada y "${p.nombre}" se vende en dólares. Cargá el tipo de cambio antes de vender.`,
      );
    }
    // El precio en pesos lo calcula el sistema. Nunca se tipea.
    precioUnitarioCentavos = usdAPesos(p.precioUsdCentavos, opciones.tcCentavos);
  } else if (opciones.precioManualCentavos != null) {
    if (!p.precioEditable) {
      throw new ErrorCarrito(`No se puede cambiar el precio de "${p.nombre}" desde la venta.`);
    }
    if (opciones.precioManualCentavos < 0) {
      throw new ErrorCarrito('El precio no puede ser negativo.');
    }
    precioUnitarioCentavos = opciones.precioManualCentavos;
  } else {
    precioUnitarioCentavos = p.precioCentavos;
  }

  return {
    productId: p.id,
    variantId: opciones.variantId ?? null,
    descripcion: p.nombre,
    cantidad,
    precioUnitarioCentavos,
    monedaOriginal: p.moneda,
    precioUsdCentavos: p.moneda === 'USD' ? p.precioUsdCentavos : null,
    descuentoCentavos: 0,
  };
}

/** Bruto de una línea, sin su descuento. */
export function brutoDeLinea(l: LineaCarrito): number {
  return l.precioUnitarioCentavos * l.cantidad;
}

/** Neto de una línea: bruto menos su descuento, nunca negativo. */
export function netoDeLinea(l: LineaCarrito): number {
  return Math.max(0, brutoDeLinea(l) - l.descuentoCentavos);
}

/** Resuelve un descuento (monto o porcentaje) contra una base. */
export function resolverDescuento(d: Descuento | null, baseCentavos: number): number {
  if (!d) return 0;
  const centavos =
    d.tipo === 'monto' ? Math.round(d.centavos) : descuentoPorcentual(baseCentavos, d.porcentaje);
  if (centavos < 0) throw new ErrorCarrito('El descuento no puede ser negativo.');
  // Un descuento nunca deja el total en negativo: como mucho lo deja en cero.
  return Math.min(centavos, baseCentavos);
}

export function calcularTotales(
  lineas: readonly LineaCarrito[],
  descuentoGlobal: Descuento | null = null,
): TotalesCarrito {
  let brutoCentavos = 0;
  let descuentoLineasCentavos = 0;
  let unidades = 0;

  for (const l of lineas) {
    const bruto = brutoDeLinea(l);
    brutoCentavos += bruto;
    descuentoLineasCentavos += Math.min(l.descuentoCentavos, bruto);
    unidades += l.cantidad;
  }

  const subtotalCentavos = brutoCentavos - descuentoLineasCentavos;
  const descuentoGlobalCentavos = resolverDescuento(descuentoGlobal, subtotalCentavos);

  return {
    brutoCentavos,
    descuentoLineasCentavos,
    subtotalCentavos,
    descuentoGlobalCentavos,
    totalCentavos: subtotalCentavos - descuentoGlobalCentavos,
    unidades,
  };
}

/* -------------------------------------------------------------------------- */
/* Cobro                                                                      */
/* -------------------------------------------------------------------------- */

export type MedioPago =
  | 'efectivo'
  | 'transferencia'
  | 'debito'
  | 'credito'
  | 'dolares'
  | 'cheque'
  | 'mercadopago'
  | 'cuenta_corriente';

export interface Pago {
  medio: MedioPago;
  montoCentavos: number;
  monetaryAccountId?: string | null;
  /** Solo tarjeta: el Posnet es un aparato aparte, el POS solo registra. */
  marcaTarjeta?: string | null;
  cuotas?: number | null;
  ultimos4?: string | null;
}

export interface EstadoCobro {
  totalCentavos: number;
  pagadoCentavos: number;
  /** Lo que todavía falta cobrar. Cero si ya está cubierto. */
  faltanteCentavos: number;
  /** Vuelto a devolver. Solo puede salir del efectivo entregado. */
  vueltoCentavos: number;
  /** True si se puede confirmar la venta. */
  alcanza: boolean;
}

export function calcularCobro(totalCentavos: number, pagos: readonly Pago[]): EstadoCobro {
  let pagadoCentavos = 0;
  let efectivoCentavos = 0;

  for (const p of pagos) {
    if (p.montoCentavos <= 0) {
      throw new ErrorCarrito('Cada pago tiene que ser mayor a cero.');
    }
    pagadoCentavos += p.montoCentavos;
    if (p.medio === 'efectivo') efectivoCentavos += p.montoCentavos;
  }

  const sobrante = pagadoCentavos - totalCentavos;

  return {
    totalCentavos,
    pagadoCentavos,
    faltanteCentavos: Math.max(0, -sobrante),
    // El vuelto sale del efectivo: no se devuelve plata de una transferencia.
    vueltoCentavos: Math.max(0, Math.min(sobrante, efectivoCentavos)),
    alcanza: sobrante >= 0,
  };
}

/**
 * Comprueba que un cobro se pueda confirmar y explica por qué no, si no se puede.
 * Devuelve la lista de problemas; vacía significa que está listo.
 */
export function problemasDelCobro(
  totales: TotalesCarrito,
  pagos: readonly Pago[],
  opciones: { hayCliente: boolean } = { hayCliente: false },
): string[] {
  const problemas: string[] = [];

  if (totales.unidades === 0) {
    problemas.push('El carrito está vacío.');
    return problemas;
  }

  if (pagos.length === 0) {
    problemas.push('Falta indicar cómo se paga.');
    return problemas;
  }

  const cobro = calcularCobro(totales.totalCentavos, pagos);
  if (!cobro.alcanza) problemas.push('El pago no cubre el total.');

  // Una venta a cuenta corriente no es contado: necesita cliente sí o sí.
  if (pagos.some((p) => p.medio === 'cuenta_corriente') && !opciones.hayCliente) {
    problemas.push('Para cobrar en cuenta corriente hace falta elegir un cliente.');
  }

  // El sobrante solo puede volver como vuelto en efectivo. Si alguien cargó de
  // más en transferencia, es un error de carga y no un vuelto.
  const sobrante = cobro.pagadoCentavos - totales.totalCentavos;
  if (sobrante > cobro.vueltoCentavos) {
    problemas.push('Hay un excedente que no se puede devolver: solo se da vuelto del efectivo.');
  }

  for (const p of pagos) {
    if ((p.medio === 'credito' || p.medio === 'debito') && !p.marcaTarjeta) {
      problemas.push('Falta la marca de la tarjeta.');
      break;
    }
  }

  return problemas;
}
