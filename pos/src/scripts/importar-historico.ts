/**
 * Importar el histórico de pedidos del sistema anterior.
 *
 *   npm run woo:historico -- --ensayo     mira qué entraría, sin escribir
 *   npm run woo:historico                 lo importa de verdad
 *
 * Va como script y no como pantalla a propósito: son 3.764 pedidos y varios
 * minutos de paginación contra un hosting que corta a los 30 segundos. Una
 * acción de servidor se moriría en la mitad, y esto se corre una sola vez en la
 * vida del sistema, con alguien mirando.
 *
 * Es seguro repetirlo: lo que ya está no se vuelve a cargar.
 */
import { db } from '@/db';
import { ClienteWoo, ErrorWoo } from '@/woo/cliente';
import { estadoDelHistorico, importarHistorico } from '@/woo/historico';
import { formatearARS } from '@/lib/dinero';

function pesos(centavos: number): string {
  return formatearARS(centavos).replace(/ /g, ' ');
}

async function main() {
  const ensayo = process.argv.includes('--ensayo');

  let cliente: ClienteWoo;
  try {
    cliente = ClienteWoo.desdeEntorno();
  } catch (e) {
    console.error(e instanceof ErrorWoo ? e.message : e);
    console.error('\nSin credenciales de WooCommerce no hay histórico que traer.');
    process.exit(1);
  }

  const antes = await estadoDelHistorico(db);
  if (antes.cuantos > 0) {
    console.log(
      `Ya hay ${antes.cuantos.toLocaleString('es-AR')} pedidos cargados ` +
        `(${antes.desde} a ${antes.hasta}, ${pesos(antes.totalCentavos)}).`,
    );
    console.log('Los que ya están se saltean; solo entra lo que falte.\n');
  }

  console.log(ensayo ? 'Ensayo: no se escribe nada.\n' : 'Importando…\n');

  let ultimoAviso = 0;
  const informe = await importarHistorico(db, cliente, {
    ensayo,
    alAvanzar: (leidos) => {
      // Un pedido a la vez no dice nada y llena la consola; de a 200 se ve que
      // avanza sin tapar el informe.
      if (leidos - ultimoAviso >= 200) {
        ultimoAviso = leidos;
        console.log(`  ${leidos.toLocaleString('es-AR')} pedidos leídos…`);
      }
    },
  });

  console.log('\n─────────────────────────────────────────');
  console.log(`Leídos            ${informe.leidos.toLocaleString('es-AR')}`);
  console.log(
    `${ensayo ? 'Entrarían        ' : 'Importados       '} ${informe.importados.toLocaleString('es-AR')}`,
  );
  if (informe.repetidos > 0) {
    console.log(`Ya estaban        ${informe.repetidos.toLocaleString('es-AR')}`);
  }
  if (informe.descartadosPorEstado > 0) {
    console.log(
      `Cancelados        ${informe.descartadosPorEstado.toLocaleString('es-AR')}  (no son facturación)`,
    );
  }
  console.log(`Facturación       ${pesos(informe.totalCentavos)}`);
  if (informe.desde) console.log(`Período           ${informe.desde} a ${informe.hasta}`);
  console.log(`Tardó             ${(informe.duracionMs / 1000).toFixed(1)}s`);
  console.log('─────────────────────────────────────────');

  /*
   * El cliente de WooCommerce descarta en silencio la fila que no cumple el
   * esquema, así que la única forma de notarlo es que las cuentas no cierren.
   * Sobre 3.764 pedidos, perder facturación sin enterarse sería lo peor que
   * puede pasar en esta migración.
   */
  const procesados = informe.importados + informe.repetidos + informe.descartadosPorEstado;
  if (procesados !== informe.leidos) {
    console.warn(
      `\n⚠ Las cuentas no cierran: se leyeron ${informe.leidos} y se procesaron ${procesados}.`,
    );
    console.warn('  Revisá arriba los avisos de «ficha descartada»: son pedidos que no se pudieron leer.');
  }

  if (!ensayo) {
    const despues = await estadoDelHistorico(db);
    console.log(
      `\nEl histórico queda con ${despues.cuantos.toLocaleString('es-AR')} pedidos, ` +
        `de ${despues.desde} a ${despues.hasta}.`,
    );
    console.log('Ya se ve en Reportes → Mes a mes.');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('\nFalló la importación:', e instanceof Error ? e.message : e);
  console.error('Lo que ya había entrado quedó guardado. Volvé a correrlo y retoma donde iba.');
  process.exit(1);
});
