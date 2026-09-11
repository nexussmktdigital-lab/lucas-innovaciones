/**
 * Verificacion de los webhooks de WooCommerce.
 *
 * Woo firma el cuerpo crudo con HMAC-SHA256 y el secreto compartido, y lo manda
 * en base64 en la cabecera `x-wc-webhook-signature`. Hay que comparar contra el
 * cuerpo TAL CUAL llego: si se parsea y se vuelve a serializar, la firma no da.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const CABECERA_FIRMA = 'x-wc-webhook-signature';
export const CABECERA_TOPICO = 'x-wc-webhook-topic';

export function firmar(cuerpo: string, secreto: string): string {
  return createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('base64');
}

/** Comparacion en tiempo constante, para no filtrar informacion por el reloj. */
export function firmaValida(cuerpo: string, firma: string | null, secreto: string): boolean {
  if (!firma || !secreto) return false;
  const esperada = Buffer.from(firmar(cuerpo, secreto));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length) return false;
  return timingSafeEqual(esperada, recibida);
}
