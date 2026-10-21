-- Recargos: lo que se cobra de más, y por qué.
--
-- Son tres casos distintos que el local cobra todos los días y que hasta hoy
-- se resolvían subiendo el precio a mano, sin que quedara dicho en ningún lado
-- que ese número no era el precio del producto:
--
--  1. **Pagar con cheque** tiene un costo y el local lo cobra. Sube lo que se
--     factura: el cliente paga más por la misma mercadería.
--  2. **Fiar «cuando pueda»** —sin fechas— también se cobra. No sube la venta,
--     sube la deuda, igual que el recargo de un plan de cuotas.
--  3. **Pagar una cuota con cheque, o pagarla tarde.** No baja más la deuda
--     por eso: es plata aparte que entra a la caja.
--
-- En los tres se guarda **el monto**, no el porcentaje con el que se calculó:
-- el porcentaje es una forma de escribirlo y el monto es el hecho. Guardar el
-- porcentaje obligaría a recalcular para leer un papel viejo, y el día que
-- alguien cambie el redondeo, los comprobantes firmados dejarían de coincidir
-- con lo que el sistema dice.

-- **Caso 1: el cheque en una venta.**
--
-- Suma al total, así que `total = subtotal − descuento + recargo`. Tiene que
-- sumar ahí y no quedar aparte: los pagos de una venta suman exactamente su
-- total, y un cheque escrito por más que el total se leería como vuelto.
ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "recargo_centavos" bigint DEFAULT 0 NOT NULL;

--> statement-breakpoint

ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_recargo_ck";

--> statement-breakpoint

ALTER TABLE "sales" ADD CONSTRAINT "sales_recargo_ck"
  CHECK ("recargo_centavos" >= 0);

--> statement-breakpoint

-- **Caso 2: el recargo por fiar.**
--
-- No suma al total de la venta —el comprobante del cliente lleva el precio del
-- producto y nada de la deuda— y por eso va en su propia columna y no en la de
-- arriba. Suma a lo que el cliente queda debiendo.
--
-- Cuando se pactó un plan de cuotas, el mismo número vive además en
-- `credit_plans.recargo_centavos`, que es de donde salen las cuotas. Acá se
-- guarda igual para que el acuerdo de pago de un fiado SIN plan —el «cuando
-- pueda», que no tiene fila en `credit_plans`— se pueda reimprimir con el
-- desglose que el cliente firmó, y no solo con el total.
ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "recargo_financiacion_centavos" bigint DEFAULT 0 NOT NULL;

--> statement-breakpoint

ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_recargo_financiacion_ck";

--> statement-breakpoint

ALTER TABLE "sales" ADD CONSTRAINT "sales_recargo_financiacion_ck"
  CHECK ("recargo_financiacion_centavos" >= 0);

--> statement-breakpoint

-- **Caso 3: el recargo al cobrar una cuota.**
--
-- Va en la moneda de la deuda, igual que `monto_centavos`: una cuota en
-- dólares con recargo se negocia en dólares. Lo que entra a la caja son los
-- dos juntos, convertidos de la misma forma.
--
-- **No baja la deuda.** El cliente entrega monto + recargo y la cuenta baja
-- solo por el monto: si el recargo descontara deuda no sería un recargo, sería
-- un descuento sobre el pago.
ALTER TABLE "credit_payments"
  ADD COLUMN IF NOT EXISTS "recargo_centavos" bigint DEFAULT 0 NOT NULL;

--> statement-breakpoint

-- Por qué se cobró. Texto con CHECK y no un enum nuevo: un valor de enum
-- recién creado no se puede nombrar en la misma transacción que lo creó, y
-- todas las migraciones pendientes corren juntas en una.
ALTER TABLE "credit_payments"
  ADD COLUMN IF NOT EXISTS "recargo_motivo" text;

--> statement-breakpoint

ALTER TABLE "credit_payments" DROP CONSTRAINT IF EXISTS "credit_payments_recargo_ck";

--> statement-breakpoint

-- Hay recargo si y solo si hay motivo. Un recargo sin motivo es un número que
-- dentro de seis meses nadie puede explicarle al cliente que lo reclama, y un
-- motivo sin recargo es un campo que quedó de un intento anterior.
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_recargo_ck"
  CHECK (
    ("recargo_centavos" > 0) = ("recargo_motivo" IS NOT NULL)
    AND "recargo_centavos" >= 0
    AND ("recargo_motivo" IS NULL OR "recargo_motivo" IN ('cheque', 'demora', 'otro'))
  );
