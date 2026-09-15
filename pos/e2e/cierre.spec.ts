import { expect, test, type Page } from '@playwright/test';

/**
 * Arqueo y cierre de turno, de punta a punta.
 *
 * Necesita la base migrada y sembrada:
 *   npm run db:migrate && npm run db:seed -- --reset
 *
 * Lo que se comprueba no es que el formulario abra: es que contar los billetes
 * dé el mismo número que el cajón, que una diferencia no se pueda pasar por
 * alto sin explicarla, y que el reporte del turno siga diciendo lo mismo
 * después, con la explicación a la vista y no escondida en un tooltip.
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

/**
 * Deja la caja cerrada, venga como venga de la corrida anterior.
 *
 * Los tests comparten la base, así que un turno puede llegar abierto con
 * cualquier saldo. Se cierra escribiendo exactamente lo esperado para no
 * arrastrar una diferencia al turno que sigue.
 */
async function asegurarCajaCerrada(page: Page) {
  await page.goto('/caja');
  if (!(await page.getByText('Turno abierto').isVisible().catch(() => false))) return;

  const esperado = await efectivoEsperado(page);
  await page.getByRole('button', { name: 'Cerrar el turno' }).click();

  const form = page.getByRole('form', { name: 'Cerrar el turno' });
  await form.getByRole('button', { name: 'Prefiero escribir el total' }).click();
  await form.getByLabel('Efectivo contado').fill(String(esperado / 100));
  await form.getByRole('button', { name: 'Cerrar caja' }).click();

  // Cerrar lleva al reporte del turno; de ahí se vuelve a la caja, ya cerrada.
  await expect(page.getByRole('button', { name: 'Imprimir' })).toBeVisible({ timeout: 15_000 });
  await page.goto('/caja');
  await expect(page.getByRole('button', { name: 'Abrir caja' })).toBeVisible();
}

/** Abre un turno con $50.000 de apertura: cinco billetes de $10.000. */
async function abrirConCincuentaMil(page: Page) {
  await asegurarCajaCerrada(page);
  await page.getByLabel('Efectivo inicial').fill('50000');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page.getByText('Turno abierto')).toBeVisible();
}

test('el cajón se cuenta por denominación y el sistema suma', async ({ page }) => {
  await entrarComoDuenio(page);
  await abrirConCincuentaMil(page);

  await page.getByRole('button', { name: 'Cerrar el turno' }).click();
  const form = page.getByRole('form', { name: 'Cerrar el turno' });

  // Dos de $20.000 y uno de $10.000: los mismos $50.000 de la apertura.
  await form.getByLabel('$20.000').fill('2');
  await form.getByLabel('$10.000').fill('1');

  const contado = form.getByText('Contado').locator('..');
  await expect(contado).toContainText('50.000,00');
  await expect(form.getByText('Cuadra exacto.')).toBeVisible();
});

test('una diferencia no se puede cerrar sin explicarla', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/caja');

  const form = page.getByRole('form', { name: 'Cerrar el turno' });
  if (!(await form.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Cerrar el turno' }).click();
  }

  // Falta un billete de $10.000 de los cinco que se declararon al abrir.
  await form.getByLabel('$20.000').fill('2');
  await form.getByLabel('$10.000').fill('0');

  await expect(form.getByText(/^Falta/)).toBeVisible();

  // El casillero de la explicación es obligatorio: el navegador no deja mandar.
  const justificacion = form.getByLabel('¿A qué se debe?');
  await expect(justificacion).toBeVisible();
  await expect(justificacion).toHaveAttribute('required', '');
});

test('el turno se cierra contando y el reporte muestra los billetes', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/caja');

  const form = page.getByRole('form', { name: 'Cerrar el turno' });
  if (!(await form.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Cerrar el turno' }).click();
  }

  await form.getByLabel('$20.000').fill('2');
  await form.getByLabel('$10.000').fill('0');
  await form.getByLabel('¿A qué se debe?').fill('Se pagó un flete sin cargarlo');
  await form.getByLabel('Nota del turno (opcional)').fill('Turno de prueba automatizada');
  await form.getByRole('button', { name: 'Cerrar caja' }).click();

  // Cerrar deja directamente en el reporte del turno: es la hoja que se mira.
  const arqueo = page.getByRole('region', { name: 'El arqueo' });
  await expect(arqueo).toBeVisible({ timeout: 15_000 });
  await expect(arqueo).toContainText('Contado');
  await expect(arqueo).toContainText('40.000,00');

  // La justificación va en el cuerpo, no en un `title`: era el hallazgo 14.
  await expect(arqueo).toContainText('Se pagó un flete sin cargarlo');
  await expect(arqueo).toContainText('Turno de prueba automatizada');

  const conteo = page.getByRole('region', { name: 'Cómo se contó el cajón' });
  await expect(conteo).toContainText('$20.000');
  await expect(conteo).toContainText('× 2');
});

test('escribir el total a mano se puede, y queda a la vista que se hizo así', async ({ page }) => {
  await entrarComoDuenio(page);
  await abrirConCincuentaMil(page);

  await page.getByRole('button', { name: 'Cerrar el turno' }).click();
  const form = page.getByRole('form', { name: 'Cerrar el turno' });

  await form.getByRole('button', { name: 'Prefiero escribir el total' }).click();
  await form.getByLabel('Efectivo contado').fill('50000');
  await expect(form.getByText('Cuadra exacto.')).toBeVisible();

  await form.getByRole('button', { name: 'Cerrar caja' }).click();
  await expect(page.getByRole('region', { name: 'El arqueo' })).toBeVisible({ timeout: 15_000 });

  // Y en la lista de cierres se distingue del que se contó de verdad.
  await page.goto('/caja');
  const cierres = page.getByRole('region', { name: 'Cierres anteriores' });
  await expect(cierres.getByText('Total a mano').first()).toBeVisible();
  await expect(cierres.getByText('Contado', { exact: true }).first()).toBeVisible();
  await expect(cierres).toContainText('de los últimos');
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
 * que hay uno abierto con plata adentro. Dejarlo cerrado hacía que el primero
 * en abrirlo lo abriera en cero y el arqueo arrancara en rojo.
 */
test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await entrarComoDuenio(page);
  await abrirConCincuentaMil(page);
  await page.close();
});
