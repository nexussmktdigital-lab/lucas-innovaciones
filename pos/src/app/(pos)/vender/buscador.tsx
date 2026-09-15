'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ResultadoBusqueda } from '@/ventas/buscar';
import { formatearARS, formatearUSD } from '@/lib/dinero';

interface Props {
  onAgregar: (r: ResultadoBusqueda) => void;
  registrarFoco: (fn: () => void) => void;
  tcCentavos: number | null;
  /** True si quien atiende puede dar de alta lo que no encuentra. */
  puedeCargar: boolean;
}

/** Espera antes de consultar, para no pedir una búsqueda por tecla. */
const ESPERA_MS = 120;

export default function Buscador({ onAgregar, registrarFoco, tcCentavos, puedeCargar }: Props) {
  const [texto, setTexto] = useState('');
  const [consulta, setConsulta] = useState('');
  const [sinStock, setSinStock] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    registrarFoco(() => {
      campo.current?.focus();
      campo.current?.select();
    });
    campo.current?.focus();
  }, [registrarFoco]);

  useEffect(() => {
    const reloj = setTimeout(() => setConsulta(texto.trim()), ESPERA_MS);
    return () => clearTimeout(reloj);
  }, [texto]);

  const { data, isFetching } = useQuery({
    queryKey: ['buscar', consulta, sinStock],
    enabled: consulta.length > 0,
    queryFn: async ({ signal }) => {
      const url = `/api/buscar?q=${encodeURIComponent(consulta)}${sinStock ? '&sinStock=1' : ''}`;
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error('No se pudo buscar');
      return (await r.json()) as { resultados: ResultadoBusqueda[] };
    },
  });

  const resultados = data?.resultados ?? [];

  useEffect(() => setResaltado(0), [consulta, sinStock]);

  function agregar(r: ResultadoBusqueda) {
    onAgregar(r);
    setTexto('');
    setConsulta('');
    campo.current?.focus();
  }

  function alTeclado(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // El lector de código de barras termina con Enter: agrega el primero,
      // que con una coincidencia exacta es el que corresponde.
      const elegido = resultados[resaltado];
      if (elegido) agregar(elegido);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setResaltado((i) => Math.min(i + 1, resultados.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setResaltado((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Escape') setTexto('');
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor="buscar" className="sr-only">
          Buscar producto
        </label>
        <input
          id="buscar"
          ref={campo}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={alTeclado}
          autoComplete="off"
          spellCheck={false}
          placeholder="Buscar por nombre, SKU, marca, código de barras o IMEI…"
          className="w-full rounded-(--radius-caja) border-2 border-(--color-borde) bg-(--color-panel) px-4 py-3 text-lg focus:border-(--color-marca)"
        />
        <div className="mt-1.5 flex items-center gap-3 text-xs text-(--color-tinta-suave)">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={sinStock}
              onChange={(e) => setSinStock(e.target.checked)}
              className="size-3.5"
            />
            Incluir sin stock
          </label>
          <span>
            <kbd>↑↓</kbd> elegir · <kbd>Enter</kbd> agregar · <kbd>F2</kbd> volver acá
          </span>
          {isFetching ? <span aria-live="polite">Buscando…</span> : null}
        </div>
      </div>

      {/* El producto que no está es el momento en que la venta se traba: ninguna
          línea puede existir sin un producto real (D24). En vez de dejar a
          quien atiende sin salida, desde acá se carga, con lo que ya escribió
          puesto en el formulario. */}
      {consulta.length > 0 && resultados.length === 0 && !isFetching ? (
        <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-6 text-center text-sm">
          <p className="text-(--color-tinta-suave)">
            No hay nada que coincida con «{consulta}».
            {!sinStock ? ' Probá marcando «incluir sin stock».' : ''}
          </p>
          {puedeCargar ? (
            <a
              href={`/catalogo/nuevo?q=${encodeURIComponent(consulta)}`}
              className="mt-3 inline-block min-h-11 rounded-(--radius-caja) border-2 border-(--color-marca) px-4 leading-[2.75rem] font-semibold"
            >
              Cargar «{consulta}» al catálogo
            </a>
          ) : null}
        </div>
      ) : null}

      <ul className="flex flex-col gap-1.5">
        {resultados.map((r, i) => {
          const disponible = r.gestionaStock ? r.stock - r.stockComprometido : null;
          const enPesos =
            r.moneda === 'USD' && r.precioUsdCentavos && tcCentavos
              ? Math.round((r.precioUsdCentavos * tcCentavos) / 100 / 100_000) * 100_000
              : r.precioCentavos;

          return (
            <li key={`${r.id}:${r.variantId ?? ''}`}>
              <button
                type="button"
                onClick={() => agregar(r)}
                onMouseEnter={() => setResaltado(i)}
                className={`flex min-h-14 w-full items-center gap-3 rounded-(--radius-caja) border px-3 py-2 text-left transition ${
                  i === resaltado
                    ? 'border-(--color-marca) bg-(--color-marca)/8'
                    : 'border-(--color-borde) bg-(--color-panel)'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.nombre}</div>
                  <div className="flex flex-wrap gap-x-2 text-xs text-(--color-tinta-suave)">
                    {r.sku ? <span>{r.sku}</span> : null}
                    {r.marca ? <span>· {r.marca}</span> : null}
                    {disponible !== null ? (
                      <span className={disponible <= 1 ? 'font-semibold text-(--color-alerta)' : ''}>
                        · {disponible} en stock
                      </span>
                    ) : (
                      <span>· sin control de stock</span>
                    )}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="tabular font-semibold">{formatearARS(enPesos)}</div>
                  {r.moneda === 'USD' && r.precioUsdCentavos ? (
                    <div className="tabular text-xs text-(--color-tinta-suave)">
                      {formatearUSD(r.precioUsdCentavos)}
                    </div>
                  ) : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
