# Logos de marca

Un archivo por marca, **nombrado con el slug del término** de `product_brand`.
El tema lo encuentra solo: no hay que tocar código ni cargar nada en WordPress.
Extensiones aceptadas, por orden de preferencia: `svg`, `png`, `webp`, `jpg`.

## Estado actual

15 logos cargados y adaptados. Faltan dos del top 16 de la portada:

| Falta | Productos |
|-------|-----------|
| `apple.svg` / `apple.png` | 64 — es la marca más grande del catálogo |
| `noganet.svg` / `noganet.png` | 21 |

Mientras no estén, esos dos círculos muestran la inicial.

## Qué se hizo con los archivos originales

Los SVG que llegaron no eran vectores: eran PNG incrustados en base64 dentro
de un envoltorio `<svg>` (la excepción es `stanley.svg`, que sí tiene paths y
por eso quedó como está). Pesaban 450 KB entre todos, con mucho espacio vacío
alrededor del dibujo.

Se extrajo el PNG de adentro, se recortó al contenido real, se redimensionó a
200 px de lado mayor y se redujo la paleta. Resultado: **30 KB en total**. Los
archivos tal como llegaron quedaron en `_originales/`, que el tema ignora.

## fondos.json — el color del círculo

Por defecto el círculo es blanco. `fondos.json` declara las excepciones:

```json
{
  "jbl":   "#FF6600",
  "oryx":  "#0A0A0A",
  "vapex": "#EC5B00"
}
```

- **JBL** y **Vapex** traen su propio fondo naranja. El círculo se pinta del
  mismo color exacto, así que el rectángulo del logo desaparece contra el
  fondo y solo se ve la marca.
- **Oryx** es un logotipo blanco pensado para fondos oscuros: en un círculo
  blanco no se ve nada. Va sobre el negro de la paleta.

Para agregar una marca con fondo de color, se suma su slug al JSON con el
hexadecimal de 6 dígitos. El color va en línea sobre el círculo, así que
también gana sobre el blanco del hover sin escribir una excepción por marca.

## Si cargás un logo nuevo

- **Fondo transparente** salvo que la marca tenga uno propio; en ese caso,
  declaralo en `fondos.json`.
- **Recortado al contenido**, sin márgenes vacíos: el tema no los recorta y el
  logo se vería más chico de lo que corresponde.
- **Ojo con los logotipos claros.** Si es blanco o muy claro, necesita entrada
  en `fondos.json` o desaparece.
- Se dibuja hasta 80% del ancho y 58% del alto del círculo, así que un
  logotipo muy apaisado se ve chico. Si la marca tiene versión de isotipo
  (el símbolo solo, sin el texto), esa siempre queda mejor.

## La otra vía

Desde el escritorio: **Productos → Marcas → editar → Miniatura**. Esa imagen
tiene prioridad sobre el archivo de esta carpeta, y en ese caso el círculo
siempre queda blanco.

Las categorías no usan esta carpeta: van por **Productos → Categorías →
Miniatura**, y mientras no haya imagen se dibuja el ícono correspondiente.
