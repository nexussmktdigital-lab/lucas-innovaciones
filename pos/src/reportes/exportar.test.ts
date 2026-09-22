/**
 * Tests de las planillas que salen del POS.
 *
 * Se comprueban leyendo el CSV de vuelta con el propio importador: lo que no se
 * puede volver a leer no sirvió de nada. Y se mira qué filas entran y cuáles
 * no, que es donde una exportación miente sin que nadie lo note.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { customers, expenseCategories, monetaryAccounts, products, users } from '@/db/schema';
import { abrirCaja } from '@/caja/sesion';
import { confirmarVenta } from '@/ventas/confirmar';
import { anularVenta } from '@/ventas/anular';
import { anularGasto, registrarGasto } from '@/gastos/gastos';
import { leerCsv } from '@/catalogo/importar';
import { periodoEntre } from './periodo';
import { esExportable, exportar } from './exportar';

let db: TestDb;
let duenio: string;
let caja: string;
let sesionId: string;
let vidrio: string;
let celular: string;
let cliente: string;
let categoria: string;

const TODO = periodoEntre('2021-01-01', '2026-12-31');

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

  const prods = await db
    .insert(products)
    .values([
      { nombre: 'Vidrio templado 9D', sku: 'VID-1', categoria: 'Vidrios', precioCentavos: 5_000_00, stock: 100 },
      {
        nombre: 'Motorola G86',
        sku: 'MOT-1',
        categoria: 'Smartphones nuevos',
        marca: 'Motorola',
        precioCentavos: 380_000_00,
        stock: 10,
        costoCentavos: 300_000_00,
      },
    ])
    .returning();
  vidrio = prods[0]!.id;
  celular = prods[1]!.id;

  const [cli] = await db.insert(customers).values({ nombre: 'Gaby Pérez' }).returning();
  cliente = cli!.id;

  const [cat] = await db
    .insert(expenseCategories)
    .values({ nombre: 'Envíos', orden: 0 })
    .returning();
  categoria = cat!.id;

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

let n = 0;
async function vender(producto: string, cantidad = 1) {
  n += 1;
  const precio = producto === vidrio ? 5_000_00 : 380_000_00;
  return confirmarVenta(db, {
    lineas: [{ productId: producto, cantidad }],
    pagos: [{ medio: 'efectivo', montoCentavos: precio * cantidad, monetaryAccountId: caja }],
    vendedorId: duenio,
    cashSessionId: sesionId,
    terminal: 'T1',
    idempotencyKey: `exp-${n}-${Math.random()}`,
  });
}

/** Devuelve el CSV ya parseado en filas, como lo vería Excel. */
async function planilla(que: 'ventas' | 'renglones' | 'gastos') {
  return leerCsv(await exportar(db, que, TODO));
}

describe('qué se puede exportar', () => {
  it('solo lo que existe', () => {
    expect(esExportable('ventas')).toBe(true);
    expect(esExportable('gastos')).toBe(true);
    expect(esExportable('todo')).toBe(false);
    expect(esExportable(null)).toBe(false);
  });
});

describe('la planilla de ventas', () => {
  it('trae una fila por venta, con encabezado', async () => {
    await vender(vidrio, 2);
    await vender(celular);

    const filas = await planilla('ventas');
    expect(filas[0]).toContain('Numero');
    expect(filas).toHaveLength(3);
  });

  it('los montos salen con coma decimal, que es lo que Excel suma', async () => {
    await vender(vidrio, 2);

    const [encabezado, fila] = await planilla('ventas');
    const total = fila![encabezado!.indexOf('Total')];
    expect(total).toBe('10000,00');
  });

  it('el cliente y los medios de pago vienen con nombre, no con código', async () => {
    await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 1 }],
      pagos: [{ medio: 'cuenta_corriente', montoCentavos: 5_000_00 }],
      clienteId: cliente,
      vendedorId: duenio,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: `exp-fiada-${Math.random()}`,
    });

    const [encabezado, fila] = await planilla('ventas');
    expect(fila![encabezado!.indexOf('Cliente')]).toBe('Gaby Pérez');
    expect(fila![encabezado!.indexOf('Medios de pago')]).toBe('Cuenta corriente');
    expect(fila![encabezado!.indexOf('Tipo')]).toBe('Fiado');
  });

  /*
   * Las anuladas van, marcadas. Esconderlas haría que los números de la
   * planilla no se puedan conciliar con los de ningún otro lado.
   */
  it('una venta anulada figura, marcada y con el motivo', async () => {
    const a = await vender(vidrio);
    await anularVenta(db, { ventaId: a.id, usuarioId: duenio, motivo: 'Se arrepintió' });

    const [encabezado, fila] = await planilla('ventas');
    expect(fila![encabezado!.indexOf('Estado')]).toBe('Anulada');
    expect(fila![encabezado!.indexOf('Motivo de anulacion')]).toBe('Se arrepintió');
  });

  /*
   * El contador va a restar las tres columnas. Antes no daba: el subtotal venía
   * neto de los descuentos de línea y la columna de descuento los incluía, así
   * que restarlas los contaba dos veces.
   */
  it('Bruto menos Descuento da Total, siempre', async () => {
    await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 4 }],
      descuentoGlobal: { tipo: 'porcentaje', porcentaje: 10 },
      pagos: [{ medio: 'efectivo', montoCentavos: 18_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: `exp-desc-${Math.random()}`,
    });

    const [encabezado, fila] = await planilla('ventas');
    const leer = (c: string) => fila![encabezado!.indexOf(c)]!;
    const aNumero = (x: string) => Number(x.replace(',', '.'));

    expect(aNumero(leer('Bruto')) - aNumero(leer('Descuento'))).toBeCloseTo(
      aNumero(leer('Total')),
      2,
    );
    expect(leer('Total')).toBe('18000,00');
  });

  it('un período sin ventas devuelve el encabezado solo', async () => {
    const filas = leerCsv(await exportar(db, 'ventas', periodoEntre('2021-01-01', '2021-01-31')));
    expect(filas).toHaveLength(1);
  });
});

describe('la planilla de renglones', () => {
  it('una fila por producto vendido', async () => {
    await vender(vidrio, 3);
    await vender(celular);

    const filas = await planilla('renglones');
    expect(filas).toHaveLength(3);
  });

  it('trae SKU, categoría y marca del catálogo', async () => {
    await vender(celular);

    const [encabezado, fila] = await planilla('renglones');
    expect(fila![encabezado!.indexOf('SKU')]).toBe('MOT-1');
    expect(fila![encabezado!.indexOf('Marca')]).toBe('Motorola');
    expect(fila![encabezado!.indexOf('Categoria')]).toBe('Smartphones nuevos');
  });

  it('calcula la ganancia cuando hay costo', async () => {
    await vender(celular);

    const [encabezado, fila] = await planilla('renglones');
    expect(fila![encabezado!.indexOf('Costo unitario')]).toBe('300000,00');
    expect(fila![encabezado!.indexOf('Ganancia')]).toBe('80000,00');
  });

  /* Cero sería decir que no se ganó nada; lo que pasa es que no se sabe. */
  it('sin costo cargado la ganancia queda vacía, no en cero', async () => {
    await vender(vidrio);

    const [encabezado, fila] = await planilla('renglones');
    expect(fila![encabezado!.indexOf('Costo unitario')]).toBe('');
    expect(fila![encabezado!.indexOf('Ganancia')]).toBe('');
  });

  /*
   * El descuento global vive en la venta y no baja a las líneas: sin
   * prorratear, la columna «Total» de los renglones suma más que lo cobrado.
   */
  it('el total del renglón es lo que se cobró, con el descuento global adentro', async () => {
    await confirmarVenta(db, {
      lineas: [{ productId: vidrio, cantidad: 4 }],
      descuentoGlobal: { tipo: 'porcentaje', porcentaje: 10 },
      pagos: [{ medio: 'efectivo', montoCentavos: 18_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: `exp-rdesc-${Math.random()}`,
    });

    const [encabezado, fila] = await planilla('renglones');
    expect(fila![encabezado!.indexOf('Total')]).toBe('18000,00');
  });

  /* Un renglón de una venta anulada no se vendió. */
  it('lo anulado no aparece', async () => {
    const a = await vender(vidrio);
    await anularVenta(db, { ventaId: a.id, usuarioId: duenio, motivo: 'Mal cargada' });

    expect(await planilla('renglones')).toHaveLength(1);
  });
});

describe('la planilla de gastos', () => {
  let flete: string;

  beforeEach(async () => {
    const g = await registrarGasto(db, {
      fecha: '2026-09-10',
      categoryId: categoria,
      descripcion: 'Flete de la mercadería',
      montoCentavos: 12_000_00,
      estado: 'pagado',
      medio: 'efectivo',
      monetaryAccountId: caja,
      usuarioId: duenio,
    });
    flete = g.id;
  });

  it('trae el gasto con su categoría y su cuenta', async () => {
    const [encabezado, fila] = await planilla('gastos');
    expect(fila![encabezado!.indexOf('Categoria')]).toBe('Envíos');
    expect(fila![encabezado!.indexOf('Monto')]).toBe('12000,00');
    expect(fila![encabezado!.indexOf('Cuenta')]).toBe('Caja en efectivo');
    expect(fila![encabezado!.indexOf('Medio')]).toBe('Efectivo');
  });

  it('lo pendiente también, marcado como tal', async () => {
    await registrarGasto(db, {
      fecha: '2026-09-11',
      categoryId: categoria,
      descripcion: 'Factura de luz',
      montoCentavos: 30_000_00,
      estado: 'pendiente',
      usuarioId: duenio,
    });

    const filas = await planilla('gastos');
    const encabezado = filas[0]!;
    const luz = filas.find((f) => f[encabezado.indexOf('Descripcion')] === 'Factura de luz')!;
    expect(luz[encabezado.indexOf('Estado')]).toBe('Pendiente');
  });

  /* Un gasto anulado no es plata que salió, igual que una venta anulada. */
  it('lo anulado no figura', async () => {
    await anularGasto(db, { gastoId: flete, motivo: 'Cargado dos veces', usuarioId: duenio });

    const filas = await planilla('gastos');
    expect(filas).toHaveLength(1); // solo el encabezado
  });
});

describe('el archivo se puede volver a leer', () => {
  /*
   * El separador es el punto y coma, así que un nombre que lo contenga es
   * exactamente lo que parte una fila en dos si el escapado está mal.
   */
  it('un producto con punto y coma en el nombre no rompe la fila', async () => {
    const [raro] = await db
      .insert(products)
      .values({ nombre: 'Cable tipo C; 2 metros', precioCentavos: 12_000_00, stock: 10 })
      .returning();

    n += 1;
    await confirmarVenta(db, {
      lineas: [{ productId: raro!.id, cantidad: 1 }],
      pagos: [{ medio: 'efectivo', montoCentavos: 12_000_00, monetaryAccountId: caja }],
      vendedorId: duenio,
      cashSessionId: sesionId,
      terminal: 'T1',
      idempotencyKey: `exp-raro-${n}`,
    });

    const filas = await planilla('renglones');
    expect(filas).toHaveLength(2);

    const encabezado = filas[0]!;
    expect(filas[1]![encabezado.indexOf('Producto')]).toBe('Cable tipo C; 2 metros');
  });
});
