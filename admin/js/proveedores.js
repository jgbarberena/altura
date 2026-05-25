import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { fmt, initSidebar, normalizarId, buscarConPrioridad, persistirPagosProveedor } from './utils.js'
import { syncStockToSfcom, computeExpectedStock, mostrarModalConfirmacionSfcom, verificarConfirmarSfcom, editarNombreSfcom, mostrarModalCorreoHilario, mostrarModalCorreoCancelacionSfcom, mostrarModalCorreoBajaSfcom, verificarBajaSfcom } from './sfcom.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

// ===== DATOS GLOBALES =====
let todosProveedores   = (await supabase.from('providers').select('*').order('id')).data
let todosServicios     = (await supabase.from('services').select('*').order('id')).data
let todaDisponibilidad = (await supabase.from('availability_with_sfcom').select('*')).data
let todosPayments      = (await supabase.from('payments').select('*')).data
let todasReservas      = (await supabase.from('reservations').select('*')).data

let proveedorActual      = null
let servicioEditandoId   = null
let serviciosEditandoIds = []
let hitosProvTemp        = []
let ultimoCampoActivo    = 'precio'

const hoy = new Date().toISOString().split('T')[0]

// pares: [{providerId, serviceId}]
// Computa el stock esperado (sin deltas — solo muestra el estado actual post-guardado) y
// muestra el modal consultivo. Devuelve true si el admin confirma, false si cancela.
async function confirmarStockSfcom(pares) {
    const cambios = []
    for (const { providerId, serviceId } of pares) {
        const cambio = await computeExpectedStock(supabase, providerId, serviceId, { sfcomDelta: 0, allDelta: 0 })
        if (cambio) cambios.push(cambio)
    }
    if (cambios.length === 0) return true
    return mostrarModalConfirmacionSfcom(cambios)
}

// ===== REFERENCIAS DOM =====
const inputProveedorId       = document.getElementById('inputProveedorId')
const inputNombre            = document.getElementById('inputNombre')
const inputDireccion         = document.getElementById('inputDireccion')
const selectFormaPago        = document.getElementById('selectFormaPago')
const checkFactura           = document.getElementById('checkFactura')
const inputProveedorComments = document.getElementById('inputProveedorComments')
const autoProvList           = document.getElementById('autocompleteProveedorList')
const proveedorStatus        = document.getElementById('proveedor-status')
const servicioDescStatus     = document.getElementById('servicio-desc-status')
const inputServicioId          = document.getElementById('inputServicioId')
const inputPlazas              = document.getElementById('inputPlazas')
const inputPrecio              = document.getElementById('inputPrecio')
const inputServicioDescription = document.getElementById('inputServicioDescription')
const inputServicioComments    = document.getElementById('inputServicioComments')

inputServicioDescription.addEventListener('change', guardarDescripcionServicio)
inputServicioComments.addEventListener('change',    guardarDescripcionServicio)

// ===== REFERENCIAS SFCOM =====
let sfcomEstadoLocal = null

const sfcomSection         = document.getElementById('sfcom-section')
const sfcomDetalles        = document.getElementById('sfcomDetalles')
const sfcomSummaryLabel    = document.getElementById('sfcomSummaryLabel')
const sfcomBadge           = document.getElementById('sfcomBadge')
const sfcomNombreProducto  = document.getElementById('sfcomNombreProducto')
const sfcomNombreAutoList  = document.getElementById('sfcomNombreAutoList')
const sfcomNombreVariacion = document.getElementById('sfcomNombreVariacion')
const sfcomSlotsListed     = document.getElementById('sfcomSlotsListed')
const sfcomPrecioPublico   = document.getElementById('sfcomPrecioPublico')
const sfcomEstadoLabel     = document.getElementById('sfcomEstadoLabel')
const sfcomProductId       = document.getElementById('sfcomProductId')
const sfcomVariationId     = document.getElementById('sfcomVariationId')

document.getElementById('btnSolicitarSfcom').addEventListener('click', async e => {
    e.stopPropagation()
    sfcomDetalles.open = true
    await solicitarAltaSfcom()
})

document.getElementById('btnConfirmarSfcom').addEventListener('click', async () => {
    const nombre = sfcomNombreProducto.value.trim()
    if (!nombre) { alert('Introduce el nombre del producto en sfcom antes de confirmar.'); return }
    if (!servicioEditandoId) { alert('Guarda el servicio primero para poder confirmar.'); return }
    const serviceId    = inputServicioId.value.trim().toUpperCase()
    const excludeNames = todaDisponibilidad
        .filter(d => d.provider_id === proveedorActual?.id &&
                     d.id !== servicioEditandoId &&
                     d.sfcom_status === 'confirmed' && d.sfcom_service_name)
        .map(d => d.sfcom_service_name)
    const result = await verificarConfirmarSfcom(supabase, servicioEditandoId, nombre, serviceId, excludeNames)
    const disp   = todaDisponibilidad.find(d => d.id === servicioEditandoId)
    if (result?.ok) {
        if (disp) {
            disp.sfcom_product_id   = result.product_id
            disp.sfcom_variation_id = result.variation_id
            disp.sfcom_status       = 'confirmed'
            disp.sfcom_service_name = result.name
        }
        sfcomEstadoLocal = 'confirmed'
        actualizarSeccionSfcom(todaDisponibilidad.find(d => d.id === servicioEditandoId))
        // Sincronización inicial: stock puede estar en estado desconocido en sfcom.
        const sfcomOk = await confirmarStockSfcom([{ providerId: proveedorActual.id, serviceId }])
        if (sfcomOk) await syncStockToSfcom(supabase, proveedorActual.id, serviceId)
    } else if (result?.notInList && result?.name) {
        sfcomNombreProducto.value    = result.name
        if (disp) disp.sfcom_service_name = result.name
        sfcomBadge.style.display     = 'inline-flex'
        sfcomBadge.textContent       = '⏳ Alta solicitada — nombre no encontrado en sfcom'
    }
})

document.getElementById('btnCancelarSolicitud').addEventListener('click', async e => {
    e.stopPropagation()
    if (!confirm('¿Cancelar la solicitud de alta en sfcom para este servicio? Se borrarán los datos sfcom.')) return
    const nombreProducto = sfcomNombreProducto.value.trim() || '—'
    if (servicioEditandoId) {
        await supabase.from('sfcom_listings').delete().eq('availability_id', servicioEditandoId)
        const disp = todaDisponibilidad.find(d => d.id === servicioEditandoId)
        if (disp) {
            disp.sfcom_status       = null
            disp.sfcom_service_name = null
            disp.sfcom_slots_listed = null
            disp.sfcom_product_id   = null
            disp.sfcom_variation_id = null
        }
    }
    mostrarModalCorreoCancelacionSfcom(nombreProducto, proveedorActual)
    sfcomEstadoLocal          = null
    sfcomNombreProducto.value = ''
    sfcomNombreVariacion.value = ''
    sfcomSlotsListed.value    = ''
    sfcomProductId.value      = ''
    sfcomVariationId.value    = ''
    sfcomDetalles.open        = false
    _actualizarEstadoSfcomUI()
})

document.getElementById('btnEditarNombreSfcom').addEventListener('click', async () => {
    if (!servicioEditandoId) return
    const disp = todaDisponibilidad.find(d => d.id === servicioEditandoId)
    if (!disp) return
    const excludeNames = todaDisponibilidad
        .filter(d => d.provider_id === proveedorActual?.id &&
                     d.id !== servicioEditandoId &&
                     d.sfcom_status === 'confirmed' && d.sfcom_service_name)
        .map(d => d.sfcom_service_name)
    const serviceId = inputServicioId.value.trim().toUpperCase()
    const nuevoNombre = await editarNombreSfcom(disp.sfcom_service_name, serviceId, excludeNames)
    if (!nuevoNombre?.name) return
    const nombre = nuevoNombre.name
    const { error } = await supabase.from('sfcom_listings')
        .update({ sfcom_service_name: nombre })
        .eq('availability_id', servicioEditandoId)
    if (error) { alert('Error al actualizar nombre: ' + error.message); return }
    disp.sfcom_service_name = nombre
    sfcomNombreProducto.value = nombre
})

document.getElementById('btnDarDeBajaSfcom').addEventListener('click', async () => {
    if (!servicioEditandoId || !proveedorActual) return
    const disp = todaDisponibilidad.find(d => d.id === servicioEditandoId)
    if (!disp || disp.sfcom_status !== 'confirmed') return

    const resultado = await mostrarModalCorreoBajaSfcom(disp.sfcom_service_name, proveedorActual)
    if (resultado !== 'ok') return

    await supabase.from('sfcom_listings').update({ sfcom_status: 'deactivation_pending' }).eq('availability_id', servicioEditandoId)
    disp.sfcom_status = 'deactivation_pending'
    sfcomEstadoLocal  = 'deactivation_pending'
    _actualizarEstadoSfcomUI()
})

document.getElementById('btnConfirmarBajaSfcom').addEventListener('click', async () => {
    if (!servicioEditandoId || !proveedorActual) return
    const disp = todaDisponibilidad.find(d => d.id === servicioEditandoId)
    if (!disp || disp.sfcom_status !== 'deactivation_pending') return
    if (!disp.sfcom_product_id) {
        alert('No hay product_id registrado. Limpia los datos sfcom manualmente si el producto ya no existe en sfcom.')
        return
    }

    const check = await verificarBajaSfcom(disp.sfcom_product_id, disp.sfcom_variation_id)
    if (!check.ok) {
        alert(`No se pudo verificar el estado del producto en sfcom: ${check.error}`)
        return
    }
    if (!check.gone) {
        alert(`El producto sigue disponible en sfcom con stock = ${check.stock}. Espera a que Hilario lo retire antes de confirmar la baja.`)
        return
    }

    const { error } = await supabase.from('sfcom_listings').delete().eq('availability_id', servicioEditandoId)
    if (error) { alert('Error al limpiar datos sfcom: ' + error.message); return }

    disp.sfcom_status       = null
    disp.sfcom_service_name = null
    disp.sfcom_slots_listed = null
    disp.sfcom_product_id   = null
    disp.sfcom_variation_id = null
    sfcomEstadoLocal        = null
    actualizarSeccionSfcom(disp)
})

function _variacionAuto(serviceId) {
    const partes = (serviceId || '').split('_')
    if (partes[0] !== 'ENCIERRO') return ''
    const dia = parseInt(partes[1])
    if (!dia || dia < 7 || dia > 14) return ''
    const year  = new Date().getFullYear()
    const fecha = new Date(year, 6, dia)
    const sem   = fecha.toLocaleDateString('es-ES', { weekday: 'long' })
    return sem.charAt(0).toUpperCase() + sem.slice(1) + ` ${dia} de Julio ${year}`
}

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
        `<div data-id="${p.id}">${p.id}</div>`
    ).join('')
    autoProvList.style.display = coincidencias.length > 0 ? 'block' : 'none'

    const exacto = todosProveedores.find(p => p.id === val)
    if (exacto) {
        cargarProveedor(exacto)
    } else if (val) {
        if (proveedorActual) limpiarCamposProveedor()
        proveedorActual = null
        proveedorStatus.innerHTML = '✨ Proveedor nuevo &nbsp;—&nbsp; '
            + '<a href="#" style="font-size:inherit;color:inherit;text-decoration:underline;cursor:pointer"'
            + ' onclick="guardarProveedorNuevo(event)">Guardar proveedor</a>'
            + ' o se guardará al añadir un servicio'
        proveedorStatus.style.color = 'var(--accent-warn)'
        document.getElementById('bloque-servicio').style.display            = 'block'
        document.getElementById('bloque-servicios-proveedor').style.display = 'none'
        document.getElementById('bloque-pagos-proveedor').style.display     = 'none'
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
        sfcomNombreAutoList.style.display = 'none'
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
    document.getElementById('btnAbrirMultiple').style.display = 'inline-block'
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

// Guarda un proveedor nuevo sin necesidad de anadir un servicio
window.guardarProveedorNuevo = async function(e) {
    e.preventDefault()
    const proveedorId = normalizarId(inputProveedorId.value)
    if (!proveedorId) return
    const { error } = await supabase.from('providers').insert({
        id:       proveedorId,
        name:     document.getElementById('inputNombre').value.trim()    || null,
        address:  document.getElementById('inputDireccion').value.trim() || null,
        comments: document.getElementById('inputProveedorComments').value.trim() || null
    })
    if (error) { alert('Error al guardar el proveedor: ' + error.message); return }
    const nuevo = { id: proveedorId, name: document.getElementById('inputNombre').value.trim() || null }
    todosProveedores.push(nuevo)
    cargarProveedor(nuevo)
}

// Guarda un servicio nuevo en la BBDD sin necesidad de anadirlo a un proveedor
window.guardarServicioNuevo = async function(e) {
    e.preventDefault()
    const servicioId = inputServicioId.value.trim().toUpperCase()
    if (!servicioId) return
    const desc = inputServicioDescription.value.trim() || null
    const comm = inputServicioComments.value.trim()    || null
    const { error } = await supabase.from('services')
        .insert({ id: servicioId, description: desc, comments: comm })
    if (error) { alert('Error al guardar el servicio: ' + error.message); return }
    todosServicios.push({ id: servicioId, description: desc, comments: comm })
    servicioDescStatus.innerHTML   = '✅ Servicio existente — los cambios en descripción y comentarios se guardan automáticamente'
    servicioDescStatus.style.color = 'var(--accent-ok)'
}

// Guardado automatico de description y comments al cambiar los campos
async function guardarDescripcionServicio() {
    const servicioId = inputServicioId.value.trim().toUpperCase()
    if (!servicioId) return
    const svc = todosServicios.find(s => s.id.toUpperCase() === servicioId)
    if (!svc) return
    const desc = inputServicioDescription.value.trim() || null
    const comm = inputServicioComments.value.trim()    || null
    const { error } = await supabase.from('services')
        .update({ description: desc, comments: comm })
        .eq('id', svc.id)
    if (error) { console.error('Error al guardar descripcion:', error.message); return }
    svc.description = desc
    svc.comments    = comm
    todosServicios  = todosServicios.map(s => s.id === svc.id ? svc : s)
}

// ===== BLOQUE 2: SERVICIO =====

inputServicioId.addEventListener('keydown', e => {
    if (e.key === ' ') {
        e.preventDefault()
        const pos = inputServicioId.selectionStart
        const val = inputServicioId.value
        inputServicioId.value = val.slice(0, pos) + '_' + val.slice(pos)
        inputServicioId.setSelectionRange(pos + 1, pos + 1)
        inputServicioId.dispatchEvent(new Event('input'))
    }
})

inputServicioId.addEventListener('input', () => {
    const normalized = normalizarId(inputServicioId.value)
    if (inputServicioId.value !== normalized) inputServicioId.value = normalized
    const val      = inputServicioId.value.trim().toUpperCase()
    const autoList = document.getElementById('autocompleteServicioList')
    if (!val) { autoList.style.display = 'none'; servicioDescStatus.textContent = ''; return }
    const coincidencias = todosServicios.filter(s => s.id.toUpperCase().startsWith(val))
    autoList.innerHTML  = coincidencias.map(s => `<div data-id="${s.id}">${s.id}</div>`).join('')
    autoList.style.display = coincidencias.length > 0 ? 'block' : 'none'
    // Limpiar siempre los campos de availability (son del par proveedor-servicio)
    inputPlazas.value     = ''
    inputPrecio.value     = ''
    inputCosteTotal.value = ''
    selectModelo.value    = 'capacity'
    document.getElementById('inputCosteServicio').value = '—'
    // Si el valor coincide exactamente con un servicio existente, cargar description y comments
    const exacto = todosServicios.find(s => s.id.toUpperCase() === val)
    if (exacto) {
        inputServicioDescription.value = exacto.description ?? ''
        inputServicioComments.value    = exacto.comments    ?? ''
        servicioDescStatus.innerHTML   = '✅ Servicio existente — los cambios en descripción y comentarios se guardan automáticamente'
        servicioDescStatus.style.color = 'var(--accent-ok)'
    } else {
        inputServicioDescription.value = ''
        inputServicioComments.value    = ''
        servicioDescStatus.innerHTML   = '✨ Servicio nuevo — '
            + '<a href="#" style="font-size:inherit;color:inherit;text-decoration:underline;cursor:pointer"'
            + ' onclick="guardarServicioNuevo(event)">Guardar servicio</a>'
            + ' o se creará al añadir al proveedor'
        servicioDescStatus.style.color = 'var(--accent-warn)'
    }
    // Mostrar sección sfcom para nuevo servicio si no hay una fila de availability activa
    if (!servicioEditandoId && val) {
        actualizarSeccionSfcom(null, true)
    } else if (!servicioEditandoId && !val) {
        actualizarSeccionSfcom(null)
    }
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
    // Limpiar siempre los campos de availability (son del par proveedor-servicio)
    inputPlazas.value     = ''
    inputPrecio.value     = ''
    inputCosteTotal.value = ''
    selectModelo.value    = 'capacity'
    document.getElementById('inputCosteServicio').value = '—'
    // Cargar description y comments del servicio seleccionado
    const svcSel = todosServicios.find(s => s.id === div.dataset.id)
    if (svcSel) {
        inputServicioDescription.value = svcSel.description ?? ''
        inputServicioComments.value    = svcSel.comments    ?? ''
        servicioDescStatus.innerHTML   = '✅ Servicio existente — los cambios en descripción y comentarios se guardan automáticamente'
        servicioDescStatus.style.color = 'var(--accent-ok)'
    } else {
        inputServicioDescription.value = ''
        inputServicioComments.value    = ''
        servicioDescStatus.innerHTML   = '✨ Servicio nuevo — '
            + '<a href="#" style="font-size:inherit;color:inherit;text-decoration:underline;cursor:pointer"'
            + ' onclick="guardarServicioNuevo(event)">Guardar servicio</a>'
            + ' o se creará al añadir al proveedor'
        servicioDescStatus.style.color = 'var(--accent-warn)'
    }
    actualizarBtnServicio()
    actualizarCosteServicio()
})

inputPrecio.addEventListener('input', () => {
    ultimoCampoActivo = 'precio'
    const plazas = parseInt(inputPlazas.value) || 0
    const precio  = parseFloat(inputPrecio.value) || 0
    if (plazas > 0 && precio >= 0) inputCosteTotal.value = (plazas * precio).toFixed(2)
    actualizarBtnServicio()
    actualizarCosteServicio()
})

inputCosteTotal.addEventListener('input', () => {
    ultimoCampoActivo = 'total'
    const plazas = parseInt(inputPlazas.value) || 0
    const total  = parseFloat(inputCosteTotal.value) || 0
    if (plazas > 0) inputPrecio.value = (total / plazas).toFixed(2)
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

function actualizarCosteServicio() {
    const plazas = parseInt(inputPlazas.value) || 0
    const precio = parseFloat(inputPrecio.value) || 0
    const modelo = selectModelo.value
    const servId = inputServicioId.value.trim().toUpperCase()
    let coste    = 0

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
    const tienePlazas    = serviciosEditandoIds.length > 1 || inputPlazas.value !== ''
    btnGuardarServicio.disabled = !(tieneProveedor && tieneServicio && tienePlazas)
}

function actualizarSeccionSfcom(disp, modoNuevo = false) {
    if (!disp && !modoNuevo) {
        sfcomSection.style.display = 'none'
        sfcomEstadoLocal           = null
        return
    }
    sfcomEstadoLocal = disp ? (disp.sfcom_status ?? null) : null
    sfcomSection.style.display = 'block'

    sfcomNombreProducto.value  = disp?.sfcom_service_name ?? ''
    sfcomNombreVariacion.value = _variacionAuto(disp?.service_id ?? inputServicioId.value.trim().toUpperCase())
    sfcomSlotsListed.value     = disp?.sfcom_slots_listed ?? ''
    sfcomPrecioPublico.value   = ''  // never stored in DB, always empty on load
    sfcomProductId.value       = disp?.sfcom_product_id   ?? ''
    sfcomVariationId.value     = disp?.sfcom_variation_id ?? ''

    _actualizarEstadoSfcomUI()
}

function _actualizarEstadoSfcomUI() {
    const btnSolicitar = document.getElementById('btnSolicitarSfcom')
    const btnCancelar  = document.getElementById('btnCancelarSolicitud')
    const btnConfirmar = document.getElementById('btnConfirmarSfcom')
    const btnEditar    = document.getElementById('btnEditarNombreSfcom')
    const btnDarBaja   = document.getElementById('btnDarDeBajaSfcom')
    const btnConfBaja  = document.getElementById('btnConfirmarBajaSfcom')

    if (sfcomEstadoLocal === null) {
        sfcomSummaryLabel.textContent = 'Alta en sfcom'
        sfcomSummaryLabel.style.color = 'var(--subtle)'
        sfcomBadge.style.display      = 'none'
        btnSolicitar.style.display    = 'inline-block'
        btnCancelar.style.display     = 'none'
        sfcomEstadoLabel.textContent  = '—'
        sfcomEstadoLabel.style.color  = 'var(--subtle)'
        btnConfirmar.style.display    = 'none'
        btnEditar.style.display       = 'none'
        if (btnDarBaja)  btnDarBaja.style.display  = 'none'
        if (btnConfBaja) btnConfBaja.style.display  = 'none'
        sfcomNombreProducto.disabled  = false
    } else if (sfcomEstadoLocal === 'pending') {
        sfcomSummaryLabel.textContent = 'Listado en sfcom'
        sfcomSummaryLabel.style.color = 'var(--accent-ok)'
        sfcomBadge.className          = 'sfcom-badge sfcom-badge--pending'
        sfcomBadge.textContent        = '⏳ Alta solicitada'
        sfcomBadge.style.display      = 'inline-flex'
        btnSolicitar.style.display    = 'none'
        btnCancelar.style.display     = 'inline-block'
        sfcomEstadoLabel.textContent  = 'Pendiente'
        sfcomEstadoLabel.style.color  = 'var(--accent-warn)'
        btnConfirmar.style.display    = 'inline-block'
        btnEditar.style.display       = 'none'
        if (btnDarBaja)  btnDarBaja.style.display  = 'none'
        if (btnConfBaja) btnConfBaja.style.display  = 'none'
        sfcomNombreProducto.disabled  = false
        sfcomDetalles.open            = true
    } else if (sfcomEstadoLocal === 'confirmed') {
        sfcomSummaryLabel.textContent = 'Listado en sfcom'
        sfcomSummaryLabel.style.color = 'var(--accent-ok)'
        sfcomBadge.className          = 'sfcom-badge sfcom-badge--confirmed'
        sfcomBadge.textContent        = '✅ Confirmado'
        sfcomBadge.style.display      = 'inline-flex'
        btnSolicitar.style.display    = 'none'
        btnCancelar.style.display     = 'none'
        sfcomEstadoLabel.textContent  = 'Confirmado'
        sfcomEstadoLabel.style.color  = 'var(--accent-ok)'
        btnConfirmar.style.display    = 'none'
        btnEditar.style.display       = 'inline-flex'
        if (btnDarBaja)  btnDarBaja.style.display  = 'inline-block'
        if (btnConfBaja) btnConfBaja.style.display  = 'none'
        sfcomNombreProducto.disabled  = true
    } else {  // deactivation_pending
        sfcomSummaryLabel.textContent = 'Listado en sfcom'
        sfcomSummaryLabel.style.color = 'var(--accent-ok)'
        sfcomBadge.className          = 'sfcom-badge sfcom-badge--deactivation'
        sfcomBadge.textContent        = '⏳ Baja solicitada'
        sfcomBadge.style.display      = 'inline-flex'
        btnSolicitar.style.display    = 'none'
        btnCancelar.style.display     = 'none'
        sfcomEstadoLabel.textContent  = 'Baja pendiente'
        sfcomEstadoLabel.style.color  = 'var(--accent-warn)'
        btnConfirmar.style.display    = 'none'
        btnEditar.style.display       = 'none'
        if (btnDarBaja)  btnDarBaja.style.display  = 'none'
        if (btnConfBaja) btnConfBaja.style.display  = 'inline-block'
        sfcomNombreProducto.disabled  = true
        sfcomDetalles.open            = true
    }
}

function mostrarSugerenciasNombreProducto(val) {
    if (!proveedorActual) { sfcomNombreAutoList.style.display = 'none'; return }
    const nombresExistentes = [...new Set(
        todaDisponibilidad
            .filter(d => d.provider_id === proveedorActual.id &&
                         d.id          !== servicioEditandoId &&
                         d.sfcom_service_name)
            .map(d => d.sfcom_service_name)
    )]
    if (nombresExistentes.length === 0) { sfcomNombreAutoList.style.display = 'none'; return }
    const filtrados = val
        ? nombresExistentes.filter(n => n.toLowerCase().includes(val.toLowerCase()))
        : nombresExistentes
    if (filtrados.length === 0) { sfcomNombreAutoList.style.display = 'none'; return }
    sfcomNombreAutoList.innerHTML = filtrados.map(n =>
        `<div data-nombre="${n}">${n}</div>`
    ).join('')
    sfcomNombreAutoList.style.display = 'block'
}

async function solicitarAltaSfcom() {
    const nombre = sfcomNombreProducto.value.trim()
    const plazas = parseInt(sfcomSlotsListed.value) || 0
    if (!nombre) {
        alert('Introduce el nombre del producto en sfcom antes de solicitar el alta.')
        sfcomDetalles.open = true
        sfcomNombreProducto.focus()
        return false
    }
    if (plazas <= 0) {
        alert('Introduce el número de plazas listadas en sfcom (mayor que 0) antes de solicitar.')
        sfcomDetalles.open = true
        sfcomSlotsListed.focus()
        return false
    }
    const serviceId = inputServicioId.value.trim().toUpperCase()
    const resultado = await mostrarModalCorreoHilario(
        nombre,
        [{ serviceId, nombreVariacion: _variacionAuto(serviceId),
           plazas: String(plazas), precio: sfcomPrecioPublico.value || null }],
        proveedorActual,
        { withOkCancel: true }
    )
    if (resultado !== 'ok') return false
    sfcomEstadoLocal = 'pending'
    _actualizarEstadoSfcomUI()
    if (servicioEditandoId) {
        const { error } = await supabase.from('sfcom_listings').upsert({
            availability_id:    servicioEditandoId,
            sfcom_service_name: nombre,
            sfcom_slots_listed: plazas,
            sfcom_status:       'pending'
        }, { onConflict: 'availability_id' })
        if (!error) {
            const disp = todaDisponibilidad.find(d => d.id === servicioEditandoId)
            if (disp) {
                disp.sfcom_service_name = nombre
                disp.sfcom_slots_listed = plazas
                disp.sfcom_status       = 'pending'
            }
        }
    }
    return true
}

sfcomNombreProducto.addEventListener('focus', () => mostrarSugerenciasNombreProducto(sfcomNombreProducto.value))
sfcomNombreProducto.addEventListener('input', () => mostrarSugerenciasNombreProducto(sfcomNombreProducto.value))
sfcomNombreAutoList.addEventListener('click', e => {
    const div = e.target.closest('[data-nombre]')
    if (!div) return
    sfcomNombreProducto.value = div.dataset.nombre
    sfcomNombreAutoList.style.display = 'none'
})

function limpiarFormularioServicio() {
    servicioEditandoId   = null
    serviciosEditandoIds = []
    ultimoCampoActivo    = 'precio'
    inputServicioId.value    = ''
    inputServicioId.disabled = false
    inputPlazas.value        = ''
    inputPrecio.value        = ''
    inputCosteTotal.value    = ''
    selectModelo.value                  = 'capacity'
    inputServicioDescription.value      = ''
    inputServicioComments.value         = ''
    if (servicioDescStatus) servicioDescStatus.textContent = ''
    document.getElementById('inputCosteServicio').value = '—'
    document.getElementById('titulo-bloque-servicio').textContent = '➕ Añadir / Editar servicio'
    servicioStatus.textContent    = ''
    btnGuardarServicio.textContent         = 'Añadir servicio'
    btnGuardarServicio.disabled            = true
    btnCancelarServicio.style.display      = 'none'
    document.getElementById('btnAbrirMultiple').style.display = 'none'
    document.querySelectorAll('.chk-servicio:checked').forEach(c => c.checked = false)
    sortServiciosCol = null
    sortServiciosDir = 'asc'
    actualizarSeccionSfcom(null)
}

// ===== GUARDAR SERVICIO(S) =====
btnGuardarServicio.addEventListener('click', async () => {
    const proveedorId = inputProveedorId.value.trim().toUpperCase()
    const plazas      = parseInt(inputPlazas.value)
    const precio      = parseFloat(inputPrecio.value)
    const modelo      = selectModelo.value

    if (plazas < 0) { alert('El número de plazas no puede ser negativo.'); return }
    if (plazas === 0) { if (!confirm('¿Quieres añadir un servicio con 0 plazas disponibles?')) return }

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
        // Modal consultivo antes de escribir (provider_id/service_id no cambian en edición múltiple)
        const paresMulti = serviciosEditandoIds
            .map(id => todaDisponibilidad.find(d => d.id === id))
            .filter(Boolean)
            .map(d => ({ providerId: d.provider_id, serviceId: d.service_id }))
        const sfcomOkMulti = await confirmarStockSfcom(paresMulti)
        if (!sfcomOkMulti) return

        for (const dispId of serviciosEditandoIds) {
            const dispActual = todaDisponibilidad.find(d => d.id === dispId)
            if (!dispActual) continue
            const updateData = {}
            if (inputPlazas.value !== '' && !isNaN(plazas)) updateData.total_slots    = plazas
            if (inputPrecio.value !== '' && !isNaN(precio)) updateData.price_per_slot = precio
            updateData.billing_model = modelo

            const { error } = await supabase.from('availability')
                .update(updateData).eq('id', dispId)
            if (error) { alert('Error al actualizar ' + dispActual.service_id + ': ' + error.message); continue }
            todaDisponibilidad = todaDisponibilidad.map(d =>
                d.id === dispId ? { ...d, ...updateData } : d
            )
        }
        await persistirPagosProveedor(supabase, proveedorActual.id, todasReservas, todaDisponibilidad)
        for (const { providerId, serviceId } of paresMulti) {
            await syncStockToSfcom(supabase, providerId, serviceId)
        }
        limpiarFormularioServicio()
        cargarServiciosProveedor(proveedorActual.id)
        cargarPagosProveedor(proveedorActual.id)
        return
    }

    // MODO EDICIÓN SIMPLE o CREACIÓN
    const servicioId = inputServicioId.value.trim().toUpperCase()

    // Si hay datos sfcom sin solicitar, preguntar antes de guardar
    let _sfcomSinSolicitar = false
    if (sfcomEstadoLocal === null) {
        const _sfcomNombre = sfcomNombreProducto.value.trim()
        const _sfcomPlazas = parseInt(sfcomSlotsListed.value) || 0
        if (_sfcomNombre && _sfcomPlazas > 0) {
            const quiereSolicitar = confirm('Hay datos en la sección sfcom pero no se ha solicitado el alta. ¿Quieres solicitar el alta en sfcom antes de guardar?')
            if (quiereSolicitar) {
                const exito = await solicitarAltaSfcom()
                if (!exito) return  // email modal cancelado → abortar guardado
            } else {
                sfcomNombreProducto.value = ''
                sfcomSlotsListed.value    = ''
                sfcomPrecioPublico.value  = ''
                sfcomDetalles.open        = false
                _sfcomSinSolicitar        = true
            }
        }
    }

    const servicioExiste = todosServicios.find(s => s.id.toUpperCase() === servicioId)
    if (!servicioExiste) {
        if (!confirm(`¿Crear servicio nuevo "${servicioId}"?`)) return
        const descSvc = inputServicioDescription.value.trim() || null
        const commSvc = inputServicioComments.value.trim()    || null
        const { error } = await supabase.from('services')
            .insert({ id: servicioId, description: descSvc, comments: commSvc })
        if (error) { alert('Error al crear servicio: ' + error.message); return }
        todosServicios.push({ id: servicioId, description: descSvc, comments: commSvc })
    }

    const descSvc = inputServicioDescription.value.trim() || null
    const commSvc = inputServicioComments.value.trim()    || null

    // Actualizar description y comments en la tabla services
    const svcId = todaDisponibilidad.find(d => d.id === servicioEditandoId)?.service_id
                  ?? servicioId
    await supabase.from('services')
        .update({ description: descSvc, comments: commSvc })
        .eq('id', svcId)
    todosServicios = todosServicios.map(s =>
        s.id === svcId ? { ...s, description: descSvc, comments: commSvc } : s
    )

    // Modal consultivo antes de escribir (para edición: muestra stock actual; para creación: silencioso)
    const sfcomOkSingle = await confirmarStockSfcom([{ providerId: proveedorActual.id, serviceId: servicioId }])
    if (!sfcomOkSingle) return

    if (servicioEditandoId) {
        const availPayload = {
            total_slots:    plazas,
            price_per_slot: isNaN(precio) ? 0 : precio,
            billing_model:  modelo
        }
        const { error } = await supabase.from('availability')
            .update(availPayload)
            .eq('id', servicioEditandoId)
        if (error) { alert('Error al actualizar: ' + error.message); return }

        // sfcom: pending → guardar nombre/plazas/status; confirmed → solo plazas
        // sfcomPrecioPublico nunca va a la BD (solo para el correo)
        let sfcomUpdate = {}
        if (sfcomEstadoLocal === 'pending') {
            sfcomUpdate = {
                sfcom_service_name: sfcomNombreProducto.value.trim() || null,
                sfcom_slots_listed: parseInt(sfcomSlotsListed.value) || null,
                sfcom_status:       sfcomNombreProducto.value.trim() ? 'pending' : null
            }
            await supabase.from('sfcom_listings').upsert(
                { availability_id: servicioEditandoId, ...sfcomUpdate },
                { onConflict: 'availability_id' }
            )
        } else if (sfcomEstadoLocal === 'confirmed') {
            sfcomUpdate = { sfcom_slots_listed: parseInt(sfcomSlotsListed.value) || null }
            await supabase.from('sfcom_listings')
                .update(sfcomUpdate)
                .eq('availability_id', servicioEditandoId)
        }

        todaDisponibilidad = todaDisponibilidad.map(d =>
            d.id === servicioEditandoId ? { ...d, ...availPayload, ...sfcomUpdate } : d
        )
    } else {
        const yaExiste = todaDisponibilidad.find(d =>
            d.provider_id === proveedorActual.id && d.service_id === servicioId
        )
        if (yaExiste) {
            alert(`Este proveedor ya tiene el servicio ${servicioId}. Selecciónalo en la tabla para editarlo.`)
            return
        }
        const { data: nuevaDisp, error } = await supabase.from('availability').insert({
            provider_id:    proveedorActual.id,
            service_id:     servicioId,
            total_slots:    plazas,
            price_per_slot: isNaN(precio) ? 0 : precio,
            billing_model:  modelo
        }).select().single()
        if (error) { alert('Error al añadir servicio: ' + error.message); return }

        let sfcomInsert = {}
        if (sfcomEstadoLocal === 'pending') {
            sfcomInsert = {
                sfcom_service_name: sfcomNombreProducto.value.trim() || null,
                sfcom_slots_listed: parseInt(sfcomSlotsListed.value) || null,
                sfcom_status:       sfcomNombreProducto.value.trim() ? 'pending' : null
            }
            await supabase.from('sfcom_listings').insert({ availability_id: nuevaDisp.id, ...sfcomInsert })
        }
        todaDisponibilidad.push({ ...nuevaDisp, ...sfcomInsert })
    }

    await persistirPagosProveedor(supabase, proveedorActual.id, todasReservas, todaDisponibilidad)
    await syncStockToSfcom(supabase, proveedorActual.id, servicioId)

    limpiarFormularioServicio()
    cargarServiciosProveedor(proveedorActual.id)
    cargarPagosProveedor(proveedorActual.id)

    if (_sfcomSinSolicitar) {
        servicioStatus.textContent = 'ℹ️ Servicio guardado. Alta en sfcom no solicitada.'
        servicioStatus.style.color = 'var(--subtle)'
        setTimeout(() => { servicioStatus.textContent = '' }, 5000)
    }
})

btnCancelarServicio.addEventListener('click', limpiarFormularioServicio)

// ===== BLOQUE 3: SERVICIOS DEL PROVEEDOR =====

let sortServiciosCol   = null
let sortServiciosDir   = 'asc'
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
        { label: 'Servicio',     campo: 'service_id' },
        { label: 'Plazas',       campo: 'total_slots' },
        { label: 'Precio/plaza', campo: 'price_per_slot' },
        { label: 'Modelo',       campo: 'billing_model' },
        { label: 'Coste',        campo: '_coste' },
        { label: 'Reservadas',   campo: '_reservadas' },
        { label: 'Clientes',     campo: '_clientes' },
    ]

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

    if (sortServiciosCol !== null) {
        const campo = cols[sortServiciosCol].campo
        datos.sort((a, b) => {
            const va = String(a[campo] ?? '')
            const vb = String(b[campo] ?? '')
            const cmp = va.localeCompare(vb, 'es', { numeric: true })
            return sortServiciosDir === 'asc' ? cmp : -cmp
        })
    }

    const thead = document.querySelector('#bloque-servicios-proveedor table thead tr')
    thead.innerHTML = '<th></th>' + cols.map((c, i) => `
        <th style="cursor:pointer; user-select:none" onclick="sortServicios(${i})">
            ${c.label}
            <span style="font-size:10px; opacity:${sortServiciosCol === i ? 1 : 0.4}">
                ${sortServiciosCol === i ? (sortServiciosDir === 'asc' ? '↑' : '↓') : '↕'}
            </span>
        </th>
    `).join('')

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

function cargarServicioEnFormulario(dispIds) {
    serviciosEditandoIds = dispIds
    const disps = dispIds.map(id => todaDisponibilidad.find(d => d.id === id)).filter(Boolean)
    if (disps.length === 0) return

    ultimoCampoActivo = 'precio'

    if (disps.length === 1) {
        servicioEditandoId       = disps[0].id
        inputServicioId.value    = disps[0].service_id
        inputServicioId.disabled = false
        inputPlazas.value        = disps[0].total_slots
        inputPrecio.value        = disps[0].price_per_slot
        inputCosteTotal.value    = (disps[0].total_slots * parseFloat(disps[0].price_per_slot)).toFixed(2)
        selectModelo.value             = disps[0].billing_model
        // description y comments vienen de la tabla services, cruzada por service_id
        const svc = todosServicios.find(s => s.id === disps[0].service_id)
        inputServicioDescription.value = svc?.description ?? ''
        inputServicioComments.value    = svc?.comments    ?? ''
        document.getElementById('titulo-bloque-servicio').textContent = '✏️ Editando servicio'
        actualizarSeccionSfcom(disps[0])
    } else {
        servicioEditandoId       = null
        inputServicioId.value    = 'Varios servicios'
        inputServicioId.disabled = true

        const plazasIguales = disps.every(d => d.total_slots    === disps[0].total_slots)
        const precioIgual   = disps.every(d => d.price_per_slot === disps[0].price_per_slot)
        const modeloIgual   = disps.every(d => d.billing_model  === disps[0].billing_model)

        inputPlazas.value     = plazasIguales ? disps[0].total_slots    : ''
        inputPrecio.value     = precioIgual   ? disps[0].price_per_slot : ''
        inputCosteTotal.value = (plazasIguales && precioIgual)
            ? (disps[0].total_slots * parseFloat(disps[0].price_per_slot)).toFixed(2) : ''
        selectModelo.value    = modeloIgual   ? disps[0].billing_model  : 'capacity'

        document.getElementById('titulo-bloque-servicio').textContent =
            `✏️ Editando ${disps.length} servicios`
        actualizarSeccionSfcom(null)
    }

    actualizarCosteServicio()
    btnGuardarServicio.textContent    = '💾 Guardar cambios'
    btnGuardarServicio.disabled       = false
    btnCancelarServicio.style.display = 'inline-block'
    document.getElementById('btnAbrirMultiple').style.display = 'none'
    document.getElementById('bloque-servicio').scrollIntoView({ behavior: 'smooth' })
}

document.getElementById('btnEditarServicios').addEventListener('click', () => {
    const checks = [...document.querySelectorAll('.chk-servicio:checked')]
    if (checks.length === 0) { alert('Selecciona al menos un servicio para editar'); return }
    const ids = checks.map(chk => parseInt(chk.closest('tr').dataset.dispId))
    cargarServicioEnFormulario(ids)
})

document.getElementById('btnEliminarServicio').addEventListener('click', async () => {
    const checks = [...document.querySelectorAll('.chk-servicio:checked')]
    if (checks.length === 0) return
    if (!confirm(`¿Eliminar ${checks.length} servicio(s) seleccionado(s)?`)) return

    const noEliminados = []
    const eliminados   = []

    for (const chk of checks) {
        const tr     = chk.closest('tr')
        const dispId = parseInt(tr.dataset.dispId)
        const disp   = todaDisponibilidad.find(d => d.id === dispId)
        if (!disp) continue

        const { service_id: servicioId, provider_id: proveedorId } = disp

        if (disp.sfcom_status !== null && disp.sfcom_status !== undefined) {
            noEliminados.push(`${servicioId} (tiene sfcom activo: "${disp.sfcom_status}" — da de baja en sfcom primero)`)
            continue
        }

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

        await supabase.from('availability').delete().eq('id', dispId)
        todaDisponibilidad = todaDisponibilidad.filter(d => d.id !== dispId)
        eliminados.push({ servicioId, proveedorId, dispId })

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
                if (noEliminados.length > 0) alert('No se pudieron eliminar:\n' + noEliminados.join('\n'))
                return
            }
        }

        await persistirPagosProveedor(supabase, proveedorId, todasReservas, todaDisponibilidad)
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

// ═══════════════════════════════════════════════════════════════════════════
// ASISTENTE MÚLTIPLE
// ═══════════════════════════════════════════════════════════════════════════

let multipleRows      = []
let sfcomMultipleOpen = false  // persiste entre rerenders

function sugerirNombreVariacion(servicioId) {
    const partes = servicioId.split('_')
    if (partes[0] === 'ENCIERRO') {
        const dia = parseInt(partes[1])
        if (dia >= 7 && dia <= 14) {
            const year     = new Date().getFullYear()
            const fecha    = new Date(year, 6, dia)
            const semana   = fecha.toLocaleDateString('es-ES', { weekday: 'long' })
            const semanaCap = semana.charAt(0).toUpperCase() + semana.slice(1)
            return `${semanaCap} ${dia} de Julio ${year}`
        }
    }
    const svc = todosServicios.find(s => s.id === servicioId)
    return svc?.description ?? ''
}

function abrirAsistenteMultiple() {
    if (!proveedorActual) return

    const existingDisp = todaDisponibilidad.filter(d => d.provider_id === proveedorActual.id)
    const assignedIds  = new Set(existingDisp.map(d => d.service_id))
    const unassigned   = todosServicios.filter(s => !assignedIds.has(s.id))

    sfcomMultipleOpen = false
    multipleRows = [
        ...existingDisp.map(d => ({
            dispId:              d.id,
            serviceId:           d.service_id,
            isExisting:          true,
            active:              true,
            total_slots:         d.total_slots,
            price_per_slot:      d.price_per_slot,
            billing_model:       d.billing_model ?? 'capacity',
            _db_slots:           d.total_slots,
            _db_precio:          d.price_per_slot,
            _db_modelo:          d.billing_model ?? 'capacity',
            modified:            false,
            sfcom_status:        d.sfcom_status,
            sfcomListar:         false,
            sfcomNombreProducto: d.sfcom_service_name ?? '',
            sfcomNombreVariacion: _variacionAuto(d.service_id),
            sfcomPlazas:         d.sfcom_slots_listed ?? '',
            sfcomPrecio:         '',  // nunca de la BD
        })),
        ...unassigned.map(s => ({
            dispId:              null,
            serviceId:           s.id,
            isExisting:          false,
            active:              false,
            total_slots:         null,
            price_per_slot:      null,
            billing_model:       'capacity',
            modified:            false,
            sfcom_status:        null,
            sfcomListar:         false,
            sfcomNombreProducto: '',
            sfcomNombreVariacion: _variacionAuto(s.id),
            sfcomPlazas:         '',
            sfcomPrecio:         '',
        })),
        // Fila vacía para nuevo servicio con ID personalizado
        {
            dispId:              null,
            serviceId:           '',
            isExisting:          false,
            isNewRow:            true,
            active:              false,
            total_slots:         null,
            price_per_slot:      null,
            billing_model:       'capacity',
            modified:            false,
            sfcom_status:        null,
            sfcomListar:         false,
            sfcomNombreProducto: '',
            sfcomNombreVariacion: '',
            sfcomPlazas:         '',
            sfcomPrecio:         '',
        }
    ]

    renderMultiple()
    document.getElementById('dlgMultiple').showModal()
}

function harvestMultipleValues() {
    const contenido = document.getElementById('multiple-contenido')
    if (!contenido || !contenido.querySelector('.m-plazas')) return
    multipleRows.forEach((row, i) => {
        const p   = contenido.querySelector(`.m-plazas[data-idx="${i}"]`)
        const r   = contenido.querySelector(`.m-precio[data-idx="${i}"]`)
        const m   = contenido.querySelector(`.m-modelo[data-idx="${i}"]`)
        const id  = contenido.querySelector(`.m-id[data-idx="${i}"]`)
        const snp = contenido.querySelector(`.m-sfcom-nombreproducto[data-idx="${i}"]`)
        const sp  = contenido.querySelector(`.m-sfcom-plazas[data-idx="${i}"]`)
        const se  = contenido.querySelector(`.m-sfcom-precio[data-idx="${i}"]`)
        if (p  && !p.disabled)  row.total_slots         = p.value === '' ? null : parseFloat(p.value)
        if (r  && !r.disabled)  row.price_per_slot      = r.value === '' ? null : parseFloat(r.value)
        if (m  && !m.disabled)  row.billing_model       = m.value
        if (id) row.serviceId                           = id.value
        if (snp && !snp.disabled) row.sfcomNombreProducto = snp.value
        if (sp  && !sp.disabled)  row.sfcomPlazas         = sp.value
        if (se  && !se.disabled)  row.sfcomPrecio         = se.value
    })
}

function renderMultiple() {
    harvestMultipleValues()
    const contenido = document.getElementById('multiple-contenido')

    // ── Tabla principal ─────────────────────────────────────────────────────
    let html = `
    <h3 style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--text)">Servicios</h3>
    <div class="table-wrapper" style="margin-bottom:22px">
    <table class="multiple-table">
        <thead><tr>
            <th style="width:28px"></th>
            <th>Servicio</th>
            <th style="width:90px">Plazas</th>
            <th style="width:110px">Precio/plaza (€)</th>
            <th style="width:110px">Modelo</th>
        </tr></thead>
        <tbody>`

    multipleRows.forEach((row, i) => {
        if (row.isNewRow) {
            html += `<tr data-idx="${i}">
                <td><input type="checkbox" class="m-chk" data-idx="${i}"></td>
                <td><input type="text" class="m-id" data-idx="${i}" value=""
                    placeholder="NUEVO_SERVICIO_ID" autocomplete="off"
                    style="text-transform:uppercase;font-family:monospace;font-size:11px;width:100%"></td>
                <td><input type="number" class="m-plazas" data-idx="${i}" value="" placeholder="—" step="1" disabled></td>
                <td><input type="number" class="m-precio" data-idx="${i}" value="" placeholder="—" step="0.01" disabled></td>
                <td><select class="m-modelo" data-idx="${i}" disabled>
                    <option value="capacity">Capacidad</option>
                    <option value="consumption">Consumo</option>
                </select></td>
            </tr>`
        } else {
            const rowCls  = (row.isExisting && !row.modified) ? 'multiple-existente' : 'multiple-modificado'
            const checked = row.active ? 'checked' : ''
            const dis     = row.active ? '' : 'disabled'
            const badge   = row.isExisting
                ? (row.modified
                    ? '<span class="multiple-badge-editado">editado</span>'
                    : '<span class="multiple-badge-existente">existente</span>')
                : ''
            html += `<tr data-idx="${i}" class="${rowCls}">
                <td><input type="checkbox" class="m-chk" data-idx="${i}" ${checked}
                    ${row.isExisting ? '' : ''}></td>
                <td style="font-family:monospace;font-size:11px">${row.serviceId}${badge}</td>
                <td><input type="number" class="m-plazas" data-idx="${i}"
                    value="${row.total_slots ?? ''}" placeholder="—" step="1" ${dis}></td>
                <td><input type="number" class="m-precio" data-idx="${i}"
                    value="${row.price_per_slot ?? ''}" placeholder="—" step="0.01" ${dis}></td>
                <td><select class="m-modelo" data-idx="${i}" ${dis}>
                    <option value="capacity" ${row.billing_model === 'capacity' ? 'selected' : ''}>Capacidad</option>
                    <option value="consumption" ${row.billing_model === 'consumption' ? 'selected' : ''}>Consumo</option>
                </select></td>
            </tr>`
        }
    })

    html += `</tbody></table></div>`

    // ── Sección sfcom (solo filas activas y no confirmadas) ─────────────────
    const sfcomRows = multipleRows.filter(r => r.active && r.sfcom_status !== 'confirmed')
    if (sfcomRows.length > 0) {
        const openAttr = sfcomMultipleOpen ? 'open' : ''
        html += `
        <details id="sfcom-multiple-details" ${openAttr} style="margin-top:18px">
            <summary style="cursor:pointer;display:flex;align-items:center;gap:6px;
                            font-size:13px;font-weight:600;color:var(--text);
                            list-style:none;padding:6px 0;user-select:none">
                <span id="sfcom-multiple-chevron" style="font-size:9px;color:var(--subtle);
                    transition:transform 0.15s;${sfcomMultipleOpen ? 'transform:rotate(90deg)' : ''}">▶</span>
                <img src="https://tienda.sanfermin.com/favicon.ico" width="13" height="13"
                    style="border-radius:2px;flex-shrink:0" onerror="this.style.display='none'">
                Listar en sfcom
            </summary>
            <div style="margin-top:8px">
                <div style="font-size:12px;color:var(--subtle);margin-bottom:10px">
                    Marca los servicios que quieres solicitar de alta. Se generará un correo para Hilario con todos los detalles.
                </div>
                <div class="table-wrapper">
                <table class="multiple-table">
                    <thead><tr>
                        <th style="width:28px"></th>
                        <th>Servicio</th>
                        <th>Nombre del producto (sfcom)</th>
                        <th>Variación / Día</th>
                        <th style="width:90px">Plazas sfcom</th>
                        <th style="width:100px">Precio público (€)</th>
                    </tr></thead>
                    <tbody>`

        sfcomRows.forEach(row => {
            const i   = multipleRows.indexOf(row)
            const dis = row.sfcomListar ? '' : 'disabled'
            html += `<tr data-sfcom-idx="${i}">
                <td><input type="checkbox" class="m-sfcom-chk" data-idx="${i}" ${row.sfcomListar ? 'checked' : ''}></td>
                <td style="font-family:monospace;font-size:11px">${row.serviceId || '—'}</td>
                <td><input type="text" class="m-sfcom-nombreproducto" data-idx="${i}"
                    value="${row.sfcomNombreProducto}" placeholder="Ej: Balcón Estafeta Mitad" ${dis}></td>
                <td><input type="text" class="m-sfcom-nombrevar" data-idx="${i}"
                    value="${row.sfcomNombreVariacion}" disabled
                    style="color:var(--subtle);font-size:11px"></td>
                <td><input type="number" class="m-sfcom-plazas" data-idx="${i}"
                    value="${row.sfcomPlazas}" placeholder="—" step="1" ${dis}></td>
                <td><input type="number" class="m-sfcom-precio" data-idx="${i}"
                    value="${row.sfcomPrecio}" placeholder="—" step="0.01" ${dis}></td>
            </tr>`
        })

        html += `</tbody></table></div></div></details>`
    }

    contenido.innerHTML = html
    setupMultipleEvents()
}

function setupMultipleEvents() {
    const contenido = document.getElementById('multiple-contenido')

    // Checkboxes de fila
    contenido.querySelectorAll('.m-chk').forEach(chk => {
        chk.addEventListener('change', () => {
            const i   = parseInt(chk.dataset.idx)
            const row = multipleRows[i]
            if (!row) return

            row.active = chk.checked
            if (!row.isExisting && !row.isNewRow) {
                const tr = contenido.querySelector(`tr[data-idx="${i}"]`)
                if (tr) {
                    const dis = chk.checked ? '' : 'disabled'
                    tr.querySelectorAll('.m-plazas, .m-precio, .m-modelo').forEach(el => {
                        if (chk.checked) el.removeAttribute('disabled')
                        else el.setAttribute('disabled', '')
                    })
                    tr.className = chk.checked ? 'multiple-modificado' : ''
                }
            }
            if (row.isNewRow) {
                const tr = contenido.querySelector(`tr[data-idx="${i}"]`)
                if (tr) {
                    tr.querySelectorAll('.m-plazas, .m-precio, .m-modelo').forEach(el => {
                        if (chk.checked) el.removeAttribute('disabled')
                        else el.setAttribute('disabled', '')
                    })
                }
            }
            renderMultiple()
        })
    })

    // Toggle del details sfcom
    const sfcomDetails = contenido.querySelector('#sfcom-multiple-details')
    if (sfcomDetails) {
        sfcomDetails.addEventListener('toggle', () => {
            sfcomMultipleOpen = sfcomDetails.open
            const chevron = contenido.querySelector('#sfcom-multiple-chevron')
            if (chevron) chevron.style.transform = sfcomDetails.open ? 'rotate(90deg)' : ''
        })
    }

    // Checkboxes sfcom
    contenido.querySelectorAll('.m-sfcom-chk').forEach(chk => {
        chk.addEventListener('change', () => {
            const i   = parseInt(chk.dataset.idx)
            const row = multipleRows[i]
            if (!row) return
            row.sfcomListar = chk.checked
            const tr = contenido.querySelector(`tr[data-sfcom-idx="${i}"]`)
            if (tr) {
                tr.querySelectorAll('.m-sfcom-nombreproducto, .m-sfcom-plazas, .m-sfcom-precio').forEach(el => {
                    if (chk.checked) el.removeAttribute('disabled')
                    else el.setAttribute('disabled', '')
                })
            }
        })
    })

    // Inputs de plazas/precio/modelo — sync estado + smart fill
    contenido.querySelectorAll('.m-plazas, .m-precio, .m-modelo').forEach(input => {
        input.addEventListener('change', () => {
            const i     = parseInt(input.dataset.idx)
            const row   = multipleRows[i]
            if (!row) return
            const campo = input.classList.contains('m-plazas') ? 'total_slots'
                        : input.classList.contains('m-precio')  ? 'price_per_slot'
                        : 'billing_model'
            const valor = campo === 'billing_model' ? input.value
                        : (input.value === '' ? null : parseFloat(input.value))
            row[campo]  = valor
            if (row.isExisting) {
                row.modified = (
                    row.total_slots    !== row._db_slots  ||
                    row.price_per_slot !== row._db_precio ||
                    row.billing_model  !== row._db_modelo
                )
                const tr    = contenido.querySelector(`tr[data-idx="${i}"]`)
                const badge = tr?.querySelector('.multiple-badge-existente, .multiple-badge-editado')
                if (tr) {
                    tr.className = row.modified ? 'multiple-modificado' : 'multiple-existente'
                    if (badge) {
                        badge.className   = row.modified ? 'multiple-badge-editado' : 'multiple-badge-existente'
                        badge.textContent = row.modified ? 'editado' : 'existente'
                    }
                }
            }
            // Smart fill: rellenar solo celdas estrictamente null (0 no se sobreescribe)
            multipleRows.forEach((r, j) => {
                if (j === i || !r.active || r.isNewRow) return
                if (r[campo] !== null) return  // null estricto: 0 no se toca
                r[campo] = valor
                const otroInput = contenido.querySelector(`.${input.classList[0]}[data-idx="${j}"]`)
                if (otroInput && !otroInput.disabled) otroInput.value = input.value
            })
        })
    })

    // Input ID para fila nueva
    contenido.querySelectorAll('.m-id').forEach(input => {
        input.addEventListener('input', () => {
            const i   = parseInt(input.dataset.idx)
            const row = multipleRows[i]
            if (!row) return
            input.value    = normalizarId(input.value)
            row.serviceId            = input.value
            row.sfcomNombreVariacion = _variacionAuto(input.value)
            // Verificar si coincide con servicio existente sin asignar
            const enUnassigned = todosServicios.find(s => s.id === input.value)
            if (enUnassigned) {
                input.style.color = 'var(--accent-warn)'
                input.title       = `${input.value} ya existe como servicio — se usará el existente`
            } else {
                input.style.color = ''
                input.title       = ''
            }
        })
    })

    // Inputs sfcom — change (no input) para que smart fill no dispare al vuelo
    contenido.querySelectorAll('.m-sfcom-nombreproducto, .m-sfcom-plazas, .m-sfcom-precio').forEach(input => {
        input.addEventListener('change', () => {
            const i   = parseInt(input.dataset.idx)
            const row = multipleRows[i]
            if (!row) return
            if (input.classList.contains('m-sfcom-nombreproducto')) {
                row.sfcomNombreProducto = input.value
                // Smart fill: nombre del producto igual para todas las filas sfcom vacías
                multipleRows.forEach((r, j) => {
                    if (j === i || !r.active || r.isNewRow || r.sfcomNombreProducto !== '') return
                    r.sfcomNombreProducto = input.value
                    const otro = contenido.querySelector(`.m-sfcom-nombreproducto[data-idx="${j}"]`)
                    if (otro && !otro.disabled) otro.value = input.value
                })
            }
            if (input.classList.contains('m-sfcom-plazas'))  row.sfcomPlazas = input.value
            if (input.classList.contains('m-sfcom-precio'))  row.sfcomPrecio = input.value
        })
    })
}

document.getElementById('btnAbrirMultiple').addEventListener('click', abrirAsistenteMultiple)
document.getElementById('dlgMultipleCerrar').addEventListener('click', () => document.getElementById('dlgMultiple').close())
document.getElementById('btnMultipleCancelar').addEventListener('click', () => document.getElementById('dlgMultiple').close())

document.getElementById('btnMultipleGuardar').addEventListener('click', async () => {
    if (!proveedorActual) return

    const proveedorId = proveedorActual.id
    const pairsSync   = []

    for (const row of multipleRows) {
        if (row.isNewRow && !row.active) continue
        if (row.isNewRow && row.active && !row.serviceId) continue

        if (row.isExisting && (row.modified || (row.sfcomListar && row.sfcomNombreProducto))) {
            // UPDATE fila existente
            const updateData = {}
            if (row.modified) {
                updateData.total_slots    = row.total_slots
                updateData.price_per_slot = row.price_per_slot
                updateData.billing_model  = row.billing_model
            }
            const { error } = await supabase.from('availability').update(updateData).eq('id', row.dispId)
            if (error) { alert(`Error al actualizar ${row.serviceId}: ${error.message}`); continue }
            let sfcomUpdateMulti = {}
            if (row.sfcomListar && row.sfcomNombreProducto) {
                sfcomUpdateMulti = {
                    sfcom_service_name: row.sfcomNombreProducto,
                    sfcom_slots_listed: parseInt(row.sfcomPlazas) || null,
                    sfcom_status:       'pending'
                }
                await supabase.from('sfcom_listings').upsert(
                    { availability_id: row.dispId, ...sfcomUpdateMulti },
                    { onConflict: 'availability_id' }
                )
            }
            todaDisponibilidad = todaDisponibilidad.map(d => d.id === row.dispId ? { ...d, ...updateData, ...sfcomUpdateMulti } : d)
            if (row.modified) pairsSync.push({ provider_id: proveedorId, service_id: row.serviceId })
        } else if (!row.isExisting && row.active && row.serviceId) {
            // INSERT nuevo servicio
            const servicioExiste = todosServicios.find(s => s.id === row.serviceId)
            if (!servicioExiste) {
                const { error: errSvc } = await supabase.from('services').insert({ id: row.serviceId })
                if (errSvc) { alert(`Error al crear servicio ${row.serviceId}: ${errSvc.message}`); continue }
                todosServicios.push({ id: row.serviceId })
            }
            const yaExiste = todaDisponibilidad.find(d => d.provider_id === proveedorId && d.service_id === row.serviceId)
            if (yaExiste) continue
            const insertData = {
                provider_id:    proveedorId,
                service_id:     row.serviceId,
                total_slots:    row.total_slots ?? 0,
                price_per_slot: row.price_per_slot ?? 0,
                billing_model:  row.billing_model
            }
            const { data, error } = await supabase.from('availability').insert(insertData).select()
            if (error) { alert(`Error al añadir ${row.serviceId}: ${error.message}`); continue }
            let sfcomInsertMulti = {}
            if (row.sfcomListar && row.sfcomNombreProducto) {
                sfcomInsertMulti = {
                    sfcom_service_name: row.sfcomNombreProducto,
                    sfcom_slots_listed: parseInt(row.sfcomPlazas) || null,
                    sfcom_status:       'pending'
                }
                await supabase.from('sfcom_listings').insert({ availability_id: data[0].id, ...sfcomInsertMulti })
            }
            todaDisponibilidad.push({ ...data[0], ...sfcomInsertMulti })
            pairsSync.push({ provider_id: proveedorId, service_id: row.serviceId })
        }
    }

    await persistirPagosProveedor(supabase, proveedorId, todasReservas, todaDisponibilidad)

    if (pairsSync.length > 0) {
        const sfcomOkMultiple = await confirmarStockSfcom(pairsSync)
        if (sfcomOkMultiple) {
            for (const pair of pairsSync) await syncStockToSfcom(supabase, pair.provider_id, pair.service_id)
        }
    }

    // Correo a Hilario si hay solicitudes sfcom pendientes
    const sfcomSolicitados = multipleRows.filter(r => r.sfcomListar && r.active)
    const sfcomSinNombre   = sfcomSolicitados.filter(r => !r.sfcomNombreProducto)
    if (sfcomSinNombre.length > 0) {
        alert(
            `Los siguientes servicios están marcados para sfcom pero les falta el nombre del producto:\n\n` +
            sfcomSinNombre.map(r => r.serviceId || '(nuevo)').join('\n') +
            '\n\nIntroduce el nombre antes de guardar.'
        )
        return
    }
    const sfcomConNombre = sfcomSolicitados.filter(r => r.sfcomNombreProducto)
    if (sfcomConNombre.length > 0) {
        const nombresUnicos = [...new Set(sfcomConNombre.map(r => r.sfcomNombreProducto))]
        if (nombresUnicos.length > 1) {
            const ok = confirm(
                `Vas a solicitar alta para ${nombresUnicos.length} productos diferentes en sfcom:\n\n` +
                nombresUnicos.join('\n') +
                '\n\n¿Es correcto o ha sido un error tipográfico?'
            )
            if (!ok) { return }  // se queda abierto el dialog para corregir
        }
        const variaciones = sfcomConNombre.map(r => ({
            serviceId:       r.serviceId,
            nombreProducto:  r.sfcomNombreProducto,
            nombreVariacion: r.sfcomNombreVariacion,
            plazas:          r.sfcomPlazas || null,
            precio:          r.sfcomPrecio || null
        }))
        // Texto de asunto genérico cuando hay múltiples productos distintos
        const nombrePrimary = nombresUnicos.length === 1 ? nombresUnicos[0] : 'nuevos productos'
        mostrarModalCorreoHilario(nombrePrimary, variaciones, proveedorActual)
    }

    document.getElementById('dlgMultiple').close()
    limpiarFormularioServicio()
    cargarServiciosProveedor(proveedorId)
    cargarPagosProveedor(proveedorId)
    document.getElementById('btnAbrirMultiple').style.display = 'inline-block'
})