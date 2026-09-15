/**
 * Variables de entorno, validadas al arrancar.
 *
 * Ningun secreto vive en el codigo. Si falta algo, el proceso avisa cual es y
 * no arranca a medias.
 */
import { z } from 'zod';

const esquema = z.object({
  DATABASE_URL: z.string().min(1, 'Falta la cadena de conexion a PostgreSQL'),
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET tiene que tener al menos 16 caracteres'),
  WOO_URL: z.string().url('WOO_URL tiene que ser una URL completa').optional(),
  WOO_CONSUMER_KEY: z.string().optional(),
  WOO_CONSUMER_SECRET: z.string().optional(),
  WOO_WEBHOOK_SECRET: z.string().optional(),
  POS_TERMINAL: z
    .string()
    .regex(/^[A-Z0-9]{1,4}$/, 'POS_TERMINAL tiene que ser corto y en mayusculas, ej. T1')
    .default('T1'),
  /** Opcional: sin esto el alta de productos funciona igual, escrita a mano. */
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODELO: z.string().optional(),
});

export type Config = z.infer<typeof esquema>;

let cache: Config | undefined;

export function config(): Config {
  if (cache) return cache;
  const r = esquema.safeParse(process.env);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuracion invalida. Revisá el archivo .env:\n${detalle}`);
  }
  cache = r.data;
  return cache;
}

/** True si el alta de productos puede pedir ayuda para armar la ficha. */
export function hayAyudaDeFicha(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** True si hay credenciales de WooCommerce cargadas. */
export function hayWoo(): boolean {
  return Boolean(
    process.env.WOO_URL && process.env.WOO_CONSUMER_KEY && process.env.WOO_CONSUMER_SECRET,
  );
}
