/**
 * Migrar la base como parte del despliegue, antes de construir.
 *
 * **Por qué corre sola ahora.** Hasta acá no corría, a propósito: una
 * construcción en Vercel no tendría por qué poder escribir en la base de
 * producción, y una vista previa terminaría migrándola sin que nadie lo pida.
 * La contrapartida resultó más cara que el riesgo: el día que se desplegó el
 * código antes de correr la migración, el POS escribió una columna que la base
 * todavía no tenía y **toda venta falló** con «No se pudo confirmar la venta».
 * El local no pudo cobrar hasta que alguien corrió el SQL a mano.
 *
 * El riesgo de la vista previa se resuelve mirando `VERCEL_ENV`, que es lo que
 * no se había hecho: solo migra la construcción de **producción**.
 *
 * **Si la migración falla, la construcción falla**, y eso es lo que se busca:
 * Vercel deja en pie el despliegue anterior, que funciona. Desplegar código
 * que espera un esquema que no está es justo lo que esto viene a impedir.
 */
import 'dotenv/config';
import { aplicarMigraciones } from './aplicar';

export type Decision =
  | { migra: true; url: string }
  | { migra: false; motivo: string }
  | { migra: false; error: string };

/**
 * Si esta construcción tiene que migrar, y con qué cadena.
 *
 * Función pura para poder probarla: es la que decide si una construcción toca
 * la base de producción, y equivocarse para cualquiera de los dos lados es
 * caro —migrar desde una vista previa, o no migrar y romper el mostrador—.
 */
export function decidir(entorno: Record<string, string | undefined>): Decision {
  if (entorno.SALTAR_MIGRACION_AL_DESPLEGAR === '1') {
    return { migra: false, motivo: 'pedido a mano con SALTAR_MIGRACION_AL_DESPLEGAR=1' };
  }

  // Fuera de Vercel esto es una construcción local o de CI: no migra nada.
  if (!entorno.VERCEL) {
    return { migra: false, motivo: 'no es una construcción de Vercel' };
  }

  /*
   * Solo producción. Una vista previa comparte las variables de entorno con
   * producción, así que sin esta guarda cada rama que alguien despliegue
   * migraría la base del local. Es la razón por la que esto no corría solo.
   */
  if (entorno.VERCEL_ENV !== 'production') {
    return { migra: false, motivo: `es una construcción de «${entorno.VERCEL_ENV}», no de producción` };
  }

  /*
   * En producción sin cadena no se sigue de largo.
   *
   * Saltear en silencio sería volver al problema: una construcción que pasa,
   * un despliegue que sale, y el esquema atrás. Mejor que falle acá.
   */
  const url = entorno.DATABASE_URL_MIGRACIONES || entorno.DATABASE_URL;
  if (!url) {
    return {
      migra: false,
      error:
        'Es una construcción de producción y falta DATABASE_URL. No se puede desplegar sin ' +
        'saber si la base está al día: configurala en Vercel → Settings → Environment Variables.',
    };
  }

  return { migra: true, url };
}

async function principal(): Promise<void> {
  const decision = decidir(process.env);

  if (!decision.migra) {
    if ('error' in decision) {
      console.error(`[migraciones] ${decision.error}`);
      process.exit(1);
    }
    console.log(`[migraciones] No se migra: ${decision.motivo}.`);
    return;
  }

  console.log('[migraciones] Construcción de producción: aplicando las pendientes…');
  try {
    const { descartados } = await aplicarMigraciones(decision.url, './drizzle', (mensaje) =>
      console.log(`[migraciones] ${mensaje}`),
    );
    if (descartados.length > 0) {
      console.log(`[migraciones] Parámetros de libpq ignorados: ${descartados.join(', ')}`);
    }
    console.log('[migraciones] Listo. La base está al día.');
  } catch (error) {
    console.error('[migraciones] Fallaron, y por eso la construcción se corta:', error);
    console.error(
      '[migraciones] El despliegue anterior sigue en pie. Arreglá la migración y volvé a desplegar.',
    );
    process.exit(1);
  }
}

/*
 * Solo cuando se lo ejecuta, no cuando se lo importa.
 *
 * Sin esto, importar el módulo —lo hacen sus tests— corre el script. Hoy no
 * haría nada, porque fuera de Vercel no migra, pero es la clase de cosa que
 * un día se ejecuta donde no debe.
 */
const ejecutado = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (ejecutado) await principal();
