import { describe, expect, it } from 'vitest';
import {
  cadaNDias,
  cadencia,
  comoSeDice,
  DIAS_MAXIMOS,
  validarCadencia,
  CUOTAS_MAXIMAS,
  cuotasDelPlan,
  ErrorPlan,
  estadoDeDeuda,
  imputar,
  vencimientoDeCuota,
  type CuotaGuardada,
} from './plan';
import { sumar } from '@/lib/dinero';

/** Un viernes cualquiera. */
const HOY = '2026-09-18';

describe('cuándo vence cada cuota', () => {
  it('la primera vence una frecuencia después, no el mismo día', () => {
    expect(vencimientoDeCuota(HOY, cadencia('semanal'), 1)).toBe('2026-09-25');
    expect(vencimientoDeCuota(HOY, cadencia('quincenal'), 1)).toBe('2026-10-03');
    expect(vencimientoDeCuota(HOY, cadencia('mensual'), 1)).toBe('2026-10-18');
  });

  it('las mensuales van por calendario: si compró un 18, paga los 18', () => {
    expect(vencimientoDeCuota(HOY, cadencia('mensual'), 3)).toBe('2026-12-18');
    expect(vencimientoDeCuota(HOY, cadencia('mensual'), 6)).toBe('2027-03-18');
  });

  it('un 31 no se convierte en el 1 del mes siguiente', () => {
    // El 31 de enero + 1 mes es el 28 de febrero, no el 3 de marzo.
    expect(vencimientoDeCuota('2026-01-31', cadencia('mensual'), 1)).toBe('2026-02-28');
  });
});

describe('armar el plan', () => {
  it('reparte sin perder ni inventar centavos', () => {
    const cuotas = cuotasDelPlan(100_000, 3, cadencia('mensual'), HOY);

    expect(cuotas).toHaveLength(3);
    expect(sumar(...cuotas.map((c) => c.montoCentavos))).toBe(100_000);
    expect(cuotas.map((c) => c.vencimiento)).toEqual(['2026-10-18', '2026-11-18', '2026-12-18']);
  });

  it('un celular de $400.000 en 6 cuotas mensuales', () => {
    const cuotas = cuotasDelPlan(400_000_00, 6, cadencia('mensual'), HOY);

    expect(
      cuotas.every((c) => c.montoCentavos === 66_666_67 || c.montoCentavos === 66_666_66),
    ).toBe(true);
    expect(sumar(...cuotas.map((c) => c.montoCentavos))).toBe(400_000_00);
  });

  it('una sola cuota también es un plan: es la fecha en que se compromete a pagar', () => {
    const [unica] = cuotasDelPlan(50_000, 1, cadencia('quincenal'), HOY);
    expect(unica).toEqual({ numero: 1, montoCentavos: 50_000, vencimiento: '2026-10-03' });
  });

  it('no acepta cero cuotas, ni más de las que tiene sentido, ni monto cero', () => {
    expect(() => cuotasDelPlan(100_000, 0, cadencia('mensual'), HOY)).toThrow(ErrorPlan);
    expect(() => cuotasDelPlan(100_000, CUOTAS_MAXIMAS + 1, cadencia('mensual'), HOY)).toThrow(ErrorPlan);
    expect(() => cuotasDelPlan(0, 3, cadencia('mensual'), HOY)).toThrow(ErrorPlan);
  });
});

/** Arma cuotas guardadas a partir de pares [vencimiento, pagado]. */
function guardadas(...pares: [string, number][]): CuotaGuardada[] {
  return pares.map(([vencimiento, pagadoCentavos], i) => ({
    numero: i + 1,
    montoCentavos: 10_000,
    pagadoCentavos,
    vencimiento,
  }));
}

describe('el semáforo del mostrador', () => {
  it('sin cuotas es gris: es el fiado abierto de siempre, no una falla', () => {
    const e = estadoDeDeuda([], HOY);
    expect(e.color).toBe('gris');
    expect(e.proxima).toBeNull();
  });

  it('rojo cuando hay una cuota vencida, y dice cuántos días', () => {
    const e = estadoDeDeuda(guardadas(['2026-09-10', 0], ['2026-10-10', 0]), HOY);

    expect(e.color).toBe('rojo');
    expect(e.diasDeAtraso).toBe(8);
    expect(e.vencidoCentavos).toBe(10_000);
    expect(e.titulo).toMatch(/Atrasado 8 días/);
  });

  it('con dos vencidas lo dice, y mide por la más vieja', () => {
    const e = estadoDeDeuda(guardadas(['2026-08-18', 0], ['2026-09-10', 0]), HOY);

    expect(e.color).toBe('rojo');
    expect(e.vencidoCentavos).toBe(20_000);
    expect(e.titulo).toMatch(/2 cuotas vencidas/);
  });

  it('amarillo cuando vence hoy o en los próximos días', () => {
    expect(estadoDeDeuda(guardadas([HOY, 0]), HOY).color).toBe('amarillo');
    expect(estadoDeDeuda(guardadas(['2026-09-21', 0]), HOY).color).toBe('amarillo');
    expect(estadoDeDeuda(guardadas([HOY, 0]), HOY).titulo).toBe('La cuota vence hoy');
  });

  it('verde cuando todavía falta, y dice cuánto', () => {
    const e = estadoDeDeuda(guardadas(['2026-10-18', 0]), HOY);

    expect(e.color).toBe('verde');
    expect(e.proxima?.enDias).toBe(30);
    expect(e.titulo).toMatch(/Al día/);
  });

  it('una cuota pagada a medias sigue contando, y por lo que falta', () => {
    const e = estadoDeDeuda(guardadas(['2026-09-10', 6_000]), HOY);

    expect(e.color).toBe('rojo');
    expect(e.vencidoCentavos).toBe(4_000);
    expect(e.cuotasPagadas).toBe(0);
  });

  it('pagadas todas, verde y sin próxima', () => {
    const e = estadoDeDeuda(guardadas(['2026-09-10', 10_000], ['2026-10-10', 10_000]), HOY);

    expect(e.color).toBe('verde');
    expect(e.proxima).toBeNull();
    expect(e.cuotasPagadas).toBe(2);
    expect(e.titulo).toMatch(/Terminó de pagar/);
  });
});

describe('imputar un pago', () => {
  it('tapa primero la cuota más vieja', () => {
    const { imputaciones, sobranteCentavos } = imputar(
      guardadas(['2026-09-10', 0], ['2026-10-10', 0]),
      12_000,
    );

    expect(imputaciones).toEqual([
      { numero: 1, montoCentavos: 10_000 },
      { numero: 2, montoCentavos: 2_000 },
    ]);
    expect(sobranteCentavos).toBe(0);
  });

  it('saltea las que ya están pagas', () => {
    const { imputaciones } = imputar(guardadas(['2026-09-10', 10_000], ['2026-10-10', 0]), 5_000);
    expect(imputaciones).toEqual([{ numero: 2, montoCentavos: 5_000 }]);
  });

  it('completa una cuota pagada a medias antes de pasar a la siguiente', () => {
    const { imputaciones } = imputar(guardadas(['2026-09-10', 6_000], ['2026-10-10', 0]), 9_000);

    expect(imputaciones).toEqual([
      { numero: 1, montoCentavos: 4_000 },
      { numero: 2, montoCentavos: 5_000 },
    ]);
  });

  it('lo que sobra no se le inventa una cuota a nadie', () => {
    const { imputaciones, sobranteCentavos } = imputar(guardadas(['2026-09-10', 0]), 25_000);

    expect(imputaciones).toEqual([{ numero: 1, montoCentavos: 10_000 }]);
    expect(sobranteCentavos).toBe(15_000);
  });

  it('nunca imputa más que lo pagado', () => {
    const { imputaciones, sobranteCentavos } = imputar(
      guardadas(['2026-09-10', 0], ['2026-10-10', 0], ['2026-11-10', 0]),
      7_000,
    );

    expect(sumar(...imputaciones.map((i) => i.montoCentavos)) + sobranteCentavos).toBe(7_000);
  });
});

describe('cada N días: el plan que se pacta en el momento', () => {
  it('vence cada N días, contando desde la venta', () => {
    // «Cada tres días» es un plan real del mostrador: el que cobra por semana y
    // paga de a poco. Con el menú de tres opciones había que elegir la que
    // menos mentía y arreglar el resto de palabra.
    expect(vencimientoDeCuota(HOY, cadaNDias(3), 1)).toBe('2026-09-21');
    expect(vencimientoDeCuota(HOY, cadaNDias(3), 2)).toBe('2026-09-24');
    expect(vencimientoDeCuota(HOY, cadaNDias(3), 3)).toBe('2026-09-27');
  });

  it('sirve también para los plazos largos', () => {
    // «Cada dos meses», el del aguinaldo.
    expect(vencimientoDeCuota(HOY, cadaNDias(60), 1)).toBe('2026-11-17');
  });

  it('60 días NO es lo mismo que «cada mes» dos veces', () => {
    /*
     * Es la razón por la que `mensual` sigue existiendo aparte en vez de ser un
     * atajo de 30 días. Va por calendario: si compró un 18, paga los 18. En
     * días, a lo largo de un año se le corre casi una semana y el cliente deja
     * de reconocer su fecha.
     */
    expect(vencimientoDeCuota(HOY, cadencia('mensual'), 2)).toBe('2026-11-18');
    expect(vencimientoDeCuota(HOY, cadaNDias(30), 2)).toBe('2026-11-17');
  });

  it('arma el plan completo con sus montos', () => {
    const cuotas = cuotasDelPlan(600_000_00, 3, cadaNDias(10), HOY);

    expect(cuotas.map((c) => c.vencimiento)).toEqual([
      '2026-09-28',
      '2026-10-08',
      '2026-10-18',
    ]);
    expect(sumar(...cuotas.map((c) => c.montoCentavos))).toBe(600_000_00);
  });

  it('se dice en castellano', () => {
    expect(comoSeDice(cadaNDias(3))).toBe('cada 3 días');
    expect(comoSeDice(cadaNDias(1))).toBe('todos los días');
    expect(comoSeDice(cadaNDias(60))).toBe('cada 60 días');
    expect(comoSeDice(cadencia('mensual'))).toBe('por mes');
  });

  it('rechaza un número que no es una cantidad de días', () => {
    for (const malo of [0, -1, 1.5, DIAS_MAXIMOS + 1]) {
      expect(() => validarCadencia({ frecuencia: 'dias', dias: malo })).toThrow(ErrorPlan);
    }
    expect(() => validarCadencia({ frecuencia: 'dias', dias: null })).toThrow(ErrorPlan);
  });

  it('a los tres de siempre les borra el número, si se lo mandan', () => {
    // Un «mensual» con un 30 al lado invita a que alguien lo lea y le crea en
    // vez de usar el calendario.
    expect(validarCadencia({ frecuencia: 'mensual', dias: 30 })).toEqual({
      frecuencia: 'mensual',
      dias: null,
    });
  });
});
