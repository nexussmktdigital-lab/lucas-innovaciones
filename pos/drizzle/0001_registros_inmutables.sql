-- Registros inmutables.
--
-- La regla "nada se borra jamas" y la de la bitacora inmutable no se sostienen
-- con disciplina de codigo: se imponen en la base. Una anulacion de venta es un
-- registro nuevo, nunca un DELETE.
--
-- Nota: estos disparadores actuan por fila y por lo tanto NO bloquean TRUNCATE.
-- Es a proposito: `npm run db:seed -- --reset` necesita poder limpiar una base
-- de desarrollo.

CREATE OR REPLACE FUNCTION li_bloquear_modificacion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'La tabla % es de solo agregado: no se permite % (registro %)',
    TG_TABLE_NAME, TG_OP, COALESCE(OLD.id::text, '?')
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Bitacora: ni actualizar ni borrar.
CREATE TRIGGER audit_log_inmutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION li_bloquear_modificacion();
--> statement-breakpoint
-- Ventas y sus lineas: no se borran. Anular genera registros nuevos.
CREATE TRIGGER sales_sin_delete
  BEFORE DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION li_bloquear_modificacion();
--> statement-breakpoint
CREATE TRIGGER sale_items_sin_delete
  BEFORE DELETE ON sale_items
  FOR EACH ROW EXECUTE FUNCTION li_bloquear_modificacion();
--> statement-breakpoint
CREATE TRIGGER sale_payments_sin_delete
  BEFORE DELETE ON sale_payments
  FOR EACH ROW EXECUTE FUNCTION li_bloquear_modificacion();
--> statement-breakpoint
-- Movimientos de stock y de caja: libro de asientos, solo se agrega.
CREATE TRIGGER stock_movements_inmutable
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION li_bloquear_modificacion();
--> statement-breakpoint
CREATE TRIGGER cash_movements_inmutable
  BEFORE UPDATE OR DELETE ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION li_bloquear_modificacion();
--> statement-breakpoint
-- Cobros de fiado: se agregan, no se editan.
CREATE TRIGGER credit_payments_inmutable
  BEFORE UPDATE OR DELETE ON credit_payments
  FOR EACH ROW EXECUTE FUNCTION li_bloquear_modificacion();
--> statement-breakpoint
-- Historico del POS anterior: importado una vez, de solo lectura.
CREATE TRIGGER legacy_sales_inmutable
  BEFORE UPDATE OR DELETE ON legacy_sales
  FOR EACH ROW EXECUTE FUNCTION li_bloquear_modificacion();
