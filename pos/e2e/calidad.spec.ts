import { expect, test, type Page } from '@playwright/test';

/**
 * Dólares y calidad de datos.
 *
 * Necesita la base migrada y sembrada:
 *   npm run db:migrate && npm run db:seed -- --reset
 */

const EMAIL = 'lucas@lucasinnovaciones.com.ar';
const PASSWORD = process.env.SEED_PASSWORD_DUENIO ?? 'lucas-desarrollo-2026';
const PIN = process.env.SEED_PIN_VENDEDOR ?? '4827';

test.describe.configure({ mode: 'serial' });

async function entrarComoDuenio(page: Page) {
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Dueño' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();
}

test('el marcador de producto real muestra el contraste con el POS anterior', async ({ page }) => {
  await entrarComoDuenio(page);

  const marcador = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Facturación con producto real' }) });

  await expect(marcador).toContainText('meta: 70% o más');
  // El histórico de la auditoría: 30% → 33% → 39%.
  await expect(marcador).toContainText('39%');
  await expect(marcador).toContainText('2026-07');
  await expect(marcador).toContainText('POS anterior');
});

test('la pantalla del dólar muestra el valor, el historial y a cuántos productos afecta', async ({
  page,
}) => {
  await entrarComoDuenio(page);
  await page.goto('/cotizacion');

  await expect(page.getByRole('heading', { name: 'Tipo de cambio' })).toBeVisible();
  await expect(page.getByText('1.571,00').first()).toBeVisible();
  await expect(page.getByText(/productos? del catálogo dependen/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Historial' })).toBeVisible();
});

test('un salto grande del dólar pide confirmación en vez de aceptarlo', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/cotizacion');

  // De 1.561 a 2.400 son casi 54%: probablemente un dígito de más.
  await page.getByLabel('Pesos por dólar').fill('2400');
  await page.getByRole('button', { name: 'Guardar' }).click();

  const aviso = page.locator('form').getByRole('alert');
  await expect(aviso).toContainText('para arriba');
  await expect(aviso.getByLabel(/el valor es correcto/)).toBeVisible();
});

test('un valor imposible se rechaza sin ofrecer confirmarlo', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/cotizacion');

  await page.getByLabel('Pesos por dólar').fill('15');
  await page.getByRole('button', { name: 'Guardar' }).click();

  const aviso = page.locator('form').getByRole('alert');
  await expect(aviso).toContainText('fuera de lo posible');
  await expect(aviso.getByLabel(/el valor es correcto/)).toHaveCount(0);
});

test('calidad del catálogo encuentra el iPhone con el error de agosto', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/catalogo');

  await expect(page.getByRole('heading', { name: 'Calidad del catálogo' })).toBeVisible();
  await expect(page.getByText('iPhone 15 Pro Max 1TB')).toBeVisible();
  await expect(page.getByText(/cifra en dólares/)).toBeVisible();
});

test('no marca como sospechoso un accesorio barato de marca cara', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/catalogo?solo=todo');

  // El cable Lightning de Apple a $13.000 aparece por falta de foto, pero no
  // como precio sospechoso: si gritara por eso, nadie miraría los avisos.
  const cable = page.locator('li').filter({ hasText: 'Cable USB TRV iPhone Lightning' });
  await expect(cable).toBeVisible();
  await expect(cable).not.toContainText('Precio sospechoso');
});

test('vender el iPhone mal cargado frena la venta y explica por qué', async ({ page }) => {
  await entrarComoDuenio(page);

  await page.goto('/caja');
  if (await page.getByRole('button', { name: 'Abrir caja' }).isVisible().catch(() => false)) {
    await page.getByLabel('Efectivo inicial').fill('20000');
    await page.getByRole('button', { name: 'Abrir caja' }).click();
  }

  await page.goto('/vender');
  const buscador = page.getByPlaceholder('Buscar por nombre');
  await buscador.fill('iPhone 15 Pro Max');
  await page.getByRole('button', { name: /iPhone 15 Pro Max/ }).first().waitFor();
  await buscador.press('Enter');

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();

  await expect(cobro.getByText('Frená: revisá el precio antes de cobrar')).toBeVisible();
  await expect(cobro.getByText(/cifra en dólares/)).toBeVisible();
  // Y ofrece las dos salidas: revisar, o cobrar a sabiendas.
  await expect(cobro.getByRole('button', { name: 'Volver y revisar' })).toBeVisible();
  await expect(cobro.getByRole('button', { name: /cobrar igual/ })).toBeVisible();
});

test('el vendedor no ve las pantallas del dueño', async ({ page }) => {
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Vendedor' }).click();
  await page.getByRole('radio', { name: 'Vendedor de mostrador' }).check();
  await page.getByLabel('PIN').fill(PIN);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();

  const navegacion = page.getByRole('navigation', { name: 'Secciones' });
  await expect(navegacion.getByText('Catálogo')).toHaveCount(0);
  await expect(navegacion.getByText('Dólar')).toHaveCount(0);

  // Y si entra por la URL, lo saca.
  await page.goto('/catalogo');
  await expect(page).toHaveURL(/\/$/);
});
