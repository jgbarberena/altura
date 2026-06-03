import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, fmt, fechaCobroDefault, normalizarId, buscarConPrioridad, persistirCobrosCliente, persistirPagosProveedor, initAutoSave, exportTable } from './utils.js'
import { initFacturacion, abrirPanelFactura } from './factura.js'
import { initPropuesta, abrirPanelPropuesta } from './propuesta.js'
import { syncStockToSfcom, checkSfcomOrders, checkAvailabilityBeforeSave, verificarCoherencia, computeExpectedStock, mostrarModalConfirmacionSfcom, confirmarStockSfcom, extraerNombreProducto, extraerDia, verificarConfirmarSfcom } from './sfcom.js'
import { mostrarToast, mostrarModalVerificacion, mostrarModalPreCorreccion } from './verificacion.js'
import { crearModal } from './modal.js'
import { SYSTEM_PROMPT_ASISTENTE, SYSTEM_PROMPT_PARSING } from './asistente-config.js'

await requireAuth()
initFacturacion(supabase)
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()


// ===== DATOS GLOBALES =====
const { data: todosClientes }  = await supabase.from('clients').select('*').order('id')
const { data: servicios }      = await supabase.from('services').select('*').order('day')
const { data: disponibilidad } = await supabase.from('availability_with_sfcom').select('*')
const { data: providers }      = await supabase.from('providers').select('*').order('id')
let todasReservas              = (await supabase.from('reservations').select('*')).data

initPropuesta(supabase, servicios, providers)

let clienteActual      = null
let reservaEditandoId  = null
let solicitudSfcomRef  = null   // sfcom_order_ref de la solicitud activa (null si no es de sfcom)
let hitosClienteTemp   = []
let _cargandoSolicitud = false
const hoy             = new Date().toISOString().split('T')[0]

// ===== REFERENCIAS DOM =====
const inputId      = document.getElementById('inputClientId')
const inputName    = document.getElementById('inputName')
const inputCompany = document.getElementById('inputCompany')
const inputPhone   = document.getElementById('inputPhone')
const inputEmail   = document.getElementById('inputEmail')
const inputAddress = document.getElementById('inputAddress')
const inputNif     = document.getElementById('inputNif')
const inputComments = document.getElementById('inputComments')
const autoList      = document.getElementById('autocompleteList')
const statusDiv     = document.getElementById('cliente-status')

const selectServicio  = document.getElementById('selectServicio')
const selectProveedor = document.getElementById('selectProveedor')
const inputPlazas     = document.getElementById('inputPlazas')
const inputPrecio     = document.getElementById('inputPrecio')
const selectEstado    = document.getElementById('selectEstado')
const precioStatus    = document.getElementById('precio-status')
const btnAnadir       = document.getElementById('btnAnadirReserva')

// ===== BLOQUE 1: CLIENTE =====

servicios.forEach(s => {
    const opt = document.createElement('option')
    opt.value = s.id
    opt.textContent = s.id
    selectServicio.appendChild(opt)
})

inputId.addEventListener('keydown', e => {
    if (e.key === ' ') {
        e.preventDefault()
        const pos = inputId.selectionStart
        inputId.value = inputId.value.slice(0, pos) + '_' + inputId.value.slice(pos)
        inputId.setSelectionRange(pos + 1, pos + 1)
        mostrarSugerenciasCliente(normalizarId(inputId.value))
    }
})

inputId.addEventListener('input', () => {
    const val = normalizarId(inputId.value)
    inputId.value = val
    mostrarSugerenciasCliente(val)
})

inputId.addEventListener('focus', () => {
    mostrarSugerenciasCliente(normalizarId(inputId.value))
})

function mostrarSugerenciasCliente(val) {
    const coincidencias = val
        ? buscarConPrioridad(todosClientes, val, ['id', 'name', 'company'])
        : todosClientes

    autoList.innerHTML = coincidencias.map(c =>
        `<div data-id="${c.id}">${c.id}</div>`
    ).join('')
    autoList.style.display = coincidencias.length > 0 ? 'block' : 'none'

    const exacto = todosClientes.find(c => c.id === val)
    if (exacto) {
        cargarCliente(exacto)
    } else if (val) {
        if (_cargandoSolicitud) return
        if (clienteActual) {
            inputName.value = inputCompany.value = inputPhone.value =
            inputEmail.value = inputComments.value = ''
            document.getElementById('bloque-reservas-cliente').style.display = 'none'
            document.getElementById('bloque-cobros-cliente').style.display   = 'none'
            limpiarFormularioReserva()
        }
        clienteActual = null
        statusDiv.innerHTML = '✨ Cliente nuevo &nbsp;—&nbsp; ' + '<a href="#" style="font-size:inherit;color:inherit;text-decoration:underline;cursor:pointer"'
            + ' onclick="guardarClienteNuevo(event)">Guardar cliente</a>'
            + ' o se guardará al añadir una reserva'
        statusDiv.style.color = 'var(--accent-warn)'
    } else {
        limpiarCamposCliente()
    }
}

autoList.addEventListener('click', e => {
    const div = e.target.closest('[data-id]')
    if (!div) return
    const cliente = todosClientes.find(c => c.id === div.dataset.id)
    if (cliente) { inputId.value = cliente.id; cargarCliente(cliente); autoList.style.display = 'none' }
})

document.addEventListener('click', e => {
    if (!e.target.closest('.autocomplete-wrap')) autoList.style.display = 'none'
})

function cargarCliente(cliente) {
    clienteActual       = cliente
    inputName.value     = cliente.name     ?? ''
    inputCompany.value  = cliente.company  ?? ''
    inputPhone.value    = cliente.phone    ?? ''
    inputEmail.value    = cliente.email    ?? ''
    inputAddress.value  = cliente.address  ?? ''
    inputNif.value      = cliente.nif      ?? ''
    inputComments.value = cliente.comments ?? ''
    statusDiv.textContent = '✅ Cliente existente — los cambios se guardan automáticamente'
    statusDiv.style.color = 'var(--accent-ok)'
    limpiarFormularioReserva()
    cargarReservasCliente(cliente.id)
}

function limpiarCamposCliente() {
    clienteActual = null
    inputName.value = inputCompany.value = inputPhone.value =
    inputEmail.value = inputComments.value = inputAddress.value = inputNif.value = ''
    statusDiv.textContent = ''
    document.getElementById('bloque-reservas-cliente').style.display = 'none'
    document.getElementById('bloque-cobros-cliente').style.display   = 'none'
    limpiarFormularioReserva()
}

function limpiarFormularioReserva() {
    reservaEditandoId = null
    solicitudSfcomRef = null
    selectServicio.value      = ''
    selectServicio.disabled   = false
    selectProveedor.innerHTML = '<option value="">— Selecciona servicio primero —</option>'
    selectProveedor.disabled  = true
    inputPlazas.value  = ''
    inputPrecio.value  = ''
    selectEstado.value = 'Confirmada'
    document.getElementById('inputReservaComments').value = ''
    document.getElementById('inputTotal').value           = '—'
    document.getElementById('titulo-bloque-reserva').textContent = '📋 Nueva Reserva'
    precioStatus.textContent = ''
    inputPrecio.className    = ''
    btnAnadir.disabled        = true
    btnAnadir.textContent     = 'Añadir reserva'
    document.getElementById('btnCancelarEdicion').style.display = 'none'
    document.querySelectorAll('.chk-reserva:checked').forEach(chk => chk.checked = false)
    document.getElementById('bloque-disponibilidad').style.display = 'none'
    document.getElementById('columnas-proveedores').innerHTML       = ''
    sortReservasCol = null
    sortReservasDir = 'asc'
}

const camposCliente = [inputName, inputCompany, inputPhone, inputEmail, inputAddress, inputNif, inputComments]
const camposDB      = ['name', 'company', 'phone', 'email', 'address', 'nif', 'comments']
initAutoSave(supabase, camposCliente, camposDB, 'clients', () => clienteActual, {
    onSaved: () => {
        statusDiv.textContent = '✅ Guardado'
        statusDiv.style.color = 'var(--accent-ok)'
        setTimeout(() => { statusDiv.textContent = '✅ Cliente existente — los cambios se guardan automáticamente' }, 2000)
    },
    onError: err => {
        statusDiv.textContent = '❌ Error: ' + err.message
        statusDiv.style.color = 'var(--accent)'
    }
})

// Guarda un cliente nuevo en la BBDD sin necesidad de añadir una reserva
// Se llama desde el enlace del statusDiv cuando el ID no existe en la BBDD
window.guardarClienteNuevo = async function(e) {
    e.preventDefault()
    const clienteId = normalizarId(inputId.value)
    if (!clienteId) return

    const { error } = await supabase.from('clients').insert({
        id:       clienteId,
        name:     inputName.value.trim()     || null,
        company:  inputCompany.value.trim()  || null,
        phone:    inputPhone.value.trim()    || null,
        email:    inputEmail.value.trim()    || null,
        address:  inputAddress.value.trim()  || null,
        nif:      inputNif.value.trim()      || null,
        comments: inputComments.value.trim() || null
    })
    if (error) { alert('Error al guardar el cliente: ' + error.message); return }

    clienteActual = { id: clienteId, name: inputName.value.trim() || null }
    todosClientes.push(clienteActual)
    statusDiv.innerHTML = ''
    statusDiv.textContent = '✅ Cliente guardado — los cambios se guardan automáticamente'
    statusDiv.style.color = 'var(--accent-ok)'
}

// ===== BLOQUE 2: RESERVA =====

function _preguntarCambioServicio(reservaId, servicioNuevo, servicioActual) {
    return new Promise(resolve => {
        const { overlay, panel } = crearModal('modal-cambio-servicio', { narrow: true })
        panel.innerHTML = `
            <div class="modal-header-desc">
                Estás editando <strong>${reservaId}</strong> (servicio: <strong>${servicioActual}</strong>).<br><br>
                ¿Quieres cambiar el servicio de esta reserva a <strong>${servicioNuevo}</strong>,
                o descartar la edición y crear una reserva nueva?
            </div>
            <div class="modal-actions">
                <button id="mcs-cambiar"  class="btn btn-primary">Cambiar servicio</button>
                <button id="mcs-nueva"    class="btn btn-secondary">Nueva reserva</button>
                <button id="mcs-cancelar" class="btn btn-secondary">Cancelar</button>
            </div>`
        panel.querySelector('#mcs-cambiar').addEventListener('click',  () => { overlay.remove(); resolve('cambiar') })
        panel.querySelector('#mcs-nueva').addEventListener('click',    () => { overlay.remove(); resolve('nueva') })
        panel.querySelector('#mcs-cancelar').addEventListener('click', () => { overlay.remove(); resolve(null) })
    })
}

selectServicio.addEventListener('change', async () => {
    if (reservaEditandoId) {
        const reservaActual = todasReservas.find(r => r.id === reservaEditandoId)
        if (reservaActual && selectServicio.value !== reservaActual.service_id) {
            const servicioNuevo = selectServicio.value
            const decision      = await _preguntarCambioServicio(reservaEditandoId, servicioNuevo, reservaActual.service_id)
            if (decision === null) { selectServicio.value = reservaActual.service_id; return }
            if (decision === 'nueva') { limpiarFormularioReserva(); selectServicio.value = servicioNuevo }
        }
    }
    actualizarProveedores()
    actualizarBtnAnadir()
    actualizarBloque3()
})

inputPlazas.addEventListener('input', () => {
    actualizarProveedores()
    actualizarTotal()
    actualizarBtnAnadir()
    actualizarBloque3()
})

inputPrecio.addEventListener('input', () => {
    validarPrecio()
    actualizarTotal()
    actualizarBtnAnadir()
})

selectProveedor.addEventListener('change', () => {
    validarPrecio()
    actualizarBtnAnadir()
    actualizarBloque3()

    // Si el proveedor seleccionado no tiene plazas suficientes, lanzar el dialog
    // de reorganización igual que si se hubiera pulsado en la cajita del panel
    const proveedorId = selectProveedor.value
    const servicioId  = selectServicio.value
    const plazas      = parseInt(inputPlazas.value) || 0
    if (proveedorId && servicioId && plazas > 0) {
        const { libres } = getPlazasInfo(proveedorId, servicioId, reservaEditandoId)
        if (libres < plazas) abrirPanelReorganizar(proveedorId, servicioId, plazas)
    }
})

function actualizarTotal() {
    const plazas = parseInt(inputPlazas.value) || 0
    const precio = parseFloat(inputPrecio.value) || 0
    const total  = plazas * precio
    document.getElementById('inputTotal').value =
        total > 0 ? total.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }) : '—'
}

function getPlazasInfo(proveedorId, servicioId, excluirId = null) {
    const reservasPS  = todasReservas.filter(r =>
        r.provider_id === proveedorId &&
        r.service_id  === servicioId  &&
        r.status      !== 'Cancelada' &&
        r.id          !== excluirId
    )
    const confirmadas = reservasPS.filter(r => r.status === 'Confirmada').reduce((s, r) => s + r.slots, 0)
    const pendientes  = reservasPS.filter(r => r.status === 'Pendiente').reduce((s, r) => s + r.slots, 0)
    const disp        = disponibilidad.find(d => d.provider_id === proveedorId && d.service_id === servicioId)
    const total       = disp?.total_slots ?? 0
    const libres      = total - confirmadas - pendientes
    return { total, confirmadas, pendientes, libres }
}

function actualizarProveedores() {
    const servicioId      = selectServicio.value
    const plazas          = parseInt(inputPlazas.value) || 0
    const proveedorActual = selectProveedor.value

    selectProveedor.innerHTML = '<option value="">— Selecciona proveedor —</option>'
    if (!servicioId) { selectProveedor.disabled = true; return }

    const dispServicio = disponibilidad.filter(d => d.service_id === servicioId)
    if (dispServicio.length === 0) { selectProveedor.disabled = true; return }

    selectProveedor.disabled = false

    dispServicio.forEach(d => {
        const { total, pendientes, libres } = getPlazasInfo(d.provider_id, servicioId, reservaEditandoId)
        if (plazas > 0 && total < plazas) return

        let simbolo = ''
        if (plazas > 0) {
            if      (libres >= plazas)                            simbolo = '✅'
            else if (libres > 0 && libres + pendientes >= plazas) simbolo = '⚠️'
            else if (libres === 0 && pendientes >= plazas)        simbolo = '⚠️⚠️'
            else if (libres > 0 && libres < plazas)               simbolo = '❌'
            else                                                   simbolo = '❌❌'
        }

        const opt = document.createElement('option')
        opt.value       = d.provider_id
        opt.textContent = `${d.provider_id} (${libres}/${total})${simbolo ? ' ' + simbolo : ''}`
        selectProveedor.appendChild(opt)
    })

    if (proveedorActual) {
        const opcionExiste = [...selectProveedor.options].some(o => o.value === proveedorActual)
        if (opcionExiste) {
            selectProveedor.value = proveedorActual
            if (plazas > 0) {
                const { libres } = getPlazasInfo(proveedorActual, servicioId, reservaEditandoId)
                if (libres < plazas) {
                    precioStatus.textContent = `⚠️ ${proveedorActual} no tiene plazas libres suficientes para ${plazas} plazas`
                    precioStatus.style.color = 'var(--accent-warn)'
                }
            }
        }
    }

    if (proveedorActual && selectProveedor.value === proveedorActual) {
        const { libres } = getPlazasInfo(proveedorActual, servicioId, reservaEditandoId)
        if (plazas === 0 || libres >= plazas) {
            if (precioStatus.textContent.includes('no tiene plazas')) {
                precioStatus.textContent = ''
                precioStatus.style.color = ''
            }
        }
    }
}

function validarPrecio() {
    const servicioId  = selectServicio.value
    const proveedorId = selectProveedor.value
    const precio      = parseFloat(inputPrecio.value)

    if (!servicioId || !proveedorId || isNaN(precio)) {
        if (servicioId && proveedorId && inputPrecio.value.trim() === '') {
            precioStatus.textContent = 'Introduce el precio. Si es 0, indícalo explícitamente.'
            precioStatus.style.color = 'var(--subtle)'
        } else {
            precioStatus.textContent = ''
        }
        inputPrecio.className = ''
        return
    }

    const disp = disponibilidad.find(d => d.service_id === servicioId && d.provider_id === proveedorId)
    if (!disp) return

    if (disp.billing_model === 'fixed') {
        const fixedCost = parseFloat(disp.price_per_slot) || 0
        const plazas    = parseInt(inputPlazas.value) || 0
        const ingresoExistente = todasReservas
            .filter(r => r.provider_id === proveedorId &&
                         r.service_id  === servicioId  &&
                         r.status      !== 'Cancelada' &&
                         (reservaEditandoId ? r.id !== reservaEditandoId : true))
            .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
        const ingresoTotal = ingresoExistente + plazas * precio
        if (fixedCost === 0) {
            inputPrecio.className    = precio > 0 ? 'ok' : ''
            precioStatus.textContent = precio > 0 ? '✅ Precio libre (coste fijo 0)' : ''
        } else if (ingresoTotal < fixedCost) {
            inputPrecio.className    = 'error'
            precioStatus.style.color = 'var(--accent)'
            precioStatus.textContent = `❌ Ingresos (${fmt(ingresoTotal)}) < coste fijo (${fmt(fixedCost)})`
        } else {
            inputPrecio.className    = 'ok'
            precioStatus.style.color = 'var(--accent-ok)'
            precioStatus.textContent = `✅ Cubre coste fijo — ingreso acumulado: ${fmt(ingresoTotal)}`
        }
        return
    }

    const coste = parseFloat(disp.price_per_slot) || 0
    if (coste === 0) {
        inputPrecio.className    = precio > 0 ? 'ok' : ''
        precioStatus.textContent = precio > 0 ? '✅ Precio libre (coste 0)' : ''
        return
    }

    const margen = (precio - coste) / coste
    if (precio < coste) {
        inputPrecio.className    = 'error'
        precioStatus.style.color = 'var(--accent)'
        precioStatus.textContent = `❌ Por debajo del coste (${coste}€/plaza)`
    } else if (precio === coste) {
        inputPrecio.className    = 'warn'
        precioStatus.style.color = 'var(--accent-warn)'
        precioStatus.textContent = `⚠️ Al coste exacto, sin margen`
    } else if (margen < 0.10) {
        inputPrecio.className    = 'warn'
        precioStatus.style.color = 'var(--accent-warn)'
        precioStatus.textContent = `⚠️ Margen bajo — coste: ${coste}€/plaza`
    } else {
        inputPrecio.className    = 'ok'
        precioStatus.style.color = 'var(--accent-ok)'
        precioStatus.textContent = `✅ Margen OK — coste: ${coste}€/plaza`
    }
}

function actualizarBtnAnadir() {
    const tieneCliente   = inputId.value.trim().length > 0
    const tieneServicio  = selectServicio.value !== ''
    const tieneProveedor = selectProveedor.value !== ''
    const plazasVal      = inputPlazas.value.trim()
    const tienePlazas    = plazasVal !== '' && !isNaN(parseInt(plazasVal)) && parseInt(plazasVal) >= 0
    const precioVal      = inputPrecio.value.trim()
    const tienePrecio    = precioVal !== '' && !isNaN(parseFloat(precioVal))
    btnAnadir.disabled   = !(tieneCliente && tieneServicio && tieneProveedor && tienePlazas && tienePrecio)
}

// ===== BLOQUE 4: RESERVAS DEL CLIENTE =====

let sortReservasCol = null
let sortReservasDir = 'asc'
let reservasCliente = []

async function cargarReservasCliente(clienteId) {
    const { data: reservasRaw } = await supabase
        .from('reservations')
        .select('*, services(description)')
        .eq('client_id', clienteId)
        .order('id')
    // Aplanar el objeto anidado services.description a service_description
    const reservas = (reservasRaw ?? []).map(r => ({
        ...r,
        service_description: r.services?.description ?? null,
        services: undefined  // limpiar el objeto anidado
    }))

    const bloque = document.getElementById('bloque-reservas-cliente')

    if (!reservas || reservas.length === 0) {
        bloque.style.display = 'none'
        document.getElementById('bloque-cobros-cliente').style.display = 'none'
        return
    }

    reservasCliente = reservas
    bloque.style.display = 'block'
    renderTablaReservas()
    await cargarCobrosCliente(clienteId, reservas)
}

function renderTablaReservas() {
    const cols = [
        { label: 'ID',          campo: 'id' },
        { label: 'Servicio',    campo: 'service_id' },
        { label: 'Proveedor',   campo: 'provider_id' },
        { label: 'Plazas',      campo: 'slots' },
        { label: '€/plaza',     campo: 'price_per_slot' },
        { label: 'Total',       campo: 'total_amount' },
        { label: 'Estado',      campo: 'status' },
        { label: 'Propuesta',   campo: 'proposal_number' },
    ]

    let datos = [...reservasCliente]
    if (sortReservasCol !== null) {
        datos.sort((a, b) => {
            const va = String(a[cols[sortReservasCol].campo] ?? '')
            const vb = String(b[cols[sortReservasCol].campo] ?? '')
            const cmp = va.localeCompare(vb, 'es', { numeric: true })
            return sortReservasDir === 'asc' ? cmp : -cmp
        })
    }

    const thead = document.querySelector('#bloque-reservas-cliente table thead tr')
    thead.innerHTML = '<th></th>' + cols.map((c, i) => `
        <th style="cursor:pointer; user-select:none" onclick="sortReservasCliente(${i})">
            ${c.label}
            <span style="font-size:10px; opacity:${sortReservasCol === i ? 1 : 0.4}">
                ${sortReservasCol === i ? (sortReservasDir === 'asc' ? '↑' : '↓') : '↕'}
            </span>
        </th>
    `).join('')

    const tbody = document.getElementById('tbody-reservas-cliente')
    tbody.innerHTML = datos.map(r => {
        const celdaPropuesta = r.proposal_number
            ? (r.proposal_path
                ? `<span style="font-size:11px;color:var(--accent-ok);cursor:pointer;text-decoration:underline"
                       onclick="descargarPropuesta('${r.proposal_path}', '${r.proposal_number}')"
                       title="Descargar ${r.proposal_number}">📋 ${r.proposal_number}</span>`
                : `<span style="font-size:11px;color:var(--accent-ok)">📋 ${r.proposal_number}</span>`)
            : '—'

        return `
        <tr data-id="${r.id}" style="cursor:pointer">
            <td><input type="checkbox" class="chk-reserva"></td>
            <td>${r.id}</td>
            <td>${r.service_id}</td>
            <td>${r.provider_id}</td>
            <td>${r.slots}</td>
            <td>${r.price_per_slot}€</td>
            <td>${r.total_amount}€</td>
            <td class="${r.status === 'Confirmada' ? 'ok' : r.status === 'Cancelada' ? 'error' : 'warn'}">${r.status}</td>
            <td>${celdaPropuesta}</td>
        </tr>`
    }).join('')

    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', e => {
            if (e.target.type === 'checkbox' || e.target.closest('[onclick]')) return
            const id      = tr.dataset.id
            const reserva = todasReservas.find(r => r.id === id)
            if (!reserva) return
            document.querySelectorAll('.chk-reserva').forEach(chk => chk.checked = false)
            tr.querySelector('.chk-reserva').checked = true
            cargarReservaEnFormulario(reserva)
        })
    })
}

window.sortReservasCliente = function(colIdx) {
    if (sortReservasCol === colIdx) {
        sortReservasDir = sortReservasDir === 'asc' ? 'desc' : 'asc'
    } else {
        sortReservasCol = colIdx
        sortReservasDir = 'asc'
    }
    renderTablaReservas()
}

function cargarReservaEnFormulario(reserva) {
    reservaEditandoId       = reserva.id
    selectServicio.value    = reserva.service_id
    selectServicio.disabled = false
    actualizarProveedores()

    setTimeout(() => {
        selectProveedor.value = reserva.provider_id
        validarPrecio()
        actualizarBloque3()
        actualizarBtnAnadir()
    }, 50)

    inputPlazas.value  = reserva.slots
    inputPrecio.value  = reserva.price_per_slot
    selectEstado.value = reserva.status
    document.getElementById('inputReservaComments').value = reserva.comments ?? ''
    document.getElementById('titulo-bloque-reserva').textContent = `✏️ Editando ${reserva.id}`
    actualizarTotal()
    actualizarBtnAnadir()

    btnAnadir.textContent = '💾 Guardar cambios'
    document.getElementById('btnCancelarEdicion').style.display = 'inline-block'
    document.getElementById('bloque-reserva').scrollIntoView({ behavior: 'smooth' })
}

async function cambiarEstadoSeleccionadas(nuevoEstado) {
    const ids = [...document.querySelectorAll('.chk-reserva:checked')]
        .map(chk => chk.closest('tr').dataset.id)
    if (ids.length === 0) return

    const afectadas = [...new Map(
        todasReservas.filter(r => ids.includes(r.id))
            .map(r => [`${r.provider_id}|${r.service_id}`, { proveedorId: r.provider_id, servicioId: r.service_id }])
    ).values()]

    // Modal consultivo cuando el cambio altera el conteo de reservas activas en sfcom.
    // pairsConCambio recoge solo los pares con delta real — Pendiente↔Confirmada no aparece.
    let pairsConCambio = []
    let sfcomResultEstado = 'sync'
    if (nuevoEstado === 'Cancelada') {
        // Cancelar reservas activas → stock sube (deltas negativos de plazas activas)
        pairsConCambio = [...new Map(
            todasReservas.filter(r => ids.includes(r.id) && r.status !== 'Cancelada')
                .map(r => [`${r.provider_id}|${r.service_id}`, { providerId: r.provider_id, serviceId: r.service_id }])
        ).values()].map(p => {
            const activas    = todasReservas.filter(r => ids.includes(r.id) && r.provider_id === p.providerId && r.service_id === p.serviceId && r.status !== 'Cancelada')
            const allDelta   = -activas.reduce((s, r) => s + (r.slots ?? 0), 0)
            const sfcomDelta = -activas.filter(r => r.sfcom_order_ref).reduce((s, r) => s + (r.slots ?? 0), 0)
            return { ...p, sfcomDelta, allDelta }
        })
        if (pairsConCambio.length > 0) {
            sfcomResultEstado = await confirmarStockSfcom(supabase, pairsConCambio)
            if (sfcomResultEstado === 'cancel') return
        }
    } else {
        // Reactivar reservas canceladas → stock baja (deltas positivos de plazas que vuelven a ser activas)
        pairsConCambio = [...new Map(
            todasReservas.filter(r => ids.includes(r.id) && r.status === 'Cancelada')
                .map(r => [`${r.provider_id}|${r.service_id}`, { providerId: r.provider_id, serviceId: r.service_id }])
        ).values()].map(p => {
            const reactivadas = todasReservas.filter(r => ids.includes(r.id) && r.provider_id === p.providerId && r.service_id === p.serviceId && r.status === 'Cancelada')
            const allDelta    = reactivadas.reduce((s, r) => s + (r.slots ?? 0), 0)
            const sfcomDelta  = reactivadas.filter(r => r.sfcom_order_ref).reduce((s, r) => s + (r.slots ?? 0), 0)
            return { ...p, sfcomDelta, allDelta }
        })
        for (const p of pairsConCambio) {
            if (p.allDelta <= 0) continue
            const sfcomResult = await checkAvailabilityBeforeSave(supabase, p.providerId, p.serviceId, p.allDelta)
            if (sfcomResult.sfcomCheck && sfcomResult.warning) {
                if (!confirm(`Aviso de sfcom:\n\n${sfcomResult.warning}\n\n¿Deseas continuar igualmente?`)) return
            }
        }
        if (pairsConCambio.length > 0) {
            sfcomResultEstado = await confirmarStockSfcom(supabase, pairsConCambio)
            if (sfcomResultEstado === 'cancel') return
        }
    }

    const { error } = await supabase.from('reservations').update({ status: nuevoEstado }).in('id', ids)
    if (!error && clienteActual) {
        todasReservas = todasReservas.map(r =>
            ids.includes(r.id) ? { ...r, status: nuevoEstado } : r
        )
        await persistirCobrosCliente(supabase, clienteActual.id, todasReservas)
        const pairsConCambioSet = new Set(pairsConCambio.map(p => `${p.providerId}|${p.serviceId}`))
        for (const { proveedorId, servicioId } of afectadas) {
            await persistirPagosProveedor(supabase, proveedorId, todasReservas, disponibilidad)
            if (pairsConCambioSet.has(`${proveedorId}|${servicioId}`) && sfcomResultEstado === 'sync')
                await syncStockToSfcom(supabase, proveedorId, servicioId)
        }
        cargarReservasCliente(clienteActual.id)
        actualizarProveedores()
    }
}

async function eliminarSeleccionadas() {
    const ids = [...document.querySelectorAll('.chk-reserva:checked')]
        .map(chk => chk.closest('tr').dataset.id)
    if (ids.length === 0) return
    if (!confirm(`¿Eliminar ${ids.length} reserva(s) definitivamente?`)) return

    // Modal consultivo: eliminar reservas activas sube el stock en sfcom
    const pairsParaModal = [...new Map(
        todasReservas.filter(r => ids.includes(r.id) && r.status !== 'Cancelada')
            .map(r => [`${r.provider_id}|${r.service_id}`, { providerId: r.provider_id, serviceId: r.service_id }])
    ).values()].map(p => {
        const activas    = todasReservas.filter(r => ids.includes(r.id) && r.provider_id === p.providerId && r.service_id === p.serviceId && r.status !== 'Cancelada')
        const allDelta   = -activas.reduce((s, r) => s + (r.slots ?? 0), 0)
        const sfcomDelta = -activas.filter(r => r.sfcom_order_ref).reduce((s, r) => s + (r.slots ?? 0), 0)
        return { ...p, sfcomDelta, allDelta }
    })
    let sfcomResultElim = 'sync'
    if (pairsParaModal.length > 0) {
        sfcomResultElim = await confirmarStockSfcom(supabase, pairsParaModal)
        if (sfcomResultElim === 'cancel') return
    }

    const afectadas = [...todasReservas
        .filter(r => ids.includes(r.id))
        .reduce((map, r) => {
            const key  = `${r.provider_id}|${r.service_id}`
            const prev = map.get(key)
            map.set(key, {
                proveedorId: r.provider_id,
                servicioId:  r.service_id,
                cancelada:   prev ? (prev.cancelada && r.status === 'Cancelada') : r.status === 'Cancelada'
            })
            return map
        }, new Map()).values()]

    const { error: errReservas } = await supabase.from('reservations').delete().in('id', ids)
    if (errReservas) { alert('Error al borrar reservas: ' + errReservas.message); return }

    todasReservas = todasReservas.filter(r => !ids.includes(r.id))

    if (clienteActual) {
        const reservasRestantes = todasReservas.filter(r => r.client_id === clienteActual.id)
        if (reservasRestantes.length === 0) {
            const borrar = confirm(`${clienteActual.id} no tiene más reservas. ¿Deseas eliminar también el cliente?`)
            if (borrar) {
                await supabase.from('clients').delete().eq('id', clienteActual.id)
                todosClientes.splice(todosClientes.findIndex(c => c.id === clienteActual.id), 1)
                limpiarCamposCliente()
                inputId.value = ''
                return
            }
        }
        await persistirCobrosCliente(supabase, clienteActual.id, todasReservas)
    }

    for (const { proveedorId, servicioId, cancelada } of afectadas) {
        await persistirPagosProveedor(supabase, proveedorId, todasReservas, disponibilidad)
        if (!cancelada && sfcomResultElim === 'sync') await syncStockToSfcom(supabase, proveedorId, servicioId)
    }

    limpiarFormularioReserva()
    await cargarReservasCliente(clienteActual.id)
    actualizarProveedores()
}

document.getElementById('btnCancelar').addEventListener('click', () => cambiarEstadoSeleccionadas('Cancelada'))
document.getElementById('btnEliminar').addEventListener('click', eliminarSeleccionadas)
document.getElementById('btnCancelarEdicion').addEventListener('click', limpiarFormularioReserva)

document.getElementById('btnGenerarPropuesta').addEventListener('click', () => {
    if (!clienteActual) return

    // Reservas seleccionadas con checkbox; si ninguna, todas las Pendientes
    const seleccionadas = [...document.querySelectorAll('.chk-reserva:checked')]
        .map(chk => chk.closest('tr').dataset.id)

    const reservasFiltradas = seleccionadas.length > 0
        ? reservasCliente.filter(r => seleccionadas.includes(r.id))
        : reservasCliente.filter(r => r.status === 'Pendiente')

    if (reservasFiltradas.length === 0) {
        alert('No hay reservas Pendientes para incluir en la propuesta.')
        return
    }

    abrirPanelPropuesta(clienteActual, reservasFiltradas)
})

// ===== AÑADIR / GUARDAR RESERVA =====

function setGuardando(on) {
    if (on) {
        btnAnadir.disabled              = true
        btnAnadir.dataset.textoOriginal = btnAnadir.textContent
        btnAnadir.textContent           = 'Guardando…'
    } else {
        btnAnadir.textContent = btnAnadir.dataset.textoOriginal ?? 'Añadir reserva'
        delete btnAnadir.dataset.textoOriginal
        actualizarBtnAnadir()
    }
}

btnAnadir.addEventListener('click', async () => {
    const clienteId   = inputId.value.trim().toUpperCase()
    const servicioId  = selectServicio.value
    const proveedorId = selectProveedor.value
    const plazas      = parseInt(inputPlazas.value)
    const precio      = parseFloat(inputPrecio.value)
    const estado      = selectEstado.value
    const comments    = document.getElementById('inputReservaComments').value.trim() || null

    if (plazas < 0) { alert('El número de plazas no puede ser negativo.'); return }
    if (plazas === 0) { if (!confirm('¿Crear una reserva con 0 plazas?')) return }

    setGuardando(true)
    try {

    if (reservaEditandoId) {
        const reservaOriginal     = todasReservas.find(r => r.id === reservaEditandoId)
        const proveedorIdAnterior = reservaOriginal?.provider_id
        const servicioIdAnterior  = reservaOriginal?.service_id

        // Calcular deltas para el modal consultivo antes de guardar
        const pairsParaModal = []
        const parCambia  = proveedorId !== proveedorIdAnterior || servicioId !== servicioIdAnterior
        const esSfcomRes = Boolean(reservaOriginal?.sfcom_order_ref)
        if (parCambia) {
            const eraActiva  = reservaOriginal?.status !== 'Cancelada'
            const seraActiva = estado !== 'Cancelada'
            if (eraActiva) pairsParaModal.push({
                providerId: proveedorIdAnterior, serviceId: servicioIdAnterior,
                sfcomDelta: esSfcomRes ? -(reservaOriginal?.slots ?? 0) : 0,
                allDelta:   -(reservaOriginal?.slots ?? 0)
            })
            if (seraActiva) pairsParaModal.push({
                providerId: proveedorId, serviceId: servicioId,
                sfcomDelta: esSfcomRes ? plazas : 0,
                allDelta:   plazas
            })
        } else {
            const eraActiva  = reservaOriginal?.status !== 'Cancelada'
            const seraActiva = estado !== 'Cancelada'
            const allDelta   = (seraActiva ? plazas : 0) - (eraActiva ? (reservaOriginal?.slots ?? 0) : 0)
            const sfcomDelta = esSfcomRes ? allDelta : 0
            if (allDelta !== 0) pairsParaModal.push({ providerId: proveedorId, serviceId: servicioId, sfcomDelta, allDelta })
        }
        for (const p of pairsParaModal) {
            if (p.allDelta <= 0) continue
            const sfcomResult = await checkAvailabilityBeforeSave(supabase, p.providerId, p.serviceId, p.allDelta)
            if (sfcomResult.sfcomCheck && sfcomResult.warning) {
                if (!confirm(`Aviso de sfcom:\n\n${sfcomResult.warning}\n\n¿Deseas continuar igualmente?`)) return
            }
        }

        let sfcomResultEdit = 'sync'
        if (pairsParaModal.length > 0) {
            sfcomResultEdit = await confirmarStockSfcom(supabase, pairsParaModal)
            if (sfcomResultEdit === 'cancel') return
        }

        const { error } = await supabase.from('reservations').update({
            service_id: servicioId, provider_id: proveedorId,
            slots: plazas, price_per_slot: precio, status: estado, comments
        }).eq('id', reservaEditandoId)
        if (error) { alert('Error al guardar: ' + error.message); return }

        const { data: reservasActualizadas } = await supabase.from('reservations').select('*')
        todasReservas = reservasActualizadas

        await persistirCobrosCliente(supabase, clienteActual.id, todasReservas)
        await persistirPagosProveedor(supabase, proveedorId, todasReservas, disponibilidad)
        if (proveedorIdAnterior !== undefined && proveedorIdAnterior !== proveedorId) {
            await persistirPagosProveedor(supabase, proveedorIdAnterior, todasReservas, disponibilidad)
        }
        for (const p of pairsParaModal)
            if (sfcomResultEdit === 'sync') await syncStockToSfcom(supabase, p.providerId, p.serviceId)
        await cargarReservasCliente(clienteActual.id)
        actualizarProveedores()
        limpiarFormularioReserva()

    } else {
        const { libres } = getPlazasInfo(proveedorId, servicioId)
        if (libres < plazas) {
            alert(`No hay suficientes plazas libres. Disponibles: ${libres}, necesitas: ${plazas}`)
            return
        }

        const sfcomResult = await checkAvailabilityBeforeSave(supabase, proveedorId, servicioId, plazas)
        if (!sfcomResult.ok) {
            alert(`No se puede guardar la reserva:\n\n${sfcomResult.message}`)
            return
        }
        if (sfcomResult.sfcomCheck && sfcomResult.warning) {
            if (!confirm(`Aviso de sfcom:\n\n${sfcomResult.warning}\n\n¿Deseas continuar igualmente?`)) return
        }

        const sfcomResultNuevo = await confirmarStockSfcom(supabase, [{
            providerId: proveedorId, serviceId: servicioId,
            sfcomDelta: solicitudSfcomRef ? plazas : 0,
            allDelta:   plazas
        }])
        if (sfcomResultNuevo === 'cancel') return

        if (!clienteActual) {
            const nombre = inputName.value.trim()
            if (!confirm(`¿Crear cliente nuevo "${clienteId}"${nombre ? ' (' + nombre + ')' : ''}?`)) return
            const { error: errCliente } = await supabase.from('clients').insert({
                id:       clienteId,
                name:     nombre || null,
                company:  inputCompany.value.trim()  || null,
                phone:    inputPhone.value.trim()    || null,
                email:    inputEmail.value.trim()    || null,
                address:  inputAddress.value.trim()  || null,
                nif:      inputNif.value.trim()      || null,
                comments: inputComments.value.trim() || null
            })
            if (errCliente) { alert('Error al crear cliente: ' + errCliente.message); return }
            clienteActual = { id: clienteId, name: nombre }
            todosClientes.push(clienteActual)
            statusDiv.textContent = '✅ Cliente creado'
            statusDiv.style.color = 'var(--accent-ok)'
        }

        const { data: ultima } = await supabase
            .from('reservations').select('id').order('id', { ascending: false }).limit(1)
        const ultimoNum = ultima?.length > 0 ? parseInt(ultima[0].id.slice(1)) + 1 : 1
        const nuevaId   = 'R' + String(ultimoNum).padStart(4, '0')

        const { error: errReserva } = await supabase.from('reservations').insert({
            id: nuevaId, client_id: clienteActual.id,
            provider_id: proveedorId, service_id: servicioId,
            slots: plazas, price_per_slot: precio, status: estado, comments,
            sfcom_order_ref: solicitudSfcomRef || null
        })
        if (errReserva) { alert('Error al crear reserva: ' + errReserva.message); return }

        const { data: reservasActualizadas } = await supabase.from('reservations').select('*')
        todasReservas = reservasActualizadas

        await persistirCobrosCliente(supabase, clienteActual.id, todasReservas)
        await persistirPagosProveedor(supabase, proveedorId, todasReservas, disponibilidad)
        if (sfcomResultNuevo === 'sync') await syncStockToSfcom(supabase, proveedorId, servicioId)
        await cargarReservasCliente(clienteActual.id)
        actualizarProveedores()
        limpiarFormularioReserva()
    }
    } finally {
        setGuardando(false)
    }
})

// ===== BLOQUE 3: DISPONIBILIDAD =====

function actualizarBloque3() {
    const servicioId  = selectServicio.value
    const plazas      = parseInt(inputPlazas.value) || 0
    const proveedorId = selectProveedor.value
    const bloque      = document.getElementById('bloque-disponibilidad')
    if (!servicioId) { bloque.style.display = 'none'; return }
    bloque.style.display = 'block'
    actualizarMapaProveedores(servicioId, plazas, proveedorId)
}

function actualizarMapaProveedores(servicioId, plazas, proveedorSeleccionado) {
    const dispServicio = disponibilidad.filter(d => d.service_id === servicioId)
    const contenedor   = document.getElementById('columnas-proveedores')

    if (dispServicio.length === 0) {
        contenedor.innerHTML = '<p style="color:var(--subtle);font-size:13px">Sin proveedores para este servicio</p>'
        return
    }

    const proveedoresConInfo = dispServicio.map(d => ({
        d, ...getPlazasInfo(d.provider_id, servicioId, reservaEditandoId)
    })).filter(({ total }) => plazas === 0 || total >= plazas)
    .sort((a, b) => b.libres - a.libres)

    contenedor.innerHTML = proveedoresConInfo.map(({ d, total, pendientes, libres }) => {
        let claseDisp = '', simbolo = ''
        if (plazas > 0) {
            if      (libres >= plazas)                            { claseDisp = 'disp-ok';    simbolo = '✅' }
            else if (libres > 0 && libres + pendientes >= plazas) { claseDisp = 'disp-warn';  simbolo = '⚠️' }
            else if (libres === 0 && pendientes >= plazas)        { claseDisp = 'disp-warn';  simbolo = '⚠️⚠️' }
            else if (libres > 0)                                   { claseDisp = 'disp-error'; simbolo = '❌' }
            else                                                   { claseDisp = 'disp-error'; simbolo = '❌❌' }
        } else {
            if      (libres > 0)   claseDisp = 'disp-ok'
            else if (libres === 0) claseDisp = 'disp-warn'
            else                   claseDisp = 'disp-error'
        }

        const esSeleccionado = proveedorSeleccionado && d.provider_id === proveedorSeleccionado
        const esAtenuado     = proveedorSeleccionado && !esSeleccionado

        const reservasCol = todasReservas.filter(r =>
            r.provider_id === d.provider_id && r.service_id === servicioId && r.status !== 'Cancelada'
        )

        const MAX_FILAS = 8
        const visibles  = reservasCol.slice(0, MAX_FILAS)
        const resto     = reservasCol.slice(MAX_FILAS)
        let filasReservas = reservasCol.length === 0
            ? `<div class="proveedor-sin-reservas">Sin reservas</div>`
            : visibles.map(r => `
                <div class="proveedor-fila-reserva">
                    <span class="cliente" style="color:${r.status === 'Confirmada' ? 'var(--accent-ok)' : 'var(--accent-warn)'}">${r.client_id}(${r.slots})</span>
                </div>`).join('')
        if (resto.length > 0) {
            filasReservas += `<div class="proveedor-fila-mas">+${resto.length} más (${resto.reduce((s,r)=>s+r.slots,0)} plazas)</div>`
        }

        return `<div class="proveedor-col ${claseDisp} ${esSeleccionado ? 'destacado' : 'normal'} ${esAtenuado ? 'atenuado' : ''}"
                    style="border:2px solid; cursor:pointer"
                    onclick="seleccionarProveedorDesdeCajita('${d.provider_id}')">
            <div class="proveedor-col-header">
                <div class="nombre">${simbolo} ${d.provider_id}</div>
                <div class="plazas">${libres}/${total} libres</div>
            </div>
            <div class="proveedor-col-body">${filasReservas}</div>
        </div>`
    }).join('')
}

window.seleccionarProveedorDesdeCajita = function(proveedorId) {
    const servicioId = selectServicio.value
    const plazas     = parseInt(inputPlazas.value) || 0

    if (plazas > 0) {
        const { libres } = getPlazasInfo(proveedorId, servicioId, reservaEditandoId)
        if (libres < plazas) {
            abrirPanelReorganizar(proveedorId, servicioId, plazas)
            return
        }
    }

    const opcionExiste = [...selectProveedor.options].some(o => o.value === proveedorId)
    if (!opcionExiste) {
        const { total, libres } = getPlazasInfo(proveedorId, servicioId, reservaEditandoId)
        const opt = document.createElement('option')
        opt.value       = proveedorId
        opt.textContent = `${proveedorId} (${libres}/${total})`
        selectProveedor.appendChild(opt)
    }
    selectProveedor.value = proveedorId
    selectProveedor.dispatchEvent(new Event('change'))
}

// ===== BLOQUE 5: COBROS AL CLIENTE =====


function calcularTotalCobrarCliente(clienteId) {
    return todasReservas
        .filter(r => r.client_id === clienteId && r.status !== 'Cancelada')
        .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
}

// Persiste en Supabase el estado actual de hitosClienteTemp para un cliente.
// Upsert inteligente: nunca toca hitos con invoice_number (ya facturados).
// Lanza excepción si algo falla — el llamador debe capturarla y detener su flujo.
async function persistirHitosCliente(clienteId) {
    // IDs actualmente en memoria que ya existen en la BBDD (tienen id)
    const idsEnMemoria = hitosClienteTemp
        .filter(h => h.id && !h.invoice_number)
        .map(h => h.id)

    // IDs en la BBDD que no están facturados — candidatos a borrar
    const { data: enBBDD, error: errLeer } = await supabase
        .from('charges')
        .select('id')
        .eq('client_id', clienteId)
        .is('invoice_number', null)
    if (errLeer) throw new Error('Error al leer cobros existentes: ' + errLeer.message)

    // Actualizar o insertar cada hito de memoria
    for (const h of hitosClienteTemp) {
        if (h.invoice_number) continue  // facturado — no tocar nunca

        const payload = {
            client_id:      clienteId,
            amount:         parseFloat(h.amount),
            due_date:       h.due_date ?? null,
            collected:      h.collected ?? false,
            collected_date: h.collected_date ?? null,
            comments:       h.comments ?? null,
            is_final:       h.is_final ?? false
        }

        if (h.id) {
            // Hito existente no facturado — actualizar
            const { error } = await supabase
                .from('charges').update(payload).eq('id', h.id)
            if (error) throw new Error(`Error al actualizar cobro ${h.id}: ` + error.message)
        } else {
            // Hito nuevo — insertar y capturar el id devuelto
            const { data, error } = await supabase
                .from('charges').insert(payload).select('id').single()
            if (error) throw new Error('Error al insertar cobro: ' + error.message)
            h.id = data.id  // asignar id para que futuras llamadas hagan update, no insert
        }
    }

    // Borrar de la BBDD los hitos no facturados que ya no están en memoria
    const idsBorrar = (enBBDD ?? [])
        .map(r => r.id)
        .filter(id => !idsEnMemoria.includes(id))
    if (idsBorrar.length > 0) {
        const { error } = await supabase
            .from('charges').delete().in('id', idsBorrar)
        if (error) throw new Error('Error al eliminar cobros obsoletos: ' + error.message)
    }
}

async function cargarCobrosCliente(clienteId, reservas) {
    const bloque = document.getElementById('bloque-cobros-cliente')

    if (!reservas || reservas.length === 0) {
        bloque.style.display = 'none'
        hitosClienteTemp = []
        return
    }

    const { data: charges } = await supabase
        .from('charges').select('*').eq('client_id', clienteId).order('due_date')

    // esFinal viene de is_final en la BBDD (fuente de verdad)
    hitosClienteTemp = (charges ?? []).map(h => ({ ...h, esFinal: h.is_final ?? false }))

    const total      = calcularTotalCobrarCliente(clienteId)
    const prepagos   = hitosClienteTemp.filter(h => !h.esFinal).reduce((s, h) => s + parseFloat(h.amount), 0)
    const cobroFinal = total - prepagos

    if (!hitosClienteTemp.find(h => h.esFinal)) {
        // No existe en BBDD — crear y persistir inmediatamente
        hitosClienteTemp.push({
            esFinal:   true,
            is_final:  true,
            comments:  'Cobro final',
            client_id: clienteId,
            amount:    cobroFinal,
            due_date:  fechaCobroDefault(),
            collected: false
        })
        try {
            await persistirHitosCliente(clienteId)
        } catch (err) {
            console.error('Error al crear cobro final automático:', err.message)
        }
    } else {
        const idx = hitosClienteTemp.findIndex(h => h.esFinal)
        hitosClienteTemp[idx].amount = cobroFinal
    }

    actualizarResumenCobros(clienteId, total, prepagos, cobroFinal)
    renderCobrosCliente()
    bloque.style.display = 'block'
}

function actualizarResumenCobros(clienteId, total, prepagos, cobroFinal) {
    const cobrado   = hitosClienteTemp.filter(h => h.collected).reduce((s, h) => s + parseFloat(h.amount), 0)
    const pendiente = hitosClienteTemp.filter(h => !h.collected).reduce((s, h) => s + parseFloat(h.amount), 0)
    document.getElementById('resumen-cobros-cliente').innerHTML =
        `Total a cobrar: <strong>${fmt(total)}</strong> &nbsp;|&nbsp; ` +
        `Cobrado: <strong style="color:var(--accent-ok)">${fmt(cobrado)}</strong> &nbsp;|&nbsp; ` +
        `Pendiente: <strong style="color:${pendiente > 0 ? 'var(--accent-warn)' : 'var(--accent-ok)'}">` +
        `${fmt(pendiente)}</strong>`
}

function renderCobrosCliente() {
    const tbody = document.getElementById('tbody-cobros-cliente')
    tbody.innerHTML = hitosClienteTemp.map((h, i) => {
        const yaFacturado = !!h.invoice_number
        const btnFacturar = !yaFacturado && h.id
            ? `<button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;margin-right:4px"
                   onclick="facturarHito('${h.id}')">📄 Facturar</button>`
            : yaFacturado
                ? (h.invoice_path
                    ? `<span style="font-size:11px;color:var(--accent-ok);margin-right:6px;cursor:pointer;text-decoration:underline"
                           onclick="descargarFactura('${h.invoice_path}', '${h.invoice_number}')"
                           title="Descargar factura ${h.invoice_number}">📄 ${h.invoice_number}</span>`
                    : `<span style="font-size:11px;color:var(--accent-ok);margin-right:6px">📄 ${h.invoice_number}</span>`)
                : ''

        return `<tr>
            <td>${h.comments}</td>
            <td>${fmt(h.amount)}${h.esFinal ? ' <span style="font-size:11px;color:var(--subtle)">(calculado)</span>' : ''}</td>
            <td>${h.esFinal
                ? `<input type="date" value="${h.due_date ?? ''}"
                    style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:4px"
                    onchange="cambiarFechaCobroFinal(${i}, this.value)">`
                : (h.due_date ?? '—')}</td>
            <td>${h.collected ? `✅ ${h.collected_date ?? ''}` : '⏳ No'}</td>
            <td style="white-space:nowrap">
                ${btnFacturar}
                <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;margin-right:4px"
                    onclick="toggleCobroCliente(${i})">${h.collected ? 'Marcar pendiente' : 'Marcar cobrado'}</button>
                ${!h.esFinal ? `<button class="btn btn-danger" style="padding:4px 8px;font-size:11px"
                    onclick="eliminarCobroCliente(${i})">🗑</button>` : ''}
            </td>
        </tr>`
    }).join('')
}

window.cambiarFechaCobroFinal = async function(idx, valor) {
    hitosClienteTemp[idx].due_date = valor || null
    try {
        await persistirHitosCliente(clienteActual.id)
    } catch (err) {
        // Si falla, recargar desde la BBDD para que la vista sea coherente
        await cargarCobrosCliente(clienteActual.id, reservasCliente)
        alert('Error al guardar la fecha: ' + err.message)
    }
}

window.toggleCobroCliente = async function(idx) {
    const h = hitosClienteTemp[idx]

    // Guardar estado previo para poder revertir si falla la persistencia
    const estadoPrevio = { collected: h.collected, collected_date: h.collected_date }

    if (!h.collected) {
        if (!h.invoice_number) {
            const confirmar = confirm(`Este hito no ha sido facturado todavía.\n¿Desea marcarlo como cobrado de todas formas?`)
            if (!confirmar) return
        }
        const fecha = prompt('Fecha de cobro (dejar vacío para hoy):', hoy)
        if (fecha === null) return
        h.collected      = true
        h.collected_date = fecha.trim() || hoy
    } else {
        h.collected      = false
        h.collected_date = null
    }

    const total    = calcularTotalCobrarCliente(clienteActual.id)
    const prepagos = hitosClienteTemp.filter(h => !h.esFinal).reduce((s, h) => s + parseFloat(h.amount), 0)
    actualizarResumenCobros(clienteActual.id, total, prepagos, total - prepagos)
    renderCobrosCliente()

    try {
        await persistirHitosCliente(clienteActual.id)
    } catch (err) {
        // Revertir cambio en memoria y en vista
        h.collected      = estadoPrevio.collected
        h.collected_date = estadoPrevio.collected_date
        actualizarResumenCobros(clienteActual.id, total, prepagos, total - prepagos)
        renderCobrosCliente()
        alert('Error al guardar el cambio: ' + err.message)
    }
}

window.eliminarCobroCliente = async function(idx) {
    const h = hitosClienteTemp[idx]
    if (h.invoice_number) {
        alert('Este hito ya ha sido facturado y no puede eliminarse.\nSi necesitas corregirlo, contacta con el administrador de la base de datos.')
        return
    }
    // Guardar hito y posición para revertir si falla la persistencia
    const hitoEliminado = hitosClienteTemp.splice(idx, 1)[0]
    const total    = calcularTotalCobrarCliente(clienteActual.id)
    const prepagos = hitosClienteTemp.filter(h => !h.esFinal).reduce((s, h) => s + parseFloat(h.amount), 0)
    const idxFinal = hitosClienteTemp.findIndex(h => h.esFinal)
    if (idxFinal >= 0) hitosClienteTemp[idxFinal].amount = total - prepagos
    actualizarResumenCobros(clienteActual.id, total, prepagos, total - prepagos)
    renderCobrosCliente()
    try {
        await persistirHitosCliente(clienteActual.id)
    } catch (err) {
        // Revertir: reinsertar el hito en su posición original
        hitosClienteTemp.splice(idx, 0, hitoEliminado)
        const totalRev    = calcularTotalCobrarCliente(clienteActual.id)
        const prepagosRev = hitosClienteTemp.filter(h => !h.esFinal).reduce((s, h) => s + parseFloat(h.amount), 0)
        const idxFinalRev = hitosClienteTemp.findIndex(h => h.esFinal)
        if (idxFinalRev >= 0) hitosClienteTemp[idxFinalRev].amount = totalRev - prepagosRev
        actualizarResumenCobros(clienteActual.id, totalRev, prepagosRev, totalRev - prepagosRev)
        renderCobrosCliente()
        alert('Error al eliminar el cobro: ' + err.message)
    }
}

document.getElementById('btnNuevoCobroCliente').addEventListener('click', () => {
    document.getElementById('form-nuevo-cobro-cliente').style.display = 'block'
    document.getElementById('btnNuevoCobroCliente').style.display     = 'none'
})

document.getElementById('btnCancelarNuevoCobro').addEventListener('click', () => {
    document.getElementById('form-nuevo-cobro-cliente').style.display = 'none'
    document.getElementById('btnNuevoCobroCliente').style.display     = 'inline-block'
})

document.getElementById('btnGuardarNuevoCobro').addEventListener('click', async () => {
    const concepto = document.getElementById('cobroConcepto').value.trim() || 'Prepago'
    const importe  = parseFloat(document.getElementById('cobroImporte').value)
    const fecha    = document.getElementById('cobroFecha').value || null
    const cobrado  = document.getElementById('cobroCobrado').value === 'true'
    if (!importe || importe <= 0) { alert('Introduce un importe válido'); return }

    const idxFinal = hitosClienteTemp.findIndex(h => h.esFinal)
    const posInsercion = idxFinal >= 0 ? idxFinal : hitosClienteTemp.length
    hitosClienteTemp.splice(posInsercion, 0, {
        esFinal:   false,
        comments:  concepto,
        client_id: clienteActual.id,
        amount:    importe,
        due_date:  fecha,
        collected: cobrado
    })

    const total    = calcularTotalCobrarCliente(clienteActual.id)
    const prepagos = hitosClienteTemp.filter(h => !h.esFinal).reduce((s, h) => s + parseFloat(h.amount), 0)
    const idxF     = hitosClienteTemp.findIndex(h => h.esFinal)
    if (idxF >= 0) hitosClienteTemp[idxF].amount = total - prepagos

    document.getElementById('cobroConcepto').value = ''
    document.getElementById('cobroImporte').value  = ''
    document.getElementById('cobroFecha').value    = ''
    document.getElementById('cobroCobrado').value  = 'false'
    document.getElementById('form-nuevo-cobro-cliente').style.display = 'none'
    document.getElementById('btnNuevoCobroCliente').style.display     = 'inline-block'

    actualizarResumenCobros(clienteActual.id, total, prepagos, total - prepagos)
    renderCobrosCliente()

    try {
        await persistirHitosCliente(clienteActual.id)
    } catch (err) {
        // Revertir: eliminar el hito recién insertado de memoria
        hitosClienteTemp.splice(posInsercion, 1)
        const totalRev    = calcularTotalCobrarCliente(clienteActual.id)
        const prepagosRev = hitosClienteTemp.filter(h => !h.esFinal).reduce((s, h) => s + parseFloat(h.amount), 0)
        const idxFinalRev = hitosClienteTemp.findIndex(h => h.esFinal)
        if (idxFinalRev >= 0) hitosClienteTemp[idxFinalRev].amount = totalRev - prepagosRev
        actualizarResumenCobros(clienteActual.id, totalRev, prepagosRev, totalRev - prepagosRev)
        renderCobrosCliente()
        alert('Error al guardar el cobro: ' + err.message)
    }
})


// Descarga una factura ya emitida desde Supabase Storage
// Genera una URL firmada temporal (60s) y la abre en una nueva pestana
window.descargarFactura = async function(invoicePath, invoiceNumber) {
    const { data, error } = await supabase.storage
        .from('invoices')
        .createSignedUrl(invoicePath, 60)
    if (error) {
        alert('Error al obtener la factura: ' + error.message)
        return
    }
    const a = document.createElement('a')
    a.href     = data.signedUrl
    a.download = invoicePath.split('/').pop()
    a.target   = '_blank'
    a.click()
}

window.descargarPropuesta = async function(proposalPath, proposalNumber) {
    const { data, error } = await supabase.storage
        .from('proposals')
        .createSignedUrl(proposalPath, 60)
    if (error) {
        alert('Error al obtener la propuesta: ' + error.message)
        return
    }
    const a = document.createElement('a')
    a.href     = data.signedUrl
    a.download = proposalPath.split('/').pop()
    a.target   = '_blank'
    a.click()
}

window.facturarHito = async function(hitoId) {
    if (!clienteActual) return
    hitoId = parseInt(hitoId)

    const hitoTemp    = hitosClienteTemp.find(h => h.id === hitoId)
    const esHitoFinal = hitoTemp?.esFinal ?? false

    if (esHitoFinal) {
        const sinFacturar = hitosClienteTemp.filter(h =>
            h.id && h.id !== hitoId && !h.invoice_number
        )
        if (sinFacturar.length > 0) {
            const lista = sinFacturar.map(h =>
                `- ${h.comments ?? 'Sin concepto'}: ${fmt(h.amount)}`
            ).join('\n')
            alert(
                `No se puede emitir la factura final porque hay hitos pendientes de facturar:\n\n${lista}\n\n` +
                `Factura primero esos hitos, o eliminalos si ya no van a cobrarse.`
            )
            return
        }
    }

    const reservasConCharges = reservasCliente.map(r => ({
        ...r,
        _charges: hitosClienteTemp.filter(h => h.id),
        _esFinal: esHitoFinal
    }))
    await abrirPanelFactura(hitoId, clienteActual, reservasConCharges)
}

document.addEventListener('facturaEmitida', () => {
    if (clienteActual) cargarReservasCliente(clienteActual.id)
})

document.addEventListener('propuestaEmitida', () => {
    if (clienteActual) cargarReservasCliente(clienteActual.id)
})

// ===== PANEL DE REORGANIZACIÓN DE DISPONIBILIDAD =====
// Se crea dinámicamente en el body para evitar problemas con position:fixed en Safari

let reorgContexto = null
let reorgCambios  = {}
let reorgFilas    = []

function abrirPanelReorganizar(proveedorId, servicioId, plazasNecesarias) {
    reorgContexto = { proveedorId, servicioId, plazasNecesarias }
    reorgCambios  = {}

    const reservasBloquean = todasReservas.filter(r =>
        r.provider_id === proveedorId &&
        r.service_id  === servicioId  &&
        r.status      !== 'Cancelada'
    )
    reorgFilas = reservasBloquean.map(r => ({ ...r }))

    const dialog = document.getElementById('dialogReorganizar')

    // Cerrar al pulsar en el backdrop
    dialog.addEventListener('click', e => {
        const r = dialog.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX > r.right ||
            e.clientY < r.top  || e.clientY > r.bottom)
            cerrarPanelReorganizar()
    }, { once: true })

    dialog.showModal()
    renderPanelReorganizar()
}

window.cerrarPanelReorganizar = function() {
    document.getElementById('dialogReorganizar').close()
    reorgContexto = null
    reorgCambios  = {}
    reorgFilas    = []
}

function renderPanelReorganizar() {
    const { proveedorId, servicioId, plazasNecesarias } = reorgContexto

    const plazasOcupadas = reorgFilas
        .filter(r => r.provider_id === proveedorId && r.service_id === servicioId)
        .reduce((s, r) => s + r.slots, 0)

    const dispObj     = disponibilidad.find(d => d.provider_id === proveedorId && d.service_id === servicioId)
    const totalSlots  = dispObj?.total_slots ?? 0
    const libresAhora = totalSlots - plazasOcupadas

    document.getElementById('panel-reorg-cabecera').textContent =
        `Quieres meter ${plazasNecesarias} plaza(s) en ${proveedorId} / ${servicioId}`

    const estadoDiv = document.getElementById('panel-reorg-estado')
    if (libresAhora >= plazasNecesarias) {
        estadoDiv.textContent      = `✅ Ya hay ${libresAhora} plazas libres — puedes confirmar`
        estadoDiv.style.background = '#f0fff0'
        estadoDiv.style.color      = 'var(--accent-ok)'
        document.getElementById('btnConfirmarReorg').disabled = Object.keys(reorgCambios).length === 0
    } else {
        estadoDiv.textContent      = `❌ Faltan ${plazasNecesarias - libresAhora} plazas — mueve reservas abajo`
        estadoDiv.style.background = '#fff5f5'
        estadoDiv.style.color      = 'var(--accent)'
        document.getElementById('btnConfirmarReorg').disabled = true
    }

    const tbody = document.getElementById('tbody-reorg')
    tbody.innerHTML = reorgFilas.map((r, idx) => {
        const tieneCambio = !!reorgCambios[r.id]

        const optsServicio = servicios.map(s =>
            `<option value="${s.id}" ${r.service_id === s.id ? 'selected' : ''}>${s.id}</option>`
        ).join('')

        const dispDeServicio = disponibilidad.filter(d => d.service_id === r.service_id)
        const optsProveedor = dispDeServicio.map(d => {
            const ocupadasEnPanel = reorgFilas
                .filter(f => f.provider_id === d.provider_id && f.service_id === d.service_id && f.id !== r.id)
                .reduce((s, f) => s + f.slots, 0)
            const reservasReales = todasReservas
                .filter(res => res.provider_id === d.provider_id && res.service_id === d.service_id &&
                               res.status !== 'Cancelada' && !reorgFilas.find(f => f.id === res.id))
                .reduce((s, res) => s + res.slots, 0)
            const totalOcupadas = ocupadasEnPanel + reservasReales
            const libres        = (d.total_slots ?? 0) - totalOcupadas

            let simbolo = ''
            if      (libres >= r.slots) simbolo = '✅'
            else if (libres > 0)        simbolo = '⚠️'
            else                         simbolo = '❌'

            return `<option value="${d.provider_id}" ${r.provider_id === d.provider_id ? 'selected' : ''}>
                ${d.provider_id} (${libres} libres) ${simbolo}
            </option>`
        }).join('')

        return `<tr style="${tieneCambio ? 'background:#fffbec' : ''}">
            <td style="font-size:12px; white-space:nowrap">${r.id}</td>
            <td style="font-size:12px">${r.client_id}</td>
            <td>
                <select style="font-size:11px; padding:3px 4px; width:100%"
                    onchange="reorgCambiarServicio(${idx}, this.value)">
                    ${optsServicio}
                </select>
            </td>
            <td>
                <select style="font-size:11px; padding:3px 4px; width:100%"
                    onchange="reorgCambiarProveedor(${idx}, this.value)">
                    ${optsProveedor}
                </select>
            </td>
            <td style="font-size:12px; text-align:center">${r.slots}</td>
            <td>
                <input type="number" step="0.01" value="${r.price_per_slot}"
                    style="font-size:11px; padding:3px 4px; width:80px; text-align:right"
                    onchange="reorgCambiarPrecio(${idx}, this.value)">
            </td>
        </tr>`
    }).join('')
}

window.reorgCambiarServicio = function(idx, nuevoServicio) {
    const r        = reorgFilas[idx]
    const original = todasReservas.find(res => res.id === r.id)

    reorgFilas[idx].service_id = nuevoServicio

    const dispNuevoServicio        = disponibilidad.filter(d => d.service_id === nuevoServicio)
    const proveedorSigueDisponible = dispNuevoServicio.some(d => d.provider_id === r.provider_id)
    if (!proveedorSigueDisponible && dispNuevoServicio.length > 0) {
        reorgFilas[idx].provider_id = dispNuevoServicio[0].provider_id
    }

    registrarCambioReorg(idx, original)
    renderPanelReorganizar()
}

window.reorgCambiarProveedor = function(idx, nuevoProveedor) {
    const r        = reorgFilas[idx]
    const original = todasReservas.find(res => res.id === r.id)

    reorgFilas[idx].provider_id = nuevoProveedor

    const yaEnPanel = reorgFilas.some(f =>
        f.provider_id === nuevoProveedor && f.service_id === r.service_id && f.id !== r.id
    )
    if (!yaEnPanel) {
        const reservasNuevoProv = todasReservas.filter(res =>
            res.provider_id === nuevoProveedor &&
            res.service_id  === r.service_id   &&
            res.status      !== 'Cancelada'    &&
            !reorgFilas.find(f => f.id === res.id)
        )
        const dispNuevoProv     = disponibilidad.find(d =>
            d.provider_id === nuevoProveedor && d.service_id === r.service_id
        )
        const totalNuevoProv    = dispNuevoProv?.total_slots ?? 0
        const ocupadasNuevoProv = reservasNuevoProv.reduce((s, res) => s + res.slots, 0) + r.slots
        if (ocupadasNuevoProv > totalNuevoProv) {
            reorgFilas.push(...reservasNuevoProv.map(res => ({ ...res })))
        }
    }

    registrarCambioReorg(idx, original)
    renderPanelReorganizar()
}

function registrarCambioReorg(idx, original) {
    const r = reorgFilas[idx]
    const precioModificado = reorgCambios[r.id]?.price_per_slot

    if (r.service_id !== original.service_id || r.provider_id !== original.provider_id) {
        reorgCambios[r.id] = {
            service_id:  r.service_id,
            provider_id: r.provider_id,
            ...(precioModificado !== undefined && { price_per_slot: precioModificado })
        }
    } else if (precioModificado === undefined) {
        delete reorgCambios[r.id]
    }
}

window.reorgCambiarPrecio = function(idx, nuevoPrecio) {
    const precio   = parseFloat(nuevoPrecio)
    const r        = reorgFilas[idx]
    const original = todasReservas.find(res => res.id === r.id)
    if (isNaN(precio) || precio < 0) return

    reorgFilas[idx].price_per_slot = precio

    if (Math.abs(precio - parseFloat(original.price_per_slot)) >= 0.01) {
        // Hay cambio de precio — registrar, preservando service_id y provider_id si ya cambiaron
        reorgCambios[r.id] = {
            service_id:    reorgCambios[r.id]?.service_id  ?? r.service_id,
            provider_id:   reorgCambios[r.id]?.provider_id ?? r.provider_id,
            price_per_slot: precio
        }
    } else {
        // Precio volvió al original — eliminar solo price_per_slot
        if (reorgCambios[r.id]) {
            delete reorgCambios[r.id].price_per_slot
            // Si tampoco hay cambio de servicio ni proveedor, eliminar la entrada completa
            if (reorgCambios[r.id].service_id  === original.service_id &&
                reorgCambios[r.id].provider_id === original.provider_id) {
                delete reorgCambios[r.id]
            }
        }
    }

    // Recalcular estado del botón sin re-renderizar la tabla (evita perder el foco del input)
    const { plazasNecesarias, proveedorId, servicioId } = reorgContexto
    const plazasOcupadas = reorgFilas
        .filter(f => f.provider_id === proveedorId && f.service_id === servicioId)
        .reduce((s, f) => s + f.slots, 0)
    const dispObj     = disponibilidad.find(d => d.provider_id === proveedorId && d.service_id === servicioId)
    const libresAhora = (dispObj?.total_slots ?? 0) - plazasOcupadas
    document.getElementById('btnConfirmarReorg').disabled =
        libresAhora < plazasNecesarias || Object.keys(reorgCambios).length === 0
}

window.confirmarReorganizacion = async function() {
    if (Object.keys(reorgCambios).length === 0) return

    const lineas = Object.entries(reorgCambios).map(([id, cambio]) => {
        const original = todasReservas.find(r => r.id === id)
        const partes   = []
        if (cambio.service_id  !== undefined && cambio.service_id  !== original.service_id)
            partes.push(`${original.service_id} → ${cambio.service_id}`)
        if (cambio.provider_id !== undefined && cambio.provider_id !== original.provider_id)
            partes.push(`${original.provider_id} → ${cambio.provider_id}`)
        if (cambio.price_per_slot !== undefined)
            partes.push(`precio ${original.price_per_slot}€ → ${cambio.price_per_slot}€`)
        return `${id}  ${original.client_id}  ${partes.join('  |  ')}`
    })

    const confirmado = confirm(`¿Confirmar los siguientes cambios?\n\n${lineas.join('\n')}`)
    if (!confirmado) return

    const originales = Object.fromEntries(
        Object.entries(reorgCambios).map(([id]) => {
            const r = todasReservas.find(r => r.id === id)
            return [id, { service_id: r.service_id, provider_id: r.provider_id, price_per_slot: r.price_per_slot }]
        })
    )

    // Modal consultivo de sfcom para los pares afectados por la reorganización
    const sfcomDeltasMap = new Map()
    Object.entries(reorgCambios).forEach(([id, cambio]) => {
        const r = todasReservas.find(r => r.id === id)
        if (!r) return
        const newProviderId = cambio.provider_id ?? r.provider_id
        const newServiceId  = cambio.service_id  ?? r.service_id
        if (newProviderId === r.provider_id && newServiceId === r.service_id) return
        const isSfcom = Boolean(r.sfcom_order_ref)
        const slots   = r.slots ?? 0
        const origKey = `${r.provider_id}|${r.service_id}`
        const newKey  = `${newProviderId}|${newServiceId}`
        const orig = sfcomDeltasMap.get(origKey) ?? { providerId: r.provider_id, serviceId: r.service_id, sfcomDelta: 0, allDelta: 0 }
        orig.allDelta   -= slots
        orig.sfcomDelta -= isSfcom ? slots : 0
        sfcomDeltasMap.set(origKey, orig)
        const dest = sfcomDeltasMap.get(newKey) ?? { providerId: newProviderId, serviceId: newServiceId, sfcomDelta: 0, allDelta: 0 }
        dest.allDelta   += slots
        dest.sfcomDelta += isSfcom ? slots : 0
        sfcomDeltasMap.set(newKey, dest)
    })
    const sfcomPairsReorg = [...sfcomDeltasMap.values()].filter(p => p.allDelta !== 0 || p.sfcomDelta !== 0)
    for (const p of sfcomPairsReorg) {
        if (p.allDelta <= 0) continue
        const sfcomResult = await checkAvailabilityBeforeSave(supabase, p.providerId, p.serviceId, p.allDelta)
        if (sfcomResult.sfcomCheck && sfcomResult.warning) {
            if (!confirm(`Aviso de sfcom:\n\n${sfcomResult.warning}\n\n¿Deseas continuar igualmente?`)) return
        }
    }
    let sfcomResultReorg = 'sync'
    if (sfcomPairsReorg.length > 0) {
        sfcomResultReorg = await confirmarStockSfcom(supabase, sfcomPairsReorg)
        if (sfcomResultReorg === 'cancel') return
    }

    const aplicados = []
    for (const [id, cambio] of Object.entries(reorgCambios)) {
        const updateData = {}
        if (cambio.service_id     !== undefined) updateData.service_id     = cambio.service_id
        if (cambio.provider_id    !== undefined) updateData.provider_id    = cambio.provider_id
        if (cambio.price_per_slot !== undefined) updateData.price_per_slot = cambio.price_per_slot

        const { error } = await supabase.from('reservations')
            .update(updateData)
            .eq('id', id)
        if (error) {
            await Promise.allSettled(aplicados.map(rid =>
                supabase.from('reservations').update(originales[rid]).eq('id', rid)
            ))
            alert(`Error al reorganizar (${id}). Los cambios anteriores han sido revertidos.`)
            return
        }
        aplicados.push(id)
    }

    const { data: reservasActualizadas } = await supabase.from('reservations').select('*')
    todasReservas = reservasActualizadas

    const clientesAfectados = new Set(
        Object.keys(reorgCambios)
            .map(id => todasReservas.find(r => r.id === id)?.client_id)
            .filter(Boolean)
    )
    for (const clienteId of clientesAfectados) {
        await persistirCobrosCliente(supabase, clienteId, todasReservas)
    }

    const proveedoresAfectados = new Set()
    Object.entries(reorgCambios).forEach(([id, cambio]) => {
        const original = todasReservas.find(r => r.id === id)
        proveedoresAfectados.add(cambio.provider_id)
        if (original) proveedoresAfectados.add(original.provider_id)
    })
    for (const proveedorId of proveedoresAfectados) {
        await persistirPagosProveedor(supabase, proveedorId, todasReservas, disponibilidad)
    }

    const sfcomPares = new Set()
    Object.entries(reorgCambios).forEach(([id, cambio]) => {
        const orig = originales[id]
        const newProviderId = cambio.provider_id ?? orig.provider_id
        const newServiceId  = cambio.service_id  ?? orig.service_id
        if (newProviderId !== orig.provider_id || newServiceId !== orig.service_id) {
            sfcomPares.add(`${orig.provider_id}|${orig.service_id}`)
            sfcomPares.add(`${newProviderId}|${newServiceId}`)
        }
    })
    for (const par of sfcomPares) {
        const [provId, svcId] = par.split('|')
        if (sfcomResultReorg === 'sync') await syncStockToSfcom(supabase, provId, svcId)
    }

    cerrarPanelReorganizar()
    actualizarBloque3()
    actualizarProveedores()
    if (clienteActual) await cargarReservasCliente(clienteActual.id)

    alert('✅ Cambios guardados. Ahora puedes añadir la reserva.')
}

// Infiere service_id y provider_id desde el mapeo de availability.
// El nombre (sfcom_service_name) es la búsqueda primaria.
// Fallback de prefix-scan para solicitudes antiguas donde level contiene
// el nombre completo de variación ("Balcón Estafeta - Viernes 10 de Julio...").
function _inferirDesdeSfcom(level, day) {
    if (!level) return { serviceId: null, providerId: null }

    const norm = s => s.toLowerCase()
    let filas = disponibilidad.filter(d =>
        d.sfcom_service_name && norm(d.sfcom_service_name) === norm(level)
    )

    // Fallback para registros antiguos con nombre completo de variación
    if (!filas.length) {
        const nombres        = [...new Set(disponibilidad.filter(d => d.sfcom_service_name).map(d => d.sfcom_service_name))]
        const nombreExtraido = extraerNombreProducto(level, nombres)
        if (nombreExtraido) {
            filas = disponibilidad.filter(d =>
                d.sfcom_service_name && norm(d.sfcom_service_name) === norm(nombreExtraido)
            )
        }
    }

    if (!filas.length) return { serviceId: null, providerId: null }

    // Varias filas con el mismo nombre (e.g. "Balcón Estafeta" con varios días):
    // intentar filtrar por día
    if (filas.length > 1 && day) {
        const filaDia = filas.find(d => d.service_id === 'ENCIERRO_' + day)
        if (filaDia) return { serviceId: filaDia.service_id, providerId: filaDia.provider_id }
    }

    return { serviceId: filas[0].service_id, providerId: filas[0].provider_id }
}

// Infiere el service_id probable a partir del slug (level) y el día
// Solo se usa en admin al cargar una solicitud web — nunca en la web pública
function _inferirServiceId(slug, day) {
    if (!slug) return null
    const partes = slug.toLowerCase().split('-')
    if (partes.indexOf('encierro')  !== -1) return day ? 'ENCIERRO_' + day : null
    if (partes.indexOf('chupinazo') !== -1) return 'CHUPINAZO_6'
    if (partes.indexOf('procesion') !== -1) return 'PROCESION_7'
    if (partes.indexOf('gigantes')  !== -1) return 'DESPEDIDA_GIGANTES_14'
    if (partes.indexOf('pobre')     !== -1) return 'POBRE_DE_MI'
    return null
}

// Detecta si un source tiene formato sfcom (WEBxxx_nnnn)
function _esSfcom(source) {
    return source && /^WEB\d+_\d+$/.test(source)
}

// ===== SOLICITUDES PENDIENTES =====
// Lee reservation_requests con status='nueva' y las muestra
// en el bloque-solicitudes. Click en fila carga datos sin cambiar status.
// Las de sfcom se muestran en rojo (máxima prioridad), sin botón Descartar.
// Las web se muestran en naranja con botón Descartar.

async function cargarSolicitudes() {
    const { data: solicitudes, error } = await supabase
        .from('reservation_requests')
        .select('*')
        .in('status', ['nueva', 'email_parsed'])
        .order('created_at', { ascending: true })

    if (error) { console.error('Error cargando solicitudes:', error); return }

    const tbody     = document.getElementById('tbody-solicitudes')
    const tablaWrap = document.getElementById('tabla-solicitudes-wrapper')
    const emptyMsg  = document.getElementById('bloque-solicitudes-empty')

    if (!solicitudes || solicitudes.length === 0) {
        if (tablaWrap) tablaWrap.style.display = 'none'
        if (emptyMsg)  emptyMsg.style.display  = 'block'
        return
    }
    if (tablaWrap) tablaWrap.style.display = ''
    if (emptyMsg)  emptyMsg.style.display  = 'none'

    // Separar sfcom de web para mostrar sfcom primero
    const deSfcom  = solicitudes.filter(s => _esSfcom(s.source))
    const deEmail  = solicitudes.filter(s => s.source === 'email')
    const deWeb    = solicitudes.filter(s => !_esSfcom(s.source) && s.source !== 'email')
    const ordenadas = [...deSfcom, ...deEmail, ...deWeb]

    tbody.innerHTML = ordenadas.map(s => {
        const esSfcom  = _esSfcom(s.source)
        const esEmail  = s.source === 'email'
        const fecha    = s.created_at
            ? new Date(s.created_at).toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
            : '—'
        const contacto = [s.client_email, s.client_phone].filter(Boolean).join(' / ') || '—'
        const dia      = s.day ? s.day + '/jul' : '—'
        const comentario = s.comments || '—'
        const experiencia = esSfcom
            ? (s.level || s.comments || '—')   // sfcom: usamos comments que guardamos el nombre del producto
            : (s.level || '—')
        const importe = esSfcom && s.price_per_slot && s.slots
            ? `${(s.price_per_slot * s.slots).toFixed(0)}€ bruto<br><strong>${(s.price_per_slot * s.slots / 1.15).toFixed(0)}€ neto</strong>`
            : '—'
        const rowStyle = esSfcom ? 'cursor:pointer;background:#fff0f0;border-left:3px solid #dc2626'
                       : esEmail ? 'cursor:pointer;background:#eff6ff;border-left:3px solid #2563eb'
                       : 'cursor:pointer'
        const badge = esSfcom ? `<span style="font-size:10px;background:#dc2626;color:#fff;padding:1px 5px;border-radius:3px;margin-right:4px">sfcom</span>`
                    : esEmail ? `<span style="font-size:10px;background:#2563eb;color:#fff;padding:1px 5px;border-radius:3px;margin-right:4px">📧 email</span>`
                    : ''

        return `<tr class="fila-solicitud" style="${rowStyle}"
            data-id="${s.id}"
            data-source="${(s.source || '').replace(/"/g, '&quot;')}"
            data-nombre="${(s.client_name || '').replace(/"/g, '&quot;')}"
            data-email="${(s.client_email || '').replace(/"/g, '&quot;')}"
            data-telefono="${(s.client_phone || '').replace(/"/g, '&quot;')}"
            data-address="${(s.client_address || '').replace(/"/g, '&quot;')}"
            data-level="${(s.level || '').replace(/"/g, '&quot;')}"
            data-service-id="${(s.service_id || '').replace(/"/g, '&quot;')}"
            data-day="${s.day || ''}"
            data-slots="${s.slots || ''}"
            data-price-per-slot="${s.price_per_slot || ''}"
            data-comments="${comentario.replace(/"/g, '&quot;')}">
            <td>${badge}${fecha}</td>
            <td>${s.client_name || '—'}</td>
            <td>${contacto}</td>
            <td>${experiencia}</td>
            <td>${s.slots || '—'}</td>
            <td>${dia}</td>
            <td style="font-size:12px">${importe}</td>
            <td>${comentario}</td>
            <td class="td-acciones" onclick="event.stopPropagation()">
                ${esEmail ? `<button class="btn-sm btn-responder" style="background:#2563eb;color:#fff;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:12px" data-id="${s.id}">💬 Responder</button>` : ''}
                <button class="btn-sm btn-ok btn-atendida" data-id="${s.id}">✅ Procesado</button>
                ${!esSfcom ? `<button class="btn-sm btn-err btn-descartar" data-id="${s.id}">🗑️ Descartar</button>` : ''}
            </td>
        </tr>`
    }).join('')

    tbody.querySelectorAll('.fila-solicitud').forEach(tr => {
        tr.addEventListener('click', () => cargarDesdeSolicitud(tr.dataset))
    })

    tbody.querySelectorAll('.btn-atendida').forEach(btn => {
        btn.addEventListener('click', () => marcarAtendida(btn.dataset.id))
    })

    tbody.querySelectorAll('.btn-descartar').forEach(btn => {
        btn.addEventListener('click', () => descartarSolicitud(btn.dataset.id))
    })

    tbody.querySelectorAll('.btn-responder').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation()
            const sol = solicitudes.find(s => String(s.id) === String(btn.dataset.id))
            if (sol) abrirAsistenteRespuesta(sol)
        })
    })
}

async function cargarDesdeSolicitud(data) {
    limpiarCamposCliente()

    const esSfcom = _esSfcom(data.source)
    solicitudSfcomRef = esSfcom ? (data.source || null) : null

    // Generar ID de cliente: NOMBRE_APELLIDO, con _2, _3... si ya existe
    const nombreBase = (data.nombre || 'CLIENTE')
        .toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '_')

    let clienteId = nombreBase
    let sufijo = 2
    while (todosClientes.find(c => c.id === clienteId)) {
        clienteId = nombreBase + '_' + sufijo
        sufijo++
    }

    _cargandoSolicitud = true

    // Rellenar bloque de cliente
    inputId.value       = clienteId
    inputName.value     = data.nombre   || ''
    inputPhone.value    = data.telefono || ''
    inputEmail.value    = data.email    || ''
    inputAddress.value  = data.address  || ''
    inputCompany.value  = ''
    inputComments.value = data.comments || ''

    clienteActual = null
    statusDiv.innerHTML = '✨ Cliente nuevo &nbsp;—&nbsp; '
        + '<a href="#" style="font-size:inherit;color:inherit;text-decoration:underline;cursor:pointer"'
        + ' onclick="guardarClienteNuevo(event)">Guardar cliente</a>'
        + ' o se guardará al añadir una reserva'
    statusDiv.style.color = 'var(--accent-warn)'

    // Rellenar bloque de reserva
    if (data.slots) inputPlazas.value = data.slots

    if (esSfcom) {
        // Nombre como búsqueda primaria; service_id almacenado solo como verificación
        const { serviceId, providerId } = _inferirDesdeSfcom(data.level, data.day)

        // Cross-check: si hay service_id guardado y no coincide con el inferido por nombre → modal de aviso
        if (serviceId && data.serviceId && serviceId !== data.serviceId) {
            _mostrarModalAvisoSolicitud(
                `Inconsistencia detectada en esta solicitud: el servicio inferido por el nombre del producto (${serviceId}) ` +
                `no coincide con el que estaba guardado (${data.serviceId}). ` +
                `Se usará el inferido por nombre — verifica manualmente.`
            )
        }

        if (serviceId) {
            selectServicio.value = serviceId
            selectServicio.dispatchEvent(new Event('change'))
            if (providerId) {
                setTimeout(() => {
                    selectProveedor.value = providerId
                    selectProveedor.dispatchEvent(new Event('change'))
                }, 100)
            }
        }
        // Precio neto precargado (bruto / 1.15)
        if (data.pricePerSlot || data['price-per-slot']) {
            const raw   = (data.pricePerSlot || data['price-per-slot']).replace(',', '.')
            const bruto = parseFloat(raw)
            if (!isNaN(bruto)) {
                setTimeout(() => {
                    inputPrecio.value = (bruto / 1.15).toFixed(2)
                    validarPrecio()
                    actualizarTotal()
                }, 150)
            }
        }
    } else {
        // Solicitud web: inferir servicio desde slug
        const serviceIdInferido = _inferirServiceId(data.level, data.day)
        if (serviceIdInferido) {
            const existe = servicios.find(s => s.id === serviceIdInferido)
            if (existe) {
                selectServicio.value = serviceIdInferido
                selectServicio.dispatchEvent(new Event('change'))
                // Si solo hay un proveedor para este servicio, auto-seleccionarlo
                const proveedoresServicio = disponibilidad.filter(d => d.service_id === serviceIdInferido)
                if (proveedoresServicio.length === 1) {
                    setTimeout(() => {
                        selectProveedor.value = proveedoresServicio[0].provider_id
                        selectProveedor.dispatchEvent(new Event('change'))
                    }, 100)
                }
            }
        }
        // Comentarios de reserva
        const inputComentariosReserva = document.getElementById('inputReservaComments')
        if (inputComentariosReserva && data.comments) {
            inputComentariosReserva.value = data.comments
        }
    }

    _cargandoSolicitud = false
    setTimeout(() => actualizarBtnAnadir(), 200)
    document.getElementById('bloque-cliente').scrollIntoView({ behavior: 'smooth' })
}

// ─── Modales de solicitud sfcom ───────────────────────────────────────────────

function _mostrarModalAvisoSolicitud(mensaje) {
    const { overlay, panel } = crearModal('modal-aviso-solicitud', { narrow: true })
    panel.innerHTML = `
        <div class="modal-header-desc">${mensaje}</div>
        <div class="modal-actions">
            <button id="modal-aviso-solicitud-ok" class="btn btn-primary">Entendido</button>
        </div>`
    panel.querySelector('#modal-aviso-solicitud-ok').addEventListener('click', () => overlay.remove())
}

function _mostrarModalIDsCambiados(nombre, idProdAnterior, idVarAnterior, idProdNuevo, idVarNuevo) {
    return new Promise(resolve => {
        const subject      = `sfcom — cambio de IDs detectado: ${nombre}`
        const cuerpoCorreo = [
            `Hola Hilario,`,
            ``,
            `Hemos detectado que el producto "${nombre}" tiene nuevos IDs en la tienda:`,
            `  - IDs anteriores: product_id ${idProdAnterior} / variation_id ${idVarAnterior || '—'}`,
            `  - IDs nuevos:     product_id ${idProdNuevo} / variation_id ${idVarNuevo || '—'}`,
            ``,
            `Hemos actualizado los IDs en nuestro sistema. ¿Puedes confirmar que el cambio es correcto?`,
            ``,
            `Gracias`
        ].join('\n')

        const { overlay, panel } = crearModal('modal-ids-cambiados', { narrow: true })
        panel.innerHTML = `
            <div class="modal-header">
                <div class="modal-header-title">⚠️ IDs de sfcom cambiados — ${nombre}</div>
                <div class="modal-header-desc">
                    Se detectaron nuevos IDs para este producto en sfcom. Puede que Hilario lo haya recreado.<br>
                    <strong>Anteriores:</strong> product_id ${idProdAnterior} / variation_id ${idVarAnterior || '—'}<br>
                    <strong>Nuevos:</strong> product_id ${idProdNuevo} / variation_id ${idVarNuevo || '—'}<br><br>
                    ¿Actualizar los IDs en la base de datos?
                </div>
            </div>
            <div class="modal-actions">
                <button id="modal-ids-cambiados-ok" class="btn btn-primary">Actualizar IDs</button>
                <button id="modal-ids-cambiados-cancel" class="btn btn-secondary">Mantener anteriores</button>
                <a href="mailto:hilario@goviwebs.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(cuerpoCorreo)}"
                   class="btn btn-secondary" style="text-decoration:none">📧 Notificar a Hilario</a>
            </div>`
        panel.querySelector('#modal-ids-cambiados-ok').addEventListener('click', () => { overlay.remove(); resolve(true) })
        panel.querySelector('#modal-ids-cambiados-cancel').addEventListener('click', () => { overlay.remove(); resolve(false) })
    })
}

function _mostrarModalNombreNoReconocido(nombreRaw, ref) {
    const { overlay, panel } = crearModal('modal-nombre-no-reconocido', { narrow: true })
    panel.innerHTML = `
        <div class="modal-header">
            <div class="modal-header-title">⚠️ Producto no reconocido — ${ref}</div>
            <div class="modal-header-desc">
                El pedido incluye un producto que no está configurado en el sistema:<br>
                <strong>${nombreRaw}</strong><br><br>
                La solicitud se ha guardado sin servicio asignado. Revísala manualmente en el bloque de solicitudes.
            </div>
        </div>
        <div class="modal-actions">
            <button id="modal-nombre-no-reconocido-ok" class="btn btn-primary">Entendido</button>
        </div>`
    panel.querySelector('#modal-nombre-no-reconocido-ok').addEventListener('click', () => overlay.remove())
}

// Registra pedidos nuevos de sfcom en reservation_requests.
// Sistema de dos capas: el nombre (sfcom_service_name) es el contrato;
// los IDs son verificación. Tres casos posibles al registrar.
async function registrarPedidosSfcom(pedidos) {
    if (!pedidos?.length) return

    const { data: existentes } = await supabase
        .from('reservation_requests')
        .select('source')
        .not('source', 'is', null)

    const sourcesRegistrados = new Set((existentes ?? []).map(r => r.source))
    const nuevos = pedidos.filter(p => !sourcesRegistrados.has(p.sfcom_order_ref))
    if (!nuevos.length) return

    const nombresConocidos = [...new Set(
        disponibilidad.filter(d => d.sfcom_service_name).map(d => d.sfcom_service_name)
    )]

    for (const pedido of nuevos) {
        if ((pedido.productos?.length ?? 0) > 1) {
            _mostrarModalAvisoSolicitud(
                `El pedido <strong>${pedido.sfcom_order_ref}</strong> contiene ${pedido.productos.length} productos — ` +
                `solo se procesa el primero automáticamente. Los demás requieren revisión manual.`
            )
        }
        const li = pedido.productos?.[0]
        if (!li) continue

        // 1. Extraer nombre canónico del producto (primary lookup key)
        const nombreExtraido = extraerNombreProducto(li.nombre, nombresConocidos)

        // 2. Buscar por nombre (primary). Si hay varios candidatos con el mismo nombre
        //    (p.ej. "Balcon Estafeta mitad" para múltiples días), desambiguar por día.
        let filaByName = null
        if (nombreExtraido) {
            const candidatos = disponibilidad.filter(d => d.sfcom_service_name === nombreExtraido)
            if (candidatos.length === 1) {
                filaByName = candidatos[0]
            } else if (candidatos.length > 1) {
                const diaExtraid = extraerDia(li.nombre)
                if (diaExtraid !== null) {
                    filaByName = candidatos.find(c => {
                        const m = /^ENCIERRO_(\d+)$/.exec(c.service_id)
                        return m ? parseInt(m[1]) === diaExtraid : false
                    }) ?? candidatos[0]
                } else {
                    filaByName = candidatos[0]
                }
            }
        }

        // 3. Buscar por IDs (verification)
        const filaById = disponibilidad.find(d =>
            d.sfcom_product_id == li.product_id &&
            (li.variation_id ? d.sfcom_variation_id == li.variation_id : !d.sfcom_variation_id)
        )

        // 4. Tres casos
        let serviceId   = null
        let levelToSave = nombreExtraido || li.nombre

        if (filaByName && (!filaById || filaById.id === filaByName.id)) {
            // Caso 1: nombre encontrado, IDs consistentes
            serviceId = filaByName.service_id

        } else if (filaByName && filaById && filaById.id !== filaByName.id) {
            // Caso 2: nombre encontrado pero IDs apuntan a otra fila → IDs cambiaron en sfcom
            const actualizar = await _mostrarModalIDsCambiados(
                filaByName.sfcom_service_name,
                filaById.sfcom_product_id, filaById.sfcom_variation_id,
                li.product_id, li.variation_id
            )
            if (actualizar) {
                await supabase.from('sfcom_listings')
                    .update({ sfcom_product_id: li.product_id, sfcom_variation_id: li.variation_id || null })
                    .eq('availability_id', filaByName.id)
                // Actualizar en memoria local para coherencia del resto de la sesión
                const local = disponibilidad.find(d => d.id === filaByName.id)
                if (local) {
                    local.sfcom_product_id   = li.product_id
                    local.sfcom_variation_id = li.variation_id || null
                }
            }
            serviceId = filaByName.service_id

        } else if (!filaByName && filaById) {
            // Caso 3: IDs apuntan a una fila pero el nombre no se reconoce
            _mostrarModalNombreNoReconocido(li.nombre, pedido.sfcom_order_ref)
            levelToSave = li.nombre  // guardar nombre raw para revisión manual
        }
        // Caso 4 (ninguno encontrado): serviceId=null, levelToSave=li.nombre raw

        const slots           = li.cantidad ?? 1
        const totalBruto      = parseFloat(pedido.total ?? 0)
        const precioSlotBruto = slots > 0 ? totalBruto / slots : totalBruto

        await supabase.from('reservation_requests').insert({
            client_name:    pedido.cliente.nombre    || 'Sin nombre',
            client_email:   pedido.cliente.email     || null,
            client_phone:   pedido.cliente.telefono  || null,
            client_address: pedido.cliente.direccion || null,
            slots,
            day:            extraerDia(li.nombre),
            level:          levelToSave,
            service_id:     serviceId,
            comments:       pedido.cliente.comentarios || null,
            price_per_slot: precioSlotBruto,
            source:         pedido.sfcom_order_ref,
            status:         'nueva'
        })
    }

    await cargarSolicitudes()
}

async function marcarAtendida(id) {
    const { error } = await supabase
        .from('reservation_requests')
        .update({ status: 'atendida', attended_at: new Date().toISOString() })
        .eq('id', id)

    if (error) console.error('Error marcando como atendida:', error)
    await cargarSolicitudes()
}

async function descartarSolicitud(id) {
    if (!confirm('¿Descartar esta solicitud? No se podrá recuperar.')) return

    const { error } = await supabase
        .from('reservation_requests')
        .update({ status: 'descartada', attended_at: new Date().toISOString() })
        .eq('id', id)

    if (error) console.error('Error descartando solicitud:', error)
    await cargarSolicitudes()
}

// ===== ASISTENTE DE RESPUESTAS =====

function parsearMetaComments(comments) {
    if (!comments) return { dias: null, flexible: false, extra: [] }
    const diasMatch = comments.match(/^Días:\s*(.+)$/m)
    const svcMatch  = comments.match(/^Otros servicios:\s*(.+)$/m)
    let dias = null, flexible = false
    if (diasMatch) {
        if (diasMatch[1].trim() === 'cualquiera') {
            flexible = true
        } else {
            const parsed = diasMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => n >= 6 && n <= 14)
            if (parsed.length) dias = parsed
        }
    }
    const extra = svcMatch ? svcMatch[1].split(',').map(s => s.trim()).filter(Boolean) : []
    return { dias, flexible, extra }
}

function expandirServiceIds(serviceHint, day, meta) {
    if (!serviceHint) return []
    const FIJOS = {
        chupinazo:   ['CHUPINAZO_6'],
        procesion:   ['PROCESION_7'],
        gigantes:    ['DESPEDIDA_GIGANTES_14'],
        pobre_de_mi: ['POBRE_DE_MI']
    }
    if (FIJOS[serviceHint]) return FIJOS[serviceHint]
    if (serviceHint !== 'encierro') return []
    const todosDias = [7, 8, 9, 10, 11, 12, 13, 14]
    if (meta.flexible || (!meta.dias && !day)) return todosDias.map(d => `ENCIERRO_${d}`)
    const dias = meta.dias?.length ? meta.dias : (day ? [day] : todosDias)
    return dias.map(d => `ENCIERRO_${d}`)
}

function disponibilidadParaAsistente(serviceIds) {
    if (!serviceIds?.length || !disponibilidad) return []
    const RE_DIA = /_(\d+)$/
    return serviceIds
        .flatMap(sid => {
            const rows = disponibilidad.filter(d => d.service_id === sid)
            if (!rows.length) return []
            const diaMatch = sid.match(RE_DIA)
            const dia      = diaMatch ? parseInt(diaMatch[1]) : null
            return rows.map(d => {
                const activas     = (todasReservas || []).filter(r =>
                    r.provider_id === d.provider_id && r.service_id === d.service_id && r.status !== 'Cancelada'
                )
                const ocupadas    = activas.reduce((s, r) => s + (r.slots || 0), 0)
                const confirmadas = activas.filter(r => r.status === 'Confirmada').reduce((s, r) => s + (r.slots || 0), 0)
                const pendientes  = activas.filter(r => r.status === 'Pendiente').reduce((s, r) => s + (r.slots || 0), 0)
                return {
                    service_id:         sid,
                    day:                dia,
                    billing_model:      d.billing_model,
                    plazas_totales:     d.total_slots,
                    plazas_libres:      Math.max(0, d.total_slots - ocupadas),
                    plazas_confirmadas: confirmadas,
                    plazas_pendientes:  pendientes,
                    precio_por_plaza:   d.price_per_slot  // coste al proveedor — nunca vender por debajo
                }
            })
        })
        .sort((a, b) => {
            const aCapLibre = a.billing_model === 'capacity' && a.plazas_libres > 0
            const bCapLibre = b.billing_model === 'capacity' && b.plazas_libres > 0
            if (aCapLibre && !bCapLibre) return -1
            if (!aCapLibre && bCapLibre)  return 1
            if ((a.day || 0) !== (b.day || 0)) return (a.day || 0) - (b.day || 0)
            if (a.billing_model === 'capacity' && b.billing_model !== 'capacity') return -1
            if (a.billing_model !== 'capacity' && b.billing_model === 'capacity')  return 1
            return b.plazas_libres - a.plazas_libres
        })
}

function preciosReferencia(serviceIds) {
    if (!serviceIds?.length || !todasReservas) return []
    return todasReservas
        .filter(r => serviceIds.includes(r.service_id) && ['Confirmada', 'Pendiente'].includes(r.status))
        .map(r => ({
            service_id:     r.service_id,
            provider_id:    r.provider_id,
            price_per_slot: r.price_per_slot,
            slots:          r.slots,
            status:         r.status
        }))
        .sort((a, b) => b.price_per_slot - a.price_per_slot)
}

async function abrirAsistenteRespuesta(solicitud) {
    const mensajes = []
    let enviando   = false

    const { overlay, panel } = crearModal('modal-asistente-respuesta', { wide: true, scroll: true })

    const contacto = [solicitud.client_email, solicitud.client_phone].filter(Boolean).join(' · ') || '—'

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 style="font-size:15px;font-weight:600;margin:0">💬 Asistente de respuesta</h3>
            <button id="btn-asistente-cerrar" style="background:none;border:none;cursor:pointer;font-size:20px;color:#777;padding:0;line-height:1" title="Cerrar">✕</button>
        </div>
        <div style="background:#f8f9fa;border-radius:8px;padding:12px;font-size:12px;color:#444;display:grid;grid-template-columns:1fr 1fr;gap:5px 16px">
            <div><strong>Cliente:</strong> ${solicitud.client_name || '—'}</div>
            <div><strong>Contacto:</strong> ${contacto}</div>
            <div><strong>Evento:</strong> ${solicitud.level || solicitud.service_id || 'No especificado'}</div>
            <div><strong>Día:</strong> ${solicitud.day ? solicitud.day + ' julio' : 'No especificado'}</div>
            <div><strong>Personas:</strong> ${solicitud.slots || 'No especificado'}</div>
            <div><strong>Idioma:</strong> ${solicitud.language || 'desconocido'}</div>
            <div style="grid-column:1/-1"><strong>Consulta:</strong> ${solicitud.comments || '—'}</div>
        </div>
        <div id="asistente-mensajes" style="display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto;padding:4px 2px"></div>
        <div style="display:flex;gap:8px;align-items:flex-end">
            <textarea id="asistente-input"
                placeholder="Escribe qué quieres ofrecer o pide un cambio…"
                style="flex:1;resize:none;min-height:44px;max-height:120px;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;font-family:inherit"
                rows="2"></textarea>
            <button id="asistente-enviar" class="btn btn-primary" style="white-space:nowrap;flex-shrink:0">Enviar</button>
        </div>
        <div id="asistente-resultado" style="display:none;flex-direction:column;gap:10px">
            <div style="font-size:12px;font-weight:600;color:#374151">✅ Mensaje para el cliente:</div>
            <textarea id="asistente-mensaje-final"
                style="width:100%;min-height:140px;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:13px;font-family:inherit;resize:vertical"></textarea>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button id="btn-asistente-copiar" class="btn btn-secondary">📋 Copiar</button>
                ${solicitud.client_email ? `<a id="btn-asistente-email" class="btn btn-secondary" style="text-decoration:none">📧 Email</a>` : ''}
                ${solicitud.client_phone ? `<a id="btn-asistente-whatsapp" class="btn btn-secondary" style="text-decoration:none" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
            </div>
        </div>
    `

    const elMensajes  = panel.querySelector('#asistente-mensajes')
    const elInput     = panel.querySelector('#asistente-input')
    const elEnviar    = panel.querySelector('#asistente-enviar')
    const elResultado = panel.querySelector('#asistente-resultado')
    const elMsgFinal  = panel.querySelector('#asistente-mensaje-final')

    function addMensaje(role, texto) {
        const el = document.createElement('div')
        el.style.cssText = role === 'assistant'
            ? 'background:#f0f4ff;border-radius:8px 8px 8px 2px;padding:10px 12px;font-size:13px;max-width:92%;align-self:flex-start;white-space:pre-wrap;line-height:1.5'
            : 'background:#e8f5e9;border-radius:8px 8px 2px 8px;padding:10px 12px;font-size:13px;max-width:92%;align-self:flex-end;white-space:pre-wrap;line-height:1.5'
        el.textContent = texto
        elMensajes.appendChild(el)
        elMensajes.scrollTop = elMensajes.scrollHeight
    }

    function mostrarCargando() {
        const el = document.createElement('div')
        el.id = 'asistente-spinner'
        el.style.cssText = 'background:#f0f4ff;border-radius:8px;padding:10px 12px;font-size:13px;color:#888;align-self:flex-start'
        el.textContent = '…'
        elMensajes.appendChild(el)
        elMensajes.scrollTop = elMensajes.scrollHeight
        return el
    }

    async function llamarClaude(userContent) {
        mensajes.push({ role: 'user', content: userContent })

        const spinner = mostrarCargando()
        elEnviar.disabled = true
        enviando = true

        try {
            const { data, error } = await supabase.functions.invoke('claude-proxy', {
                body: { messages: mensajes, system: SYSTEM_PROMPT_ASISTENTE, max_tokens: 1000 }
            })

            spinner.remove()

            if (error) throw new Error(error.message || 'Error en claude-proxy')

            const respuesta = data?.content?.[0]?.text ?? ''
            if (!respuesta) throw new Error('Respuesta vacía de Claude')

            const MARKER   = '---MENSAJE_CLIENTE---'
            const markerIdx = respuesta.indexOf(MARKER)

            let textoChat, mensajeFinal
            if (markerIdx !== -1) {
                textoChat    = respuesta.slice(0, markerIdx).trim()
                mensajeFinal = respuesta.slice(markerIdx + MARKER.length).trim()
            } else {
                textoChat    = respuesta
                mensajeFinal = null
            }

            if (textoChat) addMensaje('assistant', textoChat)

            mensajes.push({ role: 'assistant', content: respuesta })

            if (mensajeFinal) {
                elMsgFinal.value             = mensajeFinal
                elResultado.style.display    = 'flex'
                elResultado.style.flexDirection = 'column'
                elResultado.style.gap        = '10px'

                const btnEmail = panel.querySelector('#btn-asistente-email')
                const btnWA    = panel.querySelector('#btn-asistente-whatsapp')
                if (btnEmail && solicitud.client_email) {
                    btnEmail.href = `mailto:${solicitud.client_email}?body=${encodeURIComponent(mensajeFinal)}`
                }
                if (btnWA && solicitud.client_phone) {
                    const digits = (solicitud.client_phone).replace(/\D/g, '')
                    const intl   = digits.length <= 9 ? '34' + digits : digits
                    btnWA.href   = `https://wa.me/${intl}?text=${encodeURIComponent(mensajeFinal)}`
                }
            }
        } catch (err) {
            spinner.remove()
            addMensaje('assistant', '❌ Error al conectar con el asistente. Inténtalo de nuevo.')
            console.error('[asistente] Error:', err)
        } finally {
            elEnviar.disabled = false
            enviando = false
        }
    }

    // Event listeners del dialog
    panel.querySelector('#btn-asistente-cerrar').addEventListener('click', () => overlay.close())

    elEnviar.addEventListener('click', async () => {
        if (enviando) return
        const texto = elInput.value.trim()
        if (!texto) return
        elInput.value = ''
        addMensaje('user', texto)
        await llamarClaude(texto)
    })

    elInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            elEnviar.click()
        }
    })

    panel.querySelector('#btn-asistente-copiar')?.addEventListener('click', () => {
        navigator.clipboard.writeText(elMsgFinal.value)
            .then(() => mostrarToast('📋 Copiado al portapapeles'))
            .catch(() => mostrarToast('❌ No se pudo copiar', '#991b1b'))
    })

    // Llamada inicial automática con todo el contexto de la solicitud
    const meta       = parsearMetaComments(solicitud.comments)
    const svcPrinc   = expandirServiceIds(solicitud.level || null, solicitud.day, meta)
    const svcExtra   = meta.extra.flatMap(h => expandirServiceIds(h, null, { dias: null, flexible: true, extra: [] }))
    const serviceIds = [...new Set([...svcPrinc, ...svcExtra])]

    const contextoInicial = JSON.stringify({
        solicitud: {
            nombre:    solicitud.client_name  || null,
            email:     solicitud.client_email || null,
            telefono:  solicitud.client_phone || null,
            evento:    solicitud.level || solicitud.service_id || null,
            dia:       solicitud.day   || null,
            personas:  solicitud.slots || null,
            idioma:    solicitud.language || 'desconocido',
            comentario: solicitud.comments || null
        },
        disponibilidad:     disponibilidadParaAsistente(serviceIds),
        precios_referencia: preciosReferencia(serviceIds)
    }, null, 2)

    await llamarClaude(contextoInicial)
}

// ===== FIN ASISTENTE =====

// ===== PROCESAR EMAIL MANUAL =====

async function abrirProcesarEmail() {
    const { overlay, panel } = crearModal('modal-parsear-email', { wide: true, scroll: true })
    let textoEmail = ''

    function mostrarPaso1() {
        panel.innerHTML = `
            <h3 style="margin-top:0">📧 Procesar email de cliente</h3>
            <p style="color:#555;font-size:14px;margin-bottom:12px">Pega el texto completo del email. Puede incluir cabeceras, texto de reenvío, firmas, etc.</p>
            <textarea id="ep-textarea" rows="13" style="width:100%;box-sizing:border-box;font-size:13px;font-family:monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;resize:vertical" placeholder="Pega aquí el texto del email..."></textarea>
            <div id="ep-error" style="display:none;color:#dc2626;font-size:13px;margin-top:8px"></div>
            <div class="btn-row" style="margin-top:16px">
                <button class="btn btn-primary" id="ep-btn-procesar">Procesar con Claude</button>
                <button class="btn btn-secondary" id="ep-btn-cancelar">Cancelar</button>
            </div>
        `
        panel.querySelector('#ep-textarea').value = textoEmail

        panel.querySelector('#ep-btn-cancelar').addEventListener('click', () => overlay.close())

        panel.querySelector('#ep-btn-procesar').addEventListener('click', async () => {
            textoEmail = panel.querySelector('#ep-textarea').value.trim()
            const errorDiv = panel.querySelector('#ep-error')
            if (!textoEmail) {
                errorDiv.textContent = 'Pega el contenido del email antes de procesar.'
                errorDiv.style.display = 'block'
                return
            }
            const btn = panel.querySelector('#ep-btn-procesar')
            btn.disabled = true
            btn.textContent = 'Procesando…'
            errorDiv.style.display = 'none'
            try {
                const { data, error } = await supabase.functions.invoke('claude-proxy', {
                    body: {
                        model:      'claude-haiku-4-5-20251001',
                        max_tokens: 500,
                        system:     SYSTEM_PROMPT_PARSING,
                        messages:   [{ role: 'user', content: textoEmail }]
                    }
                })
                if (error) throw new Error(error.message || 'Error al invocar claude-proxy')
                const rawText   = String(data?.content?.[0]?.text ?? '').trim()
                const jsonMatch = rawText.match(/\{[\s\S]*\}/)
                if (!jsonMatch) throw new Error('Claude no devolvió JSON válido')
                const parsed = JSON.parse(jsonMatch[0])
                mostrarPasoRevision({ ...parsed, _emailRaw: textoEmail.slice(0, 2000) })
            } catch (err) {
                errorDiv.textContent = `Error: ${err.message}`
                errorDiv.style.display = 'block'
                btn.disabled = false
                btn.textContent = 'Procesar con Claude'
            }
        })
    }

    function mostrarPasoRevision(parsed) {
        const EVENTOS = [
            ['', '— No identificado —'], ['encierro', 'Encierro'],
            ['chupinazo', 'Chupinazo'], ['procesion', 'Procesión'],
            ['gigantes', 'Gigantes'], ['pobre_de_mi', 'Pobre de Mí'],
            ['personalizada', 'Personalizada'], ['empresa', 'Empresa'], ['hotel', 'Hotel']
        ]
        const IDIOMAS = [
            ['es', 'Español'], ['en', 'Inglés'], ['fr', 'Francés'],
            ['it', 'Italiano'], ['de', 'Alemán'], ['other', 'Otro']
        ]
        const extras = [
            parsed.days_all?.length > 1        ? `Días detectados: ${parsed.days_all.join(', ')}` : null,
            parsed.days_flexible               ? 'Flexible con el día' : null,
            parsed.service_hint_extra?.length  ? `Otros eventos: ${parsed.service_hint_extra.join(', ')}` : null
        ].filter(Boolean).join(' · ')

        const esc = v => (v ?? '').toString()
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

        panel.innerHTML = `
            <h3 style="margin-top:0">📋 Datos parseados — revisa y corrige</h3>
            ${extras ? `<p style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;padding:8px 12px;font-size:12px;color:#1e40af;margin-bottom:16px">${extras}</p>` : ''}
            <div class="form-grid">
                <div class="form-field">
                    <label>Nombre</label>
                    <input id="ep-nombre" type="text" value="${esc(parsed.client_name || '')}" placeholder="Nombre del cliente">
                </div>
                <div class="form-field">
                    <label>Email</label>
                    <input id="ep-email" type="text" value="${esc(parsed.client_email || '')}" placeholder="Email">
                </div>
                <div class="form-field">
                    <label>Teléfono</label>
                    <input id="ep-tel" type="text" value="${esc(parsed.client_phone || '')}" placeholder="Teléfono">
                </div>
                <div class="form-field">
                    <label>Evento principal</label>
                    <select id="ep-evento">
                        ${EVENTOS.map(([v, l]) => `<option value="${v}"${parsed.service_hint === v ? ' selected' : ''}>${l}</option>`).join('')}
                    </select>
                </div>
                <div class="form-field">
                    <label>Día de julio</label>
                    <input id="ep-dia" type="number" min="6" max="14" value="${parsed.day || ''}" placeholder="6–14">
                </div>
                <div class="form-field">
                    <label>Personas</label>
                    <input id="ep-personas" type="number" min="1" value="${parsed.slots || ''}" placeholder="Nº personas">
                </div>
                <div class="form-field">
                    <label>Idioma</label>
                    <select id="ep-idioma">
                        ${IDIOMAS.map(([v, l]) => `<option value="${v}"${parsed.language === v ? ' selected' : ''}>${l}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-field" style="margin-top:12px">
                <label>Resumen (editable)</label>
                <textarea id="ep-resumen" rows="4" style="width:100%;box-sizing:border-box;font-size:13px;padding:8px;border:1px solid #d1d5db;border-radius:4px">${esc(parsed.comments || '')}</textarea>
            </div>
            <div id="ep-error2" style="display:none;color:#dc2626;font-size:13px;margin-top:8px"></div>
            <div class="btn-row" style="margin-top:16px">
                <button class="btn btn-primary" id="ep-btn-guardar-responder">💬 Guardar y responder</button>
                <button class="btn btn-secondary" id="ep-btn-solo-guardar">Solo guardar</button>
                <button class="btn btn-secondary" id="ep-btn-volver">← Volver</button>
            </div>
        `

        const getCampos = () => ({
            client_name:        panel.querySelector('#ep-nombre').value.trim()      || null,
            client_email:       panel.querySelector('#ep-email').value.trim()       || null,
            client_phone:       panel.querySelector('#ep-tel').value.trim()         || null,
            service_hint:       panel.querySelector('#ep-evento').value             || null,
            day:                parseInt(panel.querySelector('#ep-dia').value)      || null,
            slots:              parseInt(panel.querySelector('#ep-personas').value) || null,
            language:           panel.querySelector('#ep-idioma').value,
            comments_resumen:   panel.querySelector('#ep-resumen').value.trim(),
            days_all:           parsed.days_all           || [],
            days_flexible:      parsed.days_flexible      || false,
            service_hint_extra: parsed.service_hint_extra || [],
            _emailRaw:          parsed._emailRaw          || null
        })

        async function guardar(abrirAsistente) {
            const btnGR  = panel.querySelector('#ep-btn-guardar-responder')
            const btnSG  = panel.querySelector('#ep-btn-solo-guardar')
            const errDiv = panel.querySelector('#ep-error2')
            btnGR.disabled = btnSG.disabled = true
            errDiv.style.display = 'none'
            try {
                const solicitud = await _insertarEmailParseado(getCampos())
                await cargarSolicitudes()
                overlay.close()
                if (abrirAsistente) abrirAsistenteRespuesta(solicitud)
            } catch (err) {
                errDiv.textContent = `Error al guardar: ${err.message}`
                errDiv.style.display = 'block'
                btnGR.disabled = btnSG.disabled = false
            }
        }

        panel.querySelector('#ep-btn-guardar-responder').addEventListener('click', () => guardar(true))
        panel.querySelector('#ep-btn-solo-guardar').addEventListener('click', () => guardar(false))
        panel.querySelector('#ep-btn-volver').addEventListener('click', mostrarPaso1)
    }

    mostrarPaso1()
    overlay.showModal()
}

async function _insertarEmailParseado(campos) {
    let prefix = ''
    if (campos.days_flexible) {
        prefix += 'Días: cualquiera\n'
    } else if (campos.days_all.length > 1) {
        prefix += `Días: ${campos.days_all.join(', ')}\n`
    }
    if (campos.service_hint_extra.length > 0) {
        prefix += `Otros servicios: ${campos.service_hint_extra.join(', ')}\n`
    }
    const finalComments = prefix
        ? prefix + '\n' + campos.comments_resumen
        : campos.comments_resumen

    const { data, error } = await supabase
        .from('reservation_requests')
        .insert({
            client_name:  campos.client_name  || 'Sin nombre',
            client_email: campos.client_email || null,
            client_phone: campos.client_phone || null,
            service_id:   null,
            slots:        campos.slots        || null,
            day:          campos.day          || null,
            level:        campos.service_hint || null,
            comments:     finalComments,
            source:       'email',
            status:       'email_parsed',
            language:     campos.language     || 'es',
            email_raw:    campos._emailRaw    || null
        })
        .select()
        .single()

    if (error) throw new Error(error.message)
    return data
}

// ===== FIN PROCESAR EMAIL MANUAL =====

document.getElementById('btnCerrarReorg').addEventListener('click', cerrarPanelReorganizar)
document.getElementById('btnCancelarReorg').addEventListener('click', cerrarPanelReorganizar)
document.getElementById('btnConfirmarReorg').addEventListener('click', confirmarReorganizacion)
document.getElementById('btnProcesarEmail').addEventListener('click', abrirProcesarEmail)

// Cargar solicitudes al iniciar
cargarSolicitudes()

// Comprobar pedidos nuevos en sfcom y luego verificar coherencia.
// El orden es importante: los pedidos registrados por checkSfcomOrders influyen
// en pendingExplains de verificarCoherencia (solicitudes sfcom pendientes que
// explican discrepancias de stock). Si se ejecutaran en paralelo, la verificación
// podría reportar discrepancias reales que en realidad están explicadas por pedidos
// que aún no se habían registrado.
checkSfcomOrders(supabase, 90)
    .then(async resultado => {
        if (resultado.ok && resultado.nuevos?.length) {
            await registrarPedidosSfcom(resultado.nuevos)
        }
    })
    .catch(e => console.warn('[sfcom] checkSfcomOrders al inicio:', e.message))
    .finally(() => {
        ejecutarVerificacion(false).catch(e => console.error('[verificacion] Error al inicio:', e.message))
    })

async function ejecutarVerificacion(modoManual = false) {
    const toastEl = mostrarToast('🔍 Verificando coherencia…', '#374151')

    let resultado
    try {
        resultado = await verificarCoherencia(supabase, { checkVariationNames: modoManual })
    } finally {
        toastEl?.remove()
    }
    const hayMismatch = (resultado.sfcom.idsMismatch?.length ?? 0) > 0

    if (hayMismatch) {
        const decision = await mostrarModalPreCorreccion(resultado.sfcom.idsMismatch)
        if (decision === 'corregir') {
            for (const m of resultado.sfcom.idsMismatch) {
                await verificarConfirmarSfcom(supabase, m.availId, m.servicio, m.serviceId)
            }
            const resultadoCorregido = await verificarCoherencia(supabase, { checkVariationNames: true })
            mostrarModalVerificacion(resultadoCorregido, supabase, () => ejecutarVerificacion(true))
        } else {
            mostrarModalVerificacion(resultado, supabase, () => ejecutarVerificacion(true), { sinBotonCorregir: true })
        }
        return
    }

    const discRepReal   = (resultado.sfcom.discrepancias ?? []).filter(d => !d.pendingExplains)
    const hayPendientes = (resultado.sfcom.discrepancias ?? []).some(d => d.pendingExplains)
    const hayFallos     = (resultado.sfcom.fallos?.length ?? 0) > 0
    const hayProblema   = resultado.errores.length > 0 || discRepReal.length > 0

    if (modoManual || hayProblema || hayPendientes) {
        mostrarModalVerificacion(resultado, supabase, () => ejecutarVerificacion(true))
    } else if (!resultado.sfcom.verificado) {
        mostrarToast('⚠️ Reservas verificadas — sfcom no disponible', '#92400e')
    } else {
        mostrarToast('✅ Coherencia de reservas, plazas y sfcom verificada y correcta')
    }
}

document.getElementById('btnVerificarDatos').addEventListener('click', () => {
    ejecutarVerificacion(true).catch(e => console.error('[verificacion] Error:', e.message))
})

document.getElementById('btnExportReservasCliente')?.addEventListener('click', () => {
    const id = clienteActual?.id ?? 'cliente'
    exportTable(reservasCliente, [
        { key: 'id',             label: 'ID reserva' },
        { key: 'service_id',     label: 'Servicio' },
        { key: 'provider_id',    label: 'Proveedor' },
        { key: 'slots',          label: 'Plazas' },
        { key: 'price_per_slot', label: '€/plaza',    fmt: v => fmt(v) },
        { key: 'total_amount',   label: 'Total',      fmt: v => fmt(v) },
        { key: 'status',         label: 'Estado' },
        { key: 'comments',       label: 'Comentarios' },
        { key: 'sfcom_order_ref',label: 'Ref. sfcom' },
    ], `reservas_${id}.xlsx`)
})

// Precarga de cliente desde parámetro URL (ej: panel.html → formulario.html?cliente=GARCIA_PEDRO)
const _clienteParam = new URLSearchParams(location.search).get('cliente')
if (_clienteParam) {
    const _clientePreload = todosClientes.find(c => c.id === _clienteParam.toUpperCase())
    if (_clientePreload) { inputId.value = _clientePreload.id; cargarCliente(_clientePreload) }
}

