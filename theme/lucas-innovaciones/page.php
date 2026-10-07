<?php
/**
 * Páginas sueltas: también Carrito y Finalizar compra (bloques de
 * WooCommerce) y Mi cuenta (shortcode clásico). El tema pone el envoltorio
 * y el título; el estilo de esas pantallas está en assets/css/blocks.css.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

get_header();

$li_cuenta = function_exists( 'is_account_page' ) && is_account_page();
?>

<main id="contenido" class="li-shop li-page<?php echo $li_cuenta ? ' li-cuenta' : ''; ?>">
	<div class="li-wrap">
		<?php li_migas(); ?>

		<?php
		while ( have_posts() ) :
			the_post();
			?>
			<header class="li-page__head">
				<h1 class="li-shop__title"><?php the_title(); ?></h1>
			</header>

			<div class="li-page__body">
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
