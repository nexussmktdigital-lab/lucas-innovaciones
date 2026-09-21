import { describe, expect, it } from 'vitest';
import {
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
    expect(vencimientoDeCuota(HOY, 'semanal', 1)).toBe('2026-09-25');
    expect(vencimientoDeCuota(HOY, 'quincenal', 1)).toBe('2026-10-03');
    expect(vencimientoDeCuota(HOY, 'mensual', 1)).toBe('2026-10-18');
  });

  it('las mensuales van por calendario: si compró un 18, paga los 18', () => {
    expect(vencimientoDeCuota(HOY, 'mensual', 3)).toBe('2026-12-18');
    expect(vencimientoDeCuota(HOY, 'mensual', 6)).toBe('2027-03-18');
  });

  it('un 31 no se convierte en el 1 del mes siguiente', () => {
    // El 31 de enero + 1 mes es el 28 de febrero, no el 3 de marzo.
    expect(vencimientoDeCuota('2026-01-31', 'mensual', 1)).toBe('2026-02-28');
  });
});

describe('armar el plan', () => {
  it('reparte sin perder ni inventar centavos', () => {
    const cuotas = cuotasDelPlan(100_000, 3, 'mensual', HOY);

    expect(cuotas).toHaveLength(3);
    expect(sumar(...cuotas.map((c) => c.montoCentavos))).toBe(100_000);
    expect(cuotas.map((c) => c.vencimiento)).toEqual(['2026-10-18', '2026-11-18', '2026-12-18']);
  });

  it('un celular de $400.000 en 6 cuotas mensuales', () => {
    const cuotas = cuotasDelPlan(400_000_00, 6, 'mensual', HOY);

    expect(
      cuotas.every((c) => c.montoCentavos === 66_666_67 || c.montoCentavos === 66_666_66),
    ).toBe(true);
    expect(sumar(...cuotas.map((c) => c.montoCentavos))).toBe(400_000_00);
  });

  it('una sola cuota también es un plan: es la fecha en que se compromete a pagar', () => {
    const [unica] = cuotasDelPlan(50_000, 1, 'quincenal', HOY);
    expect(unica).toEqual({ numero: 1, montoCentavos: 50_000, vencimiento: '2026-10-03' });
  });

  it('no acepta cero cuotas, ni más de las que tiene sentido, ni monto cero', () => {
    expect(() => cuotasDelPlan(100_000, 0, 'mensual', HOY)).toThrow(ErrorPlan);
    expect(() => cuotasDelPlan(100_000, CUOTAS_MAXIMAS + 1, 'mensual', HOY)).toThrow(ErrorPlan);
    expect(() => cuotasDelPlan(0, 3, 'mensual', HOY)).toThrow(ErrorPlan);
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
