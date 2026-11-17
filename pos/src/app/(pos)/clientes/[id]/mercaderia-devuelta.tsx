'use client';

import { useEffect, useState, useTransition } from 'react';
import { useQuery } from '@tanstack/react-query';
import { registrarDevolucionAccion, type EstadoFiado } from '@/app/acciones-fiado';
import { formatearARS } from '@/lib/dinero';
import { fechaLocalISO } from '@/lib/fecha';
import { MINIMO_PARA_PARECIDOS, type ProductoParecido } from '@/catalogo/crear';

const ESPERA_MS = 250;

interface Renglon {
  productId: string;
  nombre: string;
  cantidad: string;
  /** Lo que se le reconoce, en pesos, como lo escribe quien atiende. */
  importe: string;
}

function aCentavos(texto: string): number {
  const n = Number(texto.trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/**
 * El cliente trajo mercadería de vuelta.
 *
 * La pantalla de Devoluciones trabaja contra una venta, y lo que este cliente
 * se llevó vino de la libreta de papel: no hay venta detrás y no la va a
 * haber. Esto es el camino para eso.
 *
 * **El importe se escribe, no se calcula.** Lo que se le reconoce por algo
 * devuelto se negocia con el cliente enfrente y no tiene por qué ser lo que
 * pagó: la libreta tiene un vaso de $17.000 que volvió por $8.500. El precio
 * de catálogo se muestra al lado como referencia y se puede tomar de un
 * toque, pero no manda.
 */
export default function MercaderiaDevuelta({
  clienteId,
  nombre,
  saldoCentavos,
}: {
  clienteId: string;
  nombre: string;
  /** Lo que debe: el tope de lo que se le puede descontar. */
  saldoCentavos: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [consulta, setConsulta] = useState('');
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [nota, setNota] = useState('');
  const [estado, setEstado] = useState<EstadoFiado>({});
  const [enCurso, enTransicion] = useTransition();

  // Se espera a que deje de tipear: una consulta por tecla es una por tecla.
  useEffect(() => {
    const reloj = setTimeout(() => setConsulta(texto.trim()), ESPERA_MS);
    return () => clearTimeout(reloj);
  }, [texto]);

  const { data } = useQuery({
    queryKey: ['devolucion-buscar', consulta],
    enabled: abierto && consulta.length >= MINIMO_PARA_PARECIDOS,
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/catalogo/parecidos?q=${encodeURIComponent(consulta)}`, { signal });
      if (!r.ok) throw new Error('No se pudo buscar');
      return (await r.json()) as { parecidos: ProductoParecido[] };
    },
  });

  const totalCentavos = renglones.reduce((t, r) => t + aCentavos(r.importe), 0);
  const pasadoDeLaDeuda = totalCentavos > saldoCentavos;
  const listo =
    renglones.length > 0 &&
    renglones.every((r) => Number(r.cantidad) > 0 && aCentavos(r.importe) > 0) &&
    !pasadoDeLaDeuda;

  function agregar(p: ProductoParecido) {
    if (renglones.some((r) => r.productId === p.id)) return;
    setRenglones((xs) => [
      ...xs,
      {
        productId: p.id,
        nombre: p.nombre,
        cantidad: '1',
        importe: String(p.mostradorCentavos / 100),
      },
    ]);
    setTexto('');
    setConsulta('');
  }

  function registrar() {
    const datos = new FormData();
    datos.set('clienteId', clienteId);
    datos.set('nota', nota);
    datos.set(
      'renglones',
      JSON.stringify(
        renglones.map((r) => ({
          productId: r.productId,
          cantidad: Number(r.cantidad),
          montoCentavos: aCentavos(r.importe),
        })),
      ),
    );
    enTransicion(async () => {
      const r = await registrarDevolucionAccion({}, datos);
      setEstado(r);
      if (r.ok) {
        setRenglones([]);
        setNota('');
        setAbierto(false);
      }
    });
  }

  if (!abierto) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="min-h-11 rounded-(--radius-caja) border-[1.5px] border-(--color-borde) px-3 text-sm font-medium"
        >
          Devolvió mercadería
        </button>
        {/*
          Recién registrada, el papel es lo que sigue: el cliente está
          enfrente esperando algo en la mano. Va acá y no en la lista de
          movimientos para no hacerlo buscar el renglón que acaba de crear.
        */}
        {estado.ok ? (
          <p role="status" className="mt-1 text-sm font-semibold text-(--color-ok)">
            {estado.ok}{' '}
            <a
              href={`/comprobante/${clienteId}/${fechaLocalISO()}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Imprimir comprobante
            </a>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-(--radius-caja) bg-(--color-papel) p-3">
      <p className="text-sm">
        Lo que <strong>{nombre}</strong> trajo de vuelta. Vuelve al stock y se le descuenta de la
        deuda. <strong>No es un pago:</strong> no entra plata a la caja.
      </p>

      <div>
        <label htmlFor={`buscar-dev-${clienteId}`} className="mb-1 block text-xs font-medium">
          Buscar el producto que devolvió
        </label>
        <input
          id={`buscar-dev-${clienteId}`}
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoFocus
          placeholder="Termo, caja fuerte, JBL…"
          className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-3"
        />
      </div>

      {(data?.parecidos ?? []).length > 0 ? (
        <ul className="flex flex-col gap-1">
          {data!.parecidos.slice(0, 6).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => agregar(p)}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-3 text-left text-sm"
              >
                <span>{p.nombre}</span>
                <span className="tabular shrink-0 text-(--color-tinta-suave)">
                  {formatearARS(p.mostradorCentavos)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {renglones.length > 0 ? (
        <ul className="flex flex-col gap-2 border-t border-(--color-borde) pt-2">
          {renglones.map((r, i) => (
            <li key={r.productId} className="flex flex-wrap items-end gap-2">
              <span className="min-w-32 flex-1 text-sm font-medium">{r.nombre}</span>
              <div>
                <label
                  htmlFor={`cant-${r.productId}`}
                  className="mb-0.5 block text-xs text-(--color-tinta-suave)"
                >
                  Unidades
                </label>
                <input
                  id={`cant-${r.productId}`}
                  type="number"
                  min={1}
                  value={r.cantidad}
                  onChange={(e) =>
                    setRenglones((xs) =>
                      xs.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)),
                    )
                  }
                  className="tabular min-h-11 w-20 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-center"
                />
              </div>
              <div>
                <label
                  htmlFor={`imp-${r.productId}`}
                  className="mb-0.5 block text-xs text-(--color-tinta-suave)"
                >
                  Se le descuenta
                </label>
                <input
                  id={`imp-${r.productId}`}
                  type="text"
                  inputMode="decimal"
                  value={r.importe}
                  onChange={(e) =>
                    setRenglones((xs) =>
                      xs.map((x, j) => (j === i ? { ...x, importe: e.target.value } : x)),
                    )
                  }
                  className="tabular min-h-11 w-28 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-right"
                />
              </div>
              <button
                type="button"
                onClick={() => setRenglones((xs) => xs.filter((_, j) => j !== i))}
                aria-label={`Sacar ${r.nombre}`}
                className="min-h-11 rounded-(--radius-caja) border border-(--color-borde) px-3 text-sm"
              >
                Sacar
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {totalCentavos > 0 ? (
        <p
          className={`rounded-(--radius-caja) px-3 py-2 text-sm ${
            pasadoDeLaDeuda ? 'bg-(--color-error-fondo)' : 'bg-(--color-panel)'
          }`}
        >
          Se le descuentan <strong className="tabular">{formatearARS(totalCentavos)}</strong>.{' '}
          {pasadoDeLaDeuda ? (
            <>
              Es más de lo que debe ({formatearARS(saldoCentavos)}). Si el local le queda debiendo
              plata, eso se resuelve aparte: descontá hasta donde llega la deuda.
            </>
          ) : (
            <>
              Va a quedar debiendo{' '}
              <strong className="tabular">{formatearARS(saldoCentavos - totalCentavos)}</strong>.
            </>
          )}
        </p>
      ) : null}

      <div>
        <label htmlFor={`nota-dev-${clienteId}`} className="mb-1 block text-xs font-medium">
          Nota (opcional)
        </label>
        <input
          id={`nota-dev-${clienteId}`}
          type="text"
          maxLength={200}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Ej.: trajo lo que no vendió"
          className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
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
          className="min-h-11 flex-1 rounded-(--radius-caja) border border-(--color-borde) text-sm font-medium"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={registrar}
          disabled={!listo || enCurso}
          className="min-h-11 flex-1 rounded-(--radius-caja) bg-(--color-marca) text-sm font-semibold text-(--color-marca-texto) disabled:opacity-60"
        >
          {enCurso ? 'Registrando…' : 'Registrar la devolución'}
        </button>
      </div>
    </div>
  );
}
