-- Encontrar un pago de fiado para imprimir su recibo.
--
-- Sirve mientras el botón nuevo de la ficha no esté desplegado, y después
-- también, para buscar un pago viejo por apellido sin ir cliente por cliente.
--
-- Cambiá 'cesano' por lo que quieras buscar. Busca en el nombre sin importar
-- mayúsculas ni dónde caiga: 'cesano' encuentra «Gastón Cesano Cocun» igual
-- que «Pablo Cesano Cocun».
--
-- Para correr en la consola de Neon. Solo lee.
--
-- La columna `recibo` es la dirección para abrir en el navegador, ya logueado
-- en el POS: pegala después de https://pos.lucasinnovaciones.com.ar

SELECT
  to_char(cp.fecha AT TIME ZONE 'America/Argentina/Cordoba', 'DD/MM/YYYY HH24:MI') AS cuando,
  c.nombre                                        AS cliente,
  -- `translate` da vuelta el punto y la coma: Postgres formatea con el
  -- separador de su configuración, que en Neon es el inglés (20,000.00).
  CASE cp.moneda_deuda WHEN 'USD' THEN 'US$ ' ELSE '$ ' END ||
    translate(to_char(cp.monto_centavos / 100.0, 'FM999G999G990D00'), '.,', ',.')
                                                  AS pago,
  cp.medio,
  cp.nota,
  CASE cp.moneda_deuda WHEN 'USD' THEN 'US$ ' ELSE '$ ' END ||
    translate(to_char(cp.saldo_resultante_centavos / 100.0, 'FM999G999G990D00'), '.,', ',.')
                                                  AS saldo_que_quedo,
  '/recibo/' || cp.id                             AS recibo
  FROM credit_payments cp
  JOIN credit_accounts ca ON ca.id = cp.credit_account_id
  JOIN customers c        ON c.id  = ca.customer_id
 WHERE c.nombre ILIKE '%cesano%'
 ORDER BY cp.fecha DESC
 LIMIT 20;
