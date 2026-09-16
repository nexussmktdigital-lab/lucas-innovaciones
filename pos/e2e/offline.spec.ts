import { expect, test, type Page } from '@playwright/test';

/**
 * Vender sin conexión, de punta a punta (v1.1, D56).
 *
 * Es el único test que prueba lo que la v1.1 existe para resolver: se corta
 * internet en el medio del día, se sigue vendiendo, y la plata entra sola
 * cuando vuelve. Nada de eso se puede probar con tests de unidad —el catálogo
 * guardado vive en IndexedDB, la página la sirve un service worker y la cola se
 * drena desde el navegador—, así que esta es la única prueba que existe de que
 * anda.
 *
 * Necesita la base migrada y sembrada, y el servidor levantado desde un build
 * de producción: en desarrollo el service worker no se registra a propósito.
 *   npm run db:seed -- --reset && npm run build && npm run test:e2e
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

async function efectivoEsperado(page: Page): Promise<number> {
  return aCentavosDeTexto(await page.getByText('Efectivo esperado').locator('..').innerText());
}

/**
 * Deja la pantalla de venta lista para quedarse sin internet.
 *
 * Dos cosas tienen que haber pasado antes de cortar: el service worker tiene
 * que estar controlando la pestaña —si no, la próxima navegación sin red no
 * devuelve nada— y el catálogo tiene que estar bajado. Lo primero necesita un
 * recargo: un worker recién instalado reclama la pestaña, pero la carga que lo
 * instaló ya salió sin él.
 */
async function prepararParaVenderSinConexion(page: Page) {
  await page.goto('/vender');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  const bajada = page.waitForResponse((r) => r.url().includes('/api/catalogo/instantanea'));
  await page.reload();
  await bajada;

  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: 20_000,
  });
}

/** Vende un vidrio al contado con lo que haya en pantalla. */
async function venderUnVidrio(page: Page) {
  const buscador = page.getByPlaceholder('Buscar por nombre');
  await buscador.fill('vidrio templado');
  await page.getByRole('button', { name: /Vidrio templado/ }).first().waitFor();
  await buscador.press('Enter');

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByLabel('Monto en Efectivo').fill('5000');
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
}

let esperadoAntes = 0;

test('se corta internet, se sigue vendiendo y la venta entra sola al volver', async ({
  page,
  context,
}) => {
  // El comprobante se manda a imprimir solo, también el provisorio. En el test
  // se anula en toda ventana del contexto, incluida la del ticket.
  await context.addInitScript(() => {
    window.print = () => {};
  });

  await entrarComoDuenio(page);
  await abrirCaja(page, '50000');
  esperadoAntes = await efectivoEsperado(page);

  await prepararParaVenderSinConexion(page);

  /* ---------------------------------------------------------------------- */
  /* Se corta                                                               */
  /* ---------------------------------------------------------------------- */

  await context.setOffline(true);
  await expect(page.getByText('Sin conexión. Se puede vender igual.')).toBeVisible({
    timeout: 20_000,
  });

  // El buscador sigue encontrando, ahora contra lo guardado.
  const buscador = page.getByPlaceholder('Buscar por nombre');
  await buscador.fill('vidrio templado');
  await page.getByRole('button', { name: /Vidrio templado/ }).first().waitFor();
  await buscador.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Carrito' })).toContainText('1 unidad');
  await buscador.fill('');

  // Y se cobra igual.
  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByLabel('Monto en Efectivo').fill('5000');
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();

  // El carrito se vacía —la venta se cobró— y queda anotada esperando.
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('1 venta cobrada espera para entrar.')).toBeVisible({
    timeout: 15_000,
  });

  /* ---------------------------------------------------------------------- */
  /* Vuelve                                                                 */
  /* ---------------------------------------------------------------------- */

  await context.setOffline(false);

  // Sin tocar nada: la cola se sube sola.
  await expect(page.getByText(/venta[s]? cobrada[s]? esperan? para entrar/)).toBeHidden({
    timeout: 45_000,
  });
});

test('la venta que entró queda marcada y con la hora en que se cobró', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/ventas');

  const venta = page.locator('li').filter({ hasText: 'Cobrada sin conexión' }).first();
  await expect(venta).toBeVisible();
  await expect(venta).toContainText('Vidrio templado');
  await expect(venta).toContainText('5.000,00');
});

test('la plata de esa venta está en el cajón', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/caja');

  expect(await efectivoEsperado(page)).toBe(esperadoAntes + 5_000_00);

  // Y el arqueo dice de dónde salió ese número, en vez de dejarlo sin explicar.
  await expect(page.getByText('De eso, cobrado sin conexión')).toBeVisible();
});

/*
 * El turno no se cierra con plata cobrada que el sistema todavía no tiene: el
 * efectivo esperado estaría mal justamente en eso, y quien cuenta tendría que
 * inventar una justificación por una diferencia que no es suya.
 */
test('no se puede cerrar el turno con una venta esperando', async ({ page, context }) => {
  await context.addInitScript(() => {
    window.print = () => {};
  });

  await entrarComoDuenio(page);
  await prepararParaVenderSinConexion(page);

  // Se pasa por la caja con conexión: es la pantalla a la que se va a volver
  // sin ella, y el service worker solo puede servir lo que alguna vez guardó.
  await page.goto('/caja');
  await expect(page.getByText('Turno abierto')).toBeVisible();
  await prepararParaVenderSinConexion(page);

  await context.setOffline(true);
  await expect(page.getByText('Sin conexión. Se puede vender igual.')).toBeVisible({
    timeout: 20_000,
  });

  await venderUnVidrio(page);
  await expect(page.getByText('1 venta cobrada espera para entrar.')).toBeVisible({
    timeout: 15_000,
  });

  // La página de caja la sirve el service worker desde lo guardado, y el aviso
  // lo arma el navegador leyendo su propia cola.
  await page.goto('/caja');
  await expect(page.getByText(/No se puede cerrar el turno/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Cerrar el turno' })).toBeHidden();

  // Y al volver la conexión, la cola se vacía y el cierre se destraba.
  await context.setOffline(false);
  await page.goto('/vender');
  await expect(page.getByText(/venta[s]? cobrada[s]? esperan? para entrar/)).toBeHidden({
    timeout: 45_000,
  });

  await page.goto('/caja');
  await expect(page.getByRole('button', { name: 'Cerrar el turno' })).toBeVisible();
});
