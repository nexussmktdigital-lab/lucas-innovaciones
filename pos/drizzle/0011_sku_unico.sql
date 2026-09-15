-- El SKU de un producto nacido en el POS no se puede repetir, y lo dice la base.
--
-- Hasta acá el alta comprobaba que no estuviera tomado con un SELECT y después
-- insertaba. Entre las dos cosas no hay nada: dos tablets cargando el mismo
-- producto al mismo tiempo pasan las dos el control, y como el SKU se propone
-- de forma determinista a partir del nombre, las dos calculan EL MISMO y las
-- dos entran. La auditoría de las fases 8 y 9 lo encontró.
--
-- **Solo los del POS** (`woo_id IS NULL`), y esa restricción es deliberada. La
-- primera versión de esta migración cubría el catálogo entero y rompía la
-- sincronización: WooCommerce es la fuente de verdad del catálogo (D4) y lo que
-- mande tiene que entrar, aunque traiga un SKU repetido de una migración vieja.
-- Un índice que hace fallar la sincronización es peor que la carrera que
-- arregla. Del lado de Woo la unicidad la garantiza Woo.
--
-- Va sobre `upper(sku)` porque el código compara sin distinguir mayúsculas, y
-- deja afuera los productos sin SKU, que son legítimos.
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_pos_uq
  ON products (upper(sku))
  WHERE sku IS NOT NULL AND woo_id IS NULL;
