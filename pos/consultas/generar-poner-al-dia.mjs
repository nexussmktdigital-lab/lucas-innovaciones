/**
 * Genera el SQL que pone al dia el registro de migraciones de produccion.
 *
 * El migrador de Drizzle solo mira el ULTIMO `created_at` de
 * `drizzle.__drizzle_migrations` y lo compara contra el `when` de cada entrada
 * del diario. Si el esquema se arreglo a mano con SQL pero el registro no se
 * escribio, el codigo cree que faltan migraciones que en realidad ya estan.
 *
 * Esto arma un solo archivo, en una transaccion, con las migraciones desde un
 * tag en adelante mas los INSERT que las anotan. Sirve para correrlo desde el
 * SQL Editor de Neon, sin necesidad de tener el repo y Node en la maquina.
 *
 * Se corre desde `pos/`:
 *
 *   node consultas/generar-poner-al-dia.mjs 0019 consultas/poner-al-dia-migraciones.sql
 *
 * El hash es el mismo que calcula Drizzle (sha256 del archivo completo) y el
 * `created_at` es el `when` del diario, asi que despues de correrlo
 * `npm run db:migrate` no encuentra nada pendiente.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const diario = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8'));
const desde = process.argv[2] ?? '0019';
const salida = process.argv[3] ?? 'consultas/poner-al-dia-migraciones.sql';
const entradas = diario.entries.filter((e) => e.tag >= desde);

if (entradas.length === 0) {
  console.error(`No hay migraciones desde ${desde}.`);
  process.exit(1);
}

const partes = [];
partes.push(`-- Pone al dia la base de produccion del POS.
--
-- Aplica las migraciones ${entradas[0].tag} a ${entradas[entradas.length - 1].tag} y las anota en el
-- registro de migraciones (drizzle.__drizzle_migrations), que es lo que quedo
-- atrasado: el esquema se fue arreglando a mano con SQL y el registro nunca se
-- escribio, asi que el POS cree que faltan migraciones.
--
-- Todo el script corre en UNA transaccion: si algo falla, no queda nada a medio
-- aplicar. Cada migracion es idempotente (IF NOT EXISTS / DROP CONSTRAINT IF
-- EXISTS), asi que lo que ya esta hecho se saltea solo.
--
-- Generado con consultas/generar-poner-al-dia.mjs. No editar a mano.

BEGIN;

CREATE SCHEMA IF NOT EXISTS "drizzle";

CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
`);

for (const e of entradas) {
  const texto = fs.readFileSync(`drizzle/${e.tag}.sql`, 'utf8');
  const hash = crypto.createHash('sha256').update(texto).digest('hex');
  partes.push(`
-- ===========================================================================
-- ${e.tag}
-- ===========================================================================
`);
  partes.push(texto.split('--> statement-breakpoint').join('\n'));
  partes.push(`
-- Anota ${e.tag} como aplicada.
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT '${hash}', ${e.when}
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE created_at = ${e.when}
);
`);
}

partes.push(`
COMMIT;

-- Control: tiene que decir ${entradas[entradas.length - 1].when} o mas.
SELECT max(created_at) AS ultima_migracion_registrada,
       count(*)       AS migraciones_registradas
FROM "drizzle"."__drizzle_migrations";
`);

fs.writeFileSync(salida, partes.join('\n'));
console.log(`listo: ${salida} (${entradas.length} migraciones)`);
