<?php
/**
 * Lanzamiento de la tienda (viernes 09/10/2026, 16:00).
 *
 * Se corre con execute-php (novamira), después de subir este archivo a
 * wp-content/uploads/li-deploy/lanzamiento.php.txt:
 *
 *   require WP_CONTENT_DIR . '/uploads/li-deploy/lanzamiento.php.txt';
 *   return li_lanzamiento( 'revisar' );   // solo mira, no cambia nada
 *   return li_lanzamiento( 'lanzar' );    // abre la tienda (si no hay bloqueos)
 *   return li_lanzamiento( 'volver' );    // vuelve a "Próximamente"
 *
 * "lanzar" no corre si algo bloquea: Mercado Pago en modo prueba, precios de
 * la web sin configurar, POS sin sincronizar o pedidos de prueba abiertos.
 * Mercado Pago no se toca desde acá: el modo prueba se apaga a mano, después
 * de la compra real de punta a punta.
 *
 * No guarda ni imprime credenciales.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/**
 * Corre el lanzamiento.
 *
 * @param string $modo revisar | lanzar | volver.
 * @return array Informe.
 */
function li_lanzamiento( string $modo = 'revisar' ): array {
	$antes = li_lanz_estado();

	if ( 'volver' === $modo ) {
		update_option( 'woocommerce_coming_soon', 'yes' );
		update_option( 'blog_public', '0' );
		do_action( 'litespeed_purge_all' );
		return array(
			'modo'    => 'volver',
			'antes'   => $antes,
			'despues' => li_lanz_estado(),
			'web'     => li_lanz_web( false ),
		);
	}

	$chequeos = li_lanz_chequeos();
	$bloqueos = array_keys( array_filter( $chequeos, static fn( $c ) => ! $c['ok'] && $c['bloquea'] ) );

	if ( 'lanzar' !== $modo ) {
		return array(
			'modo'     => 'revisar',
			'estado'   => $antes,
			'chequeos' => $chequeos,
			'bloqueos' => $bloqueos,
			'web'      => li_lanz_web( 'no' === $antes['proximamente'] ),
		);
	}

	if ( $bloqueos ) {
		return array(
			'modo'     => 'lanzar',
			'hecho'    => false,
			'motivo'   => 'Hay bloqueos: no se cambió nada.',
			'bloqueos' => $bloqueos,
			'chequeos' => $chequeos,
		);
	}

	// Orden del checklist: apagar "Próximamente", abrir a buscadores, purgar.
	update_option( 'woocommerce_coming_soon', 'no' );
	update_option( 'blog_public', '1' );
	do_action( 'litespeed_purge_all' );

	return array(
		'modo'      => 'lanzar',
		'hecho'     => true,
		'hora'      => current_time( 'mysql' ),
		'antes'     => $antes,
		'despues'   => li_lanz_estado(),
		'chequeos'  => $chequeos,
		'web'       => li_lanz_web( true ),
		'siguiente' => array(
			'Search Console: enviar https://lucasinnovaciones.com.ar/wp-sitemap.xml',
			'Abrir la portada en una ventana de incógnito',
			'Revisar el POS en la próxima pasada (cada 10 min)',
		),
	);
}

/**
 * Estado de las llaves del lanzamiento.
 *
 * @return array
 */
function li_lanz_estado(): array {
	return array(
		'proximamente'   => get_option( 'woocommerce_coming_soon' ),
		'buscadores'     => '1' === (string) get_option( 'blog_public' ) ? 'abiertos' : 'bloqueados',
		'mp_modo_prueba' => get_option( 'checkbox_checkout_test_mode' ),
	);
}

/**
 * Chequeos previos. "bloquea" = impide lanzar.
 *
 * @return array
 */
function li_lanz_chequeos(): array {
	global $wpdb;
	$c = array();

	$mp                   = get_option( 'checkbox_checkout_test_mode' );
	$c['mercado_pago']    = array(
		'ok'      => 'no' === $mp,
		'bloquea' => true,
		'detalle' => 'yes' === $mp ? 'Modo prueba ACTIVADO: apagarlo después de la compra real' : 'Modo producción',
	);

	$recargo              = (int) get_option( 'li_web_recargo_bp' );
	$descuento            = (int) get_option( 'li_web_descuento_transferencia_bp' );
	$c['precios_web']     = array(
		'ok'      => 1000 === $recargo && 1000 === $descuento,
		'bloquea' => true,
		'detalle' => sprintf( 'recargo %d bp, descuento transferencia %d bp (esperado 1000 y 1000)', $recargo, $descuento ),
	);

	$cot                  = (float) ( get_option( 'li_dolar_cotizacion' )['venta'] ?? 0 );
	$c['cotizacion']      = array(
		'ok'      => $cot > 0,
		'bloquea' => true,
		'detalle' => 'dólar venta ' . $cot,
	);

	$bacs                 = get_option( 'woocommerce_bacs_settings' );
	$c['transferencia']   = array(
		'ok'      => 'yes' === ( $bacs['enabled'] ?? '' ) && ! empty( get_option( 'woocommerce_bacs_accounts' ) ),
		'bloquea' => true,
		'detalle' => $bacs['title'] ?? '',
	);

	// La clave 3 es la del POS: tiene que haber pasado en los últimos 30 min.
	$pos                  = $wpdb->get_var( "SELECT last_access FROM {$wpdb->prefix}woocommerce_api_keys WHERE key_id = 3" );
	$hace                 = $pos ? ( current_time( 'timestamp' ) - strtotime( $pos ) ) : PHP_INT_MAX;
	$c['pos']             = array(
		'ok'      => $hace <= 30 * MINUTE_IN_SECONDS,
		'bloquea' => true,
		'detalle' => $pos ? sprintf( 'última pasada %s (hace %d min)', $pos, (int) round( $hace / 60 ) ) : 'nunca',
	);

	$prueba               = wc_get_orders(
		array(
			'status'      => array( 'pending', 'on-hold', 'processing' ),
			'limit'       => 50,
			'return'      => 'objects',
		)
	);
	$abiertas             = array();
	foreach ( $prueba as $o ) {
		if ( false !== stripos( (string) $o->get_customer_note(), 'PEDIDO DE PRUEBA' ) ) {
			$abiertas[] = $o->get_id();
		}
	}
	$c['pedidos_prueba']  = array(
		'ok'      => ! $abiertas,
		'bloquea' => true,
		'detalle' => $abiertas ? 'Abiertos: #' . implode( ', #', $abiertas ) : 'Ninguno abierto',
	);

	$c['litespeed']       = array(
		'ok'      => defined( 'LSCWP_V' ),
		'bloquea' => false,
		'detalle' => defined( 'LSCWP_V' ) ? 'LiteSpeed Cache ' . LSCWP_V : 'No está activo: la web anda, pero más lenta',
	);

	$robots               = is_readable( ABSPATH . 'robots.txt' ) ? (string) file_get_contents( ABSPATH . 'robots.txt' ) : '';
	$c['robots']          = array(
		'ok'      => false !== strpos( $robots, 'Sitemap: https://lucasinnovaciones.com.ar/wp-sitemap.xml' ) && ! preg_match( '/^Disallow:\s*\/\s*$/m', $robots ),
		'bloquea' => false,
		'detalle' => $robots ? 'robots.txt propio con sitemap' : 'Falta robots.txt',
	);

	$c['memoria']         = array(
		'ok'      => wp_convert_hr_to_bytes( ini_get( 'memory_limit' ) ) >= 256 * MB_IN_BYTES,
		'bloquea' => false,
		'detalle' => 'PHP memory_limit ' . ini_get( 'memory_limit' ),
	);

	return $c;
}

/**
 * Mira la web como un visitante (sin sesión).
 *
 * @param bool $abierta Si se espera la tienda abierta.
 * @return array
 */
function li_lanz_web( bool $abierta ): array {
	$base = home_url( '/' );
	$urls = array(
		'portada'  => $base,
		'tienda'   => wc_get_page_permalink( 'shop' ),
		'sitemap'  => $base . 'wp-sitemap.xml',
		'robots'   => $base . 'robots.txt',
	);
	$p = wc_get_products( array( 'status' => 'publish', 'stock_status' => 'instock', 'limit' => 1, 'orderby' => 'date', 'order' => 'DESC' ) );
	if ( $p ) {
		$urls['ficha'] = get_permalink( $p[0]->get_id() );
	}

	$r = array( 'se_espera' => $abierta ? 'abierta' : 'próximamente' );
	foreach ( $urls as $k => $u ) {
		// Parámetro aparte para no recibir una copia vieja de la caché.
		$res = wp_remote_get(
			add_query_arg( 'li_lanz', time(), $u ),
			array( 'timeout' => 20, 'redirection' => 3, 'cookies' => array(), 'headers' => array( 'Cache-Control' => 'no-cache' ) )
		);
		if ( is_wp_error( $res ) ) {
			$r[ $k ] = 'ERROR ' . $res->get_error_message();
			continue;
		}
		$code = wp_remote_retrieve_response_code( $res );
		$body = wp_remote_retrieve_body( $res );
		$dato = array( 'http' => $code );
		if ( 'sitemap' === $k ) {
			$dato['productos'] = false !== strpos( $body, 'wp-sitemap-posts-product' );
		} elseif ( 'robots' !== $k ) {
			$dato['titulo']       = preg_match( '/<title>(.*?)<\/title>/s', $body, $m ) ? html_entity_decode( trim( $m[1] ) ) : '';
			// Por el título: "pronto" puede aparecer en cualquier descripción.
			$dato['proximamente'] = false !== stripos( $dato['titulo'], 'Próximamente' ) || false !== strpos( $body, 'woocommerce-coming-soon' );
			$dato['noindex']      = (bool) preg_match( '/<meta[^>]+name=["\']robots["\'][^>]+noindex/i', $body );
		}
		$r[ $k ] = $dato;
	}
	return $r;
}
