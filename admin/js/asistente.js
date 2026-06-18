import { crearModal } from './modal.js'
import { mostrarToast } from './verificacion.js'
import { mostrarOpcionesEnvio } from './utils.js'
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
    if (!serviceHint) return []
    // Normaliza slugs web/sfcom ('vivir-el-chupinazo', 'ver-el-encierro') al keyword corto
    const partes = serviceHint.toLowerCase().split('-')
    const hint = partes.includes('encierro')  ? 'encierro'
               : partes.includes('chupinazo') ? 'chupinazo'
               : partes.includes('procesion') ? 'procesion'
               : partes.includes('gigantes')  ? 'gigantes'
               : partes.includes('pobre')     ? 'pobre_de_mi'
               : serviceHint
    const FIJOS = {
        chupinazo:   ['CHUPINAZO_6'],
        procesion:   ['PROCESION_7'],
        gigantes:    ['DESPEDIDA_GIGANTES_14'],
        pobre_de_mi: ['POBRE_DE_MI']
    }
    if (FIJOS[hint]) return FIJOS[hint]
    if (hint !== 'encierro') return []
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
    const tipoSolicitud = _esSfcom(solicitud.source) ? 'sfcom_reserva'
                        : solicitud.source === 'email' ? 'email'
                        : 'web'

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 style="font-size:15px;font-weight:600;margin:0">💬 Asistente de respuesta</h3>
            <div style="display:flex;gap:10px;align-items:center">
                <button id="btn-guardar-log" style="background:none;border:none;cursor:pointer;font-size:11px;color:#9ca3af;text-decoration:underline;padding:0" title="Guardar conversación en Supabase">Guardar log</button>
                <button id="btn-asistente-cerrar" style="background:none;border:none;cursor:pointer;font-size:15px;color:#777;padding:4px 8px;line-height:1;border-radius:4px" title="Cerrar">✕</button>
            </div>
        </div>
        <div style="background:#f8f9fa;border-radius:8px;padding:12px;font-size:12px;color:#444;display:grid;grid-template-columns:1fr 1fr;gap:5px 16px">
            <div><strong>Cliente:</strong> ${solicitud.client_name || '—'}</div>
            <div><strong>Contacto:</strong> ${contacto}</div>
            <div><strong>Evento:</strong> ${solicitud.level || solicitud.service_id || 'No especificado'}</div>
            <div><strong>Día:</strong> ${solicitud.day ? solicitud.day + ' julio' : 'No especificado'}</div>
            <div><strong>Personas:</strong> ${solicitud.slots || 'No especificado'}</div>
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
    const meta       = parsearMetaComments(solicitud.comments)
    const svcPrinc   = expandirServiceIds(solicitud.level || null, solicitud.day, meta)
    const svcExtra   = meta.extra.flatMap(h => expandirServiceIds(h, null, { dias: null, flexible: true, extra: [] }))
    // Si level es null pero hay service_id directo (ej. solicitudes sfcom o email sin level), lo usamos como fallback
    const svcFromId  = (!svcPrinc.length && !svcExtra.length && solicitud.service_id) ? [solicitud.service_id] : []
    const serviceIds = [...new Set([...svcPrinc, ...svcExtra, ...svcFromId])]

    const comentarioLimpio = (solicitud.comments || '')
        .replace(/^(Días|Otros servicios):[^\n]*\n?/gm, '').trim() || null

    const rawLog          = solicitud.conversation_notes || null
    const conversationLog = rawLog && rawLog.length > 2000
        ? '[... conversación anterior truncada ...]\n' + rawLog.slice(-2000)
        : rawLog

    const contextoObj = {
        solicitud: {
            tipo:                tipoSolicitud,
            nombre:              solicitud.client_name  || null,
            evento:              solicitud.level || solicitud.service_id || null,
            dia:                 solicitud.day   || null,
            personas:            solicitud.slots || null,
            idioma:              solicitud.language || 'desconocido',
            comentario:          comentarioLimpio,
            conversation_log:    conversationLog,
            assigned_venue_id:   solicitud.assigned_venue_id   || null,
            conversation_status: solicitud.status || 'nueva',
            modo:                modo || null,
            proposal_draft:      solicitud.proposal_draft || []
        },
        disponibilidad: disponibilidadParaAsistente(serviceIds, solicitud.day || null, solicitud.slots || null)
    }

    const storageKey = solicitud.id ? `asistente_conv_${solicitud.id}` : null

    if (storageKey) {
        overlay.addEventListener('close', () => {
            if (mensajes.length > 0) sessionStorage.setItem(storageKey, JSON.stringify(mensajes))
        })
    }

    panel.querySelector('#btn-guardar-log').addEventListener('click', async () => {
        if (mensajes.length === 0) {
            mostrarToast('No hay conversación que guardar', '#6b7280')
            return
        }
        const { error } = await _supabase.from('assistant_logs').insert({
            solicitud_id:     solicitud.id    || null,
            client_name:      solicitud.client_name || null,
            event_hint:       solicitud.level || solicitud.service_id || null,
            messages:         mensajes,
            context_snapshot: contextoObj
        })
        if (error) {
            mostrarToast('❌ Error al guardar el log', '#991b1b')
            console.error('[log]', error)
        } else {
            mostrarToast('💾 Log guardado')
        }
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
    const { overlay, panel } = crearModal('modal-parsear-email', { wide: true, scroll: true })
    let textoEmail = ''

    function mostrarPaso1() {
        panel.innerHTML = `
            <h3 style="margin-top:0">📧 Procesar email de cliente</h3>
            <p style="color:#555;font-size:14px;margin-bottom:12px">Pega el texto completo del email. Puede incluir cabeceras, texto de reenvío, firmas, etc.</p>
            <textarea id="ep-textarea" rows="13" style="width:100%;box-sizing:border-box;font-size:13px;font-family:monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;resize:vertical" placeholder="Pega aquí el texto del email..."></textarea>
            <div id="ep-error" style="display:none;color:#dc2626;font-size:13px;margin-top:8px"></div>
            <div class="btn-row" style="margin-top:16px">
                <button class="btn btn-primary" id="ep-btn-procesar">Procesar con Claude</button>
                <button class="btn btn-secondary" id="ep-btn-cancelar">Cancelar</button>
            </div>
        `
        panel.querySelector('#ep-textarea').value = textoEmail

        panel.querySelector('#ep-btn-cancelar').addEventListener('click', () => overlay.close())

        panel.querySelector('#ep-btn-procesar').addEventListener('click', async () => {
            textoEmail = panel.querySelector('#ep-textarea').value.trim()
            const errorDiv = panel.querySelector('#ep-error')
            if (!textoEmail) {
                errorDiv.textContent = 'Pega el contenido del email antes de procesar.'
                errorDiv.style.display = 'block'
                return
            }
            const btn = panel.querySelector('#ep-btn-procesar')
            btn.disabled = true
            btn.textContent = 'Procesando…'
            errorDiv.style.display = 'none'
            try {
                const { data, error } = await _supabase.functions.invoke('claude-proxy', {
                    body: {
                        model:      'claude-haiku-4-5-20251001',
                        max_tokens: 500,
                        system:     SYSTEM_PROMPT_PARSING,
                        messages:   [{ role: 'user', content: textoEmail }]
                    }
                })
                if (error) throw new Error(error.message || 'Error al invocar claude-proxy')
                const rawText   = String(data?.content?.[0]?.text ?? '').trim()
                const jsonMatch = rawText.match(/\{[\s\S]*\}/)
                if (!jsonMatch) throw new Error('Claude no devolvió JSON válido')
                const parsed = JSON.parse(jsonMatch[0])
                mostrarPasoRevision({ ...parsed, _emailRaw: textoEmail.slice(0, 2000) })
            } catch (err) {
                errorDiv.textContent = `Error: ${err.message}`
                errorDiv.style.display = 'block'
                btn.disabled = false
                btn.textContent = 'Procesar con Claude'
            }
        })
    }

    function mostrarPasoRevision(parsed) {
        const EVENTOS = [
            ['', '— No identificado —'], ['encierro', 'Encierro'],
            ['chupinazo', 'Chupinazo'], ['procesion', 'Procesión'],
            ['gigantes', 'Gigantes'], ['pobre_de_mi', 'Pobre de Mí'],
            ['personalizada', 'Personalizada'], ['empresa', 'Empresa'], ['hotel', 'Hotel']
        ]
        const IDIOMAS = [
            ['es', 'Español'], ['en', 'Inglés'], ['fr', 'Francés'],
            ['it', 'Italiano'], ['de', 'Alemán'], ['other', 'Otro']
        ]
        const extras = [
            parsed.days_all?.length > 1        ? `Días detectados: ${parsed.days_all.join(', ')}` : null,
            parsed.days_flexible               ? 'Flexible con el día' : null,
            parsed.service_hint_extra?.length  ? `Otros eventos: ${parsed.service_hint_extra.join(', ')}` : null
        ].filter(Boolean).join(' · ')

        const esc = v => (v ?? '').toString()
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

        panel.innerHTML = `
            <h3 style="margin-top:0">📋 Datos parseados — revisa y corrige</h3>
            ${extras ? `<p style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;padding:8px 12px;font-size:12px;color:#1e40af;margin-bottom:16px">${extras}</p>` : ''}
            <div class="form-grid">
                <div class="form-field">
                    <label>Nombre</label>
                    <input id="ep-nombre" type="text" value="${esc(parsed.client_name || '')}" placeholder="Nombre del cliente">
                </div>
                <div class="form-field">
                    <label>Email</label>
                    <input id="ep-email" type="text" value="${esc(parsed.client_email || '')}" placeholder="Email">
                </div>
                <div class="form-field">
                    <label>Teléfono</label>
                    <input id="ep-tel" type="text" value="${esc(parsed.client_phone || '')}" placeholder="Teléfono">
                </div>
                <div class="form-field">
                    <label>Evento principal</label>
                    <select id="ep-evento">
                        ${EVENTOS.map(([v, l]) => `<option value="${v}"${parsed.service_hint === v ? ' selected' : ''}>${l}</option>`).join('')}
                    </select>
                </div>
                <div class="form-field">
                    <label>Día de julio</label>
                    <input id="ep-dia" type="number" min="6" max="14" value="${parsed.day || ''}" placeholder="6–14">
                </div>
                <div class="form-field">
                    <label>Personas</label>
                    <input id="ep-personas" type="number" min="1" value="${parsed.slots || ''}" placeholder="Nº personas">
                </div>
                <div class="form-field">
                    <label>Idioma</label>
                    <select id="ep-idioma">
                        ${IDIOMAS.map(([v, l]) => `<option value="${v}"${parsed.language === v ? ' selected' : ''}>${l}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-field" style="margin-top:12px">
                <label>Resumen (editable)</label>
                <textarea id="ep-resumen" rows="4" style="width:100%;box-sizing:border-box;font-size:13px;padding:8px;border:1px solid #d1d5db;border-radius:4px">${esc(parsed.comments || '')}</textarea>
            </div>
            <div id="ep-error2" style="display:none;color:#dc2626;font-size:13px;margin-top:8px"></div>
            <div class="btn-row" style="margin-top:16px">
                <button class="btn btn-primary" id="ep-btn-guardar-responder">💬 Guardar y responder</button>
                <button class="btn btn-secondary" id="ep-btn-solo-guardar">Solo guardar</button>
                <button class="btn btn-secondary" id="ep-btn-volver">← Volver</button>
            </div>
        `

        const getCampos = () => ({
            client_name:        panel.querySelector('#ep-nombre').value.trim()      || null,
            client_email:       panel.querySelector('#ep-email').value.trim()       || null,
            client_phone:       panel.querySelector('#ep-tel').value.trim()         || null,
            service_hint:       panel.querySelector('#ep-evento').value             || null,
            day:                parseInt(panel.querySelector('#ep-dia').value)      || null,
            slots:              parseInt(panel.querySelector('#ep-personas').value) || null,
            language:           panel.querySelector('#ep-idioma').value,
            comments_resumen:   panel.querySelector('#ep-resumen').value.trim(),
            days_all:           parsed.days_all           || [],
            days_flexible:      parsed.days_flexible      || false,
            service_hint_extra: parsed.service_hint_extra || [],
            _emailRaw:          parsed._emailRaw          || null
        })

        async function guardar(abrirAsistente) {
            const btnGR  = panel.querySelector('#ep-btn-guardar-responder')
            const btnSG  = panel.querySelector('#ep-btn-solo-guardar')
            const errDiv = panel.querySelector('#ep-error2')
            btnGR.disabled = btnSG.disabled = true
            errDiv.style.display = 'none'
            try {
                const solicitud = await _insertarEmailParseado(getCampos())
                await _onEmailSaved()
                overlay.close()
                if (abrirAsistente) abrirAsistenteRespuesta(solicitud)
            } catch (err) {
                errDiv.textContent = `Error al guardar: ${err.message}`
                errDiv.style.display = 'block'
                btnGR.disabled = btnSG.disabled = false
            }
        }

        panel.querySelector('#ep-btn-guardar-responder').addEventListener('click', () => guardar(true))
        panel.querySelector('#ep-btn-solo-guardar').addEventListener('click', () => guardar(false))
        panel.querySelector('#ep-btn-volver').addEventListener('click', mostrarPaso1)
    }

    mostrarPaso1()
    overlay.showModal()
}

async function _insertarEmailParseado(campos) {
    let prefix = ''
    if (campos.days_flexible) {
        prefix += 'Días: cualquiera\n'
    } else if (campos.days_all.length > 1) {
        prefix += `Días: ${campos.days_all.join(', ')}\n`
    }
    if (campos.service_hint_extra.length > 0) {
        prefix += `Otros servicios: ${campos.service_hint_extra.join(', ')}\n`
    }
    const finalComments = prefix
        ? prefix + '\n' + campos.comments_resumen
        : campos.comments_resumen

    const { data, error } = await _supabase
        .from('reservation_requests')
        .insert({
            client_name:  campos.client_name  || 'Sin nombre',
            client_email: campos.client_email || null,
            client_phone: campos.client_phone || null,
            service_id:   null,
            slots:        campos.slots        || null,
            day:          campos.day          || null,
            level:        campos.service_hint || null,
            comments:     finalComments,
            source:       'email',
            status:       'nueva',
            language:     campos.language     || 'es',
            email_raw:    campos._emailRaw    || null
        })
        .select()
        .single()

    if (error) throw new Error(error.message)
    return data
}
