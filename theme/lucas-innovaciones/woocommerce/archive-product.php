<?php
/**
 * Catálogo: tienda, categorías, marcas y atributos.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

get_header( 'shop' );

do_action( 'woocommerce_before_main_content' );
?>

<div class="catalogo__cabecera">
	<h1 class="catalogo__titulo">
		<?php woocommerce_page_title(); ?>
	</h1>

	<?php
	$li_desc = '';
	if ( is_product_taxonomy() ) {
		$li_term = get_queried_object();
		if ( $li_term && ! empty( $li_term->description ) ) {
			$li_desc = $li_term->description;
		}
	}
	if ( $li_desc ) :
		?>
		<div class="catalogo__bajada"><?php echo wp_kses_post( wpautop( $li_desc ) ); ?></div>
	<?php endif; ?>
</div>

<div class="catalogo">

	<aside class="lateral" aria-label="<?php esc_attr_e( 'Filtros', 'lucasinnovaciones' ); ?>">
		<?php if ( is_active_sidebar( 'filtros-catalogo' ) ) : ?>
			<?php dynamic_sidebar( 'filtros-catalogo' ); ?>
		<?php else : ?>
			<section class="filtro">
				<h2 class="filtro__titulo"><?php esc_html_e( 'Categorías', 'lucasinnovaciones' ); ?></h2>
				<ul>
					<?php
					$li_cats = get_terms(
						array(
							'taxonomy'   => 'product_cat',
							'hide_empty' => true,
							'orderby'    => 'count',
							'order'      => 'DESC',
							'number'     => 18,
						)
					);
					if ( $li_cats && ! is_wp_error( $li_cats ) ) {
						foreach ( $li_cats as $li_c ) {
							if ( 'solo-mostrador' === $li_c->slug ) {
								continue;
							}
							printf(
								'<li><a href="%s">%s <span class="count">%d</span></a></li>',
								esc_url( (string) get_term_link( $li_c ) ),
								esc_html( $li_c->name ),
								(int) $li_c->count
							);
						}
					}
					?>
				</ul>
			</section>
		<?php endif; ?>
	</aside>

	<div class="catalogo__cuerpo">
		<?php if ( woocommerce_product_loop() ) : ?>

			<div class="catalogo__barra">
				<?php woocommerce_result_count(); ?>
				<?php woocommerce_catalog_ordering(); ?>
			</div>

			<?php
			woocommerce_product_loop_start();

			if ( wc_get_loop_prop( 'total' ) ) {
				while ( have_posts() ) {
					the_post();
					do_action( 'woocommerce_shop_loop' );
					wc_get_template_part( 'content', 'product' );
				}
			}

			woocommerce_product_loop_end();

			do_action( 'woocommerce_after_shop_loop' );
			?>

		<?php else : ?>

			<div class="vacio">
				<p class="vacio__titulo"><?php esc_html_e( 'Nada por acá', 'lucasinnovaciones' ); ?></p>
				<p><?php esc_html_e( 'No hay productos que coincidan con esta búsqueda. Probá quitando algún filtro.', 'lucasinnovaciones' ); ?></p>
				<a class="boton" href="<?php echo esc_url( wc_get_page_permalink( 'shop' ) ); ?>"><?php esc_html_e( 'Ver todo el catálogo', 'lucasinnovaciones' ); ?></a>
			</div>

		<?php endif; ?>
	</div>

</div>

<?php
do_action( 'woocommerce_after_main_content' );

get_footer( 'shop' );
