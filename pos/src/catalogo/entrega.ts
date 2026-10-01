/**
 * Una entrega de mercadería, de la lista pegada al catálogo.
 *
 * `lista.ts` lee el texto; esto decide qué significa cada renglón contra el
 * catálogo de verdad y lo aplica. Son tres cosas distintas y conviene que se
 * vean distintas en la pantalla:
 *
 *  - **Alta**: el producto no está, y el renglón trae precio.
 *  - **Stock**: el producto está, y lo que hay que hacer es sumarle unidades.
 *  - **Baja**: el `(eliminar)` de la lista.
 *
 * **Por qué el nombre tiene que coincidir exacto.** Un renglón sin precios o
 * con `(eliminar)` habla de una ficha que ya existe, y hay que encontrar **esa**
 * y no una parecida. Buscar por aproximación acá es dar de baja el producto
 * equivocado o sumarle stock al que no era, y las dos cosas se descubren tarde.
 * Si no hay coincidencia exacta —o hay más de una— el renglón se rechaza y lo
 * dice: resolverlo a mano son veinte segundos, deshacer una baja mal hecha no.
 *
 * «Exacto» quiere decir ignorando mayúsculas, acentos y espacios de sobra, que
 * es lo que `normalizar` hace en todo el resto del sistema. Lo que no se ignora
 * es ninguna palabra.
 *
 * **Y la revisión no escribe nada.** Es el mismo trato que la planilla: primero
 * se mira renglón por renglón y después se guarda. Una entrega que guarda y
 * después avisa es una entrega que hay que deshacer a mano, y acá hay bajas.
 */
import { products } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import { normalizar } from '@/lib/texto';
import { crearProducto } from './crear';
import { leerLista, type RenglonDeLista } from './lista';
import { darDeBaja, sumarStock } from './stock';

export class ErrorEntrega extends Error {}

/** Más que esto no es una entrega, es una migración. */
export const TOPE_RENGLONES_LISTA = 300;

export type DestinoEntrega = 'alta' | 'stock' | 'baja' | 'rechazado';

export interface RenglonDeEntrega {
  linea: number;
  crudo: string;
  nombre: string;
  destino: DestinoEntrega;
  cantidad: number;
  precioCentavos: number | null;
  costoCentavos: number | null;
  /** El producto que se encontró, cuando el renglón habla de uno que ya existe. */
  productId: string | null;
  stockActual: number | null;
  /** Qué va a pasar, o por qué no se puede. Siempre hay algo que decir. */
  motivo: string | null;
}

export interface RevisionDeEntrega {
  renglones: RenglonDeEntrega[];
  altas: number;
  sumas: number;
  bajas: number;
  rechazados: number;
  /** Cuántas unidades entran en total, contando altas y sumas. */
  unidades: number;
}

/** Dice qué pasaría con cada renglón, sin escribir nada. */
export async function revisarEntrega(db: BaseDatos, texto: string): Promise<RevisionDeEntrega> {
  const leidos = leerLista(texto);
  if (leidos.length === 0) throw new ErrorEntrega('No hay nada escrito en la lista.');
  if (leidos.length > TOPE_RENGLONES_LISTA) {
    throw new ErrorEntrega(
      `La lista tiene ${leidos.length} renglones y el tope es ${TOPE_RENGLONES_LISTA}. Partila en varias.`,
    );
  }

  /*
   * El catálogo entero de una sola vez, y no una consulta por renglón: son
   * ochocientos productos contra treinta renglones, y treinta idas y vueltas a
   * la base se notan en una pantalla que alguien está mirando.
   *
   * Entran también los inactivos: un renglón sin precios puede estar hablando de
   * una ficha que se dio de baja, y eso hay que poder decirlo —«está pero
   * inactiva»— en vez de contestar que no existe.
   */
  const catalogo = await db
    .select({
      id: products.id,
      nombre: products.nombre,
      stock: products.stock,
      gestionaStock: products.gestionaStock,
      activo: products.activo,
    })
    .from(products);

  const porNombre = new Map<string, typeof catalogo>();
  for (const p of catalogo) {
    const clave = normalizar(p.nombre);
    const juntos = porNombre.get(clave);
    if (juntos) juntos.push(p);
    else porNombre.set(clave, [p]);
  }

  /** Lo que la propia lista va tomando, para que dos renglones iguales no entren dos veces. */
  const yaEnLaLista = new Set<string>();
  const renglones: RenglonDeEntrega[] = [];

  for (const l of leidos) {
    renglones.push(resolver(l, porNombre, yaEnLaLista));
  }

  const cuantos = (d: DestinoEntrega) => renglones.filter((r) => r.destino === d).length;

  return {
    renglones,
    altas: cuantos('alta'),
    sumas: cuantos('stock'),
    bajas: cuantos('baja'),
    rechazados: cuantos('rechazado'),
    unidades: renglones
      .filter((r) => r.destino === 'alta' || r.destino === 'stock')
      .reduce((t, r) => t + r.cantidad, 0),
  };
}

type Coincidencias = Map<
  string,
  { id: string; nombre: string; stock: number; gestionaStock: boolean; activo: boolean }[]
>;

function resolver(
  l: RenglonDeLista,
  porNombre: Coincidencias,
  yaEnLaLista: Set<string>,
): RenglonDeEntrega {
  const base: RenglonDeEntrega = {
    linea: l.linea,
    crudo: l.crudo,
    nombre: l.nombre,
    destino: 'rechazado',
    cantidad: l.cantidad,
    precioCentavos: l.precioCentavos,
    costoCentavos: l.costoCentavos,
    productId: null,
    stockActual: null,
    motivo: l.error,
  };

  if (l.error !== null) return base;

  const clave = normalizar(l.nombre);
  const encontrados = porNombre.get(clave) ?? [];

  if (encontrados.length > 1) {
    return {
      ...base,
      motivo: `Hay ${encontrados.length} productos con este nombre exacto. Resolvelo en el catálogo primero.`,
    };
  }

  const p = encontrados[0];

  if (l.accion === 'baja') {
    if (!p) {
      return {
        ...base,
        motivo: 'No encuentro ningún producto con ese nombre exacto. Copialo del catálogo.',
      };
    }
    if (!p.activo) {
      return { ...base, productId: p.id, motivo: 'Ya estaba dado de baja: no hay nada que hacer.' };
    }
    return {
      ...base,
      destino: 'baja',
      productId: p.id,
      stockActual: p.stock,
      motivo: 'Sale del catálogo y de la tienda. No se borra: se puede volver a activar.',
    };
  }

  if (!p) {
    if (l.accion === 'sumar') {
      /*
       * Un renglón sin precios dice «esto ya existe», y no existe. No se da de
       * alta en $0 —un producto a cero se vende a cero y recién ahí se nota—
       * así que se devuelve el renglón con lo que falta.
       */
      return {
        ...base,
        motivo:
          'No encuentro este producto, y sin precio no se puede dar de alta. ' +
          'Agregale el costo y el precio al público, o copiá el nombre exacto del catálogo.',
      };
    }

    if (yaEnLaLista.has(clave)) {
      return { ...base, motivo: 'Este producto aparece dos veces en la lista.' };
    }
    yaEnLaLista.add(clave);

    return {
      ...base,
      destino: 'alta',
      motivo: `Se carga con ${l.cantidad} ${l.cantidad === 1 ? 'unidad' : 'unidades'}.`,
    };
  }

  // Existe. Lo que corresponde es sumarle unidades, traiga precios o no.
  if (!p.gestionaStock) {
    return {
      ...base,
      productId: p.id,
      motivo: `«${p.nombre}» no lleva control de stock: se vende sin límite y no hace falta sumarle unidades.`,
    };
  }

  /*
   * Y el precio NO se toca, aunque el renglón lo traiga.
   *
   * Es lo que se pidió, y además es lo correcto: una lista de entrega trae el
   * costo con el que llegó la mercadería, no una decisión de qué cobrar. Si hay
   * que cambiarlo se cambia con «Cambiar precio», que avisa y queda en la
   * bitácora. Lo que sí se dice acá es que el precio del renglón se ignoró, para
   * que nadie se entere después.
   */
  const aviso =
    l.precioCentavos !== null
      ? ' El precio de la lista no se aplica: si cambió, cambialo desde el catálogo.'
      : '';

  return {
    ...base,
    destino: 'stock',
    productId: p.id,
    stockActual: p.stock,
    motivo:
      `Ya está en el catálogo${p.activo ? '' : ' (inactivo)'}: pasa de ${p.stock} a ` +
      `${p.stock + l.cantidad}.${aviso}`,
  };
}

export interface ResultadoEntrega {
  creados: number;
  stockSumado: number;
  bajas: number;
  salteados: number;
  fallidos: { linea: number; nombre: string; motivo: string }[];
}

/**
 * Aplica lo que la revisión marcó.
 *
 * Cada renglón va en su propia transacción —la misma que usa el alta de a uno y
 * la que usa la entrada de stock— así que un renglón con un problema que la
 * revisión no vio no se lleva puesta a toda la entrega.
 */
export async function aplicarEntrega(
  db: BaseDatos,
  texto: string,
  usuarioId: string,
): Promise<ResultadoEntrega> {
  const revision = await revisarEntrega(db, texto);

  // Se leen una vez: sin esto cada alta vuelve a leer la columna entera de SKU.
  const skusTomados = new Set(
    (await db.select({ sku: products.sku }).from(products))
      .filter((f) => f.sku)
      .map((f) => f.sku!.trim().toUpperCase()),
  );

  const resultado: ResultadoEntrega = {
    creados: 0,
    stockSumado: 0,
    bajas: 0,
    salteados: revision.rechazados,
    fallidos: [],
  };

  for (const r of revision.renglones) {
    if (r.destino === 'rechazado') continue;

    try {
      if (r.destino === 'alta') {
        const creado = await crearProducto(db, {
          nombre: r.nombre,
          precioCentavos: r.precioCentavos ?? 0,
          stock: r.cantidad,
          costoCentavos: r.costoCentavos,
          skusTomados,
          usuarioId,
        });
        resultado.creados += 1;
        if (creado.sku) skusTomados.add(creado.sku.toUpperCase());
      } else if (r.destino === 'stock') {
        await sumarStock(db, {
          productId: r.productId!,
          cantidad: r.cantidad,
          usuarioId,
          motivo: 'Entrega de mercadería cargada por lista',
        });
        resultado.stockSumado += 1;
      } else {
        await darDeBaja(db, { productId: r.productId!, usuarioId });
        resultado.bajas += 1;
      }
    } catch (e) {
      resultado.fallidos.push({
        linea: r.linea,
        nombre: r.nombre,
        motivo: e instanceof Error ? e.message : 'No se pudo aplicar el renglón.',
      });
    }
  }

  return resultado;
}

/**
 * Si el texto pegado es una planilla con encabezado o una lista escrita a mano.
 *
 * Existe para que la pantalla tenga **un solo** cuadro de texto. Dos cuadros
 * —«pegá la planilla» y «pegá la lista»— es una decisión más que tomar cuando
 * llega la mercadería, y es una decisión que el programa puede tomar solo:
 * una planilla siempre arranca con la fila de títulos.
 */
export function pareceUnaPlanilla(texto: string): boolean {
  const primera = normalizar(texto.split('\n').find((l) => l.trim() !== '') ?? '');
  if (primera === '') return false;

  const celdas = primera.split(/[;,\t]/).map((c) => c.trim());
  return celdas.length >= 2 && celdas.includes('nombre');
}

/** La lista de ejemplo, con los tres casos a la vista. */
export const LISTA_DE_EJEMPLO = [
  'Router TP-Link Archer C86 (5) $68.000 - 98.000',
  'Cable USB tipo C (4+)',
  'Memoria Kingston micro sd 128gb (eliminar)',
].join('\n');
