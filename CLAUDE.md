# Tienda online Lucas Innovaciones — reglas del proyecto

Tienda online de lucasinnovaciones.com.ar sobre el WordPress + WooCommerce que ya existe.
**Fecha límite: viernes 09/10/2026, 16:00 (hora de Argentina), en producción.**
Responsable: Matias (NEXUSS). Ante cualquier duda de negocio, preguntale a Matias. No inventes.

## Contexto que no se discute

- WooCommerce es la **fuente única de stock y precios**. El POS del local vende contra este mismo
  Woo por REST API (`/wc/v3`, `created_via = rest-api`): más de 4.000 ventas, todos los días.
  **Si rompés Woo, se frena el local.**
- **Nunca modifiques** `_price`, `_regular_price`, `_sale_price`, `_stock`, `_stock_status`,
  `_sku` ni la visibilidad de productos. Nunca toques pedidos, el POS (YITH POS, página /pos)
  ni las credenciales de Mercado Pago. Todo lo que es "no mostrar en la web" se resuelve
  **en el código del tema y los plugins, no en los datos**.
- Todo hook que filtre consultas o precios va protegido para que **no corra** en wp-admin
  ni en la REST `/wc/v3` (la que usa el POS). La Store API (`/wc/store/*`, carrito y
  checkout por bloques) sí cuenta como web.
- `/staging` es otro WordPress con otra base de datos: **no se usa**.
- El sitio está en modo "próximamente" de Woo y en noindex. El público no ve nada; los
  admins logueados ven la tienda. Se trabaja en producción detrás de ese modo, con backup antes.

## Acceso

- MCP `novamira`: PHP, WP-CLI, archivos y habilidades de Woo. Las escrituras de `.php`
  solo se permiten en el sandbox de novamira. Para desplegar el tema o un plugin:
  armá el .zip, subilo con `novamira/create-upload-link` y después
  `wp theme install <zip> --force` / `wp plugin install <zip> --force --activate`.
- Repo: `nexussmktdigital-lab/lucas-innovaciones`. Todo cambio se versiona y se commitea antes de desplegarse.
- Secretos en `.env` (gitignored): `SERPER_API_KEY`, credenciales de la REST de Woo.
  Nunca los imprimas, no los commitees ni los subas al servidor.

## Base técnica

- WP 7.1.2 · PHP 8.3 · WooCommerce 10.9.4 · YITH POS 3.22 · Mercado Pago 8.9 ·
  Correo Argentino for WooCommerce (activo, **todavía sin conectar**) · Elementor + PRO Elements.
- Tema base: el tema a medida **"Lucas Innovaciones" v0.1.0** (`wp-content/themes/lucas-innovaciones`,
  sin activar y sin git). Ya trae plantillas Woo (archivo, ficha), filtros por faceta y precio
  (`inc/facetas.php`, `inc/precio.php`), banners, imágenes de categorías y logos de marcas.
  **Reutilizá su lógica, pero el aspecto visual sale 100% del design system.**

## Diseño: `./design-system/` manda

Es una copia del "Lucas Innovaciones Design System" de Claude Design. Leé `design-system/README.md`
completo antes de escribir CSS.

- Tokens: `design-system/colors_and_type.css` (variables `--li-*`). Copialos tal cual.
- Fuentes: **Space Grotesk** (títulos, precio de contado), **Inter** (todo lo demás) y
  **VT323** (solo como acento pixel: badges tipo `[ TOP_SELLERS ]`). Hay que **reemplazar**
  Montserrat, Lato e IBM Plex Mono del tema actual. Servilas locales en woff2, no desde Google.
- Componentes de referencia: `design-system/ui_kit/*.jsx` (Header, Footer, Home, Product,
  ProductCard, Checkout, Primitives) y `design-system/preview/*.html`. Son React de maqueta:
  se portan a PHP/HTML/CSS del tema **respetando medidas, radios, sombras, hovers y textos**.
  Nada de React en producción.
- El kit no trae listado de catálogo con filtros ni "Mi cuenta": se arman con los mismos tokens,
  sobre las facetas del tema actual.

### Desvíos del kit (pedidos de Matias; ganan sobre el kit)

- **Sin cuotas en la web.** Sacá todo "12 cuotas sin interés": el componente Price, el banner
  de cuotas, el texto del hero, el resumen del checkout y los widgets de cuotas que inyecte el
  plugin de Mercado Pago en la ficha. Se muestra solo el precio.
- **Dirección real: Caseros 924, Villa Santa Rosa, Córdoba.** No "Belgrano 847".
- **Sin bloque de reseñas por ahora.** Las del kit (María G., Diego R., Luciana F.) son de
  relleno: se saca ese bloque entero. La sección "Nosotros" queda sin testimonios.
- **Antigüedad: el local existe hace 20 años** (corregido por Matias el 07/10; antes decía 25). Reemplaza todo "9 años" / "desde 2017" del kit
  (hero, Nosotros, footer) por "20 años". No inventes un año de fundación.
- Los otros datos del kit que no están confirmados ("Garantía 12 meses", "5% de descuento por
  transferencia", CUIT, horarios, "envío en 24 hs") **se le confirman a Matias antes de
  publicarlos**. Si no hay confirmación, no se publican.
- Sin emoji en la web. Las fotos de producto son reales (las del pipeline de imágenes).

## Reglas de catálogo (solo en código)

Un producto aparece en la web y se puede comprar solo si cumple todo esto:
1. Precio > $1 (ni vacío, ni 0, ni 1).
2. Tiene imagen destacada.
3. Tiene stock (`instock`).
4. Si es USD, hay cotización vigente (ver abajo).

Los que no cumplen salen de listados, búsquedas, relacionados y sitemap, y en su ficha:
`woocommerce_is_purchasable = false` más un 404 o una redirección a su categoría.
Cuando Lucas cargue el precio o la foto en el POS/admin, aparecen solos.

## Precios en USD (plugin aparte: `li-dolar`)

- Hoy son 54 productos (celulares, sobre todo iPhones, nuevos y usados) cargados en dólares
  dentro de `_price`. Ejemplo: iPhone 16 Pro = 820.
- Se marcan con la meta `_li_moneda = USD`. Esa meta es nueva y es la única escritura de
  datos permitida. **La lista se le muestra a Matias y se aprueba antes de escribir.**
- **Redondeo en la web: siempre hacia arriba, a número redondo.** Por defecto, al múltiplo de
  $1.000 siguiente (ej.: 820 × 1.561 = 1.280.020 → **$ 1.281.000**). Un precio que ya es
  múltiplo exacto queda igual. El múltiplo se puede cambiar desde la pantalla del admin
  (1.000 / 5.000 / 10.000). Se redondea el precio unitario antes de entrar al carrito, así
  el total del pedido es la suma de precios redondos.
- Cotización: dólar **blue en Córdoba, columna Venta**, de
  https://www.infodolar.com/cotizacion-dolar-provincia-cordoba.aspx
  (fila "Dólar Blue en Córdoba", formato `$ 1.561,00`; el 05/10 estaba en compra 1.529 y venta 1.561).
  WP-Cron cada 30 min con `wp_remote_get` y parseo del HTML. Se guarda en una option con valor y fecha.
- Barandas: valor entre 500 y 10.000; si cambia más de 15% contra el último, no se aplica y se
  avisa por mail al admin. Si falla la lectura, se mantiene el último valor. Si el último valor
  tiene más de 24 h, los productos USD pasan a "Consultar por WhatsApp" y no se pueden comprar.
- La conversión se aplica en el render (filtros `woocommerce_product_get_price` y relacionados)
  y en carrito, checkout y Store API. **Nunca en `/wc/v3` ni en el admin.** El pedido web queda en ARS.
- El filtro por precio y el orden por precio tienen que contemplar los productos USD.
- Pantalla en el admin: cotización actual, última actualización y un campo para forzarla a mano.
- La `_purchase_note` "⚠️ Precio en dólares…" de esos productos se reemplaza (con OK de Matias).

## Pagos

- Mercado Pago (cuenta de producción ya cargada) y transferencia bancaria.
- **Efectivo:** pasarela `cod` renombrada "Efectivo al retirar en el local", habilitada **solo**
  con el método de envío retiro en local.
- El modo prueba de Mercado Pago está **ACTIVADO**. Se apaga el viernes a la mañana, después de
  hacer una compra real de punta a punta. Nunca antes.

## Envíos

- **Retiro en el local** (Caseros 924): gratis. Es el único que admite efectivo.
- **Gratis desde $100.000** en todo el país (`free_shipping` con mínimo 100000).
- **Menos de $100.000:** cotización automática con Correo Argentino for WooCommerce.
  Lucas o Matias tienen que conectar la cuenta MiCorreo en WooCommerce → Ajustes → Envío →
  Correo Argentino (hoy está desconectado).
- Ningún producto tiene peso: cargá un **peso y medidas por defecto por categoría** con un
  filtro (sin escribir en los productos). La tabla se le pasa a Matias para aprobar.
- **Plan B**, si el jueves 12:00 Correo Argentino no cotiza: `flat_rate` estimado por zona
  (Córdoba / Centro / Resto del país) con montos que pase Matias.
- Borrar la zona actual "Todo el país" que tiene envío gratis sin mínimo.

## Lanzamiento (viernes)

Backup → compra real con Mercado Pago → modo prueba de MP OFF → modo "próximamente" OFF →
`blog_public = 1` (sacar noindex) → sitemap → Search Console → mirar /pos y una venta del POS.

## Forma de trabajo

- Antes de cada cambio en producción: backup (`wp db export` fuera del webroot) y commit.
- Cambios chicos, en orden, verificando cada uno (mirá la página, no solo el código).
- Mobile first. Probá todo a 375 px.
- Al final del día: un resumen corto para Matias con lo hecho, lo pendiente y lo que necesitás de él.
