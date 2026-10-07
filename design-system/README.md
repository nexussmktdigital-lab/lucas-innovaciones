# Lucas Innovaciones — Design System

Tienda local de tecnología y electrónica en **Villa Santa Rosa, Córdoba** (Argentina). Comercializa smartphones, notebooks, tablets, smart TVs, smartwatches, consolas, audio y electrodomésticos. Operación principal sobre **WooCommerce/WordPress** + atención por **WhatsApp**.

> *"Tenemos toda la tecnología para brindarte la comodidad que te mereces."*

---

## Fuentes consultadas

- **Brief del cliente** (adjunto en el chat del proyecto): negocio, audiencia, diferenciales, objeciones, estructura de páginas y tono.
- **Logo oficial** (`assets/logo.jpeg` / `assets/logo-full.png`): letra "L." blanca sobre círculo negro + botón de power verde + cursor pixelado retro presionándolo.
- **Repo GitHub** `nexussmktdigital-lab/lucas-innovaciones` — revisado pero **vacío** al momento de crear este sistema. No hay código heredado; el design system se construyó desde el brief y el logo.
- Redes: Instagram `@lucas_innovaciones` (2.3k), Facebook `Lucas-Innovaciones` (1.6k). WhatsApp **+54 3574 443092**.

---

## Productos / superficies

| Superficie | Plataforma | Estado |
|---|---|---|
| Tienda online (Homepage, PDP, Checkout) | WooCommerce / WordPress | UI kit completo en `ui_kits/tienda/` |

El proyecto original cubre **una sola superficie**: la tienda online. Si se suman luego app mobile, panel interno, material POS impreso, etc., cada una lleva su propio subfolder en `ui_kits/`.

---

## Índice del folder

```
/
├── README.md                     ← este archivo
├── SKILL.md                      ← instrucciones para agentes
├── colors_and_type.css           ← tokens CSS (colores, tipo, spacing, shadows)
├── assets/                       ← logos, iconos, imágenes
│   ├── logo.jpeg                 ← logo original
│   ├── logo-full.png             ← logo como PNG
│   └── cursor-pixel.svg          ← cursor pixel art (recurso propio del brand)
├── preview/                      ← tarjetas del Design System tab
└── ui_kits/
    └── tienda/
        ├── README.md             ← qué cubre este kit
        ├── index.html            ← demo interactivo click-thru
        └── *.jsx                 ← componentes reusables
```

---

## Content Fundamentals

### Tono
**Cercano, argentino, sin tecnicismos vacíos.** El negocio se apoya en la confianza del pueblo — el copy tiene que sonar como alguien que te atiende en el mostrador, no como un ecommerce despersonalizado.

- **Tuteo siempre** ("tu pedido", "elegí", "llevátelo"), **nunca "usted"**.
- Frases cortas y directas. Verbos en imperativo para CTAs ("Ver catálogo", "Comprar", "Consultar").
- Español rioplatense/cordobés cuando suma calidez; evitar modismos cerrados que no se entiendan en buscador.
- **Cero jerga marketinera** tipo "revolucionario", "game-changer", "experiencia premium". Decí lo que es.
- Números argentinos: **$ 1.299.000**, **12 cuotas sin interés**, **IVA incluido**.

### Casing
- Titulares en **Sentence case** ("Lo más vendido", no "Lo Más Vendido").
- Nav y botones en **Sentence case** salvo etiquetas cortas tipo "NUEVO", "OFERTA" que van en **MAYÚSCULA** como badge.
- El logo siempre va en minúscula ("L." + "in.").

### Emoji
- **En la web NO.** La UI se mantiene limpia.
- **En WhatsApp SÍ**, uso moderado — ✅ para confirmar, 📦 para envío, 🙌 como saludo.

### Micro-copy de referencia

| Contexto | Copy |
|---|---|
| Hero CTA | **Ver catálogo** |
| CTA producto | **Comprar** / **Consultar por WhatsApp** |
| Stock OK | "Stock disponible · Retiralo hoy" |
| Cuotas | "o **12 cuotas sin interés de $ 108.250**" |
| Envío | "Envío a domicilio en Villa Santa Rosa y zona — llega en 24 hs." |
| Garantía | "Garantía Lucas Innovaciones · reclamás en el local, no mandás paquetes a Capital." |
| Confianza | "Hace 9 años en Villa Santa Rosa. Cara visible, atención real." |
| WhatsApp flotante | "¿Te ayudo a elegir?" |
| Checkout vacío | "Tu carrito está esperando. Elegí algo del [catálogo](#)." |

### Vibe
> Un amigo que sabe de tecnología, te atiende en el pueblo, te fía en cuotas y te responde el WhatsApp a las 9 de la noche. Minimalista pero cálido. Tech pero humano.

---

## Visual Foundations

### Paleta
- **Negro #0A0A0A** — superficie primaria en hero/nav. Es la voz de la marca.
- **Verde "encendido" #00E64D** — CTAs, precio en cuotas, badges de stock, botón de power. Se usa **con parsimonia**: es el acento que enciende la página, si está en todos lados pierde fuerza.
- **Gris claro #F4F4F4** — fondo de página, reemplaza al blanco puro para dar calidez.
- **Blanco #FFFFFF** — **solo en tarjetas de producto y surfaces elevadas**. El contraste card-on-bg es el truco principal de jerarquía.
- **Texto secundario #6B6B6B** — specs, meta, descripciones largas.

Los tonos del verde bajan a **#00A63A** cuando el texto verde va sobre blanco (AA compliant para precios en cuotas). El verde claro (#D6FBE1) se usa solo en banners tipo "12 cuotas sin interés".

### Tipografía
- **Inter** (sans geométrica moderna) — todo el body, nav, specs, precios.
- **Space Grotesk** — titulares de hero, H1/H2, precio de contado. Da un toque "tech" sin ser frío.
- **VT323** (pixel) — **acento ultra-puntual** como guiño al cursor pixelado del logo. Se usa en el tagline del hero, badges tipo `[STOCK_OK]`, o en el lettering de "sale" en banners. **Nunca para párrafos ni navegación.**

Scale: 40–76px display, 36 h1, 28 h2, 20 h3, 18 lead, 16 body, 14 sm, 12 xs.

### Espaciado y layout
- Grid base de **4px**, escala 4-8-12-16-20-24-32-40-48-64-80.
- **"Mucho aire"**: containers con `padding: 48–80px` vertical entre secciones en desktop.
- Max-width de contenido: **1200px** centrado.
- Cards de producto: **16px radius**, padding interior 16px, gap de 12px entre card y card.

### Corner radii
- Botones e inputs: **10px** (default `--li-radius`)
- Cards de producto: **16px**
- Hero/banners grandes: **24px**
- Badges y chips: **pill** (999px)
- El logo y el power button son **círculos perfectos** — motivo visual del brand.

### Cards
- Fondo `#FFFFFF` sobre bg gris `#F4F4F4`.
- Hairline `1px solid #E5E5E5` — **no** sombra fuerte en reposo.
- Hover: sombra `--li-shadow-md` + `translateY(-2px)`, transición 200ms.
- Sin acentos de borde izquierdo coloreado. Sin gradientes violáceos. Sin emoji en cards.

### Shadows
- **Reposo**: hairline o `--li-shadow-xs`. El diseño es plano por default.
- **Hover de card**: `--li-shadow-md` (4px 16px rgba(10,10,10,0.08)).
- **CTA principal verde**: `--li-shadow-green` — glow verde sutil `0 8px 24px rgba(0,230,77,0.28)`. Este es el único elemento con "presencia luminosa".

### Backgrounds / imágenes
- **No gradientes decorativos** en backgrounds. La página es plana: gris o negro.
- **Hero**: fondo negro sólido + foto de producto fullbleed a la derecha, o fondo gris con producto y texto a la izquierda. Alternar.
- **Fotografía de producto**: fondo blanco o neutro, iluminación limpia de ecommerce. **Sin grain, sin viñeta, sin filtros warm.** Tal cual la recibís del proveedor.
- **Foto del local / confianza**: color, natural, sin filtro. Mostrar cara humana.

### Animación
- Easing por default: `cubic-bezier(0.2, 0.8, 0.2, 1)` — "ease-out con un pequeño overshoot".
- Duraciones: **120ms** (micro, hover-color), **200ms** (card lift, modales abrir), **320ms** (transición de página).
- **Sin bounces, sin parallax, sin scroll-jacking.** El sitio tiene que sentirse rápido y confiable, no "Awwwards".
- Loading: skeleton gris neutro pulsando, nunca spinners de colores.

### Hover / press states
- **Botón verde primario** hover: bg → `#00C944` + shadow glow más intenso. Press: bg → `#00A63A`, `scale(0.98)` 80ms.
- **Botón secundario outline negro** hover: bg negro + texto blanco (fill swap). Press: `scale(0.98)`.
- **Link** hover: color verde + underline verde.
- **Card** hover: shadow + lift 2px. **Nunca** cambiar el color de fondo de la card.
- **Icon button** hover: círculo gris `#EDEDED` detrás.

### Borders
- Hairline default: `1px solid #E5E5E5`.
- Inputs: `1px solid #D4D4D4`, focus `2px solid #00E64D` + outline-offset 2px.
- Divisores de sección: `1px solid #E5E5E5`, margin vertical generoso.

### Transparencia y blur
- **Sticky nav**: `rgba(255,255,255,0.85)` + `backdrop-filter: blur(12px)` cuando está sobre contenido.
- **Sticky nav sobre hero negro**: `rgba(10,10,10,0.72)` + blur.
- **Modales**: backdrop `rgba(10,10,10,0.6)` sin blur fuerte — el foco es el modal, no el efecto.

### Layout rules fijas
- **WhatsApp flotante verde** siempre bottom-right, 24px del borde, `56px` de diámetro, shadow verde.
- **Sticky bar inferior** en mobile con botón Comprar en PDP.
- En desktop los **precios en cuotas** van **inmediatamente debajo** del precio de contado, alineados a la izquierda, nunca al costado.

---

## Iconography

### Approach
**Line icons, stroke 1.75px, outline style, cap y join redondeados.** Estética cercana a **Lucide / Feather** — minimalista, consistente, se lleva bien con Inter.

### Sources
- **Lucide** vía CDN (`https://unpkg.com/lucide@latest`) — set principal. No hay icon-font custom; se importa bajo demanda.
- **Pixel cursor propio** (`assets/cursor-pixel.svg`) — cursor retro pixel-art que replica el del logo. Se usa como "firma" en el WhatsApp float, en el loader, o como decorativo junto al tagline. **Único icono con estética pixelada** — es el ADN visual, no abusarlo.
- **Logos de marcas** (Samsung, Xiaomi, Motorola, Apple, JBL, Mercado Pago, Naranja X, Visa, Mastercard, WhatsApp) — descargar cada uno de su brand kit oficial cuando corresponda y guardar en `assets/brands/`. En este kit usamos placeholders con el nombre de la marca.

### Emoji
- **No en la web.** Cero emoji en UI.
- **Sí en WhatsApp** (moderado).

### Unicode
- Permitido para símbolos funcionales: `$`, `·`, `→` en CTAs cortos ("Ver más →"), `✓` en listas de beneficios (dibujado como SVG Lucide preferentemente).

### Íconos críticos del kit
`search`, `shopping-cart`, `user`, `menu`, `x`, `chevron-right`, `chevron-down`, `truck`, `shield-check`, `check-circle`, `map-pin`, `phone`, `message-circle` (WhatsApp), `credit-card`, `zap` (power/destacados), `star`, `plus`, `minus`, `heart`.

---

## Deliverables / where to look

- **`preview/*.html`** → tarjetas que aparecen en el Design System tab.
- **`ui_kits/tienda/index.html`** → demo interactivo de la tienda (home → producto → checkout).
- **`colors_and_type.css`** → tokens listos para importar.
- **`SKILL.md`** → instrucciones para Claude Code u otros agentes que usen este folder como skill.

---

## Caveats / flags

- **Font substitution**: el brief pide "Inter, Space Grotesk o similar" + una display pixel/tech. Cargo desde Google Fonts (`Inter`, `Space Grotesk`, `VT323`). Si querés otras, decime y las cambio en `colors_and_type.css`.
- **Logos de marcas y pasarelas de pago**: uso placeholders tipografiados. Cuando consigas los SVG oficiales, guardalos en `assets/brands/` y actualizamos.
- **Fotos de producto y del local**: placeholders con fondo neutro. Hay que reemplazar por fotos reales (foto de la vidriera del local para la sección de confianza, producto del mes, hero del mes).
- **Paleta**: arranco exactamente con los hex que vinieron en el brief (`#0A0A0A`, `#00E64D`, `#F4F4F4`, `#FFFFFF`, `#6B6B6B`). El verde en texto sobre blanco se ajusta a `#00A63A` por contraste AA.

## Migrated from a legacy design system

This system was carried over from the standalone version on 2026-09-16. The part of this README the author wrote predates the move, so any file names in it are the old ones. Where things are now:

- the migration report, which lists what did not come across: `project/assets/notes/MIGRATION-REPORT.md`
