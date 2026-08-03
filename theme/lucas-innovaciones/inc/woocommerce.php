<?php
/**
 * Integración con WooCommerce.
 *
 * El tema anterior (Hello Elementor) delegaba el 100% del renderizado de la
 * tienda al Theme Builder de Elementor. Acá se dibuja todo desde el tema.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/* -------------------------------------------------------------------------
 * Envoltorios: se reemplazan los de WooCommerce por los del tema.
 * ---------------------------------------------------------------------- */

remove_action( 'woocommerce_before_main_content', 'woocommerce_output_content_wrapper', 10 );
remove_action( 'woocommerce_after_main_content', 'woocommerce_output_content_wrapper_end', 10 );
remove_action( 'woocommerce_before_main_content', 'woocommerce_breadcrumb', 20 );
remove_action( 'woocommerce_sidebar', 'woocommerce_get_sidebar', 10 );

add_action( 'woocommerce_before_main_content', 'li_wc_abrir', 10 );
add_action( 'woocommerce_after_main_content', 'li_wc_cerrar', 10 );

/**
 * Apertura del contenedor principal de la tienda.
 */
function li_wc_abrir(): void {
	echo '<main id="contenido" class="contenido contenido--tienda">';
	echo '<div class="contenedor">';
	li_migas();
}

/**
 * Cierre del contenedor principal.
 */
function li_wc_cerrar(): void {
	echo '</div></main>';
}

/* -------------------------------------------------------------------------
 * Catálogo
 * ---------------------------------------------------------------------- */

add_filter( 'loop_shop_columns', fn() => 4, 20 );
add_filter( 'loop_shop_per_page', fn() => 24, 20 );

add_filter( 'woocommerce_product_loop_start', 'li_abrir_grilla' );
/**
 * Reemplaza el contenedor del bucle por la retícula del tema.
 *
 * @param string $html HTML original.
 * @return string
 */
function li_abrir_grilla( string $html ): string {
	return '<ul class="grilla productos">';
}

add_filter( 'woocommerce_product_loop_end', fn() => '</ul>' );

// La descripción de categoría y el título los dibuja la plantilla del tema.
remove_action( 'woocommerce_archive_description', 'woocommerce_taxonomy_archive_description', 10 );
remove_action( 'woocommerce_archive_description', 'woocommerce_product_archive_description', 10 );

// Estructura de la tarjeta de producto: se reconstruye entera.
remove_action( 'woocommerce_before_shop_loop_item', 'woocommerce_template_loop_product_link_open', 10 );
remove_action( 'woocommerce_before_shop_loop_item_title', 'woocommerce_show_product_loop_sale_flash', 10 );
remove_action( 'woocommerce_before_shop_loop_item_title', 'woocommerce_template_loop_product_thumbnail', 10 );
remove_action( 'woocommerce_shop_loop_item_title', 'woocommerce_template_loop_product_title', 10 );
remove_action( 'woocommerce_after_shop_loop_item_title', 'woocommerce_template_loop_rating', 5 );
remove_action( 'woocommerce_after_shop_loop_item_title', 'woocommerce_template_loop_price', 10 );
remove_action( 'woocommerce_after_shop_loop_item', 'woocommerce_template_loop_product_link_close', 5 );
remove_action( 'woocommerce_after_shop_loop_item', 'woocommerce_template_loop_add_to_cart', 10 );

/* -------------------------------------------------------------------------
 * Ficha de producto
 * ---------------------------------------------------------------------- */

// Las reseñas están deshabilitadas en este sitio y no hay historial que las alimente.
remove_action( 'woocommerce_single_product_summary', 'woocommerce_template_single_rating', 10 );

add_filter( 'woocommerce_product_tabs', 'li_pestanas_producto', 98 );
/**
 * Quita la pestaña de valoraciones y renombra la de información adicional.
 *
 * @param array<string,array> $tabs Pestañas.
 * @return array<string,array>
 */
function li_pestanas_producto( array $tabs ): array {
	unset( $tabs['reviews'] );

	if ( isset( $tabs['additional_information'] ) ) {
		$tabs['additional_information']['title'] = __( 'Especificaciones', 'lucasinnovaciones' );
	}
	if ( isset( $tabs['description'] ) ) {
		$tabs['description']['title'] = __( 'Descripción', 'lucasinnovaciones' );
	}

	return $tabs;
}

/* -------------------------------------------------------------------------
 * Ajustes de presentación
 * ---------------------------------------------------------------------- */

add_filter( 'woocommerce_sale_flash', 'li_etiqueta_oferta', 10, 3 );
/**
 * Reemplaza "¡Oferta!" por el porcentaje real de descuento.
 *
 * @param string     $html    HTML original.
 * @param WP_Post    $post    Entrada.
 * @param WC_Product $product Producto.
 * @return string
 */
function li_etiqueta_oferta( string $html, $post, $product ): string {
	$normal = (float) $product->get_regular_price();
	$oferta = (float) $product->get_sale_price();

	if ( $normal <= 0 || $oferta <= 0 || $oferta >= $normal ) {
		return '<span class="chip chip--oferta">' . esc_html__( 'Oferta', 'lucasinnovaciones' ) . '</span>';
	}

	$pct = (int) round( ( ( $normal - $oferta ) / $normal ) * 100 );

	return sprintf(
		'<span class="chip chip--oferta"><span class="chip__num">-%d%%</span></span>',
		$pct
	);
}

add_filter( 'woocommerce_get_availability_text', 'li_texto_stock', 10, 2 );
/**
 * Texto de disponibilidad en castellano rioplatense y sin exponer cifras irreales.
 *
 * @param string     $texto   Texto original.
 * @param WC_Product $product Producto.
 * @return string
 */
function li_texto_stock( string $texto, $product ): string {
	if ( ! $product->is_in_stock() ) {
		return __( 'Sin stock', 'lucasinnovaciones' );
	}

	if ( ! $product->managing_stock() ) {
		return __( 'Disponible', 'lucasinnovaciones' );
	}

	$n = (int) $product->get_stock_quantity();

	// Hay productos con stock cargado en valores irreales (9.708, 999.979).
	// Mostrar el número exacto sería ridículo y además revela el desorden.
	if ( $n > 20 ) {
		return __( 'Disponible', 'lucasinnovaciones' );
	}

	if ( $n <= 3 ) {
		/* translators: %d: unidades restantes. */
		return sprintf( _n( 'Última unidad', 'Quedan %d unidades', $n, 'lucasinnovaciones' ), $n );
	}

	return __( 'Disponible', 'lucasinnovaciones' );
}

add_filter( 'woocommerce_product_add_to_cart_text', 'li_texto_agregar', 10, 2 );
/**
 * Texto del botón según el tipo de producto.
 *
 * @param string     $texto   Texto original.
 * @param WC_Product $product Producto.
 * @return string
 */
function li_texto_agregar( string $texto, $product ): string {
	if ( $product->is_type( 'variable' ) ) {
		return __( 'Elegir modelo', 'lucasinnovaciones' );
	}
	if ( ! $product->is_in_stock() ) {
		return __( 'Sin stock', 'lucasinnovaciones' );
	}
	return __( 'Agregar', 'lucasinnovaciones' );
}

add_filter( 'woocommerce_product_single_add_to_cart_text', fn() => __( 'Agregar al carrito', 'lucasinnovaciones' ) );

add_filter( 'woocommerce_breadcrumb_defaults', fn( array $d ) => array_merge( $d, array( 'delimiter' => '' ) ) );

/* -------------------------------------------------------------------------
 * Productos "Solo mostrador"
 *
 * Regla operativa (D19): un producto en esa categoría no se muestra online,
 * aunque alguien olvide marcarle la visibilidad oculta a mano.
 * ---------------------------------------------------------------------- */

add_action( 'pre_get_posts', 'li_ocultar_solo_mostrador' );
/**
 * Excluye del frente cualquier producto de la categoría "Solo mostrador".
 *
 * @param WP_Query $q Consulta.
 */
function li_ocultar_solo_mostrador( $q ): void {
	if ( is_admin() || ! $q->is_main_query() ) {
		return;
	}

	$term = get_term_by( 'slug', 'solo-mostrador', 'product_cat' );
	if ( ! $term || is_wp_error( $term ) ) {
		return;
	}

	$tax = (array) $q->get( 'tax_query' );
	$tax[] = array(
		'taxonomy' => 'product_cat',
		'field'    => 'term_id',
		'terms'    => array( $term->term_id ),
		'operator' => 'NOT IN',
	);
	$q->set( 'tax_query', $tax );
}

/* -------------------------------------------------------------------------
 * Rendimiento
 * ---------------------------------------------------------------------- */

add_filter( 'woocommerce_enqueue_styles', '__return_empty_array' );

add_action( 'wp_enqueue_scripts', 'li_limpiar_scripts_wc', 99 );
/**
 * Descarta scripts de WooCommerce fuera de contexto.
 *
 * Con 803 productos, cargar el JS del carrito en la home es peso muerto.
 */
function li_limpiar_scripts_wc(): void {
	if ( is_cart() || is_checkout() || is_account_page() ) {
		return;
	}

	if ( ! is_woocommerce() ) {
		wp_dequeue_script( 'wc-cart-fragments' );
	}
}
