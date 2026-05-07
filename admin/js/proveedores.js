import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)

// Hamburger
const sidebar     = document.getElementById('sidebar')
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
let todosProveedores   = (await supabase.from('providers').select('*').order('id')).data
let todosServicios     = (await supabase.from('services').select('*').order('id')).data
let todaDisponibilidad = (await supabase.from('availability').select('*')).data
let todosPayments      = (await supabase.from('payments').select('*')).data
let todasReservas      = (await supabase.from('reservations').select('*')).data

let proveedorActual    = null
let servicioEditandoId = null
let hitosProvTemp      = []

const hoy = new Date().toISOString().split('T')[0]
const fmt = n => parseFloat(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })

// ===== REFERENCIAS DOM =====
const inputProveedorId       = document.getElementById('inputProveedorId')
const inputDireccion         = document.getElementById('inputDireccion')
const inputProveedorComments = document.getElementById('inputProveedorComments')
const autoProvList           = document.getElementById('autocompleteProveedorList')
const proveedorStatus        = document.getElementById('proveedor-status')
const inputServicioId        = document.getElementById('inputServicioId')
const inputPlazas            = document.getElementById('inputPlazas')
const inputPrecio            = document.getElementById('inputPrecio')
const selectModelo           = document.getElementById('selectModelo')
const servicioStatus         = document.getElementById('servicio-status')
const btnGuardarServicio     = document.getElementById('btnGuardarServicio')
const btnCancelarServicio    = document.getElementById('btnCancelarServicio')

// ===== BLOQUE 1: PROVEEDOR =====

inputProveedorId.addEventListener('input', () => {
    const val = inputProveedorId.value.trim().toUpperCase()
    if (!val) { autoProvList.style.display = 'none'; limpiarProveedor(); return }

    const coincidencias = todosProveedores.filter(p => p.id.toUpperCase().startsWith(val))
    autoProvList.innerHTML = coincidencias.map(p => `<div data-id="${p.id}">${p.id}</div>`).join('')
    autoProvList.style.display = coincidencias.length > 0 ? 'block' : 'none'

    const exacto = todosProveedores.find(p => p.id.toUpperCase() === val)
    if (exacto) {
        cargarProveedor(exacto)
    } else {
        if (proveedorActual) limpiarCamposProveedor()
        proveedorActual = null
        proveedorStatus.textContent = '✨ Proveedor nuevo'
        proveedorStatus.style.color = 'var(--accent-warn)'
        document.getElementById('bloque-servicio').style.display = 'block'
        document.getElementById('bloque-servicios-proveedor').style.display = 'none'
        document.getElementById('bloque-pagos-proveedor').style.display = 'none'
        limpiarFormularioServicio()
    }
})

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
    inputDireccion.value         = p.address   ?? ''
    inputProveedorComments.value = p.comments  ?? ''
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
    document.getElementById('bloque-servicio').style.display          = 'none'
    document.getElementById('bloque-servicios-proveedor').style.display = 'none'
    document.getElementById('bloque-pagos-proveedor').style.display   = 'none'
    limpiarFormularioServicio()
}

function limpiarCamposProveedor() {
    inputDireccion.value = ''
    inputProveedorComments.value = ''
}

// Guardar automáticamente campos del proveedor existente
const camposProveedor = [inputDireccion, inputProveedorComments]
const camposProvDB    = ['address', 'comments']
camposProveedor.forEach((input, i) => {
    input.addEventListener('change', async () => {
        if (!proveedorActual) return
        await supabase.from('providers')
            .update({ [camposProvDB[i]]: input.value.trim() || null })
            .eq('id', proveedorActual.id)
        proveedorActual[camposProvDB[i]] = input.value.trim() || null
        proveedorStatus.textContent = '✅ Guardado'
        proveedorStatus.style.color = 'var(--accent-ok)'
        setTimeout(() => {
            proveedorStatus.textContent = '✅ Proveedor existente — los cambios se guardan automáticamente'
        }, 2000)
    })
})

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

document.getElementById('autocompleteServicioList').addEventListener('click', e => {
    const div = e.target.closest('[data-id]')
    if (!div) return
    inputServicioId.value = div.dataset.id
    document.getElementById('autocompleteServicioList').style.display = 'none'
    actualizarBtnServicio()
    actualizarCosteServicio()
})

inputPlazas.addEventListener('input', () => { actualizarBtnServicio(); actualizarCosteServicio() })
inputPrecio.addEventListener('input', () => { actualizarBtnServicio(); actualizarCosteServicio() })
selectModelo.addEventListener('change', actualizarCosteServicio)

function actualizarCosteServicio() {
    const plazas  = parseInt(inputPlazas.value) || 0
    const precio  = parseFloat(inputPrecio.value) || 0
    const modelo  = selectModelo.value
    const servId  = inputServicioId.value.trim().toUpperCase()
    let coste     = 0

    if (modelo === 'capacity') {
        coste = plazas * precio
    } else {
        // Consumption: buscar plazas reservadas para este proveedor+servicio
        if (proveedorActual && servId) {
            const plazasRes = todasReservas
                .filter(r => r.provider_id === proveedorActual.id &&
                             r.service_id  === servId &&
                             r.status      !== 'Cancelada')
                .reduce((s, r) => s + r.slots, 0)
            coste = plazasRes * precio
        }
    }

    document.getElementById('inputCosteServicio').value =
        (plazas > 0 && precio > 0) ? fmt(coste) : '—'
}

function actualizarBtnServicio() {
    const tieneProveedor = inputProveedorId.value.trim().length > 0
    const tieneServicio  = inputServicioId.value.trim().length > 0
    const tienePlazas    = inputPlazas.value !== ''
    const tienePrecio    = inputPrecio.value !== ''
    btnGuardarServicio.disabled = !(tieneProveedor && tieneServicio && tienePlazas && tienePrecio)
}

function limpiarFormularioServicio() {
    servicioEditandoId = null
    inputServicioId.value = ''
    inputPlazas.value     = ''
    inputPrecio.value     = ''
    selectModelo.value    = 'capacity'
    document.getElementById('inputCosteServicio').value = '—'
    servicioStatus.textContent = ''
    btnGuardarServicio.textContent    = 'Añadir servicio'
    btnGuardarServicio.disabled       = true
    btnCancelarServicio.style.display = 'none'
    document.querySelectorAll('.chk-servicio:checked').forEach(c => c.checked = false)
}

// ===== GUARDAR SERVICIO =====
btnGuardarServicio.addEventListener('click', async () => {
    const proveedorId = inputProveedorId.value.trim().toUpperCase()
    const servicioId  = inputServicioId.value.trim().toUpperCase()
    const plazas      = parseInt(inputPlazas.value)
    const precio      = parseFloat(inputPrecio.value)
    const modelo      = selectModelo.value

    // Crear proveedor si es nuevo
    if (!proveedorActual) {
        if (!confirm(`¿Crear proveedor nuevo "${proveedorId}"?`)) return
        const { error } = await supabase.from('providers').insert({
            id:       proveedorId,
            address:  inputDireccion.value.trim() || null,
            comments: inputProveedorComments.value.trim() || null
        })
        if (error) { alert('Error al crear proveedor: ' + error.message); return }
        proveedorActual = { id: proveedorId }
        todosProveedores.push(proveedorActual)
        proveedorStatus.textContent = '✅ Proveedor creado'
        proveedorStatus.style.color = 'var(--accent-ok)'
    }

    // Crear servicio si es nuevo
    const servicioExiste = todosServicios.find(s => s.id.toUpperCase() === servicioId)
    if (!servicioExiste) {
        if (!confirm(`¿Crear servicio nuevo "${servicioId}"?`)) return
        const { error } = await supabase.from('services').insert({ id: servicioId })
        if (error) { alert('Error al crear servicio: ' + error.message); return }
        todosServicios.push({ id: servicioId })
    }

    if (servicioEditandoId) {
        // EDITAR
        const { error } = await supabase.from('availability')
            .update({ total_slots: plazas, price_per_slot: precio, billing_model: modelo })
            .eq('id', servicioEditandoId)
        if (error) { alert('Error al actualizar: ' + error.message); return }
        todaDisponibilidad = todaDisponibilidad.map(d =>
            d.id === servicioEditandoId
                ? { ...d, total_slots: plazas, price_per_slot: precio, billing_model: modelo }
                : d
        )
    } else {
        // CREAR
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
            price_per_slot: precio,
            billing_model:  modelo
        }).select()
        if (error) { alert('Error al añadir servicio: ' + error.message); return }
        todaDisponibilidad.push(data[0])
    }

    // Recalcular pago final del proveedor
    await recalcularPagoFinalProveedor(proveedorActual.id)

    limpiarFormularioServicio()
    cargarServiciosProveedor(proveedorActual.id)
    cargarPagosProveedor(proveedorActual.id)
})

btnCancelarServicio.addEventListener('click', limpiarFormularioServicio)

// ===== BLOQUE 3: SERVICIOS DEL PROVEEDOR =====
async function cargarServiciosProveedor(proveedorId) {
    const dispProv = todaDisponibilidad.filter(d => d.provider_id === proveedorId)
    const tbody    = document.getElementById('tbody-servicios-proveedor')
    const bloque   = document.getElementById('bloque-servicios-proveedor')

    if (dispProv.length === 0) { bloque.style.display = 'none'; return }

    bloque.style.display = 'block'
    tbody.innerHTML = dispProv.map(d => {
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

        return `<tr data-disp-id="${d.id}">
            <td><input type="checkbox" class="chk-servicio"></td>
            <td>${d.service_id}</td>
            <td>${d.total_slots}</td>
            <td>${fmt(d.price_per_slot)}</td>
            <td>${d.billing_model === 'consumption'
                ? '<span style="color:var(--accent-warn)">Consumo</span>'
                : 'Capacidad'}</td>
            <td>${fmt(coste)}</td>
        </tr>`
    }).join('')

    // Click en fila para editar
    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', e => {
            if (e.target.type === 'checkbox') return
            const dispId = parseInt(tr.dataset.dispId)
            const disp   = todaDisponibilidad.find(d => d.id === dispId)
            if (!disp) return
            servicioEditandoId            = dispId
            inputServicioId.value         = disp.service_id
            inputPlazas.value             = disp.total_slots
            inputPrecio.value             = disp.price_per_slot
            selectModelo.value            = disp.billing_model
            btnGuardarServicio.textContent    = '💾 Guardar cambios'
            btnGuardarServicio.disabled       = false
            btnCancelarServicio.style.display = 'inline-block'
            actualizarCosteServicio()
            document.getElementById('bloque-servicio').scrollIntoView({ behavior: 'smooth' })
        })
    })
}

// Eliminar servicio
document.getElementById('btnEliminarServicio').addEventListener('click', async () => {
    const checks = [...document.querySelectorAll('.chk-servicio:checked')]
    if (checks.length === 0) return
    if (checks.length > 1) { alert('Selecciona solo un servicio para eliminar'); return }

    const tr      = checks[0].closest('tr')
    const dispId  = parseInt(tr.dataset.dispId)
    const disp    = todaDisponibilidad.find(d => d.id === dispId)
    if (!disp) return

    const { service_id: servicioId, provider_id: proveedorId } = disp

    const tieneReservas = todasReservas.some(r =>
        r.provider_id === proveedorId && r.service_id === servicioId && r.status !== 'Cancelada'
    )
    if (tieneReservas) {
        alert(`No se puede eliminar: hay reservas activas para ${proveedorId} / ${servicioId}`)
        return
    }

    const otrosProveedores = todaDisponibilidad.filter(d =>
        d.service_id === servicioId && d.provider_id !== proveedorId
    )
    const esUltimoServicio = todaDisponibilidad.filter(d => d.provider_id === proveedorId).length === 1

    let borrarServicio  = false
    let borrarProveedor = false

    if (otrosProveedores.length === 0) {
        borrarServicio = confirm(
            `"${servicioId}" no lo ofrece ningún otro proveedor.\n\n` +
            `Aceptar = Eliminar disponibilidad Y servicio\n` +
            `Cancelar = Eliminar solo la disponibilidad`
        )
    }

    if (esUltimoServicio) {
        borrarProveedor = confirm(
            `Este es el último servicio de "${proveedorId}".\n\n` +
            `Aceptar = Eliminar disponibilidad Y proveedor\n` +
            `Cancelar = Eliminar solo la disponibilidad`
        )
    }

    await supabase.from('availability').delete().eq('id', dispId)
    todaDisponibilidad = todaDisponibilidad.filter(d => d.id !== dispId)

    if (borrarServicio) {
        await supabase.from('services').delete().eq('id', servicioId)
        todosServicios = todosServicios.filter(s => s.id !== servicioId)
    }

    if (borrarProveedor) {
        await supabase.from('payments').delete().eq('provider_id', proveedorId)
        await supabase.from('providers').delete().eq('id', proveedorId)
        todosProveedores = todosProveedores.filter(p => p.id !== proveedorId)
        limpiarProveedor()
        inputProveedorId.value = ''
        return
    }

    await recalcularPagoFinalProveedor(proveedorId)
    limpiarFormularioServicio()
    cargarServiciosProveedor(proveedorId)
    cargarPagosProveedor(proveedorId)
})

// ===== BLOQUE 4: PAGOS AL PROVEEDOR =====

// Calcula el coste total del proveedor (capacity + consumption)
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
    const costTotal    = calcularCosteTotalProveedor(proveedorId)
    const prepagos     = hitosProvTemp.filter(h => !h.esFinal).reduce((s, h) => s + parseFloat(h.amount), 0)
    const pagoFinal    = costTotal - prepagos
    const idxFinal     = hitosProvTemp.findIndex(h => h.esFinal)

    if (idxFinal >= 0) {
        hitosProvTemp[idxFinal].amount = pagoFinal
    } else {
        hitosProvTemp.push({
            esFinal:  true,
            comments: 'Pago final',
            amount:   pagoFinal,
            due_date: '2026-07-15',
            paid:     false
        })
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

    // Si no hay pago final, crearlo en memoria
    if (!hitosProvTemp.find(h => h.esFinal)) {
        hitosProvTemp.push({
            esFinal:  true,
            comments: 'Pago final',
            amount:   pagoFinal,
            due_date: '2026-07-15',
            paid:     false
        })
    } else {
        // Actualizar el importe del pago final con el calculado
        const idx = hitosProvTemp.findIndex(h => h.esFinal)
        hitosProvTemp[idx].amount = pagoFinal
    }

    renderHitosProveedor()
    actualizarResumenCoste(proveedorId, costTotal, prepagos, pagoFinal)
    document.getElementById('bloque-pagos-proveedor').style.display = 'block'
}

function renderHitosProveedor() {
    const tbody = document.getElementById('tbody-pagos-proveedor')
    if (hitosProvTemp.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="color:var(--subtle)">Sin hitos</td></tr>'
        return
    }
    tbody.innerHTML = hitosProvTemp.map((h, i) => `
        <tr>
            <td>${h.comments}</td>
            <td>${fmt(h.amount)}
                ${h.esFinal ? '<span style="font-size:11px;color:var(--subtle)"> (calculado)</span>' : ''}
            </td>
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

window.cambiarFechaPagoFinal = function(idx, valor) {
    hitosProvTemp[idx].due_date = valor || null
}

window.togglePagoProvCobrado = function(idx) {
    const h = hitosProvTemp[idx]
    if (!h.paid) {
        const fecha = prompt('Fecha de pago (dejar vacío para hoy):', hoy)
        if (fecha === null) return
        h.paid      = true
        h.paid_date = fecha.trim() || hoy
    } else {
        h.paid      = false
        h.paid_date = null
    }
    renderHitosProveedor()
}

window.eliminarHitoProv = function(idx) {
    hitosProvTemp.splice(idx, 1)
    if (proveedorActual) recalcularPagoFinalProveedor(proveedorActual.id)
}

// Añadir nuevo hito de pago
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
    hitosProvTemp.splice(idxFinal >= 0 ? idxFinal : hitosProvTemp.length, 0, {
        esFinal:  false,
        comments: concepto,
        amount:   importe,
        due_date: fecha,
        paid:     pagado
    })

    document.getElementById('pagoProvConcepto').value = ''
    document.getElementById('pagoProvImporte').value  = ''
    document.getElementById('pagoProvFecha').value    = ''
    document.getElementById('pagoProvPagado').value   = 'false'
    document.getElementById('form-nuevo-pago-proveedor').style.display = 'none'
    document.getElementById('btnNuevoPagoProveedor').style.display     = 'inline-block'

    if (proveedorActual) recalcularPagoFinalProveedor(proveedorActual.id)
})

// Guardar todos los hitos en Supabase
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