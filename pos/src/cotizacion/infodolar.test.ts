/**
 * Lectura del blue de Córdoba de infodolar.com.
 *
 * El fixture es la página real, guardada el 1 de octubre de 2026, recortada a
 * las dos tablas de promedio. Está la de verdad y está la señuelo: eso es lo
 * que hay que probar, porque el error que importa no es que no lea nada —eso
 * se ve— sino que lea **el otro número**.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ErrorInfodolar,
  leerBlueCordoba,
  obtenerBlueCordoba,
  URL_INFODOLAR,
} from './infodolar';

const PAGINA = readFileSync(join(__dirname, 'fixtures/infodolar-cordoba.html'), 'utf8');

describe('la página real de infodólar', () => {
  it('lee el blue vendedor de Córdoba', () => {
    const r = leerBlueCordoba(PAGINA);

    expect(r.ventaCentavos).toBe(1_571_00);
    expect(r.compraCentavos).toBe(1_539_00);
  });

  it('NO agarra el dólar oficial, que es el primero de la página', () => {
    /*
     * El que agarraría un selector `.colCompraVenta` suelto es $1.499,38: el
     * oficial, columna compra. Setenta y dos pesos abajo del blue vendedor, el
     * dólar equivocado y la punta equivocada. Es el error que este test existe
     * para que no vuelva.
     */
    const r = leerBlueCordoba(PAGINA);

    expect(PAGINA).toContain('1.499,38'); // está en la página…
    expect(r.ventaCentavos).not.toBe(1_499_38); // …y no es lo que se lee
    expect(r.compraCentavos).not.toBe(1_499_38);
  });

  it('lee la hora que la página dice que tiene el dato', () => {
    // Sirve para no guardar como «de ahora» un número que infodólar tiene
    // congelado desde ayer.
    const r = leerBlueCordoba(PAGINA);

    expect(r.actualizado).toBeInstanceOf(Date);
    // Jueves 1 de octubre de 2026, 17:51 hora argentina.
    expect(r.actualizado!.toISOString()).toBe('2026-10-01T20:51:00.000Z');
  });
});

describe('se rompe ruidosamente, no en silencio', () => {
  it('si no está la tabla del blue', () => {
    // El caso real: infodólar rediseña y la tabla cambia de id. Antes que
    // devolver «algún número que parezca un dólar», no devuelve nada.
    const sinBlue = PAGINA.replace(/id="BluePromedio"/, 'id="OtraCosa"');

    expect(() => leerBlueCordoba(sinBlue)).toThrow(ErrorInfodolar);
    expect(() => leerBlueCordoba(sinBlue)).toThrow(/blue de Córdoba/i);
  });

  it('si la tabla ya no dice ser la de Córdoba', () => {
    const sinCordoba = PAGINA.replace(/en Córdoba<\/span>/g, 'en Misiones</span>');
    expect(() => leerBlueCordoba(sinCordoba)).toThrow(/Córdoba/i);
  });

  it('si la fila trae un solo precio', () => {
    const cortada = PAGINA.replace(
      /class="colCompraVenta" data-order="\$ 1\.571,00"/,
      'class="otraClase" data-order="$ 1.571,00"',
    );
    expect(() => leerBlueCordoba(cortada)).toThrow(/hacen falta dos/i);
  });

  it('si venta quedó por debajo de compra, que es señal de columnas dadas vuelta', () => {
    const dadaVuelta = PAGINA.replace('data-order="$ 1.571,00"', 'data-order="$ 1.000,00"');
    expect(() => leerBlueCordoba(dadaVuelta)).toThrow(/al revés/i);
  });

  it('si el número no es un número', () => {
    const roto = PAGINA.replace('data-order="$ 1.539,00"', 'data-order="N/D"');
    expect(() => leerBlueCordoba(roto)).toThrow(/no es un precio/i);
  });

  it('con una página de bloqueo, que es HTML válido sin la tabla', () => {
    expect(() => leerBlueCordoba('<html><body>Access denied</body></html>')).toThrow(
      ErrorInfodolar,
    );
  });

  it('con la respuesta vacía', () => {
    expect(() => leerBlueCordoba('')).toThrow(ErrorInfodolar);
  });
});

describe('cómo lee los números', () => {
  const conPrecios = (compra: string, venta: string) =>
    `<table id="BluePromedio"><tbody><tr>
       <td class="colNombre"><span class="nombre">Dólar Blue en Córdoba</span></td>
       <td class="colCompraVenta" data-order="${compra}"></td>
       <td class="colCompraVenta" data-order="${venta}"></td>
     </tr></tbody></table>`;

  it('el punto es de miles y la coma, decimal', () => {
    expect(leerBlueCordoba(conPrecios('$ 1.539,00', '$ 1.571,50')).ventaCentavos).toBe(
      1_571_50,
    );
  });

  it('aguanta un dólar de cinco cifras', () => {
    // No es ciencia ficción con esta inflación, y el punto de miles doble es
    // justo donde un parser descuidado se equivoca por mil.
    expect(leerBlueCordoba(conPrecios('$ 10.500,00', '$ 10.750,00')).ventaCentavos).toBe(
      10_750_00,
    );
  });

  it('sin fecha legible devuelve null en vez de fallar', () => {
    // Que no se entienda la fecha no es razón para descartar un precio bueno.
    const r = leerBlueCordoba(conPrecios('$ 1.539,00', '$ 1.571,00'));
    expect(r.actualizado).toBeNull();
    expect(r.ventaCentavos).toBe(1_571_00);
  });
});

describe('obtenerBlueCordoba', () => {
  it('pide la página de Córdoba y la lee', async () => {
    let pedida = '';
    const fetchImpl = (async (url: string | URL) => {
      pedida = String(url);
      return new Response(PAGINA, { status: 200 });
    }) as unknown as typeof fetch;

    const r = await obtenerBlueCordoba(fetchImpl);

    expect(pedida).toBe(URL_INFODOLAR);
    expect(r.ventaCentavos).toBe(1_571_00);
  });

  it('avisa cuando infodólar contesta mal', async () => {
    const fetchImpl = (async () =>
      new Response('bloqueado', { status: 503 })) as unknown as typeof fetch;

    await expect(obtenerBlueCordoba(fetchImpl)).rejects.toThrow(/503/);
  });

  it('avisa cuando no hay red', async () => {
    const fetchImpl = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;

    await expect(obtenerBlueCordoba(fetchImpl)).rejects.toThrow(ErrorInfodolar);
  });
});
