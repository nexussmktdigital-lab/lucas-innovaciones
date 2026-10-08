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
 * Reúne lo que necesita la portada. Todo sale de los productos que cumplen
 * las reglas de catálogo (inc/catalogo.php): la caché lleva la huella de esa
 * lista y se rehace sola cuando un producto gana o pierde foto, precio o stock.
 *
 * @return array<string,mixed>
 */
function li_datos_portada(): array {
	$huella = li_huella_publicables();
	$cache  = get_transient( 'li_portada' );
	if ( is_array( $cache ) && ( $cache['huella'] ?? '' ) === $huella ) {
		return $cache;
	}

	global $wpdb;

	$ids      = li_ids_publicables();
	$en_lista = li_sql_publicables( 'p.ID' );

	// --- Categorías de primer nivel con productos a la venta -----------
	$categorias_top = array();
	foreach ( li_categorias_principales( 6 ) as $c ) {
		$t = get_term_by( 'slug', $c['slug'], 'product_cat' );
		$categorias_top[] = array(
			'nombre' => $c['nombre'],
			'slug'   => $c['slug'],
			'cuenta' => $c['cuenta'],
			'url'    => $c['url'],
			'img'    => $t ? ( li_termino_imagen( $t->term_id ) ?: li_categoria_imagen( $c['slug'] ) ) : '',
		);
	}

	// --- Marcas con productos a la venta -------------------------------
	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$filas = $wpdb->get_results(
		"SELECT t.term_id, t.name, t.slug, COUNT(DISTINCT p.ID) n
		 FROM {$wpdb->posts} p
		 JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
		 JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_brand'
		 JOIN {$wpdb->terms} t ON t.term_id = tt.term_id
		 WHERE 1 = 1 {$en_lista}
		 GROUP BY t.term_id, t.name, t.slug
		 ORDER BY n DESC, t.name ASC
		 LIMIT 60",
		ARRAY_A
	);
	// phpcs:enable

	$marcas_top = array();
	// La tira de la portada muestra logos: entran solo las marcas que tienen
	// logo (propio del término o el que trae el tema), las 10 con más productos.
	foreach ( $filas as $b ) {
		if ( count( $marcas_top ) >= 10 ) {
			break;
		}
		$propia = li_termino_imagen( (int) $b['term_id'] );
		$logo   = li_marca_logo( $b['slug'] );
		if ( ! $propia && ! $logo['url'] ) {
			continue;
		}

		$marcas_top[] = array(
			'nombre' => $b['name'],
			'slug'   => $b['slug'],
			'cuenta' => (int) $b['n'],
			'url'    => (string) get_term_link( $b['slug'], 'product_brand' ),
			'img'    => $propia ?: $logo['url'],
			'fondo'  => $propia ? '' : $logo['fondo'],
		);
	}

	// --- Más vendidos: venta real de los últimos 12 meses --------------
	$tabla        = $wpdb->prefix . 'wc_order_product_lookup';
	$mas_vendidos = $ids ? array_map(
		'intval',
		$wpdb->get_col(
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			"SELECT l.product_id AS ID FROM {$tabla} l
			 JOIN {$wpdb->posts} p ON p.ID = l.product_id
			 WHERE l.date_created >= DATE_SUB(NOW(), INTERVAL 12 MONTH) {$en_lista}
			 GROUP BY l.product_id
			 ORDER BY SUM(l.product_qty) DESC
			 LIMIT 4"
		)
	) : array();

	// --- Últimos ingresos ----------------------------------------------
	$ultimos = $ids ? array_map(
		'intval',
		$wpdb->get_col(
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			"SELECT p.ID FROM {$wpdb->posts} p WHERE 1 = 1 {$en_lista} ORDER BY p.post_date DESC LIMIT 8"
		)
	) : array();

	// Si todavía hay pocas ventas con foto, se completa con lo último que entró.
	foreach ( $ultimos as $id ) {
		if ( count( $mas_vendidos ) >= 4 ) {
			break;
		}
		if ( ! in_array( $id, $mas_vendidos, true ) ) {
			$mas_vendidos[] = $id;
		}
	}

	// --- Destacado del hero: el producto más caro a la venta ------------
	$destacado = $ids ? (int) $wpdb->get_var(
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		"SELECT p.ID FROM {$wpdb->posts} p
		 JOIN {$wpdb->wc_product_meta_lookup} l ON l.product_id = p.ID
		 WHERE 1 = 1 {$en_lista}
		 ORDER BY " . li_sql_precio_ars( 'l', 'max_price' ) . " DESC LIMIT 1"
	) : 0;

	// --- Banner de promoción: un producto por rubro, de los más caros ----
	// Variedad antes que precio: el más caro de cada categoría principal, sin
	// repetir rubro ni el destacado del hero. Seis entran en una fila.
	$promo = array();
	if ( $ids ) {
		$caros = array_map(
			'intval',
			$wpdb->get_col(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				"SELECT p.ID FROM {$wpdb->posts} p
				 JOIN {$wpdb->wc_product_meta_lookup} l ON l.product_id = p.ID
				 WHERE p.ID <> " . (int) $destacado . " {$en_lista}
				 ORDER BY " . li_sql_precio_ars( 'l', 'max_price' ) . ' DESC LIMIT 120'
			)
		);
		$rubros = array();
		foreach ( $caros as $id ) {
			$cats = wp_get_post_terms( $id, 'product_cat', array( 'fields' => 'ids' ) );
			$cat  = $cats ? (int) $cats[0] : 0;
			$anc  = $cat ? get_ancestors( $cat, 'product_cat' ) : array();
			$raiz = $anc ? (int) end( $anc ) : $cat;
			if ( isset( $rubros[ $raiz ] ) ) {
				continue;
			}
			$rubros[ $raiz ] = true;
			$promo[]         = $id;
			if ( count( $promo ) >= 6 ) {
				break;
			}
		}
	}

	$productos = count( $ids );

	$datos = compact( 'huella', 'productos', 'categorias_top', 'marcas_top', 'mas_vendidos', 'ultimos', 'destacado', 'promo' );

	set_transient( 'li_portada', $datos, 6 * HOUR_IN_SECONDS );

	return $datos;
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

	echo '<ul class="li-grid grilla productos">';

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
