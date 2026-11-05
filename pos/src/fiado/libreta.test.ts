/**
 * Leer las entregas de la libreta tal como vienen escritas.
 *
 * Los casos de acá salen del cuaderno de Uriel Duarte, el primer cliente de
 * cuenta corriente que se migró: están copiados con sus errores de tipeo, sus
 * asteriscos de WhatsApp y sus renglones sin fecha.
 */
import { describe, expect, it } from 'vitest';
import { leerEntregas } from './libreta';

describe('leer la libreta', () => {
  it('lee el renglón tal como lo escribe el local', () => {
    const r = leerEntregas('*ENTREGA $21.000 (19/06/26) (efectivo)*');

    expect(r.conProblema).toBe(0);
    expect(r.entregas).toHaveLength(1);
    expect(r.entregas[0]!.montoCentavos).toBe(21_000_00);
    expect(r.entregas[0]!.medio).toBe('efectivo');
    expect(r.entregas[0]!.fecha.toISOString()).toBe('2026-06-19T12:00:00.000Z');
  });

  it('perdona el error de tipeo de siempre', () => {
    // «tranferencia», sin la s, está escrito así en toda la libreta.
    const r = leerEntregas('*ENTREGA $44.000 (19/06/26) (tranferencia)*');
    expect(r.entregas[0]!.medio).toBe('transferencia');
  });

  it('un día de un dígito también es una fecha', () => {
    const r = leerEntregas('*ENTREGA $22.000 (16/6/26)*');
    expect(r.entregas[0]!.fecha.toISOString()).toBe('2026-06-16T12:00:00.000Z');
  });

  /*
   * Mediodía y no medianoche. Argentina está en UTC−3: una fecha guardada a
   * las 00:00 UTC se lee como el día anterior en el mostrador, y el recibo
   * saldría diciendo el 15 donde el cuaderno dice el 16.
   */
  it('la fecha no se corre un día al leerla en Argentina', () => {
    const r = leerEntregas('ENTREGA $22.000 (16/06/26)');
    const enCordoba = r.entregas[0]!.fecha.toLocaleDateString('es-AR', {
      timeZone: 'America/Argentina/Cordoba',
    });
    expect(enCordoba).toBe('16/6/2026');
  });

  it('sin medio escrito, asume efectivo', () => {
    const r = leerEntregas('ENTREGA $97.000 (21/08/26)');
    expect(r.entregas[0]!.medio).toBe('efectivo');
  });

  /*
   * La guarda que importa. Una entrega sin fecha no sirve para lo único que
   * se le pregunta a esta historia —cuándo pagó la última vez— y ponerle la
   * de hoy sería inventarla.
   */
  it('una entrega sin fecha no se carga, y dice por qué', () => {
    const r = leerEntregas('*ENTREGA $97.000*');

    expect(r.entregas).toHaveLength(0);
    expect(r.conProblema).toBe(1);
    expect(r.lineas[0]!.problema).toMatch(/fecha/i);
    expect(r.lineas[0]!.texto).toBe('*ENTREGA $97.000*');
  });

  it('una fecha imposible tampoco pasa', () => {
    const r = leerEntregas('ENTREGA $10.000 (31/02/26)');
    expect(r.entregas).toHaveLength(0);
    expect(r.lineas[0]!.problema).toMatch(/no existe/i);
  });

  it('los renglones de mercadería se saltean, no son errores', () => {
    const r = leerEntregas(
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
  });

  it('lee la tanda entera y la suma', () => {
    const r = leerEntregas(
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
    const r = leerEntregas(
      ['*ENTREGA $22.000 (16/6/26)*', '*ENTREGA $97.000*', '*ENTREGA $50.000 (27/10/26)*'].join(
        '\n',
      ),
    );

    expect(r.entregas).toHaveLength(2);
    expect(r.conProblema).toBe(1);
    expect(r.totalCentavos).toBe(72_000_00);
  });

  it('un texto vacío no es un error, es nada', () => {
    const r = leerEntregas('   \n\n  ');
    expect(r.lineas).toEqual([]);
    expect(r.entregas).toEqual([]);
    expect(r.totalCentavos).toBe(0);
  });
});
