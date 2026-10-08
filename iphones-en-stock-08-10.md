# iPhones en stock — 08/10/2026

Los **18** iPhones con stock e `instock` en WooCommerce, de los 55 productos
marcados en dólares (los otros 37 están sin stock).

Estado **después** de restaurar los 18 precios que se habían pisado. Los pesos
son al dólar de ahora ($1.556, blue de Córdoba venta): no están guardados en
ningún lado, los calcula la web al renderizar y el POS al vender.

| # | ID | Nombre completo | USD | En pesos hoy | Editar |
|---|---|---|---|---|---|
| 1 | 7290 | iPhone 11 Pro 256gb 100% (80633) | 280 | $ 436.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=7290&action=edit) |
| 2 | 7281 | iPhone 13 128gb 87% (47082) | 511 | $ 796.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=7281&action=edit) |
| 3 | 6701 | iPhone 13 Pro 128gb 100% (Pant Original) (63542) | 450 | $ 701.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6701&action=edit) |
| 4 | 6871 | iPhone 13 Pro Max 128gb 100% (26915) | 520 | $ 810.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6871&action=edit) |
| 5 | 7101 | iPhone 14 128gb 84% (37873) | 390 | $ 607.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=7101&action=edit) |
| 6 | 6969 | iPhone 14 128gb 89% (74563) | 420 | $ 654.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6969&action=edit) |
| 7 | 6971 | iPhone 14 Pro 128gb 98% (39354) | 530 | $ 825.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6971&action=edit) |
| 8 | 6913 | iPhone 14 Pro 256gb 97% (91005) | 555 | $ 864.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6913&action=edit) |
| 9 | 6822 | iPhone 14 Pro Max 256gb 100% (77792) | 640 | $ 996.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6822&action=edit) |
| 10 | 6878 | iPhone 15 128gb 86% (84355) | 520 | $ 810.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6878&action=edit) |
| 11 | 6868 | iPhone 15 128gb 87% (08331) | 490 | $ 763.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6868&action=edit) |
| 12 | 6869 | iPhone 15 Pro 256gb 87% (21369) | 660 | $ 1.027.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6869&action=edit) |
| 13 | 6845 | iPhone 16 128gb 87% (91123) | 630 | $ 981.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6845&action=edit) |
| 14 | 6844 | iPhone 16 Pro 256gb 89% (76149) | 820 | $ 1.276.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6844&action=edit) |
| 15 | 7162 | iPhone 16 Pro Max 256gb 92% (23063) | 920 | $ 1.432.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=7162&action=edit) |
| 16 | 6880 | iPhone 17 256gb SELLADO (78274) | 980 | $ 1.525.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6880&action=edit) |
| 17 | 7283 | iPhone 17 Pro 256gb 100% (22187) | 1220 | $ 1.899.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=7283&action=edit) |
| 18 | 9170 | iPhone 18 Pro (256gb) | 1510 | $ 2.350.000 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=9170&action=edit) |

> El número entre paréntesis es el último tramo del IMEI: es como el local
> distingue dos equipos del mismo modelo. Hay cuatro pares que solo se
> diferencian por eso.

---

## Qué se restauró y por qué

Entre las **12:16 y las 12:23** del 08/10, el POS escribió en WooCommerce el
precio **en pesos** sobre 17 fichas marcadas en dólares, una cada 30-60
segundos, más una decimoctava en otra escala. Para la web esos números son
dólares: el iPhone 13 Pro habría quedado publicado en 707.000 × 1.556, más de
**mil cien millones de pesos**.

Lo escribió el **código viejo**, el que no entendía la convención del plugin:
se sabe porque el código nuevo manda siempre la marca de moneda junto al
precio, y en las 17 la marca quedó intacta. Pasó mientras Vercel todavía estaba
desplegando el arreglo.

**Los dólares se reconstruyeron dividiendo por 1.571**, el dólar que tenía el
POS en ese momento. Cada uno dio un número redondo con un desvío máximo de 28
centavos sobre 17 productos, lo que no pasa por casualidad. Dos se verifican
contra el relevamiento de esa mañana, anterior al pisotón: 6713 daba 275 y
reconstruye 275; 6876 daba 265 y reconstruye 265.

Cada escritura se hizo con una guarda: solo se tocaba si el precio seguía
siendo exactamente el relevado. Ninguno se salteó.

| ID | Producto | Decía | Quedó |
|---|---|---|---|
| 7290 | iPhone 11 Pro 256gb 100% (80633) | 440000.00 | 280 |
| 6713 | iPhone 12 128gb 75% (45039) | 432000.00 | 275 |
| 6876 | iPhone 12 128gb 80% (7481) | 416000.00 | 265 |
| 7278 | iPhone 12 Pro 128gb 100% (63695) | 487000.00 | 310 |
| 6766 | iPhone 12 Pro 79% 128gb (33095) | 440000.00 | 280 |
| 7099 | iPhone 12 Pro Max 128gb 100% (5735) | 605000.00 | 385 |
| 7163 | iPhone 12 Pro Max 128gb 98% (5735) | 518000.00 | 330 |
| 7348 | iPhone 13 128gb 100% (25726) | 566000.00 | 360 |
| 6801 | iPhone 13 128gb 73% (38894) | 526000.00 | 335 |
| 6800 | iPhone 13 128gb 86% (54265) | 503000.00 | 320 |
| 6905 | iPhone 13 Pro 128gb 100% (4742) | 707000.00 | 450 |
| 6904 | iPhone 13 Pro 128gb 100% (5072) | 707000.00 | 450 |
| 6968 | iPhone 13 Pro 128gb 100% (5387) | 707000.00 | 450 |
| 6931 | iPhone 13 Pro 128gb 100% (56982) | 715000.00 | 455 |
| 7280 | iPhone 13 Pro 128gb 100% (7379) | 644000.00 | 410 |
| 6972 | iPhone 13 Pro 128gb 100% (9229) | 715000.00 | 455 |
| 6701 | iPhone 13 Pro 128gb 100% (Pant Original) (63542) | 707000.00 | 450 |
| 9170 | iPhone 18 Pro (256gb) | 2372.00 | 1510 |

El 9170 iba aparte: su número no era un precio en pesos sino el mismo valor
corrido de coma (1510 × 1,571 = 2.372). El 1510 no es reconstruido, es el valor
leído de la base esa mañana antes de marcarlo en dólares.

## Cómo deshacerlo

Respaldo de los 55 productos marcados en dólares, tomado antes de la primera
escritura:

    wp-content/novamira-sandbox/respaldo-precios-usd-2026-10-08-2020.json

Trae por producto el `_price`, `_regular_price`, `_sale_price`, `_li_moneda` y
`_stock` tal como estaban.

## Verificación final

Los 55 marcados en dólares, revisados uno por uno:

- Ningún precio fuera del rango 150-2.000 dólares.
- `_price` y `_regular_price` coinciden en todos.
- La tabla de búsqueda de WooCommerce (`wc_product_meta_lookup`) coincide con
  el precio en todos. Importa: el orden por precio y los filtros por rango de
  la web leen esa tabla, no la meta, así que una desalineada publica el número
  viejo en los listados.

Se escribió con el API de WooCommerce (`wc_get_product()->set_regular_price()`)
y no con metas sueltas, que es lo que mantiene esas tres cosas alineadas.
