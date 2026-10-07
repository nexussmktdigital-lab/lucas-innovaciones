# Auditoría del POS

Primera pasada: 2026-09-12, antes de la fase 4 (fases 1 a 3, commit `c825d06`).
Segunda pasada: 2026-09-15, antes de la fase 6 (fases 1 a 5, commit `aa7d9c9`).

> **Estado: quedan abiertos cinco hallazgos, todos menores.** La fase 3.5
> corrigió del 1 al 8, el 12 y el 13; la 3.7 cerró el 9, el 10 y el 11; la 5.5
> cerró los cinco de la segunda pasada, del 21 al 25. Lo pendiente está en la
> lista del final.

Cómo se hizo: se levantó el sistema completo contra un PostgreSQL 16 real, con
los datos de prueba, y se lo usó a mano con un navegador —ingreso como dueño y
como vendedor, apertura de caja, siete ventas, cobros mixtos, precios
sospechosos, fiado, arqueo, cierre, cotización y catálogo— revisando después en
la base qué quedó registrado. Cada hallazgo de abajo está reproducido, no
deducido; donde hay número de venta, esa venta existió.

Lo que anduvo bien, para no perderlo de vista: la transacción de venta, el
candado de stock (dos ventas simultáneas de la última unidad: una entra y la
otra avisa), la idempotencia (tres reintentos con la misma clave = una sola
venta), el congelamiento del tipo de cambio, la guarda de cotización, el arqueo
que exige justificar la diferencia, la inmutabilidad ante `DELETE` y el
comprobante.

---

## Críticos — hoy se puede cobrar mal

### 1. Una variación se cobra al precio del producto padre

El buscador muestra la variación con su propio precio y su propio stock, pero
`confirmarVenta` reconstruye la línea leyendo **solo** la tabla `products`: usa
el precio del padre, valida el stock del padre y guarda el nombre del padre.

Reproducido: «Samsung Galaxy A17 128GB — 256GB», variación a $550.000 sobre un
padre de $410.000.

| Lo que se vio | Lo que quedó |
|---|---|
| Pantalla y carrito: **$550.000** | `sale_items.precio_unitario_centavos`: **$410.000** |
| Cliente entrega $550.000 | La venta se registra por $410.000 y el sistema inventa **$140.000 de vuelto** que nadie dio |
| Descripción en el ticket | «Samsung Galaxy A17 128GB», sin decir qué variación |
| Stock | Baja **dos veces**: variación 3 → 2 **y** padre 2 → 1 |
| Cola de Woo | Manda el stock del padre, ignora la variación |

En el catálogo real hay **600 variaciones** sincronizadas de WooCommerce, así
que esto no es un caso de laboratorio: es la mitad del catálogo.

Por qué se coló: no había ni un test con variaciones en `confirmar.test.ts`.

**Arreglado (fase 3.5).** `confirmarVenta` ahora carga las variaciones con su
propio candado, comprueba que la variación sea de ese producto, cobra su precio,
guarda «Producto — Medida» en el ticket y descuenta el stock donde de verdad se
lleva: en la variación si tiene el suyo (`gestiona_stock`, columna nueva que sale
de `manage_stock` de Woo) y si no en el padre, nunca en los dos. La cola escribe
en `products/<padre>/variations/<id>`. En dólares el precio lo sigue calculando
el sistema, aunque la variación diga otra cosa: la guarda de agosto no se saltea
por elegir una medida. Siete tests nuevos.

### 2. Dos pagos en efectivo en la misma venta dejan la caja en negativo

`confirmar.ts` resta el vuelto **a cada** pago en efectivo, en vez de una sola
vez al total.

Reproducido (venta **T1-000002**): un vidrio de $5.000, el cliente paga con
$3.000 + $10.000, vuelto $8.000.

```
cash_movements:  -$5.000  «Venta T1-000002 (neto de vuelto)»
                 +$2.000  «Venta T1-000002 (neto de vuelto)»
```

La caja quedó **$3.000 abajo** por una venta de $5.000: $8.000 de diferencia en
una sola operación. Si el primer pago es menor que el vuelto, además quedaba un
asiento negativo, que en un libro de caja no debería existir nunca.

**Arreglado (fase 3.5).** El vuelto se descuenta una sola vez, repartido entre
los pagos en efectivo hasta agotarlo, y un asiento que queda en cero no se
escribe. Tres tests nuevos, uno de ellos sobre el saldo de la cuenta.

### 3. Quitar un pago deja la pantalla mostrando un número y el sistema contando otro

Los renglones de pago se dibujan con `key={medio-índice}` y el monto es un
`input` no controlado (`defaultValue`). Al borrar un renglón, React reusa el
campo del anterior.

Reproducido: cargar $3.000 y $10.000 en efectivo, borrar el primero.

- El campo que queda **muestra `3000`**.
- El diálogo dice **Pagado $10.000** y **Vuelto $5.000**.

El cajero ve tres mil, el sistema cobra diez mil y le manda a dar cinco mil de
vuelto.

**Arreglado (fase 3.5).** Cada pago lleva su propia clave estable y el campo
pasó a ser controlado, guardando aparte lo tipeado para que se pueda escribir
«12.» sin que el campo se corrija solo. Test de punta a punta.

### 4. El vendedor puede saltear la guarda de precio sospechoso

La pantalla solo le ofrece el botón «cobrar igual» al dueño, pero
`registrarVenta` pasa `confirmarPreciosSospechosos` al dominio **sin mirar el
rol**. La guarda es de interfaz, no de servidor.

Reproducido: desde la sesión del **vendedor**, cambiando un `false` por un
`true` en el pedido, se vendió el iPhone 15 Pro Max 1TB a **$6.300** (venta
**T1-000003**) — exactamente el error de agosto que el sistema existe para
frenar.

**Arreglado (fase 3.5).** La bandera se ignora si quien la manda no es el dueño.
Repetido el mismo ataque contra el código nuevo: la venta se frena y no queda
nada en la base.

### 5. El vendedor pone el precio que quiera en servicios y chips

`venta.editar_precio` figura entre los permisos que necesitan autorización del
dueño, pero **nada lo comprueba**. Cualquier producto con `precio_editable`
—los cuatro servicios técnicos y los tres chips— acepta el precio que escriba
el vendedor.

Reproducido: sesión de vendedor, «Servicio técnico · Limpieza de virus» de
$7.050 vendido a **$1,00** (venta **T1-000007**), sin autorización y sin ningún
registro de que el precio se cambió.

**Arreglado (fase 3.5).** El servidor rechaza cualquier precio escrito si quien
vende no tiene `venta.editar_precio`, y la venta que sí lo lleva queda con
`autorizada_por`. La pantalla además ya no le muestra el campo al vendedor.
Comprobado inyectando el precio en el pedido: «Escribir el precio de un producto
lo tiene que autorizar el dueño».

---

## Graves — falta algo que el negocio necesita el primer día

### 6. No se puede anular ni corregir una venta

`venta.anular` existe como permiso y `sales.estado` tiene el valor `cancelled`,
pero no hay función de dominio, ni acción, ni pantalla. Una venta mal cargada
—producto equivocado, cantidad de más, cobro duplicado— **no tiene arreglo**: el
stock ya bajó, la caja ya sumó y el registro es inmutable.

Es lo primero que va a pasar el día que empiecen a usarlo en serio.

**Arreglado (fase 3.5).** `anularVenta` repone el stock deshaciendo exactamente
los movimientos que dejó la venta —así vuelve a la variación de la que salió—,
mete el asiento contrario en la caja, marca la venta como `cancelled` con el
motivo obligatorio y encola el stock repuesto para Woo. Nada se borra. Solo el
dueño, y solo dentro del turno abierto: revertir contra una caja cerrada
descuadraría dos arqueos. Once tests nuevos.

### 7. No hay listado de ventas ni forma de reimprimir un comprobante

El ticket se abre una sola vez, en una ventana emergente, justo después de
cobrar. Después no existe forma de volver a él: no hay pantalla de ventas del
turno y la URL `/ticket/<id>` necesita un id que solo se conoce en ese momento.

Peor: la ventana se abría con `window.open` **después de un `await`**, o sea
fuera del gesto del usuario. Safari bloquea eso, y la caja es una MacBook. Si el
bloqueo ocurre, el comprobante de esa venta se perdió para siempre.

**Arreglado (fase 3.5).** Hay pantalla **Ventas** (F4) con las ventas del turno,
lo que se llevó cada una, cómo se pagó y un enlace para volver a imprimir el
comprobante. La ventana del ticket ahora se pide *antes* de esperar al servidor,
dentro del gesto del cajero, y si aun así el navegador la bloquea queda el enlace
en pantalla.

### 8. La cuenta corriente ya cobra, pero la deuda no se guarda en ningún lado

«Cuenta corriente» aparece entre los medios de pago y funciona: la venta entra,
se marca `tipo = 'fiado'` y no mueve plata. Pero el saldo del cliente no existe
todavía (llega en la fase 5), así que **la deuda no queda registrada en ninguna
parte** fuera del campo `tipo` de la venta.

Reproducido: venta **T1-000005**, $5.000 a Gaby González, `credit_payments`
vacío y ninguna tabla con el saldo.

El menú «Fiado» está correctamente deshabilitado hasta la fase 5; el medio de
pago debería estarlo igual.

**Arreglado (fase 3.5).** «Cuenta corriente» salió de los medios de pago hasta
que exista el módulo. El dominio la sigue soportando, así que la fase 5 solo
tiene que volver a mostrarla.

### 9. La cola de WooCommerce solo se drena cuando hay una venta

`drenarEnSegundoPlano` se llama únicamente al confirmar una venta, y el
comentario del código dice «en producción, desde una tarea programada» — esa
tarea no existe. Si WooCommerce se cae después de la última venta del día, la
cola se queda quieta hasta la primera venta del día siguiente. Y tras 6
intentos fallidos la operación pasa a `fallido` y **no se reintenta nunca más**:
no hay botón para reintentar ni pantalla donde verla.

El cajero ve «N sin sincronizar» y no puede hacer nada con ese número.

Además el `void drenarEnSegundoPlano(db)` queda huérfano: en un entorno
serverless la función puede cortarse antes de que termine.

**Arreglado (fase 3.7).** Tres cosas. La cola ahora se drena también desde una
tarea programada que pega cada diez minutos en `/api/cron/sincronizar`, una ruta
que se autentica con `CRON_SECRET` y no con sesión. Hay pantalla
**Sincronización** para el dueño, enlazada desde el aviso de Inicio y de Caja,
que muestra qué espera, cuántos intentos lleva y con qué error falló, con dos
botones: «Sincronizar ahora» y «Reintentar las fallidas» —que devuelve a la cola
lo que agotó los seis intentos y lo intenta de una. Y el drenaje de después de
cada venta pasó de una promesa suelta a `after()`, que es lo que garantiza que
termine aunque la respuesta ya haya salido.

---

## Medios

### 10. Los montos de una venta cerrada se pueden reescribir

Los disparadores de inmutabilidad bloquean `DELETE` en `sales`, `sale_items` y
`sale_payments`, pero **no `UPDATE`** (a propósito: anular necesita cambiar
`estado`). El efecto colateral es que un `UPDATE sales SET total_centavos = 1`
pasa sin ruido. Comprobado.

**Arreglado (fase 3.7).** Un disparador nuevo deja pasar el UPDATE solo en las
columnas que de verdad cambian después de cobrar —`estado`,
`motivo_anulacion`, `synced_to_woo`, `woo_order_id` y `nota`— y frena todo lo
demás: importes, fecha, vendedor, caja, clave de idempotencia. En las líneas y
los pagos el UPDATE se bloquea entero: corregir es anular y volver a vender.

### 11. El webhook `product.updated` de WooCommerce pisa el stock local

El POS es la fuente de verdad del stock y le manda a Woo el valor absoluto. Pero
cuando Woo devuelve un `product.updated`, el webhook escribe `stock` de vuelta
sobre el espejo local. Entre una venta y su sincronización, eso puede deshacer
el descuento. El precio sí corresponde que lo mande Woo; el stock no.

**Arreglado (fase 3.7).** El webhook actualiza la ficha entera —nombre, precio,
categoría, imagen, si está activo— pero **no el stock**. El que viene de Woo
entra por `npm run woo:sync`, que es la reconciliación explícita; mientras
tanto, si los números no coinciden queda registrado en `sync_conflicts` y se ve
en la pantalla de Sincronización. Un producto nuevo sí entra con el stock de
Woo: ahí no hay nada local que perder. Siete tests nuevos.

### 12. Un precio tipeado con punto decimal se multiplica por cien

`aCentavos` borra todos los puntos porque en Argentina son separador de miles.
Con eso, `1.500,50` da bien, pero **`1500.50` da $150.050**. Un cajero
apurado con el teclado numérico lo escribe así sin pensar.

**Arreglado (fase 3.5).** Si hay coma, manda la coma. Si no, y lo que sigue al
último punto no son exactamente tres dígitos, ese punto es decimal: `20.000` son
veinte mil y `1500.50` son mil quinientos con cincuenta. Cinco tests nuevos.

### 13. La barra anuncia teclas que no hacen nada

`Inicio F1`, `Caja F3`, `Catálogo F6`, `Dólar F7`, `Reportes F8`: ninguna está
conectada. Solo funcionan **F2** (volver al buscador) y **F12** (cobrar). En un
POS que se vende como «todo con el teclado», eso se nota al primer día.

**Arreglado (fase 3.5).** Las teclas navegan de verdad, y se renumeraron para
que entre **Ventas F4**. Estando ya en la pantalla, la tecla se la deja a quien
la use adentro: en Vender, F2 vuelve el foco al buscador.

Dos advertencias que quedan: en una MacBook hay que tener activado «usar F1, F2
como teclas de función estándar» o apretar Fn, porque si no la fila de arriba es
brillo y volumen; y F12, que abre el cobro, en Chrome sobre Windows abre las
herramientas de desarrollo sin que la página lo pueda impedir (en Safari está
libre).

### 14. La justificación del arqueo solo se ve pasando el mouse por encima

El cierre **obliga** a explicar la diferencia, y después esa explicación queda
únicamente como `title` (tooltip) en la tabla de cierres anteriores. En una
tablet no se ve, y en la pantalla tampoco figura como columna. Se pide un dato y
no se muestra.

### 15. El resumen «por medio de pago» del cierre no cuadra con nada

Muestra el bruto de los pagos, sin restar el vuelto: en la prueba decía
`Efectivo (5) $969.300` cuando lo facturado eran $737.300 y lo esperado en el
cajón $744.300. Además pone «Cuenta corriente» en la misma lista, que no es
plata que entró sino deuda.

### 16. `npm run lint` no está configurado

El script existe pero abre un asistente interactivo de Next y nunca corre. En la
práctica el proyecto no tiene linter.

### 17. El vendedor que topa con un precio sospechoso queda sin salida

Ve el cartel rojo, el botón «Confirmar venta e imprimir» sigue habilitado y cada
clic vuelve a fallar. No se le dice qué hacer (avisarle al dueño, sacar el
producto del carrito).

### 18. La pantalla de inicio dice que sincronizó cuando no sincronizó

El seed escribe `last_synced_at`, así que en una instalación nueva Inicio
muestra «Última sincronización: hoy» sin haber hablado nunca con WooCommerce.

### 19. «Sin ningún problema: 0 (0% del catálogo)» en Calidad del catálogo

Como el 97% del catálogo real no tiene foto, ese contador va a decir ~3% para
siempre. Mezcla lo que impide vender con lo cosmético y termina siendo un número
que nadie mira. El bloque de arriba («Impiden vender bien») ya hace bien ese
trabajo.

### 20. Un reintento idempotente informa vuelto $0

Si la venta ya existía, `confirmarVenta` devuelve `vueltoCentavos: 0` en vez del
vuelto real. No afecta a la plata registrada —el comprobante lo recalcula— pero
es un dato equivocado saliendo del núcleo.

---

# Segunda pasada — antes de la fase 6

Fecha: 2026-09-15 · Fases 1 a 5 terminadas, commit `aa7d9c9`.

Cómo se hizo: 407 tests unitarios y 47 de punta a punta en verde como punto de
partida, y a partir de ahí **sondas escritas para cruzar fases**, que es donde
no mira nadie: cada módulo prueba lo suyo y las costuras quedan sin cubrir. Se
operó además un turno completo en el navegador —abrir caja, vender con vuelto,
fiar, cobrar a cuenta, anular, cerrar— leyendo los números en pantalla en cada
paso, y se recorrieron las once pantallas como dueño y como vendedor.

**Lo que se verificó y está sano**, para no perderlo de vista:

- **El redondeo del precio de mostrador** en todo el rango real del catálogo
  ($5.000 a $2.152.000): la diferencia queda entre 6,00% y 6,29% con un recargo
  de 6,71%, siempre a favor del mostrador, y la vuelta al precio de tienda da
  exacto. Solo se aplana por debajo de $800, y el producto más barato es $5.000.
- **Las plantillas de WhatsApp no inyectan campos**: un cliente llamado
  `{cliente} Pérez {total}` sale literal, no expandido.
- **El candado de fila del fiado**: dos cobros del saldo completo a la vez, uno
  entra y el otro recibe «ese cliente no debe nada». El saldo nunca queda
  negativo.
- **La idempotencia del cobro aguanta el monto cambiado**: misma clave con otro
  importe devuelve el primer cobro y no cobra de nuevo.
- **El tope de fiado en el borde**: llegar justo al tope entra, un peso más no.
- **Montos cero y negativos rechazados** en el cobro.
- **La búsqueda de clientes**: «jose», «JOSÉ», «perez», «ñandu», «nandu»,
  «MARÍA», «angélica» y un teléfono parcial encuentran todos lo que tienen que
  encontrar.
- **Anular dos veces** se rechaza y no duplica la reversión; el deudor de una
  venta anulada desaparece de la lista; los números de venta no se reutilizan;
  el recordatorio de deuda desaparece solo cuando la deuda se salda o se anula.
- **El efectivo esperado del arqueo dio exacto en todos los escenarios
  probados**, incluidos vuelto, fiado y cobros de fiado. Lo que falla es el
  desglose, no el esperado.

---

## Graves — tocan plata

### 21. Anular una venta fiada que ya se cobró en parte deja plata del cliente sin registrar

Reproducido en el navegador, turno completo:

1. Se le fía $5.000 a un cliente. Deuda: $5.000.
2. El cliente pasa y paga $4.000 a cuenta. Deuda: $1.000. Caja: +$4.000.
3. Se anula esa venta (se cargó mal, el cliente se arrepintió, lo que sea).

Queda así:

| | Antes de anular | Después |
|---|---|---|
| Deuda del cliente | $1.000 | **$0** |
| Efectivo en caja | +$4.000 | **+$4.000** (no se movió) |
| Qué se llevó el cliente | nada, el stock volvió | nada |

El cliente entregó $4.000 y no se llevó nada, y el sistema dice que están a
mano. **El negocio se quedó con la plata y no hay ninguna pantalla donde eso se
vea.** La ficha del cliente muestra «Deuda $0,00» y, dos renglones abajo, un
cobro de $4.000 contra una venta tachada.

La causa está en `descontarDeuda` (`src/ventas/anular.ts`): descuenta
`min(montoFiado, saldoActual)` y devuelve cuánto descontó de verdad, pero la
diferencia —la parte de esa venta que el cliente ya había pagado— no se informa
a nadie. Queda en la bitácora, que el mostrador no lee.

No es un caso raro: anular está limitado al turno abierto, y en un turno un
cliente puede fiar a la mañana y pasar a pagar al mediodía.

**Arreglado (fase 5.5).** De los tres caminos posibles —rechazar la anulación,
sacar la plata de la caja automáticamente, o anular avisando— se eligió el
tercero: rechazar deja al mostrador trabado con una venta mal cargada, y sacar
la plata sola asume que sale en efectivo y ahora mismo, cuando el cobro pudo
haber sido por transferencia o en otro turno.

Ahora `anularVenta` calcula lo que el cliente ya había pagado y lo anota en
`pending_refunds`, una tabla propia: no es un saldo a favor en la cuenta
corriente, porque ese modelo no admite negativos a propósito (D36) y torcerlo
volvería «te debo» y «me debes» el mismo número con distinto signo. Son dos
cosas y el mostrador las trata distinto: una se cobra, la otra se devuelve.

El aviso aparece en tres lugares y **lo pone el servidor**: en la fila de la
venta anulada, en la lista de fiado y arriba de todo en la ficha del cliente,
hasta que alguien marca «ya se le devolvió». Que lo ponga el servidor no es un
detalle: el primer intento lo mostraba desde el formulario de anulación y no se
veía nunca, porque al anular la página se vuelve a renderizar y ese formulario
desaparece junto con la venta. Lo encontró el test de punta a punta.

### 22. El desglose «Por medio de pago» del turno no cuadra con la caja

Agrava el hallazgo 15, que en la primera pasada era menor porque el fiado no
existía. Ahora falla de tres maneras a la vez. Turno real:

- Venta de $5.000 en efectivo, el cliente paga con $10.000 y se lleva $5.000 de vuelto.
- Venta de $5.000 fiada.
- El cliente paga $4.000 a cuenta.

Por la caja pasaron **$9.000** ($5.000 netos de la venta + $4.000 del cobro).
La pantalla muestra:

```
Efectivo esperado    $ 29.000,00     ← correcto (20.000 de apertura + 9.000)
Por medio de pago
  Efectivo (1)       $ 10.000,00     ← bruto: es lo que entregó el cliente, no lo que entró
  Cuenta corriente (1) $ 5.000,00    ← no entró plata: es una deuda
```

El desglose suma $15.000 contra $9.000 reales, cuenta como ingreso una venta
fiada y **omite por completo el cobro de fiado**, que sí fue plata. Quien cierre
la caja y quiera cuadrar por medio de pago no puede.

La consulta está en `resumenDeSesion` (`src/caja/sesion.ts`): agrupa
`sale_payments`, que son los renglones del cobro, no la plata.

**Arreglado (fase 5.5).** El desglose ahora dice qué entró: el efectivo va neto
de vuelto —restado una sola vez por venta, aunque haya dos pagos en efectivo—,
los cobros de fiado entran porque son plata, y la cuenta corriente sale del
bloque y figura aparte como «fiado en el turno · no entró plata». La pantalla se
llama ahora «Plata que entró, por medio», y hay un test que exige que el
efectivo del desglose sea exactamente el efectivo esperado menos la apertura:
el número contra el que se cuenta el cajón.

---

## Menores

### 23. El comprobante y el WhatsApp de una venta fiada no dicen cuánto queda debiendo

Venta de $12.000: $5.000 en efectivo y $7.000 fiados. El ticket imprime
«Cuenta corriente $7.000,00» y el WhatsApp dice «Gracias por tu compra ·
Total: $12.000». Ninguno de los dos dice que el cliente quedó debiendo, ni
cuánto debe en total. Es exactamente el papel que se guarda para discutir
después.

**Arreglado (fase 5.5).** El ticket suma un renglón recuadrado —«Queda debiendo
de esta compra $7.000,00»— y el comprobante de WhatsApp tiene un campo nuevo,
`{fiado}`, que el dueño puede mover o sacar como cualquier otro y que no imprime
nada cuando la venta se pagó al contado. Va el monto de **esta** compra y no el
saldo total, que cambia con el tiempo y volvería mentiroso a un comprobante
reimpreso el mes que viene.

### 24. «Quedó debiendo $X» en la ficha del cliente puede contradecir el saldo

El renglón de cada cobro guarda el saldo que quedaba en ese momento
(`saldoResultanteCentavos`, congelado a propósito). Si después se anula una
venta, la ficha muestra «Deuda $0,00» arriba y «quedó debiendo $1.000,00» en el
movimiento. Los dos números son correctos y juntos confunden.

**Arreglado (fase 5.5).** El renglón dice ahora «en ese momento quedaba debiendo
$1.000,00». El tiempo verbal y el «en ese momento» lo ubican como historia y no
como estado actual, que es lo que era desde el principio.

### 25. Un comprobante de WhatsApp muy largo pasa los 2.000 caracteres de URL

Medido: a 20 renglones la URL va en 1.402 caracteres; a 40 renglones, 2.542.
Algunos clientes de WhatsApp truncan el texto pasado ese punto. Con las ventas
típicas del mostrador no llega, pero una venta de muchos accesorios sí.

**Arreglado (fase 5.5).** `acortarDetalle` corta a doce renglones y agrega «y N
productos más». Hay un test que vende veinticinco accesorios y exige que el
enlace quede por debajo de los 2.000 caracteres.

---

## Huecos de prueba que explicaban los hallazgos

Los cuatro están tapados: la suite pasó de 236 a 269 tests unitarios y de 24 a
29 de punta a punta.

- **Variaciones**: no había ni un test en `confirmar.test.ts`. Era el hallazgo 1.
- **Dos pagos del mismo medio**: había test de pago mixto (efectivo +
  transferencia) y de vuelto, pero ninguno con dos efectivos. Era el hallazgo 2.
- **Permisos del vendedor en el servidor**: se probaba `puede()` como función
  pura, pero no que la acción los hiciera cumplir. Eran los hallazgos 4 y 5.
- **Comportamiento del componente de cobro** al agregar y quitar renglones: no
  había tests de interfaz de ese diálogo. Era el hallazgo 3.

## Lo que queda abierto

La fase 3.5 cerró los hallazgos 1 a 8, el 12 y el 13; la 3.7 cerró el 9, el 10
y el 11. Quedan diez, y dos de ellos tocan plata:

La fase 5.5 cerró los cinco de la segunda pasada: el 21, el 22, el 23, el 24 y
el 25. La fase 7 cerró el 14 y el 20. Quedan cuatro, todos menores:

| # | Qué | Cuándo conviene |
|---|---|---|
| 14 | *(cerrado en la fase 7: la justificación va en el cuerpo del reporte y de la lista de cierres)* | — |
| 15 | *(absorbido por el 22, cerrado)* | — |
| 16 | *(corregido en la cuarta pasada, hallazgo 52)* | — |
| 17 | El vendedor que topa con un precio sospechoso no sabe qué hacer | Cuando se haga el PIN del dueño en pantalla |
| 18 | Inicio dice que sincronizó cuando el seed nunca sincronizó | Cualquier momento |
| 19 | «Sin ningún problema: 0%» en Calidad del catálogo | Cualquier momento |
| 20 | *(cerrado en la fase 7: el reintento recalcula el vuelto desde los pagos guardados)* | — |

### Una lección de la fase 5.5, para no repetirla

Un mensaje que una acción de servidor devuelve **no se ve** si esa acción
revalida una ruta que deja de renderizar el componente que lo muestra. Pasó dos
veces en esta fase: el aviso de devolución puesto en el formulario de anulación
y el «se le devolvieron $X» de la ficha del cliente. Los dos desaparecían con su
propio componente.

La regla que queda: **lo que tiene que sobrevivir a la revalidación se renderiza
desde el servidor, leyéndolo de la base.** Los `estado.ok` sirven para
formularios que siguen en pantalla después de enviarse, no para los que se
desmontan. Y en los tests de punta a punta se afirma sobre el resultado visible
—la sección que aparece o desaparece— y no sobre el cartel de éxito.

### La misma lección, tercera vez (fase 7)

El cierre de caja terminaba en un cartel con un enlace al reporte del turno.
Nunca se vio: al cerrar, `/caja` deja de tener turno abierto, el formulario de
cierre se desmonta entero y el cartel se va con él. Lo encontró el test de punta
a punta, no la pantalla.

Esta vez la salida no fue renderizar el aviso desde el servidor sino **redirigir**:
al cerrar, la acción manda a `/caja/[id]`, que es a donde se quería llegar. Un
`redirect` sobrevive a cualquier revalidación porque no depende de que nada siga
montado, y de paso el reporte del turno queda donde corresponde —en pantalla,
recién cerrado— en vez de escondido detrás de un enlace.

Regla ampliada: **si después de una acción hay que estar en otro lado, ir a ese
otro lado.** Un cartel con un enlace es la versión frágil de un redirect.

### Lo que PGlite deja pasar y el driver de verdad no (fase 9)

Los reportes tenían 76 tests en verde y **no andaba ni uno** en el local. La
pantalla entera devolvía «Application error» y lo encontró el test de punta a
punta, no la suite de unidad.

La causa: una consulta escrita a mano que recibe un `Date` como parámetro.
PGlite —el PostgreSQL compilado a WASM que usan los tests— lo acepta sin
chistar; `postgres`, el driver de producción, lo rechaza con *«the string
argument must be of type string or an instance of Buffer»*. Las nueve consultas
del módulo fallaban por lo mismo, y la única que andaba era justamente la que no
recibía fechas.

La corrección es de una línea por consulta: se manda el instante como texto ISO.
Lo que queda es la lección.

**PGlite y el driver de producción no son intercambiables.** Los tests de unidad
corren contra migraciones reales y eso cubre el esquema, las restricciones y los
disparadores, pero **no cubre el protocolo**: cómo se serializa cada parámetro
es cosa del driver, y ahí los dos difieren. Todo lo que se escribe con
`db.execute(sql\`…\`)` y parámetros que no sean texto o número tiene que pasar
por el driver real antes de darse por bueno.

En la práctica: cuando una fase agrega consultas nuevas escritas a mano, el test
de punta a punta contra el PostgreSQL de verdad no es un extra, es la única
prueba que existe de que el código anda. Esta vez alcanzó con abrir la pantalla.

---

# Tercera pasada — control de las fases 8 y 9

Auditoría de lo construido en el alta de productos y en los reportes: lectura
adversarial del código, sondas contra la base real y manejo del sistema en el
navegador. **Trece hallazgos, seis de ellos de plata.** Nueve quedaron
corregidos en esta misma pasada; los otros cuatro están anotados abajo.

## Lo que se veía en pantalla

Una sola pantalla —Reportes, con dos ventas cargadas— mostraba **tres números
distintos para lo mismo**:

```
Vendido                    $ 23.000      ← sales.total_centavos
Por medio de pago          $ 30.000      ← bruto de los pagos, con el vuelto adentro
Qué se vendió              $ 25.000      ← suma de líneas, sin el descuento global
Por categoría              $ 25.000
Caja (arqueo, misma plata) $ 23.000
```

Dos causas distintas, las dos corregidas.

### 26. El descuento global no baja a las líneas *(corregido)*

`calcularTotales` resta el descuento global del subtotal y lo guarda en la
venta; las líneas quedan con su precio sin tocar. La identidad exacta es
`SUM(sale_items.total_centavos) = sales.total_centavos + descuentoGlobal`.

Todo lo que agrega líneas —el ranking de productos, el desglose por categoría,
**la rentabilidad** y la columna «Total» de la planilla de renglones— informaba
de más, exactamente por el descuento. El peor de esos es el margen: quedaba
sistemáticamente optimista, y es el único número sobre el que el dueño toma
decisiones. Los botones de descuento son el camino normal de la pantalla de
cobro, no un caso raro.

Se corrige prorrateando el descuento entre las líneas al consultar. Arreglarlo
en `confirmarVenta` sería más correcto de fondo, pero no aplica a lo ya vendido.

### 27. «Por medio de pago» sumaba el bruto, con el vuelto adentro *(corregido)*

Una venta de $5.000 pagada con un billete de $10.000 figuraba como «Efectivo
$10.000». Es **el hallazgo 22 otra vez**, ya corregido en el arqueo y
reintroducido en los reportes por escribir la consulta de cero en vez de partir
de la que ya estaba resuelta.

Ahora va neto de vuelto —restado una vez por venta, no una por renglón de
pago— y sin la cuenta corriente, que es deuda y no plata.

## Lo que engañaba al usuario

### 28. «La ficha ya está» se deshacía sola a los diez minutos *(corregido)*

`darFichaPorCompleta` ponía `ficha_incompleta = false` y la sincronización lo
volvía a poner en `true`, porque el mapeo de WooCommerce marca así cualquier
ficha sin foto. El dueño marcaba la ficha como terminada y el producto
reaparecía en la lista en la siguiente pasada del cron. Ahora la marca solo se
puede quitar, nunca volver a poner desde Woo.

### 29. «Cargados en el mostrador» listaba productos de WooCommerce *(corregido)*

El panel filtraba por `ficha_incompleta`, que el mapeo de Woo también pone. En
la prueba, 3 de 4 fichas listadas venían de Woo y nunca habían pasado por el
alta rápida. Con el catálogo real —803 productos, 97% sin foto— el panel
hubiera listado cientos de fichas bajo un título falso y habría quedado
inservible. Ahora solo los de `woo_id` nulo, que son los que el POS creó.

El título además contaba las filas que recibía, no las que hay: con 200
productos importados decía «50».

### 30. Un botón que informaba éxito y no hacía nada *(corregido)*

«Publicar en la tienda» encolaba con `onConflictDoNothing`. Si el pedido había
agotado los reintentos quedaba en `fallido`, el drenaje solo levanta las
pendientes, y volver a apretar el botón contestaba «encolado, va apenas haya
conexión» sin encolar nada. Un no-op que informa éxito, para siempre. Ahora un
pedido fallido se reintenta.

## Lo que podía corromper datos

### 31. El costo entraba sin validar *(corregido)*

`precioCentavos` se validaba contra techo y negativos; `costoCentavos` iba
derecho a la base. Un costo negativo o con ceros de más se copia **congelado** a
cada línea de venta futura y envenena la rentabilidad sin forma de arreglar las
líneas ya escritas. Ahora se valida igual que el precio, en el alta y en la
planilla.

### 32. Dos tablets podían crear el mismo producto *(corregido)*

El alta mira y después escribe, sin bloqueo ni restricción de base. Dos personas
cargando lo mismo a la vez pasan las dos el control, y como el SKU se propone de
forma determinista a partir del nombre, **las dos calculan el mismo**.

Se agrega el índice único `products_sku_pos_uq`. La primera versión cubría el
catálogo entero y **rompía la sincronización**: WooCommerce es la fuente de
verdad (D4) y lo que mande tiene que entrar aunque traiga un SKU repetido de una
migración vieja. Lo encontró la suite, no producción. Quedó acotado a
`woo_id IS NULL`, que es el alcance real del problema.

### 33. Un producto oculto en Woo se podía cargar dos veces *(corregido)*

El control de nombre repetido miraba solo los activos, y `activo` sale del
estado de WooCommerce: un producto en borrador allá está inactivo acá y no
aparece en el buscador. El vendedor lo carga de nuevo, el dueño publica el
borrador, y quedan **dos fichas activas con el mismo nombre**, dos precios y dos
stocks. La revisión de la planilla tenía la misma asimetría y prometía en verde
renglones que después fallaban.

### 34. Inyección de fórmulas en las planillas *(corregido)*

`celda()` no neutralizaba `=`, `+`, `@` ni `-`. Un cliente llamado
`=HYPERLINK(...)` o un producto de una planilla de un distribuidor terminan en
el archivo que se le manda al contador, y Excel los evalúa. Ahora se les
antepone un apóstrofo —salvo al signo menos seguido de un dígito, que es un
importe negativo legítimo y tiene que seguir siendo número para que la columna
se pueda sumar.

## Lo que confundía sin ser incorrecto

### 35. `Subtotal − Descuento ≠ Total` en la planilla de ventas *(corregido)*

Tres columnas contiguas que cualquier contador va a restar, y no daban: el
subtotal venía neto de los descuentos de línea y la columna de descuento los
incluía, así que restarlas los contaba dos veces. Se exporta el bruto, con lo
que `Bruto − Descuento = Total` siempre.

### 36. «Mes a mes» ignora el período elegido *(corregido por etiqueta)*

Es el único panel que no sigue el selector. Elegir «mes pasado» dejaba el mes
actual a medias al final del gráfico, que se lee como un derrumbe de las ventas.
Ahora el título lo dice.

## Lo que queda abierto

| # | Qué | Por qué se deja | Cuándo conviene |
|---|---|---|---|
| 37 | El precio de mostrador de un producto nacido en el POS queda fijo para siempre: `precioLocalCentavos` se escribe siempre en el alta, así que los cambios de precio en WooCommerce no llegan nunca al mostrador. Dos productos vecinos se comportan al revés y nada en pantalla lo explica | Es una decisión de producto, no un error: hay que definir si el precio del alta es una fijación deliberada o solo el valor inicial | Con la próxima pasada sobre precios |
| 38 | *(cerrado en la quinta pasada: medido contra 835 productos, 26 ms para 500 renglones)* | — |
| 39 | *(corregido en la cuarta pasada, hallazgo 53)* | — |
| 40 | No hay tope al período que se exporta: `desde=1970` arma la tabla entera en memoria | Es del dueño y autenticado, así que es un pie de plomo, no un ataque | Cualquier momento |

## Lo que se revisó y está bien

- **Inyección SQL**: limpia. Todo pasa por plantillas de Drizzle, que
  parametrizan. No hay `sql.raw` ni concatenación en ninguno de los dos módulos.
- **Permisos**: sin agujeros. El vendedor no entra a reportes ni por pantalla ni
  bajando la planilla a mano (403).
- **Los límites de los períodos**: exactos, incluidos los de `expenses.fecha`,
  que es `date` y no `timestamptz`, y la ida y vuelta del período por la URL de
  descarga.
- **Doble publicación**: guardada dos veces, antes y después de la cola.
- **La importación repetida**: no duplica nada; la segunda pasada marca todo
  como repetido.
- **Las columnas del POS que la sincronización no pisa**: `costoCentavos`,
  `precioEditable`, `precioLocalCentavos` y `stockComprometido` se preservan
  bien. `fichaIncompleta` era la excepción y es el hallazgo 28.

---

# Fase 10 — la otra mitad de la diferencia de driver

No fue una auditoría sino un hallazgo en construcción, y va acá porque es la
continuación exacta de la lección de la fase 9.

La pantalla de devoluciones tiraba `RangeError: Invalid time value` al listar lo
devuelto. La causa es la misma diferencia entre PGlite y el driver de
producción, pero **en la dirección contraria**: en la fase 9 el problema era
mandar un `Date` como parámetro; acá es recibirlo. Una consulta escrita a mano
que devuelve un `timestamptz` da un `Date` con PGlite y una **cadena** con
`postgres`. El tipo de TypeScript decía `Date` —se lo había escrito a mano— y
el compilador no tenía cómo desmentirlo: `new Intl.DateTimeFormat().format()`
recibía un string y explotaba en el navegador.

Lo peor es que el código de anular ya hacía el `new Date(...)` desde la fase
3.5. La corrección ya existía en el repositorio y se omitió al escribir código
parecido.

Dos reglas que quedan:

- **El tipo de una fila de SQL a mano se escribe con lo que llega de verdad, no
  con lo que uno quiere que llegue.** Si el driver devuelve texto, el campo se
  declara `string` y se convierte en un solo lugar, a la vista.
- **Un test que trae la fecha no alcanza: tiene que formatearla.** Leer el campo
  y compararlo pasa con las dos formas; el que falla es el que hace con el valor
  lo mismo que hace la pantalla. Ese test se agregó.

---

# v1.1 — lo que el offline deja abierto

No es una auditoría: son las cosas que se saben al terminar de construir el modo
sin conexión y que conviene tener anotadas antes de que alguien las descubra en
el mostrador.

## Lo que se encontró construyendo

### 41. El catálogo guardado no encontraba una variación por el SKU del padre *(corregido)*

El test que compara las dos búsquedas —la del servidor y la de lo guardado—
falló en el término `531`. Con conexión el `LIKE` corre contra el SKU del
producto **y** el de la variación, así que tipear el del padre encuentra la
variación; sin conexión el renglón guardado solo llevaba `COALESCE(v.sku,
p.sku)` y el del padre se perdía.

Es exactamente el tipo de diferencia que este modo no puede tener: el lector de
código de barras agrega el primer resultado, y un orden distinto vende otro
producto. Se agregó `skuProducto` al renglón, que no se muestra en ninguna
parte y existe solo para que las dos búsquedas coincidan.

La lección es sobre el test, no sobre el bug: **probar las dos búsquedas por
separado no habría encontrado nada**, porque cada una hacía lo que su propio
test esperaba. Lo que lo encontró fue compararlas contra la misma base.

### 42. `exacto` marcaba medio catálogo al bajar la instantánea *(corregido)*

La instantánea usa el mismo buscador con un término vacío, y la expresión de
coincidencia exacta comparaba contra la cadena vacía: todo producto sin código
de barras cargado quedaba marcado como exacto. Ese campo es el que decide qué
agrega el lector. Con término vacío ahora es `false` y no se calcula.

### 43. El aviso del arqueo estaba dentro de la lista equivocada *(corregido)*

«De eso, cobrado sin conexión» se había puesto dentro del bloque de salidas del
cajón, que solo se renderiza cuando hay gastos, retiros o devoluciones. Con un
turno donde lo único distinto era una venta diferida, el aviso no aparecía. Lo
encontró el test de punta a punta. Va con la plata que entró, que es lo que es.

## Lo que queda abierto

| # | Qué | Por qué se deja | Cuándo conviene |
|---|---|---|---|
| 44 | Una venta que se cobró sin conexión y se sube después de que otra persona inició sesión queda atribuida a quien la subió, no a quien la cobró. La cola no guarda el vendedor —guardarlo y creerle sería dejar que el navegador elija a quién atribuir una venta— así que el servidor usa la sesión que la sube | Son dos usuarios en una sola terminal y la venta queda registrada igual, con la hora del cobro. Lo que se pierde es a quién atribuirla | Cuando haya más de un vendedor por turno |
| 45 | La copia de pantalla que guarda el service worker lleva adentro el nombre y el rol de quien la abrió. Si el vendedor recarga sin conexión justo después de que salió el dueño, ve por un momento la navegación del dueño | Al salir se le pide al worker que borre lo guardado, así que solo pasa si el navegador se cierra sin usar «Salir». Y no habilita nada: todo permiso se comprueba en el servidor (D28) | Si alguna vez hay más de dos personas usando la misma tablet |
| 46 | El catálogo guardado se refresca cada diez minutos con la pantalla de venta abierta. Si la tablet pasa la mañana en otra pantalla y se corta internet, lo guardado puede tener horas | La pantalla avisa cuántas horas tiene y marca en rojo si pasó el refresco del dólar, que es el único precio que cambia solo | Si en la práctica se nota que llega viejo seguido |
| 47 | No hay tope a cuántas ventas pueden quedar en la cola. Un corte de un día entero llenaría IndexedDB con las ventas del día | No es un problema de tamaño —una venta son unos kilobytes— sino de que nadie mire el aviso. El cierre de turno ya lo frena | Cualquier momento |

---

# Cuarta pasada — control previo a producción

Control de todo lo construido, de la fase 1 a la v1.1, antes de que el mostrador
lo use. Tres frentes: los **datos** —que las cuentas cierren sobre una base con
un día de uso encima—, la **superficie expuesta** —qué contesta el servidor sin
sesión— y una lectura adversarial de lo último, que es lo menos rodado.

**Ocho hallazgos, seis corregidos en esta misma pasada.** Ninguno de los que
quedan abiertos frena la salida.

## Los números cierran

Lo primero fue dejar de leer código y preguntarle a la base. `npm run auditar`
corre **diecinueve invariantes** contra el PostgreSQL de verdad, después del
seed y de la batería de punta a punta: el saldo de cada cuenta contra sus
movimientos, el stock contra sus asientos, el total de cada venta contra sus
renglones, la deuda de cada cliente contra lo que la movió, el efectivo esperado
de cada turno, los correlativos sin huecos, que ninguna devolución supere lo
vendido, que no haya un solo importe guardado como coma flotante.

**Los diecinueve dan.** El script queda en el repositorio: es de solo lectura y
se corre cuando haga falta, también contra producción.

Dos de los tres problemas que aparecieron al escribirlo eran del script y no del
sistema, y los dos valen como advertencia:

- Una subconsulta correlacionada sumaba **todos** los cobros de fiado de la base
  en vez de los del cliente: `WHERE customer_id = a.customer_id` con una tabla
  que no tiene esa columna resuelve contra la de afuera y PostgreSQL no se
  queja. Daba una diferencia que parecía un agujero de plata.
- Reconstruir la deuda filtrando `estado = 'completed'` descontaba dos veces una
  venta fiada anulada. Anular no borra el asiento: le saca la deuda al cliente
  aparte (D41), y hay que restar esa y no la venta.

## Lo que contestaba sin sesión

### 48. El POS no se podía instalar en la tablet *(corregido)*

`/manifest.webmanifest` no estaba entre las rutas públicas, y el navegador baja
el manifiesto **sin la cookie de sesión** salvo que se le pida lo contrario. El
portero devolvía un redirect a `/ingresar`, así que «agregar a la pantalla de
inicio» no funcionaba: toda la parte de la v1.1 que el README describe como
aplicación instalable estaba muerta y ningún test lo miraba.

Se comprobó con `curl` contra el build de producción, que es la única forma de
ver esto: el navegador falla en silencio.

Con el mismo arreglo salieron dos más del mismo lugar:

- **`/sw.js` detrás de sesión.** Funcionaba, porque el registro sí manda la
  cookie, pero es frágil: el día que devuelva el HTML del login, el navegador
  rechaza el registro por el tipo de contenido y el modo sin conexión desaparece
  sin que nadie se entere.
- **`/api/latido` detrás de sesión**, que era exactamente lo que su propio
  comentario decía que había que evitar: con un token vencido, el redirect al
  login contesta 200 y la pantalla lee «volvió internet».

Las tres son públicas ahora y ninguna devuelve un dato del negocio: dos archivos
estáticos y un 204 vacío. Se verificó de nuevo con `curl` que todo lo demás
—`/caja`, `/reportes`, `/api/buscar`— sigue devolviendo 307 sin sesión.

### 49. `cuentasActivas()` leía las cuentas sin pedir sesión *(corregido)*

Todo lo que se exporta de un archivo `'use server'` es un punto de entrada al
que se le puede pegar desde afuera. Era la única de las treinta y tres acciones
sin control, y devolvía los nombres de las cuentas monetarias, que dicen en qué
banco trabaja el local.

## Lo que se rompía sin conexión

### 50. Sin conexión y con la ventana bloqueada, la venta se quedaba sin comprobante *(corregido)*

Con conexión, si el navegador bloquea la ventana del ticket queda un enlace a
`/ticket/<id>` en pantalla. Sin conexión no hay id ni servidor al que pedírselo:
el único lugar donde el comprobante existe es el navegador, y se descartaba. El
cliente se iba sin papel y no había forma de reimprimirlo.

Ahora el HTML del comprobante se guarda en la pantalla y el aviso ofrece
abrirlo. Es la misma lección de siempre en otra forma: **el camino sin conexión
necesita su propia salida, no la del camino con conexión.**

### 51. La cola reintentaba para siempre *(corregido)*

Un error que el filtro de reintentos no reconoce hacía que la venta se
reintentara cada quince segundos hasta que alguien apagara la tablet. Dos
problemas en uno: el servidor recibiendo el mismo pedido fallido sin parar, y el
aviso de «hay plata esperando» volviéndose parte del paisaje. Ahora son seis
intentos —un minuto y medio— y después pide que alguien la mire.

## Lo que ya estaba anotado y se cerró

### 52. `npm run lint` abría un asistente interactivo *(corregido — era el hallazgo 16)*

`next lint` quedó deprecado: el script preguntaba qué configuración usar y se
quedaba esperando una tecla. En una terminal se ve raro; en integración continua
se cuelga para siempre.

Se configuró ESLint con el conjunto de Next y TypeScript, y **encontró algo real
en la primera corrida**: el hook del modo sin conexión se llamaba `usarOffline`,
y como el prefijo `use` es el contrato por el que React reconoce un hook, las
reglas de hooks no miraban ese archivo — justo el que más efectos y más
dependencias tiene de todo el proyecto. Renombrado a `useOffline`, las reglas lo
revisan y no encontraron nada más. También salieron cinco importaciones muertas.

### 53. El stock de la planilla convertía «1.5» en quince *(corregido — era el hallazgo 39)*

El precio se parseaba con cuidado y el stock con `replace('.', '')`. El punto de
«1.500» separa miles y el de «1.5» es decimal, y los dos vienen en planillas
reales: una unidad y media entraba como quince unidades de stock inventado. Se
lee con la misma función que el precio y un decimal se rechaza con su motivo.

## Lo que se revisó y está bien

- **Secretos**: ninguno en el repositorio. Lo que parecía serlo son marcadores
  de `.env.example` y valores de test. `.env` está ignorado y nunca se versionó.
- **Nada secreto llega al navegador**: no hay una sola variable `NEXT_PUBLIC_`.
- **Nada secreto se registra**: los `console.error` nombran la variable que
  falta, nunca su valor.
- **Permisos**: las treinta y tres acciones de servidor comprueban sesión y rol
  en el servidor, no en la pantalla (D28). Las tres sin `puede()` son las de
  ingreso, y las tres de fiado sin rol son decisiones documentadas.
- **Inyección**: limpia. Todo pasa por plantillas de Drizzle. El único
  `sql.raw` es el `TRUNCATE` del seed, con una lista de tablas escrita a mano.
- **XSS**: ni un `dangerouslySetInnerHTML`. El ticket escapa, también el
  provisorio sin conexión, que pasa por la misma función.
- **Los reportes contra la base**: el total y la cantidad del período coinciden
  con el SQL crudo, y el desglose por medio da exactamente el neto de vuelto de
  las ventas no anuladas. Que no incluya los cobros de deudas viejas es
  deliberado y la pantalla lo dice.
- **El chequeo de producción** reconoce bien el entorno y reclama lo que falta.

## Lo que queda abierto

Además de los hallazgos 17, 18, 19, 37, 38, 40 y 44 a 47, que siguen en pie:

| # | Qué | Por qué se deja | Cuándo conviene |
|---|---|---|---|
| 54 | Una devolución que descuenta deuda mueve el saldo de la cuenta corriente sin dejar asiento en la bitácora de `credit_accounts`. El dato está —la devolución lo guarda entero— pero la cadena de esa cuenta tiene un hueco | Reconstruir la deuda de un cliente hoy necesita mirar dos lugares en vez de uno. No hay plata mal contada: el invariante de deuda da | Cuando se arme la pantalla de «movimientos de la cuenta» |
| 55 | La sesión dura doce horas. Un turno que arranca a las nueve y sigue a las diez de la noche obliga a volver a entrar en el medio | Volver a entrar es un PIN. Alargarla es aflojar la única barrera que tiene la tablet del mostrador | Si en la práctica molesta |

---

# Quinta pasada — cómo se comporta en producción

La cuarta pasada miró los datos y la superficie expuesta. Esta mira lo otro:
**a qué velocidad anda con el catálogo de verdad, cómo falla, y qué pasa en
Vercel con Neon** — que es donde va a vivir, no en esta máquina.

**Cuatro hallazgos, los cuatro corregidos.** Dos son de concurrencia, uno es lo
que ve el mostrador cuando algo se rompe, y el último no es código.

## A escala real no hay problema

Se cargó el tamaño del catálogo de verdad —803 productos, 600 variaciones, 3.764
pedidos históricos— y se midió lo que se usa todos los días:

| Qué | Cuánto tarda |
|---|---|
| Buscar en el mostrador, cualquier término | **4 a 6 ms** |
| Bajar el catálogo entero a la tablet | **7 ms**, 836 renglones, 392 kB |
| Cualquier panel de Reportes | **0 a 3 ms** |
| Revisar una planilla de 500 renglones contra el catálogo entero | **26 ms** |

Eso cierra el hallazgo 38, que estaba abierto justamente por no haberlo medido:
la importación entra mil veces en el tiempo de cualquier plataforma.

## Dos corridas al mismo tiempo

### 56. La cola se drenaba sin candado *(corregido)*

`drenarCola` leía las operaciones pendientes con un `SELECT` suelto y después
las procesaba. El drenaje corre desde dos lados —después de cada venta y cada
diez minutos por la tarea programada— así que dos corridas simultáneas se
llevaban las mismas filas.

Para el ajuste de stock daba igual, y no por suerte: lo que se le escribe a Woo
es el stock **absoluto** que el POS tiene ahora, así que escribirlo dos veces
escribe el mismo número. Es la decisión de diseño de la fase 1 pagando sola.

Pero **publicar un producto no es idempotente**. La guarda de `publicarProducto`
es un `if (wooId === null)` leído antes del `POST`: las dos corridas la pasan y
el producto queda **creado dos veces en la tienda online**.

Ahora las operaciones se toman con un `UPDATE … SET estado = 'procesando' …
FOR UPDATE SKIP LOCKED` antes de procesarlas. De paso, el estado `procesando`
—que estaba en el esquema desde la fase 1 y no lo usaba nadie— pasa a significar
algo, y una fila que quedó tomada por un proceso que ya no existe se retoma a
los cinco minutos.

El test comprueba lo que importa: que la fila esté en `procesando` **mientras**
se la está procesando, mirándolo desde adentro del cliente de Woo. Un
`Promise.all` de dos drenajes no habría probado nada, porque la base de los
tests corre sobre una sola conexión y los serializa: pasaba igual sin el
candado. Se verificó que los dos tests fallan si se saca el arreglo.

### 57. El drenaje programado no entraba en el tiempo de la plataforma *(corregido)*

La tarea programada drenaba hasta **50 operaciones** por corrida. Cada una son
un `GET` y un `PUT` contra WooCommerce, que corre en un hosting compartido, y
con el timeout de 20 s y tres reintentos del cliente **una sola puede tardar un
minuto**. `vercel.json` no fijaba ningún `maxDuration`, así que la ruta corría
con el límite por defecto —diez segundos en el plan Hobby— y con Woo lento la
función moría a la mitad cada diez minutos sin que nadie se enterara de que la
cola no avanzaba.

Ahora el drenaje lleva **presupuesto de tiempo**: hace lo que entra, devuelve a
la cola lo que tomó y no llegó a procesar, y lo informa. Es una cola: no hace
falta vaciarla de un saque, hace falta que nunca se trabe. La ruta declara
`maxDuration = 60` y usa 45 s de presupuesto; el drenaje que corre pegado a una
venta usa 8 s, porque que el mostrador espere por WooCommerce es exactamente lo
que la cola existe para evitar.

## Lo que ve el mostrador cuando algo se rompe

### 58. No había ninguna pantalla de error *(corregido)*

Ni `error.tsx`, ni `global-error.tsx`, ni `not-found.tsx`. Cuando algo fallaba
—la base que no responde, que es el caso real— aparecía la pantalla de Next: un
fondo blanco que dice `Application error: a server-side exception has occurred`,
en inglés, con un código y nada más. Es literalmente lo que pasó en la fase 9 y
lo que va a pasar el día que Neon tenga un mal rato.

A las siete de la tarde, con un cliente esperando, eso no contesta ninguna de
las tres preguntas que importan. Las tres están ahora en la pantalla, en este
orden:

1. **Si se movió plata.** Es lo primero que uno piensa, y la respuesta es que
   no: una pantalla que no carga no cobró nada, porque todo lo que toca plata
   pasa por una transacción que entra completa o no entra.
2. **Qué hacer.** Reintentar, y si no, seguir vendiendo.
3. **Qué decirle a quien lo arregla**, con el código del registro.

Se probó de verdad: se apagó PostgreSQL con el POS andando y se miró la pantalla
en el navegador, desde afuera y desde adentro de la sesión. La de adentro
conserva la navegación, así que quien atiende puede irse a otra pantalla.

## Lo que no es código

### 59. No había nada escrito sobre migraciones ni sobre respaldos *(corregido)*

Dos huecos operativos que no se ven leyendo el código:

**Las migraciones no corren solas al desplegar**, y está bien que así sea —una
construcción en Vercel no tendría por qué escribir en la base de producción, y
una vista previa terminaría migrándola— pero eso significa que se puede
desplegar código que espera una columna que todavía no existe. Ahora
`npm run produccion:chequear` compara las migraciones que el código trae contra
las que la base tiene y **falla si falta alguna**, con el paso a correr. Se
verificó borrando una del registro: la detecta por nombre.

**Y no había una sola línea sobre respaldos.** La base *es* el negocio: el
catálogo se puede volver a traer de WooCommerce, las ventas y el fiado no.
`PRODUCCION.md` ahora dice cuánto historial guarda cada plan de Neon, cómo
sacar una copia propia con `pg_dump`, y por qué volver atrás el código es fácil
y volver atrás una migración no hace falta: las migraciones agregan, nunca
borran ni renombran.

## Lo que se revisó y está bien

- **La conexión para un entorno sin servidor**: `max: 5` y `prepare: false`, que
  es lo que pide el agrupador de conexiones de Neon. Se abre perezosamente, así
  que la construcción no falla por no tener variables de entorno.
- **El ajuste de stock hacia Woo es idempotente por diseño** y encima lee el
  stock actual en vez del congelado al vender, así que dos escrituras seguidas
  dejan el mismo número correcto.
- **Cada migración corre en su propia transacción**: una que falla a la mitad no
  deja nada aplicado y se puede volver a correr.
- **La autorización de la tarea programada** compara el secreto en tiempo
  constante y rechaza antes de tocar la base.

---

# Sexta pasada — recorrer la demo como la va a recorrer el dueño

La demo (`npm run demo`) es el camino por el que alguien prueba el sistema sin
instalar nada. Se recorrió entera, pantalla por pantalla, antes de mandarlo a
probarla.

### 60. Reportes y el alta de productos devolvían error en la demo *(corregido)*

Las dos pantallas daban **500** contra la demo, y andaban perfectas contra
PostgreSQL de verdad. La batería de punta a punta no lo veía porque corre contra
PostgreSQL; el recorrido a mano sí.

La causa: **PGlite atiende de a una.** Es PostgreSQL compilado a WASM y corre en
un solo hilo, pero el pool del driver abre hasta cinco conexiones. Las dos
únicas pantallas que lanzan varias consultas **en paralelo** con `Promise.all`
—las siete de Reportes y las dos del alta— eran exactamente las dos que fallaban,
con `ECONNRESET`: el servidor de sockets de PGlite les cortaba la conexión.

La demo ahora avisa con `POS_BASE_EMBEBIDA` y la conexión abre **una sola**.
Contra una base de verdad siguen siendo cinco.

Es la tercera vez que PGlite y el driver de producción se comportan distinto, y
las tres en direcciones diferentes: un `Date` que uno acepta y el otro no (fase
9), un `timestamptz` que vuelve como texto o como fecha (fase 10), y ahora la
concurrencia. **La conclusión no cambia: lo que no se probó contra las dos, no
está probado.**

### 61. Ninguna prueba abría todas las pantallas *(corregido)*

El hallazgo anterior salió de un recorrido a mano, no de la batería, y eso es lo
que había que arreglar de fondo: cada archivo de tests entra a las pantallas que
necesita para probar algo, y una pantalla que ningún test visita puede devolver
error durante semanas sin que se note.

`e2e/pantallas.spec.ts` abre las diecisiete del dueño y las seis del vendedor, y
lo único que comprueba es que respondan 200 y que no haya saltado la pantalla de
error. Es el test más tonto de la batería y es el que habría encontrado esto.

### 62. La demo no permitía probar el modo sin conexión *(corregido)*

`npm run demo` corre en modo desarrollo, y ahí el service worker no se registra
—a propósito—, así que justo la novedad de la v1.1 era lo único que no se podía
probar por el camino fácil. Ahora `npm run demo -- --produccion` construye y
corre la versión de verdad.

Se probó de punta a punta sobre la demo: se corta la conexión, la barra avisa,
el buscador sigue encontrando contra el catálogo guardado, se cobra, la venta
queda esperando, **Caja abre sin internet y frena el cierre del turno**, y al
volver la conexión la venta entra sola y aparece marcada en Ventas.

---

# Séptima pasada — lo que nunca se había hecho ni una vez

Las pasadas anteriores miraron el código, los invariantes de la base, la escala
y la demo. Quedaba una franja entera sin tocar: **los pasos que solo ocurren el
día de producción** —migrar una base vacía, restaurar un respaldo— y **lo que
pasa cuando dos personas hacen lo mismo al mismo tiempo**, que en este local no
es hipotético: hay mostrador y tablet.

### 63. Una migración editada después de correr dejó la base sin un índice *(corregido)*

Primer paso real de producción, nunca probado: aplicar las catorce migraciones
sobre una base **vacía**. Aplican todas y limpias. Pero al comparar el esquema
resultante contra el de la base de desarrollo —migrada de a poco, durante
meses— apareció una diferencia:

```
CREATE UNIQUE INDEX products_sku_pos_uq ON products (upper(sku))
  WHERE sku IS NOT NULL AND woo_id IS NULL;
```

**Estaba en la base nueva y no en la vieja**, aunque las dos tenían las catorce
migraciones anotadas como aplicadas.

La causa: `0011_sku_unico` se **reescribió después** de haber corrido. La primera
versión cubría el catálogo entero y rompía la sincronización (está contado en su
propio comentario); se corrigió el archivo, pero Drizzle decide qué correr **por
la fecha del diario, no por el contenido**: una migración ya anotada no se vuelve
a correr nunca. La base de desarrollo quedó con la versión vieja deshecha a mano
y sin la nueva. El sha256 guardado junto a cada migración lo decía desde
entonces, y nadie lo miraba.

Dos arreglos:

- `npm run produccion:chequear` ahora **recalcula el sha256 de cada archivo y lo
  compara con el guardado**, y falla nombrando las que cambiaron después de
  correr. Antes solo comprobaba que estuvieran todas.
- La base de desarrollo quedó alineada con la de producción, y el esquema
  completo de las dos se comparó otra vez: **idéntico, tabla por tabla**.

Producción arranca de cero, así que nace con el índice. El hallazgo igual
importa: el día que haya que editar una migración ya aplicada —y va a haber—,
esto lo dice en vez de dejar la base del local en silencio distinta al código.

### 64. El respaldo y la restauración, probados de punta a punta *(verificado)*

`PRODUCCION.md` pedía «una restauración probada de verdad» y nadie la había
hecho. Se hizo, con el comando que el documento manda:

```bash
pg_dump "$DATABASE_URL" --no-owner --format=custom --file=pos-$(date +%F).dump
```

Se restauró en una base nueva y se verificó todo lo que tiene sentido verificar:
las **32 tablas con la misma cantidad de filas**, el esquema idéntico, la tabla
de migraciones intacta —si se perdiera, el próximo `db:migrate` intentaría
aplicarlas de nuevo—, los **19 invariantes en orden** sobre la copia, y el POS
levantado contra ella: se entra, y Ventas, Caja, Fiado, Reportes y Clientes
abren con los datos puestos.

El procedimiento funciona. Falta hacerlo una vez contra la base real cuando
exista, que es la casilla que queda en la lista final.

### 65. El mismo gasto se podía pagar dos veces, y la plata salía dos veces *(corregido)*

El hallazgo más serio de esta pasada. `pagarGasto` leía el gasto, comprobaba que
estuviera pendiente y recién después movía la plata — **sin candado sobre la
fila del gasto**. Dos pagos simultáneos del mismo gasto leen los dos
«pendiente», los dos pasan el control y los dos sacan la plata.

Se reprodujo contra PostgreSQL de verdad, con dos conexiones:

```
pagos aceptados: 2 (debería ser 1)
movimientos de caja para ese gasto: 2 (debería ser 1)
saldo: -29000000 -> -29200000 (bajó 200000 por un gasto de 100000)
```

Lo peor no es que pase: es que **no se nota**. Los dos movimientos son reales,
el saldo coincide con la suma de los movimientos y el invariante de cuentas da
en orden. El libro queda consistente consigo mismo y con cien mil pesos de
menos.

El candado de saldo que ya existía no alcanzaba: ordena los dos movimientos, no
impide que se decidan dos veces.

Mismo patrón, corregido en los tres lugares donde movía plata y en uno más:

| Dónde | Qué pasaba con dos a la vez |
|---|---|
| `pagarGasto` | el gasto salía dos veces de la cuenta |
| `anularGasto` | la plata volvía dos veces |
| `cerrarCaja` | el ajuste de arqueo se descontaba dos veces |
| `marcarDevuelta` | dos asientos en la bitácora, y el segundo pisaba quién la resolvió |

Los cuatro toman ahora la fila con `FOR UPDATE` **antes** de mirar en qué estado
está. Lo que ya estaba bien y se confirmó: venta, anulación de venta, devolución,
cobro de fiado, transferencia entre cuentas y apertura de caja (esta última por
un índice único parcial, no por candado).

### 66. Nada probaba las carreras, y la batería de siempre no puede *(nueva herramienta)*

Los 768 tests corren sobre PGlite, que es **una sola conexión**: dos
transacciones simultáneas se serializan solas y la prueba pasa aunque el candado
no exista. Por eso este agujero sobrevivió diez fases. Es la misma lección de la
pasada anterior, en su forma más cara.

`npm run carreras` (`src/scripts/probar-carreras.ts`) abre **dos conexiones de
verdad** contra PostgreSQL y corre las carreras que mueven plata: el mismo gasto
pagado y anulado dos veces, el mismo turno cerrado dos veces, la misma terminal
abierta dos veces, el mismo cobro de fiado reintentado con la misma clave, y la
última unidad en stock vendida por dos pantallas a la vez. Quince comprobaciones.

Se verificó lo único que hace que una prueba valga: **sacando los candados,
falla en siete de las quince**. Se niega a correr contra una base que no sea
local salvo que se la obligue, porque escribe.

### 67. El selector de clientes escondía a partir del 201 *(corregido)*

La pantalla de venta pedía los clientes con un tope de **200** y no lo decía en
ninguna parte. El cliente 201 sencillamente no aparece: no se le puede fiar, no
figura en el comprobante, y quien atiende no tiene forma de entender por qué.
Con el alta de clientes desde la misma venta —agregada esta semana— llegar a 200
dejó de ser lejano.

El tope pasó a **1000** y, cuando la lista se llena, la pantalla lo dice. El día
que el local pase de mil, el selector tiene que dejar de ser una lista y pasar a
ser un buscador, como el de productos; está anotado donde corresponde.

### 68. El cliente cargado en la venta se quedaba con saldo cero *(corregido)*

Un cliente dado de alta desde la pantalla de venta se guardaba en la memoria de
esa pantalla con saldo cero —que es lo correcto al nacer— y **le ganaba a la
copia que traía el servidor**. Si en esa misma sesión se le fiaba, la venta
siguiente mostraba «debe $0» de alguien que debía: el aviso de deuda previa, que
es justo lo que el mostrador mira antes de fiar de nuevo, no aparecía.

Ahora la copia local vale solo mientras el servidor todavía no lo conoce; en
cuanto llega en la lista, gana la del servidor.

### 69. El control de correlativos se caía si la terminal tenía un guion *(corregido)*

Salió de rebote, corriendo los invariantes sobre una base con terminales de
prueba. El control leía el correlativo partiendo el número de venta por guiones
y quedándose con el segundo trozo, pero el número es `<terminal>-000001` y **el
nombre de la terminal se configura** (`POS_TERMINAL`). Con una terminal llamada
`caja-2` —lo más natural del mundo, y el día que haya una segunda pantalla va a
llamarse así— el control no fallaba: se **caía**, con un error crudo de
PostgreSQL, y `npm run auditar` terminaba a la mitad sin correr los invariantes
que venían después.

Ahora el correlativo se lee del final del número, que es donde está.

---

# Octava pasada — cerrar lo que quedó abierto, y una que faltaba

Las siete pasadas anteriores dejaron una lista de hallazgos abiertos «que no
frenan la salida». Antes de abrir el local conviene mirarla de nuevo y decidir
uno por uno, porque «no frena la salida» y «puede quedar así el primer día» no
son lo mismo. Esta pasada cierra cinco, deja tres anotados con su razón, y
encuentra uno nuevo revisando de dónde puede salir plata sin que nadie firme.

### 70. Un producto sin precio se vendía gratis, y ningún control avisaba *(corregido)*

La guarda de precios tiene pisos por categoría y marca, y **a propósito** no le
pone piso a los accesorios: cables, fundas, vidrios, cargadores. Un vidrio
templado a $5.000 es normal, y marcarlo solo entrena al cajero a ignorar el
cartel.

El agujero es el borde de esa decisión: **sin piso, tampoco había piso en
cero**. Un producto que llegó de la tienda sin precio —o con el precio en cero
por un error de carga— salía del mostrador gratis, con el stock descontado y sin
que nada lo frenara. Y los accesorios son justo la mayor parte de las unidades
que se venden. En un renglón suelto se ve; en una venta de seis accesorios, no.

Cero no es un precio barato: es la falta de un precio. Ahora lo frena siempre,
diga lo que diga la categoría, con el mismo mecanismo que el resto —el dueño lo
puede confirmar a sabiendas si de verdad va a regalar algo—. El único cero que
ya estaba cubierto era el del precio escrito a mano, que es otro camino.

### 17. El vendedor que topa con un precio sospechoso queda sin salida *(corregido)*

Estaba abierto desde la primera auditoría. El vendedor veía el cartel rojo, el
botón de confirmar seguía habilitado y cada clic volvía a fallar igual, con un
cliente esperando del otro lado del mostrador.

Ahora se le dice qué hacer —sacar ese producto del carrito y cobrar el resto; el
precio lo corrige el dueño en el catálogo, o lo confirma él desde su usuario— y
el botón queda trabado hasta que el carrito cambie, que es lo único que puede
destrabarlo. Tiene su prueba de punta a punta: el mismo iPhone mal cargado del
test del dueño, pero entrando como vendedor.

### 18. La pantalla de inicio decía que sincronizó cuando no sincronizó *(corregido)*

Los productos del seed se guardaban con `lastSyncedAt`, así que una instalación
recién sembrada mostraba «Última sincronización: hoy» sin haber hablado nunca
con WooCommerce. Es exactamente el cartel que uno mira cuando los productos no
aparecen —pasó esta semana, con la demo—, y decía lo contrario de la verdad.

Los del seed ya no lo llevan: ahora Inicio dice «Todavía no se sincronizó»
hasta que la sincronización ocurra de verdad. De paso, la cuenta que decidía si
la base ya tiene catálogo real quedó más simple y más honesta: alcanza con que
exista un producto que haya hablado con la tienda.

### 19. «Sin ningún problema: 0 (0% del catálogo)» *(corregido)*

Mezclaba lo que impide vender con lo cosmético. Como el 97% del catálogo real no
tiene foto, ese número iba a decir 3% para siempre y nadie lo iba a mirar.

Ahora cuenta **los que se pueden vender bien** —el total menos lo que bloquea—,
que arranca cerca del 100% y se mueve el día que algo se rompe de verdad.

### 40. No había tope al período que se exporta *(corregido)*

`desde=1970` en la URL armaba en memoria la tabla entera —ventas, renglones y
gastos— para nada. No es un ataque, porque hay que ser el dueño y estar con
sesión: es el dueño tocando una URL vieja y viendo la pantalla colgada sin
entender por qué. El tope va en `periodoEntre`, que es la única puerta por donde
entra un período escrito a mano —la pantalla y la descarga pasan las dos por
ahí— y avisa con una frase en vez de tardar una eternidad.

Quedó en **diez años** y no en tres, que fue el primer número. Lo corrigieron
los tests: dos armaban un período de 2020 a 2030 para decir «todo», y tenían
razón en querer eso —el histórico importado del POS anterior empieza en 2023 y
«todo» es una pregunta legítima—. El tope está para el absurdo, no para
discutirle al dueño qué período puede mirar.

## Los permisos, revisados de nuevo y enteros

Una acción de servidor es una dirección HTTP: que el botón no esté en pantalla
no impide llamarla. Se revisaron **las treinta y tres**, una por una, mirando qué
comprueba cada una antes de tocar la base.

**Ninguna quedó floja.** Todas piden sesión y todas las que hacen algo sensible
piden además el permiso que corresponde: vender, anular, fiar, cobrar fiado,
poner un tope, cargar o pagar un gasto, transferir entre cuentas, tocar el
dólar, publicar en la tienda, importar una planilla, cambiar los textos de
WhatsApp. Las de gastos y cuentas lo hacen con un ayudante común —`duenio()`—
que pide sesión y `gasto.cargar` en el mismo paso.

Tres no piden permiso además de la sesión, y las tres están bien así: cargar y
editar un cliente (el vendedor los necesita para vender, y la ficha no incluye
el tope de fiado, que sí es del dueño), y marcar que se le devolvió la plata a
un cliente, que es una decisión de mostrador y está documentada como tal.

## Lo que queda abierto, y por qué

| # | Qué | Por qué se deja |
|---|---|---|
| 44 a 47 | Atribución de una venta subida por otro usuario, la copia de pantalla del service worker, la antigüedad del catálogo guardado y el tamaño de la cola sin conexión | Siguen valiendo las razones de la quinta pasada: ninguno pierde plata y los cuatro tienen aviso en pantalla |
| 54, 55 | La devolución que descuenta deuda no deja asiento propio en la bitácora de la cuenta, y la sesión dura doce horas | Sin plata mal contada el primero, y aflojar el segundo es aflojar la única barrera de la tablet |

### 37. El precio de mostrador de un producto nacido en el POS *(cerrado por decisión)*

Estaba abierto desde la cuarta pasada, y no era un error sino una pregunta: el
precio que se escribe en el alta rápida, ¿es el precio propio del mostrador para
siempre, o solo el inicial? Queda fijo —la sincronización no lo pisa— y eso hace
que dos productos vecinos se comporten al revés.

**Decidido: queda como está.** El catálogo se carga en WooCommerce, así que un
producto de la tienda sigue al precio de la tienda solo, que es el caso de
siempre. El alta rápida del POS es la excepción —algo que aparece en el
mostrador y hay que vender ahora— y ahí el precio escrito a mano es justamente
lo que se quiere: no lleva recargo, porque todavía no está en la web, y lo
cambia una persona desde **Precios**.

Lo que faltaba no era código sino que estuviera escrito: quedó en el README, al
lado del cálculo del recargo, para que dentro de seis meses la diferencia entre
los dos productos vecinos tenga explicación.

---

# Novena pasada — el cajón, probando la demo

Matías probó la demo cargando gastos y ventas de verdad y encontró esto:

> gasté $2.000.000 y vendí $1.500.000 y me dice que **sobra $500.000**

Tenía razón, y detrás había cuatro cosas, no una.

## Lo que pasaba

El efectivo esperado del turno es la suma de los movimientos de la cuenta de
efectivo: apertura, ventas en efectivo, cobros de fiado, menos gastos y
retiros. La cuenta estaba bien. Lo que no estaba era **el piso**: nada impedía
cargar una salida del cajón mayor a lo que había adentro.

Con $1.500.000 vendidos y un gasto de $2.000.000 marcado como pagado en
efectivo, el esperado quedaba en **−$500.000**. El cierre hace
`contado − esperado`, así que contar el cajón vacío daba `0 − (−500.000)` y la
pantalla anunciaba **«Sobran $500.000»**. La resta era correcta. El cartel no
significaba nada: lo que había pasado es que se cargó una salida que no salió
de ahí.

## Las cuatro

**1. Del cajón se podía sacar lo que no había.** `transferir` ya controlaba el
saldo antes de mover la plata; `registrarGasto` y `pagarGasto`, no. Ahora el
control está en `moverCuenta`, que es por donde pasan los tres, y es doble:
contra el saldo de la cuenta y —más exigente— contra lo que hay en el cajón de
**este** turno, porque el saldo de la cuenta arrastra todos los turnos
anteriores y el cajón se vació anoche.

El control es solo para el efectivo, a propósito: el cajón lo conoce entero el
POS y se cuenta todas las noches, así que un negativo ahí es siempre un error de
carga. El saldo del banco o de Mercado Pago es un espejo incompleto —entra plata
que nunca pasó por el POS— y frenar un pago real porque el espejo va atrasado
sería peor que el problema.

**2. Traer plata del banco al cajón no lo veía el arqueo.** La entrada de una
transferencia iba siempre sin sesión, con el argumento de que «el turno es del
cajón y no del banco». Es cierto al depositar la recaudación, y exactamente al
revés cuando se trae cambio para dar vuelto: esos billetes entran al cajón que
se cuenta a la noche. El conteo daba de más por el monto traído y no había nada
en pantalla que lo explicara. Ahora la entrada pertenece al turno si el destino
es la caja.

**3. El panel de caja mentía sin decir un número falso.** El renglón «Gastos
pagados del cajón» sumaba todos los gastos del turno, incluidos los pagados por
transferencia. Se pagaban $2.000.000 del banco y la pantalla decía «gastos
pagados del cajón: $2.000.000» justo al lado de un efectivo esperado que —con
razón— no los restaba. Los dos números eran correctos por separado. Juntos
decían una mentira. Ahora el renglón cuenta solo lo que salió de una cuenta de
efectivo y lo demás va aparte, bajo «no salió del cajón».

**4. La invariante que tenía que atajar todo esto estaba desactivada.** Existía
desde la fase 7 —«Efectivo esperado de cada turno»— pero sumaba la apertura dos
veces: la apertura ya es un movimiento de la cuenta de efectivo, y la condición
volvía a sumarla encima. Con eso quedaba tan laxa que no saltaba nunca. Un turno
abierto con $100.000 que pagaba un gasto de $150.000 quedaba esperando −$50.000
y pasaba de largo. Ahora se llama **«Ningún turno espera menos de cero en el
cajón»** y pregunta lo que tiene que preguntar.

## Y el cartel, cuando igual pasa

Aunque ya no se pueda llegar por estos caminos, si un turno queda esperando
menos de cero el cierre lo dice en vez de anunciar que sobra plata: *«el sistema
esperaba menos de cero en el cajón, así que salió más plata de la que entró.
Casi siempre es un gasto grande cargado como pagado en efectivo cuando en
realidad salió del banco»*.

## Lo que quedó para que no vuelva

`npm run caja`: veintidós combinaciones de cobro y de pago, cada una en su
propio turno, con los billetes contados a mano y comparados con lo que dice el
sistema. Efectivo, tarjeta, transferencia, Mercado Pago, mixto, fiado, seña,
cobro de deuda vieja, gasto del cajón, gasto del banco, gasto pendiente, gasto
anulado, depósito y retiro. Los tres tests nuevos de `gastos.test.ts` se
comprobaron al revés: apagando el arreglo, fallan.

---

# Décima pasada — el catálogo, sin depender de DonWeb

Al dar de alta el primer webhook, WooCommerce contestó:

> No se puede acceder a la URL de entrega: cURL error 60: SSL certificate
> problem: EE certificate key too weak

No es el certificado del POS: es el de Vercel y está bien. Es el OpenSSL del
servidor de DonWeb, con un nivel de seguridad que rechaza los certificados
ECDSA. La validación corre del lado de ellos, así que del nuestro no hay nada
que tocar, y WooCommerce ni siquiera deja **guardar** un webhook cuya URL no
puede alcanzar. Dicho sin vueltas: el camino por el que la tienda avisaba de un
cambio de precio no existe, y no depende de nosotros que vuelva a existir.

## Lo que se hizo

Se dio vuelta la dirección. En vez de esperar el aviso, el POS pregunta: cada
diez minutos, con la tarea programada que ya drenaba la cola, le pide a
WooCommerce **solo lo que cambió** desde la corrida anterior. Con 803 productos
eso es casi siempre una consulta que vuelve vacía, y un cambio de precio hecho
en la tienda llega al mostrador en menos de diez minutos.

La cola va primero y el refresco después, con lo que sobre del tiempo. No es un
detalle de implementación: la cola es stock que la tienda todavía no descontó
—plata— y el refresco son precios. Si el tiempo alcanza para uno solo, tiene que
ser la cola.

## Las tres trampas

**1. La marca de agua no puede avanzar sobre una corrida cortada.** Si el
refresco se queda sin tiempo a la mitad, lo que no llegó a traerse no se pediría
nunca más: sería un cambio de precio perdido para siempre, vendiendo a un precio
viejo en el mostrador. Por eso `sincronizarCatalogo` ahora devuelve `incompleto`
y la marca solo se guarda cuando eso es `false`. La prueba se comprobó al revés:
guardando la marca siempre, falla.

**2. El corte por tiempo va antes de escribir, no después.** Si no, una página
podía quedar guardada a medias y la marca no tendría forma de saberlo. Ahora una
página entra entera o no entra.

**3. El instante de la marca se toma al arrancar, no al terminar.** Lo que
cambie en la tienda **mientras** el refresco corre entra en la ventana de la
corrida siguiente, en vez de caer en el hueco entre las dos.

Y un margen de seis horas sobre la ventana, por si el sitio ignora
`dates_are_gmt` y lee la fecha en el huso local: serían tres horas de
corrimiento, justo en la dirección que deja productos afuera. El costo de pedir
de más es una consulta vacía.

## Lo que este camino no cubre

Un producto **borrado definitivamente** en Woo no aparece en ninguna listada, así
que el refresco no se entera. Uno mandado a la papelera sí, porque cambia de
estado y se marca inactivo. Para el borrado del todo queda `npm run woo:sync`,
que compara contra el catálogo entero. Está escrito en el README y en
PRODUCCION.md, que es donde se va a buscar.

> **Corregido en la undécima pasada.** La frase de arriba era falsa cuando se
> escribió: `woo:sync` traía el catálogo entero pero no daba de baja nada, así
> que el borrado del todo no lo resolvía nadie. Ver más abajo.

---

# Undécima pasada — lo que se borró de la tienda seguía a la venta

Al cargar el catálogo real en producción, la consulta de control devolvió algo
que no cerraba:

```
productos: 846 · variables: 0 · variantes: 600 · con_imagen: 22
```

Seiscientas variaciones vivas y **cero** productos variables que las expliquen.

## Lo que pasaba

Un producto que se borra definitivamente en WooCommerce no aparece en ninguna
listada, ni siquiera pidiendo `status=any`: deja de existir. Y
`sincronizarCatalogo` solo escribía lo que la tienda devolvía, nunca miraba lo
que faltaba. Así que la ficha borrada se quedaba en el espejo **activa**, con el
precio y el stock del día que se borró, y el buscador de la pantalla de venta la
seguía ofreciendo: `buscar.ts` une las variaciones con `LEFT JOIN … AND v.activo`
y no pregunta por el tipo del padre.

En números: catorce fichas borradas de la tienda —los vidrios templados y los
hidrogeles, que son los variables— seguían a la venta con sus seiscientas
variaciones congeladas doce días atrás. Vender a un precio de hace doce días en
un negocio donde el dólar mueve la lista todas las semanas no es un detalle.

Y lo peor no fue el agujero sino lo que decía la documentación. En la pasada
anterior escribí, en el README, en PRODUCCION.md y en el encabezado de
`refrescar.ts`, que para el borrado definitivo estaba `npm run woo:sync`, «que
compara contra el catálogo entero». Traía el catálogo entero, sí. Comparar no
comparaba nada. Un `grep` de dos segundos por `activo: false` en `src/woo/` lo
habría mostrado, y no lo hice: di por cierto lo que quería que fuera cierto.

## Lo que se hizo

`sincronizarCatalogo` acepta `desactivarAusentes`, y el reconocimiento es por
fecha: la corrida toca `last_synced_at` de todo lo que la tienda devolvió, así
que lo que quedó con la fecha vieja es lo que no vino. Un producto nacido en el
POS y todavía sin publicar tiene esa fecha en `NULL`, y `NULL < fecha` no es
verdadero, así que queda afuera solo, sin necesitar una condición aparte.

Tres resguardos, y cada uno tiene su prueba:

1. **Se desactiva, nunca se borra.** Las ventas viejas lo siguen referenciando.
   Las variaciones se dan de baja primero, mientras todavía se sabe de qué padre
   son.
2. **Nunca en el refresco incremental.** Con `modificadoDesde` puesto, la
   ausencia no significa nada —el producto simplemente no cambió— y una corrida
   cortada por tiempo tampoco da de baja: lo que faltó no está borrado.
3. **Techo del 20%.** Si el cálculo dice que falta más de una quinta parte del
   catálogo, no se toca nada y se explica por qué. Una tienda no pierde media
   lista de un día para el otro: eso es una clave con permisos recortados o una
   tienda a medio restaurar. Un producto dado de baja por error es una venta que
   el mostrador no puede hacer.

Los tests se comprobaron al revés: apagando la baja, cuatro fallan. El catálogo
de prueba de ese bloque tiene cuarenta fichas y no tres, porque con tres
cualquier baja pasa el techo —sacar una sola ya es el 33%— y el resguardo
quedaba sin probar.

## Y de paso, la cotización

En la misma corrida apareció esto:

```
AVISO: no se pudo leer la cotización. Los precios en dólares no se van a verificar.
```

El script pedía la cotización al plugin de la tienda y, si no la conseguía,
mandaba `null`. Con `null`, la verificación de precios en dólares —la que atrapa
el error de los 9 iPhones, US$ 6.300 leídos como $6.300— no corre. Y el informe
salía **sin un solo `usd_incoherente`**, que es exactamente lo que uno lee como
«está todo bien» cuando en realidad nadie miró. Un silencio que se disfraza de
buena noticia es peor que un error.

Ahora, si la tienda no da cotización, se usa la última guardada y se dice de
cuándo es. Una de ayer sirve de sobra: la tolerancia es 1,5x contra 0,66x, o sea
que busca errores de magnitud, no diferencias de unos pesos. Lo único que no se
puede hacer es verificar a ciegas y callarse.

## Y las seiscientas no eran de los catorce

La baja por ausencia dio catorce productos, exactamente los que faltaban. Pero
las seiscientas variaciones siguieron activas, lo que desarmaba la explicación:
si no se habían ido con ningún padre, sus padres estaban vivos.

Lo estaban. Las dos consultas que lo cerraron:

```
woo_id 6484 · Vidrio templado | glass   · tipo simple · activo · 40 variantes
woo_id 6487 · Hidrogel clear AA         · tipo simple · activo · 40 variantes
…quince fichas, cuarenta variaciones cada una

X-WP-Total: 0     (products?type=variable)
```

La tienda no tiene un solo producto variable: las quince fichas se aplanaron a
«simple» en WooCommerce. Y WooCommerce, al aplanar, **no borra las
variaciones**: quedan colgando, invisibles desde la tienda pero intactas en la
base. El espejo las copió cuando todavía eran variables y después dejó de
refrescarlas, porque solo se piden las variaciones de los productos variables.
Seguían apareciendo en la pantalla de venta —`buscar.ts` las une por `v.activo`
y no mira el tipo del padre— al precio del día en que se aplanaron.

La baja de estas no necesita techo ni corrida completa: no se apoya en una
ausencia sino en lo que la tienda dijo de cada ficha que devolvió. Vale igual en
el refresco incremental, y así está probado.

Queda una lección incómoda del camino. Antes de tener estos datos armé la
hipótesis de que las variaciones eran de los productos borrados, y estuve a un
paso de escribir el arreglo sobre esa base. Habría sido el arreglo correcto para
el problema equivocado: si el campo `type` no hubiera estado llegando, dar de
baja las variaciones dejaba al mostrador sin poder vender vidrios templados. Dos
consultas de treinta segundos separaban una cosa de la otra.

De ahí sale el último cambio: `type` es el único campo de la ficha sin valor por
defecto en el esquema. De él depende que un producto conserve o pierda sus
variaciones, y `.default('simple')` convertía «la tienda no mandó el campo» en
«el producto es simple», que es la diferencia entre no enterarse de nada y
aplanar seiscientas variaciones en silencio. Ahora la ficha se descarta y queda
el aviso, que es la política declarada de ese archivo desde el principio.

---

# Duodécima pasada — el permiso que frenaba el trabajo, no el riesgo

Los vendedores empezaron a usar el sistema y en el primer día pidieron tres
cosas, todas la misma:

> **Fede:** que podamos editar un precio antes de venderlo por las dudas algo
> tenga precio viejo · No veo que se pueda hacer descuento tampoco
>
> **Valentina:** si se puede que nosotros carguemos las cosas mejor, porque si
> compran algo que recién llega no podemos anotarlo hasta que vos lo cargues

Y reportaron un cuarto: una venta en cuenta corriente que no aparecía en Fiado.

## El que no era un bug

Lo primero fue reproducir el fiado contra una base real, porque una deuda que no
se registra es plata que se va:

```
credit_accounts  → saldo $ 1.200,00 (origen sistema)
deudores()       → aparece con $ 1.200,00
sales.tipo       → fiado
```

El dominio estaba bien. Lo que pasaba es que **el vendedor no podía hacer esa
venta**: en la pantalla de cobro el botón «+ Cuenta corriente» solo se dibujaba
para el dueño (`puedeFiar={esDuenio}`). Así que la venta que probaron se cobró
con otro medio y no había deuda que mostrar. El síntoma decía «no aparece en
Fiado»; la causa era «no se puede fiar».

Eso tiene una cola: esa venta entró al cajón como cobrada. No es un error del
arqueo —el arqueo cuenta lo que le declararon— pero conviene mirarla.

## Los otros tres, y el hueco que tenían debajo

- **Editar precio:** solo existía en los productos marcados `precioEditable`, que
  son los servicios. Para un producto normal con la ficha vieja no había forma,
  ni para el dueño.
- **Descuento:** `puedeDescontar={esDuenio}`.
- **Cargar productos:** el vendedor **ya tenía el permiso** y la pantalla lo
  dejaba entrar. El problema era llegar: el botón «Cargar al catálogo» aparecía
  únicamente cuando la búsqueda no devolvía nada. Buscar «auricular» traía otros
  diez y el botón desaparecía.

Debajo de los tres estaba lo mismo: el diseño definía un tercer nivel de permiso
—*el vendedor puede, con el PIN del dueño al lado*— para anular, descontar,
editar precio, ajustar stock y cargar gastos. **Ese nivel no tenía pantalla.**
`requiereAutorizacion` estaba escrito, exportado, probado… y no se llamaba desde
ningún lado. Los controles simplemente no se mostraban.

Un permiso que en la práctica significa «andá a buscar a Lucas» no es un
permiso: es una traba, y la salida que encuentra el mostrador es el papel.

## Lo que decidió Lucas

> los vendedores pueden hacer todo menos ver y hacer reportes de balance mensual

## Lo que se hizo

La lista de `permisos.ts` pasó a ser la de las **excepciones**: `puede()`
devuelve true salvo para los dos de reportes y `usuario.administrar`. Con eso el
permiso que alguien agregue mañana nace del lado del vendedor, que es la regla, y
volverlo del dueño es una decisión explícita. Un test recorre `PERMISOS` y falla
si aparece uno sin clasificar, que es el precio de invertir la regla y se paga
una sola vez.

Y apareció la duplicación de siempre: **ocho páginas guardaban por rol**
(`if (sesion?.user.rol !== 'owner') redirect('/')`) en vez de por permiso, y la
barra de navegación tenía su propio `soloDuenio`. Tres lugares donde decir lo
mismo, que es una forma seria de que digan cosas distintas: abrirle una pantalla
al vendedor exigía acordarse de los tres. Ahora los tres preguntan `puede()`.

**El precio escrito vale en cualquier producto.** Lo que reemplaza a la
prohibición no es confianza: es la guarda de cordura, que compara contra el
catálogo y frena lo que quede muy por debajo. Cobrar **de más** no la despierta,
y es justo el caso de Fede: el proveedor aumentó y la ficha quedó vieja.

**Confirmar un precio sospechoso pasó a ser del que puede escribirlo.** Esta la
pensé dos veces, porque es la guarda emparentada con el error de los 9 iPhones.
Lo que la decidió es que **el descuento no pasa por la guarda**: con el vendedor
descontando sin tope, reservar el precio escrito no protegía nada —solo empujaba
a rebajar por el campo que se ve menos—. La guarda sigue avisando siempre y la
bitácora registra quién confirmó.

**Y el acceso a «Cargar al catálogo» ahora está también cuando hay resultados**,
como un renglón discreto al pie de la búsqueda: *¿No está en la lista?*

## Dos sospechas que eran una sola, y no lo eran

Correr la suite entera destapó algo que la decisión de Lucas no cubría, porque
nadie sabía que había que decidirlo.

La guarda de precios tira `precio_sospechoso` en dos casos que no se parecen en
nada:

1. **Una ficha mal cargada.** El iPhone con la cifra en dólares leída como
   pesos: el error de agosto. Nadie eligió ese precio.
2. **Un precio escrito a mano muy por debajo del catálogo.** Alguien lo decidió,
   en el mostrador, con el cliente enfrente.

Los dos viajaban bajo el mismo `motivo` de texto libre, así que al habilitarle
al vendedor «confirmar un precio sospechoso» se le habilitaron los dos de una.
El e2e lo cazó: un test que decía *al vendedor lo frena del todo, y le dice cómo
salir* —sobre el iPhone mal cargado— empezó a fallar porque ahora le aparecía el
botón de cobrar igual.

Habría sido fácil reescribir ese test y seguir. Lo correcto era separar los
casos: `Sospecha` ahora lleva `tipo: 'catalogo' | 'escrito'`, y son dos permisos
distintos. El precio escrito lo confirma quien atiende; la ficha mal cargada
sigue siendo del dueño, porque ahí cobrar igual no es una decisión de venta sino
tapar un problema de catálogo, y lo que corresponde es arreglar la ficha.

El filtro vive en el dominio y no en la pantalla: `confirmarSospechas` es ahora
`'escritas' | 'todas'` y `confirmarVenta` descuenta solo lo que vino a
confirmarse. Un navegador manipulado que mande la bandera no fuerza una ficha
dudosa. Y la bitácora guarda cuál de los dos se confirmó, que leído dentro de
seis meses no es lo mismo que un `true`.

## Lo que quedó afuera a propósito

`usuario.administrar` sigue siendo del dueño. Crear cuentas y cambiar
contraseñas —la del dueño incluida— no es atender el mostrador, es controlar el
sistema. Hoy no lo usa ninguna pantalla; queda reservado para que el día que
exista no aparezca abierto sin que nadie lo haya decidido. Está dicho en el
código y en la respuesta a Matías, no escondido en un commit.


---

# Decimotercera pasada — el formulario adentro del formulario

Matías pidió que al cargar un producto, si ya existe uno con ese nombre, se lo
pueda elegir y sumarle unidades en vez de duplicarlo; y un buscador en la
pantalla de Catálogo. Con una condición que vale más que las dos cosas:

> tiene que ser facil, interactivo e intuitivo todo, recuerda que cuando alguien
> esta en el mostrador no debe tener que ponerse a pensar uh en donde era para ir
> a agregar un neuvo producto y venderlo ahora mismo

## Lo que no existía

`stock.ajustar` estaba en la lista de permisos desde la fase 1 y **no lo usaba
nada**: no había forma de sumar stock en todo el sistema. El único camino para
que entrara mercadería era la sincronización desde WooCommerce.

## La trampa que no era obvia

Escribir el número en la base no alcanzaba. `sincronizarCatalogo` hace
`stock: excluded.stock`, o sea que **el stock de Woo pisa el del POS**. Un
vendedor que suma diez unidades y no se lo cuenta a la tienda las pierde en el
próximo `woo:sync`, y el mostrador vuelve a vender lo que no tiene.

Así que la entrada se encola, como el ajuste de una venta, con el valor absoluto
—reintentar no suma dos veces—. La operación tuvo que ser propia
(`stock.empujar`): la de la venta termina marcando `sales.synced_to_woo`, y acá
no hay ninguna venta que marcar. Hay un test que falla si se saca el encolado.

Y `FOR UPDATE` sobre el producto, porque dos personas pueden estar cargando la
misma entrega en dos pantallas: sin candado la segunda escritura se come la
primera, entran veinte unidades y el sistema anota diez.

## El bug que encontró el e2e y no la lectura

El control de sumar stock se dibuja **adentro del formulario del alta** —tiene
que estar ahí, el momento de darse cuenta de que el producto ya existe es
mientras se escribe el nombre, no después de completar precio y stock—. Y lo
escribí como un `<form>` con `useActionState`, que es lo natural en este
código.

HTML no permite formularios anidados. El navegador descarta el de adentro y su
botón pasa a enviar el de afuera: **«Sumar al stock» terminaba intentando crear
el producto a medio llenar**. El stock no subía, el alta fallaba por validación,
y el vendedor no entendía nada.

Typecheck, lint y 851 pruebas unitarias pasaron sin decir una palabra: ninguna
mira el HTML que sale. Lo cazó la pantalla de verdad, apretando el botón.

La salida no fue mover el aviso abajo del formulario, que habría arruinado lo
único que Matías pidió explícitamente. Es llamar a la acción del servidor como
una función, dentro de una transición: mismo servidor, mismo permiso, misma
validación, sin un `<form>` de más. Y el test ahora afirma las dos cosas —que el
stock subió y que **el alta no se envió**— porque la segunda es la regresión.

## Lo que se ganó de paso

La pantalla de Catálogo servía para ver lo que está mal cargado, y para
encontrar *un* producto no servía: había que mirarlo a ojo en una lista de
sesenta fichas ordenadas por gravedad. Ahora arranca con un buscador que usa la
misma consulta que el aviso de duplicados —la que trae también los inactivos,
que son los que no aparecen al vender y hacen creer que el producto no está— y
desde cada resultado se le suman unidades. Lo que no está lleva derecho a
cargarlo con el nombre ya escrito.

## El precio que se mostraba no era el que se cobraba

Al agregarle a ese buscador la corrección de precio apareció un error que ya
estaba y nadie había mirado: la lista mostraba el precio **de la ficha**, que es
el de la tienda. Con el recargo del 12% puesto, el vendedor leía $56.000 en un
producto que el local cobra $50.000.

No rompía ninguna venta —la venta hace bien la cuenta— pero es exactamente el
tipo de número que alguien usa para decidir en el mostrador. `buscarParecidos`
ahora devuelve el de mostrador, calculado con la misma función que usa la venta.

## Corregir un precio: lo que había que hacer bien

Fue el primer pedido de los vendedores. Tres cosas que no eran obvias:

1. **Qué número se escribe.** El mostrador piensa en lo que le cobra al cliente,
   así que eso es lo que se escribe; pero el que vive en la ficha es el de la
   tienda. Se guarda el de tienda, calculado con `precioDeTienda`, la inversa
   exacta del cálculo de la venta. Hay un test que escribe un precio, lo vuelve
   a leer por el camino de la venta y exige el mismo número: si la ida y la
   vuelta no cierran —y con el redondeo a los cien pesos es fácil que no
   cierren— el cajero escribe $15.000 y cobra $14.900.

2. **Hay que limpiar `precioLocalCentavos`.** Ese campo pisa el cálculo. Si el
   producto tenía uno puesto y se deja, el precio recién escrito **no se cobra**:
   se cambia el número, la venta sigue saliendo el viejo y nadie entiende por
   qué. Es el peor de los tres, porque falla en silencio.

3. **Hay que empujarlo a Woo.** Misma razón que el stock, con una consecuencia
   más cara: la web sigue cobrando el precio viejo, y además el próximo
   `woo:sync` devuelve la ficha a ese precio, así que el cambio se borra solo.
   La operación (`precio.empujar`) lee el precio de la base al drenar y no del
   payload: dos cambios seguidos terminan los dos en el último, que es el
   correcto, y reintentar escribe el mismo número.

Hay tests que fallan si se saca cualquiera de los tres. Se verificó sacándolos.

El permiso es `producto.alta_rapida` y no `producto.editar`: quien puede crear
una ficha con el precio que quiera ya puede poner cualquier número. Pedirle más
para corregir uno existente solo lo empuja a cargar un duplicado, que es justo
lo que el aviso de parecidos vino a evitar.

## El e2e que rompía a los que venían después

El primer test del cambio de precio le cambiaba el precio al vidrio templado, y
se cayeron cinco specs. El vidrio de $5.000 es el producto que vende medio
suite: los tests corren en serie sobre la misma base sembrada, así que dejarle
otro precio les rompe los totales a todos los que vienen detrás. El test usa
ahora un producto que nadie más toca. Es la contracara de compartir el seed: un
test que **escribe** datos compartidos tiene que elegir qué escribe.

## Pegar la lista en vez de armar la planilla

La importación por CSV andaba, pero pedía algo que nadie tiene a mano cuando
llega la mercadería: una planilla con encabezado. Lo que hay de verdad es la
lista escrita en el momento, y la primera entrega la convertí yo a CSV a mano.
Eso no escala: la próxima entrega vuelve a necesitarme.

Tres decisiones que hubo que tomar bien, porque las tres fallan en silencio:

**El paréntesis dice tres cosas distintas.** `(5)` y `(4+)` son unidades;
`(34985)` es el final de un IMEI, no treinta y cinco mil unidades; `(eliminar)`
es una baja. La regla que separa el IMEI de la cantidad es el largo: cuatro
dígitos o más no puede ser una entrega, porque el techo son mil. No se exige que
el nombre diga «iPhone» —un Samsung usado entra igual, y un día va a entrar—.

**Un renglón sin precios no es un renglón incompleto.** Es la forma de decir
«esto ya está, sumale lo que llegó»: no se repite el precio que no cambió. Si el
producto no existe, el renglón se rechaza en vez de darlo de alta en $0, porque
un producto a cero se vende a cero y se descubre cobrando.

**El nombre tiene que coincidir exacto** para sumar stock o dar de baja.
Aproximar acá es dar de baja el producto equivocado. Hay un test que pone en el
catálogo «Memoria Kingston micro sd 128gb 100Mb/s», pide la baja de «Memoria
Kingston», y exige que **no se toque nada**.

## La baja que el sync deshacía

El primer `darDeBaja` escribía `activo: false` y listo. Habría durado hasta el
próximo `woo:sync`: la sincronización traduce el `status` de WooCommerce a
`activo` (`activo: status === 'publish'`), así que Woo iba a seguir diciendo
`publish` y el espejo le iba a creer. Es la misma pisada que ya había aparecido
con el stock y con el precio, por tercera vez.

Así que la baja encola `producto.baja` y pasa el producto a **borrador** en Woo.
No usa el DELETE de la API a propósito: la ficha está pegada a las ventas viejas
y a la rentabilidad de los meses pasados, y lo que se pidió es que el producto no
se venda más, no que nunca haya existido. Borrador lo saca de la web, hace que la
sincronización lo traiga inactivo y se puede deshacer.

## El dólar leído como peso

`u$s 718 - $1.490.000` partido por el primer `$` da un nombre que termina en «u»
y un precio de 718 pesos. El costo entra mil veces más chico, el margen de esa
notebook queda en el 99% y **nada se ve raro**: es un número plausible en una
lista donde hay cables de $1.500.

Por eso el dólar no se interpreta: el renglón se marca y no se carga, con el
motivo escrito. Es la decisión correcta aunque sea más molesta, y además es
temporal —los precios en dólares solo entran desde WooCommerce, que es donde
vive la cotización—.

## Lo que se probó con la lista de verdad

El test del parser no usa casos inventados: usa los 24 renglones de la entrega
del 1 de octubre, copiados del mensaje que la trajo. Ahí estaban todos los casos
de borde juntos, y ninguno se me habría ocurrido: comillas en el nombre
(`SEISA 6,5''`), un `+` en el medio (`jack 3,5 + usb c`), guiones que son parte
del nombre (`TL-WA850RE`, `TP-Link`), comas decimales (`1,5m`), un renglón con un
solo precio, dos sin precios, uno con IMEI y uno en dólares.

## El dólar que se leía solo, y el que casi se lee mal

El pedido vino con la tarea hecha: la página, y la clase CSS. `.colCompraVenta`.

Esa clase aparece **32 veces** en la página de Córdoba. La primera —la que
agarra un selector suelto— es **$1.499,38**: el dólar *oficial*, columna
*compra*. El blue vendedor del mismo día es **$1.571,00**. Setenta y dos pesos,
el dólar equivocado y la punta equivocada, repreciando todos los usados.

Y no se habría notado. Un dólar de $1.499 es perfectamente plausible: pasa la
banda de 100 a 500.000, pasa la guarda de salto del 15%, y en pantalla se ve
como un dólar cualquiera. El error habría vivido hasta que alguien comparara un
precio con la calle.

La página tiene dos tablas de promedio bien separadas —`#Promedio`, que son los
bancos, y `#BluePromedio`, que es el blue— así que la lectura se ancla en la
tabla y no en la clase. Además exige que la fila diga «blue» y «Córdoba», y
rechaza una venta por debajo de la compra. El fixture del test es la página real
con la tabla señuelo adentro: reemplacé el ancla por el selector suelto y
fallaron ocho pruebas.

**La lección no es sobre scrapers.** Es que cuando un pedido llega con la
solución técnica ya elegida —«es el elemento .colCompraVenta»— esa parte también
hay que verificarla. Era un selector razonable escrito por alguien que miró la
página en el inspector; estaba mal igual.

## Lo que ya estaba hecho

Antes de escribir nada revisé `src/cotizacion/cotizacion.ts`, y las tres guardas
que iba a construir ya existían de la fase 2: banda plausible, salto máximo del
15% y bitácora con el origen. Y en `carrito.ts`, que el mostrador **ya se
reprecia solo** —un producto en dólares no tiene el precio en pesos guardado, se
calcula al vender—. O sea que de las cinco piezas del pedido, dos estaban.

Lo que faltaba de verdad era una sola cosa que no era obvia: **la web no se
reprecia**. El número en pesos de WooCommerce lo recalculaba el mismo plugin que
dejó de contestar, así que con la cotización nueva el POS iba a cobrar bien y la
tienda a publicar el viejo. Con el dólar subiendo, eso es vender a pérdida por
la web sin que ninguna pantalla lo diga.

## Tres cosas que caza cada herramienta, y no la otra

En esta tanda cada una apareció una vez, y ninguna la habría encontrado la de al
lado:

- **El índice único de `sync_queue`.** La clave de idempotencia que escribí era
  `precio:usd:<producto>:<precio>`, y el dólar vuelve sobre sus pasos: sube el
  martes y baja al mismo valor el jueves. Esa segunda vez chocaba contra el
  índice y se caía el repreciado del producto. Lo encontré leyendo el esquema
  antes de correr nada.
- **El umbral de vencimiento.** Bajarlo de 20 a 6 horas rompió un test que tenía
  escrito `19.5` a mano. El test tenía razón en fallar, pero quedó atado a la
  constante para que no vuelva a pasar.
- **`next build`.** Exporté una constante propia desde un archivo de ruta. Las
  944 pruebas unitarias pasaron y `tsc --noEmit` también: las rutas de Next solo
  pueden exportar los nombres que el framework conoce, y eso solo lo valida el
  build. Es la segunda vez que el `npm run build` antes del e2e paga el costo de
  existir.

## El medio de pago que estaba escrito y nunca se había ejecutado

`dolares` existía desde la fase 1: en el enum de la base, en el tipo `MedioPago`
y en `tipoDeCuentaPara`. Lo que no existía era el botón en la pantalla de cobro,
así que en un año nadie lo usó nunca — y por eso nadie vio que
`tipoDeCuentaPara('dolares')` devolvía `'efectivo'`.

O sea: mil dólares entraban al cajón de pesos como mil pesos. El saldo del
efectivo quedaba mal por la diferencia entera, y el arqueo lo habría cantado…
salvo que el arqueo lo acabábamos de sacar esta misma semana.

Estaba a un botón de distancia. Si el pedido hubiera sido «agregá dólares a la
pantalla de cobro» y yo lo hubiera agregado sin leer el dominio, habría quedado
roto desde la primera venta.

## Un test que decía probar algo y no lo probaba

Escribí los tests del cobro en dólares pasando `monetaryAccountId` explícito,
como hace la pantalla. Pasaban. Después mutilé `tipoDeCuentaPara` para que
volviera a devolver `'efectivo'` —el bug original— y **los cincuenta tests
siguieron en verde**: con la cuenta dada a mano, esa función ni se consulta.

El test que faltaba era el del caso en que el servidor tiene que decidir solo:
un pago en dólares **sin** cuenta indicada. Ese es el que falla con la mutación,
y es el único que de verdad sostiene el arreglo.

Vale como recordatorio de que un test verde no prueba nada por sí solo: hay que
romper el código a propósito y ver cuál se cae.

## La migración que drizzle-kit quiso escribir

`npm run db:generate` produjo una migración de sesenta sentencias que incluía
`CREATE TABLE "returns"`, las columnas de `credit_plans` y las de venta diferida
—todo lo de las migraciones 0012 a 0014, que están escritas a mano y nunca
actualizaron el snapshot de drizzle-kit—. Aplicarla contra producción habría
reventado en la primera tabla que ya existe.

Las migraciones de este proyecto se escriben a mano. Quedó dicho en el
encabezado de la 0015 y vale para la próxima.

## La deuda que existía en la base y no la veía nadie

Terminé el dominio de la deuda en dólares —la cuenta, el plan, el cobro, los
tests— y lo di por hecho. Faltaba lo más simple: la lista de Fiado filtraba por
`saldo_centavos > 0`, y el que compra un iPhone en cuotas tiene ese saldo **en
cero**. Su deuda eran mil quinientos dólares guardados correctamente en una
columna que la pantalla no miraba.

O sea: el caso exacto para el que se hizo todo el cambio era el único que no
aparecía en la pantalla donde se cobra. Y el encabezado decía «Nadie debe nada».

Lo mismo pasaba en cadena, cada uno en su lugar: el total por cobrar, la lista de
clientes («Al día»), la ficha del cliente, el recordatorio de WhatsApp —que
devolvía `sin_deuda` y por eso no mostraba ni el botón— y el aviso de la pantalla
de venta al fiarle de nuevo.

Agregar la columna al dominio es una cosa; que la deuda sea **visible y
cobrable** es otra, y la segunda es la que hace que el local cobre. Un cambio de
modelo no termina en el modelo: termina cuando todas las pantallas que preguntan
«¿cuánto debe?» saben que ahora hay dos respuestas.

## El semáforo que sumaba dólares con pesos

`estadosDeClientes` juntaba todas las cuotas vivas del cliente sin mirar la
moneda. Con un plan en pesos y otro en dólares, armaba una sola lista ordenada
por vencimiento y sumaba los montos: una cuota de US$ 500 —50.000 centavos— con
una de $200.000 —20.000.000 de centavos—. El «vencido» que salía de ahí no es
plata de nadie, y el número de cuota que decide la imputación salía del orden
mezclado.

No lo encontró un test. Lo encontré leyendo la función para pasarle la moneda, y
solo porque el filtro ya estaba puesto en `cuotasDeCuenta` y me llamó la atención
que acá no estuviera. Las dos consultas hacen casi lo mismo y una se había
quedado atrás.

## El cajón de dólares entraba al total como si fueran pesos

Lo encontró un test de punta a punta que iba a verificar otra cosa: fue a
`/cuentas` a ver los billetes verdes y resultó que la pantalla los escribía con
signo de peso **y los sumaba al total de todas las cuentas**. Centavos de dólar
sumados con centavos de peso: el total del negocio, que es el número que se mira
para saber cómo va el mes, estaba mal por la diferencia entera.

`CuentaConSaldo.tipo` ni siquiera incluía `'dolares'` —el tipo existe en la base
desde la fase 1 y acá se leía como `'otro'`—, así que no había forma de que la
pantalla supiera qué moneda estaba mostrando. El tipo mentía y nadie lo notó
mientras el cajón estuvo vacío.

Y tirando del hilo apareció el peor: `transferir` no miraba la moneda. Pasar
«5.000» del cajón de dólares al banco le sacaba US$ 50 a uno y le ponía $50 al
otro, con un clic, desde un formulario que ofrecía las dos cuentas juntas. Dos
saldos mal y ninguno de los dos vuelve a cerrar contra sus movimientos.

Es el mismo patrón que `tipoDeCuentaPara('dolares')` devolviendo `'efectivo'`:
código escrito cuando los dólares eran una idea, correcto mientras nadie los
usara, y roto en la primera operación real. Habilitar un medio de pago no es
agregar un botón: es revisar todo lo que toca esa plata después.

## El POS dijo «sin conexión» con internet andando

Primera carga de Fiado después del despliegue, en la ventana de siempre del
navegador: **Sin conexión**. En incógnito, la misma dirección cargaba perfecto.
Eso descartó el servidor y la base de una sola prueba.

Era el service worker. Espera cuatro segundos a la red y, si se pasa, sirve la
copia guardada; como esa pantalla nunca se había abierto en esa ventana, no había
copia, y lo que sirvió fue el cartel de «no hay internet». Había internet: lo que
faltó fue paciencia. El servidor estaba recién levantado, la base de Neon
despertándose, y la pantalla de Fiado —a la que yo acababa de agregarle dos
semáforos y la cotización— hacía **nueve consultas en fila**, cada una esperando
a la anterior para cruzar hasta São Paulo.

Dos cosas estaban mal, y ninguna es el plazo en sí:

1. **Cortar sin tener nada que mostrar no ahorra nada.** El plazo existe para no
   hacer esperar a nadie cuando hay una copia; sin copia, cambia una pantalla que
   iba a cargar por una mentira sobre el motivo. Ahora, sin copia, se espera a la
   red de verdad y el cartel sale solo si el pedido falla.
2. **Nueve viajes de ida y vuelta en serie son nueve veces la latencia.** Solo
   tres dependían de algo anterior. Ahora van en dos tandas en paralelo.

Lo que más me importa del hallazgo es la forma del error: el sistema no se cayó,
*informó mal*. Un vendedor que lee «sin conexión» sale a mirar el módem, llama al
proveedor de internet y vende en papel, mientras el POS estaba a dos segundos de
abrir. Un mensaje de error equivocado cuesta más que la falla que describe.

Y el método que lo encontró en un minuto vale anotarlo: **abrirlo en incógnito**.
Sin service worker registrado se ve el error de verdad en lugar de la pantalla de
respaldo, y eso parte el problema en dos —servidor o caché— antes de tocar nada.

## El buscador pedía el nombre exacto del proveedor

Lo trajo el mostrador, no un test: «si pongo *cargador mega* no me sale, porque
se llama *cargador Foxbox Mega*; lo tengo que poner en el orden exacto».

El término viajaba entero a la consulta, como una sola cadena: `%cargador mega%`
sobre el nombre. «Cargador Fox Box MEGA 20W» no la contiene —entre una palabra y
la otra hay «Fox Box»—, así que no aparecía nada. Para encontrar un producto que
tenía en la mano, el vendedor tenía que acertar cómo lo había escrito el
proveedor.

Y la otra mitad del problema era la misma causa vista al revés: con **una** sola
palabra —la marca— salían los cargadores, los cables y los auriculares juntos, y
había que recorrer la lista con gente esperando. Agregar una segunda palabra para
achicar la lista no funcionaba: la vaciaba.

Es una línea de código, y estuvo ahí desde la fase 2. Ningún test la encontró
porque todos los términos de prueba eran de una palabra, o de dos que estaban
pegadas en el nombre —«vidrio templado», «templado 9d»—. Un catálogo de prueba
con nombres cortos y prolijos no se parece al catálogo real, donde los nombres
los escribe el proveedor y llevan la marca en el medio.

Lo que me deja es cuánto más barato habría sido escuchar esto antes. No es una
falla que se vea en un test ni en una auditoría de invariantes: se ve en los diez
segundos que el vendedor pierde cada vez, veinte veces por día, y que nunca
reportó porque ya había aprendido a convivir con eso —primero la marca, después
recorrer la lista—. Las fallas que la gente aprende a esquivar no aparecen en
ningún tablero.

De paso apareció una diferencia vieja entre los dos buscadores: el de la tablet
tenía el código de barras entre los campos de texto, así que **cinco dígitos
sueltos encontraban el producto sin internet y no con internet**. El servidor lo
compara entero y nunca por pedazos. Ahora los dos hacen lo mismo, y el test de
paridad lo cubre con un término nuevo.

## La trampa de leer las cuotas por el cliente y no por la venta

No es un error que llegó a producción: lo frenó un test antes de que existiera
la pantalla, y vale anotarlo porque es **el mismo error que ya se cometió una
vez** —el semáforo de Fiado sumando pesos con dólares— y la causa es idéntica.

La ficha de una venta tiene que mostrar en qué cuotas quedó esa compra. El dato
está a dos saltos: la venta tiene cliente, el cliente tiene cuenta, la cuenta
tiene cuotas. Ese camino es el natural, está escrito en media docena de
consultas del sistema, y es el equivocado: quien compró tres veces tiene tres
planes sobre la misma cuenta, así que cada una de las tres fichas mostraría las
nueve cuotas. Las tres pantallas se leerían perfectas y las tres mentirían.

El camino correcto es el corto: el plan apunta a la venta. Una línea de
diferencia.

Lo que hizo que se viera fue escribir el test con **dos** ventas fiadas del
mismo cliente y no con una. Con una sola venta las dos consultas devuelven
exactamente lo mismo, para siempre; el test pasa, la pantalla miente el día que
alguien compra dos veces, y no hay manera de que el test avise nunca. Pasa igual
con un solo producto en el carrito, un solo pago, un solo turno: **el fixture de
a uno no distingue entre «lo correcto» y «lo que da lo mismo cuando hay uno»**.
Es la forma de agujero que más veces apareció en este proyecto.

Después, al revés: se rompió la consulta a propósito —sacarle el filtro de la
venta, sacarle el de los planes anulados, hacer que el turno figure siempre
abierto, dejar que el vuelto salga de una transferencia— y cada rotura tiene un
test que la encuentra. Un guardián que no se probó roto es un comentario.
