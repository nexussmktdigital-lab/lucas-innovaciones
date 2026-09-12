ALTER TABLE "product_variants" ADD COLUMN "gestiona_stock" boolean DEFAULT false NOT NULL;
-- Las variaciones ya sincronizadas quedan en `false`, que es lo correcto para
-- los vidrios y las fundas (en Woo vienen con `manage_stock: "parent"`). La
-- proxima corrida de `npm run woo:sync` escribe el valor real de cada una.
