import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { puede } from '@/auth/permisos';
import { PLANILLA_DE_EJEMPLO, TOPE_RENGLONES } from '@/catalogo/importar';
import { LISTA_DE_EJEMPLO } from '@/catalogo/entrega';
import FormularioImportar from './formulario-importar';

export const dynamic = 'force-dynamic';

/**
 * Importar una entrega de mercadería.
 *
 * La puede usar el vendedor. Es la pantalla de mayor alcance que se le abrió
 * —una lista toca treinta fichas de una vez— y se abrió igual porque cargar
 * mercadería que acaba de llegar es atender el mostrador, y hacerlo de a una
 * ficha o de a treinta es la misma tarea con distinto volumen. Lo que la cuida
 * es que muestra todo antes de escribir y que queda en la bitácora.
 */
export default async function PaginaImportar() {
  const sesion = await auth();
  if (!sesion?.user) redirect('/ingresar');
  if (!sesion?.user || !puede(sesion.user.rol, 'producto.editar')) redirect('/');

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/catalogo" className="text-sm underline underline-offset-2">
          ← Catálogo
        </Link>
        <h1 className="mt-1 font-titulo text-2xl font-bold tracking-tight">Cargar una entrega</h1>
        <p className="mt-1 text-sm text-(--color-tinta-suave)">
          Pegá la lista como la escribiste, o la planilla tal cual sale de Excel. Hasta{' '}
          {TOPE_RENGLONES} renglones por vez.
        </p>
      </div>

      <FormularioImportar ejemploPlanilla={PLANILLA_DE_EJEMPLO} ejemploLista={LISTA_DE_EJEMPLO} />

      <div className="rounded-(--radius-caja) border border-(--color-borde) p-3 text-sm text-(--color-tinta-suave)">
        <p className="mb-1 font-medium text-(--color-tinta)">Dos cosas que conviene saber</p>
        <p>
          <strong>No pisa precios.</strong> A un producto que ya existe se le suman las unidades
          que llegaron y su precio queda como está, incluso si la lista trae otro. Para cambiarlo,
          «Cambiar precio» desde el{' '}
          <Link href="/catalogo" className="underline underline-offset-2">
            catálogo
          </Link>{' '}
          o{' '}
          <Link href="/precios" className="underline underline-offset-2">
            Precios
          </Link>
          .
        </p>
        <p className="mt-1">
          <strong>Una baja no borra nada.</strong> El producto deja de aparecer al vender y pasa a
          borrador en la tienda. Las ventas viejas y la rentabilidad de los meses pasados siguen
          intactas, y se puede volver a activar.
        </p>
        <p className="mt-1">
          <strong>Todo entra como de mostrador.</strong> Lo importado se vende en el local y no
          sale a la tienda online hasta que alguien complete la ficha y lo publique.
        </p>
      </div>
    </div>
  );
}
