import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, fmt, exportTable, valorO } from './utils.js'
import { mostrarToast, ejecutarVerificacion } from './verificacion.js'
import { checkSfcomOrders, importarCanceladosSfcom, loadSfcomListings } from './sfcom.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

{
    const _sfcomResult = await checkSfcomOrders(supabase).catch(() => ({ ok: false }))
    if (_sfcomResult.ok && _sfcomResult.cancelados?.length) {
        const _sfcomListings = await loadSfcomListings(supabase)
        await importarCanceladosSfcom(supabase, _sfcomListings, _sfcomResult.cancelados)
    }
}

// ─── Estado ──────────────────────────────────────────────────────────────────

let todosLosDatos = {
    reservas:      [],   // TODAS las reservas (sfcom y propias)
    disponibilidad: [],
    solicitudes:   [],
    servicios:     {},
    venues:        {},
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
        supabase.from('reservations').select('id,client_id,service_id,venue_id,slots,price_per_slot,total_amount,status,origin_ref').order('id', { ascending: false }),
        supabase.from('availability_with_sfcom').select('id, venue_id, service_id, service_code, total_slots, price_per_slot, billing_model, venue_display_name, sfcom_service_name, sfcom_slots_listed, sfcom_product_id, sfcom_variation_id, sfcom_status'),
        supabase.from('reservation_requests').select('id,client_name,client_email,source,proposal_draft,created_at').like('source', 'WEB%').eq('status', 'nueva').order('created_at', { ascending: false }),
        supabase.from('services').select('id,service_code,event_type,day,description'),
        supabase.from('venues').select('id,display_name,provider_id'),
        supabase.from('clients').select('id,name')
    ])

    if (errR)   console.error('[sfcom-panel] reservations:', errR)
    if (errD)   console.error('[sfcom-panel] availability_with_sfcom:', errD)
    if (errSvc) console.error('[sfcom-panel] services:', errSvc)
    if (errP)   console.error('[sfcom-panel] venues:', errP)
    if (errC)   console.error('[sfcom-panel] clients:', errC)

    todosLosDatos.reservas       = reservas      || []
    todosLosDatos.disponibilidad = disponibilidad || []
    todosLosDatos.solicitudes    = solicitudes    || []
    todosLosDatos.servicios      = Object.fromEntries((servicios  || []).map(s => [s.id, s]))
    todosLosDatos.venues         = Object.fromEntries((proveedores || []).map(v => [v.id, v]))
    todosLosDatos.clientes       = Object.fromEntries((clientes   || []).map(c => [c.id, c]))

    renderKpis()
    renderSolicitudes()
    renderReservas()
    renderListings()
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

function renderKpis() {
    const sfcomActivas = todosLosDatos.reservas.filter(r => r.origin_ref?.startsWith('WEB') && r.status !== 'Cancelada')
    const nReservas  = sfcomActivas.length
    // price_per_slot en reservas sfcom es ya el precio neto (bruto / 1.15)
    const totalNeto  = sfcomActivas.reduce((s, r) => s + (parseFloat(r.total_amount) || (r.slots * parseFloat(r.price_per_slot))), 0)
    const totalBruto = totalNeto * 1.15
    const comision   = totalBruto - totalNeto
    const ticket     = nReservas > 0 ? totalBruto / nReservas : 0

    // Coste proveedor para las reservas sfcom:
    // capacity / consumption → price_per_slot × slots
    // fixed → (price_per_slot / total_slots) × slots  (coste unitario aproximado)
    const costeSfcom = sfcomActivas.reduce((s, r) => {
        const avail = todosLosDatos.disponibilidad.find(
            d => d.venue_id === r.venue_id && d.service_id === r.service_id
        )
        if (!avail) return s
        const costeUnit = avail.billing_model === 'fixed'
            ? parseFloat(avail.price_per_slot ?? 0) / (avail.total_slots || 1)
            : parseFloat(avail.price_per_slot ?? 0)
        return s + costeUnit * (r.slots ?? 0)
    }, 0)
    const margenNeto = totalNeto - costeSfcom

    document.getElementById('kpi-reservas-sfcom').textContent = nReservas
    document.getElementById('kpi-bruto').textContent          = fmt(totalBruto)
    document.getElementById('kpi-comision').textContent       = fmt(comision)
    document.getElementById('kpi-neto').textContent           = fmt(totalNeto)
    document.getElementById('kpi-margen').textContent         = nReservas > 0 ? fmt(margenNeto) : '—'
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
        const d0         = s.proposal_draft?.[0] ?? null
        const fecha      = s.created_at ? new Date(s.created_at).toLocaleDateString('es-ES') : '—'
        const svcLabel   = d0?.service_id && servicios[d0.service_id]
            ? (servicios[d0.service_id].description || servicios[d0.service_id].service_code || d0.service_name || '—')
            : (d0?.service_name ? `${d0.service_name}${d0.day ? ' día ' + d0.day : ''}` : '—')
        const precioUnit = d0?.price ? fmt(parseFloat(d0.price)) : '—'
        const total      = (d0?.price && d0?.slots) ? fmt(parseFloat(d0.price) * d0.slots) : '—'

        return `<tr class="fila-sfcom-pendiente">
            <td>${fecha}</td>
            <td><code>${s.source || '—'}</code></td>
            <td>${s.client_name || '—'}</td>
            <td>${svcLabel}</td>
            <td style="text-align:center">${d0?.slots ?? '—'}</td>
            <td style="text-align:right">${precioUnit}</td>
            <td style="text-align:right;font-weight:600">${total}</td>
        </tr>`
    }).join('')
}

// ─── Reservas sfcom registradas ───────────────────────────────────────────────

function renderReservas() {
    const tbody = document.getElementById('tbody-reservas-sfcom')
    const { reservas, servicios, venues, clientes } = todosLosDatos
    const sfcom = reservas.filter(r => r.origin_ref?.startsWith('WEB'))

    if (!sfcom.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--subtle)">No hay reservas sfcom registradas</td></tr>'
        return
    }

    tbody.innerHTML = sfcom.map(r => {
        const svc  = servicios[r.service_id]
        const cli  = clientes[r.client_id]
        const avail = todosLosDatos.disponibilidad.find(d => d.venue_id === r.venue_id && d.service_id === r.service_id)
        const totalNeto  = parseFloat(r.total_amount) || (r.slots * parseFloat(r.price_per_slot))
        const estadoClass = r.status === 'Confirmada' ? 'ok' : r.status === 'Cancelada' ? 'error' : 'warn'
        const eventoLabel = svc?.event_type
            ? svc.event_type.charAt(0).toUpperCase() + svc.event_type.slice(1).replace(/_/g, ' ')
            : svc?.service_code ?? '—'
        const diaLabel = svc?.day ?? '—'
        const sfcomNombre = avail?.sfcom_service_name || '—'

        return `<tr>
            <td><code>${r.origin_ref}</code></td>
            <td>${valorO(cli?.name, r.client_id ?? '—')}</td>
            <td>${eventoLabel}</td>
            <td style="text-align:center">${diaLabel}</td>
            <td>${sfcomNombre}</td>
            <td style="text-align:center">${r.slots}</td>
            <td style="text-align:right">${fmt(r.price_per_slot)}</td>
            <td style="text-align:right;font-weight:600">${fmt(totalNeto)}</td>
            <td><code>${r.venue_id ?? '—'}</code></td>
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
    const { disponibilidad, reservas, servicios } = todosLosDatos

    const listings = disponibilidad.filter(d => d.sfcom_status !== null)
    if (!listings.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--subtle)">No hay publicaciones en sfcom</td></tr>'
        return
    }

    tbody.innerHTML = listings.map(d => {
        const svc = servicios[d.service_id]

        // Todas las reservas activas para este par (sfcom y propias)
        const resSfcom  = reservas.filter(r => r.venue_id === d.venue_id && r.service_id === d.service_id && r.origin_ref?.startsWith('WEB') && r.status !== 'Cancelada')
        const resPropia = reservas.filter(r => r.venue_id === d.venue_id && r.service_id === d.service_id && !r.origin_ref?.startsWith('WEB') && r.status !== 'Cancelada')
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
        const eventoLabel = svc?.event_type
            ? svc.event_type.charAt(0).toUpperCase() + svc.event_type.slice(1).replace(/_/g, ' ')
            : d.service_code ?? '—'
        const svcLabel = svc ? `${eventoLabel} ${svc.day ?? ''}`.trim() : (d.service_code ?? '—')

        return `<tr>
            <td>${d.sfcom_service_name || '—'}</td>
            <td>${svcLabel}</td>
            <td><code>${d.venue_id ?? '—'}</code></td>
            <td><span class="sfcom-badge sfcom-badge--${d.sfcom_status === 'confirmed' ? 'confirmed' : d.sfcom_status === 'pending' ? 'pending' : 'deactivation'}">${estadoInfo.label}</span></td>
            <td style="text-align:center">${listedSlots}</td>
            <td style="text-align:center">${slotsSfcom}</td>
            <td style="text-align:center">${slotsPropios}</td>
            <td style="text-align:center;font-weight:600">${stockEsperado}</td>
            <td class="td-stock-real" data-sfkey="${sfKey}" data-venue="${d.venue_id}" data-service="${d.service_id}" style="text-align:center">${stockRealTxt}</td>
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

// ─── Verificación ─────────────────────────────────────────────────────────────

async function _ejecutarVerificacionPanel(modoManual) {
    const resultado = await ejecutarVerificacion(supabase, {
        modoManual,
        incluirSfcom:      true,
        incluirFinanciero: modoManual
    })
    if (resultado?.sfcom) {
        actualizarStockDesdeVerificacion(resultado)
        const statusEl = document.getElementById('txt-sfcom-fetch-status')
        if (statusEl) statusEl.textContent = resultado.sfcom.verificado ? '' : '⚠️ No se pudo consultar el stock real de sfcom. Los datos pueden estar desactualizados.'
    }
    return resultado
}

function actualizarStockDesdeVerificacion(resultado) {
    if (!resultado?.sfcom) return
    const confirmados = todosLosDatos.disponibilidad.filter(d => d.sfcom_status === 'confirmed')
    const fallos  = new Set((resultado.sfcom.fallos ?? []).map(f => `${f.venueId}|${f.serviceId}`))
    const discMap = new Map((resultado.sfcom.discrepancias ?? []).map(d => [`${d.venueId}|${d.serviceId}`, d.stockSfcom]))

    confirmados.forEach(d => {
        const pairKey = `${d.venue_id}|${d.service_id}`
        const sfKey   = `${d.sfcom_product_id}_${d.sfcom_variation_id ?? 'null'}`
        if (fallos.has(pairKey)) return

        if (discMap.has(pairKey)) {
            stockSfcom.set(sfKey, discMap.get(pairKey))
        } else {
            // sin discrepancia → stockReal === stockEsperado, calculamos igual que renderListings
            const { reservas } = todosLosDatos
            const slotsSfcom   = reservas.filter(r => r.venue_id === d.venue_id && r.service_id === d.service_id && r.origin_ref?.startsWith('WEB') && r.status !== 'Cancelada').reduce((s, r) => s + r.slots, 0)
            const slotsTotales = reservas.filter(r => r.venue_id === d.venue_id && r.service_id === d.service_id && r.status !== 'Cancelada').reduce((s, r) => s + r.slots, 0)
            stockSfcom.set(sfKey, Math.max(0, Math.min(
                (d.sfcom_slots_listed ?? 0) - slotsSfcom,
                d.total_slots - slotsTotales
            )))
        }
    })

    // Marcar como '?' las celdas de pares que fallaron
    document.querySelectorAll('.td-stock-real[data-venue]').forEach(td => {
        const pairKey = `${td.dataset.venue}|${td.dataset.service}`
        if (fallos.has(pairKey) && td.textContent === '…') {
            td.textContent = '?'
            td.style.color = 'var(--accent-warn)'
        }
    })

    actualizarColumnaStockReal()
}

// ─── Listeners ────────────────────────────────────────────────────────────────

document.getElementById('btnExportListings')?.addEventListener('click', () => {
    const { disponibilidad, reservas } = todosLosDatos
    const listings = disponibilidad.filter(d => d.sfcom_status !== null)
    const rows = listings.map(d => {
        const resSfcom  = reservas.filter(r => r.venue_id === d.venue_id && r.service_id === d.service_id && r.origin_ref?.startsWith('WEB')  && r.status !== 'Cancelada').reduce((s, r) => s + r.slots, 0)
        const resPropia = reservas.filter(r => r.venue_id === d.venue_id && r.service_id === d.service_id && !r.origin_ref?.startsWith('WEB') && r.status !== 'Cancelada').reduce((s, r) => s + r.slots, 0)
        const esperado  = Math.max(0, Math.min(
            (d.sfcom_slots_listed ?? 0) - resSfcom,
            d.total_slots - resSfcom - resPropia
        ))
        return { ...d, _resSfcom: resSfcom, _resPropia: resPropia, _esperado: esperado }
    })
    exportTable(rows, [
        { key: 'sfcom_service_name', label: 'Producto sfcom' },
        { key: 'service_code',        label: 'Servicio' },
        { key: 'venue_id',           label: 'Venue' },
        { key: 'sfcom_status',       label: 'Estado',
          fmt: v => v === 'confirmed' ? 'Activo' : v === 'pending' ? 'Pendiente alta' : v === 'deactivation_pending' ? 'Pendiente baja' : v ?? '—' },
        { key: 'sfcom_slots_listed', label: 'Plazas listadas' },
        { key: '_resSfcom',          label: 'Reservadas sfcom' },
        { key: '_resPropia',         label: 'Reservadas propias' },
        { key: '_esperado',          label: 'Stock esperado' },
    ], 'listings_sfcom.xlsx')
})

document.getElementById('btnExportReservasSfcom')?.addEventListener('click', () => {
    const sfcom = todosLosDatos.reservas.filter(r => r.origin_ref?.startsWith('WEB'))
    exportTable(sfcom, [
        { key: 'origin_ref', label: 'Referencia sfcom' },
        { key: 'id',              label: 'ID reserva' },
        { key: 'client_id',       label: 'Cliente' },
        { key: 'service_id', label: 'Servicio', fmt: v => todosLosDatos.servicios[v]?.service_code ?? String(v) },
        { key: 'venue_id',        label: 'Venue' },
        { key: 'slots',           label: 'Plazas' },
        { key: 'price_per_slot',  label: 'Precio neto/plaza', fmt: v => fmt(v) },
        { key: 'total_amount',    label: 'Total neto',        fmt: v => fmt(v) },
        { key: 'status',          label: 'Estado' },
    ], 'reservas_sfcom.xlsx')
})

document.getElementById('btnVerificarDatos').addEventListener('click', () => {
    _ejecutarVerificacionPanel(true).catch(e => console.error('[sfcom-panel] verificacion:', e))
})

document.getElementById('btnActualizarSfcom').addEventListener('click', () => {
    _ejecutarVerificacionPanel(false).catch(e => console.error('[sfcom-panel] verificacion:', e))
})

// ─── Arranque ─────────────────────────────────────────────────────────────────

cargarDatos().then(() => {
    _ejecutarVerificacionPanel(false).catch(e => console.error('[sfcom-panel] verificacion inicial:', e))
})
