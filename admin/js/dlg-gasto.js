// dlg-gasto.js — Modal compartido para registrar facturas recibidas en el libro fiscal.
// Importado por fiscal.js y gastos.js.
// Parámetros: doc (objeto supplier_documents o null), provider (objeto providers o null),
//             onGuardado (() => void) — callback para refrescar la pantalla del caller.

import { supabase }                        from './supabase.js'
import { crearModal }                      from './modal.js'
import { mostrarToast }                    from './verificacion.js'
import { initPrecioInput, getPrecioValue, setPrecioValue, fmt, checkTrimCerrado, validarNif } from './utils.js'

export async function abrirDlgGasto(docOrId, provider, onGuardado) {
    let doc = (docOrId && typeof docOrId === 'object') ? docOrId : null

    if (docOrId != null && typeof docOrId !== 'object') {
        const { data } = await supabase
            .from('supplier_documents').select('*').eq('id', docOrId).single()
        if (!data) { alert('Documento no encontrado'); return }
        doc = data
    }

    if (!provider && doc?.provider_id) {
        const { data } = await supabase
            .from('providers').select('id, name, nif').eq('id', doc.provider_id).maybeSingle()
        provider = data ?? null
    }

    await _abrirModal(doc, provider, onGuardado)
}

async function _abrirModal(doc, provider, onGuardado) {
    const { data: closings } = await supabase.from('fiscal_closings')
        .select('year, quarter').eq('model', 'F69').not('presented_at', 'is', null)
    const closedSet = new Set((closings ?? []).map(c => `${c.year}-${c.quarter}`))

    const sinArch = !doc || doc.file_path?.endsWith('_sin_archivo')
    const ext     = (doc?.file_path ?? '').split('.').pop().toLowerCase()
    const isImg   = ['jpg', 'jpeg', 'png', 'webp'].includes(ext)
    const isPdf   = ext === 'pdf'

    let signedUrl = null
    if (!sinArch) {
        const { data } = await supabase.storage
            .from('supplier-invoices').createSignedUrl(doc.file_path, 3600)
        signedUrl = data?.signedUrl ?? null
    }
    const canPreview = !!signedUrl && (isImg || isPdf)

    const { panel } = crearModal('dlgGasto', { wide: true, scroll: true })
    if (canPreview) panel.classList.add('modal-panel--doc')

    const hoy  = new Date().toISOString().split('T')[0]

    // Los campos pre-extraídos por la IA en el alta tienen prioridad sobre los datos del proveedor.
    const pNom = doc?.issuer_name ?? provider?.name ?? ''
    const pNif = doc?.issuer_nif  ?? provider?.nif  ?? ''
    const subT = doc
        ? `${doc.concept || pNom || '—'} · ${(doc.expense_date ?? doc.uploaded_at ?? '').split('T')[0]}`
        : 'Nueva entrada'

    // Si la IA extrajo un nº de factura o es PDF → modo completo; imagen sin número → simplificada.
    let _tipo = (doc?.invoice_number || isPdf) ? 'full' : 'simp'

    let _vatLines = doc?.ai_vat_lines?.length
        ? doc.ai_vat_lines.map(l => ({ base: +(l.base||0), rate: +(l.rate||21), vat: +(l.vat||0) }))
        : [{ base: '', rate: 21, vat: '' }]

    // El botón "Leer con IA" se desactiva si los datos fiscales ya están pre-extraídos.
    const _aiYaExtraido = !!(doc?.issuer_nif || doc?.ai_vat_lines?.length)

    const _retentionDefault = doc?.irpf_rate === 15 ? 'profesional'
        : doc?.irpf_rate === 19 ? 'arrendamiento' : 'ninguna'

    function _renderVatLines() {
        return _vatLines.map((l, i) => `
            <div class="dlg-vat-line" data-idx="${i}"
                 style="display:grid;grid-template-columns:1fr 80px 1fr auto;gap:6px;align-items:end;margin-bottom:6px">
                <div class="form-field" style="margin:0">
                    <label style="font-size:11px">Base imponible (€)</label>
                    <input type="number" class="vat-base" step="0.01" placeholder="0.00" value="${l.base}"
                        oninput="_dlgVatCh(${i},'base',this.value)">
                </div>
                <div class="form-field" style="margin:0">
                    <label style="font-size:11px">IVA %</label>
                    <input type="number" class="vat-rate" step="0.1" value="${l.rate}"
                        oninput="_dlgVatCh(${i},'rate',this.value)">
                </div>
                <div class="form-field" style="margin:0">
                    <label style="font-size:11px">Cuota IVA (€)</label>
                    <input type="number" class="vat-vat" step="0.01" placeholder="0.00" value="${l.vat}"
                        style="background:var(--bg-subtle,#f3f4f6)" readonly>
                </div>
                ${_vatLines.length > 1
                    ? `<button class="btn btn-danger" style="padding:4px 8px;font-size:12px;align-self:flex-end"
                           onclick="_dlgVatRm(${i})">✕</button>`
                    : '<div></div>'}
            </div>`).join('')
    }

    const viewerHtml = canPreview ? `
        <div class="dlg-gasto-viewer">
            ${isImg
                ? `<img src="${signedUrl}" class="dlg-img" id="dlg-img" alt="documento">`
                : `<iframe src="${signedUrl}" class="dlg-img" title="documento" style="height:100%"></iframe>`}
            <a href="${signedUrl}" target="_blank"
               style="display:block;text-align:right;font-size:11px;color:var(--subtle);padding:3px 8px;border-top:1px solid var(--border);flex-shrink:0">⤢ Abrir en pestaña</a>
        </div>` : ''

    panel.innerHTML = `
        <div class="dialog-header">
            <div>
                <h2 class="dialog-titulo">📥 Registrar factura recibida</h2>
                <div style="font-size:12px;color:var(--subtle)">${subT}</div>
            </div>
            <button class="btn btn-secondary" onclick="document.getElementById('dlgGasto').close()">✕ Cerrar</button>
        </div>

        <div class="${canPreview ? 'dlg-gasto-layout' : ''}">
            ${viewerHtml}
            <div class="dlg-gasto-form">

                <div style="display:flex;gap:6px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
                    <button id="dlg-btn-simp" class="btn btn-primary" style="font-size:12px"
                        onclick="_dlgSetTipo('simp')">🧾 Ticket / simplificada</button>
                    <button id="dlg-btn-full" class="btn btn-secondary" style="font-size:12px"
                        onclick="_dlgSetTipo('full')">📄 Factura completa</button>
                    ${canPreview
                        ? `<button id="dlg-ia" class="btn btn-secondary" style="font-size:12px;margin-left:auto"
                             ${_aiYaExtraido ? 'disabled title="Los datos ya se han extraído; revísalos y ajústalos a mano si hace falta."' : ''}>✨ Leer con IA</button>`
                        : ''}
                </div>

                <div class="form-grid">
                    <div class="form-field">
                        <label>Emisor</label>
                        <input type="text" id="dlg-issuer-name" placeholder="Nombre del proveedor" value="${pNom}">
                    </div>
                    <div class="form-field">
                        <label>NIF <span id="dlg-nif-opt" style="color:var(--subtle);font-size:11px">(opcional)</span></label>
                        <input type="text" id="dlg-issuer-nif" placeholder="B12345678" value="${pNif}">
                    </div>
                    <div class="form-field" id="dlg-row-invnum" style="display:none">
                        <label>Nº factura</label>
                        <input type="text" id="dlg-invoice-number" placeholder="F-2026-001" value="${doc?.invoice_number ?? ''}">
                    </div>
                    <div class="form-field">
                        <label>Fecha</label>
                        <input type="date" id="dlg-issue-date" value="${doc?.issue_date ?? hoy}"
                            oninput="window._dlgCheckFecha(this.value)">
                    </div>
                </div>
                <div id="dlg-fecha-aviso" style="display:none;font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;padding:6px 10px;margin-top:6px"></div>

                <!-- Sección simplificada -->
                <div id="dlg-sec-simp" style="margin-top:10px">
                    <div class="form-grid">
                        <div class="form-field">
                            <label>IVA</label>
                            <select id="dlg-iva-simple" oninput="_dlgRecalcSimp()">
                                <option value="21">21 %</option>
                                <option value="10">10 %</option>
                                <option value="4">4 %</option>
                                <option value="0">0 % / exento</option>
                            </select>
                        </div>
                        <div class="form-field">
                            <label>Total (€)</label>
                            <input type="number" id="dlg-total-simp" step="0.01" placeholder="0.00"
                                oninput="_dlgRecalcSimp()">
                        </div>
                    </div>
                </div>

                <!-- Sección completa -->
                <div id="dlg-sec-full" style="display:none;margin-top:10px">
                    <div class="form-grid">
                        <div class="form-field">
                            <label>Fecha registro en libro</label>
                            <input type="date" id="dlg-booked-date" value="${hoy}">
                        </div>
                        <div class="form-field">
                            <label>Categoría</label>
                            <select id="dlg-category">
                                <option value="proveedores">Proveedores (balcones)</option>
                                <option value="arrendamiento">Arrendamiento</option>
                                <option value="servicios">Servicios profesionales</option>
                                <option value="suministros">Suministros</option>
                                <option value="otros">Otros</option>
                            </select>
                        </div>
                        <div class="form-field">
                            <label>% Deducible</label>
                            <input type="number" id="dlg-deductible" value="100" step="1" min="0" max="100">
                        </div>
                        <div class="form-field" style="display:flex;align-items:center;gap:8px;padding-top:22px">
                            <label class="check-inline" style="margin:0">
                                <input type="checkbox" id="dlg-capital"> Bien de inversión
                            </label>
                        </div>
                    </div>
                    <div style="margin-top:12px">
                        <div style="font-size:12px;font-weight:600;margin-bottom:8px">Líneas de IVA</div>
                        <div id="dlg-vat-lines">${_renderVatLines()}</div>
                        <button class="btn btn-secondary" style="font-size:12px;margin-top:4px"
                            onclick="_dlgVatAdd()">+ Línea IVA</button>
                    </div>
                    <div class="form-grid" style="margin-top:12px">
                        <div class="form-field">
                            <label>IRPF %</label>
                            <input type="number" id="dlg-irpf-rate" step="0.1" placeholder="0"
                                value="${doc?.irpf_rate != null ? doc.irpf_rate : ''}"
                                oninput="_dlgRecalcFull()">
                        </div>
                        <div class="form-field">
                            <label>IRPF importe (€)</label>
                            <input type="number" id="dlg-irpf-amount" step="0.01" placeholder="0.00"
                                style="background:var(--bg-subtle,#f3f4f6)" readonly>
                        </div>
                        <div class="form-field">
                            <label>Tipo retención</label>
                            <select id="dlg-retention-type">
                                <option value="ninguna" ${_retentionDefault === 'ninguna'       ? 'selected' : ''}>Sin retención</option>
                                <option value="profesional"   ${_retentionDefault === 'profesional'   ? 'selected' : ''}>15% — Profesional</option>
                                <option value="arrendamiento" ${_retentionDefault === 'arrendamiento' ? 'selected' : ''}>19% — Arrendamiento</option>
                            </select>
                        </div>
                        <div class="form-field">
                            <label>Total a pagar (€)</label>
                            <input type="number" id="dlg-total-full" step="0.01" placeholder="0.00">
                        </div>
                    </div>
                    <div id="dlg-ia-warnings" style="display:none;font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;padding:6px 10px;margin-top:8px"></div>
                </div>

                <div class="form-field" style="margin-top:12px">
                    <label>Notas <span style="color:var(--subtle);font-size:11px">(opcional)</span></label>
                    <input type="text" id="dlg-notes" placeholder="Gasolina, parking, papelería…">
                </div>

                <div class="dialog-footer" style="margin-top:16px;padding:0">
                    <button class="btn btn-secondary"
                        onclick="document.getElementById('dlgGasto').close()">Cancelar</button>
                    <button class="btn btn-primary" id="dlg-guardar">Guardar en libro</button>
                </div>
            </div>
        </div>
    `

    initPrecioInput(document.getElementById('dlg-total-simp'))
    initPrecioInput(document.getElementById('dlg-total-full'))
    document.querySelectorAll('#dlg-vat-lines .vat-base').forEach(initPrecioInput)

    // Pre-seleccionar categoría sugerida por la IA
    if (doc?.suggested_category) {
        const catEl = document.getElementById('dlg-category')
        if (catEl) catEl.value = doc.suggested_category
    }
    // Pre-calcular totales con los datos ya cargados
    if (_tipo === 'full' && _vatLines.some(l => l.base > 0)) {
        // _dlgRecalcFull se define más abajo como global; se llama tras la definición
        setTimeout(() => window._dlgRecalcFull?.(), 0)
    } else if (_tipo === 'simp' && doc?.amount) {
        setTimeout(() => { setPrecioValue(document.getElementById('dlg-total-simp'), doc.amount); window._dlgRecalcSimp?.() }, 0)
    }

    // ── Zoom en imagen ────────────────────────────────────────────────────────
    const imgEl = document.getElementById('dlg-img')
    if (imgEl && isImg) {
        imgEl.addEventListener('click', () => {
            imgEl._z = !imgEl._z
            imgEl.style.objectFit = imgEl._z ? 'none' : 'contain'
            imgEl.style.cursor    = imgEl._z ? 'zoom-out' : 'zoom-in'
        })
    }

    // ── Globals para oninput (inline handlers) ────────────────────────────────

    window._dlgSetTipo = (tipo) => {
        _tipo = tipo
        const simp = tipo === 'simp'
        document.getElementById('dlg-btn-simp').className = `btn btn-${simp  ? 'primary' : 'secondary'}`
        document.getElementById('dlg-btn-full').className = `btn btn-${!simp ? 'primary' : 'secondary'}`
        document.getElementById('dlg-sec-simp').style.display   = simp  ? '' : 'none'
        document.getElementById('dlg-sec-full').style.display   = simp  ? 'none' : ''
        document.getElementById('dlg-row-invnum').style.display = simp  ? 'none' : ''
        document.getElementById('dlg-nif-opt').style.display    = simp  ? '' : 'none'
    }
    window._dlgSetTipo(_tipo)

    window._dlgCheckFecha = (dateStr) => {
        const aviso = document.getElementById('dlg-fecha-aviso')
        if (!aviso || !dateStr) return
        const [dy, dm] = dateStr.split('-').map(Number)
        const dq = Math.ceil(dm / 3)
        if (closedSet.has(`${dy}-${dq}`)) {
            aviso.style.display = ''
            aviso.textContent = `⚠️ Esta fecha es de un trimestre ya presentado a Hacienda. La fecha de registro del libro debe ser de un trimestre abierto.`
            return
        }
        const now  = new Date()
        const curY = now.getFullYear()
        const curQ = Math.ceil((now.getMonth() + 1) / 3)
        const prevQ = curQ - 1
        const thresholdDate = prevQ > 0
            ? `${curY}-${String((prevQ - 1) * 3 + 1).padStart(2, '0')}-01`
            : `${curY - 1}-10-01`
        if (dateStr < thresholdDate) {
            aviso.style.display = ''
            aviso.textContent = '⚠️ La fecha leída es de más de un trimestre atrás — comprueba que sea correcta antes de guardar.'
        } else {
            aviso.style.display = 'none'
        }
    }

    window._dlgRecalcSimp = () => {
        const total   = parseFloat(document.getElementById('dlg-total-simp')?.value) || 0
        const ivaRate = parseFloat(document.getElementById('dlg-iva-simple')?.value) || 0
        if (total > 0) {
            const base = Math.round(total / (1 + ivaRate / 100) * 100) / 100
            _vatLines = [{ base, rate: ivaRate, vat: Math.round((total - base) * 100) / 100 }]
        }
    }

    window._dlgRecalcFull = () => {
        const sumBase    = _vatLines.reduce((s, l) => s + (parseFloat(l.base) || 0), 0)
        const sumVat     = _vatLines.reduce((s, l) => s + (parseFloat(l.vat)  || 0), 0)
        const irpfRate   = parseFloat(document.getElementById('dlg-irpf-rate')?.value) || 0
        const irpfAmount = Math.round(sumBase * irpfRate / 100 * 100) / 100
        const total      = Math.round((sumBase + sumVat - irpfAmount) * 100) / 100
        const irpfEl     = document.getElementById('dlg-irpf-amount')
        const totalEl    = document.getElementById('dlg-total-full')
        if (irpfEl)  irpfEl.value = irpfAmount || ''
        if (totalEl) setPrecioValue(totalEl, total || '')
    }

    window._dlgVatCh = (idx, field, val) => {
        _vatLines[idx][field] = val
        const base = parseFloat(_vatLines[idx].base) || 0
        const rate = parseFloat(_vatLines[idx].rate) || 0
        const vat  = Math.round(base * rate / 100 * 100) / 100
        _vatLines[idx].vat = vat || ''
        const el = document.querySelector(`#dlg-vat-lines .dlg-vat-line[data-idx="${idx}"] .vat-vat`)
        if (el) el.value = vat || ''
        window._dlgRecalcFull()
    }

    window._dlgVatAdd = () => {
        _vatLines.push({ base: '', rate: 21, vat: '' })
        document.getElementById('dlg-vat-lines').innerHTML = _renderVatLines()
        document.querySelectorAll('#dlg-vat-lines .vat-base').forEach(initPrecioInput)
    }

    window._dlgVatRm = (idx) => {
        _vatLines.splice(idx, 1)
        document.getElementById('dlg-vat-lines').innerHTML = _renderVatLines()
        document.querySelectorAll('#dlg-vat-lines .vat-base').forEach(initPrecioInput)
        window._dlgRecalcFull()
    }

    // ── IA ────────────────────────────────────────────────────────────────────
    if (canPreview) {
        document.getElementById('dlg-ia')?.addEventListener('click', async () => {
            const btn = document.getElementById('dlg-ia')
            btn.disabled = true; btn.textContent = '⏳ Leyendo…'
            try {
                const resp   = await fetch(signedUrl)
                const buffer = await resp.arrayBuffer()
                const bytes  = new Uint8Array(buffer)
                let binary = ''
                for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
                const b64 = btoa(binary)

                let mediaType = 'application/pdf', cType = 'document'
                if (isImg) {
                    if (['jpg','jpeg'].includes(ext)) { mediaType = 'image/jpeg'; cType = 'image' }
                    else if (ext === 'png')           { mediaType = 'image/png';  cType = 'image' }
                    else if (ext === 'webp')          { mediaType = 'image/webp'; cType = 'image' }
                }

                const { data: res, error: errIA } = await supabase.functions.invoke('claude-proxy', {
                    body: {
                        model: 'claude-haiku-4-5-20251001',
                        max_tokens: 600,
                        messages: [{
                            role: 'user',
                            content: [
                                { type: cType, source: { type: 'base64', media_type: mediaType, data: b64 } },
                                { type: 'text', text:
                                    'Eres un extractor de datos fiscales de facturas españolas. Lee la imagen completa con atención y extrae todos los campos. ' +
                                    'CAMPOS OBLIGATORIOS — búscalos aunque estén en cabecera, pie o lateral:\n' +
                                    '· invoice_number: número de factura (busca "Factura nº", "Nº", "Ref.", "F-", "FA-" o similar). ' +
                                    '· issue_date: fecha de la factura en formato YYYY-MM-DD (busca "Fecha", "Fecha de emisión", "Fecha factura" o similar). ' +
                                    '· issuer_name e issuer_nif: datos del EMISOR (quien factura), NO del destinatario ni del cliente. ' +
                                    'Si aparece "Paula Díaz" o NIF "72694758S", ese es el DESTINATARIO — ignóralo para issuer. ' +
                                    'vat_lines: SOLO líneas de IVA (cuota siempre positiva). La retención IRPF NUNCA va en vat_lines — va únicamente en irpf_rate e irpf_amount. ' +
                                    'retention_type: "profesional" si irpf_rate=15, "arrendamiento" si irpf_rate=19, "ninguna" si no hay retención. ' +
                                    'Verifica coherencia: cada vat_line.vat debe ser base×rate/100 (tolerancia 0,02 €); ' +
                                    'total debe ser Σbase + Σvat − irpf_amount (tolerancia 0,02 €); ' +
                                    'irpf_amount debe ser Σbase × irpf_rate/100 (tolerancia 0,02 €). ' +
                                    'Si detectas algún descuadre descríbelo en warnings. Si todo cuadra, warnings queda vacío. ' +
                                    'Responde SOLO JSON sin texto adicional:\n' +
                                    '{"issuer_name":"","issuer_nif":"","invoice_number":"",' +
                                    '"issue_date":"YYYY-MM-DD","vat_lines":[{"base":0,"rate":21,"vat":0}],' +
                                    '"irpf_rate":0,"irpf_amount":0,"total":0,"retention_type":"ninguna","warnings":""}' }
                            ]
                        }]
                    }
                })
                if (errIA) throw new Error(errIA.message)

                const match = (res?.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/)
                if (!match) throw new Error('Sin JSON en respuesta')
                const d = JSON.parse(match[0])

                const set = (id, v) => { if (v != null && v !== 0 && v !== '') { const el = document.getElementById(id); if (el) el.value = v } }
                set('dlg-issuer-name',    d.issuer_name)
                set('dlg-issuer-nif',     d.issuer_nif)
                set('dlg-invoice-number', d.invoice_number)
                set('dlg-issue-date',     d.issue_date)
                window._dlgCheckFecha(d.issue_date)

                // Rellenar siempre ambas secciones para que cambiar de tipo no pierda datos
                if (d.vat_lines?.length) {
                    _vatLines = d.vat_lines
                        .filter(l => +(l.vat||0) >= 0)
                        .map(l => ({ base: +(l.base||0), rate: +(l.rate||21), vat: +(l.vat||0) }))
                    document.getElementById('dlg-vat-lines').innerHTML = _renderVatLines()
                    document.querySelectorAll('#dlg-vat-lines .vat-base').forEach(initPrecioInput)
                }
                set('dlg-irpf-rate', d.irpf_rate || null)
                window._dlgRecalcFull()

                if (d.retention_type) {
                    const retEl = document.getElementById('dlg-retention-type')
                    if (retEl) retEl.value = d.retention_type
                }
                const warnEl = document.getElementById('dlg-ia-warnings')
                if (warnEl) {
                    if (d.warnings) {
                        warnEl.style.display = ''
                        warnEl.textContent   = '⚠️ IA detectó un descuadre: ' + d.warnings
                    } else {
                        warnEl.style.display = 'none'
                    }
                }

                if (d.total) set('dlg-total-simp', d.total)
                if (d.vat_lines?.[0]?.rate != null) {
                    const sel = document.getElementById('dlg-iva-simple')
                    const r = String(d.vat_lines[0].rate)
                    for (const o of sel.options) { if (o.value === r) { sel.value = r; break } }
                }
                window._dlgRecalcSimp()

                btn.textContent = '✅ Datos cargados'; btn.disabled = false
            } catch (e) {
                console.error('IA dlgGasto:', e)
                mostrarToast('No se pudo extraer automáticamente', '#d97706')
                btn.textContent = '✨ Leer con IA'; btn.disabled = false
            }
        })
    }

    // ── Guardar ───────────────────────────────────────────────────────────────
    document.getElementById('dlg-guardar').addEventListener('click', async () => {
        const get = id => document.getElementById(id)?.value?.trim() ?? ''
        const issuerName   = get('dlg-issuer-name')
        const issuerNifRaw  = get('dlg-issuer-nif')
        const issuerNifNorm = validarNif(issuerNifRaw).normalizado
        const issuerNif     = issuerNifNorm || 'N/A'
        const issueDate    = document.getElementById('dlg-issue-date')?.value
        const notes        = get('dlg-notes') || null
        const isSimp       = _tipo === 'simp'

        let invNum, bookedDate, category, dedPct, isCapital, irpfRate, irpfAmount, retentionType, total

        if (isSimp) {
            window._dlgRecalcSimp()
            total         = getPrecioValue(document.getElementById('dlg-total-simp'))
            invNum        = get('dlg-invoice-number') || `T-${Date.now()}`
            bookedDate    = issueDate
            category      = 'otros'
            dedPct        = 100
            isCapital     = false
            irpfRate      = 0
            irpfAmount    = 0
            retentionType = 'ninguna'
        } else {
            invNum        = get('dlg-invoice-number')
            bookedDate    = document.getElementById('dlg-booked-date')?.value || issueDate
            category      = document.getElementById('dlg-category')?.value ?? 'otros'
            dedPct        = parseFloat(document.getElementById('dlg-deductible')?.value) ?? 100
            isCapital     = document.getElementById('dlg-capital')?.checked ?? false
            irpfRate      = parseFloat(document.getElementById('dlg-irpf-rate')?.value) || 0
            irpfAmount    = parseFloat(document.getElementById('dlg-irpf-amount')?.value) || 0
            retentionType = irpfAmount > 0
                ? (document.getElementById('dlg-retention-type')?.value ?? 'ninguna')
                : 'ninguna'
            total         = getPrecioValue(document.getElementById('dlg-total-full'))
        }

        if (!issuerName)              { alert('Falta el nombre del emisor'); return }
        if (!issueDate)               { alert('Falta la fecha'); return }
        if (isNaN(total) || total <= 0) { alert('El total debe ser mayor que 0'); return }
        if (!isSimp && !invNum)       { alert('Falta el número de factura'); return }

        const validLines = _vatLines.filter(l => parseFloat(l.base) > 0)
        if (!isSimp && !validLines.length) { alert('Añade al menos una línea de IVA'); return }

        // Validar aritmética: Σbase + ΣIVA − IRPF = total (tolerancia 0,02 €)
        if (!isSimp && validLines.length) {
            const sumBase    = validLines.reduce((s, l) => s + (parseFloat(l.base) || 0), 0)
            const sumVat     = validLines.reduce((s, l) => s + (parseFloat(l.vat)  || 0), 0)
            const calculado  = Math.round((sumBase + sumVat - irpfAmount) * 100) / 100
            if (Math.abs(calculado - total) > 0.02) {
                alert(
                    `Descuadre aritmético:\n` +
                    `· Calculado: ${calculado.toFixed(2).replace('.', ',')} € (Σbase + ΣIVA − IRPF)\n` +
                    `· Total introducido: ${total.toFixed(2).replace('.', ',')} €\n\n` +
                    `Comprueba: líneas de IVA (solo cuotas positivas, sin retención), % IRPF y total.`
                )
                return
            }
        }

        // Validar que booked_date no sea de un trimestre cerrado
        const [bdy, bdm] = bookedDate.split('-').map(Number)
        if (closedSet.has(`${bdy}-${Math.ceil(bdm / 3)}`)) {
            alert(`El trimestre T${Math.ceil(bdm / 3)} ${bdy} ya está cerrado. Cambia la fecha de registro a un trimestre abierto.`)
            return
        }

        const season = parseInt(bookedDate.split('-')[0])

        // Aviso de descuadre entre importe de negocio y total fiscal
        if (doc?.amount != null && Math.abs(doc.amount - total) > 0.01) {
            const ok = confirm(
                `Descuadre detectado:\n` +
                `· Negocio (registrado en el alta): ${fmt(doc.amount)}\n` +
                `· Fiscal (lo que vas a contabilizar): ${fmt(total)}\n\n` +
                `Se guardará el importe fiscal en el libro. ¿Continuar?`
            )
            if (!ok) return
        }

        const btn = document.getElementById('dlg-guardar')
        btn.disabled = true; btn.textContent = 'Guardando…'

        let docId = doc?.id ?? null
        if (!docId) {
            const { data: nd, error: errD } = await supabase
                .from('supplier_documents')
                .insert({
                    concept:   `${issuerName} — ${invNum}`,
                    file_path: `_gastos/${season}/${Date.now()}_sin_archivo`,
                    season,
                })
                .select('id').single()
            if (errD) { alert('Error: ' + errD.message); btn.disabled = false; btn.textContent = 'Guardar en libro'; return }
            docId = nd.id
        }

        const { data: inv, error: errInv } = await supabase
            .from('supplier_invoices')
            .insert({
                document_id:     docId,
                provider_id:     provider?.id ?? doc?.provider_id ?? null,
                issuer_name:     issuerName,
                issuer_nif:      issuerNif,
                invoice_number:  invNum,
                issue_date:      issueDate,
                booked_date:     bookedDate,
                operation_type:  'interior',
                category,
                deductible_pct:  dedPct,
                is_capital_good: isCapital,
                irpf_rate:       irpfRate      || null,
                irpf_amount:     irpfAmount    || null,
                retention_type:  retentionType,
                total,
                season,
                notes,
            })
            .select('id').single()

        if (errInv) { alert('Error: ' + errInv.message); btn.disabled = false; btn.textContent = 'Guardar en libro'; return }

        if (validLines.length) {
            await supabase.from('supplier_invoice_vat_lines').insert(
                validLines.map(l => ({
                    invoice_id:  inv.id,
                    base_amount: parseFloat(l.base),
                    vat_rate:    parseFloat(l.rate),
                    vat_amount:  parseFloat(l.vat),
                }))
            )
        }

        // Enriquecer supplier_documents con los datos revisados del modal
        if (docId) {
            await supabase.from('supplier_documents').update({
                issuer_name:    issuerName || null,
                issuer_nif:     issuerNifNorm || null,
                invoice_number: invNum || null,
                issue_date:     issueDate || null,
                irpf_rate:      irpfRate  || null,
                irpf_amount:    irpfAmount || null,
                ai_vat_lines:   validLines.length
                    ? validLines.map(l => ({ base: +l.base, rate: +l.rate, vat: +l.vat }))
                    : null,
            }).eq('id', docId)
        }

        // Enriquecer datos del proveedor con lo leído en la factura
        if (provider?.id) {
            await _actualizarProveedor(provider, issuerName, issuerNifNorm)
        }

        document.getElementById('dlgGasto')?.close()
        mostrarToast('Factura registrada en el libro fiscal')
        onGuardado?.()
    })
}

// ── Actualizar proveedor con datos leídos en la factura ──────────────────────
async function _actualizarProveedor(provider, issuerName, issuerNifNorm) {
    const updates    = {}
    const conflictos = []

    // NIF: comparación con ambos lados normalizados (sin puntos, guiones, espacios)
    const nifLeido   = issuerNifNorm
    const nifSistema = validarNif(provider.nif).normalizado
    if (nifLeido) {
        if (!nifSistema) {
            updates.nif = nifLeido
        } else if (nifSistema !== nifLeido) {
            conflictos.push({ campo: 'NIF', sistema: provider.nif, factura: issuerNifNorm })
        }
    }

    // Nombre: si el leído contiene al del sistema → el nuevo es más completo, actualizar auto
    const nomLeido   = issuerName?.trim()
    const nomSistema = provider.name?.trim()
    if (nomLeido && nomSistema) {
        const l = nomLeido.toLowerCase()
        const s = nomSistema.toLowerCase()
        if (l !== s) {
            if (l.includes(s)) {
                updates.name = nomLeido
            } else {
                conflictos.push({ campo: 'Nombre', sistema: provider.name, factura: nomLeido })
            }
        }
    } else if (nomLeido && !nomSistema) {
        updates.name = nomLeido
    }

    // Preguntar por cada conflicto
    for (const { campo, sistema, factura } of conflictos) {
        const ok = confirm(
            `${campo} del proveedor en el sistema: "${sistema}"\n` +
            `${campo} leído en la factura: "${factura}"\n\n` +
            `¿Actualizar en el sistema?`
        )
        if (ok) updates[campo === 'NIF' ? 'nif' : 'name'] = factura
    }

    if (Object.keys(updates).length) {
        await supabase.from('providers').update(updates).eq('id', provider.id)
    }
}
