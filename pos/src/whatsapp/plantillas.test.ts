/**
 * Tests de las plantillas.
 *
 * Son funciones puras: no hace falta base. Lo que se prueba es lo que se rompe
 * en la vida real —una llave mal escrita, un campo vacio, un texto larguisimo—
 * antes de que el cliente lo lea.
 */
import { describe, expect, it } from 'vitest';
import {
  camposUsados,
  ErrorPlantilla,
  LARGO_MAXIMO,
  nombreDePila,
  PLANTILLAS_POR_DEFECTO,
  renderizar,
  validarPlantilla,
} from './plantillas';
import { enlaceDeWhatsApp, numeroParaEnlace } from './enlace';

describe('campos', () => {
  it('los encuentra en orden y sin repetir', () => {
    expect(camposUsados('Hola {cliente}, {cliente}, soy {local}')).toEqual(['cliente', 'local']);
  });

  it('un texto sin campos no tiene ninguno', () => {
    expect(camposUsados('Hola, ¿cómo andás?')).toEqual([]);
  });
});

describe('validar', () => {
  it('acepta las plantillas de fábrica', () => {
    expect(() => validarPlantilla('comprobante', PLANTILLAS_POR_DEFECTO.comprobante)).not.toThrow();
    expect(() =>
      validarPlantilla('recordatorio_fiado', PLANTILLAS_POR_DEFECTO.recordatorio_fiado),
    ).not.toThrow();
  });

  it('rechaza un campo mal escrito y dice cuáles hay', () => {
    try {
      validarPlantilla('comprobante', 'Hola {clientee}');
      expect.unreachable('tendría que haber fallado');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorPlantilla);
      expect((error as Error).message).toContain('{clientee}');
      expect((error as Error).message).toContain('{cliente}');
    }
  });

  it('rechaza un campo que existe pero en el mensaje equivocado', () => {
    // {total} es de la compra, no de la deuda.
    expect(() => validarPlantilla('recordatorio_fiado', 'Debés {total}')).toThrow(ErrorPlantilla);
  });

  it('no deja guardar un mensaje vacío', () => {
    expect(() => validarPlantilla('comprobante', '   ')).toThrow(ErrorPlantilla);
  });

  it('no deja guardar un mensaje interminable', () => {
    expect(() => validarPlantilla('comprobante', 'a'.repeat(LARGO_MAXIMO + 1))).toThrow(
      ErrorPlantilla,
    );
  });
});

describe('renderizar', () => {
  it('pone los datos donde van', () => {
    const texto = renderizar('Hola {cliente}, gracias por comprar en {local}', {
      cliente: 'Gaby',
      local: 'Lucas Innovaciones',
    });
    expect(texto).toBe('Hola Gaby, gracias por comprar en Lucas Innovaciones');
  });

  it('un campo sin valor se borra en vez de quedar con la llave puesta', () => {
    expect(renderizar('Hola {cliente}!', { cliente: null })).toBe('Hola !');
  });

  it('borrar un campo no deja espacios dobles ni renglones sueltos', () => {
    const texto = renderizar('Hola {cliente} {apodo} ¿qué tal?\n\n{nota}\n\nChau', {
      cliente: 'Gaby',
      apodo: null,
      nota: null,
    });
    expect(texto).toBe('Hola Gaby ¿qué tal?\n\nChau');
  });

  it('respeta los saltos de línea del texto', () => {
    expect(renderizar('Uno\nDos\nTres', {})).toBe('Uno\nDos\nTres');
  });

  it('un dato de varias líneas entra entero', () => {
    const texto = renderizar('Llevaste:\n{detalle}\nGracias', {
      detalle: '2 × Vidrio templado\nCargador tipo C',
    });
    expect(texto).toBe('Llevaste:\n2 × Vidrio templado\nCargador tipo C\nGracias');
  });
});

describe('nombre de pila', () => {
  it('saluda por el primer nombre', () => {
    expect(nombreDePila('Gabriela González Pérez')).toBe('Gabriela');
  });

  it('un solo nombre queda igual', () => {
    expect(nombreDePila('Lucas')).toBe('Lucas');
  });
});

describe('enlace', () => {
  it('el número va sin + y sin nada que no sea dígito', () => {
    expect(numeroParaEnlace('+5493514567890')).toBe('5493514567890');
  });

  it('el texto viaja escapado: saltos de línea, acentos y emojis', () => {
    const url = enlaceDeWhatsApp('+5493514567890', 'Hola Gaby!\nGracias 🙌');
    expect(url).toBe(
      'https://wa.me/5493514567890?text=Hola%20Gaby!%0AGracias%20%F0%9F%99%8C',
    );
  });

  it('un & en el texto no corta la URL', () => {
    const url = enlaceDeWhatsApp('+5493514567890', 'Funda & vidrio');
    expect(url).not.toContain('&vidrio');
    expect(decodeURIComponent(url.split('?text=')[1]!)).toBe('Funda & vidrio');
  });
});
