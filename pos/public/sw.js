/**
 * Service worker del POS (v1.1, D56).
 *
 * Resuelve un problema puntual y nada más: que la pantalla de venta **abra**
 * sin internet. Todo lo demás del modo sin conexión —el catálogo guardado, la
 * cola de ventas cobradas— vive en la aplicación, en IndexedDB, y no acá.
 *
 * Sin esto, el resto no sirve: la tablet se recarga sola cada tanto, y sin
 * servidor el navegador muestra el dinosaurio. Toda la venta sin conexión
 * depende de que ese recargo devuelva el POS.
 *
 * Tres reglas:
 *
 *  1. **Las rutas de API nunca se cachean.** Ni el buscador, ni el catálogo, ni
 *     las acciones de servidor. Una respuesta vieja de `/api/buscar` sería
 *     stock inventado, y una acción de venta servida desde caché sería una
 *     venta que nadie hizo. Fallan, y la aplicación sabe qué hacer con eso.
 *  2. **Las páginas van por red primero.** Solo si la red falla se sirve la
 *     copia guardada, y se acompaña de la barra que dice que no hay conexión.
 *  3. **Los archivos de `/_next/static/` van por caché primero.** Llevan el
 *     hash del contenido en el nombre, así que uno viejo no existe: si el
 *     nombre está, el contenido es ese.
 */

const VERSION = 'v1';
const PAGINAS = `lucas-pos-paginas-${VERSION}`;
const ESTATICOS = `lucas-pos-estaticos-${VERSION}`;

/** Cuánto se espera a la red antes de servir lo guardado, en una navegación. */
const ESPERA_MS = 4000;

self.addEventListener('install', (evento) => {
  // Entra a mandar apenas se instala: si no, la primera visita después de un
  // despliegue se queda con el worker viejo hasta que se cierren las pestañas,
  // y en el mostrador no se cierra nunca.
  evento.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(
        nombres
          .filter((n) => n.startsWith('lucas-pos-') && !n.endsWith(VERSION))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Borra todo lo guardado.
 *
 * Lo pide la aplicación al cerrar sesión: la copia de una página lleva adentro
 * el nombre y el rol de quien estaba usando el POS, y la siguiente persona no
 * tiene por qué verlos.
 */
self.addEventListener('message', (evento) => {
  if (evento.data === 'limpiar') {
    evento.waitUntil(
      (async () => {
        const nombres = await caches.keys();
        await Promise.all(nombres.filter((n) => n.startsWith('lucas-pos-')).map((n) => caches.delete(n)));
      })(),
    );
  }
});

function esEstatico(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname === '/icono.svg';
}

function esApi(url) {
  return url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;

  // Las acciones de servidor son POST: no se tocan nunca.
  if (pedido.method !== 'GET') return;

  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;
  if (esApi(url)) return;

  if (esEstatico(url)) {
    evento.respondWith(
      (async () => {
        const guardado = await caches.match(pedido);
        if (guardado) return guardado;

        const respuesta = await fetch(pedido);
        if (respuesta.ok) {
          const cache = await caches.open(ESTATICOS);
          await cache.put(pedido, respuesta.clone());
        }
        return respuesta;
      })(),
    );
    return;
  }

  if (pedido.mode !== 'navigate') return;

  evento.respondWith(
    (async () => {
      try {
        // Con la red caída del todo el fetch falla enseguida; lo que este plazo
        // ataja es la conexión que está pero no anda —el módem sin internet—,
        // donde el pedido queda colgado y la pantalla en blanco.
        const respuesta = await Promise.race([
          fetch(pedido),
          new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('tarde')), ESPERA_MS)),
        ]);

        if (respuesta.ok) {
          const cache = await caches.open(PAGINAS);
          await cache.put(pedido, respuesta.clone());
        }
        return respuesta;
      } catch {
        const guardado = await caches.match(pedido);
        if (guardado) return guardado;

        // Nunca se abrió esta pantalla con conexión: no hay nada que servir.
        return new Response(
          `<!doctype html><html lang="es-AR"><head><meta charset="utf-8">
           <meta name="viewport" content="width=device-width,initial-scale=1">
           <title>Sin conexión</title>
           <style>body{font-family:system-ui;margin:0;display:grid;place-items:center;
           min-height:100dvh;padding:2rem;text-align:center;color:#111}
           h1{font-size:1.5rem;margin:0 0 .5rem}p{color:#555;max-width:28rem}</style></head>
           <body><div><h1>Sin conexión</h1>
           <p>Esta pantalla todavía no se abrió con internet en esta tablet, así que no hay
           una copia guardada. Volvé a intentar cuando vuelva la conexión.</p></div></body></html>`,
          { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
    })(),
  );
});
