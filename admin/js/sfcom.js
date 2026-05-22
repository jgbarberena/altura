// sfcom.js
// Comunicación bidireccional con tienda.sanfermin.com via sf-api-paula.php
// Flujo A (lectura):  sfcom → detectar pedidos nuevos → avisar al panel
// Flujo B (escritura): reserva guardada en Supabase → actualizar stock en sfcom

const API_URL = 'https://tienda.sanfermin.com/sf-api-paula.php'
const API_KEY = 'pK9#mX2$vL7@nQ4&wR8!hT3%yU6^zA1*'

// ─── Utilidad interna: llamada a la API ──────────────────────────────────────

async function apiFetch(endpoint, method = 'GET', body = null) {
    const url = `${API_URL}?endpoint=${encodeURIComponent(endpoint)}`
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-Paula-Key':  API_KEY
        }
    }
    if (body) opts.body = JSON.stringify(body)

    const res = await fetch(url, opts)
    if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`)
    }
    return res.json()
}

// ─── Utilidad interna: construir endpoint de stock ───────────────────────────
// Si tiene variation_id → products/{product_id}/variations/{variation_id}
// Si no               → products/{product_id}

function buildStockEndpoint(productId, variationId) {
    if (variationId) return `products/${productId}/variations/${variationId}`
    return `products/${productId}`
}

// ────────────────────────────────────────────────────────────────────────────
// FLUJO B: syncStockToSfcom
// Llama tras guardar, editar o cancelar cualquier reserva en Supabase.
// Lee la fila de availability, cuenta reservas no canceladas, y hace el PUT.
// Si el PUT falla, muestra modal con correo listo para enviar a Hilario.
// ────────────────────────────────────────────────────────────────────────────

export async function syncStockToSfcom(supabase, providerId, serviceId) {
    // 1. Leer fila de availability
    const { data: avail, error: errAvail } = await supabase
        .from('availability')
        .select('sfcom_service_name, sfcom_slots_listed, sfcom_product_id, sfcom_variation_id')
        .eq('provider_id', providerId)
        .eq('service_id', serviceId)
        .single()

    if (errAvail || !avail) {
        console.warn(`[sfcom] No se encontró availability para ${providerId} + ${serviceId}`)
        return { ok: true, skipped: true, reason: 'no_availability_row' }
    }

    // 2. Si no está mapeado en sfcom, no hacer nada
    if (!avail.sfcom_service_name || avail.sfcom_slots_listed === null || !avail.sfcom_product_id) {
        return { ok: true, skipped: true, reason: 'not_mapped' }
    }

    // 3. Contar reservas no canceladas
    const { count, error: errCount } = await supabase
        .from('reservations')
        .select('*', { count: 'exact', head: true })
        .eq('provider_id', providerId)
        .eq('service_id', serviceId)
        .neq('status', 'Cancelada')

    if (errCount) {
        console.error(`[sfcom] Error al contar reservas: ${errCount.message}`)
        return { ok: false, error: errCount.message }
    }

    // 4. Calcular nuevo stock y hacer el PUT
    const reservasActivas = count ?? 0
    const nuevoStock      = Math.max(0, avail.sfcom_slots_listed - reservasActivas)
    const endpoint        = buildStockEndpoint(avail.sfcom_product_id, avail.sfcom_variation_id)

    try {
        await apiFetch(endpoint, 'PUT', { stock_quantity: nuevoStock })
        console.info(`[sfcom] Stock actualizado: ${avail.sfcom_service_name} → ${nuevoStock} plazas (${reservasActivas} reservadas de ${avail.sfcom_slots_listed} listadas)`)
        mostrarModalExito({ servicio: avail.sfcom_service_name, nuevoStock })
        return { ok: true, nuevoStock, reservasActivas }
    } catch (e) {
        console.error(`[sfcom] PUT fallido para ${avail.sfcom_service_name}: ${e.message}`)
        mostrarModalError({
            servicio:   avail.sfcom_service_name,
            providerId,
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
// registrados en reservations (por sfcom_order_ref).
// Se llama al cargar el panel y antes de guardar una reserva.
//
// Nota: el endpoint «orders» no está documentado en sf-api-paula.php (la
// documentación de Hilario cubre solo products y variations). Si la API no
// lo soporta, el GET fallará y se mostrará el modal de aviso. Confirmar con
// Hilario si este endpoint está disponible antes de asumir que el flujo A
// funciona.
// ────────────────────────────────────────────────────────────────────────────

export async function checkSfcomOrders(supabase, diasAtras = 90) {
    let sfcomOrders
    try {
        const after = new Date()
        after.setDate(after.getDate() - diasAtras)
        sfcomOrders = await apiFetch(`orders?status=completed&after=${encodeURIComponent(after.toISOString())}&per_page=100`)
    } catch (e) {
        console.warn(`[sfcom] checkSfcomOrders: GET fallido. ${e.message}`)
        mostrarModalAvisoOrders()
        return { ok: false, error: e.message, nuevos: [] }
    }

    if (!sfcomOrders?.length) return { ok: true, nuevos: [] }

    const { data: reservasConRef } = await supabase
        .from('reservations')
        .select('sfcom_order_ref')
        .not('sfcom_order_ref', 'is', null)

    const refsRegistradas = new Set((reservasConRef ?? []).map(r => r.sfcom_order_ref))

    const nuevos = sfcomOrders
        .filter(order => !refsRegistradas.has(`${order.number}_${order.id}`))
        .map(order => ({
            sfcom_order_ref: `${order.number}_${order.id}`,
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
                parent_name:  (li.parent_name ?? '').replace(/<[^>]*>/g, '').trim(),
                product_id:   li.product_id,
                variation_id: li.variation_id || null,
                cantidad:     li.quantity,
                precio:       li.total
            }))
        }))

    return { ok: true, nuevos }
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

export async function checkAvailabilityBeforeSave(supabase, providerId, serviceId, plazasSolicitadas) {
    const { data: avail } = await supabase
        .from('availability')
        .select('sfcom_service_name, sfcom_slots_listed, sfcom_product_id, sfcom_variation_id')
        .eq('provider_id', providerId)
        .eq('service_id', serviceId)
        .single()

    if (!avail?.sfcom_service_name || !avail?.sfcom_product_id) {
        return { ok: true, sfcomCheck: false }
    }

    let stockSfcom
    try {
        const endpoint = buildStockEndpoint(avail.sfcom_product_id, avail.sfcom_variation_id)
        const item     = await apiFetch(endpoint)
        stockSfcom     = item.stock_quantity ?? null
    } catch (e) {
        console.warn(`[sfcom] checkAvailabilityBeforeSave: GET fallido. No se verifica disponibilidad sfcom. ${e.message}`)
        return { ok: true, sfcomCheck: false, warning: e.message }
    }

    if (stockSfcom === null) return { ok: true, sfcomCheck: false }

    // Bloqueo duro: sfcom no tiene plazas suficientes para esta reserva.
    // Indica que hay pedidos externos pendientes de procesar que consumen esas plazas.
    if (stockSfcom < plazasSolicitadas) {
        return {
            ok: false,
            sfcomCheck: true,
            stockSfcom,
            message: `sfcom muestra solo ${stockSfcom} plaza(s) disponibles para "${avail.sfcom_service_name}", insuficientes para esta reserva de ${plazasSolicitadas} plaza(s). Es posible que haya pedidos en sfcom pendientes de procesar.`
        }
    }

    // Aviso suave: sfcom tiene menos plazas de las que esperamos según nuestro sistema,
    // pero suficientes para esta reserva. Puede haber pedidos externos sin procesar.
    const { count } = await supabase
        .from('reservations')
        .select('*', { count: 'exact', head: true })
        .eq('provider_id', providerId)
        .eq('service_id', serviceId)
        .neq('status', 'Cancelada')

    const reservasActivas = count ?? 0
    const stockEsperado   = Math.max(0, avail.sfcom_slots_listed - reservasActivas)

    if (stockSfcom < stockEsperado) {
        return {
            ok: true,
            sfcomCheck: true,
            stockSfcom,
            stockEsperado,
            warning: `sfcom muestra ${stockSfcom} plaza(s) disponibles para "${avail.sfcom_service_name}" pero el sistema espera ${stockEsperado}. Puede haber pedidos en sfcom pendientes de procesar. Hay plazas suficientes para esta reserva, pero verifica el panel de sfcom antes de confirmar.`
        }
    }

    return { ok: true, sfcomCheck: true, stockSfcom }
}

// ────────────────────────────────────────────────────────────────────────────
// mostrarModalError (interno)
// Modal de error con información técnica y texto del correo para Hilario.
// Se dispara cuando falla el PUT de stock.
// El modal no se cierra solo — Paula debe pulsar "Cerrar" explícitamente.
// ────────────────────────────────────────────────────────────────────────────

function mostrarModalError({ servicio, providerId, serviceId, endpoint, nuevoStock, putError }) {
    const existente = document.getElementById('sfcom-modal-error')
    if (existente) existente.remove()

    const endpointCompleto = `${API_URL}?endpoint=${encodeURIComponent(endpoint)}`
    const subject          = `Disponibilidad "${servicio}" — revisión pendiente`

    const cuerpoCorreo = [
        `Hola Hilario,`,
        ``,
        `Ha habido un problema al sincronizar la disponibilidad de uno de los balcones desde nuestro sistema.`,
        ``,
        `Al registrar una reserva para "${servicio}" (${providerId} / ${serviceId}), el sistema intentó actualizar automáticamente el stock:`,
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

    const overlay = document.createElement('div')
    overlay.id = 'sfcom-modal-error'
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.55)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'z-index:10000', 'padding:16px'
    ].join(';')

    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:28px;max-width:640px;width:100%;
                    box-shadow:0 8px 40px rgba(0,0,0,0.25);font-family:system-ui,sans-serif;
                    max-height:90vh;display:flex;flex-direction:column;gap:18px">

            <div style="display:flex;align-items:flex-start;gap:12px">
                <span style="font-size:22px;line-height:1">⚠️</span>
                <div>
                    <div style="font-size:15px;font-weight:600;color:#991b1b;margin-bottom:4px">
                        No se pudo actualizar la disponibilidad en sfcom
                    </div>
                    <div style="font-size:13px;color:#555;line-height:1.5">
                        La reserva se ha guardado correctamente en tu sistema, pero ha habido un
                        problema al actualizar el stock en sfcom. Revísalo manualmente o contacta
                        con Hilario.
                    </div>
                </div>
            </div>

            <div style="background:#f3f4f6;border-radius:8px;padding:12px;font-size:12px;
                        font-family:monospace;color:#374151;line-height:1.7">
                <div><strong>Servicio:</strong> ${servicio}</div>
                <div><strong>Endpoint:</strong> ${endpointCompleto}</div>
                <div><strong>Nuevo stock:</strong> ${nuevoStock} plaza(s)</div>
                <div><strong>Error:</strong> ${putError}</div>
            </div>

            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
                <div style="font-size:11px;color:#6b7280;margin-bottom:8px;text-transform:uppercase;
                            letter-spacing:.06em;font-weight:500">
                    Texto del correo para Hilario
                </div>
                <textarea id="sfcom-email-texto"
                    style="width:100%;height:200px;font-size:12px;font-family:monospace;
                           border:none;background:transparent;resize:vertical;color:#1f2937;
                           outline:none;line-height:1.65;box-sizing:border-box"
                    readonly>${cuerpoCorreo}</textarea>
            </div>

            <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
                <button id="sfcom-btn-copiar"
                    style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;
                           padding:8px 16px;font-size:13px;cursor:pointer;color:#374151;
                           white-space:nowrap">
                    📋 Copiar texto
                </button>
                <a id="sfcom-btn-mailto"
                    href="mailto:hilario@goviwebs.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(cuerpoCorreo)}"
                    style="background:#1d4ed8;color:#fff;border-radius:6px;padding:8px 16px;
                           font-size:13px;text-decoration:none;display:inline-flex;
                           align-items:center;gap:6px;white-space:nowrap">
                    ✉️ Abrir en correo
                </a>
                <button id="sfcom-btn-cerrar"
                    style="background:transparent;border:1px solid #d1d5db;border-radius:6px;
                           padding:8px 16px;font-size:13px;cursor:pointer;color:#6b7280;
                           white-space:nowrap">
                    Cerrar
                </button>
            </div>
        </div>`

    document.body.appendChild(overlay)

    document.getElementById('sfcom-btn-copiar').addEventListener('click', () => {
        const ta  = document.getElementById('sfcom-email-texto')
        const btn = document.getElementById('sfcom-btn-copiar')
        ta.select()
        document.execCommand('copy')
        btn.textContent = '✅ Copiado'
        setTimeout(() => { btn.textContent = '📋 Copiar texto' }, 2000)
    })

    document.getElementById('sfcom-btn-cerrar').addEventListener('click', () => overlay.remove())
}

// ────────────────────────────────────────────────────────────────────────────
// mostrarModalExito (interno)
// Confirmación visual cuando el PUT de stock se completa correctamente.
// ────────────────────────────────────────────────────────────────────────────

function mostrarModalExito({ servicio, nuevoStock }) {
    const existente = document.getElementById('sfcom-modal-exito')
    if (existente) existente.remove()

    const overlay = document.createElement('div')
    overlay.id = 'sfcom-modal-exito'
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.55)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'z-index:10000', 'padding:16px'
    ].join(';')

    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:28px;max-width:480px;width:100%;
                    box-shadow:0 8px 40px rgba(0,0,0,0.25);font-family:system-ui,sans-serif;
                    display:flex;flex-direction:column;gap:18px">

            <div style="display:flex;align-items:flex-start;gap:12px">
                <span style="font-size:22px;line-height:1">✅</span>
                <div>
                    <div style="font-size:15px;font-weight:600;color:#166534;margin-bottom:4px">
                        Disponibilidad actualizada en sfcom
                    </div>
                    <div style="font-size:13px;color:#555;line-height:1.5">
                        El stock de "${servicio}" se ha actualizado correctamente
                        a ${nuevoStock} plaza(s) disponibles.
                    </div>
                </div>
            </div>

            <div style="display:flex;justify-content:flex-end">
                <button id="sfcom-btn-exito-aceptar"
                    style="background:#166534;color:#fff;border:none;border-radius:6px;
                           padding:8px 20px;font-size:13px;cursor:pointer;white-space:nowrap">
                    Aceptar
                </button>
            </div>
        </div>`

    document.body.appendChild(overlay)
    document.getElementById('sfcom-btn-exito-aceptar').addEventListener('click', () => overlay.remove())
}

// ────────────────────────────────────────────────────────────────────────────
// mostrarModalAvisoOrders (interno)
// Aviso cuando checkSfcomOrders no puede conectar con sfcom.
// Solo se muestra una vez por sesión para no interrumpir al admin en cada carga.
// ────────────────────────────────────────────────────────────────────────────

function mostrarModalAvisoOrders() {
    if (sessionStorage.getItem('sfcom-orders-warned')) return
    sessionStorage.setItem('sfcom-orders-warned', '1')

    const existente = document.getElementById('sfcom-modal-aviso')
    if (existente) existente.remove()

    const overlay = document.createElement('div')
    overlay.id = 'sfcom-modal-aviso'
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.55)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'z-index:10000', 'padding:16px'
    ].join(';')

    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:28px;max-width:480px;width:100%;
                    box-shadow:0 8px 40px rgba(0,0,0,0.25);font-family:system-ui,sans-serif;
                    display:flex;flex-direction:column;gap:18px">

            <div style="display:flex;align-items:flex-start;gap:12px">
                <span style="font-size:22px;line-height:1">⚠️</span>
                <div>
                    <div style="font-size:15px;font-weight:600;color:#92400e;margin-bottom:4px">
                        No se pudieron cargar los pedidos de sfcom
                    </div>
                    <div style="font-size:13px;color:#555;line-height:1.5">
                        No ha sido posible conectar con sfcom para comprobar si hay pedidos nuevos.
                        Consulta el panel manualmente:<br><br>
                        <a href="https://tienda.sanfermin.com/dashboard.html" target="_blank"
                           style="color:#1d4ed8;text-decoration:underline">
                            Panel de Métricas — San Fermín
                        </a>
                    </div>
                </div>
            </div>

            <div style="display:flex;justify-content:flex-end">
                <button id="sfcom-btn-aviso-aceptar"
                    style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;
                           padding:8px 20px;font-size:13px;cursor:pointer;color:#374151;
                           white-space:nowrap">
                    Aceptar
                </button>
            </div>
        </div>`

    document.body.appendChild(overlay)
    document.getElementById('sfcom-btn-aviso-aceptar').addEventListener('click', () => overlay.remove())
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

export async function verificarCoherencia(supabase) {
    const resultado = {
        ok:     true,
        errores: [],
        avisos:  [],
        sfcom: { verificado: false, discrepancias: [], error: null }
    }

    // ── Carga en paralelo ───────────────────────────────────────────
    const [
        { data: reservas,     error: eRes },
        { data: availability, error: eAvail },
        { data: clients,      error: eClients },
        { data: providers,    error: eProviders },
        { data: services,     error: eServices },
        { data: solicitudes,  error: eSol }
    ] = await Promise.all([
        supabase.from('reservations').select('id, client_id, provider_id, service_id, status, slots'),
        supabase.from('availability').select('*'),
        supabase.from('clients').select('id'),
        supabase.from('providers').select('id'),
        supabase.from('services').select('id'),
        supabase.from('reservation_requests').select('id, source, client_name').eq('status', 'nueva')
    ])

    if (eRes || eAvail || eClients || eProviders || eServices || eSol) {
        resultado.errores.push('Error al leer datos de Supabase — verifica la conexión')
        resultado.ok = false
        return resultado
    }

    // ── Sets para lookup rápido ─────────────────────────────────────
    const clienteIds   = new Set((clients     ?? []).map(c => c.id))
    const proveedorIds = new Set((providers   ?? []).map(p => p.id))
    const servicioIds  = new Set((services    ?? []).map(s => s.id))
    const availKeys    = new Set((availability ?? []).map(a => `${a.provider_id}|${a.service_id}`))

    // ── Coherencia de FK en reservas ────────────────────────────────
    for (const r of (reservas ?? [])) {
        if (!clienteIds.has(r.client_id))
            resultado.errores.push(`Reserva ${r.id}: cliente "${r.client_id}" no existe en la BD`)
        if (!proveedorIds.has(r.provider_id))
            resultado.errores.push(`Reserva ${r.id}: proveedor "${r.provider_id}" no existe en la BD`)
        if (!servicioIds.has(r.service_id))
            resultado.errores.push(`Reserva ${r.id}: servicio "${r.service_id}" no existe en la BD`)
        if (r.status !== 'Cancelada' && !availKeys.has(`${r.provider_id}|${r.service_id}`))
            resultado.errores.push(`Reserva ${r.id}: sin fila availability para ${r.provider_id} / ${r.service_id}`)
    }

    // ── Sobrereserva por par proveedor/servicio ─────────────────────
    for (const avail of (availability ?? [])) {
        const activas = (reservas ?? []).filter(r =>
            r.provider_id === avail.provider_id &&
            r.service_id  === avail.service_id  &&
            r.status      !== 'Cancelada'
        ).length  // count de reservas (igual que syncStockToSfcom)

        if (activas > avail.total_slots) {
            resultado.errores.push(
                `Sobrereserva: ${avail.provider_id} / ${avail.service_id} — ` +
                `${activas} reservas activas sobre ${avail.total_slots} plazas totales`
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
                `${avail.provider_id} / ${avail.service_id}: marcado como "confirmed" en sfcom ` +
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
        let sfcomFallo = false
        for (const avail of mappedAvails) {
            try {
                const endpoint  = buildStockEndpoint(avail.sfcom_product_id, avail.sfcom_variation_id)
                const item      = await apiFetch(endpoint)
                const stockReal = item.stock_quantity ?? null

                if (stockReal === null) continue

                const activas       = (reservas ?? []).filter(r =>
                    r.provider_id === avail.provider_id &&
                    r.service_id  === avail.service_id  &&
                    r.status      !== 'Cancelada'
                ).length
                const stockEsperado = Math.max(0, avail.sfcom_slots_listed - activas)

                if (stockReal !== stockEsperado) {
                    resultado.sfcom.discrepancias.push({
                        servicio:     avail.sfcom_service_name,
                        providerId:   avail.provider_id,
                        serviceId:    avail.service_id,
                        stockSfcom:   stockReal,
                        stockEsperado,
                        diferencia:   stockReal - stockEsperado  // positivo → sfcom tiene MÁS stock del esperado
                    })
                }
            } catch (e) {
                sfcomFallo          = true
                resultado.sfcom.error = e.message
                console.warn(`[verificacion] GET sfcom fallido para ${avail.sfcom_service_name}: ${e.message}`)
                break  // un fallo es suficiente para saber que sfcom no está accesible
            }
        }
        if (!sfcomFallo) resultado.sfcom.verificado = true
    }

    resultado.ok = resultado.errores.length === 0
    return resultado
}

// ────────────────────────────────────────────────────────────────────────────
// getSfcomProducts (interno)
// Lee todos los productos de sfcom y expande las variaciones de productos
// de tipo variable. Devuelve un array plano de opciones seleccionables.
// ────────────────────────────────────────────────────────────────────────────

async function getSfcomProducts() {
    const productos  = await apiFetch('products')
    const resultado  = []

    for (const p of (productos ?? [])) {
        if (p.type === 'variable' && p.variations?.length) {
            let variaciones
            try {
                variaciones = await apiFetch(`products/${p.id}/variations`)
            } catch (e) {
                console.warn(`[sfcom] No se pudieron cargar variaciones de ${p.id}: ${e.message}`)
                continue
            }
            for (const v of (variaciones ?? [])) {
                resultado.push({
                    name:         v.name,
                    product_name: p.name,
                    product_id:   p.id,
                    variation_id: v.id
                })
            }
        } else {
            resultado.push({
                name:         p.name,
                product_name: p.name,
                product_id:   p.id,
                variation_id: null
            })
        }
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
            providerId: '—', serviceId: '—', endpoint: 'products',
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
            await supabase.from('availability')
                .update({ sfcom_service_name: match.name })
                .eq('id', dispId)
        }
        return { ok: false, notInList: true, name: match.name ?? productName }
    }

    // Encontrado → confirmar con product_id y variation_id
    // Guardamos el product_name (no la variation name) en sfcom_service_name
    const nombreAGuardar = match.product_name ?? match.name
    const { error } = await supabase.from('availability').update({
        sfcom_service_name: nombreAGuardar,
        sfcom_product_id:   match.product_id,
        sfcom_variation_id: match.variation_id ?? null,
        sfcom_status:       'confirmed'
    }).eq('id', dispId)

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
    const existente = document.getElementById('sfcom-modal-picker')
    if (existente) existente.remove()

    const overlay = document.createElement('div')
    overlay.id = 'sfcom-modal-picker'
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.55)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'z-index:10001', 'padding:16px'
    ].join(';')

    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:28px;max-width:560px;width:100%;
                    box-shadow:0 8px 40px rgba(0,0,0,0.25);font-family:system-ui,sans-serif;
                    display:flex;flex-direction:column;gap:18px">
            <div>
                <div style="font-size:15px;font-weight:600;margin-bottom:6px">Seleccionar producto en sfcom</div>
                <div style="font-size:13px;color:#555;line-height:1.5">
                    Escoge el producto de WooCommerce que corresponde a este servicio.
                    Para servicios de encierro con variaciones, la variación del día se selecciona automáticamente.
                </div>
            </div>
            <div style="position:relative">
                <input id="sfcom-picker-input" type="text"
                    value="${nombreActual ?? ''}"
                    placeholder="Escribe o selecciona…"
                    autocomplete="off"
                    style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;
                           font-size:13px;box-sizing:border-box">
                <div id="sfcom-picker-lista" style="position:absolute;left:0;right:0;top:100%;z-index:10;
                     background:#fff;border:1px solid #d1d5db;border-top:none;border-radius:0 0 6px 6px;
                     max-height:220px;overflow-y:auto;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
                </div>
            </div>
            <div id="sfcom-picker-aviso" style="display:none;font-size:12px;color:#92400e;
                 background:#fef3c7;border-radius:6px;padding:8px 12px">
                ⚠️ Este nombre no existe en la lista actual de sfcom. Puedes guardarlo de todas formas
                si Hilario ya lo ha creado o lo va a crear con exactamente ese nombre.
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end">
                <button id="sfcom-picker-cancelar"
                    style="background:transparent;border:1px solid #d1d5db;border-radius:6px;
                           padding:8px 16px;font-size:13px;cursor:pointer;color:#6b7280">
                    Cancelar
                </button>
                <button id="sfcom-picker-confirmar"
                    style="background:#1d4ed8;color:#fff;border:none;border-radius:6px;
                           padding:8px 20px;font-size:13px;cursor:pointer">
                    Confirmar
                </button>
            </div>
        </div>`

    document.body.appendChild(overlay)

    const input    = document.getElementById('sfcom-picker-input')
    const lista    = document.getElementById('sfcom-picker-lista')
    const aviso    = document.getElementById('sfcom-picker-aviso')
    const btnConf  = document.getElementById('sfcom-picker-confirmar')
    const btnCanc  = document.getElementById('sfcom-picker-cancelar')

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
    const existente = document.getElementById('sfcom-modal-correo-cancelacion')
    if (existente) existente.remove()

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

    const overlay = document.createElement('div')
    overlay.id = 'sfcom-modal-correo-cancelacion'
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.55)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'z-index:10000', 'padding:16px'
    ].join(';')

    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:28px;max-width:640px;width:100%;
                    box-shadow:0 8px 40px rgba(0,0,0,0.25);font-family:system-ui,sans-serif;
                    max-height:90vh;display:flex;flex-direction:column;gap:18px">
            <div>
                <div style="font-size:15px;font-weight:600;margin-bottom:4px">Correo para Hilario — cancelación de solicitud sfcom</div>
                <div style="font-size:13px;color:#555">Copia el texto o ábrelo directamente en tu cliente de correo.</div>
            </div>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
                <textarea id="sfcom-correo-cancel-texto"
                    style="width:100%;height:180px;font-size:12px;font-family:monospace;
                           border:none;background:transparent;resize:vertical;color:#1f2937;
                           outline:none;line-height:1.65;box-sizing:border-box"
                    readonly>${cuerpoCorreo}</textarea>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
                <button id="sfcom-cancel-copiar"
                    style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;
                           padding:8px 16px;font-size:13px;cursor:pointer;color:#374151;white-space:nowrap">
                    📋 Copiar texto
                </button>
                <a href="mailto:hilario@goviwebs.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(cuerpoCorreo)}"
                    style="background:#1d4ed8;color:#fff;border-radius:6px;padding:8px 16px;
                           font-size:13px;text-decoration:none;display:inline-flex;
                           align-items:center;gap:6px;white-space:nowrap">
                    ✉️ Abrir en correo
                </a>
                <button id="sfcom-cancel-cerrar"
                    style="background:transparent;border:1px solid #d1d5db;border-radius:6px;
                           padding:8px 16px;font-size:13px;cursor:pointer;color:#6b7280;white-space:nowrap">
                    Cerrar
                </button>
            </div>
        </div>`

    document.body.appendChild(overlay)

    document.getElementById('sfcom-cancel-copiar').addEventListener('click', () => {
        const ta  = document.getElementById('sfcom-correo-cancel-texto')
        const btn = document.getElementById('sfcom-cancel-copiar')
        ta.select()
        document.execCommand('copy')
        btn.textContent = '✅ Copiado'
        setTimeout(() => { btn.textContent = '📋 Copiar texto' }, 2000)
    })
    document.getElementById('sfcom-cancel-cerrar').addEventListener('click', () => overlay.remove())
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

    const overlay = document.createElement('div')
    overlay.id = 'sfcom-modal-correo-hilario'
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.55)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'z-index:10000', 'padding:16px'
    ].join(';')

    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:28px;max-width:640px;width:100%;
                    box-shadow:0 8px 40px rgba(0,0,0,0.25);font-family:system-ui,sans-serif;
                    max-height:90vh;display:flex;flex-direction:column;gap:18px">
            <div>
                <div style="font-size:15px;font-weight:600;margin-bottom:4px">Correo para Hilario — solicitud de alta en sfcom</div>
                <div style="font-size:13px;color:#555">Copia el texto o ábrelo directamente en tu cliente de correo.</div>
            </div>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
                <textarea id="sfcom-correo-texto"
                    style="width:100%;height:240px;font-size:12px;font-family:monospace;
                           border:none;background:transparent;resize:vertical;color:#1f2937;
                           outline:none;line-height:1.65;box-sizing:border-box"
                    readonly>${cuerpoCorreo}</textarea>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
                <button id="sfcom-correo-copiar"
                    style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;
                           padding:8px 16px;font-size:13px;cursor:pointer;color:#374151;white-space:nowrap">
                    📋 Copiar texto
                </button>
                <a href="mailto:hilario@goviwebs.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(cuerpoCorreo)}"
                    style="background:#1d4ed8;color:#fff;border-radius:6px;padding:8px 16px;
                           font-size:13px;text-decoration:none;display:inline-flex;
                           align-items:center;gap:6px;white-space:nowrap">
                    ✉️ Abrir en correo
                </a>
                ${opciones.withOkCancel
                    ? `<button id="sfcom-correo-cancelar"
                            style="background:transparent;border:1px solid #d1d5db;border-radius:6px;
                                   padding:8px 16px;font-size:13px;cursor:pointer;color:#6b7280;white-space:nowrap">
                            Cancelar
                        </button>
                        <button id="sfcom-correo-ok"
                            style="background:#166534;color:#fff;border:none;border-radius:6px;
                                   padding:8px 20px;font-size:13px;cursor:pointer;white-space:nowrap">
                            OK
                        </button>`
                    : `<button id="sfcom-correo-cerrar"
                            style="background:transparent;border:1px solid #d1d5db;border-radius:6px;
                                   padding:8px 16px;font-size:13px;cursor:pointer;color:#6b7280;white-space:nowrap">
                            Cerrar
                        </button>`}
            </div>
        </div>`

    document.body.appendChild(overlay)

    document.getElementById('sfcom-correo-copiar').addEventListener('click', () => {
        const ta  = document.getElementById('sfcom-correo-texto')
        const btn = document.getElementById('sfcom-correo-copiar')
        ta.select()
        document.execCommand('copy')
        btn.textContent = '✅ Copiado'
        setTimeout(() => { btn.textContent = '📋 Copiar texto' }, 2000)
    })

    if (opciones.withOkCancel) {
        document.getElementById('sfcom-correo-cancelar').addEventListener('click', () => { overlay.remove(); resolve('cancel') })
        document.getElementById('sfcom-correo-ok').addEventListener('click',       () => { overlay.remove(); resolve('ok')     })
    } else {
        document.getElementById('sfcom-correo-cerrar').addEventListener('click',   () => { overlay.remove(); resolve('closed') })
    }
    }) // end Promise
}
