import { expect, test, type Page } from '@playwright/test';

/**
 * Devoluciones de turnos cerrados, de punta a punta.
 *
 * Necesita la base migrada y sembrada:
 *   npm run db:migrate && npm run db:seed -- --reset
 *
 * El recorrido es el de verdad: se vende, se cierra el turno, se abre otro y
 * recién ahí vuelve el cliente. Lo que se comprueba es que la plata salga del
 * cajón de hoy, que el arqueo lo explique, y que no se pueda devolver dos veces
 * lo mismo.
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

async function entrarComoVendedor(page: Page) {
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Vendedor' }).click();
  await page.getByLabel('PIN').fill(PIN);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();
}

/** Lee un importe de la pantalla y lo devuelve en centavos. */
function aCentavosDeTexto(texto: string): number {
  const m = texto.match(/-?\$\s*([\d.]+),(\d{2})/);
  if (!m) throw new Error(`No encontré un importe en: ${texto}`);
  const valor = Number(m[1]!.replace(/\./g, '')) * 100 + Number(m[2]);
  return texto.trimStart().startsWith('-') ? -valor : valor;
}

async function abrirCaja(page: Page, monto: string) {
  await page.goto('/caja');
  if (
    await page
      .getByRole('button', { name: 'Abrir caja' })
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByLabel('Efectivo inicial').fill(monto);
    await page.getByRole('button', { name: 'Abrir caja' }).click();
  }
  await expect(page.getByText('Turno abierto')).toBeVisible();
}

/** Cierra el turno escribiendo lo que el sistema espera, para no descuadrar. */
async function cerrarCaja(page: Page) {
  await page.goto('/caja');
  if (!(await page.getByText('Turno abierto').isVisible().catch(() => false))) return;

  const esperado = aCentavosDeTexto(
    await page.getByText('Efectivo esperado').locator('..').innerText(),
  );

  await page.getByRole('button', { name: 'Cerrar el turno' }).click();
  const form = page.getByRole('form', { name: 'Cerrar el turno' });
  await form.getByRole('button', { name: 'Prefiero escribir el total' }).click();
  await form.getByLabel('Efectivo contado').fill(String(esperado / 100));
  await form.getByRole('button', { name: 'Cerrar caja' }).click();

  await expect(page.getByRole('button', { name: 'Imprimir' })).toBeVisible({ timeout: 15_000 });
}

/** Vende dos vidrios al contado y devuelve el número de la venta. */
async function venderDosVidrios(page: Page): Promise<string> {
  await page.goto('/vender');
  const buscador = page.getByPlaceholder('Buscar por nombre');

  await buscador.fill('vidrio templado');
  await page.getByRole('button', { name: /Vidrio templado/ }).first().waitFor();
  await buscador.press('Enter');

  // La segunda unidad se suma en el carrito, no buscando de nuevo: el buscador
  // se limpia al agregar y un segundo Enter no agrega nada.
  const carrito = page.getByRole('complementary', { name: 'Carrito' });
  await expect(carrito).toContainText('1 unidad');
  await carrito.getByRole('button', { name: 'Uno más' }).click();
  await expect(carrito).toContainText('2 unidades');

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByLabel('Monto en Efectivo').fill('10000');

  await page.addInitScript(() => {
    window.print = () => {};
  });
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });

  await page.goto('/ventas');
  const primera = page.locator('li').filter({ hasText: /T1-\d{6}/ }).first();
  const texto = await primera.innerText();
  return texto.match(/T1-\d{6}/)![0];
}

let numeroDeVenta = '';

test('se vende, se cierra el turno y al otro día se devuelve', async ({ page }) => {
  await entrarComoDuenio(page);
  await abrirCaja(page, '50000');

  numeroDeVenta = await venderDosVidrios(page);
  expect(numeroDeVenta).toMatch(/^T1-\d{6}$/);

  // Se cierra el turno: a partir de acá la venta ya no se puede anular.
  await cerrarCaja(page);

  // Y el turno de hoy arranca limpio.
  await abrirCaja(page, '80000');

  const antes = aCentavosDeTexto(
    await page.getByText('Efectivo esperado').locator('..').innerText(),
  );

  await page.goto('/devoluciones');
  await page.getByLabel('De qué venta').fill(numeroDeVenta);
  await page.getByRole('button', { name: new RegExp(numeroDeVenta) }).click();

  const form = page.getByRole('form', { name: 'Registrar una devolución' });
  await expect(form).toBeVisible();

  // Vuelve uno de los dos.
  await form.getByLabel('Cuántos vuelven').fill('1');
  await expect(form.getByText('Lo que se devuelve vale').locator('..')).toContainText('5.000,00');

  await form.getByLabel('Por qué se devuelve').fill('El vidrio vino rayado');
  await form.getByRole('button', { name: /Registrar la devolución/ }).click();

  await expect(page.getByText(/Devolución DEV-T1-\d{6} registrada/)).toBeVisible({
    timeout: 15_000,
  });

  // La plata salió del cajón de hoy.
  await page.goto('/caja');
  const despues = aCentavosDeTexto(
    await page.getByText('Efectivo esperado').locator('..').innerText(),
  );
  expect(despues).toBe(antes - 5_000_00);
});

/*
 * Que el efectivo baje no alcanza: si nada lo explica, al cerrar el turno falta
 * plata sin motivo y quien cuenta tiene que inventar una justificación.
 */
test('el arqueo dice por qué falta esa plata', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/caja');

  const desglose = page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: 'Plata que entró, por medio' }) })
    .last();

  await expect(desglose).toContainText('Devuelto por ventas de otros turnos');
  await expect(desglose).toContainText('5.000,00');
});

test('no se puede devolver dos veces lo mismo', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/devoluciones');
  await page.getByLabel('De qué venta').fill(numeroDeVenta);
  await page.getByRole('button', { name: new RegExp(numeroDeVenta) }).click();

  const form = page.getByRole('form', { name: 'Registrar una devolución' });

  // Del renglón de dos unidades ya volvió una: queda una sola.
  await expect(form).toContainText('1 de 2');

  await form.getByLabel('Cuántos vuelven').fill('1');
  await form.getByLabel('Por qué se devuelve').fill('El otro también');
  await form.getByRole('button', { name: /Registrar la devolución/ }).click();
  await expect(page.getByText(/registrada/)).toBeVisible({ timeout: 15_000 });

  // Y ahora ya no queda nada.
  await page.goto(page.url().replace(/\/devoluciones.*/, '/devoluciones'));
  await page.getByLabel('De qué venta').fill(numeroDeVenta);
  await page.getByRole('button', { name: new RegExp(numeroDeVenta) }).click();
  await expect(page.getByText('De esta venta ya se devolvió todo.')).toBeVisible();
});

test('las devoluciones quedan listadas con su motivo', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/devoluciones');

  const lista = page.getByRole('region', { name: 'Devoluciones hechas' });
  await expect(lista).toContainText('El vidrio vino rayado');
  await expect(lista).toContainText(numeroDeVenta);
  await expect(lista.getByText(/DEV-T1-\d{6}/).first()).toBeVisible();
});

test('el reporte del turno también lo explica', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/caja');
  await page.getByRole('link', { name: 'Ver el reporte del turno' }).click();

  const arqueo = page.getByRole('region', { name: 'El arqueo' });
  await expect(arqueo).toContainText('Devuelto por ventas de otros turnos');
});

test('el vendedor no devuelve', async ({ page }) => {
  // Devolver plata de una venta de otro turno es una decisión sobre el cajón de
  // hoy, no una corrección de carga.
  await entrarComoVendedor(page);
  await page.goto('/devoluciones');
  await expect(page).toHaveURL(/\/$/);
});
