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
