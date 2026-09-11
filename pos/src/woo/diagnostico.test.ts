import { describe, expect, it } from 'vitest';
import { diagnosticar } from './diagnostico';

const BASE = 'https://ejemplo.test/staging';

/** Simula el sitio: cada ruta responde lo que le indiquemos. */
function sitio(respuestas: Record<string, { estado: number; cuerpo: string }>): typeof fetch {
  return (async (entrada: string | URL) => {
    const url = new URL(String(entrada));
    const clave = url.searchParams.has('consumer_key')
      ? 'productos-query'
      : url.pathname.endsWith('/wp-json/')
        ? 'wp-json'
        : url.pathname.includes('/products')
          ? 'productos-cabecera'
          : 'raiz';
    const r = respuestas[clave] ?? { estado: 404, cuerpo: '' };
    return new Response(r.cuerpo, { status: r.estado });
  }) as unknown as typeof fetch;
}

const opciones = (fetchImpl: typeof fetch) => ({
  url: BASE,
  consumerKey: 'ck_prueba',
  consumerSecret: 'cs_prueba',
  fetchImpl,
  timeoutMs: 1000,
});

const WP_JSON_OK = { estado: 200, cuerpo: JSON.stringify({ namespaces: ['wp/v2', 'wc/v3'] }) };
const RAIZ_OK = { estado: 200, cuerpo: '<html></html>' };

describe('diagnosticar', () => {
  it('cuando todo anda, marca los cuatro eslabones en ok', async () => {
    const r = await diagnosticar(
      opciones(
        sitio({
          raiz: RAIZ_OK,
          'wp-json': WP_JSON_OK,
          'productos-cabecera': { estado: 200, cuerpo: '[]' },
          'productos-query': { estado: 200, cuerpo: '[]' },
        }),
      ),
    );
    expect(r.every((p) => p.resultado === 'ok')).toBe(true);
  });

  it('detecta que el hosting descarta la cabecera y propone el arreglo', async () => {
    const r = await diagnosticar(
      opciones(
        sitio({
          raiz: RAIZ_OK,
          'wp-json': WP_JSON_OK,
          'productos-cabecera': {
            estado: 401,
            cuerpo: '{"code":"woocommerce_rest_cannot_view","message":"Lo siento"}',
          },
          'productos-query': { estado: 200, cuerpo: '[]' },
        }),
      ),
    );

    const cabecera = r.find((p) => p.nombre.includes('cabecera'))!;
    const query = r.find((p) => p.nombre.includes('query'))!;

    expect(cabecera.resultado).toBe('falla');
    expect(cabecera.detalle).toContain('SIN credenciales');
    expect(query.resultado).toBe('ok');
    expect(query.arreglo).toContain('WOO_AUTH_QUERY');
  });

  it('distingue una clave invalida de una cabecera descartada', async () => {
    const invalida = {
      estado: 401,
      cuerpo: '{"code":"woocommerce_rest_authentication_error","message":"Consumer key is invalid"}',
    };
    const r = await diagnosticar(
      opciones(
        sitio({
          raiz: RAIZ_OK,
          'wp-json': WP_JSON_OK,
          'productos-cabecera': invalida,
          'productos-query': invalida,
        }),
      ),
    );

    const cabecera = r.find((p) => p.nombre.includes('cabecera'))!;
    expect(cabecera.detalle).toContain('inválida o no existe');
    // Ninguno de los dos caminos anda: no tiene sentido proponer el query string.
    expect(r.find((p) => p.nombre.includes('query'))!.arreglo).toBeUndefined();
  });

  it('reconoce la proteccion con contraseña del directorio y corta ahi', async () => {
    const r = await diagnosticar(
      opciones(
        sitio({
          raiz: RAIZ_OK,
          'wp-json': { estado: 401, cuerpo: '<html><title>401 Unauthorized</title></html>' },
        }),
      ),
    );
    const wp = r.find((p) => p.nombre.includes('WordPress'))!;
    expect(wp.resultado).toBe('falla');
    expect(wp.detalle).toContain('contraseña del directorio');
    expect(wp.arreglo).toContain('/wp-json/');
    // No sigue probando credenciales: no tendría sentido.
    expect(r).toHaveLength(2);
  });

  it('avisa cuando WooCommerce no esta activo', async () => {
    const r = await diagnosticar(
      opciones(
        sitio({
          raiz: RAIZ_OK,
          'wp-json': WP_JSON_OK,
          'productos-cabecera': { estado: 404, cuerpo: '{"code":"rest_no_route"}' },
          'productos-query': { estado: 404, cuerpo: '{"code":"rest_no_route"}' },
        }),
      ),
    );
    expect(r.find((p) => p.nombre.includes('cabecera'))!.detalle).toContain(
      'WooCommerce no está activo',
    );
  });

  it('si el sitio no responde, no sigue probando lo demas', async () => {
    const caida = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;
    const r = await diagnosticar(opciones(caida));
    expect(r).toHaveLength(1);
    expect(r[0]!.resultado).toBe('falla');
  });
});
