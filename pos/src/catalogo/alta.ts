/**
 * Alta de productos: lo que se puede decidir sin preguntarle a nadie.
 *
 * Dar de alta un producto en el mostrador tiene que llevar segundos, y hoy no
 * existe: el catalogo solo entra por WooCommerce. Cuando llega mercaderia
 * nueva, o cuando alguien pide un servicio que todavia no esta catalogado, la
 * venta se traba (D24: ninguna linea existe sin un producto real).
 *
 * Este modulo es la parte puramente local del alta: armar un SKU que siga la
 * convencion del catalogo y limpiar el titulo antes de que se publique. No
 * toca la base ni la red, asi que se puede probar entero.
 */
import { normalizar } from '@/lib/texto';

export class ErrorAlta extends Error {}

/**
 * Prefijos de SKU por categoria, tal como estan en el catalogo real.
 *
 * El catalogo usa `CAT-MARCA-NOMBRE`: `ALM-HIKS-PENDRI32G`, `VID-GEN-HIDROG`,
 * `CAR-FOX-FOX-2`. No se inventa una convencion nueva: un SKU que no se parece
 * a los demas es un SKU que despues nadie busca.
 */
export const PREFIJOS: Record<string, string> = {
  'vidrios templados e hidrogel': 'VID',
  fundas: 'FND',
  'cables de carga': 'CAB',
  'cargadores de pared': 'CAR',
  'auriculares inalambricos': 'AUR',
  almacenamiento: 'ALM',
  'smartphones nuevos': 'CEL',
  'smartphones usados': 'CEL',
  telefonia: 'TEL',
  'servicio tecnico': 'SERV',
  parlantes: 'PAR',
  accesorios: 'ACC',
};

/** Cuando la categoria no esta en la tabla: las tres primeras letras. */
export function prefijoDe(categoria: string | null): string {
  const limpia = normalizar(categoria ?? '');
  const conocido = PREFIJOS[limpia];
  if (conocido) return conocido;

  const letras = soloLetrasYNumeros(limpia);
  return letras.slice(0, 3).toUpperCase() || 'GEN';
}

/** `GEN` es lo que usa el catalogo para lo que no tiene marca. */
export function trozoDeMarca(marca: string | null): string {
  const letras = soloLetrasYNumeros(normalizar(marca ?? ''));
  return letras.slice(0, 4).toUpperCase() || 'GEN';
}

function soloLetrasYNumeros(s: string): string {
  return s.replace(/[^a-z0-9]/g, '');
}

/**
 * Propone un SKU para un producto nuevo.
 *
 * `usados` es el conjunto de SKU que ya existen. Si el candidato choca, se le
 * agrega un sufijo numerico, que es exactamente lo que hizo quien cargo
 * `CAR-FOX-FOX-2` en su momento.
 */
export function sugerirSku(
  datos: { nombre: string; categoria?: string | null; marca?: string | null },
  usados: Iterable<string> = [],
): string {
  const nombre = soloLetrasYNumeros(normalizar(datos.nombre));
  if (nombre.length === 0) {
    throw new ErrorAlta('Hace falta el nombre del producto para armar el SKU.');
  }

  const base = [prefijoDe(datos.categoria ?? null), trozoDeMarca(datos.marca ?? null), nombre.slice(0, 10).toUpperCase()].join(
    '-',
  );

  const tomados = new Set<string>();
  for (const s of usados) tomados.add(s.trim().toUpperCase());

  if (!tomados.has(base)) return base;

  for (let n = 2; n < 1000; n += 1) {
    const candidato = `${base}-${n}`;
    if (!tomados.has(candidato)) return candidato;
  }

  throw new ErrorAlta('No se pudo armar un SKU distinto de los que ya existen.');
}

export interface TituloLimpio {
  /** El titulo que se publica. */
  titulo: string;
  /** Lo que se saco del titulo, para guardarlo como nota interna. */
  notaInterna: string | null;
}

/*
 * Notas internas que aparecen en los titulos publicados del catalogo real:
 *
 *   iPhone 13 128gb 86% (54265) (Rec en enero $290, hoy a $250)
 *   iPhone 15 128gb 87% (08331) (Pia, cambio glass idrop $390)
 *
 * Son precios de compra, nombres de clientes y margenes. Hoy no molestan
 * porque nadie mira la web; en una tienda publica quedan expuestos. Al dar de
 * alta se separan solos, y no se pierden: van al campo interno.
 */
const SENIAL_DE_NOTA = /\$|\brec\b|\bcost|\bcompr|\bpag|\bgana|\bmargen|\bdebe\b|\bfiad/i;

/**
 * Separa el titulo publico de la anotacion del vendedor.
 *
 * Solo saca los parentesis que **parecen** una nota interna: los que hablan de
 * plata o de una persona. `(a presupuestar)` y `(2 unidades)` se quedan, porque
 * son parte del nombre y sacarlos seria peor que dejarlos.
 */
export function limpiarTitulo(crudo: string): TituloLimpio {
  const entero = crudo.trim().replace(/\s+/g, ' ');
  if (entero === '') throw new ErrorAlta('El nombre del producto no puede estar vacío.');

  const notas: string[] = [];
  const titulo = entero
    .replace(/\(([^()]*)\)/g, (todo, adentro: string) => {
      if (!SENIAL_DE_NOTA.test(adentro)) return todo;
      notas.push(adentro.trim());
      return '';
    })
    .replace(/\s+/g, ' ')
    .trim();

  if (titulo === '') {
    // El titulo era solo la nota. Se deja como estaba: vale mas un titulo feo
    // que un producto sin nombre.
    return { titulo: entero, notaInterna: null };
  }

  return { titulo, notaInterna: notas.length > 0 ? notas.join(' · ') : null };
}
