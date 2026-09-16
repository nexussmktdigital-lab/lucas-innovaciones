/**
 * La cola de ventas cobradas sin conexión (D56).
 *
 * La pieza más delicada de la v1.1: acá hay plata que el cliente ya pagó y que
 * el sistema todavía no sabe. Tres reglas la sostienen:
 *
 *  1. **Primero se guarda, después se intenta subir.** Nunca al revés. Una
 *     venta que se intenta subir y falla sin haberse guardado antes es una
 *     venta cobrada que no existe en ninguna parte.
 *  2. **La clave de idempotencia es la misma que usa el servidor.** Subir dos
 *     veces la misma venta devuelve la que ya entró, no cobra de nuevo. Por eso
 *     la clave se genera al abrir el cobro y no al subir.
 *  3. **Nada se borra de la cola hasta que el servidor confirma.** Un error de
 *     red en la respuesta deja la venta en la cola y se reintenta; la
 *     idempotencia se encarga de que eso no duplique nada.
 *
 * El módulo es puro salvo por las funciones que hablan con el almacén, y esas
 * se prueban con un almacén de mentira.
 */
import type { DatosDeVenta } from '@/app/acciones-venta';

/** Una venta cobrada que espera para entrar. */
export interface VentaEnCola {
  /** La misma que va a usar el servidor. Es la clave del depósito. */
  idempotencyKey: string;
  /** Cuándo se cobró de verdad, en ISO. Es la fecha que va a llevar la venta. */
  capturadaEn: string;
  /** El turno que estaba abierto cuando se cobró. */
  cashSessionId: string;
  /** Lo que se le cobró al cliente, para poder mostrarlo sin recalcular nada. */
  totalCentavos: number;
  vueltoCentavos: number;
  /** Cómo se llama lo que se vendió, para la lista y el comprobante provisorio. */
  resumen: string;
  /** Lo cobrado por unidad en cada línea, en el orden de `datos.lineas`. */
  preciosCobradosCentavos: number[];
  /** Lo que se le manda al servidor, ya armado. */
  datos: DatosDeVenta;
  intentos: number;
  ultimoError?: string;
}

/** Cómo le fue a un intento de subir la cola entera. */
export interface ResultadoDelDrenaje {
  subidas: number;
  fallidas: number;
  /** Ventas que entraron con algo raro: precio distinto o stock en negativo. */
  conAvisos: { numero: string; desvioCentavos: number; dejoStockEnRojo: boolean }[];
  /** El primer error, para poder mostrar uno y no quince. */
  primerError: string | null;
}

/** Una línea del carrito, como la necesita el resumen. */
export interface LineaResumible {
  descripcion: string;
  cantidad: number;
}

/**
 * «2 × Vidrio templado 9D y 1 más».
 *
 * Se arma al encolar y se guarda: el nombre del producto puede cambiar entre el
 * cobro y la subida, y lo que se le vendió al cliente fue lo que decía la
 * pantalla en ese momento.
 */
export function resumirVenta(lineas: readonly LineaResumible[]): string {
  const primera = lineas[0];
  if (!primera) return 'Venta sin renglones';

  const texto = `${primera.cantidad} × ${primera.descripcion}`;
  const resto = lineas.length - 1;
  return resto === 0 ? texto : `${texto} y ${resto} más`;
}

/**
 * ¿Vale la pena reintentar este error, o hay que mirarlo?
 *
 * Un corte de red se reintenta solo; una venta rechazada por el dominio —sin
 * caja abierta, un producto que ya no está— no se arregla reintentando y tiene
 * que verla una persona. Distinguirlos evita el peor final posible: una cola
 * que reintenta en loop y nunca avisa que hay plata sin registrar.
 */
export function convieneReintentar(error: string): boolean {
  return !/no hay una caja abierta|ya no está en el catálogo|no tenés permiso|se cerró la sesión/i.test(
    error,
  );
}

/** ¿Hay algo que el dueño tenga que mirar de esta venta ya subida? */
export function tieneAvisos(v: { desvioCentavos: number; dejoStockEnRojo: boolean }): boolean {
  return v.desvioCentavos !== 0 || v.dejoStockEnRojo;
}
