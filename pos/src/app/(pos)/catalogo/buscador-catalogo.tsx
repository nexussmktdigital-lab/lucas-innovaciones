'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { formatearARS } from '@/lib/dinero';
import { MINIMO_PARA_PARECIDOS, type ProductoParecido } from '@/catalogo/crear';
import SumarStock from './nuevo/sumar-stock';

const ESPERA_MS = 250;

/**
 * Buscador del catálogo.
 *
 * La pantalla de Catálogo servía para ver lo que está mal cargado, y para
 * encontrar **un** producto no servía: había que mirar una lista de sesenta
 * fichas ordenadas por gravedad. Lo que se necesita en el mostrador es otra
 * cosa: «¿está el cargador de 20W?», y si está, sumarle las dos que llegaron.
 *
 * Usa la misma consulta que el aviso de duplicados del alta —`buscarParecidos`,
 * que trae también los inactivos— por el mismo motivo: acá el inactivo es
 * exactamente lo que hay que poder encontrar, porque es el que no aparece al
 * vender y hace creer que no existe.
 *
 * Y si no está, el botón de cargarlo arrastra lo que ya se escribió. Nadie
 * debería tener que acordarse de dónde era para cargar un producto y venderlo
 * ahora mismo: se escribe el nombre, y el camino aparece solo.
 */
export default function BuscadorCatalogo({
  puedeSumarStock,
  puedeReactivar,
  puedeCargar,
}: {
  puedeSumarStock: boolean;
  puedeReactivar: boolean;
  puedeCargar: boolean;
}) {
  const [texto, setTexto] = useState('');
  const [consulta, setConsulta] = useState('');
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const reloj = setTimeout(() => setConsulta(texto.trim()), ESPERA_MS);
    return () => clearTimeout(reloj);
  }, [texto]);

  const { data, isFetching } = useQuery({
    queryKey: ['catalogo-buscar', consulta],
    enabled: consulta.length >= MINIMO_PARA_PARECIDOS,
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/catalogo/parecidos?q=${encodeURIComponent(consulta)}`, {
        signal,
      });
      if (!r.ok) throw new Error('No se pudo buscar');
      return (await r.json()) as { parecidos: ProductoParecido[] };
    },
  });

  const resultados = data?.parecidos ?? [];
  const buscando = consulta.length >= MINIMO_PARA_PARECIDOS;

  return (
    <section
      aria-label="Buscar en el catálogo"
      className="rounded-(--radius-caja) border-2 border-(--color-borde) bg-(--color-panel) p-4"
    >
      <label htmlFor="buscar-catalogo" className="mb-1 block text-sm font-medium">
        Buscar un producto
      </label>
      <input
        id="buscar-catalogo"
        ref={campo}
        type="search"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        autoFocus
        placeholder="Samsung A15, cargador 20W, vidrio templado…"
        className="min-h-12 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 text-lg"
      />
      <p className="mt-1 text-xs text-(--color-tinta-suave)">
        Por nombre, SKU o marca. Aparecen también los que están inactivos.
      </p>

      {buscando && resultados.length === 0 && !isFetching ? (
        <div className="mt-3 rounded-(--radius-caja) bg-(--color-papel) p-4 text-center text-sm">
          <p className="text-(--color-tinta-suave)">No hay nada que coincida con «{consulta}».</p>
          {puedeCargar ? (
            <Link
              href={`/catalogo/nuevo?q=${encodeURIComponent(consulta)}`}
              className="mt-3 inline-block min-h-11 rounded-(--radius-caja) border-2 border-(--color-marca) px-4 leading-[2.75rem] font-semibold"
            >
              Cargar «{consulta}» al catálogo
            </Link>
          ) : null}
        </div>
      ) : null}

      {resultados.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {resultados.map((p) => (
            <li
              key={p.id}
              className="rounded-(--radius-caja) border border-(--color-borde) p-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-medium">{p.nombre}</span>
                {p.sku ? (
                  <span className="tabular text-xs text-(--color-tinta-suave)">SKU {p.sku}</span>
                ) : null}
                <span className="cifra ml-auto">{formatearARS(p.precioCentavos)}</span>
              </div>

              <p className="mt-0.5 text-xs text-(--color-tinta-suave)">
                {p.activo ? (
                  p.gestionaStock ? (
                    <>Quedan {p.stock}</>
                  ) : (
                    <>Sin control de stock</>
                  )
                ) : (
                  <strong className="font-semibold text-(--color-alerta-tinta)">
                    Inactivo — no aparece al vender
                  </strong>
                )}
              </p>

              {puedeSumarStock && p.gestionaStock ? (
                <div className="pt-2">
                  <SumarStock
                    productId={p.id}
                    activo={p.activo}
                    puedeReactivar={puedeReactivar}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
