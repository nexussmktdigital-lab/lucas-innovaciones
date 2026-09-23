# Salir a producción

Tres cosas se configuran fuera de este repositorio: en **Neon**, en
**WooCommerce** y en **Vercel**. Ninguna falla de forma ruidosa cuando falta —el
drenaje programado simplemente no corre, y apuntarle a la tienda equivocada
simplemente escribe el stock en el lugar equivocado—, así que están acá, con el
paso a paso.

Si lo que buscás es **dónde va alojado y cómo se llega a
`pos.lucasinnovaciones.com.ar`**, eso está en el punto 0, que es el primero que
hay que resolver.

Para ver cómo está todo ahora mismo:

```bash
npm run produccion:chequear
```

Y contra lo que realmente está cargado en Vercel, que es lo que importa:

```bash
vercel env pull .env.produccion
npm run produccion:chequear -- --env .env.produccion --produccion
rm .env.produccion
```

Sale con código 1 si falta algo, así que se puede encadenar antes de un
despliegue. No imprime ningún secreto: dice si están y a dónde apuntan.

El POS también lo reclama solo: si algo quedó mal, aparece un panel rojo en
**Estado del sistema**, que solo ve el dueño, y desaparece cuando se resuelve.

---

## 0. Dónde vive el POS, y el subdominio

### El POS no puede ir en el hosting del WordPress

El WordPress de DonWeb es PHP sobre un hosting compartido: recibe un pedido,
corre un script y contesta. El POS es otra cosa —un proceso de Node.js que
tiene que estar prendido todo el tiempo, con las acciones de servidor, el
middleware de sesión y una conexión abierta a PostgreSQL—. **En un hosting
compartido de PHP no corre**, y no es cuestión de configurarlo mejor.

Así que son dos lugares distintos, y está bien que lo sean: el día que el
WordPress se caiga por una actualización de plugin, el mostrador sigue
vendiendo.

### El subdominio sí, y no toca el WordPress

`pos.lucasinnovaciones.com.ar` es un registro DNS más en la zona del dominio.
El dominio sigue donde está, el WordPress de `lucasinnovaciones.com.ar` sigue
respondiendo igual, y el subdominio nuevo apunta a otro lado. No hay ningún
momento en que la tienda deje de funcionar.

### Dónde alojarlo

**Vercel** es lo que este proyecto asume: `vercel.json` trae la tarea
programada que drena la cola hacia WooCommerce, y el despliegue es `git push`.

**Hace falta el plan Pro**, unos US$20 por mes, por dos razones independientes:
el plan Hobby es solo para uso no comercial, y además limita las tareas
programadas a una por día. La de este proyecto corre cada diez minutos, así que
en Hobby **el despliegue se rechaza antes de construir**, con este error:

```
Hobby accounts are limited to daily cron jobs.
This cron expression (*/10 * * * *) would run more than once per day.
```

No es un problema del código: es el plan. Se pasa a Pro y el mismo despliegue
sale.

La alternativa, si se prefiere tener todo en un solo proveedor, es un **Cloud
Server de DonWeb**, que sí corre Node.js. Cuesta menos y cuesta más: hay que
mantener Nginx, PM2, los certificados y las actualizaciones del sistema, y la
tarea programada de `vercel.json` hay que rehacerla como un `cron` del
servidor. Se puede; es más trabajo por mes.

### Los registros DNS, en el panel de DonWeb

El panel de DonWeb es **Ferozo**. Va en **Dominios → Zona DNS → Nuevo
registro**, parado en la pantalla que arriba tiene el selector
«Dominio: lucasinnovaciones.com.ar»:

| Tipo | Nombre | Contenido | TTL |
|---|---|---|---|
| CNAME | `pos.lucasinnovaciones.com.ar` | el que muestre Vercel | `3600` |

Vercel da un valor propio por proyecto, del estilo
`xxxxxxxx.vercel-dns-0xx.com`.

Tres cosas que Ferozo no perdona, las tres encontradas peleándose con el panel:

- **El nombre va completo**, `pos.lucasinnovaciones.com.ar`, aunque la lista de
  registros y la ayuda del formulario sugieran que alcanza con `pos`. Con el
  nombre corto contesta «El nombre del registro no es válido» y no aclara nada
  más. Pasa igual con un registro A, así que el error es del campo Nombre y no
  del tipo de registro.
- **El TTL tiene que estar entre 900 y 86400.** Menos de eso lo rechaza.
- **El punto final del valor, mejor sacarlo.** Vercel lo muestra porque así se
  escribe en un archivo de zona; Ferozo lo agrega solo.

> **La trampa grande:** no hay que crear el subdominio desde **Ferozo →
> Dominios → Subdominios**. Eso arma una carpeta en el hosting compartido y un
> registro A apuntando al servidor del WordPress, que es justo lo contrario de
> lo que se quiere, y después pelea con el CNAME. Solo el registro en la Zona
> DNS.
>
> **Y la otra:** en la pantalla de Domains de Vercel, la pestaña **Vercel DNS**
> ofrece cambiar los nameservers a los de Vercel. Eso le entrega el dominio
> entero y se lleva puestos el WordPress, el correo y el staging. La pestaña
> que va es **DNS Records**.

El certificado HTTPS lo emite Vercel solo, a los pocos minutos de que el DNS
resuelva. La propagación puede tardar hasta 24 o 48 horas, aunque en la
práctica suele ser bastante menos.

### Lo que hay que ajustar una vez que el dominio está

- **`AUTH_TRUST_HOST="true"`** en las variables de Vercel. Auth.js necesita
  confiar en el host que le llega del proxy; sin eso el ingreso redirige mal.
- **Los cambios de la tienda entran solos cada diez minutos**, por la tarea
  programada. Los webhooks quedaron descartados: el servidor de WordPress no
  puede alcanzar el POS (ver el punto 10).
- **La tablet del mostrador tiene que abrir el POS desde este dominio**, con
  internet, al menos una vez. El service worker guarda el catálogo por dominio:
  hasta que eso no pasa, un corte deja la pantalla en blanco.
- **`POS_TERMINAL`** es una por despliegue. Con la MacBook y la tablet entrando
  a la misma dirección, las dos comparten la terminal `T1` y el mismo turno de
  caja, que es lo que se quiere en un local con un solo mostrador.

---

## 0.5. El despliegue, de principio a fin

Doce pasos, en este orden. Cada uno dice dónde está el detalle. Los comandos van
en la PowerShell, parado en la carpeta `pos`.

> **Antes que nada:** Node **22 LTS**. Con Node 24 hay cosas que fallan raro.
> `node --version` lo dice.

### 1. Poner el código en `main`

Vercel despliega a producción desde la rama principal. Todo lo construido está
en `claude/vigilant-volta-335wxv`, así que primero se junta:

```powershell
git checkout main
git pull origin main
git merge claude/vigilant-volta-335wxv
git push origin main
```

### 2. Crear la base en Neon

[neon.tech](https://neon.tech) → proyecto nuevo, región **South America (São
Paulo)** para que el mostrador esté cerca.

En el panel del proyecto, el recuadro **Connect to your database** trae la
cadena armada, con un interruptor **Connection pooling** que viene encendido.
Hacen falta **las dos**:

| | El interruptor | El host termina en | Para qué |
|---|---|---|---|
| **Pooled** | encendido (como viene) | `-pooler.…aws.neon.tech` | la variable `DATABASE_URL` de Vercel |
| **Directa** | apagado | `…aws.neon.tech`, sin `-pooler` | los comandos que corrés desde tu PC |

Guardá las dos en el gestor de contraseñas. La diferencia son esos siete
caracteres y es fácil confundirlas después.

**Por qué dos.** El pooler reparte muchas conexiones cortas entre pocas reales,
que es justo lo que necesita una app en Vercel, donde cada pantalla abre y
cierra la suya. Para migrar la base o sacarle una copia, en cambio, Neon
recomienda la directa: son operaciones largas que quieren la conexión para
ellas solas.

> Los comandos del POS funcionan con cualquiera de las dos —están preparados
> para eso—, así que si te equivocás no se rompe nada. La directa es la que
> conviene igual.

> Cuánto historial guarda Neon para volver atrás depende del plan, y el número
> está en el panel: **Postgres → History retention**. En el plan Free de este
> proyecto son **6 horas**. No frena el despliegue, pero antes de que el
> mostrador cargue ventas de verdad hay que resolverlo: punto 5.

### 3. Rotar lo que quedó expuesto y generar los secretos

La clave de WooCommerce y la contraseña de Neon se pegaron en un chat. El paso a
paso está en el **punto 1**. Además hacen falta tres secretos nuevos:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Una vez para `AUTH_SECRET`, otra para `CRON_SECRET` y otra para
`WOO_WEBHOOK_SECRET`. Guardalos en un gestor de contraseñas, no en un archivo
suelto ni en un chat.

### 4. Crear el proyecto en Vercel

[vercel.com](https://vercel.com) → **Add New → Project** → importar
`nexussmktdigital-lab/lucas-innovaciones`. Y acá lo único que hay que tocar:

- **Root Directory: `pos`** ← el repositorio tiene el POS adentro de esa
  carpeta. Si queda en la raíz, la construcción falla sin decir por qué.
- Framework: Next.js (lo detecta solo).
- Build y Output: los que vienen.

**No desplegar todavía**: primero las variables, en el paso siguiente. Un
despliegue sin variables arranca y falla al abrir cualquier pantalla.

### 5. Cargar las variables, marcadas para «Production»

**Settings → Environment Variables**. Estas son obligatorias:

| Variable | Qué va |
|---|---|
| `DATABASE_URL` | la cadena **pooled** de Neon (la del `-pooler`) |
| `AUTH_SECRET` | el primero que generaste |
| `AUTH_TRUST_HOST` | `true` |
| `WOO_URL` | `https://lucasinnovaciones.com.ar` |
| `WOO_CONSUMER_KEY` | la clave **nueva** de producción |
| `WOO_CONSUMER_SECRET` | su secreto |
| `WOO_WEBHOOK_SECRET` | el secreto de los webhooks |
| `CRON_SECRET` | el de la tarea programada |
| `POS_TERMINAL` | `T1` |

Opcional: `ANTHROPIC_API_KEY`, solo para la ayuda que arma la ficha de un
producto nuevo. Sin ella el alta funciona igual, escrita a mano.

### 6. El primer despliegue

**Deployments → Deploy**. Tarda un par de minutos. Al terminar da una dirección
`…vercel.app` que todavía no va a andar: falta la base.

### 7. Aplicar las migraciones

Las migraciones **no corren solas**, y es a propósito (**punto 4**). Se corren
desde tu máquina, apuntando a la base de producción **sin tocar tu `.env`**:

```powershell
$env:DATABASE_URL="<la cadena DIRECTA de Neon, sin -pooler>"
npm run db:migrate
npm run produccion:chequear
Remove-Item Env:\DATABASE_URL
```

> **Nunca** corras `npm run db:seed -- --reset` con esa variable puesta: borra
> la base entera. El seed es solo para la demo y para desarrollo.

Ahora sí, abrí la dirección `…vercel.app`: tiene que aparecer la pantalla de
ingreso.

### 8. Dejar la base lista para abrir el local

La base está migrada pero vacía: no hay con qué entrar.

```powershell
$env:DATABASE_URL="<la cadena DIRECTA de Neon, sin -pooler>"
npm run preparar
Remove-Item Env:\DATABASE_URL
```

Crea el dueño, el vendedor del mostrador, las tres cuentas monetarias y las
once categorías de gasto. **Nada más**: sin productos, sin clientes y sin
ventas. El catálogo entra en el paso 11, desde WooCommerce.

La contraseña y el PIN se generan al azar y **se muestran una sola vez**. No
quedan en ningún archivo. Guardalos en el gestor de contraseñas en ese momento;
si se pierden, `npm run preparar -- --rehacer-claves` genera otros.

> **Nunca** uses `npm run db:seed` contra producción. Siembra veintiocho
> productos que no existen en la tienda, clientes con deudas inventadas y
> facturación del sistema anterior: no es un arranque, es ensuciar los reportes
> del primer día.

Correrlo dos veces no duplica nada y no pisa las claves salvo que se lo pidas.

### 9. El subdominio

**Settings → Domains** → agregar `pos.lucasinnovaciones.com.ar`. Copiar el
CNAME que muestra y cargarlo en **DonWeb → Zona DNS**, como dice el punto 0.
Esperar a que el candado aparezca.

### 10. Los cambios de la tienda: nada que configurar

**No hay que dar de alta ningún webhook.** Se intentó y no se puede: al guardar
el primero, WooCommerce contesta

```
No se puede acceder a la URL de entrega: cURL error 60: SSL certificate
problem: EE certificate key too weak
```

Eso no es un problema del POS ni del certificado, que es el de Vercel y está
bien. Es el OpenSSL del servidor de DonWeb, configurado con un nivel de
seguridad que rechaza los certificados ECDSA modernos. Como la validación corre
en el servidor de ellos, del lado nuestro no hay nada que tocar, y esperar a que
DonWeb lo cambie no es un plan.

Así que el POS pregunta en vez de esperar el aviso: **cada diez minutos, la
misma tarea programada del punto siguiente le pide a WooCommerce solo lo que
cambió** y actualiza el espejo. Un cambio de precio hecho en la tienda está en
el mostrador en menos de diez minutos, y no depende de DonWeb para nada.

Lo único que no llega por ahí es un producto **borrado definitivamente** en Woo
—uno mandado a la papelera sí llega—. Para eso alcanza con correr
`npm run woo:sync` de vez en cuando, que compara contra el catálogo entero.

`WOO_WEBHOOK_SECRET` se deja cargado igual: el endpoint sigue existiendo y, si
algún día el hosting arregla su OpenSSL, dar de alta los webhooks vuelve a ser
un minuto de trabajo y los cambios pasan a llegar en el momento.

### 11. Traer el catálogo y el histórico

```powershell
$env:DATABASE_URL="<la cadena DIRECTA de Neon, sin -pooler>"
npm run woo:sync -- --verificar     # confirma contra qué tienda habla
npm run woo:sync                    # trae los productos
npm run woo:historico -- --ensayo   # cuenta los pedidos, sin escribir
npm run woo:historico               # importa la facturación anterior
npm run auditar                     # los diecinueve invariantes
Remove-Item Env:\DATABASE_URL
```

El histórico va contra la tienda **de verdad** y no contra el staging: lo que
interesa es la facturación real. Detalle en el punto 2.5.

### 12. Comprobar que quedó bien

Con la tarea programada:

```powershell
curl.exe -H "Authorization: Bearer <CRON_SECRET>" `
  https://pos.lucasinnovaciones.com.ar/api/cron/sincronizar
```

Tiene que contestar `{"ok":true,…}`. Un 401 es el secreto equivocado; un 503,
que la variable no llegó al despliegue.

Y después, la **lista final** del fondo de este archivo, entera.

---

## 1. Rotar las credenciales expuestas

La contraseña de Neon y la clave de WooCommerce se pegaron en una conversación
de chat. **Nada de eso está en el repositorio** —no hay ningún `.env`
versionado y el historial de git está limpio, verificado con `git log --all -S`—
pero una credencial que salió de su lugar se considera comprometida igual.

### WooCommerce

1. WordPress → **WooCommerce → Ajustes → Avanzado → REST API**.
2. Revocar la clave que está en uso (la de producción).
3. **Añadir clave**: descripción `POS producción`, usuario administrador,
   permisos **Lectura/Escritura**. Se muestra una sola vez.
4. Cargarla en Vercel como `WOO_CONSUMER_KEY` y `WOO_CONSUMER_SECRET`.
5. Repetir sobre el **staging** con descripción `POS desarrollo`, y esa va al
   `.env` local. Ver el punto 2.

### Neon

1. Panel de Neon → el proyecto → **Roles** → el rol `neondb_owner`.
2. **Reset password**. La cadena de conexión cambia entera.
3. Actualizar `DATABASE_URL` en Vercel con la cadena **pooled**
   (`-pooler` en el host) y redesplegar.

> La app lee la base en cada request, así que entre el reset y el redespliegue
> hay una ventana de error. Hacerlo con el local cerrado.

### Secreto de sesión

Si `AUTH_SECRET` también estuvo expuesto, rotarlo cierra todas las sesiones
abiertas, lo cual es exactamente lo que se quiere:

```bash
openssl rand -base64 32
```

---

## 2. Que el desarrollo no le escriba a la tienda de verdad

Hoy el `.env` de desarrollo puede estar apuntando a la tienda de producción,
porque la clave que funcionaba era esa. **Una venta de prueba le descuenta stock
real al negocio.**

En el `.env` local:

```bash
WOO_URL="https://lucasinnovaciones.com.ar/staging"
WOO_CONSUMER_KEY="<la clave del staging>"
WOO_CONSUMER_SECRET="<el secreto del staging>"
```

Y volver a sincronizar el catálogo desde ahí:

```bash
npm run woo:sync -- --verificar   # confirma contra qué tienda habla
npm run woo:sync
```

El chequeo reconoce el staging por la ruta `/staging` y también por las formas
habituales de subdominio (`staging.`, `dev.`, `test.`), así que si el staging se
muda no hay que tocar código.

---

## 2.5. El histórico de pedidos, una sola vez

Los 3.764 pedidos del sistema anterior entran con un script, contra la **tienda
de verdad** y no contra el staging: lo que interesa es la facturación real.

```bash
npm run woo:historico -- --ensayo   # cuenta y muestra el período, sin escribir
npm run woo:historico               # lo importa
```

Va a `legacy_sales`, que es de solo lectura: no toca stock, ni caja, ni la
numeración de ventas. Repetirlo es seguro —lo que ya está se saltea— así que si
corta a la mitad se vuelve a correr y retoma.

Lo único que hay que mirar del informe es que las cuentas cierren: si avisa que
leyó más pedidos de los que procesó, hay pedidos que WooCommerce devolvió en un
formato que el importador no pudo leer y **esa facturación falta**.

---

## 3. La tarea programada: la cola y el catálogo

Cada diez minutos, `/api/cron/sincronizar` hace dos cosas, en este orden.

**Primero drena la cola.** Cada venta descuenta el stock en el POS y deja el
ajuste en una cola hacia WooCommerce. Esa cola se vacía al confirmar una venta
**y** acá. Sin el segundo camino, si la tienda se cae después de la última venta
del día, el stock queda desactualizado hasta la primera venta del día siguiente.

**Después refresca el catálogo** con lo que cambió en la tienda desde la corrida
anterior: es lo que reemplaza a los webhooks (punto 10 de la sección anterior).

El orden no es casual. La cola es stock —plata— y el refresco son precios. Si el
tiempo no alcanza para los dos, el que se saltea es el refresco y va en la
corrida siguiente, diez minutos después.

Sin `CRON_SECRET` la ruta devuelve 503 y **no pasa ninguna de las dos cosas**.

1. Generar el secreto:

   ```bash
   openssl rand -base64 32
   ```

2. Vercel → el proyecto → **Settings → Environment Variables** → `CRON_SECRET`,
   marcado para **Production**.
3. Redesplegar. Las variables de entorno no se aplican a un despliegue que ya
   está en el aire.
4. Verificar que la tarea corre: Vercel → **Cron Jobs**, o a mano:

   ```bash
   curl -s -H "Authorization: Bearer $CRON_SECRET" \
     https://<el-dominio>/api/cron/sincronizar
   ```

   Tiene que contestar `{"ok":true,...}`. Un 401 es el secreto equivocado; un
   503, que la variable no llegó al despliegue.

   En la respuesta, `catalogo` cuenta cómo le fue al refresco:

   | Lo que dice | Qué significa |
   |---|---|
   | `"corrio": true` con `leidos: 0` | Lo normal: no cambió nada en la tienda. |
   | `"corrio": true` con `leidos: 3` | Tres fichas cambiaron y ya están en el POS. |
   | `"corrio": false` con un `motivo` sobre `woo:sync` | El espejo está vacío. Correr `npm run woo:sync` una vez y el refresco sigue solo. |
   | `"saltado"` | La cola se llevó la corrida. Normal en un día de mucha venta; va en la siguiente. |

---

## 4. Migraciones: primero la base, después el código

Las migraciones **no corren solas al desplegar**, y es a propósito: una
construcción en Vercel no tendría por qué poder escribir en la base de
producción, y una vista previa terminaría migrándola sin que nadie lo pida.

La contrapartida es que se puede desplegar código que espera una columna que
todavía no existe. En el mostrador eso se ve como una pantalla rota sin
explicación, que es la peor forma de enterarse.

El orden es siempre el mismo:

```bash
npm run db:migrate                                          # 1. la base
npm run produccion:chequear -- --env .env.produccion --produccion   # 2. confirmar
git push                                                     # 3. el código
```

El chequeo compara las migraciones que el código trae contra las que la base
tiene aplicadas y **falla si falta alguna**, así que alcanza con correrlo antes
de cada despliegue. Cada migración va en su propia transacción: si una falla a
la mitad, no queda nada aplicado y se puede volver a correr.

---

## 5. Si se pierde la base

La base **es** el negocio: las ventas, la caja, el fiado y la bitácora viven
solo ahí. El catálogo se puede volver a traer de WooCommerce con
`npm run woo:sync`; lo demás, no.

**Antes de abrir el local con esto, hay que saber dos cosas:**

1. **Cuánto historial guarda el proveedor.** Neon guarda un historial de cambios
   que permite abrir una copia de la base «como estaba» en un momento anterior.
   Cuánto, depende del plan, y el número real está a la vista en el panel del
   proyecto: **Postgres → History retention**. El proyecto de Lucas, en el plan
   Free, dice **6 horas**.

   Seis horas alcanzan para el error que se ve en el momento —se borró algo
   recién y se vuelve atrás—, y no alcanzan para nada más. El error que se
   descubre al otro día, o el lunes, ya no está. Eso lo cubre la copia propia
   de acá abajo, que es independiente del plan que se pague.
2. **Cómo se restaura, probado una vez.** Un respaldo que nunca se restauró no
   es un respaldo. La forma de probarlo sin tocar producción es crear una rama
   de la base en el momento de ayer, apuntarle un `DATABASE_URL` local y ver que
   el POS levante y los números estén.

**Una copia que no depende del proveedor**, para tener el día anterior en un
archivo propio:

```bash
pg_dump "$DATABASE_URL" --no-owner --format=custom --file=pos-$(date +%F).dump
```

Son unos pocos megabytes al año. Guardarla fuera del proveedor —la misma nube
donde ya se guardan las fotos del local alcanza— cubre el caso que el historial
de Neon no cubre: que se pierda la cuenta, no la base.

**Cómo se comprueba que una copia sirve.** Restaurarla no alcanza: hay que
mirarla. Sobre la base restaurada se corre `npm run auditar` —los diecinueve
invariantes— y se abre el POS apuntándole. Si las dos cosas dan, la copia es
buena. Se probó así, y de paso apareció algo que conviene saber: el respaldo
tiene que incluir el esquema `drizzle`, donde vive la tabla de migraciones. Si
se pierde, el próximo `db:migrate` intenta aplicarlas todas de nuevo sobre una
base que ya las tiene.

**Volver atrás el código** es aparte y es fácil: Vercel guarda cada despliegue y
se vuelve al anterior desde su panel, en segundos. Lo que no se vuelve atrás así
es una migración: si un despliegue agregó una columna, volver al código anterior
funciona igual, porque una columna de más no molesta a nadie. **Por eso las
migraciones nunca borran ni renombran**: agregan.

---

## Lista final

Antes de que el mostrador empiece a usarlo:

- [ ] `pos.lucasinnovaciones.com.ar` abre el POS con candado verde
- [ ] `AUTH_TRUST_HOST="true"` cargado en Vercel
- [ ] `npm run produccion:chequear -- --env .env.produccion --produccion` sin faltantes
- [ ] Clave vieja de WooCommerce **revocada**, no solo reemplazada
- [ ] Contraseña de Neon reseteada y `DATABASE_URL` actualizada con la cadena pooled
- [ ] El `.env` local apunta al staging
- [ ] La tarea programada contestó `{"ok":true}`, con `catalogo.corrio` en `true`
- [ ] Un cambio de precio hecho en la tienda apareció en el POS dentro de los diez minutos
- [ ] `npm run woo:historico` corrido contra la tienda real, con las cuentas cerrando
- [ ] Sin panel rojo en **Estado del sistema**
- [ ] La tablet del mostrador abrió el POS con internet al menos una vez **desde el
      dominio de producción**: hasta que no pasa eso, el service worker no tiene
      nada guardado y un corte deja la pantalla en blanco
- [ ] El POS agregado a la pantalla de inicio de la tablet, y probado a pantalla completa
- [ ] Probado un corte de verdad: modo avión, una venta, y que entre sola al volver
- [ ] `npm run auditar` contra la base de producción, con los diecinueve invariantes dando
- [ ] Una restauración probada de verdad: abrir la base de ayer y ver que el POS levante
      *(el procedimiento ya se probó entero contra una base local —dump, restore,
      invariantes y el POS abriendo con los datos puestos—; falta hacerlo una vez
      contra la de producción)*
- [ ] Leído el **History retention** del panel de Neon, y decidido si alcanza
      (en el plan Free son 6 horas) o si hace falta la copia propia con `pg_dump`
- [ ] `curl https://<dominio>/manifest.webmanifest` devuelve el JSON y no un redirect
      al login: si redirige, el POS no se puede instalar en la tablet
