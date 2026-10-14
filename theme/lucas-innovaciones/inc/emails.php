<?php
/**
 * Mails de WooCommerce con la voz y la marca de la tienda (Matias 14/10).
 *
 * - Textos: la traducción de WooCommerce está en castellano de España
 *   ("Hemos recibido", "Aquí tienes"); acá se reemplazan por voseo. Se toma
 *   el texto original en inglés, así no depende de cómo venga traducido.
 * - Diseño: colores, logo y pie de la marca. Van como pre_option_ para que
 *   vivan en el código del tema y no en ajustes que alguien pueda pisar
 *   (los campos de WooCommerce → Ajustes → Correos electrónicos quedan sin efecto).
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || exit;

add_filter( 'gettext_woocommerce', 'li_textos_mails', 20, 2 );
/**
 * Textos de los mails en voseo.
 *
 * @param string $traduccion Texto traducido.
 * @param string $original   Texto original.
 * @return string
 */
function li_textos_mails( $traduccion, $original ) {
	static $mapa = array(
		// Pedido recibido (procesando: pagado con Mercado Pago o efectivo al retirar).
		'Your {site_title} order has been received!'                                  => '¡Recibimos tu pedido en {site_title}!',
		'Just to let you know &mdash; we\'ve received your order #%s, and it is now being processed:' => 'Recibimos tu pedido #%s y ya lo estamos preparando:',
		'Just to let you know &mdash; we’ve received your order, and it is now being processed.' => 'Recibimos tu pedido y ya lo estamos preparando.',
		'Thanks for using {site_url}!'                                                => '¡Gracias por elegirnos! Cualquier consulta, escribinos por WhatsApp.',

		// En espera (transferencia: falta acreditar el pago).
		'Thanks for your order. It’s on-hold until we confirm that payment has been received.' => 'Gracias por tu pedido. Queda en espera hasta que se acredite el pago.',
		'We’ve received your order and it’s currently on hold until we can confirm your payment has been processed.' => 'Recibimos tu pedido. Queda en espera hasta que se acredite el pago.',
		'Thanks for your order. It’s currently on hold while we confirm your payment via %s.' => 'Gracias por tu pedido. Queda en espera hasta que se acredite tu pago por %s.',
		'We’ll update you once payment has been confirmed. Here’s a summary of your order:' => 'Te avisamos cuando se acredite el pago. Este es el resumen de tu pedido:',
		'We look forward to fulfilling your order soon.'                              => 'Apenas se acredite el pago, preparamos tu pedido.',
		'Our bank details'                                                             => 'Nuestros datos bancarios',

		// Completado.
		'Your {site_title} order is now complete'                                     => 'Tu pedido en {site_title} está completo',
		'We have finished processing your order.'                                     => 'Tu pedido ya está completo.',

		// Comunes.
		'Here are the details of your order placed on %s:'                            => 'Acá tenés el detalle de tu pedido del %s:',
		'Your order details are as follows:'                                          => 'Este es el detalle de tu pedido:',
		'Here’s a reminder of what you’ve ordered:'                                   => 'Este es el detalle de lo que pediste:',
		'Here’s a reminder of what you’ve bought:'                                    => 'Este es el detalle de lo que compraste:',
		'We hope to see you again soon.'                                              => '¡Esperamos verte pronto de nuevo!',
		'Thanks for reading.'                                                         => 'Cualquier consulta, escribinos por WhatsApp.',

		// Pago fallido.
		'Your order at {site_title} was unsuccessful'                                 => 'No pudimos completar tu pedido en {site_title}',
		'Sorry, your order was unsuccessful'                                          => 'No pudimos completar tu pedido',
		'Unfortunately, we couldn\'t complete your order due to an issue with your payment method.' => 'No pudimos completar tu pedido por un problema con el medio de pago.',
		'If you\'d like to continue with your purchase, please return to %s and try a different method of payment.' => 'Si querés seguir con tu compra, volvé a %s y probá con otro medio de pago.',

		// Cancelado.
		'[{site_title}]: Your order #{order_number} has been cancelled'               => '[{site_title}]: Se canceló tu pedido n.º {order_number}',
		'We’re sorry to let you know that your order #%1$s has been cancelled.'       => 'Te avisamos que se canceló tu pedido n.º %1$s.',

		// Reintegro.
		'Your {site_title} order #{order_number} has been refunded'                   => 'Te reintegramos el pedido #{order_number} de {site_title}',
		'Your {site_title} order #{order_number} has been partially refunded'         => 'Te reintegramos parte del pedido #{order_number} de {site_title}',
		'Your order on %s has been refunded. There are more details below for your reference:' => 'Te reintegramos el pedido que hiciste en %s. Abajo tenés el detalle:',

		// Nota al cliente.
		'Note added to your {site_title} order from {order_date}'                     => 'Novedades de tu pedido del {order_date} en {site_title}',
		'A note has been added to your order'                                         => 'Hay novedades sobre tu pedido',
		'The following note has been added to your order:'                            => 'Te dejamos esta nota sobre tu pedido:',
		'As a reminder, here are your order details:'                                 => 'Para que lo tengas a mano, este es el detalle del pedido:',

		// Cuenta.
		'Your {site_title} account has been created!'                                 => '¡Ya tenés tu cuenta en {site_title}!',
		'Welcome to {site_title}'                                                     => 'Te damos la bienvenida a {site_title}',
		'Thanks for creating an account on %1$s. Your username is %2$s. You can access your account area to view orders, change your password, and more at: %3$s' => 'Gracias por crear tu cuenta en %1$s. Tu usuario es %2$s. Desde tu cuenta podés ver tus pedidos, cambiar la contraseña y más en: %3$s',
		'Thanks for creating an account on %s. Here’s a copy of your user details.'   => 'Gracias por crear tu cuenta en %s. Estos son tus datos de usuario.',
		'You can access your account area to view orders, change your password, and more via the link below:' => 'Desde tu cuenta podés ver tus pedidos, cambiar la contraseña y más con este enlace:',
		'We look forward to seeing you soon.'                                         => '¡Te esperamos pronto!',
		'Someone has requested a new password for the following account on %s:'       => 'Alguien pidió una contraseña nueva para esta cuenta en %s:',
		'If you didn\'t make this request, just ignore this email. If you\'d like to proceed:' => 'Si no lo pediste vos, ignorá este mail. Si querés seguir:',
		'Click here to reset your password'                                           => 'Tocá acá para crear una contraseña nueva',

		// Avisos al local (hotmail).
		'You’ve received the following order from %s:'                                => 'Recibiste este pedido de %s:',
		'Congratulations on the sale.'                                                => '¡Felicitaciones por la venta!',
		'Congratulations on the sale!'                                                => '¡Felicitaciones por la venta!',
		'Process your orders on the go. %1$sGet the app%2$s.'                         => '',
		'Notification to let you know &mdash; order #%1$s belonging to %2$s has been cancelled:' => 'Aviso: se canceló el pedido #%1$s de %2$s:',
		'Payment for order #%1$s from %2$s has failed. The order was as follows:'     => 'Falló el pago del pedido #%1$s de %2$s. Este era el pedido:',
		'Hopefully they’ll be back. Read more about <a href="https://woocommerce.com/document/managing-orders/">troubleshooting failed payments</a>.' => 'Puede que el cliente vuelva a intentarlo.',
	);
	return $mapa[ $original ] ?? $traduccion;
}

/**
 * Diseño de la marca: fondo gris claro, cabecera negra, texto oscuro y el
 * logo arriba (el PNG va bien sobre fondo claro: letras blancas con contorno).
 */
function li_mails_opciones(): array {
	return array(
		'woocommerce_email_base_color'            => '#0A0A0A',
		'woocommerce_email_background_color'      => '#F4F4F4',
		'woocommerce_email_body_background_color' => '#FFFFFF',
		'woocommerce_email_text_color'            => '#3A3A3A',
		'woocommerce_email_footer_text_color'     => '#6B6B6B',
		'woocommerce_email_header_image'          => LI_URI . '/assets/img/logo-li-192.png',
		'woocommerce_email_header_image_width'    => '200',
		'woocommerce_email_header_alignment'      => 'center',
		// Sin sincronizar con estilos de tema de bloques: el tema es clásico.
		'woocommerce_email_auto_sync_with_theme'  => 'no',
		'woocommerce_email_footer_text'           => '{site_title} · ' . LI_DIRECCION . ', ' . LI_LOCALIDAD . '<br>WhatsApp ' . LI_WHATSAPP_TEXTO . ' · {site_url}',
	);
}
foreach ( array_keys( li_mails_opciones() ) as $li_opcion ) {
	add_filter(
		'pre_option_' . $li_opcion,
		static function () use ( $li_opcion ) {
			return li_mails_opciones()[ $li_opcion ];
		}
	);
}
unset( $li_opcion );

add_filter( 'woocommerce_email_styles', 'li_mails_estilos', 20 );
/**
 * Detalles de marca: línea verde bajo la cabecera, enlaces en verde oscuro
 * (el verde de marca como texto no tiene contraste sobre blanco) y totales
 * más marcados.
 *
 * @param string $css Estilos de WooCommerce.
 * @return string
 */
function li_mails_estilos( $css ) {
	return $css . '
		#template_header { border-bottom: 4px solid #00E64D; }
		#header_wrapper h1 { color: #FFFFFF; font-weight: 700; }
		#body_content a, #template_footer a { color: #00A63A; }
		#template_header_image img { width: 200px; height: auto; }
		.td { border-color: #E5E5E5 !important; }
		.order-totals-last th, .order-totals-last td, tfoot tr:last-child th, tfoot tr:last-child td { font-size: 16px; font-weight: 700; color: #0A0A0A !important; }
	';
}
