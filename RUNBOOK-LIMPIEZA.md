# Runbook — Limpieza del WordPress

**Estado:** ensayado y verificado en staging el 2026-08-03. Pendiente de aplicar en producción.

Este documento es el procedimiento exacto validado en el clon. No improvisar sobre producción: seguir estos pasos en este orden.

---

## Resultado medido en staging

| Métrica | Antes | Después | Cambio |
|---|---|---|---|
| Peso de la base | 64,0 MB | 62,3 MB | −1,7 MB |
| Tablas | 69 | 58 | **−11** |
| Posts | 4.879 | 4.758 | −121 |
| Postmeta | 150.152 | 149.297 | −855 |
| Opciones | 912 | 804 | −108 |
| Autoload | 53,8 KB | 48,7 KB | −5,1 KB |
| **Peso de la Home** | **69,7 KB** | **26,6 KB** | **−62%** |
| **Peso de Tienda** | **71,0 KB** | **30,9 KB** | **−56%** |

Datos intactos tras la limpieza: 803 productos · 3.764 pedidos · 112 categorías · 243 sesiones de caja.
Home, Tienda, Carrito, Mi cuenta y ficha de producto: **200, sin errores PHP**.

---

## ⚠️ Requisitos previos innegociables

1. **Backup completo de producción** (archivos + base), verificado y restaurable.
2. **El tema propio tiene que estar terminado y activo.** Al purgar Elementor, la Home queda con contenido de longitud 0 — su diseño vivía dentro de `_elementor_data`.

   > ### ⚠️ Corrección de un diagnóstico previo
   >
   > Tras la purga se observó que la Tienda mostraba 0 productos y las fichas no tenían precio ni botón de compra. **Se atribuyó a que `Hello Elementor` no tiene plantillas de WooCommerce.** Ese diagnóstico era incorrecto.
   >
   > La causa real, descubierta al activar el tema propio, es que **WooCommerce tiene activado el modo "Próximamente"**:
   >
   > ```
   > woocommerce_coming_soon    = yes
   > woocommerce_store_pages_only = yes
   > ```
   >
   > **Está así en staging y también en producción.** La tienda nunca se renderizó públicamente — no por falta de plantillas, sino porque WooCommerce la reemplaza por una pantalla de "próximamente" desde antes de tocar nada.
   >
   > Lo que sí es cierto y está verificado: `Hello Elementor` no tiene `woocommerce.php`, ni `single-product.php`, ni carpeta `/woocommerce/`. Pero **no se llegó a demostrar** que eso rompiera el renderizado, porque el modo "Próximamente" enmascaraba cualquier resultado.
   >
   > Con el tema propio activo y `woocommerce_coming_soon = no`, la tienda renderiza correctamente: 24 tarjetas por página sobre 797 productos, fichas con precio, y el selector de variaciones funcionando.

   **El POS no se ve afectado** por nada de esto: es una SPA independiente que consume la REST API, no las plantillas del tema. Verificado en staging tras la purga.
3. **Fuera de horario comercial.** El POS de YITH no se toca en ningún paso, pero cualquier operación sobre la base merece ventana tranquila.
4. **Rescatar antes de borrar** — ver [RESCATE-PRE-LIMPIEZA.md](RESCATE-PRE-LIMPIEZA.md) y [DESIGN-TOKENS.md](DESIGN-TOKENS.md).

---

## 🐛 Trampa encontrada en el ensayo: `str_replace` secuencial

Al reescribir URLs se usó:

```php
str_replace(['http://'.$D, 'https://'.$D], $NUEVA, $s);   // ← MAL
```

`str_replace` con un array de búsquedas las aplica **en secuencia sobre el resultado anterior**. El primer término convirtió `http://dominio` en `https://dominio/staging`, y luego el segundo término `https://dominio` volvió a encontrarlo dentro de ese resultado, produciendo `/staging/staging/`. **39 filas quedaron corruptas** y hubo que corregirlas.

**Esto aplica directo a producción**, porque hay que hacer la migración `http://` → `https://` (P-HTTPS). Forma correcta:

```php
$s = str_replace('http://'.$D, 'https://'.$D, $s);        // 1. normalizar protocolo
$s = str_replace('https://'.$D.'/staging', '@@K@@', $s);  // 2. proteger lo ya correcto
$s = str_replace('https://'.$D, $NUEVA, $s);              // 3. reemplazar
$s = str_replace('@@K@@', $NUEVA, $s);                    // 4. restaurar
```

Y **siempre** verificar después:

```sql
SELECT COUNT(*) FROM wp_posts    WHERE post_content LIKE '%/staging/staging/%';
SELECT COUNT(*) FROM wp_postmeta WHERE meta_value   LIKE '%//%//%';
```

Recordar además que los valores serializados deben pasar por `maybe_unserialize` → reemplazo recursivo → `maybe_serialize`, nunca por reemplazo de texto plano (rompe los prefijos de longitud).

---

## Procedimiento

### Paso 0 — Rescate

- [ ] Exportar los colores y tipografías del Kit de Elementor (`_elementor_page_settings` del post del kit activo, `get_option('elementor_active_kit')`)
- [ ] Descargar la fuente personalizada **VT323-Regular.ttf** (146 KB) de `wp-content/uploads/2026/04/`
- [ ] Copiar el contenido de `wp_snippets` (hay un shortcode propio de testimonios)
- [ ] Registrar el historial de plugins de `wp_jetpack_sync_queue` antes de eliminar la tabla

### Paso 1 — Desactivar plugins

```php
$ap = get_option('active_plugins');
$quitar = ['elementor/elementor.php', 'pro-elements/pro-elements.php'];
$nuevo = [];
foreach ($ap as $p) {
    if (in_array($p, $quitar, true)) continue;
    if (!file_exists(WP_PLUGIN_DIR.'/'.$p)) continue;   // entradas fantasma
    $nuevo[] = $p;
}
update_option('active_plugins', array_values(array_unique($nuevo)));
```

> **Hallazgo:** `active_plugins` en producción tiene **`woocommerce/woocommerce.php` duplicado**. El `array_unique` lo corrige. Es inofensivo pero conviene dejarlo limpio.

### Paso 2 — Borrar los CPT de Elementor y ACF, con sus revisiones

Tipos a eliminar: `elementor_library`, `elementor_font`, `elementor_icons`, `elementor_snippet`, `acf-post-type`.
Incluir las revisiones cuyo `post_parent` sea uno de esos IDs, **más las revisiones de la Home** (en staging fueron 111 revisiones sobre 10 CPT).

Para cada lote de IDs, en este orden:

```sql
DELETE FROM wp_postmeta          WHERE post_id   IN (...);
DELETE FROM wp_term_relationships WHERE object_id IN (...);
DELETE FROM wp_posts             WHERE ID        IN (...);
```

### Paso 3 — Metadatos y opciones

```sql
DELETE FROM wp_postmeta WHERE meta_key LIKE '\_elementor%';
DELETE FROM wp_options  WHERE option_name LIKE 'elementor%';
DELETE FROM wp_options  WHERE option_name LIKE '\_elementor%';   -- ← no olvidar el guion bajo
DELETE FROM wp_options  WHERE option_name IN ('_hello-elementor_notifications','widget_elementor-library','theme_mods_hello-elementor-child');
DELETE FROM wp_options  WHERE option_name LIKE 'icl%' OR option_name LIKE '%wpml%';
```

> **Trampa:** el primer intento usó solo `LIKE 'elementor%'` y dejó **18 opciones** sin borrar, porque Elementor guarda la mayoría con guion bajo inicial (`_elementor_home_screen_data`, `_elementor_notifications_data`, etc.). Hay que ejecutar los dos patrones.

**Conservar:** `theme_mods_hello-elementor` mientras el tema siga activo.

### Paso 4 — Taxonomías huérfanas

```sql
DELETE tt, t FROM wp_term_taxonomy tt
  JOIN wp_terms t ON t.term_id = tt.term_id
  WHERE tt.taxonomy IN ('elementor_library_type','elementor_font_type');
```

### Paso 5 — Tablas residuales

```sql
DROP TABLE IF EXISTS wp_e_events, wp_e_notes, wp_e_notes_users_relations,
  wp_e_submissions, wp_e_submissions_actions_log, wp_e_submissions_values,
  wp_icl_strings, wp_icl_string_translations,
  wp_jetpack_sync_queue, wp_ev_claves, wp_snippets;
```

### Paso 6 — Archivos

- [ ] Eliminar `wp-content/plugins/elementor/` (85,9 MB) y `wp-content/plugins/pro-elements/` (15,9 MB)
- [ ] Eliminar las carpetas huérfanas `wp-content/jetpack-waf/` y `wp-content/ai1wm-backups/`
- [ ] Eliminar `wp-content/wp-cache-config.php` (residuo de WP Super Cache)
- [ ] **Decidir por separado** sobre `wp-content/object-cache.php`: está activo y funcionando contra Valkey, pero el plugin LiteSpeed Cache no está instalado. No se puede purgar desde el escritorio. Ver deuda técnica en BASES.md

### Paso 7 — Verificación

- [ ] Home, Tienda, Carrito, Mi cuenta y una ficha de producto responden **200**
- [ ] Ningún `Fatal error` ni `Warning:` en el HTML
- [ ] Conteos intactos: 803 productos · 3.764 pedidos · 112 categorías · 243 sesiones de caja
- [ ] **El POS de YITH abre y permite registrar una venta de prueba**
- [ ] Cero residuos: `SELECT COUNT(*) FROM wp_options WHERE option_name LIKE '%elementor%'` debe devolver 1 (`theme_mods_hello-elementor`) o 0
- [ ] Purgar la caché de LiteSpeed

---

## Fuera de este runbook

Estas tareas son de la Fase 1 (higiene de datos) y van por separado:

- 1.736 etiquetas de producto a depurar
- 3.762 filas vacías en `wp_wc_customer_lookup`
- Notas internas en títulos de producto (P13)
- Recategorización de usados (P14)
- Stock ficticio y precios basura
- Sesión de caja huérfana `id 1` (P20)
