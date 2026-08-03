<?php
/**
 * Carga de estilos y scripts.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

add_action( 'wp_enqueue_scripts', 'li_assets', 20 );
/**
 * Encola los estilos del tema y descarta los de WooCommerce que se reemplazan.
 */
function li_assets(): void {
	$css = LI_DIR . '/assets/css/theme.css';
	$ver = file_exists( $css ) ? (string) filemtime( $css ) : LI_VERSION;

	wp_enqueue_style( 'li-theme', LI_URI . '/assets/css/theme.css', array(), $ver );

	// Las hojas de WooCommerce se reemplazan por completo. Se conserva
	// únicamente la del selector de variaciones, que acompaña a su JS.
	wp_dequeue_style( 'woocommerce-general' );
	wp_dequeue_style( 'woocommerce-layout' );
	wp_dequeue_style( 'woocommerce-smallscreen' );
	wp_dequeue_style( 'wc-blocks-style' );

	$js  = LI_DIR . '/assets/js/theme.js';
	$jsv = file_exists( $js ) ? (string) filemtime( $js ) : LI_VERSION;
	wp_enqueue_script( 'li-theme', LI_URI . '/assets/js/theme.js', array(), $jsv, true );

	if ( is_singular() && comments_open() && get_option( 'thread_comments' ) ) {
		wp_enqueue_script( 'comment-reply' );
	}
}

add_action( 'wp_head', 'li_precarga_fuentes', 2 );
/**
 * Precarga las dos fuentes que aparecen sobre la línea de flotación.
 *
 * Sin esto el texto salta al terminar de descargar la tipografía: el
 * catálogo es denso y el reflow se nota mucho.
 */
function li_precarga_fuentes(): void {
	$fuentes = array(
		'/assets/fonts/IBMPlexSans-Regular.woff2',
		'/assets/fonts/IBMPlexSans-SemiBold.woff2',
		'/assets/fonts/IBMPlexMono-Medium.woff2',
	);

	foreach ( $fuentes as $f ) {
		if ( ! file_exists( LI_DIR . $f ) ) {
			continue;
		}
		printf(
			'<link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' . "\n",
			esc_url( LI_URI . $f )
		);
	}
}

add_filter( 'style_loader_tag', 'li_limpiar_tags', 10, 2 );
/**
 * Quita el atributo id redundante que WordPress agrega a cada hoja.
 *
 * @param string $tag    Etiqueta completa.
 * @param string $handle Identificador del estilo.
 * @return string
 */
function li_limpiar_tags( string $tag, string $handle ): string {
	if ( 'li-theme' === $handle ) {
		$tag = str_replace( " id='li-theme-css'", '', $tag );
	}
	return $tag;
}
