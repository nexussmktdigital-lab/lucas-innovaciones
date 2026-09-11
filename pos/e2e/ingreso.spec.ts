import { expect, test } from '@playwright/test';

/**
 * Ingreso al POS.
 *
 * Datos de `npm run db:seed`: un dueño con email y contraseña, y un vendedor
 * que entra tocando su nombre y tipeando cuatro dígitos.
 */

const PIN = process.env.SEED_PIN_VENDEDOR ?? '4827';
const EMAIL = 'lucas@lucasinnovaciones.com.ar';
const PASSWORD = process.env.SEED_PASSWORD_DUENIO ?? 'lucas-desarrollo-2026';

test('sin sesión, cualquier ruta lleva al ingreso', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/ingresar/);
  await expect(page.getByRole('heading', { name: 'Lucas Innovaciones' })).toBeVisible();
});

test('el vendedor entra con su PIN', async ({ page }) => {
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Vendedor' }).click();
  await page.getByRole('radio', { name: 'Vendedor de mostrador' }).check();
  await page.getByLabel('PIN').fill(PIN);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();
  await expect(page.getByText('Vendedor', { exact: true })).toBeVisible();
});

test('el vendedor no ve el menú de reportes', async ({ page }) => {
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Vendedor' }).click();
  await page.getByRole('radio', { name: 'Vendedor de mostrador' }).check();
  await page.getByLabel('PIN').fill(PIN);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();

  await expect(page.getByRole('navigation').getByText('Reportes')).toHaveCount(0);
});

test('un PIN equivocado no deja pasar', async ({ page }) => {
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Vendedor' }).click();
  await page.getByRole('radio', { name: 'Vendedor de mostrador' }).check();
  await page.getByLabel('PIN').fill('9876');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Se acota al formulario: Next agrega su propio anunciador de rutas con role="alert".
  await expect(page.locator('form').getByRole('alert')).toContainText('PIN incorrecto');
  await expect(page).toHaveURL(/\/ingresar/);
});

test('el dueño entra con email y contraseña y ve el estado del catálogo', async ({ page }) => {
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Dueño' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();
  // El seed carga 27 productos, 3 de ellos en dólares.
  await expect(page.getByText('Espejo del catálogo')).toBeVisible();
  await expect(page.getByRole('navigation').getByText('Reportes')).toBeVisible();
});

test('el dueño ve el tipo de cambio y la conversión de un iPhone', async ({ page }) => {
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Dueño' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();

  const seccion = page.locator('section', { has: page.getByRole('heading', { name: 'Tipo de cambio' }) });
  await expect(seccion).toContainText('1.571,00');
  await expect(seccion).toContainText('iPhone 14 Pro 256GB');
  await expect(seccion).toContainText('2.152.000,00');
});

test('se puede salir de la sesión', async ({ page }) => {
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Vendedor' }).click();
  await page.getByRole('radio', { name: 'Vendedor de mostrador' }).check();
  await page.getByLabel('PIN').fill(PIN);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();

  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page).toHaveURL(/\/ingresar/);
});
