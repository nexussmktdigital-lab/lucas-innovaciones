<?php
/**
 * Configuración base del tema.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

add_action( 'after_setup_theme', 'li_setup' );
/**
 * Soportes del tema y menús.
 */
function li_setup(): void {
	load_theme_textdomain( 'lucasinnovaciones', LI_DIR . '/languages' );

	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'customize-selective-refresh-widgets' );
	add_theme_support( 'responsive-embeds' );

	add_theme_support(
		'html5',
		array( 'search-form', 'gallery', 'caption', 'style', 'script', 'navigation-widgets' )
	);

	// WooCommerce: se declara el soporte y la galería nativa.
	// El tema dibuja todo; no queda nada delegado a un maquetador.
	add_theme_support( 'woocommerce', array(
		'thumbnail_image_width' => 400,
		'single_image_width'    => 900,
		'product_grid'          => array(
			'default_columns' => 4,
			'min_columns'     => 2,
			'max_columns'     => 5,
		),
	) );
	add_theme_support( 'wc-product-gallery-zoom' );
	add_theme_support( 'wc-product-gallery-lightbox' );
	add_theme_support( 'wc-product-gallery-slider' );

	register_nav_menus( array(
		'principal' => __( 'Menú principal', 'lucasinnovaciones' ),
		'pie'       => __( 'Menú del pie', 'lucasinnovaciones' ),
	) );

	// El catálogo tiene fotos verticales de producto sobre fondo claro.
	add_image_size( 'li-card', 600, 600, true );
}

add_action( 'init', 'li_disable_emojis' );
/**
 * Quita el script de emojis: 12 KB que esta tienda no usa.
 */
function li_disable_emojis(): void {
	remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
	remove_action( 'wp_print_styles', 'print_emoji_styles' );
	remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
	remove_action( 'admin_print_styles', 'print_emoji_styles' );
	add_filter( 'emoji_svg_url', '__return_false' );
}

add_filter( 'body_class', 'li_body_class' );
/**
 * Clases de contexto para el CSS.
 *
 * @param string[] $classes Clases existentes.
 * @return string[]
 */
function li_body_class( array $classes ): array {
	$classes[] = 'li';

	if ( function_exists( 'is_woocommerce' ) && ( is_woocommerce() || is_cart() || is_checkout() || is_account_page() ) ) {
		$classes[] = 'li--tienda';
	}

	return $classes;
}

add_action( 'wp_head', 'li_meta_theme_color', 1 );
/**
 * Color de la barra del navegador en móvil.
 */
function li_meta_theme_color(): void {
	echo '<meta name="theme-color" content="#0A0A0A">' . "\n";
	echo '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' . "\n";
}

add_action( 'widgets_init', 'li_widgets' );
/**
 * Zona de widgets del catálogo: ahí viven los filtros de WooCommerce.
 */
function li_widgets(): void {
	register_sidebar( array(
		'name'          => __( 'Filtros del catálogo', 'lucasinnovaciones' ),
		'id'            => 'filtros-catalogo',
		'description'   => __( 'Barra lateral de la tienda. Pensada para los widgets de filtrado por atributo, precio y marca.', 'lucasinnovaciones' ),
		'before_widget' => '<section id="%1$s" class="filtro %2$s">',
		'after_widget'  => '</section>',
		'before_title'  => '<h2 class="filtro__titulo">',
		'after_title'   => '</h2>',
	) );
}
