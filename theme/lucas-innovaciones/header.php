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
		<div class="contenedor">
			<?php
			if ( has_nav_menu( 'principal' ) ) {
				wp_nav_menu(
					array(
						'theme_location' => 'principal',
						'container'      => false,
						'menu_class'     => 'nav__lista',
						'depth'          => 1,
					)
				);
			} else {
				// Sin menú asignado se muestran las categorías con más productos,
				// para que la navegación nunca quede vacía.
				$cats = get_terms(
					array(
						'taxonomy'   => 'product_cat',
						'hide_empty' => true,
						'orderby'    => 'count',
						'order'      => 'DESC',
						'number'     => 8,
						'exclude'    => array( get_option( 'default_product_cat' ) ),
					)
				);
				if ( $cats && ! is_wp_error( $cats ) ) {
					echo '<ul class="nav__lista">';
					foreach ( $cats as $c ) {
						if ( 'solo-mostrador' === $c->slug ) {
							continue;
						}
						printf(
							'<li><a href="%s">%s</a></li>',
							esc_url( (string) get_term_link( $c ) ),
							esc_html( $c->name )
						);
					}
					echo '</ul>';
				}
			}
			?>
		</div>
	</nav>
</header>
