import { expect, test, type Page } from '@playwright/test';
import { elegirVendedor } from './ayudas';

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

  await expect(page.getByRole('heading', { name: 'Catálogo', exact: true })).toBeVisible();
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

test('al vendedor lo frena, le explica, y lo deja cobrar a sabiendas', async ({
  page,
  context,
}) => {
  /*
   * El mismo iPhone, pero desde el mostrador. Antes el vendedor quedaba trabado
   * del todo: no podía cobrar NADA de ese carrito con el cliente enfrente, y
   * destrabarlo era ir a buscar al dueño. El cartel sigue estando —hay que
   * leerlo y decidir— pero la salida ahora existe, y la venta termina en su
   * comprobante como cualquier otra.
   */
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Vendedor' }).click();
  await page.getByLabel('PIN').fill(PIN);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();

  // La ventana del comprobante se manda a imprimir sola; acá se la deja pasar.
  await context.addInitScript(() => {
    window.print = () => {};
  });

  await page.goto('/vender');
  const buscador = page.getByPlaceholder('Buscar por nombre');
  await buscador.fill('iPhone 15 Pro Max');
  await page.getByRole('button', { name: /iPhone 15 Pro Max/ }).first().waitFor();
  await buscador.press('Enter');

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();

  // Primero el aviso, que no desapareció: dice qué tiene mal la ficha.
  await expect(cobro.getByText('Frená: revisá el precio antes de cobrar')).toBeVisible();
  await expect(cobro.getByText(/cifra en dólares/)).toBeVisible();

  // Y la salida, que antes no tenía.
  await cobro.getByRole('button', { name: /cobrar igual/ }).click();
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });

  // La venta existe y tiene su comprobante, como cualquier otra.
  await page.goto('/ventas');
  await expect(page.getByRole('listitem').first()).toContainText('iPhone 15 Pro Max');
  await expect(
    page.getByRole('listitem').first().getByRole('link', { name: /Ver e imprimir/ }),
  ).toBeVisible();
});

test('el vendedor ve las pantallas del mostrador, y solo Reportes le queda afuera', async ({
  page,
}) => {
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Vendedor' }).click();
  await elegirVendedor(page, 'Vendedor de mostrador');
  await page.getByLabel('PIN').fill(PIN);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();

  // Cargar mercadería que acaba de llegar y corregir un precio viejo es
  // atender: si hay que esperar al dueño, se anota en un papel.
  for (const ruta of ['/catalogo', '/precios', '/cotizacion', '/sincronizacion']) {
    await page.goto(ruta);
    await expect(page).not.toHaveURL(/\/$/);
  }

  // El balance del mes sí es del dueño, y por la URL tampoco entra.
  await page.goto('/reportes');
  await expect(page).toHaveURL(/\/$/);
});

test('el dueño ve lo que quedó sin configurar, y el vendedor no', async ({ page }) => {
  // Los tests corren sin credenciales de Woo, así que el panel tiene que estar.
  await entrarComoDuenio(page);
  const panel = page.getByRole('region', { name: /Avisos de configuración|Falta configurar/ });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('WOO_URL');
  // Dice qué hacer, no solo que algo falta.
  await expect(panel).toContainText('→');

  // Al vendedor no le sirve de nada y no es asunto suyo.
  await page.goto('/ingresar');
  await page.getByRole('tab', { name: 'Vendedor' }).click();
  await elegirVendedor(page, 'Vendedor de mostrador');
  await page.getByLabel('PIN').fill(PIN);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: /Avisos de configuración|Falta configurar/ }),
  ).toHaveCount(0);
});

test('la cola de WooCommerce se puede ver y destrabar', async ({ page }) => {
  // El contador «N sin sincronizar» no servía de nada si no había forma de
  // hacer algo con ese número.
  await entrarComoDuenio(page);
  await page.goto('/sincronizacion');

  await expect(page.getByRole('heading', { name: /Sincronización con la tienda/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sincronizar ahora' })).toBeVisible();

  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  // Sin credenciales de Woo en los tests, tiene que decirlo en vez de callarse.
  await expect(page.getByText(/WooCommerce no responde|No había nada esperando/)).toBeVisible();
});

test('la ruta del cron no se abre sin el secreto', async ({ request }) => {
  const sin = await request.get('/api/cron/sincronizar');
  expect([401, 503]).toContain(sin.status());

  const conUnoInventado = await request.get('/api/cron/sincronizar', {
    headers: { authorization: 'Bearer no-es-este' },
  });
  expect([401, 503]).toContain(conUnoInventado.status());
});
