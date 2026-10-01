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
const ROUTER = `Router de prueba ${SUF}`;
const MEMORIA = `Memoria de prueba ${SUF}`;

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

  await page.getByLabel('Pegá la lista o la planilla acá').fill(planilla);
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

  await page.getByLabel('Pegá la lista o la planilla acá').fill(planilla);
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

  await page.getByLabel('Pegá la lista o la planilla acá').fill(planilla);
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

test('al escribir el nombre avisa qué productos parecidos ya existen', async ({ page }) => {
  /*
   * El duplicado nace acá: con el cliente esperando, alguien carga algo que ya
   * está con otro nombre. El aviso llega mientras se escribe, no después de
   * completar precio y stock, que es cuando ya da fiaca volver atrás.
   */
  await entrarComoVendedor(page);
  await page.goto('/catalogo/nuevo');

  const parecidos = page.getByRole('region', { name: 'Productos parecidos que ya existen' });
  await expect(parecidos).toHaveCount(0);

  await page.getByLabel('Qué es').fill('vidrio templado');

  await expect(parecidos).toBeVisible({ timeout: 10_000 });
  await expect(parecidos).toContainText(/parecido/i);

  // Es un aviso, no una traba: el botón de cargar sigue estando.
  await expect(page.getByRole('button', { name: /Cargar/ }).first()).toBeEnabled();
});

test('si el producto ya existe, se le suman unidades en vez de duplicarlo', async ({ page }) => {
  /*
   * El camino completo: el vendedor busca, ve que está, y le suma lo que llegó
   * sin salir de la pantalla. Si tuviera que ir a buscarlo a otro lado, con el
   * cliente esperando el camino corto volvería a ser la ficha nueva.
   */
  await entrarComoVendedor(page);
  await page.goto('/catalogo/nuevo');
  await page.getByLabel('Qué es').fill('vidrio templado');

  const parecidos = page.getByRole('region', { name: 'Productos parecidos que ya existen' });
  await expect(parecidos).toBeVisible({ timeout: 10_000 });

  const fila = parecidos.getByRole('listitem').first();
  const antes = await fila.textContent();
  const quedan = Number(/Quedan (\d+)/.exec(antes ?? '')?.[1] ?? '0');

  await fila.getByLabel('Unidades que entraron').fill('3');
  await fila.getByRole('button', { name: 'Sumar al stock' }).click();

  // Dice cuánto quedó y que ya se puede vender: es lo que necesita saber.
  await expect(fila.getByRole('status')).toContainText(String(quedan + 3), { timeout: 15_000 });
  await expect(fila.getByRole('status')).toContainText(/se puede vender/i);

  /*
   * Y el alta NO se envió. Esta es la regresión concreta: el control vivía
   * adentro del `<form>` del alta, HTML no permite formularios anidados, y el
   * navegador descartaba el de adentro — «Sumar al stock» terminaba intentando
   * crear el producto a medio llenar. El formulario tiene que seguir ahí, con
   * lo que se había escrito y sin haberse mandado.
   */
  await expect(page.getByLabel('Qué es')).toHaveValue('vidrio templado');
  await expect(page.getByRole('button', { name: 'Cargar y poder venderlo' })).toBeVisible();
});

test('el catálogo tiene buscador, y si no está ofrece cargarlo', async ({ page }) => {
  await entrarComoVendedor(page);
  await page.goto('/catalogo');

  const buscador = page.getByRole('region', { name: 'Buscar en el catálogo' });
  await expect(buscador).toBeVisible();

  await buscador.getByLabel('Buscar un producto').fill('vidrio templado');
  await expect(buscador.getByRole('listitem').first()).toBeVisible({ timeout: 10_000 });

  // Y lo que no está lleva derecho a cargarlo, con el nombre ya escrito.
  await buscador.getByLabel('Buscar un producto').fill('secarropas industrial');
  const cargar = buscador.getByRole('link', { name: /Cargar «secarropas industrial»/ });
  await expect(cargar).toBeVisible({ timeout: 10_000 });
  await cargar.click();
  await expect(page.getByLabel('Qué es')).toHaveValue('secarropas industrial');
});

test('el precio viejo se corrige desde el buscador, sin abrir WordPress', async ({ page }) => {
  /*
   * Lo que pidió Fede el primer día: llegó mercadería con aumento y la ficha
   * quedó vieja. Escribir el precio en la venta arregla esa venta y ninguna de
   * las siguientes; esto arregla la ficha.
   *
   * La vuelta importa tanto como la ida: lo que se escribe es el precio de
   * mostrador y lo que se guarda es el de la tienda, con el recargo sumado. Si
   * esa cuenta y su inversa no cierran, el cajero escribe 33.300 y después
   * cobra otra cosa. Por eso se recarga la pantalla y se lee de nuevo.
   */
  await entrarComoVendedor(page);
  await page.goto('/catalogo');

  /*
   * El producto es el hidrogel anti espía y no el vidrio templado a propósito:
   * el vidrio es el que vende medio suite, y dejarle otro precio haría fallar a
   * los que vienen después. Un test que cambia datos compartidos elige un
   * producto que no comparte.
   */
  const buscador = page.getByRole('region', { name: 'Buscar en el catálogo' });
  await buscador.getByLabel('Buscar un producto').fill('anti espia');

  const fila = buscador.getByRole('listitem').first();
  await expect(fila).toBeVisible({ timeout: 10_000 });

  // Arranca cerrado: un campo editable al lado de cada producto invita a
  // tocarlo sin querer.
  await expect(fila.getByLabel('Precio de mostrador')).toHaveCount(0);
  await fila.getByRole('button', { name: 'Cambiar precio' }).click();

  await fila.getByLabel('Precio de mostrador').fill('33300');
  await fila.getByRole('button', { name: 'Guardar precio' }).click();

  await expect(fila.getByRole('status')).toContainText('33.300', { timeout: 15_000 });

  await page.goto('/catalogo');
  await buscador.getByLabel('Buscar un producto').fill('anti espia');
  await expect(buscador.getByRole('listitem').first()).toContainText('33.300', {
    timeout: 10_000,
  });
});

test('la entrega se pega como lista: carga, suma stock y da de baja', async ({ page }) => {
  /*
   * Lo que llega cuando llega mercadería no es una planilla con encabezado: es
   * la lista escrita a mano, un renglón por producto. Esta prueba recorre las
   * tres cosas que esa lista pide, en el orden en que pasan de verdad.
   *
   * Los nombres llevan sufijo porque la base no se vacía entre corridas, y
   * porque un test que escribe datos compartidos le rompe los totales a los que
   * vienen después.
   */
  await entrarComoDuenio(page);
  await page.goto('/catalogo/importar');

  const pegar = page.getByLabel('Pegá la lista o la planilla acá');

  // Primer paso: dos productos nuevos, con cantidad, costo y precio.
  await pegar.fill([`-${ROUTER} (5) $68.000 - 98.000`, `-${MEMORIA} (2) $36.500 - 64.000`].join('\n'));
  await page.getByRole('button', { name: 'Ver qué va a pasar' }).click();

  const revision = page.getByRole('region', { name: 'Lo que haría la entrega' });
  await expect(revision).toBeVisible();
  await expect(revision).toContainText(ROUTER);
  await expect(revision).toContainText('7 unidades en total');

  await page.getByRole('button', { name: /Aplicar los 2 renglones/ }).click();
  await expect(page.getByText(/2 productos nuevos/)).toBeVisible();

  // Segundo paso: al que ya está se le suman unidades sin repetir el precio, y
  // el otro se da de baja por nombre exacto.
  await page.goto('/catalogo/importar');
  await pegar.fill([`-${ROUTER} (3+)`, `-${MEMORIA} (eliminar)`].join('\n'));
  await page.getByRole('button', { name: 'Ver qué va a pasar' }).click();

  await expect(revision).toContainText('de 5 a 8');
  await expect(revision).toContainText(/se puede volver a activar/i);

  await page.getByRole('button', { name: /Aplicar los 2 renglones/ }).click();
  await expect(page.getByText(/1 con stock sumado/)).toBeVisible();
  await expect(page.getByText(/1 dados de baja/)).toBeVisible();

  // Y la baja no borró la ficha: sigue estando, marcada como inactiva.
  const buscador = page.getByRole('region', { name: 'Buscar en el catálogo' });
  await buscador.getByLabel('Buscar un producto').fill(MEMORIA);
  await expect(buscador.getByRole('listitem').first()).toContainText(/Inactivo/i, {
    timeout: 10_000,
  });
});

test('la lista no adivina: lo que no entiende lo dice y no lo carga', async ({ page }) => {
  await entrarComoDuenio(page);
  await page.goto('/catalogo/importar');

  await page
    .getByLabel('Pegá la lista o la planilla acá')
    .fill(
      [
        `-Notebook que no existe ${SUF} (1) u$s 718 - $1.490.000`,
        `-Cable que no existe ${SUF} (4+)`,
      ].join('\n'),
    );
  await page.getByRole('button', { name: 'Ver qué va a pasar' }).click();

  const revision = page.getByRole('region', { name: 'Lo que haría la entrega' });
  await expect(revision).toContainText(/dólares/i);
  await expect(revision).toContainText(/sin precio no se puede dar de alta/i);

  // Nada que aplicar: los dos renglones quedaron afuera.
  await expect(page.getByRole('button', { name: /Aplicar/ })).toHaveCount(0);
  await expect(revision).toContainText('No hay nada para aplicar');
});

test('la planilla de Excel sigue funcionando en el mismo cuadro', async ({ page }) => {
  // El mismo textarea come las dos cosas, y la planilla es la que ya andaba:
  // detectar mal el formato rompería una función que estaba bien.
  await entrarComoDuenio(page);
  await page.goto('/catalogo/importar');

  await page
    .getByLabel('Pegá la lista o la planilla acá')
    .fill(`nombre;categoria;precio;stock;costo\nFunda de planilla ${SUF};Fundas;9500;12;5000`);
  await page.getByRole('button', { name: 'Ver qué va a pasar' }).click();

  const revision = page.getByRole('region', { name: 'Lo que haría la planilla' });
  await expect(revision).toBeVisible();
  await expect(revision).toContainText(`Funda de planilla ${SUF}`);

  await page.getByRole('button', { name: /Cargar los 1/ }).click();
  await expect(page.getByText(/Se cargaron 1 productos de la planilla/)).toBeVisible();
});
