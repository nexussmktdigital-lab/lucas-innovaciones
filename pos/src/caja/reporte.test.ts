/**
 * Tests del reporte de cierre.
 *
 * Contra PGlite con las migraciones reales. Lo que se prueba es que el reporte
 * de un turno diga lo que pasó en ese turno: las ventas, los medios, lo que
 * salió del cajón y con qué billetes se contó.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  customers,
  expenseCategories,
  monetaryAccounts,
  products,
  users,
} from '@/db/schema';
import { abrirCaja, cerrarCaja } from './sesion';
import { cierresRecientes, cuantosSeContaron, reporteDeCierre } from './reporte';
import { totalDelConteo } from './arqueo';
import { confirmarVenta } from '@/ventas/confirmar';
import { cobrarFiado } from '@/fiado/cuenta';
import { registrarGasto } from '@/gastos/gastos';

let db: TestDb;
let duenio: string;
let caja: string;
let producto: string;
let cliente: string;
let categoria: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const [u] = await db.insert(users).values({ nombre: 'Lucas', rol: 'owner' }).returning();
  duenio = u!.id;

  const [c] = await db
    .insert(monetaryAccounts)
    .values({ nombre: 'Caja en efectivo', tipo: 'efectivo' })
    .returning();
  caja = c!.id;

  const [p] = await db
    .insert(products)
    .values({ nombre: 'Vidrio templado 9D', precioCentavos: 5_000_00, stock: 100 })
    .returning();
  producto = p!.id;

  const [cli] = await db.insert(customers).values({ nombre: 'Gaby' }).returning();
  cliente = cli!.id;

  const [cat] = await db
    .insert(expenseCategories)
    .values({ nombre: 'Envíos', orden: 0 })
    .returning();
  categoria = cat!.id;
});

/** Un turno con de todo: contado, fiado, un cobro y un gasto. */
async function turnoCompleto() {
  const s = await abrirCaja(db, {
    terminal: 'T1',
    usuarioId: duenio,
    monetaryAccountId: caja,
    saldoInicialCentavos: 20_000_00,
  });

  // Dos vidrios al contado, paga con $20.000: entran $10.000.
  await confirmarVenta(db, {
    lineas: [{ productId: producto, cantidad: 2 }],
    pagos: [{ medio: 'efectivo', montoCentavos: 20_000_00, monetaryAccountId: caja }],
    vendedorId: duenio,
    cashSessionId: s.id,
    terminal: 'T1',
    idempotencyKey: 'r-contado',
  });

  // Uno fiado: no entra plata.
  await confirmarVenta(db, {
    lineas: [{ productId: producto, cantidad: 1 }],
    pagos: [{ medio: 'cuenta_corriente', montoCentavos: 5_000_00 }],
    clienteId: cliente,
    vendedorId: duenio,
    cashSessionId: s.id,
    terminal: 'T1',
    idempotencyKey: 'r-fiada',
  });

  // Paga $2.000 de la deuda.
  await cobrarFiado(db, {
    customerId: cliente,
    montoCentavos: 2_000_00,
    medio: 'efectivo',
    cashSessionId: s.id,
    usuarioId: duenio,
    idempotencyKey: 'r-cobro',
  });

  // Y se paga un flete de $3.000 del cajón.
  await registrarGasto(db, {
    fecha: '2026-09-15',
    categoryId: categoria,
    descripcion: 'Flete de la mercadería',
    montoCentavos: 3_000_00,
    estado: 'pagado',
    medio: 'efectivo',
    monetaryAccountId: caja,
    cashSessionId: s.id,
    usuarioId: duenio,
  });

  return s;
}

describe('reporte de un turno', () => {
  it('junta las ventas, los medios, lo fiado y lo que salió', async () => {
    const s = await turnoCompleto();
    const r = (await reporteDeCierre(db, s.id))!;

    expect(r.abierta).toBe(true);
    expect(r.terminal).toBe('T1');
    expect(r.abiertaPor).toBe('Lucas');

    expect(r.cantidadDeVentas).toBe(2);
    expect(r.totalVendidoCentavos).toBe(15_000_00);
    expect(r.unidadesVendidas).toBe(3);

    // Entraron $10.000 de la venta y $2.000 del cobro.
    expect(r.porMedio).toEqual([{ medio: 'efectivo', cantidad: 2, totalCentavos: 12_000_00 }]);
    expect(r.fiadoCentavos).toBe(5_000_00);
    expect(r.cobrosDeFiadoCentavos).toBe(2_000_00);
    expect(r.gastosCentavos).toBe(3_000_00);

    // Apertura 20.000 + 12.000 que entraron − 3.000 que salieron.
    expect(r.efectivoEsperadoCentavos).toBe(29_000_00);
  });

  it('el efectivo esperado es la apertura más lo que entró menos lo que salió', async () => {
    const s = await turnoCompleto();
    const r = (await reporteDeCierre(db, s.id))!;

    const efectivo = r.porMedio.find((m) => m.medio === 'efectivo')!.totalCentavos;
    expect(r.efectivoEsperadoCentavos).toBe(
      r.saldoInicialCentavos + efectivo - r.gastosCentavos - r.retirosCentavos,
    );
  });

  it('una sesión que no existe no devuelve nada', async () => {
    expect(await reporteDeCierre(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('cerrar contando billete por billete', () => {
  it('guarda con qué billetes se contó y el reporte lo muestra', async () => {
    const s = await turnoCompleto();

    // $29.000: uno de $20.000, ocho de $1.000 y $1.000 de suelto.
    const conteo = { 2_000_000: 1, 100_000: 8 };
    const contado = totalDelConteo(conteo, 1_000_00);
    expect(contado).toBe(29_000_00);

    await cerrarCaja(db, {
      sesionId: s.id,
      usuarioId: duenio,
      saldoContadoCentavos: contado,
      conteo: { conteo, sueltoCentavos: 1_000_00 },
      nota: 'Turno tranquilo',
    });

    const r = (await reporteDeCierre(db, s.id))!;
    expect(r.abierta).toBe(false);
    expect(r.cerradaPor).toBe('Lucas');
    expect(r.diferenciaCentavos).toBe(0);
    expect(r.nota).toBe('Turno tranquilo');

    expect(r.desgloseDelConteo).toEqual([
      { etiqueta: '$20.000', valorCentavos: 2_000_000, cantidad: 1, subtotalCentavos: 2_000_000 },
      { etiqueta: '$1.000', valorCentavos: 100_000, cantidad: 8, subtotalCentavos: 800_000 },
    ]);
    expect(r.sueltoCentavos).toBe(1_000_00);

    // Y lo contado coincide con lo que suman los billetes más el suelto.
    const suma = r.desgloseDelConteo.reduce((n, f) => n + f.subtotalCentavos, 0);
    expect(suma + r.sueltoCentavos).toBe(r.saldoContadoCentavos);
  });

  it('escribir el total a mano sigue siendo válido, y se nota', async () => {
    const s = await turnoCompleto();

    await cerrarCaja(db, {
      sesionId: s.id,
      usuarioId: duenio,
      saldoContadoCentavos: 29_000_00,
    });

    const r = (await reporteDeCierre(db, s.id))!;
    expect(r.desgloseDelConteo).toEqual([]);
    expect(r.diferenciaCentavos).toBe(0);

    const [enLista] = await cierresRecientes(db);
    expect(enLista!.seConto).toBe(false);
  });

  it('una diferencia queda con su justificación a la vista', async () => {
    const s = await turnoCompleto();

    await cerrarCaja(db, {
      sesionId: s.id,
      usuarioId: duenio,
      saldoContadoCentavos: 28_000_00,
      justificacion: 'Vuelto mal dado a la tarde',
      conteo: { conteo: { 2_000_000: 1, 100_000: 8 }, sueltoCentavos: 0 },
    });

    const r = (await reporteDeCierre(db, s.id))!;
    expect(r.diferenciaCentavos).toBe(-1_000_00);
    expect(r.justificacion).toBe('Vuelto mal dado a la tarde');

    const [enLista] = await cierresRecientes(db);
    expect(enLista!.justificacion).toBe('Vuelto mal dado a la tarde');
    expect(enLista!.seConto).toBe(true);
  });
});

describe('la lista de cierres', () => {
  it('trae los cerrados, del más nuevo al más viejo', async () => {
    const primera = await abrirCaja(db, {
      terminal: 'T1',
      usuarioId: duenio,
      monetaryAccountId: caja,
      saldoInicialCentavos: 0,
    });
    await cerrarCaja(db, { sesionId: primera.id, usuarioId: duenio, saldoContadoCentavos: 0 });

    const segunda = await abrirCaja(db, {
      terminal: 'T1',
      usuarioId: duenio,
      monetaryAccountId: caja,
      saldoInicialCentavos: 0,
    });
    await cerrarCaja(db, { sesionId: segunda.id, usuarioId: duenio, saldoContadoCentavos: 0 });

    const lista = await cierresRecientes(db);
    expect(lista).toHaveLength(2);
    expect(lista[0]!.id).toBe(segunda.id);
  });

  it('una caja abierta no figura como cierre', async () => {
    await turnoCompleto();
    expect(await cierresRecientes(db)).toHaveLength(0);
  });

  /*
   * El número que dice si el arqueo se hace de verdad. La auditoría encontró
   * que en el POS viejo el efectivo contado figuraba siempre en cero; sin
   * medirlo, ese hábito vuelve sin que nadie lo note.
   */
  it('mide cuántos de los últimos cierres se hicieron contando', async () => {
    const a = await abrirCaja(db, {
      terminal: 'T1',
      usuarioId: duenio,
      monetaryAccountId: caja,
      saldoInicialCentavos: 0,
    });
    await cerrarCaja(db, {
      sesionId: a.id,
      usuarioId: duenio,
      saldoContadoCentavos: 0,
      conteo: { conteo: {}, sueltoCentavos: 0 },
    });

    const b = await abrirCaja(db, {
      terminal: 'T1',
      usuarioId: duenio,
      monetaryAccountId: caja,
      saldoInicialCentavos: 10_000_00,
    });
    await cerrarCaja(db, {
      sesionId: b.id,
      usuarioId: duenio,
      saldoContadoCentavos: 10_000_00,
      conteo: { conteo: { 1_000_000: 1 }, sueltoCentavos: 0 },
    });

    // Una se cerró contando de verdad; la otra mandó un conteo vacío, que es lo
    // mismo que no contar.
    expect(await cuantosSeContaron(db)).toEqual({ contados: 1, total: 2 });
  });
});
