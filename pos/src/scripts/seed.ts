/**
 * Carga los datos de prueba en la base configurada.
 *
 * Uso:
 *   npm run db:seed                    agrega los datos
 *   npm run db:seed -- --reset         vacía primero y vuelve a cargar
 *   npm run db:seed -- --forzar-catalogo  mete el catálogo de prueba aunque
 *                                      ya haya catálogo real (no recomendado)
 */
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { urlDeConexion } from '@/db/url';
import { sembrar, vaciar } from '@/db/seed';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL. Copiá .env.example a .env y completala.');
  process.exit(1);
}

const sql = postgres(urlDeConexion(url), { max: 1 });
const db = drizzle(sql, { schema, casing: 'snake_case' });

try {
  if (process.argv.includes('--reset')) {
    const n = await vaciar(db);
    console.log(`Vaciadas ${n} tablas.`);
  }
  const r = await sembrar(db, { forzarCatalogo: process.argv.includes('--forzar-catalogo') });
  console.log('Datos de prueba cargados.');
  console.log(`  Dueño:    ${r.emailDuenio} / ${r.passwordDuenio}`);
  console.log(`  Vendedor: PIN ${r.pinVendedor}`);
  console.log(`  ${r.categoriasDeGasto} categorías de gasto, 3 cuentas monetarias.`);
  if (r.catalogoOmitido) {
    console.log('');
    console.log('  El catálogo de prueba se OMITIÓ: la base ya tiene el catálogo real');
    console.log('  sincronizado desde WooCommerce, y mezclarlos dejaría productos que');
    console.log('  no existen en la tienda.');
  } else {
    console.log(`  ${r.productos} productos de prueba.`);
  }
} finally {
  await sql.end();
}
