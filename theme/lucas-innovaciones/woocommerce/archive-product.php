<?php
/**
 * Catálogo: tienda, categorías, marcas y atributos.
 *
 * Una categoría suma banners, subcategorías y el carrusel de marcas. La
 * tienda entera y los archivos de marca o atributo usan la misma grilla,
 * sin esos agregados.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

get_header( 'shop' );

do_action( 'woocommerce_before_main_content' );

$li_obj = is_product_taxonomy() ? get_queried_object() : null;
$li_cat = ( $li_obj instanceof WP_Term && 'product_cat' === $li_obj->taxonomy ) ? $li_obj : null;
?>

<?php if ( $li_cat ) : ?>
	<?php li_banners_render( li_banners_categoria( $li_cat ) ); ?>
<?php endif; ?>

<div class="catalogo__cabecera">
	<h1 class="catalogo__titulo">
		<?php woocommerce_page_title(); ?>
	</h1>

	<?php
	$li_desc = $li_obj && ! empty( $li_obj->description ) ? $li_obj->description : '';
	if ( $li_desc ) :
		?>
		<div class="catalogo__bajada"><?php echo wp_kses_post( wpautop( $li_desc ) ); ?></div>
	<?php endif; ?>

	<?php
	if ( $li_cat ) {
		li_subcategorias( $li_cat );
	}
	?>
</div>

<?php
if ( $li_cat ) {
	li_carrusel_marcas( $li_cat );
}
?>

<div class="catalogo">

	<aside class="lateral" aria-label="<?php esc_attr_e( 'Filtros', 'lucasinnovaciones' ); ?>">
		<?php if ( is_active_sidebar( 'filtros-catalogo' ) ) : ?>
			<?php dynamic_sidebar( 'filtros-catalogo' ); ?>
		<?php else : ?>
			<section class="filtro">
				<h2 class="filtro__titulo"><?php esc_html_e( 'Categorías', 'lucasinnovaciones' ); ?></h2>
				<ul>
					<?php
					foreach ( array_slice( li_lista_lateral( $li_cat ), 0, 20 ) as $li_c ) {
						printf(
							'<li%s><a href="%s">%s <span class="count">%d</span></a></li>',
							$li_cat && $li_c['slug'] === $li_cat->slug ? ' class="es-actual"' : '',
							esc_url( $li_c['url'] ),
							esc_html( $li_c['nombre'] ),
							(int) $li_c['cuenta']
						);
					}
					?>
				</ul>
			</section>

			<div data-li-facetas>
				<?php li_panel_filtros(); ?>
			</div>
		<?php endif; ?>
	</aside>

	<div class="catalogo__cuerpo" data-li-resultados>
		<?php
		if ( $li_cat ) {
			li_filtros_activos( $li_cat );
		}

		li_render_resultados( $GLOBALS['wp_query'] );
		?>
	</div>

</div>

<?php
do_action( 'woocommerce_after_main_content' );

get_footer( 'shop' );
