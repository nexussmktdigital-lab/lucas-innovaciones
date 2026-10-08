<?php
/**
 * Piezas del design system, portadas a PHP.
 *
 * Referencia: design-system/ui_kit/Primitives.jsx (Button, Badge, Price,
 * StockDot, Logo, WhatsappFab) y los íconos Lucide del kit (trazo 1,75).
 * Los desvíos pedidos por Matias (sin cuotas, sin reseñas, 20 años, Caseros
 * 924, nada sin confirmar) están resueltos acá y en las plantillas.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

const LI_WHATSAPP       = '5493574443092';
const LI_WHATSAPP_TEXTO = '+54 3574 443092';
const LI_INSTAGRAM      = 'lucas_innovaciones';
const LI_DIRECCION      = 'Caseros 924';
const LI_LOCALIDAD      = 'Villa Santa Rosa, Córdoba';
const LI_ANTIGUEDAD     = '20 años'; // Corregido por Matias el 07/10 (antes decía 25).
const LI_HORARIO        = 'De 9 a 12:30 y de 17 a 21'; // Confirmado por Matias el 06/10.
const LI_MAIL_LOCAL     = 'lucas_innovaciones_@hotmail.com'; // La casilla que lee el local (Matias, 07/10).

/**
 * Enlace de WhatsApp con mensaje opcional.
 *
 * @param string $texto Mensaje precargado.
 */
function li_whatsapp_url( string $texto = '' ): string {
	$url = 'https://wa.me/' . LI_WHATSAPP;
	return $texto ? $url . '?text=' . rawurlencode( $texto ) : $url;
}

/**
 * Ícono Lucide en línea (los del kit).
 *
 * @param string $nombre Ícono.
 * @param int    $tam    Tamaño en px.
 * @param string $clase  Clase extra.
 */
function li_ds_icono( string $nombre, int $tam = 20, string $clase = '' ): string {
	static $iconos = array(
		'search'   => '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
		'cart'     => '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
		'user'     => '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
		'menu'     => '<path d="M3 12h18M3 6h18M3 18h18"/>',
		'x'        => '<path d="M18 6 6 18M6 6l12 12"/>',
		'chevron-r' => '<path d="M9 18l6-6-6-6"/>',
		'chevron-d' => '<path d="m6 9 6 6 6-6"/>',
		'truck'    => '<rect x="1" y="7" width="15" height="10" rx="1"/><path d="M16 10h3l3 3v4h-6"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
		'shield'   => '<path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z"/><path d="m9 12 2 2 4-4"/>',
		'card'     => '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
		'map-pin'  => '<path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/>',
		'zap'      => '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
		'check'    => '<path d="M20 6 9 17l-5-5"/>',
		'plus'     => '<path d="M12 5v14M5 12h14"/>',
		'minus'    => '<path d="M5 12h14"/>',
		'store'    => '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M10 20v-5h4v5"/>',
		'box'      => '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
		'power'    => '<path d="M12 2v10M18.36 6.64a9 9 0 1 1-12.72 0"/>',
		'instagram' => '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/>',
		'facebook' => '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
	);

	if ( 'whatsapp' === $nombre ) {
		// Logo oficial de WhatsApp (el glifo de la marca). Toma el color del
		// contexto: blanco sobre el botón verde, verde WhatsApp en el resto (CSS).
		return sprintf(
			'<svg class="li-ico li-ico--wa %s" width="%2$d" height="%2$d" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>',
			esc_attr( $clase ),
			$tam
		);
	}

	if ( ! isset( $iconos[ $nombre ] ) ) {
		return '';
	}

	return sprintf(
		'<svg class="li-ico %s" width="%2$d" height="%2$d" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">%3$s</svg>',
		esc_attr( $clase ),
		$tam,
		$iconos[ $nombre ]
	);
}

/**
 * Logo oficial (wordmark pixel con el botón de power y el cursor), en PNG con
 * transparencia: 1x y 2x para pantallas de alta densidad. Va igual sobre
 * fondo claro y sobre negro: las letras son blancas con contorno.
 *
 * @param bool $oscuro Sobre fondo negro (pie, próximamente): solo cambia la clase.
 */
function li_ds_logo( bool $oscuro = false ): string {
	return sprintf(
		'<a class="li-logo%s" href="%s" rel="home"><img class="li-logo__img" src="%s" srcset="%s 1x, %s 2x" width="325" height="96" alt="Lucas Innovaciones"></a>',
		$oscuro ? ' li-logo--dark' : '',
		esc_url( home_url( '/' ) ),
		esc_url( LI_URI . '/assets/img/logo-li-96.png' ),
		esc_url( LI_URI . '/assets/img/logo-li-96.png' ),
		esc_url( LI_URI . '/assets/img/logo-li-192.png' )
	);
}

/**
 * Precio del kit (componente Price), sin la línea de cuotas.
 *
 * Usa el HTML de WooCommerce, así el precio en dólares ya viene convertido
 * por li-dolar y, si no hay cotización, sale "Consultar por WhatsApp".
 *
 * @param WC_Product $p   Producto.
 * @param string     $tam sm | md | lg | xl.
 */
function li_ds_precio( WC_Product $p, string $tam = 'md' ): string {
	$html = $p->get_price_html();
	if ( '' === $html ) {
		return '';
	}
	return sprintf( '<div class="li-price li-price--%s">%s</div>', esc_attr( $tam ), $html );
}

/** $ 1.234.567, como el resto de la web. */
function li_precio_txt( float $v ): string {
	return '$ ' . number_format( $v, 0, ',', '.' );
}

/**
 * Lo que paga quien elige transferencia (precio web menos el descuento), o 0
 * si no aplica: sin descuento configurado o producto que no se puede comprar.
 *
 * @param WC_Product $p Producto.
 */
function li_precio_transferencia( WC_Product $p ): int {
	if ( ! class_exists( 'Li_Dolar' ) || Li_Dolar::descuento_bp() <= 0 || ! $p->is_purchasable() ) {
		return 0;
	}
	$precio = (float) wc_get_price_to_display( $p );
	return $precio > 1 ? Li_Dolar::precio_transferencia( $precio ) : 0;
}

/**
 * Precios de la tarjeta y de la ficha: el de transferencia, grande, como
 * precio principal, y el de lista (tarjeta o Mercado Pago), chico. Es el
 * gancho de venta de la web (10% OFF, Matias 08/10). Si no hay precio con
 * transferencia (sin descuento, "Consultar"), queda el precio de siempre.
 *
 * @param WC_Product $p   Producto.
 * @param string     $tam card | ficha.
 */
function li_ds_precios( WC_Product $p, string $tam = 'card' ): string {
	$t = li_precio_transferencia( $p );
	if ( ! $t ) {
		return li_ds_precio( $p, 'ficha' === $tam ? 'xl' : 'md' );
	}

	$pct   = Li_Dolar::porcentaje( Li_Dolar::descuento_bp() );
	$lista = esc_html( li_precio_txt( (float) wc_get_price_to_display( $p ) ) );
	if ( $p->is_on_sale() && ! $p->is_type( 'variable' ) ) {
		$antes = (float) wc_get_price_to_display( $p, array( 'price' => $p->get_regular_price() ) );
		if ( $antes > (float) wc_get_price_to_display( $p ) ) {
			$lista = '<del>' . esc_html( li_precio_txt( $antes ) ) . '</del> ' . $lista;
		}
	}

	if ( 'ficha' === $tam ) {
		return sprintf(
			'<div class="li-precios li-precios--ficha">'
			. '<div class="li-precios__lista">Precio de lista <strong>%1$s</strong><span>con tarjeta o Mercado Pago</span></div>'
			. '<div class="li-precios__especial"><span class="li-precios__monto">%2$s</span><span class="li-precios__leyenda"><span class="li-badge li-badge--pixel li-badge--green">%3$s OFF</span> Precio especial transferencia</span></div>'
			. '</div>',
			$lista,
			esc_html( li_precio_txt( $t ) ),
			esc_html( $pct )
		);
	}

	return sprintf(
		'<div class="li-precios li-precios--card"><div class="li-precios__especial"><span class="li-precios__monto">%1$s</span><span class="li-precios__leyenda"><span class="li-badge li-badge--pixel li-badge--green">%2$s OFF</span> con transferencia</span></div><span class="li-precios__lista">Precio de lista %3$s</span></div>',
		esc_html( li_precio_txt( $t ) ),
		esc_html( $pct ),
		$lista
	);
}

/**
 * Punto de stock (StockDot).
 *
 * @param WC_Product $p Producto.
 */
function li_ds_stock( WC_Product $p ): string {
	if ( ! $p->is_in_stock() ) {
		return '<span class="li-stock li-stock--out">Sin stock</span>';
	}
	$n = $p->managing_stock() ? (int) $p->get_stock_quantity() : null;
	if ( null !== $n && $n > 0 && $n <= 2 ) {
		return '<span class="li-stock li-stock--low">' . esc_html( 1 === $n ? 'Última unidad' : 'Últimas unidades' ) . '</span>';
	}
	return '<span class="li-stock">Stock · Retiralo hoy</span>';
}

/**
 * Marca del producto (product_brand), o vacío.
 *
 * @param int $id Producto.
 */
function li_marca_producto( int $id ): string {
	$m = wp_get_object_terms( $id, 'product_brand', array( 'fields' => 'names' ) );
	return ( ! is_wp_error( $m ) && $m ) ? (string) $m[0] : '';
}

/**
 * ¿Es un usado? Por categoría (Smartphones usados) o por el atributo condición.
 *
 * @param int $id Producto.
 */
function li_es_usado( int $id ): bool {
	if ( has_term( 'smartphones-usados', 'product_cat', $id ) ) {
		return true;
	}
	$c = wc_get_product_terms( $id, 'pa_condicion', array( 'fields' => 'names' ) );
	return $c && 'Usado' === $c[0];
}

/**
 * Grilla de tarjetas para una lista de IDs.
 *
 * @param int[]  $ids   Productos.
 * @param string $clase Clase extra de la grilla.
 */
function li_ds_grilla( array $ids, string $clase = '' ): void {
	if ( ! $ids ) {
		return;
	}
	$original = $GLOBALS['post'] ?? null;
	printf( '<ul class="li-grid %s">', esc_attr( $clase ) );
	foreach ( $ids as $id ) {
		$GLOBALS['post'] = get_post( $id ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride
		setup_postdata( $GLOBALS['post'] );
		$GLOBALS['product'] = wc_get_product( $id ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride
		wc_get_template_part( 'content', 'product' );
	}
	echo '</ul>';
	$GLOBALS['post'] = $original; // phpcs:ignore WordPress.WP.GlobalVariablesOverride
	wp_reset_postdata();
}

/**
 * Categorías de primer nivel con productos publicables, para la barra de la
 * cabecera y el pie.
 *
 * @param int $n Cuántas.
 * @return array<int,array<string,mixed>>
 */
function li_categorias_principales( int $n = 8 ): array {
	return array_slice( li_arbol_categorias(), 0, $n );
}

/**
 * Página por slug, si existe y está publicada (para el pie).
 *
 * @param string $slug Slug.
 */
function li_url_pagina( string $slug ): string {
	$p = get_page_by_path( $slug );
	return ( $p && 'publish' === $p->post_status ) ? (string) get_permalink( $p ) : '';
}
