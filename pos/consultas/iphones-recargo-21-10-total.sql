-- El total de lo anterior, en una línea. Mismo cálculo, misma ventana.
-- Para correr en la consola de Neon. Solo lee.

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
    i.cantidad,
    i.precio_unitario_centavos AS cobrado_unitario,
    ROUND(
      (i.precio_usd_centavos::numeric * s.tc_aplicado_centavos / 100) / 100000
    ) * 100000                 AS correcto_unitario
    FROM sale_items i
    JOIN sales s ON s.id = i.sale_id
   CROSS JOIN ventana v
   WHERE i.moneda_original = 'USD'
     AND i.precio_usd_centavos IS NOT NULL
     AND s.tc_aplicado_centavos IS NOT NULL
     AND s.estado = 'completed'
     AND s.fecha >= v.desde
     AND s.fecha <  COALESCE(v.hasta, now())
)
SELECT
  (SELECT to_char(desde AT TIME ZONE 'America/Argentina/Cordoba', 'DD/MM HH24:MI') FROM ventana) AS desde,
  (SELECT to_char(COALESCE(hasta, now()) AT TIME ZONE 'America/Argentina/Cordoba', 'DD/MM HH24:MI') FROM ventana) AS hasta,
  COUNT(*)                                                               AS equipos,
  SUM(cantidad)                                                          AS unidades,
  ROUND(SUM(cobrado_unitario * cantidad) / 100.0)                        AS se_cobro,
  ROUND(SUM(correcto_unitario * cantidad) / 100.0)                       AS se_debio_cobrar,
  ROUND(SUM((correcto_unitario - cobrado_unitario) * cantidad) / 100.0)  AS diferencia
  FROM lineas
 WHERE correcto_unitario <> cobrado_unitario;
