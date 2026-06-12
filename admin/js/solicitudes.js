import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, buildCatalogUrl } from './utils.js'
import { mostrarToast } from './verificacion.js'
import { initAsistente, abrirAsistenteRespuesta, abrirProcesarEmail } from './asistente.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

// ===== DATOS GLOBALES =====
const { data: disponibilidad } = await supabase.from('availability_panel')
    .select('venue_id, service_id, total_slots, price_per_slot, billing_model, venue_display_name, venue_address, description, access_instructions, venue_slug, event_type')
let todasReservas = (await supabase.from('reservations').select('*')).data

function _esSfcom(source) {
    return source && /^WEB\d+_\d+$/.test(source)
}

initAsistente(supabase, {
    getDisponibilidad:     () => disponibilidad,
    getTodasReservas:      () => todasReservas,
    onEmailSaved:          cargarSolicitudes,
    esSfcom:               _esSfcom,
    onRespuestaUsada:      _onRespuestaUsadaEnLog,
    onBorradorActualizado: _onBorradorActualizado
})

let solicitudActual = null

const STATUS_LABELS = {
    nueva:                 'Nueva',
    en_conversacion:       'En conversación',
    respuesta_enviada:     'Respuesta enviada',
    seguimiento_pendiente: 'Seguimiento pendiente',
    convertida:            'Convertida',
    descartada:            'Descartada',
}

// Estados activos que pueden seleccionarse desde el desplegable (excluye cerrados)
const STATUS_ACTIVOS = ['nueva', 'en_conversacion', 'respuesta_enviada', 'seguimiento_pendiente']

const BATCH_CERRADAS = 15
let _solicitudesCerradas = []
let _cerradasOffset      = 0
let _hayMasCerradas      = false

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
        .update({ status: 'respuesta_enviada' })
        .eq('id', solicitud.id)
    if (!error) {
        solicitud.status = 'respuesta_enviada'
        const idx = _solicitudesActuales.findIndex(s => s.id === solicitud.id)
        if (idx !== -1) _solicitudesActuales[idx].status = 'respuesta_enviada'
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
            badgeEl.textContent = STATUS_LABELS.respuesta_enviada
        }
        const selectEstado = document.getElementById('sol-select-estado')
        if (selectEstado) selectEstado.value = 'respuesta_enviada'
        document.getElementById('btnEnviarRecordatorio')?.remove()
    }
    _actualizarPreviewLista(solicitud)
}

async function _onBorradorActualizado(solicitudId, draft) {
    const { error } = await supabase
        .from('reservation_requests')
        .update({ proposal_draft: draft })
        .eq('id', solicitudId)
    if (error) { console.error('[borrador] Error guardando:', error); return }

    const sol = [..._solicitudesActuales, ..._solicitudesCerradas].find(s => s.id === solicitudId)
    if (sol) {
        sol.proposal_draft = draft
        if (solicitudActual?.id === solicitudId) {
            const container = document.getElementById('sol-borrador-container')
            if (container) _renderBorrador(sol, container)
        }
    }
}

// ===== CARGA Y RENDER DE LISTA =====

async function cargarSolicitudes() {
    const { data, error } = await supabase
        .from('reservation_requests')
        .select('*')
        .not('status', 'in', '("convertida","descartada")')
        .order('updated_at', { ascending: false, nullsFirst: false })

    if (error) { console.error('Error cargando solicitudes:', error); return }

    _solicitudesActuales = data ?? []
    await _verificarTransicionesAutomaticas()

    _cerradasOffset    = 0
    _solicitudesCerradas = []
    await _cargarCerradas()

    renderLista()

    if (solicitudActual) {
        const actualizada = _solicitudesActuales.find(s => s.id === solicitudActual.id)
            || _solicitudesCerradas.find(s => s.id === solicitudActual.id)
        if (actualizada) mostrarDetalle(actualizada)
    }
}

async function _cargarCerradas() {
    const { data } = await supabase
        .from('reservation_requests')
        .select('*')
        .in('status', ['convertida', 'descartada'])
        .order('updated_at', { ascending: false, nullsFirst: false })
        .range(_cerradasOffset, _cerradasOffset + BATCH_CERRADAS)

    const lote = data ?? []
    _hayMasCerradas = lote.length > BATCH_CERRADAS
    const paraAgregar = _hayMasCerradas ? lote.slice(0, BATCH_CERRADAS) : lote
    _solicitudesCerradas.push(...paraAgregar)
    _cerradasOffset += paraAgregar.length
}

let _solicitudesActuales = []

async function _verificarTransicionesAutomaticas() {
    const limite3dias = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    const caducadas   = _solicitudesActuales.filter(s =>
        s.status === 'respuesta_enviada' &&
        s.updated_at && new Date(s.updated_at) < limite3dias
    )
    if (!caducadas.length) return

    await Promise.all(caducadas.map(s =>
        supabase.from('reservation_requests')
            .update({ status: 'seguimiento_pendiente' })
            .eq('id', s.id)
    ))
    caducadas.forEach(s => { s.status = 'seguimiento_pendiente' })
}

function _renderItem(s, apagada = false) {
    const esSfcom    = _esSfcom(s.source)
    const esEmail    = s.source === 'email'
    const fecha      = s.created_at
        ? new Date(s.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
        : '—'
    const convStatus = s.status || 'nueva'
    const badgeLabel = STATUS_LABELS[convStatus] || convStatus
    const origenBadge = esSfcom
        ? `<span class="sol-badge sol-badge--sfcom">sfcom</span>`
        : esEmail ? `<span class="sol-badge sol-badge--email">email</span>` : ''
    const experiencia    = s.level || s.service_id || '—'
    const notasPreview   = (() => {
        if (!s.conversation_notes) return ''
        const msgs   = _parsearLog(s.conversation_notes).filter(i => i.type === 'message')
        const ultimo = msgs[msgs.length - 1]
        const full   = ultimo ? `${ultimo.author}: ${ultimo.text}` : s.conversation_notes
        return `<div class="sol-item-notes">${full.slice(0, 64)}${full.length > 64 ? '…' : ''}</div>`
    })()
    const esActiva = solicitudActual?.id === s.id
    const clases   = ['sol-item', apagada ? 'sol-item--apagada' : '', esActiva ? 'active' : ''].filter(Boolean).join(' ')
    return `<div class="${clases}" data-id="${s.id}">
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
}

function renderLista() {
    const lista    = document.getElementById('sol-lista')
    const activas  = _solicitudesActuales
    const cerradas = _solicitudesCerradas

    if (!activas.length && !cerradas.length) {
        lista.innerHTML = '<div class="sol-empty">No hay solicitudes.</div>'
        return
    }

    let html = activas.length
        ? activas.map(s => _renderItem(s, false)).join('')
        : '<div class="sol-empty">No hay solicitudes activas.</div>'

    if (cerradas.length) {
        html += `<div class="sol-sep">Cerradas</div>`
        html += cerradas.map(s => _renderItem(s, true)).join('')
    }

    if (_hayMasCerradas) {
        html += `<div class="sol-cargar-mas"><button id="btnCargarMas">Cargar más</button></div>`
    }

    lista.innerHTML = html

    lista.querySelectorAll('.sol-item').forEach(el => {
        el.addEventListener('click', () => {
            const sol = [...activas, ...cerradas].find(s => String(s.id) === el.dataset.id)
            if (sol) mostrarDetalle(sol)
        })
    })

    document.getElementById('btnCargarMas')?.addEventListener('click', async () => {
        await _cargarCerradas()
        renderLista()
    })
}

// ===== BORRADOR DE PROPUESTA =====

function _serviciosUnicos() {
    const vistos = new Set()
    const lista  = []
    for (const d of (disponibilidad || [])) {
        if (!d.service_id || vistos.has(d.service_id)) continue
        vistos.add(d.service_id)
        const RE_DIA = /_(\d+)$/
        const diaNum = parseInt(d.service_id.match(RE_DIA)?.[1]) || null
        const etLabel = {
            encierro: 'Encierro', chupinazo: 'Chupinazo', procesion: 'Procesión',
            gigantes: 'Gigantes', pobre_de_mi: 'Pobre de Mí'
        }[d.event_type] || d.event_type || d.service_id
        const label = diaNum ? `${etLabel} - día ${diaNum}` : etLabel
        lista.push({ service_id: d.service_id, label, event_type: d.event_type, day: diaNum })
    }
    lista.sort((a, b) => {
        const order = ['chupinazo','procesion','encierro','gigantes','pobre_de_mi']
        const ai = order.indexOf(a.event_type), bi = order.indexOf(b.event_type)
        if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
        return (a.day || 0) - (b.day || 0)
    })
    return lista
}

function _venuesPorServicio(serviceId) {
    if (!serviceId) return []
    return (disponibilidad || [])
        .filter(d => d.service_id === serviceId)
        .map(d => {
            const ocupadas = (todasReservas || [])
                .filter(r => r.venue_id === d.venue_id && r.service_id === serviceId && r.status !== 'Cancelada')
                .reduce((s, r) => s + (r.slots || 0), 0)
            const libres = Math.max(0, d.total_slots - ocupadas)
            return {
                venue_id:           d.venue_id,
                venue_display_name: d.venue_display_name || d.venue_id,
                libres,
                total:              d.total_slots,
                catalogo_url:       d.venue_slug && d.event_type
                    ? `https://www.experienciasanfermin.com/catalogo/balcon.html?v=${d.venue_slug}&et=${d.event_type}`
                    : null
            }
        })
}

let _borradorTimer = null

async function _guardarBorrador(sol, draft) {
    sol.proposal_draft = draft
    const idx = _solicitudesActuales.findIndex(s => s.id === sol.id)
    if (idx !== -1) _solicitudesActuales[idx].proposal_draft = draft
    await supabase.from('reservation_requests').update({ proposal_draft: draft }).eq('id', sol.id)
}

function _debounceSave(sol, getDraft) {
    clearTimeout(_borradorTimer)
    const ind = document.getElementById('sol-borrador-saving')
    if (ind) ind.style.visibility = 'visible'
    _borradorTimer = setTimeout(async () => {
        await _guardarBorrador(sol, getDraft())
        if (ind) ind.style.visibility = 'hidden'
    }, 800)
}

function _renderBorrador(sol, container) {
    const servicios = _serviciosUnicos()
    const draft     = Array.isArray(sol.proposal_draft) ? [...sol.proposal_draft] : []

    const totalGeneral = draft.reduce((s, l) => s + ((l.slots || 0) * (l.price || 0)), 0)

    const serviceOpts = servicios.map(s =>
        `<option value="${s.service_id}">${s.label}</option>`
    ).join('')

    function filaHtml(linea, idx) {
        const venues    = linea.service_id ? _venuesPorServicio(linea.service_id) : []
        const venueOpts = venues.map(v => {
            const aviso = v.libres === 0 ? ' ⚠️' : ''
            return `<option value="${v.venue_id}"${linea.venue_id === v.venue_id ? ' selected' : ''}>${v.venue_display_name}${aviso} (${v.libres}/${v.total})</option>`
        }).join('')
        const total = (linea.slots || 0) * (linea.price || 0)
        const catalogoBtn = linea.catalogo_url
            ? `<a href="${linea.catalogo_url}" target="_blank" rel="noopener" style="color:var(--subtle);font-size:14px;text-decoration:none" title="Ver catálogo">🔗</a>`
            : `<span style="color:var(--border);font-size:14px">🔗</span>`

        return `<tr data-idx="${idx}">
            <td style="padding:0 2px">
                <button class="bor-up" data-idx="${idx}" style="background:none;border:none;cursor:pointer;font-size:11px;color:var(--subtle);padding:1px 3px" title="Subir">↑</button>
                <button class="bor-dn" data-idx="${idx}" style="background:none;border:none;cursor:pointer;font-size:11px;color:var(--subtle);padding:1px 3px" title="Bajar">↓</button>
            </td>
            <td style="padding:2px">
                <select class="bor-svc" data-idx="${idx}" style="font-size:12px;width:100%;min-height:36px">
                    <option value="">— Servicio —</option>
                    ${serviceOpts.replace(`value="${linea.service_id}"`, `value="${linea.service_id}" selected`)}
                </select>
            </td>
            <td style="padding:2px">
                <input class="bor-dia" data-idx="${idx}" type="number" min="6" max="14" value="${linea.day || ''}" placeholder="—" style="width:48px;font-size:12px;min-height:36px;padding:4px;border:1px solid var(--border);border-radius:4px">
            </td>
            <td style="padding:2px">
                <select class="bor-venue" data-idx="${idx}" style="font-size:12px;width:100%;min-height:36px"${!linea.service_id ? ' disabled' : ''}>
                    <option value="">— Venue —</option>
                    ${venueOpts}
                </select>
            </td>
            <td style="padding:2px">
                <input class="bor-slots" data-idx="${idx}" type="number" min="1" value="${linea.slots || ''}" placeholder="—" style="width:52px;font-size:12px;min-height:36px;padding:4px;border:1px solid var(--border);border-radius:4px">
                ${linea.slots && linea.venue_id ? (() => {
                    const v = _venuesPorServicio(linea.service_id).find(v => v.venue_id === linea.venue_id)
                    return v && linea.slots > v.libres ? `<div style="color:#dc2626;font-size:10px">>${v.libres} libres</div>` : ''
                })() : ''}
            </td>
            <td style="padding:2px">
                <input class="bor-price" data-idx="${idx}" type="number" min="0" value="${linea.price || ''}" placeholder="—" style="width:60px;font-size:12px;min-height:36px;padding:4px;border:1px solid var(--border);border-radius:4px">
            </td>
            <td style="padding:2px;text-align:right;font-size:12px;white-space:nowrap">
                ${total > 0 ? total.toLocaleString('es-ES') + '€' : '—'}
            </td>
            <td style="padding:2px;white-space:nowrap;text-align:center">
                ${catalogoBtn}
                <button class="bor-del" data-idx="${idx}" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--subtle);padding:1px 3px" title="Eliminar fila">🗑️</button>
            </td>
        </tr>`
    }

    const filaVacia = `<tr data-idx="new">
        <td></td>
        <td style="padding:2px">
            <select class="bor-svc-new" style="font-size:12px;width:100%;min-height:36px;color:var(--subtle)">
                <option value="">+ Añadir servicio…</option>
                ${serviceOpts}
            </select>
        </td>
        <td colspan="6" style="font-size:11px;color:var(--subtle);padding-left:6px">Toca para añadir</td>
    </tr>`

    container.innerHTML = `
        <div style="margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--subtle)">Borrador de propuesta</span>
                <span id="sol-borrador-saving" style="font-size:10px;color:var(--subtle);visibility:hidden">guardando…</span>
            </div>
            <div style="overflow-x:auto">
                <table style="width:100%;border-collapse:collapse;font-size:12px" id="sol-borrador-table">
                    <thead>
                        <tr style="border-bottom:1px solid var(--border)">
                            <th style="width:36px"></th>
                            <th style="text-align:left;padding:4px 2px;font-size:10px;color:var(--subtle);font-weight:600;text-transform:uppercase">Servicio</th>
                            <th style="text-align:left;padding:4px 2px;font-size:10px;color:var(--subtle);font-weight:600;text-transform:uppercase">Día</th>
                            <th style="text-align:left;padding:4px 2px;font-size:10px;color:var(--subtle);font-weight:600;text-transform:uppercase">Venue</th>
                            <th style="text-align:left;padding:4px 2px;font-size:10px;color:var(--subtle);font-weight:600;text-transform:uppercase">Plazas</th>
                            <th style="text-align:left;padding:4px 2px;font-size:10px;color:var(--subtle);font-weight:600;text-transform:uppercase">€/plaza</th>
                            <th style="text-align:right;padding:4px 2px;font-size:10px;color:var(--subtle);font-weight:600;text-transform:uppercase">Total</th>
                            <th style="width:48px"></th>
                        </tr>
                    </thead>
                    <tbody id="sol-borrador-tbody">
                        ${draft.map((l, i) => filaHtml(l, i)).join('')}
                        ${filaVacia}
                    </tbody>
                </table>
            </div>
            ${totalGeneral > 0 ? `<div style="text-align:right;font-size:13px;font-weight:600;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">Total propuesta: ${totalGeneral.toLocaleString('es-ES')}€</div>` : ''}
        </div>
    `

    const tbody = container.querySelector('#sol-borrador-tbody')

    function getDraft() {
        return draft.filter(l => l.service_id || l.venue_id || l.slots || l.price)
    }

    function rebind() {
        _renderBorrador({ ...sol, proposal_draft: draft }, container)
    }

    // Fila nueva — al seleccionar servicio
    container.querySelector('.bor-svc-new')?.addEventListener('change', e => {
        const svcId = e.target.value
        if (!svcId) return
        const svc     = servicios.find(s => s.service_id === svcId)
        const venues  = _venuesPorServicio(svcId)
        const catUrl  = venues[0]?.catalogo_url || null
        draft.push({
            service_id:         svcId,
            service_name:       svc?.label || svcId,
            day:                svc?.day || null,
            venue_id:           null,
            venue_display_name: null,
            slots:              null,
            price:              null,
            catalogo_url:       catUrl
        })
        _debounceSave(sol, getDraft)
        rebind()
    })

    // Eventos en filas existentes
    tbody.querySelectorAll('.bor-svc').forEach(sel => {
        sel.addEventListener('change', e => {
            const idx   = parseInt(e.target.dataset.idx)
            const svcId = e.target.value
            const svc   = servicios.find(s => s.service_id === svcId)
            const venues = _venuesPorServicio(svcId)
            draft[idx] = {
                ...draft[idx],
                service_id:         svcId,
                service_name:       svc?.label || svcId,
                day:                svc?.day || draft[idx].day,
                venue_id:           null,
                venue_display_name: null,
                catalogo_url:       venues[0]?.catalogo_url || null
            }
            _debounceSave(sol, getDraft)
            rebind()
        })
    })

    tbody.querySelectorAll('.bor-dia').forEach(inp => {
        inp.addEventListener('blur', e => {
            const idx = parseInt(e.target.dataset.idx)
            draft[idx].day = parseInt(e.target.value) || null
            _debounceSave(sol, getDraft)
        })
    })

    tbody.querySelectorAll('.bor-venue').forEach(sel => {
        sel.addEventListener('change', e => {
            const idx     = parseInt(e.target.dataset.idx)
            const venueId = e.target.value
            const venue   = _venuesPorServicio(draft[idx].service_id).find(v => v.venue_id === venueId)
            draft[idx].venue_id           = venueId || null
            draft[idx].venue_display_name = venue?.venue_display_name || null
            draft[idx].catalogo_url       = venue?.catalogo_url || null
            _debounceSave(sol, getDraft)
            rebind()
        })
    })

    tbody.querySelectorAll('.bor-slots').forEach(inp => {
        inp.addEventListener('blur', e => {
            const idx = parseInt(e.target.dataset.idx)
            draft[idx].slots = parseInt(e.target.value) || null
            _debounceSave(sol, getDraft)
            rebind()
        })
    })

    tbody.querySelectorAll('.bor-price').forEach(inp => {
        inp.addEventListener('blur', e => {
            const idx = parseInt(e.target.dataset.idx)
            draft[idx].price = parseFloat(e.target.value) || null
            _debounceSave(sol, getDraft)
            rebind()
        })
    })

    tbody.querySelectorAll('.bor-del').forEach(btn => {
        btn.addEventListener('click', e => {
            const idx = parseInt(e.currentTarget.dataset.idx)
            draft.splice(idx, 1)
            _debounceSave(sol, getDraft)
            rebind()
        })
    })

    tbody.querySelectorAll('.bor-up').forEach(btn => {
        btn.addEventListener('click', e => {
            const idx = parseInt(e.currentTarget.dataset.idx)
            if (idx === 0) return
            ;[draft[idx - 1], draft[idx]] = [draft[idx], draft[idx - 1]]
            _debounceSave(sol, getDraft)
            rebind()
        })
    })

    tbody.querySelectorAll('.bor-dn').forEach(btn => {
        btn.addEventListener('click', e => {
            const idx = parseInt(e.currentTarget.dataset.idx)
            if (idx >= draft.length - 1) return
            ;[draft[idx], draft[idx + 1]] = [draft[idx + 1], draft[idx]]
            _debounceSave(sol, getDraft)
            rebind()
        })
    })
}

async function _migrarConsultaAlLog(sol) {
    const items = _parsearLog(sol.conversation_notes)
    const tieneCliente = items.some(i => i.type === 'message' && i.author === 'Cliente')
    if (tieneCliente) return

    const comentarioLimpio = (sol.comments || '')
        .replace(/^(Días|Otros servicios):[^\n]*\n?/gm, '').trim()

    let texto = comentarioLimpio
    if (!texto) {
        const partes = []
        if (sol.level)  partes.push(sol.level)
        if (sol.day)    partes.push(`día ${sol.day}`)
        if (sol.slots)  partes.push(`${sol.slots} personas`)
        texto = partes.length ? `[Solicitud inicial] ${partes.join(' · ')}` : ''
    }
    if (!texto) return

    await _insertarMensaje(sol, 'Cliente', texto)
}

// ===== DETALLE DE SOLICITUD =====

function _actualizarUrlCatalogo(venueId, serviceId) {
    const el = document.getElementById('sol-url-catalogo')
    if (!el) return
    if (!venueId || !serviceId) { el.innerHTML = ''; return }
    const row = disponibilidad.find(d => d.venue_id === venueId && d.service_id === serviceId)
    const url = buildCatalogUrl(row?.venue_slug, row?.event_type)
    if (!url) { el.innerHTML = ''; return }
    el.innerHTML = `<span style="word-break:break-all">${url}</span>
        <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;flex-shrink:0" id="sol-btn-copiar-url">📋 Copiar</button>`
    document.getElementById('sol-btn-copiar-url').addEventListener('click', async () => {
        await navigator.clipboard.writeText(url)
        mostrarToast('URL copiada')
    })
}

function mostrarDetalle(sol) {
    solicitudActual = sol

    document.querySelectorAll('.sol-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === String(sol.id))
    })

    const detalle    = document.getElementById('sol-detalle')
    const esSfcom    = _esSfcom(sol.source)
    const esEmail    = sol.source === 'email'
    const convStatus = sol.status || 'nueva'

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

    const estadoOptions = Object.entries(STATUS_LABELS).map(([v, l]) =>
        `<option value="${v}"${convStatus === v ? ' selected' : ''}>${l}</option>`
    ).join('')

    // Pre-rellenar borrador si está vacío y la solicitud tiene datos de servicio
    if (!esSfcom && (!Array.isArray(sol.proposal_draft) || sol.proposal_draft.length === 0)) {
        if (sol.level || sol.service_id) {
            const servicios = _serviciosUnicos()
            const svcId     = sol.service_id || servicios.find(s => {
                const et = sol.level
                return et === 'chupinazo' ? s.service_id === 'CHUPINAZO_6'
                     : et === 'procesion' ? s.service_id === 'PROCESION_7'
                     : et === 'gigantes'  ? s.service_id === 'DESPEDIDA_GIGANTES_14'
                     : et === 'pobre_de_mi' ? s.service_id === 'POBRE_DE_MI'
                     : et === 'encierro' && sol.day ? s.service_id === `ENCIERRO_${sol.day}`
                     : false
            })?.service_id
            if (svcId) {
                const svc     = servicios.find(s => s.service_id === svcId)
                const venues  = _venuesPorServicio(svcId)
                const catUrl  = venues[0]?.catalogo_url || null
                const precioR = _calcularPrecioRef(sol)
                const precioN = (() => {
                    if (!precioR) return null
                    const nums = precioR.match(/\d+(?:\.\d+)?/g)?.map(Number)
                    return nums?.length ? Math.max(...nums) : null
                })()
                sol.proposal_draft = [{
                    service_id:         svcId,
                    service_name:       svc?.label || svcId,
                    day:                svc?.day || sol.day || null,
                    venue_id:           sol.assigned_venue_id || null,
                    venue_display_name: venues.find(v => v.venue_id === sol.assigned_venue_id)?.venue_display_name || null,
                    slots:              sol.slots || null,
                    price:              precioN,
                    catalogo_url:       catUrl
                }]
                supabase.from('reservation_requests').update({ proposal_draft: sol.proposal_draft }).eq('id', sol.id)
                const idx = _solicitudesActuales.findIndex(s => s.id === sol.id)
                if (idx !== -1) _solicitudesActuales[idx].proposal_draft = sol.proposal_draft
            }
        }
    }

    const params = new URLSearchParams()
    params.set('solicitud_id', sol.id)
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
                    ${!esSfcom ? `<select id="sol-select-estado" class="sol-estado-select">${estadoOptions}</select>` : ''}
                    <button class="btn-cerrar-detalle" id="btnCerrarDetalle" title="Cerrar">✕</button>
                </div>
            </div>

            ${!esSfcom && convStatus === 'seguimiento_pendiente' ? `
            <div style="margin-bottom:16px">
                <button class="btn btn-primary" id="btnEnviarRecordatorio" style="width:100%;min-height:44px">📩 Enviar recordatorio</button>
            </div>` : ''}

            ${!esSfcom ? `<div id="sol-borrador-container"></div>` : `
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
                ${sol.comments ? `
                <div class="sol-dato sol-dato--full">
                    <span class="sol-dato-label">Consulta</span>
                    <span class="sol-dato-valor">${sol.comments}</span>
                </div>` : ''}
            </div>`}

            ${!esSfcom && venuesDisp.length > 0 ? `
            <div class="form-field" style="margin-bottom:16px">
                <label>Venue asignado</label>
                <select id="sol-select-venue">
                    <option value="">— Sin asignar —</option>
                    ${venueOptions}
                </select>
                <div id="sol-url-catalogo" style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;color:var(--subtle)"></div>
            </div>` : ''}

            ${!esSfcom ? `
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
            </div>` : ''}

            <div class="sol-acciones">
                ${esSfcom
                    ? `<a class="btn btn-primary" href="${urlReserva}" style="text-decoration:none;display:inline-flex;align-items:center;min-height:44px">→ Crear reserva</a>`
                    : `<button class="btn btn-primary" id="btnAbrirAsistente" style="min-height:44px">💬 Abrir asistente</button>
                       <a class="btn btn-secondary" href="${urlReserva}" style="text-decoration:none;display:inline-flex;align-items:center">📋 Convertir en reserva</a>`
                }
                <button class="btn btn-danger" id="btnDescartarSolicitud">✕ Descartar</button>
            </div>

        </div>
    `

    detalle.classList.add('visible')
    _actualizarUrlCatalogo(sol.assigned_venue_id, sol.service_id)

    // Borrador (solo solicitudes no-sfcom)
    const borradorContainer = document.getElementById('sol-borrador-container')
    if (borradorContainer) {
        _renderBorrador(sol, borradorContainer)
        _migrarConsultaAlLog(sol).then(() => {
            const logArea = document.getElementById('sol-log-area')
            if (logArea) {
                logArea.innerHTML = _renderizarLog(_parsearLog(sol.conversation_notes))
                _initEditListeners(sol, logArea)
                setTimeout(() => { logArea.scrollTop = logArea.scrollHeight }, 0)
            }
        })
    }

    // Scroll log al final tras render (solo si existe — sfcom no tiene log)
    const logArea = document.getElementById('sol-log-area')
    if (logArea) {
        setTimeout(() => { logArea.scrollTop = logArea.scrollHeight }, 0)
        _initEditListeners(sol, logArea)
    }

    // ── Estado ──────────────────────────────────────────────────────────────
    document.getElementById('sol-select-estado')?.addEventListener('change', async e => {
        const nuevoEstado = e.target.value
        const { error } = await supabase
            .from('reservation_requests')
            .update({ status: nuevoEstado })
            .eq('id', sol.id)
        if (error) { console.error('Error actualizando estado:', error); return }
        sol.status = nuevoEstado

        const badgeEl = document.querySelector(`.sol-item[data-id="${sol.id}"] .sol-badge:not(.sol-badge--sfcom):not(.sol-badge--email)`)
        if (badgeEl) {
            badgeEl.className   = `sol-badge sol-badge--${nuevoEstado}`
            badgeEl.textContent = STATUS_LABELS[nuevoEstado] || nuevoEstado
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
            else {
                sol.assigned_venue_id = venueId
                _actualizarUrlCatalogo(venueId, sol.service_id)
            }
        })
    }

    // ── Log de conversación (solo solicitudes no-sfcom) ──────────────────────
    if (!esSfcom) {
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
            const logArea = document.getElementById('sol-log-area')
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
    }

    // ── Recordatorio ────────────────────────────────────────────────────────
    document.getElementById('btnEnviarRecordatorio')?.addEventListener('click', () => {
        abrirAsistenteRespuesta(sol, 'recordatorio')
    })

    // ── Abrir asistente ──────────────────────────────────────────────────────
    document.getElementById('btnAbrirAsistente')?.addEventListener('click', () => {
        abrirAsistenteRespuesta(sol)
    })

    // ── Descartar solicitud ──────────────────────────────────────────────────
    document.getElementById('btnDescartarSolicitud').addEventListener('click', async () => {
        if (!confirm('¿Descartar esta solicitud? Se marcará como descartada y dejará de aparecer en la lista activa.')) return
        const { error } = await supabase
            .from('reservation_requests')
            .update({ status: 'descartada' })
            .eq('id', sol.id)
        if (error) { alert('Error al descartar: ' + error.message); return }
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

function _inferirServiceIds(level) {
    const FIJOS = {
        chupinazo:   ['CHUPINAZO_6'],
        procesion:   ['PROCESION_7'],
        gigantes:    ['DESPEDIDA_GIGANTES_14'],
        pobre_de_mi: ['POBRE_DE_MI']
    }
    if (FIJOS[level]) return FIJOS[level]
    if (level === 'encierro') return [7, 8, 9, 10, 11, 12, 13, 14].map(d => `ENCIERRO_${d}`)
    return []
}

function _calcularPrecioRef(sol) {
    const serviceIds = sol.service_id
        ? [sol.service_id]
        : _inferirServiceIds(sol.level)
    if (!serviceIds.length) return null

    const precios = (todasReservas || [])
        .filter(r => serviceIds.includes(r.service_id) && ['Confirmada', 'Pendiente'].includes(r.status))
        .map(r => parseFloat(r.price_per_slot))
        .filter(p => p > 0)

    if (precios.length) {
        const min = Math.min(...precios)
        const max = Math.max(...precios)
        return min === max ? `${min}€/plaza` : `${min}–${max}€/plaza`
    }

    // Fallback: coste proveedor en availability_panel + margen 20%
    const preciosDisp = (disponibilidad || [])
        .filter(d => serviceIds.includes(d.service_id))
        .map(d => parseFloat(d.price_per_slot))
        .filter(p => p > 0)

    if (!preciosDisp.length) return null
    const fallback = Math.round(Math.max(...preciosDisp) * 1.2)
    return `~${fallback}€/plaza`
}

// ===== INICIALIZACIÓN =====

document.getElementById('btnProcesarEmail').addEventListener('click', abrirProcesarEmail)

await cargarSolicitudes()
