/**
 * Sincronizacion inicial del catalogo desde WooCommerce.
 *
 * Uso:
 *   npm run woo:sync                     sincroniza todo
 *   npm run woo:sync -- --verificar      solo prueba credenciales y conteo
 *   npm run woo:sync -- --diagnostico    prueba eslabon por eslabon cuando algo falla
 *   npm run woo:sync -- --avisos ruta.csv  guarda los avisos de calidad
 */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { desc } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { urlDeConexion } from '@/db/url';
import { ClienteWoo } from '@/woo/cliente';
import { diagnosticar } from '@/woo/diagnostico';
import { cotizacionDesdeWoo } from '@/woo/cotizacion';
import { sincronizarCatalogo } from '@/woo/sincronizar';
import { formatearARS } from '@/lib/dinero';
import { destinoDeWoo, dondeApuntaWoo } from '@/lib/produccion';

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

  if (process.argv.includes('--diagnostico')) {
    const pruebas = await diagnosticar({
      url: process.env.WOO_URL ?? '',
      consumerKey: process.env.WOO_CONSUMER_KEY ?? '',
      consumerSecret: process.env.WOO_CONSUMER_SECRET ?? '',
    });

    console.log(`\nDiagnóstico de ${process.env.WOO_URL}\n`);
    const simbolo = { ok: '  OK  ', falla: 'FALLA ', omitido: '  --  ' };
    for (const p of pruebas) {
      console.log(`[${simbolo[p.resultado]}] ${p.nombre}`);
      console.log(`          ${p.detalle}`);
      if (p.arreglo) console.log(`          → ${p.arreglo}`);
    }
    console.log('');
    return;
  }

  const cliente = ClienteWoo.desdeEntorno();

  // Contra qué tienda se está hablando, siempre y antes de tocar nada: las dos
  // se llaman igual y la de producción tiene el stock del negocio.
  const destino = destinoDeWoo(process.env.WOO_URL);
  console.log(`\nTienda: ${dondeApuntaWoo(process.env.WOO_URL)} (${destino})`);
  if (destino === 'produccion') {
    console.warn('AVISO: es la tienda de VERDAD, no el staging.\n');
  } else {
    console.log('');
  }

  if (process.argv.includes('--verificar')) {
    const r = await cliente.verificar();
    console.log(`Conexión OK. WooCommerce reporta ${r.productos} productos.`);
    return;
  }

  // `prepare: false`: la cadena puede ser la del pooler de Neon, que es
  // PgBouncer en modo transacción y no conserva las sentencias preparadas.
  const sql = postgres(urlDeConexion(url), { max: 1, prepare: false });
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
    }

    /*
     * Si Woo no dio cotización, se usa la última guardada.
     *
     * Antes se mandaba `null` y con eso el chequeo de precios en dólares —el
     * que atrapa el error de los 9 iPhones, US$ 6.300 leídos como $6.300— no
     * corría. Peor todavía: el informe salía sin un solo `usd_incoherente`, que
     * se lee como «está todo bien» cuando en realidad nadie miró.
     *
     * Una cotización de ayer sirve perfecto para esto: la tolerancia es de 1,5x
     * contra 0,66x, o sea que busca errores de magnitud, no diferencias de unos
     * pesos. Lo único que no se puede hacer es verificar a ciegas y callarse.
     */
    let tcCentavos = cotizacion?.valorCentavos ?? null;
    if (!cotizacion) {
      const [ultima] = await db
        .select()
        .from(schema.exchangeRates)
        .orderBy(desc(schema.exchangeRates.vigenteDesde))
        .limit(1);

      if (ultima) {
        tcCentavos = ultima.valorCentavos;
        const dias = Math.floor((Date.now() - ultima.vigenteDesde.getTime()) / 86_400_000);
        console.warn(
          `AVISO: no se pudo leer la cotización de la tienda. Se verifica con la última\n` +
            `      guardada: ${formatearARS(tcCentavos)} por dólar, de hace ${dias} día(s).`,
        );
      } else {
        console.warn(
          'AVISO: no se pudo leer la cotización y no hay ninguna guardada.\n' +
            '      Los precios en dólares NO se van a verificar. Cargá una a mano\n' +
            '      desde el POS (Dólar, F9) y volvé a correr esto.',
        );
      }
    }

    // 2. Catálogo.
    console.log('Sincronizando catálogo…');
    const informe = await sincronizarCatalogo(db, cliente, {
      tcCentavos,
      // Solo la corrida completa ve el catálogo entero, así que es la única que
      // puede concluir que algo se borró de la tienda.
      desactivarAusentes: true,
      alAvanzar: (n) => process.stdout.write(`\r  ${n} productos leídos…`),
    });
    process.stdout.write('\r');

    console.log(`\nListo en ${(informe.duracionMs / 1000).toFixed(1)} s`);
    console.log(`  Leídos:       ${informe.leidos}`);
    console.log(`  Creados:      ${informe.creados}`);
    console.log(`  Actualizados: ${informe.actualizados}`);
    console.log(`  Variaciones:  ${informe.variantes}`);
    if (informe.desactivados > 0) {
      console.log(
        `  Dados de baja: ${informe.desactivados} (ya no están en la tienda; quedan\n` +
          `                 inactivos, no borrados, porque hay ventas que los nombran)`,
      );
    }
    if (informe.bajasOmitidas) console.warn(`\nAVISO: ${informe.bajasOmitidas}`);

    if (informe.avisos.length > 0) {
      console.log(`\nCalidad de carga — ${informe.avisos.length} avisos:`);
      for (const [tipo, cantidad] of Object.entries(informe.resumen).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${tipo.padEnd(20)} ${cantidad}`);
      }

      const rutaAvisos = argumento('avisos');
      if (rutaAvisos) {
        const csv = [
          'woo_id,nombre,tipo,detalle',
          ...informe.avisos.map(
            (a) => `${a.wooId},"${a.nombre.replace(/"/g, '""')}",${a.tipo},"${a.detalle.replace(/"/g, '""')}"`,
          ),
        ].join('\n');
        await writeFile(rutaAvisos, csv, 'utf8');
        console.log(`\nAvisos guardados en ${rutaAvisos}`);
      } else {
        console.log('\nPara el detalle: npm run woo:sync -- --avisos avisos.csv');
      }
    }
  } finally {
    await sql.end();
  }
}

await main();
