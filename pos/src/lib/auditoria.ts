/**
 * Bitacora de auditoria.
 *
 * Toda operacion que toque plata, stock o precios deja rastro de quien la hizo.
 * La tabla es inmutable por disparador de base (ver 0001_registros_inmutables),
 * asi que este helper solo agrega.
 */
import { auditLog } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';

export interface EntradaAuditoria {
  usuarioId?: string | null;
  accion: string;
  entidad: string;
  entidadId?: string | null;
  valorAnterior?: unknown;
  valorNuevo?: unknown;
  ip?: string | null;
}

/**
 * Registra una entrada. Recibe la conexion o la transaccion en curso, para que
 * la auditoria se confirme o se descarte junto con la operacion que describe.
 */
export async function auditar(tx: BaseDatos, entrada: EntradaAuditoria): Promise<void> {
  await tx.insert(auditLog).values({
    usuarioId: entrada.usuarioId ?? null,
    accion: entrada.accion,
    entidad: entrada.entidad,
    entidadId: entrada.entidadId ?? null,
    valorAnterior: entrada.valorAnterior ?? null,
    valorNuevo: entrada.valorNuevo ?? null,
    ip: entrada.ip ?? null,
  });
}
