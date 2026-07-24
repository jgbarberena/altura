# CLAUDE_ADMIN.md — Panel de administración

> Referencia completa del panel de admin (`/admin/`). Lee primero `CLAUDE.md` para el contexto transversal del proyecto.

> **Deudas cerradas y fases completadas:** en `CLAUDE_ADMIN_BACKLOG.md` (no cargar en sesiones normales). Para mover una deuda resuelta al backlog sin cargarlo: `Add-Content -Path 'CLAUDE_ADMIN_BACKLOG.md' -Value '...' -Encoding UTF8`.

---

## 1. Supabase

**URL:** `https://xpczeztrcupptsmqvmcu.supabase.co`  
**Project ID:** `xpczeztrcupptsmqvmcu`  
**Anon key (pública):** `sb_publishable_jwz44-n-zQUn6RH0qLtbEg_uj0R9T3H`

Dos clientes Supabase:
- **Admin** (`/admin/js/supabase.js`): módulo ES6, `export const supabase`. Solo en el panel.
- **Público** (`/js/supabase-global.js`): script clásico, `window.supabasePublic`, `persistSession: false`. Solo en páginas públicas que necesitan acceso (formulario de solicitud, catálogo).

### Edge Functions

Las Edge Functions corren en el runtime de Deno de Supabase. **No se despliegan por FTP ni git** — solo desde el Dashboard (editor de código de cada función) o vía Supabase CLI. El directorio `admin/supabase/functions/` del repo es la copia de referencia; está excluido del deploy FTP.

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

**`services`** — Tipo de evento (Fase 1 jun 2026: PK migrada de text a integer; Fase 9d jun 2026: añadida columna `season`)
| Campo | Notas |
|---|---|
| id | **integer PK autoincremental** (antes era el texto ENCIERRO_7 etc.; desde Fase 1 es un surrogado entero) |
| service_code | text NOT NULL — el identificador legible antes almacenado en `id` (ej: `ENCIERRO_7`, `CHUPINAZO_6`). Regla de uso: `service_code` para display en UI, lógica de negocio y patrones regex; `id` solo para FK en BD. |
| season | **integer NOT NULL** — año de la temporada (ej: 2026, 2027). Cada temporada tiene su propio juego de servicios. UNIQUE con `service_code`. |
| day | integer — día de julio |
| event_type | text — categoría del evento: `encierro`, `chupinazo`, `procesion`, `despedida_gigantes`, `pobre_de_mi`, `visita_guiada`, `otro`. Columna directa en la tabla (no derivada). Fuente de verdad para el trigger de sincronización y para las vistas. |
| name | text — nombre comercial corto (ej: `"Balcón encierro"`). Se usa en propuestas como etiqueta principal. |
| description | text — descripción larga |
| start_time | text — hora de inicio (ej: `'08:00'`) |
| image_url | URL absoluta de imagen representativa. Fallback en propuestas cuando availability.photos está vacío. |

UNIQUE `uq_services_code_season` en `(service_code, season)`: el mismo code puede existir en distintas temporadas.

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

Constraints añadidos en jun/jul 2026: UNIQUE(venue_id, service_id) (`uq_availability_venue_service`). FK desde `reservations(venue_id, service_id)` con ON DELETE RESTRICT — PostgreSQL bloquea borrar una fila de availability si tiene reservas.

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
| venue_id | FK→venues NOT NULL (añadido jul 2026). FK compuesta con service_id → availability(venue_id, service_id) ON DELETE RESTRICT, ON UPDATE CASCADE (añadida jul 2026) |
| slots | integer NOT NULL |
| price_per_slot | decimal NOT NULL — precio de venta al cliente |
| total_amount | decimal GENERATED ALWAYS AS `((slots)::numeric * price_per_slot)` — calculado por PostgreSQL. El JS no la calcula ni envía. |
| status | `'Confirmada'`, `'Pendiente'`, `'Cancelada'`; default `'Pendiente'` |
| comments | text |
| proposal_number | text |
| proposal_path | Ruta al PDF en Supabase Storage (bucket `proposals`) |
| origin_ref | Referencia de origen heterogénea: `WEB026_1090` (sfcom), UUID (solicitud web/email), null (reserva directa). Detección: `origin_ref LIKE 'WEB%'` para sfcom; `IS NOT NULL AND NOT LIKE 'WEB%'` para UUID. |
| welcome_sent_at | timestamptz — momento en que Paula envió la bienvenida al cliente. `NULL` = pendiente (aparece en el aviso). Timestamp real = enviado. Sentinel `0001-01-01T00:00:00.000Z` = "no enviar" (marcado explícitamente; desaparece del aviso sin haber enviado nada). Detección del sentinel: `value?.startsWith('0001-01-01')`. |

**`charges`** — Hitos de cobro a clientes (por cliente, no por reserva)
| Campo | Notas |
|---|---|
| id | integer PK |
| client_id | FK→clients |
| season | **integer NOT NULL** — temporada a la que pertenece el cobro. Añadido en Fase 9d. |
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

**`payments`** — Hitos de pago a proveedores (por proveedor, no por servicio)
| Campo | Notas |
|---|---|
| id | integer PK |
| provider_id | FK→providers ON DELETE RESTRICT (cambiado de CASCADE a RESTRICT en jul 2026 — no se puede eliminar un proveedor con pagos) |
| season | **integer NOT NULL** — temporada a la que pertenece el pago. Añadido en Fase 9d. |
| amount | decimal NOT NULL |
| due_date | date |
| paid | boolean, default false |
| paid_date | date |
| is_final | boolean — hito final del pago a proveedor |
| comments | text — nota opcional sobre el hito |

**`supplier_documents`** — Bandeja de documentos recibidos: dos capas de datos

Capa operativa (gastos del negocio):
| Campo | Notas |
|---|---|
| id | bigint PK, IDENTITY |
| provider_id | text FK→providers, NULLABLE — null para gastos generales sin proveedor |
| file_path | text NOT NULL — ruta en bucket `supplier-invoices`. Sentinel sin-archivo: termina en `_sin_archivo` |
| uploaded_at | timestamptz NOT NULL, default now() |
| season | integer NOT NULL |
| concept | text — concepto del gasto |
| expense_date | date — fecha del gasto (introducida por el usuario) |
| amount | numeric — importe total del gasto |
| has_invoice | boolean NOT NULL DEFAULT true — si tiene factura o justificante. Si false, no aparece "Anotar" ni en alertas fiscales |
| notes | text — notas adicionales (usado por dismiss de Alerta 1: prefijo `*`) |

Capa de pre-extracción IA (datos extraídos automáticamente del documento, usados para pre-rellenar el modal de "Contabilizar"):
| Campo | Notas |
|---|---|
| issuer_name | text — nombre del emisor (quien vende) |
| issuer_nif | text — NIF del emisor |
| invoice_number | text — número de factura detectado |
| issue_date | date — fecha de la factura detectada |
| irpf_rate | numeric — tipo IRPF detectado |
| irpf_amount | numeric — importe IRPF detectado |
| suggested_category | text — categoría sugerida (`proveedores`, `arrendamiento`, `servicios`, `suministros`, `otros`) |
| ai_vat_lines | jsonb — desglose de IVA: `[{"base": 0, "rate": 21, "vat": 0}]`. Mismo formato que `_vatLines` en `dlg-gasto.js` |

Los campos IA se rellenan al pulsar "Leer con IA" en `gastos.js` o `proveedores.js`. Se borran automáticamente (UPDATE a null) si se guarda con un nuevo archivo sin releer la IA, para evitar datos de extracción desfasados. El campo `issuer_nif` (o `ai_vat_lines`) siendo no nulo indica que la IA ya procesó el documento.

**`supplier_invoices`** — Libro de facturas recibidas (registro fiscal)
| Campo | Notas |
|---|---|
| id | bigint PK, IDENTITY |
| document_id | bigint NOT NULL UNIQUE FK→supplier_documents(id) ON DELETE RESTRICT |
| provider_id | text FK→providers, NULLABLE |
| issuer_name | text NOT NULL |
| issuer_nif | text NOT NULL |
| invoice_number | text NOT NULL |
| issue_date | date NOT NULL |
| booked_date | date NOT NULL — fecha de registro en el libro. En modo simplificada, `booked_date = issue_date`. **Solo determina el trimestre fiscal si el trimestre de `issue_date` ya está cerrado** (ver regla de filtrado en Bloque 6). |
| operation_type | text NOT NULL, default `'interior'` — CHECK IN ('interior','intracomunitaria','extracomunitaria','inversion_sujeto_pasivo') |
| category | text NOT NULL, default `'proveedores'` |
| deductible_pct | numeric NOT NULL, default 100 |
| is_capital_good | boolean NOT NULL, default false |
| irpf_rate | numeric |
| irpf_amount | numeric |
| retention_type | text NOT NULL DEFAULT `'ninguna'` — CHECK IN ('ninguna','profesional','arrendamiento'). `profesional` = 15% (actividades profesionales, clave G del M-190), `arrendamiento` = 19% (arrendamiento de inmuebles, clave F del M-190). Se infiere automáticamente de `irpf_rate` al guardar; la IA lo sugiere. **Nunca sumar profesional y arrendamiento en un único total** — el M-715 y M-190 los desgloszan por clave. |
| total | numeric NOT NULL |
| season | integer NOT NULL |
| notes | text |
| UNIQUE | (issuer_nif, invoice_number) |

**`supplier_invoice_vat_lines`** — Líneas de IVA de facturas recibidas
| Campo | Notas |
|---|---|
| id | bigint PK, IDENTITY |
| invoice_id | bigint NOT NULL FK→supplier_invoices(id) ON DELETE CASCADE |
| base_amount | numeric NOT NULL |
| vat_rate | numeric NOT NULL |
| vat_amount | numeric NOT NULL |

**`issued_invoices`** — Libro de facturas emitidas (registro fiscal)
| Campo | Notas |
|---|---|
| id | bigint PK, IDENTITY |
| invoice_number | text NOT NULL UNIQUE — serie `VSF-NN/AAAA` |
| issue_date | date NOT NULL |
| accrual_date | date NOT NULL — fecha de devengo; **determina el trimestre fiscal** |
| client_id | text FK→clients ON DELETE RESTRICT, NULLABLE |
| client_name | text NOT NULL — congelado en el momento de emisión, no hacer JOIN a clients |
| client_nif | text |
| client_address | text |
| operation_type | text NOT NULL, default `'interior'` |
| invoice_type | text — CHECK IN ('adelanto','liquidacion','unico') o NULL |
| irpf_rate | numeric |
| irpf_amount | numeric |
| total | numeric NOT NULL |
| file_path | text NULLABLE — ruta al PDF en bucket `invoices`. NULL = backfill incompleto o upload fallido |
| charge_id | integer UNIQUE FK→charges(id) ON DELETE SET NULL |
| season | integer NOT NULL |
| is_void | boolean NOT NULL default false — true para facturas anuladas o re-emitidas |
| is_simplified | boolean — true si es factura simplificada (particular + total ≤ 400 € IVA incluido) |
| notes | text |

**`issued_invoice_vat_lines`** — Líneas de IVA de facturas emitidas
| Campo | Notas |
|---|---|
| id | bigint PK, IDENTITY |
| invoice_id | bigint NOT NULL FK→issued_invoices(id) ON DELETE CASCADE |
| base_amount | numeric NOT NULL |
| vat_rate | numeric NOT NULL |
| vat_amount | numeric NOT NULL |

**`fiscal_closings`** — Candado de trimestres presentados
| Campo | Notas |
|---|---|
| id | bigint PK, IDENTITY |
| model | text NOT NULL, default `'F69'` |
| year | integer NOT NULL |
| quarter | integer NOT NULL — CHECK `>= 0 AND <= 4`. Trimestres 1–4 para F69 y M-715. `quarter = 0` para el M-190 (anual). |
| presented_at | **date** (no timestamptz) — NULL = pendiente; fecha real = presentado |
| result_amount | numeric |
| vat_to_compensate_next | numeric |
| notes | text |
| UNIQUE | (model, year, quarter) |

**Protección de trimestres cerrados:** los triggers `trg_supplier_invoices_immutable` y `trg_issued_invoices_immutable` bloquean INSERT/UPDATE/DELETE en `supplier_invoices` e `issued_invoices` cuando el trimestre de `booked_date`/`accrual_date` tiene `presented_at IS NOT NULL` en `fiscal_closings`. Los triggers de las líneas de IVA heredan la misma protección. La función `fiscal_period_is_closed(date)` es la fuente común.

**Función `providers.nif`:** columna `text` añadida en Fase 11 (prerelleno de comodidad, no requisito fiscal).

---

**Retenciones soportadas (M-715 y M-190)** — añadido jul 2026

Cuando Paula recibe facturas con retención (arrendadores de balcones al 19%, servicios profesionales al 15%), ella ingresa esa retención en Hacienda. Dos obligaciones nuevas:

- **M-715 trimestral** (mismos plazos que el F69, mismo criterio de trimestre `_fechaEfectiva`): base y retención desglosadas por clave. Candado propio en `fiscal_closings` con `model='715'`.
- **M-190 anual** (enero del año siguiente): un registro por perceptor × clave, año natural completo. Candado en `fiscal_closings` con `model='190', quarter=0`.

**Trampas importantes:**
- **Nunca sumar las dos claves**: 15% (clave G, profesional) y 19% (clave F, arrendamiento) son claves distintas en el modelo — el M-715 y M-190 las muestran por separado.
- **Validación aritmética**: al contabilizar una factura con retención, el JS bloquea si `Σbase + ΣIVA − irpf_amount ≠ total` (tolerancia 0,02 €). El F69 no cambia.
- **NIF del emisor no bloquea la contabilización**: un NIF inválido se normaliza (quita puntos/guiones/espacios) y se almacena, pero aparece en ámbar en la tabla fiscal y en una alerta en Fiscal. El M-190 requiere NIF válido — hay que corregirlo antes de presentar (eliminar la entrada y volver a registrar).
- **`validarNif(raw)`** en `utils.js`: normaliza y valida checksum para NIF, NIE y CIF españoles. Devuelve `{ normalizado, valido }`.

**`retention_type`** se infiere automáticamente al guardar: si `irpf_amount > 0` se lee del selector del modal (pre-seleccionado por la IA o por `irpf_rate`). Si no hay retención o es modo simplificada, se fuerza a `'ninguna'`. La IA también sugiere el tipo y detecta descuadres en un campo `warnings` que aparece en ámbar en el modal (informativo — el JS es la barrera bloqueante).

---

**`reservation_requests`** — Solicitudes recibidas
| Campo | Notas |
|---|---|
| id | uuid PK, gen_random_uuid() |
| client_name | text NOT NULL |
| client_email, client_phone, client_address | text |
| comments | Notas internas de uso libre para el equipo. Columna legacy reutilizada como campo de notas: la web pública solía escribir aquí el comentario libre del formulario; desde jun 2026 ese dato va dentro del JSON de `conversation_notes`. Los registros antiguos pueden tener valor; `_procesarWebFormsSinProcesar` lo usa como fallback (`rawData.comment \|\| sol.comments`). Editable desde la vista expandida de `solicitudes.js` (sección "Notas internas", entre borrador y conversación) con autosave. También editable desde `tablas.js` (tipo textarea). |
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

### Vistas y funciones SQL

Definiciones SQL exactas en `admin/supabase/sql/views_pre_migration.sql` (estado pre-Fase1) y en el archivo de migración `admin/supabase/sql/migration_fase1_services_pk.sql` (estado post-Fase1).

**Función `public.public_season()`** — STABLE function. Devuelve el año de la temporada vigente para las vistas públicas: si `EXTRACT(MONTH FROM NOW()) >= 8` → `año_actual + 1`, si no → `año_actual`. Definida en Fase 9d. Usada por `service_availability` y `catalogo_publico` para filtrar por temporada sin hardcodear años. No requiere mantenimiento anual.

**`service_availability`** — Plazas libres por servicio (solo lectura, acceso anon, `security_invoker=false`). Campos: `service_id` (text = **service_code**, no el integer PK), `free_slots`. **IMPORTANTE:** expone `service_code` aliasado como `service_id` (texto tipo `ENCIERRO_7`) para que `disponibilidad.js` del frontend público siga funcionando sin cambios. Filtrada por `s.season = public_season()` (Fase 9d). Agrupada por `services.id + service_code`.

**`availability_panel`** — Solo authenticated. Campos: `id, venue_id, service_id` (integer FK), `total_slots, price_per_slot, billing_model, description, access_instructions, photos, venue_display_name, venue_address, venue_slug, event_type, day, start_time, service_code` (text), **`season`** (integer, añadido en Fase 9d). Usada por `formulario.js`, `solicitudes.js`, `asistente.js` y `proveedores.js`. No incluye campos sfcom. El código admin usa `service_id` para FK y `service_code` para display y patrones regex. **Sin filtro de temporada en la vista** — el JS filtra con `.eq('season', getTemporadaActiva())`.

**`availability_with_sfcom`** — Solo authenticated. JOIN de `availability` + `sfcom_listings`. Campos: `id, venue_id, service_id` (integer FK), `total_slots, price_per_slot, billing_model, venue_display_name, sfcom_service_name, sfcom_slots_listed, sfcom_product_id, sfcom_variation_id, sfcom_status, sfcom_public_price, sfcom_listing_id, service_code` (text), **`season`** (integer, añadido en Fase 9d). Filas sin entrada en `sfcom_listings` tienen campos sfcom a null. Usada exclusivamente por `sfcom.js` y `sfcom-panel.js`. Sin filtro de temporada en la vista.

**`catalogo_publico`** — Acceso anon, `security_invoker=false`. Campos: `slug, display_name, address, venue_type, service_id` (text = **service_code**, alias), `description, access_instructions, photos, service_name, event_type, day, start_time, service_image_fallback`. Filtrada por `s.season = public_season()` (Fase 9d). Usada por `catalogo/catalogo.js`.

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

Tres buckets privados (sin acceso público directo):

| Bucket | Uso |
|---|---|
| `proposals` | PDFs de propuestas generados desde `propuesta.js` |
| `invoices` | PDFs de facturas emitidas generados desde `factura.js`. Referenciados en `issued_invoices.file_path`. |
| `supplier-invoices` | Documentos de proveedores (facturas recibidas, albaranes) y gastos generales. Subidos desde `proveedores.js` y `gastos.js`. Referenciados en `supplier_documents.file_path`. |

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
| `calcularTemporadaDefault(todasTemporadas)` | Calcula la temporada por defecto desde un array de años presentes en BD. Antes de agosto → temporada más reciente con datos. Desde agosto, si ya existe el año siguiente → año siguiente. |
| `getTemporadaActiva()` | Devuelve la temporada activa (integer) desde `localStorage('vsf_temporada_activa')`; si no hay valor guardado usa `calcularTemporadaDefault(_todasTemporadas)`. |
| `setTemporadaActiva(season)` | Persiste la temporada elegida en `localStorage` y recarga la página. |
| `initTemporada(todasTemporadas, onReady?)` | Async. Renderiza el selector de temporada en `.sidebar-header p` y muestra el toast de advertencia si la temporada activa ≠ la por defecto. Debe llamarse antes de cualquier query filtrada. Almacena `todasTemporadas` en variable de módulo para que `confirmarSiTemporadaNoActiva` y `getTemporadaActiva` funcionen sin parámetros. |
| `confirmarSiTemporadaNoActiva(tipoCosa, onConfirmar)` | Si la temporada activa es la por defecto, llama a `onConfirmar()` directamente. Si no, muestra un modal de confirmación con la temporada activa antes de proceder. Usar para cualquier write en tablas sensibles a temporada (`availability`, `services`, `reservations`, `charges`, `payments`) cuando el usuario opera en una temporada no estándar. **No usar** para writes en `providers`, `clients`, `venues`. |
| `anioTemporada()` | Alias de `getTemporadaActiva()`. Mantiene compatibilidad con código anterior (`propuesta.js`, `factura.js`, `asistente.js`). |
| `initAutoSave(supabase, campos, camposDB, tabla, getEntity, { onSaved, onError })` | Registra `change` en inputs para autosave en Supabase. Solo actúa si `getEntity()` devuelve truthy. |
| `exportTable(rows, columns, filename)` | Genera .xlsx con SheetJS (carga dinámica). `columns: [{ key, label, fmt? }]` |
| `renderClientChips(reservas)` | Devuelve spans `ID(slots)` coloreados (verde=Confirmada, naranja=Pendiente). Agrupa por client_id sumando slots. |
| `formatVenueLabel(venueId, venueProviderId)` | "PROV — VENUE" si distintos, solo venueId si iguales |
| `persistirCobrosCliente(supabase, clienteId, todasReservas)` | Recalcula y persiste cobro final en charges. Si el hito ya tiene invoice_number, crea hito de ajuste. |
| `persistirPagosProveedor(supabase, proveedorId, todasReservas, todaDisponibilidad)` | Recalcula y persiste pago final en payments. Primero busca todos los venues del proveedor para agregar disponibilidad y reservas de todos ellos. |
| `resolverCliente(datos, todosClientes)` | **Punto de entrada obligatorio antes de generar un client_id nuevo.** `datos: { nombre, email, telefono }`. Devuelve `{ match: 'exacto'\|'ambiguo'\|'ninguno', cliente, candidatos: [] }`. Prioridad: 1) email exacto, 2) teléfono exacto (normaliza prefijo +34), 3) coincidencia por tokens de nombre (tokens ≥4 chars; ambiguo si ≥60% de los tokens del nombre buscado aparecen en el cliente). Cuando hay varios candidatos con la misma cobertura, devuelve todos en `candidatos[]` y `match='ambiguo'`; el formulario muestra un picker modal (`_confirmarClienteAmbiguo`). Evita la creación de duplicados (CLIENTE_2, CLIENTE_3) cuando llegan múltiples solicitudes de la misma persona. |
| `initPrecioInput(input)` | Aplica comportamiento 2dp-on-blur a un `<input type=number>`. Muestra 2 decimales cuando no está enfocado; al enfocar restaura la precisión completa (guardada en `input.dataset.rawValue`). Idempotente: ignora llamadas repetidas sobre el mismo elemento. Llamar inmediatamente tras obtener la referencia al elemento. |
| `setPrecioValue(input, value)` | Asigna un valor a un input gestionado por `initPrecioInput`. Guarda la precisión completa en `rawValue` y muestra 2 decimales. Pasar `''`, `null` o `undefined` limpia el campo y borra `rawValue`. Usar en lugar de `input.value = ...` para cualquier asignación programática de precios. |
| `getPrecioValue(input)` | Lee el valor con precisión completa de un input gestionado por `initPrecioInput`. Si el input está enfocado (usuario tecleando) lee `input.value`; si está desenfocado usa `rawValue`. Devuelve `0` si está vacío. Usar en lugar de `parseFloat(input.value)` en handlers de guardado y en funciones de cálculo llamadas desde contextos donde el input puede estar desenfocado. |
| `mostrarOpcionesEnvio({ tipo, email, telefono, asunto, getTexto, onGenerar, container, onUsado })` | Renderiza botones de acción de envío en un contenedor DOM. **`tipo: 'texto'`** (default, asistente): 📋 Copiar al portapapeles · 📧 Enviar por correo · 💬 Enviar por WhatsApp. **`tipo: 'pdf'`** (propuesta, factura): ⬇ Solo generar PDF · ⬇ Generar PDF y preparar correo · ⬇ Generar PDF y enviar por WhatsApp. Para `tipo='pdf'` es obligatorio `onGenerar: async () => void`; al hacer clic todos los botones se deshabilitan mostrando "⏳ Generando…" mientras corre. El botón con `btn-primary` es WhatsApp si hay teléfono, Email si hay email, o la opción base si no hay contacto. Los botones de email/WA solo aparecen si `email`/`telefono` son truthy. `getTexto: () => string` se llama en el momento del clic. `onUsado` es callback opcional (para 'texto' recibe el texto; para 'pdf' sin argumento). |
| `parsearNivel(level)` | Normaliza un slug/level/sfcom_service_name a `{ tipo, day }` o `null`. `tipo`: `'encierro'` \| `'chupinazo'` \| `'procesion'` \| `'gigantes'` \| `'pobre_de_mi'`. `day`: número si figura en el slug (ej. `'encierro-8'` → `8`), `null` si no. No expande a service_ids — eso lo hace cada llamador. |
| `TIPO_SERVICIO_ID` | Constante: `{ chupinazo: 'CHUPINAZO_6', procesion: 'PROCESION_7', gigantes: 'DESPEDIDA_GIGANTES_14', pobre_de_mi: 'POBRE_DE_MI' }`. Encierro no está: su ID depende del día. |
| `extraerQualifier(slug)` | Devuelve la primera palabra del slug si es `'vivir'`, `'ver'` o `'entender'`; null en otro caso. Usada para construir el mensaje inicial en `_procesarWebFormsSinProcesar`. |
| `construirItemBorrador({ service_name, service_id, venue_id, venue_display_name, day, slots, price, catalogo_url })` | Factory tipada para líneas de `proposal_draft`. Garantiza que todos los campos existen (null por defecto) y que `estado` siempre es `'pendiente'`. Usar siempre que se cree una línea de borrador desde cero. |
| `checkTrimCerrado(supabase, date)` | Consulta `fiscal_closings` (model F69, presented\_at IS NOT NULL) y devuelve `{ cerrado: bool, year?, quarter? }`. Fecha en formato `YYYY-MM-DD`. |
| `mostrarModalTrimCerrado(year, quarter, desc?)` | Modal 🔒 rojo bloqueante. Sin `desc` usa el texto estándar con T+año; `desc` permite texto personalizado (ej. múltiples trimestres en `_guardFiscalCliente`). |

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

**Deshabilitar sfcom temporalmente:** `isSfcomDisabled()` / `setSfcomDisabled(bool)` — persiste en `localStorage('sfcom_disabled')`. Cuando está activo, `ejecutarVerificacion` omite la llamada a sfcom por completo. Badge fijo bottom-right en todas las páginas del panel: "⏸️ sfcom desactivado [Reactivar]". También disponible desde `window._setSfcomDisabled(bool)` para activarlo/desactivarlo desde consola. El modal de verificación incluye un botón "⏸️ Deshabilitar sfcom" cuando sfcom devuelve discrepancias reales.

**Dominios internos (privados):**
- `_cargarDatos(supabase)` — carga en paralelo: reservations, availability_with_sfcom, clients, venues, services, providers, reservation_requests (nueva), charges (*), payments (*).
- `_verificarBD(dados)` → `{ errores, avisos, advertencias }`. Errores: FK rotas en reservas/cobros/pagos, slots≤0, sobrereserva, múltiples hitos finales por cliente, variation_id duplicado en sfcom. Advertencias (solo modoManual): inconsistencias collected/date, paid/date, invoiced/invoice_number. Avisos (solo modoManual): solicitudes pendientes.
- `_computarFinanciero(dados)` → `{ problemasClientes, problemasProveedores, advertencias }`. Compara charges vs reservas por cliente (incluye SFCOM por separado: cobros SFCOM vs total reservas WEB). Compara payments vs coste teórico por proveedor (según billing_model). Advertencias (solo modoManual): cobros/pagos a cero. **Umbral:** `|charges - reservas| >= 0.01€` → inconsistencia. **Causa habitual de discrepancia ±0.01€:** `charges.amount` se establece como `total_con_iva / 1.21`; si `price_per_slot` se ajustó por otro camino, los dos cálculos pueden diferir. Fix: actualizar `price_per_slot` vía SQL para que `SUM(total_amount) = charges.amount` (los charges ya facturados/cobrados son intocables).
- `_mostrarResultado` — decide toast vs modal. En auto: abre modal solo si hay errores BD, discrepancias sfcom no explicadas o problemas financieros. En manual: siempre abre modal con todo.
- `_mostrarModal` — modal unificado con secciones: BD errores, sfcom discrepancias (reales y pendientes), sfcom fallos, financiero, BD advertencias, BD avisos, financiero advertencias.
- `_corregirFinanciero` — ejecuta corrección automática de cobros/pagos usando `persistirCobros` y `persistirPagos` pasados por el llamador.

### formulario.js (~2600 líneas)
Módulo ES6. Importa de `supabase.js`, `auth.js`, `utils.js`, `factura.js`, `propuesta.js`, `sfcom.js`, `verificacion.js`, `modal.js`, `asistente.js`.

Lee al cargar: `clients`, `services`, `availability_panel`, `venues`, `sfcom_listings` (con join a availability), `reservations`.

**6 bloques** (se muestran/ocultan según estado):

**Bloque 0 — Solicitudes pendientes sfcom:** Lee `reservation_requests` con status no `convertida`/`descartada`. Muestra solo las sfcom confirmadas pendientes (source `WEB\d+_\d+` + status `nueva`) en tabla roja clicable. Si hay solicitudes web/email/manual con status `nueva`, muestra un aviso con enlace a `solicitudes.html`. Los leads cancelados sfcom (`source sfcom_c:*`) no cuentan para ese aviso aunque tengan status `nueva` — son tarea de outbound, no de gestión de reservas. Se oculta el bloque completo si no hay nada. Botón "→ Solicitudes" redirige a `solicitudes.html`. Click en fila sfcom → `cargarDesdeSolicitud`: limpia cliente previo, precarga datos, infiere servicio+proveedor con `_inferirDesdeSfcom`. Botón "✅ Procesado" marca status `convertida`. Tras guardar reserva sfcom: si `solicitudOriginRef` está presente, ofrece marcar la solicitud como `convertida` via `_ofrecerCerrarSolicitud`. **Nota técnica:** `proposal_draft[0].service_id` es un integer (FK a `services.id` tras Fase 1); no llamar `.replace()` sobre él en la generación de atributos HTML.

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

**Bloque 2 — Reserva:** Selector de servicio (autocomplete text-input sobre `<select>` oculto) → selector de proveedor (filtrado por service_id) → plazas → precio → total calculado (no editable) → estado → comentarios. Antes de guardar llama a `checkAvailabilityBeforeSave`. Al guardar en modo edición, si cambia proveedor/servicio sincroniza stock sfcom para par original y nuevo. El autocomplete de servicio usa `_inputSvc` / `_listSvc` / `_svcById` y `_syncServicioInput()` para mantener sincronizado el `<select>` oculto con el texto visible.

**Campo "Precio final facturado" (`inputPrecioFinal`):** ayudante junto al precio por plaza (`inputPrecio`), puramente informativo/calculadora — nunca se persiste. `inputPrecio` sigue siendo el único precio real (sin IVA ni IRPF, el que se guarda en `price_per_slot`). Al escribir en `inputPrecio`, `inputPrecioFinal` se recalcula solo mostrando a cuánto ascendería la factura (`totalFacturadoDesdeBase`, importado de `factura.js`). Al escribir directamente en `inputPrecioFinal`, ocurre lo contrario: se recalcula `inputPrecio` hacia atrás (`baseDesdeTotalFacturado`) para que ese sea el precio final exacto en la futura factura, y ese valor recalculado es el que se guarda como de costumbre. La flag de módulo `_sincronizandoPrecioFinal` evita que `actualizarTotal()` sobrescriba `inputPrecioFinal` mientras se está tecleando en él. Redondeo a 2 decimales en `price_per_slot`: el total facturado real puede desviarse en ±0,01€ del importe exacto tecleado. La fórmula (`base × (1 + iva − irpf)`) vive solo en `factura.js`, que la exporta para no duplicar los porcentajes de IVA/IRPF.

**Disponibilidad al editar:** `getPlazasInfo(proveedorId, servicioId, excluirId)` excluye la reserva en edición activa para que su proveedor no aparezca con disponibilidad reducida por su propia reserva.

**Bloque 3 — Disponibilidad:** Mapa visual de columnas por proveedor. Click en proveedor sin plazas abre panel de reorganización.

**Bloque 4 — Reservas del cliente:** Tabla de reservas. Checkbox para editar, cancelar o eliminar en lote. Botón "Generar propuesta". Botón "📩 Bienvenida" (ver sistema de bienvenida más abajo).

**Bloque 5 — Cobros al cliente:** Hitos de cobro. Botón de facturación por hito. Hito final (`is_final: true`) recalculado automáticamente vía `persistirCobrosCliente`.

**Guard de tipo fiscal del cliente (`_guardFiscalCliente` / `_anularFacturas`):** se activa cuando Paula cambia `is_business`, `country` o `nif` de un cliente. Estos tres campos determinan el tipo de factura (IRPF aplicable, simplificada o no) y los datos de cabecera del receptor, por lo que cambiarlos invalida las facturas ya emitidas. El guard opera en tres casos:

- **Sin facturas emitidas** — devuelve `'ok'` sin intervención.
- **Trimestre cerrado** — devuelve `'bloqueado'`: modal 🔒 (`mostrarModalTrimCerrado`) con los trimestres afectados; el campo no se guarda.
- **Trimestre abierto** — modal con tabla de cada hito facturado (número de factura, importe) y un botón "Reemitir" por fila. Paula puede reemitir cada factura desde ese mismo modal (abre el panel `factura.js` encima); el evento `facturaEmitida` marca la fila como reemitida al volver. Al cerrar el modal con "Aceptar": los hitos no reemitidos se anulan vía `_anularFacturas`, el campo se guarda.

**`_anularFacturas(charges)`:** para cada hito, borra las líneas de IVA (`issued_invoice_vat_lines`), borra el registro en `issued_invoices`, borra el PDF del bucket `invoices`, y limpia el hito en `charges` (`invoice_number = null`, `invoiced = false`, `invoiced_at = null`, `invoice_path = null`). **Nunca borra la fila `charges` en sí** — el dinero cobrado/pendiente es irreversible; solo se anula el registro fiscal.

**`eliminarCobroCliente(idx)` (Bloque 5):** si el cobro tiene `invoice_number`, consulta `issued_invoices` para obtener `accrual_date` y comprueba el trimestre con `checkTrimCerrado`. Trimestre cerrado → modal 🔒. Trimestre abierto → confirmación → borra PDF del bucket `invoices` (campo `issued_invoices.file_path`) → borra el charge (CASCADE elimina `issued_invoices` + `issued_invoice_vat_lines` automáticamente) → `persistirCobrosCliente`. Sin factura → flujo original: splice en memoria + `persistirHitosCliente` con reversión en caso de error.

**`nif` fuera de `initAutoSave`:** a diferencia de `name`, `company`, `phone`, etc., el campo `nif` no está en el array `camposCliente` / `camposDB` que alimenta `initAutoSave`. `initAutoSave` no tiene mecanismo de veto (escucha `change` y persiste directamente), por lo que `nif` requiere un handler manual independiente que pueda interrumpir el guardado si el guard lo bloquea o cancela.

**Orden de borrado de reservas (`eliminarSeleccionadas`):** al eliminar reservas del cliente activo, el sistema comprueba si quedan reservas con `status !== 'Cancelada'`. Si quedan → `persistirCobrosCliente` recalcula el cobro final. Si no quedan reservas activas → se eliminan todos los charges del cliente: los que no tienen `collected=true` ni `invoice_number` se borran sin preguntar; si hay alguno con historial (cobrado o facturado) se muestra un modal con **Cancelar como botón por defecto** antes de proceder. Tras limpiar charges, se ofrece opcionalmente eliminar también el cliente (en este punto ya no hay FK pendiente).

**Secuencia de carga:** `checkSfcomOrders` primero; `ejecutarVerificacion(false)` encadenado en `.finally()` para evitar race condition (verificarCoherencia lee reservation_requests y necesita que los pedidos sfcom nuevos estén ya insertados).

**Sistema de bienvenida (Fase 2, jun 2026):** botón "📩 Bienvenida" en la fila de acciones del bloque 4, junto a "Generar propuesta". Implementado en puro JS, sin asistente.

- **`actualizarBotonBienvenida()`** — muestra/oculta el botón (`#btnEnviarBienvenida`) según si el cliente tiene reservas activas. Status en `<span id="bienvenida-status">`: "✅ Enviado el DD/MM" si todas las confirmadas tienen timestamp real; "⛔ Sin bienvenida" si todas tienen el sentinel `0001-01-01…`; vacío en cualquier otro caso.
- **`WELCOME_SKIP_SENTINEL = '0001-01-01T00:00:00.000Z'`** — valor centinela escrito en `welcome_sent_at` cuando Paula pulsa "⛔ No enviar bienvenida". Distingue "decidido no enviar" (sentinel, truthy) de "pendiente" (NULL, falsy). Los filtros del aviso en panel.js y el asistente siguen usando `!r.welcome_sent_at` sin cambios, porque el sentinel es truthy. Reversible: abrir el modal y enviar sobrescribe el sentinel con un timestamp real.
- **`componerMensajeBienvenida(cliente, reservasIncluidas, pendientesNoMarcadas, disponibilidad, opts)`** — genera el texto adaptando la intro según días hasta el 6 de julio (>1 día / mañana / ya estamos en SF). `diasParaSanFermin()` usa siempre el año en curso y **no salta al año siguiente** tras las fiestas (a diferencia de `fechaCobroDefault`). Incluye un bloque por reserva con nombre del evento, día, hora, `venue_display_name`, plazas e instrucciones de acceso si `availability.access_instructions` está relleno. Cuando hay varias reservas, los bloques se separan con `— — — — —`. Cierre firmado por Paula.
- **`abrirModalBienvenida(reservasIncluidas, pendientesNoMarcadas)`** — modal con el texto como `<textarea>` editable. Si `pendientesNoMarcadas` no está vacío, muestra un banner con checkbox para añadir nota. Botones de envío (WhatsApp/email) via `mostrarOpcionesEnvio`; al usar cualquiera escribe timestamp real en `reservasIncluidas` y llama a `actualizarBotonBienvenida()` + `_onBienvenidaEnviada()`. Botón adicional "⛔ No enviar bienvenida" escribe el sentinel en las mismas reservas y cierra el modal.
- Al pulsar el botón, `reservasIncluidas` contiene todas las reservas **Confirmadas** del cliente más las **Pendientes** marcadas con checkbox. Las Pendientes no marcadas van a `pendientesNoMarcadas` (solo aparecen en el banner de advertencia).

**Asistente de bienvenidas (jun 2026):** flujo para enviar bienvenidas en lote desde el panel de control, sin tener que ir cliente a cliente.

- `panel.html` → alerta discreta `#alerta-bienvenidas` en el bloque de alertas: "N clientes sin mensaje de bienvenida enviado · Abrir asistente →". Solo visible cuando hay pendientes (`reservations.status = 'Confirmada' AND welcome_sent_at IS NULL` — el sentinel es truthy, queda excluido automáticamente). Al hacer clic abre `_abrirModalSeleccionBienvenidas`.
- **`_abrirModalSeleccionBienvenidas(idsPendientes)`** en `panel.js` — modal con tabla de selección: `client_id` | canal (sfcom en rojo / propio) | nº reservas confirmadas pendientes. Todos marcados por defecto, sfcom ordenados primero. Botón "Iniciar asistente (N)" escribe los IDs seleccionados en `sessionStorage('colaBienvenidas')` y navega a `formulario.html`. Para marcar un cliente como "no enviar" hay que ir a su ficha en formulario y usar el botón "⛔ No enviar bienvenida" del modal de bienvenida.
- **`_initBloqueColaBienvenidas(ids)`** en `formulario.js` — se activa al cargar si `sessionStorage('colaBienvenidas')` está presente (se borra tras leerlo). Crea un bloque azul (`#bloque-cola-bienvenidas`) encima del formulario, modelado sobre `bloque-conversion-propuesta`.
- **`_renderTablaColaBienvenidas()`** — una fila por cliente: `client_id` + tag [sfcom] | estado derivado de `todasReservas` (⏳ Pendiente / ✅ Enviada / — Saltada) | botones "↓ Cargar" y "Saltar". El estado ✅ se deriva directamente de `welcome_sent_at` en `todasReservas` (fuente de verdad, sin estado adicional). Al completar todos, el bloque vira a verde con botón "Cerrar".
- **`_onBienvenidaEnviada()`** — llamada desde el `onUsado` de `abrirModalBienvenida`. Solo re-renderiza la cola; el estado ya está actualizado en `todasReservas`.

### solicitudes.js
Módulo ES6. Importa `supabase.js`, `auth.js`, `utils.js` (`initSidebar`, `buildCatalogUrl`, `resolverCliente`, `initTemporada`, `getTemporadaActiva`), `mostrarToast` de `verificacion.js`, `initAsistente`, `abrirAsistenteRespuesta`, `abrirProcesarEmail` de `asistente.js`.

Lee al cargar: `availability_panel` filtrada por `season` (Fase 9d), `reservations` (sin filtro de temporada — las solicitudes (`reservation_requests`) no tienen concepto de temporada) y `clients` (para `resolverCliente` en `mostrarDetalle`).

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

**Wizard de importación de disponibilidad (`#bloque-wizard` / `#dlgWizard`):** aparece automáticamente cuando un proveedor tiene cero filas de `availability` para la temporada activa (ninguna venue tiene datos). Permite copiar la disponibilidad de temporadas anteriores: carga el historial de `availability_panel` para las venues del proveedor, deduplica por `(venue_id, service_code)` tomando siempre los datos de la temporada más reciente, y muestra las filas en una tabla con columnas ordenables. Los `service_code` que no existen aún en la temporada activa muestran `(Servicio nuevo en AAAA)` en gris — se crearán en `services` al confirmar. Al importar: INSERT en `services` para los que faltan (copiando `name`, `description`, `event_type`, `day`, `start_time`, `image_url` de la temporada origen), luego INSERT en `availability` (copiando `total_slots`, `price_per_slot`, `billing_model`, `description`, `access_instructions`, `photos`). Los datos sfcom empiezan en null — `sfcom_listings` es una tabla separada y el listado en sfcom se configura aparte por cada venue/servicio.

### panel.js
Módulo ES6. Lee en paralelo: `reservations`, `availability`, `services`, `providers`, `venues`, `payments`, `charges`, `reservation_requests`, `clients`, `supplier_documents` (solo `provider_id IS NULL`, solo `amount`, filtrado por temporada). Usa `availability` directamente (no la vista) porque no necesita campos sfcom.

**Bloques (orden en pantalla):**
1. Alertas críticas: sobrereservas, sfcom nuevos/cancelados, solicitudes pendientes, pagos/cobros vencidos, bienvenidas pendientes.
2. Panel principal (dos columnas): calendario de próximos pagos/cobros (filtrable 7/30/todos) + resumen de negocio (tarjetones dual a la derecha).
3. Por vender: 4 KPI cards + tablas pareto de disponibilidad no vendida.
4. Disponibilidad por evento.
5. Disponibilidad por proveedor.
6. Estado financiero (grid horizontal 2×3 + saldo neto) + gráfico cashflow.

Tablas con sort por columna (4 tablas). Cobros y pagos pendientes son clicables: abren formulario.html o proveedores.html con el cliente/proveedor precargado via query params.

**`calcularResumen()`:** calcula los tarjetones del bloque "Resumen de negocio". Separados en confirmadas/pendientes: `kpi-res-confirmadas`, `kpi-res-pendientes`, `kpi-plazas-confirmadas`, `kpi-plazas-pendientes`. Ingresos confirmados (`kpi-ingresos-brutos`) + pendientes (`kpi-ingresos-pendientes`). Coste proveedores = `SUM(payments.amount)` (`kpi-costes`). Gastos generales = `SUM(supplier_documents.amount)` donde `provider_id IS NULL` y `season = _temporada` (`kpi-gastos-generales`; los docs con proveedor ya están en `payments`, sin doble conteo). `costePendConsumo`: coste marginal adicional si las reservas pendientes confirman, solo para `billing_model = 'consumption'`. `kpi-coste-pend-row` se muestra solo cuando `costePendConsumo > 0`. Margen = ingresos confirmados − costes − gastosGenerales; `kpi-margen-pendientes` muestra el margen combinado si todo confirma (también resta gastosGenerales, coste fijo ya incurrido).

**`calcularPorVender()`:** calcula el bloque "Por vender". Filtra `disponibilidad` a servicios de tipo balcón (`TIPOS_BALCON`). Para cada fila calcula: `libres = total_slots − slots_activos`, `gastoAsociado` (solo `capacity`: `libres × price_per_slot`), `margen` potencial usando `_precioRef`. KPIs globales: `kpi-plazas-libres`, `kpi-ingreso-potencial`, `kpi-coste-adicional` (solo consumption), `kpi-margen-no-capturado`, con sublabels de precio/margen medio por plaza. Separa en dos secciones: `pv-capacity` (max 5 filas pareto) y `pv-consumption` (max 3 filas pareto).

**`_precioRef(venueId, serviceId, precioProv)`:** función local de `calcularPorVender`. Precio de referencia por par venue+servicio, con fallback en cascada: (1) precio medio de reservas confirmadas en ese par exacto; (2) si es encierro: precio medio de reservas confirmadas en cualquier encierro del mismo venue; (3) `precioProv × 1.15`. `ingresoPotencial` y `margen` de cada fila usan el `precioRef` de esa fila, no un promedio global. Umbral de margen razonable: 15% (coherente con `_margenIndicador` y con `validarPrecio` en `formulario.js`).

**`_paretoCorte(items, maxRows)`:** recibe items ordenados por `libres` desc. `umbral = items[0].libres / 3`. Devuelve `{ filas: items con libres ≥ umbral (máx maxRows), resto: plazas restantes, restoN: balcones restantes }`.

**`_renderPVSeccion(containerId, items, maxRows, esCapacity)`:** renderiza una sección "Por vender". Llama a `_paretoCorte`, genera frase resumen (totales de las filas mostradas), tabla `<table class="pv-tabla">` con columnas venue_id / nombre evento / plazas libres / columna económica (gasto→margen en capacity; margen potencial en consumption). El campo venue_id y el nombre de servicio tienen igual prominencia (`font-weight: 500`); plazas en negrita (`font-weight: 600`). Pie con "y N plazas más en M balcones" si hay resto. La sección "Oportunidades" (consumption) lleva clase `pv-seccion--gap` para separación visual.

**Filtro con autocomplete en tablas de eventos y proveedores:** encima de cada tabla (`#tabla-eventos`, `#tabla-proveedores`) hay un campo de texto con autocomplete (`#selector-evento`, `#selector-proveedor`). Al hacer foco o escribir, se despliega una lista con los ítems coincidentes (filtrado por `.includes` case-insensitive). Clic en un ítem de la lista: fija el valor en el input, cierra la lista y llama a `renderEventos(id)` / `renderProveedores(id)` con el ID exacto, mostrando esa fila en modo detalle (con filas hijo desplegadas). Borrar el texto y dejar el input vacío restablece la vista completa. Las filas de las tablas son clicables: llaman a `window._seleccionarEvento(id)` / `window._seleccionarProveedor(id)`, que actualiza el input con el ID (o lo vacía si ya estaba seleccionado ese ítem — toggle), cierra la lista y re-renderiza. Clic fuera de cualquier `.autocomplete-wrap` cierra ambas listas. Patrón CSS: `.autocomplete-wrap` + `.autocomplete-list` (el mismo que se usa en proveedores.html e id de cliente en formulario.html).

**Indicador de margen (`_margenIndicador`):** punto de color `●` delante del ID en las tablas de eventos y de proveedores. Verde = margen ≥ 15% del ingreso; naranja = 0–15%; rojo = pérdida; sin punto = sin actividad (ingreso y coste a 0). Ingreso = `SUM(total_amount)` reservas no canceladas; coste según `billing_model` (`capacity`: total_slots×precio, `consumption`: slots_activos×precio, `fixed`: precio si hay alguna reserva, 0 si no). Las filas padre (evento o venue agregado) muestran el margen del conjunto, no el peor hijo. Implementado en `calcularEventos`/`calcularProveedores`; `filaEvento`/`filaDetalleProveedor`/`filaProveedor`/`filaDetalleServicio`.

**Filas venue en tabla de eventos (`filaDetalleProveedor`):** al expandir un evento, las filas hijo muestran los venues con `cursor:pointer`. Un clic en la celda navega a `proveedores.html?venue=ID`, que carga el proveedor y selecciona la pestaña del venue automáticamente.

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
- `syncStockToSfcom(supabase, venueId, serviceId)` — hace PUT si `sfcom_status === 'confirmed'`. Silencioso en éxito, modal de error en fallo. Tras un PUT exitoso escribe en `sessionStorage` la clave `sfcom-sync:venueId|serviceId` con el stock puesto y el timestamp (TTL 6 min), para que `verificarSfcom` pueda distinguir discrepancias reales de artefactos del caché GET de sfcom. Llamar siempre después de cualquier operación que cambie reservas activas.
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

Recibe datos pre-cargados (no hace queries Supabase propias). Devuelve `{ verificado, discrepancias[], fallos[], avisos[], error }`. Llamado desde `verificacion.js` como parte de `ejecutarVerificacion`.

Comprobaciones que realiza:
1. Integridad FK: reservas con venue/service/client que no existen en sus tablas maestras.
2. Sobrereserva: plazas activas superiores al total del venue/servicio.
3. Solicitudes pendientes: sfcom sin atender (aviso) y web sin atender (aviso).
4. Servicios `confirmed` sin `sfcom_product_id` (aviso).
5. Discrepancias de stock: compara stock real en sfcom (`stock-all`) con stock esperado según fórmula. Genera `sfcom.discrepancias[]`.
6. IDs de variación duplicados: detecta si dos servicios del mismo producto comparten `sfcom_variation_id` en `sfcom_listings`. Resultado va a `errores[]`.

`resultado.ok` es `true` solo si `errores[]` está vacío (las discrepancias sfcom no bloquean `ok`; tienen su propia sección en el modal).

**`verificarConfirmarSfcom(supabase, dispId, productName, serviceId, excludeNames)`**

Busca el nombre propuesto en la lista de productos conocidos y confirma la entrada en `sfcom_listings`. Fuente de la lista: query a `sfcom_listings` en Supabase (no a sfcom directamente, porque sf-api-paula.php no expone `GET products`). Esto significa que la lista incluye únicamente productos ya configurados en alguna fila de `sfcom_listings`. Si Hilario añade un producto nuevo que aún no aparece en ninguna fila, habrá que añadirlo manualmente con SQL o esperando a que se use por primera vez.

Flujo interno: `getSfcomProducts()` (Supabase) → `_inferirProductoEnSfcom()` (auto-match por nombre y día) → si no hay match, picker modal → upsert en `sfcom_listings` con product_id, variation_id y `sfcom_status: 'confirmed'`.

**Discrepancias `pendingExplains`:** cuando sfcom muestra menos stock del esperado y el gap está cubierto íntegramente por solicitudes sfcom pendientes de procesar, la discrepancia no es un error. Aparece en la sección "ℹ️ Pedidos sfcom pendientes de incorporar" del modal, no en "⚠️ Discrepancias de stock". No tiene botón de sincronización; el "Sincronizar todos" las ignora.

**TTL del caché GET de sfcom:** el endpoint `GET stock-all` tiene un caché de ~5 minutos en el lado del servidor sfcom. Los PUTs actualizan la base de datos de WooCommerce de inmediato, pero los GETs siguen devolviendo el valor anterior durante hasta 5 minutos. Para evitar falsos positivos, `verificarSfcom` consulta el `sessionStorage` antes de reportar cada discrepancia: si `syncStockToSfcom` registró un PUT para ese par hace menos de 6 minutos y el stock puesto coincide exactamente con el `stockEsperado` calculado ahora, la discrepancia se omite (se considera artefacto del TTL, no una desincronización real) y `_stockCache` se actualiza con el valor correcto. Esta lógica vive en `_getRecentSync` / `_markRecentlySync`. La guarda `!pendingExplains` es obligatoria: cuando sfcom ha vendido algo propio (`pendingExplains = true`), el caso semántico es distinto y nunca debe suprimirse.

### sfcom-panel.js
Módulo ES6. Panel de gestión sfcom con KPIs, solicitudes pendientes, reservas con sfcom_order_ref, y listings activos con stock. Lee `availability_with_sfcom`. No escribe en BD. Usa `ejecutarVerificacion` y `mostrarToast` de `verificacion.js`. La función local `_ejecutarVerificacionPanel(modoManual)` llama a `ejecutarVerificacion` y después actualiza la columna de stock real de la tabla de listings vía `actualizarStockDesdeVerificacion`.

KPIs incluyen: total neto de ventas sfcom, coste de proveedores, y margen neto (cruza cada reserva sfcom activa con disponibilidad para calcular coste unitario según billing_model).

**Tabla "Reservas registradas vía sfcom":** 12 columnas — Referencia sfcom, Cliente, Evento, Día, Nombre sfcom, Plazas, Precio neto/plaza, Total neto, Com. 15% (`total_neto × 0.15`), Total reserva (`total_neto × 1.15`), Venue, Estado. Incluye fila de totales al pie (suma de plazas, total neto, comisión y total reserva). El botón "⬇ Excel" exporta las mismas columnas con una fila final `TOTAL`.

### factura.js
Módulo ES6, importado por formulario.js. `initFacturacion(supabase)`.

Genera facturas PDF (via jsPDF) para hitos de cobro. Tres tipos: `adelanto` (pago parcial), `liquidacion` (pago final con adelantos previos ya facturados), `unico` (pago único sin adelantos).

Emisor: Paula Díaz Echalecu, NIF 72694758S. IVA: 21%. IRPF: según cliente (15% si ES + empresa, 0% en caso contrario). Serie: VSF. Número correlativo por ejercicio (calcula consultando invoice_number en charges del año en curso). Campos editables con `contenteditable`. Persiste `invoice_number` e `invoiced: true` en charges.

La lógica fiscal está centralizada en `fiscal-config.js`: `PERFIL_FISCAL`, `irpfRateParaCliente(cliente)` y `esFacturaSimplificada(cliente, totalConIva)`. `irpfRateParaCliente` devuelve 15 solo si el cliente es empresa (`is_business=true`) y país ES; devuelve 0 en cualquier otro caso. Una factura es simplificada si el cliente es particular (`is_business=false`) Y el total con IVA ≤ 400 €.

Exporta `baseDesdeTotalFacturado(totalFacturado)` y `totalFacturadoDesdeBase(base)` — únicos puntos de la fórmula `total = base × (1 + iva − irpf)`. Usadas por `formulario.js` para el campo "Precio final facturado" del Bloque 2.

El nombre del receptor usa `_cliente.company ?? _cliente.name ?? _cliente.id`. El saludo en email usa `_cliente.name ?? _cliente.id` (nombre de contacto, no empresa).

**Facturas simplificadas:** cuando el cliente es particular y el total IVA incluido ≤ 400 €, la factura omite el bloque de datos del destinatario (nombre, NIF, dirección) tanto en el HTML de previsualización como en el PDF. El panel muestra un selector radio "Simplificada / Completa" para sobrescribir la detección automática cuando sea necesario. Estado en `_simplificadaManual` (null = auto).

**Re-emisión y anulación:**
- `abrirPanelReemision(hitoId, clienteObj, reservasCliente)` — abre el panel de factura en modo re-emisión: usa el mismo número de factura ya emitido, al confirmar marca el registro anterior como `is_void=true` e inserta uno nuevo. El PDF se sube con el mismo nombre (la política UPDATE de Storage permite sobreescribir).
- `anularFacturaDeHito(hitoId)` — marca `is_void=true` en `issued_invoices` y limpia el hito (`invoiced=false`, `invoice_number=null`, `invoice_path=null`, `invoiced_at=null`).
- Ambas se exportan y se llaman desde `formulario.js`. Los botones 🔄 y ✕ aparecen junto al número de factura en la tabla de cobros cuando el hito está facturado.

**Concepto de servicio (`_serviceLabel(r)`):** `service_name — venue_display_name` (fallback: `venue_id` si `display_name` es null; si no hay `service_name`, usa `service_description` o `service_id`). La celda es editable con `contenteditable` antes de emitir. Los labels editados se capturan en `_emitir()` como `svcLabels[]` y se pasan a `generarPDF`. La query de `cargarReservasCliente` join `venues(display_name)` para tener `venue_display_name` disponible en cada reserva.

**Aislamiento sfcom en facturación:** `facturarHito` en `formulario.js` filtra antes de llamar a `abrirPanelFactura`: excluye reservas con `origin_ref.startsWith('WEB')` y charges con `comments.startsWith('WEB') && comments.includes('Cobrado v')` (el único identificador disponible, ya que `charges` no tiene FK a `reservation_id`). Esto evita que reservas sfcom aparezcan como líneas de servicio, que charges sfcom bloqueen la validación de factura final, y que inflen los importes previos en facturas de liquidación.

**Flujo de envío:** al abrir el diálogo, `abrirPanelFactura` llama a `mostrarOpcionesEnvio` con `tipo='pdf'` y `onGenerar=_emitir`. Los botones (Solo PDF / PDF+correo / PDF+WhatsApp) se renderizan en `#factura-botones-envio` dentro del footer del `<dialog id="dialogFactura">`. El botón con foco es WhatsApp si hay teléfono, Email si hay email, Solo PDF si no hay contacto. Un clic ejecuta `_emitir()`: lee los campos editables del preview, actualiza datos del cliente si cambiaron, genera el PDF, lo sube a Storage (bucket `invoices`), persiste `invoice_number`, `invoiced: true`, `invoiced_at` en el hito y dispara `facturaEmitida`; después abre el canal elegido. Templates de asunto/cuerpo en `FACTURA_CONFIG` al inicio del módulo.

### propuesta.js
Módulo ES6, importado por formulario.js. `initPropuesta(supabase, servicios, venues, getDisponibilidad)`.

Genera propuestas PDF para reservas seleccionadas. Serie PRP. Textos editables en el mock-up. Logo en base64 cargado al inicializar. Nombre del servicio: `svc.name ?? svc.description ?? r.service_id`.

**Flujo de envío:** al abrir el diálogo, `abrirPanelPropuesta` llama a `mostrarOpcionesEnvio` con `tipo='pdf'` y `onGenerar=_generarYSubir`. Los botones (Solo PDF / PDF+correo / PDF+WhatsApp, según contacto disponible) se renderizan en `#propuesta-botones-envio` dentro del footer del `<dialog id="dialogPropuesta">`. El botón con foco es WhatsApp si hay teléfono, Email si hay email, Solo PDF si no hay ninguno. Un clic genera el PDF, lo sube a Storage (bucket `proposals`), persiste `proposal_number` y `proposal_path` en todas las reservas de la propuesta, dispara `propuestaEmitida` y abre el canal elegido. La función se llama de nuevo cada vez que se abre el diálogo (por si el cliente cambia entre aperturas).

### tablas.js
Módulo ES6. Vista de todas las tablas con edición inline de campos específicos. Selector de tabla, búsqueda en tiempo real, sort por columna, botón "⬇ Excel" con SheetJS.

Tabs disponibles: `reservations`, `charges`, `payments`, `reservation_requests`, `availability`, `venues`, `clients`, `providers`, `services`, `sfcom_listings`.

**Edición inline:** los campos editables se definen en el mapa `EDITABLE` por tabla. Un clic en una celda editable abre un input inline con botón ✓/✗. Los campos con `cascade` disparan lógica adicional tras guardar:
- `cascade: 'cobros'` → `_guardarAmountCobro` → modal + `persistirCobrosCliente` (charges.amount)
- `cascade: 'pagos'` → `_guardarAmountPago` → modal + `persistirPagosProveedor` (payments.amount)
- `cascade: 'cobros-final'` → `_guardarIsFinalCobro` → modal con escenarios de cambio de is_final en charges
- `cascade: 'pagos-final'` → `_guardarIsFinalPago` → modal con escenarios de cambio de is_final en payments
- `cascade: 'sfcom-slots'` → verificación de plazas vendidas antes de actualizar sfcom_slots_listed
- `cascade: 'slots'` → `_guardarSlots` → verifica capacidad si se aumenta (bloqueo duro si supera `total_slots - plazasOtras`); para WEB%: crea cobro de ajuste en ficha del cliente real (formato `"${origin_ref} Cobrado vía sfcom"`, `collected=true`, `is_final=false`) + llama `persistirCobrosCliente` para cliente real Y para `'SFCOM'`; para no-WEB%: solo llama `persistirCobrosCliente` para el cliente; siempre llama `persistirPagosProveedor` si hay proveedor y `syncStockToSfcom` si hay listing sfcom; invalida propuesta PDF compartida
- `cascade: 'price-per-slot'` → `_guardarPricePerSlot` → para WEB%: crea cobro de ajuste (mismo formato/flags) + llama `persistirCobrosCliente` para cliente real Y para `'SFCOM'`; para no-WEB%: usa `_preCalcularCobros` + llama `persistirCobrosCliente`; invalida propuesta PDF compartida
- `cascade: 'avail-slots'` → `_guardarAvailSlots` → bloqueo duro si `plazasTotales > nuevoSlots` (no se permite reducir por debajo de las vendidas); si pasa el bloqueo, llama `persistirPagosProveedor`; si `sfcom_slots_listed > nuevoSlots`, reduce sfcom_slots_listed y sincroniza stock con `syncStockToSfcom(supabase, row.venue_id, row.service_id)`
- `cascade: 'avail-price'` → `_guardarAvailPrice` → recalcula coste con disponibilidad modificada (simulación previa), llama `persistirPagosProveedor`; usado también por `billing_model`

**Edición de is_final (charges y payments):** cambiar is_final activa un modal con todos los escenarios posibles (sin cambio → no-op silencioso; true→false → "convertir en adelanto" con opción de recalcular; false→true → "convertir en final" con verificación de importe y recálculo). El recálculo llama a `persistirCobrosCliente` / `persistirPagosProveedor`.

**Propuesta PDF:** `_limpiarPropuestaReserva(row)` desvincula el PDF de todas las reservas que comparten la misma propuesta (por `proposal_number` o `proposal_path`). El archivo físico en Storage queda huérfano (aceptado). Se llama en `_guardarPricePerSlot` y en `_guardarSlots`.

**`_eliminarCobro`:** si el cobro tiene `invoice_number`, consulta `issued_invoices` por `charge_id`. Trimestre cerrado → modal 🔒. Trimestre abierto → confirmación → borra PDF + charge (CASCADE elimina `issued_invoices` + vat\_lines) → `persistirCobrosCliente`. Sin factura activa pero con `invoice_path` en el charge → borra archivo + charge. Sin factura en absoluto → confirmación simple + delete.

**`_eliminarProveedor`:** verifica venues (bloqueo) y payments (bloqueo) como antes. Luego consulta `supplier_invoices` y `supplier_documents` vinculados por `provider_id`. Si existen, advierte cuántos asientos/documentos quedarán sin proveedor asignado y pide confirmación. Al confirmar: UPDATE SET `provider_id = NULL` en ambas tablas antes de borrar el proveedor. Los asientos permanecen en el libro fiscal, solo quedan desvinculados.

**Filosofía:** tablas.js es la herramienta de emergencia para corregir estados que no pueden arreglarse desde el panel normal. Se permite editar todo, pero nunca se deja la BD inconsistente sin que el usuario lo elija explícitamente. Toda inconsistencia elegida voluntariamente se autocorrige en el siguiente uso normal del panel (o la detecta la verificación financiera).

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

### fiscal.js
Módulo ES6. Página `fiscal.html`. Libro fiscal del trimestre activo: pestañas Gastos (facturas recibidas), Emitidas (facturas emitidas), F69 (modelo IVA trimestral), M-715 (retenciones trimestrales) y M-190 (retenciones anuales). Selector de año/trimestre persiste en localStorage.

`cargarTodo()` ejecuta queries en paralelo y alimenta todas las pestañas. Arrays de módulo:
- `_gastosData` — todas las `supplier_invoices` del trimestre (incluidas las vinculadas a proveedor). Fuente para F69, M-715, exportación Excel, ZIP y paquete asesor.
- `_emitidasData` — facturas emitidas del trimestre. Fuente para F69, ZIP y paquete asesor.
- `_gastosAnualesData` — todas las `supplier_invoices` con retención del año natural completo. Fuente exclusiva para M-190 y la hoja `190-{year}` del Excel.

**`renderGastos(rows, closedSet)`:** muestra **todas** las `supplier_invoices` del trimestre sin filtrar por `provider_id`. Las facturas vinculadas a proveedor muestran el `provider_id` en la columna "Categoría / Proveedor" (en monoespaciado); las no vinculadas muestran la categoría libre. Columna IRPF en ámbar (`--accent-warn`) si > 0, `—` si cero. Fila de totales incluye IRPF cuando hay retenciones, para contrastar con F69 y M-715. `closedSet` (Set de strings `"YEAR-QUARTER"`) determina si cada fila está en trimestre cerrado: en ese caso la celda de acciones muestra 🔒 en lugar de 🗑. La fecha comprobada es `booked_date ?? issue_date`, coherente con el trigger de BD.

**`eliminarGastoFiscal(id)`:** consulta `booked_date` del asiento antes de confirmar. Trimestre cerrado → modal 🔒. Trimestre abierto → `confirm()` + DELETE (CASCADE elimina `supplier_invoice_vat_lines`). El documento vinculado no se borra.

**Alertas fiscales (`cargarAlertas`):** cinco tipos de alerta con sistema de dismiss por sentinels (ver §7.6). Las funciones `descartarAlerta(key, extra)` y `recuperarDescartados(tipo)` son globales en este módulo.

**Cierre de trimestre:** al presentar el modelo F69, inserta en `fiscal_closings`. A partir de ese momento los triggers de BD (`trg_supplier_invoices_immutable`, `trg_issued_invoices_immutable`) bloquean cualquier INSERT/UPDATE/DELETE en las tablas fiscales del trimestre cerrado.

**Exportaciones / paquete asesor:** El ZIP del paquete asesor contiene documentos recibidos (bucket `supplier-invoices`), facturas emitidas (bucket `invoices`) y un Excel (SheetJS) con hasta 5 hojas: `Gastos` (todas las facturas recibidas del trimestre con columna IRPF), `Emitidas`, `F69-T{q} (borrador)` (IVA devengado/soportado por tipo + resultado), `M715-T{q} (borrador)` (retenciones por clave, solo si hay), `190-{year} (borrador)` (perceptores del año completo, fuente `_gastosAnualesData`). Las hojas de borrador incluyen una fila de aviso recordando que los datos son los reflejados en el archivo.

### analisis-fiscal.js
Módulo ES6. Exporta `iniciarAnalisisFiscal()`, llamado desde `fiscal.js` al arrancar. Renderiza el bloque `#bloque-analisis-fiscal` en `fiscal.html`, fuera del contenedor trimestral existente.

**Por qué está separado del bloque Fiscal:** el bloque Fiscal está gobernado por el selector de trimestre (modelo F69, IVA). Este módulo es anual y responde a la temporada activa del sistema (`getTemporadaActiva()`), no al trimestre. El IRPF no existe por trimestre.

**Controles (recalculan en vivo, no se persisten):**
Renderizados una sola vez en `_renderControles()`, en la cabecera del bloque. Los recálculos (`_recalcular()`) solo actualizan `#af-total` y `#af-tabla`.
- Bruto adicional anual (input, default 60.000 €): otros rendimientos del ejercicio. Base previa para el doble cálculo de IRPF.
- Selector Directa normal / Directa simplificada (−5%): en simplificada, `ajuste = min(beneficio_fiscal × 0.05, 3000)` se resta de la base fiscal antes de calcular el IRPF.

**Ingresos — dos fuentes distintas:**
- `ingresos_reales` = Σ `reservations.total_amount` (Confirmadas, temporada). Todos los cobros reales, facturados o no.
- `ingresos_declarados` = Σ `issued_invoice_vat_lines.base_amount` (temporada, `is_void = false`). Solo lo facturado — la base que entra en el IRPF.

**Coste — calculado desde `availability`, NOT de `payments`:**
- `capacity` → `total_slots × price_per_slot`. El balcón se paga entero, haya o no reservas.
- `consumption` → `plazas_vendidas × price_per_slot`.
- `fixed` → `price_per_slot` (importe único, una vez por par venue×servicio) si hay alguna plaza vendida; 0 si no.

**Deducibilidad de costes — prorrateo por proveedor, fuente: libro fiscal:**
Dos pasadas sobre `availability`:
1. Primera: `cr` por par `(venue_id|service_id)`, y `crSumProv[provId] = Σ cr` del proveedor.
2. Segunda: `ratio = min(fiscalDeducProv[provId] / crSumProv[provId], 1)` y `cd = cr × ratio`.

`fiscalDeducProv[provId] = Σ supplier_invoices.total × (deductible_pct / 100)` — directo del libro fiscal, por proveedor y temporada. `deductible_pct` permite deducibilidad parcial (default 100). Ruta venue→proveedor: `venues.provider_id`.

Si `fiscalDeducProv > crSumProv` (más facturado que imputado), el ratio se recorta a 1 — nunca se declara más de lo pagado.

**Gastos generales — dos fuentes distintas:**
- `gastos_grales_reales` = Σ `supplier_documents.amount WHERE provider_id IS NULL` (bandeja operativa, season=X).
- `gastos_grales_deducibles` = Σ `supplier_invoices.total × deductible_pct/100 WHERE provider_id IS NULL` (libro fiscal, season=X).

**Dos beneficios:**
- `beneficio_real = ingresos_reales − coste_real_total − gastos_grales_reales`
- `beneficio_fiscal = ingresos_declarados − coste_deducible_total − gastos_grales_deducibles`

Identidad útil para entender la diferencia: `bf = br − ing_no_decl + coste_no_ded + gg_no_ded` (ingresos sin declarar reducen la base; costes sin factura la aumentan).

**IRPF Navarra:** `ΔIRPF = irpfNavarra(bruto + max(bf_ajust, 0)) − irpfNavarra(bruto)`. `tipoMarginal(base)` devuelve el tipo marginal en un nivel de renta dado (para la línea "tramos del X% al Y%"). Tarifa 2026 (art. 59 TRLFIRPF, Ley Foral 22/2023). ⚠️ Revisar cada año.

**Alerta de registros pendientes:** query HEAD sobre `supplier_documents WHERE has_invoice=true AND file_path NOT ILIKE '%_sin_archivo'`. Si el recuento supera `supplier_invoices.length`, hay documentos con factura aún sin anotar al libro → aviso ámbar en el bloque de análisis.

**Presentación — estructura:**
- Cabecera: título + controles en flex-row (flex-wrap en móvil).
- Aviso ámbar: estimación orientativa; si `tieneAlertas`, añade frase sobre registros pendientes.
- Bloque principal: flex-row con wrap en móvil.
  - Izquierda (185px): 4 cajas métricas apiladas: Margen del negocio (% sobre ingresos) / IRPF de San Fermín / Resultado neto real (% sobre ingresos) / IRPF equivalente (% del margen).
  - Derecha (flex:1, min-width:300px): tabla explicativa con 3 líneas maestras + desplegables `<details>` (cerrados por defecto): Margen real del negocio → desglose (ingresos − costes) / Margen que computa Hacienda → desglose en dos mitades (con factura / sin factura) / IRPF atribuible → cálculo doble (IRPF sin SF, IRPF total, diferencia). Línea "Tipo medio ponderado" (13px) entre el desplegable y el DSEP. Doble separador antes del resultado final para señalar visualmente que `resultado = margen_real − IRPF`, no que desciende de la base imponible.
- Escenario hipotético: caja gris en anchura completa. Muestra qué pasaría si todo estuviera facturado y declarado (`bf_hyp = beneficio_real`): IRPF recalculado con `irpfNavarra(_bruto + bf_ajust_hyp) − irpf_sin`, resultado neto e IRPF equivalente. No contiene juicio de valor.

**Tabla por venue × event_type:**
Agrupa todos los servicios del mismo `event_type` para un `venue_id` en una fila. Columnas: Venue / Evento / Plazas / Ingreso / Coste real / Deducible / G.grales (prorrateo proporcional al ingreso) / Margen / Neto (−IRPF prorrateo). Filas con ingreso=0 Y coste=0 excluidas. Sort estable sucesivo; primer clic siempre ascendente. Si sort activo es `venue_id` o `event_type`, muestra filas de subtotal encima de cada grupo.

**Trampas:**
- El coste sale de `availability`, no de `payments`. `payments` es tesorería, no sabe de plazas ni modelos de facturación.
- La deducibilidad viene del libro fiscal (`supplier_invoices`), no de `supplier_documents.has_invoice`.
- En `capacity`, `coste_real` usa `total_slots` aunque ventas sean menores — correcto: el balcón cuesta igual se llene o no.
- El IRPF se calcula sobre `beneficio_fiscal` (base deducible), el margen sobre `beneficio_real`. Son distintos a propósito.
- `fiscalDeducProv > crSumProv` es posible (más facturado que imputado): el exceso se ignora silenciosamente.

### gastos.js
Módulo ES6. Página `gastos.html`. Gestión operativa de gastos generales del negocio (`supplier_documents` con `provider_id IS NULL`): alta, edición, eliminación y anotación fiscal. Complementa `proveedores.html` (gastos de proveedor) y `fiscal.html` (libro fiscal resultante).

**Tabla de gastos:** columnas Concepto · Fecha · Importe · Documento · Estado fiscal · Acciones. Cada fila es clicable para editar. La columna de acciones muestra 🔒 (trimestre cerrado, sin edición) o 🗑 (borrar). El botón "Anotar" solo aparece si `has_invoice !== false`.

**Formulario único** para alta y edición (mismo HTML, título y botón cambian). Campos: concepto (req), fecha del gasto (req, default hoy), importe (req), checkbox "tiene factura", selector de temporada (discreto), dropzone de archivo. Al hacer clic en una fila se carga el gasto en el formulario (modo edición).

**Visor de archivo integrado:** cuando hay un archivo disponible (local recién seleccionado o existente en storage), el formulario adopta automáticamente el mismo layout de dos columnas que el modal de anotar (`dlg-gasto-layout`): viewer a la izquierda (imagen o iframe PDF con zoom en imágenes), campos a la derecha. El viewer se oculta al cancelar o cuando no hay archivo. Para archivos locales se usa `URL.createObjectURL`, revocado al cerrar el formulario.

**Leer con IA (`claude-haiku-4-5-20251001`):** extrae `issuer_name`, `issuer_nif`, `invoice_number`, `issue_date`, `vat_lines`, `irpf_rate/amount`, `suggested_category`, `concept` y `total`. Cuatro estados del botón:
- `disabled` — sin archivo disponible
- `🤖 Leer con IA` — archivo disponible, no leído aún
- `⚠️ Re-leer con IA` (opacidad 55%) — ya leído (`issuer_nif || ai_vat_lines` presentes); tooltip advierte del coste
- `✅ Leído` — procesado en esta sesión

En modo edición con archivo existente, el botón se habilita obteniendo una URL firmada del bucket (igual que `dlg-gasto.js`). Al seleccionar un nuevo archivo sobre un doc con IA previa, los campos concepto/fecha/importe toman borde ámbar como señal de que pueden ser del documento anterior; desaparece al releer.

**Comportamiento de prefill IA:** modo nuevo → solo rellena campos vacíos (fecha solo si sigue en HOY). Modo edición → sobreescribe todos los campos extraídos.

**Cambio de archivo en edición:** el archivo viejo no se borra del bucket ni se cambia `file_path` hasta el save. Si se guarda con nuevo archivo sin releer IA, los campos IA se ponen a `null` en BD.

**Fiscal check dos niveles** (función `_guardarFiscalCheck(docId, accion)`): comprueba si el doc tiene entrada en `supplier_invoices` y si su trimestre (`booked_date`) está cerrado en `fiscal_closings`. Resultados: `'libre'` (no hay asiento), `'bloqueado'` (trimestre cerrado → alert), `'cancelado'` (usuario rechazó confirm), `'ok'` (asiento borrado, vat lines en cascade). Se aplica al guardar en edición y al eliminar.

**has_invoice → false en edición:** si el doc no tenía asiento (`'libre'`), pide confirmación leve. Si tenía asiento, el fiscal check ya pidió confirmación y lo borró.

**Filas en trimestre cerrado:** `opacity: 0.7`, sin onclick, 🔒 en lugar de 🗑.

**Alerta 1 en `fiscal.js`:** los gastos con `has_invoice !== false` pero sin anotar aparecen en alertas. Se dividen en dos sub-secciones: los que tienen archivo (Anotar + Descartar) y los que usan el sentinel `_sin_archivo` (solo Descartar + enlace a `gastos.html`).

### dlg-gasto.js
Módulo ES6 compartido. Exporta `abrirDlgGasto(docOrId, provider, onGuardado)`. Importado por `gastos.js` (botón "Anotar" en la tabla) y `proveedores.js` (botón "Anotar factura" en la ficha del proveedor). Abre el modal `dlgGasto` con layout ancho de dos columnas cuando hay archivo previsualizable.

**Layout:** viewer (imagen o iframe PDF) a la izquierda, formulario a la derecha. El viewer solo aparece si hay `signedUrl` y el archivo es imagen o PDF. Zoom con clic en imágenes.

**Selector Simplificada / Completa:** actúa exclusivamente como control de visualización. La lectura IA siempre rellena ambas secciones del DOM (total simplificado, IVA simple, líneas de IVA, IRPF y total completo) independientemente del tipo activo. Cambiar de tipo en cualquier momento conserva todos los datos ya cargados. El selector por defecto se determina por el documento: si tiene `invoice_number` o extensión PDF → completa; imagen sin número → simplificada.

**Leer con IA:** se deshabilita si los datos fiscales ya están pre-extraídos en `supplier_documents` (`issuer_nif || ai_vat_lines`). El prompt es idéntico al de `gastos.js` excepto que no incluye `suggested_category` ni `concept` (los datos del libro tienen precedencia sobre el concepto operativo).

**Validación de trimestre al guardar:** al abrir el modal se carga `closedSet` (trimestres cerrados de F69). `_dlgCheckFecha` usa el set para distinguir "fecha antigua" (aviso genérico) de "fecha en trimestre ya presentado" (aviso específico). En el guardado, si `booked_date` cae en un trimestre cerrado, se bloquea con `alert` antes del INSERT — la simplificada computa `booked_date = issue_date`, por lo que también queda bloqueada si la fecha del ticket es de un trimestre cerrado. Solución: cambiar a modo "Factura completa" y ajustar `booked_date` a un trimestre abierto.

**Al guardar**, además de insertar en `supplier_invoices` y `supplier_invoice_vat_lines`, se hace también un `UPDATE supplier_documents` con los datos revisados en el modal (`issuer_name`, `issuer_nif`, `invoice_number`, `issue_date`, `irpf_rate/amount`, `ai_vat_lines`). Esto garantiza que el documento quede siempre enriquecido con la lectura más reciente, tanto para gastos generales como para facturas de proveedor.

**`eliminarDocProveedor(docId, filePath)`:** consulta `supplier_invoices` vinculado al documento (`document_id = docId`). Si existe asiento: trimestre cerrado → modal 🔒; trimestre abierto → confirmación → DELETE del asiento (CASCADE elimina vat\_lines) → borra archivo del bucket `supplier-invoices` → borra el documento. Si no existe asiento: confirmación simple → borra archivo → borra documento. La FK `supplier_invoices.document_id → supplier_documents.id` exige borrar el asiento antes que el documento.

**Enriquecimiento del proveedor** (solo cuando `provider != null`, es decir, desde `proveedores.js`): al guardar, `_actualizarProveedor` compara los datos leídos en la factura con los que tiene el proveedor en BD:
- NIF: si el sistema no tiene NIF → guardar directamente. Si son distintos → `confirm()` campo a campo.
- Nombre: si el leído contiene al del sistema como subcadena (case-insensitive) → el nuevo es más completo, actualizar automáticamente. Si son distintos → `confirm()`.
- Solo se actualizan `name` y `nif` en `providers`. La dirección y otros campos no se tocan desde aquí.

### fiscal-config.js
Exporta constantes y funciones de lógica fiscal compartidas entre `factura.js` y cualquier otro módulo que necesite calcular IVA o IRPF. Ver documentación en `### factura.js` arriba.

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

Solo se incluyen aquí las deudas sin resolver. Las deudas cerradas (✅ RESUELTO) están en `CLAUDE_ADMIN_BACKLOG.md`.

**Para mover una deuda cerrada al backlog sin cargar ese archivo:**
```powershell
Add-Content -Path "CLAUDE_ADMIN_BACKLOG.md" -Value "`n---`n`n### [Título] — ✅ RESUELTO (fecha)`n`n[descripción]"
```

---

### 7.1 Bugs — comportamiento incorrecto activo

Sin bugs activos en este bloque.

---

### 7.2 UX — puntos de fricción en el uso diario

**UI no refleja datos derivados ni efectos secundarios hasta recargar la página.**

Patrón recurrente: cuando una operación de guardado tiene efectos secundarios en Supabase (trigger, `persistirCobrosCliente`, `persistirPagosProveedor`, etc.), la UI actualiza solo lo que el JS modificó directamente.

Caso resuelto (jul 2026): `_savePhotos` en `proveedores.js` ya actualiza en memoria todas las filas con el mismo `venue_id + event_type` tras guardar, reflejando el efecto del trigger `trg_sync_availability_event_type`.

Casos pendientes: los campos `description` y `access_instructions` se guardan vía `initAutoSave` sin callback que actualice filas hermanas en `todaDisponibilidad`. Fix natural cuando se toquen esos archivos.

---

---

### 7.4 Schema — pendiente

**Temporada de `reservation_requests` se infiere de `created_at`, no de un campo explícito.** `temporadaDeFecha(created_at)` asigna la temporada: fechas antes del 15 de julio → temporada del año en curso; 15 de julio en adelante → siguiente. Una solicitud creada en 2026 antes del 15 de julio queda en temporada 2026 aunque debería ser 2027. El problema no bloquea el flujo actual (el filtro de temporada no aplica a solicitudes, solo a reservas), pero puede generar confusión en la vista de solicitudes. Pendiente: auditar si añadir columna `season` explícita a `reservation_requests` merece el cambio de schema, o si basta un ajuste en `temporadaDeFecha` para este tipo de entidad.

**`service_code` no es editable desde `tablas.js` (deuda Fase 10).**

Se decidió no hacerlo hasta auditar el código hardcoded que depende de `service_code`: la constante `TIPO_SERVICIO_ID` en `formulario.js`, la función `_inferirServiceId`, y los patrones regex `/^ENCIERRO_(\d+)$/`. Preguntas abiertas: con el PK entero ya en uso, ¿sigue siendo necesario el hardcode o se puede derivar dinámicamente? Hasta resolverlo, `service_code` no es editable. Acción: auditar `TIPO_SERVICIO_ID` y los regex en `formulario.js` y decidir si el hardcode puede eliminarse (probablemente sí, dado que las FK ya van por integer PK).

---

### 7.6 Fiscal — deudas pendientes

**[RESUELTO jul 2026] Protección homogénea de trimestre cerrado en todo el sistema.**

Funciones compartidas en `utils.js`: `checkTrimCerrado(supabase, date)` (consulta `fiscal_closings`, devuelve `{ cerrado, year, quarter }`) y `mostrarModalTrimCerrado(year, quarter, desc?)` (modal 🔒 rojo bloqueante, texto estándar o personalizado).

Criterio uniforme aplicado en todos los flujos con asiento fiscal:
- **Trimestre cerrado** → modal 🔒 bloqueante. "Si es imprescindible, llama al administrador de la BD."
- **Trimestre abierto con asiento** → confirmación; si acepta, se borra el asiento y la operación continúa.
- **Sin asiento** → operación libre.

Fecha de referencia: `issued_invoices` usa `accrual_date`; `supplier_invoices` usa `booked_date` (que es lo que comprueba el trigger `trg_supplier_invoices_immutable`).

Cobertura:
- `factura.js`: anular, reemitir y emitir nueva (sanity sobre `hoy`).
- `formulario.js`: `_guardFiscalCliente` (bloqueo si cliente tiene facturas en trimestre cerrado), `eliminarCobroCliente` (check trimestre → borra PDF + charge con CASCADE).
- `tablas.js`: `_eliminarCobro` (mismo criterio que `eliminarCobroCliente`), `_eliminarProveedor` (avisa de asientos/documentos vinculados y hace SET provider\_id = NULL — los asientos no se borran).
- `fiscal.js`: `eliminarGastoFiscal` (check trimestre antes de confirmar), `renderGastos` (🔒 en lugar de 🗑 para trimestre cerrado).
- `proveedores.js`: `eliminarDocProveedor` (check trimestre del asiento vinculado; si abierto, borra asiento → archivo → documento).
- `dlg-gasto.js`: bloquea el guardado si `booked_date` es de trimestre cerrado; `_dlgCheckFecha` diferencia "fecha antigua" de "fecha en trimestre ya presentado".

**Sort estable sucesivo — solo implementado en `analisis-fiscal.js` (jul 2026).** El resto de tablas del panel con sort (`tablas.js`, `panel.js`) usan `sortArr` de `utils.js`, que crea una copia nueva y reordena desde cero en cada clic. El sort estable sucesivo (aplicar `.sort()` sobre el array ya ordenado) permite el efecto "agrupa por columna B y dentro de cada grupo conserva el orden de la columna A anterior". No trivial de migrar: cambia cómo cada tabla mantiene el estado de ordenación. Deuda identificada, no prioritaria.

**Dismiss de alertas fiscales — implementado con sentinels (jul 2026).**

Los 5 tipos de alerta usan sentinels en tablas existentes, sin migración de esquema:
- Alerta 1 (docs sin anotar): prefijo `*` en `supplier_documents.notes`. Recuperar limpia el prefijo.
- Alerta 2 (proveedores con pagos sin factura): prefijo `*importe ` en `providers.comments`. Auto-revive si el importe de la discrepancia cambia más de 0,01€ respecto al sentinel almacenado.
- Alerta 3 (emitidas sin PDF): sin dismiss — adjuntar el PDF es la única acción válida.
- Alerta 4 (cobros sin facturar): sentinel `invoiced_at = '0001-01-01'` en `charges`, por cobro individual. Recuperar restaura `invoiced_at = null`.
- Alerta 5 (trimestres sin presentar): sin dismiss — presentar es la única acción válida.

Función `descartarAlerta(key, extra)` y `recuperarDescartados(tipo)` en `fiscal.js` (globales).

---

### 7.5 Mejoras de código

**`formulario.js` demasiado grande (~2600 líneas).**

Tres candidatos para extracción si el tamaño se convierte en problema práctico:
- `sfcom-solicitudes.js` (~300 líneas): Bloque 0 + `registrarPedidosSfcom` + modales sfcom.
- `reorganizar.js` (~200 líneas): panel de reorganización (el más autocontenido).
- `cobros.js` (~300 líneas): Bloque 5 + `persistirHitosCliente` + `cargarCobrosCliente`.

No hacer hasta que el tamaño sea un problema práctico. Si se decide, empezar por `reorganizar.js`.

---

### 7.7 Mejoras de UX — pendiente de decisión

**Facturas recibidas en Tablas → Archivos.**

Actualmente la sección Archivos de `tablas.html` / `tablas.js` tiene dos tabs:
- 📄 Propuestas — bucket `proposals`, vinculadas a `reservations.proposal_path`
- 🧾 Facturas — bucket `invoices`, vinculadas a `issued_invoices.file_path`

Pendiente: añadir una tercera tab **🗂 Facturas recibidas** para el bucket `supplier-invoices`, vinculado a `supplier_documents.file_path`. La tab "Facturas" existente pasaría a llamarse "Facturas emitidas".

Los archivos del bucket `supplier-invoices` están referenciados en `supplier_documents`, que a su vez puede tener un asiento en `supplier_invoices` (FK `document_id`, UNIQUE). La relación es: archivo en storage → `supplier_documents` → (opcional) `supplier_invoices` → `supplier_invoice_vat_lines`.

**Requiere diseño previo antes de implementar.** Las acciones posibles sobre cada archivo tienen una casuística no trivial que hay que especificar explícitamente:

- Archivo vinculado a un asiento en **trimestre cerrado** → solo lectura completa (los triggers de BD ya bloquean INSERT/UPDATE/DELETE, pero la UI debe reflejarlo con 🔒 y sin botones de acción).
- Archivo vinculado a un asiento en **trimestre abierto** → mostrar botón "Eliminar" que: advierte del asiento fiscal vinculado, confirma, borra `supplier_invoices` (cascade a vat_lines), borra el archivo del storage y borra `supplier_documents`.
- Archivo sin asiento vinculado (huérfano, `supplier_documents` sin `supplier_invoice`) → eliminar libremente (solo storage + `supplier_documents`).
- Archivos con `has_invoice = false` (albaranes, recibos sin factura) → ¿mostrarlos? ¿con indicador visual diferente?
- Estado de pago del proveedor vinculado (`payments.paid`) → ¿influye en alguna acción? Decidir si se muestra o no.
- Documentos descartados de alertas (prefijo `*` en `supplier_documents.notes`) → ¿mostrarlos? ¿con indicador?

Decidir también si las acciones de esta sección deben replicar el flujo de `eliminarDocProveedor` en `proveedores.js` o abstraerlo a una función compartida en `utils.js`.

---

### 7.8 Conocido y aceptado

**Falsos positivos en verificación sfcom por TTL de caché del servidor.** `stock-all` en `sf-api-paula.php` trabaja contra una caché con su propio TTL. Una verificación justo después de un PUT puede mostrar discrepancia aunque el PUT fue correcto. Desaparece sola; no requiere acción.

**`persistirCobrosCliente` auto-crea un cobro "final" al guardar cualquier cobro del cliente.** Al añadir un hito de cobro manualmente en bloque 5, el JS llama también a `persistirCobrosCliente`, que calcula e inserta (o actualiza) el "cobro final". Resultado: al crear el primer cobro manual, aparecen dos filas en `charges`. No se duplica (el cálculo upserta la misma fila). Comportamiento esperado, no es un bug.

**El modal de confirmación "¿eliminar también el cliente?" desaparece si navegas.** Si el usuario navega antes de confirmar, el modal desaparece y el cliente queda en la BD sin forma de borrarlo desde ningún flujo normal. Solución propuesta: tratar el cierre del modal como "No, conservar cliente" y redirigir automáticamente a la ficha del cliente. A evaluar junto con la deuda §7.2 (botón directo de borrado).

**`invoiced` en `charges` es redundante** con `invoice_number IS NOT NULL`. Se mantiene por conveniencia en filtros de consulta.

**Auto-transición `respuesta_enviada → seguimiento_pendiente` solo se evalúa al cargar `solicitudes.html`.** Si la sesión lleva días abierta, el badge puede quedar desfasado. En la práctica no es problema porque la página se recarga con frecuencia.

**Las vistas de Supabase son siempre en tiempo real.** No hay caché a nivel de vista en PostgreSQL. El único caché relevante es `_stockCache` en `sfcom.js` (cliente JS, en memoria, solo para llamadas a la API sfcom).

**`persistirPagosProveedor` crea un hito a 0 € para proveedores sin reservas.** Si un proveedor tiene `total_slots = 0` o sin reservas activas, `persistirPagosProveedor` inserta un pago de 0 € con `is_final: true`. No es incorrecto, pero poluciona `payments` con filas vacías. Revisable si se quiere filtrar el INSERT cuando `amount = 0` y no hay reservas previas.

**`_insertarMensaje` sin protección concurrente (`solicitudes.js`).** En práctica es imposible: el asistente es un modal que bloquea la UI, y la edición de mensajes del log también bloquea su área. No vale la pena añadir complejidad.

**`btnConfirmarSfcom` con "Solo guardar" no sincroniza sfcom.** Es el comportamiento esperado: Paula ha elegido explícitamente no sincronizar. Las discrepancias se detectan en la verificación automática.

**Tres paneles cargan datos sfcom de formas distintas.** `formulario.js` hace query directa a `sfcom_listings`. `proveedores.js` hace dos queries y las mezcla en memoria. `sfcom-panel.js` usa la vista `availability_with_sfcom`. No hay inconsistencias visibles. Riesgo: si se añade una columna hay que editarlo en tres sitios. Se consolidará si/cuando se refactorice la carga de datos sfcom.

**El asistente marca el mensaje como enviado al pulsar el botón de correo.** El registro en log ocurre al pulsar el botón, sin esperar confirmación real del envío por mailto (sin callback). Paula puede editar el log si lo envió por otro canal. Sin solución técnica posible con el stack actual.

---

### 7.9 Auditoría de código — jun 2026 (ítems activos)

Auditoría exhaustiva del panel completo realizada en jun 2026. Los ítems resueltos están en `CLAUDE_ADMIN_BACKLOG.md §7.9`.

---

#### Alto — comportamiento incorrecto en casuísticas reales

**Sistema de inferencia sfcom — robusto en práctica, mejorable en teoría.** El punto débil (matching por día solo funciona para ENCIERRO cuando hay múltiples filas con el mismo `sfcom_service_name`) no afecta en práctica: los otros servicios tienen un único venue activo. El fallo real aparecería si dos venues vendieran el mismo servicio no-ENCIERRO. Pendiente (no urgente): si ocurre, generalizar la desambiguación para usar `<TIPO>_<day>` en lugar de hardcodear `ENCIERRO_`.

---

#### Medio — edge cases que ocurrirán con el tiempo

**`_savePhotos` sobreescribe el array entero — race condition si dos tabs editan (`proveedores.js:144-156`).** Si Paula tiene el panel en dos tabs y ambas editan fotos del mismo servicio, gana el último en guardar.

**Pérdida de foco y scroll en el panel — patrón general.**
- Input de ID en asistente múltiple (`proveedores.js`): cursor salta al final al escribir en el medio. Fix: guardar `selectionStart` y restaurar con `setSelectionRange`.
- Tablas del panel de control (`panel.js`): al hacer clic en una fila la tabla se filtra y el foco queda en la posición original. Fix: `element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })` tras el re-render.

**`multipleRows[i]._db_*` no se resetean tras guardar (`proveedores.js:2142-2156`).** Si Paula reabre el dialog sin recargar, todos los rows aparecen como modificados aunque no hayan cambiado.

**`crearModal` con id reutilizable elimina modales en proceso async sin aviso (`modal.js:7-8`).** Si Paula pulsa "Verificar datos" dos veces seguidas mientras la primera verificación sigue cargando, el primer modal se elimina del DOM. El resultado se pierde sin aviso.

**`checkSfcomOrders` se llama sin caché al cargar `panel.js` Y `solicitudes.js`.** Cada navegación entre panel.html y solicitudes.html dispara un GET al endpoint externo sin caché ni throttle.

**`abrirProcesarEmail`: regex greedy para extraer JSON puede atrapar texto ajeno (`asistente.js:541-542`).** `rawText.match(/\{[\s\S]*\}/)` es greedy. Si Claude incluye un ejemplo de código con `{` antes del JSON real, el parse falla.

**Signed URLs de Supabase Storage (TTL 60s) expiran si Paula tarda en clicar (`formulario.js:1391-1419`).** No hay refresh automático.

**`bloque3` permite clicar en un venue con sobrereserva (`disp-error`)**, abriendo el panel de reorganización de forma confusa. La sobrereserva se marca en rojo pero el click sigue activo.

**`_emitir` (factura) actualiza `clients` en memoria antes de confirmar que el UPDATE a Supabase fue exitoso (`factura.js:341-354`).** `Object.assign(_cliente, updates)` ocurre antes del error check.

**El logo de propuesta puede no estar cargado al generar el PDF (`propuesta.js:616-634`).** Si Paula pulsa el botón inmediatamente al abrir el panel, `_logoBlackBase64` puede no haber cargado. El PDF se genera sin logo (try/catch silencioso).

**`Math.abs(parseFloat(amount) - cobroFinal) >= 0.01` puede dar falso positivo por precisión float (`utils.js:176`).** Fix: redondear a 2 decimales antes de comparar.

---

#### Bajo — pulido y consistencia

**El logo de propuesta y las imágenes de vista previa se re-fetchean en cada apertura del panel, sin caché (`propuesta.js:230-241`).** Para propuestas con 5+ servicios con imagen, hay 5+ fetches en paralelo en cada apertura.

**Los errores de Supabase solo van a `console.error` — Paula no sabe que ocurrieron sin abrir DevTools.** No hay reporting central ni toast de error genérico para operaciones secundarias.

**`window.*` global handlers (sortReservasCliente, facturarHito, etc.) pueden colisionar entre módulos en un refactor futuro.**

**Uso mixto de `overlay.close()` y `overlay.remove()` para cerrar modales (`modal.js`).** `crearModal` registra `dialog.addEventListener('close', () => dialog.remove())`. Varios callers usan directamente `overlay.remove()`, sin disparar el evento `close`. Fix: unificar todos los callers para usar siempre `overlay.close()`.

**Nombres de servicios con fecha embebida.** Algunos servicios incluyen la fecha en su `name` (ej. "Encierro 11 de Julio"), lo que produce redundancias si se concatena la fecha desde la columna `day`. Actualmente el concepto de factura usa `service_name — venue_display_name`. Pendiente: auditar todos los nombres de servicio; valorar si se elimina la fecha del `name` y se construye siempre desde `day` en facturas, propuestas, bienvenidas y otras comunicaciones con cliente.

---
## 8. Trampas técnicas conocidas

**PowerShell 5.1 corrompe archivos JS.** `Get-Content | Set-Content` lee UTF-8 como Windows-1252 y corrompe caracteres multibyte (emojis, tildes, em-dashes). Fix si ocurre: `git restore <archivo>` y rehacer el cambio con la herramienta Edit de Claude Code.

**ES6 modules — redeclaración = SyntaxError silencioso.** Si un `import` trae `foo` y en el mismo archivo hay `const foo` o `function foo`, el módulo no carga y falla en silencio (sin error visible en la UI). Fix: borrar la declaración local en el mismo Edit que añade el nombre al import, nunca en pasos separados.

**`panel.querySelector()` siempre, nunca `document.getElementById()` tras `crearModal`.** El dialog podría no ser único en el DOM si hay un residuo anterior. `panel.querySelector('#mi-btn')` es siempre seguro.

**PDF server-side — WeasyPrint incompatible con el CSS del proyecto.** Si en el futuro se necesita generación server-side de PDFs, usar Puppeteer + pypdf. WeasyPrint no interpreta correctamente el CSS del proyecto.

**Logo en PDFs:** usar el canal R de la imagen como máscara alfa.

**`invoiced` en charges es redundante** con `invoice_number IS NOT NULL`, pero se mantiene por conveniencia en filtros de consulta.

**`payments` tiene columna `is_final` simétrica a `charges`.** Partial unique index `payments_one_final_per_provider ON payments(provider_id, season) WHERE is_final = true`. La unicidad de is_final=true por cliente en charges se refuerza con `charges_one_final_per_client ON charges(client_id, season) WHERE is_final = true`. Los constraints `uq_payments` y `uq_charges` (que bloqueaban combinaciones de amount+due_date iguales para el mismo cliente/proveedor) fueron eliminados en jul 2026 por causar falsos positivos en operaciones normales.

**`persistirCobrosCliente` no modifica hitos bloqueados.** Si el hito final tiene `invoice_number` (facturado) o `collected = true` (cobrado), en lugar de actualizar su importe lo degrada a `is_final=false` y crea un nuevo hito de ajuste con la diferencia. Esto garantiza trazabilidad: un cobro ya realizado nunca se sobreescribe silenciosamente.

**`persistirPagosProveedor` se ejecuta al guardar availability en `proveedores.js`, no solo al procesar reservas.**

Cuando se guarda cualquier cambio de availability desde `proveedores.js` (fotos, descripción, instrucciones, slots), el código llama a `persistirPagosProveedor(supabase, providerId, ...)`. Esta función recalcula el hito "Pago final" del proveedor y lo persiste en `payments`. Si el proveedor no tiene reservas activas —o el importe calculado es 0 (p.ej. `total_slots = 0, price_per_slot = 0` con `billing_model = 'capacity'`)— se inserta igualmente una fila con `amount = 0`.

Consecuencias que hay que tener en cuenta al trabajar sobre este sistema:

- **Todo proveedor con al menos una fila en `availability` tendrá al menos una fila en `payments`**, aunque nunca haya tenido una reserva.
- **✅ Desde Fase 3 (jun 2026): `payments.provider_id → providers` tiene `ON DELETE CASCADE`.** El DELETE de `providers` elimina automáticamente todos sus payments. Sin embargo, `venues.provider_id → providers` sigue siendo `NO ACTION` en DELETE. Orden correcto actual: `DELETE FROM venues WHERE provider_id = '...'` (en cascada elimina `availability` y `sfcom_listings`) → `DELETE FROM providers WHERE id = '...'` (en cascada elimina `payments`). Ya no es necesario `DELETE FROM payments` explícito.
- Este comportamiento aplica también a cualquier operación de limpieza o migración en Supabase que implique borrar proveedores.
- La UNIQUE constraint `(provider_id, amount, due_date)` impide que el hito a 0 € se multiplique con cada guardado.

Verificado empíricamente en jun 2026 durante la prueba de Fase 0a (ver §9).

---

## 9. Plan de fases

Las fases completadas (-1 a 11) con sus descripciones detalladas están en `CLAUDE_ADMIN_BACKLOG.md §9`.

### Estado de cada fase

| Fase | Estado | Descripción |
|---|---|---|
| -1 | ✅ Completa | Auditoría completa de Supabase |
| 0 | ✅ Completa | Auditorías sin código (deudas operativas sfcom son independientes) |
| 1 | ✅ Completa | Bugs simples (4 cambios quirúrgicos) |
| 1b | ✅ Completa | Bugs rápidos sin dependencias (margen + cobros bloque 5) |
| 2 | ✅ Completa | Comunicaciones semi-automáticas (bienvenida) |
| 3 | ✅ Completa | Esquema BD: cascada de borrados y renombrado de IDs |
| 4 | ✅ Completa | Sistema de borrador y asistente |
| 5 | ✅ Completa | Flujo sfcom: leads cancelados + reducción de modales |
| 6 | ✅ Completa | Panel: tablas navegables · image_url editable · pestañas par/servicio · fotos 16:9 · reordenar fotos |
| 6b | ✅ Completa | Asistente: fix mensajes editados + auto-save logs toggle |
| 6c | ✅ Completa | Bugs §7.9: marcarAtendida · verificarConsistencia · reactivar capacidad · reversión falsa |
| 6d | ✅ Completa | Bugs §7.9 (segunda tanda): venue toast · sync todasReservas · cobro negativo · borrador JSON · sobrereserva · matching sfcom |
| 7 | ✅ Completa | Mejoras de propuestas: display_name · fallback descripción · fotos · modos Compacto/Completo |
| 8 | ✅ Completa | Facturación canal sfcom |
| 8b | ✅ Completa | Fix sfcom: WEB ref en charges + corrección datos R0103/R0104 |
| 9 | ✅ Completa | Refactors y cierre (inferencia level→service_id · reglas nombres · caché sfcom) |
| 9b | ✅ Completa | Mejoras asistente + fixes arquitectura web form + Edge Function notificar-solicitud |
| 9c | ✅ Completa | Migración services.id: text PK → integer + service_code |
| 9d | ✅ Completa | Sistema de temporadas: selector sidebar, filtros por season, confirmación modal, función public_season() |
| 10 | ✅ Completa | Tablas: edición directa + eliminaciones + temporada + notas solicitudes + gestión Storage con upload y vinculación de facturas |
| 11 | ✅ Completa | Módulo fiscal: libro gastos/emitidas, F69, alertas, paquete asesor, ZIP docs, dlgGasto con IA |
| 11d | ✅ Completa | Gastos del negocio: tabla editable, campos operativos en supplier_documents, extracción IA, fiscal check dos niveles |

### Dependencias duras entre fases

```
0 → 3 ✅ (la auditoría FK definió qué migrar — ambas completadas)
0a → 6 ✅ (trigger verificado — desbloqueada)
3 → 6, 7, 9 ✅ (borrados correctos ya en BD — desbloqueadas)
todas → 9 ✅ (refactors de archivos grandes van últimos)
```

---

### Fase 10 — ✅ Completa: tablas edición directa + Storage + notas solicitudes

---

### Fase 11 — ✅ Completa: módulo fiscal

Descripción completa en `CLAUDE_ADMIN_BACKLOG.md §9`. Incluye dismiss con sentinels en todas las alertas pertinentes (ver §7.6).

---

### Fase 11d — ✅ Completa: gastos del negocio

`supplier_documents` ampliada con capa operativa (`amount`, `expense_date`, `has_invoice`) y capa de pre-extracción IA (ver §2). `gastos.js` y `gastos.html` reescritos con formulario dual alta/edición, fiscal check dos niveles, y lógica de estados del botón IA. Ver documentación completa en `### gastos.js` arriba.
