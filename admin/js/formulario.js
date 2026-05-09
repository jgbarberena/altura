import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, normalizarId, buscarConPrioridad, persistirCobrosCliente, persistirPagosProveedor } from './utils.js'
import { initFacturacion, abrirPanelFactura } from './factura.js'

await requireAuth()
initFacturacion(supabase)
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

// ===== DATOS GLOBALES =====
const { data: todosClientes }  = await supabase.from('clients').select('*').order('id')
const { data: servicios }      = await supabase.from('services').select('*').order('day')
const { data: disponibilidad } = await supabase.from('availability').select('*')
let todasReservas              = (await supabase.from('reservations').select('*')).data

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
        statusDiv.textContent = '✨ Cliente nuevo'
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
    const { data: reservas } = await supabase
        .from('reservations').select('*').eq('client_id', clienteId).order('id')

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
    tbody.innerHTML = datos.map(r => `
        <tr data-id="${r.id}" style="cursor:pointer">
            <td><input type="checkbox" class="chk-reserva"></td>
            <td>${r.id}</td>
            <td>${r.service_id}</td>
            <td>${r.provider_id}</td>
            <td>${r.slots}</td>
            <td>${r.price_per_slot}€</td>
            <td>${r.total_amount}€</td>
            <td class="${r.status === 'Confirmada' ? 'ok' : r.status === 'Cancelada' ? 'error' : 'warn'}">${r.status}</td>
        </tr>`
    ).join('')

    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', e => {
            if (e.target.type === 'checkbox') return
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
                id: clienteId, name: nombre || null,
                company:  inputCompany.value.trim()  || null,
                phone:    inputPhone.value.trim()    || null,
                email:    inputEmail.value.trim()    || null,
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

function calcularTotalCobrarCliente(clienteId) {
    return todasReservas
        .filter(r => r.client_id === clienteId && r.status !== 'Cancelada')
        .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
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

    hitosClienteTemp = (charges ?? []).map(h => ({ ...h, esFinal: h.comments === 'Cobro final' }))

    const total      = calcularTotalCobrarCliente(clienteId)
    const prepagos   = hitosClienteTemp.filter(h => !h.esFinal).reduce((s, h) => s + parseFloat(h.amount), 0)
    const cobroFinal = total - prepagos

    if (!hitosClienteTemp.find(h => h.esFinal)) {
        hitosClienteTemp.push({
            esFinal:   true,
            comments:  'Cobro final',
            client_id: clienteId,
            amount:    cobroFinal,
            due_date:  '2026-07-06',
            collected: false
        })
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
        const yaFacturado = h.invoiced && h.invoice_number
        const btnFacturar = !yaFacturado && h.id
            ? `<button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;margin-right:4px"
                   onclick="facturarHito('${h.id}')">📄 Facturar</button>`
            : yaFacturado
                ? `<span style="font-size:11px;color:var(--accent-ok);margin-right:6px">📄 ${h.invoice_number}</span>`
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

window.cambiarFechaCobroFinal = function(idx, valor) {
    hitosClienteTemp[idx].due_date = valor || null
}

window.toggleCobroCliente = function(idx) {
    const h = hitosClienteTemp[idx]
    if (!h.collected) {
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
}

window.eliminarCobroCliente = function(idx) {
    const h = hitosClienteTemp[idx]
    if (h.invoiced) {
        alert('Este hito ya ha sido facturado y no puede eliminarse.\nSi necesitas corregirlo, contacta con el administrador de la base de datos.')
        return
    }
    hitosClienteTemp.splice(idx, 1)
    const total    = calcularTotalCobrarCliente(clienteActual.id)
    const prepagos = hitosClienteTemp.filter(h => !h.esFinal).reduce((s, h) => s + parseFloat(h.amount), 0)
    const idxFinal = hitosClienteTemp.findIndex(h => h.esFinal)
    if (idxFinal >= 0) hitosClienteTemp[idxFinal].amount = total - prepagos
    actualizarResumenCobros(clienteActual.id, total, prepagos, total - prepagos)
    renderCobrosCliente()
}

document.getElementById('btnNuevoCobroCliente').addEventListener('click', () => {
    document.getElementById('form-nuevo-cobro-cliente').style.display = 'block'
    document.getElementById('btnNuevoCobroCliente').style.display     = 'none'
})

document.getElementById('btnCancelarNuevoCobro').addEventListener('click', () => {
    document.getElementById('form-nuevo-cobro-cliente').style.display = 'none'
    document.getElementById('btnNuevoCobroCliente').style.display     = 'inline-block'
})

document.getElementById('btnGuardarNuevoCobro').addEventListener('click', () => {
    const concepto = document.getElementById('cobroConcepto').value.trim() || 'Prepago'
    const importe  = parseFloat(document.getElementById('cobroImporte').value)
    const fecha    = document.getElementById('cobroFecha').value || null
    const cobrado  = document.getElementById('cobroCobrado').value === 'true'
    if (!importe || importe <= 0) { alert('Introduce un importe válido'); return }

    const idxFinal = hitosClienteTemp.findIndex(h => h.esFinal)
    hitosClienteTemp.splice(idxFinal >= 0 ? idxFinal : hitosClienteTemp.length, 0, {
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
})

document.getElementById('btnGuardarCobros').addEventListener('click', async () => {
    if (!clienteActual) return

    await supabase.from('charges').delete().eq('client_id', clienteActual.id)

    for (const h of hitosClienteTemp) {
        await supabase.from('charges').insert({
            client_id:      clienteActual.id,
            amount:         parseFloat(h.amount),
            due_date:       h.due_date,
            collected:      h.collected,
            collected_date: h.collected_date ?? null,
            comments:       h.comments
        })
    }

    await cargarCobrosCliente(clienteActual.id, reservasCliente)  // ← sustituye el alert
})

window.facturarHito = async function(hitoId) {
    if (!clienteActual) return
    hitoId = parseInt(hitoId)

    const hitoTemp    = hitosClienteTemp.find(h => h.id === hitoId)
    const esHitoFinal = hitoTemp?.esFinal ?? false

    if (esHitoFinal) {
        const sinFacturar = hitosClienteTemp.filter(h =>
            h.id && h.id !== hitoId && !h.invoiced
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

    // Eliminar instancia anterior si existe
    document.getElementById('panel-reorganizar')?.remove()
    document.getElementById('overlay-reorg')?.remove()

    // Crear overlay como hijo directo del body
    const overlay = document.createElement('div')
    overlay.id = 'overlay-reorg'
    document.body.appendChild(overlay)

    // Crear panel como hijo directo del body
    const panel = document.createElement('div')
    panel.id = 'panel-reorganizar'
    panel.innerHTML = `
        <div class="panel-reorg-header">
            <div>
                <h2 class="panel-reorg-titulo">🔄 Reorganizar disponibilidad</h2>
                <div id="panel-reorg-cabecera"></div>
            </div>
            <button class="btn btn-secondary panel-reorg-cerrar" onclick="cerrarPanelReorganizar()">✕ Cerrar</button>
        </div>
        <div id="panel-reorg-estado"></div>
        <div class="table-wrapper table-wrapper--spaced">
            <table id="tabla-reorg">
                <thead><tr>
                    <th>Reserva</th>
                    <th>Cliente</th>
                    <th>Servicio</th>
                    <th>Proveedor</th>
                    <th>Plazas</th>
                    <th>Precio/plaza</th>
                </tr></thead>
                <tbody id="tbody-reorg"></tbody>
            </table>
        </div>
        <div class="btn-row">
            <button class="btn btn-primary" id="btnConfirmarReorg" disabled onclick="confirmarReorganizacion()">
                ✅ Confirmar cambios
            </button>
            <button class="btn btn-secondary" onclick="cerrarPanelReorganizar()">Cancelar</button>
        </div>
    `
    document.body.appendChild(panel)

    // requestAnimationFrame garantiza que Safari pinte el elemento antes de mostrarlo
    requestAnimationFrame(() => {
        panel.style.display   = 'block'
        overlay.style.display = 'block'
        renderPanelReorganizar()
    })
}

window.cerrarPanelReorganizar = function() {
    document.getElementById('panel-reorganizar')?.remove()
    document.getElementById('overlay-reorg')?.remove()
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
            <td style="font-size:12px; text-align:center">${r.price_per_slot}€</td>
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
    if (r.service_id !== original.service_id || r.provider_id !== original.provider_id) {
        reorgCambios[r.id] = { service_id: r.service_id, provider_id: r.provider_id }
    } else {
        delete reorgCambios[r.id]
    }
}

window.confirmarReorganizacion = async function() {
    if (Object.keys(reorgCambios).length === 0) return

    const lineas = Object.entries(reorgCambios).map(([id, cambio]) => {
        const original = todasReservas.find(r => r.id === id)
        const partes   = []
        if (cambio.service_id  !== original.service_id)  partes.push(`${original.service_id} → ${cambio.service_id}`)
        if (cambio.provider_id !== original.provider_id) partes.push(`${original.provider_id} → ${cambio.provider_id}`)
        return `${id}  ${original.client_id}  ${partes.join('  |  ')}`
    })

    const confirmado = confirm(`¿Confirmar los siguientes cambios?\n\n${lineas.join('\n')}`)
    if (!confirmado) return

    for (const [id, cambio] of Object.entries(reorgCambios)) {
        const { error } = await supabase.from('reservations')
            .update({ service_id: cambio.service_id, provider_id: cambio.provider_id })
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