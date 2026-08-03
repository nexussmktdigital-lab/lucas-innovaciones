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
}
