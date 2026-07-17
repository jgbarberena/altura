// dlg-gasto.js — Modal compartido para registrar facturas recibidas en el libro fiscal.
// Importado por fiscal.js y gastos.js.
// Parámetros: doc (objeto supplier_documents o null), provider (objeto providers o null),
//             onGuardado (() => void) — callback para refrescar la pantalla del caller.

import { supabase }     from './supabase.js'
import { crearModal }   from './modal.js'
import { mostrarToast } from './verificacion.js'

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
    const pNom = provider?.name ?? ''
    const pNif = provider?.nif  ?? ''
    const subT = doc
        ? `${pNom || doc.concept || '—'} · ${(doc.uploaded_at ?? '').split('T')[0]}`
        : 'Nueva entrada'

    let _tipo     = isImg ? 'simp' : 'full'
    let _vatLines = [{ base: '', rate: 21, vat: '' }]

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
                        ? `<button id="dlg-ia" class="btn btn-secondary" style="font-size:12px;margin-left:auto">✨ Leer con IA</button>`
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
                        <input type="text" id="dlg-invoice-number" placeholder="F-2026-001">
                    </div>
                    <div class="form-field">
                        <label>Fecha</label>
                        <input type="date" id="dlg-issue-date" value="${hoy}">
                    </div>
                </div>

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
                                oninput="_dlgRecalcFull()">
                        </div>
                        <div class="form-field">
                            <label>IRPF importe (€)</label>
                            <input type="number" id="dlg-irpf-amount" step="0.01" placeholder="0.00"
                                style="background:var(--bg-subtle,#f3f4f6)" readonly>
                        </div>
                        <div class="form-field">
                            <label>Total a pagar (€)</label>
                            <input type="number" id="dlg-total-full" step="0.01" placeholder="0.00">
                        </div>
                    </div>
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
        if (irpfEl)  irpfEl.value  = irpfAmount || ''
        if (totalEl) totalEl.value = total || ''
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
    }

    window._dlgVatRm = (idx) => {
        _vatLines.splice(idx, 1)
        document.getElementById('dlg-vat-lines').innerHTML = _renderVatLines()
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
                                    'Extrae los datos fiscales de esta factura. ' +
                                    'IMPORTANTE: issuer_name e issuer_nif son del EMISOR (quien vende/presta el servicio), ' +
                                    'NO del destinatario ni del cliente. ' +
                                    'Si aparece "Paula Díaz" o NIF "72694758S", ese es el DESTINATARIO — ignóralo para issuer. ' +
                                    'Responde SOLO JSON sin texto adicional:\n' +
                                    '{"issuer_name":"","issuer_nif":"","invoice_number":"",' +
                                    '"issue_date":"YYYY-MM-DD","vat_lines":[{"base":0,"rate":21,"vat":0}],' +
                                    '"irpf_rate":0,"irpf_amount":0,"total":0}' }
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

                if (_tipo === 'simp') {
                    set('dlg-total-simp', d.total)
                    if (d.vat_lines?.[0]?.rate != null) {
                        const sel = document.getElementById('dlg-iva-simple')
                        const r = String(d.vat_lines[0].rate)
                        for (const o of sel.options) { if (o.value === r) { sel.value = r; break } }
                    }
                    window._dlgRecalcSimp()
                } else {
                    if (d.vat_lines?.length) {
                        _vatLines = d.vat_lines.map(l => ({ base: +(l.base||0), rate: +(l.rate||21), vat: +(l.vat||0) }))
                        document.getElementById('dlg-vat-lines').innerHTML = _renderVatLines()
                    }
                    set('dlg-irpf-rate', d.irpf_rate || null)
                    window._dlgRecalcFull()
                    if (d.total) set('dlg-total-full', d.total)
                }

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
        const issuerName = get('dlg-issuer-name')
        const issuerNif  = get('dlg-issuer-nif') || 'N/A'
        const issueDate  = document.getElementById('dlg-issue-date')?.value
        const notes      = get('dlg-notes') || null
        const isSimp     = _tipo === 'simp'

        let invNum, bookedDate, category, dedPct, isCapital, irpfRate, irpfAmount, total

        if (isSimp) {
            window._dlgRecalcSimp()
            total      = parseFloat(document.getElementById('dlg-total-simp')?.value)
            invNum     = get('dlg-invoice-number') || `T-${Date.now()}`
            bookedDate = issueDate
            category   = 'otros'
            dedPct     = 100
            isCapital  = false
            irpfRate   = 0
            irpfAmount = 0
        } else {
            invNum     = get('dlg-invoice-number')
            bookedDate = document.getElementById('dlg-booked-date')?.value || issueDate
            category   = document.getElementById('dlg-category')?.value ?? 'otros'
            dedPct     = parseFloat(document.getElementById('dlg-deductible')?.value) ?? 100
            isCapital  = document.getElementById('dlg-capital')?.checked ?? false
            irpfRate   = parseFloat(document.getElementById('dlg-irpf-rate')?.value) || 0
            irpfAmount = parseFloat(document.getElementById('dlg-irpf-amount')?.value) || 0
            total      = parseFloat(document.getElementById('dlg-total-full')?.value)
        }

        if (!issuerName)              { alert('Falta el nombre del emisor'); return }
        if (!issueDate)               { alert('Falta la fecha'); return }
        if (isNaN(total) || total <= 0) { alert('El total debe ser mayor que 0'); return }
        if (!isSimp && !invNum)       { alert('Falta el número de factura'); return }

        const validLines = _vatLines.filter(l => parseFloat(l.base) > 0)
        if (!isSimp && !validLines.length) { alert('Añade al menos una línea de IVA'); return }

        const season = parseInt(bookedDate.split('-')[0])
        const btn    = document.getElementById('dlg-guardar')
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
                irpf_rate:       irpfRate  || null,
                irpf_amount:     irpfAmount || null,
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

        document.getElementById('dlgGasto')?.close()
        mostrarToast('Factura registrada en el libro fiscal')
        onGuardado?.()
    })
}
