import { describe, expect, it } from 'vitest';
import { ErrorPin, hashearPin, validarPin, verificarPin } from './pin';
import { puede, PERMISOS, RESERVADOS_AL_DUENIO, type Permiso } from './permisos';

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

  it('el vendedor atiende el mostrador entero', () => {
    // La regla del local: todo lo que es atender se puede, sin ir a buscar al
    // dueño con un cliente esperando.
    for (const p of [
      'venta.crear',
      'venta.anular',
      'venta.descuento',
      'venta.editar_precio',
      'fiado.cobrar',
      'fiado.crear',
      'caja.abrir',
      'caja.cerrar',
      'caja.retirar',
      'gasto.cargar',
      'producto.alta_rapida',
      'producto.editar',
      'cotizacion.cambiar',
    ] as const) {
      expect(puede('seller', p), p).toBe(true);
    }
  });

  it('pero no ve el balance del mes, que es lo único que el dueño se reserva', () => {
    expect(puede('seller', 'reporte.ventas')).toBe(false);
    expect(puede('seller', 'reporte.rentabilidad')).toBe(false);
    expect(puede('owner', 'reporte.ventas')).toBe(true);
  });

  it('ni administra usuarios: eso no es atender, es controlar el sistema', () => {
    expect(puede('seller', 'usuario.administrar')).toBe(false);
  });

  it('cada permiso está clasificado: uno nuevo no se cuela sin decidirlo', () => {
    /*
     * La lista de excepciones se escribe a mano y la de permisos crece sola.
     * Sin esta prueba, agregar `reporte.impuestos` mañana lo dejaría abierto al
     * vendedor por omisión, que es el precio de que la regla sea «puede todo
     * menos». Acá se paga ese precio una vez: el que agrega un permiso tiene
     * que venir a decir de qué lado va.
     */
    const CLASIFICADOS: readonly Permiso[] = [
      'venta.crear',
      'venta.anular',
      'venta.descuento',
      'venta.editar_precio',
      'fiado.cobrar',
      'fiado.crear',
      'stock.ver',
      'stock.ajustar',
      'caja.abrir',
      'caja.cerrar',
      'caja.retirar',
      'gasto.ver',
      'gasto.cargar',
      'producto.alta_rapida',
      'producto.editar',
      'reporte.ventas',
      'reporte.rentabilidad',
      'cotizacion.cambiar',
      'usuario.administrar',
      'configuracion.editar',
    ];
    expect([...PERMISOS].sort()).toEqual([...CLASIFICADOS].sort());
    for (const p of RESERVADOS_AL_DUENIO) expect(CLASIFICADOS).toContain(p);
  });
});
