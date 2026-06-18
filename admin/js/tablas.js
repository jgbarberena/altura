import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { fmt, initSidebar, exportTable, abrirRenombrarId } from './utils.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

const hoy = new Date().toISOString().split('T')[0]

// ===== DEFINICIÓN DE TABLAS =====
// Cada tabla define: query supabase, columnas con label, campo, clase opcional y formato
const TABLAS = {
    reservations: {
        titulo: 'Reservas',
        query:  () => supabase.from('reservations').select('*').order('id'),
        cols: [
            { label: 'ID',          campo: 'id' },
            { label: 'Cliente',     campo: 'client_id' },
            { label: 'Venue',       campo: 'venue_id' },
            { label: 'Servicio',    campo: 'service_id' },
            { label: 'Plazas',      campo: 'slots' },
            { label: '€/plaza',     campo: 'price_per_slot',  fmt: v => fmt(v) },
            { label: 'Total',       campo: 'total_amount',    fmt: v => fmt(v) },
            { label: 'Estado',      campo: 'status',
                clase: v => v === 'Confirmada' ? 'estado-confirmada' : v === 'Pendiente' ? 'estado-pendiente' : 'estado-cancelada' },
            { label: 'Comentarios', campo: 'comments' },
        ]
    },
    reservation_requests: {
        titulo: 'Solicitudes web',
        query:  () => supabase.from('reservation_requests').select('*').order('created_at', { ascending: false }),
        cols: [
            { label: 'Fecha',        campo: 'created_at',     fmt: v => v ? new Date(v).toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—' },
            { label: 'Estado',       campo: 'status',         clase: v => v === 'nueva' || v === 'en_conversacion' || v === 'respuesta_enviada' || v === 'seguimiento_pendiente' ? 'estado-pendiente' : v === 'convertida' ? 'estado-confirmada' : 'estado-cancelada' },
            { label: 'Fuente',       campo: 'source',         fmt: v => v || 'web' },
            { label: 'Nombre',       campo: 'client_name' },
            { label: 'Email',        campo: 'client_email' },
            { label: 'Teléfono',     campo: 'client_phone' },
            { label: 'Dirección',    campo: 'client_address' },
            { label: 'Plazas',       campo: 'slots' },
            { label: 'Día',          campo: 'day',            fmt: v => v ? v + '/jul' : '—' },
            { label: 'Experiencia',  campo: 'level' },
            { label: '€/plaza',      campo: 'price_per_slot', fmt: v => v ? fmt(v) : '—' },
            { label: 'Comentarios',  campo: 'comments' },
            { label: 'Actualizada',  campo: 'updated_at',     fmt: v => v ? new Date(v).toLocaleDateString('es-ES') : '—' },
        ]
    },
    charges:  {
        titulo: 'Cobros',
        query:  () => supabase.from('charges').select('*').order('due_date'),
        cols: [
            { label: 'ID',          campo: 'id' },
            { label: 'Cliente',     campo: 'client_id' },
            { label: 'Importe',     campo: 'amount',          fmt: v => fmt(v) },
            { label: 'Fecha prev.', campo: 'due_date' },
            { label: 'Cobrado',     campo: 'collected',
                fmt: (v, row) => v ? `✅ ${row.collected_date ?? ''}` : (row.due_date && row.due_date < hoy ? '❌ Vencido' : '⏳ No'),
                clase: (v, row) => v ? 'cobrado-si' : (row.due_date && row.due_date < hoy ? 'cobrado-vencido' : 'cobrado-no') },
            { label: 'Fecha cobro', campo: 'collected_date' },
            { label: 'Concepto',    campo: 'comments' },
        ]
    },
    payments: {
        titulo: 'Pagos a proveedores',
        query:  () => supabase.from('payments').select('*').order('due_date'),
        cols: [
            { label: 'ID',          campo: 'id' },
            { label: 'Proveedor',   campo: 'provider_id' },
            { label: 'Importe',     campo: 'amount',     fmt: v => fmt(v) },
            { label: 'Fecha prev.', campo: 'due_date' },
            { label: 'Pagado',      campo: 'paid',
                fmt: (v, row) => v ? `✅ ${row.paid_date ?? ''}` : (row.due_date && row.due_date < hoy ? '❌ Vencido' : '⏳ No'),
                clase: (v, row) => v ? 'cobrado-si' : (row.due_date && row.due_date < hoy ? 'cobrado-vencido' : 'cobrado-no') },
            { label: 'Fecha pago',  campo: 'paid_date' },
            { label: 'Concepto',    campo: 'comments' },
        ]
    },
    venues: {
        titulo: 'Venues',
        query:  () => supabase.from('venues').select('*').order('id'),
        cols: [
            { label: 'ID',          campo: 'id', renameable: true },
            { label: 'Proveedor',   campo: 'provider_id' },
            { label: 'Nombre',      campo: 'display_name' },
            { label: 'Dirección',   campo: 'address' },
            { label: 'Tipo',        campo: 'venue_type' },
            { label: 'Comentarios', campo: 'comments' },
        ]
    },
    availability: {
        titulo: 'Disponibilidad',
        query:  () => supabase.from('availability').select('*').order('venue_id'),
        cols: [
            { label: 'ID',          campo: 'id' },
            { label: 'Venue',       campo: 'venue_id' },
            { label: 'Servicio',    campo: 'service_id' },
            { label: 'Plazas',      campo: 'total_slots' },
            { label: '€/plaza',     campo: 'price_per_slot', fmt: v => fmt(v) },
            { label: 'Modelo',      campo: 'billing_model',
                fmt: v => v === 'fixed' ? 'Cuota fija' : v === 'consumption' ? 'Consumo' : 'Capacidad',
                clase: v => v === 'fixed' ? 'modelo-fixed' : v === 'consumption' ? 'modelo-consumption' : 'modelo-capacity' },
            { label: 'Comentarios', campo: 'comments' },
        ]
    },
    clients: {
        titulo: 'Clientes',
        query:  () => supabase.from('clients').select('*').order('id'),
        cols: [
            { label: 'ID',          campo: 'id', renameable: true },
            { label: 'Nombre',      campo: 'name' },
            { label: 'Empresa',     campo: 'company' },
            { label: 'Teléfono',    campo: 'phone' },
            { label: 'Email',       campo: 'email' },
            { label: 'Comentarios', campo: 'comments' },
        ]
    },
    providers: {
        titulo: 'Proveedores',
        query:  () => supabase.from('providers').select('*').order('id'),
        cols: [
            { label: 'ID',           campo: 'id', renameable: true },
            { label: 'Nombre',       campo: 'name' },
            { label: 'Dirección',    campo: 'address' },
            { label: 'Forma pago',   campo: 'payment_method' },
            { label: 'Factura',      campo: 'invoice', fmt: v => v ? 'Sí' : 'No' },
            { label: 'Comentarios',  campo: 'comments' },
        ]
    },
    services: {
        titulo: 'Servicios',
        query:  () => supabase.from('services').select('*').order('day'),
        cols: [
            { label: 'ID',          campo: 'id', renameable: true },
            { label: 'Día',         campo: 'day' },
            { label: 'Nombre',      campo: 'name' },
            { label: 'Descripción', campo: 'description' },
            { label: 'Hora',        campo: 'start_time' },
            { label: 'Imagen',      campo: 'image_url' },
            { label: 'Comentarios', campo: 'comments' },
        ]
    }
}

// ===== ESTADO =====
let tablaActual  = 'reservations'
let datosRaw     = []      // datos originales de Supabase
let datosFiltrados = []    // después de aplicar filtros
let sortCol      = null
let sortDir      = 'asc'
let filtrosActivos = {}    // { campo: Set de valores seleccionados }
let panelFiltroAbierto = null

// ===== INICIALIZAR =====
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        tablaActual   = btn.dataset.tabla
        sortCol       = null
        sortDir       = 'asc'
        filtrosActivos = {}
        cargarTabla()
    })
})

// Cerrar panel de filtro al hacer click fuera
document.addEventListener('click', e => {
    if (panelFiltroAbierto && !panelFiltroAbierto.contains(e.target) &&
        !e.target.classList.contains('filter-icon')) {
        panelFiltroAbierto.remove()
        panelFiltroAbierto = null
    }
})

cargarTabla()

// ===== CARGAR DATOS =====
async function cargarTabla() {
    const wrapper = document.getElementById('tabla-wrapper')
    wrapper.innerHTML = '<p style="color:var(--subtle);font-size:13px">Cargando...</p>'

    const def = TABLAS[tablaActual]
    document.getElementById('tabla-titulo').textContent = def.titulo

    const { data, error } = await def.query()
    if (error) {
        wrapper.innerHTML = `<p style="color:var(--accent)">Error: ${error.message}</p>`
        return
    }

    datosRaw       = data
    datosFiltrados = [...datosRaw]
    renderTabla()
}

// ===== RENDERIZAR =====
function renderTabla() {
    const def  = TABLAS[tablaActual]
    const cols = def.cols

    // Aplicar sort
    if (sortCol !== null) {
        datosFiltrados.sort((a, b) => {
            const va = valorCelda(a, cols[sortCol])
            const vb = valorCelda(b, cols[sortCol])
            if (va === null || va === undefined) return 1
            if (vb === null || vb === undefined) return -1
            const cmp = String(va).localeCompare(String(vb), 'es', { numeric: true })
            return sortDir === 'asc' ? cmp : -cmp
        })
    }

    document.getElementById('tabla-count').textContent =
        `${datosFiltrados.length} / ${datosRaw.length} filas`

    // Construir tabla
    const wrapper = document.getElementById('tabla-wrapper')
    wrapper.innerHTML = `
        <table>
            <thead>
                <tr>${cols.map((c, i) => `
                    <th>
                        <div class="th-inner">
                            <span onclick="sortPor(${i})">${c.label}</span>
                            <span class="sort-icon ${sortCol === i ? sortDir : ''}" onclick="sortPor(${i})">
                                ${sortCol === i ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                            </span>
                            <span class="filter-icon ${filtrosActivos[c.campo]?.size > 0 ? 'activo' : ''}"
                                onclick="abrirFiltro(event, ${i})">▼</span>
                        </div>
                    </th>
                `).join('')}</tr>
            </thead>
            <tbody>
                ${datosFiltrados.map(row => `
                    <tr>${cols.map(c => {
                        const val   = row[c.campo]
                        const texto = c.fmt ? c.fmt(val, row) : (val ?? '—')
                        const clase = c.clase ? c.clase(val, row) : ''
                        const btnRename = (c.renameable && val)
                            ? `<button class="btn btn-secondary" style="font-size:10px;padding:1px 5px;margin-left:6px;vertical-align:middle"
                                onclick="window._renombrarDesdeTabla('${tablaActual}','${String(val).replace(/'/g, "\\'")}')">✏️</button>`
                            : ''
                        return `<td class="${clase}">${texto}${btnRename}</td>`
                    }).join('')}</tr>
                `).join('')}
            </tbody>
        </table>
    `
}

function valorCelda(row, col) {
    if (col.fmt) return col.fmt(row[col.campo], row)
    return row[col.campo]
}

// ===== SORT =====
window.sortPor = function(colIdx) {
    if (sortCol === colIdx) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc'
    } else {
        sortCol = colIdx
        sortDir = 'asc'
    }
    renderTabla()
}

// ===== FILTRO =====
window.abrirFiltro = function(e, colIdx) {
    e.stopPropagation()

    // Cerrar panel anterior
    if (panelFiltroAbierto) { panelFiltroAbierto.remove(); panelFiltroAbierto = null }

    const def   = TABLAS[tablaActual]
    const col   = def.cols[colIdx]
    const campo = col.campo

    // Valores únicos de esta columna en los datos originales
    const valores = [...new Set(datosRaw.map(row => {
        const v = col.fmt ? col.fmt(row[campo], row) : (row[campo] ?? '—')
        return String(v)
    }))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))

    const seleccionados = filtrosActivos[campo] ?? new Set(valores)

    const panel = document.createElement('div')
    panel.className = 'filter-panel'
    panel.innerHTML = `
        ${valores.map(v => `
            <label>
                <input type="checkbox" value="${v}" ${seleccionados.has(v) ? 'checked' : ''}>
                ${v}
            </label>
        `).join('')}
        <div class="filter-actions">
            <button onclick="seleccionarTodosFiltro('${campo}', true)">Todos</button>
            <button onclick="seleccionarTodosFiltro('${campo}', false)">Ninguno</button>
            <button onclick="aplicarFiltro('${campo}')">Aplicar</button>
        </div>
    `

    // Posicionar bajo el th
    const th = e.target.closest('th')
    const rect = th.getBoundingClientRect()
    panel.style.position = 'fixed'
    panel.style.top  = (rect.bottom + 2) + 'px'
    panel.style.left = rect.left + 'px'

    document.body.appendChild(panel)
    panelFiltroAbierto = panel
}

window.seleccionarTodosFiltro = function(campo, todos) {
    if (!panelFiltroAbierto) return
    panelFiltroAbierto.querySelectorAll('input[type=checkbox]').forEach(chk => {
        chk.checked = todos
    })
}

window.aplicarFiltro = function(campo) {
    if (!panelFiltroAbierto) return
    const checks   = [...panelFiltroAbierto.querySelectorAll('input[type=checkbox]')]
    const marcados = new Set(checks.filter(c => c.checked).map(c => c.value))
    const todos    = checks.every(c => c.checked)

    if (todos) {
        delete filtrosActivos[campo]
    } else {
        filtrosActivos[campo] = marcados
    }

    // Aplicar todos los filtros activos
    const def  = TABLAS[tablaActual]
    datosFiltrados = datosRaw.filter(row => {
        return def.cols.every(col => {
            const filtro = filtrosActivos[col.campo]
            if (!filtro) return true
            const v = col.fmt ? col.fmt(row[col.campo], row) : String(row[col.campo] ?? '—')
            return filtro.has(String(v))
        })
    })

    panelFiltroAbierto.remove()
    panelFiltroAbierto = null
    renderTabla()
}

window._renombrarDesdeTabla = async (tabla, idActual) => {
    await abrirRenombrarId({ tabla, idActual, supabase, onSuccess: () => cargarTabla() })
}

document.getElementById('btnExportTabla')?.addEventListener('click', () => {
    const def  = TABLAS[tablaActual]
    const cols = def.cols.map(c => ({ key: c.campo, label: c.label, fmt: c.fmt }))
    exportTable(datosFiltrados, cols, `${tablaActual}.csv`)
})