<?php
/**
 * Plantilla de reserva.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>

<main id="contenido" class="contenido">
	<div class="contenedor">
		<?php li_migas(); ?>

		<?php if ( have_posts() ) : ?>

			<?php if ( is_home() || is_archive() || is_search() ) : ?>
				<div class="catalogo__cabecera">
					<h1 class="catalogo__titulo">
						<?php
						if ( is_search() ) {
							/* translators: %s: términos buscados. */
							printf( esc_html__( 'Resultados para «%s»', 'lucasinnovaciones' ), esc_html( get_search_query() ) );
						} elseif ( is_archive() ) {
							the_archive_title();
						} else {
							bloginfo( 'name' );
						}
						?>
					</h1>
				</div>
			<?php endif; ?>

			<?php
			while ( have_posts() ) :
				the_post();
				?>
				<article <?php post_class( 'entrada' ); ?>>
					<?php if ( is_singular() ) : ?>
						<h1 class="producto__titulo"><?php the_title(); ?></h1>
						<div class="entrada__cuerpo"><?php the_content(); ?></div>
					<?php else : ?>
						<h2><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
						<?php the_excerpt(); ?>
					<?php endif; ?>
				</article>
				<?php
			endwhile;

			the_posts_pagination( array( 'mid_size' => 1 ) );
			?>

		<?php else : ?>

			<div class="vacio">
				<p class="vacio__titulo">404</p>
				<p><?php esc_html_e( 'No encontramos lo que buscabas. Probá con otra búsqueda o mirá el catálogo completo.', 'lucasinnovaciones' ); ?></p>
				<a class="boton" href="<?php echo esc_url( wc_get_page_permalink( 'shop' ) ); ?>"><?php esc_html_e( 'Ver el catálogo', 'lucasinnovaciones' ); ?></a>
			</div>

		<?php endif; ?>
	</div>
</main>

<?php
get_footer();
