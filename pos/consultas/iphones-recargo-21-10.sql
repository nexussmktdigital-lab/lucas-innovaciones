-- Ventas en dólares cobradas de menos mientras el recargo estuvo en 15%.
--
-- Entre el 21/10 11:45 y el momento en que el recargo volvió a 0, el POS le
-- descontaba el recargo de la tienda a los productos en dólares. No
-- correspondía: el precio en pesos de un producto en dólares sale de la
-- cotización y se cobra igual en los dos lados.
--
-- Para correr en la consola de Neon. Solo lee: ningún UPDATE, ningún DELETE.
--
-- La ventana no está escrita a mano: sale de la bitácora, de los dos cambios
-- de recargo. Así no hay que acertarle a la hora.
--
-- Un aviso para leer el resultado: si algún equipo en dólares tenía escrito un
-- precio de mostrador propio, también va a figurar con diferencia, y esa no es
-- de este error —es un precio que alguien puso a mano a propósito—. Son pocos;
-- se reconocen porque el cobro no es el precio en dólares dividido 1,15.

WITH ventana AS (
  SELECT
    MIN(created_at) FILTER (WHERE (valor_nuevo ->> 'bp')::int > 0)  AS desde,
    MAX(created_at) FILTER (WHERE (valor_nuevo ->> 'bp')::int = 0)  AS hasta
    FROM audit_log
   WHERE accion = 'precios.recargo_tienda'
     AND created_at >= '2026-10-20'
),
lineas AS (
  SELECT
    s.fecha,
    s.numero,
    s.canal,
    u.nombre                       AS vendedor,
    i.descripcion,
    i.cantidad,
    i.precio_usd_centavos,
    s.tc_aplicado_centavos,
    i.precio_unitario_centavos     AS cobrado_unitario,
    -- Lo que se tendría que haber cobrado: USD x cotización, redondeado al
    -- millar de pesos, que es la misma cuenta que usa el sistema.
    ROUND(
      (i.precio_usd_centavos::numeric * s.tc_aplicado_centavos / 100) / 100000
    ) * 100000                     AS correcto_unitario
    FROM sale_items i
    JOIN sales s ON s.id = i.sale_id
    JOIN users u ON u.id = s.vendedor_id
   CROSS JOIN ventana v
   WHERE i.moneda_original = 'USD'
     AND i.precio_usd_centavos IS NOT NULL
     AND s.tc_aplicado_centavos IS NOT NULL
     AND s.estado = 'completed'
     AND s.fecha >= v.desde
     AND s.fecha <  COALESCE(v.hasta, now())
)
SELECT
  to_char(fecha AT TIME ZONE 'America/Argentina/Cordoba', 'DD/MM HH24:MI') AS cuando,
  numero,
  canal,
  vendedor,
  descripcion,
  cantidad,
  ROUND(precio_usd_centavos / 100.0, 2)                      AS usd,
  ROUND(tc_aplicado_centavos / 100.0, 2)                     AS cotizacion,
  ROUND(cobrado_unitario / 100.0)                            AS cobro_unitario,
  ROUND(correcto_unitario / 100.0)                           AS deberia_unitario,
  ROUND((correcto_unitario - cobrado_unitario) * cantidad / 100.0) AS diferencia
  FROM lineas
 WHERE correcto_unitario <> cobrado_unitario
 ORDER BY fecha;
