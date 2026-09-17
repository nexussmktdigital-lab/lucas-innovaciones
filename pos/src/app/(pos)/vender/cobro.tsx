'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { aCentavos, formatearARS } from '@/lib/dinero';
import {
  calcularCobro,
  problemasDelCobro,
  type Descuento,
  type MedioPago,
  type Pago,
  type TotalesCarrito,
} from '@/ventas/carrito';
import { nombreDelMedio } from '@/ventas/ticket';
import type { registrarVenta } from '@/app/acciones-venta';
import type {
  Cliente,
  Cuenta,
  LineaEnPantalla,
  ResultadoDelCobro,
} from './pantalla-venta';

interface Props {
  totales: TotalesCarrito;
  lineas: LineaEnPantalla[];
  descuentoGlobal: Descuento | null;
  clienteId: string | null;
  /** El cliente elegido, con su deuda. Null si la venta es a consumidor final. */
  cliente: Cliente | null;
  /** Solo el dueño puede fiar: `fiado.crear` no es del vendedor. */
  puedeFiar: boolean;
  cuentas: Cuenta[];
  onCerrar: () => void;
  onConfirmar: (datos: Parameters<typeof registrarVenta>[0]) => Promise<ResultadoDelCobro>;
}

/**
 * Medios que se pueden cobrar.
 *
 * «Cuenta corriente» solo aparece para el dueño y con un cliente elegido: fiar
 * es dar crédito, y el sistema tiene que saber a quién se lo está dando.
 */
const MEDIOS: { medio: MedioPago; tipoCuenta: Cuenta['tipo'] | null }[] = [
  { medio: 'efectivo', tipoCuenta: 'efectivo' },
  { medio: 'transferencia', tipoCuenta: 'banco' },
  { medio: 'debito', tipoCuenta: 'banco' },
  { medio: 'credito', tipoCuenta: 'banco' },
  { medio: 'mercadopago', tipoCuenta: 'mercadopago' },
  { medio: 'cheque', tipoCuenta: 'banco' },
];

const CUENTA_CORRIENTE = {
  medio: 'cuenta_corriente' as MedioPago,
  tipoCuenta: null,
};

const MARCAS = ['Visa', 'Mastercard', 'Amex', 'Naranja', 'Cabal', 'Otra'];

/** Clave de idempotencia: una por intento de cobro, estable entre reintentos. */
function nuevaClave(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random()}`;
}

/**
 * Un pago en pantalla.
 *
 * `clave` es propia y no cambia: con la posición como clave de React, borrar un
 * renglón dejaba el campo del anterior en pantalla mostrando un monto y el
 * sistema contando otro. `texto` es lo que la persona escribió, tal cual, para
 * que pueda tipear «12.» sin que el campo se le corrija solo.
 */
interface PagoEnPantalla extends Pago {
  clave: string;
  texto: string;
}

export default function Cobro({
  totales,
  lineas,
  descuentoGlobal,
  clienteId,
  cliente,
  puedeFiar,
  cuentas,
  onCerrar,
  onConfirmar,
}: Props) {
  const [pagos, setPagos] = useState<PagoEnPantalla[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Precio sospechoso: el dueño tiene que decidir a sabiendas. */
  const [aConfirmar, setAConfirmar] = useState<string | null>(null);
  /**
   * Lo mismo, pero visto por el vendedor, que no lo puede saltear.
   *
   * Antes acá se mostraba el error y nada más: el botón seguía habilitado y
   * cada clic volvía a fallar igual, con un cliente esperando del otro lado.
   * Ahora se dice qué hacer y el botón queda trabado hasta que el carrito
   * cambie, que es lo único que puede destrabarlo.
   */
  const [trabado, setTrabado] = useState<string | null>(null);
  const clave = useRef(nuevaClave());
  const primerCampo = useRef<HTMLInputElement>(null);

  const cobro = useMemo(() => {
    try {
      return calcularCobro(totales.totalCentavos, pagos);
    } catch {
      return null;
    }
  }, [totales.totalCentavos, pagos]);

  const problemas = useMemo(
    () => problemasDelCobro(totales, pagos, { hayCliente: Boolean(clienteId) }),
    [totales, pagos, clienteId],
  );

  useEffect(() => {
    primerCampo.current?.focus();
  }, []);

  // Sacar el producto del carrito destraba el cobro. Es la salida que antes no
  // estaba escrita en ninguna parte.
  useEffect(() => {
    setTrabado(null);
  }, [lineas]);

  const fiadoCentavos = pagos
    .filter((p) => p.medio === 'cuenta_corriente')
    .reduce((suma, p) => suma + p.montoCentavos, 0);
  const hayFiado = fiadoCentavos > 0;

  function cuentaPara(tipo: Cuenta['tipo'] | null): string | null {
    if (!tipo) return null;
    return cuentas.find((c) => c.tipo === tipo)?.id ?? null;
  }

  function agregarMedio(medio: MedioPago, tipoCuenta: Cuenta['tipo'] | null) {
    const faltante = Math.max(0, cobro?.faltanteCentavos ?? totales.totalCentavos);
    setPagos((p) => [
      ...p,
      {
        clave: nuevaClave(),
        medio,
        montoCentavos: faltante,
        texto: faltante === 0 ? '' : String(faltante / 100),
        monetaryAccountId: cuentaPara(tipoCuenta),
      },
    ]);
  }

  function actualizar(clave: string, cambios: Partial<PagoEnPantalla>) {
    setPagos((p) => p.map((pago) => (pago.clave === clave ? { ...pago, ...cambios } : pago)));
  }

  /** Lo tipeado se guarda tal cual; el monto se actualiza si ya se puede leer. */
  function escribirMonto(clave: string, crudo: string) {
    const texto = crudo.trim();
    let montoCentavos: number | undefined;
    try {
      montoCentavos = texto === '' ? 0 : aCentavos(texto);
    } catch {
      // A medio escribir («12.» o «-»): se guarda el texto y nada más.
    }
    actualizar(clave, montoCentavos === undefined ? { texto } : { texto, montoCentavos });
  }

  async function confirmar(saltearGuardaDePrecios = false) {
    if (problemas.length > 0 || enviando) return;
    setEnviando(true);
    setError(null);
    setAConfirmar(null);

    const r = await onConfirmar({
      confirmarPreciosSospechosos: saltearGuardaDePrecios,
      lineas: lineas.map((l) => ({
        productId: l.productId,
        variantId: l.variantId ?? null,
        cantidad: l.cantidad,
        precioManualCentavos: l.precioEditable ? l.precioUnitarioCentavos : null,
        descuentoCentavos: l.descuentoCentavos,
      })),
      pagos: pagos.map((p) => ({
        medio: p.medio,
        montoCentavos: p.montoCentavos,
        monetaryAccountId: p.monetaryAccountId ?? null,
        marcaTarjeta: p.marcaTarjeta ?? null,
        cuotas: p.cuotas ?? null,
      })),
      descuentoGlobal,
      clienteId,
      idempotencyKey: clave.current,
    });

    if (!r.ok) {
      if (r.puedeConfirmar) setAConfirmar(r.error);
      else if (r.motivo === 'precio_sospechoso') setTrabado(r.error);
      else setError(r.error);
      setEnviando(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cobrar"
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-(--radius-caja) bg-(--color-panel) p-4 shadow-xl">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Cobrar</h2>
          <button
            type="button"
            onClick={onCerrar}
            className="text-sm text-(--color-tinta-suave) underline underline-offset-2"
          >
            Volver <kbd>Esc</kbd>
          </button>
        </div>

        <p className="tabular mt-2 text-3xl font-bold">{formatearARS(totales.totalCentavos)}</p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {(puedeFiar ? [...MEDIOS, CUENTA_CORRIENTE] : MEDIOS).map(({ medio, tipoCuenta }) => (
            <button
              key={medio}
              type="button"
              onClick={() => agregarMedio(medio, tipoCuenta)}
              disabled={medio === 'cuenta_corriente' && !cliente}
              title={
                medio === 'cuenta_corriente' && !cliente
                  ? 'Elegí un cliente en el carrito para poder fiar'
                  : undefined
              }
              className="min-h-10 rounded-(--radius-caja) border border-(--color-borde) px-3 text-sm font-medium hover:border-(--color-marca) disabled:cursor-not-allowed disabled:opacity-40"
            >
              + {nombreDelMedio(medio)}
            </button>
          ))}
        </div>

        {pagos.length === 0 ? (
          <p className="mt-4 rounded-(--radius-caja) bg-(--color-papel) p-4 text-center text-sm text-(--color-tinta-suave)">
            Elegí con qué se paga. Se pueden combinar varios medios.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {pagos.map((p, i) => (
              <li
                key={p.clave}
                className="rounded-(--radius-caja) border border-(--color-borde) p-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm font-medium">{nombreDelMedio(p.medio)}</span>
                  <input
                    ref={i === 0 ? primerCampo : undefined}
                    type="text"
                    inputMode="decimal"
                    value={p.texto}
                    aria-label={`Monto en ${nombreDelMedio(p.medio)}`}
                    onChange={(e) => escribirMonto(p.clave, e.target.value)}
                    className="tabular min-h-10 w-36 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2 text-right text-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setPagos((ps) => ps.filter((x) => x.clave !== p.clave))}
                    aria-label={`Quitar el pago en ${nombreDelMedio(p.medio)}`}
                    className="px-1.5 text-(--color-tinta-suave) hover:text-(--color-error)"
                  >
                    ✕
                  </button>
                </div>

                {p.medio === 'credito' || p.medio === 'debito' ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <select
                      value={p.marcaTarjeta ?? ''}
                      onChange={(e) => actualizar(p.clave, { marcaTarjeta: e.target.value || null })}
                      aria-label="Marca de la tarjeta"
                      className="min-h-9 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2"
                    >
                      <option value="">Marca…</option>
                      {MARCAS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    {p.medio === 'credito' ? (
                      <label className="flex items-center gap-1.5">
                        Cuotas
                        <input
                          type="number"
                          min={1}
                          max={24}
                          value={p.cuotas ?? 1}
                          onChange={(e) => actualizar(p.clave, { cuotas: Math.max(1, Number(e.target.value) || 1) })}
                          aria-label="Cantidad de cuotas"
                          className="tabular min-h-9 w-16 rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2 text-center"
                        />
                      </label>
                    ) : null}
                    <span className="text-(--color-tinta-suave)">
                      El monto se pasa por el Posnet aparte
                    </span>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {hayFiado && cliente ? (
          <p className="mt-3 rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-3 text-sm">
            Le vas a fiar{' '}
            <strong className="tabular">{formatearARS(fiadoCentavos)}</strong> a{' '}
            <strong>{cliente.nombre}</strong>.{' '}
            {cliente.saldoCentavos > 0 ? (
              <>
                Ya debe <span className="tabular">{formatearARS(cliente.saldoCentavos)}</span>, así
                que va a quedar en{' '}
                <span className="tabular font-semibold">
                  {formatearARS(cliente.saldoCentavos + fiadoCentavos)}
                </span>
                .
              </>
            ) : (
              'Es la primera vez que le fiás.'
            )}
            {cliente.limiteCentavos !== null &&
            cliente.saldoCentavos + fiadoCentavos > cliente.limiteCentavos ? (
              <>
                {' '}
                <strong className="text-(--color-error)">
                  Se pasa del tope de {formatearARS(cliente.limiteCentavos)}: el sistema no lo va a
                  dejar.
                </strong>
              </>
            ) : null}
          </p>
        ) : null}

        {cobro && pagos.length > 0 ? (
          <dl className="mt-4 flex flex-col gap-1 border-t border-(--color-borde) pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-(--color-tinta-suave)">Pagado</dt>
              <dd className="tabular">{formatearARS(cobro.pagadoCentavos)}</dd>
            </div>
            {cobro.faltanteCentavos > 0 ? (
              <div className="flex justify-between font-semibold text-(--color-alerta)">
                <dt>Falta</dt>
                <dd className="tabular">{formatearARS(cobro.faltanteCentavos)}</dd>
              </div>
            ) : null}
            {cobro.vueltoCentavos > 0 ? (
              <div className="flex items-baseline justify-between">
                <dt className="font-semibold text-(--color-ok)">Vuelto</dt>
                <dd className="tabular text-2xl font-bold text-(--color-ok)">
                  {formatearARS(cobro.vueltoCentavos)}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {problemas.length > 0 && pagos.length > 0 ? (
          <ul className="mt-3 text-sm text-(--color-alerta)">
            {problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-(--radius-caja) border border-(--color-error) bg-(--color-error)/10 p-3 text-sm font-medium"
          >
            {error}
          </p>
        ) : null}

        {trabado ? (
          <div
            role="alert"
            className="mt-3 rounded-(--radius-caja) border-2 border-(--color-error) bg-(--color-error)/10 p-3"
          >
            <p className="text-sm font-semibold text-(--color-error)">
              Este precio no se puede cobrar así
            </p>
            <p className="mt-1 text-sm">{trabado}</p>
            <p className="mt-2 text-sm">
              <strong>Qué hacer:</strong> sacá ese producto del carrito y cobrá el resto. Para
              venderlo, el precio lo tiene que corregir el dueño en el catálogo —o confirmarlo él
              desde su usuario.
            </p>
            <button
              type="button"
              onClick={onCerrar}
              className="mt-3 min-h-10 w-full rounded-(--radius-caja) bg-(--color-marca) text-sm font-semibold text-white"
            >
              Volver al carrito
            </button>
          </div>
        ) : null}

        {aConfirmar ? (
          <div
            role="alert"
            className="mt-3 rounded-(--radius-caja) border-2 border-(--color-alerta) bg-(--color-alerta)/10 p-3"
          >
            <p className="text-sm font-semibold text-(--color-alerta)">
              Frená: revisá el precio antes de cobrar
            </p>
            <p className="mt-1 text-sm">{aConfirmar}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCerrar}
                className="min-h-10 flex-1 rounded-(--radius-caja) bg-(--color-marca) px-3 text-sm font-semibold text-white"
              >
                Volver y revisar
              </button>
              <button
                type="button"
                onClick={() => void confirmar(true)}
                className="min-h-10 rounded-(--radius-caja) border border-(--color-alerta) px-3 text-sm font-medium"
              >
                El precio está bien, cobrar igual
              </button>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void confirmar()}
          disabled={problemas.length > 0 || enviando || aConfirmar !== null || trabado !== null}
          className="mt-4 min-h-14 w-full rounded-(--radius-caja) bg-(--color-ok) text-lg font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {enviando ? 'Confirmando…' : 'Confirmar venta e imprimir'}
        </button>
      </div>
    </div>
  );
}
