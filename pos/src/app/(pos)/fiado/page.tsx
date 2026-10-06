import Link from 'next/link';
import { auth } from '@/auth';
import { puede } from '@/auth/permisos';
import { db } from '@/db';
import { config } from '@/lib/config';
import { formatearARS, formatearUSD } from '@/lib/dinero';
import { fechaLocalISO, formatearFecha } from '@/lib/fecha';
import { sesionAbierta } from '@/caja/sesion';
import { deudores, totalFiado } from '@/fiado/cuenta';
import { elMasUrgente, estadosDeClientes, URGENCIA } from '@/fiado/plan';
import { devolucionesPendientes } from '@/fiado/devoluciones';
import { cotizacionVigente } from '@/cotizacion/cotizacion';
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

  /*
   * Las consultas van en dos tandas en paralelo, no de a una.
   *
   * Eran nueve `await` seguidos, cada uno esperando al anterior para pedirle
   * algo a una base que está en São Paulo. Con todo caliente no se nota; con el
   * servidor recién levantado y la base despertándose, nueve viajes de ida y
   * vuelta tardan **más de cuatro segundos**, que es justo el plazo que el
   * service worker espera antes de servir lo guardado. La primera vez que se
   * abrió esta pantalla después de un despliegue, el POS declaró que no había
   * internet —había— porque nadie le dio tiempo a contestar.
   *
   * Solo lo que de verdad depende de otra consulta espera: los recordatorios
   * necesitan los ajustes y la lista de deudores, y los semáforos necesitan los
   * ids. El resto no se mira entre sí y sale todo junto.
   */
  const hoy = fechaLocalISO();

  const [lista, total, caja, aDevolver, ajustes, cotizacion] = await Promise.all([
    deudores(db),
    totalFiado(db),
    sesionAbierta(db, config().POS_TERMINAL),
    devolucionesPendientes(db),
    ajustesDeWhatsApp(db),
    // Para cobrar una cuota en dólares con otro medio —o una en pesos con
    // billetes verdes— hace falta la cotización del día. Si no hay, la pantalla
    // lo dice en vez de dejar que el cobro falle recién al apretar el botón.
    cotizacionVigente(db),
  ]);

  const ids = lista.map((d) => d.customerId);

  /*
   * El semáforo: quién está atrasado, a quién le vence una cuota y a quién
   * todavía le falta. Una consulta por moneda para toda la lista, con el día del
   * calendario del local —no el del servidor, que a las 21:30 ya es mañana.
   *
   * Dos consultas y no una porque son dos semáforos: las cuotas en dólares de un
   * iPhone no se mezclan con las cuotas en pesos de un vidrio templado (D62).
   *
   * Y los recordatorios se arman con los datos que la lista ya trajo, no uno por
   * fila: una consulta más para saber a quién ya se le avisó.
   */
  const [avisos, estados, estadosUsd] = await Promise.all([
    ultimosRecordatorios(db, ids, ajustes.diasEntreRecordatorios),
    estadosDeClientes(db, ids, hoy, 'ARS'),
    estadosDeClientes(db, ids, hoy, 'USD'),
  ]);

  /** De cuál de las dos deudas habla la tarjeta: de la que más apura. */
  const urgenciaDe = (id: string) =>
    elMasUrgente(estados.get(id) ?? null, estadosUsd.get(id) ?? null);

  const atrasados = ids.map(urgenciaDe).filter((u) => u.estado?.color === 'rojo');
  const vencidoArs = atrasados
    .filter((u) => u.moneda === 'ARS')
    .reduce((s, u) => s + (u.estado?.vencidoCentavos ?? 0), 0);
  const vencidoUsd = atrasados
    .filter((u) => u.moneda === 'USD')
    .reduce((s, u) => s + (u.estado?.vencidoCentavos ?? 0), 0);

  /*
   * El orden de la lista es el orden en que hay que llamar.
   *
   * Venía por monto, que es el orden de «quién me debe más» y no el de «a quién
   * llamo hoy»: un atrasado de $15.000 importa más que uno al día de $400.000.
   * Primero el semáforo, y dentro de cada color, lo más viejo y lo más grande.
   */
  const ordenada = [...lista].sort((a, b) => {
    const ea = urgenciaDe(a.customerId).estado;
    const eb = urgenciaDe(b.customerId).estado;
    const ua = URGENCIA[ea?.color ?? 'gris'];
    const ub = URGENCIA[eb?.color ?? 'gris'];
    if (ua !== ub) return ua - ub;
    // Dentro del rojo, primero el que hace más que se pasó.
    if (ua === 0) return (eb?.diasDeAtraso ?? 0) - (ea?.diasDeAtraso ?? 0);
    // Entre iguales, el que debe más. El que debe dólares va antes que el que
    // debe pesos solo si debe más plata; con la cotización del día alcanza para
    // ponerlos en un mismo orden sin guardar esa conversión en ninguna parte.
    const tc = cotizacion?.valorCentavos ?? 0;
    const peso = (d: (typeof lista)[number]) =>
      d.saldoCentavos + (tc > 0 ? (d.saldoUsdCentavos * tc) / 100 : d.saldoUsdCentavos);
    return peso(b) - peso(a);
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
        {/* Los dos totales, uno debajo del otro y nunca sumados: pesos y dólares
            son dos deudas distintas y un solo número sería mentira. */}
        <div className="text-right">
          <p className="text-xs font-bold tracking-[0.08em] text-(--color-tinta-suave) uppercase">
            Por cobrar
          </p>
          <p className="cifra text-4xl leading-none">{formatearARS(total.totalCentavos)}</p>
          {total.totalUsdCentavos > 0 ? (
            <p className="cifra mt-1 text-2xl leading-none text-(--color-tinta-media)">
              {formatearUSD(total.totalUsdCentavos)}
            </p>
          ) : null}
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
              {vencidoArs > 0 ? formatearARS(vencidoArs) : null}
              {vencidoArs > 0 && vencidoUsd > 0 ? ' y ' : null}
              {vencidoUsd > 0 ? formatearUSD(vencidoUsd) : null}
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
              estadoUsd={estadosUsd.get(d.customerId) ?? null}
              hayCaja={Boolean(caja)}
              hayCotizacion={Boolean(cotizacion)}
              puedeFiar={puedeFiar}
              recordatorio={recordatorioDe(
                {
                  ...d,
                  estado: urgenciaDe(d.customerId).estado,
                  monedaDelPlan: urgenciaDe(d.customerId).moneda,
                },
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
          Última actividad: la fecha de la última compra fiada o del último pago. Lo que se vendió
          en dólares se debe en dólares: esa deuda se muestra aparte y se cobra aparte, nunca
          sumada con la de pesos.
        </p>
      ) : null}

      <p className="text-xs text-(--color-tinta-suave)">
        Actualizado al {formatearFecha(new Date())}.
      </p>
    </div>
  );
}
