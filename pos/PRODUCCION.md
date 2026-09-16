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
