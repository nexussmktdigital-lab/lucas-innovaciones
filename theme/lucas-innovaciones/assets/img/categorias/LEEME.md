# Imágenes de categoría

Un archivo por categoría, **nombrado con el slug del término** de `product_cat`.
El tema lo encuentra solo. Extensiones: `svg`, `png`, `webp`, `jpg`.

## Las 10 de la portada

| Categoría | Archivo | Productos |
|---|---|---|
| Smartphones nuevos | `smartphones-nuevos.png` | 58 |
| Cables de carga | `cables-de-carga.png` | 45 |
| Cocina | `cocina.png` | 42 |
| Cargadores de pared | `cargadores-de-pared.png` | 32 |
| Periféricos | `perifericos-computacion.png` | 30 |
| Mates | `mates-mate-y-termos.png` | 28 |
| Luces de ambiente y evento | `luces-de-ambiente-y-evento.png` | 26 |
| Cables de audio | `cables-de-audio.png` | 25 |
| Vasos y botellas térmicas | `vasos-y-botellas-termicas.png` | 23 |
| Auriculares con cable | `auriculares-con-cable.png` | 20 |

El orden lo decide la cantidad de productos, así que puede cambiar solo. La
categoría que no tenga imagen dibuja su ícono, que es un estado válido.

## Cómo tienen que ser

A diferencia de los logos de marca, estas imágenes **llenan el círculo entero**
(`object-fit: cover`), no se apoyan adentro.

- **Cuadradas.** Cualquier otra proporción se recorta por el lado largo.
- **Con el asunto al centro y aire alrededor.** El círculo se come las cuatro
  esquinas: casi el 30% del cuadrado no se ve. Todo lo importante tiene que
  entrar en el 70% central.
- **1024 × 1024 alcanza.** Se muestran a 88 px, pero hay pantallas 2× y 3×.
- **Fondo blanco puro.** Así la imagen se funde con el círculo y solo se ve el
  objeto. Un fondo gris deja ver el borde del recorte.
- **Un solo objeto, mucho contraste, sin texto.** A 88 px no se lee nada más.

Lo que más importa es que las diez parezcan una serie: mismo fondo, misma luz,
mismo ángulo. Diez fotos de estilos distintos en fila se ven como un collage.

## La otra vía

Desde el escritorio: **Productos → Categorías → editar → Miniatura**. Esa imagen
tiene prioridad sobre el archivo de esta carpeta.
