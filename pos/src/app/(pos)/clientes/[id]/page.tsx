import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { clientePorId } from '@/clientes/clientes';
import { cuentaDe, movimientosDe } from '@/fiado/cuenta';
import { devolucionesDe } from '@/fiado/devoluciones';
import { ajustesDeWhatsApp } from '@/whatsapp/config';
import { armarRecordatorio, mensajesDe, ultimoRecordatorio } from '@/whatsapp/mensajes';
import { formatearARS } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/fecha';
import BotonWhatsApp from '../../boton-whatsapp';
import Devoluciones from './devoluciones';
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

  const aDevolver = await devolucionesDe(db, id);
  const ajustes = await ajustesDeWhatsApp(db);
  const recordatorio = await armarRecordatorio(db, id, ajustes);
  const aviso = await ultimoRecordatorio(db, id, ajustes.diasEntreRecordatorios);
  const escritos = await mensajesDe(db, id);

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

      <Devoluciones pendientes={aDevolver} />

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

        {recordatorio.listo ? (
          <div className="mt-3">
            <BotonWhatsApp
              tipo="recordatorio_fiado"
              referenciaId={cliente.id}
              enlace={recordatorio.mensaje.enlace}
              etiqueta="Recordarle por WhatsApp"
              aviso={
                aviso?.reciente
                  ? `Ya se le recordó ${aviso.hace <= 0 ? 'hoy' : aviso.hace === 1 ? 'ayer' : `hace ${aviso.hace} días`}.`
                  : null
              }
              destacado
            />
          </div>
        ) : recordatorio.codigo === 'sin_telefono' ? (
          <p className="mt-3 text-sm text-(--color-tinta-suave)">
            Sin teléfono no se le puede avisar por WhatsApp. Cargalo acá arriba.
          </p>
        ) : null}

        {esDuenio ? (
          <div className="mt-4 space-y-3 border-t border-(--color-borde) pt-3">
            <FormularioLimite clienteId={cliente.id} limiteCentavos={cliente.limiteCentavos} />
            {cliente.saldoCentavos === 0 && movimientos.length === 0 ? (
              <FormularioFicha clienteId={cliente.id} nombre={cliente.nombre} />
            ) : null}
          </div>
        ) : null}
      </section>

      {escritos.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-(--color-tinta-suave)">
            Mensajes preparados
          </h2>
          <ul className="flex flex-col gap-1.5">
            {escritos.map((m, i) => (
              <li
                key={`${m.preparadoEn.toISOString()}-${i}`}
                className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-2.5 text-sm"
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">
                    {m.tipo === 'comprobante' ? 'Comprobante' : 'Recordatorio de deuda'}
                  </span>
                  <span className="text-xs text-(--color-tinta-suave)">
                    {formatearFechaHora(m.preparadoEn)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-line text-(--color-tinta-media)">{m.texto}</p>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-(--color-tinta-suave)">
            «Preparado» quiere decir que el chat se abrió con el mensaje escrito. Quien aprieta
            enviar es la persona, así que el sistema no puede jurar que llegó.
          </p>
        </section>
      ) : null}

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
                {/* En pasado y con «en ese momento»: es el saldo de ese día,
                    congelado. Si después se anuló una venta, el saldo de arriba
                    ya no coincide, y decir «quedó debiendo» a secas hacía que
                    los dos números se leyeran como contradictorios. */}
                {m.tipo === 'cobro' ? (
                  <span className="tabular w-full text-right text-xs text-(--color-tinta-suave)">
                    en ese momento quedaba debiendo {formatearARS(m.saldoResultanteCentavos)}
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
