/**
 * Ayuda para armar la ficha de un producto.
 *
 * Lo que se tipea en el mostrador no es una ficha: es «cable tipo c fox box
 * axon 20w». Sirve para vender, y no sirve para el catálogo. Esto lo convierte
 * en nombre, marca y categoría, mirando las categorías y marcas que el catálogo
 * **ya tiene**, y quien carga confirma o corrige antes de guardar.
 *
 * Cuatro límites, y los cuatro importan:
 *
 *  - **Nunca propone precio ni stock.** Un precio inventado se cobra. El precio
 *    lo sabe quien está atendiendo y lo escribe él.
 *  - **Nunca propone una foto** (D15). Una imagen inventada de un SKU real
 *    produce reclamos, devoluciones y contracargos.
 *  - **Elige entre las categorías que existen**, o devuelve nula. Inventar
 *    categorías es justo lo que esta fase vino a ordenar.
 *  - **Es opcional.** Sin `ANTHROPIC_API_KEY` el formulario funciona igual, a
 *    mano. Ninguna parte del POS depende de que esto ande.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { normalizar } from '@/lib/texto';

/** Modelo por defecto. Se puede cambiar por entorno sin tocar el código. */
export const MODELO_POR_DEFECTO = 'claude-opus-5';

/** Si tarda más que esto, el mostrador ya escribió la ficha a mano. */
export const TIMEOUT_MS = 12_000;

export class ErrorIA extends Error {}

/** True si hay credencial cargada. Sin esto, el alta va a mano y listo. */
export function hayIA(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

const fichaSugerida = z.object({
  nombre: z
    .string()
    .describe('Nombre comercial del producto, prolijo y sin anotaciones internas'),
  marca: z.string().nullable().describe('Marca, o null si no se puede saber'),
  categoria: z
    .string()
    .nullable()
    .describe('Una de las categorías existentes, exactamente como está escrita, o null'),
  esServicio: z.boolean().describe('True si es un servicio técnico y no mercadería'),
  confianza: z.enum(['alta', 'media', 'baja']).describe('Qué tan seguro está de la lectura'),
});

export type FichaSugerida = z.infer<typeof fichaSugerida>;

export interface OpcionesSugerencia {
  categorias: readonly string[];
  marcas: readonly string[];
  cliente?: Anthropic;
  modelo?: string;
}

const INSTRUCCIONES = `Sos el ayudante de carga de catálogo de Lucas Innovaciones, un local de
celulares y accesorios en Villa Santa Rosa, Córdoba, Argentina.

Alguien está atendiendo el mostrador y escribió, apurado, lo que tiene en la
mano. Tu trabajo es convertir eso en una ficha prolija.

Reglas:
- El nombre va en castellano rioplatense, con la marca y el modelo como los usa
  el rubro. Nada de mayúsculas de más ni texto publicitario.
- Sacá del nombre cualquier anotación interna del vendedor: precios de compra,
  nombres de clientes, márgenes, recordatorios. Eso no va en el catálogo.
- La categoría tiene que ser UNA de la lista que te paso, copiada tal cual. Si
  ninguna encaja de verdad, devolvé null. No inventes categorías nuevas.
- La marca, si la reconocés, preferí escribirla como ya figura en la lista de
  marcas del catálogo. Si no la reconocés, null.
- NO propongas precio ni stock: no los sabés y quien está atendiendo sí.
- Si lo que leés es un servicio técnico (una reparación, una limpieza, un
  cambio de pantalla) marcá esServicio en true.
- Si el texto es demasiado ambiguo, poné confianza en baja y devolvé lo poco
  que puedas sostener.`;

/**
 * Propone una ficha a partir de lo que se tipeó.
 *
 * Devuelve `null` si no hay credencial: es un estado normal, no un error. Los
 * errores de red o de la API sí se lanzan, para que la pantalla pueda decir que
 * la sugerencia no salió y seguir andando igual.
 */
export async function sugerirFicha(
  crudo: string,
  opciones: OpcionesSugerencia,
): Promise<FichaSugerida | null> {
  const texto = crudo.trim();
  if (texto === '') throw new ErrorIA('No hay nada que interpretar.');
  if (texto.length > 500) throw new ErrorIA('El texto es demasiado largo para una ficha.');
  if (!hayIA()) return null;

  const cliente =
    opciones.cliente ??
    new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });

  const respuesta = await cliente.messages.parse({
    model: opciones.modelo ?? process.env.ANTHROPIC_MODELO ?? MODELO_POR_DEFECTO,
    max_tokens: 1024,
    // Es una tarea corta y acotada: no hace falta gastar razonamiento en ella,
    // y el mostrador está esperando.
    output_config: { effort: 'low', format: zodOutputFormat(fichaSugerida) },
    system: INSTRUCCIONES,
    messages: [
      {
        role: 'user',
        content: [
          `Categorías del catálogo: ${opciones.categorias.join(' | ') || '(ninguna todavía)'}`,
          `Marcas del catálogo: ${opciones.marcas.join(' | ') || '(ninguna todavía)'}`,
          '',
          `Lo que se escribió: ${texto}`,
        ].join('\n'),
      },
    ],
  });

  const ficha = respuesta.parsed_output;
  if (!ficha) throw new ErrorIA('La sugerencia no vino en el formato esperado.');

  return acotarAlCatalogo(ficha, opciones);
}

/**
 * Obliga a que lo sugerido exista.
 *
 * Aunque las instrucciones digan que elija de la lista, el que decide es el
 * catálogo. Una categoría que no está en la lista se descarta; una marca que
 * está escrita distinto se reemplaza por la del catálogo, que es lo que evita
 * terminar con «Fox Box», «FoxBox» y «fox box» como tres marcas.
 */
export function acotarAlCatalogo(
  ficha: FichaSugerida,
  opciones: { categorias: readonly string[]; marcas: readonly string[] },
): FichaSugerida {
  const categoria = igualarA(ficha.categoria, opciones.categorias);
  const marca = igualarA(ficha.marca, opciones.marcas) ?? (ficha.marca?.trim() || null);

  return {
    ...ficha,
    nombre: ficha.nombre.trim().replace(/\s+/g, ' '),
    categoria,
    marca,
  };
}

/** Busca el valor en la lista comparando sin acentos ni mayúsculas. */
function igualarA(valor: string | null, lista: readonly string[]): string | null {
  const buscado = normalizar(valor ?? '');
  if (buscado === '') return null;
  return lista.find((x) => normalizar(x) === buscado) ?? null;
}
