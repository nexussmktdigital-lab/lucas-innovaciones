<?php
/**
 * Página "Próximamente" propia.
 *
 * Mientras WooCommerce esté en modo "Próximamente" para todo el sitio, el
 * público ve proximamente.php (con el logo y el design system) en lugar de la
 * pantalla genérica de WooCommerce. Las condiciones son las mismas que usa
 * WooCommerce: los admins y gestores de la tienda siguen viendo la tienda,
 * y si se activa el enlace privado de WooCommerce, decide WooCommerce.
 *
 * Cuando se lance la tienda (modo "Próximamente" apagado) esto no hace nada.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

add_filter( 'template_include', 'li_proximamente', 9 );

/**
 * @param string $plantilla Plantilla elegida.
 */
function li_proximamente( string $plantilla ): string {
	if ( 'yes' !== get_option( 'woocommerce_coming_soon' ) || 'yes' === get_option( 'woocommerce_store_pages_only' ) ) {
		return $plantilla;
	}
	if ( 'yes' === get_option( 'woocommerce_private_link' ) ) {
		return $plantilla; // Con enlace privado, que lo resuelva WooCommerce.
	}
	if ( current_user_can( 'manage_woocommerce' ) || is_robots() || is_feed() ) {
		return $plantilla;
	}
	if ( apply_filters( 'woocommerce_coming_soon_exclude', false ) ) {
		return $plantilla;
	}

	$propia = locate_template( 'proximamente.php' );
	if ( ! $propia ) {
		return $plantilla;
	}

	status_header( 200 );
	nocache_headers();
	header( 'Cache-Control: max-age=60' );
	header( 'X-Robots-Tag: noindex, nofollow' );
	include $propia;
	exit;
}
