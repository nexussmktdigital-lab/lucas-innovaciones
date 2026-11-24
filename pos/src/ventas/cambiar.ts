/**
 * El cliente cambia un producto por otro.
 *
 * Pasa todas las semanas en el mostrador: se llevó el derivador equivocado y
 * vuelve a los dos días a cambiarlo por el que iba. Hasta acá eran dos
 * operaciones sueltas —devolver y volver a vender— y nada las ataba: si alguien
 * hacía la primera y se olvidaba de la segunda, el stock y la plata quedaban
 * mal y no había dónde verlo.
 *
 * **Adentro siguen siendo esas dos mitades, y está bien que así sea.** La
 * devolución registra lo que volvió y la venta nueva lo que se llevó, así el
 * reporte por producto dice la verdad sobre los dos: el que volvió deja de
 * figurar vendido y el que se llevó empieza a figurar. Un «cambio» que fuera
 * un hecho suelto dejaría la facturación pegada al producto equivocado.
 *
 * Lo que cambia es que ahora van **juntas, en una transacción**, y que la
 * plata se mueve **una sola vez: por la diferencia**.
 *
 * Ese último punto es el motivo de todo. Hacerlo con las dos pantallas de hoy
 * saca del cajón lo que valía lo devuelto y mete lo que vale lo nuevo: en un
 * cambio parejo son dos movimientos que nunca pasaron. Con plata en efectivo
 * el arqueo igual cierra, pero con tarjeta o Mercado Pago quedan en el sistema
 * una devolución y un cobro que no existen en el resumen del banco, y eso lo
 * descubre alguien conciliando a fin de mes.
 *
 * Por eso lo devuelto entra en la venta nueva como un pago `cambio`: no mueve
 * ninguna cuenta —igual que el canje y la cuenta corriente— y la base exige
 * que apunte a la devolución que lo respalda (`sale_payments_cambio_ck`). Sin
 * esa guarda sería un descuento disfrazado que no deja ni plata ni mercadería.
 */
import { sql } from 'drizzle-orm';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import { cotizacionVigente } from '@/cotizacion/cotizacion';
import { recargoDeTienda } from '@/precios/config';
import {
  armarLinea,
  type MedioPago,
  type ProductoVendible,
  type VarianteVendible,
} from './carrito';
import { confirmarVenta } from './confirmar';
import {
  ErrorDevolucion,
  loDevolvible,
  registrarDevolucion,
  type RenglonADevolver,
} from './devolver';

export class ErrorCambio extends Error {
  constructor(
    mensaje: string,
    readonly motivo:
      | 'nada_que_devolver'
      | 'nada_que_llevar'
      | 'sin_medio'
      | 'datos_invalidos' = 'datos_invalidos',
  ) {
    super(mensaje);
    this.name = 'ErrorCambio';
  }
}

export interface SeLleva {
  productId: string;
  cantidad: number;
  variantId?: string | null;
}

export interface DatosCambio {
  /** La venta de la que vuelve la mercadería. */
  ventaId: string;
  devuelve: readonly RenglonADevolver[];
  seLleva: readonly SeLleva[];
  motivo: string;
  usuarioId: string;
  terminal: string;
  /** El turno de hoy: es donde cae la diferencia, si hay. */
  cashSessionId: string;
  /** Por dónde entra o sale la diferencia. No hace falta si el cambio es parejo. */
  medio?: MedioPago | null;
  monetaryAccountId?: string | null;
  idempotencyKey: string;
  ip?: string | null;
}

export interface CambioRegistrado {
  devolucionNumero: string;
  ventaNumero: string;
  /** Lo que valía lo que volvió, con el descuento de aquella venta prorrateado. */
  vueltoCentavos: number;
  /** Lo que vale lo que se llevó, al precio de mostrador de hoy. */
  llevadoCentavos: number;
  /** Positivo: lo paga el cliente. Negativo: se le devuelve. Cero: parejo. */
  diferenciaCentavos: number;
}

export async function registrarCambio(
  db: BaseDatos,
  datos: DatosCambio,
): Promise<CambioRegistrado> {
  if (datos.devuelve.length === 0) {
    throw new ErrorCambio('Elegí qué trae de vuelta.', 'nada_que_devolver');
  }
  if (datos.seLleva.length === 0) {
    throw new ErrorCambio('Elegí qué se lleva a cambio.', 'nada_que_llevar');
  }
  for (const l of datos.seLleva) {
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0) {
      throw new ErrorCambio('Las unidades de lo que se lleva tienen que ser un entero.');
    }
  }

  return db.transaction(async (tx) => {
    const vueltoCentavos = await loQueVuelveVale(tx, datos);
    const llevadoCentavos = await loQueSeLlevaVale(tx, datos.seLleva);
    const diferenciaCentavos = llevadoCentavos - vueltoCentavos;

    /*
     * Lo devuelto cubre la compra nueva hasta donde llega. Lo que sobre —si el
     * cliente se lleva algo más barato— sale como una devolución común, y lo
     * que falte lo paga.
     */
    const aCambioCentavos = Math.min(vueltoCentavos, llevadoCentavos);

    if (diferenciaCentavos !== 0 && (!datos.medio || !datos.monetaryAccountId)) {
      throw new ErrorCambio(
        diferenciaCentavos > 0
          ? 'Decí por dónde entra la diferencia que paga el cliente.'
          : 'Decí por dónde sale la diferencia que se le devuelve.',
        'sin_medio',
      );
    }

    const devolucion = await registrarDevolucion(tx, {
      ventaId: datos.ventaId,
      renglones: datos.devuelve,
      motivo: datos.motivo,
      usuarioId: datos.usuarioId,
      terminal: datos.terminal,
      cashSessionId: datos.cashSessionId,
      aCambioCentavos,
      // Lo que sobre no baja ninguna deuda: el cliente vino a cambiar algo, no
      // a cancelar una cuenta. Si quiere eso, está la pantalla de devolución.
      descontarDeDeudaCentavos: 0,
      medio: datos.medio ?? null,
      monetaryAccountId: datos.monetaryAccountId ?? null,
      ip: datos.ip ?? null,
    });

    const venta = await confirmarVenta(tx, {
      lineas: datos.seLleva.map((l) => ({
        productId: l.productId,
        cantidad: l.cantidad,
        variantId: l.variantId ?? null,
      })),
      pagos: [
        { medio: 'cambio' as const, montoCentavos: aCambioCentavos, returnId: devolucion.id },
        ...(diferenciaCentavos > 0
          ? [
              {
                medio: datos.medio!,
                montoCentavos: diferenciaCentavos,
                monetaryAccountId: datos.monetaryAccountId!,
              },
            ]
          : []),
      ],
      vendedorId: datos.usuarioId,
      cashSessionId: datos.cashSessionId,
      terminal: datos.terminal,
      idempotencyKey: datos.idempotencyKey,
      nota: `Cambio de la venta ${devolucion.numero}`,
      ip: datos.ip ?? null,
    });

    /*
     * No hace falta anotar en la devolución cuál fue la venta: una devolución
     * no se modifica ni se borra (disparador de 0012), y además el vínculo ya
     * está del otro lado. El pago «en cambio» de la venta apunta a esta
     * devolución, así que se va de una a la otra por ahí, en los dos sentidos.
     */

    return {
      devolucionNumero: devolucion.numero,
      ventaNumero: venta.numero,
      vueltoCentavos,
      llevadoCentavos,
      diferenciaCentavos,
    };
  });
}

/**
 * Cuánto vale lo que el cliente trae de vuelta.
 *
 * Sale de `loDevolvible`, que prorratea el descuento de aquella venta: tomarle
 * el precio de lista a algo comprado con 10% de descuento sería reconocerle
 * más plata de la que entró.
 */
async function loQueVuelveVale(tx: BaseDatos, datos: DatosCambio): Promise<number> {
  const devolvible = await loDevolvible(tx, datos.ventaId);
  if (!devolvible) {
    throw new ErrorDevolucion('No se encuentra esa venta.', 'no_existe');
  }

  const porLinea = new Map(devolvible.lineas.map((l) => [l.saleItemId, l]));
  let total = 0;
  for (const r of datos.devuelve) {
    const linea = porLinea.get(r.saleItemId);
    if (!linea) {
      throw new ErrorCambio('Ese renglón no es de esta venta.', 'datos_invalidos');
    }
    total += linea.precioUnitarioCentavos * r.cantidad;
  }
  return total;
}

/**
 * Cuánto vale lo que se lleva, al precio de mostrador de hoy.
 *
 * Usa `armarLinea`, que es la misma función con la que la venta arma sus
 * renglones: tiene que dar el mismo número, porque después los pagos del
 * cambio tienen que sumar exactamente el total de esa venta. Si alguna vez
 * difiere, `confirmarVenta` rechaza y la transacción entera se deshace —falla
 * ruidosa y sin dejar nada a medias— en vez de grabar un cambio descuadrado.
 */
async function loQueSeLlevaVale(tx: BaseDatos, seLleva: readonly SeLleva[]): Promise<number> {
  const ids = [...new Set(seLleva.map((l) => l.productId))];
  const idsVariante = [
    ...new Set(seLleva.map((l) => l.variantId).filter((x): x is string => Boolean(x))),
  ];

  const filasProducto = filasDe<Record<string, unknown>>(
    await tx.execute(sql`
      SELECT id, nombre, precio_centavos, moneda, precio_usd_centavos, precio_editable,
             gestiona_stock, stock, stock_comprometido, solo_mostrador, precio_local_centavos
        FROM products
       WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    `),
  );

  const catalogo = new Map<string, ProductoVendible>(
    filasProducto.map((f) => [
      String(f.id),
      {
        id: String(f.id),
        nombre: String(f.nombre),
        precioCentavos: Number(f.precio_centavos),
        moneda: f.moneda as 'ARS' | 'USD',
        precioUsdCentavos:
          f.precio_usd_centavos === null ? null : Number(f.precio_usd_centavos),
        precioEditable: Boolean(f.precio_editable),
        gestionaStock: Boolean(f.gestiona_stock),
        stock: Number(f.stock),
        stockComprometido: Number(f.stock_comprometido),
        soloMostrador: Boolean(f.solo_mostrador),
        precioLocalCentavos:
          f.precio_local_centavos === null ? null : Number(f.precio_local_centavos),
      },
    ]),
  );

  const variantes = new Map<string, VarianteVendible>();
  if (idsVariante.length > 0) {
    const filasVariante = filasDe<Record<string, unknown>>(
      await tx.execute(sql`
        SELECT id, nombre, precio_centavos, gestiona_stock, stock, activo
          FROM product_variants
         WHERE id IN (${sql.join(idsVariante.map((id) => sql`${id}`), sql`, `)})
      `),
    );
    for (const f of filasVariante) {
      variantes.set(String(f.id), {
        id: String(f.id),
        nombre: String(f.nombre),
        precioCentavos: Number(f.precio_centavos),
        gestionaStock: Boolean(f.gestiona_stock),
        stock: Number(f.stock),
        activo: Boolean(f.activo),
      });
    }
  }

  const cotizacion = await cotizacionVigente(tx);
  const recargoTiendaBp = await recargoDeTienda(tx);

  let total = 0;
  for (const l of seLleva) {
    const p = catalogo.get(l.productId);
    if (!p) {
      throw new ErrorCambio(
        'Ese producto ya no está en el catálogo. Buscalo de nuevo.',
        'datos_invalidos',
      );
    }
    if (p.precioEditable) {
      throw new ErrorCambio(
        `«${p.nombre}» lleva precio escrito a mano, así que no se puede cambiar por acá: ` +
          `hacé la devolución y después la venta nueva.`,
        'datos_invalidos',
      );
    }
    const linea = armarLinea(p, l.cantidad, {
      tcCentavos: cotizacion?.valorCentavos ?? null,
      variante: l.variantId ? (variantes.get(l.variantId) ?? null) : null,
      recargoTiendaBp,
    });
    total += linea.precioUnitarioCentavos * linea.cantidad;
  }
  return total;
}
