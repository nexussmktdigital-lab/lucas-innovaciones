/**
 * Cuánto hay en el cajón, ahora mismo, en el turno abierto.
 *
 * Vive suelto y no adentro de `sesion.ts` porque lo necesitan los dos módulos
 * que sacan plata del cajón —gastos y transferencias entre cuentas— y ninguno
 * de los dos tiene por qué depender del resumen entero del turno.
 *
 * Es el número más exigente del POS: el saldo de la cuenta de efectivo arrastra
 * todos los turnos anteriores, pero lo que se cuenta a la noche es lo que entró
 * desde que se abrió hoy. Sacar más que esto deja el arqueo esperando menos de
 * cero, y un arqueo así dice «sobran» cuando en realidad se cargó mal una
 * salida.
 */
import { sql } from 'drizzle-orm';
import { filas as filasDe, type BaseDatos } from '@/db/tipos';

export async function efectivoDelTurno(tx: BaseDatos, sesionId: string): Promise<number> {
  const [fila] = filasDe<{ total: string | number }>(
    await tx.execute(sql`
      SELECT COALESCE(SUM(m.monto_centavos), 0) AS total
        FROM cash_movements m
        JOIN monetary_accounts c ON c.id = m.monetary_account_id
       WHERE m.cash_session_id = ${sesionId}
         AND c.tipo = 'efectivo'
    `),
  );
  return Number(fila?.total ?? 0);
}
