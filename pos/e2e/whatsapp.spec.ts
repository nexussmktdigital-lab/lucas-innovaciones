import { expect, test, type Page } from '@playwright/test';

/**
 * WhatsApp, de punta a punta.
 *
 * Necesita la base migrada y sembrada:
 *   npm run db:migrate && npm run db:seed -- --reset
 *
 * No se aprieta el enlace: abre wa.me, que es afuera del sistema. Lo que se
 * comprueba es lo que sí es nuestro: que el `href` lleve el número y el texto
 * correctos, que quede la constancia y que el freno de repetición pida
 * confirmación antes de volver a escribirle a la misma persona.
 */

const EMAIL = 'lucas@lucasinnovaciones.com.ar';
const PASSWORD = process.env.SEED_PASSWORD_DUENIO ?? 'lucas-desarrollo-2026';

test.describe.configure({ mode: 'serial' });

/** La base no se vacía entre corridas: cada una usa su propio cliente. */
const SUFIJO = Date.now().toString().slice(-5);
const CLIENTE = `Wanda WhatsApp ${SUFIJO}`;
const TELEFONO = `3573 6${SUFIJO}`;

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

/** El texto que lleva un enlace de wa.me, ya desescapado. */
function textoDelEnlace(href: string): string {
  return decodeURIComponent(href.split('?text=')[1] ?? '');
}

/**
 * El primer monto que aparece en un texto.
 *
 * Los importes del seed cambian con el recargo de la tienda, así que el test
 * compara el mensaje contra lo que muestra la pantalla y no contra un número
 * escrito a mano.
 */
function montoDe(texto: string): string {
  const m = texto.match(/\$[\s\u00a0]*[\d.]+,\d{2}/);
  expect(m, `no se encontró un importe en «${texto}»`).not.toBeNull();
  return m![0];
}

test('el dueño ve los textos y la vista previa se arma sola', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/mensajes');

  await expect(page.getByRole('heading', { name: 'Mensajes de WhatsApp' })).toBeVisible();
  // La vista previa muestra el mensaje con datos de ejemplo, no con las llaves.
  await expect(page.getByText('Hola Gaby! Gracias por tu compra')).toBeVisible();
});

test('un campo inventado no se guarda', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/mensajes');

  const caja = page.getByLabel('Comprobante de compra');
  await caja.fill('Hola {nombreDelPerro}');
  await page.getByRole('button', { name: 'Guardar los textos' }).click();

  await expect(page.getByText(/\{nombreDelPerro\} no es un campo/)).toBeVisible();

  // Y lo que había sigue estando: no se guardó nada a medias.
  await page.reload();
  await expect(page.getByLabel('Comprobante de compra')).toHaveValue(/Gracias por tu compra/);
});

test('el comprobante de la venta sale con el número y el total', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  // Un cliente con teléfono, para poder escribirle.
  await page.goto('/clientes');
  await page.getByRole('button', { name: '+ Cliente nuevo' }).click();
  await page.getByLabel('Nombre y apellido').fill(CLIENTE);
  await page.getByLabel('Teléfono').fill(TELEFONO);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(`«${CLIENTE}» quedó cargado`)).toBeVisible();

  // Una venta a su nombre.
  await page.goto('/vender');
  await page.getByPlaceholder('Buscar por nombre').fill('vidrio templado');
  await page
    .getByRole('button', { name: /Vidrio templado/ })
    .first()
    .waitFor();
  await page.getByPlaceholder('Buscar por nombre').press('Enter');

  const opciones = await page.locator('#cliente option').allTextContents();
  const i = opciones.findIndex((t) => t.includes(CLIENTE));
  expect(i).toBeGreaterThan(-1);
  await page.locator('#cliente').selectOption({ index: i });

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });

  // El botón está en la lista del turno, con el mensaje ya escrito.
  await page.goto('/ventas');
  const fila = page.getByRole('listitem').filter({ hasText: 'Vidrio templado' }).first();
  const enlace = fila.getByRole('link', { name: new RegExp(`WhatsApp a ${CLIENTE}`) });
  await expect(enlace).toBeVisible();

  const href = (await enlace.getAttribute('href')) ?? '';
  expect(href).toContain('https://wa.me/54935736');

  const texto = textoDelEnlace(href);
  expect(texto).toContain('Hola Wanda');
  expect(texto).toContain('Vidrio templado');
  // El total del mensaje es el de la venta, sea cual sea el precio del día.
  expect(texto).toContain(montoDe((await fila.textContent()) ?? ''));
});

test('el recordatorio de deuda avisa cuando ya se le escribió', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  // Se le fía, para que tenga deuda.
  await page.goto('/vender');
  await page.getByPlaceholder('Buscar por nombre').fill('vidrio templado');
  await page
    .getByRole('button', { name: /Vidrio templado/ })
    .first()
    .waitFor();
  await page.getByPlaceholder('Buscar por nombre').press('Enter');

  const opciones = await page.locator('#cliente option').allTextContents();
  const i = opciones.findIndex((t) => t.includes(CLIENTE));
  await page.locator('#cliente').selectOption({ index: i });

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Cuenta corriente' }).click();
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });

  await page.goto('/fiado');
  const fila = page.getByRole('listitem').filter({ hasText: CLIENTE });
  const enlace = fila.getByRole('link', { name: 'Recordarle por WhatsApp' });
  await expect(enlace).toBeVisible();

  const texto = textoDelEnlace((await enlace.getAttribute('href')) ?? '');
  expect(texto).toContain('Hola Wanda');
  // La deuda del mensaje es la que muestra la lista.
  expect(texto).toContain(montoDe((await fila.textContent()) ?? ''));

  // El clic queda anotado. La pestaña que abre va a wa.me, que es afuera del
  // sistema: se corta acá para que el test no dependa de internet.
  await page.context().route('https://wa.me/**', (ruta) => ruta.abort());
  await enlace.click();
  await expect(fila.getByText('Preparado')).toBeVisible();

  // Y a partir de acá pide confirmación antes de volver a escribirle.
  await page.goto('/fiado');
  const fila2 = page.getByRole('listitem').filter({ hasText: CLIENTE });
  await fila2.getByRole('link', { name: 'Recordarle por WhatsApp' }).click();
  await expect(fila2.getByRole('alert')).toContainText('Ya se le recordó hoy');
  await expect(fila2.getByRole('link', { name: /Sí, recordarle/ })).toBeVisible();
});

test('el mensaje preparado queda en la ficha del cliente y en la lista', async ({ page }) => {
  await entrarComoDuenio(page);

  await page.goto('/clientes');
  await page.getByRole('link', { name: CLIENTE }).click();
  await page.waitForURL(/\/clientes\//);

  await expect(page.getByRole('heading', { name: 'Mensajes preparados' })).toBeVisible();
  await expect(page.getByText('Recordatorio de deuda').first()).toBeVisible();

  await page.goto('/mensajes');
  await expect(page.getByText(CLIENTE).first()).toBeVisible();
});

test('el vendedor no entra a los textos', async ({ page }) => {
  await page.goto('/ingresar');
  await page.getByLabel('PIN').fill(process.env.SEED_PIN_VENDEDOR ?? '4827');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();

  await page.goto('/mensajes');
  await expect(page).toHaveURL(/\/$/);
});
