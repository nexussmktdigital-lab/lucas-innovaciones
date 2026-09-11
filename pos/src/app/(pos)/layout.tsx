import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { salir } from '../acciones-auth';
import Navegacion from './navegacion';

export default async function LayoutPos({ children }: { children: React.ReactNode }) {
  const sesion = await auth();
  if (!sesion?.user) redirect('/ingresar');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-4 border-b border-(--color-borde) bg-(--color-panel) px-4 py-2">
        <span className="font-bold tracking-tight">Lucas Innovaciones</span>
        <Navegacion rol={sesion.user.rol} />
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-(--color-tinta-suave)">
            {sesion.user.name}
            <span className="ml-1 rounded bg-(--color-papel) px-1.5 py-0.5 text-xs font-medium">
              {sesion.user.rol === 'owner' ? 'Dueño' : 'Vendedor'}
            </span>
          </span>
          <form action={salir}>
            <button
              type="submit"
              className="min-h-9 rounded-(--radius-caja) border border-(--color-borde) px-3 font-medium"
            >
              Salir
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
