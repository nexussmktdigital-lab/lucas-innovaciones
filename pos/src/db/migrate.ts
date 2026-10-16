/**
 * Aplica las migraciones pendientes. Uso: `npm run db:migrate`
 *
 * Desde el despliegue en Vercel corre `migrar-al-desplegar.ts`, que decide si
 * toca o no y después llama a lo mismo que esto.
 */
import 'dotenv/config';
import { aplicarMigraciones } from './aplicar';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL. Copiá .env.example a .env y completala.');
  process.exit(1);
}

try {
  const { descartados } = await aplicarMigraciones(url, './drizzle', (mensaje) =>
    console.log(`  ${mensaje}`),
  );
  if (descartados.length > 0) {
    console.log(
      `Se ignoran parámetros de libpq que el driver de Node no usa: ${descartados.join(', ')}`,
    );
  }
  console.log('Migraciones aplicadas.');
} catch (error) {
  console.error('Fallaron las migraciones:', error);
  process.exitCode = 1;
}
