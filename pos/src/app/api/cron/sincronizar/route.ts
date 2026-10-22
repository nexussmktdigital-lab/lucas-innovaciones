/**
 * El latido programado contra WooCommerce. Hace dos cosas, en este orden.
 *
 * **Uno, drena la cola.** Hasta que existió esta ruta la cola solo se movía al
 * confirmar una venta. Si WooCommerce se caía después de la última venta del
 * día, el ajuste se quedaba quieto hasta la primera venta del día siguiente, y
 * una operación que agotaba los seis reintentos quedaba muerta sin que nadie se
 * enterara.
 *
 * **Dos, trae los pedidos de la tienda online** como ventas con canal «web»
 * (ver `src/woo/pedidos-web.ts`): descuentan el stock del espejo y aparecen en
 * los reportes. Va antes del refresco porque es stock, igual que la cola.
 *
 * **Tres, refresca el catálogo con lo que cambió.** Eso lo harían los webhooks,
 * pero el servidor de la tienda no los puede ni dar de alta: su `curl` rechaza
 * el certificado del POS. Así que el POS pregunta en vez de esperar el aviso
 * (ver `src/woo/refrescar.ts`).
 *
 * El orden importa y no es casual: la cola es plata —stock que la tienda
 * todavía no descontó— y el refresco son precios. Si el tiempo no alcanza para
 * los dos, el que se saltea es el refresco, que se vuelve a intentar en la
 * corrida siguiente.
 *
 * La llama el cron de Vercel (ver `vercel.json`) o cualquier cron externo con
 * el mismo encabezado.
 *
 * **Corre cada media hora y solo de 8 a 22 de Argentina**, no cada diez
 * minutos las veinticuatro horas como al principio. El motivo es la factura:
 * la base se suspende a los cinco minutos de no recibir nada, así que un cron
 * cada diez minutos la dejaba despierta la mitad de cada hora de cada día
 * —unas 365 horas por mes— y se comía la cuota de cómputo de Neon sin que el
 * local vendiera nada. La cola además se drena sola después de cada venta
 * (`drenarEnSegundoPlano`), así que esto es la red de seguridad y no el camino
 * principal.
 *
 * La contrapartida, dicha: **un pedido de la tienda online que entre de noche
 * se importa recién a las 8:07**. El local está cerrado, así que nadie puede
 * vender esa unidad en el medio.
 *
 * No lleva sesion de usuario: se autentica con `CRON_SECRET`. Sin ese secreto
 * configurado la ruta no existe, para que nadie la pueda usar por accidente.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { exchangeRates } from '@/db/schema';
import { ClienteWoo, ErrorWoo } from '@/woo/cliente';
import { drenarCola, pendientesDeSincronizar } from '@/woo/cola';
import { importarPedidosWeb } from '@/woo/pedidos-web';
import { refrescarCatalogo } from '@/woo/refrescar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cuanto se le permite tardar a esta ruta.
 *
 * Sin esto corre con el limite por defecto de la plataforma —diez segundos en
 * el plan Hobby— y una sola operacion contra un WooCommerce lento se lo come
 * entero: la funcion muere a la mitad, cada diez minutos, sin que nadie se
 * entere de que la cola no avanza.
 */
export const maxDuration = 60;

/**
 * Cuantas operaciones por corrida.
 *
 * Con el cron cada media hora son 1.500 por dia, y el local hace del orden de
 * cien ventas: sobra. Lo que no entra queda en la cola y lo levanta la corrida
 * siguiente, o la primera venta que se cobre.
 */
const TOPE = 50;

/**
 * Cuanto tiempo se le da al drenaje, dejando margen antes del corte duro.
 *
 * Lo que no entra queda en la cola y lo levanta la corrida siguiente. Cortar a
 * tiempo y avisarlo es mejor que que la plataforma mate la funcion.
 */
const PRESUPUESTO_MS = 35_000;

/**
 * Hasta acá puede llegar la corrida entera, drenaje más refresco.
 *
 * Diez segundos por debajo de `maxDuration`: el corte del refresco se mide
 * entre páginas, así que la página que esté en vuelo cuando se cumpla el
 * presupuesto todavía tiene que terminar de guardarse.
 */
const TOPE_TOTAL_MS = 50_000;

/**
 * Menos que esto no alcanza para una vuelta de refresco y se saltea.
 *
 * Una corrida que arranca con tres segundos pide la página, se queda sin
 * tiempo, la descarta y no avanza la marca de agua: gasta una consulta contra
 * la tienda para no lograr nada.
 */
const MINIMO_REFRESCO_MS = 8_000;

function autorizado(request: Request): boolean {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return false;

  // Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`.
  const cabecera = request.headers.get('authorization') ?? '';
  const esperado = `Bearer ${secreto}`;
  if (cabecera.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(cabecera), Buffer.from(esperado));
}

/**
 * La cotización con la que se traducen los precios en dólares.
 *
 * Sin cotización el refresco igual corre: los productos en pesos se actualizan
 * y los que están en dólares quedan con el precio que ya tenían, que es mejor
 * que no refrescar nada.
 */
async function cotizacionVigente(): Promise<number | null> {
  const [tc] = await db
    .select({ valorCentavos: exchangeRates.valorCentavos })
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.vigenteDesde))
    .limit(1);
  return tc?.valorCentavos ?? null;
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error('[cron] Falta CRON_SECRET: la tarea programada está apagada.');
    return NextResponse.json({ error: 'Sin configurar' }, { status: 503 });
  }
  if (!autorizado(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const inicio = Date.now();

  try {
    const cliente = ClienteWoo.desdeEntorno();
    const informe = await drenarCola(db, cliente, {
      tope: TOPE,
      presupuestoMs: PRESUPUESTO_MS,
    });
    const cola = await pendientesDeSincronizar(db);

    // Pedidos web, en su propio try: si fallan, el informe de la cola no se pierde
    // y la marca de agua no avanzó, así que la corrida siguiente los vuelve a pedir.
    let pedidosWeb: unknown;
    const paraPedidos = TOPE_TOTAL_MS - (Date.now() - inicio) - MINIMO_REFRESCO_MS;
    if (paraPedidos < 3_000) {
      pedidosWeb = { corrio: false, saltado: 'Sin tiempo: la cola se llevó la corrida.' };
    } else {
      try {
        pedidosWeb = await importarPedidosWeb(db, cliente, { limiteMs: paraPedidos });
      } catch (error) {
        const motivo = error instanceof Error ? error.message : String(error);
        console.warn('[cron] No se pudieron traer los pedidos web:', motivo);
        pedidosWeb = { corrio: false, error: motivo };
      }
    }

    const resto = TOPE_TOTAL_MS - (Date.now() - inicio);
    /*
     * El refresco va adentro de su propio `try`: si la tienda se cae justo
     * ahora, lo que importa es no perder el informe del drenaje, que es el que
     * dice si el stock llegó. La marca de agua no avanzó, así que la corrida
     * siguiente vuelve a pedir la misma ventana.
     */
    let catalogo: unknown;
    if (resto < MINIMO_REFRESCO_MS) {
      catalogo = { corrio: false, saltado: 'Sin tiempo: la cola se llevó la corrida.' };
    } else {
      try {
        catalogo = await refrescarCatalogo(db, cliente, {
          tcCentavos: await cotizacionVigente(),
          limiteMs: resto,
        });
      } catch (error) {
        const motivo = error instanceof Error ? error.message : String(error);
        console.warn('[cron] No se pudo refrescar el catálogo:', motivo);
        catalogo = { corrio: false, error: motivo };
      }
    }

    return NextResponse.json({ ok: true, ...informe, cola, pedidosWeb, catalogo });
  } catch (error) {
    if (error instanceof ErrorWoo) {
      // Woo caído no es un error de esta ruta: la cola espera y se reintenta.
      console.warn('[cron] WooCommerce no disponible:', error.message);
      return NextResponse.json({ ok: false, motivo: error.message }, { status: 200 });
    }
    console.error('[cron] Falló la corrida programada:', error);
    return NextResponse.json({ error: 'Falló la corrida programada' }, { status: 500 });
  }
}
