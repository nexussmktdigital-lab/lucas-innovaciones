# Correcciones de catálogo — 08/10/2026

Salieron de la revisión de la tienda del 07/10. Se aplicaron **en WooCommerce**,
que es la fuente de verdad; el POS las toma en su sincronización.

**No se tocó** ningún precio, stock, SKU, visibilidad ni pedido. Verificado
después de aplicar: los 40 productos conservan precio y stock.

## Respaldo

Antes de tocar nada se guardó el estado de los 40 productos (descripción larga,
descripción corta, categorías y marcas):

    wp-content/novamira-sandbox/respaldo-catalogo-2026-10-08.json

Para revertir uno: leer el JSON por su ID y volver a escribir los campos.

## 1. Descripciones vaciadas — 25

Hablaban de **otro producto** desde la primera línea: un teclado Kolke que
describía un kit Targa, un cargador MagSafe que hablaba de pilas AAA, una silla
Donna que describía otra silla. Se vaciaron la descripción larga y la corta.

No se escribió texto nuevo: la decisión del local es que el copy de la web no
se inventa. Sin descripción es mejor que con la de otro producto.

6673, 6678, 6948, 6793, 6754, 6863, 6607, 6710, 6855, 6388, 6390, 6889, 7661,
6802, 6893, 6837, 6939, 6603, 6554, 6568, 6301, 6326, 6552, 6925, 6692

## 2. Descripciones con una sola cifra mal — 3

Acá el texto era correcto y el error era un dato. Se borró **solo ese dato**,
no la descripción:

| ID | Producto | Qué decía | Qué se hizo |
|---|---|---|---|
| 6731 | Smart TV Noblex 55" **UHD** | «Pantalla 55 pulgadas con resolución Full HD» | queda «Pantalla 55 pulgadas» |
| 7681 | Smart Tv ENOVA **43"** | viñeta «Pantalla de 32 pulgadas…» | se borró la viñeta |
| 6700 | Hyundai **5000FC** (~18.000 BTU) | viñeta «Capacidad de 5000 BTU…» | se borró la viñeta |

## 3. Marcas corregidas — 9

| ID | Producto | Antes | Ahora |
|---|---|---|---|
| 6301 | Auriculares JBL in ear C50H | FoxBox | JBL |
| 6731 | Smart TV Noblex 55" X8 UHD | TCL | Noblex |
| 6744 | Cable micrófono Vapex Canon a Canon 6m | Canon | Vapex |
| 6900 | Cable micrófono Vapex Canon a 6,5 9m | Canon | Vapex |
| 6793 | Proyector NETMAK NMPR300 | Kelyx | Netmak |
| 8213 | Auriculares KOLKE KAB633 | Seisa | Kolke |
| 8278 | Perfume LATTAFA Badee al oud | Haramain | Lattafa |
| 8280 | Perfume LATTAFA Mayar | Haya | Lattafa |
| 8279 | Perfume Club de Nuit URBAN Man | Haya | **Armaf** ⚠️ |

En 6744 y 6900, «Canon» era el tipo de conector del cable, no la marca.

⚠️ **8279 es el único que no sale del nombre del producto.** Club de Nuit es la
línea de Armaf, pero conviene que Lucas lo confirme.

Marcas creadas en la taxonomía: **Noblex**, **Lattafa**, **Armaf**.

**Los 399 productos sin marca no se tocaron**: decisión del local, hay muchos
genéricos y no vale la pena segmentarlos por marca.

## 4. Categorías corregidas — 9

| ID | Producto | Antes | Ahora |
|---|---|---|---|
| 6568 | Samsung Galaxy Buds 3 | Auriculares con cable | Auriculares inalámbricos |
| 6684 | Cortadora de pelo vintage T9 | Cocina | Cuidado personal |
| 6396 | Philips shaver 1000 | Cocina | Cuidado personal |
| 7537 | Parlante mini K12 c/ 2 micrófonos | Accesorios Vehículo + Parlantes de auto | Parlantes portátiles |
| 6889 | Apple Battery pack | Cargadores de pared | Power banks |
| 6754 | Parlante KOLKE Party Cube | Adaptadores y conversores | Parlantes portátiles |
| 6462 | Fuente jack a tipo C Motorola | Cables de carga | Adaptadores y conversores |
| 6463 | Fuente jack a lightning | Cables de carga | Adaptadores y conversores |
| 6816 | Soporte Holder SEISA | Fundas | Soportes y holders |

Dos criterios que tomé y conviene revisar:

- **No existe una categoría «Parlantes» suelta.** 6754 y 7537 fueron a
  **Parlantes portátiles**, que es lo que son.
- **7537 tenía dos categorías** y quedó con una sola. Si tiene que seguir en
  «Accesorios Vehículo», se le agrega.

## 5. Nombres corregidos — 9

Aplicados después de las confirmaciones de Lucas del 08/10. **Ningún slug
cambió**, así que no se rompió ninguna URL ni enlace de la tienda.

| ID | Antes | Ahora |
|---|---|---|
| 6775 | Redmi 15C 256gb **4gb** | Redmi 15C 256gb 8gb |
| 6315 | Router **Linsys** e900 | Router Linksys E900 |
| 6687 | Parlante **stormberg** force | Parlante Stromberg Force |
| 6281 | Auricular c/cable **Netmark** UR90 | Auricular c/cable Netmak UR90 |
| 6291 | Tablet Horizon pro **Netmark** 7" | Tablet Horizon pro Netmak 7" |
| 6372 | **Humificador** | Humidificador |
| 8271 | Perfume ODYSSEY Homme **Withe** | Perfume ODYSSEY Homme White |
| 6579 | BOTELLA TERMITO ROLAN SPORT **7500 CC** | …750 CC |
| 6480 | Micrófono **Aole** AM-188 | Micrófono Aloe AM-188 |

En 6480 se corrigió además el «Aole» que quedaba dentro de la descripción.

## 6. El cargador que es réplica — 6534

Lucas aclaró que «AAA» quiere decir réplica en algunos productos y calidad en
otros —en un vidrio templado, durabilidad—. En el joystick 8283 el nombre ya
decía «Replica»; en este cargador no, y un cliente de la web leía «Samsung» y
entendía original.

| ID | Antes | Ahora |
|---|---|---|
| 6534 | Fuente Samsung 25W Tipo C **AAA** | Fuente Samsung 25W Tipo C **Replica** AAA |

## 7. Micrófono duplicado consolidado — 6323 / 6480

El mismo producto cargado dos veces con SKU distinto (249 y 516) y el stock
repartido. Se unificó en uno solo:

| ID | Qué se hizo | Estado final |
|---|---|---|
| 6323 | +1 unidad | publicado, **stock 3** |
| 6480 | −1 unidad y baja | **borrador**, stock 0 |

**El stock se movió por diferencia, no por escritura absoluta.** Se llamó
`li_tienda_ajustar_stock()` —la misma función del plugin `li-tienda` que usa la
cola del POS— con `delta +1` y `delta −1` y la referencia
`duplicado-am188-2026-10-08`. Usa `wc_update_product_stock()`, que es atómico
igual que un pedido web, y deja su marca de idempotencia: repetir el ajuste con
esa referencia no vuelve a mover nada.

*(El endpoint REST `wc-li/v1/stock/ajustar` rechaza la credencial de Novamira
—solo acepta la clave del POS—, así que se llamó la función directamente. Misma
lógica, mismo movimiento.)*

**La baja es `status = draft`**, que es exactamente lo que hace el POS en
`empujarBaja`. No se borró nada: la ficha sigue existiendo, pegada a cualquier
venta vieja, y se revierte poniéndola de vuelta en publicado.

## Lo que NO se aplicó

- **6440 «Matepa alpaca» queda como está.** Lucas confirmó que el nombre es
  correcto.
- **Stock a 0 de los 23 equipos.** Lo corrige Matías a mano; ver
  `stock-a-cero-07-10.md`. **6713 y 6707** (mismo IMEI): Lucas confirmó que
  quedan los dos, así que ninguno se da de baja y los dos van a 0.
