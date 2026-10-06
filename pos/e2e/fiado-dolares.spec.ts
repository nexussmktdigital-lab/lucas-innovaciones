import { expect, test, type Page } from '@playwright/test';

/**
 * El iPhone fiado en dólares, de punta a punta (D62).
 *
 * Es el recorrido entero del cambio: se vende un teléfono cotizado en dólares,
 * se fía el saldo, se pacta en cuotas y después se cobra. Lo que este archivo
 * protege es que **la deuda en dólares se vea y se pueda cobrar**: el dominio ya
 * la guardaba bien mientras la pantalla de Fiado la dejaba afuera, porque
 * filtraba por el saldo en pesos —que en esta venta es cero—.
 *
 * Necesita la base migrada y sembrada:
 *   npm run db:migrate && npm run db:seed -- --reset
 */

const EMAIL = 'lucas@lucasinnovaciones.com.ar';
const PASSWORD = process.env.SEED_PASSWORD_DUENIO ?? 'lucas-desarrollo-2026';

test.describe.configure({ mode: 'serial' });

/**
 * El cliente lleva un sufijo por corrida: la base no se vacía entre corridas y
 * un teléfono repetido es, con razón, un error de carga.
 */
const SUFIJO = Date.now().toString().slice(-5);
const CLIENTE = `Nahuel del iPhone ${SUFIJO}`;

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

test('se carga el cliente que va a comprar el iPhone', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/clientes');
  await page.getByRole('button', { name: '+ Cliente nuevo' }).click();
  await page.getByLabel('Nombre y apellido').fill(CLIENTE);
  await page.getByLabel('Teléfono').fill(`3573 5${SUFIJO}`);
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByText(new RegExp(`«${CLIENTE}» quedó cargado`))).toBeVisible();
});

test('un iPhone fiado en cuotas se pacta en dólares', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/vender');

  const buscador = page.getByPlaceholder('Buscar por nombre');
  await buscador.fill('iPhone 13');
  await page
    .getByRole('button', { name: /iPhone 13/ })
    .first()
    .waitFor();
  await buscador.press('Enter');

  const opciones = await page.locator('#cliente option').allTextContents();
  const i = opciones.findIndex((t) => t.includes(CLIENTE));
  expect(i).toBeGreaterThan(-1);
  await page.locator('#cliente').selectOption({ index: i });

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Cuenta corriente' }).click();

  // Lo que el vendedor le dice al cliente tiene que ser lo que el sistema va a
  // guardar: la deuda es en dólares porque así se vendió.
  const aviso = cobro.getByText(/Le vas a fiar/);
  await expect(aviso).toContainText('US$');
  await expect(aviso).toContainText('en dólares, como se vendió');

  // Y las cuotas que se pactan en el momento, también en dólares: es el número
  // que va al comprobante que el cliente firma.
  await cobro.getByRole('button', { name: 'Cada mes' }).click();
  await cobro.getByRole('button', { name: '3', exact: true }).click();
  await expect(cobro.getByText(/3 cuotas de US\$/)).toBeVisible();

  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });
});

test('la deuda en dólares se ve en Fiado, aunque no deba un peso', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/fiado');

  const tarjeta = page.getByRole('listitem').filter({ hasText: CLIENTE });
  await expect(tarjeta).toContainText('US$');
  // Su cuota también, con el signo que corresponde. Es la deuda que antes no
  // aparecía: su saldo en pesos es cero.
  await expect(tarjeta).toContainText(/Cuota 1 de 3 · US\$/);

  // Y el total por cobrar del encabezado la cuenta.
  await expect(page.getByText('Por cobrar')).toBeVisible();
  await expect(page.locator('p.cifra').filter({ hasText: 'US$' }).first()).toBeVisible();
});

test('se cobra una cuota en billetes de dólar', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/fiado');

  const tarjeta = page.getByRole('listitem').filter({ hasText: CLIENTE });
  await tarjeta.getByRole('button', { name: 'Recibir un pago' }).click();

  // El cliente debe solo dólares, así que no hay nada que preguntar: la pantalla
  // no muestra el selector de deuda y cobra en la moneda que corresponde.
  await expect(tarjeta.getByText('¿Qué deuda paga?')).toBeHidden();
  await expect(tarjeta.getByText(/¿Cuánto paga\?\s*En dólares/)).toBeVisible();

  await tarjeta.getByLabel('Con qué').selectOption('dolares');
  await tarjeta.getByLabel(/¿Cuánto paga\?/).fill('50');
  await tarjeta.getByRole('button', { name: 'Registrar el pago' }).click();

  // Cobrado en dólares, y sin ninguna conversión de por medio: pagar dólares
  // contra una deuda en dólares no toca la cotización.
  await expect(page.getByText(/Cobrado US\$\s?50,00/)).toBeVisible();
  await expect(page.getByText(/Entraron/)).toBeHidden();

  // Y los billetes están en el cajón de dólares, escritos como dólares: su saldo
  // está en centavos de dólar y con signo de peso el total del negocio mentía.
  await page.goto('/cuentas');
  const cajon = page.getByRole('link').filter({ hasText: 'Caja en dólares' });
  await expect(cajon).toContainText('US$');

  // El total de abajo es el de las cuentas en pesos: los dólares van aparte.
  await expect(page.getByText('Total en las cuentas en pesos')).toBeVisible();
  await expect(page.getByText('Y en dólares, aparte')).toBeVisible();
});
