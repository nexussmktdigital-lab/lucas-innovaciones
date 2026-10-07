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
	echo '<main id="contenido" class="li-shop">';
	echo '<div class="li-wrap">';
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
// 21 = 7 filas de 3 en desktop. Cada página sale llena salvo la última.
add_filter( 'loop_shop_per_page', fn() => 21, 20 );

add_filter( 'woocommerce_product_loop_start', 'li_abrir_grilla' );
/**
 * Reemplaza el contenedor del bucle por la retícula del tema.
 *
 * @param string $html HTML original.
 * @return string
 */
function li_abrir_grilla( string $html ): string {
	return '<ul class="li-grid grilla productos">';
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

add_filter( 'woocommerce_product_single_add_to_cart_text', fn() => __( 'Comprar ahora', 'lucasinnovaciones' ) );

/*
 * "Comprar ahora" (ficha, Product.jsx) lleva directo a finalizar compra.
 * La marca viaja en el formulario de la ficha; agregar desde otro lado
 * (carrito, Store API) sigue el flujo normal.
 */
add_action( 'woocommerce_before_add_to_cart_button', static function () {
	echo '<input type="hidden" name="li_comprar_ahora" value="1">';
} );

add_filter( 'woocommerce_add_to_cart_redirect', 'li_comprar_ahora_redirect', 20 );
/**
 * @param string $url Destino por defecto.
 */
function li_comprar_ahora_redirect( $url ) {
	// phpcs:ignore WordPress.Security.NonceVerification -- solo decide a dónde redirigir.
	return empty( $_REQUEST['li_comprar_ahora'] ) ? $url : wc_get_checkout_url();
}

add_filter( 'woocommerce_account_menu_items', 'li_menu_cuenta' );
/**
 * Mi cuenta sin "Descargas": la tienda no vende archivos.
 *
 * @param array<string,string> $items Pestañas.
 * @return array<string,string>
 */
function li_menu_cuenta( array $items ): array {
	unset( $items['downloads'] );
	return $items;
}

add_filter( 'render_block_woocommerce/empty-cart-block', 'li_carrito_vacio' );
/**
 * Carrito vacío con el texto del kit, sin tocar el contenido de la página.
 *
 * @param string $html HTML del bloque.
 */
function li_carrito_vacio( string $html ): string {
	return sprintf(
		'<div class="wp-block-woocommerce-empty-cart-block"><h2 class="wc-block-cart__empty-cart__title">%s</h2><p>%s</p><a class="li-btn li-btn--primary li-btn--lg li-empty__cta" href="%s">%s</a></div>',
		esc_html__( 'Tu carrito está esperando.', 'lucasinnovaciones' ),
		esc_html__( 'Elegí algo del catálogo y te lo preparamos.', 'lucasinnovaciones' ),
		esc_url( wc_get_page_permalink( 'shop' ) ),
		esc_html__( 'Ver catálogo', 'lucasinnovaciones' )
	);
}

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

	$tax = (array) $q->get( 'tax_query' );
	$tax[] = array(
		'taxonomy' => 'product_cat',
		'field'    => 'slug',
		'terms'    => LI_CATS_SOLO_MOSTRADOR,
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

/* -------------------------------------------------------------------------
 * Transferencia y mails
 * ---------------------------------------------------------------------- */

add_filter( 'woocommerce_bacs_account_fields', 'li_campos_transferencia', 10, 2 );
/**
 * Datos de la cuenta con los nombres de acá. WooCommerce no trae el formato
 * argentino y rotula "Sort code" e "IBAN": en los ajustes, el CBU va en
 * "Sort code" y el alias en "IBAN".
 *
 * @param array $campos   Campos de la cuenta.
 * @param int   $order_id Pedido.
 * @return array
 */
function li_campos_transferencia( $campos, $order_id ) {
	$out = array();
	$mapa = array(
		'bank_name'      => 'Banco',
		'account_number' => 'Cuenta',
		'sort_code'      => 'CBU',
		'iban'           => 'Alias',
	);
	foreach ( $mapa as $clave => $label ) {
		if ( ! empty( $campos[ $clave ]['value'] ) ) {
			$out[ $clave ] = array(
				'label' => $label,
				'value' => $campos[ $clave ]['value'],
			);
		}
	}
	return $out;
}

add_filter( 'woocommerce_email_headers', 'li_responder_al_local', 10, 3 );
/**
 * Si el cliente responde un mail de su pedido, la respuesta le llega al local.
 * El remitente tiene que ser del dominio (si no, cae en spam); la casilla que
 * el local lee es otra.
 *
 * @param string $headers  Cabeceras.
 * @param string $email_id Tipo de mail.
 * @param mixed  $objeto   Pedido u otro objeto.
 * @return string
 */
function li_responder_al_local( $headers, $email_id, $objeto = null ) {
	if ( ! str_starts_with( (string) $email_id, 'customer_' ) ) {
		return $headers;
	}
	$headers = (string) preg_replace( '/^Reply-to:.*\r?\n/mi', '', (string) $headers );
	return $headers . "Reply-to: Lucas Innovaciones <" . LI_MAIL_LOCAL . ">\r\n";
}

add_filter( 'woocommerce_get_country_locale', 'li_campos_argentina', 30 );
/**
 * Rótulos del checkout en castellano de acá. El plugin de Correo Argentino
 * vuelve obligatoria la altura (la necesita para la etiqueta): se mantiene,
 * pero rotulada como lo que es, para que no parezca opcional.
 *
 * @param array $locale Configuración por país.
 * @return array
 */
function li_campos_argentina( $locale ) {
	$rotulos = array(
		'last_name' => 'Apellido',
		'address_1' => 'Calle',
		'address_2' => 'Altura (número), piso y depto.',
		'city'      => 'Localidad',
		'state'     => 'Provincia',
		'postcode'  => 'Código postal',
	);
	foreach ( $rotulos as $campo => $rotulo ) {
		$locale['AR'][ $campo ]['label'] = $rotulo;
		if ( isset( $locale['AR'][ $campo ]['placeholder'] ) ) {
			$locale['AR'][ $campo ]['placeholder'] = $rotulo;
		}
	}
	return $locale;
}

add_filter( 'gettext_woocommerce', 'li_textos_checkout', 10, 2 );
/**
 * Textos sueltos del checkout y del pedido que la traducción deja en
 * castellano de España o sin traducir.
 *
 * @param string $traduccion Texto traducido.
 * @param string $original   Texto original.
 * @return string
 */
function li_textos_checkout( $traduccion, $original ) {
	static $mapa = array(
		'Shipping:'                                   => 'Envío:',
		'Add a note to your order'                    => 'Agregá una nota a tu pedido',
		'Thank you. Your order has been received.'    => 'Gracias. Recibimos tu pedido.',
		'Notes about your order, e.g. special notes for delivery.' => 'Notas sobre tu pedido, por ejemplo, para la entrega.',
	);
	return $mapa[ $original ] ?? $traduccion;
}
