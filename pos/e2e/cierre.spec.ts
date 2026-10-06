import { expect, test, type Page } from '@playwright/test';

/**
 * Cierre de turno, de punta a punta.
 *
 * Necesita la base migrada y sembrada:
 *   npm run db:migrate && npm run db:seed -- --reset
 *
 * **El arqueo se sacó.** El local no cuenta los billetes, así que el cierre es
 * confirmar y listo. Lo que se comprueba ahora es que cerrar no invente un
 * arqueo que nadie hizo —contado y diferencia quedan vacíos, no en cero— y que
 * el reporte del turno siga diciendo todo lo demás: qué entró, por qué medio y
 * cuánto debería haber en el cajón.
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

/** Deja la caja cerrada, venga como venga de la corrida anterior. */
async function asegurarCajaCerrada(page: Page) {
  await page.goto('/caja');
  if (!(await page.getByText('Turno abierto').isVisible().catch(() => false))) return;

  await page.getByRole('button', { name: 'Cerrar el turno' }).click();
  const form = page.getByRole('form', { name: 'Cerrar el turno' });
  await form.getByRole('button', { name: 'Cerrar caja' }).click();

  // Cerrar lleva al reporte del turno; de ahí se vuelve a la caja, ya cerrada.
  await expect(page.getByRole('button', { name: 'Imprimir' })).toBeVisible({ timeout: 15_000 });
  await page.goto('/caja');
  await expect(page.getByRole('button', { name: 'Abrir caja' })).toBeVisible();
}

/** Abre un turno con $50.000 de apertura. */
async function abrirConCincuentaMil(page: Page) {
  await asegurarCajaCerrada(page);
  await page.getByLabel('Efectivo inicial').fill('50000');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page.getByText('Turno abierto')).toBeVisible();
}

test('cerrar el turno no pide contar nada', async ({ page }) => {
  await entrarComoDuenio(page);
  await abrirConCincuentaMil(page);

  await page.getByRole('button', { name: 'Cerrar el turno' }).click();
  const form = page.getByRole('form', { name: 'Cerrar el turno' });

  // Lo que se sacó: las denominaciones, el total a mano y la justificación.
  await expect(form.getByLabel('$20.000')).toHaveCount(0);
  await expect(form.getByLabel('$10.000')).toHaveCount(0);
  await expect(form.getByLabel('Efectivo contado')).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Prefiero escribir el total' })).toHaveCount(0);
  await expect(form.getByLabel('¿A qué se debe?')).toHaveCount(0);

  // Lo que queda: cuánto debería haber, la nota, y cerrar.
  await expect(form).toContainText('50.000,00');
  await expect(form.getByLabel('Nota del turno (opcional)')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Cerrar caja' })).toBeEnabled();
});

test('el turno se cierra de un toque y el reporte no inventa un arqueo', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/caja');

  const esperado = await efectivoEsperado(page);

  const form = page.getByRole('form', { name: 'Cerrar el turno' });
  if (!(await form.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Cerrar el turno' }).click();
  }
  await form.getByLabel('Nota del turno (opcional)').fill('Turno de prueba automatizada');
  await form.getByRole('button', { name: 'Cerrar caja' }).click();

  // Cerrar deja directamente en el reporte del turno: es la hoja que se mira.
  const arqueo = page.getByRole('region', { name: 'El arqueo' });
  await expect(arqueo).toBeVisible({ timeout: 15_000 });
  await expect(arqueo).toContainText('Efectivo esperado');
  await expect(arqueo).toContainText(String(Math.trunc(esperado / 100_000)));

  /*
   * La regresión que importa: sin conteo, el reporte NO puede decir «Contado
   * $X · Diferencia $0». Eso sería afirmar un arqueo que nadie hizo, que es
   * justo el vicio del POS viejo —el efectivo contado figuraba siempre en cero
   * y nadie sabía si era un arqueo perfecto o ninguno—.
   */
  await expect(arqueo).not.toContainText('Contado');
  await expect(arqueo).not.toContainText('Diferencia');

  await expect(arqueo).toContainText('Turno de prueba automatizada');
  await expect(page.getByRole('region', { name: 'Cómo se contó el cajón' })).toHaveCount(0);
});

test('en la lista de cierres, uno sin contar no dice que cuadró', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/caja');

  const cierres = page.getByRole('region', { name: 'Cierres anteriores' });
  const primero = cierres.getByRole('listitem').first();

  await expect(primero).not.toContainText('Cuadró');
  await expect(primero).not.toContainText('Contado');
  await expect(primero).toContainText('Esperado');
});

test('el reporte de un turno viejo sigue diciendo lo mismo', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/caja');

  const cierres = page.getByRole('region', { name: 'Cierres anteriores' });
  const primero = cierres.getByRole('link').first();
  const cuando = await primero.innerText();
  await primero.click();

  await expect(page.getByRole('heading', { name: /turno de/i })).toBeVisible();
  // El encabezado dice hasta cuándo duró: el mismo momento que en la lista.
  await expect(page.getByText(`hasta ${cuando.trim()}`)).toBeVisible();
  await expect(page.getByRole('region', { name: 'El arqueo' })).toContainText('Efectivo esperado');
  await expect(page.getByRole('button', { name: 'Imprimir' })).toBeVisible();
});

/*
 * Este archivo es el único que cierra turnos, y los que siguen dan por sentado
 * que hay uno abierto con plata adentro.
 */
test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await entrarComoDuenio(page);
  await abrirConCincuentaMil(page);
  await page.close();
});
