CREATE TYPE "public"."canal_venta" AS ENUM('local', 'web');--> statement-breakpoint
CREATE TYPE "public"."estado_cuenta_corriente" AS ENUM('al_dia', 'vencido');--> statement-breakpoint
CREATE TYPE "public"."estado_cuota" AS ENUM('pendiente', 'pagada', 'vencida');--> statement-breakpoint
CREATE TYPE "public"."estado_gasto" AS ENUM('pagado', 'pendiente');--> statement-breakpoint
CREATE TYPE "public"."estado_sync" AS ENUM('pendiente', 'procesando', 'ok', 'fallido');--> statement-breakpoint
CREATE TYPE "public"."estado_venta" AS ENUM('completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."medio_pago" AS ENUM('efectivo', 'transferencia', 'debito', 'credito', 'dolares', 'cheque', 'mercadopago', 'cuenta_corriente');--> statement-breakpoint
CREATE TYPE "public"."moneda" AS ENUM('ARS', 'USD');--> statement-breakpoint
CREATE TYPE "public"."origen_cotizacion" AS ENUM('infodolar', 'dolarapi', 'manual');--> statement-breakpoint
CREATE TYPE "public"."origen_cuenta_corriente" AS ENUM('sistema', 'migrado_papel');--> statement-breakpoint
CREATE TYPE "public"."periodicidad" AS ENUM('mensual', 'bimestral', 'trimestral', 'anual');--> statement-breakpoint
CREATE TYPE "public"."rol" AS ENUM('owner', 'seller');--> statement-breakpoint
CREATE TYPE "public"."tipo_beneficiario" AS ENUM('proveedor', 'tecnico', 'comisionista', 'empleado', 'servicio', 'otro');--> statement-breakpoint
CREATE TYPE "public"."tipo_cuenta_monetaria" AS ENUM('efectivo', 'banco', 'mercadopago', 'otro');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimiento_caja" AS ENUM('apertura', 'venta', 'cobro_fiado', 'gasto', 'retiro', 'ingreso', 'anulacion', 'ajuste');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimiento_stock" AS ENUM('venta', 'ingreso', 'ajuste', 'devolucion', 'pedido_web');--> statement-breakpoint
CREATE TYPE "public"."tipo_producto" AS ENUM('simple', 'variable');--> statement-breakpoint
CREATE TYPE "public"."tipo_venta" AS ENUM('contado', 'fiado');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid,
	"accion" text NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" text,
	"valor_anterior" jsonb,
	"valor_nuevo" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monetary_account_id" uuid NOT NULL,
	"cash_session_id" uuid,
	"tipo" "tipo_movimiento_caja" NOT NULL,
	"monto_centavos" bigint NOT NULL,
	"referencia_tipo" text,
	"referencia_id" uuid,
	"usuario_id" uuid NOT NULL,
	"descripcion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monetary_account_id" uuid NOT NULL,
	"terminal" text NOT NULL,
	"abierta_por_id" uuid NOT NULL,
	"cerrada_por_id" uuid,
	"abierta_en" timestamp with time zone DEFAULT now() NOT NULL,
	"cerrada_en" timestamp with time zone,
	"saldo_inicial_centavos" bigint DEFAULT 0 NOT NULL,
	"saldo_esperado_centavos" bigint,
	"saldo_contado_centavos" bigint,
	"diferencia_centavos" bigint,
	"justificacion" text,
	"nota" text
);
--> statement-breakpoint
CREATE TABLE "credit_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"saldo_centavos" bigint DEFAULT 0 NOT NULL,
	"estado" "estado_cuenta_corriente" DEFAULT 'al_dia' NOT NULL,
	"origen" "origen_cuenta_corriente" DEFAULT 'sistema' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_accounts_customer_uq" UNIQUE("customer_id")
);
--> statement-breakpoint
CREATE TABLE "credit_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_payment_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"monto_centavos" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_account_id" uuid NOT NULL,
	"monto_centavos" bigint NOT NULL,
	"medio" "medio_pago" NOT NULL,
	"monetary_account_id" uuid,
	"cash_session_id" uuid,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"cobrado_por_id" uuid NOT NULL,
	"saldo_resultante_centavos" bigint NOT NULL,
	"nota" text,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "credit_payments_monto_ck" CHECK ("credit_payments"."monto_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_account_id" uuid NOT NULL,
	"sale_id" uuid,
	"descripcion" text,
	"monto_financiado_centavos" bigint NOT NULL,
	"anticipo_centavos" bigint DEFAULT 0 NOT NULL,
	"recargo_centavos" bigint DEFAULT 0 NOT NULL,
	"cantidad_cuotas" integer NOT NULL,
	"total_a_pagar_centavos" bigint NOT NULL,
	"origen" "origen_cuenta_corriente" DEFAULT 'sistema' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_plans_cuotas_ck" CHECK ("credit_plans"."cantidad_cuotas" > 0)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"dni" text,
	"telefono" text,
	"telefono_raw" text,
	"email" text,
	"direccion" text,
	"notas" text,
	"woo_customer_id" integer,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"vigente_desde" timestamp with time zone NOT NULL,
	"origen" "origen_cotizacion" NOT NULL,
	"cargado_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_valor_ck" CHECK ("exchange_rates"."valor_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "expense_categories_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "expense_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"cantidad" integer NOT NULL,
	"costo_unitario_centavos" bigint NOT NULL,
	CONSTRAINT "expense_items_cantidad_ck" CHECK ("expense_items"."cantidad" > 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fecha" date NOT NULL,
	"category_id" uuid NOT NULL,
	"payee_id" uuid,
	"descripcion" text NOT NULL,
	"monto_centavos" bigint NOT NULL,
	"moneda" "moneda" DEFAULT 'ARS' NOT NULL,
	"tc_aplicado_centavos" bigint,
	"medio" "medio_pago",
	"monetary_account_id" uuid,
	"cash_session_id" uuid,
	"estado" "estado_gasto" DEFAULT 'pagado' NOT NULL,
	"vencimiento" date,
	"comprobante_url" text,
	"recurrente_id" uuid,
	"cargado_por_id" uuid NOT NULL,
	"pagado_en" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_monto_ck" CHECK ("expenses"."monto_centavos" > 0),
	CONSTRAINT "expenses_pagado_ck" CHECK (("expenses"."estado" <> 'pagado') OR ("expenses"."monetary_account_id" IS NOT NULL AND "expenses"."medio" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"monto_centavos" bigint NOT NULL,
	"vencimiento" date NOT NULL,
	"estado" "estado_cuota" DEFAULT 'pendiente' NOT NULL,
	"pagado_centavos" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "installments_plan_numero_uq" UNIQUE("plan_id","numero")
);
--> statement-breakpoint
CREATE TABLE "legacy_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origen" text DEFAULT 'yith' NOT NULL,
	"referencia_externa" text NOT NULL,
	"fecha" timestamp with time zone NOT NULL,
	"total_centavos" bigint NOT NULL,
	"medio_pago" text,
	"cliente" text,
	"detalle" jsonb,
	"sin_producto" boolean DEFAULT false NOT NULL,
	"importado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monetary_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_cuenta_monetaria" NOT NULL,
	"saldo_centavos" bigint DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_beneficiario" DEFAULT 'otro' NOT NULL,
	"telefono" text,
	"cuit" text,
	"notas" text,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"woo_id" integer,
	"sku" text,
	"nombre" text NOT NULL,
	"atributos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"precio_centavos" bigint DEFAULT 0 NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"codigo_barras" text,
	"activo" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"woo_id" integer,
	"sku" text,
	"nombre" text NOT NULL,
	"marca" text,
	"categoria" text,
	"tipo" "tipo_producto" DEFAULT 'simple' NOT NULL,
	"precio_centavos" bigint DEFAULT 0 NOT NULL,
	"moneda" "moneda" DEFAULT 'ARS' NOT NULL,
	"precio_usd_centavos" bigint,
	"costo_centavos" bigint,
	"stock" integer DEFAULT 0 NOT NULL,
	"stock_comprometido" integer DEFAULT 0 NOT NULL,
	"gestiona_stock" boolean DEFAULT true NOT NULL,
	"codigo_barras" text,
	"imagen_url" text,
	"activo" boolean DEFAULT true NOT NULL,
	"es_servicio" boolean DEFAULT false NOT NULL,
	"precio_editable" boolean DEFAULT false NOT NULL,
	"ficha_incompleta" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_precio_ck" CHECK ("products"."precio_centavos" >= 0),
	CONSTRAINT "products_usd_ck" CHECK (("products"."moneda" <> 'USD') OR ("products"."precio_usd_centavos" IS NOT NULL AND "products"."precio_usd_centavos" > 0))
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"payee_id" uuid,
	"descripcion" text NOT NULL,
	"monto_centavos" bigint NOT NULL,
	"moneda" "moneda" DEFAULT 'ARS' NOT NULL,
	"periodicidad" "periodicidad" DEFAULT 'mensual' NOT NULL,
	"dia_del_mes" integer DEFAULT 1 NOT NULL,
	"avisar_dias_antes" integer DEFAULT 3 NOT NULL,
	"proxima_generacion" date NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"descripcion" text NOT NULL,
	"cantidad" integer NOT NULL,
	"precio_unitario_centavos" bigint NOT NULL,
	"moneda_original" "moneda" DEFAULT 'ARS' NOT NULL,
	"precio_usd_centavos" bigint,
	"descuento_centavos" bigint DEFAULT 0 NOT NULL,
	"costo_centavos" bigint,
	"total_centavos" bigint NOT NULL,
	CONSTRAINT "sale_items_cantidad_ck" CHECK ("sale_items"."cantidad" > 0),
	CONSTRAINT "sale_items_precio_ck" CHECK ("sale_items"."precio_unitario_centavos" >= 0),
	CONSTRAINT "sale_items_descuento_ck" CHECK ("sale_items"."descuento_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"medio" "medio_pago" NOT NULL,
	"monetary_account_id" uuid,
	"monto_centavos" bigint NOT NULL,
	"marca_tarjeta" text,
	"cuotas" integer,
	"ultimos4" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_payments_monto_ck" CHECK ("sale_payments"."monto_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"terminal" text NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"vendedor_id" uuid NOT NULL,
	"cliente_id" uuid,
	"cash_session_id" uuid,
	"canal" "canal_venta" DEFAULT 'local' NOT NULL,
	"estado" "estado_venta" DEFAULT 'completed' NOT NULL,
	"tipo" "tipo_venta" DEFAULT 'contado' NOT NULL,
	"subtotal_centavos" bigint NOT NULL,
	"descuento_centavos" bigint DEFAULT 0 NOT NULL,
	"total_centavos" bigint NOT NULL,
	"tc_aplicado_centavos" bigint,
	"idempotency_key" text NOT NULL,
	"synced_to_woo" boolean DEFAULT false NOT NULL,
	"woo_order_id" integer,
	"nota" text,
	"anula_venta_id" uuid,
	"motivo_anulacion" text,
	"autorizada_por_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_total_ck" CHECK ("sales"."total_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"clave" text PRIMARY KEY NOT NULL,
	"valor" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"tipo" "tipo_movimiento_stock" NOT NULL,
	"cantidad" integer NOT NULL,
	"stock_resultante" integer NOT NULL,
	"motivo" text,
	"usuario_id" uuid,
	"referencia_tipo" text,
	"referencia_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_cantidad_ck" CHECK ("stock_movements"."cantidad" <> 0)
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"stock_pos" integer NOT NULL,
	"stock_woo" integer NOT NULL,
	"detalle" jsonb,
	"detectado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"resuelto_en" timestamp with time zone,
	"resolucion" text,
	"resuelto_por_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sync_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operacion" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"estado" "estado_sync" DEFAULT 'pendiente' NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"proximo_intento" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"email" text,
	"password_hash" text,
	"pin_hash" text,
	"rol" "rol" DEFAULT 'seller' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_usuario_id_users_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_monetary_account_id_monetary_accounts_id_fk" FOREIGN KEY ("monetary_account_id") REFERENCES "public"."monetary_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_usuario_id_users_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_monetary_account_id_monetary_accounts_id_fk" FOREIGN KEY ("monetary_account_id") REFERENCES "public"."monetary_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_abierta_por_id_users_id_fk" FOREIGN KEY ("abierta_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_cerrada_por_id_users_id_fk" FOREIGN KEY ("cerrada_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_payment_allocations" ADD CONSTRAINT "cpa_pago_fk" FOREIGN KEY ("credit_payment_id") REFERENCES "public"."credit_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_payment_allocations" ADD CONSTRAINT "cpa_cuota_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_credit_account_id_credit_accounts_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_monetary_account_id_monetary_accounts_id_fk" FOREIGN KEY ("monetary_account_id") REFERENCES "public"."monetary_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_cobrado_por_id_users_id_fk" FOREIGN KEY ("cobrado_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_plans" ADD CONSTRAINT "credit_plans_credit_account_id_credit_accounts_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_plans" ADD CONSTRAINT "credit_plans_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_cargado_por_users_id_fk" FOREIGN KEY ("cargado_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_monetary_account_id_monetary_accounts_id_fk" FOREIGN KEY ("monetary_account_id") REFERENCES "public"."monetary_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurrente_id_recurring_expenses_id_fk" FOREIGN KEY ("recurrente_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cargado_por_id_users_id_fk" FOREIGN KEY ("cargado_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_plan_id_credit_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."credit_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_monetary_account_id_monetary_accounts_id_fk" FOREIGN KEY ("monetary_account_id") REFERENCES "public"."monetary_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_vendedor_id_users_id_fk" FOREIGN KEY ("vendedor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cliente_id_customers_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_autorizada_por_id_users_id_fk" FOREIGN KEY ("autorizada_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_usuario_id_users_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resuelto_por_id_users_id_fk" FOREIGN KEY ("resuelto_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entidad_idx" ON "audit_log" USING btree ("entidad","entidad_id");--> statement-breakpoint
CREATE INDEX "audit_log_fecha_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_usuario_idx" ON "audit_log" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "cash_movements_sesion_idx" ON "cash_movements" USING btree ("cash_session_id");--> statement-breakpoint
CREATE INDEX "cash_movements_cuenta_idx" ON "cash_movements" USING btree ("monetary_account_id");--> statement-breakpoint
CREATE INDEX "cash_movements_fecha_idx" ON "cash_movements" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_abierta_uq" ON "cash_sessions" USING btree ("terminal") WHERE "cash_sessions"."cerrada_en" IS NULL;--> statement-breakpoint
CREATE INDEX "credit_payment_allocations_pago_idx" ON "credit_payment_allocations" USING btree ("credit_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_payments_idempotency_uq" ON "credit_payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_payments_cuenta_idx" ON "credit_payments" USING btree ("credit_account_id");--> statement-breakpoint
CREATE INDEX "credit_plans_cuenta_idx" ON "credit_plans" USING btree ("credit_account_id");--> statement-breakpoint
CREATE INDEX "customers_nombre_idx" ON "customers" USING btree ("nombre");--> statement-breakpoint
CREATE INDEX "customers_telefono_idx" ON "customers" USING btree ("telefono");--> statement-breakpoint
CREATE INDEX "customers_dni_idx" ON "customers" USING btree ("dni");--> statement-breakpoint
CREATE INDEX "exchange_rates_vigente_idx" ON "exchange_rates" USING btree ("vigente_desde");--> statement-breakpoint
CREATE INDEX "expense_items_gasto_idx" ON "expense_items" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "expenses_fecha_idx" ON "expenses" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "expenses_categoria_idx" ON "expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "expenses_payee_idx" ON "expenses" USING btree ("payee_id");--> statement-breakpoint
CREATE INDEX "expenses_estado_idx" ON "expenses" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "installments_vencimiento_idx" ON "installments" USING btree ("vencimiento");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_sales_referencia_uq" ON "legacy_sales" USING btree ("origen","referencia_externa");--> statement-breakpoint
CREATE INDEX "legacy_sales_fecha_idx" ON "legacy_sales" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "payees_nombre_idx" ON "payees" USING btree ("nombre");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_woo_id_uq" ON "product_variants" USING btree ("woo_id");--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_variants_codigo_barras_idx" ON "product_variants" USING btree ("codigo_barras");--> statement-breakpoint
CREATE UNIQUE INDEX "products_woo_id_uq" ON "products" USING btree ("woo_id");--> statement-breakpoint
CREATE INDEX "products_sku_idx" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "products_codigo_barras_idx" ON "products" USING btree ("codigo_barras");--> statement-breakpoint
CREATE INDEX "products_nombre_idx" ON "products" USING btree ("nombre");--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_product_idx" ON "sale_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sale_payments_sale_idx" ON "sale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_numero_uq" ON "sales" USING btree ("numero");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_idempotency_uq" ON "sales" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sales_fecha_idx" ON "sales" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "sales_cliente_idx" ON "sales" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "sales_vendedor_idx" ON "sales" USING btree ("vendedor_id");--> statement-breakpoint
CREATE INDEX "sales_canal_idx" ON "sales" USING btree ("canal");--> statement-breakpoint
CREATE INDEX "stock_movements_product_idx" ON "stock_movements" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_fecha_idx" ON "stock_movements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sync_conflicts_abiertos_idx" ON "sync_conflicts" USING btree ("resuelto_en");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_queue_idempotency_uq" ON "sync_queue" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sync_queue_pendientes_idx" ON "sync_queue" USING btree ("estado","proximo_intento");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");