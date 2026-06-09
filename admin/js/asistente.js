import { crearModal } from './modal.js'
import { mostrarToast } from './verificacion.js'
import { SYSTEM_PROMPT_ASISTENTE, SYSTEM_PROMPT_PARSING } from './asistente-config.js'

let _supabase, _getDisponibilidad, _getTodasReservas, _onEmailSaved, _esSfcom

export function initAsistente(supabase, { getDisponibilidad, getTodasReservas, onEmailSaved, esSfcom }) {
    _supabase          = supabase
    _getDisponibilidad = getDisponibilidad
    _getTodasReservas  = getTodasReservas
    _onEmailSaved      = onEmailSaved
    _esSfcom           = esSfcom
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
    const FIJOS = {
        chupinazo:   ['CHUPINAZO_6'],
        procesion:   ['PROCESION_7'],
        gigantes:    ['DESPEDIDA_GIGANTES_14'],
        pobre_de_mi: ['POBRE_DE_MI']
    }
    if (FIJOS[serviceHint]) return FIJOS[serviceHint]
    if (serviceHint !== 'encierro') return []
    const todosDias = [7, 8, 9, 10, 11, 12, 13, 14]
    if (meta.flexible || (!meta.dias && !day)) return todosDias.map(d => `ENCIERRO_${d}`)
    const dias = meta.dias?.length ? meta.dias : (day ? [day] : todosDias)
    return dias.map(d => `ENCIERRO_${d}`)
}

function disponibilidadParaAsistente(serviceIds) {
    const disponibilidad = _getDisponibilidad()
    const todasReservas  = _getTodasReservas()
    if (!serviceIds?.length || !disponibilidad) return []
    const RE_DIA = /_(\d+)$/
    return serviceIds
        .flatMap(sid => {
            const rows = disponibilidad.filter(d => d.service_id === sid)
            if (!rows.length) return []
            const diaMatch = sid.match(RE_DIA)
            const dia      = diaMatch ? parseInt(diaMatch[1]) : null
            return rows.map(d => {
                const activas  = (todasReservas || []).filter(r =>
                    r.venue_id === d.venue_id && r.service_id === d.service_id && r.status !== 'Cancelada'
                )
                const ocupadas = activas.reduce((s, r) => s + (r.slots || 0), 0)
                return {
                    service_id:      sid,
                    dia,
                    billing_model:   d.billing_model,
                    plazas_libres:   Math.max(0, d.total_slots - ocupadas),
                    coste_proveedor: d.price_per_slot
                }
            })
        })
        .sort((a, b) => {
            const aCapLibre = a.billing_model === 'capacity' && a.plazas_libres > 0
            const bCapLibre = b.billing_model === 'capacity' && b.plazas_libres > 0
            if (aCapLibre && !bCapLibre) return -1
            if (!aCapLibre && bCapLibre)  return 1
            if ((a.dia || 0) !== (b.dia || 0)) return (a.dia || 0) - (b.dia || 0)
            if (a.billing_model === 'capacity' && b.billing_model !== 'capacity') return -1
            if (a.billing_model !== 'capacity' && b.billing_model === 'capacity')  return 1
            return b.plazas_libres - a.plazas_libres
        })
}

function preciosReferencia(serviceIds) {
    const todasReservas = _getTodasReservas()
    if (!serviceIds?.length || !todasReservas) return {}
    const porServicio = {}
    todasReservas
        .filter(r => serviceIds.includes(r.service_id) && ['Confirmada', 'Pendiente'].includes(r.status))
        .forEach(r => {
            if (!porServicio[r.service_id]) porServicio[r.service_id] = []
            porServicio[r.service_id].push(r.price_per_slot)
        })
    const result = {}
    for (const [sid, prices] of Object.entries(porServicio)) {
        const min = Math.min(...prices)
        const max = Math.max(...prices)
        result[sid] = min === max ? min : `${min}-${max}`
    }
    return result
}

// ===== ASISTENTE DE RESPUESTAS =====

export async function abrirAsistenteRespuesta(solicitud) {
    const mensajes = []
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
                <button id="btn-asistente-cerrar" style="background:none;border:none;cursor:pointer;font-size:20px;color:#777;padding:0;line-height:1" title="Cerrar">✕</button>
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
            <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button id="btn-asistente-copiar" class="btn btn-secondary">📋 Copiar</button>
                ${solicitud.client_email ? `<a id="btn-asistente-email" class="btn btn-secondary" style="text-decoration:none">📧 Email</a>` : ''}
                ${solicitud.client_phone ? `<a id="btn-asistente-whatsapp" class="btn btn-secondary" style="text-decoration:none" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
            </div>
        </div>
    `

    const elMensajes  = panel.querySelector('#asistente-mensajes')
    const elInput     = panel.querySelector('#asistente-input')
    const elEnviar    = panel.querySelector('#asistente-enviar')
    const elResultado = panel.querySelector('#asistente-resultado')
    const elMsgFinal  = panel.querySelector('#asistente-mensaje-final')

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
            const { data, error } = await _supabase.functions.invoke('claude-proxy', {
                body: { messages: mensajes, system: SYSTEM_PROMPT_ASISTENTE, max_tokens: 1000 }
            })

            spinner.remove()

            if (error) throw new Error(error.message || 'Error en claude-proxy')

            const respuesta = data?.content?.[0]?.text ?? ''
            if (!respuesta) throw new Error('Respuesta vacía de Claude')

            const MARKER    = '---MENSAJE_CLIENTE---'
            const markerIdx = respuesta.indexOf(MARKER)

            let textoChat, mensajeFinal
            if (markerIdx !== -1) {
                textoChat    = respuesta.slice(0, markerIdx).trim()
                mensajeFinal = respuesta.slice(markerIdx + MARKER.length).trim()
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

                const btnEmail = panel.querySelector('#btn-asistente-email')
                const btnWA    = panel.querySelector('#btn-asistente-whatsapp')
                if (btnEmail && solicitud.client_email) {
                    btnEmail.href = `mailto:${solicitud.client_email}?body=${encodeURIComponent(mensajeFinal)}`
                }
                if (btnWA && solicitud.client_phone) {
                    const digits = (solicitud.client_phone).replace(/\D/g, '')
                    const intl   = digits.length <= 9 ? '34' + digits : digits
                    btnWA.href   = `https://wa.me/${intl}?text=${encodeURIComponent(mensajeFinal)}`
                }
            }
        } catch (err) {
            spinner.remove()
            addMensaje('assistant', '❌ Error al conectar con el asistente. Inténtalo de nuevo.')
            console.error('[asistente] Error:', err)
        } finally {
            elEnviar.disabled = false
            enviando = false
        }
    }

    // Event listeners del dialog
    panel.querySelector('#btn-asistente-cerrar').addEventListener('click', () => overlay.close())

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

    panel.querySelector('#btn-asistente-copiar')?.addEventListener('click', () => {
        navigator.clipboard.writeText(elMsgFinal.value)
            .then(() => mostrarToast('📋 Copiado al portapapeles'))
            .catch(() => mostrarToast('❌ No se pudo copiar', '#991b1b'))
    })

    // Contexto inicial
    const meta       = parsearMetaComments(solicitud.comments)
    const svcPrinc   = expandirServiceIds(solicitud.level || null, solicitud.day, meta)
    const svcExtra   = meta.extra.flatMap(h => expandirServiceIds(h, null, { dias: null, flexible: true, extra: [] }))
    const serviceIds = [...new Set([...svcPrinc, ...svcExtra])]

    const comentarioLimpio = (solicitud.comments || '')
        .replace(/^(Días|Otros servicios):[^\n]*\n?/gm, '').trim() || null

    const contextoObj = {
        solicitud: {
            tipo:       tipoSolicitud,
            nombre:     solicitud.client_name  || null,
            email:      solicitud.client_email || null,
            telefono:   solicitud.client_phone || null,
            evento:     solicitud.level || solicitud.service_id || null,
            dia:        solicitud.day   || null,
            personas:   solicitud.slots || null,
            idioma:     solicitud.language || 'desconocido',
            comentario: comentarioLimpio
        },
        disponibilidad: disponibilidadParaAsistente(serviceIds),
        precios:        preciosReferencia(serviceIds)
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

    await llamarClaude(JSON.stringify(contextoObj))
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
            status:       'email_parsed',
            language:     campos.language     || 'es',
            email_raw:    campos._emailRaw    || null
        })
        .select()
        .single()

    if (error) throw new Error(error.message)
    return data
}
