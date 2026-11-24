-- El cliente cambia un producto por otro.
--
-- Pasa todas las semanas en el mostrador: se lleva el derivador equivocado y
-- vuelve a los dos días a cambiarlo por el que iba. Hasta acá eran dos
-- operaciones sueltas —devolver y volver a vender— y nada las ataba: si alguien
-- hacía la primera y se olvidaba de la segunda, el stock y la plata quedaban
-- mal y no había dónde verlo.
--
-- El cambio es UN hecho y se registra como tal. Adentro siguen siendo las dos
-- mitades de siempre, porque son las correctas: la devolución devuelve lo que
-- vino y la venta nueva registra lo que se llevó, así el reporte por producto
-- dice la verdad sobre los dos. Lo que cambia es que ahora van juntas, en una
-- transacción, y la plata se mueve UNA sola vez: por la diferencia.

-- Lo que la devolución no devolvió en plata ni descontó de la deuda, porque se
-- fue en mercadería. El total de una devolución es la suma de los tres.
ALTER TABLE "returns"
  ADD COLUMN IF NOT EXISTS "a_cambio_centavos" bigint DEFAULT 0 NOT NULL;

--> statement-breakpoint

-- El medio de pago del cambio: paga con lo que trajo.
--
-- No mueve ninguna cuenta, igual que el canje y que la cuenta corriente.
-- Cargarlo como efectivo dejaría el cajón con una plata que nadie entregó.
ALTER TYPE "medio_pago" ADD VALUE IF NOT EXISTS 'cambio';

--> statement-breakpoint

-- De qué devolución sale ese pago.
--
-- Es la guarda del asunto, la misma idea que `sale_payments_canje_ck`: sin
-- esto se puede grabar un pago «en cambio» contra nada, que es un descuento
-- disfrazado que no deja ni plata ni mercadería, y el agujero recién se ve al
-- cerrar el mes.
ALTER TABLE "sale_payments"
  ADD COLUMN IF NOT EXISTS "return_id" uuid REFERENCES "returns"("id");

--> statement-breakpoint

ALTER TABLE "sale_payments" DROP CONSTRAINT IF EXISTS "sale_payments_cambio_ck";

--> statement-breakpoint

-- Compara `medio::text` y no `medio` por lo mismo que el check del canje:
-- PostgreSQL no deja usar un valor nuevo de enum hasta que se confirma la
-- transacción que lo creó, y las migraciones corren todas juntas en una.
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_cambio_ck"
  CHECK (("medio"::text = 'cambio') = ("return_id" IS NOT NULL));

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sale_payments_return_idx" ON "sale_payments" ("return_id");


--> statement-breakpoint

-- La invariante de la devolución, con el tercer destino.
--
-- Era `devuelto + descontado_de_deuda = total`, y la base la hizo respetar:
-- el primer cambio de producto rebotó contra ella. Ahora lo devuelto puede
-- irse por tres caminos —el cajón, la deuda del cliente, o la mercadería que
-- se lleva— y los tres tienen que sumar exactamente lo que valía.
ALTER TABLE "returns" DROP CONSTRAINT IF EXISTS "returns_suma_ck";

--> statement-breakpoint

ALTER TABLE "returns" ADD CONSTRAINT "returns_suma_ck"
  CHECK ("devuelto_centavos" + "descontado_de_deuda_centavos" + "a_cambio_centavos"
         = "total_centavos");

--> statement-breakpoint

ALTER TABLE "returns" DROP CONSTRAINT IF EXISTS "returns_partes_ck";

--> statement-breakpoint

ALTER TABLE "returns" ADD CONSTRAINT "returns_partes_ck"
  CHECK ("devuelto_centavos" >= 0
     AND "descontado_de_deuda_centavos" >= 0
     AND "a_cambio_centavos" >= 0);
