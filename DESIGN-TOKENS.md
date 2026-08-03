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

| Rol | Familia | Peso |
|---|---|---|
| Cuerpo | Inter | 400 |
| Enlaces | Space Grotesk | 700 |
| H1, H2 | Space Grotesk | 700 |
| H3 – H6 | Inter | 400 |
| Acento | **VT323-Regular** | 400 |

- Interlineado del cuerpo: `1.55` · Espaciado entre letras: `0`
- Familia genérica de reserva: `sans-serif`
- **VT323-Regular es una fuente personalizada subida al sitio** (post `elementor_font` 7068). Es una tipográfica de píxeles/terminal — el único elemento realmente distintivo del sistema. Hay que recuperar el archivo de `uploads` antes de eliminar Elementor.

> **Nota para la Fase 2:** los tamaños del Kit están todos en 50px, que es el valor por defecto de Elementor — no son una escala real. La escala tipográfica hay que definirla de cero. Además, **Inter es la tipografía más genérica del ecosistema**; conviene evaluar si se conserva para el cuerpo o se reemplaza por algo con más carácter, manteniendo Space Grotesk para títulos y VT323 como acento.

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
