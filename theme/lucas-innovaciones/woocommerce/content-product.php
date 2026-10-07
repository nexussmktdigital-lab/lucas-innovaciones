<?php
/**
 * Tarjeta de producto — design-system/ui_kit/ProductCard.jsx.
 *
 * Toda la tarjeta es un enlace a la ficha. Desvíos del kit: sin cuotas
 * (solo el precio), sin corazón de favoritos (no hay lista de deseos) y el
 * nombre sin el código interno del final (li_nombre_publico).
 *
 * Los listados ya llegan recortados por las reglas de catálogo; el control
 * de acá es la última barrera por si alguna consulta se escapa.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

global $product;

if ( empty( $product ) || ! li_producto_publicable( $product ) ) {
	return;
}

$li_id    = $product->get_id();
$li_marca = li_marca_producto( $li_id );
$li_badge = '';

if ( $product->is_on_sale() ) {
	$li_normal = (float) $product->get_regular_price();
	$li_oferta = (float) $product->get_sale_price();
	if ( $li_normal > 0 && $li_oferta > 0 && $li_oferta < $li_normal ) {
		$li_badge = '<span class="li-badge li-badge--pixel li-badge--green">−' . (int) round( ( 1 - $li_oferta / $li_normal ) * 100 ) . '%</span>';
	}
} elseif ( li_es_usado( $li_id ) ) {
	$li_badge = '<span class="li-badge li-badge--pixel li-badge--black">USADO</span>';
} elseif ( (int) get_post_time( 'U', true, $li_id ) > time() - 30 * DAY_IN_SECONDS ) {
	$li_badge = '<span class="li-badge li-badge--pixel li-badge--greendk">NUEVO</span>';
}
?>
<li class="li-card-item">
	<a class="li-card" href="<?php the_permalink(); ?>">
		<?php if ( $li_badge ) : ?>
			<span class="li-card__badge"><?php echo $li_badge; // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
		<?php endif; ?>

		<span class="li-card__media">
			<?php echo $product->get_image( 'li-card', array( 'class' => 'li-card__img', 'loading' => 'lazy', 'alt' => esc_attr( li_nombre_publico( $product->get_name() ) ) ) ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
		</span>

		<?php if ( $li_marca ) : ?>
			<span class="li-card__brand"><?php echo esc_html( $li_marca ); ?></span>
		<?php endif; ?>

		<span class="li-card__name"><?php echo esc_html( li_nombre_publico( $product->get_name() ) ); ?></span>

		<?php echo li_ds_precio( $product, 'md' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>

		<?php echo li_ds_stock( $product ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
	</a>
</li>
