'use client';

import { Fragment, useState, type ReactNode } from 'react';

/**
 * Buscar un deudor por nombre.
 *
 * La lista está ordenada por urgencia —a quién llamar hoy— y para eso está
 * bien. Para lo otro que pasa todos los días no servía: entra alguien a pagar
 * y hay que encontrarlo entre cuarenta tarjetas ordenadas por un criterio que
 * no es su nombre.
 *
 * Filtra **en el navegador** y no con una consulta nueva. La lista ya está
 * entera en la pantalla, así que buscar no cuesta nada y el resultado aparece
 * mientras se escribe: con el cliente enfrente, un viaje al servidor por cada
 * tecla —y seis consultas más para rearmar los semáforos— es tiempo que se
 * paga en el mostrador.
 *
 * El orden no cambia al filtrar: lo que queda sigue en orden de urgencia.
 */
export default function BuscadorDeudores({
  items,
}: {
  /** Cada tarjeta con el texto por el que se la busca. */
  items: { clave: string; buscar: string; nodo: ReactNode }[];
}) {
  const [texto, setTexto] = useState('');

  const q = normalizar(texto);
  const visibles = q ? items.filter((i) => normalizar(i.buscar).includes(q)) : items;

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="buscar-deudor" className="sr-only">
          Buscar un deudor por nombre
        </label>
        <input
          id="buscar-deudor"
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por nombre o teléfono…"
          className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-3"
        />
      </div>

      {q ? (
        <p className="text-sm text-(--color-tinta-suave)" role="status">
          {visibles.length === 0
            ? 'Nadie con deuda coincide con eso.'
            : `${visibles.length} de ${items.length} ${items.length === 1 ? 'cliente' : 'clientes'}`}
        </p>
      ) : null}

      {/* Cada nodo ya trae su propio `<li>`: el fragmento solo le pone la
          clave, sin meter un elemento de más adentro de la lista. */}
      {visibles.length > 0 ? (
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          {visibles.map((i) => (
            <Fragment key={i.clave}>{i.nodo}</Fragment>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/*
 * Sin tildes y en minúscula: «ruben» tiene que encontrar a «Rubén».
 *
 * Quien escribe en la tablet del mostrador no pone tildes, y una búsqueda que
 * no encuentra a Rubén porque falta una tilde es una búsqueda que no sirve.
 */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
