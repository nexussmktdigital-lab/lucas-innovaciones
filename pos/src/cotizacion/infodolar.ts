/**
 * Leer el dólar blue de Córdoba de infodolar.com.
 *
 * Hasta acá la cotización la producía el plugin `lucas-cotizacion` de
 * WooCommerce (D22) y el POS solo la espejaba. El plugin dejó de contestar, así
 * que el valor viene de lo que alguien carga a mano en `F9`, y un dólar viejo
 * en un negocio que vende usados en dólares es plata.
 *
 * **Por qué no alcanza con la clase `.colCompraVenta`**, que es lo primero que
 * uno mira en el inspector: aparece 32 veces en esa página. La primera —la que
 * agarraría un selector suelto— es **$1.499,38**, que es el dólar *oficial* y
 * encima la columna de *compra*. El blue vendedor del mismo día es **$1.571,00**:
 * setenta y dos pesos de diferencia, el dólar equivocado y la punta equivocada.
 * Nadie se daría cuenta mirando el número.
 *
 * Así que la lectura se ancla en la tabla, no en la clase. La página tiene dos
 * tablas de promedio bien separadas:
 *
 *   <table id="Promedio">       → bancos y casas de cambio (el oficial)
 *   <table id="BluePromedio">   → «Dólar Blue en Córdoba»   ← esta
 *
 * y dentro de la del blue, la **segunda** celda `.colCompraVenta` es Venta,
 * que es el precio al que el local compra dólares y por lo tanto el que sirve
 * para poner precios.
 *
 * **Se rompe ruidosamente a propósito.** Si infodólar cambia el diseño, esto
 * tira error y la cotización anterior queda donde está. La alternativa —buscar
 * «algún número que parezca un dólar»— es la que un día devuelve el oficial y
 * repreica todo el catálogo sin que nadie se entere.
 *
 * Esto solo lee y parsea. Guardar es de `registrarCotizacion`, que tiene las
 * guardas de banda plausible y de salto máximo.
 */

export class ErrorInfodolar extends Error {}

export const URL_INFODOLAR =
  'https://www.infodolar.com/cotizacion-dolar-provincia-cordoba.aspx';

/**
 * Infodólar contesta distinto —o no contesta— según de dónde le peguen, así
 * que se pide como un navegador. Sin esto a veces devuelve una página de
 * bloqueo, que es HTML válido sin la tabla, y el parser la rechaza igual.
 */
const AGENTE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** La tarea corre cada dos horas: esperar más que esto no tiene sentido. */
export const TIMEOUT_MS = 15_000;

export interface BlueDeCordoba {
  compraCentavos: number;
  /** Lo que se usa para poner precios: a cuánto se vende el dólar. */
  ventaCentavos: number;
  /**
   * Cuándo dice la página que se actualizó el dato, si se pudo leer.
   *
   * Sirve para no guardar como «de ahora» un valor que infodólar tiene
   * congelado desde ayer: la página responde igual, con el número viejo.
   */
  actualizado: Date | null;
}

/**
 * Saca la fila del blue de Córdoba del HTML de la página.
 *
 * Se hace con expresiones regulares y no con un parser de DOM por lo mismo que
 * el CSV de la importación: lo que hay que leer es **una** tabla conocida de
 * una página conocida, y una dependencia más es una dependencia más que
 * mantener. Lo que lo hace seguro no es la herramienta sino el ancla: si la
 * tabla no está, no se devuelve nada.
 */
export function leerBlueCordoba(html: string): BlueDeCordoba {
  const tabla = /<table[^>]*\bid="BluePromedio"[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (!tabla) {
    throw new ErrorInfodolar(
      'La página de infodólar no trae la tabla del blue de Córdoba. ' +
        'Puede haber cambiado el diseño: hay que revisar el lector.',
    );
  }

  const cuerpo = tabla[1]!;

  /*
   * Se exige que la fila diga que es Córdoba. Es barato y ataja el caso feo:
   * que infodólar reuse el mismo `id` para el blue nacional en otra página o
   * tras un rediseño, y el POS se ponga a cobrar con una cotización de otra
   * provincia sin que nada falle.
   */
  if (!/dólar\s+blue|dolar\s+blue/i.test(cuerpo) || !/c[óo]rdoba/i.test(cuerpo)) {
    throw new ErrorInfodolar(
      'La tabla del blue no dice ser la de Córdoba. No se guarda nada hasta revisarlo.',
    );
  }

  // `data-order` trae el número limpio, sin la flechita de variación que vive
  // en el mismo `<td>`.
  const celdas = [...cuerpo.matchAll(/class="colCompraVenta"[^>]*data-order="([^"]*)"/gi)].map(
    (m) => m[1]!,
  );

  if (celdas.length < 2) {
    throw new ErrorInfodolar(
      `La fila del blue de Córdoba trae ${celdas.length} precio(s) y hacen falta dos ` +
        '(compra y venta). Hay que revisar el lector.',
    );
  }

  const compraCentavos = aCentavosDeInfodolar(celdas[0]!);
  const ventaCentavos = aCentavosDeInfodolar(celdas[1]!);

  // La venta por debajo de la compra es la señal de que están al revés.
  if (ventaCentavos < compraCentavos) {
    throw new ErrorInfodolar(
      `Infodólar devolvió venta (${ventaCentavos / 100}) por debajo de compra ` +
        `(${compraCentavos / 100}). Algo se leyó al revés y no se guarda.`,
    );
  }

  return { compraCentavos, ventaCentavos, actualizado: leerFecha(cuerpo) };
}

/** «$ 1.571,00» a centavos. El punto es de miles y la coma, decimal. */
function aCentavosDeInfodolar(crudo: string): number {
  const limpio = crudo.replace(/[$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(limpio);

  if (!Number.isFinite(n) || n <= 0) {
    throw new ErrorInfodolar(`Infodólar devolvió «${crudo}», que no es un precio.`);
  }
  return Math.round(n * 100);
}

/**
 * La hora del dato, del `title` del `<abbr>`: «jueves, 1 de octubre de 2026
 * 17:51 Argentina».
 *
 * Si no se puede leer se devuelve null y quien llama usa la hora de ahora: que
 * no se entienda la fecha no es razón para descartar una cotización buena.
 */
function leerFecha(cuerpo: string): Date | null {
  const m = /<abbr[^>]*\btitle="([^"]*)"/i.exec(cuerpo);
  if (!m) return null;

  const f =
    /(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})\s+(\d{1,2}):(\d{2})/i.exec(m[1]!);
  if (!f) return null;

  const mes = MESES.indexOf(f[2]!.toLowerCase());
  if (mes === -1) return null;

  // La página la da en hora argentina (UTC-3), que es la del local.
  const iso = `${f[3]}-${String(mes + 1).padStart(2, '0')}-${String(Number(f[1])).padStart(2, '0')}T${String(Number(f[4])).padStart(2, '0')}:${f[5]}:00-03:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Pide la página y la lee. `fetchImpl` se inyecta para poder probarlo. */
export async function obtenerBlueCordoba(
  fetchImpl: typeof fetch = fetch,
): Promise<BlueDeCordoba> {
  const corte = AbortSignal.timeout(TIMEOUT_MS);

  let respuesta: Response;
  try {
    respuesta = await fetchImpl(URL_INFODOLAR, {
      signal: corte,
      headers: { 'user-agent': AGENTE, accept: 'text/html' },
      // La página cambia cada pocos minutos; una respuesta cacheada por la
      // plataforma haría que la tarea guarde el mismo número cada dos horas.
      cache: 'no-store',
    });
  } catch (error) {
    throw new ErrorInfodolar(
      `No se pudo abrir infodólar: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!respuesta.ok) {
    throw new ErrorInfodolar(`Infodólar contestó ${respuesta.status}.`);
  }

  return leerBlueCordoba(await respuesta.text());
}
