# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es este repositorio

Código fuente de **lucasinnovaciones.com.ar** — un WordPress/WooCommerce en producción que **factura ~10 pedidos por día** desde el mostrador con YITH Point of Sale. El repositorio contiene únicamente lo que se escribe de cero:

- `theme/lucas-innovaciones/` — tema propio, sin maquetador visual (D9). Reemplaza a Hello Elementor + Elementor + PRO Elements.
- `plugin/lucas-cotizacion/` — plugin propio que reescribe a pesos los precios cargados en dólares.
- Los `.md` de la raíz son la memoria del proyecto, no documentación decorativa. Leerlos antes de decidir nada.

El WordPress en sí (core, uploads, base de datos) **no está versionado**: vive en el hosting y se opera por MCP.

## Regla 0 — Continuidad operativa

> **YITH POS no se desactiva, no se borra y no se actualiza hasta que el reemplazo esté validado en producción durante el período de convivencia.**

El POS es el **único canal de venta** del negocio (3.764 pedidos históricos, 0 ventas online). De esto se derivan reglas duras que aplican a cualquier tarea en este repo:

1. **Todo cambio que toque el flujo de venta pasa primero por staging.** Nunca se escribe primero en producción.
2. **Ningún despliegue en horario comercial.** El local atiende de 9 a 12:30 y de 17 a 21.
3. **Nunca SQL directo sobre términos, productos o pedidos.** Se usa la API de WordPress (`wp_insert_term`, `wp_set_object_terms`, `wp_delete_term`…) y la CRUD API de WooCommerce (D6). WooCommerce mantiene tablas derivadas (`wc_category_lookup`, `wc_product_meta_lookup`) por hooks: escribir a mano las desincroniza en silencio.
4. **Antes de borrar, contar; después de escribir, verificar.** El precedente correcto está en `MIGRACION-TAXONOMIA.md`: cada término se comprobó vacío y sin hijas antes de borrarlo, y al final se compararon los árboles de producción y staging término por término.
5. **Respaldo antes de cualquier operación masiva**, a un JSON en `wp-content/uploads/` (ver `li-taxonomia-produccion-antes-20260806.json`).
6. **Los productos no se borran.** Se ocultan (`catalog_visibility = hidden`) o se marcan sin stock. Borrar rompe URLs, SEO e historial (D13, P10).

## Despliegue por Novamira

No hay SSH, FTP ni panel compartido. El único acceso al servidor es el **MCP del plugin Novamira** (PHP, WP-CLI, lectura y escritura de archivos), con dos endpoints: producción y staging.

```
Repositorio local (git)
      ↓  ./despliegue/empaquetar.sh        (git archive → dist/*.zip)
novamira/create-upload-link
      ↓
Instalación y activación por WP-CLI en STAGING
      ↓  ./despliegue/verificar.php        (90/90 contra manifest.md5)
Mismo procedimiento contra PRODUCCIÓN, fuera de horario comercial
```

**El procedimiento completo está en [`RUNBOOK-DESPLIEGUE.md`](RUNBOOK-DESPLIEGUE.md)** — incluye el rollback, y dos trampas que solo aparecen en producción: la verificación funcional hay que hacerla con sesión iniciada (el modo "próximamente" devuelve 200 sin mostrar nada del tema) y la caché de objetos solo se purga con `wp cache flush`, porque el plugin de LiteSpeed no está instalado.

Un ZIP se descomprime **encima** de lo que había: los archivos que el repositorio ya no tiene no se borran solos, y WordPress usa las plantillas que encuentra. `despliegue/verificar.php` contrasta el servidor contra `despliegue/manifest.md5` y detecta las tres formas de divergencia: `FALTA`, `DIFIERE` y `SOBRA`. **Regenerar el manifiesto con `./despliegue/generar-manifiesto.sh` en el mismo commit que cambie el tema o el plugin**, o la próxima verificación falla sobre código que en realidad está bien.

Restricciones verificadas en el servidor, no negociables:

- `open_basedir` limita PHP a `/home/l0070559/public_html`. El staging vive **dentro** de producción: `/home/l0070559/public_html/staging/` → `https://lucasinnovaciones.com.ar/staging`.
- **El MCP no escribe archivos PHP fuera de `wp-content/novamira-sandbox/`.** El tema no se desarrolla escribiendo archivos sueltos por esa vía: se sube empaquetado.
- `exec`, `shell_exec`, `proc_open` y `eval` están deshabilitados. `max_execution_time` = 30s, memoria 256 MB. Cualquier operación masiva se corre por lotes.
- `DISABLE_WP_CRON = true` en ambos entornos. WordPress no dispara nada por sí solo (P30).
- Object cache de LiteSpeed activo en producción contra Valkey `db_id 559`, **sin el plugin instalado**: no hay forma de purgarlo desde el escritorio. El staging lo tiene desactivado a propósito para no colisionar claves.

**`.gitattributes` fuerza `eol=lf` y esto es funcional, no estilístico:** el despliegue verifica cada archivo comparando su MD5 con la copia local. Con CRLF ese hash nunca coincidiría y el repo divergiría del servidor sin aviso. No cambiar esa configuración.

### Checklist de validación después de desplegar

- Home, Tienda, Carrito, Finalizar compra, Mi cuenta y una ficha de producto responden **200**
- Cero `Fatal error` y cero `Warning:` en el HTML
- Conteos intactos: **803 productos · 3.764 pedidos · 82 categorías · 243 sesiones de caja**
- **El POS de YITH abre y permite registrar una venta de prueba**
- Purgar la caché de LiteSpeed

## Sin build, sin tests

No hay `package.json`, ni compilador, ni suite de tests. El CSS y el JS se escriben a mano y se sirven tal cual (`assets.php` cachea por `filemtime`, no por versión). La verificación es funcional: cargar las páginas en staging y mirar el HTML.

El código sigue **WordPress Coding Standards** (se ven los `phpcs:ignore` en el árbol) aunque no hay `phpcs.xml` en el repo. Si se corre PHPCS, usar el estándar `WordPress`.

## Arquitectura del tema

`functions.php` define `LI_VERSION`, `LI_DIR`, `LI_URI` y carga `inc/` en un orden que importa: `medallones.php` define `li_termino_imagen()` y `li_marca_logo()`, que `portada.php` usa al armar su caché. Todo lo que depende de WooCommerce se carga dentro de un `class_exists( 'WooCommerce' )`.

| Módulo | Responsabilidad |
|---|---|
| `inc/setup.php` | Soportes del tema, menús, tamaño `li-card`, sidebar `filtros-catalogo` |
| `inc/assets.php` | Encolado; **desencola las hojas de WooCommerce** porque el tema dibuja todo, salvo en carrito/checkout/cuenta donde sí hacen falta |
| `inc/woocommerce.php` | Reemplaza los envoltorios de WooCommerce por los del tema; textos de stock y de "agregar"; oculta la categoría `solo-mostrador` del catálogo público |
| `inc/portada.php` | Datos de la home cacheados en transient, invalidados por `save_post_product` |
| `inc/categoria.php` | Filtrado del catálogo por `pre_get_posts`, árbol de categorías, carrusel de marcas, y el **fragmento AJAX de resultados** (`li_fragmento_resultados`) |
| `inc/facetas.php` | Panel de filtros por atributo `pa_*` con conteos calculados sobre el conjunto en contexto |
| `inc/precio.php` | Filtro por rango de precio vía `posts_clauses`, tramos y formato |
| `inc/menu.php` | Navegación derivada del árbol real de `product_cat`, cacheada e invalidada por hooks de término y producto |
| `inc/medallones.php` | Imágenes de categoría y logos de marca, con **fallback a SVG generado** cuando no hay archivo |
| `inc/banners.php` | Slides de la portada y de categoría. Hoy son tipográficos, sin fotos |

**El catálogo y la búsqueda son la misma pantalla.** `li_busqueda_a_productos()` redirige toda búsqueda al archivo de productos, y `archive-product.php` sirve tienda, categoría, marca y atributo con la misma grilla.

**Carrito y Finalizar compra usan los bloques de WooCommerce, no los shortcodes clásicos (D21)** — los bloques traen retiro en el local de forma nativa, que es el canal principal del negocio. El tema aporta el envoltorio (`page.php`) y `assets/css/blocks.css`, que traduce el sistema visual a las clases de los bloques. **No convertirlas a shortcodes.**

Convenciones: todo prefijado `li_` / `LI_`, todo el código y los comentarios en **español rioplatense**, text domain `lucasinnovaciones`.

## Sistema visual

`DESIGN-TOKENS.md` documenta la paleta rescatada del Kit de Elementor. Los tokens de color siguen vigentes y viven en `assets/css/theme.css` (`--li-*`).

**La tipografía divergió del documento y el código manda:** el tema usa **Montserrat** (títulos e interfaz), **Lato** (cuerpo) e **IBM Plex Mono** (todo lo numérico), con **VT323** como acento de píxeles. `DESIGN-TOKENS.md` ya lo documenta y conserva el borrador de agosto marcado como histórico — pero los nombres de token de ese borrador (`--li-font-body`, `--li-primary-oscuro` como `--li-accent`, etc.) no son los que corren: **al tocar el tema, la referencia es `assets/css/theme.css`.** Las fuentes se sirven locales desde `assets/fonts/`, nunca desde Google Fonts.

## El plugin de cotización

`plugin/lucas-cotizacion/` mantiene en pesos los productos cargados en dólares (D22). El precio en USD (`_li_precio_usd`) es la fuente de verdad y el precio en ARS **se reescribe** dos veces por día tomando el blue de Córdoba, sin margen y redondeando al millar.

Se reescribe en lugar de convertir al mostrar porque **el POS lee el mismo `_price` que la web**, igual que el orden por precio, los filtros por rango, el carrito, Mercado Pago y los reportes. Es lógica de negocio, por eso es plugin y no tema.

## Estado del proyecto

Fases en `BASES.md` §9. Situación al último commit:

- **Fase 0** (infraestructura): staging clonado y protegido; falta la contraseña de directorio (P18) y la corrección de HTTPS de producción.
- **Fase 1** (higiene de datos): taxonomía migrada a producción (112 → 82 términos). **Los atributos `pa_*` están cargados en staging y en 0 de 807 productos de producción** — sin ellos los filtros del catálogo no muestran nada.
- **Fase 2/3** (diseño y tienda): tema construido y verificado en staging. **Todavía no está activo en producción.**
- **Bloqueante de lanzamiento:** faltan 143 fotos del top 150 (P6). Ninguna decisión de diseño lo resuelve: las fotos son el camino crítico.

Antes de tocar producción, releer `RUNBOOK-LIMPIEZA.md`: contiene la trampa del `str_replace` secuencial (que corrompió 39 filas en el ensayo) y el orden exacto de purga de Elementor. **Su requisito previo #2 es que el tema propio esté terminado y activo**, porque al purgar Elementor la Home queda con contenido de longitud 0.

Tres interruptores quedan en `no`/`0` hasta el día del lanzamiento: `woocommerce_coming_soon` (P26), `blog_public` (P19) y el `robots.txt` genérico de DonWeb (P18).

## Documentos de referencia

| Archivo | Qué responde |
|---|---|
| `BASES.md` | Objetivo, decisiones D1–D22, fases, pendientes P1–P31, riesgos |
| `RUNBOOK-LIMPIEZA.md` | Procedimiento exacto y ensayado para purgar Elementor |
| `MIGRACION-TAXONOMIA.md` | Mapa y resultado de la reestructuración de categorías |
| `MAPA-ATRIBUTOS.md` | Taxonomía de atributos `pa_*` y su carga |
| `DESIGN-TOKENS.md` | Paleta, tipografía y layout |
| `RESCATE-PRE-LIMPIEZA.md` | Código y assets recuperados antes de purgar |
| `RUNBOOK-DESPLIEGUE.md` | Cómo se sube el código al servidor y cómo se verifica |
| `catalogo-prioridad-fotos.csv` | Los 200 productos ordenados por rotación real — el cronograma del lanzamiento |
