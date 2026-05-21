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

// ─── Utilidad interna: resolver y verificar IDs cacheados ────────────────────
// Hace GET al producto/variación para verificar que el nombre en sfcom
// sigue coincidiendo con sfcom_service_name. Si hay discrepancia, avisa.
// Si el GET falla, devuelve productId null.

async function resolveProductIds(availRow) {
    const { sfcom_product_id, sfcom_variation_id, sfcom_service_name } = availRow

    if (sfcom_product_id) {
        try {
            const endpoint = buildStockEndpoint(sfcom_product_id, sfcom_variation_id)
            const item = await apiFetch(endpoint)

            let realName
            if (sfcom_variation_id) {
                const parent = await apiFetch(`products/${sfcom_product_id}`)
                realName = parent.name
            } else {
                realName = item.name
            }

            realName = realName.replace(/<[^>]*>/g, '').trim()
            const nameMatch = realName.toLowerCase() === sfcom_service_name.toLowerCase()
            return { productId: sfcom_product_id, variationId: sfcom_variation_id, verified: true, nameMatch, realName }
        } catch (e) {
            // GET fallido — error de red o IDs incorrectos en availability
            return { productId: null, variationId: null, verified: false, error: e.message }
        }
    }

    console.warn(`[sfcom] Sin sfcom_product_id para "${sfcom_service_name}". Rellena los IDs manualmente en availability.`)
    return { productId: null, variationId: null, verified: false }
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
    if (!avail.sfcom_service_name || avail.sfcom_slots_listed === null) {
        return { ok: true, skipped: true, reason: 'not_mapped' }
    }

    // 3. Contar reservas no canceladas (se hace antes del GET/PUT para tenerlo listo)
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

    // 4. Calcular nuevo stock
    const reservasActivas = count ?? 0
    const nuevoStock      = Math.max(0, avail.sfcom_slots_listed - reservasActivas)
    const endpoint        = buildStockEndpoint(avail.sfcom_product_id, avail.sfcom_variation_id)

    // 5. Verificar IDs cacheados y nombre del producto en sfcom (GET)
    const resolved = await resolveProductIds(avail)

    if (resolved.productId && !resolved.nameMatch) {
        console.warn(`[sfcom] Nombre cambiado en sfcom. Esperado: "${avail.sfcom_service_name}", Real: "${resolved.realName}". Continuando con IDs cacheados.`)
    }

    if (!resolved.productId) {
        console.error(`[sfcom] No se pudieron verificar los IDs para ${avail.sfcom_service_name}.`)
        mostrarModalError({
            servicio:   avail.sfcom_service_name,
            providerId,
            serviceId,
            endpoint,
            nuevoStock,
            putError:   resolved.error ?? 'No se pudo conectar'
        })
        return { ok: false, error: 'ids_not_resolved' }
    }

    // 6. Hacer el PUT
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
        mostrarModalAvisoSfcom()
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
// Verifica disponibilidad real en sfcom justo antes de guardar una reserva.
// Lee el stock actual y lo compara con las reservas propias.
// Si el stock de sfcom es insuficiente, bloquea y avisa.
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

    const { count } = await supabase
        .from('reservations')
        .select('*', { count: 'exact', head: true })
        .eq('provider_id', providerId)
        .eq('service_id', serviceId)
        .neq('status', 'Cancelada')

    const reservasActivas   = count ?? 0
    const plazasLibresSfcom = Math.max(0, avail.sfcom_slots_listed - reservasActivas)

    if (plazasSolicitadas > plazasLibresSfcom) {
        return {
            ok: false,
            sfcomCheck: true,
            stockSfcom,
            plazasLibresSfcom,
            message: `Disponibilidad insuficiente. sfcom tiene ${stockSfcom} plazas visibles y tus reservas dejan solo ${plazasLibresSfcom} libres de las ${avail.sfcom_slots_listed} listadas.`
        }
    }

    return { ok: true, sfcomCheck: true, stockSfcom, plazasLibresSfcom }
}

// ────────────────────────────────────────────────────────────────────────────
// mostrarModalError (interno)
// Modal de error con información técnica y texto del correo para Hilario.
// Se dispara cuando falla la verificación de IDs o el PUT de stock.
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
                        problema al actualizar el stock en sfcom. Revísalo manualmente en el panel
                        de sfcom o contacta con Hilario.
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
                        a ${nuevoStock} plaza(s) disponibles en sfcom.
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
// mostrarModalAvisoSfcom (interno)
// Aviso cuando checkSfcomOrders no puede conectar con sfcom.
// Invita a consultar el panel manualmente.
// ────────────────────────────────────────────────────────────────────────────

function mostrarModalAvisoSfcom() {
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
