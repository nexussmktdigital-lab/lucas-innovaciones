'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import {
  crearProductoAccion,
  sugerirFichaAccion,
  type EstadoAlta,
  type EstadoSugerencia,
} from '@/app/acciones-catalogo';

const INICIAL: EstadoAlta = {};
const SIN_SUGERENCIA: EstadoSugerencia = {};

/**
 * Alta rapida de un producto.
 *
 * Esta pantalla se abre con un cliente esperando del otro lado del mostrador,
 * asi que el orden es el de la cabeza de quien atiende: que es, cuanto sale,
 * cuantos hay. Categoria y marca vienen despues y se pueden saltear.
 *
 * Arriba hay un renglon para tirar lo que uno escribiria apurado —«cable tipo c
 * fox box axon 20w»— y que el sistema lo acomode. Es opcional en los dos
 * sentidos: se puede ignorar, y si no hay credencial cargada no aparece.
 */
export default function FormularioAlta({
  categorias,
  marcas,
  conAyuda,
  nombreInicial,
}: {
  categorias: string[];
  marcas: string[];
  conAyuda: boolean;
  nombreInicial: string;
}) {
  const [estado, accion, pendiente] = useActionState(crearProductoAccion, INICIAL);
  const [sugerencia, sugerir, sugiriendo] = useActionState(sugerirFichaAccion, SIN_SUGERENCIA);

  const [nombre, setNombre] = useState(nombreInicial);
  const [categoria, setCategoria] = useState('');
  const [marca, setMarca] = useState('');
  const [esServicio, setEsServicio] = useState(false);

  // La sugerencia no se aplica sola: se muestra y se acepta. Nadie quiere ver
  // cómo le reescriben lo que estaba tipeando.
  const propuesta = sugerencia.ficha;

  function aceptarPropuesta() {
    if (!propuesta) return;
    setNombre(propuesta.nombre);
    setCategoria(propuesta.categoria ?? '');
    setMarca(propuesta.marca ?? '');
    setEsServicio(propuesta.esServicio);
  }

  if (estado.ok && estado.creado) {
    return (
      <div className="space-y-4">
        <div className="rounded-(--radius-caja) bg-(--color-ok-fondo) p-4">
          <p role="status" className="font-semibold text-(--color-ok)">
            {estado.ok}
          </p>
          {estado.creado.sku ? (
            <p className="tabular mt-1 text-sm text-(--color-tinta-suave)">
              SKU {estado.creado.sku}
            </p>
          ) : null}
          {estado.notaInterna ? (
            <p className="mt-2 rounded-(--radius-caja) bg-(--color-papel) p-2 text-sm">
              Del nombre se sacó una anotación y quedó guardada aparte:{' '}
              <strong>{estado.notaInterna}</strong>
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/vender"
            className="min-h-12 flex-1 rounded-(--radius-caja) bg-(--color-marca) px-4 text-center leading-[3rem] font-semibold text-(--color-marca-texto)"
          >
            Venderlo ahora
          </Link>
          <Link
            href="/catalogo/nuevo"
            className="min-h-12 flex-1 rounded-(--radius-caja) border border-(--color-borde) px-4 text-center leading-[3rem] font-medium"
          >
            Cargar otro
          </Link>
        </div>

        <p className="text-sm text-(--color-tinta-suave)">
          Queda vendible en el local y fuera de la tienda online. Para publicarlo en la web,
          completá la ficha desde el{' '}
          <Link href="/catalogo" className="underline underline-offset-2">
            catálogo
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {conAyuda ? (
        <form
          action={sugerir}
          aria-label="Armar la ficha desde una descripción"
          className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-3"
        >
          <label htmlFor="crudo" className="mb-1 block text-sm font-medium">
            Escribilo como te salga
          </label>
          <div className="flex gap-2">
            <input
              id="crudo"
              name="crudo"
              type="text"
              defaultValue={nombreInicial}
              placeholder="cable tipo c fox box axon 20w"
              className="min-h-11 flex-1 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3"
            />
            <button
              type="submit"
              disabled={sugiriendo}
              className="min-h-11 shrink-0 rounded-(--radius-caja) border-2 border-(--color-marca) px-3 font-semibold disabled:opacity-60"
            >
              {sugiriendo ? 'Pensando…' : 'Acomodalo'}
            </button>
          </div>

          <p className="mt-1 text-xs text-(--color-tinta-suave)">
            Propone nombre, marca y categoría. El precio y el stock los ponés vos.
          </p>

          {sugerencia.error ? (
            <p role="alert" className="mt-2 text-sm text-(--color-error)">
              {sugerencia.error}
            </p>
          ) : null}

          {propuesta ? (
            <div className="mt-2 rounded-(--radius-caja) bg-(--color-papel) p-3 text-sm">
              <p className="font-medium">{propuesta.nombre}</p>
              <p className="text-(--color-tinta-suave)">
                {propuesta.marca ?? 'sin marca'} · {propuesta.categoria ?? 'sin categoría'}
                {propuesta.esServicio ? ' · es un servicio' : ''}
              </p>
              {propuesta.confianza !== 'alta' ? (
                <p className="mt-1 text-xs text-(--color-alerta-tinta)">
                  No está seguro de esta lectura. Revisala antes de guardar.
                </p>
              ) : null}
              <button
                type="button"
                onClick={aceptarPropuesta}
                className="mt-2 min-h-10 w-full rounded-(--radius-caja) border border-(--color-marca) font-medium"
              >
                Usar esto
              </button>
            </div>
          ) : null}
        </form>
      ) : null}

      <form
        action={accion}
        aria-label="Cargar un producto"
        className="space-y-3 rounded-(--radius-caja) border-2 border-(--color-borde) bg-(--color-panel) p-4"
      >
        <div>
          <label htmlFor="nombre" className="mb-1 block text-sm font-medium">
            Qué es
          </label>
          <input
            id="nombre"
            name="nombre"
            type="text"
            required
            maxLength={200}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            autoFocus
            placeholder="Cable USB tipo C FoxBox Axon 20W"
            className="min-h-12 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 text-lg"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="precio" className="mb-1 block text-sm font-medium">
              Cuánto sale en el local
            </label>
            <input
              id="precio"
              name="precio"
              type="text"
              inputMode="decimal"
              required
              placeholder="9000"
              className="tabular min-h-12 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 text-right text-lg"
            />
          </div>

          <div>
            <label htmlFor="stock" className="mb-1 block text-sm font-medium">
              Cuántos hay
            </label>
            <input
              id="stock"
              name="stock"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              disabled={esServicio}
              placeholder="0"
              className="tabular min-h-12 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 text-right text-lg disabled:opacity-50"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="categoria" className="mb-1 block text-sm font-medium">
              Categoría
            </label>
            <input
              id="categoria"
              name="categoria"
              type="text"
              list="categorias-del-catalogo"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="Cables de carga"
              className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3"
            />
            <datalist id="categorias-del-catalogo">
              {categorias.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor="marca" className="mb-1 block text-sm font-medium">
              Marca
            </label>
            <input
              id="marca"
              name="marca"
              type="text"
              list="marcas-del-catalogo"
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              placeholder="FoxBox"
              className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3"
            />
            <datalist id="marcas-del-catalogo">
              {marcas.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <label htmlFor="costo" className="mb-1 block text-sm font-medium">
            Cuánto te costó (opcional)
          </label>
          <input
            id="costo"
            name="costo"
            type="text"
            inputMode="decimal"
            placeholder="0"
            className="tabular min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3 text-right"
          />
          <p className="mt-1 text-xs text-(--color-tinta-suave)">
            Es lo único que hace posible el reporte de ganancia. Queda guardado acá, nunca sale a
            la tienda.
          </p>
        </div>

        <div>
          <label htmlFor="codigoBarras" className="mb-1 block text-sm font-medium">
            Código de barras (opcional)
          </label>
          <input
            id="codigoBarras"
            name="codigoBarras"
            type="text"
            maxLength={60}
            placeholder="Pasá el lector por acá"
            className="tabular min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-3"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="esServicio"
            checked={esServicio}
            onChange={(e) => setEsServicio(e.target.checked)}
            className="size-5"
          />
          Es un servicio, no mercadería: no lleva stock y el precio se escribe al vender
        </label>

        {estado.error ? (
          <p role="alert" className="text-sm font-medium text-(--color-error)">
            {estado.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pendiente}
          className="min-h-12 w-full rounded-(--radius-caja) bg-(--color-marca) font-semibold text-(--color-marca-texto) disabled:opacity-60"
        >
          {pendiente ? 'Cargando…' : 'Cargar y poder venderlo'}
        </button>

        <p className="text-xs text-(--color-tinta-suave)">
          El SKU se arma solo siguiendo la convención del catálogo. El producto queda vendible en
          el local; publicarlo en la tienda online es un paso aparte.
        </p>
      </form>
    </div>
  );
}
