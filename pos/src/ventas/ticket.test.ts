/**
 * El comprobante de venta en A4.
 *
 * Lo que se prueba acá es **qué dice el papel que el cliente firma y se
 * lleva**: el precio en la moneda en que se pactó, el saldo, las fechas de las
 * cuotas, y lo que no tiene que salir —los medios de pago, quién atendió—.
 */
import { describe, expect, it } from 'vitest';
import { fechaLarga, generarTicket, nombreDelMedio, type DatosDelTicket } from './ticket';

const BASE: DatosDelTicket = {
  numero: 'T1-000123',
  fecha: new Date('2026-09-11T18:30:00Z'),
  cliente: 'Gabriela González',
  documento: '28.456.789',
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
  fiadoCentavos: 0,
};

/** Un iPhone de US$ 1.500 al dólar de $1.571. */
const IPHONE: DatosDelTicket = {
  ...BASE,
  lineas: [
    {
      descripcion: 'iPhone 15 Pro Max 256GB',
      cantidad: 1,
      precioUnitarioCentavos: 235_650_000,
      descuentoCentavos: 0,
      totalCentavos: 235_650_000,
      monedaOriginal: 'USD',
      precioUsdCentavos: 150_000,
    },
  ],
  subtotalCentavos: 235_650_000,
  totalCentavos: 235_650_000,
};

/** Los montos llevan espacio duro; se normaliza para poder buscarlos. */
const txt = (s: string) => s.replace(/\u00a0/g, ' ');

describe('el comprobante', () => {
  it('sale en A4, en una sola hoja', () => {
    expect(generarTicket(BASE)).toContain('size: A4');
  });

  it('lleva los datos del local, el número y el cliente con su DNI', () => {
    const t = txt(generarTicket(BASE));
    expect(t).toContain('Lucas Innovaciones');
    expect(t).toContain('Caseros 924');
    expect(t).toContain('Villa Santa Rosa, Córdoba');
    expect(t).toContain('3574-456139');
    expect(t).toContain('T1-000123');
    expect(t).toContain('Gabriela González');
    expect(t).toContain('28.456.789');
  });

  it('deja claro que no es una factura', () => {
    expect(generarTicket(BASE)).toContain('no válido como factura');
  });

  it('sin cliente dice «Consumidor final» en vez de quedar en blanco', () => {
    const t = generarTicket({ ...BASE, cliente: null, documento: null });
    expect(t).toContain('Consumidor final');
  });

  it('lista lo vendido con su importe', () => {
    const t = txt(generarTicket(BASE));
    expect(t).toContain('Vidrio templado 9D');
    expect(t).toContain('2 × $ 5.000,00');
    expect(t).toContain('$ 10.000,00');
  });

  it('pagado al contado, lo dice', () => {
    expect(generarTicket(BASE)).toContain('Operación cancelada en su totalidad');
  });

  it('deja la garantía en blanco para escribirla a mano', () => {
    // El plazo cambia según el producto y lo completan en el mostrador.
    const t = generarTicket(BASE);
    expect(t).toContain('GARANTÍA');
    expect(t).toContain('en-blanco');
    expect(t).not.toContain('6 meses');
  });

  it('tiene dónde firmar', () => {
    const t = generarTicket(BASE);
    expect(t).toContain('Firma del cliente');
    expect(t).toContain('Aclaración del cliente');
  });

  it('escapa el HTML de los nombres, que vienen del catálogo', () => {
    const t = generarTicket({
      ...BASE,
      lineas: [{ ...BASE.lineas[0]!, descripcion: 'Vidrio <script>alert(1)</script> 9D' }],
    });
    expect(t).not.toContain('<script>alert(1)</script>');
    expect(t).toContain('&lt;script&gt;');
  });

  it('usa la fecha de Buenos Aires, no la del servidor', () => {
    // 18:30 UTC del 11 siguen siendo el 11 en Argentina, pero a las 15:30.
    expect(generarTicket(BASE)).toContain('11/09/2026');
  });
});

/*
 * Lo que el local pidió que NO salga impreso.
 *
 * «En la factura solo tiene que salir el precio del sistema, nada de
 * conversiones a pesos ni los medios de pago; eso queda internamente.»
 */
describe('lo que no se imprime', () => {
  it('no dice con qué medios se pagó', () => {
    const t = generarTicket({ ...BASE, fiadoCentavos: 300_000 });
    for (const medio of ['Efectivo', 'Transferencia', 'Mercado Pago', 'Cuenta corriente']) {
      expect(t).not.toContain(medio);
    }
  });

  it('no dice quién atendió', () => {
    expect(generarTicket(BASE)).not.toContain('ATENDIÓ');
  });

  it('en una venta en dólares no muestra ninguna conversión a pesos', () => {
    const t = txt(generarTicket(IPHONE));
    expect(t).toContain('US$ 1.500,00');
    // Ni el equivalente en pesos ni la cotización con la que se calculó.
    expect(t).not.toContain('2.356.500');
    expect(t).not.toContain('Cotización');
  });
});

/*
 * La moneda del papel es la de la venta (D62).
 *
 * Un iPhone se pacta en dólares y el cliente firma dólares. Si el papel dijera
 * pesos, en la primera corrida del dólar el papel y el sistema dejarían de
 * decir lo mismo.
 */
describe('la moneda', () => {
  it('una venta en dólares se imprime en dólares', () => {
    const t = txt(generarTicket(IPHONE));
    expect(t).toContain('US$ 1.500,00');
    expect(t).not.toContain('$ 2.356.500,00');
  });

  it('una venta en pesos se imprime en pesos', () => {
    expect(txt(generarTicket(BASE))).toContain('$ 10.000,00');
  });

  it('un carrito mezclado sale en pesos, entero', () => {
    // No hay forma de poner una funda cotizada en pesos en un papel en dólares
    // sin convertirla, y convertir es justo lo que no se hace acá.
    const t = txt(
      generarTicket({
        ...IPHONE,
        lineas: [...IPHONE.lineas, ...BASE.lineas],
        totalCentavos: 236_650_000,
      }),
    );
    expect(t).toContain('$ 2.366.500,00');
    expect(t).not.toContain('US$ 1.500,00');
  });

  it('con descuento sale en pesos, aunque se haya vendido en dólares', () => {
    /*
     * El descuento se carga en pesos. Restarlo de un precio en dólares exige
     * una conversión, y el papel no convierte: sale en la moneda en la que de
     * verdad se cobró.
     */
    const t = txt(
      generarTicket({ ...IPHONE, descuentoCentavos: 5_000_000, totalCentavos: 230_650_000 }),
    );
    expect(t).toContain('$ 2.306.500,00');
    expect(t).not.toContain('US$');
  });
});

describe('la venta fiada', () => {
  it('dice cuánto entregó y cuánto queda debiendo', () => {
    const t = txt(generarTicket({ ...BASE, fiadoCentavos: 700_000 }));
    expect(t).toContain('Entregó $ 3.000,00');
    expect(t).toContain('queda un saldo de $ 7.000,00');
  });

  it('en dólares, el saldo también va en dólares y sin convertir', () => {
    // Entregó la mitad de un iPhone de US$ 1.500.
    const t = txt(generarTicket({ ...IPHONE, fiadoCentavos: 117_825_000 }));
    expect(t).toContain('Entregó US$ 750,00');
    expect(t).toContain('queda un saldo de US$ 750,00');
  });

  it('lista las cuotas con su fecha y su monto', () => {
    const t = txt(
      generarTicket({
        ...IPHONE,
        fiadoCentavos: 94_260_000,
        cuotas: [
          { numero: 1, vencimiento: '2026-11-06', montoCentavos: 20_000 },
          { numero: 2, vencimiento: '2026-12-06', montoCentavos: 20_000 },
          { numero: 3, vencimiento: '2027-01-06', montoCentavos: 20_000 },
        ],
      }),
    );

    expect(t).toContain('SALDO EN CUOTAS');
    expect(t).toContain('3 cuotas');
    expect(t).toContain('Vence el 6 de noviembre de 2026');
    expect(t).toContain('Vence el 6 de enero de 2027');
    expect(t).toContain('US$ 200,00');
  });

  it('sin plan no aparece el bloque de cuotas', () => {
    expect(generarTicket({ ...BASE, fiadoCentavos: 700_000 })).not.toContain('SALDO EN CUOTAS');
  });
});

describe('avisos', () => {
  it('una venta sin conexión avisa que el número llega después', () => {
    const t = generarTicket({ ...BASE, numero: 'Pendiente', provisional: true });
    expect(t).toContain('SIN CONEXIÓN');
    expect(t).toContain('Lo cobrado es definitivo');
  });

  it('una venta anulada lo dice en la cara', () => {
    expect(generarTicket({ ...BASE, nota: 'VENTA ANULADA' })).toContain('VENTA ANULADA');
  });

  it('una venta normal no muestra ninguno de los dos', () => {
    const t = generarTicket(BASE);
    expect(t).not.toContain('SIN CONEXIÓN');
    expect(t).not.toContain('VENTA ANULADA');
  });
});

describe('fechaLarga', () => {
  it('escribe la fecha como la lee una persona', () => {
    expect(fechaLarga('2026-11-06')).toBe('6 de noviembre de 2026');
    expect(fechaLarga('2027-01-31')).toBe('31 de enero de 2027');
  });

  it('ante algo que no es una fecha devuelve lo que le dieron, sin romper', () => {
    expect(fechaLarga('cualquier cosa')).toBe('cualquier cosa');
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
