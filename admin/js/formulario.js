import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, normalizarId, buscarConPrioridad, persistirCobrosCliente, persistirPagosProveedor } from './utils.js'
import { initFacturacion, abrirPanelFactura } from './factura.js'
import { initPropuesta, abrirPanelPropuesta } from './propuesta.js'

await requireAuth()
initFacturacion(supabase)
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

// ===== DATOS GLOBALES =====
const { data: todosClientes }  = await supabase.from('clients').select('*').order('id')
const { data: servicios }      = await supabase.from('services').select('*').order('day')
const { data: disponibilidad } = await supabase.from('availability').select('*')
const { data: providers }      = await supabase.from('providers').select('*').order('id')
let todasReservas              = (await supabase.from('reservations').select('*')).data

initPropuesta(supabase, servicios, providers)

let clienteActual     = null
let reservaEditandoId = null
let hitosClienteTemp  = []
const hoy             = new Date().toISOString().split('T')[0]
const fmt             = n => parseFloat(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })

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
camposCliente.forEach((input, i) => {
    input.addEventListener('change', async () => {
        if (!clienteActual) return
        const { error } = await supabase
            .from('clients')
            .update({ [camposDB[i]]: input.value.trim() || null })
            .eq('id', clienteActual.id)
        if (error) {
            statusDiv.textContent = '❌ Error: ' + error.message
            statusDiv.style.color = 'var(--accent)'
        } else {
            clienteActual[camposDB[i]] = input.value.trim() || null
            statusDiv.textContent = '✅ Guardado'
            statusDiv.style.color = 'var(--accent-ok)'
            setTimeout(() => {
                statusDiv.textContent = '✅ Cliente existente — los cambios se guardan automáticamente'
            }, 2000)
        }
    })
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

selectServicio.addEventListener('change', () => {
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
        const { libres } = getPlazasInfo(proveedorId, servicioId)
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

function getPlazasInfo(proveedorId, servicioId) {
    const reservasPS  = todasReservas.filter(r =>
        r.provider_id === proveedorId &&
        r.service_id  === servicioId  &&
        r.status      !== 'Cancelada'
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
        const { total, pendientes, libres } = getPlazasInfo(d.provider_id, servicioId)
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
                const { libres } = getPlazasInfo(proveedorActual, servicioId)
                if (libres < plazas) {
                    precioStatus.textContent = `⚠️ ${proveedorActual} no tiene plazas libres suficientes para ${plazas} plazas`
                    precioStatus.style.color = 'var(--accent-warn)'
                }
            }
        }
    }

    if (proveedorActual && selectProveedor.value === proveedorActual) {
        const { libres } = getPlazasInfo(proveedorActual, servicioId)
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
        precioStatus.textContent = ''
        inputPrecio.className    = ''
        return
    }

    const disp = disponibilidad.find(d => d.service_id === servicioId && d.provider_id === proveedorId)
    if (!disp) return

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

    const afectadas = todasReservas.filter(r => ids.includes(r.id))
        .map(r => ({ proveedorId: r.provider_id, servicioId: r.service_id }))

    const { error } = await supabase.from('reservations').update({ status: nuevoEstado }).in('id', ids)
    if (!error && clienteActual) {
        todasReservas = todasReservas.map(r =>
            ids.includes(r.id) ? { ...r, status: nuevoEstado } : r
        )
        await persistirCobrosCliente(supabase, clienteActual.id, todasReservas)
        for (const { proveedorId } of afectadas) {
            await persistirPagosProveedor(supabase, proveedorId, todasReservas, disponibilidad)
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

    const afectadas = todasReservas.filter(r => ids.includes(r.id))
        .map(r => ({ proveedorId: r.provider_id, servicioId: r.service_id }))

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

    for (const { proveedorId } of afectadas) {
        await persistirPagosProveedor(supabase, proveedorId, todasReservas, disponibilidad)
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

    if (reservaEditandoId) {
        const { error } = await supabase.from('reservations').update({
            service_id: servicioId, provider_id: proveedorId,
            slots: plazas, price_per_slot: precio, status: estado, comments
        }).eq('id', reservaEditandoId)
        if (error) { alert('Error al guardar: ' + error.message); return }

        const { data: reservasActualizadas } = await supabase.from('reservations').select('*')
        todasReservas = reservasActualizadas

        await persistirCobrosCliente(supabase, clienteActual.id, todasReservas)
        await persistirPagosProveedor(supabase, proveedorId, todasReservas, disponibilidad)
        await cargarReservasCliente(clienteActual.id)
        actualizarProveedores()
        limpiarFormularioReserva()

    } else {
        const { libres } = getPlazasInfo(proveedorId, servicioId)
        if (libres < plazas) {
            alert(`No hay suficientes plazas libres. Disponibles: ${libres}, necesitas: ${plazas}`)
            return
        }

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
            slots: plazas, price_per_slot: precio, status: estado, comments
        })
        if (errReserva) { alert('Error al crear reserva: ' + errReserva.message); return }

        const { data: reservasActualizadas } = await supabase.from('reservations').select('*')
        todasReservas = reservasActualizadas

        await persistirCobrosCliente(supabase, clienteActual.id, todasReservas)
        await persistirPagosProveedor(supabase, proveedorId, todasReservas, disponibilidad)
        await cargarReservasCliente(clienteActual.id)
        actualizarProveedores()
        limpiarFormularioReserva()
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
        d, ...getPlazasInfo(d.provider_id, servicioId)
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
                    <span class="cliente" style="color:${r.status === 'Confirmada' ? 'var(--accent-ok)' : 'var(--accent-warn)'}">${r.client_id}</span>
                    <span class="plazas">${r.slots} pzs</span>
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
        const { libres } = getPlazasInfo(proveedorId, servicioId)
        if (libres < plazas) {
            abrirPanelReorganizar(proveedorId, servicioId, plazas)
            return
        }
    }

    const opcionExiste = [...selectProveedor.options].some(o => o.value === proveedorId)
    if (!opcionExiste) {
        const { total, libres } = getPlazasInfo(proveedorId, servicioId)
        const opt = document.createElement('option')
        opt.value       = proveedorId
        opt.textContent = `${proveedorId} (${libres}/${total})`
        selectProveedor.appendChild(opt)
    }
    selectProveedor.value = proveedorId
    selectProveedor.dispatchEvent(new Event('change'))
}

// ===== BLOQUE 5: COBROS AL CLIENTE =====

// Fecha por defecto para el cobro final: 6 de julio del anio en curso
// o del siguiente si ya hemos pasado el 15 de julio
function fechaCobroDefault() {
    const hoy  = new Date()
    const anio = hoy.getMonth() < 6 || (hoy.getMonth() === 6 && hoy.getDate() < 15)
        ? hoy.getFullYear()
        : hoy.getFullYear() + 1
    return `${anio}-07-06`
}

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

    for (const [id, cambio] of Object.entries(reorgCambios)) {
        const updateData = {}
        if (cambio.service_id     !== undefined) updateData.service_id     = cambio.service_id
        if (cambio.provider_id    !== undefined) updateData.provider_id    = cambio.provider_id
        if (cambio.price_per_slot !== undefined) updateData.price_per_slot = cambio.price_per_slot

        const { error } = await supabase.from('reservations')
            .update(updateData)
            .eq('id', id)
        if (error) { alert(`Error al actualizar ${id}: ` + error.message); return }
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

    cerrarPanelReorganizar()
    actualizarBloque3()
    actualizarProveedores()
    if (clienteActual) await cargarReservasCliente(clienteActual.id)

    alert('✅ Cambios guardados. Ahora puedes añadir la reserva.')
}

// ===== LISTENERS DEL DIALOG DE REORGANIZACIÓN =====
document.getElementById('btnCerrarReorg').addEventListener('click', cerrarPanelReorganizar)
document.getElementById('btnCancelarReorg').addEventListener('click', cerrarPanelReorganizar)
document.getElementById('btnConfirmarReorg').addEventListener('click', confirmarReorganizacion)