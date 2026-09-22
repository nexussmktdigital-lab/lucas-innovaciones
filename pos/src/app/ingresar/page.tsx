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
        {/* La pantalla de ingreso es el primer lugar donde se ve la marca. */}
        <header className="mb-6 flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icono.svg" alt="" width={64} height={64} className="rounded-[14px]" />
          <div>
            <h1 className="font-titulo text-2xl font-bold tracking-tight">Lucas Innovaciones</h1>
            <p className="mt-1 text-sm text-(--color-tinta-suave)">
              Caseros 924 · Villa Santa Rosa
            </p>
          </div>
        </header>
        <FormularioIngreso vendedores={vendedores.filter((v) => v.rol === 'seller')} />
      </div>
    </main>
  );
}
