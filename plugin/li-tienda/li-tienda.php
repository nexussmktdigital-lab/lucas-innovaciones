<?php
/**
 * Plugin Name: Lucas Innovaciones — Tienda
 * Description: Reglas chicas de la tienda que no dependen del tema: el slug de un producto nuevo se arma sin el IMEI del final del nombre, y peso y medidas por defecto por categoría para cotizar envíos; y un ajuste de stock por diferencia para el POS (atómico y sin duplicar en los reintentos).
 * Version: 1.4.0
 * Requires PHP: 8.1
 * Author: Lucas Innovaciones
 *
 * @package LiTienda
 */

defined( 'ABSPATH' ) || exit;

/*
 * Los iPhones se cargan con los últimos dígitos del IMEI al final del nombre,
 * entre paréntesis: "iPhone 16 Pro 256gb 89% (76149)". Es para uso interno.
 * El tema ya lo saca de la vista; esto evita que quede en la URL.
 *
 * Solo actúa cuando WordPress genera el slug solo (producto nuevo, o primera
 * publicación de un borrador sin slug). Un slug escrito a mano no se toca, ni
 * se cambian los de productos existentes. Corre en cualquier contexto —admin,
 * POS por /wc/v3— porque es ahí donde se crean los productos; no toca precio,
 * stock, SKU ni visibilidad.
 */

add_filter( 'wp_insert_post_data', 'li_tienda_slug_sin_imei', 20, 4 );

/**
 * @param array $data        Datos a guardar (ya saneados).
 * @param array $postarr     Datos recibidos.
 * @param array $sin_sanear  Datos sin sanear.
 * @param bool  $es_update   Si es una actualización.
 * @return array
 */
function li_tienda_slug_sin_imei( $data, $postarr, $sin_sanear = array(), $es_update = false ) {
	if ( 'product' !== ( $data['post_type'] ?? '' ) || '' === ( $data['post_name'] ?? '' ) ) {
		return $data;
	}

	// ¿El slug lo eligió alguien? Entonces se respeta.
	if ( ! empty( $postarr['post_name'] ) ) {
		return $data;
	}
	// En una actualización, solo si el producto todavía no tenía slug.
	if ( $es_update && ! empty( $postarr['ID'] ) && '' !== (string) get_post_field( 'post_name', (int) $postarr['ID'], 'raw' ) ) {
		return $data;
	}

	$titulo = (string) ( $data['post_title'] ?? '' );
	if ( ! preg_match( '/\(\d{4,6}\)\s*$/u', $titulo ) ) {
		return $data;
	}

	$limpio = sanitize_title( trim( (string) preg_replace( '/\s*\(\d{4,6}\)\s*$/u', '', $titulo ) ) );
	if ( '' === $limpio ) {
		return $data;
	}

	$data['post_name'] = wp_unique_post_slug(
		$limpio,
		(int) ( $postarr['ID'] ?? 0 ),
		$data['post_status'],
		$data['post_type'],
		(int) ( $data['post_parent'] ?? 0 )
	);

	return $data;
}

/*
 * Peso y medidas por defecto, por categoría (tabla aprobada por Matias el
 * 06/10/2026). Ningún producto tiene peso cargado y Correo Argentino lo
 * necesita para cotizar. No se escribe nada en los productos: se completa al
 * leer, solo si el producto no tiene el dato, y solo en la web (carrito,
 * checkout, Store API). En wp-admin y en la REST /wc/v3 del POS se ve lo
 * cargado, es decir, vacío.
 *
 * Formato: peso en kg, largo × ancho × alto en cm.
 */

/** Subcategorías que pesan distinto que su categoría madre. */
const LI_TIENDA_PESOS_SUB = array(
	'notebooks'    => array( 4, 50, 40, 15 ),
	'impresoras'   => array( 4, 50, 40, 15 ),
	'monitores'    => array( 4, 50, 40, 15 ),
	'climatizacion' => array( 10, 90, 60, 20 ),
	'smart-tv'     => array( 10, 90, 60, 20 ),
	'proyectores'  => array( 10, 90, 60, 20 ),
);

/** Categorías de primer nivel. */
const LI_TIENDA_PESOS = array(
	'cables-y-adaptadores'    => array( 0.3, 20, 15, 5 ),
	'accesorios-para-celular' => array( 0.3, 20, 15, 5 ),
	'smartwatch-y-wearables'  => array( 0.3, 20, 15, 5 ),
	'perfumes'                => array( 0.3, 20, 15, 5 ),
	'vapers'                  => array( 0.3, 20, 15, 5 ),
	'cargadores-y-baterias'   => array( 0.5, 20, 15, 10 ),
	'conectividad-y-redes'    => array( 0.5, 20, 15, 10 ),
	'seguridad-y-camaras'     => array( 0.5, 20, 15, 10 ),
	'audio'                   => array( 1, 30, 20, 15 ),
	'iluminacion'             => array( 1, 30, 20, 15 ),
	'gaming'                  => array( 1, 30, 20, 15 ),
	'radios-y-sintonizadores' => array( 1, 30, 20, 15 ),
	'accesorios-vehiculo'     => array( 1, 30, 20, 15 ),
	'telefonos-y-tablets'     => array( 0.8, 25, 15, 10 ),
	'computacion'             => array( 1, 30, 25, 10 ),
	'mate-y-termos'           => array( 1.2, 35, 15, 15 ),
	'electrodomesticos'       => array( 3, 40, 30, 30 ),
	'tv-y-video'              => array( 1, 30, 20, 15 ),
);

const LI_TIENDA_PESO_DEFECTO = array( 1, 30, 20, 15 );

/** ¿La petición es la web pública? Misma regla que li-dolar. */
function li_tienda_es_web(): bool {
	if ( function_exists( 'li_dolar_es_web' ) ) {
		return li_dolar_es_web();
	}
	if ( wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
		return false;
	}
	return ! is_admin();
}

/**
 * Peso y medidas por defecto de un producto según su categoría.
 *
 * @param WC_Product $p Producto o variación.
 * @return array{0:float,1:float,2:float,3:float}
 */
function li_tienda_medidas( $p ): array {
	static $memoria = array();

	$id = $p->is_type( 'variation' ) ? $p->get_parent_id() : $p->get_id();
	if ( isset( $memoria[ $id ] ) ) {
		return $memoria[ $id ];
	}

	$terms = get_the_terms( $id, 'product_cat' );
	$res   = LI_TIENDA_PESO_DEFECTO;

	if ( $terms && ! is_wp_error( $terms ) ) {
		$sub = null;
		$top = null;
		foreach ( $terms as $t ) {
			if ( isset( LI_TIENDA_PESOS_SUB[ $t->slug ] ) ) {
				$sub = LI_TIENDA_PESOS_SUB[ $t->slug ];
			}
			// La categoría madre de primer nivel.
			$raiz = $t;
			while ( $raiz->parent ) {
				$raiz = get_term( $raiz->parent, 'product_cat' );
			}
			if ( ! $top && isset( LI_TIENDA_PESOS[ $raiz->slug ] ) ) {
				$top = LI_TIENDA_PESOS[ $raiz->slug ];
			}
		}
		$res = $sub ?? $top ?? LI_TIENDA_PESO_DEFECTO;
	}

	$memoria[ $id ] = $res;
	return $res;
}

foreach ( array( 'product', 'product_variation' ) as $li_tipo ) {
	foreach ( array( 'weight' => 0, 'length' => 1, 'width' => 2, 'height' => 3 ) as $li_prop => $li_i ) {
		add_filter(
			"woocommerce_{$li_tipo}_get_{$li_prop}",
			static function ( $valor, $producto ) use ( $li_i ) {
				if ( '' !== (string) $valor && (float) $valor > 0 ) {
					return $valor;
				}
				if ( ! $producto instanceof WC_Product || ! li_tienda_es_web() ) {
					return $valor;
				}
				return (string) li_tienda_medidas( $producto )[ $li_i ];
			},
			20,
			2
		);
	}
}

/*
 * Cuando un producto recibe imagen destacada, se borran las marcas viejas del
 * buscador de imágenes anterior (_lci_no_image_found, _lci_api_error). Es lo
 * único que se toca, y solo de ese producto.
 */
add_action( 'added_post_meta', 'li_tienda_limpiar_lci', 10, 4 );
add_action( 'updated_post_meta', 'li_tienda_limpiar_lci', 10, 4 );

/**
 * @param int    $meta_id ID del meta.
 * @param int    $post_id Post.
 * @param string $clave   Clave.
 * @param mixed  $valor   Valor.
 */
function li_tienda_limpiar_lci( $meta_id, $post_id, $clave, $valor ): void {
	if ( '_thumbnail_id' !== $clave || (int) $valor <= 0 || 'product' !== get_post_type( $post_id ) ) {
		return;
	}
	delete_post_meta( $post_id, '_lci_no_image_found' );
	delete_post_meta( $post_id, '_lci_api_error' );
}

/*
 * Ajuste de stock por diferencia, para el POS.
 *
 * El POS le escribía a Woo el stock ABSOLUTO que tenía él. Si entre medio
 * entraba un pedido web, esa escritura lo pisaba y el equipo vendido online
 * volvía a figurar disponible: con usados, que son unidades únicas, es vender
 * dos veces el mismo. Este endpoint resta o suma en lugar de escribir encima:
 *
 *  - Atómico: usa wc_update_product_stock(), que hace `stock = stock - n` en
 *    una sola consulta, igual que los pedidos web. No hay lectura y escritura
 *    separadas que se puedan cruzar con un pedido.
 *  - Sin duplicar: cada ajuste trae una referencia. La primera vez se guarda
 *    una option con add_option(), que falla si ya existe (option_name es
 *    único en la base); un reintento con la misma referencia no vuelve a restar.
 *
 * Va bajo el espacio `wc-li/v1` para que lo autentique la misma clave de la
 * REST de WooCommerce que ya usa el POS (Woo autentica todo lo que empieza con
 * `wc-`), y pide permiso de edición de productos.
 */

add_action( 'rest_api_init', 'li_tienda_rutas_stock' );

function li_tienda_rutas_stock(): void {
	register_rest_route(
		'wc-li/v1',
		'/stock/ajustar',
		array(
			'methods'             => 'POST',
			'callback'            => 'li_tienda_ajustar_stock',
			'permission_callback' => static fn() => current_user_can( 'edit_products' ),
			'args'                => array(
				'ref'   => array(
					'type'     => 'string',
					'required' => true,
				),
				'items' => array(
					'type'     => 'array',
					'required' => true,
				),
			),
		)
	);
}

/**
 * @param WP_REST_Request $req Petición: { ref, items: [{ product_id, variation_id?, delta }] }.
 * @return WP_REST_Response|WP_Error
 */
function li_tienda_ajustar_stock( WP_REST_Request $req ) {
	$ref   = substr( sanitize_text_field( (string) $req['ref'] ), 0, 120 );
	$items = (array) $req['items'];
	if ( '' === $ref || ! $items || count( $items ) > 100 ) {
		return new WP_Error( 'li_stock_pedido', 'Falta la referencia o los items (máximo 100).', array( 'status' => 400 ) );
	}

	$out = array();
	foreach ( array_values( $items ) as $i => $item ) {
		$id    = absint( $item['variation_id'] ?? 0 ) ?: absint( $item['product_id'] ?? 0 );
		$delta = (int) ( $item['delta'] ?? 0 );
		$p     = $id ? wc_get_product( $id ) : null;

		if ( ! $p ) {
			$out[] = array( 'i' => $i, 'estado' => 'no_existe', 'stock' => null );
			continue;
		}
		if ( ! $p->managing_stock() ) {
			$out[] = array( 'i' => $i, 'estado' => 'sin_control', 'stock' => null );
			continue;
		}
		if ( 0 === $delta ) {
			$out[] = array( 'i' => $i, 'estado' => 'aplicado', 'stock' => (int) $p->get_stock_quantity() );
			continue;
		}

		$clave = 'li_stk_' . md5( $ref . ':' . $i . ':' . $id );
		if ( ! add_option( $clave, time(), '', false ) ) {
			$out[] = array( 'i' => $i, 'estado' => 'ya_aplicado', 'stock' => (int) $p->get_stock_quantity() );
			continue;
		}

		try {
			$nuevo = wc_update_product_stock( $p, abs( $delta ), $delta < 0 ? 'decrease' : 'increase' );
		} catch ( \Throwable $e ) {
			delete_option( $clave ); // No se aplicó: que el reintento pueda hacerlo.
			return new WP_Error( 'li_stock_fallo', $e->getMessage(), array( 'status' => 500 ) );
		}
		if ( false === $nuevo || null === $nuevo ) {
			delete_option( $clave );
			return new WP_Error( 'li_stock_fallo', 'WooCommerce no pudo ajustar el stock de ' . $id, array( 'status' => 500 ) );
		}
		$out[] = array( 'i' => $i, 'estado' => 'aplicado', 'stock' => (int) $nuevo );
	}

	return rest_ensure_response( array( 'ref' => $ref, 'items' => $out ) );
}

// Las marcas de ajuste aplicado se guardan 30 días: de sobra para cualquier reintento.
add_action( 'li_tienda_limpiar_stock', 'li_tienda_limpiar_marcas_stock' );
if ( ! wp_next_scheduled( 'li_tienda_limpiar_stock' ) ) {
	wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'li_tienda_limpiar_stock' );
}

function li_tienda_limpiar_marcas_stock(): void {
	global $wpdb;
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s AND CAST(option_value AS UNSIGNED) < %d",
			$wpdb->esc_like( 'li_stk_' ) . '%',
			time() - 30 * DAY_IN_SECONDS
		)
	);
}

/*
 * Caché de páginas (LiteSpeed Cache).
 *
 * Los iPhones se cargan en dólares y la web los muestra en pesos con la
 * cotización del momento. Una página cacheada mostraría el precio viejo: se
 * purga toda la caché cuando cambia el valor del dólar o el múltiplo de
 * redondeo. No en cada lectura (cada 30 min se reescribe la fecha aunque el
 * valor sea el mismo), porque vaciarla todo el tiempo la vuelve inútil.
 * Si LiteSpeed Cache no está, la acción no hace nada.
 */
add_action(
	'update_option_li_dolar_cotizacion',
	static function ( $viejo, $nuevo ): void {
		if ( (float) ( $viejo['venta'] ?? 0 ) !== (float) ( $nuevo['venta'] ?? 0 ) ) {
			do_action( 'litespeed_purge_all' );
		}
	},
	10,
	2
);
add_action( 'update_option_li_dolar_multiplo', static fn() => do_action( 'litespeed_purge_all' ) );
