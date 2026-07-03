import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { fmt, initSidebar, exportTable, abrirRenombrarId, persistirCobrosCliente, persistirPagosProveedor, getTemporadaActiva, calcularSaldoCobro, calcularSaldoPago, calcularCostoPago } from './utils.js'
import { syncStockToSfcom } from './sfcom.js'
import { ejecutarVerificacion } from './verificacion.js'
import { crearModal } from './modal.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
document.getElementById('btnVerificarDatos')?.addEventListener('click', () => ejecutarVerificacion(supabase, { modoManual: true, incluirSfcom: true, incluirFinanciero: true, persistirCobros: persistirCobrosCliente, persistirPagos: persistirPagosProveedor, season: getTemporadaActiva() }))
initSidebar()

const hoy = new Date().toISOString().split('T')[0]

// ===== DEFINICIÓN DE TABLAS =====
// Cada tabla define: query supabase, columnas con label, campo, clase opcional y formato
const TABLAS = {
    reservations: {
        titulo: 'Reservas',
        query:  () => supabase.from('reservations').select('*, services(season, service_code)').order('id'),
        cols: [
            { label: 'ID',          campo: 'id' },
            { label: 'Cliente',     campo: 'client_id' },
            { label: 'Venue',       campo: 'venue_id' },
            { label: 'Servicio',    campo: 'service_id',      fmt: (v, row) => row.services?.service_code ?? v },
            { label: 'Plazas',      campo: 'slots' },
            { label: '€/plaza',     campo: 'price_per_slot',  fmt: v => fmt(v) },
            { label: 'Total',       campo: 'total_amount',    fmt: v => fmt(v) },
            { label: 'Estado',      campo: 'status',
                clase: v => v === 'Confirmada' ? 'estado-confirmada' : v === 'Pendiente' ? 'estado-pendiente' : 'estado-cancelada' },
            { label: 'Propuesta',   campo: 'proposal_number' },
            { label: 'PDF',         campo: 'proposal_path',   fmt: v => v ? '📄' : '—' },
            { label: 'Origen',      campo: 'origin_ref' },
            { label: 'Bienvenida',  campo: 'welcome_sent_at', fmt: v => v ? new Date(v).toLocaleDateString('es-ES') : '—' },
            { label: 'Temp.',       campo: 'services',        fmt: v => v?.season ?? '—' },
            { label: 'Comentarios', campo: 'comments' },
        ]
    },
    reservation_requests: {
        titulo: 'Solicitudes web',
        query:  () => supabase.from('reservation_requests').select('*').order('created_at', { ascending: false }),
        cols: [
            { label: 'ID',          campo: 'id' },
            { label: 'Fecha',       campo: 'created_at',          fmt: v => v ? new Date(v).toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—' },
            { label: 'Actualizada', campo: 'updated_at',          fmt: v => v ? new Date(v).toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—' },
            { label: 'Estado',      campo: 'status',              clase: v => v === 'nueva' || v === 'en_conversacion' || v === 'respuesta_enviada' || v === 'seguimiento_pendiente' ? 'estado-pendiente' : v === 'convertida' ? 'estado-confirmada' : 'estado-cancelada' },
            { label: 'Fuente',      campo: 'source',              fmt: v => v || 'web' },
            { label: 'Idioma',      campo: 'language' },
            { label: 'Nombre',      campo: 'client_name' },
            { label: 'Email',       campo: 'client_email' },
            { label: 'Teléfono',    campo: 'client_phone' },
            { label: 'Dirección',   campo: 'client_address' },
            { label: 'Borrador',    campo: 'proposal_draft',      fmt: v => {
                if (!v || !v.length) return '—'
                return v.map(p => [p.service_name, p.slots ? p.slots + 'p' : null, p.day ? p.day + '/jul' : null].filter(Boolean).join(' ')).join(' | ')
            }},
            { label: 'Notas',       campo: 'conversation_notes',  fmt: v => {
                if (!v) return '—'
                try {
                    const items = typeof v === 'string' ? JSON.parse(v) : v
                    if (!Array.isArray(items) || !items.length) return '—'
                    const msgs = items.filter(i => i.type === 'message')
                    return msgs.length ? `${msgs.length} msg` : `${items.length} entradas`
                } catch { return v.slice(0, 60) + (v.length > 60 ? '…' : '') }
            }},
            { label: 'Comentarios', campo: 'comments' },
        ]
    },
    charges:  {
        titulo: 'Cobros',
        query:  () => supabase.from('charges').select('*').order('due_date'),
        cols: [
            { label: 'ID',          campo: 'id' },
            { label: 'Cliente',     campo: 'client_id' },
            { label: 'Importe',     campo: 'amount',          fmt: v => fmt(v) },
            { label: 'Hito final',  campo: 'is_final',        fmt: v => v ? 'Sí' : 'No' },
            { label: 'Fecha prev.', campo: 'due_date' },
            { label: 'Cobrado',     campo: 'collected',
                fmt: (v, row) => v ? `✅ ${row.collected_date ?? ''}` : (row.due_date && row.due_date < hoy ? '❌ Vencido' : '⏳ No'),
                clase: (v, row) => v ? 'cobrado-si' : (row.due_date && row.due_date < hoy ? 'cobrado-vencido' : 'cobrado-no') },
            { label: 'Fecha cobro', campo: 'collected_date' },
            { label: 'Facturado',   campo: 'invoiced',        fmt: v => v ? 'Sí' : '—' },
            { label: 'Fecha fact.', campo: 'invoiced_at' },
            { label: 'Nº factura',  campo: 'invoice_number' },
            { label: 'PDF',         campo: 'invoice_path',    fmt: v => v ? '📄' : '—' },
            { label: 'Temp.',       campo: 'season' },
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
            { label: 'Hito final',  campo: 'is_final',   fmt: v => v ? 'Sí' : 'No' },
            { label: 'Fecha prev.', campo: 'due_date' },
            { label: 'Pagado',      campo: 'paid',
                fmt: (v, row) => v ? `✅ ${row.paid_date ?? ''}` : (row.due_date && row.due_date < hoy ? '❌ Vencido' : '⏳ No'),
                clase: (v, row) => v ? 'cobrado-si' : (row.due_date && row.due_date < hoy ? 'cobrado-vencido' : 'cobrado-no') },
            { label: 'Fecha pago',  campo: 'paid_date' },
            { label: 'Temp.',       campo: 'season' },
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
            { label: 'Slug',        campo: 'slug' },
            { label: 'Dirección',   campo: 'address' },
            { label: 'Tipo',        campo: 'venue_type' },
            { label: 'Comentarios', campo: 'comments' },
        ]
    },
    availability: {
        titulo: 'Disponibilidad',
        query:  () => supabase.from('availability').select('*, services(service_code)').order('venue_id'),
        cols: [
            { label: 'ID',          campo: 'id' },
            { label: 'Venue',       campo: 'venue_id' },
            { label: 'Servicio',    campo: 'service_id',      fmt: (v, row) => row.services?.service_code ?? v },
            { label: 'Plazas',      campo: 'total_slots' },
            { label: '€/plaza',     campo: 'price_per_slot',  fmt: v => fmt(v) },
            { label: 'Modelo',      campo: 'billing_model',
                fmt: v => v === 'fixed' ? 'Cuota fija' : v === 'consumption' ? 'Consumo' : 'Capacidad',
                clase: v => v === 'fixed' ? 'modelo-fixed' : v === 'consumption' ? 'modelo-consumption' : 'modelo-capacity' },
            { label: 'Descripción', campo: 'description' },
            { label: 'Acceso',      campo: 'access_instructions' },
            { label: 'Fotos',       campo: 'photos',          fmt: v => v?.length ? `${v.length}` : '—' },
            { label: 'Comentarios',     campo: 'comments' },
        ]
    },
    clients: {
        titulo: 'Clientes',
        query:  () => supabase.from('clients').select('*').order('id'),
        cols: [
            { label: 'ID',          campo: 'id', renameable: true },
            { label: 'Nombre',      campo: 'name' },
            { label: 'Empresa',     campo: 'company' },
            { label: 'NIF',         campo: 'nif' },
            { label: 'Dirección',   campo: 'address' },
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
            { label: 'Teléfono',     campo: 'phone' },
            { label: 'Email',        campo: 'email' },
            { label: 'Forma pago',   campo: 'payment_method' },
            { label: 'Factura',      campo: 'invoice',        fmt: v => v ? 'Sí' : 'No' },
            { label: 'Comentarios',  campo: 'comments' },
        ]
    },
    services: {
        titulo: 'Servicios',
        query:  () => supabase.from('services').select('*').order('season, day'),
        cols: [
            { label: 'ID',          campo: 'id' },
            { label: 'Código',      campo: 'service_code' },
            { label: 'Temp.',       campo: 'season' },
            { label: 'Día',         campo: 'day' },
            { label: 'Tipo',        campo: 'event_type' },
            { label: 'Nombre',      campo: 'name' },
            { label: 'Descripción', campo: 'description' },
            { label: 'Hora',        campo: 'start_time' },
            { label: 'Imagen',      campo: 'image_url' },
        ]
    },
    sfcom_listings: {
        titulo: 'sfcom · Listados',
        query: async () => {
            const { data, error } = await supabase.from('sfcom_listings')
                .select('*, availability!inner(venue_id, service_id, services!inner(service_code))')
                .order('availability_id')
            if (error || !data) return { data: null, error }
            return {
                data: data.map(r => ({
                    ...r,
                    _venue_id:     r.availability?.venue_id                    ?? null,
                    _service_id:   r.availability?.service_id                  ?? null,
                    _service_code: r.availability?.services?.service_code ?? null,
                    availability:  undefined
                })),
                error: null
            }
        },
        cols: [
            { label: 'Venue',        campo: '_venue_id' },
            { label: 'Servicio',     campo: '_service_code' },
            { label: 'Estado',       campo: 'sfcom_status',      fmt: v => v ?? '—' },
            { label: 'Nombre sfcom', campo: 'sfcom_service_name' },
            { label: 'Producto ID',  campo: 'sfcom_product_id' },
            { label: 'Variación ID', campo: 'sfcom_variation_id' },
            { label: 'Plazas sfcom', campo: 'sfcom_slots_listed' },
            { label: 'Precio pub.',  campo: 'sfcom_public_price', fmt: v => fmt(v) },
        ]
    }
}

// ===== COLUMNAS EDITABLES (Fase C.1 — sin FKs ni cascadas) =====
// tipo: text | number | date | datetime | boolean | enum | textarea | json-textarea | proposal-picker
// pairedWith: campo relacionado en composites boolean+date
// pairedLabel: texto para los modales del composite
const EDITABLE = {
    reservations: {
        price_per_slot:  { tipo: 'number', cascade: 'price-per-slot' },
        proposal_number: { tipo: 'proposal-picker' },
        proposal_path:   { tipo: 'proposal-picker' },
        origin_ref:      { tipo: 'text' },
        welcome_sent_at: { tipo: 'datetime' },
        comments:        { tipo: 'textarea' },
    },
    reservation_requests: {
        created_at:         { tipo: 'datetime' },
        updated_at:         { tipo: 'datetime' },
        status:             { tipo: 'enum', opciones: [
            ['nueva','Nueva'], ['en_conversacion','En conversación'],
            ['respuesta_enviada','Respuesta enviada'], ['seguimiento_pendiente','Seguimiento pendiente'],
            ['convertida','Convertida'], ['descartada','Descartada'],
        ]},
        source:             { tipo: 'text' },
        language:           { tipo: 'text' },
        client_name:        { tipo: 'text' },
        client_email:       { tipo: 'text' },
        client_phone:       { tipo: 'text' },
        client_address:     { tipo: 'text' },
        proposal_draft:     { tipo: 'json-textarea' },
        conversation_notes: { tipo: 'textarea' },
        comments:           { tipo: 'textarea' },
    },
    charges: {
        amount:         { tipo: 'number', cascade: 'cobros' },
        due_date:       { tipo: 'date' },
        collected:      { tipo: 'boolean', pairedWith: 'collected_date', pairedLabel: 'cobrado' },
        collected_date: { tipo: 'date',    pairedWith: 'collected',      pairedLabel: 'cobrado' },
        invoiced:       { tipo: 'boolean' },
        invoiced_at:    { tipo: 'date' },
        invoice_number: { tipo: 'text' },
        invoice_path:   { tipo: 'text' },
        is_final:       { tipo: 'boolean', cascade: 'cobros-final' },
        comments:       { tipo: 'textarea' },
    },
    payments: {
        amount:    { tipo: 'number', cascade: 'pagos' },
        due_date:  { tipo: 'date' },
        paid:      { tipo: 'boolean', pairedWith: 'paid_date', pairedLabel: 'pagado' },
        paid_date: { tipo: 'date',    pairedWith: 'paid',      pairedLabel: 'pagado' },
        is_final:  { tipo: 'boolean', cascade: 'pagos-final' },
        comments:  { tipo: 'textarea' },
    },
    venues: {
        display_name: { tipo: 'text' },
        slug:         { tipo: 'text' },
        address:      { tipo: 'text' },
        venue_type:   { tipo: 'text' },
        comments:     { tipo: 'textarea' },
    },
    availability: {
        total_slots:         { tipo: 'number', cascade: 'avail-slots' },
        price_per_slot:      { tipo: 'number', cascade: 'avail-price' },
        billing_model:       { tipo: 'enum',   cascade: 'avail-price', opciones: [
            ['capacity', 'Capacidad'], ['consumption', 'Consumo'], ['fixed', 'Cuota fija'],
        ]},
        description:         { tipo: 'textarea' },
        access_instructions: { tipo: 'textarea' },
        comments:            { tipo: 'textarea' },
    },
    clients: {
        name:     { tipo: 'text' },
        company:  { tipo: 'text' },
        nif:      { tipo: 'text' },
        address:  { tipo: 'text' },
        phone:    { tipo: 'text' },
        email:    { tipo: 'text' },
        comments: { tipo: 'textarea' },
    },
    providers: {
        name:           { tipo: 'text' },
        address:        { tipo: 'text' },
        phone:          { tipo: 'text' },
        email:          { tipo: 'text' },
        payment_method: { tipo: 'text' },
        invoice:        { tipo: 'boolean' },
        comments:       { tipo: 'textarea' },
    },
    services: {
        service_code: { tipo: 'text' },
        season:       { tipo: 'number' },
        day:          { tipo: 'number' },
        event_type:   { tipo: 'text' },
        name:         { tipo: 'text' },
        description:  { tipo: 'textarea' },
        start_time:   { tipo: 'text' },
        image_url:    { tipo: 'text' },
    },
    sfcom_listings: {
        sfcom_slots_listed: { tipo: 'number', cascade: 'sfcom-slots' },
    },
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
            const va = a[cols[sortCol].campo]
            const vb = b[cols[sortCol].campo]
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
                ${datosFiltrados.map(row => {
                    const rowIdStr = _esc(String(row.id))
                    return `<tr data-id="${rowIdStr}">${cols.map(c => {
                        const val      = row[c.campo]
                        const texto    = c.fmt ? c.fmt(val, row) : (val ?? '—')
                        const clase    = c.clase ? c.clase(val, row) : ''
                        const editConf = c.renameable ? null : EDITABLE[tablaActual]?.[c.campo]
                        const tdClass  = [clase, editConf ? 'td-editable' : ''].filter(Boolean).join(' ')
                        const tdData   = editConf
                            ? ` data-rowid="${rowIdStr}" data-campo="${c.campo}" ondblclick="window._editarCelda(event)"`
                            : ''
                        const btnRename = (c.renameable && val)
                            ? `<button class="btn btn-secondary" style="font-size:10px;padding:1px 5px;margin-left:6px;vertical-align:middle"
                                onclick="window._renombrarDesdeTabla('${tablaActual}','${String(val).replace(/'/g, "\\'")}')">✏️</button>`
                            : ''
                        return `<td class="${tdClass}"${tdData}>${texto}${btnRename}</td>`
                    }).join('')}</tr>`
                }).join('')}
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
    exportTable(datosFiltrados, cols, `${tablaActual}.xlsx`)
})

// ===== EDICIÓN INLINE (Fase C.1) =====

function _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

window._editarCelda = async function(e) {
    const td = e.currentTarget
    if (td.dataset.editing) return
    e.stopPropagation()

    const rowId    = td.dataset.rowid
    const campo    = td.dataset.campo
    const editConf = EDITABLE[tablaActual]?.[campo]
    if (!editConf) return

    const row = datosRaw.find(r => String(r.id) === String(rowId))
    if (!row) return

    if (editConf.guard) {
        const msg = editConf.guard(row)
        if (msg) { alert(msg); return }
    }

    if (editConf.tipo === 'textarea' || editConf.tipo === 'json-textarea') {
        _activarEditorModal(rowId, campo, editConf, row)
    } else if (editConf.tipo === 'proposal-picker') {
        await _abrirPickerPropuesta(rowId, row)
    } else {
        _activarEditorInline(td, rowId, campo, editConf, row)
    }
}

function _activarEditorInline(td, rowId, campo, conf, row) {
    const valorActual = row[campo]
    td.dataset.editing = '1'
    td.classList.add('td-editing')

    let inputHtml
    if (conf.tipo === 'enum') {
        const opts = conf.opciones.map(([v, l]) =>
            `<option value="${_esc(v)}" ${String(v) === String(valorActual) ? 'selected' : ''}>${_esc(l)}</option>`
        ).join('')
        inputHtml = `<select class="edit-input">${opts}</select>`
    } else if (conf.tipo === 'boolean') {
        inputHtml = `<select class="edit-input">
            <option value="true"  ${valorActual === true  ? 'selected' : ''}>Sí</option>
            <option value="false" ${valorActual !== true  ? 'selected' : ''}>No</option>
        </select>`
    } else {
        const type = conf.tipo === 'number' ? 'number' : conf.tipo === 'date' ? 'date' : conf.tipo === 'datetime' ? 'datetime-local' : 'text'
        let val = valorActual ?? ''
        if (conf.tipo === 'datetime' && val) val = new Date(val).toISOString().slice(0, 16)
        const extra = conf.tipo === 'number' ? ' step="any"' : ''
        inputHtml = `<input type="${type}" value="${_esc(String(val))}" class="edit-input"${extra}>`
    }

    td.innerHTML = `<span class="edit-container">${inputHtml}<button class="btn-edit-ok">✓</button><button class="btn-edit-cancel">✗</button></span>`

    const input     = td.querySelector('.edit-input')
    const btnOk     = td.querySelector('.btn-edit-ok')
    const btnCancel = td.querySelector('.btn-edit-cancel')

    input.focus()
    if (input.tagName === 'INPUT') input.select?.()

    const cancelar = () => { delete td.dataset.editing; td.classList.remove('td-editing'); renderTabla() }

    const confirmar = async () => {
        let nuevoValor
        if (conf.tipo === 'boolean') {
            nuevoValor = input.value === 'true'
        } else if (conf.tipo === 'number') {
            nuevoValor = input.value === '' ? null : parseFloat(input.value)
        } else if (conf.tipo === 'date' || conf.tipo === 'datetime') {
            nuevoValor = input.value || null
        } else {
            nuevoValor = input.value.trim() || null
        }

        if (conf.cascade === 'price-per-slot') {
            await _guardarPricePerSlot(rowId, nuevoValor, row)
        } else if (conf.cascade === 'avail-slots') {
            await _guardarAvailSlots(rowId, nuevoValor, row)
        } else if (conf.cascade === 'avail-price') {
            await _guardarAvailPrice(rowId, campo, nuevoValor, row)
        } else if (conf.cascade === 'cobros') {
            await _guardarAmountCobro(rowId, nuevoValor, row)
        } else if (conf.cascade === 'pagos') {
            await _guardarAmountPago(rowId, nuevoValor, row)
        } else if (conf.cascade === 'sfcom-slots') {
            await _guardarSfcomSlots(rowId, nuevoValor, row)
        } else if (conf.cascade === 'cobros-final') {
            await _guardarIsFinalCobro(rowId, nuevoValor, row)
        } else if (conf.cascade === 'pagos-final') {
            await _guardarIsFinalPago(rowId, nuevoValor, row)
        } else if (conf.pairedWith && conf.tipo === 'boolean') {
            await _guardarBooleanConPar(rowId, campo, nuevoValor, conf, row)
        } else if (conf.pairedWith && conf.tipo === 'date') {
            await _guardarFechaConPar(rowId, campo, nuevoValor, conf, row)
        } else {
            await _guardarEdicion(rowId, { [campo]: nuevoValor })
        }
    }

    btnOk.addEventListener('click',     e => { e.stopPropagation(); confirmar() })
    btnCancel.addEventListener('click', e => { e.stopPropagation(); cancelar() })
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); confirmar() }
        if (e.key === 'Escape') cancelar()
    })
}

function _activarEditorModal(rowId, campo, conf, row) {
    const { overlay, panel } = crearModal('modal-edit-campo', { narrow: true })
    const valorActual = row[campo]
    const esJson = conf.tipo === 'json-textarea'
    const valorStr = esJson && valorActual != null
        ? JSON.stringify(valorActual, null, 2)
        : (valorActual ?? '')

    panel.innerHTML = `
        <h2 style="font-size:14px;margin-bottom:12px">Editar campo</h2>
        <textarea class="edit-textarea">${_esc(String(valorStr))}</textarea>
        ${esJson ? '<p style="font-size:11px;color:var(--subtle);margin-top:4px">JSON — debe ser válido para guardar</p>' : ''}
        <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
            <button class="btn btn-secondary" id="btn-et-cancel">Cancelar</button>
            <button class="btn btn-primary"   id="btn-et-ok">Guardar</button>
        </div>`

    panel.querySelector('textarea').focus()

    panel.querySelector('#btn-et-ok').addEventListener('click', async () => {
        let nuevoValor = panel.querySelector('textarea').value.trim() || null
        if (esJson && nuevoValor) {
            try { nuevoValor = JSON.parse(nuevoValor) }
            catch { alert('JSON inválido. Corrígelo antes de guardar.'); return }
        }
        overlay.close()
        await _guardarEdicion(rowId, { [campo]: nuevoValor })
    })
    panel.querySelector('#btn-et-cancel').addEventListener('click', () => overlay.close())
}

async function _abrirPickerPropuesta(rowId, row) {
    const { overlay, panel } = crearModal('modal-picker-prop', { wide: true })

    panel.innerHTML = `
        <h2 style="font-size:14px;margin-bottom:12px">Asignar propuesta</h2>
        <div id="pp-lista"><p style="color:var(--subtle);font-size:13px">Cargando archivos…</p></div>
        <div style="margin-top:14px">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Número de propuesta</label>
            <input type="text" id="pp-number" value="${_esc(row.proposal_number ?? '')}"
                style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit">
            <p style="font-size:11px;color:var(--subtle);margin-top:4px">Pre-relleno desde el nombre del archivo · editable libremente</p>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
            <button class="btn btn-secondary" id="pp-cancel">Cancelar</button>
            <button class="btn btn-primary"   id="pp-ok">Guardar</button>
        </div>`

    let selectedPath = row.proposal_path ?? null

    const archivos = await _listarBucket('proposals')
    const listaEl  = panel.querySelector('#pp-lista')

    if (!archivos.length) {
        listaEl.innerHTML = '<p style="color:var(--subtle);font-size:12px">No hay archivos en el bucket de propuestas.</p>'
    } else {
        listaEl.innerHTML = `<div class="pp-lista-scroll">` +
            archivos.map(f => `
                <label class="pp-fila ${f.path === selectedPath ? 'pp-fila--sel' : ''}">
                    <input type="radio" name="pp-file" value="${_esc(f.path)}" ${f.path === selectedPath ? 'checked' : ''}>
                    <span class="pp-nombre">${_esc(f.path)}</span>
                    <span class="pp-size">${f.size ? Math.round(f.size / 1024) + ' KB' : ''}</span>
                </label>`).join('') + `</div>`

        listaEl.querySelectorAll('input[type=radio]').forEach(radio => {
            radio.addEventListener('change', () => {
                selectedPath = radio.value
                listaEl.querySelectorAll('.pp-fila').forEach(l => l.classList.remove('pp-fila--sel'))
                radio.closest('.pp-fila').classList.add('pp-fila--sel')
                const nombre = radio.value.split('/').pop().replace(/\.[^.]+$/, '')
                panel.querySelector('#pp-number').value = nombre
            })
        })
    }

    panel.querySelector('#pp-ok').addEventListener('click', async () => {
        const proposalNumber = panel.querySelector('#pp-number').value.trim() || null
        overlay.close()
        const updates = {}
        if (selectedPath   !== row.proposal_path)   updates.proposal_path   = selectedPath
        if (proposalNumber !== row.proposal_number) updates.proposal_number = proposalNumber
        if (Object.keys(updates).length) await _guardarEdicion(rowId, updates)
    })
    panel.querySelector('#pp-cancel').addEventListener('click', () => overlay.close())
}

async function _listarBucket(bucket) {
    const archivos = []
    const { data: root } = await supabase.storage.from(bucket).list('', { limit: 200, sortBy: { column: 'name', order: 'asc' } })
    if (!root) return archivos
    for (const item of root) {
        if (item.id) {
            archivos.push({ name: item.name, path: item.name, size: item.metadata?.size })
        } else {
            const { data: sub } = await supabase.storage.from(bucket).list(item.name, { limit: 200, sortBy: { column: 'name', order: 'asc' } })
            if (sub) sub.filter(s => s.id).forEach(s =>
                archivos.push({ name: s.name, path: `${item.name}/${s.name}`, size: s.metadata?.size })
            )
        }
    }
    return archivos
}

async function _guardarBooleanConPar(rowId, campo, nuevoValor, conf, row) {
    const pairedCampo = conf.pairedWith
    const pairedValor = row[pairedCampo]
    const etiqueta    = conf.pairedLabel ?? 'cobrado/pagado'
    const updates     = { [campo]: nuevoValor }

    if (nuevoValor === true && !pairedValor) {
        const fecha = await _pedirFecha(`Marcar como ${etiqueta}`, '¿En qué fecha?', '')
        if (fecha === undefined) return
        if (fecha) updates[pairedCampo] = fecha
    } else if (nuevoValor === false && pairedValor) {
        const borrar = await _confirmarModal(`¿Borrar también la fecha (${pairedValor})?`)
        if (borrar === null) return
        if (borrar) updates[pairedCampo] = null
    }

    await _guardarEdicion(rowId, updates)
}

async function _guardarFechaConPar(rowId, campo, nuevoValor, conf, row) {
    const pairedCampo = conf.pairedWith
    const etiqueta    = conf.pairedLabel ?? 'cobrado/pagado'
    const updates     = { [campo]: nuevoValor }

    if (nuevoValor && !row[pairedCampo]) {
        const marcar = await _confirmarModal(`¿Marcar también como ${etiqueta}?`)
        if (marcar === null) return
        if (marcar) updates[pairedCampo] = true
    } else if (!nuevoValor && row[pairedCampo]) {
        const desmarcar = await _confirmarModal(`¿Desmarcar también como ${etiqueta}?`)
        if (desmarcar === null) return
        if (desmarcar) updates[pairedCampo] = false
    }

    await _guardarEdicion(rowId, updates)
}

function _pedirFecha(titulo, subtitulo, valorActual) {
    return new Promise(resolve => {
        const { overlay, panel } = crearModal('modal-pedir-fecha', { narrow: true })
        panel.innerHTML = `
            <h2 style="font-size:14px;margin-bottom:8px">${_esc(titulo)}</h2>
            <p style="font-size:12px;color:var(--subtle);margin-bottom:12px">${_esc(subtitulo)}</p>
            <input type="date" id="pf-fecha" value="${_esc(valorActual)}"
                style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px">
            <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
                <button class="btn btn-secondary" id="pf-cancel">Cancelar</button>
                <button class="btn btn-secondary" id="pf-skip">Solo marcar sin fecha</button>
                <button class="btn btn-primary"   id="pf-ok">Guardar con fecha</button>
            </div>`
        panel.querySelector('#pf-ok').addEventListener('click', () => {
            const v = panel.querySelector('#pf-fecha').value
            overlay.close(); resolve(v || '')
        })
        panel.querySelector('#pf-skip').addEventListener('click', () => { overlay.close(); resolve('') })
        panel.querySelector('#pf-cancel').addEventListener('click', () => { overlay.close(); resolve(undefined) })
    })
}

function _confirmarModal(mensaje) {
    return new Promise(resolve => {
        const { overlay, panel } = crearModal('modal-confirmar-edit', { narrow: true })
        panel.innerHTML = `
            <p style="font-size:13px;margin-bottom:16px">${_esc(mensaje)}</p>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button class="btn btn-secondary" id="mc-cancel">Cancelar</button>
                <button class="btn btn-secondary" id="mc-no">No</button>
                <button class="btn btn-primary"   id="mc-si">Sí</button>
            </div>`
        panel.querySelector('#mc-si').addEventListener('click',     () => { overlay.close(); resolve(true) })
        panel.querySelector('#mc-no').addEventListener('click',     () => { overlay.close(); resolve(false) })
        panel.querySelector('#mc-cancel').addEventListener('click', () => { overlay.close(); resolve(null) })
    })
}

// Modal con N opciones. opciones: [{ label, value, clase }]
// Resuelve con el value elegido, o null si se cierra sin elegir.
function _modalOpciones(titulo, descripcion, opciones) {
    return new Promise(resolve => {
        const { overlay, panel } = crearModal('modal-tablas-opc')
        let resuelto = false
        const resolver = v => { if (!resuelto) { resuelto = true; overlay.close(); resolve(v) } }
        panel.innerHTML = `
            <div class="modal-header-title">${titulo}</div>
            ${descripcion ? `<div class="modal-header-desc" style="margin-top:8px;font-size:13px">${descripcion}</div>` : ''}
            <div class="modal-actions" style="flex-direction:column;gap:6px;align-items:stretch;margin-top:16px">
                ${opciones.map((o, i) => `<button class="btn ${o.clase ?? 'btn-secondary'}" style="text-align:left" data-idx="${i}">${o.label}</button>`).join('')}
            </div>`
        opciones.forEach((o, i) =>
            panel.querySelector(`[data-idx="${i}"]`).addEventListener('click', () => resolver(o.value))
        )
        overlay.addEventListener('close', () => resolver(null), { once: true })
        overlay.showModal()
    })
}

async function _guardarEdicion(rowId, updates) {
    const tabla = tablaActual
    const { error } = await supabase.from(tabla).update(updates).eq('id', rowId)
    if (error) { alert(`Error al guardar: ${error.message}`); renderTabla(); return }

    const idx = datosRaw.findIndex(r => String(r.id) === String(rowId))
    if (idx >= 0) Object.assign(datosRaw[idx], updates)

    const def = TABLAS[tabla]
    if (Object.keys(filtrosActivos).length === 0) {
        datosFiltrados = [...datosRaw]
    } else {
        datosFiltrados = datosRaw.filter(row =>
            def.cols.every(col => {
                const filtro = filtrosActivos[col.campo]
                if (!filtro) return true
                const v = col.fmt ? col.fmt(row[col.campo], row) : String(row[col.campo] ?? '—')
                return filtro.has(String(v))
            })
        )
    }
    renderTabla()
}

// ===== HELPERS DE PRECÁLCULO (calcular → preguntar → ejecutar) =====

async function _preCalcularCobros(clientId, season) {
    const [{ data: reservas }, { data: charges }] = await Promise.all([
        supabase.from('reservations').select('client_id, status, total_amount, origin_ref').eq('client_id', clientId),
        supabase.from('charges').select('*').eq('client_id', clientId).eq('season', season)
    ])
    const { total: totalReservas, prepagos, cuantiaCorrecta, hitoFinal } =
        calcularSaldoCobro(clientId, reservas ?? [], charges ?? [])
    return { totalReservas, prepagos, cuantiaCorrecta, hitoFinal }
}

async function _preCalcularPagos(providerId, season) {
    const { data: venuesProv } = await supabase.from('venues').select('id').eq('provider_id', providerId)
    const venueIds = new Set((venuesProv ?? []).map(v => v.id))
    const [{ data: reservas }, { data: disponibilidad }, { data: payments }] = await Promise.all([
        supabase.from('reservations').select('id, venue_id, service_id, status, slots'),
        supabase.from('availability').select('*'),
        supabase.from('payments').select('*').eq('provider_id', providerId).eq('season', season)
    ])
    const { costTotal, prepagos, cuantiaCorrecta, hitoFinal } =
        calcularSaldoPago(venueIds, reservas ?? [], disponibilidad ?? [], payments ?? [])
    return { costTotal, prepagos, cuantiaCorrecta, hitoFinal }
}

// ===== C.2.D: CAMPOS DE AVAILABILITY CON CASCADA A PAGOS =====

async function _guardarAvailSlots(rowId, nuevoSlots, row) {
    if (nuevoSlots === null) { renderTabla(); return }
    const season = getTemporadaActiva()

    const { data: venue } = await supabase.from('venues').select('provider_id').eq('id', row.venue_id).single()
    if (!venue) { renderTabla(); return }
    const providerId = venue.provider_id

    const [{ data: venuesProv }, { data: reservas }, { data: disponibilidad }, { data: payments }, { data: sfcomEntry }] = await Promise.all([
        supabase.from('venues').select('id').eq('provider_id', providerId),
        supabase.from('reservations').select('id, venue_id, service_id, status, slots, origin_ref'),
        supabase.from('availability').select('*'),
        supabase.from('payments').select('*').eq('provider_id', providerId).eq('season', season),
        supabase.from('sfcom_listings').select('sfcom_slots_listed').eq('venue_id', row.venue_id).eq('service_id', row.service_id).maybeSingle()
    ])

    const venueIds = new Set((venuesProv ?? []).map(v => v.id))
    const reservasVS = (reservas ?? []).filter(r =>
        r.venue_id === row.venue_id && r.service_id === row.service_id && r.status !== 'Cancelada')
    const plazasTotales = reservasVS.reduce((s, r) => s + (r.slots ?? 0), 0)
    const plazasSfcom   = reservasVS.filter(r => r.origin_ref?.startsWith('WEB')).reduce((s, r) => s + (r.slots ?? 0), 0)
    const sfcomListados = sfcomEntry?.sfcom_slots_listed ?? 0

    // Bloqueo duro: reducción por debajo de plazas ya vendidas
    if (nuevoSlots < row.total_slots && plazasTotales > nuevoSlots) {
        const directas = plazasTotales - plazasSfcom
        const falta    = plazasTotales - nuevoSlots
        await _modalOpciones(
            '⛔ Reducción no permitida',
            `Hay <strong>${plazasTotales} plaza${plazasTotales !== 1 ? 's' : ''} vendida${plazasTotales !== 1 ? 's' : ''}</strong> para esta venue+servicio (${directas} directas + ${plazasSfcom} sfcom). Para reducir a ${nuevoSlots} es necesario cancelar primero <strong>${falta} plaza${falta !== 1 ? 's' : ''}</strong>.`,
            [{ label: 'Cerrar', value: 'cerrar', clase: 'btn-secondary' }]
        )
        renderTabla(); return
    }

    // Cálculo de impacto en coste
    const { cuantiaCorrecta, costTotal, hitoFinal } = calcularSaldoPago(venueIds, reservas ?? [], disponibilidad ?? [], payments ?? [])
    const dispMod    = (disponibilidad ?? []).map(d => d.id === rowId ? { ...d, total_slots: nuevoSlots } : d)
    const costNuevo  = calcularCostoPago(venueIds, reservas ?? [], dispMod)
    const nuevaCuant = cuantiaCorrecta + (costNuevo - costTotal)
    const hitoBloq   = hitoFinal && !!hitoFinal.paid

    // Impacto sfcom (solo si reducimos y sfcom_slots_listed queda por encima del nuevo total)
    const sfcomReduccion = nuevoSlots < row.total_slots && sfcomListados > nuevoSlots
    const sfcomAviso     = sfcomReduccion
        ? `<br>Las plazas listadas en sfcom se reducirán de <strong>${sfcomListados}</strong> a <strong>${nuevoSlots}</strong> y se sincronizará el stock.`
        : ''

    let desc
    if (Math.abs(costNuevo - costTotal) < 0.01) {
        desc = `Capacidad actualizada a <strong>${nuevoSlots}</strong> plazas. El coste del proveedor no cambia.${sfcomAviso}`
    } else if (!hitoFinal) {
        desc = Math.abs(nuevaCuant) < 0.01
            ? `El coste de ${providerId} cambia a <strong>${fmt(costNuevo)}</strong>. El saldo resultante es 0.${sfcomAviso}`
            : `El coste de ${providerId} cambia a <strong>${fmt(costNuevo)}</strong>. Se creará un pago final de <strong>${fmt(nuevaCuant)}</strong>.${sfcomAviso}`
    } else if (!hitoBloq) {
        desc = `El coste de ${providerId} cambia a <strong>${fmt(costNuevo)}</strong>. El pago final pasará de <strong>${fmt(hitoFinal.amount)}</strong> a <strong>${fmt(nuevaCuant)}</strong>.${sfcomAviso}`
    } else {
        const ajuste = nuevaCuant - parseFloat(hitoFinal.amount)
        desc = `El coste de ${providerId} cambia a <strong>${fmt(costNuevo)}</strong>. El pago final ya está pagado — se pasará a adelanto y se creará un hito de ajuste de <strong>${fmt(ajuste)}</strong>.${sfcomAviso}`
    }

    const sinCambioCoste = Math.abs(costNuevo - costTotal) < 0.01
    const opcion = await _modalOpciones(
        'Cambio de plazas disponibles',
        desc,
        sinCambioCoste
            ? [
                { label: 'Guardar', value: 'recalcular', clase: 'btn-primary' },
                { label: 'Cancelar', value: 'cancelar', clase: 'btn-secondary' },
              ]
            : [
                { label: 'Guardar y recalcular pago final', value: 'recalcular', clase: 'btn-primary' },
                { label: 'Cancelar — no cambiar nada',       value: 'cancelar',  clase: 'btn-secondary' },
                { label: 'Guardar sin recalcular ahora',     value: 'solo',      clase: 'btn-secondary' },
              ]
    )
    if (!opcion || opcion === 'cancelar') { renderTabla(); return }

    const { error } = await supabase.from('availability').update({ total_slots: nuevoSlots }).eq('id', rowId)
    if (error) { alert(`Error al guardar: ${error.message}`); renderTabla(); return }

    if (sfcomReduccion) {
        const { error: eSfc } = await supabase.from('sfcom_listings')
            .update({ sfcom_slots_listed: nuevoSlots })
            .eq('venue_id', row.venue_id).eq('service_id', row.service_id)
        if (eSfc) console.error('Error actualizando sfcom_slots_listed:', eSfc)
        else await syncStockToSfcom(supabase, rowId)
    }

    if (opcion === 'solo') { await cargarTabla(); return }

    const { data: dispFresh } = await supabase.from('availability').select('*')
    await persistirPagosProveedor(supabase, providerId, reservas ?? [], dispFresh ?? [])
    await cargarTabla()
}

async function _guardarAvailPrice(rowId, campo, nuevoValor, row) {
    if (nuevoValor === null) { renderTabla(); return }
    const season = getTemporadaActiva()

    const { data: venue } = await supabase.from('venues').select('provider_id').eq('id', row.venue_id).single()
    if (!venue) { renderTabla(); return }
    const providerId = venue.provider_id

    const [{ data: venuesProv }, { data: reservas }, { data: disponibilidad }, { data: payments }] = await Promise.all([
        supabase.from('venues').select('id').eq('provider_id', providerId),
        supabase.from('reservations').select('id, venue_id, service_id, status, slots'),
        supabase.from('availability').select('*'),
        supabase.from('payments').select('*').eq('provider_id', providerId).eq('season', season)
    ])

    const venueIds = new Set((venuesProv ?? []).map(v => v.id))
    const { cuantiaCorrecta, costTotal, hitoFinal } = calcularSaldoPago(venueIds, reservas ?? [], disponibilidad ?? [], payments ?? [])

    const dispMod   = (disponibilidad ?? []).map(d => d.id === rowId ? { ...d, [campo]: nuevoValor } : d)
    const costNuevo = calcularCostoPago(venueIds, reservas ?? [], dispMod)
    const nuevaCuant = cuantiaCorrecta + (costNuevo - costTotal)
    const hitoBloq   = hitoFinal && !!hitoFinal.paid

    if (Math.abs(costNuevo - costTotal) < 0.01) {
        await _guardarEdicion(rowId, { [campo]: nuevoValor })
        return
    }

    let desc
    if (!hitoFinal) {
        desc = Math.abs(nuevaCuant) < 0.01
            ? `El coste de ${providerId} cambia a <strong>${fmt(costNuevo)}</strong>. El saldo resultante es 0 — no se creará pago final ahora.`
            : `El coste de ${providerId} cambia a <strong>${fmt(costNuevo)}</strong>. Se creará un pago final de <strong>${fmt(nuevaCuant)}</strong>.`
    } else if (!hitoBloq) {
        desc = `El coste de ${providerId} cambia a <strong>${fmt(costNuevo)}</strong>. El pago final pasará de <strong>${fmt(hitoFinal.amount)}</strong> a <strong>${fmt(nuevaCuant)}</strong>.`
    } else {
        const ajuste = nuevaCuant - parseFloat(hitoFinal.amount)
        desc = `El coste de ${providerId} cambia a <strong>${fmt(costNuevo)}</strong>. El pago final ya está pagado — se pasará a adelanto y se creará un hito de ajuste de <strong>${fmt(ajuste)}</strong>.`
    }

    const opcion = await _modalOpciones(
        'Cambio de configuración — pago proveedor',
        desc,
        [
            { label: 'Guardar y recalcular pago final', value: 'recalcular', clase: 'btn-primary' },
            { label: 'Cancelar — no cambiar nada',       value: 'cancelar',  clase: 'btn-secondary' },
            { label: 'Guardar sin recalcular ahora',     value: 'solo',      clase: 'btn-secondary' },
        ]
    )
    if (!opcion || opcion === 'cancelar') { renderTabla(); return }

    const { error } = await supabase.from('availability').update({ [campo]: nuevoValor }).eq('id', rowId)
    if (error) { alert(`Error al guardar: ${error.message}`); renderTabla(); return }
    if (opcion === 'solo') { await cargarTabla(); return }

    const { data: dispFresh } = await supabase.from('availability').select('*')
    await persistirPagosProveedor(supabase, providerId, reservas ?? [], dispFresh ?? [])
    await cargarTabla()
}

// ===== HELPER: desvincula la propuesta PDF de todas las reservas que la comparten =====
// Llamar cuando se modifique price_per_slot o slots — el PDF queda huérfano en Storage (aceptado).

async function _limpiarPropuestaReserva(row) {
    if (!row.proposal_number && !row.proposal_path) return
    const { error } = row.proposal_number
        ? await supabase.from('reservations').update({ proposal_number: null, proposal_path: null }).eq('proposal_number', row.proposal_number)
        : await supabase.from('reservations').update({ proposal_number: null, proposal_path: null }).eq('proposal_path', row.proposal_path)
    if (error) console.error('Error limpiando propuesta:', error)
}

// ===== C.2.C: PRECIO POR PLAZA EN RESERVAS =====

async function _guardarPricePerSlot(rowId, nuevoPrice, row) {
    if (nuevoPrice === null) { renderTabla(); return }
    const season = row.services?.season ?? getTemporadaActiva()
    const pre    = await _preCalcularCobros(row.client_id, season)

    const nuevaTotalReserva    = row.slots * nuevoPrice
    const deltaCobros          = nuevaTotalReserva - parseFloat(row.total_amount || 0)
    const nuevaCuantiaCorrecta = pre.cuantiaCorrecta + deltaCobros
    const hitoActual           = pre.hitoFinal
    const hitoBloqueado        = hitoActual && !!(hitoActual.invoice_number || hitoActual.collected)

    // Sin cambio real en el total → guardar sin cascada ni aviso
    if (Math.abs(deltaCobros) < 0.01) {
        await _guardarEdicion(rowId, { price_per_slot: nuevoPrice })
        return
    }

    const propuestaAviso = (row.proposal_number || row.proposal_path)
        ? `<br><br>⚠️ La propuesta <strong>${row.proposal_number ?? 'sin número'}</strong> vinculada a esta reserva quedará desvinculada de todas las reservas que la comparten.`
        : ''

    let desc
    if (!hitoActual) {
        desc = Math.abs(nuevaCuantiaCorrecta) < 0.01
            ? `El total de la reserva cambia a <strong>${fmt(nuevaTotalReserva)}</strong>. El saldo resultante es 0 — no se creará cobro final ahora.`
            : `El total de la reserva cambia a <strong>${fmt(nuevaTotalReserva)}</strong>. Se creará un cobro final de <strong>${fmt(nuevaCuantiaCorrecta)}</strong> para ${row.client_id}.`
    } else if (!hitoBloqueado) {
        desc = `El total de la reserva cambia a <strong>${fmt(nuevaTotalReserva)}</strong>. El cobro final de ${row.client_id} pasará de <strong>${fmt(hitoActual.amount)}</strong> a <strong>${fmt(nuevaCuantiaCorrecta)}</strong>.`
    } else {
        const motivo = hitoActual.invoice_number ? 'facturado' : 'cobrado'
        const ajuste = nuevaCuantiaCorrecta - parseFloat(hitoActual.amount)
        desc = `El total de la reserva cambia a <strong>${fmt(nuevaTotalReserva)}</strong>. El cobro final ya está <strong>${motivo}</strong> — se pasará a adelanto y se creará un hito de ajuste de <strong>${fmt(ajuste)}</strong>.`
    }
    desc += propuestaAviso

    const opcion = await _modalOpciones(
        'Cambio de precio por plaza',
        desc,
        [
            { label: 'Guardar y recalcular cobro final', value: 'recalcular', clase: 'btn-primary' },
            { label: 'Cancelar — no cambiar nada',        value: 'cancelar',  clase: 'btn-secondary' },
            { label: 'Guardar solo el precio, sin recalcular ahora', value: 'solo', clase: 'btn-secondary' },
        ]
    )
    if (!opcion || opcion === 'cancelar') { renderTabla(); return }

    const { error } = await supabase.from('reservations').update({ price_per_slot: nuevoPrice }).eq('id', rowId)
    if (error) { alert(`Error al guardar: ${error.message}`); renderTabla(); return }
    await _limpiarPropuestaReserva(row)
    if (opcion === 'solo') { await cargarTabla(); return }

    const { data: reservas } = await supabase.from('reservations')
        .select('client_id, status, total_amount, origin_ref').eq('client_id', row.client_id)
    await persistirCobrosCliente(supabase, row.client_id, reservas ?? [])
    await cargarTabla()
}

// ===== C.2.A / C.2.B: EDICIÓN DE IMPORTES CON CASCADA =====

async function _guardarAmountCobro(rowId, nuevoAmount, row) {
    if (nuevoAmount === null) { renderTabla(); return }
    const season = row.season ?? getTemporadaActiva()
    const pre    = await _preCalcularCobros(row.client_id, season)

    // ── Editando el cobro is_final directamente ───────────────────────────
    if (row.is_final) {
        const bloqueado = !!(row.invoiced || row.collected)
        const coincide  = Math.abs(nuevoAmount - pre.cuantiaCorrecta) < 0.01
        if (bloqueado && !coincide) {
            alert(`Este cobro ya está ${row.invoiced ? 'facturado' : 'cobrado'} y el importe introducido (${fmt(nuevoAmount)}) no coincide con el saldo correcto (${fmt(pre.cuantiaCorrecta)}). Para corregirlo, primero pásalo a is_final=false desde esta tabla.`)
            renderTabla(); return
        }
        if (coincide) { await _guardarEdicion(rowId, { amount: nuevoAmount }); return }
        // No bloqueado, importe incorrecto → 3 opciones
        const opcion = await _modalOpciones(
            'Cambio de importe — cobro final',
            `El saldo correcto calculado es <strong>${fmt(pre.cuantiaCorrecta)}</strong>. El importe que introduces (<strong>${fmt(nuevoAmount)}</strong>) no coincide.`,
            [
                { label: `Guardar con el importe correcto: ${fmt(pre.cuantiaCorrecta)}`, value: 'correcto', clase: 'btn-primary' },
                { label: 'Cancelar — no cambiar nada', value: 'cancelar', clase: 'btn-secondary' },
                { label: `Guardar con ${fmt(nuevoAmount)} — descuadre voluntario`, value: 'incorrecto', clase: 'btn-secondary' },
            ]
        )
        if (!opcion || opcion === 'cancelar') { renderTabla(); return }
        if (opcion === 'correcto') { await _guardarEdicion(rowId, { amount: pre.cuantiaCorrecta }); return }
        await _guardarEdicion(rowId, { amount: nuevoAmount })
        return
    }

    // ── Editando un prepago (is_final = false) ────────────────────────────
    const cuantiaFinalNueva     = pre.cuantiaCorrecta + parseFloat(row.amount || 0) - nuevoAmount
    const hitoActual            = pre.hitoFinal
    const hitoFacturadoOCobrado = hitoActual && !!(hitoActual.invoiced || hitoActual.collected)

    let titulo, desc
    if (!hitoActual) {
        titulo = 'Cambio de importe — prepago'
        desc   = Math.abs(cuantiaFinalNueva) < 0.01
            ? `Nuevo importe: <strong>${fmt(nuevoAmount)}</strong>. El saldo resultante es 0 — no se creará cobro final ahora, pero se creará automáticamente cuando se edite algo desde el panel.`
            : `Nuevo importe: <strong>${fmt(nuevoAmount)}</strong>. Se creará un cobro final de <strong>${fmt(cuantiaFinalNueva)}</strong> para ${row.client_id}.`
    } else if (!hitoFacturadoOCobrado) {
        titulo = 'Cambio de importe — prepago'
        desc   = `Nuevo importe: <strong>${fmt(nuevoAmount)}</strong>. El cobro final de ${row.client_id} pasará de <strong>${fmt(hitoActual.amount)}</strong> a <strong>${fmt(cuantiaFinalNueva)}</strong>.`
    } else {
        const razon = hitoActual.invoiced ? 'facturado' : 'cobrado'
        titulo = 'Cambio de importe — prepago'
        desc   = `Nuevo importe: <strong>${fmt(nuevoAmount)}</strong>. El cobro final existente ya está <strong>${razon}</strong> — se pasará a is_final=false automáticamente y se creará uno nuevo de <strong>${fmt(cuantiaFinalNueva)}</strong>.`
    }
    const opcion = await _modalOpciones(titulo, desc, [
        { label: 'Guardar y recalcular cobro final', value: 'recalcular', clase: 'btn-primary' },
        { label: 'Cancelar — no cambiar nada',        value: 'cancelar',   clase: 'btn-secondary' },
        { label: 'Guardar solo este importe, sin recalcular ahora', value: 'solo', clase: 'btn-secondary' },
    ])
    if (!opcion || opcion === 'cancelar') { renderTabla(); return }

    const { error } = await supabase.from('charges').update({ amount: nuevoAmount }).eq('id', rowId)
    if (error) { alert(`Error al guardar: ${error.message}`); renderTabla(); return }
    if (opcion === 'solo') { await cargarTabla(); return }

    const { data: reservas } = await supabase.from('reservations')
        .select('client_id, status, total_amount, origin_ref').eq('client_id', row.client_id)
    await persistirCobrosCliente(supabase, row.client_id, reservas ?? [])
    await cargarTabla()
}

async function _guardarAmountPago(rowId, nuevoAmount, row) {
    if (nuevoAmount === null) { renderTabla(); return }
    const season = row.season ?? getTemporadaActiva()
    const pre    = await _preCalcularPagos(row.provider_id, season)

    // ── Editando el pago is_final directamente ────────────────────────────
    if (row.is_final) {
        const bloqueado = !!row.paid
        const coincide  = Math.abs(nuevoAmount - pre.cuantiaCorrecta) < 0.01
        if (bloqueado && !coincide) {
            alert(`Este pago ya está pagado y el importe introducido (${fmt(nuevoAmount)}) no coincide con el coste calculado (${fmt(pre.cuantiaCorrecta)}). Para corregirlo, primero pásalo a is_final=false desde esta tabla.`)
            renderTabla(); return
        }
        if (coincide) { await _guardarEdicion(rowId, { amount: nuevoAmount }); return }
        const opcion = await _modalOpciones(
            'Cambio de importe — pago final',
            `El coste calculado para este proveedor es <strong>${fmt(pre.cuantiaCorrecta)}</strong>. El importe que introduces (<strong>${fmt(nuevoAmount)}</strong>) no coincide.`,
            [
                { label: `Guardar con el importe correcto: ${fmt(pre.cuantiaCorrecta)}`, value: 'correcto', clase: 'btn-primary' },
                { label: 'Cancelar — no cambiar nada', value: 'cancelar', clase: 'btn-secondary' },
                { label: `Guardar con ${fmt(nuevoAmount)} — descuadre voluntario`, value: 'incorrecto', clase: 'btn-secondary' },
            ]
        )
        if (!opcion || opcion === 'cancelar') { renderTabla(); return }
        if (opcion === 'correcto') { await _guardarEdicion(rowId, { amount: pre.cuantiaCorrecta }); return }
        await _guardarEdicion(rowId, { amount: nuevoAmount })
        return
    }

    // ── Editando un prepago (is_final = false) ────────────────────────────
    const cuantiaFinalNueva = pre.cuantiaCorrecta + parseFloat(row.amount || 0) - nuevoAmount
    const hitoActual        = pre.hitoFinal
    const hitoPagado        = hitoActual && !!hitoActual.paid

    let titulo, desc
    if (!hitoActual) {
        titulo = 'Cambio de importe — prepago'
        desc   = Math.abs(cuantiaFinalNueva) < 0.01
            ? `Nuevo importe: <strong>${fmt(nuevoAmount)}</strong>. El saldo resultante es 0 — no se creará pago final ahora, pero se creará automáticamente cuando se edite algo desde el panel.`
            : `Nuevo importe: <strong>${fmt(nuevoAmount)}</strong>. Se creará un pago final de <strong>${fmt(cuantiaFinalNueva)}</strong> para ${row.provider_id}.`
    } else if (!hitoPagado) {
        titulo = 'Cambio de importe — prepago'
        desc   = `Nuevo importe: <strong>${fmt(nuevoAmount)}</strong>. El pago final de ${row.provider_id} pasará de <strong>${fmt(hitoActual.amount)}</strong> a <strong>${fmt(cuantiaFinalNueva)}</strong>.`
    } else {
        titulo = 'Cambio de importe — prepago'
        desc   = `Nuevo importe: <strong>${fmt(nuevoAmount)}</strong>. El pago final existente ya está <strong>pagado</strong> — se pasará a is_final=false automáticamente y se creará uno nuevo de <strong>${fmt(cuantiaFinalNueva)}</strong>.`
    }
    const opcion = await _modalOpciones(titulo, desc, [
        { label: 'Guardar y recalcular pago final', value: 'recalcular', clase: 'btn-primary' },
        { label: 'Cancelar — no cambiar nada',       value: 'cancelar',  clase: 'btn-secondary' },
        { label: 'Guardar solo este importe, sin recalcular ahora', value: 'solo', clase: 'btn-secondary' },
    ])
    if (!opcion || opcion === 'cancelar') { renderTabla(); return }

    const { error } = await supabase.from('payments').update({ amount: nuevoAmount }).eq('id', rowId)
    if (error) { alert(`Error al guardar: ${error.message}`); renderTabla(); return }
    if (opcion === 'solo') { await cargarTabla(); return }

    const [{ data: reservas }, { data: disponibilidad }] = await Promise.all([
        supabase.from('reservations').select('id, venue_id, service_id, status, slots'),
        supabase.from('availability').select('*')
    ])
    await persistirPagosProveedor(supabase, row.provider_id, reservas ?? [], disponibilidad ?? [])
    await cargarTabla()
}

async function _guardarSfcomSlots(rowId, nuevoValor, row) {
    if (nuevoValor === null) { renderTabla(); return }
    if (nuevoValor < (row.sfcom_slots_listed ?? 0)) {
        const { data: reservasSfcom } = await supabase
            .from('reservations')
            .select('slots')
            .eq('venue_id', row._venue_id)
            .eq('service_id', row._service_id)
            .neq('status', 'Cancelada')
            .like('origin_ref', 'WEB%')
        const vendidas = (reservasSfcom ?? []).reduce((s, r) => s + (r.slots ?? 0), 0)
        if (vendidas > 0 && nuevoValor < vendidas) {
            const continuar = await _confirmarModal(
                `⚠️ Estás reduciendo las plazas sfcom a ${nuevoValor}, pero ya hay ${vendidas} plaza${vendidas !== 1 ? 's' : ''} vendida${vendidas !== 1 ? 's' : ''} en sfcom.\n\n` +
                `El stock calculado quedará a 0. Las reservas confirmadas de sfcom no se modifican — seguirán activas.\n\n` +
                `Para cancelarlas, hazlo desde la pestaña Reservas.`
            )
            if (!continuar) { renderTabla(); return }
        }
    }
    await _guardarEdicion(rowId, { sfcom_slots_listed: nuevoValor })
}

// ===== C.2.B: EDICIÓN DE is_final EN COBROS Y PAGOS =====

async function _guardarIsFinalCobro(rowId, nuevoValor, row) {
    if (nuevoValor === row.is_final) { renderTabla(); return }

    const season = row.season ?? getTemporadaActiva()
    const pre    = await _preCalcularCobros(row.client_id, season)

    // ── true → false (convertir en adelanto) ─────────────────────────────
    if (!nuevoValor) {
        // El row pasa a adelanto → el nuevo saldo final = cuantiaCorrecta − este importe
        const cuantiaFinalNueva = pre.cuantiaCorrecta - parseFloat(row.amount || 0)
        const textoResultado = Math.abs(cuantiaFinalNueva) < 0.01
            ? `El saldo resultante es 0 — no se creará cobro final ahora, se creará automáticamente cuando se edite algo desde el panel.`
            : `El saldo resultante es <strong>${fmt(cuantiaFinalNueva)}</strong> — se creará un nuevo cobro final con ese importe.`
        const opcion = await _modalOpciones(
            'Convertir cobro final en adelanto',
            `El cobro de <strong>${fmt(row.amount)}</strong> dejará de ser el cobro final y pasará a ser un adelanto.<br><br>${textoResultado}`,
            [
                { label: 'Convertir en adelanto y recalcular',                       value: 'recalcular', clase: 'btn-primary' },
                { label: 'Cancelar — no cambiar nada',                               value: 'cancelar',   clase: 'btn-secondary' },
                { label: 'Convertir en adelanto solo el flag, sin recalcular ahora', value: 'solo',       clase: 'btn-secondary' },
            ]
        )
        if (!opcion || opcion === 'cancelar') { renderTabla(); return }
        const { error } = await supabase.from('charges').update({ is_final: false }).eq('id', rowId)
        if (error) { alert(`Error al guardar: ${error.message}`); renderTabla(); return }
        if (opcion === 'solo') { await cargarTabla(); return }
        const { data: reservas } = await supabase.from('reservations')
            .select('client_id, status, total_amount, origin_ref').eq('client_id', row.client_id)
        await persistirCobrosCliente(supabase, row.client_id, reservas ?? [])
        await cargarTabla()
        return
    }

    // ── false → true (convertir en cobro final) ───────────────────────────
    // Cuantía correcta excluyendo este row de adelantos y añadiendo el hitoFinal existente
    const hitoActual              = pre.hitoFinal  // existing is_final (otro row, no este)
    const cuantiaCorrectaPromocion = pre.cuantiaCorrecta
        + parseFloat(row.amount || 0)
        - parseFloat(hitoActual?.amount || 0)
    const coincide  = Math.abs(parseFloat(row.amount || 0) - cuantiaCorrectaPromocion) < 0.01
    const bloqueado = !!(row.invoiced || row.collected)

    if (!coincide && bloqueado) {
        alert(`Este cobro ya está ${row.invoiced ? 'facturado' : 'cobrado'} y su importe (${fmt(row.amount)}) no coincide con el saldo correcto (${fmt(cuantiaCorrectaPromocion)}). No puede marcarse como cobro final.`)
        renderTabla(); return
    }

    let desc = ''
    if (hitoActual) desc += `El cobro final actual de ${row.client_id} (${fmt(hitoActual.amount)}) pasará a ser adelanto.<br>`
    desc += coincide
        ? `El importe de este cobro (<strong>${fmt(row.amount)}</strong>) es correcto.`
        : `El importe correcto para este cobro final sería <strong>${fmt(cuantiaCorrectaPromocion)}</strong> (el actual es ${fmt(row.amount)}).`

    const opciones = coincide
        ? [
            { label: hitoActual ? 'Confirmar — convertir el otro en adelanto y marcar este como final' : 'Confirmar — marcar como cobro final', value: 'aceptar', clase: 'btn-primary' },
            { label: 'Cancelar', value: 'cancelar', clase: 'btn-secondary' },
          ]
        : [
            { label: `Marcar como final y corregir importe a ${fmt(cuantiaCorrectaPromocion)}`, value: 'corregir',   clase: 'btn-primary' },
            { label: 'Cancelar',                                                                 value: 'cancelar',  clase: 'btn-secondary' },
            { label: `Marcar como final con importe actual (${fmt(row.amount)}) — descuadre voluntario`, value: 'incorrecto', clase: 'btn-secondary' },
          ]

    const opcion = await _modalOpciones('Convertir cobro en cobro final', desc, opciones)
    if (!opcion || opcion === 'cancelar') { renderTabla(); return }

    if (hitoActual) {
        const { error: e1 } = await supabase.from('charges').update({ is_final: false }).eq('id', hitoActual.id)
        if (e1) { alert(`Error al convertir cobro existente en adelanto: ${e1.message}`); renderTabla(); return }
    }
    const updates = { is_final: true }
    if (opcion === 'corregir') updates.amount = cuantiaCorrectaPromocion
    const { error: e2 } = await supabase.from('charges').update(updates).eq('id', rowId)
    if (e2) { alert(`Error al guardar: ${e2.message}`); renderTabla(); return }

    if (opcion === 'incorrecto') { await cargarTabla(); return }

    const { data: reservas } = await supabase.from('reservations')
        .select('client_id, status, total_amount, origin_ref').eq('client_id', row.client_id)
    await persistirCobrosCliente(supabase, row.client_id, reservas ?? [])
    await cargarTabla()
}

async function _guardarIsFinalPago(rowId, nuevoValor, row) {
    if (nuevoValor === row.is_final) { renderTabla(); return }

    const season = row.season ?? getTemporadaActiva()
    const pre    = await _preCalcularPagos(row.provider_id, season)

    // ── true → false (convertir en adelanto) ─────────────────────────────
    if (!nuevoValor) {
        const cuantiaFinalNueva = pre.cuantiaCorrecta - parseFloat(row.amount || 0)
        const textoResultado = Math.abs(cuantiaFinalNueva) < 0.01
            ? `El saldo resultante es 0 — no se creará pago final ahora, se creará automáticamente cuando se edite algo desde el panel.`
            : `El saldo resultante es <strong>${fmt(cuantiaFinalNueva)}</strong> — se creará un nuevo pago final con ese importe.`
        const opcion = await _modalOpciones(
            'Convertir pago final en adelanto',
            `El pago de <strong>${fmt(row.amount)}</strong> dejará de ser el pago final y pasará a ser un adelanto.<br><br>${textoResultado}`,
            [
                { label: 'Convertir en adelanto y recalcular',                       value: 'recalcular', clase: 'btn-primary' },
                { label: 'Cancelar — no cambiar nada',                               value: 'cancelar',   clase: 'btn-secondary' },
                { label: 'Convertir en adelanto solo el flag, sin recalcular ahora', value: 'solo',       clase: 'btn-secondary' },
            ]
        )
        if (!opcion || opcion === 'cancelar') { renderTabla(); return }
        const { error } = await supabase.from('payments').update({ is_final: false }).eq('id', rowId)
        if (error) { alert(`Error al guardar: ${error.message}`); renderTabla(); return }
        if (opcion === 'solo') { await cargarTabla(); return }
        const [{ data: reservas }, { data: disponibilidad }] = await Promise.all([
            supabase.from('reservations').select('id, venue_id, service_id, status, slots'),
            supabase.from('availability').select('*')
        ])
        await persistirPagosProveedor(supabase, row.provider_id, reservas ?? [], disponibilidad ?? [])
        await cargarTabla()
        return
    }

    // ── false → true (convertir en pago final) ────────────────────────────
    const hitoActual              = pre.hitoFinal  // existing is_final (otro row, no este)
    const cuantiaCorrectaPromocion = pre.cuantiaCorrecta
        + parseFloat(row.amount || 0)
        - parseFloat(hitoActual?.amount || 0)
    const coincide  = Math.abs(parseFloat(row.amount || 0) - cuantiaCorrectaPromocion) < 0.01
    const bloqueado = !!row.paid

    if (!coincide && bloqueado) {
        alert(`Este pago ya está pagado y su importe (${fmt(row.amount)}) no coincide con el coste calculado (${fmt(cuantiaCorrectaPromocion)}). No puede marcarse como pago final.`)
        renderTabla(); return
    }

    let desc = ''
    if (hitoActual) desc += `El pago final actual de ${row.provider_id} (${fmt(hitoActual.amount)}) pasará a ser adelanto.<br>`
    desc += coincide
        ? `El importe de este pago (<strong>${fmt(row.amount)}</strong>) es correcto.`
        : `El importe correcto para este pago final sería <strong>${fmt(cuantiaCorrectaPromocion)}</strong> (el actual es ${fmt(row.amount)}).`

    const opciones = coincide
        ? [
            { label: hitoActual ? 'Confirmar — convertir el otro en adelanto y marcar este como final' : 'Confirmar — marcar como pago final', value: 'aceptar', clase: 'btn-primary' },
            { label: 'Cancelar', value: 'cancelar', clase: 'btn-secondary' },
          ]
        : [
            { label: `Marcar como final y corregir importe a ${fmt(cuantiaCorrectaPromocion)}`, value: 'corregir',   clase: 'btn-primary' },
            { label: 'Cancelar',                                                                 value: 'cancelar',  clase: 'btn-secondary' },
            { label: `Marcar como final con importe actual (${fmt(row.amount)}) — descuadre voluntario`, value: 'incorrecto', clase: 'btn-secondary' },
          ]

    const opcion = await _modalOpciones('Convertir pago en pago final', desc, opciones)
    if (!opcion || opcion === 'cancelar') { renderTabla(); return }

    if (hitoActual) {
        const { error: e1 } = await supabase.from('payments').update({ is_final: false }).eq('id', hitoActual.id)
        if (e1) { alert(`Error al convertir pago existente en adelanto: ${e1.message}`); renderTabla(); return }
    }
    const updates = { is_final: true }
    if (opcion === 'corregir') updates.amount = cuantiaCorrectaPromocion
    const { error: e2 } = await supabase.from('payments').update(updates).eq('id', rowId)
    if (e2) { alert(`Error al guardar: ${e2.message}`); renderTabla(); return }

    if (opcion === 'incorrecto') { await cargarTabla(); return }

    const [{ data: reservas }, { data: disponibilidad }] = await Promise.all([
        supabase.from('reservations').select('id, venue_id, service_id, status, slots'),
        supabase.from('availability').select('*')
    ])
    await persistirPagosProveedor(supabase, row.provider_id, reservas ?? [], disponibilidad ?? [])
    await cargarTabla()
}