<?php
/**
 * Celulares: filtros que salen del nombre y "otras unidades de este modelo".
 *
 * Los celulares están cargados como productos simples, uno por equipo —cada
 * usado es único, con su IMEI y su batería— y sin atributos: el modelo, la
 * capacidad y la batería viven en el nombre ("iPhone 13 Pro 128gb 87%").
 * Pasarlos a variables rompería el POS, que vende contra estos mismos
 * productos, así que se leen del nombre, en código, sin escribir nada.
 *
 * Las facetas se enchufan a la lógica de inc/facetas.php como "atributos
 * virtuales" (clave `cel_*`): viajan solas en las URLs, el AJAX, la barra de
 * filtros activos y el formulario de precio. Solo aparecen en Smartphones.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

const LI_CEL_CAT = 'smartphones';

/**
 * Facetas virtuales, en el orden en que se muestran. La clave sin `cel_` es
 * el parámetro de la URL (?modelo=…&capacidad=…).
 *
 * @return array<string,string>
 */
function li_cel_facetas(): array {
	return array(
		'cel_modelo'    => 'Modelo',
		'cel_capacidad' => 'Almacenamiento',
		'cel_estado'    => 'Estado',
		'cel_bateria'   => 'Batería',
	);
}

/**
 * ¿Es una faceta virtual de celulares?
 *
 * @param string $tax Clave.
 */
function li_cel_es_virtual( string $tax ): bool {
	return str_starts_with( $tax, 'cel_' );
}

/**
 * Separa una selección en atributos reales y virtuales.
 *
 * @param array<string,string[]> $sel Clave => slugs.
 * @return array{0:array<string,string[]>,1:array<string,string[]>}
 */
function li_cel_separar( array $sel ): array {
	$reales    = array();
	$virtuales = array();
	foreach ( $sel as $tax => $slugs ) {
		if ( li_cel_es_virtual( $tax ) ) {
			$virtuales[ $tax ] = $slugs;
		} else {
			$reales[ $tax ] = $slugs;
		}
	}
	return array( $reales, $virtuales );
}

/**
 * ¿El listado en curso es Smartphones o una de sus subcategorías?
 */
function li_cel_contexto(): bool {
	$obj = get_queried_object();
	if ( ! $obj instanceof WP_Term || 'product_cat' !== $obj->taxonomy ) {
		return false;
	}
	$raiz = get_term_by( 'slug', LI_CEL_CAT, 'product_cat' );

	return $raiz && ( (int) $obj->term_id === (int) $raiz->term_id || term_is_ancestor_of( $raiz, $obj, 'product_cat' ) );
}

/**
 * Lee modelo, capacidad, estado y batería del nombre de un celular.
 *
 * @param string $nombre Nombre tal cual está cargado.
 * @param int    $id     Producto (para saber si está en "usados").
 * @return array{modelo:string,gb:int,bateria:int|null,estado:string,f:array<string,array{0:string,1:string}>}
 */
function li_cel_datos( string $nombre, int $id ): array {
	$n = li_nombre_publico( $nombre );

	$bateria = preg_match( '/(\d{2,3})\s*%/', $n, $m ) ? (int) $m[1] : null;
	$sellado = (bool) preg_match( '/\bsellad[oa]\b/iu', $n );

	// La capacidad es el número de GB más grande: "8gb 256gb" es RAM y disco.
	$gb = 0;
	if ( preg_match_all( '/(\d+)\s*(gb|tb)\b/i', $n, $mm, PREG_SET_ORDER ) ) {
		foreach ( $mm as $x ) {
			$gb = max( $gb, (int) $x[1] * ( 'tb' === strtolower( $x[2] ) ? 1024 : 1 ) );
		}
	}
	if ( $gb < 32 ) {
		$gb = 0;
	}

	// Modelo: lo que va antes de la capacidad, sin batería, notas ni "5G".
	$modelo = (string) preg_replace( '/\([^)]*\)/u', ' ', $n );
	$modelo = (string) preg_replace( '/\b\d{2,3}\s*%|\b(sellad[oa]|usad[oa]|outlet|nuevo)\b/iu', ' ', $modelo );
	$modelo = preg_split( '/\s\d+\s*(?:gb|tb)\b/i', ' ' . $modelo )[0];
	$modelo = (string) preg_replace( '/\b[45]g\b/i', ' ', $modelo );
	$modelo = trim( (string) preg_replace( '/\s+/u', ' ', $modelo ) );
	$modelo = (string) preg_replace( '/^iphone\b/i', 'iPhone', $modelo );

	// Notas entre paréntesis que no son el IMEI, p. ej. "(Pant Original)".
	preg_match_all( '/\(([^)]*[^\d)\s][^)]*)\)/u', $n, $notas );
	// Las que llevan un monto son internas ("Rec en $367.000"): no se muestran.
	$nota = implode( ' · ', array_filter( array_map( 'trim', $notas[1] ), static fn( $x ) => ! str_contains( $x, '$' ) ) );

	// En los iPhone "sellado" y "nuevo" son lo mismo: un solo término, Nuevo.
	$estado = ! $sellado && ( null !== $bateria || li_es_usado( $id ) ) ? 'usado' : 'nuevo';

	$f = array();
	if ( '' !== $modelo ) {
		$f['cel_modelo'] = array( sanitize_title( $modelo ), $modelo );
	}
	if ( $gb ) {
		$f['cel_capacidad'] = $gb >= 1024
			? array( ( $gb / 1024 ) . 'tb', ( $gb / 1024 ) . ' TB' )
			: array( $gb . 'gb', $gb . ' GB' );
	}
	$f['cel_estado'] = array( $estado, ( 'usado' === $estado ? 'Usado' : 'Nuevo' ) );
	if ( null !== $bateria ) {
		$f['cel_bateria'] = $bateria >= 90
			? array( 'mas-de-90', '90% o más' )
			: ( $bateria >= 80 ? array( '80-a-89', '80% a 89%' ) : array( 'menos-de-80', 'Menos de 80%' ) );
	}

	return array(
		'modelo'  => $modelo,
		'gb'      => $gb,
		'bateria' => $bateria,
		'estado'  => $estado,
		'nota'    => $nota,
		'f'       => $f,
	);
}

/**
 * Datos de todos los celulares publicables. En caché, atada a la lista de
 * publicables: cuando entra o sale un equipo, se rearma sola.
 *
 * @return array<int,array<string,mixed>> ID => datos.
 */
function li_cel_mapa(): array {
	static $memoria = null;
	if ( null !== $memoria ) {
		return $memoria;
	}

	$huella = li_huella_publicables();
	$cache  = get_transient( 'li_cel_mapa' );
	if ( is_array( $cache ) && ( $cache['huella'] ?? '' ) === $huella ) {
		$memoria = $cache['mapa'];
		return $memoria;
	}

	$memoria = array();
	$raiz    = get_term_by( 'slug', LI_CEL_CAT, 'product_cat' );

	if ( $raiz ) {
		global $wpdb;
		$cats = implode( ',', li_rama_ids( $raiz ) );
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$filas = $wpdb->get_results(
			"SELECT DISTINCT p.ID, p.post_title, p.post_content, p.post_excerpt
			 FROM {$wpdb->posts} p
			 JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
			 JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_cat'
			 WHERE tt.term_id IN ({$cats}) AND p.post_type = 'product' AND p.post_status = 'publish'
			 " . li_sql_publicables( 'p.ID' )
		);
		// phpcs:enable
		$textos = array();
		foreach ( $filas as $r ) {
			$memoria[ (int) $r->ID ] = li_cel_datos( (string) $r->post_title, (int) $r->ID );
			$textos[ (int) $r->ID ]  = trim( wp_strip_all_tags( $r->post_content . ' ' . $r->post_excerpt ) );
		}

		// Una descripción repetida en varios equipos no describe a ninguno.
		$veces = array_count_values( array_map( 'md5', array_filter( $textos ) ) );
		foreach ( $textos as $id => $t ) {
			$memoria[ $id ]['desc_ok'] = '' !== $t
				&& 1 === ( $veces[ md5( $t ) ] ?? 0 )
				&& li_cel_desc_coincide( $t, $memoria[ $id ] );
		}
	}

	set_transient(
		'li_cel_mapa',
		array(
			'huella' => $huella,
			'mapa'   => $memoria,
		),
		6 * HOUR_IN_SECONDS
	);

	return $memoria;
}

/**
 * ¿La descripción cargada habla de este equipo? Muchas se copiaron de otro
 * producto: nombran otro modelo, dicen "nuevo" en un usado o dan otra batería.
 *
 * @param string $t Texto plano de la descripción.
 * @param array  $d Datos del equipo (li_cel_datos).
 */
function li_cel_desc_coincide( string $t, array $d ): bool {
	if ( preg_match_all( '/iPhone\s+\d+[a-z]?(?:\s+(?:Pro\s+Max|Pro|Plus|Max|Mini))?/iu', $t, $mm ) ) {
		foreach ( $mm[0] as $mencion ) {
			if ( 0 !== strcasecmp( (string) preg_replace( '/\s+/u', ' ', $mencion ), $d['modelo'] ) ) {
				return false;
			}
		}
	}
	if ( 'usado' === $d['estado'] && preg_match( '/(?<!casi )(?<!como )\bnuev[oa]s?\b|\bsellad[oa]\b/iu', $t ) ) {
		return false;
	}
	if ( preg_match_all( '/(\d{2,3})\s*%/', $t, $pp ) ) {
		foreach ( $pp[1] as $pct ) {
			if ( (int) $pct !== (int) $d['bateria'] ) {
				return false;
			}
		}
	}
	return true;
}

/**
 * Filas de "Especificaciones" de un celular, sacadas del nombre. Vacío si
 * el producto no es un celular publicado.
 *
 * @param int $id Producto.
 * @return array<int,array{0:string,1:string}>
 */
function li_cel_specs( int $id ): array {
	$d = li_cel_mapa()[ $id ] ?? null;
	if ( ! $d ) {
		return array();
	}
	$filas = array( array( 'Modelo', $d['modelo'] ) );
	if ( $d['gb'] ) {
		$filas[] = array( 'Almacenamiento', $d['f']['cel_capacidad'][1] );
	}
	$filas[] = array( 'Estado', $d['f']['cel_estado'][1] );
	if ( null !== $d['bateria'] ) {
		$filas[] = array( 'Salud de la batería', $d['bateria'] . '%' );
	}
	if ( '' !== $d['nota'] ) {
		$filas[] = array( 'Observaciones', $d['nota'] );
	}
	return $filas;
}

/**
 * ¿Se muestra la descripción cargada? En los celulares, solo si habla de este
 * equipo; en el resto de los productos, siempre.
 *
 * @param int $id Producto.
 */
function li_cel_desc_ok( int $id ): bool {
	$d = li_cel_mapa()[ $id ] ?? null;
	return ! $d || ! empty( $d['desc_ok'] );
}

// Un cambio de nombre no cambia la lista de publicables: se tira a mano.
add_action( 'woocommerce_update_product', static fn() => delete_transient( 'li_cel_mapa' ) );

/**
 * Productos que cumplen una selección de facetas virtuales.
 *
 * @param array<string,string[]> $sel Clave => slugs (solo virtuales).
 * @return int[]
 */
function li_cel_ids( array $sel ): array {
	$out = array();
	foreach ( li_cel_mapa() as $id => $d ) {
		foreach ( $sel as $tax => $slugs ) {
			$v = $d['f'][ $tax ][0] ?? null;
			if ( null === $v || ! in_array( $v, $slugs, true ) ) {
				continue 2;
			}
		}
		$out[] = $id;
	}
	return $out;
}

/**
 * Cuenta los valores de las facetas virtuales en un conjunto de productos,
 * ya en el orden en que se muestran (modelos y capacidades de menor a mayor).
 *
 * @param int[] $ids Productos.
 * @return array<string,array<string,array{nombre:string,cuenta:int}>>
 */
function li_cel_conteo( array $ids ): array {
	$mapa  = li_cel_mapa();
	$out   = array();
	$orden = array();

	foreach ( $ids as $id ) {
		if ( ! isset( $mapa[ $id ] ) ) {
			continue;
		}
		foreach ( $mapa[ $id ]['f'] as $tax => [ $slug, $nombre ] ) {
			if ( ! isset( $out[ $tax ][ $slug ] ) ) {
				$out[ $tax ][ $slug ] = array(
					'nombre' => $nombre,
					'cuenta' => 0,
				);
				$orden[ $tax ][ $slug ] = 'cel_capacidad' === $tax ? (int) $mapa[ $id ]['gb'] : $nombre;
			}
			++$out[ $tax ][ $slug ]['cuenta'];
		}
	}

	$fijo = array(
		'cel_estado'  => array( 'nuevo', 'usado' ),
		'cel_bateria' => array( 'mas-de-90', '80-a-89', 'menos-de-80' ),
	);
	foreach ( $out as $tax => &$vals ) {
		if ( isset( $fijo[ $tax ] ) ) {
			$vals = array_replace( array_intersect_key( array_flip( $fijo[ $tax ] ), $vals ), $vals );
		} else {
			uksort(
				$vals,
				static fn( $a, $b ) => is_int( $orden[ $tax ][ $a ] )
					? $orden[ $tax ][ $a ] <=> $orden[ $tax ][ $b ]
					: strnatcasecmp( (string) $orden[ $tax ][ $a ], (string) $orden[ $tax ][ $b ] )
			);
		}
	}
	unset( $vals );

	return $out;
}

/**
 * Nombre visible de un valor de faceta virtual (para las fichas de filtros activos).
 *
 * @param string $tax  Clave.
 * @param string $slug Valor.
 */
function li_cel_etiqueta( string $tax, string $slug ): string {
	foreach ( li_cel_mapa() as $d ) {
		if ( ( $d['f'][ $tax ][0] ?? '' ) === $slug ) {
			return $d['f'][ $tax ][1];
		}
	}
	return '';
}

/**
 * Ficha: "Otras unidades de este modelo". Funciona como un selector de
 * variantes, pero cada opción es su propio producto (su propio IMEI).
 *
 * @param WC_Product $p Producto de la ficha.
 */
function li_cel_otras_unidades( WC_Product $p ): void {
	$mapa = li_cel_mapa();
	$id   = $p->get_id();
	$mod  = $mapa[ $id ]['f']['cel_modelo'][0] ?? '';
	if ( '' === $mod ) {
		return;
	}

	$ids = array_keys( array_filter( $mapa, static fn( $d ) => ( $d['f']['cel_modelo'][0] ?? '' ) === $mod ) );
	if ( count( $ids ) < 2 ) {
		return;
	}

	$unidades = array();
	foreach ( $ids as $uid ) {
		$u = wc_get_product( $uid );
		if ( ! $u ) {
			continue;
		}
		$d          = $mapa[ $uid ];
		$unidades[] = array(
			'id'     => $uid,
			'url'    => get_permalink( $uid ),
			'precio' => (float) wc_get_price_to_display( $u ),
			'gb'     => (int) $d['gb'],
			'cap'    => $d['f']['cel_capacidad'][1] ?? '',
			'estado' => 'usado' === $d['estado'] && null !== $d['bateria']
				? 'Batería ' . $d['bateria'] . '%'
				: $d['f']['cel_estado'][1],
			'nota'   => (string) ( $d['nota'] ?? '' ),
			'orden'  => 'usado' === $d['estado'] ? 1 : 0,
			'bat'    => (int) $d['bateria'],
		);
	}

	// Capacidad, después nuevos antes que usados, después mejor batería y menor precio.
	usort(
		$unidades,
		static fn( $a, $b ) => array( $a['gb'], $a['orden'], -$a['bat'], $a['precio'] ) <=> array( $b['gb'], $b['orden'], -$b['bat'], $b['precio'] )
	);
	$unidades = array_slice( $unidades, 0, 12 );
	?>
	<div class="li-units">
		<div class="li-units__head">
			<strong>Otras unidades de <?php echo esc_html( $mapa[ $id ]['modelo'] ); ?></strong>
			<span><?php echo esc_html( count( $ids ) . ' disponibles' ); ?></span>
		</div>
		<div class="li-units__list">
			<?php foreach ( $unidades as $u ) : ?>
				<?php $actual = $u['id'] === $id; ?>
				<a class="li-unit<?php echo $actual ? ' es-actual' : ''; ?>" href="<?php echo esc_url( $u['url'] ); ?>"<?php echo $actual ? ' aria-current="page"' : ''; ?>>
					<?php if ( $u['cap'] ) : ?>
						<span class="li-unit__spec"><?php echo esc_html( $u['cap'] ); ?></span>
					<?php endif; ?>
					<span class="li-unit__est"><?php echo esc_html( $u['estado'] . ( $u['nota'] ? ' · ' . $u['nota'] : '' ) ); ?></span>
					<span class="li-unit__price"><?php echo esc_html( li_precio_fmt( $u['precio'] ) ); ?></span>
				</a>
			<?php endforeach; ?>
		</div>
	</div>
	<?php
}
