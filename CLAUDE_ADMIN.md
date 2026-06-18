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

**Bloque 4 — Reservas del cliente:** Tabla de reservas. Checkbox para editar, cancelar o eliminar en lote. Botón "Generar propuesta".

**Bloque 5 — Cobros al cliente:** Hitos de cobro. Botón de facturación por hito. Hito final (`is_final: true`) recalculado automáticamente vía `persistirCobrosCliente`.

**Orden de borrado de reservas (`eliminarSeleccionadas`):** al eliminar reservas del cliente activo, el sistema comprueba si quedan reservas con `status !== 'Cancelada'`. Si quedan → `persistirCobrosCliente` recalcula el cobro final. Si no quedan reservas activas → se eliminan todos los charges del cliente: los que no tienen `collected=true` ni `invoice_number` se borran sin preguntar; si hay alguno con historial (cobrado o facturado) se muestra un modal con **Cancelar como botón por defecto** antes de proceder. Tras limpiar charges, se ofrece opcionalmente eliminar también el cliente (en este punto ya no hay FK pendiente).

**Secuencia de carga:** `checkSfcomOrders` primero; `ejecutarVerificacion(false)` encadenado en `.finally()` para evitar race condition (verificarCoherencia lee reservation_requests y necesita que los pedidos sfcom nuevos estén ya insertados).

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

**Acceso a datos sfcom:** lecturas vía `sfcom_listings` (mezclados en memoria con `availability_panel`). Escrituras sfcom siempre a `sfcom_listings`, nunca a `availability`.

**Flujos sfcom en proveedores.js:**
- `null` → "Solicitar a SFcom" → `'pending'` (correo a Hilario) → Hilario activa → "Confirmar" → GET verificación → `'confirmed'` + sync inicial
- `'confirmed'` → "Dar de baja" → `'deactivation_pending'` (correo a Hilario) → Hilario retira → "Confirmar baja" → GET verificación → DELETE en sfcom_listings → `null`
- Mientras `sfcom_status` no sea null, el servicio no se puede eliminar.

### panel.js
Módulo ES6. Lee en paralelo: `reservations`, `availability`, `services`, `providers`, `payments`, `charges`, `reservation_requests`. Usa `availability` directamente (no la vista) porque no necesita campos sfcom.

Bloques: alertas críticas (sobrereservas, pagos/cobros vencidos, solicitudes pendientes), calendario de próximos pagos/cobros (filtrable), estado financiero con Chart.js, resumen por servicio/día. Tablas con sort por columna (4 tablas). Cobros y pagos pendientes son clicables: abren formulario.html o proveedores.html con el cliente/proveedor precargado via query params.

**Indicador de margen (`_margenIndicador`):** punto de color `●` delante del ID en las tablas de eventos y de proveedores. Verde = margen ≥ 15% del ingreso; naranja = 0–15%; rojo = pérdida; sin punto = sin actividad (ingreso y coste a 0). Ingreso = `SUM(total_amount)` reservas no canceladas; coste según `billing_model` (`capacity`: total_slots×precio, `consumption`: slots_activos×precio, `fixed`: precio si hay alguna reserva, 0 si no). Las filas padre (evento o venue agregado) muestran el margen del conjunto, no el peor hijo. Implementado en `calcularEventos`/`calcularProveedores`; `filaEvento`/`filaDetalleProveedor`/`filaProveedor`/`filaDetalleServicio`.

**Cashflow dinámico:** el gráfico de cashflow filtra pagos/cobros a la temporada actual y usa fechas dinámicas (`_anioTemporada`, `_seasonStart`, `_seasonEnd`) en lugar de años hardcodeados.

**Verificación de consistencia financiera (`verificarConsistenciaFinanciera`):** se ejecuta al cargar el panel, usando los datos ya cargados en memoria (sin consulta adicional a Supabase). Comprueba dos dimensiones:

- **Por cliente:** `SUM(charges.amount)` debe coincidir con `SUM(reservations.total_amount)` para reservas no canceladas. Detecta: (a) cobros huérfanos — cliente con charges pero sin reservas activas; (b) cobro final desajustado — diferencia > €0.01 entre capas.
- **Por proveedor:** `SUM(payments.amount)` debe coincidir con el coste teórico según `billing_model`. Para cada fila de `availability`, calcula: `capacity` → `total_slots × price_per_slot`; `consumption` → `slots_activos × price_per_slot`; `fixed` → `price_per_slot` si hay alguna reserva activa, 0 si no. Usa la tabla `venues` (cargada en `Promise.all`) para resolver `venue_id → provider_id`.

**Output:** si todo cuadra → toast verde (`mostrarToast`). Si hay discrepancias → modal directo (`crearModal`, sin paso intermedio por alerta en el DOM) con tabla de errores por tipo (Cliente / Proveedor), ID, importes en BD, importe teórico y diferencia. El botón "Corregir automáticamente" en el modal ejecuta: para huérfanos → `supabase.from('charges').delete()` por `client_id`; para desajustados → `persistirCobrosCliente`; para proveedores → `persistirPagosProveedor`. Si algún cliente tiene cobros con historial (`collected=true` o `invoice_number IS NOT NULL`), se muestra un aviso en el modal antes de confirmar la corrección.

### sfcom.js
Módulo ES6. Toda la comunicación con tienda.sanfermin.com a través de la Edge Function `sfcom-bridge` (proxy transparente que reenvía server-to-server, resuelve CORS). El JS nunca llama directamente a sf-api-paula.php.

**Arquitectura:** `supabase.functions.invoke('sfcom-bridge', { body: { endpoint, method, payload } })`. La clave `X-Paula-Key` está en Supabase Vault (`SFCOM_API_KEY`), nunca en el código JS del cliente. Timeout de 12 segundos en la Edge Function.

**Endpoints usados:**
- `GET stock-all` → `{ updated_at, count, stock: { "id": qty, ... } }`. Devuelve todo el stock en una llamada. Clave es el ID como string (variation_id para variaciones, product_id para simples). **Siempre usar para leer stock.**
- `PUT products/{id}` / `PUT products/{id}/variations/{var_id}` → modifica stock. Solo acepta `stock_quantity`. Rate limit: 20 req/min, máx 2 simultáneas.
- `GET products`, `GET products/{id}/variations` → con rate limit. Solo cuando se necesitan nombres (verificación manual, picker de confirmación).
- `GET orders?status=completed&after=<ISO>&per_page=N` → lista de pedidos.

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
- `syncStockToSfcom(supabase, proveedorId, servicioId)` — hace PUT si `sfcom_status === 'confirmed'`. Silencioso en éxito, modal de error en fallo. Llamar siempre después de cualquier operación que cambie reservas activas.
- `checkAvailabilityBeforeSave(supabase, proveedorId, servicioId, plazas)` — verifica antes de guardar reserva nueva. No bloquea si el GET de sfcom falla.
- `checkSfcomOrders(supabase)` — detecta pedidos nuevos, inserta en reservation_requests.
- `verificarCoherencia(supabase)` — verifica integridad FK, sobrereservas y stock sfcom. Devuelve `{ ok, errores[], avisos[], sfcom: { verificado, discrepancias[], idsMismatch[], fallos[] } }`.
- `mostrarModalConfirmacionSfcom(cambios)` — modal consultivo antes de PUTs. Devuelve `Promise<'sync'|'save'|'cancel'>`. Callers usan: `if (result === 'cancel') return` para abortar, `if (result === 'sync') await syncStockToSfcom(...)` para el PUT.
- `verificarConfirmarSfcom(supabase, dispId, productName, serviceId, excludeNames)` — busca por nombre en sfcom y confirma entrada en sfcom_listings.

**Detección de `idsMismatch`** (solo en verificación manual): compara día del nombre de variación con día esperado según service_id. Requiere GET a `products/{id}/variations` (con rate limit); solo se ejecuta cuando `checkVariationNames = true` (botón "Verificar datos" y sfcom-panel.js). La verificación automática al cargar no detecta idsMismatch.

**Discrepancias `pendingExplains`:** cuando sfcom muestra más stock del esperado y el gap está completamente cubierto por solicitudes sfcom pendientes de procesar, la discrepancia no es un error. No aparece en el modal con botón de sincronización; el "Sincronizar todos" las ignora.

### sfcom-panel.js
Módulo ES6. Panel de gestión sfcom con KPIs, solicitudes pendientes, reservas con sfcom_order_ref, y listings activos con stock. Lee `availability_with_sfcom`. No escribe en BD. Reutiliza `verificarCoherencia`, `mostrarModalVerificacion` y `mostrarModalPreCorreccion` de `verificacion.js`.

KPIs incluyen: total neto de ventas sfcom, coste de proveedores, y margen neto (cruza cada reserva sfcom activa con disponibilidad para calcular coste unitario según billing_model).

### factura.js
Módulo ES6, importado por formulario.js. `initFacturacion(supabase)`.

Genera facturas PDF (via `window.print()`) para hitos de cobro. Tres tipos:
- `adelanto`: pago parcial
- `liquidacion`: pago final con adelantos previos ya facturados
- `unico`: pago único sin adelantos

Emisor: Paula Díaz Echalecu, NIF 72694758S. IVA: 21%. IRPF: 15%. Serie: VSF. Número correlativo por ejercicio (calcula consultando invoice_number en charges del año en curso). Campos editables con `contenteditable`. Persiste `invoice_number` e `invoiced: true` en charges.

El nombre del receptor usa `_cliente.company ?? _cliente.name ?? _cliente.id`.

### propuesta.js
Módulo ES6, importado por formulario.js. `initPropuesta(supabase, servicios, venues, getDisponibilidad)`.

Genera propuestas PDF para reservas seleccionadas. Serie PRP. Textos editables en el mock-up. Logo en base64 cargado al inicializar. Nombre del servicio: `svc.name ?? svc.description ?? r.service_id`.

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
    onBorradorActualizado   // (solicitudId, draft) => void — opcional
})
```

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

**Marcadores de respuesta:** cuando Claude incluye `---MENSAJE_CLIENTE---`, el texto entre ese marcador y el siguiente (o el fin de la respuesta) aparece en un textarea editable. Si Claude incluye además `---BORRADOR---` seguido de un array JSON, ese JSON se extrae y nunca llega al textarea (el cliente no lo ve). Los botones Copiar / Email / WhatsApp tienen `min-height:48px` y al pulsarse: (1) ejecutan su acción principal, (2) insertan el mensaje en el log como `<Paula>`, (3) guardan el borrador si había `---BORRADOR---`, (4) cambian el estado de la solicitud a `respuesta_enviada`, (5) convierten la X de cierre en "✓ Cerrar" (verde). Si Paula escribe un nuevo mensaje en el textarea de input, el área de resultado se oculta y se vuelve al modo conversación. No existe el botón "✅ Usar respuesta".

**Guardar log:** botón visible pero discreto. Guarda `messages` y `context_snapshot` en `assistant_logs`.

**Edge Function `claude-proxy`:** único punto de entrada a la Claude API. Verifica JWT. Acepta `{ messages, system?, max_tokens?, model? }`. Modelo por defecto: `claude-sonnet-4-6`. Lista blanca: `claude-sonnet-4-6`, `claude-opus-4-7`, `claude-haiku-4-5-20251001`. Aplica prompt caching en el system prompt.

**`abrirProcesarEmail()`:**
1. Paula pega el texto del email (con cabeceras, firmas, etc.)
2. Claude Haiku (especificado explícitamente) parsea con `SYSTEM_PROMPT_PARSING` → JSON estructurado
3. Modal de revisión con campos editables precargados
4. "Guardar" → INSERT en reservation_requests con `source='email', status='nueva'`; "Guardar y responder" → lo mismo + abre el asistente

### asistente-config.js
Exporta `SYSTEM_PROMPT_ASISTENTE` y `SYSTEM_PROMPT_PARSING`. Separado de asistente.js para poder actualizar los prompts subiendo solo este archivo por FTP, sin tocar la lógica.

El system prompt incluye una sección **BORRADOR DE PROPUESTA** que instruye a Claude sobre cuándo emitir el bloque `---BORRADOR---` (solo junto a `---MENSAJE_CLIENTE---` y solo cuando el mensaje contiene una propuesta concreta), qué campos incluir en el JSON, y cómo usar el borrador recibido en el contexto para entender el estado actual de la negociación.

Si se actualiza el prompt: revisar que los nombres de campo son coherentes con la estructura del contexto documentada en la sección `disponibilidadParaAsistente` de este documento. El prompt de caching tiene TTL de 5 minutos en la Edge Function — solo ahorra tokens dentro de la misma sesión del navegador.

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

**Marcar cobro como cobrado puede no persistirse en Supabase.**

Reportado al menos en una ocasión: pulsar el checkbox/botón "cobrado" en el hito de cobro de un cliente en `formulario.js` bloque 5 no guardó el cambio (el campo `collected` siguió a `false` en la BD). Posible causa: el handler del evento de cambio no llega a ejecutar el UPDATE, o el UPDATE falla silenciosamente. Investigar: (1) añadir log de error visible en el handler de "marcar cobrado" en bloque 5 de `formulario.js`, (2) verificar que el listener existe en el elemento correcto y no hay un re-render que lo elimine antes del clic.

---

**Cobros facturados pero no cobrados no se pueden editar.**

Si un hito tiene `invoice_number IS NOT NULL` (se generó una factura), el sistema bloquea la edición del importe aunque `collected = false`. En la práctica, las reservas cambian en el último momento y la factura original queda desfasada. La función `persistirCobrosCliente` crea un "hito de ajuste" automáticamente, pero ese mecanismo no es operable ni visible desde la UI del cliente en `formulario.js`. El criterio de editabilidad debería ser `collected = false`, no `invoice_number IS NULL`. Fix: revisar `formulario.js` bloque 5 para permitir editar el `amount` de un hito mientras `collected = false`, aunque haya `invoice_number`, y añadir una advertencia visible de que la factura emitida ha quedado desfasada.

---

**`_onBorradorActualizado` no preserva el campo `estado` al actualizar desde el asistente.**

Cuando Claude emite un `---BORRADOR---`, `_onBorradorActualizado` en `solicitudes.js` sobreescribe todo el array `proposal_draft`. Si Paula ya había empezado la conversión (alguna línea con `estado: 'hecha'` o `'descartada'`) y luego vuelve a abrir el asistente, esos estados se pierden y las líneas vuelven a `'pendiente'`.

Fix: al actualizar el borrador desde el asistente, emparejar líneas por `service_id + venue_id` y preservar el campo `estado` de las existentes antes de sobreescribir.

---

**Borrado en cascada incompleto — residuos tras eliminar reservas, clientes o proveedores.**

Auditado (jun 2026): la única FK con CASCADE es `sfcom_listings.availability_id → availability`. Todas las demás son NO ACTION en ambas direcciones. Esto significa que el JS debe gestionar manualmente el orden de borrado en cascada (lo hace, pero con riesgos si falla a medias). Pendiente decidir cuáles merecen CASCADE a nivel de BD vs. mantenerlas como NO ACTION para que el JS pueda controlar el flujo con confirmaciones del usuario.

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

### 7.2 UX — puntos de fricción en el uso diario

**Exceso de modales en el flujo sfcom normal.**

Un pedido sfcom normal llega ya con todos los datos → Paula hace 6 clics/confirmaciones antes de que la reserva esté guardada (modal de nuevo pedido → confirmar cliente → confirmar servicio → seleccionar venue → confirmar bloque → guardar). La mayor parte de esos pasos son para casos de excepción (datos incompletos, varios venues posibles) pero se presentan en el camino principal.

Plan: revisar los modales del flujo sfcom en `formulario.js` bloque 0 e identificar cuáles pueden fusionarse o suprimirse cuando los datos son completos. No es un rediseño completo; basta con saltarse pasos cuando la información es unívoca.

---

**Cálculo de margen en panel.js incluye tipos de servicio sin actividad comercial relevante.**

Las tablas "Disponibilidad por evento" y "Disponibilidad por proveedor" del panel muestran filas para todos los `event_type`, incluidos `visita_guiada` y `otro`. Estos servicios tienen un modelo de negocio distinto (guías a precio fijo, sin margen de balcón) y distorsionan la lectura del margen global. Solo interesa ver el margen para balcones: `encierro`, `chupinazo`, `procesion`, `pobre_de_mi`, `despedida_gigantes`. Fix: en `calcularEventos()` de `panel.js`, filtrar `servicios` para excluir `event_type IN ('visita_guiada', 'otro')` antes de calcular filas y márgenes.

---

**Cambio de proveedor de una venue: no hay UI en admin.**

Si hay que reasignar una venue a un proveedor diferente (p.ej. cambio de propietario de un balcón), no existe ningún campo editable en `proveedores.js`. La FK `venues.provider_id` es NO ACTION en DELETE, pero permite UPDATE sin restricciones. El cambio en Supabase es directo: `UPDATE venues SET provider_id = 'NUEVO_PROVEEDOR' WHERE id = 'MI_VENUE'`. Dado que los casos son rarísimos, basta documentar ese SQL; si ocurriera con frecuencia, valorar añadir un `<select>` de proveedor en la UI de edición de venue en `proveedores.js`.

---

**Tablas del panel de control no son navegables.**

En `panel.html`, las tablas de "Disponibilidad por evento" y "Disponibilidad por proveedor" no tienen interacción: hacer clic en una fila no hace nada. El comportamiento esperado: clic en una fila → selecciona ese evento/proveedor en el dropdown correspondiente y despliega el detalle. La navegación debería ser bidireccional (cambiar el dropdown también actualiza qué fila está marcada).

Implementación: listener `click` en `<tr>` de cada tabla → actualizar el `<select>` → disparar el evento `change` del select (o llamar directamente a la función de render del detalle).

---

**`services.image_url` no se puede editar desde el admin.**

`propuesta.js` usa como imagen de fallback `disp?.photos?.[0] ?? svc.image_url`. El primer término (`availability.photos`) se puede editar desde `proveedores.js`. Pero si no hay foto en `availability`, cae al `svc.image_url` (`services.image_url`), que no tiene ningún campo de edición en el panel.

Tres opciones:
- (A) Añadir un campo de URL de imagen en la pantalla de edición de servicios dentro de `tablas.js`.
- (B) Al guardar la primera foto en un par venue/event_type, escribir también `services.image_url` si está vacío (auto-fill).
- (C) Eliminar el fallback a `svc.image_url` de `propuesta.js` y exigir que cada availability tenga fotos.

Opción preferida a analizar: (B) por ser no destructiva y eliminar el problema a futuro sin requerir trabajo manual.

---

### 7.3 Funcionalidades pendientes

**sfcom — leads de pedidos cancelados.**

`checkSfcomOrders` descarta los pedidos con `status === 'cancelled'`, pero son leads valiosos (el cliente intentó comprar). Plan acordado: importarlos como solicitudes con `source: 'sfcom_c:WEB026_1090'` (prefijo `sfcom_c:`). Esto hace que `_esSfcom()` devuelva `false` y reciban tratamiento completo de lead. El campo `comments` llevaría `"Pedido cancelado en tienda.sanfermin.com."`. La deduplicación existente en `registrarPedidosSfcom` cubre estos casos sin cambios de esquema.

Cambios:
- `sfcom.js` → `checkSfcomOrders`: segundo `.filter()` para `cancelled`; devolver `{ ok, nuevos, cancelados }`.
- `formulario.js` → `registrarPedidosSfcom`: parámetro `cancelados = []`; deduplicación con `'sfcom_c:' + p.origin_ref`; INSERT con ese source y `price_per_slot: null`.

---

**Comunicaciones semi-automáticas.**

El asistente ya puede redactar confirmaciones de reserva y recordatorios previos al evento. Falta el flujo de envío: un botón en la ficha de reserva que abra el asistente en modo `'confirmacion'` o `'recordatorio'`, genere el mensaje y lo envíe vía WhatsApp o email (Resend). Pendiente de diseñar: qué canal usar, si se necesita un nuevo `modo` en `abrirAsistenteRespuesta`, y si el envío es manual (copy-paste) o automático (Resend API).

---

**Facturación canal sfcom.**

Cuando sfcom vende, liquidan el neto. No hay mecanismo para generar facturas a sfcom ni gestionar el calendario de esos cobros. Dos opciones en análisis:
- Opción A: cliente `SFCOM` en `clients` solo para facturación; las reservas quedan donde están.
- Opción B: migrar todas las reservas con `origin_ref LIKE 'WEB%'` al cliente `SFCOM`.

---

**Mejoras en la calidad de las propuestas.**

Las propuestas tienen más datos disponibles ahora de los que usan. Mejoras identificadas:
- Usar `venues.display_name` como nombre del venue (en lugar del id).
- Incluir `availability.photos[0]` como imagen principal de cada línea.
- Mostrar `availability.access_instructions` si está relleno.
- Mejorar el contexto que recibe Claude para el borrador (más datos de disponibilidad = propuestas más concretas).

---

**Renombrar IDs de cliente, proveedor, venue u otras entidades.**

Actualmente imposible desde el admin. Desde el SQL Editor de Supabase tampoco es directo porque todas las FKs de IDs de texto (clients, providers, venues, services) son NO ACTION en UPDATE: al cambiar la PK falla el constraint porque las tablas hija aún referencian el ID antiguo.

Solución correcta (a implementar en Fase 2): añadir `ON UPDATE CASCADE` a las FKs relevantes. Con CASCADE, `UPDATE clients SET id = 'NUEVO' WHERE id = 'VIEJO'` propagaría automáticamente a `reservations.client_id` y `charges.client_id`.

Mientras tanto, el workaround manual en SQL Editor (ejecutar como transacción en el orden correcto: primero las tablas hija, luego la PK):
```sql
-- Ejemplo para renombrar cliente:
BEGIN;
UPDATE reservations SET client_id = 'NUEVO_ID' WHERE client_id = 'VIEJO_ID';
UPDATE charges     SET client_id = 'NUEVO_ID' WHERE client_id = 'VIEJO_ID';
UPDATE clients     SET id        = 'NUEVO_ID' WHERE id        = 'VIEJO_ID';
COMMIT;

-- Para venue: UPDATE reservations, availability (venue_id), luego venues.
-- Para provider: UPDATE venues (provider_id), payments, luego providers.
```

---

**Edición directa en `tablas.js` con gestión de Supabase Storage.**

Actualmente `tablas.js` es solo lectura con algunas acciones puntuales. Objetivo: poder editar directamente cualquier campo de cualquier tabla desde la UI, con un modal de advertencia cuando el cambio tiene impacto en otras tablas (ej. cambiar `venue_id` de una fila de `availability`). Adicionalmente, gestionar los buckets de Supabase Storage desde el panel (ver qué ficheros hay, cuáles están huérfanos, borrar).

---

### 7.4 Auditorías pendientes (investigar primero, luego decidir)

**Bloqueos y residuos en el ciclo de facturación/cobros/pagos.**

Situaciones conocidas o sospechadas que pueden dejar el sistema en estado inconsistente o impedir cambios:
- **Cambio de ID de cliente imposible:** `clients.id` es PK y texto libre; si se equivoca al crearlo, no hay forma de renombrarlo desde el panel (habría que hacer UPDATE + reasignar FK manualmente en Supabase).
- **Factura parcialmente emitida:** si se genera el PDF de una factura pero luego se añaden más cobros a la misma reserva, la factura queda desfasada pero no hay mecanismo de "anular y regenerar".
- **PDFs de propuestas/facturas sin UI de acceso:** los PDF generados con `window.print()` no se guardan en ningún sitio accesible desde el panel. Si Paula pierde el PDF, no puede recuperarlo.
- **Cobros y pagos tras eliminar una reserva:** ver bug de cascada en 7.1.

Tarea: hacer un recorrido manual por cada flujo (crear reserva → facturar → cobrar → pagar proveedor → cerrar) anotando todos los puntos donde un error o cambio de opinión deja residuos. Documentar qué está cubierto por triggers/FK y qué requiere limpieza manual.

---

**Verificar el trigger `trg_sync_availability_event_type`.**

El trigger propaga `photos`, `description` y `access_instructions` a todas las filas con el mismo `venue_id + event_type` cuando se edita una de ellas desde `proveedores.js`. El código de la función `sync_availability_by_event_type` está auditado y es correcto (usa `services.event_type` como referencia). No se ha verificado empíricamente que funcione end-to-end desde la UI.

Verificación: editar las fotos de un par venue/event_type con varias filas y comprobar que todas las demás se actualizan.

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

**Exceso de "nombres" para venue/evento.**

Cada lugar físico puede tener hasta cuatro identificadores distintos: `venues.id` (PK técnico, ej. `BALCON_ESTAFETA_1`), `venues.display_name` (nombre visible en el panel), `services.name` (nombre del servicio en ese venue, ej. `"Balcón encierro"`), y `sfcom_listings.sfcom_service_name` (nombre en la tienda sfcom). A esto se suman los slugs de URL del catálogo público. La proliferación genera confusión sobre qué mostrar en qué contexto.

Aclaración de reglas a documentar: `id` solo en BD/código; `display_name` en toda UI interna; `services.name` en documentos al cliente (propuestas, confirmaciones); `sfcom_service_name` solo para sincronización con sfcom.

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

**Datos de servicios incompletos** — los campos `name`, `description`, `image_url` y `start_time` de varios servicios están vacíos en Supabase. Afecta a propuestas y al contexto del asistente. Rellenar desde Supabase Dashboard o desde el panel de tablas.

**55 servicios en la tabla `services`** — Solo hay 12-14 activos documentados. El exceso puede ser servicios de prueba, de temporadas anteriores, o creados por el asistente de lote. Revisar en Dashboard (Table Editor → services, ordenados por event_type) e identificar cuáles están activos y cuáles son residuos.

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

**`invoiced` en `charges` es redundante** con `invoice_number IS NOT NULL`. Se mantiene por conveniencia en filtros de consulta.

**Auto-transición `respuesta_enviada → seguimiento_pendiente` solo se evalúa al cargar `solicitudes.html`.** Si la sesión lleva días abierta, el badge en pantalla puede quedar desfasado. En la práctica no es problema porque la página se recarga con frecuencia.

**Las vistas de Supabase son siempre en tiempo real.** No hay caché a nivel de vista en PostgreSQL: cada vez que el JS hace una query sobre `availability_panel` o `catalogo_publico`, Supabase ejecuta la vista en ese momento con los datos actuales de las tablas base. No hay riesgo de ver datos obsoletos por este motivo. El único caché relevante es `_stockCache` en `sfcom.js` (cliente JS, en memoria, solo para llamadas a la API sfcom).

---

## 8. Trampas técnicas conocidas

**PowerShell 5.1 corrompe archivos JS.** `Get-Content | Set-Content` lee UTF-8 como Windows-1252 y corrompe caracteres multibyte (emojis, tildes, em-dashes). Fix si ocurre: `git restore <archivo>` y rehacer el cambio con la herramienta Edit de Claude Code.

**ES6 modules — redeclaración = SyntaxError silencioso.** Si un `import` trae `foo` y en el mismo archivo hay `const foo` o `function foo`, el módulo no carga y falla en silencio (sin error visible en la UI). Fix: borrar la declaración local en el mismo Edit que añade el nombre al import, nunca en pasos separados.

**`panel.querySelector()` siempre, nunca `document.getElementById()` tras `crearModal`.** El dialog podría no ser único en el DOM si hay un residuo anterior. `panel.querySelector('#mi-btn')` es siempre seguro.

**PDF server-side — WeasyPrint incompatible con el CSS del proyecto.** Si en el futuro se necesita generación server-side de PDFs, usar Puppeteer + pypdf. WeasyPrint no interpreta correctamente el CSS del proyecto.

**Logo en PDFs:** usar el canal R de la imagen como máscara alfa.

**`invoiced` en charges es redundante** con `invoice_number IS NOT NULL`, pero se mantiene por conveniencia en filtros de consulta.

**`payments`: el hito final se identifica por `comments === 'Pago final'`**, no por un campo `is_final` (que sí existe en charges). Esta inconsistencia es conocida.

---

## 9. Plan de fases para ejecutar la deuda técnica

Acordado en jun 2026. El criterio de agrupación: mismo área de código, misma sesión de trabajo, sin abrir el mismo archivo dos veces entre fases.

### Estado de cada fase (jun 2026)

| Fase | Estado | Descripción |
|---|---|---|
| -1 | ✅ Completa | Auditoría completa de Supabase |
| 0 | 🔲 Parcial | Auditorías sin código (ver detalles abajo) |
| 1 | ✅ Completa | Bugs simples (4 cambios quirúrgicos) |
| 2 | 🔲 Pendiente | Esquema BD: cascada de borrados |
| 3 | 🔲 Pendiente | Sistema de borrador y asistente (incl. bug disponibilidad vacía) |
| 4 | 🔲 Pendiente | Flujo sfcom: leads cancelados + modales |
| 5 | 🔲 Pendiente | Panel: UX de navegación y edición |
| 6 | 🔲 Pendiente | Mejoras de propuestas |
| 7 | 🔲 Pendiente | Funcionalidades mayores (requieren diseño previo) |
| 8 | 🔲 Pendiente | Refactors y cierre |

### Dependencias duras entre fases

```
0 → 2 (la auditoría FK define qué migrar)
0a → 5 (verificar trigger antes de tocar proveedores.js)
2 → 5, 6, 7, 8 (borrados correctos antes de construir encima)
3 → 6 (borrador limpio antes de mejoras en propuestas)
5 → 6 (image_url auto-fill antes de usarlo en propuestas)
todas → 8 (refactors de archivos grandes van últimos)
```

La Fase 1 es independiente de todo: se puede hacer incluso antes que la 0.

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

**0a — Verificar trigger `trg_sync_availability_event_type`:** editar fotos de un venue con varios días de encierro y confirmar que todas las filas del mismo event_type se actualizan. **Pendiente** (la función está auditada y es correcta; falta la prueba end-to-end desde la UI).

**0b — Verificar origen de `event_type`:** ✅ Cerrada en Fase -1. Es columna directa en `services`.

**0c — Auditoría de FK cascada:** ✅ Hecha en Fase -1 (D1). La única FK con CASCADE es `sfcom_listings.availability_id → availability`. Todas las demás son NO ACTION. Resultado: la Fase 2 incluirá añadir CASCADE en FKs seleccionadas.

**0d — Auditoría del ciclo de facturación:** 🔲 Pendiente. Recorrido manual por cada flujo completo (crear reserva → cobrar → facturar → pagar proveedor → eliminar) anotando residuos.

**Deudas operativas sfcom:** Contactar a Hilario sobre Pobre de Mí, Barrera Encierro, Visitas guiadas, Despedida Gigantes. Independiente de todas las fases.

---

### Fase 1 — ✅ Bugs simples (jun 2026)

1. **`panel.js` alertas** — `calcularAlertas()`: `solicitudesSfcom` filtra `status === 'nueva'`; web dividida en nuevas y `seguimiento_pendiente` con etiquetas separadas. ✅
2. **`formulario.js` bloque 0** — `otrasActivas` usa `status === 'nueva'`. ✅
3. **`utils.js` `resolverCliente`** — Umbral mínimo 5 chars para `.includes()`. Fix parcial (ver deuda pendiente en 7.1). ✅
4. **`formulario.js` doble `cargarSolicitudes`** — Eliminada llamada incondicional; el chain de `checkSfcomOrders` garantiza una sola llamada. ✅

---

### Fase 2 — 🔲 Esquema BD: cascada de borrados y renombrado de IDs

Basada en los hallazgos del D1 (Fase -1). Solo la FK `sfcom_listings → availability` tiene CASCADE. Todas las demás son NO ACTION.

Dos subobjetivos:

**2a — ON DELETE CASCADE** (o mantener NO ACTION con JS explícito): decidir por cada FK si conviene CASCADE (limpieza automática al borrar padre) o NO ACTION (el JS controla el flujo con confirmación del usuario). Implementar migraciones en SQL Editor.

**2b — ON UPDATE CASCADE** para IDs de texto: añadir `ON UPDATE CASCADE` a las FKs de `clients.id`, `providers.id`, `venues.id` y `services.id`. Con CASCADE, renombrar un ID en la tabla padre propagará automáticamente a todas las tablas hija. Esto también habilita en el futuro una UI de "renombrar ID" en el admin. Las FKs afectadas: `reservations.client_id`, `charges.client_id` (→clients); `venues.provider_id`, `payments.provider_id` (→providers); `reservations.venue_id`, `availability.venue_id` (→venues); `reservations.service_id`, `availability.service_id` (→services).

---

### Fase 3 — 🔲 Sistema de borrador y asistente

Cambios en `proposal_draft` y en el system prompt / contexto del asistente. Todos tocan `solicitudes.js`, `formulario.js` o `asistente-config.js`. Orden interno:

1. ✅ **Bug asistente: disponibilidad vacía** — `expandirServiceIds` en `asistente.js` normaliza ahora slugs con `split('-')`. También corregido `_inferirServiceIds` en `solicitudes.js`.
2. 🔲 **Mejora asistente: venue en lugar de balcón** — pendiente de verificar qué muestra el asistente con el bug 1 ya corregido antes de decidir si hay algo más que cambiar.
3. ✅ **Mejora asistente: precios siempre por persona** — añadida instrucción explícita en `SYSTEM_PROMPT_ASISTENTE` en la sección de reglas de precio y en el bloque PRECIOS del mensaje al cliente.
4. 🔲 Unificar formato de `service_name` al construir líneas del borrador (solicitudes.js y formulario.js).
5. 🔲 Bug `_onBorradorActualizado`: emparejar por `service_id + venue_id` y preservar `estado` antes de sobreescribir.
6. 🔲 Actualizar `SYSTEM_PROMPT_ASISTENTE`: explicar qué significa cada valor de `estado` (`'pendiente'`, `'hecha'`, `'descartada'`). Valorar filtrar `'descartada'` del contexto.

---

### Fase 4 — 🔲 Flujo sfcom: leads cancelados + reducción de modales

Ambos cambios tocan `sfcom.js` y bloque 0 de `formulario.js`.

1. Leads cancelados: importar pedidos sfcom con `status='cancelled'` como solicitudes con `source: 'sfcom_c:WEB026_1090'`. Requiere segundo `.filter()` en `checkSfcomOrders` y caso adicional en `registrarPedidosSfcom`. Sin cambio de esquema.
2. Reducción de modales: identificar pasos evitables cuando los datos son unívocos (cliente detectado, servicio inferido, un solo venue posible). No es rediseño, es saltarse pasos en el camino principal.

---

### Fase 5 — 🔲 Panel: UX de navegación y edición

1. Tablas del panel navegables: listener `click` en `<tr>` → actualizar select → disparar render del detalle. Bidireccional.
2. `services.image_url` auto-fill: al guardar la primera foto de un par venue/event_type, escribir `services.image_url` si está vacío.

---

### Fase 6 — 🔲 Mejoras de propuestas

Usar datos ya disponibles en propuesta.js: `venues.display_name` como nombre del venue, `availability.photos[0]` como imagen principal, `availability.access_instructions` si existe.

---

### Fase 7 — 🔲 Funcionalidades mayores (requieren diseño previo en claude.ai)

- Comunicaciones semi-automáticas: confirmar qué canal, si hace falta un `modo` nuevo en `abrirAsistenteRespuesta`, si el envío es manual o automático (Resend API).
- Facturación canal sfcom: decidir entre cliente `SFCOM` en `clients` solo para facturación, o migrar reservas sfcom existentes.

Ambas requieren conversación de diseño en claude.ai antes de escribir código.

---

### Fase 8 — 🔲 Refactors y cierre

- Inferencia `level → service_id` unificada en `utils.js` (extraer de formulario.js, solicitudes.js, asistente.js).
- Documentar reglas de nombres venue/evento en CLAUDE_ADMIN.md.
- Rellenar datos incompletos de servicios (tarea manual en Dashboard).
- Evaluar granularidad caché sfcom en sfcom.js.
- Tablas.js edición directa + Supabase Storage (funcionalidad nueva grande).
- Split de formulario.js (solo si el tamaño es problema práctico, siempre al final).
