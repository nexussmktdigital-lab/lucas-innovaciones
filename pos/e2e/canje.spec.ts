import { expect, test, type Page } from '@playwright/test';

/**
 * Plan canje, de punta a punta.
 *
 * Se vende un iPhone cotizado en dólares, el cliente entrega el suyo como
 * parte de pago y el resto entra en billetes. Lo que este archivo protege son
 * las tres cosas que hacen del canje algo distinto de una forma de pago:
 *
 *  1. Al cajón entra **solo** lo que se pagó en plata.
 *  2. El equipo recibido queda vendible, con su IMEI en el nombre.
 *  3. El cliente se lleva por escrito qué entregó y por cuánto.
 *
 * De paso cubre el cobro de una venta **en dólares**, que no tenía ningún
 * recorrido de punta a punta: el único camino en dólares con e2e era el cobro
 * de una deuda, que va por otro lado. Ahí se escondía que la acción del
 * servidor descartaba los dólares del pago y la venta se rechazaba.
 *
 * Necesita la base migrada y sembrada:
 *   npm run db:migrate && npm run db:seed -- --reset
 */

const EMAIL = 'lucas@lucasinnovaciones.com.ar';
const PASSWORD = process.env.SEED_PASSWORD_DUENIO ?? 'lucas-desarrollo-2026';

test.describe.configure({ mode: 'serial' });

/** Por corrida: la base no se vacía entre corridas y un nombre repetido falla. */
const SUFIJO = Date.now().toString().slice(-5);
const IMEI = `9${SUFIJO}`;
const EQUIPO = 'iPhone 13 128gb 87%';

async function entrarComoDuenio(page: Page) {
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Dueño' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();
}

async function asegurarCajaAbierta(page: Page) {
  await page.goto('/caja');
  if (
    await page
      .getByRole('button', { name: 'Abrir caja' })
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByLabel('Efectivo inicial').fill('0');
    await page.getByRole('button', { name: 'Abrir caja' }).click();
  }
  await expect(page.getByText('Turno abierto')).toBeVisible();
}

const pesos = (s: string) => s.replace(/ /g, ' ');

test('se vende un iPhone recibiendo otro en parte de pago', async ({ page, context }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await context.addInitScript(() => {
    window.print = () => {};
  });

  await page.goto('/vender');

  const buscador = page.getByPlaceholder('Buscar por nombre');
  await buscador.fill('iPhone 13');
  await page
    .getByRole('button', { name: /iPhone 13/ })
    .first()
    .waitFor();
  await buscador.press('Enter');

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });

  // El canje: el equipo que entra y por cuánto se lo recibe.
  await cobro.getByRole('button', { name: '+ Canje' }).click();
  await cobro.getByLabel('Equipo que entra en el canje').fill(EQUIPO);
  await cobro.getByLabel('IMEI del equipo que entra').fill(IMEI);
  await cobro.getByLabel(/Monto en Canje/).fill('300');

  // Y el resto, en billetes. La pantalla ya sabe cuánto falta.
  await cobro.getByRole('button', { name: '+ Dólares' }).click();
  const enDolares = cobro.getByLabel(/Monto en Dólares/);
  await enDolares.fill('220');

  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });
});

test('al cajón entró solo lo que se pagó en plata', async ({ page }) => {
  /*
   * El corazón del asunto. Cargar el canje como efectivo dejaba el cajón con
   * trescientos dólares que no existen, y a quien arquea justificando una
   * diferencia inventada.
   */
  await entrarComoDuenio(page);
  await page.goto('/caja');

  // El canje figura, pero del lado de lo que NO entró al cajón.
  await expect(page.getByText(/Recibido en canje · entró mercadería, no plata/)).toBeVisible();

  await page.goto('/cuentas');
  const cajon = page.getByRole('link').filter({ hasText: 'Caja en dólares' });
  // Los 220 de billetes están; los 300 del canje, no.
  await expect(cajon).toContainText('220');
});

test('el equipo recibido queda vendible, con su IMEI en el nombre', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/vender');

  const buscador = page.getByPlaceholder('Buscar por nombre');
  await buscador.fill(IMEI);

  // Entró al catálogo y se puede vender en el acto: lo pidió el local.
  await expect(
    page.getByRole('button', { name: new RegExp(`${EQUIPO.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`) }).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test('el comprobante dice qué entregó el cliente y por cuánto', async ({ page, context }) => {
  /*
   * Es la única forma de pago que se imprime, y a propósito: las otras son
   * asunto interno, pero un canje es un teléfono que el cliente dejó en el
   * mostrador y del que no se lleva otra constancia que este papel.
   */
  await entrarComoDuenio(page);
  await context.addInitScript(() => {
    window.print = () => {};
  });

  await page.goto('/ventas');
  const [papeles] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('listitem').first().getByRole('link', { name: /Ver e imprimir/ }).click(),
  ]);
  await papeles.waitForLoadState('domcontentloaded');

  const papel = pesos(await papeles.locator('.hoja').first().innerText());
  expect(papel).toContain('ENTREGÓ EN PARTE DE PAGO');
  expect(papel).toContain(EQUIPO);
  expect(papel).toContain(IMEI);
  expect(papel).toContain('US$ 300,00');
});
