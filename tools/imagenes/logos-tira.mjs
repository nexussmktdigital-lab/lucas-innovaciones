#!/usr/bin/env node
/**
 * Logos para la tira de marcas de la portada.
 *
 * Toma cada logo de theme/lucas-innovaciones/assets/img/marcas/ y genera en
 * marcas/tira/{slug}.png una silueta gris oscura sobre fondo transparente,
 * recortada al contenido y de 48 px de alto (2x de los 24 px que se muestran).
 *
 * Los logos que traen fondo sólido (p. ej. Vapex, letras blancas sobre naranja)
 * se separan por diferencia con el color de la esquina: lo que se parece al
 * fondo queda transparente.
 *
 *   node logos-tira.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(AQUI, '..', '..', 'theme', 'lucas-innovaciones', 'assets', 'img', 'marcas');
const SALIDA = path.join(DIR, 'tira');
const ALTO = 48;
const GRIS = [10, 10, 10]; // Se aclara con opacidad en CSS.

fs.mkdirSync(SALIDA, { recursive: true });

for (const archivo of fs.readdirSync(DIR).filter((f) => /\.(png|svg)$/.test(f))) {
	const slug = archivo.replace(/\.(png|svg)$/, '');
	const { data, info } = await sharp(path.join(DIR, archivo), { density: 300 })
		.resize({ height: 400, withoutEnlargement: false })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	// ¿Tiene transparencia útil? Si casi todo es opaco, el logo trae fondo.
	let opacos = 0;
	for (let i = 3; i < data.length; i += 4) if (data[i] > 200) opacos++;
	const conFondo = opacos / (info.width * info.height) > 0.95;
	const [fr, fg, fb] = [data[0], data[1], data[2]]; // color de la esquina

	const salida = Buffer.alloc(info.width * info.height * 4);
	for (let p = 0, i = 0; p < info.width * info.height; p++, i += 4) {
		let a = data[i + 3];
		if (conFondo) {
			const dist = Math.sqrt((data[i] - fr) ** 2 + (data[i + 1] - fg) ** 2 + (data[i + 2] - fb) ** 2);
			a = Math.max(0, Math.min(255, Math.round((dist - 40) * 2)));
		}
		salida[i] = GRIS[0];
		salida[i + 1] = GRIS[1];
		salida[i + 2] = GRIS[2];
		salida[i + 3] = a;
	}

	const destino = path.join(SALIDA, `${slug}.png`);
	const recortado = await sharp(salida, { raw: { width: info.width, height: info.height, channels: 4 } })
		.trim({ threshold: 1 })
		.png()
		.toBuffer();
	const r = await sharp(recortado).resize({ height: ALTO }).png({ compressionLevel: 9, palette: true }).toFile(destino);
	console.log(`${slug.padEnd(10)} ${conFondo ? 'fondo quitado' : 'transparente '} -> ${r.width}x${r.height}  ${r.size} B`);
}
