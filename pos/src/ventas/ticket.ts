/**
 * Comprobante de venta, en A4.
 *
 * Reemplaza al ticket de impresora térmica. El local vende iPhones de mil
 * quinientos dólares en cuotas y el cliente se lleva un papel que firma: una
 * tira de 80 mm no sirve para eso. Sale una sola copia, la del cliente; lo que
 * pasó queda en el sistema, que es mejor archivo que una hoja en un cajón.
 *
 * Se genera como HTML con hoja de impresión y se manda al diálogo del
 * navegador. Sin drivers raros, sin bibliotecas.
 *
 * **No es una factura.** El negocio no emite comprobante fiscal (D2) y el pie
 * lo dice, para que nadie lo confunda.
 *
 * Tres reglas sobre qué sale impreso, que las pidió el local:
 *
 *  1. **El precio del sistema, en su moneda.** Un iPhone se pacta en dólares y
 *     el papel dice dólares (D62). Nada de conversiones: el cliente firma el
 *     número que acordó, no el que da el dólar de hoy.
 *  2. **Los medios de pago no se imprimen.** Cómo se compuso el pago —tanto en
 *     efectivo, tanto transferido— es asunto interno. En el papel va lo que
 *     entregó y lo que queda debiendo, que es lo que al cliente le importa.
 *  3. **Quién atendió tampoco.** Está en el sistema, que es donde se consulta.
 */
import { formatearARS, formatearUSD } from '@/lib/dinero';
import { formatearFecha } from '@/lib/fecha';

export interface LineaDeTicket {
  descripcion: string;
  cantidad: number;
  /** Siempre en pesos: es lo que suma contra el total de la venta. */
  precioUnitarioCentavos: number;
  descuentoCentavos: number;
  totalCentavos: number;
  monedaOriginal: 'ARS' | 'USD';
  /** Solo en productos USD: el precio de origen, que es el que se imprime. */
  precioUsdCentavos: number | null;
  sku?: string | null;
}

/** Una cuota tal como se pactó, para que el papel diga cuándo vuelve a pagar. */
export interface CuotaDelComprobante {
  numero: number;
  /** `YYYY-MM-DD`. */
  vencimiento: string;
  montoCentavos: number;
}

export interface DatosDelNegocio {
  nombre: string;
  direccion: string;
  localidad: string;
  telefono?: string | null;
  pie?: string | null;
}

export interface DatosDelTicket {
  numero: string;
  fecha: Date;
  cliente?: string | null;
  /** DNI del cliente. Va en el comprobante que se firma. */
  documento?: string | null;
  lineas: readonly LineaDeTicket[];
  subtotalCentavos: number;
  descuentoCentavos: number;
  totalCentavos: number;
  /** Lo que se llevó fiado **de esta compra**, en pesos. Cero si pagó todo. */
  fiadoCentavos: number;
  /**
   * Las cuotas pactadas, si se pactaron.
   *
   * Sin esto el papel decía «queda debiendo» y nada más, y la fecha la discutía
   * cada uno de memoria. Van en la moneda de la deuda, igual que en el sistema.
   */
  cuotas?: readonly CuotaDelComprobante[];
  /**
   * En qué moneda quedó la deuda. La fija la venta, no el papel (D62).
   *
   * Va aparte de la moneda en la que se imprime el comprobante porque **no son
   * la misma pregunta**: una venta en dólares con descuento se imprime en pesos
   * —restar un descuento cargado en pesos de un precio en dólares exigiría
   * convertir— y sin embargo se debe en dólares, que es lo que acordaron. Sin
   * este dato, las cuotas de US$ 262,50 salían impresas como «$ 262,50».
   */
  monedaDeLaDeuda?: 'ARS' | 'USD';
  nota?: string | null;
  /**
   * El comprobante de una venta cobrada sin conexión (D56).
   *
   * Todavía no tiene número: el correlativo lo asigna el servidor y el servidor
   * no está. Lo que se cobró sí es definitivo, así que el comprobante sale
   * igual —el cliente se lleva su papel— pero dice en la cara que el número
   * llega después, para que nadie lo busque en el sistema y crea que se perdió.
   */
  provisional?: boolean;
}

/** Datos por defecto del local, hasta que se carguen en configuración. */
export const NEGOCIO_POR_DEFECTO: DatosDelNegocio = {
  nombre: 'Lucas Innovaciones',
  direccion: 'Caseros 924',
  localidad: 'Villa Santa Rosa, Córdoba',
  telefono: '3574-456139',
  pie: '¡Gracias por su compra!',
};

const NOMBRE_DEL_MEDIO: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  debito: 'Débito',
  credito: 'Crédito',
  dolares: 'Dólares',
  cheque: 'Cheque',
  mercadopago: 'Mercado Pago',
  cuenta_corriente: 'Cuenta corriente',
};

export function nombreDelMedio(medio: string): string {
  return NOMBRE_DEL_MEDIO[medio] ?? medio;
}

function escapar(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `2026-11-06` → `6 de noviembre de 2026`, como lo lee una persona. */
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

export function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split('-');
  const mes = MESES[Number(m) - 1];
  if (!a || !mes || !d) return iso;
  return `${Number(d)} de ${mes} de ${a}`;
}

/**
 * ¿El comprobante va en dólares?
 *
 * Solo cuando **todo** lo vendido está cotizado en dólares y no hubo ningún
 * descuento. Un descuento se carga en pesos, y restarlo de un precio en dólares
 * obligaría a convertir —justo lo que el local pidió que no pase en el papel—.
 * En ese caso el comprobante sale en pesos, que es la moneda en la que de
 * verdad se cobró.
 */
function montosEnDolares(datos: DatosDelTicket): boolean {
  const sinDescuentos =
    datos.descuentoCentavos === 0 && datos.lineas.every((l) => l.descuentoCentavos === 0);

  return (
    sinDescuentos &&
    datos.lineas.length > 0 &&
    datos.lineas.every((l) => l.monedaOriginal === 'USD' && l.precioUsdCentavos !== null)
  );
}

export function generarTicket(
  datos: DatosDelTicket,
  opciones: { negocio?: DatosDelNegocio } = {},
): string {
  const negocio = opciones.negocio ?? NEGOCIO_POR_DEFECTO;
  const enDolares = montosEnDolares(datos);
  const cifra = enDolares ? formatearUSD : formatearARS;

  /** Lo que se cobra por un renglón, en la moneda que se imprime. */
  const totalDeLinea = (l: LineaDeTicket) =>
    enDolares ? (l.precioUsdCentavos ?? 0) * l.cantidad : l.totalCentavos;

  const totalCentavos = enDolares
    ? datos.lineas.reduce((n, l) => n + totalDeLinea(l), 0)
    : datos.totalCentavos;

  /*
   * Lo entregado y el saldo, en la moneda del papel.
   *
   * Lo fiado viene en pesos, que es como lo guarda la venta. Cuando el
   * comprobante va en dólares se saca por diferencia contra el total —no por
   * conversión—, así que los dos números cierran entre sí sin meter ninguna
   * cotización en el medio.
   */
  const fiadoEnPesos = Math.max(0, Math.min(datos.fiadoCentavos, datos.totalCentavos));
  const entregadoCentavos = enDolares
    ? Math.round(totalCentavos * (1 - fiadoEnPesos / (datos.totalCentavos || 1)))
    : datos.totalCentavos - fiadoEnPesos;

  /*
   * El saldo va en la moneda de la DEUDA, que puede no ser la del papel.
   *
   * Y cuando hay cuotas, el saldo **son** las cuotas: su suma, no una cuenta
   * aparte que podría quedar a un centavo. El cliente firma un papel donde el
   * saldo y la suma de lo que va a pagar son el mismo número.
   */
  const cuotas = datos.cuotas ?? [];
  const monedaDeLaDeuda = datos.monedaDeLaDeuda ?? (enDolares ? 'USD' : 'ARS');
  const cifraDeLaDeuda = monedaDeLaDeuda === 'USD' ? formatearUSD : formatearARS;

  /*
   * Sin cuotas no hay cifra exacta de la deuda en su moneda —el papel no
   * convierte—, así que el saldo sale en la moneda del papel y, si la deuda es
   * en otra, el papel lo aclara en una línea. Con cuotas no hace falta
   * aclarar nada: están impresas con su signo.
   */
  const saldoCentavos =
    cuotas.length > 0
      ? cuotas.reduce((n, c) => n + c.montoCentavos, 0)
      : totalCentavos - entregadoCentavos;
  const cifraDelSaldo = cuotas.length > 0 ? cifraDeLaDeuda : cifra;
  const avisoDeMoneda =
    saldoCentavos > 0 && monedaDeLaDeuda === 'USD' && !enDolares
      ? 'El saldo quedó pactado en dólares.'
      : null;

  /*
   * «Pagado» y no «cancelado».
   *
   * En la jerga contable cancelar una operación es pagarla entera, pero el
   * papel lo lee el cliente, no un contador: debajo del total, «operación
   * cancelada en su totalidad» se lee como que la compra se dio de baja. Y el
   * POS usa esa misma palabra para lo otro —una venta anulada—, así que la
   * ambigüedad ni siquiera es solo del idioma.
   */
  const leyenda =
    saldoCentavos > 0
      ? `Entregó ${cifra(entregadoCentavos)} y queda un saldo de ${cifraDelSaldo(saldoCentavos)}` +
        (avisoDeMoneda ? ` · ${avisoDeMoneda}` : '')
      : 'Pagado en su totalidad';

  const detalle = datos.lineas
    .map((l) => {
      const unitario = enDolares ? (l.precioUsdCentavos ?? 0) : l.precioUnitarioCentavos;
      const porUnidad =
        l.cantidad > 1 ? `${l.cantidad} × ${escapar(cifra(unitario))}` : escapar(l.sku ?? '');

      return `
      <div class="renglon">
        <div>
          <div class="producto">${escapar(l.descripcion)}</div>
          ${porUnidad ? `<div class="detalle-chico">${porUnidad}</div>` : ''}
        </div>
        <div class="importe">${escapar(cifra(totalDeLinea(l)))}</div>
      </div>`;
    })
    .join('');

  const bloqueDeCuotas =
    cuotas.length > 0
      ? `
  <section class="cuotas">
    <div class="cuotas-encabezado">
      <span class="etiqueta">SALDO EN CUOTAS</span>
      <span class="detalle-chico">${cuotas.length} ${cuotas.length === 1 ? 'cuota' : 'cuotas'}</span>
    </div>
    ${cuotas
      .map(
        (c) => `
    <div class="cuota">
      <span class="cuota-n">${c.numero}</span>
      <span class="cuota-fecha">Vence el ${escapar(fechaLarga(c.vencimiento))}</span>
      <span class="cuota-monto">${escapar(cifraDeLaDeuda(c.montoCentavos))}</span>
    </div>`,
      )
      .join('')}
  </section>`
      : '';

  const anulada = datos.nota === 'VENTA ANULADA';

  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<title>Comprobante ${escapar(datos.numero)}</title>
<style>
  @page { size: A4; margin: 0; }

  * { box-sizing: border-box; }

  body {
    width: 210mm;
    min-height: 297mm;
    margin: 0;
    padding: 18mm 20mm 15mm;
    display: flex;
    flex-direction: column;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.45;
    color: #0a0a0a;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* El acento se imprime en gris: la jerarquía la sostienen el tamaño y el
     peso de la tipografía, no el color. */
  .acento { color: #16305B; }

  .membrete { display: flex; align-items: flex-start; justify-content: space-between; gap: 12mm; }
  .marca { height: 13mm; display: block; }
  .rubro { font-size: 8pt; color: #6b6b6b; margin-top: 2mm; }
  .domicilio { text-align: right; font-size: 8pt; color: #6b6b6b; line-height: 1.6; }
  .domicilio strong { color: #0a0a0a; font-size: 9pt; }

  .regla { height: 1mm; background: #0a0a0a; margin-top: 5mm; }
  .regla-fina { height: 0.2mm; background: #d9d9d9; margin: 5mm 0 0; }

  .titulo {
    display: flex; align-items: baseline; justify-content: space-between;
    padding-top: 3mm;
  }
  .titulo .tipo { font-size: 9.5pt; font-weight: 700; letter-spacing: 0.14em; }
  .titulo .numero { font-size: 12pt; font-weight: 700; font-variant-numeric: tabular-nums; }

  .datos {
    display: flex; gap: 10mm; margin-top: 6mm;
  }
  .datos > div:nth-child(2) { flex: 1; }
  .etiqueta {
    display: block;
    font-size: 7.5pt; font-weight: 700; letter-spacing: 0.1em; color: #6b6b6b;
  }
  .dato { font-size: 11pt; margin-top: 1mm; }

  .encabezado-detalle {
    display: flex; justify-content: space-between; padding: 4mm 0 2mm;
  }

  .renglon {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 10mm;
    padding: 2mm 0 3mm;
  }
  .producto { font-size: 12pt; font-weight: 600; line-height: 1.3; }
  .detalle-chico { font-size: 8.5pt; color: #6b6b6b; margin-top: 1mm; }
  .importe {
    font-size: 12.5pt; font-weight: 700; white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .total {
    display: flex; align-items: center; justify-content: space-between; gap: 10mm;
    border-top: 0.6mm solid #16305B;
    background: #f4f4f4;
    margin-top: 6mm;
    padding: 5mm 6mm;
  }
  .total .cifra {
    font-size: 24pt; font-weight: 700; line-height: 1; white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .cuotas { border: 0.2mm solid #d9d9d9; margin-top: 5mm; padding: 4mm 5mm 4mm; }
  .cuotas-encabezado { display: flex; align-items: baseline; justify-content: space-between; }
  .cuotas-encabezado .etiqueta { display: inline; }
  .cuota {
    display: flex; align-items: baseline; gap: 5mm;
    border-top: 0.2mm solid #ededed; padding: 2mm 0;
    margin-top: 2mm;
  }
  .cuota:first-of-type { margin-top: 2mm; }
  .cuota-n { width: 6mm; font-weight: 700; font-variant-numeric: tabular-nums; }
  .cuota-fecha { flex: 1; font-size: 10pt; }
  .cuota-monto {
    font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;
  }

  .garantia { margin-top: 6mm; }
  .garantia p { margin: 2mm 0 0; font-size: 9pt; line-height: 1.6; color: #3a3a3a; }
  /* En blanco a propósito: el plazo cambia según el producto y lo escriben a
     mano en el mostrador. */
  .en-blanco {
    display: inline-block; width: 28mm; border-bottom: 0.3mm solid #0a0a0a;
    margin: 0 1mm;
  }

  .relleno { flex: 1; min-height: 10mm; }

  .firmas { display: flex; gap: 14mm; margin-top: 10mm; }
  .firmas > div { flex: 1; }
  .linea-firma { height: 0.3mm; background: #0a0a0a; }
  .firmas span { display: block; font-size: 8pt; color: #6b6b6b; margin-top: 1.5mm; }

  .pie {
    display: flex; justify-content: space-between; gap: 8mm;
    border-top: 0.2mm solid #d9d9d9;
    margin-top: 6mm; padding-top: 3mm;
    font-size: 8pt; color: #6b6b6b;
  }

  .aviso {
    border: 0.4mm solid #0a0a0a;
    padding: 3mm 4mm;
    margin-top: 5mm;
    font-size: 9pt;
  }
  .aviso strong { display: block; letter-spacing: 0.08em; }

  @media screen {
    body { margin: 1rem auto; box-shadow: 0 2px 16px rgba(0, 0, 0, 0.18); }
  }
</style>
</head>
<body>
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
    <span class="tipo acento">COMPROBANTE DE VENTA</span>
    <span class="numero">N.º ${escapar(datos.numero)}</span>
  </div>

  ${
    datos.provisional
      ? `<div class="aviso">
    <strong>SIN CONEXIÓN</strong>
    El número de comprobante se asigna cuando vuelve internet. Lo cobrado es definitivo.
  </div>`
      : ''
  }

  ${
    anulada
      ? `<div class="aviso"><strong>VENTA ANULADA</strong>
    Esta venta se dio de baja en el sistema.</div>`
      : ''
  }

  <div class="datos">
    <div>
      <span class="etiqueta">FECHA</span>
      <div class="dato">${escapar(formatearFecha(datos.fecha))}</div>
    </div>
    <div>
      <span class="etiqueta">CLIENTE</span>
      <div class="dato">${escapar(datos.cliente ?? 'Consumidor final')}</div>
    </div>
    <div>
      <span class="etiqueta">DNI</span>
      <div class="dato">${escapar(datos.documento ?? '—')}</div>
    </div>
  </div>

  <div class="regla-fina"></div>

  <div class="encabezado-detalle">
    <span class="etiqueta">DETALLE</span>
    <span class="etiqueta">IMPORTE</span>
  </div>

  ${detalle}

  <div class="regla-fina"></div>

  <div class="total">
    <div>
      <span class="etiqueta acento">TOTAL</span>
      <div class="detalle-chico">${escapar(leyenda)}</div>
    </div>
    <div class="cifra">${escapar(cifra(totalCentavos))}</div>
  </div>

  ${bloqueDeCuotas}

  <section class="garantia">
    <span class="etiqueta">GARANTÍA</span>
    <p>
      <span class="en-blanco"></span> desde la fecha de este comprobante, por fallas de
      funcionamiento. No cubre daño por golpe, humedad ni manipulación de terceros. El reclamo se
      hace en el local, presentando este comprobante.
    </p>
  </section>

  <div class="relleno"></div>

  <div class="firmas">
    <div>
      <div class="linea-firma"></div>
      <span>Firma del cliente</span>
    </div>
    <div>
      <div class="linea-firma"></div>
      <span>Aclaración del cliente</span>
    </div>
  </div>

  <footer class="pie">
    <span>Documento no válido como factura.</span>
    <span>Consultas y garantía: ${escapar(negocio.telefono ?? '')}</span>
  </footer>

  <script>
    // Se imprime solo al abrir y se cierra al terminar: el mostrador no tiene
    // que hacer nada más que retirar la hoja.
    window.addEventListener('load', () => window.print());
    window.addEventListener('afterprint', () => window.close());
  </script>
</body>
</html>`;
}
