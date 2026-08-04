<?php
/**
 * Funciones de plantilla reutilizables.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/**
 * Logo del sitio.
 *
 * El tema trae el wordmark en PNG con fondo transparente, generado a partir
 * del JPG original: en negro para fondos claros y en blanco para el pie.
 * Si el cliente carga un logo desde el personalizador, ese tiene prioridad.
 *
 * @param string $variante 'oscuro' para fondos claros, 'claro' para el pie.
 * @param string $clase    Clase del enlace.
 */
function li_logo( string $variante = 'oscuro', string $clase = 'marca' ): void {
	$inicio = esc_url( home_url( '/' ) );
	$nombre = get_bloginfo( 'name' );

	if ( 'oscuro' === $variante && has_custom_logo() ) {
		$id  = (int) get_theme_mod( 'custom_logo' );
		$img = wp_get_attachment_image( $id, 'full', false, array( 'class' => 'marca__img', 'alt' => $nombre ) );
		printf( '<a class="%s" href="%s" rel="home">%s</a>', esc_attr( $clase ), $inicio, $img ); // phpcs:ignore WordPress.Security.EscapeOutput
		return;
	}

	$archivo = 'claro' === $variante ? 'logo-blanco.png' : 'logo.png';
	$ruta    = LI_DIR . '/assets/img/' . $archivo;

	if ( file_exists( $ruta ) ) {
		printf(
			'<a class="%s" href="%s" rel="home"><img class="marca__img" src="%s" alt="%s" width="786" height="159" %s></a>',
			esc_attr( $clase ),
			$inicio,
			esc_url( LI_URI . '/assets/img/' . $archivo ),
			esc_attr( $nombre ),
			'oscuro' === $variante ? 'fetchpriority="high"' : 'loading="lazy"'
		);
		return;
	}

	// Reserva en texto si el archivo no está.
	printf(
		'<a class="%s marca--texto" href="%s" rel="home"><span class="marca__lucas">Lucas</span><span class="marca__innovaciones">Innovaciones</span></a>',
		esc_attr( $clase ),
		$inicio
	);
}

/**
 * Buscador del encabezado, acotado a productos.
 */
function li_buscador(): void {
	?>
	<form role="search" method="get" class="buscador" action="<?php echo esc_url( home_url( '/' ) ); ?>">
		<label class="visually-hidden" for="li-buscar"><?php esc_html_e( 'Buscar productos', 'lucasinnovaciones' ); ?></label>
		<input
			type="search"
			id="li-buscar"
			class="buscador__campo"
			placeholder="<?php esc_attr_e( 'Buscar por nombre o código…', 'lucasinnovaciones' ); ?>"
			value="<?php echo esc_attr( get_search_query() ); ?>"
			name="s"
			autocomplete="off"
		>
		<input type="hidden" name="post_type" value="product">
		<button type="submit" class="buscador__enviar" aria-label="<?php esc_attr_e( 'Buscar', 'lucasinnovaciones' ); ?>">
			<?php li_icono( 'buscar' ); ?>
		</button>
	</form>
	<?php
}

/**
 * Iconos en línea. Sin librerías externas ni fuentes de iconos.
 *
 * @param string $nombre Identificador del icono.
 */
function li_icono( string $nombre ): void {
	$iconos = array(
		'buscar'   => '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
		'carrito'  => '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>',
		'cuenta'   => '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
		'menu'     => '<path d="M4 7h16M4 12h16M4 17h16"/>',
		'cerrar'   => '<path d="m6 6 12 12M18 6 6 18"/>',
		'flecha'   => '<path d="M5 12h14M13 6l6 6-6 6"/>',
		'filtro'   => '<path d="M4 6h16M7 12h10M10 18h4"/>',
		'whatsapp' => '<path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.3A10 10 0 1 0 12 2Z"/><path d="M8.5 9.5c0 4 3 6.5 6.2 6.8l1-1.6-2.1-1-1 1a5 5 0 0 1-2.2-2.3l1-1-1-2-1.6 1a2 2 0 0 0-.3 1.1Z"/>',
	);

	if ( ! isset( $iconos[ $nombre ] ) ) {
		return;
	}

	printf(
		'<svg class="icono icono--%s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">%s</svg>',
		esc_attr( $nombre ),
		$iconos[ $nombre ] // phpcs:ignore WordPress.Security.EscapeOutput
	);
}

/**
 * Contador del carrito para el encabezado.
 */
function li_carrito_boton(): void {
	if ( ! function_exists( 'WC' ) || ! WC()->cart ) {
		return;
	}

	$n = WC()->cart->get_cart_contents_count();
	printf(
		'<a class="acciones__item acciones__item--carrito %s" href="%s" aria-label="%s"><span class="acciones__icono">%s</span><span class="acciones__cuenta" data-li-cart-count>%s</span></a>',
		$n > 0 ? 'tiene-items' : '',
		esc_url( wc_get_cart_url() ),
		esc_attr__( 'Ver carrito', 'lucasinnovaciones' ),
		'<svg class="icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>',
		esc_html( (string) $n )
	);
}

/**
 * Migas de pan simples, sin depender del widget de WooCommerce.
 */
function li_migas(): void {
	if ( is_front_page() ) {
		return;
	}

	echo '<nav class="migas" aria-label="' . esc_attr__( 'Ruta de navegación', 'lucasinnovaciones' ) . '"><ol class="migas__lista">';
	printf(
		'<li class="migas__item"><a href="%s">%s</a></li>',
		esc_url( home_url( '/' ) ),
		esc_html__( 'Inicio', 'lucasinnovaciones' )
	);

	if ( function_exists( 'is_product' ) && is_product() ) {
		$tienda = wc_get_page_id( 'shop' );
		if ( $tienda > 0 ) {
			printf(
				'<li class="migas__item"><a href="%s">%s</a></li>',
				esc_url( get_permalink( $tienda ) ),
				esc_html( get_the_title( $tienda ) )
			);
		}
		$cats = get_the_terms( get_the_ID(), 'product_cat' );
		if ( $cats && ! is_wp_error( $cats ) ) {
			printf(
				'<li class="migas__item"><a href="%s">%s</a></li>',
				esc_url( (string) get_term_link( $cats[0] ) ),
				esc_html( $cats[0]->name )
			);
		}
		printf( '<li class="migas__item migas__item--actual" aria-current="page">%s</li>', esc_html( get_the_title() ) );
	} elseif ( function_exists( 'is_product_category' ) && is_product_category() ) {
		printf( '<li class="migas__item migas__item--actual" aria-current="page">%s</li>', esc_html( single_term_title( '', false ) ) );
	} elseif ( is_singular() || is_page() ) {
		printf( '<li class="migas__item migas__item--actual" aria-current="page">%s</li>', esc_html( get_the_title() ) );
	}

	echo '</ol></nav>';
}
