import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, buildCatalogUrl, resolverCliente, parsearNivel, TIPO_SERVICIO_ID, mostrarOpcionesEnvio, persistirCobrosCliente, persistirPagosProveedor, construirItemBorrador, extraerQualifier, serviceCodesToIds, esVacio, initTemporada, getTemporadaActiva, temporadaDeFecha, initPrecioInput } from './utils.js'
import { mostrarToast, ejecutarVerificacion } from './verificacion.js'
import { initAsistente, abrirAsistenteRespuesta, abrirProcesarEmail } from './asistente.js'
import { checkSfcomOrders, importarCanceladosSfcom, loadSfcomListings } from './sfcom.js'
import { crearModal } from './modal.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
document.getElementById('btnVerificarDatos')?.addEventListener('click', () => ejecutarVerificacion(supabase, { modoManual: true, incluirSfcom: true, incluirFinanciero: true, persistirCobros: persistirCobrosCliente, persistirPagos: persistirPagosProveedor, season: getTemporadaActiva() }))
initSidebar()

// ===== DATOS GLOBALES =====
const { data: _tmpSeason } = await supabase.from('services').select('season').order('season', { ascending: false })
const _todasTemporadas = [...new Set((_tmpSeason ?? []).map(r => r.season))]
await initTemporada(_todasTemporadas)
const _temporada = getTemporadaActiva()

// El sol-layout usa margin:-28px para cancelar el padding de .content.
// Si el toast de temporada está presente, ese margen hace que el layout se solape con el toast.
const _toastEl = document.getElementById('toastTemporada')
if (_toastEl) {
    const solLayout = document.querySelector('.sol-layout')
    if (solLayout) {
        solLayout.style.marginTop = '0'
        solLayout.style.height    = `calc(100vh - 28px - ${_toastEl.offsetHeight}px)`
    }
}

const { data: disponibilidad } = await supabase.from('availability_panel')
    .select('venue_id, service_id, service_code, total_slots, price_per_slot, billing_model, venue_display_name, venue_address, description, access_instructions, venue_slug, event_type, day')
    .eq('season', _temporada)
const _servicioIds = (disponibilidad ?? []).map(d => d.service_id)
let todasReservas  = _servicioIds.length > 0
    ? (await supabase.from('reservations').select('*').in('service_id', _servicioIds)).data ?? []
    : []
let todosClientes  = (await supabase.from('clients').select('id,name,email,phone')).data ?? []

function _esSfcom(source) {
    return source && /^WEB\d+_\d+$/.test(source)
}

initAsistente(supabase, {
    getDisponibilidad:     () => disponibilidad,
    getTodasReservas:      () => todasReservas,
    onEmailSaved:          cargarSolicitudes,
    esSfcom:               _esSfcom,
    onRespuestaUsada:      _onRespuestaUsadaEnLog,
    onBorradorActualizado: _onBorradorActualizado,
    getNotasSesion:        () => _notasSesion
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
let _solicitudesCerradas    = []
let _todasCerradasSeason    = []
let _cerradasOffset         = 0
let _hayMasCerradas         = false

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
        const rawText = currentLines.join('\n').trim()
        if (rawText) {
            const isDraft = currentAuthor === 'Paula' && rawText.startsWith('[BORRADOR]\n')
            const text    = isDraft ? rawText.slice('[BORRADOR]\n'.length) : rawText
            items.push({ type: 'message', author: currentAuthor, text, isDraft: isDraft || false, date: currentDate, index: msgIndex++ })
        }
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
            parts.push(item.isDraft ? '[BORRADOR]\n' + item.text : item.text)
            parts.push('')
        }
    }
    while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
    return parts.join('\n')
}

function _renderizarLog(items) {
    if (!items.length) return '<div class="sol-log-empty">Sin mensajes aún.</div>'
    return items.map(item => {
        if (item.type === 'date') {
            return `<div class="sol-log-date">${item.label}</div>`
        }
        const isPaula = item.author === 'Paula'
        const esc     = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const editBtn = `<button class="sol-log-edit" data-index="${item.index}" title="Editar">✏️</button>`

        if (item.isDraft) {
            return `<div class="sol-log-msg sol-log-msg--paula sol-log-msg--borrador">
                <div class="sol-log-bubble-wrap">
                    <div class="sol-log-bubble">${esc(item.text).replace(/\n/g, '<br>')}</div>
                    <div class="sol-draft-actions">
                        <span class="sol-draft-label">⏳ pendiente de envío</span>
                        <button class="sol-draft-act" data-action="copy" data-index="${item.index}">📋 Copiar</button>
                        <button class="sol-draft-act sol-draft-act--wa" data-action="wa" data-index="${item.index}">💬</button>
                        <button class="sol-draft-act sol-draft-act--email" data-action="email" data-index="${item.index}">📧</button>
                        <button class="sol-draft-act sol-draft-act--ya" data-action="ya" data-index="${item.index}">✓ Ya lo envié</button>
                    </div>
                </div>
                ${editBtn}
            </div>`
        }

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
    // ── Botones de edición (✏️) — ambos autores ──────────────────────────────
    container.querySelectorAll('.sol-log-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const msgIdx  = parseInt(btn.dataset.index)
            const msgEl   = btn.closest('.sol-log-msg')
            const isDraft = msgEl.classList.contains('sol-log-msg--borrador')

            const ta = document.createElement('textarea')
            ta.style.cssText = 'width:100%;box-sizing:border-box;font-size:13px;padding:6px;border:1px solid var(--border);border-radius:4px;resize:vertical'
            ta.rows  = 4
            // For draft messages, the bubble is inside .sol-log-bubble-wrap
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
                // isDraft flag preserved by _reconstruirLog
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

    // ── Botones de acción del borrador ────────────────────────────────────────
    // Ocultar wa/email si no hay contacto
    if (!sol.client_phone) container.querySelectorAll('.sol-draft-act--wa').forEach(b => { b.style.display = 'none' })
    if (!sol.client_email) container.querySelectorAll('.sol-draft-act--email').forEach(b => { b.style.display = 'none' })

    container.querySelectorAll('.sol-draft-act').forEach(btn => {
        btn.addEventListener('click', async () => {
            const msgIdx = parseInt(btn.dataset.index)
            const action = btn.dataset.action
            const items  = _parsearLog(sol.conversation_notes)
            const msgs   = items.filter(i => i.type === 'message')
            const draft  = msgs[msgIdx]
            if (!draft?.isDraft) return

            const texto = draft.text
            const ok    = await _promoverBorrador(sol, msgIdx)
            if (!ok) return

            const logArea = document.getElementById('sol-log-area')
            if (logArea) {
                logArea.innerHTML = _renderizarLog(_parsearLog(sol.conversation_notes))
                _initEditListeners(sol, logArea)
                setTimeout(() => { logArea.scrollTop = logArea.scrollHeight }, 50)
            }
            _actualizarPreviewLista(sol)

            if (action === 'copy') {
                await navigator.clipboard.writeText(texto).catch(() => {})
                mostrarToast('📋 Copiado')
            } else if (action === 'wa' && sol.client_phone) {
                window.open(`https://wa.me/${sol.client_phone.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`, '_blank')
            } else if (action === 'email' && sol.client_email) {
                window.location.href = `mailto:${sol.client_email}?body=${encodeURIComponent(texto)}`
            }
            // 'ya': solo promueve, ya hecho arriba
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

async function _guardarMensajeBorrador(sol, texto) {
    const fecha = _fechaLog()
    const items = _parsearLog(sol.conversation_notes)
    const borradorIdx = items.findIndex(i => i.type === 'message' && i.author === 'Paula' && i.isDraft)
    if (borradorIdx !== -1) {
        items[borradorIdx].text = texto
    } else {
        const tieneFechaHoy = items.some(i => i.type === 'date' && i.label === fecha)
        if (!tieneFechaHoy) items.push({ type: 'date', label: fecha })
        items.push({ type: 'message', author: 'Paula', text: texto, isDraft: true, date: fecha, index: -1 })
    }
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

async function _promoverBorrador(sol, msgIdx) {
    const items = _parsearLog(sol.conversation_notes)
    const msgs  = items.filter(i => i.type === 'message')
    const msg   = msgs[msgIdx]
    if (!msg?.isDraft) return false
    msg.isDraft = false
    const nuevoLog = _reconstruirLog(items)
    const { error: errLog } = await supabase
        .from('reservation_requests')
        .update({ conversation_notes: nuevoLog })
        .eq('id', sol.id)
    if (errLog) { console.error(errLog); return false }
    sol.conversation_notes = nuevoLog
    const sIdx = _solicitudesActuales.findIndex(s => s.id === sol.id)
    if (sIdx !== -1) _solicitudesActuales[sIdx].conversation_notes = nuevoLog

    const { error: errStatus } = await supabase
        .from('reservation_requests')
        .update({ status: 'respuesta_enviada' })
        .eq('id', sol.id)
    if (!errStatus) {
        sol.status = 'respuesta_enviada'
        if (sIdx !== -1) _solicitudesActuales[sIdx].status = 'respuesta_enviada'
        _actualizarBadgeEstado(sol.id, 'respuesta_enviada')
        const sel = document.getElementById('sol-select-estado')
        if (sel) sel.value = 'respuesta_enviada'
        document.getElementById('btnEnviarRecordatorio')?.remove()
    }
    return true
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
    const sol = [..._solicitudesActuales, ..._solicitudesCerradas].find(s => s.id === solicitudId)
    const draftActual = Array.isArray(sol?.proposal_draft) ? sol.proposal_draft : []
    const draftConEstado = draft.map(linea => {
        const existente = draftActual.find(
            e => e.service_id === linea.service_id && e.venue_id === linea.venue_id
        )
        return existente?.estado ? { ...linea, estado: existente.estado } : linea
    })

    const { error } = await supabase
        .from('reservation_requests')
        .update({ proposal_draft: draftConEstado })
        .eq('id', solicitudId)
    if (error) { console.error('[borrador] Error guardando:', error); return }

    if (sol) sol.proposal_draft = draftConEstado
    if (solicitudActual?.id === solicitudId) {
        if (!sol) solicitudActual.proposal_draft = draftConEstado
        const container = document.getElementById('sol-borrador-container')
        if (container) _renderBorrador(sol ?? solicitudActual, container)
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

    _solicitudesActuales = (data ?? []).filter(s =>
        s.status === 'nueva' || temporadaDeFecha(s.created_at) === _temporada
    )
    await _verificarTransicionesAutomaticas()
    await _procesarWebFormsSinProcesar()

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
    if (_cerradasOffset === 0) {
        const { data } = await supabase
            .from('reservation_requests')
            .select('*')
            .in('status', ['convertida', 'descartada'])
            .order('updated_at', { ascending: false, nullsFirst: false })
            .order('id', { ascending: false })
        _todasCerradasSeason = (data ?? []).filter(s => temporadaDeFecha(s.created_at) === _temporada)
    }
    const ventana = _todasCerradasSeason.slice(_cerradasOffset, _cerradasOffset + BATCH_CERRADAS)
    _solicitudesCerradas.push(...ventana)
    _cerradasOffset += ventana.length
    _hayMasCerradas = _cerradasOffset < _todasCerradasSeason.length
}

let _solicitudesActuales = []

async function _verificarTransicionesAutomaticas() {
    // Migración puntual: cancelada_sfcom era origen, no estado — mover todo a 'nueva'
    const legacyCanceladas = _solicitudesActuales.filter(s => s.status === 'cancelada_sfcom')
    if (legacyCanceladas.length) {
        await supabase.from('reservation_requests')
            .update({ status: 'nueva' })
            .in('id', legacyCanceladas.map(s => s.id))
        legacyCanceladas.forEach(s => { s.status = 'nueva' })
    }

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

// Detecta solicitudes del formulario web que tienen datos raw en conversation_notes
// (formato JSON: {"slug","day","slots"}) y las convierte al formato estructurado completo.
// Solo actúa sobre registros donde main.js hizo el INSERT con el nuevo formato.
async function _procesarWebFormsSinProcesar() {
    const sinProcesar = _solicitudesActuales.filter(s =>
        s.source === null &&
        (!s.proposal_draft || s.proposal_draft.length === 0) &&
        s.conversation_notes?.startsWith('{')
    )
    if (!sinProcesar.length) return

    const TIPO_LABELS = {
        encierro:    'Encierro',
        chupinazo:   'Chupinazo',
        procesion:   'Procesión',
        gigantes:    'Despedida Gigantes',
        pobre_de_mi: 'Pobre de Mí'
    }

    for (const sol of sinProcesar) {
        let rawData = {}
        try { rawData = JSON.parse(sol.conversation_notes) } catch { continue }

        const { slug, day, slots } = rawData

        // Inferir service_id desde el slug
        const parsed      = parsearNivel(slug)
        let serviceCode   = null
        if (parsed) {
            if (parsed.tipo === 'encierro') serviceCode = day ? `ENCIERRO_${day}` : null
            else serviceCode = TIPO_SERVICIO_ID[parsed.tipo] ?? null
        }
        const serviceId = serviceCode
            ? (disponibilidad?.find(d => d.service_code === serviceCode)?.service_id ?? null)
            : null

        const draft = [construirItemBorrador({
            service_name: slug      || null,
            service_id:   serviceId,
            day:          day       || null,
            slots:        slots     || null
        })]

        // Construir entrada inicial del log a partir de los datos del formulario
        const fecha = sol.created_at ? new Date(sol.created_at) : new Date()
        const dd    = String(fecha.getDate()).padStart(2, '0')
        const mm    = String(fecha.getMonth() + 1).padStart(2, '0')
        const yy    = String(fecha.getFullYear()).slice(-2)

        const qualifier = extraerQualifier(slug)
        const tipoLabel = parsed ? TIPO_LABELS[parsed.tipo] : null
        const slugLabel = tipoLabel
            ? (qualifier
                ? qualifier.charAt(0).toUpperCase() + qualifier.slice(1) + ' ' + tipoLabel.toLowerCase()
                : tipoLabel)
            : (slug ? slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : null)

        const partes = []
        if (slugLabel) partes.push(slugLabel)
        if (day)   partes.push(`${day} jul`)
        if (slots) partes.push(`${slots} ${slots === 1 ? 'persona' : 'personas'}`)

        const comentarioLimpio = (rawData.comment || sol.comments || '').replace(/^(Días|Otros servicios):[^\n]*\n?/gm, '').trim()
        let msgCliente = partes.join(' · ')
        if (comentarioLimpio) msgCliente += (msgCliente ? '\n' : '') + comentarioLimpio
        if (!msgCliente) msgCliente = 'Solicitud desde web'

        const notasFormateadas = `---${dd}/${mm}/${yy}---\n<Cliente>\n${msgCliente}`

        const { error } = await supabase.from('reservation_requests').update({
            proposal_draft:     draft,
            conversation_notes: notasFormateadas
        }).eq('id', sol.id)

        if (!error) {
            sol.proposal_draft      = draft
            sol.conversation_notes  = notasFormateadas
        }
    }
}

function _esc(s) {
    return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function _renderItem(s, apagada = false) {
    const esSfcom     = _esSfcom(s.source)
    const esCancelada = s.source?.startsWith('sfcom_c:')
    const esEmail     = s.source === 'email'
    const fecha      = (s.updated_at ?? s.created_at)
        ? new Date(s.updated_at ?? s.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
        : '—'
    const convStatus = s.status || 'nueva'
    const badgeLabel = STATUS_LABELS[convStatus] || convStatus
    const origenBadge = esSfcom
        ? `<span class="sol-badge sol-badge--sfcom">sfcom</span>`
        : esCancelada ? `<span class="sol-badge sol-badge--sfcom-c">sfcom_c</span>`
        : esEmail ? `<span class="sol-badge sol-badge--email">email</span>`
        : `<span class="sol-badge sol-badge--web">web</span>`
    const experiencia    = _esc(s.proposal_draft?.[0]?.service_name || '—')
    const notasPreview   = (() => {
        if (!s.conversation_notes) return ''
        const msgs   = _parsearLog(s.conversation_notes).filter(i => i.type === 'message')
        const ultimo = msgs[msgs.length - 1]
        const full   = ultimo ? `${ultimo.author}: ${ultimo.text}` : s.conversation_notes
        const preview = full.slice(0, 64) + (full.length > 64 ? '…' : '')
        return `<div class="sol-item-notes">${_esc(preview)}</div>`
    })()
    const esActiva = solicitudActual?.id === s.id
    const clases   = ['sol-item', apagada ? 'sol-item--apagada' : '', esActiva ? 'active' : ''].filter(Boolean).join(' ')
    return `<div class="${clases}" data-id="${s.id}">
        <div class="sol-item-header">
            <span class="sol-item-nombre">${_esc(s.client_name) || '—'}</span>
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
    const lista      = document.getElementById('sol-lista')
    const sfcomConf  = _solicitudesActuales.filter(s => _esSfcom(s.source))
    const sfcomCanc  = _solicitudesActuales.filter(s => s.source?.startsWith('sfcom_c:') && s.status === 'nueva')
    const activas    = _solicitudesActuales.filter(s => !_esSfcom(s.source) && !(s.source?.startsWith('sfcom_c:') && s.status === 'nueva'))
    const cerradas   = _solicitudesCerradas
    const hayActivos = sfcomConf.length || activas.length || sfcomCanc.length

    if (!hayActivos && !cerradas.length) {
        lista.innerHTML = '<div class="sol-empty">No hay solicitudes.</div>'
        return
    }

    // "Solicitudes" header solo aparece cuando coexiste con otras secciones activas
    const hayVariosBloques = (sfcomConf.length > 0) + (activas.length > 0) + (sfcomCanc.length > 0) > 1

    let html = ''

    if (sfcomConf.length) {
        html += `<div class="sol-sep">Sfcom — confirmadas</div>`
        html += sfcomConf.map(s => _renderItem(s)).join('')
    }

    if (activas.length) {
        if (hayVariosBloques) html += `<div class="sol-sep">Solicitudes</div>`
        html += activas.map(s => _renderItem(s)).join('')
    }

    if (sfcomCanc.length) {
        html += `<div class="sol-sep">Leads cancelados sfcom</div>`
        html += sfcomCanc.map(s => _renderItem(s)).join('')
    }

    if (!hayActivos) {
        html += '<div class="sol-empty">No hay solicitudes activas.</div>'
    }

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
            const sol = [...sfcomConf, ...activas, ...sfcomCanc, ...cerradas].find(s => String(s.id) === el.dataset.id)
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
        const diaNum = d.day || null
        // DEUDA TÉCNICA (2026): este diccionario es redundante ahora que services.name es
        // consistente. Se podría sustituir por uso directo de services.name, manteniendo
        // event_type solo para el array `order` de clasificación. No se cambia ahora porque
        // el comportamiento actual funciona correctamente.
        const etLabel = {
            encierro: 'Encierro', chupinazo: 'Chupinazo', procesion: 'Procesión',
            gigantes: 'Gigantes', pobre_de_mi: 'Pobre de Mí'
        }[d.event_type] || d.event_type || d.service_code
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

        const estadoLinea = linea.estado || 'pendiente'
        const rowStyle = estadoLinea === 'hecha'
            ? ' style="background:#f0fdf4"'
            : estadoLinea === 'descartada'
            ? ' style="background:#f9fafb;opacity:0.65"'
            : ''
        const estadoBadge = estadoLinea === 'hecha'
            ? `<span style="font-size:9px;color:#16a34a;font-weight:700;margin-right:3px" title="Convertida en reserva">✓</span>`
            : estadoLinea === 'descartada'
            ? `<span style="font-size:9px;color:#9ca3af;font-weight:700;margin-right:3px" title="Descartada">✗</span>`
            : ''

        const svc = servicios.find(s => s.service_id === linea.service_id)
        const diaEncodado = !!svc?.day

        return `<tr data-idx="${idx}"${rowStyle}>
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
                <input class="bor-dia" data-idx="${idx}" type="number" min="6" max="14" value="${linea.day || ''}" placeholder="—"
                    style="width:48px;font-size:12px;min-height:36px;padding:4px;border:1px solid var(--border);border-radius:4px${diaEncodado ? ';background:var(--bg-subtle,#f9fafb);color:var(--subtle)' : ''}"
                    ${diaEncodado ? 'readonly title="El día está fijado por el servicio seleccionado"' : ''}>
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
                ${estadoBadge}${catalogoBtn}
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
        const active = document.activeElement
        let restore = null
        if (active && tbody.contains(active)) {
            const idx = parseInt(active.dataset.idx)
            if (active.classList.contains('bor-slots')) {
                draft[idx].slots = parseInt(active.value) || null
                restore = { cls: '.bor-slots', idx }
            } else if (active.classList.contains('bor-price')) {
                draft[idx].price = active.value !== '' ? parseFloat(active.value) : null
                restore = { cls: '.bor-price', idx }
            }
        }
        _renderBorrador({ ...sol, proposal_draft: draft }, container)
        if (restore) {
            const el = container.querySelector(`${restore.cls}[data-idx="${restore.idx}"]`)
            if (el) { el.focus(); const l = el.value.length; el.setSelectionRange(l, l) }
        }
    }

    // Fila nueva — al seleccionar servicio
    container.querySelector('.bor-svc-new')?.addEventListener('change', e => {
        const svcId = parseInt(e.target.value) || null
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
            const svcId = parseInt(e.target.value) || null
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
        })
    })

    tbody.querySelectorAll('.bor-price').forEach(inp => {
        inp.addEventListener('blur', e => {
            const idx = parseInt(e.target.dataset.idx)
            draft[idx].price = e.target.value !== '' ? parseFloat(e.target.value) : null
            _debounceSave(sol, getDraft)
        })
        initPrecioInput(inp)
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
        const d0     = sol.proposal_draft?.[0] ?? null
        const partes = []
        if (d0?.service_name) partes.push(d0.service_name)
        if (d0?.day)          partes.push(`día ${d0.day}`)
        if (d0?.slots)        partes.push(`${d0.slots} personas`)
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

function _commentsSection(sol) {
    return `<div style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--subtle)">Notas internas</span>
            <span id="sol-comments-saving" style="font-size:10px;color:var(--subtle);visibility:hidden">guardando…</span>
        </div>
        <textarea id="sol-comments-ta" rows="2"
            style="width:100%;box-sizing:border-box;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:6px 8px;resize:vertical;font-family:inherit"
            placeholder="Notas de uso interno…">${_esc(sol.comments || '')}</textarea>
    </div>`
}

function _initCommentsListener(sol) {
    const ta  = document.getElementById('sol-comments-ta')
    const ind = document.getElementById('sol-comments-saving')
    if (!ta) return
    let timer = null
    ta.addEventListener('input', () => {
        clearTimeout(timer)
        if (ind) ind.style.visibility = 'visible'
        timer = setTimeout(async () => {
            const texto = ta.value
            const { error } = await supabase.from('reservation_requests').update({ comments: texto || null }).eq('id', sol.id)
            if (!error) {
                sol.comments = texto || null
                const idx = _solicitudesActuales.findIndex(s => s.id === sol.id)
                if (idx !== -1) _solicitudesActuales[idx].comments = texto || null
            }
            if (ind) ind.style.visibility = 'hidden'
        }, 800)
    })
}

function _logSection(logItems) {
    return `<div class="sol-log-section">
        <span class="sol-log-label">
            Conversación
            <span style="font-weight:400;text-transform:none;letter-spacing:0;color:#999"> — solo lo ve el equipo</span>
        </span>
        <div class="sol-log-box">
            <div id="sol-log-area" class="sol-log-area">
                ${_renderizarLog(logItems)}
            </div>
            <div class="sol-compose-inner">
                <div class="sol-compose-row sol-compose-row--cliente">
                    <span class="sol-compose-icon">👤</span>
                    <div class="sol-compose-field">
                        <textarea class="sol-compose-tx" data-author="Cliente"
                            placeholder="Pega el mensaje del cliente…" rows="2"></textarea>
                    </div>
                </div>
                <div class="sol-compose-row sol-compose-row--paula">
                    <div class="sol-compose-field">
                        <textarea class="sol-compose-tx" data-author="Paula"
                            placeholder="Escribe tu respuesta… (Ctrl+↵ guarda ya)" rows="2"></textarea>
                    </div>
                    <span class="sol-compose-icon">✉️</span>
                </div>
            </div>
        </div>
    </div>`
}

function _initLogListeners(sol) {
    const logArea = document.getElementById('sol-log-area')
    if (!logArea) return

    document.querySelectorAll('.sol-compose-tx').forEach(ta => {
        const author = ta.dataset.author
        let timer = null

        const doSave = async () => {
            clearTimeout(timer)
            timer = null
            const texto = ta.value.trim()
            if (!texto || ta.disabled) return
            ta.disabled = true
            const ok = author === 'Paula'
                ? await _guardarMensajeBorrador(sol, texto)
                : await _insertarMensaje(sol, 'Cliente', texto)
            ta.disabled = false
            if (ok) {
                ta.value = ''
                logArea.innerHTML = _renderizarLog(_parsearLog(sol.conversation_notes))
                _initEditListeners(sol, logArea)
                setTimeout(() => { logArea.scrollTop = logArea.scrollHeight }, 50)
                _actualizarPreviewLista(sol)
            }
        }

        ta.addEventListener('input', () => {
            clearTimeout(timer)
            if (!esVacio(ta.value)) timer = setTimeout(doSave, 700)
        })

        ta.addEventListener('change', doSave)

        ta.addEventListener('keydown', e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave() }
        })
    })
}

async function _preFillBorradorSiVacio(sol) {
    if (!Array.isArray(sol.proposal_draft) || !sol.proposal_draft.length) return
    const servicios = _serviciosUnicos()
    let changed = false
    for (const item of sol.proposal_draft) {
        const svcId = item.service_id
        if (!svcId) continue
        if (item.price == null) {
            const precioR = _calcularPrecioRef(sol)
            if (precioR) {
                const nums = precioR.match(/\d+(?:\.\d+)?/g)?.map(Number)
                if (nums?.length) { item.price = Math.max(...nums); changed = true }
            }
        }
        if (!item.catalogo_url) {
            const venues = _venuesPorServicio(svcId)
            const catUrl = venues[0]?.catalogo_url || null
            if (catUrl) { item.catalogo_url = catUrl; changed = true }
        }
        if (!item.service_name) {
            const svc = servicios.find(s => s.service_id === svcId)
            if (svc?.label) { item.service_name = svc.label; changed = true }
        }
    }
    if (!changed) return
    await supabase.from('reservation_requests').update({ proposal_draft: sol.proposal_draft }).eq('id', sol.id)
    const idx = _solicitudesActuales.findIndex(s => s.id === sol.id)
    if (idx !== -1) _solicitudesActuales[idx].proposal_draft = sol.proposal_draft
}

function _actualizarBadgeEstado(id, nuevoEstado) {
    const badgeEl = document.querySelector(
        `.sol-item[data-id="${id}"] .sol-badge:not(.sol-badge--sfcom):not(.sol-badge--sfcom-c):not(.sol-badge--email):not(.sol-badge--web)`
    )
    if (badgeEl) { badgeEl.className = `sol-badge sol-badge--${nuevoEstado}`; badgeEl.textContent = STATUS_LABELS[nuevoEstado] || nuevoEstado }
    const itemEl = document.querySelector(`.sol-item[data-id="${id}"]`)
    if (itemEl) itemEl.classList.toggle('sol-item--apagada', ['convertida', 'descartada'].includes(nuevoEstado))
}

function mostrarDetalle(sol) {
    solicitudActual = sol

    document.querySelectorAll('.sol-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === String(sol.id))
    })

    const detalle       = document.getElementById('sol-detalle')
    const esSfcomConf   = _esSfcom(sol.source)
    const esCancelada   = sol.source?.startsWith('sfcom_c:')
    const esSfcomLead   = esCancelada && sol.status === 'nueva'
    const esSfcomNueva  = esSfcomConf && sol.status === 'nueva'
    const esCerrada     = sol.status === 'convertida' || sol.status === 'descartada'
    const esCondensada  = esCerrada || esSfcomNueva || esSfcomLead
    const esSeguimiento = sol.status === 'seguimiento_pendiente'
    const esEmail       = sol.source === 'email'
    const convStatus    = sol.status || 'nueva'

    const contactoTel   = sol.client_phone ? `<a href="tel:${sol.client_phone}">${sol.client_phone}</a>` : null
    const contactoEmail = sol.client_email ? `<a href="mailto:${sol.client_email}">${sol.client_email}</a>` : null
    const contactoHTML  = [contactoTel, contactoEmail].filter(Boolean).join(' · ') || '—'

    const matchResult     = resolverCliente({ nombre: sol.client_name || '', email: sol.client_email || '', telefono: sol.client_phone || '' }, todosClientes)
    const clienteConocido = matchResult.match !== 'ninguno' ? matchResult.cliente : null

    const estadoOptions = Object.entries(STATUS_LABELS).map(([v, l]) =>
        `<option value="${v}"${convStatus === v ? ' selected' : ''}>${l}</option>`
    ).join('')

    if (!esCondensada) _preFillBorradorSiVacio(sol)

    const urlReserva = `formulario.html?solicitud_id=${sol.id}`

    const origenLabel = esSfcomConf ? '· <strong style="color:#dc2626">sfcom</strong>'
                      : esCancelada ? '· <strong style="color:#9d174d">sfcom_c</strong>'
                      : esEmail     ? '· email'
                      : '· web'

    const fechaCompleta = (sol.updated_at ?? sol.created_at)
        ? new Date(sol.updated_at ?? sol.created_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—'

    const logItems = _parsearLog(sol.conversation_notes)

    // Bloque CTA contextual: solo cuando hay una acción primaria específica
    const ctaBlockHTML = esSfcomNueva
        ? `<div class="sol-acciones" style="margin-bottom:12px">
               <a class="btn btn-primary" href="${urlReserva}" style="text-decoration:none;display:inline-flex;align-items:center;min-height:44px">→ Crear reserva</a>
               <button class="btn btn-danger sol-btn-descartar" style="min-height:44px">✕ Descartar</button>
           </div>`
        : esSfcomLead
        ? `<div class="sol-acciones" style="margin-bottom:12px">
               <button class="btn btn-primary" id="btnIntentarRecuperar" style="min-height:44px">🔄 Intentar recuperar</button>
               <button class="btn btn-danger sol-btn-descartar" style="min-height:44px">✕ Descartar</button>
           </div>`
        : esSeguimiento
        ? `<div style="margin-bottom:16px">
               <button class="btn btn-primary" id="btnEnviarRecordatorio" style="width:100%;min-height:44px">📩 Enviar recordatorio</button>
           </div>`
        : ''

    // Botones en toggle (Descartar lo tiene el CTA para sfcom activas; cerradas no lo necesitan)
    const accionesToggleHTML = `
        <div class="sol-acciones" style="margin-top:12px">
            <button class="btn btn-primary" id="btnAbrirAsistente" style="min-height:44px">💬 Abrir asistente</button>
            <a class="btn btn-secondary" href="${urlReserva}" style="text-decoration:none;display:inline-flex;align-items:center">📋 Convertir en reservas</a>
        </div>`

    // Botones en vista extendida (incluye Descartar)
    const accionesExtHTML = `
        <div class="sol-acciones" style="margin-top:12px">
            <button class="btn btn-primary" id="btnAbrirAsistente" style="min-height:44px">💬 Abrir asistente</button>
            <a class="btn btn-secondary" href="${urlReserva}" style="text-decoration:none;display:inline-flex;align-items:center">📋 Convertir en reservas</a>
            <button class="btn btn-danger sol-btn-descartar">✕ Descartar</button>
        </div>`

    detalle.innerHTML = `
        <div class="sol-detalle-inner">

            <div class="sol-detalle-header">
                <div style="min-width:0">
                    <div class="sol-detalle-nombre">${_esc(sol.client_name) || '—'}</div>
                    <div class="sol-detalle-contacto">${contactoHTML}</div>
                    <div style="font-size:11px;color:var(--subtle);margin-top:3px">
                        ${fechaCompleta} ${origenLabel}
                    </div>
                </div>
                <div style="display:flex;align-items:flex-start;gap:8px;flex-shrink:0">
                    <select id="sol-select-estado" class="sol-estado-select">${estadoOptions}</select>
                    <button class="btn-cerrar-detalle" id="btnCerrarDetalle" title="Cerrar">✕</button>
                </div>
            </div>

            ${clienteConocido ? `
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:9px 14px;margin-bottom:12px;font-size:13px;color:#1e40af">
                <strong>👤 Cliente conocido:</strong> ${_esc(clienteConocido.id)}${clienteConocido.name ? ` — ${_esc(clienteConocido.name)}` : ''}
            </div>` : ''}

            ${esCondensada && (esSfcomConf || esSfcomLead) ? `
            <div class="sol-detalle-datos">
                <div class="sol-dato"><span class="sol-dato-label">Experiencia</span><span class="sol-dato-valor">${_esc(sol.proposal_draft?.[0]?.service_name || '—')}</span></div>
                <div class="sol-dato"><span class="sol-dato-label">Día</span><span class="sol-dato-valor">${sol.proposal_draft?.[0]?.day ? sol.proposal_draft[0].day + ' julio' : '—'}</span></div>
                <div class="sol-dato"><span class="sol-dato-label">Personas</span><span class="sol-dato-valor">${sol.proposal_draft?.[0]?.slots || '—'}</span></div>
                ${sol.comments ? `<div class="sol-dato sol-dato--full"><span class="sol-dato-label">Consulta</span><span class="sol-dato-valor">${_esc(sol.comments)}</span></div>` : ''}
            </div>` : ''}

            ${ctaBlockHTML}

            ${esCondensada ? `
            <div style="margin-top:4px;margin-bottom:4px">
                <button class="btn btn-secondary" id="btnGestion" style="width:100%;min-height:40px;font-size:13px">💬 Historial y gestión</button>
            </div>
            <div id="sol-extra" style="display:none;margin-top:4px">
                <div id="sol-borrador-container"></div>
                ${_commentsSection(sol)}
                ${_logSection(logItems)}
                ${accionesToggleHTML}
            </div>` : `
            <div id="sol-borrador-container"></div>
            ${_commentsSection(sol)}
            ${_logSection(logItems)}
            ${accionesExtHTML}`}

        </div>
    `

    detalle.classList.add('visible')

    // ── Borrador y log: vistas extendidas ────────────────────────────────────
    if (!esCondensada) {
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
        const logArea = document.getElementById('sol-log-area')
        if (logArea) {
            setTimeout(() => { logArea.scrollTop = logArea.scrollHeight }, 0)
            _initEditListeners(sol, logArea)
        }
        _initLogListeners(sol)
        _initCommentsListener(sol)
    }

    // ── Toggle historial: vistas condensadas ─────────────────────────────────
    if (esCondensada) {
        document.getElementById('btnGestion').addEventListener('click', () => {
            const extra   = document.getElementById('sol-extra')
            const visible = extra.style.display !== 'none'
            extra.style.display = visible ? 'none' : ''
            document.getElementById('btnGestion').textContent = visible ? '💬 Historial y gestión' : '▲ Ocultar historial'
            if (!visible && !extra.dataset.inited) {
                extra.dataset.inited = '1'
                _preFillBorradorSiVacio(sol)
                const bc = document.getElementById('sol-borrador-container')
                if (bc) _renderBorrador(sol, bc)
                _migrarConsultaAlLog(sol).then(() => {
                    const la = document.getElementById('sol-log-area')
                    if (la) {
                        la.innerHTML = _renderizarLog(_parsearLog(sol.conversation_notes))
                        _initEditListeners(sol, la)
                        setTimeout(() => { la.scrollTop = la.scrollHeight }, 0)
                    }
                })
                _initLogListeners(sol)
                _initCommentsListener(sol)
                document.getElementById('btnAbrirAsistente')?.addEventListener('click', () => {
                    const borrador = _parsearLog(sol.conversation_notes).filter(i => i.type === 'message').find(i => i.isDraft)
                    abrirAsistenteRespuesta(sol, null, borrador?.text ?? null)
                })
            }
        })
    }

    // ── Lead sfcom cancelado: CTA recuperar ──────────────────────────────────
    if (esSfcomLead) {
        document.getElementById('btnIntentarRecuperar')?.addEventListener('click', () => {
            abrirModalRecuperarSfcom(sol)
        })
    }

    // ── Estado: siempre visible en el header ─────────────────────────────────
    document.getElementById('sol-select-estado')?.addEventListener('change', async e => {
        const nuevoEstado = e.target.value
        const { error } = await supabase.from('reservation_requests').update({ status: nuevoEstado }).eq('id', sol.id)
        if (error) { console.error('Error actualizando estado:', error); return }
        sol.status = nuevoEstado
        _actualizarBadgeEstado(sol.id, nuevoEstado)
    })

    // ── Recordatorio ─────────────────────────────────────────────────────────
    document.getElementById('btnEnviarRecordatorio')?.addEventListener('click', () => {
        abrirModalRecordatorio(sol)
    })

    // ── Asistente: vistas extendidas ──────────────────────────────────────────
    if (!esCondensada) {
        document.getElementById('btnAbrirAsistente')?.addEventListener('click', () => {
            const borrador = _parsearLog(sol.conversation_notes).filter(i => i.type === 'message').find(i => i.isDraft)
            abrirAsistenteRespuesta(sol, null, borrador?.text ?? null)
        })
    }

    // ── Descartar (por clase — puede estar en CTA o en acciones) ─────────────
    detalle.querySelectorAll('.sol-btn-descartar').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('¿Descartar esta solicitud? Se marcará como descartada y dejará de aparecer en la lista activa.')) return
            const { error } = await supabase.from('reservation_requests').update({ status: 'descartada' }).eq('id', sol.id)
            if (error) { alert('Error al descartar: ' + error.message); return }
            detalle.classList.remove('visible')
            solicitudActual = null
            detalle.innerHTML = '<div class="sol-detalle-placeholder">Selecciona una solicitud para ver el detalle</div>'
            await cargarSolicitudes()
        })
    })

    // ── Cerrar detalle (móvil) ───────────────────────────────────────────────
    document.getElementById('btnCerrarDetalle').addEventListener('click', () => {
        detalle.classList.remove('visible')
        document.querySelectorAll('.sol-item').forEach(el => el.classList.remove('active'))
        solicitudActual = null
    })
}

function _inferirServiceIds(level) {
    const p = parsearNivel(level)
    if (!p) return []
    if (p.tipo === 'encierro') return [7, 8, 9, 10, 11, 12, 13, 14].map(d => `ENCIERRO_${d}`)
    return TIPO_SERVICIO_ID[p.tipo] ? [TIPO_SERVICIO_ID[p.tipo]] : []
}

function _calcularPrecioRef(sol) {
    const d0         = sol.proposal_draft?.[0] ?? null
    const serviceIds = d0?.service_id != null
        ? [d0.service_id]
        : serviceCodesToIds(_inferirServiceIds(d0?.service_name || null), disponibilidad ?? [])
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

// ===== MENSAJES DIRECTOS (SIN IA) =====

const _IDIOMA_LABELS = { es: 'Español', en: 'English', fr: 'Français', it: 'Italiano', de: 'Deutsch' }
const _IDIOMAS       = Object.keys(_IDIOMA_LABELS)

function _idiomaDefault(sol) {
    return _IDIOMAS.includes(sol.language) ? sol.language : 'es'
}

function _textoRecordatorio(nombre, lang) {
    const n = nombre || 'cliente'
    const t = {
        es: `Hola ${n},\n\nTe escribo para hacerte un seguimiento. ¿Has tenido oportunidad de revisar lo que te propusimos? Quedo a tu disposición para cualquier pregunta.\n\nUn saludo,\nPaula`,
        en: `Hi ${n},\n\nI'm just following up on our previous message. Have you had a chance to look into what we proposed? Feel free to reach out if you have any questions.\n\nBest regards,\nPaula`,
        fr: `Bonjour ${n},\n\nJe vous contacte pour faire un suivi. Avez-vous eu l'occasion de réfléchir à notre proposition ? Je reste disponible pour toute question.\n\nCordialement,\nPaula`,
        it: `Ciao ${n},\n\nLa contatto per un aggiornamento sulla nostra proposta. Ha avuto modo di valutarla? Sono a disposizione per qualsiasi domanda.\n\nCordiali saluti,\nPaula`,
        de: `Hallo ${n},\n\nIch melde mich bezüglich unseres Angebots. Hatten Sie Gelegenheit, es sich anzusehen? Bei Fragen stehe ich gerne zur Verfügung.\n\nMit freundlichen Grüßen,\nPaula`,
    }
    return t[lang] ?? t.es
}

function _textoRecuperarSfcom(nombre, lineas, lang) {
    const n = nombre || 'cliente'
    const fmtLineas = {
        es: l => `· ${l.service_name}${l.day ? ` (${l.day} de julio)` : ''}, ${l.slots} plaza${l.slots !== 1 ? 's' : ''}`,
        en: l => `· ${l.service_name}${l.day ? ` (July ${l.day})` : ''}, ${l.slots} person${l.slots !== 1 ? 's' : ''}`,
        fr: l => `· ${l.service_name}${l.day ? ` (le ${l.day} juillet)` : ''}, ${l.slots} personne${l.slots !== 1 ? 's' : ''}`,
        it: l => `· ${l.service_name}${l.day ? ` (${l.day} luglio)` : ''}, ${l.slots} persona${l.slots !== 1 ? 'e' : ''}`,
        de: l => `· ${l.service_name}${l.day ? ` (${l.day}. Juli)` : ''}, ${l.slots} Person${l.slots !== 1 ? 'en' : ''}`,
    }
    const fmt  = fmtLineas[lang] ?? fmtLineas.es
    const det  = lineas.length ? '\n' + lineas.map(fmt).join('\n') + '\n' : ''
    const t = {
        es: `Hola ${n},\n\nHemos visto que intentaste hacer una reserva en nuestra tienda online pero parece que no llegó a completarse, quizás por un problema con el pago u otro motivo técnico.${det}\nSi sigues interesado, podemos gestionarlo directamente contigo sin ningún problema. Escríbenos cuando puedas.\n\nUn saludo,\nPaula`,
        en: `Hi ${n},\n\nWe noticed that your reservation through our online store didn't go through — it may have been a payment issue or a technical glitch.${det}\nIf you're still interested, we can sort it out directly with no hassle. Just let us know.\n\nBest regards,\nPaula`,
        fr: `Bonjour ${n},\n\nNous avons vu que votre réservation sur notre boutique en ligne n'a pas abouti — peut-être un problème de paiement ou technique.${det}\nSi vous êtes toujours intéressé(e), nous pouvons le gérer directement sans aucun problème. N'hésitez pas à nous contacter.\n\nCordialement,\nPaula`,
        it: `Ciao ${n},\n\nAbbiamo visto che la sua prenotazione sul nostro negozio online non è andata a buon fine — forse un problema di pagamento o tecnico.${det}\nSe è ancora interessato/a, possiamo gestirlo direttamente senza alcun problema. Non esiti a contattarci.\n\nCordiali saluti,\nPaula`,
        de: `Hallo ${n},\n\nWir haben gesehen, dass Ihre Buchung in unserem Online-Shop nicht abgeschlossen wurde — möglicherweise ein Zahlungs- oder technisches Problem.${det}\nFalls Sie noch interessiert sind, können wir dies direkt und unkompliziert für Sie regeln. Melden Sie sich einfach.\n\nMit freundlichen Grüßen,\nPaula`,
    }
    return t[lang] ?? t.es
}

function _selectorIdioma(id, langActual) {
    return `<select id="${id}" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px">
        ${Object.entries(_IDIOMA_LABELS).map(([v, l]) => `<option value="${v}"${v === langActual ? ' selected' : ''}>${l}</option>`).join('')}
    </select>`
}

function abrirModalRecordatorio(sol) {
    const lang            = _idiomaDefault(sol)
    const nombre          = sol.client_name
    const necesitaSelector = !_IDIOMAS.includes(sol.language)
    const { overlay, panel } = crearModal('modal-recordatorio', { wide: true, scroll: true })

    const renderContenido = (langActual) => {
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                <div class="modal-header-title">Recordatorio — ${nombre}</div>
                <button id="btnCerrarRecordatorio" class="btn btn-secondary" style="padding:4px 10px">✕</button>
            </div>
            ${necesitaSelector ? `<div style="margin-bottom:10px;display:flex;align-items:center;gap:8px">
                <label style="font-size:13px;color:var(--text-muted)">Idioma:</label>
                ${_selectorIdioma('selIdiomaRec', langActual)}
            </div>` : ''}
            <textarea id="textoRecordatorio" class="modal-email-textarea" style="height:220px">${_textoRecordatorio(nombre, langActual)}</textarea>
            <div id="rec-botones-envio"></div>
            <div style="margin-top:10px;text-align:right">
                <button class="btn btn-secondary" id="btnAsistenteRec" style="font-size:13px">✏️ Mejorar con el asistente</button>
            </div>
        `
        panel.querySelector('#btnCerrarRecordatorio').addEventListener('click', () => overlay.close())
        panel.querySelector('#btnAsistenteRec').addEventListener('click', () => {
            overlay.close()
            abrirAsistenteRespuesta(sol, 'recordatorio')
        })
        if (necesitaSelector) {
            panel.querySelector('#selIdiomaRec').addEventListener('change', e => renderContenido(e.target.value))
        }
        mostrarOpcionesEnvio({
            email:     sol.client_email || null,
            telefono:  sol.client_phone || null,
            asunto:    'San Fermín — seguimiento',
            getTexto:  () => panel.querySelector('#textoRecordatorio').value,
            container: panel.querySelector('#rec-botones-envio'),
            onUsado:   async (texto) => {
                await _onRespuestaUsadaEnLog(texto, sol)
                overlay.close()
            }
        })
    }

    renderContenido(lang)
}

function abrirModalRecuperarSfcom(sol) {
    const lang   = _idiomaDefault(sol)
    const nombre = sol.client_name
    const lineas = Array.isArray(sol.proposal_draft) ? sol.proposal_draft.filter(l => l.service_name) : []
    const { overlay, panel } = crearModal('modal-recuperar-sfcom', { wide: true, scroll: true })

    const renderContenido = (langActual) => {
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                <div class="modal-header-title">Intentar recuperar — ${nombre}</div>
                <button id="btnCerrarRecuperar" class="btn btn-secondary" style="padding:4px 10px">✕</button>
            </div>
            <div style="margin-bottom:10px;display:flex;align-items:center;gap:8px">
                <label style="font-size:13px;color:var(--text-muted)">Idioma:</label>
                ${_selectorIdioma('selIdiomaRec2', langActual)}
            </div>
            <textarea id="textoRecuperar" class="modal-email-textarea" style="height:260px">${_textoRecuperarSfcom(nombre, lineas, langActual)}</textarea>
            <div id="rec2-botones-envio"></div>
            <div style="margin-top:10px;text-align:right">
                <button class="btn btn-secondary" id="btnAsistenteRec2" style="font-size:13px">✏️ Mejorar con el asistente</button>
            </div>
        `
        panel.querySelector('#btnCerrarRecuperar').addEventListener('click', () => overlay.close())
        panel.querySelector('#selIdiomaRec2').addEventListener('change', e => renderContenido(e.target.value))
        panel.querySelector('#btnAsistenteRec2').addEventListener('click', () => {
            overlay.close()
            abrirAsistenteRespuesta(sol, 'recuperar_lead')
        })
        mostrarOpcionesEnvio({
            email:     sol.client_email || null,
            telefono:  sol.client_phone || null,
            asunto:    'San Fermín — tu experiencia',
            getTexto:  () => panel.querySelector('#textoRecuperar').value,
            container: panel.querySelector('#rec2-botones-envio'),
            onUsado:   async (texto) => {
                await _onRespuestaUsadaEnLog(texto, sol)
                renderLista()
                overlay.close()
            }
        })
    }

    renderContenido(lang)
}

// ===== NOTAS DE SESIÓN =====

let _notasSesion = ''

function _actualizarPreviewNotas() {
    const el = document.getElementById('notasTexto')
    if (!el) return
    if (_notasSesion.trim()) {
        el.textContent   = _notasSesion
        el.style.fontStyle = ''
    } else {
        el.textContent   = 'Notas para el asistente… (clic para editar)'
        el.style.fontStyle = 'italic'
    }
}

function _initNotas() {
    const preview = document.getElementById('notasPreview')
    const edit    = document.getElementById('notasEdit')
    if (!preview || !edit) return

    preview.addEventListener('click', () => {
        edit.value = _notasSesion
        preview.style.display = 'none'
        edit.style.display = 'block'
        edit.focus()
    })

    let _guardadoAnterior = ''
    edit.addEventListener('focus', () => { _guardadoAnterior = edit.value })
    edit.addEventListener('blur', async () => {
        const nuevo = edit.value
        edit.style.display = 'none'
        preview.style.display = ''
        _notasSesion = nuevo
        _actualizarPreviewNotas()
        if (nuevo !== _guardadoAnterior) {
            await supabase.from('session_context').insert({ texto: nuevo })
                .catch(e => console.warn('[notas] Error guardando:', e))
        }
    })
}

async function _cargarNotasSesion() {
    try {
        const { data } = await supabase
            .from('session_context')
            .select('texto')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        _notasSesion = data?.texto || ''
    } catch (e) {
        console.warn('[notas] tabla session_context no disponible:', e)
    }
    _actualizarPreviewNotas()
}

// ===== INICIALIZACIÓN =====

document.getElementById('btnProcesarEmail').addEventListener('click', abrirProcesarEmail)

_initNotas()
_actualizarPreviewNotas()
_cargarNotasSesion()

// Importar cancelados de sfcom antes de cargar la lista para que aparezcan al abrir la página
const _sfcomListings = await loadSfcomListings(supabase)
const _sfcomResult   = await checkSfcomOrders(supabase).catch(() => ({ ok: false }))
if (_sfcomResult.ok && _sfcomResult.cancelados?.length) {
    await importarCanceladosSfcom(supabase, _sfcomListings, _sfcomResult.cancelados)
}
await cargarSolicitudes()
