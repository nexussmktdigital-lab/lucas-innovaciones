#!/usr/bin/env bash
#
# Empaqueta el tema y el plugin en ZIP listos para "wp theme install".
#
# Se usa "git archive" y no "zip": empaqueta exactamente el contenido del
# commit, sin archivos sin versionar, sin .DS_Store y sin lo que haya quedado
# a medio editar en el directorio de trabajo. El ZIP es reproducible — el
# mismo commit da siempre el mismo contenido.
#
# Uso:  ./despliegue/empaquetar.sh
# Salida: dist/lucas-innovaciones-<version>-<commit>.zip
#         dist/lucas-cotizacion-<version>-<commit>.zip
#

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain -- theme plugin)" ]]; then
	echo "ERROR: hay cambios sin commitear en el tema o el plugin." >&2
	echo "       git archive empaqueta el commit, no el directorio: subirías una versión vieja." >&2
	exit 1
fi

mkdir -p dist
COMMIT="$(git rev-parse --short HEAD)"

# El ZIP tiene que traer la carpeta con el nombre exacto del slug adentro:
# es lo que WordPress usa como directorio del tema y del plugin.
empaquetar() {
	local origen="$1" slug="$2" version="$3"
	local zip="dist/${slug}-${version}-${COMMIT}.zip"

	git archive --format=zip --prefix="${slug}/" -o "$zip" "HEAD:${origen}"
	printf '%s  %s\n' "$(md5sum "$zip" | cut -d' ' -f1)" "$zip"
}

# Las versiones se leen de las cabeceras, que son la fuente de verdad para
# WordPress. Si no coinciden con el nombre del ZIP, es que alguien se olvidó
# de subir la versión.
VER_TEMA="$(sed -n 's/^Version: *//p' theme/lucas-innovaciones/style.css | head -1)"
VER_PLUGIN="$(sed -n 's/^ \* Version: *//p' plugin/lucas-cotizacion/lucas-cotizacion.php | head -1)"

empaquetar "theme/lucas-innovaciones"   "lucas-innovaciones" "$VER_TEMA"
empaquetar "plugin/lucas-cotizacion"    "lucas-cotizacion"   "$VER_PLUGIN"

echo
echo "Listo. Subir con novamira/create-upload-link y verificar con despliegue/verificar.php."
