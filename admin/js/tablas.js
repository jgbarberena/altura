import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { fmt, initSidebar, exportTable, abrirRenombrarId, persistirCobrosCliente, persistirPagosProveedor, getTemporadaActiva } from './utils.js'
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
            { label: 'Fecha prev.', campo: 'due_date' },
            { label: 'Cobrado',     campo: 'collected',
                fmt: (v, row) => v ? `✅ ${row.collected_date ?? ''}` : (row.due_date && row.due_date < hoy ? '❌ Vencido' : '⏳ No'),
                clase: (v, row) => v ? 'cobrado-si' : (row.due_date && row.due_date < hoy ? 'cobrado-vencido' : 'cobrado-no') },
            { label: 'Fecha cobro', campo: 'collected_date' },
            { label: 'Facturado',   campo: 'invoiced',        fmt: v => v ? 'Sí' : '—' },
            { label: 'Fecha fact.', campo: 'invoiced_at' },
            { label: 'Nº factura',  campo: 'invoice_number' },
            { label: 'Hito final',  campo: 'is_final',        fmt: v => v ? 'Sí' : 'No' },
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
            { label: 'Fecha prev.', campo: 'due_date' },
            { label: 'Pagado',      campo: 'paid',
                fmt: (v, row) => v ? `✅ ${row.paid_date ?? ''}` : (row.due_date && row.due_date < hoy ? '❌ Vencido' : '⏳ No'),
                clase: (v, row) => v ? 'cobrado-si' : (row.due_date && row.due_date < hoy ? 'cobrado-vencido' : 'cobrado-no') },
            { label: 'Fecha pago',  campo: 'paid_date' },
            { label: 'Hito final',  campo: 'is_final',   fmt: v => v ? 'Sí' : 'No' },
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
        amount:         { tipo: 'number', cascade: 'cobros',
                          guard: row => row.is_final ? 'El cobro final se calcula automáticamente desde las reservas activas. Para cambiar su importe, modifica las reservas en el formulario.' : null },
        due_date:       { tipo: 'date' },
        collected:      { tipo: 'boolean', pairedWith: 'collected_date', pairedLabel: 'cobrado' },
        collected_date: { tipo: 'date',    pairedWith: 'collected',      pairedLabel: 'cobrado' },
        invoiced:       { tipo: 'boolean' },
        invoiced_at:    { tipo: 'date' },
        invoice_number: { tipo: 'text' },
        invoice_path:   { tipo: 'text' },
        comments:       { tipo: 'textarea' },
    },
    payments: {
        amount:    { tipo: 'number', cascade: 'pagos',
                     guard: row => row.is_final ? 'El pago final se calcula automáticamente desde las reservas y la disponibilidad. Para cambiar su importe, modifica las reservas en el formulario.' : null },
        due_date:  { tipo: 'date' },
        paid:      { tipo: 'boolean', pairedWith: 'paid_date', pairedLabel: 'pagado' },
        paid_date: { tipo: 'date',    pairedWith: 'paid',      pairedLabel: 'pagado' },
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

        if (conf.cascade === 'cobros') {
            await _guardarAmountCobro(rowId, nuevoValor, row)
        } else if (conf.cascade === 'pagos') {
            await _guardarAmountPago(rowId, nuevoValor, row)
        } else if (conf.cascade === 'sfcom-slots') {
            await _guardarSfcomSlots(rowId, nuevoValor, row)
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

// ===== C.2.A: EDICIÓN DE IMPORTES CON CASCADA =====

async function _guardarAmountCobro(rowId, nuevoAmount, row) {
    if (nuevoAmount === null) { renderTabla(); return }
    const { error } = await supabase.from('charges').update({ amount: nuevoAmount }).eq('id', rowId)
    if (error) { alert(`Error al guardar: ${error.message}`); renderTabla(); return }

    const { data: reservas } = await supabase.from('reservations')
        .select('id, client_id, status, total_amount, origin_ref')
        .eq('client_id', row.client_id)
    await persistirCobrosCliente(supabase, row.client_id, reservas ?? [])
    await cargarTabla()
}

async function _guardarAmountPago(rowId, nuevoAmount, row) {
    if (nuevoAmount === null) { renderTabla(); return }
    const { error } = await supabase.from('payments').update({ amount: nuevoAmount }).eq('id', rowId)
    if (error) { alert(`Error al guardar: ${error.message}`); renderTabla(); return }

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