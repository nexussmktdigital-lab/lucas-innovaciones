<?php
/**
 * Mega menú de categorías.
 *
 * El árbol sale de WooCommerce, no de un menú de Apariencia → Menús: así
 * una categoría nueva aparece sola y nadie tiene que acordarse de darla
 * de alta en dos lugares. El orden lo decide la cantidad de productos.
 *
 * Se abre con CSS —:hover y :focus-within—, no con JavaScript. El JS
 * agrega el clic y la tecla Escape para pantallas táctiles, pero si no
 * carga, el menú sigue funcionando entero con mouse y con teclado.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

/**
 * Categorías que nunca se muestran en la navegación.
 */
const LI_CAT_OCULTAS = array( 'solo-mostrador', 'sin-categorizar', 'uncategorized' );

/**
 * Productos únicos por rama: los propios más los de toda su descendencia.
 *
 * No se usa `$term->count` porque WooCommerce guarda ahí la cuenta directa,
 * y una madre como "Smartphones" tiene cero productos propios y 76 en sus
 * hijas: con ese número desaparecería del menú. Además desduplica, que hace
 * falta porque 25 productos están en dos categorías a la vez.
 *
 * @return array<int,int> term_id => cantidad.
 */
function li_cuentas_por_rama(): array {
	global $wpdb;

	// Se descuentan los ocultos del catálogo —las réplicas, que son sólo de
	// mostrador— para que este número coincida con el que después muestra
	// la grilla. Si no, el menú promete 110 y la categoría entrega 106.
	$filas = $wpdb->get_results(
		"SELECT tt.term_id, tr.object_id
		 FROM {$wpdb->term_relationships} tr
		 JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_cat'
		 JOIN {$wpdb->posts} p ON p.ID = tr.object_id AND p.post_type = 'product' AND p.post_status = 'publish'
		 WHERE NOT EXISTS (
		   SELECT 1 FROM {$wpdb->term_relationships} trv
		   JOIN {$wpdb->term_taxonomy} ttv ON ttv.term_taxonomy_id = trv.term_taxonomy_id
		   JOIN {$wpdb->terms} tv ON tv.term_id = ttv.term_id
		   WHERE trv.object_id = p.ID AND ttv.taxonomy = 'product_visibility'
		     AND tv.slug = 'exclude-from-catalog'
		 )",
		ARRAY_A
	);

	$directos = array();
	foreach ( $filas as $f ) {
		$directos[ (int) $f['term_id'] ][ (int) $f['object_id'] ] = true;
	}

	$padres = array();
	foreach ( get_terms( array( 'taxonomy' => 'product_cat', 'hide_empty' => false, 'fields' => 'id=>parent' ) ) as $id => $padre ) {
		$padres[ (int) $id ] = (int) $padre;
	}

	// Cada producto suma a su categoría y a todas sus ancestros.
	$acum = array();
	foreach ( $directos as $term_id => $productos ) {
		$id     = $term_id;
		$vuelta = 0;

		while ( $id && $vuelta < 8 ) {
			foreach ( $productos as $pid => $x ) {
				$acum[ $id ][ $pid ] = true;
			}
			$id = $padres[ $id ] ?? 0;
			++$vuelta;
		}
	}

	return array_map( 'count', $acum );
}

/**
 * Árbol completo de categorías con productos, cacheado 6 horas.
 *
 * @return array<int,array<string,mixed>>
 */
function li_arbol_categorias(): array {
	$cache = get_transient( 'li_arbol_cat' );
	if ( is_array( $cache ) ) {
		return $cache;
	}

	$todas = get_terms(
		array(
			'taxonomy'   => 'product_cat',
			'hide_empty' => false,
		)
	);

	if ( is_wp_error( $todas ) || ! $todas ) {
		return array();
	}

	$cuentas = li_cuentas_por_rama();

	// Agrupadas por padre, que es como se recorre después.
	$por_padre = array();
	foreach ( $todas as $t ) {
		if ( in_array( $t->slug, LI_CAT_OCULTAS, true ) ) {
			continue;
		}
		if ( empty( $cuentas[ $t->term_id ] ) ) {
			continue;
		}
		$por_padre[ (int) $t->parent ][] = $t;
	}

	$arbol = isset( $por_padre[0] ) ? li_rama_categorias( $por_padre[0], $por_padre, $cuentas ) : array();

	set_transient( 'li_arbol_cat', $arbol, 6 * HOUR_IN_SECONDS );

	return $arbol;
}

/**
 * Arma una rama del árbol y baja recursivamente por sus hijas.
 *
 * @param array<int,WP_Term>              $terms     Términos de este nivel.
 * @param array<int,array<int,WP_Term>>   $por_padre Todos los términos agrupados por padre.
 * @param array<int,int>                  $cuentas   Productos por rama.
 * @return array<int,array<string,mixed>>
 */
function li_rama_categorias( array $terms, array $por_padre, array $cuentas ): array {
	$out = array();

	foreach ( $terms as $t ) {
		$out[] = array(
			'nombre' => $t->name,
			'slug'   => $t->slug,
			'cuenta' => (int) ( $cuentas[ $t->term_id ] ?? 0 ),
			'url'    => (string) get_term_link( $t ),
			'hijos'  => isset( $por_padre[ $t->term_id ] ) ? li_rama_categorias( $por_padre[ $t->term_id ], $por_padre, $cuentas ) : array(),
		);
	}

	usort(
		$out,
		static function ( array $a, array $b ): int {
			return $b['cuenta'] <=> $a['cuenta'];
		}
	);

	return $out;
}

/**
 * Nombre de una hija sin repetir el de la madre.
 *
 * En el catálogo las categorías se llaman "Smartphones nuevos" y
 * "Smartphones usados" porque en el POS aparecen sueltas y ahí el nombre
 * largo hace falta. En el menú cuelgan de "Smartphones", así que repetirlo
 * sobra: se muestra "Nuevos" y "Usados". Es sólo presentación — el nombre
 * guardado no se toca.
 *
 * @param string $hija  Nombre de la categoría hija.
 * @param string $madre Nombre de la categoría madre.
 * @return string
 */
function li_nombre_corto( string $hija, string $madre ): string {
	$prefijo = $madre . ' ';

	if ( 0 !== stripos( $hija, $prefijo ) ) {
		return $hija;
	}

	$resto = trim( substr( $hija, strlen( $prefijo ) ) );

	return '' === $resto ? $hija : ucfirst( $resto );
}

add_action( 'created_product_cat', 'li_limpiar_arbol' );
add_action( 'edited_product_cat', 'li_limpiar_arbol' );
add_action( 'delete_product_cat', 'li_limpiar_arbol' );
add_action( 'woocommerce_update_product', 'li_limpiar_arbol' );
/**
 * Invalida el árbol cuando cambian las categorías o las cuentas.
 */
function li_limpiar_arbol(): void {
	delete_transient( 'li_arbol_cat' );
}

/**
 * Dibuja la barra de navegación completa: mega menú y atajos.
 */
function li_nav_render(): void {
	$arbol = li_arbol_categorias();
	if ( ! $arbol ) {
		return;
	}
	?>
	<div class="contenedor nav__caja">

		<div class="mega" data-li-mega>
			<button
				class="mega__disparador"
				type="button"
				aria-expanded="false"
				aria-controls="li-mega"
				data-li-mega-abrir
			>
				<?php li_icono( 'menu' ); ?>
				<span><?php esc_html_e( 'Categorías', 'lucasinnovaciones' ); ?></span>
				<?php li_icono( 'chevron' ); ?>
			</button>

			<div class="mega__caja" id="li-mega">
				<ul class="mega__riel">
					<?php foreach ( $arbol as $madre ) : ?>
						<li class="mega__item">
							<a class="mega__cat" href="<?php echo esc_url( $madre['url'] ); ?>">
								<span><?php echo esc_html( $madre['nombre'] ); ?></span>
								<?php if ( $madre['hijos'] ) : ?>
									<?php li_icono( 'chevron-der' ); ?>
								<?php endif; ?>
							</a>

							<?php if ( $madre['hijos'] ) : ?>
								<div class="mega__panel">
									<a class="mega__panel-titulo" href="<?php echo esc_url( $madre['url'] ); ?>">
										<?php echo esc_html( $madre['nombre'] ); ?>
									</a>

									<div class="mega__cols">
										<?php foreach ( $madre['hijos'] as $hija ) : ?>
											<div class="mega__grupo">
												<a class="mega__grupo-titulo" href="<?php echo esc_url( $hija['url'] ); ?>">
													<?php echo esc_html( $hija['nombre'] ); ?>
													<span class="mega__cuenta"><?php echo esc_html( (string) $hija['cuenta'] ); ?></span>
												</a>

												<?php if ( $hija['hijos'] ) : ?>
													<ul>
														<?php foreach ( $hija['hijos'] as $nieta ) : ?>
															<li>
																<a class="mega__enlace" href="<?php echo esc_url( $nieta['url'] ); ?>">
																	<?php echo esc_html( li_nombre_corto( $nieta['nombre'], $hija['nombre'] ) ); ?>
																	<span class="mega__cuenta"><?php echo esc_html( (string) $nieta['cuenta'] ); ?></span>
																</a>
															</li>
														<?php endforeach; ?>
													</ul>
												<?php endif; ?>
											</div>
										<?php endforeach; ?>
									</div>

									<a class="mega__todo" href="<?php echo esc_url( $madre['url'] ); ?>">
										<?php
										printf(
											/* translators: 1: nombre de la categoría, 2: cantidad de productos */
											esc_html__( 'Ver todo en %1$s (%2$d)', 'lucasinnovaciones' ),
											esc_html( $madre['nombre'] ),
											(int) $madre['cuenta']
										);
										?>
										<?php li_icono( 'flecha' ); ?>
									</a>
								</div>
							<?php endif; ?>
						</li>
					<?php endforeach; ?>
				</ul>
			</div>
		</div>

		<?php
		// Atajos: las cuatro categorías con más productos y el catálogo entero.
		$atajos = array_slice( $arbol, 0, 4 );
		?>
		<ul class="nav__lista">
			<?php foreach ( $atajos as $a ) : ?>
				<li><a href="<?php echo esc_url( $a['url'] ); ?>"><?php echo esc_html( $a['nombre'] ); ?></a></li>
			<?php endforeach; ?>
			<li><a href="<?php echo esc_url( wc_get_page_permalink( 'shop' ) ); ?>"><?php esc_html_e( 'Todo el catálogo', 'lucasinnovaciones' ); ?></a></li>
		</ul>

	</div>
	<?php
}
