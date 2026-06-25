import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, fmt, sortArr, renderThead, renderClientChips, exportTable, persistirCobrosCliente, persistirPagosProveedor } from './utils.js'
import { mostrarToast, verificarConsistenciaFinanciera, ejecutarVerificacionGlobal } from './verificacion.js'
import { checkSfcomOrders, importarCanceladosSfcom, loadSfcomListings } from './sfcom.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

// ===== DATOS =====

// Importar cancelados sfcom antes de cargar datos para que las alertas estén actualizadas
{
    const _sfcomResult = await checkSfcomOrders(supabase).catch(() => ({ ok: false }))
    if (_sfcomResult.ok && _sfcomResult.cancelados?.length) {
        const _sfcomListings = await loadSfcomListings(supabase)
        await importarCanceladosSfcom(supabase, _sfcomListings, _sfcomResult.cancelados)
    }
}

const hoy = new Date().toISOString().split('T')[0]

// Temporada = el año de julio al que pertenece esta campaña.
// Antes del 15 de agosto → temporada del año en curso. Después → ya empieza la siguiente.
const _anioHoy       = parseInt(hoy.substring(0, 4))
const _anioTemporada = hoy >= `${_anioHoy}-08-15` ? _anioHoy + 1 : _anioHoy
const _seasonStart   = `${_anioTemporada - 1}-08-15`
const _seasonEnd     = `${_anioTemporada}-08-15`

const [
    { data: reservas },
    { data: disponibilidad },
    { data: servicios },
    { data: payments },
    { data: charges },
    { data: solicitudesNuevas },
    { data: venues }
] = await Promise.all([
    supabase.from('reservations').select('*'),
    supabase.from('availability').select('*'),
    supabase.from('services').select('*').order('day'),
    supabase.from('payments').select('*').order('due_date'),
    supabase.from('charges').select('*').order('due_date'),
    supabase.from('reservation_requests').select('id, source, status').not('status', 'in', '("convertida","descartada")'),
    supabase.from('venues').select('id, provider_id')
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
            r.venue_id   === d.venue_id   &&
            r.service_id === d.service_id &&
            r.status     !== 'Cancelada'
        )
        const totalReservado = reservasPS.reduce((s, r) => s + r.slots, 0)
        if (totalReservado > d.total_slots) {
            haySobrereserva = true
            const li = document.createElement('li')
            li.textContent = `${d.venue_id} / ${d.service_id}: ${totalReservado} reservadas, ${d.total_slots} disponibles`
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
    // Separar solicitudes sfcom (source tipo WEBxxx_nnnn) de solicitudes web; excluir cerradas
    const solicitudesActivas        = solicitudesNuevas ?? []
    const solicitudesSfcom          = solicitudesActivas.filter(s => s.source && /^WEB\d+_\d+$/.test(s.source) && s.status === 'nueva')
    const solicitudesWebNuevas      = solicitudesActivas.filter(s => (!s.source || !/^WEB\d+_\d+$/.test(s.source)) && !s.source?.startsWith('sfcom_c:') && s.status === 'nueva')
    const solicitudesWebSeguimiento = solicitudesActivas.filter(s => (!s.source || !/^WEB\d+_\d+$/.test(s.source)) && !s.source?.startsWith('sfcom_c:') && s.status === 'seguimiento_pendiente')
    const leadsCancelados           = solicitudesActivas.filter(s => s.source?.startsWith('sfcom_c:') && s.status === 'nueva')

    const alertaSfcom = document.getElementById('alerta-sfcom')
    if (solicitudesSfcom.length > 0) {
        alertaSfcom.style.display = 'flex'
        document.getElementById('txt-sfcom').textContent =
            `${solicitudesSfcom.length} reserva(s) nueva(s) recibida(s) desde sfcom sin registrar`
    }

    const alertaCancelados = document.getElementById('alerta-cancelados-sfcom')
    if (alertaCancelados && leadsCancelados.length > 0) {
        alertaCancelados.style.display = 'flex'
        document.getElementById('txt-cancelados-sfcom').textContent =
            `${leadsCancelados.length} lead${leadsCancelados.length !== 1 ? 's' : ''} de sfcom cancelado${leadsCancelados.length !== 1 ? 's' : ''} — posibles ventas a recuperar`
    }

    const alertaSolicitudes = document.getElementById('alerta-solicitudes')
    const hayWeb = solicitudesWebNuevas.length > 0 || solicitudesWebSeguimiento.length > 0
    if (hayWeb) {
        alertaSolicitudes.style.display = 'flex'
        const partes = []
        if (solicitudesWebNuevas.length > 0)
            partes.push(`${solicitudesWebNuevas.length} nueva${solicitudesWebNuevas.length > 1 ? 's' : ''} sin atender`)
        if (solicitudesWebSeguimiento.length > 0)
            partes.push(`${solicitudesWebSeguimiento.length} en seguimiento pendiente`)
        document.getElementById('txt-solicitudes').textContent = `Solicitudes web — ${partes.join(', ')}`
    }

    bloqueAlertas.style.display =
        (haySobrereserva || pagosVencidos.length > 0 || cobrosVencidos.length > 0
        || solicitudesSfcom.length > 0 || hayWeb || leadsCancelados.length > 0) ? 'block' : 'none'
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
    // Cobros — excluir SFCOM para evitar doble conteo (sus reservas ya cuentan en clientes reales)
    const chargesClientes = charges.filter(c => c.client_id !== 'SFCOM')
    const cobrosTotal    = chargesClientes.reduce((s, c) => s + parseFloat(c.amount), 0)
    const cobrado        = chargesClientes.filter(c => c.collected).reduce((s, c) => s + parseFloat(c.amount), 0)
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

// Devuelve el color CSS del indicador de margen, o null si no hay actividad.
// ingreso/coste en euros. Rojo < 0; naranja < 15% de ingreso; verde ≥ 15%.
function _margenIndicador(ingreso, coste) {
    if (ingreso === 0 && coste === 0) return null
    const margen = ingreso - coste
    if (margen < 0) return 'var(--accent)'
    if (ingreso > 0 && margen / ingreso < 0.15) return 'var(--accent-warn)'
    return 'var(--accent-ok)'
}

// ===== BLOQUE 3: DISPONIBILIDAD POR EVENTO =====
// Tipos "balcón": los únicos que tienen margen de reventa relevante.
// visita_guiada y otro tienen un modelo de coste fijo distinto y se tratan aparte.
const TIPOS_BALCON = ['encierro', 'chupinazo', 'procesion', 'despedida_gigantes', 'pobre_de_mi']

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
    const dotE = f.dot ? `<span style="color:${f.dot};font-size:10px;margin-right:4px">●</span>` : ''
    return `<tr style="${destacada ? 'background:var(--bg);font-weight:600;' : ''}cursor:pointer" onclick="_seleccionarEvento('${f.id}')">
        <td>${dotE}${f.id}</td>
        <td>${f.dia ?? '—'}</td>
        <td>${f.totalPlazas}</td>
        <td class="ok">${f.confirmadas}</td>
        <td class="warn">${f.pendientes}</td>
        <td>${f.libres}</td>
        <td>${barraOcupacion(f.pct, f.colorFill)}</td>
        <td style="font-size:11px">${f.clientesHTML || '—'}</td>
    </tr>`
}

function filaDetalleProveedor(d) {
    return `<tr style="background:#fafafa">
        <td style="padding-left:24px;color:var(--subtle)">↳ ${d.dot ? `<span style="color:${d.dot};font-size:10px;margin-right:4px">●</span>` : ''}${d.id}</td>
        <td>—</td>
        <td>${d.total}</td>
        <td class="ok">${d.confirmadas}</td>
        <td class="warn">${d.pendientes}</td>
        <td>${d.libres}</td>
        <td>${barraOcupacion(d.pct, d.colorFill)}</td>
        <td style="font-size:11px">${d.clientesHTML || '—'}</td>
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

    eventosFilas = servicios.map(s => {
        const dispS       = disponibilidad.filter(d => d.service_id === s.id)
        const totalPlazas = dispS.reduce((sum, d) => sum + (d.total_slots ?? 0), 0)
        if (totalPlazas === 0) return null

        const reservasS = reservas.filter(r => r.service_id === s.id && r.status !== 'Cancelada')

        // Tipos no-balcón solo aparecen si tienen reservas activas o al menos un row con billing capacity
        if (!TIPOS_BALCON.includes(s.event_type)) {
            if (!reservasS.length && !dispS.some(d => d.billing_model === 'capacity')) return null
        }
        const confirmadas = reservasS.filter(r => r.status === 'Confirmada').reduce((sum, r) => sum + r.slots, 0)
        const pendientes  = reservasS.filter(r => r.status === 'Pendiente').reduce((sum, r) => sum + r.slots, 0)
        const libres      = totalPlazas - confirmadas - pendientes
        const pct         = totalPlazas > 0 ? Math.round((confirmadas + pendientes) / totalPlazas * 100) : 0
        const colorFill   = pct >= 90 ? 'var(--accent)' : pct >= 60 ? 'var(--accent-warn)' : 'var(--accent-ok)'

        const detalleProveedores = dispS.map(d => {
            const resP  = reservasS.filter(r => r.venue_id === d.venue_id)
            const confP = resP.filter(r => r.status === 'Confirmada').reduce((s, r) => s + r.slots, 0)
            const pendP = resP.filter(r => r.status === 'Pendiente').reduce((s, r) => s + r.slots, 0)
            const libP  = (d.total_slots ?? 0) - confP - pendP
            const pctP  = d.total_slots > 0 ? Math.round((confP + pendP) / d.total_slots * 100) : 0
            const colP  = pctP >= 90 ? 'var(--accent)' : pctP >= 60 ? 'var(--accent-warn)' : 'var(--accent-ok)'
            const clientesP     = [...new Set(resP.map(r => r.client_id))].join(', ')
            const clientesHTMLP = renderClientChips(resP)
            const ingresoP = resP.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
            const costeP   = d.billing_model === 'fixed'
                ? ((confP + pendP) > 0 ? parseFloat(d.price_per_slot ?? 0) : 0)
                : d.billing_model === 'capacity'
                    ? (d.total_slots ?? 0) * parseFloat(d.price_per_slot ?? 0)
                    : (confP + pendP) * parseFloat(d.price_per_slot ?? 0)
            const dotP = _margenIndicador(ingresoP, costeP)
            return { id: d.venue_id, total: d.total_slots, confirmadas: confP, pendientes: pendP, libres: libP, pct: pctP, colorFill: colP, clientes: clientesP, clientesHTML: clientesHTMLP, ingreso: ingresoP, coste: costeP, dot: dotP }
        })

        const clientesEvento     = [...new Set(reservasS.map(r => r.client_id))].join(', ')
        const clientesEventoHTML = renderClientChips(reservasS)
        const ingresoEvento      = detalleProveedores.reduce((s, d) => s + d.ingreso, 0)
        const costeEvento        = detalleProveedores.reduce((s, d) => s + d.coste, 0)
        const dotEvento          = _margenIndicador(ingresoEvento, costeEvento)
        return { id: s.id, dia: s.day, totalPlazas, confirmadas, pendientes, libres, pct, colorFill, detalleProveedores, clientes: clientesEvento, clientesHTML: clientesEventoHTML, dot: dotEvento }
    }).filter(Boolean)

    const inputEvento = document.getElementById('selector-evento')
    const listEvento  = document.getElementById('autocomplete-evento-list')

    function _listEvento(val) {
        const items = val ? eventosFilas.filter(f => f.id.toLowerCase().includes(val.toLowerCase())) : eventosFilas
        listEvento.innerHTML = items.map(f => `<div data-id="${f.id}">${f.id}</div>`).join('')
        listEvento.style.display = items.length ? 'block' : 'none'
    }
    inputEvento.addEventListener('focus', () => _listEvento(inputEvento.value))
    inputEvento.addEventListener('input', () => {
        _listEvento(inputEvento.value)
        if (!inputEvento.value) { sortEventosCol = null; sortEventosDir = 'asc'; renderEventos('') }
    })
    listEvento.addEventListener('click', e => {
        const div = e.target.closest('[data-id]')
        if (!div) return
        inputEvento.value = div.dataset.id
        listEvento.style.display = 'none'
        sortEventosCol = null; sortEventosDir = 'asc'
        renderEventos(div.dataset.id)
    })

    sortEventosCol = null; sortEventosDir = 'asc'
    renderEventos('')
}

// Clic en fila de evento: selecciona en el selector y muestra el detalle. Segundo clic deselecciona.
window._seleccionarEvento = function(id) {
    const input = document.getElementById('selector-evento')
    const nuevo = input.value === id ? '' : id
    input.value = nuevo
    document.getElementById('autocomplete-evento-list').style.display = 'none'
    sortEventosCol = null; sortEventosDir = 'asc'
    renderEventos(nuevo)
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
    const dotP = f.dot ? `<span style="color:${f.dot};font-size:10px;margin-right:4px">●</span>` : ''
    return `<tr style="${destacada ? 'background:var(--bg);font-weight:600;' : ''}cursor:pointer" onclick="_seleccionarProveedor('${f.id}')">
        <td>${dotP}${f.id}</td>
        <td>${f.capacidad}</td>
        <td class="ok">${f.confirmadas}</td>
        <td class="warn">${f.pendientes}</td>
        <td>${f.libres}</td>
        <td>${barraOcupacion(f.pct, f.colorFill)}</td>
        <td style="font-size:11px">${f.clientesHTML || '—'}</td>
    </tr>`
}

function filaDetalleServicio(d) {
    return `<tr style="background:#fafafa">
        <td style="padding-left:24px;color:var(--subtle)">
            ↳ ${d.dot ? `<span style="color:${d.dot};font-size:10px;margin-right:4px">●</span>` : ''}${d.id}${d.esConsumption ? ' <span style="font-size:10px;color:var(--accent-warn)">(consumo)</span>' : ''}${d.esFixed ? ' <span style="font-size:10px;color:var(--subtle)">(cuota fija)</span>' : ''}
        </td>
        <td>${d.total}</td>
        <td class="ok">${d.confirmadas}</td>
        <td class="warn">${d.pendientes}</td>
        <td>${d.libres}</td>
        <td>${barraOcupacion(d.pct, d.colorFill)}</td>
        <td style="font-size:11px">${d.clientesHTML || '—'}</td>
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

    const venueIds = [...new Set(disponibilidad.map(d => d.venue_id))].sort()
    provFilas = venueIds.map(venueId => {
        const dispP     = disponibilidad.filter(d => d.venue_id === venueId)
        const capacidad = dispP.reduce((sum, d) => sum + (d.total_slots ?? 0), 0)
        if (capacidad === 0) return null

        const reservasP = reservas.filter(r => r.venue_id === venueId && r.status !== 'Cancelada')

        // Venues de tipos no-balcón solo aparecen si tienen reservas activas o billing capacity
        const esBalcon = dispP.some(d => TIPOS_BALCON.includes(servicios.find(s => s.id === d.service_id)?.event_type))
        if (!esBalcon && !reservasP.length && !dispP.some(d => d.billing_model === 'capacity')) return null

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
            const esFixed       = d.billing_model === 'fixed'
            const clientesS     = [...new Set(resS.map(r => r.client_id))].join(', ')
            const clientesHTMLS = renderClientChips(resS)
            const ingresoS = resS.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
            const costeS   = d.billing_model === 'fixed'
                ? ((confS + pendS) > 0 ? parseFloat(d.price_per_slot ?? 0) : 0)
                : d.billing_model === 'capacity'
                    ? (d.total_slots ?? 0) * parseFloat(d.price_per_slot ?? 0)
                    : (confS + pendS) * parseFloat(d.price_per_slot ?? 0)
            const dotS = _margenIndicador(ingresoS, costeS)
            return { id: d.service_id, total: d.total_slots, confirmadas: confS, pendientes: pendS, libres: libS, pct: pctS, colorFill: colS, esConsumption, esFixed, clientes: clientesS, clientesHTML: clientesHTMLS, ingreso: ingresoS, coste: costeS, dot: dotS }
        })

        const clientesProv     = [...new Set(reservasP.map(r => r.client_id))].join(', ')
        const clientesProvHTML = renderClientChips(reservasP)
        const ingresoProv      = detalleServicios.reduce((s, d) => s + d.ingreso, 0)
        const costeProv        = detalleServicios.reduce((s, d) => s + d.coste, 0)
        const dotProv          = _margenIndicador(ingresoProv, costeProv)
        return { id: venueId, capacidad, confirmadas, pendientes, libres, pct, colorFill, detalleServicios, clientes: clientesProv, clientesHTML: clientesProvHTML, dot: dotProv }
    }).filter(Boolean)

    const inputProv = document.getElementById('selector-proveedor')
    const listProv  = document.getElementById('autocomplete-proveedor-list')

    function _listProv(val) {
        const items = val ? provFilas.filter(f => f.id.toLowerCase().includes(val.toLowerCase())) : provFilas
        listProv.innerHTML = items.map(f => `<div data-id="${f.id}">${f.id}</div>`).join('')
        listProv.style.display = items.length ? 'block' : 'none'
    }
    inputProv.addEventListener('focus', () => _listProv(inputProv.value))
    inputProv.addEventListener('input', () => {
        _listProv(inputProv.value)
        if (!inputProv.value) { sortProvCol = null; sortProvDir = 'asc'; renderProveedores('') }
    })
    listProv.addEventListener('click', e => {
        const div = e.target.closest('[data-id]')
        if (!div) return
        inputProv.value = div.dataset.id
        listProv.style.display = 'none'
        sortProvCol = null; sortProvDir = 'asc'
        renderProveedores(div.dataset.id)
    })

    sortProvCol = null; sortProvDir = 'asc'
    renderProveedores('')
}

// Clic en fila de proveedor: selecciona en el selector y muestra el detalle. Segundo clic deselecciona.
window._seleccionarProveedor = function(id) {
    const input = document.getElementById('selector-proveedor')
    const nuevo = input.value === id ? '' : id
    input.value = nuevo
    document.getElementById('autocomplete-proveedor-list').style.display = 'none'
    sortProvCol = null; sortProvDir = 'asc'
    renderProveedores(nuevo)
}

// ===== BLOQUE 1 DERECHA: RESUMEN DE NEGOCIO =====
function calcularResumen() {
    const confirmadas  = reservas.filter(r => r.status === 'Confirmada')
    const pendientes   = reservas.filter(r => r.status === 'Pendiente')

    const plazasConf   = confirmadas.reduce((s, r) => s + r.slots, 0)
    const plazasPend   = pendientes.reduce((s, r) => s + r.slots, 0)
    const ingresos     = confirmadas.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
    const ingresosPend = pendientes.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
    const costes       = payments.reduce((s, p) => s + parseFloat(p.amount), 0)
    const margen       = ingresos - costes

    // Coste adicional si se confirman las pendientes en venues de tipo consumption
    const dispMap = new Map(disponibilidad.map(d => [`${d.venue_id}:${d.service_id}`, d]))
    const costePendConsumo = pendientes.reduce((s, r) => {
        const d = dispMap.get(`${r.venue_id}:${r.service_id}`)
        if (!d || d.billing_model !== 'consumption') return s
        return s + r.slots * parseFloat(d.price_per_slot ?? 0)
    }, 0)

    const margenConPend = ingresos + ingresosPend - costes - costePendConsumo

    document.getElementById('kpi-res-confirmadas').textContent     = confirmadas.length
    document.getElementById('kpi-res-pendientes').textContent      = pendientes.length
    document.getElementById('kpi-plazas-confirmadas').textContent  = plazasConf
    document.getElementById('kpi-plazas-pendientes').textContent   = plazasPend
    document.getElementById('kpi-ingresos-brutos').textContent     = fmt(ingresos)
    document.getElementById('kpi-ingresos-pendientes').textContent = fmt(ingresosPend)
    document.getElementById('kpi-costes').textContent              = fmt(costes)

    const costePendRow = document.getElementById('kpi-coste-pend-row')
    if (costePendConsumo > 0) {
        document.getElementById('kpi-coste-pend-consumo').textContent = fmt(costePendConsumo)
        costePendRow.style.display = 'flex'
    } else {
        costePendRow.style.display = 'none'
    }

    const kpiMargen = document.getElementById('kpi-margen')
    kpiMargen.textContent = fmt(margen)
    kpiMargen.className   = 'kpi-dual__conf ' + (margen >= 0 ? '' : 'kpi-dual__conf--error')

    const kpiMargenPend = document.getElementById('kpi-margen-pendientes')
    if (kpiMargenPend) {
        kpiMargenPend.textContent = pendientes.length > 0
            ? `+${fmt(ingresosPend)} si se confirman pendientes → ${fmt(margenConPend)}`
            : ''
    }
}

// ===== BLOQUE 2: POR VENDER =====
function calcularPorVender() {
    const svcMap = new Map(servicios.map(s => [s.id, s]))

    const dispBalcon = disponibilidad.filter(d => TIPOS_BALCON.includes(svcMap.get(d.service_id)?.event_type))

    // Precio medio de venta estimado a partir de reservas confirmadas en balcones
    const confirmadasBalcon = reservas.filter(r =>
        r.status === 'Confirmada' &&
        TIPOS_BALCON.includes(svcMap.get(r.service_id)?.event_type)
    )
    const plazasConfBalcon = confirmadasBalcon.reduce((s, r) => s + r.slots, 0)
    const ingresosBalcon   = confirmadasBalcon.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
    const precioMedioVenta = plazasConfBalcon > 0 ? ingresosBalcon / plazasConfBalcon : 0

    // Construir filas con plazas libres y margen estimado por par venue+servicio
    const filas = dispBalcon.flatMap(d => {
        const reservadas = reservas.filter(r =>
            r.venue_id   === d.venue_id &&
            r.service_id === d.service_id &&
            r.status     !== 'Cancelada'
        ).reduce((s, r) => s + r.slots, 0)
        const libres = Math.max(0, (d.total_slots ?? 0) - reservadas)
        if (libres === 0) return []

        const svc          = svcMap.get(d.service_id)
        const nombreVenue  = d.venue_id
        const nombreEvento = svc ? (svc.name ?? svc.event_type) : d.service_id
        const precioProv = parseFloat(d.price_per_slot ?? 0)

        // Para capacity: ya se ha pagado precioProv × total_slots; el gasto no recuperado por
        // plaza libre = precioProv. Para consumption: el coste solo aparece si se vende.
        const gastoAsociado = d.billing_model === 'capacity' ? libres * precioProv : 0
        const margen = d.billing_model === 'capacity'
            ? libres * precioMedioVenta - gastoAsociado
            : libres * (precioMedioVenta - precioProv)

        return [{ libres, nombreVenue, nombreEvento, gastoAsociado, margen, precioProv, modelo: d.billing_model }]
    })

    // KPIs globales
    const plazasLibres      = filas.reduce((s, f) => s + f.libres, 0)
    const ingresoPotencial  = plazasLibres * precioMedioVenta
    const costeAdicional    = filas
        .filter(f => f.modelo === 'consumption')
        .reduce((s, f) => s + f.libres * f.precioProv, 0)
    const margenNoCapturado = ingresoPotencial - costeAdicional

    document.getElementById('kpi-plazas-libres').textContent     = plazasLibres
    document.getElementById('kpi-ingreso-potencial').textContent = fmt(ingresoPotencial)
    document.getElementById('kpi-coste-adicional').textContent   = fmt(costeAdicional)
    const elMargenNC = document.getElementById('kpi-margen-no-capturado')
    elMargenNC.textContent = fmt(margenNoCapturado)
    elMargenNC.className   = 'kpi-valor ' + (margenNoCapturado >= 0 ? 'ok' : 'error')

    const elPrecioMedio = document.getElementById('kpi-precio-medio-plaza')
    if (elPrecioMedio) elPrecioMedio.textContent = plazasLibres > 0 ? `${fmt(ingresoPotencial / plazasLibres)}/plaza (estimado)` : ''
    const elMargenMedio = document.getElementById('kpi-margen-medio-plaza')
    if (elMargenMedio) elMargenMedio.textContent = plazasLibres > 0 ? `${fmt(margenNoCapturado / plazasLibres)}/plaza` : ''

    const capacity    = filas.filter(f => f.modelo === 'capacity').sort((a, b) => b.libres - a.libres)
    const consumption = filas.filter(f => f.modelo === 'consumption').sort((a, b) => b.libres - a.libres)

    _renderPVSeccion('pv-capacity',    capacity,    5, true)
    _renderPVSeccion('pv-consumption', consumption, 3, false)
}

function _paretoCorte(items, maxRows) {
    if (!items.length) return { filas: [], resto: 0, restoN: 0 }
    const umbral = items[0].libres / 3
    const significativas = items.filter(f => f.libres >= umbral).slice(0, maxRows)
    const resto = items.slice(significativas.length)
    return { filas: significativas, resto: resto.reduce((s, f) => s + f.libres, 0), restoN: resto.length }
}

function _renderPVSeccion(containerId, items, maxRows, esCapacity) {
    const el = document.getElementById(containerId)
    if (!items.length) { el.innerHTML = ''; return }

    const { filas, resto, restoN } = _paretoCorte(items, maxRows)
    const titulo = esCapacity ? 'Contratadas por llenar' : 'Oportunidades'

    // Resumen de las filas mostradas
    const totPlazas = filas.reduce((s, f) => s + f.libres, 0)
    const totGasto  = filas.reduce((s, f) => s + (f.gastoAsociado || 0), 0)
    const totMargen = filas.reduce((s, f) => s + f.margen, 0)
    const margenPos = totMargen >= 0
    const margenStr = (margenPos ? '+' : '−') + fmt(Math.abs(totMargen))
    const margenCls = margenPos ? 'pv-ganancia' : 'pv-ganancia--neg'

    let resumenHTML = ''
    if (filas.length > 1 || restoN > 0) {
        if (esCapacity) {
            resumenHTML = `<p class="pv-resumen-seccion">Estas <strong>${totPlazas} plazas</strong>: <span class="pv-gasto">−${fmt(totGasto)}</span> comprometido → <span class="${margenCls}">${margenStr}</span> de margen</p>`
        } else {
            resumenHTML = `<p class="pv-resumen-seccion">Estas <strong>${totPlazas} plazas</strong>: <span class="${margenCls}">${margenStr}</span> de margen potencial</p>`
        }
    }

    const filaHTML = f => {
        const pos       = f.margen >= 0
        const mStr      = (pos ? '+' : '−') + fmt(Math.abs(f.margen))
        const mCls      = pos ? 'pv-ganancia' : 'pv-ganancia--neg'
        const costeHTML = esCapacity
            ? `<span class="pv-gasto">−${fmt(f.gastoAsociado)}</span><span class="pv-sep"> → </span>`
            : `<span class="pv-sep">→ </span>`
        return `<tr>
            <td class="pv-venue">${f.nombreVenue}</td>
            <td class="pv-evento">${f.nombreEvento}</td>
            <td class="pv-plazas">${f.libres} libres</td>
            <td class="pv-margen">${costeHTML}<span class="${mCls}">${mStr}</span></td>
        </tr>`
    }

    const restoHTML = restoN > 0
        ? `<div class="pv-resto">y ${resto} plaza${resto !== 1 ? 's' : ''} más en ${restoN} balcón${restoN !== 1 ? 'es' : ''}</div>`
        : ''

    el.innerHTML = `<div class="pv-seccion${esCapacity ? '' : ' pv-seccion--gap'}">
        <h3 class="pv-titulo">${titulo}</h3>
        ${resumenHTML}
        <table class="pv-tabla">${filas.map(filaHTML).join('')}</table>
        ${restoHTML}
    </div>`
}

// ===== BLOQUE 2: CASHFLOW =====
function calcularCashflow() {
    const eventos = []
    const enTemporada = f => f && f >= _seasonStart && f < _seasonEnd

    payments.forEach(p => {
        if (!enTemporada(p.due_date)) return
        eventos.push({ fecha: p.due_date, importe: -parseFloat(p.amount || 0), tipo: 'previsto' })
    })

    charges.filter(c => c.client_id !== 'SFCOM').forEach(c => {
        if (!enTemporada(c.due_date)) return
        eventos.push({ fecha: c.due_date, importe: parseFloat(c.amount || 0), tipo: 'previsto' })
    })

    payments.filter(p => p.paid).forEach(p => {
        const fecha = p.paid_date ?? p.due_date
        if (!enTemporada(fecha) || fecha > hoy) return
        eventos.push({ fecha, importe: -parseFloat(p.amount || 0), tipo: 'real' })
    })

    charges.filter(c => c.collected && c.client_id !== 'SFCOM').forEach(c => {
        const fecha = c.collected_date ?? c.due_date
        if (!enTemporada(fecha) || fecha > hoy) return
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
                    min: new Date(`${_anioTemporada}-03-01T12:00:00`),
                    max: new Date(`${_anioTemporada}-08-15T12:00:00`),
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

document.addEventListener('click', e => {
    if (!e.target.closest('.autocomplete-wrap')) {
        document.getElementById('autocomplete-evento-list').style.display = 'none'
        document.getElementById('autocomplete-proveedor-list').style.display = 'none'
    }
})
calcularResumen()
calcularPorVender()
calcularCashflow()
verificarConsistenciaFinanciera(supabase, persistirCobrosCliente, persistirPagosProveedor)
document.getElementById('btnVerificarDatos')?.addEventListener('click', () => ejecutarVerificacionGlobal(supabase, persistirCobrosCliente, persistirPagosProveedor))

// ===== EXPORT CSV =====
document.getElementById('btnExportPagos')?.addEventListener('click', () => {
    exportTable(pagosFiltradosCache, [
        { key: 'provider_id', label: 'Proveedor' },
        { key: 'comments',    label: 'Concepto' },
        { key: 'due_date',    label: 'Fecha' },
        { key: 'amount',      label: 'Importe', fmt: v => fmt(v) },
        { key: 'paid',        label: 'Estado',  fmt: v => v ? 'Pagado' : 'Pendiente' },
    ], 'pagos_pendientes.xlsx')
})

document.getElementById('btnExportCobros')?.addEventListener('click', () => {
    exportTable(cobrosFiltradosCache, [
        { key: 'client_id',  label: 'Cliente' },
        { key: 'comments',   label: 'Concepto' },
        { key: 'due_date',   label: 'Fecha' },
        { key: 'amount',     label: 'Importe',  fmt: v => fmt(v) },
        { key: 'collected',  label: 'Estado',   fmt: v => v ? 'Cobrado' : 'Pendiente' },
    ], 'cobros_pendientes.xlsx')
})

document.getElementById('btnExportEventos')?.addEventListener('click', () => {
    exportTable(eventosFilas, [
        { key: 'id',          label: 'Evento' },
        { key: 'dia',         label: 'Día' },
        { key: 'totalPlazas', label: 'Total' },
        { key: 'confirmadas', label: 'Confirmadas' },
        { key: 'pendientes',  label: 'Pendientes' },
        { key: 'libres',      label: 'Libres' },
        { key: 'pct',         label: 'Ocupación %' },
        { key: 'clientes',    label: 'Clientes' },
    ], 'eventos.xlsx')
})

document.getElementById('btnExportProveedores')?.addEventListener('click', () => {
    exportTable(provFilas, [
        { key: 'id',          label: 'Proveedor' },
        { key: 'capacidad',   label: 'Capacidad' },
        { key: 'confirmadas', label: 'Confirmadas' },
        { key: 'pendientes',  label: 'Pendientes' },
        { key: 'libres',      label: 'Libres' },
        { key: 'pct',         label: 'Ocupación %' },
        { key: 'clientes',    label: 'Clientes' },
    ], 'proveedores.xlsx')
})