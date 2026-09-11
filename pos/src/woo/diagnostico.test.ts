import { describe, expect, it } from 'vitest';
import { diagnosticar } from './diagnostico';

const BASE = 'https://ejemplo.test/staging';

/** Simula el sitio: cada ruta responde lo que le indiquemos. */
function sitio(respuestas: Record<string, { estado: number; cuerpo: string }>): typeof fetch {
  return (async (entrada: string | URL) => {
    const url = new URL(String(entrada));
    const ck = url.searchParams.get('consumer_key');
    const clave = ck
      ? ck.startsWith('ck_esta_clave_no_existe')
        ? 'productos-inventada'
        : 'productos-query'
      : url.pathname.endsWith('/wp-json/')
        ? 'wp-json'
        : url.pathname.includes('/products')
          ? 'productos-cabecera'
          : 'raiz';
    const r = respuestas[clave] ?? respuestas['productos-query'] ?? { estado: 404, cuerpo: '' };
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

const WP_JSON_OK = {
  estado: 200,
  cuerpo: JSON.stringify({
    namespaces: ['wp/v2', 'wc/v3'],
    url: 'https://ejemplo.test/staging',
    home: 'https://ejemplo.test/staging',
  }),
};

/** Como responde WordPress cuando siteurl quedó en http:// (el caso de este sitio). */
const WP_JSON_EN_HTTP = {
  estado: 200,
  cuerpo: JSON.stringify({
    namespaces: ['wp/v2', 'wc/v3'],
    url: 'http://ejemplo.test/staging',
    home: 'http://ejemplo.test/staging',
  }),
};

const SIN_CREDENCIALES = {
  estado: 401,
  cuerpo: '{"code":"woocommerce_rest_cannot_view","message":"Lo siento, no puedes listar recursos."}',
};
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
          'productos-cabecera': SIN_CREDENCIALES,
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

  it('detecta siteurl en http y lo reporta como contenido mixto, no como falla de la API', async () => {
    const r = await diagnosticar(
      opciones(
        sitio({
          raiz: RAIZ_OK,
          'wp-json': WP_JSON_EN_HTTP,
          'productos-cabecera': SIN_CREDENCIALES,
          'productos-query': SIN_CREDENCIALES,
          'productos-inventada': SIN_CREDENCIALES,
        }),
      ),
    );

    const esquema = r.find((p) => p.nombre.includes('siteurl'))!;
    expect(esquema.resultado).toBe('falla');
    expect(esquema.arreglo).toContain('contenido mixto');
    // No debe atribuirle la falla de autenticación: se verificó contra el sitio
    // real que la API autentica con siteurl en http://.
    expect(esquema.arreglo).toContain('No afecta a esta API');

    const existe = r.find((p) => p.nombre.includes('existe en este sitio'))!;
    expect(existe.resultado).toBe('falla');
  });

  it('ante una clave desconocida, propone probar contra el otro sitio', async () => {
    const r = await diagnosticar(
      opciones(
        sitio({
          raiz: RAIZ_OK,
          'wp-json': WP_JSON_OK,
          'productos-cabecera': SIN_CREDENCIALES,
          'productos-query': SIN_CREDENCIALES,
          'productos-inventada': SIN_CREDENCIALES,
        }),
      ),
    );
    const existe = r.find((p) => p.nombre.includes('existe en este sitio'))!;
    expect(existe.resultado).toBe('falla');
    expect(existe.detalle).toContain('las dos son desconocidas');
    // El sitio de prueba es .../staging, así que sugiere la raíz.
    expect(existe.arreglo).toContain('WOO_URL="https://ejemplo.test"');
  });

  it('cuando la clave si se evalua, apunta a los permisos y no al sitio', async () => {
    const r = await diagnosticar(
      opciones(
        sitio({
          raiz: RAIZ_OK,
          'wp-json': WP_JSON_OK,
          'productos-cabecera': SIN_CREDENCIALES,
          'productos-query': SIN_CREDENCIALES,
          'productos-inventada': {
            estado: 401,
            cuerpo: '{"code":"woocommerce_rest_authentication_error"}',
          },
        }),
      ),
    );
    const existe = r.find((p) => p.nombre.includes('existe en este sitio'))!;
    expect(existe.resultado).toBe('ok');
    expect(existe.arreglo).toContain('Lectura/Escritura');
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
