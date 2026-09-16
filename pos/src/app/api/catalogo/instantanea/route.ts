/**
 * El catálogo entero, para que la tablet lo guarde y pueda vender sin conexión.
 *
 * Va como ruta y no como acción de servidor porque lo que hace es bajar un
 * archivo: una GET normal, que el navegador puede reintentar, cachear y pedir
 * desde el service worker sin ceremonia.
 *
 * Son ~1.400 renglones entre productos y variaciones, unos pocos cientos de
 * kilobytes. Se manda entero y no por páginas a propósito: el producto que
 * falte va a ser exactamente el que alguien quiera vender.
 */
import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { exchangeRates } from '@/db/schema';
import { buscarProductos } from '@/ventas/buscar';
import { recargoDeTienda } from '@/precios/config';
import { TOPE_CATALOGO, type Instantanea } from '@/offline/catalogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const sesion = await auth();
  if (!sesion?.user) {
    return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });
  }

  try {
    /*
     * Se arma con el mismo buscador de siempre, con un patrón que matchea todo.
     * Reusarlo es lo que garantiza que el precio de mostrador, el stock de una
     * variación y el nombre compuesto se calculen igual acá que en la pantalla
     * con conexión; una segunda consulta «parecida» se despegaría en la primera
     * corrección que se le haga a una sola de las dos.
     */
    const productos = await buscarProductos(db, '', {
      limite: TOPE_CATALOGO,
      incluirSinStock: true,
      recargoTiendaBp: await recargoDeTienda(db),
      todos: true,
    });

    const [tc] = await db
      .select()
      .from(exchangeRates)
      .orderBy(desc(exchangeRates.vigenteDesde))
      .limit(1);

    const instantanea: Instantanea = {
      bajadaEn: new Date().toISOString(),
      tcCentavos: tc?.valorCentavos ?? null,
      productos,
    };

    return NextResponse.json(instantanea, {
      // Que no lo cachee nadie por su cuenta: quien decide cuándo el catálogo
      // guardado está viejo es la pantalla, mirando `bajadaEn`.
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error('[catalogo] Falló la instantánea:', error);
    return NextResponse.json({ error: 'No se pudo armar el catálogo' }, { status: 500 });
  }
}
