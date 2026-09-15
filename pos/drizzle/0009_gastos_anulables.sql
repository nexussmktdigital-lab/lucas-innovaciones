ALTER TYPE "public"."estado_gasto" ADD VALUE 'anulado';--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "motivo_anulacion" text;