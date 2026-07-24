import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, initTemporada, exportTable, checkTrimCerrado, mostrarModalTrimCerrado, validarNif } from './utils.js'
import { mostrarToast } from './verificacion.js'
import { abrirDlgGasto } from './dlg-gasto.js'
import { iniciarAnalisisFiscal } from './analisis-fiscal.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

const { data: _seasonsRaw } = await supabase.from('services').select('season').order('season', { ascending: false })
const _seasonsList = [...new Set((_seasonsRaw ?? []).map(r => r.season))]
await initTemporada(_seasonsList)

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
const TAB_IDS = { gastos: 'tab-gastos', emitidas: 'tab-emitidas', f69: 'tab-f69', '715': 'tab-715', '190': 'tab-190' }

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
let _gastosData        = []
let _emitidasData      = []
let _gastosAnualesData = []

// ===== CARGA PRINCIPAL =====
async function cargarTodo() {
    const year = +selectAno.value
    const q    = +selectTri.value
    const { start, end } = quarterDates(year, q)

    const [
        { data: allGastos   },
        { data: emitidas    },
        { data: cierre      },
        { data: allClosings },
        { data: cierre715   },
        { data: cierre190   },
    ] = await Promise.all([
        supabase.from('supplier_invoices')
            .select('*, supplier_invoice_vat_lines(*)'),
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
        supabase.from('fiscal_closings')
            .select('year, quarter, presented_at')
            .eq('model', 'F69'),
        supabase.from('fiscal_closings')
            .select('*')
            .eq('model', '715')
            .eq('year', year)
            .eq('quarter', q)
            .maybeSingle(),
        supabase.from('fiscal_closings')
            .select('*')
            .eq('model', '190')
            .eq('year', year)
            .eq('quarter', 0)
            .maybeSingle(),
    ])

    // Trimestres ya presentados (cerrados)
    const closedSet = new Set(
        (allClosings ?? []).filter(c => c.presented_at).map(c => `${c.year}-${c.quarter}`)
    )

    // Fecha efectiva: issue_date si su trimestre está abierto, booked_date si está cerrado
    function _fechaEfectiva(inv) {
        const [y, m] = inv.issue_date.split('-').map(Number)
        const iq = Math.ceil(m / 3)
        return closedSet.has(`${y}-${iq}`) ? inv.booked_date : inv.issue_date
    }

    const gastos = (allGastos ?? [])
        .filter(inv => { const d = _fechaEfectiva(inv); return d >= start && d <= end })
        .sort((a, b) => _fechaEfectiva(a).localeCompare(_fechaEfectiva(b)))

    const gastosAnuales = (allGastos ?? []).filter(inv => {
        const d = _fechaEfectiva(inv)
        return d >= `${year}-01-01` && d <= `${year}-12-31`
    })

    _gastosData        = gastos
    _emitidasData      = emitidas ?? []
    _gastosAnualesData = gastosAnuales

    renderGastos(_gastosData, closedSet)
    renderEmitidas(_emitidasData)
    renderF69(_gastosData, _emitidasData, cierre, year, q)
    render715(_gastosData, cierre715, year, q)
    render190(gastosAnuales, cierre190, year)
    renderCierreBtn(cierre, cierre715, year, q)
}

// ===== FORMATO =====
function fmt(n)  { return (+(n ?? 0)).toFixed(2).replace('.', ',') + ' €' }
function fmtN(n) { return (+(n ?? 0)).toFixed(2) }

// ===== TAB GASTOS =====
function renderGastos(rows, closedSet = new Set()) {
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

    let sumBase = 0, sumIva = 0, sumIrpf = 0, sumTotal = 0
    tbody.innerHTML = rows.map(r => {
        const lines = r.supplier_invoice_vat_lines ?? []
        const base  = lines.reduce((s, l) => s + (l.base_amount ?? 0), 0)
        const iva   = lines.reduce((s, l) => s + (l.vat_amount  ?? 0), 0)
        const irpf  = r.irpf_amount ?? 0
        sumBase  += base
        sumIva   += iva
        sumIrpf  += irpf
        sumTotal += r.total ?? 0
        const d = r.booked_date ?? r.issue_date
        const [ry, rm] = d.split('-').map(Number)
        const esCerrado = closedSet.has(`${ry}-${Math.ceil(rm / 3)}`)
        const btnEliminar = esCerrado
            ? `<span title="Trimestre ya presentado a Hacienda" style="font-size:14px;cursor:default">🔒</span>`
            : `<button class="btn btn-danger" style="font-size:11px;padding:2px 6px" onclick="eliminarGastoFiscal(${r.id})" title="Eliminar del libro fiscal">🗑</button>`
        const nifInvalido = !validarNif(r.issuer_nif).valido && irpf > 0
        const nifCss = nifInvalido
            ? 'font-size:11px;color:#92400e;background:#fffbeb;border-radius:3px;padding:1px 4px'
            : 'font-size:11px;color:var(--subtle)'
        const nifLabel   = (r.issuer_nif ?? '—') + (nifInvalido ? ' ⚠' : '')
        const catLabel   = r.provider_id
            ? `<span style="font-size:11px;color:var(--subtle);font-family:monospace">${r.provider_id}</span>`
            : `<span style="font-size:11px;color:var(--subtle)">${r.category ?? '—'}</span>`
        return `<tr>
            <td style="white-space:nowrap">${r.issue_date}</td>
            <td style="font-size:12px">${r.invoice_number ?? '—'}</td>
            <td>${r.issuer_name ?? '—'}</td>
            <td style="${nifCss}" title="${nifInvalido ? 'NIF inválido — pendiente para el Modelo 190' : ''}">${nifLabel}</td>
            <td style="text-align:right">${fmt(base)}</td>
            <td style="text-align:right">${fmt(iva)}</td>
            <td style="text-align:right;color:var(--accent-warn)">${irpf > 0 ? fmt(irpf) : '—'}</td>
            <td style="text-align:right;font-weight:600">${fmt(r.total)}</td>
            <td>${catLabel}</td>
            <td style="white-space:nowrap;text-align:right">
                ${r.document_id != null ? `<a href="#" onclick="verDocFiscal(${r.document_id});return false" style="font-size:13px;margin-right:6px" title="Ver documento">📄</a>` : ''}
                ${btnEliminar}
            </td>
        </tr>`
    }).join('')

    const irpfPart = sumIrpf > 0
        ? ` &nbsp;·&nbsp; IRPF: <strong>${fmt(sumIrpf)}</strong>`
        : ''
    totales.innerHTML = `Base: <strong>${fmt(sumBase)}</strong> &nbsp;·&nbsp; IVA: <strong>${fmt(sumIva)}</strong>${irpfPart} &nbsp;·&nbsp; Total: <strong>${fmt(sumTotal)}</strong>`
}

window.verDocFiscal = async function (docId) {
    const { data: doc } = await supabase.from('supplier_documents').select('file_path').eq('id', docId).single()
    if (!doc?.file_path || doc.file_path.endsWith('_sin_archivo')) { alert('Sin documento adjunto'); return }
    const { data, error } = await supabase.storage.from('supplier-invoices').createSignedUrl(doc.file_path, 3600)
    if (error || !data?.signedUrl) { alert('No se pudo abrir el documento'); return }
    window.open(data.signedUrl, '_blank')
}

window.eliminarGastoFiscal = async function (id) {
    const { data: inv } = await supabase.from('supplier_invoices').select('booked_date').eq('id', id).single()
    if (inv) {
        const trim = await checkTrimCerrado(supabase, inv.booked_date)
        if (trim.cerrado) { mostrarModalTrimCerrado(trim.year, trim.quarter); return }
    }
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
        const warnSimpl = !r.client_nif && base >= 400
        return `<tr>
            <td style="white-space:nowrap">${r.accrual_date}</td>
            <td style="font-size:12px">${r.invoice_number ?? '—'}</td>
            <td>${r.client_name ?? '—'}</td>
            <td style="font-size:11px;${warnSimpl ? 'color:var(--accent-warn);font-weight:600' : 'color:var(--subtle)'}"
                title="${warnSimpl ? 'Base ≥400€ sin NIF — el receptor puede pedir factura completa' : ''}">${r.client_nif ?? '—'}</td>
            <td style="text-align:right;${warnSimpl ? 'color:var(--accent-warn);font-weight:600' : ''}">${fmt(base)}</td>
            <td style="text-align:right">${fmt(iva)}</td>
            <td style="text-align:right;color:var(--accent-warn)">${fmt(r.irpf_amount)}</td>
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

        <div style="font-size:12px;color:var(--subtle);padding-top:12px;margin-top:4px;border-top:1px solid var(--border)">
            ${cerrado
                ? `✅ F69 presentado el ${cierre.presented_at}`
                : '⏳ F69 pendiente — usa el botón «Cerrar trimestre» de la cabecera'}
        </div>
    `
}

// ===== TAB MODELO 715 =====

function _agrupar190(gastos) {
    const retenidos = gastos.filter(inv => inv.retention_type && inv.retention_type !== 'ninguna')
    const map = new Map()
    for (const inv of retenidos) {
        const { normalizado: nifNorm, valido: nifValido } = validarNif(inv.issuer_nif)
        const key = `${nifNorm || inv.issuer_name}||${inv.retention_type}`
        if (!map.has(key)) {
            map.set(key, {
                nif:       inv.issuer_nif,
                nombre:    inv.issuer_name,
                clave:     inv.retention_type,
                nifValido,
                sumBase:   0,
                sumIrpf:   0,
            })
        }
        const p = map.get(key)
        p.sumBase += (inv.supplier_invoice_vat_lines ?? []).reduce((s, l) => s + (l.base_amount ?? 0), 0)
        p.sumIrpf += inv.irpf_amount ?? 0
    }
    return [...map.values()].sort((a, b) => a.clave.localeCompare(b.clave) || (a.nombre ?? '').localeCompare(b.nombre ?? ''))
}

function render715(gastos, cierre715, year, q) {
    const el = document.getElementById('tab-715-content')
    if (!el) return

    const CLAVE_LABEL = {
        profesional:   'G — Profesional (15%)',
        arrendamiento: 'F — Arrendamiento (19%)',
    }
    const cerrado    = !!cierre715?.presented_at
    const retenidos  = gastos.filter(inv => inv.retention_type && inv.retention_type !== 'ninguna')

    if (!retenidos.length) {
        el.innerHTML = `<p style="color:var(--subtle);font-size:13px;text-align:center;padding:24px 0">Sin retenciones soportadas en T${q} ${year}.</p>`
        return
    }

    const grupos = {}
    for (const inv of retenidos) {
        const key = inv.retention_type
        if (!grupos[key]) grupos[key] = { perceptores: new Set(), sumBase: 0, sumIrpf: 0 }
        const g = grupos[key]
        const { normalizado, valido } = validarNif(inv.issuer_nif)
        g.perceptores.add(valido ? normalizado : `__nombre__${inv.issuer_name}`)
        g.sumBase += (inv.supplier_invoice_vat_lines ?? []).reduce((s, l) => s + (l.base_amount ?? 0), 0)
        g.sumIrpf += inv.irpf_amount ?? 0
    }

    let rows = '', totalPerc = 0, totalBase = 0, totalIrpf = 0
    for (const [key, label] of Object.entries(CLAVE_LABEL)) {
        const g = grupos[key]
        if (!g) continue
        rows += `<tr>
            <td style="font-size:13px">${label}</td>
            <td style="text-align:right">${g.perceptores.size}</td>
            <td style="text-align:right">${fmt(g.sumBase)}</td>
            <td style="text-align:right;font-weight:600">${fmt(g.sumIrpf)}</td>
        </tr>`
        totalPerc += g.perceptores.size
        totalBase += g.sumBase
        totalIrpf += g.sumIrpf
    }

    el.innerHTML = `
        <div style="margin-bottom:16px">
            <table style="width:100%">
                <thead><tr>
                    <th style="text-align:left">Clave</th>
                    <th style="text-align:right">Perceptores</th>
                    <th style="text-align:right">Base</th>
                    <th style="text-align:right">Retención ingresada</th>
                </tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr style="border-top:1px solid var(--border);font-weight:600">
                    <td>Total ${year} T${q}</td>
                    <td style="text-align:right">${totalPerc}</td>
                    <td style="text-align:right">${fmt(totalBase)}</td>
                    <td style="text-align:right">${fmt(totalIrpf)}</td>
                </tr></tfoot>
            </table>
        </div>

        <div style="font-size:12px;color:var(--subtle);padding-top:12px;margin-top:8px;border-top:1px solid var(--border)">
            ${cerrado
                ? `✅ M-715 presentado el ${cierre715.presented_at}`
                : '⏳ M-715 pendiente — usa el botón «Cerrar trimestre» de la cabecera'}
        </div>`
}

// ===== CERRAR TRIMESTRE =====
function renderCierreBtn(cierre, cierre715, year, q) {
    const btn = document.getElementById('btnCerrarTrimestre')
    if (!btn) return

    const f69Cerrado  = !!cierre?.presented_at
    const m715Cerrado = !!cierre715?.presented_at
    const hayRet      = _gastosData.some(inv => inv.retention_type && inv.retention_type !== 'ninguna')
    const todoCerrado = f69Cerrado && (!hayRet || m715Cerrado)

    if (todoCerrado) {
        btn.disabled    = true
        btn.className   = 'btn btn-secondary'
        btn.textContent = `✅ T${q} ${year} cerrado`
        btn.onclick     = null
        return
    }

    btn.disabled    = false
    btn.className   = 'btn btn-primary'
    btn.textContent = `🔒 Cerrar T${q} ${year}`
    btn.onclick = async () => {
        if (!confirm(`¿Marcar T${q} ${year} como presentado?\nUna vez cerrado no se podrán modificar las entradas del trimestre.`)) return
        const hoy = new Date().toISOString().split('T')[0]
        const ops = [
            supabase.from('fiscal_closings').upsert(
                { model: 'F69', year, quarter: q, presented_at: hoy },
                { onConflict: 'model,year,quarter' }
            ),
        ]
        if (hayRet) {
            ops.push(
                supabase.from('fiscal_closings').upsert(
                    { model: '715', year, quarter: q, presented_at: hoy },
                    { onConflict: 'model,year,quarter' }
                )
            )
        }
        const results = await Promise.all(ops)
        const err = results.find(r => r.error)
        if (err) { alert('Error: ' + err.error.message); return }
        mostrarToast('Trimestre cerrado')
        cargarTodo()
        cargarAlertas()
    }
}

// ===== TAB MODELO 190 =====

function render190(gastosAnuales, cierre190, year) {
    const el = document.getElementById('tab-190-content')
    if (!el) return

    const CLAVE_LABEL = {
        profesional:   'G — Prof. 15%',
        arrendamiento: 'F — Arren. 19%',
    }
    const cerrado     = !!cierre190?.presented_at
    const perceptores = _agrupar190(gastosAnuales)

    if (!perceptores.length) {
        el.innerHTML = `<p style="color:var(--subtle);font-size:13px;text-align:center;padding:24px 0">Sin retenciones soportadas en ${year}.</p>`
        return
    }

    const nifInvalidos = perceptores.filter(p => !p.nifValido).length

    const rows = perceptores.map(p => {
        const nifCss = !p.nifValido
            ? 'font-family:monospace;color:#92400e;background:#fffbeb;border-radius:3px;padding:1px 4px'
            : 'font-family:monospace;color:var(--subtle)'
        return `<tr style="font-size:13px">
            <td style="${nifCss}" title="${!p.nifValido ? 'NIF inválido' : ''}">${p.nif ?? '—'}${!p.nifValido ? ' ⚠' : ''}</td>
            <td>${p.nombre ?? '—'}</td>
            <td style="font-size:12px;color:var(--subtle)">${CLAVE_LABEL[p.clave] ?? p.clave}</td>
            <td style="text-align:right">${fmt(p.sumBase)}</td>
            <td style="text-align:right;font-weight:600">${fmt(p.sumIrpf)}</td>
        </tr>`
    }).join('')

    const totalBase = perceptores.reduce((s, p) => s + p.sumBase, 0)
    const totalIrpf = perceptores.reduce((s, p) => s + p.sumIrpf, 0)

    el.innerHTML = `
        <div style="font-size:12px;color:var(--subtle);margin-bottom:8px">Año ${year} completo — una fila por perceptor y clave</div>

        ${nifInvalidos > 0 ? `
        <div style="font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;padding:8px 12px;margin-bottom:12px">
            ⚠️ ${nifInvalidos} perceptor${nifInvalidos > 1 ? 'es' : ''} con NIF inválido — corrige antes de presentar el modelo
        </div>` : ''}

        <div style="margin-bottom:16px">
            <table style="width:100%">
                <thead><tr>
                    <th style="text-align:left">NIF</th>
                    <th style="text-align:left">Nombre</th>
                    <th style="text-align:left">Clave</th>
                    <th style="text-align:right">Base</th>
                    <th style="text-align:right">Retención</th>
                </tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr style="border-top:1px solid var(--border);font-weight:600">
                    <td colspan="3">Total ${year}</td>
                    <td style="text-align:right">${fmt(totalBase)}</td>
                    <td style="text-align:right">${fmt(totalIrpf)}</td>
                </tr></tfoot>
            </table>
        </div>

        <div style="border:1px solid var(--border);border-radius:8px;padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <div>
                    <strong style="font-size:13px">Estado del modelo</strong>
                    <div style="font-size:12px;color:var(--subtle);margin-top:4px">
                        ${cerrado
                            ? `✅ Presentado el ${cierre190.presented_at}`
                            : '⏳ Pendiente de presentación (enero del año siguiente)'}
                    </div>
                </div>
                <button class="btn ${cerrado ? 'btn-secondary' : 'btn-primary'}" id="btn190Presentado"
                    style="font-size:12px" ${cerrado ? 'disabled' : ''}>
                    ${cerrado ? '✅ Ya presentado' : 'Marcar como presentado'}
                </button>
            </div>
        </div>`

    if (!cerrado) {
        document.getElementById('btn190Presentado').addEventListener('click', async () => {
            if (nifInvalidos > 0) {
                const ok = confirm(`⚠️ Hay ${nifInvalidos} perceptor${nifInvalidos > 1 ? 'es' : ''} con NIF inválido.\n\n¿Marcar el Modelo 190 de ${year} como presentado de todas formas?`)
                if (!ok) return
            } else {
                if (!confirm(`¿Marcar Modelo 190 de ${year} como presentado?`)) return
            }
            const { error } = await supabase.from('fiscal_closings').upsert({
                model: '190', year, quarter: 0,
                presented_at: new Date().toISOString().split('T')[0],
            }, { onConflict: 'model,year,quarter' })
            if (error) { alert('Error: ' + error.message); return }
            mostrarToast('Modelo 190 marcado como presentado')
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
        { data: invConRetencion },
        { data: emitSinNif },
    ] = await Promise.all([
        supabase.from('supplier_invoices').select('document_id'),
        supabase.from('providers').select('id, name, comments').eq('invoice', true),
        supabase.from('issued_invoices')
            .select('id, invoice_number, client_name, accrual_date, total')
            .is('file_path', null)
            .order('accrual_date', { ascending: false }),
        supabase.from('charges')
            .select('id, client_id, amount, comments, invoiced_at')
            .is('invoice_number', null)
            .gte('amount', 0.1),
        supabase.from('supplier_invoices').select('booked_date'),
        supabase.from('issued_invoices').select('accrual_date'),
        supabase.from('fiscal_closings').select('year, quarter, presented_at').eq('model', 'F69'),
        supabase.from('supplier_invoices')
            .select('id, issuer_name, issuer_nif')
            .not('irpf_amount', 'is', null)
            .gt('irpf_amount', 0),
        supabase.from('issued_invoices')
            .select('id, invoice_number, client_name, accrual_date, issued_invoice_vat_lines(base_amount)')
            .is('client_nif', null)
            .order('accrual_date', { ascending: false }),
    ])

    // Fase 2: docs pendientes (depende de registeredDocs)
    const regDocIds = (registeredDocs ?? []).map(r => r.document_id).filter(id => id != null)
    let docsQuery = supabase
        .from('supplier_documents')
        .select('id, provider_id, concept, notes, uploaded_at, file_path, has_invoice')
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
    const allUnregistered = (allPendingDocs ?? []).filter(d => d.has_invoice !== false)
    const activeDocs    = allUnregistered.filter(d => !d.notes?.startsWith('*'))
    const dismissedDocs = allUnregistered.filter(d =>  d.notes?.startsWith('*'))

    // Obtener nombres de proveedores para todos los docs (incluyendo descartados)
    const docProvIds = [...new Set(allUnregistered.filter(d => d.provider_id).map(d => d.provider_id))]
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

    const provsConDiscrepancia = []
    const provsDismissed = []
    for (const p of (provsConFactura ?? [])) {
        const paid = paidMap[p.id] ?? 0
        const invoiced = invoiceMap[p.id] ?? 0
        const disc = paid - invoiced
        if (!(paid > 0.01 && disc > 0.01)) continue
        const m = p.comments?.match(/^\*(\d+(?:\.\d+)?) /)
        if (m && Math.abs(disc - parseFloat(m[1])) < 0.01) {
            provsDismissed.push({ ...p, _disc: disc })
        } else {
            provsConDiscrepancia.push({ ...p, _disc: disc })
        }
    }

    // Procesar alerta 4: charges sin facturar (excluir sfcom)
    const allUnbilled = (allChargesRaw ?? []).filter(c => !c.comments?.startsWith('WEB'))
    const chargesActivos     = allUnbilled.filter(c => c.invoiced_at !== '0001-01-01')
        .sort((a, b) => a.client_id.localeCompare(b.client_id) || (b.amount ?? 0) - (a.amount ?? 0))
    const chargesDescartados = allUnbilled.filter(c => c.invoiced_at === '0001-01-01')

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
            return y >= curYear - 1 && (y < curYear || (y === curYear && q < curQ))
        })
        .map(yq => { const [y, q] = yq.split('-').map(Number); return { year: y, q } })
        .sort((a, b) => a.year - b.year || a.q - b.q)

    // ===== RENDERIZAR =====
    const partes = []

    // Alerta 1: documentos sin anotar (split por presencia de archivo)
    if (activeDocs.length > 0 || dismissedDocs.length > 0) {
        const docsConArch = activeDocs.filter(d => !d.file_path?.endsWith('_sin_archivo'))
        const docsSinArch = activeDocs.filter(d =>  d.file_path?.endsWith('_sin_archivo'))

        const _filaDoc = (d, accionesCel) => {
            const prov   = d.provider_id ? (provNamesMap[d.provider_id] ?? d.provider_id) : 'Gasto general'
            const fecha  = d.uploaded_at.split('T')[0]
            const nombre = d.concept || d.notes?.replace(/^\*/, '').trim()
                || d.file_path.split('/').pop().replace(/^\d+_/, '')
            const provCell = d.provider_id
                ? `<td style="padding:4px 8px;cursor:pointer" onclick="location.href='proveedores.html?proveedor=${d.provider_id}'">${prov}</td>`
                : `<td style="padding:4px 8px">${prov}</td>`
            return `<tr style="font-size:12px">
                ${provCell}
                <td style="padding:4px 8px;color:var(--subtle)">${fecha}</td>
                <td style="padding:4px 8px">${nombre}</td>
                <td style="padding:4px 8px;white-space:nowrap">${accionesCel}</td>
            </tr>`
        }

        const _tabla = filas => `<table style="width:100%;border-collapse:collapse;margin-top:8px">
            <thead><tr style="font-size:11px;color:var(--subtle)">
                <th style="text-align:left;padding:4px 8px">Proveedor</th>
                <th style="text-align:left;padding:4px 8px">Fecha</th>
                <th style="text-align:left;padding:4px 8px">Concepto / archivo</th>
                <th style="padding:4px 8px"></th>
            </tr></thead>
            <tbody>${filas}</tbody>
        </table>`

        let bodyTabla = ''

        if (docsConArch.length > 0) {
            bodyTabla += _tabla(docsConArch.map(d => _filaDoc(d,
                `<button class="btn btn-primary" style="font-size:11px;padding:2px 6px;margin-right:4px"
                    onclick="anotarGasto(${d.id})">Anotar</button>
                 <button class="btn btn-secondary" style="font-size:11px;padding:2px 6px"
                    onclick="descartarAlerta('doc-${d.id}')">Descartar</button>`
            )).join(''))
        } else if (activeDocs.length === 0) {
            bodyTabla += `<p style="font-size:12px;color:var(--subtle);padding:8px 0 4px">Sin documentos pendientes.</p>`
        }

        if (docsSinArch.length > 0) {
            if (docsConArch.length > 0) bodyTabla += '<hr style="margin:12px 0;border:none;border-top:1px solid var(--border)">'
            bodyTabla += `<p style="font-size:12px;color:var(--subtle);margin:8px 0 4px">Sin archivo adjunto — añade el documento desde <a href="gastos.html" style="color:var(--accent)">Gastos</a> antes de anotar:</p>`
            bodyTabla += _tabla(docsSinArch.map(d => _filaDoc(d,
                `<button class="btn btn-secondary" style="font-size:11px;padding:2px 6px"
                    onclick="descartarAlerta('doc-${d.id}')">Descartar</button>`
            )).join(''))
        }

        const recuperarBtn1 = dismissedDocs.length > 0
            ? `<div style="margin-top:8px;text-align:right">
                 <button class="btn btn-secondary" style="font-size:11px"
                     onclick="recuperarDescartados('docs')">⟲ Recuperar descartados (${dismissedDocs.length})</button>
               </div>` : ''

        partes.push(_alerta(
            'docs-pendientes', 'warning',
            activeDocs.length > 0
                ? `${activeDocs.length} documento${activeDocs.length > 1 ? 's' : ''} sin registrar en el libro fiscal`
                : `Documentos sin registrar — todos descartados`,
            bodyTabla + recuperarBtn1
        ))
    }

    // Alerta 2: proveedores con pagos sin factura
    if (provsConDiscrepancia.length > 0 || provsDismissed.length > 0) {
        const filas = provsConDiscrepancia.map(p => `<tr style="font-size:12px">
            <td style="padding:4px 8px;font-weight:600;cursor:pointer" onclick="location.href='proveedores.html?proveedor=${p.id}'">${p.id}</td>
            <td style="padding:4px 8px;color:var(--subtle)">${p.name ?? ''}</td>
            <td style="padding:4px 8px;text-align:right">${fmt(paidMap[p.id] ?? 0)}</td>
            <td style="padding:4px 8px;text-align:right;color:var(--accent)">${fmt(invoiceMap[p.id] ?? 0)}</td>
            <td style="padding:4px 8px;text-align:right;font-weight:600">${fmt(p._disc)}</td>
            <td style="padding:4px 8px;white-space:nowrap">
                <button class="btn btn-secondary" style="font-size:11px;padding:2px 6px"
                    onclick="descartarAlerta('prov-${p.id}', ${p._disc})">Descartar</button>
            </td>
        </tr>`).join('')

        const bodyTabla2 = provsConDiscrepancia.length > 0
            ? `<table style="width:100%;border-collapse:collapse;margin-top:8px">
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
            : `<p style="font-size:12px;color:var(--subtle);padding:8px 0 4px">Sin proveedores pendientes.</p>`

        const recuperarBtn2 = provsDismissed.length > 0
            ? `<div style="margin-top:8px;text-align:right">
                 <button class="btn btn-secondary" style="font-size:11px"
                     onclick="recuperarDescartados('provs')">⟲ Recuperar descartados (${provsDismissed.length})</button>
               </div>` : ''

        partes.push(_alerta(
            'provs-sin-factura', 'error',
            provsConDiscrepancia.length > 0
                ? `${provsConDiscrepancia.length} proveedor${provsConDiscrepancia.length > 1 ? 'es' : ''} con pagos sin factura registrada`
                : `Proveedores con pagos — todos descartados`,
            bodyTabla2 + recuperarBtn2
        ))
    }

    // Alerta 3: emitidas sin PDF (sin dismiss — adjuntar el PDF es la única acción válida)
    if ((sinPdf ?? []).length > 0) {
        const filas = sinPdf.map(r => `<tr style="font-size:12px">
            <td style="padding:4px 8px;font-size:11px">${r.invoice_number}</td>
            <td style="padding:4px 8px">${r.client_name}</td>
            <td style="padding:4px 8px;color:var(--subtle)">${r.accrual_date}</td>
            <td style="padding:4px 8px;text-align:right">${fmt(r.total)}</td>
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
                </tr></thead>
                <tbody>${filas}</tbody>
            </table>`
        ))
    }

    // Alerta 4: charges sin facturar
    if (chargesActivos.length > 0 || chargesDescartados.length > 0) {
        const clientesActivos = new Set(chargesActivos.map(c => c.client_id)).size
        const filas = chargesActivos.map(c => `<tr style="font-size:12px">
            <td style="padding:4px 8px;font-weight:600;cursor:pointer" onclick="location.href='formulario.html?cliente=${c.client_id}'">${c.client_id}</td>
            <td style="padding:4px 8px;text-align:right">${fmt(c.amount)}</td>
            <td style="padding:4px 8px;color:var(--subtle);font-size:11px">${c.comments || '—'}</td>
            <td style="padding:4px 8px;white-space:nowrap">
                <button class="btn btn-secondary" style="font-size:11px;padding:2px 6px"
                    onclick="descartarAlerta('ch-${c.id}')">Descartar</button>
            </td>
        </tr>`).join('')

        const bodyTabla4 = chargesActivos.length > 0
            ? `<table style="width:100%;border-collapse:collapse;margin-top:8px">
                <thead><tr style="font-size:11px;color:var(--subtle)">
                    <th style="text-align:left;padding:4px 8px">Cliente</th>
                    <th style="text-align:right;padding:4px 8px">Importe</th>
                    <th style="text-align:left;padding:4px 8px">Concepto</th>
                    <th style="padding:4px 8px"></th>
                </tr></thead>
                <tbody>${filas}</tbody>
            </table>`
            : `<p style="font-size:12px;color:var(--subtle);padding:8px 0 4px">Sin cobros pendientes.</p>`

        const recuperarBtn4 = chargesDescartados.length > 0
            ? `<div style="margin-top:8px;text-align:right">
                 <button class="btn btn-secondary" style="font-size:11px"
                     onclick="recuperarDescartados('charges')">⟲ Recuperar descartados (${chargesDescartados.length})</button>
               </div>` : ''

        partes.push(_alerta(
            'charges-sin-factura', 'warning',
            chargesActivos.length > 0
                ? `${clientesActivos} cliente${clientesActivos > 1 ? 's' : ''} con cobros sin facturar`
                : `Cobros sin facturar — todos descartados`,
            bodyTabla4 + recuperarBtn4
        ))
    }

    // Alerta 5: trimestres pasados no presentados (sin dismiss — presentar es la única acción válida)
    if (trimestresAbiertos.length > 0) {
        const filas = trimestresAbiertos.map(({ year, q }) => `<tr style="font-size:12px">
            <td style="padding:4px 8px;font-weight:600">${year} T${q}</td>
            <td style="padding:4px 8px;color:var(--accent)">⏳ Pendiente de presentación</td>
            <td style="padding:4px 8px;white-space:nowrap">
                <button class="btn btn-primary" style="font-size:11px;padding:2px 6px"
                    onclick="irATrimestre(${year},${q})">Ir al trimestre</button>
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

    // Alerta 6: NIFs de emisor con retención inválidos (para el Modelo 190)
    const nifInvalidos = (invConRetencion ?? []).filter(r => !validarNif(r.issuer_nif).valido)
    if (nifInvalidos.length > 0) {
        const filas = nifInvalidos.map(r => `<tr style="font-size:12px">
            <td style="padding:4px 8px">${r.issuer_name ?? '—'}</td>
            <td style="padding:4px 8px;font-family:monospace;color:#92400e">${r.issuer_nif ?? '—'}</td>
        </tr>`).join('')
        partes.push(_alerta(
            'nif-invalidos-190', 'warning',
            `${nifInvalidos.length} NIF${nifInvalidos.length > 1 ? 's' : ''} de emisor con retención inválido${nifInvalidos.length > 1 ? 's' : ''} — pendiente${nifInvalidos.length > 1 ? 's' : ''} para el Modelo 190`,
            `<p style="font-size:12px;color:var(--subtle);margin:8px 0 6px">El Modelo 190 requiere NIF válido para cada perceptor de retención. Elimina la entrada del libro fiscal y vuelve a registrarla con el NIF correcto.</p>
            <table style="width:100%;border-collapse:collapse;margin-top:4px">
                <thead><tr style="font-size:11px;color:var(--subtle)">
                    <th style="text-align:left;padding:4px 8px">Emisor</th>
                    <th style="text-align:left;padding:4px 8px">NIF almacenado</th>
                </tr></thead>
                <tbody>${filas}</tbody>
            </table>`
        ))
    }

    // Alerta 7: emitidas sin NIF con base ≥400€
    const emitSinNifAlerta = (emitSinNif ?? []).filter(r => {
        const base = (r.issued_invoice_vat_lines ?? []).reduce((s, l) => s + (l.base_amount ?? 0), 0)
        return base >= 400
    })
    if (emitSinNifAlerta.length > 0) {
        const filas = emitSinNifAlerta.map(r => {
            const base = (r.issued_invoice_vat_lines ?? []).reduce((s, l) => s + (l.base_amount ?? 0), 0)
            return `<tr style="font-size:12px">
                <td style="padding:4px 8px;font-size:11px">${r.invoice_number ?? '—'}</td>
                <td style="padding:4px 8px">${r.client_name ?? '—'}</td>
                <td style="padding:4px 8px;color:var(--subtle)">${r.accrual_date}</td>
                <td style="padding:4px 8px;text-align:right">${fmt(base)}</td>
            </tr>`
        }).join('')
        partes.push(_alerta(
            'emitidas-sin-nif', 'warning',
            `${emitSinNifAlerta.length} factura${emitSinNifAlerta.length > 1 ? 's' : ''} con base ≥400€ sin NIF del cliente`,
            `<p style="font-size:12px;color:var(--subtle);margin:8px 0 6px">El receptor puede solicitar factura completa con NIF.</p>
            <table style="width:100%;border-collapse:collapse;margin-top:4px">
                <thead><tr style="font-size:11px;color:var(--subtle)">
                    <th style="text-align:left;padding:4px 8px">Nº factura</th>
                    <th style="text-align:left;padding:4px 8px">Cliente</th>
                    <th style="text-align:left;padding:4px 8px">Devengo</th>
                    <th style="text-align:right;padding:4px 8px">Base</th>
                </tr></thead>
                <tbody>${filas}</tbody>
            </table>`
        ))
    }

    el.innerHTML = partes.join('')
}

window.descartarAlerta = async function (key, extra) {
    if (key.startsWith('doc-')) {
        const id = parseInt(key.slice(4))
        const { data } = await supabase.from('supplier_documents').select('notes').eq('id', id).single()
        await supabase.from('supplier_documents').update({ notes: '*' + (data?.notes ?? '') }).eq('id', id)
    } else if (key.startsWith('prov-')) {
        const id = key.slice(5)
        const disc = extra
        const { data } = await supabase.from('providers').select('comments').eq('id', id).single()
        await supabase.from('providers').update({ comments: '*' + disc.toFixed(2) + ' ' + (data?.comments ?? '') }).eq('id', id)
    } else if (key.startsWith('ch-')) {
        const id = parseInt(key.slice(3))
        await supabase.from('charges').update({ invoiced_at: '0001-01-01' }).eq('id', id)
    }
    cargarAlertas()
}

window.recuperarDescartados = async function (tipo) {
    if (tipo === 'docs') {
        const { data } = await supabase.from('supplier_documents').select('id, notes').like('notes', '*%')
        if (data?.length) {
            await Promise.all(data.map(d =>
                supabase.from('supplier_documents').update({ notes: d.notes.slice(1) || null }).eq('id', d.id)
            ))
        }
    } else if (tipo === 'provs') {
        const { data } = await supabase.from('providers').select('id, comments').like('comments', '*%')
        const dismissed = (data ?? []).filter(p => /^\*\d+(?:\.\d+)? /.test(p.comments))
        if (dismissed.length) {
            await Promise.all(dismissed.map(p =>
                supabase.from('providers').update({ comments: p.comments.replace(/^\*\d+(?:\.\d+)? /, '') || null }).eq('id', p.id)
            ))
        }
    } else if (tipo === 'charges') {
        const { data } = await supabase.from('charges').select('id').eq('invoiced_at', '0001-01-01').is('invoice_number', null)
        if (data?.length) {
            await Promise.all(data.map(c =>
                supabase.from('charges').update({ invoiced_at: null }).eq('id', c.id)
            ))
        }
    }
    cargarAlertas()
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

    const invoices = _gastosData.filter(r => r.document_id != null)

    if (!invoices.length) {
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
            const irpf  = r.irpf_amount ?? 0
            const catLabel = r.provider_id ? r.provider_id : (r.category ?? '')
            return [r.issue_date, r.invoice_number ?? '', r.issuer_name ?? '', r.issuer_nif ?? '',
                    +fmtN(base), +fmtN(iva), +fmtN(irpf), +fmtN(r.total), catLabel, r.notes ?? '']
        })
        const ws = XLSX.utils.aoa_to_sheet([
            ['Fecha factura', 'Nº factura', 'Emisor', 'NIF', 'Base', 'IVA', 'IRPF', 'Total', 'Categoría / Proveedor', 'Notas'],
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

    // Hoja 190 — perceptores con retención del año completo
    const perceptores190 = _agrupar190(_gastosAnualesData)
    if (perceptores190.length > 0) {
        const CLAVE_LABEL = { profesional: 'G — Prof. 15%', arrendamiento: 'F — Arren. 19%' }
        const rows190 = perceptores190.map(p => [
            p.nif ?? '',
            p.nombre ?? '',
            CLAVE_LABEL[p.clave] ?? p.clave,
            +fmtN(p.sumBase),
            +fmtN(p.sumIrpf),
            p.nifValido ? '' : 'NIF INVÁLIDO',
        ])
        const hoy = new Date().toLocaleDateString('es-ES')
        const ws190 = XLSX.utils.aoa_to_sheet([
            [`Modelo 190 — ${year} (BORRADOR, datos hasta ${hoy})`],
            ['Datos reflejados en este archivo. Puede haber perceptores o bases adicionales no incluidos.'],
            [],
            ['NIF', 'Nombre', 'Clave', 'Base', 'Retención', 'Aviso'],
            ...rows190,
        ])
        XLSX.utils.book_append_sheet(wb, ws190, `190-${year} (borrador)`)
    }

    // Hoja F69 — resumen IVA devengado/soportado del trimestre
    {
        const devMap = new Map()
        for (const inv of _emitidasData) {
            for (const line of (inv.issued_invoice_vat_lines ?? [])) {
                const prev = devMap.get(line.vat_rate) ?? { base: 0, vat: 0 }
                devMap.set(line.vat_rate, { base: prev.base + (line.base_amount ?? 0), vat: prev.vat + (line.vat_amount ?? 0) })
            }
        }
        const sopMap = new Map()
        let sopCapBase = 0, sopCapIva = 0
        for (const inv of _gastosData) {
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
        const rowsF69 = [
            [`F69 — ${year} T${q} (BORRADOR)`],
            ['Datos reflejados en este archivo.'],
            [],
            ['IVA DEVENGADO (emitidas)'],
            ['Tipo IVA', 'Base', 'Cuota devengada'],
            ...[...devMap.entries()].sort((a, b) => a[0] - b[0]).map(([rate, d]) => [`${rate}%`, +fmtN(d.base), +fmtN(d.vat)]),
            ['TOTAL', +fmtN(totalDevBase), +fmtN(totalDevIva)],
            [],
            ['IVA SOPORTADO (recibidas)'],
            ['Tipo IVA', 'Base', 'Cuota bruta', 'Cuota deducible'],
            ...[...sopMap.entries()].sort((a, b) => a[0] - b[0]).map(([rate, s]) => [`${rate}%`, +fmtN(s.base), +fmtN(s.vatBruto), +fmtN(s.vatDed)]),
            ...(sopCapBase > 0 ? [['B. Inversión', +fmtN(sopCapBase), +fmtN(sopCapIva), +fmtN(sopCapIva)]] : []),
            ['TOTAL', '', '', +fmtN(totalSopDed)],
            [],
            ['RESULTADO', +fmtN(resultado), resultado > 0 ? 'A ingresar' : resultado < 0 ? 'A compensar' : 'Cuadrado'],
        ]
        const wsF69 = XLSX.utils.aoa_to_sheet(rowsF69)
        XLSX.utils.book_append_sheet(wb, wsF69, `F69-T${q} (borrador)`)
    }

    // Hoja M-715 — retenciones soportadas del trimestre (solo si hay)
    {
        const CLAVE_LABEL_XL = { profesional: 'G — Profesional (15%)', arrendamiento: 'F — Arrendamiento (19%)' }
        const retenidos715 = _gastosData.filter(inv => inv.retention_type && inv.retention_type !== 'ninguna')
        if (retenidos715.length > 0) {
            const grupos = {}
            for (const inv of retenidos715) {
                const key = inv.retention_type
                if (!grupos[key]) grupos[key] = { perceptores: new Set(), sumBase: 0, sumIrpf: 0 }
                const g = grupos[key]
                const { normalizado, valido } = validarNif(inv.issuer_nif)
                g.perceptores.add(valido ? normalizado : `__nombre__${inv.issuer_name}`)
                g.sumBase += (inv.supplier_invoice_vat_lines ?? []).reduce((s, l) => s + (l.base_amount ?? 0), 0)
                g.sumIrpf += inv.irpf_amount ?? 0
            }
            let totalPerc = 0, totalBase = 0, totalIrpf = 0
            const rows715 = [
                [`M-715 — ${year} T${q} (BORRADOR)`],
                ['Datos reflejados en este archivo.'],
                [],
                ['Clave', 'Perceptores', 'Base imponible', 'Retención ingresada'],
            ]
            for (const [key, label] of Object.entries(CLAVE_LABEL_XL)) {
                const g = grupos[key]
                if (!g) continue
                rows715.push([label, g.perceptores.size, +fmtN(g.sumBase), +fmtN(g.sumIrpf)])
                totalPerc += g.perceptores.size
                totalBase += g.sumBase
                totalIrpf += g.sumIrpf
            }
            rows715.push([`TOTAL T${q} ${year}`, totalPerc, +fmtN(totalBase), +fmtN(totalIrpf)])
            const ws715 = XLSX.utils.aoa_to_sheet(rows715)
            XLSX.utils.book_append_sheet(wb, ws715, `M715-T${q} (borrador)`)
        }
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
iniciarAnalisisFiscal()
