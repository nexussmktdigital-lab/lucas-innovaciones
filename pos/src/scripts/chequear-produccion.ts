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

const faltan = chequeos.filter((c) => c.gravedad === 'falta').length;
const avisos = chequeos.filter((c) => c.gravedad === 'aviso').length;

if (faltan === 0 && avisos === 0) {
  console.log('Todo en orden.\n');
} else {
  console.log(
    `${faltan} sin configurar, ${avisos} con aviso. El detalle de cada paso está en PRODUCCION.md\n`,
  );
}

process.exit(faltan > 0 ? 1 : 0);
