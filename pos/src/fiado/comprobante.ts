/**
 * Comprobante de una visita a la cuenta corriente.
 *
 * El recibo de pago contesta una pregunta —«cuanto entregue»— y alcanza
 * mientras la visita sea un pago. La del mayorista no lo es: trae mercaderia
 * de vuelta, entrega plata y a veces se lleva algo mas, todo en la misma
 * tarde. Tres hechos. Con el recibo solo, se iba con un papel que hablaba de
 * uno de los tres y con un saldo que no era el de cuando salio por la puerta.
 *
 * Este papel dice los tres y termina en el unico numero por el que vuelve:
 * **lo que queda debiendo**. Lo devuelto y lo entregado van juntos y con el
 * mismo signo —los dos bajan la deuda— aunque adentro del sistema sean cosas
 * distintas: uno movio stock y el otro movio caja. Esa diferencia es del
 * sistema; al cliente, en el mostrador, le importa que los dos descuentan.
 *
 * Usa la misma hoja que el comprobante de venta y el recibo —mismo membrete,
 * misma hoja de estilos, misma impresora— para que el dia que cambie el
 * membrete cambien los tres juntos.
 */
import { formatearARS } from '@/lib/dinero';
import { formatearFecha, formatearHora } from '@/lib/fecha';
import type { MovimientoDeCuenta } from './cuenta';
import {
  documento,
  escapar,
  nombreDelMedio,
  NEGOCIO_POR_DEFECTO,
  type DatosDelNegocio,
} from '@/ventas/ticket';

export interface DatosDelComprobante {
  /** Codigo corto, para poder encontrarlo cuando el cliente lo trae de vuelta. */
  codigo: string;
  /** El dia de la visita, `YYYY-MM-DD`. */
  dia: string;
  cliente: string;
  documento?: string | null;
  /** Los movimientos de la visita, del mas viejo al mas nuevo. */
  renglones: readonly MovimientoDeCuenta[];
  /** Lo que queda debiendo al final de la visita. */
  saldoCentavos: number;
  /** Ese dia hubo mas movimientos despues de este papel. */
  hayPosteriores?: boolean;
  /** Ese dia hubo ademas movimientos en dolares, que son otra deuda (D62). */
  hayDolares?: boolean;
  /** Lo que debe en dolares hoy, si debe. */
  deudaUsdCentavos?: number;
  atendidoPor?: string | null;
}

/**
 * Un codigo corto y estable, sacado del cliente y del dia.
 *
 * No hay nada que numerar ni que guardar: el mismo cliente y el mismo dia dan
 * siempre el mismo codigo, asi que una reimpresion sale identica a la que se
 * entrego. Es lo que hace falta para encontrar la visita, que es para lo que
 * sirve el codigo de un papel que despues se discute.
 */
export function codigoDeComprobante(clienteId: string, dia: string): string {
  const cliente = clienteId.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `CC-${cliente}-${dia.replace(/-/g, '').slice(2)}`;
}

/** Como se lee cada movimiento en el papel: concepto, aclaracion y signo. */
function comoSeLee(m: MovimientoDeCuenta): {
  concepto: string;
  aclaracion: string;
  baja: boolean;
} {
  switch (m.tipo) {
    case 'devolucion':
      return {
        concepto: 'Devolvió mercadería',
        aclaracion: 'Se le descuenta de la deuda',
        baja: true,
      };
    case 'cobro':
      return { concepto: 'Entregó', aclaracion: nombreDelMedio(m.medio), baja: true };
    case 'venta':
      return {
        concepto: `Se llevó mercadería · ${m.descripcion}`,
        aclaracion: m.anulada ? 'Anulada después' : 'Se suma a la deuda',
        baja: false,
      };
    case 'compra':
      return { concepto: 'Se llevó mercadería', aclaracion: 'Se suma a la deuda', baja: false };
  }
}

export function generarComprobante(
  datos: DatosDelComprobante,
  opciones: { negocio?: DatosDelNegocio } = {},
): string {
  const negocio = opciones.negocio ?? NEGOCIO_POR_DEFECTO;
  const cancelada = datos.saldoCentavos <= 0;

  const renglones = datos.renglones
    .map((m) => {
      const { concepto, aclaracion, baja } = comoSeLee(m);
      /*
       * El detalle va completo y no recortado: en una devolucion es
       * exactamente lo que se discute despues —cuales trajo y por cuanto se
       * los tomaron—, y un «y 3 mas» convierte el papel en una promesa.
       */
      const detalle = m.tipo === 'compra' || m.tipo === 'devolucion' ? m.detalle : null;
      return `
      <div class="renglon">
        <div>
          <div class="producto">${escapar(concepto)}</div>
          <div class="detalle-chico">${escapar(formatearHora(m.fecha))} · ${escapar(aclaracion)}</div>
          ${detalle ? `<div class="renglones-cargo">${escapar(detalle)}</div>` : ''}
        </div>
        <div class="importe">${baja ? '−' : '+'}${escapar(formatearARS(m.montoCentavos))}</div>
      </div>`;
    })
    .join('');

  const avisos = [
    datos.hayPosteriores
      ? `<div class="aviso">
    <strong>HUBO MÁS MOVIMIENTOS ESE DÍA</strong>
    Después de este comprobante la cuenta tuvo otros movimientos, que no están
    en este papel y no estan en el saldo de arriba.
  </div>`
      : '',
    datos.hayDolares
      ? `<div class="aviso">
    <strong>ESE DÍA TAMBIÉN HUBO MOVIMIENTOS EN DÓLARES</strong>
    Van en comprobante aparte: la deuda en dólares es otra deuda y no se suma a
    la de pesos.
  </div>`
      : '',
    datos.deudaUsdCentavos && datos.deudaUsdCentavos > 0 && !datos.hayDolares
      ? `<div class="aviso">
    <strong>ADEMÁS DEBE EN DÓLARES</strong>
    Esta cuenta tiene otra deuda, en dólares, que no se toca con estos
    movimientos. Son dos deudas separadas y se pagan por separado.
  </div>`
      : '',
  ].join('');

  /**
   * Una de las dos mitades del papel: el cliente se lleva una y la otra queda
   * firmada en el local. Es el mismo reparto que el recibo de pago, y por el
   * mismo motivo: lo que despues se discute es cuanto se habia descontado ya.
   */
  const mitad = (copia: 'ORIGINAL · PARA EL CLIENTE' | 'DUPLICADO · PARA EL LOCAL') =>
    `<div class="mitad">
  <header class="membrete">
    <div>
      <img class="marca" src="/marca/lucas-innovaciones-negro.png" alt="${escapar(negocio.nombre)}">
      <div class="rubro">Tecnología y electrónica</div>
    </div>
    <div class="domicilio">
      ${escapar(negocio.direccion)}<br>
      ${escapar(negocio.localidad)}<br>
      ${negocio.telefono ? `<strong>${escapar(negocio.telefono)}</strong>` : ''}
    </div>
  </header>

  <div class="regla"></div>

  <div class="titulo">
    <span class="tipo acento">COMPROBANTE DE CUENTA</span>
    <span class="numero">${escapar(datos.codigo)}</span>
  </div>
  <div class="copia">${copia}</div>

  <div class="datos">
    <div>
      <span class="etiqueta">FECHA</span>
      <div class="dato">${escapar(formatearFecha(new Date(`${datos.dia}T12:00:00Z`)))}</div>
    </div>
    <div>
      <span class="etiqueta">CLIENTE</span>
      <div class="dato">${escapar(datos.cliente)}</div>
    </div>
    <div>
      <span class="etiqueta">DNI</span>
      <div class="dato">${escapar(datos.documento ?? '—')}</div>
    </div>
  </div>

  <div class="regla-fina"></div>

  <div class="encabezado-detalle">
    <span class="etiqueta">MOVIMIENTOS DEL DÍA</span>
    <span class="etiqueta">IMPORTE</span>
  </div>
${renglones}

  <div class="regla-fina"></div>

  <!-- El saldo es lo que el cliente viene a saber, así que va donde en el
       comprobante de venta va el total: el renglón más grande de la hoja. -->
  <div class="total">
    <div>
      <span class="etiqueta acento">${cancelada ? 'DEUDA CANCELADA' : 'SALDO QUE QUEDA'}</span>
      <div class="detalle-chico">${escapar(
        cancelada ? 'No queda nada debiendo' : 'Después de estos movimientos',
      )}</div>
    </div>
    <div class="cifra">${escapar(formatearARS(Math.max(0, datos.saldoCentavos)))}</div>
  </div>

  ${avisos}

  <section class="garantia">
    <span class="etiqueta">CONSTANCIA</span>
    <p>
      El local recibió la mercadería y los importes detallados y los imputó a la
      cuenta del cliente.
      ${cancelada ? 'Con estos movimientos la cuenta queda saldada.' : 'El saldo es el que queda a la fecha de este comprobante.'}
    </p>
  </section>

  <div class="relleno"></div>

  <div class="firmas">
    <div>
      <div class="linea-firma"></div>
      <span>Firma y sello del local${datos.atendidoPor ? ` · ${escapar(datos.atendidoPor)}` : ''}</span>
    </div>
    <div>
      <div class="linea-firma"></div>
      <span>Firma del cliente</span>
    </div>
  </div>

  <footer class="pie">
    <span>Documento no válido como factura.</span>
    <span>Consultas: ${escapar(negocio.telefono ?? '')}</span>
  </footer>

</div>`;

  const hoja = `<section class="hoja recibo comprobante">
${mitad('ORIGINAL · PARA EL CLIENTE')}
  <div class="corte"><span>CORTAR POR ACÁ</span></div>
${mitad('DUPLICADO · PARA EL LOCAL')}
</section>`;

  /*
   * Los renglones de lo devuelto y de lo que se llevó, en chico y respetando
   * los saltos de línea con que se cargaron. Es la única regla que la hoja
   * compartida no traía: el recibo de pago no tiene detalle que mostrar.
   */
  const estilo = `
  .comprobante .renglones-cargo {
    font-size: 8.5pt;
    line-height: 1.35;
    color: #3a3a3a;
    margin-top: 1mm;
    white-space: pre-wrap;
  }
  .comprobante .mitad .renglon { padding: 1mm 0 1.5mm; }
  .comprobante .mitad .producto { font-size: 11pt; }
`;

  return documento(`Comprobante ${datos.codigo}`, [hoja], estilo);
}
