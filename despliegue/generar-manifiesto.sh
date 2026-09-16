#!/usr/bin/env bash
#
# Genera despliegue/manifest.md5 — el hash de cada archivo que se despliega.
#
# La fuente es "git ls-files", no "find": lo que no está versionado no se
# despliega. Eso deja afuera cualquier archivo de trabajo que haya quedado
# suelto en el directorio y evita subir basura al servidor sin darse cuenta.
#
# Uso:  ./despliegue/generar-manifiesto.sh
#

set -euo pipefail

cd "$(dirname "$0")/.."

SALIDA="despliegue/manifest.md5"

# Solo lo desplegable. Los .md de la raíz, los CSV y la carpeta "Banners web"
# son material de trabajo: viven en el repositorio y no en el servidor.
RUTAS=("theme/lucas-innovaciones" "plugin/lucas-cotizacion")

# El árbol tiene que estar limpio: un manifiesto generado sobre cambios sin
# commitear describe un estado que no existe en ningún lado y que mañana nadie
# puede reproducir.
if [[ -n "$(git status --porcelain -- "${RUTAS[@]}")" ]]; then
	echo "ERROR: hay cambios sin commitear en el tema o el plugin." >&2
	echo "       Commiteá primero: el manifiesto describe un commit, no un borrador." >&2
	git status --short -- "${RUTAS[@]}" >&2
	exit 1
fi

COMMIT="$(git rev-parse --short HEAD)"
FECHA="$(git log -1 --format=%cd --date=format:'%Y-%m-%d %H:%M')"

{
	echo "# Manifiesto de despliegue — Lucas Innovaciones"
	echo "# commit  $COMMIT  ($FECHA)"
	echo "# generado por despliegue/generar-manifiesto.sh"
	echo "#"
	echo "# Cada línea: <md5>  <ruta en el repositorio>"
	echo "# El mapeo a rutas del servidor lo hace despliegue/verificar.php."
	echo "#"

	# LC_ALL=C para que el orden sea el mismo en cualquier máquina: si el
	# orden cambiara, el diff entre dos manifiestos sería ilegible.
	git ls-files -z -- "${RUTAS[@]}" | LC_ALL=C sort -z | xargs -0 md5sum
} > "$SALIDA"

ARCHIVOS="$(grep -vc '^#' "$SALIDA")"
echo "$SALIDA — $ARCHIVOS archivos · commit $COMMIT"
