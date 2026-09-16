# Runbook — Despliegue del tema y del plugin

**Estado:** cadena completa probada en local (manifiesto → ZIP → extracción → verificación, 90/90 archivos). **Nunca ejecutado todavía contra el servidor.**

Este documento cubre **cómo se sube código**. La purga de Elementor es otra cosa y va en [RUNBOOK-LIMPIEZA.md](RUNBOOK-LIMPIEZA.md), después de que el tema esté activo y estable.

---

## Por qué hay un manifiesto

El único acceso al servidor es el MCP de Novamira. No hay `rsync`, no hay `git pull` en el hosting, no hay CI. Se sube un ZIP y se confía.

Un ZIP se descomprime **encima** de lo que había. Los archivos que ya no existen en el repositorio no se borran solos, y **WordPress usa las plantillas que encuentra, no las que uno cree haber subido**: un `archive-product.php` viejo que quedó en la raíz del tema toma precedencia sobre el que está en `woocommerce/`, y no hay ningún síntoma hasta que alguien ve una página con el diseño de hace dos versiones.

`despliegue/manifest.md5` es la lista de los 90 archivos que tienen que estar, con su hash. `despliegue/verificar.php` la contrasta contra el servidor y responde tres preguntas:

| Resultado | Qué significa |
|---|---|
| `FALTA` | No llegó. ZIP incompleto o descompresión a medias |
| `DIFIERE` | Llegó corrupto o alterado. **También delata una edición hecha a mano en el servidor** |
| `SOBRA` | Hay un archivo que el repositorio no tiene. Resto de una versión anterior |

Por eso `.gitattributes` fuerza `eol=lf`: con CRLF los hashes no coincidirían nunca aunque el contenido fuera idéntico, y la verificación no serviría para nada.

---

## ⚠️ Antes de empezar

1. **Fuera de horario comercial.** El local atiende de 9 a 12:30 y de 17 a 21. La ventana es después de las 21.
2. **Staging primero, siempre.** Ningún ZIP toca producción sin haber pasado por `/staging` y haber dado 90/90.
3. **El POS no se toca.** El tema no interviene en el flujo del POS —YITH es una SPA que consume la REST API— pero eso se confirma después de cada despliegue, no se asume.
4. **`hello-elementor` se queda instalado** hasta que el tema propio lleve semanas estable. Es el rollback: un comando y el sitio vuelve atrás.

---

## Paso 1 — Preparar el paquete (local, sin tocar nada)

```bash
./despliegue/generar-manifiesto.sh   # regenera manifest.md5 desde el commit
./despliegue/empaquetar.sh           # arma los dos ZIP en dist/
```

Ambos scripts **se niegan a correr con cambios sin commitear**. No es celo: un manifiesto generado sobre un borrador describe un estado que no existe en ningún lado y que mañana nadie puede reproducir. Y `empaquetar.sh` usa `git archive`, que empaqueta el commit y no el directorio — con cambios sin commitear subirías una versión vieja creyendo que subís la nueva.

Sale:

```
dist/lucas-innovaciones-0.1.0-<commit>.zip
dist/lucas-cotizacion-1.0.0-<commit>.zip
```

El commit va en el nombre del archivo a propósito: dentro de tres meses, mirando el servidor, se va a poder decir exactamente qué se desplegó.

**Si cambió algo del tema, subir la versión** en `style.css` (`Version:`) y en `functions.php` (`LI_VERSION`) antes de empaquetar. `assets.php` cachea por `filemtime`, así que los usuarios ven el CSS nuevo igual, pero la versión es lo que permite saber qué hay puesto sin ir a comparar hashes.

---

## Paso 2 — Subir a staging

1. Subir los dos ZIP con `novamira/create-upload-link` contra el endpoint de **staging**. Anotar la ruta que devuelve.
2. Subir también `despliegue/manifest.md5` a `wp-content/uploads/li-despliegue/manifest.md5`. Es texto plano: el MCP lo escribe sin problema (la restricción es solo para archivos PHP fuera de su sandbox).
3. Instalar por WP-CLI:

```bash
wp theme install  <ruta>/lucas-innovaciones-0.1.0-<commit>.zip --force
wp plugin install <ruta>/lucas-cotizacion-1.0.0-<commit>.zip  --force --activate
```

**`--force` no es opcional:** sin él WP-CLI se niega a reinstalar algo que ya existe.

Lo que `--force` **no** garantiza es que borre los archivos de la versión anterior que el ZIP nuevo ya no trae. Depende de cómo el instalador de WordPress trate el destino, y no está verificado contra este hosting. Por eso existe el chequeo de `SOBRA`: si aparece alguno en el paso 3, se borra a mano por el MCP y se vuelve a verificar. **La primera vez que se despliegue conviene mirar ese apartado con particular atención** — es la corrida que dice cómo se comporta realmente este servidor.

4. Activar el tema (solo la primera vez, o después de un rollback):

```bash
wp theme activate lucas-innovaciones
```

---

## Paso 3 — Verificar en staging

**Primero la integridad.** Ejecutar el contenido de `despliegue/verificar.php` por el MCP, o:

```bash
wp eval-file despliegue/verificar.php
```

El script no se despliega: no forma parte del tema ni del plugin, se ejecuta contra el servidor. Tiene que decir:

```
90 de 90 archivos coinciden.
RESULTADO: el servidor coincide exactamente con el repositorio.
```

**Cualquier otra cosa frena el despliegue.** No se sigue "a ver si igual anda".

**Después lo funcional** — el checklist de siempre:

- [ ] Home, Tienda, Carrito, Finalizar compra, Mi cuenta y una ficha de producto responden **200**
- [ ] Cero `Fatal error` y cero `Warning:` en el HTML
- [ ] Conteos intactos: **803 productos · 3.764 pedidos · 82 categorías · 243 sesiones de caja**
- [ ] El catálogo pagina y los filtros por categoría, marca y precio devuelven resultados
- [ ] La ficha de un producto variable muestra el selector de modelo compatible
- [ ] **El POS de YITH abre y permite registrar una venta de prueba**

Y limpiar la caché de fragmentos, que si no el menú y la portada siguen mostrando el árbol viejo:

```bash
wp cache flush
wp transient delete --all
```

---

## Paso 4 — Producción

Mismo procedimiento del paso 2, contra el endpoint de producción, después de las 21.

**Dos advertencias que solo aplican acá:**

### La verificación funcional hay que hacerla con sesión iniciada

`woocommerce_coming_soon = yes` en producción: para cualquiera que no esté logueado, la tienda es una pantalla de "próximamente". **Cargar las páginas sin sesión no prueba nada** — devuelven 200 y no muestran nada del tema. La verificación se hace con el navegador logueado como administrador.

### La Home no se rompe al activar el tema

La Home actual está construida con Elementor y su diseño vive dentro de `_elementor_data`. Podría parecer que activar el tema propio la deja en blanco. No pasa: el tema tiene `front-page.php`, que **toma precedencia sobre el contenido de la página** y dibuja la portada entera por su cuenta, sin leer nada de lo que Elementor haya dejado ahí.

Lo que sí conviene mirar: con Elementor todavía activo, sus hojas de estilo se siguen encolando en todo el sitio y pueden pisar cosas. Es cosmético y desaparece con la purga. Si molesta antes de eso, se desactiva el plugin sin desinstalarlo.

---

## Paso 5 — Verificar en producción

Mismo `verificar.php`, mismo checklist del paso 3, más:

- [ ] `wp option get stylesheet` devuelve `lucas-innovaciones`
- [ ] El plugin de cotización aparece activo en el informe del verificador
- [ ] **Una venta real del día siguiente entra sin novedad por el POS**

Sobre la caché: producción tiene el dropin `object-cache.php` de LiteSpeed corriendo contra Valkey, **sin el plugin instalado** — no hay botón de purga en el escritorio. `wp cache flush` funciona igual porque habla con el dropin directamente. Es la única vía, y hay que usarla: los transients del menú y de la portada viven ahí.

---

## Rollback

Si algo sale mal, sin discusión y sin diagnosticar en caliente:

```bash
wp theme activate hello-elementor
wp cache flush
```

El tema anterior sigue instalado. Vuelve todo al estado previo en segundos, y el diagnóstico se hace después, en staging, con calma.

**El rollback no toca el plugin de cotización.** Ese sí conviene dejarlo activo: si se desactiva, los precios en pesos dejan de actualizarse y quedan clavados al último valor escrito — que es peor que el problema que se estaba resolviendo.

---

## Fuera de este runbook

- **La purga de Elementor** — [RUNBOOK-LIMPIEZA.md](RUNBOOK-LIMPIEZA.md), y su requisito previo es que este runbook ya se haya ejecutado con éxito.
- **Los tres interruptores del lanzamiento:** `woocommerce_coming_soon` (P26), `blog_public` (P19) y el `robots.txt` de DonWeb (P18). Ninguno se toca al desplegar.
- **La carga de los atributos `pa_*` en producción.** Hoy están en 0 de 807 productos: el tema se va a desplegar bien y el panel de filtros va a aparecer vacío. Es esperable y no es un fallo del despliegue.
