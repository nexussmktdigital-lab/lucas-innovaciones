/**
 * Leer las entregas de una libreta de papel, tal como vienen escritas.
 *
 * El local lleva estas cuentas en un cuaderno y las pasa por WhatsApp. Las
 * líneas se parecen a esto:
 *
 *     ENTREGA $22.000 (16/6/26)
 *     ENTREGA $21.000 (19/06/26) (efectivo)
 *     ENTREGA $44.000 (19/06/26) (tranferencia)
 *
 * Pedirle a alguien que las vuelva a tipear en un formulario, una por una, es
 * pedirle que se equivoque: son veinte o treinta y el original ya está escrito.
 * Entonces se pegan así, con el «ENTREGA», el signo, los puntos de mil y los
 * paréntesis, y esto las entiende.
 *
 * **Lo que no adivina es la fecha.** Una entrega sin fecha no sirve para lo
 * único que se le va a preguntar a esta historia —«¿cuándo pagó la última
 * vez?»— y poner la de hoy sería inventarla. Se avisa y no se carga.
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
  totalCentavos: number;
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
export function leerEntregas(texto: string): LecturaDeLibreta {
  const lineas: LineaLeida[] = [];

  for (const cruda of texto.split('\n')) {
    const linea = cruda.trim();
    // Las líneas vacías y los renglones de mercadería no son errores: el que
    // pega la libreta entera pega las dos cosas.
    if (linea === '') continue;
    if (/^\d+\s*x\s/i.test(linea)) continue;

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
      palabras.map((p) => MEDIOS[p.normalize('NFD').replace(/[̀-ͯ]/g, '')]).find(Boolean) ??
      MEDIO_POR_DEFECTO;

    lineas.push({ texto: linea, entrega: { fecha, montoCentavos, medio }, problema: null });
  }

  const entregas = lineas.flatMap((l) => (l.entrega ? [l.entrega] : []));
  return {
    lineas,
    entregas,
    totalCentavos: entregas.reduce((t, e) => t + e.montoCentavos, 0),
    conProblema: lineas.filter((l) => l.problema !== null).length,
  };
}
