'use client';

import { useActionState, useState } from 'react';
import { ingresarComoDuenio, ingresarConPin, type EstadoIngreso } from '../acciones-auth';

interface Vendedor {
  id: string;
  nombre: string;
}

const INICIAL: EstadoIngreso = {};

export default function FormularioIngreso({ vendedores }: { vendedores: Vendedor[] }) {
  const [modo, setModo] = useState<'vendedor' | 'duenio'>(
    vendedores.length > 0 ? 'vendedor' : 'duenio',
  );

  return (
    <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-6 shadow-sm">
      <div
        role="tablist"
        aria-label="Forma de ingreso"
        className="mb-6 grid grid-cols-2 gap-1 rounded-(--radius-caja) bg-(--color-papel) p-1"
      >
        {(['vendedor', 'duenio'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={modo === m}
            onClick={() => setModo(m)}
            className={`min-h-11 rounded-md px-3 text-sm font-semibold transition ${
              modo === m
                ? 'bg-(--color-panel) text-(--color-tinta) shadow-sm'
                : 'text-(--color-tinta-suave)'
            }`}
          >
            {m === 'vendedor' ? 'Vendedor' : 'Dueño'}
          </button>
        ))}
      </div>

      {modo === 'vendedor' ? <IngresoPin vendedores={vendedores} /> : <IngresoDuenio />}
    </div>
  );
}

function IngresoPin({ vendedores }: { vendedores: Vendedor[] }) {
  const [estado, accion, pendiente] = useActionState(ingresarConPin, INICIAL);
  const [elegido, setElegido] = useState<string>(vendedores[0]?.id ?? '');

  if (vendedores.length === 0) {
    return (
      <p className="text-sm text-(--color-tinta-suave)">
        Todavía no hay vendedores cargados. Ingresá como dueño y creá el primero.
      </p>
    );
  }

  return (
    <form action={accion} className="space-y-4">
      <fieldset>
        <legend className="mb-2 block text-sm font-medium">¿Quién vende?</legend>
        <div className="grid gap-2">
          {vendedores.map((v) => (
            <label
              key={v.id}
              className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-(--radius-caja) border px-4 text-left font-medium ${
                elegido === v.id
                  ? 'border-(--color-marca) bg-(--color-marca)/10'
                  : 'border-(--color-borde)'
              }`}
            >
              <input
                type="radio"
                name="usuarioId"
                value={v.id}
                checked={elegido === v.id}
                onChange={() => setElegido(v.id)}
                className="size-4"
              />
              {v.nombre}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="pin" className="mb-1 block text-sm font-medium">
          PIN
        </label>
        <input
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="\d{4,8}"
          maxLength={8}
          required
          autoFocus
          className="tabular w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-4 py-3 text-center text-2xl tracking-[0.5em]"
        />
      </div>

      <Mensaje error={estado.error} />
      <Boton pendiente={pendiente}>Entrar</Boton>
    </form>
  );
}

function IngresoDuenio() {
  const [estado, accion, pendiente] = useActionState(ingresarComoDuenio, INICIAL);

  return (
    <form action={accion} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-4 py-3"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-4 py-3"
        />
      </div>
      <Mensaje error={estado.error} />
      <Boton pendiente={pendiente}>Entrar</Boton>
    </form>
  );
}

function Mensaje({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm font-medium text-(--color-error)">
      {error}
    </p>
  );
}

function Boton({ pendiente, children }: { pendiente: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pendiente}
      className="min-h-12 w-full rounded-(--radius-caja) bg-(--color-marca) px-4 font-semibold text-white transition hover:bg-(--color-marca-fuerte) disabled:opacity-60"
    >
      {pendiente ? 'Entrando…' : children}
    </button>
  );
}
