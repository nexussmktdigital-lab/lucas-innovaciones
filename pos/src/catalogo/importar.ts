/**
 * Importación masiva de productos desde una planilla.
 *
 * Cuando llega mercadería nueva no llega de a un producto: llega una lista del
 * distribuidor con treinta renglones. Cargarlos de a uno es media hora y tres
 * errores de tipeo.
 *
 * Dos decisiones:
 *
 * 1. **Primero se mira, después se guarda.** La importación se hace en dos
 *    pasos: `revisarPlanilla` no toca la base y devuelve, renglón por renglón,
 *    qué va a pasar; `importarPlanilla` recién ahí escribe. Una importación que
 *    guarda y después avisa es una importación que hay que deshacer a mano.
 *
 * 2. **Da de alta, no pisa lo que ya está.** Un SKU o un nombre que ya existe
 *    se informa y se saltea, no se actualiza. Los precios se cambian en la
 *    pantalla de precios, que es donde están los controles; una planilla que
 *    puede reescribir precios en masa es la forma más rápida de cambiar todo el
 *    catálogo sin que nadie lo note.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { products } from '@/db/schema';
import type { BaseDatos } from '@/db/tipos';
import { aCentavos, ErrorDinero } from '@/lib/dinero';
import { normalizar } from '@/lib/texto';
import { crearProducto, TECHO_PRECIO_ALTA_CENTAVOS, TECHO_STOCK_ALTA } from './crear';

export class ErrorImportar extends Error {}

/** Más que esto no es una entrega de mercadería, es una migración. */
export const TOPE_RENGLONES = 500;

/** Nombres de columna que se aceptan, por campo. Se comparan sin acentos. */
const COLUMNAS: Record<string, readonly string[]> = {
  nombre: ['nombre', 'producto', 'descripcion', 'detalle', 'articulo'],
  sku: ['sku', 'codigo', 'cod'],
  categoria: ['categoria', 'rubro'],
  marca: ['marca'],
  precio: ['precio', 'precio de mostrador', 'precio mostrador', 'importe', 'pvp'],
  stock: ['stock', 'cantidad', 'unidades', 'cant'],
  codigoBarras: ['codigo de barras', 'codigo barras', 'ean', 'barras'],
  costo: ['costo', 'costo unitario', 'precio de costo', 'precio costo', 'compra'],
};

export type Destino = 'alta' | 'repetido' | 'rechazado';

export interface RenglonRevisado {
  /** Número de renglón en la planilla, contando el encabezado como 1. */
  linea: number;
  destino: Destino;
  nombre: string;
  sku: string | null;
  categoria: string | null;
  marca: string | null;
  precioCentavos: number;
  stock: number;
  /** Lo que costó, si la planilla lo trae. Habilita el reporte de margen. */
  costoCentavos: number | null;
  /** Por qué se saltea o se rechaza. */
  motivo: string | null;
}

export interface RevisionDePlanilla {
  renglones: RenglonRevisado[];
  altas: number;
  repetidos: number;
  rechazados: number;
  /** Categorías de la planilla que todavía no existen en el catálogo. */
  categoriasNuevas: string[];
}

/**
 * Lee un CSV chico. Soporta comillas dobles y el separador que venga.
 *
 * No se usa una librería porque lo que hay que leer es una planilla exportada
 * de Excel, no CSV arbitrario, y una dependencia más es una dependencia más que
 * mantener. Lo que sí hay que soportar es el punto y coma, que es lo que
 * exporta Excel en español.
 */
export function leerCsv(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (limpio.trim() === '') return [];

  const separador = elegirSeparador(limpio);
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;

  for (let i = 0; i < limpio.length; i += 1) {
    const c = limpio[i]!;

    if (entreComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') entreComillas = true;
    else if (c === separador) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else campo += c;
  }

  fila.push(campo);
  filas.push(fila);

  return filas.filter((f) => f.some((x) => x.trim() !== ''));
}

/** El separador es el que más aparece en el encabezado. */
function elegirSeparador(texto: string): string {
  const encabezado = texto.slice(0, texto.indexOf('\n') === -1 ? undefined : texto.indexOf('\n'));
  const cuantos = (s: string) => encabezado.split(s).length - 1;
  const candidatos = [';', ',', '\t'];
  return candidatos.reduce((mejor, s) => (cuantos(s) > cuantos(mejor) ? s : mejor), ',');
}

/** Ubica cada campo en su columna, sea cual sea el nombre que le hayan puesto. */
function mapearColumnas(encabezado: readonly string[]): Record<string, number> {
  const posiciones: Record<string, number> = {};

  encabezado.forEach((celda, i) => {
    const nombre = normalizar(celda);
    for (const [campo, alias] of Object.entries(COLUMNAS)) {
      if (posiciones[campo] === undefined && alias.includes(nombre)) posiciones[campo] = i;
    }
  });

  if (posiciones.nombre === undefined) {
    throw new ErrorImportar(
      'La planilla no tiene una columna de nombre. La primera fila tiene que ser el encabezado, con al menos «nombre» y «precio».',
    );
  }
  if (posiciones.precio === undefined) {
    throw new ErrorImportar('La planilla no tiene una columna de precio.');
  }

  return posiciones;
}

/**
 * Dice qué pasaría con cada renglón, sin escribir nada.
 *
 * Es la pantalla que se mira antes de apretar el botón.
 */
export async function revisarPlanilla(
  db: BaseDatos,
  csv: string,
): Promise<RevisionDePlanilla> {
  const filas = leerCsv(csv);
  if (filas.length < 2) {
    throw new ErrorImportar('La planilla está vacía o solo tiene el encabezado.');
  }
  if (filas.length - 1 > TOPE_RENGLONES) {
    throw new ErrorImportar(
      `La planilla tiene ${filas.length - 1} renglones y el tope es ${TOPE_RENGLONES}. Partila en varias.`,
    );
  }

  const columnas = mapearColumnas(filas[0]!);

  /*
   * También los inactivos: es lo que mira `crearProducto` al escribir. Cuando
   * la revisión miraba solo los activos, un renglón que chocaba con un producto
   * en borrador de WooCommerce salía en verde como «se carga» y después
   * aparecía en la lista de los que no entraron. La pantalla previa prometía
   * una cosa y el resultado decía otra.
   */
  const existentes = await db
    .select({ nombre: products.nombre, sku: products.sku })
    .from(products);

  const nombresTomados = new Set(existentes.map((p) => normalizar(p.nombre)));
  const skusTomados = new Set(
    existentes.filter((p) => p.sku).map((p) => p.sku!.trim().toUpperCase()),
  );

  const categoriasDelCatalogo = new Set(
    (
      await db
        .selectDistinct({ categoria: products.categoria })
        .from(products)
        .where(and(isNotNull(products.categoria), eq(products.activo, true)))
    ).map((f) => normalizar(f.categoria!)),
  );

  const renglones: RenglonRevisado[] = [];
  const categoriasNuevas = new Map<string, string>();

  for (let i = 1; i < filas.length; i += 1) {
    const fila = filas[i]!;
    const leer = (campo: string) =>
      columnas[campo] === undefined ? '' : (fila[columnas[campo]!] ?? '').trim();

    const nombre = leer('nombre');
    const categoria = leer('categoria') || null;
    const marca = leer('marca') || null;
    const skuCrudo = leer('sku') || null;

    const base = {
      linea: i + 1,
      nombre,
      sku: skuCrudo,
      categoria,
      marca,
      precioCentavos: 0,
      stock: 0,
      costoCentavos: null,
    };

    if (nombre === '') {
      renglones.push({ ...base, destino: 'rechazado', motivo: 'El renglón no tiene nombre.' });
      continue;
    }

    let precioCentavos: number;
    try {
      const crudo = leer('precio');
      precioCentavos = crudo === '' ? 0 : aCentavos(crudo);
    } catch (e) {
      renglones.push({
        ...base,
        destino: 'rechazado',
        motivo: e instanceof ErrorDinero ? e.message : 'El precio no es un número.',
      });
      continue;
    }

    if (precioCentavos < 0 || precioCentavos > TECHO_PRECIO_ALTA_CENTAVOS) {
      renglones.push({
        ...base,
        precioCentavos,
        destino: 'rechazado',
        // Se frena acá y no al escribir: si no, la revisión muestra el renglón
        // en verde y recién después aparece en la lista de los que no entraron.
        motivo:
          precioCentavos < 0
            ? 'El precio no puede ser negativo.'
            : 'El precio es imposible. Fijate si sobran ceros.',
      });
      continue;
    }

    const stockCrudo = leer('stock');
    /*
     * El stock son unidades enteras: el punto de «1.500» es separador de miles
     * y el de «1.5» es decimal, y los dos vienen en planillas reales. Sacarlo
     * siempre convertia «1.5 unidades» en quince, que es stock inventado. Se
     * lee con la misma funcion que el precio y se exige entero.
     */
    let stock = 0;
    if (stockCrudo !== '') {
      try {
        // `aCentavos` ya distingue el punto de miles del decimal, que es
        // justamente lo que hay que distinguir: «1.500» son mil quinientas
        // unidades y «1.5» no es una cantidad de unidades. Dividir por cien
        // devuelve las unidades, y si no da entero el renglon se rechaza.
        stock = aCentavos(stockCrudo) / 100;
      } catch {
        stock = Number.NaN;
      }
    }

    if (!Number.isInteger(stock) || stock < 0 || stock > TECHO_STOCK_ALTA) {
      renglones.push({
        ...base,
        precioCentavos,
        destino: 'rechazado',
        motivo: `El stock «${stockCrudo}» no es una cantidad de unidades válida.`,
      });
      continue;
    }

    let costoCentavos: number | null = null;
    const costoCrudo = leer('costo');
    if (costoCrudo !== '') {
      try {
        costoCentavos = aCentavos(costoCrudo);
        if (costoCentavos < 0 || costoCentavos > TECHO_PRECIO_ALTA_CENTAVOS) {
          throw new ErrorImportar('fuera de rango');
        }
      } catch {
        renglones.push({
          ...base,
          precioCentavos,
          destino: 'rechazado',
          motivo: `El costo «${costoCrudo}» no es un número.`,
        });
        continue;
      }
    }

    const completo = { ...base, precioCentavos, stock, costoCentavos };

    if (nombresTomados.has(normalizar(nombre))) {
      renglones.push({
        ...completo,
        destino: 'repetido',
        motivo: 'Ya hay un producto con ese nombre.',
      });
      continue;
    }
    if (skuCrudo && skusTomados.has(skuCrudo.toUpperCase())) {
      renglones.push({ ...completo, destino: 'repetido', motivo: `El SKU ${skuCrudo} ya existe.` });
      continue;
    }

    // Se marcan acá para que dos renglones iguales de la misma planilla no
    // entren los dos.
    nombresTomados.add(normalizar(nombre));
    if (skuCrudo) skusTomados.add(skuCrudo.toUpperCase());

    if (categoria && !categoriasDelCatalogo.has(normalizar(categoria))) {
      categoriasNuevas.set(normalizar(categoria), categoria);
    }

    renglones.push({ ...completo, destino: 'alta', motivo: null });
  }

  return {
    renglones,
    altas: renglones.filter((r) => r.destino === 'alta').length,
    repetidos: renglones.filter((r) => r.destino === 'repetido').length,
    rechazados: renglones.filter((r) => r.destino === 'rechazado').length,
    categoriasNuevas: [...categoriasNuevas.values()],
  };
}

export interface ResultadoImportacion {
  creados: number;
  salteados: number;
  /** Renglones que pasaron la revisión y aun así no entraron, con su motivo. */
  fallidos: { linea: number; nombre: string; motivo: string }[];
}

/**
 * Da de alta lo que la revisión marcó como alta.
 *
 * Cada producto va en su propia transacción, la misma que usa el alta de a uno:
 * así un renglón con un problema que la revisión no vio no se lleva puesta a
 * toda la entrega de mercadería.
 */
export async function importarPlanilla(
  db: BaseDatos,
  csv: string,
  usuarioId: string,
): Promise<ResultadoImportacion> {
  const revision = await revisarPlanilla(db, csv);

  // Se leen una vez y se van sumando los que la propia planilla va tomando: si
  // cada renglón los volviera a pedir, una planilla larga sobre un catálogo
  // grande tarda más que la paciencia de cualquiera.
  const skusTomados = new Set(
    (await db.select({ sku: products.sku }).from(products))
      .filter((f) => f.sku)
      .map((f) => f.sku!.trim().toUpperCase()),
  );

  const resultado: ResultadoImportacion = {
    creados: 0,
    salteados: revision.repetidos + revision.rechazados,
    fallidos: [],
  };

  for (const r of revision.renglones) {
    if (r.destino !== 'alta') continue;

    try {
      const creado = await crearProducto(db, {
        nombre: r.nombre,
        categoria: r.categoria,
        marca: r.marca,
        precioCentavos: r.precioCentavos,
        stock: r.stock,
        sku: r.sku,
        costoCentavos: r.costoCentavos,
        skusTomados,
        usuarioId,
      });
      resultado.creados += 1;
      // El que se agrega es el que quedó, no el de la planilla: los renglones
      // sin SKU propio reciben uno propuesto, y si no se acumulara, dos
      // productos parecidos de la misma planilla pedirían el mismo.
      if (creado.sku) skusTomados.add(creado.sku.toUpperCase());
    } catch (e) {
      resultado.fallidos.push({
        linea: r.linea,
        nombre: r.nombre,
        motivo: e instanceof Error ? e.message : 'No se pudo dar de alta.',
      });
    }
  }

  return resultado;
}

/** La planilla de ejemplo, para que nadie tenga que adivinar las columnas. */
export const PLANILLA_DE_EJEMPLO = [
  'nombre;sku;categoria;marca;precio;stock;costo',
  'Cable USB tipo C 2 metros;;Cables de carga;FoxBox;12000;20;7000',
  'Funda silicona iPhone 15;;Fundas;;9500;12;',
  'Cargador 30W tipo C;CAR-BASE-30W;Cargadores de pared;Baseus;28000;8;17000',
].join('\n');
