/**
 * Chequeo de configuracion antes de desplegar.
 *
 * Uso:
 *   npm run produccion:chequear         contra el .env de esta maquina
 *   vercel env pull .env.produccion && \
 *     npm run produccion:chequear -- --env .env.produccion
 *
 * Sale con codigo 1 si falta algo, asi se puede encadenar en un despliegue.
 * No imprime ningun secreto: solo dice si esta y a donde apunta.
 */
import { readFileSync } from 'node:fs';
import { config as cargarEnv } from 'dotenv';
import { chequearProduccion, entornoActual, type Gravedad } from '@/lib/produccion';

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const archivo = argumento('env');
cargarEnv(archivo ? { path: archivo, override: true } : {});

// Un archivo de producción traído con `vercel env pull` no incluye VERCEL_ENV,
// así que se puede forzar el punto de vista del chequeo.
if (process.argv.includes('--produccion')) process.env.VERCEL_ENV = 'production';

const SIMBOLO: Record<Gravedad, string> = { ok: '  OK  ', aviso: 'AVISO ', falta: 'FALTA ' };

const chequeos = chequearProduccion();
const entorno = entornoActual();

console.log(`\nConfiguración para «${entorno}»${archivo ? ` — ${archivo}` : ''}\n`);

for (const c of chequeos) {
  console.log(`[${SIMBOLO[c.gravedad]}] ${c.titulo}`);
  console.log(`          ${c.detalle}`);
  if (c.arreglo) console.log(`          → ${c.arreglo}`);
  console.log('');
}

let faltan = chequeos.filter((c) => c.gravedad === 'falta').length;
const avisos = chequeos.filter((c) => c.gravedad === 'aviso').length;

/*
 * Las migraciones no corren solas al desplegar, y es a propósito: una
 * construcción en Vercel no tendría por qué poder escribir en la base de
 * producción, y una vista previa terminaría migrándola. La contrapartida es que
 * se puede desplegar código que espera una columna que todavía no existe, y eso
 * se ve como un error raro en el mostrador en vez de como lo que es.
 *
 * Así que se comprueba acá, que es el paso que ya se corre antes de desplegar.
 */
async function chequearMigraciones() {
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const { filas } = await import('@/db/tipos');

  const diario = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries: { when: number; tag: string }[];
  };

  const aplicadas = filas<{ created_at: string | number }>(
    await db.execute(sql`SELECT created_at FROM drizzle.__drizzle_migrations`),
  );
  const yaEstan = new Set(aplicadas.map((f) => String(f.created_at)));
  const faltantes = diario.entries.filter((e) => !yaEstan.has(String(e.when)));

  if (faltantes.length === 0) {
    console.log(`[  OK  ] Migraciones`);
    console.log(`          Las ${diario.entries.length} están aplicadas en esta base.\n`);
    return 0;
  }

  console.log(`[ FALTA ] Migraciones`);
  console.log(
    `          Esta base no tiene ${faltantes.length}: ${faltantes.map((f) => f.tag).join(', ')}.`,
  );
  console.log(
    '          Desplegar así deja al POS pidiendo columnas que no existen, y en el' +
      '\n          mostrador eso se ve como una pantalla rota sin explicación.',
  );
  console.log('          → Correr `npm run db:migrate` contra esta base ANTES de desplegar.\n');
  return 1;
}

try {
  faltan += await chequearMigraciones();
} catch (e) {
  console.log(`[AVISO ] Migraciones`);
  console.log(`          No se pudo consultar la base: ${e instanceof Error ? e.message : e}\n`);
}

if (faltan === 0 && avisos === 0) {
  console.log('Todo en orden.\n');
} else {
  console.log(
    `${faltan} sin configurar, ${avisos} con aviso. El detalle de cada paso está en PRODUCCION.md\n`,
  );
}

process.exit(faltan > 0 ? 1 : 0);
