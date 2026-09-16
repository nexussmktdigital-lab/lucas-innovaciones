-- Devoluciones de ventas de turnos cerrados.
--
-- Anular es para el error de carga y solo dentro del turno abierto (D29):
-- revertir contra una caja cerrada descuadra dos arqueos, el de aquel día y el
-- de hoy. Pero el cliente que vuelve el jueves con el cargador que no anda es
-- real y el sistema no tenía nada para él.
--
-- Una devolución es otra cosa que una anulación, y por eso va en su propia
-- tabla en vez de reusar `sales`:
--
--  * **La venta original no se toca.** Se hizo, se cobró y quedó en el arqueo de
--    aquel turno. Sigue exactamente como estaba.
--  * **El movimiento cae en el turno de hoy**, que es cuando la plata sale del
--    cajón de verdad y cuando la mercadería vuelve al local.
--  * **Puede ser parcial**: de tres cosas se devuelve una.
--
-- Tampoco se guarda como una venta de total negativo: `sales` tiene un CHECK
-- que lo impide, y sobre todo cada reporte tendría que acordarse de excluirla.
-- Uno que se olvide y el número queda mal para siempre.

CREATE TABLE IF NOT EXISTS returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Correlativo propio, con su prefijo: `DEV-T1-000001`. No se mezcla con la
  -- numeracion de ventas porque no es una venta.
  numero text NOT NULL,
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  fecha timestamptz NOT NULL DEFAULT now(),
  terminal text NOT NULL,
  -- El turno en el que se hace la devolucion, no el de la venta.
  cash_session_id uuid REFERENCES cash_sessions(id),
  usuario_id uuid NOT NULL REFERENCES users(id),
  cliente_id uuid REFERENCES customers(id),
  motivo text NOT NULL,
  total_centavos bigint NOT NULL,
  -- Como se le devolvio. Lo que se le descuenta de lo que todavia debe de esa
  -- venta no sale del cajon, asi que van separados y tienen que sumar el total.
  devuelto_centavos bigint NOT NULL DEFAULT 0,
  descontado_de_deuda_centavos bigint NOT NULL DEFAULT 0,
  medio medio_pago,
  monetary_account_id uuid REFERENCES monetary_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT returns_total_ck CHECK (total_centavos > 0),
  CONSTRAINT returns_partes_ck
    CHECK (devuelto_centavos >= 0 AND descontado_de_deuda_centavos >= 0),
  -- La invariante que sostiene todo: lo que se devolvio mas lo que se descuento
  -- de la deuda es exactamente lo que valia lo devuelto.
  CONSTRAINT returns_suma_ck
    CHECK (devuelto_centavos + descontado_de_deuda_centavos = total_centavos),
  -- Si salio plata, hay que decir por donde. Misma regla que un gasto pagado.
  CONSTRAINT returns_medio_ck
    CHECK (devuelto_centavos = 0 OR (medio IS NOT NULL AND monetary_account_id IS NOT NULL))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS returns_numero_uq ON returns (numero);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS returns_sale_idx ON returns (sale_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS returns_fecha_idx ON returns (fecha);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS returns_sesion_idx ON returns (cash_session_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES returns(id) ON DELETE RESTRICT,
  -- Apunta a la linea original: es lo que permite saber cuanto queda por
  -- devolver de cada renglon y no aceptar mas unidades de las que se llevaron.
  sale_item_id uuid NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES product_variants(id) ON DELETE RESTRICT,
  descripcion text NOT NULL,
  cantidad integer NOT NULL,
  -- Lo que se cobro por unidad de verdad, con el descuento global prorrateado.
  -- Devolver el precio de lista de una venta que se hizo con descuento es
  -- devolver mas plata de la que entro.
  precio_unitario_centavos bigint NOT NULL,
  total_centavos bigint NOT NULL,
  -- Un cargador fallado no vuelve al stock vendible. Lo decide quien atiende,
  -- producto por producto, porque el sistema no puede saberlo.
  vuelve_al_stock boolean NOT NULL DEFAULT true,

  CONSTRAINT return_items_cantidad_ck CHECK (cantidad > 0),
  CONSTRAINT return_items_precio_ck CHECK (precio_unitario_centavos >= 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS return_items_return_idx ON return_items (return_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS return_items_sale_item_idx ON return_items (sale_item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS return_items_product_idx ON return_items (product_id);
--> statement-breakpoint

-- Una devolucion no se edita ni se borra: se hace otra en sentido contrario si
-- hubo un error. Mismo criterio que la bitacora y que los montos de una venta.
CREATE OR REPLACE FUNCTION li_devolucion_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Una devolucion no se modifica ni se borra. Si esta mal, hace falta registrar la correccion.'
    USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER li_returns_inmutable
  BEFORE UPDATE OR DELETE ON returns
  FOR EACH ROW EXECUTE FUNCTION li_devolucion_inmutable();
--> statement-breakpoint

CREATE TRIGGER li_return_items_inmutable
  BEFORE UPDATE OR DELETE ON return_items
  FOR EACH ROW EXECUTE FUNCTION li_devolucion_inmutable();
