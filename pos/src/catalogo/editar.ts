/**
 * Editar una ficha completa desde el buscador del catálogo.
 *
 * Hasta acá, arreglar una ficha mal cargada era un recorrido: el precio por un
 * botón, el stock por otro, el nombre por ningún lado y el costo solo al darla
 * de alta. Lo que el mostrador necesita cuando ve el error es abrir la ficha y
 * corregir lo que esté mal, ahí mismo.
 *
 * Tres cosas viven acá; el precio sigue en `cambiarPrecio`, que ya sabe de
 * dólares, cotización y del recargo de la tienda, y no tiene sentido tener dos.
 *
 * **El nombre solo se puede cambiar en lo que nació en el mostrador.** El
 * espejo de WooCommerce pisa `nombre` en cada sincronización
 * (`espejo.ts`), así que renombrar acá un producto que también vive en la
 * tienda duraría hasta el próximo `woo:sync` y volvería solo, sin que nadie
 * entienda por qué. El costo no corre ese riesgo —Woo no lo tiene— y el stock
 * tampoco, porque ahí manda el POS.
 */
import { eq, sql } from 'drizzle-orm';
import {
  auditLog,
  expenseItems,
  products,
  returnItems,
  salePayments,
  saleItems,
  stockMovements,
  syncConflicts,
  syncQueue,
} from '@/db/schema';
import { filas, type BaseDatos } from '@/db/tipos';
import { ErrorStock } from './stock';

/** Lo que entra en el nombre de una ficha. Más que esto es un copiado y pegado. */
export const LARGO_MAXIMO_NOMBRE = 200;

/**
 * Cuánto se puede sacar de una vez.
 *
 * El mismo techo que la entrada, y por el mismo motivo: no es una regla de
 * negocio sino una red contra el dedo.
 */
export const TECHO_POR_AJUSTE = 1_000;

export interface StockRestado {
  productId: string;
  nombre: string;
  cantidad: number;
  stockAnterior: number;
  stockResultante: number;
}

/**
 * Sacarle unidades al stock sin que haya una venta.
 *
 * Es el espejo de `sumarStock` y existe por lo mismo: una rotura, una unidad
 * que estaba contada de más, mercadería que se devolvió al proveedor. Queda
 * como `ajuste` y no como `venta` a propósito —no se vendió nada— así que el
 * reporte del día no lo cuenta como facturación.
 *
 * **No deja el stock en negativo.** El POS sí lo admite cuando se vendió sin
 * conexión algo que el sistema creía agotado: ahí el negativo es un hecho que
 * pasó. Un ajuste a mano no es un hecho, es un número que alguien escribe, y
 * un «saqué 50» sobre un stock de 3 es un dedo, no un inventario.
 */
export async function restarStock(
  db: BaseDatos,
  datos: { productId: string; cantidad: number; usuarioId: string; motivo?: string | null },
): Promise<StockRestado> {
  if (!Number.isInteger(datos.cantidad) || datos.cantidad <= 0) {
    throw new ErrorStock(
      'Las unidades que salen tienen que ser un número entero.',
      'cantidad_invalida',
    );
  }
  if (datos.cantidad > TECHO_POR_AJUSTE) {
    throw new ErrorStock(
      `${datos.cantidad} unidades de una vez es mucho más de lo que se ajusta a mano. ` +
        `Si de verdad salieron, hacelo en dos veces.`,
      'techo',
    );
  }

  return db.transaction(async (tx) => {
    const [p] = filas<{
      id: string;
      nombre: string;
      stock: number;
      gestiona_stock: boolean;
      woo_id: number | null;
    }>(
      await tx.execute(sql`
        SELECT id, nombre, stock, gestiona_stock, woo_id
          FROM products
         WHERE id = ${datos.productId}
           FOR UPDATE
      `),
    );

    if (!p) throw new ErrorStock('Ese producto ya no está en el catálogo.', 'no_existe');
    if (!p.gestiona_stock) {
      throw new ErrorStock(
        `«${p.nombre}» no lleva control de stock, así que no hay unidades que sacarle.`,
        'sin_control',
      );
    }

    const stockAnterior = Number(p.stock);
    if (datos.cantidad > stockAnterior) {
      throw new ErrorStock(
        `De «${p.nombre}» quedan ${stockAnterior} y se están sacando ${datos.cantidad}. ` +
          `Un ajuste a mano no puede dejar el stock en negativo: revisá el número.`,
        'cantidad_invalida',
      );
    }

    const stockResultante = stockAnterior - datos.cantidad;

    await tx
      .update(products)
      .set({ stock: stockResultante, updatedAt: new Date() })
      .where(eq(products.id, datos.productId));

    await tx.insert(stockMovements).values({
      productId: datos.productId,
      tipo: 'ajuste',
      cantidad: -datos.cantidad,
      stockResultante,
      motivo: datos.motivo ?? 'Ajuste a mano desde el mostrador',
      usuarioId: datos.usuarioId,
    });

    // Igual que al sumar: si la tienda no se entera, el próximo `woo:sync`
    // pisa el número y las unidades vuelven.
    if (p.woo_id !== null) {
      await tx.insert(syncQueue).values({
        operacion: 'stock.empujar',
        idempotencyKey: `stock:${datos.productId}:${stockResultante}:${Date.now()}`,
        payload: { productId: datos.productId, wooId: p.woo_id, delta: -datos.cantidad },
      });
    }

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'stock.restar',
      entidad: 'products',
      entidadId: datos.productId,
      valorAnterior: { stock: stockAnterior },
      valorNuevo: {
        nombre: p.nombre,
        cantidad: datos.cantidad,
        stockAnterior,
        stockResultante,
        motivo: datos.motivo ?? null,
      },
    });

    return {
      productId: datos.productId,
      nombre: p.nombre,
      cantidad: datos.cantidad,
      stockAnterior,
      stockResultante,
    };
  });
}

export interface FichaEditada {
  nombre: string;
  cambios: ('nombre' | 'costo')[];
}

/**
 * Cambiar el nombre y el costo de una ficha.
 *
 * El costo es el dato que más falta y el que menos se puede recuperar después:
 * sin él, la rentabilidad del mes miente sobre ese producto y nadie se entera.
 */
export async function editarFicha(
  db: BaseDatos,
  datos: {
    productId: string;
    /** Sin cambio si no viene. Vacío no es un nombre. */
    nombre?: string | null;
    /** Sin cambio si no viene; `null` lo borra: «no sé cuánto costó». */
    costoCentavos?: number | null;
    usuarioId: string;
  },
): Promise<FichaEditada> {
  const nombre = typeof datos.nombre === 'string' ? datos.nombre.trim() : null;

  if (nombre !== null) {
    if (nombre.length === 0) {
      throw new ErrorStock('El producto necesita un nombre.', 'cantidad_invalida');
    }
    if (nombre.length > LARGO_MAXIMO_NOMBRE) {
      throw new ErrorStock(
        `Ese nombre tiene ${nombre.length} caracteres y el máximo es ${LARGO_MAXIMO_NOMBRE}.`,
        'cantidad_invalida',
      );
    }
  }

  const tocaCosto = datos.costoCentavos !== undefined;
  const costo = datos.costoCentavos ?? null;
  if (tocaCosto && costo !== null) {
    if (!Number.isInteger(costo) || costo < 0) {
      throw new ErrorStock('El costo no puede ser negativo.', 'cantidad_invalida');
    }
  }

  return db.transaction(async (tx) => {
    const [p] = await tx
      .select({
        id: products.id,
        nombre: products.nombre,
        costoCentavos: products.costoCentavos,
        wooId: products.wooId,
      })
      .from(products)
      .where(eq(products.id, datos.productId))
      .limit(1);

    if (!p) throw new ErrorStock('Ese producto ya no está en el catálogo.', 'no_existe');

    const cambiaNombre = nombre !== null && nombre !== p.nombre;

    /*
     * Renombrar lo que vive en la tienda no se puede, y es mejor decirlo que
     * dejarlo pasar: el espejo trae el nombre de Woo en cada sincronización, y
     * el cambio volvería solo dentro de un rato sin que nadie entienda por qué.
     */
    if (cambiaNombre && p.wooId !== null) {
      throw new ErrorStock(
        `«${p.nombre}» también está en la tienda online, y de ahí viene su nombre: ` +
          `si se cambia acá, la próxima sincronización lo vuelve atrás. Cambialo en la tienda.`,
        'sin_control',
      );
    }

    const cambiaCosto = tocaCosto && costo !== p.costoCentavos;
    const cambios: FichaEditada['cambios'] = [];
    if (cambiaNombre) cambios.push('nombre');
    if (cambiaCosto) cambios.push('costo');

    if (cambios.length === 0) return { nombre: p.nombre, cambios };

    await tx
      .update(products)
      .set({
        ...(cambiaNombre ? { nombre: nombre! } : {}),
        ...(cambiaCosto ? { costoCentavos: costo } : {}),
        updatedAt: new Date(),
      })
      .where(eq(products.id, datos.productId));

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'producto.editar',
      entidad: 'products',
      entidadId: datos.productId,
      valorAnterior: { nombre: p.nombre, costoCentavos: p.costoCentavos },
      valorNuevo: {
        nombre: cambiaNombre ? nombre : p.nombre,
        costoCentavos: cambiaCosto ? costo : p.costoCentavos,
      },
    });

    return { nombre: cambiaNombre ? nombre! : p.nombre, cambios };
  });
}

/**
 * Por qué una ficha no se puede borrar del todo.
 *
 * Vacío quiere decir que sí se puede. La pantalla lo pregunta antes de ofrecer
 * el botón: un «Eliminar» que siempre falla es peor que no tenerlo.
 */
export async function motivosParaNoEliminar(
  db: BaseDatos,
  productId: string,
): Promise<string[]> {
  const [p] = await db
    .select({ id: products.id, wooId: products.wooId })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  if (!p) return ['Ese producto ya no está en el catálogo.'];

  const motivos: string[] = [];

  if (p.wooId !== null) {
    motivos.push(
      'Está publicado en la tienda online. Sacalo del catálogo: borrarlo acá lo dejaría ' +
        'colgado en la web.',
    );
  }

  const [vendido] = await db
    .select({ id: saleItems.id })
    .from(saleItems)
    .where(eq(saleItems.productId, productId))
    .limit(1);
  if (vendido) motivos.push('Ya se vendió alguna vez: borrarlo rompería esas ventas.');

  const [devuelto] = await db
    .select({ id: returnItems.id })
    .from(returnItems)
    .where(eq(returnItems.productId, productId))
    .limit(1);
  if (devuelto) motivos.push('Tiene devoluciones registradas.');

  const [gastado] = await db
    .select({ id: expenseItems.id })
    .from(expenseItems)
    .where(eq(expenseItems.productId, productId))
    .limit(1);
  if (gastado) motivos.push('Está en algún gasto cargado.');

  const [canjeado] = await db
    .select({ id: salePayments.id })
    .from(salePayments)
    .where(eq(salePayments.productoRecibidoId, productId))
    .limit(1);
  if (canjeado) motivos.push('Entró como parte de pago en un canje.');

  /*
   * El libro de stock es de solo agregado: la base no deja borrar sus asientos
   * (migración 0001). Una ficha con movimientos ya dejó rastro en el depósito,
   * y ese rastro vale. Para esa, la baja.
   */
  const [movido] = await db
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(eq(stockMovements.productId, productId))
    .limit(1);
  if (movido) {
    motivos.push('Ya tiene movimientos de stock, y el libro de stock no se borra.');
  }

  return motivos;
}

/**
 * Borrar una ficha del todo.
 *
 * Es lo contrario de la baja, y las dos hacen falta. La baja es para el
 * producto que existió y ya no se vende: su historial vale y hay que
 * conservarlo. Esto es para el que **nunca debió existir**: la ficha repetida
 * de la importación, el alta con el nombre a medio escribir, la prueba que
 * quedó. Darlas de baja las deja para siempre ensuciando cada búsqueda.
 *
 * Por eso solo se puede cuando no hay NADA colgando: ni una venta, ni una
 * devolución, ni un gasto, ni un canje, ni la tienda online, ni un movimiento
 * de stock. Lo último no es una elección de este código: el libro de stock es
 * de solo agregado y la base lo impone con un disparador (migración 0001,
 * «nada se borra jamás»). Una ficha a la que ya le entró o le salió
 * mercadería dejó rastro en el depósito, y ese rastro vale: para esa, la baja.
 *
 * Lo único que se va con la ficha son sus conflictos de sincronización —no son
 * historia de nadie— y sus variantes, que la base borra en cascada.
 */
export async function eliminarProducto(
  db: BaseDatos,
  datos: { productId: string; usuarioId: string },
): Promise<{ nombre: string }> {
  return db.transaction(async (tx) => {
    const [p] = filas<{ id: string; nombre: string }>(
      await tx.execute(sql`
        SELECT id, nombre FROM products WHERE id = ${datos.productId} FOR UPDATE
      `),
    );
    if (!p) throw new ErrorStock('Ese producto ya no está en el catálogo.', 'no_existe');

    /*
     * Se vuelve a preguntar adentro de la transacción y con la fila tomada: lo
     * que la pantalla miró hace diez segundos pudo cambiar, y entre esas diez
     * segundos entra una venta.
     */
    const motivos = await motivosParaNoEliminar(tx, datos.productId);
    if (motivos.length > 0) {
      throw new ErrorStock(
        `«${p.nombre}» no se puede borrar. ${motivos.join(' ')}`,
        'sin_control',
      );
    }

    // La bitácora primero: después de borrar la fila ya no hay de dónde leer
    // qué era, y es justo lo que hay que poder contestar mañana.
    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'producto.eliminar',
      entidad: 'products',
      entidadId: datos.productId,
      valorAnterior: { nombre: p.nombre },
      valorNuevo: null,
    });

    await tx.delete(syncConflicts).where(eq(syncConflicts.productId, datos.productId));
    await tx.delete(products).where(eq(products.id, datos.productId));

    return { nombre: String(p.nombre) };
  });
}
