'use client';

/**
 * Lo que la tablet guarda para poder vender sin conexión (D56).
 *
 * IndexedDB y no `localStorage`: el catálogo son cientos de kilobytes —de sobra
 * para el tope de 5 MB de `localStorage`, pero escribirlo entero bloquea el hilo
 * principal— y sobre todo una venta cobrada y no subida es el dato más
 * importante que existe en el sistema. `localStorage` se limpia con «borrar
 * datos de navegación» junto con la caché, y ahí se va la plata del día.
 *
 * Dos depósitos y nada más:
 *
 *  - `catalogo`  una sola fila: la última instantánea bajada.
 *  - `cola`      las ventas cobradas que todavía no entraron, por clave de
 *                idempotencia. Esa clave es la misma que usa el servidor, así
 *                que subir dos veces la misma venta no puede cobrarla dos veces.
 *
 * Todo lo de acá corre solo en el navegador. Si IndexedDB no está —modo privado
 * viejo, permisos—, las funciones fallan y quien llama muestra que el modo sin
 * conexión no está disponible, en vez de fingir que guardó.
 */
import type { Instantanea } from './catalogo';
import type { VentaEnCola } from './cola';

const BASE = 'lucas-pos';
const VERSION = 1;

export const DEPOSITO_CATALOGO = 'catalogo';
export const DEPOSITO_COLA = 'cola';

/** La única fila del depósito de catálogo. */
const CLAVE_CATALOGO = 'actual';

export class ErrorAlmacen extends Error {}

let abierta: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(
      new ErrorAlmacen('Este navegador no guarda datos: no se puede vender sin conexión.'),
    );
  }

  abierta ??= new Promise<IDBDatabase>((resolver, rechazar) => {
    const pedido = indexedDB.open(BASE, VERSION);

    pedido.onupgradeneeded = () => {
      const base = pedido.result;
      if (!base.objectStoreNames.contains(DEPOSITO_CATALOGO)) {
        base.createObjectStore(DEPOSITO_CATALOGO);
      }
      if (!base.objectStoreNames.contains(DEPOSITO_COLA)) {
        base.createObjectStore(DEPOSITO_COLA, { keyPath: 'idempotencyKey' });
      }
    };

    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () =>
      rechazar(new ErrorAlmacen('No se pudo abrir el almacén del navegador.'));
  });

  return abierta;
}

/** Envuelve una operación de IndexedDB en una promesa. */
function esperar<T>(pedido: IDBRequest<T>): Promise<T> {
  return new Promise((resolver, rechazar) => {
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(new ErrorAlmacen('Falló una operación del almacén.'));
  });
}

async function conDeposito<T>(
  nombre: string,
  modo: IDBTransactionMode,
  fn: (deposito: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const base = await abrir();
  const tx = base.transaction(nombre, modo);
  const resultado = await esperar(fn(tx.objectStore(nombre)));
  // Escribir y no esperar el commit deja una venta «guardada» que se pierde si
  // la pestaña se cierra en el instante siguiente.
  if (modo === 'readwrite') {
    await new Promise<void>((resolver, rechazar) => {
      tx.oncomplete = () => resolver();
      tx.onabort = () => rechazar(new ErrorAlmacen('No se pudo guardar en el almacén.'));
    });
  }
  return resultado;
}

/* -------------------------------------------------------------------------- */
/* Catálogo                                                                   */
/* -------------------------------------------------------------------------- */

export async function guardarCatalogo(instantanea: Instantanea): Promise<void> {
  await conDeposito(DEPOSITO_CATALOGO, 'readwrite', (d) =>
    d.put(instantanea, CLAVE_CATALOGO),
  );
}

export async function leerCatalogo(): Promise<Instantanea | null> {
  const guardado = await conDeposito<Instantanea | undefined>(DEPOSITO_CATALOGO, 'readonly', (d) =>
    d.get(CLAVE_CATALOGO),
  );
  return guardado ?? null;
}

/* -------------------------------------------------------------------------- */
/* Cola de ventas                                                             */
/* -------------------------------------------------------------------------- */

export async function encolarVenta(venta: VentaEnCola): Promise<void> {
  await conDeposito(DEPOSITO_COLA, 'readwrite', (d) => d.put(venta));
}

export async function ventasEnCola(): Promise<VentaEnCola[]> {
  const todas = await conDeposito<VentaEnCola[]>(DEPOSITO_COLA, 'readonly', (d) => d.getAll());
  // Se suben en el orden en que se cobraron: el correlativo que les asigne el
  // servidor queda en el mismo orden en que pasaron por el mostrador.
  return todas.sort((a, b) => a.capturadaEn.localeCompare(b.capturadaEn));
}

export async function cuantasEnCola(): Promise<number> {
  return conDeposito<number>(DEPOSITO_COLA, 'readonly', (d) => d.count());
}

export async function sacarDeLaCola(idempotencyKey: string): Promise<void> {
  await conDeposito(DEPOSITO_COLA, 'readwrite', (d) => d.delete(idempotencyKey));
}

/** Guarda la venta con el error con el que volvió, para poder mostrarlo. */
export async function anotarFalla(idempotencyKey: string, error: string): Promise<void> {
  const venta = await conDeposito<VentaEnCola | undefined>(DEPOSITO_COLA, 'readonly', (d) =>
    d.get(idempotencyKey),
  );
  if (!venta) return;
  await encolarVenta({ ...venta, intentos: venta.intentos + 1, ultimoError: error });
}
