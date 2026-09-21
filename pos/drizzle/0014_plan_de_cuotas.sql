-- El fiado en cuotas: cuándo se paga cada parte.
--
-- Hasta acá el fiado era un saldo abierto: el cliente debía $80.000 y se le
-- cobraba «cuando pudiera». Funciona para el fiado de barrio de $5.000, pero no
-- para un celular de $400.000 en seis pagos, que es lo que el local vende de
-- verdad. Sin fechas no hay forma de saber quién está atrasado, y sin eso el
-- recordatorio de WhatsApp le dice lo mismo al que paga puntual y al que debe
-- desde marzo.
--
-- Las tablas ya existían desde el esquema inicial —`credit_plans` e
-- `installments`, con su imputación— y nunca se habían usado. Lo que falta es
-- poco, y es esto:
--
--  * `frecuencia`  cada cuánto vence una cuota. Se guarda en el plan para poder
--                  decirlo en pantalla y en el mensaje («cada 15 días») sin
--                  tener que deducirlo restando fechas.
--  * `anulado_en`  un plan de una venta anulada no desaparece: se marca. Las
--                  cuotas ya cobradas tienen imputaciones que apuntan a ellas y
--                  borrarlas dejaría la cadena rota (D29: se anula, no se
--                  borra).
--
-- Y dos tipos de mensaje nuevos, para que el recordatorio diga algo distinto
-- según el estado: el que tiene una cuota vencida no lee lo mismo que el que
-- tiene una que vence el viernes.
ALTER TABLE credit_plans ADD COLUMN IF NOT EXISTS frecuencia text;
--> statement-breakpoint
ALTER TABLE credit_plans ADD COLUMN IF NOT EXISTS anulado_en timestamptz;
--> statement-breakpoint
ALTER TABLE credit_plans
  ADD CONSTRAINT credit_plans_frecuencia_ck
  CHECK (frecuencia IS NULL OR frecuencia IN ('semanal', 'quincenal', 'mensual'));
--> statement-breakpoint
-- Las cuotas de un plan anulado no se buscan más, y las del día se buscan todos
-- los días: el índice va por plan y por vencimiento.
CREATE INDEX IF NOT EXISTS installments_plan_idx ON installments (plan_id);
--> statement-breakpoint
ALTER TYPE tipo_mensaje ADD VALUE IF NOT EXISTS 'recordatorio_cuota';
--> statement-breakpoint
ALTER TYPE tipo_mensaje ADD VALUE IF NOT EXISTS 'recordatorio_atrasado';
