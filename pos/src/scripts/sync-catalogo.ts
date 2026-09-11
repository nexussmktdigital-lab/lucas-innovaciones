/**
 * Sincronizacion inicial del catalogo desde WooCommerce.
 *
 * Uso:
 *   npm run woo:sync                     sincroniza todo
 *   npm run woo:sync -- --verificar      solo prueba credenciales y conteo
 *   npm run woo:sync -- --avisos ruta.csv  guarda los avisos de calidad
 */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { ClienteWoo } from '@/woo/cliente';
import { cotizacionDesdeWoo } from '@/woo/cotizacion';
import { sincronizarCatalogo } from '@/woo/sincronizar';
import { formatearARS } from '@/lib/dinero';

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL. Copiá .env.example a .env y completala.');
    process.exit(1);
  }

  const cliente = ClienteWoo.desdeEntorno();

  if (process.argv.includes('--verificar')) {
    const r = await cliente.verificar();
    console.log(`Conexión OK. WooCommerce reporta ${r.productos} productos.`);
    return;
  }

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema, casing: 'snake_case' });

  try {
    // 1. Cotización. La fuente de verdad es el plugin lucas-cotizacion (D22).
    const cotizacion = await cotizacionDesdeWoo(cliente);
    if (cotizacion) {
      await db.insert(schema.exchangeRates).values({
        valorCentavos: cotizacion.valorCentavos,
        vigenteDesde: cotizacion.vigenteDesde,
        origen: cotizacion.origen,
      });
      console.log(
        `Cotización: ${formatearARS(cotizacion.valorCentavos)} por dólar (${cotizacion.origen}).`,
      );
    } else {
      console.warn(
        'AVISO: no se pudo leer la cotización. Los precios en dólares no se van a verificar.',
      );
    }

    // 2. Catálogo.
    console.log('Sincronizando catálogo…');
    const informe = await sincronizarCatalogo(db, cliente, {
      tcCentavos: cotizacion?.valorCentavos ?? null,
      alAvanzar: (n) => process.stdout.write(`\r  ${n} productos leídos…`),
    });
    process.stdout.write('\r');

    console.log(`\nListo en ${(informe.duracionMs / 1000).toFixed(1)} s`);
    console.log(`  Leídos:       ${informe.leidos}`);
    console.log(`  Creados:      ${informe.creados}`);
    console.log(`  Actualizados: ${informe.actualizados}`);
    console.log(`  Variaciones:  ${informe.variantes}`);

    if (informe.avisos.length > 0) {
      console.log(`\nCalidad de carga — ${informe.avisos.length} avisos:`);
      for (const [tipo, cantidad] of Object.entries(informe.resumen).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${tipo.padEnd(20)} ${cantidad}`);
      }

      const destino = argumento('avisos');
      if (destino) {
        const csv = [
          'woo_id,nombre,tipo,detalle',
          ...informe.avisos.map(
            (a) => `${a.wooId},"${a.nombre.replace(/"/g, '""')}",${a.tipo},"${a.detalle.replace(/"/g, '""')}"`,
          ),
        ].join('\n');
        await writeFile(destino, csv, 'utf8');
        console.log(`\nAvisos guardados en ${destino}`);
      } else {
        console.log('\nPara el detalle: npm run woo:sync -- --avisos avisos.csv');
      }
    }
  } finally {
    await sql.end();
  }
}

await main();
