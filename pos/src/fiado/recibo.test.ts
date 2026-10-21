/**
 * El recibo de un pago de fiado.
 *
 * Lo que se prueba es **qué se lleva en la mano el que vino a pagar**: cuánto
 * entregó y, sobre todo, cuánto le queda. Hasta acá se iba sin nada, y en una
 * deuda que se paga de a poco durante meses eso es justo de lo que después se
 * discute en el mostrador.
 */
import { describe, expect, it } from 'vitest';
import { codigoDeRecibo, generarRecibo, type DatosDelRecibo } from './recibo';

const BASE: DatosDelRecibo = {
  codigo: 'RC-A1B2C3D4',
  fecha: new Date('2026-10-21T18:30:00Z'),
  cliente: 'Gabriela González',
  documento: '28.456.789',
  montoCentavos: 50_000_00,
  monedaDeuda: 'ARS',
  medio: 'efectivo',
  saldoCentavos: 120_000_00,
  cobradoPor: 'Rocío',
};

/**
 * El texto del papel, sin etiquetas y con los espacios normalizados.
 *
 * Desde `<body>`: el título de la ventana repite el código del recibo y haría
 * contar una copia de más al medir cuántas veces sale cada dato.
 */
function texto(html: string): string {
  return html
    .slice(html.indexOf('<body'))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;| /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Solo la copia del cliente: la hoja lleva dos, separadas por el corte. */
function primeraCopia(html: string): string {
  return texto(html.split('CORTAR POR ACÁ')[0]!);
}

describe('el recibo', () => {
  it('dice cuánto pagó y cuánto le queda', async () => {
    const t = texto(generarRecibo(BASE));

    expect(t).toContain('RECIBO DE PAGO');
    expect(t).toContain('RC-A1B2C3D4');
    expect(t).toContain('Gabriela González');
    expect(t).toContain('$ 50.000,00');
    expect(t).toContain('SALDO QUE QUEDA');
    expect(t).toContain('$ 120.000,00');
  });

  it('cuando termina de pagar lo dice, y no muestra un saldo de cero sin explicar', async () => {
    const t = texto(generarRecibo({ ...BASE, montoCentavos: 120_000_00, saldoCentavos: 0 }));

    expect(t).toContain('DEUDA CANCELADA');
    expect(t).toContain('No queda nada debiendo');
    expect(t).toContain('la cuenta queda saldada');
  });

  it('una deuda en dólares se escribe en dólares', async () => {
    // Lo que se vendió en dólares se debe en dólares (D62): el recibo de una
    // cuota del iPhone no puede decir «$ 200,00».
    const t = texto(
      generarRecibo({
        ...BASE,
        monedaDeuda: 'USD',
        montoCentavos: 200_00,
        saldoCentavos: 400_00,
        medio: 'dolares',
      }),
    );

    expect(t).toContain('US$ 200,00');
    expect(t).toContain('US$ 400,00');
    expect(t).not.toMatch(/(?<!US)\$ 200,00/);
  });

  /*
   * Dos números y los dos van: «cobré US$ 200» y «entraron $314.200» son dos
   * hechos distintos. Si el papel dijera solo el primero, el cliente que pagó
   * con una transferencia en pesos no reconoce ninguna cifra de su recibo.
   */
  it('pagando una deuda en dólares con pesos salen los dos números', async () => {
    const t = texto(
      generarRecibo({
        ...BASE,
        monedaDeuda: 'USD',
        montoCentavos: 200_00,
        saldoCentavos: 400_00,
        medio: 'transferencia',
        enCaja: { montoCentavos: 314_200_00, moneda: 'ARS' },
      }),
    );

    expect(t).toContain('US$ 200,00');
    expect(t).toContain('Entregó');
    expect(t).toContain('Transferencia');
    expect(t).toContain('$ 314.200,00');
  });

  it('cuando el medio y la deuda son de la misma moneda no repite el monto', async () => {
    const html = generarRecibo(BASE);
    // Un papel que dice dos veces «$ 50.000,00» hace dudar de si pagó una vez
    // o dos. El renglón de la caja solo aparece cuando hay dos monedas.
    expect(primeraCopia(html)).not.toContain('Entregó');
    expect(primeraCopia(html).match(/\$ 50\.000,00/g)).toHaveLength(1);
  });

  /*
   * El original y el duplicado, en la misma hoja.
   *
   * El papel es de tres renglones: en una hoja entera dejaba la mitad de
   * abajo en blanco en cada pago, todos los días. Y un recibo que el local no
   * conserva firmado no sirve para lo único que tiene que servir, que es
   * cuando después se discute cuánto se había pagado.
   */
  it('sale por duplicado, con una línea de corte', async () => {
    const t = texto(generarRecibo(BASE));

    expect(t).toContain('ORIGINAL · PARA EL CLIENTE');
    expect(t).toContain('CORTAR POR ACÁ');
    expect(t).toContain('DUPLICADO · PARA EL LOCAL');

    // Las dos copias dicen lo mismo: si una llevara otro saldo, el cliente y
    // el local se irían con dos versiones de la misma deuda.
    expect(t.match(/SALDO QUE QUEDA/g)).toHaveLength(2);
    expect(t.match(/\$ 120\.000,00/g)).toHaveLength(2);
    expect(t.match(/RC-A1B2C3D4/g)).toHaveLength(2);
  });

  it('las dos copias entran en una sola hoja', async () => {
    // Dos hojas serían dos páginas por cada cuota cobrada.
    const html = generarRecibo(BASE);
    expect(html.match(/class="hoja/g)).toHaveLength(1);
    expect(html.match(/class="mitad"/g)).toHaveLength(2);
  });

  /*
   * Mentir por omisión en el papel que se lleva es peor que no dárselo: el
   * que paga su deuda en pesos y debe un iPhone en dólares no puede irse con
   * un recibo que dice «no queda nada debiendo».
   */
  it('avisa de la otra deuda cuando debe en las dos monedas', async () => {
    const t = texto(
      generarRecibo({
        ...BASE,
        saldoCentavos: 0,
        otraDeuda: { centavos: 600_00, moneda: 'USD' },
      }),
    );

    expect(t).toContain('DEUDA CANCELADA');
    expect(t).toContain('ADEMÁS DEBE EN DÓLARES');
    expect(t).toContain('US$ 600,00');
    expect(t).toContain('dos deudas separadas');
  });

  it('sin otra deuda no inventa el aviso', async () => {
    const t = texto(generarRecibo({ ...BASE, otraDeuda: { centavos: 0, moneda: 'USD' } }));
    expect(t).not.toContain('ADEMÁS DEBE');
  });

  it('la nota del cobro sale en el papel', async () => {
    const t = texto(generarRecibo({ ...BASE, nota: 'A cuenta del celular' }));
    expect(t).toContain('A cuenta del celular');
  });

  it('quién cobró va en la línea de firma, no entre los importes', async () => {
    const t = texto(generarRecibo(BASE));
    expect(t).toContain('Firma y sello del local · Rocío');
  });

  it('sale una sola hoja y se manda a imprimir solo', async () => {
    const html = generarRecibo(BASE);
    expect(html.match(/class="hoja/g)).toHaveLength(1);
    expect(html).toContain('window.print()');
    expect(html).toContain('Documento no válido como factura');
  });

  /* Lo que escribe un cliente no puede cerrar una etiqueta del papel. */
  it('el nombre y la nota se escapan', async () => {
    const html = generarRecibo({
      ...BASE,
      cliente: 'Pérez & <script>alert(1)</script>',
      nota: '"a cuenta"',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Pérez &amp;');
  });
});

describe('el código del recibo', () => {
  it('sale del id del pago y es siempre el mismo', () => {
    const id = 'a1b2c3d4-0000-4000-8000-000000000000';
    expect(codigoDeRecibo(id)).toBe('RC-A1B2C3D4');
    expect(codigoDeRecibo(id)).toBe(codigoDeRecibo(id));
  });

  it('dos pagos distintos no comparten código', () => {
    expect(codigoDeRecibo('11111111-0000-4000-8000-000000000000')).not.toBe(
      codigoDeRecibo('22222222-0000-4000-8000-000000000000'),
    );
  });
});
