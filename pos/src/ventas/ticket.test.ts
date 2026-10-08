/**
 * El comprobante de venta en A4.
 *
 * Lo que se prueba acá es **qué dice el papel que el cliente firma y se
 * lleva**: el precio en la moneda en que se pactó, el saldo, las fechas de las
 * cuotas, y lo que no tiene que salir —los medios de pago, quién atendió—.
 */
import { describe, expect, it } from 'vitest';
import {
  fechaCorta,
  fechaLarga,
  generarComprobantes,
  generarTicket,
  nombreDelMedio,
  type DatosDelTicket,
} from './ticket';

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

/** El papel como se lee, sin etiquetas: para mirar qué dice al lado de qué. */
const leido = (s: string) =>
  txt(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

  it('pagado al contado, lo dice sin ambigüedad', () => {
    /*
     * Decía «operación cancelada en su totalidad», que en contabilidad es
     * pagada y para el cliente que lo lee debajo del total es dada de baja.
     */
    const t = generarTicket(BASE);
    expect(t).toContain('Pagado en su totalidad');
    expect(t).not.toMatch(/cancelad/i);
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

  /*
   * El renglón del teléfono dice dólares aunque el total vaya en pesos.
   *
   * Antes el papel era todo en dólares o todo en pesos, así que alcanzaba con
   * una funda de $10.000 en el mismo carrito para que el iPhone también
   * saliera convertido: el cliente firmaba «$ 2.356.500» por algo que había
   * pactado en US$ 1.500. Lo pidió el local: el renglón del teléfono dice
   * dólares, sí o sí.
   */
  it('en un carrito mezclado, el iPhone sigue diciendo dólares', () => {
    const t = txt(
      generarTicket({
        ...IPHONE,
        lineas: [...IPHONE.lineas, ...BASE.lineas],
        totalCentavos: 236_650_000,
      }),
    );

    expect(t).toContain('US$ 1.500,00'); // el teléfono, en su moneda
    expect(t).toContain('$ 10.000,00'); // la funda, en la suya
    expect(t).toContain('$ 2.366.500,00'); // el total, que no suma dos monedas
  });

  it('el renglón en dólares no lleva su equivalente en pesos al lado', () => {
    /*
     * Se probó ponerlo en chiquito, para que el total de una venta mixta
     * saliera de sumar lo impreso, y el local lo sacó: «no me sirve». Dos
     * cifras al lado de un mismo producto son la discusión que el papel
     * tiene que evitar.
     */
    const t = txt(
      generarTicket({
        ...IPHONE,
        lineas: [...IPHONE.lineas, ...BASE.lineas],
        totalCentavos: 236_650_000,
      }),
    );
    expect(t).toContain('US$ 1.500,00');
    expect(t).not.toContain('al cambio');
    expect(t).not.toContain('$ 2.356.500,00');
  });

  it('una venta toda en dólares no lleva ni un número en pesos', () => {
    const t = txt(generarTicket(IPHONE));
    expect(t.replace(/US\$/g, 'USD')).not.toContain('$ 2.356.500,00');
  });

  it('con descuento el total sale en pesos, pero el renglón sigue en dólares', () => {
    /*
     * El descuento se carga en pesos. Restarlo de un precio en dólares exige
     * una conversión, y el total no convierte: sale en la moneda en la que de
     * verdad se cobró. El teléfono, en cambio, vale lo que se pactó.
     */
    const t = txt(
      generarTicket({ ...IPHONE, descuentoCentavos: 5_000_000, totalCentavos: 230_650_000 }),
    );
    expect(t).toContain('$ 2.306.500,00');
    expect(t).toContain('US$ 1.500,00');
  });
});

describe('la copia del cliente no habla de la deuda', () => {
  /*
   * Lo pidió el local y el motivo es bueno: el papel que se lleva el cliente es
   * el del teléfono. Si vuelve por garantía tiene que discutir un teléfono, no
   * un plan de pagos ni un recargo por financiación.
   */
  const FIADO: DatosDelTicket = {
    ...BASE,
    fiadoCentavos: 700_000,
    cuotas: [
      { numero: 1, vencimiento: '2026-11-06', montoCentavos: 350_000 },
      { numero: 2, vencimiento: '2026-12-06', montoCentavos: 350_000 },
    ],
  };

  it('no lleva las cuotas ni su frecuencia', () => {
    const t = txt(generarTicket(FIADO));
    expect(t).not.toContain('SALDO EN CUOTAS');
    expect(t).not.toContain('Vence el');
  });

  it('tampoco dice cuánto quedó debiendo', () => {
    expect(txt(generarTicket(FIADO))).not.toContain('saldo');
  });

  it('pero NUNCA dice que está pagado, que sería mentira', () => {
    /*
     * El error peor posible en un papel firmado: el cliente lo levanta y dice
     * que ya pagó. Con saldo, debajo del total no va nada.
     */
    expect(txt(generarTicket(FIADO))).not.toContain('Pagado en su totalidad');
  });

  it('el total que muestra es el del producto, que es a lo que vino', () => {
    const t = txt(generarTicket(FIADO));
    expect(t).toContain('$ 10.000,00');
    expect(t).toContain('Vidrio templado 9D');
  });

  it('y sigue llevando la garantía, que es para lo que sirve', () => {
    expect(generarTicket(FIADO)).toContain('GARANTÍA');
  });
});

describe('el acuerdo de pago, que queda en el local', () => {
  const acuerdo = (datos: DatosDelTicket) =>
    txt(generarTicket(datos, { copia: 'acuerdo' }));

  it('se llama distinto y dice que es la copia del local', () => {
    const t = acuerdo({ ...BASE, fiadoCentavos: 700_000 });
    expect(t).toContain('ACUERDO DE PAGO');
    expect(t).toContain('Copia para el local');
    expect(t).toContain('CONFORMIDAD');
    // No es el papel de la garantía: ese es el otro.
    expect(t).not.toContain('GARANTÍA');
  });

  it('dice cuánto entregó y cuánto queda debiendo', () => {
    const t = acuerdo({ ...BASE, fiadoCentavos: 700_000 });
    expect(t).toContain('Entregó $ 3.000,00');
    expect(t).toContain('queda un saldo de $ 7.000,00');
  });

  it('en dólares, el saldo también va en dólares y sin convertir', () => {
    // Entregó la mitad de un iPhone de US$ 1.500.
    const t = acuerdo({ ...IPHONE, fiadoCentavos: 117_825_000 });
    expect(t).toContain('Entregó US$ 750,00');
    expect(t).toContain('queda un saldo de US$ 750,00');
  });

  it('el saldo es exactamente la suma de las cuotas, no una cuenta aparte', () => {
    /*
     * El cliente firma un papel donde «queda un saldo de X» y las cuotas que
     * va a pagar tienen que dar el mismo número. Sacarlo por diferencia contra
     * el total los dejaba a un centavo de distancia cuando el reparto no era
     * exacto, y un centavo en un papel firmado es una discusión.
     */
    const t = acuerdo({
        ...IPHONE,
        fiadoCentavos: 235_650_000,
        monedaDeLaDeuda: 'USD',
        // US$ 1.500 en tres: 500,00 + 500,00 + 500,00.
        cuotas: [
          { numero: 1, vencimiento: '2026-11-06', montoCentavos: 50_000 },
          { numero: 2, vencimiento: '2026-12-06', montoCentavos: 50_000 },
          { numero: 3, vencimiento: '2027-01-06', montoCentavos: 50_000 },
        ],
    });

    expect(t).toContain('queda un saldo de US$ 1.500,00');
  });

  it('las cuotas van en la moneda de la DEUDA, no en la del papel', () => {
    /*
     * El caso que esto vino a arreglar. Un iPhone en dólares con descuento se
     * imprime en pesos —restar un descuento cargado en pesos de un precio en
     * dólares exigiría convertir— pero la deuda sigue siendo en dólares,
     * porque así se vendió. Las cuotas de US$ 262,50 salían impresas como
     * «$ 262,50»: seiscientas treinta veces menos, en el papel que se firma.
     */
    const t = acuerdo({
        ...IPHONE,
        descuentoCentavos: 5_000_000,
        totalCentavos: 230_650_000,
        fiadoCentavos: 230_650_000,
        monedaDeLaDeuda: 'USD',
        cuotas: [
          { numero: 1, vencimiento: '2026-11-06', montoCentavos: 73_385 },
          { numero: 2, vencimiento: '2026-12-06', montoCentavos: 73_385 },
        ],
    });

    // El cuerpo en pesos, que es como se cobró con el descuento adentro.
    expect(t).toContain('$ 2.306.500,00');
    // Y la deuda en dólares, que es lo que se pactó.
    expect(t).toContain('US$ 733,85');
    expect(t).toContain('queda un saldo de US$ 1.467,70');
    expect(t).toContain('El saldo quedó pactado en dólares');
  });

  it('con recargo por financiar, desglosa de dónde sale el saldo', () => {
    /*
     * El que firma un saldo de US$ 550 por un teléfono de US$ 500 tiene que ver
     * de dónde salen los otros 50. En el comprobante del cliente no aparece
     * nada de esto: ese papel lleva el precio del teléfono.
     */
    const t = acuerdo({
      ...IPHONE,
      fiadoCentavos: 235_650_000,
      monedaDeLaDeuda: 'USD',
      recargoCentavos: 150_00,
      cuotas: [
        { numero: 1, vencimiento: '2026-11-06', montoCentavos: 550_00 },
        { numero: 2, vencimiento: '2026-12-06', montoCentavos: 550_00 },
        { numero: 3, vencimiento: '2027-01-06', montoCentavos: 550_00 },
      ],
    });

    // Pegado a su cifra, no suelto en la hoja: US$ 1.500 también es el precio
    // del teléfono y aparece arriba, así que buscarlo solo no prueba nada.
    const papel = leido(generarTicket(
      {
        ...IPHONE,
        fiadoCentavos: 235_650_000,
        monedaDeLaDeuda: 'USD',
        recargoCentavos: 150_00,
        cuotas: [
          { numero: 1, vencimiento: '2026-11-06', montoCentavos: 550_00 },
          { numero: 2, vencimiento: '2026-12-06', montoCentavos: 550_00 },
          { numero: 3, vencimiento: '2027-01-06', montoCentavos: 550_00 },
        ],
      },
      { copia: 'acuerdo' },
    ));

    expect(papel).toContain('Saldo del producto US$ 1.500,00');
    expect(papel).toContain('Recargo por financiar US$ 150,00');
    expect(t).toContain('queda un saldo de US$ 1.650,00');
  });

  it('sin cuotas también sale: el fiado «cuando pueda» se firma igual', () => {
    /*
     * Es el fiado más común del mostrador y era el que quedaba sin ningún
     * papel: el del cliente no habla de la deuda —a propósito— y el acuerdo
     * solo existía si había cuotas. El cliente se iba con el teléfono y no
     * firmaba nada.
     */
    const t = acuerdo({ ...BASE, fiadoCentavos: 700_000 });

    expect(t).toContain('ACUERDO DE PAGO');
    expect(t).toContain('SALDO');
    expect(t).toContain('sin fechas pactadas');
    expect(t).toContain('Queda debiendo');
    expect(t).toContain('$ 7.000,00');
    expect(t).toContain('No se pactaron fechas de pago');
    expect(t).toContain('Firma del cliente');
  });

  it('con cuotas no dice «sin fechas»: las fechas están ahí', () => {
    const t = acuerdo({
      ...BASE,
      fiadoCentavos: 1_000_000,
      cuotas: [{ numero: 1, vencimiento: '2026-11-06', montoCentavos: 1_000_000 }],
    });
    expect(t).not.toContain('sin fechas pactadas');
    expect(t).toContain('Vence el 6 de noviembre de 2026');
  });

  it('una venta pagada entera no genera acuerdo que firmar', () => {
    // Sin saldo no hay nada que reconocer: el bloque no se arma.
    const t = acuerdo(BASE);
    expect(t).not.toContain('Queda debiendo');
    expect(t).not.toContain('SALDO');
  });

  it('sin recargo no hay desglose: no hay nada que explicar', () => {
    const t = acuerdo({
      ...BASE,
      fiadoCentavos: 1_000_000,
      cuotas: [{ numero: 1, vencimiento: '2026-11-06', montoCentavos: 1_000_000 }],
    });
    expect(t).not.toContain('Recargo por financiar');
  });

  it('el recargo no se cuela en el comprobante del cliente', () => {
    const t = txt(
      generarTicket({
        ...IPHONE,
        fiadoCentavos: 235_650_000,
        monedaDeLaDeuda: 'USD',
        recargoCentavos: 150_00,
        cuotas: [{ numero: 1, vencimiento: '2026-11-06', montoCentavos: 1_650_00 }],
      }),
    );

    expect(t).not.toContain('Recargo');
    expect(t).not.toContain('US$ 150,00');
    expect(t).not.toContain('1.650,00');
    // Lo que sí lleva: el precio del teléfono.
    expect(t).toContain('US$ 1.500,00');
  });

  it('una venta en pesos con plan sigue teniendo sus cuotas en pesos', () => {
    const t = acuerdo({
        ...BASE,
        fiadoCentavos: 1_000_000,
        monedaDeLaDeuda: 'ARS',
        cuotas: [
          { numero: 1, vencimiento: '2026-11-06', montoCentavos: 500_000 },
          { numero: 2, vencimiento: '2026-12-06', montoCentavos: 500_000 },
        ],
    });

    expect(t).toContain('$ 5.000,00');
    expect(t).not.toContain('US$');
    expect(t).not.toContain('pactado en dólares');
  });

  it('lista las cuotas con su fecha y su monto', () => {
    const t = acuerdo({
        ...IPHONE,
        fiadoCentavos: 94_260_000,
        cuotas: [
          { numero: 1, vencimiento: '2026-11-06', montoCentavos: 20_000 },
          { numero: 2, vencimiento: '2026-12-06', montoCentavos: 20_000 },
          { numero: 3, vencimiento: '2027-01-06', montoCentavos: 20_000 },
        ],
    });

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

describe('los dos papeles salen juntos', () => {
  /** El iPhone de US$ 1.500, todo fiado en tres cuotas. */
  const FIADO: DatosDelTicket = {
    ...IPHONE,
    fiadoCentavos: IPHONE.totalCentavos,
    monedaDeLaDeuda: 'USD',
    cuotas: [
      { numero: 1, vencimiento: '2026-10-11', montoCentavos: 50_000 },
      { numero: 2, vencimiento: '2026-11-11', montoCentavos: 50_000 },
      { numero: 3, vencimiento: '2026-12-11', montoCentavos: 50_000 },
    ],
  };

  /*
   * Lo que esto cierra: el acuerdo de pago estaba detrás de un segundo botón y
   * el papel que respalda la deuda dependía de que alguien se acordara con el
   * cliente enfrente. El local lo pidió así: «que se imprima con la boleta, no
   * un paso extra».
   */
  it('una venta fiada sale con las dos hojas y un solo diálogo de impresión', () => {
    const papel = generarComprobantes(FIADO);

    expect(papel.match(/class="hoja[ "]/g)).toHaveLength(2);
    expect(papel).toContain('COMPROBANTE DE VENTA');
    expect(papel).toContain('ACUERDO DE PAGO');
    // Un solo documento: un solo `window.print()`, una sola ventana.
    expect(papel.match(/window\.print\(\)/g)).toHaveLength(1);
    expect(papel.match(/<!doctype html>/gi)).toHaveLength(1);
  });

  it('la segunda hoja arranca en una página nueva', () => {
    // Sin esto las dos hojas se imprimen encimadas en la misma página.
    expect(generarComprobantes(FIADO)).toContain('page-break-before: always');
  });

  it('cada hoja dice lo suyo: el cliente sin deuda, el acuerdo con las cuotas', () => {
    const [, delCliente, delAcuerdo] = generarComprobantes(FIADO).split('<section class="hoja');

    expect(leido(delCliente!)).toContain('GARANTÍA');
    expect(leido(delCliente!)).not.toContain('11 de octubre de 2026');
    expect(leido(delCliente!)).not.toContain('queda un saldo');

    expect(leido(delAcuerdo!)).toContain('Vence el 11 de octubre de 2026');
    expect(leido(delAcuerdo!)).toContain('queda un saldo de US$ 1.500,00');
    expect(leido(delAcuerdo!)).toContain('Copia para el local');
  });

  it('una venta pagada sale con una sola hoja', () => {
    // Un acuerdo de pago de una venta sin saldo no dice nada y gasta una hoja
    // por venta.
    const papel = generarComprobantes(BASE);

    expect(papel.match(/class="hoja[ "]/g)).toHaveLength(1);
    expect(papel).not.toContain('ACUERDO DE PAGO');
    expect(leido(papel)).toContain('Pagado en su totalidad');
  });

  it('el fiado sin fechas pactadas también lleva su segunda hoja', () => {
    // Es el fiado más común del local: «cuando pueda», sin cuotas. Si la
    // segunda hoja dependiera de que haya cuotas, no firmaría nada.
    const papel = generarComprobantes({
      ...BASE,
      fiadoCentavos: 600_000,
      cuotas: [],
    });

    expect(papel.match(/class="hoja[ "]/g)).toHaveLength(2);
    expect(leido(papel)).toContain('sin fechas pactadas');
  });

  it('reimprimir un papel suelto sigue dando una sola hoja', () => {
    for (const copia of ['cliente', 'acuerdo'] as const) {
      const papel = generarTicket(FIADO, { copia });
      expect(papel.match(/class="hoja[ "]/g), copia).toHaveLength(1);
    }
  });
});

describe('la fecha corta de la tabla de cuotas', () => {
  it('se escribe en números, que es como se lee una tabla', () => {
    expect(fechaCorta('2026-11-09')).toBe('9/11/26');
    expect(fechaCorta('2027-01-31')).toBe('31/1/27');
  });

  it('con pocas cuotas la fecha va larga, que se lee de un vistazo', () => {
    const papel = leido(
      generarTicket(
        {
          ...BASE,
          fiadoCentavos: 1_000_000,
          cuotas: [
            { numero: 1, vencimiento: '2026-11-09', montoCentavos: 500_000 },
            { numero: 2, vencimiento: '2026-12-09', montoCentavos: 500_000 },
          ],
        },
        { copia: 'acuerdo' },
      ),
    );
    expect(papel).toContain('Vence el 9 de noviembre de 2026');
  });

  /*
   * A partir de cinco la tabla va en dos columnas y la fecha larga no entra.
   * Es lo que hace que un plan de doce cuotas quepa en la hoja: sin esto el
   * acuerdo se pasaba de A4 y salía una página más con el pie solo, y
   * recortarlo no es opción en un papel que se firma.
   */
  it('con cinco o más la tabla va en dos columnas y la fecha corta', () => {
    const papel = generarTicket(
      {
        ...BASE,
        fiadoCentavos: 5_000_000,
        cuotas: Array.from({ length: 6 }, (_, i) => ({
          numero: i + 1,
          vencimiento: `2026-1${i >= 2 ? '2' : '1'}-09`,
          montoCentavos: 500_000,
        })),
      },
      { copia: 'acuerdo' },
    );
    expect(papel).toContain('cuotas-lista en-dos');
    expect(leido(papel)).toContain('Vence 9/11/26');
    expect(leido(papel)).not.toContain('Vence el 9 de noviembre de 2026');
    // Las doce siguen impresas: lo que se achica es cómo, no cuántas.
    expect([...papel.matchAll(/class="cuota-n"/g)]).toHaveLength(6);
  });
});
