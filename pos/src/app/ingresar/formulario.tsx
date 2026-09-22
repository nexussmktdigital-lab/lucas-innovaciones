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
  const [pin, setPin] = useState('');

  if (vendedores.length === 0) {
    return (
      <p className="text-sm text-(--color-tinta-suave)">
        Todavía no hay vendedores cargados. Ingresá como dueño y creá el primero.
      </p>
    );
  }

  return (
    <form action={accion} className="space-y-5">
      {/* Con un solo vendedor no hay nada que elegir: se manda su id y listo. */}
      {vendedores.length === 1 ? (
        <input type="hidden" name="usuarioId" value={vendedores[0]!.id} />
      ) : (
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
      )}

      <div>
        <label htmlFor="pin" className="mb-2 block text-center text-sm font-medium">
          PIN
        </label>
        {/*
         * El campo sigue siendo un campo: en la MacBook se tipea con el teclado
         * y andá a saber cuántas veces por día. El teclado de abajo es para la
         * tablet, que es donde el vendedor entra parado y con una mano.
         */}
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
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          className="tabular w-full rounded-(--radius-caja) border-[1.5px] border-(--color-borde) bg-(--color-papel) px-4 py-3 text-center text-3xl tracking-[0.5em]"
        />
      </div>

      <TecladoNumerico valor={pin} onCambio={setPin} pendiente={pendiente} />

      <Mensaje error={estado.error} />

      <p className="text-center text-sm text-(--color-tinta-suave)">
        {pin.length >= 4
          ? 'Listo, tocá Entrar.'
          : 'Si te lo olvidaste, Lucas te lo cambia desde Cuentas.'}
      </p>
    </form>
  );
}

/**
 * El teclado del mostrador.
 *
 * Teclas de 64 px: se tipean con el pulgar, parado, sin mirar y sin apoyar la
 * tablet. «Entrar» es el envío del formulario —no un botón aparte— así que el
 * Enter del teclado físico hace exactamente lo mismo.
 */
function TecladoNumerico({
  valor,
  onCambio,
  pendiente,
}: {
  valor: string;
  onCambio: (pin: string) => void;
  pendiente: boolean;
}) {
  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {teclas.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onCambio((valor + t).slice(0, 8))}
          className="font-titulo min-h-16 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) text-2xl font-bold"
        >
          {t}
        </button>
      ))}

      <button
        type="button"
        onClick={() => onCambio(valor.slice(0, -1))}
        className="min-h-16 rounded-(--radius-caja) border border-(--color-borde) text-sm font-semibold text-(--color-tinta-suave)"
      >
        Borrar
      </button>

      <button
        type="button"
        onClick={() => onCambio((valor + '0').slice(0, 8))}
        className="font-titulo min-h-16 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) text-2xl font-bold"
      >
        0
      </button>

      <button
        type="submit"
        disabled={pendiente || valor.length < 4}
        className="min-h-16 rounded-(--radius-caja) bg-(--color-accion) text-base font-bold text-(--color-accion-texto) disabled:opacity-40"
      >
        {pendiente ? 'Entrando…' : 'Entrar'}
      </button>
    </div>
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
      className="min-h-12 w-full rounded-(--radius-caja) bg-(--color-marca) px-4 font-semibold text-(--color-marca-texto) transition hover:bg-(--color-marca-fuerte) disabled:opacity-60"
    >
      {pendiente ? 'Entrando…' : children}
    </button>
  );
}
