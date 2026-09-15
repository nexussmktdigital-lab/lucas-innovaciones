import { describe, expect, it } from 'vitest';
import { generarTicket, nombreDelMedio, type DatosDelTicket } from './ticket';

const BASE: DatosDelTicket = {
  numero: 'T1-000123',
  fecha: new Date('2026-09-11T18:30:00Z'),
  vendedor: 'Vendedor de mostrador',
  lineas: [
    {
      descripcion: 'Vidrio templado 9D',
      cantidad: 2,
      precioUnitarioCentavos: 500_000,
      descuentoCentavos: 0,
      totalCentavos: 1_000_000,
      monedaOriginal: 'ARS',
      precioUsdCentavos: null,
    },
  ],
  subtotalCentavos: 1_000_000,
  descuentoCentavos: 0,
  totalCentavos: 1_000_000,
  pagos: [{ medio: 'efectivo', montoCentavos: 1_000_000 }],
  vueltoCentavos: 0,
  tcAplicadoCentavos: null,
};

/** Los montos llevan espacio duro; se normaliza para poder buscarlos. */
const txt = (s: string) => s.replace(/ /g, ' ');

describe('generarTicket', () => {
  it('incluye los datos del local y del comprobante', () => {
    const t = txt(generarTicket(BASE));
    expect(t).toContain('Lucas Innovaciones');
    expect(t).toContain('Caseros 924');
    expect(t).toContain('Villa Santa Rosa, Córdoba');
    expect(t).toContain('T1-000123');
    expect(t).toContain('Vendedor de mostrador');
  });

  it('deja claro que no es una factura', () => {
    expect(generarTicket(BASE)).toContain('No válido como factura');
  });

  it('lista las líneas con cantidad, unitario y total', () => {
    const t = txt(generarTicket(BASE));
    expect(t).toContain('Vidrio templado 9D');
    expect(t).toContain('2 × $ 5.000,00');
    expect(t).toContain('$ 10.000,00');
  });

  it('muestra el precio en dólares de un producto en USD', () => {
    const t = txt(
      generarTicket({
        ...BASE,
        lineas: [
          {
            descripcion: 'iPhone 14 Pro 256GB',
            cantidad: 1,
            precioUnitarioCentavos: 213_900_000,
            descuentoCentavos: 0,
            totalCentavos: 213_900_000,
            monedaOriginal: 'USD',
            precioUsdCentavos: 137_000,
          },
        ],
        subtotalCentavos: 213_900_000,
        totalCentavos: 213_900_000,
        pagos: [{ medio: 'transferencia', montoCentavos: 213_900_000 }],
        tcAplicadoCentavos: 156_100,
      }),
    );

    expect(t).toContain('US$ 1.370,00 c/u');
    expect(t).toContain('$ 2.139.000,00');
    expect(t).toContain('Cotización aplicada: $ 1.561,00');
  });

  it('muestra el vuelto solo cuando lo hay', () => {
    expect(generarTicket(BASE)).not.toContain('Vuelto');
    expect(txt(generarTicket({ ...BASE, vueltoCentavos: 300_000 }))).toContain('Vuelto');
  });

  it('detalla marca y cuotas en el pago con tarjeta', () => {
    const t = generarTicket({
      ...BASE,
      pagos: [{ medio: 'credito', montoCentavos: 1_000_000, marcaTarjeta: 'Visa', cuotas: 3 }],
    });
    expect(t).toContain('Crédito (Visa, 3 cuotas)');
  });

  it('muestra el descuento cuando lo hay', () => {
    const t = txt(generarTicket({ ...BASE, descuentoCentavos: 100_000, totalCentavos: 900_000 }));
    expect(t).toContain('Descuento');
    expect(t).toContain('−$ 1.000,00');
  });

  it('se ajusta al ancho del papel', () => {
    expect(generarTicket(BASE, { ancho: 58 })).toContain('size: 58mm auto');
    expect(generarTicket(BASE, { ancho: 80 })).toContain('size: 80mm auto');
    // Por defecto, 80 mm.
    expect(generarTicket(BASE)).toContain('size: 80mm auto');
  });

  it('escapa el HTML de los nombres, que vienen del catálogo', () => {
    const t = generarTicket({
      ...BASE,
      lineas: [{ ...BASE.lineas[0]!, descripcion: 'Vidrio <script>alert(1)</script> 9D' }],
    });
    expect(t).not.toContain('<script>alert(1)</script>');
    expect(t).toContain('&lt;script&gt;');
  });

  it('usa la hora de Buenos Aires, no la del servidor', () => {
    // 18:30 UTC son las 15:30 en Argentina.
    expect(generarTicket(BASE)).toContain('15:30');
  });
});

describe('nombreDelMedio', () => {
  it('traduce los medios a como se dicen', () => {
    expect(nombreDelMedio('mercadopago')).toBe('Mercado Pago');
    expect(nombreDelMedio('cuenta_corriente')).toBe('Cuenta corriente');
  });

  it('ante un medio desconocido devuelve el código, sin romper', () => {
    expect(nombreDelMedio('cripto')).toBe('cripto');
  });
});

/*
 * El comprobante de una venta fiada.
 *
 * «Cuenta corriente $7.000» entre los medios es correcto y no alcanza: este es
 * el papel que el cliente guarda y con el que se discute después.
 */
describe('venta fiada', () => {
  it('dice con todas las letras cuánto queda debiendo', () => {
    const t = txt(
      generarTicket({
        ...BASE,
        pagos: [
          { medio: 'efectivo', montoCentavos: 300_000 },
          { medio: 'cuenta_corriente', montoCentavos: 700_000 },
        ],
      }),
    );

    expect(t).toContain('Queda debiendo de esta compra');
    expect(t).toContain('$ 7.000,00');
  });

  it('una venta pagada al contado no lo menciona', () => {
    expect(generarTicket(BASE)).not.toContain('Queda debiendo');
  });
});

