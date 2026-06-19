// sfcom.js
// Comunicación bidireccional con tienda.sanfermin.com via sf-api-paula.php
// Flujo A (lectura):  sfcom → detectar pedidos nuevos → avisar al panel
// Flujo B (escritura): reserva guardada en Supabase → actualizar stock en sfcom

import { crearModal } from './modal.js'
import { supabase   } from './supabase.js'

// ─── Utilidades de extracción: nombres y días ────────────────────────────────

// Extrae el nombre de producto sfcom de un nombre de variación WooCommerce completo.
// Ejemplo: "Balcón Estafeta - Viernes 10 de Julio 2026" → "Balcón Estafeta"
// Ejemplo: "Balcón Estafeta mitad - Martes 14 de Julio 2026" → "Balcón Estafeta mitad"
// Usa prefix-scan contra la lista de sfcom_service_name conocidos para resolver
// ambigüedades ("Balcón Estafeta" vs "Balcón Estafeta mitad").
// Devuelve el nombre original (sin normalizar) tal como está en la BD, o null.
export function extraerNombreProducto(fullName, nombres) {
    if (!fullName || !nombres?.length) return null

    const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
    const normalizedFull = norm(fullName)
    const nombresNorm    = nombres.map(n => ({ original: n, normalized: norm(n) }))

    let lastMatch  = null
    let candidates = nombresNorm.slice()

    for (let i = 1; i <= normalizedFull.length; i++) {
        const prefix = normalizedFull.slice(0, i)
        const exact  = candidates.find(c => c.normalized === prefix)
        if (exact) lastMatch = exact.original
        candidates = candidates.filter(c => c.normalized.startsWith(prefix))
        if (candidates.length === 0) break
    }

    return lastMatch
}

// Extrae el número de día de julio (6–14) de cualquier texto sfcom.
// Cubre "NN de Julio" (variaciones WooCommerce) y fallbacks adicionales.
export function extraerDia(texto) {
    if (!texto) return null
    const m = texto.match(/\b(\d{1,2})\s+de\s+julio\b/i)
           || texto.match(/\bjulio\s+(\d{1,2})\b/i)
    if (m) {
        const n = parseInt(m[1])
        if (n >= 6 && n <= 14) return n
    }
    return null
}

const API_URL = 'https://tienda.sanfermin.com/sf-api-paula.php'

// Cache de stock sfcom en memoria. Se puebla en verificarCoherencia y se actualiza en cada PUT.
// Se invalida al recargar la página (módulo en memoria). Los PUTs mantienen la coherencia entre
// operaciones; verificarCoherencia refresca el estado completo en cada carga del panel.
const _stockCache  = new Map()
const _cacheKey    = (productId, variationId) => `${productId}:${variationId ?? ''}`
const _cacheSet    = (productId, variationId, stock) => _stockCache.set(_cacheKey(productId, variationId), stock)
const _cacheGet    = (productId, variationId) => {
    const key = _cacheKey(productId, variationId)
    return _stockCache.has(key) ? _stockCache.get(key) : undefined  // undefined = no cacheado; null = cacheado como null
}

// ─── Utilidad interna: llamada a la API ──────────────────────────────────────
// Proxy transparente vía Supabase Edge Function (sfcom-bridge) para evitar CORS.
// La Edge Function reenvía el endpoint, método y payload a sf-api-paula.php
// server-to-server, con la clave API almacenada como secreto de Supabase.

async function apiFetch(endpoint, method = 'GET', body = null) {
    const { data, error } = await supabase.functions.invoke('sfcom-bridge', {
        body: { endpoint, method, payload: body }
    })
    if (error) {
        console.error(`[sfcom] Bridge error (${method} ${endpoint}):`, error)
        throw new Error(error.message)
    }
    return data
}

// ─── Utilidad interna: construir endpoint de stock ───────────────────────────
// Si tiene variation_id → products/{product_id}/variations/{variation_id}
// Si no               → products/{product_id}

function buildStockEndpoint(productId, variationId) {
    if (variationId) return `products/${productId}/variations/${variationId}`
    return `products/${productId}`
}

// Endpoint stock-all: devuelve { updated_at, count, stock: { "id": qty, ... } }.
// Cubre productos simples y variaciones en un único GET sin tocar WooCommerce.
// Sin límite de uso — usar para todas las lecturas de stock.
async function apiFetchStockAll() {
    const result = await apiFetch('stock-all')
    return result?.stock ?? {}
}

// ────────────────────────────────────────────────────────────────────────────
// FLUJO B: syncStockToSfcom
// Llama tras guardar, editar o cancelar cualquier reserva en Supabase.
// Lee la fila de availability, cuenta reservas no canceladas, y hace el PUT.
// Si el PUT falla, muestra modal con correo listo para enviar a Hilario.
// ────────────────────────────────────────────────────────────────────────────

export async function syncStockToSfcom(supabase, venueId, serviceId) {
    // 1. Leer fila de availability
    const { data: avail, error: errAvail } = await supabase
        .from('availability_with_sfcom')
        .select('sfcom_service_name, sfcom_slots_listed, sfcom_product_id, sfcom_variation_id, sfcom_status, total_slots')
        .eq('venue_id', venueId)
        .eq('service_id', serviceId)
        .single()

    if (errAvail || !avail) {
        console.warn(`[sfcom] No se encontró availability para ${venueId} + ${serviceId}`)
        return { ok: true, skipped: true, reason: 'no_availability_row' }
    }

    // 2. Solo sincronizar si el servicio está confirmado en sfcom
    if (avail.sfcom_status !== 'confirmed' || !avail.sfcom_service_name || avail.sfcom_slots_listed === null || !avail.sfcom_product_id) {
        return { ok: true, skipped: true, reason: 'not_mapped' }
    }

    // 3. Calcular stock: sfcom solo puede vender lo que le corresponde menos lo que ya vendió,
    //    pero tampoco puede vender más plazas de las que quedan libres en total.
    const [{ data: sfcomData, error: errSfcom }, { data: allData, error: errAll }] = await Promise.all([
        supabase.from('reservations').select('slots')
            .eq('venue_id', venueId).eq('service_id', serviceId)
            .like('origin_ref', 'WEB%').neq('status', 'Cancelada'),
        supabase.from('reservations').select('slots')
            .eq('venue_id', venueId).eq('service_id', serviceId)
            .neq('status', 'Cancelada')
    ])

    if (errSfcom || errAll) {
        const msg = errSfcom?.message ?? errAll?.message
        console.error(`[sfcom] Error al leer reservas: ${msg}`)
        return { ok: false, error: msg }
    }

    // 4. Calcular nuevo stock y hacer el PUT
    const sfcomVendidas = (sfcomData  ?? []).reduce((s, r) => s + (r.slots ?? 0), 0)
    const todasOcupadas = (allData    ?? []).reduce((s, r) => s + (r.slots ?? 0), 0)
    const nuevoStock    = Math.max(0, Math.min(
        avail.sfcom_slots_listed - sfcomVendidas,
        avail.total_slots        - todasOcupadas
    ))
    const endpoint        = buildStockEndpoint(avail.sfcom_product_id, avail.sfcom_variation_id)

    try {
        await apiFetch(endpoint, 'PUT', { stock_quantity: nuevoStock })

        _cacheSet(avail.sfcom_product_id, avail.sfcom_variation_id, nuevoStock)
        return { ok: true, nuevoStock, sfcomVendidas, todasOcupadas }
    } catch (e) {
        console.error(`[sfcom] PUT fallido para ${avail.sfcom_service_name}: ${e.message}`)
        mostrarModalError({
            servicio:   avail.sfcom_service_name,
            venueId,
            serviceId,
            endpoint,
            nuevoStock,
            putError:   e.message
        })
        return { ok: false, error: e.message }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// FLUJO A: checkSfcomOrders
// Consulta pedidos completados en sfcom y devuelve los que no están
// registrados en reservations (por origin_ref).
// Se llama al cargar el panel y antes de guardar una reserva.
//
// Nota: el endpoint «orders» no está documentado en sf-api-paula.php (la
// documentación de Hilario cubre solo products y variations). Si la API no
// lo soporta, el GET fallará y se mostrará el modal de aviso. Confirmar con
// Hilario si este endpoint está disponible antes de asumir que el flujo A
// funciona.
// ────────────────────────────────────────────────────────────────────────────

export async function checkSfcomOrders(supabase) {
    let sfcomOrders
    try {
        const response = await apiFetch('orders')
        sfcomOrders = Array.isArray(response) ? response : (response?.data || [])

    } catch (e) {
        console.warn(`[sfcom] checkSfcomOrders: GET fallido. ${e.message}`)
        mostrarModalAvisoOrders()
        return { ok: false, error: e.message, nuevos: [] }
    }

    if (!sfcomOrders?.length) return { ok: true, nuevos: [] }

    const { data: reservasConRef } = await supabase
        .from('reservations')
        .select('origin_ref')
        .like('origin_ref', 'WEB%')

    const refsRegistradas = new Set((reservasConRef ?? []).map(r => r.origin_ref))

    const _mapOrder = order => ({
        sfcom_id:        order.id,
        sfcom_number:    order.number,
        fecha:           order.date_created,
        total:           order.total,
        cliente: {
            nombre:      `${order.billing?.first_name ?? ''} ${order.billing?.last_name ?? ''}`.trim(),
            email:       order.billing?.email    ?? '',
            telefono:    order.billing?.phone    ?? '',
            direccion:   [order.billing?.address_1, order.billing?.address_2, order.billing?.city, order.billing?.country].filter(Boolean).join(', ') || null,
            comentarios: order.customer_note     || null
        },
        productos: (order.line_items ?? []).map(li => ({
            nombre:       (li.name ?? '').replace(/<[^>]*>/g, '').trim(),
            product_id:   li.product_id,
            variation_id: li.variation_id || null,
            cantidad:     li.quantity,
            precio:       li.total
        }))
    })

    const nuevos = sfcomOrders
        .filter(order => !refsRegistradas.has(`${order.number}_${order.id}`) && order.status === 'completed')
        .map(order => ({ origin_ref: `${order.number}_${order.id}`, ..._mapOrder(order) }))

    // Pedidos cancelados: se importan como solicitudes con prefijo sfcom_c: para distinguirlos.
    // Comprobamos contra reservation_requests.source (nunca pasan a reservations).
    const { data: canceladosExistentes } = await supabase
        .from('reservation_requests')
        .select('source')
        .like('source', 'sfcom_c:%')

    const canceladosRegistrados = new Set((canceladosExistentes ?? []).map(r => r.source))

    const cancelados = sfcomOrders
        .filter(order => {
            const ref = `sfcom_c:${order.number}_${order.id}`
            return !canceladosRegistrados.has(ref) && order.status === 'cancelled'
        })
        .map(order => ({ origin_ref: `sfcom_c:${order.number}_${order.id}`, cancelled: true, ..._mapOrder(order) }))

    return { ok: true, nuevos, cancelados }
}

// ────────────────────────────────────────────────────────────────────────────
// checkAvailabilityBeforeSave
// Verifica disponibilidad en sfcom justo antes de guardar una reserva nueva.
// Hace GET del stock actual y detecta si hay pedidos en sfcom que no hemos
// procesado todavía y que podrían afectar la disponibilidad real.
//
// Si el GET falla, permite continuar sin bloquear (la API puede estar caída
// momentáneamente — no podemos bloquear una reserva legítima por eso).
// ────────────────────────────────────────────────────────────────────────────

export async function checkAvailabilityBeforeSave(supabase, venueId, serviceId, plazasSolicitadas) {
    const { data: avail } = await supabase
        .from('availability_with_sfcom')
        .select('sfcom_service_name, sfcom_slots_listed, sfcom_product_id, sfcom_variation_id, sfcom_status, total_slots')
        .eq('venue_id', venueId)
        .eq('service_id', serviceId)
        .single()

    if (!avail?.sfcom_product_id || avail.sfcom_status !== 'confirmed') {
        return { ok: true, sfcomCheck: false }
    }

    let stockSfcom
    try {
        const stockMap = await apiFetchStockAll()
        const lookupId = String(avail.sfcom_variation_id ?? avail.sfcom_product_id)
        stockSfcom     = lookupId in stockMap ? stockMap[lookupId] : null
        _cacheSet(avail.sfcom_product_id, avail.sfcom_variation_id, stockSfcom)
    } catch (e) {
        console.warn(`[sfcom] checkAvailabilityBeforeSave: GET fallido. No se verifica disponibilidad sfcom. ${e.message}`)
        return { ok: true, sfcomCheck: false, warning: e.message }
    }

    if (stockSfcom === null) return { ok: true, sfcomCheck: false }

    // Calcular stock esperado con la fórmula correcta (dos componentes)
    const [{ data: sfcomData }, { data: allData }] = await Promise.all([
        supabase.from('reservations').select('slots')
            .eq('venue_id', venueId).eq('service_id', serviceId)
            .like('origin_ref', 'WEB%').neq('status', 'Cancelada'),
        supabase.from('reservations').select('slots')
            .eq('venue_id', venueId).eq('service_id', serviceId)
            .neq('status', 'Cancelada')
    ])
    const sfcomVendidas  = (sfcomData ?? []).reduce((s, r) => s + (r.slots ?? 0), 0)
    const todasOcupadas  = (allData   ?? []).reduce((s, r) => s + (r.slots ?? 0), 0)
    const stockEsperado  = Math.max(0, Math.min(
        avail.sfcom_slots_listed - sfcomVendidas,
        avail.total_slots        - todasOcupadas
    ))

    // Aviso si sfcom muestra menos stock del esperado (puede haber pedidos pendientes de procesar)
    if (stockSfcom < stockEsperado) {
        return {
            ok: true,
            sfcomCheck: true,
            stockSfcom,
            stockEsperado,
            warning: `sfcom muestra ${stockSfcom} plaza(s) disponibles para "${avail.sfcom_service_name}" pero el sistema espera ${stockEsperado}. Puede haber pedidos de sfcom pendientes de procesar. Verifica el panel antes de confirmar.`
        }
    }

    return { ok: true, sfcomCheck: true, stockSfcom }
}

// ────────────────────────────────────────────────────────────────────────────
// computeExpectedStock (exportado)
// Calcula el stock esperado para un par después de aplicar un delta de reservas.
// Sirve para construir la lista de cambios que se muestra en el modal consultivo
// antes de guardar en Supabase.
// delta = 0 (cambio de estado), +1 (nueva reserva), -1 (eliminar reserva), etc.
// Devuelve null si el par no tiene sfcom configurado y confirmado.
// ────────────────────────────────────────────────────────────────────────────

// sfcomDelta: plazas que se añaden/quitan con origin_ref WEB% (reservas de sfcom)
// allDelta:   plazas totales que se añaden/quitan (sfcom + propias)
export async function computeExpectedStock(supabase, venueId, serviceId, { sfcomDelta = 0, allDelta = 0 } = {}) {
    const { data: avail } = await supabase
        .from('availability_with_sfcom')
        .select('sfcom_service_name, sfcom_slots_listed, sfcom_product_id, sfcom_variation_id, sfcom_status, total_slots')
        .eq('venue_id', venueId)
        .eq('service_id', serviceId)
        .single()

    if (!avail?.sfcom_product_id || avail.sfcom_status !== 'confirmed') return null
    if (avail.sfcom_slots_listed === null) return null

    const [{ data: sfcomData }, { data: allData }] = await Promise.all([
        supabase.from('reservations').select('slots')
            .eq('venue_id', venueId).eq('service_id', serviceId)
            .like('origin_ref', 'WEB%').neq('status', 'Cancelada'),
        supabase.from('reservations').select('slots')
            .eq('venue_id', venueId).eq('service_id', serviceId)
            .neq('status', 'Cancelada')
    ])

    const sfcomVendidas = (sfcomData ?? []).reduce((s, r) => s + (r.slots ?? 0), 0) + sfcomDelta
    const todasOcupadas = (allData   ?? []).reduce((s, r) => s + (r.slots ?? 0), 0) + allDelta
    const nuevoStock    = Math.max(0, Math.min(
        avail.sfcom_slots_listed - sfcomVendidas,
        avail.total_slots        - todasOcupadas
    ))

    let stockActual = null
    const _cached2 = _cacheGet(avail.sfcom_product_id, avail.sfcom_variation_id)
    if (_cached2 !== undefined) {
        stockActual = _cached2
    } else {
        try {
            const stockMap = await apiFetchStockAll()
            const lookupId = String(avail.sfcom_variation_id ?? avail.sfcom_product_id)
            stockActual    = lookupId in stockMap ? stockMap[lookupId] : null
            _cacheSet(avail.sfcom_product_id, avail.sfcom_variation_id, stockActual)
        } catch (e) {
            console.warn(`[sfcom] No se pudo leer stock actual de ${avail.sfcom_service_name}: ${e.message}`)
        }
    }

    return { servicio: avail.sfcom_service_name, venueId, serviceId, stockActual, nuevoStock }
}

// Computa el stock esperado para cada par y muestra el modal consultivo pre-save.
// pares: [{ venueId, serviceId, sfcomDelta?, allDelta? }]
// Devuelve 'sync' (guardar + PUT a sfcom), 'save' (solo guardar) o 'cancel' (abortar).
// Devuelve 'sync' directamente si ningún par tiene sfcom activo (sin modal).
export async function confirmarStockSfcom(supabase, pares) {
    const cambios = []
    for (const { venueId, serviceId, sfcomDelta = 0, allDelta = 0 } of pares) {
        const cambio = await computeExpectedStock(supabase, venueId, serviceId, { sfcomDelta, allDelta })
        if (cambio) cambios.push(cambio)
    }
    if (cambios.length === 0) return 'sync'
    if (cambios.every(c => c.nuevoStock === c.stockActual)) return 'sync'
    return mostrarModalConfirmacionSfcom(cambios)
}

// ────────────────────────────────────────────────────────────────────────────
// mostrarModalConfirmacionSfcom (exportado)
// Modal consultivo pre-save: muestra los cambios de stock previstos en sfcom
// y pide confirmación antes de guardar en Supabase y ejecutar los PUTs.
// cambios: [{ servicio, venueId, serviceId, stockActual, nuevoStock }]
// Devuelve Promise<boolean> — true si el admin confirma, false si cancela.
// ────────────────────────────────────────────────────────────────────────────

export function mostrarModalConfirmacionSfcom(cambios) {
    return new Promise(resolve => {
        const { overlay, panel } = crearModal('sfcom-modal-confirmacion')

        const filas = cambios.map(c => `
            <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:6px 10px;font-size:12px;color:#374151">${c.servicio}</td>
                <td style="padding:6px 10px;font-size:12px;color:#6b7280;text-align:center">${c.stockActual ?? '?'}</td>
                <td style="padding:6px 10px;font-size:12px;font-weight:600;color:#166534;text-align:center">${c.nuevoStock}</td>
            </tr>`
        ).join('')

        panel.innerHTML = `
            <div class="modal-header">
                <span class="modal-header-icon">🔄</span>
                <div>
                    <div class="modal-header-title">Actualizar disponibilidad en sfcom</div>
                    <div class="modal-header-desc">Los cambios se guardarán en el sistema. Decide si también quieres actualizar el stock en sfcom ahora.</div>
                </div>
            </div>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
                <thead>
                    <tr style="background:#f9fafb">
                        <th style="padding:7px 10px;font-size:11px;color:#6b7280;text-align:left;font-weight:500;text-transform:uppercase;letter-spacing:.05em">Servicio</th>
                        <th style="padding:7px 10px;font-size:11px;color:#6b7280;text-align:center;font-weight:500;text-transform:uppercase;letter-spacing:.05em">Stock actual</th>
                        <th style="padding:7px 10px;font-size:11px;color:#6b7280;text-align:center;font-weight:500;text-transform:uppercase;letter-spacing:.05em">Nuevo stock</th>
                    </tr>
                </thead>
                <tbody>${filas}</tbody>
            </table>
            <div class="modal-actions">
                <button id="sfcom-conf-cancelar-todo" class="btn btn-danger">Cancelar todo</button>
                <button id="sfcom-conf-solo-guardar" class="btn btn-secondary">Solo guardar</button>
                <button id="sfcom-conf-aceptar" class="btn btn-primary">Guardar y actualizar sfcom</button>
            </div>`

        panel.querySelector('#sfcom-conf-cancelar-todo').addEventListener('click', () => { overlay.remove(); resolve('cancel') })
        panel.querySelector('#sfcom-conf-solo-guardar').addEventListener('click', () => { overlay.remove(); resolve('save') })
        panel.querySelector('#sfcom-conf-aceptar').addEventListener('click', () => { overlay.remove(); resolve('sync') })
    })
}

// ────────────────────────────────────────────────────────────────────────────
// mostrarModalError (interno)
// Modal de error con información técnica y texto del correo para Hilario.
// Se dispara cuando falla el PUT de stock.
// El modal no se cierra solo — Paula debe pulsar "Cerrar" explícitamente.
// ────────────────────────────────────────────────────────────────────────────

function mostrarModalError({ servicio, venueId, serviceId, endpoint, nuevoStock, putError }) {
    const endpointCompleto = `${API_URL}?endpoint=${encodeURIComponent(endpoint)}`
    const subject          = `Disponibilidad "${servicio}" — revisión pendiente`

    const cuerpoCorreo = [
        `Hola Hilario,`,
        ``,
        `Ha habido un problema al sincronizar la disponibilidad de uno de los balcones desde nuestro sistema.`,
        ``,
        `Al registrar una reserva para "${servicio}" (${venueId} / ${serviceId}), el sistema intentó actualizar automáticamente el stock:`,
        ``,
        `PUT ${endpointCompleto}`,
        `Nuevo stock calculado: ${nuevoStock} plaza(s)`,
        `Resultado: Error — ${putError}`,
        ``,
        `Lo más probable es que sea un problema puntual. El stock correcto para "${servicio}" debería quedar en ${nuevoStock} plaza(s) disponibles. ¿Podrías revisarlo y actualizarlo manualmente si es necesario?`,
        ``,
        `Muchas gracias,`,
        `Paula`
    ].join('\n')

    const { overlay, panel } = crearModal('sfcom-modal-error', { wide: true, scroll: true })

    panel.innerHTML = `
        <div class="modal-header">
            <span class="modal-header-icon">⚠️</span>
            <div>
                <div class="modal-header-title" style="color:#991b1b">No se pudo actualizar la disponibilidad en sfcom</div>
                <div class="modal-header-desc">La reserva se ha guardado correctamente en tu sistema, pero ha habido un problema al actualizar el stock en sfcom. Revísalo manualmente o contacta con Hilario.</div>
            </div>
        </div>
        <div class="modal-code">
            <div><strong>Servicio:</strong> ${servicio}</div>
            <div><strong>Endpoint:</strong> ${endpointCompleto}</div>
            <div><strong>Nuevo stock:</strong> ${nuevoStock} plaza(s)</div>
            <div><strong>Error:</strong> ${putError}</div>
        </div>
        <div class="modal-email-block">
            <div class="modal-email-label">Texto del correo para Hilario</div>
            <textarea id="sfcom-email-texto" class="modal-email-textarea" readonly>${cuerpoCorreo}</textarea>
        </div>
        <div class="modal-actions">
            <button id="sfcom-btn-copiar" class="btn btn-secondary">📋 Copiar texto</button>
            <a id="sfcom-btn-mailto" class="btn btn-primary"
                href="mailto:hilario@goviwebs.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(cuerpoCorreo)}"
                style="text-decoration:none">
                ✉️ Abrir en correo
            </a>
            <button id="sfcom-btn-cerrar" class="btn btn-secondary">Cerrar</button>
        </div>`

    panel.querySelector('#sfcom-btn-copiar').addEventListener('click', () => {
        const ta  = panel.querySelector('#sfcom-email-texto')
        const btn = panel.querySelector('#sfcom-btn-copiar')
        ta.select()
        document.execCommand('copy')
        btn.textContent = '✅ Copiado'
        setTimeout(() => { btn.textContent = '📋 Copiar texto' }, 2000)
    })

    panel.querySelector('#sfcom-btn-cerrar').addEventListener('click', () => overlay.remove())
}

// ────────────────────────────────────────────────────────────────────────────
// mostrarModalAvisoOrders (interno)
// Aviso cuando checkSfcomOrders no puede conectar con sfcom.
// Solo se muestra una vez por sesión para no interrumpir al admin en cada carga.
// ────────────────────────────────────────────────────────────────────────────

function mostrarModalAvisoOrders() {
    if (sessionStorage.getItem('sfcom-orders-warned')) return
    sessionStorage.setItem('sfcom-orders-warned', '1')

    const { overlay, panel } = crearModal('sfcom-modal-aviso', { narrow: true })

    panel.innerHTML = `
        <div class="modal-header">
            <span class="modal-header-icon">⚠️</span>
            <div>
                <div class="modal-header-title" style="color:#92400e">No se pudieron cargar los pedidos de sfcom</div>
                <div class="modal-header-desc">No ha sido posible conectar con sfcom para comprobar si hay pedidos nuevos. Consulta el panel manualmente:<br><br>
                    <a href="https://tienda.sanfermin.com/dashboard.html" target="_blank" style="color:#1d4ed8;text-decoration:underline">Panel de Métricas — San Fermín</a>
                </div>
            </div>
        </div>
        <div class="modal-actions">
            <button id="sfcom-btn-aviso-aceptar" class="btn btn-secondary">Aceptar</button>
        </div>`

    panel.querySelector('#sfcom-btn-aviso-aceptar').addEventListener('click', () => overlay.remove())
}

// ────────────────────────────────────────────────────────────────────────────
// verificarCoherencia
// Lee Supabase completo y verifica la integridad interna + disponibilidad sfcom.
//
// Devuelve:
//   {
//     ok: boolean,              — false si hay errores de coherencia en Supabase
//     errores: string[],        — problemas críticos (FK rotas, sobrereservas, etc.)
//     avisos: string[],         — impactos potenciales sin ser errores (solicitudes pendientes)
//     sfcom: {
//       verificado: boolean,    — true si todos los GETs a sfcom completaron
//       discrepancias: [...],   — stocks que no coinciden con lo esperado
//       error: string | null    — mensaje si algún GET falló
//     }
//   }
//
// Si algún GET a sfcom falla, sfcom.verificado queda false y sfcom.error contiene
// el motivo. Los errores y avisos de Supabase se devuelven igualmente.
// ────────────────────────────────────────────────────────────────────────────

export async function verificarCoherencia(supabase, { checkVariationNames = false } = {}) {
    const resultado = {
        ok:     true,
        errores: [],
        avisos:  [],
        sfcom: { verificado: false, discrepancias: [], idsMismatch: [], fallos: [], error: null }
    }

    // ── Carga en paralelo ───────────────────────────────────────────
    const [
        { data: reservas,     error: eRes },
        { data: availability, error: eAvail },
        { data: clients,      error: eClients },
        { data: venues,       error: eVenues },
        { data: services,     error: eServices },
        { data: solicitudes,  error: eSol }
    ] = await Promise.all([
        supabase.from('reservations').select('id, client_id, venue_id, service_id, status, slots, origin_ref'),
        supabase.from('availability_with_sfcom').select('id, venue_id, service_id, total_slots, sfcom_status, sfcom_product_id, sfcom_variation_id, sfcom_slots_listed, sfcom_service_name'),
        supabase.from('clients').select('id, name'),
        supabase.from('venues').select('id'),
        supabase.from('services').select('id'),
        supabase.from('reservation_requests').select('id, source, client_name, service_id, slots, level, day').eq('status', 'nueva')
    ])

    if (eRes || eAvail || eClients || eVenues || eServices || eSol) {
        resultado.errores.push('Error al leer datos de Supabase — verifica la conexión')
        resultado.ok = false
        return resultado
    }

    // ── Sets para lookup rápido ─────────────────────────────────────
    const clienteIds = new Set((clients   ?? []).map(c => c.id))
    const clientsMap = Object.fromEntries((clients ?? []).map(c => [c.id, c.name ?? c.id]))
    const venueIds   = new Set((venues    ?? []).map(v => v.id))
    const servicioIds = new Set((services ?? []).map(s => s.id))
    const availKeys  = new Set((availability ?? []).map(a => `${a.venue_id}|${a.service_id}`))

    // ── Coherencia de FK en reservas ────────────────────────────────
    for (const r of (reservas ?? [])) {
        if (!clienteIds.has(r.client_id))
            resultado.errores.push(`Reserva ${r.id}: cliente "${r.client_id}" no existe en la BD`)
        if (!venueIds.has(r.venue_id))
            resultado.errores.push(`Reserva ${r.id}: venue "${r.venue_id}" no existe en la BD`)
        if (!servicioIds.has(r.service_id))
            resultado.errores.push(`Reserva ${r.id}: servicio "${r.service_id}" no existe en la BD`)
        if (r.status !== 'Cancelada' && !availKeys.has(`${r.venue_id}|${r.service_id}`))
            resultado.errores.push(`Reserva ${r.id}: sin fila availability para ${r.venue_id} / ${r.service_id}`)
    }

    // ── Sobrereserva por par venue/servicio ─────────────────────────
    for (const avail of (availability ?? [])) {
        const plazasActivas = (reservas ?? [])
            .filter(r =>
                r.venue_id   === avail.venue_id &&
                r.service_id === avail.service_id &&
                r.status     !== 'Cancelada'
            )
            .reduce((sum, r) => sum + (r.slots ?? 0), 0)

        if (plazasActivas > avail.total_slots) {
            resultado.errores.push(
                `Sobrereserva: ${avail.venue_id} / ${avail.service_id} — ` +
                `${plazasActivas} plazas reservadas sobre ${avail.total_slots} plazas totales`
            )
        }
    }

    // ── Solicitudes pendientes (aviso, no error) ────────────────────
    const sfcomPend = (solicitudes ?? []).filter(s => s.source && /^WEB\d+_\d+$/.test(s.source))
    const webPend   = (solicitudes ?? []).filter(s => !s.source || !/^WEB\d+_\d+$/.test(s.source))

    if (sfcomPend.length > 0)
        resultado.avisos.push(`${sfcomPend.length} solicitud(es) de sfcom sin atender`)
    if (webPend.length > 0)
        resultado.avisos.push(`${webPend.length} solicitud(es) web sin atender`)

    // ── Servicios confirmados sin product_id ───────────────────────────────
    for (const avail of (availability ?? [])) {
        if (avail.sfcom_status === 'confirmed' && !avail.sfcom_product_id) {
            resultado.avisos.push(
                `${avail.venue_id} / ${avail.service_id}: marcado como "confirmed" en sfcom ` +
                `pero sin ID de producto — "${avail.sfcom_service_name ?? '—'}" puede no existir aún en sfcom`
            )
        }
    }

    // ── Verificación de stock en sfcom ──────────────────────────────
    const mappedAvails = (availability ?? []).filter(a =>
        a.sfcom_product_id && a.sfcom_slots_listed !== null && a.sfcom_service_name
    )

    if (mappedAvails.length === 0) {
        resultado.sfcom.verificado = true
    } else {
        // ── Un único GET stock-all para obtener todo el stock en una llamada ──
        // Sin límite de uso, no toca WooCommerce directamente.
        let stockMap = {}
        try {
            stockMap = await apiFetchStockAll()
            for (const avail of mappedAvails) {
                const lookupId = String(avail.sfcom_variation_id ?? avail.sfcom_product_id)
                if (lookupId in stockMap) _cacheSet(avail.sfcom_product_id, avail.sfcom_variation_id, stockMap[lookupId])
            }
        } catch (e) {
            for (const avail of mappedAvails) {
                resultado.sfcom.fallos.push({
                    servicio:  avail.sfcom_service_name ?? `${avail.venue_id}/${avail.service_id}`,
                    venueId:   avail.venue_id,
                    serviceId: avail.service_id,
                    error:     e.message
                })
            }
            resultado.sfcom.error      = e.message
            resultado.sfcom.verificado = false
        }

        // ── Check interno: variation_id duplicado por mismo producto ────────────
        // Dos servicios con el mismo sfcom_product_id no pueden compartir sfcom_variation_id.
        // Corre en todas las verificaciones (automática y manual).
        const _varPorProducto = new Map()   // product_id → Map<variation_id → {venue_id, service_id}>
        for (const avail of mappedAvails) {
            if (!avail.sfcom_variation_id) continue
            const pid = String(avail.sfcom_product_id)
            if (!_varPorProducto.has(pid)) _varPorProducto.set(pid, new Map())
            const varMap = _varPorProducto.get(pid)
            const vid    = String(avail.sfcom_variation_id)
            if (varMap.has(vid)) {
                const otro = varMap.get(vid)
                resultado.errores.push(
                    `ID de variación duplicado: variation_id ${avail.sfcom_variation_id} ` +
                    `asignado a ${avail.service_id} (${avail.venue_id}) ` +
                    `y también a ${otro.service_id} (${otro.venue_id})`
                )
            } else {
                varMap.set(vid, { venue_id: avail.venue_id, service_id: avail.service_id })
            }
        }

        const varNombreMap = new Map()   // siempre vacío: sf-api-paula.php no expone endpoints de variaciones

        // ── Procesar cada par ─────────────────────────────────────────────────
        for (const avail of mappedAvails) {
            const yaEnFallos = resultado.sfcom.fallos.some(
                f => f.venueId === avail.venue_id && f.serviceId === avail.service_id
            )
            if (yaEnFallos) continue

            const lookupId  = String(avail.sfcom_variation_id ?? avail.sfcom_product_id)
            const stockReal = lookupId in stockMap ? stockMap[lookupId] : undefined

            if (stockReal === undefined) {
                if (avail.sfcom_status === 'deactivation_pending') {
                    resultado.avisos.push(
                        `${avail.sfcom_service_name} (${avail.venue_id}): producto ya retirado de sfcom ` +
                        `— puedes confirmar la baja en proveedores.html`
                    )
                } else {
                    resultado.sfcom.fallos.push({
                        servicio:  avail.sfcom_service_name ?? `${avail.venue_id}/${avail.service_id}`,
                        venueId:   avail.venue_id,
                        serviceId: avail.service_id,
                        error:     'ID no encontrado en stock-all'
                    })
                }
                continue
            }

            const variacionNombre = avail.sfcom_variation_id ? (varNombreMap.get(avail.sfcom_variation_id) ?? null) : null

            // idsMismatch: solo si tenemos nombres de variación (checkVariationNames = true)
            if (avail.sfcom_variation_id && varNombreMap.size > 0) {
                const serviceDayMatch = /^ENCIERRO_(\d+)$/.exec(avail.service_id)
                const serviceDay      = serviceDayMatch ? parseInt(serviceDayMatch[1]) : null
                const varDay          = variacionNombre ? extraerDia(variacionNombre) : null
                if (serviceDay !== null && varDay !== null && serviceDay !== varDay) {
                    resultado.sfcom.idsMismatch.push({
                        servicio:          avail.sfcom_service_name,
                        variacionNombre,
                        dayStored:         varDay,
                        dayExpected:       serviceDay,
                        venueId:           avail.venue_id,
                        serviceId:         avail.service_id,
                        availId:           avail.id,
                        storedVariationId: avail.sfcom_variation_id,
                        storedProductId:   avail.sfcom_product_id
                    })
                    continue  // la comparación de stock sería engañosa; la saltamos
                }
            }

            if (stockReal === null) continue  // producto sin gestión de stock en sfcom

            const resParProp    = (reservas ?? []).filter(r =>
                r.venue_id   === avail.venue_id &&
                r.service_id === avail.service_id &&
                r.status     !== 'Cancelada'
            )
            const sfcomVendidas = resParProp.filter(r => r.origin_ref?.startsWith('WEB')).reduce((s, r) => s + (r.slots ?? 0), 0)
            const todasOcupadas = resParProp.reduce((s, r) => s + (r.slots ?? 0), 0)
            const stockEsperado = Math.max(0, Math.min(
                avail.sfcom_slots_listed - sfcomVendidas,
                avail.total_slots        - todasOcupadas
            ))

            if (stockReal !== stockEsperado) {
                const diferencia   = stockReal - stockEsperado
                const gap          = stockEsperado - stockReal

                const sfcomPendPar = diferencia < 0
                    ? (solicitudes ?? []).filter(s => {
                          if (!s.source || !/^WEB\d+_\d+$/.test(s.source)) return false
                          if (s.service_id === avail.service_id) return true
                          if (s.level && avail.sfcom_service_name) {
                              const levelMatch =
                                  s.level === avail.sfcom_service_name ||
                                  s.level.startsWith(avail.sfcom_service_name + ' ')
                              if (levelMatch) {
                                  const solDay = typeof s.day === 'number' ? s.day : null
                                  const m      = /^ENCIERRO_(\d+)$/.exec(avail.service_id)
                                  const svcDay = m ? parseInt(m[1]) : null
                                  if (svcDay === null) return true
                                  if (solDay !== null) return solDay === svcDay
                              }
                          }
                          return false
                      })
                    : []
                const pendingSlots    = sfcomPendPar.reduce((sum, s) => sum + (s.slots ?? 0), 0)
                const pendingExplains = diferencia < 0 && gap > 0 && pendingSlots >= gap

                resultado.sfcom.discrepancias.push({
                    servicio:           avail.sfcom_service_name,
                    variacionNombre,
                    venueId:            avail.venue_id,
                    serviceId:          avail.service_id,
                    sfcom_slots_listed: avail.sfcom_slots_listed,
                    total_slots:        avail.total_slots,
                    sfcomVendidas,
                    todasOcupadas,
                    stockSfcom:         stockReal,
                    stockEsperado,
                    diferencia,
                    reservasPar:        resParProp.map(r => ({
                        id:         r.id,
                        clientName: r.client_id,
                        slots:      r.slots ?? 0,
                        sfcomRef:   r.origin_ref?.startsWith('WEB') ? r.origin_ref : null
                    })),
                    pendingRequests: sfcomPendPar.map(s => ({
                        id:         s.id,
                        source:     s.source,
                        slots:      s.slots ?? 0,
                        clientName: s.client_name
                    })),
                    pendingExplains
                })
            }
        }

        resultado.sfcom.verificado = resultado.sfcom.fallos.length === 0
    }

    resultado.ok = resultado.errores.length === 0 && resultado.sfcom.idsMismatch.length === 0
    return resultado
}

// ────────────────────────────────────────────────────────────────────────────
// getSfcomProducts (interno)
// Construye la lista de productos/variaciones desde sfcom_listings en Supabase.
// sf-api-paula.php no expone GET products ni GET variations; usamos los datos
// que ya tenemos registrados como fuente de verdad local.
// ────────────────────────────────────────────────────────────────────────────

async function getSfcomProducts() {
    const { data, error } = await supabase
        .from('sfcom_listings')
        .select('sfcom_service_name, sfcom_product_id, sfcom_variation_id, availability!inner(service_id)')
        .not('sfcom_product_id', 'is', null)

    if (error) throw new Error(error.message)
    if (!data?.length) return []

    const seen      = new Set()
    const resultado = []
    for (const row of data) {
        const pid = row.sfcom_product_id
        const vid = row.sfcom_variation_id ?? null
        const key = `${pid}:${vid}`
        if (seen.has(key)) continue
        seen.add(key)

        const serviceId = row.availability?.service_id ?? ''
        const m         = /^ENCIERRO_(\d+)$/.exec(serviceId)
        const dayNum    = m ? parseInt(m[1]) : null

        resultado.push({
            name:         dayNum ? `${row.sfcom_service_name} — día ${dayNum} julio` : row.sfcom_service_name,
            product_name: row.sfcom_service_name,
            product_id:   pid,
            variation_id: vid
        })
    }
    return resultado
}

// ────────────────────────────────────────────────────────────────────────────
// verificarConfirmarSfcom (exportado)
// Busca el nombre propuesto en sfcom y confirma la fila de availability.
// Si no hay coincidencia exacta, muestra el modal picker para que el admin
// seleccione el nombre correcto de la lista de sfcom.
// ────────────────────────────────────────────────────────────────────────────

export async function verificarConfirmarSfcom(supabase, dispId, productName, serviceId, excludeNames = []) {
    let opciones
    try {
        opciones = await getSfcomProducts()
    } catch (e) {
        mostrarModalError({
            servicio:   productName,
            venueId: '—', serviceId: '—', endpoint: 'products',
            nuevoStock: 0,   putError: e.message
        })
        return { ok: false, error: e.message }
    }

    // Buscar por product_name (para productos simples y variable)
    // Para ENCIERRO: auto-seleccionar la variación que coincide con el día
    let match = _inferirProductoEnSfcom(opciones, productName, serviceId)

    if (!match) {
        // No hay coincidencia → mostrar picker
        match = await new Promise(resolve => {
            mostrarModalPickerNombre(productName, opciones, excludeNames, resolve)
        })
    }

    if (!match) return { ok: false, cancelled: true }

    // Si el resultado no tiene product_id, el nombre no está en la lista de sfcom
    if (!match.product_id) {
        if (match.name && match.name !== productName) {
            await supabase.from('sfcom_listings')
                .upsert({ availability_id: dispId, sfcom_service_name: match.name }, { onConflict: 'availability_id' })
        }
        return { ok: false, notInList: true, name: match.name ?? productName }
    }

    // Encontrado → confirmar con product_id y variation_id
    // Guardamos el product_name (no la variation name) en sfcom_service_name
    const nombreAGuardar = match.product_name ?? match.name
    const { error } = await supabase.from('sfcom_listings').upsert({
        availability_id:    dispId,
        sfcom_service_name: nombreAGuardar,
        sfcom_product_id:   match.product_id,
        sfcom_variation_id: match.variation_id ?? null,
        sfcom_status:       'confirmed'
    }, { onConflict: 'availability_id' })

    if (error) {
        console.error('[sfcom] Error al confirmar:', error.message)
        return { ok: false, error: error.message }
    }

    return {
        ok:           true,
        product_id:   match.product_id,
        variation_id: match.variation_id ?? null,
        name:         nombreAGuardar,
        sfcom_status: 'confirmed'
    }
}

function _inferirProductoEnSfcom(opciones, productName, serviceId) {
    if (!productName) return null
    const matchesProduct = opciones.filter(o =>
        o.product_name?.toLowerCase() === productName.toLowerCase()
    )
    if (matchesProduct.length === 0) return null
    if (matchesProduct.length === 1) return matchesProduct[0]
    // Múltiples variaciones: intentar auto-seleccionar por día
    const partes = (serviceId || '').split('_')
    if (partes[0] === 'ENCIERRO') {
        const dia = parseInt(partes[1])
        if (dia) {
            const byDay = matchesProduct.find(v => v.name.includes(String(dia)))
            if (byDay) return byDay
        }
    }
    return matchesProduct[0]
}

// ────────────────────────────────────────────────────────────────────────────
// editarNombreSfcom (exportado)
// Abre el picker con la lista de productos/variaciones de sfcom para cambiar
// el nombre de servicio de una fila confirmed. No actualiza Supabase — el
// llamador decide qué hacer con el nombre devuelto.
// ────────────────────────────────────────────────────────────────────────────

export async function editarNombreSfcom(nombreActual, serviceId, excludeNames = []) {
    let opciones
    try {
        opciones = await getSfcomProducts()
    } catch (e) {
        alert(`No se pudo conectar con sfcom para cargar los productos.\n${e.message}`)
        return null
    }

    return new Promise(resolve => {
        mostrarModalPickerNombre(nombreActual, opciones, excludeNames, resolve)
    })
}

// ────────────────────────────────────────────────────────────────────────────
// mostrarModalPickerNombre (interno)
// Modal con autocomplete sobre la lista de productos/variaciones de sfcom.
// Si el usuario escribe un nombre que no existe en la lista, muestra aviso
// pero permite confirmarlo igualmente (Hilario puede haberlo creado después).
// callback recibe el objeto {name, product_id, variation_id} o null si cancela.
// ────────────────────────────────────────────────────────────────────────────

function mostrarModalPickerNombre(nombreActual, opciones, excludeNames, callback) {
    const { overlay, panel } = crearModal('sfcom-modal-picker')
    overlay.style.zIndex = '10001'

    panel.innerHTML = `
        <div>
            <div class="modal-header-title">Seleccionar producto en sfcom</div>
            <div class="modal-header-desc" style="margin-top:6px">Escoge el producto de WooCommerce que corresponde a este servicio. Para servicios de encierro con variaciones, la variación del día se selecciona automáticamente.</div>
        </div>
        <div style="position:relative">
            <input id="sfcom-picker-input" type="text"
                value="${nombreActual ?? ''}"
                placeholder="Escribe o selecciona…"
                autocomplete="off"
                style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box">
            <div id="sfcom-picker-lista" style="position:absolute;left:0;right:0;top:100%;z-index:10;
                 background:#fff;border:1px solid #d1d5db;border-top:none;border-radius:0 0 6px 6px;
                 max-height:220px;overflow-y:auto;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
            </div>
        </div>
        <div id="sfcom-picker-aviso" style="display:none;font-size:12px;color:#92400e;background:#fef3c7;border-radius:6px;padding:8px 12px">
            ⚠️ Este nombre no existe en la lista actual de sfcom. Puedes guardarlo de todas formas si Hilario ya lo ha creado o lo va a crear con exactamente ese nombre.
        </div>
        <div class="modal-actions">
            <button id="sfcom-picker-cancelar" class="btn btn-secondary">Cancelar</button>
            <button id="sfcom-picker-confirmar" class="btn btn-primary">Confirmar</button>
        </div>`

    const input    = panel.querySelector('#sfcom-picker-input')
    const lista    = panel.querySelector('#sfcom-picker-lista')
    const aviso    = panel.querySelector('#sfcom-picker-aviso')
    const btnConf  = panel.querySelector('#sfcom-picker-confirmar')
    const btnCanc  = panel.querySelector('#sfcom-picker-cancelar')

    const opcionesFiltradas = opciones.filter(o => !excludeNames.includes(o.product_name))

    // Deduplicar por product_name para mostrar productos, no variaciones individuales
    const productosUnicos = []
    const nombresVistos   = new Set()
    for (const o of opcionesFiltradas) {
        const nombre = o.product_name || o.name
        if (!nombresVistos.has(nombre)) { nombresVistos.add(nombre); productosUnicos.push(o) }
    }

    function renderLista(filtro) {
        const texto = filtro.trim().toLowerCase()
        const items = texto
            ? productosUnicos.filter(o => (o.product_name || o.name).toLowerCase().includes(texto))
            : productosUnicos
        lista.innerHTML = items.slice(0, 40).map(o => {
            const prodName = o.product_name || o.name
            const varCount = opcionesFiltradas.filter(x => (x.product_name || x.name) === prodName).length
            return `
            <div data-product-name="${prodName}"
                 style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid #f3f4f6;
                        line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                 title="${prodName}">
                <span style="color:#111">${prodName}</span>
                <span style="color:#9ca3af;margin-left:6px">${varCount > 1 ? `· ${varCount} variaciones` : ''}</span>
            </div>`
        }).join('')
        lista.style.display = items.length > 0 ? 'block' : 'none'
    }

    function checkAviso() {
        const val     = input.value.trim()
        const enLista = productosUnicos.some(o => (o.product_name || o.name) === val)
        aviso.style.display = val && !enLista ? 'block' : 'none'
    }

    input.addEventListener('input', () => { renderLista(input.value); checkAviso() })
    input.addEventListener('focus', () => renderLista(input.value))

    lista.addEventListener('click', e => {
        const div = e.target.closest('[data-product-name]')
        if (!div) return
        input.value = div.dataset.productName
        lista.style.display = 'none'
        checkAviso()
    })

    document.addEventListener('click', function outsideClick(e) {
        if (!overlay.contains(e.target)) return
        if (!e.target.closest('#sfcom-picker-input') && !lista.contains(e.target)) {
            lista.style.display = 'none'
        }
    })

    checkAviso()

    btnConf.addEventListener('click', () => {
        const val = input.value.trim()
        if (!val) return
        // Buscar por product_name (el picker ahora muestra productos, no variaciones)
        const enLista = productosUnicos.find(o => (o.product_name || o.name) === val)
        overlay.remove()
        // Devuelve {product_name, product_id, variation_id} si está en lista, o {name, product_id: null} si no
        callback(enLista
            ? { name: enLista.product_name || enLista.name, product_name: enLista.product_name || enLista.name, product_id: enLista.product_id, variation_id: enLista.variation_id }
            : { name: val, product_id: null, variation_id: null }
        )
    })

    btnCanc.addEventListener('click', () => { overlay.remove(); callback(null) })

    input.focus()
    input.select()
    renderLista(input.value)
}

// ────────────────────────────────────────────────────────────────────────────
// mostrarModalCorreoHilario (exportado)
// Modal con el texto del correo a enviar a Hilario para solicitar el alta
// de uno o más servicios en sfcom.
// variaciones: [{serviceId, nombre, plazas, precio}]
// proveedor: {id, name, address}
// ────────────────────────────────────────────────────────────────────────────

export function mostrarModalCorreoCancelacionSfcom(nombreProducto, proveedor) {
    const subject = `Cancelar alta en sfcom — ${nombreProducto}`
    const cuerpoCorreo = [
        `Hola Hilario,`,
        ``,
        `Hemos decidido no proceder con el alta en sfcom del siguiente balcón:`,
        ``,
        `Producto: ${nombreProducto}`,
        `Proveedor: ${proveedor?.name ?? proveedor?.id ?? '—'}${proveedor?.address ? ' — ' + proveedor.address : ''}`,
        ``,
        `Si ya has empezado a configurarlo, puedes dejarlo en borrador o eliminarlo según corresponda.`,
        ``,
        `Muchas gracias,`,
        `Paula`
    ].join('\n')

    const { overlay, panel } = crearModal('sfcom-modal-correo-cancelacion', { wide: true, scroll: true })

    panel.innerHTML = `
        <div>
            <div class="modal-header-title">Correo para Hilario — cancelación de solicitud sfcom</div>
            <div class="modal-header-desc" style="margin-top:4px">Copia el texto o ábrelo directamente en tu cliente de correo.</div>
        </div>
        <div class="modal-email-block">
            <textarea id="sfcom-correo-cancel-texto" class="modal-email-textarea" style="height:180px" readonly>${cuerpoCorreo}</textarea>
        </div>
        <div class="modal-actions">
            <button id="sfcom-cancel-copiar" class="btn btn-secondary">📋 Copiar texto</button>
            <a class="btn btn-primary" style="text-decoration:none"
                href="mailto:hilario@goviwebs.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(cuerpoCorreo)}">
                ✉️ Abrir en correo
            </a>
            <button id="sfcom-cancel-cerrar" class="btn btn-secondary">Cerrar</button>
        </div>`

    panel.querySelector('#sfcom-cancel-copiar').addEventListener('click', () => {
        const ta  = panel.querySelector('#sfcom-correo-cancel-texto')
        const btn = panel.querySelector('#sfcom-cancel-copiar')
        ta.select(); document.execCommand('copy')
        btn.textContent = '✅ Copiado'
        setTimeout(() => { btn.textContent = '📋 Copiar texto' }, 2000)
    })
    panel.querySelector('#sfcom-cancel-cerrar').addEventListener('click', () => overlay.remove())
}

// ────────────────────────────────────────────────────────────────────────────
// verificarBajaSfcom (exportado)
// Comprueba via GET si un producto en sfcom ya no está disponible (stock 0 o 404).
// Se usa en el flujo de baja antes de limpiar los datos en Supabase.
// Devuelve { ok, gone, stock? } — gone=true si el producto ya no tiene stock activo.
// ────────────────────────────────────────────────────────────────────────────

export async function verificarBajaSfcom(productId, variationId) {
    if (!productId) return { ok: false, error: 'Sin product_id' }
    try {
        const stockMap = await apiFetchStockAll()
        const lookupId = String(variationId ?? productId)
        const stock    = lookupId in stockMap ? stockMap[lookupId] : null
        if (stock === 0 || stock === null) return { ok: true, gone: true, stock }
        return { ok: true, gone: false, stock }
    } catch (e) {
        return { ok: false, error: e.message }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// mostrarModalCorreoBajaSfcom (exportado)
// Modal con el correo a enviar a Hilario para solicitar la baja de un servicio
// en sfcom. Simétrico a mostrarModalCorreoHilario pero para el flujo de baja.
// Devuelve Promise<'ok'|'cancel'>.
// ────────────────────────────────────────────────────────────────────────────

export function mostrarModalCorreoBajaSfcom(nombreProducto, proveedor) {
    return new Promise(resolve => {
        const existente = document.getElementById('sfcom-modal-correo-baja')
        if (existente) existente.remove()

        const subject = `Baja en sfcom — ${nombreProducto}`
        const cuerpoCorreo = [
            `Hola Hilario,`,
            ``,
            `Necesitamos dar de baja en la tienda sfcom el siguiente balcón:`,
            ``,
            `Producto: ${nombreProducto}`,
            `Proveedor: ${proveedor?.name ?? proveedor?.id ?? '—'}${proveedor?.address ? ' — ' + proveedor.address : ''}`,
            ``,
            `Por favor, retira el producto de la venta (puedes dejarlo en borrador o eliminarlo).`,
            `Cuando lo hayas hecho, nos lo confirmas para que podamos actualizar nuestro sistema.`,
            ``,
            `Muchas gracias,`,
            `Paula`
        ].join('\n')

        const { overlay, panel } = crearModal('sfcom-modal-correo-baja', { wide: true, scroll: true })

        panel.innerHTML = `
            <div>
                <div class="modal-header-title">Correo para Hilario — solicitar baja en sfcom</div>
                <div class="modal-header-desc" style="margin-top:4px">Envía este correo a Hilario para que retire el producto de la venta.</div>
            </div>
            <div class="modal-email-block">
                <textarea id="sfcom-correo-baja-texto" class="modal-email-textarea" readonly>${cuerpoCorreo}</textarea>
            </div>
            <div class="modal-actions">
                <button id="sfcom-baja-copiar" class="btn btn-secondary">📋 Copiar texto</button>
                <a class="btn btn-primary" style="text-decoration:none"
                    href="mailto:hilario@goviwebs.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(cuerpoCorreo)}">
                    ✉️ Abrir en correo
                </a>
                <button id="sfcom-baja-cancelar" class="btn btn-secondary">Cancelar</button>
                <button id="sfcom-baja-ok" class="btn btn-danger">Correo enviado — solicitar baja</button>
            </div>`

        panel.querySelector('#sfcom-baja-copiar').addEventListener('click', () => {
            const ta  = panel.querySelector('#sfcom-correo-baja-texto')
            const btn = panel.querySelector('#sfcom-baja-copiar')
            ta.select(); document.execCommand('copy')
            btn.textContent = '✅ Copiado'
            setTimeout(() => { btn.textContent = '📋 Copiar texto' }, 2000)
        })
        panel.querySelector('#sfcom-baja-cancelar').addEventListener('click', () => { overlay.remove(); resolve('cancel') })
        panel.querySelector('#sfcom-baja-ok').addEventListener('click',       () => { overlay.remove(); resolve('ok')     })
    })
}

export function mostrarModalCorreoHilario(nombreProducto, variaciones, proveedor, opciones = {}) {
    return new Promise(resolve => {
    const existente = document.getElementById('sfcom-modal-correo-hilario')
    if (existente) existente.remove()

    // Soporta tanto {nombre, plazas, precio} (legacy) como {nombreProducto, nombreVariacion, plazas, precio}
    const lineasVariaciones = variaciones.map(v => {
        const varNombre = v.nombreVariacion || v.nombre || v.serviceId || ''
        const prodNombre = v.nombreProducto || nombreProducto
        const linea = `- ${prodNombre}${varNombre ? ` / ${varNombre}` : ''}`
            + (v.plazas ? ` (${v.plazas} plazas)` : '')
            + (v.precio ? ` — ${v.precio} €` : '')
        return linea
    }).join('\n')

    const subject = `Alta en sfcom — ${nombreProducto}`
    const cuerpoCorreo = [
        `Hola Hilario,`,
        ``,
        `Necesito que des de alta un nuevo balcón en la tienda de sfcom con las siguientes variaciones:`,
        ``,
        `Producto: ${nombreProducto}`,
        `Proveedor: ${proveedor.name ?? proveedor.id}${proveedor.address ? ' — ' + proveedor.address : ''}`,
        ``,
        `Variaciones:`,
        lineasVariaciones,
        ``,
        `Para cada variación, necesito:`,
        `- Nombre exacto de la variación (como lo pondremos nosotros para identificar los pedidos)`,
        `- ID del producto y ID de la variación en WooCommerce (para sincronizar el stock automáticamente)`,
        ``,
        `Muchas gracias,`,
        `Paula`
    ].join('\n')

    const { overlay, panel } = crearModal('sfcom-modal-correo-hilario', { wide: true, scroll: true })

    panel.innerHTML = `
        <div>
            <div class="modal-header-title">Correo para Hilario — solicitud de alta en sfcom</div>
            <div class="modal-header-desc" style="margin-top:4px">Copia el texto o ábrelo directamente en tu cliente de correo.</div>
        </div>
        <div class="modal-email-block">
            <textarea id="sfcom-correo-texto" class="modal-email-textarea" style="height:240px" readonly>${cuerpoCorreo}</textarea>
        </div>
        <div class="modal-actions">
            <button id="sfcom-correo-copiar" class="btn btn-secondary">📋 Copiar texto</button>
            <a class="btn btn-primary" style="text-decoration:none"
                href="mailto:hilario@goviwebs.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(cuerpoCorreo)}">
                ✉️ Abrir en correo
            </a>
            ${opciones.withOkCancel
                ? `<button id="sfcom-correo-cancelar" class="btn btn-secondary">Cancelar</button>
                   <button id="sfcom-correo-ok" class="btn btn-primary">OK</button>`
                : `<button id="sfcom-correo-cerrar" class="btn btn-secondary">Cerrar</button>`}
        </div>`

    panel.querySelector('#sfcom-correo-copiar').addEventListener('click', () => {
        const ta  = panel.querySelector('#sfcom-correo-texto')
        const btn = panel.querySelector('#sfcom-correo-copiar')
        ta.select(); document.execCommand('copy')
        btn.textContent = '✅ Copiado'
        setTimeout(() => { btn.textContent = '📋 Copiar texto' }, 2000)
    })

    if (opciones.withOkCancel) {
        panel.querySelector('#sfcom-correo-cancelar').addEventListener('click', () => { overlay.remove(); resolve('cancel') })
        panel.querySelector('#sfcom-correo-ok').addEventListener('click',       () => { overlay.remove(); resolve('ok')     })
    } else {
        panel.querySelector('#sfcom-correo-cerrar').addEventListener('click',   () => { overlay.remove(); resolve('closed') })
    }
    }) // end Promise
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers compartidos para importar cancelados sfcom desde cualquier página
// ────────────────────────────────────────────────────────────────────────────

export async function loadSfcomListings(supabase) {
    const { data } = await supabase.from('sfcom_listings')
        .select('availability_id, sfcom_service_name, sfcom_product_id, sfcom_variation_id, availability!inner(venue_id, service_id)')
    return (data ?? []).map(r => ({
        id:                 r.availability_id,
        sfcom_service_name: r.sfcom_service_name,
        sfcom_product_id:   r.sfcom_product_id,
        sfcom_variation_id: r.sfcom_variation_id,
        venue_id:           r.availability?.venue_id,
        service_id:         r.availability?.service_id
    })).filter(r => r.venue_id)
}

// Registra pedidos cancelados de sfcom como leads cancelada_sfcom.
// Matching silencioso (sin modales), dedup por cliente+servicio.
export async function importarCanceladosSfcom(supabase, sfcomListings, cancelados) {
    if (!cancelados?.length) return

    const { data: existentes } = await supabase
        .from('reservation_requests')
        .select('source')
        .not('source', 'is', null)
    const sourcesRegistrados = new Set((existentes ?? []).map(r => r.source))

    const pedidos = cancelados.filter(p => !sourcesRegistrados.has(p.origin_ref))
    if (!pedidos.length) return

    const nombresConocidos = [...new Set(sfcomListings.map(d => d.sfcom_service_name).filter(Boolean))]

    for (const pedido of pedidos) {
        const li = pedido.productos?.[0]

        let serviceId   = null
        let venueId     = null
        let levelToSave = li?.nombre ?? null

        if (li) {
            const nombreExtraido = extraerNombreProducto(li.nombre, nombresConocidos)
            let filaByName = null
            if (nombreExtraido) {
                const candidatos = sfcomListings.filter(d => d.sfcom_service_name === nombreExtraido)
                if (candidatos.length === 1) {
                    filaByName = candidatos[0]
                } else if (candidatos.length > 1) {
                    const diaExtraid = extraerDia(li.nombre)
                    filaByName = diaExtraid !== null
                        ? (candidatos.find(c => { const m = /^ENCIERRO_(\d+)$/.exec(c.service_id); return m ? parseInt(m[1]) === diaExtraid : false }) ?? candidatos[0])
                        : candidatos[0]
                }
            }
            const filaById = sfcomListings.find(d =>
                d.sfcom_product_id == li.product_id &&
                (li.variation_id ? d.sfcom_variation_id == li.variation_id : !d.sfcom_variation_id)
            )
            const filaResolved = filaByName ?? filaById ?? null
            if (filaResolved) {
                serviceId = filaResolved.service_id
                venueId   = filaResolved.venue_id ?? null
            }
            levelToSave = nombreExtraido || li.nombre || null
        }

        if (serviceId) {
            const { data: existsCheck } = await supabase
                .from('reservation_requests')
                .select('client_email, client_phone, client_name')
                .eq('service_id', serviceId)
                .eq('status', 'cancelada_sfcom')
            const email  = (pedido.cliente.email   || '').toLowerCase()
            const phone  = pedido.cliente.telefono || ''
            const nombre = pedido.cliente.nombre   || ''
            const esDupe = (existsCheck ?? []).some(r =>
                (email  && r.client_email?.toLowerCase() === email)  ||
                (phone  && r.client_phone               === phone)   ||
                (nombre && r.client_name                === nombre)
            )
            if (esDupe) {
                console.log(`[sfcom_c] Dedup: ${pedido.origin_ref} omitido (mismo cliente + servicio ${serviceId})`)
                continue
            }
        }

        const totalBruto      = parseFloat(pedido.total ?? 0)
        const slots           = li?.cantidad ?? 1
        const precioSlotBruto = slots > 0 ? totalBruto / slots : totalBruto
        const hoy = new Date()
        const dd  = String(hoy.getDate()).padStart(2, '0')
        const mm  = String(hoy.getMonth() + 1).padStart(2, '0')
        const yy  = String(hoy.getFullYear()).slice(-2)
        const detalleProd = [
            levelToSave         && `Producto: ${levelToSave}`,
                                   `Personas: ${slots}`,
            precioSlotBruto > 0 && `Precio: ${Math.round(precioSlotBruto)}€/p`
        ].filter(Boolean).join(' · ')

        const dia = li ? extraerDia(li.nombre) : null
        const proposal_draft = (serviceId || venueId) ? [{
            service_id: serviceId,
            venue_id:   venueId,
            day:        dia,
            slots:      slots || null,
            price:      precioSlotBruto || null
        }] : null

        const { error } = await supabase.from('reservation_requests').insert({
            client_name:        pedido.cliente.nombre    || 'Sin nombre',
            client_email:       pedido.cliente.email     || null,
            client_phone:       pedido.cliente.telefono  || null,
            client_address:     pedido.cliente.direccion || null,
            slots,
            day:                dia,
            level:              levelToSave,
            service_id:         serviceId,
            price_per_slot:     precioSlotBruto,
            proposal_draft,
            created_at:         pedido.fecha || undefined,
            conversation_notes: `---${dd}/${mm}/${yy}---\n<Cliente>\n[Sfcom cancelado] ${detalleProd}`,
            source:             pedido.origin_ref,
            status:             'cancelada_sfcom'
        })
        if (error) console.error('[sfcom_c] Error registrando:', error.message, pedido.origin_ref)
    }
}
