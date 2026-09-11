/**
 * Base de datos efimera para los tests.
 *
 * Usa PGlite (PostgreSQL compilado a WASM), asi que los tests corren sin
 * levantar ningun servidor y prueban el esquema REAL: mismas restricciones,
 * mismos disparadores, mismas migraciones que produccion.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';

export type TestDb = ReturnType<typeof drizzle<typeof schema>> & { $cliente: PGlite };

/** Vacia todas las tablas de datos conservando el esquema.
 *
 * Los disparadores de inmutabilidad actuan por fila y no bloquean TRUNCATE, asi
 * que un test puede empezar de cero sin volver a migrar (que tarda segundos).
 */
export async function vaciar(db: TestDb): Promise<void> {
  const { rows } = await db.$cliente.query<{ tabla: string }>(
    `SELECT tablename AS tabla FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'`,
  );
  if (rows.length === 0) return;
  const lista = rows.map((r) => `"${r.tabla}"`).join(', ');
  await db.$cliente.exec(`TRUNCATE ${lista} RESTART IDENTITY CASCADE`);
}

/** Crea una base en memoria con todas las migraciones aplicadas. */
export async function crearBaseDePrueba(): Promise<TestDb> {
  const cliente = new PGlite();
  const db = drizzle(cliente, { schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: './drizzle' });
  return Object.assign(db, { $cliente: cliente }) as TestDb;
}

/**
 * Comprueba que una operacion falle con un error de PostgreSQL que coincida con
 * el patron dado.
 *
 * Hace falta un helper porque Drizzle envuelve el error original en uno propio
 * ("Failed query: ..."), asi que hay que recorrer la cadena de `cause` para
 * llegar al mensaje y al codigo que realmente devolvio la base.
 */
export async function rechazaCon(
  operacion: Promise<unknown> | (() => Promise<unknown>),
  patron: RegExp,
): Promise<void> {
  let error: unknown;
  try {
    await (typeof operacion === 'function' ? operacion() : operacion);
  } catch (e) {
    error = e;
  }

  if (error === undefined) {
    throw new Error(`Se esperaba un error que coincidiera con ${patron}, pero no fallo.`);
  }

  const textos: string[] = [];
  let actual: unknown = error;
  for (let i = 0; i < 10 && actual instanceof Error; i += 1) {
    textos.push(actual.message);
    const detalle = (actual as Error & { detail?: string; constraint?: string; code?: string });
    if (detalle.detail) textos.push(detalle.detail);
    if (detalle.constraint) textos.push(detalle.constraint);
    if (detalle.code) textos.push(detalle.code);
    actual = (actual as Error).cause;
  }

  const completo = textos.join('\n');
  if (!patron.test(completo)) {
    throw new Error(
      `El error no coincide con ${patron}.\nError recibido:\n${completo || String(error)}`,
    );
  }
}
