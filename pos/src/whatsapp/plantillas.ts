/**
 * Plantillas de los mensajes de WhatsApp.
 *
 * El texto lo escribe el dueno, no el programador: es la voz del local. El
 * sistema pone los datos.
 *
 * **Como se manda, y por que asi.** El POS arma el mensaje y abre WhatsApp con
 * el texto ya escrito (`wa.me`); quien aprieta enviar es la persona. No hace
 * falta cuenta de Meta Business, ni plantillas aprobadas, ni pagar por
 * conversacion, y funciona hoy desde la MacBook con WhatsApp Web o de
 * escritorio. La contrapartida es que no es automatico y que el sistema no
 * puede saber si el mensaje se mando de verdad: por eso todo lo que se guarda
 * dice «preparado» y nunca «enviado».
 *
 * El dia que haga falta que salgan solos —recordatorios de madrugada, por
 * ejemplo— la pieza que cambia es una sola: como se entrega el texto. El texto,
 * a quien, cuando y con que control de repeticion ya esta resuelto aca.
 */

/** Placeholders que el dueno puede usar en cada plantilla. */
export const CAMPOS: Record<TipoDeMensaje, { campo: string; ejemplo: string; que: string }[]> = {
  comprobante: [
    { campo: 'cliente', ejemplo: 'Gaby', que: 'Nombre de pila del cliente' },
    { campo: 'local', ejemplo: 'Lucas Innovaciones', que: 'Nombre del local' },
    { campo: 'numero', ejemplo: 'T1-000123', que: 'Número del comprobante' },
    { campo: 'total', ejemplo: '$ 306.000,00', que: 'Total de la compra' },
    { campo: 'detalle', ejemplo: 'iPhone 11 64GB', que: 'Qué se llevó' },
    { campo: 'fecha', ejemplo: '12/09/2026', que: 'Fecha de la compra' },
    {
      campo: 'fiado',
      ejemplo: 'Quedaste debiendo $ 7.000,00 de esta compra.',
      que: 'Si se llevó algo fiado, lo dice. Si pagó todo, no sale nada',
    },
  ],
  recordatorio_fiado: [
    { campo: 'cliente', ejemplo: 'Gaby', que: 'Nombre de pila del cliente' },
    { campo: 'local', ejemplo: 'Lucas Innovaciones', que: 'Nombre del local' },
    { campo: 'deuda', ejemplo: '$ 45.000,00', que: 'Cuánto debe hoy' },
    { campo: 'desde', ejemplo: '12/09/2026', que: 'Fecha de su última actividad' },
  ],
  recordatorio_cuota: [
    { campo: 'cliente', ejemplo: 'Gaby', que: 'Nombre de pila del cliente' },
    { campo: 'local', ejemplo: 'Lucas Innovaciones', que: 'Nombre del local' },
    { campo: 'deuda', ejemplo: '$ 45.000,00', que: 'Cuánto debe en total' },
    { campo: 'cuota', ejemplo: '$ 15.000,00', que: 'Lo que falta de la próxima cuota' },
    { campo: 'vencimiento', ejemplo: '28/09/2026', que: 'Cuándo vence esa cuota' },
    { campo: 'cuando', ejemplo: 'en 5 días', que: '«hoy», «mañana» o «en 5 días»' },
    { campo: 'numero', ejemplo: '2 de 6', que: 'Qué cuota es, de cuántas' },
  ],
  recordatorio_atrasado: [
    { campo: 'cliente', ejemplo: 'Gaby', que: 'Nombre de pila del cliente' },
    { campo: 'local', ejemplo: 'Lucas Innovaciones', que: 'Nombre del local' },
    { campo: 'deuda', ejemplo: '$ 45.000,00', que: 'Cuánto debe en total' },
    { campo: 'vencido', ejemplo: '$ 15.000,00', que: 'Lo que está vencido y sin pagar' },
    { campo: 'atraso', ejemplo: '8 días', que: 'Hace cuánto venció la cuota más vieja' },
    { campo: 'vencimiento', ejemplo: '10/09/2026', que: 'Cuándo venció' },
  ],
};

export type TipoDeMensaje =
  | 'comprobante'
  | 'recordatorio_fiado'
  | 'recordatorio_cuota'
  | 'recordatorio_atrasado';

/**
 * Textos por defecto.
 *
 * Escritos como habla el mostrador, no como escribe un banco. El recordatorio
 * arranca preguntando y no reclamando: el cliente que debe $5.000 y vive a tres
 * cuadras vuelve a comprar si el mensaje no lo incomoda.
 */
export const PLANTILLAS_POR_DEFECTO: Record<TipoDeMensaje, string> = {
  comprobante:
    'Hola {cliente}! Gracias por tu compra en {local} 🙌\n\n' +
    'Comprobante {numero} del {fecha}\n' +
    '{detalle}\n' +
    'Total: {total}\n' +
    '{fiado}\n\n' +
    'Cualquier cosa escribinos por acá.',
  recordatorio_fiado:
    'Hola {cliente}, ¿cómo andás? Te escribo de {local}.\n\n' +
    'Te queda un saldo de {deuda} en la cuenta. ' +
    'Cuando puedas te acercás y lo arreglamos, no hay apuro.\n\n' +
    '¡Gracias!',
  /*
   * El que está al día no tiene que leer un reclamo. Este mensaje avisa, que es
   * otra cosa: el cliente que sabe cuándo vence su cuota es el que la paga.
   */
  recordatorio_cuota:
    'Hola {cliente}, ¿cómo va? Te escribo de {local} 🙌\n\n' +
    'Te recuerdo que la cuota {numero} de {cuota} vence {cuando} ({vencimiento}).\n' +
    'Te esperamos por el local cuando quieras.\n\n' +
    '¡Gracias!',
  /*
   * Y el que se atrasó tampoco tiene que leer una carta documento. Dice el
   * número y la fecha —que es lo que el cliente muchas veces no tiene presente—
   * y deja la puerta abierta, porque el que se incomoda no vuelve a comprar.
   */
  recordatorio_atrasado:
    'Hola {cliente}, ¿cómo estás? Te escribo de {local}.\n\n' +
    'Se te pasó la cuota de {vencido} que vencía el {vencimiento} ({atraso}).\n' +
    'Si podés acercate esta semana y lo ponemos al día. ' +
    'Cualquier cosa, escribime y lo vemos.\n\n' +
    '¡Gracias!',
};

export const LARGO_MAXIMO = 1500;

/**
 * Cuantos renglones de detalle entran antes de resumir.
 *
 * No es capricho: el texto viaja dentro de la URL de `wa.me` y algunos clientes
 * de WhatsApp truncan pasados los 2.000 caracteres. Una venta de doce
 * accesorios es rara pero existe, y es justo la que llegaria cortada.
 */
export const RENGLONES_MAXIMOS = 12;

/** Recorta un detalle largo dejando dicho cuantos productos quedaron afuera. */
export function acortarDetalle(detalle: string, maximo = RENGLONES_MAXIMOS): string {
  const renglones = detalle.split('\n').filter((r) => r.trim().length > 0);
  if (renglones.length <= maximo) return detalle;

  const sobran = renglones.length - maximo;
  return [
    ...renglones.slice(0, maximo),
    `y ${sobran} ${sobran === 1 ? 'producto más' : 'productos más'}`,
  ].join('\n');
}

export class ErrorPlantilla extends Error {}

const PLACEHOLDER = /\{([a-zA-Z_]+)\}/g;

/** Los campos que usa una plantilla, en orden de aparicion y sin repetir. */
export function camposUsados(plantilla: string): string[] {
  return [...new Set([...plantilla.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
}

/**
 * Comprueba que la plantilla no use campos que no existen.
 *
 * Un `{clientee}` mal escrito no se ve hasta que el mensaje sale con la llave
 * puesta y el cliente lee «Hola {clientee}». Se avisa al guardar, no al mandar.
 */
export function validarPlantilla(tipo: TipoDeMensaje, plantilla: string): void {
  const texto = plantilla.trim();
  if (texto.length === 0) throw new ErrorPlantilla('El mensaje no puede quedar vacío.');
  if (texto.length > LARGO_MAXIMO) {
    throw new ErrorPlantilla(
      `El mensaje es muy largo: ${texto.length} caracteres, y el tope es ${LARGO_MAXIMO}.`,
    );
  }

  const validos = new Set(CAMPOS[tipo].map((c) => c.campo));
  const desconocidos = camposUsados(texto).filter((c) => !validos.has(c));

  if (desconocidos.length > 0) {
    throw new ErrorPlantilla(
      `${desconocidos.map((c) => `{${c}}`).join(', ')} no ${desconocidos.length === 1 ? 'es un campo' : 'son campos'} que el sistema sepa completar. ` +
        `Los que hay son: ${[...validos].map((c) => `{${c}}`).join(', ')}.`,
    );
  }
}

/**
 * Reemplaza los campos por sus valores.
 *
 * Un campo sin valor se borra en vez de quedar como `{cliente}` en el mensaje:
 * es preferible «Hola!» a «Hola {cliente}!».
 */
export function renderizar(plantilla: string, datos: Record<string, string | null>): string {
  return (
    plantilla
      .replace(PLACEHOLDER, (original, campo: string) => {
        const valor = datos[campo];
        if (valor === undefined) return original;
        return valor ?? '';
      })
      // Al borrar un campo vacío pueden quedar espacios dobles y renglones sueltos.
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** El nombre de pila, que es como se saluda en el mostrador. */
export function nombreDePila(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? nombre;
}
