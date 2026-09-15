/**
 * Exportar a planilla.
 *
 * El destino de estos archivos es Excel en castellano, no un pipeline de datos.
 * Eso manda tres decisiones que un CSV «correcto» haría al revés:
 *
 *  - **Separador punto y coma.** En configuración regional española, Excel abre
 *    un CSV con comas metiendo todo en la primera columna. El punto y coma es
 *    lo que abre bien haciendo doble clic, que es lo único que va a pasar.
 *  - **BOM al principio.** Sin él, Excel lee el archivo como Latin-1 y todos
 *    los acentos salen rotos.
 *  - **Decimales con coma.** `12500,50`, no `12500.50`. Con el punto, Excel lo
 *    toma como texto y no se puede sumar la columna, que es lo primero que hace
 *    cualquiera que abre esto.
 *
 * Es el mismo dialecto que lee la importación de productos, así que lo que sale
 * de acá se puede volver a cargar.
 */

export const SEPARADOR = ';';
export const BOM = '﻿';

/**
 * Escapa una celda.
 *
 * Solo entre comillas si hace falta: un archivo con todo entrecomillado es
 * ilegible cuando alguien lo abre con un editor de texto para ver qué pasó.
 */
export function celda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return '';

  const texto = String(valor);

  /*
   * Una celda que empieza con `=`, `+`, `@` o `-` es una fórmula para Excel, no
   * un texto. El nombre de un producto puede empezar así —y los nombres entran
   * por la planilla de un distribuidor, que no la escribimos nosotros—, así que
   * se le antepone un apóstrofo, que Excel entiende como «esto es texto».
   *
   * El signo menos seguido de un dígito queda afuera a propósito: es un importe
   * negativo, y una ganancia en rojo marcada como texto rompe la suma de la
   * columna, que es exactamente lo que este archivo viene a evitar.
   */
  const esFormula = /^[=+@\t\r]/.test(texto) || /^-(?![\d])/.test(texto);
  const seguro = esFormula ? `'${texto}` : texto;

  if (!/[";\n\r]/.test(seguro) && !esFormula) return seguro;

  return `"${seguro.replace(/"/g, '""')}"`;
}

/** Centavos como los espera Excel en castellano: `12500,50`. */
export function montoParaPlanilla(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const absoluto = Math.abs(Math.round(centavos));
  return `${signo}${Math.floor(absoluto / 100)},${String(absoluto % 100).padStart(2, '0')}`;
}

/**
 * Fecha y hora en el calendario del local, en columnas separadas.
 *
 * Van separadas porque en una planilla se filtra y se agrupa por fecha, y una
 * celda «15/09/2026 18:42» no deja hacer ninguna de las dos cosas sin pelearse
 * con Excel primero.
 */
export function fechaParaPlanilla(d: Date): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const buscar = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return {
    fecha: `${buscar('day')}/${buscar('month')}/${buscar('year')}`,
    hora: `${buscar('hour')}:${buscar('minute')}`,
  };
}

/** Arma el archivo entero: encabezado, filas, BOM y saltos de Windows. */
export function armarCsv(
  encabezado: readonly string[],
  filas: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const lineas = [encabezado.map(celda).join(SEPARADOR)];
  for (const fila of filas) lineas.push(fila.map(celda).join(SEPARADOR));

  // Saltos de Windows: es lo que esperan Excel y el cliente de correo desde el
  // que esto se le va a mandar al contador.
  return BOM + lineas.join('\r\n') + '\r\n';
}

/**
 * Nombre de archivo que se ordena solo en la carpeta de Descargas.
 *
 * `ventas-2026-09-01-a-2026-09-15.csv`: con la fecha en forma ISO, la lista
 * queda en orden cronológico sin tocar nada.
 */
export function nombreDeArchivo(que: string, desdeISO: string, hastaISO: string): string {
  const limpio = que.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return desdeISO === hastaISO
    ? `${limpio}-${desdeISO}.csv`
    : `${limpio}-${desdeISO}-a-${hastaISO}.csv`;
}

/** Las cabeceras que hacen que el navegador lo baje en vez de mostrarlo. */
export function cabecerasDeDescarga(nombre: string): Record<string, string> {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${nombre}"`,
    // Un reporte descargado no se cachea: el de mañana dice otra cosa.
    'Cache-Control': 'no-store',
  };
}
