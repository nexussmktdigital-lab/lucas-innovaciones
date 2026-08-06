<?php
/**
 * Banners de la portada.
 *
 * Se dibujan con HTML y CSS, no con imágenes: el texto queda nítido en
 * cualquier pantalla, se relee en el buscador, se traduce, se adapta al
 * ancho del teléfono y pesa cero. Un JPG de 1600 px con el título adentro
 * no hace nada de eso y hay que rehacerlo cada vez que cambia una palabra.
 *
 * Cada diapositiva acepta además una imagen de fondo (`img`, un ID de la
 * biblioteca de medios). Cuando entre arte generado, entra por ahí y el
 * texto se sigue dibujando encima.
 *
 * Los textos por defecto salen del catálogo y de la configuración de la
 * tienda: son afirmaciones verificables. Ningún porcentaje de descuento
 * está inventado — para anunciar una promoción, el cliente edita la
 * opción `li_banners` y la escribe él.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/**
 * Diapositivas de la portada.
 *
 * @return array<int,array<string,mixed>>
 */
function li_banners(): array {
	$guardados = get_option( 'li_banners', array() );

	if ( is_array( $guardados ) && $guardados ) {
		return array_values( array_filter( array_map( 'li_banner_normalizar', $guardados ) ) );
	}

	return apply_filters( 'li_banners', li_banners_por_defecto() );
}

/**
 * Completa una diapositiva guardada con las claves que falten.
 *
 * @param mixed $b Diapositiva cruda.
 * @return array<string,mixed>|null
 */
function li_banner_normalizar( $b ): ?array {
	if ( ! is_array( $b ) || empty( $b['titulo'] ) ) {
		return null;
	}

	return array(
		'tema'   => in_array( $b['tema'] ?? '', array( 'negro', 'verde', 'claro' ), true ) ? $b['tema'] : 'negro',
		'kicker' => (string) ( $b['kicker'] ?? '' ),
		'titulo' => (string) $b['titulo'],
		'texto'  => (string) ( $b['texto'] ?? '' ),
		'dato'   => (string) ( $b['dato'] ?? '' ),
		'unidad' => (string) ( $b['unidad'] ?? '' ),
		'cta'    => (string) ( $b['cta'] ?? '' ),
		'url'    => (string) ( $b['url'] ?? '' ),
		'img'    => (int) ( $b['img'] ?? 0 ),
	);
}

/**
 * Las tres diapositivas de arranque, armadas con datos reales.
 *
 * @return array<int,array<string,mixed>>
 */
function li_banners_por_defecto(): array {
	$datos  = li_datos_portada();
	$local  = li_local();
	$tienda = wc_get_page_permalink( 'shop' );

	$slides = array();

	// 1. Lo que de verdad distingue al negocio: existe un local con dirección.
	if ( $local['direccion'] ) {
		$slides[] = array(
			'tema'   => 'negro',
			'kicker' => trim( $local['ciudad'] ? $local['ciudad'] : 'Córdoba' ),
			'titulo' => 'Comprá online,<br>retirá en el local',
			'texto'  => sprintf( 'Lo reservás desde acá y lo pasás a buscar por %s. O te lo enviamos.', $local['direccion'] ),
			'dato'   => 'RETIRO',
			'unidad' => 'en el local',
			'cta'    => 'Ver catálogo',
			'url'    => $tienda,
			'img'    => 0,
		);
	}

	// 2. La categoría con más productos, sea cual sea hoy.
	$top = $datos['categorias_top'][0] ?? null;
	if ( $top ) {
		$slides[] = array(
			'tema'   => 'verde',
			'kicker' => 'Lo más buscado',
			'titulo' => $top['nombre'],
			'texto'  => 'Marcas, modelos y accesorios, con precio actualizado.',
			'dato'   => (string) $top['cuenta'],
			'unidad' => 'en stock',
			'cta'    => 'Ver ' . mb_strtolower( $top['nombre'] ),
			'url'    => $top['url'],
			'img'    => 0,
		);
	}

	/*
	 * 3. La escala del catálogo. Los medios de pago quedan en la franja
	 * "El local", que ya los enumera: repetirlos acá sería decir dos veces
	 * lo mismo a un centímetro de distancia.
	 */
	$slides[] = array(
		'tema'   => 'claro',
		'kicker' => sprintf( '%d categorías · %d marcas', $datos['categorias'], $datos['marcas'] ),
		'titulo' => 'Todo el catálogo,<br>con precio actualizado',
		'texto'  => 'Buscá por marca, por modelo o por lo que necesitás resolver hoy.',
		'dato'   => (string) $datos['productos'],
		'unidad' => 'productos',
		'cta'    => 'Explorar el catálogo',
		'url'    => $tienda,
		'img'    => 0,
	);

	return $slides;
}

/**
 * Dibuja el carrusel completo.
 *
 * @param array<int,array<string,mixed>>|null $slides Diapositivas a mostrar.
 *                                                    Sin argumento usa las de la portada.
 */
function li_banners_render( ?array $slides = null ): void {
	$slides = null === $slides ? li_banners() : $slides;
	if ( ! $slides ) {
		return;
	}

	$multiple = count( $slides ) > 1;
	?>
	<section class="banners" aria-label="Destacados" <?php echo $multiple ? 'data-li-banners' : ''; ?>>
		<div class="contenedor">
			<div class="banners__pista" role="group" aria-live="polite">
				<?php foreach ( $slides as $i => $b ) : ?>
					<?php
					$fondo = $b['img'] ? wp_get_attachment_image_url( (int) $b['img'], 'full' ) : '';
					?>
					<article
						class="banner banner--<?php echo esc_attr( $b['tema'] ); ?><?php echo $fondo ? ' banner--con-arte' : ''; ?>"
						<?php echo $fondo ? 'style="background-image:url(' . esc_url( $fondo ) . ')"' : ''; ?>
						data-li-slide="<?php echo esc_attr( (string) $i ); ?>"
						<?php echo $i > 0 ? 'hidden' : ''; ?>
					>
						<div class="banner__texto">
							<?php if ( $b['kicker'] ) : ?>
								<p class="banner__kicker"><?php echo esc_html( $b['kicker'] ); ?></p>
							<?php endif; ?>

							<h2 class="banner__titulo"><?php echo wp_kses( $b['titulo'], array( 'br' => array() ) ); ?></h2>

							<?php if ( $b['texto'] ) : ?>
								<p class="banner__bajada"><?php echo esc_html( $b['texto'] ); ?></p>
							<?php endif; ?>

							<?php if ( $b['cta'] && $b['url'] ) : ?>
								<a class="boton banner__cta" href="<?php echo esc_url( $b['url'] ); ?>">
									<?php echo esc_html( $b['cta'] ); ?>
									<?php li_icono( 'flecha' ); ?>
								</a>
							<?php endif; ?>
						</div>

						<?php if ( $b['dato'] ) : ?>
							<p class="banner__sello" aria-hidden="true">
								<span class="banner__sello-num"><?php echo esc_html( $b['dato'] ); ?></span>
								<?php if ( $b['unidad'] ) : ?>
									<span class="banner__sello-etq"><?php echo esc_html( $b['unidad'] ); ?></span>
								<?php endif; ?>
							</p>
						<?php endif; ?>
					</article>
				<?php endforeach; ?>
			</div>

			<?php if ( $multiple ) : ?>
				<div class="banners__control">
					<button type="button" class="banners__flecha" data-li-banner-prev aria-label="Anterior">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>
					</button>

					<div class="banners__puntos" role="tablist" aria-label="Elegir destacado">
						<?php foreach ( $slides as $i => $b ) : ?>
							<button
								type="button"
								class="banners__punto<?php echo 0 === $i ? ' es-activo' : ''; ?>"
								role="tab"
								aria-selected="<?php echo 0 === $i ? 'true' : 'false'; ?>"
								data-li-banner-ir="<?php echo esc_attr( (string) $i ); ?>"
							><span class="visually-hidden"><?php echo esc_html( wp_strip_all_tags( $b['titulo'] ) ); ?></span></button>
						<?php endforeach; ?>
					</div>

					<button type="button" class="banners__flecha" data-li-banner-next aria-label="Siguiente">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
					</button>
				</div>
			<?php endif; ?>
		</div>
	</section>
	<?php
}
