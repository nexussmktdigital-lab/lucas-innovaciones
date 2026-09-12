/**
 * Esquema de la base de datos del POS de Lucas Innovaciones.
 *
 * Reglas que valen para todo el archivo:
 *  - Toda plata se guarda en CENTAVOS, en enteros. Nunca float, nunca decimal.
 *  - Toda fecha se guarda en `timestamptz`. El huso America/Argentina/Buenos_Aires
 *    se aplica solo al mostrar, nunca al guardar.
 *  - El tipo de cambio tambien va en centavos: TC 1.571,00 se guarda como 157100.
 *  - `sale_items.product_id` es NOT NULL con clave foranea. Es la barrera que
 *    hace imposible la venta de un item generico (D24).
 */
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/* -------------------------------------------------------------------------- */
/* Enumeraciones                                                              */
/* -------------------------------------------------------------------------- */

export const rolEnum = pgEnum('rol', ['owner', 'seller']);
export const monedaEnum = pgEnum('moneda', ['ARS', 'USD']);
export const tipoProductoEnum = pgEnum('tipo_producto', ['simple', 'variable']);

export const canalVentaEnum = pgEnum('canal_venta', ['local', 'web']);
export const estadoVentaEnum = pgEnum('estado_venta', ['completed', 'cancelled']);
export const tipoVentaEnum = pgEnum('tipo_venta', ['contado', 'fiado']);

/**
 * Medios de pago. `cheque` y `mercadopago` no estaban en el pedido original pero
 * si en la operacion real: el historico tiene 1% de cheque y el local ya cobra
 * con el QR de Mercado Pago.
 */
export const medioPagoEnum = pgEnum('medio_pago', [
  'efectivo',
  'transferencia',
  'debito',
  'credito',
  'dolares',
  'cheque',
  'mercadopago',
  'cuenta_corriente',
]);

export const tipoCuentaEnum = pgEnum('tipo_cuenta_monetaria', [
  'efectivo',
  'banco',
  'mercadopago',
  'otro',
]);

export const estadoCuentaCorrienteEnum = pgEnum('estado_cuenta_corriente', ['al_dia', 'vencido']);
export const origenCuentaCorrienteEnum = pgEnum('origen_cuenta_corriente', [
  'sistema',
  'migrado_papel',
]);
export const estadoCuotaEnum = pgEnum('estado_cuota', ['pendiente', 'pagada', 'vencida']);

export const tipoMovimientoCajaEnum = pgEnum('tipo_movimiento_caja', [
  'apertura',
  'venta',
  'cobro_fiado',
  'gasto',
  'retiro',
  'ingreso',
  'anulacion',
  'ajuste',
]);

export const tipoMovimientoStockEnum = pgEnum('tipo_movimiento_stock', [
  'venta',
  'ingreso',
  'ajuste',
  'devolucion',
  'pedido_web',
]);

export const tipoBeneficiarioEnum = pgEnum('tipo_beneficiario', [
  'proveedor',
  'tecnico',
  'comisionista',
  'empleado',
  'servicio',
  'otro',
]);

export const estadoGastoEnum = pgEnum('estado_gasto', ['pagado', 'pendiente']);
export const periodicidadEnum = pgEnum('periodicidad', ['mensual', 'bimestral', 'trimestral', 'anual']);

export const origenCotizacionEnum = pgEnum('origen_cotizacion', [
  'infodolar',
  'dolarapi',
  'manual',
]);

export const estadoSyncEnum = pgEnum('estado_sync', ['pendiente', 'procesando', 'ok', 'fallido']);

/* -------------------------------------------------------------------------- */
/* Identidad y configuracion                                                  */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    nombre: text().notNull(),
    /** Solo el dueno entra por email + password. El vendedor entra por PIN. */
    email: text(),
    passwordHash: text(),
    pinHash: text(),
    rol: rolEnum().notNull().default('seller'),
    activo: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

export const settings = pgTable('settings', {
  clave: text().primaryKey(),
  valor: jsonb().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid().references(() => users.id),
});

/**
 * Historial del tipo de cambio. El valor se ORIGINA en el plugin
 * `lucas-cotizacion` de WooCommerce (D22): el POS lo espeja y lo congela en
 * cada venta para no recalcular nunca una venta vieja.
 */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Centavos de ARS por 1 USD. TC 1.571,00 -> 157100. */
    valorCentavos: bigint({ mode: 'number' }).notNull(),
    vigenteDesde: timestamp({ withTimezone: true }).notNull(),
    origen: origenCotizacionEnum().notNull(),
    cargadoPor: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('exchange_rates_vigente_idx').on(t.vigenteDesde),
    check('exchange_rates_valor_ck', sql`${t.valorCentavos} > 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Catalogo (espejo de WooCommerce)                                           */
/* -------------------------------------------------------------------------- */

export const products = pgTable(
  'products',
  {
    id: uuid().primaryKey().defaultRandom(),
    wooId: integer(),
    sku: text(),
    nombre: text().notNull(),
    marca: text(),
    categoria: text(),
    tipo: tipoProductoEnum().notNull().default('simple'),
    /** Precio de lista en ARS. En productos USD lo calcula el sistema, no se tipea. */
    precioCentavos: bigint({ mode: 'number' }).notNull().default(0),
    moneda: monedaEnum().notNull().default('ARS'),
    /** Fuente de verdad del precio cuando `moneda = USD` (meta `_li_precio_usd`). */
    precioUsdCentavos: bigint({ mode: 'number' }),
    costoCentavos: bigint({ mode: 'number' }),
    stock: integer().notNull().default(0),
    /** Unidades comprometidas por pedidos web sin entregar. */
    stockComprometido: integer().notNull().default(0),
    gestionaStock: boolean().notNull().default(true),
    codigoBarras: text(),
    imagenUrl: text(),
    activo: boolean().notNull().default(true),
    /**
     * Servicios y chips catalogados (D24): no llevan stock y el cajero puede
     * escribir el precio en la venta. Reemplazan al item generico.
     */
    esServicio: boolean().notNull().default(false),
    precioEditable: boolean().notNull().default(false),
    /** Producto creado por el alta rapida, con la ficha a completar. */
    fichaIncompleta: boolean().notNull().default(false),
    lastSyncedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('products_woo_id_uq').on(t.wooId),
    index('products_sku_idx').on(t.sku),
    index('products_codigo_barras_idx').on(t.codigoBarras),
    index('products_nombre_idx').on(t.nombre),
    check('products_precio_ck', sql`${t.precioCentavos} >= 0`),
    check(
      'products_usd_ck',
      sql`(${t.moneda} <> 'USD') OR (${t.precioUsdCentavos} IS NOT NULL AND ${t.precioUsdCentavos} > 0)`,
    ),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    wooId: integer(),
    sku: text(),
    nombre: text().notNull(),
    /** Atributos de la variacion, ej. { "pa_modelo": "iPhone 14" }. */
    atributos: jsonb().notNull().default({}),
    precioCentavos: bigint({ mode: 'number' }).notNull().default(0),
    stock: integer().notNull().default(0),
    /**
     * True solo si la variacion lleva stock propio en WooCommerce. Cuando es
     * false —el caso de los vidrios y las fundas, que en Woo vienen con
     * `manage_stock: "parent"`— el stock que manda es el del producto padre.
     */
    gestionaStock: boolean().notNull().default(false),
    codigoBarras: text(),
    activo: boolean().notNull().default(true),
    lastSyncedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('product_variants_woo_id_uq').on(t.wooId),
    index('product_variants_product_idx').on(t.productId),
    index('product_variants_codigo_barras_idx').on(t.codigoBarras),
  ],
);

/* -------------------------------------------------------------------------- */
/* Clientes                                                                   */
/* -------------------------------------------------------------------------- */

export const customers = pgTable(
  'customers',
  {
    id: uuid().primaryKey().defaultRandom(),
    nombre: text().notNull(),
    dni: text(),
    /** Normalizado a E.164 (+549...) para poder mandar WhatsApp. */
    telefono: text(),
    telefonoRaw: text(),
    email: text(),
    direccion: text(),
    notas: text(),
    wooCustomerId: integer(),
    activo: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customers_nombre_idx').on(t.nombre),
    index('customers_telefono_idx').on(t.telefono),
    index('customers_dni_idx').on(t.dni),
  ],
);

/* -------------------------------------------------------------------------- */
/* Cuentas monetarias y caja                                                  */
/* -------------------------------------------------------------------------- */

export const monetaryAccounts = pgTable('monetary_accounts', {
  id: uuid().primaryKey().defaultRandom(),
  nombre: text().notNull(),
  tipo: tipoCuentaEnum().notNull(),
  saldoCentavos: bigint({ mode: 'number' }).notNull().default(0),
  activo: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const cashSessions = pgTable(
  'cash_sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    monetaryAccountId: uuid()
      .notNull()
      .references(() => monetaryAccounts.id),
    terminal: text().notNull(),
    abiertaPorId: uuid()
      .notNull()
      .references(() => users.id),
    cerradaPorId: uuid().references(() => users.id),
    abiertaEn: timestamp({ withTimezone: true }).notNull().defaultNow(),
    cerradaEn: timestamp({ withTimezone: true }),
    saldoInicialCentavos: bigint({ mode: 'number' }).notNull().default(0),
    saldoEsperadoCentavos: bigint({ mode: 'number' }),
    saldoContadoCentavos: bigint({ mode: 'number' }),
    diferenciaCentavos: bigint({ mode: 'number' }),
    justificacion: text(),
    nota: text(),
  },
  (t) => [
    /** Una sola sesion abierta por terminal. */
    uniqueIndex('cash_sessions_abierta_uq')
      .on(t.terminal)
      .where(sql`${t.cerradaEn} IS NULL`),
  ],
);

export const cashMovements = pgTable(
  'cash_movements',
  {
    id: uuid().primaryKey().defaultRandom(),
    monetaryAccountId: uuid()
      .notNull()
      .references(() => monetaryAccounts.id),
    cashSessionId: uuid().references(() => cashSessions.id),
    tipo: tipoMovimientoCajaEnum().notNull(),
    /** Con signo: entra positivo, sale negativo. */
    montoCentavos: bigint({ mode: 'number' }).notNull(),
    referenciaTipo: text(),
    referenciaId: uuid(),
    usuarioId: uuid()
      .notNull()
      .references(() => users.id),
    descripcion: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cash_movements_sesion_idx').on(t.cashSessionId),
    index('cash_movements_cuenta_idx').on(t.monetaryAccountId),
    index('cash_movements_fecha_idx').on(t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Venta                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Correlativo de ventas, uno por terminal.
 *
 * Se lleva en una tabla y no contando ventas: el conteo se corre con dos ventas
 * simultaneas. El incremento va con un upsert que devuelve el numero nuevo, que
 * es atomico y toma el candado de la fila sin necesidad de pedirlo.
 */
export const saleCounters = pgTable('sale_counters', {
  terminal: text().primaryKey(),
  ultimo: integer().notNull().default(0),
});

export const sales = pgTable(
  'sales',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Correlativo con prefijo de terminal, ej. `T1-000123`. */
    numero: text().notNull(),
    terminal: text().notNull(),
    fecha: timestamp({ withTimezone: true }).notNull().defaultNow(),
    vendedorId: uuid()
      .notNull()
      .references(() => users.id),
    clienteId: uuid().references(() => customers.id),
    cashSessionId: uuid().references(() => cashSessions.id),
    canal: canalVentaEnum().notNull().default('local'),
    estado: estadoVentaEnum().notNull().default('completed'),
    tipo: tipoVentaEnum().notNull().default('contado'),
    subtotalCentavos: bigint({ mode: 'number' }).notNull(),
    descuentoCentavos: bigint({ mode: 'number' }).notNull().default(0),
    totalCentavos: bigint({ mode: 'number' }).notNull(),
    /** TC congelado al confirmar. Una venta vieja nunca se recalcula. */
    tcAplicadoCentavos: bigint({ mode: 'number' }),
    idempotencyKey: text().notNull(),
    syncedToWoo: boolean().notNull().default(false),
    wooOrderId: integer(),
    nota: text(),
    /** Si esta venta anula a otra, apunta a la original. Nada se borra. */
    anulaVentaId: uuid(),
    motivoAnulacion: text(),
    autorizadaPorId: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sales_numero_uq').on(t.numero),
    uniqueIndex('sales_idempotency_uq').on(t.idempotencyKey),
    index('sales_fecha_idx').on(t.fecha),
    index('sales_cliente_idx').on(t.clienteId),
    index('sales_vendedor_idx').on(t.vendedorId),
    index('sales_canal_idx').on(t.canal),
    check('sales_total_ck', sql`${t.totalCentavos} >= 0`),
  ],
);

/**
 * Lineas de venta.
 *
 * `productId` es NOT NULL con clave foranea a proposito: la prohibicion del
 * item generico (D24) se cumple en la base, no en la aplicacion. Un INSERT
 * directo por SQL sin producto falla.
 */
export const saleItems = pgTable(
  'sale_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    saleId: uuid()
      .notNull()
      .references(() => sales.id, { onDelete: 'restrict' }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    variantId: uuid().references(() => productVariants.id, { onDelete: 'restrict' }),
    /** Descripcion congelada: si manana cambia el nombre del producto, el ticket no. */
    descripcion: text().notNull(),
    cantidad: integer().notNull(),
    precioUnitarioCentavos: bigint({ mode: 'number' }).notNull(),
    monedaOriginal: monedaEnum().notNull().default('ARS'),
    precioUsdCentavos: bigint({ mode: 'number' }),
    descuentoCentavos: bigint({ mode: 'number' }).notNull().default(0),
    costoCentavos: bigint({ mode: 'number' }),
    totalCentavos: bigint({ mode: 'number' }).notNull(),
  },
  (t) => [
    index('sale_items_sale_idx').on(t.saleId),
    index('sale_items_product_idx').on(t.productId),
    check('sale_items_cantidad_ck', sql`${t.cantidad} > 0`),
    check('sale_items_precio_ck', sql`${t.precioUnitarioCentavos} >= 0`),
    check('sale_items_descuento_ck', sql`${t.descuentoCentavos} >= 0`),
  ],
);

export const salePayments = pgTable(
  'sale_payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    saleId: uuid()
      .notNull()
      .references(() => sales.id, { onDelete: 'restrict' }),
    medio: medioPagoEnum().notNull(),
    monetaryAccountId: uuid().references(() => monetaryAccounts.id),
    montoCentavos: bigint({ mode: 'number' }).notNull(),
    /** Solo tarjeta: el Posnet es un aparato aparte, el POS unicamente registra. */
    marcaTarjeta: text(),
    cuotas: integer(),
    ultimos4: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sale_payments_sale_idx').on(t.saleId),
    check('sale_payments_monto_ck', sql`${t.montoCentavos} > 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Fiado / cuenta corriente                                                   */
/* -------------------------------------------------------------------------- */

export const creditAccounts = pgTable(
  'credit_accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    saldoCentavos: bigint({ mode: 'number' }).notNull().default(0),
    estado: estadoCuentaCorrienteEnum().notNull().default('al_dia'),
    origen: origenCuentaCorrienteEnum().notNull().default('sistema'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('credit_accounts_customer_uq').on(t.customerId)],
);

export const creditPlans = pgTable(
  'credit_plans',
  {
    id: uuid().primaryKey().defaultRandom(),
    creditAccountId: uuid()
      .notNull()
      .references(() => creditAccounts.id),
    /** Nulo solo en las fichas de papel migradas, que no tienen venta de origen. */
    saleId: uuid().references(() => sales.id),
    descripcion: text(),
    montoFinanciadoCentavos: bigint({ mode: 'number' }).notNull(),
    anticipoCentavos: bigint({ mode: 'number' }).notNull().default(0),
    recargoCentavos: bigint({ mode: 'number' }).notNull().default(0),
    cantidadCuotas: integer().notNull(),
    totalAPagarCentavos: bigint({ mode: 'number' }).notNull(),
    origen: origenCuentaCorrienteEnum().notNull().default('sistema'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('credit_plans_cuenta_idx').on(t.creditAccountId),
    check('credit_plans_cuotas_ck', sql`${t.cantidadCuotas} > 0`),
  ],
);

export const installments = pgTable(
  'installments',
  {
    id: uuid().primaryKey().defaultRandom(),
    planId: uuid()
      .notNull()
      .references(() => creditPlans.id, { onDelete: 'cascade' }),
    numero: integer().notNull(),
    montoCentavos: bigint({ mode: 'number' }).notNull(),
    vencimiento: date().notNull(),
    estado: estadoCuotaEnum().notNull().default('pendiente'),
    pagadoCentavos: bigint({ mode: 'number' }).notNull().default(0),
  },
  (t) => [
    unique('installments_plan_numero_uq').on(t.planId, t.numero),
    index('installments_vencimiento_idx').on(t.vencimiento),
  ],
);

export const creditPayments = pgTable(
  'credit_payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    creditAccountId: uuid()
      .notNull()
      .references(() => creditAccounts.id),
    montoCentavos: bigint({ mode: 'number' }).notNull(),
    medio: medioPagoEnum().notNull(),
    monetaryAccountId: uuid().references(() => monetaryAccounts.id),
    cashSessionId: uuid().references(() => cashSessions.id),
    fecha: timestamp({ withTimezone: true }).notNull().defaultNow(),
    cobradoPorId: uuid()
      .notNull()
      .references(() => users.id),
    saldoResultanteCentavos: bigint({ mode: 'number' }).notNull(),
    nota: text(),
    idempotencyKey: text().notNull(),
  },
  (t) => [
    uniqueIndex('credit_payments_idempotency_uq').on(t.idempotencyKey),
    index('credit_payments_cuenta_idx').on(t.creditAccountId),
    check('credit_payments_monto_ck', sql`${t.montoCentavos} > 0`),
  ],
);

/**
 * Imputacion de un cobro a una o varias cuotas.
 *
 * Las claves foraneas llevan nombre corto a mano: el que genera Drizzle por
 * defecto supera los 63 caracteres y PostgreSQL lo truncaria en silencio.
 */
export const creditPaymentAllocations = pgTable(
  'credit_payment_allocations',
  {
    id: uuid().primaryKey().defaultRandom(),
    creditPaymentId: uuid().notNull(),
    installmentId: uuid().notNull(),
    montoCentavos: bigint({ mode: 'number' }).notNull(),
  },
  (t) => [
    index('credit_payment_allocations_pago_idx').on(t.creditPaymentId),
    foreignKey({
      name: 'cpa_pago_fk',
      columns: [t.creditPaymentId],
      foreignColumns: [creditPayments.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'cpa_cuota_fk',
      columns: [t.installmentId],
      foreignColumns: [installments.id],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Gastos                                                                     */
/* -------------------------------------------------------------------------- */

export const expenseCategories = pgTable('expense_categories', {
  id: uuid().primaryKey().defaultRandom(),
  nombre: text().notNull().unique(),
  orden: integer().notNull().default(0),
  activo: boolean().notNull().default(true),
});

export const payees = pgTable(
  'payees',
  {
    id: uuid().primaryKey().defaultRandom(),
    nombre: text().notNull(),
    tipo: tipoBeneficiarioEnum().notNull().default('otro'),
    telefono: text(),
    cuit: text(),
    notas: text(),
    activo: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payees_nombre_idx').on(t.nombre)],
);

export const recurringExpenses = pgTable('recurring_expenses', {
  id: uuid().primaryKey().defaultRandom(),
  categoryId: uuid()
    .notNull()
    .references(() => expenseCategories.id),
  payeeId: uuid().references(() => payees.id),
  descripcion: text().notNull(),
  montoCentavos: bigint({ mode: 'number' }).notNull(),
  moneda: monedaEnum().notNull().default('ARS'),
  periodicidad: periodicidadEnum().notNull().default('mensual'),
  diaDelMes: integer().notNull().default(1),
  avisarDiasAntes: integer().notNull().default(3),
  proximaGeneracion: date().notNull(),
  activo: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const expenses = pgTable(
  'expenses',
  {
    id: uuid().primaryKey().defaultRandom(),
    fecha: date().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => expenseCategories.id),
    payeeId: uuid().references(() => payees.id),
    descripcion: text().notNull(),
    montoCentavos: bigint({ mode: 'number' }).notNull(),
    moneda: monedaEnum().notNull().default('ARS'),
    tcAplicadoCentavos: bigint({ mode: 'number' }),
    medio: medioPagoEnum(),
    monetaryAccountId: uuid().references(() => monetaryAccounts.id),
    cashSessionId: uuid().references(() => cashSessions.id),
    estado: estadoGastoEnum().notNull().default('pagado'),
    vencimiento: date(),
    comprobanteUrl: text(),
    recurrenteId: uuid().references(() => recurringExpenses.id),
    cargadoPorId: uuid()
      .notNull()
      .references(() => users.id),
    pagadoEn: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('expenses_fecha_idx').on(t.fecha),
    index('expenses_categoria_idx').on(t.categoryId),
    index('expenses_payee_idx').on(t.payeeId),
    index('expenses_estado_idx').on(t.estado),
    check('expenses_monto_ck', sql`${t.montoCentavos} > 0`),
    /** Un gasto pagado tiene que decir de que cuenta salio, o la caja no cierra. */
    check(
      'expenses_pagado_ck',
      sql`(${t.estado} <> 'pagado') OR (${t.monetaryAccountId} IS NOT NULL AND ${t.medio} IS NOT NULL)`,
    ),
  ],
);

/** Unidades compradas dentro de un gasto de categoria "compra a proveedores". */
export const expenseItems = pgTable(
  'expense_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    expenseId: uuid()
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    cantidad: integer().notNull(),
    costoUnitarioCentavos: bigint({ mode: 'number' }).notNull(),
  },
  (t) => [
    index('expense_items_gasto_idx').on(t.expenseId),
    check('expense_items_cantidad_ck', sql`${t.cantidad} > 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Stock e integridad                                                         */
/* -------------------------------------------------------------------------- */

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    variantId: uuid().references(() => productVariants.id),
    tipo: tipoMovimientoStockEnum().notNull(),
    /** Con signo: ingreso positivo, salida negativa. */
    cantidad: integer().notNull(),
    stockResultante: integer().notNull(),
    motivo: text(),
    usuarioId: uuid().references(() => users.id),
    referenciaTipo: text(),
    referenciaId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stock_movements_product_idx').on(t.productId),
    index('stock_movements_fecha_idx').on(t.createdAt),
    check('stock_movements_cantidad_ck', sql`${t.cantidad} <> 0`),
  ],
);

/** Operaciones pendientes de empujar a WooCommerce, con reintentos y backoff. */
export const syncQueue = pgTable(
  'sync_queue',
  {
    id: uuid().primaryKey().defaultRandom(),
    operacion: text().notNull(),
    payload: jsonb().notNull(),
    idempotencyKey: text().notNull(),
    estado: estadoSyncEnum().notNull().default('pendiente'),
    intentos: integer().notNull().default(0),
    proximoIntento: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ultimoError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sync_queue_idempotency_uq').on(t.idempotencyKey),
    index('sync_queue_pendientes_idx').on(t.estado, t.proximoIntento),
  ],
);

export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    stockPos: integer().notNull(),
    stockWoo: integer().notNull(),
    detalle: jsonb(),
    detectadoEn: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resueltoEn: timestamp({ withTimezone: true }),
    resolucion: text(),
    resueltoPorId: uuid().references(() => users.id),
  },
  (t) => [index('sync_conflicts_abiertos_idx').on(t.resueltoEn)],
);

/**
 * Bitacora inmutable. Un trigger de base impide UPDATE y DELETE: no alcanza con
 * la disciplina del codigo.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid().primaryKey().defaultRandom(),
    usuarioId: uuid().references(() => users.id),
    accion: text().notNull(),
    entidad: text().notNull(),
    entidadId: text(),
    valorAnterior: jsonb(),
    valorNuevo: jsonb(),
    ip: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_entidad_idx').on(t.entidad, t.entidadId),
    index('audit_log_fecha_idx').on(t.createdAt),
    index('audit_log_usuario_idx').on(t.usuarioId),
  ],
);

/**
 * Historico del POS anterior. Solo lectura: se consulta en reportes pero no se
 * mezcla con las ventas del sistema nuevo ni afecta stock ni caja.
 */
export const legacySales = pgTable(
  'legacy_sales',
  {
    id: uuid().primaryKey().defaultRandom(),
    origen: text().notNull().default('yith'),
    referenciaExterna: text().notNull(),
    fecha: timestamp({ withTimezone: true }).notNull(),
    totalCentavos: bigint({ mode: 'number' }).notNull(),
    medioPago: text(),
    cliente: text(),
    /** Si la linea original no tenia producto, aca queda el texto crudo. */
    detalle: jsonb(),
    /** Facturacion cargada bajo item generico: alimenta el marcador de calidad. */
    sinProducto: boolean().notNull().default(false),
    importadoEn: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('legacy_sales_referencia_uq').on(t.origen, t.referenciaExterna),
    index('legacy_sales_fecha_idx').on(t.fecha),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relaciones                                                                 */
/* -------------------------------------------------------------------------- */

export const salesRelations = relations(sales, ({ one, many }) => ({
  vendedor: one(users, { fields: [sales.vendedorId], references: [users.id] }),
  cliente: one(customers, { fields: [sales.clienteId], references: [customers.id] }),
  sesion: one(cashSessions, { fields: [sales.cashSessionId], references: [cashSessions.id] }),
  items: many(saleItems),
  pagos: many(salePayments),
}));

export const saleItemsRelations = relations(saleItems, ({ one }) => ({
  venta: one(sales, { fields: [saleItems.saleId], references: [sales.id] }),
  producto: one(products, { fields: [saleItems.productId], references: [products.id] }),
  variante: one(productVariants, {
    fields: [saleItems.variantId],
    references: [productVariants.id],
  }),
}));

export const salePaymentsRelations = relations(salePayments, ({ one }) => ({
  venta: one(sales, { fields: [salePayments.saleId], references: [sales.id] }),
  cuenta: one(monetaryAccounts, {
    fields: [salePayments.monetaryAccountId],
    references: [monetaryAccounts.id],
  }),
}));

export const productsRelations = relations(products, ({ many }) => ({
  variantes: many(productVariants),
  movimientos: many(stockMovements),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  producto: one(products, { fields: [productVariants.productId], references: [products.id] }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  cuentaCorriente: one(creditAccounts, {
    fields: [customers.id],
    references: [creditAccounts.customerId],
  }),
  ventas: many(sales),
}));

export const creditAccountsRelations = relations(creditAccounts, ({ one, many }) => ({
  cliente: one(customers, { fields: [creditAccounts.customerId], references: [customers.id] }),
  planes: many(creditPlans),
  cobros: many(creditPayments),
}));

export const creditPlansRelations = relations(creditPlans, ({ one, many }) => ({
  cuenta: one(creditAccounts, {
    fields: [creditPlans.creditAccountId],
    references: [creditAccounts.id],
  }),
  venta: one(sales, { fields: [creditPlans.saleId], references: [sales.id] }),
  cuotas: many(installments),
}));

export const installmentsRelations = relations(installments, ({ one }) => ({
  plan: one(creditPlans, { fields: [installments.planId], references: [creditPlans.id] }),
}));

export const creditPaymentsRelations = relations(creditPayments, ({ one, many }) => ({
  cuenta: one(creditAccounts, {
    fields: [creditPayments.creditAccountId],
    references: [creditAccounts.id],
  }),
  imputaciones: many(creditPaymentAllocations),
}));

export const expensesRelations = relations(expenses, ({ one, many }) => ({
  categoria: one(expenseCategories, {
    fields: [expenses.categoryId],
    references: [expenseCategories.id],
  }),
  beneficiario: one(payees, { fields: [expenses.payeeId], references: [payees.id] }),
  items: many(expenseItems),
}));

export const cashSessionsRelations = relations(cashSessions, ({ one, many }) => ({
  cuenta: one(monetaryAccounts, {
    fields: [cashSessions.monetaryAccountId],
    references: [monetaryAccounts.id],
  }),
  movimientos: many(cashMovements),
  ventas: many(sales),
}));

export const cashMovementsRelations = relations(cashMovements, ({ one }) => ({
  cuenta: one(monetaryAccounts, {
    fields: [cashMovements.monetaryAccountId],
    references: [monetaryAccounts.id],
  }),
  sesion: one(cashSessions, {
    fields: [cashMovements.cashSessionId],
    references: [cashSessions.id],
  }),
}));
