'use client';

import { useActionState, useState } from 'react';
import { guardarPlantillasAccion, type EstadoWhatsApp } from '@/app/acciones-whatsapp';
import { DIAS_MAXIMO } from '@/whatsapp/config';
import {
  CAMPOS,
  LARGO_MAXIMO,
  PLANTILLAS_POR_DEFECTO,
  renderizar,
  type TipoDeMensaje,
} from '@/whatsapp/plantillas';

const INICIAL: EstadoWhatsApp = {};

const TITULOS: Record<TipoDeMensaje, { titulo: string; cuando: string }> = {
  comprobante: {
    titulo: 'Comprobante de compra',
    cuando: 'Se ofrece en cada venta del turno que tenga un cliente con teléfono.',
  },
  recordatorio_fiado: {
    titulo: 'Recordatorio de deuda',
    cuando: 'Se ofrece en la lista de fiado y en la ficha del cliente.',
  },
};

/**
 * Los textos que el local le manda a sus clientes.
 *
 * Se ve el mensaje armado mientras se escribe, con datos de ejemplo: nadie
 * deberia tener que mandarse un WhatsApp a si mismo para ver como quedo.
 */
export default function FormularioPlantillas({
  comprobante,
  recordatorio,
  dias,
}: {
  comprobante: string;
  recordatorio: string;
  dias: number;
}) {
  const [estado, accion, pendiente] = useActionState(guardarPlantillasAccion, INICIAL);
  const [textos, setTextos] = useState<Record<TipoDeMensaje, string>>({
    comprobante,
    recordatorio_fiado: recordatorio,
  });

  return (
    <form action={accion} className="space-y-4">
      {(Object.keys(TITULOS) as TipoDeMensaje[]).map((tipo) => (
        <Plantilla
          key={tipo}
          tipo={tipo}
          valor={textos[tipo]}
          alCambiar={(v) => setTextos((t) => ({ ...t, [tipo]: v }))}
        />
      ))}

      <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
        <label htmlFor="dias" className="block font-semibold">
          Cada cuánto se le puede recordar la deuda a la misma persona
        </label>
        <p className="mt-0.5 text-sm text-(--color-tinta-suave)">
          Antes de ese plazo el botón pide confirmación. Es la diferencia entre avisar y perseguir:
          quien recibe tres mensajes en una semana no paga antes, deja de comprar.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="dias"
            name="dias"
            type="number"
            min={1}
            max={DIAS_MAXIMO}
            defaultValue={dias}
            className="tabular min-h-11 w-24 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 text-right text-lg"
          />
          <span className="text-sm">días</span>
        </div>
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

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-11 rounded-(--radius-caja) bg-(--color-marca) px-5 font-semibold text-white disabled:opacity-60"
        >
          {pendiente ? 'Guardando…' : 'Guardar los textos'}
        </button>
        <button
          type="button"
          onClick={() => setTextos({ ...PLANTILLAS_POR_DEFECTO })}
          className="min-h-11 rounded-(--radius-caja) border border-(--color-borde) px-4 text-sm font-medium"
        >
          Volver a los textos de fábrica
        </button>
      </div>
    </form>
  );
}

function Plantilla({
  tipo,
  valor,
  alCambiar,
}: {
  tipo: TipoDeMensaje;
  valor: string;
  alCambiar: (v: string) => void;
}) {
  const campos = CAMPOS[tipo];
  const ejemplo = Object.fromEntries(campos.map((c) => [c.campo, c.ejemplo]));
  const vistaPrevia = renderizar(valor, ejemplo);
  const sobra = valor.length - LARGO_MAXIMO;

  return (
    <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
      <label htmlFor={`texto-${tipo}`} className="block font-semibold">
        {TITULOS[tipo].titulo}
      </label>
      <p className="mt-0.5 text-sm text-(--color-tinta-suave)">{TITULOS[tipo].cuando}</p>

      <textarea
        id={`texto-${tipo}`}
        name={tipo}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        rows={7}
        className="mt-2 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) p-3 font-mono text-sm"
      />

      <p className={`text-xs ${sobra > 0 ? 'text-(--color-error)' : 'text-(--color-tinta-suave)'}`}>
        {sobra > 0
          ? `Se pasa por ${sobra} caracteres del tope de ${LARGO_MAXIMO}.`
          : `${valor.length} de ${LARGO_MAXIMO} caracteres.`}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold text-(--color-tinta-suave)">
            Datos que podés poner
          </p>
          <ul className="flex flex-col gap-0.5 text-xs">
            {campos.map((c) => (
              <li key={c.campo}>
                <button
                  type="button"
                  onClick={() => alCambiar(`${valor}{${c.campo}}`)}
                  className="rounded bg-(--color-papel) px-1.5 py-0.5 font-mono font-semibold"
                >
                  {`{${c.campo}}`}
                </button>{' '}
                <span className="text-(--color-tinta-suave)">{c.que}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-(--color-tinta-suave)">
            Cómo le llega al cliente
          </p>
          <p className="whitespace-pre-line rounded-(--radius-caja) bg-(--color-papel) p-3 text-sm">
            {vistaPrevia || '—'}
          </p>
        </div>
      </div>
    </div>
  );
}
