'use client';

import { useActionState, useState } from 'react';
import { anularGastoAccion, pagarGastoAccion, type EstadoGastos } from '@/app/acciones-gastos';
import { formatearARS } from '@/lib/dinero';
import type { GastoEnLista } from '@/gastos/gastos';
import type { Opcion } from './formulario-gasto';

const INICIAL: EstadoGastos = {};

const MEDIOS = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'mercadopago', etiqueta: 'Mercado Pago' },
  { valor: 'debito', etiqueta: 'Débito' },
  { valor: 'credito', etiqueta: 'Crédito' },
  { valor: 'cheque', etiqueta: 'Cheque' },
] as const;

const NOMBRE_DEL_MEDIO: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mercadopago: 'Mercado Pago',
  debito: 'Débito',
  credito: 'Crédito',
  cheque: 'Cheque',
};

/** Un gasto de la lista, con lo que se puede hacer con él. */
export default function FilaGasto({
  gasto,
  cuentas,
  hoy,
}: {
  gasto: GastoEnLista;
  cuentas: Opcion[];
  hoy: string;
}) {
  const anulado = gasto.estado === 'anulado';
  const vencido =
    gasto.estado === 'pendiente' && gasto.vencimiento !== null && gasto.vencimiento < hoy;

  return (
    <li
      className={`rounded-(--radius-caja) border bg-(--color-panel) p-3 ${
        vencido ? 'border-(--color-alerta)' : 'border-(--color-borde)'
      } ${anulado ? 'opacity-70' : ''}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium">{gasto.descripcion}</span>
        <span className="rounded bg-(--color-papel) px-1.5 py-0.5 text-xs text-(--color-tinta-suave)">
          {gasto.categoria}
        </span>
        {gasto.estado === 'pendiente' ? (
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
              vencido
                ? 'bg-(--color-alerta-fondo) text-(--color-alerta-tinta)'
                : 'bg-(--color-papel) text-(--color-tinta-suave)'
            }`}
          >
            {vencido ? 'Vencido' : 'Pendiente'}
          </span>
        ) : null}
        {anulado ? (
          <span className="rounded bg-(--color-error-fondo) px-1.5 py-0.5 text-xs font-semibold text-(--color-error)">
            Anulado
          </span>
        ) : null}

        <span
          className={`tabular ml-auto text-lg font-bold ${
            anulado ? 'text-(--color-tinta-suave) line-through' : ''
          }`}
        >
          {formatearARS(gasto.montoCentavos)}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-(--color-tinta-suave)">
        <span>{gasto.fecha}</span>
        {gasto.beneficiario ? <span>· {gasto.beneficiario}</span> : null}
        {gasto.medio ? <span>· {NOMBRE_DEL_MEDIO[gasto.medio] ?? gasto.medio}</span> : null}
        {gasto.cuenta ? <span>· de {gasto.cuenta}</span> : null}
        {gasto.vencimiento && gasto.estado === 'pendiente' ? (
          <span>· vence {gasto.vencimiento}</span>
        ) : null}
        {gasto.cargadoPor ? <span>· lo cargó {gasto.cargadoPor}</span> : null}
      </div>

      {anulado && gasto.motivoAnulacion ? (
        <p className="mt-2 rounded-(--radius-caja) bg-(--color-papel) p-2 text-sm">
          <span className="font-medium">Motivo:</span> {gasto.motivoAnulacion}
        </p>
      ) : null}

      {!anulado ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {gasto.estado === 'pendiente' ? <Pagar gasto={gasto} cuentas={cuentas} /> : null}
          <Anular gasto={gasto} />
        </div>
      ) : null}
    </li>
  );
}

function Pagar({ gasto, cuentas }: { gasto: GastoEnLista; cuentas: Opcion[] }) {
  const [estado, accion, pendiente] = useActionState(pagarGastoAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="min-h-10 rounded-(--radius-caja) bg-(--color-accion) px-4 text-sm font-semibold text-(--color-accion-texto)"
      >
        Marcar como pagado
      </button>
    );
  }

  return (
    <form action={accion} className="w-full space-y-2 rounded-(--radius-caja) bg-(--color-papel) p-3">
      <input type="hidden" name="gastoId" value={gasto.id} />

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`medio-${gasto.id}`} className="mb-1 block text-xs font-medium">
            Con qué
          </label>
          <select
            id={`medio-${gasto.id}`}
            name="medio"
            defaultValue="transferencia"
            className="min-h-11 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
          >
            {MEDIOS.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`cuenta-${gasto.id}`} className="mb-1 block text-xs font-medium">
            De qué cuenta
          </label>
          <select
            id={`cuenta-${gasto.id}`}
            name="cuenta"
            className="min-h-11 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
          >
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
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
          className="min-h-10 flex-1 rounded-(--radius-caja) border border-(--color-borde) text-sm font-medium"
        >
          Volver
        </button>
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-10 flex-1 rounded-(--radius-caja) bg-(--color-accion) text-sm font-semibold text-(--color-accion-texto) disabled:opacity-60"
        >
          {pendiente ? 'Registrando…' : `Pagar ${formatearARS(gasto.montoCentavos)}`}
        </button>
      </div>
    </form>
  );
}

function Anular({ gasto }: { gasto: GastoEnLista }) {
  const [estado, accion, pendiente] = useActionState(anularGastoAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-sm font-medium text-(--color-error) underline underline-offset-2"
      >
        Anular
      </button>
    );
  }

  return (
    <form
      action={accion}
      className="w-full space-y-2 rounded-(--radius-caja) border-2 border-(--color-error) p-3"
    >
      <input type="hidden" name="gastoId" value={gasto.id} />
      <label htmlFor={`motivo-${gasto.id}`} className="block text-sm font-medium">
        ¿Por qué se anula este gasto?
      </label>
      <input
        id={`motivo-${gasto.id}`}
        name="motivo"
        type="text"
        required
        minLength={4}
        autoFocus
        placeholder="Ej.: se cargó dos veces"
        className="min-h-10 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2"
      />

      {estado.error ? (
        <p role="alert" className="text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}

      <p className="text-xs text-(--color-tinta-suave)">
        {gasto.estado === 'pagado'
          ? 'La plata vuelve a la cuenta de donde salió. El gasto no se borra: queda anulado con el motivo.'
          : 'No había movido plata, así que no vuelve nada.'}
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="min-h-10 flex-1 rounded-(--radius-caja) border border-(--color-borde) text-sm font-medium"
        >
          Volver
        </button>
        <button
          type="submit"
          disabled={pendiente}
          className="min-h-10 flex-1 rounded-(--radius-caja) bg-(--color-error) text-sm font-semibold text-(--color-error-texto) disabled:opacity-60"
        >
          {pendiente ? 'Anulando…' : 'Anular el gasto'}
        </button>
      </div>
    </form>
  );
}
