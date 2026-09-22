'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { cobrarFiadoAccion, type EstadoFiado } from '@/app/acciones-fiado';
import { formatearARS } from '@/lib/dinero';
import { formatearFecha } from '@/lib/fecha';
import type { DeudorEnLista } from '@/fiado/cuenta';
import { comoSeDice, type Color, type EstadoDeDeuda, type Frecuencia } from '@/fiado/plan';
import type { Preparacion, UltimoAviso } from '@/whatsapp/mensajes';
import BotonWhatsApp from '../boton-whatsapp';

const INICIAL: EstadoFiado = {};

const MEDIOS = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'mercadopago', etiqueta: 'Mercado Pago' },
  { valor: 'debito', etiqueta: 'Débito' },
  { valor: 'credito', etiqueta: 'Crédito' },
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
const SEMAFORO: Record<Color, { borde: string; fondo: string; texto: string; punto: string }> = {
  rojo: {
    borde: 'border-(--color-error)',
    fondo: 'bg-(--color-error)/8',
    texto: 'text-(--color-error)',
    punto: 'bg-(--color-error)',
  },
  amarillo: {
    borde: 'border-(--color-alerta)',
    fondo: 'bg-(--color-alerta)/8',
    texto: 'text-(--color-alerta)',
    punto: 'bg-(--color-alerta)',
  },
  verde: {
    borde: 'border-(--color-ok)',
    fondo: 'bg-(--color-ok)/6',
    texto: 'text-(--color-ok)',
    punto: 'bg-(--color-ok)',
  },
  gris: {
    borde: 'border-(--color-borde)',
    fondo: 'bg-(--color-panel)',
    texto: 'text-(--color-tinta-suave)',
    punto: 'bg-(--color-tinta-suave)',
  },
};

/** Qué dice el botón de WhatsApp según el estado. */
const ETIQUETA_WHATSAPP: Record<Color, string> = {
  rojo: 'Reclamarle la cuota vencida',
  amarillo: 'Avisarle que vence la cuota',
  verde: 'Recordarle la próxima cuota',
  gris: 'Recordarle por WhatsApp',
};

/** `2026-10-18` → `18/10/2026`. */
function comoSeLee(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** Clave de idempotencia: una por formulario abierto. Reintentar no cobra dos veces. */
function nuevaClave(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random()}`;
}

export default function FilaDeudor({
  deudor,
  estado,
  hayCaja,
  esDuenio,
  recordatorio,
  ultimoAviso,
}: {
  deudor: DeudorEnLista;
  /** Su plan de cuotas, si tiene. `null` es el fiado abierto de siempre. */
  estado: (EstadoDeDeuda & { frecuencia: Frecuencia | null }) | null;
  hayCaja: boolean;
  esDuenio: boolean;
  recordatorio: Preparacion;
  ultimoAviso: UltimoAviso | null;
}) {
  const [resultado, accion, pendiente] = useActionState(cobrarFiadoAccion, INICIAL);
  const [abierto, setAbierto] = useState(false);
  const [clave, setClave] = useState(nuevaClave);

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

  const pasadoDeLimite =
    deudor.limiteCentavos !== null && deudor.saldoCentavos >= deudor.limiteCentavos;

  const color = estado?.color ?? 'gris';
  const tono = SEMAFORO[color];

  return (
    <li className={`rounded-(--radius-caja) border-2 p-3 ${tono.borde} ${tono.fondo}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Link
          href={`/clientes/${deudor.customerId}`}
          className="font-medium underline underline-offset-2"
        >
          {deudor.nombre}
        </Link>
        {deudor.telefono ? (
          <span className="text-xs text-(--color-tinta-suave)">{deudor.telefono}</span>
        ) : null}
        {deudor.origen === 'migrado_papel' ? (
          <span className="rounded bg-(--color-papel) px-1.5 py-0.5 text-xs font-semibold text-(--color-tinta-suave)">
            De la libreta
          </span>
        ) : null}
        {pasadoDeLimite ? (
          <span className="rounded bg-(--color-alerta)/15 px-1.5 py-0.5 text-xs font-semibold text-(--color-alerta)">
            En el límite
          </span>
        ) : null}

        <span className="tabular ml-auto text-xl font-bold">
          {formatearARS(deudor.saldoCentavos)}
        </span>
      </div>

      {estado ? (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className={`inline-block size-2.5 shrink-0 rounded-full ${tono.punto}`} aria-hidden />
          <span className={`font-semibold ${tono.texto}`}>{estado.titulo}</span>
          {estado.proxima ? (
            <span className="text-(--color-tinta-media)">
              — cuota {estado.proxima.numero} de {estado.cuotasTotales} ·{' '}
              <span className="tabular font-medium">
                {formatearARS(estado.proxima.faltaCentavos)}
              </span>{' '}
              {color === 'rojo' ? 'venció' : 'vence'} el {comoSeLee(estado.proxima.vencimiento)}
            </span>
          ) : (
            <span className="text-(--color-tinta-media)">
              — las {estado.cuotasTotales} cuotas están pagas
            </span>
          )}
        </div>
      ) : null}

      {estado?.color === 'rojo' && estado.vencidoCentavos > 0 ? (
        <p className="mt-1 text-sm">
          Vencido y sin pagar:{' '}
          <strong className="tabular text-(--color-error)">
            {formatearARS(estado.vencidoCentavos)}
          </strong>
        </p>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-(--color-tinta-suave)">
        {estado?.frecuencia ? (
          <span>
            Paga {comoSeDice(estado.frecuencia)} · {estado.cuotasPagadas} de{' '}
            {estado.cuotasTotales} cuotas pagas
          </span>
        ) : null}
        {deudor.ultimoMovimiento ? (
          <span>Última actividad: {formatearFecha(deudor.ultimoMovimiento)}</span>
        ) : null}
        {deudor.limiteCentavos !== null ? (
          <span>Tope: {formatearARS(deudor.limiteCentavos)}</span>
        ) : esDuenio ? (
          <span>Sin tope</span>
        ) : null}
      </div>

      {resultado.ok ? (
        <p role="status" className="mt-2 text-sm font-medium text-(--color-ok)">
          {resultado.ok}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {recordatorio.listo ? (
          <BotonWhatsApp
            tipo={recordatorio.mensaje.tipo}
            referenciaId={deudor.customerId}
            enlace={recordatorio.mensaje.enlace}
            etiqueta={ETIQUETA_WHATSAPP[color]}
            aviso={
              ultimoAviso?.reciente
                ? `Ya se le recordó ${textoDeHace(ultimoAviso.hace)}.`
                : null
            }
          />
        ) : recordatorio.codigo === 'sin_telefono' ? (
          <Link
            href={`/clientes/${deudor.customerId}`}
            className="text-sm text-(--color-tinta-suave) underline underline-offset-2"
          >
            Sin teléfono: cargale el número para poder avisarle
          </Link>
        ) : null}

        {ultimoAviso && !ultimoAviso.reciente ? (
          <span className="text-xs text-(--color-tinta-suave)">
            Último aviso {textoDeHace(ultimoAviso.hace)}
          </span>
        ) : null}
      </div>

      {!abierto ? (
        <button
          type="button"
          disabled={!hayCaja}
          onClick={() => setAbierto(true)}
          title={hayCaja ? undefined : 'Abrí la caja para poder recibir el pago'}
          className="mt-2 min-h-10 rounded-(--radius-caja) bg-(--color-marca) px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Recibir un pago
        </button>
      ) : (
        <form action={accion} className="mt-2 space-y-2 rounded-(--radius-caja) bg-(--color-papel) p-3">
          <input type="hidden" name="clienteId" value={deudor.customerId} />
          <input type="hidden" name="clave" value={clave} />

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label
                htmlFor={`monto-${deudor.customerId}`}
                className="mb-1 block text-xs font-medium"
              >
                ¿Cuánto paga?
              </label>
              <input
                id={`monto-${deudor.customerId}`}
                name="monto"
                type="text"
                inputMode="decimal"
                required
                autoFocus
                defaultValue={String(deudor.saldoCentavos / 100)}
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
                defaultValue="efectivo"
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
              disabled={pendiente}
              className="min-h-10 flex-1 rounded-(--radius-caja) bg-(--color-ok) text-sm font-semibold text-white disabled:opacity-60"
            >
              {pendiente ? 'Registrando…' : 'Registrar el pago'}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
