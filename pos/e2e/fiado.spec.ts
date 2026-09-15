import { expect, test, type Page } from '@playwright/test';

/**
 * Clientes y fiado, de punta a punta.
 *
 * Necesita la base migrada y sembrada:
 *   npm run db:migrate && npm run db:seed -- --reset
 *
 * Corren en serie y comparten el turno: el fiado nace en una venta y se cobra
 * después, que es exactamente lo que pasa en el mostrador.
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

async function asegurarCajaAbierta(page: Page) {
  await page.goto('/caja');
  if (await page.getByRole('button', { name: 'Abrir caja' }).isVisible().catch(() => false)) {
    await page.getByLabel('Efectivo inicial').fill('0');
    await page.getByRole('button', { name: 'Abrir caja' }).click();
  }
  await expect(page.getByText('Turno abierto')).toBeVisible();
}

async function elegirCliente(page: Page, nombre: string) {
  const opciones = await page.locator('#cliente option').allTextContents();
  const i = opciones.findIndex((t) => t.includes(nombre));
  expect(i).toBeGreaterThan(-1);
  await page.locator('#cliente').selectOption({ index: i });
}

/**
 * Los clientes de prueba llevan un sufijo por corrida: la base no se vacía entre
 * corridas y un teléfono repetido es, con razón, un error de carga.
 */
const SUFIJO = Date.now().toString().slice(-5);
const CLIENTE = `Rubén de los tests ${SUFIJO}`;
const TELEFONO = `3573 4${SUFIJO}`;
const DE_LA_LIBRETA = `Doña de la libreta ${SUFIJO}`;

test('se carga un cliente nuevo desde el fichero', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/clientes');

  await page.getByRole('button', { name: '+ Cliente nuevo' }).click();
  await page.getByLabel('Nombre y apellido').fill(CLIENTE);
  await page.getByLabel('Teléfono').fill(TELEFONO);
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByText(`«${CLIENTE}» quedó cargado`)).toBeVisible();
  await expect(page.getByRole('link', { name: CLIENTE })).toBeVisible();
});

test('el mismo teléfono no se puede cargar dos veces', async ({ page }) => {
  // Dos fichas del mismo cliente son dos deudas que no se ven juntas.
  await entrarComoDuenio(page);
  await page.goto('/clientes');

  await page.getByRole('button', { name: '+ Cliente nuevo' }).click();
  await page.getByLabel('Nombre y apellido').fill(`Otro con el mismo número ${SUFIJO}`);
  await page.getByLabel('Teléfono').fill(`0${TELEFONO.replace(/\s/g, '')}`);
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByText(new RegExp(`ya es de «${CLIENTE}»`))).toBeVisible();
});

test('fiar deja la deuda registrada y no mueve plata', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/vender');

  await page.getByPlaceholder('Buscar por nombre').fill('vidrio templado');
  await page.getByRole('button', { name: /Vidrio templado/ }).first().waitFor();
  await page.getByPlaceholder('Buscar por nombre').press('Enter');

  await elegirCliente(page, CLIENTE);

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Cuenta corriente' }).click();

  await expect(cobro.getByText(/Le vas a fiar/)).toBeVisible();
  await expect(cobro.getByText(/Es la primera vez que le fiás/)).toBeVisible();

  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });

  await page.goto('/fiado');
  const fila = page.getByRole('listitem').filter({ hasText: CLIENTE });
  await expect(fila).toContainText('$ 5.000,00');
});

test('cobrar el fiado baja la deuda y entra a la caja', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);
  await page.goto('/fiado');

  const fila = page.getByRole('listitem').filter({ hasText: CLIENTE });
  await fila.getByRole('button', { name: 'Recibir un pago' }).click();
  await fila.getByLabel('¿Cuánto paga?').fill('2000');
  await fila.getByLabel('Nota (opcional)').fill('A cuenta');
  await fila.getByRole('button', { name: 'Registrar el pago' }).click();

  await expect(page.getByText(/Cobrado .* Le queda una deuda de/)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: CLIENTE })).toContainText('$ 3.000,00');

  // Y la plata está en la caja del turno.
  await page.goto('/caja');
  await expect(page.getByText('Efectivo esperado')).toBeVisible();
});

test('el tope frena la venta antes de que entre', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  // Tope por debajo de lo que ya debe.
  await page.goto('/clientes');
  await page.getByRole('link', { name: CLIENTE }).click();
  await page.waitForURL(/\/clientes\//);
  await page.getByLabel('Hasta cuánto se le puede fiar').fill('1000');
  await page.getByRole('button', { name: 'Guardar el tope' }).click();
  await expect(page.getByText(/Tope de fiado en/)).toBeVisible();

  await page.goto('/vender');
  await page.getByPlaceholder('Buscar por nombre').fill('vidrio templado');
  await page.getByRole('button', { name: /Vidrio templado/ }).first().waitFor();
  await page.getByPlaceholder('Buscar por nombre').press('Enter');
  await elegirCliente(page, CLIENTE);

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Cuenta corriente' }).click();

  // La pantalla avisa antes…
  await expect(cobro.getByText(/Se pasa del tope/)).toBeVisible();

  // …y el servidor no lo deja pasar igual.
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
  await expect(cobro.getByText(/su límite es/)).toBeVisible();

  // Lo dejamos sin tope para los tests que sigan.
  await page.goto('/clientes');
  await page.getByRole('link', { name: CLIENTE }).click();
  await page.waitForURL(/\/clientes\//);
  await page.getByLabel('Hasta cuánto se le puede fiar').fill('');
  await page.getByRole('button', { name: 'Guardar el tope' }).click();
  await expect(page.getByText(/Sin tope/)).toBeVisible();
});

test('el vendedor no puede fiar, pero sí recibir un pago', async ({ page }) => {
  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  await page.goto('/ingresar');
  await page.getByLabel('PIN').fill(PIN);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();

  await page.goto('/vender');
  await page.getByPlaceholder('Buscar por nombre').fill('vidrio templado');
  await page.getByRole('button', { name: /Vidrio templado/ }).first().waitFor();
  await page.getByPlaceholder('Buscar por nombre').press('Enter');

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await expect(cobro.getByRole('button', { name: '+ Cuenta corriente' })).toHaveCount(0);

  // Cobrar sí puede: que venga alguien a pagar y no se le pueda recibir la
  // plata sería peor que cualquier control.
  await page.goto('/fiado');
  const fila = page.getByRole('listitem').filter({ hasText: CLIENTE });
  await expect(fila.getByRole('button', { name: 'Recibir un pago' })).toBeVisible();
});

test('la ficha de papel entra una sola vez', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/clientes');

  await page.getByRole('button', { name: '+ Cliente nuevo' }).click();
  await page.getByLabel('Nombre y apellido').fill(DE_LA_LIBRETA);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(/quedó cargado/)).toBeVisible();

  await page.getByRole('link', { name: DE_LA_LIBRETA }).click();
  await page.waitForURL(/\/clientes\//);

  await page.getByRole('button', { name: 'Cargar una ficha de papel' }).click();
  await page.getByLabel('Saldo de la libreta').fill('45000');
  await page.getByLabel('De dónde sale (opcional)').fill('Libreta, hoja 12');
  await page.getByRole('button', { name: 'Cargar la ficha' }).click();

  // La ficha desaparece de la pantalla porque ya no corresponde: lo que queda
  // es la deuda cargada y la marca de que vino de la libreta.
  await expect(page.getByText('Viene de una ficha de papel migrada')).toBeVisible();
  await expect(page.getByText('$ 45.000,00')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Viene de una ficha de papel migrada')).toBeVisible();

  // Ya no se ofrece de nuevo: sumar dos veces la misma deuda es el error a evitar.
  await expect(page.getByRole('button', { name: 'Cargar una ficha de papel' })).toHaveCount(0);
});

/*
 * Hallazgo 21 de la auditoría.
 *
 * Anular una venta fiada que el cliente ya pagó en parte dejaba esa plata en la
 * caja sin ninguna pantalla donde se viera: el sistema decía que estaban a mano
 * y el negocio se quedaba con el dinero.
 */
test('anular una venta fiada ya cobrada en parte deja anotada la devolución', async ({ page }) => {
  const CLIENTE_DEV = `Devolución ${SUFIJO}`;

  await entrarComoDuenio(page);
  await asegurarCajaAbierta(page);

  await page.goto('/clientes');
  await page.getByRole('button', { name: '+ Cliente nuevo' }).click();
  await page.getByLabel('Nombre y apellido').fill(CLIENTE_DEV);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(`«${CLIENTE_DEV}» quedó cargado`)).toBeVisible();

  // Se le fía un vidrio de $5.000.
  await page.goto('/vender');
  await page.getByPlaceholder('Buscar por nombre').fill('vidrio templado');
  await page.getByRole('button', { name: /Vidrio templado/ }).first().waitFor();
  await page.getByPlaceholder('Buscar por nombre').press('Enter');
  await elegirCliente(page, CLIENTE_DEV);

  await page.getByRole('button', { name: /^Cobrar/ }).click();
  const cobro = page.getByRole('dialog', { name: 'Cobrar' });
  await cobro.getByRole('button', { name: '+ Cuenta corriente' }).click();
  await cobro.getByRole('button', { name: /Confirmar venta/ }).click();
  await expect(page.getByText('Buscá un producto')).toBeVisible({ timeout: 15_000 });

  // Pasa y paga $2.000 a cuenta.
  await page.goto('/fiado');
  const fila = page.getByRole('listitem').filter({ hasText: CLIENTE_DEV });
  await fila.getByRole('button', { name: 'Recibir un pago' }).click();
  await fila.getByLabel('¿Cuánto paga?').fill('2000');
  await fila.getByRole('button', { name: 'Registrar el pago' }).click();
  await expect(page.getByText(/Cobrado/)).toBeVisible();

  // Y se anula la venta.
  await page.goto('/ventas');
  const filaVenta = page.getByRole('listitem').filter({ hasText: /Vidrio templado/ }).first();
  await filaVenta.getByRole('button', { name: 'Anular' }).click();
  await page.getByLabel(/¿Por qué se anula/).first().fill('Se arrepintió');
  await page.getByRole('button', { name: 'Anular la venta' }).click();

  // El aviso rojo queda en la fila de la venta anulada, puesto por el servidor:
  // así sigue estando mañana y no depende de que alguien lo lea en el momento.
  await expect(page.getByRole('alert').filter({ hasText: 'Devolvele' })).toContainText(
    '$ 2.000,00',
    { timeout: 15_000 },
  );

  // Y queda anotado donde se va a buscar: en fiado y en la ficha del cliente.
  await page.goto('/fiado');
  const aviso = page.getByRole('region', { name: 'Hay plata para devolver' });
  await expect(aviso).toContainText(CLIENTE_DEV);
  await expect(aviso).toContainText('$ 2.000,00');

  await page.goto('/clientes');
  await page.getByRole('link', { name: CLIENTE_DEV }).click();
  await page.waitForURL(/\/clientes\//);
  await expect(page.getByRole('region', { name: /Le debemos/ })).toContainText('$ 2.000,00');

  // Se le devuelve y el recordatorio se cierra. Se afirma sobre el resultado
  // visible y no sobre el cartel de éxito: al revalidar, la sección entera
  // desaparece y se lleva el cartel con ella.
  await page.getByRole('button', { name: 'Ya se le devolvió' }).click();
  await page.getByLabel('Nota (opcional)').fill('En efectivo, del cajón');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('region', { name: /Le debemos/ })).toHaveCount(0, {
    timeout: 15_000,
  });

  await page.goto('/fiado');
  await expect(page.getByRole('region', { name: 'Hay plata para devolver' })).toHaveCount(0);

  // Y en ventas tampoco queda el aviso: ya no hay nada que devolver.
  await page.goto('/ventas');
  await expect(page.getByRole('alert').filter({ hasText: 'Devolvele' })).toHaveCount(0);
});

