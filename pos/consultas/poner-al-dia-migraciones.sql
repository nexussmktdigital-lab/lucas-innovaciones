-- Pone al dia la base de produccion del POS.
--
-- Aplica las migraciones 0019_canje a 0026_cambio_de_producto y las anota en el
-- registro de migraciones (drizzle.__drizzle_migrations), que es lo que quedo
-- atrasado: el esquema se fue arreglando a mano con SQL y el registro nunca se
-- escribio, asi que el POS cree que faltan migraciones.
--
-- Todo el script corre en UNA transaccion: si algo falla, no queda nada a medio
-- aplicar. Cada migracion es idempotente (IF NOT EXISTS / DROP CONSTRAINT IF
-- EXISTS), asi que lo que ya esta hecho se saltea solo.
--
-- Generado con consultas/generar-poner-al-dia.mjs. No editar a mano.

BEGIN;

CREATE SCHEMA IF NOT EXISTS "drizzle";

CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);


-- ===========================================================================
-- 0019_canje
-- ===========================================================================

-- Plan canje: el cliente paga parte de la compra con un teléfono usado.
--
-- Se vende un iPhone de US$ 1.000, se le recibe el suyo por US$ 600 y los
-- US$ 400 restantes entran por donde sea. Para el sistema son DOS hechos y por
-- eso hasta hoy no se podía registrar sin romper algo:
--
--  1. Un pago de US$ 600 que **no es plata**. Cierra la venta pero no entra a
--     ningún cajón. Cargarlo como efectivo deja el arqueo con seiscientos
--     dólares que no existen; cargarlo como cuenta corriente le inventa al
--     cliente una deuda que no tiene.
--  2. Una entrada de mercadería con costo US$ 600. Ese teléfono va a stock y
--     el día que se venda, el margen se calcula contra ese número.
--
-- El medio nuevo resuelve el 1. El 2 lo hace `confirmarVenta`, en la misma
-- transacción: el equipo se da de alta y se publica con la venta, o no pasa
-- ninguna de las dos cosas. Un alta sin venta sería stock que nadie entregó.

ALTER TYPE "medio_pago" ADD VALUE IF NOT EXISTS 'canje';




-- Los checks de abajo comparan `"medio"::text` y no `"medio"`, y es a
-- propósito: PostgreSQL **no deja usar un valor nuevo de enum hasta que la
-- transacción que lo creó se confirma** («unsafe use of new value»), y Drizzle
-- corre todas las migraciones pendientes en UNA transacción. Comparando el
-- texto no se usa el valor del enum y los checks se pueden crear acá mismo.
--
-- PGlite —la base de los tests— es más permisiva y dejaba pasar la versión sin
-- el casteo: esto apareció recién al correr las migraciones contra un
-- PostgreSQL de verdad, que es lo que hay en producción.




-- Qué equipo entró. Es la pieza que hace auditable el canje: sin esto, un pago
-- que no mueve plata ni deuda no deja rastro de a cambio de qué se dio.
ALTER TABLE "sale_payments"
  ADD COLUMN IF NOT EXISTS "producto_recibido_id" uuid REFERENCES "products"("id");




CREATE INDEX IF NOT EXISTS "sale_payments_recibido_idx"
  ON "sale_payments" ("producto_recibido_id");




-- Un canje tiene su equipo, y ningún otro medio tiene uno.
--
-- Es la guarda estructural del asunto: sin ella se puede grabar un canje de
-- US$ 600 contra nada —un descuento disfrazado que no deja ni plata ni
-- mercadería— y el agujero solo se ve al cerrar el mes.
ALTER TABLE "sale_payments" DROP CONSTRAINT IF EXISTS "sale_payments_canje_ck";




ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_canje_ck"
  CHECK (("medio"::text = 'canje') = ("producto_recibido_id" IS NOT NULL));




-- El canje también puede venir en dólares, y el check viejo no lo dejaba.
--
-- Decía: traen `monto_usd_centavos` y `cotizacion_centavos` exactamente los
-- pagos en dólares, y ninguno más. Un iPhone recibido contra una venta en
-- dólares vale US$ 600, no su equivalente en pesos de hoy, así que necesita
-- los mismos dos datos. Queda:
--
--  * `dolares`: los trae siempre. Sin ellos el cajón de dólares no se entera.
--  * `canje`: los trae o no los trae, según la moneda de la venta, pero
--    siempre los dos juntos: con uno solo no se puede reconstruir nada.
--  * el resto: no los trae nunca.
ALTER TABLE "sale_payments" DROP CONSTRAINT IF EXISTS "sale_payments_dolares_ck";




ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_dolares_ck"
  CHECK (
    CASE "medio"::text
      WHEN 'dolares' THEN "monto_usd_centavos" IS NOT NULL AND "cotizacion_centavos" IS NOT NULL
      WHEN 'canje'   THEN ("monto_usd_centavos" IS NULL) = ("cotizacion_centavos" IS NULL)
      ELSE "monto_usd_centavos" IS NULL AND "cotizacion_centavos" IS NULL
    END
  );


-- Anota 0019_canje como aplicada.
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT '3209650352bb2a73e9d6e66147b4411d340241686df87da3ecee3450417e9673', 1789495144195
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE created_at = 1789495144195
);


-- ===========================================================================
-- 0020_gastos_en_dolares_y_cheque
-- ===========================================================================

-- Gastos en dólares, y los datos del cheque con el que se pagó.
--
-- **Dólares.** Los pagos a proveedores de iPhone se hacen en dólares, y hasta
-- hoy había que convertirlos a mano antes de cargarlos: el gasto quedaba en
-- pesos a la cotización que quien cargaba recordara, y seis meses después no
-- había forma de saber cuántos dólares habían salido de verdad.
--
-- Las columnas `moneda` y `tc_aplicado_centavos` ya existían en la tabla desde
-- el principio y **ningún código las usaba**: estaban previstas y nunca
-- cableadas. Falta la tercera, que es la que hace que el dato sirva.
--
-- `monto_centavos` sigue siendo SIEMPRE pesos, como en `sale_payments`: es lo
-- que suman los reportes y el resumen del mes, y guardar dólares ahí haría que
-- el total del mes sumara dos monedas. Los pesos de un gasto en dólares se
-- congelan con la cotización del día —`tc_aplicado_centavos`— y no se
-- recalculan nunca: un gasto de marzo no cambia de monto porque hoy el dólar
-- esté a otro precio.
ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "monto_usd_centavos" bigint;




-- Un gasto en dólares trae los dólares y su cotización, y ninguno más los
-- trae. Sin los dos juntos el dato no se puede reconstruir: con los dólares
-- solos no se sabe a cuánto se pagó, y con la cotización sola no se sabe
-- cuántos dólares fueron.
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_dolares_ck";




ALTER TABLE "expenses" ADD CONSTRAINT "expenses_dolares_ck"
  CHECK (
    ("moneda" = 'USD') =
    ("monto_usd_centavos" IS NOT NULL AND "tc_aplicado_centavos" IS NOT NULL)
  );




ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_monto_usd_ck";




ALTER TABLE "expenses" ADD CONSTRAINT "expenses_monto_usd_ck"
  CHECK ("monto_usd_centavos" IS NULL OR "monto_usd_centavos" > 0);




-- **Cheque.** El local paga a proveedores endosando cheques que recibió de
-- clientes. Lo que hace falta anotar es el número y de quién vino: a quién se
-- le pagó ya está en `payee_id`, así que ese dato no agrega nada.
--
-- Van como texto libre y no como referencia a un cliente: el cheque puede
-- venir de alguien que no está en la base, y frenar la carga de un gasto para
-- dar de alta un cliente que no compró nada sería un trámite sin sentido.
ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "cheque_numero" text;




ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "cheque_recibido_de" text;




-- Los datos del cheque solo cuelgan de un pago con cheque.
--
-- No se exigen —el número puede no estar a mano cuando se carga— pero no
-- pueden quedar colgados de una transferencia: ahí no significan nada y el
-- día que alguien los lea van a mentir. `'cheque'` es un valor que el enum
-- tiene desde el principio, así que se lo puede nombrar sin castear.
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_cheque_ck";




ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cheque_ck"
  CHECK (
    ("cheque_numero" IS NULL AND "cheque_recibido_de" IS NULL)
    OR "medio" = 'cheque'
  );


-- Anota 0020_gastos_en_dolares_y_cheque como aplicada.
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT 'df4f25442c8a88d8bd29ffa9d685001c01096346fdb9143a7f8736c7cb423a16', 1789495144196
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE created_at = 1789495144196
);


-- ===========================================================================
-- 0021_recargos
-- ===========================================================================

-- Recargos: lo que se cobra de más, y por qué.
--
-- Son tres casos distintos que el local cobra todos los días y que hasta hoy
-- se resolvían subiendo el precio a mano, sin que quedara dicho en ningún lado
-- que ese número no era el precio del producto:
--
--  1. **Pagar con cheque** tiene un costo y el local lo cobra. Sube lo que se
--     factura: el cliente paga más por la misma mercadería.
--  2. **Fiar «cuando pueda»** —sin fechas— también se cobra. No sube la venta,
--     sube la deuda, igual que el recargo de un plan de cuotas.
--  3. **Pagar una cuota con cheque, o pagarla tarde.** No baja más la deuda
--     por eso: es plata aparte que entra a la caja.
--
-- En los tres se guarda **el monto**, no el porcentaje con el que se calculó:
-- el porcentaje es una forma de escribirlo y el monto es el hecho. Guardar el
-- porcentaje obligaría a recalcular para leer un papel viejo, y el día que
-- alguien cambie el redondeo, los comprobantes firmados dejarían de coincidir
-- con lo que el sistema dice.

-- **Caso 1: el cheque en una venta.**
--
-- Suma al total, así que `total = subtotal − descuento + recargo`. Tiene que
-- sumar ahí y no quedar aparte: los pagos de una venta suman exactamente su
-- total, y un cheque escrito por más que el total se leería como vuelto.
ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "recargo_centavos" bigint DEFAULT 0 NOT NULL;




ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_recargo_ck";




ALTER TABLE "sales" ADD CONSTRAINT "sales_recargo_ck"
  CHECK ("recargo_centavos" >= 0);




-- **Caso 2: el recargo por fiar.**
--
-- No suma al total de la venta —el comprobante del cliente lleva el precio del
-- producto y nada de la deuda— y por eso va en su propia columna y no en la de
-- arriba. Suma a lo que el cliente queda debiendo.
--
-- Cuando se pactó un plan de cuotas, el mismo número vive además en
-- `credit_plans.recargo_centavos`, que es de donde salen las cuotas. Acá se
-- guarda igual para que el acuerdo de pago de un fiado SIN plan —el «cuando
-- pueda», que no tiene fila en `credit_plans`— se pueda reimprimir con el
-- desglose que el cliente firmó, y no solo con el total.
ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "recargo_financiacion_centavos" bigint DEFAULT 0 NOT NULL;




ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_recargo_financiacion_ck";




ALTER TABLE "sales" ADD CONSTRAINT "sales_recargo_financiacion_ck"
  CHECK ("recargo_financiacion_centavos" >= 0);




-- **Caso 3: el recargo al cobrar una cuota.**
--
-- Va en la moneda de la deuda, igual que `monto_centavos`: una cuota en
-- dólares con recargo se negocia en dólares. Lo que entra a la caja son los
-- dos juntos, convertidos de la misma forma.
--
-- **No baja la deuda.** El cliente entrega monto + recargo y la cuenta baja
-- solo por el monto: si el recargo descontara deuda no sería un recargo, sería
-- un descuento sobre el pago.
ALTER TABLE "credit_payments"
  ADD COLUMN IF NOT EXISTS "recargo_centavos" bigint DEFAULT 0 NOT NULL;




-- Por qué se cobró. Texto con CHECK y no un enum nuevo: un valor de enum
-- recién creado no se puede nombrar en la misma transacción que lo creó, y
-- todas las migraciones pendientes corren juntas en una.
ALTER TABLE "credit_payments"
  ADD COLUMN IF NOT EXISTS "recargo_motivo" text;




ALTER TABLE "credit_payments" DROP CONSTRAINT IF EXISTS "credit_payments_recargo_ck";




-- Hay recargo si y solo si hay motivo. Un recargo sin motivo es un número que
-- dentro de seis meses nadie puede explicarle al cliente que lo reclama, y un
-- motivo sin recargo es un campo que quedó de un intento anterior.
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_recargo_ck"
  CHECK (
    ("recargo_centavos" > 0) = ("recargo_motivo" IS NOT NULL)
    AND "recargo_centavos" >= 0
    AND ("recargo_motivo" IS NULL OR "recargo_motivo" IN ('cheque', 'demora', 'otro'))
  );


-- Anota 0021_recargos como aplicada.
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT '52564114c23069e139ab226d3aaae424da59c7c60621d3008b4959eb4603cfe9', 1789495144197
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE created_at = 1789495144197
);


-- ===========================================================================
-- 0022_libreta_con_pagos
-- ===========================================================================

-- Los pagos que ya estaban hechos cuando el cliente entró al sistema.
--
-- Un cliente que venía de la libreta trae meses de entregas. Hasta ahora solo
-- se podía cargar su saldo: las entregas se perdían, y con ellas la respuesta
-- a «¿cuándo pagó la última vez?», que es la pregunta que se hace cuando hay
-- que reclamarle.
--
-- Se marcan porque no son plata que entró por la caja de hoy: ocurrieron antes
-- y fuera del sistema. Sin la marca, el reporte del mes en que cayeron las
-- contaría como ingresos que ninguna sesión de caja respalda.
--
-- Va con `IF NOT EXISTS`, como el resto de las migraciones del repo, y no es
-- cosmético: cuando una migración no llega a correr en el despliegue hay que
-- aplicarla a mano, y entonces la próxima corrida del migrador la encuentra
-- ya hecha. Sin la guarda, esa corrida falla y, como todas las pendientes van
-- en una sola transacción, se lleva puestas también a las que vengan después.
ALTER TABLE "credit_payments"
  ADD COLUMN IF NOT EXISTS "migrado" boolean DEFAULT false NOT NULL;




ALTER TABLE "credit_payments" DROP CONSTRAINT IF EXISTS "credit_payments_migrado_ck";




-- Un pago migrado no pasó por la caja; uno de verdad, sí.
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_migrado_ck"
  CHECK (NOT "migrado" OR ("cash_session_id" IS NULL AND "monetary_account_id" IS NULL));


-- Anota 0022_libreta_con_pagos como aplicada.
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT '3437e08429f3bb589606fd21a8f90d166db458a307c557c8aaab5838b0a6c5f4', 1793000000000
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE created_at = 1793000000000
);


-- ===========================================================================
-- 0023_compras_de_la_libreta
-- ===========================================================================

-- Las compras que el cliente hizo antes de entrar al sistema.
--
-- Un cliente de cuenta corriente que viene de la libreta trae meses de
-- mercadería anotada en un cuaderno. Hasta ahora solo entraba como un número
-- —el saldo—, y lo que el local quiere ver es qué se llevó y cuándo.
--
-- **Por qué no son ventas.** Una venta descuenta stock y entra en la
-- facturación del mes. Esta mercadería salió del local hace meses: el stock ya
-- se descontó entonces (o nunca se llevó en el sistema), y facturarla ahora
-- pondría medio millón de pesos en el mes equivocado. Además sus renglones son
-- texto del cuaderno, no fichas del catálogo: «1 x vaso un poco de ruido» no
-- tiene SKU ni precio de lista, y nunca lo va a tener.
--
-- Entonces es lo que es: un cargo a la cuenta, con su fecha y su detalle, que
-- no toca ninguna otra cosa del sistema. Los reportes de plata leen `sales`
-- y `credit_payments`, así que esta tabla les es invisible por construcción,
-- que es exactamente lo que se busca.
CREATE TABLE IF NOT EXISTS "credit_charges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "credit_account_id" uuid NOT NULL,
  "fecha" timestamp with time zone DEFAULT now() NOT NULL,
  "descripcion" text NOT NULL,
  -- Los renglones del cuaderno, tal como estaban escritos, uno por línea.
  "detalle" text,
  "monto_centavos" bigint NOT NULL,
  -- El saldo que quedaba ese día. Congelado, igual que en los pagos: sirve
  -- para leer la cuenta como se leía entonces.
  "saldo_resultante_centavos" bigint NOT NULL,
  -- True cuando la fecha se dedujo y no estaba escrita: los bloques del final
  -- del cuaderno no tienen ninguna entrega debajo de donde sacarla. Se marca
  -- para poder decirlo en la pantalla en vez de hacerla pasar por exacta.
  "fecha_estimada" boolean DEFAULT false NOT NULL,
  "cargado_por_id" uuid NOT NULL,
  "nota" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);




ALTER TABLE "credit_charges" DROP CONSTRAINT IF EXISTS "credit_charges_cuenta_fk";




ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_cuenta_fk"
  FOREIGN KEY ("credit_account_id") REFERENCES "credit_accounts"("id");




ALTER TABLE "credit_charges" DROP CONSTRAINT IF EXISTS "credit_charges_usuario_fk";




ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_usuario_fk"
  FOREIGN KEY ("cargado_por_id") REFERENCES "users"("id");




ALTER TABLE "credit_charges" DROP CONSTRAINT IF EXISTS "credit_charges_monto_ck";




-- Un cargo en cero no es una compra, es un renglón que se leyó mal.
--
-- Decía `> 0`, que era cierto cuando el único cargo era una compra de la
-- libreta. La 0024 lo relajó a `<> 0` al aparecer la mercadería devuelta, y
-- la 0025 agregó la quita del recargo: hoy hay cargos negativos en la base.
--
-- Se escribe acá el estado final y no el histórico, a propósito: con `> 0`
-- esta migración no se puede volver a correr sobre una base que ya tiene
-- negativos —rebota contra sus propios datos— y una migración que no se puede
-- replicar deja la base imposible de reconstruir desde cero. El esquema que
-- queda al final de la cadena es exactamente el mismo.
ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_monto_ck"
  CHECK ("monto_centavos" <> 0);




CREATE INDEX IF NOT EXISTS "credit_charges_cuenta_idx"
  ON "credit_charges" ("credit_account_id");


-- Anota 0023_compras_de_la_libreta como aplicada.
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT 'd978491279cbb4222751f9c162c26f7cb58d28aa78db18f10b480fe6ea13afe8', 1793200000000
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE created_at = 1793200000000
);


-- ===========================================================================
-- 0024_mercaderia_devuelta
-- ===========================================================================

-- Mercadería que el cliente devuelve.
--
-- Es el espejo de la compra: entró a la cuenta como cargo, vuelve como crédito.
-- Un cargo negativo, entonces, y no una tabla nueva: es el mismo hecho
-- —mercadería que cruza el mostrador y mueve la deuda— con el signo al revés,
-- y partirlo en dos tablas obligaría a leer las dos para saber cuánto debe.
--
-- **No es un pago.** No entró plata: entraron cosas. Registrarlo como pago
-- pondría en el reporte del mes un ingreso que ninguna caja respalda, que es
-- el mismo error del que se cuidan las entregas migradas de la libreta.
--
-- El cero sigue prohibido: un renglón en cero no es una devolución, es un
-- importe que no se cargó.
ALTER TABLE "credit_charges" DROP CONSTRAINT IF EXISTS "credit_charges_monto_ck";




ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_monto_ck"
  CHECK ("monto_centavos" <> 0);


-- Anota 0024_mercaderia_devuelta como aplicada.
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT '2065bccfc0d514c3e7e76aa5c1ed93aaeaa4830899e99711aae0f5627b088a86', 1795000000000
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE created_at = 1795000000000
);


-- ===========================================================================
-- 0025_quita_del_recargo
-- ===========================================================================

-- El recargo por financiar que se le saca al que paga antes.
--
-- El caso que lo pidió: un cliente se llevó un teléfono en dos cuotas, con su
-- recargo por financiar, y a los dos días pagó todo junto. El recargo ya no
-- corresponde —no financió nada— pero la deuda lo seguía incluyendo, así que
-- después de pagar el precio de contado le quedaba debiendo exactamente el
-- recargo.
--
-- Se anota en la venta y no en una tabla aparte porque es un dato DE esa
-- venta: cuánto de su recargo se perdonó. Tenerlo acá es lo que permite
-- ofrecer la quita una sola vez y por lo que de verdad queda.
ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "recargo_quitado_centavos" bigint DEFAULT 0 NOT NULL;




-- No se puede perdonar menos que nada ni más de lo que se cobró de recargo.
ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_recargo_quitado_ck";




ALTER TABLE "sales" ADD CONSTRAINT "sales_recargo_quitado_ck"
  CHECK ("recargo_quitado_centavos" >= 0
         AND "recargo_quitado_centavos" <= "recargo_financiacion_centavos");




-- En qué moneda está el cargo.
--
-- Hasta acá todos los cargos eran en pesos —la libreta de papel y la
-- mercadería devuelta— y la columna no hacía falta. La quita del recargo sí:
-- lo que se vende en dólares se debe en dólares (D62), y un teléfono
-- financiado en dólares tiene su recargo en dólares. Sin esto, perdonarle
-- US$ 40 descontaría cuarenta pesos de la deuda equivocada.
--
-- El default deja en pesos todo lo que ya está cargado, que es lo que son.
ALTER TABLE "credit_charges"
  ADD COLUMN IF NOT EXISTS "moneda" "moneda" DEFAULT 'ARS' NOT NULL;




-- Qué es cada cargo, dicho y no deducido del signo.
--
-- La tabla ya guarda tres hechos distintos: la compra de la libreta de papel,
-- la mercadería que el cliente devuelve y ahora el recargo que se le perdona.
-- Hasta acá se distinguían por el signo del monto, y eso alcanzaba mientras
-- hubo dos. Con tres, el negativo dejó de significar una sola cosa: la ficha
-- mostraba la quita del recargo con un «Ver qué devolvió» debajo.
--
-- El signo sigue siendo el que manda sobre la deuda; esto dice de qué se trata.
ALTER TABLE "credit_charges"
  ADD COLUMN IF NOT EXISTS "tipo" text DEFAULT 'compra' NOT NULL;




-- Lo ya cargado: positivo es compra, negativo es mercadería devuelta, que es
-- lo único negativo que existía antes de esta migración.
UPDATE "credit_charges" SET "tipo" = 'devolucion'
  WHERE "monto_centavos" < 0 AND "tipo" = 'compra';




ALTER TABLE "credit_charges" DROP CONSTRAINT IF EXISTS "credit_charges_tipo_ck";




-- El tipo y el signo no pueden contradecirse: una compra suma, lo demás resta.
ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_tipo_ck"
  CHECK (("tipo" = 'compra' AND "monto_centavos" > 0)
      OR ("tipo" IN ('devolucion', 'quita_recargo') AND "monto_centavos" < 0));


-- Anota 0025_quita_del_recargo como aplicada.
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT 'ed73e930acf97e960f0c2e94d5502cf2f9dbc56d879cb24f8762f970e2fd3ed9', 1795600000000
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE created_at = 1795600000000
);


-- ===========================================================================
-- 0026_cambio_de_producto
-- ===========================================================================

-- El cliente cambia un producto por otro.
--
-- Pasa todas las semanas en el mostrador: se lleva el derivador equivocado y
-- vuelve a los dos días a cambiarlo por el que iba. Hasta acá eran dos
-- operaciones sueltas —devolver y volver a vender— y nada las ataba: si alguien
-- hacía la primera y se olvidaba de la segunda, el stock y la plata quedaban
-- mal y no había dónde verlo.
--
-- El cambio es UN hecho y se registra como tal. Adentro siguen siendo las dos
-- mitades de siempre, porque son las correctas: la devolución devuelve lo que
-- vino y la venta nueva registra lo que se llevó, así el reporte por producto
-- dice la verdad sobre los dos. Lo que cambia es que ahora van juntas, en una
-- transacción, y la plata se mueve UNA sola vez: por la diferencia.

-- Lo que la devolución no devolvió en plata ni descontó de la deuda, porque se
-- fue en mercadería. El total de una devolución es la suma de los tres.
ALTER TABLE "returns"
  ADD COLUMN IF NOT EXISTS "a_cambio_centavos" bigint DEFAULT 0 NOT NULL;




-- El medio de pago del cambio: paga con lo que trajo.
--
-- No mueve ninguna cuenta, igual que el canje y que la cuenta corriente.
-- Cargarlo como efectivo dejaría el cajón con una plata que nadie entregó.
ALTER TYPE "medio_pago" ADD VALUE IF NOT EXISTS 'cambio';




-- De qué devolución sale ese pago.
--
-- Es la guarda del asunto, la misma idea que `sale_payments_canje_ck`: sin
-- esto se puede grabar un pago «en cambio» contra nada, que es un descuento
-- disfrazado que no deja ni plata ni mercadería, y el agujero recién se ve al
-- cerrar el mes.
ALTER TABLE "sale_payments"
  ADD COLUMN IF NOT EXISTS "return_id" uuid REFERENCES "returns"("id");




ALTER TABLE "sale_payments" DROP CONSTRAINT IF EXISTS "sale_payments_cambio_ck";




-- Compara `medio::text` y no `medio` por lo mismo que el check del canje:
-- PostgreSQL no deja usar un valor nuevo de enum hasta que se confirma la
-- transacción que lo creó, y las migraciones corren todas juntas en una.
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_cambio_ck"
  CHECK (("medio"::text = 'cambio') = ("return_id" IS NOT NULL));




CREATE INDEX IF NOT EXISTS "sale_payments_return_idx" ON "sale_payments" ("return_id");





-- La invariante de la devolución, con el tercer destino.
--
-- Era `devuelto + descontado_de_deuda = total`, y la base la hizo respetar:
-- el primer cambio de producto rebotó contra ella. Ahora lo devuelto puede
-- irse por tres caminos —el cajón, la deuda del cliente, o la mercadería que
-- se lleva— y los tres tienen que sumar exactamente lo que valía.
ALTER TABLE "returns" DROP CONSTRAINT IF EXISTS "returns_suma_ck";




ALTER TABLE "returns" ADD CONSTRAINT "returns_suma_ck"
  CHECK ("devuelto_centavos" + "descontado_de_deuda_centavos" + "a_cambio_centavos"
         = "total_centavos");




ALTER TABLE "returns" DROP CONSTRAINT IF EXISTS "returns_partes_ck";




ALTER TABLE "returns" ADD CONSTRAINT "returns_partes_ck"
  CHECK ("devuelto_centavos" >= 0
     AND "descontado_de_deuda_centavos" >= 0
     AND "a_cambio_centavos" >= 0);


-- Anota 0026_cambio_de_producto como aplicada.
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT '22d40832ad5219bd7c883c85065d399f0740ad2b1cec427c1a2af9a5256d2074', 1796200000000
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE created_at = 1796200000000
);


COMMIT;

-- Control: tiene que decir 1796200000000 o mas.
SELECT max(created_at) AS ultima_migracion_registrada,
       count(*)       AS migraciones_registradas
FROM "drizzle"."__drizzle_migrations";
