CREATE TABLE "pending_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"monto_centavos" bigint NOT NULL,
	"motivo" text,
	"creado_por_id" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"resuelto_en" timestamp with time zone,
	"resuelto_por_id" uuid,
	"nota_resolucion" text,
	CONSTRAINT "pending_refunds_monto_ck" CHECK ("pending_refunds"."monto_centavos" > 0)
);
--> statement-breakpoint
ALTER TABLE "pending_refunds" ADD CONSTRAINT "pending_refunds_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_refunds" ADD CONSTRAINT "pending_refunds_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_refunds" ADD CONSTRAINT "pending_refunds_creado_por_id_users_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_refunds" ADD CONSTRAINT "pending_refunds_resuelto_por_id_users_id_fk" FOREIGN KEY ("resuelto_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_refunds_cliente_idx" ON "pending_refunds" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "pending_refunds_pendientes_idx" ON "pending_refunds" USING btree ("creado_en") WHERE "pending_refunds"."resuelto_en" IS NULL;