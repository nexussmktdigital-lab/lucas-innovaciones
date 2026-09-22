/**
 * Una dirección que no existe dentro del POS.
 *
 * Pasa sobre todo con un enlace viejo —el comprobante de una venta que se
 * anuló, una ficha de cliente que se borró— y con la tablet, donde es fácil
 * tocar algo que ya no está. Lo importante es que no parezca un error del
 * sistema: no lo es, y la salida está a un toque.
 */
import Link from 'next/link';

export default function NoSeEncontro() {
  return (
    <div className="mx-auto max-w-lg pt-16 text-center">
      <h1 className="font-titulo text-2xl font-bold tracking-tight">Esa pantalla no existe</h1>
      <p className="mt-2 text-(--color-tinta-suave)">
        Puede ser un enlace viejo, o algo que ya no está en el sistema. No se rompió nada.
      </p>
      <Link
        href="/vender"
        className="mt-6 inline-flex min-h-12 items-center rounded-(--radius-caja) bg-(--color-marca) px-6 font-semibold text-(--color-marca-texto)"
      >
        Ir a vender
      </Link>
    </div>
  );
}
