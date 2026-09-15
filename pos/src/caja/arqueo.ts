/**
 * Arqueo: contar la plata del cajon.
 *
 * La nota de campo de la auditoria dice que hoy las sesiones quedan abiertas
 * dias enteros y el efectivo contado figura siempre en cero: en la practica no
 * hacen arqueo. Pedir «escribi cuanto hay» no lo arregla, porque escribir un
 * numero redondo es exactamente lo que se hace cuando no se cuenta.
 *
 * Contar por denominacion si lo arregla, porque **es el gesto que ya se hace**:
 * se apilan los billetes por valor y se cuentan las pilas. El sistema suma. Lo
 * que antes era un tramite pasa a ser el conteo de verdad, y de paso queda
 * registrado con que billetes cerro la caja, que es lo que permite despues
 * entender una diferencia.
 *
 * El conteo es opcional: quien quiera escribir el total directo puede, y el
 * cierre no lo exige. Un arqueo que traba el cierre a las nueve de la noche es
 * un arqueo que se saltea.
 */

export interface Denominacion {
  /** Valor en centavos. Un billete de $10.000 son 1.000.000. */
  valorCentavos: number;
  etiqueta: string;
  tipo: 'billete' | 'moneda';
}

/**
 * Los billetes que circulan hoy en Argentina, de mayor a menor.
 *
 * Las monedas no estan: con la inflacion acumulada no se usan en el mostrador
 * y ponerlas seria diez casilleros que siempre quedan en cero. Lo que aparezca
 * suelto va al campo de «monedas y sueltos», que es un monto libre.
 */
export const DENOMINACIONES: readonly Denominacion[] = [
  { valorCentavos: 20_000_00, etiqueta: '$20.000', tipo: 'billete' },
  { valorCentavos: 10_000_00, etiqueta: '$10.000', tipo: 'billete' },
  { valorCentavos: 2_000_00, etiqueta: '$2.000', tipo: 'billete' },
  { valorCentavos: 1_000_00, etiqueta: '$1.000', tipo: 'billete' },
  { valorCentavos: 500_00, etiqueta: '$500', tipo: 'billete' },
  { valorCentavos: 200_00, etiqueta: '$200', tipo: 'billete' },
  { valorCentavos: 100_00, etiqueta: '$100', tipo: 'billete' },
];

/** Cuántos billetes de cada valor. La clave es el valor en centavos. */
export type Conteo = Record<number, number>;

export class ErrorArqueo extends Error {}

/**
 * Lo que suma el conteo.
 *
 * `sueltoCentavos` es el monto libre de monedas y billetes viejos: sumarlo
 * aparte evita inventar denominaciones que nadie va a usar.
 */
export function totalDelConteo(conteo: Conteo, sueltoCentavos = 0): number {
  let total = 0;

  for (const [valor, cantidad] of Object.entries(conteo)) {
    const valorCentavos = Number(valor);
    if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
      throw new ErrorArqueo('Hay una denominación que no es válida.');
    }
    if (!Number.isInteger(cantidad) || cantidad < 0) {
      throw new ErrorArqueo('La cantidad de billetes no puede ser negativa ni tener decimales.');
    }
    total += valorCentavos * cantidad;
  }

  if (!Number.isInteger(sueltoCentavos) || sueltoCentavos < 0) {
    throw new ErrorArqueo('El suelto no puede ser negativo.');
  }

  return total + sueltoCentavos;
}

/** Cuántos billetes se contaron en total, para saber si el conteo existió. */
export function cantidadDeBilletes(conteo: Conteo): number {
  return Object.values(conteo).reduce((n, c) => n + (Number.isInteger(c) ? c : 0), 0);
}

/** True si hay un conteo de verdad y no un objeto vacío. */
export function hayConteo(conteo: Conteo | null | undefined, sueltoCentavos = 0): boolean {
  if (!conteo) return sueltoCentavos > 0;
  return cantidadDeBilletes(conteo) > 0 || sueltoCentavos > 0;
}

/**
 * Limpia lo que llega del formulario.
 *
 * El navegador manda cadenas y casilleros vacios; lo que no sea un numero
 * entero positivo se descarta en vez de romper el cierre. Las denominaciones
 * que no existen tambien se descartan: el conteo no es un lugar para inventar
 * billetes.
 */
export function leerConteo(crudo: Record<string, unknown>): Conteo {
  const validos = new Set(DENOMINACIONES.map((d) => d.valorCentavos));
  const conteo: Conteo = {};

  for (const [clave, valor] of Object.entries(crudo)) {
    const valorCentavos = Number(clave);
    if (!validos.has(valorCentavos)) continue;

    const cantidad = Number(String(valor ?? '').trim());
    if (!Number.isInteger(cantidad) || cantidad <= 0) continue;

    conteo[valorCentavos] = cantidad;
  }

  return conteo;
}

export interface RenglonDeConteo {
  etiqueta: string;
  valorCentavos: number;
  cantidad: number;
  subtotalCentavos: number;
}

/** El conteo listo para mostrar o imprimir, sin los renglones en cero. */
export function desgloseDelConteo(conteo: Conteo): RenglonDeConteo[] {
  return DENOMINACIONES.filter((d) => (conteo[d.valorCentavos] ?? 0) > 0).map((d) => ({
    etiqueta: d.etiqueta,
    valorCentavos: d.valorCentavos,
    cantidad: conteo[d.valorCentavos]!,
    subtotalCentavos: d.valorCentavos * conteo[d.valorCentavos]!,
  }));
}

/**
 * Hace cuánto está abierto el turno, en horas.
 *
 * Sirve para avisar: la auditoría encontró sesiones abiertas días enteros, y
 * una caja que nunca cierra no tiene arqueo ni reporte de nada.
 */
export function horasAbierta(abiertaEn: Date, ahora: Date = new Date()): number {
  return Math.max(0, (ahora.getTime() - abiertaEn.getTime()) / 3_600_000);
}

/** A partir de acá el turno lleva demasiado abierto y conviene decirlo. */
export const HORAS_PARA_AVISAR = 14;

/** «hace 3 horas», «hace 2 días»: como se dice en el mostrador. */
export function haceCuanto(abiertaEn: Date, ahora: Date = new Date()): string {
  const horas = horasAbierta(abiertaEn, ahora);
  if (horas < 1) return 'hace menos de una hora';
  if (horas < 24) {
    const enteras = Math.floor(horas);
    return `hace ${enteras} ${enteras === 1 ? 'hora' : 'horas'}`;
  }
  const dias = Math.floor(horas / 24);
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}
