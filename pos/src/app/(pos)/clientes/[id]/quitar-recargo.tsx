'use client';

import { useState, useTransition } from 'react';
import { quitarRecargoAccion, type EstadoFiado } from '@/app/acciones-fiado';
import { formatearARS, formatearUSD } from '@/lib/dinero';

/**
 * «Pagó antes de tiempo»: sacarle el recargo por financiar.
 *
 * Vive en el renglón de la venta y no en un menú aparte porque ahí es donde se
 * mira cuando el cliente está enfrente diciendo que viene a pagar todo junto.
 *
 * **Viene con el número puesto y se puede cambiar.** Lo más común es sacarle
 * todo el recargo —no financió nada—, pero el mostrador también lo parte: pagó
 * a los veinte días de un plan de tres meses y se arregla por la mitad. El
 * sistema no puede saber cuál de las dos es, así que propone la completa y
 * deja escribir.
 *
 * **Pregunta antes**, como la baja del catálogo: es plata que se deja de
 * cobrar, y no hay botón para volver atrás.
 */
export default function QuitarRecargo({
  saleId,
  venta,
  quedaCentavos,
  quitadoCentavos,
  moneda,
}: {
  saleId: string;
  venta: string;
  /** Lo que todavía se le puede sacar de recargo a esta venta. */
  quedaCentavos: number;
  /** Lo que ya se le sacó. Es el aviso de que se hizo, y dura. */
  quitadoCentavos: number;
  moneda: 'ARS' | 'USD';
}) {
  const cifra = moneda === 'USD' ? formatearUSD : formatearARS;
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState(String(quedaCentavos / 100));
  const [nota, setNota] = useState('');
  const [estado, setEstado] = useState<EstadoFiado>({});
  const [enCurso, enTransicion] = useTransition();

  function quitar() {
    const datos = new FormData();
    datos.set('saleId', saleId);
    datos.set('monto', monto);
    datos.set('nota', nota);
    enTransicion(async () => {
      const r = await quitarRecargoAccion({}, datos);
      setEstado(r);
      // El aviso de que salió lo da el renglón, que al volver a dibujarse
      // pasa a decir «se le sacaron $X». Un mensaje puesto acá se borraría en
      // el mismo instante en que hay algo para avisar.
      if (r.ok) setAbierto(false);
    });
  }

  if (!abierto) {
    return (
      <span className="flex w-full flex-wrap items-baseline justify-end gap-x-3 text-xs">
        {quitadoCentavos > 0 ? (
          <span className="text-(--color-ok)">
            se le sacaron {cifra(quitadoCentavos)} de recargo por financiar
          </span>
        ) : null}
        {quedaCentavos > 0 ? (
          <>
            <span className="text-(--color-tinta-suave)">
              {quitadoCentavos > 0 ? 'todavía incluye' : 'incluye'} {cifra(quedaCentavos)} de
              recargo por financiar
            </span>
            <button
              type="button"
              onClick={() => setAbierto(true)}
              className="shrink-0 font-semibold underline underline-offset-2"
            >
              Pagó antes: sacárselo
            </button>
          </>
        ) : null}
        {estado.error ? (
          <span role="alert" className="w-full text-right text-(--color-error)">
            {estado.error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <div className="mt-2 w-full space-y-2 rounded-(--radius-caja) bg-(--color-papel) p-3">
      <p className="text-sm">
        <strong>Pagó antes de tiempo.</strong> La venta {venta} tiene{' '}
        <strong className="tabular">{cifra(quedaCentavos)}</strong> de recargo por financiar. Al
        sacárselo baja la deuda. <strong>No es un pago:</strong> no entra plata a la caja, y el
        precio de la venta no se toca.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`quita-${saleId}`} className="mb-1 block text-xs font-medium">
            Cuánto se le saca
          </label>
          <input
            id={`quita-${saleId}`}
            type="text"
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            autoFocus
            className="tabular min-h-11 w-32 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-right"
          />
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor={`quita-nota-${saleId}`} className="mb-1 block text-xs font-medium">
            Nota (opcional)
          </label>
          <input
            id={`quita-nota-${saleId}`}
            type="text"
            maxLength={200}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Ej.: canceló a los dos días"
            className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
          />
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
          className="min-h-11 flex-1 rounded-(--radius-caja) border border-(--color-borde) text-sm font-medium"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={quitar}
          disabled={enCurso}
          className="min-h-11 flex-1 rounded-(--radius-caja) bg-(--color-marca) text-sm font-semibold text-(--color-marca-texto) disabled:opacity-60"
        >
          {enCurso ? 'Sacando…' : 'Sacarle el recargo'}
        </button>
      </div>
    </div>
  );
}
