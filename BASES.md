# Lucas Innovaciones — Bases del proyecto

**Sitio:** lucasinnovaciones.com.ar
**Fecha:** 2026-08-03
**Estado:** bases definidas · **POS en desarrollo (Fases 1 a 4 terminadas)** — ver [`pos/README.md`](pos/README.md) y la auditoría en [`pos/AUDITORIA.md`](pos/AUDITORIA.md)

---

## 1. Objetivo

Dos entregables sobre la misma instalación de WordPress/WooCommerce:

1. **Tienda online** pública, hoy inexistente (0 ventas web sobre 3.764 pedidos).
2. **POS propio** como plugin, que reemplace a YITH Point of Sale y permita dar de baja su membresía.

---

## 2. Regla 0 — Continuidad operativa

El local vende ~10 pedidos por día hábil con YITH POS. Es su **único canal de venta**.

> **YITH POS no se desactiva, no se borra y no se actualiza hasta que el reemplazo esté validado en producción durante el período de convivencia.**

Todo cambio que toque el flujo de venta pasa primero por staging. Ningún despliegue se hace en horario comercial.

---

## 3. Estado actual (auditoría 2026-08-03)

### Operación

| Dato | Valor |
|---|---|
| Pedidos históricos | 3.764 — 100% originados en el POS |
| Ventas online | 0 |
| Ritmo | ~200-250 pedidos/mes (~10/día hábil) |
| Ticket promedio | ~$70.000 ARS |
| Ítems por pedido | 1,23 |
| Medios de pago | Efectivo 67% · Transferencia 32% · Cheque 1% |
| Sesiones de caja | 243 |
| Estructura | 1 tienda · 1 caja · 2 cajeros (1 encargado, 1 cajero) |
| Base de clientes | **Inexistente** — 3.764 pedidos como invitado, 1 solo con datos de contacto |

Domicilio del local: Caseros 924, Santa Rosa de Río Primero, Córdoba (CP 5133).

### Catálogo

| Dato | Valor |
|---|---|
| Productos publicados | 803, todos de tipo simple |
| **Sin imagen** | **781 (97%)** |
| Sin descripción | 97 · sin descripción corta: 96 |
| Sin SKU | 93 |
| Stock | 685 disponibles / 123 sin stock |
| Categorías | 112 |
| Marcas | 93 (taxonomía nativa `product_brand`) |
| Etiquetas | 1.736 — ruido a depurar |
| Precios | $1 a $2.190.000 — hay datos basura en los extremos |

Categorías principales: Smartphones nuevos (58), Cables de carga (45), Cocina (42), Cargadores de pared (32), Periféricos (30), Mates (28).
Marcas principales: Apple (57), Netmak (32), FoxBox (30), Noganet (21), Samsung (16).

### Entorno técnico

- WordPress 7.0.2 · PHP 8.3.32 · MySQL 8.0.42 · LiteSpeed · hosting compartido
- Base de datos: 60 MB · object cache activo (Redis/Memcached)
- `exec`, `shell_exec`, `proc_open`, `eval` deshabilitados · `max_execution_time` 30s · memoria 256 MB
- Tema: Hello Elementor 3.4.7 **sin child theme**
- Plugins activos: Elementor 4.2.0, PRO Elements 4.1.0, WooCommerce 10.9.4, Mercado Pago 8.9.0, YITH POS 3.22.0, Novamira 1.11.1
- Acceso de desarrollo: **solo MCP de Novamira contra producción**. Sin staging, sin repositorio, sin backup verificado.

### Deuda técnica detectada

| Problema | Impacto |
|---|---|
| `siteurl` en `http://` y `home` en `https://` con HTTPS activo y `FORCE_SSL_ADMIN` | Contenido mixto — bloqueante para checkout público. **Confirmado en producción el 2026-09-11** leyendo `/wp-json/`: `siteurl http://lucasinnovaciones.com.ar` · `home https://lucasinnovaciones.com.ar`. No afecta a la REST API: se verificó que autentica igual. |
| HPOS desactivado (3.764 pedidos en tablas legacy) | Migrar después del corte de YITH, no antes |
| `calc_taxes = yes` sin ninguna tasa cargada, precios "sin IVA" | Indefinición de precio final al público |
| 1 zona de envío con solo "envío gratis" | No hay logística real configurada |
| PRO Elements (redistribución no oficial de Elementor Pro) | Sin parches de seguridad oficiales en un sitio que procesará pagos |
| Sin child theme | Cualquier personalización se pierde al actualizar |
| **Object cache huérfano en producción** | `object-cache.php` de LiteSpeed activo y en uso (Valkey), pero **el plugin LiteSpeed Cache no está instalado**: cero opciones `litespeed.*` en la base. El dropin lee su configuración de `.litespeed_conf.dat`. No hay forma de purgar la caché desde el escritorio si se contamina |
| **Producción y staging compartían la misma base de Valkey** (`db_id 559`, mismo socket y credenciales, mismo prefijo `wp_`) | Riesgo de colisión de claves entre ambos sitios. **Mitigado el 2026-08-03** desactivando el object cache del staging. Si se reactiva, debe usar otro `object-db_id`. Integridad de producción verificada: 9/9 claves críticas coinciden entre base y caché |
| **`robots.txt` genérico de DonWeb, hostil al ecommerce** | `Disallow: /*?` bloquea toda URL con parámetros — mataría los filtros del catálogo. `Disallow: /wp-content/themes/` impide a Google renderizar el sitio. `Crawl-delay: 60` y `Request-rate: 6/60m` limitarían el rastreo a 6 documentos por hora. **Debe reemplazarse antes del lanzamiento** |
| Tablas `wp_icl_*` (WPML ausente), carpeta `jetpack-waf`, `ai1wm-backups`, `wp-cache-config.php` huérfano, 2 CPT de ACF sin ACF | Residuos a limpiar |
| 3.762 filas vacías en `wc_customer_lookup` | Ruido en reportes de WooCommerce |

### Cómo vende realmente el negocio (hallazgo crítico)

Análisis de los últimos 12 meses: **$167.415.950** facturados en 2.622 pedidos.

| Origen de la facturación | Monto | % |
|---|---|---|
| Productos que **hoy existen** en el catálogo (252 productos) | $19.288.709 | **11,5%** |
| Líneas de **venta libre sin producto** (`product_id = 0`) | $96.879.088 | **57,9%** |
| Productos vendidos y **luego borrados** del catálogo (439 IDs) | $51.248.153 | **30,6%** |

1.357 de las 4.647 líneas de pedido (29%) no tienen ningún producto asociado. Ticket promedio de esas líneas: **$89.689** (máximo $2.390.000) — es decir, la venta libre mueve tickets *más altos* que la venta de catálogo.

Los nombres reales de esas líneas revelan cuatro negocios que el catálogo no refleja:

| Patrón | Ejemplos reales | Interpretación |
|---|---|---|
| **Servicio técnico** | "Virus" (10×, ~$7.050) · "Soft" (8×, ~$8.375) · "limpieza" (4×, ~$14.750) | Reparación y mantenimiento. No catalogado. |
| **Telefonía** | "chip" (22×, ~$2.205) | Venta de SIM/chips. |
| **Fiado / cuotas** | "Gaby Gonzalez" ($100.000 × 4 pedidos) · "Mayco Villafañe" ($100.000, $187.250, $300.000, $402.780) · "Miguel martinez" ($50.000 × 3) | **Cuenta corriente informal**: montos altos y recurrentes registrados con el nombre del cliente como si fuera un producto. |
| **Fuera de rubro** | "Yerba" (15×) · "bombilla" · "Pilas" · "Album" | Venta de mostrador variada. |

**Consecuencias, en orden de importancia:**

1. **La tienda online no puede replicar la facturación del local.** Solo el 11,5% del negocio pasa hoy por productos catalogados y con stock. La web es un canal **nuevo y complementario**, no un espejo del mostrador. Hay que alinear esta expectativa con el cliente antes de invertir en fotos.
2. **La venta libre de monto abierto es la función principal del POS**, no un accesorio: mueve el 58% de la facturación. El POS v1 tiene que hacerla mejor y más rápido que hoy, no apenas soportarla.
3. **Hay un libro de fiado escondido dentro de las líneas de pedido.** Hoy es imposible saber cuánto debe cada cliente sin rastrear a mano por nombre. Es un problema real del negocio que ninguna herramienta actual resuelve (ver P9).
4. **Los productos se borran después de venderse** (439 en 12 meses, sobre todo celulares). Una tienda online necesita URLs persistentes para SEO, links compartidos e historial. **Este hábito operativo tiene que cambiar**: en vez de borrar, marcar sin stock u ocultar. Es una decisión del cliente, no técnica.
5. **El servicio técnico queda fuera de la web por decisión del cliente (D18).** Se registra en el POS como venta libre, lo que refuerza el punto 2: el POS tiene que hacer esa operación muy bien.

**Calidad de datos del catálogo:** además hay valores inconsistentes — stock ficticio (9.708 y 9.976 unidades en dos productos), precios de $1, y un producto vendido con facturación $0. A depurar en Fase 1.

---

## 4. Decisiones tomadas

| # | Decisión | Consecuencia |
|---|---|---|
| D1 | ~~**POS 100% online**, sin modo offline~~ *Derogada por D56 en la v1.1:* la v1 salió sin offline y la v1.1 suma lo acotado que D25 definía —caché del catálogo y cola de la venta cobrada—, no offline completo. |
| D2 | **Sin facturación electrónica ARCA/AFIP** | Solo recibo/comprobante interno no fiscal, igual que hoy. El proyecto es un POS, no un sistema de gestión. |
| D3 | **v1 = paridad con YITH y nada más** | Camino más corto a poder dar de baja la membresía. Toda mejora va a v2. |
| D4 | **WooCommerce es el único origen de verdad** | Un solo stock, un solo catálogo, un solo historial para mostrador y web. |
| D5 | **El POS es un plugin propio**, no un tema ni un hack | Instalable, desactivable, versionable, independiente del tema. |
| D6 | **Toda escritura de pedidos por la CRUD API de WooCommerce** | Nunca `update_post_meta` directo. Permite migrar a HPOS sin reescribir. |
| D7 | **Convivencia antes del corte** | Ambos POS operativos en paralelo 2-4 semanas antes de desactivar YITH. |
| D8 | **Primero la tienda online, el POS al final** | El desarrollo web no toca el POS en ningún momento: la Regla 0 se cumple sin esfuerzo. Contrapartida: la membresía de YITH se sigue pagando durante todo el desarrollo de la web. |
| D9 | **Tema propio completo**, sin page builder | Se elimina Elementor y PRO Elements por completo — **esto resuelve P3 por eliminación**, quita la dependencia de licencia y mejora sustancialmente la velocidad. Contrapartida: el cliente no puede modificar diseño ni layout sin desarrollo. Requiere rehacer la Home actual (hoy construida con Elementor) y reemplazar el popup de menú. |
| D10 | **Lanzamiento curado** con ~150 productos de mayor rotación | Permite lanzar en semanas en lugar de meses y validar el canal antes de invertir en 800 fichas. Lista priorizada generada en `catalogo-prioridad-fotos.csv`. |
| D11 | **Se conserva el logo actual** | La paleta y la tipografía se derivan de él. No se rehace identidad. |
| D12 | **La venta libre de monto abierto es funcionalidad central del POS v1** | Consecuencia directa del hallazgo de la sección 3: mueve el 58% de la facturación. |
| D13 | **Se separa "modelo" de "unidad física"** en el catálogo | Resuelve el pedido legítimo del cliente de eliminar equipos vendidos, sin destruir la URL ni el SEO. Ver sección 8.1. |
| D14 | **No se reinstala WordPress: se limpia en sitio** | El resultado visible es idéntico (tema y páginas se hacen de cero) y evita migrar 803 productos, 3.764 pedidos, 57.923 filas de items y 243 sesiones de caja de un sistema en uso diario. Ver sección 9.1. |
| D15 | **Sin imágenes de producto generadas por IA** | Una foto inventada de un SKU real produce reclamos, devoluciones y contracargos, e incumple las políticas de Google Merchant Center y Meta Commerce. La IA se usa para banners, ilustraciones y gráficos, no para fichas de producto. Ver sección 8.3. |
| D16 | **Imágenes: vía B para productos, vía C para banners** | Fotografía propia en el local para las 143 fichas + IA para banners e ilustraciones. Se descarta la vía A (assets de distribuidores) — queda disponible como atajo si algún distribuidor los ofrece. |
| D17 | **Base de diseño: template "SWOO — Tech Mart"** (Figma Community, `jqYBUcohlipdHwwSoXPBrt`) | Se implementa como tema propio, no se importa. Buen encaje de rubro y de filtros de catálogo. Requiere trabajo adicional significativo: diseño mobile completo, recorte de secciones, y creación de la taxonomía de atributos. Ver sección 8.4. |
| D18 | **El servicio técnico no se incluye en la web** | Decisión del cliente. La web vende productos únicamente. El servicio técnico sigue siendo un canal de mostrador y se registra en el POS como venta libre (D12). |
| D22 | **Los precios en dólares se convierten a pesos automáticamente** con el blue de Córdoba | Plugin propio `lucas-cotizacion`. El precio en USD es la fuente de verdad (`_li_precio_usd`) y el precio en pesos se **reescribe** dos veces por día, sin margen y redondeando al millar. Se reescribe en lugar de convertir al mostrar porque **el POS lee el mismo `_price` que la web**, igual que el orden por precio, los filtros por rango, el carrito, Mercado Pago y los reportes. Ver sección 12. |
| D21 | **Carrito y finalizar compra se quedan con los bloques de WooCommerce**, no se convierten a shortcodes clásicos | Ambas páginas ya estaban construidas con bloques. Se evaluó pasarlas al checkout clásico para tener control total por plantillas, y **se descartó**: el plugin de Mercado Pago declara compatibilidad `cart_checkout_blocks` y registra sus métodos vía `woocommerce_blocks_payment_method_type_registration`, y sobre todo **los bloques traen retiro en el local de forma nativa**, que para este negocio es el canal principal. El tema aporta el envoltorio y una hoja (`blocks.css`) que traduce los bloques al sistema visual. |
| D20 | **Vidrios, hidrogeles y fundas pasan a productos variables por modelo** | Atributo `pa_modelo` con 40 modelos, derivados de los teléfonos con venta real. Piloto ejecutado sobre el producto #1 en rotación. Suma un toque al flujo del cajero en búsqueda por texto; con lector de código de barras va directo a la variación. Ver sección 4.1 de [MAPA-ATRIBUTOS.md](MAPA-ATRIBUTOS.md). |
| D19 | **Las réplicas salen del catálogo online, quedan solo para mostrador** | Se creó la categoría **`Solo mostrador`** + visibilidad oculta. 6 productos procesados, marcas genuinas removidas. Siguen vendibles en el POS. Es la regla reutilizable para cualquier producto que no deba estar online. Ver sección 4.2 de [MAPA-ATRIBUTOS.md](MAPA-ATRIBUTOS.md). |
| **D23** | **El POS se construye como aplicación Next.js separada, no como plugin de WordPress.** *Deroga D5.* Stack: Next.js 15 + PostgreSQL (Neon/Supabase) + Drizzle + Auth.js v5, desplegado en Vercel. WooCommerce sigue siendo fuente de verdad de catálogo, precio y stock (D4 se mantiene); el POS es dueño de ventas, fiado, caja, gastos y auditoría, que Woo no sabe llevar. **Contrapartida asumida: el corte de YITH se corre varios meses y la membresía se sigue pagando durante todo el desarrollo.** También deroga el orden de D8 en lo que hace al POS: se construye en paralelo a la web, no al final. |
| **D24** | **Ninguna línea de venta puede existir sin un producto real.** *Deroga D12.* La restricción vive en la base (`sale_items.product_id` NOT NULL con clave foránea), no en la aplicación. Para que sea cumplible sin frenar al mostrador, el 58% que hoy se carga como venta libre se resuelve catalogando lo que realmente se vende: **servicios técnicos y chips pasan a ser productos** de la categoría `Solo mostrador` (D19), sin gestión de stock y con precio editable en la venta; y **el fiado sale de las líneas de pedido** al módulo de cuenta corriente. Resuelve P9 y P11 por otra vía. |
| **D25** | **Sin modo offline en la v1; offline acotado en la v1.1.** *Confirma D1.* La v1.1 suma solo caché del catálogo y cola de la venta confirmada, no resolución elaborada de conflictos. Consecuencia: si WooCommerce está caído, el POS no vende — lo cubre la Regla 0 (rollback a YITH durante la convivencia). El offline era el 30-40% del esfuerzo y el negocio operó 3.764 pedidos sin él. |
| **D26** | **Cheque y Mercado Pago se suman como medios de pago del mostrador.** No estaban en el alcance original pero sí en la operación real: 1% del histórico es cheque y el gateway de Mercado Pago ya está instalado. |
| **D27** | **Una variación se vende con su propio precio y su propio stock.** Las 600 variaciones sincronizadas de Woo (vidrios, hidrogeles y fundas, D20) no son etiquetas del producto padre: tienen precio propio y, cuando en Woo llevan `manage_stock: true`, stock propio. El POS descuenta en un solo lugar —la variación si es suyo, el padre si lo hereda— y le escribe a Woo el recurso que corresponde. La única excepción es el precio de un producto en dólares, que lo sigue calculando el sistema desde el precio en USD del padre (D22): la guarda contra el error de agosto no se saltea por elegir una medida. |
| **D28** | **Los permisos se hacen cumplir en el servidor, no en la pantalla.** Escribir el precio de un servicio y saltear la guarda de precios sospechosos son atribuciones del dueño, y la acción de venta las comprueba aunque el pedido llegue armado a mano. Una guarda que solo vive en la interfaz no es una guarda. |
| **D29** | **Anular es agregar los asientos contrarios, y solo dentro del turno abierto.** Nada se borra: la venta queda `cancelled` con el motivo, el stock vuelve deshaciendo los movimientos que dejó y la caja recibe el asiento opuesto. Fuera del turno no se anula, porque revertir contra una caja cerrada descuadra dos arqueos: eso es una devolución (D54). |
| **D30** | ~~La cuenta corriente no se ofrece hasta que exista el módulo de fiado.~~ *Cumplida en la fase 4:* el módulo existe y el medio de pago volvió, ahora con cliente obligatorio y deuda registrada. |
| **D36** | **El fiado es una cuenta corriente de saldo, no un plan de cuotas.** El cliente debe una cifra: se le fía y sube, paga y baja. Es como funciona la libreta de papel y es lo que el negocio necesita primero. Las tablas de planes y cuotas quedan en el esquema para cuando haya que financiar una compra grande en cuotas fijas con vencimientos. |
| **D37** | **Fiar lo autoriza el dueño; cobrar lo puede hacer el vendedor.** Dar crédito no es una decisión de mostrador, así que `fiado.crear` no está entre los permisos del vendedor. Recibir un pago sí (`fiado.cobrar`): que venga alguien a pagar y no se le pueda tomar la plata sería peor que el control que se gana. El tope de fiado por cliente se comprueba contra la deuda del instante, dentro de la transacción de la venta. |
| **D38** | **Las fichas de papel entran una sola vez por cliente y quedan marcadas.** El saldo de la libreta se carga sin venta detrás, con `origen = migrado_papel`, y solo mientras el cliente no tenga movimientos. Sumar dos veces la misma deuda es el error a evitar en una migración, así que lo rechaza el dominio y no la pantalla. |
| **D31** | **El mostrador y la tienda cobran precios distintos, y el número que se guarda es el de la tienda.** En la web cobra Mercado Pago y esa comisión no la paga el local: unos auriculares de $50.000 en el mostrador salen $56.000 en la web. Para no mantener dos números por producto, WooCommerce guarda el precio de la tienda —el que la web cobra de verdad, sin tocar el plugin ni el sitio— y el POS le descuenta un **recargo global** para llegar al de mostrador, redondeando a los cien pesos. No lleva recargo lo que no se publica: servicios, chips y todo lo de «Solo mostrador» (D19), cuyo precio de ficha ya es el del local. Queda un **precio de mostrador propio** por producto para las excepciones. La cuenta del recargo es `1 / (1 − comisión) − 1`, no la comisión: con 6,29% de comisión hacen falta 6,71% de recargo. |
| **D32** | **El precio de los servicios lo escribe el mostrador, con una guarda de distancia en vez de un permiso.** Cada reparación se cotiza en el momento, así que pedir autorización del dueño en cada una frena la venta. El precio se escribe libre, pero si queda por debajo de la mitad del de referencia del catálogo salta el mismo cartel que el error de agosto y solo el dueño lo puede saltear. Un precio escrito en cero se rechaza. Todo precio escrito queda en la bitácora contra el de catálogo. |
| **D34** | **Los importes de una venta cerrada son de solo lectura, garantizado por la base.** Anular necesita cambiar el estado, así que el UPDATE no se puede bloquear entero en `sales`: se bloquea por columna. Solo pasan `estado`, `motivo_anulacion`, `synced_to_woo`, `woo_order_id` y `nota`; los importes, la fecha, el vendedor, la caja y la clave de idempotencia no. En las líneas y los pagos el UPDATE se bloquea entero: corregir una venta es anularla y volver a hacerla. |
| **D35** | **El webhook de WooCommerce no le escribe el stock al POS.** Cada venta empuja su stock a Woo y ese PUT hace que Woo devuelva un `product.updated` con la ficha; aceptar ese stock haría que una venta hecha en el medio se pierda, pisada por su propio eco. El webhook refresca todo lo demás de la ficha. El stock que se origina en Woo —una carga a mano, un pedido web— entra por `npm run woo:sync`, que es la reconciliación explícita, y toda divergencia queda en `sync_conflicts` a la vista. |
| **D43** | **Un gasto pagado mueve plata en el mismo momento en que se registra; uno pendiente no mueve nada.** Sale de una cuenta monetaria concreta, y si esa cuenta es el cajón del turno el arqueo lo descuenta: sin esto el conteo de la noche siempre da de menos y nadie sabe por qué. La regla vive en la base (`expenses_pagado_ck`), no en el formulario: no existe un gasto pagado sin decir de dónde salió. Anular un gasto es ponerle el asiento contrario, igual que una venta (D29), y las salidas del arqueo van **netas de anulación**: un gasto cargado y anulado en el mismo turno deja el cajón como estaba. |
| **D44** | **Pasar plata entre cuentas son dos asientos, no uno.** Depositar la recaudación en el banco no es un ingreso ni un gasto: la plata cambia de lugar y el total del negocio no se mueve. Se registran las dos puntas en la misma transacción; con una sola, el negocio parecería haber ganado o perdido plata sin vender ni gastar nada. El saldo de cada cuenta es una caché de la suma de sus movimientos, y cuando se despegan **manda el movimiento**: la pantalla lo muestra en rojo en vez de dejar que la diferencia se arrastre callada. |
| **D45** | **Una compra a proveedores registra la plata, no el stock.** El ingreso de mercadería no existe en ninguna parte del POS —el stock viene de WooCommerce (D4)— y es su propia funcionalidad, con su propio movimiento de stock y su propia pantalla. Meterla de prepo adentro del formulario de gastos daría un ingreso de stock sin trazabilidad y un gasto que hace dos cosas. El esquema ya tiene `expense_items` para cuando llegue. |
| **D46** | **El cajón se cuenta por denominación, y el total lo calcula el servidor.** El arqueo del POS viejo era un casillero para escribir un número, y el resultado fue que el efectivo contado figuraba siempre en cero: un campo libre a las nueve de la noche se llena con lo primero que salga. Ahora el cierre arranca pidiendo cuántos billetes de cada valor, que es el gesto que ya se hace —apilar por valor y contar las pilas—, y el sistema suma; lo que suma el navegador es una comodidad para quien cuenta, no un dato en el que confiar. Escribir el total directo sigue estando a un clic, porque un arqueo que traba el cierre es un arqueo que se saltea, pero **queda registrado que se hizo así** y la pantalla muestra cuántos de los últimos diez cierres se hicieron contando. Si ese número se va a cero, el arqueo volvió a ser un trámite y se ve antes de que importe. |
| **D47** | **El reporte de un turno se recalcula, no se congela.** Sale de los mismos asientos que movieron la plata, así que el turno de hace un mes dice hoy lo mismo que decía al cerrarlo; se puede porque una venta solo se anula dentro del turno abierto (D29) y un turno cerrado ya no cambia. La alternativa —guardar una copia del reporte al cerrar— crea una segunda verdad que hay que mantener sincronizada con la primera. La justificación de una diferencia va **en el cuerpo** del reporte y de la lista, nunca en un `title`: un tooltip que solo aparece pasando el mouse no existe para quien lee en una tablet ni para quien imprime la hoja. |
| **D48** | **Un producto se puede dar de alta desde el POS, y nace de mostrador.** El catálogo entraba solo por WooCommerce (D4), y eso dejaba al mostrador sin salida en el momento exacto en que la necesita: como ninguna línea de venta existe sin un producto real (D24), el producto que falta traba la venta. Ahora se carga desde el mismo buscador que no lo encontró, lo puede hacer el vendedor, y queda vendible en el acto con `woo_id` en nulo y marcado como «Solo mostrador» (D19). **Publicarlo en la tienda es un segundo acto, deliberado y por la cola.** Publicar como borrador —lo intuitivo— no sirve: la sincronización traduce el `status` de WooCommerce a `activo`, así que un borrador vuelve como producto inactivo y desaparece del mostrador que lo creó. Esto no deroga D4: WooCommerce sigue mandando sobre todo lo que está en WooCommerce; lo que el POS agrega es lo que todavía no está ahí. La contrapartida obligatoria es la lista de fichas por completar: sin ella, «alta rápida» significa «a medias y para siempre», que es exactamente como el catálogo llegó a tener 93 productos sin SKU. |
| **D49** | **La ayuda para armar una ficha propone texto, nunca plata ni fotos, y el catálogo manda sobre lo que propone.** Convierte lo que se tipea apurado —«cable tipo c fox box axon 20w»— en nombre, marca y categoría, y de paso saca del título las anotaciones internas del vendedor (precios de compra, nombres de clientes, márgenes) que hoy están en títulos publicados. Nunca propone precio ni stock: un precio inventado se cobra, y eso lo sabe quien está atendiendo. Nunca propone imágenes (D15). Lo que vuelve pasa por el filtro del catálogo: una categoría que no existe se descarta y una marca escrita distinto se unifica con la que ya está, porque si no el atajo agrega desorden con más comodidad. Y **es opcional**: sin la variable de entorno el alta funciona igual, escrita a mano. Ninguna parte del POS puede depender de que esto ande. |
| **D50** | **La importación masiva se mira antes de guardarse, y da de alta sin pisar nada.** Primero muestra renglón por renglón qué va a pasar —cuántos entran, cuántos ya estaban, cuáles no se pueden leer y por qué— y recién después escribe; una importación que guarda y después avisa es una importación que hay que deshacer a mano. Un SKU o un nombre que ya existe se informa y se saltea: los precios de lo que ya está cargado se cambian en la pantalla de precios, que es donde están los controles, porque una planilla capaz de reescribir precios en masa es la forma más rápida de cambiar todo el catálogo sin que nadie lo note. |
| **D51** | **Todo reporte se recorta por el calendario del local, no por UTC.** Una venta de las 22:30 en Villa Santa Rosa son las 01:30 del día siguiente en UTC: sin aplicar el huso, la última hora de cada día —y la última noche de cada mes— se cuenta en el período siguiente y ningún reporte cierra contra lo que dice la caja. El huso se saca de `Intl` por instante y no se escribe `−3` a mano, así que si algún día vuelve el horario de verano esto sigue andando. Y todo número de venta filtra por `estado = 'completed'`: anular no inserta una venta negativa sino que marca la original (D29), así que no hay nada que restar en ninguna parte. |
| **D52** | **Un reporte de margen dice sobre cuánto está hablando.** El costo se congela en cada línea de venta al confirmarla —una venta vieja no cambia de margen porque hoy el proveedor cobre otra cosa— pero solo lo tienen los productos a los que alguien se lo cargó, y de WooCommerce no viene. Así que el reporte informa sobre cuántas de las unidades vendidas calculó: un margen sacado de una parte del movimiento y presentado como «el margen del mes» es peor que no tener el número. Por lo mismo, en la planilla la ganancia de un renglón sin costo queda **vacía y no en cero**: cero afirma que no se ganó nada, y lo que pasa es que no se sabe. |
| **D53** | **Las planillas salen en el dialecto que abre bien en Excel en castellano, aunque sea «incorrecto».** Punto y coma en vez de coma, BOM al principio y decimales con coma. Un CSV canónico se abre con todo en la primera columna, con los acentos rotos y con los importes como texto que no se puede sumar, que es lo primero que hace cualquiera que lo recibe. El destino de estos archivos es una planilla y un correo al contador, no un pipeline de datos. Es el mismo dialecto que lee la importación de productos, así que lo que sale del POS se puede volver a cargar. |
| **D54** | **Devolver no es anular: la venta original no se toca y la plata sale del cajón de hoy.** *Complementa D29.* Anular es para el error de carga y solo dentro del turno abierto; el cliente que vuelve el jueves con el cargador que no anda necesita otra cosa. La devolución es un documento aparte, con su propia numeración (`DEV-T1-000001`), que deja la venta de aquel turno exactamente como estaba —y su arqueo también— y descarga el movimiento sobre el turno de hoy, que es cuando la plata sale del cajón de verdad y la mercadería vuelve al local. Puede ser parcial, y lo ya devuelto se descuenta para que la misma unidad no vuelva dos veces. Se devuelve **el precio que se cobró**, con el descuento global de aquella venta ya prorrateado: devolver el de lista de algo que salió con 20% es regalar la diferencia. Dos cosas las decide quien atiende porque el sistema no las puede saber: **si vuelve al stock** —un cargador fallado no se vuelve a vender— y **si sale plata o baja la deuda**, cuando el cliente todavía debe de esa misma venta; ahí se propone descontar primero y devolver el resto, y la base exige que las dos partes sumen el total (`returns_suma_ck`). Es del dueño, como anular: es una decisión sobre el cajón de hoy. El arqueo la explica en su propia línea, separada de las anulaciones del día; sin eso, al cerrar falta plata sin motivo y quien cuenta tiene que inventar una justificación. |
| **D55** | **El histórico del sistema anterior se importa de solo lectura, en su propia tabla, y nunca se mezcla con las ventas.** Son 3.764 pedidos de YITH, y sin ellos el reporte mensual arranca el día que se instaló el POS y no sirve para comparar con nada. Van a `legacy_sales`, que no toca stock, ni caja, ni numeración: meterlos en `sales` sería inventar 3.764 movimientos de stock que ya pasaron y 243 arqueos que nadie va a cuadrar. Los reportes los suman aparte. **Se importa una vez y no se pisa** —disparador contra el `UPDATE` y el `DELETE`, único por `(origen, referencia_externa)`, y la corrida repetida no informa como facturación nueva lo que no escribió—, que es la misma guarda de las fichas de papel (D38). **Lo ilegible se cuenta y se informa**: el cliente de WooCommerce descarta en silencio la fila que no cumple el esquema, y sobre 3.764 pedidos eso es perder facturación sin que nadie se entere, así que el script compara lo leído contra lo procesado y avisa. Lo cancelado y lo reembolsado no entra: no es facturación. Va como script de consola y no como pantalla porque son minutos de paginación contra un hosting que corta a los 30 segundos, y se corre una sola vez en la vida del sistema. |
| **D56** | **Sin conexión el POS sigue vendiendo: guarda la venta cobrada y la sube sola cuando vuelve.** *Cumple D25 y deroga D1 en lo que hace a la venta.* Es offline acotado, no offline de verdad: caché del catálogo y cola de la venta confirmada, nada de resolución elaborada de conflictos. Tres piezas. **Un service worker** hace que la pantalla abra sin servidor, que es lo primero que hay que resolver: la tablet se recarga sola y sin eso aparece el dinosaurio. **El catálogo se guarda entero en IndexedDB** —unos pocos cientos de kilobytes— y el buscador cae ahí con el mismo criterio de orden que usa el servidor, porque el lector de código de barras agrega el primer resultado y si offline el primero fuera otro el mismo gesto vendería otro producto. **La venta cobrada va a una cola**, con la misma clave de idempotencia que usa el servidor, y se guarda **antes** de intentar subirla: al revés, un error en el medio es una venta cobrada que no existe en ninguna parte. Tres cosas se pagan por esto y las tres se hacen visibles en vez de esconderse: el comprobante sale **sin número** y lo dice en la cara, porque el correlativo lo asigna el servidor; **el stock puede quedar en negativo**, porque sin conexión no se puede reservar nada y rechazar la venta al subirla no devuelve el producto que el cliente ya se llevó; y **el precio lo pone la pantalla**, única excepción a D28, porque sin catálogo que consultar lo cobrado es el único dato que existe y recalcularlo cambiaría lo que el cliente pagó y descuadraría el cajón. Lo que reemplaza a la guarda es el **desvío**: cada venta diferida guarda cuánto se apartó del catálogo, y se muestra en la lista de ventas. Y **el turno no se cierra con ventas esperando**: esa plata está en el cajón y el sistema no la cuenta, así que cerrar sería inventar una diferencia y hacer que alguien la justifique. |
| **D41** | **Cuando el negocio le queda debiendo plata a un cliente, eso se anota y se reclama; no se convierte en saldo a favor.** Pasa al anular una venta fiada de la que el cliente ya pagó una parte: la deuda se va con la venta, pero esa plata entró a la caja y el cliente no se llevó nada. La cuenta corriente no admite saldo negativo a propósito (D36) y torcerla volvería «te debo» y «me debes» el mismo número con distinto signo; son dos cosas y el mostrador las trata distinto: una se cobra, la otra se devuelve. Va en su propia tabla y se reclama en pantalla —en la venta, en la lista de fiado y en la ficha del cliente— hasta que alguien marca que se devolvió. El sistema **no** saca el efectivo del cajón solo: la devolución puede pasar en otro turno y por otro medio del que entró, así que es un acto de una persona; lo que el sistema hace es no dejar que se olvide. |
| **D42** | **El arqueo muestra la plata que entró, no la suma de los renglones de cobro.** El efectivo va neto de vuelto, los cobros de fiado cuentan porque son plata, y lo fiado en el turno figura aparte porque es facturación sin ingreso. Antes el desglose sumaba un número que no existía en ningún cajón: bruto de vuelto, con el fiado adentro y sin los cobros. El invariante que ahora se prueba: el efectivo del desglose es exactamente el efectivo esperado menos la apertura. |
| **D39** | **El WhatsApp se manda por `wa.me`, con el texto ya escrito, y lo aprieta una persona.** El POS arma el mensaje y abre el chat; no hace falta cuenta de Meta Business, ni plantillas aprobadas, ni pagar por conversación, y funciona hoy desde la MacBook. La contrapartida es que el sistema **no puede confirmar la entrega**, así que todo lo que se guarda dice «preparado» y nunca «enviado». La Cloud API queda para cuando los mensajes tengan que salir solos: la pieza que cambia es una sola —cómo se entrega el texto— porque el texto, a quién, cuándo y con qué control de repetición ya están resueltos del lado del POS. |
| **D40** | **Al mismo cliente se le recuerda la deuda una vez cada siete días, y el número lo pone el dueño.** Antes de ese plazo el botón pide confirmación en vez de abrir el chat. Quien recibe tres mensajes en una semana no paga antes: deja de comprar, y el fiado de este negocio se sostiene sobre clientes que vuelven. El texto de los dos mensajes —comprobante y recordatorio— también lo escribe el dueño: es la voz del local, no del programador, y un `{campo}` inventado se rechaza al guardarlo y no cuando el cliente ya leyó la llave. |
| **D33** | **Los precios del catálogo son finales: el local es monotributo y no discrimina IVA.** El POS cobra el número de la ficha y no calcula IVA en ninguna parte. Si algún día cambia la condición fiscal, la regla es guardar siempre el precio final y calcular el neto para los reportes, nunca al revés. |

---

## 12. Precios en dólares (D22)

**Diagnóstico.** 85 productos tenían precio menor a $3.000, y se partían en dos problemas distintos:

| Grupo | Cantidad | Qué era |
|---|---|---|
| **iPhones** | **53 — todos, sin excepción** | Precios en USD (195 a 1.370) mezclados con el resto del catálogo en pesos, sin ninguna marca que los distinguiera |
| **Productos a $1** | 32 | No es moneda: es **precio sin cargar**. Microondas, freidoras, un Moto G54 |

El resto de los celulares sí estaba en pesos (Samsung A17 ~$410.000, Motorola G86 ~$382.000). La regla resultó limpia: **iPhone = dólares, todo lo demás = pesos**.

### Fuente

**InfoDolar, dólar blue de Córdoba, precio de venta.** La página tiene dos tablas y solo una sirve:

| Tabla | Qué es | Valor al 03/08 |
|---|---|---|
| `id="Promedio"` | Promedio de casas de cambio — **NO es el blue** | 1.520,58 |
| `id="BluePromedio"` | **Dólar Blue en Córdoba** | **1.571,00** |

Apuntar a la primera daba precios ~3% más bajos. El blue de Córdoba está ~1% por encima del nacional, lo que justifica usar la fuente regional: en un iPhone de USD 1.370 son unos $22.000 de diferencia.

**Respaldo automático:** si InfoDolar falla o cambia su HTML, se usa `dolarapi.com` (blue nacional) y se avisa en el escritorio tras 3 fallos seguidos.

### Arquitectura

- **Nunca se consulta la cotización al cargar una página.** Tarea programada dos veces por día (9:00 y 17:00, alineado con el horario del local), valor guardado en una opción.
- **El USD es la fuente de verdad**; el precio en pesos se reescribe con la CRUD de WooCommerce.
- **Sin margen**, redondeo **al millar**: USD 1.370 × 1.571 = 2.152.270 → **$2.152.000**.
- La ficha muestra `USD 1.370,00 · cotización $1.571,00 del 03/08 20:35`. En el catálogo no aparece, para no ensuciar las tarjetas.

### Guardas

Ante cualquier duda **no se toca ningún precio**:

- Fallo de ambas fuentes → se conserva la cotización anterior
- Valor fuera de la banda 100–500.000 → se descarta
- Salto mayor al 15% respecto de la anterior → se descarta y se avisa (salvo actualización manual)

### Estado

Aplicado en staging: **53 productos migrados y convertidos**. Se guardó `_li_precio_original_backup` en cada uno por si hay que revertir.

---

## 5. Alcance funcional del POS v1

Paridad con lo que YITH hace hoy, verificado contra su configuración real en este sitio.

### Autenticación y caja
- Pantalla de login propia para cajeros (credenciales WordPress)
- Selección de tienda y caja (autoseleccionada al haber una sola)
- Apertura de sesión con efectivo inicial
- Bloqueo: una sola sesión activa por caja
- Cierre de sesión con reporte: cantidad de pedidos, productos vendidos, total por medio de pago, ventas netas, efectivo esperado en caja, nota libre

### Venta
- ~~**Venta libre de monto abierto**~~ — **eliminada por D24.** Lo que hoy se carga como monto abierto se resuelve catalogando servicios técnicos y chips como productos de `Solo mostrador`, con precio editable en la venta, y sacando el fiado a su propio módulo. El texto original se conserva abajo porque describe los conceptos frecuentes que hay que dar de alta. ~~concepto escrito a mano + precio + cantidad, sin producto de catálogo. **Es el 58% de la facturación (D12)**~~: tiene que ser una acción de primer nivel, no un rodeo con un "producto ficticio" como hoy. Debe permitir guardar conceptos frecuentes ("Virus", "Soft", "limpieza", "chip") como accesos rápidos reutilizables.
- Buscador de productos por nombre y SKU (resultados limitados)
- Lector de código de barras (entrada tipo teclado HID)
- Navegación por categorías
- Stock visible en cada producto
- Carrito: cantidad, eliminar línea, precio manual
- Descuentos por línea y sobre el total, en % o monto fijo, con presets (5 / 10 / 15 / 20 / 50)
- Recargos
- Nota de pedido
- Venta anónima por defecto, con captura opcional de nombre y teléfono
- Ventas en espera (guardar y retomar carrito)

### Cobro
- Medios: efectivo, transferencia bancaria, cheque
- Pago mixto (varios medios en un mismo pedido)
- Cálculo de vuelto
- Al confirmar: crea un pedido WooCommerce en estado *completado* y descuenta stock

### Recibo
- Plantilla configurable: logo, nombre y dirección del local, teléfono, fecha, número de pedido, SKU, pie de página
- Impresión desde el navegador con hoja de estilos de 80 mm

### Administración
- Roles propios: `lucas_pos_cajero` y `lucas_pos_encargado`
- Listado de sesiones con sus reportes
- Listado de pedidos del POS con reimpresión de recibo
- Devoluciones y reembolsos

### Fuera de alcance en v1
Compras y proveedores, control de márgenes, múltiples cajas o depósitos, facturación electrónica, modo offline.

**Cuenta corriente: a revisar (P9).** Estaba fuera de alcance por D3, y estrictamente lo sigue estando porque YITH tampoco la tiene. Pero el hallazgo de la sección 3 muestra que el cliente ya lleva un libro de fiado a mano dentro de las líneas de pedido, con montos de $50.000 a $400.000 y clientes recurrentes. Es la mejora de mayor valor identificada hasta ahora. Decisión pendiente: incluirla en v1 o dejarla para v1.1 inmediatamente después del corte.

> **Nota de campo:** las sesiones de caja actuales quedan abiertas días enteros y el efectivo en caja siempre figura en 0 — en la práctica no hacen arqueo. El diseño del cierre de caja debe contemplar ese hábito real, no el ideal.

---

## 6. Arquitectura técnica

> **Derogada por D23.** Esta sección describe el POS como plugin de WordPress.
> La arquitectura vigente es una aplicación Next.js separada; ver
> [`pos/README.md`](pos/README.md). Se conserva el texto porque documenta el
> mapeo de la meta de YITH y la compatibilidad histórica, que siguen valiendo
> para la migración del histórico.

### Stack

**Backend** — Plugin `lucas-pos`, PHP 8.3, endpoints REST propios bajo `lucas-pos/v1`, autenticación por cookie de WordPress + nonce (mismo origen). Sin dependencias externas en runtime.

**Frontend** — SPA compilada (React o Preact + Vite), servida desde una página dedicada del sitio. Build versionado en el repositorio; sin CDN ni recursos externos.

Este es el mismo patrón que usa YITH hoy — todos los pedidos históricos figuran como `created_via = rest-api` — así que está probado en este hosting.

### Modelo de datos

**Entidades como CPT nativos:**
- `lucas_pos_store` — tienda/local
- `lucas_pos_register` — caja
- `lucas_pos_receipt` — plantilla de recibo

**Tablas propias** (solo donde WooCommerce no alcanza):

```
wp_lucas_pos_sessions
  id, store_id, register_id, opened_at, closed_at,
  opened_by, closed_by, opening_cash, closing_cash,
  expected_cash, note, report (JSON)

wp_lucas_pos_cash_movements
  id, session_id, type (ingreso|egreso), amount,
  reason, user_id, created_at
```

**Meta de pedido** (sobre `WC_Order` estándar):

```
_lucas_pos_order      = yes
_lucas_pos_store_id
_lucas_pos_register_id
_lucas_pos_session_id
_lucas_pos_cashier_id
_lucas_pos_payments   = JSON [{gateway, amount}]
_lucas_pos_change
created_via           = lucas-pos
```

**Compatibilidad histórica:** una capa de lectura mapea la meta `_yith_pos_*` de los 3.763 pedidos existentes y las 243 sesiones de `wp_yith_pos_register_sessions`, para que los reportes del sistema nuevo incluyan el histórico. **No se borra ni se altera ningún dato de YITH.**

### Medio de pago "efectivo"

YITH aporta su propio gateway `yith_pos_cash_gateway`. Al desactivarlo se pierde. El plugin propio registra un gateway `lucas_pos_cash`, visible solo en el POS y oculto en el checkout público.

---

## 7. Plan de convivencia y corte de YITH

1. **Desarrollo en staging.** Nada se escribe en producción.
2. **Instalación en producción en ruta propia** (`/caja`), sin tocar `/pos`. Ambos sistemas activos, contra el mismo catálogo y el mismo stock.
3. **Doble operación, 2 a 4 semanas.** El cajero real usa el sistema nuevo en el día a día. Si algo falla, vuelve a la pestaña de YITH y sigue vendiendo. Criterios de salida: cero pedidos perdidos, stock consistente, cierres de caja cuadrados, y conformidad del encargado.
4. **Corte.** Se desactiva YITH — no se desinstala. Se deja inerte al menos un mes más.
5. **Baja de la membresía.** Recién después del corte. Antes hay que **confirmar con YITH qué ocurre al vencer la licencia** (lo habitual es perder actualizaciones y soporte, no la funcionalidad) — no se da por sentado.
6. **Desinstalación definitiva** con backup previo, y solo tras verificar que ningún dato histórico depende del plugin.

---

## 8. Bases de la tienda online

- **Mismo catálogo, mismo stock.** Sin catálogo paralelo ni sincronizaciones.
- **Política antisobreventa.** Mostrador y web comparten stock físico; con 685 productos disponibles, muchos con unidades sueltas, un artículo con stock 1 se puede vender dos veces. Se define reserva por tiempo (`hold_stock`, hoy 60 min) y/o buffer de seguridad por producto.
- **Precio final al público.** Definir el tratamiento de IVA y unificar criterio entre POS y web.
- **Envíos reales.** Retiro en local, envío en Santa Rosa de Río Primero y alrededores, y transporte nacional. A definir en la fase de diseño.
- **Pagos.** Mercado Pago ya está operativo (checkout básico + tarjeta). Definir si se ofrece transferencia con descuento y política de cuotas.
- **Base de clientes desde cero.** No hay historial de contactos aprovechable: la captación arranca de cero con el lanzamiento.
- **El servicio técnico queda fuera de la web (D18).** Sigue siendo canal de mostrador y se registra en el POS como venta libre.
- **Expectativa a alinear con el cliente:** la web no va a replicar la facturación del local en el corto plazo. Hoy solo el 11,5% del negocio pasa por productos catalogados. Es un canal nuevo que hay que construir.

### 8.1 Modelo vs. unidad física (D13)

El cliente pide borrar productos vendidos y **el pedido es legítimo**: hoy cada iPhone usado es un producto de catálogo cuyo título contiene el IMEI. Una vez vendido ese equipo, no existe más.

Ejemplos reales del catálogo actual:

```
iPhone 13 128gb 84% (44012)
iPhone 15 Pro 256gb 81% (18676)
Samsung A03 128gb USADO (50408)
```

**54 productos publicados llevan un serial en el título y 46 llevan porcentaje de batería.** Hay 365 productos con stock = 1.

El problema no es el hábito de borrar: es que **el catálogo confunde dos cosas distintas**.

| Concepto | Qué es | Ciclo de vida | En la web |
|---|---|---|---|
| **Modelo** | "iPhone 13 128GB" | **Permanente.** Nunca se borra | Una sola página, URL estable, SEO, fotos, descripción |
| **Unidad** | IMEI 44012, batería 84%, costo, precio | **Efímera.** Se da de alta al ingresar, se marca vendida al vender | No tiene página propia; alimenta el stock del modelo |

Con esta separación, el cliente sigue haciendo exactamente lo que quiere —el equipo vendido desaparece del sistema— pero la página de "iPhone 13 128GB" sobrevive, acumula posicionamiento y capta demanda cuando no hay stock ("avisame cuando entre"), que es justamente lo que hoy se tira a la basura cada vez que se borra un producto.

**Implementación:** producto persistente por modelo + unidades gestionadas por el plugin propio (IMEI, % de batería, estado, costo). Hasta que exista el plugin, se puede resolver con productos variables, una variación por unidad.

**Accesorios genéricos reemplazados:** tampoco se borran. Se ocultan del catálogo (`catalog_visibility = hidden`) o se redirige la URL vieja al reemplazo con un 301. La diferencia con borrar es que no se generan 404 ni se pierde el historial.

### 8.2 Alerta: notas internas en títulos públicos

Varios títulos de productos publicados contienen anotaciones internas del vendedor:

```
iPhone 13 128gb 86% (54265) (Rec en enero $290, hoy a $250)
iPhone 15 128gb 87% (08331) (Pia, cambio glass idrop $390)
iPhone 13 Pro 128gb 100% (9229) (Tello, bat idrop $365)
```

Hoy no molestan porque nadie ve la web. **En una tienda pública quedan expuestos precios de compra, nombres de clientes y márgenes.** Hay que sacarlos a campos internos en Fase 1, antes de cualquier lanzamiento.

También hay categorización cruzada: "Smartphones nuevos" contiene iPhones usados con porcentaje de batería e IMEI.

### 8.3 Producción de imágenes (D15)

Tres vías, en orden de conveniencia:

| Vía | Qué cubre | Quién |
|---|---|---|
| **A — Assets oficiales de distribuidores** | Marcas que Lucas Innovaciones revende: Apple (57), Netmak (32), FoxBox (30), Noganet (21), Samsung (16), Xiaomi, Motorola, JBL, Kolke, Stanley | El cliente los pide a sus distribuidores; se arma la lista por marca. Gratis, legal y de calidad consistente |
| **B — Fotografía propia en el local** | Todo lo que no cubra la vía A. Los productos están físicamente ahí | El cliente fotografía con protocolo definido; importación masiva automática por SKU |
| **C — Imágenes generadas por IA** | Banners de categoría, hero de la home, ilustraciones de servicio técnico, iconografía, gráficos promocionales, 404 | Se generan durante la Fase 2 |

**Lo que no se hace:** descargar imágenes de terceros sin autorización, ni generar con IA la foto de un SKU real. Una foto inventada de "Cable USB tipo C Fox Box Axon 20w" no es ese cable: produce reclamos, devoluciones y contracargos en Mercado Pago, y bloquea el catálogo en Google Merchant Center y Meta Commerce si más adelante se quiere pautar.

**Palanca técnica:** un importador que tome archivos nombrados por SKU (`PHO-NOKIA-NOKIA-1.jpg`) y los asigne solo. Convierte la carga de 143 fotos en una operación de minutos. **Requisito previo:** los 93 productos sin SKU tienen que tenerlo (Fase 1).

### 8.4 Base de diseño (D17)

**Template:** "SWOO — Tech Mart", Figma Community, file key `jqYBUcohlipdHwwSoXPBrt`. 11 pantallas: Home, Product (catálogo), Single Product, Single Product pay, Card (carrito), Checkout, Login, Registro, Profile, About, Contact.

Se toma como **referencia visual** y se implementa en el tema propio (D9). No se importa ni se convierte automáticamente.

**Lo que encaja bien:**

- Es un template de electrónica y tecnología — exactamente el rubro del negocio.
- Verde como color primario, coherente con el verde que el cliente ya eligió para el POS (`rgb(9,174,20)`).
- El catálogo trae **filtro por condición: New / Like New / Open Box**, más filtros por marca, precio, memoria y color. Encaja perfecto con el negocio de iPhones usados y con el modelo modelo/unidad de 8.1.
- Badges de descuento, "sin stock" y "nuevo" en las tarjetas de producto.
- La estructura de páginas cubre todo lo necesario para la tienda.

**Lo que hay que resolver — y es trabajo real, no ajustes:**

| # | Brecha | Impacto |
|---|---|---|
| 1 | **No hay diseño mobile.** Las 11 pantallas son 1920px de escritorio | En Argentina el ecommerce es mayoritariamente móvil. La mitad más importante del diseño no está en el archivo: la hacemos nosotros |
| 2 | **Está pensado para un catálogo enorme.** La home muestra ~45 tarjetas de producto, más "Deals of the day" con countdown, "Best seller / New in / Popular", "Recently viewed" y 10 logos de marcas | Con 150 productos hay que recortar secciones o la home se ve vacía |
| 3 | **Los filtros necesitan atributos que no existen.** Hoy hay **0 atributos globales**; los 803 productos son simples y sin atributos | Para que el catálogo filtre por capacidad, color, memoria o condición hay que crear la taxonomía y cargarla en los 150 productos. Trabajo significativo de Fase 1 |
| 4 | **Elementos que no aplican:** selector de moneda USD, selector de idioma, "Sell on Swoo" (marketplace multivendedor), "Download our app", cashback, Klarna/Stripe/PayPal en el footer, estrellas de rating | Se eliminan. Los pagos acá son Mercado Pago y transferencia; las reviews están deshabilitadas y no hay historial que las alimente |
| 5 | Las secciones del template pensadas para servicios y contenido editorial (blog, store locations) quedan sin uso | Se eliminan. La web vende productos únicamente (D18) |

**Pendiente:** revisar los términos de uso del archivo de Community, dado que el destino es comercial (P15).

### Bloqueante principal

**781 productos sin foto (97% del catálogo).** Ninguna decisión de diseño lo resuelve.

Por D10 se lanza curado. La lista priorizada está en **`catalogo-prioridad-fotos.csv`** (200 productos ordenados por rotación real de 12 meses, ponderada por facturación de su categoría y por precio). Estado del top 150:

| Métrica | Valor |
|---|---|
| Con venta registrada en 12 meses | 150 / 150 |
| **Con foto** | **7 / 150** |
| Con descripción | 125 / 150 |

**Faltan 143 fotos para poder lanzar.** Ese número es el cronograma real del proyecto web.

**Nota sobre la composición de la lista:** los productos de mayor rotación son accesorios de ticket bajo — vidrios templados ($5.000), fundas ($8.000), cables ($6.000-13.000). La facturación, en cambio, está en Smartphones nuevos ($8,15M en 12 meses, categoría #1). Para la web conviene combinar ambos: los accesorios traen tráfico y volumen, los celulares traen facturación. Pero los celulares solo funcionan online si se resuelve antes la persistencia del catálogo.

Falta definir **quién produce las imágenes y a qué ritmo** (P6).

---

## 9. Fases

Orden acordado: **primero la tienda online, el POS al final** (D8).

| Fase | Contenido | Depende de |
|---|---|---|
| **0 — Infraestructura** | Staging en subdominio · backup verificado · repositorio git · **pipeline de despliegue del tema** (ver 9.2) · corregir HTTPS (`siteurl`/`home` + búsqueda y reemplazo cuidadoso, atención a las URLs absolutas dentro del JSON de Elementor) | Acción del cliente en Ferozo |
| **1 — Higiene de datos** | Depurar 1.736 etiquetas · normalizar categorías y marcas · asignar SKU a los 93 faltantes · **crear la taxonomía de atributos (capacidad, color, memoria, condición) y cargarla en los 150 del lanzamiento** · sacar notas internas de los títulos · recategorizar usados · corregir stock ficticio y precios basura · limpiar residuos (WPML, ACF, `wc_customer_lookup`) | Fase 0 |
| **2 — Diseño web** | Adaptación del template SWOO al negocio · **diseño mobile completo (no existe en el original)** · paleta y tipografía derivadas del logo actual · recorte de secciones de la home · generación de banners e ilustraciones con IA | Fase 1 |
| **3 — Tienda online** | Desarrollo del tema propio · retiro de Elementor y PRO Elements · fichas de producto · envíos · pagos · política antisobreventa · SEO · lanzamiento | Fases 1, 2 y carga de imágenes |
| **4 — POS v1** | Diseño de UI del POS · desarrollo del plugin en staging | Fases 0 y 3 |
| **5 — Convivencia y corte** | Doble operación, validación, desactivación de YITH, baja de membresía | Fase 4 |
| **6 — Post-corte** | Migración a HPOS · limpieza final · optimización | Fase 5 |

**Consecuencias del orden elegido:**

- Durante las fases 0 a 3 **no se toca el POS**: el riesgo sobre la operación diaria es prácticamente nulo.
- La **producción de imágenes es el camino crítico** y arranca ya. Nada de la Fase 3 avanza sin fotos.
- La **política antisobreventa (P8) deja de ser diferible**: al abrir la tienda, la web y el mostrador competirán por el mismo stock desde el primer día.
- La **corrección de HTTPS se vuelve urgente**: no puede haber checkout público con `siteurl` en `http://`.
- El staging deja de ser temporal: una vez que la tienda esté en vivo, ya no habrá margen para probar en producción, ni siquiera para el POS.
- La membresía de YITH se sigue pagando durante todo el desarrollo de la web.

### 9.1 "WordPress de cero": limpieza en sitio, no reinstalación (D14)

El objetivo —un sitio limpio, sin arrastrar basura— es correcto. La forma de conseguirlo **no** es reinstalar WordPress.

**La suciedad real es chica y perfectamente removible:**

| Origen | Huella |
|---|---|
| Elementor + PRO Elements | 727 filas de postmeta, 84 opciones, 8 posts, 6 tablas `wp_e_*` |
| WPML (desinstalado) | 2 tablas `wp_icl_*`, 1 opción |
| ACF (desinstalado) | 2 post types huérfanos ("Banners", "Testimonios") |
| Otros | Carpetas `jetpack-waf` y `ai1wm-backups`, `wp-cache-config.php` de WP Super Cache |

El núcleo de WordPress está sano: un solo tema instalado, 53 KB de autoload, base de 60 MB.

**Lo que costaría reinstalar:** habría que migrar 803 productos, 3.764 pedidos, 6.151 notas de pedido, 5.616 líneas de pedido con 57.923 filas de metadatos, las tablas de reportes de WooCommerce, 243 sesiones de caja, los roles y capacidades de YITH, los 3 usuarios y la configuración de WooCommerce y Mercado Pago — todo desde un sistema que **factura diez veces por día**. Cualquier ventana de migración es una ventana sin poder vender, y cualquier registro que quede atrás es una venta que desaparece. Es exactamente el riesgo que la Regla 0 existe para evitar.

**Lo que sí se hace de cero** (y es todo lo que se ve):

- Tema propio desde cero — se elimina Hello Elementor
- Home rehecha — se descarta la actual, construida con Elementor
- Se eliminan las plantillas de Elementor: Kit por defecto, Menu popup, Plantilla mantenimiento
- Páginas de tienda, carrito, checkout y cuenta con plantillas propias
- Se desinstalan Elementor y PRO Elements, y se purgan sus 727 metadatos, 84 opciones y 6 tablas
- Se eliminan las tablas de WPML y los post types de ACF
- Se depuran las 1.736 etiquetas y se normalizan categorías y marcas

Resultado: un WordPress tan limpio como uno recién instalado, conservando intactos el catálogo, el historial de ventas y el POS en funcionamiento.

### 9.2 Accesos y despliegue

**No se comparten credenciales de Ferozo, DonWeb ni de ningún panel por chat.** No son necesarias: el acceso al WordPress ya existe a través del MCP de Novamira (PHP, WP-CLI, lectura y escritura de archivos).

**Restricción del hosting (verificada en el servidor):** `open_basedir` limita PHP a `/home/l0070559/public_html`. No existe acceso a nada fuera de esa carpeta. **El subdominio de staging tiene que apuntar a una carpeta dentro de `public_html`** — es la arquitectura de Ferozo y no es negociable.

**La anidación es segura en este caso.** El `.htaccess` de producción contiene el bloque estándar de WordPress:

```apache
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.php [L]
```

Las condiciones `!-f` y `!-d` hacen que las peticiones que resuelven a un archivo o carpeta real no se reescriban. Como `/public_html/staging/` será una carpeta real, el WordPress de producción no la intercepta, y el staging manda con su propio `.htaccess`. No hay más reglas a nivel de padre que puedan capturar la subcarpeta: solo LiteSpeed Cache y el bloque de WordPress. Espacio libre disponible: 599 GB.

**Lo que tiene que hacer el cliente en Ferozo (una sola vez):**

1. **Apuntar el subdominio** `staging.lucasinnovaciones.com.ar` a la carpeta `staging` dentro del sitio (opción "Apuntar subdominio" / "Redireccionar a una carpeta del sitio").
2. **Activar el certificado SSL** del subdominio — hoy figura vacío en el panel.
3. **Instalar WordPress** en ese subdominio desde el menú *Wordpress* de Ferozo, marcando "disuadir a los motores de búsqueda".
4. **Proteger la carpeta con contraseña.** Al vivir dentro de `public_html`, el staging también queda accesible como `lucasinnovaciones.com.ar/staging/`. La protección de directorio de Ferozo es la mitigación correcta.
5. **Confirmar** si DonWeb hace backups automáticos y cómo se restauran.
6. **Instalar el plugin Novamira en el staging** y conectarlo como segundo endpoint MCP, igual que se hizo con producción. Sin esto, no hay forma de operar el staging.

**Efecto lateral favorable:** como el staging queda dentro de `open_basedir`, el MCP de producción puede leer y escribir en su carpeta, lo que facilita la copia inicial de archivos y los despliegues.

**Límite técnico detectado:** el MCP no permite escribir archivos PHP fuera de su carpeta sandbox (`wp-content/novamira-sandbox/`). El tema propio no se puede desarrollar escribiendo archivos sueltos por esa vía.

**Pipeline de despliegue en consecuencia:**

```
Desarrollo local (D:\Proyectos\Lucas Innovaciones\Web, con git)
        ↓  empaquetado en ZIP
Subida con novamira/create-upload-link
        ↓
Instalación y activación por WP-CLI en staging
        ↓  validación
Mismo procedimiento contra producción, fuera de horario comercial
```

Esto además da el control de versiones que hoy no existe: el tema y el plugin del POS viven en el repositorio local, no solo en el servidor.

### 9.3 Estado del staging — clonado el 2026-08-03

**Ubicación:** `/home/l0070559/public_html/staging/` · base `l0070559_staging` · URL `https://lucasinnovaciones.com.ar/staging`

| Elemento | Resultado |
|---|---|
| Archivos copiados | 12.173 archivos + 2.552 carpetas (185 MB), 0 errores |
| Tablas clonadas | 61 de 67 |
| Datos verificados | 803 productos · 3.764 pedidos · 112 categorías · 93 marcas · 243 sesiones de caja · 3 usuarios |
| URLs reescritas | 40 en `post_content`, 6 en `postmeta` (incluye 3 `_elementor_data`), 4 en `options`. Cero referencias residuales a producción |
| Páginas verificadas | Home, Tienda y Login responden 200 con WooCommerce activo |
| Producción | **Intacta.** 10/10 claves críticas coinciden entre base y caché |

**Tablas deliberadamente NO clonadas** (contienen el estado de autenticación propio del staging; sobrescribirlas corta el acceso por MCP):

```
wp_novamira_oauth_clients        wp_novamira_oauth_auth_codes
wp_novamira_oauth_access_tokens  wp_novamira_chat_sessions
wp_novamira_oauth_refresh_tokens
```

`wp_options` se clonó preservando las 8 filas `novamira_*` más `siteurl`, `home` y `blog_public`.

**Protecciones aplicadas al staging:**

- `blog_public = 0` (no indexable)
- Object cache de LiteSpeed **desactivado** — evita la colisión de claves con producción en Valkey `db_id 559`
- mu-plugin `staging-safety.php`: bloquea el correo saliente, deshabilita todas las pasarelas de pago y muestra un aviso permanente en el escritorio
- 13 tareas de Action Scheduler heredadas de producción canceladas y `cron` vaciado, para que el staging no ejecute trabajos reales

**Pendiente de la Fase 0:** protección por contraseña de la carpeta (P18), repositorio git local, y corrección del HTTPS de producción.

### 9.4 Hallazgos nuevos para la lista de lanzamiento

- **`blog_public = 0` en producción.** Está así en la base, es preexistente — el sitio nunca fue público. **Debe pasar a 1 el día del lanzamiento**, o la tienda será invisible para Google (P19).
- **Sesión de caja huérfana:** la sesión `id 1`, abierta el 2025-04-18, nunca se cerró. Ensucia cualquier reporte histórico (P20).

---

## 10. Pendientes de definición

| # | Tema | Para qué fase |
|---|---|---|
| P1 | Hardware del POS: modelo de impresora térmica, lector de códigos, cajón de dinero. **Cómo imprimen hoy** | 4 |
| ~~P2~~ | ~~Elementor vs. tema propio~~ — **resuelto por D9: tema propio** | — |
| ~~P3~~ | ~~Licenciar o eliminar PRO Elements~~ — **resuelto por D9: se elimina junto con Elementor** | — |
| P4 | Tratamiento de IVA y precio final al público | 1 |
| P5 | **Política de envíos y costos.** Hoy la única zona es "Todo el país" con **Envío gratuito** como único método: es irreal y significa regalar el flete a toda Argentina | 3 |
| P29 | **Habilitar el retiro en el local en producción.** La ubicación ya está cargada con datos reales — "Local comercial", Caseros 924, Villa Santa Rosa (5133), horario *"De 9 a 12:30 y de 17 a 21"*— pero el método estaba deshabilitado. Activado en staging | 3 |
| P6 | **Producción de imágenes: 143 fotos faltantes del top 150. Responsable y ritmo** — camino crítico, arranca ya. Vías A/B/C en 8.3 | 3 |
| P13 | Sacar las notas internas de los títulos de producto (precios de compra, nombres de clientes) | 1 |
| P14 | Recategorizar: hay iPhones usados con IMEI dentro de "Smartphones nuevos" | 1 |
| P15 | Revisar los términos de uso del template de Figma Community (destino comercial) | 2 |
| P16 | Qué secciones de la home del template se conservan con 150 productos | 2 |
| P17 | ~~Definir el juego de atributos~~ — **resuelto**: ver [MAPA-ATRIBUTOS.md](MAPA-ATRIBUTOS.md) | 1 |
| ~~P21~~ | ~~Cómo se venden online vidrios, hidrogeles y fundas~~ — **resuelto por D20**. Piloto hecho, 14 productos pendientes de convertir | 1 |
| P24 | Listas de modelos propias para "Hidrogel smartwatch" e "Hidrogel tablet" | 1 |
| P25 | Política de stock en productos variables sin gestión: aviso de demora en el checkout para modelos poco comunes | 3 |
| ~~P22~~ | ~~Réplicas publicadas bajo marca ajena~~ — **resuelto por D19**, aplicado en staging | — |
| P23 | Asignar la marca Apple a los 8 iPhones genuinos que no la tienen | 1 |
| P18 | Reescribir `robots.txt` para ecommerce y proteger el staging con contraseña de directorio | 0 |
| P19 | **Poner `blog_public = 1` en producción el día del lanzamiento** — hoy está en 0 y el sitio es invisible para Google | 3 |
| **P26** | **Desactivar el modo "Próximamente" de WooCommerce en producción el día del lanzamiento.** `woocommerce_coming_soon = yes` y `woocommerce_store_pages_only = yes`: la tienda está detrás de una pantalla de "próximamente" desde siempre | 3 |
| P27 | Faltaban las traducciones de WooCommerce (`wp-content/languages/plugins/`): la tienda salía en inglés. Instaladas en staging, **falta hacerlo en producción** | 3 |
| P28 | Evaluar cambiar el locale de `es_ES` a `es_AR` — el castellano de España usa "vosotros" y términos distintos a los del Río de la Plata | 2 |
| **P30** | **Verificar que el cron real del hosting alcance la tarea de cotización.** `DISABLE_WP_CRON = true` en producción **y** en staging: WordPress no dispara nada por sí solo. En producción hay evidencia de un cron de Ferozo funcionando (1.702 tareas completadas), pero hay que confirmar que corra al menos a las 9 y a las 17 | 3 |
| **P31** | **32 productos con precio $1** — no es un problema de moneda: es precio sin cargar. No se pueden publicar así. Microondas Westinghouse, freidora Morley, Moto G54, entre otros | 1 |
| P20 | Cerrar la sesión de caja huérfana `id 1`, abierta desde el 2025-04-18 | 1 |
| P7 | Confirmar con YITH el comportamiento del plugin tras el vencimiento de licencia | 5 |
| P8 | Política antisobreventa: reserva y/o buffer de stock | 3 |
| P9 | **Cuenta corriente de clientes en el POS: ¿v1 o v1.1?** Hoy se lleva a mano dentro de las líneas de pedido | 4 |
| P10 | Acordar el nuevo procedimiento con el cliente: unidades vendidas se dan de baja, **modelos y accesorios no se borran nunca** (D13) | 1 |
| ~~P11~~ | ~~Catalogar los servicios técnicos como productos vendibles online~~ — **descartado por D18** | — |
| P12 | Fecha de renovación de la membresía de YITH — define cuánto conviene apurar la Fase 4 | 5 |

---

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Dejar al local sin poder facturar | Regla 0 + convivencia + rollback a YITH en una pestaña |
| Trabajar sobre producción sin red | Fase 0 es bloqueante: sin staging ni backup no se escribe código |
| Sobreventa entre mostrador y web | Reserva de stock y buffer (P8) |
| Contenido mixto en el checkout | Corrección de HTTPS en Fase 0, antes de abrir la tienda |
| Vulnerabilidad vía PRO Elements | Eliminado junto con Elementor por D9 |
| **Expectativa desalineada sobre la web** | Solo el 11,5% del negocio pasa hoy por el catálogo. Conversación explícita con el cliente antes de invertir en fotos |
| **El lanzamiento depende de 143 fotos** | Definir responsable y ritmo ya (P6). Es el camino crítico, no el desarrollo |
| Productos borrados rompen URLs y SEO | Acordar la regla de no borrado (P10) antes de lanzar |
| Pérdida de histórico al desinstalar YITH | Capa de lectura propia + backup + desinstalación diferida |
