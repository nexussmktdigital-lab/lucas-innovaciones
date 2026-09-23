/**
 * Deja la base lista para abrir el local. Uso: `npm run preparar`
 *
 * Es lo mínimo indispensable y nada más: el dueño, el vendedor del mostrador,
 * las tres cuentas monetarias y las categorías de gasto. Sin productos de
 * prueba, sin clientes inventados y sin facturación anterior.
 *
 * Existe porque `db:seed` no sirve para esto y nunca sirvió: siembra veintiocho
 * productos que no existen en la tienda, clientes con deudas inventadas y
 * ventas del sistema anterior. Contra la base de producción eso no es un
 * arranque, es ensuciar los reportes del primer día.
 *
 * Las contraseñas se generan acá y se muestran **una sola vez**. No quedan en
 * ningún archivo ni se pueden volver a ver: si se pierden, se corre de nuevo
 * con `--rehacer-claves`.
 *
 *   npm run preparar
 *   npm run preparar -- --email lucas@otro.com --vendedor "Brenda"
 *   npm run preparar -- --rehacer-claves      cambia las claves de los que ya están
 */
import 'dotenv/config';
import { randomInt } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { count, eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { urlDeConexion } from '@/db/url';
import { hashearPassword, hashearPin } from '@/auth/pin';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

/** Lee `--clave valor` de la línea de comandos. */
function opcion(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const EMAIL = opcion('email') ?? 'lucas@lucasinnovaciones.com.ar';
const NOMBRE_DUENIO = opcion('duenio') ?? 'Lucas';
const NOMBRE_VENDEDOR = opcion('vendedor') ?? 'Vendedor de mostrador';
const REHACER = process.argv.includes('--rehacer-claves');

/**
 * Una contraseña que se pueda dictar por teléfono y que igual no se adivine.
 *
 * Sin caracteres que se confundan al leerlos en voz alta ni al tipearlos en la
 * tablet: nada de l, I, 1, O ni 0.
 */
function contraseniaNueva(): string {
  const abc = 'abcdefghijkmnpqrstuvwxyz';
  const num = '23456789';
  const parte = (n: number, de: string) =>
    Array.from({ length: n }, () => de[randomInt(de.length)]).join('');
  return `${parte(4, abc)}-${parte(4, abc)}-${parte(3, num)}`;
}

/** Cuatro dígitos, y que no sean los cuatro iguales ni una escalerita. */
function pinNuevo(): string {
  for (;;) {
    const pin = String(randomInt(1000, 10000));
    if (new Set(pin).size === 1) continue;
    if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) continue;
    return pin;
  }
}

const CATEGORIAS_GASTO = [
  'Alquiler',
  'Servicios',
  'Compra a proveedores',
  'Sueldos',
  'Impuestos',
  'Fletes',
  'Técnico externo',
  'Mantenimiento',
  'Publicidad',
  'Bancarios',
  'Otros',
];

/*
 * `prepare: false` porque la cadena puede ser la del pooler de Neon.
 *
 * El pooler es PgBouncer en modo transacción y ahí las sentencias preparadas
 * con nombre no sobreviven: cada consulta puede caer en otra conexión del
 * fondo común. Para un script que corre unas pocas consultas y termina, las
 * preparadas no aportan nada, así que se apagan y la cadena que se pegue
 * —pooled o directa— anda igual.
 */
const sql = postgres(urlDeConexion(url), { max: 1, prepare: false });
const db = drizzle(sql, { schema, casing: 'snake_case' });

try {
  const [cuantos] = await db.select({ n: count() }).from(schema.users);
  const yaHabia = Number(cuantos?.n ?? 0) > 0;

  if (yaHabia && !REHACER) {
    console.log('\nLa base ya tiene usuarios: no se toca nada.');
    console.log('Para cambiarles la clave: npm run preparar -- --rehacer-claves\n');
    process.exit(0);
  }

  const password = contraseniaNueva();
  const pin = pinNuevo();

  const [duenio] = await db
    .insert(schema.users)
    .values({
      nombre: NOMBRE_DUENIO,
      email: EMAIL,
      passwordHash: await hashearPassword(password),
      rol: 'owner',
    })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: { passwordHash: await hashearPassword(password), activo: true },
    })
    .returning();

  // El vendedor no tiene email, así que no hay clave única contra la cual
  // chocar: se busca por nombre y se decide a mano.
  const [vendedor] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.nombre, NOMBRE_VENDEDOR))
    .limit(1);

  if (vendedor) {
    await db
      .update(schema.users)
      .set({ pinHash: await hashearPin(pin), activo: true })
      .where(eq(schema.users.id, vendedor.id));
  } else {
    await db
      .insert(schema.users)
      .values({ nombre: NOMBRE_VENDEDOR, pinHash: await hashearPin(pin), rol: 'seller' });
  }

  /*
   * Lo que el POS necesita para poder abrir la caja y cargar un gasto.
   *
   * Las cuentas se agregan mirando cuáles faltan, y no con
   * `onConflictDoNothing`: su nombre no tiene restricción única en la base, así
   * que el conflicto nunca ocurre y correr esto dos veces dejaba **seis**
   * cuentas. Apareció probándolo contra una base vacía, que es exactamente para
   * lo que existe este script.
   */
  const CUENTAS = [
    { nombre: 'Caja en efectivo', tipo: 'efectivo' as const },
    { nombre: 'Banco', tipo: 'banco' as const },
    { nombre: 'Mercado Pago', tipo: 'mercadopago' as const },
  ];
  const existentes = new Set(
    (await db.select({ nombre: schema.monetaryAccounts.nombre }).from(schema.monetaryAccounts)).map(
      (c) => c.nombre,
    ),
  );
  const faltan = CUENTAS.filter((c) => !existentes.has(c.nombre));
  if (faltan.length > 0) await db.insert(schema.monetaryAccounts).values(faltan);

  await db
    .insert(schema.expenseCategories)
    .values(CATEGORIAS_GASTO.map((nombre, orden) => ({ nombre, orden })))
    .onConflictDoNothing();

  console.log('\n  La base quedó lista para abrir el local.');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Dueño       ${EMAIL}`);
  console.log(`  Contraseña  ${password}`);
  console.log(`  Vendedor    ${NOMBRE_VENDEDOR} · PIN ${pin}`);
  console.log('  ─────────────────────────────────────────────');
  console.log('  Tres cuentas monetarias y once categorías de gasto.');
  console.log('  Sin productos: el catálogo entra con `npm run woo:sync`.\n');
  console.log('  Esto se muestra UNA SOLA VEZ. Guardalo en el gestor de');
  console.log('  contraseñas ahora, y cambialo desde Cuentas al entrar.\n');

  if (!duenio) console.log('  (El dueño ya existía: se le cambió la contraseña.)\n');
} finally {
  await sql.end();
}
