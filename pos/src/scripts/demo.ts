/**
 * Demo local en un solo comando: `npm run demo`
 *
 * No hace falta instalar PostgreSQL ni tener cuenta en ningun lado. Levanta un
 * PostgreSQL embebido (PGlite, el mismo motor compilado a WASM que usan los
 * tests), le aplica las migraciones, carga los datos de prueba y arranca el POS.
 *
 * Los datos quedan en `.demo/` y sobreviven a los reinicios.
 * Para empezar de cero: `npm run demo -- --reset`
 */
import { mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/db/schema';
import { sembrar, vaciar } from '@/db/seed';

const CARPETA = '.demo';
const PUERTO_BASE = 55433;
const PUERTO_APP = Number(process.env.PORT ?? 3000);

async function main() {
  const reiniciar = process.argv.includes('--reset');
  if (reiniciar) {
    rmSync(CARPETA, { recursive: true, force: true });
    console.log('Datos anteriores borrados.');
  }
  mkdirSync(CARPETA, { recursive: true });

  console.log('Levantando PostgreSQL embebido…');
  const cliente = new PGlite(`${CARPETA}/pgdata`);
  await cliente.waitReady;

  const db = drizzle(cliente, { schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migraciones aplicadas.');

  if (reiniciar) await vaciar(db);
  const semilla = await sembrar(db);

  const servidor = new PGLiteSocketServer({ db: cliente, port: PUERTO_BASE, host: '127.0.0.1' });
  await servidor.start();

  const url = `postgresql://postgres@127.0.0.1:${PUERTO_BASE}/postgres`;

  console.log('');
  console.log('  POS de Lucas Innovaciones — demo local');
  console.log('  ─────────────────────────────────────');
  console.log(`  Dirección:  http://localhost:${PUERTO_APP}`);
  console.log(`  Dueño:      ${semilla.emailDuenio}`);
  console.log(`  Contraseña: ${semilla.passwordDuenio}`);
  console.log(`  Vendedor:   PIN ${semilla.pinVendedor}`);
  console.log(`  Catálogo:   ${semilla.productos} productos de prueba`);
  console.log('');
  console.log('  Cortá con Ctrl+C.');
  console.log('');

  const app = spawn('npx', ['next', 'dev', '--port', String(PUERTO_APP)], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      DATABASE_URL: url,
      // Clave efímera: la demo no comparte sesión con nada.
      AUTH_SECRET: process.env.AUTH_SECRET ?? randomBytes(32).toString('base64'),
      AUTH_TRUST_HOST: 'true',
      POS_TERMINAL: process.env.POS_TERMINAL ?? 'T1',
    },
  });

  const cerrar = async () => {
    app.kill('SIGTERM');
    await servidor.stop();
    await cliente.close();
    process.exit(0);
  };

  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);
  app.on('exit', cerrar);
}

await main();
