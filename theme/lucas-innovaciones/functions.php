<?php
/**
 * Lucas Innovaciones — arranque del tema.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

define( 'LI_VERSION', '0.1.0' );
define( 'LI_DIR', get_template_directory() );
define( 'LI_URI', get_template_directory_uri() );

require_once LI_DIR . '/inc/setup.php';
require_once LI_DIR . '/inc/assets.php';
require_once LI_DIR . '/inc/template-tags.php';

if ( class_exists( 'WooCommerce' ) ) {
	require_once LI_DIR . '/inc/woocommerce.php';
	// medallones.php define li_termino_imagen() y li_marca_logo(), que
	// portada.php usa al armar la caché: va antes.
	require_once LI_DIR . '/inc/medallones.php';
	require_once LI_DIR . '/inc/portada.php';
	require_once LI_DIR . '/inc/banners.php';
	require_once LI_DIR . '/inc/menu.php';
	require_once LI_DIR . '/inc/categoria.php';
	require_once LI_DIR . '/inc/facetas.php';
}
