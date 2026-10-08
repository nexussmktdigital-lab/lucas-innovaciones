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

## Lo que NO se aplicó

- **Nombres (8 correcciones).** Esperan que Lucas confirme cuatro cosas:
  cuál iPhone 12 queda (6713 / 6707), si el termo Rolan es de 750 cc y no 7500,
  si «AAA» quiere decir réplica (6534, 8283), y si los micrófonos AM-188
  6323 «Aloe» y 6480 «Aole» son el mismo producto.
- **Stock a 0 de los 23 equipos.** Lo corrige Matías a mano; ver
  `stock-a-cero-07-10.md`.
