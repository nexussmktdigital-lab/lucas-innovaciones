<?php
/**
 * Plugin Name: Lucas Innovaciones — Cotización
 * Description: Mantiene en pesos los precios de los productos cargados en dólares. Toma el dólar blue de Córdoba desde InfoDolar dos veces por día y reescribe los precios en ARS.
 * Version: 1.0.0
 * Requires PHP: 8.1
 * Author: Lucas Innovaciones
 * Text Domain: lucas-cotizacion
 *
 * @package LucasCotizacion
 */

defined( 'ABSPATH' ) || exit;

/*
 * Por qué es un plugin y no parte del tema:
 * el precio es lógica de negocio. Si mañana se cambia el tema, los precios
 * tienen que seguir actualizándose — y el POS lee exactamente el mismo
 * _price que la web.
 */

final class Lucas_Cotizacion {

	public const VERSION = '1.0.0';

	/** Opción con la cotización vigente. */
	private const OPT_ACTUAL = 'li_cotizacion_actual';

	/** Historial de actualizaciones, para auditar. */
	private const OPT_HISTORIAL = 'li_cotizacion_historial';

	/** Contador de fallos consecutivos de la fuente principal. */
	private const OPT_FALLOS = 'li_cotizacion_fallos';

	/** Meta con el precio en dólares. Su presencia marca al producto como USD. */
	public const META_USD = '_li_precio_usd';

	/** Meta con el precio de oferta en dólares. */
	public const META_USD_OFERTA = '_li_precio_usd_oferta';

	/** Cotización usada la última vez que se escribió el precio del producto. */
	public const META_COTIZACION = '_li_cotizacion_aplicada';

	private const HOOK_MANANA = 'li_cotizacion_manana';
	private const HOOK_TARDE  = 'li_cotizacion_tarde';

	/**
	 * Banda de plausibilidad. Fuera de esto el valor se descarta sin tocar precios.
	 */
	private const MIN_PLAUSIBLE = 100.0;
	private const MAX_PLAUSIBLE = 500000.0;

	/** Variación máxima aceptada respecto de la cotización anterior. */
	private const MAX_VARIACION = 0.15;

	public static function init(): void {
		$i = new self();

		add_action( 'init', array( $i, 'programar' ) );
		add_action( self::HOOK_MANANA, array( $i, 'tarea' ) );
		add_action( self::HOOK_TARDE, array( $i, 'tarea' ) );

		// Campos en el editor de producto.
		add_action( 'woocommerce_product_options_pricing', array( $i, 'campos_producto' ) );
		add_action( 'woocommerce_admin_process_product_object', array( $i, 'guardar_producto' ) );

		// Pantalla de administración.
		add_action( 'admin_menu', array( $i, 'menu' ) );
		add_action( 'admin_post_li_cotizacion_actualizar', array( $i, 'accion_actualizar' ) );
		add_action( 'admin_notices', array( $i, 'aviso_fallos' ) );

		// Referencia visible en la ficha de producto.
		add_filter( 'woocommerce_get_price_html', array( $i, 'referencia_usd' ), 10, 2 );

		register_deactivation_hook( __FILE__, array( __CLASS__, 'desprogramar' ) );
	}

	/* ---------------------------------------------------------------------
	 * Programación
	 * ------------------------------------------------------------------ */

	/**
	 * Dos ejecuciones diarias, alineadas con el horario del local:
	 * 9:00 (apertura) y 17:00 (reapertura de la tarde).
	 */
	public function programar(): void {
		foreach ( array( self::HOOK_MANANA => 9, self::HOOK_TARDE => 17 ) as $hook => $hora ) {
			if ( wp_next_scheduled( $hook ) ) {
				continue;
			}
			wp_schedule_event( $this->proxima_ocurrencia( $hora ), 'daily', $hook );
		}
	}

	public static function desprogramar(): void {
		foreach ( array( self::HOOK_MANANA, self::HOOK_TARDE ) as $hook ) {
			$ts = wp_next_scheduled( $hook );
			if ( $ts ) {
				wp_unschedule_event( $ts, $hook );
			}
		}
	}

	/**
	 * Marca de tiempo UTC de la próxima vez que sean las $hora en Argentina.
	 */
	private function proxima_ocurrencia( int $hora ): int {
		$tz  = wp_timezone();
		$hoy = new DateTimeImmutable( 'today ' . sprintf( '%02d:00', $hora ), $tz );

		if ( $hoy->getTimestamp() <= time() ) {
			$hoy = $hoy->modify( '+1 day' );
		}

		return $hoy->getTimestamp();
	}

	/* ---------------------------------------------------------------------
	 * Obtención de la cotización
	 * ------------------------------------------------------------------ */

	/**
	 * Dólar blue de Córdoba desde InfoDolar.
	 *
	 * La página trae dos tablas: la primera es el promedio de casas de cambio
	 * —que NO es el blue— y la segunda, id="BluePromedio", sí lo es. Apuntar a
	 * la equivocada da precios ~3% más bajos.
	 *
	 * @return array{venta:float,compra:float}|WP_Error
	 */
	public function traer_infodolar(): array|WP_Error {
		$r = wp_remote_get(
			'https://www.infodolar.com/cotizacion-dolar-provincia-cordoba.aspx',
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

		$html = wp_remote_retrieve_body( $r );

		$re = '#id="BluePromedio".*?<td class="colCompraVenta"[^>]*data-order="\$\s*([0-9.,]+)".*?<td class="colCompraVenta"[^>]*data-order="\$\s*([0-9.,]+)"#is';
		if ( ! preg_match( $re, $html, $m ) ) {
			return new WP_Error( 'parseo', 'No se encontró la tabla BluePromedio: InfoDolar pudo haber cambiado su HTML' );
		}

		return array(
			'compra' => $this->a_numero( $m[1] ),
			'venta'  => $this->a_numero( $m[2] ),
		);
	}

	/**
	 * Respaldo: blue nacional desde una API JSON.
	 *
	 * Se usa solo si InfoDolar falla. No es idéntico al de Córdoba —suele
	 * diferir alrededor de un 1%— pero es preferible a quedarse sin dato.
	 *
	 * @return array{venta:float,compra:float}|WP_Error
	 */
	public function traer_respaldo(): array|WP_Error {
		$r = wp_remote_get( 'https://dolarapi.com/v1/dolares/blue', array( 'timeout' => 15 ) );

		if ( is_wp_error( $r ) ) {
			return $r;
		}

		$j = json_decode( wp_remote_retrieve_body( $r ), true );

		if ( ! is_array( $j ) || empty( $j['venta'] ) ) {
			return new WP_Error( 'parseo', 'Respuesta inesperada de dolarapi' );
		}

		return array(
			'compra' => (float) ( $j['compra'] ?? 0 ),
			'venta'  => (float) $j['venta'],
		);
	}

	/**
	 * Convierte "1.571,00" a 1571.0.
	 */
	private function a_numero( string $s ): float {
		return (float) str_replace( ',', '.', str_replace( '.', '', trim( $s ) ) );
	}

	/* ---------------------------------------------------------------------
	 * Tarea programada
	 * ------------------------------------------------------------------ */

	/**
	 * Trae la cotización, la valida y, si corresponde, reescribe los precios.
	 *
	 * Ante cualquier duda no toca nada: es preferible un precio desactualizado
	 * a un catálogo con precios absurdos.
	 *
	 * @param bool $manual Si la disparó una persona desde el escritorio.
	 * @return array Resumen de lo ocurrido.
	 */
	public function tarea( bool $manual = false ): array {
		$anterior = $this->actual();
		$fuente   = 'infodolar';

		$datos = $this->traer_infodolar();

		if ( is_wp_error( $datos ) ) {
			$motivo = $datos->get_error_message();
			$datos  = $this->traer_respaldo();
			$fuente = 'dolarapi (respaldo)';

			if ( is_wp_error( $datos ) ) {
				$this->registrar_fallo();
				return $this->resultado( false, 'Ambas fuentes fallaron. ' . $motivo, $anterior );
			}

			$this->registrar_fallo();
		} else {
			update_option( self::OPT_FALLOS, 0, false );
		}

		$venta = (float) $datos['venta'];

		if ( $venta < self::MIN_PLAUSIBLE || $venta > self::MAX_PLAUSIBLE ) {
			return $this->resultado( false, sprintf( 'Valor fuera de banda: %s. No se tocaron los precios.', $venta ), $anterior );
		}

		if ( $anterior && $anterior['venta'] > 0 ) {
			$var = abs( $venta - $anterior['venta'] ) / $anterior['venta'];
			if ( $var > self::MAX_VARIACION && ! $manual ) {
				return $this->resultado(
					false,
					sprintf(
						'Variación del %s%% respecto de %s: se descartó por seguridad. Actualizá a mano si el salto es real.',
						round( $var * 100, 1 ),
						number_format( $anterior['venta'], 2, ',', '.' )
					),
					$anterior
				);
			}
		}

		$nueva = array(
			'venta'  => $venta,
			'compra' => (float) ( $datos['compra'] ?? 0 ),
			'fuente' => $fuente,
			'ts'     => time(),
		);

		update_option( self::OPT_ACTUAL, $nueva, true );
		$this->historial( $nueva );

		$n = $this->reescribir_precios( $venta );

		return $this->resultado( true, sprintf( '%d productos actualizados.', $n ), $nueva );
	}

	/**
	 * Reescribe en pesos el precio de todos los productos cargados en dólares.
	 *
	 * Se usa la CRUD de WooCommerce a propósito: así se sincronizan la tabla
	 * de búsqueda de precios, el orden por precio y los filtros por rango,
	 * y el POS ve el mismo valor que la web.
	 *
	 * @param float $cotizacion Pesos por dólar.
	 * @return int Cantidad de productos modificados.
	 */
	public function reescribir_precios( float $cotizacion ): int {
		global $wpdb;

		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value > 0",
				self::META_USD
			)
		);

		$n = 0;

		foreach ( $ids as $id ) {
			$p = wc_get_product( (int) $id );
			if ( ! $p ) {
				continue;
			}

			$usd = (float) $p->get_meta( self::META_USD );
			if ( $usd <= 0 ) {
				continue;
			}

			$normal = self::redondear( $usd * $cotizacion );
			$p->set_regular_price( (string) $normal );

			$usd_oferta = (float) $p->get_meta( self::META_USD_OFERTA );
			if ( $usd_oferta > 0 && $usd_oferta < $usd ) {
				$p->set_sale_price( (string) self::redondear( $usd_oferta * $cotizacion ) );
			}

			$p->update_meta_data( self::META_COTIZACION, $cotizacion );
			$p->save();
			++$n;
		}

		return $n;
	}

	/**
	 * Redondeo al millar. Un precio de góndola no termina en 270.
	 */
	public static function redondear( float $ars ): int {
		if ( $ars <= 0 ) {
			return 0;
		}
		return (int) ( round( $ars / 1000 ) * 1000 );
	}

	/* ---------------------------------------------------------------------
	 * Estado
	 * ------------------------------------------------------------------ */

	/**
	 * @return array{venta:float,compra:float,fuente:string,ts:int}|null
	 */
	public function actual(): ?array {
		$v = get_option( self::OPT_ACTUAL );
		return ( is_array( $v ) && ! empty( $v['venta'] ) ) ? $v : null;
	}

	private function historial( array $nueva ): void {
		$h = get_option( self::OPT_HISTORIAL, array() );
		if ( ! is_array( $h ) ) {
			$h = array();
		}
		array_unshift( $h, $nueva );
		update_option( self::OPT_HISTORIAL, array_slice( $h, 0, 30 ), false );
	}

	private function registrar_fallo(): void {
		update_option( self::OPT_FALLOS, (int) get_option( self::OPT_FALLOS, 0 ) + 1, false );
	}

	private function resultado( bool $ok, string $msg, ?array $cot ): array {
		return array(
			'ok'         => $ok,
			'mensaje'    => $msg,
			'cotizacion' => $cot,
		);
	}

	/* ---------------------------------------------------------------------
	 * Editor de producto
	 * ------------------------------------------------------------------ */

	public function campos_producto(): void {
		echo '<div class="options_group show_if_simple show_if_external">';

		woocommerce_wp_text_input(
			array(
				'id'          => self::META_USD,
				'label'       => 'Precio en dólares (USD)',
				'desc_tip'    => true,
				'description' => 'Si cargás un valor acá, el precio en pesos se calcula solo con el dólar blue de Córdoba y se sobrescribe en cada actualización. Dejalo vacío para fijar el precio en pesos a mano.',
				'type'        => 'text',
				'data_type'   => 'decimal',
			)
		);

		woocommerce_wp_text_input(
			array(
				'id'          => self::META_USD_OFERTA,
				'label'       => 'Precio de oferta en USD',
				'desc_tip'    => true,
				'description' => 'Opcional. Debe ser menor que el precio en dólares.',
				'type'        => 'text',
				'data_type'   => 'decimal',
			)
		);

		$c = $this->actual();
		if ( $c ) {
			printf(
				'<p class="form-field"><span style="color:#666">Cotización vigente: <strong>$%s</strong> (%s, %s)</span></p>',
				esc_html( number_format( $c['venta'], 2, ',', '.' ) ),
				esc_html( $c['fuente'] ),
				esc_html( wp_date( 'd/m/Y H:i', $c['ts'] ) )
			);
		}

		echo '</div>';
	}

	/**
	 * @param WC_Product $product Producto.
	 */
	public function guardar_producto( $product ): void {
		$usd    = isset( $_POST[ self::META_USD ] ) ? wc_format_decimal( wp_unslash( $_POST[ self::META_USD ] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$oferta = isset( $_POST[ self::META_USD_OFERTA ] ) ? wc_format_decimal( wp_unslash( $_POST[ self::META_USD_OFERTA ] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification

		$product->update_meta_data( self::META_USD, $usd );
		$product->update_meta_data( self::META_USD_OFERTA, $oferta );

		// Si se cargó un precio en dólares, el precio en pesos se recalcula ya
		// mismo: sería confuso guardar y ver el valor viejo.
		$c = $this->actual();
		if ( $usd && (float) $usd > 0 && $c ) {
			$product->set_regular_price( (string) self::redondear( (float) $usd * $c['venta'] ) );
			if ( $oferta && (float) $oferta > 0 && (float) $oferta < (float) $usd ) {
				$product->set_sale_price( (string) self::redondear( (float) $oferta * $c['venta'] ) );
			}
			$product->update_meta_data( self::META_COTIZACION, $c['venta'] );
		}
	}

	/* ---------------------------------------------------------------------
	 * Frente
	 * ------------------------------------------------------------------ */

	/**
	 * Agrega la referencia en dólares debajo del precio.
	 *
	 * Se engancha al precio y no a `woocommerce_single_product_summary`
	 * a propósito: el tema propio arma el resumen a mano y no dispara ese
	 * hook. Filtrando el precio funciona con cualquier tema.
	 *
	 * El importe final va en pesos —es lo que corresponde mostrarle al
	 * consumidor— y el dólar queda como dato de contexto.
	 *
	 * @param string     $html    Precio ya formateado.
	 * @param WC_Product $product Producto.
	 * @return string
	 */
	public function referencia_usd( string $html, $product ): string {
		if ( is_admin() || ! $product instanceof WC_Product ) {
			return $html;
		}

		// Solo en la ficha: en el catálogo ensuciaría cada tarjeta.
		if ( ! function_exists( 'is_product' ) || ! is_product() || get_queried_object_id() !== $product->get_id() ) {
			return $html;
		}

		$usd = (float) $product->get_meta( self::META_USD );
		if ( $usd <= 0 ) {
			return $html;
		}

		$c = $this->actual();
		if ( ! $c ) {
			return $html;
		}

		return $html . sprintf(
			'<span class="producto__usd" style="display:block;margin-top:.35rem;font-family:var(--f-mono,monospace);font-size:.8125rem;font-weight:400;color:var(--li-text-mudo,#6b6b6b)">USD %s · cotización $%s del %s</span>',
			esc_html( number_format( $usd, 2, ',', '.' ) ),
			esc_html( number_format( $c['venta'], 2, ',', '.' ) ),
			esc_html( wp_date( 'd/m/Y H:i', $c['ts'] ) )
		);
	}

	/* ---------------------------------------------------------------------
	 * Escritorio
	 * ------------------------------------------------------------------ */

	public function menu(): void {
		add_submenu_page(
			'woocommerce',
			'Cotización del dólar',
			'Cotización',
			'manage_woocommerce',
			'li-cotizacion',
			array( $this, 'pantalla' )
		);
	}

	public function pantalla(): void {
		$c = $this->actual();
		$h = get_option( self::OPT_HISTORIAL, array() );
		$n = (int) $GLOBALS['wpdb']->get_var(
			$GLOBALS['wpdb']->prepare(
				"SELECT COUNT(*) FROM {$GLOBALS['wpdb']->postmeta} WHERE meta_key = %s AND meta_value > 0",
				self::META_USD
			)
		);

		echo '<div class="wrap"><h1>Cotización del dólar</h1>';

		if ( $c ) {
			printf(
				'<p style="font-size:1.5em">Blue Córdoba, venta: <strong>$%s</strong></p><p>Fuente: %s · Actualizado: %s · <strong>%d</strong> productos con precio en dólares.</p>',
				esc_html( number_format( $c['venta'], 2, ',', '.' ) ),
				esc_html( $c['fuente'] ),
				esc_html( wp_date( 'd/m/Y H:i', $c['ts'] ) ),
				$n
			);
		} else {
			echo '<p>Todavía no se obtuvo ninguna cotización.</p>';
		}

		printf(
			'<form method="post" action="%s"><input type="hidden" name="action" value="li_cotizacion_actualizar">%s<p><button class="button button-primary">Actualizar ahora</button></p></form>',
			esc_url( admin_url( 'admin-post.php' ) ),
			wp_nonce_field( 'li_cotizacion', '_wpnonce', true, false )
		);

		echo '<h2>Próximas ejecuciones</h2><ul>';
		foreach ( array( self::HOOK_MANANA => 'Mañana (9:00)', self::HOOK_TARDE => 'Tarde (17:00)' ) as $hook => $etq ) {
			$ts = wp_next_scheduled( $hook );
			printf( '<li>%s: %s</li>', esc_html( $etq ), $ts ? esc_html( wp_date( 'd/m/Y H:i', $ts ) ) : 'sin programar' );
		}
		echo '</ul>';

		if ( is_array( $h ) && $h ) {
			echo '<h2>Historial</h2><table class="widefat striped" style="max-width:640px"><thead><tr><th>Fecha</th><th>Venta</th><th>Fuente</th></tr></thead><tbody>';
			foreach ( array_slice( $h, 0, 15 ) as $e ) {
				printf(
					'<tr><td>%s</td><td>$%s</td><td>%s</td></tr>',
					esc_html( wp_date( 'd/m/Y H:i', $e['ts'] ) ),
					esc_html( number_format( $e['venta'], 2, ',', '.' ) ),
					esc_html( $e['fuente'] )
				);
			}
			echo '</tbody></table>';
		}

		echo '</div>';
	}

	public function accion_actualizar(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) || ! check_admin_referer( 'li_cotizacion' ) ) {
			wp_die( 'Sin permisos.' );
		}

		$r = $this->tarea( true );

		wp_safe_redirect(
			add_query_arg(
				array(
					'page'       => 'li-cotizacion',
					'li_ok'      => $r['ok'] ? '1' : '0',
					'li_mensaje' => rawurlencode( $r['mensaje'] ),
				),
				admin_url( 'admin.php' )
			)
		);
		exit;
	}

	public function aviso_fallos(): void {
		$f = (int) get_option( self::OPT_FALLOS, 0 );

		if ( isset( $_GET['li_mensaje'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			printf(
				'<div class="notice notice-%s is-dismissible"><p>%s</p></div>',
				empty( $_GET['li_ok'] ) ? 'error' : 'success', // phpcs:ignore WordPress.Security.NonceVerification
				esc_html( rawurldecode( sanitize_text_field( wp_unslash( $_GET['li_mensaje'] ) ) ) ) // phpcs:ignore WordPress.Security.NonceVerification
			);
		}

		if ( $f >= 3 && current_user_can( 'manage_woocommerce' ) ) {
			printf(
				'<div class="notice notice-warning"><p><strong>Cotización:</strong> InfoDolar falló %d veces seguidas. Se está usando el respaldo (blue nacional), que difiere alrededor de un 1%% del de Córdoba. Puede que hayan cambiado su HTML.</p></div>',
				$f
			);
		}
	}
}

Lucas_Cotizacion::init();
