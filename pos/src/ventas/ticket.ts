/**
 * Comprobante de venta para impresora termica.
 *
 * Se genera como HTML con hoja de impresion y se manda al dialogo del
 * navegador, con la termica puesta como predeterminada. Sin drivers raros, sin
 * bibliotecas: es lo que ya hace el POS actual y funciona en este hardware.
 *
 * **No es una factura.** El negocio no emite comprobante fiscal (D2) y el pie
 * del ticket lo dice, para que nadie lo confunda.
 */
import { formatearARS, formatearUSD } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/fecha';

export type AnchoDeTicket = 58 | 80;

export interface LineaDeTicket {
  descripcion: string;
  cantidad: number;
  precioUnitarioCentavos: number;
  descuentoCentavos: number;
  totalCentavos: number;
  monedaOriginal: 'ARS' | 'USD';
  precioUsdCentavos: number | null;
  sku?: string | null;
}

export interface PagoDeTicket {
  medio: string;
  montoCentavos: number;
  marcaTarjeta?: string | null;
  cuotas?: number | null;
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
  vendedor: string;
  cliente?: string | null;
  lineas: readonly LineaDeTicket[];
  subtotalCentavos: number;
  descuentoCentavos: number;
  totalCentavos: number;
  pagos: readonly PagoDeTicket[];
  vueltoCentavos: number;
  tcAplicadoCentavos: number | null;
  nota?: string | null;
  /**
   * El ticket de una venta cobrada sin conexión (D56).
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
  telefono: null,
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

/** Espacio disponible en caracteres, para que las columnas no se pisen. */
function anchoEnCaracteres(ancho: AnchoDeTicket): number {
  return ancho === 58 ? 32 : 48;
}

export function generarTicket(
  datos: DatosDelTicket,
  opciones: { ancho?: AnchoDeTicket; negocio?: DatosDelNegocio } = {},
): string {
  const ancho = opciones.ancho ?? 80;
  const negocio = opciones.negocio ?? NEGOCIO_POR_DEFECTO;
  const columnas = anchoEnCaracteres(ancho);

  const lineas = datos.lineas
    .map((l) => {
      const unitario = formatearARS(l.precioUnitarioCentavos);
      const enDolares =
        l.monedaOriginal === 'USD' && l.precioUsdCentavos
          ? `<div class="usd">${escapar(formatearUSD(l.precioUsdCentavos))} c/u</div>`
          : '';
      const descuento =
        l.descuentoCentavos > 0
          ? `<div class="usd">Descuento −${escapar(formatearARS(l.descuentoCentavos))}</div>`
          : '';

      return `
      <div class="linea">
        <div class="desc">${escapar(l.descripcion)}</div>
        <div class="fila">
          <span>${l.cantidad} × ${escapar(unitario)}</span>
          <span class="monto">${escapar(formatearARS(l.totalCentavos))}</span>
        </div>
        ${enDolares}
        ${descuento}
      </div>`;
    })
    .join('');

  const pagos = datos.pagos
    .map((p) => {
      const detalle =
        p.marcaTarjeta || p.cuotas
          ? ` (${[p.marcaTarjeta, p.cuotas ? `${p.cuotas} cuotas` : null].filter(Boolean).join(', ')})`
          : '';
      return `<div class="fila"><span>${escapar(nombreDelMedio(p.medio) + detalle)}</span><span class="monto">${escapar(formatearARS(p.montoCentavos))}</span></div>`;
    })
    .join('');

  const vuelto =
    datos.vueltoCentavos > 0
      ? `<div class="fila fuerte"><span>Vuelto</span><span class="monto">${escapar(formatearARS(datos.vueltoCentavos))}</span></div>`
      : '';

  /*
   * Lo que se llevó fiado, dicho con todas las letras.
   *
   * «Cuenta corriente $7.000» entre los medios de pago es correcto y no alcanza:
   * este es el papel que el cliente guarda y con el que se discute después. Va
   * el monto de ESTA compra y no el saldo total, que cambia con el tiempo y
   * volvería mentiroso a un comprobante reimpreso el mes que viene.
   */
  const fiadoCentavos = datos.pagos
    .filter((p) => p.medio === 'cuenta_corriente')
    .reduce((n, p) => n + p.montoCentavos, 0);

  const fiado =
    fiadoCentavos > 0
      ? `<div class="fila fuerte aviso"><span>Queda debiendo de esta compra</span><span class="monto">${escapar(formatearARS(fiadoCentavos))}</span></div>`
      : '';

  const descuento =
    datos.descuentoCentavos > 0
      ? `<div class="fila"><span>Descuento</span><span class="monto">−${escapar(formatearARS(datos.descuentoCentavos))}</span></div>`
      : '';

  const cotizacion = datos.tcAplicadoCentavos
    ? `<div class="pie-nota">Cotización aplicada: ${escapar(formatearARS(datos.tcAplicadoCentavos))} por dólar</div>`
    : '';

  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<title>Comprobante ${escapar(datos.numero)}</title>
<style>
  @page { size: ${ancho}mm auto; margin: 0; }

  * { box-sizing: border-box; }

  body {
    width: ${ancho}mm;
    margin: 0;
    padding: 3mm;
    font-family: ui-monospace, 'Courier New', monospace;
    font-size: ${ancho === 58 ? '10px' : '11.5px'};
    line-height: 1.35;
    color: #000;
    background: #fff;
  }

  .centro { text-align: center; }
  .negocio { font-weight: 700; font-size: ${ancho === 58 ? '13px' : '15px'}; }
  .chico { font-size: ${ancho === 58 ? '9px' : '10px'}; }

  hr {
    border: none;
    border-top: 1px dashed #000;
    margin: 2mm 0;
  }

  .fila { display: flex; justify-content: space-between; gap: 2mm; }
  .monto { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .fuerte { font-weight: 700; }
  /* La térmica imprime en blanco y negro: el aviso se marca con un recuadro,
     no con color. */
  .aviso { border: 1px solid #000; padding: 1mm; margin-top: 1mm; }

  .total {
    font-size: ${ancho === 58 ? '14px' : '17px'};
    font-weight: 700;
    margin: 1mm 0;
  }

  .linea { margin-bottom: 1.5mm; }
  .desc { word-break: break-word; }
  .usd { font-size: ${ancho === 58 ? '8px' : '9px'}; padding-left: 2mm; }

  .pie-nota { font-size: ${ancho === 58 ? '8px' : '9px'}; margin-top: 2mm; }

  /* En pantalla se ve como un papel; al imprimir, sin adornos. */
  @media screen {
    body {
      margin: 1rem auto;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
      border-radius: 2px;
    }
  }
</style>
</head>
<body>
  <div class="centro">
    <div class="negocio">${escapar(negocio.nombre)}</div>
    <div class="chico">${escapar(negocio.direccion)}</div>
    <div class="chico">${escapar(negocio.localidad)}</div>
    ${negocio.telefono ? `<div class="chico">${escapar(negocio.telefono)}</div>` : ''}
  </div>

  <hr>

  ${
    datos.provisional
      ? `<div class="aviso centro fuerte">
    SIN CONEXIÓN<br>
    <span class="chico">El número de comprobante se asigna cuando vuelve internet.
    Lo cobrado es definitivo.</span>
  </div>`
      : ''
  }

  <div class="fila"><span>Comprobante</span><span class="fuerte">${escapar(datos.numero)}</span></div>
  <div class="fila"><span>Fecha</span><span>${escapar(formatearFechaHora(datos.fecha))}</span></div>
  <div class="fila"><span>Atendió</span><span>${escapar(datos.vendedor)}</span></div>
  ${datos.cliente ? `<div class="fila"><span>Cliente</span><span>${escapar(datos.cliente)}</span></div>` : ''}

  <hr>

  ${lineas}

  <hr>

  <div class="fila"><span>Subtotal</span><span class="monto">${escapar(formatearARS(datos.subtotalCentavos))}</span></div>
  ${descuento}
  <div class="fila total"><span>TOTAL</span><span class="monto">${escapar(formatearARS(datos.totalCentavos))}</span></div>

  <hr>

  ${pagos}
  ${vuelto}
  ${fiado}

  ${datos.nota ? `<hr><div class="chico">${escapar(datos.nota)}</div>` : ''}

  <hr>

  <div class="centro chico">
    ${negocio.pie ? `<div>${escapar(negocio.pie)}</div>` : ''}
    <div class="pie-nota">Comprobante interno. No válido como factura.</div>
    ${cotizacion}
  </div>

  <div style="height: 6mm"></div>
  <script>
    // Se imprime solo al abrir y se cierra al terminar: el cajero no tiene que
    // hacer nada más que retirar el papel.
    window.addEventListener('load', () => {
      window.print();
    });
    window.addEventListener('afterprint', () => window.close());
  </script>
  <!-- ancho útil: ${columnas} caracteres -->
</body>
</html>`;
}
