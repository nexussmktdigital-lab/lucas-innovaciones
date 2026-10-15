-- Plan canje: el cliente paga parte de la compra con un teléfono usado.
--
-- Se vende un iPhone de US$ 1.000, se le recibe el suyo por US$ 600 y los
-- US$ 400 restantes entran por donde sea. Para el sistema son DOS hechos y por
-- eso hasta hoy no se podía registrar sin romper algo:
--
--  1. Un pago de US$ 600 que **no es plata**. Cierra la venta pero no entra a
--     ningún cajón. Cargarlo como efectivo deja el arqueo con seiscientos
--     dólares que no existen; cargarlo como cuenta corriente le inventa al
--     cliente una deuda que no tiene.
--  2. Una entrada de mercadería con costo US$ 600. Ese teléfono va a stock y
--     el día que se venda, el margen se calcula contra ese número.
--
-- El medio nuevo resuelve el 1. El 2 lo hace `confirmarVenta`, en la misma
-- transacción: el equipo se da de alta y se publica con la venta, o no pasa
-- ninguna de las dos cosas. Un alta sin venta sería stock que nadie entregó.

ALTER TYPE "medio_pago" ADD VALUE IF NOT EXISTS 'canje';

--> statement-breakpoint

-- Los checks de abajo comparan `"medio"::text` y no `"medio"`, y es a
-- propósito: PostgreSQL **no deja usar un valor nuevo de enum hasta que la
-- transacción que lo creó se confirma** («unsafe use of new value»), y Drizzle
-- corre todas las migraciones pendientes en UNA transacción. Comparando el
-- texto no se usa el valor del enum y los checks se pueden crear acá mismo.
--
-- PGlite —la base de los tests— es más permisiva y dejaba pasar la versión sin
-- el casteo: esto apareció recién al correr las migraciones contra un
-- PostgreSQL de verdad, que es lo que hay en producción.

--> statement-breakpoint

-- Qué equipo entró. Es la pieza que hace auditable el canje: sin esto, un pago
-- que no mueve plata ni deuda no deja rastro de a cambio de qué se dio.
ALTER TABLE "sale_payments"
  ADD COLUMN IF NOT EXISTS "producto_recibido_id" uuid REFERENCES "products"("id");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sale_payments_recibido_idx"
  ON "sale_payments" ("producto_recibido_id");

--> statement-breakpoint

-- Un canje tiene su equipo, y ningún otro medio tiene uno.
--
-- Es la guarda estructural del asunto: sin ella se puede grabar un canje de
-- US$ 600 contra nada —un descuento disfrazado que no deja ni plata ni
-- mercadería— y el agujero solo se ve al cerrar el mes.
ALTER TABLE "sale_payments" DROP CONSTRAINT IF EXISTS "sale_payments_canje_ck";

--> statement-breakpoint

ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_canje_ck"
  CHECK (("medio"::text = 'canje') = ("producto_recibido_id" IS NOT NULL));

--> statement-breakpoint

-- El canje también puede venir en dólares, y el check viejo no lo dejaba.
--
-- Decía: traen `monto_usd_centavos` y `cotizacion_centavos` exactamente los
-- pagos en dólares, y ninguno más. Un iPhone recibido contra una venta en
-- dólares vale US$ 600, no su equivalente en pesos de hoy, así que necesita
-- los mismos dos datos. Queda:
--
--  * `dolares`: los trae siempre. Sin ellos el cajón de dólares no se entera.
--  * `canje`: los trae o no los trae, según la moneda de la venta, pero
--    siempre los dos juntos: con uno solo no se puede reconstruir nada.
--  * el resto: no los trae nunca.
ALTER TABLE "sale_payments" DROP CONSTRAINT IF EXISTS "sale_payments_dolares_ck";

--> statement-breakpoint

ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_dolares_ck"
  CHECK (
    CASE "medio"::text
      WHEN 'dolares' THEN "monto_usd_centavos" IS NOT NULL AND "cotizacion_centavos" IS NOT NULL
      WHEN 'canje'   THEN ("monto_usd_centavos" IS NULL) = ("cotizacion_centavos" IS NULL)
      ELSE "monto_usd_centavos" IS NULL AND "cotizacion_centavos" IS NULL
    END
  );
