#!/usr/bin/env node
/**
 * Fotos de producto para Lucas Innovaciones.
 *
 *   node imagenes.mjs exportar            productos sin imagen destacada -> datos/productos.json
 *   node imagenes.mjs buscar  [--limite N] [--todos] [--ids 1,2,3]
 *   node imagenes.mjs filtrar [--limite N] [--ids 1,2,3]
 *   node imagenes.mjs revisar             arma datos/revision.html
 *   node imagenes.mjs subir   [--limite N] [--ids 1,2,3] [--aprobadas ruta.json]
 *
 * Corre en la máquina de Matias. Todo es reanudable: cada paso guarda en
 * datos/ lo que ya hizo y, si se corta, sigue desde ahí. Las claves salen del
 * .env (SERPER_API_KEY, WC_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET, WP_USER,
 * WP_APP_PASSWORD) y nunca se imprimen.
 *
 * Lo único que se escribe en un producto es su imagen destacada (featured_media
 * por /wp/v2). El plugin li-tienda borra solo las metas viejas _lci_* de ese
 * producto cuando recibe la imagen.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DATOS = path.join(AQUI, 'datos');
const CANDIDATOS = path.join(DATOS, 'candidatos');
fs.mkdirSync(CANDIDATOS, { recursive: true });

/* ------------------------------------------------------------------ */
/* Configuración                                                       */
/* ------------------------------------------------------------------ */

function cargarEnv() {
	const posibles = [
		process.env.LI_ENV,
		path.join(AQUI, '.env'),
		path.join(AQUI, '..', '..', '.env'),
		path.join(AQUI, '..', '..', '..', 'lucas-tienda-kit', 'lucas-tienda-kit', '.env'),
	].filter(Boolean);
	for (const archivo of posibles) {
		if (!fs.existsSync(archivo)) continue;
		for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
			const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
			if (!m || m[1].startsWith('#')) continue;
			const valor = m[2].replace(/^(['"])(.*)\1$/, '$2');
			if (!(m[1] in process.env)) process.env[m[1]] = valor;
		}
		return archivo;
	}
	return null;
}

const ENV_USADO = cargarEnv();

function requerir(...claves) {
	const faltan = claves.filter((k) => !process.env[k]);
	if (faltan.length) {
		console.error(`Faltan en el .env: ${faltan.join(', ')}${ENV_USADO ? ` (leí ${ENV_USADO})` : ' (no encontré ningún .env)'}`);
		process.exit(1);
	}
}

const args = process.argv.slice(3);
const opcion = (nombre, def = null) => {
	const i = args.indexOf(`--${nombre}`);
	return i === -1 ? def : (args[i + 1] ?? true);
};

/* ------------------------------------------------------------------ */
/* Estado en disco                                                     */
/* ------------------------------------------------------------------ */

const ruta = (nombre) => path.join(DATOS, nombre);
const leer = (nombre, def) => (fs.existsSync(ruta(nombre)) ? JSON.parse(fs.readFileSync(ruta(nombre), 'utf8')) : def);
function guardar(nombre, datos) {
	const tmp = ruta(nombre) + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(datos, null, 1));
	fs.renameSync(tmp, ruta(nombre));
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const SOLO_IDS = opcion('ids') ? String(opcion('ids')).split(',').map((x) => parseInt(x, 10)) : null;

/* ------------------------------------------------------------------ */
/* Reglas de búsqueda                                                  */
/* ------------------------------------------------------------------ */

/** Marketplaces y competidores: sus fotos no se usan. */
const BLOQUEADOS = [
	'mercadolibre', 'mlstatic', 'mercadoshops', 'fravega', 'garbarino', 'musimundo', 'cetrogar', 'oncity',
	'megatone', 'naldo', 'compumundo', 'jumbo.com', 'carrefour', 'coto', 'tiendamia', 'aliexpress', 'alicdn',
	'alibaba', 'temu', 'shein', 'amazon', 'media-amazon', 'ebay', 'ebayimg', 'walmart', 'pinterest', 'pinimg',
	'facebook', 'fbcdn', 'instagram', 'cdninstagram', 'tiktok', 'youtube', 'ytimg', 'twitter', 'twimg',
	'olx', 'falabella', 'linio', 'shopee', 'wish.com', 'lucasinnovaciones',
];

/** Sitios oficiales conocidos, además de los que contienen el nombre de la marca. */
const OFICIALES = ['apple.com', 'samsung.com', 'mi.com', 'xiaomi', 'motorola', 'jbl.com', 'harman', 'kingston.com',
	'hiksemi', 'lexar.com', 'hikvision', 'westerndigital', 'sandisk', 'logitech', 'tp-link', 'philips', 'lg.com',
	'sony', 'stanley1913', 'noga', 'netmak', 'dinax', 'atma', 'redragon', 'genius', 'xtrike', 'ecopower', 'hyundai'];

const bloqueado = (url = '', dominio = '') => BLOQUEADOS.some((b) => url.toLowerCase().includes(b) || dominio.toLowerCase().includes(b));

function esOficial(url, marca) {
	let host = '';
	try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
	const m = (marca || '').toLowerCase().replace(/[^a-z0-9]/g, '');
	// La marca tiene que ser el comienzo de un tramo del dominio: 'alo' no es oficial en 'precialo.com.ar'.
	const tramos = host.split('.').map((t) => t.replace(/[^a-z0-9]/g, ''));
	return (m.length >= 3 && tramos.some((t) => t.startsWith(m))) || OFICIALES.some((o) => host.includes(o));
}

/**
 * Consulta para Serper: "marca + nombre limpio". Sin códigos internos entre
 * paréntesis ni porcentajes de batería. Los iPhones se buscan por modelo
 * genérico (la foto es la misma para todos los usados de ese modelo).
 */
function consulta(p) {
	const iphone = p.nombre.match(/^\s*iphone\s+(\d+\w?|se|x[rs]?)(\s+(pro max|pro|plus|mini|max|e))?/i);
	if (iphone) return `Apple iPhone ${iphone[1]}${iphone[2] ? ' ' + iphone[3] : ''}`.replace(/\s+/g, ' ').trim();

	let n = p.nombre
		.replace(/\(\s*\d{3,}\s*\)/g, ' ')       // códigos internos "(44012)"
		.replace(/\(\s*[^)]*ciclos?\s*\)/gi, ' ') // "(653 Ciclos)"
		.replace(/\b\d{1,3}\s?%/g, ' ')            // batería
		.replace(/\b(sellado|outlet|usado|nuevo|oferta|liquidaci[oó]n)\b/gi, ' ')
		.replace(/[|"'`´“”]/g, ' ')         // comillas (10") y barras: Serper las rechaza
		.replace(/\s+/g, ' ')
		.trim();
	if (p.marca && !n.toLowerCase().includes(p.marca.toLowerCase())) n = `${p.marca} ${n}`;
	return n;
}

/* ------------------------------------------------------------------ */
/* Pasos                                                               */
/* ------------------------------------------------------------------ */

const EXCLUIR_CATS = ['solo-mostrador', 'vapers'];

async function exportar() {
	requerir('WC_URL', 'WC_CONSUMER_KEY', 'WC_CONSUMER_SECRET');
	const base = process.env.WC_URL.replace(/\/+$/, '');
	const auth = 'Basic ' + Buffer.from(`${process.env.WC_CONSUMER_KEY}:${process.env.WC_CONSUMER_SECRET}`).toString('base64');
	const todos = [];

	for (let pagina = 1; ; pagina++) {
		const url = `${base}/wp-json/wc/v3/products?per_page=100&page=${pagina}&status=publish&_fields=id,name,sku,images,brands,categories,stock_status,price,type`;
		const r = await fetch(url, { headers: { Authorization: auth } });
		if (!r.ok) {
			console.error(`La REST de Woo respondió ${r.status} en la página ${pagina}.`);
			process.exit(1);
		}
		const lote = await r.json();
		todos.push(...lote);
		process.stdout.write(`\rLeídos ${todos.length} productos…`);
		if (lote.length < 100) break;
		await dormir(300);
	}

	const sinFoto = todos
		.filter((p) => !p.images || p.images.length === 0)
		.filter((p) => !(p.categories || []).some((c) => EXCLUIR_CATS.includes(c.slug)))
		.map((p) => ({
			id: p.id,
			nombre: p.name,
			marca: (p.brands && p.brands[0] && p.brands[0].name) || '',
			categoria: (p.categories || []).map((c) => c.name).join(' | '),
			sku: p.sku || '',
			prioridad: p.stock_status === 'instock' && parseFloat(p.price) > 1 ? 1 : 2,
		}))
		.sort((a, b) => a.prioridad - b.prioridad || a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre));

	guardar('productos.json', sinFoto);
	const p1 = sinFoto.filter((p) => p.prioridad === 1).length;
	console.log(`\n${sinFoto.length} productos sin foto (${p1} con stock y precio, que van primero) -> datos/productos.json`);
}

async function buscar() {
	requerir('SERPER_API_KEY');
	const productos = leer('productos.json', null);
	if (!productos) return console.error('Primero: node imagenes.mjs exportar');

	const estado = leer('busquedas.json', { productos: {}, consultas: {} });
	const limite = parseInt(opcion('limite', '0'), 10) || Infinity;
	const pendientes = productos.filter((p) => (opcion('todos') || p.prioridad === 1) && !estado.productos[p.id] && (!SOLO_IDS || SOLO_IDS.includes(p.id)));
	let llamadas = 0;
	let hechos = 0;

	for (const p of pendientes) {
		if (hechos >= limite) break;
		const q = consulta(p);

		if (!estado.consultas[q]) {
			let intento = 0;
			for (;;) {
				let r;
				try {
					r = await fetch('https://google.serper.dev/images', {
						method: 'POST',
						headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
						body: JSON.stringify({ q, gl: 'ar', hl: 'es-419', num: 20 }),
						signal: AbortSignal.timeout(30000),
					});
				} catch (e) {
					// Corte de red: se espera y se reintenta; si sigue, se guarda y se sale.
					if (intento < 5) {
						intento++;
						await dormir(15000 * intento);
						continue;
					}
					console.error(`\nSin conexión con Serper (${e.cause?.code || e.message}). Se guarda lo hecho; volvé a correr para seguir.`);
					guardar('busquedas.json', estado);
					process.exit(1);
				}
				if (r.status === 429 && intento < 5) {
					intento++;
					await dormir(10000 * intento);
					continue;
				}
				if (r.status === 400) {
					// Consulta que Serper no acepta: el producto queda sin opciones y se sigue.
					estado.consultas[q] = [];
					break;
				}
				if (!r.ok) {
					console.error(`\nSerper respondió ${r.status} para "${q}". Se guarda lo hecho; volvé a correr para seguir.`);
					guardar('busquedas.json', estado);
					process.exit(1);
				}
				const j = await r.json();
				estado.consultas[q] = (j.images || [])
					.filter((im) => im.imageUrl && !bloqueado(im.imageUrl, im.domain || im.link || ''))
					.slice(0, 6)
					.map((im) => ({ url: im.imageUrl, fuente: im.link || '', dominio: im.domain || '', ancho: im.imageWidth || 0, alto: im.imageHeight || 0, titulo: im.title || '' }));
				llamadas++;
				break;
			}
			await dormir(350);
		}

		estado.productos[p.id] = { q, opciones: estado.consultas[q] };
		hechos++;
		if (hechos % 10 === 0) guardar('busquedas.json', estado);
		process.stdout.write(`\rBuscados ${hechos}/${Math.min(pendientes.length, limite)} · llamadas a Serper: ${llamadas}`);
	}
	guardar('busquedas.json', estado);
	console.log(`\nListo. ${Object.keys(estado.productos).length} productos con opciones -> datos/busquedas.json`);
}

async function analizar(buf, marca, url) {
	const sharp = (await import('sharp')).default;
	const img = sharp(buf, { failOn: 'none' });
	const meta = await img.metadata();
	const w = meta.width || 0;
	const h = meta.height || 0;
	// Fondo: se mira el borde de la imagen reducida a 64×64.
	const { data } = await sharp(buf, { failOn: 'none' }).flatten({ background: '#ffffff' }).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	const lum = [];
	for (let y = 0; y < 64; y++) {
		for (let x = 0; x < 64; x++) {
			if (x > 3 && x < 60 && y > 3 && y < 60) continue;
			const i = (y * 64 + x) * 3;
			lum.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
		}
	}
	const media = lum.reduce((a, b) => a + b, 0) / lum.length;
	const desvio = Math.sqrt(lum.reduce((a, b) => a + (b - media) ** 2, 0) / lum.length);
	const claro = media > 225 && desvio < 22;
	const cuadrada = Math.min(w, h) / Math.max(w, h || 1);
	const oficial = esOficial(url, marca);
	const puntaje = cuadrada * 2 + (claro ? 2 : 0) + (oficial ? 2 : 0) + Math.min(1, Math.min(w, h) / 1200);
	return { w, h, claro, oficial, cuadrada: +cuadrada.toFixed(2), puntaje: +puntaje.toFixed(2) };
}

async function filtrar() {
	const sharp = (await import('sharp')).default;
	const productos = leer('productos.json', []);
	const busquedas = leer('busquedas.json', { productos: {} });
	const estado = leer('filtradas.json', {});
	const limite = parseInt(opcion('limite', '0'), 10) || Infinity;
	const pendientes = productos.filter((p) => busquedas.productos[p.id] && !estado[p.id] && (!SOLO_IDS || SOLO_IDS.includes(p.id)));
	let hechos = 0;

	for (const p of pendientes) {
		if (hechos >= limite) break;
		const ok = [];
		for (const op of busquedas.productos[p.id].opciones) {
			try {
				const r = await fetch(op.url, {
					headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' },
					signal: AbortSignal.timeout(15000),
					redirect: 'follow',
				});
				const tipo = r.headers.get('content-type') || '';
				if (!r.ok || !tipo.startsWith('image/')) continue;
				const buf = Buffer.from(await r.arrayBuffer());
				if (buf.length > 12 * 1024 * 1024) continue;
				const a = await analizar(buf, p.marca, op.url);
				// Mínimo 800 px del lado mayor y 600 del menor: una foto apaisada de
				// 1200×800 sirve; un ícono de 300×300, no.
				if (Math.max(a.w, a.h) < 800 || Math.min(a.w, a.h) < 600) continue;
				ok.push({ ...a, url: op.url, fuente: op.fuente, buf });
			} catch {
				/* sin respuesta, formato raro o tiempo agotado: se descarta */
			}
		}

		ok.sort((x, y) => y.puntaje - x.puntaje);
		const elegidas = [];
		for (const [k, o] of ok.slice(0, 3).entries()) {
			const archivo = `${p.id}-${k + 1}.jpg`;
			await sharp(o.buf, { failOn: 'none' })
				.flatten({ background: '#ffffff' })
				.resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
				.jpeg({ quality: 90 })
				.toFile(path.join(CANDIDATOS, archivo));
			const { buf, ...resto } = o;
			elegidas.push({ archivo, ...resto });
		}
		estado[p.id] = elegidas;
		hechos++;
		if (hechos % 5 === 0) guardar('filtradas.json', estado);
		process.stdout.write(`\rFiltrados ${hechos}/${Math.min(pendientes.length, limite)}`);
	}
	guardar('filtradas.json', estado);
	const con = Object.values(estado).filter((v) => v.length).length;
	console.log(`\nListo. ${con} productos con al menos una opción, ${Object.keys(estado).length - con} sin ninguna -> datos/filtradas.json`);
}

function revisar() {
	const productos = leer('productos.json', []);
	const filtradas = leer('filtradas.json', {});
	const subidas = leer('subidas.json', {});
	const lista = productos.filter((p) => filtradas[p.id] && filtradas[p.id].length && !subidas[p.id]);
	const sinOpciones = productos.filter((p) => filtradas[p.id] && !filtradas[p.id].length);
	const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

	const filas = lista.map((p) => `
<section class="p" data-id="${p.id}">
  <header><b>${esc(p.nombre)}</b><span>${esc(p.marca)} · ${esc(p.categoria)} · #${p.id}${p.prioridad === 1 ? ' · <i>con stock</i>' : ''}</span></header>
  <div class="ops">
    ${filtradas[p.id].map((o) => `<button class="op" data-archivo="${o.archivo}"><img loading="lazy" src="candidatos/${o.archivo}"><small>${o.w}×${o.h}${o.claro ? ' · fondo claro' : ''}${o.oficial ? ' · oficial' : ''}<br>${esc((() => { try { return new URL(o.fuente || o.url).hostname; } catch { return ''; } })())}</small></button>`).join('')}
    <button class="op ninguna" data-archivo="">Ninguna</button>
  </div>
</section>`).join('');

	const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revisión de fotos</title>
<style>
:root{--n:#0A0A0A;--v:#00E64D;--b:#E5E5E5;--g:#6B6B6B}
body{margin:0;font-family:Inter,system-ui,sans-serif;background:#F4F4F4;color:var(--n)}
.top{position:sticky;top:0;z-index:2;background:var(--n);color:#fff;padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.top button{background:var(--v);border:0;border-radius:10px;padding:10px 16px;font-weight:600;cursor:pointer}
.top label{font-size:14px}
main{max-width:1200px;margin:0 auto;padding:16px}
.p{background:#fff;border:1px solid var(--b);border-radius:16px;padding:14px;margin-bottom:12px}
.p.hecho{opacity:.55}
.p header{display:flex;flex-direction:column;gap:2px;margin-bottom:10px}
.p header span{font-size:12px;color:var(--g)}
.ops{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.op{border:2px solid var(--b);border-radius:12px;background:#fff;padding:6px;cursor:pointer;text-align:center;font:inherit}
.op img{width:100%;aspect-ratio:1;object-fit:contain;background:#F8F8F8;border-radius:8px}
.op small{display:block;font-size:11px;color:var(--g);margin-top:4px}
.op.sel{border-color:var(--v);background:#F5FFF7}
.ninguna{display:flex;align-items:center;justify-content:center;font-weight:600;min-height:80px}
.ninguna.sel{border-color:#D63131;background:#FCE8E8}
.sin{font-size:13px;color:var(--g)}
@media(max-width:700px){.ops{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body>
<div class="top"><b>Fotos para revisar: ${lista.length}</b><span id="cuenta"></span>
<label><input type="checkbox" id="pend"> Solo pendientes</label>
<button id="exp">Exportar aprobadas.json</button></div>
<main>
<p class="sin">Un clic elige la foto; "Ninguna" descarta el producto. Lo elegido queda guardado en este navegador. Al terminar, "Exportar aprobadas.json" y guardalo en tools/imagenes/datos/.</p>
${filas}
${sinOpciones.length ? `<details><summary class="sin">${sinOpciones.length} productos sin ninguna foto que pase el filtro</summary><ul>${sinOpciones.map((p) => `<li class="sin">#${p.id} ${esc(p.nombre)}</li>`).join('')}</ul></details>` : ''}
</main>
<script>
var K='li-revision-fotos', sel={};
try{sel=JSON.parse(localStorage.getItem(K)||'{}')}catch(e){}
function pintar(){var n=0;document.querySelectorAll('.p').forEach(function(s){var id=s.dataset.id;var v=sel[id];s.classList.toggle('hecho',v!==undefined);if(v!==undefined)n++;
s.querySelectorAll('.op').forEach(function(b){b.classList.toggle('sel',v!==undefined&&b.dataset.archivo===(v||''))});
s.hidden=document.getElementById('pend').checked&&v!==undefined});
document.getElementById('cuenta').textContent=n+' revisados';try{localStorage.setItem(K,JSON.stringify(sel))}catch(e){}}
document.addEventListener('click',function(e){var b=e.target.closest('.op');if(!b)return;var id=b.closest('.p').dataset.id;sel[id]=b.dataset.archivo||null;pintar()});
document.getElementById('pend').addEventListener('change',pintar);
document.getElementById('exp').addEventListener('click',function(){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(sel,null,1)],{type:'application/json'}));a.download='aprobadas.json';a.click()});
pintar();
</script></body></html>`;
	fs.writeFileSync(ruta('revision.html'), html);
	console.log(`datos/revision.html: ${lista.length} productos para elegir. Abrilo en el navegador.`);
}

async function subir() {
	requerir('WC_URL', 'WP_USER', 'WP_APP_PASSWORD');
	const sharp = (await import('sharp')).default;
	const base = process.env.WC_URL.replace(/\/+$/, '');
	const auth = 'Basic ' + Buffer.from(`${process.env.WP_USER}:${process.env.WP_APP_PASSWORD.replace(/\s+/g, '')}`).toString('base64');

	let archAprob = opcion('aprobadas') || ruta('aprobadas.json');
	if (!fs.existsSync(archAprob) && fs.existsSync(path.join(os.homedir(), 'Downloads', 'aprobadas.json'))) {
		archAprob = path.join(os.homedir(), 'Downloads', 'aprobadas.json');
	}
	if (!fs.existsSync(archAprob)) return console.error('No encontré aprobadas.json. Exportalo desde revision.html.');

	const aprobadas = JSON.parse(fs.readFileSync(archAprob, 'utf8'));
	const productos = Object.fromEntries(leer('productos.json', []).map((p) => [p.id, p]));
	const subidas = leer('subidas.json', {});
	const soloIds = opcion('ids') ? String(opcion('ids')).split(',').map((x) => parseInt(x, 10)) : null;
	const limite = parseInt(opcion('limite', '0'), 10) || Infinity;
	const cola = Object.entries(aprobadas)
		.filter(([id, archivo]) => archivo && !subidas[id] && (!soloIds || soloIds.includes(parseInt(id, 10))))
		.slice(0, limite);

	let n = 0;
	for (const [id, archivo] of cola) {
		const p = productos[id] || { nombre: `producto-${id}` };
		const nombre = p.nombre.replace(/\s*\(\d{4,6}\)\s*$/, '').trim();
		const slug = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
		let mediaId = null;
		try {
			// Cuadrada de 1200 px con fondo blanco: WooCommerce recorta las
			// miniaturas a 1:1, y una foto vertical perdía la mitad del equipo.
			const webp = await sharp(path.join(CANDIDATOS, archivo), { failOn: 'none' })
				.flatten({ background: '#ffffff' })
				.resize(1200, 1200, { fit: 'contain', background: '#ffffff' })
				.webp({ quality: 82 })
				.toBuffer();

			const m = await fetch(`${base}/wp-json/wp/v2/media`, {
				method: 'POST',
				headers: { Authorization: auth, 'Content-Type': 'image/webp', 'Content-Disposition': `attachment; filename="${slug || 'producto'}.webp"` },
				body: webp,
			});
			if (!m.ok) throw new Error(`media ${m.status}`);
			const media = await m.json();
			mediaId = media.id;

			await fetch(`${base}/wp-json/wp/v2/media/${media.id}`, {
				method: 'POST',
				headers: { Authorization: auth, 'Content-Type': 'application/json' },
				body: JSON.stringify({ alt_text: nombre, title: nombre }),
			});

			const u = await fetch(`${base}/wp-json/wp/v2/product/${id}`, {
				method: 'POST',
				headers: { Authorization: auth, 'Content-Type': 'application/json' },
				body: JSON.stringify({ featured_media: media.id }),
			});
			if (!u.ok) throw new Error(`producto ${u.status}`);
			const prod = await u.json();
			if (prod.featured_media !== media.id) throw new Error('la imagen no quedó asignada');

			subidas[id] = { media: media.id, url: media.source_url, archivo, fecha: new Date().toISOString() };
			guardar('subidas.json', subidas);
			n++;
			console.log(`✓ #${id} ${nombre}`);
		} catch (e) {
			console.error(`✗ #${id} ${nombre}: ${e.message}`);
			// La imagen subió pero no quedó asignada: se borra para no dejarla suelta
			// en Medios (es la que subió esta misma corrida). Si el corte fue durante
			// la subida misma, no hay forma de saberlo acá: se revisa al final de la tanda.
			if (mediaId) {
				try {
					await fetch(`${base}/wp-json/wp/v2/media/${mediaId}?force=true`, { method: 'DELETE', headers: { Authorization: auth } });
					console.error(`  (imagen ${mediaId} borrada de Medios)`);
				} catch {
					console.error(`  (no se pudo borrar la imagen ${mediaId}: revisala en Medios)`);
				}
			}
		}
		await dormir(500);
	}
	console.log(`Subidas en esta corrida: ${n}. Total: ${Object.keys(subidas).length} -> datos/subidas.json`);
}

/* ------------------------------------------------------------------ */

const pasos = { exportar, buscar, filtrar, revisar, subir };
const paso = process.argv[2];
if (!pasos[paso]) {
	console.log('Uso: node imagenes.mjs exportar | buscar | filtrar | revisar | subir');
	process.exit(paso ? 1 : 0);
}
await pasos[paso]();
