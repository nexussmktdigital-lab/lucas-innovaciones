'use client';

/**
 * Dar de alta un cliente sin salir de la pantalla de venta.
 *
 * El caso es concreto y pasa todos los días: se armó el carrito, se va a fiar, y
 * el cliente no está cargado. Antes había que abrir la pantalla de clientes en
 * otra pestaña, cargarlo, volver y —según cómo hubiera quedado la pestaña—
 * rearmar el pedido. Con alguien esperando del otro lado del mostrador.
 *
 * Pide lo mínimo: el nombre, que es lo único obligatorio, y el teléfono, que es
 * por donde le van a llegar el comprobante y el recordatorio de la deuda (D39).
 * El resto de la ficha se completa después, desde Clientes, si hace falta.
 *
 * Es una ventana sobre la pantalla y no un formulario metido en la columna del
 * carrito: cargar a alguien es una cosa sola, de treinta segundos, y mientras
 * dura no hay nada más que hacer. Encima, en el celular el formulario embebido
 * empujaba el carrito para abajo y había que volver a buscarlo.
 */
import { useEffect, useRef, useState } from 'react';
import { crearClienteAccion } from '@/app/acciones-fiado';
import type { Cliente } from './pantalla-venta';

export default function NuevoCliente({
  onCreado,
  onCancelar,
}: {
  onCreado: (cliente: Cliente) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    campo.current?.focus();
  }, []);

  // Escape cierra, como en el cobro. Es el reflejo de cualquiera que tenga una
  // ventana abierta y se arrepienta.
  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancelar();
    }
    window.addEventListener('keydown', alTeclado);
    return () => window.removeEventListener('keydown', alTeclado);
  }, [onCancelar]);

  /*
   * La acción se llama a mano y no con `useActionState`.
   *
   * Con `useActionState` hay que avisarle al padre desde un efecto que mira el
   * resultado, y ese efecto corre dentro de la transición que abre la acción:
   * el `setClienteId` del padre se hacía durante esa transición y React lo
   * descartaba al volver a renderizar. El cliente quedaba creado y en la lista,
   * pero sin elegir — que es justo lo que este formulario viene a evitar.
   *
   * Llamándola así, el aviso ocurre después del `await`, fuera de toda
   * transición, y lo que el padre guarda queda.
   */
  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pendiente) return;

    setPendiente(true);
    setError(null);

    const datos = new FormData();
    datos.set('nombre', nombre.trim());
    datos.set('telefono', telefono.trim());

    try {
      const r = await crearClienteAccion({}, datos);

      if (!r.clienteId) {
        setError(r.error ?? 'No se pudo cargar el cliente.');
        return;
      }

      // El nombre sale de lo que se tipeó: la acción devuelve el id, que es lo
      // que el servidor sabe con certeza, y lo demás ya está acá. Nace sin
      // deuda y sin tope, que es lo que el servidor acaba de crear.
      onCreado({
        id: r.clienteId,
        nombre: nombre.trim(),
        telefono: telefono.trim() || null,
        saldoCentavos: 0,
        limiteCentavos: null,
      });
    } catch {
      setError('No se pudo cargar el cliente. Probá de nuevo.');
    } finally {
      setPendiente(false);
    }
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancelar();
      }}
    >
      <form
        onSubmit={enviar}
        aria-label="Cargar un cliente"
        className="flex w-full max-w-sm flex-col gap-3 rounded-(--radius-caja) bg-(--color-panel) p-4 shadow-xl"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Cliente nuevo</h2>
          <button
            type="button"
            onClick={onCancelar}
            className="text-sm text-(--color-tinta-suave) underline underline-offset-2"
          >
            Cerrar <kbd>Esc</kbd>
          </button>
        </div>
        <div>
          <label
            htmlFor="cliente-nombre"
            className="mb-0.5 block text-xs text-(--color-tinta-suave)"
          >
            Nombre
          </label>
          <input
            id="cliente-nombre"
            name="nombre"
            ref={campo}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            minLength={2}
            maxLength={120}
            autoComplete="off"
            placeholder="Nombre y apellido"
            className="min-h-10 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
          />
        </div>

        <div>
          <label
            htmlFor="cliente-telefono"
            className="mb-0.5 block text-xs text-(--color-tinta-suave)"
          >
            Teléfono <span className="opacity-70">— para mandarle el comprobante</span>
          </label>
          <input
            id="cliente-telefono"
            name="telefono"
            type="tel"
            inputMode="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            maxLength={40}
            autoComplete="off"
            placeholder="3573 40-0000"
            className="min-h-10 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
          />
        </div>

        {error ? (
          <p role="alert" className="text-xs font-medium text-(--color-error)">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pendiente || nombre.trim().length < 2}
            className="min-h-10 flex-1 rounded-(--radius-caja) bg-(--color-marca) text-sm font-semibold text-(--color-marca-texto) disabled:opacity-60"
          >
            {pendiente ? 'Cargando…' : 'Cargar y elegir'}
          </button>
          <button
            type="button"
            onClick={onCancelar}
            className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) px-3 text-sm"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
