import { expect, test, type Page } from '@playwright/test';

/**
 * Venta de contado, de punta a punta.
 *
 * Necesita la base migrada y sembrada:
 *   npm run db:migrate && npm run db:seed -- --reset
 *
 * Los tests corren en serie y comparten la caja abierta: es lo mismo que pasa
 * en el mostrador, un turno con varias ventas encima.
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

async function agregar(page: Page, termino: string, nombreVisible: RegExp) {
  const buscador = page.getByPlaceholder('Buscar por nombre');
  await buscador.fill(termino);
  await page.getByRole('button', { name: nombreVisible }).first().waitFor();
  await buscador.press('Enter');
}

async function asegurarCajaAbierta(page: Page) {
  await page.goto('/caja');
  if (await page.getByRole('button', { name: 'Abrir caja' }).isVisible().catch(() => false)) {
    await page.getByLabel('Efectivo inicial').fill('20000');
    await page.getByRole('button', { name: 'Abrir caja' }).click();
  }
  await expect(page.getByText('Turno abierto')).toBeVisible();
}

test('sin caja abierta, la pantalla de venta lo dice y ofrece abrirla', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/vender');

  // Puede estar abierta de una corrida anterior; se contemplan las dos.
  const cerrada = page.getByText('La caja está cerrada');
  if (await cerrada.isVisible().catch(() => false)) {
    await expect(page.getByRole('link', { name: 'Abrir la caja' })).toBeVisible();
  } else {
    await expect(page.getByPlaceholder('Buscar por nombre')).toBeVisible();
  }
});

test('se abre la caja declarando el efectivo inicial', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await expect(page.getByText('Efectivo esperado')).toBeVisible();
});

test('el buscador encuentra por nombre y muestra stock', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/vender');

  await page.getByPlaceholder('Buscar por nombre').fill('pendrive');
  const resultado = page.getByRole('button', { name: /Pendrive Hiksemi/ });
  await expect(resultado).toBeVisible();
  await expect(resultado).toContainText('en stock');
});

test('un producto en dólares muestra las dos cifras', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/vender');

  await agregar(page, 'iPhone 14 Pro', /iPhone 14 Pro/);

  const carrito = page.getByRole('complementary', { name: 'Carrito' });
  await expect(carrito).toContainText('US$ 1.370,00 c/u');
  // USD 1.370 al TC del seed ($1.571) = $2.152.000 redondeado al millar.
  await expect(carrito).toContainText('2.152.000,00');
});

test('venta completa: cobra, calcula el vuelto y vacía el carrito', async ({ page, context }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/vender');

  await agregar(page, 'vidrio templado', /Vidrio templado/);

  const carrito = page.getByRole('complementary', { name: 'Carrito' });
  await expect(carrito).toContainText('1 unidad');

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await expect(cobro).toBeVisible();

  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByLabel('Monto en Efectivo').fill('10000');

  await expect(cobro.getByText('Vuelto')).toBeVisible();
  await expect(cobro).toContainText('5.000,00');

  // El ticket se abre en otra pestaña; se la deja pasar sin imprimir.
  await context.addInitScript(() => {
    window.print = () => {};
  });

  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();

  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });
  await expect(cobro).toBeHidden();
});

test('no se puede confirmar sin cubrir el total', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/vender');

  await agregar(page, 'vidrio templado', /Vidrio templado/);
  await page.getByRole('button', { name: /^Cobrar/ }).click();

  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByLabel('Monto en Efectivo').fill('1000');

  await expect(cobro.getByText('El pago no cubre el total.')).toBeVisible();
  await expect(cobro.getByRole('button', { name: /Confirmar venta/ })).toBeDisabled();
});

test('fiar exige elegir un cliente', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/vender');

  await agregar(page, 'vidrio templado', /Vidrio templado/);
  await page.getByRole('button', { name: /^Cobrar/ }).click();

  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Cuenta corriente' }).click();

  await expect(cobro.getByText(/hace falta elegir un cliente/)).toBeVisible();
  await expect(cobro.getByRole('button', { name: /Confirmar venta/ })).toBeDisabled();
});

test('la caja refleja las ventas del turno', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  await expect(page.getByText('Ventas del turno')).toBeVisible();

  // El desglose por medio solo aparece cuando ya hubo una venta en el turno.
  const desglose = page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: 'Por medio de pago' }) })
    .last();
  await expect(desglose).toContainText('Efectivo');
});

test('el cierre exige justificar la diferencia', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  await page.getByRole('button', { name: 'Cerrar el turno' }).click();
  await page.getByLabel('Efectivo contado').fill('1');

  await expect(page.getByText(/Falta\s/)).toBeVisible();
  await expect(page.getByLabel('¿A qué se debe?')).toBeVisible();
});
