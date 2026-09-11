/**
 * Aplica las migraciones pendientes. Uso: `npm run db:migrate`
 */
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL. Copiá .env.example a .env y completala.');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  console.log('Migraciones aplicadas.');
} catch (error) {
  console.error('Fallaron las migraciones:', error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
