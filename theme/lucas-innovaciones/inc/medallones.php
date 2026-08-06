<?php
/**
 * Medallones circulares de categorías y marcas.
 *
 * Tres fuentes, en este orden:
 *
 *   1. La imagen del término de WooCommerce, si el cliente la cargó desde
 *      Productos → Categorías / Marcas. Siempre gana.
 *   2. Para marcas, el logo que el tema trae en assets/img/marcas/{slug}.
 *   3. Un ícono dibujado en SVG.
 *
 * El paso 3 no es un parche a la espera de fotos: con 22 imágenes sobre 797
 * productos es lo que se va a ver casi siempre, así que está resuelto como
 * pieza definitiva y no como reserva.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/**
 * Extensiones aceptadas para los logos de marca, por orden de preferencia.
 */
const LI_MARCA_EXT = array( 'svg', 'png', 'webp', 'jpg', 'jpeg' );

/**
 * Resuelve la imagen de un término: la que cargó el cliente en WooCommerce.
 *
 * @param int $term_id Identificador del término.
 * @return string URL o cadena vacía.
 */
function li_termino_imagen( int $term_id ): string {
	$id = (int) get_term_meta( $term_id, 'thumbnail_id', true );
	if ( $id <= 0 ) {
		return '';
	}

	$src = wp_get_attachment_image_url( $id, 'woocommerce_thumbnail' );

	return $src ? (string) $src : '';
}

/**
 * Colores de fondo declarados para los círculos de marca.
 *
 * Casi todos los logos son oscuros sobre transparente y viven bien en un
 * círculo blanco. Los que no —los que traen su propio fondo de color, o los
 * que son blancos y en blanco desaparecerían— se declaran en fondos.json.
 *
 * @return array<string,string> Slug => color hexadecimal.
 */
function li_marca_fondos(): array {
	static $mapa = null;

	if ( null !== $mapa ) {
		return $mapa;
	}

	$mapa    = array();
	$archivo = LI_DIR . '/assets/img/marcas/fondos.json';

	if ( file_exists( $archivo ) ) {
		$json = json_decode( (string) file_get_contents( $archivo ), true );
		if ( is_array( $json ) ) {
			$mapa = $json;
		}
	}

	return $mapa;
}

/**
 * Busca en assets/img/{carpeta} un archivo que se llame como el slug.
 *
 * Se resuelve una sola vez cada seis horas, dentro de la caché de la
 * portada: preguntar por 26 archivos en cada carga sería tocar el disco
 * 26 veces para no mostrar nada distinto.
 *
 * @param string $carpeta Subcarpeta de assets/img.
 * @param string $slug    Slug del término.
 * @return string URL o cadena vacía.
 */
function li_asset_por_slug( string $carpeta, string $slug ): string {
	if ( '' === $slug ) {
		return '';
	}

	foreach ( LI_MARCA_EXT as $ext ) {
		$rel = '/assets/img/' . $carpeta . '/' . $slug . '.' . $ext;
		if ( file_exists( LI_DIR . $rel ) ) {
			return LI_URI . $rel;
		}
	}

	return '';
}

/**
 * Imagen que el tema trae para una categoría.
 *
 * Va recortada por el círculo, así que conviene que sea cuadrada y con el
 * asunto al centro: las esquinas no se ven.
 *
 * @param string $slug Slug del término de categoría.
 * @return string URL o cadena vacía.
 */
function li_categoria_imagen( string $slug ): string {
	return li_asset_por_slug( 'categorias', $slug );
}

/**
 * Busca el logo que el tema trae para una marca, con su color de círculo.
 *
 * @param string $slug Slug del término de marca.
 * @return array{url:string,fondo:string}
 */
function li_marca_logo( string $slug ): array {
	$url = li_asset_por_slug( 'marcas', $slug );

	if ( '' === $url ) {
		return array(
			'url'   => '',
			'fondo' => '',
		);
	}

	$fondos = li_marca_fondos();
	$fondo  = (string) ( $fondos[ $slug ] ?? '' );

	return array(
		'url'   => $url,
		'fondo' => preg_match( '/^#[0-9A-Fa-f]{6}$/', $fondo ) ? strtoupper( $fondo ) : '',
	);
}

/**
 * Dibuja el medallón circular de una categoría.
 *
 * @param array<string,mixed> $c Categoría de li_datos_portada().
 */
function li_medallon_categoria( array $c ): void {
	$img = (string) ( $c['img'] ?? '' );

	if ( $img ) {
		printf(
			'<span class="medallon"><img class="medallon__img" src="%s" alt="" loading="lazy" decoding="async" width="180" height="180"></span>',
			esc_url( $img )
		);
		return;
	}

	printf(
		'<span class="medallon medallon--icono">%s</span>',
		li_svg_categoria( (string) ( $c['slug'] ?? '' ), (string) ( $c['nombre'] ?? '' ) ) // phpcs:ignore WordPress.Security.EscapeOutput
	);
}

/**
 * Dibuja el medallón circular de una marca.
 *
 * @param array<string,mixed> $m Marca de li_datos_portada().
 */
function li_medallon_marca( array $m ): void {
	$img   = (string) ( $m['img'] ?? '' );
	$fondo = (string) ( $m['fondo'] ?? '' );

	if ( $img ) {
		/*
		 * El color va en línea y no en una clase: es un dato del logo, no un
		 * estado del diseño, y así gana sobre el blanco del hover sin que
		 * haya que escribir una excepción por marca.
		 */
		printf(
			'<span class="medallon medallon--logo"%s><img class="medallon__img" src="%s" alt="" loading="lazy" decoding="async"></span>',
			$fondo ? ' style="background:' . esc_attr( $fondo ) . '"' : '',
			esc_url( $img )
		);
		return;
	}

	$nombre = (string) ( $m['nombre'] ?? '' );
	$inicial = $nombre ? mb_strtoupper( mb_substr( $nombre, 0, 1 ) ) : '·';

	printf(
		'<span class="medallon medallon--inicial" aria-hidden="true">%s</span>',
		esc_html( $inicial )
	);
}

/**
 * Devuelve el SVG de una categoría.
 *
 * Primero por slug exacto —las diez que hoy llegan a la portada están
 * dibujadas una por una— y después por palabra clave, para que una
 * categoría nueva caiga en algo razonable sin tocar el tema.
 *
 * @param string $slug   Slug del término.
 * @param string $nombre Nombre visible, para la búsqueda por palabra.
 * @return string SVG completo.
 */
function li_svg_categoria( string $slug, string $nombre = '' ): string {
	$exactos = array(
		'smartphones-nuevos'          => 'telefono',
		'smartphones-usados'          => 'telefono',
		'cables-de-carga'             => 'cable',
		'cocina'                      => 'olla',
		'cargadores-de-pared'         => 'cargador',
		'perifericos-computacion'     => 'teclado',
		'mates-mate-y-termos'         => 'mate',
		'luces-de-ambiente-y-evento'  => 'luz',
		'cables-de-audio'             => 'plug',
		'vasos-y-botellas-termicas'   => 'botella',
		'auriculares-con-cable'       => 'auriculares',
		'auriculares-inalambricos'    => 'auriculares',
	);

	$clave = $exactos[ $slug ] ?? '';

	if ( ! $clave ) {
		$clave = li_clave_por_palabra( $slug . ' ' . $nombre );
	}

	$formas = li_formas_svg();
	$d      = $formas[ $clave ] ?? $formas['caja'];

	return sprintf(
		'<svg class="medallon__svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">%s</svg>',
		$d
	);
}

/**
 * Elige un ícono buscando palabras en el slug y el nombre.
 *
 * @param string $texto Slug y nombre concatenados.
 * @return string Clave del ícono.
 */
function li_clave_por_palabra( string $texto ): string {
	$texto = strtolower( remove_accents( $texto ) );

	$reglas = array(
		'telefono'    => array( 'celular', 'smartphone', 'telefono', 'iphone', 'movil' ),
		'auriculares' => array( 'auricular', 'headset', 'vincha' ),
		'plug'        => array( 'audio', 'jack', 'plug', 'microfono' ),
		'parlante'    => array( 'parlante', 'speaker', 'bafle', 'sonido' ),
		'cable'       => array( 'cable', 'usb', 'hdmi', 'adaptador' ),
		'cargador'    => array( 'cargador', 'carga', 'fuente', 'enchufe', 'zapatilla' ),
		'bateria'     => array( 'bateria', 'power bank', 'powerbank', 'pila' ),
		'funda'       => array( 'funda', 'estuche', 'case' ),
		'escudo'      => array( 'vidrio', 'templado', 'hidrogel', 'protector' ),
		'memoria'     => array( 'memoria', 'sd', 'pendrive', 'almacenamiento', 'disco' ),
		'teclado'     => array( 'teclado', 'mouse', 'periferico', 'computacion', 'pc' ),
		'notebook'    => array( 'notebook', 'laptop', 'monitor', 'tablet' ),
		'reloj'       => array( 'reloj', 'smartwatch', 'watch' ),
		'luz'         => array( 'luz', 'luces', 'led', 'lampara', 'linterna', 'velador' ),
		'olla'        => array( 'cocina', 'olla', 'sarten', 'pava', 'utensilio' ),
		'mate'        => array( 'mate', 'bombilla', 'yerba' ),
		'botella'     => array( 'botella', 'termo', 'vaso', 'termica' ),
		'hogar'       => array( 'hogar', 'casa', 'bazar', 'deco' ),
		'herramienta' => array( 'herramienta', 'repuesto', 'taller' ),
		'juego'       => array( 'juego', 'gamer', 'gaming', 'joystick', 'consola' ),
		'soporte'     => array( 'soporte', 'tripode', 'holder', 'brazo' ),
	);

	foreach ( $reglas as $clave => $palabras ) {
		foreach ( $palabras as $p ) {
			if ( str_contains( $texto, $p ) ) {
				return $clave;
			}
		}
	}

	return 'caja';
}

/**
 * Los trazos de cada ícono, sobre una grilla de 24×24.
 *
 * @return array<string,string>
 */
function li_formas_svg(): array {
	return array(
		'telefono'    => '<rect x="6.5" y="2" width="11" height="20" rx="2.5"/><path d="M10.5 18.5h3"/>',
		'cable'       => '<path d="M21 6.5h-5.5a5 5 0 0 0-5 5 5 5 0 0 1-5 5H3"/><rect x="18.5" y="4" width="4" height="5" rx="1.2"/><path d="M2 14.5h3v4H2z"/>',
		'olla'        => '<path d="M4 9.5h16V15a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z"/><path d="M4 12H2M20 12h2"/><path d="M9 6.5V4.5M12 6.5V3.5M15 6.5V4.5"/>',
		'cargador'    => '<rect x="4" y="7" width="16" height="12.5" rx="3"/><path d="M9 7V4M15 7V4"/><circle cx="9.5" cy="13" r="1.1"/><circle cx="14.5" cy="13" r="1.1"/>',
		'teclado'     => '<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
		'mate'        => '<path d="M6 9.5c0 4.2 2.7 8 6 8s6-3.8 6-8Z"/><path d="M15.6 9.5 19.4 3.9"/><circle cx="20" cy="3" r="1.2"/><path d="M5 9.5h14"/>',
		'luz'         => '<path d="M12 2.5a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 2.5Z"/><path d="M9.5 18.5h5M10.5 21.5h3"/>',
		'plug'        => '<path d="M9 3.5h6v7.5a3 3 0 0 1-6 0Z"/><path d="M10.5 3.5V1.8M13.5 3.5V1.8"/><path d="M12 14v3a3.5 3.5 0 0 0 3.5 3.5H19"/>',
		'botella'     => '<path d="M9.5 2.5h5v2.8l1.2 2.4V19a2.5 2.5 0 0 1-2.5 2.5h-2.4A2.5 2.5 0 0 1 8.3 19V7.7Z"/><path d="M8.3 11.5h7.4"/>',
		'auriculares' => '<path d="M4 15v-2.5a8 8 0 0 1 16 0V15"/><rect x="2" y="13.5" width="4.5" height="7.5" rx="2.2"/><rect x="17.5" y="13.5" width="4.5" height="7.5" rx="2.2"/>',
		'parlante'    => '<rect x="6" y="2.5" width="12" height="19" rx="3"/><circle cx="12" cy="15" r="3.4"/><circle cx="12" cy="7" r="1.1"/>',
		'bateria'     => '<rect x="2" y="7" width="17" height="10" rx="2.5"/><path d="M21.5 10.5v3"/><path d="M6 12h7"/>',
		'funda'       => '<rect x="6" y="2" width="12" height="20" rx="3"/><circle cx="9" cy="6" r="1.1"/><path d="M6 9h12"/>',
		'escudo'      => '<path d="M12 2.5 4.5 5.2v6.4c0 4.7 3.1 8.2 7.5 9.6 4.4-1.4 7.5-4.9 7.5-9.6V5.2Z"/><path d="m9.2 12 2 2 3.6-3.8"/>',
		'memoria'     => '<rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2.5v2M15 2.5v2M9 19.5v2M15 19.5v2M2.5 9h2M2.5 15h2M19.5 9h2M19.5 15h2"/>',
		'notebook'    => '<rect x="3" y="5" width="18" height="11.5" rx="2"/><path d="M1.5 19.5h21"/>',
		'reloj'       => '<rect x="7" y="6" width="10" height="12" rx="3"/><path d="M9 6V3h6v3M9 18v3h6v-3"/><path d="M12 9.8v2.6l1.7 1"/>',
		'hogar'       => '<path d="M3 10.7 12 3l9 7.7"/><path d="M5.5 9.6V20.5h13V9.6"/><path d="M10 20.5v-5h4v5"/>',
		'herramienta' => '<path d="M14.5 3.5a5 5 0 0 0-3.4 8.2L3.5 19.4l1.6 1.6 7.7-7.6a5 5 0 0 0 6.9-6.4l-2.8 2.8-2.5-2.5 2.8-2.8a5 5 0 0 0-2.7-1Z"/>',
		'juego'       => '<rect x="2" y="7" width="20" height="10.5" rx="4"/><path d="M7 10.5v3M5.5 12h3"/><circle cx="16" cy="11" r="1.1"/><circle cx="18.5" cy="13.5" r="1.1"/>',
		'soporte'     => '<rect x="8" y="2.5" width="8" height="12.5" rx="2"/><path d="M12 15v4M8 21.5h8"/>',
		'caja'        => '<path d="M12 2.5 3.5 7v10L12 21.5 20.5 17V7Z"/><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10"/>',
	);
}
