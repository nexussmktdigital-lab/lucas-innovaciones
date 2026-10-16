/**
 * Qué construcción migra la base y cuál no.
 *
 * Es una decisión con dos lados caros. Migrar desde una vista previa toca la
 * base del local sin que nadie lo pida —es la razón por la que esto no corría
 * solo—. No migrar en producción devuelve el problema que esto vino a
 * resolver: código desplegado contra un esquema que no está, y el mostrador
 * sin poder cobrar.
 */
import { describe, expect, it } from 'vitest';
import { decidir } from './migrar-al-desplegar';

const PRODUCCION = {
  VERCEL: '1',
  VERCEL_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@host/db',
};

describe('decidir si esta construcción migra', () => {
  it('la de producción migra, con la cadena de producción', () => {
    const d = decidir(PRODUCCION);
    expect(d.migra).toBe(true);
    expect(d).toMatchObject({ url: 'postgresql://u:p@host/db' });
  });

  /*
   * El caso que hizo que esto no existiera hasta ahora: las vistas previas
   * comparten las variables de entorno con producción, así que sin esta guarda
   * cada rama que alguien despliegue migraría la base del local.
   */
  it('una vista previa no toca la base, aunque tenga la cadena', () => {
    const d = decidir({ ...PRODUCCION, VERCEL_ENV: 'preview' });
    expect(d.migra).toBe(false);
    expect(d).toMatchObject({ motivo: expect.stringContaining('preview') });
  });

  it('el entorno de desarrollo de Vercel tampoco', () => {
    expect(decidir({ ...PRODUCCION, VERCEL_ENV: 'development' }).migra).toBe(false);
  });

  it('una construcción local no migra nada', () => {
    // `npm run build` en una máquina cualquiera, o en CI: ni se intenta.
    const d = decidir({ DATABASE_URL: 'postgresql://u:p@host/db' });
    expect(d.migra).toBe(false);
    expect(d).toMatchObject({ motivo: expect.stringContaining('Vercel') });
  });

  /*
   * Saltear en silencio sería volver al problema: una construcción que pasa,
   * un despliegue que sale, y el esquema atrás. Falla la construcción, y
   * Vercel deja en pie el despliegue anterior, que funciona.
   */
  it('en producción sin cadena falla, no saltea', () => {
    const d = decidir({ VERCEL: '1', VERCEL_ENV: 'production' });
    expect(d.migra).toBe(false);
    expect(d).toMatchObject({ error: expect.stringContaining('DATABASE_URL') });
    expect(d).not.toHaveProperty('motivo');
  });

  it('una cadena aparte para migrar le gana a la de la aplicación', () => {
    // Sirve para apuntar las migraciones a la conexión directa de Neon y dejar
    // la del pooler para la aplicación, sin tocar una ni otra.
    const d = decidir({ ...PRODUCCION, DATABASE_URL_MIGRACIONES: 'postgresql://u:p@directa/db' });
    expect(d).toMatchObject({ migra: true, url: 'postgresql://u:p@directa/db' });
  });

  it('se puede saltear a mano, y lo dice', () => {
    // La salida de emergencia: desplegar sin migrar cuando hace falta.
    const d = decidir({ ...PRODUCCION, SALTAR_MIGRACION_AL_DESPLEGAR: '1' });
    expect(d.migra).toBe(false);
    expect(d).toMatchObject({ motivo: expect.stringContaining('a mano') });
  });

  it('el salteo a mano es exactamente «1», no cualquier cosa', () => {
    // Una variable puesta en «false» o en «0» no puede apagar la guarda sin
    // querer: ahí el despliegue tiene que migrar igual.
    for (const valor of ['0', 'false', 'no', '']) {
      expect(decidir({ ...PRODUCCION, SALTAR_MIGRACION_AL_DESPLEGAR: valor }).migra, valor).toBe(
        true,
      );
    }
  });
});
