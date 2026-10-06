-- Lo que se vende en dólares se debe en dólares (D62).
--
-- El comprobante de un iPhone dice «3 cuotas de US$ 200» porque así se pactó. Si
-- el sistema guardaba esa cuota convertida a pesos del día de la venta, el papel
-- y la base se separaban en la primera corrida del dólar: con el dólar a $1.571
-- la cuota entraba como $314.200, y cuando el cliente venía con el dólar a
-- $1.800 debía $360.000 según el papel y $314.200 según el sistema. Cuarenta y
-- cinco mil pesos de diferencia en UNA cuota, y el sistema diciéndole «pagaste
-- todo» cuando faltaba.
--
-- Dos columnas:
--
--  * `credit_plans.moneda`: en qué moneda está el plan. La fija la venta. Los
--    montos del plan y de sus cuotas están siempre en ESA moneda, así que toda
--    lectura de una cuota pasa por su plan. Los planes que ya existen quedan en
--    ARS, que es lo que son.
--
--  * `credit_accounts.saldo_usd_centavos`: la deuda en dólares, aparte de la de
--    pesos. **No se suman nunca.** Un cliente que compró un iPhone y una funda
--    debe US$ 400 y $20.000, y son dos deudas: juntarlas obligaría a elegir una
--    cotización y haría que el total cambie solo todos los días.
--
-- El tope de fiado sigue siendo en pesos y se aplica a la deuda en pesos. Poner
-- un tope en dólares es otra decisión y no se toma acá.

ALTER TABLE "credit_accounts" ADD COLUMN IF NOT EXISTS "saldo_usd_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_plans" ADD COLUMN IF NOT EXISTS "moneda" "moneda" DEFAULT 'ARS' NOT NULL;--> statement-breakpoint

ALTER TABLE "credit_accounts" DROP CONSTRAINT IF EXISTS "credit_accounts_saldo_usd_ck";--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_saldo_usd_ck" CHECK ("credit_accounts"."saldo_usd_centavos" >= 0);
--> statement-breakpoint

-- Y del lado del cobro: a qué deuda se le imputó, cuánto se movió de caja de
-- verdad cuando la moneda del pago no era la de la deuda, y con qué cotización
-- se cruzaron. Pagar una cuota de US$ 200 con una transferencia en pesos son
-- dos números —los dólares que se cancelan y los pesos que entraron al banco— y
-- guardar solo uno deja el otro sin forma de reconstruirse.

ALTER TABLE "credit_payments" ADD COLUMN IF NOT EXISTS "moneda_deuda" "moneda" DEFAULT 'ARS' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_payments" ADD COLUMN IF NOT EXISTS "monto_caja_centavos" bigint;--> statement-breakpoint
ALTER TABLE "credit_payments" ADD COLUMN IF NOT EXISTS "cotizacion_centavos" bigint;
