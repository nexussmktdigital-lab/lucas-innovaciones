'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface VentaEnLista {
  id: string;
  numero: string;
  fecha: string;
  total: string;
  cliente: string | null;
}

/**
 * Elegir la venta que se devuelve.
 *
 * Se puede escribir el numero —que es lo que trae el cliente en el ticket— o
 * elegirla de las ultimas. Lo primero es lo rapido; lo segundo es para cuando
 * el ticket se perdio, que pasa siempre.
 */
export default function Buscador({ ventas }: { ventas: VentaEnLista[] }) {
  const router = useRouter();
  const [texto, setTexto] = useState('');

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase();
    if (t === '') return ventas;
    return ventas.filter(
      (v) =>
        v.numero.toLowerCase().includes(t) || (v.cliente ?? '').toLowerCase().includes(t),
    );
  }, [texto, ventas]);

  return (
    <section aria-label="Elegir la venta" className="space-y-2">
      <label htmlFor="buscarVenta" className="block text-sm font-medium">
        De qué venta
      </label>
      <input
        id="buscarVenta"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Número del ticket o nombre del cliente"
        autoComplete="off"
        className="min-h-12 w-full rounded-(--radius-caja) border-2 border-(--color-borde) bg-(--color-panel) px-3 text-lg"
      />

      {filtradas.length === 0 ? (
        <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4 text-center text-sm text-(--color-tinta-suave)">
          Ninguna venta coincide con «{texto}».
        </p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {filtradas.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => router.push(`/devoluciones/${v.id}`)}
                className="flex min-h-12 w-full flex-wrap items-baseline gap-x-2 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-3 py-2 text-left"
              >
                <span className="tabular font-medium">{v.numero}</span>
                <span className="text-xs text-(--color-tinta-suave)">{v.fecha}</span>
                {v.cliente ? (
                  <span className="text-xs text-(--color-tinta-suave)">· {v.cliente}</span>
                ) : null}
                <span className="tabular ml-auto font-semibold">{v.total}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
