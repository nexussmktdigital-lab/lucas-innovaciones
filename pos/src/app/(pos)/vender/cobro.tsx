'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { aCentavos, formatearARS, formatearUSD, pesosAUsdExacto, usdAPesos } from '@/lib/dinero';
import PlanDeCuotas, { type PlanElegido } from './plan-de-cuotas';
import {
  calcularCobro,
  problemasDelCobro,
  type Descuento,
  type MedioPago,
  type Pago,
  type TotalesCarrito,
} from '@/ventas/carrito';
import { calcularRecargo, type RecargoEscrito } from '@/lib/recargo';
import CampoRecargo from '../campo-recargo';

/**
 * Cuánto es el recargo de un pago, en pesos.
 *
 * La base es lo que ese pago cubre de la mercadería, no el total de la venta:
 * en una venta mitad en efectivo y mitad con cheque, el recargo es del cheque
 * y de nada más. Es lo que el local cobra —el costo del cheque— y no el de la
 * operación entera.
 */
function recargoDe(p: { medio: MedioPago; montoCentavos: number; recargoEscrito?: RecargoEscrito | null }): number {
  if (p.medio !== 'cheque') return 0;
  try {
    return calcularRecargo(p.montoCentavos, p.recargoEscrito ?? null);
  } catch {
    // Un porcentaje imposible: el campo lo dice y el botón se apaga aparte.
    return 0;
  }
}
import { nombreDelMedio } from '@/ventas/ticket';
import type { registrarVenta } from '@/app/acciones-venta';
import type { Cliente, Cuenta, LineaEnPantalla, ResultadoDelCobro } from './pantalla-venta';

interface Props {
  totales: TotalesCarrito;
  lineas: LineaEnPantalla[];
  descuentoGlobal: Descuento | null;
  clienteId: string | null;
  /** El cliente elegido, con su deuda. Null si la venta es a consumidor final. */
  cliente: Cliente | null;
  /** Si puede fiar. Hoy el vendedor también: `fiado.crear` no es del dueño. */
  puedeFiar: boolean;
  cuentas: Cuenta[];
  /** La cotización del día. Sin ella no se puede cobrar en dólares. */
  tcCentavos: number | null;
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
  /*
   * Los dólares van a su propio cajón, no al de pesos.
   *
   * El monto se escribe EN DÓLARES —es lo que el cliente pone sobre el
   * mostrador— y el sistema calcula los pesos con la cotización del día. Al
   * revés sería pedirle a quien atiende que haga la cuenta de cabeza.
   */
  { medio: 'dolares', tipoCuenta: 'dolares' },
];

const CUENTA_CORRIENTE = {
  medio: 'cuenta_corriente' as MedioPago,
  tipoCuenta: null,
};

/**
 * Plan canje: entra un teléfono como parte de pago.
 *
 * Va aparte de `MEDIOS` por lo mismo que la cuenta corriente: no mueve
 * ninguna cuenta. La diferencia es que acá sí entra algo —el equipo— y por eso
 * el renglón pide más que un monto.
 */
const CANJE = {
  medio: 'canje' as MedioPago,
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
  /**
   * El recargo tal como se escribió: 5 si es 5%, 2000 si son $2.000.
   *
   * Se guarda la forma y no solo el monto para poder decirle al cliente lo
   * mismo que escuchó: «te cobro un cinco por ciento» y en el papel $2.000,
   * sin que tenga que creer de dónde salió.
   */
  recargoEscrito?: RecargoEscrito | null;
}

export default function Cobro({
  totales,
  lineas,
  descuentoGlobal,
  clienteId,
  cliente,
  puedeFiar,
  cuentas,
  tcCentavos,
  onCerrar,
  onConfirmar,
}: Props) {
  const [pagos, setPagos] = useState<PagoEnPantalla[]>([]);
  /** El plan de cuotas de lo fiado. `null` es «cuando pueda», que es el de siempre. */
  const [plan, setPlan] = useState<PlanElegido | null>(null);
  /** Lo que se cobra por fiar. Va aparte del plan: también se cobra sin cuotas. */
  const [recargoFiado, setRecargoFiado] = useState<RecargoEscrito | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Precio sospechoso: quien está cobrando decide a sabiendas. */
  const [aConfirmar, setAConfirmar] = useState<string | null>(null);
  /**
   * Lo mismo, pero cuando el servidor dice que no se puede cobrar igual.
   *
   * Hoy no pasa con un precio sospechoso: el mostrador puede seguir de largo y
   * queda anotado quién lo hizo. Queda como salida para cualquier negativa del
   * servidor que no ofrezca confirmación: antes acá se mostraba el error y
   * nada más, el botón seguía habilitado y cada clic volvía a fallar igual,
   * con un cliente esperando del otro lado.
   */
  const [trabado, setTrabado] = useState<string | null>(null);
  const clave = useRef(nuevaClave());
  const primerCampo = useRef<HTMLInputElement>(null);

  /*
   * Los pagos con su recargo ya calculado, que es la forma en que viajan al
   * servidor y la que usan todas las cuentas de esta pantalla.
   *
   * El recargo sube el total y sube lo pagado por igual: lo que el cliente
   * entrega con el cheque cubre la mercadería y su propio recargo.
   */
  const pagosConRecargo = useMemo(
    () =>
      pagos.map((p) => ({
        ...p,
        recargoCentavos: recargoDe(p),
      })),
    [pagos],
  );

  const recargoTotalCentavos = useMemo(
    () => pagosConRecargo.reduce((n, p) => n + p.recargoCentavos, 0),
    [pagosConRecargo],
  );

  const totalConRecargo = totales.totalCentavos + recargoTotalCentavos;


  const cobro = useMemo(() => {
    try {
      return calcularCobro(totalConRecargo, pagosConRecargo);
    } catch {
      return null;
    }
  }, [totalConRecargo, pagosConRecargo]);

  const problemas = useMemo(
    () =>
      problemasDelCobro(totales, pagosConRecargo, {
        hayCliente: Boolean(clienteId),
        recargoCentavos: recargoTotalCentavos,
      }),
    [totales, pagosConRecargo, clienteId, recargoTotalCentavos],
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

  /*
   * Lo que se vende en dólares se debe en dólares (D62).
   *
   * Es la misma regla que aplica el servidor al confirmar: si **todo** el
   * carrito está cotizado en dólares, el saldo fiado queda en dólares. Un
   * carrito mezclado queda en pesos, a propósito: no hay forma de partir una
   * deuda sola en dos monedas sin inventar cuál parte es cuál.
   *
   * Se calcula también acá para que la pantalla diga lo mismo que va a quedar
   * guardado: el vendedor acuerda las cuotas mirando esto.
   */
  const carritoEnDolares = lineas.length > 0 && lineas.every((l) => l.monedaOriginal === 'USD');
  // Sin cotización el servidor rechaza la venta fiada en dólares, así que acá no
  // se muestra un monto en dólares que nunca va a existir: se avisa y listo.
  const ventaEnDolares = carritoEnDolares && (tcCentavos ?? 0) > 0;
  const faltaElDolar = carritoEnDolares && !(tcCentavos ?? 0);
  const fiadoEnDeudaCentavos = ventaEnDolares
    ? pesosAUsdExacto(fiadoCentavos, tcCentavos!)
    : fiadoCentavos;
  const cifraDeuda = ventaEnDolares ? formatearUSD : formatearARS;
  /*
   * El recargo por fiar, en la moneda de la DEUDA.
   *
   * No se suma al total de la venta —el comprobante lleva el precio del
   * producto— así que viaja aparte y el servidor lo suma a la deuda.
   */
  const recargoFiadoCentavos = (() => {
    try {
      return calcularRecargo(fiadoEnDeudaCentavos, recargoFiado);
    } catch {
      return 0;
    }
  })();


  function cuentaPara(tipo: Cuenta['tipo'] | null): string | null {
    if (!tipo) return null;
    return cuentas.find((c) => c.tipo === tipo)?.id ?? null;
  }

  function agregarMedio(medio: MedioPago, tipoCuenta: Cuenta['tipo'] | null) {
    const faltante = Math.max(0, cobro?.faltanteCentavos ?? totales.totalCentavos);

    /*
     * El canje arranca vacío y con su equipo en blanco.
     *
     * Vacío porque el valor de canje lo decide quien atiende mirando el
     * teléfono, no lo que falta de la cuenta: se recibe «al costo o menos que
     * el costo» según cómo venga el equipo.
     */
    if (medio === 'canje') {
      setPagos((p) => [
        ...p,
        {
          clave: nuevaClave(),
          medio,
          montoCentavos: 0,
          ...(ventaEnDolares
            ? { montoUsdCentavos: 0, cotizacionCentavos: tcCentavos }
            : {}),
          equipoRecibido: { nombre: '', imei: '' },
          texto: '',
          monetaryAccountId: null,
        },
      ]);
      return;
    }

    // En dólares el renglón arranca vacío: lo que falta en pesos convertido a
    // dólares da un número con centavos que nadie va a pagar en billetes.
    if (medio === 'dolares') {
      setPagos((p) => [
        ...p,
        {
          clave: nuevaClave(),
          medio,
          montoCentavos: 0,
          montoUsdCentavos: 0,
          cotizacionCentavos: tcCentavos,
          texto: '',
          monetaryAccountId: cuentaPara(tipoCuenta),
        },
      ]);
      return;
    }

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
    let leido: number | undefined;
    try {
      leido = texto === '' ? 0 : aCentavos(texto);
    } catch {
      // A medio escribir («12.» o «-»): se guarda el texto y nada más.
      actualizar(clave, { texto });
      return;
    }

    const pago = pagos.find((p) => p.clave === clave);

    /*
     * En dólares, lo tipeado SON dólares: se guardan como tales y los pesos
     * salen de la cotización. Es el único renglón del cobro donde el número
     * del campo no es el que suma contra el total.
     */
    /*
     * En una venta en dólares el canje también se tipea en dólares: el equipo
     * se recibe «por US$ 600», no por su equivalente en pesos de hoy. En una
     * venta en pesos se tipea en pesos, como cualquier otro renglón.
     */
    if (pago?.medio === 'dolares' || (pago?.medio === 'canje' && pago.cotizacionCentavos)) {
      const tc = pago.cotizacionCentavos ?? tcCentavos;
      actualizar(clave, {
        texto,
        montoUsdCentavos: leido,
        cotizacionCentavos: tc,
        montoCentavos: tc ? usdAPesos(leido, tc) : 0,
      });
      return;
    }

    actualizar(clave, { texto, montoCentavos: leido });
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
        // Un servicio viaja siempre con precio escrito —no tiene otro—, y un
        // producto normal solo si alguien lo tocó. Declararlo es lo que hace
        // que corra la guarda de cordura y que quede registrado el desvío.
        precioManualCentavos:
          l.precioEditable || l.precioTocado ? l.precioUnitarioCentavos : null,
        descuentoCentavos: l.descuentoCentavos,
      })),
      pagos: pagosConRecargo.map((p) => ({
        medio: p.medio,
        montoCentavos: p.montoCentavos,
        /*
         * El recargo del cheque, ya calculado. Viaja como monto y no como
         * porcentaje: lo que se guarda es el hecho, no la cuenta.
         */
        recargoCentavos: p.recargoCentavos,
        /*
         * Los dólares y la cotización viajan siempre que los haya.
         *
         * Son dos hechos distintos —lo que el cliente entregó y lo que eso
         * valía ese día— y la base los exige en un pago en dólares. Sin
         * mandarlos, la venta se rechazaba al insertar el pago.
         */
        montoUsdCentavos: p.montoUsdCentavos ?? null,
        cotizacionCentavos: p.cotizacionCentavos ?? null,
        monetaryAccountId: p.monetaryAccountId ?? null,
        equipoRecibido:
          p.medio === 'canje' && p.equipoRecibido?.nombre.trim()
            ? {
                nombre: p.equipoRecibido.nombre.trim(),
                imei: (p.equipoRecibido.imei ?? '').trim() || null,
              }
            : null,
        marcaTarjeta: p.marcaTarjeta ?? null,
        cuotas: p.cuotas ?? null,
      })),
      descuentoGlobal,
      clienteId,
      idempotencyKey: clave.current,
      // Sin fiado no hay nada que financiar, y el servidor lo ignora igual.
      plan: hayFiado ? plan : null,
      // El recargo por fiar va aparte del plan: también se cobra «cuando
      // pueda», que es el fiado más común del local.
      recargoFiadoCentavos: hayFiado ? recargoFiadoCentavos : 0,
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

        {/* En el cobro el total manda sobre todo lo demás. */}
        <p className="text-xs font-bold tracking-[0.08em] text-(--color-tinta-suave) uppercase">
          Total a cobrar
        </p>
        <p className="cifra text-5xl leading-none">{formatearARS(totalConRecargo)}</p>
        {/* El recargo sube el total, así que el número grande ya lo incluye.
            Acá se dice de dónde salió: un total que no coincide con la suma
            del carrito, sin explicación, es la clase de cosa que hace dudar
            de la pantalla con el cliente enfrente. */}
        {recargoTotalCentavos > 0 ? (
          <p className="mt-1 text-xs text-(--color-tinta-suave)">
            {formatearARS(totales.totalCentavos)} de la compra y{' '}
            <strong className="tabular text-(--color-tinta)">
              {formatearARS(recargoTotalCentavos)}
            </strong>{' '}
            de recargo por el cheque.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-1.5">
          {(puedeFiar ? [...MEDIOS, CUENTA_CORRIENTE, CANJE] : [...MEDIOS, CANJE]).map(({ medio, tipoCuenta }) => (
            <button
              key={medio}
              type="button"
              onClick={() => agregarMedio(medio, tipoCuenta)}
              disabled={
                (medio === 'cuenta_corriente' && !cliente) || (medio === 'dolares' && !tcCentavos)
              }
              title={
                medio === 'cuenta_corriente' && !cliente
                  ? 'Elegí un cliente en el carrito para poder fiar'
                  : medio === 'dolares' && !tcCentavos
                    ? 'No hay cotización cargada: cargala en Dólar (F9) para poder cobrar en dólares'
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
                  <span className="flex-1 text-sm font-medium">
                    {nombreDelMedio(p.medio)}
                    {p.medio === 'dolares' ? (
                      <span className="ml-1 text-xs font-normal text-(--color-tinta-suave)">
                        en billetes
                      </span>
                    ) : null}
                    {p.medio === 'canje' ? (
                      <span className="ml-1 text-xs font-normal text-(--color-tinta-suave)">
                        entra un equipo
                      </span>
                    ) : null}
                  </span>
                  {p.medio === 'dolares' || (p.medio === 'canje' && p.cotizacionCentavos) ? (
                    <span aria-hidden="true" className="text-(--color-tinta-suave)">
                      US$
                    </span>
                  ) : null}
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

                {/*
                  El recargo del cheque: lo que cuesta cobrar con uno.
                  Antes se resolvía subiendo el precio a mano, y entonces el
                  comprobante decía que el producto valía otra cosa.
                */}
                {p.medio === 'cheque' ? (
                  <div className="mt-2">
                    <CampoRecargo
                      id={`recargo-${p.clave}`}
                      etiqueta="Recargo por el cheque"
                      baseCentavos={p.montoCentavos}
                      valor={p.recargoEscrito ?? null}
                      onCambiar={(v) => actualizar(p.clave, { recargoEscrito: v })}
                      cifra={formatearARS}
                      resumen={(c) =>
                        `El cheque se escribe por ${formatearARS(p.montoCentavos + c)}: ` +
                        `${formatearARS(p.montoCentavos)} de la compra y ${formatearARS(c)} de recargo.`
                      }
                    />
                  </div>
                ) : null}

                {/* En dólares, el número del campo no es el que suma contra el
                    total: acá se dice a cuántos pesos equivale y con qué dólar,
                    para que nadie tenga que confiar a ciegas. */}
                {p.medio === 'dolares' ? (
                  <p className="mt-1 text-xs text-(--color-tinta-suave)">
                    {p.montoUsdCentavos && p.cotizacionCentavos ? (
                      <>
                        Equivale a{' '}
                        <strong className="tabular font-semibold text-(--color-tinta)">
                          {formatearARS(p.montoCentavos)}
                        </strong>{' '}
                        al dólar de hoy ({formatearARS(p.cotizacionCentavos)})
                      </>
                    ) : (
                      <>Escribí cuántos dólares entraron.</>
                    )}
                  </p>
                ) : null}

                {/* El equipo que entra. Sin esto el canje no se puede grabar:
                    un pago que no deja ni plata ni deuda tiene que dejar, por
                    lo menos, el teléfono que lo justifica. */}
                {p.medio === 'canje' ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <input
                      type="text"
                      value={p.equipoRecibido?.nombre ?? ''}
                      placeholder="Equipo que entra · ej.: iPhone 13 128gb 87%"
                      aria-label="Equipo que entra en el canje"
                      onChange={(e) =>
                        actualizar(p.clave, {
                          equipoRecibido: {
                            ...(p.equipoRecibido ?? { nombre: '' }),
                            nombre: e.target.value,
                          },
                        })
                      }
                      className="min-h-10 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2 text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={p.equipoRecibido?.imei ?? ''}
                        placeholder="IMEI o serie"
                        aria-label="IMEI del equipo que entra"
                        onChange={(e) =>
                          actualizar(p.clave, {
                            equipoRecibido: {
                              ...(p.equipoRecibido ?? { nombre: '' }),
                              imei: e.target.value,
                            },
                          })
                        }
                        className="tabular min-h-10 w-full rounded-(--radius-caja) border border-(--color-borde) bg-(--color-papel) px-2 text-sm"
                      />
                    </div>
                    <p className="text-xs text-(--color-tinta-suave)">
                      Entra a stock con el valor del canje como costo, y sale a la venta. El IMEI
                      es lo que distingue dos equipos iguales: va en el nombre y en el comprobante.
                    </p>
                  </div>
                ) : null}

                {p.medio === 'credito' || p.medio === 'debito' ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <select
                      value={p.marcaTarjeta ?? ''}
                      onChange={(e) =>
                        actualizar(p.clave, { marcaTarjeta: e.target.value || null })
                      }
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
                          onChange={(e) =>
                            actualizar(p.clave, {
                              cuotas: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
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
          <p className="mt-3 rounded-(--radius-caja) bg-(--color-alerta-fondo) p-3 text-sm">
            Le vas a fiar <strong className="tabular">{cifraDeuda(fiadoEnDeudaCentavos)}</strong> a{' '}
            <strong>{cliente.nombre}</strong>
            {ventaEnDolares ? (
              <>
                {' '}
                —en dólares, como se vendió—{' '}
                <span className="text-(--color-tinta-media)">
                  ({formatearARS(fiadoCentavos)} de hoy)
                </span>
              </>
            ) : null}
            .{' '}
            {faltaElDolar ? (
              <strong className="text-(--color-error)">
                Esta venta se fía en dólares y no hay cotización cargada: el sistema no la va a
                dejar pasar hasta que la carguen en Dólar.
              </strong>
            ) : null}{' '}
            {(ventaEnDolares ? cliente.saldoUsdCentavos : cliente.saldoCentavos) > 0 ? (
              <>
                Ya debe{' '}
                <span className="tabular">
                  {cifraDeuda(ventaEnDolares ? cliente.saldoUsdCentavos : cliente.saldoCentavos)}
                </span>
                , así que va a quedar en{' '}
                <span className="tabular font-semibold">
                  {cifraDeuda(
                    (ventaEnDolares ? cliente.saldoUsdCentavos : cliente.saldoCentavos) +
                      fiadoEnDeudaCentavos,
                  )}
                </span>
                .
              </>
            ) : (
              'Es la primera vez que le fiás.'
            )}
            {/* El tope mide la deuda en pesos, que es la que limita. Una venta en
                dólares no la mueve, así que tampoco se avisa de un tope que no
                se va a pasar. */}
            {!ventaEnDolares &&
            cliente.limiteCentavos !== null &&
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

        {hayFiado && cliente ? (
          <PlanDeCuotas
            montoCentavos={fiadoEnDeudaCentavos}
            moneda={ventaEnDolares ? 'USD' : 'ARS'}
            plan={plan}
            recargo={recargoFiado}
            onCambiar={setPlan}
            onRecargo={setRecargoFiado}
          />
        ) : null}

        {cobro && pagos.length > 0 ? (
          <dl className="mt-4 flex flex-col gap-1 border-t border-(--color-borde) pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-(--color-tinta-suave)">Pagado</dt>
              <dd className="tabular">{formatearARS(cobro.pagadoCentavos)}</dd>
            </div>
            {cobro.faltanteCentavos > 0 ? (
              <div className="flex justify-between font-semibold text-(--color-alerta-tinta)">
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
          <ul className="mt-3 text-sm text-(--color-alerta-tinta)">
            {problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-(--radius-caja) bg-(--color-error-fondo) p-3 text-sm font-medium"
          >
            {error}
          </p>
        ) : null}

        {trabado ? (
          <div
            role="alert"
            className="mt-3 rounded-(--radius-caja) bg-(--color-error-fondo) p-3"
          >
            <p className="text-sm font-semibold text-(--color-error)">
              Este precio no se puede cobrar así
            </p>
            <p className="mt-1 text-sm">{trabado}</p>
            <p className="mt-2 text-sm">
              <strong>Qué hacer:</strong> sacá ese producto del carrito y cobrá el resto. Para
              venderlo, el precio hay que corregirlo en el catálogo.
            </p>
            <button
              type="button"
              onClick={onCerrar}
              className="mt-3 min-h-10 w-full rounded-(--radius-caja) bg-(--color-marca) text-sm font-semibold text-(--color-marca-texto)"
            >
              Volver al carrito
            </button>
          </div>
        ) : null}

        {aConfirmar ? (
          <div
            role="alert"
            className="mt-3 rounded-(--radius-caja) bg-(--color-alerta-fondo) p-3"
          >
            <p className="text-sm font-semibold text-(--color-alerta-tinta)">
              Frená: revisá el precio antes de cobrar
            </p>
            <p className="mt-1 text-sm">{aConfirmar}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCerrar}
                className="min-h-10 flex-1 rounded-(--radius-caja) bg-(--color-marca) px-3 text-sm font-semibold text-(--color-marca-texto)"
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
          className="mt-4 min-h-14 w-full rounded-(--radius-caja) bg-(--color-accion) text-lg font-bold text-(--color-accion-texto) transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {enviando ? 'Confirmando…' : 'Confirmar venta e imprimir'}
        </button>
      </div>
    </div>
  );
}
