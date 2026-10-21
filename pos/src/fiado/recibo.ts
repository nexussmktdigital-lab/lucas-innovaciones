/**
 * Recibo de un pago de fiado.
 *
 * Hasta acá, el que venía a pagar una cuota se iba **sin nada en la mano**. El
 * pago quedaba en el sistema y en la libreta del local, y del lado del cliente
 * no había ninguna constancia de que había pagado ni de cuánto le quedaba
 * debiendo. En una deuda que se paga de a poco durante meses, eso es
 * exactamente de lo que después se discute en el mostrador.
 *
 * El papel contesta las dos preguntas que trae el que paga: **cuánto entregué**
 * y **cuánto me queda**. El saldo va grande, al lado del monto, porque es el
 * número por el que vuelve.
 *
 * Usa la misma hoja que el comprobante de venta —mismo membrete, misma hoja de
 * estilos, misma impresora— para que el día que cambie el membrete cambien los
 * dos juntos.
 */
import { formatearARS, formatearUSD } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/fecha';
import {
  documento,
  escapar,
  nombreDelMedio,
  NEGOCIO_POR_DEFECTO,
  type DatosDelNegocio,
} from '@/ventas/ticket';

/** Un importe en su moneda. */
function cifraEn(centavos: number, moneda: 'ARS' | 'USD'): string {
  return moneda === 'USD' ? formatearUSD(centavos) : formatearARS(centavos);
}

export interface DatosDelRecibo {
  /** Código corto del pago, para poder encontrarlo. Ver `codigoDeRecibo`. */
  codigo: string;
  fecha: Date;
  cliente: string;
  documento?: string | null;
  /** Lo que se le descontó a la deuda, **en la moneda de esa deuda**. */
  montoCentavos: number;
  monedaDeuda: 'ARS' | 'USD';
  medio: string;
  /**
   * Lo que de verdad entró a la caja, cuando el medio no es de la moneda de la
   * deuda.
   *
   * Una cuota de US$ 200 pagada por transferencia cancela doscientos dólares y
   * hace entrar los pesos que valgan hoy. Son dos hechos y el papel dice los
   * dos: si dijera uno solo, el cliente que pagó pesos se lleva un recibo que
   * habla de dólares y no reconoce el número.
   */
  enCaja?: { montoCentavos: number; moneda: 'ARS' | 'USD' } | null;
  /**
   * Lo que se cobró de más, con su motivo, en la moneda de la deuda.
   *
   * **No bajó la deuda**: el cliente entregó monto + recargo y la cuenta bajó
   * solo por el monto. El papel dice los dos números porque si dijera uno
   * solo, el que pagó $22.000 y ve que le descontaron $20.000 va a creer que
   * le faltaron dos mil.
   */
  recargo?: { centavos: number; motivo: string } | null;
  /** Lo que queda debiendo DESPUÉS de este pago, en la moneda de la deuda. */
  saldoCentavos: number;
  /**
   * El saldo de la otra deuda, si tiene las dos.
   *
   * Un cliente puede deber pesos por un vidrio y dólares por un iPhone: son
   * dos deudas que no se suman (D62). Si el recibo mostrara solo la que se
   * pagó, diría «le queda $0» a alguien que debe US$ 600, y sería mentira por
   * omisión justo en el papel que se lleva.
   */
  otraDeuda?: { centavos: number; moneda: 'ARS' | 'USD' } | null;
  nota?: string | null;
  cobradoPor?: string | null;
}

/**
 * Un código corto y estable para el recibo, sacado del id del pago.
 *
 * Los pagos no llevan correlativo —el correlativo es de las ventas— y un
 * recibo sin ninguna identificación no se puede buscar cuando el cliente lo
 * trae de vuelta. Los ocho primeros dígitos del UUID alcanzan para encontrar
 * el pago, y son los mismos siempre: no hay nada que guardar ni que numerar.
 */
export function codigoDeRecibo(pagoId: string): string {
  return `RC-${pagoId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function generarRecibo(
  datos: DatosDelRecibo,
  opciones: { negocio?: DatosDelNegocio } = {},
): string {
  const negocio = opciones.negocio ?? NEGOCIO_POR_DEFECTO;
  const cancelada = datos.saldoCentavos <= 0;

  /*
   * El renglón de la caja: solo cuando las monedas no coinciden.
   *
   * Cuando se paga pesos de una deuda en pesos, los dos números son el mismo y
   * repetirlo sería ruido en un papel que tiene que leerse de un vistazo.
   */
  const recargoCentavos = datos.recargo?.centavos ?? 0;
  const PORQUE: Record<string, string> = {
    cheque: 'Recargo por pagar con cheque',
    demora: 'Recargo por la demora',
    otro: 'Recargo',
  };

  const renglonDeRecargo =
    recargoCentavos > 0
      ? `
      <div class="renglon">
        <div>
          <div class="producto">${escapar(PORQUE[datos.recargo!.motivo] ?? 'Recargo')}</div>
          <div class="detalle-chico">No descuenta deuda</div>
        </div>
        <div class="importe">${escapar(cifraEn(recargoCentavos, datos.monedaDeuda))}</div>
      </div>
      <div class="renglon">
        <div><div class="producto">Total entregado</div></div>
        <div class="importe">${escapar(
          cifraEn(datos.montoCentavos + recargoCentavos, datos.monedaDeuda),
        )}</div>
      </div>`
      : '';

  const renglonDeCaja = datos.enCaja
    ? `
      <div class="renglon">
        <div>
          <div class="producto">Entregó</div>
          <div class="detalle-chico">${escapar(nombreDelMedio(datos.medio))}</div>
        </div>
        <div class="importe">${escapar(cifraEn(datos.enCaja.montoCentavos, datos.enCaja.moneda))}</div>
      </div>`
    : '';

  /**
   * Una de las dos mitades del papel.
   *
   * El recibo entra dos veces en la misma hoja, con una línea de corte en el
   * medio: el cliente se lleva una y la otra queda firmada en el local. Es un
   * papel de tres renglones y un saldo, y en una hoja entera dejaba la mitad
   * de abajo en blanco en cada pago, todos los días.
   */
  const mitad = (copia: 'ORIGINAL · PARA EL CLIENTE' | 'DUPLICADO · PARA EL LOCAL') =>
    `<div class="mitad">
  <header class="membrete">
    <div>
      <img class="marca" src="/marca/lucas-innovaciones-negro.png" alt="${escapar(negocio.nombre)}">
      <div class="rubro">Tecnología y electrónica · desde 2007</div>
    </div>
    <div class="domicilio">
      ${escapar(negocio.direccion)}<br>
      ${escapar(negocio.localidad)}<br>
      ${negocio.telefono ? `<strong>${escapar(negocio.telefono)}</strong>` : ''}
    </div>
  </header>

  <div class="regla"></div>

  <div class="titulo">
    <span class="tipo acento">RECIBO DE PAGO</span>
    <span class="numero">${escapar(datos.codigo)}</span>
  </div>
  <div class="copia">${copia}</div>

  <div class="datos">
    <div>
      <span class="etiqueta">FECHA</span>
      <div class="dato">${escapar(formatearFechaHora(datos.fecha))}</div>
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
    <span class="etiqueta">CONCEPTO</span>
    <span class="etiqueta">IMPORTE</span>
  </div>

  <div class="renglon">
    <div>
      <div class="producto">Pago a cuenta de su deuda</div>
      <div class="detalle-chico">${escapar(
        datos.enCaja
          ? `Se le descuentan de la deuda${datos.monedaDeuda === 'USD' ? ' en dólares' : ' en pesos'}`
          : nombreDelMedio(datos.medio),
      )}</div>
    </div>
    <div class="importe">${escapar(cifraEn(datos.montoCentavos, datos.monedaDeuda))}</div>
  </div>
  ${renglonDeRecargo}
  ${renglonDeCaja}

  ${
    datos.nota
      ? `<div class="detalle-chico">${escapar(datos.nota)}</div>`
      : ''
  }

  <div class="regla-fina"></div>

  <!-- El saldo es lo que el cliente viene a saber, así que va donde en el
       comprobante de venta va el total: el renglón más grande de la hoja. -->
  <div class="total">
    <div>
      <span class="etiqueta acento">${cancelada ? 'DEUDA CANCELADA' : 'SALDO QUE QUEDA'}</span>
      <div class="detalle-chico">${escapar(
        cancelada
          ? datos.monedaDeuda === 'USD'
            ? 'No queda nada debiendo en dólares'
            : 'No queda nada debiendo'
          : 'Después de este pago',
      )}</div>
    </div>
    <div class="cifra">${escapar(cifraEn(Math.max(0, datos.saldoCentavos), datos.monedaDeuda))}</div>
  </div>

  ${
    datos.otraDeuda && datos.otraDeuda.centavos > 0
      ? `<div class="aviso">
    <strong>ADEMÁS DEBE ${datos.otraDeuda.moneda === 'USD' ? 'EN DÓLARES' : 'EN PESOS'}</strong>
    Esta cuenta tiene otra deuda, de ${escapar(
      cifraEn(datos.otraDeuda.centavos, datos.otraDeuda.moneda),
    )}, que no se toca con este pago. Son dos deudas separadas y se pagan por separado.
  </div>`
      : ''
  }

  <section class="garantia">
    <span class="etiqueta">CONSTANCIA</span>
    <p>
      El local recibió el importe detallado y lo imputó a la cuenta del cliente.
      ${cancelada ? 'Con este pago la cuenta queda saldada.' : 'El saldo es el que queda a la fecha de este recibo.'}
    </p>
  </section>

  <div class="relleno"></div>

  <div class="firmas">
    <div>
      <div class="linea-firma"></div>
      <span>Firma y sello del local${datos.cobradoPor ? ` · ${escapar(datos.cobradoPor)}` : ''}</span>
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

  const hoja = `<section class="hoja recibo">
${mitad('ORIGINAL · PARA EL CLIENTE')}
  <div class="corte"><span>CORTAR POR ACÁ</span></div>
${mitad('DUPLICADO · PARA EL LOCAL')}
</section>`;

  return documento(`Recibo ${datos.codigo}`, [hoja]);
}
