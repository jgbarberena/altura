import { crearModal } from './modal.js'
import { mostrarToast } from './verificacion.js'
import { mostrarOpcionesEnvio, parsearNivel, TIPO_SERVICIO_ID, construirItemBorrador } from './utils.js'
import { SYSTEM_PROMPT_ASISTENTE, SYSTEM_PROMPT_PARSING } from './asistente-config.js'

let _supabase, _getDisponibilidad, _getTodasReservas, _onEmailSaved, _esSfcom, _onRespuestaUsada, _onBorradorActualizado, _getNotasSesion

export function initAsistente(supabase, { getDisponibilidad, getTodasReservas, onEmailSaved, esSfcom, onRespuestaUsada, onBorradorActualizado, getNotasSesion }) {
    _supabase                = supabase
    _getDisponibilidad       = getDisponibilidad
    _getTodasReservas        = getTodasReservas
    _onEmailSaved            = onEmailSaved
    _esSfcom                 = esSfcom
    _onRespuestaUsada        = onRespuestaUsada        ?? null
    _onBorradorActualizado   = onBorradorActualizado   ?? null
    _getNotasSesion          = getNotasSesion          ?? null
}

// ===== HELPERS DE CONTEXTO =====

function parsearMetaComments(comments) {
    if (!comments) return { dias: null, flexible: false, extra: [] }
    const diasMatch = comments.match(/^Días:\s*(.+)$/m)
    const svcMatch  = comments.match(/^Otros servicios:\s*(.+)$/m)
    let dias = null, flexible = false
    if (diasMatch) {
        if (diasMatch[1].trim() === 'cualquiera') {
            flexible = true
        } else {
            const parsed = diasMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => n >= 6 && n <= 14)
            if (parsed.length) dias = parsed
        }
    }
    const extra = svcMatch ? svcMatch[1].split(',').map(s => s.trim()).filter(Boolean) : []
    return { dias, flexible, extra }
}

function expandirServiceIds(serviceHint, day, meta) {
    const p = parsearNivel(serviceHint)
    if (!p) return []
    if (p.tipo !== 'encierro') return [TIPO_SERVICIO_ID[p.tipo]].filter(Boolean)
    const todosDias = [7, 8, 9, 10, 11, 12, 13, 14]
    if (meta.flexible || (!meta.dias && !day)) return todosDias.map(d => `ENCIERRO_${d}`)
    const dias = meta.dias?.length ? meta.dias : (day ? [day] : todosDias)
    return dias.map(d => `ENCIERRO_${d}`)
}

function disponibilidadParaAsistente(serviceIds, primaryDay, personas) {
    const disponibilidad = _getDisponibilidad()
    const todasReservas  = _getTodasReservas()
    if (!serviceIds?.length || !disponibilidad) return []

    // Map service_id → event_type using availability data (reservations don't include event_type)
    const sidToEventType = {}
    for (const row of disponibilidad) {
        if (row.service_id && row.event_type) sidToEventType[row.service_id] = row.event_type
    }

    // Top-quartile sale price per venue+event_type — filters out negotiated corporate prices
    const salesByKey = {}
    for (const r of (todasReservas || [])) {
        if (!['Confirmada', 'Pendiente'].includes(r.status) || !r.price_per_slot) continue
        const et = sidToEventType[r.service_id]
        if (!et) continue
        const k = `${r.venue_id}::${et}`
        if (!salesByKey[k]) salesByKey[k] = []
        salesByKey[k].push(r.price_per_slot)
    }

    function topQuartile(prices) {
        if (!prices?.length) return null
        const sorted = [...prices].sort((a, b) => b - a)
        const top    = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)))
        const mn = Math.min(...top), mx = Math.max(...top)
        return mn === mx ? mn : `${mn}-${mx}`
    }

    // Group by venue+event_type, applying availability filters per day
    const RE_DIA = /_(\d+)$/
    const groups  = {}

    for (const sid of serviceIds) {
        const rows   = disponibilidad.filter(d => d.service_id === sid)
        const diaNum = parseInt(sid.match(RE_DIA)?.[1]) || null

        for (const row of rows) {
            const activas   = (todasReservas || []).filter(r =>
                r.venue_id === row.venue_id && r.service_id === sid && r.status !== 'Cancelada'
            )
            const confirmed = activas.filter(r => r.status === 'Confirmada').reduce((s, r) => s + (r.slots || 0), 0)
            const pending   = activas.filter(r => r.status === 'Pendiente').reduce((s, r) => s + (r.slots || 0), 0)
            const libres    = Math.max(0, row.total_slots - confirmed - pending)
            const available = libres + pending

            if (personas ? available < personas : available === 0) continue

            const gk = `${row.venue_id}::${row.event_type}`
            if (!groups[gk]) {
                groups[gk] = {
                    venue_display_name: row.venue_display_name || null,
                    billing_model:      row.billing_model,
                    catalogo_url:       row.venue_slug && row.event_type
                        ? `https://www.experienciasanfermin.com/catalogo/balcon.html?v=${row.venue_slug}&et=${row.event_type}`
                        : null,
                    _event_type: row.event_type,
                    _precio:     topQuartile(salesByKey[gk] || []),
                    _dias:       []
                }
            }
            groups[gk]._dias.push({ dia: diaNum, libres, pending })
        }
    }

    const result = []
    for (const g of Object.values(groups)) {
        // Primary day first; remaining days ascending
        g._dias.sort((a, b) => {
            if (primaryDay && a.dia === primaryDay && b.dia !== primaryDay) return -1
            if (primaryDay && b.dia === primaryDay && a.dia !== primaryDay) return 1
            return (a.dia || 0) - (b.dia || 0)
        })

        const entry = {
            venue_display_name: g.venue_display_name,
            billing_model:      g.billing_model,
            catalogo_url:       g.catalogo_url
        }

        const buildDiaEntry = d => {
            const de = { dia: d.dia, plazas: d.libres }
            if (d.pending > 0) de.plazas_pendientes = d.pending
            if (g._precio !== null) de.precio = g._precio
            return de
        }

        if (g._event_type === 'encierro') {
            entry.dias = g._dias.map(buildDiaEntry)
        } else {
            const d = g._dias[0]
            entry.plazas = d.libres
            if (d.pending > 0) entry.plazas_pendientes = d.pending
            if (g._precio !== null) entry.precio = g._precio
        }

        result.push(entry)
    }

    const sumField = (entry, field) => entry.dias
        ? entry.dias.reduce((s, d) => s + (d[field] || 0), 0)
        : (entry[field] || 0)

    // Sort: capacity first, then libres DESC, then plazas_pendientes DESC
    return result.sort((a, b) => {
        if (a.billing_model === 'capacity' && b.billing_model !== 'capacity') return -1
        if (a.billing_model !== 'capacity' && b.billing_model === 'capacity') return 1
        const diff = sumField(b, 'plazas') - sumField(a, 'plazas')
        if (diff !== 0) return diff
        return sumField(b, 'plazas_pendientes') - sumField(a, 'plazas_pendientes')
    })
}

// ===== ASISTENTE DE RESPUESTAS =====

export async function abrirAsistenteRespuesta(solicitud, modo = null) {
    let mensajes = []
    let enviando   = false

    const { overlay, panel } = crearModal('modal-asistente-respuesta', { wide: true, scroll: true })

    const contacto      = [solicitud.client_email, solicitud.client_phone].filter(Boolean).join(' · ') || '—'
    const tipoSolicitud = _esSfcom(solicitud.source)                  ? 'sfcom_reserva'
                        : solicitud.source?.startsWith('sfcom_c:') ? 'sfcom_lead'
                        : solicitud.source === 'email'             ? 'email'
                        : 'web'

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 style="font-size:15px;font-weight:600;margin:0">💬 Asistente de respuesta</h3>
            <div style="display:flex;gap:10px;align-items:center">
                <label id="lbl-autolog" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;color:#9ca3af;user-select:none" title="Guardar conversación en Supabase al cerrar">
                    <span id="autolog-track" style="display:inline-block;width:30px;height:17px;border-radius:9px;background:#d1d5db;position:relative;flex-shrink:0;transition:background .15s">
                        <span id="autolog-thumb" style="position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s"></span>
                    </span>
                    Auto-guardar log
                </label>
                <button id="btn-asistente-cerrar" style="background:none;border:none;cursor:pointer;font-size:15px;color:#777;padding:4px 8px;line-height:1;border-radius:4px" title="Cerrar">✕</button>
            </div>
        </div>
        <div style="background:#f8f9fa;border-radius:8px;padding:12px;font-size:12px;color:#444;display:grid;grid-template-columns:1fr 1fr;gap:5px 16px">
            <div><strong>Cliente:</strong> ${solicitud.client_name || '—'}</div>
            <div><strong>Contacto:</strong> ${contacto}</div>
            <div><strong>Evento:</strong> ${solicitud.proposal_draft?.[0]?.service_name || solicitud.proposal_draft?.[0]?.service_id || 'No especificado'}</div>
            <div><strong>Día:</strong> ${solicitud.proposal_draft?.[0]?.day ? solicitud.proposal_draft[0].day + ' julio' : 'No especificado'}</div>
            <div><strong>Personas:</strong> ${solicitud.proposal_draft?.[0]?.slots || 'No especificado'}</div>
            <div><strong>Idioma:</strong> ${solicitud.language || 'desconocido'}</div>
            <div style="grid-column:1/-1"><strong>Consulta:</strong> ${solicitud.comments || '—'}</div>
        </div>
        <div id="asistente-mensajes" style="display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto;padding:4px 2px"></div>
        <div style="display:flex;gap:8px;align-items:flex-end">
            <textarea id="asistente-input"
                placeholder="Escribe qué quieres ofrecer o pide un cambio…"
                style="flex:1;resize:none;min-height:44px;max-height:120px;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;font-family:inherit"
                rows="2"></textarea>
            <button id="asistente-enviar" class="btn btn-primary" style="white-space:nowrap;flex-shrink:0">Enviar</button>
        </div>
        <div id="asistente-resultado" style="display:none;flex-direction:column;gap:10px">
            <div style="font-size:12px;font-weight:600;color:#374151">✅ Mensaje para el cliente:</div>
            <textarea id="asistente-mensaje-final"
                style="width:100%;min-height:140px;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:13px;font-family:inherit;resize:vertical"></textarea>
            <div id="asistente-botones"></div>
        </div>
    `

    const elMensajes  = panel.querySelector('#asistente-mensajes')
    const elInput     = panel.querySelector('#asistente-input')
    const elEnviar    = panel.querySelector('#asistente-enviar')
    const elResultado = panel.querySelector('#asistente-resultado')
    const elMsgFinal  = panel.querySelector('#asistente-mensaje-final')
    const elCerrar    = panel.querySelector('#btn-asistente-cerrar')
    let _ultimoBorrador = null

    function addMensaje(role, texto) {
        const el = document.createElement('div')
        el.style.cssText = role === 'assistant'
            ? 'background:#f0f4ff;border-radius:8px 8px 8px 2px;padding:10px 12px;font-size:13px;max-width:92%;align-self:flex-start;white-space:pre-wrap;line-height:1.5'
            : 'background:#e8f5e9;border-radius:8px 8px 2px 8px;padding:10px 12px;font-size:13px;max-width:92%;align-self:flex-end;white-space:pre-wrap;line-height:1.5'
        el.textContent = texto
        elMensajes.appendChild(el)
        elMensajes.scrollTop = elMensajes.scrollHeight
    }

    function mostrarCargando() {
        const el = document.createElement('div')
        el.id = 'asistente-spinner'
        el.style.cssText = 'background:#f0f4ff;border-radius:8px;padding:10px 12px;font-size:13px;color:#888;align-self:flex-start'
        el.textContent = '…'
        elMensajes.appendChild(el)
        elMensajes.scrollTop = elMensajes.scrollHeight
        return el
    }

    async function llamarClaude(userContent) {
        mensajes.push({ role: 'user', content: userContent })

        const spinner = mostrarCargando()
        elEnviar.disabled = true
        enviando = true

        try {
            const notasSesion = _getNotasSesion?.() || ''
            const system = [
                { type: 'text', text: SYSTEM_PROMPT_ASISTENTE, cache_control: { type: 'ephemeral' } }
            ]
            if (notasSesion.trim()) {
                system.push({
                    type: 'text',
                    text: `CONTEXTO DE SESIÓN (notas de Paula):\n${notasSesion}`,
                    cache_control: { type: 'ephemeral' }
                })
            }

            const mensajesParaEnviar = [...mensajes]
            if (mensajesParaEnviar.length >= 2) {
                const penultimo = mensajesParaEnviar[mensajesParaEnviar.length - 2]
                const content = typeof penultimo.content === 'string'
                    ? [{ type: 'text', text: penultimo.content, cache_control: { type: 'ephemeral' } }]
                    : penultimo.content.map((b, i) =>
                        i === penultimo.content.length - 1
                            ? { ...b, cache_control: { type: 'ephemeral' } }
                            : b
                      )
                mensajesParaEnviar[mensajesParaEnviar.length - 2] = { ...penultimo, content }
            }

            const { data, error } = await _supabase.functions.invoke('claude-proxy', {
                body: { messages: mensajesParaEnviar, system, max_tokens: 1000 }
            })

            spinner.remove()

            if (error) throw new Error(error.message || 'Error en claude-proxy')

            const respuesta = data?.content?.[0]?.text ?? ''
            if (!respuesta) throw new Error('Respuesta vacía de Claude')

            const MARKER         = '---MENSAJE_CLIENTE---'
            const MARKER_BORRADOR = '---BORRADOR---'
            const markerIdx      = respuesta.indexOf(MARKER)

            let textoChat, mensajeFinal, borradorDraft = null
            if (markerIdx !== -1) {
                textoChat = respuesta.slice(0, markerIdx).trim()
                const resto = respuesta.slice(markerIdx + MARKER.length)
                const borradorIdx = resto.indexOf(MARKER_BORRADOR)
                if (borradorIdx !== -1) {
                    mensajeFinal = resto.slice(0, borradorIdx).trim()
                    const jsonStr = resto.slice(borradorIdx + MARKER_BORRADOR.length).trim()
                    try { borradorDraft = JSON.parse(jsonStr) } catch(e) { console.warn('[borrador] JSON inválido:', jsonStr) }
                } else {
                    mensajeFinal = resto.trim()
                }
            } else {
                textoChat    = respuesta
                mensajeFinal = null
            }

            if (textoChat) addMensaje('assistant', textoChat)

            mensajes.push({ role: 'assistant', content: respuesta })

            if (mensajeFinal) {
                elMsgFinal.value                = mensajeFinal
                elResultado.style.display       = 'flex'
                elResultado.style.flexDirection = 'column'
                elResultado.style.gap           = '10px'

                _ultimoBorrador = borradorDraft

                mostrarOpcionesEnvio({
                    email:     solicitud.client_email,
                    telefono:  solicitud.client_phone,
                    asunto:    'San Fermín 2026 · tu reserva',
                    getTexto:  () => elMsgFinal.value,
                    container: panel.querySelector('#asistente-botones'),
                    onUsado:   _alUsarBoton
                })
            }
        } catch (err) {
            mensajes.pop()
            spinner.remove()
            addMensaje('assistant', '❌ Error al conectar con el asistente. Inténtalo de nuevo.')
            console.error('[asistente] Error:', err)
        } finally {
            elEnviar.disabled = false
            enviando = false
        }
    }

    async function _alUsarBoton(texto) {
        if (!texto) return
        // Actualizar el último mensaje del asistente con el texto editado por Paula
        const MARKER_USO = '---MENSAJE_CLIENTE---'
        for (let i = mensajes.length - 1; i >= 0; i--) {
            if (mensajes[i].role === 'assistant' && mensajes[i].content.includes(MARKER_USO)) {
                const idx = mensajes[i].content.indexOf(MARKER_USO)
                mensajes[i] = { ...mensajes[i], content: mensajes[i].content.slice(0, idx + MARKER_USO.length) + '\n' + texto }
                break
            }
        }
        if (_onRespuestaUsada) await _onRespuestaUsada(texto, solicitud)
        if (_ultimoBorrador !== null && _onBorradorActualizado) {
            await _onBorradorActualizado(solicitud.id, _ultimoBorrador)
        }
        elCerrar.textContent = '✓ Cerrar'
        elCerrar.style.cssText = 'background:#16a34a;color:#fff;border:none;cursor:pointer;font-size:13px;font-weight:600;padding:6px 12px;border-radius:6px'
    }

    // Event listeners del dialog
    elCerrar.addEventListener('click', () => overlay.close())

    elEnviar.addEventListener('click', async () => {
        if (enviando) return
        const texto = elInput.value.trim()
        if (!texto) return
        elInput.value = ''
        addMensaje('user', texto)
        await llamarClaude(texto)
    })

    elInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            elEnviar.click()
        }
    })

    elInput.addEventListener('input', () => {
        if (elResultado.style.display !== 'none' && elInput.value.trim()) {
            elResultado.style.display = 'none'
        }
    })

    // Contexto inicial
    const draft0     = solicitud.proposal_draft?.[0] ?? null
    const meta       = parsearMetaComments(solicitud.comments)
    const svcPrinc   = expandirServiceIds(draft0?.service_name || null, draft0?.day || null, meta)
    const svcExtra   = meta.extra.flatMap(h => expandirServiceIds(h, null, { dias: null, flexible: true, extra: [] }))
    const svcFromId  = (!svcPrinc.length && !svcExtra.length && draft0?.service_id) ? [draft0.service_id] : []
    const serviceIds = [...new Set([...svcPrinc, ...svcExtra, ...svcFromId])]

    const comentarioLimpio = (solicitud.comments || '')
        .replace(/^(Días|Otros servicios):[^\n]*\n?/gm, '').trim() || null

    const rawLog          = solicitud.conversation_notes || null
    const conversationLog = rawLog && rawLog.length > 2000
        ? '[... conversación anterior truncada ...]\n' + rawLog.slice(-2000)
        : rawLog

    const hasConversation = solicitud.conversation_notes?.includes('\n<Paula>\n') ?? false
    const modoEfectivo    = modo ?? (hasConversation ? 'seguimiento' : 'nueva')

    const contextoObj = {
        solicitud: {
            tipo:                tipoSolicitud,
            nombre:              solicitud.client_name  || null,
            evento:              draft0?.service_name || draft0?.service_id || null,
            dia:                 draft0?.day   || null,
            personas:            draft0?.slots || null,
            idioma:              solicitud.language || 'desconocido',
            comentario:          comentarioLimpio,
            conversation_log:    conversationLog,
            conversation_status: solicitud.status || 'nueva',
            modo:                modoEfectivo,
            proposal_draft:      solicitud.proposal_draft || []
        },
        disponibilidad: disponibilidadParaAsistente(serviceIds, draft0?.day || null, draft0?.slots || null)
    }

    const storageKey = solicitud.id ? `asistente_conv_${solicitud.id}` : null

    if (storageKey) {
        overlay.addEventListener('close', () => {
            if (mensajes.length > 0) sessionStorage.setItem(storageKey, JSON.stringify(mensajes))
        })
    }

    let _logGuardado = false
    async function _guardarLog() {
        if (mensajes.length === 0 || _logGuardado) return
        const { error } = await _supabase.from('assistant_logs').insert({
            solicitud_id:     solicitud.id    || null,
            client_name:      solicitud.client_name || null,
            event_hint:       draft0?.service_name || draft0?.service_id || null,
            messages:         mensajes,
            context_snapshot: contextoObj
        })
        if (error) {
            mostrarToast('❌ Error al guardar el log', '#991b1b')
            console.error('[log]', error)
        } else {
            mostrarToast('💾 Log guardado')
            _logGuardado = true
        }
    }

    const elAutologTrack = panel.querySelector('#autolog-track')
    const elAutologThumb = panel.querySelector('#autolog-thumb')
    let autolog = localStorage.getItem('asistente_autolog') !== 'false'

    function _setAutolog(on) {
        autolog = on
        localStorage.setItem('asistente_autolog', on ? 'true' : 'false')
        elAutologTrack.style.background = on ? '#16a34a' : '#d1d5db'
        elAutologThumb.style.left       = on ? '15px'   : '2px'
    }
    _setAutolog(autolog)

    panel.querySelector('#lbl-autolog').addEventListener('click', async () => {
        _setAutolog(!autolog)
        if (autolog) await _guardarLog()
    })

    overlay.addEventListener('close', async () => {
        if (autolog) await _guardarLog()
    })

    // Restore stored conversation or start fresh
    let hasHistory = false
    if (storageKey) {
        const guardado = sessionStorage.getItem(storageKey)
        if (guardado) {
            try {
                mensajes = JSON.parse(guardado)
                const MARKER          = '---MENSAJE_CLIENTE---'
                const MARKER_BORRADOR = '---BORRADOR---'
                let lastFinal = null
                // mensajes[0] is the context JSON payload, skip it for display
                for (let i = 1; i < mensajes.length; i++) {
                    const msg = mensajes[i]
                    if (msg.role === 'assistant') {
                        const idx = msg.content.indexOf(MARKER)
                        if (idx !== -1) {
                            const chat = msg.content.slice(0, idx).trim()
                            if (chat) addMensaje('assistant', chat)
                            const resto = msg.content.slice(idx + MARKER.length)
                            const bIdx  = resto.indexOf(MARKER_BORRADOR)
                            lastFinal = bIdx !== -1 ? resto.slice(0, bIdx).trim() : resto.trim()
                        } else {
                            addMensaje('assistant', msg.content)
                        }
                    } else {
                        addMensaje(msg.role, msg.content)
                    }
                }
                if (lastFinal) {
                    elMsgFinal.value                = lastFinal
                    elResultado.style.display       = 'flex'
                    elResultado.style.flexDirection = 'column'
                    elResultado.style.gap           = '10px'
                    mostrarOpcionesEnvio({
                        email:     solicitud.client_email,
                        telefono:  solicitud.client_phone,
                        asunto:    'San Fermín 2026 · tu reserva',
                        getTexto:  () => elMsgFinal.value,
                        container: panel.querySelector('#asistente-botones'),
                        onUsado:   _alUsarBoton
                    })
                }
                hasHistory = mensajes.length > 0
            } catch(e) {
                mensajes = []
            }
        }
    }

    if (!hasHistory) {
        console.log('[asistente] contexto tokens ~', Math.round(JSON.stringify(contextoObj).length / 4))
        await llamarClaude(JSON.stringify(contextoObj))
    }
}

// ===== PROCESAR EMAIL MANUAL =====

export async function abrirProcesarEmail() {
    const { overlay, panel } = crearModal('modal-nueva-solicitud', { wide: true, scroll: true })

    const IDIOMAS = [['es','Español'],['en','Inglés'],['fr','Francés'],['it','Italiano'],['de','Alemán'],['other','Otro']]
    const esc = v => (v ?? '').toString().replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

    // Cargar servicios desde availability_panel
    let servicios = []
    const { data: dispData } = await _supabase
        .from('availability_panel')
        .select('service_id, event_type')
        .order('service_id')
    const svcMap = new Map()
    for (const d of (dispData || [])) {
        if (svcMap.has(d.service_id)) continue
        const diaNum = parseInt(d.service_id.match(/_(\d+)$/)?.[1]) || null
        const etLabel = {encierro:'Encierro',chupinazo:'Chupinazo',procesion:'Procesión',gigantes:'Gigantes',pobre_de_mi:'Pobre de Mí'}[d.event_type] || d.event_type || d.service_id
        svcMap.set(d.service_id, { service_id: d.service_id, label: diaNum ? `${etLabel} - día ${diaNum}` : etLabel, event_type: d.event_type, day: diaNum })
    }
    servicios = [...svcMap.values()].sort((a, b) => {
        const ord = ['chupinazo','procesion','encierro','gigantes','pobre_de_mi']
        const ai = ord.indexOf(a.event_type), bi = ord.indexOf(b.event_type)
        if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
        return (a.day || 0) - (b.day || 0)
    })

    // Estado local del borrador (en memoria, sin autosave)
    let modalDraft = [{ service_id: null, service_name: null, day: null, slots: null, price: null, venue_id: null, venue_display_name: null, catalogo_url: null }]

    function _renderBorradorModal() {
        const serviceOpts = servicios.map(s => `<option value="${s.service_id}">${s.label}</option>`).join('')
        const filas = modalDraft.map((item, idx) => {
            const svc = servicios.find(s => s.service_id === item.service_id)
            const diaEnc = !!svc?.day
            return `<tr data-idx="${idx}">
                <td style="padding:2px">
                    <select class="mn-svc" data-idx="${idx}" style="font-size:12px;width:100%;min-height:30px">
                        <option value="">— Servicio —</option>
                        ${serviceOpts.replace(`value="${item.service_id}"`,`value="${item.service_id}" selected`)}
                    </select>
                </td>
                <td style="padding:2px">
                    <input class="mn-dia" data-idx="${idx}" type="number" min="6" max="14" value="${item.day||''}" placeholder="—"
                        style="width:42px;font-size:12px;min-height:30px;padding:3px;border:1px solid var(--border);border-radius:4px${diaEnc?';background:var(--bg-subtle,#f9fafb);color:var(--subtle)':''}"
                        ${diaEnc?'readonly':''}>
                </td>
                <td style="padding:2px">
                    <input class="mn-slots" data-idx="${idx}" type="number" min="1" value="${item.slots||''}" placeholder="—"
                        style="width:46px;font-size:12px;min-height:30px;padding:3px;border:1px solid var(--border);border-radius:4px">
                </td>
                <td style="padding:2px">
                    <input class="mn-venue" data-idx="${idx}" type="text" value="${esc(item.venue_display_name||'')}" placeholder="Venue / balcón"
                        style="width:100%;min-width:70px;font-size:12px;min-height:30px;padding:3px 4px;border:1px solid var(--border);border-radius:4px">
                </td>
                <td style="padding:2px">
                    <input class="mn-price" data-idx="${idx}" type="number" min="0" value="${item.price||''}" placeholder="—"
                        style="width:54px;font-size:12px;min-height:30px;padding:3px;border:1px solid var(--border);border-radius:4px">
                </td>
                <td style="padding:2px;text-align:center">
                    <button class="mn-del" data-idx="${idx}" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--subtle)">🗑</button>
                </td>
            </tr>`
        }).join('')
        return `
            <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--subtle)">Borrador de propuesta</span>
            <div style="overflow-x:auto;margin-top:4px">
                <table style="width:100%;border-collapse:collapse;font-size:12px">
                    <thead><tr style="border-bottom:1px solid var(--border)">
                        <th style="text-align:left;padding:3px 2px;font-size:10px;color:var(--subtle);font-weight:600;text-transform:uppercase">Servicio</th>
                        <th style="text-align:left;padding:3px 2px;font-size:10px;color:var(--subtle);font-weight:600;text-transform:uppercase;width:50px">Día</th>
                        <th style="text-align:left;padding:3px 2px;font-size:10px;color:var(--subtle);font-weight:600;text-transform:uppercase;width:52px">Pax</th>
                        <th style="text-align:left;padding:3px 2px;font-size:10px;color:var(--subtle);font-weight:600;text-transform:uppercase">Venue</th>
                        <th style="text-align:left;padding:3px 2px;font-size:10px;color:var(--subtle);font-weight:600;text-transform:uppercase;width:62px">€/pax</th>
                        <th style="width:26px"></th>
                    </tr></thead>
                    <tbody id="mn-tbody">${filas}</tbody>
                </table>
            </div>
            <button id="mn-add-row" style="margin-top:4px;background:none;border:1px dashed var(--border);border-radius:4px;padding:3px 8px;font-size:12px;color:var(--subtle);cursor:pointer;width:100%">+ Añadir servicio</button>`
    }

    function _bindBorrador() {
        const wrap = panel.querySelector('#mn-borrador-wrap')
        wrap.querySelectorAll('.mn-svc').forEach(sel => {
            sel.addEventListener('change', e => {
                const idx = parseInt(e.target.dataset.idx)
                const svc = servicios.find(s => s.service_id === e.target.value)
                modalDraft[idx].service_id   = e.target.value || null
                modalDraft[idx].service_name = svc?.label || null
                modalDraft[idx].day          = svc?.day || modalDraft[idx].day
                _rebind()
            })
        })
        wrap.querySelectorAll('.mn-dia').forEach(inp => inp.addEventListener('change', e => {
            modalDraft[parseInt(e.target.dataset.idx)].day = parseInt(e.target.value) || null
        }))
        wrap.querySelectorAll('.mn-slots').forEach(inp => inp.addEventListener('change', e => {
            modalDraft[parseInt(e.target.dataset.idx)].slots = parseInt(e.target.value) || null
        }))
        wrap.querySelectorAll('.mn-venue').forEach(inp => inp.addEventListener('change', e => {
            modalDraft[parseInt(e.target.dataset.idx)].venue_display_name = e.target.value.trim() || null
        }))
        wrap.querySelectorAll('.mn-price').forEach(inp => inp.addEventListener('change', e => {
            modalDraft[parseInt(e.target.dataset.idx)].price = parseFloat(e.target.value) || null
        }))
        wrap.querySelectorAll('.mn-del').forEach(btn => btn.addEventListener('click', e => {
            modalDraft.splice(parseInt(e.target.dataset.idx), 1)
            if (!modalDraft.length) modalDraft.push({ service_id:null, service_name:null, day:null, slots:null, price:null, venue_id:null, venue_display_name:null, catalogo_url:null })
            _rebind()
        }))
        wrap.querySelector('#mn-add-row')?.addEventListener('click', () => {
            modalDraft.push({ service_id:null, service_name:null, day:null, slots:null, price:null, venue_id:null, venue_display_name:null, catalogo_url:null })
            _rebind()
        })
    }

    function _rebind() {
        panel.querySelector('#mn-borrador-wrap').innerHTML = _renderBorradorModal()
        _bindBorrador()
    }

    function _leerDOMEnDraft() {
        panel.querySelectorAll('#mn-tbody tr').forEach(row => {
            const idx = parseInt(row.dataset.idx)
            if (isNaN(idx) || idx >= modalDraft.length) return
            const sel   = row.querySelector('.mn-svc')
            const dia   = row.querySelector('.mn-dia')
            const sl    = row.querySelector('.mn-slots')
            const venue = row.querySelector('.mn-venue')
            const price = row.querySelector('.mn-price')
            if (sel)   { const svc = servicios.find(s => s.service_id === sel.value); modalDraft[idx].service_id = sel.value||null; modalDraft[idx].service_name = svc?.label||null }
            if (dia && !dia.readOnly) modalDraft[idx].day               = parseInt(dia.value)     || null
            if (sl)                   modalDraft[idx].slots             = parseInt(sl.value)      || null
            if (venue)                modalDraft[idx].venue_display_name = venue.value.trim()     || null
            if (price)                modalDraft[idx].price             = parseFloat(price.value) || null
        })
    }

    function _getDraftFiltrado() {
        _leerDOMEnDraft()
        return modalDraft.filter(d => d.service_id || d.service_name || d.slots)
    }

    function _rellenarDesdeParseado(parsed) {
        if (parsed.client_name)  panel.querySelector('#mn-nombre').value = parsed.client_name
        if (parsed.client_email) panel.querySelector('#mn-email').value  = parsed.client_email
        if (parsed.client_phone) panel.querySelector('#mn-tel').value    = parsed.client_phone
        if (parsed.language)     panel.querySelector('#mn-idioma').value = parsed.language

        const hints = [parsed.service_hint, ...(parsed.service_hint_extra||[])].filter(Boolean)
        if (hints.length) {
            modalDraft = hints.map(hint => {
                const svc = servicios.find(s => s.event_type === hint && (!parsed.day || s.day === parsed.day))
                         || servicios.find(s => s.event_type === hint)
                if (svc) return { service_id: svc.service_id, service_name: svc.label, day: svc.day || parsed.day || null, slots: parsed.slots || null, price: parsed.price_hint || null, venue_id: null, venue_display_name: parsed.venue_hint || null, catalogo_url: null }
                return { service_id: null, service_name: hint, day: parsed.day || null, slots: parsed.slots || null, price: parsed.price_hint || null, venue_id: null, venue_display_name: parsed.venue_hint || null, catalogo_url: null }
            })
        } else if (parsed.day || parsed.slots) {
            if (modalDraft[0]) {
                if (parsed.day        && !modalDraft[0].day)                modalDraft[0].day                = parsed.day
                if (parsed.slots      && !modalDraft[0].slots)              modalDraft[0].slots              = parsed.slots
                if (parsed.venue_hint && !modalDraft[0].venue_display_name) modalDraft[0].venue_display_name = parsed.venue_hint
                if (parsed.price_hint && !modalDraft[0].price)              modalDraft[0].price              = parsed.price_hint
            }
        }
        _rebind()
    }

    function _validar() {
        const nombre = panel.querySelector('#mn-nombre').value.trim()
        const email  = panel.querySelector('#mn-email').value.trim()
        const tel    = panel.querySelector('#mn-tel').value.trim()
        if (!nombre)          return 'El nombre del cliente es obligatorio.'
        if (!email && !tel)   return 'Indica al menos un contacto: email o teléfono.'
        const draft = _getDraftFiltrado()
        if (!draft.length)    return 'Añade al menos un servicio en el borrador.'
        return null
    }

    function _render() {
        panel.innerHTML = `
            <h3 style="margin:0 0 8px;font-size:14px;font-weight:600">➕ Nueva consulta</h3>
            <div style="display:grid;grid-template-columns:2fr 2fr 2fr 60px;gap:6px;margin-bottom:10px;align-items:end">
                <div>
                    <label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--subtle);display:block;margin-bottom:2px">Nombre *</label>
                    <input id="mn-nombre" type="text" placeholder="Nombre del cliente" style="width:100%;box-sizing:border-box">
                </div>
                <div>
                    <label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--subtle);display:block;margin-bottom:2px">Email</label>
                    <input id="mn-email" type="text" placeholder="email@..." style="width:100%;box-sizing:border-box">
                </div>
                <div>
                    <label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--subtle);display:block;margin-bottom:2px">Teléfono</label>
                    <input id="mn-tel" type="text" placeholder="+34..." style="width:100%;box-sizing:border-box">
                </div>
                <div>
                    <label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--subtle);display:block;margin-bottom:2px">Idioma</label>
                    <select id="mn-idioma" style="width:100%">${IDIOMAS.map(([v])=>`<option value="${v}">${v==='other'?'…':v.toUpperCase()}</option>`).join('')}</select>
                </div>
            </div>
            <div id="mn-borrador-wrap" style="margin-bottom:10px">${_renderBorradorModal()}</div>
            <div style="margin-bottom:8px">
                <label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--subtle)">Mensaje / hilo del cliente</label>
                <textarea id="mn-texto" rows="5" style="width:100%;box-sizing:border-box;font-size:12px;font-family:monospace;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;resize:vertical;margin-top:4px" placeholder="Pega aquí el email, mensaje de WhatsApp, hilo de conversación..."></textarea>
            </div>
            <div style="margin-bottom:10px;display:flex;align-items:center;gap:10px">
                <button class="btn btn-secondary" id="mn-btn-parsear" style="font-size:12px">🤖 Procesar con IA</button>
                <span id="mn-parsear-status" style="font-size:12px;color:var(--subtle)"></span>
            </div>
            <div id="mn-error" style="display:none;color:#dc2626;font-size:13px;margin-bottom:8px"></div>
            <div class="btn-row">
                <button class="btn btn-primary" id="mn-btn-gr">💬 Guardar y responder</button>
                <button class="btn btn-secondary" id="mn-btn-sg">Solo guardar</button>
                <button class="btn btn-secondary" id="mn-btn-cancel">Cancelar</button>
            </div>`

        _bindBorrador()

        panel.querySelector('#mn-btn-cancel').addEventListener('click', () => overlay.close())

        panel.querySelector('#mn-btn-parsear').addEventListener('click', async () => {
            const texto  = panel.querySelector('#mn-texto').value.trim()
            const status = panel.querySelector('#mn-parsear-status')
            if (!texto) { status.textContent = 'Pega un texto primero.'; status.style.color = 'var(--subtle)'; return }
            const btn = panel.querySelector('#mn-btn-parsear')
            btn.disabled = true; btn.textContent = '⏳ Procesando…'; status.textContent = ''
            try {
                const { data, error } = await _supabase.functions.invoke('claude-proxy', {
                    body: { model: 'claude-haiku-4-5-20251001', max_tokens: 500, system: SYSTEM_PROMPT_PARSING, messages: [{ role: 'user', content: texto }] }
                })
                if (error) throw new Error(error.message || 'Error al invocar claude-proxy')
                const rawText = String(data?.content?.[0]?.text ?? '').trim()
                const match   = rawText.match(/\{[\s\S]*\}/)
                if (!match) throw new Error('Claude no devolvió JSON válido')
                _rellenarDesdeParseado(JSON.parse(match[0]))
                status.textContent = '✓ Datos rellenados — revisa y corrige si hace falta'
                status.style.color = '#16a34a'
            } catch (err) {
                status.textContent = `Error: ${err.message}`
                status.style.color = '#dc2626'
            } finally {
                btn.disabled = false; btn.textContent = '🤖 Procesar con IA'
            }
        })

        async function guardar(abrirAsistente) {
            const errDiv = panel.querySelector('#mn-error')
            const err = _validar()
            if (err) { errDiv.textContent = err; errDiv.style.display = 'block'; return }
            errDiv.style.display = 'none'
            const btnGR = panel.querySelector('#mn-btn-gr')
            const btnSG = panel.querySelector('#mn-btn-sg')
            btnGR.disabled = btnSG.disabled = true
            try {
                const campos = {
                    nombre: panel.querySelector('#mn-nombre').value.trim(),
                    email:  panel.querySelector('#mn-email').value.trim()  || null,
                    tel:    panel.querySelector('#mn-tel').value.trim()    || null,
                    idioma: panel.querySelector('#mn-idioma').value,
                    texto:  panel.querySelector('#mn-texto').value.trim()  || null,
                }
                const solicitud = await _insertarNuevaSolicitud(campos, _getDraftFiltrado())
                if (!solicitud) { btnGR.disabled = btnSG.disabled = false; return }
                await _onEmailSaved()
                overlay.close()
                if (abrirAsistente) abrirAsistenteRespuesta(solicitud)
            } catch (e) {
                errDiv.textContent = `Error al guardar: ${e.message}`
                errDiv.style.display = 'block'
                btnGR.disabled = btnSG.disabled = false
            }
        }

        panel.querySelector('#mn-btn-gr').addEventListener('click', () => guardar(true))
        panel.querySelector('#mn-btn-sg').addEventListener('click', () => guardar(false))
    }

    _render()
    overlay.showModal()
}

async function _insertarNuevaSolicitud(campos, draft) {
    if (campos.email || campos.tel) {
        const orClauses = [
            campos.email ? `client_email.eq.${campos.email.toLowerCase().trim()}` : null,
            campos.tel   ? `client_phone.eq.${campos.tel.trim()}` : null
        ].filter(Boolean).join(',')
        const { data: dupes } = await _supabase
            .from('reservation_requests')
            .select('id, client_name, status')
            .not('status', 'in', '("convertida","descartada")')
            .or(orClauses)
            .limit(3)
        if (dupes?.length) {
            const nombres = dupes.map(d => `${d.client_name} (${d.status})`).join(', ')
            if (!confirm(`Ya existe una solicitud abierta para este cliente: ${nombres}\n¿Crear de todas formas?`)) return null
        }
    }

    const hoy = new Date()
    const dd  = String(hoy.getDate()).padStart(2, '0')
    const mm  = String(hoy.getMonth() + 1).padStart(2, '0')
    const yy  = String(hoy.getFullYear()).slice(-2)

    let conversation_notes = null
    if (campos.texto) {
        conversation_notes = `---${dd}/${mm}/${yy}---\n<Cliente>\n${campos.texto.slice(0, 2000)}`
    } else if (draft.length) {
        const resumen = draft.map(d => [d.service_name||d.service_id, d.day?`día ${d.day}`:null, d.slots?`${d.slots} personas`:null].filter(Boolean).join(', ')).join(' · ')
        conversation_notes = `---${dd}/${mm}/${yy}---\n<Cliente>\n[Entrada manual: ${resumen}]`
    }

    const { data, error } = await _supabase
        .from('reservation_requests')
        .insert({
            client_name:        campos.nombre || null,
            client_email:       campos.email  || null,
            client_phone:       campos.tel    || null,
            language:           campos.idioma || 'es',
            source:             'email',
            status:             'nueva',
            proposal_draft:     draft.length ? draft : null,
            conversation_notes
        })
        .select()
        .single()

    if (error) throw new Error(error.message)
    return data
}
