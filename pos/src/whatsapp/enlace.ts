/**
 * El enlace que abre WhatsApp con el mensaje ya escrito.
 *
 * `wa.me` es la puerta oficial de click-to-chat: abre la conversacion con el
 * numero y el texto puesto en la caja de escribir, listo para apretar enviar.
 * Funciona con WhatsApp Web, con la app de escritorio y con el celular, sin
 * cuenta de Meta Business ni plantillas aprobadas.
 *
 * Esta es la unica pieza que cambia el dia que los mensajes tengan que salir
 * solos: el texto, a quien y con que control de repeticion vive en `mensajes`.
 */

/** El numero como lo quiere `wa.me`: solo digitos, sin `+`. */
export function numeroParaEnlace(telefonoE164: string): string {
  return telefonoE164.replace(/\D/g, '');
}

/**
 * Arma la URL de click-to-chat.
 *
 * El texto va con `encodeURIComponent` entero: los saltos de linea, los acentos
 * y los emojis del mensaje viajan bien y llegan tal cual se escribieron.
 */
export function enlaceDeWhatsApp(telefonoE164: string, texto: string): string {
  const numero = numeroParaEnlace(telefonoE164);
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}
