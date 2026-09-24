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
import { filas as filasDe, type BaseDatos } from '@/db/tipos';
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
  /**
   * True si se cortó por tiempo y quedaron páginas sin traer.
   *
   * Lo mira el refresco programado: con esto en true **no** se puede avanzar la
   * marca de agua, porque lo que faltó no se volvería a pedir nunca.
   */
  incompleto: boolean;
  /** Productos dados de baja por no estar más en la tienda. */
  desactivados: number;
  /** Variaciones dadas de baja porque su producto dejó de ser variable. */
  variantesDesactivadas: number;
  /**
   * Por qué no se dieron de baja los ausentes, si correspondía hacerlo.
   *
   * Que no haya ausentes no llena esto: es para cuando había y se decidió no
   * tocarlos. Quedarse callado ahí sería lo peor de los dos mundos.
   */
  bajasOmitidas?: string;
}

export interface OpcionesSincronizacion {
  tcCentavos?: number | null;
  /** Cuantos productos se piden por pagina. Woo con 30 s de limite aguanta 100. */
  porPagina?: number;
  /** Callback de progreso, para el script de consola. */
  alAvanzar?: (leidos: number) => void;
  /**
   * Traer solo lo modificado a partir de este instante, en vez del catálogo
   * entero. Es lo que permite refrescar cada diez minutos sin pedir los 803
   * productos cada vez.
   */
  modificadoDesde?: Date | null;
  /**
   * Cuánto tiempo como máximo. Al pasarse corta **entre páginas** —nunca a la
   * mitad de una— y devuelve `incompleto: true`. Sin esto, una corrida contra
   * un WooCommerce lento se come el límite de la función y muere a la mitad.
   */
  limiteMs?: number;
  /**
   * Dar de baja lo que ya no está en la tienda.
   *
   * Solo vale en una corrida **completa**: es la única que ve el catálogo
   * entero y por lo tanto puede concluir que algo falta. Con `modificadoDesde`
   * puesto, la ausencia no significa nada —el producto simplemente no cambió—
   * así que el refresco programado nunca pide esto.
   */
  desactivarAusentes?: boolean;
}

/**
 * Techo de bajas automáticas, como proporción del espejo.
 *
 * Una tienda no pierde la mitad del catálogo de un día para el otro: si el
 * cálculo da eso, lo que falla es la corrida —una clave con permisos recortados,
 * un filtro que se coló, la tienda a medio restaurar— y no el catálogo. Ante la
 * duda no se desactiva nada y se avisa, porque un producto dado de baja por
 * error es una venta que el mostrador no puede hacer.
 */
export const TECHO_BAJAS = 0.2;

export async function sincronizarCatalogo(
  db: BaseDatos,
  cliente: ClienteWoo,
  opciones: OpcionesSincronizacion = {},
): Promise<InformeSincronizacion> {
  const inicio = Date.now();
  // El corte para saber qué no vino: todo lo que la tienda devuelva se va a
  // marcar con una fecha posterior a esta.
  const desde = new Date(inicio);
  const tc = opciones.tcCentavos ?? null;
  const avisos: Aviso[] = [];
  let leidos = 0;
  let creados = 0;
  let actualizados = 0;
  let variantes = 0;
  let incompleto = false;

  /*
   * `dates_are_gmt` va junto con `modified_after` a propósito.
   *
   * Sin eso WooCommerce interpreta la fecha en el huso del sitio —acá UTC-3— y
   * el POS la manda en UTC: tres horas de corrimiento, y en la dirección que
   * deja productos afuera. El refresco programado le suma además un margen
   * holgado, por si el sitio ignora la bandera.
   */
  const filtro: Record<string, string | number> = {
    status: 'any',
    orderby: 'id',
    order: 'asc',
  };
  if (opciones.modificadoDesde) {
    filtro.modified_after = opciones.modificadoDesde.toISOString().slice(0, 19);
    filtro.dates_are_gmt = 1;
  }

  for await (const lote of cliente.listarTodo(
    'products',
    wooProducto,
    filtro,
    opciones.porPagina ?? 100,
  )) {
    if (lote.length === 0) continue;

    // El corte va antes de escribir, no después: así una página queda entera o
    // no queda, y la marca de agua no puede avanzar sobre algo a medio guardar.
    if (opciones.limiteMs !== undefined && Date.now() - inicio > opciones.limiteMs) {
      incompleto = true;
      break;
    }

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

  const baja =
    opciones.desactivarAusentes && !incompleto && !opciones.modificadoDesde && leidos > 0
      ? await desactivarAusentes(db, desde)
      : { desactivados: 0 };

  const variantesDesactivadas = leidos > 0 ? await desactivarVariacionesHuerfanas(db, desde) : 0;

  return {
    leidos,
    creados,
    actualizados,
    variantes,
    avisos,
    resumen,
    duracionMs: Date.now() - inicio,
    incompleto,
    variantesDesactivadas,
    ...baja,
  };
}

/**
 * Da de baja las variaciones de un producto que dejó de ser variable.
 *
 * En WooCommerce, pasar una ficha de «variable» a «simple» no borra sus
 * variaciones: quedan colgando, invisibles desde la tienda. El espejo, en
 * cambio, las seguía mostrando en la pantalla de venta —`buscar.ts` las une por
 * `v.activo` y no pregunta por el tipo del padre— y además ya no las
 * refrescaba, porque solo se piden las variaciones de los productos variables.
 *
 * Resultado: se vendían al precio del día en que el producto se aplanó. Pasó en
 * el catálogo real con quince fichas —vidrios, hidrogeles y fundas— y sus
 * seiscientas variaciones, congeladas doce días.
 *
 * Esto no se apoya en una ausencia sino en lo que la tienda dijo de cada ficha
 * que devolvió, así que vale igual en una corrida completa que en el refresco
 * incremental, y no necesita el techo de las bajas por ausencia.
 */
async function desactivarVariacionesHuerfanas(db: BaseDatos, desde: Date): Promise<number> {
  const filas = filasDe<{ id: string }>(
    await db.execute(sql`
      UPDATE product_variants v SET activo = false
      FROM products p
      WHERE v.product_id = p.id
        AND v.activo
        AND p.tipo <> 'variable'
        AND p.last_synced_at >= ${desde.toISOString()}
      RETURNING v.id
    `),
  );
  return filas.length;
}

/**
 * Da de baja lo que la tienda ya no tiene.
 *
 * Un producto que se borra definitivamente en WooCommerce no aparece en ninguna
 * listada, ni siquiera con `status=any`: sencillamente deja de existir. En el
 * espejo, en cambio, se queda como estaba —activo, con su precio y su stock del
 * día que se borró— y el mostrador lo puede seguir vendiendo. Apareció en el
 * catálogo real: catorce fichas borradas de la tienda seguían a la venta en el
 * POS, con sus seiscientas variaciones congeladas doce días atrás.
 *
 * Se reconoce por la fecha: una corrida completa toca `last_synced_at` de todo
 * lo que la tienda devolvió, así que lo que quedó con la fecha vieja es lo que
 * no vino. Un producto nacido en el POS y todavía sin sincronizar tiene esa
 * fecha en `NULL`, y `NULL < fecha` no es verdadero, así que queda afuera solo.
 *
 * Se **desactiva**, nunca se borra: las ventas viejas lo siguen referenciando.
 */
async function desactivarAusentes(
  db: BaseDatos,
  desde: Date,
): Promise<{ desactivados: number; bajasOmitidas?: string }> {
  const [conteo] = filasDe<{ ausentes: number; vivos: number }>(
    await db.execute(sql`
      SELECT
        count(*) FILTER (
          WHERE woo_id IS NOT NULL AND activo AND last_synced_at < ${desde.toISOString()}
        ) AS ausentes,
        count(*) FILTER (WHERE woo_id IS NOT NULL AND activo) AS vivos
      FROM products
    `),
  );

  const ausentes = Number(conteo?.ausentes ?? 0);
  const vivos = Number(conteo?.vivos ?? 0);
  if (ausentes === 0) return { desactivados: 0 };

  if (ausentes > vivos * TECHO_BAJAS) {
    return {
      desactivados: 0,
      bajasOmitidas:
        `${ausentes} de ${vivos} productos no vinieron en esta corrida. Es demasiado ` +
        `para ser real, así que no se dio de baja ninguno: revisá que la clave de la ` +
        `API tenga permiso de lectura sobre todo el catálogo y volvé a correrlo.`,
    };
  }

  // Primero las variaciones, mientras todavía se puede saber de qué padres son.
  await db.execute(sql`
    UPDATE product_variants v SET activo = false
    FROM products p
    WHERE v.product_id = p.id
      AND v.activo
      AND p.woo_id IS NOT NULL
      AND p.activo
      AND p.last_synced_at < ${desde.toISOString()}
  `);

  await db.execute(sql`
    UPDATE products SET activo = false, updated_at = now()
    WHERE woo_id IS NOT NULL AND activo AND last_synced_at < ${desde.toISOString()}
  `);

  return { desactivados: ausentes };
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
