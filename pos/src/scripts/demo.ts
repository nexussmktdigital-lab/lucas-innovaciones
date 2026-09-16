/**
 * Demo local en un solo comando: `npm run demo`
 *
 * No hace falta instalar PostgreSQL ni tener cuenta en ningun lado. Levanta un
 * PostgreSQL embebido (PGlite, el mismo motor compilado a WASM que usan los
 * tests), le aplica las migraciones, carga los datos de prueba y arranca el POS.
 *
 * Los datos quedan en `.demo/` y sobreviven a los reinicios.
 * Para empezar de cero: `npm run demo -- --reset`
 *
 * PGlite es WASM y no anda igual en todas las maquinas: en Windows con Node 24
 * llega a abortar al abrir la carpeta de datos. Por eso este script degrada en
 * vez de morir: si no puede guardar en disco arranca en memoria, y si no puede
 * ni eso usa la base de `DATABASE_URL` si esta configurada. La demo tiene que
 * levantar aunque el motor embebido falle.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import 'dotenv/config';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/db/schema';
import { sembrar, vaciar } from '@/db/seed';

/** Absoluta: PGlite monta la carpeta en su filesystem virtual y las rutas relativas la confunden. */
const CARPETA = resolve('.demo');
const DATOS = resolve(CARPETA, 'pgdata');
const PUERTO_BASE = 55433;
const PUERTO_APP = Number(process.env.PORT ?? 3000);

/**
 * Arranca el POS contra la base indicada y devuelve el proceso.
 *
 * Con `--produccion` construye primero y corre el resultado, en vez de `next
 * dev`. Es la única forma de probar el modo sin conexión: el service worker no
 * se registra en desarrollo a propósito —servir páginas guardadas mientras uno
 * edita código es la forma más rápida de mirar una versión vieja— así que en la
 * demo de todos los días no hay nada que sostenga la pantalla cuando se corta.
 */
function arrancarApp(url: string): ChildProcess {
  const comoEnProduccion = process.argv.includes('--produccion');

  if (comoEnProduccion) {
    console.log('Construyendo como en producción (tarda ~30 s)…\n');
    const construccion = spawnSync('npx', ['next', 'build'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, DATABASE_URL: url, ...variables() },
    });
    if (construccion.status !== 0) {
      console.error('Falló la construcción.');
      process.exit(1);
    }
  }

  const comando = comoEnProduccion
    ? ['next', 'start', '--port', String(PUERTO_APP)]
    : ['next', 'dev', '--port', String(PUERTO_APP)];

  return spawn('npx', comando, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: url, ...variables() },
  });
}

/** Lo que el POS necesita en el entorno para correr contra la base de la demo. */
function variables(): Record<string, string> {
  return {
    // Clave efímera: la demo no comparte sesión con nada.
    AUTH_SECRET: process.env.AUTH_SECRET ?? CLAVE_DE_LA_DEMO,
    AUTH_TRUST_HOST: 'true',
    POS_TERMINAL: process.env.POS_TERMINAL ?? 'T1',
    /*
     * Le avisa a la conexión que del otro lado hay PGlite y no un PostgreSQL de
     * verdad, para que abra una sola conexión. PGlite es un único hilo: si el
     * pool abre varias, dos consultas lanzadas en paralelo —las siete de
     * Reportes, las dos del alta de productos— le cortan la conexión al cliente
     * y la pantalla devuelve error.
     */
    POS_BASE_EMBEBIDA: 'true',
  };
}

/** Una sola por corrida: si se generara dos veces, la sesión no sobreviviría al build. */
const CLAVE_DE_LA_DEMO = randomBytes(32).toString('base64');

function porQue(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Abre PGlite con la mayor persistencia que la máquina banque.
 *
 * Un aborto de WASM al abrir la carpeta suele ser una carpeta a medio escribir
 * de una corrida anterior, así que antes de rendirse la borra y reintenta.
 */
async function abrirBase(): Promise<{ cliente: PGlite; enMemoria: boolean }> {
  mkdirSync(CARPETA, { recursive: true });

  try {
    return { cliente: await conectar(DATOS), enMemoria: false };
  } catch (error) {
    console.warn(`\nPGlite no pudo abrir ${DATOS}: ${porQue(error)}`);

    if (existsSync(DATOS)) {
      console.warn('Puede ser una carpeta de datos incompleta. La borro y reintento…');
      rmSync(DATOS, { recursive: true, force: true });
      try {
        return { cliente: await conectar(DATOS), enMemoria: false };
      } catch (segundo) {
        console.warn(`Tampoco anduvo de cero: ${porQue(segundo)}`);
      }
    }

    console.warn('Arranco la base en memoria: vas a poder probar todo, pero al cortar se pierde.\n');
    return { cliente: await conectar(undefined), enMemoria: true };
  }
}

/**
 * Abre una instancia de PGlite. `undefined` como carpeta significa en memoria.
 *
 * Cuando el WASM aborta, Emscripten no siempre rechaza la promesa: tira el error
 * fuera del stack y Node mata el proceso («RuntimeError: Aborted()»). Por eso
 * durante el arranque escuchamos también las caídas globales, para poder
 * degradar en lugar de morir. Los oyentes se quitan apenas termina.
 */
async function conectar(carpeta: string | undefined): Promise<PGlite> {
  let caida: (error: unknown) => void = () => {};

  try {
    return await new Promise<PGlite>((cumplir, fallar) => {
      caida = (error: unknown) =>
        fallar(error instanceof Error ? error : new Error(String(error)));
      process.once('uncaughtException', caida);
      process.once('unhandledRejection', caida);

      const cliente = carpeta === undefined ? new PGlite() : new PGlite(carpeta);
      cliente.waitReady.then(() => cumplir(cliente), caida);
    });
  } finally {
    process.off('uncaughtException', caida);
    process.off('unhandledRejection', caida);
  }
}

/**
 * Salida cuando PGlite no arranca de ninguna forma.
 *
 * Si la máquina ya tiene una base de verdad configurada, la demo no tiene por
 * qué frustrarse: arranca contra esa.
 */
function sinPGlite(error: unknown): ChildProcess {
  const url = process.env.DATABASE_URL;

  console.error(`\nNo se pudo levantar el PostgreSQL embebido: ${porQue(error)}`);
  console.error(`Node ${process.version} en ${process.platform}. PGlite es WASM y en Windows con`);
  console.error('Node 24 se lo ha visto abortar; con Node 22 LTS anda.\n');

  if (!url) {
    console.error('Salidas, de más rápida a menos:');
    console.error('  1. Instalá Node 22 LTS (nvm install 22) y repetí `npm run demo`.');
    console.error('  2. Copiá .env.example a .env con una base PostgreSQL de verdad y usá:');
    console.error('     npm run db:migrate && npm run db:seed && npm run dev');
    process.exit(1);
  }

  console.error('Tenés DATABASE_URL configurado, así que arranco el POS contra esa base.');
  console.error('Ojo: es tu base real, no una demo. Los datos que cargues quedan.\n');
  return arrancarApp(url);
}

async function main() {
  const reiniciar = process.argv.includes('--reset');
  if (reiniciar) {
    rmSync(CARPETA, { recursive: true, force: true });
    console.log('Datos anteriores borrados.');
  }

  console.log('Levantando PostgreSQL embebido…');

  let base: { cliente: PGlite; enMemoria: boolean };
  try {
    base = await abrirBase();
  } catch (error) {
    const app = sinPGlite(error);
    app.on('exit', (codigo) => process.exit(codigo ?? 0));
    return;
  }

  const { cliente, enMemoria } = base;
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
  if (enMemoria) console.log('  Datos:      en memoria, se pierden al cortar');
  console.log('');
  console.log('  Cortá con Ctrl+C.');
  console.log('');

  const app = arrancarApp(url);

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
