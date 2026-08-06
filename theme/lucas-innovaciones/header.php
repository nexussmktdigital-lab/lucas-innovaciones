<?php
/**
 * Cabecera del sitio.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<link rel="profile" href="https://gmpg.org/xfn/11">
	<?php wp_head(); ?>
</head>

<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<a class="saltar" href="#contenido"><?php esc_html_e( 'Saltar al contenido', 'lucasinnovaciones' ); ?></a>

<div class="cinta">
	<div class="contenedor">
		<ul class="cinta__lista">
			<li><strong><?php esc_html_e( 'Retiro en el local', 'lucasinnovaciones' ); ?></strong> — <?php echo esc_html( get_option( 'woocommerce_store_address', 'Caseros 924' ) ); ?></li>
			<li><?php esc_html_e( 'Envíos a todo el país', 'lucasinnovaciones' ); ?></li>
			<li><?php esc_html_e( 'Mercado Pago y transferencia', 'lucasinnovaciones' ); ?></li>
		</ul>
	</div>
</div>

<header class="cabecera" role="banner">
	<div class="contenedor">
		<div class="cabecera__barra">
			<?php li_logo(); ?>
			<?php li_buscador(); ?>

			<div class="acciones">
				<a class="acciones__item" href="<?php echo esc_url( wc_get_page_permalink( 'myaccount' ) ); ?>" aria-label="<?php esc_attr_e( 'Mi cuenta', 'lucasinnovaciones' ); ?>">
					<?php li_icono( 'cuenta' ); ?>
				</a>
				<?php li_carrito_boton(); ?>
				<button class="acciones__item acciones__menu" type="button" data-li-menu aria-expanded="false" aria-controls="li-nav" aria-label="<?php esc_attr_e( 'Abrir menú', 'lucasinnovaciones' ); ?>">
					<?php li_icono( 'menu' ); ?>
				</button>
			</div>
		</div>
	</div>

	<nav class="nav" id="li-nav" aria-label="<?php esc_attr_e( 'Menú principal', 'lucasinnovaciones' ); ?>">
		<?php li_nav_render(); ?>
	</nav>
</header>
