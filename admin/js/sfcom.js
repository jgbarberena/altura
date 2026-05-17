// sfcom.js
// Comunicación bidireccional con tienda.sanfermin.com via woo-proxy.php
// Flujo A (lectura):  sfcom → detectar pedidos nuevos → avisar al panel
// Flujo B (escritura): reserva guardada en Supabase → actualizar stock en sfcom
//
// ─── WORKAROUND TEMPORAL ────────────────────────────────────────────────────
// El proxy de sfcom (woo-proxy.php) solo acepta peticiones con Referer:
// https://tienda.sanfermin.com/dashboard.html y Access-Control-Allow-Origin
// apuntando a ese mismo dominio. Mientras Hilario no añada nuestro dominio
// a la lista de orígenes permitidos, todas las llamadas al proxy fallarán
// con error CORS desde nuestro panel.
//
// Impacto actual:
//   - Flujo A (GET pedidos): falla silenciosamente, solo log en consola.
//   - Flujo B (PUT stock):   falla y muestra modal con correo a Hilario.
//   - checkAvailabilityBeforeSave: falla silenciosamente, no bloquea la reserva.
//
// Qué hacer cuando Hilario añada el dominio:
//   1. Borrar este bloque de comentario.
//   2. Buscar todos los bloques marcados con «WORKAROUND» y eliminarlos.
//   3. El resto del código ya es la versión definitiva y funcionará sin cambios.
// ────────────────────────────────────────────────────────────────────────────

const PROXY_URL     = 'https://tienda.sanfermin.com/woo-proxy.php'
const PROXY_KEY     = 'proxy_SanFer2026_key'
const EMAIL_HILARIO = 'hilario@goviwebs.com'  // destinatario de notificaciones de error

// ─── Utilidad interna: llamada al proxy ──────────────────────────────────────

async function proxyFetch(endpoint, method = 'GET', body = null) {
    const url = `${PROXY_URL}?endpoint=${encodeURIComponent(endpoint)}`
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-Panel-Key':  PROXY_KEY
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
// Si el GET falla (CORS u otro error), devuelve productId null.

async function resolveProductIds(availRow) {
    const { sfcom_product_id, sfcom_variation_id, sfcom_service_name } = availRow

    if (sfcom_product_id) {
        try {
            const endpoint = buildStockEndpoint(sfcom_product_id, sfcom_variation_id)
            const item = await proxyFetch(endpoint)

            let realName
            if (sfcom_variation_id) {
                const parent = await proxyFetch(`products/${sfcom_product_id}`)
                realName = parent.name
            } else {
                realName = item.name
            }

            realName = realName.replace(/<[^>]*>/g, '').trim()
            const nameMatch = realName.toLowerCase() === sfcom_service_name.toLowerCase()
            return { productId: sfcom_product_id, variationId: sfcom_variation_id, verified: true, nameMatch, realName }
        } catch (e) {
            // GET fallido — puede ser CORS (workaround) o problema real
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
    //    Si el GET falla por CORS u otro error, resolved.productId será null
    //    y pasaremos directamente al bloque de error con modal.
    const resolved = await resolveProductIds(avail)

    if (resolved.productId && !resolved.nameMatch) {
        // Los IDs responden pero el nombre ha cambiado en sfcom — avisar en consola
        // El PUT se intenta igualmente con los IDs cacheados
        console.warn(`[sfcom] Nombre cambiado en sfcom. Esperado: "${avail.sfcom_service_name}", Real: "${resolved.realName}". Continuando con IDs cacheados.`)
    }

    // ── WORKAROUND TEMPORAL (inicio) ────────────────────────────────────────
    // Cuando resolved.productId es null, normalmente significaría que los IDs
    // son incorrectos. Pero mientras haya error CORS, siempre será null aunque
    // los IDs sean correctos. Por tanto, aunque no podamos verificar los IDs,
    // intentamos el PUT igualmente usando los IDs directamente de availability
    // (que sabemos que son correctos porque los pusimos a mano).
    // Cuando el CORS esté resuelto, este bloque se puede eliminar y dejar solo
    // el bloque «versión definitiva» de abajo.
    //
    // Versión definitiva (descomentar cuando CORS esté resuelto y borrar el workaround):
    // if (!resolved.productId) {
    //     console.error(`[sfcom] No se pudieron verificar los IDs para ${avail.sfcom_service_name}.`)
    //     mostrarModalError({
    //         servicio:   avail.sfcom_service_name,
    //         providerId,
    //         serviceId,
    //         endpoint,
    //         nuevoStock,
    //         getExito:   false,
    //         getError:   resolved.error ?? 'No se pudo conectar',
    //         putError:   'No se intentó — el GET previo ya falló'
    //     })
    //     return { ok: false, error: 'ids_not_resolved' }
    // }
    const productIdFinal   = resolved.productId   ?? avail.sfcom_product_id
    const variationIdFinal = resolved.variationId ?? avail.sfcom_variation_id
    const endpointFinal    = buildStockEndpoint(productIdFinal, variationIdFinal)
    const getExito         = resolved.productId !== null
    const getError         = resolved.error ?? ''
    // ── WORKAROUND TEMPORAL (fin) ────────────────────────────────────────────

    // 6. Hacer el PUT
    try {
        await proxyFetch(endpointFinal, 'PUT', {
            stock_quantity: nuevoStock,
            manage_stock:   true,
            stock_anterior: avail.sfcom_slots_listed
        })
        console.info(`[sfcom] Stock actualizado: ${avail.sfcom_service_name} → ${nuevoStock} plazas (${reservasActivas} reservadas de ${avail.sfcom_slots_listed} listadas)`)
        return { ok: true, nuevoStock, reservasActivas }
    } catch (e) {
        console.error(`[sfcom] PUT fallido para ${avail.sfcom_service_name}: ${e.message}`)
        mostrarModalError({
            servicio:   avail.sfcom_service_name,
            providerId,
            serviceId,
            endpoint:   endpointFinal,
            nuevoStock,
            getExito,
            getError,
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
// WORKAROUND TEMPORAL: mientras haya error CORS, este GET fallará siempre
// y devolverá { ok: false, nuevos: [] }. El llamador debe ignorar el error
// y no bloquear el flujo. Cuando el CORS esté resuelto, funcionará sin cambios.
// ────────────────────────────────────────────────────────────────────────────

export async function checkSfcomOrders(supabase, diasAtras = 90) {
    let sfcomOrders
    try {
        const after = new Date()
        after.setDate(after.getDate() - diasAtras)
        sfcomOrders = await proxyFetch(`orders?status=completed&after=${encodeURIComponent(after.toISOString())}&per_page=100`)
    } catch (e) {
        // WORKAROUND TEMPORAL: falla por CORS — silencioso, sin modal, sin bloqueo
        console.warn(`[sfcom] checkSfcomOrders: GET fallido (probablemente CORS). ${e.message}`)
        return { ok: false, error: e.message, nuevos: [] }
        // Versión definitiva: este catch no necesita cambios — el comportamiento
        // es el mismo, pero cuando CORS esté resuelto el try tendrá éxito.
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
// Lee el stock actual del proxy y lo compara con las reservas propias.
// Si el stock de sfcom es insuficiente, bloquea y avisa.
//
// WORKAROUND TEMPORAL: mientras haya error CORS, el GET fallará y la función
// devolverá { ok: true, sfcomCheck: false } sin bloquear la reserva.
// Cuando el CORS esté resuelto, el GET tendrá éxito y la verificación
// funcionará correctamente sin cambios en el código.
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
        const item     = await proxyFetch(endpoint)
        stockSfcom     = item.stock_quantity ?? null
    } catch (e) {
        // WORKAROUND TEMPORAL: falla por CORS — no bloqueamos la reserva
        console.warn(`[sfcom] checkAvailabilityBeforeSave: GET fallido (probablemente CORS). No se verifica disponibilidad sfcom. ${e.message}`)
        return { ok: true, sfcomCheck: false, warning: e.message }
        // Versión definitiva: este catch no necesita cambios — mismo comportamiento,
        // pero cuando CORS esté resuelto el try tendrá éxito y se verificará.
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
// Modal con el texto del correo a Hilario, botón mailto y botón cerrar.
// Se dispara únicamente cuando falla un PUT de sincronización de stock.
// El modal no se cierra solo — Paula debe pulsar "Cerrar" explícitamente.
// ────────────────────────────────────────────────────────────────────────────

function mostrarModalError({ servicio, providerId, serviceId, endpoint, nuevoStock, getExito, getError, putError }) {
    const existente = document.getElementById('sfcom-modal-error')
    if (existente) existente.remove()

    const endpointCompleto = `${PROXY_URL}?endpoint=${encodeURIComponent(endpoint)}`
    const subject          = `Disponibilidad "${servicio}" — actualización pendiente`

    const cuerpoCorreo = [
        `Hola Hilario,`,
        ``,
        `Te escribo porque hemos tenido un problema al intentar sincronizar la disponibilidad de uno de los balcones.`,
        ``,
        `Al registrar una reserva para "${servicio}" (referencia interna: ${providerId} / ${serviceId}), el sistema intentó realizar dos operaciones automáticas:`,
        ``,
        `1. GET ${endpointCompleto}`,
        `   Resultado: ${getExito ? 'OK' : `Error — ${getError}`}`,
        ``,
        `2. PUT ${endpointCompleto}`,
        `   Nuevo stock calculado: ${nuevoStock} plazas`,
        `   Resultado: Error — ${putError}`,
        ``,
        `No hemos podido actualizar la disponibilidad automáticamente porque no tenemos acceso a la API necesaria para realizar estas operaciones.`,
        ``,
        `El stock correcto para "${servicio}" debería quedar en ${nuevoStock} plazas disponibles.`,
        ``,
        `¿Podrías actualizarlo manualmente en la tienda, o facilitarnos el acceso necesario para que podamos hacerlo de forma automática en el futuro? Te lo agradecemos mucho.`,
        ``,
        `Un saludo,`,
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
                        La reserva se ha guardado correctamente en tu sistema, pero no se ha podido
                        notificar a sfcom. Envía el correo a Hilario para que lo actualice manualmente.
                    </div>
                </div>
            </div>

            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
                <div style="font-size:11px;color:#6b7280;margin-bottom:8px;text-transform:uppercase;
                            letter-spacing:.06em;font-weight:500">
                    Texto del correo — cópialo si el botón no abre tu cliente de correo
                </div>
                <textarea id="sfcom-email-texto"
                    style="width:100%;height:220px;font-size:12px;font-family:monospace;
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
                    href="mailto:${EMAIL_HILARIO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(cuerpoCorreo)}"
                    style="background:#dc2626;color:#fff;border-radius:6px;padding:8px 16px;
                           font-size:13px;text-decoration:none;display:inline-flex;
                           align-items:center;gap:6px;white-space:nowrap">
                    📧 Enviar correo a Hilario
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
        const ta = document.getElementById('sfcom-email-texto')
        ta.select()
        document.execCommand('copy')
        const btn = document.getElementById('sfcom-btn-copiar')
        const original = btn.textContent
        btn.textContent = '✅ Copiado'
        setTimeout(() => { btn.textContent = original }, 2000)
    })

    // El botón cerrar es la única forma de cerrar el modal
    document.getElementById('sfcom-btn-cerrar').addEventListener('click', () => overlay.remove())
}