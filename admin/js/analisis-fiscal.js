import { supabase } from './supabase.js'
import { getTemporadaActiva, fmt } from './utils.js'

// ─────────────────────────────────────────────────────────────
// TARIFA IRPF NAVARRA — base liquidable general
// Fuente: art. 59 TRLFIRPF, escala fijada por Ley Foral 22/2023
//   (efectos desde 1/1/2024, no modificada por LF 17/2025).
// Vigente en 2026. ⚠️ REVISAR CADA AÑO antes de la campaña.
// ─────────────────────────────────────────────────────────────
const TRAMOS_IRPF_NAVARRA = [
    { hasta:    4458, tipo: 0.13  },
    { hasta:   10030, tipo: 0.22  },
    { hasta:   21175, tipo: 0.25  },
    { hasta:   35663, tipo: 0.28  },
    { hasta:   51266, tipo: 0.365 },
    { hasta:   66869, tipo: 0.415 },
    { hasta:   89159, tipo: 0.44  },
    { hasta:  139310, tipo: 0.47  },
    { hasta:  195034, tipo: 0.49  },
    { hasta:  334344, tipo: 0.505 },
    { hasta: Infinity, tipo: 0.52 }
]

function irpfNavarra(base) {
    if (base <= 0) return 0
    let cuota = 0, ant = 0
    for (const { hasta, tipo } of TRAMOS_IRPF_NAVARRA) {
        if (base <= ant) break
        cuota += (Math.min(base, hasta) - ant) * tipo
        ant = hasta
    }
    return cuota
}

function tipoMarginal(base) {
    if (base <= 0) return 0
    for (const { hasta, tipo } of TRAMOS_IRPF_NAVARRA) {
        if (base <= hasta) return tipo
    }
    return TRAMOS_IRPF_NAVARRA[TRAMOS_IRPF_NAVARRA.length - 1].tipo
}

// ===== ESTADO =====
let _datos     = null
let _bruto     = 60000
let _simpl     = false
let _tableData = []
let _sortCol   = 'margen'
let _sortDir   = 'asc'

// ===== ENTRADA =====
export async function iniciarAnalisisFiscal() {
    const el = document.getElementById('bloque-analisis-fiscal')
    if (!el) return
    el.innerHTML = `<p style="color:var(--subtle);font-size:13px;padding:16px 0">Cargando análisis…</p>`
    await _cargar()
}

// ===== CARGA =====
async function _cargar() {
    const temporada = getTemporadaActiva()
    const el        = document.getElementById('bloque-analisis-fiscal')

    const { data: servicios } = await supabase
        .from('services').select('id, event_type').eq('season', temporada)

    if (!servicios?.length) {
        el.innerHTML = `<p style="color:var(--subtle);font-size:13px;padding:16px 0">Sin servicios en la temporada ${temporada}.</p>`
        return
    }

    const serviceIds = servicios.map(s => s.id)
    const svcMap     = new Map(servicios.map(s => [s.id, s.event_type]))

    const [
        { data: reservas       },
        { data: disponibilidad },
        { data: venues         },
        { data: issuedInvs     },
        { data: supplierInvs   },
        { data: gastosGrales   },
        { count: totalDocConFactura },
    ] = await Promise.all([
        supabase.from('reservations')
            .select('venue_id, service_id, slots, total_amount, status')
            .in('service_id', serviceIds),
        supabase.from('availability')
            .select('venue_id, service_id, total_slots, price_per_slot, billing_model')
            .in('service_id', serviceIds),
        supabase.from('venues').select('id, provider_id'),
        supabase.from('issued_invoices')
            .select('issued_invoice_vat_lines(base_amount)')
            .eq('season', temporada).eq('is_void', false),
        supabase.from('supplier_invoices')
            .select('provider_id, total, deductible_pct').eq('season', temporada),
        supabase.from('supplier_documents')
            .select('amount')
            .is('provider_id', null).eq('season', temporada),
        supabase.from('supplier_documents')
            .select('*', { count: 'exact', head: true })
            .eq('season', temporada)
            .eq('has_invoice', true)
            .not('file_path', 'ilike', '%_sin_archivo'),
    ])

    // Ingresos
    const confirmadas         = (reservas ?? []).filter(r => r.status === 'Confirmada')
    const ingresos_reales     = confirmadas.reduce((s, r) => s + (r.total_amount ?? 0), 0)
    const ingresos_declarados = (issuedInvs ?? []).reduce((s, inv) =>
        s + (inv.issued_invoice_vat_lines ?? []).reduce((ss, l) => ss + (l.base_amount ?? 0), 0), 0)

    const venueAProv = new Map((venues ?? []).map(v => [v.id, v.provider_id]))

    // Plazas vendidas por (venue_id|service_id)
    const plazasVend = new Map()
    for (const r of confirmadas) {
        const k = `${r.venue_id}|${r.service_id}`
        plazasVend.set(k, (plazasVend.get(k) ?? 0) + r.slots)
    }

    // Deducible fiscal por proveedor: directo desde supplier_invoices (tablas fiscales)
    const fiscalDeducProv = new Map()
    for (const i of (supplierInvs ?? []).filter(i => i.provider_id !== null)) {
        const p = i.provider_id
        fiscalDeducProv.set(p, (fiscalDeducProv.get(p) ?? 0) + (i.total ?? 0) * ((i.deductible_pct ?? 100) / 100))
    }

    // Primera pasada: cr por línea y suma de cr por proveedor
    const crPerLinea = new Map()
    const crSumProv  = new Map()
    for (const av of (disponibilidad ?? [])) {
        const avKey = `${av.venue_id}|${av.service_id}`
        let cr = 0
        if      (av.billing_model === 'capacity')    cr = (av.total_slots ?? 0) * (av.price_per_slot ?? 0)
        else if (av.billing_model === 'consumption') cr = (plazasVend.get(avKey) ?? 0) * (av.price_per_slot ?? 0)
        else if (av.billing_model === 'fixed')       cr = (plazasVend.get(avKey) ?? 0) > 0 ? (av.price_per_slot ?? 0) : 0
        crPerLinea.set(avKey, cr)
        const provId = venueAProv.get(av.venue_id)
        if (provId) crSumProv.set(provId, (crSumProv.get(provId) ?? 0) + cr)
    }

    // Segunda pasada: cd proporcional, anclado al total fiscal del proveedor
    const costeLinea = new Map()
    let coste_real_total = 0, coste_deducible_total = 0
    for (const av of (disponibilidad ?? [])) {
        const avKey  = `${av.venue_id}|${av.service_id}`
        const cr     = crPerLinea.get(avKey) ?? 0
        const provId = venueAProv.get(av.venue_id)
        let cd = 0
        if (provId) {
            const realCostP = crSumProv.get(provId) ?? 0
            const ratio = realCostP > 0.01 ? Math.min((fiscalDeducProv.get(provId) ?? 0) / realCostP, 1) : 0
            cd = cr * ratio
        }
        costeLinea.set(avKey, { cr, cd })
        coste_real_total      += cr
        coste_deducible_total += cd
    }

    // Gastos generales reales: de supplier_documents (bandeja operativa)
    // Gastos generales deducibles: de supplier_invoices registradas en el libro fiscal
    const gastos_grales_reales     = (gastosGrales ?? []).reduce((s, d) => s + (d.amount ?? 0), 0)
    const gastos_grales_deducibles = (supplierInvs ?? [])
        .filter(i => i.provider_id === null)
        .reduce((s, i) => s + (i.total ?? 0) * ((i.deductible_pct ?? 100) / 100), 0)

    // Beneficios
    const beneficio_real   = ingresos_reales     - coste_real_total      - gastos_grales_reales
    const beneficio_fiscal = ingresos_declarados - coste_deducible_total - gastos_grales_deducibles

    // Líneas por (venue_id × event_type): primero desde availability, luego acumulamos reservas
    const lineasMap = new Map()

    for (const av of (disponibilidad ?? [])) {
        const evType = svcMap.get(av.service_id)
        if (!evType) continue
        const lk = `${av.venue_id}|${evType}`
        if (!lineasMap.has(lk)) lineasMap.set(lk, { venue_id: av.venue_id, event_type: evType, plazas: 0, ingreso: 0, cr: 0, cd: 0 })
        const { cr, cd } = costeLinea.get(`${av.venue_id}|${av.service_id}`) ?? { cr: 0, cd: 0 }
        const l = lineasMap.get(lk)
        l.cr += cr
        l.cd += cd
    }

    for (const r of confirmadas) {
        const evType = svcMap.get(r.service_id)
        if (!evType) continue
        const lk = `${r.venue_id}|${evType}`
        if (!lineasMap.has(lk)) lineasMap.set(lk, { venue_id: r.venue_id, event_type: evType, plazas: 0, ingreso: 0, cr: 0, cd: 0 })
        const l = lineasMap.get(lk)
        l.plazas  += r.slots
        l.ingreso += r.total_amount ?? 0
    }

    const tieneAlertas = (totalDocConFactura ?? 0) > (supplierInvs ?? []).length

    _datos = {
        temporada,
        tieneAlertas,
        ingresos_reales, ingresos_declarados,
        coste_real_total, coste_deducible_total,
        gastos_grales_reales, gastos_grales_deducibles,
        beneficio_real, beneficio_fiscal,
        lineas: [...lineasMap.values()],
    }

    _tableData = []
    _renderControles()
    _recalcular()
}

// ===== CONTROLES (se renderizan una vez; los recálculos solo actualizan af-total y af-tabla) =====
function _renderControles() {
    const el = document.getElementById('bloque-analisis-fiscal')
    const alertaExtra = _datos.tieneAlertas
        ? ' Los importes deducibles pueden variar: hay documentos pendientes de registrar en el libro contable.'
        : ''
    el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
            <h2 style="margin:0">📊 Análisis post-impuestos ${_datos.temporada}</h2>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <select id="af-tipo" style="width:auto;font-size:12px">
                    <option value="normal">Directa normal</option>
                    <option value="simpl">Simplificada (−5%)</option>
                </select>
                <label style="font-size:12px;color:var(--subtle);white-space:nowrap">Otros rendimientos
                    <input id="af-bruto" type="text" value="${_bruto.toLocaleString('es-ES')}"
                        style="width:74px;font-size:12px;text-align:right;margin-left:4px">
                </label>
            </div>
        </div>
        <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:10px 14px;font-size:12px;color:#92400e;margin-bottom:16px">
            ⚠️ Estimación orientativa. No incluye deducciones personales, mínimos ni otras rentas. El IRPF real lo determina la declaración anual.${alertaExtra}
        </div>
        <div id="af-total" style="margin-bottom:24px"></div>
        <div id="af-tabla"></div>
    `

    const inputBruto = el.querySelector('#af-bruto')
    const selTipo    = el.querySelector('#af-tipo')
    inputBruto.addEventListener('focus', () => { inputBruto.value = String(_bruto) })
    inputBruto.addEventListener('blur', () => {
        _bruto = Math.abs(parseInt(inputBruto.value.replace(/[^0-9]/g, ''), 10) || 0)
        inputBruto.value = _bruto.toLocaleString('es-ES')
        _recalcular()
    })
    inputBruto.addEventListener('keydown', e => { if (e.key === 'Enter') inputBruto.blur() })
    selTipo.addEventListener('change', () => { _simpl = selTipo.value === 'simpl'; _recalcular() })
}

// ===== RECÁLCULO =====
function _recalcular() {
    if (!_datos) return
    const { beneficio_fiscal, beneficio_real, lineas,
            ingresos_reales, ingresos_declarados,
            coste_real_total, coste_deducible_total,
            gastos_grales_reales, gastos_grales_deducibles } = _datos

    const ajuste   = _simpl ? Math.min(beneficio_fiscal * 0.05, 3000) : 0
    const bf_ajust = beneficio_fiscal - ajuste
    const irpf_sin = irpfNavarra(_bruto)
    const delta    = Math.max(irpfNavarra(_bruto + Math.max(bf_ajust, 0)) - irpf_sin, 0)
    const irpf_con = irpf_sin + delta

    _renderTotal({
        ingresos_reales, ingresos_declarados,
        coste_real_total, coste_deducible_total,
        gastos_grales_reales, gastos_grales_deducibles,
        beneficio_real, beneficio_fiscal, ajuste, bf_ajust,
        delta, aporte_real: beneficio_real - delta,
        irpf_sin, irpf_con,
    })
    _renderTabla(lineas, delta, ingresos_reales)
}

// ===== RENDER BLOQUE TOTAL =====
function _renderTotal({ ingresos_reales, ingresos_declarados,
                        coste_real_total, coste_deducible_total,
                        gastos_grales_reales, gastos_grales_deducibles,
                        beneficio_real, beneficio_fiscal, ajuste, bf_ajust,
                        delta, aporte_real, irpf_sin, irpf_con }) {
    const el = document.getElementById('af-total')
    if (!el) return

    const coste_no_ded   = coste_real_total - coste_deducible_total
    const ing_no_decl    = ingresos_reales  - ingresos_declarados
    const gg_no_ded      = gastos_grales_reales - gastos_grales_deducibles

    const margen_pct     = ingresos_reales > 0.01 ? Math.round(beneficio_real / ingresos_reales * 100) : 0
    const resultado_pct  = ingresos_reales > 0.01 ? Math.round(aporte_real    / ingresos_reales * 100) : 0
    const irpf_equiv_pct = beneficio_real  > 0.01 ? Math.round(delta          / beneficio_real  * 100) : 0
    const tipo_sf_pct    = bf_ajust        > 0.01 ? Math.round(delta          / bf_ajust        * 100) : 0
    const tipo_otros_pct = _bruto          > 0.01 ? Math.round(irpf_sin       / _bruto          * 100) : 0
    const tipo_marg_max  = tipoMarginal(_bruto + Math.max(bf_ajust, 0))
    const fmtTipo        = t => { const v = Math.round(t * 1000) / 10; return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + '%' }

    // Escenario hipotético: todo declarado y con factura
    const ajuste_hyp    = _simpl ? Math.min(beneficio_real * 0.05, 3000) : 0
    const bf_ajust_hyp  = beneficio_real - ajuste_hyp
    const delta_hyp     = Math.max(irpfNavarra(_bruto + Math.max(bf_ajust_hyp, 0)) - irpf_sin, 0)
    const resultado_hyp  = beneficio_real - delta_hyp
    const irpf_equiv_hyp = beneficio_real > 0.01 ? Math.round(delta_hyp / beneficio_real * 100) : 0

    // ── Helpers ──
    const MROW = (label, value, color) => `
        <div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0">
            <span style="font-size:13px;font-weight:600">${label}</span>
            <span style="font-size:15px;font-weight:700${color ? ';color:' + color : ''}">${value}</span>
        </div>`

    const DROW = (label, value, color) => `
        <div style="display:flex;justify-content:space-between;align-items:baseline;padding:2px 0">
            <span style="font-size:12px;color:var(--subtle)">${label}</span>
            <span style="font-size:12px;white-space:nowrap${color ? ';color:' + color : ';color:var(--subtle)'}">${value}</span>
        </div>`

    const DET = (summary, content) => `
        <details style="margin:2px 0 4px">
            <summary style="cursor:pointer;list-style:none;font-size:12px;color:var(--subtle);padding:2px 0;user-select:none">▸ ${summary}</summary>
            <div style="padding:6px 0 4px 12px;border-left:2px solid var(--border);margin:4px 0 0 4px">
                ${content}
            </div>
        </details>`

    const SEP  = `<div style="border-top:1px solid var(--border);margin:8px 0"></div>`
    const DSEP = `<div style="border-top:2px solid var(--border);margin:14px 0 12px;opacity:0.4"></div>`

    // ── 4 cajas métricas ──
    const BOX = (label, value, sub, color) => `
        <div style="border:1px solid var(--border);border-radius:8px;padding:14px 12px;text-align:center">
            <div style="font-size:11px;color:var(--subtle);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">${label}</div>
            <div style="font-size:20px;font-weight:700${color ? ';color:' + color : ''}">${value}</div>
            ${sub ? `<div style="font-size:11px;color:var(--subtle);margin-top:4px">${sub}</div>` : ''}
        </div>`

    const cajasHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;flex:0 0 185px;min-width:160px">
            ${BOX('Margen del negocio', fmt(beneficio_real), margen_pct + '% sobre ingresos', beneficio_real < -0.01 ? 'var(--accent)' : '')}
            ${BOX('IRPF de San Fermín', fmt(delta), null, 'var(--accent)')}
            ${BOX('Resultado neto real', fmt(aporte_real), resultado_pct + '% sobre ingresos', aporte_real < -0.01 ? 'var(--accent)' : 'var(--accent-ok)')}
            ${BOX('IRPF equivalente', irpf_equiv_pct + '%', 'del margen real', null)}
        </div>`

    // ── Tabla explicativa ──
    const desgloseMargen = `
        ${DROW('Ingresos del negocio (base, sin IVA)', fmt(ingresos_reales))}
        ${DROW('− Costes operativos (proveedores + grales.)', '−' + fmt(coste_real_total + gastos_grales_reales), 'var(--accent)')}
    `

    const sinFacturaLines = [
        ing_no_decl                    > 0.01 ? DROW('Ingresos sin declarar (sin factura)',    fmt(ing_no_decl))                      : '',
        (coste_no_ded + gg_no_ded)     > 0.01 ? DROW('− Gastos no deducibles (sin factura)', '−' + fmt(coste_no_ded + gg_no_ded)) : '',
    ].join('')

    const desgloseHacienda = `
        ${DROW('Ingresos declarados (con factura)', fmt(ingresos_declarados))}
        ${DROW('− Gastos deducibles (con factura)', '−' + fmt(coste_deducible_total + gastos_grales_deducibles))}
        ${sinFacturaLines ? '<div style="border-top:1px solid var(--border);margin:4px 0;opacity:0.4"></div>' + sinFacturaLines : ''}
        ${ajuste > 0.01 ? DROW('− Ajuste simplificada (5%)', '−' + fmt(ajuste)) : ''}
    `

    const calcIrpf = `
        ${DROW('IRPF sobre otros rendimientos (' + fmt(_bruto) + ')', fmt(irpf_sin))}
        ${DROW('IRPF total (' + fmt(_bruto + bf_ajust) + ' = ' + fmt(_bruto) + ' + ' + fmt(bf_ajust) + ')', fmt(irpf_con))}
        ${DROW('Diferencia (atribuible a San Fermín)', fmt(delta))}
    `

    const tablaHTML = `
        <div style="flex:1;min-width:300px;padding-left:24px;border-left:1px solid var(--border)">
            ${MROW('Margen real del negocio', fmt(beneficio_real), beneficio_real < -0.01 ? 'var(--accent)' : null)}
            ${DET('desglose', desgloseMargen)}
            ${SEP}
            ${MROW('Margen que computa Hacienda', fmt(bf_ajust), null)}
            ${DET('desglose', desgloseHacienda)}
            ${SEP}
            ${MROW('IRPF atribuible a San Fermín', fmt(delta), 'var(--accent)')}
            ${DET('cálculo', calcIrpf)}
            <div style="font-size:13px;padding:3px 0 4px">
                Tipo medio ponderado: ${tipo_sf_pct}% (tramos del ${tipo_otros_pct}% al ${fmtTipo(tipo_marg_max)})
            </div>
            ${DSEP}
            ${MROW('Resultado neto real  (margen real − IRPF)', fmt(aporte_real), aporte_real < -0.01 ? 'var(--accent)' : 'var(--accent-ok)')}
            ${DROW('IRPF equivalente sobre el margen real', irpf_equiv_pct + '%')}
        </div>`

    // ── Escenario hipotético ──
    const hipoteticoHTML = `
        <div style="margin-top:20px;padding:10px 14px;border:1px solid var(--border);border-radius:6px">
            <div style="font-size:11px;color:var(--subtle);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;font-weight:600">Escenario con todo facturado y declarado</div>
            ${DROW('Margen del negocio', '~' + fmt(beneficio_real))}
            ${DROW('IRPF estimado', '~' + fmt(delta_hyp))}
            ${DROW('Resultado neto', '~' + fmt(resultado_hyp))}
            ${DROW('IRPF equivalente', '~' + irpf_equiv_hyp + '%')}
        </div>`

    el.innerHTML = `
        <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
            ${cajasHTML}
            ${tablaHTML}
        </div>
        ${hipoteticoHTML}
    `
}

// ===== RENDER TABLA POR SERVICIO =====
const COLS = [
    { key: 'venue_id',   label: 'Venue',       align: '' },
    { key: 'event_type', label: 'Evento',       align: '' },
    { key: 'plazas',     label: 'Plazas',       align: 'right' },
    { key: 'ingreso',    label: 'Ingreso',      align: 'right' },
    { key: 'cr',         label: 'Coste real',   align: 'right' },
    { key: 'cd',         label: 'Deducible',    align: 'right' },
    { key: 'gp',         label: 'G. grales',    align: 'right' },
    { key: 'margen',     label: 'Margen',       align: 'right' },
    { key: 'neto',       label: 'Neto (−IRPF)', align: 'right' },
]

function _renderTabla(lineas, deltaIrpf, ingresos_reales) {
    const filas = lineas.filter(l => l.ingreso > 0.01 || l.cr > 0.01).map(l => {
        const gp     = ingresos_reales > 0.01 ? _datos.gastos_grales_reales * l.ingreso / ingresos_reales : 0
        const margen = l.ingreso - l.cr - gp
        const irpfP  = ingresos_reales > 0.01 ? deltaIrpf * l.ingreso / ingresos_reales : 0
        const neto   = margen - irpfP
        return { ...l, gp, margen, neto }
    })

    if (_tableData.length !== filas.length) {
        // Primera carga o cambio de temporada: orden inicial por margen ascendente (rojos arriba),
        // sin columna "activa" — el primer clic en cualquier cabecero siempre arranca ascendente
        _tableData = [...filas].sort((a, b) => a.margen - b.margen)
        _sortCol   = null
        _sortDir   = 'asc'
    } else {
        // Recálculo (bruto o simplificada cambiaron): actualizar valores preservando el orden actual
        const order  = _tableData.map(r => `${r.venue_id}|${r.event_type}`)
        const lookup = new Map(filas.map(r => [`${r.venue_id}|${r.event_type}`, r]))
        _tableData   = order.map(k => lookup.get(k)).filter(Boolean)
    }

    _renderTablaDOM()
}

function _renderTablaDOM() {
    const el = document.getElementById('af-tabla')
    if (!el) return

    const arr = col => _sortCol === col
        ? ` <span style="font-size:10px">${_sortDir === 'asc' ? '↑' : '↓'}</span>`
        : ` <span style="font-size:10px;opacity:0.4">↕</span>`

    const thead = COLS.map(c => {
        const al = c.align === 'right' ? 'text-align:right;' : ''
        return `<th style="cursor:pointer;user-select:none;${al}" data-col="${c.key}">${c.label}${arr(c.key)}</th>`
    }).join('')

    const ROW = r => {
        const mC = r.margen < -0.01 ? 'var(--accent)' : r.margen > 0.01 ? '' : 'var(--text)'
        const nC = r.neto   < -0.01 ? 'var(--accent)' : r.neto   > 0.01 ? 'var(--accent-ok)' : 'var(--text)'
        return `<tr>
            <td style="white-space:nowrap;font-size:12px">${r.venue_id}</td>
            <td style="font-size:12px">${r.event_type}</td>
            <td style="text-align:right;font-size:12px">${r.plazas}</td>
            <td style="text-align:right">${fmt(r.ingreso)}</td>
            <td style="text-align:right;color:var(--accent)">${fmt(r.cr)}</td>
            <td style="text-align:right;font-size:11px;color:var(--subtle)">${fmt(r.cd)}</td>
            <td style="text-align:right;font-size:11px;color:var(--subtle)">${fmt(r.gp)}</td>
            <td style="text-align:right;font-weight:600;color:${mC}">${fmt(r.margen)}</td>
            <td style="text-align:right;font-weight:600;color:${nC}">${fmt(r.neto)}</td>
        </tr>`
    }

    // Si el sort activo es venue o event_type, agrupar con fila de subtotal encima de cada grupo
    const groupCol = (_sortCol === 'venue_id' || _sortCol === 'event_type') ? _sortCol : null

    let tbody
    if (!groupCol) {
        tbody = _tableData.map(ROW).join('')
    } else {
        const groups = []
        let cur = null
        for (const r of _tableData) {
            const key = r[groupCol]
            if (!cur || cur.key !== key) { cur = { key, rows: [] }; groups.push(cur) }
            cur.rows.push(r)
        }
        tbody = groups.map(g => {
            const s = g.rows.reduce((a, r) => ({
                plazas:  a.plazas  + r.plazas,
                ingreso: a.ingreso + r.ingreso,
                cr:      a.cr      + r.cr,
                cd:      a.cd      + r.cd,
                gp:      a.gp      + r.gp,
                margen:  a.margen  + r.margen,
                neto:    a.neto    + r.neto,
            }), { plazas: 0, ingreso: 0, cr: 0, cd: 0, gp: 0, margen: 0, neto: 0 })
            const mC = s.margen < -0.01 ? 'var(--accent)' : s.margen > 0.01 ? '' : 'var(--text)'
            const nC = s.neto   < -0.01 ? 'var(--accent)' : s.neto   > 0.01 ? 'var(--accent-ok)' : 'var(--text)'
            const hdr = `<tr style="background:var(--border);font-size:12px;font-weight:700">
                <td colspan="2" style="padding:5px 8px">${g.key}</td>
                <td style="text-align:right">${s.plazas}</td>
                <td style="text-align:right">${fmt(s.ingreso)}</td>
                <td style="text-align:right;color:var(--accent)">${fmt(s.cr)}</td>
                <td style="text-align:right;font-size:11px">${fmt(s.cd)}</td>
                <td style="text-align:right;font-size:11px">${fmt(s.gp)}</td>
                <td style="text-align:right;color:${mC}">${fmt(s.margen)}</td>
                <td style="text-align:right;color:${nC}">${fmt(s.neto)}</td>
            </tr>`
            return hdr + g.rows.map(ROW).join('')
        }).join('')
    }

    el.innerHTML = `<div class="table-wrapper">
        <table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
    </div>`

    // Sort estable sucesivo: cada clic ordena sobre el array ya ordenado; los empates conservan el orden previo
    el.querySelectorAll('th[data-col]').forEach(th =>
        th.addEventListener('click', () => {
            const col = th.dataset.col
            if (_sortCol === col) _sortDir = _sortDir === 'asc' ? 'desc' : 'asc'
            else { _sortCol = col; _sortDir = 'asc' }
            const f = _sortDir === 'asc' ? 1 : -1
            _tableData.sort((a, b) => {
                const va = a[col], vb = b[col]
                return (typeof va === 'number'
                    ? (va - vb)
                    : String(va ?? '').localeCompare(String(vb ?? ''), 'es', { numeric: true })
                ) * f
            })
            _renderTablaDOM()
        })
    )
}
