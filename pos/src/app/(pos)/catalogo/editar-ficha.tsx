'use client';

import { useState, useTransition } from 'react';
import {
  editarProductoAccion,
  eliminarProductoAccion,
  motivosParaNoEliminarAccion,
  type EstadoStock,
} from '@/app/acciones-catalogo';
import { formatearARS } from '@/lib/dinero';
import type { ProductoParecido } from '@/catalogo/crear';

/**
 * La ficha completa, detrás del lápiz.
 *
 * Arreglar un producto mal cargado era un recorrido: el precio por un botón,
 * el stock por otro, el nombre por ningún lado y el costo solo al darlo de
 * alta. Esto es lo que se pidió desde el mostrador: abrir la ficha y corregir
 * lo que esté mal, ahí mismo.
 *
 * **El precio no está acá.** Sigue en su botón, que ya sabe de dólares,
 * cotización y del recargo de la tienda. Tenerlo en dos lugares sería tener
 * dos verdades sobre el número más delicado de la pantalla.
 *
 * **El stock se suma o se resta, no se escribe.** Escribir «12» donde hay 15
 * no dice qué pasó con las tres, y el libro de stock se lee después para
 * entender justamente eso. Un ajuste lleva su motivo y queda como asiento.
 *
 * **El aviso sube al padre** por lo mismo que en la baja: al guardar, la lista
 * se vuelve a dibujar y este componente se cierra. Un mensaje puesto acá
 * adentro se borraría en el mismo instante en que hay algo para avisar.
 */
export default function EditarFicha({
  producto,
  puedeBorrar,
  onListo,
}: {
  producto: ProductoParecido;
  /** El borrado del todo es del dueño: no se deshace. */
  puedeBorrar: boolean;
  onListo: (mensaje: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState(producto.nombre);
  const [costo, setCosto] = useState(
    producto.costoCentavos === null ? '' : String(producto.costoCentavos / 100),
  );
  const [ajuste, setAjuste] = useState('');
  const [sentido, setSentido] = useState<'sumar' | 'restar'>('sumar');
  const [motivo, setMotivo] = useState('');
  const [estado, setEstado] = useState<EstadoStock>({});
  const [enCurso, enTransicion] = useTransition();

  // El borrado se pregunta al abrirlo, no al apretarlo: un botón que siempre
  // falla es peor que no tener botón.
  const [motivos, setMotivos] = useState<string[] | null>(null);
  const [borrando, setBorrando] = useState(false);

  function abrir() {
    setAbierto(true);
    setEstado({});
    if (puedeBorrar && motivos === null) {
      void motivosParaNoEliminarAccion(producto.id).then(setMotivos);
    }
  }

  function guardar() {
    const datos = new FormData();
    datos.set('productId', producto.id);
    datos.set('nombre', nombre);
    datos.set('costo', costo);
    datos.set('ajuste', ajuste);
    datos.set('sentido', sentido);
    datos.set('motivoAjuste', motivo);
    enTransicion(async () => {
      const r = await editarProductoAccion({}, datos);
      setEstado(r);
      if (r.ok && !r.error) {
        setAbierto(false);
        setAjuste('');
        setMotivo('');
        onListo(r.ok);
      }
    });
  }

  function borrar() {
    const datos = new FormData();
    datos.set('productId', producto.id);
    enTransicion(async () => {
      const r = await eliminarProductoAccion({}, datos);
      setEstado(r);
      setBorrando(false);
      if (r.ok) {
        setAbierto(false);
        onListo(r.ok);
      }
    });
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={abrir}
        aria-label={`Editar ${producto.nombre}`}
        className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) px-3 text-sm font-medium"
      >
        {/* Un lápiz, en el mismo trazo que el resto de la pantalla: el POS usa
            símbolos monocromos (✕, ▲) y no emoji de color. */}
        ✎ Editar
      </button>
    );
  }

  const stockFinal =
    ajuste === '' || !Number.isFinite(Number(ajuste))
      ? null
      : sentido === 'restar'
        ? producto.stock - Number(ajuste)
        : producto.stock + Number(ajuste);

  return (
    <div className="space-y-3 rounded-(--radius-caja) bg-(--color-papel) p-3">
      <div>
        <label htmlFor={`nombre-${producto.id}`} className="mb-1 block text-xs font-medium">
          Nombre
        </label>
        <input
          id={`nombre-${producto.id}`}
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          maxLength={200}
          className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
        />
        {producto.enLaTienda ? (
          <p className="mt-1 text-xs text-(--color-tinta-suave)">
            Este producto también está en la tienda online: el nombre nuevo se le manda, así la
            próxima sincronización no lo vuelve atrás.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`costo-${producto.id}`} className="mb-1 block text-xs font-medium">
            Costo
          </label>
          <input
            id={`costo-${producto.id}`}
            type="text"
            inputMode="decimal"
            value={costo}
            onChange={(e) => setCosto(e.target.value)}
            placeholder="vacío = no se sabe"
            className="tabular min-h-11 w-32 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-right"
          />
        </div>
        <p className="pb-3 text-xs text-(--color-tinta-suave)">
          Lo que te costó a vos. Se vende a {formatearARS(producto.mostradorCentavos)}.
        </p>
      </div>

      {producto.gestionaStock ? (
        <div className="border-t border-(--color-borde) pt-3">
          <p className="mb-1 text-xs font-medium">Ajustar el stock (quedan {producto.stock})</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex gap-1" role="group" aria-label="Sumar o restar">
              {(['sumar', 'restar'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSentido(s)}
                  aria-pressed={sentido === s}
                  className={`min-h-11 rounded-(--radius-caja) border px-3 text-sm font-medium ${
                    sentido === s
                      ? 'border-(--color-marca) bg-(--color-marca) text-(--color-marca-texto)'
                      : 'border-(--color-borde)'
                  }`}
                >
                  {s === 'sumar' ? '+ Sumar' : '− Restar'}
                </button>
              ))}
            </div>
            <div>
              <label htmlFor={`ajuste-${producto.id}`} className="sr-only">
                Unidades del ajuste
              </label>
              <input
                id={`ajuste-${producto.id}`}
                type="number"
                min={1}
                value={ajuste}
                onChange={(e) => setAjuste(e.target.value)}
                placeholder="0"
                className="tabular min-h-11 w-20 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-center"
              />
            </div>
            <div className="min-w-40 flex-1">
              <label htmlFor={`motivo-${producto.id}`} className="sr-only">
                Motivo del ajuste
              </label>
              <input
                id={`motivo-${producto.id}`}
                type="text"
                maxLength={200}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivo: se rompió, llegó una entrega…"
                className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-sm"
              />
            </div>
          </div>
          {stockFinal !== null ? (
            <p
              className={`mt-1 text-xs ${
                stockFinal < 0 ? 'font-semibold text-(--color-error)' : 'text-(--color-tinta-suave)'
              }`}
            >
              {stockFinal < 0
                ? `Quedarían ${stockFinal}: un ajuste a mano no puede dejar el stock en negativo.`
                : `Van a quedar ${stockFinal}.`}
            </p>
          ) : null}
        </div>
      ) : null}

      {estado.error ? (
        <p role="alert" className="text-sm font-medium text-(--color-error)">
          {estado.error}
        </p>
      ) : null}
      {estado.ok && estado.error ? (
        <p role="status" className="text-sm text-(--color-ok)">
          {estado.ok}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="min-h-11 flex-1 rounded-(--radius-caja) border border-(--color-borde) text-sm font-medium"
        >
          Cerrar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={enCurso}
          className="min-h-11 flex-1 rounded-(--radius-caja) bg-(--color-marca) text-sm font-semibold text-(--color-marca-texto) disabled:opacity-60"
        >
          {enCurso ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      {/* El borrado del todo, al final y separado: no es lo que se viene a
          hacer acá, y no se deshace. */}
      {puedeBorrar ? (
        <div className="border-t border-(--color-borde) pt-3">
          {motivos === null ? (
            <p className="text-xs text-(--color-tinta-suave)">Viendo si se puede borrar…</p>
          ) : motivos.length > 0 ? (
            <p className="text-xs text-(--color-tinta-suave)">
              <strong>No se puede borrar del todo.</strong> {motivos.join(' ')} Para esto está
              «Sacar del catálogo», que lo deja fuera de la venta sin perder nada.
            </p>
          ) : borrando ? (
            <div className="rounded-(--radius-caja) bg-(--color-alerta-fondo) p-3">
              <p className="text-sm">
                <strong>¿Borrar «{producto.nombre}» del todo?</strong> No queda ficha y no se puede
                deshacer. Si alguna vez querés volver a verlo, lo que corresponde es sacarlo del
                catálogo.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setBorrando(false)}
                  className="min-h-11 flex-1 rounded-(--radius-caja) border border-(--color-borde) text-sm font-medium"
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={borrar}
                  disabled={enCurso}
                  className="min-h-11 flex-1 rounded-(--radius-caja) border-2 border-(--color-error) text-sm font-semibold text-(--color-error) disabled:opacity-60"
                >
                  {enCurso ? 'Borrando…' : 'Sí, borrarlo'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setBorrando(true)}
              className="min-h-10 text-sm font-medium text-(--color-error) underline underline-offset-2"
            >
              Borrar del todo
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
