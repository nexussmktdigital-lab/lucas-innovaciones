/**
 * Cliente de la REST API v3 de WooCommerce.
 *
 * Notas de este hosting en particular:
 *  - LiteSpeed en hosting compartido a veces descarta el header Authorization.
 *    Por eso se puede pasar la credencial por query string (WOO_AUTH_QUERY=true),
 *    que es un metodo oficial de Woo sobre HTTPS.
 *  - `max_execution_time` es de 30 s, asi que se pagina de a 100 y nunca se
 *    pide todo el catalogo en una sola llamada.
 */
import { z } from 'zod';

export class ErrorWoo extends Error {
  constructor(
    message: string,
    readonly estado?: number,
    readonly cuerpo?: string,
  ) {
    super(message);
    this.name = 'ErrorWoo';
  }
}

export interface OpcionesWoo {
  url: string;
  consumerKey: string;
  consumerSecret: string;
  /** Credencial por query string en vez de header Authorization. */
  porQueryString?: boolean;
  timeoutMs?: number;
  reintentos?: number;
  fetchImpl?: typeof fetch;
}

export interface Pagina<T> {
  datos: T[];
  totalPaginas: number;
  total: number;
}

const TIMEOUT_POR_DEFECTO = 20_000;
const REINTENTOS_POR_DEFECTO = 3;

export class ClienteWoo {
  private readonly base: string;

  constructor(private readonly opciones: OpcionesWoo) {
    this.base = opciones.url.replace(/\/+$/, '');
  }

  static desdeEntorno(env: NodeJS.ProcessEnv = process.env): ClienteWoo {
    const url = env.WOO_URL;
    const consumerKey = env.WOO_CONSUMER_KEY;
    const consumerSecret = env.WOO_CONSUMER_SECRET;
    if (!url || !consumerKey || !consumerSecret) {
      throw new ErrorWoo(
        'Faltan WOO_URL, WOO_CONSUMER_KEY o WOO_CONSUMER_SECRET. Ver .env.example',
      );
    }
    return new ClienteWoo({
      url,
      consumerKey,
      consumerSecret,
      porQueryString: env.WOO_AUTH_QUERY === 'true',
    });
  }

  /**
   * Arma la URL de un recurso.
   * `ruta` relativa apunta a `wc/v3`; una que empiece con otro namespace
   * (ej. `li-cotizacion/v1/actual`) se resuelve directo bajo `wp-json`.
   */
  private construirUrl(ruta: string, params: Record<string, string | number> = {}): URL {
    const limpia = ruta.replace(/^\/+/, '');
    const namespace = /^[a-z0-9-]+\/v\d+\//i.test(limpia) ? '' : 'wc/v3/';
    const url = new URL(`${this.base}/wp-json/${namespace}${limpia}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    if (this.opciones.porQueryString) {
      url.searchParams.set('consumer_key', this.opciones.consumerKey);
      url.searchParams.set('consumer_secret', this.opciones.consumerSecret);
    }
    return url;
  }

  private cabeceras(conCuerpo: boolean): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (conCuerpo) h['Content-Type'] = 'application/json';
    if (!this.opciones.porQueryString) {
      const credencial = Buffer.from(
        `${this.opciones.consumerKey}:${this.opciones.consumerSecret}`,
      ).toString('base64');
      h['Authorization'] = `Basic ${credencial}`;
    }
    return h;
  }

  /** Hace la peticion con reintentos y espera creciente ante fallos pasajeros. */
  private async pedir(
    metodo: string,
    ruta: string,
    params: Record<string, string | number> = {},
    cuerpo?: unknown,
  ): Promise<Response> {
    const hacer = this.opciones.fetchImpl ?? fetch;
    const url = this.construirUrl(ruta, params);
    const reintentos = this.opciones.reintentos ?? REINTENTOS_POR_DEFECTO;
    const timeout = this.opciones.timeoutMs ?? TIMEOUT_POR_DEFECTO;

    let ultimoError: unknown;
    for (let intento = 0; intento < reintentos; intento += 1) {
      if (intento > 0) {
        await new Promise((r) => setTimeout(r, 2 ** intento * 1000));
      }
      try {
        const ac = new AbortController();
        const reloj = setTimeout(() => ac.abort(), timeout);
        try {
          const respuesta = await hacer(url, {
            method: metodo,
            headers: this.cabeceras(cuerpo !== undefined),
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
            signal: ac.signal,
          });

          // 4xx no se reintenta: la peticion esta mal, insistir no la arregla.
          if (respuesta.status >= 400 && respuesta.status < 500) {
            const texto = await respuesta.text();
            throw new ErrorWoo(
              `WooCommerce respondio ${respuesta.status} en ${metodo} ${ruta}`,
              respuesta.status,
              texto.slice(0, 500),
            );
          }
          if (!respuesta.ok) {
            const texto = await respuesta.text();
            ultimoError = new ErrorWoo(
              `WooCommerce respondio ${respuesta.status} en ${metodo} ${ruta}`,
              respuesta.status,
              texto.slice(0, 500),
            );
            continue;
          }
          return respuesta;
        } finally {
          clearTimeout(reloj);
        }
      } catch (e) {
        if (e instanceof ErrorWoo && e.estado && e.estado < 500) throw e;
        ultimoError = e;
      }
    }
    throw ultimoError instanceof Error
      ? ultimoError
      : new ErrorWoo(`No se pudo contactar a WooCommerce en ${metodo} ${ruta}`);
  }

  /** GET de una pagina, devolviendo tambien el total de paginas del header. */
  async listar<T>(
    ruta: string,
    esquema: z.ZodType<T>,
    params: Record<string, string | number> = {},
  ): Promise<Pagina<T>> {
    const respuesta = await this.pedir('GET', ruta, params);
    const crudo: unknown = await respuesta.json();
    if (!Array.isArray(crudo)) {
      throw new ErrorWoo(`Se esperaba una lista en ${ruta} y llego otra cosa`);
    }
    const datos: T[] = [];
    for (const fila of crudo) {
      const r = esquema.safeParse(fila);
      if (r.success) datos.push(r.data);
      else {
        const id = (fila as { id?: unknown })?.id;
        console.warn(`[woo] Ficha ${String(id)} descartada: ${r.error.issues[0]?.message}`);
      }
    }
    return {
      datos,
      totalPaginas: Number(respuesta.headers.get('x-wp-totalpages') ?? 1),
      total: Number(respuesta.headers.get('x-wp-total') ?? datos.length),
    };
  }

  /** Recorre todas las paginas de un recurso. */
  async *listarTodo<T>(
    ruta: string,
    esquema: z.ZodType<T>,
    params: Record<string, string | number> = {},
    porPagina = 100,
  ): AsyncGenerator<T[], void, void> {
    let pagina = 1;
    let totalPaginas = 1;
    do {
      const r = await this.listar(ruta, esquema, { ...params, per_page: porPagina, page: pagina });
      totalPaginas = r.totalPaginas;
      yield r.datos;
      pagina += 1;
    } while (pagina <= totalPaginas);
  }

  async obtener<T>(ruta: string, esquema: z.ZodType<T>): Promise<T> {
    const respuesta = await this.pedir('GET', ruta);
    return esquema.parse(await respuesta.json());
  }

  async enviar<T>(
    metodo: 'POST' | 'PUT',
    ruta: string,
    cuerpo: unknown,
    esquema: z.ZodType<T>,
  ): Promise<T> {
    const respuesta = await this.pedir(metodo, ruta, {}, cuerpo);
    return esquema.parse(await respuesta.json());
  }

  /** Comprueba credenciales y conectividad sin traer datos pesados. */
  async verificar(): Promise<{ ok: true; productos: number }> {
    const r = await this.listar('products', z.unknown(), { per_page: 1 });
    return { ok: true, productos: r.total };
  }
}
