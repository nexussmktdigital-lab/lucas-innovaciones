/*
 * Chequeo del filtro contra los nombres reales de producción.
 *
 * No hace falta probar los 293: las reglas nuevas por nombre solo pueden
 * tocar los que nombran una marca de teléfono o una palabra de servicio.
 * El resto solo lo decide la categoría, que es comparación exacta de slug.
 * Entonces el conjunto decisivo es este: todos los que nombran una marca,
 * más el único servicio del catálogo.
 */
import { sePuedeFotografiar } from './filtro.mjs';

// [id, nombre, categorías, ¿debería fotografiarse?]
const CASOS = [
	// --- Teléfonos: afuera ---
	[6286, 'Moto G 54 5G', ['smartphones-nuevos'], false],
	[6515, 'Moto G85 5g 256gb', ['smartphones-nuevos'], false],
	[6674, 'Xiaomi Poco C71 128gb', ['smartphones-nuevos'], false],
	[6712, 'Redmi 15C 128gb 4gb', ['smartphones-nuevos'], false],
	[6765, 'Xiaomi Poco C65 128gb', ['smartphones-nuevos'], false],
	[6794, 'Motorola Moto G15 128gb', ['smartphones-nuevos'], false],
	[6795, 'Motorola G86 5g 512gb', ['smartphones-nuevos'], false],
	[6804, 'Motorola G15 512gb', ['smartphones-nuevos'], false],
	[6883, 'Redmi Note 14 Pro 5G 256gb', ['smartphones-nuevos'], false],
	[6899, 'Samsung A17 256gb 8gb', ['smartphones-nuevos'], false],
	[6911, 'Motorola G67 256gb 4gb (Rec en $367.000)', ['smartphones-nuevos'], false],
	[6955, 'Realme C71 128gb 6gb', ['smartphones-nuevos'], false],
	[8027, 'Nokia 110 4G', ['smartphones-nuevos'], false],
	[7297, 'Samsung A15 128gb', ['smartphones-usados'], false],
	[6702, 'iPhone 14 Pro Max 128gb 89% (58146)', ['smartphones-usados'], false],
	[6707, 'iPhone 12 128gb 75% outlet (45039)', ['smartphones-usados'], false],
	[6766, 'iPhone 12 Pro 79% 128gb (33095)', ['smartphones-usados'], false],
	[6808, 'iPhone 15 Pro 256gb 81% (18676)', ['smartphones-usados'], false],
	[6840, 'iPhone 16 Pro 256gb 92% (68335)', ['smartphones-usados'], false],
	[6881, 'iPhone 17 Pro 256gb SELLADO (83937)', ['smartphones-nuevos'], false],
	[7099, 'iPhone 12 Pro Max 128gb 100% (5735)', ['telefonos-y-tablets', 'smartphones-usados'], false],
	[7279, 'iPhone 15 128gb 100% (653 Ciclos) (04592)', ['smartphones-usados'], false],
	[6933, 'iPhone 17 Pro Max SELLADO 256gb (21210)', ['smartphones-nuevos'], false],
	// Sin número de marca al principio: los salva la categoría.
	[9273, '17 pro max 512gb', ['smartphones-usados'], false],
	[9274, '17 Pro 256gb 99%', ['smartphones-usados'], false],
	[9276, '15 pro max 256gb 88%', ['smartphones-usados'], false],
	// Teléfonos sin categorizar: los saca la regla por nombre.
	[9157, 'Motorola G86 Power 256gb', ['sin-categorizar'], false],
	[9158, 'Samsung A17 256gb', ['sin-categorizar'], false],
	[9170, 'iPhone 18 Pro (256gb)', ['sin-categorizar'], false],
	[9253, 'iPhone 15 128gb 97% c/caja (12948)', ['sin-categorizar'], false],
	[9254, 'iPhone 17 Pro 256gb 99% (18282)', ['sin-categorizar'], false],
	[9255, 'Samsung A55 128gb', ['sin-categorizar'], false],
	[9256, 'Moto E15 64gb', ['sin-categorizar'], false],
	[9257, 'Samsung A57 256gb 8gb (1762)', ['sin-categorizar'], false],
	[9258, 'Motorola G05 256gb 4gb', ['sin-categorizar'], false],
	[8192, 'Xiaomi Poco C85 128gb', ['sin-categorizar'], false],
	[6849, 'Tablet INFINIX Xpad 20 11\'\' 128gb', ['tablets'], false],

	// --- Servicios: afuera ---
	[9169, 'Guillermo Zalazar cuota', ['sin-categorizar'], false],

	// --- Solo mostrador y vapers: afuera, como antes ---
	[6601, 'Auriculares AKG rep', ['auriculares-con-cable', 'solo-mostrador'], false],
	[7026, 'Vaper ElfBar 15k', ['vapers'], false],

	// --- Accesorios que nombran una marca de teléfono: ADENTRO ---
	[6285, 'Auricular c/cable Motorola', ['auriculares-con-cable'], true],
	[6296, 'Parlante inalámbrico Motorola', ['parlantes-portatiles'], true],
	[6329, 'Parlante inalámbrico Xiaomi Mi Pocket Speaker', ['parlantes-portatiles'], true],
	[9160, 'Cargador portatil Power bank Xiaomi 3 10k', ['sin-categorizar'], true],
	[6670, 'Bateria Nokia BL5C', ['pilas-y-baterias'], true],
	[6698, 'Microfono corbatero para iPhone lightning', ['microfonos'], true],
	[9176, 'Cable iphone usb tipo c a lightning ORIGINAL', ['sin-categorizar'], true],
	[9175, 'Funda iPad A16 10 gen/ 11 gen', ['sin-categorizar'], true],
	[7436, 'Adaptador Jack 3,5 a tipo C samsung', ['cables-y-adaptadores', 'cables-de-audio'], true],
	// La categoría «tablets» NO se excluye: ahí viven el Pencil y las fundas.
	// La tablet en sí la saca la regla de marca + capacidad (ver 6849).
	[6923, 'Apple Pencil 2da gen AAA', ['tablets'], true],
	// Un teléfono sin gigas en el nombre y sin categoría: lo salva abrir con
	// la marca. Hoy entran sin categorizar (9157, 9158), así que puede pasar.
	[0, 'Nokia 110 4G', ['sin-categorizar'], false],

	// --- Productos comunes: ADENTRO ---
	[9245, 'Freidora de aire VELTRO 8l VOAF08G', ['sin-categorizar'], true],
	[9249, 'Perfume 9am Dive Afnan', ['sin-categorizar'], true],
	[6378, 'Atma cup cake maker CM8910E', ['cocina'], true],
	[9162, 'Teclado mecánico NETMAK NM Alliance', ['sin-categorizar'], true],
	// Una notebook tiene gigas pero ninguna marca de teléfono: adentro.
	[9168, 'Notebook LENOVO IdeaPad Slim 3 i5 16gb 256gb', ['sin-categorizar'], true],
	[6540, 'Notebook HP Ryzen 7 16gb 512gb', ['notebooks'], true],
];

let fallos = 0;
for (const [id, nombre, cats, esperado] of CASOS) {
	const p = { name: nombre, categories: cats.map((slug) => ({ slug })) };
	const dio = sePuedeFotografiar(p);
	if (dio !== esperado) {
		fallos++;
		console.log(`✗ #${id} ${nombre} [${cats.join(',')}] → ${dio}, esperaba ${esperado}`);
	}
}
console.log(fallos === 0 ? `✓ ${CASOS.length} casos, todos bien` : `\n${fallos} de ${CASOS.length} mal`);
process.exit(fallos ? 1 : 0);
