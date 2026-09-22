/**
 * Control de invariantes contra la base de verdad.
 *
 * No prueba código: prueba los **datos** que quedaron después de usar el
 * sistema. Cada consulta de acá es una pregunta que tiene una sola respuesta
 * correcta, y si alguna da otra cosa hay plata mal contada en algún lado.
 *
 * Corre contra el PostgreSQL de `DATABASE_URL`, así que se usa después del
 * seed y de la batería de punta a punta, que es cuando la base tiene un día de
 * uso encima:
 *
 *   npm run db:seed -- --reset && npm run test:e2e && npm run auditar
 *
 * Es de solo lectura: no escribe una sola fila.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { filas as filasDe } from '@/db/tipos';

interface Control {
  nombre: string;
  /** Qué tendría que pasar, en una línea. */
  espera: string;
  consulta: ReturnType<typeof sql>;
}

const CONTROLES: Control[] = [
  {
    nombre: 'Saldo de cada cuenta contra sus movimientos',
    espera: 'El saldo guardado es la suma de los movimientos (D44)',
    consulta: sql`
      SELECT c.nombre,
             c.saldo_centavos                              AS guardado,
             COALESCE(SUM(m.monto_centavos), 0)            AS movimientos
        FROM monetary_accounts c
        LEFT JOIN cash_movements m ON m.monetary_account_id = c.id
       GROUP BY c.id, c.nombre, c.saldo_centavos
      HAVING c.saldo_centavos <> COALESCE(SUM(m.monto_centavos), 0)
    `,
  },
  {
    nombre: 'Stock de cada producto contra sus movimientos',
    espera: 'El stock es el último `stock_resultante` de su producto',
    consulta: sql`
      SELECT p.nombre, p.stock AS guardado, m.stock_resultante AS ultimo_movimiento
        FROM products p
        JOIN LATERAL (
          SELECT stock_resultante
            FROM stock_movements
           WHERE product_id = p.id AND variant_id IS NULL
           ORDER BY created_at DESC, id DESC
           LIMIT 1
        ) m ON true
       WHERE p.stock <> m.stock_resultante
    `,
  },
  {
    nombre: 'Total de cada venta contra sus renglones',
    espera: 'Σ renglones − descuento global = total (D53)',
    consulta: sql`
      SELECT s.numero,
             s.total_centavos,
             s.subtotal_centavos,
             s.descuento_centavos,
             COALESCE(SUM(i.total_centavos), 0) AS renglones
        FROM sales s
        LEFT JOIN sale_items i ON i.sale_id = s.id
       GROUP BY s.id, s.numero, s.total_centavos, s.subtotal_centavos, s.descuento_centavos
      HAVING s.subtotal_centavos <> COALESCE(SUM(i.total_centavos), 0)
    `,
  },
  {
    nombre: 'Lo cobrado cubre el total de la venta',
    espera: 'Σ pagos >= total, siempre (la diferencia es vuelto)',
    consulta: sql`
      SELECT s.numero, s.total_centavos,
             COALESCE(SUM(p.monto_centavos), 0) AS pagado
        FROM sales s
        LEFT JOIN sale_payments p ON p.sale_id = s.id
       WHERE s.estado = 'completed'
       GROUP BY s.id, s.numero, s.total_centavos
      HAVING COALESCE(SUM(p.monto_centavos), 0) < s.total_centavos
    `,
  },
  {
    nombre: 'Deuda de cada cliente contra lo que la movio',
    espera:
      'saldo = migrado de papel + fiado − cobrado − lo que saco una anulacion − lo descontado por devolucion',
    consulta: sql`
      SELECT c.nombre,
             a.saldo_centavos AS guardado,
             COALESCE(mig.monto, 0) + COALESCE(f.fiado, 0)
               - COALESCE(p.cobrado, 0) - COALESCE(an.sacado, 0)
               - COALESCE(d.descontado, 0) AS calculado
        FROM credit_accounts a
        JOIN customers c ON c.id = a.customer_id
        -- La ficha de papel entra sin venta detras (D38): el unico rastro del
        -- monto inicial es la bitacora.
        LEFT JOIN LATERAL (
          SELECT (valor_nuevo ->> 'saldoCentavos')::bigint AS monto
            FROM audit_log
           WHERE accion = 'fiado.migrar_papel' AND entidad_id = a.id::text
           ORDER BY created_at DESC LIMIT 1
        ) mig ON true
        LEFT JOIN LATERAL (
          SELECT SUM(sp.monto_centavos) AS fiado
            FROM sale_payments sp
            JOIN sales s ON s.id = sp.sale_id
          -- Sin filtrar por estado: anular no borra el asiento de fiado, le
          -- saca la deuda al cliente aparte, y eso se resta abajo. Filtrar
          -- aca las anuladas descontaria la misma plata dos veces.
           WHERE sp.medio = 'cuenta_corriente'
             AND s.cliente_id = a.customer_id
        ) f ON true
        LEFT JOIN LATERAL (
          SELECT SUM(monto_centavos) AS cobrado
            FROM credit_payments WHERE credit_account_id = a.id
        ) p ON true
        -- Anular una venta fiada le saca la deuda al cliente, y lo que ya
        -- habia pagado pasa a \`pending_refunds\` (D41).
        LEFT JOIN LATERAL (
          SELECT SUM((valor_anterior ->> 'saldoCentavos')::bigint
                     - (valor_nuevo ->> 'saldoCentavos')::bigint) AS sacado
            FROM audit_log
           WHERE accion = 'fiado.anular' AND entidad_id = a.id::text
        ) an ON true
        LEFT JOIN LATERAL (
          SELECT SUM(descontado_de_deuda_centavos) AS descontado
            FROM returns WHERE cliente_id = a.customer_id
        ) d ON true
       WHERE a.saldo_centavos <> COALESCE(mig.monto, 0) + COALESCE(f.fiado, 0)
               - COALESCE(p.cobrado, 0) - COALESCE(an.sacado, 0)
               - COALESCE(d.descontado, 0)
    `,
  },
  {
    nombre: 'Cada cobro de fiado dice el saldo que dejo',
    espera: 'saldo_resultante = saldo anterior − lo cobrado, y nunca negativo',
    consulta: sql`
      SELECT cp.id, cp.monto_centavos, cp.saldo_resultante_centavos
        FROM credit_payments cp
       WHERE cp.saldo_resultante_centavos < 0
    `,
  },
  {
    nombre: 'Ninguna deuda en negativo',
    espera: 'La cuenta corriente no admite saldo a favor (D36/D41)',
    consulta: sql`
      SELECT c.nombre, a.saldo_centavos
        FROM credit_accounts a
        JOIN customers c ON c.id = a.customer_id
       WHERE a.saldo_centavos < 0
    `,
  },
  {
    nombre: 'Ninguna venta sin renglones',
    espera: 'Una venta sin líneas es una venta que no existe',
    consulta: sql`
      SELECT s.numero
        FROM sales s
       WHERE NOT EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id)
    `,
  },
  {
    nombre: 'Ningún renglón sin producto real',
    espera: 'D24: ninguna línea de venta existe sin producto de catálogo',
    consulta: sql`
      SELECT i.descripcion
        FROM sale_items i
        LEFT JOIN products p ON p.id = i.product_id
       WHERE p.id IS NULL
    `,
  },
  {
    nombre: 'Ningún turno espera menos de cero en el cajón',
    espera: 'No se puede sacar del cajón más plata de la que entró',
    /*
     * La apertura ya es un movimiento de la cuenta de efectivo, así que la
     * suma de abajo la incluye. La versión anterior la sumaba otra vez encima
     * —`saldo_inicial + Σ movimientos`— y eso volvía la condición tan laxa que
     * la invariante no saltaba nunca: un turno abierto con $100.000 que pagaba
     * un gasto de $150.000 quedaba esperando −$50.000 y pasaba de largo.
     *
     * Importa porque un esperado negativo rompe el arqueo de la peor manera:
     * el cierre resta contado − esperado y anuncia que **sobra** plata, cuando
     * lo que pasó es que se cargó una salida que no salió de ahí.
     */
    consulta: sql`
      SELECT s.terminal, s.abierta_en,
             s.saldo_inicial_centavos,
             COALESCE(SUM(m.monto_centavos) FILTER (WHERE c.tipo = 'efectivo'), 0) AS esperado
        FROM cash_sessions s
        LEFT JOIN cash_movements m ON m.cash_session_id = s.id
        LEFT JOIN monetary_accounts c ON c.id = m.monetary_account_id
       GROUP BY s.id, s.terminal, s.abierta_en, s.saldo_inicial_centavos
      HAVING COALESCE(SUM(m.monto_centavos) FILTER (WHERE c.tipo = 'efectivo'), 0) < 0
    `,
  },
  {
    nombre: 'Una sola caja abierta por terminal',
    espera: 'Dos turnos abiertos a la vez parten las ventas en dos arqueos',
    consulta: sql`
      SELECT terminal, count(*) AS abiertas
        FROM cash_sessions
       WHERE cerrada_en IS NULL
       GROUP BY terminal
      HAVING count(*) > 1
    `,
  },
  {
    nombre: 'Correlativos sin huecos ni repetidos',
    espera: 'El número de venta es consecutivo por terminal',
    consulta: sql`
      -- El correlativo se lee del FINAL del número, no del segundo trozo: el
      -- número es «<terminal>-000001» y el nombre de la terminal se configura
      -- (POS_TERMINAL). Con una terminal llamada «caja-2» —que es lo más
      -- natural del mundo— partir por guiones daba «2» y este control se caía
      -- con un error de PostgreSQL en vez de decir algo.
      WITH n AS (
        SELECT terminal,
               CAST(substring(numero from '[0-9]+$') AS integer) AS correlativo
          FROM sales
      )
      SELECT terminal, count(*) AS cuantas,
             max(correlativo) AS ultimo,
             count(DISTINCT correlativo) AS distintos
        FROM n
       GROUP BY terminal
      HAVING count(*) <> count(DISTINCT correlativo)
          OR max(correlativo) <> count(*)
    `,
  },
  {
    nombre: 'Una devolución no supera lo vendido',
    espera: 'De cada renglón no vuelve más de lo que salió (D54)',
    consulta: sql`
      SELECT i.descripcion, i.cantidad AS vendida, SUM(r.cantidad) AS devuelta
        FROM sale_items i
        JOIN return_items r ON r.sale_item_id = i.id
       GROUP BY i.id, i.descripcion, i.cantidad
      HAVING SUM(r.cantidad) > i.cantidad
    `,
  },
  {
    nombre: 'Lo devuelto y lo descontado suman el total de la devolución',
    espera: 'returns_suma_ck, comprobado también sobre los datos',
    consulta: sql`
      SELECT numero, total_centavos, devuelto_centavos, descontado_de_deuda_centavos
        FROM returns
       WHERE devuelto_centavos + descontado_de_deuda_centavos <> total_centavos
    `,
  },
  {
    nombre: 'Un gasto pagado dice de qué cuenta salió',
    espera: 'expenses_pagado_ck (D43)',
    consulta: sql`
      SELECT descripcion FROM expenses
       WHERE estado = 'pagado' AND monetary_account_id IS NULL
    `,
  },
  {
    nombre: 'Ningún importe guardado como coma flotante',
    espera: 'Toda la plata en centavos enteros, nunca float',
    consulta: sql`
      SELECT table_name, column_name, data_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type IN ('real', 'double precision', 'numeric')
    `,
  },
  {
    nombre: 'Una venta diferida dice cuándo se cobró',
    espera: 'sales_offline_ck (D56)',
    consulta: sql`
      SELECT numero FROM sales
       WHERE (offline AND offline_capturada_en IS NULL)
          OR (NOT offline AND (offline_capturada_en IS NOT NULL OR offline_desvio_centavos <> 0))
    `,
  },
  {
    nombre: 'El histórico no se mezcla con las ventas',
    espera: 'legacy_sales no toca caja ni stock (D55)',
    consulta: sql`
      SELECT l.referencia_externa
        FROM legacy_sales l
        JOIN sales s ON s.numero = l.referencia_externa
    `,
  },
  {
    nombre: 'La bitácora tiene un asiento por venta',
    espera: 'Toda venta confirmada quedó auditada',
    consulta: sql`
      SELECT s.numero
        FROM sales s
       WHERE NOT EXISTS (
         SELECT 1 FROM audit_log a
          WHERE a.entidad = 'sales' AND a.entidad_id = s.id::text AND a.accion = 'venta.confirmar'
       )
    `,
  },
];

async function main() {
  console.log('Control de invariantes sobre la base de verdad.\n');

  let fallaron = 0;

  for (const control of CONTROLES) {
    const malas = filasDe<Record<string, unknown>>(await db.execute(control.consulta));

    if (malas.length === 0) {
      console.log(`[  OK  ] ${control.nombre}`);
      continue;
    }

    fallaron += 1;
    console.log(`[ MAL  ] ${control.nombre}`);
    console.log(`         Esperado: ${control.espera}`);
    for (const fila of malas.slice(0, 5)) {
      console.log(`         → ${JSON.stringify(fila)}`);
    }
    if (malas.length > 5) console.log(`         … y ${malas.length - 5} más`);
  }

  console.log(
    `\n${CONTROLES.length - fallaron} de ${CONTROLES.length} en orden.` +
      (fallaron > 0 ? ` ${fallaron} rompen un invariante.` : ''),
  );

  process.exit(fallaron > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Falló el control:', e);
  process.exit(1);
});
