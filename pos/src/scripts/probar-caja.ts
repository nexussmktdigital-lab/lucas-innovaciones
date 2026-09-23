/**
 * El cajón, contra todas las formas de mover plata.
 *
 * El arqueo es la única cuenta del POS que se puede verificar contra el mundo:
 * lo que dice el sistema tiene que ser lo que hay adentro del cajón. Todo lo
 * demás —el saldo de una cuenta, el margen de un reporte— se compara contra
 * otro número del mismo sistema, que es mucho menos exigente.
 *
 * Entonces: por cada forma de cobrar y de pagar, este script arma un turno
 * solo para ella, calcula **a mano** cuántos billetes deberían quedar y lo
 * compara con lo que dice el sistema. Si alguna combinación no da, eso es
 * plata mal contada.
 *
 * Uso:
 *   npm run caja
 *
 * Deja unos turnos marcados «caja-…» en la base y se niega a correr contra
 * algo que no sea local. Se limpian con `npm run db:seed -- --reset`.
 */
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { urlDeConexion } from '@/db/url';
import { filas } from '@/db/tipos';
import type { BaseDatos } from '@/db/tipos';
import { registrarGasto, pagarGasto, anularGasto } from '@/gastos/gastos';
import { transferir } from '@/gastos/cuentas';
import { abrirCaja, resumenDeSesion } from '@/caja/sesion';
import { cobrarFiado, migrarFichaDePapel } from '@/fiado/cuenta';
import { confirmarVenta } from '@/ventas/confirmar';
import { formatearARS } from '@/lib/dinero';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !process.argv.includes('--si-igual')) {
  console.error(
    'Esta base no es local y el script escribe: turnos, ventas y gastos de prueba.\n' +
      'Si de verdad querés correrlo acá, agregá --si-igual.',
  );
  process.exit(1);
}

/*
 * `prepare: false` porque la cadena puede ser la del pooler de Neon.
 *
 * El pooler es PgBouncer en modo transacción y ahí las sentencias preparadas
 * con nombre no sobreviven: cada consulta puede caer en otra conexión del
 * fondo común. Para un script que corre unas pocas consultas y termina, las
 * preparadas no aportan nada, así que se apagan y la cadena que se pegue
 * —pooled o directa— anda igual.
 */
const conexion = postgres(urlDeConexion(url), { max: 1, prepare: false });
const db = drizzle(conexion, { schema, casing: 'snake_case' }) as BaseDatos;
const uno = async <T,>(q: ReturnType<typeof sql>): Promise<T> =>
  filas<T>(await db.execute(q))[0]!;

const marca = `caja-${Date.now().toString(36)}`;
const hoy = new Date().toISOString().slice(0, 10);
let fallaron = 0;
let n = 0;

const usuarioId = (await uno<{ id: string }>(sql`SELECT id FROM users WHERE rol = 'owner' LIMIT 1`))
  .id;
const efectivo = await uno<{ id: string }>(
  sql`SELECT id FROM monetary_accounts WHERE tipo = 'efectivo' LIMIT 1`,
);
const banco = await uno<{ id: string }>(
  sql`SELECT id FROM monetary_accounts WHERE tipo = 'banco' LIMIT 1`,
);
const mp = await uno<{ id: string }>(
  sql`SELECT id FROM monetary_accounts WHERE tipo = 'mercadopago' LIMIT 1`,
);
const categoriaId = (await uno<{ id: string }>(sql`SELECT id FROM expense_categories LIMIT 1`)).id;

/** Un producto con el precio que haga falta, sin stock que controlar. */
async function producto(precioCentavos: number, etiqueta: string): Promise<string> {
  const p = await uno<{ id: string }>(
    sql`INSERT INTO products (nombre, precio_centavos, gestiona_stock)
        VALUES (${`${etiqueta} ${marca}-${++n}`}, ${precioCentavos}, false) RETURNING id`,
  );
  return p.id;
}

/** Un turno nuevo, para que cada caso empiece con el cajón como lo dejó la apertura. */
async function turno(aperturaCentavos: number): Promise<{ id: string; terminal: string }> {
  const terminal = `${marca}-${++n}`;
  const s = await abrirCaja(db, {
    terminal,
    monetaryAccountId: efectivo.id,
    saldoInicialCentavos: aperturaCentavos,
    usuarioId,
  });
  return { id: s.id, terminal };
}

function comparar(titulo: string, enElCajon: number, segunElSistema: number) {
  const bien = enElCajon === segunElSistema;
  if (!bien) fallaron++;
  console.log(
    `[${bien ? '  OK  ' : ' MAL  '}] ${titulo}\n` +
      `         en el cajón ${formatearARS(enElCajon)} · el sistema dice ${formatearARS(segunElSistema)}`,
  );
}

function afirmar(titulo: string, bien: boolean, obtenido: string) {
  if (!bien) fallaron++;
  console.log(`[${bien ? '  OK  ' : ' MAL  '}] ${titulo}\n         ${obtenido}`);
}

async function esperado(sesionId: string): Promise<number> {
  return (await resumenDeSesion(db, sesionId)).efectivoEsperadoCentavos;
}

console.log('\nEl cajón contra todas las formas de mover plata\n');

/* ---------------------------------------------------------------------- */
/* Cobrar                                                                  */
/* ---------------------------------------------------------------------- */

// 1. Todo en efectivo: entra entero al cajón.
{
  const t = await turno(50_000_00);
  await confirmarVenta(db, {
    lineas: [{ productId: await producto(120_000_00, 'Celular'), cantidad: 1 }],
    pagos: [{ medio: 'efectivo', montoCentavos: 120_000_00, monetaryAccountId: efectivo.id }],
    vendedorId: usuarioId,
    cashSessionId: t.id,
    terminal: t.terminal,
    idempotencyKey: `${marca}-${n}`,
  });
  comparar('Venta en efectivo', 50_000_00 + 120_000_00, await esperado(t.id));
}

// 2. Efectivo con vuelto: lo que queda es el neto, no lo que entregó el cliente.
{
  const t = await turno(50_000_00);
  await confirmarVenta(db, {
    lineas: [{ productId: await producto(120_000_00, 'Celular'), cantidad: 1 }],
    pagos: [{ medio: 'efectivo', montoCentavos: 200_000_00, monetaryAccountId: efectivo.id }],
    vendedorId: usuarioId,
    cashSessionId: t.id,
    terminal: t.terminal,
    idempotencyKey: `${marca}-${n}`,
  });
  comparar('Venta en efectivo con vuelto', 50_000_00 + 120_000_00, await esperado(t.id));
}

// 3. Tarjeta, transferencia y Mercado Pago: no tocan el cajón.
for (const [medio, cuenta] of [
  ['debito', banco],
  ['credito', banco],
  ['transferencia', banco],
  ['mercadopago', mp],
] as const) {
  const t = await turno(50_000_00);
  await confirmarVenta(db, {
    lineas: [{ productId: await producto(120_000_00, 'Celular'), cantidad: 1 }],
    pagos: [
      {
        medio,
        montoCentavos: 120_000_00,
        monetaryAccountId: cuenta.id,
        ...(medio === 'debito' || medio === 'credito' ? { marcaTarjeta: 'Visa' } : {}),
      },
    ],
    vendedorId: usuarioId,
    cashSessionId: t.id,
    terminal: t.terminal,
    idempotencyKey: `${marca}-${n}`,
  });
  comparar(`Venta con ${medio} no toca el cajón`, 50_000_00, await esperado(t.id));
}

// 4. Mixto: solo la parte en efectivo entra al cajón.
{
  const t = await turno(50_000_00);
  await confirmarVenta(db, {
    lineas: [{ productId: await producto(120_000_00, 'Celular'), cantidad: 1 }],
    pagos: [
      { medio: 'efectivo', montoCentavos: 40_000_00, monetaryAccountId: efectivo.id },
      { medio: 'credito', montoCentavos: 80_000_00, monetaryAccountId: banco.id, marcaTarjeta: 'Visa' },
    ],
    vendedorId: usuarioId,
    cashSessionId: t.id,
    terminal: t.terminal,
    idempotencyKey: `${marca}-${n}`,
  });
  comparar('Venta mixta: efectivo + tarjeta', 50_000_00 + 40_000_00, await esperado(t.id));
}

// 5. Fiado: no entra plata, ni siquiera un peso.
{
  const t = await turno(50_000_00);
  const c = await uno<{ id: string }>(
    sql`INSERT INTO customers (nombre) VALUES (${`Fiado ${marca}-${++n}`}) RETURNING id`,
  );
  await confirmarVenta(db, {
    lineas: [{ productId: await producto(120_000_00, 'Celular'), cantidad: 1 }],
    pagos: [{ medio: 'cuenta_corriente', montoCentavos: 120_000_00, monetaryAccountId: null }],
    clienteId: c.id,
    vendedorId: usuarioId,
    cashSessionId: t.id,
    terminal: t.terminal,
    idempotencyKey: `${marca}-${n}`,
  });
  comparar('Venta fiada no entra al cajón', 50_000_00, await esperado(t.id));
}

// 6. Seña en efectivo y el resto fiado.
{
  const t = await turno(50_000_00);
  const c = await uno<{ id: string }>(
    sql`INSERT INTO customers (nombre) VALUES (${`Seña ${marca}-${++n}`}) RETURNING id`,
  );
  await confirmarVenta(db, {
    lineas: [{ productId: await producto(120_000_00, 'Celular'), cantidad: 1 }],
    pagos: [
      { medio: 'efectivo', montoCentavos: 30_000_00, monetaryAccountId: efectivo.id },
      { medio: 'cuenta_corriente', montoCentavos: 90_000_00, monetaryAccountId: null },
    ],
    clienteId: c.id,
    vendedorId: usuarioId,
    cashSessionId: t.id,
    terminal: t.terminal,
    idempotencyKey: `${marca}-${n}`,
  });
  comparar('Seña en efectivo + resto fiado', 50_000_00 + 30_000_00, await esperado(t.id));
}

// 7. Cobrar una deuda vieja: es plata que entra hoy, aunque la venta sea de antes.
for (const [medio, cuenta, entra] of [
  ['efectivo', efectivo, true],
  ['transferencia', banco, false],
  ['mercadopago', mp, false],
] as const) {
  const t = await turno(50_000_00);
  const c = await uno<{ id: string }>(
    sql`INSERT INTO customers (nombre) VALUES (${`Deudor ${marca}-${++n}`}) RETURNING id`,
  );
  await migrarFichaDePapel(db, { customerId: c.id, saldoCentavos: 100_000_00, usuarioId });
  await cobrarFiado(db, {
    customerId: c.id,
    montoCentavos: 40_000_00,
    medio,
    monetaryAccountId: cuenta.id,
    cashSessionId: t.id,
    usuarioId,
    idempotencyKey: `${marca}-${n}`,
  });
  comparar(
    `Cobro de fiado en ${medio}`,
    50_000_00 + (entra ? 40_000_00 : 0),
    await esperado(t.id),
  );
}

/* ---------------------------------------------------------------------- */
/* Pagar                                                                   */
/* ---------------------------------------------------------------------- */

// 8. Gasto pagado del cajón: sale del cajón.
{
  const t = await turno(200_000_00);
  await registrarGasto(db, {
    fecha: hoy,
    categoryId: categoriaId,
    descripcion: `Gasto efectivo ${marca}-${++n}`,
    montoCentavos: 30_000_00,
    estado: 'pagado',
    medio: 'efectivo',
    monetaryAccountId: efectivo.id,
    cashSessionId: t.id,
    usuarioId,
  });
  comparar('Gasto pagado del cajón', 200_000_00 - 30_000_00, await esperado(t.id));
}

// 9. Gasto pagado del banco: el cajón no se entera.
for (const [medio, cuenta] of [
  ['transferencia', banco],
  ['mercadopago', mp],
] as const) {
  const t = await turno(200_000_00);
  await registrarGasto(db, {
    fecha: hoy,
    categoryId: categoriaId,
    descripcion: `Gasto ${medio} ${marca}-${++n}`,
    montoCentavos: 30_000_00,
    estado: 'pagado',
    medio,
    monetaryAccountId: cuenta.id,
    cashSessionId: t.id,
    usuarioId,
  });
  comparar(`Gasto pagado por ${medio} no toca el cajón`, 200_000_00, await esperado(t.id));
}

// 10. Gasto cargado pero no pagado: no mueve un peso.
{
  const t = await turno(200_000_00);
  await registrarGasto(db, {
    fecha: hoy,
    categoryId: categoriaId,
    descripcion: `Gasto pendiente ${marca}-${++n}`,
    montoCentavos: 30_000_00,
    estado: 'pendiente',
    usuarioId,
  });
  comparar('Gasto pendiente no mueve nada', 200_000_00, await esperado(t.id));
}

// 11. Cargado pendiente y pagado después, del cajón.
{
  const t = await turno(200_000_00);
  const g = await registrarGasto(db, {
    fecha: hoy,
    categoryId: categoriaId,
    descripcion: `Gasto a pagar ${marca}-${++n}`,
    montoCentavos: 30_000_00,
    estado: 'pendiente',
    usuarioId,
  });
  await pagarGasto(db, {
    gastoId: g.id,
    medio: 'efectivo',
    monetaryAccountId: efectivo.id,
    cashSessionId: t.id,
    usuarioId,
  });
  comparar('Gasto pendiente, pagado después del cajón', 200_000_00 - 30_000_00, await esperado(t.id));
}

// 12. Pagado y anulado en el mismo turno: la plata vuelve al cajón.
{
  const t = await turno(200_000_00);
  const g = await registrarGasto(db, {
    fecha: hoy,
    categoryId: categoriaId,
    descripcion: `Gasto anulado ${marca}-${++n}`,
    montoCentavos: 30_000_00,
    estado: 'pagado',
    medio: 'efectivo',
    monetaryAccountId: efectivo.id,
    cashSessionId: t.id,
    usuarioId,
  });
  await anularGasto(db, {
    gastoId: g.id,
    motivo: 'Se cargó mal',
    usuarioId,
    cashSessionId: t.id,
  });
  comparar('Gasto pagado y anulado vuelve al cajón', 200_000_00, await esperado(t.id));
}

// 13. Transferencias entre cuentas, para los dos lados.
{
  const t = await turno(200_000_00);
  await transferir(db, {
    origenId: efectivo.id,
    destinoId: banco.id,
    montoCentavos: 50_000_00,
    usuarioId,
    cashSessionId: t.id,
  });
  comparar('Depositar en el banco saca del cajón', 200_000_00 - 50_000_00, await esperado(t.id));
}
{
  const t = await turno(200_000_00);
  await transferir(db, {
    origenId: banco.id,
    destinoId: efectivo.id,
    montoCentavos: 50_000_00,
    usuarioId,
    cashSessionId: t.id,
  });
  comparar('Traer plata del banco entra al cajón', 200_000_00 + 50_000_00, await esperado(t.id));
}

/* ---------------------------------------------------------------------- */
/* Lo que no puede pasar                                                   */
/* ---------------------------------------------------------------------- */

// 14. Sacar del cajón más de lo que hay: no se puede, ni con un gasto…
{
  const t = await turno(0);
  await confirmarVenta(db, {
    lineas: [{ productId: await producto(1_500_000_00, 'Celular caro'), cantidad: 1 }],
    pagos: [{ medio: 'efectivo', montoCentavos: 1_500_000_00, monetaryAccountId: efectivo.id }],
    vendedorId: usuarioId,
    cashSessionId: t.id,
    terminal: t.terminal,
    idempotencyKey: `${marca}-${++n}`,
  });

  let freno: string | null = null;
  try {
    await registrarGasto(db, {
      fecha: hoy,
      categoryId: categoriaId,
      descripcion: `Proveedor ${marca}-${++n}`,
      montoCentavos: 2_000_000_00,
      estado: 'pagado',
      medio: 'efectivo',
      monetaryAccountId: efectivo.id,
      cashSessionId: t.id,
      usuarioId,
    });
  } catch (e) {
    freno = e instanceof Error ? e.message : String(e);
  }

  afirmar(
    'Un gasto no saca del cajón más de lo que hay',
    freno !== null,
    freno ? `frenado: «${freno}»` : 'NO lo frenó: el cajón quedó en negativo',
  );
  comparar('Y el cajón sigue con lo que entró', 1_500_000_00, await esperado(t.id));
}

// 15. …ni con una transferencia.
{
  const t = await turno(100_000_00);
  let freno: string | null = null;
  try {
    await transferir(db, {
      origenId: efectivo.id,
      destinoId: banco.id,
      montoCentavos: 500_000_00,
      usuarioId,
      cashSessionId: t.id,
    });
  } catch (e) {
    freno = e instanceof Error ? e.message : String(e);
  }
  afirmar(
    'Una transferencia no saca del cajón más de lo que hay',
    freno !== null,
    freno ? `frenado: «${freno}»` : 'NO lo frenó: el cajón quedó en negativo',
  );
  comparar('Y el cajón sigue con la apertura', 100_000_00, await esperado(t.id));
}

// 16. El desglose de la pantalla tiene que decir de dónde salió cada peso.
{
  const t = await turno(200_000_00);
  await registrarGasto(db, {
    fecha: hoy,
    categoryId: categoriaId,
    descripcion: `Del cajón ${marca}-${++n}`,
    montoCentavos: 20_000_00,
    estado: 'pagado',
    medio: 'efectivo',
    monetaryAccountId: efectivo.id,
    cashSessionId: t.id,
    usuarioId,
  });
  await registrarGasto(db, {
    fecha: hoy,
    categoryId: categoriaId,
    descripcion: `Del banco ${marca}-${++n}`,
    montoCentavos: 700_000_00,
    estado: 'pagado',
    medio: 'transferencia',
    monetaryAccountId: banco.id,
    cashSessionId: t.id,
    usuarioId,
  });

  const r = await resumenDeSesion(db, t.id);
  afirmar(
    'El renglón «del cajón» cuenta solo lo que salió del cajón',
    r.gastosCentavos === 20_000_00,
    `dice ${formatearARS(r.gastosCentavos)}, tendría que decir ${formatearARS(20_000_00)}`,
  );
  afirmar(
    'Y lo pagado de otra cuenta va aparte',
    r.gastosDeOtraCuentaCentavos === 700_000_00,
    `dice ${formatearARS(r.gastosDeOtraCuentaCentavos)}, tendría que decir ${formatearARS(700_000_00)}`,
  );
}

console.log(
  fallaron === 0
    ? '\nTodas las formas de mover plata dejan el cajón como corresponde.\n'
    : `\n${fallaron} comprobación(es) no dieron. Eso es plata mal contada.\n`,
);

await conexion.end();
process.exit(fallaron > 0 ? 1 : 0);
