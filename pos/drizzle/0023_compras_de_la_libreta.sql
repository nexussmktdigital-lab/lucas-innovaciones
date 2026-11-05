-- Las compras que el cliente hizo antes de entrar al sistema.
--
-- Un cliente de cuenta corriente que viene de la libreta trae meses de
-- mercadería anotada en un cuaderno. Hasta ahora solo entraba como un número
-- —el saldo—, y lo que el local quiere ver es qué se llevó y cuándo.
--
-- **Por qué no son ventas.** Una venta descuenta stock y entra en la
-- facturación del mes. Esta mercadería salió del local hace meses: el stock ya
-- se descontó entonces (o nunca se llevó en el sistema), y facturarla ahora
-- pondría medio millón de pesos en el mes equivocado. Además sus renglones son
-- texto del cuaderno, no fichas del catálogo: «1 x vaso un poco de ruido» no
-- tiene SKU ni precio de lista, y nunca lo va a tener.
--
-- Entonces es lo que es: un cargo a la cuenta, con su fecha y su detalle, que
-- no toca ninguna otra cosa del sistema. Los reportes de plata leen `sales`
-- y `credit_payments`, así que esta tabla les es invisible por construcción,
-- que es exactamente lo que se busca.
CREATE TABLE IF NOT EXISTS "credit_charges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "credit_account_id" uuid NOT NULL,
  "fecha" timestamp with time zone DEFAULT now() NOT NULL,
  "descripcion" text NOT NULL,
  -- Los renglones del cuaderno, tal como estaban escritos, uno por línea.
  "detalle" text,
  "monto_centavos" bigint NOT NULL,
  -- El saldo que quedaba ese día. Congelado, igual que en los pagos: sirve
  -- para leer la cuenta como se leía entonces.
  "saldo_resultante_centavos" bigint NOT NULL,
  -- True cuando la fecha se dedujo y no estaba escrita: los bloques del final
  -- del cuaderno no tienen ninguna entrega debajo de donde sacarla. Se marca
  -- para poder decirlo en la pantalla en vez de hacerla pasar por exacta.
  "fecha_estimada" boolean DEFAULT false NOT NULL,
  "cargado_por_id" uuid NOT NULL,
  "nota" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

ALTER TABLE "credit_charges" DROP CONSTRAINT IF EXISTS "credit_charges_cuenta_fk";

--> statement-breakpoint

ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_cuenta_fk"
  FOREIGN KEY ("credit_account_id") REFERENCES "credit_accounts"("id");

--> statement-breakpoint

ALTER TABLE "credit_charges" DROP CONSTRAINT IF EXISTS "credit_charges_usuario_fk";

--> statement-breakpoint

ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_usuario_fk"
  FOREIGN KEY ("cargado_por_id") REFERENCES "users"("id");

--> statement-breakpoint

ALTER TABLE "credit_charges" DROP CONSTRAINT IF EXISTS "credit_charges_monto_ck";

--> statement-breakpoint

-- Un cargo en cero no es una compra, es un renglón que se leyó mal.
ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_monto_ck"
  CHECK ("monto_centavos" > 0);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "credit_charges_cuenta_idx"
  ON "credit_charges" ("credit_account_id");
