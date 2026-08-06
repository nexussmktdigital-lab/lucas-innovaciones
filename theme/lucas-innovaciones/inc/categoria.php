<?php
/**
 * Página de categoría: banners, carrusel de marcas y filtrado.
 *
 * El filtro por marca viaja en la URL (`?marca=samsung,motorola`) y lo
 * aplica `pre_get_posts` sobre la consulta principal. Eso hace que funcione
 * sin JavaScript, que la paginación y el orden de WooCommerce sigan
 * andando, y que un enlace filtrado se pueda compartir. El AJAX se monta
 * encima: intercepta el clic, pide la misma grilla y reescribe la URL.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/* -------------------------------------------------------------------------
   Estado del filtro
   ------------------------------------------------------------------------- */

/**
 * Marcas seleccionadas, leídas de la URL.
 *
 * @return string[] Slugs.
 */
function li_filtro_marcas(): array {
	$crudo = isset( $_GET['marca'] ) ? sanitize_text_field( wp_unslash( $_GET['marca'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended

	if ( '' === $crudo ) {
		return array();
	}

	$slugs = array_filter( array_map( 'sanitize_title', explode( ',', $crudo ) ) );

	return array_values( array_unique( $slugs ) );
}

add_action( 'pre_get_posts', 'li_aplicar_filtros' );
/**
 * Mete el filtro de marca en la consulta principal del catálogo.
 *
 * @param WP_Query $q Consulta.
 */
function li_aplicar_filtros( WP_Query $q ): void {
	if ( is_admin() || ! $q->is_main_query() ) {
		return;
	}
	if ( ! ( $q->is_post_type_archive( 'product' ) || $q->is_tax( get_object_taxonomies( 'product' ) ) ) ) {
		return;
	}

	$marcas    = li_filtro_marcas();
	$atributos = li_filtro_atributos();

	if ( ! $marcas && ! $atributos ) {
		return;
	}

	$tax = (array) $q->get( 'tax_query' );

	if ( $marcas ) {
		$tax[] = array(
			'taxonomy' => 'product_brand',
			'field'    => 'slug',
			'terms'    => $marcas,
			'operator' => 'IN',
		);
	}

	/*
	 * Entre atributos distintos manda la Y —128GB *y* usado—; dentro de un
	 * mismo atributo, la O —128GB *o* 256GB—. Es lo que espera cualquiera
	 * que haya usado un buscador de productos.
	 */
	foreach ( $atributos as $taxonomia => $slugs ) {
		$tax[] = array(
			'taxonomy' => $taxonomia,
			'field'    => 'slug',
			'terms'    => $slugs,
			'operator' => 'IN',
		);
	}

	$q->set( 'tax_query', $tax );
}

/**
 * URL de la categoría con un juego de marcas aplicado.
 *
 * @param WP_Term  $term   Categoría.
 * @param string[] $marcas Slugs de marca.
 * @return string
 */
function li_url_filtro( WP_Term $term, array $marcas ): string {
	$base = (string) get_term_link( $term );

	if ( ! $marcas ) {
		return $base;
	}

	return add_query_arg( 'marca', implode( ',', $marcas ), $base );
}

/**
 * URL que resulta de encender o apagar una marca sobre el estado actual.
 *
 * @param WP_Term $term Categoría.
 * @param string  $slug Marca a alternar.
 * @return string
 */
function li_url_alternar_marca( WP_Term $term, string $slug ): string {
	$actuales = li_filtro_marcas();

	$nuevas = in_array( $slug, $actuales, true )
		? array_values( array_diff( $actuales, array( $slug ) ) )
		: array_merge( $actuales, array( $slug ) );

	// Cambiar de marca no debe borrar los filtros de característica puestos.
	return li_url_con( $nuevas, li_filtro_atributos() );
}

/* -------------------------------------------------------------------------
   Datos de la categoría
   ------------------------------------------------------------------------- */

/**
 * Identificadores de la categoría y toda su descendencia.
 *
 * @param WP_Term $term Categoría.
 * @return int[]
 */
function li_rama_ids( WP_Term $term ): array {
	$ids = get_term_children( $term->term_id, 'product_cat' );
	$ids = is_wp_error( $ids ) ? array() : $ids;
	$ids[] = $term->term_id;

	return array_map( 'absint', $ids );
}

/**
 * Marcas presentes en una categoría, con cuántos productos aporta cada una.
 *
 * Se consulta directo porque `get_terms` no sabe cruzar dos taxonomías:
 * hace falta contar marcas dentro de una rama de categorías.
 *
 * @param WP_Term $term Categoría.
 * @return array<int,array<string,mixed>>
 */
function li_marcas_de_categoria( WP_Term $term ): array {
	$clave = 'li_marcas_cat_' . $term->term_id;
	$cache = get_transient( $clave );
	if ( is_array( $cache ) ) {
		return $cache;
	}

	global $wpdb;

	$rama = implode( ',', li_rama_ids( $term ) );

	$filas = $wpdb->get_results(
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		"SELECT b.term_id, b.name, b.slug, COUNT(DISTINCT p.ID) AS n
		 FROM {$wpdb->posts} p
		 JOIN {$wpdb->term_relationships} trc ON trc.object_id = p.ID
		 JOIN {$wpdb->term_taxonomy} ttc ON ttc.term_taxonomy_id = trc.term_taxonomy_id
		      AND ttc.taxonomy = 'product_cat' AND ttc.term_id IN ({$rama})
		 JOIN {$wpdb->term_relationships} trb ON trb.object_id = p.ID
		 JOIN {$wpdb->term_taxonomy} ttb ON ttb.term_taxonomy_id = trb.term_taxonomy_id
		      AND ttb.taxonomy = 'product_brand'
		 JOIN {$wpdb->terms} b ON b.term_id = ttb.term_id
		 WHERE p.post_type = 'product' AND p.post_status = 'publish'
		 AND NOT EXISTS (
		   SELECT 1 FROM {$wpdb->term_relationships} trv
		   JOIN {$wpdb->term_taxonomy} ttv ON ttv.term_taxonomy_id = trv.term_taxonomy_id
		   JOIN {$wpdb->terms} tv ON tv.term_id = ttv.term_id
		   WHERE trv.object_id = p.ID AND ttv.taxonomy = 'product_visibility'
		     AND tv.slug = 'exclude-from-catalog'
		 )
		 GROUP BY b.term_id, b.name, b.slug
		 ORDER BY n DESC, b.name ASC",
		// phpcs:enable
		ARRAY_A
	);

	$out = array();
	foreach ( $filas as $f ) {
		$logo = li_marca_logo( $f['slug'] );

		$out[] = array(
			'nombre' => $f['name'],
			'slug'   => $f['slug'],
			'cuenta' => (int) $f['n'],
			'img'    => li_termino_imagen( (int) $f['term_id'] ) ?: $logo['url'],
			'fondo'  => $logo['fondo'],
		);
	}

	set_transient( $clave, $out, 6 * HOUR_IN_SECONDS );

	return $out;
}

add_action( 'woocommerce_update_product', 'li_limpiar_marcas_cat' );
add_action( 'edited_product_cat', 'li_limpiar_marcas_cat' );
/**
 * Tira las cachés de marcas por categoría.
 */
function li_limpiar_marcas_cat(): void {
	global $wpdb;

	$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_li_marcas_cat_%' OR option_name LIKE '_transient_timeout_li_marcas_cat_%'" );
}

/* -------------------------------------------------------------------------
   Banners de categoría
   ------------------------------------------------------------------------- */

/**
 * Tres banners para una categoría.
 *
 * Salen del propio catálogo, así que toda categoría tiene los suyos sin que
 * nadie configure nada. Se pueden reemplazar guardando la opción
 * `li_banners_cat_{id}` con el mismo formato que los de la portada.
 *
 * @param WP_Term $term Categoría.
 * @return array<int,array<string,mixed>>
 */
function li_banners_categoria( WP_Term $term ): array {
	$propios = get_option( 'li_banners_cat_' . $term->term_id, array() );

	if ( is_array( $propios ) && $propios ) {
		return array_values( array_filter( array_map( 'li_banner_normalizar', $propios ) ) );
	}

	$marcas = li_marcas_de_categoria( $term );
	$hijas  = get_terms(
		array(
			'taxonomy'   => 'product_cat',
			'parent'     => $term->term_id,
			'hide_empty' => false,
		)
	);
	$hijas = is_wp_error( $hijas ) ? array() : $hijas;

	$cuentas = li_cuentas_por_rama();
	$total   = (int) ( $cuentas[ $term->term_id ] ?? 0 );
	$local   = li_local();

	$slides = array();

	// 1. La categoría entera.
	$slides[] = array(
		'tema'   => 'negro',
		'kicker' => $local['ciudad'] ? $local['ciudad'] : 'Lucas Innovaciones',
		'titulo' => $term->name,
		'texto'  => $term->description
			? wp_strip_all_tags( $term->description )
			: 'Comprá online y retiralo en el local, o te lo enviamos.',
		'dato'   => (string) $total,
		'unidad' => 'productos',
		'cta'    => '',
		'url'    => '',
		'img'    => 0,
	);

	// 2. La marca más fuerte de la categoría, que ya lleva al filtro puesto.
	if ( isset( $marcas[0] ) && $marcas[0]['cuenta'] > 1 ) {
		$m = $marcas[0];

		$slides[] = array(
			'tema'   => 'verde',
			'kicker' => 'La marca más elegida',
			'titulo' => $m['nombre'],
			'texto'  => sprintf( 'Todo lo que tenemos de %s en %s.', $m['nombre'], $term->name ),
			'dato'   => (string) $m['cuenta'],
			'unidad' => 'productos',
			'cta'    => 'Ver ' . $m['nombre'],
			'url'    => li_url_filtro( $term, array( $m['slug'] ) ),
			'img'    => 0,
		);
	}

	// 3. La subcategoría más grande, o el retiro si no hay subcategorías.
	$mayor = null;
	foreach ( $hijas as $h ) {
		$n = (int) ( $cuentas[ $h->term_id ] ?? 0 );
		if ( ! $mayor || $n > $mayor[1] ) {
			$mayor = array( $h, $n );
		}
	}

	if ( $mayor && $mayor[1] > 0 ) {
		$slides[] = array(
			'tema'   => 'claro',
			'kicker' => 'Lo más buscado de ' . $term->name,
			'titulo' => $mayor[0]->name,
			'texto'  => 'Entrá directo a la subcategoría con más variedad.',
			'dato'   => (string) $mayor[1],
			'unidad' => 'productos',
			'cta'    => 'Ver ' . mb_strtolower( $mayor[0]->name ),
			'url'    => (string) get_term_link( $mayor[0] ),
			'img'    => 0,
		);
	} elseif ( $local['direccion'] ) {
		$slides[] = array(
			'tema'   => 'claro',
			'kicker' => 'Retiro en el local',
			'titulo' => $local['direccion'],
			'texto'  => 'Comprá online y pasá a buscarlo. O te lo enviamos.',
			'dato'   => 'RETIRO',
			'unidad' => $local['ciudad'],
			'cta'    => '',
			'url'    => '',
			'img'    => 0,
		);
	}

	return $slides;
}

/* -------------------------------------------------------------------------
   Piezas de la página
   ------------------------------------------------------------------------- */

/**
 * Carrusel de marcas de la categoría, cada una como filtro.
 *
 * Son enlaces de verdad: sin JavaScript filtran igual, recargando.
 *
 * @param WP_Term $term Categoría.
 */
function li_carrusel_marcas( WP_Term $term ): void {
	$marcas = li_marcas_de_categoria( $term );

	if ( count( $marcas ) < 2 ) {
		return;
	}

	$activas = li_filtro_marcas();
	?>
	<section class="marcas-carrusel" aria-label="<?php esc_attr_e( 'Filtrar por marca', 'lucasinnovaciones' ); ?>">
		<div class="marcas-carrusel__pista" data-li-carrusel>
			<a
				class="marca-filtro<?php echo $activas ? '' : ' es-activa'; ?>"
				href="<?php echo esc_url( (string) get_term_link( $term ) ); ?>"
				data-li-filtro
			>
				<span class="medallon medallon--todas"><?php li_icono( 'filtro' ); ?></span>
				<span class="marca-filtro__nombre"><?php esc_html_e( 'Todas', 'lucasinnovaciones' ); ?></span>
			</a>

			<?php foreach ( $marcas as $m ) : ?>
				<?php $activa = in_array( $m['slug'], $activas, true ); ?>
				<a
					class="marca-filtro<?php echo $activa ? ' es-activa' : ''; ?>"
					href="<?php echo esc_url( li_url_alternar_marca( $term, $m['slug'] ) ); ?>"
					aria-pressed="<?php echo $activa ? 'true' : 'false'; ?>"
					data-li-filtro
				>
					<?php li_medallon_marca( $m ); ?>
					<span class="marca-filtro__nombre"><?php echo esc_html( $m['nombre'] ); ?></span>
					<span class="marca-filtro__cuenta"><?php echo esc_html( (string) $m['cuenta'] ); ?></span>
				</a>
			<?php endforeach; ?>
		</div>
	</section>
	<?php
}

/**
 * Subcategorías de la categoría actual, como fichas.
 *
 * @param WP_Term $term Categoría.
 */
function li_subcategorias( WP_Term $term ): void {
	$hijas = get_terms(
		array(
			'taxonomy'   => 'product_cat',
			'parent'     => $term->term_id,
			'hide_empty' => false,
		)
	);

	if ( is_wp_error( $hijas ) || ! $hijas ) {
		return;
	}

	$cuentas = li_cuentas_por_rama();

	$lista = array();
	foreach ( $hijas as $h ) {
		$n = (int) ( $cuentas[ $h->term_id ] ?? 0 );
		if ( $n > 0 ) {
			$lista[] = array( $h, $n );
		}
	}

	if ( ! $lista ) {
		return;
	}

	usort(
		$lista,
		static function ( array $a, array $b ): int {
			return $b[1] <=> $a[1];
		}
	);
	?>
	<nav class="subcats" aria-label="<?php esc_attr_e( 'Subcategorías', 'lucasinnovaciones' ); ?>">
		<?php foreach ( $lista as $x ) : ?>
			<a class="subcat" href="<?php echo esc_url( (string) get_term_link( $x[0] ) ); ?>">
				<?php echo esc_html( li_nombre_corto( $x[0]->name, $term->name ) ); ?>
				<span class="subcat__cuenta"><?php echo esc_html( (string) $x[1] ); ?></span>
			</a>
		<?php endforeach; ?>
	</nav>
	<?php
}

/**
 * Qué categorías mostrar en la barra lateral.
 *
 * Dentro de una categoría con hijas se listan sus hijas, que es hacia donde
 * uno quiere bajar. En una hoja se listan sus hermanas, que es hacia donde
 * uno quiere saltar. Fuera de una categoría, las madres.
 *
 * @param WP_Term|null $cat Categoría actual, si estamos en una.
 * @return array<int,array<string,mixed>>
 */
function li_lista_lateral( ?WP_Term $cat ): array {
	$arbol = li_arbol_categorias();

	if ( ! $cat ) {
		return $arbol;
	}

	$rama = li_buscar_rama( $arbol, $cat->slug );

	if ( $rama && $rama['hijos'] ) {
		return $rama['hijos'];
	}

	$hermanas = li_buscar_hermanas( $arbol, $cat->slug );

	return $hermanas ? $hermanas : $arbol;
}

/**
 * Busca una rama del árbol por slug, a cualquier profundidad.
 *
 * @param array<int,array<string,mixed>> $ramas Ramas donde buscar.
 * @param string                         $slug  Slug buscado.
 * @return array<string,mixed>|null
 */
function li_buscar_rama( array $ramas, string $slug ): ?array {
	foreach ( $ramas as $r ) {
		if ( $r['slug'] === $slug ) {
			return $r;
		}
		$hallada = li_buscar_rama( $r['hijos'], $slug );
		if ( $hallada ) {
			return $hallada;
		}
	}

	return null;
}

/**
 * Devuelve el nivel que contiene al slug dado.
 *
 * @param array<int,array<string,mixed>> $ramas Ramas donde buscar.
 * @param string                         $slug  Slug buscado.
 * @return array<int,array<string,mixed>>|null
 */
function li_buscar_hermanas( array $ramas, string $slug ): ?array {
	foreach ( $ramas as $r ) {
		if ( $r['slug'] === $slug ) {
			return $ramas;
		}
		$halladas = li_buscar_hermanas( $r['hijos'], $slug );
		if ( $halladas ) {
			return $halladas;
		}
	}

	return null;
}

/**
 * Selector de orden.
 *
 * Propio y no el de WooCommerce porque aquel depende de las propiedades del
 * bucle, que no existen cuando se devuelve sólo el fragmento por AJAX.
 */
function li_ordenar(): void {
	$opciones = array(
		'menu_order' => __( 'Más relevantes', 'lucasinnovaciones' ),
		'date'       => __( 'Más nuevos', 'lucasinnovaciones' ),
		'price'      => __( 'Menor precio', 'lucasinnovaciones' ),
		'price-desc' => __( 'Mayor precio', 'lucasinnovaciones' ),
	);

	$actual = isset( $_GET['orderby'] ) ? sanitize_text_field( wp_unslash( $_GET['orderby'] ) ) : 'menu_order'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	?>
	<label class="orden">
		<span class="visually-hidden"><?php esc_html_e( 'Ordenar por', 'lucasinnovaciones' ); ?></span>
		<select class="orden__campo" data-li-orden>
			<?php foreach ( $opciones as $valor => $texto ) : ?>
				<option value="<?php echo esc_attr( $valor ); ?>" <?php selected( $actual, $valor ); ?>>
					<?php echo esc_html( $texto ); ?>
				</option>
			<?php endforeach; ?>
		</select>
		<?php li_icono( 'chevron' ); ?>
	</label>
	<?php
}

/**
 * Cabecera de resultados, grilla y paginación.
 *
 * Es el único lugar donde se dibuja la lista: la página completa y el
 * fragmento que responde al AJAX pasan los dos por acá, así no puede
 * haber dos versiones que se desincronicen.
 *
 * @param WP_Query $q Consulta ya resuelta.
 */
function li_render_resultados( WP_Query $q ): void {
	$total = (int) $q->found_posts;
	?>
	<div class="catalogo__barra">
		<p class="catalogo__conteo">
			<?php
			printf(
				/* translators: %s: cantidad de productos */
				esc_html( _n( '%s producto', '%s productos', $total, 'lucasinnovaciones' ) ),
				'<strong>' . esc_html( number_format_i18n( $total ) ) . '</strong>' // phpcs:ignore WordPress.Security.EscapeOutput
			);
			?>
		</p>
		<?php li_ordenar(); ?>
	</div>

	<?php if ( ! $total ) : ?>
		<div class="vacio">
			<p class="vacio__titulo"><?php esc_html_e( 'Nada por acá', 'lucasinnovaciones' ); ?></p>
			<p><?php esc_html_e( 'Ningún producto coincide con estos filtros. Probá sacando alguno.', 'lucasinnovaciones' ); ?></p>
		</div>
		<?php
		return;
	endif;

	$original = $GLOBALS['post'] ?? null;

	echo '<ul class="grilla productos">';

	while ( $q->have_posts() ) {
		$q->the_post();
		$GLOBALS['product'] = wc_get_product( get_the_ID() ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride
		wc_get_template_part( 'content', 'product' );
	}

	echo '</ul>';

	$GLOBALS['post'] = $original; // phpcs:ignore WordPress.WP.GlobalVariablesOverride
	wp_reset_postdata();

	if ( $q->max_num_pages > 1 ) {
		// Se reusa la clase de WooCommerce: el tema ya la tiene estilada.
		echo '<nav class="woocommerce-pagination" aria-label="' . esc_attr__( 'Paginación', 'lucasinnovaciones' ) . '">';
		echo wp_kses_post(
			(string) paginate_links(
				array(
					'total'     => (int) $q->max_num_pages,
					'current'   => max( 1, (int) get_query_var( 'paged' ) ),
					'prev_text' => '‹',
					'next_text' => '›',
					'type'      => 'list',
				)
			)
		);
		echo '</nav>';
	}
}

add_action( 'template_redirect', 'li_fragmento_resultados' );
/**
 * Responde sólo el pedazo que cambia cuando se toca un filtro.
 *
 * Sale por la misma plantilla y la misma consulta que la página entera; lo
 * único que hace es cortar antes de dibujar cabecera y pie. Devolver la
 * página completa y recortarla en el navegador también funcionaba, pero
 * mandaba 70 KB de menú y pie en cada clic.
 */
function li_fragmento_resultados(): void {
	if ( empty( $_GET['li_frag'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		return;
	}
	if ( ! is_post_type_archive( 'product' ) && ! is_product_taxonomy() ) {
		return;
	}

	$term   = get_queried_object();
	$es_cat = $term instanceof WP_Term && 'product_cat' === $term->taxonomy;

	// Las facetas también cambian: al filtrar por marca, las capacidades
	// disponibles y sus cuentas ya no son las mismas.
	echo '<div data-li-facetas>';
	li_panel_filtros();
	echo '</div>';

	if ( $es_cat ) {
		li_carrusel_marcas( $term );
	}

	echo '<div data-li-resultados>';

	if ( $es_cat ) {
		li_filtros_activos( $term );
	}

	li_render_resultados( $GLOBALS['wp_query'] );

	echo '</div>';
	exit;
}

/**
 * Fichas de los filtros puestos, cada una con su cruz para sacarlo.
 *
 * @param WP_Term $term Categoría.
 */
function li_filtros_activos( WP_Term $term ): void {
	$activas = li_filtro_marcas();
	$attrs   = li_filtro_atributos();

	if ( ! $activas && ! $attrs ) {
		return;
	}
	?>
	<div class="activos" data-li-activos>
		<span class="activos__etq"><?php esc_html_e( 'Filtrando por', 'lucasinnovaciones' ); ?></span>

		<?php foreach ( $activas as $slug ) : ?>
			<?php
			$t = get_term_by( 'slug', $slug, 'product_brand' );
			if ( ! $t ) {
				continue;
			}
			?>
			<a class="activo" href="<?php echo esc_url( li_url_alternar_marca( $term, $slug ) ); ?>" data-li-filtro>
				<?php echo esc_html( $t->name ); ?>
				<?php li_icono( 'cerrar' ); ?>
			</a>
		<?php endforeach; ?>

		<?php li_fichas_atributos(); ?>

		<a class="activos__limpiar" href="<?php echo esc_url( (string) get_term_link( $term ) ); ?>" data-li-filtro>
			<?php esc_html_e( 'Limpiar todo', 'lucasinnovaciones' ); ?>
		</a>
	</div>
	<?php
}
