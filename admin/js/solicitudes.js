import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar } from './utils.js'
import { initAsistente, abrirAsistenteRespuesta, abrirProcesarEmail } from './asistente.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

// ===== DATOS GLOBALES =====
const { data: disponibilidad } = await supabase.from('availability_with_sfcom').select('*')
let todasReservas = (await supabase.from('reservations').select('*')).data

function _esSfcom(source) {
    return source && /^WEB\d+_\d+$/.test(source)
}

initAsistente(supabase, {
    getDisponibilidad: () => disponibilidad,
    getTodasReservas:  () => todasReservas,
    onEmailSaved:      cargarSolicitudes,
    esSfcom:           _esSfcom
})

let solicitudActual = null
let notesTimer      = null

const CONV_STATUS_LABELS = {
    nueva:              'Nueva',
    en_conversacion:    'En conversación',
    propuesta_enviada:  'Propuesta enviada',
    esperando_cliente:  'Esperando cliente',
}

// ===== CARGA Y RENDER DE LISTA =====

async function cargarSolicitudes() {
    const { data, error } = await supabase
        .from('reservation_requests')
        .select('*')
        .or('conversation_status.is.null,conversation_status.neq.cerrada')
        .order('updated_at', { ascending: false, nullsFirst: false })

    if (error) { console.error('Error cargando solicitudes:', error); return }

    _solicitudesActuales = data ?? []
    renderLista(_solicitudesActuales)

    // Si había una solicitud seleccionada, refrescar su detalle
    if (solicitudActual) {
        const actualizada = _solicitudesActuales.find(s => s.id === solicitudActual.id)
        if (actualizada) mostrarDetalle(actualizada)
    }
}

let _solicitudesActuales = []

function renderLista(solicitudes) {
    const lista = document.getElementById('sol-lista')

    if (!solicitudes.length) {
        lista.innerHTML = '<div class="sol-empty">No hay solicitudes activas.</div>'
        return
    }

    lista.innerHTML = solicitudes.map(s => {
        const esSfcom = _esSfcom(s.source)
        const esEmail = s.source === 'email'

        const fecha = s.created_at
            ? new Date(s.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
            : '—'

        const convStatus = s.conversation_status || 'nueva'
        const badgeLabel = CONV_STATUS_LABELS[convStatus] || convStatus

        const origenBadge = esSfcom
            ? `<span class="sol-badge sol-badge--sfcom">sfcom</span>`
            : esEmail
            ? `<span class="sol-badge sol-badge--email">email</span>`
            : ''

        const experiencia = s.level || s.service_id || '—'
        const notasPreview = s.conversation_notes
            ? `<div class="sol-item-notes">${s.conversation_notes.slice(0, 64)}${s.conversation_notes.length > 64 ? '…' : ''}</div>`
            : ''

        const esActiva = solicitudActual?.id === s.id

        return `<div class="sol-item${esActiva ? ' active' : ''}" data-id="${s.id}">
            <div class="sol-item-header">
                <span class="sol-item-nombre">${s.client_name || '—'}</span>
                <span class="sol-item-fecha">${fecha}</span>
            </div>
            <div class="sol-item-meta">
                ${origenBadge}
                <span class="sol-badge sol-badge--${convStatus}">${badgeLabel}</span>
                <span class="sol-item-exp">${experiencia}</span>
            </div>
            ${notasPreview}
        </div>`
    }).join('')

    lista.querySelectorAll('.sol-item').forEach(el => {
        el.addEventListener('click', () => {
            const sol = _solicitudesActuales.find(s => String(s.id) === el.dataset.id)
            if (sol) mostrarDetalle(sol)
        })
    })
}

// ===== DETALLE DE SOLICITUD =====

function mostrarDetalle(sol) {
    solicitudActual = sol

    document.querySelectorAll('.sol-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === String(sol.id))
    })

    const detalle    = document.getElementById('sol-detalle')
    const esSfcom    = _esSfcom(sol.source)
    const esEmail    = sol.source === 'email'
    const convStatus = sol.conversation_status || 'nueva'

    const contactoTel = sol.client_phone
        ? `<a href="tel:${sol.client_phone}">${sol.client_phone}</a>`
        : null
    const contactoEmail = sol.client_email
        ? `<a href="mailto:${sol.client_email}">${sol.client_email}</a>`
        : null
    const contactoHTML = [contactoTel, contactoEmail].filter(Boolean).join(' · ') || '—'

    // Venues disponibles para el service_id de la solicitud
    const serviceId  = sol.service_id
    const venuesDisp = serviceId
        ? disponibilidad
            .filter(d => d.service_id === serviceId)
            .map(d => {
                const ocupadas = (todasReservas || [])
                    .filter(r => r.venue_id === d.venue_id && r.service_id === serviceId && r.status !== 'Cancelada')
                    .reduce((s, r) => s + (r.slots || 0), 0)
                const libres = Math.max(0, d.total_slots - ocupadas)
                const nombre = d.venue_display_name || d.venue_id
                return { id: d.venue_id, nombre, libres, total: d.total_slots }
            })
        : []

    const venueOptions = venuesDisp.map(v =>
        `<option value="${v.id}"${sol.assigned_venue_id === v.id ? ' selected' : ''}>${v.nombre} (${v.libres}/${v.total} libres)</option>`
    ).join('')

    const estadoOptions = Object.entries(CONV_STATUS_LABELS).map(([v, l]) =>
        `<option value="${v}"${convStatus === v ? ' selected' : ''}>${l}</option>`
    ).join('')

    // Precio de referencia para el servicio
    const precioRef = serviceId ? _calcularPrecioRef(serviceId) : null

    // URL para "Convertir en reserva"
    const params = new URLSearchParams()
    if (sol.client_name)       params.set('client_name',  sol.client_name)
    if (sol.client_email)      params.set('client_email', sol.client_email)
    if (sol.client_phone)      params.set('client_phone', sol.client_phone)
    if (sol.service_id)        params.set('service_id',   sol.service_id)
    if (sol.day)               params.set('day',          sol.day)
    if (sol.slots)             params.set('slots',        sol.slots)
    if (sol.assigned_venue_id) params.set('venue_id',     sol.assigned_venue_id)
    const urlReserva = `formulario.html?${params.toString()}`

    const origenLabel = esSfcom ? '· <strong style="color:#dc2626">sfcom</strong>'
                      : esEmail ? '· email'
                      : '· web'

    const fechaCompleta = sol.created_at
        ? new Date(sol.created_at).toLocaleString('es-ES', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })
        : '—'

    detalle.innerHTML = `
        <div class="sol-detalle-inner">

            <div class="sol-detalle-header">
                <div style="min-width:0">
                    <div class="sol-detalle-nombre">${sol.client_name || '—'}</div>
                    <div class="sol-detalle-contacto">${contactoHTML}</div>
                    <div style="font-size:11px;color:var(--subtle);margin-top:3px">
                        ${fechaCompleta} ${origenLabel}
                    </div>
                </div>
                <div style="display:flex;align-items:flex-start;gap:8px;flex-shrink:0">
                    <select id="sol-select-estado" class="sol-estado-select">
                        ${estadoOptions}
                    </select>
                    <button class="btn-cerrar-detalle" id="btnCerrarDetalle" title="Cerrar">✕</button>
                </div>
            </div>

            <div class="sol-detalle-datos">
                <div class="sol-dato">
                    <span class="sol-dato-label">Experiencia</span>
                    <span class="sol-dato-valor">${sol.level || sol.service_id || '—'}</span>
                </div>
                <div class="sol-dato">
                    <span class="sol-dato-label">Día</span>
                    <span class="sol-dato-valor">${sol.day ? sol.day + ' julio' : '—'}</span>
                </div>
                <div class="sol-dato">
                    <span class="sol-dato-label">Personas</span>
                    <span class="sol-dato-valor">${sol.slots || '—'}</span>
                </div>
                ${precioRef ? `<div class="sol-dato"><span class="sol-dato-label">Precio ref.</span><span class="sol-dato-valor">${precioRef}</span></div>` : ''}
                ${sol.comments ? `
                <div class="sol-dato sol-dato--full">
                    <span class="sol-dato-label">Consulta</span>
                    <span class="sol-dato-valor">${sol.comments}</span>
                </div>` : ''}
            </div>

            ${venuesDisp.length > 0 ? `
            <div class="form-field" style="margin-bottom:16px">
                <label>Venue asignado</label>
                <select id="sol-select-venue">
                    <option value="">— Sin asignar —</option>
                    ${venueOptions}
                </select>
            </div>` : ''}

            <div class="form-field" style="margin-bottom:4px">
                <label>
                    Notas internas
                    <span style="font-weight:400;text-transform:none;letter-spacing:0;color:#999"> — solo las ve el equipo</span>
                </label>
                <textarea id="sol-notas" rows="5"
                    placeholder="Anotaciones, seguimiento, información relevante…"
                    style="resize:vertical;min-height:120px">${sol.conversation_notes || ''}</textarea>
            </div>
            <div id="sol-notas-status" style="font-size:11px;color:var(--subtle);margin-bottom:16px;min-height:14px"></div>

            <div class="sol-acciones">
                <button class="btn btn-primary" id="btnAbrirAsistente" style="min-height:44px">💬 Abrir asistente</button>
                <a class="btn btn-secondary" href="${urlReserva}" style="text-decoration:none;display:inline-flex;align-items:center">📋 Convertir en reserva</a>
                <button class="btn btn-danger" id="btnCerrarSolicitud">✅ Cerrar solicitud</button>
            </div>

        </div>
    `

    // Mostrar bottom sheet en móvil
    detalle.classList.add('visible')

    // ── Estado ──────────────────────────────────────────────────────────────
    document.getElementById('sol-select-estado').addEventListener('change', async e => {
        const nuevoEstado = e.target.value
        const { error } = await supabase
            .from('reservation_requests')
            .update({ conversation_status: nuevoEstado })
            .eq('id', sol.id)
        if (error) { console.error('Error actualizando estado:', error); return }
        sol.conversation_status = nuevoEstado

        // Actualizar badge en lista sin re-renderizar todo
        const badgeEl = document.querySelector(`.sol-item[data-id="${sol.id}"] .sol-badge:not(.sol-badge--sfcom):not(.sol-badge--email)`)
        if (badgeEl) {
            badgeEl.className = `sol-badge sol-badge--${nuevoEstado}`
            badgeEl.textContent = CONV_STATUS_LABELS[nuevoEstado] || nuevoEstado
        }
    })

    // ── Venue asignado ───────────────────────────────────────────────────────
    const selectVenue = document.getElementById('sol-select-venue')
    if (selectVenue) {
        selectVenue.addEventListener('change', async e => {
            const venueId = e.target.value || null
            const { error } = await supabase
                .from('reservation_requests')
                .update({ assigned_venue_id: venueId })
                .eq('id', sol.id)
            if (error) console.error('Error actualizando venue asignado:', error)
            else sol.assigned_venue_id = venueId
        })
    }

    // ── Notas con debounce ───────────────────────────────────────────────────
    const notasEl     = document.getElementById('sol-notas')
    const notasStatus = document.getElementById('sol-notas-status')
    notasEl.addEventListener('input', () => {
        clearTimeout(notesTimer)
        notasStatus.textContent = 'Guardando…'
        notesTimer = setTimeout(async () => {
            const { error } = await supabase
                .from('reservation_requests')
                .update({ conversation_notes: notasEl.value.trim() || null })
                .eq('id', sol.id)
            if (error) {
                notasStatus.textContent = '❌ Error al guardar'
                console.error(error)
            } else {
                sol.conversation_notes = notasEl.value.trim() || null
                // Actualizar preview en lista
                const notasPreviewEl = document.querySelector(`.sol-item[data-id="${sol.id}"] .sol-item-notes`)
                const texto = sol.conversation_notes
                if (texto) {
                    if (notasPreviewEl) {
                        notasPreviewEl.textContent = texto.slice(0, 64) + (texto.length > 64 ? '…' : '')
                    } else {
                        const item = document.querySelector(`.sol-item[data-id="${sol.id}"]`)
                        if (item) {
                            const div = document.createElement('div')
                            div.className = 'sol-item-notes'
                            div.textContent = texto.slice(0, 64) + (texto.length > 64 ? '…' : '')
                            item.appendChild(div)
                        }
                    }
                } else if (notasPreviewEl) {
                    notasPreviewEl.remove()
                }
                notasStatus.textContent = '✓ Guardado'
                setTimeout(() => { notasStatus.textContent = '' }, 2000)
            }
        }, 1500)
    })

    // ── Abrir asistente ──────────────────────────────────────────────────────
    document.getElementById('btnAbrirAsistente').addEventListener('click', () => {
        abrirAsistenteRespuesta(sol)
    })

    // ── Cerrar solicitud ─────────────────────────────────────────────────────
    document.getElementById('btnCerrarSolicitud').addEventListener('click', async () => {
        if (!confirm('¿Cerrar esta solicitud? Se ocultará de la lista activa.')) return
        const { error } = await supabase
            .from('reservation_requests')
            .update({ conversation_status: 'cerrada' })
            .eq('id', sol.id)
        if (error) { alert('Error al cerrar: ' + error.message); return }
        detalle.classList.remove('visible')
        solicitudActual = null
        detalle.innerHTML = '<div class="sol-detalle-placeholder">Selecciona una solicitud para ver el detalle</div>'
        await cargarSolicitudes()
    })

    // ── Cerrar detalle (móvil) ───────────────────────────────────────────────
    document.getElementById('btnCerrarDetalle').addEventListener('click', () => {
        detalle.classList.remove('visible')
        document.querySelectorAll('.sol-item').forEach(el => el.classList.remove('active'))
        solicitudActual = null
    })
}

// Calcula el rango de precios de reservas activas para un servicio
function _calcularPrecioRef(serviceId) {
    const precios = (todasReservas || [])
        .filter(r => r.service_id === serviceId && ['Confirmada', 'Pendiente'].includes(r.status))
        .map(r => parseFloat(r.price_per_slot))
        .filter(p => p > 0)
    if (!precios.length) return null
    const min = Math.min(...precios)
    const max = Math.max(...precios)
    return min === max ? `${min}€/plaza` : `${min}–${max}€/plaza`
}

// ===== INICIALIZACIÓN =====

document.getElementById('btnProcesarEmail').addEventListener('click', abrirProcesarEmail)

await cargarSolicitudes()
