# CLAUDE_WEB.md — Frontend público

> Referencia completa del frontend público. Lee primero `CLAUDE.md` para el contexto transversal del proyecto.

---

## 1. Propósito y filosofía

Web de captación y solicitud de experiencias de San Fermín en **experienciasanfermin.com**. El concepto es "contacta y te buscamos lo mejor": no hay catálogo de balcones específicos ni precios en la web pública. Las solicitudes de los visitantes van a `reservation_requests` en Supabase.

El catálogo de balcones (`/catalogo/`) es una sección separada, no indexada, solo accesible por URL directa compartida por Paula con clientes concretos.

---

## 2. Estructura de archivos

```
/
├── index.html                        ← home (generada por GenerateFolderAutoSEO.ps1 a partir de fuentes)
├── llms.txt                          ← descripción del sitio para crawlers/LLMs
├── robots.txt
├── sitemap.xml                       ← generado por GenerateSitemapXML.ps1
├── deploy.ps1                        ← script de deploy
├── GenerateFolderAutoSEO.ps1         ← script PowerShell de SEO automático
├── GenerateSitemapXML.ps1
├── css/
│   ├── style.css                     ← reset, variables globales, tipografía, layout base, botones, cards, slideshow
│   ├── components.css                ← header, footer, formulario, y demás componentes reutilizables
│   ├── home.css                      ← estilos específicos de la home
│   ├── articulo.css                  ← artículos/guías
│   └── [sección].css                 ← un archivo por sección/página
├── js/
│   ├── include.js                    ← núcleo del sistema de componentes (script clásico)
│   ├── main.js                       ← funciones init de cada componente (script clásico)
│   ├── supabase-global.js            ← window.supabasePublic, persistSession: false (script clásico)
│   ├── analytics.js                  ← GA4 con consentimiento de cookies
│   ├── home.js                       ← vídeo de fondo del hero en desktop
│   ├── disponibilidad.js             ← badges de disponibilidad; consulta service_availability en Supabase
│   ├── guias-rotar-destacados.js     ← rotación ponderada de guías destacadas
│   ├── momenticos-cargar-testimonios.js
│   ├── programa-san-fermin.js        ← mapa Leaflet de eventos (guía principal)
│   └── programa-san-fermin-embed.js  ← versión standalone para iframe; URLs absolutas, links target="_blank"
├── components/
│   ├── header.html
│   ├── footer.html
│   ├── contact.html                  ← formulario de contacto general
│   ├── stickyNav.html
│   ├── miniGallery.html
│   ├── miniGuias.html
│   ├── miniFAQ.html
│   ├── toko.html
│   ├── whatsapp.html
│   ├── cookieBanner.html
│   └── solicitudDialog.html          ← dialog de solicitud reutilizable (data-solicitud)
├── [sección]/
│   ├── index.html
│   └── [artículo].html
├── catalogo/                         ← fichas internas de venues (no indexadas)
│   ├── index.html
│   ├── balcon.html
│   ├── catalogo.js
│   └── catalogo.css
├── guias/
│   ├── generate-index.ps1
│   ├── index-template.html
│   ├── index.html                    ← GENERADO — no editar directamente
│   ├── programa-san-fermin-embed.html ← embed standalone del mapa
│   └── [artículo].html
├── momenticos/
│   ├── index.html
│   └── testimonios.json
└── faq/
    ├── generate-faqHTML.ps1
    ├── index-template.html
    ├── faq-data.json
    └── index.html                    ← GENERADO — no editar directamente
```

---

## 3. Sistema de componentes (include.js)

`include.js` es el núcleo del sistema. Es un **script clásico** (no módulo) porque necesita exponer funciones globales accesibles desde los componentes cargados dinámicamente.

**Al cargarse:** calcula `window.BASE_URL` eliminando `/js/include.js` de su propia URL. Funciona igual en local (Live Server), GitHub Pages y dominio propio sin tocar nada.

**Funciones globales expuestas:**
- `resolveAsset(path)` → URL absoluta a un archivo del proyecto (imágenes, JSON, etc.)
- `resolvePage(path)` → URL absoluta a una página interna

**`loadComponent(placeholderId, componentPath, initFn)`:**
1. Fetch del HTML del componente
2. Inserción en el placeholder del DOM
3. Copia de los `data-attributes` del placeholder al elemento raíz del componente
4. Llamada a `initFn(placeholder, resolveAsset, resolvePage)`

**Regla crítica:** los enlaces en los componentes HTML nunca usan `href` directamente. Usan `data-page` (páginas internas) o `data-file` (assets). Las funciones de init los resuelven en runtime.

---

## 4. Sistema de estilos

### Variables globales (`style.css`)

```css
--font-sans: Inter
--font-serif: Playfair Display

--color-heading: #222
--color-body: #444
--accent: #b30000
--accent-dark: #800000
--accent-ok: (verde)
--accent-warn: (naranja)

--width-text: 740px
--width-mid: 860px
--width-main: 1100px
```

### Clases tipográficas (nunca estilos tipográficos inline)

`.text-display`, `.text-title`, `.text-sub`, `.text-title2`, `.text-body`, `.text-body--intro`, `.text-quote`, `.text-tag`, `.text-small`, `.text-microcopy`, `.text-link`, `.text-logo`, `.text-detail`

**Variante `.on-dark`:** añadir esta clase a un contenedor invierte todos los roles tipográficos a versiones claras. Se usa en secciones con fondo oscuro.

### Secciones

- `.section` — padding horizontal y vertical fluido
- `.section--first` — **primera sección de cualquier página**. En desktop: `calc(var(--header-height) + clamp(20px, 3vw, 50px))`. Compensa el header fijo.
- `.section--first--fullscreen` — hero pantalla completa (home, experiencias, empresa, momenticos, toko)
- `.section--inner` — secciones internas; **nunca la primera**
- `.section--inner--sticky` — sección que sigue a un sticky nav; `padding-top: var(--sticky-height)`
- `.section--inner--flush` — sin padding-top (CTAs, sección autora en artículos)

**Regla crítica:** la primera sección de cada página usa siempre `section--first` o `section--first--fullscreen`, nunca `section--inner`. Los `<main>` con clase propia (`articulo-page`, `guias-page`) no deben tener `padding-top` en desktop: la compensación la gestiona `section--first` dentro.

### Sticky nav

Tiene `margin-bottom: calc(-1 * var(--sticky-height))` para solaparse visualmente con el `padding-top` de la sección sticky desde el primer render. El `padding-left/right` coincide con el de `.section` para alinear los links con el contenido.

### Scroll snap

Activo solo en mobile (`scroll-snap-type: y proximity` en `html`). **Desactivado explícitamente en desktop** (`scroll-snap-type: none` en media query ≥769px): el inertia scrolling del trackpad de Mac es incompatible. No reactivar en desktop.

### Overlay universal

`.has-overlay` + `.overlay` aplica gradiente negro semitransparente sobre cualquier sección con imagen de fondo. Los hijos directos no-overlay tienen `z-index: 2` automáticamente.

### Cards y grids

- `.card` con `.card-overlay` para contenido superpuesto
- `.cards-grid` con variantes `--2`, `--3`, `--4`, `--6`

### Slideshow

`.slideshow` con animación CSS pura (`@keyframes slideshowFade`). Inicializado con `initSlideshows()` en main.js.

---

## 5. Scripts del frontend público

### main.js
Script clásico. Contiene todas las funciones `init*` de los componentes:
- `initHeader`, `initStickyNav`, `initMiniGallery`, `initSlideshows`
- `initCookieBanner` — localStorage, caducidad 90 días
- `initFormulario` — formulario de solicitud (escribe en `reservation_requests` via `window.supabasePublic`)
- `initFooter`, `initToko`, `initMiniFAQ`, `initMiniGuias`, `initWhatsapp`
- `initContactoFromURL` — abre el dialog si la URL tiene `?contacto=1`

### supabase-global.js
Script clásico. Crea `window.supabasePublic` con `persistSession: false`. Solo incluido en páginas que necesitan Supabase (formulario de solicitud, catálogo).

### disponibilidad.js
Script clásico. Lee de `service_availability` (vista pública, anon) y muestra badges de disponibilidad en las cards de la web (`'disponible'`, `'pocas'`, `'agotado'`).

### analytics.js
GA4, ID de medición `G-L44JNZMWQR`. Solo se carga si el usuario ha aceptado cookies. Eventos automáticos: `cta_click` (delegación en document), `section_view` (IntersectionObserver al 30%). Evento manual: `trackFormSubmit(canal, interes)`. API pública: `window.activateAnalytics()` llamado desde el banner al aceptar.

### home.js
Gestiona el vídeo de fondo del hero en desktop. Sin lógica compleja.

### guias-rotar-destacados.js
Lee el JSON embebido en `<script id="guias-data" type="application/json">` (generado por `generate-index.ps1`). Aplica selección ponderada para rotar qué guías aparecen en los destacados en cada carga. Pesos: `fixed > high > medium > low`.

---

## 6. Formulario de solicitudes (frontend)

### solicitudDialog.html — Dialog reutilizable
Se activa desde cualquier botón con `data-solicitud="slug"`. Campos: nombre, email, teléfono, personas, día, comentarios. Escribe en `reservation_requests` con `conversation_notes = JSON.stringify({slug, day, slots, comment})` — estado temporal que el admin convierte a `proposal_draft` + log mediante `_procesarWebFormsSinProcesar()`. Si falla el guardado en Supabase, fallback por WhatsApp o email.

**Para activar en una página:**
1. `<div id="solicitud-dialog-placeholder"></div>` en el HTML
2. CDN de Supabase antes de los demás scripts
3. `<script src="../js/supabase-global.js"></script>`

**Comportamiento del selector de día (configurado en main.js):**
- `_SD_DIA_FIJO`: selector oculto con valor fijo (chupinazo→6, procesion→7, gigantes→14, pobre-de-mi→14)
- `_SD_SIN_DIA`: selector oculto sin valor. Actualmente: `['toko']`
- Por defecto (encierro, personalizadas…): selector visible

### contact.html — Formulario de contacto general
Componente cargado por include.js. Escribe en `reservation_requests`. El formulario no obliga a introducir email ni teléfono (para minimizar fricción). Sus CTAs son WhatsApp y mailto, por lo que el contacto llega directamente al dispositivo del admin.

---

## 7. Sistema SEO automatizado

### GenerateFolderAutoSEO.ps1
Se ejecuta desde la raíz del proyecto. Procesa todos los `.html` (excluyendo `img/`, `css/`, `js/`, `components/`).

**Elementos fuente necesarios en cada página:**
```html
<div class="page-data"
     data-page-title="Título explícito"
     data-page-type="website|landing|article"
     data-author="Nombre"
     data-published="YYYY-MM-DD"
     data-modified="YYYY-MM-DD"
     data-image-fallback="img/...">
</div>
<h1 class="page-title-source">Título visible</h1>
<p class="page-description-source">Descripción para meta.</p>
<picture class="page-image-source"><img src="img/..."></picture>
```

**Genera/sobreescribe:**
- `<!-- AUTO-SEO HEAD INIT --> ... <!-- AUTO-SEO HEAD END -->`: `<title>`, `<meta description>`, `<link canonical>`, Open Graph
- `<!-- AUTO-SEO BODY INIT --> ... <!-- AUTO-SEO BODY END -->`: schemas JSON-LD (Organization, LocalBusiness, Service, WebPage con ReserveAction si aplica, BreadcrumbList, Article si `data-page-type="article"`, FAQPage si hay elementos `.faq-item`)

**FAQPage:** se genera si la página contiene elementos `.faq-item` con `.faq-question` (h2) y `.faq-answer` (párrafo). Todas las páginas públicas deben tener al menos 3 faq-items.

**REGLA CRÍTICA:** nunca editar el bloque AUTO-SEO directamente. Siempre editar los elementos fuente y ejecutar el script.

### GenerateSitemapXML.ps1
Genera `sitemap.xml` con todas las páginas públicas.

### Orden correcto de regeneración

Siempre en este orden:
1. `guias/generate-index.ps1` (desde `guias/`) y `faq/generate-faqHTML.ps1` (desde `faq/`) — pueden ejecutarse en paralelo
2. `GenerateFolderAutoSEO.ps1` (desde la raíz) — siempre después

El deploy.ps1 hace esto automáticamente en el orden correcto.

---

## 8. Sistema de guías

### generate-index.ps1 (en guias/)
Lee todos los `.html` de guías, extrae metadatos y genera `guias/index.html` con:
- Destacados usando `<template id="tpl-destacado">`
- Listado usando `<template id="tpl-listado">`
- JSON embebido en `<script id="guias-data" type="application/json">` para `guias-rotar-destacados.js`

**Atributos necesarios en cada artículo:**
```html
<article class="guia-articulo"
         data-category="core|rest"
         data-feature="fixed|high|medium|low"
         data-topics="encierro,balcones,...">
```

**REGLA CRÍTICA:** nunca editar `guias/index.html` directamente. Editar las fuentes y regenerar.

### Cards de guías destacadas
`<article class="card guia-destacada">` + `<a class="guia-link">` (posición absoluta, toda la card clicable) + `<picture>` + `<div class="card-overlay">` → `<h2>` + `<div class="card-overlay-body"><p>`.

---

## 9. Sistema de FAQ

### generate-faqHTML.ps1 (en faq/)
Lee `faq-data.json`, usa `faq/index-template.html` como plantilla, inyecta secciones en `{{SECTIONS}}`, genera `faq/index.html`.

**Campos del JSON:**
```json
{ "id": "exp-1", "category": "Experiencias", "question": "...", "answer": "..." }
```

**REGLA CRÍTICA:** nunca editar `faq/index.html` directamente.

---

## 10. Mapa interactivo (programa de San Fermín)

### programa-san-fermin.js
Mapa Leaflet 1.9.4 con todos los eventos y localizaciones. Filtros por día y hora. Datos hardcodeados en el archivo (`LOCS` + `EVENTS`). Tipos de evento: `diario`, `unico`, `variado`. Tipos de localización: `point`, `route` (polyline), `area` (polígono).

**Panel lateral:** siempre muestra todos los eventos del filtro activo. Click en mapa o ítem de lista expande ese ítem (acordeón); resto colapsado pero visible.

**Slider de hora:** rango -1..17 mapeado a `null` (Todo el día) y horas 6–23. Las horas 0–5 están eliminadas del slider.

**Capas Leaflet:** las áreas usan pane personalizado `areaPane` (z-index 350) para renderizar siempre por debajo de las rutas.

**Patrón crítico — click en panel:** el handler del panel debe tener `e.stopPropagation()` como primera línea. Sin él, `showPanelList()` reemplaza `panel.innerHTML`, el elemento clicado queda desconectado del DOM, y el listener de `document` llama a `showPanelList(null)` colapsando el ítem recién expandido.

**Convención del día 6:** los eventos recurrentes diarios (Barracas, Casetas Regionales, Corralillos del Gas) usan `F7_14`, no `F6_14`. Solo los eventos que ocurren explícitamente el día 6 llevan `'2026-07-06'` en sus `fechas`.

### Embed del mapa (programa-san-fermin-embed.js + programa-san-fermin-embed.html)

La guía `guias/programa-san-fermin.html` incluye un `<iframe src="programa-san-fermin-embed.html">`. El embed es completamente standalone: sin `include.js`, sin header/footer, sin dependencia de `BASE_URL`. Leaflet y fuentes se cargan desde CDN.

`programa-san-fermin-embed.js` es una copia de `programa-san-fermin.js` con dos diferencias:
- `EVENT_PAGES`: todos los `href` e `img` usan URLs absolutas a `https://www.experienciasanfermin.com/...`
- El enlace generado en `buildTooltipHTML` lleva `target="_blank" rel="noopener"`

**REGLA CRÍTICA:** si se actualiza el mapa (nuevos eventos, corrección de datos), editar **ambos archivos JS** para mantenerlos sincronizados.

El HTML del embed tiene los estilos en un `<style>` inline con las variables CSS del sistema (necesario porque `style.css` no se carga). Layout con `flex` para que el mapa ocupe todo el espacio disponible sin alturas hardcodeadas en vh.

---

## 11. Dependencias externas (CDN)

**Frontend público:**
```html
<!-- Supabase (solo en páginas con formulario o catálogo) -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

<!-- Leaflet (solo en programa-san-fermin-embed.html) -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
```

**Panel de administración:**
```html
<!-- Supabase (módulo ES6 en supabase.js) -->
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

<!-- Chart.js (solo en panel.html) -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3/dist/chartjs-adapter-date-fns.bundle.min.js"></script>

<!-- SheetJS (cargado dinámicamente en utils.js via import() solo al primer click de exportar) -->
```

---

## 12. Páginas del frontend público

| Ruta | Descripción |
|---|---|
| `index.html` | Home |
| `encierro-balcon-privado/` | Balcón privado para el encierro |
| `chupinazo-exclusivo/` | Chupinazo |
| `ver-encierro-pamplona/` | Opciones para ver el encierro |
| `ver-procesion-san-fermin/` | Procesión |
| `experiencias-exclusivas-san-fermin/` | Landing experiencias |
| `experiencias-personalizadas/` | Experiencias a medida |
| `hospitality-corporativo/` | Hospitality para empresas |
| `san-fermin-autentico/`, `san-fermin-desde-dentro/`, `san-fermin-mas-alla/` | Landings de concepto |
| `primera-vez-san-fermin/`, `que-hacer-san-fermin/`, `mananas-sanfermineras/` | Contenido informativo |
| `programa-san-fermin/` | Mapa interactivo de eventos |
| `guias/` | Índice y artículos de guías |
| `equipo/` | Quiénes somos |
| `legal/` | Aviso legal |
| `faq/` | Preguntas frecuentes |
| `toko/` | Productos To-Ko Collection |
| `momenticos/` | Testimonios |
| `catalogo/` | Fichas de venues (no indexado) |

---

## 13. Deuda técnica activa de la web

**Bilingüe ES/EN** — arquitectura acordada: templates `.src.html` con atributo `data-lang` en elementos traducibles, script PowerShell que genera `index.html` (ES) e `index-en.html` (EN) desde el template. Las URL serían `/en/experiencias.html` etc. Pendiente de implementar para la temporada siguiente. No empezar sin revisar el diseño completo primero con claude.ai.

**ItemList JSON-LD** — para la home e índice de guías (pendiente, mejora SEO de listados).

**GSC indexing errors** — pendiente de revisar estado de indexación y errores en Google Search Console.
