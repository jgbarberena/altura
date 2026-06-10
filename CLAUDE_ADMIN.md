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
| name | text — nombre comercial corto (ej: `"Balcón encierro"`). Se usa en propuestas como etiqueta principal. |
| description | text — descripción larga |
| start_time | text — hora de inicio (ej: `'08:00'`) |
| image_url | URL absoluta de imagen representativa. Fallback en propuestas cuando availability.photos está vacío. |
| comments | text |

**`availability`** — Par venue+servicio con capacidad y precio
| Campo | Notas |
|---|---|
| id | integer PK |
| venue_id | FK→venues |
| service_id | FK→services |
| total_slots | integer NOT NULL |
| price_per_slot | decimal — coste que se paga al proveedor por plaza (o importe fijo total si billing_model='fixed') |
| billing_model | `'capacity'`, `'consumption'` o `'fixed'`; default `'capacity'` |
| event_type | text — tipo de experiencia derivado del servicio (ej: `'encierro'`, `'chupinazo'`). Usado para agrupar en el catálogo y en el trigger de sincronización de fotos. |
| description | text — descripción específica del par venue/servicio |
| access_instructions | text — instrucciones de acceso el día del evento |
| photos | text[] ARRAY — URLs de fotos del balcón para este par |
| comments | text |

UNIQUE (venue_id, service_id).

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
| total_amount | decimal GENERATED — slots × price_per_slot. El JS no la calcula ni envía. |
| status | `'Confirmada'`, `'Pendiente'`, `'Cancelada'`; default `'Pendiente'` |
| comments | text |
| proposal_number | text |
| proposal_path | Ruta al PDF en Supabase Storage (bucket `proposals`) |
| sfcom_order_ref | Referencia del pedido sfcom que originó la reserva (ej: `WEB123_456`). Null para reservas directas. |

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
| status | `'nueva'`, `'email_parsed'`, `'atendida'`, `'descartada'`; default `'nueva'` |
| created_at | timestamptz, default now() |
| attended_at | timestamptz |
| source | null (web), `'email'` (procesado desde panel), ref del pedido sfcom (ej: `WEB123_456`) |
| price_per_slot | numeric — solo en solicitudes sfcom (precio bruto) |
| service_id | text — sin FK; se guarda como verificación, nunca como búsqueda primaria |
| language | `'es'`, `'en'`, `'fr'`, `'it'`, `'de'`, `'other'` — solo para emails |
| email_raw | Texto completo del email original (referencia, no se muestra en panel) |
| conversation_status | `'nueva'`, `'en_conversacion'`, `'respuesta_enviada'`, `'seguimiento_pendiente'`, `'cerrada'` |
| conversation_notes | Log interno formato: `---DD/MM/AA---\n<Paula>\nTexto\n<Cliente>\nTexto` |
| assigned_venue_id | FK→venues — venue asignado (opcional) |
| updated_at | timestamptz — actualizado por trigger en cada UPDATE |

Las solicitudes con `conversation_status = 'cerrada'` no aparecen en la lista activa de solicitudes.html.

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

**`trg_uppercase_*`** — BEFORE INSERT OR UPDATE en todas las tablas con IDs de texto. Convierte a mayúsculas los campos relevantes. El JS no necesita hacerlo.

**`notificar-solicitud`** — AFTER INSERT en `reservation_requests`. Llama a la Edge Function del mismo nombre. Se dispara en cada INSERT (desde la web pública y desde `checkSfcomOrders`). Transparente para el JS.

**`trg_reservation_requests_updated_at`** — BEFORE UPDATE en `reservation_requests`. Actualiza automáticamente el campo `updated_at` en cada cambio.

**`trg_sync_availability_event_type`** — AFTER UPDATE en `availability`. Cuando se editan `photos`, `description` o `access_instructions` en una fila, sincroniza el mismo cambio a todas las filas con el mismo `venue_id` y `event_type`. Garantiza que los datos de marketing son consistentes entre todos los días de encierro de un mismo balcón. Transparente para el JS: editar una fila sincroniza todas.

### Vistas

**`service_availability`** — Plazas libres por servicio (solo lectura, acceso anon). Campos: `service_id`, `free_slots`. Calculada como `SUM(total_slots) - SUM(slots reservados Confirmados+Pendientes)`, agrupada por `service_id`. Usada por `disponibilidad.js` en el frontend público para los badges de disponibilidad.

**`availability_panel`** — Solo authenticated. Campos: `venue_id, service_id, total_slots, price_per_slot, billing_model, venue_display_name, venue_address, description, access_instructions, venue_slug, event_type`. Usada por `formulario.js`, `solicitudes.js` y `asistente.js`. No incluye campos sfcom.

**`availability_with_sfcom`** — Solo authenticated. JOIN de `availability` + `sfcom_listings`. Campos: `id, venue_id, service_id, total_slots, price_per_slot, billing_model, venue_display_name, sfcom_service_name, sfcom_slots_listed, sfcom_product_id, sfcom_variation_id, sfcom_status, sfcom_public_price, sfcom_listing_id`. Filas sin entrada en `sfcom_listings` tienen campos sfcom a null. Usada exclusivamente por `sfcom.js`, `sfcom-panel.js` y `proveedores.js`. No usar para operaciones que no necesiten campos sfcom.

**`catalogo_publico`** — Acceso anon. Campos: `slug, display_name, address, venue_type, service_id, description, access_instructions, photos, service_name, event_type, day, start_time, service_image_fallback`. Usada por `catalogo/catalogo.js`.

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

### formulario.js (~1680 líneas)
Módulo ES6. Importa de `supabase.js`, `utils.js`, `factura.js`, `propuesta.js`, `sfcom.js`, `verificacion.js`, `modal.js`, `asistente.js`.

Lee al cargar: `clients`, `services`, `availability_panel`, `venues`, `sfcom_listings` (con join a availability), `reservations`.

**6 bloques** (se muestran/ocultan según estado):

**Bloque 0 — Solicitudes pendientes:** Lee `reservation_requests` con `status='nueva'`. Solicitudes sfcom (source con formato `WEB\d+_\d+`) en rojo, sin botón Descartar. Solicitudes web en naranja con botón Descartar. Click en fila → `cargarDesdeSolicitud`: limpia cliente previo, precarga datos, intenta inferir servicio y proveedor (sfcom con `_inferirDesdeSfcom`, web con `_inferirServiceId`). El admin confirma siempre. Botón "Procesado" cambia status a 'atendida'. Click en fila NO cambia el status.

**Bloque 1 — Cliente:** Autocomplete en tiempo real contra `clients`. Cliente existente → carga datos + autosave por campo. Cliente nuevo → "Cliente nuevo".

**Bloque 2 — Reserva:** Selector de servicio → selector de proveedor (filtrado por service_id) → plazas → precio → total calculado (no editable) → estado → comentarios. Antes de guardar llama a `checkAvailabilityBeforeSave`. Al guardar en modo edición, si cambia proveedor/servicio sincroniza stock sfcom para par original y nuevo.

**Disponibilidad al editar:** `getPlazasInfo(proveedorId, servicioId, excluirId)` excluye la reserva en edición activa para que su proveedor no aparezca con disponibilidad reducida por su propia reserva.

**Bloque 3 — Disponibilidad:** Mapa visual de columnas por proveedor. Click en proveedor sin plazas abre panel de reorganización.

**Bloque 4 — Reservas del cliente:** Tabla de reservas. Checkbox para editar, cancelar o eliminar en lote. Botón "Generar propuesta".

**Bloque 5 — Cobros al cliente:** Hitos de cobro. Botón de facturación por hito. Hito final (`is_final: true`) recalculado automáticamente vía `persistirCobrosCliente`.

**Secuencia de carga:** `checkSfcomOrders` primero; `ejecutarVerificacion(false)` encadenado en `.finally()` para evitar race condition (verificarCoherencia lee reservation_requests y necesita que los pedidos sfcom nuevos estén ya insertados).

### solicitudes.js
Módulo ES6. Importa `supabase.js`, `auth.js`, `utils.js`, `initAsistente`, `abrirAsistenteRespuesta`, `abrirProcesarEmail` de `asistente.js`.

Lee al cargar: `availability_panel` (para calcular disponibilidad de venues) y `reservations`.

**Layout:** dos columnas en desktop (lista 320px izquierda, detalle derecha). En mobile: bottom sheet (`position:fixed; bottom:0; transform:translateY(100%)` + clase `.visible`).

**Sistema de dos ejes de estado:**
- `status` (proceso): `'nueva'` / `'email_parsed'` / `'atendida'` / `'descartada'`
- `conversation_status` (seguimiento comercial): `'nueva'` → `'en_conversacion'` → `'respuesta_enviada'` → `'seguimiento_pendiente'` → `'cerrada'`

Auto-transición: `'respuesta_enviada'` → `'seguimiento_pendiente'` si `updated_at` supera 3 días. Se aplica al cargar la lista.

**Lista:** nombre, fecha, badges de origen y de conversation_status, experiencia, preview del último mensaje del log (64 chars).

**Detalle:** selector de conversation_status con autosave, botón "📩 Enviar recordatorio" (solo cuando `conversation_status === 'seguimiento_pendiente'`), grid de datos, selector de venue asignado con plazas libres en tiempo real, log de conversación, botón "💬 Abrir asistente", enlace "📋 Convertir en reserva" (→ formulario.html con query params), botón "✅ Cerrar solicitud".

**Log de conversación:** almacenado en `conversation_notes` como texto plano: `---DD/MM/AA---` como separador de fecha, `<Paula>` y `<Cliente>` como marcadores de autor. Los mensajes del día actual tienen botón de edición.

**Integración con asistente:** `onRespuestaUsada: _onRespuestaUsadaEnLog`. Cuando Paula pulsa "✅ Usar respuesta": inserta el texto como entrada `<Paula>` en el log + cambia `conversation_status` a `'respuesta_enviada'` + refresca el detalle + actualiza badge.

### proveedores.js
Módulo ES6. Lee `availability_with_sfcom` al cargar (para tener campos sfcom en memoria).

Gestiona:
- CRUD de proveedores con autocomplete. Al crear un proveedor nuevo se crea automáticamente un venue con el mismo ID.
- Dos campos de dirección: `providers.address` (contacto) y `venues.address` (física del balcón). Autosave en ambos.
- Campo `venue_type` con autosave en `venues`.
- Disponibilidad: añadir/editar/eliminar entradas en `availability` y `sfcom_listings`. Tras guardar o editar llama a `syncStockToSfcom`.
- Hitos de pago al proveedor.
- Carrusel de fotos por par venue/servicio (escribe en `availability.photos`; el trigger sincroniza al resto del event_type automáticamente).
- Asistente de creación en lote (`dlgNuevoServicio`): crea servicios y availability para un rango de días desde un nombre base.
- Widget de imagen (`.img-picker`): cuadro cuadrado, vacío muestra input de URL, con imagen muestra la foto con botón ✕.

**Acceso a datos sfcom:** lecturas vía `availability_with_sfcom`. Escrituras sfcom siempre a `sfcom_listings`, nunca a `availability`.

**Flujos sfcom en proveedores.js:**
- `null` → "Solicitar a SFcom" → `'pending'` (correo a Hilario) → Hilario activa → "Confirmar" → GET verificación → `'confirmed'` + sync inicial
- `'confirmed'` → "Dar de baja" → `'deactivation_pending'` (correo a Hilario) → Hilario retira → "Confirmar baja" → GET verificación → DELETE en sfcom_listings → `null`
- Mientras `sfcom_status` no sea null, el servicio no se puede eliminar.

### panel.js
Módulo ES6. Lee en paralelo: `reservations`, `availability`, `services`, `providers`, `payments`, `charges`, `reservation_requests`. Usa `availability` directamente (no la vista) porque no necesita campos sfcom.

Bloques: alertas críticas (sobrereservas, pagos/cobros vencidos, solicitudes pendientes), calendario de próximos pagos/cobros (filtrable), estado financiero con Chart.js, resumen por servicio/día. Tablas con sort por columna (4 tablas). Cobros y pagos pendientes son clicables: abren formulario.html o proveedores.html con el cliente/proveedor precargado via query params.

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
    sfcom_slots_listed - SUM(slots WHERE sfcom_order_ref NOT NULL AND status != 'Cancelada'),
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
    getDisponibilidad,  // () => array disponibilidad en memoria
    getTodasReservas,   // () => array reservas en memoria
    onEmailSaved,       // () => callback tras insertar email parseado
    esSfcom,            // (source) => boolean
    onRespuestaUsada    // (texto, solicitud) => void — opcional
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
        tipo, nombre, email, telefono, evento, dia, personas,
        idioma,              // campo language o 'desconocido'
        comentario,          // comments sin prefijos Días:/Otros servicios:
        conversation_log,    // conversation_notes
        assigned_venue_id,
        conversation_status,
        modo
    },
    disponibilidad: [...],  // array de disponibilidadParaAsistente
    precios: {...}          // objeto de preciosReferencia
}
```

**`disponibilidadParaAsistente(serviceIds)`:** campos por entrada: `service_id, dia, venue_id, venue_display_name, venue_address, description, access_instructions, billing_model, plazas_libres, coste_proveedor, catalogo_url`. La `catalogo_url` se construye como `https://www.experienciasanfermin.com/catalogo/balcon.html?v=${venue_slug}&et=${event_type}` solo si hay TANTO `venue_slug` como `event_type`; null si falta alguno. Ordenadas: capacity con plazas libres primero, luego por día.

**`preciosReferencia(serviceIds)`:** devuelve `{ [service_id]: "min-max" | número }` con el rango de precios de reservas existentes activas. Si todos los precios son iguales, devuelve un número.

**Marcador `---MENSAJE_CLIENTE---`:** cuando Claude incluye este marcador, el texto posterior aparece en un textarea editable con botones Copiar / Email / WhatsApp. El botón "✅ Usar respuesta" aparece solo si `onRespuestaUsada` fue pasado en `initAsistente`.

**Guardar log:** botón visible pero discreto. Guarda `messages` y `context_snapshot` en `assistant_logs`.

**Edge Function `claude-proxy`:** único punto de entrada a la Claude API. Verifica JWT. Acepta `{ messages, system?, max_tokens?, model? }`. Modelo por defecto: `claude-sonnet-4-6`. Lista blanca: `claude-sonnet-4-6`, `claude-opus-4-7`, `claude-haiku-4-5-20251001`. Aplica prompt caching en el system prompt.

**`abrirProcesarEmail()`:**
1. Paula pega el texto del email (con cabeceras, firmas, etc.)
2. Claude Haiku (especificado explícitamente) parsea con `SYSTEM_PROMPT_PARSING` → JSON estructurado
3. Modal de revisión con campos editables precargados
4. "Guardar" → INSERT en reservation_requests con `source='email', status='email_parsed'`; "Guardar y responder" → lo mismo + abre el asistente

### asistente-config.js
Exporta `SYSTEM_PROMPT_ASISTENTE` y `SYSTEM_PROMPT_PARSING`. Separado de asistente.js para poder actualizar los prompts subiendo solo este archivo por FTP, sin tocar la lógica.

Si se actualiza el prompt: también actualizar los nombres de campo si cambia la estructura del contexto. El prompt de caching tiene TTL de 5 minutos en la Edge Function — solo ahorra tokens dentro de la misma sesión del navegador.

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

`sfcom_order_ref` = `${order.number}_${order.id}` (ej: `WEB026_1090`).

---

## 7. Deuda técnica activa

**Propuestas PDF** — necesitan usar correctamente `services.name` + `venues.display_name` y añadir fotos desde `availability.photos[0]` (con `services.image_url` como fallback). Pendiente antes de la próxima temporada.

**Comunicaciones semi-automáticas** — confirmación de reserva y recordatorio previo al evento. Pendiente de implementar antes de la próxima temporada. El asistente ya puede redactar los mensajes; falta el flujo de envío.

**Phase 4 de formulario.js** — el archivo tiene ~1680 líneas. Tres candidatos para extracción:
- `solicitudes.js` interno (~300 líneas): Bloque 0 + `registrarPedidosSfcom` + modales de solicitudes sfcom
- `reorganizar.js` (~200 líneas): panel de reorganización (`abrirPanelReorganizar`, `confirmarReorg`, variables de estado). El más autocontenido.
- `cobros.js` (~300 líneas): Bloque 5 + `persistirHitosCliente` + `cargarCobrosCliente`

El obstáculo es el estado compartido (`todasReservas`, `clienteActual`, etc.). Extraer requiere pasar ese estado como parámetros o crear un objeto compartido, lo que añade fontanería que actualmente no existe. **No hacer hasta que el tamaño sea un problema práctico.** Si se decide, empezar por `reorganizar.js`.

**sfcom — deudas operativas:**
- Pobre de Mí (producto 142): ownership/mapeo pendiente de aclarar
- Barrera Encierro (producto 140, stock null): no sincronizar hasta aclarar modelo de stock
- Visitas guiadas: sin filas en availability ni mapeo sfcom
- Despedida Gigantes (producto 147): stock agrupado pendiente de gestión (usar hijos 215/216)

**Facturación canal sfcom** — cuando sfcom gestiona una venta, ellos facturan al cliente final y nos liquidan el neto. No hay mecanismo para generar facturas a sfcom ni gestionar el calendario de cobros a ese canal. Dos opciones en análisis:
- Opción A: cliente `SFCOM` en clients solo para facturación, las reservas quedan donde están (mínimo cambio, inconsistencia conceptual)
- Opción B: migrar todas las reservas con `sfcom_order_ref IS NOT NULL` al cliente `SFCOM` (datos limpios, pérdida de visibilidad del comprador final en las reservas)

**Falsos positivos en verificación sfcom por TTL de stock-all** (cosmético) — stock-all en sf-api-paula.php trabaja contra una caché con su propio TTL. Una verificación justo después de un PUT puede mostrar discrepancia aunque el PUT fue correcto. Desaparece sola cuando el TTL expira.

**Datos de servicios incompletos** — los campos `name`, `description`, `image_url` y `start_time` de varios servicios están vacíos en Supabase. Rellenar desde el panel de proveedores. No es tarea de código.

---

## 8. Trampas técnicas conocidas

**PowerShell 5.1 corrompe archivos JS.** `Get-Content | Set-Content` lee UTF-8 como Windows-1252 y corrompe caracteres multibyte (emojis, tildes, em-dashes). Fix si ocurre: `git restore <archivo>` y rehacer el cambio con la herramienta Edit de Claude Code.

**ES6 modules — redeclaración = SyntaxError silencioso.** Si un `import` trae `foo` y en el mismo archivo hay `const foo` o `function foo`, el módulo no carga y falla en silencio (sin error visible en la UI). Fix: borrar la declaración local en el mismo Edit que añade el nombre al import, nunca en pasos separados.

**`panel.querySelector()` siempre, nunca `document.getElementById()` tras `crearModal`.** El dialog podría no ser único en el DOM si hay un residuo anterior. `panel.querySelector('#mi-btn')` es siempre seguro.

**PDF server-side — WeasyPrint incompatible con el CSS del proyecto.** Si en el futuro se necesita generación server-side de PDFs, usar Puppeteer + pypdf. WeasyPrint no interpreta correctamente el CSS del proyecto.

**Logo en PDFs:** usar el canal R de la imagen como máscara alfa.

**`invoiced` en charges es redundante** con `invoice_number IS NOT NULL`, pero se mantiene por conveniencia en filtros de consulta.

**`payments`: el hito final se identifica por `comments === 'Pago final'`**, no por un campo `is_final` (que sí existe en charges). Esta inconsistencia es conocida.
