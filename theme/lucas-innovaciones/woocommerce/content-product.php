<?php
/**
 * Tarjeta de producto del catálogo.
 *
 * Se construye entera acá: en inc/woocommerce.php se desengancharon todos
 * los componentes por defecto del bucle.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

global $product;

if ( empty( $product ) || ! $product->is_visible() ) {
	return;
}

$li_id     = $product->get_id();
$li_marcas = wp_get_object_terms( $li_id, 'product_brand', array( 'fields' => 'names' ) );
$li_marca  = ( ! is_wp_error( $li_marcas ) && $li_marcas ) ? $li_marcas[0] : '';
$li_cond   = wc_get_product_terms( $li_id, 'pa_condicion', array( 'fields' => 'names' ) );
$li_cond   = $li_cond ? $li_cond[0] : '';
$li_stock  = $product->managing_stock() ? (int) $product->get_stock_quantity() : null;
?>
<li <?php wc_product_class( 'tarjeta', $product ); ?>>

	<div class="tarjeta__media">
		<div class="tarjeta__señales">
			<?php
			if ( $product->is_on_sale() ) {
				woocommerce_show_product_loop_sale_flash();
			}
			if ( ! $product->is_in_stock() ) {
				echo '<span class="chip chip--agotado">' . esc_html__( 'Sin stock', 'lucasinnovaciones' ) . '</span>';
			} elseif ( 'Usado' === $li_cond ) {
				echo '<span class="chip chip--usado">' . esc_html__( 'Usado', 'lucasinnovaciones' ) . '</span>';
			} elseif ( null !== $li_stock && $li_stock > 0 && $li_stock <= 2 ) {
				echo '<span class="chip chip--ultimas">' . esc_html__( 'Última unidad', 'lucasinnovaciones' ) . '</span>';
			}
			?>
		</div>

		<a href="<?php the_permalink(); ?>" tabindex="-1" aria-hidden="true">
			<?php
			if ( has_post_thumbnail() ) {
				echo woocommerce_get_product_thumbnail( 'li-card' ); // phpcs:ignore WordPress.Security.EscapeOutput
			} else {
				/*
				 * 97% del catálogo no tiene foto. En vez de un ícono genérico se
				 * muestra el código real del producto: es honesto y sirve al cliente
				 * que ya sabe qué está buscando.
				 */
				$li_sku = $product->get_sku();
				echo '<div class="tarjeta__sinfoto">';
				echo '<span>' . esc_html( $li_sku ? $li_sku : '—' ) . '</span>';
				echo '<small>' . esc_html__( 'sin foto', 'lucasinnovaciones' ) . '</small>';
				echo '</div>';
			}
			?>
		</a>
	</div>

	<?php if ( $li_marca ) : ?>
		<p class="tarjeta__marca"><?php echo esc_html( $li_marca ); ?></p>
	<?php endif; ?>

	<h3 class="tarjeta__titulo">
		<a href="<?php the_permalink(); ?>"><?php echo esc_html( $product->get_name() ); ?></a>
	</h3>

	<div class="tarjeta__pie">
		<?php if ( $product->get_price_html() ) : ?>
			<div class="tarjeta__precio"><?php echo $product->get_price_html(); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
		<?php endif; ?>

		<?php
		if ( ! $product->is_in_stock() ) {
			echo '<p class="tarjeta__stock tarjeta__stock--cero">' . esc_html__( 'Sin stock', 'lucasinnovaciones' ) . '</p>';
		} elseif ( null !== $li_stock && $li_stock > 0 && $li_stock <= 3 ) {
			printf(
				'<p class="tarjeta__stock tarjeta__stock--bajo">%s</p>',
				esc_html( sprintf( /* translators: %d: unidades. */ _n( 'Queda %d unidad', 'Quedan %d unidades', $li_stock, 'lucasinnovaciones' ), $li_stock ) )
			);
		}
		?>

		<div class="tarjeta__accion">
			<?php woocommerce_template_loop_add_to_cart( array( 'class' => 'boton boton--fantasma boton--bloque' ) ); ?>
		</div>
	</div>
</li>
