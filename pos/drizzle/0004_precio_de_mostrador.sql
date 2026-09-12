ALTER TABLE "products" ADD COLUMN "solo_mostrador" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "precio_local_centavos" bigint;--> statement-breakpoint
-- Los servicios y los chips ya cargados no se publican en la tienda: su precio
-- es el de mostrador y no hay que descontarle el recargo de la tienda online.
-- La proxima corrida de `npm run woo:sync` recalcula la marca para todo el
-- catalogo, incluida la categoria «Solo mostrador» (D19).
UPDATE products SET solo_mostrador = true WHERE es_servicio;
