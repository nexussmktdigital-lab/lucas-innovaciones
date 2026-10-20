-- Gastos en dólares, y los datos del cheque con el que se pagó.
--
-- **Dólares.** Los pagos a proveedores de iPhone se hacen en dólares, y hasta
-- hoy había que convertirlos a mano antes de cargarlos: el gasto quedaba en
-- pesos a la cotización que quien cargaba recordara, y seis meses después no
-- había forma de saber cuántos dólares habían salido de verdad.
--
-- Las columnas `moneda` y `tc_aplicado_centavos` ya existían en la tabla desde
-- el principio y **ningún código las usaba**: estaban previstas y nunca
-- cableadas. Falta la tercera, que es la que hace que el dato sirva.
--
-- `monto_centavos` sigue siendo SIEMPRE pesos, como en `sale_payments`: es lo
-- que suman los reportes y el resumen del mes, y guardar dólares ahí haría que
-- el total del mes sumara dos monedas. Los pesos de un gasto en dólares se
-- congelan con la cotización del día —`tc_aplicado_centavos`— y no se
-- recalculan nunca: un gasto de marzo no cambia de monto porque hoy el dólar
-- esté a otro precio.
ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "monto_usd_centavos" bigint;

--> statement-breakpoint

-- Un gasto en dólares trae los dólares y su cotización, y ninguno más los
-- trae. Sin los dos juntos el dato no se puede reconstruir: con los dólares
-- solos no se sabe a cuánto se pagó, y con la cotización sola no se sabe
-- cuántos dólares fueron.
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_dolares_ck";

--> statement-breakpoint

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_dolares_ck"
  CHECK (
    ("moneda" = 'USD') =
    ("monto_usd_centavos" IS NOT NULL AND "tc_aplicado_centavos" IS NOT NULL)
  );

--> statement-breakpoint

ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_monto_usd_ck";

--> statement-breakpoint

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_monto_usd_ck"
  CHECK ("monto_usd_centavos" IS NULL OR "monto_usd_centavos" > 0);

--> statement-breakpoint

-- **Cheque.** El local paga a proveedores endosando cheques que recibió de
-- clientes. Lo que hace falta anotar es el número y de quién vino: a quién se
-- le pagó ya está en `payee_id`, así que ese dato no agrega nada.
--
-- Van como texto libre y no como referencia a un cliente: el cheque puede
-- venir de alguien que no está en la base, y frenar la carga de un gasto para
-- dar de alta un cliente que no compró nada sería un trámite sin sentido.
ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "cheque_numero" text;

--> statement-breakpoint

ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "cheque_recibido_de" text;

--> statement-breakpoint

-- Los datos del cheque solo cuelgan de un pago con cheque.
--
-- No se exigen —el número puede no estar a mano cuando se carga— pero no
-- pueden quedar colgados de una transferencia: ahí no significan nada y el
-- día que alguien los lea van a mentir. `'cheque'` es un valor que el enum
-- tiene desde el principio, así que se lo puede nombrar sin castear.
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_cheque_ck";

--> statement-breakpoint

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cheque_ck"
  CHECK (
    ("cheque_numero" IS NULL AND "cheque_recibido_de" IS NULL)
    OR "medio" = 'cheque'
  );
