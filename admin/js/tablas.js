import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { fmt, initSidebar, exportTable, abrirRenombrarId, persistirCobrosCliente, persistirPagosProveedor, getTemporadaActiva, calcularSaldoCobro, calcularSaldoPago, calcularCostoPago, checkTrimCerrado, mostrarModalTrimCerrado, eliminarSupplierDoc } from './utils.js'
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
            { label: 'Bienvenida',  campo: 'welcome_sent_at', fmt: v => !v ? '—' : v.startsWith('0001-01-01') ? '⛔ No enviar' : new Date(v).toLocaleDateString('es-ES') },
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
        status:          { tipo: 'enum', cascade: 'status-reserva', opciones: [
            ['Pendiente', 'Pendiente'], ['Confirmada', 'Confirmada'], ['Cancelada', 'Cancelada']
        ]},
        slots:           { tipo: 'number', cascade: 'slots' },
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
        sfcom_service_name: { tipo: 'text' },
        sfcom_product_id:   { tipo: 'number' },
        sfcom_variation_id: { tipo: 'number' },
        sfcom_status: { tipo: 'enum', opciones: [
            [null, '—'], ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['deactivation_pending', 'Desactivación pendiente']
        ]},
        sfcom_public_price: { tipo: 'number' },
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
        if (tablaActual === 'archivos') {
            _mostrarStorage()
        } else {
            document.getElementById('btnExportTabla').style.display = ''
            cargarTabla()
        }
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
    if (tablaActual === 'archivos') { _mostrarStorage(); return }
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
                `).join('')}<th style="width:34px"></th></tr>
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
                    }).join('')}<td style="text-align:center;padding:0 2px"><button
                        style="font-size:11px;padding:1px 4px;cursor:pointer;background:none;border:1px solid var(--accent);border-radius:3px;color:var(--accent);line-height:1.4"
                        onclick="window._eliminarFila('${tablaActual}','${rowIdStr}')">🗑</button></td></tr>`
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

        if (conf.cascade === 'status-reserva') {
            await _guardarStatusReserva(rowId, nuevoValor, row)
        } else if (conf.cascade === 'slots') {
            await _guardarSlots(rowId, nuevoValor, row)
        } else if (conf.cascade === 'price-per-slot') {
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
            archivos.push({ name: item.name, path: item.name, size: item.metadata?.size, updated_at: item.updated_at })
        } else {
            const { data: sub } = await supabase.storage.from(bucket).list(item.name, { limit: 200, sortBy: { column: 'name', order: 'asc' } })
            if (!sub) continue
            for (const s of sub) {
                if (s.id) {
                    archivos.push({ name: s.name, path: `${item.name}/${s.name}`, size: s.metadata?.size, updated_at: s.updated_at })
                } else {
                    const { data: sub2 } = await supabase.storage.from(bucket).list(`${item.name}/${s.name}`, { limit: 200, sortBy: { column: 'name', order: 'asc' } })
                    if (sub2) sub2.filter(s2 => s2.id).forEach(s2 =>
                        archivos.push({ name: s2.name, path: `${item.name}/${s.name}/${s2.name}`, size: s2.metadata?.size, updated_at: s2.updated_at })
                    )
                }
            }
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
        supabase.from('sfcom_listings').select('sfcom_slots_listed').eq('availability_id', rowId).maybeSingle()
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
            .eq('availability_id', rowId)
        if (eSfc) console.error('Error actualizando sfcom_slots_listed:', eSfc)
        else await syncStockToSfcom(supabase, row.venue_id, row.service_id)
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

// ===== C.2.F: ESTADO DE RESERVA =====

async function _guardarStatusReserva(rowId, nuevoStatus, row) {
    if (!nuevoStatus || nuevoStatus === row.status) { renderTabla(); return }
    const esCancelacion  = nuevoStatus === 'Cancelada'
    const esReactivacion = row.status === 'Cancelada'
    const esWEB  = row.origin_ref?.startsWith('WEB')
    const season = row.services?.season ?? getTemporadaActiva()

    // Cambio simple entre estados activos: guardar sin más
    if (!esCancelacion && !esReactivacion) {
        await _guardarEdicion(rowId, { status: nuevoStatus })
        return
    }

    // Cancelación: bloquear si hay propuesta vinculada? No — la propuesta ya queda desvinculada al cambiar slots/precio
    // Reactivación: comprobar capacidad
    if (esReactivacion) {
        const [{ data: dispEntry }, { data: reservasVS }] = await Promise.all([
            supabase.from('availability').select('total_slots')
                .eq('venue_id', row.venue_id).eq('service_id', row.service_id).maybeSingle(),
            supabase.from('reservations').select('slots')
                .eq('venue_id', row.venue_id).eq('service_id', row.service_id).neq('status', 'Cancelada')
        ])
        const plazasActivas = (reservasVS ?? []).reduce((s, r) => s + (r.slots ?? 0), 0)
        const totalSlots    = dispEntry?.total_slots ?? 0
        if (plazasActivas + (row.slots ?? 0) > totalSlots) {
            await _modalOpciones('⛔ Sin capacidad',
                `No hay ${row.slots} plaza(s) libres para reactivar esta reserva (${plazasActivas}/${totalSlots} ocupadas).`,
                [{ label: 'Cerrar', value: 'cerrar', clase: 'btn-secondary' }])
            renderTabla(); return
        }
    }

    let desc
    if (esCancelacion) {
        desc = `La reserva <strong>${rowId}</strong> pasará a <strong>Cancelada</strong>.`
        if (esWEB) desc += `<br>El cobro sfcom (<code>${row.origin_ref} Cobrado vía sfcom</code>) se eliminará. Los cobros, pagos y stock sfcom se recalcularán.`
        else desc += `<br>Los cobros de ${row.client_id} y los pagos al proveedor se recalcularán.`
    } else {
        desc = `La reserva <strong>${rowId}</strong> se reactivará como <strong>${nuevoStatus}</strong>.`
        if (esWEB) desc += `<br>Se recreará el cobro sfcom de <strong>${fmt(row.total_amount)}</strong>. Los cobros, pagos y stock sfcom se recalcularán.`
        else desc += `<br>Los cobros de ${row.client_id} y los pagos al proveedor se recalcularán.`
    }

    const opcion = await _modalOpciones(
        esCancelacion ? 'Cancelar reserva' : 'Reactivar reserva',
        desc,
        [
            { label: esCancelacion ? 'Sí, cancelar' : 'Sí, reactivar', value: 'ejecutar', clase: esCancelacion ? 'btn-danger' : 'btn-primary' },
            { label: 'No cambiar', value: 'cancelar', clase: 'btn-secondary' }
        ]
    )
    if (!opcion || opcion === 'cancelar') { renderTabla(); return }

    if (esCancelacion && esWEB) {
        await supabase.from('charges').delete()
            .eq('client_id', row.client_id)
            .eq('comments', `${row.origin_ref} Cobrado vía sfcom`)
    }

    const { error } = await supabase.from('reservations').update({ status: nuevoStatus }).eq('id', rowId)
    if (error) { alert(`Error al guardar: ${error.message}`); renderTabla(); return }

    if (esReactivacion && esWEB) {
        await supabase.from('charges').insert({
            client_id: row.client_id, amount: row.total_amount,
            due_date: hoy, collected: true, collected_date: hoy,
            comments: `${row.origin_ref} Cobrado vía sfcom`,
            is_final: false, season
        })
    }

    const { data: reservasCli } = await supabase.from('reservations')
        .select('client_id, status, total_amount, origin_ref').eq('client_id', row.client_id)
    await persistirCobrosCliente(supabase, row.client_id, reservasCli ?? [])
    if (esWEB) {
        const { data: todasRsAll } = await supabase.from('reservations')
            .select('client_id, status, total_amount, origin_ref')
        await persistirCobrosCliente(supabase, 'SFCOM', todasRsAll ?? [])
    }

    const { data: venue } = await supabase.from('venues').select('provider_id').eq('id', row.venue_id).single()
    if (venue?.provider_id) {
        const [{ data: rsFresh }, { data: dispFresh }] = await Promise.all([
            supabase.from('reservations').select('id, venue_id, service_id, status, slots'),
            supabase.from('availability').select('*')
        ])
        await persistirPagosProveedor(supabase, venue.provider_id, rsFresh ?? [], dispFresh ?? [])
    }

    await syncStockToSfcom(supabase, row.venue_id, row.service_id)
    await cargarTabla()
}

// ===== C.2.E: PLAZAS EN RESERVAS =====

async function _guardarSlots(rowId, nuevoSlots, row) {
    if (nuevoSlots === null || nuevoSlots < 0) { renderTabla(); return }
    if (nuevoSlots === row.slots) { renderTabla(); return }
    const esWEB  = row.origin_ref?.startsWith('WEB')
    const season = row.services?.season ?? getTemporadaActiva()
    const nuevoTotal  = nuevoSlots * parseFloat(row.price_per_slot || 0)
    const deltaCobros = nuevoTotal - parseFloat(row.total_amount || 0)

    const [{ data: dispEntry }, { data: reservasVS }, { data: venue }] = await Promise.all([
        supabase.from('availability').select('*').eq('venue_id', row.venue_id).eq('service_id', row.service_id).maybeSingle(),
        supabase.from('reservations').select('id, slots, origin_ref, status').eq('venue_id', row.venue_id).eq('service_id', row.service_id).neq('status', 'Cancelada'),
        supabase.from('venues').select('provider_id').eq('id', row.venue_id).single()
    ])
    const { data: sfcomEntry } = await supabase.from('sfcom_listings')
        .select('sfcom_slots_listed').eq('availability_id', dispEntry?.id).maybeSingle()

    // Comprobación de capacidad (solo si aumentamos plazas)
    if (nuevoSlots > row.slots) {
        const plazasOtras = (reservasVS ?? []).filter(r => String(r.id) !== String(rowId)).reduce((s, r) => s + (r.slots ?? 0), 0)
        const capacidadDisponible = (dispEntry?.total_slots ?? 0) - plazasOtras
        if (nuevoSlots > capacidadDisponible) {
            await _modalOpciones('⛔ Sin capacidad',
                `Solo hay <strong>${capacidadDisponible}</strong> plaza${capacidadDisponible !== 1 ? 's' : ''} disponibles para esta venue+servicio.`,
                [{ label: 'Cerrar', value: 'cerrar', clase: 'btn-secondary' }])
            renderTabla(); return
        }
    }

    // Precálculo cobros (solo para reservas no-WEB%)
    let pre = null
    if (!esWEB) pre = await _preCalcularCobros(row.client_id, season)

    // Precálculo pagos
    const providerId = venue?.provider_id
    let costActual = null, costNuevo = null, cuantPagoActual = null, hitoPago = null
    if (providerId) {
        const [{ data: venuesProv }, { data: todasRsPago }, { data: todasDisp }, { data: payments }] = await Promise.all([
            supabase.from('venues').select('id').eq('provider_id', providerId),
            supabase.from('reservations').select('id, venue_id, service_id, status, slots'),
            supabase.from('availability').select('*'),
            supabase.from('payments').select('*').eq('provider_id', providerId).eq('season', season)
        ])
        const venueIds = new Set((venuesProv ?? []).map(v => v.id))
        ;({ costTotal: costActual, cuantiaCorrecta: cuantPagoActual, hitoFinal: hitoPago } =
            calcularSaldoPago(venueIds, todasRsPago ?? [], todasDisp ?? [], payments ?? []))
        const todasRsMod = (todasRsPago ?? []).map(r => String(r.id) === String(rowId) ? { ...r, slots: nuevoSlots } : r)
        costNuevo = calcularCostoPago(venueIds, todasRsMod, todasDisp ?? [])
    }

    // Nota de overflow sfcom (informativa — la fórmula MAX(0,...) lo gestiona sin bloqueo)
    const sfcomListados    = sfcomEntry?.sfcom_slots_listed ?? 0
    const plazasWebActivas = (reservasVS ?? []).filter(r => r.origin_ref?.startsWith('WEB')).reduce((s, r) => s + (r.slots ?? 0), 0)
    const sfcomOverflow    = esWEB && (nuevoSlots > row.slots) && sfcomEntry && ((nuevoSlots - row.slots) > (sfcomListados - plazasWebActivas))

    const propuestaAviso = (row.proposal_number || row.proposal_path)
        ? `<br>⚠️ La propuesta <strong>${row.proposal_number ?? 'sin número'}</strong> quedará desvinculada.`
        : ''

    let desc = ''
    if (esWEB) {
        const signo = deltaCobros > 0 ? '+' : ''
        desc = `⚠️ Reserva sfcom (<code>${row.origin_ref}</code>).<br>Plazas a <strong>${nuevoSlots}</strong>. El total cambia a <strong>${fmt(nuevoTotal)}</strong>.`
        if (Math.abs(deltaCobros) >= 0.01)
            desc += `<br>Se añadirá un cobro de ajuste de <strong>${signo}${fmt(deltaCobros)}</strong> en la ficha de ${row.client_id} (ya cobrado vía sfcom). El cobro final de sfcom se ajustará automáticamente.`
    } else {
        const nuevaCuantiaCorrecta = (pre?.cuantiaCorrecta ?? 0) + deltaCobros
        const hitoCobro   = pre?.hitoFinal
        const hitoCobBloq = hitoCobro && !!(hitoCobro.invoice_number || hitoCobro.collected)
        if (Math.abs(deltaCobros) < 0.01) {
            desc = `Plazas actualizadas a <strong>${nuevoSlots}</strong>. El total de la reserva no cambia.`
        } else if (!hitoCobro) {
            desc = Math.abs(nuevaCuantiaCorrecta) < 0.01
                ? `Plazas a <strong>${nuevoSlots}</strong>. El total cambia a <strong>${fmt(nuevoTotal)}</strong>. El saldo resultante es 0.`
                : `Plazas a <strong>${nuevoSlots}</strong>. El total cambia a <strong>${fmt(nuevoTotal)}</strong>. Se creará un cobro final de <strong>${fmt(nuevaCuantiaCorrecta)}</strong> para ${row.client_id}.`
        } else if (!hitoCobBloq) {
            desc = `Plazas a <strong>${nuevoSlots}</strong>. El total cambia a <strong>${fmt(nuevoTotal)}</strong>. El cobro final de ${row.client_id} pasará de <strong>${fmt(hitoCobro.amount)}</strong> a <strong>${fmt(nuevaCuantiaCorrecta)}</strong>.`
        } else {
            const motivo = hitoCobro.invoice_number ? 'facturado' : 'cobrado'
            const ajuste = nuevaCuantiaCorrecta - parseFloat(hitoCobro.amount)
            desc = `Plazas a <strong>${nuevoSlots}</strong>. El total cambia a <strong>${fmt(nuevoTotal)}</strong>. El cobro final ya está <strong>${motivo}</strong> — se pasará a adelanto y se creará un hito de ajuste de <strong>${fmt(ajuste)}</strong>.`
        }
    }

    if (costNuevo !== null && Math.abs(costNuevo - costActual) >= 0.01) {
        const nuevaCuantPago = (cuantPagoActual ?? 0) + (costNuevo - costActual)
        const hitoPagoBloq   = hitoPago && !!hitoPago.paid
        if (!hitoPago) {
            desc += Math.abs(nuevaCuantPago) < 0.01
                ? `<br>El coste de ${providerId} cambia a <strong>${fmt(costNuevo)}</strong>. El saldo resultante es 0.`
                : `<br>El coste de ${providerId} cambia a <strong>${fmt(costNuevo)}</strong>. Se creará un pago final de <strong>${fmt(nuevaCuantPago)}</strong>.`
        } else if (!hitoPagoBloq) {
            desc += `<br>El coste de ${providerId} cambia a <strong>${fmt(costNuevo)}</strong>. El pago final pasará de <strong>${fmt(hitoPago.amount)}</strong> a <strong>${fmt(nuevaCuantPago)}</strong>.`
        } else {
            const ajustePago = nuevaCuantPago - parseFloat(hitoPago.amount)
            desc += `<br>El coste de ${providerId} cambia a <strong>${fmt(costNuevo)}</strong>. El pago final ya está pagado — se pasará a adelanto y se creará un hito de ajuste de <strong>${fmt(ajustePago)}</strong>.`
        }
    }

    if (sfcomOverflow) {
        const plazasWebNuevas = plazasWebActivas - row.slots + nuevoSlots
        desc += `<br>Nota: sfcom tenía <strong>${sfcomListados}</strong> plaza${sfcomListados !== 1 ? 's' : ''} listadas pero quedarán <strong>${plazasWebNuevas}</strong> vendidas vía sfcom. El stock en sfcom se quedará a 0 — las plazas siguen dentro de la capacidad total.`
    }
    desc += propuestaAviso

    const hayImpacto = Math.abs(deltaCobros) >= 0.01 || (costNuevo !== null && Math.abs(costNuevo - costActual) >= 0.01)
    const opcion = await _modalOpciones('Cambio de plazas', desc,
        hayImpacto
            ? [
                { label: 'Guardar y recalcular',                          value: 'recalcular', clase: 'btn-primary' },
                { label: 'Cancelar — no cambiar nada',                    value: 'cancelar',   clase: 'btn-secondary' },
                { label: 'Guardar solo las plazas, sin recalcular ahora', value: 'solo',       clase: 'btn-secondary' },
              ]
            : [
                { label: 'Guardar',  value: 'recalcular', clase: 'btn-primary' },
                { label: 'Cancelar', value: 'cancelar',   clase: 'btn-secondary' },
              ]
    )
    if (!opcion || opcion === 'cancelar') { renderTabla(); return }

    const { error } = await supabase.from('reservations').update({ slots: nuevoSlots }).eq('id', rowId)
    if (error) { alert(`Error al guardar: ${error.message}`); renderTabla(); return }
    await _limpiarPropuestaReserva(row)
    if (opcion === 'solo') { await cargarTabla(); return }

    if (esWEB && Math.abs(deltaCobros) >= 0.01) {
        const { error: errAdj } = await supabase.from('charges').insert({
            client_id: row.client_id, amount: deltaCobros, due_date: hoy,
            collected: true, collected_date: hoy,
            comments: `${row.origin_ref} Cobrado vía sfcom`,
            is_final: false, season
        })
        if (errAdj) { alert(`Error al crear cobro de ajuste: ${errAdj.message}`); renderTabla(); return }
    }

    const { data: reservasCli } = await supabase.from('reservations')
        .select('client_id, status, total_amount, origin_ref').eq('client_id', row.client_id)
    await persistirCobrosCliente(supabase, row.client_id, reservasCli ?? [])
    if (esWEB) {
        const { data: todasRsAll } = await supabase.from('reservations')
            .select('client_id, status, total_amount, origin_ref')
        await persistirCobrosCliente(supabase, 'SFCOM', todasRsAll ?? [])
    }

    if (providerId) {
        const [{ data: rsFresh }, { data: dispFresh }] = await Promise.all([
            supabase.from('reservations').select('id, venue_id, service_id, status, slots'),
            supabase.from('availability').select('*')
        ])
        await persistirPagosProveedor(supabase, providerId, rsFresh ?? [], dispFresh ?? [])
    }

    if (sfcomEntry) await syncStockToSfcom(supabase, row.venue_id, row.service_id)

    await cargarTabla()
}

// ===== C.2.C: PRECIO POR PLAZA EN RESERVAS =====

async function _guardarPricePerSlot(rowId, nuevoPrice, row) {
    if (nuevoPrice === null) { renderTabla(); return }
    const season = row.services?.season ?? getTemporadaActiva()
    const esWEB  = row.origin_ref?.startsWith('WEB')

    const nuevaTotalReserva = row.slots * nuevoPrice
    const deltaCobros       = nuevaTotalReserva - parseFloat(row.total_amount || 0)

    // Sin cambio real en el total → guardar sin cascada ni aviso
    if (Math.abs(deltaCobros) < 0.01) {
        await _guardarEdicion(rowId, { price_per_slot: nuevoPrice })
        return
    }

    const propuestaAviso = (row.proposal_number || row.proposal_path)
        ? `<br><br>⚠️ La propuesta <strong>${row.proposal_number ?? 'sin número'}</strong> vinculada a esta reserva quedará desvinculada de todas las reservas que la comparten.`
        : ''

    let desc
    if (esWEB) {
        const signo = deltaCobros > 0 ? '+' : ''
        desc = `⚠️ Reserva sfcom (<code>${row.origin_ref}</code>). €/plaza a <strong>${fmt(nuevoPrice)}</strong>. El total cambia a <strong>${fmt(nuevaTotalReserva)}</strong>.`
        desc += `<br>Se añadirá un cobro de ajuste de <strong>${signo}${fmt(deltaCobros)}</strong> en la ficha de ${row.client_id} (ya cobrado vía sfcom). El cobro final de sfcom se ajustará automáticamente.`
    } else {
        const pre = await _preCalcularCobros(row.client_id, season)
        const nuevaCuantiaCorrecta = pre.cuantiaCorrecta + deltaCobros
        const hitoActual           = pre.hitoFinal
        const hitoBloqueado        = hitoActual && !!(hitoActual.invoice_number || hitoActual.collected)

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

    if (esWEB && Math.abs(deltaCobros) >= 0.01) {
        const { error: errAdj } = await supabase.from('charges').insert({
            client_id: row.client_id, amount: deltaCobros, due_date: hoy,
            collected: true, collected_date: hoy,
            comments: `${row.origin_ref} Cobrado vía sfcom`,
            is_final: false, season
        })
        if (errAdj) { alert(`Error al crear cobro de ajuste: ${errAdj.message}`); renderTabla(); return }
    }

    const { data: reservasCli } = await supabase.from('reservations')
        .select('client_id, status, total_amount, origin_ref').eq('client_id', row.client_id)
    await persistirCobrosCliente(supabase, row.client_id, reservasCli ?? [])
    if (esWEB) {
        const { data: todasRsAll } = await supabase.from('reservations')
            .select('client_id, status, total_amount, origin_ref')
        await persistirCobrosCliente(supabase, 'SFCOM', todasRsAll ?? [])
    }
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

// ===== ELIMINACIONES =====

window._eliminarFila = async (tabla, rowId) => {
    const row = datosRaw.find(r => String(r.id) === String(rowId))
    if (!row) return
    switch (tabla) {
        case 'reservations':         return _eliminarReserva(rowId, row)
        case 'reservation_requests': return _eliminarSolicitud(rowId)
        case 'charges':              return _eliminarCobro(rowId, row)
        case 'payments':             return _eliminarPago(rowId, row)
        case 'clients':              return _eliminarCliente(rowId, row)
        case 'venues':               return _eliminarVenue(rowId, row)
        case 'providers':            return _eliminarProveedor(rowId, row)
        case 'availability':         return _eliminarAvailability(rowId, row)
        case 'services':             return _eliminarServicio(rowId, row)
        case 'sfcom_listings':       return _eliminarSfcomListing(rowId, row)
    }
}

async function _eliminarReserva(rowId, row) {
    const esWEB  = row.origin_ref?.startsWith('WEB')
    const season = row.services?.season ?? getTemporadaActiva()

    let desc = `Eliminar reserva <strong>${rowId}</strong> de <strong>${row.client_id}</strong>.<br>
        ${row.slots} plaza(s) · Total: <strong>${fmt(row.total_amount)}</strong> · Estado: ${row.status}.`
    if (esWEB) desc += `<br>⚠️ Reserva sfcom (<code>${row.origin_ref}</code>). Se eliminarán los cobros de sfcom asociados.`
    desc += `<br>Los cobros del cliente y los pagos al proveedor se recalcularán.`

    const opcion = await _modalOpciones('Eliminar reserva', desc, [
        { label: 'Sí, eliminar', value: 'ejecutar', clase: 'btn-danger' },
        { label: 'Cancelar',     value: 'cancelar', clase: 'btn-secondary' }
    ])
    if (!opcion || opcion === 'cancelar') return

    if (esWEB) {
        await supabase.from('charges').delete()
            .eq('client_id', row.client_id)
            .eq('comments', `${row.origin_ref} Cobrado vía sfcom`)
    }

    const { error } = await supabase.from('reservations').delete().eq('id', rowId)
    if (error) { alert(`Error al eliminar: ${error.message}`); await cargarTabla(); return }

    const { data: reservasCli } = await supabase.from('reservations')
        .select('client_id, status, total_amount, origin_ref').eq('client_id', row.client_id)
    await persistirCobrosCliente(supabase, row.client_id, reservasCli ?? [])
    if (esWEB) {
        const { data: todasRsAll } = await supabase.from('reservations')
            .select('client_id, status, total_amount, origin_ref')
        await persistirCobrosCliente(supabase, 'SFCOM', todasRsAll ?? [])
    }

    const { data: venue } = await supabase.from('venues').select('provider_id').eq('id', row.venue_id).single()
    if (venue?.provider_id) {
        const [{ data: rsFresh }, { data: dispFresh }] = await Promise.all([
            supabase.from('reservations').select('id, venue_id, service_id, status, slots'),
            supabase.from('availability').select('*')
        ])
        await persistirPagosProveedor(supabase, venue.provider_id, rsFresh ?? [], dispFresh ?? [])
    }

    await syncStockToSfcom(supabase, row.venue_id, row.service_id)
    await cargarTabla()
}

async function _eliminarSolicitud(rowId) {
    const opcion = await _modalOpciones('Eliminar solicitud',
        '¿Eliminar esta solicitud? La acción es irreversible.',
        [
            { label: 'Sí, eliminar', value: 'ejecutar', clase: 'btn-danger' },
            { label: 'Cancelar',     value: 'cancelar', clase: 'btn-secondary' }
        ])
    if (!opcion || opcion === 'cancelar') return
    const { error } = await supabase.from('reservation_requests').delete().eq('id', rowId)
    if (error) { alert(`Error al eliminar: ${error.message}`); return }
    await cargarTabla()
}

async function _eliminarCobro(rowId, row) {
    if (row.comments?.includes('Cobrado vía sfcom')) {
        await _modalOpciones('⛔ Cobro sfcom',
            'Este cobro es un registro de sfcom. Cancela la reserva correspondiente para eliminarlo.',
            [{ label: 'Cerrar', value: 'ok', clase: 'btn-secondary' }])
        return
    }

    if (row.invoice_number) {
        const { data: issued } = await supabase
            .from('issued_invoices')
            .select('id, accrual_date, file_path')
            .eq('charge_id', rowId).eq('is_void', false).maybeSingle()

        if (issued) {
            const trim = await checkTrimCerrado(supabase, issued.accrual_date)
            if (trim.cerrado) { mostrarModalTrimCerrado(trim.year, trim.quarter); return }
            const opcion = await _modalOpciones('Eliminar cobro facturado',
                `Se borrará el cobro de <strong>${fmt(row.amount)}</strong>, su factura del libro fiscal (<strong>${row.invoice_number}</strong>) y el PDF de almacenamiento.<br>⚠️ Esta acción no se puede deshacer.`,
                [
                    { label: 'Sí, eliminar', value: 'ejecutar', clase: 'btn-danger' },
                    { label: 'Cancelar',     value: 'cancelar', clase: 'btn-secondary' }
                ])
            if (!opcion || opcion === 'cancelar') return
            if (issued.file_path) await supabase.storage.from('invoices').remove([issued.file_path])
        } else {
            const opcion = await _modalOpciones('Eliminar cobro',
                `Se borrará el cobro de <strong>${fmt(row.amount)}</strong>${row.invoice_path ? ' y su PDF asociado' : ''}.`,
                [
                    { label: 'Sí, eliminar', value: 'ejecutar', clase: 'btn-danger' },
                    { label: 'Cancelar',     value: 'cancelar', clase: 'btn-secondary' }
                ])
            if (!opcion || opcion === 'cancelar') return
            if (row.invoice_path) await supabase.storage.from('invoices').remove([row.invoice_path])
        }

        const { error: errDel } = await supabase.from('charges').delete().eq('id', rowId)
        if (errDel) { alert(`Error al eliminar: ${errDel.message}`); return }

        const { data: reservasCli } = await supabase.from('reservations')
            .select('client_id, status, total_amount, origin_ref').eq('client_id', row.client_id)
        await persistirCobrosCliente(supabase, row.client_id, reservasCli ?? [])
        await cargarTabla()
        return
    }

    let desc = `Eliminar cobro de <strong>${fmt(row.amount)}</strong> de ${row.client_id}.`
    if (row.collected) desc += '<br>⚠️ Este cobro ya fue recibido.'
    const opcion = await _modalOpciones('Eliminar cobro', desc, [
        { label: 'Sí, eliminar', value: 'ejecutar', clase: row.collected ? 'btn-danger' : 'btn-primary' },
        { label: 'Cancelar',     value: 'cancelar', clase: 'btn-secondary' }
    ])
    if (!opcion || opcion === 'cancelar') return

    const { error } = await supabase.from('charges').delete().eq('id', rowId)
    if (error) { alert(`Error al eliminar: ${error.message}`); return }

    const { data: reservasCli } = await supabase.from('reservations')
        .select('client_id, status, total_amount, origin_ref').eq('client_id', row.client_id)
    await persistirCobrosCliente(supabase, row.client_id, reservasCli ?? [])
    await cargarTabla()
}

async function _eliminarPago(rowId, row) {
    let desc = `Eliminar pago de <strong>${fmt(row.amount)}</strong> a ${row.provider_id}.`
    if (row.paid) desc += '<br>⚠️ Este pago ya fue realizado. Quedará sin registro.'
    const opcion = await _modalOpciones('Eliminar pago', desc, [
        { label: 'Sí, eliminar', value: 'ejecutar', clase: row.paid ? 'btn-danger' : 'btn-primary' },
        { label: 'Cancelar',     value: 'cancelar', clase: 'btn-secondary' }
    ])
    if (!opcion || opcion === 'cancelar') return

    const { error } = await supabase.from('payments').delete().eq('id', rowId)
    if (error) { alert(`Error al eliminar: ${error.message}`); return }

    const [{ data: rsFresh }, { data: dispFresh }] = await Promise.all([
        supabase.from('reservations').select('id, venue_id, service_id, status, slots'),
        supabase.from('availability').select('*')
    ])
    await persistirPagosProveedor(supabase, row.provider_id, rsFresh ?? [], dispFresh ?? [])
    await cargarTabla()
}

async function _eliminarCliente(rowId, row) {
    const [{ data: reservas }, { data: cobros }] = await Promise.all([
        supabase.from('reservations').select('id').eq('client_id', rowId),
        supabase.from('charges').select('id').eq('client_id', rowId)
    ])
    if (reservas?.length || cobros?.length) {
        const partes = []
        if (reservas?.length) partes.push(`${reservas.length} reserva(s)`)
        if (cobros?.length)   partes.push(`${cobros.length} cobro(s)`)
        await _modalOpciones('⛔ No se puede eliminar',
            `El cliente <strong>${rowId}</strong> tiene ${partes.join(' y ')}. Elimínalos antes.`,
            [{ label: 'Cerrar', value: 'ok', clase: 'btn-secondary' }])
        return
    }
    const opcion = await _modalOpciones('Eliminar cliente',
        `¿Eliminar el cliente <strong>${rowId}</strong>?`,
        [
            { label: 'Sí, eliminar', value: 'ejecutar', clase: 'btn-danger' },
            { label: 'Cancelar',     value: 'cancelar', clase: 'btn-secondary' }
        ])
    if (!opcion || opcion === 'cancelar') return
    const { error } = await supabase.from('clients').delete().eq('id', rowId)
    if (error) { alert(`Error al eliminar: ${error.message}`); return }
    await cargarTabla()
}

async function _eliminarVenue(rowId, row) {
    const { data: reservasActivas } = await supabase.from('reservations')
        .select('id').eq('venue_id', rowId).neq('status', 'Cancelada')
    if (reservasActivas?.length) {
        await _modalOpciones('⛔ Tiene reservas activas',
            `<strong>${rowId}</strong> tiene <strong>${reservasActivas.length} reserva(s) activa(s)</strong>. Cancélalas antes de eliminar la venue.`,
            [{ label: 'Cerrar', value: 'ok', clase: 'btn-secondary' }])
        return
    }
    const opcion = await _modalOpciones('Eliminar venue',
        `¿Eliminar <strong>${rowId}</strong>?<br>Se eliminarán también sus entradas de disponibilidad y sfcom. Los pagos al proveedor se recalcularán.`,
        [
            { label: 'Sí, eliminar', value: 'ejecutar', clase: 'btn-danger' },
            { label: 'Cancelar',     value: 'cancelar', clase: 'btn-secondary' }
        ])
    if (!opcion || opcion === 'cancelar') return

    const providerId = row.provider_id
    const { error } = await supabase.from('venues').delete().eq('id', rowId)
    if (error) { alert(`Error al eliminar: ${error.message}`); return }

    if (providerId) {
        const [{ data: rsFresh }, { data: dispFresh }] = await Promise.all([
            supabase.from('reservations').select('id, venue_id, service_id, status, slots'),
            supabase.from('availability').select('*')
        ])
        await persistirPagosProveedor(supabase, providerId, rsFresh ?? [], dispFresh ?? [])
    }
    await cargarTabla()
}

async function _eliminarProveedor(rowId, row) {
    const { data: venues } = await supabase.from('venues').select('id').eq('provider_id', rowId)
    if (venues?.length) {
        await _modalOpciones('⛔ Tiene venues',
            `<strong>${rowId}</strong> tiene <strong>${venues.length} venue(s)</strong>. Elimínalas primero.`,
            [{ label: 'Cerrar', value: 'ok', clase: 'btn-secondary' }])
        return
    }
    const { data: payments } = await supabase.from('payments').select('id').eq('provider_id', rowId)
    if (payments?.length) {
        await _modalOpciones('⛔ Tiene pagos',
            `<strong>${rowId}</strong> tiene <strong>${payments.length} pago(s)</strong>. Elimínalos primero.`,
            [{ label: 'Cerrar', value: 'ok', clase: 'btn-secondary' }])
        return
    }
    const [{ data: supplierInvoices }, { data: supplierDocs }] = await Promise.all([
        supabase.from('supplier_invoices').select('id').eq('provider_id', rowId),
        supabase.from('supplier_documents').select('id').eq('provider_id', rowId)
    ])
    const nFacturas = supplierInvoices?.length ?? 0
    const nDocs     = supplierDocs?.length ?? 0

    let msgAviso = ''
    if (nFacturas || nDocs) {
        const partes = []
        if (nFacturas) partes.push(`${nFacturas} asiento(s) en el libro fiscal`)
        if (nDocs)     partes.push(`${nDocs} documento(s) de gasto`)
        msgAviso = `<br><br>⚠️ Este proveedor tiene ${partes.join(' y ')}. Al eliminarlo quedarán sin proveedor asignado pero permanecerán en el libro fiscal.`
    }

    const opcion = await _modalOpciones('Eliminar proveedor',
        `¿Eliminar el proveedor <strong>${rowId}</strong>?${msgAviso}`,
        [
            { label: 'Sí, eliminar', value: 'ejecutar', clase: 'btn-danger' },
            { label: 'Cancelar',     value: 'cancelar', clase: 'btn-secondary' }
        ])
    if (!opcion || opcion === 'cancelar') return

    if (nFacturas) await supabase.from('supplier_invoices').update({ provider_id: null }).eq('provider_id', rowId)
    if (nDocs)     await supabase.from('supplier_documents').update({ provider_id: null }).eq('provider_id', rowId)

    const { error } = await supabase.from('providers').delete().eq('id', rowId)
    if (error) { alert(`Error al eliminar: ${error.message}`); return }
    await cargarTabla()
}

async function _eliminarAvailability(rowId, row) {
    const { data: reservasActivas } = await supabase.from('reservations')
        .select('id').eq('venue_id', row.venue_id).eq('service_id', row.service_id).neq('status', 'Cancelada')
    if (reservasActivas?.length) {
        await _modalOpciones('⛔ Tiene reservas activas',
            `Esta disponibilidad tiene <strong>${reservasActivas.length} reserva(s) activa(s)</strong>. Cancélalas antes.`,
            [{ label: 'Cerrar', value: 'ok', clase: 'btn-secondary' }])
        return
    }
    const serviceLabel = row.services?.service_code ?? row.service_id
    const opcion = await _modalOpciones('Eliminar disponibilidad',
        `¿Eliminar la disponibilidad de <strong>${row.venue_id}</strong> para <strong>${serviceLabel}</strong>?<br>
        Se eliminará también su entrada en sfcom si existe. Los pagos al proveedor se recalcularán.`,
        [
            { label: 'Sí, eliminar', value: 'ejecutar', clase: 'btn-danger' },
            { label: 'Cancelar',     value: 'cancelar', clase: 'btn-secondary' }
        ])
    if (!opcion || opcion === 'cancelar') return

    const { data: venue } = await supabase.from('venues').select('provider_id').eq('id', row.venue_id).single()
    const { error } = await supabase.from('availability').delete().eq('id', rowId)
    if (error) { alert(`Error al eliminar: ${error.message}`); return }

    if (venue?.provider_id) {
        const [{ data: rsFresh }, { data: dispFresh }] = await Promise.all([
            supabase.from('reservations').select('id, venue_id, service_id, status, slots'),
            supabase.from('availability').select('*')
        ])
        await persistirPagosProveedor(supabase, venue.provider_id, rsFresh ?? [], dispFresh ?? [])
    }
    await cargarTabla()
}

async function _eliminarServicio(rowId, row) {
    const { data: availRows } = await supabase.from('availability').select('id').eq('service_id', rowId)
    if (availRows?.length) {
        await _modalOpciones('⛔ Tiene disponibilidad',
            `El servicio <strong>${row.service_code}</strong> tiene <strong>${availRows.length} entrada(s) de disponibilidad</strong>. Elimínalas antes.`,
            [{ label: 'Cerrar', value: 'ok', clase: 'btn-secondary' }])
        return
    }
    const opcion = await _modalOpciones('Eliminar servicio',
        `¿Eliminar el servicio <strong>${row.service_code}</strong> (temporada ${row.season})?`,
        [
            { label: 'Sí, eliminar', value: 'ejecutar', clase: 'btn-danger' },
            { label: 'Cancelar',     value: 'cancelar', clase: 'btn-secondary' }
        ])
    if (!opcion || opcion === 'cancelar') return
    const { error } = await supabase.from('services').delete().eq('id', rowId)
    if (error) { alert(`Error al eliminar: ${error.message}`); return }
    await cargarTabla()
}

async function _eliminarSfcomListing(rowId, row) {
    const nombre = row.sfcom_service_name ?? `${row._venue_id} / ${row._service_code}`
    const opcion = await _modalOpciones('Eliminar listado sfcom',
        `¿Eliminar el listado de <strong>${nombre}</strong>?<br>
        ⚠️ El stock en sfcom no se actualizará. Si el producto sigue publicado, contacta con Hilario.`,
        [
            { label: 'Sí, eliminar', value: 'ejecutar', clase: 'btn-danger' },
            { label: 'Cancelar',     value: 'cancelar', clase: 'btn-secondary' }
        ])
    if (!opcion || opcion === 'cancelar') return
    const { error } = await supabase.from('sfcom_listings').delete().eq('id', rowId)
    if (error) { alert(`Error al eliminar: ${error.message}`); return }
    await cargarTabla()
}

// ===== STORAGE =====

let _storageSeccion = 'proposals'

async function _mostrarStorage() {
    document.getElementById('tabla-titulo').textContent = 'Archivos en Storage'
    document.getElementById('tabla-count').textContent  = ''
    document.getElementById('btnExportTabla').style.display = 'none'

    const wrapper = document.getElementById('tabla-wrapper')
    wrapper.innerHTML = `
        <div id="storage-ui">
            <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
                <button id="st-tab-proposals"        data-sec="proposals"        class="st-tab-btn${_storageSeccion === 'proposals'        ? ' st-tab-btn--active' : ''}">📄 Propuestas</button>
                <button id="st-tab-invoices"         data-sec="invoices"         class="st-tab-btn${_storageSeccion === 'invoices'         ? ' st-tab-btn--active' : ''}">🧾 Facturas emitidas</button>
                <button id="st-tab-supplier-invoices" data-sec="supplier-invoices" class="st-tab-btn${_storageSeccion === 'supplier-invoices' ? ' st-tab-btn--active' : ''}">🗂 Facturas recibidas</button>
            </div>
            <div id="st-dropzone" class="st-dropzone">
                <span style="color:var(--subtle);font-size:13px">⬆ Arrastra archivos aquí o <label for="st-file-input" style="cursor:pointer;color:var(--accent);text-decoration:underline">selecciona</label></span>
                <input type="file" id="st-file-input" multiple accept=".pdf" style="display:none">
            </div>
            <div id="st-content"><p style="color:var(--subtle);font-size:13px">Cargando...</p></div>
        </div>`

    document.querySelectorAll('.st-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _storageSeccion = btn.dataset.sec
            document.querySelectorAll('.st-tab-btn').forEach(b => b.classList.remove('st-tab-btn--active'))
            btn.classList.add('st-tab-btn--active')
            _cargarStorageSeccion()
        })
    })

    const dz = document.getElementById('st-dropzone')
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('st-dz--over') })
    dz.addEventListener('dragleave', () => dz.classList.remove('st-dz--over'))
    dz.addEventListener('drop',      e => { e.preventDefault(); dz.classList.remove('st-dz--over'); _subirArchivos([...e.dataTransfer.files]) })
    document.getElementById('st-file-input').addEventListener('change', e => {
        if (e.target.files.length) _subirArchivos([...e.target.files])
    })

    await _cargarStorageSeccion()
}

async function _cargarStorageSeccion() {
    const content = document.getElementById('st-content')
    if (!content) return
    content.innerHTML = '<p style="color:var(--subtle);font-size:13px">Cargando...</p>'

    const bucket = _storageSeccion

    if (bucket === 'supplier-invoices') {
        const [archivos, { data: docs }, { data: invs }, { data: closings }] = await Promise.all([
            _listarBucket(bucket),
            supabase.from('supplier_documents').select('id, provider_id, concept, has_invoice, notes, file_path').not('file_path', 'is', null),
            supabase.from('supplier_invoices').select('id, document_id, invoice_number, booked_date'),
            supabase.from('fiscal_closings').select('year, quarter').eq('model', 'F69').not('presented_at', 'is', null)
        ])
        const closedSet = new Set((closings ?? []).map(c => `${c.year}-${c.quarter}`))
        const invByDoc  = new Map((invs ?? []).map(inv => [inv.document_id, inv]))
        const pathMap   = new Map()
        for (const doc of docs ?? []) {
            if (!doc.file_path) continue
            const inv    = invByDoc.get(doc.id) ?? null
            let isClosed = false
            if (inv?.booked_date) {
                const [y, m] = inv.booked_date.split('-').map(Number)
                isClosed = closedSet.has(`${y}-${Math.ceil(m / 3)}`)
            }
            pathMap.set(doc.file_path, {
                docId: doc.id, providerId: doc.provider_id, concept: doc.concept,
                hasInvoice: doc.has_invoice, notes: doc.notes,
                invoiceId: inv?.id ?? null, invoiceNumber: inv?.invoice_number ?? null,
                bookedDate: inv?.booked_date ?? null, isClosed
            })
        }
        _renderStorageSeccion(archivos, pathMap)
        return
    }

    const [archivos, { data: dbRows }] = await Promise.all([
        _listarBucket(bucket),
        bucket === 'proposals'
            ? supabase.from('reservations').select('id, client_id, proposal_path, proposal_number').not('proposal_path', 'is', null)
            : supabase.from('charges').select('id, client_id, amount, due_date, is_final, invoice_path, invoice_number, season').not('invoice_path', 'is', null)
    ])

    const pathMap = new Map()
    for (const row of dbRows ?? []) {
        const p = bucket === 'proposals' ? row.proposal_path : row.invoice_path
        if (!pathMap.has(p)) pathMap.set(p, [])
        pathMap.get(p).push(row)
    }

    _renderStorageSeccion(archivos, pathMap)
}

function _renderStorageSeccion(archivos, pathMap) {
    const content = document.getElementById('st-content')
    if (!content) return

    const bucket    = _storageSeccion
    const huerfanos = archivos.filter(f => !pathMap.has(f.path))

    document.getElementById('tabla-count').textContent =
        `${archivos.length} archivo${archivos.length !== 1 ? 's' : ''} · ${huerfanos.length} huérfano${huerfanos.length !== 1 ? 's' : ''}`

    if (!archivos.length) {
        content.innerHTML = '<p style="color:var(--subtle);font-size:13px">No hay archivos en este bucket.</p>'
        return
    }

    const rows = archivos.map(f => {
        const linked    = pathMap.get(f.path)
        const esHuerfano = !linked
        const fecha     = f.updated_at ? new Date(f.updated_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'
        const size      = f.size ? Math.round(f.size / 1024) + ' KB' : '—'

        let vinculadoHtml
        if (esHuerfano) {
            vinculadoHtml = `<span style="color:var(--accent-warn);font-size:11px">Huérfano</span>`
            if (bucket === 'invoices' || bucket === 'supplier-invoices') {
                vinculadoHtml += ` <button class="st-btn-vincular" data-path="${_esc(f.path)}" data-name="${_esc(f.name)}"
                    style="font-size:11px;padding:2px 8px;margin-left:4px;background:none;border:1px solid var(--border);border-radius:3px;cursor:pointer;font-family:inherit">Vincular</button>`
            }
        } else if (bucket === 'proposals') {
            vinculadoHtml = linked.map(r =>
                `<span style="font-size:11px">${r.id}${r.proposal_number ? ` (${r.proposal_number})` : ''}</span>`
            ).join(', ')
        } else if (bucket === 'invoices') {
            const c  = linked[0]
            const f2 = c.due_date ? new Date(c.due_date + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'
            vinculadoHtml = `<span style="font-size:11px">${c.client_id} · ${fmt(c.amount)} · ${f2} · ${c.is_final ? 'Final' : 'Adelanto'}</span>`
            vinculadoHtml += ` <button class="st-btn-vincular" data-path="${_esc(f.path)}" data-name="${_esc(f.name)}"
                style="font-size:11px;padding:2px 6px;margin-left:4px;background:none;border:1px solid var(--border);border-radius:3px;cursor:pointer;font-family:inherit" title="Cambiar vinculación">✏️</button>`
        } else {
            // supplier-invoices
            const d = linked
            const provStr = d.providerId ? ` · <strong>${_esc(d.providerId)}</strong>` : ''
            const estadoStr = d.invoiceNumber
                ? `<span style="color:var(--accent-ok);font-size:11px">✅ ${_esc(d.invoiceNumber)}</span>`
                : d.hasInvoice === false
                    ? `<span style="color:var(--subtle);font-size:11px">Sin factura</span>`
                    : `<span style="color:var(--accent-warn);font-size:11px">Pendiente de anotar</span>`
            vinculadoHtml = `<span style="font-size:11px">${_esc(d.concept ?? '—')}${provStr}</span> ${estadoStr}`
            if (d.isClosed) vinculadoHtml += ` <span style="font-size:11px;color:var(--subtle)">· ${d.bookedDate?.slice(0, 7) ?? ''}</span>`
        }

        const trimCerrado = bucket === 'supplier-invoices' && !esHuerfano && linked?.isClosed
        const btnEliminar = trimCerrado
            ? `<span title="Trimestre presentado" style="font-size:14px;padding:1px 3px;display:inline-block;line-height:1.4">🔒</span>`
            : `<button class="st-btn-delete" data-path="${_esc(f.path)}"
                style="background:none;border:1px solid var(--accent);border-radius:3px;cursor:pointer;font-size:11px;padding:1px 4px;color:var(--accent);line-height:1.4;margin-left:2px" title="Eliminar">🗑</button>`

        const rowStyle = esHuerfano ? ' style="color:var(--accent-warn)"' : ''
        return `<tr${rowStyle}>
            <td style="font-size:12px;word-break:break-all">${_esc(f.name)}</td>
            <td style="font-size:12px;white-space:nowrap">${size}</td>
            <td style="font-size:12px;white-space:nowrap">${fecha}</td>
            <td style="font-size:12px">${vinculadoHtml}</td>
            <td style="text-align:center;white-space:nowrap;padding:0 4px">
                <button class="st-btn-download" data-path="${_esc(f.path)}"
                    style="background:none;border:none;cursor:pointer;font-size:14px;padding:1px 3px" title="Descargar">📥</button>
                ${btnEliminar}
            </td>
        </tr>`
    }).join('')

    const huerfanosBtn = huerfanos.length
        ? `<button id="st-btn-huerfanos" class="btn btn-secondary"
               style="font-size:12px;border-color:var(--accent);color:var(--accent)">🗑 Eliminar ${huerfanos.length} huérfano${huerfanos.length !== 1 ? 's' : ''}</button>`
        : ''

    content.innerHTML = `
        ${huerfanosBtn ? `<div style="margin-bottom:12px">${huerfanosBtn}</div>` : ''}
        <div class="table-wrapper">
            <table class="data-table">
                <thead><tr>
                    <th>Nombre</th>
                    <th>Tamaño</th>
                    <th>Fecha</th>
                    <th>${bucket === 'proposals' ? 'Reservas' : bucket === 'invoices' ? 'Cobro' : 'Documento / Proveedor'}</th>
                    <th style="width:70px"></th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`

    content.querySelectorAll('.st-btn-download').forEach(btn => {
        btn.addEventListener('click', async () => {
            const { data } = await supabase.storage.from(bucket).createSignedUrl(btn.dataset.path, 3600)
            if (data?.signedUrl) window.open(data.signedUrl, '_blank')
            else alert('No se pudo generar la URL de descarga.')
        })
    })

    content.querySelectorAll('.st-btn-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            if (_storageSeccion === 'supplier-invoices') {
                _eliminarArchivoRecibida(btn.dataset.path, pathMap.get(btn.dataset.path) ?? null)
            } else {
                _eliminarArchivoStorage(btn.dataset.path, pathMap.get(btn.dataset.path) ?? null)
            }
        })
    })

    content.querySelectorAll('.st-btn-vincular').forEach(btn => {
        btn.addEventListener('click', () => {
            if (_storageSeccion === 'supplier-invoices') {
                _abrirVincularRecibida(btn.dataset.path, btn.dataset.name)
            } else {
                _abrirVincularFactura(btn.dataset.path, btn.dataset.name)
            }
        })
    })

    document.getElementById('st-btn-huerfanos')?.addEventListener('click', () => {
        _eliminarHuerfanos(huerfanos.map(f => f.path))
    })
}

async function _subirArchivos(files) {
    const bucket  = _storageSeccion
    const errores = []
    for (const file of files) {
        // supplier-invoices: prefijo _upload/ para evitar colisiones con carpetas de proveedor/gastos
        const path = bucket === 'supplier-invoices'
            ? `_upload/${Date.now()}_${file.name}`
            : file.name
        const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false })
        if (error) errores.push(`${file.name}: ${error.message}`)
    }
    const inp = document.getElementById('st-file-input')
    if (inp) inp.value = ''
    if (errores.length) alert('Algunos archivos no se pudieron subir:\n' + errores.join('\n'))
    await _cargarStorageSeccion()
}

async function _eliminarArchivoStorage(path, linked) {
    const bucket = _storageSeccion
    const nombre = path.split('/').pop()
    let desc = `¿Eliminar <strong>${_esc(nombre)}</strong> de Storage?`

    if (linked?.length) {
        if (bucket === 'proposals') {
            const ids = linked.map(r => r.id).join(', ')
            desc += `<br><br>Está vinculado a la${linked.length > 1 ? 's' : ''} reserva${linked.length > 1 ? 's' : ''} <strong>${ids}</strong>. Se pondrá <code>proposal_path = null</code>.`
        } else {
            const c = linked[0]
            desc += `<br><br>Está vinculado al cobro <strong>#${c.id}</strong> de <strong>${c.client_id}</strong>. Se pondrá <code>invoice_path = null</code>.`
        }
    }

    const opcion = await _modalOpciones('Eliminar archivo', desc, [
        { label: 'Sí, eliminar', value: 'ok',     clase: 'btn-danger' },
        { label: 'Cancelar',     value: 'cancel',  clase: 'btn-secondary' }
    ])
    if (!opcion || opcion === 'cancel') return

    const { error } = await supabase.storage.from(bucket).remove([path])
    if (error) { alert(`Error al eliminar: ${error.message}`); return }

    if (linked?.length) {
        if (bucket === 'proposals') {
            await supabase.from('reservations').update({ proposal_path: null }).in('id', linked.map(r => r.id))
        } else {
            await supabase.from('charges').update({ invoice_path: null, invoice_number: null }).eq('id', linked[0].id)
        }
    }

    await _cargarStorageSeccion()
}

async function _eliminarHuerfanos(paths) {
    const bucket = _storageSeccion
    const lista  = paths.map(p => `• ${p.split('/').pop()}`).join('<br>')
    const opcion = await _modalOpciones('Eliminar huérfanos',
        `¿Eliminar ${paths.length} archivo${paths.length !== 1 ? 's' : ''} huérfano${paths.length !== 1 ? 's' : ''} de Storage? No modifica ningún dato en BD.<br><br>${lista}`,
        [
            { label: `Sí, eliminar ${paths.length}`, value: 'ok',     clase: 'btn-danger' },
            { label: 'Cancelar',                     value: 'cancel',  clase: 'btn-secondary' }
        ])
    if (!opcion || opcion === 'cancel') return

    const { error } = await supabase.storage.from(bucket).remove(paths)
    if (error) { alert(`Error al eliminar: ${error.message}`); return }
    await _cargarStorageSeccion()
}

async function _eliminarArchivoRecibida(path, linked) {
    const nombre = path.split('/').pop()

    if (!linked) {
        const opcion = await _modalOpciones(
            'Eliminar archivo huérfano',
            `¿Eliminar <strong>${_esc(nombre)}</strong>?<br>No hay ningún registro en BD vinculado a este archivo.`,
            [
                { label: 'Sí, eliminar', value: 'ok',    clase: 'btn-danger' },
                { label: 'Cancelar',     value: 'cancel', clase: 'btn-secondary' }
            ]
        )
        if (!opcion || opcion === 'cancel') return
        await supabase.storage.from('supplier-invoices').remove([path])
        await _cargarStorageSeccion()
        return
    }

    const fiscalDesc = linked.invoiceId
        ? `<br>⚠️ Tiene un asiento en el libro fiscal${linked.invoiceNumber ? ` (<strong>${_esc(linked.invoiceNumber)}</strong>)` : ''} que también se eliminará.`
        : ''

    const opcion = await _modalOpciones(
        'Eliminar archivo de proveedor',
        `<strong>${_esc(nombre)}</strong>${fiscalDesc}<br>¿Qué quieres eliminar?`,
        [
            { label: 'Archivo y gasto completo', value: 'todo',   clase: 'btn-danger' },
            { label: 'Solo el archivo',          value: 'solo',   clase: 'btn-secondary' },
            { label: 'Cancelar',                 value: 'cancel', clase: 'btn-secondary' }
        ]
    )
    if (!opcion || opcion === 'cancel') return

    // El asiento fiscal siempre se elimina con el archivo
    if (linked.invoiceId) {
        await supabase.from('supplier_invoices').delete().eq('id', linked.invoiceId)
    }
    await supabase.storage.from('supplier-invoices').remove([path])

    if (opcion === 'todo') {
        const { error } = await supabase.from('supplier_documents').delete().eq('id', linked.docId)
        if (error) { alert(`Error al eliminar el gasto: ${error.message}`); await _cargarStorageSeccion(); return }
    } else {
        await supabase.from('supplier_documents').update({ file_path: null }).eq('id', linked.docId)
    }

    await _cargarStorageSeccion()
}

async function _abrirVincularRecibida(path, filename) {
    const [{ data: providers }, { data: gastos }] = await Promise.all([
        supabase.from('providers').select('id, name').order('id'),
        supabase.from('supplier_documents')
            .select('id, concept, expense_date, file_path')
            .is('provider_id', null)
            .order('expense_date', { ascending: false })
    ])

    const { overlay, panel } = crearModal('modal-vincular-recibida', { wide: true })
    let modo = 'proveedor'

    const provOpts = (providers ?? []).map(p =>
        `<option value="${_esc(p.id)}">${_esc(p.id)}${p.name ? ' — ' + _esc(p.name) : ''}</option>`
    ).join('')

    const gastosOpts = (gastos ?? []).map(g => {
        const fecha  = g.expense_date ? new Date(g.expense_date + 'T00:00:00').toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '—'
        const yaArch = g.file_path && !g.file_path.endsWith('_sin_archivo') ? ' ⚠️ ya tiene archivo' : ''
        return `<option value="${g.id}">${_esc(g.concept ?? '—')} · ${fecha}${yaArch}</option>`
    }).join('')

    panel.innerHTML = `
        <div class="modal-header-title">Vincular archivo</div>
        <p style="font-size:12px;color:var(--subtle);margin:6px 0 16px">${_esc(filename)}</p>

        <div style="display:flex;gap:16px;margin-bottom:16px">
            <label style="font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px">
                <input type="radio" name="vr-modo" value="proveedor" checked> Proveedor
            </label>
            <label style="font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px">
                <input type="radio" name="vr-modo" value="gasto"> Gasto general existente
            </label>
        </div>

        <div id="vr-sec-proveedor">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Proveedor</label>
            <select id="vr-proveedor" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit">
                <option value="">— Seleccionar proveedor —</option>
                ${provOpts}
            </select>
            <p style="font-size:11px;color:var(--subtle);margin-top:4px">Crea un documento en el proveedor seleccionado. Puedes completar los detalles desde Proveedores.</p>
        </div>

        <div id="vr-sec-gasto" style="display:none">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Gasto general</label>
            <select id="vr-gasto" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit">
                <option value="">— Seleccionar gasto —</option>
                ${gastosOpts}
            </select>
            <p style="font-size:11px;color:var(--subtle);margin-top:4px">Asigna este archivo a un gasto general ya existente.</p>
        </div>

        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
            <button class="btn btn-secondary" id="vr-cancel">Cancelar</button>
            <button class="btn btn-primary"   id="vr-ok">Vincular</button>
        </div>`

    panel.querySelectorAll('input[name="vr-modo"]').forEach(radio => {
        radio.addEventListener('change', () => {
            modo = radio.value
            panel.querySelector('#vr-sec-proveedor').style.display = modo === 'proveedor' ? '' : 'none'
            panel.querySelector('#vr-sec-gasto').style.display     = modo === 'gasto'     ? '' : 'none'
        })
    })

    panel.querySelector('#vr-cancel').addEventListener('click', () => overlay.close())

    panel.querySelector('#vr-ok').addEventListener('click', async () => {
        const season = getTemporadaActiva()
        if (modo === 'proveedor') {
            const providerId = panel.querySelector('#vr-proveedor').value
            if (!providerId) { alert('Selecciona un proveedor.'); return }
            const { error } = await supabase.from('supplier_documents').insert({ provider_id: providerId, file_path: path, season })
            if (error) { alert(`Error: ${error.message}`); return }
        } else {
            const gastoId = parseInt(panel.querySelector('#vr-gasto').value)
            if (!gastoId) { alert('Selecciona un gasto.'); return }
            const { error } = await supabase.from('supplier_documents').update({ file_path: path }).eq('id', gastoId)
            if (error) { alert(`Error: ${error.message}`); return }
        }
        overlay.close()
        await _cargarStorageSeccion()
    })

    overlay.showModal()
}

async function _abrirVincularFactura(path, filename) {
    const [{ data: clientes }, { data: cobros }] = await Promise.all([
        supabase.from('clients').select('id, name').order('id'),
        supabase.from('charges').select('id, client_id, amount, due_date, is_final, invoice_path, invoice_number, season').order('due_date')
    ])

    const actual = cobros?.find(c => c.invoice_path === path)
    const { overlay, panel } = crearModal('modal-vincular-factura', { wide: true })

    function buildCobroOpts(clienteId) {
        const filtrados = clienteId ? (cobros ?? []).filter(c => c.client_id === clienteId) : (cobros ?? [])
        return filtrados.map(c => {
            const f  = c.due_date ? new Date(c.due_date + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'
            const t  = c.is_final ? 'Final' : 'Adelanto'
            const ya = c.invoice_path && c.invoice_path !== path ? ' (ya vinculado)' : ''
            return `<option value="${c.id}" ${actual?.id === c.id ? 'selected' : ''}>#${c.id} · ${c.client_id} · ${f} · ${t} · ${fmt(c.amount)}${ya}</option>`
        }).join('')
    }

    const clienteInicial = actual?.client_id ?? ''
    const clientOpts = (clientes ?? []).map(c =>
        `<option value="${_esc(c.id)}" ${actual?.client_id === c.id ? 'selected' : ''}>${_esc(c.id)}${c.name ? ' — ' + _esc(c.name) : ''}</option>`
    ).join('')

    panel.innerHTML = `
        <div class="modal-header-title">Vincular factura</div>
        <p style="font-size:12px;color:var(--subtle);margin:6px 0 16px">${_esc(filename)}</p>

        <div style="margin-bottom:10px">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Cliente</label>
            <select id="vf-cliente" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit">
                <option value="">— Seleccionar cliente —</option>
                ${clientOpts}
            </select>
        </div>

        <div style="margin-bottom:10px">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Cobro</label>
            <select id="vf-cobro" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit">
                <option value="">— Seleccionar cobro —</option>
                ${buildCobroOpts(clienteInicial)}
            </select>
        </div>

        <div style="margin-bottom:16px">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Número de factura</label>
            <input type="text" id="vf-numero" value="${_esc(actual?.invoice_number ?? filename.replace(/\.[^.]+$/, ''))}"
                style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit;box-sizing:border-box">
            <p style="font-size:11px;color:var(--subtle);margin:4px 0 0">Pre-relleno desde el nombre del archivo · editable</p>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn btn-secondary" id="vf-cancel">Cancelar</button>
            <button class="btn btn-primary"   id="vf-ok">Guardar</button>
        </div>`

    const cobroSel   = panel.querySelector('#vf-cobro')
    const clienteSel = panel.querySelector('#vf-cliente')
    if (actual) cobroSel.value = String(actual.id)

    clienteSel.addEventListener('change', () => {
        const saved = cobroSel.value
        cobroSel.innerHTML = `<option value="">— Seleccionar cobro —</option>` + buildCobroOpts(clienteSel.value)
        if (saved) cobroSel.value = saved
    })

    cobroSel.addEventListener('change', () => {
        const cobro = cobros?.find(c => String(c.id) === cobroSel.value)
        if (cobro && cobro.client_id !== clienteSel.value) {
            clienteSel.value = cobro.client_id
            const saved = cobroSel.value
            cobroSel.innerHTML = `<option value="">— Seleccionar cobro —</option>` + buildCobroOpts(cobro.client_id)
            cobroSel.value = saved
        }
    })

    panel.querySelector('#vf-cancel').addEventListener('click', () => overlay.close())
    panel.querySelector('#vf-ok').addEventListener('click', async () => {
        const cobroId = parseInt(cobroSel.value)
        if (!cobroId) { alert('Selecciona un cobro.'); return }
        const numero = panel.querySelector('#vf-numero').value.trim() || null

        if (actual && actual.id !== cobroId) {
            await supabase.from('charges').update({ invoice_path: null, invoice_number: null }).eq('id', actual.id)
        }
        const { error } = await supabase.from('charges').update({ invoice_path: path, invoice_number: numero }).eq('id', cobroId)
        if (error) { alert(`Error: ${error.message}`); return }
        overlay.close()
        await _cargarStorageSeccion()
    })

    overlay.showModal()
}