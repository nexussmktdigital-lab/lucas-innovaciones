-- Los pagos que ya estaban hechos cuando el cliente entró al sistema.
--
-- Un cliente que venía de la libreta trae meses de entregas. Hasta ahora solo
-- se podía cargar su saldo: las entregas se perdían, y con ellas la respuesta
-- a «¿cuándo pagó la última vez?», que es la pregunta que se hace cuando hay
-- que reclamarle.
--
-- Se marcan porque no son plata que entró por la caja de hoy: ocurrieron antes
-- y fuera del sistema. Sin la marca, el reporte del mes en que cayeron las
-- contaría como ingresos que ninguna sesión de caja respalda.
ALTER TABLE "credit_payments" ADD COLUMN "migrado" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Un pago migrado no pasó por la caja; uno de verdad, sí.
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_migrado_ck"
  CHECK (NOT "migrado" OR ("cash_session_id" IS NULL AND "monetary_account_id" IS NULL));
