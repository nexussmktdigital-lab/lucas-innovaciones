import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { urlDeConexion } from './url';

/**
 * Conexion a PostgreSQL.
 *
 * Se abre de forma **perezosa**, en el primer uso y no al importar el modulo.
 * Importa porque Next recorre las rutas al compilar para recolectar sus datos,
 * y en ese momento todavia no hay variables de entorno: una conexion creada al
 * importar hace fallar el build entero con un error que no tiene nada que ver.
 *
 * En desarrollo la instancia vive en `globalThis` para que el hot reload no
 * abra un pool nuevo en cada recarga.
 */
type Cliente = ReturnType<typeof postgres>;
type Conexion = ReturnType<typeof crear>;

const global_ = globalThis as unknown as { __liSql?: Cliente; __liDb?: Conexion };

function crear() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Falta la variable de entorno DATABASE_URL. Ver .env.example');
  }

  /*
   * Cuántas conexiones abre el pool.
   *
   * Cinco contra un PostgreSQL de verdad. **Una sola contra el PostgreSQL
   * embebido de la demo**: PGlite es el motor compilado a WASM y corre en un
   * solo hilo, así que si el pool abre varias, dos consultas lanzadas en
   * paralelo —las siete de Reportes, las dos del alta de productos— le resetean
   * la conexión al cliente y la pantalla devuelve error. La demo lo avisa con
   * `POS_BASE_EMBEBIDA`.
   */
  const max = process.env.POS_BASE_EMBEBIDA === 'true' ? 1 : 5;

  const sql = global_.__liSql ?? postgres(urlDeConexion(url), { max, prepare: false });
  if (process.env.NODE_ENV !== 'production') global_.__liSql = sql;

  return drizzle(sql, { schema, casing: 'snake_case' });
}

function conexion(): Conexion {
  if (!global_.__liDb) global_.__liDb = crear();
  return global_.__liDb;
}

/**
 * La conexion, envuelta para diferir su creacion. Se usa igual que la instancia
 * de Drizzle: `db.select()`, `db.transaction()`, etc.
 */
export const db = new Proxy({} as Conexion, {
  get(_destino, propiedad, receptor) {
    const real = conexion() as unknown as Record<string | symbol, unknown>;
    const valor = Reflect.get(real, propiedad, receptor);
    return typeof valor === 'function' ? valor.bind(real) : valor;
  },
  has(_destino, propiedad) {
    return Reflect.has(conexion() as object, propiedad);
  },
});

export type Db = Conexion;
export { schema };
