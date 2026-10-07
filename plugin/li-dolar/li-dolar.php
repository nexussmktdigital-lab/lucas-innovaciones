<?php
/**
 * Plugin Name: Lucas Innovaciones — Dólar
 * Description: Muestra en pesos, solo en la web, los productos cargados en dólares (meta _li_moneda = USD). Toma el dólar blue de Córdoba (venta) de InfoDolar cada 30 minutos. No escribe precios: el POS y el admin siguen viendo el valor en dólares.
 * Version: 1.0.0
 * Requires PHP: 8.1
 * Author: Lucas Innovaciones
 * Text Domain: li-dolar
 *
 * @package LiDolar
 */

defined( 'ABSPATH' ) || exit;

/*
 * Reglas (ver CLAUDE.md, "Precios en USD"):
 *  - `_price` de un producto USD guarda dólares y NO se toca nunca. La
 *    conversión pasa solo al mostrar y al cobrar en la web.
 *  - Nunca en wp-admin, ni en la REST `/wc/v3` (la del POS), ni en cron.
 *    La Store API (`/wc/store/*`, carrito y checkout por bloques) sí es web.
 *  - Redondeo hacia arriba al múltiplo configurado (1.000 por defecto), sobre
 *    el precio unitario: el total del pedido es la suma de precios redondos.
 *  - Sin cotización de menos de 24 h, los productos USD no se venden y piden
 *    consulta por WhatsApp.
 */

final class Li_Dolar {

	public const VERSION = '1.0.0';

	/** Meta que marca un producto como cargado en dólares. Única escritura de datos permitida. */
	public const META_MONEDA = '_li_moneda';

	private const OPT_ACTUAL    = 'li_dolar_cotizacion';
	private const OPT_PENDIENTE = 'li_dolar_pendiente';
	private const OPT_INTENTO   = 'li_dolar_ultimo_intento';
	private const OPT_HISTORIAL = 'li_dolar_historial';
	private const OPT_MULTIPLO  = 'li_dolar_multiplo';

	private const HOOK_CRON = 'li_dolar_actualizar';
	private const FUENTE    = 'https://www.infodolar.com/cotizacion-dolar-provincia-cordoba.aspx';

	/** Barandas del valor del dólar. */
	private const MIN = 500.0;
	private const MAX = 10000.0;
	private const MAX_VARIACION = 0.15;
	private const VIGENCIA = DAY_IN_SECONDS;

	/**
	 * Un "precio en dólares" por encima de esto ya está en pesos: o lo
	 * reescribió alguien (p. ej. el POS) o se está por convertir dos veces.
	 * En ese caso se muestra tal cual y se avisa en el admin.
	 */
	public const TOPE_USD = 10000.0;

	public const MULTIPLOS = array( 1000, 5000, 10000 );

	public const WHATSAPP = '5493574443092';

	private static ?bool $web = null;

	public static function init(): void {
		add_filter( 'cron_schedules', array( __CLASS__, 'intervalo' ) );
		add_action( 'init', array( __CLASS__, 'programar' ) );
		add_action( self::HOOK_CRON, array( __CLASS__, 'actualizar' ) );

		// Precio en pesos: solo en la web.
		foreach ( array( 'product', 'product_variation' ) as $tipo ) {
			foreach ( array( 'price', 'regular_price', 'sale_price' ) as $prop ) {
				add_filter( "woocommerce_{$tipo}_get_{$prop}", array( __CLASS__, 'filtrar_precio' ), 50, 2 );
			}
		}
		add_filter( 'woocommerce_variation_prices_price', array( __CLASS__, 'filtrar_precio' ), 50, 2 );
		add_filter( 'woocommerce_variation_prices_regular_price', array( __CLASS__, 'filtrar_precio' ), 50, 2 );
		add_filter( 'woocommerce_variation_prices_sale_price', array( __CLASS__, 'filtrar_precio' ), 50, 2 );
		add_filter( 'woocommerce_get_variation_prices_hash', array( __CLASS__, 'hash_variaciones' ), 50, 2 );

		add_filter( 'woocommerce_is_purchasable', array( __CLASS__, 'comprable' ), 50, 2 );
		add_filter( 'woocommerce_variation_is_purchasable', array( __CLASS__, 'comprable' ), 50, 2 );
		add_filter( 'woocommerce_get_price_html', array( __CLASS__, 'precio_html' ), 50, 2 );
		add_filter( 'woocommerce_product_get_purchase_note', array( __CLASS__, 'nota_compra' ), 50, 2 );

		// Rastro en el pedido: con qué dólar se vendió cada renglón.
		add_action( 'woocommerce_checkout_create_order_line_item', array( __CLASS__, 'rastro_renglon' ), 10, 3 );

		// Admin.
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_li_dolar', array( __CLASS__, 'accion_admin' ) );
		add_action( 'admin_notices', array( __CLASS__, 'avisos' ) );
		add_action( 'woocommerce_product_options_pricing', array( __CLASS__, 'campo_producto' ) );
		add_action( 'woocommerce_admin_process_product_object', array( __CLASS__, 'guardar_producto' ) );
	}

	/* ------------------------------------------------------------------
	 * Contexto
	 * ---------------------------------------------------------------- */

	/**
	 * ¿Esta petición es "la web"? Solo ahí se convierte.
	 */
	public static function es_web(): bool {
		if ( null !== self::$web && did_action( 'parse_request' ) ) {
			return self::$web;
		}

		$web = self::calcular_web();

		// Recién después de parse_request se sabe si es REST: antes no se cachea.
		if ( did_action( 'parse_request' ) ) {
			self::$web = $web;
		}
		return $web;
	}

	private static function calcular_web(): bool {
		if ( wp_doing_cron() || ( defined( 'WP_CLI' ) && WP_CLI ) ) {
			return false;
		}

		$ruta = self::ruta_rest();
		if ( null !== $ruta ) {
			// Solo la Store API (carrito y checkout por bloques). /wc/v3 y todo lo demás, no.
			return str_starts_with( ltrim( $ruta, '/' ), 'wc/store' );
		}

		if ( wp_doing_ajax() ) {
			// admin-ajax: solo si lo pidió una página pública.
			$ref = wp_get_raw_referer();
			return $ref && ! str_contains( $ref, '/wp-admin/' );
		}

		return ! is_admin();
	}

	/**
	 * Ruta REST de la petición, o null si no es REST.
	 * Se mira la URL además de REST_REQUEST porque los precios se pueden
	 * pedir antes de que WordPress termine de reconocer la ruta.
	 */
	private static function ruta_rest(): ?string {
		if ( ! empty( $GLOBALS['wp']->query_vars['rest_route'] ) ) {
			return (string) $GLOBALS['wp']->query_vars['rest_route'];
		}
		if ( isset( $_GET['rest_route'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return sanitize_text_field( wp_unslash( $_GET['rest_route'] ) ); // phpcs:ignore WordPress.Security.NonceVerification
		}
		$uri    = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$prefix = '/' . trim( rest_get_url_prefix(), '/' ) . '/';
		$pos    = strpos( $uri, $prefix );
		if ( false !== $pos ) {
			$ruta = substr( $uri, $pos + strlen( $prefix ) - 1 );
			return strtok( $ruta, '?' ) ?: '/';
		}
		if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
			return '/';
		}
		return null;
	}

	/* ------------------------------------------------------------------
	 * API para el tema
	 * ---------------------------------------------------------------- */

	public static function es_usd( $producto ): bool {
		$id = $producto instanceof WC_Product ? $producto->get_id() : (int) $producto;
		if ( ! $id ) {
			return false;
		}
		if ( 'USD' === get_post_meta( $id, self::META_MONEDA, true ) ) {
			return true;
		}
		// Las variaciones heredan la moneda del producto padre.
		$padre = wp_get_post_parent_id( $id );
		return $padre && 'product' === get_post_type( $padre ) && 'USD' === get_post_meta( $padre, self::META_MONEDA, true );
	}

	/** Cotización vigente (venta) o null si no hay o tiene más de 24 h. */
	public static function vigente(): ?float {
		$c = self::actual();
		if ( ! $c || ( time() - (int) $c['ts'] ) > self::VIGENCIA ) {
			return null;
		}
		return (float) $c['venta'];
	}

	public static function actual(): ?array {
		$c = get_option( self::OPT_ACTUAL );
		return ( is_array( $c ) && ! empty( $c['venta'] ) && ! empty( $c['ts'] ) ) ? $c : null;
	}

	public static function multiplo(): int {
		$m = (int) get_option( self::OPT_MULTIPLO, 1000 );
		return in_array( $m, self::MULTIPLOS, true ) ? $m : 1000;
	}

	/** Pesos para un monto en dólares, redondeado hacia arriba. Null si no hay cotización vigente. */
	public static function a_pesos( float $usd, ?float $cotizacion = null ): ?int {
		$cotizacion ??= self::vigente();
		if ( ! $cotizacion || $usd <= 0 ) {
			return null;
		}
		$m   = self::multiplo();
		$ars = round( $usd * $cotizacion, 2 );
		return (int) ( ceil( $ars / $m - 1e-9 ) * $m );
	}

	/* ------------------------------------------------------------------
	 * Filtros de la web
	 * ---------------------------------------------------------------- */

	/**
	 * @param mixed      $valor    Precio guardado (en dólares).
	 * @param WC_Product $producto Producto.
	 */
	public static function filtrar_precio( $valor, $producto ) {
		if ( '' === $valor || null === $valor || ! $producto instanceof WC_Product ) {
			return $valor;
		}
		if ( ! self::es_web() || ! self::es_usd( $producto ) ) {
			return $valor;
		}
		$usd = (float) $valor;
		if ( $usd <= 0 || $usd > self::TOPE_USD ) {
			return $valor; // Ya está en pesos (o vacío): no se convierte dos veces.
		}
		$ars = self::a_pesos( $usd );
		return null === $ars ? $valor : (string) $ars;
	}

	public static function hash_variaciones( array $hash, $producto ): array {
		if ( self::es_usd( $producto ) ) {
			$hash[] = self::es_web() ? 'li-ars-' . self::vigente() . '-' . self::multiplo() : 'li-usd';
		}
		return $hash;
	}

	public static function comprable( bool $ok, $producto ): bool {
		if ( $ok && self::es_web() && self::es_usd( $producto ) && null === self::vigente() ) {
			return false;
		}
		return $ok;
	}

	public static function precio_html( string $html, $producto ): string {
		if ( ! self::es_web() || ! self::es_usd( $producto ) || null !== self::vigente() ) {
			return $html;
		}
		$texto = rawurlencode( 'Hola! Quería consultar el precio de ' . $producto->get_name() );
		return sprintf(
			'<a class="li-consultar" href="https://wa.me/%s?text=%s" target="_blank" rel="noopener">Consultar por WhatsApp</a>',
			esc_attr( self::WHATSAPP ),
			esc_attr( $texto )
		);
	}

	/**
	 * La nota "⚠️ Precio en dólares… consultá antes de comprar" dejó de ser
	 * cierta: el precio ya se muestra en pesos. Se oculta sin tocar el dato.
	 */
	public static function nota_compra( $nota, $producto ) {
		if ( is_string( $nota ) && str_contains( $nota, 'Precio en dólares' ) ) {
			return '';
		}
		return $nota;
	}

	/**
	 * @param WC_Order_Item_Product $item Renglón.
	 */
	public static function rastro_renglon( $item, $clave, $valores ): void {
		$p = $valores['data'] ?? null;
		if ( ! $p instanceof WC_Product || ! self::es_usd( $p ) ) {
			return;
		}
		$usd = (float) $p->get_price( 'edit' );
		if ( $usd > 0 && $usd <= self::TOPE_USD ) {
			$item->add_meta_data( '_li_precio_usd', $usd, true );
			$item->add_meta_data( '_li_cotizacion', self::vigente(), true );
		}
	}

	/* ------------------------------------------------------------------
	 * Cotización
	 * ---------------------------------------------------------------- */

	public static function intervalo( array $s ): array {
		$s['li_30_min'] = array(
			'interval' => 30 * MINUTE_IN_SECONDS,
			'display'  => 'Cada 30 minutos',
		);
		return $s;
	}

	public static function programar(): void {
		if ( ! wp_next_scheduled( self::HOOK_CRON ) ) {
			wp_schedule_event( time() + 60, 'li_30_min', self::HOOK_CRON );
		}
	}

	public static function desprogramar(): void {
		wp_clear_scheduled_hook( self::HOOK_CRON );
	}

	/**
	 * Dólar blue de Córdoba, columna venta. La página tiene dos tablas: la
	 * primera es el promedio de casas de cambio (no es el blue); la del blue
	 * es la de id="BluePromedio".
	 *
	 * @return array{compra:float,venta:float}|WP_Error
	 */
	public static function leer_fuente(): array|WP_Error {
		$r = wp_remote_get(
			self::FUENTE,
			array(
				'timeout'    => 20,
				'user-agent' => 'Mozilla/5.0 (compatible; LucasInnovaciones/1.0; +https://lucasinnovaciones.com.ar)',
			)
		);
		if ( is_wp_error( $r ) ) {
			return $r;
		}
		if ( 200 !== wp_remote_retrieve_response_code( $r ) ) {
			return new WP_Error( 'http', 'InfoDolar respondió ' . wp_remote_retrieve_response_code( $r ) );
		}
		$re = '#id="BluePromedio".*?<td class="colCompraVenta"[^>]*data-order="\$\s*([0-9.,]+)".*?<td class="colCompraVenta"[^>]*data-order="\$\s*([0-9.,]+)"#is';
		if ( ! preg_match( $re, wp_remote_retrieve_body( $r ), $m ) ) {
			return new WP_Error( 'parseo', 'No se encontró la fila del blue en Córdoba: InfoDolar pudo haber cambiado la página.' );
		}
		return array(
			'compra' => self::numero( $m[1] ),
			'venta'  => self::numero( $m[2] ),
		);
	}

	/** "1.561,00" → 1561.0 */
	public static function numero( string $s ): float {
		return (float) str_replace( ',', '.', str_replace( '.', '', trim( $s ) ) );
	}

	/**
	 * Tarea del cron. Ante cualquier duda no cambia nada: mejor un dólar de
	 * hace un rato que uno absurdo.
	 */
	public static function actualizar(): array {
		$datos = self::leer_fuente();
		if ( is_wp_error( $datos ) ) {
			return self::intento( false, $datos->get_error_message() );
		}
		return self::aplicar( $datos['venta'], $datos['compra'], 'infodolar', false );
	}

	/**
	 * @param bool $forzar Si lo hace una persona: salta el control de variación (no el de rango).
	 */
	public static function aplicar( float $venta, float $compra, string $fuente, bool $forzar ): array {
		if ( $venta < self::MIN || $venta > self::MAX ) {
			return self::intento( false, sprintf( 'Valor fuera de rango (%s). No se aplicó.', self::fmt( $venta ) ) );
		}

		$ant = self::actual();
		if ( ! $forzar && $ant ) {
			$var = abs( $venta - $ant['venta'] ) / $ant['venta'];
			if ( $var > self::MAX_VARIACION ) {
				$pend = get_option( self::OPT_PENDIENTE );
				if ( ! is_array( $pend ) || (float) $pend['venta'] !== $venta ) {
					update_option(
						self::OPT_PENDIENTE,
						array( 'venta' => $venta, 'compra' => $compra, 'fuente' => $fuente, 'ts' => time() ),
						false
					);
					self::avisar_salto( $ant['venta'], $venta, $var );
				}
				return self::intento( false, sprintf( 'Salto del %s%% (de %s a %s): no se aplicó. Revisalo en WooCommerce → Dólar.', round( $var * 100, 1 ), self::fmt( $ant['venta'] ), self::fmt( $venta ) ) );
			}
		}

		$nueva = array(
			'venta'  => $venta,
			'compra' => $compra,
			'fuente' => $fuente,
			'ts'     => time(),
		);
		update_option( self::OPT_ACTUAL, $nueva, true );
		delete_option( self::OPT_PENDIENTE );

		$h = get_option( self::OPT_HISTORIAL, array() );
		$h = is_array( $h ) ? $h : array();
		if ( ! $ant || (float) $ant['venta'] !== $venta || $forzar ) {
			array_unshift( $h, $nueva );
			update_option( self::OPT_HISTORIAL, array_slice( $h, 0, 50 ), false );
		}

		return self::intento( true, 'Cotización ' . self::fmt( $venta ) . ' (' . $fuente . ').' );
	}

	private static function intento( bool $ok, string $msg ): array {
		$r = array(
			'ok'      => $ok,
			'mensaje' => $msg,
			'ts'      => time(),
		);
		update_option( self::OPT_INTENTO, $r, false );
		return $r;
	}

	private static function avisar_salto( float $ant, float $nueva, float $var ): void {
		wp_mail(
			get_option( 'admin_email' ),
			'[Lucas Innovaciones] El dólar saltó ' . round( $var * 100, 1 ) . '% y no se aplicó',
			sprintf(
				"InfoDolar informa el blue de Córdoba en %s (venta). El último aplicado es %s.\n\nComo la diferencia supera el 15%%, la web sigue usando %s. Si el salto es real, aplicalo desde WooCommerce → Dólar:\n%s\n",
				self::fmt( $nueva ),
				self::fmt( $ant ),
				self::fmt( $ant ),
				admin_url( 'admin.php?page=li-dolar' )
			)
		);
	}

	public static function fmt( float $n ): string {
		return '$ ' . number_format( $n, 2, ',', '.' );
	}

	/* ------------------------------------------------------------------
	 * Admin
	 * ---------------------------------------------------------------- */

	public static function menu(): void {
		add_submenu_page( 'woocommerce', 'Dólar', 'Dólar', 'manage_woocommerce', 'li-dolar', array( __CLASS__, 'pantalla' ) );
	}

	/** IDs de productos marcados USD. */
	public static function ids_usd(): array {
		global $wpdb;
		return array_map(
			'intval',
			$wpdb->get_col( $wpdb->prepare( "SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value = 'USD'", self::META_MONEDA ) )
		);
	}

	public static function pantalla(): void {
		$c   = self::actual();
		$vig = self::vigente();
		$int = get_option( self::OPT_INTENTO );
		$pen = get_option( self::OPT_PENDIENTE );
		$url = admin_url( 'admin-post.php' );
		$nonce = wp_nonce_field( 'li_dolar', '_wpnonce', true, false );

		echo '<div class="wrap"><h1>Dólar</h1>';

		if ( $c ) {
			printf(
				'<p style="font-size:1.6em;margin:.5em 0">Blue Córdoba, venta: <strong>%s</strong></p><p>Fuente: %s · Actualizado: <strong>%s</strong>%s</p>',
				esc_html( self::fmt( (float) $c['venta'] ) ),
				esc_html( $c['fuente'] ),
				esc_html( wp_date( 'd/m/Y H:i', (int) $c['ts'] ) ),
				$vig ? '' : ' · <strong style="color:#b32d2e">vencida: los productos en dólares no se pueden comprar</strong>'
			);
		} else {
			echo '<p><strong>Todavía no hay cotización.</strong> Los productos en dólares se ven como "Consultar por WhatsApp".</p>';
		}

		if ( is_array( $int ) ) {
			printf(
				'<p>Último intento: %s — %s</p>',
				esc_html( wp_date( 'd/m/Y H:i', (int) $int['ts'] ) ),
				esc_html( $int['mensaje'] )
			);
		}
		$prox = wp_next_scheduled( self::HOOK_CRON );
		printf( '<p>Próxima lectura automática: %s (cada 30 minutos).</p>', $prox ? esc_html( wp_date( 'd/m/Y H:i', $prox ) ) : 'sin programar' );

		echo '<div style="display:flex;gap:24px;flex-wrap:wrap">';

		// Actualizar ya.
		printf(
			'<form method="post" action="%s"><input type="hidden" name="action" value="li_dolar"><input type="hidden" name="op" value="leer">%s<p><button class="button">Leer InfoDolar ahora</button></p></form>',
			esc_url( $url ),
			$nonce // phpcs:ignore WordPress.Security.EscapeOutput
		);

		// Pendiente por salto.
		if ( is_array( $pen ) ) {
			printf(
				'<form method="post" action="%s"><input type="hidden" name="action" value="li_dolar"><input type="hidden" name="op" value="pendiente">%s<p><button class="button button-primary">Aplicar %s igual</button> <span>(saltó más del 15%%)</span></p></form>',
				esc_url( $url ),
				$nonce, // phpcs:ignore WordPress.Security.EscapeOutput
				esc_html( self::fmt( (float) $pen['venta'] ) )
			);
		}
		echo '</div>';

		// Forzar a mano.
		printf(
			'<h2>Cargar a mano</h2><form method="post" action="%s"><input type="hidden" name="action" value="li_dolar"><input type="hidden" name="op" value="manual">%s<p><label>Venta $ <input type="text" name="venta" inputmode="decimal" placeholder="1561" style="width:8em"></label> <button class="button button-primary">Usar este valor</button></p><p class="description">Pisa la cotización hasta la próxima lectura de InfoDolar que esté dentro del 15%%. Valores aceptados: entre 500 y 10.000.</p></form>',
			esc_url( $url ),
			$nonce // phpcs:ignore WordPress.Security.EscapeOutput
		);

		// Redondeo.
		$m = self::multiplo();
		echo '<h2>Redondeo</h2>';
		printf( '<form method="post" action="%s"><input type="hidden" name="action" value="li_dolar"><input type="hidden" name="op" value="multiplo">%s<p>Hacia arriba, al múltiplo de <select name="multiplo">', esc_url( $url ), $nonce ); // phpcs:ignore WordPress.Security.EscapeOutput
		foreach ( self::MULTIPLOS as $op ) {
			printf( '<option value="%d"%s>$ %s</option>', $op, selected( $m, $op, false ), esc_html( number_format( $op, 0, ',', '.' ) ) );
		}
		echo '</select> <button class="button">Guardar</button></p></form>';

		// Productos.
		$ids = self::ids_usd();
		printf( '<h2>Productos en dólares (%d)</h2>', count( $ids ) );
		echo '<table class="widefat striped" style="max-width:900px"><thead><tr><th>Producto</th><th>Stock</th><th>USD</th><th>En la web</th></tr></thead><tbody>';
		$filas = array();
		foreach ( $ids as $id ) {
			$p = wc_get_product( $id );
			if ( ! $p ) {
				continue;
			}
			$usd = (float) $p->get_price( 'edit' );
			if ( $usd > self::TOPE_USD ) {
				$web = '<strong style="color:#b32d2e">El precio parece estar en pesos: se muestra tal cual</strong>';
			} else {
				$ars = self::a_pesos( $usd );
				$web = null === $ars ? 'Consultar por WhatsApp' : '$ ' . number_format( $ars, 0, ',', '.' );
			}
			$filas[] = array( $usd, sprintf(
				'<tr><td><a href="%s">%s</a></td><td>%s</td><td>%s</td><td>%s</td></tr>',
				esc_url( get_edit_post_link( $id ) ),
				esc_html( $p->get_name() ),
				'instock' === $p->get_stock_status() ? 'Sí' : 'No',
				esc_html( number_format( $usd, 2, ',', '.' ) ),
				wp_kses_post( $web )
			) );
		}
		usort( $filas, fn( $a, $b ) => $b[0] <=> $a[0] );
		echo implode( '', array_column( $filas, 1 ) ); // phpcs:ignore WordPress.Security.EscapeOutput
		echo '</tbody></table>';

		$h = get_option( self::OPT_HISTORIAL, array() );
		if ( is_array( $h ) && $h ) {
			echo '<h2>Historial</h2><table class="widefat striped" style="max-width:520px"><thead><tr><th>Fecha</th><th>Venta</th><th>Fuente</th></tr></thead><tbody>';
			foreach ( array_slice( $h, 0, 20 ) as $e ) {
				printf( '<tr><td>%s</td><td>%s</td><td>%s</td></tr>', esc_html( wp_date( 'd/m/Y H:i', (int) $e['ts'] ) ), esc_html( self::fmt( (float) $e['venta'] ) ), esc_html( $e['fuente'] ) );
			}
			echo '</tbody></table>';
		}
		echo '</div>';
	}

	public static function accion_admin(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) || ! check_admin_referer( 'li_dolar' ) ) {
			wp_die( 'Sin permisos.' );
		}
		$op = isset( $_POST['op'] ) ? sanitize_key( $_POST['op'] ) : '';
		$r  = array( 'ok' => false, 'mensaje' => 'Nada que hacer.' );

		switch ( $op ) {
			case 'leer':
				$r = self::actualizar();
				break;
			case 'pendiente':
				$p = get_option( self::OPT_PENDIENTE );
				if ( is_array( $p ) ) {
					$r = self::aplicar( (float) $p['venta'], (float) $p['compra'], $p['fuente'], true );
				}
				break;
			case 'manual':
				$v = isset( $_POST['venta'] ) ? self::numero( sanitize_text_field( wp_unslash( $_POST['venta'] ) ) ) : 0;
				// "1561" o "1561,50" llegan bien; "1.561" se lee como 1561 por la regla de miles.
				$r = self::aplicar( $v, 0, 'manual (' . wp_get_current_user()->user_login . ')', true );
				break;
			case 'multiplo':
				$m = isset( $_POST['multiplo'] ) ? (int) $_POST['multiplo'] : 1000;
				if ( in_array( $m, self::MULTIPLOS, true ) ) {
					update_option( self::OPT_MULTIPLO, $m, true );
					$r = array( 'ok' => true, 'mensaje' => 'Redondeo guardado.' );
				}
				break;
		}

		wp_safe_redirect(
			add_query_arg(
				array(
					'page'    => 'li-dolar',
					'li_ok'   => $r['ok'] ? '1' : '0',
					'li_msg'  => rawurlencode( $r['mensaje'] ),
				),
				admin_url( 'admin.php' )
			)
		);
		exit;
	}

	public static function avisos(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		// phpcs:disable WordPress.Security.NonceVerification
		if ( isset( $_GET['page'], $_GET['li_msg'] ) && 'li-dolar' === $_GET['page'] ) {
			printf(
				'<div class="notice notice-%s is-dismissible"><p>%s</p></div>',
				empty( $_GET['li_ok'] ) ? 'error' : 'success',
				esc_html( rawurldecode( sanitize_text_field( wp_unslash( $_GET['li_msg'] ) ) ) )
			);
		}
		// phpcs:enable
		if ( self::ids_usd() && null === self::vigente() ) {
			printf(
				'<div class="notice notice-error"><p><strong>Dólar vencido:</strong> hace más de 24 h que no hay cotización, así que los productos en dólares no se pueden comprar en la web. <a href="%s">Revisar</a></p></div>',
				esc_url( admin_url( 'admin.php?page=li-dolar' ) )
			);
		} elseif ( get_option( self::OPT_PENDIENTE ) ) {
			printf(
				'<div class="notice notice-warning"><p><strong>Dólar:</strong> InfoDolar informó un salto de más del 15%% que no se aplicó. <a href="%s">Revisar</a></p></div>',
				esc_url( admin_url( 'admin.php?page=li-dolar' ) )
			);
		}
	}

	public static function campo_producto(): void {
		global $product_object;
		$usd = $product_object instanceof WC_Product && 'USD' === $product_object->get_meta( self::META_MONEDA );
		echo '<div class="options_group show_if_simple show_if_variable">';
		woocommerce_wp_checkbox(
			array(
				'id'          => self::META_MONEDA,
				'label'       => 'Precio en dólares',
				'value'       => $usd ? 'yes' : 'no',
				'description' => 'El precio de arriba está en USD. La web lo muestra en pesos con el dólar blue de Córdoba; el POS y el admin siguen viendo dólares.',
			)
		);
		echo '</div>';
	}

	/** @param WC_Product $p Producto. */
	public static function guardar_producto( $p ): void {
		// phpcs:ignore WordPress.Security.NonceVerification -- Woo ya verificó el nonce del editor.
		if ( isset( $_POST[ self::META_MONEDA ] ) ) {
			$p->update_meta_data( self::META_MONEDA, 'USD' );
		} else {
			$p->delete_meta_data( self::META_MONEDA );
		}
	}
}

Li_Dolar::init();

register_activation_hook(
	__FILE__,
	static function () {
		wp_clear_scheduled_hook( 'li_dolar_actualizar' );
		Li_Dolar::actualizar();
	}
);
register_deactivation_hook( __FILE__, array( 'Li_Dolar', 'desprogramar' ) );

/* Atajos para el tema. */

function li_dolar_es_usd( $producto ): bool {
	return Li_Dolar::es_usd( $producto );
}

function li_dolar_vigente(): ?float {
	return Li_Dolar::vigente();
}

function li_dolar_a_pesos( float $usd ): ?int {
	return Li_Dolar::a_pesos( $usd );
}

function li_dolar_es_web(): bool {
	return Li_Dolar::es_web();
}
