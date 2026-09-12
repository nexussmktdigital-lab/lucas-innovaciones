/**
 * Tipo de cambio.
 *
 * El POS no cotiza: el valor lo produce el plugin `lucas-cotizacion` de
 * WooCommerce dos veces por dia con el blue de Cordoba (D22). Aca se espeja,
 * se versiona y se congela en cada venta.
 *
 * El dueno puede cargar uno a mano cuando hace falta —un feriado, una corrida,
 * la fuente caida— y eso queda auditado con su nombre.
 *
 * Las guardas son las mismas que las del plugin, por la misma razon: un TC mal
 * cargado multiplica el precio de 53 iPhones de una sola vez.
 */
import { desc, sql } from 'drizzle-orm';
import { auditLog, exchangeRates } from '@/db/schema';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';

export class ErrorCotizacion extends Error {}

/** Banda plausible para el dólar, en centavos. Fuera de esto no se acepta. */
export const MINIMO_PLAUSIBLE_CENTAVOS = 100_00;
export const MAXIMO_PLAUSIBLE_CENTAVOS = 500_000_00;

/** Salto máximo respecto de la anterior sin confirmación explícita. */
export const SALTO_MAXIMO = 0.15;

/**
 * A partir de cuántas horas la cotización se considera vieja.
 *
 * El plugin la refresca a las 9 y a las 17, así que pasadas 20 horas sin
 * novedades algo dejó de funcionar.
 */
export const HORAS_HASTA_VENCER = 20;

export interface Cotizacion {
  id: string;
  valorCentavos: number;
  vigenteDesde: Date;
  origen: 'infodolar' | 'dolarapi' | 'manual';
  cargadoPor: string | null;
}

export interface EstadoCotizacion {
  vigente: Cotizacion | null;
  /** Horas desde que rige la vigente. */
  antiguedadHoras: number | null;
  vencida: boolean;
  /** Mensaje para mostrar cuando hay algo que avisar. */
  aviso: string | null;
}

export async function cotizacionVigente(db: BaseDatos): Promise<Cotizacion | null> {
  const [c] = await db
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.vigenteDesde))
    .limit(1);

  return c ?? null;
}

export async function estadoDeLaCotizacion(
  db: BaseDatos,
  ahora: Date = new Date(),
): Promise<EstadoCotizacion> {
  const vigente = await cotizacionVigente(db);

  if (!vigente) {
    return {
      vigente: null,
      antiguedadHoras: null,
      vencida: true,
      aviso:
        'No hay ninguna cotización cargada. Los productos en dólares no se pueden vender hasta que haya una.',
    };
  }

  const antiguedadHoras = (ahora.getTime() - vigente.vigenteDesde.getTime()) / 3_600_000;
  const vencida = antiguedadHoras > HORAS_HASTA_VENCER;

  return {
    vigente,
    antiguedadHoras,
    vencida,
    aviso: vencida
      ? `La cotización es de hace ${Math.floor(antiguedadHoras)} horas. Revisá que el plugin de WooCommerce la esté actualizando, o cargá una a mano.`
      : null,
  };
}

export interface DatosCotizacion {
  valorCentavos: number;
  origen: 'infodolar' | 'dolarapi' | 'manual';
  vigenteDesde?: Date;
  usuarioId?: string | null;
  /** El dueño vio el salto y lo confirma igual. */
  confirmarSalto?: boolean;
}

/**
 * Registra una cotización nueva.
 *
 * Rechaza lo que no puede ser cierto y avisa de lo que probablemente sea un
 * error de tipeo, en vez de dejar pasar un número que después multiplica los
 * precios de todo el catálogo.
 */
export async function registrarCotizacion(
  db: BaseDatos,
  datos: DatosCotizacion,
): Promise<Cotizacion> {
  if (!Number.isSafeInteger(datos.valorCentavos)) {
    throw new ErrorCotizacion('La cotización tiene que ser un monto válido.');
  }
  if (
    datos.valorCentavos < MINIMO_PLAUSIBLE_CENTAVOS ||
    datos.valorCentavos > MAXIMO_PLAUSIBLE_CENTAVOS
  ) {
    throw new ErrorCotizacion(
      `Una cotización de ${datos.valorCentavos / 100} pesos por dólar está fuera de lo posible. Revisá el número.`,
    );
  }

  const anterior = await cotizacionVigente(db);

  if (anterior && !datos.confirmarSalto) {
    const salto = Math.abs(datos.valorCentavos - anterior.valorCentavos) / anterior.valorCentavos;
    if (salto > SALTO_MAXIMO) {
      const direccion = datos.valorCentavos > anterior.valorCentavos ? 'arriba' : 'abajo';
      throw new ErrorCotizacion(
        `Esa cotización está un ${Math.round(salto * 100)}% para ${direccion} de la anterior ` +
          `(${anterior.valorCentavos / 100}). Si es correcta, confirmala.`,
      );
    }
  }

  return db.transaction(async (tx) => {
    const [nueva] = await tx
      .insert(exchangeRates)
      .values({
        valorCentavos: datos.valorCentavos,
        vigenteDesde: datos.vigenteDesde ?? new Date(),
        origen: datos.origen,
        cargadoPor: datos.usuarioId ?? null,
      })
      .returning();

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId ?? null,
      accion: 'cotizacion.registrar',
      entidad: 'exchange_rates',
      entidadId: nueva!.id,
      valorAnterior: anterior ? { valorCentavos: anterior.valorCentavos } : null,
      valorNuevo: { valorCentavos: datos.valorCentavos, origen: datos.origen },
    });

    return nueva!;
  });
}

/** Historial, de la más nueva a la más vieja. */
export async function historialDeCotizaciones(
  db: BaseDatos,
  limite = 30,
): Promise<Cotizacion[]> {
  return db
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.vigenteDesde))
    .limit(limite);
}

/** Cuántos productos del catálogo dependen de la cotización. */
export async function productosEnDolares(db: BaseDatos): Promise<number> {
  const [r] = filasDe<{ total: string | number }>(
    await db.execute(sql`SELECT count(*) AS total FROM products WHERE moneda = 'USD' AND activo`),
  );
  return Number(r?.total ?? 0);
}
