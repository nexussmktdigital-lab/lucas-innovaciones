# Auditoría del POS antes de la fase 4

Fecha: 2026-09-12 · Sobre el código de la rama `claude/vigilant-volta-335wxv`
(commit `c825d06`, fases 1 a 3 terminadas).

> **Estado: la fase 3.5 corrigió los hallazgos 1 a 8, 12 y 13.** Cada uno tiene
> abajo una línea «Arreglado» con lo que se hizo. Quedan abiertos el 9, el 10,
> el 11 y del 14 al 20; están en la lista del final.

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

---

## Medios

### 10. Los montos de una venta cerrada se pueden reescribir

Los disparadores de inmutabilidad bloquean `DELETE` en `sales`, `sale_items` y
`sale_payments`, pero **no `UPDATE`** (a propósito: anular necesita cambiar
`estado`). El efecto colateral es que un `UPDATE sales SET total_centavos = 1`
pasa sin ruido. Comprobado.

Debería bloquearse por columna: permitir `estado`, `synced_to_woo`, `nota` y
`updated_at`, y frenar todo lo que sea plata o cantidades.

### 11. El webhook `product.updated` de WooCommerce pisa el stock local

El POS es la fuente de verdad del stock y le manda a Woo el valor absoluto. Pero
cuando Woo devuelve un `product.updated`, el webhook escribe `stock` de vuelta
sobre el espejo local. Entre una venta y su sincronización, eso puede deshacer
el descuento. El precio sí corresponde que lo mande Woo; el stock no.

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

La fase 3.5 cerró los hallazgos 1 a 8, el 12 y el 13. Siguen pendientes:

| # | Qué | Cuándo conviene |
|---|---|---|
| 9 | La cola de Woo solo se drena al vender, y lo que falla seis veces queda muerto sin botón de reintento | Antes de salir a producción |
| 10 | Un `UPDATE` puede reescribir los montos de una venta cerrada | Antes de salir a producción |
| 11 | El webhook `product.updated` pisa el stock local | Antes de salir a producción |
| 14 | La justificación del arqueo solo se ve como tooltip | Con la fase de reportes |
| 15 | El desglose por medio de pago del cierre es bruto de vuelto | Con la fase de reportes |
| 16 | `npm run lint` no está configurado | Cuando se arme la integración continua |
| 17 | El vendedor que topa con un precio sospechoso no sabe qué hacer | Con la fase 4, junto con el PIN del dueño |
| 18 | Inicio dice que sincronizó cuando el seed nunca sincronizó | Cualquier momento |
| 19 | «Sin ningún problema: 0%» en Calidad del catálogo | Cualquier momento |
| 20 | Un reintento idempotente informa vuelto $0 | Cualquier momento |
