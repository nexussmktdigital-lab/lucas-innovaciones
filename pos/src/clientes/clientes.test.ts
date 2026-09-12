import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearBaseDePrueba, vaciar, type TestDb } from '@/db/test-db';
import { customers } from '@/db/schema';
import {
  buscarClientes,
  crearCliente,
  editarCliente,
  ErrorCliente,
  normalizarTelefono,
} from './clientes';

describe('normalizarTelefono', () => {
  /**
   * El teléfono es lo único con lo que se puede mandar un WhatsApp, y la gente
   * lo escribe de siete formas distintas. Normalizar al cargar, y no al mandar,
   * evita descubrir en la fase 5 que media agenda está inutilizable.
   */
  it('acepta un número de Villa Santa Rosa como se escribe en el mostrador', () => {
    expect(normalizarTelefono('3573 42-1234')).toBe('+5493573421234');
    expect(normalizarTelefono('03573421234')).toBe('+5493573421234');
  });

  it('saca el 15 de los móviles', () => {
    expect(normalizarTelefono('351 15 4123456')).toBe('+5493514123456');
    expect(normalizarTelefono('0351 15 412-3456')).toBe('+5493514123456');
  });

  it('respeta el que ya viene completo', () => {
    expect(normalizarTelefono('+54 9 351 412 3456')).toBe('+5493514123456');
    expect(normalizarTelefono('+5493514123456')).toBe('+5493514123456');
  });

  it('le agrega el 9 de móvil al que viene con código de país sin él', () => {
    expect(normalizarTelefono('543514123456')).toBe('+5493514123456');
  });

  it('devuelve null en vez de inventar un número', () => {
    expect(normalizarTelefono('')).toBeNull();
    expect(normalizarTelefono(null)).toBeNull();
    expect(normalizarTelefono('no tiene')).toBeNull();
    expect(normalizarTelefono('421234')).toBeNull(); // sin código de área
  });
});

let db: TestDb;

beforeAll(async () => {
  db = await crearBaseDePrueba();
});

beforeEach(async () => {
  await vaciar(db);
});

describe('crearCliente', () => {
  it('guarda el teléfono normalizado y también como lo escribieron', async () => {
    const c = await crearCliente(db, { nombre: '  gaby   gonzález ', telefono: '3573 42-1234' });

    expect(c.nombre).toBe('gaby gonzález');
    expect(c.telefono).toBe('+5493573421234');

    const [enBase] = await db.select().from(customers);
    expect(enBase!.telefonoRaw).toBe('3573 42-1234');
  });

  it('no deja cargar dos veces el mismo teléfono', async () => {
    await crearCliente(db, { nombre: 'Gaby', telefono: '3573421234' });

    // Dos fichas del mismo cliente son dos deudas que no se ven juntas.
    await expect(
      crearCliente(db, { nombre: 'Gabriela G.', telefono: '03573 42 1234' }),
    ).rejects.toThrow(/ya es de «Gaby»/);
  });

  it('sin teléfono se puede cargar igual: en el mostrador pasa', async () => {
    const c = await crearCliente(db, { nombre: 'Señora de los vidrios' });
    expect(c.telefono).toBeNull();
  });

  it('rechaza un nombre vacío', async () => {
    await expect(crearCliente(db, { nombre: '   ' })).rejects.toBeInstanceOf(ErrorCliente);
  });
});

describe('editarCliente', () => {
  it('actualiza los datos', async () => {
    const c = await crearCliente(db, { nombre: 'Gaby' });
    await editarCliente(db, c.id, { nombre: 'Gaby González', telefono: '3573421234', notas: 'Vecina' });

    const [enBase] = await db.select().from(customers);
    expect(enBase!.nombre).toBe('Gaby González');
    expect(enBase!.telefono).toBe('+5493573421234');
    expect(enBase!.notas).toBe('Vecina');
  });

  it('no le puede robar el teléfono a otro cliente', async () => {
    await crearCliente(db, { nombre: 'Gaby', telefono: '3573421234' });
    const otro = await crearCliente(db, { nombre: 'Mayco' });

    await expect(
      editarCliente(db, otro.id, { nombre: 'Mayco', telefono: '3573421234' }),
    ).rejects.toThrow(/ya es de «Gaby»/);
  });

  it('pero sí puede quedarse con el suyo', async () => {
    const c = await crearCliente(db, { nombre: 'Gaby', telefono: '3573421234' });
    await editarCliente(db, c.id, { nombre: 'Gaby G.', telefono: '3573421234' });

    const [enBase] = await db.select().from(customers);
    expect(enBase!.nombre).toBe('Gaby G.');
  });
});

describe('buscarClientes', () => {
  beforeEach(async () => {
    await crearCliente(db, { nombre: 'Gaby González', telefono: '3573421234', dni: '30111222' });
    await crearCliente(db, { nombre: 'Mayco Villafañe', telefono: '3514123456' });
  });

  it('busca por nombre sin distinguir acentos ni mayúsculas', async () => {
    expect((await buscarClientes(db, 'GONZALEZ')).map((c) => c.nombre)).toEqual(['Gaby González']);
    expect((await buscarClientes(db, 'villafañe')).map((c) => c.nombre)).toEqual([
      'Mayco Villafañe',
    ]);
  });

  it('busca por teléfono como lo escriban', async () => {
    expect((await buscarClientes(db, '3573 42-1234')).map((c) => c.nombre)).toEqual([
      'Gaby González',
    ]);
  });

  it('busca por DNI', async () => {
    expect((await buscarClientes(db, '30111222')).map((c) => c.nombre)).toEqual(['Gaby González']);
  });

  it('sin término devuelve todos', async () => {
    expect(await buscarClientes(db)).toHaveLength(2);
  });
});
