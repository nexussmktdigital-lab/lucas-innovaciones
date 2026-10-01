import { expect, test, type Page } from '@playwright/test';

/**
 * Alta de productos e importación masiva, de punta a punta.
 *
 * Necesita la base migrada y sembrada:
 *   npm run db:migrate && npm run db:seed -- --reset
 *
 * Lo que se comprueba es lo único que importa de esta fase: que el producto que
 * falta se pueda cargar y vender en la misma visita, sin pasar por WooCommerce
 * y sin que quien atiende tenga que salir de la venta.
 */

const EMAIL = 'lucas@lucasinnovaciones.com.ar';
const PASSWORD = process.env.SEED_PASSWORD_DUENIO ?? 'lucas-desarrollo-2026';
const PIN = process.env.SEED_PIN_VENDEDOR ?? '4827';

test.describe.configure({ mode: 'serial' });

/** La base no se vacía entre corridas: cada una usa sus propios nombres. */
const SUF = Date.now().toString().slice(-6);
const CABLE = `Cable tipo C reforzado ${SUF}`;
const SERVICIO = `Cambio de pantalla ${SUF}`;

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

function formularioAlta(page: Page) {
  return page.getByRole('form', { name: 'Cargar un producto' });
}

test('el producto que falta se carga desde la venta y se vende enseguida', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/vender');

  // Alguien pide algo que no está en el catálogo.
  await page.getByPlaceholder('Buscar por nombre').fill(CABLE);
  await expect(page.getByText(/No hay nada que coincida/)).toBeVisible();

  // Y desde ahí mismo se carga, con lo que ya se había escrito puesto.
  await page.getByRole('link', { name: new RegExp(`Cargar «${CABLE}»`) }).click();

  const form = formularioAlta(page);
  await expect(form.getByLabel('Qué es')).toHaveValue(CABLE);

  await form.getByLabel('Cuánto sale en el local').fill('14000');
  await form.getByLabel('Cuántos hay').fill('6');
  await form.getByLabel('Categoría').fill('Cables de carga');
  await form.getByLabel('Marca').fill('FoxBox');
  await form.getByRole('button', { name: /Cargar y poder venderlo/ }).click();

  await expect(page.getByText(/quedó cargado y se puede vender/)).toBeVisible({ timeout: 15_000 });

  // El SKU sale solo, siguiendo la convención del catálogo.
  await expect(page.getByText(/^SKU CAB-FOXB-/)).toBeVisible();

  // Y ahora sí se puede vender: es la razón de ser de toda la pantalla.
  await page.getByRole('link', { name: 'Venderlo ahora' }).click();
  await page.getByPlaceholder('Buscar por nombre').fill(CABLE);

  const resultado = page.getByRole('button', { name: new RegExp(CABLE) });
  await expect(resultado).toBeVisible();
  await expect(resultado).toContainText('14.000,00');
  await expect(resultado).toContainText('6 en stock');
});

test('el vendedor también puede cargar lo que falta', async ({ page }) => {
  // Es quien está en el mostrador cuando el producto no aparece: si no pudiera,
  // la venta se traba hasta que aparezca el dueño.
  await entrarComoVendedor(page);
  await page.goto('/vender');

  await page.getByPlaceholder('Buscar por nombre').fill(SERVICIO);
  await page.getByRole('link', { name: new RegExp(`Cargar «${SERVICIO}»`) }).click();

  const form = formularioAlta(page);
  await form.getByLabel('Qué es').fill(SERVICIO);
  await form.getByLabel('Cuánto sale en el local').fill('45000');
  await form.getByLabel('Categoría').fill('Servicio técnico');
  await form.getByRole('button', { name: /Cargar y poder venderlo/ }).click();

  await expect(page.getByText(/quedó cargado y se puede vender/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^SKU SERV-/)).toBeVisible();
});

test('el mismo producto dos veces no entra: te manda a buscarlo', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/catalogo/nuevo');

  const form = formularioAlta(page);
  await form.getByLabel('Qué es').fill(CABLE);
  await form.getByLabel('Cuánto sale en el local').fill('14000');
  await form.getByRole('button', { name: /Cargar y poder venderlo/ }).click();

  await expect(page.getByText(/Ya existe un producto/)).toBeVisible({ timeout: 15_000 });
});

test('un precio con ceros de más se frena antes de guardar', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/catalogo/nuevo');

  const form = formularioAlta(page);
  await form.getByLabel('Qué es').fill(`Producto imposible ${SUF}`);
  await form.getByLabel('Cuánto sale en el local').fill('900000000');
  await form.getByRole('button', { name: /Cargar y poder venderlo/ }).click();

  await expect(page.getByText(/sobran ceros/)).toBeVisible({ timeout: 15_000 });
});

test('lo cargado en el mostrador queda listado para completar la ficha', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/catalogo');

  const pendientes = page.getByRole('region', { name: 'Fichas por completar' });
  await expect(pendientes).toContainText(CABLE);
  await expect(pendientes).toContainText('No están en la tienda online');

  // Lo que nació en el mostrador se publica a mano, no solo.
  const fila = pendientes.locator('li').filter({ hasText: CABLE });
  await expect(fila.getByRole('button', { name: 'Publicar en la tienda' })).toBeVisible();
});

test('la planilla se mira antes de guardarla', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/catalogo/importar');

  const planilla = [
    'nombre;categoria;marca;precio;stock',
    `Funda reforzada ${SUF};Fundas;;9500;10`,
    `Soporte de auto ${SUF};Accesorios varios ${SUF};;7200;4`,
    `;;;900;1`,
    `${CABLE};Cables de carga;FoxBox;14000;3`,
  ].join('\n');

  await page.getByLabel('Pegá la planilla acá').fill(planilla);
  await page.getByRole('button', { name: 'Ver qué va a pasar' }).click();

  const revision = page.getByRole('region', { name: 'Lo que haría la planilla' });
  await expect(revision).toBeVisible({ timeout: 15_000 });

  // Dos altas, un repetido (el cable de antes) y un renglón ilegible.
  await expect(revision.getByText('Se cargan').locator('..')).toContainText('2');
  await expect(revision.getByText('Ya estaban').locator('..')).toContainText('1');
  await expect(revision.getByText('No se pueden leer').locator('..')).toContainText('1');

  // Y avisa de la categoría nueva antes de crearla, no después.
  await expect(revision).toContainText(`Accesorios varios ${SUF}`);

  // Nada se guardó todavía: la revisión no escribe.
  await page.goto('/vender');
  await page.getByPlaceholder('Buscar por nombre').fill(`Funda reforzada ${SUF}`);
  await expect(page.getByText(/No hay nada que coincida/)).toBeVisible();
});

test('recién al confirmar entran los productos de la planilla', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/catalogo/importar');

  const planilla = [
    'nombre;categoria;precio;stock',
    `Funda reforzada ${SUF};Fundas;9500;10`,
    `Soporte de auto ${SUF};Accesorios;7200;4`,
  ].join('\n');

  await page.getByLabel('Pegá la planilla acá').fill(planilla);
  await page.getByRole('button', { name: 'Ver qué va a pasar' }).click();
  await page.getByRole('button', { name: /Cargar los 2/ }).click();

  // Se termina en el catálogo, que es donde sigue el trabajo.
  await expect(page.getByText('Se cargaron 2 productos')).toBeVisible({ timeout: 20_000 });

  await page.goto('/vender');
  await page.getByPlaceholder('Buscar por nombre').fill(`Soporte de auto ${SUF}`);
  const resultado = page.getByRole('button', { name: new RegExp(`Soporte de auto ${SUF}`) });
  await expect(resultado).toBeVisible();
  await expect(resultado).toContainText('7.200,00');
});

test('importar la misma planilla de nuevo no duplica nada', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/catalogo/importar');

  const planilla = [
    'nombre;categoria;precio;stock',
    `Funda reforzada ${SUF};Fundas;9500;10`,
  ].join('\n');

  await page.getByLabel('Pegá la planilla acá').fill(planilla);
  await page.getByRole('button', { name: 'Ver qué va a pasar' }).click();

  const revision = page.getByRole('region', { name: 'Lo que haría la planilla' });
  await expect(revision).toContainText('No hay nada nuevo para cargar');
});

test('el vendedor también importa planillas', async ({ page }) => {
  /*
   * Es la de mayor alcance que se le abrió: una planilla toca treinta precios
   * de una vez. Se abrió igual porque cargar mercadería que acaba de llegar es
   * atender, y de a una ficha o de a treinta es la misma tarea con distinto
   * volumen. Lo que la cuida es que la importación previsualiza antes de
   * escribir y queda en la bitácora.
   */
  await entrarComoVendedor(page);
  await page.goto('/catalogo/importar');
  await expect(page).not.toHaveURL(/\/$/);
});
