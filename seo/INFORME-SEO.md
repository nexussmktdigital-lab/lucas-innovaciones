# Análisis SEO y rendimiento — lucasinnovaciones.com.ar

08/10/2026. Medido sobre el sitio en producción (modo "próximamente", con sesión de admin)
y desde afuera con `curl`. Catálogo publicado: 560 productos en 69 categorías.

## 1. Resumen

| Área | Estado | Lo más importante |
|---|---|---|
| Velocidad del servidor | **Crítico** | 1,4–1,7 s de espera por cada página (antes 1,7–6,6 s). Falta caché de páginas. |
| robots.txt | **Crítico** | Es el genérico de DonWeb: limita a 6 páginas por hora y no declara el sitemap. |
| Peso de las páginas | Bien | La portada pesa 206 KB. Imágenes en WebP, fuentes locales, CSS/JS con Brotli y caché de 1 año. |
| SEO técnico de la ficha | Bien | Título, meta descripción, Open Graph, canonical y datos de producto (JSON-LD) en cada ficha. |
| SEO de categorías y tienda | Mejorable | Sin canonical, sin texto propio, títulos genéricos ("Smartphones – Lucas Innovaciones"). |
| SEO local | Falta | No hay datos estructurados del local (dirección, horario, teléfono) ni ficha de Google. |
| Contenido de productos | Mejorable | 98 sin descripción, 283 sin marca, nombres sin formato. Propuesta lista para los 560. |

## 2. Lo que ya se corrigió hoy

- **Caché de transients rota.** En `wp-content` quedó un *drop-in* de object cache de LiteSpeed
  Cache, pero el plugin no está instalado. WordPress creía tener un caché externo y **no
  guardaba ningún transient**, así que cada visita recalculaba todo (catálogo, portada,
  WooCommerce, Mercado Pago). Se renombró el archivo a
  `object-cache.php.huerfano-lscache-20261008` (reversible). Resultado: los transients
  persisten y la respuesta bajó de 1,7–6,6 s a 1,45–1,70 s, sin los picos.
- Se limpiaron 214 transients vencidos.

## 3. Rendimiento

**Mediciones (portada):** TTFB 3,98 s de 4,08 s de carga total (antes del arreglo). Recursos:
19 pedidos, 206 KB (JS 52 KB, CSS 23 KB, fuentes 87 KB, imágenes 44 KB arriba del pliegue).
Un archivo estático responde en 0,2 s y cualquier página de WordPress en ~1,5 s: **el cuello de
botella es el arranque de WordPress con sus plugins, no el peso de la página.**

**Recomendaciones, por impacto:**

1. **Caché de páginas con LiteSpeed Cache** (el servidor es LiteSpeed). Para un visitante sin
   sesión, la página sale en ~0,05–0,2 s en vez de 1,5 s. Hay que configurarlo para no cachear
   carrito, checkout, mi cuenta, la Store API ni la REST `/wc/v3` (la del POS). *Requiere tu OK:
   es un plugin nuevo en producción.* Se instala el miércoles/jueves y se prueba con compras.
2. **Plugins que pesan en cada visita:** Elementor + PRO Elements (el tema ya no los usa para
   nada visible) y YITH POS (el POS real es el de Vercel; la clave de YITH no se usa desde el
   23/09). Desactivarlos bajaría el arranque. *Decisión tuya; YITH POS no lo toco sin tu OK.*
3. **`WP_MEMORY_LIMIT` = 40 MB:** WooCommerce pide 256 MB. Se cambia en `wp-config.php` (DonWeb
   o novamira).
4. **Scripts que sobran** (cambios en el tema, sin riesgo):
   - En la ficha: zoom, flexslider y photoswipe de WooCommerce (~45 KB JS + CSS). La galería
     del tema no los usa.
   - `jquery-migrate` y la hoja `block-library` en las páginas de la tienda.
   - `brands.css` en la ficha.
5. **`theme.css` (57 KB, 10 KB comprimido):** CSS del tema anterior que todavía usa el
   catálogo. Unificarlo con `ds.css` después del lanzamiento.

**Imágenes:** bien. Productos en WebP de 1200 px con tamaños intermedios, `loading="lazy"`
fuera de la primera pantalla y `alt` con el nombre. Detalles: 4 imágenes sin `alt` en la
página de categoría (chips/carrusel) y 10 sin `width/height` en la portada (provocan saltos).

## 4. SEO técnico

1. **robots.txt (crítico).** Reemplazar el de DonWeb por uno propio:
   ```
   User-agent: *
   Disallow: /wp-admin/
   Allow: /wp-admin/admin-ajax.php
   Disallow: /carrito/
   Disallow: /finalizar-compra/
   Disallow: /mi-cuenta/
   Disallow: /*?*orderby=
   Disallow: /*?*precio_
   Disallow: /*?s=
   Sitemap: https://lucasinnovaciones.com.ar/wp-sitemap.xml
   ```
   El actual tiene `Crawl-delay: 60` y `Request-rate: 6/60m` (Bing y otros los respetan: el
   catálogo tardaría días en indexarse) y bloquea `/wp-content/themes/` y `/plugins/` (CSS y JS).
2. **Al lanzar:** `blog_public = 1` (hoy todo dice `noindex`) → el sitemap de WordPress se
   activa solo (hoy aparece vacío por eso) → enviarlo en Search Console.
3. **Canonical en tienda y categorías**, y `noindex,follow` en las URLs con filtros
   (`?marca=`, `?modelo=`, `?precio_min=`) para no generar contenido duplicado.
4. **Títulos:** usar los títulos SEO propuestos (ver 5) en fichas, y en categorías algo como
   "Celulares y smartphones en Villa Santa Rosa | Lucas Innovaciones".
5. **Datos estructurados:**
   - Portada: `ElectronicsStore` con dirección, teléfono, horario y geo (SEO local).
   - Fichas y categorías: `BreadcrumbList`.
   - Producto: ya está. Sumar `brand` cuando haya marca.
6. **SEO local fuera del sitio:** Perfil de Empresa de Google con la misma dirección, horario
   y teléfono, enlazado a la web. Para búsquedas como "celulares Villa Santa Rosa" pesa más que
   cualquier cambio en el sitio.

## 5. Contenido de productos (los 560)

Archivo: **`productos-seo.csv`** (se abre en Excel). Por producto: nombre actual, **nombre SEO**,
**keyword principal**, **keywords secundarias**, **título SEO** (≤ 60 caracteres),
**meta descripción** (120–155) y **descripción SEO** en HTML (40–130 palabras).

Reglas con las que se escribió (`REGLAS-SEO.md`): sin especificaciones inventadas (solo lo
que sale del nombre, la categoría o la descripción actual cuando coincide con el nombre), sin
garantías, cuotas, plazos de envío, "100% original" ni emojis; voseo; celulares usados con su
salud de batería. Validado con `unir-y-validar.mjs`: 560/560, 0 incumplimientos.

**Cómo se aplicaría (a decidir):**
- **Opción A (recomendada): solo en la web, por código.** El tema lee el nombre SEO, título,
  meta y descripción de un archivo por producto. No se escribe nada en WooCommerce: el POS
  sigue viendo los nombres de siempre y se puede revertir en un minuto.
- **Opción B: escribirlo en WooCommerce** (nombre y descripción de cada producto). Es lo
  estándar, pero cambia los nombres que Lucas ve en el POS y pisa las descripciones actuales.

## 6. Errores de catálogo que encontró el análisis

Conviene que Lucas los corrija en el POS o el admin (no se tocaron):
- **Descripciones de otro producto:** Kolke KET700 (6673), teclado numérico Kolke (6678), silla
  Donna (6948), proyector Netmak NMPR300 (6793, marca y descripción de un cable), Kolke Party
  Cube (6754, categoría "Adaptadores", descripción de un adaptador HDMI), MagSafe (6863, habla
  de pilas), varias Smart TV con pulgadas distintas a las del nombre (6731, 6607, 7681, 6710).
- **Marcas mal cargadas:** perfumes con marca "Haya"/"Haramain" que no corresponde, JBL C50H
  con marca FoxBox, Kolke KAB633 con marca Seisa, Noblex con marca TCL.
- **Nombres con errores:** "Linsys" (Linksys), "stormberg", "Netmark" (Netmak), "Humificador",
  "Withe", "Matepa", botella Termito "7500 CC" (¿750?), Redmi 15C "4gb" (es 8 GB).
- **Posibles duplicados:** micrófonos "Aloe"/"Aole" AM-188 (6323, 6480).
- **Categorías mal asignadas:** Galaxy Buds 3 en "con cable", cortadoras de pelo en "Cocina",
  parlante K12 en "Parlantes de auto", Apple Battery pack en "Cargadores de pared".
- **283 productos sin marca:** con marca se pueden filtrar y suman en Google (`brand`).
