<?php
/**
 * Contenido de la ficha de producto.
 *
 * Se conservan los hooks de WooCommerce —el selector de variaciones depende
 * de ellos— pero la estructura la define el tema.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

global $product;

do_action( 'woocommerce_before_single_product' );

if ( post_password_required() ) {
	echo get_the_password_form(); // phpcs:ignore WordPress.Security.EscapeOutput
	return;
}

$li_marcas = wp_get_object_terms( $product->get_id(), 'product_brand', array( 'fields' => 'names' ) );
$li_marca  = ( ! is_wp_error( $li_marcas ) && $li_marcas ) ? $li_marcas[0] : '';
$li_sku    = $product->get_sku();
?>
<div id="product-<?php the_ID(); ?>" <?php wc_product_class( 'producto', $product ); ?>>

	<div class="producto__galeria">
		<?php
		if ( has_post_thumbnail() ) {
			woocommerce_show_product_images();
		} else {
			echo '<div class="tarjeta__sinfoto" style="aspect-ratio:1">';
			echo '<span>' . esc_html( $li_sku ? $li_sku : '—' ) . '</span>';
			echo '<small>' . esc_html__( 'foto no disponible', 'lucasinnovaciones' ) . '</small>';
			echo '</div>';
		}
		?>
	</div>

	<div class="producto__resumen summary entry-summary">

		<?php if ( $li_marca ) : ?>
			<p class="producto__marca"><?php echo esc_html( $li_marca ); ?></p>
		<?php endif; ?>

		<h1 class="producto__titulo"><?php the_title(); ?></h1>

		<div class="producto__precio"><?php echo $product->get_price_html(); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>

		<?php
		$li_disp = $product->get_availability();
		if ( ! empty( $li_disp['availability'] ) ) {
			printf(
				'<p class="producto__stock producto__stock--%s">%s</p>',
				$product->is_in_stock() ? 'si' : 'no',
				esc_html( $li_disp['availability'] )
			);
		}
		?>

		<?php
		/*
		 * Dispara woocommerce_{tipo}_add_to_cart. Para los productos variables
		 * (vidrios, hidrogeles y fundas) es lo que dibuja el selector de modelo
		 * compatible junto con su JS.
		 */
		woocommerce_template_single_add_to_cart();
		?>

		<?php if ( $product->get_short_description() ) : ?>
			<div class="producto__resumen-texto"><?php echo wp_kses_post( wpautop( $product->get_short_description() ) ); ?></div>
		<?php endif; ?>

		<?php if ( $li_sku ) : ?>
			<p class="producto__sku">
				<span><?php esc_html_e( 'Código', 'lucasinnovaciones' ); ?></span>
				<strong class="sku"><?php echo esc_html( $li_sku ); ?></strong>
			</p>
		<?php endif; ?>

	</div>
</div>

<?php
do_action( 'woocommerce_after_single_product_summary' );

do_action( 'woocommerce_after_single_product' );
