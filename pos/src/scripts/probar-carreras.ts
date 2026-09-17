/**
 * Dos personas haciendo lo mismo al mismo tiempo.
 *
 * El local tiene dos pantallas —la del mostrador y la tablet— y el dueño mira
 * desde el celular. Todo lo que mueve plata puede pasar dos veces a la vez, y
 * el peor final no es un error: es que las dos entren, la cuenta pierda el
 * doble y el libro quede consistente consigo mismo. Un arqueo así no se nota
 * nunca.
 *
 * Esto no se puede probar en la batería de siempre. Los tests corren sobre
 * PGlite, que es una sola conexión: dos transacciones simultáneas se serializan
 * solas y la prueba pasa aunque el candado no exista. Hace falta PostgreSQL de
 * verdad y **dos conexiones distintas**, y eso es lo que hace este script.
 *
 * Uso:
 *   npm run carreras                 contra la base de DATABASE_URL
 *
 * Deja unas pocas filas marcadas «carrera» en la base. Se limpian con
 * `npm run db:seed -- --reset`. Por eso se niega a correr contra algo que no
 * sea local, salvo que se lo obligue con `--si-igual`.
 *
 * Lo que deja, igual, cierra: después de correrlo, `npm run auditar` sigue
 * dando los diecinueve invariantes en orden. Si alguna vez no diera, esa es la
 * noticia.
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
import { abrirCaja, cerrarCaja } from '@/caja/sesion';
import { migrarFichaDePapel, cobrarFiado } from '@/fiado/cuenta';
import { confirmarVenta } from '@/ventas/confirmar';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const esLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
if (!esLocal && !process.argv.includes('--si-igual')) {
  console.error(
    'Esta base no es local y el script escribe: gastos, turnos y ventas de prueba.\n' +
      'Si de verdad querés correrlo acá, agregá --si-igual.',
  );
  process.exit(1);
}

/* Dos conexiones de verdad: sin esto no hay carrera que probar. */
const conexiones = [1, 2].map(() => postgres(urlDeConexion(url), { max: 1 }));
const [a, b] = conexiones.map((c) => drizzle(c, { schema, casing: 'snake_case' }) as BaseDatos);

const marca = `carrera-${Date.now().toString(36)}`;
let fallaron = 0;

function contar(titulo: string, esperado: string, obtenido: string) {
  const bien = esperado === obtenido;
  if (!bien) fallaron++;
  console.log(`[${bien ? '  OK  ' : 'FALLA '}] ${titulo}`);
  if (!bien) console.log(`          esperaba ${esperado}, dio ${obtenido}`);
}

/** Corre las dos a la vez y dice cuántas terminaron bien. */
async function alMismoTiempo<T>(uno: Promise<T>, otro: Promise<T>) {
  const r = await Promise.allSettled([uno, otro]);
  return {
    aceptadas: r.filter((x) => x.status === 'fulfilled').length,
    errores: r.flatMap((x) => (x.status === 'rejected' ? [String(x.reason?.message ?? x.reason)] : [])),
  };
}

async function uno<T>(db: BaseDatos, consulta: ReturnType<typeof sql>): Promise<T> {
  const [fila] = filas<T>(await db.execute(consulta));
  return fila!;
}

const { id: usuarioId } = await uno<{ id: string }>(a!, sql`SELECT id FROM users LIMIT 1`);
const { id: categoriaId } = await uno<{ id: string }>(
  a!,
  sql`SELECT id FROM expense_categories LIMIT 1`,
);
const banco = await uno<{ id: string }>(
  a!,
  sql`SELECT id FROM monetary_accounts WHERE tipo = 'banco' LIMIT 1`,
);
const efectivo = await uno<{ id: string }>(
  a!,
  sql`SELECT id FROM monetary_accounts WHERE tipo = 'efectivo' LIMIT 1`,
);
const hoy = new Date().toISOString().slice(0, 10);

async function saldo(cuentaId: string): Promise<number> {
  const f = await uno<{ saldo_centavos: string | number }>(
    a!,
    sql`SELECT saldo_centavos FROM monetary_accounts WHERE id = ${cuentaId}`,
  );
  return Number(f.saldo_centavos);
}

async function movimientosDe(referenciaId: string): Promise<number> {
  const f = await uno<{ n: number }>(
    a!,
    sql`SELECT count(*)::int AS n FROM cash_movements WHERE referencia_id = ${referenciaId}`,
  );
  return Number(f.n);
}

/* ---------------------------------------------------------------------- */

console.log(`\nCarreras contra ${esLocal ? 'la base local' : 'la base configurada'}\n`);

// 1. El mismo gasto, pagado dos veces a la vez.
{
  const gasto = await registrarGasto(a!, {
    fecha: hoy,
    categoryId: categoriaId,
    descripcion: `Pago doble ${marca}`,
    montoCentavos: 100_000,
    estado: 'pendiente',
    usuarioId,
  });
  const antes = await saldo(banco.id);
  const datos = { gastoId: gasto.id, medio: 'transferencia' as const, monetaryAccountId: banco.id, usuarioId };
  const r = await alMismoTiempo(pagarGasto(a!, datos), pagarGasto(b!, datos));

  contar('Un gasto no se paga dos veces', '1 pago', `${r.aceptadas} pago`);
  contar('Y la plata sale una sola vez', '100000 menos', `${antes - (await saldo(banco.id))} menos`);
  contar('Un solo movimiento de caja', '1', String(await movimientosDe(gasto.id)));
}

// 2. El mismo gasto pagado, anulado dos veces a la vez.
{
  const gasto = await registrarGasto(a!, {
    fecha: hoy,
    categoryId: categoriaId,
    descripcion: `Anulación doble ${marca}`,
    montoCentavos: 50_000,
    estado: 'pagado',
    medio: 'transferencia',
    monetaryAccountId: banco.id,
    usuarioId,
  });
  const antes = await saldo(banco.id);
  const datos = { gastoId: gasto.id, motivo: 'Prueba de carrera', usuarioId };
  const r = await alMismoTiempo(anularGasto(a!, datos), anularGasto(b!, datos));

  contar('Un gasto no se anula dos veces', '1 anulación', `${r.aceptadas} anulación`);
  contar('Y la plata vuelve una sola vez', '50000 más', `${(await saldo(banco.id)) - antes} más`);
}

// 3. El mismo turno, cerrado dos veces a la vez, con diferencia de arqueo.
{
  const terminal = `${marca}-caja`;
  const sesion = await abrirCaja(a!, {
    terminal,
    monetaryAccountId: efectivo.id,
    saldoInicialCentavos: 10_000,
    usuarioId,
  });
  const antes = await saldo(efectivo.id);
  const datos = {
    sesionId: sesion.id,
    saldoContadoCentavos: 7_000,
    justificacion: 'Prueba de carrera',
    usuarioId,
  };
  const r = await alMismoTiempo(cerrarCaja(a!, datos), cerrarCaja(b!, datos));

  contar('Un turno no se cierra dos veces', '1 cierre', `${r.aceptadas} cierre`);
  contar(
    'Y el ajuste del arqueo se descuenta una sola vez',
    '3000 menos',
    `${antes - (await saldo(efectivo.id))} menos`,
  );
}

// 4. La misma terminal, abierta dos veces a la vez.
{
  const terminal = `${marca}-doble`;
  const datos = {
    terminal,
    monetaryAccountId: efectivo.id,
    saldoInicialCentavos: 1_000,
    usuarioId,
  };
  const r = await alMismoTiempo(abrirCaja(a!, datos), abrirCaja(b!, datos));
  const abiertas = await uno<{ n: number }>(
    a!,
    sql`SELECT count(*)::int AS n FROM cash_sessions WHERE terminal = ${terminal} AND cerrada_en IS NULL`,
  );

  contar('Una terminal no queda con dos cajas abiertas', '1 abierta', `${Number(abiertas.n)} abierta`);
  contar('Y una de las dos aperturas falla', '1 aceptada', `${r.aceptadas} aceptada`);
}

// 5. El mismo cobro de fiado, reintentado a la vez con la misma clave.
{
  const cliente = await uno<{ id: string }>(
    a!,
    sql`INSERT INTO customers (nombre) VALUES (${`Cliente ${marca}`}) RETURNING id`,
  );
  const turno = await abrirCaja(a!, {
    terminal: `${marca}-fiado`,
    monetaryAccountId: efectivo.id,
    saldoInicialCentavos: 0,
    usuarioId,
  });
  // La deuda de arranque entra como ficha de papel: es la única forma de
  // dejar un saldo sin inventar una venta entera para el fixture.
  await migrarFichaDePapel(a!, {
    customerId: cliente.id,
    saldoCentavos: 200_000,
    usuarioId,
    nota: 'Prueba de carrera',
  });

  const antes = await saldo(efectivo.id);
  const datos = {
    customerId: cliente.id,
    montoCentavos: 80_000,
    medio: 'efectivo' as const,
    monetaryAccountId: efectivo.id,
    cashSessionId: turno.id,
    usuarioId,
    idempotencyKey: `${marca}-cobro`,
  };
  await alMismoTiempo(cobrarFiado(a!, datos), cobrarFiado(b!, datos));

  const cuenta = await uno<{ saldo_centavos: string | number }>(
    a!,
    sql`SELECT saldo_centavos FROM credit_accounts WHERE customer_id = ${cliente.id}`,
  );
  contar(
    'El mismo cobro con la misma clave descuenta una vez',
    'debe 120000',
    `debe ${Number(cuenta.saldo_centavos)}`,
  );
  contar('Y entra a la caja una vez', '80000 más', `${(await saldo(efectivo.id)) - antes} más`);
}

// 6. La última unidad en stock, vendida dos veces a la vez.
{
  const producto = await uno<{ id: string }>(
    a!,
    sql`INSERT INTO products (nombre, precio_centavos, stock, gestiona_stock)
        VALUES (${`Última unidad ${marca}`}, 100000, 1, true) RETURNING id`,
  );
  const turno = await abrirCaja(a!, {
    terminal: `${marca}-venta`,
    monetaryAccountId: efectivo.id,
    saldoInicialCentavos: 0,
    usuarioId,
  });
  const venta = (clave: string) => ({
    lineas: [{ productId: producto.id, cantidad: 1 }],
    pagos: [{ medio: 'efectivo' as const, montoCentavos: 100_000, monetaryAccountId: efectivo.id }],
    vendedorId: usuarioId,
    cashSessionId: turno.id,
    terminal: `${marca}-venta`,
    idempotencyKey: clave,
  });
  const r = await alMismoTiempo(
    confirmarVenta(a!, venta(`${marca}-v1`)),
    confirmarVenta(b!, venta(`${marca}-v2`)),
  );

  const p = await uno<{ stock: string | number }>(
    a!,
    sql`SELECT stock FROM products WHERE id = ${producto.id}`,
  );
  contar('La última unidad se vende una sola vez', '1 venta', `${r.aceptadas} venta`);
  contar('Y el stock no queda en negativo', 'stock 0', `stock ${Number(p.stock)}`);

  const numeros = filas<{ numero: string }>(
    await a!.execute(sql`SELECT numero FROM sales WHERE terminal = ${`${marca}-venta`}`),
  );
  contar(
    'Sin correlativos repetidos',
    `${numeros.length} distintos`,
    `${new Set(numeros.map((n) => n.numero)).size} distintos`,
  );
}

console.log(
  fallaron === 0
    ? '\nNinguna carrera dejó plata mal contada.\n'
    : `\n${fallaron} carrera(s) terminaron mal. Eso es plata mal contada.\n`,
);

await Promise.all(conexiones.map((c) => c.end()));
process.exit(fallaron > 0 ? 1 : 0);
