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
| 16 | `npm run lint` no está configurado | Cuando se arme la integración continua |
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
| 38 | La importación corre en una acción de servidor y una planilla de 500 renglones sobre un catálogo grande puede pasarse del tiempo de la plataforma. Se midió 4 ms por renglón con 229 productos y se sacó la lectura de SKU del bucle, pero no se probó contra 800 | Falta un catálogo real para medirlo. El riesgo está acotado: si corta, los productos creados quedan y reintentar los marca como repetidos | Antes del primer despliegue con el catálogo entero |
| 39 | El stock de la planilla se lee con `replace('.', '')`: una planilla en inglés con `1.5` unidades entra como 15 | El precio se parsea con cuidado y el stock no; hay que darle el mismo trato | Cualquier momento |
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
