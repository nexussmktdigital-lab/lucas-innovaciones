<?php
/**
 * Catálogo: tienda, categorías, marcas, atributos y búsqueda.
 *
 * El kit no trae listado: se arma con los tokens y piezas del design system
 * (tarjeta, chips, botones) sobre la lógica de filtros del tema (facetas,
 * precio, marcas), que sigue andando sin JavaScript y con AJAX encima.
 *
 * En móvil los filtros viven en un panel lateral que abre el botón "Filtros";
 * en desktop son la barra de la izquierda.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

get_header( 'shop' );

do_action( 'woocommerce_before_main_content' );

$li_obj = is_product_taxonomy() ? get_queried_object() : null;
$li_cat = ( $li_obj instanceof WP_Term && 'product_cat' === $li_obj->taxonomy ) ? $li_obj : null;
?>

<header class="li-shop__head">
	<h1 class="li-shop__title">
		<?php
		if ( is_search() ) {
			/* translators: %s: términos buscados. */
			printf( esc_html__( 'Resultados para «%s»', 'lucasinnovaciones' ), esc_html( get_search_query() ) );
		} else {
			woocommerce_page_title();
		}
		?>
	</h1>

	<?php // Recordatorio de la oferta arriba del listado: es donde se decide la compra. ?>
	<p class="li-shop__promo">
		<span class="li-badge li-badge--pixel li-badge--green"><?php echo esc_html( class_exists( 'Li_Dolar' ) ? Li_Dolar::porcentaje( Li_Dolar::descuento_bp() ) : '10%' ); ?> OFF</span>
		<span>pagando con transferencia · <strong>envío gratis</strong> a todo el país desde $ 100.000</span>
	</p>

	<?php if ( $li_obj && ! empty( $li_obj->description ) ) : ?>
		<div class="li-shop__desc"><?php echo wp_kses_post( wpautop( $li_obj->description ) ); ?></div>
	<?php endif; ?>

	<?php
	if ( $li_cat ) {
		li_subcategorias( $li_cat );
	}
	?>
</header>

<?php
if ( li_hay_carrusel( $li_obj ) ) {
	li_carrusel_marcas();
}
?>

<div class="catalogo">

	<aside class="lateral" id="li-filtros" aria-label="<?php esc_attr_e( 'Filtros', 'lucasinnovaciones' ); ?>">
		<div class="lateral__head">
			<span class="lateral__titulo"><?php esc_html_e( 'Filtros', 'lucasinnovaciones' ); ?></span>
			<button class="li-iconbtn" type="button" data-li-filtros-cerrar aria-label="<?php esc_attr_e( 'Cerrar filtros', 'lucasinnovaciones' ); ?>">
				<?php echo li_ds_icono( 'x' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			</button>
		</div>

		<div class="lateral__body">
			<?php $li_lista = array_slice( li_lista_lateral( $li_cat ), 0, 20 ); ?>
			<?php if ( $li_lista ) : ?>
				<section class="filtro">
					<h2 class="filtro__titulo"><?php esc_html_e( 'Categorías', 'lucasinnovaciones' ); ?></h2>
					<ul class="filtro__cats">
						<?php foreach ( $li_lista as $li_c ) : ?>
							<li<?php echo $li_cat && $li_c['slug'] === $li_cat->slug ? ' class="es-actual"' : ''; ?>>
								<a href="<?php echo esc_url( $li_c['url'] ); ?>"><?php echo esc_html( $li_c['nombre'] ); ?> <span class="count"><?php echo (int) $li_c['cuenta']; ?></span></a>
							</li>
						<?php endforeach; ?>
					</ul>
				</section>
			<?php endif; ?>

			<div data-li-facetas>
				<?php li_panel_filtros(); ?>
			</div>
		</div>

		<div class="lateral__foot">
			<button class="li-btn li-btn--primary li-btn--block" type="button" data-li-filtros-cerrar><?php esc_html_e( 'Ver productos', 'lucasinnovaciones' ); ?></button>
		</div>
	</aside>
	<div class="lateral__fondo" data-li-filtros-cerrar></div>

	<div class="catalogo__cuerpo">
		<button class="li-filtros-btn" type="button" data-li-filtros-abrir aria-controls="li-filtros" aria-expanded="false">
			<svg class="li-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
			<?php esc_html_e( 'Filtros', 'lucasinnovaciones' ); ?>
		</button>

		<div data-li-resultados>
			<?php
			li_filtros_activos();
			li_render_resultados( $GLOBALS['wp_query'] );
			?>
		</div>
	</div>

</div>

<?php
do_action( 'woocommerce_after_main_content' );

get_footer( 'shop' );
