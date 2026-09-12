import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { auditLog, products, users } from '@/db/schema';
import {
  cotizacionVigente,
  ErrorCotizacion,
  estadoDeLaCotizacion,
  historialDeCotizaciones,
  productosEnDolares,
  registrarCotizacion,
} from './cotizacion';

let db: TestDb;
let duenioId: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);
  const [u] = await db.insert(users).values({ nombre: 'Lucas', rol: 'owner' }).returning();
  duenioId = u!.id;
});

describe('registrarCotizacion', () => {
  it('guarda la cotización y deja rastro de quién la cargó', async () => {
    const c = await registrarCotizacion(db, {
      valorCentavos: 156_100,
      origen: 'manual',
      usuarioId: duenioId,
    });

    expect(c.valorCentavos).toBe(156_100);
    expect(c.origen).toBe('manual');

    const bitacora = await db.select().from(auditLog);
    expect(bitacora[0]!.accion).toBe('cotizacion.registrar');
    expect(bitacora[0]!.usuarioId).toBe(duenioId);
  });

  it('rechaza valores fuera de toda posibilidad', async () => {
    // Un dólar a $15: alguien tipeó 1500 en vez de 150000.
    await expect(
      registrarCotizacion(db, { valorCentavos: 1_500, origen: 'manual' }),
    ).rejects.toThrow(/fuera de lo posible/);

    // Un dólar a un millón.
    await expect(
      registrarCotizacion(db, { valorCentavos: 100_000_000, origen: 'manual' }),
    ).rejects.toThrow(ErrorCotizacion);
  });

  it('frena un salto grande y explica cuánto', async () => {
    await registrarCotizacion(db, { valorCentavos: 156_100, origen: 'infodolar' });

    // Un 30% de golpe: probablemente un dígito de más.
    await expect(
      registrarCotizacion(db, { valorCentavos: 203_000, origen: 'manual' }),
    ).rejects.toThrow(/30% para arriba/);
  });

  it('deja pasar el salto si el dueño lo confirma', async () => {
    await registrarCotizacion(db, { valorCentavos: 156_100, origen: 'infodolar' });

    const c = await registrarCotizacion(db, {
      valorCentavos: 203_000,
      origen: 'manual',
      usuarioId: duenioId,
      confirmarSalto: true,
    });
    expect(c.valorCentavos).toBe(203_000);
  });

  it('un movimiento normal del día no molesta', async () => {
    await registrarCotizacion(db, { valorCentavos: 156_100, origen: 'infodolar' });
    const c = await registrarCotizacion(db, { valorCentavos: 158_000, origen: 'infodolar' });
    expect(c.valorCentavos).toBe(158_000);
  });

  it('la primera cotización nunca se compara contra nada', async () => {
    const c = await registrarCotizacion(db, { valorCentavos: 400_000, origen: 'manual' });
    expect(c.valorCentavos).toBe(400_000);
  });
});

describe('cotizacionVigente', () => {
  it('devuelve la de fecha más reciente, no la última cargada', async () => {
    await registrarCotizacion(db, {
      valorCentavos: 158_000,
      origen: 'infodolar',
      vigenteDesde: new Date('2026-09-12T12:00:00Z'),
    });
    // Se carga después pero rige antes: no debe ganar.
    await registrarCotizacion(db, {
      valorCentavos: 150_000,
      origen: 'manual',
      vigenteDesde: new Date('2026-09-10T12:00:00Z'),
      confirmarSalto: true,
    });

    expect((await cotizacionVigente(db))?.valorCentavos).toBe(158_000);
  });

  it('devuelve null cuando no hay ninguna', async () => {
    expect(await cotizacionVigente(db)).toBeNull();
  });
});

describe('estadoDeLaCotizacion', () => {
  it('sin cotización, avisa que no se puede vender en dólares', async () => {
    const e = await estadoDeLaCotizacion(db);
    expect(e.vencida).toBe(true);
    expect(e.aviso).toMatch(/no se pueden vender/);
  });

  it('una cotización de hoy está al día', async () => {
    await registrarCotizacion(db, { valorCentavos: 156_100, origen: 'infodolar' });
    const e = await estadoDeLaCotizacion(db);
    expect(e.vencida).toBe(false);
    expect(e.aviso).toBeNull();
  });

  it('pasadas 20 horas avisa que algo dejó de actualizar', async () => {
    const ayer = new Date('2026-09-11T09:00:00Z');
    await registrarCotizacion(db, {
      valorCentavos: 156_100,
      origen: 'infodolar',
      vigenteDesde: ayer,
    });

    const e = await estadoDeLaCotizacion(db, new Date('2026-09-12T09:00:00Z'));
    expect(e.vencida).toBe(true);
    expect(Math.round(e.antiguedadHoras!)).toBe(24);
    expect(e.aviso).toMatch(/hace 24 horas/);
    expect(e.aviso).toMatch(/plugin/);
  });

  it('justo antes del límite todavía sirve', async () => {
    const base = new Date('2026-09-12T00:00:00Z');
    await registrarCotizacion(db, {
      valorCentavos: 156_100,
      origen: 'infodolar',
      vigenteDesde: base,
    });

    const casi = new Date(base.getTime() + 19.5 * 3_600_000);
    expect((await estadoDeLaCotizacion(db, casi)).vencida).toBe(false);
  });
});

describe('historialDeCotizaciones', () => {
  it('devuelve de la más nueva a la más vieja', async () => {
    for (const [valor, dia] of [
      [150_000, '2026-09-10'],
      [155_000, '2026-09-11'],
      [156_100, '2026-09-12'],
    ] as const) {
      await registrarCotizacion(db, {
        valorCentavos: valor,
        origen: 'infodolar',
        vigenteDesde: new Date(`${dia}T12:00:00Z`),
      });
    }

    const h = await historialDeCotizaciones(db);
    expect(h.map((c) => c.valorCentavos)).toEqual([156_100, 155_000, 150_000]);
  });
});

describe('productosEnDolares', () => {
  it('cuenta solo los activos en USD', async () => {
    await db.insert(products).values([
      { nombre: 'iPhone 14', moneda: 'USD', precioUsdCentavos: 137_000, precioCentavos: 1 },
      { nombre: 'iPhone 13', moneda: 'USD', precioUsdCentavos: 52_000, precioCentavos: 1 },
      {
        nombre: 'iPhone viejo despublicado',
        moneda: 'USD',
        precioUsdCentavos: 20_000,
        precioCentavos: 1,
        activo: false,
      },
      { nombre: 'Vidrio', precioCentavos: 500_000 },
    ]);

    expect(await productosEnDolares(db)).toBe(2);
  });
});
