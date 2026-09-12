-- Los montos de una venta cerrada no se reescriben.
--
-- Los disparadores de 0001 bloquean el DELETE en ventas, lineas y pagos, pero
-- dejan pasar el UPDATE, porque anular una venta necesita cambiarle el estado.
-- El efecto colateral era que un `UPDATE sales SET total_centavos = 1` pasaba
-- sin ruido: la plata de una venta firmada se podia reescribir a mano.
--
-- Ahora el UPDATE se permite solo en las columnas que de verdad cambian despues
-- de cobrar: el estado y el motivo al anular, la marca de sincronizado con Woo
-- y la nota. Todo lo demas —importes, cantidades, quien vendio, contra que caja,
-- la clave de idempotencia— es de solo lectura desde el momento en que entra.
--
-- Las lineas y los pagos no cambian nunca: ahi el UPDATE se bloquea entero.

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
  THEN
    RAISE EXCEPTION
      'La venta % ya esta cerrada: solo se le puede cambiar el estado, la nota o la marca de sincronizacion',
      OLD.numero
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER sales_montos_inmutables
  BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION li_venta_solo_estado();
--> statement-breakpoint
-- Una linea de venta no cambia nunca. Corregir es anular y volver a vender.
CREATE TRIGGER sale_items_sin_update
  BEFORE UPDATE ON sale_items
  FOR EACH ROW EXECUTE FUNCTION li_bloquear_modificacion();
--> statement-breakpoint
CREATE TRIGGER sale_payments_sin_update
  BEFORE UPDATE ON sale_payments
  FOR EACH ROW EXECUTE FUNCTION li_bloquear_modificacion();
