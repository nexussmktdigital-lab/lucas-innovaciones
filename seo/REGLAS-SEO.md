# Reglas para el contenido SEO de productos — Lucas Innovaciones

Tienda: Lucas Innovaciones, local de tecnología en Caseros 924, Villa Santa Rosa, Córdoba
(Argentina). 20 años de trayectoria. Retiro gratis en el local y envíos a todo el país
(gratis desde $ 100.000). Público: Argentina, sobre todo Córdoba.

## Salida por producto (JSON)

```json
{
  "id": 6459,
  "nombre_seo": "Tarjeta de Memoria microSD 32 GB",
  "keyword": "tarjeta de memoria 32gb",
  "keywords_secundarias": ["micro sd 32gb", "memoria microsd 32 gb precio", "tarjeta sd 32gb córdoba"],
  "titulo_seo": "Tarjeta de Memoria microSD 32 GB | Lucas Innovaciones",
  "meta_descripcion": "Tarjeta de memoria microSD de 32 GB para celular, cámara o tablet. Retirala en Villa Santa Rosa o pedila con envío a todo el país.",
  "descripcion": "<p>…</p><ul><li>…</li></ul><p>…</p>"
}
```

- **nombre_seo** (máx. 70 caracteres): nombre claro para mostrar en la web. Tipo de producto +
  marca + modelo + dato clave. Unidades bien escritas: GB, TB, W, mAh, mm, m, USB-C, USB,
  HDMI, LED, Wi-Fi, Bluetooth, 4K, 5G. Marcas con su grafía (iPhone, Samsung, Xiaomi, JBL,
  Kingston, Hiksemi, Noga, Netmak, Logitech, Stanley…). Sin códigos internos ni IMEI.
  Celulares usados: "iPhone 14 Pro Max 256 GB Usado – Batería 100%". Los que dicen
  SELLADO o nuevo: "Nuevo". No cambiar el producto: mismo modelo, misma capacidad.
- **keyword**: cómo lo busca la gente en Google Argentina, en minúscula y sin tildes
  innecesarias ("cable usb tipo c", "iphone 13 pro usado", "termo stanley 1 litro").
- **keywords_secundarias**: 3 a 5 variantes reales (sinónimos, "precio", "córdoba",
  modelo compatible, nombre coloquial: "cargador", "auris", "parlante bluetooth").
- **titulo_seo** (máx. 60 caracteres): `nombre_seo | Lucas Innovaciones`. Si no entra, acortar
  el nombre (nunca la marca ni el modelo); si igual no entra, dejar solo el nombre.
- **meta_descripcion** (entre 120 y 155 caracteres): qué es + para qué sirve + "Retiralo en
  Villa Santa Rosa o pedilo con envío a todo el país" (o variante corta). **Sin precio**
  (cambia seguido).
- **descripcion** (60 a 120 palabras, HTML simple: `<p>`, `<ul><li>`, `<strong>`): un párrafo
  de qué es y para qué sirve, 3 a 5 viñetas con datos, y un cierre corto sobre retiro en el
  local o envío.

## Lo que NO se hace

- **No inventar especificaciones.** Solo datos que salen del nombre, la categoría o la
  descripción actual **si es coherente con el nombre**. Ante la duda, no se pone. Mejor una
  viñeta de uso ("ideal para…") que un dato falso. Si `desc_actual` dice "(no usar…)",
  ignorarla por completo.
- Sin garantías ("12 meses", "garantía oficial"), sin cuotas, sin plazos de envío ("en 24 hs"),
  sin descuentos, sin "100% original", sin "el mejor precio", sin stock ("últimas unidades").
- Sin emojis. Sin MAYÚSCULAS sostenidas. Sin signos de exclamación en exceso.
- Celulares usados: decir que es usado y la salud de batería que figura en el nombre. No
  inventar estado estético, accesorios incluidos ni garantía.
- Castellano rioplatense con voseo (llevalo, retiralo, conectá), tono claro y cercano, sin
  frases de relleno ("en el mundo actual", "no busques más").
- Mantener el JSON válido: comillas dobles escapadas dentro del HTML.
