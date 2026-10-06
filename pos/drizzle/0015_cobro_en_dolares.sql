-- Cobrar en billetes de dólar, con su propio cajón.
--
-- El local vende iPhones usados y cobra parte en dólares en efectivo. Hasta acá
-- `dolares` existía como medio de pago en el enum y en el dominio, pero no en la
-- pantalla de cobro, y arrastraba un error latente: `tipoDeCuentaPara('dolares')`
-- devolvía `'efectivo'`, o sea que los billetes verdes entraban al cajón de
-- pesos. Mil dólares se habrían sumado como mil pesos.
--
-- Lo que falta es esto:
--
--  * un tipo de cuenta `dolares`, para que el cajón de los verdes sea una cuenta
--    aparte. Su saldo está en CENTAVOS DE DÓLAR, no de peso: son billetes, y
--    guardarlos convertidos haría que el saldo se mueva solo cada vez que cambia
--    la cotización, sin que entre ni salga un dólar.
--
--  * en cada pago, cuántos dólares entraron y con qué cotización. Son dos hechos
--    distintos: lo que el cliente entregó (mil dólares) y lo que eso valía ese
--    día. El monto en pesos ya estaba y sigue siendo el que suma contra el total
--    de la venta; sin los otros dos, el día que se mueve el dólar ya no se puede
--    saber cuántos billetes habían entrado.
--
-- Las dos columnas nuevas van juntas o no van: el check las ata al medio de pago
-- para que un cobro en dólares sin el dato no pueda quedar registrado como un
-- pago en pesos cualquiera, que es justo como el cajón de dólares se quedaría sin
-- enterarse.

ALTER TYPE "public"."tipo_cuenta_monetaria" ADD VALUE IF NOT EXISTS 'dolares' BEFORE 'otro';--> statement-breakpoint

ALTER TABLE "sale_payments" ADD COLUMN IF NOT EXISTS "monto_usd_centavos" bigint;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD COLUMN IF NOT EXISTS "cotizacion_centavos" bigint;--> statement-breakpoint

ALTER TABLE "sale_payments" DROP CONSTRAINT IF EXISTS "sale_payments_dolares_ck";--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_dolares_ck" CHECK (("sale_payments"."medio" = 'dolares') = ("sale_payments"."monto_usd_centavos" IS NOT NULL AND "sale_payments"."cotizacion_centavos" IS NOT NULL));--> statement-breakpoint

ALTER TABLE "sale_payments" DROP CONSTRAINT IF EXISTS "sale_payments_usd_positivo_ck";--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_usd_positivo_ck" CHECK ("sale_payments"."monto_usd_centavos" IS NULL OR "sale_payments"."monto_usd_centavos" > 0);
