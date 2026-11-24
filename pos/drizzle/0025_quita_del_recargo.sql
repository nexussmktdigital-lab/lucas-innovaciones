-- El recargo por financiar que se le saca al que paga antes.
--
-- El caso que lo pidió: un cliente se llevó un teléfono en dos cuotas, con su
-- recargo por financiar, y a los dos días pagó todo junto. El recargo ya no
-- corresponde —no financió nada— pero la deuda lo seguía incluyendo, así que
-- después de pagar el precio de contado le quedaba debiendo exactamente el
-- recargo.
--
-- Se anota en la venta y no en una tabla aparte porque es un dato DE esa
-- venta: cuánto de su recargo se perdonó. Tenerlo acá es lo que permite
-- ofrecer la quita una sola vez y por lo que de verdad queda.
ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "recargo_quitado_centavos" bigint DEFAULT 0 NOT NULL;

--> statement-breakpoint

-- No se puede perdonar menos que nada ni más de lo que se cobró de recargo.
ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_recargo_quitado_ck";

--> statement-breakpoint

ALTER TABLE "sales" ADD CONSTRAINT "sales_recargo_quitado_ck"
  CHECK ("recargo_quitado_centavos" >= 0
         AND "recargo_quitado_centavos" <= "recargo_financiacion_centavos");

--> statement-breakpoint

-- En qué moneda está el cargo.
--
-- Hasta acá todos los cargos eran en pesos —la libreta de papel y la
-- mercadería devuelta— y la columna no hacía falta. La quita del recargo sí:
-- lo que se vende en dólares se debe en dólares (D62), y un teléfono
-- financiado en dólares tiene su recargo en dólares. Sin esto, perdonarle
-- US$ 40 descontaría cuarenta pesos de la deuda equivocada.
--
-- El default deja en pesos todo lo que ya está cargado, que es lo que son.
ALTER TABLE "credit_charges"
  ADD COLUMN IF NOT EXISTS "moneda" "moneda" DEFAULT 'ARS' NOT NULL;

--> statement-breakpoint

-- Qué es cada cargo, dicho y no deducido del signo.
--
-- La tabla ya guarda tres hechos distintos: la compra de la libreta de papel,
-- la mercadería que el cliente devuelve y ahora el recargo que se le perdona.
-- Hasta acá se distinguían por el signo del monto, y eso alcanzaba mientras
-- hubo dos. Con tres, el negativo dejó de significar una sola cosa: la ficha
-- mostraba la quita del recargo con un «Ver qué devolvió» debajo.
--
-- El signo sigue siendo el que manda sobre la deuda; esto dice de qué se trata.
ALTER TABLE "credit_charges"
  ADD COLUMN IF NOT EXISTS "tipo" text DEFAULT 'compra' NOT NULL;

--> statement-breakpoint

-- Lo ya cargado: positivo es compra, negativo es mercadería devuelta, que es
-- lo único negativo que existía antes de esta migración.
UPDATE "credit_charges" SET "tipo" = 'devolucion'
  WHERE "monto_centavos" < 0 AND "tipo" = 'compra';

--> statement-breakpoint

ALTER TABLE "credit_charges" DROP CONSTRAINT IF EXISTS "credit_charges_tipo_ck";

--> statement-breakpoint

-- El tipo y el signo no pueden contradecirse: una compra suma, lo demás resta.
ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_tipo_ck"
  CHECK (("tipo" = 'compra' AND "monto_centavos" > 0)
      OR ("tipo" IN ('devolucion', 'quita_recargo') AND "monto_centavos" < 0));
