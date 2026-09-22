/**
 * Tests de los reportes de venta, contra la base real.
 *
 * Lo que se prueba es que los números digan lo que pasó: que una venta anulada
 * deje de contar, que lo fiado se facture pero no se confunda con plata que
 * entró, y que los límites del día sean los del local y no los de UTC.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  customers,
  expenseCategories,
  legacySales,
  monetaryAccounts,
  products,
  saleItems,
  salePayments,
  sales,
  users,
} from '@/db/schema';
import { abrirCaja } from '@/caja/sesion';
import { confirmarVenta } from '@/ventas/confirmar';
import { anularVenta } from '@/ventas/anular';
import { registrarGasto } from '@/gastos/gastos';
import { periodoEntre, periodoPorNombre } from './periodo';
import {
  facturacionPorMes,
  gastosPorCategoria,
  productosVendidos,
  rentabilidad,
  resumenDeVentas,
  ventasPorCategoria,
  ventasPorDia,
  ventasPorMedio,
  ventasPorVendedor,
} from './ventas';

let db: TestDb;
let duenio: string;
let vendedor: string;
let caja: string;
let sesionId: string;
let vidrio: string;
let celular: string;
let cliente: string;
let categoriaGasto: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const insertados = await db
    .insert(users)
    .values([
      { nombre: 'Lucas', rol: 'owner' },
      { nombre: 'Rocío', rol: 'seller' },
    ])
    .returning();
  duenio = insertados[0]!.id;
  vendedor = insertados[1]!.id;

  const [c] = await db
    .insert(monetaryAccounts)
    .values({ nombre: 'Caja en efectivo', tipo: 'efectivo' })
    .returning();
  caja = c!.id;

  const prods = await db
    .insert(products)
    .values([
      {
        nombre: 'Vidrio templado 9D',
        categoria: 'Vidrios',
        precioCentavos: 5_000_00,
        stock: 500,
      },
      {
        nombre: 'Motorola G86',
        categoria: 'Smartphones nuevos',
        precioCentavos: 380_000_00,
        stock: 20,
        // Costo cargado a mano: es la única forma de que haya margen.
        costoCentavos: 300_000_00,
      },
    ])
    .returning();
  vidrio = prods[0]!.id;
  celular = prods[1]!.id;

  const [cli] = await db.insert(customers).values({ nombre: 'Gaby' }).returning();
  cliente = cli!.id;

  const [cat] = await db
    .insert(expenseCategories)
    .values({ nombre: 'Envíos', orden: 0 })
    .returning();
  categoriaGasto = cat!.id;

  // Con plata en el cajón: los gastos en efectivo de más abajo salen de acá,
  // y del cajón no se puede sacar lo que no hay.
  const s = await abrirCaja(db, {
    terminal: 'T1',
    usuarioId: duenio,
    monetaryAccountId: caja,
    saldoInicialCentavos: 1_000_000_00,
  });
  sesionId = s.id;
});

let contador = 0;
function clave() {
  contador += 1;
  return `rep-${contador}-${Math.random()}`;
}

/** Una venta de contado, por el camino real. */
async function vender(
  opciones: {
    producto?: string;
    cantidad?: number;
    medio?: 'efectivo' | 'transferencia';
    vendedorId?: string;
  } = {},
) {
  const producto = opciones.producto ?? vidrio;
  const cantidad = opciones.cantidad ?? 1;
  const precio = producto === vidrio ? 5_000_00 : 380_000_00;

  return confirmarVenta(db, {
    lineas: [{ productId: producto, cantidad }],
    pagos: [
      {
        medio: opciones.medio ?? 'efectivo',
        montoCentavos: precio * cantidad,
        monetaryAccountId: caja,
      },
    ],
    vendedorId: opciones.vendedorId ?? duenio,
    cashSessionId: sesionId,
    terminal: 'T1',
    idempotencyKey: clave(),
  });
}

/**
 * Una venta con fecha puesta a mano, escrita directo en la base.
 *
 * No se puede hacer vendiendo y después corrigiendo la fecha: el disparador
 * `li_venta_solo_estado` no deja tocar una venta cerrada, que es justamente lo
 * que se quiere de él. Acá lo que se prueba es la consulta del reporte, no el
 * camino de la venta, así que la fila se inserta como corresponde.
 */
async function venderEn(fechaISO: string, opciones: { producto?: string; cantidad?: number } = {}) {
  const producto = opciones.producto ?? vidrio;
  const cantidad = opciones.cantidad ?? 1;
  const precio = producto === vidrio ? 5_000_00 : 380_000_00;
  const total = precio * cantidad;
  contador += 1;

  const [venta] = await db
    .insert(sales)
    .values({
      numero: `T9-${String(contador).padStart(6, '0')}`,
      terminal: 'T9',
      fecha: new Date(fechaISO),
      vendedorId: duenio,
      cashSessionId: sesionId,
      subtotalCentavos: total,
      totalCentavos: total,
      idempotencyKey: clave(),
    })
    .returning();

  await db.insert(saleItems).values({
    saleId: venta!.id,
    productId: producto,
    descripcion: producto === vidrio ? 'Vidrio templado 9D' : 'Motorola G86',
    cantidad,
    precioUnitarioCentavos: precio,
    totalCentavos: total,
  });

  await db.insert(salePayments).values({
    saleId: venta!.id,
    medio: 'efectivo',
    monetaryAccountId: caja,
    montoCentavos: total,
  });

  return venta!;
}

/** Un período que abarca todo lo que puedan tocar los tests. */
const TODO = periodoEntre('2021-01-01', '2026-12-31');

describe('el resumen del período', () => {
  it('cuenta ventas, unidades, total y ticket promedio', async () => {
    await vender({ cantidad: 2 }); // 10.000
    await vender({ producto: celular }); // 380.000

    const r = await resumenDeVentas(db, TODO);
    expect(r.cantidadDeVentas).toBe(2);
    expect(r.unidades).toBe(3);
    expect(r.totalCentavos).toBe(390_000_00);
    expect(r.ticketPromedioCentavos).toBe(195_000_00);
  });

  /*
   * Anular no inserta una venta negativa: marca la original como anulada. Si el
   * reporte no filtrara por estado, contaría la venta que no existió.
   */
  it('una venta anulada deja de contar del todo', async () => {
    const a = await vender();
    await vender();

    await anularVenta(db, { ventaId: a.id, usuarioId: duenio, motivo: 'Se arrepintió' });

    const r = await resumenDeVentas(db, TODO);
    expect(r.cantidadDeVentas).toBe(1);
    expect(r.totalCentavos).toBe(5_000_00);
    expect(r.unidades).toBe(1);
    expect(r.anuladas).toBe(1);
  });

  /* Lo fiado se factura, pero no entró plata. Son dos cosas distintas. */
  it('lo fiado cuenta como venta y se informa aparte', async () => {
    await vender();
    await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 1 }],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: 5_000_00 }],
      clienteId: cliente,
      vendedorId: duenio,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: clave(),
    });

    const r = await resumenDeVentas(db, TODO);
    expect(r.cantidadDeVentas).toBe(2);
    expect(r.totalCentavos).toBe(10_000_00);
    expect(r.fiadoCentavos).toBe(5_000_00);
  });

  it('un período sin ventas no divide por cero', async () => {
    const r = await resumenDeVentas(db, periodoEntre('2021-01-01', '2021-01-31'));
    expect(r.cantidadDeVentas).toBe(0);
    expect(r.ticketPromedioCentavos).toBe(0);
  });
});

/*
 * Los dos hallazgos de la auditoría de las fases 8 y 9, que hacían que la misma
 * pantalla mostrara tres números distintos para lo mismo.
 */
describe('todo tiene que cuadrar con lo vendido', () => {
  /*
   * El descuento global se guarda en la venta y no baja a las líneas: cuatro
   * vidrios de $5.000 con 10% dan líneas que suman $20.000 y un total de
   * $18.000. Sin prorratear, el ranking de productos decía más que lo vendido.
   */
  it('el descuento global se reparte entre las líneas', async () => {
    await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 4 }],
      descuentoGlobal: { tipo: 'porcentaje', porcentaje: 10 },
      pagos: [{ medio: 'efectivo', montoCentavos: 18_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: clave(),
    });

    const r = await resumenDeVentas(db, TODO);
    expect(r.totalCentavos).toBe(18_000_00);

    const top = await productosVendidos(db, TODO);
    expect(top.reduce((n, x) => n + x.totalCentavos, 0)).toBe(18_000_00);

    const cats = await ventasPorCategoria(db, TODO);
    expect(cats.reduce((n, x) => n + x.totalCentavos, 0)).toBe(18_000_00);
  });

  it('y el margen no se infla con el descuento que se hizo', async () => {
    await confirmarVenta(db, {
      lineas: [{ productId: celular, cantidad: 1 }],
      descuentoGlobal: { tipo: 'monto', centavos: 80_000_00 },
      pagos: [{ medio: 'efectivo', montoCentavos: 300_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: clave(),
    });

    // Se vendió a 300.000 lo que costó 300.000: no se ganó nada.
    const m = await rentabilidad(db, TODO);
    expect(m.ventaConCostoCentavos).toBe(300_000_00);
    expect(m.gananciaCentavos).toBe(0);
  });

  /*
   * Una venta de $5.000 pagada con $10.000 hacía figurar «Efectivo $10.000».
   * Es el hallazgo 22 otra vez, que ya estaba corregido en el arqueo.
   */
  it('el efectivo va neto de vuelto, como en el arqueo', async () => {
    await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 1 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 10_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: clave(),
    });

    const medios = await ventasPorMedio(db, TODO);
    expect(medios).toEqual([{ medio: 'efectivo', cantidad: 1, totalCentavos: 5_000_00 }]);
  });

  /* Restarlo una vez por renglón de pago dejaría el número en rojo. */
  it('con dos billetes cargados por separado el vuelto se resta una sola vez', async () => {
    await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 1 }],
      pagos: [
        { medio: 'efectivo', montoCentavos: 5_000_00, monetaryAccountId: caja },
        { medio: 'efectivo', montoCentavos: 5_000_00, monetaryAccountId: caja },
      ],
      vendedorId: duenio,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: clave(),
    });

    const [efectivo] = await ventasPorMedio(db, TODO);
    expect(efectivo!.totalCentavos).toBe(5_000_00);
  });

  /* La cuenta corriente no es plata que entró: es deuda. */
  it('lo fiado no figura como plata cobrada', async () => {
    await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 1 }],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: 5_000_00 }],
      clienteId: cliente,
      vendedorId: duenio,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: clave(),
    });

    expect(await ventasPorMedio(db, TODO)).toEqual([]);
    expect((await resumenDeVentas(db, TODO)).fiadoCentavos).toBe(5_000_00);
  });
});

describe('los límites del día', () => {
  /*
   * El caso que rompe todo si el huso se ignora: una venta de las 22:30 del 15
   * son las 01:30 UTC del 16. Tiene que contar en el 15.
   */
  it('una venta de la noche cuenta en el día del local', async () => {
    await venderEn('2026-09-16T01:30:00Z'); // 22:30 del 15 acá

    const quince = periodoEntre('2026-09-15', '2026-09-15');
    const dieciseis = periodoEntre('2026-09-16', '2026-09-16');

    expect((await resumenDeVentas(db, quince)).cantidadDeVentas).toBe(1);
    expect((await resumenDeVentas(db, dieciseis)).cantidadDeVentas).toBe(0);
  });

  it('una venta de la madrugada cuenta en su propio día', async () => {
    await venderEn('2026-09-16T12:00:00Z'); // 09:00 del 16

    const dieciseis = periodoEntre('2026-09-16', '2026-09-16');
    expect((await resumenDeVentas(db, dieciseis)).cantidadDeVentas).toBe(1);
  });
});

describe('por medio de pago', () => {
  it('agrupa y ordena por plata', async () => {
    await vender({ medio: 'efectivo' });
    await vender({ medio: 'efectivo' });
    await vender({ producto: celular, medio: 'transferencia' });

    const medios = await ventasPorMedio(db, TODO);
    expect(medios[0]).toEqual({ medio: 'transferencia', cantidad: 1, totalCentavos: 380_000_00 });
    expect(medios[1]).toEqual({ medio: 'efectivo', cantidad: 2, totalCentavos: 10_000_00 });
  });

  it('los pagos de una venta anulada no figuran', async () => {
    const a = await vender({ medio: 'transferencia' });
    await anularVenta(db, { ventaId: a.id, usuarioId: duenio, motivo: 'Mal cargada' });

    expect(await ventasPorMedio(db, TODO)).toEqual([]);
  });
});

describe('qué se vendió', () => {
  /*
   * Ordena por plata y no por unidades: veinte vidrios son más unidades que un
   * celular y mucha menos facturación, y lo que hay que reponer es lo segundo.
   */
  it('ordena por facturación, no por cantidad', async () => {
    await vender({ cantidad: 20 }); // 100.000 en vidrios
    await vender({ producto: celular }); // 380.000 en un celular

    const top = await productosVendidos(db, TODO);
    expect(top[0]!.descripcion).toContain('Motorola');
    expect(top[0]!.unidades).toBe(1);
    expect(top[1]!.unidades).toBe(20);
  });

  it('junta las ventas del mismo producto', async () => {
    await vender({ cantidad: 2 });
    await vender({ cantidad: 3 });

    const [vidrios] = await productosVendidos(db, TODO);
    expect(vidrios!.unidades).toBe(5);
    expect(vidrios!.ventas).toBe(2);
    expect(vidrios!.totalCentavos).toBe(25_000_00);
  });

  it('agrupa por categoría', async () => {
    await vender({ cantidad: 2 });
    await vender({ producto: celular });

    const cats = await ventasPorCategoria(db, TODO);
    expect(cats[0]).toEqual({
      categoria: 'Smartphones nuevos',
      unidades: 1,
      totalCentavos: 380_000_00,
    });
    expect(cats[1]!.categoria).toBe('Vidrios');
  });
});

describe('día por día', () => {
  /* Un gráfico al que le faltan los días flojos miente sobre la semana. */
  it('los días sin ventas vienen en cero, no faltan', async () => {
    await venderEn('2026-09-14T15:00:00Z');
    await venderEn('2026-09-16T15:00:00Z');

    const dias = await ventasPorDia(db, periodoEntre('2026-09-14', '2026-09-16'));
    expect(dias).toHaveLength(3);
    expect(dias.map((d) => d.dia)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16']);
    expect(dias[1]!.totalCentavos).toBe(0);
    expect(dias[0]!.totalCentavos).toBe(5_000_00);
  });
});

describe('por vendedor', () => {
  it('separa lo de cada uno', async () => {
    await vender({ vendedorId: duenio });
    await vender({ vendedorId: vendedor, producto: celular });

    const gente = await ventasPorVendedor(db, TODO);
    expect(gente[0]!.nombre).toBe('Rocío');
    expect(gente[0]!.totalCentavos).toBe(380_000_00);
    expect(gente[1]!.nombre).toBe('Lucas');
  });
});

describe('la rentabilidad', () => {
  /*
   * El costo se congela en la línea al confirmar: una venta vieja no cambia de
   * margen porque hoy el proveedor cobre otra cosa.
   */
  it('calcula el margen con el costo congelado en la venta', async () => {
    await vender({ producto: celular });

    const r = await rentabilidad(db, TODO);
    expect(r.ventaConCostoCentavos).toBe(380_000_00);
    expect(r.costoCentavos).toBe(300_000_00);
    expect(r.gananciaCentavos).toBe(80_000_00);
    expect(r.margenBp).toBe(2105); // 21,05%
  });

  it('subirle el costo al producto no cambia el margen de lo ya vendido', async () => {
    await vender({ producto: celular });
    await db.update(products).set({ costoCentavos: 370_000_00 });

    expect((await rentabilidad(db, TODO)).gananciaCentavos).toBe(80_000_00);
  });

  /*
   * Lo importante del reporte: decir sobre cuánto está hablando. Un margen
   * calculado sobre una parte del movimiento y presentado como «el margen del
   * mes» es peor que no tener el número.
   */
  it('informa cuántas unidades tienen costo cargado y cuántas no', async () => {
    await vender({ producto: celular }); // con costo
    await vender({ cantidad: 4 }); // vidrios, sin costo

    const r = await rentabilidad(db, TODO);
    expect(r.unidadesConCosto).toBe(1);
    expect(r.unidadesTotales).toBe(5);
  });

  it('sin ningún costo cargado no inventa un margen', async () => {
    await vender({ cantidad: 3 });

    const r = await rentabilidad(db, TODO);
    expect(r.margenBp).toBeNull();
    expect(r.unidadesConCosto).toBe(0);
  });
});

describe('los gastos del período', () => {
  it('suma lo pagado, por categoría', async () => {
    await registrarGasto(db, {
      fecha: '2026-09-10',
      categoryId: categoriaGasto,
      descripcion: 'Flete',
      montoCentavos: 12_000_00,
      estado: 'pagado',
      medio: 'efectivo',
      monetaryAccountId: caja,
      usuarioId: duenio,
    });

    const g = await gastosPorCategoria(db, periodoEntre('2026-09-01', '2026-09-30'));
    expect(g).toEqual([{ categoria: 'Envíos', totalCentavos: 12_000_00, cantidad: 1 }]);
  });

  /* Un gasto pendiente es una factura que llegó, no plata que salió. */
  it('lo pendiente no cuenta como gasto del período', async () => {
    await registrarGasto(db, {
      fecha: '2026-09-10',
      categoryId: categoriaGasto,
      descripcion: 'Factura de luz',
      montoCentavos: 30_000_00,
      estado: 'pendiente',
      usuarioId: duenio,
    });

    expect(await gastosPorCategoria(db, periodoEntre('2026-09-01', '2026-09-30'))).toEqual([]);
  });

  it('un gasto de otro mes no entra', async () => {
    await registrarGasto(db, {
      fecha: '2026-08-10',
      categoryId: categoriaGasto,
      descripcion: 'Flete de agosto',
      montoCentavos: 9_000_00,
      estado: 'pagado',
      medio: 'efectivo',
      monetaryAccountId: caja,
      usuarioId: duenio,
    });

    expect(await gastosPorCategoria(db, periodoEntre('2026-09-01', '2026-09-30'))).toEqual([]);
  });
});

describe('la facturación mes a mes', () => {
  /*
   * El sistema nuevo arrancó hace poco y el negocio no. Un reporte que empieza
   * el día que se instaló el POS no sirve para comparar nada.
   */
  it('junta lo del POS con lo que quedó del sistema anterior', async () => {
    const hoy = new Date();
    await vender();

    await db.insert(legacySales).values({
      origen: 'yith',
      referenciaExterna: 'resumen-viejo',
      fecha: new Date(hoy.getFullYear(), hoy.getMonth() - 2, 15, 15),
      totalCentavos: 1_000_000_00,
    });

    const meses = await facturacionPorMes(db, 12);
    expect(meses).toHaveLength(12);

    const conHistorico = meses.find((m) => m.historicoCentavos > 0)!;
    expect(conHistorico.historicoCentavos).toBe(1_000_000_00);
    expect(conHistorico.posCentavos).toBe(0);

    const conPos = meses.find((m) => m.posCentavos > 0)!;
    expect(conPos.posCentavos).toBe(5_000_00);
    expect(conPos.totalCentavos).toBe(5_000_00);
  });

  it('los meses sin nada vienen en cero', async () => {
    const meses = await facturacionPorMes(db, 6);
    expect(meses).toHaveLength(6);
    expect(meses.every((m) => m.totalCentavos === 0)).toBe(true);
  });

  it('una venta anulada tampoco figura en el mes', async () => {
    const a = await vender();
    await anularVenta(db, { ventaId: a.id, usuarioId: duenio, motivo: 'Mal cargada' });

    const meses = await facturacionPorMes(db, 3);
    expect(meses.every((m) => m.posCentavos === 0)).toBe(true);
  });
});

describe('el período por nombre contra la base', () => {
  it('«hoy» agarra lo de hoy y nada más', async () => {
    await vender();
    await venderEn('2020-05-05T15:00:00Z');

    const hoy = await resumenDeVentas(db, periodoPorNombre('hoy'));
    expect(hoy.cantidadDeVentas).toBe(1);
  });
});
