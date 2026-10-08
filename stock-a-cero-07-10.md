# Equipos a poner en stock 0 — revisión del 07/10

Los 23 de la lista de Lucas, verificados contra el catálogo el 08/10.
**Todos están hoy en `stock 1`, `instock` y publicados.**

Motivo a dejar asentado: **«No está en el local (revisión 07/10)»**.
No dar de baja: solo stock 0.

| # | ID | Producto | SKU | Editar |
|---|---|---|---|---|
| 1 | 6713 | iPhone 12 128gb 75% (45039) | PHO-APPLE-12128G-2 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6713&action=edit) |
| 2 | 6707 | iPhone 12 128gb 75% outlet (45039) | PHO-APPLE-12128G | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6707&action=edit) |
| 3 | 6876 | iPhone 12 128gb 80% (7481) | PHO-APPLE-12128G-3 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6876&action=edit) |
| 4 | 7163 | iPhone 12 Pro Max 128gb 98% (5735) | — | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=7163&action=edit) |
| 5 | 6801 | iPhone 13 128gb 73% (38894) | PHO-APPLE-13128G-3 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6801&action=edit) |
| 6 | 6800 | iPhone 13 128gb 86% (54265) | PHO-APPLE-13128G-2 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6800&action=edit) |
| 7 | 7348 | iPhone 13 128gb 100% (25726) | — | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=7348&action=edit) |
| 8 | 6905 | iPhone 13 Pro 128gb 100% (4742) | PHO-APPLE-13P128G-4 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6905&action=edit) |
| 9 | 6904 | iPhone 13 Pro 128gb 100% (5072) | PHO-APPLE-13P128G-3 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6904&action=edit) |
| 10 | 6968 | iPhone 13 Pro 128gb 100% (5387) | PHO-APPLE-13P128G-5 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6968&action=edit) |
| 11 | 7280 | iPhone 13 Pro 128gb 100% (7379) | — | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=7280&action=edit) |
| 12 | 6972 | iPhone 13 Pro 128gb 100% (9229) | PHO-APPLE-13128G-6 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6972&action=edit) |
| 13 | 6931 | iPhone 13 Pro 128gb 100% (56982) | PHO-APPLE-15P256G-2 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6931&action=edit) |
| 14 | 6870 | iPhone 14 Pro 256gb 100% (80742) | PHO-APPLE-13P128G-2 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6870&action=edit) |
| 15 | 6835 | iPhone 15 Pro 256gb (90429) | PHO-APPLE-15P256G | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6835&action=edit) |
| 16 | 6845 | iPhone 16 128gb 87% (91123) | — | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6845&action=edit) |
| 17 | 6846 | iPhone 16 Pro 128gb 96% (821562) | PHO-APPLE-13128G-4 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6846&action=edit) |
| 18 | 6791 | iPhone 17 256gb (78274) | PHO-APPLE-17256G | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6791&action=edit) |
| 19 | 6286 | Moto G 54 5G | 149 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6286&action=edit) |
| 20 | 6685 | Samsung A03 128gb USADO (50408) | PHO-SAMS-A03 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6685&action=edit) |
| 21 | 6885 | Samsung A06 64gb 4gb | PHO-SAMS-A06 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6885&action=edit) |
| 22 | 6290 | Samsung Galaxy A24 | 172 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6290&action=edit) |
| 23 | 6273 | Samsung Galaxy M55 5G | 32 | [abrir](https://lucasinnovaciones.com.ar/wp-admin/post.php?post=6273&action=edit) |

---

## Ojo con estos tres

**6791 — iPhone 17 256gb (78274).** Está duplicado con **6880 «iPhone 17 256gb SELLADO (78274)»**,
mismo IMEI. 6880 **no** está en esta lista, así que queda él con stock 1. Coherente.

**6713 y 6707 — iPhone 12 128gb 75% (45039).** Son el mismo equipo cargado dos veces
(mismo IMEI) y **los dos están en esta lista**. Si el teléfono existe y está en el local,
uno de los dos tiene que quedar en 1. Si no está, los dos van a 0 y hay que decidir
cuál se da de baja para que no vuelva a aparecer duplicado.

---

## Cómo hacerlo sin romper nada

En el **admin de WooCommerce** (el enlace «abrir» de cada fila):
Inventario → **Cantidad de existencias** = `0`. Guardar.

No toques «Estado del inventario» a mano: con cantidad 0 y gestión de stock activada,
WooCommerce lo pasa a «Agotado» solo.

**El POS se entera en la próxima sincronización** (cada 10 minutos). Si lo querés
inmediato, desde el POS: Más → Sincronización → sincronizar ahora.
