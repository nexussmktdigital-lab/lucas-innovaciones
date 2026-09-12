import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { clientePorId } from '@/clientes/clientes';
import { cuentaDe, movimientosDe } from '@/fiado/cuenta';
import { formatearARS } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/fecha';
import FormularioCliente from '../formulario-cliente';
import FormularioLimite from './formulario-limite';
import FormularioFicha from './formulario-ficha';

export const dynamic = 'force-dynamic';

/** Ficha del cliente: sus datos, su deuda y su historia. */
export default async function PaginaCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesion = await auth();
  const esDuenio = sesion?.user.rol === 'owner';

  const cliente = await clientePorId(db, id);
  if (!cliente) notFound();

  const cuenta = await cuentaDe(db, id);
  const movimientos = await movimientosDe(db, id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/clientes" className="text-sm underline underline-offset-2">
          ← Clientes
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{cliente.nombre}</h1>
        <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-(--color-tinta-suave)">
          {cliente.telefonoRaw ? <span>{cliente.telefonoRaw}</span> : null}
          {cliente.dni ? <span>DNI {cliente.dni}</span> : null}
        </div>
        {cliente.notas ? <p className="mt-1 text-sm">{cliente.notas}</p> : null}
      </div>

      <FormularioCliente
        cliente={{
          id: cliente.id,
          nombre: cliente.nombre,
          telefonoRaw: cliente.telefonoRaw,
          dni: cliente.dni,
          notas: cliente.notas,
        }}
      />

      <section className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-sm text-(--color-tinta-suave)">Deuda</p>
            <p
              className={`tabular text-3xl font-bold ${
                cliente.saldoCentavos > 0 ? 'text-(--color-alerta)' : 'text-(--color-ok)'
              }`}
            >
              {formatearARS(cliente.saldoCentavos)}
            </p>
            {cuenta?.origen === 'migrado_papel' ? (
              <p className="text-xs text-(--color-tinta-suave)">
                Viene de una ficha de papel migrada
              </p>
            ) : null}
          </div>

          {cliente.saldoCentavos > 0 ? (
            <Link
              href="/fiado"
              className="min-h-11 rounded-(--radius-caja) bg-(--color-marca) px-4 py-2.5 font-semibold text-white"
            >
              Recibir un pago
            </Link>
          ) : null}
        </div>

        {esDuenio ? (
          <div className="mt-4 space-y-3 border-t border-(--color-borde) pt-3">
            <FormularioLimite clienteId={cliente.id} limiteCentavos={cliente.limiteCentavos} />
            {cliente.saldoCentavos === 0 && movimientos.length === 0 ? (
              <FormularioFicha clienteId={cliente.id} nombre={cliente.nombre} />
            ) : null}
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
          Movimientos de la cuenta
        </h2>

        {movimientos.length === 0 ? (
          <p className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-6 text-center text-sm text-(--color-tinta-suave)">
            No hay movimientos: a este cliente nunca se le fió ni se le cobró.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {movimientos.map((m, i) => (
              <li
                key={`${m.tipo}-${i}`}
                className="flex flex-wrap items-baseline gap-x-2 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-2.5 text-sm"
              >
                <span className="text-xs text-(--color-tinta-suave)">
                  {formatearFechaHora(m.fecha)}
                </span>
                <span className={m.tipo === 'venta' && m.anulada ? 'line-through opacity-60' : ''}>
                  {m.descripcion}
                </span>
                {m.tipo === 'venta' && m.anulada ? (
                  <span className="text-xs text-(--color-tinta-suave)">anulada</span>
                ) : null}

                <span
                  className={`tabular ml-auto font-semibold ${
                    m.tipo === 'cobro' ? 'text-(--color-ok)' : ''
                  }`}
                >
                  {m.tipo === 'cobro' ? '−' : '+'}
                  {formatearARS(m.montoCentavos)}
                </span>
                {m.tipo === 'cobro' ? (
                  <span className="tabular w-full text-right text-xs text-(--color-tinta-suave)">
                    quedó debiendo {formatearARS(m.saldoResultanteCentavos)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
