import Link from 'next/link';
import { auth } from '@/auth';
import { db } from '@/db';
import { config } from '@/lib/config';
import { formatearARS } from '@/lib/dinero';
import { formatearFecha } from '@/lib/fecha';
import { sesionAbierta } from '@/caja/sesion';
import { deudores, totalFiado } from '@/fiado/cuenta';
import { ajustesDeWhatsApp } from '@/whatsapp/config';
import { recordatorioDe, ultimosRecordatorios } from '@/whatsapp/mensajes';
import FilaDeudor from './fila-deudor';

export const dynamic = 'force-dynamic';

/**
 * Fiado: quién debe y cuánto.
 *
 * Hasta acá el fiado vivía en una libreta y en las líneas de venta del POS
 * viejo, cargado como si fuera un producto. Es la mitad del 58% de facturación
 * sin producto real (D24).
 */
export default async function PaginaFiado() {
  const sesion = await auth();
  const esDuenio = sesion?.user.rol === 'owner';

  const lista = await deudores(db);
  const total = await totalFiado(db);
  const caja = await sesionAbierta(db, config().POS_TERMINAL);

  // Los recordatorios se arman acá, con los datos que la lista ya trajo, y no
  // uno por fila: una consulta más para saber a quién ya se le avisó.
  const ajustes = await ajustesDeWhatsApp(db);
  const avisos = await ultimosRecordatorios(
    db,
    lista.map((d) => d.customerId),
    ajustes.diasEntreRecordatorios,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Fiado</h1>
        <Link href="/clientes" className="text-sm underline underline-offset-2">
          Todos los clientes
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Dato titulo="En la calle" valor={formatearARS(total.totalCentavos)} />
        <Dato
          titulo="Clientes con deuda"
          valor={total.clientes.toLocaleString('es-AR')}
          detalle={total.clientes === 0 ? 'Nadie debe nada' : undefined}
        />
      </div>

      {!caja ? (
        <p className="rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-3 text-sm">
          La caja está cerrada. Se puede mirar, pero para recibir un pago hay que abrir el turno:
          la plata tiene que entrar a una caja para que el arqueo cierre.{' '}
          <Link href="/caja" className="font-semibold underline underline-offset-2">
            Abrir la caja
          </Link>
        </p>
      ) : null}

      {lista.length === 0 ? (
        <p className="rounded-(--radius-caja) border border-(--color-ok) bg-(--color-ok)/8 p-6 text-center text-sm">
          No hay nadie con deuda. {esDuenio ? 'Si tenés fichas de papel sin cargar, ' : ''}
          {esDuenio ? (
            <Link href="/clientes" className="font-semibold underline underline-offset-2">
              cargalas desde el cliente
            </Link>
          ) : null}
          {esDuenio ? '.' : ''}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.map((d) => (
            <FilaDeudor
              key={d.customerId}
              deudor={d}
              hayCaja={Boolean(caja)}
              esDuenio={esDuenio}
              recordatorio={recordatorioDe(d, ajustes)}
              ultimoAviso={avisos.get(d.customerId) ?? null}
            />
          ))}
        </ul>
      )}

      {lista.length > 0 ? (
        <p className="text-sm text-(--color-tinta-suave)">
          Cobrar acá suma la plata a la caja del turno, igual que una venta. Lo que dice «de la
          libreta» es un saldo que se cargó a mano al migrar las fichas de papel, sin venta detrás.
          Última actividad: la fecha de la última compra fiada o del último pago.
        </p>
      ) : null}

      <p className="text-xs text-(--color-tinta-suave)">
        Actualizado al {formatearFecha(new Date())}.
      </p>
    </div>
  );
}

function Dato({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) p-4">
      <p className="text-sm text-(--color-tinta-suave)">{titulo}</p>
      <p className="tabular mt-1 text-2xl font-bold">{valor}</p>
      {detalle ? <p className="text-xs text-(--color-tinta-suave)">{detalle}</p> : null}
    </div>
  );
}
