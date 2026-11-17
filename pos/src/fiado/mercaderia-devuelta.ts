/**
 * El cliente devuelve mercadería y se le descuenta de la cuenta.
 *
 * Nace del cliente mayorista: lleva cosas todas las semanas, paga de a poco, y
 * cada tanto trae de vuelta lo que no vendió. La pantalla de Devoluciones no
 * sirve para eso porque trabaja siempre contra una venta, y lo que él se llevó
 * vino de la libreta de papel: no hay venta detrás y no la va a haber.
 *
 * Dos cosas pasan a la vez y por eso están en una sola transacción: **la
 * mercadería vuelve al stock** y **la deuda baja**. Hacerlo en dos pantallas
 * —sumar stock por un lado, tocar la cuenta por el otro— es dejar la puerta
 * abierta a que una salga y la otra no, y nadie se entera hasta que el conteo
 * no cierra.
 *
 * **No es un pago.** No entró plata: entraron cosas. Registrarlo como pago
 * pondría en el reporte del mes un ingreso que ninguna caja respalda, que es
 * exactamente de lo que se cuidan las entregas migradas de la libreta. Queda
 * como un cargo negativo: el mismo hecho que la compra, con el signo al revés.
 *
 * **El importe lo escribe quien atiende, renglón por renglón.** El sistema no
 * puede saberlo: lo que se le reconoce por un termo devuelto se negocia con el
 * cliente enfrente, y no tiene por qué ser lo que pagó —la libreta de Uriel
 * tiene un vaso de $17.000 que volvió por $8.500—.
 */
import { eq } from 'drizzle-orm';
import { auditLog, creditAccounts, creditCharges } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import { sumarStock } from '@/catalogo/stock';
import { cuentaBloqueada, ErrorFiado } from './cuenta';

/** Un renglón de lo que volvió: qué, cuántos y cuánto se le reconoce. */
export interface RenglonDevuelto {
  productId: string;
  cantidad: number;
  /** Lo que se le descuenta de la deuda por este renglón, en centavos. */
  montoCentavos: number;
}

export interface MercaderiaDevuelta {
  totalCentavos: number;
  /** Lo que queda debiendo después de la devolución. */
  saldoCentavos: number;
  renglones: { nombre: string; cantidad: number; montoCentavos: number }[];
}

export async function registrarMercaderiaDevuelta(
  db: BaseDatos,
  datos: {
    customerId: string;
    renglones: readonly RenglonDevuelto[];
    usuarioId: string;
    nota?: string | null;
  },
): Promise<MercaderiaDevuelta> {
  if (datos.renglones.length === 0) {
    throw new ErrorFiado('No hay nada devuelto que registrar.', 'monto_invalido');
  }
  for (const r of datos.renglones) {
    if (!Number.isInteger(r.cantidad) || r.cantidad <= 0) {
      throw new ErrorFiado('Las unidades devueltas tienen que ser un número entero.', 'monto_invalido');
    }
    if (!Number.isInteger(r.montoCentavos) || r.montoCentavos <= 0) {
      throw new ErrorFiado(
        'Cada renglón devuelto tiene que tener un importe mayor a cero.',
        'monto_invalido',
      );
    }
  }

  const totalCentavos = datos.renglones.reduce((t, r) => t + r.montoCentavos, 0);

  return db.transaction(async (tx) => {
    const cuenta = await cuentaBloqueada(tx, datos.customerId);

    /*
     * Más de lo que debe no se puede descontar.
     *
     * El fiado es una cuenta de saldo que no admite negativos a proposito
     * (D36): «te debo» y «me debes» son dos cosas y el mostrador las trata
     * distinto. Recortar en cero haría desaparecer en silencio la plata que
     * el local le quedaría debiendo, así que se frena y se explica.
     */
    if (totalCentavos > cuenta.saldoCentavos) {
      throw new ErrorFiado(
        `La devolución es más de lo que debe. Debe ${cuenta.saldoCentavos / 100} y se están ` +
          `descontando ${totalCentavos / 100}. Si el local le queda debiendo plata, eso se ` +
          `resuelve aparte: descontá hasta donde llega la deuda.`,
        'monto_invalido',
      );
    }

    /*
     * La mercadería vuelve al stock por el mismo camino que una entrega del
     * proveedor: `sumarStock` deja el movimiento, la bitácora y el empuje a la
     * tienda. Reescribir eso acá sería tener dos formas de que entre una
     * unidad, y una de las dos quedaría sin el empuje el día que algo cambie.
     */
    const renglones: MercaderiaDevuelta['renglones'] = [];
    for (const r of datos.renglones) {
      const sumado = await sumarStock(tx, {
        productId: r.productId,
        cantidad: r.cantidad,
        usuarioId: datos.usuarioId,
        motivo: 'Devolución de un cliente',
      });
      renglones.push({
        nombre: sumado.nombre,
        cantidad: r.cantidad,
        montoCentavos: r.montoCentavos,
      });
    }

    const saldoCentavos = cuenta.saldoCentavos - totalCentavos;

    await tx.insert(creditCharges).values({
      creditAccountId: cuenta.id,
      descripcion: 'Devolución de mercadería',
      detalle: renglones
        .map((r) => `${r.cantidad} x ${r.nombre} $${(r.montoCentavos / 100).toLocaleString('es-AR')}`)
        .join('\n'),
      // Negativo: es una compra con el signo al revés.
      montoCentavos: -totalCentavos,
      saldoResultanteCentavos: saldoCentavos,
      cargadoPorId: datos.usuarioId,
      nota: datos.nota ?? null,
    });

    await tx
      .update(creditAccounts)
      .set({ saldoCentavos, updatedAt: new Date() })
      .where(eq(creditAccounts.id, cuenta.id));

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'fiado.mercaderia_devuelta',
      entidad: 'credit_accounts',
      entidadId: cuenta.id,
      valorAnterior: { saldoCentavos: cuenta.saldoCentavos },
      valorNuevo: {
        saldoCentavos,
        totalCentavos,
        renglones,
        nota: datos.nota ?? null,
      },
    });

    return { totalCentavos, saldoCentavos, renglones };
  });
}

/** Lo que se le puede descontar como máximo: lo que debe. */
export async function topeDeDevolucion(db: BaseDatos, customerId: string): Promise<number> {
  const [c] = await db
    .select({ saldoCentavos: creditAccounts.saldoCentavos })
    .from(creditAccounts)
    .where(eq(creditAccounts.customerId, customerId))
    .limit(1);
  return c?.saldoCentavos ?? 0;
}
