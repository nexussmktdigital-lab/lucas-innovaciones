<?php
/**
 * Cabecera — design-system/ui_kit/Header.jsx.
 *
 * Micro-barra negra, barra principal (logo, buscador, cuenta y carrito) y la
 * fila de categorías. Las categorías salen del catálogo real y solo aparecen
 * las que tienen productos a la venta.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

// Fila de categorías: las principales, salvo las que Matias pidió sacar de
// esta vista para que entren todas (siguen en "Todas las categorías").
$li_cats   = array_slice(
	array_values( array_filter( li_categorias_principales( 12 ), static fn( $c ) => ! in_array( $c['slug'], array( 'mate-y-termos' ), true ) ) ),
	0,
	7
);
$li_arbol  = li_arbol_categorias();
$li_n_cart = ( function_exists( 'WC' ) && WC()->cart ) ? WC()->cart->get_cart_contents_count() : 0;
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<?php wp_head(); ?>
</head>

<body <?php body_class( 'li-body' ); ?>>
<?php wp_body_open(); ?>

<a class="saltar" href="#contenido"><?php esc_html_e( 'Saltar al contenido', 'lucasinnovaciones' ); ?></a>

<header class="li-header" role="banner">
	<div class="li-microbar">
		<div class="li-wrap li-microbar__in">
			<span class="li-microbar__loc">
				<?php echo li_ds_icono( 'map-pin', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<span><?php echo esc_html( LI_LOCALIDAD ); ?> <span class="li-hide-sm">· Retiro en <?php echo esc_html( LI_DIRECCION ); ?> y envíos a todo el país</span></span>
			</span>
			<span class="li-microbar__right">
				<a class="li-microbar__wa" href="<?php echo esc_url( li_whatsapp_url() ); ?>" target="_blank" rel="noopener">
					<?php echo li_ds_icono( 'whatsapp', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					<?php echo esc_html( LI_WHATSAPP_TEXTO ); ?>
				</a>
				<a class="li-hide-sm" href="<?php echo esc_url( 'https://www.instagram.com/' . LI_INSTAGRAM . '/' ); ?>" target="_blank" rel="noopener">Seguinos: @<?php echo esc_html( LI_INSTAGRAM ); ?></a>
			</span>
		</div>
	</div>

	<div class="li-wrap li-mainbar">
		<button class="li-iconbtn li-mainbar__menu" type="button" data-li-drawer-open aria-controls="li-drawer" aria-expanded="false" aria-label="<?php esc_attr_e( 'Abrir menú', 'lucasinnovaciones' ); ?>">
			<?php echo li_ds_icono( 'menu' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
		</button>

		<?php echo li_ds_logo(); // phpcs:ignore WordPress.Security.EscapeOutput ?>

		<form role="search" method="get" class="li-search" action="<?php echo esc_url( home_url( '/' ) ); ?>">
			<label class="visually-hidden" for="li-buscar"><?php esc_html_e( 'Buscar productos', 'lucasinnovaciones' ); ?></label>
			<?php echo li_ds_icono( 'search', 18, 'li-search__ico' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			<input type="search" id="li-buscar" class="li-input li-search__input" name="s"
				value="<?php echo esc_attr( get_search_query() ); ?>"
				placeholder="<?php esc_attr_e( '¿Qué necesitás hoy? ej. iPhone 13, cargador, auriculares…', 'lucasinnovaciones' ); ?>"
				autocomplete="off">
			<input type="hidden" name="post_type" value="product">
		</form>

		<div class="li-mainbar__actions">
			<a class="li-iconbtn li-hide-sm" href="<?php echo esc_url( wc_get_page_permalink( 'myaccount' ) ); ?>" title="<?php esc_attr_e( 'Mi cuenta', 'lucasinnovaciones' ); ?>" aria-label="<?php esc_attr_e( 'Mi cuenta', 'lucasinnovaciones' ); ?>">
				<?php echo li_ds_icono( 'user' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			</a>
			<a class="li-iconbtn" href="<?php echo esc_url( wc_get_cart_url() ); ?>" title="<?php esc_attr_e( 'Carrito', 'lucasinnovaciones' ); ?>" aria-label="<?php esc_attr_e( 'Ver carrito', 'lucasinnovaciones' ); ?>">
				<?php echo li_ds_icono( 'cart' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<span class="li-cartbadge" data-li-cart-count<?php echo $li_n_cart ? '' : ' hidden'; ?>><?php echo esc_html( (string) $li_n_cart ); ?></span>
			</a>
		</div>
	</div>

	<?php if ( $li_cats ) : ?>
	<nav class="li-catnav" aria-label="<?php esc_attr_e( 'Categorías', 'lucasinnovaciones' ); ?>">
		<div class="li-wrap li-catnav__box">
			<?php // Las flechas aparecen solo si la fila no entra (pantallas chicas). ?>
			<button class="li-catnav__flecha li-catnav__flecha--prev" type="button" data-li-catnav-prev aria-label="<?php esc_attr_e( 'Ver categorías anteriores', 'lucasinnovaciones' ); ?>" hidden>
				<svg class="li-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
			</button>
			<div class="li-catnav__in" data-li-catnav>
				<button class="li-catnav__all" type="button" data-li-drawer-open aria-controls="li-drawer" aria-expanded="false">
					<?php echo li_ds_icono( 'menu', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					<?php esc_html_e( 'Todas las categorías', 'lucasinnovaciones' ); ?>
				</button>
				<?php foreach ( $li_cats as $c ) : ?>
					<a class="li-catnav__item" href="<?php echo esc_url( $c['url'] ); ?>"><?php echo esc_html( $c['nombre'] ); ?></a>
				<?php endforeach; ?>
			</div>
			<button class="li-catnav__flecha li-catnav__flecha--next" type="button" data-li-catnav-next aria-label="<?php esc_attr_e( 'Ver más categorías', 'lucasinnovaciones' ); ?>" hidden>
				<?php echo li_ds_icono( 'chevron-r', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			</button>
		</div>
	</nav>
	<?php endif; ?>
</header>

<?php // Cajón de categorías: en móvil es el menú; en desktop, "Todas las categorías". ?>
<div class="li-drawer" id="li-drawer" hidden>
	<div class="li-drawer__backdrop" data-li-drawer-close></div>
	<div class="li-drawer__panel" role="dialog" aria-modal="true" aria-label="<?php esc_attr_e( 'Categorías', 'lucasinnovaciones' ); ?>">
		<div class="li-drawer__head">
			<?php echo li_ds_logo(); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			<button class="li-iconbtn" type="button" data-li-drawer-close aria-label="<?php esc_attr_e( 'Cerrar', 'lucasinnovaciones' ); ?>">
				<?php echo li_ds_icono( 'x' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			</button>
		</div>
		<nav class="li-drawer__body">
			<a class="li-drawer__link li-drawer__link--strong" href="<?php echo esc_url( wc_get_page_permalink( 'shop' ) ); ?>"><?php esc_html_e( 'Todo el catálogo', 'lucasinnovaciones' ); ?></a>
			<?php foreach ( $li_arbol as $c ) : ?>
				<?php if ( $c['hijos'] ) : ?>
					<details class="li-drawer__group">
						<summary class="li-drawer__link">
							<?php echo esc_html( $c['nombre'] ); ?>
							<?php echo li_ds_icono( 'chevron-d', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
						</summary>
						<a class="li-drawer__sub" href="<?php echo esc_url( $c['url'] ); ?>"><?php esc_html_e( 'Ver todo', 'lucasinnovaciones' ); ?></a>
						<?php foreach ( $c['hijos'] as $h ) : ?>
							<a class="li-drawer__sub" href="<?php echo esc_url( $h['url'] ); ?>"><?php echo esc_html( li_nombre_corto( $h['nombre'], $c['nombre'] ) ); ?></a>
						<?php endforeach; ?>
					</details>
				<?php else : ?>
					<a class="li-drawer__link" href="<?php echo esc_url( $c['url'] ); ?>"><?php echo esc_html( $c['nombre'] ); ?></a>
				<?php endif; ?>
			<?php endforeach; ?>
			<hr class="li-drawer__sep">
			<a class="li-drawer__link" href="<?php echo esc_url( wc_get_page_permalink( 'myaccount' ) ); ?>"><?php echo li_ds_icono( 'user', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> <?php esc_html_e( 'Mi cuenta', 'lucasinnovaciones' ); ?></a>
			<a class="li-drawer__link" href="<?php echo esc_url( li_whatsapp_url() ); ?>" target="_blank" rel="noopener"><?php echo li_ds_icono( 'whatsapp', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> <?php esc_html_e( 'Escribinos por WhatsApp', 'lucasinnovaciones' ); ?></a>
		</nav>
	</div>
</div>
