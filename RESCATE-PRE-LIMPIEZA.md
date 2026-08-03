# Rescate previo a la limpieza — 2026-08-03

Material recuperado del staging **antes** de purgar los residuos de plugins. Nada de esto sobrevive a la limpieza, y parte tiene valor para las fases siguientes.

---

## 1. Historial de plugins del sitio

Reconstruido desde `wp_jetpack_sync_queue` (evento del 2026-04-25). El sitio tuvo instalados:

| Plugin | Nota |
|---|---|
| `advanced-custom-fields/acf.php` | Modelaba "Banners" y "Testimonios" |
| `all-in-one-wp-migration` + extensión unlimited | Explica la carpeta `ai1wm-backups` |
| **`cost-of-goods-for-woocommerce`** | **Gestionaba costos y márgenes.** Relevante para P-márgenes y para el POS |
| `creame-whatsapp-me/joinchat.php` | Botón de WhatsApp |
| `elementor` + `pro-elements` | A eliminar |
| `jetpack` | Explica la carpeta `jetpack-waf` |
| **`lucas-image-importer/lucas-image-importer.php`** | **Plugin propio, a medida.** Ver punto 3 |
| `woocommerce-mercadopago`, `woocommerce`, `yith-point-of-sale` | Vigentes |

---

## 2. Código a medida encontrado

En la tabla `wp_snippets` (plugin *Code Snippets*, ya desinstalado) había 5 fragmentos: 4 de ejemplo inactivos y **uno propio marcado como activo**.

Como el plugin ya no está instalado, **este código no se ejecuta hoy**. Se conserva porque documenta una funcionalidad que se llegó a construir.

**Snippet `id 5` — "shortcode testimonios"** · shortcode `[testimonios_doble_swiper]` · depende del CPT `testimonio` y de campos ACF (`nombre`, `estrellas`, `frase_clave`, `testimonio`):

```php
function shortcode_testimonios_doble_swiper() {

    $args = [
        'post_type'      => 'testimonio',
        'posts_per_page' => -1,
        'post_status'    => 'publish',
    ];

    $testimonios_left  = new WP_Query($args);
    $testimonios_right = new WP_Query($args);

    ob_start();
    ?>
    <div class="testimonios-wrapper">

        <!-- Slider izquierda -->
        <div class="clientes-swiper-cont" data-direction="left">
            <div class="clientes-swiper-list">
                <?php if ($testimonios_left->have_posts()) : ?>
                    <?php while ($testimonios_left->have_posts()) : $testimonios_left->the_post(); ?>
                        <div class="cliente-item">
                            <div class="testimonio-header">
                                <div class="testimonio-avatar">
                                    <?php if (has_post_thumbnail()) : ?>
                                        <?php the_post_thumbnail('thumbnail'); ?>
                                    <?php endif; ?>
                                    <span class="testimonio-nombre"><?php the_field('nombre'); ?></span>
                                </div>
                                <div class="testimonio-meta">
                                    <div class="testimonio-estrellas">
                                        <?php
                                        $estrellas = get_field('estrellas');
                                        if ($estrellas) :
                                            for ($i = 1; $i <= 5; $i++) :
                                                echo $i <= $estrellas ? '★' : '☆';
                                            endfor;
                                        endif;
                                        ?>
                                    </div>
                                </div>
                            </div>
                            <h4 class="testimonio-frase"><?php the_field('frase_clave'); ?></h4>
                            <p class="testimonio-texto"><?php the_field('testimonio'); ?></p>
                        </div>
                    <?php endwhile; wp_reset_postdata(); ?>
                <?php endif; ?>
            </div>
        </div>

        <!-- Slider derecha: misma estructura, data-direction="right" -->

    </div>
    <?php
    return ob_get_clean();
}
add_shortcode('testimonios_doble_swiper', 'shortcode_testimonios_doble_swiper');
```

**Decisión para la Fase 2:** el patrón de doble slider de testimonios se puede reimplementar nativamente en el tema propio, sin ACF ni Code Snippets. Pero primero hay que definir si la tienda va a tener testimonios — hoy **no hay ninguno cargado** y las reseñas de WooCommerce están deshabilitadas.

---

## 3. `lucas-image-importer` — plugin propio desaparecido

Aparece en el historial un plugin a medida llamado `lucas-image-importer`. **Ya no está instalado ni quedan sus archivos.**

Es directamente relevante: la vía B del plan de imágenes (D16) contempla construir un importador masivo por SKU. Conviene preguntarle al cliente si conserva ese plugin, qué hacía y por qué lo sacó — puede ahorrar trabajo o advertir de un problema ya conocido.

---

## 4. Sistema de diseño

Rescatado por separado en [DESIGN-TOKENS.md](DESIGN-TOKENS.md). Es el hallazgo de mayor valor: una paleta completa y deliberada con nomenclatura `LI`, que se habría perdido con la purga del Kit de Elementor.
