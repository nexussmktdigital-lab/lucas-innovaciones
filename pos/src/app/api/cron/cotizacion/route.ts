/**
 * La tarea que trae el dólar, cada dos horas.
 *
 * Lee el blue vendedor de Córdoba de infodolar.com, lo guarda y repreci a lo que
 * está en dólares. Hasta acá el valor lo producía el plugin `lucas-cotizacion`
 * de WooCommerce (D22), que dejó de contestar: la cotización salía de lo que
 * alguien se acordara de cargar a mano en `F9`.
 *
 * Va aparte de `/api/cron/sincronizar` y no adentro, por dos razones. Una, los
 * ritmos no son el mismo: la cola hay que drenarla seguido porque es stock que
 * la tienda todavía no descontó, y el dólar cada dos horas sobra. La otra, y
 * más importante: si infodólar está caído, lo que no tiene que pasar es que se
 * frene el drenaje de la cola.
 *
 * **Corre de 8 a 22 de Argentina y no las veinticuatro horas**, por la misma
 * razón que el otro cron: la base se suspende a los cinco minutos y cada
 * despertada se paga. De noche no hay quién mire un precio.
 *
 * La primera corrida del día es a las 8:07, casi una hora antes de que abra el
 * local, así que a las 9 el dólar tiene menos de una hora. Eso importa: una
 * cotización de más de seis horas (`HORAS_HASTA_VENCER`) sale avisada en la
 * pantalla de inicio, y nadie quiere empezar el día con ese cartel.
 *
 * **Lo que esta tarea NO hace es forzar.** Guardar pasa por
 * `registrarCotizacion`, con sus guardas de banda plausible y de salto máximo,
 * y acá no se las saltea: un salto grande se informa y se deja para que el
 * dueño lo confirme a mano desde `F9`. Ante la duda, el dólar queda viejo y
 * visible, que es mucho mejor que nuevo e inventado.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { db } from '@/db';
import {
  cotizacionVigente,
  ErrorCotizacion,
  registrarCotizacion,
} from '@/cotizacion/cotizacion';
import { ErrorInfodolar, obtenerBlueCordoba } from '@/cotizacion/infodolar';
import { repreciarEnDolares } from '@/cotizacion/repreciar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Hasta cuándo se acepta un dato que infodólar dice tener viejo.
 *
 * La página contesta igual con el número congelado de ayer, así que sin este
 * control una fuente muerta se vería exactamente igual que una sana.
 *
 * Sin `export`: un archivo de ruta de Next solo puede exportar los nombres que
 * el framework conoce (`GET`, `runtime`, `maxDuration`…), y cualquier otro
 * rompe el build. No lo ven ni `tsc` ni las pruebas: lo caza `next build`.
 */
const HORAS_MAXIMAS_DEL_DATO = 24;

function autorizado(request: Request): boolean {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return false;

  const cabecera = request.headers.get('authorization') ?? '';
  const esperado = `Bearer ${secreto}`;
  if (cabecera.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(cabecera), Buffer.from(esperado));
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error('[cotizacion] Falta CRON_SECRET: la tarea está apagada.');
    return NextResponse.json({ error: 'Sin configurar' }, { status: 503 });
  }
  if (!autorizado(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  let leido;
  try {
    leido = await obtenerBlueCordoba();
  } catch (error) {
    const motivo = error instanceof ErrorInfodolar ? error.message : String(error);
    // No es un error de esta ruta: la cotización anterior sigue valiendo y la
    // pantalla de Inicio avisa cuando se pone vieja.
    console.warn('[cotizacion] No se pudo leer infodólar:', motivo);
    return NextResponse.json({ ok: false, motivo }, { status: 200 });
  }

  if (leido.actualizado) {
    const horas = (Date.now() - leido.actualizado.getTime()) / 3_600_000;
    if (horas > HORAS_MAXIMAS_DEL_DATO) {
      const motivo = `Infodólar trae un dato de hace ${Math.round(horas)} horas. No se guarda.`;
      console.warn('[cotizacion]', motivo);
      return NextResponse.json({ ok: false, motivo }, { status: 200 });
    }
  }

  const anterior = await cotizacionVigente(db);

  // Sin cambio no se escribe nada: cada fila de `exchange_rates` es una
  // versión, y doce por día diciendo lo mismo ensucian el historial que se
  // mira cuando hay que entender con qué dólar se vendió algo.
  if (anterior && anterior.valorCentavos === leido.ventaCentavos) {
    return NextResponse.json({
      ok: true,
      sinCambio: true,
      valorCentavos: leido.ventaCentavos,
    });
  }

  try {
    const nueva = await registrarCotizacion(db, {
      valorCentavos: leido.ventaCentavos,
      vigenteDesde: leido.actualizado ?? new Date(),
      origen: 'infodolar',
      // Sin usuario: la cargó la tarea, y así queda en la bitácora.
      usuarioId: null,
    });

    // Reprecia el espejo del POS. A la web no se le empuja nada: su ficha en
    // dólares guarda dólares y el plugin le aplica la cotización al renderizar.
    const repreciado = await repreciarEnDolares(db, nueva.valorCentavos);

    return NextResponse.json({
      ok: true,
      valorCentavos: nueva.valorCentavos,
      anteriorCentavos: anterior?.valorCentavos ?? null,
      repreciado,
    });
  } catch (error) {
    if (error instanceof ErrorCotizacion) {
      /*
       * La guarda de salto: el dólar se movió más del 15% de una. Puede ser
       * una corrida de verdad o infodólar leyendo cualquier cosa, y desde acá
       * no hay forma de distinguirlas. Se informa y lo confirma una persona.
       */
      console.warn('[cotizacion] Cotización rechazada por la guarda:', error.message);
      return NextResponse.json(
        { ok: false, requiereConfirmacion: true, motivo: error.message, leido: leido.ventaCentavos },
        { status: 200 },
      );
    }
    console.error('[cotizacion] Falló la tarea:', error);
    return NextResponse.json({ error: 'Falló la tarea de cotización' }, { status: 500 });
  }
}
