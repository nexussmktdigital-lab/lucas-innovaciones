'use client';

/**
 * Pantalla de venta.
 *
 * Es la que más se usa, así que manda la velocidad: el foco arranca en el
 * buscador y vuelve ahí solo, Enter agrega el primer resultado, y todo el flujo
 * se puede hacer sin soltar el teclado. El lector de código de barras se
 * comporta como un teclado que escribe muy rápido y termina con Enter, así que
 * cae por el mismo camino sin configuración.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { calcularCobro, calcularTotales, type Descuento, type LineaCarrito } from '@/ventas/carrito';
import type { ResultadoBusqueda } from '@/ventas/buscar';
import { generarTicket } from '@/ventas/ticket';
import { formatearARS, formatearUSD } from '@/lib/dinero';
import { registrarVenta } from '@/app/acciones-venta';
import { usarOffline } from '@/offline/usar-offline';
import { resumirVenta } from '@/offline/cola';
import Buscador from './buscador';
import Carrito from './carrito';
import Cobro from './cobro';
import BarraOffline from './barra-offline';

export interface Cuenta {
  id: string;
  nombre: string;
  tipo: 'efectivo' | 'banco' | 'mercadopago' | 'otro';
}

export interface Cliente {
  id: string;
  nombre: string;
  telefono: string | null;
  /** Lo que ya debe. Se muestra al elegirlo: fiarle es sumarle a esto. */
  saldoCentavos: number;
  limiteCentavos: number | null;
}

/**
 * Cómo le fue al cobro.
 *
 * Sin conexión no hay venta con número todavía: hay una venta cobrada y
 * guardada. Es un final distinto del de siempre y por eso tiene su propio caso,
 * en vez de inventar un `ventaId` vacío que la pantalla usaría para armar un
 * enlace roto.
 */
export type ResultadoDelCobro =
  | Awaited<ReturnType<typeof registrarVenta>>
  | { ok: true; diferida: true };

/** Una línea del carrito más lo que hace falta para mostrarla y editarla. */
export interface LineaEnPantalla extends LineaCarrito {
  /** Identificador de la fila, para poder repetir el mismo producto. */
  clave: string;
  stockDisponible: number;
  gestionaStock: boolean;
  precioEditable: boolean;
}

interface Props {
  terminal: string;
  vendedor: string;
  esDuenio: boolean;
  tcCentavos: number | null;
  cuentas: Cuenta[];
  clientes: Cliente[];
  pendientesDeSync: number;
  /** True si quien atiende puede dar de alta un producto que falta. */
  puedeCargarProductos: boolean;
  /** El turno abierto. Una venta cobrada sin conexión entra con este. */
  cashSessionId: string;
}

export default function PantallaVenta({
  terminal,
  vendedor,
  esDuenio,
  tcCentavos,
  cuentas,
  clientes,
  pendientesDeSync,
  puedeCargarProductos,
  cashSessionId,
}: Props) {
  const router = useRouter();
  const offline = usarOffline();
  const [lineas, setLineas] = useState<LineaEnPantalla[]>([]);
  const [descuentoGlobal, setDescuentoGlobal] = useState<Descuento | null>(null);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Solo se usa si el navegador bloqueó la ventana del comprobante. */
  const [ultimoTicket, setUltimoTicket] = useState<{ id: string; numero: string } | null>(null);
  const enfocarBuscador = useRef<() => void>(() => {});

  const totales = useMemo(() => calcularTotales(lineas, descuentoGlobal), [lineas, descuentoGlobal]);

  const agregar = useCallback(
    (r: ResultadoBusqueda, precioManualCentavos?: number) => {
      setAviso(null);

      if (r.moneda === 'USD' && !tcCentavos) {
        setAviso(
          `"${r.nombre}" se vende en dólares y no hay cotización cargada. Cargá el tipo de cambio antes de venderlo.`,
        );
        return;
      }

      const disponible = r.gestionaStock ? r.stock - r.stockComprometido : Number.POSITIVE_INFINITY;
      const clave = `${r.id}:${r.variantId ?? ''}`;

      setLineas((previas) => {
        const existente = previas.find((l) => l.clave === clave);
        const yaEnCarrito = existente?.cantidad ?? 0;

        if (r.gestionaStock && yaEnCarrito + 1 > disponible) {
          setAviso(`No hay más stock de "${r.nombre}": quedan ${Math.max(0, disponible)}.`);
          return previas;
        }

        if (existente) {
          return previas.map((l) => (l.clave === clave ? { ...l, cantidad: l.cantidad + 1 } : l));
        }

        // En un producto en dólares el precio en pesos lo calcula el sistema.
        // Acá se muestra el mismo número que va a recalcular el servidor.
        const precioUnitarioCentavos =
          r.moneda === 'USD' && r.precioUsdCentavos && tcCentavos
            ? Math.round((r.precioUsdCentavos * tcCentavos) / 100 / 100_000) * 100_000
            : (precioManualCentavos ?? r.precioCentavos);

        return [
          ...previas,
          {
            clave,
            productId: r.id,
            variantId: r.variantId,
            descripcion: r.nombre,
            cantidad: 1,
            precioUnitarioCentavos,
            monedaOriginal: r.moneda,
            precioUsdCentavos: r.precioUsdCentavos,
            descuentoCentavos: 0,
            stockDisponible: disponible,
            gestionaStock: r.gestionaStock,
            precioEditable: r.precioEditable,
          },
        ];
      });
    },
    [tcCentavos],
  );

  const cambiarCantidad = useCallback((clave: string, cantidad: number) => {
    setLineas((previas) =>
      previas.flatMap((l) => {
        if (l.clave !== clave) return [l];
        if (cantidad <= 0) return [];
        if (l.gestionaStock && cantidad > l.stockDisponible) {
          setAviso(`Solo quedan ${l.stockDisponible} de "${l.descripcion}".`);
          return [{ ...l, cantidad: l.stockDisponible }];
        }
        return [{ ...l, cantidad }];
      }),
    );
  }, []);

  const cambiarPrecio = useCallback((clave: string, centavos: number) => {
    setLineas((previas) =>
      previas.map((l) => (l.clave === clave ? { ...l, precioUnitarioCentavos: centavos } : l)),
    );
  }, []);

  const cambiarDescuentoDeLinea = useCallback((clave: string, centavos: number) => {
    setLineas((previas) =>
      previas.map((l) => (l.clave === clave ? { ...l, descuentoCentavos: centavos } : l)),
    );
  }, []);

  const quitar = useCallback((clave: string) => {
    setLineas((previas) => previas.filter((l) => l.clave !== clave));
  }, []);

  const vaciar = useCallback(() => {
    setLineas([]);
    setDescuentoGlobal(null);
    setClienteId(null);
    setAviso(null);
    enfocarBuscador.current();
  }, []);

  // Atajos globales. F2 vuelve al buscador desde donde sea; F12 abre el cobro.
  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if (e.key === 'F2') {
        e.preventDefault();
        enfocarBuscador.current();
      }
      if (e.key === 'F12' && lineas.length > 0) {
        e.preventDefault();
        setCobrando(true);
      }
      if (e.key === 'Escape' && cobrando) setCobrando(false);
    }
    window.addEventListener('keydown', alTeclado);
    return () => window.removeEventListener('keydown', alTeclado);
  }, [lineas.length, cobrando]);

  /**
   * Guarda una venta cobrada sin conexión y saca su comprobante provisorio.
   *
   * El orden importa: primero se guarda, después se imprime. Si se hiciera al
   * revés y el almacén fallara, el cliente se iría con un papel de una venta
   * que no existe en ninguna parte.
   */
  async function cobrarSinConexion(
    datos: Parameters<typeof registrarVenta>[0],
    ventana: Window | null,
  ): Promise<ResultadoDelCobro> {
    const capturadaEn = new Date();
    const cobro = calcularCobro(totales.totalCentavos, datos.pagos);

    try {
      await offline.guardarVenta({
        idempotencyKey: datos.idempotencyKey,
        capturadaEn: capturadaEn.toISOString(),
        cashSessionId,
        totalCentavos: totales.totalCentavos,
        vueltoCentavos: cobro.vueltoCentavos,
        resumen: resumirVenta(lineas),
        preciosCobradosCentavos: lineas.map((l) => l.precioUnitarioCentavos),
        datos,
        intentos: 0,
      });
    } catch {
      ventana?.close();
      return {
        ok: false,
        error:
          'No hay conexión y este navegador no puede guardar la venta. No cobres hasta que vuelva internet.',
      };
    }

    if (ventana) {
      ventana.document.write(
        generarTicket({
          numero: 'Pendiente',
          fecha: capturadaEn,
          vendedor,
          cliente: clientes.find((c) => c.id === clienteId)?.nombre ?? null,
          lineas: lineas.map((l) => ({
            descripcion: l.descripcion,
            cantidad: l.cantidad,
            precioUnitarioCentavos: l.precioUnitarioCentavos,
            descuentoCentavos: l.descuentoCentavos,
            totalCentavos: Math.max(
              0,
              l.precioUnitarioCentavos * l.cantidad - l.descuentoCentavos,
            ),
            monedaOriginal: l.monedaOriginal,
            precioUsdCentavos: l.precioUsdCentavos,
          })),
          subtotalCentavos: totales.subtotalCentavos,
          descuentoCentavos: totales.descuentoGlobalCentavos + totales.descuentoLineasCentavos,
          totalCentavos: totales.totalCentavos,
          pagos: datos.pagos.map((p) => ({
            medio: p.medio,
            montoCentavos: p.montoCentavos,
            marcaTarjeta: p.marcaTarjeta ?? null,
            cuotas: p.cuotas ?? null,
          })),
          vueltoCentavos: cobro.vueltoCentavos,
          tcAplicadoCentavos: lineas.some((l) => l.monedaOriginal === 'USD') ? tcCentavos : null,
          provisional: true,
        }),
      );
      ventana.document.close();
    }

    vaciar();
    setCobrando(false);
    return { ok: true, diferida: true };
  }

  async function confirmar(datos: Parameters<typeof registrarVenta>[0]): Promise<ResultadoDelCobro> {
    // La ventana del ticket se pide ANTES de esperar al servidor. Abrirla
    // después es abrirla fuera del gesto del cajero, y Safari —el navegador de
    // la caja— la bloquea: la venta entraba y el comprobante no salía nunca.
    const ventana = window.open('', '_blank', 'width=420,height=760');

    if (!offline.hayConexion) return cobrarSinConexion(datos, ventana);

    let r: Awaited<ReturnType<typeof registrarVenta>>;
    try {
      r = await registrarVenta(datos);
    } catch {
      // Se cayó la conexión entre que se apretó Confirmar y la respuesta. La
      // venta puede haber entrado o no, y la clave de idempotencia es la misma:
      // si entró, subirla de nuevo devuelve la que ya está.
      return cobrarSinConexion(datos, ventana);
    }

    if (!r.ok) {
      ventana?.close();
      return r;
    }

    // El ticket se manda a imprimir solo. Si el navegador igual bloqueó la
    // ventana, queda el enlace en pantalla: nunca se pierde el comprobante.
    if (ventana) ventana.location.href = `/ticket/${r.ventaId}`;
    else setUltimoTicket({ id: r.ventaId, numero: r.numero });

    vaciar();
    setCobrando(false);
    router.refresh();
    return r;
  }

  return (
    <div className="mx-auto max-w-7xl">
      <BarraOffline
        hayConexion={offline.hayConexion}
        catalogo={offline.catalogo}
        catalogoVieja={offline.catalogoVieja}
        enCola={offline.enCola}
        subiendo={offline.subiendo}
        trabada={offline.trabada}
        avisos={offline.avisos}
        disponible={offline.disponible}
        onSubir={() => void offline.subirLaCola()}
        onDescartarAvisos={offline.descartarAvisos}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_26rem]">
      <section aria-label="Buscar productos" className="min-w-0">
        <Buscador
          onAgregar={agregar}
          registrarFoco={(fn) => {
            enfocarBuscador.current = fn;
          }}
          tcCentavos={tcCentavos}
          puedeCargar={puedeCargarProductos}
          hayConexion={offline.hayConexion}
          catalogo={offline.catalogo}
        />
      </section>

      <aside aria-label="Carrito" className="min-w-0">
        <Carrito
          lineas={lineas}
          totales={totales}
          descuentoGlobal={descuentoGlobal}
          puedeDescontar={esDuenio}
          clientes={clientes}
          clienteId={clienteId}
          puedeFiar={esDuenio}
          tcCentavos={tcCentavos}
          onCantidad={cambiarCantidad}
          onPrecio={cambiarPrecio}
          onDescuentoDeLinea={cambiarDescuentoDeLinea}
          onDescuentoGlobal={setDescuentoGlobal}
          onCliente={setClienteId}
          onQuitar={quitar}
          onVaciar={vaciar}
          onCobrar={() => setCobrando(true)}
        />

        {aviso ? (
          <p
            role="alert"
            className="mt-3 rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-3 text-sm"
          >
            {aviso}
          </p>
        ) : null}

        {ultimoTicket ? (
          <p
            role="alert"
            className="mt-3 rounded-(--radius-caja) border border-(--color-alerta) bg-(--color-alerta)/10 p-3 text-sm"
          >
            La venta <strong>{ultimoTicket.numero}</strong> quedó registrada, pero el navegador
            bloqueó la ventana del comprobante.{' '}
            <a
              href={`/ticket/${ultimoTicket.id}`}
              target="_blank"
              rel="noopener"
              onClick={() => setUltimoTicket(null)}
              className="font-semibold underline underline-offset-2"
            >
              Abrir el ticket
            </a>
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--color-tinta-suave)">
          <span>Terminal {terminal}</span>
          <span>·</span>
          <span>{vendedor}</span>
          {tcCentavos ? (
            <>
              <span>·</span>
              <span className="tabular">Dólar {formatearARS(tcCentavos)}</span>
            </>
          ) : (
            <>
              <span>·</span>
              <span className="font-semibold text-(--color-alerta)">Sin cotización</span>
            </>
          )}
          {pendientesDeSync > 0 ? (
            <>
              <span>·</span>
              <span className="font-semibold text-(--color-alerta)">
                {pendientesDeSync} sin sincronizar
              </span>
            </>
          ) : null}
        </div>
      </aside>

      {cobrando ? (
        <Cobro
          totales={totales}
          lineas={lineas}
          descuentoGlobal={descuentoGlobal}
          clienteId={clienteId}
          cliente={clientes.find((c) => c.id === clienteId) ?? null}
          puedeFiar={esDuenio}
          cuentas={cuentas}
          onCerrar={() => setCobrando(false)}
          onConfirmar={confirmar}
        />
      ) : null}
      </div>
    </div>
  );
}

/** Muestra el precio de una línea: en dólares, las dos cifras. */
export function PrecioDeLinea({
  centavos,
  usdCentavos,
}: {
  centavos: number;
  usdCentavos: number | null;
}) {
  return (
    <span className="tabular">
      {formatearARS(centavos)}
      {usdCentavos ? (
        <span className="ml-1 text-xs text-(--color-tinta-suave)">
          {formatearUSD(usdCentavos)}
        </span>
      ) : null}
    </span>
  );
}
