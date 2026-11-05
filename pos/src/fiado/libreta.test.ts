/**
 * Leer las entregas de la libreta tal como vienen escritas.
 *
 * Los casos de acá salen del cuaderno de Uriel Duarte, el primer cliente de
 * cuenta corriente que se migró: están copiados con sus errores de tipeo, sus
 * asteriscos de WhatsApp y sus renglones sin fecha.
 */
import { describe, expect, it } from 'vitest';
import { leerLibreta } from './libreta';

describe('leer la libreta', () => {
  it('lee el renglón tal como lo escribe el local', () => {
    const r = leerLibreta('*ENTREGA $21.000 (19/06/26) (efectivo)*');

    expect(r.conProblema).toBe(0);
    expect(r.entregas).toHaveLength(1);
    expect(r.entregas[0]!.montoCentavos).toBe(21_000_00);
    expect(r.entregas[0]!.medio).toBe('efectivo');
    expect(r.entregas[0]!.fecha.toISOString()).toBe('2026-06-19T12:00:00.000Z');
  });

  it('perdona el error de tipeo de siempre', () => {
    // «tranferencia», sin la s, está escrito así en toda la libreta.
    const r = leerLibreta('*ENTREGA $44.000 (19/06/26) (tranferencia)*');
    expect(r.entregas[0]!.medio).toBe('transferencia');
  });

  it('un día de un dígito también es una fecha', () => {
    const r = leerLibreta('*ENTREGA $22.000 (16/6/26)*');
    expect(r.entregas[0]!.fecha.toISOString()).toBe('2026-06-16T12:00:00.000Z');
  });

  /*
   * Mediodía y no medianoche. Argentina está en UTC−3: una fecha guardada a
   * las 00:00 UTC se lee como el día anterior en el mostrador, y el recibo
   * saldría diciendo el 15 donde el cuaderno dice el 16.
   */
  it('la fecha no se corre un día al leerla en Argentina', () => {
    const r = leerLibreta('ENTREGA $22.000 (16/06/26)');
    const enCordoba = r.entregas[0]!.fecha.toLocaleDateString('es-AR', {
      timeZone: 'America/Argentina/Cordoba',
    });
    expect(enCordoba).toBe('16/6/2026');
  });

  it('sin medio escrito, asume efectivo', () => {
    const r = leerLibreta('ENTREGA $97.000 (21/08/26)');
    expect(r.entregas[0]!.medio).toBe('efectivo');
  });

  /*
   * La guarda que importa. Una entrega sin fecha no sirve para lo único que
   * se le pregunta a esta historia —cuándo pagó la última vez— y ponerle la
   * de hoy sería inventarla.
   */
  it('una entrega sin fecha no se carga, y dice por qué', () => {
    const r = leerLibreta('*ENTREGA $97.000*');

    expect(r.entregas).toHaveLength(0);
    expect(r.conProblema).toBe(1);
    expect(r.lineas[0]!.problema).toMatch(/fecha/i);
    expect(r.lineas[0]!.texto).toBe('*ENTREGA $97.000*');
  });

  /*
   * El renglón que casi carga un número mal. «SALDO IPHONE 13 PRO $247.000»
   * tiene un 13 antes del importe, y tomar el primer número daba trece pesos
   * donde hay doscientos cuarenta y siete mil. Lo peor no era el error: era
   * que el renglón entraba como válido, sin avisar nada.
   */
  it('manda el importe con signo, no el primer número que aparezca', () => {
    const r = leerLibreta('*ENTREGA SALDO IPHONE 13 PRO $247.000 (11/08/26) (tranferencia)*');

    expect(r.conProblema).toBe(0);
    expect(r.entregas[0]!.montoCentavos).toBe(247_000_00);
    expect(r.entregas[0]!.medio).toBe('transferencia');
  });

  it('los números de la fecha no se confunden con el importe', () => {
    // Con la fecha adelante y sin signo, «16/06/26» ofrece tres números
    // antes que el importe, y el primero ganaría.
    const r = leerLibreta('16/06/26 entrega 97000');
    expect(r.conProblema).toBe(0);
    expect(r.entregas[0]!.montoCentavos).toBe(97_000_00);
  });

  /*
   * «SALDO» en el cuaderno es dos cosas distintas y el sistema no puede
   * elegir por nadie: una anotación de cuánto iba debiendo, o mercadería.
   * Adivinar mal son doscientos mil pesos.
   */
  it('un renglón de SALDO se pregunta, no se adivina', () => {
    const r = leerLibreta(['*SALDO $183.500*', '*SALDO IPHONE 13 PRO $247.200*'].join('\n'));

    expect(r.entregas).toHaveLength(0);
    expect(r.compras).toHaveLength(0);
    expect(r.conProblema).toBe(2);
    for (const l of r.lineas) {
      expect(l.problema).toMatch(/mercadería o una anotación de saldo/i);
    }
  });

  it('una fecha imposible tampoco pasa', () => {
    const r = leerLibreta('ENTREGA $10.000 (31/02/26)');
    expect(r.entregas).toHaveLength(0);
    expect(r.lineas[0]!.problema).toMatch(/no existe/i);
  });

  it('la mercadería de arriba es una compra con la fecha de la entrega de abajo', () => {
    const r = leerLibreta(
      [
        '1 x Auricular NETMAK NM Live *$22.000*',
        '2 x Glass *$6.000*',
        '',
        '*ENTREGA $50.000 (27/10/26) (tranferencia)*',
      ].join('\n'),
    );

    expect(r.conProblema).toBe(0);
    expect(r.entregas).toHaveLength(1);
    expect(r.entregas[0]!.montoCentavos).toBe(50_000_00);

    expect(r.compras).toHaveLength(1);
    expect(r.compras[0]!.montoCentavos).toBe(28_000_00);
    expect(r.compras[0]!.fechaEstimada).toBe(false);
    expect(r.compras[0]!.fecha.toISOString()).toBe('2026-10-27T12:00:00.000Z');
    expect(r.compras[0]!.renglones.map((x) => x.texto)).toEqual([
      '1 x Auricular NETMAK NM Live $22.000',
      '2 x Glass $6.000',
    ]);
  });

  /*
   * Cada entrega cierra la compra de arriba. Sin esto, todo el cuaderno
   * terminaría siendo una sola compra gigante con la última fecha.
   */
  it('cada entrega corta: dos bloques son dos compras con fechas distintas', () => {
    const r = leerLibreta(
      [
        '1 x Auricular *$22.000*',
        '*ENTREGA $10.000 (16/06/26)*',
        '1 x Glass *$3.500*',
        '1 x funda *$6.000*',
        '*ENTREGA $5.000 (19/06/26)*',
      ].join('\n'),
    );

    expect(r.compras).toHaveLength(2);
    expect(r.compras[0]!.montoCentavos).toBe(22_000_00);
    expect(r.compras[0]!.fecha.toISOString()).toBe('2026-06-16T12:00:00.000Z');
    expect(r.compras[1]!.montoCentavos).toBe(9_500_00);
    expect(r.compras[1]!.fecha.toISOString()).toBe('2026-06-19T12:00:00.000Z');
    expect(r.totalComprasCentavos).toBe(31_500_00);
  });

  /*
   * El cuaderno de Uriel termina con tres renglones sin ninguna entrega
   * debajo. Heredan la última fecha conocida y quedan marcados, que es lo
   * que permite decirlo en la pantalla en vez de hacerla pasar por exacta.
   */
  it('lo que queda al final hereda la última fecha, y se marca', () => {
    const r = leerLibreta(
      [
        '*ENTREGA $50.000 (27/10/26)*',
        '1 x joystick ps4 *$32.000*',
        '1 x power bank Xiaomi *$21.000*',
        '1 x power bank IBEK *$36.000*',
      ].join('\n'),
    );

    expect(r.conProblema).toBe(0);
    expect(r.compras).toHaveLength(1);
    expect(r.compras[0]!.montoCentavos).toBe(89_000_00);
    expect(r.compras[0]!.fechaEstimada).toBe(true);
    expect(r.compras[0]!.fecha.toISOString()).toBe('2026-10-27T12:00:00.000Z');
  });

  it('mercadería sin ninguna entrega en todo el texto no se puede fechar', () => {
    const r = leerLibreta('1 x joystick ps4 *$32.000*');

    expect(r.compras).toHaveLength(0);
    expect(r.conProblema).toBe(1);
    expect(r.lineas.at(-1)!.problema).toMatch(/no hay ninguna entrega con fecha/i);
  });

  it('un renglón de mercadería sin importe se avisa, no se pierde', () => {
    // Suma a la deuda: perderlo en silencio es deuda que nadie ve faltar.
    const r = leerLibreta(['1 x cable sin precio', '*ENTREGA $5.000 (19/06/26)*'].join('\n'));

    expect(r.conProblema).toBe(1);
    expect(r.lineas[0]!.problema).toMatch(/importe/i);
    expect(r.compras).toHaveLength(0);
  });

  /* El cuaderno entero: las cuentas tienen que dar lo que dan a mano. */
  it('lee un pedazo real del cuaderno y lo suma', () => {
    const r = leerLibreta(
      [
        '1 x Glass $3.500',
        '1 x cargador universal $17.000',
        '1 x álbum $15.000',
        '1 x Glass 17 pro $3.500',
        '1 x funda $6.000',
        '',
        '*ENTREGA $21.000 (19/06/26) (efectivo)*',
        '*ENTREGA $44.000 (19/06/26) (tranferencia)*',
      ].join('\n'),
    );

    expect(r.conProblema).toBe(0);
    expect(r.compras).toHaveLength(1);
    expect(r.compras[0]!.montoCentavos).toBe(45_000_00);
    expect(r.entregas).toHaveLength(2);
    expect(r.totalCentavos).toBe(65_000_00);
  });

  it('lee la tanda entera y la suma', () => {
    const r = leerLibreta(
      [
        '*ENTREGA $22.000 (16/6/26)*',
        '*ENTREGA $21.000 (19/06/26) (efectivo)*',
        '*ENTREGA $44.000 (19/06/26) (tranferencia)*',
        '*ENTREGA $106.000 (27/07/26) (tranferencia)*',
      ].join('\n'),
    );

    expect(r.entregas).toHaveLength(4);
    expect(r.totalCentavos).toBe(193_000_00);
    expect(r.conProblema).toBe(0);
  });

  it('un renglón ilegible no se lleva puestos a los demás', () => {
    const r = leerLibreta(
      ['*ENTREGA $22.000 (16/6/26)*', '*ENTREGA $97.000*', '*ENTREGA $50.000 (27/10/26)*'].join(
        '\n',
      ),
    );

    expect(r.entregas).toHaveLength(2);
    expect(r.conProblema).toBe(1);
    expect(r.totalCentavos).toBe(72_000_00);
  });

  it('un texto vacío no es un error, es nada', () => {
    const r = leerLibreta('   \n\n  ');
    expect(r.lineas).toEqual([]);
    expect(r.entregas).toEqual([]);
    expect(r.totalCentavos).toBe(0);
  });
});
