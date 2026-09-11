/**
 * Carga los datos de prueba en la base configurada.
 *
 * Uso:
 *   npm run db:seed            agrega los datos
 *   npm run db:seed -- --reset vacía primero y vuelve a cargar
 */
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { sembrar, vaciar } from '@/db/seed';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL. Copiá .env.example a .env y completala.');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
const db = drizzle(sql, { schema, casing: 'snake_case' });

try {
  if (process.argv.includes('--reset')) {
    const n = await vaciar(db);
    console.log(`Vaciadas ${n} tablas.`);
  }
  const r = await sembrar(db);
  console.log('Datos de prueba cargados.');
  console.log(`  Dueño:    ${r.emailDuenio} / ${r.passwordDuenio}`);
  console.log(`  Vendedor: PIN ${r.pinVendedor}`);
  console.log(`  ${r.productos} productos, ${r.categoriasDeGasto} categorías de gasto.`);
} finally {
  await sql.end();
}
