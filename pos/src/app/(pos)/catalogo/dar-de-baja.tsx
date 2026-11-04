'use client';

import { useState, useTransition } from 'react';
import { darDeBajaAccion, type EstadoStock } from '@/app/acciones-catalogo';

/**
 * Sacar un producto del catálogo, desde el buscador.
 *
 * Es la baja y no el borrado. La ficha se queda con su historial de ventas, su
 * costo y lo que aportó a la rentabilidad del mes pasado: lo que se quiere es
 * que no se venda más, no que nunca haya existido. Deja de aparecer al vender,
 * pasa a borrador en la tienda web, y se puede volver atrás con el botón que
 * aparece en su lugar.
 *
 * **Pregunta antes.** Es un botón chico en una lista de resultados, al lado de
 * otros dos que se usan todo el tiempo, y lo que hace se nota recién cuando
 * alguien va a vender el producto y no lo encuentra. Un toque sin querer no
 * puede sacar algo de la venta.
 *
 * **El aviso de que salió lo da la lista, no este botón.** Al darlo de baja la
 * ficha se vuelve a dibujar ya inactiva, y con eso este componente desaparece:
 * un mensaje puesto acá adentro se borraría en el mismo instante en que hay
 * algo para avisar. Por eso lo que devuelve el servidor sube por `onListo`.
 *
 * No usa `<form>` por lo mismo que `SumarStock`: este control puede terminar
 * dibujado dentro del formulario del alta, y HTML no anida formularios.
 */
export default function DarDeBaja({
  productId,
  nombre,
  onListo,
}: {
  productId: string;
  nombre: string;
  /**
   * Para que la lista se entere, vuelva a dibujar la ficha ya inactiva y
   * muestre el aviso. Recibe lo que contestó el servidor.
   */
  onListo: (mensaje: string) => void;
}) {
  const [preguntando, setPreguntando] = useState(false);
  const [estado, setEstado] = useState<EstadoStock>({});
  const [enCurso, enTransicion] = useTransition();

  function darDeBaja() {
    const datos = new FormData();
    datos.set('productId', productId);
    enTransicion(async () => {
      const r = await darDeBajaAccion({}, datos);
      setEstado(r);
      setPreguntando(false);
      if (r.ok) onListo(r.ok);
    });
  }

  if (!preguntando) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setPreguntando(true)}
          className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) px-3 text-sm font-medium text-(--color-tinta-suave)"
        >
          Sacar del catálogo
        </button>
        {estado.error ? (
          <p role="alert" className="mt-1 text-sm text-(--color-error)">
            {estado.error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-(--radius-caja) bg-(--color-alerta-fondo) p-3">
      <p className="text-sm">
        <strong>¿Sacar «{nombre}» del catálogo?</strong> Deja de aparecer al vender y en la tienda
        web queda como borrador. No se pierde nada de lo vendido, y se puede volver a poner.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setPreguntando(false)}
          disabled={enCurso}
          className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-3 text-sm font-medium disabled:opacity-50"
        >
          No, dejalo
        </button>
        <button
          type="button"
          onClick={darDeBaja}
          disabled={enCurso}
          className="min-h-10 rounded-(--radius-caja) bg-(--color-error) px-3 text-sm font-semibold text-(--color-marca-texto) disabled:opacity-50"
        >
          {enCurso ? 'Sacando…' : 'Sí, sacarlo'}
        </button>
      </div>
    </div>
  );
}
