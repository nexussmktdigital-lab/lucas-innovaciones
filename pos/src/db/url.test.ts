import { describe, expect, it } from 'vitest';
import { normalizarUrlDeConexion, urlDeConexion } from './url';

describe('normalizarUrlDeConexion', () => {
  it('quita channel_binding, que es lo que agrega Neon y el driver de Node no entiende', () => {
    const r = normalizarUrlDeConexion(
      'postgresql://u:p@ep-algo-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    );
    expect(r.url).toBe(
      'postgresql://u:p@ep-algo-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require',
    );
    expect(r.descartados).toEqual(['channel_binding']);
  });

  it('conserva sslmode, que el driver si usa', () => {
    expect(urlDeConexion('postgresql://u:p@host/base?sslmode=require')).toContain(
      'sslmode=require',
    );
  });

  it('no toca una cadena que ya esta limpia', () => {
    const limpia = 'postgresql://postgres@127.0.0.1:5432/lucas_pos';
    expect(urlDeConexion(limpia)).toBe(limpia);
  });

  it('conserva usuario y contraseña con caracteres especiales', () => {
    const r = urlDeConexion('postgresql://user:p%40ss%2Fword@host/base?channel_binding=require');
    expect(r).toContain('user:p%40ss%2Fword@host');
    expect(r).not.toContain('channel_binding');
  });

  it('quita varios parametros de libpq de una vez', () => {
    const r = normalizarUrlDeConexion(
      'postgresql://u:p@host/base?sslmode=require&channel_binding=require&gssencmode=disable',
    );
    expect(r.descartados.sort()).toEqual(['channel_binding', 'gssencmode']);
    expect(r.url).not.toContain('gssencmode');
  });

  it('devuelve tal cual algo que no parsea, para no tapar el error real del driver', () => {
    expect(urlDeConexion('esto no es una url')).toBe('esto no es una url');
  });
});
