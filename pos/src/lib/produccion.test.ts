/**
 * Tests de los chequeos de producción.
 *
 * Son funciones puras sobre un objeto de entorno: se les pasa el `env` a mano y
 * no se toca `process.env`, así los tests no dependen de la máquina donde
 * corren.
 */
import { describe, expect, it } from 'vitest';
import {
  chequearProduccion,
  destinoDeWoo,
  dondeApuntaWoo,
  entornoActual,
  pendientes,
} from './produccion';

/** Un entorno de producción bien configurado, para ir rompiéndolo de a una. */
const PRODUCCION_OK = {
  VERCEL_ENV: 'production',
  WOO_URL: 'https://lucasinnovaciones.com.ar',
  WOO_CONSUMER_KEY: 'ck_loquesea',
  WOO_CONSUMER_SECRET: 'cs_loquesea',
  WOO_WEBHOOK_SECRET: 'otro',
  CRON_SECRET: 'secreto',
} as unknown as NodeJS.ProcessEnv;

function sin(clave: string): NodeJS.ProcessEnv {
  const env = { ...PRODUCCION_OK } as Record<string, string | undefined>;
  delete env[clave];
  return env as NodeJS.ProcessEnv;
}

function chequeo(env: NodeJS.ProcessEnv, clave: string) {
  const c = chequearProduccion(env).find((x) => x.clave === clave);
  expect(c, `no existe el chequeo «${clave}»`).toBeDefined();
  return c!;
}

describe('entorno', () => {
  it('una vista previa de Vercel no es producción, aunque NODE_ENV lo diga', () => {
    const env = { VERCEL_ENV: 'preview', NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv;
    expect(entornoActual(env)).toBe('desarrollo');
  });

  it('sin Vercel manda NODE_ENV', () => {
    expect(entornoActual({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('produccion');
    expect(entornoActual({} as NodeJS.ProcessEnv)).toBe('desarrollo');
  });
});

describe('destino de la tienda', () => {
  it('reconoce el staging de este hosting, que va por ruta', () => {
    expect(destinoDeWoo('https://lucasinnovaciones.com.ar/staging')).toBe('staging');
  });

  it('reconoce las formas por subdominio', () => {
    expect(destinoDeWoo('https://staging.lucasinnovaciones.com.ar')).toBe('staging');
    expect(destinoDeWoo('https://dev.lucasinnovaciones.com.ar')).toBe('staging');
  });

  it('la tienda de verdad es producción', () => {
    expect(destinoDeWoo('https://lucasinnovaciones.com.ar')).toBe('produccion');
  });

  it('un dominio que solo contiene «dev» adentro de una palabra no es staging', () => {
    // «desarrollos» empieza con dev y no por eso es la tienda de pruebas.
    expect(destinoDeWoo('https://desarrollosweb.com.ar')).toBe('produccion');
  });

  it('se lee con la ruta, porque el staging de este hosting va por ruta', () => {
    expect(dondeApuntaWoo('https://lucasinnovaciones.com.ar/staging/')).toBe(
      'lucasinnovaciones.com.ar/staging',
    );
    expect(dondeApuntaWoo('https://lucasinnovaciones.com.ar')).toBe('lucasinnovaciones.com.ar');
  });

  it('una URL inválida no rompe nada', () => {
    expect(destinoDeWoo('no-es-una-url')).toBe('sin_configurar');
    expect(dondeApuntaWoo('no-es-una-url')).toBeNull();
    expect(destinoDeWoo(undefined)).toBe('sin_configurar');
  });
});

describe('producción bien configurada', () => {
  it('no deja nada pendiente', () => {
    expect(pendientes(chequearProduccion(PRODUCCION_OK))).toEqual([]);
  });
});

describe('lo que falta en producción', () => {
  it('sin CRON_SECRET la cola no se vacía sola', () => {
    const c = chequeo(sin('CRON_SECRET'), 'cron');
    expect(c.gravedad).toBe('falta');
    expect(c.arreglo).toContain('Vercel');
  });

  it('apuntarle al staging desde producción es un error, no un aviso', () => {
    const env = { ...PRODUCCION_OK, WOO_URL: 'https://lucasinnovaciones.com.ar/staging' };
    const c = chequeo(env, 'woo_destino');
    expect(c.gravedad).toBe('falta');
    expect(c.detalle).toContain('no se está actualizando');
  });

  it('sin credenciales avisa que las ventas igual se registran', () => {
    const c = chequeo(sin('WOO_CONSUMER_KEY'), 'woo_claves');
    expect(c.gravedad).toBe('falta');
    expect(c.detalle).toContain('las ventas se registran igual');
  });

  it('sin secreto de webhook el espejo deja de refrescarse solo', () => {
    expect(chequeo(sin('WOO_WEBHOOK_SECRET'), 'woo_webhook').gravedad).toBe('falta');
  });
});

describe('en desarrollo', () => {
  const DESARROLLO = {
    WOO_URL: 'https://lucasinnovaciones.com.ar/staging',
    WOO_CONSUMER_KEY: 'ck',
    WOO_CONSUMER_SECRET: 'cs',
    WOO_WEBHOOK_SECRET: 'w',
  } as unknown as NodeJS.ProcessEnv;

  it('que falte CRON_SECRET no molesta: no hay cron corriendo', () => {
    expect(chequeo(DESARROLLO, 'cron').gravedad).toBe('ok');
  });

  it('apuntar al staging es lo correcto', () => {
    expect(chequeo(DESARROLLO, 'woo_destino').gravedad).toBe('ok');
  });

  it('escribirle a la tienda de verdad desde desarrollo se avisa', () => {
    const env = { ...DESARROLLO, WOO_URL: 'https://lucasinnovaciones.com.ar' };
    const c = chequeo(env, 'woo_destino');
    expect(c.gravedad).toBe('aviso');
    expect(c.detalle).toContain('stock real');
    expect(c.arreglo).toContain('rotarla');
  });
});
