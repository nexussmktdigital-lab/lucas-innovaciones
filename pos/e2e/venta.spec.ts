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

/** Lee un importe en pesos de la pantalla y lo devuelve en centavos. */
function aCentavosDeTexto(texto: string): number {
  const m = texto.match(/\$\s*([\d.]+),(\d{2})/);
  if (!m) throw new Error(`No encontré un importe en: ${texto}`);
  return Number(m[1]!.replace(/\./g, '')) * 100 + Number(m[2]);
}

async function efectivoEsperado(page: Page): Promise<number> {
  const bloque = page.getByText('Efectivo esperado').locator('..');
  return aCentavosDeTexto(await bloque.innerText());
}

async function precioDelCarrito(page: Page): Promise<number> {
  const totales = page.getByRole('complementary', { name: 'Carrito' }).locator('dl');
  return aCentavosDeTexto((await totales.innerText()).split('Total')[1] ?? '');
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

test('no se puede fiar hasta que exista el módulo de fiado', async ({ page }) => {
  // El dominio soporta la cuenta corriente, pero la deuda del cliente recién
  // se guarda en la fase 5. Ofrecerla antes era fiar y no acordarse de nadie.
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/vender');

  await agregar(page, 'vidrio templado', /Vidrio templado/);
  await page.getByRole('button', { name: /^Cobrar/ }).click();

  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await expect(cobro.getByRole('button', { name: '+ Efectivo' })).toBeVisible();
  await expect(cobro.getByRole('button', { name: '+ Cuenta corriente' })).toHaveCount(0);
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

test('una variación se cobra a su precio, no al del producto padre', async ({ page }) => {
  // La pantalla decía $550.000 y quedaba una venta de $410.000, con $140.000
  // de vuelto que nadie dio.
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/vender');

  await agregar(page, 'A17-256', /256GB/);

  const carrito = page.getByRole('complementary', { name: 'Carrito' });
  await expect(carrito).toContainText('Samsung Galaxy A17 128GB — 256GB');
  await expect(carrito).toContainText('550.000');

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await expect(cobro).toContainText('550.000');

  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });

  await page.goto('/ventas');
  const fila = page.getByRole('listitem').filter({ hasText: '256GB' }).first();
  await expect(fila).toContainText('$ 550.000,00');
});

test('dos billetes en efectivo no descuadran la caja', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  const antes = await efectivoEsperado(page);

  await page.goto('/vender');
  await agregar(page, 'vidrio templado', /Vidrio templado/);
  const total = await precioDelCarrito(page);

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByLabel('Monto en Efectivo').first().fill('3000');
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByLabel('Monto en Efectivo').nth(1).fill('10000');

  await expect(cobro.getByText('Vuelto')).toBeVisible();
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
  // Hay que esperar a que la venta entre: irse antes cancela la acción.
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });

  await page.goto('/caja');
  // La caja sube exactamente lo que se vendió, ni un peso menos.
  expect(await efectivoEsperado(page)).toBe(antes + total);
});

test('quitar un pago no deja la pantalla mostrando otro número', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/vender');
  await agregar(page, 'vidrio templado', /Vidrio templado/);

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });

  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByLabel('Monto en Efectivo').first().fill('3000');
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByLabel('Monto en Efectivo').nth(1).fill('10000');

  await cobro.getByLabel('Quitar el pago en Efectivo').first().click();

  await expect(cobro.getByLabel('Monto en Efectivo')).toHaveValue('10000');
  await expect(cobro).toContainText('$ 10.000,00');
});

test('el dueño anula una venta del turno y todo vuelve atrás', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/vender');
  await agregar(page, 'vidrio templado', /Vidrio templado/);

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });

  await page.goto('/ventas');
  const primera = page.getByRole('listitem').first();
  await expect(primera.getByRole('link', { name: /Ver e imprimir/ })).toBeVisible();

  await primera.getByRole('button', { name: 'Anular' }).click();
  await primera.getByLabel(/Por qué se anula/).fill('Prueba de punta a punta');
  await primera.getByRole('button', { name: /Anular la venta/ }).click();

  // La lista se refresca sola: la fila pasa a «Anulada» y muestra el motivo.
  await expect(page.getByRole('listitem').first()).toContainText('Anulada');
  await expect(page.getByRole('listitem').first()).toContainText('Prueba de punta a punta');

  await page.reload();
  await expect(page.getByRole('listitem').first()).toContainText('Anulada');
  // Y el comprobante se sigue pudiendo imprimir: no se borró nada.
  await expect(
    page.getByRole('listitem').first().getByRole('link', { name: /Ver e imprimir/ }),
  ).toBeVisible();
});

test('el vendedor no puede anular, pero sí escribe el precio de un servicio', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  await page.goto('/ingresar');
  await page.getByLabel('PIN').fill(process.env.SEED_PIN_VENDEDOR ?? '4827');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();

  await page.goto('/ventas');
  await expect(page.getByRole('button', { name: 'Anular' })).toHaveCount(0);

  // El precio del servicio sí lo escribe: cada reparación es distinta. Lo que
  // no puede es alejarlo del de referencia sin que lo confirme el dueño.
  await page.goto('/vender');
  await agregar(page, 'Limpieza de virus', /Limpieza de virus/);
  const carrito = page.getByRole('complementary', { name: 'Carrito' });
  await expect(carrito.getByLabel(/^Precio de/)).toHaveValue('7050');

  await carrito.getByLabel(/^Precio de/).fill('6000');
  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await expect(cobro).toContainText('6.000,00');
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });
});

test('el vendedor no puede regalar un servicio, y el dueño sí a sabiendas', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  await page.goto('/ingresar');
  await page.getByLabel('PIN').fill(process.env.SEED_PIN_VENDEDOR ?? '4827');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();

  await page.goto('/vender');
  await agregar(page, 'Limpieza de virus', /Limpieza de virus/);
  const carrito = page.getByRole('complementary', { name: 'Carrito' });
  await carrito.getByLabel(/^Precio de/).fill('1');

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();

  // Al vendedor se le avisa y no se le ofrece salida.
  await expect(cobro.getByText(/En el catálogo figura a/)).toBeVisible();
  await expect(cobro.getByRole('button', { name: /cobrar igual/ })).toHaveCount(0);
});
