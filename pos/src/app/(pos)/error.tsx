'use client';

/**
 * Lo que ve el mostrador cuando una pantalla falla.
 *
 * Sin esto aparece la pantalla de Next: un fondo blanco que dice «Application
 * error: a server-side exception has occurred», en inglés, con un código y nada
 * más. A las siete de la tarde, con un cliente esperando, eso no dice ninguna
 * de las tres cosas que hacen falta saber.
 *
 * Las tres están acá, en este orden:
 *
 *  1. **Si se movió plata.** Es lo primero que piensa quien está atendiendo, y
 *     la respuesta es que no: una pantalla que no carga no cobró nada. Todo lo
 *     que toca plata pasa por una transacción que entra completa o no entra
 *     (D34), así que no existe la venta a medias.
 *  2. **Qué hacer ahora.** Reintentar, que casi siempre alcanza, y si no,
 *     volver a vender.
 *  3. **Qué decirle a quien lo arregla.** El código que Next genera es lo que
 *     permite encontrar el error exacto en los registros del servidor.
 */
import { useEffect } from 'react';
import Link from 'next/link';

export default function ErrorDelPos({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[pantalla] Falló:', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg pt-12 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Esta pantalla no cargó</h1>

      <p className="mt-3 rounded-(--radius-caja) border-2 border-(--color-ok) bg-(--color-ok)/8 p-3 font-semibold text-(--color-ok)">
        No se cobró nada y no se perdió ninguna venta.
      </p>

      <p className="mt-3 text-sm text-(--color-tinta-suave)">
        Suele ser la conexión con la base de datos. Probá de nuevo; si sigue igual, seguí
        vendiendo desde la pantalla de venta y avisale a quien mantiene el sistema.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="min-h-12 flex-1 rounded-(--radius-caja) bg-(--color-marca) px-6 font-semibold text-white"
        >
          Probar de nuevo
        </button>
        <Link
          href="/vender"
          className="min-h-12 flex-1 rounded-(--radius-caja) border-2 border-(--color-borde) px-6 leading-[3rem] font-semibold"
        >
          Ir a vender
        </Link>
      </div>

      {error.digest ? (
        <p className="mt-6 text-xs text-(--color-tinta-suave)">
          Código para quien lo arregla: <code className="tabular">{error.digest}</code>
        </p>
      ) : null}
    </div>
  );
}
