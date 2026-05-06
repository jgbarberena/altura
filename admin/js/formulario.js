import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'

await requireAuth()

document.getElementById('btnLogout').addEventListener('click', logout)

// Hamburger móvil
const sidebar    = document.getElementById('sidebar')
const overlayMenu = document.getElementById('overlayMenu')
document.getElementById('hamburger').addEventListener('click', () => {
    sidebar.classList.toggle('open')
    overlayMenu.classList.toggle('open')
})
overlayMenu.addEventListener('click', () => {
    sidebar.classList.remove('open')
    overlayMenu.classList.remove('open')
})

// ===== DATOS GLOBALES =====
// Se cargan una vez al inicio y se mantienen en memoria
const { data: todosClientes }  = await supabase.from('clients').select('*').order('id')
const { data: servicios }      = await supabase.from('services').select('*').order('day')
const { data: disponibilidad } = await supabase.from('availability').select('*')
let todasReservas              = (await supabase.from('reservations').select('*')).data

let clienteActual     = null  // objeto cliente seleccionado, null si es nuevo
let reservaEditandoId = null  // ID de la reserva en edición, null si es nueva
let hitosTemp         = []    // hitos de cobro temporales, se persisten al guardar
const hoy             = new Date().toISOString().split('T')[0] // fecha actual para comparar vencimientos

// ===== REFERENCIAS DOM =====
const inputId       = document.getElementById('inputClientId')
const inputName     = document.getElementById('inputName')
const inputCompany  = document.getElementById('inputCompany')
const inputPhone    = document.getElementById('inputPhone')
const inputEmail    = document.getElementById('inputEmail')
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

// Poblar desplegable de servicios al inicio
servicios.forEach(s => {
    const opt = document.createElement('option')
    opt.value = s.id
    opt.textContent = s.id
    selectServicio.appendChild(opt)
})

// Autocomplete del ID de cliente mientras se escribe
inputId.addEventListener('input', () => {
    const val = inputId.value.trim().toUpperCase()
    if (!val) {
        autoList.style.display = 'none'
        limpiarCamposCliente()
        return
    }
    const coincidencias = todosClientes.filter(c => c.id.toUpperCase().startsWith(val))
    if (coincidencias.length > 0) {
        autoList.innerHTML = coincidencias.map(c =>
            `<div data-id="${c.id}">${c.id}</div>`
        ).join('')
        autoList.style.display = 'block'
    } else {
        autoList.style.display = 'none'
    }
    // Si coincide exactamente con un cliente existente, cargarlo
    const exacto = todosClientes.find(c => c.id.toUpperCase() === val)
    if (exacto) {
        cargarCliente(exacto)
    } else {
        // Si había un cliente cargado antes, limpiar sus datos
        if (clienteActual) {
            inputName.value     = ''
            inputCompany.value  = ''
            inputPhone.value    = ''
            inputEmail.value    = ''
            inputComments.value = ''
            document.getElementById('bloque-reservas-cliente').style.display = 'none'
            limpiarFormularioReserva()
        }
        clienteActual = null
        statusDiv.textContent = '✨ Cliente nuevo'
        statusDiv.style.color = 'var(--accent-warn)'
    }
})

// Selección desde el desplegable de autocomplete
autoList.addEventListener('click', e => {
    const div = e.target.closest('[data-id]')
    if (!div) return
    const cliente = todosClientes.find(c => c.id === div.dataset.id)
    if (cliente) {
        inputId.value = cliente.id
        cargarCliente(cliente)
        autoList.style.display = 'none'
    }
})

// Cerrar autocomplete al hacer click fuera
document.addEventListener('click', e => {
    if (!e.target.closest('.autocomplete-wrap')) autoList.style.display = 'none'
})

// Carga los datos de un cliente existente en el formulario
function cargarCliente(cliente) {
    clienteActual       = cliente
    inputName.value     = cliente.name     ?? ''
    inputCompany.value  = cliente.company  ?? ''
    inputPhone.value    = cliente.phone    ?? ''
    inputEmail.value    = cliente.email    ?? ''
    inputComments.value = cliente.comments ?? ''
    statusDiv.textContent = '✅ Cliente existente — los cambios se guardan automáticamente'
    statusDiv.style.color = 'var(--accent-ok)'
    limpiarFormularioReserva()
    cargarReservasCliente(cliente.id)
}

// Limpia todos los campos de cliente y oculta la tabla de reservas
function limpiarCamposCliente() {
    clienteActual = null
    inputName.value = inputCompany.value = inputPhone.value =
    inputEmail.value = inputComments.value = ''
    statusDiv.textContent = ''
    document.getElementById('bloque-reservas-cliente').style.display = 'none'
    limpiarFormularioReserva()
}

// Limpia el formulario de reserva y el panel de hitos
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
    precioStatus.textContent = ''
    inputPrecio.className    = ''
    btnAnadir.disabled        = true
    btnAnadir.textContent     = 'Añadir reserva'
    document.getElementById('btnCancelarEdicion').style.display = 'none'
    document.querySelectorAll('.chk-reserva:checked').forEach(chk => chk.checked = false)
    // Resetear panel de hitos
    hitosTemp = []
    document.getElementById('panel-pagos').style.display      = 'none'
    document.getElementById('contenido-pagos').style.display  = 'none'
    document.getElementById('togglePagosIcon').textContent    = '▶'
    document.getElementById('form-nuevo-pago').style.display  = 'none'
    document.getElementById('btnNuevoPago').style.display     = 'inline-block'
    document.getElementById('bloque-disponibilidad').style.display = 'none'
    document.getElementById('resumen-servicio').style.display = 'none'
    document.getElementById('columnas-proveedores').innerHTML = ''
}

// Guarda automáticamente en Supabase cuando cambia un campo de cliente existente
const camposCliente = [inputName, inputCompany, inputPhone, inputEmail, inputComments]
const camposDB      = ['name', 'company', 'phone', 'email', 'comments']
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

// Al cambiar servicio, actualizar lista de proveedores disponibles
// En selectServicio change:
selectServicio.addEventListener('change', () => {
    actualizarProveedores()
    actualizarBtnAnadir()
    actualizarBloque3()  // ← añadir
})

// En inputPlazas input:
inputPlazas.addEventListener('input', () => {
    actualizarProveedores()
    actualizarTotal()
    actualizarBtnAnadir()
    if (selectProveedor.value || reservaEditandoId) inicializarHitoFinal()
    actualizarBloque3()  // ← añadir
})

// En selectProveedor change:
selectProveedor.addEventListener('change', () => {
    validarPrecio()
    actualizarBtnAnadir()
    if (selectProveedor.value && !reservaEditandoId) {
        hitosTemp = []
        inicializarHitoFinal()
        mostrarPanelPagos()
    } else if (!selectProveedor.value && !reservaEditandoId) {
        document.getElementById('panel-pagos').style.display = 'none'
        hitosTemp = []
    }
    actualizarBloque3()  // ← añadir
})

// Al cambiar precio, validar margen, recalcular total e hito final
inputPrecio.addEventListener('input', () => {
    validarPrecio()
    actualizarTotal()
    actualizarBtnAnadir()
    if (selectProveedor.value || reservaEditandoId) inicializarHitoFinal()
})

// Actualiza el campo de total informativo (plazas × precio)
function actualizarTotal() {
    const plazas = parseInt(inputPlazas.value) || 0
    const precio = parseFloat(inputPrecio.value) || 0
    const total  = plazas * precio
    document.getElementById('inputTotal').value =
        total > 0 ? total.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }) : '—'
}

// Calcula plazas confirmadas, pendientes y libres para un proveedor+servicio
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

// Actualiza el desplegable de proveedores según servicio y plazas seleccionadas
// Filtra imposibles y muestra símbolo de disponibilidad en cada opción
function actualizarProveedores() {
    const servicioId      = selectServicio.value
    const plazas          = parseInt(inputPlazas.value) || 0
    const proveedorActual = selectProveedor.value // guardar selección actual

    selectProveedor.innerHTML = '<option value="">— Selecciona proveedor —</option>'

    if (!servicioId) { selectProveedor.disabled = true; return }

    const dispServicio = disponibilidad.filter(d => d.service_id === servicioId)
    if (dispServicio.length === 0) { selectProveedor.disabled = true; return }

    selectProveedor.disabled = false

    dispServicio.forEach(d => {
        const { total, confirmadas, pendientes, libres } = getPlazasInfo(d.provider_id, servicioId)
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

    // Restaurar proveedor seleccionado si sigue disponible en el desplegable
    if (proveedorActual) {
        const opcionExiste = [...selectProveedor.options].some(o => o.value === proveedorActual)
        if (opcionExiste) {
            selectProveedor.value = proveedorActual
            // Avisar si el proveedor restaurado no tiene plazas suficientes
            if (plazas > 0) {
                const { libres } = getPlazasInfo(proveedorActual, servicioId)
                if (libres < plazas) {
                    precioStatus.textContent = `⚠️ ${proveedorActual} no tiene plazas libres suficientes para ${plazas} plazas`
                    precioStatus.style.color = 'var(--accent-warn)'
                }
            }
        }
        // Si desapareció (capacidad total insuficiente) se queda en blanco automáticamente
    }
    
    // Limpiar aviso de plazas si el proveedor actual ahora tiene suficientes
    if (proveedorActual && selectProveedor.value === proveedorActual) {
        const { libres } = getPlazasInfo(proveedorActual, servicioId)
        if (plazas === 0 || libres >= plazas) {
            // Solo limpiar si el mensaje actual es el de plazas insuficientes
            if (precioStatus.textContent.includes('no tiene plazas')) {
                precioStatus.textContent = ''
                precioStatus.style.color = ''
            }
        }
    }
}

// Valida el precio introducido respecto al coste del proveedor y muestra aviso de margen
function validarPrecio() {
    const servicioId  = selectServicio.value
    const proveedorId = selectProveedor.value
    const precio      = parseFloat(inputPrecio.value) || 0

    if (!servicioId || !proveedorId || precio === 0) {
        precioStatus.textContent = ''
        inputPrecio.className    = ''
        return
    }

    const disp = disponibilidad.find(d =>
        d.service_id === servicioId && d.provider_id === proveedorId
    )
    if (!disp) return

    const coste  = parseFloat(disp.price_per_slot) || 0
    const margen = coste > 0 ? (precio - coste) / coste : 1

    if (precio <= coste) {
        inputPrecio.className     = 'error'
        precioStatus.style.color  = 'var(--accent)'
        precioStatus.textContent  = `❌ Por debajo del coste (${coste}€/plaza)`
    } else if (margen < 0.10) {
        inputPrecio.className     = 'warn'
        precioStatus.style.color  = 'var(--accent-warn)'
        precioStatus.textContent  = `⚠️ Margen bajo — coste: ${coste}€/plaza`
    } else {
        inputPrecio.className     = 'ok'
        precioStatus.style.color  = 'var(--accent-ok)'
        precioStatus.textContent  = `✅ Margen OK — coste: ${coste}€/plaza`
    }
}

// Habilita o deshabilita el botón de añadir según campos obligatorios
function actualizarBtnAnadir() {
    const tieneCliente   = inputId.value.trim().length > 0
    const tieneServicio  = selectServicio.value !== ''
    const tieneProveedor = selectProveedor.value !== ''
    const tienePlazas    = parseInt(inputPlazas.value) > 0
    const tienePrecio    = parseFloat(inputPrecio.value) > 0
    const basico         = tieneCliente && tieneServicio && tieneProveedor && tienePlazas && tienePrecio
    // En modo edición, si hay datos básicos siempre se puede guardar
    btnAnadir.disabled   = !basico
}

// ===== BLOQUE 4: RESERVAS DEL CLIENTE =====

// Carga desde Supabase las reservas del cliente y sus cobros, y renderiza la tabla
async function cargarReservasCliente(clienteId) {
    const { data: reservas } = await supabase
        .from('reservations')
        .select('*')
        .eq('client_id', clienteId)
        .order('id')

    const tbody  = document.getElementById('tbody-reservas-cliente')
    const bloque = document.getElementById('bloque-reservas-cliente')

    if (!reservas || reservas.length === 0) {
        bloque.style.display = 'none'
        return
    }

    // Cargar charges de todas las reservas del cliente en una sola query
    const reservaIds     = reservas.map(r => r.id)
    const { data: charges } = await supabase
        .from('charges')
        .select('*')
        .in('reservation_id', reservaIds)

    bloque.style.display = 'block'
    tbody.innerHTML = reservas.map(r => {
        const chs        = charges?.filter(c => c.reservation_id === r.id) ?? []
        const cobrado    = chs.filter(c =>  c.collected).reduce((s, c) => s + parseFloat(c.amount), 0)
        const pendiente  = chs.filter(c => !c.collected).reduce((s, c) => s + parseFloat(c.amount), 0)
        const vencido    = chs.some(c => !c.collected && c.due_date && c.due_date < hoy)
        const tieneHitos = chs.length > 1 // más de un hito = tiene prepagos planificados

        const clasePendiente = pendiente === 0 ? 'ok' : vencido ? 'error' : 'warn'

        return `
        <tr data-id="${r.id}">
            <td><input type="checkbox" class="chk-reserva"></td>
            <td>${r.id}</td>
            <td>${r.service_id}</td>
            <td>${r.provider_id}</td>
            <td>${r.slots}</td>
            <td>${r.price_per_slot}€</td>
            <td>${r.total_amount}€ ${tieneHitos ? '📅' : ''}</td>
            <td class="${r.status === 'Confirmada' ? 'ok' : r.status === 'Cancelada' ? 'error' : 'warn'}">${r.status}</td>
            <td class="td-cobrado">${cobrado.toLocaleString('es-ES', { style:'currency', currency:'EUR' })}</td>
            <td class="td-pendiente ${clasePendiente}">${pendiente.toLocaleString('es-ES', { style:'currency', currency:'EUR' })}</td>
        </tr>`
    }).join('')
}

// Cambia el estado de las reservas seleccionadas y refresca tabla y proveedores
async function cambiarEstadoSeleccionadas(nuevoEstado) {
    const ids = [...document.querySelectorAll('.chk-reserva:checked')]
        .map(chk => chk.closest('tr').dataset.id)
    if (ids.length === 0) return

    const afectadas = todasReservas.filter(r => ids.includes(r.id))
        .map(r => ({ proveedorId: r.provider_id, servicioId: r.service_id }))

    const { error } = await supabase
        .from('reservations').update({ status: nuevoEstado }).in('id', ids)
    if (!error && clienteActual) {
        todasReservas = todasReservas.map(r =>
            ids.includes(r.id) ? { ...r, status: nuevoEstado } : r
        )
        // Checkear consumption para cada reserva afectada
        for (const { proveedorId, servicioId } of afectadas) {
            await checkearConsumption(proveedorId, servicioId)
        }
        cargarReservasCliente(clienteActual.id)
        actualizarProveedores()
    }
}

// Elimina reservas seleccionadas borrando primero sus charges (FK constraint)
async function eliminarSeleccionadas() {
    const ids = [...document.querySelectorAll('.chk-reserva:checked')]
        .map(chk => chk.closest('tr').dataset.id)
    if (ids.length === 0) return
    if (!confirm(`¿Eliminar ${ids.length} reserva(s) definitivamente?`)) return

    // Guardar proveedor+servicio antes de borrar para el checkeo
    const afectadas = todasReservas.filter(r => ids.includes(r.id))
        .map(r => ({ proveedorId: r.provider_id, servicioId: r.service_id }))

    const { error: errCharges } = await supabase
        .from('charges').delete().in('reservation_id', ids)
    if (errCharges) { alert('Error al borrar cobros: ' + errCharges.message); return }

    const { error: errReservas } = await supabase
        .from('reservations').delete().in('id', ids)
    if (errReservas) { alert('Error al borrar reservas: ' + errReservas.message); return }

    todasReservas = todasReservas.filter(r => !ids.includes(r.id))

    // Si no quedan reservas del cliente, ofrecer eliminar el cliente
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
    }

    // Checkear consumption para cada proveedor+servicio afectado
    for (const { proveedorId, servicioId } of afectadas) {
        await checkearConsumption(proveedorId, servicioId)
    }

    await cargarReservasCliente(clienteActual.id)
    actualizarProveedores()
}

document.getElementById('btnConfirmar').addEventListener('click', () => cambiarEstadoSeleccionadas('Confirmada'))
document.getElementById('btnPendiente').addEventListener('click', () => cambiarEstadoSeleccionadas('Pendiente'))
document.getElementById('btnCancelar').addEventListener('click',  () => cambiarEstadoSeleccionadas('Cancelada'))
document.getElementById('btnEliminar').addEventListener('click',  eliminarSeleccionadas)

// ===== EDITAR RESERVA =====

// Carga los datos de la reserva seleccionada en el formulario para editarla
document.getElementById('btnEditar').addEventListener('click', () => {
    const checked = [...document.querySelectorAll('.chk-reserva:checked')]
    if (checked.length !== 1) {
        alert('Selecciona exactamente una reserva para editar')
        return
    }

    const tr      = checked[0].closest('tr')
    const id      = tr.dataset.id
    const reserva = todasReservas.find(r => r.id === id)
    if (!reserva) return

    reservaEditandoId       = id
    selectServicio.value    = reserva.service_id
    selectServicio.disabled = true // el servicio no se puede cambiar en edición
    actualizarProveedores()

    // Seleccionar proveedor tras renderizar el desplegable
    setTimeout(() => {
        selectProveedor.value = reserva.provider_id
        validarPrecio()
    }, 50)

    inputPlazas.value  = reserva.slots
    inputPrecio.value  = reserva.price_per_slot
    selectEstado.value = reserva.status
    document.getElementById('inputReservaComments').value = reserva.comments ?? ''
    actualizarTotal()
    actualizarBtnAnadir()

    btnAnadir.textContent = '💾 Guardar cambios'
    document.getElementById('btnCancelarEdicion').style.display = 'inline-block'

    document.getElementById('bloque-reserva').scrollIntoView({ behavior: 'smooth' })
    cargarHitosEdicion(id)
})

// Cancela la edición sin guardar cambios
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

    if (reservaEditandoId) {
        // ===== MODO EDITAR: actualizar reserva existente =====
        const { error } = await supabase.from('reservations').update({
            provider_id:    proveedorId,
            slots:          plazas,
            price_per_slot: precio,
            status:         estado,
            comments:       comments
        }).eq('id', reservaEditandoId)

        if (error) { alert('Error al guardar: ' + error.message); return }

        // Persistir hitos temporales (borra los anteriores e inserta los actuales)
        await persistirHitos(reservaEditandoId)

        // Refrescar cache de reservas
        const { data: reservasActualizadas } = await supabase.from('reservations').select('*')
        todasReservas = reservasActualizadas

        alert(`✅ Reserva ${reservaEditandoId} actualizada`)
        await cargarReservasCliente(clienteActual.id)
        actualizarProveedores()
        await checkearConsumption(proveedorId, servicioId)
        limpiarFormularioReserva()

    } else {
        // ===== MODO CREAR: nueva reserva =====

        // Verificar plazas libres reales antes de crear
        const { libres } = getPlazasInfo(proveedorId, servicioId)
        if (libres < plazas) {
            alert(`No hay suficientes plazas libres. Disponibles: ${libres}, necesitas: ${plazas}`)
            return
        }

        // Si el cliente no existe, pedimos confirmación y lo creamos
        if (!clienteActual) {
            const nombre = inputName.value.trim()
            if (!confirm(`¿Crear cliente nuevo "${clienteId}"${nombre ? ' (' + nombre + ')' : ''}?`)) return
            const { error: errCliente } = await supabase.from('clients').insert({
                id:       clienteId,
                name:     nombre || null,
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

        // Generar ID correlativo (R0001, R0002...)
        const { data: ultima } = await supabase
            .from('reservations').select('id').order('id', { ascending: false }).limit(1)
        const ultimoNum = ultima?.length > 0 ? parseInt(ultima[0].id.slice(1)) + 1 : 1
        const nuevaId   = 'R' + String(ultimoNum).padStart(4, '0')

        const { error: errReserva } = await supabase.from('reservations').insert({
            id:             nuevaId,
            client_id:      clienteActual.id,
            provider_id:    proveedorId,
            service_id:     servicioId,
            slots:          plazas,
            price_per_slot: precio,
            status:         estado,
            comments:       comments
        })
        if (errReserva) { alert('Error al crear reserva: ' + errReserva.message); return }

        // Persistir los hitos definidos en el panel (incluye el pago final calculado)
        await persistirHitos(nuevaId)

        // Refrescar cache de reservas
        const { data: reservasActualizadas } = await supabase.from('reservations').select('*')
        todasReservas = reservasActualizadas

        alert(`✅ Reserva ${nuevaId} creada`)
        await cargarReservasCliente(clienteActual.id)
        actualizarProveedores()
        await checkearConsumption(proveedorId, servicioId)
        limpiarFormularioReserva()
    }
})

// ===== HITOS DE COBRO (array temporal) =====

// Calcula o recalcula el hito de pago final como: total - suma de prepagos
// Si ya existe en hitosTemp lo actualiza, si no lo crea
function inicializarHitoFinal() {
    const plazas       = parseInt(inputPlazas.value) || 0
    const precio       = parseFloat(inputPrecio.value) || 0
    const total        = plazas * precio
    const sumaPrepagos = hitosTemp
        .filter(h => !h.esFinal)
        .reduce((s, h) => s + parseFloat(h.amount), 0)
    const pagoFinal    = total - sumaPrepagos

    const idx = hitosTemp.findIndex(h => h.esFinal)
    if (idx >= 0) {
        hitosTemp[idx].amount = pagoFinal
    } else {
        hitosTemp.push({
            esFinal:   true,
            comments:  'Pago final',
            amount:    pagoFinal,
            due_date:  '2026-07-05',
            collected: false
        })
    }
    renderHitos()
    validarHitos()
}

// Renderiza la tabla de hitos desde hitosTemp
function renderHitos() {
    const tbody = document.getElementById('tbody-pagos-reserva')
    if (hitosTemp.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="color:var(--subtle)">Sin hitos</td></tr>'
        return
    }
    tbody.innerHTML = hitosTemp.map((h, i) => `
        <tr>
            <td>${h.comments}</td>
            <td>${parseFloat(h.amount).toLocaleString('es-ES', { style:'currency', currency:'EUR' })}
                ${h.esFinal ? '<span style="font-size:11px;color:var(--subtle)"> (calculado)</span>' : ''}
            </td>
            <td>
                ${h.esFinal 
                    ? `<input type="date" value="${h.due_date ?? ''}" 
                        style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:4px"
                        onchange="cambiarFechaFinal('${i}', this.value)">`
                    : (h.due_date ?? '—')
                }
            </td>
            <td>${h.collected ? `✅ ${h.collected_date ?? ''}` : '⏳ No'}</td>
            <td style="white-space:nowrap">
                <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;margin-right:4px"
                    onclick="toggleHitoCobrado(${i})">${h.collected ? 'Marcar pendiente' : 'Marcar cobrado'}</button>
                ${!h.esFinal ? `
                    <button class="btn btn-danger" style="padding:4px 8px;font-size:11px"
                        onclick="eliminarHito(${i})">🗑</button>
                ` : ''}
            </td>
        </tr>
    `).join('')
}

window.cambiarFechaFinal = function(idx, valor) {
    hitosTemp[idx].due_date = valor || null
}

// Alterna el estado cobrado/pendiente de un hito en el array temporal
window.toggleHitoCobrado = function(idx) {
    const hito = hitosTemp[idx]
    if (!hito.collected) {
        // Marcar como cobrado — pedir fecha
        const fechaInput = prompt(
            'Fecha de cobro (dejar vacío para hoy):',
            hoy
        )
        if (fechaInput === null) return // canceló el prompt
        hito.collected    = true
        hito.collected_date = fechaInput.trim() || hoy
    } else {
        // Desmarcar cobrado
        hito.collected      = false
        hito.collected_date = null
    }
    renderHitos()
    actualizarBtnAnadir()
}

// Elimina un prepago del array temporal y recalcula el pago final
window.eliminarHito = function(idx) {
    hitosTemp.splice(idx, 1)
    inicializarHitoFinal()
}

// Valida que el pago final no sea negativo y actualiza el botón de añadir
function validarHitos() {
    const plazas = parseInt(inputPlazas.value) || 0
    const precio = parseFloat(inputPrecio.value) || 0
    if (!plazas || !precio) { btnAnadir.disabled = true; return }

    const pagoFinal = hitosTemp.find(h => h.esFinal)
    if (!pagoFinal || parseFloat(pagoFinal.amount) < 0) {
        btnAnadir.disabled       = true
        precioStatus.textContent = '❌ Los prepagos superan el total de la reserva'
        precioStatus.style.color = 'var(--accent)'
        return
    }
    actualizarBtnAnadir()
}

// Carga los hitos existentes de una reserva en edición en el array temporal
async function cargarHitosEdicion(reservaId) {
    const { data } = await supabase
        .from('charges')
        .select('*')
        .eq('reservation_id', reservaId)
        .order('due_date')

    hitosTemp = (data ?? []).map(h => ({
        ...h,
        esFinal: h.comments === 'Pago final'
    }))

    // Si no hay hito final definido, crearlo calculado
    if (!hitosTemp.find(h => h.esFinal)) inicializarHitoFinal()
    else renderHitos()

    document.getElementById('panel-pagos').style.display = 'block'
}

// Muestra el panel de hitos sin cambiar su estado abierto/cerrado
function mostrarPanelPagos() {
    document.getElementById('panel-pagos').style.display = 'block'
}

// Toggle del acordeón del panel de hitos
document.getElementById('togglePagos').addEventListener('click', () => {
    const contenido = document.getElementById('contenido-pagos')
    const icon      = document.getElementById('togglePagosIcon')
    const abierto   = contenido.style.display !== 'none'
    contenido.style.display = abierto ? 'none' : 'block'
    icon.textContent        = abierto ? '▶' : '▼'
})

// Muestra el formulario para añadir un nuevo hito
document.getElementById('btnNuevoPago').addEventListener('click', () => {
    document.getElementById('form-nuevo-pago').style.display = 'block'
    document.getElementById('btnNuevoPago').style.display    = 'none'
})

// Oculta el formulario de nuevo hito sin guardar
document.getElementById('btnCancelarPago').addEventListener('click', () => {
    document.getElementById('form-nuevo-pago').style.display = 'none'
    document.getElementById('btnNuevoPago').style.display    = 'inline-block'
})

// Añade un nuevo prepago al array temporal y recalcula el pago final
document.getElementById('btnGuardarPago').addEventListener('click', () => {
    const concepto = document.getElementById('pagoConcepto').value.trim() || 'Prepago'
    const importe  = parseFloat(document.getElementById('pagoImporte').value)
    const fecha    = document.getElementById('pagoFecha').value || null
    const cobrado  = document.getElementById('pagoCobrado').value === 'true'

    if (!importe || importe <= 0) { alert('Introduce un importe válido'); return }

    // Insertar antes del pago final para mantener el orden
    const idxFinal = hitosTemp.findIndex(h => h.esFinal)
    hitosTemp.splice(idxFinal >= 0 ? idxFinal : hitosTemp.length, 0, {
        esFinal:   false,
        comments:  concepto,
        amount:    importe,
        due_date:  fecha,
        collected: cobrado
    })

    inicializarHitoFinal()

    // Limpiar form sin colapsar el panel
    document.getElementById('pagoConcepto').value        = ''
    document.getElementById('pagoImporte').value         = ''
    document.getElementById('pagoFecha').value           = ''
    document.getElementById('pagoCobrado').value         = 'false'
    document.getElementById('form-nuevo-pago').style.display  = 'none'
    document.getElementById('btnNuevoPago').style.display     = 'inline-block'
})

// Borra los hitos existentes en Supabase e inserta los del array temporal
async function persistirHitos(reservaId) {
    await supabase.from('charges').delete().eq('reservation_id', reservaId)
    for (const h of hitosTemp) {
        await supabase.from('charges').insert({
            reservation_id: reservaId,
            amount:         parseFloat(h.amount),
            due_date:       h.due_date,
            collected:      h.collected,
            collected_date: h.collected_date ?? null,
            comments:       h.comments
        })
    }
}

// Refresca las celdas de cobrado/pendiente de una fila de la tabla sin recargar todo
async function refreshFilaReserva(reservaId) {
    const { data: charges } = await supabase
        .from('charges').select('*').eq('reservation_id', reservaId)
    const cobrado   = (charges ?? []).filter(c =>  c.collected).reduce((s, c) => s + parseFloat(c.amount), 0)
    const pendiente = (charges ?? []).filter(c => !c.collected).reduce((s, c) => s + parseFloat(c.amount), 0)
    const vencido   = (charges ?? []).some(c => !c.collected && c.due_date && c.due_date < hoy)
    const fila      = document.querySelector(`tr[data-id="${reservaId}"]`)
    if (!fila) return
    const tdC = fila.querySelector('.td-cobrado')
    const tdP = fila.querySelector('.td-pendiente')
    if (tdC) tdC.textContent = cobrado.toLocaleString('es-ES', { style:'currency', currency:'EUR' })
    if (tdP) {
        tdP.textContent = pendiente.toLocaleString('es-ES', { style:'currency', currency:'EUR' })
        tdP.className   = 'td-pendiente ' + (pendiente === 0 ? 'ok' : vencido ? 'error' : 'warn')
    }
}

// ===== BLOQUE 3: DISPONIBILIDAD =====

// Actualiza todo el bloque 3 cuando cambia servicio, plazas o proveedor
function actualizarBloque3() {
    const servicioId  = selectServicio.value
    const plazas      = parseInt(inputPlazas.value) || 0
    const proveedorId = selectProveedor.value
    const bloque      = document.getElementById('bloque-disponibilidad')

    if (!servicioId) {
        bloque.style.display = 'none'
        return
    }

    bloque.style.display = 'block'
    actualizarResumen(servicioId, plazas)
    actualizarMapaProveedores(servicioId, plazas, proveedorId)
}

// 3.1 — Resumen de plazas para el servicio seleccionado
function actualizarResumen(servicioId, plazas) {
    const dispServicio     = disponibilidad.filter(d => d.service_id === servicioId)
    const reservasServicio = todasReservas.filter(r =>
        r.service_id === servicioId && r.status !== 'Cancelada'
    )

    const totalPlazas  = dispServicio.reduce((s, d) => s + (d.total_slots ?? 0), 0)
    const confirmadas  = reservasServicio.filter(r => r.status === 'Confirmada').reduce((s, r) => s + r.slots, 0)
    const pendientes   = reservasServicio.filter(r => r.status === 'Pendiente').reduce((s, r) => s + r.slots, 0)
    const libresReales = totalPlazas - confirmadas - pendientes

    let aviso = '', claseAviso = ''
    if (plazas > 0) {
        if (libresReales >= plazas) {
            aviso = '✅ Disponible';                  claseAviso = 'disponibilidad-ok'
        } else if (libresReales + pendientes >= plazas) {
            aviso = '⚠️ Disponible con pendientes';  claseAviso = 'disponibilidad-warn'
        } else {
            aviso = '❌ No disponible';               claseAviso = 'disponibilidad-error'
        }
    }

    const tbody = document.getElementById('tbody-resumen')
    tbody.innerHTML = `
        <tr><td class="resumen-label">Plazas totales</td>
            <td class="resumen-valor">${totalPlazas}</td></tr>
        <tr><td class="resumen-label">Confirmadas</td>
            <td class="resumen-valor" style="color:var(--accent)">${confirmadas}</td></tr>
        <tr><td class="resumen-label">Pendientes</td>
            <td class="resumen-valor" style="color:var(--accent-warn)">${pendientes}</td></tr>
        <tr><td class="resumen-label">Libres reales</td>
            <td class="resumen-valor" style="color:var(--accent-ok)">${libresReales}</td></tr>
        ${aviso ? `<tr><td colspan="2" class="resumen-aviso ${claseAviso}">${aviso}</td></tr>` : ''}
    `
    document.getElementById('resumen-servicio').style.display = 'block'
}

// 3.2 — Mapa de proveedores: una columna por proveedor
function actualizarMapaProveedores(servicioId, plazas, proveedorSeleccionado) {
    const dispServicio = disponibilidad.filter(d => d.service_id === servicioId)
    const contenedor   = document.getElementById('columnas-proveedores')

    if (dispServicio.length === 0) {
        contenedor.innerHTML = '<p style="color:var(--subtle);font-size:13px">Sin proveedores para este servicio</p>'
        return
    }

    contenedor.innerHTML = dispServicio.map(d => {
        const { total, pendientes, libres } = getPlazasInfo(d.provider_id, servicioId)
        if (plazas > 0 && total < plazas) return ''

        // Clase de disponibilidad
        let claseDisp = '', simbolo = ''
        if (plazas > 0) {
            if (libres >= plazas) {
                claseDisp = 'disp-ok';   simbolo = '✅'
            } else if (libres > 0 && libres + pendientes >= plazas) {
                claseDisp = 'disp-warn'; simbolo = '⚠️'
            } else if (libres === 0 && pendientes >= plazas) {
                claseDisp = 'disp-warn'; simbolo = '⚠️⚠️'
            } else if (libres > 0) {
                claseDisp = 'disp-error'; simbolo = '❌'
            } else {
                claseDisp = 'disp-error'; simbolo = '❌❌'
            }
        }

        const esSeleccionado = proveedorSeleccionado && d.provider_id === proveedorSeleccionado
        const esAtenuado     = proveedorSeleccionado && !esSeleccionado
        const claseSize      = esSeleccionado ? 'destacado' : 'normal'
        const claseAtenuado  = esAtenuado ? 'atenuado' : ''

        const reservasCol = todasReservas.filter(r =>
            r.provider_id === d.provider_id &&
            r.service_id  === servicioId &&
            r.status      !== 'Cancelada'
        )

        const MAX_FILAS = 8
        let filasReservas = ''
        if (reservasCol.length === 0) {
            filasReservas = `<div class="proveedor-sin-reservas">Sin reservas</div>`
        } else {
            const visibles = reservasCol.slice(0, MAX_FILAS)
            const resto    = reservasCol.slice(MAX_FILAS)
            filasReservas  = visibles.map(r => `
                <div class="proveedor-fila-reserva">
                    <span class="cliente" style="color:${r.status === 'Confirmada' ? 'var(--accent-ok)' : 'var(--accent-warn)'}">${r.client_id}</span>
                    <span class="plazas">${r.slots} pzs</span>
                </div>
            `).join('')
            if (resto.length > 0) {
                const plazasResto = resto.reduce((s, r) => s + r.slots, 0)
                filasReservas += `<div class="proveedor-fila-mas">+${resto.length} más (${plazasResto} plazas)</div>`
            }
        }

        return `
        <div class="proveedor-col ${claseDisp} ${claseSize} ${claseAtenuado}" style="border:2px solid">
            <div class="proveedor-col-header">
                <div class="nombre">${simbolo} ${d.provider_id}</div>
                <div class="plazas">${libres}/${total} libres</div>
            </div>
            <div class="proveedor-col-body">${filasReservas}</div>
        </div>`
    }).join('')
}

// Recalcula y corrige en Supabase el pago final de proveedores consumption
// afectados por un cambio en una reserva
async function checkearConsumption(proveedorId, servicioId) {
    // Verificar si este proveedor+servicio es consumption
    const disp = disponibilidad.find(d =>
        d.provider_id === proveedorId &&
        d.service_id  === servicioId  &&
        d.billing_model === 'consumption'
    )
    if (!disp) return // no es consumption, nada que hacer

    // Calcular plazas totales reservadas (confirmadas + pendientes)
    const plazasReservadas = todasReservas
        .filter(r =>
            r.provider_id === proveedorId &&
            r.service_id  === servicioId  &&
            r.status      !== 'Cancelada'
        )
        .reduce((s, r) => s + r.slots, 0)

    const importeCorrecto = plazasReservadas * parseFloat(disp.price_per_slot)

    // Buscar el pago final de este proveedor en Supabase
    const { data: pagosProveedor } = await supabase
        .from('payments')
        .select('*')
        .eq('provider_id', proveedorId)
        .eq('comments', 'Pago final')

    if (!pagosProveedor || pagosProveedor.length === 0) {
        // No existe pago final — crearlo
        await supabase.from('payments').insert({
            provider_id: proveedorId,
            amount:      importeCorrecto,
            due_date:    '2026-07-15',
            paid:        false,
            comments:    'Pago final'
        })
        console.warn(`⚠️ Consumption: creado pago final para ${proveedorId}/${servicioId} — ${importeCorrecto}€`)
        return
    }

    // Sumar todos los pagos finales (puede haber más de uno por servicio)
    const importeActual = pagosProveedor.reduce((s, p) => s + parseFloat(p.amount), 0)

    if (Math.abs(importeActual - importeCorrecto) < 0.01) return // ya está correcto

    // Actualizar el primero y borrar duplicados si los hubiera
    const [primero, ...resto] = pagosProveedor
    await supabase.from('payments')
        .update({ amount: importeCorrecto })
        .eq('id', primero.id)

    if (resto.length > 0) {
        await supabase.from('payments').delete().in('id', resto.map(p => p.id))
    }

    console.warn(`⚠️ Consumption corregido: ${proveedorId}/${servicioId} — ${importeActual}€ → ${importeCorrecto}€`)
}