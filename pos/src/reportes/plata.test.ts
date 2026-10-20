/**
 * La plata del período: facturado contra entrado, y en qué se fue lo que salió.
 *
 * Lo que se prueba acá es la distinción que el reporte no hacía: que una venta
 * fiada facture sin traer plata, que un canje tampoco la traiga, que el cobro
 * de una deuda vieja sí sea plata del mes aunque la venta sea de antes, y que
 * el desglose por medio sume exactamente lo facturado —si no suma, el número
 * de arriba y los renglones de abajo cuentan dos historias distintas y no hay
 * forma de saber cuál es la buena—.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  customers,
  expenseCategories,
  exchangeRates,
  monetaryAccounts,
  payees,
  products,
  users,
} from '@/db/schema';
import { abrirCaja } from '@/caja/sesion';
import { confirmarVenta } from '@/ventas/confirmar';
import { cobrarFiado } from '@/fiado/cuenta';
import { registrarGasto } from '@/gastos/gastos';
import { periodoEntre } from './periodo';
import {
  cobrosDeFiadoPorMedio,
  facturadoPorMedio,
  flujoDelPeriodo,
  gastosMasGrandes,
  gastosPorCuenta,
} from './plata';
import { resumenDeVentas } from './ventas';

let db: TestDb;
let duenio: string;
let caja: string;
let banco: string;
let sesionId: string;
let vidrio: string;
let celular: string;
let cliente: string;
let categoria: string;
let proveedor: string;

/** Todo lo que estos tests pueden llegar a tocar. */
const TODO = periodoEntre('2021-01-01', '2026-12-31');

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const [u] = await db.insert(users).values({ nombre: 'Lucas', rol: 'owner' }).returning();
  duenio = u!.id;

  const cuentas = await db
    .insert(monetaryAccounts)
    .values([
      { nombre: 'Caja en efectivo', tipo: 'efectivo' },
      { nombre: 'Banco', tipo: 'banco' },
    ])
    .returning();
  caja = cuentas[0]!.id;
  banco = cuentas[1]!.id;

  const prods = await db
    .insert(products)
    .values([
      { nombre: 'Vidrio templado 9D', categoria: 'Vidrios', precioCentavos: 5_000_00, stock: 500 },
      { nombre: 'iPhone 13', categoria: 'Celulares', precioCentavos: 1_000_000_00, stock: 20 },
    ])
    .returning();
  vidrio = prods[0]!.id;
  celular = prods[1]!.id;

  const [cli] = await db.insert(customers).values({ nombre: 'Gaby' }).returning();
  cliente = cli!.id;

  const [cat] = await db
    .insert(expenseCategories)
    .values({ nombre: 'Compra a proveedores', orden: 0 })
    .returning();
  categoria = cat!.id;

  const [pa] = await db.insert(payees).values({ nombre: 'Mayorista Córdoba' }).returning();
  proveedor = pa!.id;

  await db
    .insert(exchangeRates)
    .values({ valorCentavos: 1_500_00, vigenteDesde: new Date(), origen: 'manual' });

  const s = await abrirCaja(db, {
    terminal: 'T1',
    usuarioId: duenio,
    monetaryAccountId: caja,
    saldoInicialCentavos: 5_000_000_00,
  });
  sesionId = s.id;
});

let contador = 0;
const clave = () => `plata-${(contador += 1)}-${Math.random()}`;

function vender(pagos: Parameters<typeof confirmarVenta>[1]['pagos'], producto = vidrio, cantidad = 1) {
  return confirmarVenta(db, {
    lineas: [{ productId: producto, cantidad }],
    pagos,
    clienteId: cliente,
    vendedorId: duenio,
    cashSessionId: sesionId,
    terminal: 'T1',
    idempotencyKey: clave(),
  });
}

function gastar(montoCentavos: number, extra: Record<string, unknown> = {}) {
  return registrarGasto(db, {
    fecha: new Date().toISOString().slice(0, 10),
    categoryId: categoria,
    descripcion: 'Mercadería del mes',
    montoCentavos,
    estado: 'pagado',
    medio: 'efectivo',
    monetaryAccountId: caja,
    cashSessionId: sesionId,
    usuarioId: duenio,
    ...extra,
  });
}

describe('cómo se pagó lo facturado', () => {
  /*
   * La invariante que hace legible la pantalla: el desglose explica el total,
   * entero. Si la suma no da, el lector tiene que creer que la diferencia es
   * redondeo, y no lo es.
   */
  it('la suma del desglose da exactamente lo facturado', async () => {
    await vender([{ medio: 'efectivo', montoCentavos: 5_000_00, monetaryAccountId: caja }]);
    await vender(
      [
        { medio: 'transferencia', montoCentavos: 400_000_00, monetaryAccountId: banco },
        { medio: 'cuenta_corriente', montoCentavos: 600_000_00 },
      ],
      celular,
    );

    const medios = await facturadoPorMedio(db, TODO);
    const suma = medios.reduce((n, m) => n + m.totalCentavos, 0);

    expect(suma).toBe((await resumenDeVentas(db, TODO)).totalCentavos);
    expect(suma).toBe(1_005_000_00);
  });

  it('la cuenta corriente figura en el desglose, marcada como que no es plata', async () => {
    await vender([{ medio: 'cuenta_corriente', montoCentavos: 5_000_00 }]);

    const [fila] = await facturadoPorMedio(db, TODO);
    expect(fila).toMatchObject({ medio: 'cuenta_corriente', totalCentavos: 5_000_00 });
    expect(fila!.esPlata).toBe(false);
  });

  it('el canje tampoco es plata: es un teléfono', async () => {
    // Antes figuraba entre los medios cobrados, debajo de una nota que decía
    // que todo lo listado había entrado. Un canje de $600.000 hacía creer que
    // habían entrado $600.000 que estaban en la vitrina.
    await vender(
      [
        { medio: 'efectivo', montoCentavos: 400_000_00, monetaryAccountId: caja },
        {
          medio: 'canje',
          montoCentavos: 600_000_00,
          equipoRecibido: { nombre: 'iPhone 11 usado', imei: '350000000000001' },
        },
      ],
      celular,
    );

    const medios = await facturadoPorMedio(db, TODO);
    expect(medios.find((m) => m.medio === 'canje')?.esPlata).toBe(false);
    expect(medios.find((m) => m.medio === 'efectivo')?.esPlata).toBe(true);
  });

  it('el efectivo va neto de vuelto, igual que antes', async () => {
    await vender([{ medio: 'efectivo', montoCentavos: 10_000_00, monetaryAccountId: caja }]);

    const [fila] = await facturadoPorMedio(db, TODO);
    expect(fila!.totalCentavos).toBe(5_000_00);
  });
});

describe('lo fiado es la parte fiada, no la venta entera', () => {
  /*
   * El caso que estaba mal: un iPhone de $1.000.000 con $400.000 de anticipo
   * deja $600.000 de deuda. El resumen informaba el millón entero como plata
   * que no entró, cuando $400.000 ya estaban en el cajón.
   */
  it('una venta fiada con anticipo solo debe el resto', async () => {
    await vender(
      [
        { medio: 'efectivo', montoCentavos: 400_000_00, monetaryAccountId: caja },
        { medio: 'cuenta_corriente', montoCentavos: 600_000_00 },
      ],
      celular,
    );

    const r = await resumenDeVentas(db, TODO);
    expect(r.totalCentavos).toBe(1_000_000_00);
    expect(r.fiadoCentavos).toBe(600_000_00);
  });
});

describe('los cobros de fiado son plata del período', () => {
  async function fiarYCobrar(cobroCentavos: number, medio: 'efectivo' | 'transferencia') {
    await vender([{ medio: 'cuenta_corriente', montoCentavos: 1_000_000_00 }], celular);
    return cobrarFiado(db, {
      customerId: cliente,
      montoCentavos: cobroCentavos,
      medio,
      monetaryAccountId: medio === 'efectivo' ? caja : banco,
      cashSessionId: sesionId,
      usuarioId: duenio,
      idempotencyKey: clave(),
    });
  }

  it('entran aunque la venta sea de otro mes', async () => {
    await fiarYCobrar(300_000_00, 'transferencia');

    const cobros = await cobrosDeFiadoPorMedio(db, TODO);
    expect(cobros).toEqual([
      { medio: 'transferencia', cantidad: 1, totalCentavos: 300_000_00, totalUsdCentavos: 0 },
    ]);
  });

  it('suman a lo que entró, y no a lo facturado', async () => {
    await fiarYCobrar(300_000_00, 'efectivo');

    const f = await flujoDelPeriodo(db, TODO);
    // Se facturó el millón; de plata entraron los $300.000 que se cobraron.
    expect(f.facturadoCentavos).toBe(1_000_000_00);
    expect(f.fiadoCentavos).toBe(1_000_000_00);
    expect(f.cobradoDeVentasCentavos).toBe(0);
    expect(f.cobrosDeFiadoCentavos).toBe(300_000_00);
    expect(f.entroCentavos).toBe(300_000_00);
  });

  it('lo cobrado con billetes verdes va aparte y no se suma a los pesos', async () => {
    /*
     * Un total que mezcla dos monedas no es un total. Lo que entró son
     * billetes de dólar, y sumarlos al renglón de pesos —da igual si como
     * dólares o convertidos— deja un número que no es de ninguna moneda.
     */
    await vender([{ medio: 'cuenta_corriente', montoCentavos: 1_000_000_00 }], celular);
    await cobrarFiado(db, {
      customerId: cliente,
      montoCentavos: 150_000_00, // pesos de deuda que se cancelan
      medio: 'dolares',
      cotizacionCentavos: 1_500_00,
      monetaryAccountId: caja,
      cashSessionId: sesionId,
      usuarioId: duenio,
      idempotencyKey: clave(),
    });

    const [cobro] = await cobrosDeFiadoPorMedio(db, TODO);
    expect(cobro).toEqual({
      medio: 'dolares',
      cantidad: 1,
      totalCentavos: 0,
      totalUsdCentavos: 100_00, // $150.000 a 1.500 son cien dólares
    });

    const f = await flujoDelPeriodo(db, TODO);
    expect(f.cobrosDeFiadoCentavos).toBe(0);
    expect(f.cobrosDeFiadoUsdCentavos).toBe(100_00);
    expect(f.entroCentavos).toBe(0);
  });

  it('un cobro fuera del período no cuenta', async () => {
    await fiarYCobrar(300_000_00, 'efectivo');

    const otroMes = periodoEntre('2021-03-01', '2021-03-31');
    expect(await cobrosDeFiadoPorMedio(db, otroMes)).toEqual([]);
  });
});

describe('el flujo del período', () => {
  it('separa lo que se facturó de lo que entró', async () => {
    // Contado: $5.000 que entran al cajón.
    await vender([{ medio: 'efectivo', montoCentavos: 5_000_00, monetaryAccountId: caja }]);
    // Fiada con anticipo: factura un millón, entran $400.000.
    await vender(
      [
        { medio: 'transferencia', montoCentavos: 400_000_00, monetaryAccountId: banco },
        { medio: 'cuenta_corriente', montoCentavos: 600_000_00 },
      ],
      celular,
    );
    await gastar(100_000_00);

    const f = await flujoDelPeriodo(db, TODO);

    expect(f.facturadoCentavos).toBe(1_005_000_00);
    expect(f.cobradoDeVentasCentavos).toBe(405_000_00);
    expect(f.fiadoCentavos).toBe(600_000_00);
    expect(f.entroCentavos).toBe(405_000_00);
    expect(f.salioCentavos).toBe(100_000_00);
    expect(f.quedoCentavos).toBe(305_000_00);

    // Lo facturado se explica entero: lo cobrado más lo fiado más el canje.
    expect(f.cobradoDeVentasCentavos + f.fiadoCentavos + f.canjeCentavos).toBe(
      f.facturadoCentavos,
    );
  });

  it('lo que entró puede ser menos que lo que salió, y lo dice en rojo', async () => {
    await vender([{ medio: 'cuenta_corriente', montoCentavos: 1_000_000_00 }], celular);
    await gastar(50_000_00);

    const f = await flujoDelPeriodo(db, TODO);
    // Un mes de un millón facturado y cincuenta mil de pérdida de caja: es
    // exactamente lo que pasa cuando se fía todo, y el reporte viejo lo
    // mostraba como $950.000 de ganancia.
    expect(f.entroCentavos).toBe(0);
    expect(f.quedoCentavos).toBe(-50_000_00);
  });

  it('un gasto pendiente no salió: se informa aparte', async () => {
    await gastar(80_000_00);
    await registrarGasto(db, {
      fecha: new Date().toISOString().slice(0, 10),
      categoryId: categoria,
      descripcion: 'Factura que llegó y no se pagó',
      montoCentavos: 30_000_00,
      estado: 'pendiente',
      usuarioId: duenio,
    });

    const f = await flujoDelPeriodo(db, TODO);
    expect(f.salioCentavos).toBe(80_000_00);
    expect(f.aPagarCentavos).toBe(30_000_00);
  });

  it('un período sin nada da todo en cero y no rompe', async () => {
    const f = await flujoDelPeriodo(db, periodoEntre('2021-05-01', '2021-05-31'));
    expect(f.facturadoCentavos).toBe(0);
    expect(f.entroCentavos).toBe(0);
    expect(f.quedoCentavos).toBe(0);
  });
});

describe('en qué se fue lo que salió', () => {
  it('se ve de qué cuenta salió cada peso', async () => {
    await gastar(100_000_00);
    await gastar(250_000_00, {
      medio: 'transferencia',
      monetaryAccountId: banco,
      cashSessionId: null,
      descripcion: 'Pago al mayorista',
    });

    const cuentas = await gastosPorCuenta(db, TODO);
    expect(cuentas).toEqual([
      { cuenta: 'Banco', cantidad: 1, totalCentavos: 250_000_00 },
      { cuenta: 'Caja en efectivo', cantidad: 1, totalCentavos: 100_000_00 },
    ]);
  });

  it('los más grandes vienen con a quién y por qué', async () => {
    // «Compra a proveedores: $8.400.000» no contesta la pregunta que sigue.
    await gastar(100_000_00);
    await gastar(900_000_00, {
      payeeId: proveedor,
      descripcion: 'Lote de 10 iPhones',
      medio: 'transferencia',
      monetaryAccountId: banco,
      cashSessionId: null,
    });

    const grandes = await gastosMasGrandes(db, TODO, 5);
    expect(grandes[0]).toMatchObject({
      descripcion: 'Lote de 10 iPhones',
      beneficiario: 'Mayorista Córdoba',
      categoria: 'Compra a proveedores',
      totalCentavos: 900_000_00,
    });
    expect(grandes).toHaveLength(2);
  });

  it('un gasto en dólares se ve con sus dólares', async () => {
    await gastar(0, {
      montoCentavos: undefined,
      montoUsdCentavos: 600_00,
      tcAplicadoCentavos: 1_500_00,
      medio: 'transferencia',
      monetaryAccountId: banco,
      cashSessionId: null,
      descripcion: 'Lote de iPhones al proveedor',
    });

    const [g] = await gastosMasGrandes(db, TODO);
    expect(g).toMatchObject({ moneda: 'USD', montoUsdCentavos: 600_00 });
    // Y en el total del período suma sus pesos, no sus dólares.
    expect(g!.totalCentavos).toBe(900_000_00);
    expect((await flujoDelPeriodo(db, TODO)).salioCentavos).toBe(900_000_00);
  });

  it('un gasto anulado no cuenta en ninguna de las dos vistas', async () => {
    const g = await gastar(100_000_00);
    await db.execute(
      // Anular por el camino real deja el asiento contrario; acá alcanza con
      // el estado, que es lo que estas consultas miran.
      `UPDATE expenses SET estado = 'anulado' WHERE id = '${g.id}'`,
    );

    expect(await gastosPorCuenta(db, TODO)).toEqual([]);
    expect(await gastosMasGrandes(db, TODO)).toEqual([]);
    expect((await flujoDelPeriodo(db, TODO)).salioCentavos).toBe(0);
  });
});
