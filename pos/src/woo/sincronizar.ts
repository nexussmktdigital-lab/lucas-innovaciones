/**
 * Sincronizacion del catalogo desde WooCommerce hacia el espejo local.
 *
 * El espejo existe para que el buscador de la pantalla de venta responda en
 * menos de 100 ms. NO decide stock: al confirmar una venta, el que autoriza es
 * WooCommerce (D4). El espejo se refresca por esta sincronizacion y por los
 * webhooks.
 *
 * La sincronizacion nunca pisa los campos que son solo del POS: el costo
 * cargado desde una compra a proveedor y el stock comprometido por pedidos web.
 */
import { sql } from 'drizzle-orm';
import { productVariants, products } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import type { ClienteWoo } from './cliente';
import { mapearProducto, mapearVariante, type Aviso } from './mapear';
import { wooProducto, wooVariacion } from './tipos';

export interface InformeSincronizacion {
  leidos: number;
  creados: number;
  actualizados: number;
  variantes: number;
  avisos: Aviso[];
  /** Resumen por tipo de aviso, para mostrarlo de un vistazo. */
  resumen: Record<string, number>;
  duracionMs: number;
}

export interface OpcionesSincronizacion {
  tcCentavos?: number | null;
  /** Cuantos productos se piden por pagina. Woo con 30 s de limite aguanta 100. */
  porPagina?: number;
  /** Callback de progreso, para el script de consola. */
  alAvanzar?: (leidos: number) => void;
}

export async function sincronizarCatalogo(
  db: BaseDatos,
  cliente: ClienteWoo,
  opciones: OpcionesSincronizacion = {},
): Promise<InformeSincronizacion> {
  const inicio = Date.now();
  const tc = opciones.tcCentavos ?? null;
  const avisos: Aviso[] = [];
  let leidos = 0;
  let creados = 0;
  let actualizados = 0;
  let variantes = 0;

  for await (const lote of cliente.listarTodo(
    'products',
    wooProducto,
    { status: 'any', orderby: 'id', order: 'asc' },
    opciones.porPagina ?? 100,
  )) {
    if (lote.length === 0) continue;

    const filas = lote.map((p) => mapearProducto(p, tc));
    for (const { avisos: a } of filas) avisos.push(...a);

    const resultado = await db
      .insert(products)
      .values(
        filas.map(({ fila }) => ({
          ...fila,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: products.wooId,
        set: {
          sku: sql`excluded.sku`,
          nombre: sql`excluded.nombre`,
          marca: sql`excluded.marca`,
          categoria: sql`excluded.categoria`,
          tipo: sql`excluded.tipo`,
          precioCentavos: sql`excluded.precio_centavos`,
          moneda: sql`excluded.moneda`,
          precioUsdCentavos: sql`excluded.precio_usd_centavos`,
          stock: sql`excluded.stock`,
          gestionaStock: sql`excluded.gestiona_stock`,
          codigoBarras: sql`excluded.codigo_barras`,
          imagenUrl: sql`excluded.imagen_url`,
          activo: sql`excluded.activo`,
          esServicio: sql`excluded.es_servicio`,
          soloMostrador: sql`excluded.solo_mostrador`,
          // Una ficha que alguien dio por terminada se queda terminada. Antes
          // esto la reabria en la siguiente sincronizacion: el duenio apretaba
          // «la ficha ya esta» y a los diez minutos el producto volvia a la
          // lista, porque el mapeo la vuelve a marcar por no tener foto. La
          // marca solo se puede quitar, nunca volver a poner desde Woo.
          fichaIncompleta: sql`products.ficha_incompleta AND excluded.ficha_incompleta`,
          lastSyncedAt: sql`excluded.last_synced_at`,
          updatedAt: sql`excluded.updated_at`,
          // costoCentavos, precioEditable, precioLocalCentavos y stockComprometido
          // son del POS: no se pisan.
        },
      })
      .returning({
        id: products.id,
        wooId: products.wooId,
        // `xmax = 0` es el modo de PostgreSQL de decir "esta fila la inserte
        // ahora", frente a "la actualice por el ON CONFLICT".
        creado: sql<boolean>`(xmax = 0)`,
      });

    leidos += lote.length;
    for (const fila of resultado) {
      if (fila.creado) creados += 1;
      else actualizados += 1;
    }

    // Variaciones de los productos variables (vidrios, hidrogeles y fundas, D20).
    for (let i = 0; i < filas.length; i += 1) {
      if (filas[i]!.fila.tipo !== 'variable') continue;
      const productId = resultado.find((r) => r.wooId === filas[i]!.fila.wooId)?.id;
      if (!productId) continue;
      variantes += await sincronizarVariantes(db, cliente, filas[i]!.fila.wooId, productId);
    }

    opciones.alAvanzar?.(leidos);
  }

  const resumen: Record<string, number> = {};
  for (const a of avisos) resumen[a.tipo] = (resumen[a.tipo] ?? 0) + 1;

  return { leidos, creados, actualizados, variantes, avisos, resumen, duracionMs: Date.now() - inicio };
}

async function sincronizarVariantes(
  db: BaseDatos,
  cliente: ClienteWoo,
  wooProductId: number,
  productId: string,
): Promise<number> {
  let total = 0;
  for await (const lote of cliente.listarTodo(
    `products/${wooProductId}/variations`,
    wooVariacion,
    {},
    100,
  )) {
    if (lote.length === 0) continue;
    await db
      .insert(productVariants)
      .values(
        lote.map((v) => ({ ...mapearVariante(v), productId, lastSyncedAt: new Date() })),
      )
      .onConflictDoUpdate({
        target: productVariants.wooId,
        set: {
          sku: sql`excluded.sku`,
          nombre: sql`excluded.nombre`,
          atributos: sql`excluded.atributos`,
          precioCentavos: sql`excluded.precio_centavos`,
          stock: sql`excluded.stock`,
          codigoBarras: sql`excluded.codigo_barras`,
          activo: sql`excluded.activo`,
          lastSyncedAt: sql`excluded.last_synced_at`,
        },
      });
    total += lote.length;
  }
  return total;
}
