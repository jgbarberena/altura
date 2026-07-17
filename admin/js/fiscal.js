import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, exportTable } from './utils.js'
import { mostrarToast } from './verificacion.js'
import { abrirDlgGasto } from './dlg-gasto.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

// ===== TRIMESTRE =====
const STORE_KEY = 'vsf_trimestre_activo'
const selectAno = document.getElementById('selectAno')
const selectTri = document.getElementById('selectTrimestre')

const hoy = new Date()
for (let y = hoy.getFullYear() + 1; y >= 2024; y--) {
    const opt = document.createElement('option')
    opt.value = y
    opt.textContent = y
    selectAno.appendChild(opt)
}

function defaultTrimestre() {
    return { year: hoy.getFullYear(), q: Math.ceil((hoy.getMonth() + 1) / 3) }
}

function loadTrimestre() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')
        if (saved?.year && saved?.q) return saved
    } catch {}
    return defaultTrimestre()
}

const { year: initYear, q: initQ } = loadTrimestre()
selectAno.value = initYear
selectTri.value = initQ

function saveTrimestre() {
    localStorage.setItem(STORE_KEY, JSON.stringify({ year: +selectAno.value, q: +selectTri.value }))
}

selectAno.addEventListener('change', () => { saveTrimestre(); cargarTodo() })
selectTri.addEventListener('change', () => { saveTrimestre(); cargarTodo() })

function quarterDates(year, q) {
    const startMonth = (q - 1) * 3 + 1
    const endMonth   = q * 3
    const start      = `${year}-${String(startMonth).padStart(2, '0')}-01`
    const endDay     = new Date(year, endMonth, 0).getDate()
    const end        = `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
    return { start, end }
}

// ===== TABS =====
const tabBtns = document.querySelectorAll('.tab-btn')
const TAB_IDS = { gastos: 'tab-gastos', emitidas: 'tab-emitidas', f69: 'tab-f69' }

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        Object.values(TAB_IDS).forEach(id => document.getElementById(id).style.display = 'none')
        document.getElementById(TAB_IDS[btn.dataset.tab]).style.display = 'block'
    })
})

window.irATrimestre = function (year, q) {
    selectAno.value = year
    selectTri.value = q
    saveTrimestre()
    cargarTodo()
    tabBtns.forEach(b => b.classList.remove('active'))
    Object.values(TAB_IDS).forEach(id => document.getElementById(id).style.display = 'none')
    document.querySelector('[data-tab="f69"]').classList.add('active')
    document.getElementById(TAB_IDS.f69).style.display = 'block'
}

// ===== ESTADO =====
let _gastosData   = []
let _emitidasData = []

// ===== CARGA PRINCIPAL =====
async function cargarTodo() {
    const year = +selectAno.value
    const q    = +selectTri.value
    const { start, end } = quarterDates(year, q)

    const [
        { data: gastos   },
        { data: emitidas },
        { data: cierre   },
    ] = await Promise.all([
        supabase.from('supplier_invoices')
            .select('*, supplier_invoice_vat_lines(*)')
            .gte('issue_date', start)
            .lte('issue_date', end)
            .order('issue_date', { ascending: true }),
        supabase.from('issued_invoices')
            .select('*, issued_invoice_vat_lines(*)')
            .gte('accrual_date', start)
            .lte('accrual_date', end)
            .order('accrual_date', { ascending: true }),
        supabase.from('fiscal_closings')
            .select('*')
            .eq('model', 'F69')
            .eq('year', year)
            .eq('quarter', q)
            .maybeSingle(),
    ])

    _gastosData   = gastos   ?? []
    _emitidasData = emitidas ?? []

    renderGastos(_gastosData)
    renderEmitidas(_emitidasData)
    renderF69(_gastosData, _emitidasData, cierre, year, q)
}

// ===== FORMATO =====
function fmt(n)  { return (+(n ?? 0)).toFixed(2).replace('.', ',') + ' €' }
function fmtN(n) { return (+(n ?? 0)).toFixed(2) }

// ===== TAB GASTOS =====
function renderGastos(rows) {
    const tbody   = document.getElementById('tbody-gastos-fiscal')
    const vacio   = document.getElementById('gastos-fiscal-vacio')
    const totales = document.getElementById('gastos-fiscal-totales')

    if (!rows.length) {
        tbody.innerHTML       = ''
        vacio.style.display   = 'block'
        totales.style.display = 'none'
        return
    }
    vacio.style.display   = 'none'
    totales.style.display = 'block'

    let sumBase = 0, sumIva = 0, sumTotal = 0
    tbody.innerHTML = rows.map(r => {
        const lines = r.supplier_invoice_vat_lines ?? []
        const base  = lines.reduce((s, l) => s + (l.base_amount ?? 0), 0)
        const iva   = lines.reduce((s, l) => s + (l.vat_amount  ?? 0), 0)
        sumBase  += base
        sumIva   += iva
        sumTotal += r.total ?? 0
        return `<tr>
            <td style="white-space:nowrap">${r.issue_date}</td>
            <td style="font-size:12px">${r.invoice_number ?? '—'}</td>
            <td>${r.issuer_name ?? '—'}</td>
            <td style="font-size:11px;color:var(--subtle)">${r.issuer_nif ?? '—'}</td>
            <td style="text-align:right">${fmt(base)}</td>
            <td style="text-align:right">${fmt(iva)}</td>
            <td style="text-align:right;font-weight:600">${fmt(r.total)}</td>
            <td style="font-size:11px;color:var(--subtle)">${r.category ?? '—'}</td>
            <td style="white-space:nowrap;text-align:right">
                ${r.document_id != null ? `<a href="#" onclick="verDocFiscal(${r.document_id});return false" style="font-size:13px;margin-right:6px" title="Ver documento">📄</a>` : ''}
                <button class="btn btn-danger" style="font-size:11px;padding:2px 6px"
                    onclick="eliminarGastoFiscal(${r.id})" title="Eliminar del libro fiscal">🗑</button>
            </td>
        </tr>`
    }).join('')

    totales.innerHTML = `Base: <strong>${fmt(sumBase)}</strong> &nbsp;·&nbsp; IVA: <strong>${fmt(sumIva)}</strong> &nbsp;·&nbsp; Total: <strong>${fmt(sumTotal)}</strong>`
}

window.verDocFiscal = async function (docId) {
    const { data: doc } = await supabase.from('supplier_documents').select('file_path').eq('id', docId).single()
    if (!doc?.file_path || doc.file_path.endsWith('_sin_archivo')) { alert('Sin documento adjunto'); return }
    const { data, error } = await supabase.storage.from('supplier-invoices').createSignedUrl(doc.file_path, 3600)
    if (error || !data?.signedUrl) { alert('No se pudo abrir el documento'); return }
    window.open(data.signedUrl, '_blank')
}

window.eliminarGastoFiscal = async function (id) {
    if (!confirm('¿Eliminar esta entrada del libro fiscal?\nEl documento original no se borrará.')) return
    const { error } = await supabase.from('supplier_invoices').delete().eq('id', id)
    if (error) { alert('No se puede eliminar: ' + error.message); return }
    mostrarToast('Entrada eliminada del libro fiscal')
    cargarTodo()
}

// ===== TAB EMITIDAS =====
function renderEmitidas(rows) {
    const tbody   = document.getElementById('tbody-emitidas')
    const vacio   = document.getElementById('emitidas-vacio')
    const totales = document.getElementById('emitidas-totales')

    if (!rows.length) {
        tbody.innerHTML       = ''
        vacio.style.display   = 'block'
        totales.style.display = 'none'
        return
    }
    vacio.style.display   = 'none'
    totales.style.display = 'block'

    let sumBase = 0, sumIva = 0, sumIrpf = 0, sumTotal = 0
    tbody.innerHTML = rows.map(r => {
        const lines = r.issued_invoice_vat_lines ?? []
        const base  = lines.reduce((s, l) => s + (l.base_amount ?? 0), 0)
        const iva   = lines.reduce((s, l) => s + (l.vat_amount  ?? 0), 0)
        sumBase  += base
        sumIva   += iva
        sumIrpf  += r.irpf_amount ?? 0
        sumTotal += r.total ?? 0
        return `<tr>
            <td style="white-space:nowrap">${r.accrual_date}</td>
            <td style="font-size:12px">${r.invoice_number ?? '—'}</td>
            <td>${r.client_name ?? '—'}</td>
            <td style="font-size:11px;color:var(--subtle)">${r.client_nif ?? '—'}</td>
            <td style="text-align:right">${fmt(base)}</td>
            <td style="text-align:right">${fmt(iva)}</td>
            <td style="text-align:right;color:var(--accent)">${fmt(r.irpf_amount)}</td>
            <td style="text-align:right;font-weight:600">${fmt(r.total)}</td>
            <td style="font-size:11px;color:var(--subtle)">${r.invoice_type ?? '—'}</td>
            <td>
                ${r.file_path
                    ? `<a href="#" onclick="verFacturaEmitida('${r.file_path}');return false" style="font-size:13px" title="Ver factura">📄</a>`
                    : '<span title="Sin PDF" style="color:#d97706;font-size:13px">⚠️</span>'}
            </td>
        </tr>`
    }).join('')

    totales.innerHTML = `Base: <strong>${fmt(sumBase)}</strong> &nbsp;·&nbsp; IVA: <strong>${fmt(sumIva)}</strong> &nbsp;·&nbsp; IRPF: <strong>${fmt(sumIrpf)}</strong> &nbsp;·&nbsp; Total: <strong>${fmt(sumTotal)}</strong>`
}

window.verFacturaEmitida = async function (filePath) {
    const { data, error } = await supabase.storage.from('invoices').createSignedUrl(filePath, 3600)
    if (error || !data?.signedUrl) { alert('No se pudo abrir la factura'); return }
    window.open(data.signedUrl, '_blank')
}

// ===== TAB F69 =====
function renderF69(gastos, emitidas, cierre, year, q) {
    const el = document.getElementById('f69-content')

    const devMap = new Map()
    for (const inv of emitidas) {
        for (const line of (inv.issued_invoice_vat_lines ?? [])) {
            const prev = devMap.get(line.vat_rate) ?? { base: 0, vat: 0 }
            devMap.set(line.vat_rate, {
                base: prev.base + (line.base_amount ?? 0),
                vat:  prev.vat  + (line.vat_amount  ?? 0),
            })
        }
    }

    const sopMap   = new Map()
    let sopCapBase = 0, sopCapIva = 0
    for (const inv of gastos) {
        const pct = (inv.deductible_pct ?? 100) / 100
        for (const line of (inv.supplier_invoice_vat_lines ?? [])) {
            if (inv.is_capital_good) {
                sopCapBase += (line.base_amount ?? 0)
                sopCapIva  += (line.vat_amount  ?? 0) * pct
            } else {
                const prev = sopMap.get(line.vat_rate) ?? { base: 0, vatBruto: 0, vatDed: 0 }
                sopMap.set(line.vat_rate, {
                    base:     prev.base     + (line.base_amount ?? 0),
                    vatBruto: prev.vatBruto + (line.vat_amount  ?? 0),
                    vatDed:   prev.vatDed   + (line.vat_amount  ?? 0) * pct,
                })
            }
        }
    }

    const totalDevBase = [...devMap.values()].reduce((s, v) => s + v.base, 0)
    const totalDevIva  = [...devMap.values()].reduce((s, v) => s + v.vat,  0)
    const totalSopDed  = [...sopMap.values()].reduce((s, v) => s + v.vatDed, 0) + sopCapIva
    const resultado    = totalDevIva - totalSopDed

    const cerrado = !!cierre?.presented_at

    let devRows = ''
    for (const [rate, d] of [...devMap.entries()].sort((a, b) => a[0] - b[0])) {
        devRows += `<tr>
            <td>${rate}%</td>
            <td style="text-align:right">${fmt(d.base)}</td>
            <td style="text-align:right">${fmt(d.vat)}</td>
        </tr>`
    }
    if (!devRows) devRows = `<tr><td colspan="3" style="text-align:center;color:var(--subtle);padding:12px 0">Sin facturas emitidas</td></tr>`

    let sopRows = ''
    for (const [rate, s] of [...sopMap.entries()].sort((a, b) => a[0] - b[0])) {
        sopRows += `<tr>
            <td>${rate}%</td>
            <td style="text-align:right">${fmt(s.base)}</td>
            <td style="text-align:right">${fmt(s.vatBruto)}</td>
            <td style="text-align:right">${fmt(s.vatDed)}</td>
        </tr>`
    }
    if (sopCapBase > 0) {
        sopRows += `<tr style="font-style:italic">
            <td>B. Inversión</td>
            <td style="text-align:right">${fmt(sopCapBase)}</td>
            <td style="text-align:right">${fmt(sopCapIva)}</td>
            <td style="text-align:right">${fmt(sopCapIva)}</td>
        </tr>`
    }
    if (!sopRows) sopRows = `<tr><td colspan="4" style="text-align:center;color:var(--subtle);padding:12px 0">Sin facturas recibidas</td></tr>`

    const resultColor = resultado < 0 ? 'var(--accent-ok)' : resultado > 0 ? 'var(--accent)' : 'var(--text)'
    const resultLabel = resultado < 0 ? 'A compensar' : resultado > 0 ? 'A ingresar' : 'Cuadrado'

    el.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px">
            <div>
                <h3 style="font-size:13px;font-weight:600;margin:0 0 8px">IVA devengado (emitidas)</h3>
                <table style="width:100%">
                    <thead><tr>
                        <th style="text-align:left">Tipo</th>
                        <th style="text-align:right">Base</th>
                        <th style="text-align:right">Cuota</th>
                    </tr></thead>
                    <tbody>${devRows}</tbody>
                    <tfoot><tr style="border-top:1px solid var(--border);font-weight:600">
                        <td>Total</td>
                        <td style="text-align:right">${fmt(totalDevBase)}</td>
                        <td style="text-align:right">${fmt(totalDevIva)}</td>
                    </tr></tfoot>
                </table>
            </div>
            <div>
                <h3 style="font-size:13px;font-weight:600;margin:0 0 8px">IVA soportado (recibidas)</h3>
                <table style="width:100%">
                    <thead><tr>
                        <th style="text-align:left">Tipo</th>
                        <th style="text-align:right">Base</th>
                        <th style="text-align:right">Bruto</th>
                        <th style="text-align:right">Deducible</th>
                    </tr></thead>
                    <tbody>${sopRows}</tbody>
                    <tfoot><tr style="border-top:1px solid var(--border);font-weight:600">
                        <td>Total</td>
                        <td></td>
                        <td></td>
                        <td style="text-align:right">${fmt(totalSopDed)}</td>
                    </tr></tfoot>
                </table>
            </div>
        </div>

        <div style="border-top:2px solid var(--border);padding-top:16px;margin-bottom:24px">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:14px;font-weight:600">Resultado ${year} T${q}</span>
                <span style="font-size:20px;font-weight:700;color:${resultColor}">
                    ${resultado >= 0 ? '+' : ''}${fmt(resultado)}
                    <span style="font-size:12px;font-weight:400;color:var(--subtle)">${resultLabel}</span>
                </span>
            </div>
        </div>

        <div style="border:1px solid var(--border);border-radius:8px;padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <div>
                    <strong style="font-size:13px">Estado del trimestre</strong>
                    <div style="font-size:12px;color:var(--subtle);margin-top:4px">
                        ${cerrado
                            ? `✅ Presentado el ${cierre.presented_at}`
                            : '⏳ Pendiente de presentación'
                        }
                    </div>
                </div>
                <button class="btn ${cerrado ? 'btn-secondary' : 'btn-primary'}" id="btnMarcarPresentado"
                    style="font-size:12px" ${cerrado ? 'disabled' : ''}>
                    ${cerrado ? '✅ Ya presentado' : 'Marcar como presentado'}
                </button>
            </div>
        </div>
    `

    if (!cerrado) {
        document.getElementById('btnMarcarPresentado').addEventListener('click', async () => {
            if (!confirm(`¿Marcar ${year} T${q} como presentado?\nUna vez presentado no se podrán modificar ni eliminar las entradas del trimestre.`)) return
            const { error } = await supabase.from('fiscal_closings').upsert({
                model:        'F69',
                year:         year,
                quarter:      q,
                presented_at: new Date().toISOString().split('T')[0],
            }, { onConflict: 'model,year,quarter' })
            if (error) { alert('Error: ' + error.message); return }
            mostrarToast('Trimestre marcado como presentado')
            cargarTodo()
        })
    }
}

// ===== HELPER ALERTAS =====
function _alerta(tipo, nivel, titulo, bodyHtml) {
    const bg     = nivel === 'error' ? '#fef2f2' : '#fffbeb'
    const border = nivel === 'error' ? '#ef4444' : '#d97706'
    const icon   = nivel === 'error' ? '🔴' : '⚠️'
    const bodyId = `ab-${tipo}`
    return `
    <div style="background:${bg};border:1px solid ${border};border-radius:6px;margin-bottom:8px;overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;cursor:pointer"
             onclick="var b=document.getElementById('${bodyId}');b.style.display=b.style.display==='none'?'block':'none'">
            <span style="font-size:13px;font-weight:600">${icon} ${titulo}</span>
            <span style="font-size:11px;color:var(--subtle)">▼ ver detalle</span>
        </div>
        <div id="${bodyId}" style="display:none;padding:0 14px 14px">
            ${bodyHtml}
        </div>
    </div>`
}

// ===== ALERTAS (independientes del trimestre seleccionado) =====
async function cargarAlertas() {
    const el = document.getElementById('alertas-fiscales')

    const now    = new Date()
    const curYear = now.getFullYear()
    const curQ   = Math.ceil((now.getMonth() + 1) / 3)

    // Fase 1: todas las queries independientes en paralelo
    const [
        { data: registeredDocs },
        { data: provsConFactura },
        { data: sinPdf },
        { data: allChargesRaw },
        { data: gastosYQ },
        { data: emitidasYQ },
        { data: allClosings },
    ] = await Promise.all([
        supabase.from('supplier_invoices').select('document_id'),
        supabase.from('providers').select('id, name').eq('invoice', true),
        supabase.from('issued_invoices')
            .select('id, invoice_number, client_name, accrual_date, total')
            .is('file_path', null)
            .order('accrual_date', { ascending: false }),
        supabase.from('charges')
            .select('id, client_id, amount, comments')
            .is('invoice_number', null)
            .gte('amount', 0.1),
        supabase.from('supplier_invoices').select('booked_date'),
        supabase.from('issued_invoices').select('accrual_date'),
        supabase.from('fiscal_closings').select('year, quarter, presented_at').eq('model', 'F69'),
    ])

    // Fase 2: docs pendientes (depende de registeredDocs)
    const regDocIds = (registeredDocs ?? []).map(r => r.document_id).filter(id => id != null)
    let docsQuery = supabase
        .from('supplier_documents')
        .select('id, provider_id, concept, notes, uploaded_at, file_path')
        .order('uploaded_at', { ascending: false })

    if (regDocIds.length > 0) {
        docsQuery = docsQuery.not('id', 'in', `(${regDocIds.join(',')})`)
    }

    const provIds = (provsConFactura ?? []).map(p => p.id)

    // Fase 2: docs + payments + supplier_invoices por proveedor (en paralelo)
    const [
        { data: allPendingDocs },
        { data: paidPayments },
        { data: provInvoices },
    ] = await Promise.all([
        docsQuery,
        provIds.length > 0
            ? supabase.from('payments').select('provider_id, amount').in('provider_id', provIds).eq('paid', true)
            : Promise.resolve({ data: [] }),
        provIds.length > 0
            ? supabase.from('supplier_invoices').select('provider_id, total').in('provider_id', provIds)
            : Promise.resolve({ data: [] }),
    ])

    // Procesar alerta 1: docs sin anotar (filtrar sin_archivo en JS)
    const pendingDocs = (allPendingDocs ?? []).filter(d => !d.file_path.endsWith('_sin_archivo'))

    // Obtener nombres de proveedores para los docs pendientes
    const docProvIds = [...new Set(pendingDocs.filter(d => d.provider_id).map(d => d.provider_id))]
    let provNamesMap = {}
    if (docProvIds.length > 0) {
        const { data: provNamesData } = await supabase.from('providers').select('id, name').in('id', docProvIds)
        provNamesMap = Object.fromEntries((provNamesData ?? []).map(p => [p.id, p.name]))
    }

    // Procesar alerta 2: proveedores con pagos sin factura suficiente
    const paidMap    = {}
    const invoiceMap = {}
    for (const p of (paidPayments ?? [])) paidMap[p.provider_id]    = (paidMap[p.provider_id]    ?? 0) + (p.amount ?? 0)
    for (const i of (provInvoices  ?? [])) invoiceMap[i.provider_id] = (invoiceMap[i.provider_id] ?? 0) + (i.total  ?? 0)

    const provsConDiscrepancia = (provsConFactura ?? []).filter(p => {
        const paid     = paidMap[p.id]    ?? 0
        const invoiced = invoiceMap[p.id] ?? 0
        return paid > 0.01 && (paid - invoiced) > 0.01
    })

    // Procesar alerta 4: charges sin facturar (excluir sfcom)
    const chargesSinFacturar = (allChargesRaw ?? []).filter(c => !c.comments?.startsWith('WEB'))
    const chargesMap = {}
    for (const c of chargesSinFacturar) {
        chargesMap[c.client_id] = (chargesMap[c.client_id] ?? 0) + (c.amount ?? 0)
    }
    const chargesAgrupados = Object.entries(chargesMap)
        .map(([clientId, total]) => ({ clientId, total }))
        .sort((a, b) => b.total - a.total)

    // Procesar alerta 5: trimestres pasados sin presentar con datos
    const quartersWithData = new Set()
    for (const r of (gastosYQ ?? [])) {
        const d = new Date(r.booked_date)
        quartersWithData.add(`${d.getFullYear()}-${Math.ceil((d.getMonth() + 1) / 3)}`)
    }
    for (const r of (emitidasYQ ?? [])) {
        const d = new Date(r.accrual_date)
        quartersWithData.add(`${d.getFullYear()}-${Math.ceil((d.getMonth() + 1) / 3)}`)
    }

    const closedSet = new Set(
        (allClosings ?? []).filter(c => c.presented_at).map(c => `${c.year}-${c.quarter}`)
    )

    const trimestresAbiertos = [...quartersWithData]
        .filter(yq => {
            if (closedSet.has(yq)) return false
            const [y, q] = yq.split('-').map(Number)
            return y < curYear || (y === curYear && q < curQ)
        })
        .map(yq => { const [y, q] = yq.split('-').map(Number); return { year: y, q } })
        .sort((a, b) => a.year - b.year || a.q - b.q)

    // ===== RENDERIZAR =====
    const partes = []

    // Alerta 1: documentos sin anotar
    if (pendingDocs.length > 0) {
        const filas = pendingDocs.map(d => {
            const prov   = d.provider_id ? (provNamesMap[d.provider_id] ?? d.provider_id) : 'Gasto general'
            const fecha  = d.uploaded_at.split('T')[0]
            const nombre = d.concept || d.notes
                || d.file_path.split('/').pop().replace(/^\d+_/, '')
            return `<tr style="font-size:12px">
                <td style="padding:4px 8px">${prov}</td>
                <td style="padding:4px 8px;color:var(--subtle)">${fecha}</td>
                <td style="padding:4px 8px">${nombre}</td>
                <td style="padding:4px 8px;white-space:nowrap">
                    <button class="btn btn-primary" style="font-size:11px;padding:2px 6px;margin-right:4px"
                        onclick="anotarGasto(${d.id})">Anotar</button>
                    <button class="btn btn-secondary" style="font-size:11px;padding:2px 6px"
                        onclick="descartarAlerta('doc-${d.id}')">Descartar</button>
                </td>
            </tr>`
        }).join('')

        partes.push(_alerta(
            'docs-pendientes', 'warning',
            `${pendingDocs.length} documento${pendingDocs.length > 1 ? 's' : ''} sin registrar en el libro fiscal`,
            `<table style="width:100%;border-collapse:collapse;margin-top:8px">
                <thead><tr style="font-size:11px;color:var(--subtle)">
                    <th style="text-align:left;padding:4px 8px">Proveedor</th>
                    <th style="text-align:left;padding:4px 8px">Fecha</th>
                    <th style="text-align:left;padding:4px 8px">Concepto / archivo</th>
                    <th style="padding:4px 8px"></th>
                </tr></thead>
                <tbody>${filas}</tbody>
            </table>`
        ))
    }

    // Alerta 2: proveedores con pagos sin factura
    if (provsConDiscrepancia.length > 0) {
        const filas = provsConDiscrepancia.map(p => {
            const paid     = paidMap[p.id]    ?? 0
            const invoiced = invoiceMap[p.id] ?? 0
            return `<tr style="font-size:12px">
                <td style="padding:4px 8px;font-weight:600">${p.id}</td>
                <td style="padding:4px 8px;color:var(--subtle)">${p.name ?? ''}</td>
                <td style="padding:4px 8px;text-align:right">${fmt(paid)}</td>
                <td style="padding:4px 8px;text-align:right;color:var(--accent)">${fmt(invoiced)}</td>
                <td style="padding:4px 8px;text-align:right;font-weight:600">${fmt(paid - invoiced)}</td>
                <td style="padding:4px 8px;white-space:nowrap">
                    <button class="btn btn-secondary" style="font-size:11px;padding:2px 6px"
                        onclick="descartarAlerta('prov-${p.id}')">Descartar</button>
                </td>
            </tr>`
        }).join('')

        partes.push(_alerta(
            'provs-sin-factura', 'error',
            `${provsConDiscrepancia.length} proveedor${provsConDiscrepancia.length > 1 ? 'es' : ''} con pagos sin factura registrada`,
            `<table style="width:100%;border-collapse:collapse;margin-top:8px">
                <thead><tr style="font-size:11px;color:var(--subtle)">
                    <th style="text-align:left;padding:4px 8px">ID</th>
                    <th style="text-align:left;padding:4px 8px">Nombre</th>
                    <th style="text-align:right;padding:4px 8px">Pagado</th>
                    <th style="text-align:right;padding:4px 8px">Registrado</th>
                    <th style="text-align:right;padding:4px 8px">Diferencia</th>
                    <th style="padding:4px 8px"></th>
                </tr></thead>
                <tbody>${filas}</tbody>
            </table>`
        ))
    }

    // Alerta 3: emitidas sin PDF
    if ((sinPdf ?? []).length > 0) {
        const filas = sinPdf.map(r => `<tr style="font-size:12px">
            <td style="padding:4px 8px;font-size:11px">${r.invoice_number}</td>
            <td style="padding:4px 8px">${r.client_name}</td>
            <td style="padding:4px 8px;color:var(--subtle)">${r.accrual_date}</td>
            <td style="padding:4px 8px;text-align:right">${fmt(r.total)}</td>
            <td style="padding:4px 8px;white-space:nowrap">
                <button class="btn btn-secondary" style="font-size:11px;padding:2px 6px"
                    onclick="descartarAlerta('em-${r.id}')">Descartar</button>
            </td>
        </tr>`).join('')

        partes.push(_alerta(
            'emitidas-sin-pdf', 'warning',
            `${sinPdf.length} factura${sinPdf.length > 1 ? 's' : ''} emitida${sinPdf.length > 1 ? 's' : ''} sin PDF en el libro`,
            `<table style="width:100%;border-collapse:collapse;margin-top:8px">
                <thead><tr style="font-size:11px;color:var(--subtle)">
                    <th style="text-align:left;padding:4px 8px">Nº factura</th>
                    <th style="text-align:left;padding:4px 8px">Cliente</th>
                    <th style="text-align:left;padding:4px 8px">Devengo</th>
                    <th style="text-align:right;padding:4px 8px">Total</th>
                    <th style="padding:4px 8px"></th>
                </tr></thead>
                <tbody>${filas}</tbody>
            </table>`
        ))
    }

    // Alerta 4: charges sin facturar
    if (chargesAgrupados.length > 0) {
        const filas = chargesAgrupados.map(({ clientId, total }) => `<tr style="font-size:12px">
            <td style="padding:4px 8px;font-weight:600">${clientId}</td>
            <td style="padding:4px 8px;text-align:right">${fmt(total)}</td>
            <td style="padding:4px 8px;white-space:nowrap">
                <button class="btn btn-secondary" style="font-size:11px;padding:2px 6px"
                    onclick="descartarAlerta('ch-${clientId}')">Descartar</button>
            </td>
        </tr>`).join('')

        partes.push(_alerta(
            'charges-sin-factura', 'warning',
            `${chargesAgrupados.length} cliente${chargesAgrupados.length > 1 ? 's' : ''} con cobros sin facturar`,
            `<table style="width:100%;border-collapse:collapse;margin-top:8px">
                <thead><tr style="font-size:11px;color:var(--subtle)">
                    <th style="text-align:left;padding:4px 8px">Cliente</th>
                    <th style="text-align:right;padding:4px 8px">Base imponible sin facturar</th>
                    <th style="padding:4px 8px"></th>
                </tr></thead>
                <tbody>${filas}</tbody>
            </table>`
        ))
    }

    // Alerta 5: trimestres pasados no presentados
    if (trimestresAbiertos.length > 0) {
        const filas = trimestresAbiertos.map(({ year, q }) => `<tr style="font-size:12px">
            <td style="padding:4px 8px;font-weight:600">${year} T${q}</td>
            <td style="padding:4px 8px;color:var(--accent)">⏳ Pendiente de presentación</td>
            <td style="padding:4px 8px;white-space:nowrap">
                <button class="btn btn-primary" style="font-size:11px;padding:2px 6px;margin-right:4px"
                    onclick="irATrimestre(${year},${q})">Ir al trimestre</button>
                <button class="btn btn-secondary" style="font-size:11px;padding:2px 6px"
                    onclick="descartarAlerta('trim-${year}-${q}')">Descartar</button>
            </td>
        </tr>`).join('')

        partes.push(_alerta(
            'trimestres-pendientes', 'error',
            `${trimestresAbiertos.length} trimestre${trimestresAbiertos.length > 1 ? 's' : ''} pasado${trimestresAbiertos.length > 1 ? 's' : ''} sin presentar`,
            `<table style="width:100%;border-collapse:collapse;margin-top:8px">
                <thead><tr style="font-size:11px;color:var(--subtle)">
                    <th style="text-align:left;padding:4px 8px">Período</th>
                    <th style="text-align:left;padding:4px 8px">Estado</th>
                    <th style="padding:4px 8px"></th>
                </tr></thead>
                <tbody>${filas}</tbody>
            </table>`
        ))
    }

    el.innerHTML = partes.join('')
}

window.descartarAlerta = function (_id) {
    mostrarToast('Pendiente de implementar', '#6b7280')
}

// ===== BLOQUE 6: REGISTRAR FACTURA EN LIBRO FISCAL =====

document.getElementById('btnNuevoGastoFiscal').addEventListener('click', () =>
    abrirDlgGasto(null, null, () => { cargarTodo(); cargarAlertas() }))

window.anotarGasto = (docId) =>
    abrirDlgGasto(docId, null, () => { cargarTodo(); cargarAlertas() })

// ===== EXCEL EXPORT =====
document.getElementById('btnExportGastos').addEventListener('click', async () => {
    if (!_gastosData.length) { mostrarToast('Sin datos para exportar', '#6b7280'); return }
    const year = +selectAno.value
    const q    = +selectTri.value
    await exportTable(
        _gastosData.map(r => {
            const lines = r.supplier_invoice_vat_lines ?? []
            return {
                ...r,
                _base: lines.reduce((s, l) => s + (l.base_amount ?? 0), 0),
                _iva:  lines.reduce((s, l) => s + (l.vat_amount  ?? 0), 0),
            }
        }),
        [
            { key: 'issue_date',     label: 'Fecha factura' },
            { key: 'invoice_number', label: 'Nº factura' },
            { key: 'issuer_name',    label: 'Emisor' },
            { key: 'issuer_nif',     label: 'NIF' },
            { key: '_base',          label: 'Base',      fmt: v => +fmtN(v) },
            { key: '_iva',           label: 'IVA',       fmt: v => +fmtN(v) },
            { key: 'total',          label: 'Total',     fmt: v => +fmtN(v) },
            { key: 'category',       label: 'Categoría' },
            { key: 'notes',          label: 'Notas' },
        ],
        `gastos_${year}_T${q}.xlsx`
    )
})

document.getElementById('btnExportEmitidas').addEventListener('click', async () => {
    if (!_emitidasData.length) { mostrarToast('Sin datos para exportar', '#6b7280'); return }
    const year = +selectAno.value
    const q    = +selectTri.value
    await exportTable(
        _emitidasData.map(r => {
            const lines = r.issued_invoice_vat_lines ?? []
            return {
                ...r,
                _base: lines.reduce((s, l) => s + (l.base_amount ?? 0), 0),
                _iva:  lines.reduce((s, l) => s + (l.vat_amount  ?? 0), 0),
            }
        }),
        [
            { key: 'accrual_date',   label: 'Fecha devengo' },
            { key: 'invoice_number', label: 'Nº factura' },
            { key: 'client_name',    label: 'Cliente' },
            { key: 'client_nif',     label: 'NIF cliente' },
            { key: '_base',          label: 'Base',       fmt: v => +fmtN(v) },
            { key: '_iva',           label: 'IVA',        fmt: v => +fmtN(v) },
            { key: 'irpf_amount',    label: 'IRPF',       fmt: v => +fmtN(v) },
            { key: 'total',          label: 'Total líq.', fmt: v => +fmtN(v) },
            { key: 'invoice_type',   label: 'Tipo' },
            { key: 'operation_type', label: 'Operación' },
        ],
        `emitidas_${year}_T${q}.xlsx`
    )
})

// ===== ZIP GASTOS (documentos recibidos) =====
document.getElementById('btnZipGastos').addEventListener('click', exportarZipGastos)

async function exportarZipGastos() {
    const year = +selectAno.value
    const q    = +selectTri.value
    const { start, end } = quarterDates(year, q)

    const { data: invoices } = await supabase
        .from('supplier_invoices')
        .select('id, invoice_number, issuer_name, document_id')
        .gte('issue_date', start)
        .lte('issue_date', end)
        .not('document_id', 'is', null)

    if (!invoices?.length) {
        mostrarToast('Sin documentos adjuntos en este trimestre', '#6b7280')
        return
    }

    mostrarToast('Generando ZIP…', '#2563eb')
    await _cargarJSZip()

    const docIds = invoices.map(i => i.document_id)
    const { data: docs } = await supabase
        .from('supplier_documents')
        .select('id, file_path')
        .in('id', docIds)

    const docMap = new Map((docs ?? []).map(d => [d.id, d.file_path]))
    const zip    = new window.JSZip()
    let   added  = 0

    for (const inv of invoices) {
        const filePath = docMap.get(inv.document_id)
        if (!filePath || filePath.endsWith('_sin_archivo')) continue

        const { data: urlData } = await supabase.storage
            .from('supplier-invoices')
            .createSignedUrl(filePath, 120)
        if (!urlData?.signedUrl) continue

        try {
            const res  = await fetch(urlData.signedUrl)
            const blob = await res.blob()
            const ext  = filePath.split('.').pop()
            const num  = (inv.invoice_number ?? `doc-${inv.id}`).replace(/[/\\:*?"<>|]/g, '_')
            const emi  = (inv.issuer_name    ?? 'emisor').replace(/[/\\:*?"<>|]/g, '_').slice(0, 30)
            zip.file(`${num}_${emi}.${ext}`, blob)
            added++
        } catch {}
    }

    if (added === 0) { mostrarToast('No se pudieron descargar los documentos', '#b91c1c'); return }

    const blob = await zip.generateAsync({ type: 'blob' })
    _descargarBlob(blob, `fiscal_${year}_T${q}_documentos.zip`)
    mostrarToast(`ZIP listo — ${added} documento${added > 1 ? 's' : ''}`)
}

// ===== ZIP EMITIDAS (PDFs de facturas emitidas) =====
document.getElementById('btnZipEmitidas').addEventListener('click', exportarZipEmitidas)

async function exportarZipEmitidas() {
    if (!_emitidasData.length) { mostrarToast('Sin facturas emitidas en este trimestre', '#6b7280'); return }

    const year   = +selectAno.value
    const q      = +selectTri.value
    const sinPdf = _emitidasData.filter(r => !r.file_path)
    const conPdf = _emitidasData.filter(r =>  r.file_path)

    if (sinPdf.length > 0) {
        const nums = sinPdf.map(r => r.invoice_number).join(', ')
        mostrarToast(`Sin PDF: ${nums}`, '#b91c1c')
    }
    if (!conPdf.length) { mostrarToast('Ninguna factura emitida tiene PDF adjunto', '#6b7280'); return }

    mostrarToast('Generando ZIP…', '#2563eb')
    await _cargarJSZip()

    const zip   = new window.JSZip()
    let   added = 0

    for (const inv of conPdf) {
        const { data: urlData } = await supabase.storage.from('invoices').createSignedUrl(inv.file_path, 120)
        if (!urlData?.signedUrl) continue
        try {
            const res  = await fetch(urlData.signedUrl)
            const blob = await res.blob()
            const ext  = inv.file_path.split('.').pop()
            const num  = (inv.invoice_number ?? `inv-${inv.id}`).replace(/[/\\:*?"<>|]/g, '_')
            zip.file(`${num}.${ext}`, blob)
            added++
        } catch {}
    }

    if (!added) { mostrarToast('No se pudieron descargar las facturas', '#b91c1c'); return }

    const blob = await zip.generateAsync({ type: 'blob' })
    _descargarBlob(blob, `emitidas_${year}_T${q}_pdfs.zip`)
    mostrarToast(`ZIP listo — ${added} factura${added > 1 ? 's' : ''}`)
}

// ===== PAQUETE ASESOR =====
document.getElementById('btnPaqueteAsesor').addEventListener('click', exportarPaqueteAsesor)

async function exportarPaqueteAsesor() {
    if (!_gastosData.length && !_emitidasData.length) {
        mostrarToast('Sin datos en el trimestre seleccionado', '#6b7280')
        return
    }

    const year   = +selectAno.value
    const q      = +selectTri.value
    const sinPdf = _emitidasData.filter(r => !r.file_path)

    if (sinPdf.length > 0) {
        const nums = sinPdf.map(r => r.invoice_number).join(', ')
        const ok   = confirm(`⚠️ ${sinPdf.length} factura${sinPdf.length > 1 ? 's' : ''} emitida${sinPdf.length > 1 ? 's' : ''} sin PDF adjunto:\n${nums}\n\nSe generará el paquete igualmente. ¿Continuar?`)
        if (!ok) return
    }

    mostrarToast('Generando paquete asesor…', '#2563eb')
    await _cargarJSZip()
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')

    // Construir Excel con dos hojas
    const wb = XLSX.utils.book_new()

    if (_gastosData.length > 0) {
        const rows = _gastosData.map(r => {
            const lines = r.supplier_invoice_vat_lines ?? []
            const base  = lines.reduce((s, l) => s + (l.base_amount ?? 0), 0)
            const iva   = lines.reduce((s, l) => s + (l.vat_amount  ?? 0), 0)
            return [r.booked_date, r.invoice_number ?? '', r.issuer_name ?? '', r.issuer_nif ?? '',
                    +fmtN(base), +fmtN(iva), +fmtN(r.total), r.category ?? '', r.notes ?? '']
        })
        const ws = XLSX.utils.aoa_to_sheet([
            ['Fecha libro', 'Nº factura', 'Emisor', 'NIF', 'Base', 'IVA', 'Total', 'Categoría', 'Notas'],
            ...rows,
        ])
        XLSX.utils.book_append_sheet(wb, ws, 'Gastos')
    }

    if (_emitidasData.length > 0) {
        const rows = _emitidasData.map(r => {
            const lines = r.issued_invoice_vat_lines ?? []
            const base  = lines.reduce((s, l) => s + (l.base_amount ?? 0), 0)
            const iva   = lines.reduce((s, l) => s + (l.vat_amount  ?? 0), 0)
            return [r.accrual_date, r.invoice_number ?? '', r.client_name ?? '', r.client_nif ?? '',
                    +fmtN(base), +fmtN(iva), +fmtN(r.irpf_amount), +fmtN(r.total),
                    r.invoice_type ?? '', r.operation_type ?? '']
        })
        const ws = XLSX.utils.aoa_to_sheet([
            ['Fecha devengo', 'Nº factura', 'Cliente', 'NIF cliente', 'Base', 'IVA', 'IRPF', 'Total líq.', 'Tipo', 'Operación'],
            ...rows,
        ])
        XLSX.utils.book_append_sheet(wb, ws, 'Emitidas')
    }

    const xlsxBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })

    const zip = new window.JSZip()
    zip.file(`fiscal_${year}_T${q}.xlsx`, xlsxBuffer)

    // Carpeta facturas_recibidas
    const gastosConDoc = _gastosData.filter(r => r.document_id != null)
    if (gastosConDoc.length > 0) {
        const docIds = gastosConDoc.map(r => r.document_id)
        const { data: docs } = await supabase
            .from('supplier_documents')
            .select('id, file_path')
            .in('id', docIds)
        const docMap    = new Map((docs ?? []).map(d => [d.id, d.file_path]))
        const recFolder = zip.folder('facturas_recibidas')

        for (const inv of gastosConDoc) {
            const filePath = docMap.get(inv.document_id)
            if (!filePath || filePath.endsWith('_sin_archivo')) continue
            const { data: urlData } = await supabase.storage
                .from('supplier-invoices')
                .createSignedUrl(filePath, 120)
            if (!urlData?.signedUrl) continue
            try {
                const res  = await fetch(urlData.signedUrl)
                const blob = await res.blob()
                const ext  = filePath.split('.').pop()
                const num  = (inv.invoice_number ?? `doc-${inv.id}`).replace(/[/\\:*?"<>|]/g, '_')
                const emi  = (inv.issuer_name    ?? 'emisor').replace(/[/\\:*?"<>|]/g, '_').slice(0, 30)
                recFolder.file(`${num}_${emi}.${ext}`, blob)
            } catch {}
        }
    }

    // Carpeta facturas_emitidas
    const emitConPdf = _emitidasData.filter(r => r.file_path)
    if (emitConPdf.length > 0) {
        const emiFolder = zip.folder('facturas_emitidas')
        for (const inv of emitConPdf) {
            const { data: urlData } = await supabase.storage
                .from('invoices')
                .createSignedUrl(inv.file_path, 120)
            if (!urlData?.signedUrl) continue
            try {
                const res  = await fetch(urlData.signedUrl)
                const blob = await res.blob()
                const ext  = inv.file_path.split('.').pop()
                const num  = (inv.invoice_number ?? `inv-${inv.id}`).replace(/[/\\:*?"<>|]/g, '_')
                emiFolder.file(`${num}.${ext}`, blob)
            } catch {}
        }
    }

    const blob = await zip.generateAsync({ type: 'blob' })
    _descargarBlob(blob, `paquete_asesor_${year}_T${q}.zip`)
    mostrarToast('Paquete asesor listo')
}

// ===== UTILIDADES =====
function _descargarBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a   = document.createElement('a')
    a.href    = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
}

function _cargarJSZip() {
    if (window.JSZip) return Promise.resolve()
    return new Promise((resolve, reject) => {
        const s   = document.createElement('script')
        s.src     = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
        s.onload  = resolve
        s.onerror = reject
        document.head.appendChild(s)
    })
}

// ===== ARRANQUE =====
cargarTodo()
cargarAlertas()
