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
  puedeFiar,
  recordatorio,
  ultimoAviso,
}: {
  deudor: DeudorEnLista;
  /** Su plan de cuotas, si tiene. `null` es el fiado abierto de siempre. */
  estado: (EstadoDeDeuda & { frecuencia: Frecuencia | null }) | null;
  hayCaja: boolean;
  puedeFiar: boolean;
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
            {enPocasPalabras(estado)}
          </span>
        </div>

        <p className="cifra text-[28px] leading-none">{formatearARS(deudor.saldoCentavos)}</p>

        {estado ? (
          <p className="text-sm text-(--color-tinta-media)">
            {estado.proxima ? (
              <>
                Cuota {estado.proxima.numero} de {estado.cuotasTotales} ·{' '}
                <span className="tabular">{formatearARS(estado.proxima.faltaCentavos)}</span> ·{' '}
                {color === 'rojo' ? 'vencía el' : 'vence el'}{' '}
                {comoSeLee(estado.proxima.vencimiento)}
              </>
            ) : (
              <>Las {estado.cuotasTotales} cuotas están pagas</>
            )}
          </p>
        ) : (
          <p className="text-sm text-(--color-tinta-media)">Fiado suelto, sin fechas acordadas</p>
        )}

        {estado?.color === 'rojo' && estado.vencidoCentavos > 0 ? (
          <p className="rounded-(--radius-caja) bg-(--color-error-fondo) px-3 py-2 text-sm">
            Vencido y sin pagar:{' '}
            <strong className="tabular text-(--color-error)">
              {formatearARS(estado.vencidoCentavos)}
            </strong>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--color-tinta-suave)">
          {deudor.telefono ? <span>{deudor.telefono}</span> : null}
          {deudor.origen === 'migrado_papel' ? <span>De la libreta</span> : null}
          {estado?.frecuencia ? (
            <span>
              Paga {comoSeDice(estado.frecuencia)} · {estado.cuotasPagadas} de{' '}
              {estado.cuotasTotales} pagas
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
