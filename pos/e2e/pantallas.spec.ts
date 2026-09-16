import { expect, test, type Page } from '@playwright/test';

/**
 * Que todas las pantallas carguen. Nada más, y por eso vale.
 *
 * El resto de la batería entra a las pantallas que necesita para probar algo, y
 * eso deja huecos: una pantalla que nadie usa en ningún test puede devolver
 * error durante semanas sin que se note. Pasó de verdad —Reportes y el alta de
 * productos devolvían 500 en la demo— y lo encontró un recorrido a mano, no la
 * batería.
 *
 * Esto es ese recorrido, escrito. Solo comprueba que la respuesta sea 200 y que
 * no haya quedado la pantalla de error: lo que cada pantalla hace bien lo
 * prueban los otros archivos.
 */

const EMAIL = 'lucas@lucasinnovaciones.com.ar';
const PASSWORD = process.env.SEED_PASSWORD_DUENIO ?? 'lucas-desarrollo-2026';
const PIN = process.env.SEED_PIN_VENDEDOR ?? '4827';

/** Todas las del dueño, que es quien las ve todas. */
const DEL_DUENIO = [
  '/',
  '/vender',
  '/caja',
  '/ventas',
  '/fiado',
  '/clientes',
  '/gastos',
  '/cuentas',
  '/catalogo',
  '/catalogo/nuevo',
  '/catalogo/importar',
  '/precios',
  '/cotizacion',
  '/mensajes',
  '/reportes',
  '/devoluciones',
  '/sincronizacion',
];

/** Las que el vendedor sí puede abrir: el resto lo cubre `calidad.spec.ts`. */
const DEL_VENDEDOR = ['/', '/vender', '/caja', '/ventas', '/fiado', '/clientes'];

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

/** Abre la ruta y falla si el servidor devolvió error o si saltó la pantalla de error. */
async function abrir(page: Page, ruta: string) {
  const respuesta = await page.goto(ruta, { waitUntil: 'networkidle' });

  expect(respuesta?.status(), `${ruta} devolvió ${respuesta?.status()}`).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Esta pantalla no cargó' }),
    `${ruta} mostró la pantalla de error`,
  ).toBeHidden();
}

test.describe('todas las pantallas del dueño cargan', () => {
  test('una tras otra, sin que ninguna devuelva error', async ({ page }) => {
    await entrarComoDuenio(page);
    for (const ruta of DEL_DUENIO) await abrir(page, ruta);
  });
});

test.describe('y las del vendedor también', () => {
  test('con la caja abierta o cerrada, las suyas abren', async ({ page }) => {
    await entrarComoVendedor(page);
    for (const ruta of DEL_VENDEDOR) await abrir(page, ruta);
  });
});
