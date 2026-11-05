/**
 * Leer una libreta de papel entera, tal como viene escrita.
 *
 * El local lleva estas cuentas en un cuaderno y las pasa por WhatsApp. Las
 * líneas se parecen a esto:
 *
 *     1 x Auricular NETMAK NM Live *$22.000*
 *     1 x Parlante NETMAK NM MUV RGB 5w BR *$24.000*
 *     ENTREGA $22.000 (16/6/26)
 *     1 x Glass $3.500
 *     ENTREGA $21.000 (19/06/26) (efectivo)
 *
 * Pedirle a alguien que vuelva a tipear sesenta renglones en un formulario es
 * pedirle que se equivoque, y el original ya está escrito. Entonces se pega
 * así, con el «ENTREGA», el signo, los puntos de mil, los asteriscos de
 * WhatsApp y los paréntesis, y esto lo entiende.
 *
 * **Cómo se agrupa.** Los renglones de mercadería entre dos entregas son una
 * compra: el cliente se llevó varias cosas y después pagó. La compra toma la
 * fecha de la entrega que la sigue, que es la primera fecha conocida después
 * de haberse llevado la mercadería.
 *
 * **Lo que no adivina es la fecha de una entrega.** Sin fecha no sirve para
 * lo único que se le va a preguntar a esta historia —«¿cuándo pagó la última
 * vez?»— y poner la de hoy sería inventarla. Se avisa y no se carga. Las
 * compras del final del cuaderno, que no tienen ninguna entrega debajo,
 * heredan la última fecha conocida y quedan marcadas como estimadas: ahí sí
 * hay de dónde sacar una fecha razonable, y mentir sería no decir que lo es.
 */
import type { MedioPago } from '@/ventas/carrito';
import type { EntregaDeLibreta } from './cuenta';

/** Cómo se escribe cada medio en el cuaderno, con los errores de tipeo que trae. */
const MEDIOS: Record<string, MedioPago> = {
  efectivo: 'efectivo',
  efvo: 'efectivo',
  contado: 'efectivo',
  transferencia: 'transferencia',
  tranferencia: 'transferencia',
  transf: 'transferencia',
  transferencias: 'transferencia',
  debito: 'debito',
  credito: 'credito',
  cheque: 'cheque',
  dolares: 'dolares',
  mercadopago: 'mercadopago',
  mp: 'mercadopago',
};

/** Sin medio escrito se asume efectivo, que es como paga casi siempre. */
export const MEDIO_POR_DEFECTO: MedioPago = 'efectivo';

/** Un renglón de mercadería del cuaderno: «3 x Cargador IBEK Tipo C $24.000». */
export interface RenglonDeCompra {
  texto: string;
  montoCentavos: number;
}

/** Los renglones entre dos entregas: una compra, con la fecha de la de abajo. */
export interface CompraDeLibreta {
  fecha: Date;
  /** True si la fecha se heredó porque no había ninguna entrega debajo. */
  fechaEstimada: boolean;
  renglones: RenglonDeCompra[];
  montoCentavos: number;
}

export interface LineaLeida {
  /** El renglón original, para poder señalarlo en la pantalla. */
  texto: string;
  entrega: EntregaDeLibreta | null;
  /** Por qué no se pudo leer, cuando `entrega` es null. */
  problema: string | null;
}

export interface LecturaDeLibreta {
  lineas: LineaLeida[];
  entregas: EntregaDeLibreta[];
  /** Lo que suman las entregas. */
  totalCentavos: number;
  compras: CompraDeLibreta[];
  /** Lo que suma la mercadería. */
  totalComprasCentavos: number;
  /** Cuántos renglones no se pudieron leer. */
  conProblema: number;
}

/** `16/6/26`, `19/06/2026`. Año de dos dígitos = 20xx. */
function leerFecha(d: string, m: string, a: string): Date | null {
  const dia = Number(d);
  const mes = Number(m);
  const anio = a.length <= 2 ? 2000 + Number(a) : Number(a);
  if (!dia || !mes || mes > 12 || dia > 31) return null;

  /*
   * Mediodía UTC y no medianoche: Argentina está en UTC−3, así que una fecha
   * a las 00:00 UTC se lee como el día anterior en el mostrador. El recibo
   * imprimiría el 15 donde el cuaderno dice 16.
   */
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 12));
  if (Number.isNaN(fecha.getTime()) || fecha.getUTCDate() !== dia) return null;
  return fecha;
}

/** `$22.000`, `22000`, `$ 1.801.400` -> centavos. */
function leerMonto(crudo: string): number | null {
  const limpio = crudo.replace(/[.\s]/g, '').replace(',', '.');
  const n = Number(limpio);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/**
 * Lee el texto pegado y devuelve renglón por renglón qué entendió.
 *
 * Devuelve todo, no solo lo que salió bien: quien pega treinta líneas tiene
 * que poder ver cuál de las treinta quedó afuera y por qué.
 */
/** Un renglón de mercadería: «3 x Cargador IBEK Tipo C 4.8A *$24.000*». */
function leerRenglonDeCompra(linea: string): RenglonDeCompra | null {
  if (!/^\d+\s*x\s/i.test(linea)) return null;
  const limpio = linea.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
  const m = limpio.match(/\$\s*(\d[\d.]*(?:,\d+)?)\s*$/) ?? limpio.match(/\$\s*(\d[\d.]*(?:,\d+)?)/);
  if (!m) return null;
  const montoCentavos = leerMonto(m[1]!);
  if (montoCentavos === null) return null;
  return { texto: limpio, montoCentavos };
}

/**
 * Lee el texto pegado y devuelve qué entendió, renglón por renglón.
 *
 * Devuelve todo, no solo lo que salió bien: quien pega sesenta líneas tiene
 * que poder ver cuál de las sesenta quedó afuera y por qué.
 */
export function leerLibreta(texto: string): LecturaDeLibreta {
  const lineas: LineaLeida[] = [];
  const compras: CompraDeLibreta[] = [];
  const entregas: EntregaDeLibreta[] = [];

  /* Los renglones de mercadería que todavía no tienen entrega debajo. */
  let acumulado: RenglonDeCompra[] = [];

  function cerrarCompra(fecha: Date, fechaEstimada: boolean) {
    if (acumulado.length === 0) return;
    compras.push({
      fecha,
      fechaEstimada,
      renglones: acumulado,
      montoCentavos: acumulado.reduce((t, r) => t + r.montoCentavos, 0),
    });
    acumulado = [];
  }

  for (const cruda of texto.split('\n')) {
    const linea = cruda.trim();
    if (linea === '') continue;

    const renglon = leerRenglonDeCompra(linea);
    if (renglon) {
      acumulado.push(renglon);
      lineas.push({ texto: linea, entrega: null, problema: null });
      continue;
    }
    /*
     * Un renglón que empieza con «N x» pero del que no se pudo sacar el
     * importe es mercadería que se perdería en silencio: suma a la deuda y
     * nadie lo vería faltar. Se avisa.
     */
    if (/^\d+\s*x\s/i.test(linea)) {
      lineas.push({ texto: linea, entrega: null, problema: 'No encontré el importe.' });
      continue;
    }

    const sinAsteriscos = linea.replace(/\*/g, ' ');
    const monto = sinAsteriscos.match(/\$?\s*(\d[\d.]*(?:,\d+)?)/);
    if (!monto) {
      lineas.push({ texto: linea, entrega: null, problema: 'No encontré el importe.' });
      continue;
    }
    const montoCentavos = leerMonto(monto[1]!);
    if (montoCentavos === null) {
      lineas.push({ texto: linea, entrega: null, problema: 'El importe no se entiende.' });
      continue;
    }

    const f = sinAsteriscos.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/);
    if (!f) {
      lineas.push({
        texto: linea,
        entrega: null,
        problema: 'Falta la fecha. Escribila como 16/06/26.',
      });
      continue;
    }
    const fecha = leerFecha(f[1]!, f[2]!, f[3]!);
    if (!fecha) {
      lineas.push({ texto: linea, entrega: null, problema: 'Esa fecha no existe.' });
      continue;
    }

    const palabras = sinAsteriscos.toLowerCase().match(/[a-záéíóúñ]+/g) ?? [];
    const medio =
      palabras.map((p) => MEDIOS[p.normalize('NFD').replace(/[\u0300-\u036f]/g, '')]).find(Boolean) ??
      MEDIO_POR_DEFECTO;

    // La mercadería de arriba toma la fecha de esta entrega.
    cerrarCompra(fecha, false);
    const entrega: EntregaDeLibreta = { fecha, montoCentavos, medio };
    entregas.push(entrega);
    lineas.push({ texto: linea, entrega, problema: null });
  }

  /*
   * Lo que quedó al final del cuaderno no tiene ninguna entrega debajo de
   * donde sacar la fecha. Hereda la última conocida y queda marcado: hay de
   * dónde sacar una fecha razonable, y lo que no se puede es hacerla pasar
   * por exacta.
   */
  if (acumulado.length > 0) {
    const ultima = entregas.at(-1)?.fecha;
    if (ultima) cerrarCompra(ultima, true);
    else {
      for (const r of acumulado) {
        lineas.push({
          texto: r.texto,
          entrega: null,
          problema: 'No hay ninguna entrega con fecha de donde sacar la de esta compra.',
        });
      }
      acumulado = [];
    }
  }

  return {
    lineas,
    entregas,
    totalCentavos: entregas.reduce((t, e) => t + e.montoCentavos, 0),
    compras,
    totalComprasCentavos: compras.reduce((t, c) => t + c.montoCentavos, 0),
    conProblema: lineas.filter((l) => l.problema !== null).length,
  };
}
