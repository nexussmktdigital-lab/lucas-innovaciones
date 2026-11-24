/**
 * Si la base está al día con el código que se está ejecutando.
 *
 * Nace del tercer incidente con la misma forma: se despliega código que
 * escribe una columna nueva, la migración no llega a la base, y el mostrador
 * se entera recién al cobrar, con un «No se pudo confirmar la venta» que no
 * dice nada. Las tres veces se perdieron horas en encontrar algo que la base
 * sabía desde el principio.
 *
 * Esto lo pregunta: qué migraciones conoce el código y cuáles aplicó la base.
 * Lo que falte es exactamente el riesgo, porque una migración viaja con el
 * código que la necesita.
 *
 * **El diario se importa, no se lee del disco.** En Vercel la función no
 * tiene la carpeta `drizzle/` al lado: importarlo lo mete en el paquete, que
 * es lo que hace que esto funcione también en producción, que es donde hace
 * falta.
 *
 * **No bloquea nada.** Avisa. Frenar el POS por una migración pendiente sería
 * dejar al local sin vender por nuestra cuenta, y la mayoría de las
 * migraciones no rompen nada; lo que no puede pasar es que nadie se entere.
 */
import { sql } from 'drizzle-orm';
import diario from '../../drizzle/meta/_journal.json';
import { filas, type BaseDatos } from './tipos';

export interface EstadoDelEsquema {
  /** Las migraciones que el código trae y la base todavía no aplicó. */
  pendientes: string[];
  /** Cuántas aplicó la base. Cero suele ser una base recién creada. */
  aplicadas: number;
  /** True si no se pudo averiguar. No se avisa nada: no se sabe. */
  desconocido?: boolean;
}

/**
 * Compara por `when` y no por el nombre.
 *
 * Es lo que guarda Drizzle en su tabla (`created_at`), y es lo único que las
 * dos puntas comparten: el nombre del archivo vive solo en el diario.
 */
/**
 * Lo averiguado hace poco.
 *
 * Esto se pregunta desde el layout, o sea en todas las pantallas, y el esquema
 * no cambia entre un pedido y el siguiente: preguntarlo cada vez es una ida y
 * vuelta a la base por cada carga, y se notó —una prueba que rondaba el límite
 * de tiempo lo pasó—. Se recuerda un minuto, que es poco para el costo y
 * suficiente para que el aviso se vaya solo cuando alguien aplica lo que
 * faltaba, sin tener que volver a desplegar.
 */
const RECORDAR_MS = 60_000;
let recordado: { en: number; estado: EstadoDelEsquema } | null = null;

export async function estadoDelEsquema(
  db: BaseDatos,
  ahora = Date.now(),
): Promise<EstadoDelEsquema> {
  if (recordado && ahora - recordado.en < RECORDAR_MS) return recordado.estado;

  const estado = await averiguar(db);
  recordado = { en: ahora, estado };
  return estado;
}

/** Para las pruebas: olvida lo averiguado. */
export function olvidarEstadoDelEsquema(): void {
  recordado = null;
}

async function averiguar(db: BaseDatos): Promise<EstadoDelEsquema> {
  /*
   * Si esto falla, no pasa nada.
   *
   * Corre en el layout, o sea en TODAS las pantallas: una excepción acá
   * tumbaría el POS entero. Sería una defensa que rompe justo lo que viene a
   * cuidar. La tabla puede no existir —base recién creada, o el usuario sin
   * permiso sobre el esquema `drizzle`— y en ese caso lo honesto es no saber y
   * no avisar nada, no inventar una alarma.
   */
  let aplicadas: { created_at: string | number }[];
  try {
    aplicadas = filas<{ created_at: string | number }>(
      await db.execute(sql`SELECT created_at FROM drizzle.__drizzle_migrations`),
    );
  } catch {
    return { pendientes: [], aplicadas: 0, desconocido: true };
  }

  const yaEstan = new Set(aplicadas.map((f) => Number(f.created_at)));
  const pendientes = diario.entries
    .filter((e) => !yaEstan.has(Number(e.when)))
    .map((e) => e.tag);

  return { pendientes, aplicadas: aplicadas.length };
}

/**
 * El aviso para el mostrador, en castellano.
 *
 * Nombra la migración que falta porque es el dato con el que alguien la
 * aplica en dos minutos; sin el nombre, el aviso es una preocupación sin
 * salida.
 */
export function avisoDeEsquema(estado: EstadoDelEsquema): string | null {
  if (estado.pendientes.length === 0) return null;

  const cuales = estado.pendientes.join(', ');
  return estado.pendientes.length === 1
    ? `La base no está al día: falta aplicar la migración ${cuales}. Hasta que se aplique, ` +
        `algunas operaciones pueden fallar al guardar.`
    : `La base no está al día: faltan aplicar ${estado.pendientes.length} migraciones (${cuales}). ` +
        `Hasta que se apliquen, algunas operaciones pueden fallar al guardar.`;
}
