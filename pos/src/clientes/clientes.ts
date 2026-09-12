/**
 * Clientes.
 *
 * Hasta ahora el POS vendia a «consumidor final» y punto: no habia a quien
 * fiarle ni a quien mandarle el comprobante. El fichero de clientes es la
 * contraparte de la cuenta corriente y, mas adelante, de los mensajes por
 * WhatsApp.
 *
 * El telefono se guarda dos veces a proposito: como lo escribio la persona
 * (`telefonoRaw`) y normalizado a E.164 (`telefono`), que es lo unico con lo
 * que se puede mandar un WhatsApp. Normalizar al escribir y no al mandar evita
 * descubrir en la fase 5 que media agenda esta inutilizable.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import { creditAccounts, customers } from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import { normalizar } from '@/lib/texto';

export class ErrorCliente extends Error {}

/** Quita acentos dentro de PostgreSQL, sin depender de la extension unaccent. */
const SIN_ACENTOS = (columna: unknown) =>
  sql`translate(lower(${columna}), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc')`;

/** Codigo de pais de Argentina, para completar los numeros locales. */
const PAIS = '54';

/** Cordoba capital y alrededores. Villa Santa Rosa entra en el 3573. */
const LARGO_MINIMO_NACIONAL = 10;

/**
 * Normaliza un telefono argentino a E.164 (`+549...`), o devuelve null si no
 * parece un numero utilizable.
 *
 * Acepta lo que la gente escribe: «3573 42-1234», «0353 15 4123456»,
 * «+54 9 351 ...». Saca el 0 de larga distancia y el 15, y mete el 9 de movil
 * que WhatsApp necesita.
 */
export function normalizarTelefono(crudo: string | null | undefined): string | null {
  if (!crudo) return null;

  let n = crudo.replace(/[^\d+]/g, '');
  if (n === '') return null;

  if (n.startsWith('+')) {
    n = n.slice(1);
  } else if (n.startsWith('00')) {
    n = n.slice(2);
  }

  // Numero nacional: 0 de larga distancia y 15 de movil se descartan.
  if (!n.startsWith(PAIS)) {
    if (n.startsWith('0')) n = n.slice(1);
    // El 15 va despues del codigo de area, que tiene entre 2 y 4 digitos.
    n = n.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
    if (n.length < LARGO_MINIMO_NACIONAL) return null;
    n = `${PAIS}9${n}`;
  } else if (!n.startsWith(`${PAIS}9`)) {
    // Con codigo de pais pero sin el 9 de movil.
    n = `${PAIS}9${n.slice(PAIS.length)}`;
  }

  // 54 + 9 + area + numero: entre 12 y 14 digitos en Argentina.
  if (n.length < 12 || n.length > 14) return null;
  return `+${n}`;
}

export interface DatosCliente {
  nombre: string;
  telefono?: string | null;
  dni?: string | null;
  email?: string | null;
  direccion?: string | null;
  notas?: string | null;
}

function limpiar(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
}

function validar(datos: DatosCliente): DatosCliente & { nombre: string } {
  const nombre = datos.nombre.trim().replace(/\s+/g, ' ');
  if (nombre.length < 2) {
    throw new ErrorCliente('El nombre del cliente no puede estar vacío.');
  }
  if (nombre.length > 120) {
    throw new ErrorCliente('Ese nombre es demasiado largo.');
  }
  return { ...datos, nombre };
}

export async function crearCliente(
  db: BaseDatos,
  datos: DatosCliente,
): Promise<{ id: string; nombre: string; telefono: string | null }> {
  const limpio = validar(datos);
  const telefonoRaw = limpiar(limpio.telefono);
  const telefono = normalizarTelefono(telefonoRaw);

  // Un homónimo con el mismo teléfono casi siempre es la misma persona cargada
  // dos veces, y dos fichas del mismo cliente son dos deudas que no se ven.
  if (telefono) {
    const [existente] = await db
      .select({ id: customers.id, nombre: customers.nombre })
      .from(customers)
      .where(eq(customers.telefono, telefono))
      .limit(1);

    if (existente) {
      throw new ErrorCliente(
        `Ese teléfono ya es de «${existente.nombre}». Buscalo en vez de cargarlo de nuevo.`,
      );
    }
  }

  const [c] = await db
    .insert(customers)
    .values({
      nombre: limpio.nombre,
      telefono,
      telefonoRaw,
      dni: limpiar(limpio.dni),
      email: limpiar(limpio.email),
      direccion: limpiar(limpio.direccion),
      notas: limpiar(limpio.notas),
    })
    .returning({ id: customers.id, nombre: customers.nombre, telefono: customers.telefono });

  return c!;
}

export async function editarCliente(
  db: BaseDatos,
  id: string,
  datos: DatosCliente,
): Promise<void> {
  const limpio = validar(datos);
  const telefonoRaw = limpiar(limpio.telefono);
  const telefono = normalizarTelefono(telefonoRaw);

  if (telefono) {
    const [otro] = await db
      .select({ nombre: customers.nombre })
      .from(customers)
      .where(and(eq(customers.telefono, telefono), ne(customers.id, id)))
      .limit(1);

    if (otro) {
      throw new ErrorCliente(`Ese teléfono ya es de «${otro.nombre}».`);
    }
  }

  await db
    .update(customers)
    .set({
      nombre: limpio.nombre,
      telefono,
      telefonoRaw,
      dni: limpiar(limpio.dni),
      email: limpiar(limpio.email),
      direccion: limpiar(limpio.direccion),
      notas: limpiar(limpio.notas),
      updatedAt: new Date(),
    })
    .where(eq(customers.id, id));
}

export interface ClienteEnLista {
  id: string;
  nombre: string;
  telefono: string | null;
  telefonoRaw: string | null;
  dni: string | null;
  notas: string | null;
  saldoCentavos: number;
  limiteCentavos: number | null;
  /** Cuántas compras fiadas tiene registradas. */
  comprasFiadas: number;
}

/**
 * Busca clientes por nombre, telefono o DNI. Sin termino, devuelve los ultimos
 * cargados: es lo que sirve cuando se acaba de dar de alta a alguien.
 */
export async function buscarClientes(
  db: BaseDatos,
  termino = '',
  limite = 40,
): Promise<ClienteEnLista[]> {
  const limpio = normalizar(termino);
  const soloDigitos = termino.replace(/\D/g, '');

  // Sin acentos y sin mayusculas, igual que el buscador de productos:
  // «gonzalez» tiene que encontrar a «Gonzalez» y a «Gonzalez» con tilde.
  const porNombre = sql`${SIN_ACENTOS(sql`c.nombre`)} LIKE ${`%${limpio}%`}`;

  // Por numero se busca contra los digitos pelados, para que «3573 42-1234»
  // encuentre al que quedo guardado como «+5493573421234».
  const porNumero = soloDigitos
    ? sql` OR COALESCE(c.dni, '') LIKE ${`%${soloDigitos}%`}
           OR regexp_replace(COALESCE(c.telefono, ''), '[^0-9]', '', 'g') LIKE ${`%${soloDigitos}%`}
           OR regexp_replace(COALESCE(c.telefono_raw, ''), '[^0-9]', '', 'g') LIKE ${`%${soloDigitos}%`}`
    : sql``;

  const filtro = limpio ? sql`AND (${porNombre}${porNumero})` : sql``;

  const filas = filasDe<{
    id: string;
    nombre: string;
    telefono: string | null;
    telefono_raw: string | null;
    dni: string | null;
    notas: string | null;
    saldo_centavos: string | number | null;
    limite_centavos: string | number | null;
    compras_fiadas: string | number;
  }>(
    await db.execute(sql`
      SELECT c.id, c.nombre, c.telefono, c.telefono_raw, c.dni, c.notas,
             a.saldo_centavos, a.limite_centavos,
             (SELECT count(*) FROM sales s
               WHERE s.cliente_id = c.id AND s.tipo = 'fiado' AND s.estado = 'completed')
               AS compras_fiadas
        FROM customers c
        LEFT JOIN credit_accounts a ON a.customer_id = c.id
       WHERE c.activo ${filtro}
       ORDER BY COALESCE(a.saldo_centavos, 0) DESC, c.nombre
       LIMIT ${limite}
    `),
  );

  return filas.map((f) => ({
    id: String(f.id),
    nombre: String(f.nombre),
    telefono: f.telefono,
    telefonoRaw: f.telefono_raw,
    dni: f.dni,
    notas: f.notas,
    saldoCentavos: Number(f.saldo_centavos ?? 0),
    limiteCentavos: f.limite_centavos === null ? null : Number(f.limite_centavos),
    comprasFiadas: Number(f.compras_fiadas),
  }));
}

export async function clientePorId(
  db: BaseDatos,
  id: string,
): Promise<ClienteEnLista | null> {
  const [c] = await db
    .select({
      id: customers.id,
      nombre: customers.nombre,
      telefono: customers.telefono,
      telefonoRaw: customers.telefonoRaw,
      dni: customers.dni,
      notas: customers.notas,
      email: customers.email,
      direccion: customers.direccion,
      saldoCentavos: creditAccounts.saldoCentavos,
      limiteCentavos: creditAccounts.limiteCentavos,
    })
    .from(customers)
    .leftJoin(creditAccounts, eq(creditAccounts.customerId, customers.id))
    .where(eq(customers.id, id))
    .limit(1);

  if (!c) return null;

  return {
    ...c,
    saldoCentavos: c.saldoCentavos ?? 0,
    limiteCentavos: c.limiteCentavos,
    comprasFiadas: 0,
  };
}

/** Los que se pueden elegir en la venta: activos, con la deuda a la vista. */
export async function clientesParaVender(db: BaseDatos, limite = 200) {
  const filas = await db
    .select({
      id: customers.id,
      nombre: customers.nombre,
      telefono: customers.telefono,
      saldoCentavos: creditAccounts.saldoCentavos,
      limiteCentavos: creditAccounts.limiteCentavos,
    })
    .from(customers)
    .leftJoin(creditAccounts, eq(creditAccounts.customerId, customers.id))
    .where(eq(customers.activo, true))
    .orderBy(customers.nombre)
    .limit(limite);

  return filas.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    telefono: c.telefono,
    saldoCentavos: c.saldoCentavos ?? 0,
    limiteCentavos: c.limiteCentavos,
  }));
}
