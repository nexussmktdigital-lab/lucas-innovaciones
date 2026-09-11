/**
 * Buscador de la pantalla de venta.
 *
 * Va como ruta y no como server action porque se llama en cada tecla: TanStack
 * Query cachea y cancela por su cuenta, y una GET normal es lo que mejor se
 * lleva con eso.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db } from '@/db';
import { buscarProductos, TOPE_RESULTADOS } from '@/ventas/buscar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const sesion = await auth();
  if (!sesion?.user) {
    return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });
  }

  const url = new URL(request.url);
  const termino = url.searchParams.get('q') ?? '';
  const incluirSinStock = url.searchParams.get('sinStock') === '1';

  if (termino.trim().length === 0) {
    return NextResponse.json({ resultados: [] });
  }

  try {
    const resultados = await buscarProductos(db, termino, {
      limite: TOPE_RESULTADOS,
      incluirSinStock,
    });
    return NextResponse.json({ resultados });
  } catch (error) {
    console.error('[buscar] Falló la búsqueda:', error);
    return NextResponse.json({ error: 'No se pudo buscar' }, { status: 500 });
  }
}
