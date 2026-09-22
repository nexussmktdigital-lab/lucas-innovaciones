'use client';

import { useActionState, useState } from 'react';
import { crearClienteAccion, editarClienteAccion, type EstadoFiado } from '@/app/acciones-fiado';

const INICIAL: EstadoFiado = {};

export interface ClienteEditable {
  id: string;
  nombre: string;
  telefonoRaw: string | null;
  dni: string | null;
  notas: string | null;
}

/**
 * Alta y edición de un cliente.
 *
 * Solo el nombre es obligatorio: en el mostrador muchas veces no hay más que
 * eso, y pedir el resto haría que se cargue «Juan» y nada más igual, pero con
 * dos minutos perdidos.
 */
export default function FormularioCliente({ cliente }: { cliente?: ClienteEditable }) {
  const esEdicion = Boolean(cliente);
  const [estado, accion, pendiente] = useActionState(
    esEdicion ? editarClienteAccion : crearClienteAccion,
    INICIAL,
  );
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className={
            esEdicion
              ? 'text-sm underline underline-offset-2'
              : 'min-h-11 rounded-(--radius-caja) border-2 border-(--color-marca) px-4 font-semibold text-(--color-marca)'
          }
        >
          {esEdicion ? 'Editar los datos' : '+ Cliente nuevo'}
        </button>
        {estado.ok ? (
          <p role="status" className="mt-2 text-sm font-medium text-(--color-ok)">
            {estado.ok}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={accion}
      className="space-y-3 rounded-(--radius-caja) border-2 border-(--color-marca) bg-(--color-panel) p-4"
    >
      {cliente ? <input type="hidden" name="clienteId" value={cliente.id} /> : null}

      <h2 className="font-semibold">{esEdicion ? 'Editar cliente' : 'Cliente nuevo'}</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo
          nombre="nombre"
          etiqueta="Nombre y apellido"
          requerido
          defecto={cliente?.nombre}
          autoFocus
        />
        <Campo
          nombre="telefono"
          etiqueta="Teléfono"
          defecto={cliente?.telefonoRaw ?? ''}
          ayuda="Como lo tengas: 3573 42-1234"
        />
        <Campo nombre="dni" etiqueta="DNI (opcional)" defecto={cliente?.dni ?? ''} />
        <Campo nombre="notas" etiqueta="Nota (opcional)" defecto={cliente?.notas ?? ''} />
      </div>

      {estado.error ? (
        <p role="alert" className="text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}
      {estado.ok ? (
        <p role="status" className="text-sm font-medium text-(--color-ok)">
          {estado.ok}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="min-h-11 flex-1 rounded-(--radius-caja) border border-(--color-borde) font-medium"
        >
          {estado.ok ? 'Listo' : 'Cancelar'}
        </button>
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-11 flex-1 rounded-(--radius-caja) bg-(--color-marca) font-semibold text-(--color-marca-texto) disabled:opacity-60"
        >
          {pendiente ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}

function Campo({
  nombre,
  etiqueta,
  defecto,
  requerido,
  ayuda,
  autoFocus,
}: {
  nombre: string;
  etiqueta: string;
  defecto?: string;
  requerido?: boolean;
  ayuda?: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label htmlFor={nombre} className="mb-1 block text-sm font-medium">
        {etiqueta}
      </label>
      <input
        id={nombre}
        name={nombre}
        type="text"
        required={requerido}
        defaultValue={defecto ?? ''}
        autoFocus={autoFocus}
        maxLength={200}
        className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3"
      />
      {ayuda ? <p className="mt-0.5 text-xs text-(--color-tinta-suave)">{ayuda}</p> : null}
    </div>
  );
}
