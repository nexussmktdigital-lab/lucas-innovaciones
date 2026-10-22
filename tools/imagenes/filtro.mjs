/**
 * Qué producto entra en la búsqueda de fotos y cuál no.
 *
 * Vive aparte de `imagenes.mjs` por una razón: es la decisión que determina a
 * qué ficha le va a aparecer una foto, y una foto equivocada en producción es
 * peor que una ficha sin foto. Separado se puede probar con
 * `npm run chequear`, contra nombres reales del catálogo.
 */

export const EXCLUIR_CATS = [
	'solo-mostrador',
	'vapers',
	// Teléfonos: cada modelo tiene su color y todavía no está decidido cuál va.
	// Una foto de un iPhone negro en la ficha de uno blanco es peor que ninguna.
	'smartphones',
	'smartphones-nuevos',
	'smartphones-usados',
	'telefonos-y-tablets',
];

/*
 * Los teléfonos sin categorizar hay que sacarlos por el nombre, y ahí está el
 * riesgo: una docena de accesorios legítimos nombran una marca de teléfono
 * («Funda iPad», «Cable iPhone», «Parlante Xiaomi», «Batería Nokia»). Esos van.
 * Un teléfono se reconoce porque la marca abre el nombre («Moto E15 64gb») o
 * porque viene con su capacidad («iPhone 15 128gb»); un accesorio nombra la
 * marca en el medio y no tiene gigas.
 *
 * La categoría «tablets» no se excluye a propósito: ahí están el Apple Pencil
 * y las fundas. La tablet en sí cae por marca + capacidad.
 */
const MARCAS_TELEFONO =
	'iphone|ipad|samsung|motorola|moto|xiaomi|redmi|poco|realme|infinix|tecno|zte|honor|huawei|alcatel|nokia';
const ABRE_CON_MARCA = new RegExp(`^\\s*(?:${MARCAS_TELEFONO})\\b`, 'i');
const MARCA_CON_CAPACIDAD = new RegExp(`\\b(?:${MARCAS_TELEFONO})\\b.*?\\b\\d{2,4}\\s?gb\\b`, 'i');

/** Lo que no es un producto: reparaciones, señas, cuotas de un plan. */
const NO_ES_PRODUCTO =
	/(reparaci[oó]n|arreglo|mano de obra|cuota|se[ñn]a\b|servicio t[eé]cnico|cambio de (?:pantalla|m[oó]dulo|modulo|bater[ií]a|bateria|pin|vidrio))/i;

/** `p` es un producto de la REST de Woo: `{ name, categories: [{ slug }] }`. */
export function sePuedeFotografiar(p) {
	const cats = (p.categories || []).map((c) => c.slug);
	if (cats.some((s) => EXCLUIR_CATS.includes(s))) return false;
	if (NO_ES_PRODUCTO.test(p.name)) return false;
	if (ABRE_CON_MARCA.test(p.name) || MARCA_CON_CAPACIDAD.test(p.name)) return false;
	return true;
}
