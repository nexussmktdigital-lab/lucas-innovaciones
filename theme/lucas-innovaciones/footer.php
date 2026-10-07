<?php
/**
 * Pie — design-system/ui_kit/Footer.jsx.
 *
 * Desvíos del kit: dirección real (Caseros 924), "20 años" en lugar de
 * "desde 2017", horario confirmado, sin CUIT ni garantía hasta que Matias los confirme,
 * y solo los medios de pago que de verdad se aceptan.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

$li_ayuda = array_filter(
	array(
		'Envíos y retiros'      => li_url_pagina( 'envios-y-retiros' ),
		'Cambios y garantía'    => li_url_pagina( 'cambios-y-garantia' ),
		'Términos y condiciones' => li_url_pagina( 'terminos-y-condiciones' ),
		'Mi cuenta'             => wc_get_page_permalink( 'myaccount' ),
		'Mis pedidos'           => wc_get_account_endpoint_url( 'orders' ),
	)
);
?>

<footer class="li-footer" role="contentinfo">
	<div class="li-wrap li-footer__grid">
		<div class="li-footer__brand">
			<?php echo li_ds_logo( true ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			<p class="li-footer__about">Tu local de tecnología en Villa Santa Rosa hace <?php echo esc_html( LI_ANTIGUEDAD ); ?>. Atención humana, retiro en el local y envíos a todo el país.</p>
			<div class="li-footer__social">
				<a href="<?php echo esc_url( 'https://www.instagram.com/' . LI_INSTAGRAM . '/' ); ?>" target="_blank" rel="noopener" aria-label="Instagram"><?php echo li_ds_icono( 'instagram', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></a>
				<a href="https://www.facebook.com/Lucas-Innovaciones" target="_blank" rel="noopener" aria-label="Facebook"><?php echo li_ds_icono( 'facebook', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></a>
				<a href="<?php echo esc_url( li_whatsapp_url() ); ?>" target="_blank" rel="noopener" aria-label="WhatsApp"><?php echo li_ds_icono( 'whatsapp', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></a>
			</div>
		</div>

		<div>
			<h4 class="li-footer__title">Catálogo</h4>
			<ul class="li-footer__list">
				<?php foreach ( li_categorias_principales( 6 ) as $c ) : ?>
					<li><a href="<?php echo esc_url( $c['url'] ); ?>"><?php echo esc_html( $c['nombre'] ); ?></a></li>
				<?php endforeach; ?>
				<li><a href="<?php echo esc_url( wc_get_page_permalink( 'shop' ) ); ?>">Ver todo</a></li>
			</ul>
		</div>

		<div>
			<h4 class="li-footer__title">Ayuda</h4>
			<ul class="li-footer__list">
				<?php foreach ( $li_ayuda as $texto => $url ) : ?>
					<li><a href="<?php echo esc_url( $url ); ?>"><?php echo esc_html( $texto ); ?></a></li>
				<?php endforeach; ?>
			</ul>
		</div>

		<div>
			<h4 class="li-footer__title">Contacto</h4>
			<ul class="li-footer__list li-footer__contact">
				<li>
					<?php echo li_ds_icono( 'map-pin', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					<a href="<?php echo esc_url( 'https://www.google.com/maps/search/?api=1&query=' . rawurlencode( LI_DIRECCION . ', ' . LI_LOCALIDAD ) ); ?>" target="_blank" rel="noopener"><?php echo esc_html( LI_DIRECCION . ', ' . LI_LOCALIDAD ); ?></a>
				</li>
				<li>
					<?php echo li_ds_icono( 'whatsapp', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					<a href="<?php echo esc_url( li_whatsapp_url() ); ?>" target="_blank" rel="noopener"><?php echo esc_html( LI_WHATSAPP_TEXTO ); ?></a>
				</li>
				<li class="li-footer__hours"><?php echo esc_html( LI_HORARIO ); ?></li>
			</ul>
		</div>
	</div>

	<div class="li-wrap li-footer__base">
		<span>&copy; <?php echo esc_html( gmdate( 'Y' ) ); ?> Lucas Innovaciones · Todos los derechos reservados · Sitio por <a href="https://nexuss.com.ar/" target="_blank" rel="noopener">Nexuss Digital Agency</a></span>
		<?php $li_arrep = li_url_pagina( 'boton-de-arrepentimiento' ); ?>
		<?php if ( $li_arrep ) : ?>
			<a class="li-footer__arrep" href="<?php echo esc_url( $li_arrep ); ?>">
				<svg class="li-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
				Botón de arrepentimiento
			</a>
		<?php endif; ?>
		<span class="li-footer__pay">
			<span>Mercado Pago</span>
			<span>Transferencia</span>
			<span>Efectivo al retirar</span>
		</span>
	</div>
</footer>

<a class="li-wafab" href="<?php echo esc_url( li_whatsapp_url( 'Hola! Quería hacer una consulta.' ) ); ?>" target="_blank" rel="noopener" aria-label="<?php esc_attr_e( '¿Te ayudo a elegir? Escribinos por WhatsApp', 'lucasinnovaciones' ); ?>">
	<?php echo li_ds_icono( 'whatsapp', 30 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
</a>

<?php wp_footer(); ?>
</body>
</html>
