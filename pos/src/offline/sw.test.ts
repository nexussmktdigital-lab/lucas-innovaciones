/**
 * El service worker, contra su propio archivo.
 *
 * `public/sw.js` no se importa desde la aplicación —lo levanta el navegador—,
 * así que acá se lo corre en un contexto falso con `self`, `caches` y `fetch` de
 * mentira. Es la única forma de probar lo que decide cuando la red tarda, y eso
 * importa porque es la pieza que le dice al mostrador «no hay internet».
 *
 * Lo que se prueba es la decisión, no el navegador: qué devuelve el worker en
 * cada combinación de red y copia guardada.
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FUENTE = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const ORIGEN = 'https://pos.lucasinnovaciones.com.ar';

/** Un pedido de navegación, que es el caso que el worker atiende. */
function navegacionA(ruta: string) {
  return { method: 'GET', url: `${ORIGEN}${ruta}`, mode: 'navigate' };
}

interface Mundo {
  /** Dispara el listener de `fetch` y devuelve lo que el worker respondió. */
  pedir(pedido: object): Promise<Response>;
  /** Lo que `caches.match` va a encontrar. `null` es «nunca se abrió». */
  guardado: Response | null;
  /** Lo que resuelve o rechaza el `fetch` del worker. */
  resolverRed(respuesta: Response): void;
  rechazarRed(): void;
  /** Cuántas veces el worker fue a la red por este pedido. */
  pedidosALaRed: number;
  /** Lo que el worker dejó guardado, por URL. */
  puestos: string[];
}

/**
 * Levanta `sw.js` en un contexto aislado.
 *
 * El archivo registra sus listeners al evaluarse, así que se los captura y se
 * los invoca a mano.
 */
function levantarWorker(): Mundo {
  const listeners = new Map<string, (evento: unknown) => void>();
  const puestos: string[] = [];
  let resolver!: (r: Response) => void;
  let rechazar!: () => void;
  const mundo = {
    guardado: null as Response | null,
    pedidosALaRed: 0,
    puestos,
  };

  const red = new Promise<Response>((res, rej) => {
    resolver = res;
    rechazar = () => rej(new Error('sin red'));
  });
  // Si nadie la resuelve, que no quede una promesa colgada quejándose.
  red.catch(() => {});

  const self_ = {
    addEventListener: (nombre: string, fn: (evento: unknown) => void) => {
      listeners.set(nombre, fn);
    },
    location: { origin: ORIGEN },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };

  const caches_ = {
    keys: () => Promise.resolve([] as string[]),
    delete: () => Promise.resolve(true),
    open: () =>
      Promise.resolve({
        put: (pedido: { url: string }) => {
          puestos.push(pedido.url);
          return Promise.resolve();
        },
      }),
    match: () => Promise.resolve(mundo.guardado ?? undefined),
  };

  const contexto = createContext({
    self: self_,
    caches: caches_,
    fetch: () => {
      mundo.pedidosALaRed += 1;
      return red;
    },
    URL,
    Response,
    Promise,
    setTimeout,
    clearTimeout,
    Error,
  });

  runInContext(FUENTE, contexto);

  const alFetch = listeners.get('fetch');
  if (!alFetch) throw new Error('sw.js no registró un listener de fetch');

  return {
    ...mundo,
    get pedidosALaRed() {
      return mundo.pedidosALaRed;
    },
    set guardado(r: Response | null) {
      mundo.guardado = r;
    },
    get guardado() {
      return mundo.guardado;
    },
    resolverRed: (r: Response) => resolver(r),
    rechazarRed: () => rechazar(),
    pedir(pedido: object) {
      let respondido!: Promise<Response>;
      alFetch({
        request: pedido,
        respondWith: (p: Promise<Response>) => {
          respondido = p;
        },
        waitUntil: (p: Promise<unknown>) => {
          void Promise.resolve(p).catch(() => {});
        },
      });
      if (!respondido) throw new Error('el worker no respondió el pedido');
      return respondido;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('una pantalla que nunca se abrió', () => {
  it('espera al servidor lento en vez de decir que no hay internet', async () => {
    /*
     * El hallazgo del mostrador. La primera carga de Fiado después de un
     * despliegue tardó más de cuatro segundos —el servidor recién levantado y la
     * base despertándose— y el worker, que esperaba cuatro, sirvió el cartel de
     * «Sin conexión». Había internet: lo que faltó fue paciencia.
     *
     * El plazo sigue estando para cuando hay una copia que mostrar. Cuando no
     * hay nada guardado, cortar no ahorra nada y miente sobre el motivo.
     */
    const w = levantarWorker();
    w.guardado = null;

    const respuesta = w.pedir(navegacionA('/fiado'));

    // Se pasa el plazo de cuatro segundos y la red todavía no contestó.
    await vi.advanceTimersByTimeAsync(5000);
    w.resolverRed(new Response('<h1>Fiado</h1>', { status: 200 }));

    const r = await respuesta;
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Fiado');
    // Y con un solo pedido: pedirla de nuevo sería cargar al servidor al doble
    // justo cuando está lento.
    expect(w.pedidosALaRed).toBe(1);
  });

  it('con la red caída de verdad, ahí sí dice que no hay conexión', async () => {
    const w = levantarWorker();
    w.guardado = null;

    const respuesta = w.pedir(navegacionA('/fiado'));
    w.rechazarRed();

    const r = await respuesta;
    expect(r.status).toBe(503);
    expect(await r.text()).toContain('Sin conexión');
  });
});

describe('una pantalla que ya se había abierto', () => {
  it('sirve la copia guardada sin esperar al servidor lento', async () => {
    // Acá el plazo sí sirve: hay algo que mostrar y el mostrador no tiene por
    // qué esperar. La copia sale a los cuatro segundos, no a los diez.
    const w = levantarWorker();
    w.guardado = new Response('<h1>Vender (copia)</h1>', { status: 200 });

    const respuesta = w.pedir(navegacionA('/vender'));
    await vi.advanceTimersByTimeAsync(4100);

    const r = await respuesta;
    expect(await r.text()).toContain('copia');
  });

  it('y guarda la respuesta que llegó tarde, para la próxima', async () => {
    const w = levantarWorker();
    w.guardado = new Response('<h1>Vender (copia)</h1>', { status: 200 });

    const respuesta = w.pedir(navegacionA('/vender'));
    await vi.advanceTimersByTimeAsync(4100);
    await respuesta;

    // La tardía llega después de que el worker ya respondió con la copia.
    w.resolverRed(new Response('<h1>Vender (fresco)</h1>', { status: 200 }));
    await vi.advanceTimersByTimeAsync(0);

    expect(w.puestos).toContain(`${ORIGEN}/vender`);
  });
});

describe('lo que el worker no toca', () => {
  it('una ruta de API nunca se responde desde el worker', () => {
    // Una respuesta vieja de `/api/buscar` sería stock inventado.
    const w = levantarWorker();
    expect(() => w.pedir({ ...navegacionA('/api/buscar'), mode: 'cors' })).toThrow(/no respondió/);
  });

  it('un POST tampoco: una acción de venta servida desde caché es una venta que nadie hizo', () => {
    const w = levantarWorker();
    expect(() => w.pedir({ method: 'POST', url: `${ORIGEN}/vender`, mode: 'navigate' })).toThrow(
      /no respondió/,
    );
  });
});
