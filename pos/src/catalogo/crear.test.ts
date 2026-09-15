/**
 * Tests del alta de productos contra la base real.
 *
 * Lo que importa no es que la fila entre: es que el producto quede vendible en
 * el acto, que no se dupliquen fichas, y que nazca de mostrador y no en la web.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { auditLog, products, syncQueue, users } from '@/db/schema';
import {
  categoriasDelCatalogo,
  crearProducto,
  darFichaPorCompleta,
  ErrorCrear,
  fichasPendientes,
  marcasDelCatalogo,
  TECHO_STOCK_ALTA,
} from './crear';
import { encolarPublicacion, ErrorPublicar } from './publicar';
import { buscarProductos } from '@/ventas/buscar';

let db: TestDb;
let duenio: string;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);
  const [u] = await db.insert(users).values({ nombre: 'Lucas', rol: 'owner' }).returning();
  duenio = u!.id;
});

function alta(parcial: Partial<Parameters<typeof crearProducto>[1]> = {}) {
  return crearProducto(db, {
    nombre: 'Cable USB tipo C 1 metro',
    categoria: 'Cables de carga',
    marca: 'FoxBox',
    precioCentavos: 9_000_00,
    stock: 12,
    usuarioId: duenio,
    ...parcial,
  });
}

describe('dar de alta un producto', () => {
  it('queda cargado, con SKU propio y ficha por completar', async () => {
    const r = await alta();

    expect(r.sku).toBe('CAB-FOXB-CABLEUSBTI');
    expect(r.esServicio).toBe(false);

    const [p] = await db.select().from(products).where(eq(products.id, r.id));
    expect(p!.nombre).toBe('Cable USB tipo C 1 metro');
    expect(p!.precioCentavos).toBe(9_000_00);
    expect(p!.stock).toBe(12);
    expect(p!.gestionaStock).toBe(true);
    expect(p!.fichaIncompleta).toBe(true);
  });

  /*
   * La razón de ser de la fase: el que está atendiendo lo carga y lo vende en
   * la misma visita. Si no aparece en el buscador, no sirvió de nada.
   */
  it('se puede vender en el acto: el buscador ya lo encuentra', async () => {
    await alta();

    const porNombre = await buscarProductos(db, 'cable usb');
    expect(porNombre.map((x) => x.nombre)).toContain('Cable USB tipo C 1 metro');

    const porSku = await buscarProductos(db, 'CAB-FOXB-CABLEUSBTI');
    expect(porSku[0]!.exacto).toBe(true);
  });

  /*
   * Nace de mostrador. Publicarlo en la web es otro acto, y hay una razón
   * concreta: la sincronización traduce el `status` de Woo a `activo`, así que
   * un borrador volvería como producto inactivo y desaparecería del mostrador.
   */
  it('nace fuera de la tienda online y sin encolar nada', async () => {
    const r = await alta();

    const [p] = await db.select().from(products).where(eq(products.id, r.id));
    expect(p!.wooId).toBeNull();
    expect(p!.soloMostrador).toBe(true);

    expect(await db.select().from(syncQueue)).toHaveLength(0);
  });

  it('el precio que se escribe es el que cobra el mostrador', async () => {
    const r = await alta({ precioCentavos: 9_000_00 });
    const [p] = await db.select().from(products).where(eq(products.id, r.id));

    // Guardado aparte, que es la columna que la sincronización no pisa.
    expect(p!.precioLocalCentavos).toBe(9_000_00);

    const [enVenta] = await buscarProductos(db, 'CAB-FOXB-CABLEUSBTI');
    expect(enVenta!.precioCentavos).toBe(9_000_00);
  });

  /*
   * El costo es lo único que hace posible el reporte de ganancia: se copia a
   * cada línea de venta al confirmarla y queda congelado ahí. Antes no había
   * ninguna forma de cargarlo y el reporte era un panel siempre vacío.
   */
  it('el costo queda guardado y no sale a la tienda', async () => {
    const r = await alta({ costoCentavos: 6_000_00 });

    const [p] = await db.select().from(products).where(eq(products.id, r.id));
    expect(p!.costoCentavos).toBe(6_000_00);
    expect(p!.precioCentavos).toBe(9_000_00);
  });

  it('sin costo cargado el producto entra igual', async () => {
    const r = await alta();
    const [p] = await db.select().from(products).where(eq(products.id, r.id));
    expect(p!.costoCentavos).toBeNull();
  });

  it('queda en la bitácora', async () => {
    const r = await alta();
    const [linea] = await db.select().from(auditLog).where(eq(auditLog.entidadId, r.id));
    expect(linea!.accion).toBe('producto.alta');
  });
});

describe('servicios', () => {
  it('una categoría de servicio no lleva stock y deja escribir el precio', async () => {
    const r = await alta({
      nombre: 'Cambio de pantalla',
      categoria: 'Servicio técnico',
      marca: null,
      stock: 5,
    });

    expect(r.esServicio).toBe(true);

    const [p] = await db.select().from(products).where(eq(products.id, r.id));
    expect(p!.stock).toBe(0);
    expect(p!.gestionaStock).toBe(false);
    expect(p!.precioEditable).toBe(true);
    expect(p!.sku).toBe('SERV-GEN-CAMBIODEPA');
  });

  it('un servicio a presupuestar puede entrar en cero', async () => {
    const r = await alta({
      nombre: 'Reparación a presupuestar',
      categoria: 'Servicio técnico',
      precioCentavos: 0,
    });
    expect(r.precioCentavos).toBe(0);
  });
});

describe('lo que no deja pasar', () => {
  it('dos veces el mismo nombre: casi siempre es que no lo encontró', async () => {
    await alta();
    await expect(alta()).rejects.toThrow(ErrorCrear);
    await expect(alta()).rejects.toThrow(/Ya existe un producto/);
  });

  it('un SKU escrito a mano que ya está tomado', async () => {
    await alta();
    await expect(alta({ nombre: 'Otro cable', sku: 'CAB-FOXB-CABLEUSBTI' })).rejects.toThrow(
      /ya lo usa/,
    );
  });

  it('un precio con ceros de más', async () => {
    await expect(alta({ precioCentavos: 900_000_000_00 })).rejects.toThrow(/sobran ceros/);
  });

  it('un precio negativo', async () => {
    await expect(alta({ precioCentavos: -1 })).rejects.toThrow(ErrorCrear);
  });

  it('una carga de stock que es en realidad una importación', async () => {
    await expect(alta({ stock: TECHO_STOCK_ALTA + 1 })).rejects.toThrow(/importación masiva/);
  });

  it('un nombre vacío', async () => {
    await expect(alta({ nombre: '   ' })).rejects.toThrow();
  });

  /* Si el alta fallara a medias quedaría un producto sin bitácora. */
  it('un alta rechazada no deja nada atrás', async () => {
    await alta();
    await expect(alta()).rejects.toThrow();
    expect(await db.select().from(products)).toHaveLength(1);
  });
});

describe('las notas internas del vendedor', () => {
  /*
   * El catálogo real tiene precios de compra y nombres de clientes dentro de
   * títulos publicados. Al dar de alta se separan antes de que lleguen a la web.
   */
  it('salen del nombre y quedan en la bitácora', async () => {
    const r = await alta({
      nombre: 'iPhone 13 128gb 86% (54265) (Rec en enero $290, hoy a $250)',
      categoria: 'Smartphones nuevos',
      marca: 'Apple',
      precioCentavos: 520_000_00,
      stock: 1,
    });

    expect(r.nombre).toBe('iPhone 13 128gb 86% (54265)');
    expect(r.notaInterna).toBe('Rec en enero $290, hoy a $250');

    const [linea] = await db.select().from(auditLog).where(eq(auditLog.entidadId, r.id));
    const valor = linea!.valorNuevo as Record<string, unknown>;
    expect(valor.notaInterna).toBe('Rec en enero $290, hoy a $250');
    expect(valor.nombreOriginal).toContain('Rec en enero');
  });
});

describe('las fichas por completar', () => {
  it('lista lo cargado a las apuradas, de lo más viejo a lo más nuevo', async () => {
    const a = await alta();
    const b = await alta({ nombre: 'Funda silicona', categoria: 'Fundas' });

    const pendientes = await fichasPendientes(db);
    expect(pendientes.map((f) => f.id)).toEqual([a.id, b.id]);
  });

  it('se puede dar una por terminada y sale de la lista', async () => {
    const a = await alta();
    await darFichaPorCompleta(db, a.id, duenio);

    expect(await fichasPendientes(db)).toHaveLength(0);
  });
});

describe('publicar en la tienda', () => {
  it('encola la publicación una sola vez por producto', async () => {
    const a = await alta();

    await encolarPublicacion(db, a.id, duenio);
    await encolarPublicacion(db, a.id, duenio);

    const cola = await db.select().from(syncQueue);
    expect(cola).toHaveLength(1);
    expect(cola[0]!.operacion).toBe('producto.publicar');
    expect(cola[0]!.payload).toEqual({ productId: a.id });
  });

  it('un producto que ya está en la tienda no se vuelve a publicar', async () => {
    const a = await alta();
    await db.update(products).set({ wooId: 4321 }).where(eq(products.id, a.id));

    await expect(encolarPublicacion(db, a.id, duenio)).rejects.toThrow(ErrorPublicar);
  });
});

describe('categorías y marcas que ya existen', () => {
  it('se ofrecen las del catálogo en vez de escribirlas de nuevo', async () => {
    await alta();
    await alta({ nombre: 'Funda silicona', categoria: 'Fundas', marca: null });

    expect(await categoriasDelCatalogo(db)).toEqual(['Cables de carga', 'Fundas']);
    expect(await marcasDelCatalogo(db)).toEqual(['FoxBox']);
  });
});
