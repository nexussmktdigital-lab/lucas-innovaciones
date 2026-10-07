'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatearARS, formatearUSD } from '@/lib/dinero';
import { MINIMO_PARA_PARECIDOS, type ProductoParecido } from '@/catalogo/crear';
import SumarStock from './sumar-stock';
import CambiarPrecio from './cambiar-precio';

/** Lo mismo que el buscador de la venta: no consultar por tecla. */
const ESPERA_MS = 250;

/**
 * Avisa, mientras se escribe el nombre, qué productos parecidos ya existen.
 *
 * El alta rápida se abre con el cliente esperando, y ahí nace el duplicado:
 * alguien carga «Funda iPhone 15» sin saber que la ficha ya está con otro
 * nombre, o que la cargó el otro vendedor hace media hora. Después hay dos
 * fichas, dos stocks, y ninguna dice la verdad.
 *
 * Es un aviso, no una traba. Puede haber dos productos parecidos de verdad —un
 * vidrio común y uno 9D— y frenar el alta con el cliente enfrente sería peor
 * que el duplicado. Solo se muestra lo que hay y quien atiende decide.
 *
 * Un producto **inactivo** también aparece, marcado: es el duplicado más
 * traicionero, porque no sale en la búsqueda de la venta y parece que no
 * existe. Reactivarlo es más barato que crear otro.
 */
export default function Parecidos({
  nombre,
  puedeSumarStock,
  puedeReactivar,
  puedeCambiarPrecio,
}: {
  nombre: string;
  /** Si no puede, el aviso igual se muestra: saber que ya existe sirve solo. */
  puedeSumarStock: boolean;
  puedeReactivar: boolean;
  puedeCambiarPrecio: boolean;
}) {
  const [consulta, setConsulta] = useState('');

  useEffect(() => {
    const reloj = setTimeout(() => setConsulta(nombre.trim()), ESPERA_MS);
    return () => clearTimeout(reloj);
  }, [nombre]);

  const { data, isFetching } = useQuery({
    queryKey: ['parecidos', consulta],
    enabled: consulta.length >= MINIMO_PARA_PARECIDOS,
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/catalogo/parecidos?q=${encodeURIComponent(consulta)}`, {
        signal,
      });
      if (!r.ok) throw new Error('No se pudo buscar');
      return (await r.json()) as {
        parecidos: ProductoParecido[];
        /** El dólar del día, para escribir un precio en dólares. */
        tcCentavos: number | null;
      };
    },
    // Lo que importa es si existe, no el stock al segundo: media hora de caché
    // evita repetir la consulta mientras se completa el resto del formulario.
    staleTime: 30 * 60 * 1000,
  });

  const parecidos = data?.parecidos ?? [];
  if (parecidos.length === 0) {
    // Sin coincidencias no se dice nada: un «no hay parecidos» permanente es
    // ruido en una pantalla que se usa apurado.
    return null;
  }

  return (
    <section
      aria-label="Productos parecidos que ya existen"
      className="rounded-(--radius-caja) bg-(--color-alerta-fondo) p-4"
    >
      <p className="text-sm font-semibold text-(--color-alerta-tinta)">
        {parecidos.length === 1
          ? 'Ya hay un producto parecido en el catálogo'
          : `Ya hay ${parecidos.length} productos parecidos en el catálogo`}
        {isFetching ? '…' : ''}
      </p>
      <p className="mt-0.5 text-sm text-(--color-tinta-media)">
        {puedeSumarStock
          ? 'Si es el mismo, sumale las unidades que llegaron acá mismo: dos fichas del mismo producto son dos stocks, y ninguno queda bien.'
          : 'Fijate si es el mismo antes de cargarlo de nuevo: dos fichas del mismo producto son dos stocks, y ninguno queda bien.'}
      </p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {parecidos.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-(--radius-caja) bg-(--color-panel) px-3 py-2"
          >
            <span className="font-medium">{p.nombre}</span>
            {p.sku ? (
              <span className="tabular text-xs text-(--color-tinta-suave)">SKU {p.sku}</span>
            ) : null}
            {/* Un producto en dólares se lee en dólares: es el precio que se
                pactó, y el de pesos lo calcula el dólar del día. */}
            <span className="cifra ml-auto text-sm">
              {p.moneda === 'USD' && p.precioUsdCentavos
                ? formatearUSD(p.precioUsdCentavos)
                : formatearARS(p.mostradorCentavos)}
            </span>
            <span className="w-full text-xs text-(--color-tinta-suave)">
              {p.activo ? (
                p.gestionaStock ? (
                  <>Quedan {p.stock}</>
                ) : (
                  <>Sin control de stock</>
                )
              ) : (
                /* El caso que más duplicados genera: no aparece al vender, así
                   que parece que no existe. */
                <strong className="font-semibold text-(--color-alerta-tinta)">
                  Está inactivo — no aparece al vender. Quizá alcanza con reactivarlo.
                </strong>
              )}
            </span>

            {/* Sumar unidades solo tiene sentido donde hay stock que llevar: en
                un producto sin control, vender no resta nada. */}
            {puedeSumarStock && p.gestionaStock ? (
              <div className="w-full pt-1">
                <SumarStock
                  productId={p.id}
                  activo={p.activo}
                  puedeReactivar={puedeReactivar}
                />
              </div>
            ) : null}

            {/* El precio sí se corrige en cualquiera, lleve stock o no: un
                servicio también aumenta. */}
            {puedeCambiarPrecio ? (
              <div className="w-full pt-1">
                <CambiarPrecio
                    productId={p.id}
                    mostradorCentavos={p.mostradorCentavos}
                    moneda={p.moneda}
                    precioUsdCentavos={p.precioUsdCentavos}
                    tcCentavos={data?.tcCentavos ?? null}
                  />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
