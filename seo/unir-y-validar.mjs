// Une los lotes de SEO de productos, valida reglas y arma el CSV para revisar.
//   node unir-y-validar.mjs
import fs from 'node:fs';

const crudo = JSON.parse(fs.readFileSync('productos-crudo.json', 'utf8'));
const porId = new Map(crudo.map((p) => [p.id, p]));
const salida = [];
for (let i = 1; i <= 8; i++) {
	const f = `lote-${i}-salida.json`;
	if (!fs.existsSync(f)) { console.log(`falta ${f}`); continue; }
	salida.push(...JSON.parse(fs.readFileSync(f, 'utf8')));
}

// Correcciones confirmadas por Matias/Lucas.
const correcciones = {
	6775: (x) => { // Redmi 15C: Lucas confirmó 8 GB de RAM (el nombre de Woo dice 4gb).
		x.keywords_secundarias = (x.keywords_secundarias || []).map((k) => k.replace(/4s?gb/gi, '8gb'));
		for (const k of ['nombre_seo', 'titulo_seo', 'meta_descripcion', 'descripcion']) x[k] = x[k].replace(/\b4\s?GB\b(?=[^0-9]*(RAM|de RAM)?)/gi, (m) => m.replace('4', '8'));
	},
};

const PROHIBIDAS = [/garant[ií]a/i, /\bcuotas?\b/i, /24\s?h/i, /100\s?%\s?original/i, /mejor precio/i, /[úu]ltimas unidades/i, /\bstock\b/i, /env[ií]o (en|r[aá]pido|inmediato|express)/i, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, /!{2,}/];
const palabras = (h) => h.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const oraciones = new Map();
const problemas = [];
const vistos = new Set();

// Relleno que los lotes repitieron en decenas de descripciones: contenido
// duplicado que no suma. Se saca la oración entera (y el <p> si queda vacío).
const RELLENO = [
	/una opci[oó]n pr[aá]ctica para el uso de todos los d[ií]as\./i,
	/si ten[eé]s dudas[^.<]*\./i,
	/escribinos si ten[eé]s dudas antes de comprar\./i,
	/somos (un local de tecnolog[ií]a|lucas innovaciones)[^.<]*\./i,
];
function limpiar(h) {
	let t = h;
	for (const re of RELLENO) t = t.replace(new RegExp('\\s*' + re.source, 'gi'), '');
	return t.replace(/<p>\s*<\/p>/g, '').replace(/\s{2,}/g, ' ').trim();
}

for (const x of salida) {
	if (correcciones[x.id]) correcciones[x.id](x);
	x.descripcion = limpiar(x.descripcion || '');
	vistos.add(x.id);
	const p = porId.get(x.id);
	if (!p) problemas.push(`${x.id}: no está en el catálogo`);
	if (!x.titulo_seo || x.titulo_seo.length > 60) problemas.push(`${x.id}: titulo_seo ${x.titulo_seo?.length}`);
	if (!x.meta_descripcion || x.meta_descripcion.length > 155 || x.meta_descripcion.length < 110) problemas.push(`${x.id}: meta ${x.meta_descripcion?.length}`);
	const w = palabras(x.descripcion || '');
	if (w < 40 || w > 130) problemas.push(`${x.id}: descripcion ${w} palabras`);
	if ((x.nombre_seo || '').length > 75) problemas.push(`${x.id}: nombre_seo ${x.nombre_seo.length}`);
	for (const campo of ['nombre_seo', 'titulo_seo', 'meta_descripcion', 'descripcion']) {
		for (const re of PROHIBIDAS) if (re.test(x[campo] || '')) problemas.push(`${x.id}: ${campo} tiene ${re}`);
	}
	for (const o of (x.descripcion || '').replace(/<[^>]+>/g, ' ').split(/(?<=[.!?])\s+/)) {
		const k = o.trim().toLowerCase();
		if (k.length > 40) oraciones.set(k, (oraciones.get(k) || 0) + 1);
	}
}
for (const p of crudo) if (!vistos.has(p.id)) problemas.push(`${p.id}: sin SEO (${p.publico})`);

// Oraciones repetidas en muchos productos: relleno que conviene variar o sacar.
const repetidas = [...oraciones.entries()].filter(([, n]) => n >= 15).sort((a, b) => b[1] - a[1]);

const q = (v) => { v = String(v ?? ''); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const cab = ['ID', 'Nombre actual', 'Categoría', 'Nombre SEO', 'Keyword principal', 'Keywords secundarias', 'Título SEO', 'Meta descripción', 'Descripción SEO (HTML)', 'Descripción actual (largo)'];
const filas = salida
	.sort((a, b) => (porId.get(a.id)?.padre || '').localeCompare(porId.get(b.id)?.padre || '') || a.nombre_seo.localeCompare(b.nombre_seo))
	.map((x) => { const p = porId.get(x.id) || {}; return [x.id, p.publico, (p.padre ? p.padre + ' > ' : '') + (p.cat || ''), x.nombre_seo, x.keyword, (x.keywords_secundarias || []).join(', '), x.titulo_seo, x.meta_descripcion, x.descripcion, p.desc_len]; });
fs.writeFileSync('productos-seo.csv', '﻿' + [cab, ...filas].map((r) => r.map(q).join(';')).join('\r\n') + '\r\n');
fs.writeFileSync('productos-seo.json', JSON.stringify(salida, null, 1));

console.log(`productos con SEO: ${salida.length} de ${crudo.length}`);
console.log(`problemas: ${problemas.length}`);
problemas.slice(0, 40).forEach((p) => console.log('  ' + p));
console.log(`oraciones repetidas en 15+ productos: ${repetidas.length}`);
repetidas.slice(0, 12).forEach(([o, n]) => console.log(`  ${n}× ${o.slice(0, 110)}`));
