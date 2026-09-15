/**
 * Chequeos de configuracion para salir a producción.
 *
 * Tres cosas se configuran fuera del repositorio —en Neon, en WooCommerce y en
 * Vercel— y ninguna falla de forma ruidosa cuando falta: el drenaje programado
 * simplemente no corre, y apuntarle a la tienda equivocada simplemente escribe
 * el stock en el lugar equivocado. Un sistema que se rompe en silencio es peor
 * que uno que se rompe.
 *
 * Aca se las nombra, se dice que pasa si faltan y como se arreglan. Se leen
 * desde dos lados: `npm run produccion:chequear` antes de desplegar, y la
 * pantalla de estado del POS, que las reclama si quedaron mal.
 *
 * Nada de esto lee un secreto: solo mira si estan y a donde apuntan.
 */

export type Gravedad = 'ok' | 'aviso' | 'falta';

export interface Chequeo {
  clave: string;
  titulo: string;
  gravedad: Gravedad;
  /** Qué está pasando, en castellano y sin jerga. */
  detalle: string;
  /** Qué hay que hacer. Solo cuando hay algo que hacer. */
  arreglo?: string;
}

export type Entorno = 'produccion' | 'desarrollo';

/** A qué tienda le está hablando el POS. */
export type DestinoWoo = 'produccion' | 'staging' | 'local' | 'sin_configurar';

/**
 * Producción es el despliegue que usa el mostrador.
 *
 * `VERCEL_ENV` distingue el despliegue de producción de los de vista previa,
 * que tambien corren con `NODE_ENV=production`.
 */
export function entornoActual(env: NodeJS.ProcessEnv = process.env): Entorno {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === 'production' ? 'produccion' : 'desarrollo';
  return env.NODE_ENV === 'production' ? 'produccion' : 'desarrollo';
}

/**
 * A donde apunta Woo, escrito para leer.
 *
 * Lleva la ruta y no solo el host porque el staging de este hosting vive en
 * `.../staging`: diciendo solo el dominio, «apunta a lucasinnovaciones.com.ar,
 * que es la tienda de pruebas» se lee como un error del sistema.
 *
 * Una URL mal escrita no tumba nada: es justamente una de las cosas que hay
 * que poder reportar.
 */
export function dondeApuntaWoo(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const partes = new URL(url);
    const ruta = partes.pathname.replace(/\/+$/, '');
    return `${partes.host}${ruta}`;
  } catch {
    return null;
  }
}

/**
 * Distingue la tienda de verdad de la de pruebas.
 *
 * El staging de este hosting vive en `.../staging`, pero se contemplan tambien
 * las formas habituales por subdominio para que no haya que tocar esto si el
 * staging se muda.
 */
export function destinoDeWoo(url: string | undefined): DestinoWoo {
  if (!url) return 'sin_configurar';

  let partes: URL;
  try {
    partes = new URL(url);
  } catch {
    return 'sin_configurar';
  }

  const host = partes.host.toLowerCase();
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return 'local';

  const esDePrueba =
    /(^|[.-])(staging|stg|dev|test|pruebas)([.-]|$)/.test(host) ||
    /(^|\/)(staging|dev|test|pruebas)(\/|$)/.test(partes.pathname.toLowerCase());

  return esDePrueba ? 'staging' : 'produccion';
}

/**
 * El estado de las tres cosas que se configuran fuera del código.
 *
 * El significado de cada una cambia con el entorno: que falte `CRON_SECRET` en
 * la máquina de desarrollo no es un problema —no hay cron—, y apuntarle a la
 * tienda de verdad desde desarrollo sí lo es.
 */
export function chequearProduccion(env: NodeJS.ProcessEnv = process.env): Chequeo[] {
  const entorno = entornoActual(env);
  const enProduccion = entorno === 'produccion';
  const destino = destinoDeWoo(env.WOO_URL);
  const donde = dondeApuntaWoo(env.WOO_URL);

  const chequeos: Chequeo[] = [];

  /* 1. El drenaje programado de la cola. -------------------------------- */
  if (env.CRON_SECRET) {
    chequeos.push({
      clave: 'cron',
      titulo: 'Drenaje programado de la cola',
      gravedad: 'ok',
      detalle: 'CRON_SECRET está configurado: la cola se vacía sola cada diez minutos.',
    });
  } else if (enProduccion) {
    chequeos.push({
      clave: 'cron',
      titulo: 'Drenaje programado de la cola',
      gravedad: 'falta',
      detalle:
        'Falta CRON_SECRET. La cola hacia WooCommerce solo se mueve al confirmar una venta: ' +
        'si la tienda se cae después de la última venta del día, el stock queda desactualizado ' +
        'hasta la primera venta del día siguiente.',
      arreglo:
        'Generar el secreto con `openssl rand -base64 32` y cargarlo como CRON_SECRET en las ' +
        'variables de entorno de Vercel, para el entorno de producción. Después, redesplegar.',
    });
  } else {
    chequeos.push({
      clave: 'cron',
      titulo: 'Drenaje programado de la cola',
      gravedad: 'ok',
      detalle: 'En desarrollo no hace falta: no hay tarea programada corriendo.',
    });
  }

  /* 2. A qué tienda le habla el POS. ------------------------------------ */
  if (destino === 'sin_configurar') {
    chequeos.push({
      clave: 'woo_destino',
      titulo: 'Tienda de WooCommerce',
      gravedad: enProduccion ? 'falta' : 'aviso',
      detalle: 'WOO_URL no está configurada o no es una URL válida.',
      arreglo: 'Cargar WOO_URL con la dirección completa de la tienda, incluido https://',
    });
  } else if (enProduccion && destino !== 'produccion') {
    chequeos.push({
      clave: 'woo_destino',
      titulo: 'Tienda de WooCommerce',
      gravedad: 'falta',
      detalle:
        `El POS de producción le está hablando a ${donde}, que es la tienda de pruebas. ` +
        'La tienda de verdad no se está actualizando con las ventas del mostrador.',
      arreglo: 'Apuntar WOO_URL a la tienda de producción y redesplegar.',
    });
  } else if (!enProduccion && destino === 'produccion') {
    chequeos.push({
      clave: 'woo_destino',
      titulo: 'Tienda de WooCommerce',
      gravedad: 'aviso',
      detalle:
        `Esta máquina de desarrollo le está escribiendo el stock a ${donde}, que es la tienda ` +
        'de verdad. Una venta de prueba le descuenta stock real al negocio.',
      arreglo:
        'Apuntar WOO_URL al staging y usar una clave generada ahí. La clave de producción, ' +
        'una vez que estuvo en una máquina de desarrollo, conviene rotarla.',
    });
  } else {
    chequeos.push({
      clave: 'woo_destino',
      titulo: 'Tienda de WooCommerce',
      gravedad: 'ok',
      detalle: `Apunta a ${donde} (${destino}), que es lo que corresponde en ${entorno}.`,
    });
  }

  /* 3. Las credenciales de la REST API. --------------------------------- */
  const hayClaves = Boolean(env.WOO_CONSUMER_KEY && env.WOO_CONSUMER_SECRET);
  chequeos.push(
    hayClaves
      ? {
          clave: 'woo_claves',
          titulo: 'Credenciales de la tienda',
          gravedad: 'ok',
          detalle: 'WOO_CONSUMER_KEY y WOO_CONSUMER_SECRET están cargadas.',
        }
      : {
          clave: 'woo_claves',
          titulo: 'Credenciales de la tienda',
          gravedad: enProduccion ? 'falta' : 'aviso',
          detalle:
            'Faltan WOO_CONSUMER_KEY o WOO_CONSUMER_SECRET. El POS no puede leer el catálogo ' +
            'ni empujar el stock; las ventas se registran igual y la cola espera.',
          arreglo:
            'Generar una clave de lectura/escritura en WooCommerce → Ajustes → Avanzado → ' +
            'REST API, sobre la tienda que corresponda a este entorno.',
        },
  );

  /* 4. La firma de los webhooks. ---------------------------------------- */
  chequeos.push(
    env.WOO_WEBHOOK_SECRET
      ? {
          clave: 'woo_webhook',
          titulo: 'Firma de los webhooks',
          gravedad: 'ok',
          detalle: 'WOO_WEBHOOK_SECRET está configurado: los avisos de la tienda se verifican.',
        }
      : {
          clave: 'woo_webhook',
          titulo: 'Firma de los webhooks',
          gravedad: enProduccion ? 'falta' : 'aviso',
          detalle:
            'Falta WOO_WEBHOOK_SECRET. La ruta de webhooks devuelve 503, así que los cambios ' +
            'hechos en la tienda no refrescan el espejo hasta el próximo `npm run woo:sync`.',
          arreglo:
            'Usar el mismo secreto que se cargó en cada webhook de WooCommerce → Ajustes → ' +
            'Avanzado → Webhooks.',
        },
  );

  return chequeos;
}

/** Lo que hay que arreglar, que es lo único que vale la pena mostrar. */
export function pendientes(chequeos: Chequeo[]): Chequeo[] {
  return chequeos.filter((c) => c.gravedad !== 'ok');
}
