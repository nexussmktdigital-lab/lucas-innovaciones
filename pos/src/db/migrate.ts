/**
 * Aplica las migraciones pendientes. Uso: `npm run db:migrate`
 */
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { normalizarUrlDeConexion } from './url';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL. Copiá .env.example a .env y completala.');
  process.exit(1);
}

const { url: limpia, descartados } = normalizarUrlDeConexion(url);
if (descartados.length > 0) {
  console.log(`Se ignoran parámetros de libpq que el driver de Node no usa: ${descartados.join(', ')}`);
}

/*
 * `prepare: false` porque la cadena puede ser la del pooler de Neon.
 *
 * El pooler es PgBouncer en modo transacción y ahí las sentencias preparadas
 * con nombre no sobreviven: cada consulta puede caer en otra conexión del
 * fondo común. Para un script que corre unas pocas consultas y termina, las
 * preparadas no aportan nada, así que se apagan y la cadena que se pegue
 * —pooled o directa— anda igual.
 */
const sql = postgres(limpia, { max: 1, prepare: false });

try {
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  console.log('Migraciones aplicadas.');
} catch (error) {
  console.error('Fallaron las migraciones:', error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
