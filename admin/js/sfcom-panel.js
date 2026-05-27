import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, fmt } from './utils.js'
import { verificarCoherencia, verificarConfirmarSfcom } from './sfcom.js'
import { mostrarToast, mostrarModalVerificacion, mostrarModalPreCorreccion } from './verificacion.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

// ─── Estado ──────────────────────────────────────────────────────────────────

let todosLosDatos = {
    reservas:      [],   // TODAS las reservas (sfcom y propias)
    disponibilidad: [],
    solicitudes:   [],
    servicios:     {},
    proveedores:   {},
    clientes:      {}
}

// Stock real de sfcom por clave "productId_variationId"
const stockSfcom = new Map()

// ─── Carga inicial ───────────────────────────────────────────────────────────

async function cargarDatos() {
    const [
        { data: reservas,       error: errR },
        { data: disponibilidad, error: errD },
        { data: solicitudes,    error: errS },
        { data: servicios,      error: errSvc },
        { data: proveedores,    error: errP },
        { data: clientes,       error: errC }
    ] = await Promise.all([
        supabase.from('reservations').select('id,client_id,service_id,provider_id,slots,price_per_slot,total_amount,status,sfcom_order_ref').order('id', { ascending: false }),
        supabase.from('availability_with_sfcom').select('*'),
        supabase.from('reservation_requests').select('id,client_name,client_email,source,service_id,level,day,slots,price_per_slot,created_at').like('source', 'WEB%').eq('status', 'nueva').order('created_at', { ascending: false }),
        supabase.from('services').select('id,event_type,day,description'),
        supabase.from('providers').select('id,name'),
        supabase.from('clients').select('id,name')
    ])

    if (errR)   console.error('[sfcom-panel] reservations:', errR)
    if (errD)   console.error('[sfcom-panel] availability_with_sfcom:', errD)
    if (errSvc) console.error('[sfcom-panel] services:', errSvc)
    if (errP)   console.error('[sfcom-panel] providers:', errP)
    if (errC)   console.error('[sfcom-panel] clients:', errC)

    todosLosDatos.reservas       = reservas      || []
    todosLosDatos.disponibilidad = disponibilidad || []
    todosLosDatos.solicitudes    = solicitudes    || []
    todosLosDatos.servicios      = Object.fromEntries((servicios  || []).map(s => [s.id, s]))
    todosLosDatos.proveedores    = Object.fromEntries((proveedores || []).map(p => [p.id, p]))
    todosLosDatos.clientes       = Object.fromEntries((clientes   || []).map(c => [c.id, c]))

    renderKpis()
    renderSolicitudes()
    renderReservas()
    renderListings()
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

function renderKpis() {
    const sfcomActivas = todosLosDatos.reservas.filter(r => r.sfcom_order_ref && r.status !== 'Cancelada')
    const nReservas  = sfcomActivas.length
    // price_per_slot en reservas sfcom es ya el precio neto (bruto / 1.15)
    const totalNeto  = sfcomActivas.reduce((s, r) => s + (parseFloat(r.total_amount) || (r.slots * parseFloat(r.price_per_slot))), 0)
    const totalBruto = totalNeto * 1.15
    const comision   = totalBruto - totalNeto
    const ticket     = nReservas > 0 ? totalBruto / nReservas : 0

    document.getElementById('kpi-reservas-sfcom').textContent = nReservas
    document.getElementById('kpi-bruto').textContent          = fmt(totalBruto)
    document.getElementById('kpi-comision').textContent       = fmt(comision)
    document.getElementById('kpi-neto').textContent           = fmt(totalNeto)
    document.getElementById('kpi-ticket').textContent         = nReservas > 0 ? fmt(ticket) : '—'
}

// ─── Solicitudes pendientes sfcom ─────────────────────────────────────────────

function renderSolicitudes() {
    const tbody = document.getElementById('tbody-solicitudes-sfcom')
    const bloque = document.getElementById('bloque-solicitudes-sfcom')
    const { solicitudes, servicios } = todosLosDatos

    if (!solicitudes.length) {
        bloque.style.display = 'none'
        return
    }

    bloque.style.display = ''
    tbody.innerHTML = solicitudes.map(s => {
        const fecha = s.created_at ? new Date(s.created_at).toLocaleDateString('es-ES') : '—'
        const svcLabel = s.service_id && servicios[s.service_id]
            ? (servicios[s.service_id].description || s.service_id)
            : (s.level ? `${s.level}${s.day ? ' día ' + s.day : ''}` : '—')
        const precioUnit = s.price_per_slot ? fmt(parseFloat(s.price_per_slot)) : '—'
        const total      = (s.price_per_slot && s.slots) ? fmt(parseFloat(s.price_per_slot) * s.slots) : '—'

        return `<tr class="fila-sfcom-pendiente">
            <td>${fecha}</td>
            <td><code>${s.source || '—'}</code></td>
            <td>${s.client_name || '—'}</td>
            <td>${svcLabel}</td>
            <td style="text-align:center">${s.slots ?? '—'}</td>
            <td style="text-align:right">${precioUnit}</td>
            <td style="text-align:right;font-weight:600">${total}</td>
        </tr>`
    }).join('')
}

// ─── Reservas sfcom registradas ───────────────────────────────────────────────

function renderReservas() {
    const tbody = document.getElementById('tbody-reservas-sfcom')
    const { reservas, servicios, proveedores, clientes } = todosLosDatos
    const sfcom = reservas.filter(r => r.sfcom_order_ref)

    if (!sfcom.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--subtle)">No hay reservas sfcom registradas</td></tr>'
        return
    }

    tbody.innerHTML = sfcom.map(r => {
        const svc  = servicios[r.service_id]
        const prov = proveedores[r.provider_id]
        const cli  = clientes[r.client_id]
        const totalNeto  = parseFloat(r.total_amount) || (r.slots * parseFloat(r.price_per_slot))
        const estadoClass = r.status === 'Confirmada' ? 'ok' : r.status === 'Cancelada' ? 'error' : 'warn'

        return `<tr>
            <td><code>${r.sfcom_order_ref}</code></td>
            <td>${cli?.name  ?? r.client_id   ?? '—'}</td>
            <td>${svc?.description ?? r.service_id  ?? '—'}</td>
            <td>${prov?.name ?? r.provider_id ?? '—'}</td>
            <td style="text-align:center">${r.slots}</td>
            <td style="text-align:right">${fmt(r.price_per_slot)}</td>
            <td style="text-align:right;font-weight:600">${fmt(totalNeto)}</td>
            <td class="${estadoClass}">${r.status}</td>
        </tr>`
    }).join('')
}

// ─── Listings sfcom ───────────────────────────────────────────────────────────

const ESTADO_LABEL = {
    'confirmed':            { label: 'Activo',         color: '#166534', bg: '#dcfce7' },
    'pending':              { label: 'Pendiente alta', color: '#7c3a00', bg: '#fef3c7' },
    'deactivation_pending': { label: 'Pendiente baja', color: '#6b21a8', bg: '#f3e8ff' }
}

function renderListings() {
    const tbody = document.getElementById('tbody-listings')
    const { disponibilidad, reservas, servicios, proveedores } = todosLosDatos

    const listings = disponibilidad.filter(d => d.sfcom_status !== null)
    if (!listings.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--subtle)">No hay publicaciones en sfcom</td></tr>'
        return
    }

    tbody.innerHTML = listings.map(d => {
        const svc  = servicios[d.service_id]
        const prov = proveedores[d.provider_id]

        // Todas las reservas activas para este par (sfcom y propias)
        const resSfcom  = reservas.filter(r => r.provider_id === d.provider_id && r.service_id === d.service_id && r.sfcom_order_ref && r.status !== 'Cancelada')
        const resPropia = reservas.filter(r => r.provider_id === d.provider_id && r.service_id === d.service_id && !r.sfcom_order_ref && r.status !== 'Cancelada')
        const slotsSfcom   = resSfcom.reduce((s, r)  => s + r.slots, 0)
        const slotsPropios = resPropia.reduce((s, r) => s + r.slots, 0)
        const slotsTotales = slotsSfcom + slotsPropios

        const listedSlots = d.sfcom_slots_listed ?? '—'
        let stockEsperado = '—'
        if (d.sfcom_status === 'confirmed' && d.sfcom_slots_listed !== null) {
            stockEsperado = Math.max(0, Math.min(
                d.sfcom_slots_listed - slotsSfcom,
                d.total_slots - slotsTotales
            ))
        }

        const sfKey = `${d.sfcom_product_id}_${d.sfcom_variation_id ?? 'null'}`
        const estadoInfo = ESTADO_LABEL[d.sfcom_status] || { label: d.sfcom_status, color: '#444', bg: '#f0f0f0' }
        const stockRealTxt = stockSfcom.has(sfKey) ? stockSfcom.get(sfKey) : (d.sfcom_status === 'confirmed' ? '…' : '—')

        return `<tr>
            <td>${d.sfcom_service_name || '—'}</td>
            <td>${svc?.description ?? d.service_id ?? '—'}</td>
            <td>${prov?.name ?? d.provider_id ?? '—'}</td>
            <td><span class="sfcom-badge sfcom-badge--${d.sfcom_status === 'confirmed' ? 'confirmed' : d.sfcom_status === 'pending' ? 'pending' : 'deactivation'}">${estadoInfo.label}</span></td>
            <td style="text-align:center">${listedSlots}</td>
            <td style="text-align:center">${slotsSfcom}</td>
            <td style="text-align:center">${slotsPropios}</td>
            <td style="text-align:center;font-weight:600">${stockEsperado}</td>
            <td class="td-stock-real" data-sfkey="${sfKey}" data-provider="${d.provider_id}" data-service="${d.service_id}" style="text-align:center">${stockRealTxt}</td>
        </tr>`
    }).join('')
}

function actualizarColumnaStockReal() {
    document.querySelectorAll('.td-stock-real[data-sfkey]').forEach(td => {
        const key = td.dataset.sfkey
        if (stockSfcom.has(key)) {
            const v = stockSfcom.get(key)
            td.textContent = v === null ? '—' : v
            td.style.fontWeight = '600'
            td.style.color = ''
        }
    })
}

// ─── Verificación (misma lógica que formulario.js) ───────────────────────────

async function ejecutarVerificacion(modoManual = false) {
    const toastEl = mostrarToast('🔍 Verificando coherencia…', '#374151')

    let resultado
    try {
        resultado = await verificarCoherencia(supabase, { checkVariationNames: true })
    } finally {
        toastEl?.remove()
    }

    // Actualizar columna de stock real con los datos de la verificación
    actualizarStockDesdeVerificacion(resultado)

    const hayMismatch = (resultado.sfcom?.idsMismatch?.length ?? 0) > 0

    if (hayMismatch) {
        const decision = await mostrarModalPreCorreccion(resultado.sfcom.idsMismatch)
        if (decision === 'corregir') {
            for (const m of resultado.sfcom.idsMismatch) {
                await verificarConfirmarSfcom(supabase, m.availId, m.servicio, m.serviceId)
            }
            const resultadoCorregido = await verificarCoherencia(supabase, { checkVariationNames: true })
            actualizarStockDesdeVerificacion(resultadoCorregido)
            mostrarModalVerificacion(resultadoCorregido, supabase, () => ejecutarVerificacion(true))
        } else {
            mostrarModalVerificacion(resultado, supabase, () => ejecutarVerificacion(true), { sinBotonCorregir: true })
        }
        return
    }

    const discRepReal   = (resultado.sfcom?.discrepancias ?? []).filter(d => !d.pendingExplains)
    const hayPendientes = (resultado.sfcom?.discrepancias ?? []).some(d => d.pendingExplains)
    const hayProblema   = resultado.errores.length > 0 || discRepReal.length > 0

    if (modoManual || hayProblema || hayPendientes) {
        mostrarModalVerificacion(resultado, supabase, () => ejecutarVerificacion(true))
    } else if (!resultado.sfcom?.verificado) {
        const statusEl = document.getElementById('txt-sfcom-fetch-status')
        if (statusEl) statusEl.textContent = '⚠️ No se pudo consultar el stock real de sfcom. Los datos pueden estar desactualizados.'
        mostrarToast('⚠️ Reservas verificadas — sfcom no disponible', '#92400e')
    } else {
        const statusEl = document.getElementById('txt-sfcom-fetch-status')
        if (statusEl) statusEl.textContent = ''
        mostrarToast('✅ Coherencia de reservas, plazas y sfcom verificada y correcta')
    }
}

function actualizarStockDesdeVerificacion(resultado) {
    if (!resultado?.sfcom) return
    const confirmados = todosLosDatos.disponibilidad.filter(d => d.sfcom_status === 'confirmed')
    const fallos  = new Set((resultado.sfcom.fallos ?? []).map(f => `${f.providerId}|${f.serviceId}`))
    const discMap = new Map((resultado.sfcom.discrepancias ?? []).map(d => [`${d.providerId}|${d.serviceId}`, d.stockReal]))

    confirmados.forEach(d => {
        const pairKey = `${d.provider_id}|${d.service_id}`
        const sfKey   = `${d.sfcom_product_id}_${d.sfcom_variation_id ?? 'null'}`
        if (fallos.has(pairKey)) return

        if (discMap.has(pairKey)) {
            stockSfcom.set(sfKey, discMap.get(pairKey))
        } else {
            // sin discrepancia → stockReal === stockEsperado, calculamos igual que renderListings
            const { reservas } = todosLosDatos
            const slotsSfcom   = reservas.filter(r => r.provider_id === d.provider_id && r.service_id === d.service_id && r.sfcom_order_ref && r.status !== 'Cancelada').reduce((s, r) => s + r.slots, 0)
            const slotsTotales = reservas.filter(r => r.provider_id === d.provider_id && r.service_id === d.service_id && r.status !== 'Cancelada').reduce((s, r) => s + r.slots, 0)
            stockSfcom.set(sfKey, Math.max(0, Math.min(
                (d.sfcom_slots_listed ?? 0) - slotsSfcom,
                d.total_slots - slotsTotales
            )))
        }
    })

    // Marcar como '?' las celdas de pares que fallaron
    document.querySelectorAll('.td-stock-real[data-provider]').forEach(td => {
        const pairKey = `${td.dataset.provider}|${td.dataset.service}`
        if (fallos.has(pairKey) && td.textContent === '…') {
            td.textContent = '?'
            td.style.color = 'var(--accent-warn)'
        }
    })

    actualizarColumnaStockReal()
}

// ─── Listeners ────────────────────────────────────────────────────────────────

document.getElementById('btnVerificarDatos').addEventListener('click', () => {
    ejecutarVerificacion(true).catch(e => console.error('[sfcom-panel] verificacion:', e))
})

document.getElementById('btnActualizarSfcom').addEventListener('click', () => {
    ejecutarVerificacion(false).catch(e => console.error('[sfcom-panel] verificacion:', e))
})

// ─── Arranque ─────────────────────────────────────────────────────────────────

cargarDatos().then(() => {
    ejecutarVerificacion(false).catch(e => console.error('[sfcom-panel] verificacion inicial:', e))
})
