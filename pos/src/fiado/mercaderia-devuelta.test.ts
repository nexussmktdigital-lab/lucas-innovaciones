/**
 * El cliente devuelve mercadería y se le descuenta de la cuenta.
 *
 * Dos cosas pasan a la vez y por eso se prueban juntas: la mercadería vuelve
 * al stock y la deuda baja. Lo que no pasa —y es la mitad del diseño— es que
 * entre plata: no entró, entraron cosas.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import {
  auditLog,
  cashMovements,
  creditCharges,
  creditPayments,
  customers,
  products,
  users,
} from '@/db/schema';
import { cuentaDe, ErrorFiado, migrarFichaDePapel, movimientosDe } from './cuenta';
import { registrarMercaderiaDevuelta } from './mercaderia-devuelta';

let db: TestDb;
let duenioId: string;
let clienteId: string;
let termoId: string;
let cajaFuerteId: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);

  const [u] = await db.insert(users).values({ nombre: 'Lucas', rol: 'owner' }).returning();
  duenioId = u!.id;

  const [c] = await db.insert(customers).values({ nombre: 'Uriel Duarte' }).returning();
  clienteId = c!.id;

  const [t] = await db
    .insert(products)
    .values({ nombre: 'Termo Stanley símil', precioCentavos: 28_000_00, stock: 4 })
    .returning();
  termoId = t!.id;

  const [cf] = await db
    .insert(products)
    .values({ nombre: 'Caja fuerte', precioCentavos: 41_000_00, stock: 1 })
    .returning();
  cajaFuerteId = cf!.id;

  // La libreta cargada, que es de donde salió la mercadería que devuelve.
  await migrarFichaDePapel(db, {
    customerId: clienteId,
    saldoCentavos: 1_797_400_00,
    usuarioId: duenioId,
  });
});

describe('registrar mercadería devuelta', () => {
  it('la deuda baja y la mercadería vuelve al stock', async () => {
    const r = await registrarMercaderiaDevuelta(db, {
      customerId: clienteId,
      usuarioId: duenioId,
      renglones: [
        { productId: termoId, cantidad: 2, montoCentavos: 56_000_00 },
        { productId: cajaFuerteId, cantidad: 1, montoCentavos: 41_000_00 },
      ],
    });

    expect(r.totalCentavos).toBe(97_000_00);
    expect(r.saldoCentavos).toBe(1_700_400_00);
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(1_700_400_00);

    const [termo] = await db.select().from(products).where(eq(products.id, termoId));
    const [caja] = await db.select().from(products).where(eq(products.id, cajaFuerteId));
    expect(termo!.stock).toBe(6); // 4 + 2
    expect(caja!.stock).toBe(2); // 1 + 1
  });

  /*
   * La mitad del diseño. No entró plata: entraron cosas. Registrarlo como un
   * pago pondría en el reporte del mes un ingreso que ninguna caja respalda.
   */
  it('no es un pago: no toca la caja ni los cobros', async () => {
    await registrarMercaderiaDevuelta(db, {
      customerId: clienteId,
      usuarioId: duenioId,
      renglones: [{ productId: termoId, cantidad: 1, montoCentavos: 28_000_00 }],
    });

    expect(await db.select().from(cashMovements)).toHaveLength(0);
    expect(await db.select().from(creditPayments)).toHaveLength(0);
  });

  it('queda en la cuenta como devolución, con el detalle de lo que volvió', async () => {
    await registrarMercaderiaDevuelta(db, {
      customerId: clienteId,
      usuarioId: duenioId,
      renglones: [
        { productId: termoId, cantidad: 2, montoCentavos: 56_000_00 },
        { productId: cajaFuerteId, cantidad: 1, montoCentavos: 41_000_00 },
      ],
    });

    const [movimiento] = (await movimientosDe(db, clienteId)).filter(
      (m) => m.tipo === 'devolucion',
    );
    expect(movimiento).toBeTruthy();
    // El monto se lee en positivo: cuál es lo dice el tipo, no el signo.
    expect(movimiento!.montoCentavos).toBe(97_000_00);
    expect(movimiento!.detalle).toContain('2 x Termo Stanley símil');
    expect(movimiento!.detalle).toContain('1 x Caja fuerte');
  });

  it('en la base es un cargo negativo: el mismo hecho que la compra, al revés', async () => {
    await registrarMercaderiaDevuelta(db, {
      customerId: clienteId,
      usuarioId: duenioId,
      renglones: [{ productId: termoId, cantidad: 1, montoCentavos: 28_000_00 }],
    });

    const [cargo] = await db.select().from(creditCharges);
    expect(cargo!.montoCentavos).toBe(-28_000_00);
    expect(cargo!.saldoResultanteCentavos).toBe(1_769_400_00);
  });

  /*
   * El importe no es el precio de catálogo: lo que se le reconoce por algo
   * devuelto se negocia. La libreta de Uriel tiene un vaso de $17.000 que
   * volvió por $8.500.
   */
  it('el importe que se descuenta es el que se escribe, no el del catálogo', async () => {
    const r = await registrarMercaderiaDevuelta(db, {
      customerId: clienteId,
      usuarioId: duenioId,
      // El termo vale $28.000 en el catálogo; se le reconocen $8.500.
      renglones: [{ productId: termoId, cantidad: 1, montoCentavos: 8_500_00 }],
    });

    expect(r.totalCentavos).toBe(8_500_00);
    // Y la unidad entró igual: el stock no depende de lo que se haya pactado.
    const [termo] = await db.select().from(products).where(eq(products.id, termoId));
    expect(termo!.stock).toBe(5);
  });

  /*
   * El fiado no admite negativos a propósito (D36): «te debo» y «me debes»
   * son dos cosas distintas. Recortar en cero haría desaparecer en silencio
   * la plata que el local le quedaría debiendo.
   */
  it('no se puede descontar más de lo que debe, y lo explica', async () => {
    await expect(
      registrarMercaderiaDevuelta(db, {
        customerId: clienteId,
        usuarioId: duenioId,
        renglones: [{ productId: termoId, cantidad: 1, montoCentavos: 2_000_000_00 }],
      }),
    ).rejects.toThrow(/más de lo que debe/i);

    // Y no quedó nada a medio hacer: ni stock ni deuda.
    const [termo] = await db.select().from(products).where(eq(products.id, termoId));
    expect(termo!.stock).toBe(4);
    expect((await cuentaDe(db, clienteId))!.saldoCentavos).toBe(1_797_400_00);
  });

  it('un renglón sin unidades o sin importe frena todo', async () => {
    for (const malo of [
      { productId: termoId, cantidad: 0, montoCentavos: 1_000_00 },
      { productId: termoId, cantidad: 1, montoCentavos: 0 },
      { productId: termoId, cantidad: 1.5, montoCentavos: 1_000_00 },
    ]) {
      await expect(
        registrarMercaderiaDevuelta(db, {
          customerId: clienteId,
          usuarioId: duenioId,
          renglones: [malo],
        }),
      ).rejects.toBeInstanceOf(ErrorFiado);
    }

    expect(await db.select().from(creditCharges)).toHaveLength(0);
    const [termo] = await db.select().from(products).where(eq(products.id, termoId));
    expect(termo!.stock).toBe(4);
  });

  it('sin renglones no hay nada que registrar', async () => {
    await expect(
      registrarMercaderiaDevuelta(db, {
        customerId: clienteId,
        usuarioId: duenioId,
        renglones: [],
      }),
    ).rejects.toBeInstanceOf(ErrorFiado);
  });

  it('queda en la bitácora con el saldo de antes y el de después', async () => {
    await registrarMercaderiaDevuelta(db, {
      customerId: clienteId,
      usuarioId: duenioId,
      renglones: [{ productId: termoId, cantidad: 1, montoCentavos: 28_000_00 }],
      nota: 'Trajo lo que no vendió',
    });

    const [entrada] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.accion, 'fiado.mercaderia_devuelta'));
    expect(entrada!.valorAnterior).toMatchObject({ saldoCentavos: 1_797_400_00 });
    expect(entrada!.valorNuevo).toMatchObject({
      saldoCentavos: 1_769_400_00,
      totalCentavos: 28_000_00,
      nota: 'Trajo lo que no vendió',
    });
  });
});
