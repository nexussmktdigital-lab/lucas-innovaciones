<?php
/**
 * Portada — design-system/ui_kit/Home.jsx.
 *
 * Hero negro, tira de marcas, 6 categorías, lo más vendido y "Nosotros".
 * Desvíos del kit (pedidos de Matias): sin cuotas (ni en el hero ni el banner
 * de cuotas), sin bloque de reseñas, "20 años", dirección Caseros 924, sin
 * emoji y nada que no esté confirmado (garantía, envío en 24 hs, horarios).
 *
 * Todo sale del catálogo publicable: si una sección no tiene qué mostrar,
 * no se dibuja.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

get_header();

$li_datos = li_datos_portada();
$li_dest  = $li_datos['destacado'] ? wc_get_product( $li_datos['destacado'] ) : null;
$li_shop  = wc_get_page_permalink( 'shop' );
?>

<main id="contenido" class="li-home">

	<section class="li-hero">
		<div class="li-wrap li-hero__grid">
			<div class="li-hero__text">
				<span class="li-badge li-badge--pixel li-badge--greendk li-hero__kicker">[ DESTACADO_DEL_MES ]</span>
				<h1 class="li-hero__title">Tenemos toda la tecnología para brindarte la <span class="li-green">comodidad</span> que te mereces.</h1>
				<p class="li-hero__lead">Celulares, accesorios, audio y más. Te atendemos en Villa Santa Rosa y enviamos a todo el país.</p>
				<div class="li-hero__ctas">
					<a class="li-btn li-btn--primary li-btn--lg" href="<?php echo esc_url( $li_shop ); ?>">Ver catálogo <?php echo li_ds_icono( 'chevron-r', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?></a>
					<a class="li-btn li-btn--outline-light li-btn--lg" href="<?php echo esc_url( li_whatsapp_url( 'Hola! Quería hacer una consulta.' ) ); ?>" target="_blank" rel="noopener"><?php echo li_ds_icono( 'whatsapp', 18 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> Consultar por WhatsApp</a>
				</div>
				<ul class="li-hero__checks">
					<li><?php echo li_ds_icono( 'check', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> 20 años de trayectoria</li>
					<li><?php echo li_ds_icono( 'check', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> Retiro en <?php echo esc_html( LI_DIRECCION ); ?></li>
					<li><?php echo li_ds_icono( 'check', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput ?> Envíos a todo el país</li>
				</ul>
			</div>

			<div class="li-hero__visual" aria-hidden="<?php echo $li_dest ? 'false' : 'true'; ?>">
				<div class="li-hero__glow"></div>
				<div class="li-hero__circle">
					<?php if ( $li_dest ) : ?>
						<?php echo $li_dest->get_image( 'large', array( 'class' => 'li-hero__img', 'fetchpriority' => 'high', 'loading' => 'eager' ) ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					<?php else : ?>
						<?php echo li_ds_icono( 'power', 96, 'li-hero__power' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					<?php endif; ?>
				</div>
				<?php if ( $li_dest ) : ?>
					<a class="li-hero__float" href="<?php echo esc_url( $li_dest->get_permalink() ); ?>">
						<?php $li_m = li_marca_producto( $li_dest->get_id() ); ?>
						<?php if ( $li_m ) : ?>
							<span class="li-card__brand"><?php echo esc_html( $li_m ); ?></span>
						<?php endif; ?>
						<span class="li-hero__float-name"><?php echo esc_html( li_nombre_web( $li_dest ) ); ?></span>
						<?php echo li_ds_precio( $li_dest, 'sm' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					</a>
				<?php endif; ?>
			</div>
		</div>
	</section>

	<?php if ( $li_datos['marcas_top'] ) : ?>
	<section class="li-brands" aria-label="Marcas">
		<div class="li-wrap li-brands__in">
			<?php foreach ( $li_datos['marcas_top'] as $m ) : ?>
				<?php
				// Versión para la tira (silueta recortada, tools/imagenes/logos-tira.mjs), si existe.
				$li_tira = '/assets/img/marcas/tira/' . $m['slug'] . '.png';
				$li_logo = file_exists( LI_DIR . $li_tira ) ? LI_URI . $li_tira : $m['img'];
				?>
				<a class="li-brands__item" href="<?php echo esc_url( $m['url'] ); ?>" title="<?php echo esc_attr( $m['nombre'] ); ?>"><img class="li-brands__logo" src="<?php echo esc_url( $li_logo ); ?>" alt="<?php echo esc_attr( $m['nombre'] ); ?>" loading="lazy" decoding="async"></a>
			<?php endforeach; ?>
		</div>
	</section>
	<?php endif; ?>

	<?php if ( $li_datos['categorias_top'] ) : ?>
	<section class="li-wrap li-section li-section--first">
		<div class="li-section__head">
			<h2 class="li-h2">Elegí tu categoría</h2>
			<a class="li-more" href="<?php echo esc_url( $li_shop ); ?>">Ver todas →</a>
		</div>
		<div class="li-cats">
			<?php foreach ( $li_datos['categorias_top'] as $c ) : ?>
				<a class="li-cat" href="<?php echo esc_url( $c['url'] ); ?>">
					<span class="li-cat__img">
						<?php if ( $c['img'] ) : ?>
							<img src="<?php echo esc_url( $c['img'] ); ?>" alt="" loading="lazy" width="44" height="44">
						<?php else : ?>
							<?php echo li_svg_categoria( $c['slug'], $c['nombre'] ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
						<?php endif; ?>
					</span>
					<span class="li-cat__name"><?php echo esc_html( $c['nombre'] ); ?></span>
					<span class="li-cat__more">Ver productos →</span>
				</a>
			<?php endforeach; ?>
		</div>
	</section>
	<?php endif; ?>

	<?php if ( $li_datos['mas_vendidos'] ) : ?>
	<section class="li-wrap li-section">
		<div class="li-section__head">
			<div>
				<span class="li-badge li-badge--pixel li-badge--green li-section__kicker">[ TOP_SELLERS ]</span>
				<h2 class="li-h2">Lo más vendido del mes</h2>
			</div>
			<a class="li-more" href="<?php echo esc_url( add_query_arg( 'orderby', 'popularity', $li_shop ) ); ?>">Ver más →</a>
		</div>
		<?php li_ds_grilla( array_slice( $li_datos['mas_vendidos'], 0, 4 ), 'li-grid--4' ); ?>
	</section>
	<?php endif; ?>

	<?php
	$li_resto = array_values( array_diff( $li_datos['ultimos'], $li_datos['mas_vendidos'] ) );
	if ( count( $li_resto ) >= 4 ) :
		?>
	<section class="li-wrap li-section">
		<div class="li-section__head">
			<h2 class="li-h2">Últimos ingresos</h2>
			<a class="li-more" href="<?php echo esc_url( add_query_arg( 'orderby', 'date', $li_shop ) ); ?>">Ver más →</a>
		</div>
		<?php li_ds_grilla( array_slice( $li_resto, 0, 4 ), 'li-grid--4' ); ?>
	</section>
	<?php endif; ?>

	<section class="li-trust">
		<div class="li-wrap li-trust__grid">
			<div>
				<span class="li-badge li-badge--neutral">Nosotros</span>
				<h2 class="li-h2 li-trust__title">Somos el local de tecnología de Villa Santa Rosa. Hace <?php echo esc_html( LI_ANTIGUEDAD ); ?>.</h2>
				<p class="li-lead">No somos un ecommerce anónimo. Nos conocés, nos ves en el pueblo y nos bancamos lo que vendemos.</p>
				<div class="li-features">
					<div class="li-feature">
						<span class="li-feature__ico"><?php echo li_ds_icono( 'store' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
						<div><strong>Retirá en el local</strong><span>Comprá online y pasá a buscarlo por <?php echo esc_html( LI_DIRECCION ); ?>.</span></div>
					</div>
					<div class="li-feature">
						<span class="li-feature__ico"><?php echo li_ds_icono( 'truck' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
						<div><strong>Envíos a todo el país</strong><span>Gratis desde $ 100.000.</span></div>
					</div>
					<div class="li-feature">
						<span class="li-feature__ico"><?php echo li_ds_icono( 'card' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
						<div><strong>Pagá como quieras</strong><span>Mercado Pago, transferencia o efectivo al retirar.</span></div>
					</div>
					<div class="li-feature">
						<span class="li-feature__ico"><?php echo li_ds_icono( 'whatsapp' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
						<div><strong>WhatsApp humano</strong><span>Te atiende una persona, no un bot.</span></div>
					</div>
				</div>
			</div>

			<?php // Foto real del frente (original con retoque de luz, sin agregados). ?>
			<a class="li-local" href="<?php echo esc_url( 'https://www.google.com/maps/search/?api=1&query=' . rawurlencode( LI_DIRECCION . ', ' . LI_LOCALIDAD ) ); ?>" target="_blank" rel="noopener">
				<img class="li-local__foto" src="<?php echo esc_url( LI_URI . '/assets/img/local-820.webp' ); ?>"
					srcset="<?php echo esc_url( LI_URI . '/assets/img/local-480.webp' ); ?> 480w, <?php echo esc_url( LI_URI . '/assets/img/local-820.webp' ); ?> 820w"
					sizes="(min-width: 900px) 560px, 100vw" width="820" height="615" loading="lazy" decoding="async"
					alt="<?php echo esc_attr( 'Frente del local de Lucas Innovaciones en ' . LI_DIRECCION . ', ' . LI_LOCALIDAD ); ?>">
				<span class="li-badge li-badge--pixel li-badge--green">[ EL_LOCAL ]</span>
				<span class="li-local__info">
					<span class="li-local__addr"><?php echo esc_html( LI_DIRECCION ); ?></span>
					<span class="li-local__city"><?php echo esc_html( LI_LOCALIDAD ); ?></span>
				</span>
				<span class="li-local__cta">Cómo llegar →</span>
			</a>
		</div>
	</section>

</main>

<?php
get_footer();
