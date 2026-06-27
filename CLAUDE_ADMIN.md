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

**`services`** — Tipo de evento (Fase 1 jun 2026: PK migrada de text a integer)
| Campo | Notas |
|---|---|
| id | **integer PK autoincremental** (antes era el texto ENCIERRO_7 etc.; desde Fase 1 es un surrogado entero) |
| service_code | **text UNIQUE NOT NULL** — el identificador legible antes almacenado en `id` (ej: `ENCIERRO_7`, `CHUPINAZO_6`). Regla de uso: `service_code` para display en UI, lógica de negocio y patrones regex; `id` solo para FK en BD. |
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
| service_id | **integer** FK→services.id NOT NULL (Fase 1: antes era text FK) |
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
| service_id | **integer** FK→services.id (Fase 1: antes era text FK) |
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
| is_final | boolean — hito final del pago a proveedor |
| comments | text — nota opcional sobre el hito |

UNIQUE (provider_id, amount, due_date).

**`reservation_requests`** — Solicitudes recibidas
| Campo | Notas |
|---|---|
| id | uuid PK, gen_random_uuid() |
| client_name | text NOT NULL |
| client_email, client_phone, client_address | text |
| comments | Columna legacy. Ya no se escribe desde ningún flujo activo. La web pública solía escribir aquí el comentario libre del formulario; desde jun 2026 ese dato va dentro del JSON de `conversation_notes`. Los registros antiguos pueden tener valor; `_procesarWebFormsSinProcesar` lo usa como fallback (`rawData.comment \|\| sol.comments`). Pendiente de DROP en Fase 10. |
| status | `'nueva'` → `'en_conversacion'` → `'respuesta_enviada'` → `'seguimiento_pendiente'` → `'convertida'` o `'descartada'`; default `'nueva'`. El valor `'cancelada_sfcom'` quedó obsoleto en jun 2026 — migrado automáticamente a `'nueva'` en `_verificarTransicionesAutomaticas()`. |
| created_at | timestamptz, default now() |
| updated_at | timestamptz — actualizado por trigger en cada UPDATE |
| source | null (formulario web público), `'email'` (procesado desde panel), `'manual'` (+Nueva directa), `WEB\d+_\d+` (sfcom confirmado), `sfcom_c:*` (sfcom cancelado lead) |
| language | `'es'`, `'en'`, `'fr'`, `'it'`, `'de'`, `'other'` — solo para emails |
| conversation_notes | Log interno formato: `---DD/MM/AA---\n<Paula>\nTexto\n<Cliente>\nTexto`. Excepción: solicitudes web recién insertadas por `main.js` antes de ser procesadas por el panel — el campo contiene temporalmente un JSON `{"slug","day","slots","comment"}` como primer contacto raw. El campo `comment` recoge el texto libre del formulario web (desde jun 2026; antes iba a la columna `comments` legacy). `_procesarWebFormsSinProcesar()` en `solicitudes.js` detecta este estado y lo convierte al formato log normal, rellenando también `proposal_draft`. |
| proposal_draft | jsonb, default `'[]'` — array de líneas del borrador de propuesta. Cada línea: `{ service_id, service_name, day, venue_id, venue_display_name, slots, price, catalogo_url, estado }`. `service_name`: slug web original o nombre sfcom del producto. `price`: precio bruto por plaza (para sfcom = precio WooCommerce; para otros = precio de venta estimado). `estado`: `'pendiente'` (default), `'hecha'`, `'descartada'` — solo presente cuando la solicitud pasa por el bloque de conversión en formulario.html. Actualizado por la tabla del borrador en solicitudes.js, por `_persistirEstadoLineas()` en formulario.js, y automáticamente cuando el asistente emite `---BORRADOR---`. Nunca vacío en registros correctamente creados: lo pueblan el INSERT en cada flujo (web/email/sfcom) o `_procesarWebFormsSinProcesar()` al cargar solicitudes.html. |

**Ciclo de vida de `status`:** las solicitudes con `status IN ('convertida','descartada')` no aparecen en ninguna lista activa. Auto-transición en solicitudes.js: `respuesta_enviada` → `seguimiento_pendiente` si `updated_at` supera 3 días sin respuesta.

**Detección de origen por `source` (jun 2026):** el origen es siempre el campo `source`; nunca el `status`. Detectores:
- `/^WEB\d+_\d+$/.test(source)` → sfcom confirmado (`_esSfcom`)
- `source?.startsWith('sfcom_c:')` → lead sfcom cancelado
- `source === 'email'` → email parseado desde el panel
- `source === 'manual'` → entrada directa vía +Nueva (sin email)
- `source === null` → formulario web público

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

**`trg_uppercase_*`** — BEFORE INSERT OR UPDATE en `availability`, `charges`, `clients`, `payments`, `providers`, `reservations`, `services`. Todos usan la función compartida `uppercase_ids()`, que aplica `UPPER()` sobre los IDs de texto relevantes según `TG_TABLE_NAME`. **Caso `services` (Fase 1):** aplica `UPPER()` sobre `NEW.service_code` (ya NO sobre `NEW.id`, que ahora es integer).

**`trg_uppercase_venues`** — BEFORE INSERT OR UPDATE en `venues`. Usa su propia función `trg_uppercase_venues_fn()`, separada de `uppercase_ids`. Además de `UPPER()`, normaliza espacios a guiones bajos en `id` y `provider_id` (`REPLACE(NEW.id, ' ', '_')`).

**`notificar-solicitud`** — AFTER INSERT en `reservation_requests`. Usa la función interna de Supabase `http_request()` (vía `net.http_post`) para llamar a la Edge Function del mismo nombre con los datos del INSERT. Se dispara en cada INSERT (desde la web pública, desde `checkSfcomOrders` y desde el asistente). La Edge Function filtra por `source`: solo envía email para inserciones del formulario web público (`source IS NULL`); las entradas manuales (`source = 'email'`) y sfcom (`source LIKE 'WEB%'` o `source LIKE 'sfcom_c:%'`) reciben una respuesta 200 OK sin enviar correo (ya están visibles en el panel en el momento de la inserción). Transparente para el JS.

**`trg_reservation_requests_updated_at`** — BEFORE UPDATE en `reservation_requests`. Función `update_reservation_requests_updated_at()`. Actualiza automáticamente el campo `updated_at` en cada cambio.

**`trg_sync_availability_event_type`** — AFTER UPDATE en `availability`. Función `sync_availability_by_event_type()`. Cuando se editan `photos`, `description` o `access_instructions` en una fila, sincroniza los tres campos a todas las filas con el mismo `venue_id` y `event_type` (el `event_type` se obtiene de la tabla `services`). Transparente para el JS: editar una fila sincroniza todas las del mismo venue+event_type.

### Vistas

Definiciones SQL exactas en `supabase/sql/views_pre_migration.sql` (estado pre-Fase1) y en el archivo de migración `supabase/sql/migration_fase1_services_pk.sql` (estado post-Fase1).

**`service_availability`** — Plazas libres por servicio (solo lectura, acceso anon, `security_invoker=false`). Campos: `service_id` (text = **service_code**, no el integer PK), `free_slots`. **IMPORTANTE:** expone `service_code` aliasado como `service_id` (texto tipo `ENCIERRO_7`) para que `disponibilidad.js` del frontend público siga funcionando sin cambios. Agrupada por `services.id + service_code`.

**`availability_panel`** — Solo authenticated. Campos: `id, venue_id, service_id` (integer FK), `total_slots, price_per_slot, billing_model, description, access_instructions, photos, venue_display_name, venue_address, venue_slug, event_type, day, start_time, service_code` (text, añadido en Fase 1). Usada por `formulario.js`, `solicitudes.js`, `asistente.js` y `proveedores.js`. No incluye campos sfcom. El código admin usa `service_id` para FK y `service_code` para display y patrones regex.

**`availability_with_sfcom`** — Solo authenticated. JOIN de `availability` + `sfcom_listings`. Campos: `id, venue_id, service_id` (integer FK), `total_slots, price_per_slot, billing_model, venue_display_name, sfcom_service_name, sfcom_slots_listed, sfcom_product_id, sfcom_variation_id, sfcom_status, sfcom_public_price, sfcom_listing_id, service_code` (text, añadido en Fase 1). Filas sin entrada en `sfcom_listings` tienen campos sfcom a null. Usada exclusivamente por `sfcom.js` y `sfcom-panel.js`.

**`catalogo_publico`** — Acceso anon, `security_invoker=false`. Campos: `slug, display_name, address, venue_type, service_id` (text = **service_code**, alias), `description, access_instructions, photos, service_name, event_type, day, start_time, service_image_fallback`. Usada por `catalogo/catalogo.js`.

### Seguridad (RLS)

Todas las tablas tienen RLS habilitado.

| Tabla | anon | authenticated | Notas |
|---|---|---|---|
| `assistant_logs` | ALL bloqueado | ALL permitido | RLS habilitado jun 2026 |
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

Seis tipos distintos que conviene no confundir:

| Identificador | Dónde | Propósito |
|---|---|---|
| `providers.id` | Interno | Quién paga. Formato MAYUSCULAS_GUIONBAJO. |
| `venues.id` | Interno | Qué lugar físico. Mismo formato. En 95% de casos igual que provider.id. |
| `venues.display_name` | Público | Nombre del balcón que ve el cliente. |
| `venues.slug` | Público estable | Para URLs del catálogo. Nunca cambia. |
| `services.id` | Interno (BD) | **Integer autoincremental** (surrogado). Solo para FK en BD (`availability.service_id`, `reservations.service_id`). Nunca mostrar en UI. |
| `services.service_code` | Interno (código) | Texto legible tipo `ENCIERRO_7`. Para display en UI del panel, lógica de negocio, patrones regex y `TIPO_SERVICIO_ID`. Único y estable. |
| `services.name` | Público | Nombre del tipo de experiencia sin día (ej: "Balcón encierro"). En propuestas y mensajes al cliente. |
| `sfcom_listings.sfcom_service_name` | Externo | Nombre del producto en tienda.sanfermin.com. Solo para sincronización con sfcom. |

**Regla de uso por contexto (Fase 1):**
- `services.id` (integer) — solo en queries a Supabase como FK. Nunca visible en documentos ni UI.
- `services.service_code` (texto) — en toda UI del panel donde antes aparecía `services.id`. En `TIPO_SERVICIO_ID`, `_inferirServiceId`, regex `/^ENCIERRO_(\d+)$/`.
- `venues.id` / `providers.id` — sin cambio, siguen siendo texto.
- `venues.display_name` — en toda UI interna del panel. Si es null, se usa `venues.id` como fallback.
- `services.name` — en documentos al cliente: propuestas, confirmaciones, mensajes de bienvenida.
- `venues.slug` — solo en URLs del catálogo público. Nunca cambia una vez asignado.
- `sfcom_listings.sfcom_service_name` — solo para identificar productos en la tienda sfcom. No usar fuera de ese contexto.

**`proposal_draft[].service_id`** — tras Fase 1 es integer (mismo que `services.id`). Migrado por SQL. El campo `service_name` del borrador sigue siendo texto libre (slug web, nombre sfcom, etc.).

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
| `parsearNivel(level)` | Normaliza un slug/level/sfcom_service_name a `{ tipo, day }` o `null`. `tipo`: `'encierro'` \| `'chupinazo'` \| `'procesion'` \| `'gigantes'` \| `'pobre_de_mi'`. `day`: número si figura en el slug (ej. `'encierro-8'` → `8`), `null` si no. No expande a service_ids — eso lo hace cada llamador. |
| `TIPO_SERVICIO_ID` | Constante: `{ chupinazo: 'CHUPINAZO_6', procesion: 'PROCESION_7', gigantes: 'DESPEDIDA_GIGANTES_14', pobre_de_mi: 'POBRE_DE_MI' }`. Encierro no está: su ID depende del día. |
| `extraerQualifier(slug)` | Devuelve la primera palabra del slug si es `'vivir'`, `'ver'` o `'entender'`; null en otro caso. Usada para construir el mensaje inicial en `_procesarWebFormsSinProcesar`. |
| `construirItemBorrador({ service_name, service_id, venue_id, venue_display_name, day, slots, price, catalogo_url })` | Factory tipada para líneas de `proposal_draft`. Garantiza que todos los campos existen (null por defecto) y que `estado` siempre es `'pendiente'`. Usar siempre que se cree una línea de borrador desde cero. |

### modal.js
`crearModal(id, { wide, narrow, scroll })` — único punto de creación de modales en el admin.

Crea un `<dialog>` nativo con `showModal()` (top layer del navegador, por encima de cualquier contexto CSS). Elimina cualquier dialog previo con el mismo `id`. El handler `close` elimina el dialog del DOM (incluyendo cierre por ESC). Devuelve `{ overlay: dialog, panel }`.

**Regla crítica:** siempre usar `panel.querySelector('#mi-btn')` para registrar event listeners, nunca `document.getElementById()`. Si el modal se crea dos veces, `document.getElementById` puede devolver el anterior.

Tamaños: default 560px; `--wide` 640px; `--narrow` 480px. `--scroll` activa `max-height:90vh; overflow-y:auto`.

Clases de botones del admin: `.btn`, `.btn-primary` (rojo), `.btn-secondary` (borde gris), `.btn-danger` (borde rojo).

### verificacion.js
Módulo ES6. Importa `syncStockToSfcom`, `verificarSfcom`, `verificarConfirmarSfcom` de `sfcom.js` y `crearModal` de `modal.js`. Solo dos exports públicos:

- `mostrarToast(mensaje, color)` — toast fijo en la parte superior, ~3.5s. Devuelve el elemento DOM. No se puede importar desde `utils.js` porque crearía dependencia circular (utils.js ya importa `mostrarToast` de aquí).
- `ejecutarVerificacion(supabase, opts)` — punto de entrada único. `opts`: `{ modoManual, incluirSfcom, incluirFinanciero, persistirCobros, persistirPagos }`. Carga todos los datos en paralelo, ejecuta los tres dominios de verificación y muestra el resultado (modal o toast según modo y severidad). Devuelve el objeto resultado o `null` si hay error de conexión.

**Dominios internos (privados):**
- `_cargarDatos(supabase)` — carga en paralelo: reservations, availability_with_sfcom, clients, venues, services, providers, reservation_requests (nueva), charges (*), payments (*).
- `_verificarBD(dados)` → `{ errores, avisos, advertencias }`. Errores: FK rotas en reservas/cobros/pagos, slots≤0, sobrereserva, múltiples hitos finales por cliente, variation_id duplicado en sfcom. Advertencias (solo modoManual): inconsistencias collected/date, paid/date, invoiced/invoice_number. Avisos (solo modoManual): solicitudes pendientes.
- `_computarFinanciero(dados)` → `{ problemasClientes, problemasProveedores, advertencias }`. Compara charges vs reservas por cliente (incluye SFCOM por separado: cobros SFCOM vs total reservas WEB). Compara payments vs coste teórico por proveedor (según billing_model). Advertencias (solo modoManual): cobros/pagos a cero.
- `_mostrarResultado` — decide toast vs modal. En auto: abre modal solo si hay errores BD, discrepancias sfcom no explicadas, idsMismatch o problemas financieros. En manual: siempre abre modal con todo.
- `_mostrarModal` — modal unificado con secciones: BD errores, sfcom discrepancias (reales y pendientes), sfcom fallos, financiero, BD advertencias, BD avisos, financiero advertencias.
- `_corregirFinanciero` — ejecuta corrección automática de cobros/pagos usando `persistirCobros` y `persistirPagos` pasados por el llamador.
- `_mostrarModalPreCorreccion` — flujo de corrección de idsMismatch (dead en la práctica — API sfcom no expone nombres de variaciones).

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

**Estado del módulo:** 5 variables de módulo: `_modoConversionActivo`, `_solicitudConversionId`, `_solicitudWEBRef`, `_draftConversion[]`, `_lineaActualIndex`.

`_solicitudWEBRef` preserva el campo `source` de la solicitud sfcom (`'WEBxxx_yyy'`) durante todo el flujo de conversión multi-línea. `limpiarFormularioReserva()` resetea `solicitudOriginRef = null` al cargar cada línea nueva; sin esta variable, las reservas a partir de la segunda perdían el WEB ref y se guardaban con `origin_ref = null` en lugar del ref correcto. Se restaura en `_cargarLineaEnBloque2`, en el handler de "Descartar" y en `_onLineaGuardada`. `_initBloqueConversion` lo recibe como segundo parámetro (`webRef`) desde el call site que pasa `data.source || null`.

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
- **`abrirModalBienvenida(reservasIncluidas, pendientesNoMarcadas)`** — modal con el texto como `<textarea>` editable. Si `pendientesNoMarcadas` no está vacío, muestra un banner de advertencia con checkbox para añadir una nota sobre ellas al final del mensaje. Usa `mostrarOpcionesEnvio` (`tipo:'texto'`) para WhatsApp/email. Al usar cualquier botón de envío escribe `welcome_sent_at` solo en `reservasIncluidas` (nunca en las que solo aparecen en el banner), llama a `actualizarBotonBienvenida()` y a `_onBienvenidaEnviada()` si el asistente está activo.
- Al pulsar el botón, `reservasIncluidas` contiene siempre todas las reservas **Confirmadas** del cliente más las **Pendientes** que Paula haya marcado con el checkbox en la tabla. Las Pendientes no marcadas van a `pendientesNoMarcadas` y aparecen solo en el banner de advertencia del modal.

**Asistente de bienvenidas (jun 2026):** flujo para enviar bienvenidas en lote desde el panel de control, sin tener que ir cliente a cliente.

- `panel.html` → alerta discreta `#alerta-bienvenidas` en el bloque de alertas: "N clientes sin mensaje de bienvenida enviado · Abrir asistente →". Solo visible cuando hay pendientes (`reservations.status = 'Confirmada' AND welcome_sent_at IS NULL`). Al hacer clic abre `_abrirModalSeleccionBienvenidas`.
- **`_abrirModalSeleccionBienvenidas(idsPendientes)`** en `panel.js` — modal con tabla de selección: `client_id` | canal (sfcom en rojo / propio) | nº reservas confirmadas pendientes. Todos marcados por defecto, sfcom ordenados primero. Enlace "Solo sfcom" para desmarcar los propios. Botón "Iniciar asistente (N)" escribe los IDs seleccionados en `sessionStorage('colaBienvenidas')` y navega a `formulario.html`.
- **`_initBloqueColaBienvenidas(ids)`** en `formulario.js` — se activa al cargar si `sessionStorage('colaBienvenidas')` está presente (se borra tras leerlo). Crea un bloque azul (`#bloque-cola-bienvenidas`) encima del formulario, modelado sobre `bloque-conversion-propuesta`.
- **`_renderTablaColaBienvenidas()`** — una fila por cliente: `client_id` + tag [sfcom] | estado derivado de `todasReservas` (⏳ Pendiente / ✅ Enviada / — Saltada) | botones "↓ Cargar" y "Saltar". El estado ✅ se deriva directamente de `welcome_sent_at` en `todasReservas` (fuente de verdad, sin estado adicional). Al completar todos, el bloque vira a verde con botón "Cerrar".
- **`_onBienvenidaEnviada()`** — llamada desde el `onUsado` de `abrirModalBienvenida`. Solo re-renderiza la cola; el estado ya está actualizado en `todasReservas`.

### solicitudes.js
Módulo ES6. Importa `supabase.js`, `auth.js`, `utils.js` (`initSidebar`, `buildCatalogUrl`, `resolverCliente`), `mostrarToast` de `verificacion.js`, `initAsistente`, `abrirAsistenteRespuesta`, `abrirProcesarEmail` de `asistente.js`.

Lee al cargar: `availability_panel` (para calcular disponibilidad en el borrador), `reservations` (para calcular plazas libres) y `clients` (para `resolverCliente` en `mostrarDetalle`).

**Layout:** dos columnas en desktop (lista 320px izquierda, detalle derecha). En mobile: bottom sheet (`position:fixed; bottom:0; transform:translateY(100%)` + clase `.visible`).

**Sistema de estado único (`status`):** `'nueva'` → `'en_conversacion'` → `'respuesta_enviada'` → `'seguimiento_pendiente'` → `'convertida'` o `'descartada'`. El origen nunca se guarda en el status — se detecta siempre por el campo `source`.

Auto-transición: `'respuesta_enviada'` → `'seguimiento_pendiente'` si `updated_at` supera 3 días. Migración de legacy: registros con `status === 'cancelada_sfcom'` se actualizan a `'nueva'` en `_verificarTransicionesAutomaticas()`. Ambas se aplican al cargar la lista.

**Lista (4 secciones, jun 2026):**
1. "Sfcom — confirmadas" — source `/^WEB\d+_\d+$/` (solo si existen)
2. "Solicitudes" — resto (web/email/manual) con header solo cuando coexiste con otras secciones
3. "Leads cancelados sfcom" — source `sfcom_c:*` (solo si existen)
4. "Cerradas" — status `convertida`/`descartada` (paginadas, botón "Cargar más")

Cada item: nombre, fecha, badge de origen (sfcom/sfcom_c/email/web), badge de status, experiencia, preview del último mensaje del log (64 chars, HTML escapado).

**Vista condensada vs. completa (jun 2026):** controlada por el flag `esCondensada = esSfcomConf || esCancelada`:
- **Condensada** (sfcom confirmado + sfcom cancelado): muestra datos resumidos (experiencia, día, personas, consulta), botón "💬 Historial y gestión" que despliega borrador + log + asistente. CTA inferior: "→ Crear reserva" (sfcom conf) o "🔄 Intentar recuperar" (sfcom canc). El selector de estado aparece siempre en el header (igual que en vista extendida), no dentro del toggle.
- **Completa** (web/email/manual): selector de status, borrador, log, asistente, "📋 Convertir en reservas". Botón "📩 Enviar recordatorio" prominent solo cuando `status === 'seguimiento_pendiente'`.

**Detección de modo en asistente:** al abrir sin modo explícito, se auto-detecta: si `conversation_notes` contiene `\n<Paula>\n` → modo `'seguimiento'`; si no → modo `'nueva'`.

**Borrador de propuesta (`proposal_draft`):** tabla editable que ocupa el espacio donde antes estaba el bloque de datos iniciales (`.sol-detalle-datos`). Columnas: Servicio (select desde `availability_panel`), Día (readonly si el service_id ya codifica el día), Venue (select dinámico dependiente del servicio), Plazas, €/plaza, Total (calculado, readonly), Acciones (enlace catálogo + papelera). Flechas ↑↓ para reordenar. Fila vacía al final para añadir. Guardado automático con debounce 800ms. La consulta inicial (`sol.comments`) se migra como primer mensaje `<Cliente>` del log si el log no tenía mensajes de cliente (`_migrarConsultaAlLog`).

**`_procesarWebFormsSinProcesar(sol)`:** se ejecuta al cargar la lista, después de `_verificarTransicionesAutomaticas`. Detecta registros web (`source === null`, `proposal_draft` vacío, `conversation_notes` empieza por `{`) — el estado temporal que deja `main.js` al insertar desde el formulario público. Para cada uno: parsea el JSON raw, infiere `service_id` desde el slug con `parsearNivel`, construye `proposal_draft[0]` con `construirItemBorrador`, y formatea `conversation_notes` al formato log con el resumen del cliente (slug + día + personas + comentario). El update se persiste en Supabase y en memoria.

**`_preFillBorradorSiVacio(sol)`:** ya no crea borrador desde cero. Si `proposal_draft` está vacío, retorna sin hacer nada (la creación es responsabilidad de cada flujo de inserción o de `_procesarWebFormsSinProcesar`). Si el borrador ya tiene líneas, enriquece cada línea que tenga `service_id`: rellena `price` (desde `_calcularPrecioRef`), `catalogo_url` (desde `_venuesPorServicio`) y `service_name` (desde `servicios`) si alguno de estos campos es null. Solo persiste si cambió algo.

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
Módulo ES6. Lee en paralelo: `reservations`, `availability`, `services`, `providers`, `venues`, `payments`, `charges`, `reservation_requests`, `clients`. Usa `availability` directamente (no la vista) porque no necesita campos sfcom.

**Bloques (orden en pantalla):**
1. Alertas críticas: sobrereservas, sfcom nuevos/cancelados, solicitudes pendientes, pagos/cobros vencidos, bienvenidas pendientes.
2. Panel principal (dos columnas): calendario de próximos pagos/cobros (filtrable 7/30/todos) + resumen de negocio (tarjetones dual a la derecha).
3. Por vender: 4 KPI cards + tablas pareto de disponibilidad no vendida.
4. Disponibilidad por evento.
5. Disponibilidad por proveedor.
6. Estado financiero (grid horizontal 2×3 + saldo neto) + gráfico cashflow.

Tablas con sort por columna (4 tablas). Cobros y pagos pendientes son clicables: abren formulario.html o proveedores.html con el cliente/proveedor precargado via query params.

**`calcularResumen()`:** calcula los tarjetones del bloque "Resumen de negocio". Separados en confirmadas/pendientes: `kpi-res-confirmadas`, `kpi-res-pendientes`, `kpi-plazas-confirmadas`, `kpi-plazas-pendientes`. Ingresos confirmados (`kpi-ingresos-brutos`) + pendientes (`kpi-ingresos-pendientes`). Coste proveedores = `SUM(payments.amount)` (sin importar estado). `costePendConsumo`: coste marginal adicional si las reservas pendientes confirman, solo para `billing_model = 'consumption'` (capacity ya está pagado). `kpi-coste-pend-row` se muestra solo cuando `costePendConsumo > 0`. Margen = ingresos confirmados − costes; `kpi-margen-pendientes` muestra el margen combinado si todo confirma.

**`calcularPorVender()`:** calcula el bloque "Por vender". Filtra `disponibilidad` a servicios de tipo balcón (`TIPOS_BALCON`). Para cada fila calcula: `libres = total_slots − slots_activos`, `gastoAsociado` (solo `capacity`: `libres × price_per_slot`), `margen` potencial usando `_precioRef`. KPIs globales: `kpi-plazas-libres`, `kpi-ingreso-potencial`, `kpi-coste-adicional` (solo consumption), `kpi-margen-no-capturado`, con sublabels de precio/margen medio por plaza. Separa en dos secciones: `pv-capacity` (max 5 filas pareto) y `pv-consumption` (max 3 filas pareto).

**`_precioRef(venueId, serviceId, precioProv)`:** función local de `calcularPorVender`. Precio de referencia por par venue+servicio, con fallback en cascada: (1) precio medio de reservas confirmadas en ese par exacto; (2) si es encierro: precio medio de reservas confirmadas en cualquier encierro del mismo venue; (3) `precioProv × 1.15`. `ingresoPotencial` y `margen` de cada fila usan el `precioRef` de esa fila, no un promedio global. Umbral de margen razonable: 15% (coherente con `_margenIndicador` y con `validarPrecio` en `formulario.js`).

**`_paretoCorte(items, maxRows)`:** recibe items ordenados por `libres` desc. `umbral = items[0].libres / 3`. Devuelve `{ filas: items con libres ≥ umbral (máx maxRows), resto: plazas restantes, restoN: balcones restantes }`.

**`_renderPVSeccion(containerId, items, maxRows, esCapacity)`:** renderiza una sección "Por vender". Llama a `_paretoCorte`, genera frase resumen (totales de las filas mostradas), tabla `<table class="pv-tabla">` con columnas venue_id / nombre evento / plazas libres / columna económica (gasto→margen en capacity; margen potencial en consumption). El campo venue_id y el nombre de servicio tienen igual prominencia (`font-weight: 500`); plazas en negrita (`font-weight: 600`). Pie con "y N plazas más en M balcones" si hay resto. La sección "Oportunidades" (consumption) lleva clase `pv-seccion--gap` para separación visual.

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

**Riesgo de atomicidad (deuda técnica conocida):** la secuencia guardar-en-Supabase → PUT-a-sfcom no es atómica. Si el INSERT/UPDATE en Supabase tiene éxito pero el PUT a sfcom falla, la reserva queda registrada en BD pero sfcom no actualiza su stock. El modal de error de PUT incluye un correo preformateado para Hilario. La verificación manual con "Verificar datos" detecta la discrepancia y permite sincronizar. No hay rollback automático.

**Exports principales:**
- `syncStockToSfcom(supabase, venueId, serviceId)` — hace PUT si `sfcom_status === 'confirmed'`. Silencioso en éxito, modal de error en fallo. Llamar siempre después de cualquier operación que cambie reservas activas.
- `checkAvailabilityBeforeSave(supabase, venueId, serviceId, plazas)` — verifica antes de guardar reserva nueva. No bloquea si el GET de sfcom falla.
- `checkSfcomOrders(supabase)` — detecta pedidos nuevos y cancelados en sfcom, inserta en reservation_requests.
- `importarCanceladosSfcom(supabase, sfcomListings, cancelados)` — importa pedidos cancelados como leads con `source: 'sfcom_c:<origin_ref>'`, `status: 'nueva'`. Dedup por cliente+servicio sin condición de status.
- `computeExpectedStock(supabase, venueId, serviceId, { sfcomDelta, allDelta, stockMap })` — calcula stock esperado tras un delta. Acepta `stockMap` pre-cargado para evitar N GET stock-all; si es null, usa caché o hace su propio GET.
- `confirmarStockSfcom(supabase, pares)` — modal consultivo pre-save. Hace UN GET stock-all y lo pasa a cada `computeExpectedStock`.
- `loadSfcomListings(supabase)` — carga el mapeo WooCommerce→servicio/venue. Usada en páginas que no son formulario.html.
- `verificarSfcom({ reservas, availability, solicitudes })` — véase abajo.
- `mostrarModalConfirmacionSfcom(cambios)` — modal consultivo antes de PUTs. Devuelve `Promise<'sync'|'save'|'cancel'>`. Callers: `if (result === 'cancel') return` para abortar, `if (result === 'sync') await syncStockToSfcom(...)` para el PUT.
- `verificarConfirmarSfcom(supabase, dispId, productName, serviceId, excludeNames)` — véase abajo.

**`verificarSfcom({ reservas, availability, solicitudes })`**

Recibe datos pre-cargados (no hace queries Supabase propias). Devuelve `{ verificado, discrepancias[], idsMismatch[], fallos[], avisos[], error }`. Llamado desde `verificacion.js` como parte de `ejecutarVerificacion`.

Comprobaciones que realiza:
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
Módulo ES6. Panel de gestión sfcom con KPIs, solicitudes pendientes, reservas con sfcom_order_ref, y listings activos con stock. Lee `availability_with_sfcom`. No escribe en BD. Usa `ejecutarVerificacion` y `mostrarToast` de `verificacion.js`. La función local `_ejecutarVerificacionPanel(modoManual)` llama a `ejecutarVerificacion` y después actualiza la columna de stock real de la tabla de listings vía `actualizarStockDesdeVerificacion`.

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
- `modo = null`: auto-detecta según `conversation_notes`: si hay mensajes de Paula → `'seguimiento'`; si no → `'nueva'`
- `modo = 'recordatorio'`: el cliente ya recibió respuesta y no ha contestado; Claude genera seguimiento breve
- `modo = 'recuperar_lead'`: el cliente intentó reservar en sfcom pero su pedido no se completó; Claude redacta mensaje de recuperación

Los modos `'recordatorio'` y `'recuperar_lead'` **no se lanzan directamente desde los botones de solicitudes.html**. Los botones "📩 Enviar recordatorio" y "🔄 Intentar recuperar" abren modales JS directos (`abrirModalRecordatorio` / `abrirModalRecuperarSfcom` en `solicitudes.js`) que proponen un mensaje predefinido sin IA. Dentro de esos modales hay un botón "✏️ Mejorar con el asistente" que llama a `abrirAsistenteRespuesta` con el modo correspondiente, solo si Paula lo necesita.

El tipo de solicitud se detecta automáticamente: `sfcom_reserva` / `email` / `web`.

**Contexto que se envía a Claude (primer mensaje de usuario):**
```js
{
    solicitud: {
        tipo, nombre, evento, dia, personas,
        idioma,              // campo language o 'desconocido'
        comentario,          // comments sin prefijos Días:/Otros servicios:
        conversation_log,    // conversation_notes, truncado a 2000 chars si es mayor
        conversation_status, // status actual de la solicitud
        modo,                // 'nueva' | 'seguimiento' | 'recordatorio' | 'recuperar_lead'
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

Varios cambios aplicados (jun 2026):
- `panel.js` `calcularAlertas()`: `solicitudesSfcom` filtra `status === 'nueva'`; las web se dividen en `solicitudesWebNuevas` (`status === 'nueva'`) y `solicitudesWebSeguimiento` (`status === 'seguimiento_pendiente'`), mostradas en la misma alerta con etiquetas separadas ("X nuevas sin atender, Y en seguimiento pendiente"). `leadsCancelados` filtra además `status === 'nueva'` para no alertar de leads ya en `respuesta_enviada` u otro estado atendido. Adicionalmente, `solicitudesWebNuevas` y `solicitudesWebSeguimiento` excluyen registros con `source.startsWith('sfcom_c:')` (que deben aparecer solo como `leadsCancelados`, no como solicitudes web).
- `formulario.js` `cargarSolicitudes()`: `otrasActivas` usa `status === 'nueva'` (antes `status !== 'respuesta_enviada'`).

---

**`resolverCliente` en `utils.js` hace matching de nombre demasiado permisivo.**

La comparación usa `.includes()` en ambas direcciones: `dNom.includes(cn) || cn.includes(dNom)`. Si el cliente almacenado tiene un nombre corto (ej. `"LUIS"` → id `RODRIGUEZ_LUIS`), cualquier solicitud nueva con nombre `"Luis Ángel Reglero"` activa el match porque `"LUIS ANGEL REGLERO".includes("LUIS")` es `true`. Resultado: Paula ve el modal de cliente existente apuntando a la persona equivocada.

Fix parcial aplicado (jun 2026): se añadió umbral mínimo de 5 caracteres para el `.includes()` en ambas direcciones. Pendiente: la comparación sigue siendo frágil cuando dos clientes comparten parte del nombre (p.ej. `"GARCIA PEDRO"` vs `"GARCIA MARIA"`). La solución completa requeriría coincidir al menos dos palabras completas o usar distancia de edición. El match por email y teléfono no tiene este problema.

---

**✅ RESUELTO — Marcar cobro como cobrado persiste correctamente en Supabase.**

Auditado jun 2026: `toggleCobroCliente` actualiza `h.collected` y `h.collected_date` en memoria, luego llama a `persistirHitosCliente` que hace UPDATE a Supabase con esos dos campos. Si el cobro tiene `invoice_number`, el bloque dedicado en `persistirHitosCliente` ejecuta igualmente el UPDATE de `collected`/`collected_date` (línea ~1412 de `formulario.js`). El bug original de Fase 0d estaba en una versión anterior del código; ya no existe.

---

**ACLARADO — "Cobros facturados no se pueden editar" no es un bug de UI.**

`renderCobrosCliente()` muestra `amount` y `comments` como texto plano para todos los cobros, facturados o no. No hay inputs de edición para esos campos en la tabla — no se puede intentar editarlos desde la UI. El backend intencionalmente protege el importe de cobros facturados (solo permite cambiar `collected` y `collected_date`), y la UI es coherente con eso porque no ofrece input de edición para el importe.

Edge case menor: si el cobro final (`esFinal`) está facturado, muestra un `<input type="date">` para cambiar `due_date`. Si Paula lo cambia, `persistirHitosCliente` ignorará el cambio (solo actualiza `collected`/`collected_date` para cobros facturados). Hasta que recargue verá la fecha editada en UI pero no estará en Supabase. Impacto mínimo — no vale la pena fijar salvo que se detecte confusión real.

---

**✅ RESUELTO — Botón "Facturar" aparece sin recargar la página.**

Auditado jun 2026: tras el INSERT de un cobro nuevo, `formulario.js` llama a `renderCobrosCliente()` explícitamente y el id devuelto por Supabase se asigna a `h.id` (línea ~1443). El botón "Facturar" aparece en el re-render porque la condición `!yaFacturado && h.id` ya es verdadera. Hay incluso un comentario en el código que lo documenta. El bug original ya no existe.

---

**PDFs en Supabase Storage quedan huérfanos al borrar reservas o charges — diferido a Fase 10.**

Verificado jun 2026. No hay ningún `storage.from(...).remove(...)` en ningún flujo de eliminación. `proposal_path` de reservas borradas y `invoice_path` de charges borrados quedan inaccesibles en los buckets `proposals` e `invoices`. Impacto muy bajo (volumen pequeño). El fix (unas 15 líneas en `formulario.js`) y la gestión de Storage desde el panel se abordarán juntos en Fase 10. Ver §9 Fase 10 para el diseño detallado.

---

**✅ RESUELTO PARCIALMENTE (jun 2026) — Venue en el borrador de solicitudes sfcom.**

`registrarPedidosSfcom` en `formulario.js` ahora incluye `venue_id` en `proposal_draft` (extraído desde `filaByName?.venue_id ?? filaById?.venue_id ?? null`, mismo patrón que `importarCanceladosSfcom`). Solicitudes nuevas ya tendrán el venue en el borrador.

**Pendiente:** solicitudes sfcom ya existentes con `venue_id: null` en `proposal_draft`. En `_preFillBorradorSiVacio` (`solicitudes.js`), si el draft tiene líneas con `service_id` pero `venue_id: null`, auto-seleccionar el venue si `_venuesPorServicio` devuelve exactamente uno para ese servicio. No urgente — Paula puede seleccionarlo manualmente desde el select.

Relacionado con §7.3 "consolidar lógica de matching sfcom".

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

**Mejora general CSS mobile para `solicitudes.html`.**

El CSS actual de `solicitudes.html` en móvil necesita revisión. Aunque el header tiene `position: sticky` aplicado (no desaparece al hacer scroll), el layout en general tiene problemas: el selector de estado pasa a segunda o tercera fila y queda visualmente mal colocado junto a otros controles. No se ha auditado de forma exhaustiva — puede haber más zonas afectadas. Prioridad media: Paula lo usa desde el móvil con frecuencia.

Acción antes de intervenir: revisar en incógnito/caché limpia qué partes del layout están rotas, documentar capturas de pantalla de los casos concretos y abordar el CSS como una sesión dedicada. Incluye también revisar el CSS mobile del resto del panel (§7.2 deuda general de CSS mobile).

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

**✅ RESUELTO — `services.comments` eliminada de la BD.**

La columna fue eliminada con `ALTER TABLE services DROP COLUMN comments`. El `inputServicioComments` en proveedores.js ya guardaba en `availability.comments`, no en `services.comments`.

---

**✅ RESUELTO — UI de envío unificada (`mostrarOpcionesEnvio` en `utils.js`).**

Implementado como paso 0 de Fase 2. La función soporta dos modos (`tipo: 'texto' | 'pdf'`). Ver detalle completo en la tabla de exports de `utils.js` (§4). Usada por:

- `asistente.js`: `tipo='texto'` (default). Se llama cada vez que Claude completa una respuesta con `---MENSAJE_CLIENTE---`. Botones: Copiar / Enviar por correo / Enviar por WhatsApp. El primario es WhatsApp si hay teléfono.
- `propuesta.js`: `tipo='pdf'`. Se llama al abrir el diálogo (`abrirPanelPropuesta`), antes de cualquier acción. Botones: Solo PDF / PDF+correo / PDF+WhatsApp. Un clic genera el PDF y abre el canal en un solo paso.
- `factura.js`: `tipo='pdf'`. Se llama al abrir el diálogo (`abrirPanelFactura`). Mismo patrón que propuesta.
- `formulario.js` (bienvenida): `tipo='texto'`. Se llama desde `abrirModalBienvenida`. El texto ya está compuesto por `componerMensajeBienvenida`; `getTexto` lee el valor del `<textarea>` editable por Paula.

---

**✅ RESUELTO — Pestañas "Detalles del servicio" vs "Detalles del par" en `proveedores.js` (jun 2026).** El formulario de disponibilidad tiene las pestañas implementadas: `avail-panel-par` y `avail-panel-servicio` con función `_selectAvailTab(tabName)`. La pestaña activa por defecto depende de `venueActual.venue_type === 'balcon'`. Al cambiar a la pestaña no predeterminada aparece un aviso explicativo. Cada pestaña tiene un badge indicador de contenido (`badge-tab-par`, `badge-tab-servicio`). El guardado ya apuntaba a las tablas correctas en ambos casos.

---

**✅ RESUELTO — Carousel de fotos: `aspect-ratio: 16/9` aplicado (jun 2026).** `.photo-carousel-img-wrap` tiene `aspect-ratio: 16/9` en `admin.css`. El catálogo público pendiente de revisión cuando se toque ese código.

---

**Carousel de fotos: no se puede reordenar.**

`availability.photos` es un `text[]` en Supabase. El orden importa: `photos[0]` es la imagen principal en propuestas y catálogo. Actualmente solo se puede añadir (al final) y eliminar; no reordenar.

Fix: añadir un botón "⬆ Subir" en el footer del carousel junto a `🗑`. Al pulsar: `photos.splice(idx - 1, 0, photos.splice(idx, 1)[0])` → guardar con `_savePhotos`. Solo activo cuando `_photoIdx > 0`. No requiere cambios en Supabase ni en Edge Functions.

---

**CSS del panel en móvil — deuda de revisión general.**

El CSS del panel no está auditado en móvil. Zonas con problemas conocidos o sospechados: tarjetas de KPIs económicos de `panel.html`, layout de `solicitudes.html` en general (ver §7.2 nota anterior sobre solicitudes.html). No se ha hecho una revisión exhaustiva. Prioridad media: Paula usa el panel desde el móvil con frecuencia.

Acción antes de intervenir: recorrer las páginas principales en incógnito (caché limpia) en móvil, documentar capturas de pantalla de los casos concretos y abordar el CSS como una sesión dedicada.

---

### 7.3 Funcionalidades pendientes

**✅ RESUELTO jun 2026 — Botón "Verificar datos" unificado y verificación consolidada.**

`ejecutarVerificacion(supabase, opts)` en `verificacion.js` es el único punto de entrada. Tres dominios integrados: integridad de BD (`_verificarBD`), coherencia financiera (`_computarFinanciero`) y stock sfcom (`verificarSfcom`). El botón `🔍 Verificar datos` existe en todas las páginas; sfcom.html unificó su texto. Las funciones locales duplicadas de `formulario.js` y `sfcom-panel.js` se eliminaron.

Comportamiento por página: ver §4 `verificacion.js` para la tabla de opts por página. El orden `checkSfcomOrders → ejecutarVerificacion` se mantiene en `formulario.js` vía `.finally()` para que los pedidos sfcom nuevos ya estén insertados antes del check de `pendingExplains`.

---

**sfcom — leads de pedidos cancelados.** ✅ Implementado jun 2026. Ver Fase 5 §9 para el detalle completo.

**Pendiente — dedup multi-venue/multi-día:** si un mismo cliente cancela el mismo encierro en venue A y venue B (o el mismo venue en días distintos), hoy se crean dos leads por separado. Plan: detectar en la importación y fusionar `proposal_draft` en la solicitud existente, o mostrar un aviso manual. No hay urgencia hasta que ocurra en producción.

**✅ RESUELTO — Consolidar lógica de matching sfcom (jun 2026).** `resolverProductoSfcom(li, sfcomListings)` exportada desde `sfcom.js` devuelve `{ filaByName, filaById, nombreExtraido, levelToSave }`. `importarCanceladosSfcom` la usa directamente (silencioso: `filaByName ?? filaById`). `registrarPedidosSfcom` en `formulario.js` la usa y añade sus tres casos con modales de conflicto. El código duplicado de matching fue eliminado de ambas funciones.

**✅ RESUELTO — `created_at` con fecha real del pedido para sfcom confirmados (jun 2026).** Añadido `created_at: pedido.fecha || undefined` al INSERT de `registrarPedidosSfcom` en `formulario.js`. Ahora tanto confirmados como cancelados usan la fecha real del pedido sfcom.

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

**Respuesta manual a solicitudes — Paula debe poder contestar sin usar el asistente.**

Actualmente el único flujo para enviar una respuesta a un cliente desde el detalle de una solicitud es a través del asistente. Paula necesita también poder escribir la respuesta directamente, y que esa respuesta tenga exactamente el mismo tratamiento que la generada por el asistente: se guarda en el log de conversación, cambia el `status` a `respuesta_enviada`, y muestra los mismos botones de acción (Copiar / Enviar por correo / Enviar por WhatsApp) via `mostrarOpcionesEnvio`.

Diseño propuesto: añadir en el detalle de solicitud un bloque de respuesta manual que conviva con el botón de "Abrir asistente". El bloque contiene un `<textarea>` con un botón "Enviar respuesta". Al confirmar: (1) guarda la respuesta en `conversation_log` con el mismo formato que usa `_onRespuestaUsadaEnLog` en `asistente.js` (campo `role: 'assistant'`, `content: texto`), (2) llama a `_actualizarEstadoSolicitud('respuesta_enviada')`, (3) llama a `mostrarOpcionesEnvio` con `tipo: 'texto'` y el texto de la respuesta.

La función `_onRespuestaUsadaEnLog` en `asistente.js` y `mostrarOpcionesEnvio` en `utils.js` ya hacen exactamente esto — reutilizar directamente o extraer la lógica compartida a `utils.js` si hay duplicación.

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

**Auditoría de sistemas de inferencia.**

El panel tiene varios mecanismos que infieren datos (día, nivel, servicio, texto de borrador…) a partir de otras fuentes y los escriben en BD o los muestran en pantalla. Se han detectado bugs causados por cobertura incompleta de casos (ej: `extraerDia` fallaba con "Chupinazo Día 6 julio"; dedup de `importarCanceladosSfcom` fallaba al cambiar de estado una solicitud recuperada). Hay que hacer un recorrido sistemático de todos estos sistemas para documentar: qué leen, qué infieren, qué condiciones cubren, dónde y cuándo escriben el resultado, y qué pasa si la inferencia falla o produce null.

Sistemas conocidos a auditar: `extraerDia` (sfcom.js), `parsearNivel` (sfcom.js), lógica de `service_id` / `TIPO_SERVICIO_ID` en importación sfcom, `_preFillBorradorSiVacio` (solicitudes.js / asistente.js), dedup de `importarCanceladosSfcom` (sfcom.js).

---

### 7.5 Mejoras de código

**✅ RESUELTO — Asistente usa `venue_display_name` como identificador principal.**

`disponibilidadParaAsistente` en `asistente.js` incluye `venue_display_name` en cada entrada; el system prompt en `asistente-config.js` instruye a Claude a usarlo siempre. Confirmado en auditoría jun 2026.

---

**✅ RESUELTO — Asistente interpreta precios siempre por persona.**

`SYSTEM_PROMPT_ASISTENTE` tiene instrucción explícita en dos secciones (Lógica Comercial y Cómo debe ser el mensaje al cliente): cualquier precio mencionado por Paula es siempre por persona/plaza, nunca total del grupo. Confirmado en auditoría jun 2026.

---

**✅ RESUELTO — Reglas de uso de identificadores de venue/evento documentadas en §3.**

Cada lugar físico tiene hasta cinco identificadores distintos (`venues.id`, `venues.display_name`, `venues.slug`, `services.name`, `sfcom_listings.sfcom_service_name`). Las reglas de qué usar en cada contexto (BD/código, UI interna, documentos al cliente, catálogo, sfcom) están formalizadas en §3.

---

**Contexto del asistente incluye líneas del borrador ya resueltas.**

Si hay líneas con `estado: 'hecha'` o `'descartada'` y Paula abre el asistente, Claude las ve en el contexto. Las líneas `'hecha'` son útiles porque confirman qué ya tiene reserva; las `'descartada'` son menos relevantes pero no causan confusión. Fix correcto: actualizar `SYSTEM_PROMPT_ASISTENTE` en `asistente-config.js` para explicar el significado de cada valor de `estado` (`'pendiente'` = negociando, `'hecha'` = ya convertida en reserva, `'descartada'` = descartada). Filtrar `'descartada'` del contexto es opcional y de bajo impacto.

---

**✅ RESUELTO — Lógica de inferencia `level → service_id` extraída a `utils.js` (jun 2026).**

`parsearNivel(level)` y `TIPO_SERVICIO_ID` exportados desde `utils.js`. `parsearNivel` devuelve `{ tipo, day }` o `null` — solo normaliza el slug, no expande a service_ids (eso lo hace cada llamador según su contexto). Los tres sitios actualizados:

- `_inferirServiceId` en `formulario.js`: usa el `day` explícito del parámetro, nunca `p.day` — para pre-fill de dropdown necesita un ID concreto o null.
- `_preFillBorradorSiVacio` en `solicitudes.js`: igual — usa `sol.day`, no lo extrae del slug.
- `_inferirServiceIds` en `solicitudes.js`: siempre expande encierro a todos los días (para rango de precios), ignorando `p.day`.
- `expandirServiceIds` en `asistente.js`: usa su propio `day`/`meta`, con la lógica de `meta.dias`/`meta.flexible` intacta.

Comportamiento idéntico al anterior en los cuatro sitios. Si se añaden servicios nuevos, solo hay que tocar `parsearNivel` y `TIPO_SERVICIO_ID`.

---

**✅ RESUELTO — Doble `cargarSolicitudes()` al inicio de `formulario.html`.**

Se quitó la llamada incondicional de startup (jun 2026). El chain de `checkSfcomOrders` garantiza una sola llamada: si hay pedidos nuevos → `registrarPedidosSfcom` la llama; si no → se llama directamente en el `.else`; si falla → se llama en el `.catch`.

---

**✅ RESUELTO — Auto-transición `seguimiento_pendiente → respuesta_enviada` al enviar recordatorio.**

Resuelto al implementar los modales de mensaje directo (jun 2026). El modal de recordatorio (`abrirModalRecordatorio`) llama a `_onRespuestaUsadaEnLog` al pulsar cualquier botón de envío, que ya hace la transición a `respuesta_enviada` en Supabase y actualiza badge y select en el panel. El status cambia correctamente al enviar desde el modal directo, y también si Paula usa el asistente (flujo previo).

---

---

**`formulario.js` demasiado grande (~2600 líneas).**

Tres candidatos para extracción si el tamaño se convierte en problema práctico:
- `sfcom-solicitudes.js` (~300 líneas): Bloque 0 + `registrarPedidosSfcom` + modales sfcom.
- `reorganizar.js` (~200 líneas): panel de reorganización (el más autocontenido, sin estado compartido relevante).
- `cobros.js` (~300 líneas): Bloque 5 + `persistirHitosCliente` + `cargarCobrosCliente`.

No hacer hasta que el tamaño sea un problema práctico. Si se decide, empezar por `reorganizar.js`.

---

**✅ RESUELTO — `valorO` y `esVacio` en `utils.js` (jun 2026).**

`esVacio(v)` devuelve true si `v` es null, undefined o cadena que al recortar queda vacía. `valorO(v, fallback)` devuelve el valor recortado si tiene contenido, o el fallback en caso contrario — equivalente al patrón `||` pero seguro ante números y booleanos.

Aplicados en `propuesta.js` (display_name de venue, nombre/dirección/empresa del cliente, nombre del archivo PDF), `factura.js` (cabecera del PDF, NIF, dirección), y `sfcom-panel.js`. La raíz del problema (`''` guardado en BD en lugar de NULL) no se ha corregido en la capa de persistencia — se asume limpio para los campos afectados.

---

**✅ RESUELTO (jun 2026) — `assigned_venue_id` y `email_raw` — columnas eliminadas de BD y código.**

`assigned_venue_id`: nunca se escribía. `proposal_draft[].venue_id` cubre la misma función. Eliminado el campo del INSERT de `asistente.js` y del SELECT en `asistente.js`.

`email_raw`: texto crudo del email. Fix aplicado: el INSERT de `asistente.js` construye ahora `conversation_notes` inicial con la fecha y el texto raw del email como bloque `<Cliente>`. El campo `email_raw` ya era redundante. Ambas columnas dropeadas con `ALTER TABLE reservation_requests DROP COLUMN IF EXISTS email_raw; DROP COLUMN IF EXISTS assigned_venue_id;`.

**✅ RESUELTO (jun 2026) — Migración columnas legacy `level`, `service_id`, `day`, `slots`, `price_per_slot` → `proposal_draft`.**

`reservation_requests` ya no tiene columnas de primer contacto desagregadas. Toda la información de servicio/día/plazas/precio vive en `proposal_draft[0]`. Migración completada en varias fases:

- Fase 1: `construirItemBorrador()` y `extraerQualifier()` en `utils.js`.
- Fase 2: SQL backfill de todos los registros existentes hacia `proposal_draft`; DROP de columnas legacy.
- Fase 3: todos los INSERTs escriben `proposal_draft` en lugar de columnas sueltas (`main.js`, `asistente.js`, `sfcom.js`, `formulario.js`).
- Fase 4: todos los SELECTs/renders leen de `proposal_draft[0]` en lugar de columnas sueltas (`solicitudes.js`, `asistente.js`, `sfcom.js`, `sfcom-panel.js`, `formulario.js`).
- Fase 5: `ALTER TABLE reservation_requests DROP COLUMN level, service_id, day, slots, price_per_slot;`.

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

**✅ RESUELTO — `payments` migrado a columna `is_final` (jun 2026).** `ALTER TABLE payments ADD COLUMN is_final boolean DEFAULT false` + `UPDATE payments SET is_final = true WHERE comments = 'Pago final'` (30 filas migradas, conteos verificados iguales). Código actualizado en `utils.js` (`persistirPagosProveedor`) y `proveedores.js` (`cargarPagosProveedor`, `recalcularPagoFinalProveedor`, `persistirHitosProveedor`). El texto `comments: 'Pago final'` se mantiene como texto legible para Paula; la lógica usa exclusivamente `is_final`. Consistente con `charges`.

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

**✅ RESUELTO — `verificarConsistenciaFinanciera` excluye clientes con historial contable (jun 2026).** `verificacion.js` acumula los huérfanos con `tieneHistorial=true` en un array `manuales` con `continue` antes de ejecutar cualquier DELETE. Solo se borran automáticamente los que no tienen historial. Los clientes con historial aparecen en el modal con instrucción de acción manual.

**✅ RESUELTO — Race condition en numeración de facturas (`factura.js:96-112`, `propuesta.js:81-97`).**
`calcularSiguienteNumero` lee `MAX(invoice_number)` y devuelve `+1`. Aplicado en jun 2026: `ALTER TABLE charges ADD CONSTRAINT uq_charges_invoice_number UNIQUE (invoice_number)`. En PostgreSQL, NULLs no colisionan con el constraint. Si dos sesiones intentan emitir la misma factura simultáneamente, el segundo UPDATE falla con error visible para Paula. `reservations.proposal_number` no admite UNIQUE (varias reservas comparten el mismo número de propuesta). Adicionalmente, `propuesta.js` cambiado de `console.error` a `alert` para que el error sea visible.

**✅ RESUELTO — `solicitudOriginRef` ya se resetea en `limpiarFormularioReserva()` (`formulario.js:193`).**
El fix estaba aplicado: `solicitudOriginRef = null` en línea 193. El comentario en línea 2184 documenta el flujo deliberado donde se restaura tras `cargarCliente`.

**✅ RESUELTO — `sfcom-panel.js` usaba `d.stockReal` pero el objeto de discrepancia tiene `d.stockSfcom` (`sfcom-panel.js:282`).**
La columna "Stock real" en la tabla de discrepancias del panel sfcom siempre mostraba `undefined`. Corregido en jun 2026: `d.stockReal` → `d.stockSfcom`.

**ACEPTADO — `_insertarMensaje` sin protección concurrente (`solicitudes.js:132-151`).** En teoría puede haber race condition si dos writes llegan simultáneamente. En práctica es imposible: el asistente es un modal que bloquea la UI, y la edición de mensajes del log también bloquea su área. No hay dos rutas que puedan dispararse a la vez en una UI single-user con modales. No vale la pena añadir complejidad.

**✅ RESUELTO — `cambiarEstadoSeleccionadas`: DELETE de cargo sfcom usa referencia exacta (jun 2026).**

Antes el DELETE usaba `comments = 'Cobrado vía sfcom'` más filtro de importe ±0.005€. Si el mismo cliente tenía varias reservas sfcom con importe similar, podría borrar el cargo equivocado.

Solución: el comentario del cargo ahora incluye el WEB ref: `'WEB038_1102 Cobrado vía sfcom'`. El DELETE filtra por `comments = \`${r.origin_ref} Cobrado vía sfcom\`` (match exacto, sin filtro de importe). Cada cargo queda unívocamente vinculado a su pedido sfcom sin necesidad de añadir `reservation_id` a `charges`.

---

#### Alto — comportamiento incorrecto en casuísticas reales

**✅ RESUELTO — `actualizarProveedores`: venue desaparece silenciosamente (jun 2026).** Añadido `else if (plazas > 0)` cuando `!opcionExiste`: muestra un `mostrarToast` informando que el venue seleccionado no tiene capacidad para las plazas indicadas. El sistema ya protege contra guardar sin venue seleccionado.

**Sistema de inferencia sfcom — robusto en práctica, mejorable en teoría.**

Hay dos funciones de inferencia complementarias: `_inferirDesdeSfcom(level, day)` en `formulario.js` (carga de solicitudes ya guardadas en BD) y `resolverProductoSfcom(li, sfcomListings)` en `sfcom.js` (matching de pedidos crudos de la API). Ambas usan `extraerNombreProducto` y `extraerDia` de `sfcom.js` como utilidades compartidas — el código no está duplicado, está bien separado.

El punto débil documentado (matching por día solo funciona para ENCIERRO cuando hay múltiples filas con el mismo `sfcom_service_name`) no afecta en práctica: `CHUPINAZO_6`, `PROCESION_7`, `DESPEDIDA_GIGANTES_14` y `POBRE_DE_MI` tienen un único venue activo, por lo que la ambigüedad multi-fila solo aparece para ENCIERRO, que sí tiene la lógica correcta. El fallo real aparecería si dos venues vendieran el mismo servicio no-ENCIERRO, lo cual requeriría intervención de Hilario de todas formas.

Pendiente (no urgente): si en el futuro hay dos venues para un mismo servicio no-ENCIERRO, generalizar la desambiguación en `_inferirDesdeSfcom` y `resolverProductoSfcom` para que use `<TIPO>_<day>` en lugar de hardcodear `ENCIERRO_`.

**`confirmarReorganizacion`: la reversión puede fallar silenciosamente y Paula recibe un mensaje falso (`formulario.js:1740-1758`).**
Si un UPDATE falla a media operación, intenta revertir con `Promise.allSettled`. Si alguna reversión también falla, solo queda un `console.log` interno. Paula recibe "Los cambios anteriores han sido revertidos" sin que sea cierto. Fix: si la reversión falla, mostrar modal de error grave con los cambios concretos para corrección manual.

**✅ RESUELTO — `cambiarEstadoSeleccionadas`: reactivar cancelada verifica capacidad propia (jun 2026).** Antes del UPDATE llama a `getPlazasInfo` por par venue+servicio; si no hay plazas libres, muestra modal "Sin plazas disponibles" y carga la reserva en el formulario para que Paula elija otro proveedor o cancele.

**✅ RESUELTO — `cargarReservasCliente` sincroniza `todasReservas` (jun 2026).** Tras cargar las reservas del cliente, `todasReservas` se actualiza filtrando los datos del cliente cargado y reemplazándolos con los frescos de Supabase. Cubre también el caso de 0 reservas (limpia las entradas del cliente del global).

**✅ RESUELTO — `cobroFinal` negativo muestra modal (jun 2026).** En `persistirCobrosCliente` (`utils.js`), si `cobroFinal < -0.01` se abre un modal identificando el cliente y el importe, explicando la causa probable. El valor se persiste igualmente (refleja el estado real), pero Paula recibe aviso explícito.

**`reorgCambiarServicio`: cambia el venue silenciosamente al primero disponible si el actual no ofrece el nuevo servicio (`formulario.js:1530-1554`).**
En el panel de reorganización, al cambiar el servicio de una reserva, si el venue actual no ofrece ese servicio, la reserva se mueve al primer venue disponible del nuevo servicio sin pedir confirmación. Paula puede no darse cuenta.

**✅ RESUELTO — `marcarAtendida` tiene modal de confirmación (jun 2026).** `formulario.js` muestra un modal con botones "Cancelar" / "Sí, marcar como procesada" antes de actualizar el status a `convertida`.

**✅ RESUELTO — `asunto` añadido al `mailto:` del asistente (jun 2026).** Las dos llamadas a `mostrarOpcionesEnvio` en `asistente.js` pasan ahora `asunto: 'San Fermín 2026 · tu reserva'`.

**ACEPTADO — El asistente marca el mensaje como enviado al pulsar el botón de correo.** El registro en log y el cambio de status a `respuesta_enviada` ocurren al pulsar el botón, sin esperar confirmación real del envío por la API de correo. Es una limitación técnica de `mailto:` (no hay callback). Paula puede editar el log si lo envió por otro canal o no lo envió. Sin solución técnica posible con el stack actual; se documenta como comportamiento conocido.

**✅ RESUELTO — `btnEliminarServicio`: error de FK al borrar proveedor ya muestra toast (jun 2026).** El DELETE a `providers` captura el error y llama a `mostrarToast('⚠️ No se pudo eliminar el proveedor: ...')` antes de retornar. La protección previa (bloqueo si tiene sfcom_status activo o reservas activas) sigue en pie como primera línea de defensa.

**`cargarServiciosProveedor`: muestra todos los venues del proveedor mezclados, no solo el tab activo (`proveedores.js:1341`).**
Cuando un proveedor tiene varios venues (AMAYA_SABATE, PATRICIA), la tabla de servicios filtra por `provider_id` y muestra todos los venues juntos, confundiendo la jerarquía proveedor → venue → servicio.

**ACEPTADO — `btnConfirmarSfcom` con "Solo guardar" no sincroniza sfcom.** Es el comportamiento esperado: Paula ha elegido explícitamente no sincronizar. Las discrepancias se detectan en la verificación automática al recargar cualquier panel, al intentar nuevas reservas, etc. La desincronización no puede pasar desapercibida en el uso normal.

**`btnGuardarServicio` en modo edición múltiple ignora cambios en `services.name/description/comments` (`proveedores.js:1155-1192`).**
En modo edición múltiple, solo actualiza campos de `availability`. Los inputs de nombre y descripción del servicio están visibles y editables pero sus cambios se descartan al guardar, sin aviso.

**Asistente múltiple no valida `service_id` duplicado entre filas antes de insertar (`proveedores.js:2216-2293`).**
Si dos filas del bulk insert tienen el mismo `serviceId`, colisionan con UNIQUE(venue_id, service_id) en `availability`. El código muestra `alert` con el error de BD pero no previene la colisión.

**✅ RESUELTO — `syncStockToSfcom` avisa tanto de sobrereserva como de error de lectura (jun 2026).** Se añadió la función helper `_syncAndWarn(venueId, servicioId)` en `formulario.js` que sustituye a los 5 call sites directos. Muestra toast de sobrereserva si `sr.sobrereserva`, y toast de error si `sr.ok === false` (caso antes silencioso: SELECT de reservas fallido antes del PUT). El PUT fallido sigue mostrando su propio modal dentro de `syncStockToSfcom`.

**`verificarBajaSfcom` confunde "stock 0 porque todo está vendido" con "Hilario retiró el producto" (`sfcom.js:1141-1152`).**
`gone = stock === 0 || stock === null`. Un producto vendido al 100% tiene stock 0 sin que Hilario lo haya retirado. Esto puede mostrar el botón "Confirmar baja" para un producto activo en sfcom.

**`apiFetchStockAll` devuelve `{}` silenciosamente si la respuesta de la API es inesperada (`sfcom.js:92-95`).**
`return result?.stock ?? {}`. Si la API responde con un JSON malformado o un error con status 200, devuelve objeto vacío. El consumidor ve todos los availability como `fallos` pero el error real (API rota) no se muestra.

**✅ RESUELTO — `importarCanceladosSfcom` dedup rediseñada (jun 2026).**

La dedup antigua usaba solo email+phone+nombre+service_id, por lo que un segundo cancelado del mismo cliente para distinto service/venue/día quedaba también descartado.

Nueva lógica (sfcom.js): pre-fetch único de `leadsExistentes` antes del bucle. Por cada pedido, busca lead existente con mismo cliente + mismo service_id + mismo venue_id + mismo day. Si existe:
- Mismas plazas → skip (exacto).
- Plazas distintas → si este pedido es más reciente (por `pedido.fecha`), actualiza slots + price_per_slot + proposal_draft del lead existente; si es más antiguo, skip.
- Si service/venue/day difieren → no es duplicado, se crea lead nuevo.

Eliminado el query per-iteration; ahora es O(1) contra array en memoria.

**✅ RESUELTO — `---BORRADOR---` JSON inválido muestra toast (jun 2026).** El `catch` en `asistente.js` llama a `mostrarToast` avisando que el borrador no se actualizó pero el texto del mensaje sí es correcto. El `console.warn` se mantiene para diagnóstico.

**ACEPTADO — Tres paneles cargan datos sfcom de formas distintas.** `formulario.js` hace una query directa a `sfcom_listings` (solo 4 campos para matching). `proveedores.js` hace dos queries y las mezcla en memoria (necesita también `sfcom_slots_listed`, `sfcom_status`, `sfcom_public_price`). `sfcom-panel.js` usa la vista `availability_with_sfcom`. No hay inconsistencias visibles para Paula: cada panel carga lo que necesita y los datos son los mismos en todas las rutas. Riesgo: si se añade una columna a `sfcom_listings`, hay que editarlo en tres sitios. Se consolidará si/cuando se refactorice la carga de datos sfcom.

**`idsMismatch` en verificarSfcom es código muerto en la práctica.** `varNombreMap` siempre queda vacío porque sf-api-paula.php no expone un endpoint de nombres de variaciones. Se mantiene la estructura por si Hilario añade ese endpoint en el futuro, pero `idsMismatch[]` nunca se rellena. Documentado explícitamente en el código.

**El sort de "Cobrado/Pagado" en `tablas.js` ordena por emoji — resultado confuso (`tablas.js:253-256`).**
`valorCelda` para esa columna devuelve strings como "✅ 2026-07-06", "❌ Vencido", "⏳ No". `localeCompare` los ordena alfabéticamente por el emoji inicial, no agrupando cobrados vs pendientes de forma útil. Fix: usar el raw value booleano para el sort y formatear solo en display.

**`persistirCobrosCliente` lanza `alert()` síncrono bloqueante en flujo destructivo (`utils.js:188`).**
Cuando el hito final ya está facturado y hay un cambio, dispara `alert()` bloqueante. Esta función se llama desde múltiples contextos sin que el caller pueda reaccionar al resultado. Fix: sustituir por modal informativo y devolver un resultado al caller.

**`sfcomDelta` incorrecto en el modal pre-save para solicitudes no-sfcom (`formulario.js:~1227`).**
`sfcomDelta: solicitudOriginRef ? plazas : 0` debería ser `solicitudOriginRef?.startsWith('WEB') ? plazas : 0`. Para solicitudes web o email cuyo `origin_ref` es un UUID (no empieza por `WEB`), `sfcomDelta` toma el valor de las plazas en lugar de 0. El modal `confirmarStockSfcom` muestra un stock esperado incorrecto, como si la reserva fuera a descontar stock de sfcom cuando no lo hará. La sincronización real (`syncStockToSfcom`) es correcta porque lee de BD con `origin_ref LIKE 'WEB%'`, pero Paula ve un dato engañoso antes de confirmar.

**✅ RESUELTO — Ver nota en `syncStockToSfcom` avisa tanto de sobrereserva como de error de lectura (jun 2026), arriba.**

---

#### Medio — edge cases que ocurrirán con el tiempo

**✅ RESUELTO — `_preFillBorradorSiVacio` usa `await` en el update a Supabase (jun 2026).** Añadido `await` al `supabase.from('reservation_requests').update(...)` en `solicitudes.js:865`.

**✅ RESUELTO — `_renderBorrador`: `rebind()` preserva el foco de inputs numéricos.**
Antes de re-renderizar, guarda el valor del input activo (`.bor-slots`/`.bor-price`) en `draft` y restaura el foco después del re-render.

**✅ DECISIÓN — `session_context` es un log histórico append-only (`solicitudes.js:1169-1178`).**
Cada edición de Paula genera un INSERT deliberado. Se lee con `ORDER BY created_at DESC LIMIT 1`. La tabla crece, pero esto es intencionado: permite revisar en el futuro qué contexto tenía Paula en cada momento de la temporada. No se hará UPSERT ni purga de versiones antiguas.

**✅ RESUELTO — Paula puede editar mensajes de cualquier fecha.**
Eliminada la condición `isToday`. El botón de edición aparece en todos los mensajes de Paula (no en los del cliente).

**✅ RESUELTO — `_onBorradorActualizado` actualiza el DOM aunque la solicitud no esté en los arrays.**
Si `sol` es `undefined` pero la solicitud está abierta (`solicitudActual`), se actualiza `solicitudActual.proposal_draft` directamente y se re-renderiza el borrador.

**Race condition por `setTimeout(50ms/100ms/150ms)` para sincronizar selects (`formulario.js:601-606`, `2044-2059`).**
Se usan delays hardcodeados para esperar a que un `dispatchEvent` popule las opciones del siguiente select. En dispositivos lentos, el timeout puede agotarse antes de que el listener async haya corrido. Fix: hacer `actualizarProveedores` retornar una Promise y encadenar con `await`.

**✅ RESUELTO — `togglePagoProvCobrado` usa modal propio para la fecha de pago.**
Reemplazado `prompt()` por `_pedirFechaPago()`: modal `crearModal` con input de texto + Enter/Cancelar/Confirmar. Coherente con el resto del panel.

**`_savePhotos` sobreescribe el array entero — race condition si dos tabs editan (`proveedores.js:144-156`).**
Add/remove de foto siempre escribe el array completo en BD. Si Paula tiene el panel en dos tabs y ambas editan fotos del mismo servicio, gana el último en guardar.

**Pérdida de foco y scroll en el panel — patrón general.**

Hay varios sitios donde la UI pierde el foco visual o la posición de scroll tras una acción:

- **Input de ID en asistente múltiple** (`proveedores.js`): `input.value = normalizarId(input.value)` en el evento `input` reemplaza el valor completo → cursor salta al final al escribir en el medio. Fix: guardar `selectionStart` antes y restaurar con `setSelectionRange` después (el mismo patrón ya aplicado en los inputs de ID de proveedor/venue/servicio en las líneas ~528 y ~919).
- **Tablas del panel de control** (`panel.js`): al hacer clic en una fila (seleccionar un proveedor o evento), la tabla se filtra y se acorta. El foco de la página queda en la posición original (parte baja de la tabla completa), no en la tabla filtrada resultante. Paula necesita hacer scroll manualmente para ver el resultado. Fix: `element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })` tras el re-render.

Ambos son de impacto medio/bajo. Abordar juntos cuando se toque cada archivo.

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

**`mostrarSugerenciasCliente` no limpia `inputAddress` ni `inputNif` al cambiar de cliente (`formulario.js:~127`).**
Al seleccionar un cliente del autocomplete, se cargan `name`, `company`, `phone` y `email`, pero `inputAddress` e `inputNif` retienen el valor del cliente anterior. Si Paula modifica cualquier campo, el autosave escribe esos valores residuales en Supabase. Fix: añadir `inputAddress.value = cliente.address ?? ''` e `inputNif.value = cliente.nif ?? ''` en el bloque de carga de datos del cliente en `mostrarSugerenciasCliente`.

**`toggleCobroCliente` acepta fechas sin validación de formato (`formulario.js:~1598`).**
Usa `prompt()` nativo para recoger la fecha y envía el valor directamente a Supabase como `collected_date`. Si el formato no es `YYYY-MM-DD`, PostgreSQL rechaza el UPDATE con un error de tipo de dato; Paula recibe el mensaje crudo de la BD en lugar de una validación clara. Fix coherente con el resto del panel: sustituir `prompt()` por un modal con `<input type="date">`, igual que ya se hizo en `togglePagoProvCobrado`.

**`_computarFinanciero` muestra `"SFCOM"` como ID de cliente en el modal de inconsistencias financieras sin explicación (`verificacion.js`).**
Cuando hay desajuste entre cobros con `comments = 'Cobrado vía sfcom'` y el total de reservas WEB del cliente, la tabla del modal muestra el literal `SFCOM` en la columna "Cliente". Paula puede confundirlo con un ID de cliente real o no entender a qué se refiere. Fix: cambiar el texto a `"Canal sfcom (WooCommerce)"` y añadir una nota explicativa en esa sección del modal.

**Sin detección de sesión expirada — los errores de autorización se presentan como errores de datos (`auth.js`).**
`requireAuth()` solo verifica la sesión al cargar la página. Si la sesión expira durante el uso (token caducado, refresh fallido), las operaciones de Supabase devuelven error 401, que el JS trata igual que cualquier error inesperado. Paula no recibe ningún aviso de "sesión expirada, recarga la página". Fix: interceptar errores 401 en un wrapper centralizado de llamadas a Supabase y mostrar un toast o modal claro con botón de recarga.

**`persistirPagosProveedor` actualiza el importe del hito final pero no resetea `paid` ni `paid_date` si ya estaba marcado como pagado (`utils.js:~288`).**
Si un hito de pago final fue marcado `paid: true` y luego una reserva nueva o eliminada cambia el importe calculado, el UPSERT actualiza `amount` pero deja `paid: true` y `paid_date` intactos. El hito queda marcado como "pagado" por el importe original aunque el importe en BD haya cambiado. El dinero real pagado y el importe registrado quedan desincronizados sin ningún aviso para Paula.

---

#### Bajo — pulido y consistencia

**HTML de `_renderItem` no escapa `client_name`, `level`, `service_id` (`solicitudes.js:349-383`).**
Son campos de entrada externa (formulario web, sfcom). Si contuvieran `<`, `&` o comillas, el HTML quedaría roto o con XSS potencial.

**`aplicarFiltro` en `tablas.js` inyecta el nombre de columna sin escape en `onclick=` inline (`tablas.js:298`).**
Los nombres de columna actuales son seguros, pero si en el futuro se añade una columna con comilla simple en el nombre, el HTML se corrompe.

**El nombre del archivo de export en `tablas.js` usa extensión `.csv` aunque se genera `.xlsx` (`tablas.js:356-357`).**
`exportTable(..., '${tablaActual}.csv')` y `utils.exportTable` reemplaza la extensión por `.xlsx`. Discrepancia que confunde al leer el código.

**✅ RESUELTO — `execCommand('copy')` sustituido por `navigator.clipboard.writeText()` en los 4 lugares de `sfcom.js`.**

**El logo de propuesta y las imágenes de vista previa se re-fetchean en cada apertura del panel, sin caché (`propuesta.js:230-241`).**
Para propuestas con 5+ servicios con imagen, hay 5+ fetches en paralelo en cada apertura.

**Los errores de Supabase solo van a `console.error` — Paula no sabe que ocurrieron sin abrir DevTools.**
No hay reporting central ni toast de error genérico para operaciones secundarias.

**✅ RESUELTO — Textos "San Fermín 2026" hardcodeados sustituidos por `anioTemporada()` (jun 2026).**
`anioTemporada()` en `utils.js`: devuelve el año actual de enero a julio, el año siguiente de agosto a diciembre (cutoff 1 ago). Aplicado en `propuesta.js` (3 lugares), `factura.js` (2 lugares, incluido el bloque PDF), `asistente.js` (asunto de email, 2 lugares). Las fechas "6-14 de julio" se dejan hardcodeadas — son las fechas de San Fermín y nunca cambian.

**`window.*` global handlers (sortReservasCliente, facturarHito, etc.) pueden colisionar entre módulos en un refactor futuro.**
El patrón `onclick=` inline con funciones en `window` es propenso a colisiones silenciosas si dos módulos definen el mismo nombre.

**Uso mixto de `overlay.close()` y `overlay.remove()` para cerrar modales — trampa para futuras extensiones (`modal.js`).**
`crearModal` registra `dialog.addEventListener('close', () => dialog.remove())`: el evento `close` se dispara al llamar `overlay.close()` (método nativo de `<dialog>`). Sin embargo, varios callers del panel llaman directamente a `overlay.remove()`, que no dispara el evento `close`. Si en el futuro se añade lógica en ese listener (limpieza de estado, analytics), los usos directos de `.remove()` la saltarán silenciosamente. Fix: unificar todos los callers para usar siempre `overlay.close()` y dejar que el listener gestione el `remove`.

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
| 6d | ✅ Completa | Bugs §7.9 (segunda tanda): venue toast ✅ · sync todasReservas ✅ · cobro negativo modal ✅ · borrador JSON toast ✅ · sobrereserva toast ✅ · matching sfcom consolidado (resolverProductoSfcom) ✅ |
| 7 | ✅ Completa | Mejoras de propuestas: display_name ✅ · fallback descripción ✅ · fotos 16:9 ✅ · modos Compacto/Completo ✅ |
| 8 | ✅ Completa | Facturación canal sfcom |
| 8b | ✅ Completa | Fix sfcom: WEB ref en charges + corrección datos R0103/R0104 |
| 9 | ✅ Completa | Refactors y cierre (inferencia level→service_id ✅ · reglas nombres ✅ · caché sfcom aceptada ✅) |
| 9b | ✅ Completa | Mejoras asistente + fixes arquitectura web form + Edge Function notificar-solicitud |
| 9c | ✅ Completa | Migración services.id: text PK → integer + service_code |
| 10 | 🔲 Pendiente | Tablas: edición directa + gestión Storage + eliminar cliente sin reservas + limpieza PDFs huérfanos |

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
| 9 | `assistant_logs` sin RLS | Habilitar RLS en Supabase Dashboard | ✅ Aplicado jun 2026 |
| 10 | 55 servicios en `services` | ✅ No es deuda — todos los servicios son voluntarios o necesarios |

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
6. ✅ **Asistente de bienvenidas en lote** (jun 2026) — alerta en `panel.html` + modal de selección en `panel.js` (`_abrirModalSeleccionBienvenidas`) + cola en `formulario.js` (`_initBloqueColaBienvenidas`, `_renderTablaColaBienvenidas`). Ver detalle completo en §4 `formulario.js`.

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
- `reservation_requests.assigned_venue_id → venues` (ON DELETE SET NULL) — eliminado en jun 2026, columna dropeada.

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
7. ✅ **Formato de `service_name` en borrador** — el campo es descriptivo, no clave. Las diferencias de formato entre módulos son intencionales. Sin deuda pendiente.
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
comments    = '${origin_ref} Cobrado vía sfcom'  (ej: 'WEB038_1102 Cobrado vía sfcom')
is_final    = false
```
Identificador: `comments` incluye el WEB ref de la reserva (`'WEB038_1102 Cobrado vía sfcom'`). El vínculo entre cargo y reserva es exacto: el DELETE de cancelación filtra por `comments = '${r.origin_ref} Cobrado vía sfcom'` sin necesidad de comparar importes. No hay FK directa a `reservations` (la tabla `charges` no tiene `reservation_id`).

**Migración de datos (jun 2026):** los 24 cargos existentes con `comments = 'Cobrado vía sfcom'` (creados antes de este cambio) fueron actualizados al nuevo formato mediante SQL:
```sql
UPDATE charges c
SET comments = (
    SELECT r.origin_ref || ' Cobrado vía sfcom'
    FROM reservations r
    WHERE r.client_id = c.client_id
      AND r.total_amount = c.amount
      AND r.origin_ref LIKE 'WEB%'
    ORDER BY r.id DESC
    LIMIT 1
)
WHERE c.comments = 'Cobrado vía sfcom';
```
Todos los matches fueron únicos (sin ambigüedad). Se verificó que los 24 registros quedaron con el formato correcto.

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
        comments:       `${solicitudOriginRef} Cobrado vía sfcom`,
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
            .eq('comments', `${r.origin_ref} Cobrado vía sfcom`)
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
3. DELETE del `charges` con `comments = '${r.origin_ref} Cobrado vía sfcom'` (match exacto por WEB ref).
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

**2. ✅ RESUELTO — La cancelación usa referencia exacta (jun 2026).** El comentario del cargo incluye el WEB ref: `'WEB038_1102 Cobrado vía sfcom'`. El DELETE filtra por `comments = \`${r.origin_ref} Cobrado vía sfcom\`` sin filtro de importe. Cada cancelación borra exactamente el cargo del pedido cancelado, aunque el cliente tenga otras reservas sfcom al mismo precio.

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

---

### Fase 8b — ✅ Fix sfcom: WEB ref en charges + corrección datos R0103/R0104 (jun 2026)

**Archivos modificados:** `admin/js/formulario.js`.

**Problema 1 — Conversión multi-línea perdía `origin_ref` a partir de la segunda reserva.**

`limpiarFormularioReserva()` resetea `solicitudOriginRef = null`. Al cargar la segunda línea de un borrador sfcom multi-línea, `_cargarLineaEnBloque2` llamaba `limpiarFormularioReserva()` sin restaurar el ref, y en `_onLineaGuardada` se asignaba `solicitudOriginRef = _solicitudConversionId` (el UUID de la solicitud) en lugar del WEB ref.

Fix: nueva variable de módulo `_solicitudWEBRef` inicializada en `_initBloqueConversion(solicitudId, webRef, draft, nombreCliente)` con el `data.source` de la solicitud. Se restaura en `_cargarLineaEnBloque2`, en el handler de "Descartar" y en `_onLineaGuardada`. Ver detalle en §4 bloque de conversión.

**Problema 2 — Single-line desde URL sobreescribía el WEB ref con UUID.**

`cargarDesdeSolicitud` ya dejaba `solicitudOriginRef` con el WEB ref correcto para solicitudes sfcom. Pero el call site posterior hacía `if (!_modoConversionActivo) solicitudOriginRef = sol.id`, sobreescribiéndolo con el UUID de la solicitud. Fix: condición añadida: `if (!_modoConversionActivo && !solicitudOriginRef) solicitudOriginRef = sol.id`.

**Cambio de formato en `charges.comments` (relacionado):**

El comentario del cargo sfcom ahora incluye el WEB ref: `'WEB038_1102 Cobrado vía sfcom'` en lugar de `'Cobrado vía sfcom'`. Esto permite el DELETE de cancelación por `comments` exacto sin comparar importes. Ver detalle completo en §8 Fase 8 "Capa A" y "Limitación 2".

**Corrección de datos en BD (ejecutada manualmente, no repetir):**

- `UPDATE reservations SET origin_ref = 'WEB038_1102' WHERE id = 'R0104'` — R0104 tenía `origin_ref = null` porque fue creada antes de que existiera el flujo de `origin_ref`.
- INSERT manual del cargo sfcom de R0104 (JORDI_RUTLLAN, 217.40€, ya cobrado).
- DELETE del cobro final incorrecto de JORDI_RUTLLAN (id=231, 217.40€ calculado antes de insertar el cargo retroactivo).
- Migración de los 24 charges existentes al nuevo formato `'WEBxxx_yyy Cobrado vía sfcom'` (SQL documentado en "Capa A" de Fase 8).

---

### Fase 9 — ✅ Refactors y cierre (jun 2026)

- ✅ **Inferencia `level → service_id`:** `parsearNivel` y `TIPO_SERVICIO_ID` ya estaban en `utils.js` desde Fase 4. Matching de producto sfcom consolidado en `resolverProductoSfcom` (Fase 6d). Todos los módulos consumen funciones compartidas.
- ✅ **Reglas de nombres venue/evento** documentadas en §3.
- ✅ **Caché sfcom granularidad:** verificada y aceptada. Ya es por item (`productId:variationId`) via `_stockCache` (Map). Se invalida tras cada PUT. No requiere cambios.
- ✅ **Bugs §7.9 segunda tanda** (Fase 6d): resueltos 5 bugs de §7.9 "Alto" + consolidación matching sfcom.
- 🔲 **Split de `formulario.js`** — diferido conscientemente. Hacer solo si el tamaño se convierte en problema práctico.
- ⬇️ **Tablas.js edición + Storage + eliminar cliente + PDFs huérfanos** → movido a **Fase 10** (sesión específica de tablas.js).

---

### Fase 9b — ✅ Mejoras asistente + fixes arquitectura web form + Edge Function (jun 2026)

**Archivos modificados:** `admin/js/asistente.js`, `admin/js/asistente-config.js`, `admin/js/solicitudes.js`, `admin/js/panel.js`, `admin/formulario.html`, `js/main.js`. Edge Function `notificar-solicitud` (Supabase Dashboard, no en git).

---

**1. Modal "Nueva consulta" en el asistente — mejoras visuales y funcionales**

`_renderBorradorModal()` y `_bindBorrador()` en `asistente.js`:
- Campos de cliente en grid de 4 columnas (`2fr 2fr 2fr 60px`) en lugar de la clase `form-grid`. Más compacto en una sola fila.
- Opciones de idioma reducidas a código (`es`, `en`, `fr`, `it`, `de`, `…`) sin texto expandido.
- Añadidas columnas **Venue** (`.mn-venue`, input texto) y **€/pax** (`.mn-price`, input número) a la tabla del borrador.
- `_leerDOMEnDraft()` actualizado para leer `venue_display_name` y `price` de los nuevos inputs.
- `_rellenarDesdeParseado()` usa `parsed.venue_hint` y `parsed.price_hint` para prerellenar los nuevos campos.
- Reducidos márgenes y alturas de fila para que el modal sea más compacto.

---

**2. `SYSTEM_PROMPT_PARSING` en `asistente-config.js` — hilos de conversación y nuevos campos**

- JSON de salida ampliado: `venue_hint` (string o null) y `price_hint` (número o null).
- Nueva sección **"CUANDO EL TEXTO ES UN HILO DE CONVERSACIÓN"**: instrucciones para extraer datos de mensajes de ambos lados; `venue_hint` de los mensajes de Paula; `price_hint` de los precios que menciona Paula; idioma solo del lado del cliente; si el cliente acepta la propuesta de Paula, esos servicios son los principales.

---

**3. Fix alertas panel.js — leads sfcom cancelados con status ya atendido**

`calcularAlertas()` en `panel.js`:
- `leadsCancelados` ahora filtra `s.status === 'nueva'`. Antes mostraba alerta para leads ya en `respuesta_enviada` u otros estados atendidos.
- `solicitudesWebNuevas` y `solicitudesWebSeguimiento` excluyen registros con `source.startsWith('sfcom_c:')` para evitar que leads cancelados cuenten como solicitudes web.

---

**4. Fix fecha en listado de solicitudes — `updated_at` con fallback a `created_at`**

`solicitudes.js`:
- `_renderFila()`: fecha muestra `updated_at ?? created_at` en formato `dd/mm`.
- `mostrarDetalle()`: fecha completa usa igualmente `updated_at ?? created_at`.

---

**5. Fix flash de `bloque-solicitudes` en `formulario.html`**

Añadido `style="display:none"` directamente en el elemento HTML del `#bloque-solicitudes`. Antes se ocultaba vía JS tras carga asíncrona, causando un flash visible al cargar la página.

---

**6. Fix arquitectura: comentario del formulario web en `conversation_notes`**

`js/main.js` — INSERT en `reservation_requests`:
- El comentario libre del formulario (`inputComents.value`) ahora se incluye como campo `comment` dentro del JSON de `conversation_notes` (`rawData`).
- Eliminado el campo `comments` del INSERT: ya no se escribe la columna `comments` desde la web.

`solicitudes.js` — `_procesarWebFormsSinProcesar()`:
- Lee `rawData.comment || sol.comments` (fallback a la columna legacy para registros anteriores a jun 2026).
- La limpieza de prefijos `Días:` / `Otros servicios:` aplicada antes del fallback.

La columna `comments` sigue existiendo en BD como legacy; no se dropea hasta Fase 10.

---

**7. Edge Function `notificar-solicitud` — reescritura completa (Supabase Dashboard)**

La función anterior leía columnas legacy (`level`, `slots`, `day`, `comments`) que ya no existen. Reescrita para:
- Leer `conversation_notes` (formato JSON para web; formato log para manual/sfcom) y `proposal_draft[0]` (para entradas sfcom/manual ya procesadas).
- **Filtro de origen:** si `source` no es null/vacío y no es un formulario web (`source === 'email'`, `source LIKE 'WEB%'`, `source LIKE 'sfcom_c:%'`), retorna inmediatamente sin enviar email. Solo el formulario público dispara notificación.
- Lógica de extracción: si `conversation_notes` empieza por `{` → parsea JSON y extrae `slug`, `day`, `slots`, `comment`; si no → extrae mensaje del cliente del log con regex `<Cliente>`.
- Cuerpo del email limpio sin campo "Origen" (innecesario si solo llegan formularios web).

El código completo de la función está documentado en el historial de la sesión jun 2026 (no en git).

---

### Fase 9c — ✅ Bugs §7 Medio/Bajo + año dinámico (jun 2026)

**Archivos modificados:** `admin/js/utils.js`, `admin/js/propuesta.js`, `admin/js/factura.js`, `admin/js/asistente.js`, `admin/js/sfcom.js`, `admin/js/solicitudes.js`, `admin/js/proveedores.js`, `admin/js/formulario.js`.

**1. `anioTemporada()` — función utilitaria en `utils.js`**

Nueva función exportada. Cutoff: 1 de agosto. De enero a julio devuelve el año actual; de agosto a diciembre devuelve el año siguiente. Aplicada en:
- `propuesta.js`: cabecera de tabla HTML, bloque completo, encabezado PDF (3 puntos).
- `factura.js`: nota HTML del adelanto y nota PDF (2 puntos).
- `asistente.js`: asunto del email/WhatsApp que se ofrece al enviar respuesta (2 puntos).

Las fechas "6–14 de julio" se dejan hardcodeadas — son las fechas de San Fermín y no varían.

**2. Bugs §7 Medio resueltos (ver marcas ✅ en §7.9)**

- **`rebind()` en `_renderBorrador`** — antes de re-renderizar, guarda el valor del input activo (`.bor-slots` o `.bor-price`) en `draft` y restaura el foco tras el re-render. Paula ya no pierde lo que está escribiendo al cambiar servicio o venue en la misma fila.
- **Edición de mensajes sin restricción de fecha** — eliminada la condición `isToday`. El botón de edición aparece en todos los mensajes de Paula, no solo los del día.
- **`_onBorradorActualizado` sin fallo silencioso** — si la solicitud no está en `_solicitudesActuales` ni en `_solicitudesCerradas`, se actualiza `solicitudActual` directamente y se re-renderiza el borrador.
- **`togglePagoProvCobrado` con modal propio** — eliminado `prompt()`. Nueva función `_pedirFechaPago()` abre modal con input de texto, Enter y botones Cancelar/Confirmar. Compatible con iOS/móvil.
- **`execCommand('copy')` → `navigator.clipboard.writeText()`** en los 4 botones de copia de `sfcom.js`.

**3. Bugs §7 Alto resueltos en sesión anterior (misma sesión, antes de compactación)**

- `resolverProductoSfcom` exportado desde `sfcom.js` — consolida la lógica de matching duplicada entre `importarCanceladosSfcom` y `registrarPedidosSfcom`.
- `syncStockToSfcom` devuelve `{ sobrereserva, serviceName }` — callers en `formulario.js` muestran toast si hay sobrereserva.
- `actualizarProveedores` — toast cuando el proveedor activo queda fuera del filtro de capacidad.
- `cargarReservasCliente` — sincroniza `todasReservas` tras cargar reservas del cliente.
- `persistirCobrosCliente` — modal de aviso cuando `cobroFinal` resulta negativo.
- `asistente.js` — toast cuando el JSON de `---BORRADOR---` no es válido.

**4. `assistant_logs` sin RLS — ✅ RESUELTO (jun 2026)**

RLS habilitado en Supabase Dashboard.

---

### Fase 9c — ✅ Migración services.id: text PK → integer + service_code (jun 2026)

**SQL:** `supabase/sql/migration_fase1_services_pk.sql` (ejecutar en Supabase SQL Editor antes de activar los JS).
**Referencia pre-migración:** `supabase/sql/views_pre_migration.sql`.

**Archivos JS modificados:** `utils.js`, `formulario.js`, `proveedores.js`, `solicitudes.js`, `asistente.js`, `sfcom.js`, `sfcom-panel.js`, `verificacion.js`, `panel.js`, `tablas.js`, `propuesta.js`.

**Cambios arquitecturales:**
- `services.id` pasa de text (`ENCIERRO_7`) a integer autoincremental.
- `services.service_code` (text UNIQUE NOT NULL) almacena los códigos que antes eran el PK.
- `availability.service_id` y `reservations.service_id`: FK integer en lugar de text.
- `reservation_requests.service_id` y `proposal_draft[].service_id`: integer en lugar de text (migrado por SQL JSONB UPDATE en Paso 13).
- Las 4 vistas reconstruidas. `service_availability` expone `service_code AS service_id` (text) para el frontend público — cero cambios en el front.
- `availability_panel` añade la columna `service_code` para que el panel admin acceda al código sin JOIN adicional.

**Reglas de uso JS:**
- `service_id` (integer) solo para queries Supabase (`.eq`, `.filter`, comparaciones con `r.service_id`).
- `service_code` (text) para todo lo visible en UI, patrones regex, `TIPO_SERVICIO_ID`, `_inferirServiceId`.
- DOM selects: `opt.value = s.id` (integer → string en HTML); siempre `parseInt(select.value)` antes de comparar.
- Nuevo helper `serviceCodesToIds(codes, disponibilidad)` en `utils.js` para convertir array de códigos text a integers cuando se necesita cruzar con FK.

**Trigger `uppercase_ids`:** actualizar en Supabase Dashboard → Functions: cambiar `WHEN 'services' THEN NEW.id := UPPER(NEW.id)` por `WHEN 'services' THEN NEW.service_code := UPPER(NEW.service_code)` (ver Paso 14 del SQL).

**`tablas.js`:** columna `id` de la tabla `services` ya no tiene `renameable: true` (el PK integer es inmutable). Nueva columna `Código` expone `service_code`.

---

### Fase 10 — 🔲 Sesión de tablas: edición directa + Storage + cliente + PDFs

**Criterio de agrupación:** todo toca `tablas.js` o gestión de datos/archivos sin pasar por los flujos normales de reserva. Una sola sesión de trabajo.

**1. Edición directa en `tablas.js`**

Actualmente `tablas.js` es solo lectura (el único botón activo es ✏️ para renombrar IDs). Objetivo: editar cualquier campo de cualquier tabla directamente desde la UI.

Diseño:
- Celdas editables con doble clic o botón de lápiz por columna. Al confirmar → UPDATE a Supabase con feedback de error.
- Para campos FK (`venue_id` en `availability`, `provider_id` en `venues`, `client_id` en `reservations`, etc.): mostrar select con las opciones válidas en lugar de input libre.
- Aviso cuando el cambio tiene impacto en cascada (ej. cambiar `billing_model` en un availability con reservas activas).
- Columnas de solo lectura (campos calculados como `total_amount`, campos `id` ya cubiertos por el renombrador): mantenerlas no editables.

**2. Eliminar cliente sin reservas**

No existe flujo de borrado directo de un cliente que ya no tiene reservas activas. El workaround actual (crear reserva temporal + eliminarla) es absurdo.

Diseño:
- En `formulario.js` / `formulario.html`: botón "Eliminar cliente" visible solo cuando `reservasCliente.length === 0` y el cliente está cargado.
- Modal de confirmación que liste también si el cliente tiene `charges` o `reservation_requests` activos antes de eliminar.
- DELETE en cascada: primero `charges`, luego `reservation_requests` (donde `client_name` coincide, si aplica), luego `clients`.
- También incluible en la vista de tablas.js (fila de Clientes sin reservas → botón borrar).

**3. Gestión de Supabase Storage desde el panel**

No hay UI para ver qué hay en los buckets ni borrar archivos huérfanos.

Diseño:
- Nueva sección en `tablas.html` o pestaña separada: "Archivos".
- Lista los archivos de `proposals/` e `invoices/` con su tamaño y fecha.
- Detecta huérfanos: archivos cuya ruta no coincide con ningún `reservations.proposal_path` o `charges.invoice_path` activo.
- Botón "Eliminar huérfanos" con confirmación; botón de descarga por archivo individual.
- Lectura vía `supabase.storage.from('proposals').list()` / `.from('invoices').list()`.

**4. Limpieza de PDFs al eliminar reservas/charges**

Actualmente `eliminarSeleccionadas` en `formulario.js` borra reservas y cobros sin limpiar los PDFs en Storage.

Fix (unas 15 líneas en `formulario.js`):
- Antes del DELETE de reservas: recoger `proposal_path` de las filas a eliminar → `supabase.storage.from('proposals').remove([...paths.filter(Boolean)])`.
- En el caso `isLastReservation`: ampliar el SELECT de charges para incluir `invoice_path`; recoger los no nulos → `supabase.storage.from('invoices').remove([...paths])`.
- Errores de Storage no son bloqueantes: si el remove falla, continuar con el DELETE igualmente (el archivo es recuperable manualmente desde el Dashboard de Supabase).

---

## 10. Claridad de labels y textareas para Paula ✅ (jun 2026)

**Aplicado en `proveedores.html`, `proveedores.js` y `formulario.html`.**

**Campos "Comentarios" → "Notas internas"** (label + placeholder "Solo uso interno") en todos los campos puramente internos: proveedor, venue/balcón, disponibilidad, cliente y reserva. Deja claro que nunca llegan al cliente.

**"Descripción del venue" → dinámica según tipo** (`labelAvailDesc` con `id`). Placeholder cambiado a "Va en propuestas, confirmaciones y catálogo web" para que quede claro que es texto de cara al cliente.

**"venue" eliminado de toda la GUI de proveedores.** `_VENUE_LABELS` extendida con `desc`, `dlgTitulo`, `dlgId`, `dlgDir`, `toast` y `errorId` para los cuatro tipos (`balcon`, `barrera`, `guia`, `servicio_especial`). `_actualizarLabelsVenue` actualiza también `labelAvailDesc`. Nueva función `_actualizarLabelsDlgVenue` actualiza el diálogo de crear en tiempo real al cambiar el tipo. Toast de renombrar y mensaje de error de ID duplicado también usan el término correcto para cada tipo.

**Placeholder de `inputServicioDescription`** → "Descripción general del servicio (igual para todos los proveedores)", diferenciando claramente del campo específico del balcón.

**Pendiente de revisión futura:** campos `comments` de `panel.html`, `solicitudes.html` y `tablas.html` — aplica la misma lógica "Notas internas / Solo uso interno" cuando se trabaje en esos paneles.
