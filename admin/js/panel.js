import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)

// Hamburger
const sidebar     = document.getElementById('sidebar')
const overlayMenu = document.getElementById('overlayMenu')
document.getElementById('hamburger').addEventListener('click', () => {
    sidebar.classList.toggle('open')
    overlayMenu.classList.toggle('open')
})
overlayMenu.addEventListener('click', () => {
    sidebar.classList.remove('open')
    overlayMenu.classList.remove('open')
})

// ===== DATOS =====
const hoy = new Date().toISOString().split('T')[0]

const [
    { data: reservas },
    { data: disponibilidad },
    { data: servicios },
    { data: proveedores },
    { data: payments },
    { data: charges }
] = await Promise.all([
    supabase.from('reservations').select('*'),
    supabase.from('availability').select('*'),
    supabase.from('services').select('*').order('day'),
    supabase.from('providers').select('*').order('id'),
    supabase.from('payments').select('*').order('due_date'),
    supabase.from('charges').select('*, reservations(client_id, status)').order('due_date')
])

const fmt = n => parseFloat(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
const diasDesdeHoy = d => d ? Math.ceil((new Date(d) - new Date(hoy)) / 86400000) : 999

// ===== BLOQUE 0: ALERTAS =====
function calcularAlertas() {
    const bloqueAlertas = document.getElementById('bloque-alertas')
    const listaSobre    = document.getElementById('lista-sobrereservas')
    let haySobrereserva = false
    listaSobre.innerHTML = ''

    // Detectar sobrereservas
    disponibilidad.forEach(d => {
        const reservasPS = reservas.filter(r =>
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

    // Pagos vencidos
    const pagosVencidos = payments.filter(p => !p.paid && p.due_date && p.due_date < hoy)
    const totalPagosVencidos = pagosVencidos.reduce((s, p) => s + parseFloat(p.amount), 0)
    const alertaPagos = document.getElementById('alerta-pagos-vencidos')
    if (pagosVencidos.length > 0) {
        alertaPagos.style.display = 'flex'
        document.getElementById('txt-pagos-vencidos').textContent =
            `${pagosVencidos.length} pago(s) a proveedores vencido(s) sin pagar — ${fmt(totalPagosVencidos)}`
    }

    // Cobros vencidos (solo de reservas confirmadas o pendientes)
    const cobrosVencidos = charges.filter(c =>
        !c.collected &&
        c.due_date && c.due_date < hoy &&
        c.reservations?.status !== 'Cancelada'
    )
    const totalCobrosVencidos = cobrosVencidos.reduce((s, c) => s + parseFloat(c.amount), 0)
    const alertaCobros = document.getElementById('alerta-cobros-vencidos')
    if (cobrosVencidos.length > 0) {
        alertaCobros.style.display = 'flex'
        document.getElementById('txt-cobros-vencidos').textContent =
            `${cobrosVencidos.length} cobro(s) a clientes vencido(s) sin cobrar — ${fmt(totalCobrosVencidos)}`
    }

    bloqueAlertas.style.display =
        (haySobrereserva || pagosVencidos.length > 0 || cobrosVencidos.length > 0) ? 'block' : 'none'
}

// ===== BLOQUE 1: CALENDARIO =====
let tabActiva = '7'

function calcularCalendario() {
    const diasFiltro = tabActiva === '7' ? 7 : tabActiva === '30' ? 30 : 99999

    // Pagos
    const pagosFiltrados = payments.filter(p => {
        if (p.paid) return false
        const dias = diasDesdeHoy(p.due_date)
        return dias <= diasFiltro
    }).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))

    const tbodyPagos = document.getElementById('tbody-pagos-proximos')
    tbodyPagos.innerHTML = pagosFiltrados.length === 0
        ? '<tr><td colspan="5" style="color:var(--subtle)">Sin pagos en este periodo</td></tr>'
        : pagosFiltrados.map(p => {
            const dias    = diasDesdeHoy(p.due_date)
            const vencido = dias < 0
            const clase   = vencido ? 'error' : dias <= 7 ? 'warn' : ''
            return `<tr>
                <td>${p.provider_id}</td>
                <td>${p.comments ?? '—'}</td>
                <td class="${clase}">${p.due_date ?? '—'}${vencido ? ' ⚠️' : ''}</td>
                <td>${fmt(p.amount)}</td>
                <td class="${vencido ? 'error' : 'warn'}">Pendiente</td>
            </tr>`
        }).join('')

    // Cobros
    const cobrosFiltrados = charges.filter(c => {
        if (c.collected) return false
        if (c.reservations?.status === 'Cancelada') return false
        const dias = diasDesdeHoy(c.due_date)
        return dias <= diasFiltro
    }).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))

    const tbodyCobros = document.getElementById('tbody-cobros-proximos')
    tbodyCobros.innerHTML = cobrosFiltrados.length === 0
        ? '<tr><td colspan="5" style="color:var(--subtle)">Sin cobros en este periodo</td></tr>'
        : cobrosFiltrados.map(c => {
            const dias    = diasDesdeHoy(c.due_date)
            const vencido = dias < 0
            const clase   = vencido ? 'error' : dias <= 7 ? 'warn' : ''
            return `<tr>
                <td>${c.reservation_id}</td>
                <td>${c.comments ?? '—'}</td>
                <td class="${clase}">${c.due_date ?? '—'}${vencido ? ' ⚠️' : ''}</td>
                <td>${fmt(c.amount)}</td>
                <td class="${vencido ? 'error' : 'warn'}">Pendiente</td>
            </tr>`
        }).join('')
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
    // Cobros (solo reservas no canceladas)
    const chargesActivos = charges.filter(c => c.reservations?.status !== 'Cancelada')
    const cobrosTotal    = chargesActivos.reduce((s, c) => s + parseFloat(c.amount), 0)
    const cobrado        = chargesActivos.filter(c => c.collected).reduce((s, c) => s + parseFloat(c.amount), 0)
    const pendienteCobro = cobrosTotal - cobrado

    document.getElementById('kpi-cobros-confirmados').textContent = fmt(cobrosTotal)
    document.getElementById('kpi-cobrado').textContent            = fmt(cobrado)
    document.getElementById('kpi-pendiente-cobro').textContent    = fmt(pendienteCobro)

    // Pagos
    const pagosTotal    = payments.reduce((s, p) => s + parseFloat(p.amount), 0)
    const pagado        = payments.filter(p => p.paid).reduce((s, p) => s + parseFloat(p.amount), 0)
    const pendientePago = pagosTotal - pagado

    document.getElementById('kpi-pagos-total').textContent    = fmt(pagosTotal)
    document.getElementById('kpi-pagado').textContent         = fmt(pagado)
    document.getElementById('kpi-pendiente-pago').textContent = fmt(pendientePago)

    // Saldo neto
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
function calcularEventos() {
    const tbody    = document.getElementById('tbody-eventos')
    const selector = document.getElementById('selector-evento')

    // Construir datos por servicio
    const filas = servicios.map(s => {
        const dispS       = disponibilidad.filter(d => d.service_id === s.id)
        const totalPlazas = dispS.reduce((sum, d) => sum + (d.total_slots ?? 0), 0)
        if (totalPlazas === 0) return null

        const reservasS   = reservas.filter(r => r.service_id === s.id && r.status !== 'Cancelada')
        const confirmadas = reservasS.filter(r => r.status === 'Confirmada').reduce((sum, r) => sum + r.slots, 0)
        const pendientes  = reservasS.filter(r => r.status === 'Pendiente').reduce((sum, r) => sum + r.slots, 0)
        const libres      = totalPlazas - confirmadas - pendientes
        const pct         = totalPlazas > 0 ? Math.round((confirmadas + pendientes) / totalPlazas * 100) : 0
        const colorFill   = pct >= 90 ? 'var(--accent)' : pct >= 60 ? 'var(--accent-warn)' : 'var(--accent-ok)'

        // Detalle por proveedor para este servicio
        const detalleProveedores = dispS.map(d => {
            const resP  = reservasS.filter(r => r.provider_id === d.provider_id)
            const confP = resP.filter(r => r.status === 'Confirmada').reduce((s, r) => s + r.slots, 0)
            const pendP = resP.filter(r => r.status === 'Pendiente').reduce((s, r) => s + r.slots, 0)
            const libP  = (d.total_slots ?? 0) - confP - pendP
            const pctP  = d.total_slots > 0 ? Math.round((confP + pendP) / d.total_slots * 100) : 0
            const colP  = pctP >= 90 ? 'var(--accent)' : pctP >= 60 ? 'var(--accent-warn)' : 'var(--accent-ok)'
            return { id: d.provider_id, total: d.total_slots, confirmadas: confP, pendientes: pendP, libres: libP, pct: pctP, colorFill: colP }
        })

        return { id: s.id, dia: s.day, totalPlazas, confirmadas, pendientes, libres, pct, colorFill, detalleProveedores }
    }).filter(Boolean)

    // Poblar selector
    selector.innerHTML = '<option value="">— Todos los eventos —</option>' +
        filas.map(f => `<option value="${f.id}">${f.id}</option>`).join('')

    function renderEventos(filtro) {
        if (!filtro) {
            // Mostrar todos — solo filas resumen
            tbody.innerHTML = filas.map(f => filaEvento(f, false)).join('')
        } else {
            const f = filas.find(x => x.id === filtro)
            if (!f) return
            // Fila resumen + detalle por proveedor
            tbody.innerHTML = filaEvento(f, true) +
                f.detalleProveedores.map(d => filaDetalleProveedor(d)).join('')
        }
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
        </tr>`
    }

    renderEventos('')
    selector.addEventListener('change', () => renderEventos(selector.value))
}

// ===== BLOQUE 4: DISPONIBILIDAD POR PROVEEDOR =====
function calcularProveedores() {
    const tbody    = document.getElementById('tbody-proveedores')
    const selector = document.getElementById('selector-proveedor')

    const filas = proveedores.map(p => {
        const dispP     = disponibilidad.filter(d => d.provider_id === p.id)
        const capacidad = dispP.reduce((sum, d) => sum + (d.total_slots ?? 0), 0)
        if (capacidad === 0) return null

        const reservasP   = reservas.filter(r => r.provider_id === p.id && r.status !== 'Cancelada')
        const confirmadas = reservasP.filter(r => r.status === 'Confirmada').reduce((sum, r) => sum + r.slots, 0)
        const pendientes  = reservasP.filter(r => r.status === 'Pendiente').reduce((sum, r) => sum + r.slots, 0)
        const libres      = capacidad - confirmadas - pendientes
        const pct         = capacidad > 0 ? Math.round((confirmadas + pendientes) / capacidad * 100) : 0
        const colorFill   = pct >= 90 ? 'var(--accent)' : pct >= 60 ? 'var(--accent-warn)' : 'var(--accent-ok)'

        // Detalle por servicio para este proveedor
        const detalleServicios = dispP.map(d => {
            const resS  = reservasP.filter(r => r.service_id === d.service_id)
            const confS = resS.filter(r => r.status === 'Confirmada').reduce((s, r) => s + r.slots, 0)
            const pendS = resS.filter(r => r.status === 'Pendiente').reduce((s, r) => s + r.slots, 0)
            const libS  = (d.total_slots ?? 0) - confS - pendS
            const pctS  = d.total_slots > 0 ? Math.round((confS + pendS) / d.total_slots * 100) : 0
            const colS  = pctS >= 90 ? 'var(--accent)' : pctS >= 60 ? 'var(--accent-warn)' : 'var(--accent-ok)'
            const esConsumption = d.billing_model === 'consumption'
            return { id: d.service_id, total: d.total_slots, confirmadas: confS, pendientes: pendS, libres: libS, pct: pctS, colorFill: colS, esConsumption }
        })

        return { id: p.id, capacidad, confirmadas, pendientes, libres, pct, colorFill, detalleServicios }
    }).filter(Boolean)

    selector.innerHTML = '<option value="">— Todos los proveedores —</option>' +
        filas.map(f => `<option value="${f.id}">${f.id}</option>`).join('')

    function renderProveedores(filtro) {
        if (!filtro) {
            tbody.innerHTML = filas.map(f => filaProveedor(f, false)).join('')
        } else {
            const f = filas.find(x => x.id === filtro)
            if (!f) return
            tbody.innerHTML = filaProveedor(f, true) +
                f.detalleServicios.map(d => filaDetalleServicio(d)).join('')
        }
    }

    function filaProveedor(f, destacada) {
        return `<tr style="${destacada ? 'background:var(--bg);font-weight:600' : ''}">
            <td>${f.id}</td>
            <td>${f.capacidad}</td>
            <td class="ok">${f.confirmadas}</td>
            <td class="warn">${f.pendientes}</td>
            <td>${f.libres}</td>
            <td>${barraOcupacion(f.pct, f.colorFill)}</td>
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
        </tr>`
    }

    renderProveedores('')
    selector.addEventListener('change', () => renderProveedores(selector.value))
}

// ===== BLOQUE 5: RESUMEN DE NEGOCIO =====
function calcularResumen() {
    const confirmadas = reservas.filter(r => r.status === 'Confirmada')
    const pendientes  = reservas.filter(r => r.status === 'Pendiente')
    const canceladas  = reservas.filter(r => r.status === 'Cancelada')

    const plazasConf  = confirmadas.reduce((s, r) => s + r.slots, 0)
    const ingresos    = confirmadas.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
    const costes      = payments.reduce((s, p) => s + parseFloat(p.amount), 0)
    const margen      = ingresos - costes

    document.getElementById('kpi-res-confirmadas').textContent  = confirmadas.length
    document.getElementById('kpi-res-pendientes').textContent   = pendientes.length
    document.getElementById('kpi-res-canceladas').textContent   = canceladas.length
    document.getElementById('kpi-plazas-confirmadas').textContent = plazasConf
    document.getElementById('kpi-ingresos-brutos').textContent  = fmt(ingresos)
    document.getElementById('kpi-costes').textContent           = fmt(costes)

    const kpiMargen = document.getElementById('kpi-margen')
    kpiMargen.textContent = fmt(margen)
    kpiMargen.className   = 'kpi-valor ' + (margen >= 0 ? 'ok' : 'error')
}

// ===== BLOQUE 2: CASHFLOW (gráfico) =====
function calcularCashflow() {
    const eventos = []

    // Salidas: payments (negativos)
    payments.forEach(p => {
        const fecha = p.due_date
        if (!fecha) return
        eventos.push({ fecha, importe: -parseFloat(p.amount || 0), tipo: 'previsto' })
    })

    // Entradas previstas: charges (positivos, solo reservas no canceladas)
    charges.forEach(c => {
        const fecha = c.due_date
        if (!fecha) return
        const estado = c.reservations?.status
        if (estado === 'Cancelada') return
        eventos.push({ fecha, importe: parseFloat(c.amount || 0), tipo: 'previsto' })
    })

    // Real pagado: payments con paid=true
    payments.filter(p => p.paid).forEach(p => {
        const fecha = p.paid_date ?? p.due_date
        if (!fecha || fecha > hoy) return
        eventos.push({ fecha, importe: -parseFloat(p.amount || 0), tipo: 'real' })
    })

    // Real cobrado: charges con collected=true
    charges.filter(c => c.collected).forEach(c => {
        const fecha = c.collected_date ?? c.due_date
        if (!fecha || fecha > hoy) return
        const estado = c.reservations?.status
        if (estado === 'Cancelada') return
        eventos.push({ fecha, importe: parseFloat(c.amount || 0), tipo: 'real' })
    })

    if (eventos.length === 0) {
        document.getElementById('bloque-cashflow').innerHTML = '<p style="color:var(--subtle)">Sin datos para mostrar</p>'
        return
    }

    // Fechas únicas ordenadas
    const fechas = [...new Set(eventos.map(e => e.fecha))].sort()

    // Acumular previsto
    let acum = 0
    const dataPrevisto = fechas.map(f => {
        acum += eventos.filter(e => e.fecha === f && e.tipo === 'previsto').reduce((s, e) => s + e.importe, 0)
        return { x: new Date(f + 'T12:00:00'), y: Math.round(acum) }
    })

    // Acumular real (solo hasta hoy)
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
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointHoverRadius: 6
                },
                {
                    label: 'Real acumulado',
                    data: dataReal,
                    borderColor: '#2a7a2a',
                    backgroundColor: 'rgba(42,122,42,0.08)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointHoverRadius: 6
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
                    time: {
                        unit: 'week',
                        displayFormats: { week: 'dd MMM' }
                    },
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
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`
                    }
                }
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