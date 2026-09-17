# Salir a producción

Tres cosas se configuran fuera de este repositorio: en **Neon**, en
**WooCommerce** y en **Vercel**. Ninguna falla de forma ruidosa cuando falta —el
drenaje programado simplemente no corre, y apuntarle a la tienda equivocada
simplemente escribe el stock en el lugar equivocado—, así que están acá, con el
paso a paso.

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

## 3. El drenaje programado de la cola

Cada venta descuenta el stock en el POS y deja el ajuste en una cola hacia
WooCommerce. Esa cola se vacía al confirmar una venta **y** cada diez minutos,
por la tarea programada de `vercel.json`. Sin `CRON_SECRET`, la ruta devuelve
503 y el segundo camino no existe: si la tienda se cae después de la última
venta del día, el stock queda desactualizado hasta la primera venta del día
siguiente.

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

---

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
   En el plan gratuito son **24 horas**; en los planes pagos, más. Veinticuatro
   horas alcanzan para el error de un rato, no para el que se descubre el lunes.
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

- [ ] `npm run produccion:chequear -- --env .env.produccion --produccion` sin faltantes
- [ ] Clave vieja de WooCommerce **revocada**, no solo reemplazada
- [ ] Contraseña de Neon reseteada y `DATABASE_URL` actualizada con la cadena pooled
- [ ] El `.env` local apunta al staging
- [ ] La tarea programada contestó `{"ok":true}`
- [ ] Los webhooks de WooCommerce dados de alta con `WOO_WEBHOOK_SECRET`
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
- [ ] Sabido cuánto historial guarda el plan de Neon que se está pagando
- [ ] `curl https://<dominio>/manifest.webmanifest` devuelve el JSON y no un redirect
      al login: si redirige, el POS no se puede instalar en la tablet
