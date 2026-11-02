import { expect, test, type Page } from '@playwright/test';

/**
 * Cambiar el recargo de la tienda sin mover los precios del mostrador.
 *
 * Necesita la base migrada y sembrada:
 *   npm run db:migrate && npm run db:seed -- --reset
 *
 * Lo que se comprueba es lo que falló de verdad el 21/10: que subir el recargo
 * no termine bajando lo que cobra el local. Los tests de unidad ya prueban la
 * cuenta; acá se prueba el camino completo —la casilla, la vista previa, el
 * botón de confirmar— porque la cuenta estaba bien y lo que faltaba era que
 * alguien la ofreciera en la pantalla.
 */

const EMAIL = 'lucas@lucasinnovaciones.com.ar';
const PASSWORD = process.env.SEED_PASSWORD_DUENIO ?? 'lucas-desarrollo-2026';

test.describe.configure({ mode: 'serial' });

async function entrarComoDuenio(page: Page) {
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Dueño' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();
}

/** Los precios de mostrador que se ven en pantalla, en orden. */
async function preciosDeMostrador(page: Page): Promise<string[]> {
  const bloques = page.locator('li', { has: page.getByText('Mostrador', { exact: true }) });
  return bloques.evaluateAll((lis) =>
    lis.map((li) => {
      const p = li.querySelector('.text-xl.font-bold');
      return p?.textContent?.trim() ?? '';
    }),
  );
}

async function ponerRecargo(page: Page, porcentaje: string, mantener: boolean) {
  await page.goto('/precios');
  await page.getByLabel('Recargo de la tienda online').fill(porcentaje);
  const casilla = page.getByRole('checkbox', {
    name: /Que el mostrador siga cobrando lo mismo/,
  });
  if (mantener) await casilla.check();
  else await casilla.uncheck();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
}

test('subir el recargo con la casilla puesta no mueve ningún precio de mostrador', async ({
  page,
}) => {
  await entrarComoDuenio(page);

  await page.goto('/precios');
  const antes = await preciosDeMostrador(page);
  expect(antes.length).toBeGreaterThan(0);

  await ponerRecargo(page, '15', true);

  // Primero la vista previa: todavía no se guardó nada.
  await expect(page.getByText(/cambia.*precios de la web/)).toBeVisible();
  await expect(page.getByText('Ningún precio de mostrador se mueve')).toBeVisible();
  expect(await preciosDeMostrador(page)).toEqual(antes);

  await page.getByRole('button', { name: /Aplicar los .* cambios/ }).click();
  await expect(page.getByText(/Se reajustaron .* precios de la web/)).toBeVisible();

  await page.goto('/precios');
  expect(await preciosDeMostrador(page)).toEqual(antes);
});

test('volver a cero con la casilla puesta tampoco los mueve', async ({ page }) => {
  await entrarComoDuenio(page);

  await page.goto('/precios');
  const antes = await preciosDeMostrador(page);

  await ponerRecargo(page, '0', true);
  await page.getByRole('button', { name: /Aplicar los .* cambios/ }).click();
  await expect(page.getByText(/Se reajustaron .* precios de la web/)).toBeVisible();

  await page.goto('/precios');
  const despues = await preciosDeMostrador(page);

  /*
   * El redondeo a los cien pesos puede correr un precio al ir y volver, pero
   * no más que eso: lo que no puede pasar es el 13% del 21/10.
   */
  expect(despues).toHaveLength(antes.length);
  for (let i = 0; i < antes.length; i++) {
    const a = Number(antes[i]!.replace(/[^\d]/g, ''));
    const d = Number(despues[i]!.replace(/[^\d]/g, ''));
    expect(Math.abs(d - a)).toBeLessThanOrEqual(100_00);
  }
});

test('sin la casilla, el precio de mostrador baja: es lo que pasó el 21/10', async ({ page }) => {
  await entrarComoDuenio(page);

  await page.goto('/precios');
  const antes = await preciosDeMostrador(page);

  await ponerRecargo(page, '15', false);
  // Sin vista previa: se guarda directo.
  await expect(page.getByText(/Recargo guardado en 15%/)).toBeVisible();

  await page.goto('/precios');
  const despues = await preciosDeMostrador(page);
  expect(despues).not.toEqual(antes);

  // Lo dejamos como estaba, que las demás corridas parten de acá.
  await ponerRecargo(page, '0', false);
  await expect(page.getByText(/Sin recargo/)).toBeVisible();
});
