<?php
/**
 * SEO del sitio: títulos, meta descripción, Open Graph, canonical y datos
 * estructurados (producto, local y migas).
 *
 * No hay plugin de SEO activo. El contenido SEO de cada producto (nombre,
 * título, meta y descripción) vive en `seo/productos/{id}.json`, generado y
 * validado desde `seo/` en el repo (opción A, Matias 08/10): se muestra solo en
 * la web y no se escribe nada en WooCommerce, así el POS sigue viendo los
 * nombres de siempre y todo se revierte borrando los archivos.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/* -------------------------------------------------------------------------
   Contenido SEO por producto
   ------------------------------------------------------------------------- */

/**
 * Contenido SEO de un producto, o null si no tiene archivo.
 *
 * @param int $id Producto (si es una variación, el padre).
 * @return array{nombre:string,titulo:string,meta:string,descripcion:string,keyword:string}|null
 */
function li_seo_producto( int $id ): ?array {
	static $memoria = array();
	if ( array_key_exists( $id, $memoria ) ) {
		return $memoria[ $id ];
	}
	$f   = LI_DIR . '/seo/productos/' . $id . '.json';
	$dat = is_readable( $f ) ? json_decode( (string) file_get_contents( $f ), true ) : null;

	$memoria[ $id ] = is_array( $dat ) && ! empty( $dat['nombre'] ) ? $dat : null;
	return $memoria[ $id ];
}

/**
 * Nombre que se muestra en la web: el SEO si existe; si no, el cargado sin IMEI.
 *
 * @param WC_Product|int $producto Producto o ID.
 */
function li_nombre_web( $producto ): string {
	$p = $producto instanceof WC_Product ? $producto : wc_get_product( (int) $producto );
	if ( ! $p ) {
		return '';
	}
	$id  = $p->is_type( 'variation' ) ? $p->get_parent_id() : $p->get_id();
	$seo = li_seo_producto( $id );
	return $seo ? $seo['nombre'] : li_nombre_publico( $p->get_name() );
}

/**
 * Descripción corta de respaldo, para productos sin archivo SEO.
 *
 * @param WC_Product $p Producto.
 */
function li_seo_desc_producto( WC_Product $p ): string {
	$seo = li_seo_producto( $p->get_id() );
	if ( $seo && ! empty( $seo['meta'] ) ) {
		return $seo['meta'];
	}
	$nombre = li_nombre_web( $p );
	$precio = (float) wc_get_price_to_display( $p );
	// wc_price() trae entidades (&#36;&nbsp;): en los datos para Google van como texto.
	$monto = str_replace( "\u{00A0}", ' ', html_entity_decode( wp_strip_all_tags( wc_price( $precio, array( 'decimals' => 0 ) ) ), ENT_QUOTES, 'UTF-8' ) );
	$texto = $precio > 1
		? sprintf( '%s a %s en Lucas Innovaciones.', $nombre, $monto )
		: sprintf( '%s en Lucas Innovaciones.', $nombre );

	return $texto . ' Retiralo en ' . LI_DIRECCION . ', ' . LI_LOCALIDAD . ', o recibilo en todo el país.';
}

/* -------------------------------------------------------------------------
   Títulos
   ------------------------------------------------------------------------- */

add_filter( 'pre_get_document_title', 'li_seo_titulo', 20 );
/**
 * Título de la pestaña y de Google.
 *
 * @param string $titulo Título que armaría WordPress.
 */
function li_seo_titulo( $titulo ) {
	$pag   = max( 1, (int) get_query_var( 'paged' ) );
	$extra = $pag > 1 ? ' – Página ' . $pag : '';

	if ( is_front_page() ) {
		return 'Lucas Innovaciones | Tecnología en Villa Santa Rosa, Córdoba';
	}
	if ( is_product() ) {
		$seo = li_seo_producto( get_queried_object_id() );
		return $seo ? $seo['titulo'] : li_nombre_web( get_queried_object_id() ) . ' | Lucas Innovaciones';
	}
	if ( is_product_taxonomy() ) {
		$t     = get_queried_object();
		$largo = $t->name . ' en Córdoba | Lucas Innovaciones';
		return ( mb_strlen( $largo ) <= 60 ? $largo : $t->name . ' | Lucas Innovaciones' ) . $extra;
	}
	if ( function_exists( 'is_shop' ) && is_shop() && ! is_search() ) {
		return 'Tienda de tecnología en Córdoba | Lucas Innovaciones' . $extra;
	}
	return $titulo;
}

/* -------------------------------------------------------------------------
   Listados: canonical y filtros
   ------------------------------------------------------------------------- */

/** Parámetros de la URL que solo filtran u ordenan un listado. */
function li_seo_parametros_de_filtro(): array {
	$params = array( 'marca', 'precio_min', 'precio_max', 'orderby', 'modelo', 'capacidad', 'estado', 'bateria', 'li_frag' );
	if ( function_exists( 'li_atributos' ) ) {
		foreach ( array_keys( li_atributos() ) as $tax ) {
			$params[] = li_attr_param( $tax );
		}
	}
	return array_unique( $params );
}

/** ¿El listado en curso tiene algún filtro u orden puesto? */
function li_seo_listado_filtrado(): bool {
	foreach ( li_seo_parametros_de_filtro() as $p ) {
		if ( isset( $_GET[ $p ] ) && '' !== $_GET[ $p ] ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return true;
		}
	}
	return false;
}

/** URL canónica de la tienda o de una categoría, con la página si corresponde. */
function li_seo_canonical_listado(): string {
	$base = is_product_taxonomy() ? get_term_link( get_queried_object() ) : wc_get_page_permalink( 'shop' );
	if ( ! is_string( $base ) ) {
		return '';
	}
	$pag = max( 1, (int) get_query_var( 'paged' ) );
	return $pag > 1 ? trailingslashit( $base ) . 'page/' . $pag . '/' : $base;
}

add_filter( 'wp_robots', 'li_seo_robots_filtros' );
/**
 * Un listado filtrado (por marca, precio, modelo…) es el mismo contenido en
 * otro orden: no se indexa, pero se siguen sus enlaces.
 *
 * @param array $robots Directivas.
 */
function li_seo_robots_filtros( array $robots ): array {
	if ( ( is_product_taxonomy() || ( function_exists( 'is_shop' ) && is_shop() ) ) && li_seo_listado_filtrado() ) {
		$robots['noindex'] = true;
		$robots['follow']  = true;
		unset( $robots['index'] );
	}
	return $robots;
}

/* -------------------------------------------------------------------------
   Meta descripción y Open Graph
   ------------------------------------------------------------------------- */

add_action( 'wp_head', 'li_seo_meta', 2 );
/**
 * Imprime description, canonical de listados y Open Graph.
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
			: sprintf( '%s en Lucas Innovaciones, %s. Retiro gratis en %s y envíos a todo el país.', $t->name, LI_LOCALIDAD, LI_DIRECCION );
		$thumb = (int) get_term_meta( $t->term_id, 'thumbnail_id', true );
		if ( $thumb ) {
			$img = (string) wp_get_attachment_image_url( $thumb, 'large' );
		}
		$url = li_seo_canonical_listado();
	} elseif ( function_exists( 'is_shop' ) && is_shop() && ! is_search() ) {
		$desc = 'Tienda online de Lucas Innovaciones: celulares, cargadores, auriculares, audio, computación y más. Retiro en ' . LI_DIRECCION . ', ' . LI_LOCALIDAD . ', y envíos a todo el país.';
		$url  = li_seo_canonical_listado();
	} elseif ( is_page() && ! is_front_page() ) {
		$texto = wp_strip_all_tags( strip_shortcodes( (string) get_post_field( 'post_content', get_queried_object_id() ) ) );
		if ( '' !== trim( $texto ) ) {
			$desc = wp_trim_words( $texto, 28, '…' );
		}
		$url = (string) get_permalink();
	} elseif ( ! is_front_page() ) {
		return;
	}

	// WordPress pone canonical solo en páginas sueltas: en la tienda y las
	// categorías lo pone el tema. Un listado filtrado apunta al de sin filtros.
	if ( ( is_product_taxonomy() || ( function_exists( 'is_shop' ) && is_shop() && ! is_search() ) ) && $url ) {
		printf( '<link rel="canonical" href="%s">' . "\n", esc_url( $url ) );
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

/* -------------------------------------------------------------------------
   Datos estructurados
   ------------------------------------------------------------------------- */

add_filter( 'woocommerce_structured_data_product', 'li_seo_datos_producto', 10, 2 );
/**
 * Datos de producto para Google: nombre SEO, descripción curada y marca.
 *
 * @param array      $datos Datos estructurados.
 * @param WC_Product $p     Producto.
 * @return array
 */
function li_seo_datos_producto( $datos, $p ) {
	$datos['name']        = li_nombre_web( $p );
	$datos['description'] = li_seo_desc_producto( $p );
	$marca                = function_exists( 'li_marca_producto' ) ? li_marca_producto( $p->get_id() ) : '';
	if ( $marca ) {
		$datos['brand'] = array(
			'@type' => 'Brand',
			'name'  => $marca,
		);
	}
	return $datos;
}

add_action( 'wp_footer', 'li_seo_jsonld', 20 );
/**
 * El local (en la portada) y las migas (en fichas y categorías).
 */
function li_seo_jsonld(): void {
	$grafo = array();

	if ( is_front_page() ) {
		$grafo[] = array(
			'@type'     => 'ElectronicsStore',
			'@id'       => home_url( '/#local' ),
			'name'      => 'Lucas Innovaciones',
			'url'       => home_url( '/' ),
			'logo'      => LI_URI . '/assets/img/logo-li-192.png',
			'image'     => LI_URI . '/assets/img/local-820.webp',
			'telephone' => '+' . LI_WHATSAPP,
			'address'   => array(
				'@type'           => 'PostalAddress',
				'streetAddress'   => LI_DIRECCION,
				'addressLocality' => 'Villa Santa Rosa',
				'addressRegion'   => 'Córdoba',
				'postalCode'      => '5133',
				'addressCountry'  => 'AR',
			),
			'sameAs'    => array( 'https://www.instagram.com/' . LI_INSTAGRAM . '/' ),
		);
	}

	$migas = array();
	if ( is_product() || is_product_taxonomy() ) {
		$migas[] = array( 'Inicio', home_url( '/' ) );
		$migas[] = array( 'Tienda', (string) wc_get_page_permalink( 'shop' ) );
		$term    = null;
		if ( is_product_taxonomy() ) {
			$term = get_queried_object();
		} else {
			$cats = wp_get_post_terms( get_queried_object_id(), 'product_cat' );
			foreach ( $cats as $c ) {
				if ( ! $term || $c->parent ) {
					$term = $c; // La subcategoría, si hay.
				}
			}
		}
		if ( $term instanceof WP_Term && 'product_cat' === $term->taxonomy ) {
			foreach ( array_reverse( get_ancestors( $term->term_id, 'product_cat' ) ) as $a ) {
				$at      = get_term( $a, 'product_cat' );
				$migas[] = array( $at->name, (string) get_term_link( $at ) );
			}
			$migas[] = array( $term->name, (string) get_term_link( $term ) );
		}
		if ( is_product() ) {
			$migas[] = array( li_nombre_web( get_queried_object_id() ), (string) get_permalink( get_queried_object_id() ) );
		}
	}
	if ( $migas ) {
		$grafo[] = array(
			'@type'           => 'BreadcrumbList',
			'itemListElement' => array_map(
				static fn( $m, $i ) => array(
					'@type'    => 'ListItem',
					'position' => $i + 1,
					'name'     => $m[0],
					'item'     => $m[1],
				),
				$migas,
				array_keys( $migas )
			),
		);
	}

	if ( $grafo ) {
		echo '<script type="application/ld+json">' . wp_json_encode( array( '@context' => 'https://schema.org', '@graph' => $grafo ), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) . "</script>\n";
	}
}

/* -------------------------------------------------------------------------
   Peso de la página
   ------------------------------------------------------------------------- */

add_action( 'wp_enqueue_scripts', 'li_seo_aligerar', 100 );
/**
 * Saca lo que la página no usa: la ficha no usa los estilos de marcas y los
 * listados no usan los estilos de bloques de WordPress.
 */
function li_seo_aligerar(): void {
	// El zoom, el visor y el slider ya no se cargan: el tema no declara su
	// soporte (inc/setup.php). Acá queda lo que WooCommerce suma igual.
	if ( is_product() ) {
		wp_dequeue_style( 'brands-styles' );
	}
	if ( is_product() || is_product_taxonomy() || ( function_exists( 'is_shop' ) && is_shop() ) ) {
		wp_dequeue_style( 'wp-block-library' );
		wp_dequeue_style( 'wp-block-library-theme' );
	}
}
