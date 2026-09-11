/**
 * Tipo comun de conexion.
 *
 * Sirve tanto para la conexion real (postgres-js) como para la de los tests
 * (PGlite), asi que la logica de negocio se escribe una sola vez y se prueba
 * contra el esquema de verdad.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

export type BaseDatos = PgDatabase<PgQueryResultHKT, typeof schema, any>;

/**
 * Normaliza el resultado de `db.execute()`.
 *
 * Cada driver devuelve una forma distinta: postgres-js entrega un array de
 * filas y PGlite un objeto con `.rows`. Como la logica corre contra los dos
 * —produccion y tests— toda consulta cruda pasa por aca.
 */
export function filas<T>(resultado: unknown): T[] {
  if (Array.isArray(resultado)) return resultado as T[];
  const conRows = resultado as { rows?: unknown };
  if (conRows && Array.isArray(conRows.rows)) return conRows.rows as T[];
  return [];
}
