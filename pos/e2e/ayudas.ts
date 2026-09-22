import type { Page } from '@playwright/test';

/**
 * Ayudas compartidas por las pruebas de punta a punta.
 */

/**
 * Elige el vendedor en la pantalla de ingreso.
 *
 * Con un solo vendedor cargado la pantalla no muestra nada para elegir —no hay
 * nada que elegir— y manda su id escondido. Con dos o más aparecen los
 * redondeles. La prueba no tiene por qué saber en cuál de los dos casos está.
 */
export async function elegirVendedor(page: Page, nombre: string): Promise<void> {
  const redondel = page.getByRole('radio', { name: nombre });
  if ((await redondel.count()) > 0) await redondel.check();
}

/**
 * Abre el cajón de «Más» y devuelve el cajón, para buscar adentro.
 *
 * Las ocho secciones que no son de todos los días viven ahí desde el rediseño.
 */
export async function abrirCajon(page: Page) {
  await page.getByRole('button', { name: /^Más/ }).click();
  return page.locator('#cajon-secciones');
}
