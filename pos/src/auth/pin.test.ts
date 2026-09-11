import { describe, expect, it } from 'vitest';
import { ErrorPin, hashearPin, validarPin, verificarPin } from './pin';
import { puede, requiereAutorizacion } from './permisos';

describe('validarPin', () => {
  it('acepta un PIN razonable', () => {
    expect(validarPin('4827')).toBe('4827');
    expect(validarPin('918273')).toBe('918273');
  });

  it('rechaza los que prueba cualquiera primero', () => {
    for (const malo of ['0000', '1234', '1111', '4321']) {
      expect(() => validarPin(malo)).toThrow(ErrorPin);
    }
  });

  it('rechaza letras y largos fuera de rango', () => {
    expect(() => validarPin('abcd')).toThrow(ErrorPin);
    expect(() => validarPin('12')).toThrow(ErrorPin);
    expect(() => validarPin('123456789')).toThrow(ErrorPin);
  });
});

describe('hashearPin', () => {
  it('el hash no contiene el PIN y verifica bien', async () => {
    const hash = await hashearPin('4827');
    expect(hash).not.toContain('4827');
    expect(await verificarPin('4827', hash)).toBe(true);
    expect(await verificarPin('4828', hash)).toBe(false);
  });

  it('sin hash cargado, nunca autentica', async () => {
    expect(await verificarPin('4827', null)).toBe(false);
  });
});

describe('permisos', () => {
  it('el dueno puede todo', () => {
    expect(puede('owner', 'reporte.rentabilidad')).toBe(true);
    expect(puede('owner', 'venta.anular')).toBe(true);
  });

  it('el vendedor vende, cobra fiado y maneja su caja', () => {
    expect(puede('seller', 'venta.crear')).toBe(true);
    expect(puede('seller', 'fiado.cobrar')).toBe(true);
    expect(puede('seller', 'caja.abrir')).toBe(true);
  });

  it('el vendedor no anula ni ve rentabilidad sin autorizacion', () => {
    expect(puede('seller', 'venta.anular')).toBe(false);
    expect(puede('seller', 'reporte.rentabilidad')).toBe(false);
    expect(requiereAutorizacion('seller', 'venta.anular')).toBe(true);
    expect(requiereAutorizacion('owner', 'venta.anular')).toBe(false);
  });

  it('hay cosas que ni con PIN del dueno hace un vendedor desde su sesion', () => {
    expect(requiereAutorizacion('seller', 'usuario.administrar')).toBe(false);
    expect(puede('seller', 'usuario.administrar')).toBe(false);
  });
});
