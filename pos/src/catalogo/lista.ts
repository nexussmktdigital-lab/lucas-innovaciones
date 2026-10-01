/**
 * Leer la lista de una entrega tal como llega, sin convertirla a planilla.
 *
 * La importación por CSV ya existía y anda, pero pedía algo que nadie tiene a
 * mano cuando llega la mercadería: una planilla con encabezado. Lo que hay de
 * verdad es la lista que se escribe en el momento, un renglón por producto:
 *
 *   -Router TP-Link Archer C86 (5) $68.000 - 98.000
 *   -Cable iphone usb tipo c a lightning Eco (4+)
 *   -Memoria Kingston micro sd 128gb (eliminar)
 *   -iPhone 15 Pro Max 256gb 88% (34985) - $1.038.500 - $1.154.750
 *
 * Este módulo solo **lee** el texto; no toca la base. Lo que cada renglón
 * significa contra el catálogo de verdad —si es alta, si es sumarle stock a
 * algo que ya está, si no se encuentra— lo decide `entrega.ts`.
 *
 * **Las tres formas del paréntesis**, que son las tres cosas que hay que
 * distinguir y que un humano distingue sin pensar:
 *
 *  - `(5)` o `(4+)`: cuántas unidades llegaron. El `+` quiere decir «esas o
 *    más», que para cargar stock es lo mismo que el número.
 *  - `(34985)`: cuatro dígitos o más no es una cantidad, es el final de un
 *    IMEI. Nadie recibe treinta y cinco mil unidades de nada, y el techo del
 *    alta son mil. Son los usados, que entran de a uno y se identifican por
 *    ese número, así que la cantidad es 1 y el número se queda en el nombre.
 *  - `(eliminar)`: hay que darlo de baja.
 *
 * **Y la regla del precio**, que es la que más decide: un renglón **sin
 * precios** es uno que ya está en el catálogo y al que solo hay que sumarle lo
 * que llegó. Es la forma en que se escribe la lista cuando el precio no
 * cambió: no se repite lo que ya se sabe. Con precios, en cambio, hay dos
 * números y el orden es siempre **costo primero, precio al público después**.
 */
import { aCentavos } from '@/lib/dinero';
import { TECHO_PRECIO_ALTA_CENTAVOS, TECHO_STOCK_ALTA } from './crear';

/** Qué pide el renglón. El destino final lo resuelve `entrega.ts`. */
export type AccionDeLista = 'cargar' | 'sumar' | 'baja';

export interface RenglonDeLista {
  /** Número de renglón en el texto pegado, contando desde 1. */
  linea: number;
  /** El renglón tal cual se escribió, para poder mostrarlo si falla. */
  crudo: string;
  nombre: string;
  accion: AccionDeLista;
  cantidad: number;
  costoCentavos: number | null;
  /** Precio al público. Nulo cuando el renglón no trae precios. */
  precioCentavos: number | null;
  /** Los dígitos de IMEI que venían entre paréntesis, si los había. */
  imei: string | null;
  /** Por qué no se puede leer. Si está, el renglón no sirve. */
  error: string | null;
}

/** Lo que se escribe entre paréntesis para pedir una baja. */
const PEDIDOS_DE_BAJA = ['eliminar', 'eliminarlo', 'borrar', 'borrarlo', 'baja', 'dar de baja'];

/**
 * Desde acá un número entre paréntesis deja de ser una cantidad.
 *
 * Mil es el techo de una entrega, así que cuatro dígitos ya no puede ser otra
 * cosa que un IMEI. No se exige que el nombre diga «iPhone»: un Samsung usado
 * entra igual, y un día va a entrar.
 */
const DIGITOS_DE_IMEI = 4;

/** Dólares. Hoy no se pueden cargar desde acá, así que se avisa y se frena. */
const MARCA_DE_DOLARES = /u\$s|u\$d|us\$|\busd\b|d[óo]lar/i;

/** Viñetas con las que suele arrancar cada renglón de una lista escrita a mano. */
const VINIETA = /^[-–—•*·]+\s*/;

export function leerLista(texto: string): RenglonDeLista[] {
  const renglones: RenglonDeLista[] = [];

  texto.split('\n').forEach((crudo, indice) => {
    const limpio = crudo.replace(VINIETA, '').trim();
    if (limpio === '') return;

    renglones.push(leerRenglon(limpio, indice + 1));
  });

  return renglones;
}

function leerRenglon(crudo: string, linea: number): RenglonDeLista {
  const base: RenglonDeLista = {
    linea,
    crudo,
    nombre: crudo,
    accion: 'cargar',
    cantidad: 1,
    costoCentavos: null,
    precioCentavos: null,
    imei: null,
    error: null,
  };

  const falla = (error: string): RenglonDeLista => ({ ...base, error });

  if (MARCA_DE_DOLARES.test(crudo)) {
    return falla(
      'Está en dólares. Pasalo a pesos: el sistema carga los precios en pesos y la ' +
        'cotización del día la pone WooCommerce.',
    );
  }

  /*
   * El precio arranca en el primer `$`, y todo lo de antes es el nombre.
   *
   * Partir por el guion no sirve: los nombres los tienen («TL-WA850RE»,
   * «TP-Link»). El `$` no aparece nunca en un nombre de producto, y cuando
   * aparece es porque alguien escribió una nota de plata, que el alta ya separa
   * sola.
   */
  const donde = crudo.indexOf('$');
  const zonaNombre = donde === -1 ? crudo : crudo.slice(0, donde);
  const zonaPrecios = donde === -1 ? '' : crudo.slice(donde);

  const marca = ultimoParentesis(zonaNombre);
  // El guion de «(34985) - $1.038.500» queda colgando al sacar el paréntesis, y
  // el hueco que deja el paréntesis en el medio son dos espacios.
  let nombre = (marca ? marca.resto : zonaNombre)
    .replace(/\s+/g, ' ')
    .replace(/[\s\-–—:]+$/, '')
    .trim();

  if (nombre === '') return falla('El renglón no tiene nombre.');

  let accion: AccionDeLista = zonaPrecios === '' ? 'sumar' : 'cargar';
  let cantidad = 1;
  let imei: string | null = null;

  if (marca) {
    const adentro = marca.adentro.trim().toLowerCase();

    if (PEDIDOS_DE_BAJA.includes(adentro)) {
      accion = 'baja';
    } else if (new RegExp(`^\\d{${DIGITOS_DE_IMEI},}$`).test(adentro)) {
      imei = adentro;
      // El IMEI vuelve al nombre: es lo que distingue un usado de otro, y sin
      // él dos iPhone 15 del mismo modelo son la misma ficha.
      nombre = `${nombre} (${adentro})`;
    } else {
      const unidades = /^(\d{1,3})\s*\+?$/.exec(adentro);
      if (!unidades) {
        return falla(
          `No entiendo «(${marca.adentro.trim()})». Entre paréntesis va la cantidad que ` +
            'llegó, el final del IMEI, o «eliminar».',
        );
      }
      cantidad = Number(unidades[1]);
    }
  }

  if (accion === 'baja') {
    if (zonaPrecios !== '') {
      return falla('Dice «eliminar» y además trae precios. Dejá una cosa sola.');
    }
    return { ...base, nombre, accion: 'baja', cantidad: 0, imei };
  }

  if (cantidad < 1 || cantidad > TECHO_STOCK_ALTA) {
    return falla(
      `${cantidad} unidades no es una entrega: el tope son ${TECHO_STOCK_ALTA} por renglón.`,
    );
  }

  if (accion === 'sumar') {
    return { ...base, nombre, accion: 'sumar', cantidad, imei };
  }

  const numeros = separarPrecios(zonaPrecios);
  if (numeros.length === 0) return falla('No le encuentro el precio.');
  if (numeros.length > 2) {
    return falla(
      `Tiene ${numeros.length} precios. Van dos: primero el costo y después el precio al público.`,
    );
  }

  /*
   * Con dos números son costo y precio, en ese orden. Con uno solo es el precio
   * al público: es el dato que no se puede adivinar —sin él no se puede
   * vender— mientras que el costo solo alimenta el reporte de margen y se puede
   * completar después.
   */
  const [a, b] = numeros;
  const costoCrudo = numeros.length === 2 ? a! : null;
  const precioCrudo = numeros.length === 2 ? b! : a!;

  let precioCentavos: number;
  let costoCentavos: number | null = null;
  try {
    precioCentavos = aCentavos(precioCrudo);
    if (costoCrudo !== null) costoCentavos = aCentavos(costoCrudo);
  } catch {
    return falla(`No entiendo los números «${zonaPrecios.trim()}».`);
  }

  if (precioCentavos <= 0) return falla('El precio al público tiene que ser mayor a cero.');
  if (precioCentavos > TECHO_PRECIO_ALTA_CENTAVOS) {
    return falla('Ese precio es imposible. Fijate si sobran ceros.');
  }
  if (costoCentavos !== null && (costoCentavos < 0 || costoCentavos > TECHO_PRECIO_ALTA_CENTAVOS)) {
    return falla('Ese costo es imposible. Fijate si sobran ceros.');
  }

  return {
    ...base,
    nombre,
    accion: 'cargar',
    cantidad,
    costoCentavos,
    precioCentavos,
    imei,
  };
}

/**
 * El último paréntesis de la zona del nombre, con el nombre sin él.
 *
 * Es el último y no el primero porque el nombre puede traer los suyos —«(a
 * presupuestar)», «(2 unidades)»— y el que marca la cantidad va siempre al
 * final, pegado a los precios.
 */
function ultimoParentesis(zona: string): { adentro: string; resto: string } | null {
  const cierra = zona.lastIndexOf(')');
  if (cierra === -1) return null;
  const abre = zona.lastIndexOf('(', cierra);
  if (abre === -1) return null;

  return {
    adentro: zona.slice(abre + 1, cierra),
    resto: `${zona.slice(0, abre)} ${zona.slice(cierra + 1)}`,
  };
}

/**
 * Los números de la zona de precios, en orden.
 *
 * Se parte por el guion y no por el `$` porque el segundo precio muchas veces
 * viene sin signo: «$29.400 - 49.000». Lo que separa un precio del otro es
 * siempre el guion.
 */
function separarPrecios(zona: string): string[] {
  return zona
    .replace(/\$/g, ' ')
    .split(/[-–—]/)
    .map((x) => x.trim())
    .filter((x) => x !== '');
}
