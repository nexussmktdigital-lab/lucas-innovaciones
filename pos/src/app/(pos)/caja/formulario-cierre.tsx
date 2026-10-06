'use client';

import { useEffect, useState } from 'react';
import { useActionState } from 'react';
import { cerrarCajaAccion, type EstadoCaja } from '@/app/acciones-caja';
import { formatearARS } from '@/lib/dinero';
import { cuantasEnCola } from '@/offline/almacen';

const INICIAL: EstadoCaja = {};

/**
 * Cerrar el turno.
 *
 * **Sin arqueo.** Antes el cajón se contaba por denominación y una diferencia
 * había que justificarla. El local no cuenta los billetes, así que el cierre
 * es confirmar y listo: el turno queda cerrado con lo que el sistema espera.
 *
 * No quedó un conteo opcional, y es a propósito: un arqueo que está pero nadie
 * hace es peor que no tenerlo, porque la columna se llena de ceros y después
 * alguien los lee como si significaran algo. Es literalmente lo que pasaba en
 * el POS viejo, donde el efectivo contado figuraba siempre en cero.
 *
 * Lo que se pierde es real y conviene saberlo: el arqueo era lo único que
 * detectaba un vuelto mal dado o una venta en efectivo cargada como
 * transferencia. El reporte del turno sigue estando entero.
 */
export default function FormularioCierre({
  esperadoCentavos,
  terminal,
}: {
  esperadoCentavos: number;
  terminal: string;
}) {
  const [estado, accion, pendiente] = useActionState(cerrarCajaAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);
  /**
   * Ventas cobradas sin conexión que todavía no entraron (D56).
   *
   * Sigue frenando el cierre aunque ya no haya arqueo: son ventas que no están
   * en el reporte del turno, y cerrar ahora las deja colgando de un turno que
   * ya cerró. La comprobación es del navegador porque la cola vive en el
   * navegador; el servidor no puede saberlo.
   */
  const [esperando, setEsperando] = useState(0);

  useEffect(() => {
    let vivo = true;
    const mirar = () =>
      cuantasEnCola()
        .then((n) => {
          if (vivo) setEsperando(n);
        })
        .catch(() => {
          // Sin almacén no hay cola que pueda existir: nada que frenar.
        });

    void mirar();
    const reloj = setInterval(mirar, 5_000);
    return () => {
      vivo = false;
      clearInterval(reloj);
    };
  }, []);

  // No hay estado de exito: al cerrar, la accion redirige al reporte del turno.

  if (esperando > 0) {
    return (
      <div
        role="alert"
        className="rounded-(--radius-caja) bg-(--color-error-fondo) p-4 text-sm"
      >
        <p className="font-semibold">
          No se puede cerrar el turno: {esperando}{' '}
          {esperando === 1 ? 'venta cobrada espera' : 'ventas cobradas esperan'} para entrar.
        </p>
        <p className="mt-1">
          Si cerrás ahora, esas ventas no entran en el reporte de este turno. Volvé a{' '}
          <strong>Vender</strong>, esperá a que suban solas o tocá «Subirlas ahora», y cerrá
          cuando no quede ninguna.
        </p>
      </div>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="min-h-13 w-full rounded-(--radius-caja) bg-(--color-marca) font-bold text-(--color-marca-texto)"
      >
        Cerrar el turno
      </button>
    );
  }

  return (
    <form
      action={accion}
      aria-label="Cerrar el turno"
      className="space-y-4 rounded-(--radius-caja) border-2 border-(--color-marca) bg-(--color-panel) p-4"
    >
      <div>
        <h2 className="font-semibold">Cerrar el turno de {terminal}</h2>
        <p className="text-sm text-(--color-tinta-suave)">
          Según el sistema quedan{' '}
          <strong className="tabular">{formatearARS(esperadoCentavos)}</strong> en el cajón.
        </p>
      </div>

      <div>
        <label htmlFor="nota" className="mb-1 block text-sm font-medium">
          Nota del turno (opcional)
        </label>
        <input
          id="nota"
          name="nota"
          type="text"
          maxLength={300}
          placeholder="Ej.: se cortó la luz de 4 a 6"
          className="min-h-10 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2"
        />
      </div>

      {estado.error ? (
        <p role="alert" className="text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="min-h-12 flex-1 rounded-(--radius-caja) border border-(--color-borde) font-medium"
        >
          Volver
        </button>
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-13 flex-1 rounded-(--radius-caja) bg-(--color-accion) font-bold text-(--color-accion-texto) disabled:opacity-40"
        >
          {pendiente ? 'Cerrando…' : 'Cerrar caja'}
        </button>
      </div>
    </form>
  );
}
