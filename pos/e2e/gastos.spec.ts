import { expect, test, type Page } from '@playwright/test';

/**
 * Gastos y cuentas monetarias, de punta a punta.
 *
 * Necesita la base migrada y sembrada:
 *   npm run db:migrate && npm run db:seed -- --reset
 *
 * Lo que se comprueba no es que la pantalla abra: es que la plata que sale del
 * cajón se descuente del arqueo, que el que no la puede ver no la vea, y que
 * anular devuelva exactamente lo que salió.
 */

const EMAIL = 'lucas@lucasinnovaciones.com.ar';
const PASSWORD = process.env.SEED_PASSWORD_DUENIO ?? 'lucas-desarrollo-2026';
const PIN = process.env.SEED_PIN_VENDEDOR ?? '4827';

test.describe.configure({ mode: 'serial' });

/** La base no se vacía entre corridas: cada una usa sus propias descripciones. */
const SUF = Date.now().toString().slice(-5);
const FLETE = `Flete de Córdoba ${SUF}`;
const ALQUILER = `Alquiler pendiente ${SUF}`;

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
    await page.getByLabel('Efectivo inicial').fill('50000');
    await page.getByRole('button', { name: 'Abrir caja' }).click();
  }
  await expect(page.getByText('Turno abierto')).toBeVisible();
}

/**
 * La lista de gastos del mes.
 *
 * Un gasto pendiente sale dos veces en la página —acá y arriba, en «falta
 * pagar»—, así que hay que decir de cuál se está hablando.
 */
function cargados(page: Page) {
  return page.getByRole('region', { name: 'Gastos cargados' });
}

/** El efectivo que el arqueo dice que tiene que haber en el cajón. */
async function efectivoEsperado(page: Page): Promise<string> {
  await page.goto('/caja');
  const bloque = page.getByText('Efectivo esperado').locator('..');
  const texto = await bloque.innerText();
  return texto.match(/\$[\s ][\d.]+,\d{2}/)?.[0] ?? '';
}

test('un gasto en efectivo sale del cajón y el arqueo lo descuenta', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  const antes = await efectivoEsperado(page);

  await page.goto('/gastos');
  await page.getByRole('button', { name: '+ Cargar un gasto' }).click();

  // El alta y el filtro tienen campos que se llaman igual, así que se trabaja
  // dentro del formulario, no sobre la página.
  const alta = page.getByRole('form', { name: 'Cargar un gasto' });
  await alta.getByLabel('¿En qué se gastó?').fill(FLETE);
  await alta.getByLabel('Cuánto').fill('12000');
  await alta.getByLabel('Categoría').selectOption({ label: 'Envíos' });
  await alta.getByLabel('Con qué').selectOption('efectivo');
  await alta.getByLabel('De qué cuenta salió').selectOption({ label: 'Caja en efectivo' });
  await alta.getByRole('button', { name: 'Guardar el gasto' }).click();

  // El gasto queda en la lista con su categoría y su cuenta.
  const fila = cargados(page).getByRole('listitem').filter({ hasText: FLETE });
  await expect(fila).toBeVisible({ timeout: 15_000 });
  await expect(fila).toContainText('Envíos');
  await expect(fila).toContainText('$ 12.000,00');

  // Y el cajón tiene $12.000 menos que antes.
  const despues = await efectivoEsperado(page);
  expect(despues).not.toBe(antes);
  await expect(page.getByText('Gastos pagados del cajón')).toBeVisible();
  await expect(page.getByText('−$ 12.000,00')).toBeVisible();
});

test('anular el gasto devuelve la plata al cajón', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  const conGasto = await efectivoEsperado(page);

  await page.goto('/gastos');
  const fila = cargados(page).getByRole('listitem').filter({ hasText: FLETE });
  await fila.getByRole('button', { name: 'Anular' }).click();
  await page.getByLabel(/¿Por qué se anula este gasto/).fill('Se cargó dos veces');
  await page.getByRole('button', { name: 'Anular el gasto' }).click();

  // No se borra: queda anulado, con el motivo a la vista.
  const anulada = cargados(page).getByRole('listitem').filter({ hasText: FLETE });
  await expect(anulada).toContainText('Anulado', { timeout: 15_000 });
  await expect(anulada).toContainText('Se cargó dos veces');

  // Y la plata volvió.
  expect(await efectivoEsperado(page)).not.toBe(conGasto);
  await expect(page.getByText('Gastos pagados del cajón')).toHaveCount(0);
});

test('un gasto pendiente no mueve plata hasta que se paga', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  const antes = await efectivoEsperado(page);

  await page.goto('/gastos');
  await page.getByRole('button', { name: '+ Cargar un gasto' }).click();

  const alta = page.getByRole('form', { name: 'Cargar un gasto' });
  await alta.getByLabel('¿En qué se gastó?').fill(ALQUILER);
  await alta.getByLabel('Cuánto').fill('300000');
  await alta.getByLabel('Categoría').selectOption({ label: 'Alquiler' });
  await alta.getByRole('radio', { name: 'Todavía no' }).check();
  await alta.getByRole('button', { name: 'Guardar el gasto' }).click();

  const fila = cargados(page).getByRole('listitem').filter({ hasText: ALQUILER });
  await expect(fila).toContainText('Pendiente', { timeout: 15_000 });

  // Aparece en «falta pagar» y el cajón sigue igual.
  await expect(page.getByRole('region', { name: /Falta pagar/ })).toContainText(ALQUILER);
  expect(await efectivoEsperado(page)).toBe(antes);

  // Se paga por transferencia: sale del banco, no del cajón.
  await page.goto('/gastos');
  const pendiente = cargados(page).getByRole('listitem').filter({ hasText: ALQUILER });
  await pendiente.getByRole('button', { name: 'Marcar como pagado' }).click();
  await pendiente.getByLabel('Con qué').selectOption('transferencia');
  await pendiente.getByLabel('De qué cuenta').selectOption({ label: 'Banco' });
  await pendiente.getByRole('button', { name: /^Pagar/ }).click();

  await expect(
    cargados(page).getByRole('listitem').filter({ hasText: ALQUILER }),
  ).not.toContainText('Pendiente', { timeout: 15_000 });
  expect(await efectivoEsperado(page)).toBe(antes);
});

test('el resumen del mes agrupa por categoría', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/gastos');

  // Adentro del bloque: «Alquiler» también es una opción del filtro.
  const porCategoria = page.getByRole('region', { name: 'Gastos por categoría' });
  await expect(porCategoria).toBeVisible();
  await expect(porCategoria).toContainText('Alquiler');
});

test('pasar plata de la caja al banco no cambia el total del negocio', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  await page.goto('/cuentas');
  const totalAntes = await page.getByText('Total en todas las cuentas').locator('..').innerText();

  await page.getByRole('button', { name: 'Pasar plata de una cuenta a otra' }).click();
  const transfe = page.getByRole('form', { name: 'Pasar plata entre cuentas' });
  await transfe.getByLabel('De qué cuenta').selectOption({ label: 'Caja en efectivo' });
  await transfe.getByLabel('A qué cuenta').selectOption({ label: 'Banco' });
  await transfe.getByLabel('Cuánto').fill('10000');
  await transfe.getByLabel('Nota (opcional)').fill('Depósito de la recaudación');
  await transfe.getByRole('button', { name: 'Pasar la plata' }).click();

  // El movimiento queda en el extracto de la caja…
  await expect(page.getByText('Depósito de la recaudación').first()).toBeVisible({
    timeout: 15_000,
  });

  // …el total no se movió, porque la plata no salió del negocio…
  const totalDespues = await page.getByText('Total en todas las cuentas').locator('..').innerText();
  expect(totalDespues).toBe(totalAntes);

  // …y nunca hay descuadres entre el saldo y los movimientos.
  await expect(page.getByText(/despegado de sus movimientos/)).toHaveCount(0);
});

test('no se puede transferir más de lo que hay', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/cuentas');

  await page.getByRole('button', { name: 'Pasar plata de una cuenta a otra' }).click();
  const transfe = page.getByRole('form', { name: 'Pasar plata entre cuentas' });
  await transfe.getByLabel('De qué cuenta').selectOption({ label: 'Banco' });
  await transfe.getByLabel('A qué cuenta').selectOption({ label: 'Caja en efectivo' });
  await transfe.getByLabel('Cuánto').fill('99999999');
  await transfe.getByRole('button', { name: 'Pasar la plata' }).click();

  await expect(transfe.getByRole('alert')).toContainText('no alcanza');
});

test('el vendedor no ve los gastos ni las cuentas', async ({ page }) => {
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Vendedor' }).click();
  await page.getByRole('radio', { name: 'Vendedor de mostrador' }).check();
  await page.getByLabel('PIN').fill(PIN);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();

  const navegacion = page.getByRole('navigation', { name: 'Secciones' });
  await expect(navegacion.getByText('Gastos')).toHaveCount(0);
  await expect(navegacion.getByText('Cuentas')).toHaveCount(0);

  // Y si entra por la URL, lo saca.
  for (const ruta of ['/gastos', '/cuentas']) {
    await page.goto(ruta);
    await expect(page).toHaveURL(/\/$/);
  }
});
