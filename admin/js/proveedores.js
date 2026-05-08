import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { fmt, initSidebar, normalizarId, buscarConPrioridad } from './utils.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

// ===== DATOS GLOBALES =====
let todosProveedores   = (await supabase.from('providers').select('*').order('id')).data
let todosServicios     = (await supabase.from('services').select('*').order('id')).data
let todaDisponibilidad = (await supabase.from('availability').select('*')).data
let todosPayments      = (await supabase.from('payments').select('*')).data
let todasReservas      = (await supabase.from('reservations').select('*')).data

let proveedorActual      = null
let servicioEditandoId   = null  // un solo id (click en fila) o null
let serviciosEditandoIds = []    // array de ids (edición múltiple)
let hitosProvTemp        = []
let ultimoCampoActivo    = 'precio' // 'precio' o 'total' — cuál fue el último editado

const hoy = new Date().toISOString().split('T')[0]

// ===== REFERENCIAS DOM =====
const inputProveedorId       = document.getElementById('inputProveedorId')
const inputNombre            = document.getElementById('inputNombre')
const inputDireccion         = document.getElementById('inputDireccion')
const selectFormaPago        = document.getElementById('selectFormaPago')
const checkFactura           = document.getElementById('checkFactura')
const inputProveedorComments = document.getElementById('inputProveedorComments')
const autoProvList           = document.getElementById('autocompleteProveedorList')
const proveedorStatus        = document.getElementById('proveedor-status')
const inputServicioId        = document.getElementById('inputServicioId')
const inputPlazas            = document.getElementById('inputPlazas')
const inputPrecio            = document.getElementById('inputPrecio')
const inputCosteTotal        = document.getElementById('inputCosteTotal')
const selectModelo           = document.getElementById('selectModelo')
const servicioStatus         = document.getElementById('servicio-status')
const btnGuardarServicio     = document.getElementById('btnGuardarServicio')
const btnCancelarServicio    = document.getElementById('btnCancelarServicio')

// ===== BLOQUE 1: PROVEEDOR =====
inputProveedorId.addEventListener('keydown', e => {
    if (e.key === ' ') {
        e.preventDefault()
        const pos = inputProveedorId.selectionStart
        const val = inputProveedorId.value
        inputProveedorId.value = val.slice(0, pos) + '_' + val.slice(pos)
        inputProveedorId.setSelectionRange(pos + 1, pos + 1)
        mostrarSugerenciasProveedor(normalizarId(inputProveedorId.value))
    }
})

inputProveedorId.addEventListener('input', () => {
    const val = normalizarId(inputProveedorId.value)
    inputProveedorId.value = val
    mostrarSugerenciasProveedor(val)
})

inputProveedorId.addEventListener('focus', () => {
    mostrarSugerenciasProveedor(normalizarId(inputProveedorId.value))
})

function mostrarSugerenciasProveedor(val) {
    const coincidencias = val
        ? buscarConPrioridad(todosProveedores, val, ['id', 'name', 'address'])
        : todosProveedores

    autoProvList.innerHTML = coincidencias.map(p =>
        `<div data-id="${p.id}">${p.id}${p.name ? ' — ' + p.name : ''}</div>`
    ).join('')
    autoProvList.style.display = coincidencias.length > 0 ? 'block' : 'none'

    const exacto = todosProveedores.find(p => p.id === val)
    if (exacto) {
        cargarProveedor(exacto)
    } else if (val) {
        if (proveedorActual) limpiarCamposProveedor()
        proveedorActual = null
        proveedorStatus.textContent = '✨ Proveedor nuevo'
        proveedorStatus.style.color = 'var(--accent-warn)'
        document.getElementById('bloque-servicio').style.display = 'block'
        document.getElementById('bloque-servicios-proveedor').style.display = 'none'
        document.getElementById('bloque-pagos-proveedor').style.display = 'none'
        limpiarFormularioServicio()
    } else {
        limpiarProveedor()
    }
}

autoProvList.addEventListener('click', e => {
    const div = e.target.closest('[data-id]')
    if (!div) return
    const p = todosProveedores.find(p => p.id === div.dataset.id)
    if (p) { inputProveedorId.value = p.id; cargarProveedor(p); autoProvList.style.display = 'none' }
})

document.addEventListener('click', e => {
    if (!e.target.closest('.autocomplete-wrap')) {
        autoProvList.style.display = 'none'
        document.getElementById('autocompleteServicioList').style.display = 'none'
    }
})

function cargarProveedor(p) {
    proveedorActual              = p
    inputNombre.value            = p.name           ?? ''
    inputDireccion.value         = p.address        ?? ''
    selectFormaPago.value        = p.payment_method ?? ''
    checkFactura.checked         = p.invoice        ?? false
    inputProveedorComments.value = p.comments       ?? ''
    proveedorStatus.textContent  = '✅ Proveedor existente — los cambios se guardan automáticamente'
    proveedorStatus.style.color  = 'var(--accent-ok)'
    document.getElementById('bloque-servicio').style.display = 'block'
    limpiarFormularioServicio()
    cargarServiciosProveedor(p.id)
    cargarPagosProveedor(p.id)
}

function limpiarProveedor() {
    proveedorActual = null
    limpiarCamposProveedor()
    proveedorStatus.textContent = ''
    document.getElementById('bloque-servicio').style.display            = 'none'
    document.getElementById('bloque-servicios-proveedor').style.display = 'none'
    document.getElementById('bloque-pagos-proveedor').style.display     = 'none'
    limpiarFormularioServicio()
}

function limpiarCamposProveedor() {
    inputNombre.value            = ''
    inputDireccion.value         = ''
    selectFormaPago.value        = ''
    checkFactura.checked         = false
    inputProveedorComments.value = ''
}

// Guardar automáticamente campos del proveedor existente
const camposProveedor = [inputNombre, inputDireccion, inputProveedorComments]
const camposProvDB    = ['name', 'address', 'comments']
camposProveedor.forEach((input, i) => {
    input.addEventListener('change', async () => {
        if (!proveedorActual) return
        await supabase.from('providers')
            .update({ [camposProvDB[i]]: input.value.trim() || null })
            .eq('id', proveedorActual.id)
        proveedorActual[camposProvDB[i]] = input.value.trim() || null
        mostrarGuardado()
    })
})

// Guardar select y checkbox automáticamente
selectFormaPago.addEventListener('change', async () => {
    if (!proveedorActual) return
    await supabase.from('providers')
        .update({ payment_method: selectFormaPago.value || null })
        .eq('id', proveedorActual.id)
    proveedorActual.payment_method = selectFormaPago.value || null
    mostrarGuardado()
})

checkFactura.addEventListener('change', async () => {
    if (!proveedorActual) return
    await supabase.from('providers')
        .update({ invoice: checkFactura.checked })
        .eq('id', proveedorActual.id)
    proveedorActual.invoice = checkFactura.checked
    mostrarGuardado()
})

function mostrarGuardado() {
    proveedorStatus.textContent = '✅ Guardado'
    proveedorStatus.style.color = 'var(--accent-ok)'
    setTimeout(() => {
        proveedorStatus.textContent = '✅ Proveedor existente — los cambios se guardan automáticamente'
    }, 2000)
}

// ===== BLOQUE 2: SERVICIO =====

// Autocomplete servicio
inputServicioId.addEventListener('input', () => {
    const val      = inputServicioId.value.trim().toUpperCase()
    const autoList = document.getElementById('autocompleteServicioList')
    if (!val) { autoList.style.display = 'none'; return }
    const coincidencias = todosServicios.filter(s => s.id.toUpperCase().startsWith(val))
    autoList.innerHTML  = coincidencias.map(s => `<div data-id="${s.id}">${s.id}</div>`).join('')
    autoList.style.display = coincidencias.length > 0 ? 'block' : 'none'
    actualizarBtnServicio()
    actualizarCosteServicio()
})

inputServicioId.addEventListener('focus', () => {
    const val      = inputServicioId.value.trim().toUpperCase()
    const autoList = document.getElementById('autocompleteServicioList')
    const lista    = val
        ? todosServicios.filter(s => s.id.toUpperCase().startsWith(val))
        : todosServicios
    autoList.innerHTML  = lista.map(s => `<div data-id="${s.id}">${s.id}</div>`).join('')
    autoList.style.display = lista.length > 0 ? 'block' : 'none'
})

document.getElementById('autocompleteServicioList').addEventListener('click', e => {
    const div = e.target.closest('[data-id]')
    if (!div) return
    inputServicioId.value = div.dataset.id
    document.getElementById('autocompleteServicioList').style.display = 'none'
    actualizarBtnServicio()
    actualizarCosteServicio()
})

// Lógica bidireccional precio/total
inputPrecio.addEventListener('input', () => {
    ultimoCampoActivo = 'precio'
    const plazas = parseInt(inputPlazas.value) || 0
    const precio  = parseFloat(inputPrecio.value) || 0
    if (plazas > 0 && precio >= 0) {
        inputCosteTotal.value = (plazas * precio).toFixed(2)
    }
    actualizarBtnServicio()
    actualizarCosteServicio()
})

inputCosteTotal.addEventListener('input', () => {
    ultimoCampoActivo = 'total'
    const plazas = parseInt(inputPlazas.value) || 0
    const total  = parseFloat(inputCosteTotal.value) || 0
    if (plazas > 0) {
        inputPrecio.value = (total / plazas).toFixed(2)
    }
    actualizarBtnServicio()
    actualizarCosteServicio()
})

inputPlazas.addEventListener('input', () => {
    const plazas = parseInt(inputPlazas.value) || 0
    if (ultimoCampoActivo === 'precio') {
        const precio = parseFloat(inputPrecio.value) || 0
        if (plazas > 0) inputCosteTotal.value = (plazas * precio).toFixed(2)
    } else {
        const total = parseFloat(inputCosteTotal.value) || 0
        if (plazas > 0) inputPrecio.value = (total / plazas).toFixed(2)
        else inputPrecio.value = ''
    }
    actualizarBtnServicio()
    actualizarCosteServicio()
})

selectModelo.addEventListener('change', actualizarCosteServicio)

// Muestra el coste calculado informativo (para consumption)
function actualizarCosteServicio() {
    const plazas  = parseInt(inputPlazas.value) || 0
    const precio  = parseFloat(inputPrecio.value) || 0
    const modelo  = selectModelo.value
    const servId  = inputServicioId.value.trim().toUpperCase()
    let coste     = 0

    if (modelo === 'capacity') {
        coste = plazas * precio
        document.getElementById('inputCosteServicio').value = fmt(coste)
    } else {
        if (proveedorActual && servId) {
            const plazasRes = todasReservas
                .filter(r => r.provider_id === proveedorActual.id &&
                             r.service_id  === servId &&
                             r.status      !== 'Cancelada')
                .reduce((s, r) => s + r.slots, 0)
            coste = plazasRes * precio
        }
        document.getElementById('inputCosteServicio').value =
            precio > 0 ? fmt(coste) + ' (según reservas)' : '—'
    }
}

function actualizarBtnServicio() {
    const tieneProveedor = inputProveedorId.value.trim().length > 0
    const tieneServicio  = serviciosEditandoIds.length > 1 || inputServicioId.value.trim().length > 0
    // En edición múltiple, plazas vacío es válido (significa "no cambiar")
    const tienePlazas    = serviciosEditandoIds.length > 1 || inputPlazas.value !== ''
    btnGuardarServicio.disabled = !(tieneProveedor && tieneServicio && tienePlazas)
}

function limpiarFormularioServicio() {
    servicioEditandoId   = null
    serviciosEditandoIds = []
    ultimoCampoActivo    = 'precio'
    inputServicioId.value = ''
    inputServicioId.disabled = false
    inputPlazas.value     = ''
    inputPrecio.value     = ''
    inputCosteTotal.value = ''
    selectModelo.value    = 'capacity'
    document.getElementById('inputCosteServicio').value = '—'
    document.getElementById('titulo-bloque-servicio').textContent = '➕ Añadir / Editar servicio'
    servicioStatus.textContent = ''
    btnGuardarServicio.textContent    = 'Añadir servicio'
    btnGuardarServicio.disabled       = true
    btnCancelarServicio.style.display = 'none'
    document.querySelectorAll('.chk-servicio:checked').forEach(c => c.checked = false)
    sortServiciosCol = null
    sortServiciosDir = 'asc'
}

// ===== GUARDAR SERVICIO(S) =====
btnGuardarServicio.addEventListener('click', async () => {
    const proveedorId = inputProveedorId.value.trim().toUpperCase()
    const plazas      = parseInt(inputPlazas.value)
    const precio      = parseFloat(inputPrecio.value)
    const modelo      = selectModelo.value

    // Validar plazas
    if (plazas < 0) {
        alert('El número de plazas no puede ser negativo.')
        return
    }
    if (plazas === 0) {
        if (!confirm('¿Quieres añadir un servicio con 0 plazas disponibles?')) return
    }

    // Crear proveedor si es nuevo
    if (!proveedorActual) {
        if (!confirm(`¿Crear proveedor nuevo "${proveedorId}"?`)) return
        const { error } = await supabase.from('providers').insert({
            id:       proveedorId,
            name:     inputNombre.value.trim() || null,
            address:  inputDireccion.value.trim() || null,
            comments: inputProveedorComments.value.trim() || null
        })
        if (error) { alert('Error al crear proveedor: ' + error.message); return }
        const nuevo = { id: proveedorId, name: inputNombre.value.trim() || null }
        proveedorActual = nuevo
        todosProveedores.push(nuevo)
        proveedorStatus.textContent = '✅ Proveedor creado'
        proveedorStatus.style.color = 'var(--accent-ok)'
    }

    // MODO EDICIÓN MÚLTIPLE
    if (serviciosEditandoIds.length > 1) {
        for (const dispId of serviciosEditandoIds) {
            const dispActual = todaDisponibilidad.find(d => d.id === dispId)
            if (!dispActual) continue
            const updateData = {}
            // Solo actualizar campos que el usuario ha tocado (no vacíos)
            if (inputPlazas.value !== '' && !isNaN(plazas))   updateData.total_slots    = plazas
            if (inputPrecio.value !== '' && !isNaN(precio))   updateData.price_per_slot = precio
            // Modelo siempre se aplica si hay selección múltiple (tiene valor por defecto)
            updateData.billing_model = modelo

            const { error } = await supabase.from('availability')
                .update(updateData).eq('id', dispId)
            if (error) { alert('Error al actualizar ' + dispActual.service_id + ': ' + error.message); continue }
            todaDisponibilidad = todaDisponibilidad.map(d =>
                d.id === dispId ? { ...d, ...updateData } : d
            )
        }
        await recalcularPagoFinalProveedor(proveedorActual.id)
        limpiarFormularioServicio()
        cargarServiciosProveedor(proveedorActual.id)
        cargarPagosProveedor(proveedorActual.id)
        return
    }

    // MODO EDICIÓN SIMPLE o CREACIÓN
    const servicioId = inputServicioId.value.trim().toUpperCase()

    // Crear servicio si es nuevo
    const servicioExiste = todosServicios.find(s => s.id.toUpperCase() === servicioId)
    if (!servicioExiste) {
        if (!confirm(`¿Crear servicio nuevo "${servicioId}"?`)) return
        const { error } = await supabase.from('services').insert({ id: servicioId })
        if (error) { alert('Error al crear servicio: ' + error.message); return }
        todosServicios.push({ id: servicioId })
    }

    if (servicioEditandoId) {
        const { error } = await supabase.from('availability')
            .update({ total_slots: plazas, price_per_slot: isNaN(precio) ? 0 : precio, billing_model: modelo })
            .eq('id', servicioEditandoId)
        if (error) { alert('Error al actualizar: ' + error.message); return }
        todaDisponibilidad = todaDisponibilidad.map(d =>
            d.id === servicioEditandoId
                ? { ...d, total_slots: plazas, price_per_slot: isNaN(precio) ? 0 : precio, billing_model: modelo }
                : d
        )
    } else {
        const yaExiste = todaDisponibilidad.find(d =>
            d.provider_id === proveedorActual.id && d.service_id === servicioId
        )
        if (yaExiste) {
            alert(`Este proveedor ya tiene el servicio ${servicioId}. Selecciónalo en la tabla para editarlo.`)
            return
        }
        const { data, error } = await supabase.from('availability').insert({
            provider_id:    proveedorActual.id,
            service_id:     servicioId,
            total_slots:    plazas,
            price_per_slot: isNaN(precio) ? 0 : precio,
            billing_model:  modelo
        }).select()
        if (error) { alert('Error al añadir servicio: ' + error.message); return }
        todaDisponibilidad.push(data[0])
    }

    await recalcularPagoFinalProveedor(proveedorActual.id)
    limpiarFormularioServicio()
    cargarServiciosProveedor(proveedorActual.id)
    cargarPagosProveedor(proveedorActual.id)
})

btnCancelarServicio.addEventListener('click', limpiarFormularioServicio)

// ===== BLOQUE 3: SERVICIOS DEL PROVEEDOR =====
let sortServiciosCol = null
let sortServiciosDir = 'asc'
let serviciosProveedor = []

async function cargarServiciosProveedor(proveedorId) {
    const dispProv = todaDisponibilidad.filter(d => d.provider_id === proveedorId)
    const bloque   = document.getElementById('bloque-servicios-proveedor')

    if (dispProv.length === 0) { bloque.style.display = 'none'; return }

    serviciosProveedor = dispProv
    bloque.style.display = 'block'
    renderTablaServicios(proveedorId)
}

function renderTablaServicios(proveedorId) {
    const cols = [
        { label: 'Servicio',    campo: 'service_id' },
        { label: 'Plazas',      campo: 'total_slots' },
        { label: 'Precio/plaza', campo: 'price_per_slot' },
        { label: 'Modelo',      campo: 'billing_model' },
        { label: 'Coste',       campo: '_coste' },
        { label: 'Reservadas',  campo: '_reservadas' },
        { label: 'Clientes',    campo: '_clientes' },
    ]

    // Enriquecer datos
    let datos = serviciosProveedor.map(d => {
        let coste = 0
        if (d.billing_model === 'capacity') {
            coste = (d.total_slots ?? 0) * parseFloat(d.price_per_slot ?? 0)
        } else {
            const plazasRes = todasReservas
                .filter(r => r.provider_id === proveedorId &&
                             r.service_id  === d.service_id &&
                             r.status      !== 'Cancelada')
                .reduce((s, r) => s + r.slots, 0)
            coste = plazasRes * parseFloat(d.price_per_slot ?? 0)
        }
        const reservasServicio = todasReservas.filter(r =>
            r.provider_id === proveedorId &&
            r.service_id  === d.service_id &&
            r.status      !== 'Cancelada'
        )
        const plazasReservadas = reservasServicio.reduce((s, r) => s + r.slots, 0)
        const clientes         = [...new Set(reservasServicio.map(r => r.client_id))].join('; ')
        return { ...d, _coste: coste, _reservadas: plazasReservadas, _clientes: clientes }
    })

    // Ordenar
    if (sortServiciosCol !== null) {
        const campo = cols[sortServiciosCol].campo
        datos.sort((a, b) => {
            const va = String(a[campo] ?? '')
            const vb = String(b[campo] ?? '')
            const cmp = va.localeCompare(vb, 'es', { numeric: true })
            return sortServiciosDir === 'asc' ? cmp : -cmp
        })
    }

    // Cabeceras con sort
    const thead = document.querySelector('#bloque-servicios-proveedor table thead tr')
    thead.innerHTML = '<th></th>' + cols.map((c, i) => `
        <th style="cursor:pointer; user-select:none" onclick="sortServicios(${i})">
            ${c.label}
            <span style="font-size:10px; opacity:${sortServiciosCol === i ? 1 : 0.4}">
                ${sortServiciosCol === i ? (sortServiciosDir === 'asc' ? '↑' : '↓') : '↕'}
            </span>
        </th>
    `).join('')

    // Filas
    const tbody = document.getElementById('tbody-servicios-proveedor')
    tbody.innerHTML = datos.map(d => `
        <tr data-disp-id="${d.id}" style="cursor:pointer">
            <td><input type="checkbox" class="chk-servicio"></td>
            <td>${d.service_id}</td>
            <td>${d.total_slots}</td>
            <td>${fmt(d.price_per_slot)}</td>
            <td>${d.billing_model === 'consumption'
                ? '<span style="color:var(--accent-warn)">Consumo</span>'
                : 'Capacidad'}</td>
            <td>${fmt(d._coste)}</td>
            <td>${d._reservadas > 0 ? d._reservadas : '—'}</td>
            <td style="font-size:11px; color:var(--subtle)">${d._clientes || '—'}</td>
        </tr>`
    ).join('')

    // Click en fila para editar
    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', e => {
            if (e.target.type === 'checkbox') return
            const dispId = parseInt(tr.dataset.dispId)
            cargarServicioEnFormulario([dispId])
        })
    })
}

window.sortServicios = function(colIdx) {
    if (sortServiciosCol === colIdx) {
        sortServiciosDir = sortServiciosDir === 'asc' ? 'desc' : 'asc'
    } else {
        sortServiciosCol = colIdx
        sortServiciosDir = 'asc'
    }
    if (proveedorActual) renderTablaServicios(proveedorActual.id)
}

// Carga uno o varios servicios en el formulario de edición
function cargarServicioEnFormulario(dispIds) {
    serviciosEditandoIds = dispIds
    const disps = dispIds.map(id => todaDisponibilidad.find(d => d.id === id)).filter(Boolean)
    if (disps.length === 0) return

    ultimoCampoActivo = 'precio'

    if (disps.length === 1) {
        // Edición simple
        servicioEditandoId       = disps[0].id
        inputServicioId.value    = disps[0].service_id
        inputServicioId.disabled = false
        inputPlazas.value        = disps[0].total_slots
        inputPrecio.value        = disps[0].price_per_slot
        inputCosteTotal.value    = (disps[0].total_slots * parseFloat(disps[0].price_per_slot)).toFixed(2)
        selectModelo.value       = disps[0].billing_model
        document.getElementById('titulo-bloque-servicio').textContent = '✏️ Editando servicio'
    } else {
        // Edición múltiple
        servicioEditandoId       = null
        inputServicioId.value    = 'Varios servicios'
        inputServicioId.disabled = true

        // Mostrar valor si coincide en todos, vacío si difiere
        const plazasIguales  = disps.every(d => d.total_slots    === disps[0].total_slots)
        const precioIgual    = disps.every(d => d.price_per_slot === disps[0].price_per_slot)
        const modeloIgual    = disps.every(d => d.billing_model  === disps[0].billing_model)

        inputPlazas.value     = plazasIguales ? disps[0].total_slots    : ''
        inputPrecio.value     = precioIgual   ? disps[0].price_per_slot : ''
        inputCosteTotal.value = (plazasIguales && precioIgual)
            ? (disps[0].total_slots * parseFloat(disps[0].price_per_slot)).toFixed(2) : ''
        selectModelo.value    = modeloIgual   ? disps[0].billing_model  : 'capacity'

        document.getElementById('titulo-bloque-servicio').textContent =
            `✏️ Editando ${disps.length} servicios`
    }

    actualizarCosteServicio()
    btnGuardarServicio.textContent    = '💾 Guardar cambios'
    btnGuardarServicio.disabled       = false
    btnCancelarServicio.style.display = 'inline-block'
    document.getElementById('bloque-servicio').scrollIntoView({ behavior: 'smooth' })
}

// Botón editar seleccionados
document.getElementById('btnEditarServicios').addEventListener('click', () => {
    const checks = [...document.querySelectorAll('.chk-servicio:checked')]
    if (checks.length === 0) {
        alert('Selecciona al menos un servicio para editar')
        return
    }
    const ids = checks.map(chk => parseInt(chk.closest('tr').dataset.dispId))
    cargarServicioEnFormulario(ids)
})

// Eliminar servicios seleccionados
document.getElementById('btnEliminarServicio').addEventListener('click', async () => {
    const checks = [...document.querySelectorAll('.chk-servicio:checked')]
    if (checks.length === 0) return

    if (!confirm(`¿Eliminar ${checks.length} servicio(s) seleccionado(s)?`)) return

    const noEliminados = []
    const eliminados   = []

    for (const chk of checks) {
        const tr      = chk.closest('tr')
        const dispId  = parseInt(tr.dataset.dispId)
        const disp    = todaDisponibilidad.find(d => d.id === dispId)
        if (!disp) continue

        const { service_id: servicioId, provider_id: proveedorId } = disp

        // Verificar reservas activas
        const reservasActivas = todasReservas.filter(r =>
            r.provider_id === proveedorId &&
            r.service_id  === servicioId  &&
            r.status      !== 'Cancelada'
        )
        if (reservasActivas.length > 0) {
            const clientes = [...new Set(reservasActivas.map(r => r.client_id))].join(', ')
            noEliminados.push(`${servicioId} (reservado por: ${clientes})`)
            continue
        }

        // Eliminar disponibilidad
        await supabase.from('availability').delete().eq('id', dispId)
        todaDisponibilidad = todaDisponibilidad.filter(d => d.id !== dispId)
        eliminados.push({ servicioId, proveedorId, dispId })

        // Si el servicio no lo ofrece nadie más, preguntar si borrar servicio
        const otrosProveedores = todaDisponibilidad.filter(d => d.service_id === servicioId)
        if (otrosProveedores.length === 0) {
            const borrarServicio = confirm(
                `"${servicioId}" ya no lo ofrece ningún proveedor.\n` +
                `¿Eliminar también el servicio de la lista de servicios?`
            )
            if (borrarServicio) {
                await supabase.from('services').delete().eq('id', servicioId)
                todosServicios = todosServicios.filter(s => s.id !== servicioId)
            }
        }
    }

    // Comprobar si el proveedor se quedó sin servicios
    const proveedorId = proveedorActual?.id
    if (proveedorId) {
        const serviciosRestantes = todaDisponibilidad.filter(d => d.provider_id === proveedorId)
        if (serviciosRestantes.length === 0 && eliminados.length > 0) {
            const borrarProveedor = confirm(
                `"${proveedorId}" se ha quedado sin servicios.\n` +
                `¿Eliminar también el proveedor?`
            )
            if (borrarProveedor) {
                await supabase.from('payments').delete().eq('provider_id', proveedorId)
                await supabase.from('providers').delete().eq('id', proveedorId)
                todosProveedores = todosProveedores.filter(p => p.id !== proveedorId)
                limpiarProveedor()
                inputProveedorId.value = ''
                if (noEliminados.length > 0) {
                    alert('No se pudieron eliminar:\n' + noEliminados.join('\n'))
                }
                return
            }
        }

        await recalcularPagoFinalProveedor(proveedorId)
        limpiarFormularioServicio()
        cargarServiciosProveedor(proveedorId)
        cargarPagosProveedor(proveedorId)
    }

    if (noEliminados.length > 0) {
        alert('No se pudieron eliminar los siguientes servicios (tienen reservas activas):\n\n' +
              noEliminados.join('\n'))
    }
})

// ===== BLOQUE 4: PAGOS AL PROVEEDOR =====

function calcularCosteTotalProveedor(proveedorId) {
    const dispProv = todaDisponibilidad.filter(d => d.provider_id === proveedorId)
    return dispProv.reduce((total, d) => {
        if (d.billing_model === 'capacity') {
            return total + (d.total_slots ?? 0) * parseFloat(d.price_per_slot ?? 0)
        } else {
            const plazasRes = todasReservas
                .filter(r => r.provider_id === proveedorId &&
                             r.service_id  === d.service_id &&
                             r.status      !== 'Cancelada')
                .reduce((s, r) => s + r.slots, 0)
            return total + plazasRes * parseFloat(d.price_per_slot ?? 0)
        }
    }, 0)
}

async function recalcularPagoFinalProveedor(proveedorId) {
    const costTotal = calcularCosteTotalProveedor(proveedorId)
    const prepagos  = hitosProvTemp.filter(h => !h.esFinal).reduce((s, h) => s + parseFloat(h.amount), 0)
    const pagoFinal = costTotal - prepagos
    const idxFinal  = hitosProvTemp.findIndex(h => h.esFinal)

    if (idxFinal >= 0) {
        hitosProvTemp[idxFinal].amount = pagoFinal
    } else {
        hitosProvTemp.push({ esFinal: true, comments: 'Pago final', amount: pagoFinal, due_date: '2026-07-15', paid: false })
    }
    renderHitosProveedor()
    actualizarResumenCoste(proveedorId, costTotal, prepagos, pagoFinal)
}

function actualizarResumenCoste(proveedorId, costTotal, prepagos, pagoFinal) {
    document.getElementById('resumen-coste-proveedor').innerHTML =
        `Coste total: <strong>${fmt(costTotal)}</strong> &nbsp;|&nbsp; ` +
        `Prepagos: <strong>${fmt(prepagos)}</strong> &nbsp;|&nbsp; ` +
        `Pago final calculado: <strong style="color:${pagoFinal < 0 ? 'var(--accent)' : 'var(--text)'}">` +
        `${fmt(pagoFinal)}</strong>`
}

async function cargarPagosProveedor(proveedorId) {
    const { data } = await supabase
        .from('payments').select('*').eq('provider_id', proveedorId).order('due_date')

    hitosProvTemp = (data ?? []).map(h => ({ ...h, esFinal: h.comments === 'Pago final' }))

    const costTotal = calcularCosteTotalProveedor(proveedorId)
    const prepagos  = hitosProvTemp.filter(h => !h.esFinal).reduce((s, h) => s + parseFloat(h.amount), 0)
    const pagoFinal = costTotal - prepagos

    if (!hitosProvTemp.find(h => h.esFinal)) {
        hitosProvTemp.push({ esFinal: true, comments: 'Pago final', amount: pagoFinal, due_date: '2026-07-15', paid: false })
    } else {
        const idx = hitosProvTemp.findIndex(h => h.esFinal)
        hitosProvTemp[idx].amount = pagoFinal
    }

    renderHitosProveedor()
    actualizarResumenCoste(proveedorId, costTotal, prepagos, pagoFinal)
    document.getElementById('bloque-pagos-proveedor').style.display = 'block'
}

function renderHitosProveedor() {
    const tbody = document.getElementById('tbody-pagos-proveedor')
    tbody.innerHTML = hitosProvTemp.map((h, i) => `
        <tr>
            <td>${h.comments}</td>
            <td>${fmt(h.amount)}${h.esFinal ? ' <span style="font-size:11px;color:var(--subtle)">(calculado)</span>' : ''}</td>
            <td>${h.esFinal
                ? `<input type="date" value="${h.due_date ?? ''}"
                    style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:4px"
                    onchange="cambiarFechaPagoFinal(${i}, this.value)">`
                : (h.due_date ?? '—')}</td>
            <td>${h.paid ? `✅ ${h.paid_date ?? ''}` : '⏳ No'}</td>
            <td style="white-space:nowrap">
                <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;margin-right:4px"
                    onclick="togglePagoProvCobrado(${i})">${h.paid ? 'Marcar pendiente' : 'Marcar pagado'}</button>
                ${!h.esFinal ? `<button class="btn btn-danger" style="padding:4px 8px;font-size:11px"
                    onclick="eliminarHitoProv(${i})">🗑</button>` : ''}
            </td>
        </tr>
    `).join('')
}

window.cambiarFechaPagoFinal = function(idx, valor) { hitosProvTemp[idx].due_date = valor || null }

window.togglePagoProvCobrado = function(idx) {
    const h = hitosProvTemp[idx]
    if (!h.paid) {
        const fecha = prompt('Fecha de pago (dejar vacío para hoy):', hoy)
        if (fecha === null) return
        h.paid = true; h.paid_date = fecha.trim() || hoy
    } else {
        h.paid = false; h.paid_date = null
    }
    renderHitosProveedor()
}

window.eliminarHitoProv = function(idx) {
    hitosProvTemp.splice(idx, 1)
    if (proveedorActual) recalcularPagoFinalProveedor(proveedorActual.id)
}

document.getElementById('btnNuevoPagoProveedor').addEventListener('click', () => {
    document.getElementById('form-nuevo-pago-proveedor').style.display = 'block'
    document.getElementById('btnNuevoPagoProveedor').style.display     = 'none'
})

document.getElementById('btnCancelarPagoProveedor').addEventListener('click', () => {
    document.getElementById('form-nuevo-pago-proveedor').style.display = 'none'
    document.getElementById('btnNuevoPagoProveedor').style.display     = 'inline-block'
})

document.getElementById('btnGuardarPagoProveedor').addEventListener('click', () => {
    const concepto = document.getElementById('pagoProvConcepto').value.trim() || 'Prepago'
    const importe  = parseFloat(document.getElementById('pagoProvImporte').value)
    const fecha    = document.getElementById('pagoProvFecha').value || null
    const pagado   = document.getElementById('pagoProvPagado').value === 'true'
    if (!importe || importe <= 0) { alert('Introduce un importe válido'); return }

    const idxFinal = hitosProvTemp.findIndex(h => h.esFinal)
    hitosProvTemp.splice(idxFinal >= 0 ? idxFinal : hitosProvTemp.length, 0,
        { esFinal: false, comments: concepto, amount: importe, due_date: fecha, paid: pagado })

    document.getElementById('pagoProvConcepto').value = ''
    document.getElementById('pagoProvImporte').value  = ''
    document.getElementById('pagoProvFecha').value    = ''
    document.getElementById('pagoProvPagado').value   = 'false'
    document.getElementById('form-nuevo-pago-proveedor').style.display = 'none'
    document.getElementById('btnNuevoPagoProveedor').style.display     = 'inline-block'
    if (proveedorActual) recalcularPagoFinalProveedor(proveedorActual.id)
})

document.getElementById('btnGuardarPagos').addEventListener('click', async () => {
    if (!proveedorActual) return
    await supabase.from('payments').delete().eq('provider_id', proveedorActual.id)
    for (const h of hitosProvTemp) {
        await supabase.from('payments').insert({
            provider_id: proveedorActual.id,
            amount:      parseFloat(h.amount),
            due_date:    h.due_date,
            paid:        h.paid,
            paid_date:   h.paid_date ?? null,
            comments:    h.comments
        })
    }
    todosPayments = (await supabase.from('payments').select('*')).data
    alert('✅ Pagos guardados correctamente')
})