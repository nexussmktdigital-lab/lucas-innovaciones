/**
 * Los productos que ya existen y se parecen a lo que se está por cargar.
 *
 * Va como ruta GET y no como server action por lo mismo que el buscador de la
 * venta: se llama mientras alguien tipea, y una GET se cachea y se cancela
 * sola. El alta queda como está —una acción de servidor—; esto solo mira.
 *
 * El permiso es el del alta y no el de ver catálogo: quien puede cargar un
 * producto tiene que poder ver si ya está. Pedir más sería dejar al vendedor
 * cargando a ciegas, que es justo lo que esto viene a evitar.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { puede } from '@/auth/permisos';
import { db } from '@/db';
import { buscarParecidos } from '@/catalogo/crear';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const sesion = await auth();
  if (!sesion?.user) {
    return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });
  }
  if (!puede(sesion.user.rol, 'producto.alta_rapida')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const termino = new URL(request.url).searchParams.get('q') ?? '';

  try {
    return NextResponse.json({ parecidos: await buscarParecidos(db, termino) });
  } catch (error) {
    console.error('[parecidos] Falló la búsqueda:', error);
    return NextResponse.json({ error: 'No se pudo buscar' }, { status: 500 });
  }
}
