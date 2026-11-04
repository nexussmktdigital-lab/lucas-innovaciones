<?php
/**
 * GA4 y píxel de Meta (plugin PixelYourSite): sin datos internos en los eventos.
 *
 * El número entre paréntesis del final del nombre son los últimos dígitos del
 * IMEI: es interno y no sale de la tienda. PixelYourSite arma los eventos con
 * el nombre crudo del producto y no tiene un filtro para cambiarlo, y esos
 * datos además quedan impresos en el código de la página. Por eso:
 *
 * - Mientras arma los eventos, los productos devuelven el nombre público.
 * - Lo que imprime se limpia al final: los renglones de un pedido traen el
 *   nombre guardado en el pedido, que conserva el código para el local.
 *
 * El filtro corre solo en esos dos momentos de una página pública: ni los
 * pedidos ni el nombre del producto cambian.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/** Nombre público del producto, para `woocommerce_product_get_name`. */
function li_analitica_nombre( $nombre ) {
	return li_nombre_publico( (string) $nombre );
}

// PixelYourSite arma los eventos en wp_enqueue_scripts (14) y los imprime en el 15.
add_action(
	'wp_enqueue_scripts',
	static function () {
		add_filter( 'woocommerce_product_get_name', 'li_analitica_nombre' );
	},
	13
);

add_action(
	'wp_enqueue_scripts',
	static function () {
		remove_filter( 'woocommerce_product_get_name', 'li_analitica_nombre' );

		$datos = wp_scripts()->get_data( 'pys', 'data' );
		if ( is_string( $datos ) && '' !== $datos ) {
			// Dentro del JSON, el código va al final de un texto o de un nombre de la lista.
			wp_scripts()->add_data( 'pys', 'data', (string) preg_replace( '/\s*\(\d{4,6}\)(?=["\\\\,])/u', '', $datos ) );
		}
	},
	16
);

// Los datos de la ficha se imprimen en el pie (wp_footer 5), después de armar la página.
add_action(
	'wp_footer',
	static function () {
		add_filter( 'woocommerce_product_get_name', 'li_analitica_nombre' );
	},
	1
);
