/**
 * Diagnostico de la conexion con WooCommerce.
 *
 * El 401 de la API puede venir de cuatro lugares distintos y el mensaje solo no
 * alcanza para distinguirlos. Esto prueba cada eslabon por separado y dice cual
 * falla:
 *
 *  1. El sitio responde.
 *  2. La API REST de WordPress esta habilitada.
 *  3. WooCommerce expone su namespace `wc/v3`.
 *  4. La credencial autentica — por cabecera `Authorization` o, si el hosting la
 *     descarta, por query string.
 */
import { z } from 'zod';

export type Resultado = 'ok' | 'falla' | 'omitido';

export interface Prueba {
  nombre: string;
  resultado: Resultado;
  detalle: string;
  /** Qué hacer si falló. */
  arreglo?: string;
}

export interface OpcionesDiagnostico {
  url: string;
  consumerKey: string;
  consumerSecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const raiz = z.object({ namespaces: z.array(z.string()).optional() }).loose();

async function pedir(
  hacer: typeof fetch,
  url: string,
  timeoutMs: number,
  cabeceras: Record<string, string> = {},
): Promise<{ estado: number; cuerpo: string } | { error: string }> {
  const ac = new AbortController();
  const reloj = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await hacer(url, { headers: { Accept: 'application/json', ...cabeceras }, signal: ac.signal });
    return { estado: r.status, cuerpo: (await r.text()).slice(0, 400) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(reloj);
  }
}

/** True si el cuerpo es el HTML de una protección de directorio y no una respuesta de la API. */
function pareceProteccionDeDirectorio(estado: number, cuerpo: string): boolean {
  return estado === 401 && !cuerpo.trimStart().startsWith('{');
}

export async function diagnosticar(o: OpcionesDiagnostico): Promise<Prueba[]> {
  const hacer = o.fetchImpl ?? fetch;
  const timeout = o.timeoutMs ?? 20_000;
  const base = o.url.replace(/\/+$/, '');
  const pruebas: Prueba[] = [];

  // 1. El sitio responde.
  const sitio = await pedir(hacer, base + '/', timeout);
  if ('error' in sitio) {
    pruebas.push({
      nombre: 'El sitio responde',
      resultado: 'falla',
      detalle: sitio.error,
      arreglo: 'Revisá que WOO_URL esté bien escrita y que tengas internet.',
    });
    return pruebas;
  }
  pruebas.push({
    nombre: 'El sitio responde',
    resultado: sitio.estado < 500 ? 'ok' : 'falla',
    detalle: `HTTP ${sitio.estado}`,
  });

  // 2. La API REST de WordPress.
  const wp = await pedir(hacer, base + '/wp-json/', timeout);
  if ('error' in wp) {
    pruebas.push({ nombre: 'API REST de WordPress', resultado: 'falla', detalle: wp.error });
    return pruebas;
  }
  if (pareceProteccionDeDirectorio(wp.estado, wp.cuerpo)) {
    pruebas.push({
      nombre: 'API REST de WordPress',
      resultado: 'falla',
      detalle: 'HTTP 401 con cuerpo HTML: es la protección con contraseña del directorio.',
      arreglo:
        'Sacá la protección de directorio del staging, o dejá /wp-json/ fuera de ella.',
    });
    return pruebas;
  }

  let tieneWc = false;
  if (wp.estado === 200) {
    try {
      tieneWc = (raiz.parse(JSON.parse(wp.cuerpo)).namespaces ?? []).some((n) =>
        n.startsWith('wc/'),
      );
    } catch {
      // El cuerpo viene recortado a 400 caracteres: no poder parsearlo no
      // significa que la API esté mal.
      tieneWc = wp.cuerpo.includes('wc/v3');
    }
  }
  pruebas.push({
    nombre: 'API REST de WordPress',
    resultado: wp.estado === 200 ? 'ok' : 'falla',
    detalle: `HTTP ${wp.estado}${tieneWc ? ' · expone wc/v3' : ''}`,
    arreglo: wp.estado === 200 ? undefined : 'La API REST está deshabilitada o bloqueada.',
  });

  // 3 y 4. Autenticación, por los dos caminos.
  const recurso = '/wp-json/wc/v3/products?per_page=1';
  const credencial = Buffer.from(`${o.consumerKey}:${o.consumerSecret}`).toString('base64');

  const porCabecera = await pedir(hacer, base + recurso, timeout, {
    Authorization: `Basic ${credencial}`,
  });
  const conQuery =
    `${base}${recurso}` +
    `&consumer_key=${encodeURIComponent(o.consumerKey)}` +
    `&consumer_secret=${encodeURIComponent(o.consumerSecret)}`;
  const porQuery = await pedir(hacer, conQuery, timeout);

  const cabeceraOk = !('error' in porCabecera) && porCabecera.estado === 200;
  const queryOk = !('error' in porQuery) && porQuery.estado === 200;

  pruebas.push({
    nombre: 'Credencial por cabecera Authorization',
    resultado: cabeceraOk ? 'ok' : 'falla',
    detalle: 'error' in porCabecera ? porCabecera.error : explicar(porCabecera),
  });

  pruebas.push({
    nombre: 'Credencial por query string',
    resultado: queryOk ? 'ok' : 'falla',
    detalle: 'error' in porQuery ? porQuery.error : explicar(porQuery),
    arreglo:
      !cabeceraOk && queryOk
        ? 'Agregá WOO_AUTH_QUERY="true" al archivo .env: el hosting descarta la cabecera.'
        : undefined,
  });

  return pruebas;
}

/** Traduce el código de error de WooCommerce a la causa concreta. */
function explicar(r: { estado: number; cuerpo: string }): string {
  if (r.estado === 200) return 'HTTP 200 · autentica';

  let codigo = '';
  try {
    codigo = String((JSON.parse(r.cuerpo) as { code?: unknown }).code ?? '');
  } catch {
    /* cuerpo no JSON */
  }

  const causas: Record<string, string> = {
    woocommerce_rest_cannot_view:
      'la petición llegó SIN credenciales — el servidor descartó la autenticación',
    woocommerce_rest_authentication_error: 'la clave es inválida o no existe en este sitio',
    woocommerce_rest_cannot_batch: 'la clave no tiene permiso de escritura',
    rest_no_route: 'WooCommerce no está activo en este sitio',
    rest_disabled: 'la API REST está deshabilitada',
  };

  const causa = causas[codigo];
  return `HTTP ${r.estado}${codigo ? ` · ${codigo}` : ''}${causa ? ` — ${causa}` : ''}`;
}
