/**
 * PIN de vendedor.
 *
 * El PIN es corto por diseno (tiene que entrarse en dos segundos entre cliente
 * y cliente), asi que la seguridad no viene de su entropia sino de tres cosas:
 *  - se hashea con bcrypt, nunca se guarda en claro;
 *  - el vendedor se elige de una lista antes de tipearlo, asi que no hay
 *    barrido de usuarios;
 *  - el POS no se expone a internet abierta sin necesidad (ver README).
 */
import bcrypt from 'bcryptjs';

export const LARGO_MINIMO_PIN = 4;
export const LARGO_MAXIMO_PIN = 8;

const RONDAS = 10;

export class ErrorPin extends Error {}

/** PINes que no se aceptan: son los primeros que prueba cualquiera. */
const PINES_PROHIBIDOS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '1212', '0123',
]);

export function validarPin(pin: string): string {
  if (!/^\d+$/.test(pin)) throw new ErrorPin('El PIN tiene que ser solo numeros.');
  if (pin.length < LARGO_MINIMO_PIN || pin.length > LARGO_MAXIMO_PIN) {
    throw new ErrorPin(`El PIN tiene que tener entre ${LARGO_MINIMO_PIN} y ${LARGO_MAXIMO_PIN} digitos.`);
  }
  if (PINES_PROHIBIDOS.has(pin)) throw new ErrorPin('Ese PIN es demasiado facil de adivinar.');
  return pin;
}

export async function hashearPin(pin: string): Promise<string> {
  return bcrypt.hash(validarPin(pin), RONDAS);
}

export async function verificarPin(pin: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  if (!/^\d+$/.test(pin)) return false;
  return bcrypt.compare(pin, hash);
}

export async function hashearPassword(password: string): Promise<string> {
  if (password.length < 8) throw new ErrorPin('La contraseña tiene que tener al menos 8 caracteres.');
  return bcrypt.hash(password, RONDAS);
}

export async function verificarPassword(password: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}
