<?php
/**
 * Pie del sitio.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

$li_dir  = get_option( 'woocommerce_store_address', '' );
$li_ciu  = get_option( 'woocommerce_store_city', '' );
$li_cp   = get_option( 'woocommerce_store_postcode', '' );
?>

<footer class="pie" role="contentinfo">
	<div class="contenedor">
		<div class="pie__grilla">

			<div>
				<?php li_logo( 'claro', 'pie__marca' ); ?>
				<p class="pie__descripcion"><?php bloginfo( 'description' ); ?></p>

				<?php if ( $li_dir ) : ?>
					<p class="pie__titulo" style="margin-top:1.5rem"><?php esc_html_e( 'El local', 'lucasinnovaciones' ); ?></p>
					<p class="pie__dato">
						<?php echo esc_html( $li_dir ); ?><?php echo $li_ciu ? '<br>' . esc_html( $li_ciu ) : ''; ?><?php echo $li_cp ? ' (' . esc_html( $li_cp ) . ')' : ''; ?>
					</p>
				<?php endif; ?>
			</div>

			<div>
				<p class="pie__titulo"><?php esc_html_e( 'Categorías', 'lucasinnovaciones' ); ?></p>
				<ul>
					<?php
					$li_cats = get_terms(
						array(
							'taxonomy'   => 'product_cat',
							'hide_empty' => true,
							'orderby'    => 'count',
							'order'      => 'DESC',
							'number'     => 7,
						)
					);
					if ( $li_cats && ! is_wp_error( $li_cats ) ) {
						foreach ( $li_cats as $li_c ) {
							if ( 'solo-mostrador' === $li_c->slug ) {
								continue;
							}
							printf(
								'<li><a href="%s">%s</a></li>',
								esc_url( (string) get_term_link( $li_c ) ),
								esc_html( $li_c->name )
							);
						}
					}
					?>
				</ul>
			</div>

			<div>
				<p class="pie__titulo"><?php esc_html_e( 'Tu compra', 'lucasinnovaciones' ); ?></p>
				<ul>
					<li><a href="<?php echo esc_url( wc_get_page_permalink( 'myaccount' ) ); ?>"><?php esc_html_e( 'Mi cuenta', 'lucasinnovaciones' ); ?></a></li>
					<li><a href="<?php echo esc_url( wc_get_cart_url() ); ?>"><?php esc_html_e( 'Carrito', 'lucasinnovaciones' ); ?></a></li>
					<?php
					if ( has_nav_menu( 'pie' ) ) {
						wp_nav_menu(
							array(
								'theme_location' => 'pie',
								'container'      => false,
								'items_wrap'     => '%3$s',
								'depth'          => 1,
							)
						);
					}
					?>
				</ul>
			</div>

		</div>

		<div class="pie__base">
			<span>
				&copy; <?php echo esc_html( gmdate( 'Y' ) ); ?> <?php bloginfo( 'name' ); ?>
				<span class="pie__credito">
					<?php esc_html_e( '· Sitio web realizado por', 'lucasinnovaciones' ); ?>
					<a href="https://nexuss.com.ar/" target="_blank" rel="noopener">Nexuss Digital Agency</a>
				</span>
			</span>
			<span><?php esc_html_e( 'Todos los derechos reservados', 'lucasinnovaciones' ); ?></span>
		</div>
	</div>
</footer>

<?php wp_footer(); ?>
</body>
</html>
