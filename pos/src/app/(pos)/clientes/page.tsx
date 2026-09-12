import Link from 'next/link';
import { db } from '@/db';
import { buscarClientes } from '@/clientes/clientes';
import { formatearARS } from '@/lib/dinero';
import FormularioCliente from './formulario-cliente';

export const dynamic = 'force-dynamic';

/**
 * Fichero de clientes.
 *
 * Es la contraparte de la cuenta corriente y, en la fase 5, de los mensajes por
 * WhatsApp. Lo puede usar el mostrador: cargar un cliente no es fiarle.
 */
export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const clientes = await buscarClientes(db, q ?? '');
  const conDeuda = clientes.filter((c) => c.saldoCentavos > 0).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
        <Link href="/fiado" className="text-sm underline underline-offset-2">
          Ver solo los que deben
        </Link>
      </div>

      <FormularioCliente />

      <form className="flex gap-2" action="/clientes">
        <label htmlFor="q" className="sr-only">
          Buscar cliente
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q ?? ''}
          placeholder="Buscar por nombre, teléfono o DNI…"
          className="min-h-11 flex-1 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-3"
        />
        <button
          type="submit"
          className="min-h-11 rounded-(--radius-caja) bg-(--color-marca) px-4 font-semibold text-white"
        >
          Buscar
        </button>
      </form>

      {clientes.length === 0 ? (
        <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-6 text-center text-sm text-(--color-tinta-suave)">
          {q ? 'No hay ningún cliente que coincida.' : 'Todavía no hay clientes cargados.'}
        </p>
      ) : (
        <>
          <p className="text-sm text-(--color-tinta-suave)">
            {clientes.length} {clientes.length === 1 ? 'cliente' : 'clientes'}
            {conDeuda > 0 ? `, ${conDeuda} con deuda` : ''}.
          </p>
          <ul className="flex flex-col gap-2">
            {clientes.map((c) => (
              <li
                key={c.id}
                className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-3"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Link
                    href={`/clientes/${c.id}`}
                    className="font-medium underline underline-offset-2"
                  >
                    {c.nombre}
                  </Link>
                  {c.telefonoRaw ? (
                    <span className="text-xs text-(--color-tinta-suave)">{c.telefonoRaw}</span>
                  ) : null}
                  {c.dni ? (
                    <span className="text-xs text-(--color-tinta-suave)">· DNI {c.dni}</span>
                  ) : null}
                  {c.comprasFiadas > 0 ? (
                    <span className="text-xs text-(--color-tinta-suave)">
                      · {c.comprasFiadas} {c.comprasFiadas === 1 ? 'compra fiada' : 'compras fiadas'}
                    </span>
                  ) : null}

                  {c.saldoCentavos > 0 ? (
                    <span className="tabular ml-auto font-bold text-(--color-alerta)">
                      Debe {formatearARS(c.saldoCentavos)}
                    </span>
                  ) : (
                    <span className="ml-auto text-xs text-(--color-tinta-suave)">Al día</span>
                  )}
                </div>
                {c.notas ? (
                  <p className="mt-1 text-sm text-(--color-tinta-media)">{c.notas}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
