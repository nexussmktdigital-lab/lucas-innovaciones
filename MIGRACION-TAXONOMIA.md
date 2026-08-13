# Migración de taxonomía — staging → producción

**Estado: APLICADO EN PRODUCCIÓN el 2026-08-06.** Verificado — ver "Resultado" al final.
**Generado:** 2026-08-06, comparando las dos bases en vivo, sólo lectura.

Este documento existe porque la reestructuración de categorías se hizo directamente
sobre la base de staging y no quedó registrada en ningún lado. El único respaldo era
`/wp-content/uploads/li-taxonomia-antes.json` en el servidor y la propia base viva. Si
staging se vuelve a clonar desde producción, ese trabajo se pierde. Acá está el mapa
completo para reproducirlo.

El tema nuevo depende de este árbol: el mega menú se arma leyendo `product_cat`. Con el
árbol actual de producción mostraría 52 categorías madre, más de la mitad vacías, y con
`mate`, `mates` y `mate-y-termos` como tres entradas distintas.

---

## Resumen

| | Producción hoy | Después |
|---|---|---|
| Términos de `product_cat` | 112 | 82 |
| Categorías madre | 52 | 21 |
| Productos en `sin-categorizar` | 21 | 0 |
| Productos ocultos del catálogo | 0 | 6 |
| `smartphones` como madre de nuevos/usados | no existe | sí |

**Sólo 35 productos de 807 cambian de categoría.** El resto de la migración es
estructura: crear 2 términos, renombrar 12, reparentar 2 y borrar 32 vacíos.

Ningún producto se borra, ningún precio se toca, ningún pedido se altera. El POS sigue
vendiendo durante toda la operación: las categorías se reordenan, los productos no se
mueven de lugar salvo los 35 listados.

---

## Orden de ejecución

El orden **no es opcional**. Ocho de los doce renombres piden un slug que hoy está
ocupado por un término que se borra:

| Término | Quiere el slug | Hoy lo tiene |
|---|---|---|
| 136 | `notebooks` | 18 (se borra) |
| 154 | `tablets` | 20 (se borra) |
| 182 | `perifericos` | 27 (se borra) |
| 268 | `almacenamiento` | 45 (se borra) |
| 606 | `mates` | 40 (se borra) |
| 636 | `termos` | 37 (se borra) |
| 849 | `fundas` | 51 (se borra) |
| 1471 | `accesorios-vehiculo` | 49 (se borra) |

Si se renombra antes de borrar, WordPress no avisa: le agrega un `-2` al slug y queda
`notebooks-2`. Es exactamente cómo aparecieron los `accesorios-vehiculo-2` y
`accesorios-audio-2` que hoy hay que limpiar. **Borrar primero, renombrar después.**

Y los productos se reasignan **antes** de borrar, para que ninguno quede huérfano en el
momento en que su categoría desaparece.

```
1. Respaldo
2. Crear los 2 términos nuevos
3. Reasignar los 35 productos
4. Borrar los 32 términos muertos
5. Renombrar los 12 slugs (+1 nombre)
6. Reparentar smartphones nuevos/usados
7. Ocultar del catálogo las 6 réplicas
8. Recontar y verificar
```

---

## 1. Respaldo

Antes de tocar nada, volcar a JSON todas las asignaciones producto → categoría y la
tabla de términos completa, igual que se hizo en staging. Sin este archivo el paso 4 es
irreversible.

---

## 2. Crear (2)

| id en staging | slug | nombre | padre |
|---|---|---|---|
| 2068 | `smartphones` | Smartphones | `telefonos-y-tablets` |
| 1965 | `solo-mostrador` | Solo mostrador | raíz |

Los `term_id` de producción y staging coinciden porque staging es un clon: por eso todo
el mapeo de este documento se hace por identificador y no por nombre, y los renombres
quedan capturados sin ambigüedad. Los dos términos nuevos tomarán ids propios en
producción; lo que importa es el slug.

`solo-mostrador` es la categoría de la decisión D19: las réplicas salen del catálogo
online pero siguen vendiéndose en el mostrador.

---

## 3. Reasignar productos (35)

`-[...]` es lo que pierde, `+[...]` lo que gana.

### Los 21 huérfanos de `sin-categorizar`

| id | Producto | Destino |
|---|---|---|
| 7232 | Microfono corbatero doble tipo c/ estuche | `microfonos` |
| 7233 | Microfono corbatero doble K9 tipo c | `microfonos` |
| 7234 | Lector adaptador de memoria micro sd | `almacenamiento` |
| 7680 | Cargador de pilas grandes 3,7v | `cargadores-de-pared` |
| 7685 | Conversor adaptador HDMI a RCA | `adaptadores-y-conversores` |
| 7778 | Kit Directv prepago 46cm | `tv-y-video` |
| 7779 | Kit Directv prepago 60cm | `tv-y-video` |
| 7801 | Parlante MALIBU MS3627 4'' | `parlantes-portatiles` |
| 7803 | Auriculares Manos libres Fox box link 2 tipo C | `auriculares-con-cable` |
| 7807 | Camara ip wifi inteligente | `camaras-de-seguridad` |
| 7809 | Soporte holder para auto bracket sucker | `soportes-y-holders` |
| 7810 | Soporte para auto magnetico Magnetx | `soportes-y-holders` |
| 7811 | Reloj Smartwatch Bulltec DUO Watch | `smartwatches` |
| 7970 | Tv Box convertidor con ON PLAY | `tv-box-y-streaming` |
| 7986 | Palo Selfie SEISA con luces y tripode | `soportes-y-holders` |
| 7988 | Cable Optico audio 1,5m | `cables-de-audio` |
| 7989 | Parlante KOLKE KPM687 BowBox 3'' | `parlantes-portatiles` |
| 7991 | Cargador Fox Box MEGA 20W C/cable tipo C | `cargadores-de-pared` |
| 7992 | Cargador de auto 12v Ringo 30w | `cargadores-de-auto` |
| 7995 | Calefactor Convector EMBASSY EMS2000 2000w | `climatizacion` |
| 8023 | Camara para auto KM61129 | `camaras-de-seguridad` |

### Los que estaban en categorías que se borran (6)

| id | Producto | Cambio |
|---|---|---|
| 7030 | Consola de juegos Family game HBL Tech | `video-juegos` → `gaming` |
| 7031 | Consola de juegos Game Stick 3D | `video-juegos` → `gaming` |
| 7032 | Consola de juegos Game Stick LITE | `video-juegos` → `gaming` |
| 7315 | Camara instantanea digital S09 | `camaras` → `camaras-de-seguridad` |
| 7799 | Caja fuerte digital Global | `seguridad` → `seguridad-y-camaras` |
| 7115 | Silla de oficina NOGANET | `perifericos` (27) → `perifericos` (182) |

El 7115 parece que no cambia, pero cambia: pasa del término 27 —una madre suelta que se
borra— al 182, que es la subcategoría real de Computación y que **después** del borrado
toma ese mismo slug.

### Mal clasificados (2)

| id | Producto | Cambio |
|---|---|---|
| 6494 | Funda premium 1 | `vidrios-templados-e-hidrogel` → `fundas` |
| 6984 | Funda premium 2 | `vidrios-templados-e-hidrogel` → `fundas` |

### Réplicas a mostrador (6)

Suman `solo-mostrador` sin perder su categoría actual.

| id | Producto |
|---|---|
| 6601 | Auriculares AKG rep |
| 6848 | Auricular JBL Wave 380 Rep premium |
| 6944 | Joystick PS3 replica SONY AAA |
| 6961 | Roku Express Replica android |
| 7305 | Auriculares Airpods Pro Rep |
| 7306 | Auriculares Airpods Pro Rep 2 |

---

## 4. Borrar (32)

Todas están en la raíz y, después del paso 3, **todas quedan en cero productos**. Son
restos de importaciones viejas y duplicados de categorías que ya existen bien armadas
más abajo en el árbol.

`16 telefonos` · `18 notebooks` · `19 camaras` · `20 tablets` · `21 smartwatch` ·
`22 auriculares` · `24 conectividad` · `25 mouse` · `26 teclado` · `27 perifericos` ·
`28 joystick` · `29 video-juegos` · `31 cargadores` · `32 luces` · `35 mate` ·
`36 cuero` · `37 termos` · `38 bombillas` · `39 vasos-termicos` · `40 mates` ·
`41 tapas` · `42 contadora-de-billetes` · `43 seguridad` · `44 hogar` ·
`45 almacenamiento` · `46 cables` · `49 accesorios-vehiculo` · `50 vidrio-templado` ·
`51 fundas` · `53 vidrios-templados-hidrogel` · `54 televisores` ·
`55 aires-acondicionados`

`sin-categorizar` (15) **no se borra**: es la categoría por defecto de WordPress y no se
puede eliminar. Queda vacía.

---

## 5. Renombrar (12 slugs, 1 nombre)

Sólo cambian los slugs, que es lo que se ve en la URL. Los nombres visibles se dejan
como están —el POS los muestra en pantalla y el vendedor los tiene memorizados— con una
sola excepción, el término 619, donde "Accesorios" a secas no se entendía.

| id | slug actual | slug nuevo |
|---|---|---|
| 98 | `smartwatch-smartwatch-y-wearables` | `smartwatches` |
| 136 | `notebooks-computacion` | `notebooks` |
| 154 | `tablets-telefonos-y-tablets` | `tablets` |
| 182 | `perifericos-computacion` | `perifericos` |
| 268 | `almacenamiento-computacion` | `almacenamiento` |
| 606 | `mates-mate-y-termos` | `mates` |
| 619 | `accesorios` | `accesorios-mate` — **nombre: Accesorios → Accesorios de mate** |
| 636 | `termos-mate-y-termos` | `termos` |
| 849 | `fundas-accesorios-para-celular` | `fundas` |
| 1287 | `switches-y-red` | `switches` |
| 1471 | `accesorios-vehiculo-2` | `accesorios-vehiculo` |
| 1575 | `accesorios-audio-2` | `accesorios-de-audio` |

Las imágenes de categoría del tema se buscan por slug en
`assets/img/categorias/{slug}.webp`. Con los slugs viejos, los medallones caen al ícono
por defecto. Este paso es el que los enciende.

---

## 6. Reparentar (2)

| id | slug | padre actual | padre nuevo |
|---|---|---|---|
| 68 | `smartphones-nuevos` | `telefonos-y-tablets` | `smartphones` |
| 1362 | `smartphones-usados` | `telefonos-y-tablets` | `smartphones` |

Es el pedido explícito: Smartphones como categoría madre de nuevos y usados. 58 + 18 =
76 productos bajo la nueva madre.

---

## 7. Ocultar las réplicas (6)

Asignar `exclude-from-catalog` de la taxonomía `product_visibility` a los 6 productos
del paso 3. Producción hoy tiene **0** productos ocultos; staging tiene 6. Sin este paso
las réplicas aparecen en la tienda online.

---

## 8. Recontar y verificar

Correr el recuento de términos de WooCommerce y comprobar:

| Comprobación | Esperado |
|---|---|
| Términos de `product_cat` | 82 |
| Categorías madre | 21 |
| Productos en `sin-categorizar` | 0 |
| Productos ocultos del catálogo | 6 |
| Rama de `smartphones` | 76 |
| Rama de `telefonos-y-tablets` | 83 |
| Rama de `audio` | 106 |
| Productos publicados | 803 |

**Ojo con el contador de WooCommerce.** `_wc_term_recount()` guarda cuentas **directas**,
sin descendencia: después de correrlo, `smartphones` marca 0 porque no tiene productos
propios, y `audio` marca 1 en vez de 106. El tema no usa ese contador — calcula el suyo
con descendencia en `li_cuentas_por_rama()`— pero cualquier listado que use
`hide_empty => true` haría desaparecer a Smartphones del menú. Es la razón por la que el
tema no confía en `count`.

---

## Resultado de la ejecución — 2026-08-06

Corrida en el orden de este documento, paso por paso, verificando entre cada uno.
Todo con la API de WordPress (`wp_insert_term`, `wp_set_object_terms`,
`wp_remove_object_terms`, `wp_delete_term`, `wp_update_term`) y no con SQL directo,
para que WooCommerce mantenga sus propias estructuras.

| Comprobación | Esperado | Obtenido |
|---|---|---|
| Términos de `product_cat` | 82 | **82** |
| Categorías madre | 21 | **21** |
| Productos en `sin-categorizar` | 0 | **0** |
| Productos ocultos del catálogo | 6 | **6** |
| Rama de `smartphones` | 76 | **76** |
| Rama de `telefonos-y-tablets` | 83 | **83** |
| Rama de `audio` | 106 | **106** |
| Productos publicados | 803 | **803** |

- 35 productos reasignados, 0 fallos.
- 32 términos borrados, 0 errores. Cada uno se comprobó vacío y sin hijas **antes**
  de borrarlo.
- Los 12 renombres quedaron con el slug exacto pedido, sin sufijos `-2`. El orden
  borrar → renombrar funcionó.
- `wc_category_lookup` quedó correcta sola: la fila de `smartphones` lista su árbol
  como `67, 1965`. Es la prueba de que convenía usar la API y no SQL: esa tabla la
  mantiene WooCommerce por hooks, y a mano habría quedado desincronizada.
- Los ids nuevos en producción son `smartphones` = 1965 y `solo-mostrador` = 1966
  (en staging son 2068 y 1965). Quedan guardados en la opción `li_migracion_ids`.
- **Verificación final:** los árboles de producción y staging se compararon término
  por término como pares `slug < slug-del-padre`, independiente de los ids. 82 y 82,
  idénticos, sin diferencias en ningún sentido.

Respaldo previo: `wp-content/uploads/li-taxonomia-produccion-antes-20260806.json`,
114 KB, 214 términos y 1.404 relaciones.

---

## Lo que este documento no cubre

- **Los atributos `pa_*`.** Producción no tiene ninguno cargado: 0 de 807 productos. Sin
  ellos los filtros por característica no aparecen. Es un trabajo aparte, con los 201 ya
  mapeados en `mapa-atributos.csv` y los ~600 restantes a derivar de los títulos.
- **La activación del tema**, que va después de esto.
- **Las imágenes de producto**, que siguen faltando en 143 productos.
