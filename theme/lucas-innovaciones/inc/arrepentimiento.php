<?php
/**
 * Botón de arrepentimiento (Res. 424/2020, Secretaría de Comercio Interior).
 *
 * Formulario sin registro para revocar una compra dentro de los 10 días
 * corridos (Ley 24.240, art. 34). Al enviarlo se genera un código de
 * identificación que se le manda al cliente por mail, y al local le llega
 * otro mail con los datos. No toca pedidos: el reintegro lo gestiona el
 * local a mano. Las solicitudes quedan además en una opción (últimas 200).
 *
 * Uso: shortcode [li_arrepentimiento] en la página /boton-de-arrepentimiento/.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

const LI_ARREP_OPCION = 'li_arrepentimientos';

add_shortcode( 'li_arrepentimiento', 'li_arrepentimiento_render' );

/**
 * Procesa el envío (si lo hay) y dibuja el formulario o la confirmación.
 */
function li_arrepentimiento_render(): string {
	$error = '';
	$datos = array(
		'nombre'   => '',
		'email'    => '',
		'telefono' => '',
		'pedido'   => '',
		'motivo'   => '',
	);

	// phpcs:disable WordPress.Security.NonceVerification -- se verifica abajo.
	if ( 'POST' === ( $_SERVER['REQUEST_METHOD'] ?? '' ) && isset( $_POST['li_arrep'] ) ) {
		foreach ( $datos as $k => $v ) {
			$datos[ $k ] = isset( $_POST[ $k ] ) ? sanitize_text_field( wp_unslash( $_POST[ $k ] ) ) : '';
		}
		$datos['email']  = sanitize_email( $datos['email'] );
		$datos['motivo'] = isset( $_POST['motivo'] ) ? sanitize_textarea_field( wp_unslash( $_POST['motivo'] ) ) : '';

		if ( ! isset( $_POST['_li_arrep'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['_li_arrep'] ) ), 'li_arrep' ) ) {
			$error = 'La página estuvo abierta mucho tiempo. Recargala y volvé a enviar.';
		} elseif ( ! empty( $_POST['li_web'] ) ) {
			$error = 'No pudimos enviar la solicitud.'; // Trampa para bots.
		} elseif ( '' === $datos['nombre'] || ! is_email( $datos['email'] ) || '' === $datos['pedido'] ) {
			$error = 'Completá tu nombre, un email válido y el número de pedido.';
		} else {
			$codigo = li_arrepentimiento_registrar( $datos );
			return li_arrepentimiento_confirmacion( $codigo, $datos['email'] );
		}
	}
	// phpcs:enable

	ob_start();
	?>
	<div class="li-arrep">
		<p>Si compraste por la web, tenés <strong>10 días corridos</strong> desde que recibiste el producto para arrepentirte de la compra, sin dar explicaciones (Ley 24.240, art. 34). Completá este formulario: no hace falta tener cuenta.</p>
		<p>Al enviarlo te mandamos por mail un <strong>código de identificación</strong> de tu solicitud y nos ponemos en contacto para coordinar la devolución.</p>

		<?php if ( $error ) : ?>
			<p class="li-arrep__error" role="alert"><?php echo esc_html( $error ); ?></p>
		<?php endif; ?>

		<form class="li-arrep__form" method="post" novalidate>
			<?php wp_nonce_field( 'li_arrep', '_li_arrep' ); ?>
			<input type="hidden" name="li_arrep" value="1">
			<p class="li-arrep__trampa" aria-hidden="true"><label>Web <input type="text" name="li_web" tabindex="-1" autocomplete="off"></label></p>

			<label class="li-field"><span>Nombre y apellido *</span><input class="li-input" type="text" name="nombre" required autocomplete="name" value="<?php echo esc_attr( $datos['nombre'] ); ?>"></label>
			<label class="li-field"><span>Email *</span><input class="li-input" type="email" name="email" required autocomplete="email" value="<?php echo esc_attr( $datos['email'] ); ?>"></label>
			<label class="li-field"><span>Teléfono</span><input class="li-input" type="tel" name="telefono" autocomplete="tel" value="<?php echo esc_attr( $datos['telefono'] ); ?>"></label>
			<label class="li-field"><span>Número de pedido *</span><input class="li-input" type="text" name="pedido" required inputmode="numeric" value="<?php echo esc_attr( $datos['pedido'] ); ?>"></label>
			<label class="li-field li-field--full"><span>Motivo (opcional)</span><textarea class="li-input" name="motivo" rows="3"><?php echo esc_textarea( $datos['motivo'] ); ?></textarea></label>

			<p class="li-field--full"><button class="li-btn li-btn--primary li-btn--lg" type="submit">Enviar solicitud de arrepentimiento</button></p>
		</form>
	</div>
	<?php
	return (string) ob_get_clean();
}

/**
 * Genera el código, guarda la solicitud y manda los dos mails.
 *
 * @param array<string,string> $d Datos del formulario.
 */
function li_arrepentimiento_registrar( array $d ): string {
	$codigo = 'ARR-' . wp_date( 'Ymd' ) . '-' . strtoupper( wp_generate_password( 4, false, false ) );

	$lista = get_option( LI_ARREP_OPCION, array() );
	$lista = is_array( $lista ) ? $lista : array();
	array_unshift( $lista, $d + array( 'codigo' => $codigo, 'fecha' => current_time( 'mysql' ) ) );
	update_option( LI_ARREP_OPCION, array_slice( $lista, 0, 200 ), false );

	$cuerpo_local = sprintf(
		"Nueva solicitud de arrepentimiento (Botón de arrepentimiento de la web).\n\nCódigo: %s\nFecha: %s\nNombre: %s\nEmail: %s\nTeléfono: %s\nPedido: %s\nMotivo: %s\n\nHay que contactar al cliente y gestionar la devolución. El pedido no se modificó.",
		$codigo,
		wp_date( 'd/m/Y H:i' ),
		$d['nombre'],
		$d['email'],
		$d['telefono'] ? $d['telefono'] : '—',
		$d['pedido'],
		$d['motivo'] ? $d['motivo'] : '—'
	);
	wp_mail( get_option( 'admin_email' ), '[Lucas Innovaciones] Arrepentimiento ' . $codigo . ' · pedido ' . $d['pedido'], $cuerpo_local, array( li_arrepentimiento_remitente(), 'Reply-To: ' . $d['nombre'] . ' <' . $d['email'] . '>' ) );

	$cuerpo_cliente = sprintf(
		"Hola %s:\n\nRecibimos tu solicitud de arrepentimiento del pedido %s.\n\nTu código de identificación es: %s\n\nGuardalo. Te vamos a contactar para coordinar la devolución. Si tenés dudas, escribinos por WhatsApp al %s.\n\nLucas Innovaciones\n%s, %s",
		$d['nombre'],
		$d['pedido'],
		$codigo,
		LI_WHATSAPP_TEXTO,
		LI_DIRECCION,
		LI_LOCALIDAD
	);
	wp_mail( $d['email'], 'Tu solicitud de arrepentimiento: ' . $codigo, $cuerpo_cliente, array( li_arrepentimiento_remitente() ) );

	return $codigo;
}

/**
 * Remitente de los mails: "Lucas Innovaciones" en lugar de "WordPress", con la
 * misma dirección del dominio que WordPress ya usa (y que llega bien).
 */
function li_arrepentimiento_remitente(): string {
	$host = wp_parse_url( home_url(), PHP_URL_HOST );
	$host = preg_replace( '/^www\./', '', (string) $host );
	return 'From: Lucas Innovaciones <wordpress@' . $host . '>';
}

/**
 * Confirmación con el código.
 *
 * @param string $codigo Código generado.
 * @param string $email  Email del cliente.
 */
function li_arrepentimiento_confirmacion( string $codigo, string $email ): string {
	return sprintf(
		'<div class="li-arrep li-arrep--ok" role="status"><p class="li-arrep__titulo">Recibimos tu solicitud.</p><p>Tu código de identificación es</p><p class="li-arrep__codigo">%s</p><p>También te lo mandamos a <strong>%s</strong>. Te vamos a contactar para coordinar la devolución.</p></div>',
		esc_html( $codigo ),
		esc_html( $email )
	);
}
