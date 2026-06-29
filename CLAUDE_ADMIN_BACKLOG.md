# CLAUDE_ADMIN_BACKLOG.md — Historial de deudas técnicas cerradas

> Archivo de consulta histórica. No cargarlo en conversaciones de trabajo — solo cuando se necesite revisar el historial de una deuda específica.
>
> **Para añadir una deuda cerrada sin cargar este archivo:**
> ```powershell
> Add-Content -Path "CLAUDE_ADMIN_BACKLOG.md" -Value "`n---`n`n### [Título] — ✅ RESUELTO (fecha)`n`n[descripción de qué era y cómo se resolvió]"
> ```
> `Add-Content` escribe al final sin leer ni cargar el archivo en contexto.

---

## §7.1 — Bugs resueltos

**✅ RESUELTO — Asistente recibía lista de disponibilidad vacía en solicitudes web y sfcom.**

Causa raíz: `expandirServiceIds` en `asistente.js` hacía matching exacto contra `'chupinazo'`, `'encierro'`, etc., pero las solicitudes web y sfcom guardan `level` como slug completo (`'vivir-el-chupinazo'`, `'ver-el-encierro'`). El match fallaba → `serviceIds = []` → `disponibilidadParaAsistente` devolvía `[]`. Solo funcionaba para solicitudes de email. Fix (jun 2026): añadido paso de normalización `split('-')` al inicio de `expandirServiceIds`. También corregido `_inferirServiceIds` en `solicitudes.js`.

---

**✅ RESUELTO — Borrador vacío en solicitudes web con `level` en formato slug completo.**

`_preFillBorradorSiVacio` en `solicitudes.js` usaba coincidencia exacta (`sol.level === 'chupinazo'`) pero el formulario web envía slugs completos (`'vivir-el-chupinazo'`). Corregido en jun 2026 adoptando enfoque split-by-dash. Caso que lo evidenció: solicitud de Sara.

---

**✅ RESUELTO — Solicitudes ya atendidas aparecían como pendientes en panel y formulario.**

Cambios aplicados (jun 2026): `panel.js` `calcularAlertas()`: `solicitudesSfcom` filtra `status === 'nueva'`; las web se dividen en `solicitudesWebNuevas` y `solicitudesWebSeguimiento`, mostradas con etiquetas separadas. `leadsCancelados` filtra además `status === 'nueva'`. `solicitudesWebNuevas` y `solicitudesWebSeguimiento` excluyen registros con `source.startsWith('sfcom_c:')`. En `formulario.js` `cargarSolicitudes()`: `otrasActivas` usa `status === 'nueva'`.

---

**✅ RESUELTO (pendiente verificación en producción — jun 2026) — Discrepancia de stock sfcom reaparecía inmediatamente después de sincronizar.**

Causa raíz: el endpoint `GET stock-all` de sf-api-paula.php cachea las respuestas ~5 minutos. Los PUTs actualizaban WooCommerce correctamente, pero el GET inmediato posterior devolvía el valor anterior. Fix: `syncStockToSfcom` registra en `sessionStorage` el stock puesto y el timestamp tras cada PUT exitoso. `verificarSfcom` comprueba esa entrada antes de reportar la discrepancia: si el stock registrado coincide con `stockEsperado` y el PUT tiene menos de 6 minutos, la descarta como artefacto del TTL. La guarda `!pendingExplains` garantiza que los pedidos sfcom pendientes de incorporar nunca quedan suprimidos.

---

**✅ RESUELTO — Marcar cobro como cobrado persiste correctamente en Supabase.**

Auditado jun 2026: `toggleCobroCliente` actualiza `h.collected` y `h.collected_date` en memoria, luego llama a `persistirHitosCliente` que hace UPDATE a Supabase. Si el cobro tiene `invoice_number`, el bloque dedicado en `persistirHitosCliente` ejecuta igualmente el UPDATE de `collected`/`collected_date`. El bug original de Fase 0d ya no existe.

---

**ACLARADO — "Cobros facturados no se pueden editar" no es un bug de UI.**

`renderCobrosCliente()` muestra `amount` y `comments` como texto plano para todos los cobros. El backend intencionalmente protege el importe de cobros facturados (solo permite cambiar `collected` y `collected_date`), y la UI es coherente porque no ofrece input de edición para el importe. Edge case menor aceptado: si el cobro final (`esFinal`) está facturado, muestra un `<input type="date">` para cambiar `due_date`; si Paula lo cambia, `persistirHitosCliente` ignorará el cambio. Impacto mínimo.

---

**✅ RESUELTO — Botón "Facturar" aparece sin recargar la página.**

Auditado jun 2026: tras el INSERT de un cobro nuevo, `formulario.js` llama a `renderCobrosCliente()` explícitamente y el id devuelto por Supabase se asigna a `h.id`. El botón "Facturar" aparece en el re-render porque la condición `!yaFacturado && h.id` ya es verdadera.

---

**✅ RESUELTO PARCIALMENTE (jun 2026) — Venue en el borrador de solicitudes sfcom.**

`registrarPedidosSfcom` en `formulario.js` ahora incluye `venue_id` en `proposal_draft`. Solicitudes nuevas ya tendrán el venue en el borrador. Pendiente resuelto: `_preFillBorradorSiVacio` en `solicitudes.js` ya auto-selecciona el venue si `_venuesPorServicio` devuelve exactamente uno para ese servicio.

---

**✅ RESUELTO — `_onBorradorActualizado` preserva ahora el campo `estado` al actualizar desde el asistente.**

Fix en `solicitudes.js`: antes de persistir el nuevo draft recibido del asistente, cada línea nueva se empareja con la existente por `service_id + venue_id` y copia el campo `estado` de la versión en memoria. Las líneas nuevas (sin pareja) quedan sin `estado` (interpretado como `'pendiente'`).

---

**✅ RESUELTO — `payments` del proveedor se recalculan correctamente al eliminar una reserva.**

Verificado jun 2026. `eliminarSeleccionadas` en `formulario.js:875` llama a `persistirPagosProveedor` tras el borrado.

---

**✅ RESUELTO — `availability` sin UNIQUE(venue_id, service_id) y venue_id nullable.**

Ambos aplicados en jun 2026: `ALTER TABLE availability ADD CONSTRAINT uq_availability_venue_service UNIQUE (venue_id, service_id)` y `ALTER TABLE availability ALTER COLUMN venue_id SET NOT NULL`.

---

**✅ INVESTIGADO Y ACEPTADO — 6 reservas activas con total_amount = 0.**

Las reservas R0120, R0074, R0063, R0064, R0102, R0108 tienen `price_per_slot = 0` y están activas. Son invitaciones o servicios sin coste (intencionados). No son errores de entrada de datos.

---

**✅ INVESTIGADO Y ACEPTADO — MARTIKO y NACHO_GALLARDO con cobros pero sin reservas activas.**

Los charges de estos clientes son a importe 0 (intencionados). La verificación de consistencia financiera no los detecta como error porque `SUM(charges) = 0 = SUM(reservas activas)`.

---

**✅ RESUELTO — Email duplicado: giovanni.soliman@gmail.com.**

El registro duplicado fue eliminado en jun 2026. No tenía reservas ni charges activos.

---

**✅ RESUELTO — Cascade al borrar servicios de proveedor en varias tandas.**

El código en `proveedores.js:1887-1944` maneja correctamente el caso multi-tanda: cada vez que `btnEliminarServicio` se dispara, filtra `todaDisponibilidad` en memoria tras cada borrado y comprueba si el venue quedó vacío. Si es el último venue del proveedor, abre `_modalOpcionesEliminar`.

---

**✅ RESUELTO — Tabla de servicios del proveedor mezclaba todos los venues (jun 2026).**

`cargarServiciosProveedor` ahora filtra por `venue_id === venueActual.id` (en lugar de `venue_provider_id`). `selectVenueTab` llama a `cargarServiciosProveedor` al finalizar.

---

**✅ RESUELTO — Asistente: edición del textarea de respuesta ya se refleja en `mensajes` y en el log (Fase 6b).**

**✅ RESUELTO — Asistente: toggle auto-guardar log implementado (Fase 6b).** Botón "Guardar log" sustituido por toggle estilo iOS en la cabecera del modal. Por defecto activo. Guarda automáticamente al cerrar el modal.

---

## §7.2 — UX resueltos

**✅ RESUELTO — Pedidos sfcom ya registrados no aparecían en bloque 0 (jun 2026).**

Bug introducido en la refactorización de Fase 5. `cargarSolicitudes()` se saca del interior de `registrarPedidosSfcom` y se llama siempre al final del `.then()`, independientemente de si se insertaron filas nuevas.

---

**✅ RESUELTO — Exceso de modales en flujo sfcom y flujo de eliminación (jun 2026).**

6 cambios: A) `checkAvailabilityBeforeSave` silenciado cuando la brecha está explicada por el pedido en curso; B) `confirmarStockSfcom` auto-sync sin modal cuando `nuevoStock === stockActual`; C) confirm de cliente nuevo suprimido al venir de sfcom; D) `_ofrecerCerrarSolicitud` auto-cierra solicitudes WEB cuando todos sus items tienen reserva; E) verificación auto-run con solo pendingExplains → toast azul en lugar de modal; F) modal de eliminación unificado para última reserva (un único modal contextual pre-computado reemplaza 3 interrupciones).

---

**✅ RESUELTO — Cálculo de margen en panel.js incluye tipos de servicio sin actividad comercial relevante.**

Dos ajustes en `panel.js`: tablas filtradas para que tipos no-balcón solo aparezcan si tienen reservas activas o `billing_model = 'capacity'`; sección potencial calculada solo sobre `TIPOS_BALCON`.

---

**✅ RESUELTO — Tablas del panel de control no son navegables.**

`filaEvento` y `filaProveedor` en `panel.js` tienen ahora `onclick` y `cursor:pointer`. Las funciones `window._seleccionarEvento` / `window._seleccionarProveedor` actualizan el `<select>` y llaman a `renderEventos`/`renderProveedores`. Segundo clic sobre la misma fila la deselecciona. Bidireccional con el dropdown.

---

**✅ RESUELTO — `services.image_url` editable desde proveedores.js.**

Campo `inputServicioImageUrl` añadido en la sección "Info del servicio". Se guarda vía `guardarDescripcionServicio` (autosave por `change`) y en `btnGuardarServicio`.

---

**✅ RESUELTO — `services.comments` eliminada de la BD.**

La columna fue eliminada con `ALTER TABLE services DROP COLUMN comments`. El `inputServicioComments` en proveedores.js ya guardaba en `availability.comments`, no en `services.comments`.

---

**✅ RESUELTO — UI de envío unificada (`mostrarOpcionesEnvio` en `utils.js`).**

Implementado como paso 0 de Fase 2. La función soporta dos modos (`tipo: 'texto' | 'pdf'`). Usada por `asistente.js`, `propuesta.js`, `factura.js` y `formulario.js` (bienvenida).

---

**✅ RESUELTO — Pestañas "Detalles del servicio" vs "Detalles del par" en `proveedores.js` (jun 2026).**

Tabs `data-avail-tab` dentro de `avail-sep`. Tab por defecto según `venueActual.venue_type === 'balcon'`. Badges de contenido no guardado. El guardado ya apuntaba a las tablas correctas en ambos casos.

---

**✅ RESUELTO — Carousel de fotos: `aspect-ratio: 16/9` aplicado (jun 2026).**

`.photo-carousel-img-wrap` tiene `aspect-ratio: 16/9` en `admin.css`.

---

**✅ RESUELTO — Carousel de fotos: reordenación implementada (jun 2026).**

Botón "⬆ Subir" en el footer del carousel. Lógica: `_photos.splice(_photoIdx - 1, 0, _photos.splice(_photoIdx, 1)[0])` → `_photoIdx--` → `_savePhotos()`. Deshabilitado cuando `_photoIdx === 0`.

---

**✅ RESUELTO — Chips de clientes en tablas del panel son clicables (`utils.js: renderClientChips`).**

Cada chip `ID(plazas)` navega a `formulario.html?cliente=ID` al hacer clic. Incluye `event.stopPropagation()`.

---

**✅ RESUELTO — Verificación financiera manual: cobros finales a cero de clientes sfcom no aparecen como advertencia (`verificacion.js`).**

El aviso se suprime cuando `is_final: true` Y el cliente tiene al menos un charge con `comments.includes('Cobrado vía sfcom')`.

---

## §7.3 — Funcionalidades resueltas

**✅ RESUELTO jun 2026 — Botón "Verificar datos" unificado y verificación consolidada.**

`ejecutarVerificacion(supabase, opts)` en `verificacion.js` es el único punto de entrada. Tres dominios: integridad de BD, coherencia financiera y stock sfcom. El botón existe en todas las páginas. Funciones locales duplicadas de `formulario.js` y `sfcom-panel.js` eliminadas.

---

**✅ RESUELTO — Consolidar lógica de matching sfcom (jun 2026).**

`resolverProductoSfcom(li, sfcomListings)` exportada desde `sfcom.js`. `importarCanceladosSfcom` la usa directamente. `registrarPedidosSfcom` la usa añadiendo sus tres casos con modales de conflicto. El código duplicado de matching fue eliminado.

---

**✅ RESUELTO — `created_at` con fecha real del pedido sfcom (jun 2026).**

Añadido `created_at: pedido.fecha || undefined` al INSERT de `registrarPedidosSfcom`.

---

**✅ RESUELTO — Facturación canal sfcom — Implementado en Fase 8 (jun 2026).**

Las reservas sfcom quedan en los clientes reales con un cargo automático `'Cobrado vía sfcom'`. El cliente `SFCOM` agrupa las ventas del canal y permite facturar a Hilario desde el flujo normal. Ver §9 Fase 8 (en este archivo) para el diseño completo.

---

**✅ RESUELTO — Renombrar IDs de cliente, proveedor, venue o servicio (jun 2026).**

BD: todas las FKs de IDs de texto ahora tienen `ON UPDATE CASCADE`. UI: función `abrirRenombrarId({ tabla, idActual, supabase, onSuccess })` exportada desde `utils.js`. Botón `✏️ ID` añadido en `formulario.html`, `proveedores.html` y `tablas.js`.

---

**✅ RESUELTO — Notas de sesión para el asistente (`session_context`).**

Tabla `session_context` en Supabase: append-only log, RLS habilitado. UI en `solicitudes.js`: campo de una línea que expande al hacer clic. Al perder foco → INSERT silencioso. Integración en `asistente.js`: `getNotasSesion` como parámetro opcional; `system` como array con dos bloques con `cache_control: ephemeral`.

---

## §7.4 — Auditorías resueltas

**✅ COMPLETADO — Auditoría del ciclo de facturación/cobros/pagos (jun 2026).**

Recorrido completo realizado en prueba Fase 0d. Todos los bugs detectados quedaron en §7.1 y fueron resueltos en Fases 1b y siguientes.

---

**✅ VERIFICADO — Trigger `trg_sync_availability_event_type` funciona correctamente (jun 2026).**

Verificado en prueba Fase 0a. El trigger propaga `photos`, `description` y `access_instructions` a todas las filas con el mismo `venue_id + event_type`. Nota: existía una función huérfana `sync_photos_by_event_type()` (versión anterior). Eliminada con `DROP FUNCTION public.sync_photos_by_event_type();`.

---

**✅ VERIFICADO — `service_availability` y `catalogo_publico` funcionan para usuarios anon.**

Verificado en jun 2026 con `SET ROLE anon; SELECT COUNT(*) ...`: `service_availability` devuelve 63 filas y `catalogo_publico` devuelve 54.

---

## §7.5 — Mejoras de código resueltas

**✅ RESUELTO — Asistente usa `venue_display_name` como identificador principal.**

`disponibilidadParaAsistente` incluye `venue_display_name` en cada entrada; el system prompt instruye a Claude a usarlo siempre.

---

**✅ RESUELTO — Asistente interpreta precios siempre por persona.**

`SYSTEM_PROMPT_ASISTENTE` tiene instrucción explícita: cualquier precio mencionado por Paula es siempre por persona/plaza, nunca total del grupo.

---

**✅ RESUELTO — Reglas de uso de identificadores de venue/evento documentadas en §3.**

Cada lugar físico tiene hasta cinco identificadores distintos. Las reglas de qué usar en cada contexto (BD/código, UI interna, documentos al cliente, catálogo, sfcom) están formalizadas en §3.

---

**✅ RESUELTO — Lógica de inferencia `level → service_id` extraída a `utils.js` (jun 2026).**

`parsearNivel(level)` y `TIPO_SERVICIO_ID` exportados desde `utils.js`. Los cuatro sitios actualizados: `_inferirServiceId` en `formulario.js`, `_preFillBorradorSiVacio` en `solicitudes.js`, `_inferirServiceIds` en `solicitudes.js`, `expandirServiceIds` en `asistente.js`.

---

**✅ RESUELTO — Doble `cargarSolicitudes()` al inicio de `formulario.html`.**

Se quitó la llamada incondicional de startup. El chain de `checkSfcomOrders` garantiza una sola llamada.

---

**✅ RESUELTO — Auto-transición `seguimiento_pendiente → respuesta_enviada` al enviar recordatorio.**

`abrirModalRecordatorio` llama a `_onRespuestaUsadaEnLog` al pulsar cualquier botón de envío, que hace la transición a `respuesta_enviada` en Supabase y actualiza badge y select en el panel.

---

**✅ RESUELTO — `valorO` y `esVacio` en `utils.js` (jun 2026).**

`esVacio(v)` devuelve true si `v` es null, undefined o cadena vacía al recortar. `valorO(v, fallback)` devuelve el valor recortado si tiene contenido, o el fallback. Aplicados en `propuesta.js`, `factura.js` y `sfcom-panel.js`.

---

**✅ RESUELTO (jun 2026) — `assigned_venue_id` y `email_raw` — columnas eliminadas de BD y código.**

`assigned_venue_id`: nunca se escribía. `email_raw`: el INSERT de `asistente.js` construye ahora `conversation_notes` inicial con la fecha y el texto raw del email. Ambas columnas dropeadas.

---

**✅ RESUELTO (jun 2026) — Migración columnas legacy `level`, `service_id`, `day`, `slots`, `price_per_slot` → `proposal_draft`.**

`reservation_requests` ya no tiene columnas de primer contacto desagregadas. Toda la información vive en `proposal_draft[0]`. Migración completada en varias fases (Fases 1-5 de la migración). Columnas legacy dropeadas con `ALTER TABLE reservation_requests DROP COLUMN`.

---

## §7.6 — Deuda de datos resuelta

**✅ RESUELTO — `event_type`.**

Es una columna directa en `services` (no derivada). Las vistas la leen de `services.event_type`.

---

## §7.8 — Conocido y aceptado (resuelto)

**✅ RESUELTO — `payments` migrado a columna `is_final` (jun 2026).**

`ALTER TABLE payments ADD COLUMN is_final boolean DEFAULT false` + `UPDATE payments SET is_final = true WHERE comments = 'Pago final'` (30 filas). Código actualizado en `utils.js` y `proveedores.js`. El texto `comments: 'Pago final'` se mantiene como texto legible para Paula; la lógica usa exclusivamente `is_final`.

---

## §7.9 — Auditoría jun 2026: ítems resueltos

**✅ RESUELTO — `verificarConsistenciaFinanciera` excluye clientes con historial contable.** `verificacion.js` acumula los huérfanos con `tieneHistorial=true` en un array `manuales` y solo borra automáticamente los que no tienen historial.

**✅ RESUELTO — Race condition en numeración de facturas.** `ALTER TABLE charges ADD CONSTRAINT uq_charges_invoice_number UNIQUE (invoice_number)`. En PostgreSQL, NULLs no colisionan con el constraint. `propuesta.js` cambiado de `console.error` a `alert` para que el error sea visible.

**✅ RESUELTO — `solicitudOriginRef` ya se resetea en `limpiarFormularioReserva()`.** Fix estaba aplicado: `solicitudOriginRef = null` en línea 193.

**✅ RESUELTO — `sfcom-panel.js` usaba `d.stockReal` pero el objeto tiene `d.stockSfcom`.** La columna "Stock real" siempre mostraba `undefined`. Corregido en jun 2026.

**✅ RESUELTO — `cambiarEstadoSeleccionadas`: DELETE de cargo sfcom usa referencia exacta (jun 2026).** El comentario del cargo ahora incluye el WEB ref: `'WEB038_1102 Cobrado vía sfcom'`. El DELETE filtra por `comments = \`${r.origin_ref} Cobrado vía sfcom\`` (match exacto, sin filtro de importe).

**✅ RESUELTO — `actualizarProveedores`: venue desaparece silenciosamente (jun 2026).** Añadido `else if (plazas > 0)` con toast informando que el venue seleccionado no tiene capacidad para las plazas indicadas.

**✅ RESUELTO — `confirmarReorganizacion`: aviso correcto si la reversión falla.** Inspecciona `allSettled` + `r.value?.error`; si alguna reversión falló, muestra modal de error grave listando qué reservas quedan inconsistentes.

**✅ RESUELTO — `cambiarEstadoSeleccionadas`: reactivar cancelada verifica capacidad propia (jun 2026).** Antes del UPDATE llama a `getPlazasInfo` por par venue+servicio; si no hay plazas libres, muestra modal y carga la reserva en el formulario.

**✅ RESUELTO — `cargarReservasCliente` sincroniza `todasReservas` (jun 2026).** Tras cargar las reservas del cliente, `todasReservas` se actualiza filtrando los datos del cliente cargado y reemplazándolos con los frescos de Supabase.

**✅ RESUELTO — `cobroFinal` negativo muestra modal (jun 2026).** En `persistirCobrosCliente` (`utils.js`), si `cobroFinal < -0.01` se abre un modal identificando el cliente y el importe.

**✅ RESUELTO — `marcarAtendida` tiene modal de confirmación (jun 2026).** Modal con botones "Cancelar" / "Sí, marcar como procesada" antes de actualizar el status a `convertida`.

**✅ RESUELTO — `asunto` añadido al `mailto:` del asistente (jun 2026).** Las dos llamadas a `mostrarOpcionesEnvio` en `asistente.js` pasan `asunto: 'San Fermín 2026 · tu reserva'`.

**✅ RESUELTO — `btnEliminarServicio`: error de FK al borrar proveedor ya muestra toast (jun 2026).** El DELETE a `providers` captura el error y llama a `mostrarToast`.

**✅ RESUELTO — `_preFillBorradorSiVacio` usa `await` en el update a Supabase (jun 2026).**

**✅ RESUELTO — `_renderBorrador`: `rebind()` preserva el foco de inputs numéricos.** Antes de re-renderizar, guarda el valor del input activo en `draft` y restaura el foco después del re-render.

**✅ DECISIÓN — `session_context` es un log histórico append-only.** Cada edición de Paula genera un INSERT deliberado. Permite revisar en el futuro qué contexto tenía Paula en cada momento de la temporada.

**✅ RESUELTO — Paula puede editar mensajes de cualquier fecha.** Eliminada la condición `isToday`. El botón de edición aparece en todos los mensajes de Paula.

**✅ RESUELTO — `_onBorradorActualizado` actualiza el DOM aunque la solicitud no esté en los arrays.** Si `sol` es `undefined` pero la solicitud está abierta (`solicitudActual`), se actualiza `solicitudActual.proposal_draft` directamente.

**✅ RESUELTO — `togglePagoProvCobrado` usa modal propio para la fecha de pago.** Reemplazado `prompt()` por `_pedirFechaPago()`: modal con input de texto + Enter/Cancelar/Confirmar.

**✅ RESUELTO — `sfcom-panel.js` ya importa pedidos al cargarse.** Añadido al arranque el mismo bloque que usa `panel.js`. Las tres páginas con sección sfcom sincronizan pedidos al cargar.

**✅ RESUELTO — `importarCanceladosSfcom` dedup rediseñada (jun 2026).** La dedup antigua usaba solo email+phone+nombre+service_id. Nueva lógica: pre-fetch único de `leadsExistentes` antes del bucle. Por cada pedido, busca lead existente con mismo cliente + service_id + venue_id + day. Si existe con mismas plazas → skip; si tiene plazas distintas → actualiza si es más reciente; si service/venue/day difieren → lead nuevo. Eliminado el query per-iteration.

**✅ RESUELTO — `---BORRADOR---` JSON inválido muestra toast (jun 2026).** El `catch` en `asistente.js` llama a `mostrarToast` avisando que el borrador no se actualizó pero el texto del mensaje sí es correcto.

**✅ VERIFICADO Y CORRECTO — `verificarBajaSfcom`: `stock === 0` y `stock === null` ambos indican baja.** `stock === null` ocurre cuando el producto no aparece en el mapa de `stock-all` (Hilario lo eliminó del catálogo). `stock === 0` ocurre cuando WooCommerce lo tiene a 0 (Hilario lo puso a 0 al dar de baja). Ambos casos son válidos.

**✅ RESUELTO — `syncStockToSfcom` avisa tanto de sobrereserva como de error de lectura (jun 2026).** Función helper `_syncAndWarn(venueId, servicioId)` en `formulario.js` sustituye a los 5 call sites directos.

**✅ RESUELTO — `sfcomDelta` incorrecto en el modal pre-save para solicitudes no-sfcom (jun 2026).** `solicitudOriginRef ? plazas : 0` → `solicitudOriginRef?.startsWith('WEB') ? plazas : 0`.

**✅ RESUELTO — `mostrarSugerenciasCliente` no limpiaba `inputAddress` ni `inputNif` al cambiar de cliente (jun 2026).** Añadido `inputAddress.value = inputNif.value = ''` en el bloque de reset.

**✅ RESUELTO — `toggleCobroCliente` usaba `prompt()` para la fecha de cobro (jun 2026).** Sustituido por `_pedirFechaCobro()` con `<input type="date">` pre-rellenado a hoy.

**✅ RESUELTO — `persistirPagosProveedor` no reseteaba `paid`/`paid_date` al cambiar el importe final (jun 2026).** Cuando `hitoFinal.paid === true` y el importe cambia: el hito pagado se degrada a `is_final: false` y se crea un nuevo hito con el saldo pendiente real y `paid: false`.

**✅ RESUELTO — Export de tablas genera `.xlsx` con nombre correcto.** `tablas.js:360` cambiado a `${tablaActual}.xlsx`.

**✅ RESUELTO — `execCommand('copy')` sustituido por `navigator.clipboard.writeText()` en los 4 lugares de `sfcom.js`.**

**✅ RESUELTO — Textos "San Fermín 2026" hardcodeados sustituidos por `anioTemporada()` (jun 2026).** `anioTemporada()` en `utils.js`: devuelve el año actual de enero a julio, el año siguiente de agosto a diciembre. Aplicado en `propuesta.js`, `factura.js` y `asistente.js`.

---

## §9 — Fases completadas

### Fase -1 — ✅ Auditoría completa de Supabase (jun 2026)

**SQL ejecutados:** 8 queries (A1: columnas, A2: generadas/índices, B1: triggers, B2: funciones, B3: vistas, C1: RLS y políticas, C2: storage, D1: FKs, D2: consistencia de datos).

| # | Hallazgo | Acción | Estado |
|---|---|---|---|
| 1 | Bug de seguridad: `venues` RLS usaba `{public}` | DROP + recrear políticas | ✅ Aplicado |
| 2 | `service_availability` y `catalogo_publico` podrían no funcionar para anon | Verificar con `SET ROLE anon` | ✅ Verificado: funcionan (63, 54 filas) |
| 3 | `availability` sin UNIQUE(venue_id, service_id) | Verificar duplicados + `ADD CONSTRAINT` | ✅ Aplicado |
| 4 | `availability.venue_id` nullable | `ALTER COLUMN venue_id SET NOT NULL` | ✅ Aplicado |
| 5 | `sync_photos_by_event_type` función huérfana | `DROP FUNCTION` | ✅ Aplicado |
| 6 | 6 reservas activas con total_amount = 0 | Investigar | ✅ Investigado: invitaciones/0€ intencionados |
| 7 | Email duplicado (giovanni.soliman@gmail.com) | Fusionar o eliminar | ✅ Eliminado |
| 8 | MARTIKO y NACHO_GALLARDO: cobros sin reservas | Investigar | ✅ Investigado: cobros a 0€ intencionados |
| 9 | `assistant_logs` sin RLS | Habilitar RLS | ✅ Aplicado jun 2026 |
| 10 | 55 servicios en `services` | ✅ No es deuda — todos son voluntarios o necesarios |

`event_type` confirmado: es columna directa en `services` (posición 3). Cierra la deuda 7.6.

---

### Fase 0 — ✅ Auditorías sin código

**0a — Verificar trigger:** ✅ Verificado. Se creó un venue de prueba (TEST_TRIGGER_VENUE) con 3 filas para ENCIERRO_7/8/9. Al editar `photos`, `description` y `access_instructions` en ENCIERRO_7, los tres campos se propagaron correctamente a ENCIERRO_8 y ENCIERRO_9.

Hallazgo colateral: `proveedores.js` llama a `persistirPagosProveedor` al guardar cualquier cambio en availability. Creó un hito de pago a 0 € para TEST_TRIGGER_PROV. La FK `payments.provider_id` bloqueó el DELETE del proveedor hasta borrar ese pago explícitamente.

**0b — Verificar origen de `event_type`:** ✅ Cerrada en Fase -1. Es columna directa en `services`.

**0c — Auditoría de FK cascada:** ✅ Hecha en Fase -1 (D1). La única FK con CASCADE es `sfcom_listings.availability_id → availability`. Todas las demás son NO ACTION. La Fase 3 añadió CASCADE en FKs seleccionadas.

**0d — Auditoría del ciclo de facturación:** ✅ Completado. Todos los bugs detectados quedaron documentados y resueltos en Fases 1b y siguientes. Hallazgo clave: al añadir un cargo manualmente, `persistirCobrosCliente` crea un segundo hito "cobro final" automático (comportamiento esperado, documentado en §7.8).

---

### Fase 1 — ✅ Bugs simples (jun 2026)

1. **`panel.js` alertas** — `calcularAlertas()` filtros corregidos. ✅
2. **`formulario.js` bloque 0** — `otrasActivas` usa `status === 'nueva'`. ✅
3. **`utils.js` `resolverCliente`** — Umbral mínimo 5 chars para `.includes()`. ✅ (fix parcial)
4. **`formulario.js` doble `cargarSolicitudes`** — Eliminada llamada incondicional. ✅

---

### Fase 1b — ✅ Bugs rápidos sin dependencias (jun 2026)

1. ✅ **Cálculo de margen en `panel.js`** — tablas con filtro condicional; sección potencial acotada a `TIPOS_BALCON`.
2. ✅ **Bug cobro no guardado** — `persistirHitosCliente` saltaba cobros con `invoice_number`. Fix: UPDATE parcial de `collected`/`collected_date`. `.select('id')` añadido para detectar fallos silenciosos de RLS.
3. ✅ **Botón "Facturar" no aparece** — añadido `renderCobrosCliente()` tras el INSERT en `btnGuardarNuevoCobro`.
4. ✅ **Cobros facturados no editables** — resuelto como consecuencia directa del fix 2.

---

### Fase 2 — ✅ Comunicaciones semi-automáticas: bienvenida (jun 2026)

Implementado en puro JS desde `formulario.js`, sin asistente. El diseño final difirió del plan original (que preveía usar el asistente en modo `'confirmacion'`): se optó por generación directa en JS porque el mensaje de bienvenida es estructurado y no requiere inteligencia conversacional.

1. ✅ **UI de envío unificada:** `mostrarOpcionesEnvio()` en `utils.js`.
2. ✅ **Botón "📩 Enviar bienvenida"** en la fila de acciones del bloque 4.
3. ✅ **`componerMensajeBienvenida()`** — genera el texto con intro adaptada a los días que quedan para el 6 de julio, bloques por reserva, cierre firmado por Paula.
4. ✅ **`abrirModalBienvenida()`** — modal con `<textarea>` editable + `mostrarOpcionesEnvio`. Al enviar escribe `welcome_sent_at` en las reservas incluidas.
5. ✅ **`welcome_sent_at`** en `reservations` — campo timestamptz.
6. ✅ **Asistente de bienvenidas en lote** — alerta en `panel.html` + modal de selección `_abrirModalSeleccionBienvenidas` + cola en `formulario.js` (`_initBloqueColaBienvenidas`, `_renderTablaColaBienvenidas`).

---

### Fase 3 — ✅ Esquema BD: cascada de borrados y renombrado de IDs (jun 2026)

Migración ejecutada en Supabase SQL Editor en una transacción. 10 FKs redefinidas con DROP + ADD CONSTRAINT.

**ON UPDATE CASCADE — todas las FKs de IDs de texto:**
- `reservations.client_id → clients`
- `charges.client_id → clients`
- `venues.provider_id → providers`
- `payments.provider_id → providers` (también ON DELETE CASCADE)
- `reservations.venue_id → venues`
- `availability.venue_id → venues` (también ON DELETE CASCADE)
- `reservations.service_id → services`
- `availability.service_id → services`

**Efectos en borrado:**
- Borrar un venue → elimina en cascada su `availability` y sus `sfcom_listings`.
- Borrar un proveedor → elimina en cascada sus `payments`. Los venues son NO ACTION: hay que borrarlos primero. Orden: `DELETE FROM venues WHERE provider_id = '...'` → `DELETE FROM providers WHERE id = '...'`.
- `UPDATE providers SET id = 'NUEVO' WHERE id = 'VIEJO'` → propaga a `venues.provider_id`, `payments.provider_id`. Análogamente para clients, venues y services.

**UI de renombrado:** `abrirRenombrarId({ tabla, idActual, supabase, onSuccess })` exportada desde `utils.js`. Botón `✏️ ID` en `formulario.html`, `proveedores.html` y `tablas.js`.

---

### Fase 4 — ✅ Asistente: borrador, notas de sesión y caché de prompts (jun 2026)

1. ✅ Bug asistente: disponibilidad vacía — `expandirServiceIds` normaliza slugs con `split('-')`.
2. ✅ Precios siempre por persona — instrucción explícita en `SYSTEM_PROMPT_ASISTENTE`.
3. ✅ Bug `_onBorradorActualizado` — empareja líneas por `service_id + venue_id` y preserva `estado`.
4. ✅ Auto-transición al enviar — cubierto por `_onRespuestaUsadaEnLog`.
5. ✅ `venue_display_name` en asistente — ya estaba en el system prompt.
6. ✅ `estado` en borrador explicado al asistente — sección BORRADOR DE PROPUESTA ampliada.
7. ✅ Tabla `session_context` en Supabase — creada con `id`, `texto`, `created_at`. RLS habilitado.
8. ✅ Notas de sesión UI — campo en `solicitudes.html`. Blur con cambio → INSERT silencioso.
9. ✅ Edge Function `claude-proxy` actualizada — acepta `system` como `string | array`. Header `anthropic-beta: prompt-caching-2024-07-31` activo.
10. ✅ `system` como array con caché — dos bloques `cache_control: ephemeral`. Penúltimo mensaje del historial también marcado.

---

### Fase 5 — ✅ Flujo sfcom: leads cancelados + reducción de modales (jun 2026)

1. ✅ **Leads cancelados sfcom:** `checkSfcomOrders` devuelve `{ ok, nuevos, cancelados }`. `importarCanceladosSfcom` exportada desde `sfcom.js` — matching silencioso, dedup por cliente+service_id+venue_id+day, INSERT con `status: 'cancelada_sfcom'`. `solicitudes.js`: sección "Leads cancelados sfcom" con botones "🔄 Intentar recuperar" y "↩ Marcar como nueva". `panel.js`: alerta `alerta-cancelados-sfcom`. `asistente-config.js`: modo `recuperar_sfcom`. Supabase: CHECK constraint ampliado.

2. ✅ **Reducción de modales:** 6 cambios (ver §7.2 ✅ RESUELTO para el detalle completo de A-F).

---

### Fase 6 — ✅ Panel: UX de navegación y edición (jun 2026)

1. ✅ Tablas del panel navegables: `onclick` y `cursor:pointer` en filas. Funciones `window._seleccionarEvento` / `window._seleccionarProveedor`. Segundo clic deselecciona. Bidireccional con dropdown.
2. ✅ `services.image_url` editable: campo `inputServicioImageUrl` en "Info del servicio".
3. ✅ Pestañas par/servicio: tabs `data-avail-tab` dentro de `avail-sep`. Tab por defecto según `venue_type === 'balcon'`. Badges de contenido no guardado.
4. ✅ Fotos 16:9: CSS `aspect-ratio: 16/9; overflow: auto` en `.photo-carousel-img-wrap`.
5. ✅ Reordenar fotos: botón "⬆ Subir" en footer del carousel.
6. ✅ `services.image_url` auto-fill: al guardar la primera foto, actualiza `services.image_url` en Supabase y en caché.

---

### Fase 6b — ✅ Asistente: fix mensajes editados + auto-save logs (jun 2026)

1. ✅ Fix `mensajes` con edición: en `_alUsarBoton(texto)`, bucle al revés buscando el último mensaje `role: 'assistant'` con `---MENSAJE_CLIENTE---`, reemplazando el contenido con el texto editado por Paula.
2. ✅ Toggle auto-guardar log: estado en `localStorage('asistente_autolog')`. Al cerrar el overlay: si activo y hay mensajes → INSERT en `assistant_logs`. Al activar el toggle manualmente → guarda inmediatamente.

---

### Fase 6c — ✅ Bugs §7.9: fixes sin fase asignada (jun 2026)

1. ✅ `verificarConsistenciaFinanciera`: protege cobros con historial. Excluye del DELETE a entradas con `tieneHistorial: true`.
2. ✅ `marcarAtendida` requiere confirmación. Modal antes de `status: 'convertida'`.
3. ✅ `cambiarEstadoSeleccionadas` verifica capacidad al reactivar. Comprueba plazas libres con `getPlazasInfo` antes del UPDATE.
4. ✅ `confirmarReorganizacion`: reversión real. Inspecciona `allSettled`; si alguna reversión falló, muestra modal de error grave.

---

### Fase 6d — ✅ Bugs §7.9 segunda tanda (jun 2026)

- `actualizarProveedores`: toast cuando el venue seleccionado no tiene capacidad.
- `cargarReservasCliente`: sincroniza `todasReservas` tras cargar.
- `persistirCobrosCliente`: modal de aviso cuando `cobroFinal` resulta negativo.
- `asistente.js`: toast cuando el JSON de `---BORRADOR---` no es válido.
- `_syncAndWarn(venueId, servicioId)` en `formulario.js`: sustituye a los 5 call sites directos, avisa de sobrereserva y errores de lectura.
- `resolverProductoSfcom` exportado desde `sfcom.js`: consolida la lógica de matching duplicada.

---

### Fase 7 — ✅ Mejoras de propuestas (jun 2026)

- `venues.display_name` ✅ — cadena `filaSaved.nombre ?? venue.display_name ?? svc.name ?? r.venue_id`.
- `availability.description → svc.description` ✅ — fallback correcto en modo Completo.
- `disp?.photos[0] ?? svc.image_url` ✅ — hasta 3 fotos en modo Completo.
- `access_instructions` no se incluye en propuestas (pertenece a confirmaciones, no a propuestas comerciales).
- Dos modos Compacto/Completo implementados.

---

### Fase 8 — ✅ Facturación canal sfcom (jun 2026)

#### El problema

Las reservas del canal sfcom (`origin_ref LIKE 'WEB%'`) ya tienen descontada la comisión del 15% en `price_per_slot`. El dinero técnicamente "ya está cobrado" por sfcom. El sistema de cobros normal no reflejaba esto. Paula necesitaba también poder facturar a Hilario el importe acumulado de ventas del canal.

#### Decisión de diseño

**Ángulo 1 — Cliente real:** cada reserva sfcom del cliente real genera un `charges` row con `collected=true` y `comments='${origin_ref} Cobrado vía sfcom'`. El cobro final automático del cliente real queda en 0€.

**Ángulo 2 — Canal sfcom:** cliente `SFCOM` en `clients` representa a Hilario/la tienda. Al abrirlo en formulario.html, el sistema muestra una fila virtual (`SFCOM_CANAL`) que agrega todas las ventas WEB% activas, y genera un "Cobro final" real en `charges` bajo `client_id='SFCOM'` por el total acumulado. Ese es el importe a facturar a Hilario.

Los KPIs del panel excluyen explícitamente los `charges` de `client_id='SFCOM'` para evitar doble conteo.

#### Base de datos

- Fila `id='SFCOM', name='Canal sfcom (tienda.sanfermin.com)'` en `clients`. Creada manualmente jun 2026.
- Capa A en `charges`: `client_id = cliente real`, `amount = reserva.total_amount`, `collected = true`, `comments = '${origin_ref} Cobrado vía sfcom'`, `is_final = false`.
- Capa B en `charges`: `client_id = 'SFCOM'`, `amount = suma total WEB% activas`, `is_final = true`, `collected = false` hasta que Paula marque la liquidación.

**Identificador de capa A:** `comments` incluye el WEB ref (`'WEB038_1102 Cobrado vía sfcom'`). El DELETE de cancelación filtra por `comments = '${r.origin_ref} Cobrado vía sfcom'` (match exacto).

**Migración de datos (jun 2026):** los 24 cargos existentes con `comments = 'Cobrado vía sfcom'` (sin WEB ref) fueron actualizados al nuevo formato mediante SQL (documentado en historial de la sesión jun 2026).

#### SQL ejecutados (ya aplicados, no repetir)

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

#### Código modificado

- `calcularTotalCobrarCliente`: para SFCOM filtra `todasReservas` por `origin_ref LIKE 'WEB%'`.
- `cargarReservasCliente`: rama SFCOM construye fila virtual `SFCOM_CANAL` en memoria.
- `cargarCobrosCliente`: guard `if (!hitosClienteTemp.find(h => h.esFinal)) { if (cobroFinal >= 0.01) { ... } }`.
- `renderTablaReservas`: null safety para `price_per_slot: null` de la fila virtual.
- `limpiarCamposCliente`: restaura botones ocultados al entrar en SFCOM.
- `btnAnadirReserva`: al guardar reserva sfcom, INSERT automático en `charges` con `collected=true`.
- `cambiarEstadoSeleccionadas`: al cancelar reserva sfcom, DELETE del cargo correspondiente por `comments = '${r.origin_ref} Cobrado vía sfcom'`.
- `persistirCobrosCliente` (`utils.js`): cálculo del total para SFCOM usa WEB%; guard evita crear cobro final de 0€ cuando no existe ninguno previo.
- `panel.js` (`calcularEstadoFinanciero`, `calcularCashflow`, `verificarConsistenciaFinanciera`): excluyen `client_id='SFCOM'`.

#### Cómo facturar a Hilario

1. Abrir formulario.html → buscar cliente `SFCOM`.
2. El bloque 5 muestra el cobro final automático (= total de todas las ventas WEB% activas).
3. Para facturar: pulsar "Facturar" en el hito → factura PDF serie VSF.
4. Marcar como cobrado cuando Hilario transfiera el importe.

#### Limitaciones conocidas y aceptadas

1. El cargo sfcom no tiene FK a la reserva (`charges` no tiene `reservation_id`). El vínculo es implícito por `comments`. Si un cliente tiene dos reservas sfcom con el mismo importe exacto procesadas el mismo día, la UNIQUE constraint bloquearía la segunda inserción. En la práctica es improbable.
2. El cobro final de SFCOM se queda obsoleto entre visitas. Se auto-corrige en la próxima apertura del cliente SFCOM.
3. Los KPIs excluyen el importe pendiente de Hilario — es intencional.

---

### Fase 8b — ✅ Fix sfcom: WEB ref en charges + corrección datos R0103/R0104 (jun 2026)

**Problema 1 — Conversión multi-línea perdía `origin_ref` a partir de la segunda reserva.**

`limpiarFormularioReserva()` resetea `solicitudOriginRef = null`. Fix: nueva variable de módulo `_solicitudWEBRef` inicializada en `_initBloqueConversion(solicitudId, webRef, draft, nombreCliente)` con el `data.source` de la solicitud. Se restaura en `_cargarLineaEnBloque2`, en el handler de "Descartar" y en `_onLineaGuardada`.

**Problema 2 — Single-line desde URL sobreescribía el WEB ref con UUID.**

`cargarDesdeSolicitud` dejaba `solicitudOriginRef` con el WEB ref correcto, pero un call site posterior hacía `solicitudOriginRef = sol.id`. Fix: condición añadida: `if (!_modoConversionActivo && !solicitudOriginRef) solicitudOriginRef = sol.id`.

**Corrección de datos en BD (ejecutada manualmente, no repetir):**
- `UPDATE reservations SET origin_ref = 'WEB038_1102' WHERE id = 'R0104'`
- INSERT manual del cargo sfcom de R0104.
- Migración de los 24 charges existentes al nuevo formato `'WEBxxx_yyy Cobrado vía sfcom'`.

---

### Fase 9 — ✅ Refactors y cierre (jun 2026)

- ✅ Inferencia `level → service_id`: `parsearNivel` y `TIPO_SERVICIO_ID` en `utils.js`. Matching consolidado en `resolverProductoSfcom`.
- ✅ Reglas de nombres venue/evento documentadas en §3.
- ✅ Caché sfcom granularidad: verificada y aceptada. Por item (`productId:variationId`) via `_stockCache` (Map).
- ✅ Bugs §7.9 segunda tanda (Fase 6d): resueltos.
- 🔲 Split de `formulario.js` — diferido conscientemente.
- ⬇️ Tablas.js edición + Storage + eliminar cliente + PDFs huérfanos → movido a Fase 10.

---

### Fase 9b — ✅ Mejoras asistente + fixes arquitectura web form + Edge Function (jun 2026)

1. ✅ Modal "Nueva consulta": campos en grid 4 columnas, opciones de idioma en código, columnas Venue y €/pax en tabla del borrador, `_leerDOMEnDraft()` y `_rellenarDesdeParseado()` actualizados.
2. ✅ `SYSTEM_PROMPT_PARSING`: JSON ampliado con `venue_hint` y `price_hint`. Nueva sección "CUANDO EL TEXTO ES UN HILO DE CONVERSACIÓN".
3. ✅ Fix alertas panel.js: `leadsCancelados` filtra `status === 'nueva'`. `solicitudesWebNuevas`/`WebSeguimiento` excluyen `sfcom_c:`.
4. ✅ Fix fecha en listado: `_renderFila()` muestra `updated_at ?? created_at`.
5. ✅ Fix flash de `bloque-solicitudes`: añadido `style="display:none"` directamente en el HTML.
6. ✅ Fix arquitectura: comentario del formulario web en `conversation_notes` (campo `comment` dentro del JSON de `rawData`). Eliminado el campo `comments` del INSERT. `solicitudes.js` lee `rawData.comment || sol.comments`.
7. ✅ Edge Function `notificar-solicitud` reescrita: lee `conversation_notes` y `proposal_draft[0]` en lugar de columnas legacy. Filtro de origen: solo envía email para formulario web público (`source IS NULL`).

---

### Fase 9c — ✅ Migración services.id: text PK → integer + service_code (jun 2026)

**Archivos JS modificados:** `utils.js`, `formulario.js`, `proveedores.js`, `solicitudes.js`, `asistente.js`, `sfcom.js`, `sfcom-panel.js`, `verificacion.js`, `panel.js`, `tablas.js`, `propuesta.js`.

**Cambios arquitecturales:**
- `services.id` pasa de text (`ENCIERRO_7`) a integer autoincremental.
- `services.service_code` (text UNIQUE NOT NULL) almacena los códigos que antes eran el PK.
- `availability.service_id` y `reservations.service_id`: FK integer.
- `reservation_requests.service_id` y `proposal_draft[].service_id`: integer (migrado por SQL JSONB UPDATE).
- Las 4 vistas reconstruidas. `service_availability` expone `service_code AS service_id` (text) para el frontend público.
- `availability_panel` añade la columna `service_code`.

**Reglas de uso JS:**
- `service_id` (integer) solo para queries Supabase (`.eq`, `.filter`, comparaciones con `r.service_id`).
- `service_code` (text) para todo lo visible en UI, patrones regex, `TIPO_SERVICIO_ID`, `_inferirServiceId`.
- DOM selects: `opt.value = s.id` (integer → string en HTML); siempre `parseInt(select.value)` antes de comparar.
- Nuevo helper `serviceCodesToIds(codes, disponibilidad)` en `utils.js`.

**Trigger `uppercase_ids`:** actualizado en Supabase Dashboard → Functions: cambiado `WHEN 'services' THEN NEW.id := UPPER(NEW.id)` por `WHEN 'services' THEN NEW.service_code := UPPER(NEW.service_code)`.

**`tablas.js`:** columna `id` de la tabla `services` ya no tiene `renameable: true`. Nueva columna `Código` expone `service_code`.

**SQL:** `supabase/sql/migration_fase1_services_pk.sql` (ejecutar en Supabase SQL Editor). **Referencia pre-migración:** `supabase/sql/views_pre_migration.sql`.

---

### Fase 9c (segunda parte) — ✅ Bugs §7 Medio/Bajo + año dinámico (jun 2026)

**`anioTemporada()` en `utils.js`:** cutoff 1 de agosto. De enero a julio devuelve el año actual; de agosto a diciembre devuelve el año siguiente. Aplicada en `propuesta.js` (3 puntos), `factura.js` (2 puntos), `asistente.js` (2 puntos).

**Bugs Medio resueltos:**
- `rebind()` en `_renderBorrador`: preserva el foco de inputs numéricos.
- Edición de mensajes sin restricción de fecha: eliminada la condición `isToday`.
- `_onBorradorActualizado` sin fallo silencioso: si la solicitud no está en los arrays, actualiza `solicitudActual` directamente.
- `togglePagoProvCobrado` con modal propio: eliminado `prompt()`, nueva función `_pedirFechaPago()`.
- `execCommand('copy')` → `navigator.clipboard.writeText()` en los 4 botones de `sfcom.js`.

**Bugs Alto resueltos en la misma sesión:**
- `resolverProductoSfcom` exportado desde `sfcom.js`.
- `syncStockToSfcom` devuelve `{ sobrereserva, serviceName }`.
- `actualizarProveedores`: toast cuando el proveedor activo queda fuera del filtro.
- `cargarReservasCliente`: sincroniza `todasReservas` tras cargar.
- `persistirCobrosCliente`: modal de aviso cuando `cobroFinal` resulta negativo.
- `asistente.js`: toast cuando el JSON de `---BORRADOR---` no es válido.

**`assistant_logs` sin RLS — ✅ RESUELTO.** RLS habilitado en Supabase Dashboard.
