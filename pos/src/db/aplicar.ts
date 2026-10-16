/**
 * Aplicar las migraciones pendientes.
 *
 * Lo usan los dos caminos que migran —`npm run db:migrate` desde una consola y
 * el despliegue en Vercel— para que no puedan separarse. Antes el despliegue no
 * migraba nada y el orden quedaba en manos de quien desplegaba; el día que se
 * hizo al revés, el POS escribió una columna que la base todavía no tenía y
 * **toda venta falló** con «No se pudo confirmar la venta».
 *
 * **Todas las pendientes van en UNA transacción**, no una por cada una: así lo
 * hace el migrador de Drizzle. Si la última falla no queda aplicada ninguna, lo
 * que es bueno —no hay esquema a medias— y tiene una consecuencia al
 * escribirlas: un valor nuevo de enum no se puede usar en la misma corrida que
 * lo creó, así que un CHECK que lo nombre compara `columna::text`.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { normalizarUrlDeConexion } from './url';

export interface ResultadoMigracion {
  /** Parámetros de libpq que la cadena traía y el driver de Node no usa. */
  descartados: string[];
}

export async function aplicarMigraciones(
  url: string,
  carpeta = './drizzle',
  /**
   * Qué hacer con los avisos de PostgreSQL.
   *
   * Los emite de a montones —«ya existe, se saltea»— y el driver los imprime
   * como objetos de diez líneas cada uno. En el registro de un despliegue eso
   * entierra lo único que importa, que es si falló o no.
   */
  avisar: (mensaje: string) => void = () => {},
): Promise<ResultadoMigracion> {
  const { url: limpia, descartados } = normalizarUrlDeConexion(url);

  /*
   * `prepare: false` porque la cadena puede ser la del pooler de Neon.
   *
   * El pooler es PgBouncer en modo transacción y ahí las sentencias preparadas
   * con nombre no sobreviven: cada consulta puede caer en otra conexión del
   * fondo común. Para unas pocas consultas que terminan, las preparadas no
   * aportan nada, así que se apagan y la cadena que se pegue —pooled o
   * directa— anda igual.
   */
  const sql = postgres(limpia, {
    max: 1,
    prepare: false,
    onnotice: (aviso) => avisar(aviso.message ?? String(aviso)),
  });

  try {
    await migrate(drizzle(sql), { migrationsFolder: carpeta });
    return { descartados };
  } finally {
    await sql.end();
  }
}
