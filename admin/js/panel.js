import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, fmt, sortArr, renderThead } from './utils.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

// ===== DATOS =====
const hoy = new Date().toISOString().split('T')[0]

const [
    { data: reservas },
    { data: disponibilidad },
    { data: servicios },
    { data: proveedores },
    { data: payments },
    { data: charges },
    { data: solicitudesNuevas }
] = await Promise.all([
    supabase.from('reservations').select('*'),
    supabase.from('availability').select('*'),
    supabase.from('services').select('*').order('day'),
    supabase.from('providers').select('*').order('id'),
    supabase.from('payments').select('*').order('due_date'),
    supabase.from('charges').select('*').order('due_date'),
    supabase.from('reservation_requests').select('id, source').eq('status', 'nueva')
])

const diasDesdeHoy = d => d ? Math.ceil((new Date(d) - new Date(hoy)) / 86400000) : 999

// ===== BLOQUE 0: ALERTAS =====
function calcularAlertas() {
    const bloqueAlertas = document.getElementById('bloque-alertas')
    const listaSobre    = document.getElementById('lista-sobrereservas')
    let haySobrereserva = false
    listaSobre.innerHTML = ''

    disponibilidad.forEach(d => {
        const reservasPS     = reservas.filter(r =>
            r.provider_id === d.provider_id &&
            r.service_id  === d.service_id  &&
            r.status      !== 'Cancelada'
        )
        const totalReservado = reservasPS.reduce((s, r) => s + r.slots, 0)
        if (totalReservado > d.total_slots) {
            haySobrereserva = true
            const li = document.createElement('li')
            li.textContent = `${d.provider_id} / ${d.service_id}: ${totalReservado} reservadas, ${d.total_slots} disponibles`
            listaSobre.appendChild(li)
        }
    })

    document.getElementById('alerta-sobrereserva').style.display = haySobrereserva ? 'flex' : 'none'

    const pagosVencidos      = payments.filter(p => !p.paid && p.due_date && p.due_date < hoy)
    const totalPagosVencidos = pagosVencidos.reduce((s, p) => s + parseFloat(p.amount), 0)
    const alertaPagos        = document.getElementById('alerta-pagos-vencidos')
    if (pagosVencidos.length > 0) {
        alertaPagos.style.display = 'flex'
        document.getElementById('txt-pagos-vencidos').textContent =
            `${pagosVencidos.length} pago(s) a proveedores vencido(s) sin pagar — ${fmt(totalPagosVencidos)}`
    }

    // Cobros vencidos — ya no filtramos por estado de reserva, charges es por cliente directamente
    const cobrosVencidos      = charges.filter(c => !c.collected && c.due_date && c.due_date < hoy)
    const totalCobrosVencidos = cobrosVencidos.reduce((s, c) => s + parseFloat(c.amount), 0)
    const alertaCobros        = document.getElementById('alerta-cobros-vencidos')
    if (cobrosVencidos.length > 0) {
        alertaCobros.style.display = 'flex'
        document.getElementById('txt-cobros-vencidos').textContent =
            `${cobrosVencidos.length} cobro(s) a clientes vencido(s) sin cobrar — ${fmt(totalCobrosVencidos)}`
    }

    // Solicitudes pendientes desde la web
    // Separar solicitudes sfcom (source tipo WEBxxx_nnnn) de solicitudes web
    const solicitudesSfcom = (solicitudesNuevas ?? []).filter(s => s.source && /^WEB\d+_\d+$/.test(s.source))
    const solicitudesWeb   = (solicitudesNuevas ?? []).filter(s => !s.source || !/^WEB\d+_\d+$/.test(s.source))

    const alertaSfcom = document.getElementById('alerta-sfcom')
    if (solicitudesSfcom.length > 0) {
        alertaSfcom.style.display = 'flex'
        document.getElementById('txt-sfcom').textContent =
            `${solicitudesSfcom.length} reserva(s) nueva(s) recibida(s) desde sfcom sin registrar`
    }

    const alertaSolicitudes = document.getElementById('alerta-solicitudes')
    if (solicitudesWeb.length > 0) {
        alertaSolicitudes.style.display = 'flex'
        document.getElementById('txt-solicitudes').textContent =
            `${solicitudesWeb.length} solicitud(es) pendiente(s) de atender desde la web`
    }

    bloqueAlertas.style.display =
        (haySobrereserva || pagosVencidos.length > 0 || cobrosVencidos.length > 0
        || solicitudesSfcom.length > 0 || solicitudesWeb.length > 0) ? 'block' : 'none'
}

// ===== BLOQUE 1: CALENDARIO =====
let tabActiva = '7'
let sortPagosCol  = null, sortPagosDir  = 'asc'
let sortCobrosCol = null, sortCobrosDir = 'asc'
let pagosFiltradosCache  = []
let cobrosFiltradosCache = []

const PAGOS_COLS  = ['Proveedor', 'Concepto', 'Fecha', 'Importe', 'Estado']
const COBROS_COLS = ['Cliente',   'Concepto', 'Fecha', 'Importe', 'Estado']

function pagosSortKey(p, col) {
    if (col === 0) return p.provider_id
    if (col === 1) return p.comments ?? ''
    if (col === 2) return p.due_date ?? ''
    if (col === 3) return parseFloat(p.amount)
    if (col === 4) return (p.due_date ?? '') < hoy ? '0' : '1'
    return ''
}

function cobrosSortKey(c, col) {
    if (col === 0) return c.client_id
    if (col === 1) return c.comments ?? ''
    if (col === 2) return c.due_date ?? ''
    if (col === 3) return parseFloat(c.amount)
    if (col === 4) return (c.due_date ?? '') < hoy ? '0' : '1'
    return ''
}

function renderPagosProximos() {
    const tabla = document.getElementById('tbody-pagos-proximos').closest('table')
    renderThead(tabla.querySelector('thead'), PAGOS_COLS, sortPagosCol, sortPagosDir, col => {
        if (sortPagosCol === col) sortPagosDir = sortPagosDir === 'asc' ? 'desc' : 'asc'
        else { sortPagosCol = col; sortPagosDir = 'asc' }
        renderPagosProximos()
    })
    const ordenados = sortArr(pagosFiltradosCache, sortPagosCol, sortPagosDir, pagosSortKey)
    document.getElementById('tbody-pagos-proximos').innerHTML = ordenados.length === 0
        ? '<tr><td colspan="5" style="color:var(--subtle)">Sin pagos en este periodo</td></tr>'
        : ordenados.map(p => {
            const dias    = diasDesdeHoy(p.due_date)
            const vencido = dias < 0
            const clase   = vencido ? 'error' : dias <= 7 ? 'warn' : ''
            return `<tr style="cursor:pointer" onclick="location.href='proveedores.html?proveedor=${p.provider_id}'">
                <td>${p.provider_id}</td>
                <td>${p.comments ?? '—'}</td>
                <td class="${clase}">${p.due_date ?? '—'}${vencido ? ' ⚠️' : ''}</td>
                <td>${fmt(p.amount)}</td>
                <td class="${vencido ? 'error' : 'warn'}">Pendiente</td>
            </tr>`
        }).join('')
}

function renderCobrosProximos() {
    const tabla = document.getElementById('tbody-cobros-proximos').closest('table')
    renderThead(tabla.querySelector('thead'), COBROS_COLS, sortCobrosCol, sortCobrosDir, col => {
        if (sortCobrosCol === col) sortCobrosDir = sortCobrosDir === 'asc' ? 'desc' : 'asc'
        else { sortCobrosCol = col; sortCobrosDir = 'asc' }
        renderCobrosProximos()
    })
    const ordenados = sortArr(cobrosFiltradosCache, sortCobrosCol, sortCobrosDir, cobrosSortKey)
    document.getElementById('tbody-cobros-proximos').innerHTML = ordenados.length === 0
        ? '<tr><td colspan="5" style="color:var(--subtle)">Sin cobros en este periodo</td></tr>'
        : ordenados.map(c => {
            const dias    = diasDesdeHoy(c.due_date)
            const vencido = dias < 0
            const clase   = vencido ? 'error' : dias <= 7 ? 'warn' : ''
            return `<tr style="cursor:pointer" onclick="location.href='formulario.html?cliente=${c.client_id}'">
                <td>${c.client_id}</td>
                <td>${c.comments ?? '—'}</td>
                <td class="${clase}">${c.due_date ?? '—'}${vencido ? ' ⚠️' : ''}</td>
                <td>${fmt(c.amount)}</td>
                <td class="${vencido ? 'error' : 'warn'}">Pendiente</td>
            </tr>`
        }).join('')
}

function calcularCalendario() {
    const diasFiltro = tabActiva === '7' ? 7 : tabActiva === '30' ? 30 : 99999

    pagosFiltradosCache = payments.filter(p => {
        if (p.paid) return false
        const dias = diasDesdeHoy(p.due_date)
        return dias <= diasFiltro
    }).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))

    cobrosFiltradosCache = charges.filter(c => {
        if (c.collected) return false
        const dias = diasDesdeHoy(c.due_date)
        return dias <= diasFiltro
    }).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))

    sortPagosCol = null;  sortPagosDir  = 'asc'
    sortCobrosCol = null; sortCobrosDir = 'asc'

    renderPagosProximos()
    renderCobrosProximos()
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        tabActiva = btn.dataset.tab
        calcularCalendario()
    })
})

// ===== BLOQUE 1: ESTADO FINANCIERO =====
function calcularEstadoFinanciero() {
    // Cobros — ya no hay que filtrar por estado de reserva
    const cobrosTotal    = charges.reduce((s, c) => s + parseFloat(c.amount), 0)
    const cobrado        = charges.filter(c => c.collected).reduce((s, c) => s + parseFloat(c.amount), 0)
    const pendienteCobro = cobrosTotal - cobrado

    document.getElementById('kpi-cobros-confirmados').textContent = fmt(cobrosTotal)
    document.getElementById('kpi-cobrado').textContent            = fmt(cobrado)
    document.getElementById('kpi-pendiente-cobro').textContent    = fmt(pendienteCobro)

    const pagosTotal    = payments.reduce((s, p) => s + parseFloat(p.amount), 0)
    const pagado        = payments.filter(p => p.paid).reduce((s, p) => s + parseFloat(p.amount), 0)
    const pendientePago = pagosTotal - pagado

    document.getElementById('kpi-pagos-total').textContent    = fmt(pagosTotal)
    document.getElementById('kpi-pagado').textContent         = fmt(pagado)
    document.getElementById('kpi-pendiente-pago').textContent = fmt(pendientePago)

    const saldo    = pendienteCobro - pendientePago
    const kpiSaldo = document.getElementById('kpi-saldo-neto')
    kpiSaldo.textContent = fmt(saldo)
    kpiSaldo.className   = 'kpi-valor ' + (saldo >= 0 ? 'ok' : 'error')
}

function barraOcupacion(pct, colorFill) {
    return `<div class="ocupacion-bar">
        <div class="ocupacion-bar__track">
            <div class="ocupacion-bar__fill" style="width:${pct}%;background:${colorFill}"></div>
        </div>
        <span class="ocupacion-bar__pct">${pct}%</span>
    </div>`
}

// ===== BLOQUE 3: DISPONIBILIDAD POR EVENTO =====
let eventosFilas = []
let sortEventosCol = null, sortEventosDir = 'asc'
let _eventoFiltroActual = ''

const EVENTOS_COLS = ['Evento', 'Día', 'Total', 'Confirmadas', 'Pendientes', 'Libres', 'Ocupación', 'Clientes']

function eventosSortKey(f, col) {
    if (col === 0) return f.id
    if (col === 1) return f.dia ?? 99
    if (col === 2) return f.totalPlazas
    if (col === 3) return f.confirmadas
    if (col === 4) return f.pendientes
    if (col === 5) return f.libres
    if (col === 6) return f.pct
    if (col === 7) return f.clientes ?? ''
    return ''
}

function eventosDetSortKey(d, col) {
    if (col === 0) return d.id
    if (col === 1) return 99
    if (col === 2) return d.total
    if (col === 3) return d.confirmadas
    if (col === 4) return d.pendientes
    if (col === 5) return d.libres
    if (col === 6) return d.pct
    if (col === 7) return d.clientes ?? ''
    return ''
}

function filaEvento(f, destacada) {
    return `<tr style="${destacada ? 'background:var(--bg);font-weight:600' : ''}">
        <td>${f.id}</td>
        <td>${f.dia ?? '—'}</td>
        <td>${f.totalPlazas}</td>
        <td class="ok">${f.confirmadas}</td>
        <td class="warn">${f.pendientes}</td>
        <td>${f.libres}</td>
        <td>${barraOcupacion(f.pct, f.colorFill)}</td>
        <td style="font-size:11px;color:var(--subtle)">${f.clientes || '—'}</td>
    </tr>`
}

function filaDetalleProveedor(d) {
    return `<tr style="background:#fafafa">
        <td style="padding-left:24px;color:var(--subtle)">↳ ${d.id}</td>
        <td>—</td>
        <td>${d.total}</td>
        <td class="ok">${d.confirmadas}</td>
        <td class="warn">${d.pendientes}</td>
        <td>${d.libres}</td>
        <td>${barraOcupacion(d.pct, d.colorFill)}</td>
        <td style="font-size:11px;color:var(--subtle)">${d.clientes || '—'}</td>
    </tr>`
}

function renderEventos(filtro) {
    _eventoFiltroActual = filtro
    const thead = document.querySelector('#tabla-eventos thead')
    const tbody = document.getElementById('tbody-eventos')
    renderThead(thead, EVENTOS_COLS, sortEventosCol, sortEventosDir, col => {
        if (sortEventosCol === col) sortEventosDir = sortEventosDir === 'asc' ? 'desc' : 'asc'
        else { sortEventosCol = col; sortEventosDir = 'asc' }
        renderEventos(_eventoFiltroActual)
    })
    if (!filtro) {
        tbody.innerHTML = sortArr(eventosFilas, sortEventosCol, sortEventosDir, eventosSortKey)
            .map(f => filaEvento(f, false)).join('')
    } else {
        const f = eventosFilas.find(x => x.id === filtro)
        if (!f) return
        tbody.innerHTML = filaEvento(f, true) +
            sortArr(f.detalleProveedores, sortEventosCol, sortEventosDir, eventosDetSortKey)
                .map(d => filaDetalleProveedor(d)).join('')
    }
}

function calcularEventos() {
    const selector = document.getElementById('selector-evento')

    eventosFilas = servicios.map(s => {
        const dispS       = disponibilidad.filter(d => d.service_id === s.id)
        const totalPlazas = dispS.reduce((sum, d) => sum + (d.total_slots ?? 0), 0)
        if (totalPlazas === 0) return null

        const reservasS   = reservas.filter(r => r.service_id === s.id && r.status !== 'Cancelada')
        const confirmadas = reservasS.filter(r => r.status === 'Confirmada').reduce((sum, r) => sum + r.slots, 0)
        const pendientes  = reservasS.filter(r => r.status === 'Pendiente').reduce((sum, r) => sum + r.slots, 0)
        const libres      = totalPlazas - confirmadas - pendientes
        const pct         = totalPlazas > 0 ? Math.round((confirmadas + pendientes) / totalPlazas * 100) : 0
        const colorFill   = pct >= 90 ? 'var(--accent)' : pct >= 60 ? 'var(--accent-warn)' : 'var(--accent-ok)'

        const detalleProveedores = dispS.map(d => {
            const resP  = reservasS.filter(r => r.provider_id === d.provider_id)
            const confP = resP.filter(r => r.status === 'Confirmada').reduce((s, r) => s + r.slots, 0)
            const pendP = resP.filter(r => r.status === 'Pendiente').reduce((s, r) => s + r.slots, 0)
            const libP  = (d.total_slots ?? 0) - confP - pendP
            const pctP  = d.total_slots > 0 ? Math.round((confP + pendP) / d.total_slots * 100) : 0
            const colP  = pctP >= 90 ? 'var(--accent)' : pctP >= 60 ? 'var(--accent-warn)' : 'var(--accent-ok)'
            const clientesP = [...new Set(resP.map(r => r.client_id))].join(', ')
            return { id: d.provider_id, total: d.total_slots, confirmadas: confP, pendientes: pendP, libres: libP, pct: pctP, colorFill: colP, clientes: clientesP }
        })

        const clientesEvento = [...new Set(reservasS.map(r => r.client_id))].join(', ')
        return { id: s.id, dia: s.day, totalPlazas, confirmadas, pendientes, libres, pct, colorFill, detalleProveedores, clientes: clientesEvento }
    }).filter(Boolean)

    selector.innerHTML = '<option value="">— Todos los eventos —</option>' +
        eventosFilas.map(f => `<option value="${f.id}">${f.id}</option>`).join('')

    sortEventosCol = null; sortEventosDir = 'asc'
    renderEventos('')
    selector.addEventListener('change', () => {
        sortEventosCol = null; sortEventosDir = 'asc'
        renderEventos(selector.value)
    })
}

// ===== BLOQUE 4: DISPONIBILIDAD POR PROVEEDOR =====
let provFilas = []
let sortProvCol = null, sortProvDir = 'asc'
let _provFiltroActual = ''

const PROV_COLS = ['Proveedor', 'Capacidad', 'Confirmadas', 'Pendientes', 'Libres', 'Ocupación', 'Clientes']

function provSortKey(f, col) {
    if (col === 0) return f.id
    if (col === 1) return f.capacidad
    if (col === 2) return f.confirmadas
    if (col === 3) return f.pendientes
    if (col === 4) return f.libres
    if (col === 5) return f.pct
    if (col === 6) return f.clientes ?? ''
    return ''
}

function provDetSortKey(d, col) {
    if (col === 0) return d.id
    if (col === 1) return d.total
    if (col === 2) return d.confirmadas
    if (col === 3) return d.pendientes
    if (col === 4) return d.libres
    if (col === 5) return d.pct
    if (col === 6) return d.clientes ?? ''
    return ''
}

function filaProveedor(f, destacada) {
    return `<tr style="${destacada ? 'background:var(--bg);font-weight:600' : ''}">
        <td>${f.id}</td>
        <td>${f.capacidad}</td>
        <td class="ok">${f.confirmadas}</td>
        <td class="warn">${f.pendientes}</td>
        <td>${f.libres}</td>
        <td>${barraOcupacion(f.pct, f.colorFill)}</td>
        <td style="font-size:11px;color:var(--subtle)">${f.clientes || '—'}</td>
    </tr>`
}

function filaDetalleServicio(d) {
    return `<tr style="background:#fafafa">
        <td style="padding-left:24px;color:var(--subtle)">
            ↳ ${d.id}${d.esConsumption ? ' <span style="font-size:10px;color:var(--accent-warn)">(consumo)</span>' : ''}
        </td>
        <td>${d.total}</td>
        <td class="ok">${d.confirmadas}</td>
        <td class="warn">${d.pendientes}</td>
        <td>${d.libres}</td>
        <td>${barraOcupacion(d.pct, d.colorFill)}</td>
        <td style="font-size:11px;color:var(--subtle)">${d.clientes || '—'}</td>
    </tr>`
}

function renderProveedores(filtro) {
    _provFiltroActual = filtro
    const thead = document.querySelector('#tabla-proveedores thead')
    const tbody = document.getElementById('tbody-proveedores')
    renderThead(thead, PROV_COLS, sortProvCol, sortProvDir, col => {
        if (sortProvCol === col) sortProvDir = sortProvDir === 'asc' ? 'desc' : 'asc'
        else { sortProvCol = col; sortProvDir = 'asc' }
        renderProveedores(_provFiltroActual)
    })
    if (!filtro) {
        tbody.innerHTML = sortArr(provFilas, sortProvCol, sortProvDir, provSortKey)
            .map(f => filaProveedor(f, false)).join('')
    } else {
        const f = provFilas.find(x => x.id === filtro)
        if (!f) return
        tbody.innerHTML = filaProveedor(f, true) +
            sortArr(f.detalleServicios, sortProvCol, sortProvDir, provDetSortKey)
                .map(d => filaDetalleServicio(d)).join('')
    }
}

function calcularProveedores() {
    const selector = document.getElementById('selector-proveedor')

    provFilas = proveedores.map(p => {
        const dispP     = disponibilidad.filter(d => d.provider_id === p.id)
        const capacidad = dispP.reduce((sum, d) => sum + (d.total_slots ?? 0), 0)
        if (capacidad === 0) return null

        const reservasP   = reservas.filter(r => r.provider_id === p.id && r.status !== 'Cancelada')
        const confirmadas = reservasP.filter(r => r.status === 'Confirmada').reduce((sum, r) => sum + r.slots, 0)
        const pendientes  = reservasP.filter(r => r.status === 'Pendiente').reduce((sum, r) => sum + r.slots, 0)
        const libres      = capacidad - confirmadas - pendientes
        const pct         = capacidad > 0 ? Math.round((confirmadas + pendientes) / capacidad * 100) : 0
        const colorFill   = pct >= 90 ? 'var(--accent)' : pct >= 60 ? 'var(--accent-warn)' : 'var(--accent-ok)'

        const detalleServicios = dispP.map(d => {
            const resS  = reservasP.filter(r => r.service_id === d.service_id)
            const confS = resS.filter(r => r.status === 'Confirmada').reduce((s, r) => s + r.slots, 0)
            const pendS = resS.filter(r => r.status === 'Pendiente').reduce((s, r) => s + r.slots, 0)
            const libS  = (d.total_slots ?? 0) - confS - pendS
            const pctS  = d.total_slots > 0 ? Math.round((confS + pendS) / d.total_slots * 100) : 0
            const colS  = pctS >= 90 ? 'var(--accent)' : pctS >= 60 ? 'var(--accent-warn)' : 'var(--accent-ok)'
            const esConsumption = d.billing_model === 'consumption'
            const clientesS = [...new Set(resS.map(r => r.client_id))].join(', ')
            return { id: d.service_id, total: d.total_slots, confirmadas: confS, pendientes: pendS, libres: libS, pct: pctS, colorFill: colS, esConsumption, clientes: clientesS }
        })

        const clientesProv = [...new Set(reservasP.map(r => r.client_id))].join(', ')
        return { id: p.id, capacidad, confirmadas, pendientes, libres, pct, colorFill, detalleServicios, clientes: clientesProv }
    }).filter(Boolean)

    selector.innerHTML = '<option value="">— Todos los proveedores —</option>' +
        provFilas.map(f => `<option value="${f.id}">${f.id}</option>`).join('')

    sortProvCol = null; sortProvDir = 'asc'
    renderProveedores('')
    selector.addEventListener('change', () => {
        sortProvCol = null; sortProvDir = 'asc'
        renderProveedores(selector.value)
    })
}

// ===== BLOQUE 5: RESUMEN DE NEGOCIO =====
function calcularResumen() {
    const confirmadas   = reservas.filter(r => r.status === 'Confirmada')
    const pendientes    = reservas.filter(r => r.status === 'Pendiente')

    const plazasConf    = confirmadas.reduce((s, r) => s + r.slots, 0)
    const ingresos      = confirmadas.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
    const ingresosPend  = pendientes.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
    const costes        = payments.reduce((s, p) => s + parseFloat(p.amount), 0)
    const margen        = ingresos - costes
    const margenConPend = ingresos + ingresosPend - costes

    document.getElementById('kpi-res-confirmadas').textContent    = confirmadas.length
    document.getElementById('kpi-res-pendientes').textContent     = pendientes.length
    document.getElementById('kpi-plazas-confirmadas').textContent = plazasConf
    document.getElementById('kpi-ingresos-brutos').textContent    = fmt(ingresos)
    document.getElementById('kpi-costes').textContent             = fmt(costes)

    const kpiMargen = document.getElementById('kpi-margen')
    kpiMargen.textContent = fmt(margen)
    kpiMargen.className   = 'kpi-valor ' + (margen >= 0 ? 'ok' : 'error')

    const kpiMargenPend = document.getElementById('kpi-margen-pendientes')
    if (kpiMargenPend) {
        kpiMargenPend.textContent = pendientes.length > 0
            ? `+${fmt(ingresosPend)} si se confirman pendientes → ${fmt(margenConPend)}`
            : ''
        kpiMargenPend.style.color = 'var(--accent-warn)'
    }

    // ===== FILA POTENCIAL =====
    const precioMedioVenta = plazasConf > 0 ? ingresos / plazasConf : 0
    const margenPorPlaza   = plazasConf > 0 ? margen / plazasConf : 0

    // Plazas libres totales (sin canceladas)
    const plazasLibres = disponibilidad.reduce((s, d) => {
        const reservadas = reservas.filter(r =>
            r.provider_id === d.provider_id &&
            r.service_id  === d.service_id  &&
            r.status      !== 'Cancelada'
        ).reduce((s, r) => s + r.slots, 0)
        return s + Math.max(0, (d.total_slots ?? 0) - reservadas)
    }, 0)

    // Coste adicional: solo plazas libres en proveedores consumption
    const costeAdicional = disponibilidad
        .filter(d => d.billing_model === 'consumption')
        .reduce((s, d) => {
            const reservadas = reservas.filter(r =>
                r.provider_id === d.provider_id &&
                r.service_id  === d.service_id  &&
                r.status      !== 'Cancelada'
            ).reduce((s, r) => s + r.slots, 0)
            const libres = Math.max(0, (d.total_slots ?? 0) - reservadas)
            return s + libres * parseFloat(d.price_per_slot ?? 0)
        }, 0)

    const ingresoPotencial  = plazasLibres * precioMedioVenta
    const margenNoCapturado = ingresoPotencial - costeAdicional

    document.getElementById('kpi-plazas-libres').textContent       = plazasLibres
    document.getElementById('kpi-margen-plaza').textContent        = fmt(margenPorPlaza)
    document.getElementById('kpi-ingreso-potencial').textContent   = fmt(ingresoPotencial)
    document.getElementById('kpi-coste-adicional').textContent     = fmt(costeAdicional)
    document.getElementById('kpi-margen-no-capturado').textContent = fmt(margenNoCapturado)
    document.getElementById('kpi-margen-no-capturado').className   =
        'kpi-valor ' + (margenNoCapturado >= 0 ? 'ok' : 'error')
}

// ===== BLOQUE 2: CASHFLOW =====
function calcularCashflow() {
    const eventos = []

    payments.forEach(p => {
        const fecha = p.due_date
        if (!fecha) return
        eventos.push({ fecha, importe: -parseFloat(p.amount || 0), tipo: 'previsto' })
    })

    // Entradas previstas: charges por cliente (ya no hay join a reservations)
    charges.forEach(c => {
        const fecha = c.due_date
        if (!fecha) return
        eventos.push({ fecha, importe: parseFloat(c.amount || 0), tipo: 'previsto' })
    })

    payments.filter(p => p.paid).forEach(p => {
        const fecha = p.paid_date ?? p.due_date
        if (!fecha || fecha > hoy) return
        eventos.push({ fecha, importe: -parseFloat(p.amount || 0), tipo: 'real' })
    })

    charges.filter(c => c.collected).forEach(c => {
        const fecha = c.collected_date ?? c.due_date
        if (!fecha || fecha > hoy) return
        eventos.push({ fecha, importe: parseFloat(c.amount || 0), tipo: 'real' })
    })

    if (eventos.length === 0) {
        document.getElementById('bloque-cashflow').innerHTML = '<p style="color:var(--subtle)">Sin datos para mostrar</p>'
        return
    }

    const fechas = [...new Set(eventos.map(e => e.fecha))].sort()

    let acum = 0
    const dataPrevisto = fechas.map(f => {
        acum += eventos.filter(e => e.fecha === f && e.tipo === 'previsto').reduce((s, e) => s + e.importe, 0)
        return { x: new Date(f + 'T12:00:00'), y: Math.round(acum) }
    })

    let acumR = 0
    const dataReal = fechas
        .filter(f => f <= hoy)
        .map(f => {
            acumR += eventos.filter(e => e.fecha === f && e.tipo === 'real').reduce((s, e) => s + e.importe, 0)
            return { x: new Date(f + 'T12:00:00'), y: Math.round(acumR) }
        })

    new Chart(document.getElementById('grafico-cashflow'), {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Previsto acumulado',
                    data: dataPrevisto,
                    borderColor: '#e07000',
                    backgroundColor: 'rgba(224,112,0,0.08)',
                    fill: true, tension: 0.3, pointRadius: 4, pointHoverRadius: 6
                },
                {
                    label: 'Real acumulado',
                    data: dataReal,
                    borderColor: '#2a7a2a',
                    backgroundColor: 'rgba(42,122,42,0.08)',
                    fill: true, tension: 0.3, pointRadius: 4, pointHoverRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'week', displayFormats: { week: 'dd MMM' } },
                    min: new Date('2026-03-01T12:00:00'),
                    max: new Date('2026-08-01T12:00:00'),
                    grid: { display: false }
                },
                y: {
                    min: Math.min(...dataPrevisto.map(d => d.y), ...dataReal.map(d => d.y)) - 5000,
                    max: Math.max(...dataPrevisto.map(d => d.y), ...dataReal.map(d => d.y)) + 5000,
                    ticks: {
                        callback: v => v.toLocaleString('es-ES', {
                            style: 'currency', currency: 'EUR', maximumFractionDigits: 0
                        })
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } }
            }
        }
    })
}

// ===== INICIALIZAR TODO =====
calcularAlertas()
calcularCalendario()
calcularEstadoFinanciero()
calcularEventos()
calcularProveedores()
calcularResumen()
calcularCashflow()