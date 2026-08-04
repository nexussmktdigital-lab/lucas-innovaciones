<?php
/**
 * Datos de la portada.
 *
 * Todo sale del catálogo real. Nada hardcodeado: si mañana cambian las
 * categorías o entran marcas nuevas, la portada se acomoda sola.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/**
 * Reúne lo que necesita la portada, cacheado 6 horas.
 *
 * @return array<string,mixed>
 */
function li_datos_portada(): array {
	$cache = get_transient( 'li_portada' );
	if ( is_array( $cache ) ) {
		return $cache;
	}

	global $wpdb;

	$excluir = array( 'solo-mostrador', 'sin-categorizar' );

	// --- Cifras -------------------------------------------------------
	$productos = (int) $wpdb->get_var(
		"SELECT COUNT(*) FROM {$wpdb->posts} p
		 WHERE p.post_type = 'product' AND p.post_status = 'publish'
		 AND NOT EXISTS (
			SELECT 1 FROM {$wpdb->term_relationships} tr
			JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
			JOIN {$wpdb->terms} t ON t.term_id = tt.term_id
			WHERE tr.object_id = p.ID AND tt.taxonomy = 'product_visibility' AND t.slug = 'exclude-from-catalog'
		 )"
	);

	$categorias = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->term_taxonomy} WHERE taxonomy = 'product_cat' AND count > 0" );
	$marcas     = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->term_taxonomy} WHERE taxonomy = 'product_brand' AND count > 0" );

	// --- Categorías ---------------------------------------------------
	$cats = get_terms(
		array(
			'taxonomy'   => 'product_cat',
			'hide_empty' => true,
			'orderby'    => 'count',
			'order'      => 'DESC',
			'number'     => 14,
		)
	);

	$categorias_top = array();
	if ( $cats && ! is_wp_error( $cats ) ) {
		foreach ( $cats as $c ) {
			if ( in_array( $c->slug, $excluir, true ) || count( $categorias_top ) >= 10 ) {
				continue;
			}
			$categorias_top[] = array(
				'nombre' => $c->name,
				'cuenta' => (int) $c->count,
				'url'    => (string) get_term_link( $c ),
			);
		}
	}

	// --- Marcas -------------------------------------------------------
	$brands = get_terms(
		array(
			'taxonomy'   => 'product_brand',
			'hide_empty' => true,
			'orderby'    => 'count',
			'order'      => 'DESC',
			'number'     => 16,
		)
	);

	$marcas_top = array();
	if ( $brands && ! is_wp_error( $brands ) ) {
		foreach ( $brands as $b ) {
			$marcas_top[] = array(
				'nombre' => $b->name,
				'cuenta' => (int) $b->count,
				'url'    => (string) get_term_link( $b ),
			);
		}
	}

	// --- Más vendidos, con venta real de los últimos 12 meses ---------
	$tabla = $wpdb->prefix . 'wc_order_product_lookup';
	$ids   = $wpdb->get_col(
		"SELECT l.product_id FROM {$tabla} l
		 JOIN {$wpdb->posts} p ON p.ID = l.product_id AND p.post_status = 'publish'
		 WHERE l.date_created >= DATE_SUB(NOW(), INTERVAL 12 MONTH) AND l.product_id > 0
		 GROUP BY l.product_id
		 ORDER BY SUM(l.product_qty) DESC
		 LIMIT 10"
	);

	$mas_vendidos = li_filtrar_visibles( $ids, 5 );

	// --- Últimos ingresos ---------------------------------------------
	$nuevos  = get_posts(
		array(
			'post_type'      => 'product',
			'post_status'    => 'publish',
			'posts_per_page' => 12,
			'orderby'        => 'date',
			'order'          => 'DESC',
			'fields'         => 'ids',
		)
	);
	$ultimos = li_filtrar_visibles( $nuevos, 5 );

	// --- Atajos de búsqueda: las categorías con más rotación ----------
	$atajos = array();
	foreach ( array_slice( $categorias_top, 0, 4 ) as $c ) {
		$atajos[] = array(
			'nombre' => $c['nombre'],
			'url'    => $c['url'],
		);
	}

	$datos = compact( 'productos', 'categorias', 'marcas', 'categorias_top', 'marcas_top', 'mas_vendidos', 'ultimos', 'atajos' );

	set_transient( 'li_portada', $datos, 6 * HOUR_IN_SECONDS );

	return $datos;
}

/**
 * Deja solo productos visibles y comprables, hasta un máximo.
 *
 * @param array<int,int|string> $ids   Identificadores.
 * @param int                   $tope  Cantidad máxima.
 * @return int[]
 */
function li_filtrar_visibles( array $ids, int $tope ): array {
	$out = array();

	foreach ( $ids as $id ) {
		if ( count( $out ) >= $tope ) {
			break;
		}
		$p = wc_get_product( (int) $id );
		if ( $p && $p->is_visible() ) {
			$out[] = (int) $id;
		}
	}

	return $out;
}

/**
 * Datos del local: dirección, ciudad y horario de atención.
 *
 * El horario sale de la ubicación de retiro de WooCommerce, que ya está
 * cargada con los datos reales del negocio.
 *
 * @return array<string,string>
 */
function li_local(): array {
	$direccion = (string) get_option( 'woocommerce_store_address', '' );
	$ciudad    = '';
	$cp        = '';
	$horario   = '';

	$ubicaciones = get_option( 'pickup_location_pickup_locations', array() );
	if ( is_array( $ubicaciones ) && $ubicaciones ) {
		$u = reset( $ubicaciones );

		if ( ! empty( $u['address']['address_1'] ) ) {
			$direccion = (string) $u['address']['address_1'];
		}
		$ciudad  = (string) ( $u['address']['city'] ?? '' );
		$cp      = (string) ( $u['address']['postcode'] ?? '' );
		$horario = (string) ( $u['details'] ?? '' );
	}

	// La dirección guardada en WooCommerce viene con la ciudad adentro.
	if ( ! $ciudad && $direccion && str_contains( $direccion, ',' ) ) {
		$partes    = array_map( 'trim', explode( ',', $direccion ) );
		$direccion = array_shift( $partes );
		$ciudad    = implode( ', ', $partes );
	}

	return compact( 'direccion', 'ciudad', 'cp', 'horario' );
}

/**
 * Dibuja una grilla de productos reutilizando la tarjeta del catálogo.
 *
 * @param int[] $ids Identificadores de producto.
 */
function li_grilla_productos( array $ids ): void {
	if ( ! $ids ) {
		return;
	}

	$original = $GLOBALS['post'] ?? null;

	echo '<ul class="grilla productos">';

	foreach ( $ids as $id ) {
		$GLOBALS['post'] = get_post( $id ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride
		setup_postdata( $GLOBALS['post'] );
		$GLOBALS['product'] = wc_get_product( $id ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride
		wc_get_template_part( 'content', 'product' );
	}

	echo '</ul>';

	$GLOBALS['post'] = $original; // phpcs:ignore WordPress.WP.GlobalVariablesOverride
	wp_reset_postdata();
}

add_action( 'save_post_product', 'li_limpiar_cache_portada' );
add_action( 'woocommerce_update_product', 'li_limpiar_cache_portada' );
/**
 * Invalida la caché de la portada cuando cambia el catálogo.
 */
function li_limpiar_cache_portada(): void {
	delete_transient( 'li_portada' );
}
