# POS · Lucas Innovaciones

Punto de venta del local de Caseros 924, Villa Santa Rosa (Córdoba). Comparte
catálogo y stock con la tienda online de WooCommerce, y lleva por su cuenta lo
que WooCommerce no sabe llevar: ventas, fiado, caja, gastos y auditoría.

**Estado: v1.1 terminada.** Se puede abrir caja, vender, cobrar con varios medios, **fiar y cobrar el fiado**, imprimir el ticket, preparar el comprobante y los recordatorios **por WhatsApp**, cargar **gastos** y mover plata entre cuentas, ver las ventas del turno, reimprimir un comprobante, anular una venta mal cargada y **cerrar el turno contando los billetes, con el reporte del turno impreso**. Lo de un turno ya cerrado **vuelve por devolución**, que sale del cajón de hoy y el arqueo lo explica. El producto que falta **se carga desde la misma pantalla de venta** —de a uno o con una planilla entera— y queda vendible en el acto. Los **reportes** dicen cuánto se vendió, de qué, con qué margen y contra qué período anterior, **arrancando en la facturación del sistema anterior** y no el día que se instaló el POS, y bajan en planilla para el contador. El mostrador cobra su propio precio, más barato que el de la tienda online. El sistema frena las ventas con precios imposibles y muestra qué fichas del catálogo hay que arreglar. Y si se corta internet **se sigue vendiendo**: la venta se guarda en la tablet y entra sola cuando vuelve.

El sistema pasó **nueve auditorías**, anotadas en [AUDITORIA.md](AUDITORIA.md): las fases 3.5 a 3.7 salieron de la primera, y las dos últimas son el control previo a producción — los diecinueve invariantes de plata dando sobre la base de verdad, y una medición con el catálogo completo (803 productos: el buscador tarda 6 ms y los reportes 3).

---

## Decisiones que explican por qué está hecho así

Las decisiones del proyecto viven en [`../BASES.md`](../BASES.md). Las que
mandan sobre este código:

| # | Decisión |
|---|---|
| **D4** | **WooCommerce es la fuente de verdad del catálogo, el precio y el stock.** El POS mantiene un espejo local para que el buscador responda rápido, pero el espejo no autoriza nada: al confirmar una venta, quien descuenta stock es Woo. *El mostrador sí puede sumar stock y corregir un precio, y en los dos casos lo empuja a Woo por la cola: la fuente de verdad sigue siendo una sola, lo que cambió es que el mostrador también le escribe.* |
| **D22** | **El precio en dólares se guarda en dólares y el de pesos se calcula con la cotización**, que se **congela en cada venta**: una venta vieja nunca se recalcula. *El valor lo traía el plugin `lucas-cotizacion`; desde que dejó de contestar lo trae el POS solo, cada dos horas, del blue de Córdoba de infodolar.com.* |
| **D23** | El POS es una app Next.js separada, no un plugin de WordPress. |
| **D24** | **Ninguna línea de venta puede existir sin un producto real.** Los servicios técnicos y los chips son productos de catálogo en `Solo mostrador`. El fiado tiene su propio módulo y deja de cargarse como si fuera un producto. |
| **D25** | Sin modo offline en la v1. Llega acotado en la v1.1: caché de catálogo y cola de la venta confirmada. |
| **D56** | **Sin conexión el POS sigue vendiendo.** El catálogo vive guardado en la tablet y la venta cobrada va a una cola que se sube sola. El precio de esa venta lo pone la pantalla —única excepción a que el servidor no le cree al navegador— porque sin catálogo que consultar es el único dato que existe de lo que el cliente pagó. Lo que reemplaza a la guarda es el **desvío** anotado contra el catálogo. |
| **D62** | **Lo que se vende en dólares se debe en dólares.** Si todo el carrito está cotizado en dólares, el saldo fiado y sus cuotas quedan en dólares; cualquier otra venta —mezclada incluida— queda en pesos, siempre. Las dos deudas viven separadas en la misma cuenta y nunca se suman ni se convierten para mostrar un total. |
| **D31** | **El mostrador y la tienda cobran distinto, y el número que se guarda es el de la tienda.** En la web cobra Mercado Pago y esa comisión no la paga el local. WooCommerce guarda el precio de la tienda —que es el que la web cobra de verdad— y el POS le descuenta un recargo global para llegar al de mostrador. Un producto por producto queda con un precio de mostrador escrito a mano cuando el porcentaje no aplica. |

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

### Probar el modo sin conexión

La demo de arriba corre en modo desarrollo, y ahí **el service worker no se
registra a propósito** —servir páginas guardadas mientras uno edita código es la
forma más rápida de pasar una tarde mirando una versión vieja—. Para probar que
se puede vender sin internet hace falta la versión construida:

```bash
npm run demo -- --produccion
```

Tarda unos treinta segundos más porque construye primero. Después, en el
navegador: abrir **Vender**, recargar una vez (el service worker toma el control
recién en la segunda carga), pasar por **Caja**, y recién ahí cortar la
conexión desde las herramientas de desarrollo → Red → «Sin conexión».

### Si la demo no levanta

PGlite es PostgreSQL compilado a WASM y no se comporta igual en todas las
máquinas: en Windows con **Node 24** llega a abortar con
`RuntimeError: Aborted()`. El comando degrada solo —reintenta con la carpeta de
datos limpia, después arranca en memoria— pero si aun así falla:

1. Instalar **Node 22 LTS** ([nodejs.org](https://nodejs.org)) y repetir.
2. O saltearse la demo: si ya hay un `.env` con `DATABASE_URL`, la base de
   verdad no necesita PGlite para nada.

   ```bash
   npm run db:migrate && npm run db:seed && npm run dev
   ```

---

## Dónde vive cada cosa

El POS **no se instala en WordPress**. Es un sitio aparte, con su propia
dirección y su propia base. Esto es lo que suele confundir, así que conviene
tenerlo a mano:

| Dónde | Qué vive ahí | Cómo se actualiza |
|---|---|---|
| `lucasinnovaciones.com.ar` | La tienda: WordPress, WooCommerce, el tema y el plugin de cotización | Ferozo, como siempre |
| `pos.lucasinnovaciones.com.ar` | El POS entero | Vercel, con `git push` |
| Neon (o Supabase) | La base del POS: ventas, caja, fiado, bitácora | — |

En el mostrador se abre esa segunda dirección en la tablet y se agrega a la
pantalla de inicio: de ahí en más es un ícono que abre a pantalla completa.
Nunca hace falta entrar a WordPress para vender.

Lo único que se toca del lado de WordPress son dos cosas, una sola vez: generar
una clave de la API REST y dar de alta los webhooks. Las dos están en
[PRODUCCION.md](PRODUCCION.md).

**Por qué no es un plugin de WordPress**, que era el plan original (D5) y se
cambió con D23: si el POS viviera adentro de la tienda, un mal día del hosting
compartido dejaría al local sin poder cobrar. Además las garantías de la plata
—que una venta no se pueda borrar, que los montos no se puedan reescribir, que
dos ventas de la última unidad no ganen las dos— son disparadores y
restricciones de PostgreSQL que el MySQL de WordPress no tiene, y las ventas
quedarían al lado de `wp_posts`, al alcance de cualquier plugin instalado.

La parte que **sí** tenía que vivir adentro de WordPress es plugin y ya está
hecha: `plugin/lucas-cotizacion`, que reescribe en pesos los precios cargados en
dólares (D22).

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
| `ANTHROPIC_API_KEY` | **Opcional.** Habilita la ayuda que arma la ficha de un producto nuevo a partir de una descripción suelta. Sin esto el alta funciona igual, a mano. Nunca propone precio, stock ni imágenes. |
| `ANTHROPIC_MODELO` | **Opcional.** Modelo a usar; por defecto `claude-opus-5`. |
| `CRON_SECRET` | Secreto del drenaje programado de la cola. La tarea de Vercel (ver `vercel.json`) pega en `/api/cron/sincronizar` con `Authorization: Bearer <CRON_SECRET>`. Sin esto la ruta devuelve 503 y la cola solo se mueve al vender o a mano. |

---

## Quién puede qué

**El vendedor puede hacer todo menos ver el balance del mes.** Vender, fiar,
cobrar, descontar, anular, escribir un precio, cargar un gasto, dar de alta un
producto, tocar el dólar. Reportes es lo único que queda del lado del dueño, y
es lo único que pidió reservarse.

No arrancó así. El diseño original tenía tres niveles —lo del vendedor, lo del
dueño, y un tercero «el vendedor puede con el PIN del dueño al lado»— y la
primera semana con gente de verdad lo desarmó entero. Dos cosas:

1. **El tercer nivel nunca existió.** `requiereAutorizacion` estaba escrito y no
   se llamaba desde ninguna pantalla: los controles simplemente no se mostraban
   y la única salida era que el dueño se logueara él. Un permiso que en la
   práctica es «andá a buscar a Lucas» no es un permiso, es una traba.
2. **Lo que se frenaba era el trabajo, no el riesgo.** Llegó mercadería con
   aumento y la ficha quedó vieja; un cliente quiere fiar un martes a la tarde;
   hay que anular una venta cargada mal. Nada de eso es una decisión que
   convenga tomar dos horas después, y el costo de frenarlo es el papel: se
   anota a mano y el sistema se entera tarde o nunca.

Lo que sí protege sigue estando, y no es un permiso:

- **El tope de fiado por cliente**, que pone el dueño y hace cumplir el servidor.
- **La guarda de cordura de precios**, que frena lo que quede muy por debajo del
  catálogo, y que distingue dos casos que antes iban juntos:
  - **Un precio escrito a mano** lo confirma quien atiende. Reservarlo al dueño
    no protegía nada, porque el descuento no pasa por esta guarda y habría
    empujado a rebajar por el campo que se ve menos.
  - **Una ficha mal cargada** —el iPhone con la cifra en dólares leída como
    pesos— sigue siendo del dueño: ahí nadie eligió ese precio, y lo que
    corresponde no es cobrar igual sino arreglar la ficha.

  El filtro está en el dominio, no en la pantalla, y la bitácora guarda cuál de
  los dos se confirmó.
- **Cada venta, cada anulación y cada precio escrito quedan con su autor.**

La lista de `src/auth/permisos.ts` es la de las **excepciones**, no la de lo
permitido: así el permiso que alguien agregue mañana nace del lado del vendedor,
que es la regla. `pin.test.ts` obliga a clasificar cada permiso nuevo para que
la excepción no se cuele por olvido.

---

## Cómo funciona una venta

1. **Se abre la caja** declarando el efectivo inicial. Sin caja abierta no se vende.
2. **Se busca el producto** por nombre, SKU, marca, código de barras o IMEI. El
   buscador va contra el espejo local, no contra WooCommerce: la red no está en
   el camino. `Enter` agrega el primero, que con el lector de código de barras es
   siempre el correcto. `F2` vuelve al buscador desde donde sea.

   **Se escriben palabras sueltas, en cualquier orden.** «cargador mega»,
   «mega cargador» y «cargador foxbox» encuentran todas al *Cargador Fox Box
   MEGA 30w*: el buscador pide que estén **todas** las palabras, cada una en
   cualquier parte del nombre, el SKU o la marca. Una puede caer en un campo y
   otra en otro.

   Antes el término viajaba entero —`%cargador mega%`— y exigía que las palabras
   estuvieran pegadas y en ese orden, así que había que acertar el nombre
   completo del proveedor. El mostrador no se acuerda del nombre completo: se
   acuerda de dos o tres palabras. Y con una sola —la marca— salían los
   cargadores, los cables y los auriculares juntos, una lista para recorrer con
   gente esperando. Ahora **cada palabra que se agrega achica la lista en vez de
   vaciarla**, que es como busca cualquiera.
3. **El carrito** permite cambiar cantidades y, en servicios, escribir el precio:
   cada reparación se cotiza en el momento. Lo que sí está controlado es cuánto
   puede alejarse del precio de referencia —por debajo de la mitad frena y lo
   confirma el dueño— y los descuentos, que son del dueño. Una variación se cobra
   a **su** precio, no al del producto padre, y el ticket dice qué medida se llevó.
4. **El cobro** (`F12`) admite varios medios en la misma venta y calcula el
   vuelto, que solo sale del efectivo entregado.
5. **Al confirmar**, en una sola transacción: se crea la venta, se descuenta
   stock, se impacta la caja, se audita y se encola el ajuste a WooCommerce.
   Después se abre el **comprobante**, que se manda a imprimir solo.
6. **Si se fía**, hay que elegir un cliente y lo tiene que hacer el dueño. La
   deuda queda en su cuenta corriente, en la misma transacción que la venta.
7. **Ventas del turno** (`F4`) muestra todo lo que se vendió, permite volver a
   imprimir cualquier comprobante y, al dueño, anular una venta mal cargada.
8. **Al cerrar el turno** se cuenta el efectivo. Si no cuadra, hay que explicar
   por qué antes de poder cerrar.

### Anular una venta

Anular no borra: repone el stock deshaciendo exactamente los movimientos que
dejó la venta —así vuelve a la variación de la que salió—, mete el asiento
contrario en la caja, marca la venta como anulada con el motivo, que es
obligatorio, y le avisa a WooCommerce por la misma cola de siempre.

Solo dentro del turno abierto: la plata volvió al cajón de ese
turno, y revertir contra una caja ya cerrada descuadraría dos arqueos. Una venta
de ayer se resuelve con una [devolución](#devoluciones-de-ventas-de-otro-turno),
que es otra cosa.

### Tres decisiones que conviene conocer

**El servidor no le cree al navegador.** El cliente manda qué producto y cuántas
unidades; el precio lo reconstruye el servidor leyendo el catálogo o la
variación. Un navegador manipulado no puede cambiar un precio: el precio escrito
solo se acepta en productos editables **y** de parte de quien tenga el permiso,
saltear la guarda de precios sospechosos solo se lo permite al dueño, y una
variación que no sea de ese producto se rechaza. Nada de eso lo decide la
pantalla.

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

La cola se drena en tres momentos: después de cada venta, cada diez minutos por
la tarea programada, y cuando el dueño toca «Sincronizar ahora» en la pantalla
de **Sincronización**. Ahí también se ve qué está esperando, con qué error falló
y se puede devolver a la cola lo que agotó los seis reintentos.

---

## Cobrar en dólares

El local vende iPhones usados y cobra parte en billetes verdes. **Los dólares
tienen su propio cajón**, aparte del de pesos, y su saldo está en **centavos de
dólar**: son billetes, y guardarlos convertidos haría que el saldo se mueva solo
cada vez que cambia la cotización, sin que entre ni salga un dólar.

En la pantalla de cobro, «Dólares» pide el monto **en dólares** —es lo que el
cliente pone sobre el mostrador— y abajo dice a cuántos pesos equivale y con qué
cotización. Al revés sería pedirle a quien atiende que haga la cuenta de cabeza.

De cada pago en dólares se guardan **tres** números y no uno:

| | Qué es |
|---|---|
| `monto_centavos` | Lo que vale en pesos. Es lo que suma contra el total de la venta. |
| `monto_usd_centavos` | Los billetes que entraron. Es lo que mueve el cajón verde. |
| `cotizacion_centavos` | El dólar de ese momento, congelado. |

Son tres hechos distintos, y guardar solo el primero los pierde: el día que se
mueve la cotización ya no hay forma de saber cuántos billetes habían entrado. Un
check en `sale_payments` ata los tres al medio de pago, para que un cobro en
dólares sin el dato no pueda quedar registrado como un pago en pesos cualquiera.

**Un error que estuvo escrito y nunca se ejecutó.** `dolares` existía como medio
de pago desde la fase 1 —en el enum, en el tipo y en el dominio— pero nunca
llegó a la pantalla de cobro, así que nadie lo usó. Y `tipoDeCuentaPara` lo
mandaba a la cuenta de **efectivo**: mil dólares se habrían sumado al cajón de
pesos como mil pesos. Estaba a un botón de distancia de descuadrar la caja.

---

## Mostrador y tienda: dos precios, un solo número

En la tienda online cobra Mercado Pago y esa comisión no la paga el mostrador,
así que el mismo producto vale distinto en cada lado: unos auriculares de
$50.000 en el local salen $56.000 en la web.

Para no tener dos números que mantener sincronizados por producto, **el que se
guarda es el de la tienda**: la web cobra exactamente lo que dice esa ficha, y
el POS le descuenta el recargo para llegar al de mostrador. En **Precios**
(`F8`) se ve la diferencia producto por producto y se decide el porcentaje.

El catálogo se **carga** en WooCommerce, pero el precio ya no se corrige solo
desde ahí: desde el mostrador también se puede, y eso se cuenta en
[Corregir el precio desde el mostrador](#corregir-el-precio-desde-el-mostrador).

Tres cosas que el cálculo respeta:

- **Lo que no se publica no lleva recargo.** Servicios, chips y todo lo que esté
  en «Solo mostrador» (D19) o esté oculto en Woo no se vende por la web: su
  precio de ficha ya es el de mostrador y se usa tal cual.
- **Se puede escribir un precio de mostrador propio** cuando el porcentaje no
  aplica: una promo del local, un producto que hay que igualar a la competencia.
  Vaciar el campo lo devuelve al cálculo.
- **Se redondea a los cien pesos.** Dividir da números como $11.607,14 y en el
  mostrador nadie cobra eso.

**Un producto cargado desde el POS es la excepción, y conviene saberlo.** El
precio que se escribe en el alta rápida queda como su precio de mostrador
propio: no lleva recargo —todavía no está en la tienda— y, si después se
publica, **la sincronización no se lo pisa nunca**. Eso es lo correcto para lo
que el alta rápida resuelve: un producto que aparece en el mostrador y hay que
vender ahora. Pero significa que ese precio lo cambia una persona, desde
**Precios**, y no WooCommerce. Mientras el catálogo se cargue en Woo —que es
como se decidió trabajar— esto no aparece: el precio de mostrador de un producto
de la tienda sigue al de la tienda solo.

### La cuenta de la comisión

Si el medio de pago se queda con un `c%`, el recargo que hace falta **no es
`c%`**: la comisión se la lleva del total cobrado, no del precio de lista. Para
que quede lo mismo que en el mostrador hay que cobrar `precio ÷ (1 − c)`. Con
una comisión del 6,29%, el recargo es 6,71%, no 6,29%. La pantalla de Precios
tiene la calculadora: se pone la comisión del panel de Mercado Pago y devuelve
el recargo exacto.

### Buscar una venta de otro día

**Ventas** (`F4`) arranca en **hoy** y tiene los mismos períodos de un clic que
Reportes —ayer, últimos 7 días, este mes, mes pasado— más un rango escrito a
mano. Antes mostraba solo el turno abierto, y lo que se pregunta en el mostrador
es «la venta del iPhone de la semana pasada»: un turno es una unidad de caja, no
de calendario.

De cada venta se puede **volver a imprimir el comprobante**, mandarlo por
WhatsApp, y ver si quedó plata para devolver. La pantalla abre también con la
caja cerrada: mirar lo de ayer a la mañana, antes de abrir, es justo cuando se
mira.

**Anular o devolver, según el turno.** Una venta del turno abierto se anula. Una
de un turno ya cerrado no: la plata volvió a aquel cajón y revertir contra una
caja cerrada dejaría dos arqueos mal (D29). Para esas, la fila ofrece
**devolver**, que sale del cajón de hoy y el arqueo lo explica. El servidor lo
rechaza igual; no ofrecer el botón evita el clic que falla.

### El comprobante

Una hoja **A4**, una sola copia, la del cliente. Reemplazó al ticket de
impresora térmica: el local vende iPhones de mil quinientos dólares en cuotas y
el cliente se lleva un papel que firma — una tira de 80 mm no sirve para eso. Lo
que pasó queda en el sistema, que es mejor archivo que una hoja en un cajón.

Lleva el logo, los datos del local, el número de comprobante, el cliente con su
DNI, lo vendido con su importe, el total, el plan de cuotas si lo hay, la
garantía y dos renglones para firmar. **No es una factura** y el pie lo dice
(D2).

Tres reglas sobre qué sale impreso, las tres pedidas por el local:

- **El precio del sistema, en su moneda.** Un iPhone se pacta en dólares y el
  papel dice dólares (D62). Nada de conversiones: el cliente firma el número que
  acordó, no el que da el dólar de hoy. Un carrito mezclado, o cualquier venta
  con descuento, sale en pesos — restar un descuento cargado en pesos de un
  precio en dólares exigiría convertir, que es justo lo que no se hace acá.
- **Los medios de pago no se imprimen.** Cómo se compuso el pago es asunto
  interno; en el papel va lo que entregó y lo que queda debiendo. Con cuotas, va
  además cada vencimiento con su monto: sin eso el cliente no sabe cuándo tiene
  que volver, y la fecha la discute cada uno de memoria.
- **Quién atendió tampoco.** Está en el sistema, que es donde se consulta.

El plazo de garantía queda **en blanco a propósito**, con una raya para
escribirlo a mano: cambia según el producto y lo completan en el mostrador.

---

## Clientes y fiado

El fiado vive hoy en una libreta de papel y, en el POS viejo, cargado como si
fuera un producto: es la mitad del 58% de facturación sin producto real (D24).
Acá pasa a ser lo que es, **un saldo por cliente con su historia**.

En **Fiado** (`F5`) se ve quién debe, cuánto y desde cuándo, se recibe un pago y
se ve si hay plata para devolverle a alguien;
la plata entra a la caja del turno igual que una venta, así que el arqueo sigue
cerrando. En la ficha de cada cliente están sus movimientos —lo que se le fió y
lo que pagó, junto— y dos cosas más: el tope de fiado y la carga de la ficha de
papel.

Las reglas están en la transacción, no en la pantalla:

- **Fiar y cobrar son del vendedor.** Al principio fiar era del dueño —dar
  crédito no parecía una decisión de mostrador—, y en la primera semana de uso
  real se vio el costo: el fiado es el corazón del negocio, y mandar al cliente
  a esperar a que llegue Lucas es exactamente lo que hacía que se siguiera
  usando la libreta. Lo que protege no es el permiso sino el **tope por
  cliente**, que lo pone el dueño y el servidor lo hace cumplir.
- **No se fía sin cliente.** El botón está apagado hasta elegir uno.
- **El tope se comprueba contra la deuda de ese instante**, no contra la que
  había cuando se abrió la pantalla. La pantalla avisa antes de confirmar; el
  servidor lo frena igual si se intenta.
- **El saldo nunca queda negativo.** Cobrar de más se rechaza: si el cliente
  pagó de más eso es un vuelto, no un saldo a favor.
- **Anular una venta fiada le saca la deuda al cliente**, y como mucho lo que
  todavía debe. Si ya había pagado parte, esa plata quedó en la caja y el
  cliente no se llevó nada: el sistema la anota como **devolución pendiente** y
  la reclama en la fila de la venta, en la lista de fiado y arriba de la ficha
  del cliente, hasta que alguien marca que se la devolvió. No saca el efectivo
  del cajón solo —eso puede pasar en otro turno y por otro medio del que
  entró—, pero no deja que se olvide.
- **Los cobros son inmutables y llevan clave de idempotencia**: reintentar el
  formulario no cobra dos veces.

### La libreta de papel

Cada cliente puede recibir una vez el saldo que dice la libreta, sin venta
detrás, y queda marcado como «de la libreta» para poder distinguirlo después de
lo que nació en el sistema. Se ofrece solo mientras el cliente no tenga
movimientos: sumar dos veces la misma deuda es el error que hay que evitar, y el
dominio también lo rechaza.

### Fiar en cuotas

El fiado de $5.000 del vecino no necesita fechas: debe una cifra, paga cuando
pasa, listo. Un celular de $400.000 en seis pagos sí, y la diferencia no es
cosmética: **sin fechas nadie sabe quién está atrasado**, y el recordatorio de
WhatsApp le termina diciendo lo mismo al que paga puntual que al que debe desde
marzo.

Al cobrar, si algo se fía, la pantalla pregunta **cómo lo va a pagar**:

| Opción | Qué hace |
|---|---|
| **Cuando pueda** (la que viene puesta) | Queda como saldo abierto, sin fechas. Es el fiado de siempre |
| **Cada semana / cada 15 días / cada mes / cada N días** | Arma las cuotas y muestra cuánto es cada una y cuándo vence la primera y la última |

Tres decisiones que conviene conocer:

- **El plan no reemplaza al saldo, lo explica.** La deuda sigue siendo una
  cifra, y el tope, el cobro y la anulación funcionan igual. Las cuotas dicen
  *cuándo* se espera cada parte.
- **La primera vence una frecuencia después de la compra**, no el mismo día. Y
  las mensuales van por calendario: si compró un 5, paga los 5.
- **«Cada N días» existe porque el fiado se pacta en el momento.** Las tres
  frecuencias con nombre son atajos y cubren casi todo, pero el mostrador
  acuerda «cada tres días» con el que cobra por semana y «cada dos meses» con el
  del aguinaldo. Con un menú de tres, quien vendía elegía la que menos mentía y
  arreglaba el resto de palabra — justo lo que el sistema vino a sacar del
  cuaderno. Va de 1 a 365 días.

  **«Cada mes» no es un atajo de 30 días y por eso sigue aparte.** Va por
  calendario. Escrito como 30 días, en un año se le corre casi una semana y el
  cliente deja de reconocer su fecha. Un check en la base ata el número a «cada
  N días» y se lo prohíbe a los otros tres: un «mensual» con un 30 al lado
  invita a que alguien lo lea y le crea.
- **Un pago se imputa a la cuota más vieja primero**, que es lo que hace
  cualquiera con una libreta. Lo que sobre después de cubrirlas todas queda como
  saldo a cuenta y no se le inventa una cuota a nadie.

Anular la venta apaga el plan, pero no lo borra: las cuotas que el cliente llegó
a pagar tienen su imputación apuntando a ellas (D29).

### Lo que se vende en dólares se debe en dólares

Un iPhone se pacta en dólares, y el papel que el cliente firma dice dólares. Si
la deuda se guardaba en los pesos del día de la venta, el que volvía un mes
después con el dólar más caro **debía menos de lo que firmó**: las cuotas en
pesos se le cancelaban antes y el sistema le decía «pagaste todo» cuando
faltaban doscientos dólares. Al revés, con el dólar más barato, le estábamos
cobrando de más. Por eso la deuda es en dólares de verdad.

La moneda la decide la venta, no quien cobra:

- **Si todo el carrito está cotizado en dólares**, el saldo fiado queda en
  dólares y las cuotas también.
- **Cualquier otra venta queda en pesos. Siempre.** Un carrito mezclado —un
  iPhone y una funda— también: no hay forma de partir una deuda sola en dos
  monedas sin inventar cuál parte es cuál, y el iPhone en cuotas es el caso que
  esto vino a resolver, no la excepción rara.

Las dos deudas conviven en la misma cuenta y **nunca se suman**:
`credit_accounts` lleva `saldo_centavos` y `saldo_usd_centavos` por separado.
Sumarlas daría un número que no es plata de nadie, y convertirlas para mostrar
un total obligaría a congelar una cotización que cambia cada dos horas. La
pantalla de Fiado muestra los dos totales uno debajo del otro, la tarjeta del
cliente muestra las dos deudas con su signo, y el semáforo es **uno por moneda**:
un plan en dólares y otro en pesos son dos planes con dos vencimientos.

Al cobrar, la tarjeta pregunta **de qué deuda se trata** —solo cuando el cliente
debe en las dos— y acepta cualquier medio, porque el cliente paga con lo que
tiene: billetes de dólar, pesos, transferencia o cheque, para cualquier producto.
Lo que se imputa a la deuda y lo que entra a la caja son **dos números
distintos**:

| El cliente debe | Y paga con | Se le descuentan | A la caja entran |
|---|---|---|---|
| US$ 200 | billetes de dólar | US$ 200 | US$ 200, al cajón de dólares |
| US$ 137 | transferencia | US$ 137 | $215.227 al banco, con la cotización del día |
| $100.000 | billetes de dólar | $100.000 | los dólares que valgan, al cajón verde |

Tres cosas que sostienen eso:

- **La conversión no redondea al millar.** `usdAPesos` redondea porque un precio
  de vidriera no lleva centavos; una deuda sí. US$ 137 a $1.571 son **$215.227
  exactos** y no $215.000: redondear a favor del local es cobrar de más y a
  favor del cliente es regalar, doscientas veces por año y sin que nadie lo vea.
  Para eso están `usdAPesosExacto` y `pesosAUsdExacto`.
- **Un pago en dólares no cancela una cuota en pesos.** La imputación filtra por
  moneda. Sin ese filtro, cobrar US$ 100 encuentra la cuota en pesos más vieja
  —que para la aritmética es «10.000 centavos»— y la marca pagada: la deuda en
  pesos se borra sola y nadie se entera.
- **Sin cotización, cruzar de moneda se frena.** Pagar dólares con dólares o
  pesos con pesos no la necesita y nunca depende de ella; los demás casos sí, y
  la pantalla lo dice antes de cobrar en vez de dejar que falle con el cliente
  esperando.

**El tope de fiado mide la deuda en pesos**, que es la que el tope limita. Un
límite en pesos contra una deuda en dólares compararía dos cosas distintas, así
que una venta en dólares no lo mueve ni avisa de un tope que no se va a pasar.

**El cajón de dólares es una cuenta aparte y se lee como tal.** Su saldo está en
centavos de dólar, así que en **Cuentas** se escribe con `US$`, no entra en el
total de las cuentas en pesos —sumarlo daba un número que no es plata de nadie y
que cambiaba de sentido con cada movimiento del dólar— y **no se transfiere entre
pesos y dólares**: mover «5.000» de un lado al otro le saca US$ 50 a uno y le
pone $50 al otro, y deja los dos saldos despegados de sus movimientos. Cambiar
dólares por pesos es una venta de dólares, con su cotización y su resultado, no
una transferencia; el día que el local lo necesite se hace como tal.

### El semáforo de Fiado

Cada cliente es una tarjeta con color, y el color no decora: ordena a quién hay
que llamar hoy.

| Color | Qué significa | Qué dice el botón de WhatsApp |
|---|---|---|
| 🔴 Rojo | Tiene una cuota vencida sin pagar. Muestra cuántos días y cuánto | «Reclamarle la cuota vencida» |
| 🟡 Amarillo | La próxima vence hoy o dentro de tres días | «Avisarle que vence la cuota» |
| 🟢 Verde | Al día. Dice cuándo vence la próxima | «Recordarle la próxima cuota» |
| ⚪ Gris | Debe, pero sin plan: el fiado abierto | «Recordarle por WhatsApp» |

**Vencida se calcula, no se guarda.** Una cuota no cambia de estado sola a la
medianoche: se compara su vencimiento con hoy cada vez que se mira. Guardarlo
obligaría a una tarea que corra todas las noches y a que nadie se olvide de
mirarla.

Los tres mensajes son distintos y los tres se editan desde **Mensajes**: el que
se atrasó no tiene que leer lo mismo que el que tiene una cuota el viernes.
Ninguno de los dos reclama como un banco — el cliente que se incomoda no vuelve
a comprar.

---

## WhatsApp: comprobantes y recordatorios

El POS **arma el mensaje y abre el chat con el texto ya escrito**; quien aprieta
enviar es la persona. Es un enlace `wa.me` común: no hace falta cuenta de Meta
Business, ni plantillas aprobadas, ni pagar por conversación, y funciona hoy
desde la MacBook con WhatsApp Web o de escritorio.

La contrapartida es que el sistema no puede saber si el mensaje llegó, así que
**todo lo que se guarda dice «preparado» y nunca «enviado»**. Es la palabra
honesta: lo que el POS sabe es que armó el texto y abrió el chat.

Hay dos mensajes:

- **Comprobante de compra**, en cada venta del turno que tenga cliente con
  teléfono (`Ventas`, `F4`).
- **Recordatorio de deuda**, en la lista de fiado y en la ficha del cliente.

Los textos los escribe el dueño en **Mensajes**, no el programador: es la voz
del local. Se ve el mensaje armado con datos de ejemplo mientras se escribe, y
un `{campo}` inventado se rechaza al guardar —no al mandar, cuando el cliente ya
leyó «Hola {clientee}»—.

### Dos cosas que hacen la diferencia

**El recordatorio tiene freno.** A la misma persona se le puede recordar la
deuda una vez cada tantos días (siete por defecto, configurable). Antes de ese
plazo el botón pide confirmación en vez de abrir el chat. Quien recibe tres
mensajes en una semana no paga antes: deja de comprar.

**El enlace es un enlace de verdad**, no un botón que espera al servidor y
después abre una ventana: así el navegador la abre con el mismo clic de la
persona y Safari no la bloquea como pop-up. La constancia viaja por separado y
se arma de nuevo en el servidor, así que lo que queda guardado es el texto que
el sistema generó.

### El día que tengan que salir solos

La pieza que cambia es una sola: cómo se entrega el texto (`src/whatsapp/enlace.ts`).
El texto, a quién, cuándo y con qué control de repetición ya está resuelto en
`src/whatsapp/mensajes.ts`. Recién ahí hará falta la Cloud API de Meta, con su
cuenta de negocio, sus plantillas aprobadas y su costo por conversación.

---

## Gastos y cuentas monetarias

Hasta la fase 6 el POS sabía todo lo que entraba y **nada de lo que salía**, así
que el arqueo cerraba de casualidad: el alquiler, el flete y lo que se le paga
al técnico salen del mismo cajón que las ventas, y si no se registran el conteo
de la noche siempre da de menos y nadie sabe por qué.

En **Gastos** (`F6`) se carga lo que se paga, con su categoría, a
quién y de qué cuenta salió. Tres reglas, todas en la transacción:

- **Un gasto pagado mueve plata en el mismo momento en que se registra.** Sale
  de una cuenta concreta y, si esa cuenta es el cajón del turno, el arqueo lo
  descuenta y lo muestra como salida. No hay gasto pagado sin cuenta: lo impide
  la restricción `expenses_pagado_ck` en la base, no solo el formulario.
- **Un gasto pendiente no mueve nada.** Es una factura que llegó y todavía no se
  pagó. Aparece en «falta pagar» con su vencimiento, y si se pasa de fecha lo
  reclama la pantalla de inicio. Al pagarlo recién ahí sale la plata.
- **Anular es poner el asiento contrario, no borrar.** La plata vuelve a la
  cuenta de donde salió y el gasto queda anulado con el motivo, igual que una
  venta (D29). Un gasto cargado y anulado en el mismo turno deja el arqueo como
  estaba: las salidas van netas de anulación.

### Dónde está la plata

En **Cuentas** están los saldos del cajón, el banco y Mercado
Pago, con el extracto de cada uno y el saldo que quedaba después de cada
movimiento.

Ahí también se pasa plata de una cuenta a otra, que es lo que pasa al depositar
la recaudación: **la plata no entra ni sale del negocio, cambia de lugar**. Van
dos asientos en la misma transacción, uno por cuenta, así que el total no se
mueve; si se registrara uno solo, el negocio parecería haber ganado o perdido
plata sin vender ni gastar nada. Si sale del cajón, el arqueo del turno la
descuenta.

El saldo de cada cuenta es una caché de la suma de sus movimientos. Si alguna
vez se despegan, la pantalla lo dice en rojo y **manda el movimiento**.

### Lo que no hace todavía

Una compra a proveedores se registra como lo que es del lado de la plata, pero
**no ingresa stock**: el ingreso de mercadería no existe en ninguna parte del
POS —el stock viene de WooCommerce— y es su propia funcionalidad. El esquema ya
tiene la tabla (`expense_items`) para cuando llegue. Los gastos recurrentes
(`recurring_expenses`) tampoco se generan solos todavía.

---

## Caja: el cierre del turno

**El arqueo se sacó.** El local no cuenta los billetes, así que cerrar el turno
es confirmar: el sistema anota hasta cuándo duró, quién lo cerró y una nota
opcional, y lleva al reporte del turno.

Lo que **no** se hizo fue dejar el conteo como opcional, y conviene decir por
qué. Un arqueo que está pero nadie hace es peor que no tenerlo: la columna se
llena de ceros y después alguien los lee como si significaran algo. Es
literalmente lo que la auditoría encontró en el POS viejo —*el efectivo contado
figuraba siempre en cero*— y no se sabía si era un arqueo perfecto o ninguno.

Por eso, cuando no se cuenta, **contado y diferencia quedan en `null`, no en
cero**: en la base, en el reporte del turno y en la lista de cierres. «Se contó
y dio justo» y «no se contó» son cosas distintas y se ven distintas. Los cierres
viejos, que sí tienen arqueo, siguen mostrándolo completo.

- **Un turno abierto más de catorce horas se reclama en pantalla.** La auditoría
  encontró sesiones abiertas días enteros: una caja que nunca cierra no tiene
  reporte de nada.
- **Las ventas cobradas sin conexión siguen frenando el cierre.** No es por el
  arqueo: son ventas que todavía no entraron, y cerrar ahora las deja colgando
  de un turno que ya cerró.
- **La maquinaria del arqueo quedó entera.** `cerrarCaja` sigue aceptando un
  conteo, el reporte sabe mostrarlo y los tests lo cubren. El día que quieran
  volver a contar, es volver a poner el formulario.

**Lo que se pierde, dicho claro:** el arqueo era lo único que detectaba un
vuelto mal dado o una venta en efectivo cargada como transferencia. Sin él, esa
plata se va sin dejar rastro. Fue una decisión del local, no un descuido.

### El reporte del turno

Cerrar lleva directo a `/caja/[id]`, la hoja del turno: ventas, unidades,
facturado, el detalle completo (apertura, lo que entró por cada medio, los
gastos y las salidas, y cuánto debería quedar en el cajón), los gastos pagados
en el turno y las ventas anuladas. En los turnos viejos que sí tienen arqueo se
muestran además el contado, la diferencia y con qué billetes se contó, y **la
justificación va en el cuerpo, no en un `title`**: un tooltip que solo aparece
pasando el mouse no existe para quien lo lee en una tablet ni para quien lo
imprime.

Se imprime desde el mismo botón —`@media print` le saca la barra, la navegación
y los botones, y pasa todo a tinta sobre blanco—, que es la hoja que se cuelga
en la carpeta del mes.

**El reporte se recalcula, no se congela.** Los números salen de los mismos
asientos que movieron la plata, así que el turno de hace un mes dice hoy lo mismo
que decía al cerrarlo. Se puede porque una venta solo se anula dentro del turno
abierto (D29): un turno cerrado ya no cambia.

Si el esperado da negativo, el reporte lo dice con todas las letras: no es un
error de las ventas, es un turno que se abrió declarando menos plata de la que
había en el cajón.

---

## Cargar productos: de a uno, con ayuda, o una entrega entera

Hasta acá el catálogo entraba **solo** por WooCommerce, y eso dejaba al
mostrador sin salida justo cuando más lo necesitaba: llega mercadería nueva, o
alguien pide un servicio que no está catalogado, y como ninguna línea de venta
puede existir sin un producto real (D24) **la venta se traba**. La alternativa
era abrir WooCommerce desde el celular con el cliente esperando.

Ahora, cuando el buscador de la venta no encuentra nada, ofrece cargarlo, con lo
que ya se escribió puesto en el formulario. Lo puede hacer **el vendedor**: es
quien está en el mostrador cuando falta el producto, y el permiso
`producto.alta_rapida` ya se lo daba desde la fase 1.

El alta pide lo que quien atiende tiene en la cabeza —qué es, cuánto sale,
cuántos hay— y resuelve sola el resto:

- **El SKU se arma siguiendo la convención del catálogo**: `CAB-FOXB-CABLEUSBTI`,
  igual que `ALM-HIKS-PENDRI32G`. Si choca con uno existente le agrega un
  número, que es lo que hizo a mano quien cargó `CAR-FOX-FOX-2`.
- **Las anotaciones internas salen del nombre.** El catálogo real tiene títulos
  publicados como `iPhone 13 128gb 86% (54265) (Rec en enero $290, hoy a $250)`:
  precios de compra, nombres de clientes y márgenes. Al cargar se separan y
  quedan en la bitácora, no en el título.
- **Un nombre repetido se frena.** Casi siempre es alguien cargando de nuevo
  algo que no supo encontrar, así que se le dice cuál es en vez de duplicarlo.

### Antes de cargar, qué parecido ya existe

Mientras se escribe el nombre, la pantalla busca en el catálogo y muestra lo que
se le parece. El duplicado nace justo ahí: con el cliente esperando, alguien
carga «Funda iPhone 15» sin saber que la ficha ya está con otro nombre, o que la
cargó el otro vendedor hace media hora. Después hay dos fichas, dos stocks, y
ninguno dice la verdad.

Tres decisiones:

- **Es un aviso, no una traba.** Puede haber dos productos parecidos de verdad
  —un vidrio común y uno 9D— y frenar el alta con el cliente enfrente sería peor
  que el duplicado.
- **También muestra los inactivos**, marcados. Es el duplicado más traicionero:
  no aparece en la búsqueda de la venta, así que parece que no existe, y
  reactivarlo es más barato que crear otro. Por eso `buscarParecidos` es una
  consulta aparte y no reusa la de la venta, que filtra por `activo`.
- **Desde tres letras y con 250 ms de espera.** Con dos coincide medio catálogo,
  y consultar por tecla es ruido para el servidor y para quien mira.

Va pegado al campo del nombre y no al final del formulario: el momento de darse
cuenta es mientras se escribe, no después de haber completado precio y stock.

### Si ya está, se le suman unidades

Encontrar que el producto ya existe sirve de poco si el camino para usarlo es
más largo que cargarlo de nuevo: con el cliente esperando, el camino corto
vuelve a ser la ficha nueva. Así que el aviso trae el control al lado — cuántas
entraron, «Sumar al stock», listo — y si la ficha estaba inactiva, un botón para
volver a ponerla a la venta.

**Lo que hace que esto sea correcto y no solo cómodo:** la entrada se encola
hacia WooCommerce igual que el ajuste de una venta. La sincronización del
catálogo escribe `stock: excluded.stock`, o sea que el stock de Woo **pisa** el
del POS; sin avisarle a la tienda, las unidades que entraron hoy desaparecen en
el próximo `woo:sync` y el mostrador vuelve a vender lo que no tiene. Hay un
test que falla si se saca ese encolado.

La operación de cola es propia (`stock.empujar`) y no la de la venta: esa
termina marcando `sales.synced_to_woo`, y acá no hay ninguna venta que marcar.
Tampoco registra conflicto cuando los números difieren, porque difieren siempre
—es su condición normal— y anotarlo llenaría de ruido la tabla que se mira para
encontrar los conflictos de verdad.

El `FOR UPDATE` sobre el producto no es decorativo: dos personas pueden estar
cargando la misma entrega en dos pantallas, y sin candado la segunda escritura
se come la primera.

### Buscar en el catálogo

La pantalla de **Catálogo** servía para ver lo que está mal cargado, y para
encontrar *un* producto no servía: había que mirarlo a ojo en una lista de
sesenta fichas ordenadas por gravedad. Ahora arranca con un buscador, por nombre,
SKU o marca, que **también muestra los inactivos** —son los que no aparecen al
vender y hacen creer que el producto no está—. Desde cada resultado se le suman
unidades y se le corrige el precio, y lo que no está lleva derecho a cargarlo
con el nombre ya escrito.

El precio que se lista es el **de mostrador**, no el de la ficha. Parece un
detalle y no lo es: la ficha guarda el de la tienda, así que con el recargo del
12% puesto el buscador mostraba $56.000 en un producto que el local cobra
$50.000.

### Corregir el precio desde el mostrador

Fue lo primero que pidieron los vendedores al probar el sistema: *«que podamos
editar un precio antes de venderlo, por las dudas algo tenga precio viejo»*.
Llega mercadería con aumento y la ficha queda vieja. Hasta acá la salida era
escribir el precio en la venta —que arregla **esa** venta y ninguna de las
siguientes— o abrir WordPress con el cliente enfrente, que es lo que este
sistema vino a sacar.

Ahora, al lado de cada producto del buscador y del aviso de duplicados, hay un
«Cambiar precio». Arranca cerrado a propósito: la mayoría de las veces el
precio está bien, y un campo editable al lado de cada fila invita a tocarlo sin
querer.

Tres cosas que lo hacen correcto y no solo cómodo:

- **Se escribe el precio de mostrador**, que es el que quien atiende tiene en la
  cabeza, y se guarda el de la tienda. La cuenta del recargo la hace el
  servidor con `precioDeTienda`, la inversa exacta de la que usa la venta. Hay
  un test que escribe un precio, lo vuelve a leer por el camino de la venta y
  exige el mismo número: si la ida y la vuelta no cierran, el cajero escribe
  $15.000 y cobra $14.900.
- **Se limpia el precio de mostrador propio**, si lo tenía. Ese campo pisa el
  cálculo, así que dejarlo puesto haría que el precio recién escrito no se
  cobre: se cambia el número, la venta sigue saliendo el viejo y nadie entiende
  por qué. Si hacía falta una excepción, se vuelve a poner desde **Precios**, a
  sabiendas.
- **Se empuja a WooCommerce** (`precio.empujar`), por la misma razón que el
  stock y con una consecuencia más cara: si el precio nuevo no llega a la web,
  la tienda sigue cobrando el viejo —plata que se pierde en cada pedido— y
  encima la próxima sincronización devuelve la ficha al precio anterior, porque
  el espejo copia lo que dice Woo. Lo que viaja se lee de la base al drenar y no
  del payload, así que dos cambios seguidos terminan los dos en el último
  precio, que es el correcto.

El permiso es el del alta rápida (`producto.alta_rapida`), no `producto.editar`:
quien puede crear una ficha con el precio que quiera ya puede poner cualquier
número, así que pedirle más para corregir uno existente solo lo empujaría a
cargar un duplicado, que es justo lo que el aviso vino a evitar. Todo cambio
queda en la bitácora con el precio anterior, el nuevo y quién lo hizo.

### Nace de mostrador, se publica aparte

Lo que se carga acá queda con `wooId` en nulo y marcado como **Solo mostrador**
(D19): se vende en el local en el acto, sin red de por medio, y **no sale a la
tienda online**. Publicarlo es un segundo acto, desde el catálogo, y va por la
misma cola que el stock de las ventas.

No es exceso de prudencia. Publicar como borrador —que sería lo intuitivo— no
sirve: la sincronización traduce el `status` de WooCommerce a `activo`, así que
un borrador volvería de la próxima sincronización como producto **inactivo** y
desaparecería del mostrador que lo creó.

El catálogo lista lo cargado a las apuradas bajo **Cargados en el mostrador**.
Es la contrapartida del alta rápida: sin esa lista, «rápida» querría decir «a
medias y para siempre», que es exactamente como el catálogo llegó a tener 93
productos sin SKU.

### La ayuda para armar la ficha (opcional)

Con `ANTHROPIC_API_KEY` cargada aparece un renglón para tirar lo que uno
escribiría apurado —`cable tipo c fox box axon 20w`— y que el sistema proponga
nombre, marca y categoría. **Se muestra, no se aplica solo**: nadie quiere ver
cómo le reescriben lo que estaba tipeando.

Cuatro límites, y los cuatro importan:

- **Nunca propone precio ni stock.** Un precio inventado se cobra. Eso lo sabe
  quien está atendiendo.
- **Nunca propone una foto** (D15). Una imagen inventada de un SKU real produce
  reclamos, devoluciones y contracargos, y bloquea el catálogo en Google
  Merchant Center y Meta Commerce.
- **Elige entre las categorías que ya existen**, o no elige. Lo que vuelve pasa
  igual por el filtro del catálogo: una categoría inventada se descarta y una
  marca escrita distinto se unifica con la que ya está, que es lo que evita
  terminar con «Fox Box», «FoxBox» y «fox box» como tres marcas.
- **Sin la variable, el alta funciona igual**, escrita a mano. Ninguna parte del
  POS depende de que esto ande.

### La entrega entera, de una vez

Cuando llega una entrega no llega un producto: llega una lista con treinta
renglones. **Cargar una entrega** la carga de una vez, en dos
pasos: primero muestra renglón por renglón qué va a pasar y recién después
escribe. Una carga que guarda y después avisa es una carga que hay que deshacer a
mano — y acá hay bajas.

**Un solo cuadro de texto para las dos formas de pegarla**, y el programa decide
cuál es. Elegir entre dos cuadros es una decisión más con el proveedor esperando,
y es una decisión que no hace falta que tome una persona: una planilla siempre
arranca con la fila de títulos.

#### La lista escrita a mano

Es lo que de verdad hay a mano cuando llega la mercadería. Un renglón por
producto, tal cual se escribe:

```
-Router TP-Link Archer C86 (5) $68.000 - 98.000
-Cable iphone usb tipo c a lightning Eco (4+)
-Memoria Kingston micro sd 128gb (eliminar)
-iPhone 15 Pro Max 256gb 88% (34985) - $1.038.500 - $1.154.750
```

Nombre, entre paréntesis cuántos llegaron, y después **el costo y el precio al
público, en ese orden**. Lo que el paréntesis puede decir son tres cosas, que un
humano distingue sin pensar y el programa también:

- **`(5)` o `(4+)`**: unidades. El `+` quiere decir «esas o más», que para
  cargar stock es lo mismo que el número.
- **`(34985)`**: cuatro dígitos o más no es una cantidad —el techo de una entrega
  son mil— sino el final de un IMEI. Son los usados: entran de a uno y el número
  **se queda en el nombre**, porque es lo único que distingue un iPhone 15 de
  otro iPhone 15.
- **`(eliminar)`**: baja.

Y la regla que más decide: **un renglón sin precios es uno que ya está en el
catálogo**, al que solo hay que sumarle lo que llegó. Es como se escribe la lista
cuando el precio no cambió: no se repite lo que ya se sabe.

#### Las tres cosas que la lista hace

| El renglón | Qué pasa |
|---|---|
| No está en el catálogo y trae precio | **Alta**, con su costo y su stock |
| Ya está en el catálogo | **Suma stock**, y el precio **no se toca** |
| Dice `(eliminar)` | **Baja**: sale del mostrador y de la tienda |

**El precio no se pisa nunca, aunque el renglón lo traiga.** Una lista de entrega
dice con qué costo llegó la mercadería, no qué hay que cobrar. Si el precio
cambió se cambia con «Cambiar precio», que avisa y queda en la bitácora. La
revisión lo dice renglón por renglón para que nadie se entere después.

**Una baja no borra nada.** La ficha está pegada a las ventas viejas, al stock
histórico y a la rentabilidad del mes pasado: borrarla es perder eso o romper las
referencias, y lo que se pidió es que el producto no se venda más, no que nunca
haya existido. Así que queda inactiva **y en WooCommerce pasa a borrador**. Eso
último es lo que la hace durar: la sincronización traduce el `status` de Woo a
`activo`, así que una baja solo local vuelve a estar activa en el próximo
`woo:sync` porque Woo sigue diciendo `publish`. Y se puede deshacer.

#### Cuándo se niega a adivinar

El nombre tiene que **coincidir exacto** —ignorando mayúsculas, acentos y
espacios de sobra, pero sin ignorar ninguna palabra— para sumar stock o para dar
de baja. Buscar por aproximación acá es dar de baja el producto equivocado, y eso
se descubre tarde. Si no hay coincidencia, o hay más de una, el renglón se marca
y lo dice: resolverlo a mano son veinte segundos.

Tampoco se adivina lo demás. Un renglón sin precios cuyo producto no existe
**no** se carga en $0 —un producto a cero se vende a cero y recién ahí se nota—,
un paréntesis que no se entiende no pasa como una unidad, y un precio en dólares
se frena en vez de tomarse por pesos: `u$s 718` leído como $718 carga un costo
mil veces más chico y arruina el margen sin que nada se vea raro.

#### La planilla de Excel

Sigue funcionando igual, en el mismo cuadro. Lee lo que salga de Excel: punto y
coma o coma, comillas, BOM, y los títulos de columna que use la planilla que
venga (`producto`, `rubro`, `importe`, `cantidad`…). Hacen falta `nombre` y
`precio`; el resto es opcional. **Da de alta, no pisa lo que ya está:** un SKU o
un nombre que ya existe se informa y se saltea.

---

## Reportes y planillas

Hasta acá los números vivían de a turno: el arqueo dice qué pasó ese día y nada
más, y para saber cómo viene el mes había que sumar cierres a mano.

**Reportes** (`F10`, solo el dueño) arranca por la pregunta que se hace primero
—cuánto vendí— y **cada número viene con el del período anterior al lado**,
porque «$180.000» no dice nada y «$180.000, 12% más que la semana pasada» sí. Se
elige el período de un clic —hoy, ayer, últimos 7 días, este mes, el mes pasado,
últimos 12 meses— o se escribe un rango a mano.

Lo que muestra, en ese orden: vendido, ventas, ticket promedio y unidades; lo
que se fio aparte, porque está facturado y esa plata no entró; vendido contra
gastos pagados; por medio de pago; por categoría; qué se vendió, **ordenado por
facturación y no por unidades** (veinte vidrios son más unidades que un celular
y mucha menos plata, y lo que hay que reponer primero es lo segundo); día por
día; y mes a mes, sumando el histórico que quedó del sistema anterior para poder
comparar con algo.

Los gráficos son barras en CSS. Sin librería: son quince filas y una barra es un
`div` con un ancho en porcentaje; una dependencia de 90 kB sería más código que
mantener y una pantalla más lenta en la tablet del mostrador.

### Tres reglas que valen para todos los números

- **Una venta anulada no existe.** Anular no inserta una venta negativa: marca
  la original como anulada (D29), así que no hay nada que restar en ninguna
  parte y una venta anulada no cuenta en ningún número de la pantalla.
- **El día es el del local, no el de UTC.** Una venta de las 22:30 es del día en
  que se hizo aunque en UTC ya sea mañana. Sin eso, la última hora de cada día
  se cuenta en el día siguiente y ningún reporte cierra contra la caja. De paso
  se corrigió el mismo error, que estaba en el marcador de producto real.
- **Lo fiado se factura aunque no entre plata.** Cuenta como venta y se informa
  aparte, porque confundir las dos cosas es creer que entró plata que está en la
  libreta.

### Cuánto quedó

El costo se congela en cada línea de venta al confirmarla, así que una venta
vieja no cambia de margen porque hoy el proveedor cobre otra cosa.

Lo importante es lo que el reporte **dice de sí mismo**: informa sobre cuántas
de las unidades vendidas está hablando. Un margen calculado sobre una parte del
movimiento y presentado como «el margen del mes» es peor que no tener el número.

Para que haya margen hace falta cargar el costo, y por eso esta fase lo agregó
en dos lugares: el campo *«cuánto te costó»* del alta de productos y la columna
**costo** de la planilla de importación. Antes no existía ninguna forma de
cargarlo y el panel habría nacido vacío para siempre.

### Las planillas

Tres, del período elegido, que se bajan de un clic:

| Planilla | Una fila por | Para qué |
|---|---|---|
| **Ventas** | venta | Es lo que se le manda al contador. Las anuladas van marcadas y con el motivo: esconderlas haría que los números no se puedan conciliar con los de ningún otro lado. |
| **Productos vendidos** | producto vendido | Con esto se arma cualquier análisis que el POS no traiga hecho, sin pedir una pantalla nueva. Trae costo y ganancia por renglón. |
| **Gastos** | gasto | Lo que salió, con categoría, beneficiario y cuenta. |

Salen en el dialecto que Excel en castellano abre bien haciendo doble clic:
**punto y coma**, **BOM** —sin él los acentos salen rotos— y **decimales con
coma**, porque con el punto Excel lo toma como texto y no se puede sumar la
columna, que es lo primero que hace cualquiera que abre esto. Es el mismo
dialecto que lee la importación de productos, así que lo que sale se puede
volver a cargar; hay un test que lo comprueba.

Donde no hay costo cargado, la ganancia queda **vacía y no en cero**: cero sería
decir que no se ganó nada, y lo que pasa es que no se sabe.

La descarga es una ruta con `Content-Disposition` y no una acción de servidor:
un `<a href>` baja el archivo sin una línea de JavaScript, y además funciona con
«guardar enlace como».

---

## Devoluciones de ventas de otro turno

Anular es para el error de carga y solo dentro del turno abierto: revertir
contra una caja cerrada descuadra dos arqueos, el de aquel día y el de hoy.
Pero el cliente que vuelve el jueves con el cargador que no anda es real, y
hasta acá el sistema no tenía nada para él.

**Devoluciones** (solo el dueño) resuelve eso, y la diferencia con anular es lo
que sostiene todo el diseño:

- **La venta original no se toca.** Se hizo, se cobró y quedó en el arqueo de
  aquel turno. Sigue exactamente como estaba, y ese arqueo no cambia. La
  devolución es un documento aparte, con su propia numeración `DEV-T1-000001`.
- **El movimiento cae en el turno de hoy**, que es cuando la plata sale del
  cajón de verdad y cuando la mercadería vuelve al local.
- **Puede ser parcial**: de tres cosas se devuelve una, y de dos unidades una
  sola. Lo ya devuelto se descuenta, así que la misma unidad no vuelve dos
  veces.

Hay dos cosas que el sistema no puede decidir solo, y por eso pregunta:

**Si vuelve al stock.** Un cargador fallado no se vuelve a vender. Se decide
producto por producto, con una casilla por renglón.

**Si sale plata o baja la deuda.** Cuando el cliente todavía debe de esa misma
venta, devolverle efectivo y dejarle la deuda entera es equivocarse dos veces.
Lo que el formulario propone es descontar de la deuda primero y devolver el
resto, pero quien atiende puede escribir otro reparto. La base exige que las dos
partes sumen el total devuelto (`returns_suma_ck`): no hay forma de que quede
plata sin explicar.

El precio que se devuelve es el que **se cobró**, con el descuento global de
aquella venta ya prorrateado en el renglón. Devolver el precio de lista de algo
que salió con 20% de descuento es regalar la diferencia.

### Qué explica el arqueo

Que baje el efectivo no alcanza: si nada lo explica, al cerrar el turno falta
plata sin motivo y quien cuenta tiene que inventar una justificación. El
desglose de la caja y el reporte del turno tienen su propia línea, **«Devuelto
por ventas de otros turnos»**, separada de las anulaciones del día.

## El histórico del sistema anterior

El negocio no empezó con este POS: hay **3.764 pedidos** hechos con YITH desde
WooCommerce. Sin ellos el reporte mensual arranca el día que se instaló el
sistema nuevo y no sirve para comparar con nada.

```bash
npm run woo:historico -- --ensayo   # mira qué entraría, sin escribir
npm run woo:historico               # lo importa de verdad
```

Va como script de consola y no como pantalla a propósito: son varios minutos de
paginación contra un hosting que corta a los 30 segundos, una acción de servidor
se moriría en la mitad, y esto se corre una sola vez en la vida del sistema, con
alguien mirando.

Tres decisiones definen todo lo demás:

**El histórico no se mezcla con las ventas.** Va a `legacy_sales`, que es solo de
lectura y no toca stock, ni caja, ni numeración. Meterlos en `sales` sería
inventar 3.764 movimientos de stock que ya pasaron y 243 arqueos que nadie va a
cuadrar. Los reportes lo suman aparte, en **Mes a mes**.

**Se importa una vez y no se pisa.** `legacy_sales` bloquea el `UPDATE` y el
`DELETE` con un disparador, y tiene un índice único por `(origen,
referencia_externa)`. Volver a correrlo no duplica nada: lo que ya está se
saltea, y el informe de esa segunda corrida no cuenta como facturación nueva lo
que no escribió. Es la misma guarda que la migración de las fichas de papel,
donde sumar dos veces la misma deuda era el error a evitar.

**Lo que no se puede leer se cuenta y se informa.** El cliente de WooCommerce
descarta en silencio la fila que no cumple el esquema, y sobre 3.764 pedidos eso
es perder facturación sin que nadie se entere. El script compara lo leído contra
lo procesado y avisa fuerte si las cuentas no cierran.

Lo cancelado y lo reembolsado **no se importa**: no es facturación. Y cada
pedido viejo queda marcado según haya tenido un producto detrás o un ítem
genérico, que es de donde sale el dato del marcador de calidad: en el sistema
anterior más de la mitad de la facturación se cargaba sin producto.

---

## Vender sin internet

El POS es online: sin servidor no hay catálogo, no hay stock y no hay número de
venta. Pero en Villa Santa Rosa la conexión se corta, y lo que pasa de verdad
cuando se corta es que se vende igual y se anota en un papel. Un papel no
descuenta stock ni entra al arqueo.

La v1.1 no convierte el POS en una aplicación offline: resuelve exactamente eso
y nada más. Tres piezas.

**La pantalla abre sin servidor.** Un service worker guarda la última copia de
cada pantalla y la sirve cuando la red no contesta. Es lo primero que hay que
resolver: la tablet se recarga sola cada tanto, y sin esto aparece el dinosaurio
del navegador y se terminó el día. Las rutas de API nunca se guardan —una
respuesta vieja del buscador sería stock inventado— y las páginas van por red
primero, así que con internet se ve siempre lo de ahora.

**El plazo de cuatro segundos solo corre si hay una copia que mostrar.** Con la
red caída el pedido falla enseguida; el plazo está para la conexión que está pero
no anda —el módem sin internet—, donde el pedido queda colgado. Pero cuando la
pantalla nunca se abrió y no hay nada guardado, cortar a los cuatro segundos no
ahorra nada: cambia una pantalla que iba a cargar por un cartel que dice «Sin
conexión» cuando sí había. **Pasó en el mostrador**, la primera vez que se abrió
Fiado después de un despliegue: el servidor recién levantado y la base
despertándose tardaron cinco segundos, y el POS declaró que no había internet. Una
pantalla que tarda ocho segundos es mala; una que miente sobre por qué no cargó
hace que alguien salga a revisar el módem. Así que sin copia se espera a la red de
verdad, y el cartel aparece solo cuando el pedido falla. La respuesta que llega
tarde se guarda igual, para la próxima vez que no haya internet.

**El catálogo vive en la tablet.** Se baja entero al abrir la pantalla de venta
y se refresca cada diez minutos; son unos pocos cientos de kilobytes. Sin
conexión el buscador cae ahí, **con el mismo criterio de orden que usa el
servidor**. Eso no es un detalle estético: el lector de código de barras termina
con Enter y agrega el primer resultado, así que si offline el primero fuera otro,
el mismo gesto vendería otro producto y nadie lo notaría hasta el arqueo. Hay un
test que corre las dos búsquedas contra la misma base y compara el orden.

**La venta cobrada va a una cola**, con la misma clave de idempotencia que usa el
servidor, y **se guarda antes de intentar subirla**. Al revés —intentar primero,
guardar si falla— un error en el medio deja una venta cobrada que no existe en
ninguna parte. Cuando el servidor vuelve a contestar, la cola se sube sola, sin
que nadie toque nada; la misma clave garantiza que subirla dos veces no la cobre
dos veces.

### Las tres cosas que se pagan

Ninguna se puede evitar. Las tres se muestran en vez de esconderse.

**El comprobante sale sin número.** El correlativo lo asigna el servidor, y el
servidor no está. El ticket se imprime igual —el cliente se lleva su papel— con
un recuadro que dice `SIN CONEXIÓN` y que lo cobrado sí es definitivo, para que
nadie lo busque en el sistema y crea que se perdió.

**El stock puede quedar en negativo.** Sin conexión el POS no puede reservar
nada, así que dos ventas pueden llevarse la última unidad. Rechazar la venta al
subirla no devuelve el producto que el cliente ya se llevó: solo esconde que
faltan dos. Entra, el stock queda en el número que de verdad quedó, y la pantalla
avisa.

**El precio lo pone la pantalla.** Es la única excepción a que el servidor no le
crea al navegador, y no es por comodidad: sin catálogo que consultar, lo que se
cobró es el único dato que existe de esa venta. Recalcularlo al subirla
cambiaría lo que el cliente pagó y el cajón no cerraría. Lo que reemplaza a la
guarda es el **desvío**: cada venta diferida guarda cuánto se apartó del precio
de catálogo, y la lista de ventas lo muestra en el cuerpo, no en un tooltip.

### Lo que el arqueo dice

Dos cosas que sin decirlas dejarían a quien cuenta el cajón inventando
justificaciones:

- **El turno no se cierra con ventas esperando.** Esa plata está en el cajón y el
  sistema todavía no la cuenta, así que el efectivo esperado está mal justo en
  eso. La pantalla de caja lo frena y dice qué hacer.
- **El arqueo separa lo cobrado sin conexión.** Y si alguna se cobró antes de que
  este turno abriera —se cortó a las ocho, se cerró el turno a las nueve, volvió a
  las diez— lo dice aparte: esa plata entró a otro cajón, y la venta cae en el
  turno abierto porque es donde el sistema se enteró.

### Instalarlo en la tablet

El POS trae manifiesto, así que desde el navegador se puede «agregar a la
pantalla de inicio». Abre a pantalla completa y sin barra de navegador, que de
paso evita que alguien toque «atrás» en el medio de un cobro.

El service worker **no se registra en desarrollo**, a propósito: servir páginas
guardadas mientras se edita código es la forma más rápida de pasar una tarde
mirando una versión vieja de lo que uno acaba de cambiar.

---

## Dólares y calidad de datos

El proyecto nace de un error concreto: en agosto se cargaron nueve iPhones a
US$ 6.300 y se publicaron a $6.300. Unos $9,7 millones de diferencia en un mes.
Hay dos guardas contra eso, y hacen cosas distintas.

**La primera hace imposible el error de tipeo.** En un producto en dólares el
precio en pesos no se escribe: lo calcula el sistema con la cotización, en el
carrito y otra vez en el servidor al confirmar. No hay campo donde equivocarse.

**La segunda atrapa lo que la primera no ve**: un producto que *debería* estar
en dólares y quedó cargado en pesos con la cifra del dólar. Para el sistema es
un iPhone que vale $6.300 y no tiene nada de raro. Se detecta con un piso de
precio plausible por categoría (`src/ventas/cordura.ts`): un smartphone nuevo
por debajo de $50.000 no existe.

Esa segunda guarda **no bloquea de forma definitiva**: muestra el cartel y
ofrece dos salidas — volver a revisar, o cobrar igual, que solo puede el dueño y
queda auditado. Un piso mal puesto que impide vender sería peor que el error que
evita.

Y por la misma razón hay una lista de categorías sin piso: cables, fundas,
vidrios, cargadores. Apple vende cables de $13.000, y una alerta que grita por
eso es una alerta que se ignora.

### El tipo de cambio

**Lo trae el POS solo, cada dos horas**, del blue vendedor de Córdoba de
infodolar.com (`/api/cron/cotizacion`). Lo versiona y lo **congela en cada
venta**: cambiar el valor nunca recalcula una venta pasada. En `/cotizacion`
(`F9`) se ve el historial y se puede forzar uno a mano, con las mismas guardas
— banda de 100 a 500.000, y un salto mayor al 15% pide confirmación explícita.

Antes lo producía el plugin `lucas-cotizacion` (D22) y el POS solo lo espejaba.
El plugin dejó de contestar, y como nadie se entera de eso mirando la pantalla,
la cotización pasaba días sin moverse hasta que alguien se acordaba de cargarla.

#### Por qué no alcanzaba con el selector

El pedido vino con la clase ya identificada: `.colCompraVenta`. Aparece **32
veces** en esa página. La primera —la que agarra un selector suelto— es
**$1.499,38**, que es el dólar *oficial* y encima la columna de *compra*; el
blue vendedor del mismo día es **$1.571,00**. Setenta y dos pesos, el dólar
equivocado y la punta equivocada, y nadie lo nota mirando el número.

La página tiene dos tablas de promedio bien separadas, y la lectura se ancla en
la tabla y no en la clase:

```
<table id="Promedio">       → bancos y casas de cambio (el oficial)
<table id="BluePromedio">   → «Dólar Blue en Córdoba»   ← esta, celda 2 (Venta)
```

Además exige que la fila diga «blue» y «Córdoba», y rechaza una venta por
debajo de la compra, que es la señal de que las columnas se leyeron al revés.
El test usa la página real guardada como fixture, con la tabla señuelo adentro:
si alguien vuelve al selector suelto, fallan ocho pruebas.

#### Qué pasa cuando algo sale mal

Nunca se fuerza un valor. Si infodólar no contesta, cambia el diseño, trae un
dato de más de 24 horas o devuelve algo que no es un precio, **no se guarda
nada**: la cotización anterior sigue valiendo y la pantalla de Inicio avisa
cuando se pone vieja. Un salto mayor al 15% tampoco entra solo — se informa y
lo confirma una persona desde `F9`. Ante la duda, el dólar queda viejo y
visible, que es mucho mejor que nuevo e inventado.

Si la cotización tiene más de **6 horas**, el sistema avisa: son tres corridas
perdidas, suficiente para no gritar por una caída de un rato.

#### Lo que se reprecia solo

**El mostrador no necesita que nadie lo reprecie.** Un producto en dólares no
tiene el precio en pesos guardado: la venta lo calcula en el momento, `precio
USD × dólar` (ver `carrito.ts`). Apenas entra una cotización nueva, el mostrador
ya cobra bien sin tocar una sola ficha.

**La web sí.** WooCommerce guarda un número en pesos, y ese número lo
recalculaba el plugin caído. Sin hacer nada, el POS cobraría el precio nuevo y
la tienda seguiría publicando el viejo: con el dólar subiendo, se vende por la
web a pérdida. Así que la tarea recalcula el precio de ficha de cada producto en
dólares y lo manda a la tienda por la cola de siempre (`precio.empujar`).

Solo se toca lo que de verdad cambió, así que una corrida con el dólar quieto no
escribe una fila.

### Calidad del catálogo

`/catalogo` evalúa las fichas y las lista **ordenadas por gravedad, no por
cantidad**. Hay 781 fichas sin foto y una con precio sospechoso; la que hay que
mirar primero es la última. Separa lo que impide vender bien (precio sospechoso,
dólar incoherente, precio sin cargar) de lo que solo afea la ficha (sin SKU, sin
foto), y linkea a editar cada una en WooCommerce.

### El marcador de facturación con producto real

Es la métrica destacada en Inicio. El sistema nuevo da 100% por construcción
—`sale_items.product_id` es NOT NULL— así que el valor está en el contraste con
el histórico: el POS anterior venía en 30%, 33% y 39% de facturación con
producto real, contra una meta del 70%.

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

### Lo que se borró de la tienda

La corrida completa —y solo ella— **da de baja lo que ya no está en Woo**. Un
producto borrado definitivamente no aparece en ninguna listada, ni con
`status=any`, así que en el espejo se quedaba activo, con el precio y el stock
del día que se borró, y el mostrador lo podía seguir vendiendo. Pasó de verdad:
catorce fichas borradas seguían a la venta, con seiscientas variaciones
congeladas doce días atrás.

Se reconoce por la fecha: la corrida toca `last_synced_at` de todo lo que la
tienda devolvió, y lo que quedó con la fecha vieja es lo que no vino. Tres
resguardos:

- **Se desactiva, nunca se borra.** Las ventas viejas lo siguen nombrando.
- **Nada de esto pasa en el refresco incremental.** Ahí la ausencia no significa
  nada: el producto simplemente no cambió.
- **Si faltara más del 20% del catálogo no se da de baja nada** y se avisa por
  qué. Una tienda no pierde la mitad del catálogo de un día para el otro: eso es
  una corrida fallida, y un producto dado de baja por error es una venta que el
  mostrador no puede hacer.

### Un producto que dejó de ser variable

Pasar una ficha de «variable» a «simple» en WooCommerce **no borra sus
variaciones**: quedan colgando, invisibles desde la tienda. El espejo las seguía
mostrando en la pantalla de venta y ya no las refrescaba, porque solo se piden
las variaciones de los productos variables — o sea que se vendían al precio del
día en que el producto se aplanó. Pasó con quince fichas del catálogo real
(vidrios, hidrogeles y fundas) y sus seiscientas variaciones.

Ahora, cada corrida da de baja las variaciones de todo producto que la tienda
haya devuelto como no variable. Esto **no** se apoya en una ausencia sino en lo
que Woo dijo de cada ficha, así que vale igual en la corrida completa que en el
refresco incremental, y no necesita el techo del 20%.

Por lo mismo, `type` es el único campo de la ficha que **no** tiene valor por
defecto en el esquema (`src/woo/tipos.ts`): de él depende que un producto
conserve o pierda sus variaciones, y una respuesta que no lo trajera aplanaría
el catálogo entero en silencio. Sin `type`, la ficha se descarta y queda el
aviso en la consola.

De paso arma un informe de calidad de carga, que es la mitad del problema que
este sistema viene a resolver:

| Aviso | Qué encontró |
|---|---|
| `sin_precio` | Precio por debajo de $100. No es moneda: es precio sin cargar (hay 32 así). |
| `usd_incoherente` | El precio en pesos no se condice con el precio en dólares al TC vigente. **Es el error que en agosto costó ~$9,7 millones**: 9 iPhones cargados a US$ 6.300 leídos como $6.300. |
| `usd_sin_conversion` | Tiene precio en dólares pero el precio en pesos quedó vacío. |
| `stock_ficticio` | Más de 1.000 unidades. Hay fichas con 9.708. |
| `sin_sku` / `sin_imagen` | Ficha incompleta. |

### Refresco periódico, sin depender de la tienda

Cada diez minutos, junto con el drenaje de la cola, la tarea programada le pide
a WooCommerce **solo lo que cambió** desde la última corrida
(`src/woo/refrescar.ts`). Con 803 productos eso es casi siempre una consulta que
vuelve vacía, y un cambio de precio hecho en la tienda llega al mostrador en
menos de diez minutos sin que nadie toque nada.

Existe porque los webhooks no se pudieron dar de alta: el `curl` del servidor de
WordPress rechaza el certificado del POS —`EE certificate key too weak`, el
nivel de seguridad de OpenSSL del hosting contra un certificado ECDSA— y
WooCommerce ni siquiera deja guardar un webhook cuya URL no puede alcanzar. Así
que se da vuelta la dirección: en vez de que la tienda avise, el POS pregunta.

Tres cosas que conviene saber:

- **La marca de agua solo avanza si la corrida terminó.** Vive en `settings`,
  bajo `woo.ultimo_refresco`. Si el refresco se corta por tiempo, la ventana se
  vuelve a pedir entera: perder un cambio de precio es peor que pedirlo dos
  veces.
- **La ventana lleva seis horas de margen**, por si la tienda ignora
  `dates_are_gmt` y lee la fecha en el huso local (serían tres horas de
  corrimiento, justo en la dirección que deja productos afuera).
- **Un producto borrado definitivamente en Woo no aparece por acá.** Uno mandado
  a la papelera sí, porque cambia de estado. Desde una ventana de cambios no hay
  forma de distinguir «lo borraron» de «no lo tocaron», así que el borrado del
  todo lo resuelve `npm run woo:sync` (ver abajo).

La cola tiene prioridad sobre el refresco: si el drenaje se come la corrida, el
refresco se saltea y va en la siguiente. La cola es stock, el refresco son
precios.

### Webhooks (opcionales)

Si algún día el hosting deja de rechazar el certificado, los webhooks siguen
andando y traen el cambio en el momento en vez de en diez minutos. Configurar en
**WooCommerce → Ajustes → Avanzado → Webhooks**, apuntando a
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

## Cómo se ve: el sistema visual de la marca

Todas las pantallas están armadas sobre el diseño de marca de Lucas
Innovaciones. Los colores, los tamaños y la tipografía viven en un solo lugar
—`src/app/globals.css`— y las pantallas los usan siempre por nombre, nunca con
un color escrito a mano.

**Dos reglas explican toda la paleta.**

1. **El negro es la acción, el verde es la plata.** La acción principal de cada
   pantalla es negra (blanca en modo oscuro): «Ir a vender», «Recibir un pago»,
   «Cerrar el turno». El verde encendido queda reservado para el único botón que
   mueve plata de verdad —«Cobrar» en el carrito, «Cerrar caja» en el arqueo—,
   así no compite con nada y se encuentra sin leer.
2. **El color del estado no decora.** Verde, amarillo y rojo significan al día,
   por vencer y vencido, y nada más. Cada uno tiene su tinta (`--color-alerta`)
   y su fondo suave (`--color-alerta-fondo`); los avisos usan el fondo, sin
   borde de color, para que el que importa se vea de lejos.

**La tipografía.** Inter para leer e **Space Grotesk para las cifras**. La clase
`.cifra` —Space Grotesk, cifras tabulares, tracking apretado— se usa en el total
del carrito, en los totales del día y en la deuda de cada cliente: es el número
que se lee parado, de costado, con el cliente enfrente. Las dos fuentes se
sirven desde el propio dominio (`next/font/google`) porque la tablet del
mostrador trabaja sin conexión.

**La barra.** Negra en los dos modos, con las cinco secciones de todos los días
(Inicio, Vender, Caja, Ventas, Fiado) y un cajón «Más» donde viven las otras
ocho, agrupadas por para qué sirven: la plata, el catálogo y la atención. Las
teclas de función siguen funcionando para lo que está guardado en el cajón: F6
abre Gastos aunque Gastos no esté a la vista. Al lado del nombre del usuario, una
pastilla dice si la caja está abierta: es el dato que decide qué se puede hacer.

**El ícono** (`public/icono.svg`, `public/icono-maskable.svg`,
`src/app/icon.svg`) es el monograma LI dibujado con rectángulos y no con texto:
aparece a 28 px en la barra y a 512 en la pantalla de inicio de la tablet, y en
ninguno de los dos casos se puede depender de que la fuente esté instalada.

**Una trampa de Tailwind v4, anotada acá porque cuesta una tarde.** Un `@theme`
adentro de un `@media (prefers-color-scheme: dark)` **no funciona**: Tailwind lo
saca del `@media` y lo pega al final, así que la aplicación queda siempre
oscura. El modo oscuro redeclara las variables en un `:root` común dentro del
`@media`, y alcanza porque todas las pantallas las usan con la forma
`bg-(--color-panel)`, que resuelve la variable al pintar.

---

## Tests

```bash
npm test          # unitarios y de integración (Vitest)
npm run test:e2e  # de punta a punta (Playwright). Compila primero, a propósito
npm run typecheck # TypeScript en modo estricto
npm run lint      # ESLint con el conjunto de Next
npm run auditar   # invariantes de plata contra la base de verdad
npm run carreras  # dos personas haciendo lo mismo al mismo tiempo
npm run caja      # el cajón contra todas las formas de mover plata
```

**Por qué `test:e2e` compila antes.** Playwright levanta el POS con
`next start`, que sirve lo que haya en `.next`, y la configuración reusa un
servidor que ya esté arriba. Sin compilar, la suite corre los tests nuevos
contra el código viejo: los cambios de la aplicación no están y las pruebas
fallan —o peor, pasan— por un motivo que no tiene nada que ver con el código que
se acaba de escribir. Costó un ciclo entero descubrirlo. Para iterar sobre los
tests sin tocar la aplicación está `npm run test:e2e:rapido`, que no compila.

**Y reseteá la base antes de dar un veredicto**: la suite es con estado y deja
stock consumido, así que correrla dos veces seguidas sin `npm run db:seed --
--reset` inventa fallas que no existen.


Y uno que no es de prueba sino de puesta en marcha:

```bash
npm run preparar  # deja una base vacía lista para abrir el local
```

Crea el dueño, el vendedor, las tres cuentas monetarias y las categorías de
gasto, con las claves generadas al azar y mostradas una sola vez. Nada más: sin
productos, sin clientes y sin ventas. Es lo que hay que correr contra la base de
producción el primer día — **`db:seed` no**, que siembra datos de prueba.

`npm run auditar` es distinto de todo lo demás: no prueba código, prueba **los
datos**. Son diecinueve preguntas con una sola respuesta correcta —el saldo de
cada cuenta contra sus movimientos, el stock contra sus asientos, la deuda de
cada cliente contra lo que la movió, los correlativos sin huecos— y se corre
después de un rato de uso, también contra producción. Es de solo lectura.

```bash
npm run db:seed -- --reset && npm run build && npm run test:e2e && npm run auditar
```

`npm run carreras` es el otro que no prueba código común. Abre **dos conexiones
de verdad** contra PostgreSQL y hace a la vez lo que dos personas podrían hacer
a la vez: pagar el mismo gasto, cerrar el mismo turno, vender la última unidad.
Encontró que un gasto se podía pagar dos veces y la plata salía dos veces, sin
que ningún control lo notara. Escribe en la base, así que se niega a correr
contra una que no sea local y deja filas de prueba que limpia el `--reset`.

`npm run caja` es el tercero de esta familia. El arqueo es la única cuenta del
POS que se puede verificar contra el mundo —lo que dice el sistema tiene que ser
lo que hay adentro del cajón—, así que por cada forma de cobrar y de pagar arma
un turno solo para ella, calcula **a mano** cuántos billetes deberían quedar y
lo compara con lo que dice el sistema. Veintidós combinaciones: efectivo,
tarjeta, transferencia, Mercado Pago, mixto, fiado, seña, cobro de deuda vieja,
gasto del cajón, gasto del banco, gasto pendiente, gasto anulado, depósito y
retiro del banco.

Encontró cuatro cosas de una sola sesión probando la demo:

- **Se podía pagar del cajón más plata de la que había adentro.** Un gasto de
  $2.000.000 en efectivo habiendo vendido $1.500.000 dejaba el turno esperando
  −$500.000, y el cierre, contando los billetes que sí estaban, anunciaba
  «sobran $500.000». La resta era correcta y el cartel no significaba nada.
  `transferir` ya controlaba el saldo; los gastos, no.
- **Traer plata del banco al cajón no lo veía el arqueo.** La entrada de una
  transferencia iba siempre sin turno, con el argumento de que «el turno es del
  cajón y no del banco» —cierto al depositar, y al revés al traer cambio para
  dar vuelto—. El conteo daba de más por el monto traído, sin nada que lo
  explicara.
- **El panel de caja sumaba los gastos pagados por banco al renglón «gastos
  pagados del cajón».** Los dos números eran correctos por separado y juntos
  decían una mentira.
- **La invariante del auditor que tenía que atajar todo esto estaba desactivada
  por un error de suma:** contaba la apertura dos veces, así que la condición
  era tan laxa que no saltaba nunca.

Los tests de base **no necesitan un PostgreSQL levantado**: usan PGlite
(PostgreSQL compilado a WASM) con las migraciones reales aplicadas, así que
prueban el esquema de verdad — mismas restricciones, mismos disparadores.

Lo que PGlite **no** puede probar es eso último: es una sola conexión, y dos
transacciones simultáneas se serializan solas. Ahí es donde entra `carreras`, y
por eso hace falta PostgreSQL de verdad para correrlo.

Los de Playwright sí necesitan la base migrada, sembrada **y un build de
producción**: el test de venta sin conexión depende del service worker, que a
propósito no se registra en desarrollo.

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
| El comprobante escapa el HTML del catálogo y usa la fecha de Buenos Aires | `src/ventas/ticket.test.ts` |
| Una venta en dólares se imprime en dólares, sin ninguna conversión a pesos | `src/ventas/ticket.test.ts` |
| Un carrito mezclado, o con descuento, se imprime en pesos | `src/ventas/ticket.test.ts` |
| El comprobante no dice con qué medios se pagó ni quién atendió | `src/ventas/ticket.test.ts` |
| Con plan, lista cada cuota con su fecha y su monto | `src/ventas/ticket.test.ts` |
| La garantía va en blanco, para escribirla a mano | `src/ventas/ticket.test.ts` |
| Venta completa desde el navegador, con vuelto y ticket | `e2e/venta.spec.ts` |
| El iPhone cargado en pesos con la cifra del dólar frena la venta | `src/ventas/cordura.test.ts`, `e2e/calidad.spec.ts` |
| Un cable de Apple a $13.000 NO se marca como sospechoso | `src/ventas/cordura.test.ts` |
| Un salto del dólar mayor al 15% pide confirmación | `src/cotizacion/cotizacion.test.ts` |
| Una cotización más vieja que el umbral se reporta vencida | `src/cotizacion/cotizacion.test.ts` |
| Se lee el blue de Córdoba y **no** el oficial, que es el primero de la página | `src/cotizacion/infodolar.test.ts` |
| Si infodólar cambia el diseño no se guarda nada | `src/cotizacion/infodolar.test.ts` |
| Un cambio de cotización reprecia lo que está en dólares y lo manda a la tienda | `src/cotizacion/repreciar.test.ts` |
| El catálogo se ordena por gravedad, no por cantidad | `src/catalogo/calidad.test.ts` |
| El vendedor llega a las pantallas del mostrador; a Reportes no, ni por URL | `e2e/calidad.spec.ts` |
| **Las diecisiete pantallas cargan**, una por una, sin devolver error | `e2e/pantallas.spec.ts` |
| El historial trae las ventas del período y deja afuera las de otros días | `src/ventas/anular.test.ts` |
| El límite de arriba es exclusivo: «ayer» no se come lo de hoy | `src/ventas/anular.test.ts` |
| Una venta anulada sigue en el historial: el comprobante se reimprime igual | `src/ventas/anular.test.ts` |
| Se mira otro día y se reimprime desde ahí | `e2e/venta.spec.ts` |
| Un servidor lento no se anuncia como «sin conexión» cuando no hay copia guardada | `src/offline/sw.test.ts` |
| Con la red caída de verdad, y sin copia, sí se avisa que no hay conexión | `src/offline/sw.test.ts` |
| Habiendo copia, se sirve sin esperar al servidor lento, y la tardía se guarda | `src/offline/sw.test.ts` |
| El service worker no responde rutas de API ni ningún POST | `src/offline/sw.test.ts` |
| Fiar deja la deuda registrada y no mueve plata | `src/fiado/cuenta.test.ts`, `e2e/fiado.spec.ts` |
| El tope de fiado frena la venta antes de que entre | `src/fiado/cuenta.test.ts`, `e2e/fiado.spec.ts` |
| Cobrar el fiado baja la deuda y entra a la caja del turno | `src/fiado/cuenta.test.ts`, `e2e/fiado.spec.ts` |
| No se puede cobrar más de lo que se debe, ni a quien no debe | `src/fiado/cuenta.test.ts` |
| Reintentar el mismo cobro no cobra dos veces | `src/fiado/cuenta.test.ts` |
| Anular una venta fiada le saca la deuda al cliente | `src/fiado/cuenta.test.ts` |
| Un iPhone fiado deja la deuda en dólares, y el dólar que se mueve no la mueve | `src/fiado/cuenta.test.ts` |
| Un carrito mezclado NO se fía en dólares: queda en pesos, entero | `src/fiado/cuenta.test.ts` |
| Las dos deudas conviven en la misma cuenta y no se suman | `src/fiado/cuenta.test.ts` |
| El que debe solo dólares aparece en la lista de Fiado y en el total por cobrar | `src/fiado/cuenta.test.ts`, `e2e/fiado-dolares.spec.ts` |
| Un iPhone fiado se pacta en cuotas de dólares desde la pantalla de cobro | `e2e/fiado-dolares.spec.ts` |
| Se cobra una cuota en billetes de dólar y entra al cajón verde, sin conversión | `e2e/fiado-dolares.spec.ts` |
| Cobrar en billetes verdes baja la deuda en dólares y sube el cajón verde | `src/fiado/cuenta.test.ts` |
| Cobrar una deuda en dólares con otro medio imputa dólares y entra pesos exactos, sin redondear al millar | `src/fiado/cuenta.test.ts` |
| Sin cotización, cruzar de moneda al cobrar se frena | `src/fiado/cuenta.test.ts` |
| Pagar dólares no marca pagada una cuota en pesos | `src/fiado/cuenta.test.ts` |
| El semáforo es uno por moneda: las cuotas en dólares no entran en el estado en pesos | `src/fiado/plan.db.test.ts` |
| Al que debe dólares se le reclama en dólares, con el signo correcto | `src/whatsapp/mensajes.test.ts` |
| No se transfiere entre pesos y dólares, ni para un lado ni para el otro | `src/gastos/gastos.test.ts` |
| La ficha de papel entra una sola vez por cliente | `src/fiado/cuenta.test.ts`, `e2e/fiado.spec.ts` |
| Un `{campo}` inventado en una plantilla se rechaza al guardar, no al mandar | `src/whatsapp/plantillas.test.ts`, `e2e/whatsapp.spec.ts` |
| El texto del mensaje viaja escapado: saltos de línea, acentos, emojis y `&` | `src/whatsapp/plantillas.test.ts` |
| Un campo sin valor se borra en vez de quedar con la llave puesta | `src/whatsapp/plantillas.test.ts` |
| Una venta anulada o sin cliente no ofrece comprobante | `src/whatsapp/mensajes.test.ts` |
| Lo que se guarda es el texto que se armó, no la plantilla | `src/whatsapp/mensajes.test.ts` |
| Recordarle la deuda dos veces en la semana pide confirmación | `src/whatsapp/mensajes.test.ts`, `e2e/whatsapp.spec.ts` |
| Anular una venta fiada ya cobrada en parte deja anotada la plata a devolver | `src/fiado/cuenta.test.ts`, `e2e/fiado.spec.ts` |
| El efectivo del desglose es exactamente el que hay que contar en el cajón | `src/caja/sesion.test.ts` |
| Con dos pagos en efectivo, el vuelto se resta una sola vez | `src/caja/sesion.test.ts` |
| Un cobro de fiado figura como plata que entró; lo fiado, no | `src/caja/sesion.test.ts` |
| El comprobante de una venta fiada dice cuánto queda debiendo | `src/ventas/ticket.test.ts`, `src/whatsapp/mensajes.test.ts` |
| Una venta de 25 accesorios no manda una URL que WhatsApp trunque | `src/whatsapp/mensajes.test.ts` |
| Un gasto pagado sin cuenta lo rechaza la base, no solo el formulario | `src/gastos/gastos.test.ts` |
| Un gasto en efectivo baja el efectivo esperado del arqueo | `src/gastos/gastos.test.ts`, `e2e/gastos.spec.ts` |
| Un gasto pendiente no mueve un peso hasta que se paga | `src/gastos/gastos.test.ts`, `e2e/gastos.spec.ts` |
| Anular un gasto devuelve la plata y deja el arqueo como estaba | `src/gastos/gastos.test.ts`, `e2e/gastos.spec.ts` |
| Una transferencia entre cuentas no cambia el total del negocio | `src/gastos/gastos.test.ts`, `e2e/gastos.spec.ts` |
| No se transfiere más de lo que hay en la cuenta | `src/gastos/gastos.test.ts`, `e2e/gastos.spec.ts` |
| El saldo guardado de cada cuenta coincide con sus movimientos | `src/gastos/gastos.test.ts` |
| El vendedor ve gastos y cuentas, y entra también por URL | `e2e/gastos.spec.ts` |
| Una vista previa de Vercel no se toma por producción, aunque `NODE_ENV` lo diga | `src/lib/produccion.test.ts` |
| El staging se reconoce por ruta y por subdominio, y un dominio que empieza con «dev» no lo es | `src/lib/produccion.test.ts` |
| Sin `CRON_SECRET` en producción el POS lo reclama; en desarrollo no molesta | `src/lib/produccion.test.ts` |
| El vendedor fía y recibe pagos | `e2e/fiado.spec.ts` |
| Un teléfono argentino se normaliza como lo escriban | `src/clientes/clientes.test.ts` |
| El mismo teléfono no se puede cargar en dos clientes | `src/clientes/clientes.test.ts`, `e2e/fiado.spec.ts` |
| Una variación se cobra a su precio y no al del producto padre | `src/ventas/confirmar.test.ts`, `e2e/venta.spec.ts` |
| Una variación de otro producto se rechaza | `src/ventas/confirmar.test.ts` |
| Dos pagos en efectivo descuentan el vuelto una sola vez | `src/ventas/confirmar.test.ts`, `e2e/venta.spec.ts` |
| Quitar un renglón de pago no deja la pantalla mostrando otro número | `e2e/venta.spec.ts` |
| El vendedor anula, descuenta y escribe precios | `e2e/venta.spec.ts` |
| Anular repone el stock en la variación de la que salió y revierte la caja | `src/ventas/anular.test.ts` |
| Una venta anulada no cuenta en el arqueo, y no se anula dos veces | `src/ventas/anular.test.ts` |
| Una venta de un turno cerrado no se puede anular | `src/ventas/anular.test.ts` |
| «1500.50» con punto decimal son mil quinientos, no ciento cincuenta mil | `src/lib/dinero.test.ts` |
| El mostrador cobra el precio de la tienda menos el recargo | `src/precios/mostrador.test.ts`, `e2e/venta.spec.ts` |
| Un servicio no lleva recargo: no se vende por la web | `src/precios/mostrador.test.ts` |
| Un precio de mostrador escrito a mano manda sobre el cálculo | `src/precios/mostrador.test.ts` |
| El recargo que cubre una comisión del 6% es 6,38%, no 6% | `src/precios/mostrador.test.ts` |
| Un precio muy por debajo del catálogo avisa y hay que confirmarlo | `src/ventas/confirmar.test.ts`, `e2e/venta.spec.ts` |
| Corregir hacia arriba un precio viejo se cobra sin preguntar | `src/ventas/confirmar.test.ts` |
| Cada permiso está clasificado: uno nuevo no se cuela sin decidirlo | `src/auth/pin.test.ts` |
| Al cargar un producto se avisa qué parecido ya existe, inactivos incluidos | `src/catalogo/crear.test.ts`, `e2e/alta.spec.ts` |
| Sumar stock encola el empuje a Woo: sin eso el próximo sync borra las unidades | `src/catalogo/stock.test.ts` |
| Dos entradas seguidas del mismo producto suman las dos | `src/catalogo/stock.test.ts` |
| Reactivar dos veces no escribe dos veces en la bitácora | `src/catalogo/stock.test.ts` |
| El catálogo se busca, y lo que no está lleva derecho a cargarlo | `e2e/alta.spec.ts` |
| El vendedor escribe precios, pero no fuerza una ficha mal cargada | `src/auth/pin.test.ts`, `e2e/calidad.spec.ts` |
| Confirmar «escritas» no fuerza una sospecha de catálogo, ni desde el navegador | `src/ventas/confirmar.test.ts` |
| El log de auditoría no se puede modificar ni borrar | `src/db/esquema.test.ts` |
| Cancelar no borra: `DELETE` bloqueado en ventas, stock y caja | `src/db/esquema.test.ts` |
| Un producto en USD sin precio en dólares no entra | `src/db/esquema.test.ts` |
| Un gasto pagado sin cuenta monetaria no entra (si no, la caja no cierra) | `src/db/esquema.test.ts` |
| Una clave de idempotencia no puede repetirse | `src/db/esquema.test.ts` |
| No hay dos sesiones de caja abiertas en la misma terminal | `src/db/esquema.test.ts` |
| La aritmética de centavos y el redondeo al millar de D22 | `src/lib/dinero.test.ts` |
| El error de los 9 iPhones se detecta al sincronizar | `src/woo/mapear.test.ts` |
| Sincronizar dos veces actualiza en vez de duplicar | `src/woo/sincronizar.test.ts` |
| El refresco cortado por tiempo **no** avanza la marca de agua | `src/woo/refrescar.test.ts` |
| Lo borrado de la tienda se desactiva, con sus variaciones, y no se borra | `src/woo/sincronizar.test.ts` |
| Si faltara más del 20% del catálogo no se da de baja nada | `src/woo/sincronizar.test.ts` |
| Un producto nacido en el POS nunca se da de baja por no estar en Woo | `src/woo/sincronizar.test.ts` |
| Un producto que dejó de ser variable pierde sus variaciones | `src/woo/sincronizar.test.ts` |
| Una ficha sin `type` se descarta en vez de aplanar el catálogo | `src/woo/sincronizar.test.ts` |
| El refresco pide solo lo modificado, con el margen de seis horas | `src/woo/refrescar.test.ts` |
| El webhook rechaza una firma inválida | `src/woo/webhook.test.ts` |
| El webhook actualiza la ficha pero NO le pisa el stock al POS | `src/woo/espejo.test.ts` |
| Una divergencia de stock con Woo queda registrada en vez de resolverse sola | `src/woo/espejo.test.ts` |
| Los montos de una venta cerrada no se pueden reescribir ni por SQL | `src/db/esquema.test.ts` |
| Una operación que agotó los reintentos se puede devolver a la cola | `src/woo/cola.test.ts` |
| Reintentar dos veces no descuenta stock de más | `src/woo/cola.test.ts` |
| Una venta de un turno cerrado se devuelve, y la venta original no cambia | `src/ventas/devolver.test.ts`, `e2e/devoluciones.spec.ts` |
| La devolución sale del cajón de hoy, no del turno en que se vendió | `src/ventas/devolver.test.ts`, `e2e/devoluciones.spec.ts` |
| La misma unidad no se devuelve dos veces | `src/ventas/devolver.test.ts`, `e2e/devoluciones.spec.ts` |
| Se devuelve el precio cobrado, con el descuento global ya prorrateado | `src/ventas/devolver.test.ts` |
| A quien todavía debe de esa venta se le baja la deuda antes de darle plata | `src/ventas/devolver.test.ts` |
| Una devolución registrada no se puede editar ni por SQL | `src/ventas/devolver.test.ts` |
| Una devolución rechazada no deja nada a medias | `src/ventas/devolver.test.ts` |
| Un producto fallado se devuelve sin volver al stock, y la plata sale igual | `src/ventas/devolver.test.ts` |
| El arqueo dice por qué falta esa plata, aparte de las anulaciones | `src/ventas/devolver.test.ts`, `e2e/devoluciones.spec.ts` |
| El vendedor registra devoluciones | `e2e/devoluciones.spec.ts` |
| Importar el histórico dos veces no duplica la facturación | `src/woo/historico.test.ts` |
| En un lote a medias, se suma solo lo que entró de verdad | `src/woo/historico.test.ts` |
| Un pedido histórico ilegible se descarta y el informe no cierra | `src/woo/historico.test.ts` |
| El histórico importado aparece en el reporte mes a mes | `src/woo/historico.test.ts` |
| Sin conexión, el buscador devuelve lo mismo y en el mismo orden que el servidor | `src/offline/catalogo.test.ts` |
| Dos palabras sueltas encuentran el producto, en cualquier orden y aunque estén separadas | `src/offline/catalogo.test.ts` |
| Cada palabra que se agrega achica la lista en vez de vaciarla | `src/offline/catalogo.test.ts` |
| Una palabra puede estar en el nombre y la otra en la marca | `src/offline/catalogo.test.ts` |
| Una variación se encuentra por el SKU del producto padre, también sin conexión | `src/offline/catalogo.test.ts` |
| El catálogo guardado avisa cuando tiene más horas que el refresco del dólar | `src/offline/catalogo.test.ts` |
| Una venta cobrada sin conexión entra con la fecha del cobro, no la de la carga | `src/ventas/diferida.test.ts` |
| Se cobra el precio que se cobró, y la diferencia con el catálogo queda anotada | `src/ventas/diferida.test.ts` |
| Una venta diferida entra aunque no haya stock, y lo deja en negativo | `src/ventas/diferida.test.ts` |
| La venta de siempre sigue frenando sin stock y con precios sospechosos | `src/ventas/diferida.test.ts` |
| Si el turno del cobro ya cerró, cae en el abierto y el arqueo lo explica | `src/ventas/diferida.test.ts` |
| Subir dos veces la misma venta no la cobra ni descuenta stock dos veces | `src/ventas/diferida.test.ts` |
| Una venta ya confirmada con conexión no se convierte en diferida al reintentarla | `src/ventas/diferida.test.ts` |
| La base rechaza una venta marcada offline sin decir cuándo se cobró | `src/ventas/diferida.test.ts` |
| Lo que se reintenta solo y lo que tiene que ver una persona | `src/offline/cola.test.ts` |
| Se corta internet, se vende, y la venta entra sola cuando vuelve | `e2e/offline.spec.ts` |
| El turno no se cierra con una venta cobrada esperando | `e2e/offline.spec.ts` |
| La ruta del cron no se abre sin el secreto | `e2e/calidad.spec.ts` |
| Ingreso por PIN y por contraseña, y los permisos por rol | `e2e/ingreso.spec.ts` |

---

## Estructura

```
src/
  app/            Rutas de Next (App Router)
    (pos)/        Shell del POS, detrás de sesión
      vender/     Pantalla de venta: buscador, carrito y cobro
      caja/       Apertura, resumen del turno y arqueo
      catalogo/   Fichas con problemas, ordenadas por gravedad
      cotizacion/ Valor del dólar, historial y carga manual
      fiado/      Quién debe, cuánto y cobro a cuenta
      clientes/   Fichero y ficha con movimientos
      mensajes/   Textos de WhatsApp y lo que ya se preparó
      gastos/     Lo que sale: cargar, pagar y anular
      cuentas/    Saldos, extractos y transferencias
      reportes/   Cuánto se vendió, de qué y con qué margen
      devoluciones/ Devolver una venta de un turno ya cerrado
    ingresar/     Pantalla de ingreso
    ticket/       Comprobante imprimible
    api/          Buscador, Auth.js y webhooks de WooCommerce
  auth/           Sesión, PIN, permisos por rol
  caja/           Sesión de caja: abrir, resumir, cerrar
  catalogo/       Calidad de las fichas y marcador de producto real
  cotizacion/     Tipo de cambio: historial, guardas y vencimiento
  db/             Esquema Drizzle, migraciones, seed, base de test
  lib/            Dinero en centavos, fechas, texto, auditoría, chequeos de despliegue
  offline/        Catálogo guardado en la tablet y cola de ventas cobradas
  reportes/       Períodos, agregados de venta y armado de planillas
  ventas/         Carrito, buscador, confirmación, ticket, anulación y devolución
  whatsapp/       Plantillas, armado de mensajes y enlace de wa.me
  fiado/          Cuenta corriente y devoluciones pendientes
  gastos/         Gastos, cuentas monetarias y transferencias
  woo/            Cliente REST, mapeo, sincronización, cola, webhooks, histórico
  scripts/        Comandos de consola
public/           Service worker, manifiesto e íconos de la app instalable
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
5. Correr `npm run woo:historico -- --ensayo` y después sin `--ensayo`, para que
   los reportes no arranquen vacíos.

**El paso a paso completo está en [PRODUCCION.md](PRODUCCION.md)**, con lo que se
configura afuera del repositorio: la rotación de credenciales, a qué tienda
apunta cada entorno y el secreto de la tarea programada.

Tres cosas se configuran en Neon, en WooCommerce y en Vercel, y ninguna falla de
forma ruidosa cuando falta: el drenaje programado simplemente no corre, y
apuntarle a la tienda equivocada simplemente escribe el stock en el lugar
equivocado. Por eso se chequean desde dos lados:

```bash
npm run produccion:chequear                                  # este entorno
vercel env pull .env.produccion && \
  npm run produccion:chequear -- --env .env.produccion --produccion
```

Sale con código 1 si falta algo, así que se puede encadenar antes de desplegar.
No imprime ningún secreto: dice si están y a dónde apuntan. Y el POS lo reclama
solo: si algo quedó mal, **Estado del sistema** muestra un panel rojo que solo ve
el dueño y que desaparece cuando se resuelve.

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
| 3 | Dólares y calidad de datos: validaciones de cordura, marcador de producto real | **Hecha** |
| 3.5 | Auditoría del sistema completo: variaciones, permisos en el servidor, ventas del turno y anulación | **Hecha** |
| 3.6 | Precio de mostrador y precio de tienda, con el recargo de Mercado Pago | **Hecha** |
| 3.7 | Lo que faltaba para producción: cola destrabable y programada, montos inmutables, el webhook deja de pisar el stock | **Hecha** |
| 4 | Clientes y fiado, con la migración de las fichas de papel | **Hecha** |
| 5 | WhatsApp: comprobantes y recordatorios | **Hecha** |
| 6 | Gastos y cuentas monetarias | **Hecha** |
| 7 | Caja completa: arqueo y cierre | **Hecha** |
| 8 | Alta asistida de productos: rápida, con IA, importación masiva | **Hecha** |
| 9 | Reportes y exportación | **Hecha** |
| 10 | Devoluciones de turnos cerrados y migración del histórico | **Hecha** |
| v1.1 | Offline acotado: caché de catálogo y cola de venta | **Hecha** |
