/**
 * Cuentas monetarias: donde esta la plata.
 *
 * El cajon, el banco y Mercado Pago son tres lugares distintos con tres saldos
 * distintos. Hasta acá el sistema solo miraba el cajon, porque era lo unico que
 * el arqueo necesitaba; con los gastos aparece la otra mitad: el alquiler sale
 * del banco y la comision de Mercado Pago se descuenta alla.
 *
 * El saldo de cada cuenta no se escribe a mano: es la suma de sus movimientos.
 * La columna `saldo_centavos` existe para no tener que sumar toda la historia
 * en cada consulta, y hay una funcion aca abajo que comprueba que las dos
 * cuentas den lo mismo. Si alguna vez no dan, el movimiento manda.
 */
import { eq, sql } from 'drizzle-orm';
import { auditLog, cashMovements, monetaryAccounts } from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
import { formatearARS } from '@/lib/dinero';
import { efectivoDelTurno } from '@/caja/cajon';

export class ErrorCuenta extends Error {}

export interface CuentaConSaldo {
  id: string;
  nombre: string;
  tipo: 'efectivo' | 'banco' | 'mercadopago' | 'otro';
  saldoCentavos: number;
  /** Cuántos movimientos tiene, para saber si está en uso. */
  movimientos: number;
}

export async function cuentasConSaldo(db: BaseDatos): Promise<CuentaConSaldo[]> {
  const filas = filasDe<{
    id: string;
    nombre: string;
    tipo: CuentaConSaldo['tipo'];
    saldo_centavos: string | number;
    movimientos: string | number;
  }>(
    await db.execute(sql`
      SELECT c.id, c.nombre, c.tipo, c.saldo_centavos,
             (SELECT count(*) FROM cash_movements m WHERE m.monetary_account_id = c.id)
               AS movimientos
        FROM monetary_accounts c
       WHERE c.activo
       ORDER BY CASE c.tipo WHEN 'efectivo' THEN 0 WHEN 'banco' THEN 1 ELSE 2 END, c.nombre
    `),
  );

  return filas.map((f) => ({
    id: String(f.id),
    nombre: String(f.nombre),
    tipo: f.tipo,
    saldoCentavos: Number(f.saldo_centavos),
    movimientos: Number(f.movimientos),
  }));
}

export interface MovimientoDeCuenta {
  id: string;
  fecha: Date;
  tipo: string;
  montoCentavos: number;
  descripcion: string | null;
  usuario: string | null;
}

export async function movimientosDeCuenta(
  db: BaseDatos,
  cuentaId: string,
  limite = 50,
): Promise<MovimientoDeCuenta[]> {
  const filas = filasDe<{
    id: string;
    created_at: string | Date;
    tipo: string;
    monto_centavos: string | number;
    descripcion: string | null;
    usuario: string | null;
  }>(
    await db.execute(sql`
      SELECT m.id, m.created_at, m.tipo::text AS tipo, m.monto_centavos, m.descripcion,
             u.nombre AS usuario
        FROM cash_movements m
        LEFT JOIN users u ON u.id = m.usuario_id
       WHERE m.monetary_account_id = ${cuentaId}
       ORDER BY m.created_at DESC
       LIMIT ${limite}
    `),
  );

  return filas.map((f) => ({
    id: String(f.id),
    fecha: new Date(f.created_at),
    tipo: String(f.tipo),
    montoCentavos: Number(f.monto_centavos),
    descripcion: f.descripcion,
    usuario: f.usuario,
  }));
}

/**
 * Pasa plata de una cuenta a otra.
 *
 * Es lo que pasa cuando se deposita la recaudacion en el banco: la plata no
 * entra ni sale del negocio, cambia de lugar. Van dos asientos, uno por cuenta,
 * en la misma transaccion; si se registrara uno solo, el total del negocio
 * cambiaria sin que nadie haya gastado ni cobrado nada.
 *
 * Si la salida es de la caja del turno, lleva la sesion para que el arqueo la
 * vea: la plata no esta en el cajon a la hora de contar.
 */
export async function transferir(
  db: BaseDatos,
  datos: {
    origenId: string;
    destinoId: string;
    montoCentavos: number;
    usuarioId: string;
    nota?: string | null;
    cashSessionId?: string | null;
  },
): Promise<{ origenCentavos: number; destinoCentavos: number }> {
  if (!Number.isInteger(datos.montoCentavos) || datos.montoCentavos <= 0) {
    throw new ErrorCuenta('El monto a transferir tiene que ser mayor a cero.');
  }
  if (datos.origenId === datos.destinoId) {
    throw new ErrorCuenta('El origen y el destino son la misma cuenta.');
  }

  return db.transaction(async (tx) => {
    // Las dos cuentas con candado, y siempre en el mismo orden: dos
    // transferencias cruzadas simultáneas no se pueden trabar entre sí.
    const [a, b] = [datos.origenId, datos.destinoId].sort();
    const cuentas = filasDe<{
      id: string;
      nombre: string;
      tipo: string;
      saldo_centavos: string | number;
    }>(
      await tx.execute(sql`
        SELECT id, nombre, tipo::text AS tipo, saldo_centavos FROM monetary_accounts
         WHERE id IN (${a}, ${b}) ORDER BY id FOR UPDATE
      `),
    );

    const origen = cuentas.find((c) => String(c.id) === datos.origenId);
    const destino = cuentas.find((c) => String(c.id) === datos.destinoId);
    if (!origen || !destino) throw new ErrorCuenta('No se encuentra alguna de las cuentas.');

    const saldoOrigen = Number(origen.saldo_centavos);
    if (saldoOrigen < datos.montoCentavos) {
      throw new ErrorCuenta(
        `En «${origen.nombre}» hay ${formatearARS(saldoOrigen)}: ` +
          'no alcanza para esa transferencia.',
      );
    }

    /*
     * Y si sale del cajón, contra lo que hay en el cajón de este turno, que es
     * bastante menos que el saldo de la cuenta: la cuenta arrastra todos los
     * turnos y el cajón se vació anoche. Sin esto se podía depositar en el
     * banco más plata de la que había adentro, y el arqueo quedaba esperando
     * menos de cero: a la noche decía «sobran».
     */
    if (datos.cashSessionId && String(origen.tipo) === 'efectivo') {
      const enElCajon = await efectivoDelTurno(tx, datos.cashSessionId);
      if (enElCajon < datos.montoCentavos) {
        throw new ErrorCuenta(
          `En el cajón de este turno hay ${formatearARS(enElCajon)} y esto saca ` +
            `${formatearARS(datos.montoCentavos)}. Contá de nuevo lo que hay antes de depositar.`,
        );
      }
    }

    const nota = datos.nota?.trim() || null;
    const detalle = (hacia: string) => `Transferencia a ${hacia}${nota ? ` · ${nota}` : ''}`;
    const detalleEntrada = (desde: string) =>
      `Transferencia desde ${desde}${nota ? ` · ${nota}` : ''}`;

    await tx.insert(cashMovements).values([
      {
        monetaryAccountId: datos.origenId,
        cashSessionId: datos.cashSessionId ?? null,
        tipo: 'retiro',
        montoCentavos: -datos.montoCentavos,
        referenciaTipo: 'monetary_accounts',
        referenciaId: datos.destinoId,
        usuarioId: datos.usuarioId,
        descripcion: detalle(String(destino.nombre)),
      },
      {
        monetaryAccountId: datos.destinoId,
        /*
         * La entrada pertenece al turno solo si el destino es el cajón.
         *
         * Antes iba siempre en `null`, con el argumento de que el turno es del
         * cajón y no del banco —cierto cuando se deposita, y al revés cuando
         * se trae plata del banco para dar vuelto: esos billetes entran al
         * cajón que se cuenta a la noche y el arqueo no los veía. El conteo
         * daba de más por el monto traído, sin nada en pantalla que lo
         * explicara.
         */
        cashSessionId: String(destino.tipo) === 'efectivo' ? (datos.cashSessionId ?? null) : null,
        tipo: 'ingreso',
        montoCentavos: datos.montoCentavos,
        referenciaTipo: 'monetary_accounts',
        referenciaId: datos.origenId,
        usuarioId: datos.usuarioId,
        descripcion: detalleEntrada(String(origen.nombre)),
      },
    ]);

    await tx
      .update(monetaryAccounts)
      .set({ saldoCentavos: sql`${monetaryAccounts.saldoCentavos} - ${datos.montoCentavos}` })
      .where(eq(monetaryAccounts.id, datos.origenId));

    await tx
      .update(monetaryAccounts)
      .set({ saldoCentavos: sql`${monetaryAccounts.saldoCentavos} + ${datos.montoCentavos}` })
      .where(eq(monetaryAccounts.id, datos.destinoId));

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'cuenta.transferir',
      entidad: 'monetary_accounts',
      entidadId: datos.origenId,
      valorNuevo: {
        destinoId: datos.destinoId,
        montoCentavos: datos.montoCentavos,
        nota,
      },
    });

    return {
      origenCentavos: saldoOrigen - datos.montoCentavos,
      destinoCentavos: Number(destino.saldo_centavos) + datos.montoCentavos,
    };
  });
}

/**
 * Comprueba que el saldo guardado coincida con la suma de los movimientos.
 *
 * El saldo de la columna es una cache: existe para no sumar toda la historia en
 * cada consulta. Si alguna vez se despega de los movimientos, el que manda es
 * el movimiento, y esto lo saca a la luz en vez de dejar que la diferencia se
 * arrastre callada.
 */
export async function descuadres(
  db: BaseDatos,
): Promise<{ id: string; nombre: string; guardadoCentavos: number; realCentavos: number }[]> {
  const filas = filasDe<{
    id: string;
    nombre: string;
    guardado: string | number;
    real: string | number;
  }>(
    await db.execute(sql`
      SELECT c.id, c.nombre, c.saldo_centavos AS guardado,
             COALESCE((SELECT SUM(m.monto_centavos) FROM cash_movements m
                        WHERE m.monetary_account_id = c.id), 0) AS real
        FROM monetary_accounts c
       WHERE c.saldo_centavos <> COALESCE(
               (SELECT SUM(m.monto_centavos) FROM cash_movements m
                 WHERE m.monetary_account_id = c.id), 0)
    `),
  );

  return filas.map((f) => ({
    id: String(f.id),
    nombre: String(f.nombre),
    guardadoCentavos: Number(f.guardado),
    realCentavos: Number(f.real),
  }));
}

/** El historial de una cuenta con su saldo corriendo, de lo más nuevo a lo más viejo. */
export async function extracto(
  db: BaseDatos,
  cuentaId: string,
  limite = 50,
): Promise<(MovimientoDeCuenta & { saldoCentavos: number })[]> {
  const movimientos = await movimientosDeCuenta(db, cuentaId, limite);

  const [cuenta] = await db
    .select({ saldo: monetaryAccounts.saldoCentavos })
    .from(monetaryAccounts)
    .where(eq(monetaryAccounts.id, cuentaId))
    .limit(1);

  // Se va restando hacia atrás desde el saldo actual: el renglón más nuevo
  // muestra el saldo de hoy y cada uno anterior, el que había antes de él.
  let saldo = cuenta?.saldo ?? 0;
  return movimientos.map((m) => {
    const conSaldo = { ...m, saldoCentavos: saldo };
    saldo -= m.montoCentavos;
    return conSaldo;
  });
}
