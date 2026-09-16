/**
 * ¿Hay servidor del otro lado?
 *
 * `navigator.onLine` dice si hay una interfaz de red levantada, no si se llega
 * al POS: con el wifi del local andando y el módem sin internet dice que sí, y
 * en un pueblo esa es la falla más común de todas. Así que la pantalla
 * pregunta acá, que es la única respuesta que significa algo.
 *
 * No pide sesión: lo que responde es que el servidor está vivo, y nada más. Con
 * sesión, un token vencido se leería como «no hay internet» y el POS se
 * quedaría en modo sin conexión con la conexión perfecta.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return new NextResponse(null, {
    status: 204,
    headers: { 'cache-control': 'no-store' },
  });
}
