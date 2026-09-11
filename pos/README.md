# POS · Lucas Innovaciones

Punto de venta del local de Caseros 924, Villa Santa Rosa (Córdoba). Comparte
catálogo y stock con la tienda online de WooCommerce, y lleva por su cuenta lo
que WooCommerce no sabe llevar: ventas, fiado, caja, gastos y auditoría.

**Estado: Fase 2 (Venta de contado) terminada.** Se puede abrir caja, vender, cobrar con varios medios, imprimir el ticket y cerrar el turno con arqueo.

---

## Decisiones que explican por qué está hecho así

Las decisiones del proyecto viven en [`../BASES.md`](../BASES.md). Las que
mandan sobre este código:

| # | Decisión |
|---|---|
| **D4** | **WooCommerce es la fuente de verdad del catálogo, el precio y el stock.** El POS mantiene un espejo local para que el buscador responda rápido, pero el espejo no autoriza nada: al confirmar una venta, quien descuenta stock es Woo. |
| **D22** | **Los precios en dólares los maneja el plugin `lucas-cotizacion`**, que reescribe el precio en pesos dos veces por día con el blue de Córdoba. El POS no cotiza: lee ese valor y lo **congela en cada venta**. Una venta vieja nunca se recalcula. |
| **D23** | El POS es una app Next.js separada, no un plugin de WordPress. |
| **D24** | **Ninguna línea de venta puede existir sin un producto real.** Los servicios técnicos y los chips son productos de catálogo en `Solo mostrador`. El fiado tiene su propio módulo y deja de cargarse como si fuera un producto. |
| **D25** | Sin modo offline en la v1. Llega acotado en la v1.1: caché de catálogo y cola de la venta confirmada. |

### Reglas que no se negocian

- **Toda la plata en centavos, en enteros.** Nunca `float`, nunca `numeric`.
  Un test verifica que no haya ni una columna de coma flotante en la base.
- **Todas las fechas en `timestamptz`.** El huso `America/Argentina/Buenos_Aires`
  se aplica solo al mostrar.
- **Nada se borra.** Anular una venta genera registros nuevos. Los disparadores
  de `0001_registros_inmutables.sql` bloquean el `DELETE` en la base, no en el código.
- **La bitacora es inmutable**, por disparador, no por disciplina.

---

## Verlo andando en dos minutos

No hace falta instalar PostgreSQL, ni crear cuenta en ningún lado, ni tener
credenciales de WooCommerce. Solo Node 22 o superior
([nodejs.org](https://nodejs.org)).

**Desde la terminal:**

```bash
cd pos
npm install
npm run demo
```

**Desde VS Code**, sin escribir comandos: abrir la carpeta del repositorio y
usar `Ctrl+Shift+P` → *Tasks: Run Task*. Están cargadas:

| Tarea | Qué hace |
|---|---|
| **POS: instalar dependencias** | Solo la primera vez. |
| **POS: ver la demo** | Levanta todo y abre el POS. |
| **POS: ver la demo desde cero** | Igual, pero borra los datos de prueba antes. |
| **POS: correr los tests** | |
| **POS: revisar tipos** | |

Y abrir <http://localhost:3000>. El comando levanta un PostgreSQL embebido
(PGlite, el mismo motor compilado a WASM que usan los tests), aplica las
migraciones, carga 27 productos de prueba y arranca el POS. Las credenciales se
imprimen en la consola.

Los datos quedan en `.demo/` y sobreviven a los reinicios. Para empezar de cero:

```bash
npm run demo -- --reset
```

Es solo para mirar y para desarrollar: PGlite corre dentro del proceso y no
sirve para producción.

---

## Instalación para desarrollo real

Requisitos: Node 22 o superior, y una base PostgreSQL 16 (Neon o Supabase).

```bash
npm install
cp .env.example .env    # completá las variables (ver abajo)
npm run db:migrate      # aplica las migraciones
npm run db:seed         # datos de prueba, para trabajar sin WooCommerce
npm run dev             # http://localhost:3000
```

El seed deja un dueño (`lucas@lucasinnovaciones.com.ar`) y un vendedor con PIN.
Las credenciales se imprimen en la consola al terminar; se pueden cambiar con
`SEED_PASSWORD_DUENIO` y `SEED_PIN_VENDEDOR`. **Son solo para desarrollo.**

### Variables de entorno

Todas van en `.env`, ninguna en el código. Ver [`.env.example`](.env.example).

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | PostgreSQL. En producción, la cadena *pooled*. |
| `AUTH_SECRET` | Firma de la sesión. Generar con `openssl rand -base64 32`. |
| `WOO_URL` | Base del sitio, ej. `https://lucasinnovaciones.com.ar/staging`. |
| `WOO_CONSUMER_KEY` / `WOO_CONSUMER_SECRET` | Clave de la REST API de WooCommerce, con permiso de lectura y escritura. |
| `WOO_WEBHOOK_SECRET` | Secreto compartido de los webhooks. Sin esto, el endpoint rechaza todo con 503. |
| `WOO_AUTH_QUERY` | `true` si el hosting descarta la cabecera `Authorization` (pasa con LiteSpeed). Manda la credencial por query string, que también es método oficial de Woo sobre HTTPS. |
| `POS_TERMINAL` | Prefijo del número de venta, ej. `T1`. Una terminal por despliegue: define de dónde salió cada venta y a qué caja pertenece. Con una sola caja, dejar `T1`. |

---

## Cómo funciona una venta

1. **Se abre la caja** declarando el efectivo inicial. Sin caja abierta no se vende.
2. **Se busca el producto** por nombre, SKU, marca, código de barras o IMEI. El
   buscador va contra el espejo local, no contra WooCommerce: la red no está en
   el camino. `Enter` agrega el primero, que con el lector de código de barras es
   siempre el correcto. `F2` vuelve al buscador desde donde sea.
3. **El carrito** permite cambiar cantidades y, en servicios, escribir el precio.
   Los descuentos los ve solo el dueño.
4. **El cobro** (`F12`) admite varios medios en la misma venta y calcula el
   vuelto, que solo sale del efectivo entregado.
5. **Al confirmar**, en una sola transacción: se crea la venta, se descuenta
   stock, se impacta la caja, se audita y se encola el ajuste a WooCommerce.
   Después se abre el ticket, que se manda a imprimir solo.
6. **Al cerrar el turno** se cuenta el efectivo. Si no cuadra, hay que explicar
   por qué antes de poder cerrar.

### Tres decisiones que conviene conocer

**El servidor no le cree al navegador.** El cliente manda qué producto y cuántas
unidades; el precio lo reconstruye el servidor leyendo el catálogo. Un navegador
manipulado no puede cambiar un precio, y el precio manual solo se acepta en
productos marcados como editables.

**El precio en pesos de un producto en dólares se calcula, no se tipea.** Es la
guarda estructural contra el error de agosto: nueve iPhones cargados a US$ 6.300
y publicados a $6.300. Si no hay cotización cargada, el producto en dólares no
se puede vender y el sistema lo dice.

**WooCommerce se encola, no se llama dentro de la transacción.** Una llamada de
red adentro tiene un modo de falla feo: si Woo descuenta y después falla el
commit, se pierde stock sin venta. Así la venta queda firme en el POS y el
ajuste viaja después, con reintentos. La pantalla muestra cuántos quedan
pendientes.

El ajuste que se le manda a Woo es el stock **absoluto** que tiene el POS, no la
resta. Reintentarlo escribe el mismo número, así que es idempotente y se cura
solo. Si Woo tiene un valor que no esperábamos, queda registrado en
`sync_conflicts`.

---

## Sincronización con WooCommerce

```bash
npm run woo:sync -- --verificar          # prueba credenciales y cuenta productos
npm run woo:sync                         # trae el catálogo completo
npm run woo:sync -- --avisos avisos.csv  # guarda el informe de calidad de carga
```

La sincronización trae productos y variaciones, y **nunca pisa** los campos que
son solo del POS: el costo cargado desde una compra a proveedor y el stock
comprometido por pedidos web.

De paso arma un informe de calidad de carga, que es la mitad del problema que
este sistema viene a resolver:

| Aviso | Qué encontró |
|---|---|
| `sin_precio` | Precio por debajo de $100. No es moneda: es precio sin cargar (hay 32 así). |
| `usd_incoherente` | El precio en pesos no se condice con el precio en dólares al TC vigente. **Es el error que en agosto costó ~$9,7 millones**: 9 iPhones cargados a US$ 6.300 leídos como $6.300. |
| `usd_sin_conversion` | Tiene precio en dólares pero el precio en pesos quedó vacío. |
| `stock_ficticio` | Más de 1.000 unidades. Hay fichas con 9.708. |
| `sin_sku` / `sin_imagen` | Ficha incompleta. |

### Webhooks

Configurar en **WooCommerce → Ajustes → Avanzado → Webhooks**, apuntando a
`https://<dominio-del-pos>/api/webhooks/woo` con el mismo secreto que
`WOO_WEBHOOK_SECRET`:

- `product.created`, `product.updated` → refrescan el espejo
- `product.deleted` → **desactiva** el producto, no lo borra (las ventas viejas lo siguen referenciando)
- `order.created` → queda registrado; en la Fase 3 reserva stock

La firma se verifica con HMAC-SHA256 sobre el cuerpo crudo. Sin firma válida:
401. Sin secreto configurado: 503.

### Plugin `lucas-cotizacion`

La sincronización lee el tipo de cambio de
`wp-json/li-cotizacion/v1/actual`, agregado en la versión 1.1.0 del plugin
([`../plugin/lucas-cotizacion`](../plugin/lucas-cotizacion)). **Hay que
desplegar esa versión** para que funcione. Mientras tanto el POS se las arregla:
si el endpoint no existe, lee la meta `_li_cotizacion_aplicada` de cualquier
producto en dólares.

---

## Tests

```bash
npm test          # unitarios y de integración (Vitest)
npm run test:e2e  # de punta a punta (Playwright)
npm run typecheck # TypeScript en modo estricto
```

Los tests de base **no necesitan un PostgreSQL levantado**: usan PGlite
(PostgreSQL compilado a WASM) con las migraciones reales aplicadas, así que
prueban el esquema de verdad — mismas restricciones, mismos disparadores.

Los de Playwright sí necesitan la base migrada y sembrada:

```bash
npm run db:migrate && npm run db:seed -- --reset && npm run build && npm run test:e2e
```

Los de Playwright también se pueden correr contra la demo, sin base propia:

```bash
npm run demo                              # en una terminal
E2E_URL=http://localhost:3000 npm run test:e2e   # en otra
```

### Qué se verifica

| Criterio | Dónde |
|---|---|
| Ninguna línea de venta puede guardarse sin `product_id` válido, ni por SQL directo | `src/db/esquema.test.ts` |
| Reintentar tres veces la misma venta descuenta el stock una sola vez | `src/ventas/confirmar.test.ts` |
| Dos ventas de la última unidad: la segunda avisa, el stock nunca queda negativo | `src/ventas/confirmar.test.ts` |
| Una venta fallida no deja nada a medias | `src/ventas/confirmar.test.ts` |
| El precio que manda el navegador se ignora | `src/ventas/confirmar.test.ts` |
| Con vuelto, a la caja entra el neto y no lo que entregó el cliente | `src/ventas/confirmar.test.ts` |
| No se puede fiar sin cliente ni vender sin caja abierta | `src/ventas/confirmar.test.ts` |
| El cierre de caja exige justificar la diferencia | `src/caja/sesion.test.ts` |
| Drenar la cola dos veces no vuelve a descontar en Woo | `src/woo/cola.test.ts` |
| El ticket escapa el HTML del catálogo y usa la hora de Buenos Aires | `src/ventas/ticket.test.ts` |
| Venta completa desde el navegador, con vuelto y ticket | `e2e/venta.spec.ts` |
| El log de auditoría no se puede modificar ni borrar | `src/db/esquema.test.ts` |
| Cancelar no borra: `DELETE` bloqueado en ventas, stock y caja | `src/db/esquema.test.ts` |
| Un producto en USD sin precio en dólares no entra | `src/db/esquema.test.ts` |
| Un gasto pagado sin cuenta monetaria no entra (si no, la caja no cierra) | `src/db/esquema.test.ts` |
| Una clave de idempotencia no puede repetirse | `src/db/esquema.test.ts` |
| No hay dos sesiones de caja abiertas en la misma terminal | `src/db/esquema.test.ts` |
| La aritmética de centavos y el redondeo al millar de D22 | `src/lib/dinero.test.ts` |
| El error de los 9 iPhones se detecta al sincronizar | `src/woo/mapear.test.ts` |
| Sincronizar dos veces actualiza en vez de duplicar | `src/woo/sincronizar.test.ts` |
| El webhook rechaza una firma inválida | `src/woo/webhook.test.ts` |
| Ingreso por PIN y por contraseña, y los permisos por rol | `e2e/ingreso.spec.ts` |

---

## Estructura

```
src/
  app/            Rutas de Next (App Router)
    (pos)/        Shell del POS, detrás de sesión
      vender/     Pantalla de venta: buscador, carrito y cobro
      caja/       Apertura, resumen del turno y arqueo
    ingresar/     Pantalla de ingreso
    ticket/       Comprobante imprimible
    api/          Buscador, Auth.js y webhooks de WooCommerce
  auth/           Sesión, PIN, permisos por rol
  caja/           Sesión de caja: abrir, resumir, cerrar
  db/             Esquema Drizzle, migraciones, seed, base de test
  lib/            Dinero en centavos, fechas, texto, auditoría
  ventas/         Carrito, buscador, confirmación de venta y ticket
  woo/            Cliente REST, mapeo, sincronización, cola, webhooks
  scripts/        Comandos de consola
drizzle/          Migraciones SQL versionadas
e2e/              Tests de Playwright
```

---

## Despliegue

Vercel, con la raíz del proyecto en `pos/`. Antes del primer despliegue:

1. Crear la base en Neon o Supabase y correr `npm run db:migrate`.
2. Cargar las variables de entorno en Vercel.
3. Correr `npm run woo:sync` una vez, apuntando al staging.
4. Dar de alta los webhooks en WooCommerce.

**El POS no tiene por qué ser accesible desde toda internet.** El PIN de
vendedor es corto por diseño; conviene restringir el acceso por IP o por
Vercel Authentication mientras no haya limitación de intentos.

---

## Lo que falta

Orden de construcción, con el offline corrido a la v1.1 por D25:

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Base: esquema, migraciones, auth, layout, sincronización, auditoría | **Hecha** |
| 2 | Venta contado: buscador, carrito, pago mixto, ticket, stock, caja básica | **Hecha** |
| 3 | Dólares y calidad de datos: validaciones de cordura, marcador de producto real | Siguiente |
| 4 | Clientes y fiado, con la pantalla de migración de fichas de papel | |
| 5 | WhatsApp: comprobantes y recordatorios | |
| 6 | Gastos y cuentas monetarias | |
| 7 | Caja completa: arqueo y cierre | |
| 8 | Alta asistida de productos: rápida, con IA, importación masiva | |
| 9 | Reportes y exportación | |
| 10 | Devoluciones, anulaciones y migración del histórico | |
| v1.1 | Offline acotado: caché de catálogo y cola de venta | |
