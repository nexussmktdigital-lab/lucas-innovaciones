import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { categoriasDelCatalogo, marcasDelCatalogo } from '@/catalogo/crear';
import { hayAyudaDeFicha } from '@/lib/config';
import FormularioAlta from './formulario-alta';

export const dynamic = 'force-dynamic';

/**
 * Cargar un producto.
 *
 * La abre quien está atendiendo, con el cliente esperando. Por eso la puede
 * usar el vendedor y no solo el dueño: el permiso `producto.alta_rapida` ya lo
 * decía desde la fase 1.
 *
 * Se puede llegar acá desde el buscador de la venta, que pasa lo que se estaba
 * buscando en `?q=`: si el producto no existe, el camino natural es cargarlo,
 * no volver a empezar.
 */
export default async function PaginaNuevoProducto({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sesion = await auth();
  if (!sesion?.user) redirect('/ingresar');
  if (!puede(sesion.user.rol, 'producto.alta_rapida')) redirect('/');

  const { q } = await searchParams;

  const [categorias, marcas] = await Promise.all([
    categoriasDelCatalogo(db),
    marcasDelCatalogo(db),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/vender" className="text-sm underline underline-offset-2">
          ← Volver a vender
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Cargar un producto</h1>
        <p className="mt-1 text-sm text-(--color-tinta-suave)">
          Queda vendible en el acto, sin esperar a la tienda online.
        </p>
      </div>

      <FormularioAlta
        categorias={categorias}
        marcas={marcas}
        conAyuda={hayAyudaDeFicha()}
        nombreInicial={(q ?? '').slice(0, 200)}
      />

      {sesion.user.rol === 'owner' ? (
        <p className="text-sm text-(--color-tinta-suave)">
          ¿Llegó una entrega entera?{' '}
          <Link href="/catalogo/importar" className="font-medium underline underline-offset-2">
            Importá la planilla
          </Link>{' '}
          en vez de cargarlos de a uno.
        </p>
      ) : null}
    </div>
  );
}
