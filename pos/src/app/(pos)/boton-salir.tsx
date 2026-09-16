'use client';

/**
 * Salir, borrando de paso lo que el service worker dejó guardado.
 *
 * La copia de una pantalla lleva adentro el nombre y el rol de quien la abrió.
 * En el mostrador entran el dueño y el vendedor en la misma tablet, así que al
 * salir se le pide al worker que tire lo guardado: quien entre después no tiene
 * por qué ver, ni por un recargo sin conexión, la pantalla del anterior.
 *
 * **Lo que NO se borra es la cola de ventas cobradas.** Eso es plata que el
 * sistema todavía no tiene, y vive en IndexedDB justamente para sobrevivir a
 * esto. Que quien atiende se vaya sin subirla ya lo avisa la pantalla de venta.
 */

export default function BotonSalir({ salir }: { salir: () => Promise<void> }) {
  async function alSalir() {
    try {
      const registro = await navigator.serviceWorker?.getRegistration();
      registro?.active?.postMessage('limpiar');
    } catch {
      // Sin service worker no hay nada que limpiar y salir tiene que funcionar
      // igual: nunca se traba la salida por esto.
    }
    await salir();
  }

  return (
    <form action={alSalir}>
      <button
        type="submit"
        className="min-h-9 rounded-(--radius-caja) border border-(--color-borde) px-3 font-medium"
      >
        Salir
      </button>
    </form>
  );
}
