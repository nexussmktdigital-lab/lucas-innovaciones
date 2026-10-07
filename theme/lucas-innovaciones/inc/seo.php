<?php
/**
 * Meta descripción, Open Graph y datos estructurados de producto.
 *
 * No hay plugin de SEO activo: sin esto Google arma la descripción a su
 * criterio y un enlace compartido por WhatsApp sale sin foto. Los textos se
 * arman con datos confiables (nombre sin IMEI, precio de la web, dirección),
 * no con las descripciones cargadas: varias de celulares son de otro equipo.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/**
 * Descripción corta de un producto para buscadores y redes.
 *
 * @param WC_Product $p Producto.
 */
function li_seo_desc_producto( WC_Product $p ): string {
	$nombre = li_nombre_publico( $p->get_name() );
	$precio = (float) wc_get_price_to_display( $p );
	// wc_price() trae entidades (&#36;&nbsp;): en los datos para Google van como texto.
	$monto  = str_replace( "\u{00A0}", ' ', html_entity_decode( wp_strip_all_tags( wc_price( $precio, array( 'decimals' => 0 ) ) ), ENT_QUOTES, 'UTF-8' ) );
	$texto  = $precio > 1
		? sprintf( '%s a %s en Lucas Innovaciones.', $nombre, $monto )
		: sprintf( '%s en Lucas Innovaciones.', $nombre );

	return $texto . ' Retiralo en ' . LI_DIRECCION . ', ' . LI_LOCALIDAD . ', o recibilo en todo el país.';
}

add_action( 'wp_head', 'li_seo_meta', 2 );
/**
 * Imprime description y Open Graph de la página en curso.
 */
function li_seo_meta(): void {
	$desc = 'Tecnología en Villa Santa Rosa, Córdoba: celulares, accesorios, audio y más. Retiro en ' . LI_DIRECCION . ' y envíos a todo el país. ' . LI_ANTIGUEDAD . ' de trayectoria.';
	$img  = LI_URI . '/assets/img/local-820.webp';
	$tipo = 'website';
	$url  = home_url( '/' );
	$prod = null;

	if ( is_product() ) {
		$prod = wc_get_product( get_queried_object_id() );
		if ( ! $prod ) {
			return;
		}
		$desc = li_seo_desc_producto( $prod );
		$img  = (string) wp_get_attachment_image_url( $prod->get_image_id(), 'woocommerce_single' );
		$tipo = 'product';
		$url  = (string) get_permalink( $prod->get_id() );
	} elseif ( is_product_taxonomy() ) {
		$t    = get_queried_object();
		$desc = $t->description
			? wp_trim_words( wp_strip_all_tags( $t->description ), 30, '…' )
			: sprintf( '%s en Lucas Innovaciones, %s. Retiro en %s y envíos a todo el país.', $t->name, LI_LOCALIDAD, LI_DIRECCION );
		$thumb = (int) get_term_meta( $t->term_id, 'thumbnail_id', true );
		if ( $thumb ) {
			$img = (string) wp_get_attachment_image_url( $thumb, 'large' );
		}
		$url = (string) get_term_link( $t );
	} elseif ( is_shop() ) {
		$url = (string) wc_get_page_permalink( 'shop' );
	} elseif ( is_page() && ! is_front_page() ) {
		$texto = wp_strip_all_tags( strip_shortcodes( (string) get_post_field( 'post_content', get_queried_object_id() ) ) );
		if ( '' !== trim( $texto ) ) {
			$desc = wp_trim_words( $texto, 28, '…' );
		}
		$url = (string) get_permalink();
	} elseif ( ! is_front_page() ) {
		return;
	}

	$tags = array(
		'description'    => $desc,
		'og:site_name'   => 'Lucas Innovaciones',
		'og:locale'      => 'es_AR',
		'og:type'        => $tipo,
		'og:title'       => wp_get_document_title(),
		'og:description' => $desc,
		'og:url'         => $url,
		'og:image'       => $img,
		'twitter:card'   => 'summary_large_image',
	);
	if ( $prod && (float) wc_get_price_to_display( $prod ) > 1 ) {
		$tags['product:price:amount']   = (string) round( (float) wc_get_price_to_display( $prod ) );
		$tags['product:price:currency'] = 'ARS';
	}

	foreach ( $tags as $k => $v ) {
		if ( '' === (string) $v ) {
			continue;
		}
		$attr = ( 'description' === $k || str_starts_with( $k, 'twitter:' ) ) ? 'name' : 'property';
		printf( '<meta %s="%s" content="%s">' . "\n", $attr, esc_attr( $k ), esc_attr( $v ) );
	}
}

add_filter( 'woocommerce_structured_data_product', 'li_seo_datos_producto', 10, 2 );
/**
 * Datos de producto para Google con el nombre sin IMEI y, en los celulares
 * cuya descripción cargada es de otro equipo, una descripción armada.
 *
 * @param array      $datos Datos estructurados.
 * @param WC_Product $p     Producto.
 * @return array
 */
function li_seo_datos_producto( $datos, $p ) {
	$datos['name'] = li_nombre_publico( $p->get_name() );
	if ( empty( $datos['description'] ) || ! li_cel_desc_ok( $p->get_id() ) ) {
		$datos['description'] = li_seo_desc_producto( $p );
	}
	return $datos;
}
