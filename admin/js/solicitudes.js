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
    esSfcom:           _esSfcom,
    onRespuestaUsada:  _onRespuestaUsadaEnLog
})

let solicitudActual = null

const CONV_STATUS_LABELS = {
    nueva:                 'Nueva',
    en_conversacion:       'En conversación',
    respuesta_enviada:     'Respuesta enviada',
    seguimiento_pendiente: 'Seguimiento pendiente',
}

// ===== LOG DE CONVERSACIÓN — HELPERS =====

function _fechaLog() {
    const d  = new Date()
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yy = String(d.getFullYear()).slice(-2)
    return `${dd}/${mm}/${yy}`
}

function _parsearLog(texto) {
    if (!texto?.trim()) return []
    const lines = texto.split('\n')
    const items = []
    let currentDate   = null
    let currentAuthor = null
    let currentLines  = []
    let msgIndex      = 0

    const flushMsg = () => {
        if (currentAuthor === null) return
        const text = currentLines.join('\n').trim()
        if (text) items.push({ type: 'message', author: currentAuthor, text, date: currentDate, index: msgIndex++ })
        currentAuthor = null
        currentLines  = []
    }

    for (const line of lines) {
        const dateMatch   = line.match(/^---(\d{2}\/\d{2}\/\d{2})---$/)
        const authorMatch = line.match(/^<(Paula|Cliente)>$/)
        if (dateMatch) {
            flushMsg()
            currentDate = dateMatch[1]
            items.push({ type: 'date', label: currentDate })
        } else if (authorMatch) {
            flushMsg()
            currentAuthor = authorMatch[1]
        } else if (currentAuthor !== null) {
            currentLines.push(line)
        }
    }
    flushMsg()
    return items
}

function _reconstruirLog(items) {
    const parts = []
    for (const item of items) {
        if (item.type === 'date') {
            parts.push(`---${item.label}---`)
        } else {
            parts.push(`<${item.author}>`)
            parts.push(item.text)
            parts.push('')
        }
    }
    while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
    return parts.join('\n')
}

function _renderizarLog(items) {
    const hoy = _fechaLog()
    if (!items.length) return '<div class="sol-log-empty">Sin mensajes aún.</div>'
    return items.map(item => {
        if (item.type === 'date') {
            return `<div class="sol-log-date">${item.label}</div>`
        }
        const isPaula = item.author === 'Paula'
        const isToday = item.date === hoy
        const esc     = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const editBtn = isToday
            ? `<button class="sol-log-edit" data-index="${item.index}" title="Editar">✏️</button>`
            : ''
        return `<div class="sol-log-msg${isPaula ? ' sol-log-msg--paula' : ' sol-log-msg--cliente'}">
            <div class="sol-log-bubble">${esc(item.text).replace(/\n/g, '<br>')}</div>
            ${editBtn}
        </div>`
    }).join('')
}

async function _insertarMensaje(sol, autor, texto) {
    const fecha = _fechaLog()
    const items = _parsearLog(sol.conversation_notes)

    const tieneFechaHoy = items.some(i => i.type === 'date' && i.label === fecha)
    if (!tieneFechaHoy) items.push({ type: 'date', label: fecha })
    items.push({ type: 'message', author: autor, text: texto, date: fecha, index: -1 })

    const nuevoLog = _reconstruirLog(items)
    const { error } = await supabase
        .from('reservation_requests')
        .update({ conversation_notes: nuevoLog })
        .eq('id', sol.id)
    if (error) { console.error(error); return false }

    sol.conversation_notes = nuevoLog
    const idx = _solicitudesActuales.findIndex(s => s.id === sol.id)
    if (idx !== -1) _solicitudesActuales[idx].conversation_notes = nuevoLog
    return true
}

function _initEditListeners(sol, container) {
    container.querySelectorAll('.sol-log-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const msgIdx = parseInt(btn.dataset.index)
            const msgEl  = btn.closest('.sol-log-msg')

            const ta = document.createElement('textarea')
            ta.style.cssText = 'width:100%;box-sizing:border-box;font-size:13px;padding:6px;border:1px solid var(--border);border-radius:4px;resize:vertical'
            ta.rows  = 3
            ta.value = msgEl.querySelector('.sol-log-bubble').innerText

            const saveBtn   = document.createElement('button')
            saveBtn.className   = 'btn btn-primary'
            saveBtn.textContent = 'Guardar'
            saveBtn.style.cssText = 'font-size:11px;padding:4px 10px;margin-top:4px'

            const cancelBtn = document.createElement('button')
            cancelBtn.className   = 'btn btn-secondary'
            cancelBtn.textContent = 'Cancelar'
            cancelBtn.style.cssText = 'font-size:11px;padding:4px 10px;margin-top:4px;margin-left:6px'

            const btnRow = document.createElement('div')
            btnRow.append(saveBtn, cancelBtn)
            msgEl.innerHTML = ''
            msgEl.append(ta, btnRow)
            ta.focus()

            cancelBtn.addEventListener('click', () => {
                container.innerHTML = _renderizarLog(_parsearLog(sol.conversation_notes))
                _initEditListeners(sol, container)
            })

            saveBtn.addEventListener('click', async () => {
                const nuevoTexto = ta.value.trim()
                if (!nuevoTexto) return
                const items   = _parsearLog(sol.conversation_notes)
                const msgItem = items.filter(i => i.type === 'message')[msgIdx]
                if (!msgItem) return
                msgItem.text = nuevoTexto
                const nuevoLog = _reconstruirLog(items)
                const { error } = await supabase
                    .from('reservation_requests')
                    .update({ conversation_notes: nuevoLog })
                    .eq('id', sol.id)
                if (error) { console.error(error); return }
                sol.conversation_notes = nuevoLog
                const idx = _solicitudesActuales.findIndex(s => s.id === sol.id)
                if (idx !== -1) _solicitudesActuales[idx].conversation_notes = nuevoLog
                container.innerHTML = _renderizarLog(_parsearLog(sol.conversation_notes))
                _initEditListeners(sol, container)
                _actualizarPreviewLista(sol)
            })
        })
    })
}

function _actualizarPreviewLista(sol) {
    const itemEl = document.querySelector(`.sol-item[data-id="${sol.id}"]`)
    if (!itemEl) return
    const msgs   = _parsearLog(sol.conversation_notes).filter(i => i.type === 'message')
    const ultimo = msgs[msgs.length - 1]
    const previewEl = itemEl.querySelector('.sol-item-notes')
    if (ultimo) {
        const full  = `${ultimo.author}: ${ultimo.text}`
        const texto = full.slice(0, 64) + (full.length > 64 ? '…' : '')
        if (previewEl) {
            previewEl.textContent = texto
        } else {
            const div = document.createElement('div')
            div.className   = 'sol-item-notes'
            div.textContent = texto
            itemEl.appendChild(div)
        }
    } else if (previewEl) {
        previewEl.remove()
    }
}

async function _onRespuestaUsadaEnLog(texto, solicitud) {
    const ok = await _insertarMensaje(solicitud, 'Paula', texto)
    if (!ok) return

    const { error } = await supabase
        .from('reservation_requests')
        .update({ conversation_status: 'respuesta_enviada' })
        .eq('id', solicitud.id)
    if (!error) {
        solicitud.conversation_status = 'respuesta_enviada'
        const idx = _solicitudesActuales.findIndex(s => s.id === solicitud.id)
        if (idx !== -1) _solicitudesActuales[idx].conversation_status = 'respuesta_enviada'
    }

    if (solicitudActual?.id === solicitud.id) {
        const logArea = document.getElementById('sol-log-area')
        if (logArea) {
            logArea.innerHTML = _renderizarLog(_parsearLog(solicitud.conversation_notes))
            _initEditListeners(solicitud, logArea)
            setTimeout(() => { logArea.scrollTop = logArea.scrollHeight }, 50)
        }
        const badgeEl = document.querySelector(`.sol-item[data-id="${solicitud.id}"] .sol-badge:not(.sol-badge--sfcom):not(.sol-badge--email)`)
        if (badgeEl) {
            badgeEl.className   = 'sol-badge sol-badge--respuesta_enviada'
            badgeEl.textContent = CONV_STATUS_LABELS.respuesta_enviada
        }
        const selectEstado = document.getElementById('sol-select-estado')
        if (selectEstado) selectEstado.value = 'respuesta_enviada'
        document.getElementById('btnEnviarRecordatorio')?.remove()
    }
    _actualizarPreviewLista(solicitud)
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
    await _verificarTransicionesAutomaticas()
    renderLista(_solicitudesActuales)

    if (solicitudActual) {
        const actualizada = _solicitudesActuales.find(s => s.id === solicitudActual.id)
        if (actualizada) mostrarDetalle(actualizada)
    }
}

let _solicitudesActuales = []

async function _verificarTransicionesAutomaticas() {
    const limite3dias = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    const caducadas   = _solicitudesActuales.filter(s =>
        s.conversation_status === 'respuesta_enviada' &&
        s.updated_at && new Date(s.updated_at) < limite3dias
    )
    if (!caducadas.length) return

    await Promise.all(caducadas.map(s =>
        supabase.from('reservation_requests')
            .update({ conversation_status: 'seguimiento_pendiente' })
            .eq('id', s.id)
    ))
    caducadas.forEach(s => { s.conversation_status = 'seguimiento_pendiente' })
}

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

        // Preview: último mensaje del log
        const notasPreview = (() => {
            if (!s.conversation_notes) return ''
            const msgs   = _parsearLog(s.conversation_notes).filter(i => i.type === 'message')
            const ultimo = msgs[msgs.length - 1]
            const full   = ultimo ? `${ultimo.author}: ${ultimo.text}` : s.conversation_notes
            return `<div class="sol-item-notes">${full.slice(0, 64)}${full.length > 64 ? '…' : ''}</div>`
        })()

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

    const precioRef = serviceId ? _calcularPrecioRef(serviceId) : null

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

    const logItems = _parsearLog(sol.conversation_notes)

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

            ${convStatus === 'seguimiento_pendiente' ? `
            <div style="margin-bottom:16px">
                <button class="btn btn-primary" id="btnEnviarRecordatorio" style="width:100%;min-height:44px">📩 Enviar recordatorio</button>
            </div>` : ''}

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

            <div class="sol-log-section">
                <span class="sol-log-label">
                    Log de conversación
                    <span style="font-weight:400;text-transform:none;letter-spacing:0;color:#999"> — solo lo ve el equipo</span>
                </span>
                <div id="sol-log-area" class="sol-log-area">
                    ${_renderizarLog(logItems)}
                </div>
                <div id="sol-log-input" style="display:none;margin-top:8px">
                    <textarea id="sol-log-texto" rows="3"
                        style="width:100%;box-sizing:border-box;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:6px;resize:vertical"
                        placeholder="Escribe el mensaje…"></textarea>
                    <div style="display:flex;gap:8px;margin-top:6px">
                        <button class="btn btn-primary" id="sol-log-guardar" style="font-size:12px;padding:6px 12px">Guardar</button>
                        <button class="btn btn-secondary" id="sol-log-cancelar" style="font-size:12px;padding:6px 12px">Cancelar</button>
                    </div>
                </div>
                <div id="sol-log-status" style="font-size:11px;color:var(--subtle);min-height:14px;margin-top:4px"></div>
                <div style="display:flex;gap:8px;margin-top:8px">
                    <button class="btn btn-secondary" id="sol-log-btn-paula" style="font-size:12px;min-height:36px">＋ Mi mensaje</button>
                    <button class="btn btn-secondary" id="sol-log-btn-cliente" style="font-size:12px;min-height:36px">＋ Mensaje del cliente</button>
                </div>
            </div>

            <div class="sol-acciones">
                <button class="btn btn-primary" id="btnAbrirAsistente" style="min-height:44px">💬 Abrir asistente</button>
                <a class="btn btn-secondary" href="${urlReserva}" style="text-decoration:none;display:inline-flex;align-items:center">📋 Convertir en reserva</a>
                <button class="btn btn-danger" id="btnCerrarSolicitud">✅ Cerrar solicitud</button>
            </div>

        </div>
    `

    detalle.classList.add('visible')

    // Scroll log al final tras render
    const logArea = document.getElementById('sol-log-area')
    setTimeout(() => { logArea.scrollTop = logArea.scrollHeight }, 0)
    _initEditListeners(sol, logArea)

    // ── Estado ──────────────────────────────────────────────────────────────
    document.getElementById('sol-select-estado').addEventListener('change', async e => {
        const nuevoEstado = e.target.value
        const { error } = await supabase
            .from('reservation_requests')
            .update({ conversation_status: nuevoEstado })
            .eq('id', sol.id)
        if (error) { console.error('Error actualizando estado:', error); return }
        sol.conversation_status = nuevoEstado

        const badgeEl = document.querySelector(`.sol-item[data-id="${sol.id}"] .sol-badge:not(.sol-badge--sfcom):not(.sol-badge--email)`)
        if (badgeEl) {
            badgeEl.className   = `sol-badge sol-badge--${nuevoEstado}`
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

    // ── Log de conversación ──────────────────────────────────────────────────
    const logInput  = document.getElementById('sol-log-input')
    const logTexto  = document.getElementById('sol-log-texto')
    const logStatus = document.getElementById('sol-log-status')
    let _logAutor   = null

    document.getElementById('sol-log-btn-paula').addEventListener('click', () => {
        _logAutor      = 'Paula'
        logTexto.value = ''
        logInput.style.display = 'block'
        logTexto.focus()
    })
    document.getElementById('sol-log-btn-cliente').addEventListener('click', () => {
        _logAutor      = 'Cliente'
        logTexto.value = ''
        logInput.style.display = 'block'
        logTexto.focus()
    })
    document.getElementById('sol-log-cancelar').addEventListener('click', () => {
        logInput.style.display = 'none'
        _logAutor = null
    })
    document.getElementById('sol-log-guardar').addEventListener('click', async () => {
        const texto = logTexto.value.trim()
        if (!texto || !_logAutor) return
        logStatus.textContent = 'Guardando…'
        const ok = await _insertarMensaje(sol, _logAutor, texto)
        if (ok) {
            logArea.innerHTML = _renderizarLog(_parsearLog(sol.conversation_notes))
            _initEditListeners(sol, logArea)
            setTimeout(() => { logArea.scrollTop = logArea.scrollHeight }, 50)
            _actualizarPreviewLista(sol)
            logInput.style.display = 'none'
            _logAutor = null
            logStatus.textContent = ''
        } else {
            logStatus.textContent = '❌ Error al guardar'
        }
    })

    // ── Recordatorio ────────────────────────────────────────────────────────
    document.getElementById('btnEnviarRecordatorio')?.addEventListener('click', () => {
        abrirAsistenteRespuesta(sol, { modo: 'recordatorio' })
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
