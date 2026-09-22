import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { PLANILLA_DE_EJEMPLO, TOPE_RENGLONES } from '@/catalogo/importar';
import FormularioImportar from './formulario-importar';

export const dynamic = 'force-dynamic';

/**
 * Importar una entrega de mercadería.
 *
 * Es del dueño: una planilla carga treinta productos con sus precios de una
 * sola vez, y eso es una decisión de catálogo, no de mostrador.
 */
export default async function PaginaImportar() {
  const sesion = await auth();
  if (!sesion?.user) redirect('/ingresar');
  if (sesion.user.rol !== 'owner') redirect('/');

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/catalogo" className="text-sm underline underline-offset-2">
          ← Catálogo
        </Link>
        <h1 className="mt-1 font-titulo text-2xl font-bold tracking-tight">Importar una planilla</h1>
        <p className="mt-1 text-sm text-(--color-tinta-suave)">
          Para cuando llega una entrega entera. Hasta {TOPE_RENGLONES} renglones por vez.
        </p>
      </div>

      <FormularioImportar ejemplo={PLANILLA_DE_EJEMPLO} />

      <div className="rounded-(--radius-caja) border border-(--color-borde) p-3 text-sm text-(--color-tinta-suave)">
        <p className="mb-1 font-medium text-(--color-tinta)">Dos cosas que conviene saber</p>
        <p>
          <strong>Da de alta, no pisa lo que ya está.</strong> Un producto que ya existe se
          informa y se saltea. Los precios de lo que ya tenés se cambian en{' '}
          <Link href="/precios" className="underline underline-offset-2">
            Precios
          </Link>
          , que es donde están los controles.
        </p>
        <p className="mt-1">
          <strong>Todo entra como de mostrador.</strong> Lo importado se vende en el local y no
          sale a la tienda online hasta que alguien complete la ficha y lo publique.
        </p>
      </div>
    </div>
  );
}
