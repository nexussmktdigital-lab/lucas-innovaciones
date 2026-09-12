/**
 * Drenaje programado de la cola hacia WooCommerce.
 *
 * Hasta ahora la cola solo se movia al confirmar una venta. Si WooCommerce se
 * caia despues de la ultima venta del dia, el ajuste se quedaba quieto hasta la
 * primera venta del dia siguiente, y una operacion que agotaba los seis
 * reintentos quedaba muerta sin que nadie se enterara.
 *
 * Esta ruta la pasa cada tanto. La llama el cron de Vercel (ver `vercel.json`)
 * o cualquier cron externo con el mismo encabezado.
 *
 * No lleva sesion de usuario: se autentica con `CRON_SECRET`. Sin ese secreto
 * configurado la ruta no existe, para que nadie la pueda usar por accidente.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { db } from '@/db';
import { ClienteWoo, ErrorWoo } from '@/woo/cliente';
import { drenarCola, pendientesDeSincronizar } from '@/woo/cola';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cuantas operaciones por corrida. Con el cron cada 10 minutos, sobra. */
const TOPE = 50;

function autorizado(request: Request): boolean {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return false;

  // Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`.
  const cabecera = request.headers.get('authorization') ?? '';
  const esperado = `Bearer ${secreto}`;
  if (cabecera.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(cabecera), Buffer.from(esperado));
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error('[cron] Falta CRON_SECRET: el drenaje programado está apagado.');
    return NextResponse.json({ error: 'Sin configurar' }, { status: 503 });
  }
  if (!autorizado(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const cliente = ClienteWoo.desdeEntorno();
    const informe = await drenarCola(db, cliente, { tope: TOPE });
    const cola = await pendientesDeSincronizar(db);

    return NextResponse.json({ ok: true, ...informe, cola });
  } catch (error) {
    if (error instanceof ErrorWoo) {
      // Woo caído no es un error de esta ruta: la cola espera y se reintenta.
      console.warn('[cron] WooCommerce no disponible:', error.message);
      return NextResponse.json({ ok: false, motivo: error.message }, { status: 200 });
    }
    console.error('[cron] Falló el drenaje:', error);
    return NextResponse.json({ error: 'Falló el drenaje' }, { status: 500 });
  }
}
