import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Reportes y exportación, de punta a punta.
 *
 * Necesita la base migrada y sembrada:
 *   npm run db:migrate && npm run db:seed -- --reset
 *
 * Lo que se comprueba es que los números del reporte sean los de las ventas que
 * el propio test hizo, que el período se pueda mover, y que la planilla baje de
 * verdad y se pueda abrir.
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

/** Vende un vidrio templado al contado. Devuelve lo que salió. */
async function venderUnVidrio(page: Page, context: BrowserContext) {
  await page.goto('/vender');
  const buscador = page.getByPlaceholder('Buscar por nombre');
  await buscador.fill('vidrio templado');
  await page.getByRole('button', { name: /Vidrio templado/ }).first().waitFor();
  await buscador.press('Enter');

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByLabel('Monto en Efectivo').fill('10000');

  await context.addInitScript(() => {
    window.print = () => {};
  });
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });
}

/** Lee un importe de un bloque de la pantalla y lo devuelve en centavos. */
function aCentavosDeTexto(texto: string): number {
  const m = texto.match(/\$\s*([\d.]+),(\d{2})/);
  if (!m) throw new Error(`No encontré un importe en: ${texto}`);
  return Number(m[1]!.replace(/\./g, '')) * 100 + Number(m[2]);
}

test('el reporte de hoy cuenta la venta que se acaba de hacer', async ({ page, context }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  await page.goto('/reportes?periodo=hoy');
  // Las etiquetas de los recuadros van en versalitas por CSS, y `innerText`
  // devuelve lo que se ve: «VENDIDO». Por eso el corte no mira mayúsculas.
  const antes = page.getByRole('region', { name: 'Lo vendido' });
  const vendidoAntes = aCentavosDeTexto(
    (await antes.innerText()).split(/vendido/i)[1]?.split(/ventas/i)[0] ?? '$ 0,00',
  );

  await venderUnVidrio(page, context);

  await page.goto('/reportes?periodo=hoy');
  const despues = page.getByRole('region', { name: 'Lo vendido' });
  const vendidoDespues = aCentavosDeTexto(
    (await despues.innerText()).split(/vendido/i)[1]?.split(/ventas/i)[0] ?? '$ 0,00',
  );

  expect(vendidoDespues).toBeGreaterThan(vendidoAntes);
});

test('el período se cambia de un clic y la pantalla lo dice', async ({ page }) => {
  await entrarComoDuenio(page);

  await page.goto('/reportes?periodo=hoy');
  await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible();

  await page.getByRole('link', { name: 'Mes pasado' }).click();
  await expect(page).toHaveURL(/periodo=mes_pasado/);

  // El encabezado dice qué período se está mirando, no solo el nombre.
  await expect(page.getByText(/del \d{4}-\d{2}-\d{2} al \d{4}-\d{2}-\d{2}/)).toBeVisible();
});

test('un rango escrito a mano se respeta, y al revés se rechaza', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/reportes');

  const rango = page.getByRole('form', { name: 'Elegir un rango de fechas' });
  await rango.getByLabel('Desde').fill('2026-09-01');
  await rango.getByLabel('Hasta').fill('2026-09-10');
  await rango.getByRole('button', { name: 'Ver' }).click();

  await expect(page.getByText('del 2026-09-01 al 2026-09-10')).toBeVisible();

  // Las fechas al revés no rompen la pantalla: lo dicen y siguen andando.
  await page.goto('/reportes?desde=2026-09-15&hasta=2026-09-01');
  await expect(page.getByText(/posterior a la de fin/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Lo vendido' })).toBeVisible();
});

test('qué se vendió sale ordenado por plata', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/reportes?periodo=anio');

  const que = page.getByRole('region', { name: 'Qué se vendió' });
  await expect(que).toBeVisible();
  await expect(que).toContainText('Ordenado por facturación');
});

test('el margen dice sobre cuántas unidades está hablando', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/reportes?periodo=anio');

  const margen = page.getByRole('region', { name: 'Cuánto quedó' });
  await expect(margen).toBeVisible();

  // O no hay costo cargado y lo dice, o lo hay y aclara la cobertura. Lo que no
  // puede pasar es presentar un margen parcial como si fuera el del período.
  const texto = await margen.innerText();
  expect(texto).toMatch(/no hay ningún producto con el costo cargado|de las .* unidades vendidas/);
});

test('la planilla de ventas baja y se puede abrir', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/reportes?periodo=anio');

  const descarga = page.waitForEvent('download');
  await page.getByRole('link', { name: /Ventas.*Bajar/s }).click();
  const archivo = await descarga;

  expect(archivo.suggestedFilename()).toMatch(/^ventas-\d{4}-\d{2}-\d{2}/);
  expect(archivo.suggestedFilename()).toMatch(/\.csv$/);

  const ruta = await archivo.path();
  const contenido = await import('node:fs/promises').then((fs) => fs.readFile(ruta, 'utf8'));

  // BOM y punto y coma: sin eso Excel en castellano lo abre roto.
  expect(contenido.charCodeAt(0)).toBe(0xfeff);
  expect(contenido).toContain('Numero;Fecha;Hora');
  // Y los montos con coma decimal, que es lo que Excel suma.
  expect(contenido).toMatch(/\d+,\d{2}/);
});

test('las tres planillas están y cada una dice para qué es', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/reportes?periodo=mes');

  const bajar = page.getByRole('region', { name: 'Bajar planillas' });
  await expect(bajar).toContainText('Una fila por venta');
  await expect(bajar).toContainText('Una fila por producto vendido');
  await expect(bajar).toContainText('Lo que salió en el período');
});

/**
 * Lo facturado no es lo que entró.
 *
 * Es la distinción que el reporte no hacía: restaba los gastos de lo
 * facturado, y un mes en que se fía mucho daba «ganancia» con el cajón vacío.
 * Acá se arma el caso completo —una venta fiada con anticipo, un cobro de esa
 * deuda y un gasto— y se mira que las dos cuentas salgan separadas.
 */
test('lo fiado se factura y no entra; el cobro de la deuda sí entra', async ({
  page,
  context,
}) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await context.addInitScript(() => {
    window.print = () => {};
  });

  const cliente = `Cliente del reporte ${Date.now().toString().slice(-5)}`;
  await page.goto('/clientes');
  await page.getByRole('button', { name: '+ Cliente nuevo' }).click();
  await page.getByLabel('Nombre y apellido').fill(cliente);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('link', { name: cliente })).toBeVisible({ timeout: 15_000 });

  // Una venta mitad en efectivo y mitad fiada: $5.000 facturados, $2.000 que
  // entran al cajón y $3.000 que quedan en la libreta.
  await page.goto('/vender');
  const buscador = page.getByPlaceholder('Buscar por nombre');
  await buscador.fill('vidrio templado');
  await page.getByRole('button', { name: /Vidrio templado/ }).first().waitFor();
  await buscador.press('Enter');

  const opciones = await page.locator('#cliente option').allTextContents();
  const i = opciones.findIndex((t) => t.includes(cliente));
  expect(i).toBeGreaterThan(-1);
  await page.locator('#cliente').selectOption({ index: i });

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Efectivo' }).click();
  await cobro.getByLabel('Monto en Efectivo').fill('2000');
  // El renglón nuevo se prellena con lo que falta: los $3.000 restantes.
  await cobro.getByRole('button', { name: '+ Cuenta corriente' }).click();
  await expect(cobro.getByText(/Le vas a fiar/)).toBeVisible();
  await Promise.all([
    context.waitForEvent('page'),
    cobro.getByRole('button', { name: /Confirmar venta/ }).click(),
  ]);
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });

  const facturado = page.getByRole('region', { name: 'Lo facturado y lo que entró' });
  await page.goto('/reportes?periodo=hoy');
  await expect(facturado).toBeVisible();

  // Lo fiado figura en el desglose y dice que no es plata.
  await expect(facturado).toContainText('Cuenta corriente');
  await expect(facturado).toContainText('no traen plata');

  // Ahora se cobra la deuda: eso sí es plata que entra en el período.
  await page.goto('/fiado');
  const fila = page.getByRole('listitem').filter({ hasText: cliente });
  await fila.getByRole('button', { name: 'Recibir un pago' }).click();
  await fila.getByLabel('¿Cuánto paga?').fill('2000');
  await fila.getByRole('button', { name: 'Registrar el pago' }).click();
  await expect(page.getByText(/Cobrado /)).toBeVisible({ timeout: 15_000 });

  await page.goto('/reportes?periodo=hoy');
  await expect(facturado).toContainText('Cobros de fiado de antes');
  await expect(
    page.getByRole('region', { name: 'Con qué se cobraron las deudas' }),
  ).toBeVisible();
});

test('en qué se gastó viene con la cuenta y los gastos grandes', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  const gasto = `Lote de iPhones ${Date.now().toString().slice(-5)}`;
  await page.goto('/gastos');
  await page.getByRole('button', { name: '+ Cargar un gasto' }).click();
  const alta = page.getByRole('form', { name: 'Cargar un gasto' });
  await alta.getByLabel('¿En qué se gastó?').fill(gasto);
  await alta.getByLabel('Cuánto').fill('150000');
  await alta.getByLabel('Categoría').selectOption({ label: 'Compra a proveedores' });
  await alta.getByLabel('Con qué').selectOption('transferencia');
  await alta.getByLabel('De qué cuenta salió').selectOption({ label: 'Banco' });
  await alta.getByRole('button', { name: 'Guardar el gasto' }).click();
  await expect(page.getByText(gasto).first()).toBeVisible({ timeout: 15_000 });

  await page.goto('/reportes?periodo=hoy');
  const seccion = page.getByRole('region', { name: 'Lo que salió' });
  await expect(seccion).toBeVisible();

  // La categoría contesta en qué; la cuenta, de dónde salió; y el detalle, a
  // quién y por qué, que es la pregunta que sigue al total.
  await expect(seccion).toContainText('Compra a proveedores');
  await expect(seccion).toContainText('Banco');
  await expect(seccion).toContainText(gasto);
  await expect(seccion).toContainText('$ 150.000,00');
});

test('el vendedor no entra a los reportes', async ({ page }) => {
  await entrarComoVendedor(page);

  // Ni por la pantalla…
  await page.goto('/reportes');
  await expect(page).toHaveURL(/\/$/);

  // …ni bajando la planilla a mano, que es el negocio entero en un archivo.
  const r = await page.request.get('/api/reportes/exportar?que=ventas&periodo=mes');
  expect(r.status()).toBe(403);
});
