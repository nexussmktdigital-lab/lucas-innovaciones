<?php
/**
 * Convivencia con Elementor.
 *
 * El sitio anterior estaba armado con Elementor + PRO Elements: la portada es
 * una página de Elementor ("Home", plantilla elementor_header_footer), hay un
 * kit global que pisa tipografías de a, h1–h6 e inputs, un popup de menú en
 * todas las páginas y tres snippets en el <head> (VT323 desde Google y CSS del
 * sitio viejo). Con este tema nada de eso aplica.
 *
 * No se borra ni se edita ningún dato de Elementor: estos filtros viven en el
 * tema, así que si se vuelve a Hello Elementor todo queda como estaba.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

add_filter( 'template_include', 'li_portada_propia', 999 );
/**
 * La portada es la del tema, aunque la página de inicio tenga asignada la
 * plantilla de Elementor.
 *
 * @param string $plantilla Plantilla elegida.
 */
function li_portada_propia( string $plantilla ): string {
	/*
	 * Solo se reemplaza la plantilla de Elementor. Cualquier otra que llegue
	 * acá (la de "Próximamente" de WooCommerce, la de mantenimiento) gana:
	 * si se pisaba, el modo próximamente dejaba ver la portada al público.
	 */
	if ( is_front_page() && str_contains( wp_normalize_path( $plantilla ), '/plugins/elementor' ) ) {
		$propia = locate_template( 'front-page.php' );
		if ( $propia ) {
			return $propia;
		}
	}
	return $plantilla;
}

add_filter( 'elementor/theme/get_location_templates/template_id', 'li_sin_ubicaciones_elementor', 10, 2 );
/**
 * Apaga las ubicaciones del Theme Builder (snippets del <head>, popup,
 * cabecera y pie de Elementor). Devolver 0 hace que no se imprima nada.
 *
 * @param int    $id        Plantilla.
 * @param string $ubicacion Ubicación.
 */
function li_sin_ubicaciones_elementor( $id, $ubicacion ) {
	return in_array( $ubicacion, array( 'elementor_head', 'elementor_body_start', 'elementor_body_end', 'popup', 'header', 'footer' ), true ) ? 0 : $id;
}

add_filter( 'body_class', 'li_sin_kit_elementor', 999 );
/**
 * Sin la clase elementor-kit-N, las reglas tipográficas del kit global no
 * encuentran a quién aplicarse.
 *
 * @param string[] $clases Clases.
 * @return string[]
 */
function li_sin_kit_elementor( array $clases ): array {
	return array_values( array_filter( $clases, static fn( $c ) => ! str_starts_with( $c, 'elementor-kit-' ) ) );
}

/**
 * ¿La página actual está hecha con Elementor y se quiere seguir mostrando así?
 * La portada no: la reemplaza front-page.php.
 */
function li_pagina_elementor(): bool {
	if ( is_front_page() || ! is_singular() ) {
		return false;
	}
	return 'builder' === get_post_meta( get_queried_object_id(), '_elementor_edit_mode', true );
}

add_action( 'wp_enqueue_scripts', 'li_sin_assets_elementor', 9999 );
add_action( 'wp_print_styles', 'li_sin_assets_elementor', 9999 );
add_action( 'wp_print_footer_scripts', 'li_sin_assets_elementor', 1 );
/**
 * Descarga CSS, JS y Google Fonts de Elementor donde no se usan: pesan y
 * además traen fuentes desde Google, que el design system pide servir locales.
 */
function li_sin_assets_elementor(): void {
	if ( li_pagina_elementor() ) {
		return;
	}

	$patron = '/^(elementor|e-|pro-elements|swiper|font-awesome|google-fonts|elementor-gf)/';

	foreach ( wp_styles()->queue as $h ) {
		if ( preg_match( $patron, $h ) ) {
			wp_dequeue_style( $h );
		}
	}
	foreach ( wp_scripts()->queue as $h ) {
		if ( preg_match( $patron, $h ) ) {
			wp_dequeue_script( $h );
		}
	}
}

add_filter( 'elementor/frontend/print_google_fonts', '__return_false' );
