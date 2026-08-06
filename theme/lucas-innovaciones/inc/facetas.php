<?php
/**
 * Filtros por característica.
 *
 * Cada atributo se ofrece sólo donde tiene al menos dos valores distintos
 * entre los resultados actuales, que es como se comporta Mercado Libre: un
 * filtro con una sola opción no filtra nada y sólo hace ruido.
 *
 * Las cuentas de cada opción se calculan contra los resultados filtrados por
 * todo *menos* ese mismo atributo. Si se contaran contra el resultado final,
 * al elegir "128GB" la lista de capacidades quedaría con una sola opción y no
 * habría forma de sumar "256GB" sin antes sacar la primera.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/**
 * Atributos globales disponibles, en el orden en que se muestran.
 *
 * @return array<string,string> Taxonomía => etiqueta.
 */
function li_atributos(): array {
	$out = array();

	foreach ( wc_get_attribute_taxonomies() as $a ) {
		$out[ wc_attribute_taxonomy_name( $a->attribute_name ) ] = $a->attribute_label ? $a->attribute_label : $a->attribute_name;
	}

	return $out;
}

/**
 * Nombre corto del parámetro en la URL: `pa_condicion` viaja como `condicion`.
 *
 * @param string $tax Taxonomía del atributo.
 * @return string
 */
function li_attr_param( string $tax ): string {
	return str_replace( 'pa_', '', $tax );
}

/**
 * Atributos seleccionados, leídos de la URL.
 *
 * @return array<string,string[]> Taxonomía => slugs.
 */
function li_filtro_atributos(): array {
	$out = array();

	foreach ( array_keys( li_atributos() ) as $tax ) {
		$param = li_attr_param( $tax );

		if ( empty( $_GET[ $param ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			continue;
		}

		$crudo = sanitize_text_field( wp_unslash( $_GET[ $param ] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$slugs = array_values( array_unique( array_filter( array_map( 'sanitize_title', explode( ',', $crudo ) ) ) ) );

		if ( $slugs ) {
			$out[ $tax ] = $slugs;
		}
	}

	return $out;
}

/**
 * URL base del listado en el que estamos.
 *
 * @return string
 */
function li_url_listado(): string {
	// La búsqueda no vive en una página: es la raíz con `s` y `post_type`,
	// que agrega li_args_base().
	if ( is_search() ) {
		return home_url( '/' );
	}

	$obj = get_queried_object();

	if ( $obj instanceof WP_Term ) {
		$url = get_term_link( $obj );
		return is_string( $url ) ? $url : home_url( '/' );
	}

	return (string) wc_get_page_permalink( 'shop' );
}

/**
 * Lo que todo enlace del listado tiene que arrastrar sí o sí.
 *
 * En una categoría no hace falta nada: la categoría está en la ruta. En una
 * búsqueda, en cambio, el término vive en la URL, y si un filtro no lo copia
 * el visitante pierde lo que buscó al tocar una marca.
 *
 * @return array<string,string>
 */
function li_args_base(): array {
	if ( ! is_search() ) {
		return array();
	}

	return array(
		's'         => get_search_query( false ),
		'post_type' => 'product',
	);
}

/**
 * Arma la URL del listado con un juego completo de filtros.
 *
 * @param string[]               $marcas     Slugs de marca.
 * @param array<string,string[]> $atributos  Taxonomía => slugs.
 * @param array|null             $precio     Rango; `null` conserva el puesto.
 * @return string
 */
function li_url_con( array $marcas, array $atributos, ?array $precio = null ): string {
	$args = li_args_base();

	if ( $marcas ) {
		$args['marca'] = implode( ',', $marcas );
	}

	foreach ( $atributos as $tax => $slugs ) {
		if ( $slugs ) {
			$args[ li_attr_param( $tax ) ] = implode( ',', $slugs );
		}
	}

	// Tocar una marca o una característica no debe tirar el precio elegido:
	// sin rango explícito se arrastra el que ya estaba.
	$rango = null === $precio ? li_filtro_precio() : $precio;

	if ( isset( $rango['min'] ) ) {
		$args['precio_min'] = (string) (int) $rango['min'];
	}
	if ( isset( $rango['max'] ) ) {
		$args['precio_max'] = (string) (int) $rango['max'];
	}

	// El orden elegido sobrevive a cualquier cambio de filtro.
	$orden = isset( $_GET['orderby'] ) ? sanitize_text_field( wp_unslash( $_GET['orderby'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	if ( $orden && 'menu_order' !== $orden ) {
		$args['orderby'] = $orden;
	}

	$url = li_url_listado();

	return $args ? add_query_arg( $args, $url ) : $url;
}

/**
 * URL que resulta de encender o apagar un valor de atributo.
 *
 * @param string $tax  Taxonomía del atributo.
 * @param string $slug Valor a alternar.
 * @return string
 */
function li_url_alternar_atributo( string $tax, string $slug ): string {
	$sel     = li_filtro_atributos();
	$actual  = $sel[ $tax ] ?? array();

	$nuevos = in_array( $slug, $actual, true )
		? array_values( array_diff( $actual, array( $slug ) ) )
		: array_merge( $actual, array( $slug ) );

	if ( $nuevos ) {
		$sel[ $tax ] = $nuevos;
	} else {
		unset( $sel[ $tax ] );
	}

	return li_url_con( li_filtro_marcas(), $sel );
}

/**
 * Identificadores de los productos que quedan con un juego de atributos dado.
 *
 * Respeta la categoría, la marca y la búsqueda en curso. Se memoriza por
 * combinación porque `li_facetas()` la pide una vez por atributo y, sin
 * filtros puestos, todas esas veces piden exactamente lo mismo.
 *
 * @param array<string,string[]> $atributos Taxonomía => slugs.
 * @param array|null             $precio    Rango; `null` usa el puesto.
 * @param string[]|null          $marcas    Marcas; `null` usa las puestas.
 * @return int[]
 */
function li_ids_contexto( array $atributos, ?array $precio = null, ?array $marcas = null ): array {
	static $memoria = array();

	$rango  = null === $precio ? li_filtro_precio() : $precio;
	$marcas = null === $marcas ? li_filtro_marcas() : $marcas;
	$clave  = md5( (string) wp_json_encode( array( $atributos, $rango, $marcas ) ) );
	if ( isset( $memoria[ $clave ] ) ) {
		return $memoria[ $clave ];
	}

	$tax_query = array(
		'relation' => 'AND',
		array(
			'taxonomy' => 'product_visibility',
			'field'    => 'slug',
			'terms'    => 'exclude-from-catalog',
			'operator' => 'NOT IN',
		),
	);

	$obj = get_queried_object();
	if ( $obj instanceof WP_Term ) {
		$tax_query[] = array(
			'taxonomy'         => $obj->taxonomy,
			'field'            => 'term_id',
			'terms'            => $obj->term_id,
			'include_children' => true,
		);
	}

	if ( $marcas ) {
		$tax_query[] = array(
			'taxonomy' => 'product_brand',
			'field'    => 'slug',
			'terms'    => $marcas,
		);
	}

	foreach ( $atributos as $tax => $slugs ) {
		if ( $slugs ) {
			$tax_query[] = array(
				'taxonomy' => $tax,
				'field'    => 'slug',
				'terms'    => $slugs,
			);
		}
	}

	$args = array(
		'post_type'      => 'product',
		'post_status'    => 'publish',
		'posts_per_page' => -1,
		'fields'         => 'ids',
		'no_found_rows'  => true,
		'tax_query'      => $tax_query, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
		'li_precio'      => $rango,
	);

	if ( is_search() ) {
		$args['s'] = get_search_query();
	}

	$q = new WP_Query( $args );

	$memoria[ $clave ] = array_map( 'absint', $q->posts );

	return $memoria[ $clave ];
}

/**
 * Cuenta los valores de atributo presentes en un conjunto de productos.
 *
 * @param int[] $ids Identificadores de producto.
 * @return array<string,array<string,array<string,mixed>>> Taxonomía => slug => datos.
 */
function li_conteo_atributos( array $ids ): array {
	if ( ! $ids ) {
		return array();
	}

	global $wpdb;

	$lista = implode( ',', array_map( 'absint', $ids ) );
	$taxes = array_keys( li_atributos() );

	if ( ! $taxes ) {
		return array();
	}

	$in = "'" . implode( "','", array_map( 'esc_sql', $taxes ) ) . "'";

	$filas = $wpdb->get_results(
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		"SELECT tt.taxonomy, t.name, t.slug, COUNT(DISTINCT tr.object_id) AS n
		 FROM {$wpdb->term_relationships} tr
		 JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
		 JOIN {$wpdb->terms} t ON t.term_id = tt.term_id
		 WHERE tt.taxonomy IN ({$in}) AND tr.object_id IN ({$lista})
		 GROUP BY tt.taxonomy, t.name, t.slug
		 ORDER BY n DESC, t.name ASC",
		// phpcs:enable
		ARRAY_A
	);

	$out = array();
	foreach ( $filas as $f ) {
		$out[ $f['taxonomy'] ][ $f['slug'] ] = array(
			'nombre' => $f['name'],
			'cuenta' => (int) $f['n'],
		);
	}

	return $out;
}

/**
 * Facetas a mostrar: atributo, sus valores y cuántos productos deja cada uno.
 *
 * @return array<string,array<string,mixed>>
 */
function li_facetas(): array {
	$seleccion = li_filtro_atributos();
	$out       = array();

	foreach ( li_atributos() as $tax => $label ) {
		// Todo lo puesto menos este mismo atributo.
		$otros = $seleccion;
		unset( $otros[ $tax ] );

		$conteo = li_conteo_atributos( li_ids_contexto( $otros ) );
		$vals   = $conteo[ $tax ] ?? array();

		if ( count( $vals ) < 2 ) {
			continue;
		}

		$activos = $seleccion[ $tax ] ?? array();
		$ops     = array();

		foreach ( $vals as $slug => $v ) {
			$ops[] = array(
				'nombre' => $v['nombre'],
				'slug'   => $slug,
				'cuenta' => $v['cuenta'],
				'activo' => in_array( $slug, $activos, true ),
				'url'    => li_url_alternar_atributo( $tax, $slug ),
			);
		}

		$out[ $tax ] = array(
			'label'    => $label,
			'opciones' => $ops,
		);
	}

	return $out;
}

/**
 * Dibuja el panel de filtros por característica.
 *
 * Son enlaces, no casillas: sin JavaScript filtran igual, recargando.
 */
function li_panel_filtros(): void {
	// El precio va primero porque es el filtro que más se toca, y porque no
	// depende de que el producto tenga atributos cargados: está siempre.
	li_panel_precio();

	foreach ( li_facetas() as $tax => $f ) :
		?>
		<section class="filtro">
			<h2 class="filtro__titulo"><?php echo esc_html( $f['label'] ); ?></h2>

			<ul class="faceta">
				<?php foreach ( $f['opciones'] as $op ) : ?>
					<li>
						<a
							class="faceta__op<?php echo $op['activo'] ? ' es-activa' : ''; ?>"
							href="<?php echo esc_url( $op['url'] ); ?>"
							aria-pressed="<?php echo $op['activo'] ? 'true' : 'false'; ?>"
							data-li-filtro
						>
							<span class="faceta__caja" aria-hidden="true"></span>
							<span class="faceta__nombre"><?php echo esc_html( $op['nombre'] ); ?></span>
							<span class="count"><?php echo esc_html( (string) $op['cuenta'] ); ?></span>
						</a>
					</li>
				<?php endforeach; ?>
			</ul>
		</section>
		<?php
	endforeach;
}

/**
 * Fichas de los atributos puestos, para la barra de filtros activos.
 */
function li_fichas_atributos(): void {
	$sel = li_filtro_atributos();

	if ( ! $sel ) {
		return;
	}

	foreach ( $sel as $tax => $slugs ) {
		foreach ( $slugs as $slug ) {
			$t = get_term_by( 'slug', $slug, $tax );
			if ( ! $t ) {
				continue;
			}
			printf(
				'<a class="activo" href="%s" data-li-filtro>%s%s</a>',
				esc_url( li_url_alternar_atributo( $tax, $slug ) ),
				esc_html( $t->name ),
				'<svg class="icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
			);
		}
	}
}
