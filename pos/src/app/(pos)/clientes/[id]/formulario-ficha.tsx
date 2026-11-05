'use client';

import { useActionState, useMemo, useState } from 'react';
import { migrarFichaAccion, type EstadoFiado } from '@/app/acciones-fiado';
import { leerEntregas } from '@/fiado/libreta';
import { formatearARS } from '@/lib/dinero';

const INICIAL: EstadoFiado = {};

/**
 * Carga el saldo de una ficha de papel.
 *
 * Solo aparece cuando el cliente no tiene movimientos: es la puerta de entrada
 * de la libreta al sistema, y se usa una sola vez por cliente. Sumar dos veces
 * la misma deuda es el error que hay que evitar, así que el dominio también lo
 * rechaza.
 *
 * **También entran las entregas que ya había hecho.** Se pegan tal como están
 * en el cuaderno —con el «ENTREGA», el signo y los paréntesis— y se leen
 * mientras se escribe, así se ve antes de guardar cuáles entendió y cuáles no.
 * Sin ellas la cuenta arranca sin historia y no hay forma de contestar
 * «¿cuándo pagó la última vez?», que es lo que se mira antes de reclamarle.
 */
export default function FormularioFicha({
  clienteId,
  nombre,
  saldoActualCentavos,
}: {
  clienteId: string;
  nombre: string;
  /** Lo que la cuenta ya debe por ventas hechas en el sistema. */
  saldoActualCentavos: number;
}) {
  const [estado, accion, pendiente] = useActionState(migrarFichaAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);
  const [entregas, setEntregas] = useState('');

  // La misma lectura que hace el servidor, mientras se escribe. El servidor la
  // repite igual: esto es para ver, no para decidir.
  const lectura = useMemo(() => leerEntregas(entregas), [entregas]);
  const malos = lectura.lineas.filter((l) => l.problema);

  // Lo de la libreta se suma a lo que la cuenta ya debe, así que el total se
  // muestra antes de guardar: es la cuenta que nadie quiere hacer de cabeza.
  const [saldo, setSaldo] = useState('');
  const deLaLibretaCentavos = (() => {
    const n = Number(saldo.trim().replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  })();

  if (estado.ok) {
    return (
      <p role="status" className="text-sm font-medium text-(--color-ok)">
        {estado.ok}
      </p>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-sm underline underline-offset-2"
      >
        Cargar una ficha de papel
      </button>
    );
  }

  return (
    <form action={accion} className="space-y-2 rounded-(--radius-caja) bg-(--color-papel) p-3">
      <input type="hidden" name="clienteId" value={clienteId} />
      <p className="text-sm">
        ¿Cuánto dice la libreta que debe <strong>{nombre}</strong>, <strong>aparte</strong> de lo
        que ya está en el sistema? Se carga una sola vez, al pasar la ficha.
      </p>

      {saldoActualCentavos > 0 ? (
        <p className="rounded-(--radius-caja) bg-(--color-alerta-fondo) px-3 py-2 text-sm">
          Esta cuenta ya debe <strong className="tabular">{formatearARS(saldoActualCentavos)}</strong>{' '}
          por ventas hechas en el sistema. Si alguno de esos renglones también está en el cuaderno,
          escribí solo la diferencia: el saldo de abajo se suma, no reemplaza.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`saldo-${clienteId}`} className="mb-1 block text-xs font-medium">
            Saldo de la libreta
          </label>
          <input
            id={`saldo-${clienteId}`}
            name="saldo"
            type="text"
            inputMode="decimal"
            required
            autoFocus
            value={saldo}
            onChange={(e) => setSaldo(e.target.value)}
            className="tabular min-h-11 w-40 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-right text-lg"
          />
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor={`nota-ficha-${clienteId}`} className="mb-1 block text-xs font-medium">
            De dónde sale (opcional)
          </label>
          <input
            id={`nota-ficha-${clienteId}`}
            name="nota"
            type="text"
            maxLength={200}
            placeholder="Ej.: libreta, hoja 12"
            className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
          />
        </div>
      </div>

      <div>
        <label htmlFor={`entregas-${clienteId}`} className="mb-1 block text-xs font-medium">
          Las entregas que ya hizo (opcional)
        </label>
        <textarea
          id={`entregas-${clienteId}`}
          name="entregas"
          rows={4}
          value={entregas}
          onChange={(e) => setEntregas(e.target.value)}
          placeholder={'ENTREGA $22.000 (16/6/26)\nENTREGA $44.000 (19/06/26) (transferencia)'}
          className="w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-2 font-mono text-sm"
        />
        <p className="mt-1 text-xs text-(--color-tinta-suave)">
          Pegalas como están en el cuaderno. Los renglones de mercadería se saltean solos. Cada
          entrega necesita su fecha: sin ella no se puede saber cuándo pagó.
        </p>
      </div>

      {deLaLibretaCentavos > 0 ? (
        <p className="rounded-(--radius-caja) bg-(--color-papel) px-3 py-2 text-sm">
          {saldoActualCentavos > 0 ? (
            <>
              <span className="tabular">{formatearARS(saldoActualCentavos)}</span> que ya debe +{' '}
              <span className="tabular">{formatearARS(deLaLibretaCentavos)}</span> de la libreta ={' '}
            </>
          ) : (
            <>Va a quedar debiendo </>
          )}
          <strong className="tabular">
            {formatearARS(saldoActualCentavos + deLaLibretaCentavos)}
          </strong>
          .
        </p>
      ) : null}

      {lectura.entregas.length > 0 ? (
        <p className="rounded-(--radius-caja) bg-(--color-ok-fondo) px-3 py-2 text-sm">
          Leí <strong>{lectura.entregas.length}</strong>{' '}
          {lectura.entregas.length === 1 ? 'entrega' : 'entregas'} por{' '}
          <strong className="tabular">{formatearARS(lectura.totalCentavos)}</strong>. Se guardan con
          su fecha y no tocan la caja de hoy.
        </p>
      ) : null}

      {malos.length > 0 ? (
        <div className="rounded-(--radius-caja) bg-(--color-error-fondo) px-3 py-2 text-sm">
          <p className="font-medium">
            Estos {malos.length === 1 ? 'no lo entendí' : 'no los entendí'}, y hasta que no se
            arreglen no se carga nada:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {malos.map((l, i) => (
              <li key={i}>
                <span className="font-mono text-xs">{l.texto}</span> — {l.problema}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
          Cancelar
        </button>
        <button
          type="submit"
          // Con un renglón sin leer el servidor lo rechaza igual; frenarlo acá
          // evita el viaje y deja el error donde se está escribiendo.
          disabled={pendiente || malos.length > 0}
          className="min-h-10 flex-1 rounded-(--radius-caja) bg-(--color-marca) text-sm font-semibold text-(--color-marca-texto) disabled:opacity-60"
        >
          {pendiente ? 'Cargando…' : 'Cargar la ficha'}
        </button>
      </div>
    </form>
  );
}
