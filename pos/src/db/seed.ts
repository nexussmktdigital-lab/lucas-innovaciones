/**
 * Datos de prueba para trabajar sin WooCommerce conectado.
 *
 * Este modulo solo define datos y funciones: no hace nada al importarse.
 * El comando vive en `src/scripts/seed.ts`.
 *
 * Los productos son una muestra real del catalogo (los de mayor rotacion segun
 * `catalogo-prioridad-fotos.csv`), mas los servicios y chips que hoy se cargan
 * como item generico y con D24 pasan a ser productos de verdad.
 */
import { count, isNotNull, sql } from 'drizzle-orm';
import * as schema from './schema';
import type { BaseDatos } from './tipos';
import { hashearPassword, hashearPin } from '@/auth/pin';
import { usdAPesos } from '@/lib/dinero';

const TC_CENTAVOS = 157_100; // $1.571,00 — blue de Córdoba de referencia

/** Credenciales de desarrollo. En producción se crean desde la app. */
const PASSWORD_DUENIO = process.env.SEED_PASSWORD_DUENIO ?? 'lucas-desarrollo-2026';
const PIN_VENDEDOR = process.env.SEED_PIN_VENDEDOR ?? '4827';

interface ProductoSemilla {
  wooId: number;
  sku: string | null;
  nombre: string;
  categoria: string;
  marca: string | null;
  precio: number;
  stock: number;
  usd?: number;
  servicio?: boolean;
}

/** Muestra real del catálogo: los de mayor rotación de los últimos 12 meses. */
const CATALOGO: ProductoSemilla[] = [
  { wooId: 6485, sku: '531', nombre: 'Vidrio templado 9D | glass 9d', categoria: 'Vidrios templados e hidrogel', marca: null, precio: 5000, stock: 40 },
  { wooId: 6493, sku: '540', nombre: 'Funda común', categoria: 'Fundas', marca: null, precio: 8000, stock: 25 },
  { wooId: 6581, sku: 'VID-GEN-HIDROG', nombre: 'Hidrogel Clear AAA', categoria: 'Vidrios templados e hidrogel', marca: null, precio: 8000, stock: 30 },
  { wooId: 6924, sku: 'FND-GEN-ECONOM', nombre: 'Funda económica', categoria: 'Fundas', marca: null, precio: 7000, stock: 18 },
  { wooId: 6490, sku: '537', nombre: 'Hidrogel premium', categoria: 'Vidrios templados e hidrogel', marca: null, precio: 12000, stock: 22 },
  { wooId: 7307, sku: null, nombre: 'Cable USB tipo C', categoria: 'Cables de carga', marca: null, precio: 6000, stock: 15 },
  { wooId: 6511, sku: '581', nombre: 'Fuente iPhone 20w tipo C original', categoria: 'Cargadores de pared', marca: 'Apple', precio: 65000, stock: 5 },
  { wooId: 7359, sku: null, nombre: 'Cable USB tipo C Fox Box Axon 20w', categoria: 'Cables de carga', marca: 'FoxBox', precio: 9000, stock: 3 },
  { wooId: 7306, sku: 'AUR-GEN-AURICU-5', nombre: 'Auriculares AirPods Pro Rep 2', categoria: 'Auriculares inalámbricos', marca: null, precio: 29000, stock: 2 },
  { wooId: 6667, sku: 'ALM-HIKS-PENDRI32G', nombre: 'Pendrive Hiksemi 32GB', categoria: 'Almacenamiento', marca: 'Hiksemi', precio: 28000, stock: 24 },
  { wooId: 6563, sku: 'ALM-HIKS-MEMORI32G', nombre: 'Memoria Hiksemi micro SD 32GB', categoria: 'Almacenamiento', marca: 'Hiksemi', precio: 25000, stock: 9 },
  { wooId: 6920, sku: 'CAR-FOX-FOX-2', nombre: 'Cargador Fox Box MEGA 30w con cable Lightning', categoria: 'Cargadores de pared', marca: 'FoxBox', precio: 32000, stock: 8 },
  { wooId: 6491, sku: '538', nombre: 'Hidrogel anti espía', categoria: 'Vidrios templados e hidrogel', marca: null, precio: 14000, stock: 6 },
  { wooId: 6970, sku: 'CAB-APPLE-TRV', nombre: 'Cable USB TRV iPhone Lightning', categoria: 'Cables de carga', marca: 'Apple', precio: 13000, stock: 4 },
  { wooId: 6951, sku: 'CAB-GEN-TRV', nombre: 'Cable TRV tipo C a tipo C 65w', categoria: 'Cables de carga', marca: null, precio: 12000, stock: 6 },

  // Teléfonos en pesos.
  { wooId: 7100, sku: 'SAM-A17-128', nombre: 'Samsung Galaxy A17 128GB', categoria: 'Smartphones nuevos', marca: 'Samsung', precio: 410000, stock: 2 },
  { wooId: 7101, sku: 'MOT-G86-256', nombre: 'Motorola G86 256GB', categoria: 'Smartphones nuevos', marca: 'Motorola', precio: 382000, stock: 1 },

  // iPhones en dólares (D22): el USD manda, los pesos los calcula el sistema.
  { wooId: 7001, sku: 'IP14P-256', nombre: 'iPhone 14 Pro 256GB', categoria: 'Smartphones nuevos', marca: 'Apple', precio: 0, stock: 1, usd: 1370 },
  { wooId: 7002, sku: 'IP13-128', nombre: 'iPhone 13 128GB', categoria: 'Smartphones nuevos', marca: 'Apple', precio: 0, stock: 2, usd: 520 },
  { wooId: 7003, sku: 'IP11-64', nombre: 'iPhone 11 64GB', categoria: 'Smartphones nuevos', marca: 'Apple', precio: 0, stock: 1, usd: 195 },

  /**
   * El error de agosto, a propósito.
   *
   * Nueve iPhones se cargaron a US$ 6.300 y se publicaron a $6.300. La ficha se
   * ve perfectamente normal: es un iPhone con precio y stock. Está acá para que
   * la guarda de cordura se pueda ver funcionando, en «Calidad del catálogo» y
   * al intentar venderlo.
   */
  { wooId: 7099, sku: 'IP15PM-1T', nombre: 'iPhone 15 Pro Max 1TB', categoria: 'Smartphones nuevos', marca: 'Apple', precio: 6300, stock: 9 },

  // Servicios y chips catalogados (D24). Reemplazan al ítem genérico.
  { wooId: 9001, sku: 'SERV-VIRUS', nombre: 'Servicio técnico · Limpieza de virus', categoria: 'Servicio técnico', marca: null, precio: 7050, stock: 0, servicio: true },
  { wooId: 9002, sku: 'SERV-SOFT', nombre: 'Servicio técnico · Instalación de software', categoria: 'Servicio técnico', marca: null, precio: 8375, stock: 0, servicio: true },
  { wooId: 9003, sku: 'SERV-LIMP', nombre: 'Servicio técnico · Limpieza de equipo', categoria: 'Servicio técnico', marca: null, precio: 14750, stock: 0, servicio: true },
  { wooId: 9004, sku: 'SERV-REPAR', nombre: 'Servicio técnico · Reparación (a presupuestar)', categoria: 'Servicio técnico', marca: null, precio: 0, stock: 0, servicio: true },
  { wooId: 9010, sku: 'CHIP-CLARO', nombre: 'Chip Claro prepago', categoria: 'Telefonía', marca: 'Claro', precio: 2205, stock: 0, servicio: true },
  { wooId: 9011, sku: 'CHIP-PERSONAL', nombre: 'Chip Personal prepago', categoria: 'Telefonía', marca: 'Personal', precio: 2205, stock: 0, servicio: true },
  { wooId: 9012, sku: 'CHIP-MOVISTAR', nombre: 'Chip Movistar prepago', categoria: 'Telefonía', marca: 'Movistar', precio: 2205, stock: 0, servicio: true },
];

/**
 * Muestra del histórico del POS anterior, para que el marcador de facturación
 * con producto real tenga con qué contrastar.
 *
 * Los porcentajes salen de la auditoría del 2026-08-03: la facturación cargada
 * bajo ítem genérico venía en 70%, 67% y 61% en los últimos tres meses, sobre
 * $167.415.950 en doce meses. Son datos agregados reales, redondeados a un mes
 * de facturación típico; no son los pedidos uno por uno, que se importan en la
 * fase 10 con el CSV del POS viejo.
 */
const HISTORICO: { mes: string; totalCentavos: number; sinProductoPorc: number }[] = [
  { mes: '2026-05', totalCentavos: 1_380_000_000, sinProductoPorc: 70 },
  { mes: '2026-06', totalCentavos: 1_420_000_000, sinProductoPorc: 67 },
  { mes: '2026-07', totalCentavos: 1_510_000_000, sinProductoPorc: 61 },
];

const CATEGORIAS_GASTO = [
  'Alquiler',
  'Luz, gas e internet',
  'Compra a proveedores',
  'Comisionistas',
  'Envíos',
  'Técnicos',
  'Sueldos',
  'Impuestos y tasas',
  'Mantenimiento',
  'Retiro de socios',
  'Otros',
];

/**
 * Vacia las tablas de datos conservando el esquema.
 *
 * Los disparadores de inmutabilidad actuan por fila y no bloquean TRUNCATE, que
 * es justamente lo que permite reiniciar una base de desarrollo.
 */
export async function vaciar(db: BaseDatos): Promise<number> {
  const filas = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'`,
  );
  const tablas = Array.from(filas as unknown as { tablename: string }[]);
  if (tablas.length === 0) return 0;
  const lista = tablas.map((t) => `"${t.tablename}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE ${lista} RESTART IDENTITY CASCADE`));
  return tablas.length;
}

export interface ResumenSemilla {
  productos: number;
  categoriasDeGasto: number;
  emailDuenio: string;
  passwordDuenio: string;
  pinVendedor: string;
  /** True si se omitió el catálogo de prueba por haber catálogo real. */
  catalogoOmitido: boolean;
}

export interface OpcionesSemilla {
  /**
   * Forzar la carga del catálogo de prueba aunque ya haya catálogo
   * sincronizado. Solo para desarrollo: mezclar los dos deja productos que no
   * existen en WooCommerce y que al venderse no se pueden sincronizar.
   */
  forzarCatalogo?: boolean;
}

/**
 * Carga los datos de prueba. Es idempotente: correrla dos veces no duplica.
 * La usa tanto `npm run db:seed` como `npm run demo`.
 *
 * El catálogo de prueba se omite si la base ya tiene productos traídos de
 * WooCommerce: son dos mundos que no se pueden mezclar.
 */
export async function sembrar(
  db: BaseDatos,
  opciones: OpcionesSemilla = {},
): Promise<ResumenSemilla> {
  const [duenio] = await db
    .insert(schema.users)
    .values({
      nombre: 'Lucas',
      email: 'lucas@lucasinnovaciones.com.ar',
      passwordHash: await hashearPassword(PASSWORD_DUENIO),
      rol: 'owner',
    })
    .onConflictDoNothing()
    .returning();

  await db
    .insert(schema.users)
    .values({
      nombre: 'Vendedor de mostrador',
      pinHash: await hashearPin(PIN_VENDEDOR),
      rol: 'seller',
    })
    .onConflictDoNothing();

  await db
    .insert(schema.monetaryAccounts)
    .values([
      { nombre: 'Caja en efectivo', tipo: 'efectivo' },
      { nombre: 'Banco', tipo: 'banco' },
      { nombre: 'Mercado Pago', tipo: 'mercadopago' },
    ])
    .onConflictDoNothing();

  await db
    .insert(schema.exchangeRates)
    .values({
      valorCentavos: TC_CENTAVOS,
      vigenteDesde: new Date(),
      origen: 'manual',
      cargadoPor: duenio?.id ?? null,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.expenseCategories)
    .values(CATEGORIAS_GASTO.map((nombre, orden) => ({ nombre, orden })))
    .onConflictDoNothing();

  await db
    .insert(schema.payees)
    .values([
      { nombre: 'Distribuidora Córdoba Celular', tipo: 'proveedor' },
      { nombre: 'Técnico externo — Pablo', tipo: 'tecnico' },
      { nombre: 'EPEC', tipo: 'servicio' },
    ])
    .onConflictDoNothing();

  // ¿Hay catálogo real? Un producto con `lastSyncedAt` vino de WooCommerce.
  const [yaSincronizado] = await db
    .select({ cuantos: count() })
    .from(schema.products)
    .where(isNotNull(schema.products.lastSyncedAt));

  const hayCatalogoReal = (yaSincronizado?.cuantos ?? 0) > CATALOGO.length;
  const catalogoOmitido = hayCatalogoReal && !opciones.forzarCatalogo;

  if (!catalogoOmitido) {
  await db
    .insert(schema.products)
    .values(
      CATALOGO.map((p) => ({
        wooId: p.wooId,
        sku: p.sku,
        nombre: p.nombre,
        categoria: p.categoria,
        marca: p.marca,
        moneda: (p.usd ? 'USD' : 'ARS') as 'ARS' | 'USD',
        precioUsdCentavos: p.usd ? Math.round(p.usd * 100) : null,
        // En un producto en dólares el precio en pesos NO se tipea: se calcula.
        precioCentavos: p.usd ? usdAPesos(Math.round(p.usd * 100), TC_CENTAVOS) : p.precio * 100,
        stock: p.stock,
        gestionaStock: !p.servicio,
        esServicio: Boolean(p.servicio),
        // Un servicio no se publica en la tienda, asi que su precio ya es el de
        // mostrador y no lleva el recargo de la web (D31).
        soloMostrador: Boolean(p.servicio),
        precioEditable: Boolean(p.servicio),
        // Mismo criterio que el mapeo de WooCommerce: sin SKU o sin precio real,
        // la ficha esta incompleta. Ninguna del seed tiene imagen, igual que el
        // catalogo real (97% sin foto), pero eso se mide por columna aparte.
        fichaIncompleta: !p.sku || (!p.usd && p.precio < 100),
        activo: true,
        lastSyncedAt: new Date(),
      })),
    )
    .onConflictDoNothing();
  }

  // Histórico de referencia. Va aparte de las ventas del sistema nuevo: se
  // consulta en reportes pero no toca stock ni caja.
  await db
    .insert(schema.legacySales)
    .values(
      HISTORICO.flatMap((m) => {
        const sinProducto = Math.round((m.totalCentavos * m.sinProductoPorc) / 100);
        return [
          {
            origen: 'yith',
            referenciaExterna: `resumen-${m.mes}-sin-producto`,
            fecha: new Date(`${m.mes}-15T15:00:00Z`),
            totalCentavos: sinProducto,
            sinProducto: true,
            detalle: { nota: 'Agregado mensual de la auditoría, no pedidos individuales' },
          },
          {
            origen: 'yith',
            referenciaExterna: `resumen-${m.mes}-con-producto`,
            fecha: new Date(`${m.mes}-15T15:00:00Z`),
            totalCentavos: m.totalCentavos - sinProducto,
            sinProducto: false,
            detalle: { nota: 'Agregado mensual de la auditoría, no pedidos individuales' },
          },
        ];
      }),
    )
    .onConflictDoNothing();

  await db
    .insert(schema.customers)
    .values([
      { nombre: 'Consumidor final', telefono: null },
      { nombre: 'Mayco Villafañe', telefono: '+5493571000001' },
      { nombre: 'Gaby González', telefono: '+5493571000002' },
    ])
    .onConflictDoNothing();

  return {
    productos: catalogoOmitido ? 0 : CATALOGO.length,
    categoriasDeGasto: CATEGORIAS_GASTO.length,
    emailDuenio: 'lucas@lucasinnovaciones.com.ar',
    passwordDuenio: PASSWORD_DUENIO,
    pinVendedor: PIN_VENDEDOR,
    catalogoOmitido,
  };
}
