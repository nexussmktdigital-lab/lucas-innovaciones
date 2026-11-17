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

--> statement-breakpoint

ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_monto_ck"
  CHECK ("monto_centavos" <> 0);
