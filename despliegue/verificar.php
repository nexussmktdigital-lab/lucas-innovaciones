<?php
/**
 * Verificación de despliegue — compara el servidor contra el manifiesto.
 *
 * Se ejecuta EN EL SERVIDOR, por el MCP de Novamira o por
 * `wp eval-file`. No se despliega: no forma parte del tema ni del plugin.
 *
 * Responde tres preguntas que "se subió el ZIP y anda" no responde:
 *
 *   1. ¿Llegaron todos los archivos?           → FALTA
 *   2. ¿Llegaron íntegros?                     → DIFIERE
 *   3. ¿Quedó basura de la versión anterior?   → SOBRA
 *
 * La tercera es la que más importa. Un ZIP se descomprime encima de lo que
 * había: los archivos que ya no existen en el repositorio NO se borran. Una
 * plantilla vieja que quedó ahí la sigue usando WordPress, con prioridad sobre
 * lo que uno cree que está sirviendo, y no hay ningún síntoma hasta que
 * alguien ve una página con el diseño de hace dos versiones.
 *
 * El manifiesto se sube como archivo de texto a
 * wp-content/uploads/li-despliegue/manifest.md5 — el MCP no escribe PHP fuera
 * de su sandbox, pero un .md5 es texto y va a cualquier lado.
 *
 * @package LucasInnovaciones
 */

defined( 'ABSPATH' ) || die( "Este script necesita WordPress cargado.\n" );

/** Dónde quedó el manifiesto subido. */
$li_manifiesto = WP_CONTENT_DIR . '/uploads/li-despliegue/manifest.md5';

/*
 * Mapeo de rutas del repositorio a rutas del servidor. Es la única parte que
 * conoce la estructura de destino; el manifiesto es agnóstico a propósito.
 */
$li_mapa = array(
	'theme/lucas-innovaciones/' => get_theme_root() . '/lucas-innovaciones/',
	'plugin/lucas-cotizacion/'  => WP_PLUGIN_DIR . '/lucas-cotizacion/',
);

/* ---------------------------------------------------------------------------
 * 1. Leer el manifiesto
 * ------------------------------------------------------------------------ */

if ( ! is_readable( $li_manifiesto ) ) {
	die( "No encuentro el manifiesto en: $li_manifiesto\n" );
}

$li_esperado = array();
$li_commit   = '(sin registrar)';

foreach ( file( $li_manifiesto, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES ) as $li_linea ) {
	if ( '' === trim( $li_linea ) ) {
		continue;
	}

	if ( '#' === $li_linea[0] ) {
		if ( preg_match( '/^# commit\s+(\S+)\s+\((.+)\)/', $li_linea, $li_m ) ) {
			$li_commit = $li_m[1] . ' — ' . $li_m[2];
		}
		continue;
	}

	// Formato de md5sum: hash, dos espacios, ruta.
	$li_partes = explode( '  ', $li_linea, 2 );
	if ( 2 === count( $li_partes ) ) {
		$li_esperado[ $li_partes[1] ] = $li_partes[0];
	}
}

if ( ! $li_esperado ) {
	die( "El manifiesto está vacío o mal formado: $li_manifiesto\n" );
}

/* ---------------------------------------------------------------------------
 * 2. Comparar lo que el manifiesto dice que tiene que estar
 * ------------------------------------------------------------------------ */

$li_ok       = 0;
$li_problema = array();
$li_vistos   = array();

foreach ( $li_esperado as $li_rel => $li_hash ) {
	$li_destino = null;

	foreach ( $li_mapa as $li_prefijo => $li_raiz ) {
		if ( str_starts_with( $li_rel, $li_prefijo ) ) {
			$li_destino = $li_raiz . substr( $li_rel, strlen( $li_prefijo ) );
			break;
		}
	}

	if ( null === $li_destino ) {
		$li_problema[] = array( 'SIN MAPEO', $li_rel, 'no cae bajo ninguna raíz conocida' );
		continue;
	}

	$li_vistos[ $li_destino ] = true;

	if ( ! file_exists( $li_destino ) ) {
		$li_problema[] = array( 'FALTA', $li_rel, 'no llegó al servidor' );
		continue;
	}

	$li_real = md5_file( $li_destino );

	if ( $li_real !== $li_hash ) {
		$li_problema[] = array(
			'DIFIERE',
			$li_rel,
			sprintf( 'esperado %s · servidor %s', substr( $li_hash, 0, 8 ), substr( $li_real, 0, 8 ) ),
		);
		continue;
	}

	++$li_ok;
}

/* ---------------------------------------------------------------------------
 * 3. Buscar lo que está en el servidor y NO está en el manifiesto
 * ------------------------------------------------------------------------ */

$li_sobran = array();

foreach ( $li_mapa as $li_prefijo => $li_raiz ) {
	if ( ! is_dir( $li_raiz ) ) {
		$li_problema[] = array( 'FALTA', rtrim( $li_prefijo, '/' ), 'el directorio no existe en el servidor' );
		continue;
	}

	$li_iter = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator( $li_raiz, FilesystemIterator::SKIP_DOTS )
	);

	foreach ( $li_iter as $li_archivo ) {
		if ( ! $li_archivo->isFile() ) {
			continue;
		}

		$li_ruta = $li_archivo->getPathname();

		if ( isset( $li_vistos[ $li_ruta ] ) ) {
			continue;
		}

		$li_sobran[] = $li_prefijo . substr( $li_ruta, strlen( $li_raiz ) );
	}
}

/* ---------------------------------------------------------------------------
 * 4. Informe
 * ------------------------------------------------------------------------ */

echo "Verificación de despliegue\n";
echo "Manifiesto: $li_commit\n";
echo 'Tema activo: ' . get_option( 'stylesheet' ) . "\n";

// is_plugin_active() vive en wp-admin y no siempre está cargada según cómo se
// invoque este script; la opción sí está siempre.
$li_activos = (array) get_option( 'active_plugins', array() );
echo 'Plugin de cotización: ' . ( in_array( 'lucas-cotizacion/lucas-cotizacion.php', $li_activos, true ) ? 'activo' : 'INACTIVO' ) . "\n";
echo str_repeat( '-', 72 ) . "\n";

printf( "%d de %d archivos coinciden.\n", $li_ok, count( $li_esperado ) );

if ( $li_problema ) {
	echo "\nProblemas:\n";
	foreach ( $li_problema as $li_p ) {
		printf( "  %-10s %s\n             %s\n", $li_p[0], $li_p[1], $li_p[2] );
	}
}

if ( $li_sobran ) {
	echo "\nArchivos en el servidor que no están en el manifiesto (" . count( $li_sobran ) . "):\n";
	foreach ( $li_sobran as $li_s ) {
		echo "  SOBRA     $li_s\n";
	}
	echo "\n  Si son restos de una versión anterior, hay que borrarlos: WordPress\n";
	echo "  usa las plantillas que encuentra, no las que uno cree haber subido.\n";
}

echo "\n";
echo ( $li_problema || $li_sobran )
	? "RESULTADO: el servidor NO coincide con el repositorio.\n"
	: "RESULTADO: el servidor coincide exactamente con el repositorio.\n";
