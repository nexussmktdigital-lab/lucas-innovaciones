'use client';

/**
 * Imprimir el reporte del turno.
 *
 * No abre una ventana nueva ni arma un HTML aparte como el ticket: el reporte
 * ya esta en pantalla y las reglas de `@media print` le sacan lo que no va.
 * Una hoja menos que mantener en dos lugares.
 */
export default function BotonImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="sin-imprimir min-h-10 rounded-(--radius-caja) border border-(--color-borde) px-3 text-sm font-medium"
    >
      Imprimir
    </button>
  );
}
