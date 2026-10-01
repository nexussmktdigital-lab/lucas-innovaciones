/**
 * Cambiar el precio de un producto desde el mostrador.
 *
 * Es el caso que Fede describió el primer día: llegó mercadería con aumento y
 * la ficha quedó vieja. Hasta acá la salida era escribir el precio en la venta
 * —que arregla esa venta y ninguna de las siguientes— o abrir WordPress con el
 * cliente enfrente, que es lo que este sistema vino a sacar.
 *
 * **Qué número se escribe y cuál se guarda.** El mostrador piensa en lo que le
 * cobra al cliente, así que eso es lo que se escribe. Pero el número que vive en
 * la ficha es el de la tienda —la web cobra la comisión de Mercado Pago, que el
 * local no paga—, así que se guarda el de tienda y se calcula con
 * `precioDeTienda`, la inversa exacta del cálculo que la venta ya usa. Un
 * producto que no se publica (servicios, «Solo mostrador») no lleva recargo: su
 * precio de ficha ya es el de mostrador y se guarda tal cual.
 *
 * **Y se empuja a WooCommerce**, por la misma razón que el stock: si el precio
 * nuevo no llega a la tienda, la web sigue cobrando el viejo —plata que se
 * pierde en cada pedido— y la próxima sincronización devuelve la ficha al
 * precio anterior, porque el espejo copia lo que dice Woo.
 *
 * Esto corre el límite que el README declaraba: «WooCommerce sigue siendo el
 * único lugar donde se carga un precio». Sigue siendo el único lugar donde se
 * carga el catálogo; el precio ahora también se puede corregir desde el
 * mostrador, que es donde se descubre que está mal.
 */
import { eq, sql } from 'drizzle-orm';
import { auditLog, products, syncQueue } from '@/db/schema';
import { filas, type BaseDatos } from '@/db/tipos';
import { precioDeTienda } from '@/precios/mostrador';

export class ErrorPrecioFicha extends Error {
  constructor(
    message: string,
    readonly motivo: 'no_existe' | 'invalido' | 'techo',
  ) {
    super(message);
    this.name = 'ErrorPrecioFicha';
  }
}

/** El mismo techo que el alta: una red contra el cero de más. */
export const TECHO_PRECIO_CENTAVOS = 50_000_000_00;

export interface CambioDePrecio {
  productId: string;
  /** Lo que se le va a cobrar al cliente en el local, en centavos. */
  mostradorCentavos: number;
  recargoTiendaBp: number;
  usuarioId: string;
}

export interface PrecioCambiado {
  nombre: string;
  mostradorCentavos: number;
  tiendaCentavos: number;
  anteriorMostradorCentavos: number;
}

export async function cambiarPrecio(
  db: BaseDatos,
  datos: CambioDePrecio,
): Promise<PrecioCambiado> {
  if (!Number.isInteger(datos.mostradorCentavos) || datos.mostradorCentavos <= 0) {
    throw new ErrorPrecioFicha('Poné el precio que le vas a cobrar al cliente.', 'invalido');
  }
  if (datos.mostradorCentavos > TECHO_PRECIO_CENTAVOS) {
    throw new ErrorPrecioFicha(
      'Ese precio es demasiado alto: revisá que no haya un cero de más.',
      'techo',
    );
  }

  return db.transaction(async (tx) => {
    const [p] = filas<{
      id: string;
      nombre: string;
      precio_centavos: string | number;
      precio_local_centavos: string | number | null;
      solo_mostrador: boolean;
      woo_id: number | null;
    }>(
      await tx.execute(sql`
        SELECT id, nombre, precio_centavos, precio_local_centavos, solo_mostrador, woo_id
          FROM products
         WHERE id = ${datos.productId}
           FOR UPDATE
      `),
    );

    if (!p) throw new ErrorPrecioFicha('Ese producto ya no está en el catálogo.', 'no_existe');

    const soloMostrador = Boolean(p.solo_mostrador);
    const tiendaCentavos = soloMostrador
      ? datos.mostradorCentavos
      : precioDeTienda(datos.mostradorCentavos, datos.recargoTiendaBp);

    const anteriorTienda = Number(p.precio_centavos);
    const anteriorLocal =
      p.precio_local_centavos === null ? null : Number(p.precio_local_centavos);

    /*
     * Se limpia el precio de mostrador propio, si lo tenía.
     *
     * Ese campo pisa el cálculo, así que dejarlo puesto haría que el precio
     * recién escrito no se cobre: el cajero cambia el número, ve que la venta
     * sigue saliendo el viejo y no entiende por qué. Si hacía falta una excepción
     * de mostrador, se vuelve a poner desde Precios a sabiendas.
     */
    await tx
      .update(products)
      .set({
        precioCentavos: tiendaCentavos,
        precioLocalCentavos: null,
        updatedAt: new Date(),
      })
      .where(eq(products.id, datos.productId));

    // A la tienda, o la web sigue cobrando el viejo y la próxima
    // sincronización devuelve la ficha al precio anterior.
    if (p.woo_id !== null) {
      await tx.insert(syncQueue).values({
        operacion: 'precio.empujar',
        idempotencyKey: `precio:${datos.productId}:${tiendaCentavos}:${Date.now()}`,
        payload: { productId: datos.productId, wooId: p.woo_id },
      });
    }

    await tx.insert(auditLog).values({
      usuarioId: datos.usuarioId,
      accion: 'precio.cambiar',
      entidad: 'products',
      entidadId: datos.productId,
      valorAnterior: {
        precioCentavos: anteriorTienda,
        precioLocalCentavos: anteriorLocal,
      },
      valorNuevo: {
        nombre: p.nombre,
        precioCentavos: tiendaCentavos,
        mostradorCentavos: datos.mostradorCentavos,
        recargoTiendaBp: soloMostrador ? 0 : datos.recargoTiendaBp,
      },
    });

    return {
      nombre: p.nombre,
      mostradorCentavos: datos.mostradorCentavos,
      tiendaCentavos,
      anteriorMostradorCentavos:
        anteriorLocal ??
        (soloMostrador || datos.recargoTiendaBp <= 0
          ? anteriorTienda
          : Math.round((anteriorTienda * 10_000) / (10_000 + datos.recargoTiendaBp))),
    };
  });
}
