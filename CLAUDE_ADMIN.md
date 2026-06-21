# CLAUDE_ADMIN.md — Panel de administración

> Referencia completa del panel de admin (`/admin/`). Lee primero `CLAUDE.md` para el contexto transversal del proyecto.

---

## 1. Supabase

**URL:** `https://xpczeztrcupptsmqvmcu.supabase.co`  
**Project ID:** `xpczeztrcupptsmqvmcu`  
**Anon key (pública):** `sb_publishable_jwz44-n-zQUn6RH0qLtbEg_uj0R9T3H`

Dos clientes Supabase:
- **Admin** (`/admin/js/supabase.js`): módulo ES6, `export const supabase`. Solo en el panel.
- **Público** (`/js/supabase-global.js`): script clásico, `window.supabasePublic`, `persistSession: false`. Solo en páginas públicas que necesitan acceso (formulario de solicitud, catálogo).

### Edge Functions

Las Edge Functions corren en el runtime de Deno de Supabase. **No se despliegan por FTP ni git** — solo desde el Dashboard (editor de código de cada función) o vía Supabase CLI. El directorio `supabase/functions/` del repo es la copia de referencia; está excluido del deploy FTP.

**Funciones activas:**

| Función | JWT | Propósito |
|---|---|---|
| `claude-proxy` | ON | Proxy a Claude API. Verifica JWT en gateway. |
| `sfcom-bridge` | ON | Proxy a sf-api-paula.php. Resuelve CORS server-to-server. |
| `upload-venue-photo` | ON | Sube imagen al FTP de producción, devuelve URL pública. |
| `notificar-solicitud` | — | Disparada por trigger DB al insertar en `reservation_requests`. |

**Patrón de llamada desde JS:** siempre `supabase.functions.invoke('nombre', { body })`. Nunca `fetch()` directo — el `fetch` directo con cabecera `Authorization` requiere preflight CORS que puede fallar si no está bien configurado. `supabase.functions.invoke()` gestiona el token y los headers automáticamente.

**Secrets (variables de entorno de Edge Functions):** se configuran en Dashboard → Edge Functions → **Manage secrets**. Se leen en Deno con `Deno.env.get('CLAVE')`. Son distintos del **Supabase Vault** (que es almacenamiento cifrado en Postgres, accesible vía SQL con `select vault.decrypted_secrets`). Usar `Deno.env.get()` solo funciona con secrets configurados en "Manage secrets", no con entradas del Vault SQL.

---

## 2. Base de datos

### Tablas

**`clients`**
| Campo | Notas |
|---|---|
| id | text PK, mayúsculas, elegido por el admin (ej: `GARCIA_PEDRO`) |
| name | text NOT NULL |
| company | text |
| phone, email, address, nif, comments | text |

**`providers`** — Entidad comercial: a quien pagas, datos de facturación
| Campo | Notas |
|---|---|
| id | text PK, mayúsculas |
| name | Nombre del propietario |
| address | Dirección de contacto/personal (NO la dirección del balcón) |
| email | text — email de contacto del proveedor |
| phone | text — teléfono de contacto del proveedor |
| payment_method | text |
| invoice | boolean — si emite factura |
| comments | text |

**`venues`** — Lugar físico o producto: FK a providers
| Campo | Notas |
|---|---|
| id | text PK, mayúsculas |
| provider_id | FK→providers |
| display_name | Nombre visible del venue (si null se usa el id) |
| address | Dirección física del venue (la ubicación real del balcón) |
| venue_type | `'balcon'`, `'barrera'`, `'guia'`, `'servicio_especial'`; default `'balcon'` |
| slug | Identificador público estable para URLs del catálogo (ej: `balcon-estafeta-1`). Único; null si no tiene ficha pública. |
| comments | text |

Un proveedor puede tener múltiples venues. Al crear un proveedor nuevo desde el panel se crea automáticamente un venue con el mismo ID. En el 95% de casos venue.id === provider.id. Casos con múltiples venues: AMAYA_SABATE (con AMAYA_SABATE_BALCON y AMAYA_SABATE_BARRERA) y PATRICIA.

**`services`** — Tipo de evento
| Campo | Notas |
|---|---|
| id | text PK, mayúsculas (ej: `ENCIERRO_7`, `CHUPINAZO_6`) |
| day | integer — día de julio |
| event_type | text — categoría del evento: `encierro`, `chupinazo`, `procesion`, `despedida_gigantes`, `pobre_de_mi`, `visita_guiada`, `otro`. Columna directa en la tabla (no derivada). Fuente de verdad para el trigger de sincronización y para las vistas. |
| name | text — nombre comercial corto (ej: `"Balcón encierro"`). Se usa en propuestas como etiqueta principal. |
| description | text — descripción larga |
| start_time | text — hora de inicio (ej: `'08:00'`) |
| image_url | URL absoluta de imagen representativa. Fallback en propuestas cuando availability.photos está vacío. |
| comments | text |

**`availability`** — Par venue+servicio con capacidad y precio
| Campo | Notas |
|---|---|
| id | integer PK |
| venue_id | FK→venues NOT NULL (añadido jun 2026) |
| service_id | FK→services NOT NULL |
| total_slots | integer NOT NULL |
| price_per_slot | decimal — coste que se paga al proveedor por plaza (o importe fijo total si billing_model='fixed'); default 0 |
| billing_model | `'capacity'`, `'consumption'` o `'fixed'`; default `'capacity'` |
| description | text — descripción específica del par venue/servicio |
| access_instructions | text — instrucciones de acceso el día del evento |
| photos | text[] ARRAY — URLs de fotos del balcón para este par |
| comments | text |

Constraint UNIQUE(venue_id, service_id) (`uq_availability_venue_service`) añadido en jun 2026. La BD refuerza la unicidad además del JS.

**`sfcom_listings`** — Configuración de publicación en sfcom
| Campo | Notas |
|---|---|
| id | serial PK |
| availability_id | FK→availability, UNIQUE, ON DELETE CASCADE |
| sfcom_service_name | Nombre del producto en sfcom (contrato de búsqueda al registrar pedidos) |
| sfcom_slots_listed | Plazas publicadas en sfcom |
| sfcom_product_id | ID del producto en WooCommerce |
| sfcom_variation_id | ID de la variación (null si producto simple) |
| sfcom_status | `null` (no publicado), `'pending'`, `'confirmed'`, `'deactivation_pending'` |
| sfcom_public_price | Precio público informativo; nunca se persiste desde JS, solo se usa en el correo a Hilario |

Cada fila de `availability` tiene como máximo una fila en `sfcom_listings`. Solo las que tienen o han tenido actividad en sfcom.

**`reservations`**
| Campo | Notas |
|---|---|
| id | text PK, formato `R0001` |
| client_id | FK→clients |
| service_id | FK→services |
| venue_id | FK→venues |
| slots | integer NOT NULL |
| price_per_slot | decimal NOT NULL — precio de venta al cliente |
| total_amount | decimal GENERATED ALWAYS AS `((slots)::numeric * price_per_slot)` — calculado por PostgreSQL. El JS no la calcula ni envía. |
| status | `'Confirmada'`, `'Pendiente'`, `'Cancelada'`; default `'Pendiente'` |
| comments | text |
| proposal_number | text |
| proposal_path | Ruta al PDF en Supabase Storage (bucket `proposals`) |
| origin_ref | Referencia de origen heterogénea: `WEB026_1090` (sfcom), UUID (solicitud web/email), null (reserva directa). Detección: `origin_ref LIKE 'WEB%'` para sfcom; `IS NOT NULL AND NOT LIKE 'WEB%'` para UUID. |
| welcome_sent_at | timestamptz — momento en que Paula envió la bienvenida al cliente. Se escribe al pulsar cualquier botón de envío en el modal de bienvenida. Null si nunca se ha enviado. Usado por `actualizarBotonBienvenida` para mostrar "✅ Enviado el DD/MM" bajo el botón. |

**`charges`** — Hitos de cobro a clientes (por cliente, no por reserva)
| Campo | Notas |
|---|---|
| id | integer PK |
| client_id | FK→clients |
| amount | decimal NOT NULL |
| due_date | date |
| collected | boolean, default false |
| collected_date | date |
| comments | text |
| is_final | boolean — hito final recalculado automáticamente por JS |
| invoiced | boolean — redundante con `invoice_number IS NOT NULL`, mantenido por conveniencia de filtro |
| invoiced_at | date |
| invoice_number | text — serie `VSF-NN/AAAA`; una vez asignado no se sobreescribe |
| invoice_path | Ruta al PDF en Supabase Storage (bucket `invoices`) |

UNIQUE (client_id, amount, due_date).

**`payments`** — Hitos de pago a proveedores (por proveedor, no por servicio)
| Campo | Notas |
|---|---|
| id | integer PK |
| provider_id | FK→providers |
| amount | decimal NOT NULL |
| due_date | date |
| paid | boolean, default false |
| paid_date | date |
| comments | El hito final se identifica por `comments === 'Pago final'` (no hay campo is_final en esta tabla) |

UNIQUE (provider_id, amount, due_date).

**`reservation_requests`** — Solicitudes recibidas
| Campo | Notas |
|---|---|
| id | uuid PK, gen_random_uuid() |
| client_name | text NOT NULL |
| client_email, client_phone, client_address | text |
| slots | integer |
| level | text — slug del tipo de experiencia (web) o nombre del producto (sfcom) |
| day | integer — día de julio preferido |
| comments | Para emails: prefijo `Días: X\nOtros servicios: Y\n\n` + resumen. Para web/sfcom: texto libre. |
| status | `'nueva'` → `'en_conversacion'` → `'respuesta_enviada'` → `'seguimiento_pendiente'` → `'convertida'` o `'descartada'`; default `'nueva'` |
| created_at | timestamptz, default now() |
| updated_at | timestamptz — actualizado por trigger en cada UPDATE |
| source | null (web), `'email'` (procesado desde panel), ref del pedido sfcom (ej: `WEB123_456`) |
| price_per_slot | numeric — solo en solicitudes sfcom (precio bruto) |
| service_id | text — sin FK; se guarda como verificación, nunca como búsqueda primaria |
| language | `'es'`, `'en'`, `'fr'`, `'it'`, `'de'`, `'other'` — solo para emails |
| email_raw | Texto completo del email original (referencia, no se muestra en panel) |
| conversation_notes | Log interno formato: `---DD/MM/AA---\n<Paula>\nTexto\n<Cliente>\nTexto` |
| assigned_venue_id | FK→venues — venue asignado (opcional) |
| proposal_draft | jsonb, default `'[]'` — array de líneas del borrador de propuesta. Cada línea: `{ service_id, service_name, day, venue_id, venue_display_name, slots, price, catalogo_url, estado }`. `estado`: `'pendiente'` (default), `'hecha'`, `'descartada'` — solo presente cuando la solicitud pasa por el bloque de conversión en formulario.html. Actualizado por la tabla del borrador en solicitudes.js, por `_persistirEstadoLineas()` en formulario.js, y automáticamente cuando el asistente emite `---BORRADOR---`. |

**Ciclo de vida de `status`:** las solicitudes con `status IN ('convertida','descartada')` no aparecen en ninguna lista activa. Auto-transición en solicitudes.js: `respuesta_enviada` → `seguimiento_pendiente` si `updated_at` supera 3 días sin respuesta.

**Detección de origen por `source`:** `source LIKE 'WEB%'` → solicitud sfcom. `source = 'email'` → email procesado desde panel. `source IS NULL` → formulario web público.

**`assistant_logs`**
| Campo | Notas |
|---|---|
| id | uuid PK |
| created_at | timestamptz |
| solicitud_id | uuid, sin FK (no bloquea borrados) |
| client_name, event_hint | text — copiados de la solicitud para identificación |
| messages | jsonb NOT NULL — array completo: `[{role, content}, ...]` |
| context_snapshot | jsonb — objeto de contexto enviado a Claude al inicio |

Se guardan manualmente ("Guardar log"). Su uso principal: pasarlos a Claude.ai periódicamente para analizar y mejorar `SYSTEM_PROMPT_ASISTENTE`.

### Modelos de facturación de proveedores

- **`capacity`:** el proveedor cobra por plazas totales contratadas, independientemente de cuántas se reserven. Pago final = `total_slots × price_per_slot`. Prioridad de venta máxima.
- **`consumption`:** el proveedor cobra solo por plazas efectivamente reservadas. Pago final = `SUM(slots activos) × price_per_slot`.
- **`fixed`:** el proveedor cobra una cuota fija (guías, ponentes). `price_per_slot` almacena el importe fijo total del servicio. Pago final = `price_per_slot` si hay al menos una reserva activa, 0 si no. En la UI de proveedores.js, al seleccionar este modelo `inputPrecio` se deshabilita.

### Triggers activos

**`trg_uppercase_*`** — BEFORE INSERT OR UPDATE en `availability`, `charges`, `clients`, `payments`, `providers`, `reservations`, `services`. Todos usan la función compartida `uppercase_ids()`, que aplica `UPPER()` sobre los IDs de texto relevantes de cada tabla según `TG_TABLE_NAME`.

**`trg_uppercase_venues`** — BEFORE INSERT OR UPDATE en `venues`. Usa su propia función `trg_uppercase_venues_fn()`, separada de `uppercase_ids`. Además de `UPPER()`, normaliza espacios a guiones bajos en `id` y `provider_id` (`REPLACE(NEW.id, ' ', '_')`).

**`notificar-solicitud`** — AFTER INSERT en `reservation_requests`. Usa la función interna de Supabase `http_request()` (vía `net.http_post`) para llamar a la Edge Function del mismo nombre con los datos del INSERT. Se dispara en cada INSERT (desde la web pública y desde `checkSfcomOrders`). Transparente para el JS.

**`trg_reservation_requests_updated_at`** — BEFORE UPDATE en `reservation_requests`. Función `update_reservation_requests_updated_at()`. Actualiza automáticamente el campo `updated_at` en cada cambio.

**`trg_sync_availability_event_type`** — AFTER UPDATE en `availability`. Función `sync_availability_by_event_type()`. Cuando se editan `photos`, `description` o `access_instructions` en una fila, sincroniza los tres campos a todas las filas con el mismo `venue_id` y `event_type` (el `event_type` se obtiene de la tabla `services`). Transparente para el JS: editar una fila sincroniza todas las del mismo venue+event_type.

### Vistas

**`service_availability`** — Plazas libres por servicio (solo lectura, acceso anon). Campos: `service_id`, `free_slots`. Calculada como `SUM(total_slots) - SUM(slots reservados Confirmados+Pendientes)`, agrupada por `service_id`. Usada por `disponibilidad.js` en el frontend público para los badges de disponibilidad.

**`availability_panel`** — Solo authenticated. Campos: `id, venue_id, service_id, total_slots, price_per_slot, billing_model, description, access_instructions, photos, venue_display_name, venue_address, venue_slug, event_type, day, start_time`. Usada por `formulario.js`, `solicitudes.js`, `asistente.js` y `proveedores.js`. No incluye campos sfcom.

**`availability_with_sfcom`** — Solo authenticated. JOIN de `availability` + `sfcom_listings`. Campos: `id, venue_id, service_id, total_slots, price_per_slot, billing_model, venue_display_name, sfcom_service_name, sfcom_slots_listed, sfcom_product_id, sfcom_variation_id, sfcom_status, sfcom_public_price, sfcom_listing_id`. Filas sin entrada en `sfcom_listings` tienen campos sfcom a null. Usada exclusivamente por `sfcom.js` y `sfcom-panel.js`. No usar para operaciones que no necesiten campos sfcom.

**`catalogo_publico`** — Acceso anon. Campos: `slug, display_name, address, venue_type, service_id, description, access_instructions, photos, service_name, event_type, day, start_time, service_image_fallback`. Usada por `catalogo/catalogo.js`.

### Seguridad (RLS)

Todas las tablas tienen RLS habilitado excepto `assistant_logs` (desactivado, ver deuda 7.1).

| Tabla | anon | authenticated | Notas |
|---|---|---|---|
| `assistant_logs` | sin RLS | sin RLS | RLS desactivado |
| `availability` | SELECT bloqueado | ALL permitido | Las vistas `service_availability` y `catalogo_publico` usan `security_invoker=false` para poder ser leídas por anon sin exponer la tabla directamente |
| `charges` | ALL bloqueado | ALL permitido | |
| `clients` | SELECT bloqueado | ALL permitido | |
| `payments` | ALL bloqueado | ALL permitido | |
| `providers` | sin política (denegado implícito) | ALL permitido | |
| `reservation_requests` | SELECT bloqueado, INSERT permitido | ALL permitido | El INSERT anon permite enviar solicitudes desde el formulario público |
| `reservations` | SELECT bloqueado | ALL permitido | |
| `services` | SELECT permitido | ALL permitido | Necesario para el frontend público |
| `sfcom_listings` | sin política (denegado implícito) | ALL permitido | |
| `venues` | SELECT permitido | ALL permitido | La política de authenticated usa rol `{authenticated}`; la de anon es solo SELECT |

**Atención:** La política de `venues` originalmente usaba `{public}` (bug que daba acceso de escritura a cualquier usuario anon). Corregida en jun 2026: ALL para `{authenticated}`, SELECT para `{anon}`.

Las vistas `service_availability` y `catalogo_publico` deben estar definidas con `WITH (security_invoker = false)` (o `SECURITY DEFINER`) para que sean accesibles por anon aunque `availability` tenga SELECT bloqueado para anon. Verificado jun 2026: ambas funcionan correctamente (`service_availability` devuelve 63 filas, `catalogo_publico` devuelve 54).

### Storage

Dos buckets privados (sin acceso público directo):

| Bucket | Uso |
|---|---|
| `proposals` | PDFs de propuestas generados desde `propuesta.js` |
| `invoices` | PDFs de facturas generados desde `factura.js` |

Ninguno tiene `file_size_limit` ni `allowed_mime_types` configurados. El acceso es solo a través de URLs firmadas generadas desde el panel autenticado.

---

## 3. Arquitectura de nombres e identificadores

Cinco tipos distintos que conviene no confundir:

| Identificador | Dónde | Propósito |
|---|---|---|
| `providers.id` | Interno | Quién paga. Formato MAYUSCULAS_GUIONBAJO. |
| `venues.id` | Interno | Qué lugar físico. Mismo formato. En 95% de casos igual que provider.id. |
| `venues.display_name` | Público | Nombre del balcón que ve el cliente. |
| `venues.slug` | Público estable | Para URLs del catálogo. Nunca cambia. |
| `services.id` | Interno | Qué evento. Formato TIPO_DIA. |
| `services.name` | Público | Nombre del tipo de experiencia sin día (ej: "Balcón encierro"). |
| `sfcom_listings.sfcom_service_name` | Externo | Nombre del producto en tienda.sanfermin.com. Solo para sincronización con sfcom. |

**Regla de uso por contexto:**
- `venues.id` / `providers.id` / `services.id` — solo en BD y código. Nunca visible en documentos ni en UI de cara al cliente.
- `venues.display_name` — en toda UI interna del panel. Si es null, se usa `venues.id` como fallback.
- `services.name` — en documentos al cliente: propuestas, confirmaciones, mensajes de bienvenida.
- `venues.slug` — solo en URLs del catálogo público. Nunca cambia una vez asignado.
- `sfcom_listings.sfcom_service_name` — solo para identificar productos en la tienda sfcom (contrato de búsqueda en `registrarPedidosSfcom`). No usar fuera de ese contexto.

**Display en el panel:** `formatVenueLabel(venueId, venueProviderId)` en `utils.js` devuelve `"PROV_ID — VENUE_ID"` solo si son distintos (caso multi-venue), o solo `venueId` en el caso normal.

---

## 4. Archivos del panel de admin (`/admin/js/`)

### supabase.js
Módulo ES6. `export const supabase`. Único cliente Supabase del admin.

### auth.js
`requireAuth()` — redirige a `./index.html` si no hay sesión activa.  
`logout()` — cierra sesión y redirige.

### utils.js
Utilidades compartidas. Exports:

| Función | Uso |
|---|---|
| `fmt(n)` | Formatea como moneda EUR |
| `fechaCobroDefault()` | 6 de julio del año en curso (o siguiente si ya pasó el 15 julio) |
| `fechaPagoDefault()` | 15 de julio (misma lógica) |
| `initSidebar()` | Hamburger y overlay del sidebar |
| `normalizar(str)` | Mayúsculas + sin acentos (para búsquedas) |
| `normalizarId(str)` | Espacios→guiones bajos + mayúsculas |
| `buscarConPrioridad(lista, texto, campos)` | Búsqueda con 4 prioridades: empieza por id > campo2 > campo3 > contiene |
| `sortArr(arr, col, dir, getKey)` | Ordena array con comparación locale 'es' y soporte numérico. Devuelve copia nueva. |
| `renderThead(thead, columnas, sortCol, sortDir, onClick)` | Reconstruye `<thead>` con flechas de orden activo |
| `initAutoSave(supabase, campos, camposDB, tabla, getEntity, { onSaved, onError })` | Registra `change` en inputs para autosave en Supabase. Solo actúa si `getEntity()` devuelve truthy. |
| `exportTable(rows, columns, filename)` | Genera .xlsx con SheetJS (carga dinámica). `columns: [{ key, label, fmt? }]` |
| `renderClientChips(reservas)` | Devuelve spans `ID(slots)` coloreados (verde=Confirmada, naranja=Pendiente). Agrupa por client_id sumando slots. |
| `formatVenueLabel(venueId, venueProviderId)` | "PROV — VENUE" si distintos, solo venueId si iguales |
| `persistirCobrosCliente(supabase, clienteId, todasReservas)` | Recalcula y persiste cobro final en charges. Si el hito ya tiene invoice_number, crea hito de ajuste. |
| `persistirPagosProveedor(supabase, proveedorId, todasReservas, todaDisponibilidad)` | Recalcula y persiste pago final en payments. Primero busca todos los venues del proveedor para agregar disponibilidad y reservas de todos ellos. |
| `resolverCliente(datos, todosClientes)` | **Punto de entrada obligatorio antes de generar un client_id nuevo.** `datos: { nombre, email, telefono }`. Devuelve `{ match: 'exacto'\|'ambiguo'\|'ninguno', cliente }`. Prioridad: 1) email exacto, 2) teléfono exacto (normaliza prefijo +34), 3) nombre similar como subcadena de palabras (ambiguo). Evita la creación de duplicados (CLIENTE_2, CLIENTE_3) cuando llegan múltiples solicitudes de la misma persona. |
| `mostrarOpcionesEnvio({ tipo, email, telefono, asunto, getTexto, onGenerar, container, onUsado })` | Renderiza botones de acción de envío en un contenedor DOM. **`tipo: 'texto'`** (default, asistente): 📋 Copiar al portapapeles · 📧 Enviar por correo · 💬 Enviar por WhatsApp. **`tipo: 'pdf'`** (propuesta, factura): ⬇ Solo generar PDF · ⬇ Generar PDF y preparar correo · ⬇ Generar PDF y enviar por WhatsApp. Para `tipo='pdf'` es obligatorio `onGenerar: async () => void`; al hacer clic todos los botones se deshabilitan mostrando "⏳ Generando…" mientras corre. El botón con `btn-primary` es WhatsApp si hay teléfono, Email si hay email, o la opción base si no hay contacto. Los botones de email/WA solo aparecen si `email`/`telefono` son truthy. `getTexto: () => string` se llama en el momento del clic. `onUsado` es callback opcional (para 'texto' recibe el texto; para 'pdf' sin argumento). |

### modal.js
`crearModal(id, { wide, narrow, scroll })` — único punto de creación de modales en el admin.

Crea un `<dialog>` nativo con `showModal()` (top layer del navegador, por encima de cualquier contexto CSS). Elimina cualquier dialog previo con el mismo `id`. El handler `close` elimina el dialog del DOM (incluyendo cierre por ESC). Devuelve `{ overlay: dialog, panel }`.

**Regla crítica:** siempre usar `panel.querySelector('#mi-btn')` para registrar event listeners, nunca `document.getElementById()`. Si el modal se crea dos veces, `document.getElementById` puede devolver el anterior.

Tamaños: default 560px; `--wide` 640px; `--narrow` 480px. `--scroll` activa `max-height:90vh; overflow-y:auto`.

Clases de botones del admin: `.btn`, `.btn-primary` (rojo), `.btn-secondary` (borde gris), `.btn-danger` (borde rojo).

### verificacion.js
Módulo ES6. Importa `syncStockToSfcom` de sfcom.js y `crearModal` de modal.js. Exports:

- `mostrarToast(mensaje, color)` — toast fijo en la parte superior, ~3.5s. Devuelve el elemento DOM para poder eliminarlo antes del timeout.
- `mostrarModalVerificacion(resultado, supabase, onReverify, opts)` — modal completo de resultados. Cuatro estados visuales: rojo (errores BD), naranja (discrepancias sfcom reales), azul (discrepancias explicadas por pedidos pendientes), verde (OK). `opts.sinBotonCorregir` evita el bucle infinito de corrección.
- `mostrarModalPreCorreccion(mismatches)` — modal previo cuando hay IDs de variación incorrectos. Devuelve `Promise<'corregir'|'continuar'>`.

### formulario.js (~2600 líneas)
Módulo ES6. Importa de `supabase.js`, `auth.js`, `utils.js`, `factura.js`, `propuesta.js`, `sfcom.js`, `verificacion.js`, `modal.js`, `asistente.js`.

Lee al cargar: `clients`, `services`, `availability_panel`, `venues`, `sfcom_listings` (con join a availability), `reservations`.

**6 bloques** (se muestran/ocultan según estado):

**Bloque 0 — Solicitudes pendientes sfcom:** Lee `reservation_requests` con status no `convertida`/`descartada`. Muestra solo las sfcom pendientes (source `WEB%` + status `nueva`) en tabla roja. Si hay otras web/email con status distinto de `respuesta_enviada` (en_conversacion, seguimiento_pendiente…), muestra un aviso con enlace a `solicitudes.html`. Se oculta el bloque completo si no hay nada. Botón "→ Solicitudes" redirige a `solicitudes.html`. Click en fila sfcom → `cargarDesdeSolicitud`: limpia cliente previo, precarga datos, infiere servicio+proveedor con `_inferirDesdeSfcom`. Botón "✅ Procesado" marca status `convertida`. Tras guardar reserva sfcom: si `solicitudOriginRef` está presente, ofrece marcar la solicitud como `convertida` via `_ofrecerCerrarSolicitud`.

**Bloque de conversión de propuesta (dinámico, insertado entre bloque 0 y bloque 1):** Visible solo cuando se navega desde `solicitudes.html` con `?solicitud_id=uuid` y la solicitud tiene `proposal_draft` con 2 o más líneas. Fondo azul claro. Título "Convirtiendo propuesta de {cliente} — {N} líneas".

Tabla con una fila por línea del borrador. Columnas: resumen compacto (service_name · día · venue · plazas · precio · total), badge de estado, y botones de acción (solo si `estado === 'pendiente'`):
- **↓ Cargar**: rellena bloque 2 (servicio, venue, plazas, precio) con los datos de esa línea. Establece `_lineaActualIndex`. El botón queda resaltado (rojo) para indicar la línea activa.
- **✕ Descartar**: marca la línea como 'descartada' y persiste. Pide confirmación. Si era la línea activa, limpia bloque 2.

Estado de cada línea (`estado` en el objeto `proposal_draft`): `'pendiente'` (default), `'hecha'`, `'descartada'`. Se persiste inmediatamente en Supabase con cada cambio.

**Flujo por línea:** Paula pulsa "↓ Cargar" → bloque 2 se rellena → Paula ajusta y pulsa "Guardar reserva" → `_onLineaGuardada()` marca la línea como 'hecha', persiste, limpia bloque 2, mantiene `solicitudOriginRef` para siguientes líneas. Si quedan líneas pendientes, la tabla se refresca. Si todas están resueltas, `_finalizarConversion()` marca la solicitud como `convertida` y colapsa el bloque a un resumen verde con botón "Volver a solicitudes".

`_ofrecerCerrarSolicitud` está suprimido durante el modo conversión: el cierre de la solicitud lo gestiona exclusivamente `_finalizarConversion()` al completar todas las líneas.

**Persistencia entre sesiones:** si Paula sale antes de terminar, el estado (`hecha`/`descartada`) de cada línea queda guardado en `proposal_draft`. Al volver a entrar con el mismo `solicitud_id`, el bloque se reconstruye con los estados guardados.

**Estado del módulo:** 4 variables de módulo: `_modoConversionActivo`, `_solicitudConversionId`, `_draftConversion[]`, `_lineaActualIndex`.

**También acepta `?solicitud_id=uuid`** para casos A (0 o 1 línea en el borrador). Si el borrador llega vacío pero la solicitud tiene `level`/`day`/`service_id`, `cargarDesdeSolicitud` construye la línea de borrador en el momento y la persiste en Supabase antes de proceder como Caso A. El borrador es la fuente de verdad única para todo flujo no-sfcom: `_inferirServiceId` solo se usa para construir esa línea cuando falta, nunca para rellenar directamente el bloque 2.

**Bloque 1 — Cliente:** Autocomplete en tiempo real contra `clients`. Cliente existente → carga datos + autosave por campo. Cliente nuevo → "Cliente nuevo". Al cargar desde solicitud (`cargarDesdeSolicitud`), llama primero a `resolverCliente` para detectar si el cliente ya existe por email/teléfono/nombre antes de generar un ID nuevo. En modo conversión (2+ líneas), el cliente se resuelve una sola vez al entrar — no se toca al cargar cada línea.

**Bloque 2 — Reserva:** Selector de servicio → selector de proveedor (filtrado por service_id) → plazas → precio → total calculado (no editable) → estado → comentarios. Antes de guardar llama a `checkAvailabilityBeforeSave`. Al guardar en modo edición, si cambia proveedor/servicio sincroniza stock sfcom para par original y nuevo.

**Disponibilidad al editar:** `getPlazasInfo(proveedorId, servicioId, excluirId)` excluye la reserva en edición activa para que su proveedor no aparezca con disponibilidad reducida por su propia reserva.

**Bloque 3 — Disponibilidad:** Mapa visual de columnas por proveedor. Click en proveedor sin plazas abre panel de reorganización.

**Bloque 4 — Reservas del cliente:** Tabla de reservas. Checkbox para editar, cancelar o eliminar en lote. Botón "Generar propuesta". Botón "📩 Enviar bienvenida" (ver sistema de bienvenida más abajo).

**Bloque 5 — Cobros al cliente:** Hitos de cobro. Botón de facturación por hito. Hito final (`is_final: true`) recalculado automáticamente vía `persistirCobrosCliente`.

**Orden de borrado de reservas (`eliminarSeleccionadas`):** al eliminar reservas del cliente activo, el sistema comprueba si quedan reservas con `status !== 'Cancelada'`. Si quedan → `persistirCobrosCliente` recalcula el cobro final. Si no quedan reservas activas → se eliminan todos los charges del cliente: los que no tienen `collected=true` ni `invoice_number` se borran sin preguntar; si hay alguno con historial (cobrado o facturado) se muestra un modal con **Cancelar como botón por defecto** antes de proceder. Tras limpiar charges, se ofrece opcionalmente eliminar también el cliente (en este punto ya no hay FK pendiente).

**Secuencia de carga:** `checkSfcomOrders` primero; `ejecutarVerificacion(false)` encadenado en `.finally()` para evitar race condition (verificarCoherencia lee reservation_requests y necesita que los pedidos sfcom nuevos estén ya insertados).

**Sistema de bienvenida (Fase 2, jun 2026):** botón "📩 Enviar bienvenida" en la fila de acciones del bloque 4, junto a "Generar propuesta". Implementado en puro JS, sin asistente.

- **`actualizarBotonBienvenida()`** — muestra/oculta el botón (`#btnEnviarBienvenida`, el propio elemento, con `display:'flex'/'none'`) según si el cliente tiene reservas activas. En una segunda línea dentro del botón (`<span id="bienvenida-status">`) aparece "✅ Enviado el DD/MM" si todas las confirmadas tienen `welcome_sent_at`.
- **`componerMensajeBienvenida(cliente, reservasIncluidas, pendientesNoMarcadas, disponibilidad, opts)`** — genera el texto adaptando la intro según días hasta el 6 de julio (>1 día / mañana / ya estamos en SF). `diasParaSanFermin()` usa siempre el año en curso y **no salta al año siguiente** tras las fiestas (a diferencia de `fechaCobroDefault`). Incluye un bloque por reserva con nombre del evento, día, hora, `venue_display_name`, plazas e instrucciones de acceso si `availability.access_instructions` está relleno. Cuando hay varias reservas, los bloques se separan con `— — — — —`. Cierre firmado por Paula.
- **`abrirModalBienvenida(reservasIncluidas, pendientesNoMarcadas)`** — modal con el texto como `<textarea>` editable. Si `pendientesNoMarcadas` no está vacío, muestra un banner de advertencia con checkbox para añadir una nota sobre ellas al final del mensaje. Usa `mostrarOpcionesEnvio` (`tipo:'texto'`) para WhatsApp/email. Al usar cualquier botón de envío escribe `welcome_sent_at` solo en `reservasIncluidas` (nunca en las que solo aparecen en el banner) y llama a `actualizarBotonBienvenida()`.
- Al pulsar el botón, `reservasIncluidas` contiene siempre todas las reservas **Confirmadas** del cliente más las **Pendientes** que Paula haya marcado con el checkbox en la tabla. Las Pendientes no marcadas van a `pendientesNoMarcadas` y aparecen solo en el banner de advertencia del modal.

### solicitudes.js
Módulo ES6. Importa `supabase.js`, `auth.js`, `utils.js` (`initSidebar`, `buildCatalogUrl`, `resolverCliente`), `mostrarToast` de `verificacion.js`, `initAsistente`, `abrirAsistenteRespuesta`, `abrirProcesarEmail` de `asistente.js`.

Lee al cargar: `availability_panel` (para calcular disponibilidad en el borrador), `reservations` (para calcular plazas libres) y `clients` (para `resolverCliente` en `mostrarDetalle`).

**Layout:** dos columnas en desktop (lista 320px izquierda, detalle derecha). En mobile: bottom sheet (`position:fixed; bottom:0; transform:translateY(100%)` + clase `.visible`).

**Sistema de estado único (`status`):** `'nueva'` → `'en_conversacion'` → `'respuesta_enviada'` → `'seguimiento_pendiente'` → `'convertida'` o `'descartada'`. Las solicitudes sfcom (source `WEB%`) tienen una vista simplificada: sin selector de estado, sin log, sin asistente; solo botón "→ Crear reserva" (va a formulario.html) y "✕ Descartar".

Auto-transición: `'respuesta_enviada'` → `'seguimiento_pendiente'` si `updated_at` supera 3 días. Se aplica al cargar la lista.

**Lista:** nombre, fecha, badges de origen y de status, experiencia, preview del último mensaje del log (64 chars).

**Detalle (web/email):** selector de status con autosave, botón "📩 Enviar recordatorio" (solo cuando `status === 'seguimiento_pendiente'`), tabla de borrador de propuesta, selector de venue asignado con plazas libres en tiempo real, log de conversación, botón "💬 Abrir asistente", enlace "📋 Convertir en reservas" (→ `formulario.html?solicitud_id=uuid`), botón "✕ Descartar". La URL solo lleva `solicitud_id`; formulario.js lee el resto directamente de Supabase.

**Borrador de propuesta (`proposal_draft`):** tabla editable que ocupa el espacio donde antes estaba el bloque de datos iniciales (`.sol-detalle-datos`). Columnas: Servicio (select desde `availability_panel`), Día, Venue (select dinámico dependiente del servicio), Plazas, €/plaza, Total (calculado, readonly), Acciones (enlace catálogo + papelera). Flechas ↑↓ para reordenar. Fila vacía al final para añadir. Guardado automático con debounce 800ms. Si el borrador está vacío al abrir una solicitud que tiene `level`/`day`/`slots`, se pre-rellena automáticamente la primera fila con esos datos y el precio máximo de `_calcularPrecioRef`. La consulta inicial (`sol.comments`) se migra como primer mensaje `<Cliente>` del log si el log no tenía mensajes de cliente.

**`_preFillBorradorSiVacio(sol)`:** función interna de pre-relleno. Infiere `service_id` desde `sol.level` con enfoque split-by-dash (`sol.level.toLowerCase().split('-')` + `partes.includes('encierro')`, etc.), igual que `_inferirServiceId` en formulario.js. **No usa coincidencia exacta de string** porque `sol.level` desde el formulario web es un slug completo (`'vivir-el-chupinazo'`, `'disfrutar-del-encierro'`), no el tipo corto (`'chupinazo'`). Si se usan coincidencias exactas, las solicitudes web no encuentran servicio y el borrador queda vacío (bug confirmado y corregido jun 2026 con el caso de Sara).

**Log de conversación:** almacenado en `conversation_notes` como texto plano: `---DD/MM/AA---` como separador de fecha, `<Paula>` y `<Cliente>` como marcadores de autor. Los mensajes del día actual tienen botón de edición.

**Integración con asistente:** callbacks registrados en `initAsistente`: `onRespuestaUsada: _onRespuestaUsadaEnLog` (inserta mensaje en log + cambia status + actualiza badge) y `onBorradorActualizado: _onBorradorActualizado` (persiste `proposal_draft` en Supabase + refresca la tabla del borrador si la solicitud está abierta). Los botones Copiar/Email/WhatsApp del asistente integran ambas acciones al pulsarse: ya no existe el botón "✅ Usar respuesta".

### proveedores.js
Módulo ES6. Lee `availability_panel` al cargar. Los datos sfcom se obtienen en una segunda consulta a `sfcom_listings` y se mezclan en memoria por `availability_id`.

Gestiona:
- CRUD de proveedores con autocomplete. Al crear un proveedor nuevo se crea automáticamente un venue con el mismo ID.
- Campos del proveedor con autosave: `name`, `address` (contacto/personal), `email`, `phone`, `comments`. El formulario incluye también `payment_method` e `invoice` (boolean), guardados en sus propios listeners.
- Dos campos de dirección: `providers.address` (contacto) y `venues.address` (física del balcón). Autosave en ambos.
- Campo `venue_type` con autosave en `venues`.
- Disponibilidad: añadir/editar/eliminar entradas en `availability` y `sfcom_listings`. Tras guardar o editar llama a `syncStockToSfcom`.
- Hitos de pago al proveedor.
- Carrusel de fotos por par venue/servicio (escribe en `availability.photos`; el trigger sincroniza al resto del event_type automáticamente).
- Asistente de creación en lote (`dlgNuevoServicio`): crea servicios y availability para un rango de días desde un nombre base.
- Widget de imagen (`.img-picker`): cuadro cuadrado, vacío muestra input de URL, con imagen muestra la foto con botón ✕.

**Subida de fotos desde archivo (botón 📁 en el carrusel):** `_subirFotoArchivo(file)` llama a la Edge Function `upload-venue-photo` vía `supabase.functions.invoke()`. La función sube el archivo al servidor FTP (`/httpdocs/img/venues/`) y devuelve la URL pública (`https://experienciasanfermin.com/img/venues/<filename>`). La URL se añade a `_photos[]` y se persiste en `availability.photos` con `_savePhotos()`. Las credenciales FTP están en los secrets de la Edge Function (Dashboard → Manage secrets: `FTP_HOST`, `FTP_USER`, `FTP_PASS`).

**Fotos de venues (`img/venues/`):** carpeta en el repo y en el servidor FTP para fotos técnicas de balcones (fachada, portal, acceso). Se incluye en el deploy normal: las fotos que estén en local se commitean a git y se suben por FTP. Para sincronizar lo que haya en el servidor con el local, hacer pull manual (extensión SFTP de VS Code o script PowerShell). Pendiente: procesar imagen con canvas antes de subir para convertir HEIC/multlicapa de iPhone a JPEG estándar.

**Acceso a datos sfcom:** lecturas vía `sfcom_listings` (mezclados en memoria con `availability_panel`). Escrituras sfcom siempre a `sfcom_listings`, nunca a `availability`.

**Flujos sfcom en proveedores.js:**
- `null` → "Solicitar a SFcom" → `'pending'` (correo a Hilario) → Hilario activa → "Confirmar" → GET verificación → `'confirmed'` + sync inicial
- `'confirmed'` → "Dar de baja" → `'deactivation_pending'` (correo a Hilario) → Hilario retira → "Confirmar baja" → GET verificación → DELETE en sfcom_listings → `null`
- Mientras `sfcom_status` no sea null, el servicio no se puede eliminar.

**Selector de venue (pestañas):** cuando un proveedor tiene más de un venue, el selector muestra una pestaña por venue. `selectVenueTab(venueId)` actualiza `venueActual` y refresca los campos del venue (dirección, nombre, tipo) y la tabla de servicios. `venueActual` es la variable de estado que indica el venue activo en todo momento.

**Tabla de servicios (`bloque-servicios-proveedor`):** `cargarServiciosProveedor(proveedorId, venueId)` filtra `todaDisponibilidad` por `d.venue_id === vid` (donde `vid = venueId ?? venueActual?.id`). Muestra solo los servicios del venue activo; nunca mezcla venues aunque el proveedor tenga varios. La tabla se refresca al cambiar de pestaña y tras cualquier operación de guardado o eliminación de servicios. El cálculo de pagos (`persistirPagosProveedor`) es distinto: agrega todos los venues del proveedor a propósito — eso es correcto y no debe verse afectado por el filtro de la tabla.

### panel.js
Módulo ES6. Lee en paralelo: `reservations`, `availability`, `services`, `providers`, `payments`, `charges`, `reservation_requests`. Usa `availability` directamente (no la vista) porque no necesita campos sfcom.

Bloques: alertas críticas (sobrereservas, pagos/cobros vencidos, solicitudes pendientes), calendario de próximos pagos/cobros (filtrable), estado financiero con Chart.js, resumen por servicio/día. Tablas con sort por columna (4 tablas). Cobros y pagos pendientes son clicables: abren formulario.html o proveedores.html con el cliente/proveedor precargado via query params.

**Filtro con autocomplete en tablas de eventos y proveedores:** encima de cada tabla (`#tabla-eventos`, `#tabla-proveedores`) hay un campo de texto con autocomplete (`#selector-evento`, `#selector-proveedor`). Al hacer foco o escribir, se despliega una lista con los ítems coincidentes (filtrado por `.includes` case-insensitive). Clic en un ítem de la lista: fija el valor en el input, cierra la lista y llama a `renderEventos(id)` / `renderProveedores(id)` con el ID exacto, mostrando esa fila en modo detalle (con filas hijo desplegadas). Borrar el texto y dejar el input vacío restablece la vista completa. Las filas de las tablas son clicables: llaman a `window._seleccionarEvento(id)` / `window._seleccionarProveedor(id)`, que actualiza el input con el ID (o lo vacía si ya estaba seleccionado ese ítem — toggle), cierra la lista y re-renderiza. Clic fuera de cualquier `.autocomplete-wrap` cierra ambas listas. Patrón CSS: `.autocomplete-wrap` + `.autocomplete-list` (el mismo que se usa en proveedores.html e id de cliente en formulario.html).

**Indicador de margen (`_margenIndicador`):** punto de color `●` delante del ID en las tablas de eventos y de proveedores. Verde = margen ≥ 15% del ingreso; naranja = 0–15%; rojo = pérdida; sin punto = sin actividad (ingreso y coste a 0). Ingreso = `SUM(total_amount)` reservas no canceladas; coste según `billing_model` (`capacity`: total_slots×precio, `consumption`: slots_activos×precio, `fixed`: precio si hay alguna reserva, 0 si no). Las filas padre (evento o venue agregado) muestran el margen del conjunto, no el peor hijo. Implementado en `calcularEventos`/`calcularProveedores`; `filaEvento`/`filaDetalleProveedor`/`filaProveedor`/`filaDetalleServicio`.

**Cashflow dinámico:** el gráfico de cashflow filtra pagos/cobros a la temporada actual y usa fechas dinámicas (`_anioTemporada`, `_seasonStart`, `_seasonEnd`) en lugar de años hardcodeados.

**Verificación de consistencia financiera (`verificarConsistenciaFinanciera`):** se ejecuta al cargar el panel, usando los datos ya cargados en memoria (sin consulta adicional a Supabase). Comprueba dos dimensiones:

- **Por cliente:** `SUM(charges.amount)` debe coincidir con `SUM(reservations.total_amount)` para reservas no canceladas. Detecta: (a) cobros huérfanos — cliente con charges pero sin reservas activas; (b) cobro final desajustado — diferencia > €0.01 entre capas.
- **Por proveedor:** `SUM(payments.amount)` debe coincidir con el coste teórico según `billing_model`. Para cada fila de `availability`, calcula: `capacity` → `total_slots × price_per_slot`; `consumption` → `slots_activos × price_per_slot`; `fixed` → `price_per_slot` si hay alguna reserva activa, 0 si no. Usa la tabla `venues` (cargada en `Promise.all`) para resolver `venue_id → provider_id`.

**Output:** si todo cuadra → toast verde (`mostrarToast`). Si hay discrepancias → modal directo (`crearModal`, sin paso intermedio por alerta en el DOM) con tabla de errores por tipo (Cliente / Proveedor), ID, importes en BD, importe teórico y diferencia. El botón "Corregir automáticamente" en el modal ejecuta: para huérfanos → `supabase.from('charges').delete()` por `client_id`; para desajustados → `persistirCobrosCliente`; para proveedores → `persistirPagosProveedor`. Si algún cliente tiene cobros con historial (`collected=true` o `invoice_number IS NOT NULL`), se muestra un aviso en el modal antes de confirmar la corrección.

### sfcom.js
Módulo ES6. Toda la comunicación con tienda.sanfermin.com a través de la Edge Function `sfcom-bridge` (proxy transparente que reenvía server-to-server, resuelve CORS). El JS nunca llama directamente a sf-api-paula.php.

**Arquitectura:** `supabase.functions.invoke('sfcom-bridge', { body: { endpoint, method, payload } })`. La clave `X-Paula-Key` está en Supabase Vault (`SFCOM_API_KEY`), nunca en el código JS del cliente. Timeout de 12 segundos en la Edge Function.

**Endpoints disponibles en sf-api-paula.php** (únicos soportados — cualquier otro devuelve 403):
- `GET stock-all` → `{ updated_at, count, stock: { "id": qty, ... } }`. Todo el stock en una llamada. Clave = ID como string (variation_id para variaciones, product_id para simples). **Única forma de leer stock.**
- `PUT products/{id}` / `PUT products/{id}/variations/{var_id}` → modifica `stock_quantity`. Rate limit: 20 req/min, máx 2 simultáneas.
- `GET orders` → todos los pedidos WooCommerce, sin filtros. El filtrado (por status, fecha, dedup) se hace en JS cliente. No se pueden pasar query params.
- `GET products*` y cualquier otro endpoint de la WooCommerce REST API → **no disponibles**, devuelven 403. No usar.

**Fórmula de stock:**
```
nuevoStock = Math.max(0, Math.min(
    sfcom_slots_listed - SUM(slots WHERE origin_ref LIKE 'WEB%' AND status != 'Cancelada'),
    total_slots        - SUM(slots WHERE status != 'Cancelada')
))
```

**"Nombre como contrato":** solo al registrar pedidos sfcom entrantes (`registrarPedidosSfcom`). Se busca la entrada en `sfcom_listings` por `sfcom_service_name`. Para PUTs de stock y verificación, los IDs almacenados son la fuente de verdad.

**`sfcom_order_ref`:** formato `WEB026_1090` (`${order.number}_${order.id}`). Las reservas propias tienen `sfcom_order_ref = null`.

**Comisión sfcom:** 15%. Precio neto = precio bruto / 1.15. Aplicado al precargar precio desde solicitudes sfcom en formulario.js.

**Exports principales:**
- `syncStockToSfcom(supabase, venueId, serviceId)` — hace PUT si `sfcom_status === 'confirmed'`. Silencioso en éxito, modal de error en fallo. Llamar siempre después de cualquier operación que cambie reservas activas.
- `checkAvailabilityBeforeSave(supabase, venueId, serviceId, plazas)` — verifica antes de guardar reserva nueva. No bloquea si el GET de sfcom falla.
- `checkSfcomOrders(supabase)` — detecta pedidos nuevos y cancelados en sfcom, inserta en reservation_requests.
- `importarCanceladosSfcom(supabase, sfcomListings, cancelados)` — importa pedidos cancelados como leads con `status: 'cancelada_sfcom'`.
- `loadSfcomListings(supabase)` — carga el mapeo WooCommerce→servicio/venue. Usada en páginas que no son formulario.html.
- `verificarCoherencia(supabase)` — véase abajo.
- `mostrarModalConfirmacionSfcom(cambios)` — modal consultivo antes de PUTs. Devuelve `Promise<'sync'|'save'|'cancel'>`. Callers: `if (result === 'cancel') return` para abortar, `if (result === 'sync') await syncStockToSfcom(...)` para el PUT.
- `verificarConfirmarSfcom(supabase, dispId, productName, serviceId, excludeNames)` — véase abajo.

**`verificarCoherencia(supabase)`**

Devuelve `{ ok, errores[], avisos[], sfcom: { verificado, discrepancias[], idsMismatch[], fallos[], error } }`.

Comprobaciones que realiza (todas en cada llamada, automática o manual):
1. Integridad FK: reservas con venue/service/client que no existen en sus tablas maestras.
2. Sobrereserva: plazas activas superiores al total del venue/servicio.
3. Solicitudes pendientes: sfcom sin atender (aviso) y web sin atender (aviso).
4. Servicios `confirmed` sin `sfcom_product_id` (aviso).
5. Discrepancias de stock: compara stock real en sfcom (`stock-all`) con stock esperado según fórmula. Genera `sfcom.discrepancias[]`.
6. IDs de variación duplicados: detecta si dos servicios del mismo producto comparten `sfcom_variation_id` en `sfcom_listings`. Resultado va a `errores[]`.

`sfcom.idsMismatch[]` **siempre queda vacío** — sf-api-paula.php no expone `GET products/{id}/variations`, así que no es posible verificar el nombre de variación en WooCommerce. El parámetro `checkVariationNames` que aceptan los callers es ignorado.

`resultado.ok` es `true` solo si `errores[]` está vacío (las discrepancias sfcom no bloquean `ok`; tienen su propia sección en el modal).

**`verificarConfirmarSfcom(supabase, dispId, productName, serviceId, excludeNames)`**

Busca el nombre propuesto en la lista de productos conocidos y confirma la entrada en `sfcom_listings`. Fuente de la lista: query a `sfcom_listings` en Supabase (no a sfcom directamente, porque sf-api-paula.php no expone `GET products`). Esto significa que la lista incluye únicamente productos ya configurados en alguna fila de `sfcom_listings`. Si Hilario añade un producto nuevo que aún no aparece en ninguna fila, habrá que añadirlo manualmente con SQL o esperando a que se use por primera vez.

Flujo interno: `getSfcomProducts()` (Supabase) → `_inferirProductoEnSfcom()` (auto-match por nombre y día) → si no hay match, picker modal → upsert en `sfcom_listings` con product_id, variation_id y `sfcom_status: 'confirmed'`.

**Discrepancias `pendingExplains`:** cuando sfcom muestra más stock del esperado y el gap está cubierto íntegramente por solicitudes sfcom pendientes de procesar, la discrepancia no es un error. No aparece con botón de sincronización; el "Sincronizar todos" las ignora.

### sfcom-panel.js
Módulo ES6. Panel de gestión sfcom con KPIs, solicitudes pendientes, reservas con sfcom_order_ref, y listings activos con stock. Lee `availability_with_sfcom`. No escribe en BD. Reutiliza `verificarCoherencia`, `mostrarModalVerificacion` y `mostrarModalPreCorreccion` de `verificacion.js`.

KPIs incluyen: total neto de ventas sfcom, coste de proveedores, y margen neto (cruza cada reserva sfcom activa con disponibilidad para calcular coste unitario según billing_model).

### factura.js
Módulo ES6, importado por formulario.js. `initFacturacion(supabase)`.

Genera facturas PDF (via jsPDF) para hitos de cobro. Tres tipos: `adelanto` (pago parcial), `liquidacion` (pago final con adelantos previos ya facturados), `unico` (pago único sin adelantos).

Emisor: Paula Díaz Echalecu, NIF 72694758S. IVA: 21%. IRPF: 15%. Serie: VSF. Número correlativo por ejercicio (calcula consultando invoice_number en charges del año en curso). Campos editables con `contenteditable`. Persiste `invoice_number` e `invoiced: true` en charges.

El nombre del receptor usa `_cliente.company ?? _cliente.name ?? _cliente.id`.

**Flujo de envío:** al abrir el diálogo, `abrirPanelFactura` llama a `mostrarOpcionesEnvio` con `tipo='pdf'` y `onGenerar=_emitir`. Los botones (Solo PDF / PDF+correo / PDF+WhatsApp) se renderizan en `#factura-botones-envio` dentro del footer del `<dialog id="dialogFactura">`. El botón con foco es WhatsApp si hay teléfono, Email si hay email, Solo PDF si no hay contacto. Un clic ejecuta `_emitir()`: lee los campos editables del preview, actualiza datos del cliente si cambiaron, genera el PDF, lo sube a Storage (bucket `invoices`), persiste `invoice_number`, `invoiced: true`, `invoiced_at` en el hito y dispara `facturaEmitida`; después abre el canal elegido. Templates de asunto/cuerpo en `FACTURA_CONFIG` al inicio del módulo.

### propuesta.js
Módulo ES6, importado por formulario.js. `initPropuesta(supabase, servicios, venues, getDisponibilidad)`.

Genera propuestas PDF para reservas seleccionadas. Serie PRP. Textos editables en el mock-up. Logo en base64 cargado al inicializar. Nombre del servicio: `svc.name ?? svc.description ?? r.service_id`.

**Flujo de envío:** al abrir el diálogo, `abrirPanelPropuesta` llama a `mostrarOpcionesEnvio` con `tipo='pdf'` y `onGenerar=_generarYSubir`. Los botones (Solo PDF / PDF+correo / PDF+WhatsApp, según contacto disponible) se renderizan en `#propuesta-botones-envio` dentro del footer del `<dialog id="dialogPropuesta">`. El botón con foco es WhatsApp si hay teléfono, Email si hay email, Solo PDF si no hay ninguno. Un clic genera el PDF, lo sube a Storage (bucket `proposals`), persiste `proposal_number` y `proposal_path` en todas las reservas de la propuesta, dispara `propuestaEmitida` y abre el canal elegido. La función se llama de nuevo cada vez que se abre el diálogo (por si el cliente cambia entre aperturas).

### tablas.js
Módulo ES6. Vista de solo lectura de todas las tablas. Selector de tabla, búsqueda en tiempo real, sort por columna, botón "⬇ Excel" usando `exportTable`.

### asistente.js
Módulo ES6. Módulo reutilizable. Importado por formulario.js y solicitudes.js.

**Inicialización:**
```js
initAsistente(supabase, {
    getDisponibilidad,      // () => array disponibilidad en memoria
    getTodasReservas,       // () => array reservas en memoria
    onEmailSaved,           // () => callback tras insertar email parseado
    esSfcom,                // (source) => boolean
    onRespuestaUsada,       // (texto, solicitud) => void — opcional
    onBorradorActualizado,  // (solicitudId, draft) => void — opcional
    getNotasSesion          // () => string — notas de sesión actuales; opcional
})
```

`formulario.js` llama a `initAsistente` sin `onRespuestaUsada`, `onBorradorActualizado` ni `getNotasSesion` (parámetros con default `null`), lo que es seguro porque la firma usa `?? null` en la destructuración.

**Exports:**
- `initAsistente(supabase, callbacks)` — inicialización
- `abrirAsistenteRespuesta(solicitud, modo = null)` — abre el modal del asistente
- `abrirProcesarEmail()` — abre el modal de parseo de emails (sin args)

**`abrirAsistenteRespuesta(solicitud, modo = null)`:**
- `modo = null`: flujo normal, Claude presenta disponibilidad y propone mensaje
- `modo = 'recordatorio'`: Claude sabe que el cliente ya recibió respuesta y no ha contestado; genera seguimiento breve

El tipo de solicitud se detecta automáticamente: `sfcom_reserva` / `email` / `web`.

**Contexto que se envía a Claude (primer mensaje de usuario):**
```js
{
    solicitud: {
        tipo, nombre, evento, dia, personas,
        idioma,              // campo language o 'desconocido'
        comentario,          // comments sin prefijos Días:/Otros servicios:
        conversation_log,    // conversation_notes, truncado a 2000 chars si es mayor
        assigned_venue_id,
        status,
        modo,
        proposal_draft       // array de líneas del borrador actual
    },
    disponibilidad: [...]   // un objeto por venue (ver estructura abajo)
}
```

`email` y `telefono` no se incluyen en el contexto de Claude: Paula ya los tiene visibles en el panel.

`conversation_log` se trunca a los últimos 2.000 caracteres con prefijo `[... conversación anterior truncada ...]` si supera esa longitud. Lo relevante para la respuesta actual es lo más reciente.

**`disponibilidadParaAsistente(serviceIds, primaryDay, personas)`:** agrupa por `venue_id + event_type` (un objeto por venue, no por venue+día). `personas` viene de `solicitud.slots` y controla los filtros de capacidad.

**Filtro de inclusión:** `available = libres + pending`. Incluir si `available >= personas` (o `> 0` si personas es null). Los casos "sold out confirmado" y "venue demasiado pequeño" quedan excluidos implícitamente porque `libres + pending ≤ total_slots - confirmed`.

**Orden:** capacity primero, luego `libres` DESC, luego `pending` DESC.

`precio` calculado por cuartil superior (top 25%) de reservas históricas Confirmadas/Pendientes para ese venue+event_type. Se omite si no hay historial.

Estructura para encierros (multi-día):
```js
{
    venue_display_name: "Balcón Estafeta nº45",
    billing_model: "capacity",
    catalogo_url: "https://...",
    dias: [                                          // día solicitado primero, resto ascendente
        { dia: 7, plazas: 12, precio: 150 },         // plazas: libres sin ninguna reserva activa
        { dia: 9, plazas: 0, plazas_pendientes: 8, precio: 150 }  // 0 libres, 8 en pendientes
    ]
}
```

Estructura para eventos de día único (chupinazo, procesion, gigantes, pobre_de_mi):
```js
{
    venue_display_name: "Balcón Ayuntamiento",
    billing_model: "capacity",
    plazas: 18,                    // libres sin ninguna reserva activa
    plazas_pendientes: 4,          // opcional, solo si existen reservas Pendientes activas
    precio: 500,
    catalogo_url: "https://..."
}
```

`catalogo_url` se construye solo si hay `venue_slug` Y `event_type`; null si falta alguno. Ordenadas: capacity primero (venues con plazas libres antes de los que solo tienen pendientes), luego consumption.

**Marcadores de respuesta:** cuando Claude incluye `---MENSAJE_CLIENTE---`, el texto entre ese marcador y el siguiente (o el fin de la respuesta) aparece en un textarea editable. Si Claude incluye además `---BORRADOR---` seguido de un array JSON, ese JSON se extrae y nunca llega al textarea (el cliente no lo ve).

**Botones de envío:** renderizados por `mostrarOpcionesEnvio` (de `utils.js`) en `#asistente-botones` cada vez que Claude completa una respuesta con mensaje final. `getTexto: () => elMsgFinal.value` — siempre lee el valor actual del textarea, por lo que el texto enviado/copiado refleja las ediciones manuales de Paula. Al pulsar cualquier botón: (1) ejecutan su acción principal (copiar al portapapeles / abrir mailto / abrir wa.me), (2) el callback `onUsado` llama a `_alUsarBoton(texto)` que: inserta el mensaje en el log como `<Paula>` vía `_onRespuestaUsada`, guarda el borrador si había `---BORRADOR---` vía `_onBorradorActualizado`, cambia el estado de la solicitud a `respuesta_enviada`, convierte la X de cierre en "✓ Cerrar" (verde). Si Paula escribe un nuevo mensaje en el textarea de input, el área de resultado se oculta y se vuelve al modo conversación. No existe el botón "✅ Usar respuesta". Los botones Email y WhatsApp solo aparecen si `solicitud.client_email` / `solicitud.client_phone` tienen valor.

**Guardar log:** botón visible pero discreto. Guarda `messages` y `context_snapshot` en `assistant_logs`.

**Edge Function `claude-proxy`:** único punto de entrada a la Claude API. Verifica JWT. Acepta `{ messages, system?, max_tokens?, model? }`. `system` puede ser `string` o `array` de bloques (`{ type, text, cache_control? }`). Modelo por defecto: `claude-sonnet-4-6`. Lista blanca: `claude-sonnet-4-6`, `claude-opus-4-7`, `claude-haiku-4-5-20251001`. Header `anthropic-beta: prompt-caching-2024-07-31` activo — aplica prompt caching si los bloques llevan `cache_control: { type: 'ephemeral' }`.

**Prompt caching implementado:** `asistente.js` pasa `system` como array de bloques con caché:
1. `SYSTEM_PROMPT_ASISTENTE` — siempre presente, marcado `cache_control: ephemeral`.
2. Notas de sesión de Paula — segundo bloque, solo si `_getNotasSesion()` devuelve texto no vacío, también marcado `cache_control: ephemeral`.
Además, el penúltimo mensaje del historial también lleva `cache_control: ephemeral` para cachear el historial acumulado en conversaciones largas. El email parser (`abrirProcesarEmail`) sigue pasando `system` como string (compatible porque la EF detecta el tipo con `Array.isArray`).

**`abrirProcesarEmail()`:**
1. Paula pega el texto del email (con cabeceras, firmas, etc.)
2. Claude Haiku (especificado explícitamente) parsea con `SYSTEM_PROMPT_PARSING` → JSON estructurado
3. Modal de revisión con campos editables precargados
4. "Guardar" → INSERT en reservation_requests con `source='email', status='nueva'`; "Guardar y responder" → lo mismo + abre el asistente

### asistente-config.js
Exporta `SYSTEM_PROMPT_ASISTENTE` y `SYSTEM_PROMPT_PARSING`. Separado de asistente.js para poder actualizar los prompts subiendo solo este archivo por FTP, sin tocar la lógica.

El system prompt incluye una sección **BORRADOR DE PROPUESTA** que instruye a Claude sobre cuándo emitir el bloque `---BORRADOR---` (solo junto a `---MENSAJE_CLIENTE---` y solo cuando el mensaje contiene una propuesta concreta), qué campos incluir en el JSON, y cómo usar el borrador recibido en el contexto para entender el estado actual de la negociación.

La sección de borrador también documenta el campo `estado` de cada línea: `'pendiente'` (en negociación, sin reserva — estado inicial), `'hecha'` (ya convertida en reserva — confirmar que esa parte está cerrada, no volver a ofrecerla), `'descartada'` (el cliente no quiso — no ofrecer de nuevo, pero útil para entender el contexto). Claude **no genera** el campo `estado` — el sistema lo gestiona automáticamente.

Si se actualiza el prompt: revisar que los nombres de campo son coherentes con la estructura del contexto documentada en la sección `disponibilidadParaAsistente` de este documento. El prompt de caching tiene TTL de 5 minutos — solo ahorra tokens dentro de la misma sesión del navegador.

---

## 5. Catálogo de balcones (`/catalogo/`)

Sección no indexada para compartir fichas con clientes. Solo accesible por URL directa.

```
catalogo/
├── index.html      ← listado por event_type (uso interno/agentes)
├── balcon.html     ← ficha individual
├── catalogo.js     ← script clásico, usa window.supabasePublic
└── catalogo.css
```

**URLs:**
- `catalogo/balcon.html?v=SLUG&et=EVENT_TYPE` — ficha filtrada por tipo de evento (link habitual para compartir con clientes)
- `catalogo/balcon.html?v=SLUG` — ficha completa con todos los event_types del venue (fallback)

Ambas páginas tienen `<meta name="robots" content="noindex, nofollow">`. No aparecen en el sitemap.

**event_types del catálogo:** `encierro`, `chupinazo`, `procesion`, `despedida_gigantes`, `pobre_de_mi`, `visita_guiada`, `otro`.

**Ficha individual (`balcon.html`):** cabecera con tipo de venue, nombre (h1), event_type label, dirección. Cuerpo: carrusel de fotos si photos.length > 1, foto única si = 1. Las fotos vienen de la primera fila del event_type filtrado (el trigger garantiza que todas las filas del mismo venue+event_type tienen las mismas fotos). Descripción e instrucciones de acceso si existen. OG tags sobreescritos dinámicamente por JS para preview en WhatsApp.

**Listado (`index.html`):** grid de venues agrupados por event_type en secciones. Un venue puede aparecer en varias secciones si ofrece varios event_types.

**Datos:** solo a través de `catalogo_publico`. No hay JOINs directos.

**Integración con el asistente:** `disponibilidadParaAsistente` incluye `catalogo_url` por cada entrada de disponibilidad (construida solo si hay `venue_slug` Y `event_type`). El system prompt instruye a Claude a incluir el link de forma natural.

---

## 6. Integración sfcom

### Productos conocidos en tienda.sanfermin.com (verificado mayo 2026)

**Productos simples:**
| ID sfcom | Nombre | Service ID |
|---|---|---|
| 131 | Balcón Chupinazo Día 6 julio Plaza Ayuntamiento | CHUPINAZO_6 |
| 138 | Balcón Chupinazo 6 Julio (Plaza del Castillo) | CHUPINAZO_6 |
| 140 | Barrera Encierro (Cuesta Santo Domingo) | ENCIERRO_? — stock null, no sincronizar |
| 142 | Pobre de Mí 14 Julio | POBRE_DE_MI |
| 145 | Procesión San Fermín 7 Julio | PROCESION_7 |
| 215 | Entrada Adulto Gigantes | DESPEDIDA_GIGANTES_14 (hijo de 147) |
| 216 | Entrada Niño Gigantes | DESPEDIDA_GIGANTES_14 (hijo de 147) |

Producto 147 (Despedida de Gigantes) es de tipo `grouped`, stock null. Los PUTs de stock deben hacerse a los hijos 215 y 216. **Nunca usar 147 como sfcom_product_id.**

**Productos variables (con variaciones por día de encierro):**

*124 — Balcón Ayuntamiento Encierro* (variable, 6 variaciones IDs 281–286, mapeo día→variación: verificar con sfcom_listings en Supabase).

*133 — Balcón Estafeta* (variable): 152→día8, 154→día10, 156→día13, 157→día14.

*883 — Balcón Estafeta mitad* (variable): 886→día7, 887→día8, 889→día10, 890→día13, 891→día14, 943→día11.

*894 — Balcón Mercaderes* (variable): 897→día8, 898→día9, 899→día10, 900→día13, 901→día14, 1089→día11.

**Formato de pedidos (`GET orders`):**
```js
{
    id: 1090,
    number: 'WEB026',        // string
    status: 'completed',
    date_created: '2026-05-21T13:14:55',
    total: '300.00',
    billing: { first_name, last_name, email, phone, address_1, city, country },
    line_items: [{ name, product_id, variation_id, quantity, total }]
    // li.name = nombre completo: "Balcón Estafeta - Viernes 10 de Julio 2026"
}
```

`origin_ref` en la reserva resultante = `${order.number}_${order.id}` (ej: `WEB026_1090`).

---

## 7. Deuda técnica activa

Las deudas están organizadas por tipo de impacto. Los bugs (7.1) son los únicos que producen resultados incorrectos ahora mismo; el resto son mejoras de calidad, funcionalidades pendientes, o tareas de investigación.

---

### 7.1 Bugs — producen comportamiento incorrecto ahora mismo

**✅ RESUELTO — Asistente recibía lista de disponibilidad vacía en solicitudes web y sfcom.**

Causa raíz: `expandirServiceIds` en `asistente.js` hacía matching exacto contra `'chupinazo'`, `'encierro'`, etc., pero las solicitudes web y sfcom guardan `level` como slug completo (`'vivir-el-chupinazo'`, `'ver-el-encierro'`). El match fallaba → `serviceIds = []` → `disponibilidadParaAsistente` devolvía `[]` inmediatamente. Solo funcionaba para solicitudes de email (donde Claude parsea el nivel en formato corto).

Fix (jun 2026): añadido paso de normalización `split('-')` al inicio de `expandirServiceIds`, igual que el fix aplicado días antes a `_preFillBorradorSiVacio` y `_inferirServiceId`. También corregido `_inferirServiceIds` en `solicitudes.js` (mismo patrón, afectaba solo a `_calcularPrecioRef`).

---

**✅ RESUELTO — Borrador vacío en solicitudes web con `level` en formato slug completo.**

`_preFillBorradorSiVacio` en `solicitudes.js` usaba coincidencia exacta (`sol.level === 'chupinazo'`) pero el formulario web envía slugs completos (`'vivir-el-chupinazo'`). Resultado: el borrador quedaba vacío para todas las solicitudes web con tipo de experiencia. Corregido en jun 2026 adoptando enfoque split-by-dash (igual que `_inferirServiceId` en formulario.js). Caso que lo evidenció: solicitud de Sara.

---

**✅ RESUELTO — Solicitudes ya atendidas aparecían como pendientes en panel y formulario.**

Dos cambios aplicados (jun 2026):
- `panel.js` `calcularAlertas()`: `solicitudesSfcom` filtra `status === 'nueva'`; las web se dividen en `solicitudesWebNuevas` (`status === 'nueva'`) y `solicitudesWebSeguimiento` (`status === 'seguimiento_pendiente'`), mostradas en la misma alerta con etiquetas separadas ("X nuevas sin atender, Y en seguimiento pendiente").
- `formulario.js` `cargarSolicitudes()`: `otrasActivas` usa `status === 'nueva'` (antes `status !== 'respuesta_enviada'`).

---

**`resolverCliente` en `utils.js` hace matching de nombre demasiado permisivo.**

La comparación usa `.includes()` en ambas direcciones: `dNom.includes(cn) || cn.includes(dNom)`. Si el cliente almacenado tiene un nombre corto (ej. `"LUIS"` → id `RODRIGUEZ_LUIS`), cualquier solicitud nueva con nombre `"Luis Ángel Reglero"` activa el match porque `"LUIS ANGEL REGLERO".includes("LUIS")` es `true`. Resultado: Paula ve el modal de cliente existente apuntando a la persona equivocada.

Fix parcial aplicado (jun 2026): se añadió umbral mínimo de 5 caracteres para el `.includes()` en ambas direcciones. Pendiente: la comparación sigue siendo frágil cuando dos clientes comparten parte del nombre (p.ej. `"GARCIA PEDRO"` vs `"GARCIA MARIA"`). La solución completa requeriría coincidir al menos dos palabras completas o usar distancia de edición. El match por email y teléfono no tiene este problema.

---

**✅ CONFIRMADO — Marcar cobro como cobrado no persiste en Supabase.**

Confirmado en jun 2026 (prueba Fase 0d): marcar el cobro como cobrado en `formulario.js` bloque 5 muestra el check verde en la UI y cambia el botón a "marcar pendiente", pero `collected` sigue a `false` y `collected_date` sigue a `null` en Supabase tras la operación. La UI actualiza el estado solo visualmente; el UPDATE no se ejecuta o falla silenciosamente. Investigar: (1) añadir log de error visible en el handler de "marcar cobrado" en bloque 5 de `formulario.js`, (2) verificar que el listener existe en el elemento correcto y no hay un re-render que lo elimine antes del clic.

---

**Cobros facturados pero no cobrados no se pueden editar.**

Si un hito tiene `invoice_number IS NOT NULL` (se generó una factura), el sistema bloquea la edición del importe aunque `collected = false`. En la práctica, las reservas cambian en el último momento y la factura original queda desfasada. La función `persistirCobrosCliente` crea un "hito de ajuste" automáticamente, pero ese mecanismo no es operable ni visible desde la UI del cliente en `formulario.js`. El criterio de editabilidad debería ser `collected = false`, no `invoice_number IS NULL`. Fix: revisar `formulario.js` bloque 5 para permitir editar el `amount` de un hito mientras `collected = false`, aunque haya `invoice_number`, y añadir una advertencia visible de que la factura emitida ha quedado desfasada.

---

**Botón "Facturar" no aparece hasta recargar la página.**

Al añadir un cobro nuevo en bloque 5 de `formulario.js`, el cobro aparece en la tabla pero el botón "Facturar" no se renderiza hasta recargar la vista. Causa raíz: patrón genérico de UI desactualizada tras efectos secundarios — ver §7.2. Fix: llamar a `cargarCobrosCliente(clienteId)` tras el INSERT del cobro en lugar de solo actualizar el estado local.

---

**PDFs en Supabase Storage quedan huérfanos al borrar reservas o charges — diferido a Fase 9.**

Verificado jun 2026. No hay ningún `storage.from(...).remove(...)` en ningún flujo de eliminación del panel. Lo que queda huérfano:

- `proposal_path` en reservas borradas: en cualquier eliminación (`eliminarSeleccionadas`), las reservas se borran pero sus PDFs de propuesta en el bucket `proposals` no. Los paths se pierden con la fila.
- `invoice_path` en charges borrados: solo en el flujo `isLastReservation`, donde se eliminan todos los `charges` del cliente (línea 860 de `formulario.js`). Los PDFs de facturas en el bucket `invoices` quedan inaccesibles.

Impacto: muy bajo. PDFs de ~100KB cada uno; con el volumen del proyecto no van a afectar al límite de Storage de Supabase. Los archivos son inaccesibles pero no causan ningún problema funcional para Paula.

Fix (diferido a Fase 9): en `eliminarSeleccionadas` de `formulario.js`, antes de los DELETEs: (1) recoger `proposal_path` de `todasReservas.filter(r => ids.includes(r.id))`, llamar a `storage.from('proposals').remove([...paths])`; (2) en el caso `isLastReservation`, ampliar el SELECT de charges (línea 816) para incluir `invoice_path`, recoger los no nulos y llamar a `storage.from('invoices').remove([...paths])`. Unas 15 líneas en total. Se abordará junto con la gestión de Storage en Fase 9.

---

**✅ RESUELTO — `_onBorradorActualizado` preserva ahora el campo `estado` al actualizar desde el asistente.**

Fix en `solicitudes.js`: antes de persistir el nuevo draft recibido del asistente, cada línea nueva se empareja con la existente por `service_id + venue_id` y copia el campo `estado` de la versión en memoria. Las líneas nuevas (sin pareja) quedan sin `estado` (interpretado como `'pendiente'`). El array resultante se persiste en Supabase y se usa para refrescar la tabla del borrador.

---

**✅ RESUELTO — `payments` del proveedor se recalculan correctamente al eliminar una reserva.**

Verificado jun 2026. `eliminarSeleccionadas` en `formulario.js:875` llama a `persistirPagosProveedor` tras el borrado, que recalcula y upserta el pago final del proveedor con las reservas actualizadas. Lo documentado en la prueba Fase 0d estaba desactualizado.

---

**✅ RESUELTO — `availability` sin UNIQUE(venue_id, service_id) y venue_id nullable.**

Ambos aplicados en jun 2026: `ALTER TABLE availability ADD CONSTRAINT uq_availability_venue_service UNIQUE (venue_id, service_id);` y `ALTER TABLE availability ALTER COLUMN venue_id SET NOT NULL;`. Verificado previamente que no existían duplicados ni NULLs en los datos.

---

**✅ INVESTIGADO Y ACEPTADO — 6 reservas activas con total_amount = 0.**

Las reservas R0120, R0074, R0063, R0064, R0102, R0108 tienen `price_per_slot = 0` y están activas. Investigado en jun 2026: son invitaciones o servicios sin coste (intencionados). No son errores de entrada de datos.

---

**✅ INVESTIGADO Y ACEPTADO — MARTIKO y NACHO_GALLARDO con cobros pero sin reservas activas.**

Investigado en jun 2026: los charges de estos clientes son a importe 0 (intencionados). La verificación de consistencia financiera no los detecta como error porque `SUM(charges) = 0 = SUM(reservas activas)`, que es la situación correcta para estos casos. Situación aceptada; no requiere acción.

---

**✅ RESUELTO — Email duplicado: giovanni.soliman@gmail.com.**

El registro duplicado fue eliminado en jun 2026. No tenía reservas ni charges activos — era un residuo de un intento de borrado incompleto previo.

---

**✅ RESUELTO — Cascade al borrar servicios de proveedor en varias tandas.**

El incidente real (jun 2026, fusión de proveedores duplicados) ocurrió antes de que existiera la lógica cascade actual. El código en `proveedores.js:1887-1944` maneja correctamente el caso multi-tanda: cada vez que `btnEliminarServicio` se dispara, filtra `todaDisponibilidad` en memoria tras cada borrado y comprueba si el venue quedó vacío. Si es el último venue del proveedor (`hayOtrasConServicios = false`), abre `_modalOpcionesEliminar` ofreciendo borrar venue + proveedor. Funciona independientemente de cuántas tandas se usen.

Edge case menor aceptado: si un venue quedó sin availability en una sesión anterior (sin pasar por el botón de borrado en esa sesión), no entra en `venuesAfectadas` en la sesión actual. El resultado es un venue vacío en la BD sin impacto funcional. Frecuencia esperada: prácticamente nula.

---

**✅ RESUELTO — Tabla de servicios del proveedor mezclaba todos los venues (jun 2026).**

`cargarServiciosProveedor` filtraba `todaDisponibilidad` por `venue_provider_id` (todos los venues del proveedor) y `selectVenueTab` no actualizaba la tabla al cambiar de pestaña. Resultado: un proveedor con dos venues mostraba los servicios de ambos a la vez. Corregido: el filtro pasó a `venue_id === venueActual.id` y `selectVenueTab` llama a `cargarServiciosProveedor` al finalizar.

---

**✅ RESUELTO — Asistente: edición del textarea de respuesta ya se refleja en `mensajes` y en el log (Fase 6b).**

**✅ RESUELTO — Asistente: toggle auto-guardar log implementado (Fase 6b).** El botón "Guardar log" fue sustituido por un toggle estilo iOS en la cabecera del modal. Por defecto activo. Guarda automáticamente al cerrar el modal; también guarda al activar el toggle si estaba desactivado.

---

### 7.2 UX — puntos de fricción en el uso diario

**UI no refleja datos derivados ni efectos secundarios hasta recargar la página.**

Patrón recurrente en el panel: cuando una operación de guardado tiene efectos secundarios en Supabase (un trigger, una llamada a `persistirCobrosCliente`, `persistirPagosProveedor`, etc.), la UI actualiza solo lo que el JS modificó directamente, pero no re-renderiza los elementos que cambiaron como consecuencia. Casos confirmados:

- `proveedores.js`: al guardar las fotos de un availability row, el trigger `trg_sync_availability_event_type` propaga los cambios a todas las demás filas del mismo venue+event_type. La UI no los refleja hasta que el usuario recarga la página.
- `formulario.js` bloque 5: al añadir un cobro, `persistirCobrosCliente` crea un "cobro final" adicional. El cobro nuevo ni el botón "Facturar" aparecen hasta recargar.

Patrón de fix: tras cualquier save con efectos secundarios conocidos, re-leer de Supabase los datos afectados y re-renderizar. En la práctica, basta con llamar a la función de carga existente (`cargarVenue(id)`, `cargarCobrosCliente(clienteId)`, etc.) después del save, en lugar de solo modificar el estado local. El coste de red es despreciable dado el volumen de datos. Fix natural a incorporar cuando se toquen `proveedores.js` y `formulario.js` en otras fases — no justifica una fase propia.

---

**✅ RESUELTO — Pedidos sfcom ya registrados no aparecían en bloque 0 (jun 2026).**

Bug introducido en la refactorización de reducción de modales (Fase 5). Al cargar `formulario.html`, `checkSfcomOrders` devolvía pedidos en `resultado.nuevos` aunque ya estuviesen en `reservation_requests`. `registrarPedidosSfcom` los filtraba internamente y hacía early return sin llamar `cargarSolicitudes()`. El `.then()` había tomado el camino `if` (no el `else`), por lo que `cargarSolicitudes()` no se llamaba nunca. Bloque 0 quedaba vacío aunque hubiera solicitudes sfcom con `status='nueva'`.

Fix: `cargarSolicitudes()` se saca del interior de `registrarPedidosSfcom` y se llama siempre al final del `.then()`, independientemente de si se insertaron filas nuevas.

---

**✅ RESUELTO — Exceso de modales en flujo sfcom y flujo de eliminación (jun 2026).**

6 cambios aplicados en `formulario.js` y `sfcom.js`:

**A — `checkAvailabilityBeforeSave` silenciado cuando la brecha está explicada:** el check sigue ejecutándose siempre, pero si `solicitudOriginRef?.startsWith('WEB')` y `(stockEsperado − stockSfcom) ≤ plazas` (la brecha es exactamente la del pedido en curso), no se muestra el `confirm`. Si hay brecha adicional inesperada, sí se muestra.

**B — `confirmarStockSfcom` auto-sincroniza sin modal cuando stock no cambia:** si `nuevoStock === stockActual` para todos los pares afectados, devuelve `'sync'` directamente sin abrir el modal consultivo. Sucede al procesar pedidos sfcom (que ya descontaron stock): el stock resultante coincide con el actual → no hay nada que preguntar.

**C — Confirm de cliente nuevo suprimido al venir de sfcom:** el `confirm('¿Crear cliente nuevo?')` se salta cuando `_cargandoSolicitud && solicitudOriginRef?.startsWith('WEB')`. Para reservas manuales sigue apareciendo.

**D — Cierre automático de solicitud sfcom:** `_ofrecerCerrarSolicitud` para refs WEB compara cuántos `reservation_requests` no descartados hay con cuántas reservas tienen ese `origin_ref`. Si quedan items sin procesar (pedido de varios productos), no cierra nada. Si todos están procesados, cierra sin confirm. Para refs no-WEB sigue pidiendo confirm como antes.

**E — Verificación auto-run con solo pendingExplains muestra toast en lugar de modal:** `ejecutarVerificacion(false)` (arranque de página) muestra un toast azul "ℹ️ N pedido(s) sfcom pendiente(s) de incorporar" cuando la única discrepancia es `pendingExplains`. Con `modoManual=true` (botón "Verificar datos") sigue mostrando el modal completo con la sección azul explicativa.

**F — Modal de eliminación unificado para última reserva:** antes de borrar nada, computa si las reservas seleccionadas son las últimas activas del cliente. Si sí: consulta cobros y muestra un único modal contextual (nuevo: `_modalEliminacionUltimaReserva`). Sin cobros con historial: "Cancelar" / "Eliminar reserva" / "Eliminar reserva y cliente". Con cobros facturados o cobrados: "Cancelar" (autofocus) / "Eliminar reserva y cobros" / "Eliminar Todo (incl. cliente)". Reemplaza el flujo previo de 3 interrupciones (confirm inicial + modal historial + confirm cliente).

---

**✅ RESUELTO — Cálculo de margen en panel.js incluye tipos de servicio sin actividad comercial relevante.**

Resuelto en jun 2026. Dos ajustes en `panel.js`:
- **Tablas** (`calcularEventos`, `calcularProveedores`): tipos no-balcón (`visita_guiada`, `otro`) solo aparecen si tienen reservas activas o al menos un row con `billing_model = 'capacity'`. Balcones aparecen siempre (si tienen plazas).
- **Sección potencial** (`calcularResumen`): `plazasLibres`, `costeAdicional`, `ingresoPotencial` y `margenNoCapturado` calculados solo sobre `TIPOS_BALCON = ['encierro', 'chupinazo', 'procesion', 'despedida_gigantes', 'pobre_de_mi']`. `precioMedioVenta` también filtrado a balcones confirmados.

---

**No hay UI para eliminar un cliente directamente.**

La única forma de borrar un cliente desde el panel es eliminar su última reserva: el JS detecta que no quedan más reservas y pregunta si también eliminar el cliente. Si el cliente ya no tiene reservas activas (nunca las tuvo, o ya se eliminaron todas), no hay ningún botón ni flujo para borrarlo. Workaround: crear una reserva temporal de 1€ para el cliente en cuestión y luego eliminarla, lo cual activa el modal de borrado encadenado. A nivel SQL: `DELETE FROM clients WHERE id = '...'` (asegurando primero que no quedan charges ni reservation_requests apuntando a ese cliente). Para Fase 5 o 9: añadir un botón "Eliminar cliente" con confirmación si no tiene reservas activas.

---

**Cambio de proveedor de una venue: no hay UI en admin.**

Si hay que reasignar una venue a un proveedor diferente (p.ej. cambio de propietario de un balcón), no existe ningún campo editable en `proveedores.js`. La FK `venues.provider_id` es NO ACTION en DELETE, pero permite UPDATE sin restricciones. El cambio en Supabase es directo: `UPDATE venues SET provider_id = 'NUEVO_PROVEEDOR' WHERE id = 'MI_VENUE'`. Dado que los casos son rarísimos, basta documentar ese SQL; si ocurriera con frecuencia, valorar añadir un `<select>` de proveedor en la UI de edición de venue en `proveedores.js`.

---

**✅ RESUELTO — Tablas del panel de control no son navegables.**

Resuelto en jun 2026. `filaEvento` y `filaProveedor` en `panel.js` tienen ahora `onclick="_seleccionarEvento(id)"` / `onclick="_seleccionarProveedor(id)"` y `cursor:pointer`. Las funciones `window._seleccionarEvento` y `window._seleccionarProveedor` actualizan el `<select>` y llaman a `renderEventos`/`renderProveedores`. Segundo clic sobre la misma fila la deselecciona (vuelve a vista de todas las filas). Bidireccional: cambiar el dropdown también actualiza la vista (ya funcionaba via el `change` listener existente).

---

**✅ RESUELTO — `services.image_url` editable desde proveedores.js.**

Campo `inputServicioImageUrl` añadido en la sección "Info del servicio" (`<details id="detailsServicioInfo">`). Se guarda vía `guardarDescripcionServicio` (autosave por `change`) y también en `btnGuardarServicio`. El auto-fill al guardar la primera foto (opción B) sigue pendiente como mejora futura — ver Fase 6 §9.

**Deuda pendiente — `services.comments` obsoleta.**

El campo `services.comments` existe en la BD pero el panel dejó de usarlo: el `inputServicioComments` fue repropuesto para guardar `availability.comments`. La columna puede eliminarse:
```sql
ALTER TABLE services DROP COLUMN comments;
```
Antes de ejecutar, verificar que ninguna función SQL, trigger o vista la referencie. En el código JS ya no se usa (`guardarDescripcionServicio`, `btnGuardarServicio`, `guardarServicioNuevo` actualizadas).

---

**✅ RESUELTO — UI de envío unificada (`mostrarOpcionesEnvio` en `utils.js`).**

Implementado como paso 0 de Fase 2. La función soporta dos modos (`tipo: 'texto' | 'pdf'`). Ver detalle completo en la tabla de exports de `utils.js` (§4). Usada por:

- `asistente.js`: `tipo='texto'` (default). Se llama cada vez que Claude completa una respuesta con `---MENSAJE_CLIENTE---`. Botones: Copiar / Enviar por correo / Enviar por WhatsApp. El primario es WhatsApp si hay teléfono.
- `propuesta.js`: `tipo='pdf'`. Se llama al abrir el diálogo (`abrirPanelPropuesta`), antes de cualquier acción. Botones: Solo PDF / PDF+correo / PDF+WhatsApp. Un clic genera el PDF y abre el canal en un solo paso.
- `factura.js`: `tipo='pdf'`. Se llama al abrir el diálogo (`abrirPanelFactura`). Mismo patrón que propuesta.
- `formulario.js` (bienvenida): `tipo='texto'`. Se llama desde `abrirModalBienvenida`. El texto ya está compuesto por `componerMensajeBienvenida`; `getTexto` lee el valor del `<textarea>` editable por Paula.

---

**Pestañas "Detalles del servicio" vs "Detalles del par" en el formulario de disponibilidad (`proveedores.js`).**

Actualmente el formulario de un par venue+servicio muestra siempre en paralelo (a) la información general del servicio (`services.description`, `services.image_url`) y (b) la información específica del par (`availability.description`, `availability.access_instructions`, `availability.photos`). Para servicios de balcón, la zona de par es la que importa; para servicios "extra" (visitas guiadas, charlas, apartado, corralillos, etc.), lo relevante es la zona de servicio, y tener la zona de par visible por defecto solo confunde.

**Diseño acordado:**
- Dos pestañas tipo `.venue-tab` (reutilizar el patrón ya existente en `proveedores.js` para alternar entre venues) bajo el encabezado "Detalles de {SERVICE_ID} para {VENUE_ID}": "Detalles del servicio" | "Detalles del par".
- La pestaña activa por defecto depende del tipo de servicio: balcón → "par"; extra → "servicio".
- Al cambiar a la pestaña no activa por defecto: mostrar un aviso breve e informativo (un solo clic para descartar, no bloqueante). Si es balcón: "Editar aquí afecta a TODOS los proveedores y días de este servicio, no solo a este balcón." Si es extra: "Si hay contenido aquí, anula la información general del servicio para este caso concreto."
- Indicador visual (punto/badge) en cada pestaña si esa zona ya tiene contenido (`services.description`/`image_url` para "servicio"; `availability.description`/`access_instructions`/`photos` para "par"), para que no pase desapercibido un override silencioso.

**Restricciones:** solo visibilidad/UX; el comportamiento de guardado no cambia. Paula puede editar cualquiera de las dos zonas siempre. La pestaña de servicio edita `services` (afecta a todos los pares de ese service_id) — verificar que el guardado ya apunta a la tabla correcta.

**Criterio de "balcón" — ✅ Decidido:** usar `venueActual.venue_type === 'balcon'`. Ya disponible en `proveedores.js` sin constante adicional. La alternativa `TIPOS_BALCON.includes(event_type)` es semánticamente más precisa pero requiere extraer o duplicar la constante de `panel.js:288`; diferido a Fase 9 si hay refactor de `utils.js`. Para el propósito del tab por defecto (UX), el tipo de venue es suficiente.

---

**Carousel de fotos: imágenes no uniformes rompen el layout.**

Las fotos subidas desde iPhone pueden ser landscape 4:3, portrait 9:16 u otros ratios. El carousel actual no tiene contenedor de tamaño fijo, por lo que la interfaz "salta" al navegar entre fotos de distintos ratios.

Fix: envolver la imagen en un contenedor `aspect-ratio: 16/9; overflow: auto`. La imagen con `width: 100%; height: auto; display: block` encaja perfectamente en 16:9, sobresale por abajo en imágenes más altas (scroll vertical) y por la derecha en imágenes más anchas que 16:9 (caso raro; scroll horizontal). CSS-only, sin JS. Aplicar también al carousel del catálogo público cuando se toque ese código.

---

**Carousel de fotos: no se puede reordenar.**

`availability.photos` es un `text[]` en Supabase. El orden importa: `photos[0]` es la imagen principal en propuestas y catálogo. Actualmente solo se puede añadir (al final) y eliminar; no reordenar.

Fix: añadir un botón "⬆ Subir" en el footer del carousel junto a `🗑`. Al pulsar: `photos.splice(idx - 1, 0, photos.splice(idx, 1)[0])` → guardar con `_savePhotos`. Solo activo cuando `_photoIdx > 0`. No requiere cambios en Supabase ni en Edge Functions.

---

### 7.3 Funcionalidades pendientes

**Botón "Verificar todo" global en el sidebar.**

Actualmente hay dos botones de verificación repartidos por el panel, con alcances distintos y sin presencia en todas las páginas:

- `formulario.html` → `🔍 Verificar datos` → ejecuta `verificarCoherencia` (coherencia reservas/plazas + stock sfcom + IDs de variación). Modo manual: siempre muestra modal. Modo auto (al cargar): modal solo si hay problemas.
- `sfcom.html` → `🔍 Comprobar stock / corregir` → ejecuta la misma `verificarCoherencia`, con código duplicado en `sfcom-panel.js` (función `ejecutarVerificacion` casi idéntica a la de `formulario.js`).
- `panel.html` → ejecuta `verificarConsistenciaFinanciera()` automáticamente al cargar. No hay botón manual para forzarla desde ninguna página. Comprueba: SUM(charges) == SUM(reservas no canceladas) por cliente; SUM(payments) ≈ coste teórico por proveedor según `billing_model`.
- `solicitudes.html`, `proveedores.html`, `tablas.html` → ninguna verificación de ningún tipo.

El objetivo es un único botón en el sidebar de todas las páginas que:
1. Ejecute las dos comprobaciones: `verificarCoherencia` + `verificarConsistenciaFinanciera`.
2. Siempre muestre el resultado en modal (no toast), aunque todo esté correcto.
3. Sustituya los dos botones actuales (o al menos los unifique).

**Trabajo necesario:**

_A. Añadir el botón a los HTML que no lo tienen._ El sidebar está duplicado en cada `.html`. Hay que editar `panel.html`, `solicitudes.html`, `proveedores.html` y `tablas.html` para añadir el mismo `<button id="btnVerificarDatos">` que ya tiene `formulario.html`. Unificar el label (hoy formulario usa "Verificar datos" y sfcom usa "Comprobar stock / corregir").

_B. Extraer `verificarConsistenciaFinanciera` a un módulo compartido._ Actualmente es una función closure en `panel.js` que cierra sobre variables locales (`charges`, `reservas`, `payments`, `disponibilidad`, `venues`). Para llamarla desde otras páginas necesita: recibir `supabase` como parámetro y hacer sus propias consultas, o exportar los datos que necesita a un módulo común. La opción limpia es extraerla a `verificacion.js` como `async function verificarConsistenciaFinanciera(supabase)` con sus propios SELECTs. Los datos que necesita son: `charges`, `reservas` (no canceladas), `payments`, `availability` (join con `venues` para obtener `provider_id`).

_C. Consolidar la función `ejecutarVerificacion`._ Existe casi idéntica en `formulario.js` y `sfcom-panel.js`. Candidato natural para `verificacion.js` como función exportada que acepte `supabase` y `modoManual`. Las dos copias actuales se reemplazarían por un import.

_D. Diseñar el modal combinado._ Dos opciones:
- Opción A (sencilla): encadenar los dos modales — primero el de `verificarCoherencia`, luego el de consistencia financiera — con un botón "Siguiente" al cerrar el primero.
- Opción B (completa): un único modal con dos secciones. Más trabajo de UI pero más limpio.

_E. Mantener el orden checkSfcomOrders → verificarCoherencia._ El código de `formulario.js` documenta por qué importa este orden: los pedidos que registra `checkSfcomOrders` afectan a `pendingExplains` en la verificación. Desde páginas sin `checkSfcomOrders` (panel, solicitudes…) la verificación puede arrancar directamente; desde formulario y sfcom hay que respetar el orden.

**Dudas pendientes de decidir (anotar respuesta cuando se vaya a implementar):**
1. ¿Modal encadenado (opción A) o modal unificado (opción B)?
2. En `panel.html`, la verificación financiera ya corre sola al cargar. ¿El botón global la vuelve a ejecutar igualmente (redundante pero inofensivo), o en `panel.html` el botón solo ejecuta `verificarCoherencia` (la parte que ahora falta allí)?
3. ¿Renombramos el botón en `sfcom.html` para unificarlo ("Verificar datos" en lugar de "Comprobar stock / corregir"), o mantenemos el label diferenciado en esa página?

---

**sfcom — leads de pedidos cancelados.** ✅ Implementado jun 2026. Ver Fase 5 §9 para el detalle completo.

**Pendiente — dedup multi-venue/multi-día:** si un mismo cliente cancela el mismo encierro en venue A y venue B (o el mismo venue en días distintos), hoy se crean dos leads por separado. Plan: detectar en la importación y fusionar `proposal_draft` en la solicitud existente, o mostrar un aviso manual. No hay urgencia hasta que ocurra en producción.

**Pendiente — consolidar lógica de matching sfcom:** `importarCanceladosSfcom` en `sfcom.js` duplica el matching de producto de `registrarPedidosSfcom` en `formulario.js` (búsqueda por nombre, desambiguación por día, búsqueda por IDs). La diferencia real es el status, el tratamiento del lead y la ausencia de modales. Objetivo: extraer el matching a `_resolverProductoSfcom(li, sfcomListings)` → `{ serviceId, venueId, levelToSave }` y que ambas lo consuman.

**Pendiente — `created_at` con fecha real del pedido para sfcom confirmados:** los cancelados ya usan `pedido.fecha` (`order.date_created`). Los confirmados (`registrarPedidosSfcom` en `formulario.js`) siguen usando la fecha de importación. Añadir `created_at: pedido.fecha || undefined` al INSERT de `registrarPedidosSfcom`.

**Pendiente — fecha de solicitud en leads web:** las solicitudes que entran por el formulario web tienen `created_at = NOW()` (momento de inserción), no la fecha en que el cliente lo envió. Evaluar si el webhook/edge function puede pasar la fecha de envío, o si la diferencia es siempre despreciable.

---

**Comunicaciones semi-automáticas.**

El asistente ya puede redactar confirmaciones de reserva y recordatorios previos al evento. Falta el flujo de envío: un botón en la ficha de reserva que abra el asistente en modo `'confirmacion'` o `'recordatorio'`, genere el mensaje y lo envíe vía WhatsApp o email (Resend). Pendiente de diseñar: qué canal usar, si se necesita un nuevo `modo` en `abrirAsistenteRespuesta`, y si el envío es manual (copy-paste) o automático (Resend API).

---

**Facturación canal sfcom.**

✅ Implementado en Fase 8 (jun 2026). Ver §9 Fase 8 para el diseño completo, todos los cambios de código y los SQL ejecutados. Las reservas sfcom quedan en los clientes reales con un cargo automático `'Cobrado vía sfcom'`. El cliente `SFCOM` agrupa las ventas del canal y permite facturar a Hilario desde el flujo normal.

---

**Mejoras en la calidad de las propuestas.**

Las propuestas tienen más datos disponibles ahora de los que usan. Mejoras identificadas:
- Usar `venues.display_name` como nombre del venue (en lugar del id).
- ✅ `availability.photos[0]` como imagen principal de cada línea — ya funciona. El campo `photos` debe estar incluido en el `.select()` de `availability_panel` en `formulario.js` (imprescindible; si se omite, `disp.photos` es siempre `undefined` y cae al fallback `svc.image_url`).
- Mostrar `availability.access_instructions` si está relleno.
- Mejorar el contexto que recibe Claude para el borrador (más datos de disponibilidad = propuestas más concretas).

---

**✅ RESUELTO — Renombrar IDs de cliente, proveedor, venue o servicio (jun 2026).**

Implementado en dos partes:

**BD (Supabase SQL Editor):** todas las FKs de IDs de texto ahora tienen `ON UPDATE CASCADE`. Adicionalmente, `payments.provider_id → providers` y `availability.venue_id → venues` tienen `ON DELETE CASCADE`; `reservation_requests.assigned_venue_id → venues` tiene `ON DELETE SET NULL`. Con esto, `UPDATE clients SET id = 'NUEVO' WHERE id = 'VIEJO'` propaga automáticamente a `reservations.client_id` y `charges.client_id` (y análogamente para providers, venues y services).

**UI (código):** función `abrirRenombrarId({ tabla, idActual, supabase, onSuccess })` exportada desde `utils.js`. Abre un modal con input pre-rellenado, conversión live a mayúsculas/guiones bajos (mismo patrón que los campos ID existentes), validación de colisión, y UPDATE en Supabase. Botón `✏️ ID` añadido:
- `formulario.html` / `formulario.js`: junto al campo ID cliente, visible solo cuando hay un cliente cargado.
- `proveedores.html` / `proveedores.js`: junto al campo ID proveedor, y botón `✏️ ID venue` en la zona de venue, visible cuando hay un venue activo.
- `tablas.js`: botón `✏️` en la celda ID de las tablas Clientes, Proveedores, Venues y Servicios.

---

**Edición directa en `tablas.js` con gestión de Supabase Storage.**

Actualmente `tablas.js` es solo lectura con algunas acciones puntuales. Objetivo: poder editar directamente cualquier campo de cualquier tabla desde la UI, con un modal de advertencia cuando el cambio tiene impacto en otras tablas (ej. cambiar `venue_id` de una fila de `availability`). Adicionalmente, gestionar los buckets de Supabase Storage desde el panel (ver qué ficheros hay, cuáles están huérfanos, borrar).

---

**✅ RESUELTO — Notas de sesión para el asistente (`session_context`).**

Paula puede editar un texto libre en la barra superior de `solicitudes.html` (antes del listado) que se envía a Claude en cada llamada como segundo bloque del system prompt con caché independiente.

**Tabla `session_context` en Supabase:** append-only log (cada cambio es un INSERT). Para leer: `SELECT texto FROM session_context ORDER BY created_at DESC LIMIT 1`. RLS igual que el resto de tablas del panel.

**UI en `solicitudes.js`:** campo de una línea que expande al hacer clic (inline, no modal). Al perder foco con contenido nuevo → INSERT silencioso (sin feedback visual explícito). Variable módulo `_notasSesion` con `_cargarNotasSesion()` al inicio.

**Integración en `asistente.js`:** `getNotasSesion` como parámetro opcional de `initAsistente`. `asistente.js` construye `system` como array con dos bloques con `cache_control: ephemeral`: el primero con `SYSTEM_PROMPT_ASISTENTE`, el segundo (solo si hay notas) con las notas de Paula. El penúltimo mensaje del historial también lleva `cache_control: ephemeral` para conversaciones largas. Ver detalle en la sección `asistente.js` (§4) y en la sección Edge Function `claude-proxy`.

---

### 7.4 Auditorías pendientes (investigar primero, luego decidir)

**✅ COMPLETADO — Auditoría del ciclo de facturación/cobros/pagos (jun 2026).**

Recorrido completo realizado en prueba Fase 0d. Residuos y bloqueos confirmados:

- **Cambio de ID de cliente imposible desde el panel:** workaround SQL documentado en §7.3. Solucionable con ON UPDATE CASCADE en Fase 3.
- **Factura desfasada:** si se generó el PDF pero luego cambia el importe, la factura queda desfasada. No hay mecanismo de "anular y regenerar" ni advertencia en el panel. `persistirCobrosCliente` crea un "hito de ajuste", pero no es visible ni operable desde la UI.
- **PDFs de facturas:** se guardan en Supabase Storage (bucket `invoices`) y en `charges.invoice_path`. No hay UI para listarlos ni borrarlos. Al eliminar la reserva, los PDFs quedan huérfanos en Storage. Confirmado en prueba.
- **`payments` no se borran al eliminar una reserva:** quedan como huérfanos referenciando el proveedor. Confirmado en prueba. Ver §7.1 y §8.
- **`collected` no persiste al marcar cobro como cobrado:** bug confirmado en prueba. Ver §7.1.
- **Botón "Facturar" no aparece hasta recargar:** bug confirmado en prueba. Ver §7.1.

---

**✅ VERIFICADO — Trigger `trg_sync_availability_event_type` funciona correctamente (jun 2026).**

Verificado en prueba Fase 0a. El trigger propaga `photos`, `description` y `access_instructions` a todas las filas con el mismo `venue_id + event_type`. Los tres campos se sincronizan en la misma operación. Ver hallazgos completos en §9 Fase 0a.

Nota: existía una función huérfana `sync_photos_by_event_type()` (versión anterior que solo sincronizaba fotos). Eliminada en jun 2026 con `DROP FUNCTION public.sync_photos_by_event_type();`.

---

**✅ VERIFICADO — `service_availability` y `catalogo_publico` funcionan para usuarios anon.**

Verificado en jun 2026 con `SET ROLE anon; SELECT COUNT(*) ...`: `service_availability` devuelve 63 filas y `catalogo_publico` devuelve 54. Las vistas ya estaban correctamente configuradas (con permisos del owner o `security_invoker = false`). No requieren acción.

---

**Caché de sfcom: evaluar granularidad.**

Actualmente `_stockCache` en `sfcom.js` almacena todo lo que llega de `stock-all` al cargar la página. Después, `checkAvailabilityBeforeSave` no hace GET individuales si el item está en caché. La caché se actualiza tras cada PUT. El riesgo: si dos pestañas del panel están abiertas, o si sfcom actualiza el stock externamente, la caché de una pestaña queda desfasada.

Evaluar si merece la pena invalidar por item (borrar el item de caché tras cada PUT y hacer GET la próxima vez que se consulte ese item) en lugar de confiar en la actualización post-PUT que se hace ahora.

---

### 7.5 Mejoras de código

**Asistente usa nombre de balcón en lugar de nombre de venue/proveedor.**

En el contexto que recibe el asistente, la disponibilidad se identifica con el nombre del balcón (id técnico o `services.name`), pero Javier habla siempre en términos del venue/proveedor (`venues.display_name`). El asistente debería mostrar y usar `venues.display_name` como referencia principal al hablar de opciones disponibles. Fix: revisar cómo se construye la sección de disponibilidad en el system prompt de `asistente-config.js` y sustituir el identificador actual por `display_name`.

---

**Asistente interpreta precios como precio total en lugar de precio por persona.**

Cuando Javier le indica un precio al asistente ("ofrece tal balcón a X euros"), el asistente entiende que es el precio total del balcón. El criterio correcto es que cualquier precio mencionado es siempre **por persona**. Fix: añadir instrucción explícita en `SYSTEM_PROMPT_ASISTENTE` o en las instrucciones de contexto de `asistente-config.js`.

---

**✅ RESUELTO — Reglas de uso de identificadores de venue/evento documentadas en §3.**

Cada lugar físico tiene hasta cinco identificadores distintos (`venues.id`, `venues.display_name`, `venues.slug`, `services.name`, `sfcom_listings.sfcom_service_name`). Las reglas de qué usar en cada contexto (BD/código, UI interna, documentos al cliente, catálogo, sfcom) están formalizadas en §3.

---

**Contexto del asistente incluye líneas del borrador ya resueltas.**

Si hay líneas con `estado: 'hecha'` o `'descartada'` y Paula abre el asistente, Claude las ve en el contexto. Las líneas `'hecha'` son útiles porque confirman qué ya tiene reserva; las `'descartada'` son menos relevantes pero no causan confusión. Fix correcto: actualizar `SYSTEM_PROMPT_ASISTENTE` en `asistente-config.js` para explicar el significado de cada valor de `estado` (`'pendiente'` = negociando, `'hecha'` = ya convertida en reserva, `'descartada'` = descartada). Filtrar `'descartada'` del contexto es opcional y de bajo impacto.

---

**Lógica de inferencia `level → service_id` duplicada.**

Existe en `_inferirServiceId` (formulario.js), `_preFillBorradorSiVacio` (solicitudes.js) y `expandirServiceIds` (asistente.js), con pequeñas variaciones. Candidato natural para `utils.js`. Riesgo de divergencia si se añaden servicios nuevos.

---

**✅ RESUELTO — Doble `cargarSolicitudes()` al inicio de `formulario.html`.**

Se quitó la llamada incondicional de startup (jun 2026). El chain de `checkSfcomOrders` garantiza una sola llamada: si hay pedidos nuevos → `registrarPedidosSfcom` la llama; si no → se llama directamente en el `.else`; si falla → se llama en el `.catch`.

---

**Auto-transición `seguimiento_pendiente → respuesta_enviada` al enviar recordatorio.**

Cuando Paula pulsa "📩 Enviar recordatorio" o responde a una solicitud en `seguimiento_pendiente`, el status debería volver automáticamente a `'respuesta_enviada'` (el cliente ya tiene respuesta y el contador de 3 días vuelve a correr desde ese momento). Actualmente el status no cambia al enviar. Fix: en la función que gestiona el envío del recordatorio en `solicitudes.js`, añadir `status: 'respuesta_enviada'` al UPDATE de Supabase si el status actual es `'seguimiento_pendiente'`.

---

**`service_name` en el borrador con formato inconsistente.**

Desde `solicitudes.js` se genera como `"Encierro - día 7"`; desde `formulario.js` usa `svc.name` sin el día. El bloque de conversión funciona porque usa `service_name` y `day` por separado, pero el contexto que ve el asistente puede quedar incompleto. Fix: unificar el formato de `service_name` al construir las líneas del borrador.

---

**`formulario.js` demasiado grande (~2600 líneas).**

Tres candidatos para extracción si el tamaño se convierte en problema práctico:
- `sfcom-solicitudes.js` (~300 líneas): Bloque 0 + `registrarPedidosSfcom` + modales sfcom.
- `reorganizar.js` (~200 líneas): panel de reorganización (el más autocontenido, sin estado compartido relevante).
- `cobros.js` (~300 líneas): Bloque 5 + `persistirHitosCliente` + `cargarCobrosCliente`.

No hacer hasta que el tamaño sea un problema práctico. Si se decide, empezar por `reorganizar.js`.

---

### 7.6 Deuda de datos (no es tarea de código)

**`event_type` — ✅ RESUELTO** — Es una columna directa en `services` (pos 3, texto). Las vistas la leen de `services.event_type`. No hay nada que investigar. Se puede acceder directamente desde `availability_panel` (que ya lo expone) sin riesgo de datos obsoletos.

---

### 7.7 Deudas operativas sfcom

Productos con configuración incompleta o pendiente de aclarar con Hilario:

- **Pobre de Mí (prod 142):** ownership/mapeo pendiente de aclarar.
- **Barrera Encierro (prod 140, stock null):** no sincronizar hasta aclarar modelo de stock.
- **Visitas guiadas:** sin filas en `availability` ni mapeo en `sfcom_listings`.
- **Despedida Gigantes (prod 147, agrupado):** usar los productos hijo 215 (adulto) y 216 (niño) para PUTs de stock. Nunca usar 147 directamente.

---

### 7.8 Conocido y aceptado

**Falsos positivos en verificación sfcom por TTL de caché del servidor.** `stock-all` en `sf-api-paula.php` trabaja contra una caché con su propio TTL. Una verificación justo después de un PUT puede mostrar discrepancia aunque el PUT fue correcto. Desaparece sola; no requiere acción.

**`payments` sin campo `is_final`.** El hito final de pago al proveedor se identifica por `comments === 'Pago final'`. Inconsistencia con `charges` (que sí tiene `is_final`). Bajo riesgo mientras no se añadan hitos con ese comentario de forma manual.

**`persistirCobrosCliente` auto-crea un cobro "final" al guardar cualquier cobro del cliente.** Al añadir un hito de cobro manualmente en bloque 5, el JS llama también a `persistirCobrosCliente`, que calcula e inserta (o actualiza) el "cobro final" del cliente. Mismo patrón que `persistirPagosProveedor` con payments. Resultado: al crear el primer cobro manual, aparecen dos filas en `charges`: la manual y el cobro final automático. No se duplica (el cálculo upserta la misma fila). Comportamiento esperado, no es un bug.

**El modal de confirmación "¿eliminar también el cliente?" desaparece si navegas.** Cuando se elimina la última reserva de un cliente, el JS muestra un modal preguntando si también borrar al cliente. Si el usuario navega a otra página antes de confirmar, el modal desaparece y el cliente queda en la BD sin forma de borrarlo ni de acceder a él desde ningún flujo normal.

Solución propuesta: tratar el cierre del modal por cualquier vía (ESC, clic fuera, navegación) como "No, conservar cliente", y en ese caso redirigir automáticamente a la ficha del cliente recién huérfano para que sea accesible de inmediato. Así el "cancel" implícito no deja al cliente en un limbo inaccesible. A evaluar junto con la deuda §7.2 (añadir botón directo de borrado de cliente).

**`invoiced` en `charges` es redundante** con `invoice_number IS NOT NULL`. Se mantiene por conveniencia en filtros de consulta.

**Auto-transición `respuesta_enviada → seguimiento_pendiente` solo se evalúa al cargar `solicitudes.html`.** Si la sesión lleva días abierta, el badge en pantalla puede quedar desfasado. En la práctica no es problema porque la página se recarga con frecuencia.

**Las vistas de Supabase son siempre en tiempo real.** No hay caché a nivel de vista en PostgreSQL: cada vez que el JS hace una query sobre `availability_panel` o `catalogo_publico`, Supabase ejecuta la vista en ese momento con los datos actuales de las tablas base. No hay riesgo de ver datos obsoletos por este motivo. El único caché relevante es `_stockCache` en `sfcom.js` (cliente JS, en memoria, solo para llamadas a la API sfcom).

**`persistirPagosProveedor` crea un hito a 0 € para proveedores con availability pero sin reservas.** Si un proveedor tiene filas en `availability` con `total_slots = 0` o sin reservas activas, `persistirPagosProveedor` (llamada desde `proveedores.js` al guardar) inserta un pago de 0 € con `comments = 'Pago final'`. No es un dato incorrecto (refleja que el pago final calculado es 0), pero poluciona `payments` con filas vacías. La UNIQUE constraint evita duplicados. Revisable si se quiere filtrar el INSERT cuando `amount = 0` y no hay reservas previas.

---

### 7.9 Auditoría de código — jun 2026

Auditoría exhaustiva línea a línea del panel completo realizada en jun 2026. Se leyeron los 16 archivos JS del admin (`utils.js`, `supabase.js`, `auth.js`, `modal.js`, `verificacion.js`, `panel.js`, `solicitudes.js`, `formulario.js`, `propuesta.js`, `factura.js`, `asistente.js`, `asistente-config.js`, `proveedores.js`, `sfcom.js`, `sfcom-panel.js`, `tablas.js`) más los HTML de cada panel. Los hallazgos ya documentados en §7.1–7.8 se excluyen aquí.

---

#### Crítico — pueden corromper datos o bloquear completamente

**`verificarConsistenciaFinanciera` puede borrar cobros con historial contable sin doble confirmación (`panel.js`).**
El botón "Corregir automáticamente" ejecuta `DELETE FROM charges WHERE client_id = X` para todos los clientes detectados como huérfanos. Si un cliente canceló reservas pero ya había pagado un adelanto (cobro con `collected=true` o `invoice_number`), ese cobro se borra. El modal muestra el aviso `tieneHistorial`, pero no excluye a esos clientes del corrector — solo advierte antes de ejecutar. Fix: excluir del corrector automático a cualquier huérfano con `tieneHistorial=true` y requerir acción manual.

**✅ RESUELTO — Race condition en numeración de facturas (`factura.js:96-112`, `propuesta.js:81-97`).**
`calcularSiguienteNumero` lee `MAX(invoice_number)` y devuelve `+1`. Aplicado en jun 2026: `ALTER TABLE charges ADD CONSTRAINT uq_charges_invoice_number UNIQUE (invoice_number)`. En PostgreSQL, NULLs no colisionan con el constraint. Si dos sesiones intentan emitir la misma factura simultáneamente, el segundo UPDATE falla con error visible para Paula. `reservations.proposal_number` no admite UNIQUE (varias reservas comparten el mismo número de propuesta). Adicionalmente, `propuesta.js` cambiado de `console.error` a `alert` para que el error sea visible.

**✅ RESUELTO — `solicitudOriginRef` ya se resetea en `limpiarFormularioReserva()` (`formulario.js:193`).**
El fix estaba aplicado: `solicitudOriginRef = null` en línea 193. El comentario en línea 2184 documenta el flujo deliberado donde se restaura tras `cargarCliente`.

**✅ RESUELTO — `sfcom-panel.js` usaba `d.stockReal` pero el objeto de discrepancia tiene `d.stockSfcom` (`sfcom-panel.js:282`).**
La columna "Stock real" en la tabla de discrepancias del panel sfcom siempre mostraba `undefined`. Corregido en jun 2026: `d.stockReal` → `d.stockSfcom`.

**`_insertarMensaje` no protege contra escrituras concurrentes al log de conversación (`solicitudes.js:132-151`).**
Lee `conversation_notes`, parsea, añade mensaje, persiste. Si dos eventos se disparan casi simultáneamente (asistente cierra modal mientras Paula guarda una edición), el segundo UPDATE sobreescribe el primero sin control de versión. Fix: usar optimistic locking o encolar los writes.

---

#### Alto — comportamiento incorrecto en casuísticas reales

**`actualizarProveedores`: el venue activo desaparece del select silenciosamente al cambiar las plazas (`formulario.js:344-399`).**
Al filtrar proveedores por capacidad, si el venue previamente seleccionado no tiene plazas suficientes para el nuevo número de plazas, se excluye del select sin aviso. `selectProveedor.value = proveedorActual` falla porque la opción ya no existe y el select queda en blanco. Paula puede guardar la reserva sin venue seleccionado.

**`_inferirDesdeSfcom`: matching por día no funciona para servicios no-ENCIERRO con múltiples filas (`formulario.js:1834-1838`).**
Si hay varios candidatos con el mismo `sfcom_service_name` que no son ENCIERRO (ej. dos configuraciones de CHUPINAZO), busca `'ENCIERRO_' + day` → no encuentra nada → devuelve `filas[0]` arbitrariamente. Impacto: asignación de servicio incorrecta en solicitudes sfcom.

**`confirmarReorganizacion`: la reversión puede fallar silenciosamente y Paula recibe un mensaje falso (`formulario.js:1740-1758`).**
Si un UPDATE falla a media operación, intenta revertir con `Promise.allSettled`. Si alguna reversión también falla, solo queda un `console.log` interno. Paula recibe "Los cambios anteriores han sido revertidos" sin que sea cierto. Fix: si la reversión falla, mostrar modal de error grave con los cambios concretos para corrección manual.

**`cambiarEstadoSeleccionadas`: reactivar una reserva cancelada no verifica capacidad propia (`formulario.js:651-672`).**
Al reactivar Cancelada → Confirmada/Pendiente, solo se verifica sfcom, no si el hueco que había al cancelar sigue libre. Entre la cancelación y la reactivación pueden haberse creado otras reservas que ocupen ese espacio. Impacto: sobrereserva posible.

**`cargarReservasCliente` no sincroniza el array global `todasReservas` (`formulario.js:489-514`).**
Filtra reservas solo del cliente activo y guarda en `reservasCliente`. `todasReservas` (usado para cálculos de disponibilidad en el resto del panel) queda con datos de la carga inicial. Si otra sesión añadió reservas mientras tanto, los cálculos de disponibilidad están desfasados.

**`cobroFinal` puede resultar negativo sin aviso para Paula (`formulario.js:1179, 1199`).**
`cobroFinal = total - prepagos`. Si un cliente sobrepagó o se cancelaron reservas tras cobrar el adelanto, `cobroFinal < 0`. Se persiste silenciosamente y aparece como importe negativo en la tabla de cobros.

**`reorgCambiarServicio`: cambia el venue silenciosamente al primero disponible si el actual no ofrece el nuevo servicio (`formulario.js:1530-1554`).**
En el panel de reorganización, al cambiar el servicio de una reserva, si el venue actual no ofrece ese servicio, la reserva se mueve al primer venue disponible del nuevo servicio sin pedir confirmación. Paula puede no darse cuenta.

**`marcarAtendida` marca la solicitud como `convertida` sin verificar que se haya creado una reserva real (`formulario.js:2324-2332`).**
El botón "✅ Procesado" en la tabla sfcom del bloque 0 actúa directamente. Si Paula lo pulsa por error, la solicitud desaparece de todas las listas activas. No hay modal de confirmación.

**`_alUsarBoton` en el asistente marca el mensaje como enviado aunque Paula cierre el correo sin enviar (`asistente.js:346-354`).**
Al pulsar "Enviar por correo", se abre `mailto:` y simultáneamente se registra en el log como `<Paula>` y la solicitud pasa a `respuesta_enviada`. Si Paula cierra Outlook sin enviar, el log queda con un mensaje "enviado" que el cliente nunca recibió. No hay forma de revertirlo sin editar el log manualmente.

**Falta `asunto` en el `mailto:` generado por el asistente (`asistente.js:327`, `utils.js:374`).**
La llamada a `mostrarOpcionesEnvio` desde `asistente.js` no pasa el parámetro `asunto`. El enlace `mailto:` se abre sin subject. El cliente recibe un correo sin asunto.

**`btnEliminarServicio`: DELETE de proveedor sin manejar error de FK (`proveedores.js:1545-1623`).**
Al eliminar todos los servicios de un proveedor, aparece `confirm("¿Eliminar también el proveedor?")` que ejecuta DELETE en `providers`. Si el proveedor tiene otros venues con reservas activas, el DELETE fallará por FK, pero el código no maneja explícitamente ese error. La UI queda en estado inconsistente.

**`cargarServiciosProveedor`: muestra todos los venues del proveedor mezclados, no solo el tab activo (`proveedores.js:1341`).**
Cuando un proveedor tiene varios venues (AMAYA_SABATE, PATRICIA), la tabla de servicios filtra por `provider_id` y muestra todos los venues juntos, confundiendo la jerarquía proveedor → venue → servicio.

**`btnConfirmarSfcom` con resultado `'save'` deja sfcom con stock incorrecto sin recordatorio (`proveedores.js:234-265`).**
La opción "Solo guardar" confirma el `sfcom_status` en BD pero no sincroniza el stock a WooCommerce. No hay indicador posterior de que sfcom está desincronizado ni recordatorio de que hay que sincronizar.

**`btnGuardarServicio` en modo edición múltiple ignora cambios en `services.name/description/comments` (`proveedores.js:1155-1192`).**
En modo edición múltiple, solo actualiza campos de `availability`. Los inputs de nombre y descripción del servicio están visibles y editables pero sus cambios se descartan al guardar, sin aviso.

**Asistente múltiple no valida `service_id` duplicado entre filas antes de insertar (`proveedores.js:2216-2293`).**
Si dos filas del bulk insert tienen el mismo `serviceId`, colisionan con UNIQUE(venue_id, service_id) en `availability`. El código muestra `alert` con el error de BD pero no previene la colisión.

**`syncStockToSfcom` enmascara sobrereservas poniendo 0 sin alertar (`sfcom.js:143-146`).**
`Math.max(0, Math.min(...))` eleva el stock negativo a 0. El PUT a sfcom es correcto (no se ofrecen plazas de más), pero Paula no recibe ningún aviso de que hay una sobrereserva. El problema queda enmascarado.

**`verificarBajaSfcom` confunde "stock 0 porque todo está vendido" con "Hilario retiró el producto" (`sfcom.js:1141-1152`).**
`gone = stock === 0 || stock === null`. Un producto vendido al 100% tiene stock 0 sin que Hilario lo haya retirado. Esto puede mostrar el botón "Confirmar baja" para un producto activo en sfcom.

**`apiFetchStockAll` devuelve `{}` silenciosamente si la respuesta de la API es inesperada (`sfcom.js:92-95`).**
`return result?.stock ?? {}`. Si la API responde con un JSON malformado o un error con status 200, devuelve objeto vacío. El consumidor ve todos los availability como `fallos` pero el error real (API rota) no se muestra.

**`importarCanceladosSfcom`: la dedup puede ocultar una segunda cancelación del mismo cliente (`sfcom.js:1354-1372`).**
La dedup usa email+phone+nombre. Si el mismo email cancela dos productos distintos (ej. ENCIERRO_7 y CHUPINAZO_6) simultáneamente, el segundo lead se descarta por considerarse duplicado del primero. Fix: incluir `origin_ref` del pedido en la dedup.

**El parseo de `---BORRADOR---` falla silenciosamente con JSON inválido generado por Claude (`asistente.js:299-313`).**
Si Claude devuelve JSON malformado en el bloque `---BORRADOR---`, `borradorDraft = null` sin warning visible para Paula. El mensaje al cliente sí se muestra, pero el borrador queda sin actualizar en Supabase.

**Tres paneles distintos enriquecen `availability_panel` con datos sfcom de formas diferentes (`proveedores.js:16-33`, `formulario.js:20-32`, `sfcom-panel.js:37`).**
`proveedores.js` y `formulario.js` hacen dos queries separadas y mezclan sfcom en memoria manualmente. `sfcom-panel.js` usa la vista `availability_with_sfcom` directamente. Un cambio de esquema rompe los dos primeros sin afectar al tercero. Fix: usar `availability_with_sfcom` consistentemente en todos los paneles que necesiten campos sfcom.

**`verificarCoherencia`: el check de nombres de variación (`idsMismatch`) es código muerto con UI engañosa (`sfcom.js:689, 721`).**
El parámetro `checkVariationNames` se acepta pero `varNombreMap` siempre queda vacío porque sf-api-paula.php no expone ese endpoint. `idsMismatch[]` nunca se rellena. El código sigue corriendo la comprobación y preparando modales para un caso que nunca puede ocurrir. Fix: eliminar la lógica `idsMismatch` o documentarla explícitamente como no implementada.

**El sort de "Cobrado/Pagado" en `tablas.js` ordena por emoji — resultado confuso (`tablas.js:253-256`).**
`valorCelda` para esa columna devuelve strings como "✅ 2026-07-06", "❌ Vencido", "⏳ No". `localeCompare` los ordena alfabéticamente por el emoji inicial, no agrupando cobrados vs pendientes de forma útil. Fix: usar el raw value booleano para el sort y formatear solo en display.

**`persistirCobrosCliente` lanza `alert()` síncrono bloqueante en flujo destructivo (`utils.js:188`).**
Cuando el hito final ya está facturado y hay un cambio, dispara `alert()` bloqueante. Esta función se llama desde múltiples contextos sin que el caller pueda reaccionar al resultado. Fix: sustituir por modal informativo y devolver un resultado al caller.

---

#### Medio — edge cases que ocurrirán con el tiempo

**`_preFillBorradorSiVacio` no usa `await` en el update a Supabase (`solicitudes.js:861-864`).**
`supabase.from('reservation_requests').update(...).eq('id', sol.id)` sin `await`. Si el update falla, la memoria y la BD divergen silenciosamente.

**`_renderBorrador` re-renderiza el DOM entero en cada cambio, perdiendo el foco del input (`solicitudes.js:615-617`, `658`, `688`).**
Cada cambio en una fila llama a `rebind()` que recrea todo el DOM. Con inputs numéricos, Paula puede perder el foco al escribir rápido. Fix: aplicar cambios in-place para inputs numéricos sin re-renderizar.

**`session_context` crece indefinidamente — cada edición inserta una fila nueva (`solicitudes.js:1169-1178`).**
No hay DELETE de versiones antiguas ni UPSERT. Solo se lee `ORDER BY created_at DESC LIMIT 1` pero la tabla acumula sin límite. Fix: UPSERT en una fila única o borrado periódico de versiones antiguas.

**El parseo del log de conversación es frágil ante contenido inesperado (`solicitudes.js:62-95`).**
`_parsearLog` distingue líneas por regex `^---DD/MM/AA---$` y `^<Paula>` / `^<Cliente>`. Si un cliente escribe textualmente `<Paula>` en un mensaje, el parser lo trata como marcador de autor y asigna los mensajes siguientes al autor incorrecto.

**Paula no puede editar mensajes del día anterior (`solicitudes.js:123, 154-207`).**
`_initEditListeners` activa el botón de edición solo si el mensaje es del día actual (`isToday`). Un typo del día anterior no tiene solución desde la UI.

**`_onBorradorActualizado` falla silenciosamente si la solicitud no está en los arrays en memoria (`solicitudes.js:264-287`).**
Si la solicitud se movió entre estados durante la sesión, `sol` es `undefined`. El borrador se guarda en BD pero no se actualiza en memoria → la tabla del borrador visible queda desactualizada.

**Race condition por `setTimeout(50ms/100ms/150ms)` para sincronizar selects (`formulario.js:601-606`, `2044-2059`).**
Se usan delays hardcodeados para esperar a que un `dispatchEvent` popule las opciones del siguiente select. En dispositivos lentos, el timeout puede agotarse antes de que el listener async haya corrido. Fix: hacer `actualizarProveedores` retornar una Promise y encadenar con `await`.

**`togglePagoProvCobrado` usa `prompt()` nativo para la fecha de pago (`proveedores.js:1762`).**
`prompt()` es bloqueante, no permite validación de formato de fecha, y es inconsistente con el resto del panel que usa modales propios.

**`_savePhotos` sobreescribe el array entero — race condition si dos tabs editan (`proveedores.js:144-156`).**
Add/remove de foto siempre escribe el array completo en BD. Si Paula tiene el panel en dos tabs y ambas editan fotos del mismo servicio, gana el último en guardar.

**El input de ID en el asistente múltiple no preserva la posición del cursor al normalizar (`proveedores.js:2170-2188`).**
`input.value = normalizarId(input.value)` en el evento `input` reemplaza el valor completo y salta el cursor al final. Typing extraño si Paula escribe en el medio del texto.

**`multipleRows[i]._db_*` no se resetean tras guardar, marcando filas como `modified` siempre (`proveedores.js:2142-2156`).**
Los valores de referencia `_db_slots`, `_db_precio`, `_db_modelo` no se actualizan tras guardar. Si Paula reabre el dialog sin recargar, todos los rows aparecen como modificados aunque no hayan cambiado.

**`sfcom-panel.js` no importa pedidos nuevos ni cancelados al cargarse.**
Solo `panel.js` y `solicitudes.js` llaman a `checkSfcomOrders` e `importarCanceladosSfcom`. Si Paula abre directamente `sfcom.html` sin pasar antes por otro panel, no se importa nada.

**`crearModal` con id reutilizable elimina modales en proceso async sin aviso (`modal.js:7-8`).**
Si Paula pulsa "Verificar datos" dos veces seguidas mientras la primera verificación sigue cargando, el primer modal se elimina del DOM. El resultado de la primera verificación se pierde sin aviso.

**`checkSfcomOrders` se llama sin caché al cargar `panel.js` Y `solicitudes.js`.**
Cada navegación entre panel.html y solicitudes.html dispara un GET al endpoint externo sin caché ni throttle. Ver también §7.4 (caché de sfcom).

**`abrirAsistenteRespuesta` no tiene timeout — el spinner puede quedar activo indefinidamente (`asistente.js:283-285`).**
Si Claude tarda mucho o la Edge Function no responde, el spinner de "Pensando..." queda activo sin que Paula pueda cancelar. No hay `AbortController`.

**`abrirProcesarEmail`: regex greedy para extraer JSON puede atrapar texto ajeno (`asistente.js:541-542`).**
`rawText.match(/\{[\s\S]*\}/)` es greedy. Si Claude incluye un ejemplo de código con `{` antes del JSON real, todo se interpreta como JSON y el parse falla.

**Signed URLs de Supabase Storage (TTL 60s) expiran si Paula tarda en clicar (`formulario.js:1391-1419`).**
Las URLs firmadas para descargar facturas y propuestas duran 60 segundos. Si Paula genera la URL y se distrae, el intento de descarga recibirá un 403. No hay refresh automático.

**`bloque3` permite clicar en un venue con sobrereserva (`disp-error`), abriendo el panel de reorganización de forma confusa (`formulario.js:1048-1057`).**
La sobrereserva se marca en rojo pero el click sigue activo. El panel de reorganización que se abre no explica claramente la causa.

**`_emitir` (factura) actualiza `clients` en memoria antes de confirmar que el UPDATE a Supabase fue exitoso (`factura.js:341-354`).**
`Object.assign(_cliente, updates)` ocurre antes del error check. Si el UPDATE falla, el cliente en memoria queda con datos no persistidos y la siguiente acción del panel los usa como si fueran reales.

**`tipoFactura` puede calcular `'unico'` incorrectamente cuando hay hitos de ajuste (`factura.js:39-46`).**
Si todos los adelantos fueron eliminados sin haberlos facturado, `facturadosPrev.length === 0` → tipo `'unico'`. El PDF sale sin sección de liquidación aunque el importe real no cuadre con lo cobrado.

**El logo de propuesta puede no estar cargado al generar el PDF (`propuesta.js:616-634`).**
Si Paula abre el panel de propuesta y pulsa el botón inmediatamente, `_logoBlackBase64` puede no haber cargado. El PDF se genera sin logo (`try/catch` silencioso).

**`Math.abs(parseFloat(amount) - cobroFinal) >= 0.01` puede dar falso positivo por precisión float (`utils.js:176`).**
Con valores como `123.456789`, el parseFloat puede introducir error de redondeo que active el hito de ajuste innecesariamente. Fix: redondear a 2 decimales antes de comparar.

**`parseInt(value) || null` convierte explícitamente `0` en `null` en varios sitios (`solicitudes.js:622-630`).**
`parseInt(0) = 0` es falsy → se guarda `null`. Si Paula introduce 0 plazas intencionadamente, se interpreta como "sin valor".

---

#### Bajo — pulido y consistencia

**HTML de `_renderItem` no escapa `client_name`, `level`, `service_id` (`solicitudes.js:349-383`).**
Son campos de entrada externa (formulario web, sfcom). Si contuvieran `<`, `&` o comillas, el HTML quedaría roto o con XSS potencial.

**`aplicarFiltro` en `tablas.js` inyecta el nombre de columna sin escape en `onclick=` inline (`tablas.js:298`).**
Los nombres de columna actuales son seguros, pero si en el futuro se añade una columna con comilla simple en el nombre, el HTML se corrompe.

**El nombre del archivo de export en `tablas.js` usa extensión `.csv` aunque se genera `.xlsx` (`tablas.js:356-357`).**
`exportTable(..., '${tablaActual}.csv')` y `utils.exportTable` reemplaza la extensión por `.xlsx`. Discrepancia que confunde al leer el código.

**`document.execCommand('copy')` está deprecado en navegadores modernos (`sfcom.js:493`, `1127`, `1206`, `1274`).**
Fix: sustituir por `navigator.clipboard.writeText()` con fallback.

**El logo de propuesta y las imágenes de vista previa se re-fetchean en cada apertura del panel, sin caché (`propuesta.js:230-241`).**
Para propuestas con 5+ servicios con imagen, hay 5+ fetches en paralelo en cada apertura.

**Los errores de Supabase solo van a `console.error` — Paula no sabe que ocurrieron sin abrir DevTools.**
No hay reporting central ni toast de error genérico para operaciones secundarias.

**Textos "San Fermín 2026" y "6-14 de julio" hardcodeados en `propuesta.js` (líneas 12, 22) y `factura.js` (línea 21).**
Para 2027, hay que buscarlos y actualizarlos manualmente en varios archivos. No hay constante de temporada centralizada.

**`window.*` global handlers (sortReservasCliente, facturarHito, etc.) pueden colisionar entre módulos en un refactor futuro.**
El patrón `onclick=` inline con funciones en `window` es propenso a colisiones silenciosas si dos módulos definen el mismo nombre.

---

## 8. Trampas técnicas conocidas

**PowerShell 5.1 corrompe archivos JS.** `Get-Content | Set-Content` lee UTF-8 como Windows-1252 y corrompe caracteres multibyte (emojis, tildes, em-dashes). Fix si ocurre: `git restore <archivo>` y rehacer el cambio con la herramienta Edit de Claude Code.

**ES6 modules — redeclaración = SyntaxError silencioso.** Si un `import` trae `foo` y en el mismo archivo hay `const foo` o `function foo`, el módulo no carga y falla en silencio (sin error visible en la UI). Fix: borrar la declaración local en el mismo Edit que añade el nombre al import, nunca en pasos separados.

**`panel.querySelector()` siempre, nunca `document.getElementById()` tras `crearModal`.** El dialog podría no ser único en el DOM si hay un residuo anterior. `panel.querySelector('#mi-btn')` es siempre seguro.

**PDF server-side — WeasyPrint incompatible con el CSS del proyecto.** Si en el futuro se necesita generación server-side de PDFs, usar Puppeteer + pypdf. WeasyPrint no interpreta correctamente el CSS del proyecto.

**Logo en PDFs:** usar el canal R de la imagen como máscara alfa.

**`invoiced` en charges es redundante** con `invoice_number IS NOT NULL`, pero se mantiene por conveniencia en filtros de consulta.

**`payments`: el hito final se identifica por `comments === 'Pago final'`**, no por un campo `is_final` (que sí existe en charges). Esta inconsistencia es conocida.

**`persistirPagosProveedor` se ejecuta al guardar availability en `proveedores.js`, no solo al procesar reservas.**

Cuando se guarda cualquier cambio de availability desde `proveedores.js` (fotos, descripción, instrucciones, slots), el código llama a `persistirPagosProveedor(supabase, providerId, ...)`. Esta función recalcula el hito "Pago final" del proveedor y lo persiste en `payments`. Si el proveedor no tiene reservas activas —o el importe calculado es 0 (p.ej. `total_slots = 0, price_per_slot = 0` con `billing_model = 'capacity'`)— se inserta igualmente una fila con `amount = 0`.

Consecuencias que hay que tener en cuenta al trabajar sobre este sistema:

- **Todo proveedor con al menos una fila en `availability` tendrá al menos una fila en `payments`**, aunque nunca haya tenido una reserva.
- **✅ Desde Fase 3 (jun 2026): `payments.provider_id → providers` tiene `ON DELETE CASCADE`.** El DELETE de `providers` elimina automáticamente todos sus payments. Sin embargo, `venues.provider_id → providers` sigue siendo `NO ACTION` en DELETE. Orden correcto actual: `DELETE FROM venues WHERE provider_id = '...'` (en cascada elimina `availability` y `sfcom_listings`) → `DELETE FROM providers WHERE id = '...'` (en cascada elimina `payments`). Ya no es necesario `DELETE FROM payments` explícito.
- Este comportamiento aplica también a cualquier operación de limpieza o migración en Supabase que implique borrar proveedores.
- La UNIQUE constraint `(provider_id, amount, due_date)` impide que el hito a 0 € se multiplique con cada guardado.

Verificado empíricamente en jun 2026 durante la prueba de Fase 0a (ver §9).

---

## 9. Plan de fases para ejecutar la deuda técnica

Acordado en jun 2026. El criterio de agrupación: mismo área de código, misma sesión de trabajo, sin abrir el mismo archivo dos veces entre fases.

### Estado de cada fase (jun 2026)

| Fase | Estado | Descripción |
|---|---|---|
| -1 | ✅ Completa | Auditoría completa de Supabase |
| 0 | ✅ Completa | Auditorías sin código (deudas operativas sfcom son independientes, ver §0) |
| 1 | ✅ Completa | Bugs simples (4 cambios quirúrgicos) |
| 1b | ✅ Completa | Bugs rápidos sin dependencias (margen + cobros bloque 5) |
| 2 | ✅ Completa | Comunicaciones semi-automáticas (bienvenida) |
| 3 | ✅ Completa | Esquema BD: cascada de borrados y renombrado de IDs |
| 4 | ✅ Completa | Sistema de borrador y asistente (jun 2026) |
| 5 | ✅ Completa | Flujo sfcom: leads cancelados + recuperación ✅ · reducción de modales ✅ |
| 6 | ✅ Completa | Panel: tablas navegables ✅ · image_url editable ✅ · pestañas par/servicio ✅ · fotos 16:9 ✅ · reordenar fotos ✅ · auto-fill image_url ✅ |
| 6b | ✅ Completa | Asistente: fix mensajes editados + auto-save logs toggle |
| 6c | ✅ Completa | Bugs §7.9: marcarAtendida ✅ · verificarConsistencia ✅ · reactivar capacidad ✅ · reversión falsa ✅ |
| 7 | ✅ Completa | Mejoras de propuestas: display_name ✅ · fallback descripción ✅ · fotos 16:9 ✅ · modos Compacto/Completo ✅ |
| 8 | ✅ Completa | Facturación canal sfcom |
| 9 | 🔲 Pendiente | Refactors y cierre |

### Dependencias duras entre fases

```
0 → 3 ✅ (la auditoría FK definió qué migrar — ambas completadas)
0a → 6 ✅ (trigger verificado — desbloqueada)
3 → 6, 7, 9 ✅ (borrados correctos ya en BD — desbloqueadas)
4 → 7 (borrador limpio antes de mejoras en propuestas)
6 → 7 (image_url auto-fill antes de usarlo en propuestas)
todas → 9 (refactors de archivos grandes van últimos)
```

Las fases 1b y 2 son independientes de todo lo demás y pueden hacerse en cualquier orden entre ellas.

---

### Fase -1 — ✅ Auditoría completa de Supabase (jun 2026)

**SQL ejecutados:** 8 queries (A1: columnas, A2: generadas/índices, B1: triggers, B2: funciones, B3: vistas, C1: RLS y políticas, C2: storage, D1: FKs, D2: consistencia de datos).

**Hallazgos y acciones:**

| # | Hallazgo | Acción | Estado |
|---|---|---|---|
| 1 | Bug de seguridad: `venues` RLS usaba `{public}` (acceso escritura a anon) | DROP + recrear políticas | ✅ Aplicado |
| 2 | `service_availability` y `catalogo_publico` podrían no funcionar para anon | Verificar con `SET ROLE anon` | ✅ Verificado: funcionan (63, 54 filas) |
| 3 | `availability` sin UNIQUE(venue_id, service_id) | Verificar duplicados + `ADD CONSTRAINT` | ✅ Aplicado |
| 4 | `availability.venue_id` nullable | `ALTER COLUMN venue_id SET NOT NULL` | ✅ Aplicado |
| 5 | `sync_photos_by_event_type` función huérfana | `DROP FUNCTION` | ✅ Aplicado |
| 6 | 6 reservas activas con total_amount = 0 | Investigar | ✅ Investigado: son invitaciones/0€ intencionados |
| 7 | Email duplicado (giovanni.soliman@gmail.com) | Fusionar o eliminar | ✅ Eliminado (no tenía reservas) |
| 8 | MARTIKO y NACHO_GALLARDO: cobros sin reservas activas | Investigar | ✅ Investigado: cobros a 0€ intencionados |
| 9 | `assistant_logs` sin RLS | Evaluar | 🔲 Conocido, baja prioridad |
| 10 | 55 servicios en `services` (solo 12-14 activos documentados) | Revisar en Dashboard | 🔲 Pendiente revisión visual |

**`event_type` confirmado:** es columna directa en `services` (posición 3). Las vistas simplemente la leen desde ahí. Cierra la deuda 7.6 que lo describía como pendiente de verificar.

---

### Fase 0 — 🔲 Parcial: Auditorías sin código

**0a — Verificar trigger `trg_sync_availability_event_type`:** ✅ Verificado en jun 2026. Se creó un venue de prueba (TEST_TRIGGER_VENUE) con 3 filas de availability para ENCIERRO_7, ENCIERRO_8 y ENCIERRO_9 (`total_slots = 0`). Al editar `photos`, `description` y `access_instructions` en la fila de ENCIERRO_7 desde `proveedores.js`, los tres campos se propagaron correctamente a ENCIERRO_8 y ENCIERRO_9. El trigger funciona end-to-end tal como estaba auditado.

Hallazgo colateral de la prueba: `proveedores.js` llama a `persistirPagosProveedor` al guardar cualquier cambio en availability. Esa función creó un hito de pago a 0 € para TEST_TRIGGER_PROV aunque no hubiera reservas (billing_model = capacity, total_slots = 0 → pago_final = 0). La FK `payments.provider_id` bloqueó el DELETE del proveedor hasta borrar ese pago explícitamente. Ver §8 y §7.8.

**0b — Verificar origen de `event_type`:** ✅ Cerrada en Fase -1. Es columna directa en `services`.

**0c — Auditoría de FK cascada:** ✅ Hecha en Fase -1 (D1). La única FK con CASCADE es `sfcom_listings.availability_id → availability`. Todas las demás son NO ACTION. Resultado: la Fase 2 incluirá añadir CASCADE en FKs seleccionadas.

**0d — Auditoría del ciclo de facturación:** ✅ Completado en jun 2026. Recorrido completo documentado. Hallazgos principales:

- Al añadir un cargo manualmente desde bloque 5, `formulario.js` llama también a `persistirCobrosCliente`, que crea un segundo hito "cobro final" automático (mismo patrón que `persistirPagosProveedor` con payments). Ver §7.8.
- **Bug confirmado:** marcar cobro como cobrado no persiste en Supabase (ver §7.1).
- **Bug confirmado:** el botón "Facturar" no aparece hasta recargar la página tras añadir un cobro (ver §7.1).
- Facturación: crea el PDF correctamente, lo descarga y guarda `invoice_number` + `invoice_path` en la fila de `charges`. El campo `invoiced` se pone a `true`.
- Marcar pago a proveedor como pagado: funciona correctamente y persiste.
- Eliminar reserva vía "Gestión de reservas → seleccionar → Eliminar": el JS muestra aviso si hay cobros facturados y pide confirmación. Al confirmar, elimina la reserva, todos sus cobros, y llama a `persistirPagosProveedor` para recalcular el pago final del proveedor. ✅ Los `payments` se gestionan correctamente (ver §7.1).
- El modal de "¿eliminar también el cliente?" es transient: si el usuario navega antes de confirmar, el modal desaparece y el cliente queda en la BD sin forma de borrarlo desde el panel. Ver §7.8.
- **Invoice PDF y proposal PDF en Storage no se limpian.** Al eliminar reservas y cobros, los ficheros PDF permanecen en los buckets `invoices` y `proposals`. Diferido a Fase 9. Ver §7.1.

**Deudas operativas sfcom:** Contactar a Hilario sobre Pobre de Mí, Barrera Encierro, Visitas guiadas, Despedida Gigantes. Independiente de todas las fases.

---

### Fase 1 — ✅ Bugs simples (jun 2026)

1. **`panel.js` alertas** — `calcularAlertas()`: `solicitudesSfcom` filtra `status === 'nueva'`; web dividida en nuevas y `seguimiento_pendiente` con etiquetas separadas. ✅
2. **`formulario.js` bloque 0** — `otrasActivas` usa `status === 'nueva'`. ✅
3. **`utils.js` `resolverCliente`** — Umbral mínimo 5 chars para `.includes()`. Fix parcial (ver deuda pendiente en 7.1). ✅
4. **`formulario.js` doble `cargarSolicitudes`** — Eliminada llamada incondicional; el chain de `checkSfcomOrders` garantiza una sola llamada. ✅

---

### Fase 1b — ✅ Bugs rápidos sin dependencias (jun 2026)

Tres fixes en `panel.js` y `formulario.js` bloque 5. Independientes entre sí y de cualquier otra fase.

1. ✅ **Cálculo de margen en `panel.js`** — tablas con filtro condicional (no-balcón solo si tienen reservas o billing capacity); sección potencial de `calcularResumen` acotada a `TIPOS_BALCON`.
2. ✅ **Bug cobro no guardado** — root cause: `persistirHitosCliente` saltaba completamente los cobros con `invoice_number` (incluido el UPDATE de `collected`). Fix: para facturados no cobrados, se hace UPDATE parcial de `collected`/`collected_date`. También se añade `.select('id')` para detectar fallos silenciosos de RLS.
3. ✅ **Botón "Facturar" no aparece** — se añade `renderCobrosCliente()` tras el INSERT en `btnGuardarNuevoCobro`, cuando ya se tiene el `h.id` asignado. (La deuda 7.1 describe esto como "Facturar button no aparece hasta recargar".)
4. ✅ **Cobros facturados no editables** — resuelto como consecuencia directa del fix 2: `persistirHitosCliente` ya actualiza cobros facturados no cobrados en lugar de ignorarlos.

---

### Fase 2 — ✅ Comunicaciones semi-automáticas: bienvenida (jun 2026)

Implementado en puro JS desde `formulario.js`, sin asistente. El diseño final difirió del plan original (que preveía usar el asistente en modo `'confirmacion'`): se optó por generación directa en JS porque el mensaje de bienvenida es estructurado y no requiere inteligencia conversacional.

0. ✅ **UI de envío unificada:** `mostrarOpcionesEnvio()` en `utils.js`. Ver detalle en §4.
1. ✅ **Botón "📩 Enviar bienvenida"** en la fila de acciones del bloque 4 de `formulario.html`, junto a "Generar propuesta". Solo visible si el cliente tiene reservas activas.
2. ✅ **`componerMensajeBienvenida()`** — genera el texto con intro adaptada a los días que quedan para el 6 de julio, bloques por reserva (evento, día, hora, venue, plazas, instrucciones de acceso), y cierre firmado por Paula.
3. ✅ **`abrirModalBienvenida()`** — modal con `<textarea>` editable + `mostrarOpcionesEnvio` (`tipo:'texto'`). Al enviar escribe `welcome_sent_at` en las reservas incluidas.
4. ✅ **`welcome_sent_at`** en `reservations` — campo timestamptz, null hasta el primer envío. El botón muestra "✅ Enviado el DD/MM" cuando todas las confirmadas lo tienen.
5. ✅ **Manejo de pendientes** — las reservas Pendientes **no marcadas** con el checkbox de la tabla (antes de abrir el modal) van al parámetro `pendientesNoMarcadas` y aparecen en un banner de advertencia dentro del modal. Un checkbox en el banner permite añadir una nota sobre ellas al final del texto, sin escribir `welcome_sent_at` en esas reservas.

---

### Fase 3 — ✅ Esquema BD: cascada de borrados y renombrado de IDs (jun 2026)

Migración ejecutada en Supabase SQL Editor en una transacción. 10 FKs redefinidas con DROP + ADD CONSTRAINT. Verificada con consulta de FKs completa: todas las reglas correctas en todas las tablas.

**ON UPDATE CASCADE — todas las FKs de IDs de texto (renombrado en cascada):**
- `reservations.client_id → clients` (ON UPDATE CASCADE, ON DELETE NO ACTION)
- `charges.client_id → clients` (ON UPDATE CASCADE, ON DELETE NO ACTION)
- `venues.provider_id → providers` (ON UPDATE CASCADE, ON DELETE NO ACTION)
- `payments.provider_id → providers` (ON UPDATE CASCADE + **ON DELETE CASCADE**)
- `reservations.venue_id → venues` (ON UPDATE CASCADE, ON DELETE NO ACTION)
- `availability.venue_id → venues` (ON UPDATE CASCADE + **ON DELETE CASCADE**)
- `reservations.service_id → services` (ON UPDATE CASCADE, ON DELETE NO ACTION)
- `availability.service_id → services` (ON UPDATE CASCADE, ON DELETE NO ACTION)

**ON DELETE SET NULL:**
- `reservation_requests.assigned_venue_id → venues` (ON DELETE SET NULL) — al borrar un venue, las solicitudes con ese venue asignado pierden la asignación en lugar de bloquearse.

**Efectos en operaciones de borrado:**
- Borrar un venue → elimina en cascada su `availability` y (desde availability) sus `sfcom_listings`.
- Borrar un proveedor → elimina en cascada sus `payments`. Los venues siguen siendo NO ACTION: hay que borrarlos primero. Orden: `DELETE FROM venues WHERE provider_id = '...'` → `DELETE FROM providers WHERE id = '...'`.
- `UPDATE providers SET id = 'NUEVO' WHERE id = 'VIEJO'` → propaga a `venues.provider_id`, `payments.provider_id`. Análogamente para clients, venues y services.

**UI de renombrado (implementada en la misma sesión):** ver §7.3 "Renombrar IDs" (✅ RESUELTO) para el detalle completo de `abrirRenombrarId` y los botones añadidos en `formulario.html`, `proveedores.html` y `tablas.js`.

---

### Fase 4 — ✅ Completa: Asistente: borrador, notas de sesión y caché de prompts (jun 2026)

**Archivos modificados:** `asistente.js`, `asistente-config.js`, `solicitudes.js`, `solicitudes.html`, `solicitudes.css`, Edge Function `claude-proxy` (Supabase Dashboard).

1. ✅ **Bug asistente: disponibilidad vacía** — `expandirServiceIds` normaliza slugs con `split('-')`. Corregido también `_inferirServiceIds` en `solicitudes.js`.
2. ✅ **Precios siempre por persona** — instrucción explícita en `SYSTEM_PROMPT_ASISTENTE`.
3. ✅ **Bug `_onBorradorActualizado`** — al recibir `---BORRADOR---`, empareja líneas por `service_id + venue_id` y preserva `estado` de las existentes antes de persistir.
4. ✅ **Auto-transición al enviar** — cubierto por `_onRespuestaUsadaEnLog` (transiciona a `respuesta_enviada` independientemente del estado previo, actualiza badge/select/botón recordatorio).
5. ✅ **`venue_display_name` en asistente** — ya estaba en el system prompt.
6. ✅ **`estado` en borrador explicado al asistente** — sección BORRADOR DE PROPUESTA de `SYSTEM_PROMPT_ASISTENTE` ampliada con el significado de `'pendiente'`/`'hecha'`/`'descartada'` e instrucción de que Claude no genera ese campo.
7. 🔲 **Formato de `service_name` en borrador** — diferencia entre `solicitudes.js` ("Encierro - día 7") y `formulario.js` (`svc.name`). Impacto mínimo (campo descriptivo, no clave). Diferido a Fase 9 junto con las reglas de nombres de venue/evento.
8. ✅ **Tabla `session_context` en Supabase** — creada con `id`, `texto`, `created_at`. RLS habilitado, políticas equivalentes al resto de tablas del panel. Verificada INSERT+SELECT desde sesión autenticada.
9. ✅ **Notas de sesión UI** — campo de una línea en `solicitudes.html` (encima del listado, `.notas-sesion`). Click expande inline (`.notas-sesion-preview` / `.notas-sesion-edit`). Blur con cambio → INSERT silencioso en `session_context`. Variable `_notasSesion` en módulo; callback `getNotasSesion: () => _notasSesion` pasado a `initAsistente`.
10. ✅ **Edge Function `claude-proxy` actualizada** — acepta `system` como `string | array`. `Array.isArray(system)` distingue los dos casos. Header `anthropic-beta: prompt-caching-2024-07-31` activo.
11. ✅ **`system` como array con caché en `asistente.js`** — dos bloques `cache_control: ephemeral`: system prompt principal + notas de sesión (solo si hay contenido). Penúltimo mensaje del historial también marcado con `cache_control: ephemeral`.
12. ✅ **Indicador visual de `estado` en la tabla del borrador** (`solicitudes.js`) — fondo verde claro para `'hecha'`, opacidad reducida para `'descartada'`, badge ✓/✗ delante del nombre del servicio.

---

### Fase 5 — 🟡 Flujo sfcom: leads cancelados + reducción de modales

1. ✅ **Leads cancelados sfcom** — implementación completa jun 2026:
   - `checkSfcomOrders` (sfcom.js) devuelve `{ ok, nuevos, cancelados }` separados. El caller en `formulario.js` llama `importarCanceladosSfcom` para cancelados y `registrarPedidosSfcom` solo para nuevos.
   - `importarCanceladosSfcom(supabase, sfcomListings, cancelados)` exportada desde `sfcom.js` — lógica compartida sin duplicar: matching silencioso de producto (nombre → día → IDs, sin modales en casos 2/3/4), dedup por cliente (email/teléfono/nombre) + service_id, INSERT con `status: 'cancelada_sfcom'`, `proposal_draft` pre-rellenado con `service_id + venue_id + day + price`, `conversation_notes` con nota inicial como `<Cliente>`, `created_at` con fecha real del pedido sfcom.
   - `loadSfcomListings(supabase)` exportada desde `sfcom.js` — carga el mapeo WooCommerce→servicio/venue. Necesaria en las páginas que no son formulario.html.
   - El check sfcom se ejecuta al inicio de **formulario.html**, **solicitudes.html** y **panel.html** (solo los dos últimos necesitan `loadSfcomListings`).
   - `solicitudes.js`: sección "Leads cancelados sfcom" entre activas y cerradas; botones "🔄 Intentar recuperar" (→ asistente modo `recuperar_sfcom`) y "↩ Marcar como nueva"; badge ámbar `cancelada_sfcom`.
   - `panel.js` / `panel.html`: nueva alerta `alerta-cancelados-sfcom` "N leads sfcom cancelados — posibles ventas a recuperar" con enlace a `solicitudes.html`.
   - `asistente-config.js`: modo `recuperar_sfcom` — comprueba disponibilidad del venue/servicio cancelado, redacta email de recuperación, sugiere alternativas si no hay plaza, tono resolutivo sin mencionar "cancelado".
   - **Supabase**: CHECK constraint `reservation_requests_status_check` ampliado para incluir `'cancelada_sfcom'`.
2. ✅ **Reducción de modales (jun 2026):** 6 cambios en `formulario.js` y `sfcom.js`. Ver detalle completo en §7.2. Resumen: A) checkAvailabilityBeforeSave silenciado cuando la brecha es la del pedido sfcom; B) confirmarStockSfcom auto-sync sin modal cuando nuevoStock = stockActual; C) confirm de cliente nuevo suprimido al venir de solicitud sfcom; D) _ofrecerCerrarSolicitud auto-cierra solicitudes WEB cuando todos sus items tienen reserva; E) verificación auto-run con solo pendingExplains → toast azul en lugar de modal; F) eliminación de última reserva → un único modal contextual pre-computado (reemplaza 3 interrupciones).

---

### Fase 6 — ✅ Panel: UX de navegación y edición (completa jun 2026)

1. ✅ **Tablas del panel navegables:** `filaEvento` y `filaProveedor` en `panel.js` tienen `onclick` y `cursor:pointer`. Las funciones `window._seleccionarEvento` / `window._seleccionarProveedor` actualizan el select y disparan el render. Segundo clic deselecciona. Bidireccional con el dropdown.
2. ✅ **`services.image_url` editable:** campo `inputServicioImageUrl` en la sección "Info del servicio" de `proveedores.js`.
3. ✅ **Pestañas par/servicio sobre la línea separadora:** tabs `data-avail-tab` dentro de `avail-sep` (mismo patrón que venue tabs). Tab por defecto según `venue_type === 'balcon'`. Badges de contenido no guardado. Etiquetas dinámicas: "Detalles [SERVICE_ID] en [VENUE_ID]" y "Info general [SERVICE_ID]".
4. ✅ **Fotos 16:9 con overflow:** CSS `aspect-ratio: 16/9; overflow: auto` en `.photo-carousel-img-wrap`.
5. ✅ **Reordenar fotos (botón ⬆ Subir):** footer del carousel, activo si `_photoIdx > 0`. `photos.splice(idx - 1, 0, photos.splice(idx, 1)[0])` → `_savePhotos()`.
6. ✅ **`services.image_url` auto-fill:** al guardar la primera foto (`esPrimeraFoto && photos.length === 1 && !image_url`), actualiza `services.image_url` en Supabase y en caché.

---

### Fase 6b — ✅ Asistente: fix mensajes editados + auto-save logs (implementada)

**Archivo:** `asistente.js`.

1. ✅ **Fix `mensajes` con edición:** en `_alUsarBoton(texto)`, antes de llamar a `_onRespuestaUsadaEnLog`, el bucle recorre `mensajes` al revés buscando el último mensaje de `role: 'assistant'` que contenga `---MENSAJE_CLIENTE---`, y reemplaza el contenido a partir del marker con el texto editado por Paula. SessionStorage y el log guardado reflejan la versión final, no el texto bruto de Claude.
2. ✅ **Toggle auto-guardar log:** el botón "Guardar log" fue sustituido por un toggle estilo iOS (`#lbl-autolog`, `#autolog-track`, `#autolog-thumb`) en la cabecera del modal. Estado en `localStorage('asistente_autolog')`; por defecto activado. Al cerrar el overlay (`close` event): si el toggle está activo y hay mensajes, se hace INSERT en `assistant_logs`. Al activar el toggle manualmente (cuando estaba desactivado): también se guarda inmediatamente.

---

### Fase 6c — ✅ Bugs §7.9: fixes sin fase asignada (completa jun 2026)

**Archivos:** `panel.js`, `formulario.js`.

1. ✅ **`verificarConsistenciaFinanciera`: botón "Corregir" protege cobros con historial.** Excluye del DELETE a entradas con `tieneHistorial: true`; lista en el modal los clientes que requieren corrección manual.
2. ✅ **`marcarAtendida` requiere confirmación.** Modal de confirm antes de hacer `status: 'convertida'`. Autofocus en "Cancelar" para evitar pulsaciones accidentales.
3. ✅ **`cambiarEstadoSeleccionadas` verifica capacidad al reactivar.** Antes del UPDATE, comprueba plazas libres con `getPlazasInfo` por par; si no hay hueco, carga la reserva en el formulario con estado en 'pendiente' para que Paula elija proveedor o cancele.
4. ✅ **`confirmarReorganizacion`: reversión real.** Inspecciona `allSettled` + `r.value?.error`; si alguna reversión falló, muestra modal de error grave listando qué reservas quedan inconsistentes.

---

### Fase 7 — ✅ Mejoras de propuestas (completa jun 2026)

`venues.display_name` ✅ — cadena `filaSaved.nombre ?? venue.display_name ?? svc.name ?? r.venue_id`. `availability.description → svc.description` ✅ — fallback correcto en modo Completo. `disp?.photos[0] ?? svc.image_url` ✅ — hasta 3 fotos en modo Completo. `access_instructions` no se incluye en propuestas (pertenece a confirmaciones, no a propuestas comerciales). Dos modos Compacto/Completo implementados.

---

### Fase 8 — ✅ Facturación canal sfcom (completa jun 2026)

---

#### El problema

Las reservas que entran por tienda.sanfermin.com (canal sfcom, operado por Hilario) llegan identificadas con `origin_ref LIKE 'WEB%'` (ej: `WEB026_1090`). El precio en `reservations.price_per_slot` ya es el precio **neto** que Paula recibe: el bruto que pagó el cliente dividido entre 1,15 (la comisión del 15% ya está descontada). Por tanto, el dinero de esas reservas técnicamente "ya está cobrado" por sfcom y Hilario se lo transferirá a Paula. El sistema de cobros normal no refleja esto: las reservas existen en `charges` de los clientes reales pero sin ninguna marca de que ya están liquidadas vía canal.

Adicionalmente, Paula necesita poder facturar a Hilario el importe acumulado de ventas del canal para cerrar la liquidación con él.

---

#### Decisión de diseño

Dos ángulos del mismo dinero, gestionados por separado:

**Ángulo 1 — Cliente real:** cada reserva sfcom del cliente `GARCIA_PEDRO` genera un `charges` row en el propio `GARCIA_PEDRO` con `collected=true` y `comments='Cobrado vía sfcom'`. Significa: "este dinero ya fue cobrado, vía sfcom". El cobro final automático del cliente real queda en 0€ (o el saldo correcto si hay otras reservas no-sfcom del mismo cliente).

**Ángulo 2 — Canal sfcom:** existe un cliente `SFCOM` en la tabla `clients` que representa a Hilario/la tienda. Al abrirlo en formulario.html, el sistema muestra una **fila virtual** (`SFCOM_CANAL`) que agrega todas las ventas WEB% activas, y genera un "Cobro final" real en `charges` bajo `client_id='SFCOM'` por el total acumulado. Ese es el importe que Paula le debe facturar a Hilario.

Estos dos ángulos representan el mismo dinero visto desde perspectivas distintas. No se suman en ningún KPI: los KPIs del panel excluyen explícitamente los `charges` de `client_id='SFCOM'`.

---

#### Base de datos: qué existe y qué significa

**Tabla `clients`:**
- Fila `id='SFCOM', name='Canal sfcom (tienda.sanfermin.com)'`. Creada manualmente en jun 2026.

**Tabla `charges` — dos capas de registros sfcom:**

Capa A — cargos en clientes reales, uno por reserva sfcom:
```
client_id   = el cliente real (GARCIA_PEDRO, EMPRESA_X, etc.)
amount      = reserva.total_amount (importe neto de esa reserva)
collected   = true
collected_date = fecha de inserción (día en que se procesó el pedido sfcom)
comments    = 'Cobrado vía sfcom'
is_final    = false
```
Identificador: `comments = 'Cobrado vía sfcom'`. No hay FK directa a `reservations` (la tabla `charges` no tiene `reservation_id`). El vínculo se establece por `client_id + amount + collected_date` y, si se necesita auditar, por JOIN con `reservations WHERE origin_ref LIKE 'WEB%' AND client_id = charges.client_id`.

Capa B — cobro final en cliente SFCOM:
```
client_id   = 'SFCOM'
amount      = suma de total_amount de todas las reservas WEB% activas (no Canceladas)
is_final    = true
collected   = false hasta que Paula marque la liquidación como cobrada
```
Este registro se auto-crea y auto-actualiza cada vez que Paula abre el cliente SFCOM en formulario.html. Es el importe que se le facturará a Hilario. Puede quedar desactualizado entre visitas, pero se recalcula siempre al abrir.

**SQL ejecutados en jun 2026 (ya aplicados, no repetir):**

Creación del cliente SFCOM:
```sql
INSERT INTO clients (id, name) VALUES ('SFCOM', 'Canal sfcom (tienda.sanfermin.com)') ON CONFLICT DO NOTHING;
```

Cargos retroactivos para reservas sfcom existentes (capa A):
```sql
INSERT INTO charges (client_id, amount, due_date, collected, collected_date, comments, is_final)
SELECT r.client_id, r.total_amount, CURRENT_DATE, true, CURRENT_DATE, 'Cobrado vía sfcom', false
FROM reservations r
WHERE r.origin_ref LIKE 'WEB%' AND r.status != 'Cancelada'
ON CONFLICT (client_id, amount, due_date) DO NOTHING;
```

Corrección de cobros finales desajustados en clientes reales (necesario porque el cobro final de algunos clientes se había calculado antes de insertar los cargos retroactivos):
```sql
UPDATE charges c
SET amount = (
    SELECT COALESCE(SUM(r.total_amount), 0) -
           COALESCE((SELECT SUM(c2.amount) FROM charges c2
                     WHERE c2.client_id = c.client_id
                       AND c2.is_final = false
                       AND c2.collected = true), 0)
    FROM reservations r
    WHERE r.client_id = c.client_id AND r.status != 'Cancelada'
)
WHERE c.is_final = true AND c.invoice_number IS NULL
  AND c.client_id != 'SFCOM';
```

Eliminación del cobro final erróneo de SFCOM (se creó automáticamente al abrir el cliente antes de que los datos estuvieran completos):
```sql
DELETE FROM charges WHERE client_id = 'SFCOM';
```
(El cobro final correcto se regenera automáticamente la próxima vez que Paula abre el cliente SFCOM.)

---

#### Código modificado — detalle de cada cambio

**`formulario.js` — función `calcularTotalCobrarCliente`**

Calcula el total que se le puede cobrar a un cliente (suma de reservas activas). Para SFCOM, no hay reservas propias; el total son todas las ventas WEB%:

```js
function calcularTotalCobrarCliente(clienteId) {
    if (clienteId === 'SFCOM') {
        return todasReservas
            .filter(r => r.origin_ref?.startsWith('WEB') && r.status !== 'Cancelada')
            .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
    }
    return todasReservas
        .filter(r => r.client_id === clienteId && r.status !== 'Cancelada')
        .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
}
```

Sin este parche, SFCOM mostraría 0€ (no tiene reservas propias) y no habría base para calcular cobro final.

---

**`formulario.js` — función `cargarReservasCliente` (rama SFCOM)**

Al cargar el cliente SFCOM, en lugar de leer sus reservas de `todasReservas` (que está vacío para SFCOM), construye una fila virtual en memoria y la usa como si fuera una reserva real:

```js
if (clienteId === 'SFCOM') {
    const sfcomReservas = todasReservas.filter(r => r.origin_ref?.startsWith('WEB') && r.status !== 'Cancelada')
    const totalVentas   = sfcomReservas.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
    const virtualRow = {
        id: 'SFCOM_CANAL', client_id: 'SFCOM',
        service_id: 'Canal sfcom', venue_id: `${sfcomReservas.length} reservas`,
        slots: sfcomReservas.length, price_per_slot: null,
        total_amount: totalVentas.toFixed(2),
        status: 'Confirmada', proposal_number: null
    }
    reservasCliente = [virtualRow]
    // ... (render de tabla, ocultar botones que no aplican, cargar cobros)
    await cargarCobrosCliente(clienteId, reservasCliente)
    return
}
```

La fila virtual no existe en Supabase. Solo vive en memoria durante la sesión. Su único propósito es que `cargarCobrosCliente` detecte `reservasCliente.length > 0` y proceda a calcular el cobro final. La función `calcularTotalCobrarCliente('SFCOM')` que llama internamente devuelve el total real WEB%.

Los botones Cancelar, Eliminar, Generar propuesta y Enviar bienvenida se ocultan mientras SFCOM está cargado — no tienen sentido sobre una fila virtual. Se restauran al cambiar a otro cliente en `limpiarCamposCliente`.

---

**`formulario.js` — función `cargarCobrosCliente` (guard)**

Antes de crear el cobro final automático, comprueba que el importe es significativo:

```js
if (!hitosClienteTemp.find(h => h.esFinal)) {
    if (cobroFinal >= 0.01) {
        // crear y persistir cobro final
    }
}
```

Sin este guard, abrir cualquier cliente con reservas ya completamente pagadas (p.ej. un cliente sfcom con todas sus reservas marcadas como cobradas) crearía un cobro final de 0€ innecesario en la BD.

---

**`formulario.js` — función `renderTablaReservas` (null safety)**

La fila virtual `SFCOM_CANAL` tiene `price_per_slot: null` (no aplica — es un agregado). El render original fallaba o mostraba `null€`. Fix:

```js
<td>${r.price_per_slot != null ? r.price_per_slot + '€' : '—'}</td>
```

---

**`formulario.js` — función `limpiarCamposCliente`**

Al cambiar de cliente, restaura los botones de acción que se habían ocultado al entrar en SFCOM:

```js
;['btnCancelar', 'btnEliminar', 'btnGenerarPropuesta', 'btnEnviarBienvenida'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = ''
})
```

Sin esto, si Paula abría SFCOM y luego navegaba a otro cliente, esos botones seguían ocultos.

---

**`formulario.js` — handler `btnAnadirReserva` (carga automática de cargo sfcom)**

Al guardar una reserva nueva con `origin_ref LIKE 'WEB%'`, inmediatamente después del INSERT en `reservations`, se crea el cargo en el cliente real:

```js
if (solicitudOriginRef?.startsWith('WEB')) {
    await supabase.from('charges').insert({
        client_id:      clienteActual.id,
        amount:         plazas * precio,
        due_date:       hoy,
        collected:      true,
        collected_date: hoy,
        comments:       'Cobrado vía sfcom',
        is_final:       false
    })
}
```

El importe es `plazas * precio` (mismo cálculo que `total_amount`, ya neto de comisión). `collected=true` porque el dinero ya fue cobrado por sfcom. Tras esto, `persistirCobrosCliente` recalcula el cobro final del cliente real: con el cargo sfcom como prepago, el cobro final queda en 0€ (o en el saldo de reservas no-sfcom si las hubiera).

---

**`formulario.js` — función `cambiarEstadoSeleccionadas` (limpieza al cancelar)**

Cuando Paula cancela una reserva sfcom, el cargo `'Cobrado vía sfcom'` asociado quedaría huérfano si no se limpia. Eso haría que `persistirCobrosCliente` calculara un cobro final negativo para el cliente real. Fix: justo antes de que `persistirCobrosCliente` se ejecute, se eliminan los cargos sfcom de las reservas canceladas:

```js
if (nuevoEstado === 'Cancelada') {
    const sfcomCanceladas = todasReservas.filter(r => ids.includes(r.id) && r.origin_ref?.startsWith('WEB'))
    for (const r of sfcomCanceladas) {
        await supabase.from('charges').delete()
            .eq('client_id', r.client_id)
            .eq('comments', 'Cobrado vía sfcom')
            .gte('amount', parseFloat(r.total_amount) - 0.005)
            .lte('amount', parseFloat(r.total_amount) + 0.005)
    }
}
```

El filtro por `amount` (con ±0.005€ de tolerancia por precisión float) es necesario porque no hay `reservation_id` en `charges`. Si el mismo cliente tiene varias reservas sfcom con el mismo importe en el mismo día, este delete podría borrar el cargo de la reserva equivocada (ver "Limitaciones conocidas" más abajo).

---

**`utils.js` — función `persistirCobrosCliente` (rama SFCOM + guard)**

Dos cambios:

1. Cálculo del total para SFCOM usa WEB% (igual que `calcularTotalCobrarCliente`):
```js
const total = clienteId === 'SFCOM'
    ? todasReservas.filter(r => r.origin_ref?.startsWith('WEB') && r.status !== 'Cancelada')
                   .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
    : todasReservas.filter(r => r.client_id === clienteId && r.status !== 'Cancelada')
                   .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
```

2. Guard que evita crear cobro final de 0€ cuando no existe ninguno previo:
```js
if (!hitoFinal && cobroFinal < 0.01) return
```
(Si ya existe un hito final previo y el nuevo cálculo es 0, sí lo actualiza a 0 para reflejar la realidad.)

---

**`panel.js` — función `calcularEstadoFinanciero` (KPIs de cobros)**

Los cargos de `client_id='SFCOM'` representan lo que Hilario debe a Paula — no son cobros pendientes al uso. Incluirlos en los KPIs globales causaría doble conteo: el mismo dinero aparece como `collected=true` en los clientes reales Y como pendiente en SFCOM. Fix:

```js
const chargesClientes = charges.filter(c => c.client_id !== 'SFCOM')
const cobrosTotal    = chargesClientes.reduce((s, c) => s + parseFloat(c.amount), 0)
const cobrado        = chargesClientes.filter(c => c.collected).reduce((s, c) => s + parseFloat(c.amount), 0)
const pendienteCobro = cobrosTotal - cobrado
```

---

**`panel.js` — función `calcularCashflow` (cashflow)**

Mismo motivo: excluir SFCOM de las curvas "previsto" y "real" del cashflow:

```js
charges.filter(c => c.client_id !== 'SFCOM').forEach(c => { ... 'previsto' ... })
charges.filter(c => c.collected && c.client_id !== 'SFCOM').forEach(c => { ... 'real' ... })
```

---

**`panel.js` — función `verificarConsistenciaFinanciera` (verificación)**

El bucle de consistencia por cliente compara `SUM(charges)` con `SUM(reservas activas)`. Para SFCOM, esta comparación no tiene sentido (sus `charges` representan el total WEB%, que no corresponde a sus propias reservas). Se excluye explícitamente:

```js
for (const id of new Set([...chargesTotales.keys(), ...reservasTotales.keys()])) {
    if (id === 'SFCOM') continue
    ...
}
```

---

#### Flujo completo por escenario

**Pedido nuevo en sfcom:**
1. `checkSfcomOrders` detecta el pedido → `registrarPedidosSfcom` → INSERT en `reservation_requests` con `source='WEB026_1090'`.
2. Paula procesa la solicitud en bloque 0 de formulario.html → `btnAnadirReserva`.
3. INSERT en `reservations` con `origin_ref='WEB026_1090'`, `client_id='GARCIA_PEDRO'`, `price_per_slot` = neto.
4. Automáticamente: INSERT en `charges` con `client_id='GARCIA_PEDRO', collected=true, comments='Cobrado vía sfcom'`.
5. `persistirCobrosCliente('GARCIA_PEDRO', ...)` recalcula el cobro final de GARCIA_PEDRO. Al tener ese cargo como prepago, el cobro final baja (a 0€ si solo tiene reservas sfcom, o al saldo restante si tiene también reservas directas).

**Cancelación de una reserva sfcom:**
1. Paula selecciona la reserva en bloque 4 → "Cancelar".
2. `cambiarEstadoSeleccionadas` detecta `origin_ref LIKE 'WEB%'`.
3. DELETE del `charges` con `comments='Cobrado vía sfcom'` y `amount ≈ total_amount` del cliente real.
4. UPDATE de `reservations.status = 'Cancelada'`.
5. `persistirCobrosCliente` recalcula el cobro final del cliente real correctamente (ya sin el prepago sfcom).

**Paula abre el cliente SFCOM:**
1. Autocomplete → 'SFCOM' → `cargarReservasCliente('SFCOM')`.
2. El sistema filtra `todasReservas` por `origin_ref LIKE 'WEB%'` y `status != 'Cancelada'`.
3. Construye la fila virtual `SFCOM_CANAL` con el recuento y total agregados.
4. Muestra esa fila como si fuera una reserva del cliente.
5. `cargarCobrosCliente('SFCOM', [virtualRow])` carga los hitos reales de SFCOM desde `charges`.
6. `persistirCobrosCliente('SFCOM', todasReservas)` recalcula y upserta el cobro final en `charges` bajo `client_id='SFCOM'`.
7. Paula ve en bloque 5 el cobro final actualizado. Puede añadir hitos parciales (señales, adelantos) y finalmente facturarle a Hilario.

**Paula añade una nueva reserva directa (no sfcom):**
Sin cambios en el flujo normal. `solicitudOriginRef` es null → no se crea cargo sfcom. `persistirCobrosCliente` calcula el cobro final normal.

---

#### Limitaciones conocidas y aceptadas

**1. El cargo sfcom no tiene FK a la reserva.** `charges` no tiene campo `reservation_id`. El vínculo entre un cargo `'Cobrado vía sfcom'` y la reserva que lo origina es implícito: mismo `client_id`, mismo `amount`, misma `collected_date`. Si un cliente tiene dos reservas sfcom con el mismo importe exacto procesadas el mismo día, la UNIQUE constraint `(client_id, amount, due_date)` bloquearía la segunda inserción (ON CONFLICT DO NOTHING). En la práctica es improbable pero no imposible. Solución si ocurre: ajustar manualmente en Supabase.

**2. La cancelación podría borrar el cargo equivocado.** Si el cliente tiene dos reservas sfcom con importe casi idéntico (diferencia < 0.005€), el DELETE por `amount ≈ total_amount` podría afectar a la reserva incorrecta. Mitigado porque en la práctica las reservas sfcom de un mismo cliente tienen precios distintos. Solución si ocurre: ajuste manual en Supabase.

**3. El cobro final de SFCOM se queda obsoleto entre visitas.** Si entran nuevas reservas sfcom y Paula no abre el cliente SFCOM, el `charges` de `client_id='SFCOM'` con `is_final=true` refleja el total anterior. Se auto-corrige en la próxima apertura. No hay un mecanismo de actualización automática en background. Consecuencia: el importe mostrado en Supabase Dashboard puede ser incorrecto, pero el importe que ve Paula en el panel siempre es correcto (se recalcula al cargar).

**4. Los cargos sfcom de clientes reales sí aparecen en la verificación de consistencia.** La verificación compara `SUM(charges)` con `SUM(reservas activas)` por cliente. Para un cliente solo-sfcom, los cargos sfcom (=total de sus reservas sfcom) y las reservas activas cuadran perfectamente → sin falsos positivos. Para un cliente mixto (tiene reservas directas Y sfcom), la suma de charges incluye tanto los cargos sfcom (`collected=true`) como el cobro final calculado sobre sus reservas directas → debe cuadrar igualmente. Esto se verificó con los datos reales en jun 2026.

**5. Los KPIs del panel excluyen el importe pendiente de Hilario.** El "pendiente de cobro" en los KPIs excluye `client_id='SFCOM'`. Esto es intencional: ese dinero no es "por cobrar" en el sentido habitual; es una liquidación pendiente con un operador externo que se gestiona por factura separada. Si Paula quiere ver cuánto le debe Hilario, abre el cliente SFCOM.

---

#### Cómo facturar a Hilario

1. Abrir formulario.html → buscar cliente `SFCOM`.
2. El bloque 5 muestra el cobro final automático (= total de todas las ventas WEB% activas) y cualquier hito parcial que Paula haya añadido manualmente.
3. Para facturar: pulsar "Facturar" en el hito deseado → se genera factura PDF en serie VSF como con cualquier otro cliente.
4. Marcar como cobrado cuando Hilario transfiera el importe.

---

### Fase 9 — 🔲 Refactors y cierre

- Inferencia `level → service_id` unificada en `utils.js` (extraer de formulario.js, solicitudes.js, asistente.js).
- ✅ Reglas de nombres venue/evento documentadas en §3.
- Evaluar granularidad caché sfcom en sfcom.js.
- Tablas.js edición directa + Supabase Storage (incluye limpieza de PDFs huérfanos — ver §7.1).
- Split de formulario.js (solo si el tamaño es problema práctico, siempre al final).

---

## 10. Claridad de labels y textareas para Paula ✅ (jun 2026)

**Aplicado en `proveedores.html`, `proveedores.js` y `formulario.html`.**

**Campos "Comentarios" → "Notas internas"** (label + placeholder "Solo uso interno") en todos los campos puramente internos: proveedor, venue/balcón, disponibilidad, cliente y reserva. Deja claro que nunca llegan al cliente.

**"Descripción del venue" → dinámica según tipo** (`labelAvailDesc` con `id`). Placeholder cambiado a "Va en propuestas, confirmaciones y catálogo web" para que quede claro que es texto de cara al cliente.

**"venue" eliminado de toda la GUI de proveedores.** `_VENUE_LABELS` extendida con `desc`, `dlgTitulo`, `dlgId`, `dlgDir`, `toast` y `errorId` para los cuatro tipos (`balcon`, `barrera`, `guia`, `servicio_especial`). `_actualizarLabelsVenue` actualiza también `labelAvailDesc`. Nueva función `_actualizarLabelsDlgVenue` actualiza el diálogo de crear en tiempo real al cambiar el tipo. Toast de renombrar y mensaje de error de ID duplicado también usan el término correcto para cada tipo.

**Placeholder de `inputServicioDescription`** → "Descripción general del servicio (igual para todos los proveedores)", diferenciando claramente del campo específico del balcón.

**Pendiente de revisión futura:** campos `comments` de `panel.html`, `solicitudes.html` y `tablas.html` — aplica la misma lógica "Notas internas / Solo uso interno" cuando se trabaje en esos paneles.
