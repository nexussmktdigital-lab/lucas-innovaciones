'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { cobrarFiadoAccion, type EstadoFiado } from '@/app/acciones-fiado';
import { formatearARS, formatearUSD } from '@/lib/dinero';
import { formatearFecha } from '@/lib/fecha';
import type { DeudorEnLista } from '@/fiado/cuenta';
import { comoSeDice, type Color, type EstadoDeDeuda, type Cadencia } from '@/fiado/plan';
import type { Preparacion, UltimoAviso } from '@/whatsapp/mensajes';
import BotonWhatsApp from '../boton-whatsapp';

const INICIAL: EstadoFiado = {};

/*
 * Con qué se puede pagar una cuota.
 *
 * «Billetes de dólar» y «Cheque» están porque el cliente paga con lo que tiene
 * —eso lo pidió el local, y vale para cualquier producto, no solo para los
 * iPhone—. Cada medio va al cajón que le toca: los dólares al cajón de dólares,
 * el cheque al banco.
 */
const MEDIOS = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'dolares', etiqueta: 'Billetes de dólar' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'mercadopago', etiqueta: 'Mercado Pago' },
  { valor: 'debito', etiqueta: 'Débito' },
  { valor: 'credito', etiqueta: 'Crédito' },
  { valor: 'cheque', etiqueta: 'Cheque' },
] as const;

/** «hoy», «ayer», «hace 5 días»: como se cuenta el tiempo en el mostrador. */
function textoDeHace(dias: number): string {
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  return `hace ${dias} días`;
}

/**
 * El semáforo, en colores y en palabras.
 *
 * El borde se ve de lejos y el texto explica: un cartel de color sin texto se
 * interpreta mal, y un texto sin color no se ve cuando hay quince clientes en
 * la lista.
 */
const SEMAFORO: Record<Color, { barra: string; chip: string; tinta: string }> = {
  rojo: {
    barra: 'bg-(--color-error)',
    chip: 'bg-(--color-error-fondo)',
    tinta: 'text-(--color-error)',
  },
  amarillo: {
    barra: 'bg-(--color-alerta)',
    chip: 'bg-(--color-alerta-fondo)',
    tinta: 'text-(--color-alerta-tinta)',
  },
  verde: {
    barra: 'bg-(--color-ok)',
    chip: 'bg-(--color-ok-fondo)',
    tinta: 'text-(--color-ok)',
  },
  gris: {
    barra: 'bg-(--color-borde)',
    chip: 'bg-(--color-papel)',
    tinta: 'text-(--color-tinta-suave)',
  },
};

/** El estado en dos o tres palabras, para la pastilla de la tarjeta. */
function enPocasPalabras(estado: EstadoDeDeuda | null): string {
  if (!estado) return 'Sin plan';
  switch (estado.color) {
    case 'rojo':
      return `Atrasado ${estado.diasDeAtraso} ${estado.diasDeAtraso === 1 ? 'día' : 'días'}`;
    case 'amarillo':
      return estado.proxima?.enDias === 0 ? 'Vence hoy' : `Vence en ${estado.proxima?.enDias} días`;
    case 'verde':
      return estado.proxima ? 'Al día' : 'Terminó de pagar';
    default:
      return 'Sin plan';
  }
}

/** Qué dice el botón de WhatsApp según el estado. */
const ETIQUETA_WHATSAPP: Record<Color, string> = {
  rojo: 'Reclamarle la cuota vencida',
  amarillo: 'Avisarle que vence la cuota',
  verde: 'Recordarle la próxima cuota',
  gris: 'Recordarle por WhatsApp',
};

/** Un monto en la moneda de su deuda: `$120.000` o `US$ 200`. */
function comoSeEscribe(centavos: number, moneda: 'ARS' | 'USD'): string {
  return moneda === 'USD' ? formatearUSD(centavos) : formatearARS(centavos);
}

/** `2026-10-18` → `18/10/2026`. */
function comoSeLee(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** Clave de idempotencia: una por formulario abierto. Reintentar no cobra dos veces. */
function nuevaClave(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random()}`;
}

type EstadoConCadencia = EstadoDeDeuda & { cadencia: Cadencia | null };

/** Una de las dos deudas del cliente, con su plan y su forma de escribirse. */
interface Deuda {
  moneda: 'ARS' | 'USD';
  centavos: number;
  texto: string;
  estado: EstadoConCadencia | null;
}

export default function FilaDeudor({
  deudor,
  estado,
  estadoUsd,
  hayCaja,
  hayCotizacion,
  puedeFiar,
  recordatorio,
  ultimoAviso,
}: {
  deudor: DeudorEnLista;
  /** Su plan de cuotas en pesos, si tiene. `null` es el fiado abierto de siempre. */
  estado: EstadoConCadencia | null;
  /** Su plan en dólares, el del iPhone. Es otro plan y otro semáforo (D62). */
  estadoUsd: EstadoConCadencia | null;
  hayCaja: boolean;
  /** Si hay cotización del día: sin ella no se puede cruzar de moneda al cobrar. */
  hayCotizacion: boolean;
  puedeFiar: boolean;
  recordatorio: Preparacion;
  ultimoAviso: UltimoAviso | null;
}) {
  const [resultado, accion, pendiente] = useActionState(cobrarFiadoAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);
  const [clave, setClave] = useState(nuevaClave);

  /*
   * Las dos deudas, cada una con lo suyo.
   *
   * Nunca se suman ni se muestran como un solo número: lo que se vendió en
   * dólares se debe en dólares y se cobra en dólares (D62). Un total mezclado
   * sería plata que no existe, y el que la cobra lo cobraría mal.
   */
  const deudas: Deuda[] = [
    deudor.saldoCentavos > 0
      ? {
          moneda: 'ARS' as const,
          centavos: deudor.saldoCentavos,
          texto: formatearARS(deudor.saldoCentavos),
          estado,
        }
      : null,
    deudor.saldoUsdCentavos > 0
      ? {
          moneda: 'USD' as const,
          centavos: deudor.saldoUsdCentavos,
          texto: formatearUSD(deudor.saldoUsdCentavos),
          estado: estadoUsd,
        }
      : null,
  ].filter((d): d is Deuda => d !== null);

  // De cuál se habla cuando hay una sola, y cuál viene elegida de entrada cuando
  // hay dos: la que más apura.
  const masUrgente =
    deudas.length > 1
      ? (deudas.find((d) => d.estado?.color === 'rojo') ?? deudas[0]!)
      : (deudas[0] ?? null);

  const [moneda, setMoneda] = useState<'ARS' | 'USD'>(masUrgente?.moneda ?? 'ARS');
  const [medio, setMedio] = useState<string>('efectivo');

  const aCobrar = deudas.find((d) => d.moneda === moneda) ?? masUrgente;
  const enDolares = aCobrar?.moneda === 'USD';

  /*
   * Cruzar de moneda necesita la cotización del día.
   *
   * Una cuota de US$ 200 pagada por transferencia entra al banco en pesos, y esos
   * pesos salen de la cotización. Sin cotización el cobro falla en el servidor;
   * avisarlo acá evita que el cliente esté esperando con la plata en la mano.
   */
  const pagaConDolares = medio === 'dolares';
  const necesitaCotizacion = pagaConDolares !== enDolares;
  const faltaCotizacion = necesitaCotizacion && !hayCotizacion;

  /*
   * Cobrado el pago, el formulario se cierra solo y la clave se renueva.
   *
   * Las dos cosas importan y la segunda costó un hallazgo: la clave nacía una
   * sola vez al montar la tarjeta, así que **el segundo pago del mismo cliente
   * sin recargar la pantalla llegaba con la clave del primero** y el servidor,
   * con razón, lo tomaba por un reintento y no cobraba nada. La pantalla decía
   * «Cobrado» igual. Con cuotas eso pasa todo el tiempo: el que paga de a poco
   * paga dos veces en la misma semana.
   *
   * Renovarla acá no afloja la idempotencia: mientras el formulario está
   * abierto la clave no cambia, y eso es lo que impide que un doble clic cobre
   * dos veces el mismo pago.
   */
  useEffect(() => {
    if (resultado.ok) {
      setAbierto(false);
      setClave(nuevaClave());
    }
  }, [resultado.ok]);

  // El tope mide la deuda en pesos, que es la que el tope limita: un límite en
  // pesos contra una deuda en dólares compararía dos cosas distintas.
  const pasadoDeLimite =
    deudor.limiteCentavos !== null && deudor.saldoCentavos >= deudor.limiteCentavos;

  // La barra de color muestra lo que más apura entre las dos deudas.
  const color = masUrgente?.estado?.color ?? 'gris';
  const tono = SEMAFORO[color];

  return (
    <li
      className={`flex flex-col overflow-hidden rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel)`}
    >
      {/* La barra de color se ve de lejos; la pastilla de al lado lo explica
          con palabras, para quien no distingue rojo de verde. */}
      <div className={`h-1.5 ${tono.barra}`} aria-hidden />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/clientes/${deudor.customerId}`}
            className="text-[17px] font-bold underline underline-offset-2"
          >
            {deudor.nombre}
          </Link>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold tracking-[0.03em] uppercase ${tono.chip} ${tono.tinta}`}
          >
            {enPocasPalabras(masUrgente?.estado ?? null)}
          </span>
        </div>

        {/* Un bloque por deuda. El que debe un iPhone en cuotas y además un
            vidrio templado ve las dos cosas separadas, cada una con su plan. */}
        {deudas.map((d, i) => (
          <div key={d.moneda} className={i === 0 ? '' : 'border-t border-(--color-borde) pt-3'}>
            <p className={`cifra leading-none ${i === 0 ? 'text-[28px]' : 'text-[22px]'}`}>
              {d.texto}
              {deudas.length > 1 ? (
                <span className="ml-2 text-xs font-bold tracking-[0.06em] text-(--color-tinta-suave) uppercase">
                  {d.moneda === 'USD' ? 'en dólares' : 'en pesos'}
                </span>
              ) : null}
            </p>

            {d.estado ? (
              <p className="mt-2 text-sm text-(--color-tinta-media)">
                {d.estado.proxima ? (
                  <>
                    Cuota {d.estado.proxima.numero} de {d.estado.cuotasTotales} ·{' '}
                    <span className="tabular">{comoSeEscribe(d.estado.proxima.faltaCentavos, d.moneda)}</span> ·{' '}
                    {d.estado.color === 'rojo' ? 'vencía el' : 'vence el'}{' '}
                    {comoSeLee(d.estado.proxima.vencimiento)}
                  </>
                ) : (
                  <>Las {d.estado.cuotasTotales} cuotas están pagas</>
                )}
              </p>
            ) : (
              <p className="mt-2 text-sm text-(--color-tinta-media)">
                Fiado suelto, sin fechas acordadas
              </p>
            )}

            {d.estado?.color === 'rojo' && d.estado.vencidoCentavos > 0 ? (
              <p className="mt-2 rounded-(--radius-caja) bg-(--color-error-fondo) px-3 py-2 text-sm">
                Vencido y sin pagar:{' '}
                <strong className="tabular text-(--color-error)">
                  {comoSeEscribe(d.estado.vencidoCentavos, d.moneda)}
                </strong>
              </p>
            ) : null}
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--color-tinta-suave)">
          {deudor.telefono ? <span>{deudor.telefono}</span> : null}
          {deudor.origen === 'migrado_papel' ? <span>De la libreta</span> : null}
          {masUrgente?.estado?.cadencia ? (
            <span>
              Paga {comoSeDice(masUrgente.estado.cadencia)} · {masUrgente.estado.cuotasPagadas} de{' '}
              {masUrgente.estado.cuotasTotales} pagas
            </span>
          ) : null}
          {deudor.ultimoMovimiento ? (
            <span>Última actividad: {formatearFecha(deudor.ultimoMovimiento)}</span>
          ) : null}
          {deudor.limiteCentavos !== null ? (
            <span className={pasadoDeLimite ? 'font-semibold text-(--color-alerta-tinta)' : ''}>
              Tope: {formatearARS(deudor.limiteCentavos)}
              {pasadoDeLimite ? ' — está en el límite' : ''}
            </span>
          ) : puedeFiar ? (
            <span>Sin tope</span>
          ) : null}
        </div>

        {resultado.ok ? (
          <p role="status" className="text-sm font-medium text-(--color-ok)">
            {resultado.ok}
          </p>
        ) : null}

        {ultimoAviso && !ultimoAviso.reciente ? (
          <p className="text-xs text-(--color-tinta-suave)">
            Último aviso {textoDeHace(ultimoAviso.hace)}
          </p>
        ) : null}

        {/* Las dos acciones, en el mismo lugar en todas las tarjetas: recordar
            queda en contorno y recibir el pago en negro, que es la que mueve
            plata. */}
        {!abierto ? (
          <div className="mt-auto flex gap-2 pt-1">
            {recordatorio.listo ? (
              <BotonWhatsApp
                tipo={recordatorio.mensaje.tipo}
                referenciaId={deudor.customerId}
                enlace={recordatorio.mensaje.enlace}
                etiqueta={ETIQUETA_WHATSAPP[color]}
                destacado
                aviso={
                  ultimoAviso?.reciente
                    ? `Ya se le recordó ${textoDeHace(ultimoAviso.hace)}.`
                    : null
                }
              />
            ) : recordatorio.codigo === 'sin_telefono' ? (
              <Link
                href={`/clientes/${deudor.customerId}`}
                className="flex min-h-11 flex-1 items-center justify-center rounded-(--radius-caja) border-[1.5px] border-(--color-borde) px-3 text-center text-sm text-(--color-tinta-suave)"
              >
                Cargale el teléfono
              </Link>
            ) : null}

            <button
              type="button"
              disabled={!hayCaja}
              onClick={() => setAbierto(true)}
              title={hayCaja ? undefined : 'Abrí la caja para poder recibir el pago'}
              className="min-h-11 shrink-0 rounded-(--radius-caja) bg-(--color-marca) px-4 text-sm font-bold whitespace-nowrap text-(--color-marca-texto) disabled:cursor-not-allowed disabled:opacity-40"
            >
              Recibir un pago
            </button>
          </div>
        ) : (
          <form
            action={accion}
            className="space-y-2 rounded-(--radius-caja) bg-(--color-papel) p-3"
          >
            <input type="hidden" name="clienteId" value={deudor.customerId} />
            <input type="hidden" name="clave" value={clave} />
            <input type="hidden" name="monedaDeuda" value={moneda} />

            {/* Cuál de las dos deudas está pagando. Solo aparece cuando debe en
                las dos: preguntarlo cuando hay una sola es una pregunta de más
                en el mostrador, y una forma de equivocarse. */}
            {deudas.length > 1 ? (
              <div>
                <span className="mb-1 block text-xs font-medium">¿Qué deuda paga?</span>
                <div className="flex gap-2">
                  {deudas.map((d) => (
                    <button
                      key={d.moneda}
                      type="button"
                      onClick={() => setMoneda(d.moneda)}
                      aria-pressed={moneda === d.moneda}
                      className={`min-h-10 flex-1 rounded-(--radius-caja) border px-2 text-sm font-semibold ${
                        moneda === d.moneda
                          ? 'border-(--color-marca) bg-(--color-marca) text-(--color-marca-texto)'
                          : 'border-(--color-borde) bg-(--color-panel)'
                      }`}
                    >
                      {d.texto}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label
                  htmlFor={`monto-${deudor.customerId}`}
                  className="mb-1 block text-xs font-medium"
                >
                  ¿Cuánto paga? {enDolares ? 'En dólares' : 'En pesos'}
                </label>
                <input
                  // La clave fuerza a rehacer el campo al cambiar de deuda: si no,
                  // quedaría el monto de la otra moneda escrito y se cobraría eso.
                  key={moneda}
                  id={`monto-${deudor.customerId}`}
                  name="monto"
                  type="text"
                  inputMode="decimal"
                  required
                  autoFocus
                  defaultValue={String((aCobrar?.centavos ?? 0) / 100)}
                  className="tabular min-h-11 w-36 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2 text-right text-lg"
                />
              </div>

              <div>
                <label
                  htmlFor={`medio-${deudor.customerId}`}
                  className="mb-1 block text-xs font-medium"
                >
                  Con qué
                </label>
                <select
                  id={`medio-${deudor.customerId}`}
                  name="medio"
                  value={medio}
                  onChange={(e) => setMedio(e.target.value)}
                  className="min-h-11 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
                >
                  {MEDIOS.map((m) => (
                    <option key={m.valor} value={m.valor}>
                      {m.etiqueta}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-40 flex-1">
                <label
                  htmlFor={`nota-${deudor.customerId}`}
                  className="mb-1 block text-xs font-medium"
                >
                  Nota (opcional)
                </label>
                <input
                  id={`nota-${deudor.customerId}`}
                  name="nota"
                  type="text"
                  maxLength={200}
                  placeholder="Ej.: a cuenta del celular"
                  className="min-h-11 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-panel) px-2"
                />
              </div>
            </div>

            {/* La deuda y el medio están en monedas distintas: el monto se
                imputa a la deuda y a la caja entra lo que valga hoy. Se dice
                antes de cobrar, no después. */}
            {necesitaCotizacion ? (
              <p
                className={`rounded-(--radius-caja) px-3 py-2 text-sm ${
                  faltaCotizacion ? 'bg-(--color-error-fondo)' : 'bg-(--color-alerta-fondo)'
                }`}
              >
                {faltaCotizacion ? (
                  <>
                    Falta la cotización del día y hace falta para pasar de{' '}
                    {enDolares ? 'dólares a pesos' : 'pesos a dólares'}.{' '}
                    <Link href="/cotizacion" className="font-semibold underline underline-offset-2">
                      Cargala en Dólar
                    </Link>
                  </>
                ) : enDolares ? (
                  <>
                    Se le descuentan dólares de la deuda y a la caja entran los pesos que valgan
                    hoy, con la cotización del día.
                  </>
                ) : (
                  <>
                    Se le descuentan pesos de la deuda y al cajón de dólares entran los billetes,
                    convertidos con la cotización del día.
                  </>
                )}
              </p>
            ) : null}

            {resultado.error ? (
              <p role="alert" className="text-sm font-medium text-(--color-error)">
                {resultado.error}
              </p>
            ) : null}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="min-h-10 flex-1 rounded-(--radius-caja) border border-(--color-borde) text-sm font-medium"
              >
                Volver
              </button>
              <button
                type="submit"
                disabled={pendiente || faltaCotizacion}
                className="min-h-10 flex-1 rounded-(--radius-caja) bg-(--color-accion) text-sm font-semibold text-(--color-accion-texto) disabled:opacity-60"
              >
                {pendiente ? 'Registrando…' : 'Registrar el pago'}
              </button>
            </div>
          </form>
        )}
      </div>
    </li>
  );
}
