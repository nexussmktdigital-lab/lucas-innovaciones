<?php
/**
 * Reglas de catálogo: qué se muestra y qué se vende en la web.
 *
 * Un producto aparece y se puede comprar solo si:
 *  1. Tiene precio mayor a $1.
 *  2. Tiene imagen destacada.
 *  3. Tiene stock.
 *  4. Si está en dólares, hay cotización vigente (plugin li-dolar).
 * Además, nunca los de "Solo mostrador" ni los ocultos del catálogo.
 *
 * Todo se resuelve acá, en código: no se toca ningún dato del producto.
 * Cuando Lucas carga la foto o el precio, el producto aparece solo.
 *
 * Nada de esto corre en wp-admin ni en la REST /wc/v3 que usa el POS: la
 * condición es li_es_web(), la misma que usa el plugin del dólar.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/**
 * Categorías que nunca se muestran ni se venden en la web. "Vapers" se
 * sumó el 06/10 a pedido de Matias (venta restringida en Argentina).
 */
const LI_CATS_SOLO_MOSTRADOR = array( 'solo-mostrador', 'vapers' );

/* -------------------------------------------------------------------------
   Contexto
   ------------------------------------------------------------------------- */

/**
 * ¿La petición es la web pública (incluida la Store API del carrito)?
 */
function li_es_web(): bool {
	if ( function_exists( 'li_dolar_es_web' ) ) {
		return li_dolar_es_web();
	}
	if ( wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
		return false;
	}
	return ! is_admin();
}

/** Cotización vigente o null (sin el plugin no hay forma de convertir). */
function li_cotizacion(): ?float {
	return function_exists( 'li_dolar_vigente' ) ? li_dolar_vigente() : null;
}

/* -------------------------------------------------------------------------
   Productos publicables
   ------------------------------------------------------------------------- */

/**
 * IDs de los productos que cumplen las reglas. Una sola consulta, en caché:
 * todos los listados y conteos de la web se recortan contra esta lista, así
 * el menú, las facetas, la portada y la grilla dicen siempre lo mismo.
 *
 * @return int[]
 */
function li_ids_publicables(): array {
	static $memoria = null;
	if ( null !== $memoria ) {
		return $memoria;
	}

	$clave = 'li_publicables_' . ( li_cotizacion() ? 'usd' : 'sinusd' );
	$cache = get_transient( $clave );
	if ( is_array( $cache ) ) {
		$memoria = $cache;
		return $memoria;
	}

	global $wpdb;

	$solo = array( 0 );
	foreach ( LI_CATS_SOLO_MOSTRADOR as $slug ) {
		$t = get_term_by( 'slug', $slug, 'product_cat' );
		if ( $t ) {
			$solo[] = (int) $t->term_taxonomy_id;
		}
	}
	$solo = implode( ',', $solo );

	$sin_usd = li_cotizacion() ? '' : "AND NOT EXISTS ( SELECT 1 FROM {$wpdb->postmeta} mu WHERE mu.post_id = p.ID AND mu.meta_key = '_li_moneda' AND mu.meta_value = 'USD' )";

	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$ids = $wpdb->get_col(
		"SELECT p.ID
		 FROM {$wpdb->posts} p
		 JOIN {$wpdb->wc_product_meta_lookup} l ON l.product_id = p.ID
		 WHERE p.post_type = 'product' AND p.post_status = 'publish'
		   AND l.stock_status = 'instock'
		   AND l.min_price > 1
		   AND EXISTS ( SELECT 1 FROM {$wpdb->postmeta} th WHERE th.post_id = p.ID AND th.meta_key = '_thumbnail_id' AND CAST( th.meta_value AS UNSIGNED ) > 0 )
		   AND NOT EXISTS (
		     SELECT 1 FROM {$wpdb->term_relationships} trv
		     JOIN {$wpdb->term_taxonomy} ttv ON ttv.term_taxonomy_id = trv.term_taxonomy_id AND ttv.taxonomy = 'product_visibility'
		     JOIN {$wpdb->terms} tv ON tv.term_id = ttv.term_id AND tv.slug = 'exclude-from-catalog'
		     WHERE trv.object_id = p.ID
		   )
		   AND NOT EXISTS ( SELECT 1 FROM {$wpdb->term_relationships} trs WHERE trs.object_id = p.ID AND trs.term_taxonomy_id IN ({$solo}) )
		   {$sin_usd}"
	);
	// phpcs:enable

	$memoria = array_map( 'intval', $ids );
	set_transient( $clave, $memoria, 10 * MINUTE_IN_SECONDS );

	return $memoria;
}

/**
 * Huella corta de la lista: sirve de sufijo para las cachés que dependen de
 * ella (portada, menú, marcas), que así se renuevan solas cuando cambia.
 */
function li_huella_publicables(): string {
	return substr( md5( implode( ',', li_ids_publicables() ) ), 0, 10 );
}

/**
 * Fragmento SQL "AND {columna} IN (…)" con la lista de publicables.
 *
 * @param string $columna Columna con el ID del producto (p. ej. "p.ID").
 */
function li_sql_publicables( string $columna ): string {
	$ids = li_ids_publicables();
	return $ids ? " AND {$columna} IN (" . implode( ',', $ids ) . ') ' : ' AND 1 = 0 ';
}

/**
 * ¿Este producto se puede mostrar y vender? Mira el objeto, no la caché:
 * se usa en la ficha y el carrito, donde importa el dato al instante.
 *
 * @param WC_Product|int $producto Producto o variación.
 */
function li_producto_publicable( $producto ): bool {
	$p = $producto instanceof WC_Product ? $producto : wc_get_product( (int) $producto );
	if ( ! $p ) {
		return false;
	}

	$padre = $p->is_type( 'variation' ) ? wc_get_product( $p->get_parent_id() ) : $p;
	if ( ! $padre || 'publish' !== $padre->get_status() || 'hidden' === $padre->get_catalog_visibility() ) {
		return false;
	}

	if ( (float) $p->get_price( 'edit' ) <= 1 && ! $p->is_type( 'variable' ) ) {
		return false;
	}
	if ( ! $p->get_image_id() && ! $padre->get_image_id() ) {
		return false;
	}
	if ( ! $p->is_in_stock() ) {
		return false;
	}
	if ( has_term( LI_CATS_SOLO_MOSTRADOR, 'product_cat', $padre->get_id() ) ) {
		return false;
	}
	if ( 'USD' === $padre->get_meta( '_li_moneda' ) && ! li_cotizacion() ) {
		return false;
	}

	return true;
}

add_action( 'woocommerce_update_product', 'li_limpiar_publicables' );
add_action( 'woocommerce_product_set_stock_status', 'li_limpiar_publicables' );
add_action( 'woocommerce_variation_set_stock_status', 'li_limpiar_publicables' );
add_action( 'set_object_terms', 'li_limpiar_publicables' );
add_action( 'trashed_post', 'li_limpiar_publicables' );
add_action( 'added_post_meta', 'li_limpiar_publicables_meta', 10, 3 );
add_action( 'updated_post_meta', 'li_limpiar_publicables_meta', 10, 3 );
add_action( 'deleted_post_meta', 'li_limpiar_publicables_meta', 10, 3 );
/**
 * Tira la caché de publicables. Es un borrado de dos transients: barato,
 * así que se permite en cualquier contexto (también cuando vende el POS).
 */
function li_limpiar_publicables(): void {
	delete_transient( 'li_publicables_usd' );
	delete_transient( 'li_publicables_sinusd' );
}

/**
 * @param mixed  $meta_id ID del meta.
 * @param int    $post_id Post.
 * @param string $clave   Clave del meta.
 */
function li_limpiar_publicables_meta( $meta_id, $post_id, $clave ): void {
	if ( in_array( $clave, array( '_thumbnail_id', '_li_moneda', '_price' ), true ) ) {
		li_limpiar_publicables();
	}
}

/* -------------------------------------------------------------------------
   Listados, búsquedas y sitemap
   ------------------------------------------------------------------------- */

/**
 * ¿Es una consulta de listado de productos?
 *
 * @param WP_Query $q Consulta.
 */
function li_es_listado_productos( WP_Query $q ): bool {
	if ( $q->get( 'li_sin_reglas' ) || $q->is_singular() || $q->get( 'p' ) || $q->get( 'name' ) ) {
		return false;
	}

	// array_filter: en una categoría post_type llega como '' y (array) '' es
	// array( '' ), que no es vacío; sin filtrar, las categorías no se recortaban.
	$tipos = array_values( array_filter( (array) $q->get( 'post_type' ) ) );
	if ( $tipos && array( 'product' ) === $tipos ) {
		return true;
	}

	return $q->is_post_type_archive( 'product' ) || ( ! $tipos && $q->is_tax( get_object_taxonomies( 'product' ) ) );
}

add_filter( 'posts_clauses', 'li_reglas_clausulas', 20, 2 );
/**
 * Recorta todo listado de productos de la web a los publicables. Incluye la
 * consulta principal, búsquedas, facetas, la Store API y el sitemap.
 *
 * @param string[] $c Cláusulas.
 * @param WP_Query $q Consulta.
 * @return string[]
 */
function li_reglas_clausulas( array $c, WP_Query $q ): array {
	if ( ! li_es_web() || ! li_es_listado_productos( $q ) ) {
		return $c;
	}

	global $wpdb;
	$c['where'] .= li_sql_publicables( "{$wpdb->posts}.ID" );

	// El orden por precio de WooCommerce usa la tabla de consulta, que para
	// los productos en dólares tiene dólares: se ordena por el precio en pesos.
	if ( $c['orderby'] && str_contains( $c['orderby'], 'wc_product_meta_lookup.' ) ) {
		$c['orderby'] = str_replace(
			array( 'wc_product_meta_lookup.min_price', 'wc_product_meta_lookup.max_price' ),
			array( li_sql_precio_ars( 'wc_product_meta_lookup', 'min_price' ), li_sql_precio_ars( 'wc_product_meta_lookup', 'max_price' ) ),
			$c['orderby']
		);
	}

	return $c;
}

/**
 * Expresión SQL con el precio web de una fila de la tabla de consulta: la
 * misma cuenta que Li_Dolar::precio_web() (recargo de la web + redondeo
 * hacia arriba) y, en los productos USD, la cotización antes. Así el filtro
 * y el orden por precio coinciden con lo que muestra la tarjeta.
 *
 * @param string $alias   Alias de wc_product_meta_lookup en la consulta.
 * @param string $columna min_price o max_price.
 */
function li_sql_precio_ars( string $alias, string $columna ): string {
	global $wpdb;
	$col  = "{$alias}.{$columna}";
	$f    = class_exists( 'Li_Dolar' ) ? ( 10000 + Li_Dolar::recargo_bp() ) / 10000 : 1;
	$m    = class_exists( 'Li_Dolar' ) ? Li_Dolar::multiplo() : 1000;
	$tope = class_exists( 'Li_Dolar' ) ? Li_Dolar::TOPE_USD : 10000;

	$ars   = "ROUND( {$col} * {$f}, 2 )";
	$paso  = "( CASE WHEN {$ars} >= 100000 THEN 1000 ELSE 100 END )";
	$pesos = "( CEIL( {$ars} / {$paso} - 0.000000001 ) * {$paso} )";

	$c = (float) li_cotizacion();
	if ( ! $c ) {
		return $pesos; // Sin cotización, los productos USD no se publican.
	}
	$usd = "ROUND( {$col} * {$c} * {$f}, 2 )";

	return "( CASE WHEN {$col} <= {$tope} AND EXISTS ( SELECT 1 FROM {$wpdb->postmeta} lim WHERE lim.post_id = {$alias}.product_id AND lim.meta_key = '_li_moneda' AND lim.meta_value = 'USD' )"
		. " THEN CEIL( {$usd} / {$m} - 0.000000001 ) * {$m} ELSE {$pesos} END )";
}

add_filter( 'woocommerce_related_products', 'li_reglas_ids', 20 );
add_filter( 'woocommerce_product_get_upsell_ids', 'li_reglas_ids_web', 20 );
add_filter( 'woocommerce_product_get_cross_sell_ids', 'li_reglas_ids_web', 20 );
/**
 * Deja solo los publicables de una lista de IDs.
 *
 * @param int[] $ids IDs.
 * @return int[]
 */
function li_reglas_ids( $ids ): array {
	$ok = array_flip( li_ids_publicables() );
	return array_values( array_filter( array_map( 'intval', (array) $ids ), static fn( $id ) => isset( $ok[ $id ] ) ) );
}

/**
 * Igual, pero solo en la web (los getters también los lee el admin).
 *
 * @param int[] $ids IDs.
 * @return int[]
 */
function li_reglas_ids_web( $ids ) {
	return li_es_web() ? li_reglas_ids( $ids ) : $ids;
}

/* -------------------------------------------------------------------------
   Ficha y carrito
   ------------------------------------------------------------------------- */

add_filter( 'woocommerce_is_purchasable', 'li_reglas_comprable', 20, 2 );
add_filter( 'woocommerce_variation_is_purchasable', 'li_reglas_comprable', 20, 2 );
/**
 * @param bool       $ok       Comprable según Woo.
 * @param WC_Product $producto Producto.
 */
function li_reglas_comprable( bool $ok, $producto ): bool {
	if ( ! $ok || ! li_es_web() ) {
		return $ok;
	}
	return li_producto_publicable( $producto );
}

add_action( 'template_redirect', 'li_reglas_ficha', 4 );
/**
 * La ficha de un producto que no se publica manda a su categoría (302: en
 * cuanto tenga foto, precio o stock, vuelve a abrir sola). Los admins la
 * siguen viendo, para poder revisarla.
 */
function li_reglas_ficha(): void {
	if ( ! is_singular( 'product' ) || current_user_can( 'edit_products' ) ) {
		return;
	}
	$id = get_queried_object_id();
	if ( li_producto_publicable( $id ) ) {
		return;
	}

	$destino = wc_get_page_permalink( 'shop' );
	$cats    = get_the_terms( $id, 'product_cat' );
	if ( $cats && ! is_wp_error( $cats ) ) {
		foreach ( $cats as $c ) {
			if ( ! in_array( $c->slug, LI_CATS_SOLO_MOSTRADOR, true ) ) {
				$destino = (string) get_term_link( $c );
				break;
			}
		}
	}

	wp_safe_redirect( $destino, 302 );
	exit;
}

add_filter( 'wp_sitemaps_posts_query_args', 'li_reglas_sitemap', 10, 2 );
/**
 * El sitemap de productos lista solo los publicables.
 *
 * @param array  $args Argumentos.
 * @param string $tipo Tipo de contenido.
 */
function li_reglas_sitemap( array $args, string $tipo ): array {
	if ( 'product' === $tipo ) {
		$ids              = li_ids_publicables();
		$args['post__in'] = $ids ? $ids : array( 0 );
	}
	return $args;
}

/* -------------------------------------------------------------------------
   Nombre público: sin el código interno del final
   ------------------------------------------------------------------------- */

/**
 * Los iPhones llevan al final, entre paréntesis, los últimos dígitos del
 * IMEI ("iPhone 16 Pro 256gb 89% (76149)"). Es para uso interno: en la web
 * se saca. El pedido guarda el nombre completo, así el local sabe qué
 * equipo se vendió. Solo se sacan paréntesis de puros dígitos (4 a 6):
 * "(653 Ciclos)" o "(Pant Original)" quedan.
 *
 * @param string $nombre Nombre del producto.
 */
function li_nombre_publico( string $nombre ): string {
	$nombre = (string) preg_replace( '/\s*\(\d{4,6}\)(?=\s*(?:<|$))/u', '', $nombre );
	// En los iPhone "SELLADO" y "nuevo" son lo mismo: en la web se dice Nuevo.
	return trim( (string) preg_replace( '/\bsellad[oa]\b/iu', 'Nuevo', $nombre ) );
}

/** Marca que se está armando un mail para el local: ahí va el nombre completo. */
function li_mail_al_local( ?bool $valor = null ): bool {
	static $al_local = false;
	if ( null !== $valor ) {
		$al_local = $valor;
	}
	return $al_local;
}

add_action( 'woocommerce_email_before_order_table', static fn( $o, $admin ) => li_mail_al_local( (bool) $admin ), 1, 2 );
add_action( 'woocommerce_email_after_order_table', static fn() => li_mail_al_local( false ), 99 );

/**
 * Filtro común: nombre público solo en la web y fuera de los mails al local.
 *
 * @param mixed $nombre Nombre.
 * @return mixed
 */
function li_filtrar_nombre( $nombre ) {
	if ( ! is_string( $nombre ) || ! li_es_web() || li_mail_al_local() ) {
		return $nombre;
	}
	return li_nombre_publico( $nombre );
}

add_filter( 'woocommerce_product_title', 'li_filtrar_nombre', 20 );   // Store API: carrito y checkout.
add_filter( 'woocommerce_cart_item_name', 'li_filtrar_nombre', 20 );  // Carrito clásico y mini carrito.
add_filter( 'woocommerce_order_item_get_name', 'li_filtrar_nombre', 20 ); // Gracias, Mi cuenta, mails al cliente.
add_filter( 'single_post_title', 'li_filtrar_nombre', 20 );           // <title> de la ficha.

add_filter( 'the_title', 'li_titulo_producto', 20, 2 );
/**
 * @param string $titulo Título.
 * @param int    $id     Post.
 */
function li_titulo_producto( $titulo, $id = 0 ) {
	if ( ! $id || 'product' !== get_post_type( $id ) ) {
		return $titulo;
	}
	// En la web, el nombre SEO (migas, búsquedas, cualquier the_title).
	if ( li_es_web() && ! li_mail_al_local() && function_exists( 'li_nombre_web' ) ) {
		return li_nombre_web( (int) $id );
	}
	return li_filtrar_nombre( $titulo );
}
