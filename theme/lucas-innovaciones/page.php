<?php
/**
 * Páginas sueltas.
 *
 * Cubre también Carrito, Finalizar compra y Mi cuenta: las dos primeras están
 * construidas con bloques de WooCommerce y la tercera con el shortcode clásico.
 * En los tres casos el tema aporta el envoltorio, no el contenido.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

get_header();

$li_es_tienda = function_exists( 'is_cart' ) && ( is_cart() || is_checkout() || is_account_page() );
$li_ancho     = function_exists( 'is_checkout' ) && is_checkout() && ! is_order_received_page();
?>

<main id="contenido" class="contenido <?php echo $li_es_tienda ? 'contenido--tienda' : ''; ?>">
	<div class="contenedor">
		<?php li_migas(); ?>

		<?php
		while ( have_posts() ) :
			the_post();
			?>

			<?php if ( ! $li_ancho ) : ?>
				<header class="pagina__cabecera">
					<h1 class="catalogo__titulo"><?php the_title(); ?></h1>
				</header>
			<?php endif; ?>

			<div class="pagina__cuerpo">
				<?php
				the_content();

				wp_link_pages(
					array(
						'before' => '<nav class="pagina__paginas">',
						'after'  => '</nav>',
					)
				);
				?>
			</div>

			<?php
		endwhile;
		?>
	</div>
</main>

<?php
get_footer();
