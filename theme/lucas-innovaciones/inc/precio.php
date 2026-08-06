<?php
/**
 * Filtro por precio.
 *
 * Viaja en la URL como `?precio_min=10000&precio_max=50000`, con cualquiera
 * de los dos extremos opcional. Son dos parámetros y no uno solo para que el
 * formulario de mínimo y máximo funcione sin JavaScript: un `<form method=get>`
 * manda un campo por caja, y así lo que escribe el visitante ya es la URL.
 *
 * El corte no se hace contra el metadato `_price` sino contra la tabla de
 * consulta de WooCommerce, que guarda `min_price` y `max_price` por producto.
 * Es la única forma de que un producto variable con precios de 30.000 a 90.000
 * aparezca al pedir "hasta 50.000": lo que importa es si el rango del producto
 * se cruza con el pedido, no un precio único que en un variable no existe.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/* -------------------------------------------------------------------------
   Estado del filtro
   ------------------------------------------------------------------------- */

/**
 * Rango pedido en la URL.
 *
 * @return array{min:float|null,max:float|null}
 */
function li_filtro_precio(): array {
	$leer = static function ( string $clave ): ?float {
		if ( ! isset( $_GET[ $clave ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return null;
		}

		$crudo = trim( sanitize_text_field( wp_unslash( $_GET[ $clave ] ) ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		if ( '' === $crudo || ! is_numeric( $crudo ) ) {
			return null;
		}

		$v = (float) $crudo;

		return $v >= 0 ? $v : null;
	};

	$min = $leer( 'precio_min' );
	$max = $leer( 'precio_max' );

	// Escritos al revés se entienden igual: se dan vuelta y listo.
	if ( null !== $min && null !== $max && $min > $max ) {
		return array(
			'min' => $max,
			'max' => $min,
		);
	}

	return array(
		'min' => $min,
		'max' => $max,
	);
}

/**
 * Rango sin límites, para pedir un listado sin filtrar por precio.
 *
 * @return array{min:null,max:null}
 */
function li_precio_vacio(): array {
	return array(
		'min' => null,
		'max' => null,
	);
}

/**
 * ¿El rango recorta algo?
 *
 * @param array $rango Rango a mirar.
 * @return bool
 */
function li_hay_precio( array $rango ): bool {
	// Se pregunta por el valor y no por la clave: `isset()` sobre un nulo da
	// falso, y un rango con un solo extremo tiene el otro justamente en nulo.
	return null !== ( $rango['min'] ?? null ) || null !== ( $rango['max'] ?? null );
}

add_filter( 'posts_clauses', 'li_precio_clausulas', 10, 2 );
/**
 * Aplica el rango a cualquier consulta que lo lleve en `li_precio`.
 *
 * Va por `posts_clauses` y no por `meta_query` porque hace falta cruzar dos
 * columnas de la tabla de consulta, y porque el JOIN es uno a uno: no duplica
 * filas ni obliga a un `DISTINCT`.
 *
 * El alias tiene que ser `wc_product_meta_lookup` y no uno propio: cuando se
 * ordena por precio, WooCommerce mira si el JOIN ya nombra esa tabla y, si la
 * encuentra, no agrega el suyo —pero igual ordena por ese alias—. Con un alias
 * distinto la consulta quedaba pidiendo una tabla que no existía y el listado
 * salía vacío. Por eso también el JOIN es `LEFT` y se agrega una sola vez.
 *
 * @param string[] $clauses Cláusulas de la consulta.
 * @param WP_Query $q       Consulta.
 * @return string[]
 */
function li_precio_clausulas( array $clauses, WP_Query $q ): array {
	$rango = $q->get( 'li_precio' );

	if ( ! is_array( $rango ) || ! li_hay_precio( $rango ) ) {
		return $clauses;
	}

	global $wpdb;

	if ( ! strstr( $clauses['join'], 'wc_product_meta_lookup' ) ) {
		$clauses['join'] .= " LEFT JOIN {$wpdb->wc_product_meta_lookup} wc_product_meta_lookup ON {$wpdb->posts}.ID = wc_product_meta_lookup.product_id ";
	}

	// Se cruzan los rangos: el del producto y el pedido. Un producto sin
	// precio tiene NULL y queda afuera, que es lo correcto.
	if ( null !== $rango['min'] ) {
		$clauses['where'] .= $wpdb->prepare( ' AND wc_product_meta_lookup.max_price >= %f ', $rango['min'] );
	}

	if ( null !== $rango['max'] ) {
		$clauses['where'] .= $wpdb->prepare( ' AND wc_product_meta_lookup.min_price <= %f ', $rango['max'] );
	}

	return $clauses;
}

/* -------------------------------------------------------------------------
   Tramos sugeridos
   ------------------------------------------------------------------------- */

/**
 * Precios de un conjunto de productos.
 *
 * @param int[] $ids Identificadores de producto.
 * @return array<int,array{min:float,max:float}>
 */
function li_precios_contexto( array $ids ): array {
	if ( ! $ids ) {
		return array();
	}

	global $wpdb;

	$lista = implode( ',', array_map( 'absint', $ids ) );

	$filas = $wpdb->get_results(
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		"SELECT min_price, max_price
		 FROM {$wpdb->wc_product_meta_lookup}
		 WHERE product_id IN ({$lista}) AND min_price IS NOT NULL",
		// phpcs:enable
		ARRAY_A
	);

	$out = array();
	foreach ( $filas as $f ) {
		$out[] = array(
			'min' => (float) $f['min_price'],
			'max' => (float) $f['max_price'],
		);
	}

	return $out;
}

/**
 * Redondea a una cifra que se pueda leer de un vistazo.
 *
 * 341.200 no es un borde: 350.000 sí. Se redondea a la mitad de la potencia
 * de diez más cercana, que da siempre pasos de 1, 1,5, 2, 2,5… por magnitud.
 *
 * @param float $v Valor.
 * @return float
 */
function li_precio_redondo( float $v ): float {
	if ( $v <= 0 ) {
		return 0.0;
	}

	$paso = pow( 10, floor( log10( $v ) ) ) / 2;

	return max( $paso, round( $v / $paso ) * $paso );
}

/**
 * Cuántos productos del conjunto caen en un rango.
 *
 * @param array<int,array{min:float,max:float}> $filas Precios.
 * @param float|null                            $min   Piso.
 * @param float|null                            $max   Techo.
 * @return int
 */
function li_contar_rango( array $filas, ?float $min, ?float $max ): int {
	$n = 0;

	foreach ( $filas as $f ) {
		if ( null !== $min && $f['max'] < $min ) {
			continue;
		}
		if ( null !== $max && $f['min'] > $max ) {
			continue;
		}
		++$n;
	}

	return $n;
}

/**
 * Tramos a ofrecer, con su cuenta y su enlace.
 *
 * Los bordes salen de los tercios del propio catálogo que se está mirando,
 * no de una tabla fija: en fundas los tramos caen en miles y en televisores
 * en cientos de miles, sin que nadie configure nada.
 *
 * @return array<int,array<string,mixed>>
 */
function li_tramos_precio(): array {
	static $memoria = null;

	if ( null !== $memoria ) {
		return $memoria;
	}

	$memoria = array();

	// Las cuentas van contra todo lo filtrado *menos* el precio, igual que
	// en el resto de las facetas: si no, elegir un tramo borraría los otros.
	$filas = li_precios_contexto( li_ids_contexto( li_filtro_atributos(), li_precio_vacio() ) );

	if ( count( $filas ) < 4 ) {
		return $memoria;
	}

	$mins = array();
	foreach ( $filas as $f ) {
		$mins[] = $f['min'];
	}
	sort( $mins, SORT_NUMERIC );

	$n  = count( $mins );
	$a  = li_precio_redondo( $mins[ (int) floor( $n * 0.33 ) ] );
	$b  = li_precio_redondo( $mins[ (int) floor( $n * 0.66 ) ] );
	$b  = $b > $a ? $b : 0.0;

	$rangos = array();

	if ( $a > 0 && $a < (float) end( $mins ) ) {
		$rangos[] = array( null, $a );
	}
	if ( $a > 0 && $b > 0 ) {
		$rangos[] = array( $a, $b );
	}
	if ( $b > 0 ) {
		$rangos[] = array( $b, null );
	} elseif ( $a > 0 ) {
		$rangos[] = array( $a, null );
	}

	if ( count( $rangos ) < 2 ) {
		return $memoria;
	}

	$actual = li_filtro_precio();

	foreach ( $rangos as $r ) {
		$cuenta = li_contar_rango( $filas, $r[0], $r[1] );

		if ( ! $cuenta ) {
			continue;
		}

		$activo = $actual['min'] === $r[0] && $actual['max'] === $r[1];

		$memoria[] = array(
			'min'    => $r[0],
			'max'    => $r[1],
			'texto'  => li_precio_texto( $r[0], $r[1] ),
			'cuenta' => $cuenta,
			'activo' => $activo,
			// Volver a tocar el tramo puesto lo saca, como cualquier faceta.
			'url'    => li_url_con(
				li_filtro_marcas(),
				li_filtro_atributos(),
				$activo ? li_precio_vacio() : array(
					'min' => $r[0],
					'max' => $r[1],
				)
			),
		);
	}

	if ( count( $memoria ) < 2 ) {
		$memoria = array();
	}

	return $memoria;
}

/* -------------------------------------------------------------------------
   Presentación
   ------------------------------------------------------------------------- */

/**
 * Un importe con el formato de la tienda, sin centavos ni etiquetas.
 *
 * @param float $v Importe.
 * @return string
 */
function li_precio_fmt( float $v ): string {
	return wp_strip_all_tags( wc_price( $v, array( 'decimals' => 0 ) ) );
}

/**
 * Cómo se nombra un rango.
 *
 * @param float|null $min Piso.
 * @param float|null $max Techo.
 * @return string
 */
function li_precio_texto( ?float $min, ?float $max ): string {
	if ( null === $min && null === $max ) {
		return '';
	}

	if ( null === $min ) {
		/* translators: %s: importe */
		return sprintf( __( 'Hasta %s', 'lucasinnovaciones' ), li_precio_fmt( (float) $max ) );
	}

	if ( null === $max ) {
		/* translators: %s: importe */
		return sprintf( __( 'Desde %s', 'lucasinnovaciones' ), li_precio_fmt( $min ) );
	}

	/* translators: 1: importe mínimo, 2: importe máximo */
	return sprintf( __( '%1$s a %2$s', 'lucasinnovaciones' ), li_precio_fmt( $min ), li_precio_fmt( (float) $max ) );
}

/**
 * Campos que el formulario de precio tiene que arrastrar para no perder
 * el resto de los filtros al enviarse.
 */
function li_campos_ocultos(): void {
	$campos = array();

	$marcas = li_filtro_marcas();
	if ( $marcas ) {
		$campos['marca'] = implode( ',', $marcas );
	}

	foreach ( li_filtro_atributos() as $tax => $slugs ) {
		$campos[ li_attr_param( $tax ) ] = implode( ',', $slugs );
	}

	$orden = isset( $_GET['orderby'] ) ? sanitize_text_field( wp_unslash( $_GET['orderby'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	if ( $orden && 'menu_order' !== $orden ) {
		$campos['orderby'] = $orden;
	}

	// En la búsqueda la acción del formulario es la raíz, así que los
	// términos buscados tienen que viajar como campos.
	if ( is_search() ) {
		$campos['s']         = get_search_query();
		$campos['post_type'] = 'product';
	}

	foreach ( $campos as $k => $v ) {
		printf( '<input type="hidden" name="%s" value="%s">', esc_attr( $k ), esc_attr( $v ) );
	}
}

/**
 * Dibuja la faceta de precio: tramos sugeridos y cajas de mínimo y máximo.
 */
function li_panel_precio(): void {
	$tramos = li_tramos_precio();
	$actual = li_filtro_precio();

	if ( ! $tramos ) {
		return;
	}

	$accion = is_search() ? home_url( '/' ) : li_url_listado();
	?>
	<section class="filtro">
		<h2 class="filtro__titulo"><?php esc_html_e( 'Precio', 'lucasinnovaciones' ); ?></h2>

		<ul class="faceta">
			<?php foreach ( $tramos as $t ) : ?>
				<li>
					<a
						class="faceta__op<?php echo $t['activo'] ? ' es-activa' : ''; ?>"
						href="<?php echo esc_url( $t['url'] ); ?>"
						aria-pressed="<?php echo $t['activo'] ? 'true' : 'false'; ?>"
						data-li-filtro
					>
						<span class="faceta__caja" aria-hidden="true"></span>
						<span class="faceta__nombre"><?php echo esc_html( $t['texto'] ); ?></span>
						<span class="count"><?php echo esc_html( (string) $t['cuenta'] ); ?></span>
					</a>
				</li>
			<?php endforeach; ?>
		</ul>

		<form class="precio" method="get" action="<?php echo esc_url( $accion ); ?>" data-li-precio>
			<?php li_campos_ocultos(); ?>

			<label class="precio__campo">
				<span class="visually-hidden"><?php esc_html_e( 'Precio mínimo', 'lucasinnovaciones' ); ?></span>
				<input
					type="number"
					name="precio_min"
					inputmode="numeric"
					min="0"
					step="1"
					placeholder="<?php esc_attr_e( 'Mínimo', 'lucasinnovaciones' ); ?>"
					value="<?php echo null === $actual['min'] ? '' : esc_attr( (string) (int) $actual['min'] ); ?>"
				>
			</label>

			<span class="precio__guion" aria-hidden="true">–</span>

			<label class="precio__campo">
				<span class="visually-hidden"><?php esc_html_e( 'Precio máximo', 'lucasinnovaciones' ); ?></span>
				<input
					type="number"
					name="precio_max"
					inputmode="numeric"
					min="0"
					step="1"
					placeholder="<?php esc_attr_e( 'Máximo', 'lucasinnovaciones' ); ?>"
					value="<?php echo null === $actual['max'] ? '' : esc_attr( (string) (int) $actual['max'] ); ?>"
				>
			</label>

			<button class="precio__ir" type="submit">
				<span class="visually-hidden"><?php esc_html_e( 'Aplicar', 'lucasinnovaciones' ); ?></span>
				<?php li_icono( 'chevron-der' ); ?>
			</button>
		</form>
	</section>
	<?php
}

/**
 * Ficha del precio puesto, para la barra de filtros activos.
 */
function li_ficha_precio(): void {
	$r = li_filtro_precio();

	if ( ! li_hay_precio( $r ) ) {
		return;
	}
	?>
	<a
		class="activo"
		href="<?php echo esc_url( li_url_con( li_filtro_marcas(), li_filtro_atributos(), li_precio_vacio() ) ); ?>"
		data-li-filtro
	>
		<?php echo esc_html( li_precio_texto( $r['min'], $r['max'] ) ); ?>
		<?php li_icono( 'cerrar' ); ?>
	</a>
	<?php
}
