'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatearARS } from '@/lib/dinero';
import { MINIMO_PARA_PARECIDOS, type ProductoParecido } from '@/catalogo/crear';

const ESPERA_MS = 250;

export interface Elegido {
  productId: string;
  nombre: string;
  precioCentavos: number;
  cantidad: number;
}

/**
 * Lo que el cliente se lleva a cambio de lo que trajo.
 *
 * Va en la misma pantalla que la devolución porque es el renglón siguiente de
 * la misma conversación con el cliente: «esto vuelve, y me llevo esto otro».
 * Separarlo en dos pantallas es lo que hacía que quedaran dos operaciones
 * sueltas, y que a veces se hiciera una sola.
 *
 * El precio que se muestra es el de mostrador de hoy. El definitivo lo pone el
 * servidor al grabar, con el mismo cálculo que una venta: acá es para que
 * quien atiende vea la diferencia antes de cobrarla.
 */
export default function SeLleva({
  elegidos,
  onCambiar,
}: {
  elegidos: Elegido[];
  onCambiar: (xs: Elegido[]) => void;
}) {
  const [texto, setTexto] = useState('');
  const [consulta, setConsulta] = useState('');

  useEffect(() => {
    const reloj = setTimeout(() => setConsulta(texto.trim()), ESPERA_MS);
    return () => clearTimeout(reloj);
  }, [texto]);

  const { data } = useQuery({
    queryKey: ['cambio-buscar', consulta],
    enabled: consulta.length >= MINIMO_PARA_PARECIDOS,
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/catalogo/parecidos?q=${encodeURIComponent(consulta)}`, {
        signal,
      });
      if (!r.ok) throw new Error('No se pudo buscar');
      return (await r.json()) as { parecidos: ProductoParecido[] };
    },
  });

  function agregar(p: ProductoParecido) {
    if (elegidos.some((e) => e.productId === p.id)) return;
    onCambiar([
      ...elegidos,
      {
        productId: p.id,
        nombre: p.nombre,
        precioCentavos: p.mostradorCentavos,
        cantidad: 1,
      },
    ]);
    setTexto('');
    setConsulta('');
  }

  return (
    <div className="space-y-2 rounded-(--radius-caja) bg-(--color-papel) p-3">
      <div>
        <label htmlFor="buscar-cambio" className="mb-1 block text-sm font-medium">
          ¿Se lleva algo a cambio?
        </label>
        <input
          id="buscar-cambio"
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscá lo que se lleva…"
          className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-3"
        />
        <p className="mt-1 text-xs text-(--color-tinta-suave)">
          Dejalo vacío si solo devuelve y se le da la plata.
        </p>
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

      {elegidos.length > 0 ? (
        <ul className="flex flex-col gap-2 border-t border-(--color-borde) pt-2">
          {elegidos.map((e, i) => (
            <li key={e.productId} className="flex flex-wrap items-end gap-2">
              <span className="min-w-32 flex-1 text-sm font-medium">{e.nombre}</span>
              <div>
                <label
                  htmlFor={`lleva-${e.productId}`}
                  className="mb-0.5 block text-xs text-(--color-tinta-suave)"
                >
                  Unidades
                </label>
                <input
                  id={`lleva-${e.productId}`}
                  type="number"
                  min={1}
                  value={e.cantidad}
                  onChange={(ev) =>
                    onCambiar(
                      elegidos.map((x, j) =>
                        j === i ? { ...x, cantidad: Number(ev.target.value) || 0 } : x,
                      ),
                    )
                  }
                  className="tabular min-h-11 w-20 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-center"
                />
              </div>
              <span className="tabular min-h-11 leading-[2.75rem] font-semibold">
                {formatearARS(e.precioCentavos * Math.max(0, e.cantidad))}
              </span>
              <button
                type="button"
                onClick={() => onCambiar(elegidos.filter((_, j) => j !== i))}
                aria-label={`Sacar ${e.nombre}`}
                className="min-h-11 rounded-(--radius-caja) border border-(--color-borde) px-3 text-sm"
              >
                Sacar
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
