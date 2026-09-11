/**
 * Entrada de los webhooks de WooCommerce.
 *
 * Refresca el espejo del catalogo cuando cambia un producto y registra los
 * pedidos web para que reserven stock. Devuelve 200 rapido: Woo desactiva un
 * webhook que falla cinco veces seguidas.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { products } from '@/db/schema';
import { auditar } from '@/lib/auditoria';
import { CABECERA_FIRMA, CABECERA_TOPICO, firmaValida } from '@/woo/webhook';
import { mapearProducto } from '@/woo/mapear';
import { cotizacionVigente } from '@/woo/cotizacion';
import { wooProducto } from '@/woo/tipos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secreto = process.env.WOO_WEBHOOK_SECRET;
  if (!secreto) {
    console.error('[webhook] Falta WOO_WEBHOOK_SECRET: se rechaza la entrega.');
    return NextResponse.json({ error: 'Webhook sin configurar' }, { status: 503 });
  }

  // El cuerpo crudo es lo que se firma. No usar request.json() antes de validar.
  const crudo = await request.text();
  const firma = request.headers.get(CABECERA_FIRMA);
  if (!firmaValida(crudo, firma, secreto)) {
    return NextResponse.json({ error: 'Firma invalida' }, { status: 401 });
  }

  const topico = request.headers.get(CABECERA_TOPICO) ?? 'desconocido';

  let payload: unknown;
  try {
    payload = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ error: 'Cuerpo ilegible' }, { status: 400 });
  }

  try {
    switch (topico) {
      case 'product.created':
      case 'product.updated':
        await refrescarProducto(payload);
        break;
      case 'product.deleted':
        await desactivarProducto(payload);
        break;
      case 'order.created':
      case 'order.updated':
        // Fase 3: los pedidos web reservan stock. Por ahora queda registrado.
        await auditar(db, {
          accion: `webhook.${topico}`,
          entidad: 'woo_order',
          entidadId: String((payload as { id?: number }).id ?? ''),
          valorNuevo: payload,
        });
        break;
      default:
        console.warn(`[webhook] Topico sin manejar: ${topico}`);
    }
  } catch (error) {
    console.error(`[webhook] Fallo procesando ${topico}:`, error);
    return NextResponse.json({ error: 'Error al procesar' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, topico });
}

async function refrescarProducto(payload: unknown) {
  const r = wooProducto.safeParse(payload);
  if (!r.success) {
    console.warn('[webhook] Ficha ilegible, se ignora:', r.error.issues[0]?.message);
    return;
  }
  const tc = await cotizacionVigente(db);
  const { fila } = mapearProducto(r.data, tc);

  await db
    .insert(products)
    .values({ ...fila, lastSyncedAt: new Date(), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: products.wooId,
      set: {
        sku: fila.sku,
        nombre: fila.nombre,
        marca: fila.marca,
        categoria: fila.categoria,
        precioCentavos: fila.precioCentavos,
        moneda: fila.moneda,
        precioUsdCentavos: fila.precioUsdCentavos,
        stock: fila.stock,
        gestionaStock: fila.gestionaStock,
        codigoBarras: fila.codigoBarras,
        imagenUrl: fila.imagenUrl,
        activo: fila.activo,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

async function desactivarProducto(payload: unknown) {
  const id = (payload as { id?: number }).id;
  if (typeof id !== 'number') return;
  // No se borra: se desactiva. Las ventas viejas siguen apuntando al producto.
  await db.update(products).set({ activo: false, updatedAt: new Date() }).where(eq(products.wooId, id));
}
