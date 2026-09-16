# Sistema de diseño — Lucas Innovaciones

**Origen:** rescatado del Kit de Elementor (post `4359`) en staging el 2026-08-03, **antes de purgar Elementor**.
No es un default: es una paleta deliberada, con nomenclatura propia `LI *`. Se conserva como base de la Fase 2.

---

## Identidad

| | |
|---|---|
| Nombre del sitio | Lucas Innovaciones |
| Descripción | Tienda online de productos tecnológicos |
| Pie de página | Todos los derechos reservados |

---

## Color

### Colores del sistema

| Rol | Hex | Uso |
|---|---|---|
| Primary | `#00E64D` | Verde de marca, acciones principales |
| Secondary | `#0A0A0A` | Casi negro |
| Text | `#0A0A0A` | Texto por defecto |
| Accent | `#00A63A` | Verde oscuro, énfasis |

### Paleta extendida `LI`

**Superficies**

| Nombre | Hex |
|---|---|
| LI BG Page | `#F4F4F4` |
| LI BG Alt | `#EDEDED` |
| LI White Card | `#FFFFFF` |
| LI Invert | `#000000` |

**Bordes**

| Nombre | Hex |
|---|---|
| LI Border | `#E5E5E5` |
| LI Border Strong | `#D4D4D4` |

**Texto**

| Nombre | Hex |
|---|---|
| LI Text Secondary | `#3A3A3A` |
| LI Text Muted | `#6B6B6B` |
| LI Text Disabled | `#9A9A9A` |
| LI Invert Muted | `#B8B8B8` |

**Semánticos**

| Nombre | Hex |
|---|---|
| LI Green Soft | `#D6FBE1` |
| LI Success | `#00A63A` |
| LI Warn | `#E8A200` |
| LI Danger | `#D63131` |
| LI Info | `#2B6EF2` |
| LI WhatsApp | `#25D366` |

---

## Tipografía

**Lo que se implementó** (vigente, en `assets/css/theme.css`):

| Rol | Familia | Token | Pesos en disco |
|---|---|---|---|
| Títulos e interfaz | **Montserrat** | `--f-titulo` (alias `--f-sans`) | 400 · 600 · 700 |
| Cuerpo | **Lato** | `--f-cuerpo` | 400 · 700 |
| Cifras: precios, códigos, especificaciones | **IBM Plex Mono** | `--f-mono` | 400 · 500 |
| Acento | **VT323** (declarada como `"Pixel LI"`) | `--f-pixel` | 400 |

- Interlineado: `--lh-normal: 1.55` en el cuerpo, `--lh-apretado: 1.15` en títulos
- Escala de proporción 1.2 sobre base 16: `--t-xs` … `--t-3xl`, con `--t-base`, `--t-2xl` y `--t-3xl` redefinidos a partir de 900px
- **Las siete fuentes se sirven locales desde `assets/fonts/`, en woff2, nunca desde Google Fonts.** Las tres que aparecen sobre la línea de flotación se precargan desde `li_precarga_fuentes()`
- La monoespaciada no es decorativa: las cifras tabulares son lo que permite que los precios se alineen en columna en la grilla del catálogo

### Por qué difiere del Kit de Elementor

El Kit declaraba **Inter** para el cuerpo y **Space Grotesk** para títulos y enlaces. Se reemplazaron en los commits `2114ff0` y `08bb7f3`, por dos motivos:

1. Inter es la tipografía más genérica del ecosistema, y el Kit no era una decisión de diseño sino un default heredado — sus tamaños estaban todos en 50px, que es el valor por defecto de Elementor.
2. Al no haber fotos de producto, la tipografía carga con casi todo el peso visual del sitio. Necesitaba más carácter del que aportaba el par Inter/Space Grotesk.

**VT323 sí sobrevivió.** Era la fuente personalizada subida al sitio (post `elementor_font` 7068) y el único elemento realmente distintivo del Kit. Se rescató de `uploads` antes de purgar Elementor, se convirtió a woff2 y hoy vive en el repositorio: retoma el cursor del isotipo.

---

## Layout

| | |
|---|---|
| Ancho de contenedor | `1200px` |
| Padding de contenedor | `0` |

### Breakpoints

| Nombre | px |
|---|---|
| mobile | 767 |
| md | 768 |
| tablet | 1024 |
| lg | 1025 |
| widescreen | 1336 |

Activos en el Kit: `mobile`, `tablet`, `widescreen`.

---

## Botones

| | |
|---|---|
| Radio de borde | `10px` |
| Padding | `12px 20px` |
| Borde | ninguno |

---

## Tokens CSS para el tema propio

```css
:root {
  /* Marca */
  --li-primary:        #00E64D;
  --li-secondary:      #0A0A0A;
  --li-accent:         #00A63A;

  /* Superficies */
  --li-bg-page:        #F4F4F4;
  --li-bg-alt:         #EDEDED;
  --li-card:           #FFFFFF;
  --li-invert:         #000000;

  /* Bordes */
  --li-border:         #E5E5E5;
  --li-border-strong:  #D4D4D4;

  /* Texto */
  --li-text:           #0A0A0A;
  --li-text-secondary: #3A3A3A;
  --li-text-muted:     #6B6B6B;
  --li-text-disabled:  #9A9A9A;
  --li-invert-muted:   #B8B8B8;

  /* Semánticos */
  --li-green-soft:     #D6FBE1;
  --li-success:        #00A63A;
  --li-warn:           #E8A200;
  --li-danger:         #D63131;
  --li-info:           #2B6EF2;
  --li-whatsapp:       #25D366;

  /* Tipografía */
  --li-font-body:      "Inter", sans-serif;
  --li-font-heading:   "Space Grotesk", sans-serif;
  --li-font-accent:    "VT323-Regular", monospace;
  --li-line-height:    1.55;

  /* Layout */
  --li-container:      1200px;
  --li-radius-button:  10px;
}
```

> ⚠️ **Este bloque es el borrador de agosto, no el código que corre.** Se conserva porque documenta el punto de partida. Los nombres definitivos están en `assets/css/theme.css` y difieren: los colores quedaron con sufijos en castellano (`--li-primary-oscuro`, `--li-border-fuerte`, `--li-text-mudo`, `--li-verde-suave`, `--li-peligro`…), la tipografía se renombró a `--f-titulo` / `--f-cuerpo` / `--f-mono` / `--f-pixel`, y el layout a `--li-contenedor` / `--li-radio`. **Al tocar el tema, la referencia es el CSS.**

---

## Coherencia con el POS

El verde del Kit es consistente con el que el cliente eligió en YITH POS:

| Elemento del POS | Color |
|---|---|
| Primario | `rgb(9,174,20)` → `#09AE14` |
| Secundario | `rgb(56,198,63)` → `#38C63F` |
| Botón de pago | `rgb(22,168,0)` → `#16A800` |
| Guardar carrito | `rgb(64,225,19)` → `#40E113` |
| Barra de encabezado | `#435756` |

No son idénticos, pero la familia es la misma. **Al construir el POS propio (Fase 4) conviene unificar con los tokens `LI`** en lugar de arrastrar los verdes sueltos de YITH.
