import { expect, test, type Page } from '@playwright/test';
import { generarRecibo, type DatosDelRecibo } from '../src/fiado/recibo';

/**
 * El recibo de un pago, medido en el navegador.
 *
 * Los tests de `src/fiado/recibo.test.ts` miran **qué dice** el papel. Esto
 * mira **cuánto mide**, que es otra cosa y no se puede comprobar leyendo el
 * HTML: hay que renderizarlo. Es la clase de error que ya salió dos veces en
 * el comprobante de venta —una hoja que se pasa un milímetro y sale una
 * página de más, con el pie solo— y que solo se ve imprimiendo.
 *
 * Lo que se sostiene acá es que **una copia nunca necesita dos páginas**. Con
 * eso, el `break-inside: avoid` del CSS alcanza: la copia que no entre al pie
 * de la hoja se va entera a la siguiente, y nunca se parte una firma al
 * medio.
 */

const A4_MM = 297;

const BASE: DatosDelRecibo = {
  codigo: 'RC-A1B2C3D4',
  fecha: new Date('2026-10-21T18:30:00Z'),
  cliente: 'Gabriela González de los Santos',
  documento: '28.456.789',
  montoCentavos: 50_000_00,
  monedaDeuda: 'ARS',
  medio: 'efectivo',
  saldoCentavos: 120_000_00,
  cobradoPor: 'Rocío',
};

/** Una nota de las largas, de las que escribe alguien en el mostrador. */
const NOTA_LARGA =
  'Pagó la cuota de octubre y adelantó parte de la de noviembre, quedó en pasar el viernes ' +
  'con el resto del dinero y a retirar el cargador que había dejado para revisar';

/** Alto de cada copia, en milímetros de verdad. */
async function copiasEnMm(page: Page, html: string): Promise<number[]> {
  await page.setContent(html);
  return page.evaluate(() => {
    const regla = document.createElement('div');
    regla.style.height = '100mm';
    document.body.appendChild(regla);
    const px = regla.getBoundingClientRect().height / 100;
    regla.remove();
    return Array.from(document.querySelectorAll('.mitad')).map(
      (m) => Math.round((m.getBoundingClientRect().height / px) * 10) / 10,
    );
  });
}

const CASOS: { nombre: string; datos: DatosDelRecibo }[] = [
  { nombre: 'un pago común', datos: BASE },
  { nombre: 'con una nota larga', datos: { ...BASE, nota: NOTA_LARGA } },
  {
    nombre: 'con la cuenta saldada',
    datos: { ...BASE, montoCentavos: 120_000_00, saldoCentavos: 0 },
  },
  {
    nombre: 'con deuda en las dos monedas',
    datos: { ...BASE, otraDeuda: { centavos: 600_00, moneda: 'USD' } },
  },
  {
    // El más alto de todos: dos monedas, el renglón de la caja y nota larga.
    nombre: 'el peor caso',
    datos: {
      ...BASE,
      monedaDeuda: 'USD',
      montoCentavos: 200_00,
      saldoCentavos: 400_00,
      medio: 'transferencia',
      enCaja: { montoCentavos: 314_200_00, moneda: 'ARS' },
      otraDeuda: { centavos: 600_000_00, moneda: 'ARS' },
      nota: NOTA_LARGA,
    },
  },
];

for (const caso of CASOS) {
  test(`una copia entra en una página: ${caso.nombre}`, async ({ page }) => {
    const copias = await copiasEnMm(page, generarRecibo(caso.datos));

    expect(copias).toHaveLength(2);
    for (const alto of copias) expect(alto).toBeLessThan(A4_MM);

    // Y las dos miden lo mismo: son el mismo papel dos veces.
    expect(copias[0]).toBe(copias[1]);
  });
}

test('el pago de todos los días entra dos veces en una sola hoja', async ({ page }) => {
  /*
   * El caso común —una deuda, un medio, sin nota— tiene que salir en UNA
   * página con las dos copias: es lo que justifica imprimirlas juntas en vez
   * de gastar una hoja por copia. Si no entrara, serían dos hojas por cada
   * cuota cobrada, todos los días.
   */
  await page.setContent(generarRecibo(BASE));

  /*
   * Se mide la hoja entera y no la suma de sus partes: sumar lo que uno cree
   * que la compone deja afuera justo lo que se olvidó —el padding, el margen
   * del corte— que es por donde se pasa.
   */
  const hoja = await page.locator('.hoja').evaluate((el) => {
    const regla = document.createElement('div');
    regla.style.height = '100mm';
    document.body.appendChild(regla);
    const px = regla.getBoundingClientRect().height / 100;
    regla.remove();
    return el.getBoundingClientRect().height / px;
  });

  expect(hoja).toBeLessThanOrEqual(A4_MM);
});
