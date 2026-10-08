<?php
/**
 * Ficha de producto — design-system/ui_kit/Product.jsx.
 *
 * Galería, caja de precio con cantidad, "Comprar ahora" y WhatsApp, el
 * recuadro negro y el acordeón. Se conserva woocommerce_template_single_add_to_cart()
 * porque de él dependen el selector de variaciones y su JS.
 *
 * Desvíos del kit: sin cuotas, sin corazón de favoritos, nombre sin el IMEI,
 * y nada sin confirmar (garantía 12 + 6 meses, envío en 24 hs, Andreani,
 * "IVA incluido"): el recuadro negro habla del retiro en el local y la
 * pestaña de envíos dice solo lo que está decidido.
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

$li_id     = $product->get_id();
$li_nombre = li_nombre_web( $product );
$li_marca  = li_marca_producto( $li_id );
$li_sku    = $product->get_sku();
$li_imgs   = array_values( array_filter( array_merge( array( $product->get_image_id() ), $product->get_gallery_image_ids() ) ) );
$li_compra = $product->is_purchasable() && $product->is_in_stock();
$li_wa     = li_whatsapp_url( 'Hola! Quería consultar por ' . $li_nombre . ' — ' . get_permalink( $li_id ) );

// Especificaciones: los atributos visibles del producto.
$li_specs = array();
foreach ( $product->get_attributes() as $li_attr ) {
	if ( ! $li_attr->get_visible() ) {
		continue;
	}
	$li_vals = $li_attr->is_taxonomy()
		? wc_get_product_terms( $li_id, $li_attr->get_name(), array( 'fields' => 'names' ) )
		: $li_attr->get_options();
	if ( $li_vals ) {
		$li_specs[] = array( wc_attribute_label( $li_attr->get_name(), $product ), implode( ', ', $li_vals ) );
	}
}

// Celulares: los datos del equipo salen del nombre, y la descripción cargada
// se muestra solo si habla de este equipo (muchas se copiaron de otro).
$li_specs   = array_merge( li_cel_specs( $li_id ), $li_specs );
$li_desc_ok = li_cel_desc_ok( $li_id );

$li_badge = '';
if ( li_es_usado( $li_id ) ) {
	$li_badge = '<span class="li-badge li-badge--pixel li-badge--black">USADO</span>';
} elseif ( $product->is_on_sale() && (float) $product->get_regular_price() > 0 ) {
	$li_badge = '<span class="li-badge li-badge--pixel li-badge--green">−' . (int) round( ( 1 - (float) $product->get_sale_price() / (float) $product->get_regular_price() ) * 100 ) . '%</span>';
}
?>
<div id="product-<?php the_ID(); ?>" <?php wc_product_class( 'li-pdp', $product ); ?>>

	<div class="li-pdp__grid">

		<div class="li-pdp__gallery">
			<div class="li-pdp__main">
				<?php if ( $li_badge ) : ?>
					<span class="li-pdp__badge"><?php echo $li_badge; // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
				<?php endif; ?>
				<?php
				if ( $li_imgs ) {
					echo wp_get_attachment_image( $li_imgs[0], 'woocommerce_single', false, array( 'class' => 'li-pdp__img', 'data-li-galeria-principal' => '', 'alt' => esc_attr( $li_nombre ), 'fetchpriority' => 'high', 'loading' => 'eager' ) ); // phpcs:ignore WordPress.Security.EscapeOutput
				} else {
					echo '<span class="li-pdp__noimg">' . li_ds_icono( 'box', 64 ) . '<small>Sin foto todavía</small></span>'; // phpcs:ignore WordPress.Security.EscapeOutput
				}
				?>
			</div>
			<?php if ( count( $li_imgs ) > 1 ) : ?>
				<div class="li-pdp__thumbs">
					<?php foreach ( $li_imgs as $li_i => $li_img ) : ?>
						<button type="button" class="li-pdp__thumb<?php echo 0 === $li_i ? ' es-activa' : ''; ?>"
							data-li-galeria="<?php echo esc_url( (string) wp_get_attachment_image_url( $li_img, 'woocommerce_single' ) ); ?>"
							aria-label="<?php echo esc_attr( sprintf( 'Ver foto %d', $li_i + 1 ) ); ?>">
							<?php echo wp_get_attachment_image( $li_img, 'woocommerce_gallery_thumbnail', false, array( 'alt' => '' ) ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
						</button>
					<?php endforeach; ?>
				</div>
			<?php endif; ?>
		</div>

		<div class="li-pdp__info summary entry-summary">
			<?php if ( $li_marca ) : ?>
				<div class="li-pdp__brand"><?php echo esc_html( $li_marca ); ?></div>
			<?php endif; ?>

			<h1 class="li-pdp__title"><?php echo esc_html( $li_nombre ); ?></h1>

			<div class="li-pdp__meta">
				<?php echo li_ds_stock( $product ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<?php if ( $li_sku ) : ?>
					<span class="li-pdp__sku">· Código <span class="sku"><?php echo esc_html( $li_sku ); ?></span></span>
				<?php endif; ?>
			</div>

			<?php li_cel_otras_unidades( $product ); ?>

			<div class="li-pdp__box">
				<?php echo li_ds_precio( $product, 'xl' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>

				<?php if ( $li_compra ) : ?>
					<div class="li-pdp__sep"></div>
					<div class="li-pdp__buy">
						<?php woocommerce_template_single_add_to_cart(); ?>
					</div>
				<?php endif; ?>

				<a class="li-btn li-btn--outline li-btn--lg li-btn--block li-pdp__wa" href="<?php echo esc_url( $li_wa ); ?>" target="_blank" rel="noopener">
					<?php echo li_ds_icono( 'whatsapp', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> Consultar por WhatsApp
				</a>

				<div class="li-pdp__perks">
					<span><?php echo li_ds_icono( 'truck', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> Envío gratis desde $ 100.000</span>
					<span><?php echo li_ds_icono( 'check', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> Retiro en el local</span>
				</div>
			</div>

			<div class="li-pdp__highlight">
				<span class="li-pdp__highlight-ico"><?php echo li_ds_icono( 'store', 22 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
				<div>
					<strong>Retiralo en <?php echo esc_html( LI_DIRECCION ); ?></strong>
					<span>Comprá online y pasá a buscarlo por el local, en <?php echo esc_html( LI_LOCALIDAD ); ?>. Sin costo.</span>
				</div>
			</div>

			<div class="li-acc">
				<?php if ( $li_specs ) : ?>
					<details class="li-acc__item" open>
						<summary>Especificaciones <?php echo li_ds_icono( 'chevron-d', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></summary>
						<dl class="li-acc__rows">
							<?php foreach ( $li_specs as $li_s ) : ?>
								<div><dt><?php echo esc_html( $li_s[0] ); ?></dt><dd><?php echo esc_html( $li_s[1] ); ?></dd></div>
							<?php endforeach; ?>
						</dl>
					</details>
				<?php endif; ?>

				<?php $li_seo = li_seo_producto( $li_id ); ?>
				<?php if ( $li_seo && ! empty( $li_seo['descripcion'] ) ) : ?>
					<?php // Descripción curada (seo/productos): manda sobre la cargada, que en varios productos es de otro. ?>
					<details class="li-acc__item"<?php echo $li_specs ? '' : ' open'; ?>>
						<summary>Descripción <?php echo li_ds_icono( 'chevron-d', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></summary>
						<div class="li-acc__text">
							<?php echo wp_kses_post( $li_seo['descripcion'] ); ?>
						</div>
					</details>
				<?php elseif ( $li_desc_ok && ( $product->get_description() || $product->get_short_description() ) ) : ?>
					<details class="li-acc__item"<?php echo $li_specs ? '' : ' open'; ?>>
						<summary>Descripción <?php echo li_ds_icono( 'chevron-d', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></summary>
						<div class="li-acc__text">
							<?php echo wp_kses_post( wpautop( $product->get_description() ? $product->get_description() : $product->get_short_description() ) ); ?>
						</div>
					</details>
				<?php endif; ?>

				<details class="li-acc__item">
					<summary>Envío y retiro <?php echo li_ds_icono( 'chevron-d', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></summary>
					<dl class="li-acc__rows">
						<div><dt>Retiro en el local</dt><dd><?php echo esc_html( LI_DIRECCION . ', ' . LI_LOCALIDAD ); ?> · Sin costo</dd></div>
						<div><dt>Envío a todo el país</dt><dd>Gratis en compras desde $ 100.000</dd></div>
						<div><dt>Compras menores</dt><dd>El costo del envío se calcula en el checkout</dd></div>
					</dl>
				</details>
			</div>
		</div>
	</div>

	<?php
	$li_rel = function_exists( 'li_reglas_ids' ) ? li_reglas_ids( wc_get_related_products( $li_id, 8 ) ) : array();
	if ( $li_rel ) :
		?>
		<section class="li-pdp__related">
			<h2 class="li-h2">También podés ver</h2>
			<?php li_ds_grilla( array_slice( $li_rel, 0, 4 ), 'li-grid--4' ); ?>
		</section>
	<?php endif; ?>

	<?php if ( $li_compra ) : ?>
		<div class="li-buybar" aria-hidden="true">
			<?php echo li_ds_precio( $product, 'sm' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			<button type="button" class="li-btn li-btn--primary" data-li-comprar tabindex="-1">Comprar</button>
		</div>
	<?php endif; ?>
</div>

<?php
// La plantilla no pasa por woocommerce_single_product_summary, que es donde
// WooCommerce arma los datos de producto para Google: se piden a mano.
if ( isset( WC()->structured_data ) ) {
	WC()->structured_data->generate_product_data( $product );
}

do_action( 'woocommerce_after_single_product' );
