/**
 * Si la base está al día con el código.
 *
 * Es la defensa contra el incidente que ya pasó tres veces: código desplegado
 * que escribe una columna que la base no tiene, y el mostrador enterándose
 * recién al cobrar.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { crearBaseDePrueba, type TestDb } from '@/db/test-db';
import { filas } from './tipos';
import { avisoDeEsquema, estadoDelEsquema, olvidarEstadoDelEsquema } from './pendientes';

let db: TestDb;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(() => {
  // Lo averiguado se recuerda un minuto: entre pruebas hay que olvidarlo o la
  // segunda mira la foto de la primera.
  olvidarEstadoDelEsquema();
});

describe('estado del esquema', () => {
  it('una base migrada no tiene nada pendiente', async () => {
    const estado = await estadoDelEsquema(db);
    expect(estado.pendientes).toEqual([]);
    expect(estado.aplicadas).toBeGreaterThan(0);
  });

  /*
   * El caso real: el código trae una migración que la base no aplicó. Se
   * simula borrando la última de la tabla de Drizzle, que es exactamente el
   * estado en el que quedó producción.
   */
  it('detecta la que falta, y la nombra', async () => {
    const ultimas = filas<{ created_at: string | number }>(
      await db.execute(
        sql`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
      ),
    );
    const cuando = Number(ultimas[0]!.created_at);

    await db.execute(sql`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${cuando}`);
    try {
      const estado = await estadoDelEsquema(db);
      expect(estado.pendientes).toHaveLength(1);

      const aviso = avisoDeEsquema(estado)!;
      // El nombre es lo que convierte el aviso en algo que alguien puede
      // arreglar: sin él es una preocupación sin salida.
      expect(aviso).toContain(estado.pendientes[0]!);
      expect(aviso).toMatch(/no está al día/i);
    } finally {
      await db.execute(
        sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('restaurada', ${cuando})`,
      );
    }
  });

  /*
   * Corre en el layout, o sea en todas las pantallas. Una excepción acá
   * tumbaría el POS entero: sería una defensa que rompe lo que viene a cuidar.
   */
  it('si no se puede averiguar, no rompe ni inventa una alarma', async () => {
    const roto = {
      execute: () => Promise.reject(new Error('no existe la tabla')),
    } as unknown as TestDb;

    const estado = await estadoDelEsquema(roto);
    expect(estado.desconocido).toBe(true);
    expect(estado.pendientes).toEqual([]);
    expect(avisoDeEsquema(estado)).toBeNull();
  });

  it('sin nada pendiente no hay aviso', () => {
    expect(avisoDeEsquema({ pendientes: [], aplicadas: 26 })).toBeNull();
  });

  /*
   * Se pregunta desde el layout, o sea en todas las pantallas. Una ida a la
   * base por cada carga se nota, y el esquema no cambia entre pedidos.
   */
  it('no vuelve a preguntarle a la base por un minuto', async () => {
    let consultas = 0;
    const espia = {
      execute: (...args: unknown[]) => {
        consultas += 1;
        return (db as unknown as { execute: (...a: unknown[]) => unknown }).execute(...args);
      },
    } as unknown as TestDb;

    await estadoDelEsquema(espia, 1_000);
    await estadoDelEsquema(espia, 1_000 + 30_000);
    expect(consultas).toBe(1);

    // Pasado el minuto vuelve a mirar: así el aviso se va solo cuando alguien
    // aplica lo que faltaba.
    await estadoDelEsquema(espia, 1_000 + 61_000);
    expect(consultas).toBe(2);
  });

  it('con varias pendientes las cuenta y las nombra a todas', () => {
    const aviso = avisoDeEsquema({ pendientes: ['0025_una', '0026_otra'], aplicadas: 24 })!;
    expect(aviso).toContain('2 migraciones');
    expect(aviso).toContain('0025_una');
    expect(aviso).toContain('0026_otra');
  });
});
