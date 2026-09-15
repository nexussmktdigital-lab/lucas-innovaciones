/**
 * Descarga de planillas.
 *
 * Va como ruta y no como acción de servidor porque lo que tiene que pasar es
 * que el navegador **baje un archivo**: una acción devuelve datos a React, y
 * para que terminen en la carpeta de Descargas habría que armar un Blob en el
 * cliente y simular un clic. Un `<a href>` a una GET con `Content-Disposition`
 * hace lo mismo sin una línea de JavaScript, y además funciona con «guardar
 * enlace como» y se puede pegar en el navegador.
 */
import { auth } from '@/auth';
import { db } from '@/db';
import { puede } from '@/auth/permisos';
import { cabecerasDeDescarga, nombreDeArchivo } from '@/reportes/csv';
import { esExportable, exportar } from '@/reportes/exportar';
import {
  ErrorPeriodo,
  leerNombreDePeriodo,
  periodoEntre,
  periodoPorNombre,
} from '@/reportes/periodo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const sesion = await auth();
  if (!sesion?.user) return new Response('Sin sesión', { status: 401 });

  // La planilla de ventas es el negocio entero en un archivo: es del dueño.
  if (!puede(sesion.user.rol, 'reporte.ventas')) {
    return new Response('No tenés permiso para exportar reportes', { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const que = params.get('que');
  if (!esExportable(que)) {
    return new Response('No sé qué exportar', { status: 400 });
  }

  const desde = params.get('desde');
  const hasta = params.get('hasta');

  try {
    const periodo =
      desde && hasta
        ? periodoEntre(desde, hasta)
        : periodoPorNombre(leerNombreDePeriodo(params.get('periodo') ?? undefined));

    const csv = await exportar(db, que, periodo);

    return new Response(csv, {
      headers: cabecerasDeDescarga(nombreDeArchivo(que, periodo.desdeISO, periodo.hastaISO)),
    });
  } catch (error) {
    if (error instanceof ErrorPeriodo) return new Response(error.message, { status: 400 });
    console.error('[reportes] Falló la exportación:', error);
    return new Response('No se pudo armar la planilla', { status: 500 });
  }
}
