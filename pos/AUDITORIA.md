# Auditoría del POS

Primera pasada: 2026-09-12, antes de la fase 4 (fases 1 a 3, commit `c825d06`).
Segunda pasada: 2026-09-15, antes de la fase 6 (fases 1 a 5, commit `aa7d9c9`).

> **Estado: quedan abiertos diez hallazgos; dos de ellos tocan plata.** La fase
> 3.5 corrigió del 1 al 8, el 12 y el 13; la 3.7 cerró el 9, el 10 y el 11. La
> segunda pasada sumó del 21 al 25 y agravó el 15. Lo pendiente está en la lista
> del final.

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

**Decisión pendiente**, porque hay tres caminos razonables y es una decisión de
negocio: rechazar la anulación y pedir que primero se devuelva el pago; anularla
y sacar la plata de la caja automáticamente; o anularla avisando fuerte en
pantalla que hay que devolver $4.000.

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
`sale_payments` en vez de `cash_movements`, que es donde está la plata de verdad.

---

## Menores

### 23. El comprobante y el WhatsApp de una venta fiada no dicen cuánto queda debiendo

Venta de $12.000: $5.000 en efectivo y $7.000 fiados. El ticket imprime
«Cuenta corriente $7.000,00» y el WhatsApp dice «Gracias por tu compra ·
Total: $12.000». Ninguno de los dos dice que el cliente quedó debiendo, ni
cuánto debe en total. Es exactamente el papel que se guarda para discutir
después.

### 24. «Quedó debiendo $X» en la ficha del cliente puede contradecir el saldo

El renglón de cada cobro guarda el saldo que quedaba en ese momento
(`saldoResultanteCentavos`, congelado a propósito). Si después se anula una
venta, la ficha muestra «Deuda $0,00» arriba y «quedó debiendo $1.000,00» en el
movimiento. Los dos números son correctos y juntos confunden.

### 25. Un comprobante de WhatsApp muy largo pasa los 2.000 caracteres de URL

Medido: a 20 renglones la URL va en 1.402 caracteres; a 40 renglones, 2.542.
Algunos clientes de WhatsApp truncan el texto pasado ese punto. Con las ventas
típicas del mostrador no llega, pero una venta de muchos accesorios sí. Se
arregla cortando el detalle a los primeros renglones y agregando «y N productos
más».

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

| # | Qué | Cuándo conviene |
|---|---|---|
| **21** | **Anular una venta fiada ya cobrada en parte deja plata del cliente sin registrar** | **Antes de la fase 6** |
| **22** | **El desglose por medio de pago no cuadra: bruto de vuelto, cuenta el fiado como plata y omite los cobros de fiado** | **Antes de la fase 6** |
| 14 | La justificación del arqueo solo se ve como tooltip | Con la fase de reportes |
| 15 | *(absorbido por el 22)* | — |
| 16 | `npm run lint` no está configurado | Cuando se arme la integración continua |
| 17 | El vendedor que topa con un precio sospechoso no sabe qué hacer | Sigue abierto: el PIN del dueño no se hizo en la fase 4 |
| 18 | Inicio dice que sincronizó cuando el seed nunca sincronizó | Cualquier momento |
| 19 | «Sin ningún problema: 0%» en Calidad del catálogo | Cualquier momento |
| 20 | Un reintento idempotente informa vuelto $0 | Cualquier momento |
| 23 | El comprobante y el WhatsApp de una venta fiada no dicen la deuda | Con el 21, que es el mismo tema |
| 24 | «Quedó debiendo $X» puede contradecir el saldo tras una anulación | Con el 21 |
| 25 | Un WhatsApp de más de ~30 renglones pasa los 2.000 caracteres de URL | Cualquier momento |
