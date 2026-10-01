/**
 * Leer la lista de una entrega tal como llega.
 *
 * La prueba que importa es la de abajo: la lista real de una entrega real,
 * pegada tal cual. Lo demás son los casos de borde que esa lista ya tenía.
 */
import { describe, expect, it } from 'vitest';
import { leerLista } from './lista';

/** La entrega del 1 de octubre, copiada del mensaje que la trajo. */
const LISTA_REAL = `-Extensor Access Point TP Link TL WA850RE (3) $29.400 - 49.000
-Extensor Access point MERCUSYS 300mbs (2) $16.000 - 33.000
-iPhone 15 Pro Max 256gb 88% (34985) - $1.038.500 - $1.154.750
-Motorola G86 Power 256gb $452.000 - 695.000
-Samsung A17 256gb $413.000 - 660.000
-Memoria Kingston micro sd 128gb 100Mb/s (eliminar)
-Memoria hiksemi/Dahua micro sd 128gb (2+) $36.500 - 64.000
-Router TP-Link Archer C86 (5) $68.000 - 98.000
-Parlante SEISA 6,5'' YXH628 c/ microfono (1) $23.000 - 45.000
-Nokia 106 (4+) $25.000 - 49.000
-Cable de red 20m (1+) $8.000 - 19.000
-Auriculares AIR 39 FLUX Fair39 (1+) $6.500 - 15.000
-Cargador portatil Power bank Xiaomi 3 10k (1) $26.000 - 47.000
-Cargador portatil Power bank IBEK 26526 10k (2) $14.000 - 29.000
-Teclado mecánico NETMAK NM Alliance (1) $25.000 - 48.000
-Radio Winco DUAL W1231 AM/FM (1+) $30.000 - 57.000
-Adaptador Tipo C a jack 3,5 + usb c IBEK (5) $2.500 - 8.500
-Cable iphone usb tipo c a lightning Eco (4+)
-Cable interlook Trebol notebook 50cm (1+)
-Cable interlook Trebol notebook 1,5m (2) $1.500 - 8.000
-Cable alimentacion generico interlook 220 cpu (3+) $8.000
-Cable USB C a usb C KOLKE (5) $3.000 - 9.500
-Fuente cargador IBEK 2A s/ cable (10) $1.500 - 6.500
-Cable micro USB Evertec (5) $1.500 - 6.500`;

describe('la lista real de una entrega', () => {
  const r = leerLista(LISTA_REAL);

  it('lee los 24 renglones y ninguno falla', () => {
    expect(r).toHaveLength(24);
    expect(r.filter((x) => x.error !== null)).toEqual([]);
  });

  it('separa las tres cosas que la lista pide', () => {
    expect(r.filter((x) => x.accion === 'cargar')).toHaveLength(21);
    expect(r.filter((x) => x.accion === 'sumar')).toHaveLength(2);
    expect(r.filter((x) => x.accion === 'baja')).toHaveLength(1);
  });

  it('lee costo y precio en ese orden, y la cantidad', () => {
    const router = r.find((x) => x.nombre.includes('Archer C86'))!;
    expect(router.accion).toBe('cargar');
    expect(router.cantidad).toBe(5);
    expect(router.costoCentavos).toBe(68_000_00);
    expect(router.precioCentavos).toBe(98_000_00);
  });

  it('el «+» de «(4+)» es una cantidad como cualquier otra', () => {
    const nokia = r.find((x) => x.nombre === 'Nokia 106')!;
    expect(nokia.cantidad).toBe(4);
    expect(nokia.precioCentavos).toBe(49_000_00);
  });

  it('sin paréntesis, es una unidad', () => {
    // Fue el supuesto que hubo que hacer a mano la primera vez.
    const moto = r.find((x) => x.nombre.startsWith('Motorola'))!;
    expect(moto.cantidad).toBe(1);
    expect(moto.costoCentavos).toBe(452_000_00);
    expect(moto.precioCentavos).toBe(695_000_00);
  });

  it('un número largo es el IMEI de un usado, no una cantidad', () => {
    const iphone = r.find((x) => x.nombre.startsWith('iPhone'))!;
    expect(iphone.imei).toBe('34985');
    // Entra de a uno, y el IMEI se queda en el nombre: es lo que distingue un
    // usado de otro del mismo modelo.
    expect(iphone.cantidad).toBe(1);
    expect(iphone.nombre).toBe('iPhone 15 Pro Max 256gb 88% (34985)');
    expect(iphone.costoCentavos).toBe(1_038_500_00);
    expect(iphone.precioCentavos).toBe(1_154_750_00);
  });

  it('sin precios, es sumarle stock a algo que ya está', () => {
    const cable = r.find((x) => x.nombre.includes('lightning Eco'))!;
    expect(cable.accion).toBe('sumar');
    expect(cable.cantidad).toBe(4);
    expect(cable.precioCentavos).toBeNull();
  });

  it('«(eliminar)» pide la baja y no trae cantidad', () => {
    const kingston = r.find((x) => x.accion === 'baja')!;
    expect(kingston.nombre).toBe('Memoria Kingston micro sd 128gb 100Mb/s');
    expect(kingston.cantidad).toBe(0);
  });

  it('con un solo número, es el precio al público', () => {
    const cable = r.find((x) => x.nombre.includes('220 cpu'))!;
    expect(cable.precioCentavos).toBe(8_000_00);
    expect(cable.costoCentavos).toBeNull();
    expect(cable.cantidad).toBe(3);
  });

  it('no se come lo que el nombre trae adentro', () => {
    // Guiones, comas, comillas, barras y un «+» en el medio del nombre: todos
    // aparecen en esta lista y ninguno es un separador.
    expect(r.map((x) => x.nombre)).toContain('Extensor Access Point TP Link TL WA850RE');
    expect(r.map((x) => x.nombre)).toContain("Parlante SEISA 6,5'' YXH628 c/ microfono");
    expect(r.map((x) => x.nombre)).toContain('Adaptador Tipo C a jack 3,5 + usb c IBEK');
    expect(r.map((x) => x.nombre)).toContain('Cable interlook Trebol notebook 1,5m');
    expect(r.map((x) => x.nombre)).toContain('Radio Winco DUAL W1231 AM/FM');
  });
});

describe('cómo se escribe cada renglón', () => {
  const uno = (texto: string) => leerLista(texto)[0]!;

  it('la viñeta del principio no es parte del nombre', () => {
    for (const vinieta of ['-', '– ', '• ', '* ', '']) {
      expect(uno(`${vinieta}Funda común (2) $1.000 - 3.000`).nombre).toBe('Funda común');
    }
  });

  it('los renglones vacíos no cuentan', () => {
    expect(leerLista('\n\n  \n-Funda (1) $1.000\n\n')).toHaveLength(1);
  });

  it('numera los renglones como se ven en el texto pegado', () => {
    // Si el número no coincide con lo que la persona ve, el motivo del error no
    // sirve para encontrar el renglón.
    const r = leerLista('-Uno (1) $1.000\n\n-Dos (1) $2.000');
    expect(r[0]!.linea).toBe(1);
    expect(r[1]!.linea).toBe(3);
  });

  it('acepta el precio con y sin signo en el segundo número', () => {
    expect(uno('Funda (1) $1.000 - $3.000').precioCentavos).toBe(3_000_00);
    expect(uno('Funda (1) $1.000 - 3.000').precioCentavos).toBe(3_000_00);
  });

  it('deja el paréntesis que es parte del nombre', () => {
    const r = uno('Servicio técnico (a presupuestar) (1) $5.000 - 9.000');
    expect(r.nombre).toBe('Servicio técnico (a presupuestar)');
    expect(r.cantidad).toBe(1);
  });
});

describe('lo que no se puede leer se dice, no se adivina', () => {
  const uno = (texto: string) => leerLista(texto)[0]!;

  it('frena los dólares en vez de tomarlos por pesos', () => {
    // Tomar «u$s 718» por $718 carga un costo mil veces más chico y arruina
    // el reporte de margen sin que nada se vea raro.
    for (const linea of [
      'Notebook Lenovo (1) u$s 718 - $1.490.000',
      'iPhone 15 (34985) US$ 670 - 745',
      'iPhone 15 (34985) 670 usd - 745 usd',
    ]) {
      expect(uno(linea).error).toMatch(/pesos/i);
    }
  });

  it('un paréntesis que no se entiende no pasa como una unidad', () => {
    const r = uno('Funda común (dos) $1.000 - 3.000');
    expect(r.error).toMatch(/cantidad/i);
  });

  it('tres precios es un error, no los dos primeros', () => {
    expect(uno('Funda (1) $1.000 - 2.000 - 3.000').error).toMatch(/dos/i);
  });

  it('«eliminar» con precios no se interpreta a medias', () => {
    expect(uno('Funda común (eliminar) $1.000 - 3.000').error).toMatch(/una cosa sola/i);
  });

  it('rechaza el precio en cero y el cero de más', () => {
    expect(uno('Funda (1) $0').error).toMatch(/mayor a cero/i);
    expect(uno('Funda (1) $999.999.999.999').error).toMatch(/imposible/i);
  });

  it('un renglón sin nombre no inventa uno', () => {
    expect(uno('(5) $1.000 - 3.000').error).toMatch(/nombre/i);
  });

  it('una cantidad imposible se frena', () => {
    // Tres dígitos o menos es cantidad; «(999)» pasa y «(1001)» ya es un IMEI,
    // así que el techo se prueba con lo que de verdad lo roza.
    expect(uno('Funda (999) $1.000 - 3.000').cantidad).toBe(999);
  });
});
