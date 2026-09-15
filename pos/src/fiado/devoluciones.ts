/**
 * Plata que el negocio le quedo debiendo a un cliente.
 *
 * Nace de un caso concreto que la auditoria encontro operando el sistema: se le
 * fia $5.000 a alguien, el cliente pasa y paga $4.000 a cuenta, y despues se
 * anula esa venta. La deuda se va con la venta —correcto—, pero los $4.000
 * entraron a la caja y el cliente no se llevo nada. Antes de esto, el sistema
 * decia que estaban a mano.
 *
 * Por que una tabla aparte y no un saldo a favor en la cuenta corriente: el
 * fiado es una cuenta de saldo que no admite negativos a proposito (D36), y
 * torcerlo para que los admita convertiria «te debo» y «me debes» en el mismo
 * numero con distinto signo. Son dos cosas distintas y el mostrador las trata
 * distinto: una se cobra, la otra se devuelve.
 *
 * No mueve plata sola. Sacar el efectivo del cajon es un acto de una persona,
 * que puede pasar en otro turno y por otro medio del que entro; lo que el
 * sistema hace es no dejar que se olvide.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { auditLog, customers, pendingRefunds, sales } from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';

export class ErrorDevolucion extends Error {}

export interface DevolucionPendiente {
  id: string;
  customerId: string;
  nombre: string;
  telefono: string | null;
  saleId: string;
  numero: string;
  montoCentavos: number;
  motivo: string | null;
  creadoEn: Date;
}

/**
 * Anota que hay plata para devolverle a un cliente.
 *
 * Se llama desde adentro de la transaccion de la anulacion: si la anulacion no
 * entra, esto tampoco.
 */
export async function anotarDevolucion(
  tx: BaseDatos,
  datos: {
    customerId: string;
    saleId: string;
    montoCentavos: number;
    motivo: string | null;
    usuarioId: string;
  },
): Promise<void> {
  if (!Number.isInteger(datos.montoCentavos) || datos.montoCentavos <= 0) {
    throw new ErrorDevolucion('El monto a devolver tiene que ser mayor a cero.');
  }

  const [fila] = await tx
    .insert(pendingRefunds)
    .values({
      customerId: datos.customerId,
      saleId: datos.saleId,
      montoCentavos: datos.montoCentavos,
      motivo: datos.motivo,
      creadoPorId: datos.usuarioId,
    })
    .returning({ id: pendingRefunds.id });

  await tx.insert(auditLog).values({
    usuarioId: datos.usuarioId,
    accion: 'fiado.devolucion_pendiente',
    entidad: 'pending_refunds',
    entidadId: fila!.id,
    valorNuevo: {
      customerId: datos.customerId,
      saleId: datos.saleId,
      montoCentavos: datos.montoCentavos,
    },
  });
}

const SELECT_PENDIENTE = sql`
  SELECT d.id, d.customer_id, c.nombre, c.telefono, d.sale_id, s.numero,
         d.monto_centavos, d.motivo, d.creado_en
    FROM pending_refunds d
    JOIN customers c ON c.id = d.customer_id
    JOIN sales s ON s.id = d.sale_id
`;

interface FilaPendiente {
  id: string;
  customer_id: string;
  nombre: string;
  telefono: string | null;
  sale_id: string;
  numero: string;
  monto_centavos: string | number;
  motivo: string | null;
  creado_en: string | Date;
}

function aDevolucion(f: FilaPendiente): DevolucionPendiente {
  return {
    id: String(f.id),
    customerId: String(f.customer_id),
    nombre: String(f.nombre),
    telefono: f.telefono,
    saleId: String(f.sale_id),
    numero: String(f.numero),
    montoCentavos: Number(f.monto_centavos),
    motivo: f.motivo,
    creadoEn: new Date(f.creado_en),
  };
}

/** Todo lo que falta devolver, de lo mas viejo a lo mas nuevo. */
export async function devolucionesPendientes(db: BaseDatos): Promise<DevolucionPendiente[]> {
  const filas = filasDe<FilaPendiente>(
    await db.execute(sql`${SELECT_PENDIENTE} WHERE d.resuelto_en IS NULL ORDER BY d.creado_en ASC`),
  );
  return filas.map(aDevolucion);
}

/** Lo que falta devolverle a un cliente en particular. */
export async function devolucionesDe(
  db: BaseDatos,
  customerId: string,
): Promise<DevolucionPendiente[]> {
  const filas = filasDe<FilaPendiente>(
    await db.execute(sql`
      ${SELECT_PENDIENTE}
       WHERE d.resuelto_en IS NULL AND d.customer_id = ${customerId}
       ORDER BY d.creado_en ASC
    `),
  );
  return filas.map(aDevolucion);
}

/** Cuánto falta devolver en total, para el aviso de la pantalla de inicio. */
export async function totalADevolver(
  db: BaseDatos,
): Promise<{ totalCentavos: number; cuantas: number }> {
  const [r] = await db
    .select({
      totalCentavos: sql<number>`COALESCE(SUM(${pendingRefunds.montoCentavos}), 0)`.mapWith(Number),
      cuantas: sql<number>`count(*)`.mapWith(Number),
    })
    .from(pendingRefunds)
    .where(isNull(pendingRefunds.resueltoEn));

  return { totalCentavos: r?.totalCentavos ?? 0, cuantas: r?.cuantas ?? 0 };
}

/**
 * Marca que la plata se devolvio.
 *
 * No toca la caja: la salida de efectivo, si la hubo, se registra por donde se
 * registra cualquier salida. Esto solo cierra el recordatorio, y deja quien lo
 * cerro y cuando.
 */
export async function marcarDevuelta(
  db: BaseDatos,
  datos: { id: string; usuarioId: string; nota?: string | null },
): Promise<DevolucionPendiente> {
  return db.transaction(async (tx) => {
    const [antes] = await tx
      .select()
      .from(pendingRefunds)
      .where(eq(pendingRefunds.id, datos.id))
      .limit(1);

    if (!antes) throw new ErrorDevolucion('No se encuentra esa devolución.');
    if (antes.resueltoEn) {
      throw new ErrorDevolucion('Esa devolución ya figura como hecha.');
    }

    await tx
      .update(pendingRefunds)
      .set({
        resueltoEn: new Date(),
        resueltoPorId: datos.usuarioId,
        notaResolucion: datos.nota?.trim() || null,
      })
      .where(eq(pendingRefunds.id, datos.id));

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'fiado.devolucion_hecha',
      entidad: 'pending_refunds',
      entidadId: datos.id,
      valorAnterior: { montoCentavos: antes.montoCentavos },
      valorNuevo: { resuelto: true, nota: datos.nota ?? null },
    });

    const [fila] = filasDe<FilaPendiente>(
      await tx.execute(sql`${SELECT_PENDIENTE} WHERE d.id = ${datos.id}`),
    );
    return aDevolucion(fila!);
  });
}

/** El historial completo de un cliente, devueltas incluidas, para su ficha. */
export async function historialDeDevoluciones(
  db: BaseDatos,
  customerId: string,
): Promise<(DevolucionPendiente & { resueltoEn: Date | null })[]> {
  const filas = await db
    .select({
      id: pendingRefunds.id,
      customerId: pendingRefunds.customerId,
      nombre: customers.nombre,
      telefono: customers.telefono,
      saleId: pendingRefunds.saleId,
      numero: sales.numero,
      montoCentavos: pendingRefunds.montoCentavos,
      motivo: pendingRefunds.motivo,
      creadoEn: pendingRefunds.creadoEn,
      resueltoEn: pendingRefunds.resueltoEn,
    })
    .from(pendingRefunds)
    .innerJoin(customers, eq(customers.id, pendingRefunds.customerId))
    .innerJoin(sales, eq(sales.id, pendingRefunds.saleId))
    .where(and(eq(pendingRefunds.customerId, customerId)))
    .orderBy(desc(pendingRefunds.creadoEn));

  return filas;
}
