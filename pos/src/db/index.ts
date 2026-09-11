import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('Falta la variable de entorno DATABASE_URL. Ver .env.example');
}

/**
 * Conexion unica reutilizada entre invocaciones. En desarrollo se guarda en
 * `globalThis` para que el hot reload de Next no abra un pool nuevo cada vez.
 */
const global_ = globalThis as unknown as { __liSql?: ReturnType<typeof postgres> };

const sql = global_.__liSql ?? postgres(url, { max: 5, prepare: false });
if (process.env.NODE_ENV !== 'production') global_.__liSql = sql;

export const db = drizzle(sql, { schema, casing: 'snake_case' });
export type Db = typeof db;
export { schema };
