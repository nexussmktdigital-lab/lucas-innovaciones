-- El fiado se pacta en el momento: «cada N días».
--
-- El plan de cuotas ofrecía tres frecuencias —semanal, quincenal, mensual— y el
-- mostrador pacta otras cosas: «cada tres días» con el que cobra por semana pero
-- paga de a poco, «cada dos meses» con el que cobra un aguinaldo. Con tres
-- opciones, quien vendía elegía la que menos mentía y después lo arreglaba de
-- palabra, que es exactamente lo que el sistema vino a sacar del cuaderno.
--
-- Se agrega `dias` como cuarta frecuencia, con su número al lado.
--
-- **`mensual` sigue existiendo aparte, y no es un atajo de 30 días.** Va por
-- calendario: si compró un 5, paga los 5. Escrito como 30 días, en un año se le
-- corre casi una semana y el cliente deja de reconocer su fecha. Por eso el
-- check ata el número a `dias` y se lo prohíbe a los otros tres: un `mensual`
-- con un 30 al lado invita a que alguien lo lea y le crea.
--
-- Los planes que ya existen no se tocan: su frecuencia sigue siendo una de las
-- tres de siempre y su `frecuencia_dias` queda en nulo, que es lo que el check
-- pide para ellos.

ALTER TABLE "credit_plans" ADD COLUMN IF NOT EXISTS "frecuencia_dias" integer;--> statement-breakpoint

ALTER TABLE "credit_plans" DROP CONSTRAINT IF EXISTS "credit_plans_frecuencia_ck";--> statement-breakpoint
ALTER TABLE "credit_plans" ADD CONSTRAINT "credit_plans_frecuencia_ck" CHECK ("credit_plans"."frecuencia" IS NULL OR "credit_plans"."frecuencia" IN ('semanal', 'quincenal', 'mensual', 'dias'));--> statement-breakpoint

ALTER TABLE "credit_plans" DROP CONSTRAINT IF EXISTS "credit_plans_frecuencia_dias_ck";--> statement-breakpoint
ALTER TABLE "credit_plans" ADD CONSTRAINT "credit_plans_frecuencia_dias_ck" CHECK (("credit_plans"."frecuencia" = 'dias') = ("credit_plans"."frecuencia_dias" IS NOT NULL) AND ("credit_plans"."frecuencia_dias" IS NULL OR ("credit_plans"."frecuencia_dias" >= 1 AND "credit_plans"."frecuencia_dias" <= 365)));
