CREATE TYPE "public"."tipo_mensaje" AS ENUM('comprobante', 'recordatorio_fiado');--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "tipo_mensaje" NOT NULL,
	"customer_id" uuid,
	"telefono" text NOT NULL,
	"texto" text NOT NULL,
	"referencia_tipo" text,
	"referencia_id" uuid,
	"preparado_por_id" uuid,
	"preparado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_preparado_por_id_users_id_fk" FOREIGN KEY ("preparado_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_messages_cliente_idx" ON "whatsapp_messages" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_fecha_idx" ON "whatsapp_messages" USING btree ("preparado_en");