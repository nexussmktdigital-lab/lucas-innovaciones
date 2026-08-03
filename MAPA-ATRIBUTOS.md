# Mapa de atributos — catálogo Lucas Innovaciones

**Fecha:** 2026-08-03 · derivado de los 803 títulos reales del catálogo, no de supuestos.
**Archivo de trabajo:** [mapa-atributos.csv](mapa-atributos.csv) — 200 productos con los atributos **ya pre-cargados** por extracción automática desde el título.

---

## 1. Por qué hace falta

El template SWOO (D17) trae un catálogo con filtros laterales: marca, precio, memoria, color y **condición (New / Like New / Open Box)**. Hoy el sitio tiene **cero atributos globales** — los 803 productos son simples y pelados. Sin esta taxonomía, el catálogo no filtra nada.

---

## 2. Taxonomía propuesta

### Ya existe — no duplicar

| Taxonomía | Estado |
|---|---|
| `product_brand` | **Nativa de WooCommerce, 93 términos cargados.** Se usa tal cual. No crear un `pa_marca` |
| `product_cat` | 112 categorías. Requiere normalización (P14) |

### Transversales — aplican a casi todo

| Atributo | Valores | Cobertura auto |
|---|---|---|
| **`pa_condicion`** | Nuevo · Sellado · Como nuevo · Usado · Outlet | 19 / 200 |
| **`pa_gama`** | Original · Premium · AAA · AA · Común · Económico | 19 / 200 |

`pa_gama` no es invención: es el vocabulario real del negocio. Aparece en 37 productos del catálogo completo (AAA 11, premium 9, original 8, común 3, AA 2, económico 4). Es el eje por el que este mercado diferencia precio.

`pa_condicion` mapea directo al filtro que el template ya trae.

### Específicos por familia

| Atributo | Valores detectados | Cobertura auto | Familias |
|---|---|---|---|
| **`pa_conector`** | Tipo C (46) · HDMI (21) · Lightning (16) · Jack 3.5 (17) · USB A (9) · Micro USB (9) | 45 / 200 | Cables, cargadores, adaptadores, audio |
| **`pa_capacidad`** | 128GB (47) · 256GB (28) · 512GB (7) · 64 · 32 · 16 | 36 / 200 | Smartphones, almacenamiento |
| **`pa_potencia`** | 20W (11) · 25W · 30W · 65W · 5W · 15W — y 200–800W en audio y cocina | 33 / 200 | Cargadores, parlantes, electrodomésticos |
| **`pa_pulgadas`** | 43" · 50" · 55" · 60" · 75" (TV) · 3"–15" (parlantes, monitores) | 19 / 200 | TV, monitores, parlantes |
| **`pa_longitud`** | 1m · 1.25m · 1.5m · 2m · 3m | 11 / 200 | Cables |
| **`pa_memoria-ram`** | 4GB · 6GB · 8GB · 12GB | 5 / 200 | Smartphones |

> **Nota sobre potencia:** conviene separar `pa_potencia-carga` (5–100W, cargadores) de `pa_potencia-audio` (200–800W, parlantes). Mezclarlos produce un filtro con un rango inútil.

### Datos de unidad — NO son atributos de catálogo

| Dato | Dónde va |
|---|---|
| **IMEI** (54 productos, 50 valores distintos) | Campo de unidad, gestionado por el plugin del POS (D13) |
| **Salud de batería** (46 productos, 73%–100%) | Campo de unidad. Para el comprador se expone como rango: 100% · 90–99% · 80–89% · <80% |

Ver la separación modelo/unidad en la sección 8.1 de BASES.md.

### Descartado por ahora

**`pa_color`.** El template lo muestra, pero **solo 5 de 803 productos mencionan color en el título**. Cargarlo significa data entry manual puro sobre 150 fichas. Recomiendo dejarlo fuera del lanzamiento y evaluarlo después, cuando haya fotos que lo hagan evidente.

---

## 3. Cobertura de la extracción automática

Sobre los 150 productos del lanzamiento:

| | |
|---|---|
| Con al menos un atributo detectado | **102 / 150** |
| Sin ningún atributo | **48 / 150** |

Por categoría:

| Categoría | Productos | Con atributos |
|---|---|---|
| Smartphones nuevos | 25 | 23 |
| Cargadores de pared | 17 | 16 |
| Cables de carga | 13 | 13 |
| Vidrios templados e hidrogel | 11 | **4** |
| Smartphones usados | 6 | 6 |
| Auriculares con cable | 6 | **2** |
| Auriculares inalámbricos | 6 | 3 |
| Parlantes profesionales | 5 | 4 |
| Soportes para TV | 4 | 4 |
| Almacenamiento | 4 | 4 |
| Cargadores de auto | 4 | 3 |
| Periféricos | 4 | **0** |
| Routers y WiFi | 3 | **0** |
| Vapers | 3 | **0** |
| Adaptadores y conversores | 3 | 2 |

La extracción funciona muy bien donde el título codifica specs (telefonía, cables, cargadores) y no funciona donde el título es puramente descriptivo (periféricos, routers, vapers). Para esos, la carga es manual — pero son pocos.

---

## 4. Tres hallazgos que afectan el alcance del lanzamiento

### 4.1 🟢 EN CURSO — Productos variables por modelo (2026-08-03)

**Decisión del cliente:** vidrios y fundas pasan a productos variables por modelo.

#### Atributo creado

**`pa_modelo` — "Modelo compatible"**, público, tipo select, con **40 términos** ordenados:

| Marca | Modelos |
|---|---|
| Apple | iPhone 11 · 12 · 12 Pro · 12 Pro Max · 13 · 13 Pro · 13 Pro Max · 14 · 14 Pro · 14 Pro Max · 15 · 15 Pro · 16 · 16 Pro · 16 Pro Max · 17 · 17 Pro · 17 Pro Max |
| Samsung | Galaxy A03 · A06 · A15 · A16 · A17 · A24 · A36 5G · M55 5G |
| Motorola | Moto G05 · G06 · G15 · G54 5G · G85 5G |
| Xiaomi | Redmi 15C · Redmi Note 14 Pro 5G · Redmi Note 15 Pro · Poco C65 · Poco C71 |
| Otros | Realme C71 · Nokia 106 · Nokia 110 4G |
| — | **Otro modelo (consultar)** |

**Criterio de la lista:** son los modelos con evidencia real de venta en el catálogo (76 teléfonos, normalizados a 39 modelos + un comodín). Se descartó una lista amplia de modelos populares: como **no llevan control de stock por modelo**, prometer 200 modelos genera pedidos que no pueden cumplir. La lista se amplía después, según lo que los clientes pidan.

#### Piloto ejecutado

Producto **6485 "Vidrio templado 9D"** (#1 en rotación, 53 unidades/año):

| | Antes | Después |
|---|---|---|
| Tipo | simple | **variable** |
| Stock | 9.708 (ficticio) | Sin gestionar, `instock` |
| Variaciones | — | **40**, con SKU propio (`531-IPHONE-13`, …) |
| Comprable | sí | **sí** |

Creación de las 40 variaciones: **2,4 segundos**. Datos verificados: `get_available_variations()` devuelve 40, todas comprables, con `attribute_pa_modelo` correcto y el lookup de WooCommerce sincronizado.

#### Impacto en el mostrador

El buscador de YITH POS incluye variaciones **solo al escanear código de barras** (`yith_pos_search_include_variations`). En búsqueda por texto devuelve el producto padre.

Consecuencia práctica para el cajero:

- **Buscando por texto:** encuentra "Vidrio templado 9D" y debe elegir el modelo → **un toque más** que hoy
- **Escaneando código de barras:** llega directo a la variación, porque cada una tiene SKU propio

Es fricción real en el mostrador, a cambio de poder vender online. Y tiene una ventaja: por primera vez van a saber **qué modelos se venden**.

> **Pendiente de confirmación humana:** abrir el POS en staging y vender un "Vidrio templado 9D" para verificar el selector de variación.

#### ✅ Conversión completa — 15 productos, 600 variaciones

Ejecutada el 2026-08-03. **Stock sin gestionar** en todos (decisión del cliente): siempre comprables.

| Producto | Precio | Variaciones |
|---|---|---|
| Vidrio templado 9D \| glass 9d | $5.000 | 40 |
| Vidrio templado \| glass | $4.000 | 40 |
| Hidrogel Clear AAA | $8.000 | 40 |
| Hidrogel premium | $12.000 | 40 |
| Hidrogel anti espia | $14.000 | 40 |
| Hidrogel matte | $10.000 | 40 |
| Hidrogel clear AA | $5.000 | 40 |
| Hidrogel blue light | $10.000 | 40 |
| Nano glass | $5.000 | 40 |
| **Funda comun** | $8.000 | 40 |
| **Funda economica** | $7.000 | 40 |
| Funda premium 1 | $10.000 | 40 |
| Funda premium 2 | $11.000 | 40 |
| Glass de cámaras | $4.500 | 40 |
| Glass de cámaras brillo | $5.000 | 40 |

**Verificación:** 15/15 con `get_available_variations()` = 40, comprables, en stock, visibles. **0 productos con problemas. 0 SKU duplicados en todo el sitio.**

**Impacto en la base:** +600 posts de tipo `product_variation`, +11.995 filas de postmeta. La base se mantiene en 62,3 MB.

**Corrección aplicada de paso:** "Funda premium 1" y "Funda premium 2" estaban categorizadas en *Vidrios templados e hidrogel*. Se movieron a *Fundas*.

#### 🐛 Trampa de SKU (para el runbook de producción)

El primer intento generó los SKU de variación truncando el slug a 16 caracteres:

```php
strtoupper(str_replace('-','',substr($t->slug,0,16)))   // ← MAL
```

`samsung-galaxy-a03`, `samsung-galaxy-a06`, `samsung-galaxy-a15`… todos truncan a `samsung-galaxy-a` → **el mismo SKU**. WooCommerce abortó con `Invalid or duplicated SKU` y dejó un producto a medias con 31 variaciones.

Forma correcta — slug completo más una guardia de unicidad:

```php
$c = strtoupper($base.'-'.$slug);
if (wc_get_product_id_by_sku($c)) $c = strtoupper($base.'-'.$ID.'-'.$slug);
```

La lógica reanudable salvó la situación: al reintentar detectó las 31 existentes y creó solo las 9 faltantes. **Cualquier conversión masiva en producción debe ser reanudable por atributo, no por contador.**

#### Productos NO convertidos (14 originales, referencia)

| Grupo | Productos | Lista de modelos |
|---|---|---|
| Protectores de pantalla | Vidrio templado, Hidrogel Clear AAA, Hidrogel premium, Hidrogel anti espía, Hidrogel matte, Hidrogel clear AA, Nano glass, Hidrogel blue light | `pa_modelo` (celulares) |
| Fundas | **Funda comun (45 u/año)**, **Funda economica (28 u)**, Funda premium 1, Funda premium 2 | `pa_modelo` (celulares) |
| Protectores de cámara | Glass de cámaras, Glass de cámaras brillo | `pa_modelo` (celulares) |
| Otros dispositivos | Hidrogel smartwatch, Hidrogel tablet | **Listas propias**, aún sin definir |

**No convertir** (falsos positivos del patrón): Cobertor funda para fuentes 20w, Funda notebook diseño, Protector de carga USB — son productos concretos, no genéricos por modelo.

#### Decisión pendiente: el stock

Ninguno de estos productos lleva control de stock real hoy: los valores son `9708`, `9884`, `999979`, `99939` o directamente sin gestionar. Con variaciones hay dos caminos:

- **Sin gestión de stock** (lo aplicado en el piloto): siempre comprable. Riesgo de vender un modelo que no tienen.
- **Stock por variación**: correcto, pero exige que carguen y mantengan 40 números por producto. Con el hábito actual, no va a pasar.

Recomendación: mantener sin gestión, y en el checkout advertir que los modelos menos comunes pueden demorar. Revisar cuando el POS propio permita cargar stock por variación con menos fricción.

---

### 4.1-original — Diagnóstico (histórico)

| Puesto | Producto | Unidades 12m | Problema |
|---|---|---|---|
| 1 | Vidrio templado 9D \| glass 9d | 53 | Sin modelo de teléfono. Stock ficticio: 9.708 |
| 2 | Funda comun | 45 | Sin modelo de teléfono. Stock sin gestionar |
| 3 | Hidrogel Clear AAA | 28 | Ídem |
| 4 | Funda economica | 28 | Ídem |
| 5 | Hidrogel premium | 22 | Ídem |

Son **SKU de mostrador**, no de ecommerce. En el local el vendedor pregunta "¿qué teléfono tenés?" y saca el correcto del cajón. Online eso no existe: nadie compra un vidrio templado sin saber si le entra.

**Falta el atributo más importante de todos: `pa_modelo-compatible`.** Y no es trivial — implica una lista de modelos de teléfono y convertir cada genérico en producto variable, o pedir el modelo en el checkout.

**Impacto:** los 5 productos de mayor rotación del negocio, y 11 de los 150 del lanzamiento, están bloqueados hasta resolver esto. **Es la decisión más urgente del mapa.**

### 4.2 ✅ RESUELTO — Réplicas fuera del catálogo online (2026-08-03)

**Decisión del cliente:** las réplicas salen del catálogo online y quedan solo para mostrador.

**Aplicado en staging.** Se revisaron los 803 productos: 10 títulos coincidían con patrones de imitación, pero **solo 6 son réplicas de marca**. Los otros 4 son productos genéricos legítimos y **no se tocaron** — "genérico" significa sin marca, y "símil cuero" es un material:

| No tocados | Motivo |
|---|---|
| Cargador de auto 12V Generico | Sin marca, no imita a nadie |
| Cable alimentacion generico interlook 220 cpu | Ídem |
| Reloj Smartwatch generico Luxy 37 | "Luxy" es la marca real |
| Matera canasta simil cuero | Descripción de material |

**Las 6 réplicas procesadas:**

| ID | Producto | Stock | Marca removida |
|---|---|---|---|
| 6601 | Auriculares AKG rep | 7 | — |
| 6848 | Auricular JBL Wave 380 Rep premium | 1 | **JBL** |
| 6944 | Joystick PS3 replica SONY AAA | 1 | **Sony** |
| 6961 | Roku Express Replica android | 3 | **Roku** |
| 7305 | Auriculares Airpods Pro Rep | 2 | — |
| 7306 | Auriculares Airpods Pro Rep 2 | 2 | — |

**Qué se hizo a cada una:**

1. `catalog_visibility = hidden` (`exclude-from-catalog` + `exclude-from-search`), vía la CRUD de WooCommerce según D6
2. Se agregaron a una categoría nueva **`Solo mostrador`** (`solo-mostrador`, term 1965), conservando sus categorías originales
3. Se removió la asignación de `product_brand` genuina — el dato era incorrecto y se habría filtrado a cualquier feed futuro
4. **Siguen en `publish`, con stock y comprables**

**Verificación:**

| Prueba | Resultado |
|---|---|
| Réplicas visibles en el catálogo | **0** de 797 productos visibles |
| Búsqueda "Airpods" en el catálogo público | No las devuelve |
| Búsqueda "Airpods" sin filtro de visibilidad (como el POS) | **Sí las devuelve** |

**Por qué el POS las sigue viendo:** YITH POS **usa este mismo mecanismo**. Su función `yith_pos_update_200_update_product_catalog_visibility` migra los productos "solo POS" justamente a `exclude-from-search` + `exclude-from-catalog`. Además no tiene un controlador REST propio de productos — usa el de WooCommerce, que no filtra por visibilidad de catálogo.

> **Pendiente de confirmación humana:** la verificación fue por consulta programática. La prueba definitiva es abrir el POS en staging y buscar "Airpods".

**La regla queda establecida y es reutilizable:** cualquier producto que el cliente no quiera online se agrega a **Solo mostrador** y se pone en visibilidad oculta. En la Fase 3 el tema propio puede automatizarlo: pertenecer a esa categoría fuerza la ocultación, sin depender de que alguien se acuerde de tildar las dos cosas.

---

### 4.2-bis 🟡 iPhones genuinos sin marca asignada

Al revisar las réplicas apareció otro hueco: **8 iPhones legítimos no tienen `product_brand` asignada**, pese a que la marca Apple existe con 57 productos.

```
iPhone 12 Pro Max 128gb 100% (5735)     iPhone 16 128gb 93% (10234)
iphone 15 Pro 256gb 86% (14529)         iPhone 13 Pro Max 128gb 93% (3782)
iPhone 17 Pro 256gb 100% (22187)        iPhone 16 128gb 89% (4078)
```

No rompe nada hoy, pero el filtro por marca del catálogo los dejaría afuera. Se corrige junto con la carga de atributos.

---

### 4.2-original — Diagnóstico (histórico)

Tres productos del top 200 son réplicas declaradas, y **dos tienen asignada la marca genuina** en la taxonomía:

| Puesto | Producto | Marca asignada |
|---|---|---|
| **9** | Auriculares Airpods Pro Rep 2 | *(sin marca)* |
| 25 | Auricular JBL Wave 380 Rep premium | **JBL** |
| 146 | Roku Express Replica android | **Roku** |

El puesto 9 vendió 7 unidades en 12 meses — entraría destacado en el lanzamiento.

Vender réplicas en el mostrador es una cosa; **publicarlas online bajo el nombre de la marca es exposición de marca registrada**. En la práctica: Google Merchant Center y Meta Commerce rechazan o dan de baja catálogos con listados de falsificación, y las marcas emiten pedidos de retiro. Si más adelante se quiere pautar, el catálogo entero queda bloqueado por estos tres.

**Es decisión del cliente.** Las salidas posibles: renombrar sin la marca ajena y quitar la asignación de `product_brand`, o excluirlos del catálogo online y dejarlos solo para mostrador.

### 4.3 🟡 Categorización cruzada de usados

"Smartphones nuevos" contiene 25 productos del top 150, de los cuales **muchos son usados con IMEI y porcentaje de batería**:

```
iPhone 14 128gb 84% (37873)      → categoría "Smartphones nuevos"
iPhone 12 Pro 128gb 100% (63695) → categoría "Smartphones nuevos"
iPhone 16 Pro 256gb 89% (13236)  → categoría "Smartphones nuevos"
```

Confirma P14. Con `pa_condicion` cargado se puede recategorizar automáticamente: si tiene batería o IMEI y no dice "sellado", es usado.

---

## 4-bis. ✅ Atributos aplicados — 2026-08-03

Los 10 atributos globales quedaron creados y cargados sobre los 200 productos del CSV, en **10,6 segundos**.

| Atributo | Etiqueta | Términos |
|---|---|---|
| `pa_modelo` | Modelo compatible | 40 |
| `pa_potencia` | Potencia | 15 |
| `pa_pulgadas` | Pulgadas | 15 |
| `pa_capacidad` | Capacidad | 6 |
| `pa_conector` | Conector | 6 |
| `pa_gama` | Gama | 6 |
| `pa_memoria-ram` | Memoria RAM | 4 |
| `pa_longitud` | Longitud | 4 |
| `pa_condicion` | Condición | 3 |
| `pa_salud-bateria` | Salud de batería | 3 |

**102 términos en total.** 200 productos actualizados, 62 términos creados en la corrida.

### Reglas aplicadas

**Condición** — se completó en los 200, no solo donde el título la declaraba:

| Valor | Productos | Criterio |
|---|---|---|
| Nuevo | 181 | Por defecto |
| Usado | 16 | Tiene porcentaje de batería, o está en categoría de usados |
| Sellado | 3 | Declarado en el título |

**Salud de batería** — convertida a rangos en vez del valor exacto, porque el porcentaje puntual es un dato de la unidad física (D13), no del modelo: `100%` · `90-99%` · `80-89%` · `Menos de 80%`.

**Conector** — admite múltiples valores por producto (`Tipo C | Lightning`).

**IMEI** — no se cargó como atributo. Es dato de unidad y va al plugin del POS.

### Fusión sin pérdida

Los 15 productos variables conservaron `pa_modelo` con `is_variation = true` y sus 40 variaciones intactas. Los atributos nuevos se agregaron como informativos (`is_variation = false`). **0 productos con problemas.**

Ejemplo — *Vidrio templado 9D*: `pa_modelo` (40 valores, de variación) + `pa_condicion` (1 valor, informativo), 40 variaciones disponibles.

### Desvío respecto de lo propuesto

En la sección 2 se recomendó separar `pa_potencia-carga` de `pa_potencia-audio`. **Se implementó un único `pa_potencia`** con los 15 valores (5W a 800W).

Motivo: en el template SWOO los filtros son contextuales por categoría, y los dos rangos nunca conviven en la misma — *Cargadores de pared* nunca muestra 800W, *Parlantes profesionales* nunca muestra 20W. Dos atributos separados agregaban complejidad de carga sin beneficio en el filtro. Lo mismo aplica a `pa_pulgadas`, que mezcla TV (43"–75") con parlantes (3"–15").

Si al armar el catálogo el filtro global resulta confuso, se separan — es una migración menor.

### P23 resuelto

Se asignó la marca **Apple** a los 7 iPhones que no la tenían. Apple pasó de 57 a **64 productos**.

> Al hacerlo apareció otra nota interna en un título: `iPhone 13 Pro Max 128gb 100% (Bat seg mano) (6468)`. Refuerza P13.

---

## 5. Plan de carga

1. **Decidir `pa_modelo-compatible`** (4.1) — bloquea 11 productos del lanzamiento y los 5 de mayor rotación.
2. **Decidir qué hacer con las réplicas** (4.2) — 3 productos.
3. **Crear los atributos globales** en WooCommerce con sus términos.
4. **Cargar automáticamente** los 102 productos que ya tienen valores extraídos, desde `mapa-atributos.csv`. Es un script, no data entry.
5. **Revisión humana del CSV**: la extracción es buena pero no infalible. Conviene que el cliente valide antes de aplicar.
6. **Carga manual** de los ~48 restantes.
7. **Recategorizar usados** con la regla de 4.3.

Los pasos 3 y 4 los puedo ejecutar en staging apenas estén resueltos 1 y 2.
