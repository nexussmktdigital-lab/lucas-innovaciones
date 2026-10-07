<?php
/**
 * Próximamente — pantalla pública mientras la tienda no está lanzada.
 *
 * Página suelta: sin wp_head() a propósito, para no cargar scripts de
 * plugins ni dejar ver nada de la tienda. Usa ds.css (tokens y fuentes del
 * design system) y el logo oficial. Solo datos confirmados.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

$li_css = LI_DIR . '/assets/css/ds.css';
$li_ver = file_exists( $li_css ) ? (string) filemtime( $li_css ) : LI_VERSION;
$li_mapa = 'https://www.google.com/maps/search/?api=1&query=' . rawurlencode( LI_DIRECCION . ', ' . LI_LOCALIDAD );
?>
<!doctype html>
<html lang="es-AR">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<meta name="robots" content="noindex, nofollow">
	<meta name="theme-color" content="#0A0A0A">
	<title>Lucas Innovaciones · Próximamente</title>
	<meta name="description" content="Estamos preparando la tienda online de Lucas Innovaciones. Mientras tanto, te atendemos en Caseros 924, Villa Santa Rosa, y por WhatsApp.">
	<link rel="preload" href="<?php echo esc_url( LI_URI . '/assets/fonts/SpaceGrotesk-Variable.woff2' ); ?>" as="font" type="font/woff2" crossorigin>
	<link rel="preload" href="<?php echo esc_url( LI_URI . '/assets/fonts/Inter-Variable.woff2' ); ?>" as="font" type="font/woff2" crossorigin>
	<link rel="stylesheet" href="<?php echo esc_url( LI_URI . '/assets/css/ds.css?ver=' . $li_ver ); ?>">
	<?php if ( has_site_icon() ) : ?>
		<link rel="icon" href="<?php echo esc_url( get_site_icon_url( 64 ) ); ?>">
	<?php endif; ?>
</head>
<body class="li-body li-pronto">

<main class="li-pronto__main">
	<div class="li-pronto__glow" aria-hidden="true"></div>

	<div class="li-pronto__card">
		<?php echo li_ds_logo( true ); // phpcs:ignore WordPress.Security.EscapeOutput ?>

		<span class="li-badge li-badge--pixel li-badge--greendk li-pronto__kicker">[ PRÓXIMAMENTE ]</span>

		<h1 class="li-pronto__title">Nuestra tienda online está por <span class="li-green">encenderse</span>.</h1>

		<p class="li-pronto__lead">Estamos terminando de cargar los productos. Mientras tanto, te atendemos en el local y por WhatsApp.</p>

		<div class="li-pronto__ctas">
			<a class="li-btn li-btn--primary li-btn--lg" href="<?php echo esc_url( li_whatsapp_url( 'Hola! Quería hacer una consulta.' ) ); ?>" target="_blank" rel="noopener">
				<?php echo li_ds_icono( 'whatsapp', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> Escribinos por WhatsApp
			</a>
			<a class="li-btn li-btn--outline-light li-btn--lg" href="<?php echo esc_url( 'https://www.instagram.com/' . LI_INSTAGRAM . '/' ); ?>" target="_blank" rel="noopener">
				<?php echo li_ds_icono( 'instagram', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> @<?php echo esc_html( LI_INSTAGRAM ); ?>
			</a>
		</div>

		<ul class="li-pronto__datos">
			<li>
				<?php echo li_ds_icono( 'map-pin', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<a href="<?php echo esc_url( $li_mapa ); ?>" target="_blank" rel="noopener"><?php echo esc_html( LI_DIRECCION . ', ' . LI_LOCALIDAD ); ?></a>
			</li>
			<li>
				<?php echo li_ds_icono( 'store', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<span><?php echo esc_html( LI_HORARIO ); ?></span>
			</li>
			<li>
				<?php echo li_ds_icono( 'whatsapp', 16 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<a href="<?php echo esc_url( li_whatsapp_url() ); ?>" target="_blank" rel="noopener"><?php echo esc_html( LI_WHATSAPP_TEXTO ); ?></a>
			</li>
		</ul>

		<ul class="li-hero__checks li-pronto__checks">
			<li><?php echo li_ds_icono( 'check', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> 20 años de trayectoria</li>
			<li><?php echo li_ds_icono( 'check', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> Retiro en <?php echo esc_html( LI_DIRECCION ); ?></li>
			<li><?php echo li_ds_icono( 'check', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> Envíos a todo el país</li>
		</ul>
	</div>

	<p class="li-pronto__pie">&copy; <?php echo esc_html( gmdate( 'Y' ) ); ?> Lucas Innovaciones</p>
</main>

</body>
</html>
