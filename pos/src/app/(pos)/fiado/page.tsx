import Link from 'next/link';
import { auth } from '@/auth';
import { puede } from '@/auth/permisos';
import { db } from '@/db';
import { config } from '@/lib/config';
import { formatearARS } from '@/lib/dinero';
import { fechaLocalISO, formatearFecha } from '@/lib/fecha';
import { sesionAbierta } from '@/caja/sesion';
import { deudores, totalFiado } from '@/fiado/cuenta';
import { estadosDeClientes } from '@/fiado/plan';
import { devolucionesPendientes } from '@/fiado/devoluciones';
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
  // Quien puede fiar es quien necesita ver el tope y cargar la ficha de papel.
  // Cobrar, en cambio, lo puede cualquiera: que venga alguien a pagar y no se
  // le pueda recibir la plata sería peor que cualquier control.
  const puedeFiar = sesion?.user ? puede(sesion.user.rol, 'fiado.crear') : false;

  const lista = await deudores(db);
  const total = await totalFiado(db);
  const caja = await sesionAbierta(db, config().POS_TERMINAL);

  // Los recordatorios se arman acá, con los datos que la lista ya trajo, y no
  // uno por fila: una consulta más para saber a quién ya se le avisó.
  const aDevolver = await devolucionesPendientes(db);
  const ajustes = await ajustesDeWhatsApp(db);
  const avisos = await ultimosRecordatorios(
    db,
    lista.map((d) => d.customerId),
    ajustes.diasEntreRecordatorios,
  );

  // El semáforo: quién está atrasado, a quién le vence una cuota y a quién
  // todavía le falta. Una sola consulta para toda la lista, con el día del
  // calendario del local —no el del servidor, que a las 21:30 ya es mañana.
  const hoy = fechaLocalISO();
  const estados = await estadosDeClientes(
    db,
    lista.map((d) => d.customerId),
    hoy,
  );

  const atrasados = [...estados.values()].filter((e) => e.color === 'rojo');

  /*
   * El orden de la lista es el orden en que hay que llamar.
   *
   * Venía por monto, que es el orden de «quién me debe más» y no el de «a quién
   * llamo hoy»: un atrasado de $15.000 importa más que uno al día de $400.000.
   * Primero el semáforo, y dentro de cada color, lo más viejo y lo más grande.
   */
  const URGENCIA: Record<string, number> = { rojo: 0, amarillo: 1, gris: 2, verde: 3 };
  const ordenada = [...lista].sort((a, b) => {
    const ea = estados.get(a.customerId);
    const eb = estados.get(b.customerId);
    const ua = URGENCIA[ea?.color ?? 'gris'] ?? 2;
    const ub = URGENCIA[eb?.color ?? 'gris'] ?? 2;
    if (ua !== ub) return ua - ub;
    // Dentro del rojo, primero el que hace más que se pasó.
    if (ua === 0) return (eb?.diasDeAtraso ?? 0) - (ea?.diasDeAtraso ?? 0);
    return b.saldoCentavos - a.saldoCentavos;
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-titulo font-titulo text-2xl font-bold tracking-tight">Fiado</h1>
          <p className="mt-1 text-sm text-(--color-tinta-suave)">
            {total.clientes === 0
              ? 'Nadie debe nada'
              : `${total.clientes} ${total.clientes === 1 ? 'cliente' : 'clientes'} con saldo · ordenados por urgencia`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold tracking-[0.08em] text-(--color-tinta-suave) uppercase">
            Por cobrar
          </p>
          <p className="cifra text-4xl leading-none">{formatearARS(total.totalCentavos)}</p>
        </div>
      </div>

      {atrasados.length > 0 ? (
        <p className="flex flex-wrap items-center gap-2 rounded-(--radius-caja) bg-(--color-error-fondo) p-4 text-base">
          <span aria-hidden className="size-2.5 rounded-full bg-(--color-error)" />
          <strong>
            {atrasados.length} {atrasados.length === 1 ? 'cliente' : 'clientes'} con la cuota
            vencida
          </strong>
          <span>
            · deben{' '}
            <span className="tabular">
              {formatearARS(atrasados.reduce((s, e) => s + e.vencidoCentavos, 0))}
            </span>{' '}
            entre {atrasados.length === 1 ? 'ese' : 'todos'}.
          </span>
        </p>
      ) : null}

      {aDevolver.length > 0 ? (
        <section
          aria-labelledby="devoluciones"
          className="rounded-(--radius-caja) bg-(--color-alerta-fondo) p-4"
        >
          <h2 id="devoluciones" className="text-sm font-semibold">
            Hay plata para devolver
          </h2>
          <p className="mt-0.5 text-sm text-(--color-tinta-media)">
            Pagaron a cuenta de ventas que después se anularon. La plata quedó en la caja.
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {aDevolver.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  href={`/clientes/${d.customerId}`}
                  className="font-medium underline underline-offset-2"
                >
                  {d.nombre}
                </Link>
                <span className="text-xs text-(--color-tinta-suave)">venta {d.numero}</span>
                <span className="tabular ml-auto font-semibold">
                  {formatearARS(d.montoCentavos)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!caja ? (
        <p className="rounded-(--radius-caja) bg-(--color-alerta-fondo) p-3 text-sm">
          La caja está cerrada. Se puede mirar, pero para recibir un pago hay que abrir el turno: la
          plata tiene que entrar a una caja para que el arqueo cierre.{' '}
          <Link href="/caja" className="font-semibold underline underline-offset-2">
            Abrir la caja
          </Link>
        </p>
      ) : null}

      {lista.length === 0 ? (
        <p className="rounded-(--radius-caja) bg-(--color-ok-fondo) p-6 text-center text-sm">
          No hay nadie con deuda. {puedeFiar ? 'Si tenés fichas de papel sin cargar, ' : ''}
          {puedeFiar ? (
            <Link href="/clientes" className="font-semibold underline underline-offset-2">
              cargalas desde el cliente
            </Link>
          ) : null}
          {puedeFiar ? '.' : ''}
        </p>
      ) : (
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          {ordenada.map((d) => (
            <FilaDeudor
              key={d.customerId}
              deudor={d}
              estado={estados.get(d.customerId) ?? null}
              hayCaja={Boolean(caja)}
              puedeFiar={puedeFiar}
              recordatorio={recordatorioDe(
                { ...d, estado: estados.get(d.customerId) ?? null },
                ajustes,
              )}
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
