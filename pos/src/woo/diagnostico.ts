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

const raiz = z
  .object({
    namespaces: z.array(z.string()).optional(),
    url: z.string().optional(),
    home: z.string().optional(),
  })
  .loose();

async function pedir(
  hacer: typeof fetch,
  url: string,
  timeoutMs: number,
  cabeceras: Record<string, string> = {},
  cuerpoCompleto = false,
): Promise<{ estado: number; cuerpo: string } | { error: string }> {
  const ac = new AbortController();
  const reloj = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await hacer(url, { headers: { Accept: 'application/json', ...cabeceras }, signal: ac.signal });
    const texto = await r.text();
    return { estado: r.status, cuerpo: cuerpoCompleto ? texto : texto.slice(0, 400) };
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
  const wp = await pedir(hacer, base + '/wp-json/', timeout, {}, true);
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
  let siteurl: string | undefined;
  let home: string | undefined;
  if (wp.estado === 200) {
    try {
      const datos = raiz.parse(JSON.parse(wp.cuerpo));
      tieneWc = (datos.namespaces ?? []).some((n) => n.startsWith('wc/'));
      siteurl = datos.url;
      home = datos.home;
    } catch {
      tieneWc = wp.cuerpo.includes('wc/v3');
    }
  }
  pruebas.push({
    nombre: 'API REST de WordPress',
    resultado: wp.estado === 200 ? 'ok' : 'falla',
    detalle: `HTTP ${wp.estado}${tieneWc ? ' · expone wc/v3' : ' · NO expone wc/v3'}`,
    arreglo: wp.estado === 200 ? undefined : 'La API REST está deshabilitada o bloqueada.',
  });

  // WooCommerce solo acepta clave y secreto en claro cuando detecta SSL. Si
  // WordPress tiene siteurl en http://, exige peticiones firmadas con OAuth 1.0a
  // e ignora la credencial, con lo que todo llega como anónimo.
  if (siteurl || home) {
    const enHttp = [siteurl, home].filter((u) => u?.startsWith('http://'));
    pruebas.push({
      nombre: 'WordPress se sabe en HTTPS',
      resultado: enHttp.length === 0 ? 'ok' : 'falla',
      detalle: `siteurl ${siteurl ?? '?'} · home ${home ?? '?'}`,
      arreglo:
        enHttp.length === 0
          ? undefined
          : 'Están en http:// y por eso WooCommerce exige OAuth 1.0a e ignora la clave. ' +
            'Hay que pasarlas a https:// en Ajustes > Generales de WordPress.',
    });
  }

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

  // Prueba decisiva: si una clave inventada da el MISMO error que la real,
  // WooCommerce no está evaluando ninguna de las dos. El problema no es la
  // credencial: es que la autenticación por clave no se está ejecutando.
  if (!cabeceraOk && !queryOk) {
    const inventada =
      `${base}${recurso}&consumer_key=ck_esta_clave_no_existe&consumer_secret=cs_tampoco`;
    const conInventada = await pedir(hacer, inventada, timeout);
    const mismoError =
      !('error' in conInventada) &&
      !('error' in porQuery) &&
      conInventada.estado === porQuery.estado &&
      codigoDe(conInventada.cuerpo) === codigoDe(porQuery.cuerpo);

    pruebas.push({
      nombre: 'La clave se está evaluando',
      resultado: mismoError ? 'falla' : 'ok',
      detalle: mismoError
        ? 'Una clave inventada da exactamente el mismo error que la tuya: WooCommerce ' +
          'no está evaluando ninguna. Tu clave probablemente esté bien.'
        : `Una clave inventada da otro error (${'error' in conInventada ? conInventada.error : explicar(conInventada)}), ` +
          'así que la tuya sí se evalúa y el problema es de permisos.',
      arreglo: mismoError
        ? 'Revisá siteurl/home en https:// (arriba). Si ya están bien, puede haber un ' +
          'plugin de seguridad bloqueando la autenticación de la API.'
        : 'Revisá que la clave tenga permiso de Lectura/Escritura y que su usuario sea administrador.',
    });
  }

  return pruebas;
}

/** Extrae el campo `code` de una respuesta de error de la API. */
function codigoDe(cuerpo: string): string {
  try {
    return String((JSON.parse(cuerpo) as { code?: unknown }).code ?? '');
  } catch {
    return '';
  }
}

/** Traduce el código de error de WooCommerce a la causa concreta. */
function explicar(r: { estado: number; cuerpo: string }): string {
  if (r.estado === 200) return 'HTTP 200 · autentica';

  const codigo = codigoDe(r.cuerpo);

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
