/**
 * Sumar unidades al stock de un producto que ya existe.
 *
 * Es la otra mitad del aviso de duplicados: encontrar que el producto ya está
 * sirve de poco si el camino para usarlo es más largo que cargarlo de nuevo.
 * Llegó mercadería de algo que ya está en el catálogo, y lo que hace falta es
 * sumar lo que llegó, no crear una ficha gemela.
 *
 * **Por qué se empuja a WooCommerce y no alcanza con escribir la base.** El
 * espejo del catálogo se refresca desde la tienda, y la sincronización pisa el
 * stock con el de Woo (`stock: excluded.stock`). Si el POS suma diez unidades y
 * nadie se lo cuenta a la tienda, el próximo `woo:sync` las borra y el mostrador
 * vuelve a vender lo que no tiene. Así que esto deja la operación en la misma
 * cola que usan las ventas, y el valor que viaja es el ABSOLUTO que el POS tiene
 * ahora: es idempotente y se cura solo, igual que el ajuste de una venta.
 *
 * La operación es propia y no la de la venta: esa termina marcando
 * `sales.synced_to_woo`, y acá no hay ninguna venta que marcar.
 */
import { eq, sql } from 'drizzle-orm';
import { auditLog, products, stockMovements, syncQueue } from '@/db/schema';
import { filas, type BaseDatos } from '@/db/tipos';

export class ErrorStock extends Error {
  constructor(
    message: string,
    readonly motivo: 'no_existe' | 'sin_control' | 'cantidad_invalida' | 'techo',
  ) {
    super(message);
    this.name = 'ErrorStock';
  }
}

/**
 * Cuánto se puede sumar de una vez.
 *
 * No es una regla de negocio sino una red contra el dedo: el mismo techo que el
 * alta. Una entrega de más de mil unidades existe, y entra en dos veces o por
 * planilla; un «100» que salió «1000» con el cliente esperando, no se nota.
 */
export const TECHO_POR_INGRESO = 1_000;

export interface IngresoDeStock {
  productId: string;
  cantidad: number;
  usuarioId: string;
  /** Por qué entró. Queda en el movimiento y en la bitácora. */
  motivo?: string | null;
}

export interface StockSumado {
  productId: string;
  nombre: string;
  cantidad: number;
  stockAnterior: number;
  stockResultante: number;
}

export async function sumarStock(db: BaseDatos, datos: IngresoDeStock): Promise<StockSumado> {
  if (!Number.isInteger(datos.cantidad) || datos.cantidad <= 0) {
    throw new ErrorStock('Las unidades que entran tienen que ser un número entero.', 'cantidad_invalida');
  }
  if (datos.cantidad > TECHO_POR_INGRESO) {
    throw new ErrorStock(
      `${datos.cantidad} unidades de una vez es mucho más de lo que entra en una entrega. ` +
        `Si de verdad llegaron, cargalas en dos veces o por planilla.`,
      'techo',
    );
  }

  return db.transaction(async (tx) => {
    /*
     * `FOR UPDATE` porque dos personas pueden estar cargando la misma entrega
     * en dos pantallas. Sin el candado, las dos leen el mismo stock y la
     * segunda escritura se come la primera: entran veinte unidades y el sistema
     * anota diez.
     */
    const [p] = filas<{
      id: string;
      nombre: string;
      stock: string | number;
      gestiona_stock: boolean;
      woo_id: number | null;
      activo: boolean;
    }>(
      await tx.execute(sql`
        SELECT id, nombre, stock, gestiona_stock, woo_id, activo
          FROM products
         WHERE id = ${datos.productId}
           FOR UPDATE
      `),
    );

    if (!p) throw new ErrorStock('Ese producto ya no está en el catálogo.', 'no_existe');

    if (!p.gestiona_stock) {
      throw new ErrorStock(
        `«${p.nombre}» no lleva control de stock, así que se puede vender sin límite: ` +
          `no hace falta sumarle unidades.`,
        'sin_control',
      );
    }

    const stockAnterior = Number(p.stock);
    const stockResultante = stockAnterior + datos.cantidad;

    await tx
      .update(products)
      .set({ stock: stockResultante, updatedAt: new Date() })
      .where(eq(products.id, datos.productId));

    await tx.insert(stockMovements).values({
      productId: datos.productId,
      tipo: 'ingreso',
      cantidad: datos.cantidad,
      stockResultante,
      motivo: datos.motivo ?? 'Entrada de mercadería desde el mostrador',
      usuarioId: datos.usuarioId,
    });

    /*
     * A la cola, para que la tienda se entere. Sin esto el próximo `woo:sync`
     * pisa el número con el de Woo y las unidades desaparecen.
     *
     * La clave de idempotencia lleva el id del movimiento —único por entrada—
     * así que dos sumas seguidas del mismo producto encolan dos operaciones y
     * ninguna se traga a la otra. Reintentar una, en cambio, escribe el mismo
     * valor absoluto: no suma dos veces.
     */
    if (p.woo_id !== null) {
      await tx.insert(syncQueue).values({
        operacion: 'stock.empujar',
        idempotencyKey: `stock:${datos.productId}:${stockResultante}:${Date.now()}`,
        payload: { productId: datos.productId, wooId: p.woo_id },
      });
    }

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'stock.sumar',
      entidad: 'products',
      entidadId: datos.productId,
      valorNuevo: {
        nombre: p.nombre,
        cantidad: datos.cantidad,
        stockAnterior,
        stockResultante,
        motivo: datos.motivo ?? null,
        // Un producto inactivo al que le entra mercadería es casi siempre uno
        // que hay que reactivar: queda anotado para que se vea.
        estabaInactivo: !p.activo,
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

/**
 * Volver a poner a la venta un producto que estaba inactivo.
 *
 * Aparece junto al aviso de duplicados: la ficha existe pero no se vende, y
 * reactivarla es lo correcto —crear otra deja dos stocks—. No toca el stock ni
 * el precio: solo lo vuelve visible.
 */
export async function reactivarProducto(
  db: BaseDatos,
  datos: { productId: string; usuarioId: string },
): Promise<{ nombre: string }> {
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select({ nombre: products.nombre, activo: products.activo })
      .from(products)
      .where(eq(products.id, datos.productId))
      .limit(1);

    if (!p) throw new ErrorStock('Ese producto ya no está en el catálogo.', 'no_existe');

    if (!p.activo) {
      await tx
        .update(products)
        .set({ activo: true, updatedAt: new Date() })
        .where(eq(products.id, datos.productId));

      await tx.insert(auditLog).values({
        usuarioId: datos.usuarioId,
        accion: 'producto.reactivar',
        entidad: 'products',
        entidadId: datos.productId,
        valorNuevo: { nombre: p.nombre },
      });
    }

    return { nombre: p.nombre };
  });
}
