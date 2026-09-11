/**
 * Normalizacion de la cadena de conexion.
 *
 * Neon y otros proveedores entregan la cadena con parametros que solo entiende
 * `libpq`, la biblioteca de C que usan `psql` y los clientes nativos. El driver
 * de Node no los conoce y los reenvia al servidor como si fueran opciones de
 * sesion, con lo que PostgreSQL corta la conexion con un
 * "unrecognized configuration parameter" que no dice nada util.
 *
 * Se quitan aca, una sola vez, en vez de pedirle a cada persona que edite a mano
 * la cadena que le dio el proveedor.
 */

/** Parametros de libpq que el driver de Node no soporta y hay que descartar. */
const SOLO_LIBPQ = new Set([
  'channel_binding',
  'gssencmode',
  'krbsrvname',
  'sslcompression',
  'sslsni',
  'target_session_attrs',
]);

export interface ResultadoNormalizacion {
  url: string;
  /** Parametros descartados, para poder avisarlo en los comandos de consola. */
  descartados: string[];
}

export function normalizarUrlDeConexion(cruda: string): ResultadoNormalizacion {
  let url: URL;
  try {
    url = new URL(cruda);
  } catch {
    // Si no parsea como URL la dejamos tal cual: el driver dara su propio error,
    // que sera mas preciso que cualquier cosa que inventemos aca.
    return { url: cruda, descartados: [] };
  }

  const descartados: string[] = [];
  for (const clave of [...url.searchParams.keys()]) {
    if (SOLO_LIBPQ.has(clave.toLowerCase())) {
      descartados.push(clave);
      url.searchParams.delete(clave);
    }
  }

  return { url: url.toString(), descartados };
}

/** Igual que la anterior pero devolviendo solo la cadena. */
export function urlDeConexion(cruda: string): string {
  return normalizarUrlDeConexion(cruda).url;
}
