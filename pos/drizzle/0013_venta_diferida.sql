-- Ventas cobradas sin conexión, que entran después (v1.1, D56).
--
-- El POS es online (D1/D25): sin internet no se factura. En un local de barrio
-- con la conexión de Villa Santa Rosa eso significa que un corte de media hora
-- es media hora sin poder cobrar, y lo que pasa de verdad es que se vende igual
-- y se anota en un papel. Un papel no descuenta stock ni entra al arqueo.
--
-- Lo que se agrega acá es el registro de que una venta se cobró en un momento y
-- entró al sistema en otro. Tres columnas y ninguna tabla nueva: la venta
-- diferida es una venta, no otra cosa. Si fuera su propia tabla habría que
-- acordarse de sumarla en cada reporte, y uno que se olvide deja un número mal
-- para siempre.
--
--  * `offline`               la venta se cobró sin conexión.
--  * `offline_capturada_en`  cuándo se cobró de verdad, que es lo que vale.
--  * `offline_desvio_centavos`
--        Lo cobrado menos lo que el catálogo dice hoy. Sin conexión el precio
--        lo pone la pantalla —es el único dato que existe— y el servidor no lo
--        puede reconstruir sin cambiar lo que el cliente pagó. Entonces se
--        guarda lo que se cobró y se deja anotada la diferencia, para que el
--        dueño la vea en vez de que se pierda. En una venta normal es cero.
--
-- `fecha` queda en el momento del cobro y no en el de la carga: es cuando la
-- venta ocurrió, y todo reporte se recorta por el calendario del local (D51).
ALTER TABLE "sales" ADD COLUMN "offline" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "offline_capturada_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "offline_desvio_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Una venta diferida dice cuándo se cobró; una normal no tiene nada que decir.
ALTER TABLE "sales" ADD CONSTRAINT "sales_offline_ck"
  CHECK (("offline" AND "offline_capturada_en" IS NOT NULL)
      OR (NOT "offline" AND "offline_capturada_en" IS NULL AND "offline_desvio_centavos" = 0));--> statement-breakpoint

CREATE INDEX "sales_offline_idx" ON "sales" ("offline") WHERE "offline";--> statement-breakpoint

-- Las columnas nuevas son parte de los montos de una venta cerrada (D34): se
-- escriben al insertar y no se tocan nunca más. Sin esto quedarían fuera de la
-- lista y serían el único campo de plata modificable por UPDATE.
CREATE OR REPLACE FUNCTION li_venta_solo_estado() RETURNS trigger AS $$
BEGIN
  IF NEW.numero              IS DISTINCT FROM OLD.numero
  OR NEW.terminal            IS DISTINCT FROM OLD.terminal
  OR NEW.fecha               IS DISTINCT FROM OLD.fecha
  OR NEW.vendedor_id         IS DISTINCT FROM OLD.vendedor_id
  OR NEW.cliente_id          IS DISTINCT FROM OLD.cliente_id
  OR NEW.cash_session_id     IS DISTINCT FROM OLD.cash_session_id
  OR NEW.canal               IS DISTINCT FROM OLD.canal
  OR NEW.tipo                IS DISTINCT FROM OLD.tipo
  OR NEW.subtotal_centavos   IS DISTINCT FROM OLD.subtotal_centavos
  OR NEW.descuento_centavos  IS DISTINCT FROM OLD.descuento_centavos
  OR NEW.total_centavos      IS DISTINCT FROM OLD.total_centavos
  OR NEW.tc_aplicado_centavos IS DISTINCT FROM OLD.tc_aplicado_centavos
  OR NEW.idempotency_key     IS DISTINCT FROM OLD.idempotency_key
  OR NEW.autorizada_por_id   IS DISTINCT FROM OLD.autorizada_por_id
  OR NEW.created_at          IS DISTINCT FROM OLD.created_at
  OR NEW.offline             IS DISTINCT FROM OLD.offline
  OR NEW.offline_capturada_en IS DISTINCT FROM OLD.offline_capturada_en
  OR NEW.offline_desvio_centavos IS DISTINCT FROM OLD.offline_desvio_centavos
  THEN
    RAISE EXCEPTION
      'La venta % ya esta cerrada: solo se le puede cambiar el estado, la nota o la marca de sincronizacion',
      OLD.numero
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
