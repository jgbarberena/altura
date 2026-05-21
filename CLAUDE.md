# CLAUDE.md — experienciasanfermin.com

> Archivo de contexto para Claude Code. Contiene todo lo necesario para trabajar en este proyecto sin contexto adicional.

---

## 1. Quién soy y cómo trabajo

Soy Javier. Desarrollador no profesional con conocimientos sólidos de programación (clases, funciones, variables, contratos, dependencias) pero que necesita ayuda para escribir código desde cero. He programado en VBA, HTML, JS, C++, Matlab, Mathematica y Modelica. Entiendo el código cuando lo leo y sé expresar con precisión lo que quiero.

**Cómo quiero que me ayudes:**
- Guíame paso a paso con avance real y verificable. No me des todo de golpe.
- Cuando algo falla: diagnóstico primero (qué error exacto, dónde), luego solución mínima y concreta, luego verificación.
- Sé directo y honesto. Si hay una decisión que reconsiderar, dímelo aunque yo haya propuesto algo diferente.
- Cuando tengo que hacer algo en una interfaz externa (Supabase, GitHub, etc.), dime exactamente a qué pantalla ir, qué menú abrir y dónde hacer clic.
- Si ves deuda técnica, dímelo aunque no lo haya preguntado, pero sin insistir si decido dejarlo para después.
- Sin formateo excesivo: prosa cuando explicas, código limpio cuando programas, sin bullets innecesarios.
- No asumir que entiendo una herramienta nueva sin explicar antes qué es y cómo funciona.
- No proponer soluciones que funcionen solo para un caso particular sin pensar en la arquitectura general.

**Flujo de trabajo:**
- Algo nuevo: primero acordamos diseño y decisiones, luego implementamos en orden lógico (dependencias primero), luego verificamos con datos reales.
- Algo que falla: diagnóstico → solución mínima → verificación.

---

## 2. El proyecto

Web de reservas de balcones y experiencias para San Fermín en **experienciasanfermin.com** (también vivesanfermin.com), con panel de administración privado para uso propio.

**Volumen:** menos de 200 reservas, menos de 100 proveedores, 2-3 usuarios del panel.

### Stack

| Capa | Tecnología |
|---|---|
| Frontend público | HTML/CSS/JS puro, sin frameworks |
| Base de datos | Supabase (PostgreSQL), cliente JS oficial vía CDN (@supabase/supabase-js@2) |
| Panel de administración | Páginas HTML bajo `/admin/`, JS en módulos ES6, acceso directo a Supabase |
| Hosting | GitHub Pages + dominio propio (experienciasanfermin.com) |
| Entorno local | Live Server (VSCode) |
| Deploy | FTP a servidor externo (sftp.json con credenciales — no commitear cambios) |

No hay servidor propio. Toda la lógica de administración corre en el navegador del administrador.

---

## 3. Estructura de archivos

```
/
├── index.html                        ← home (generada por script PowerShell)
├── llms.txt                          ← descripción del sitio para crawlers/LLMs
├── robots.txt
├── sitemap.xml                       ← generado por GenerateSitemapXML.ps1
├── sftp.json                         ← credenciales FTP deploy (NO commitear cambios)
├── GenerateFolderAutoSEO.ps1         ← script PowerShell de SEO automático
├── GenerateSitemapXML.ps1            ← script PowerShell que genera sitemap.xml
├── css/
│   ├── style.css                     ← reset, variables globales, tipografía, layout base, botones, cards, slideshow
│   ├── components.css                ← estilos de componentes reutilizables (header, footer, formulario, etc.)
│   ├── home.css                      ← estilos específicos de la home
│   ├── articulo.css                  ← estilos de artículos/guías
│   ├── encierro.css, chupinazo.css, gigantes.css, procesion.css
│   ├── experiencias.css, personalizadas.css, empresa.css, guias.css
│   ├── momenticos.css, pobre-de-mi.css, toko.css, equipo.css
│   ├── programa-san-fermin.css       ← estilos del mapa/programa interactivo
│   ├── faq.css, legal.css
│   └── [sección].css                 ← un archivo por sección/página
├── js/
│   ├── include.js                    ← detecta BASE_URL, carga componentes dinámicamente, define resolveAsset/resolvePage
│   ├── main.js                       ← funciones init de cada componente (script clásico, no módulo)
│   ├── supabase-global.js            ← cliente Supabase público (window.supabasePublic, script clásico)
│   ├── analytics.js                  ← GA4 con carga condicional por consentimiento de cookies
│   ├── home.js                       ← gestiona el vídeo de fondo del hero en desktop (script clásico)
│   ├── disponibilidad.js             ← badges de disponibilidad en cards; consulta service_availability en Supabase (script clásico)
│   ├── guias-rotar-destacados.js     ← rota guías destacadas con lógica ponderada (lee JSON embebido)
│   ├── momenticos-cargar-testimonios.js ← carga testimonios desde JSON
│   └── programa-san-fermin.js        ← mapa interactivo de eventos de San Fermín (Leaflet)
├── components/
│   ├── header.html
│   ├── footer.html
│   ├── contact.html                  ← formulario de solicitud (escribe en reservation_requests)
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
├── momenticos/
│   ├── index.html
│   └── testimonios.json              ← datos de testimonios
├── faq/
│   ├── index.html                    ← generado por generate-faqHTML.ps1
│   ├── index-template.html           ← plantilla para generate-faqHTML.ps1
│   ├── faq-data.json                 ← datos de preguntas y respuestas
│   └── generate-faqHTML.ps1          ← script PowerShell que genera faq/index.html
├── admin/
│   ├── index.html                    ← login de Supabase Auth
│   ├── formulario.html               ← gestión de reservas (página principal del admin)
│   ├── panel.html                    ← panel de control con métricas y alertas
│   ├── proveedores.html              ← gestión de proveedores
│   ├── tablas.html                   ← vista de todas las tablas de Supabase
│   ├── css/
│   │   ├── admin.css                 ← estilos compartidos del panel de administración
│   │   ├── panel.css                 ← estilos específicos del panel de control
│   │   └── tablas.css                ← estilos específicos de la vista de tablas
│   └── js/
│       ├── formulario.js             ← lógica principal del panel de reservas (módulo ES6)
│       ├── factura.js                ← módulo de facturación (importado por formulario.js)
│       ├── propuesta.js              ← módulo de propuesta comercial PDF (importado por formulario.js)
│       ├── panel.js                  ← lógica del panel de control (módulo ES6)
│       ├── proveedores.js            ← lógica de gestión de proveedores (módulo ES6)
│       ├── tablas.js                 ← lógica de tablas (módulo ES6)
│       ├── sfcom.js                  ← comunicación con tienda.sanfermin.com via sf-api-paula.php (módulo ES6)
│       ├── supabase.js               ← cliente Supabase admin (export const supabase)
│       ├── utils.js                  ← utilidades compartidas del admin (fmt, fechas, persistencia)
│       └── auth.js                   ← requireAuth / logout
└── guias/
    ├── generate-index.ps1            ← script PowerShell que genera guias/index.html
    ├── index-template.html           ← plantilla para generate-index.ps1
    ├── index.html                    ← generado automáticamente por el script
    └── [artículo].html
```

---

## 4. Sistema de componentes y rutas (include.js)

`include.js` es el núcleo del sistema. Al cargarse, calcula `window.BASE_URL` eliminando `/js/include.js` de su propia URL. Esto hace que todo funcione igual en local (Live Server), GitHub Pages y dominio propio sin tocar nada.

**Funciones globales expuestas:**
- `resolveAsset(path)` → URL absoluta a un archivo del proyecto (imágenes, JSON, etc.)
- `resolvePage(path)` → URL absoluta a una página interna

**`loadComponent(placeholderId, componentPath, initFn)`:**
- Hace fetch del HTML del componente
- Lo inserta en el placeholder del DOM
- Copia los `data-attributes` del placeholder al elemento raíz del componente
- Llama a la función de inicialización con `(placeholder, resolveAsset, resolvePage)`

**Regla crítica:** Los enlaces en los componentes HTML nunca usan `href` directamente. Usan `data-page` (para páginas internas) o `data-file` (para assets). Las funciones de init los resuelven en runtime con `resolvePage()` y `resolveAsset()`.

**include.js es un script clásico** (no módulo), igual que main.js, porque necesitan funciones globales accesibles desde los componentes cargados dinámicamente. El admin usa módulos ES6 con import/export.

---

## 5. Sistema de estilos

### Variables globales (style.css)

```css
/* Fuentes */
--font-sans: Inter
--font-serif: Playfair Display

/* Colores */
--color-heading: #222
--color-body: #444
--accent: #b30000
--accent-dark: #800000
--accent-ok: (verde)
--accent-warn: (naranja)

/* Anchos de contenido */
--width-text: 740px
--width-mid: 860px
--width-main: 1100px
```

### Roles tipográficos (clases, nunca inline)

`.text-display`, `.text-title`, `.text-sub`, `.text-title2`, `.text-body`, `.text-body--intro`, `.text-quote`, `.text-tag`, `.text-small`, `.text-microcopy`, `.text-link`, `.text-logo`, `.text-detail`

**Variante `.on-dark`:** añadir esta clase a un contenedor invierte todos los roles tipográficos a versiones claras. Se usa en secciones con fondo oscuro.

### Secciones

- `.section` — padding horizontal y vertical fluido
- `.section--first` — primera sección, compensa el header fijo
- `.section--first--fullscreen` — hero pantalla completa
- `.section--inner` — secciones internas con padding estándar
- `.section--inner--sticky` — cuando hay sticky nav
- `.section--inner--flush` — sin padding-top

### Overlay universal

`.has-overlay` + `.overlay` aplica gradiente negro semitransparente sobre cualquier sección con imagen de fondo. Los hijos directos no-overlay tienen `z-index: 2` automáticamente.

### Cards y grids

- `.card` con `.card-overlay` para contenido superpuesto sobre imagen
- `.cards-grid` con variantes `--2`, `--3`, `--4`, `--6`

### Slideshow

`.slideshow` con animación CSS pura (`@keyframes slideshowFade`). Se inicializa con `initSlideshows()` en main.js.

---

## 6. Base de datos — Supabase

**URL:** `https://xpczeztrcupptsmqvmcu.supabase.co`  
**Proyecto ID:** `xpczeztrcupptsmqvmcu`  
**Key pública (anon):** `sb_publishable_jwz44-n-zQUn6RH0qLtbEg_uj0R9T3H`

Hay dos clientes Supabase:
- **Admin** (`/admin/js/supabase.js`): módulo ES6, `export const supabase`. Solo en el panel.
- **Público** (`/js/supabase-global.js`): script clásico, `window.supabasePublic`. Solo en páginas públicas que necesitan acceso (formulario de solicitud). Con `persistSession: false`.

### Tablas

**`clients`** — Clientes
| Campo | Tipo | Notas |
|---|---|---|
| id | text PK | En mayúsculas, elegido por el admin |
| name | text NOT NULL | |
| company | text | |
| phone | text | |
| email | text | |
| address | text | |
| nif | text | |
| comments | text | |

**`providers`** — Proveedores de balcones
| Campo | Tipo | Notas |
|---|---|---|
| id | text PK | |
| name | text | |
| address | text | |
| payment_method | text | |
| invoice | boolean | Si emite factura |
| comments | text | |

**`services`** — Servicios/eventos disponibles
| Campo | Tipo | Notas |
|---|---|---|
| id | text PK | Ej: `ENCIERRO_7`, `CHUPINAZO_6` |
| day | integer | Día de julio |
| event_type | text | |
| description | text | |
| comments | text | |
| start_time | text | Hora de inicio (ej: `'08:00'`) |
| image_url | text | URL de imagen representativa |

**`availability`** — Disponibilidad por proveedor y servicio
| Campo | Tipo | Notas |
|---|---|---|
| id | integer PK | |
| provider_id | text FK→providers | |
| service_id | text FK→services | |
| total_slots | integer NOT NULL | |
| price_per_slot | decimal | Coste que se paga al proveedor por plaza |
| billing_model | text NOT NULL | `'capacity'` o `'consumption'`; default `'capacity'` |
| comments | text | |
| sfcom_service_name | text | Nombre del servicio en sfcom (para inferir service_id desde pedidos) |
| sfcom_slots_listed | integer | Plazas publicadas en sfcom (puede diferir de total_slots) |
| sfcom_product_id | integer | ID del producto en WooCommerce |
| sfcom_variation_id | integer | ID de la variación del producto en WooCommerce (nullable si no hay variaciones) |

**`reservations`** — Reservas
| Campo | Tipo | Notas |
|---|---|---|
| id | text PK | Formato `R0001`, `R0002`… (R + 4 dígitos, correlativo) |
| client_id | text FK→clients | |
| service_id | text FK→services | |
| provider_id | text FK→providers | |
| slots | integer NOT NULL | |
| price_per_slot | decimal NOT NULL | Precio de venta al cliente por plaza |
| total_amount | decimal | Calculado por el JS: slots × price_per_slot (ver decisión 13.2) |
| status | text NOT NULL | `'Confirmada'`, `'Pendiente'`, `'Cancelada'`; default `'Pendiente'` |
| comments | text | |
| proposal_number | text | Número de propuesta emitida (serie PRP) |
| proposal_path | text | Ruta al PDF de la propuesta en Supabase Storage (bucket `proposals`) |
| sfcom_order_ref | text | Referencia del pedido de sfcom que originó esta reserva (ej: `WEB123_456`) |

**`charges`** — Hitos de cobro a clientes
| Campo | Tipo | Notas |
|---|---|---|
| id | integer PK | |
| client_id | text FK→clients | |
| amount | decimal NOT NULL | |
| due_date | date | |
| collected | boolean NOT NULL | default `false` |
| collected_date | date | |
| comments | text | |
| is_final | boolean NOT NULL | Hito final recalculado automáticamente; default `false` |
| invoiced | boolean NOT NULL | Si el hito ha sido facturado; default `false` |
| invoiced_at | date | Fecha en que se emitió la factura |
| invoice_number | text | Número de factura emitida (serie VSF); una vez asignado no se sobreescribe |
| invoice_path | text | Ruta al PDF de la factura en Supabase Storage (bucket `invoices`) |

**`payments`** — Pagos a proveedores
| Campo | Tipo | Notas |
|---|---|---|
| id | integer PK | |
| provider_id | text FK→providers | |
| amount | decimal NOT NULL | |
| due_date | date | |
| paid | boolean NOT NULL | default `false` |
| paid_date | date | |
| comments | text | `'Pago final'` identifica el hito final (deuda menor: no hay campo is_final) |

**`reservation_requests`** — Solicitudes recibidas desde la web pública o desde sfcom
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | Generado automáticamente por la BD (`gen_random_uuid()`) |
| client_name | text NOT NULL | |
| client_email | text | |
| client_phone | text | |
| client_address | text | Dirección del cliente (se rellena con datos de sfcom) |
| slots | integer | Número de plazas solicitadas |
| level | text | Slug del tipo de experiencia (web) o nombre del producto (sfcom) |
| day | integer | Día de julio preferido |
| comments | text | |
| status | text NOT NULL | `'nueva'`, `'atendida'`, `'descartada'`; default `'nueva'` |
| created_at | timestamptz | default `now()` |
| attended_at | timestamptz | Cuándo fue atendida o descartada |
| source | text | Referencia del pedido sfcom (ej: `WEB123_456`). Nulo si viene de la web. Se usa para evitar duplicados al re-sincronizar |
| price_per_slot | numeric | Precio bruto por plaza (solo en solicitudes de sfcom) |
| service_id | text | Campo reservado, sin FK. Actualmente sin uso funcional |

### Vista

**`service_availability`** — Plazas libres por servicio (vista calculada, solo lectura)
| Campo | Tipo | Notas |
|---|---|---|
| service_id | text | |
| free_slots | numeric | `sum(total_slots) - sum(slots reservados)` agregado por servicio y proveedor |

La vista agrega `availability` con las reservas `Confirmada` + `Pendiente`. La usa `disponibilidad.js` en el frontend público para mostrar los badges de disponibilidad por experiencia.

### Trigger

**`uppercase_ids`** — Trigger BEFORE INSERT OR UPDATE en todas las tablas con IDs de texto. Convierte automáticamente a mayúsculas los campos `id`, `client_id`, `provider_id` y `service_id` antes de persistir. Esto garantiza que los IDs son siempre mayúsculas en la BD independientemente de lo que envíe el JS.

### Principios de BD
- Fuente de verdad siempre. La BD nunca queda con datos incompletos ni huérfanos.
- Todo en snake_case y minúsculas (los IDs de texto son excepción: mayúsculas, reforzado por trigger).
- FK siempre presentes.
- Lógica de presentación en JS, no en BD. Excepción: la vista `service_availability` y el trigger `uppercase_ids` son lógica de integridad aceptable en BD.
- Cuando hay lógica calculada (totales, pagos finales), el JS calcula y corrige automáticamente en Supabase si detecta inconsistencia, notificando solo en consola (sin alertas al usuario).

---

## 7. Lógica del panel de administración

### 7.1 formulario.js — Gestión de reservas

Módulo ES6. Importa de `supabase.js`, `utils.js`, `factura.js`, `propuesta.js`.

El panel tiene **6 bloques** que se muestran/ocultan según el estado:

**Bloque 0 — Solicitudes pendientes:** Lee `reservation_requests` con `status='nueva'`. Las solicitudes de sfcom (`source` con formato `WEB\d+_\d+`) se muestran primero en rojo y sin botón "Descartar". Las solicitudes web se muestran en naranja con botón "Descartar". Click en fila carga nombre, email, teléfono, dirección, plazas, día y comentarios en el formulario. Para solicitudes sfcom, intenta inferir servicio y proveedor desde `availability.sfcom_service_name` (`_inferirDesdeSfcom`) y precarga el precio neto (precio bruto / 1.15). Para solicitudes web, infiere solo el servicio desde el slug (`_inferirServiceId`). El admin confirma o corrige siempre. Botón "Procesado" → status `atendida`. Nunca cambia status al hacer click en la fila.

**Bloque 1 — Cliente:** Campo `ID_CLIENTE` con autocomplete en tiempo real contra `clients`. Si el ID coincide exactamente con un cliente existente, carga sus datos y activa el guardado automático por campo (`change` → `supabase.update`). Si es un ID nuevo, muestra "Cliente nuevo". Los datos del cliente nunca se guardan manualmente; el guardado es automático en cuanto cambia cualquier campo de un cliente existente.

**Bloque 2 — Reserva:** Selector de servicio, selector de proveedor (se habilita y filtra al seleccionar servicio), número de plazas, precio por plaza, total calculado (plazas × precio, nunca editable directamente), estado (`Confirmada`/`Pendiente`) y comentarios. Los IDs de reserva tienen formato `RSV-NNN` (correlativo). Permite editar una reserva existente seleccionándola desde Bloque 4.

**Bloque 3 — Disponibilidad:** Se activa al seleccionar servicio. Mapa visual de columnas por proveedor con sus reservas actuales y estado de disponibilidad para el número de plazas introducido (verde/amarillo/rojo). Click en columna de proveedor con plazas insuficientes abre panel de reorganización.

**Bloque 4 — Reservas del cliente:** Tabla con todas las reservas del cliente cargado. Permite seleccionar reservas con checkbox para editar, cancelar o eliminar. Botón "Generar propuesta" → abre panel de propuesta.

**Bloque 5 — Cobros al cliente:** Tabla de hitos de cobro del cliente. Botón de facturación por hito. Hito final (`is_final: true`) se recalcula automáticamente vía `persistirCobrosCliente()`.

**Inferencia de service_id desde solicitudes web:**
```js
function _inferirServiceId(slug, day) {
    // Solo para cargar datos orientativos — el admin lo confirma manualmente
    if (partes.indexOf('encierro')  !== -1) return day ? 'ENCIERRO_' + day : null
    if (partes.indexOf('chupinazo') !== -1) return 'CHUPINAZO_6'
    if (partes.indexOf('procesion') !== -1) return 'PROCESION_7'
    if (partes.indexOf('gigantes')  !== -1) return 'DESPEDIDA_GIGANTES_14'
    if (partes.indexOf('pobre')     !== -1) return 'POBRE_DE_MI'
}
```

### 7.2 utils.js — Utilidades compartidas del admin

Exporta:
- `fmt(n)` — formatea como moneda EUR
- `fechaCobroDefault()` — 6 de julio del año en curso (o siguiente si ya pasó)
- `fechaPagoDefault()` — 15 de julio (misma lógica)
- `initSidebar()` — hamburger y overlay del sidebar
- `normalizar(str)` — mayúsculas + sin acentos (para búsquedas)
- `normalizarId(str)` — espacios→guiones bajos + mayúsculas
- `buscarConPrioridad(lista, texto, campos)` — búsqueda con 4 prioridades: empieza por id > campo2 > campo3 > contiene
- `persistirCobrosCliente(supabase, clienteId, todasReservas)` — recalcula y persiste el cobro final en `charges`. Si el hito ya tiene `invoice_number`, no lo sobreescribe; crea un hito de ajuste y alerta al usuario.
- `persistirPagosProveedor(supabase, proveedorId, todasReservas, todaDisponibilidad)` — recalcula y persiste el pago final en `payments`. Distingue modelo `capacity` (paga por plazas totales) y `consumption` (paga por plazas realmente reservadas).

### 7.3 factura.js — Módulo de facturación

Módulo ES6, importado por formulario.js. Se inicializa con `initFacturacion(supabaseClient)`.

Genera facturas PDF (usando `window.print()` o librería) para hitos de cobro. Tres tipos de factura:
- `adelanto` — pago parcial, quedan hitos pendientes
- `liquidacion` — pago final con adelantos previos ya facturados
- `unico` — pago único sin adelantos previos

**Config en FACTURA_CONFIG:**
```js
emisor_nombre: 'Paula Díaz Echalecu'
emisor_nif: '72694758S'
iva: 0.21
irpf: 0.15
serie: 'VSF'   // Prefijo: VSF-NN/AAAA
```

Los campos editables de la factura son `contenteditable` inline. El número de factura se calcula automáticamente como correlativo del ejercicio.

Persiste en `charges`: campo `invoice_number` cuando se emite, `invoiced: true`.

### 7.4 propuesta.js — Módulo de propuesta comercial

Módulo ES6, importado por formulario.js. Se inicializa con `initPropuesta(supabaseClient, serviciosData, providersData)`.

Genera una propuesta PDF para reservas seleccionadas de un cliente. El número de propuesta usa serie `PRP`. Los textos (título, intro, cierre, CTA) son editables en el mock-up. Incluye logo en base64 (cargado al inicializar).

### 7.5 panel.js — Panel de control

Módulo ES6. Lee en paralelo: `reservations`, `availability`, `services`, `providers`, `payments`, `charges`, `reservation_requests`.

Bloques:
- **Alertas críticas:** sobrereservas, pagos vencidos, cobros vencidos, solicitudes pendientes de la web.
- **Calendario de próximos pagos/cobros:** filtrable por 7/30 días o todos.
- **Estado financiero:** métricas de reservas, cobros y pagos con Chart.js.
- **Resumen por servicio/día:** tabla de ocupación.

**Nota importante:** El flujo de detección de pedidos sfcom en `panel.html` depende del endpoint `orders` de `sf-api-paula.php`, que no está confirmado por Hilario (ver deuda 12.1).

### 7.6 proveedores.js — Gestión de proveedores

Módulo ES6. Gestiona:
- CRUD de proveedores con autocomplete (igual que clientes en formulario.js)
- Disponibilidad por servicio: añadir/editar/eliminar entradas en `availability`
- Hitos de pago al proveedor: gestión de `payments` con modelo `capacity`/`consumption`
- Guardado automático por campo para proveedores existentes

### 7.7 tablas.js — Vista de tablas

Módulo ES6. Vista de solo lectura de todas las tablas: `reservations`, `charges`, `payments`, `availability`, `clients`, `providers`, `services`, `reservation_requests`. Selector de tabla, búsqueda en tiempo real, formateo de columnas con lambdas.

### 7.8 auth.js

```js
requireAuth()  // redirige a ./index.html si no hay sesión
logout()       // cierra sesión y redirige
```

La autenticación usa Supabase Auth. La página de login es `admin/index.html` (no en el proyecto actualmente, puede ser que sea la misma que el formulario en entorno sin sesión).

---

## 8. Frontend público

### 8.1 main.js — Funciones de inicialización

Script clásico (no módulo). Contiene todas las funciones `init*` de los componentes:

- `initHeader(root, resolveAsset, resolvePage)` — menú, logo, hamburger
- `initStickyNav(root, resolveAsset, resolvePage)` — navegación sticky
- `initMiniGallery(root, resolveAsset, resolvePage)` — galería pequeña
- `initSlideshows()` — slideshows CSS puro con spacer dinámico
- `initCookieBanner(root, resolveAsset, resolvePage)` — banner de cookies con localStorage (caducidad 90 días)
- `initFormulario(root, resolveAsset, resolvePage)` — formulario de solicitud (escribe en `reservation_requests` via `window.supabasePublic`)
- `initFooter(root, resolveAsset, resolvePage)` — footer con links
- `initToko(root, ...)`, `initMiniFAQ(root, ...)`, `initMiniGuias(root, ...)`, `initWhatsapp(root, ...)`
- `initContactoFromURL()` — abre el dialog de contacto si la URL tiene `?contacto=1`

### 8.2 solicitudDialog.html — Dialog de solicitud reutilizable

Componente de solicitud que se activa desde cualquier botón con `data-solicitud` en la página. Campos: nombre, email, teléfono, personas, día, comentarios. Escribe en `reservation_requests`. Si falla el guardado en Supabase, ofrece fallback por WhatsApp o email.

### 8.3 supabase-global.js — Cliente Supabase público

Script clásico. Crea `window.supabasePublic` con `persistSession: false` (no mantiene sesión entre páginas). Solo se incluye en páginas que necesitan acceso a Supabase (las que cargan el formulario de solicitud).

### 8.4 analytics.js — GA4 con consentimiento

- ID de medición: `G-L44JNZMWQR`
- Solo se carga si el usuario ha aceptado cookies
- Eventos automáticos: `cta_click` (delegación en document), `section_view` (IntersectionObserver al 30%)
- Evento manual: `trackFormSubmit(canal, interes)` llamado desde el formulario
- API pública: `window.activateAnalytics()` llamado desde el banner al aceptar

### 8.5 programa-san-fermin.js — Mapa interactivo

Mapa Leaflet con todos los eventos y localizaciones de San Fermín. Filtros por día y categoría. Panel lateral con detalle del evento seleccionado. Los datos están hardcodeados en el archivo (LOCATIONS + EVENTS). Tipos de evento: `diario`, `unico`, `variado`. Localizaciones: `point` o `route` (con polyline).

### 8.6 guias-rotar-destacados.js — Rotación de guías

Lee el JSON embebido en `<script id="guias-data" type="application/json">` (generado por `generate-index.ps1`) y aplica selección ponderada para rotar qué guías aparecen en los destacados en cada carga. Pesos: `fixed` > `high` > `medium` > `low`.

---

## 9. Sistema SEO automatizado (PowerShell)

### GenerateFolderAutoSEO.ps1

Se ejecuta desde la raíz del proyecto. Procesa todos los `.html` (excluyendo `img/`, `css/`, `js/`, `components/`).

**Elementos fuente que necesita cada página:**
```html
<!-- En el HTML: -->
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
<picture class="page-image-source">
    <img src="img/...">
</picture>
```

**Genera/sobreescribe:**
- `<!-- AUTO-SEO HEAD INIT --> ... <!-- AUTO-SEO HEAD END -->`: `<title>`, `<meta description>`, `<link canonical>`, Open Graph
- `<!-- AUTO-SEO BODY INIT --> ... <!-- AUTO-SEO BODY END -->`: schemas JSON-LD (Organization, LocalBusiness, Service, WebPage con ReserveAction si aplica, BreadcrumbList, Article si `data-page-type="article"`, FAQPage si hay elementos `.faq-item`)

**Regla crítica:** NUNCA editar el bloque AUTO-SEO directamente. Siempre editar los elementos fuente y ejecutar el script.

**FAQPage:** El script genera el schema `FAQPage` si la página contiene elementos `.faq-item` con un hijo `.faq-question` (h2) y un hijo `.faq-answer` (primer p). A mayo 2026, todas las páginas públicas tienen al menos 3 faq-items y generan FAQPage.

### generate-index.ps1

Se ejecuta dentro de `guias/`. Lee todos los `.html` de guías, extrae metadatos y genera `guias/index.html` con:
- Destacados y listado usando templates del `index-template.html`
- JSON embebido para `guias-rotar-destacados.js`

**Atributos necesarios en cada guía:**
```html
<article class="guia-articulo"
         data-category="core|rest"
         data-feature="fixed|high|medium|low"
         data-topics="encierro,balcones,...">
```

---

## 10. IDs de servicios conocidos

```
ENCIERRO_7  ENCIERRO_8  ENCIERRO_9  ENCIERRO_10  ENCIERRO_11  ENCIERRO_12  ENCIERRO_13  ENCIERRO_14
CHUPINAZO_6
PROCESION_7
DESPEDIDA_GIGANTES_14
POBRE_DE_MI
```

El producto 142 de sfcom corresponde a `POBRE_DE_MI`. El producto 147 (agrupado con hijos 215 y 216) corresponde a `DESPEDIDA_GIGANTES_14`.

---

## 11. Modelos de facturación de proveedores

**`capacity`:** El proveedor cobra por plazas totales contratadas, independientemente de cuántas se reserven. El pago final = `total_slots × price_per_slot`.

**`consumption`:** El proveedor solo cobra por plazas efectivamente reservadas. El pago final = `(suma de slots en reservas no canceladas) × price_per_slot`. Este importe se recalcula automáticamente en `payments` cada vez que cambia una reserva del proveedor.

---

## 12. Deudas técnicas pendientes

### 12.1 Endpoint `orders` de sf-api-paula.php — **Sin confirmar**
**Situación:** La nueva API `sf-api-paula.php` (acceso directo, clave `X-Paula-Key`) reemplaza al antiguo `woo-proxy.php`. El CORS ya está resuelto y el flujo B (PUT de stock) funciona. Sin embargo, la documentación de Hilario solo describe endpoints de `products` y `variations`; no menciona `orders`.

**Impacto:** `checkSfcomOrders` usa `GET orders?status=completed&...`. Si el endpoint no existe en `sf-api-paula.php`, el flujo A (detección de pedidos nuevos) fallará y mostrará el modal de aviso cada vez que se abra el panel.

**Acción pendiente:** Preguntar a Hilario si `sf-api-paula.php` soporta el endpoint `orders` con los mismos parámetros que la WooCommerce REST API estándar.

### 12.2 Disponibilidad en sfcom — **Pendiente diseño**
**Problema:** Los productos de sfcom (WooCommerce) no tienen disponibilidad real sincronizada con Supabase.

**Impacto:** La disponibilidad visible en la web de venta no refleja el estado real.

**Sub-tareas:**
- `Barrera Encierro`: sin variaciones ni disponibilidad configuradas en sfcom.
- `Visitas guiadas`: sin availability en sfcom ni en Supabase.
- `Pobre de Mí` (prod 142): situación sin aclarar.
- `Despedida Gigantes` (prod 147, agrupado con hijos 215/216): pendiente gestión de stock agrupado.

### 12.3 Solicitudes de formulario de contacto general — **Pendiente**
**Problema:** Las solicitudes del formulario de contacto general de la web todavía no se escriben en `reservation_requests`.

**Acción pendiente:** Conectar el formulario de contacto general a la tabla `reservation_requests` (igual que hace el `solicitudDialog`).

### 12.4 SEO — Indexación y errores GSC — **Pendiente revisión**
**Acción pendiente:** Repasar estado de indexación y errores en Google Search Console.

### 12.5 Inferencia de proveedor en solicitudes web — **Mejora pendiente**
**Situación:** Cuando una solicitud web corresponde a un servicio que solo tiene un proveedor con plazas disponibles, el sistema podría inferir automáticamente el proveedor. Actualmente el admin siempre lo selecciona manualmente.

**Decisión:** Dejado para después, no es bloqueante.

### 12.6 Ampliar faq-answers con más contenido — **Mejora SEO pendiente**
**Situación:** Las respuestas FAQ en la mayoría de páginas usan solo el primer `<p>` como `faq-answer`. En muchos casos tiene sentido incluir más párrafos o bloques dentro del mismo `faq-item` para enriquecer el schema FAQPage.

**Acción pendiente:** Revisar página a página y ampliar `faq-answer` (o marcar más `<p>` dentro del faq-item) donde el contenido adicional aporte valor como respuesta.

### 12.7 Al cargar solicitud no se limpian campos del cliente anterior — **Bug admin**
**Problema:** En `formulario.js`, cuando el admin hace click en una fila de `reservation_requests` para precargar datos, los campos del cliente anterior (nombre, email, teléfono, etc.) no se borran primero. Si la solicitud nueva tiene menos campos rellenos, quedan datos del cliente previo mezclados.

**Acción pendiente:** Limpiar todos los campos del formulario de cliente antes de precargar los datos de la solicitud seleccionada.

### 12.8 Precio en solicitudes sfcom usa coma en lugar de punto — **Bug admin**
**Problema:** El campo `price_per_slot` de las solicitudes que llegan desde sfcom puede venir con coma decimal (`"12,50"`) en lugar de punto (`"12.50"`). `parseFloat` en JS no interpreta la coma, devolviendo `NaN` o un valor incorrecto al precargar el precio neto.

**Acción pendiente:** Normalizar el valor antes del `parseFloat`: `str.replace(',', '.')`.

### 12.9 Mejora de micro-story y background image — **Mejora UX pendiente**
**Situación:** Las secciones con micro-story (textos breves de apoyo narrativo) y las imágenes de fondo tienen margen de mejora visual y de contenido. No hay un criterio uniforme de cuándo usar una u otra, ni se han optimizado todos los casos.

**Acción pendiente:** Definir criterio y revisar secciones afectadas.

### 12.10 Unificar selección aleatoria de guías y destacados — **Deuda técnica menor**
**Situación:** Hay al menos dos implementaciones independientes de selección aleatoria/ponderada: `guias-rotar-destacados.js` para la rotación de guías, y lógica inline en otras partes. La lógica de selección aleatoria ponderada debería estar en una sola función reutilizable.

**Acción pendiente:** Extraer a función compartida (ej. en `main.js` o un nuevo `utils-public.js`) y eliminar duplicados.

---

## 13. Decisiones de arquitectura tomadas

### 13.1 Sin servidor propio
Todo corre en el navegador. Supabase es el único backend. Esta decisión es deliberada y permanente para el volumen del proyecto (< 200 reservas). No cambiar por complejidad técnica.

### 13.2 No hay total_amount calculado en BD
El campo `total_amount` en `reservations` es un campo guardado (no una columna calculada de PostgreSQL). Lo calcula el JS antes de insertar/actualizar. Razón: simplicidad, el volumen no justifica triggers de BD.

### 13.3 charges es por cliente, no por reserva
La tabla `charges` tiene `client_id` (no `reservation_id`). Razón: un cliente puede tener múltiples reservas y el cobro se gestiona a nivel cliente, no por reserva individual. El hito final (`is_final: true`) se recalcula automáticamente considerando todas las reservas del cliente.

### 13.4 payments es por proveedor, no por servicio
La tabla `payments` tiene `provider_id` (no `service_id`). El pago final consolida todos los servicios del proveedor. Razón: simpleza operativa.

### 13.5 ID de cliente libre (no email, no numérico)
El admin elige el ID del cliente libremente (ej: `GARCIA_PEDRO`). No hay ID autogenerado. Razón: el ID se usa para identificar al cliente en el panel rápidamente y tiene que ser memorable.

### 13.6 Módulos ES6 solo en admin
El frontend público usa scripts clásicos (no módulos) porque `include.js` y `main.js` necesitan exponer funciones globales accesibles desde los componentes cargados dinámicamente por fetch. El admin usa módulos ES6 sin problema porque no necesita esa dinámica.

### 13.7 Sin frameworks en el frontend público
HTML/CSS/JS puro. Sin React, Vue, ni ningún framework. Deliberado: el volumen y los requisitos no lo justifican, y añadiría complejidad de build.

### 13.8 Supabase anon key en el frontend
La `anon key` de Supabase es pública y está en el código. Es la key `anon` de Supabase, no la `service_role`. Las políticas RLS de Supabase controlan qué puede hacer cada rol. Esta es la arquitectura estándar de Supabase para frontends sin servidor.

### 13.9 Número de factura correlativo por ejercicio (año)
Las facturas usan serie `VSF-NN/AAAA`. El número correlativo se calcula consultando las facturas del año en curso en `charges` (campo `invoice_number`). El ejercicio fiscal empieza en enero.

### 13.10 Hito final de pago al proveedor identificado por comments='Pago final'
El hito final en `payments` se identifica por `comments === 'Pago final'` (no por un campo booleano propio como en `charges`). Deuda técnica menor: sería más robusto un campo `is_final` como en `charges`.

### 13.11 Panel de reorganización de reservas
Cuando un admin hace click en un proveedor sin plazas suficientes desde el mapa de disponibilidad, se abre un panel de reorganización que permite reubicar reservas existentes a otros proveedores con disponibilidad.

---

## 14. Convenciones de código

### HTML
- Rutas siempre relativas en el HTML (de esto se ocupa `include.js` en runtime).
- Sin estilos inline salvo `display:none` u otros puntuales.
- Sin bloques `<style>` dentro del HTML.
- Los `data-*` del placeholder se copian automáticamente al root del componente por `loadComponent`.
- Los marcadores SEO (`<!-- AUTO-SEO HEAD INIT -->` etc.) son obligatorios en todas las páginas públicas.

### CSS
- Un archivo por sección/propósito.
- Variables globales siempre en `style.css`.
- Nunca estilos tipográficos inline; siempre clases de rol (`.text-title`, etc.).
- Diseño responsivo con `clamp()` para tamaños fluidos.

### JavaScript
- Siempre en archivos separados, nunca inline en el HTML.
- Módulos ES6 (`import`/`export`) en el admin.
- Scripts clásicos en el frontend público.
- Comentarios funcionales: qué hace y para qué sirve. **Nunca comentarios relativos a cambios** (sin "// Añadido el 12 de mayo", sin "// TEMPORAL", etc.).
- Sin código duplicado: si algo se repite, se extrae a función o archivo compartido (ver `utils.js`).
- `async/await` para todas las llamadas a Supabase.
- Errores de Supabase: `console.error()` siempre. Alertas al usuario solo cuando es imprescindible para su acción.

### Supabase / BD
- Todo en snake_case y minúsculas.
- FK siempre presentes y respetadas.
- La BD es fuente de verdad. Nunca queda inconsistente.
- La lógica calculada (totales, pagos finales) se persiste automáticamente sin intervención del admin.

### Nomenclatura
- IDs de reserva: `R` + 4 dígitos correlativo (ej: `R0001`, `R0012`). El JS calcula el siguiente con `select id order by id desc limit 1` → `parseInt(id.slice(1)) + 1`.
- IDs de servicio: `TIPO_DIA` en mayúsculas (ej: `ENCIERRO_7`, `CHUPINAZO_6`)
- IDs de cliente: texto libre en mayúsculas elegido por el admin (ej: `GARCIA_PEDRO`)
- IDs de proveedor: texto libre en mayúsculas (ej: `BALCON_MERCED_1`)

---

## 15. Prioridades al tomar decisiones

1. **Que funcione y sea robusto.** Primero.
2. **Que sea mantenible y limpio.** Segundo.
3. **Que sea bonito.** Tercero.

Si algo es complejo de implementar y el beneficio es estético, se deja para después o no se hace. Soluciones gratuitas siempre que sea posible para este volumen; si algo requiere pago, avisar y decidir. Consistencia sobre perfección: si algo funciona de una forma en un sitio, funciona igual en todos.

---

## 16. Entorno de desarrollo

- **Editor:** VSCode con Live Server
- **Deploy:** FTP a `185.50.45.33` con las credenciales de `sftp.json`. La extensión FTP-Simple o similar. `uploadOnSave: false` (no subir automáticamente).
- **Scripts PowerShell:** ejecutar desde la raíz del proyecto (SEO general) o desde `guias/` (índice de guías).
- **No hay proceso de build.** No hay npm scripts, no hay bundler, no hay transpilación. Lo que ves es lo que se sirve.

---

## 17. Páginas y secciones del frontend público

| Archivo | Descripción |
|---|---|
| `index.html` | Home (generada por script) |
| `encierro-balcon-privado/` | Balcón privado para el encierro |
| `chupinazo-exclusivo/` | Chupinazo |
| `ver-encierro-pamplona/` | Opciones para ver el encierro |
| `ver-procesion-san-fermin/` | Procesión |
| `experiencias-exclusivas-san-fermin/` | Landing experiencias |
| `experiencias-personalizadas/` | Experiencias a medida |
| `hospitality-corporativo/` | Hospitality para empresas |
| `san-fermin-autentico/` | San Fermín auténtico |
| `san-fermin-desde-dentro/` | San Fermín desde dentro |
| `san-fermin-mas-alla/` | Más allá del encierro |
| `primera-vez-san-fermin/` | Para quienes van por primera vez |
| `que-hacer-san-fermin/` | Qué hacer en San Fermín |
| `mananas-sanfermineras/` | Las mañanas de San Fermín |
| `programa-san-fermin/` | Mapa interactivo de eventos |
| `guias/` | Índice y artículos de guías |
| `equipo/` | Quiénes somos |
| `legal/` | Aviso legal |
| `faq/` | Preguntas frecuentes |
| `toko/` | Productos personalizados To-Ko Collection |

---

## 18. Notas sobre el dominio y naming

- El proyecto empezó como `experienciasanfermin.com` y también opera bajo `vivesanfermin.com`.
- En el código y la BD, la marca es "Vive San Fermín" o "Vive San Fermín a medida".
- El emisor fiscal de las facturas es **Paula Díaz Echalecu** (NIF: 72694758S).
- El admin de la empresa es Javier; Paula es quien firma los documentos comerciales.

---

## 19. Dependencias externas (CDN)

**Frontend público:**
```html
<!-- Supabase (solo en páginas con formulario) -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

<!-- Google Analytics (carga dinámica, solo con consentimiento) -->
<!-- gtag.js — gestionado por analytics.js -->

<!-- Leaflet (solo en programa-san-fermin) -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

**Panel de administración:**
```html
<!-- Supabase (módulo ES6 en supabase.js) -->
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

<!-- Chart.js (solo en panel.html) -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
```

---

## 20. Lo que no quiero

- Sin código duplicado. Si algo se repite, se extrae a función o archivo compartido.
- Sin formateo excesivo en las respuestas: prosa cuando explicas, código limpio cuando programas, sin bullets innecesarios.
- No asumir que entiendo una herramienta nueva sin explicar antes qué es y cómo funciona.
- No proponer soluciones que funcionen solo para un caso particular sin pensar en la arquitectura general: antes de implementar algo, valorar si es coherente con el resto del sistema.
- No editar el bloque AUTO-SEO directamente. Siempre editar los elementos fuente y ejecutar el script.
- No poner lógica de negocio en la BD (triggers, funciones PostgreSQL) salvo que haya una razón de peso. La lógica está en el JS.
