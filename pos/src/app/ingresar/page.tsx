import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import FormularioIngreso from './formulario';

export const dynamic = 'force-dynamic';

export default async function PaginaIngresar() {
  // El vendedor se elige de una lista y solo tipea el PIN: cuatro digitos
  // entre cliente y cliente. El PIN nunca sale del servidor.
  const vendedores = await db
    .select({ id: users.id, nombre: users.nombre, rol: users.rol })
    .from(users)
    .where(eq(users.activo, true))
    .orderBy(asc(users.nombre));

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Lucas Innovaciones</h1>
          <p className="mt-1 text-sm text-(--color-tinta-suave)">Punto de venta</p>
        </header>
        <FormularioIngreso vendedores={vendedores.filter((v) => v.rol === 'seller')} />
      </div>
    </main>
  );
}
