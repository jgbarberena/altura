import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, fmt, fechaCobroDefault, normalizarId, buscarConPrioridad, persistirCobrosCliente, persistirPagosProveedor, initAutoSave, exportTable, resolverCliente, abrirRenombrarId, mostrarOpcionesEnvio, parsearNivel, TIPO_SERVICIO_ID, initTemporada, getTemporadaActiva, confirmarSiTemporadaNoActiva, initPrecioInput, setPrecioValue, getPrecioValue, checkTrimCerrado, mostrarModalTrimCerrado } from './utils.js'
import { initFacturacion, abrirPanelFactura, abrirPanelReemision, anularFacturaDeHito, baseDesdeTotalFacturado, totalFacturadoDesdeBase } from './factura.js'
import { irpfRateParaCliente } from './fiscal-config.js'
import { initPropuesta, abrirPanelPropuesta } from './propuesta.js'
import { syncStockToSfcom, checkSfcomOrders, checkAvailabilityBeforeSave, computeExpectedStock, mostrarModalConfirmacionSfcom, confirmarStockSfcom, extraerNombreProducto, extraerDia, verificarConfirmarSfcom, importarCanceladosSfcom, resolverProductoSfcom } from './sfcom.js'
import { mostrarToast, ejecutarVerificacion } from './verificacion.js'
import { crearModal } from './modal.js'
import { initAsistente } from './asistente.js'

await requireAuth()
initFacturacion(supabase)
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()


// ===== DATOS GLOBALES =====

// Inicializar sistema de temporadas antes de cargar datos
const { data: _tmpSeason }    = await supabase.from('services').select('season').order('season', { ascending: false })
const _todasTemporadas        = [...new Set((_tmpSeason ?? []).map(r => r.season))]
await initTemporada(_todasTemporadas)
const _temporada              = getTemporadaActiva()

const { data: todosClientes }  = await supabase.from('clients').select('*').order('id')
const { data: servicios }      = await supabase.from('services').select('*').eq('season', _temporada).order('day')
const { data: disponibilidad } = await supabase.from('availability_panel')
    .select('venue_id, service_id, service_code, total_slots, price_per_slot, billing_model, venue_display_name, venue_address, description, access_instructions, photos, venue_slug, event_type')
    .eq('season', _temporada)
const { data: venues }         = await supabase.from('venues').select('*').order('id')
const { data: _sfcomRaw }      = await supabase.from('sfcom_listings')
    .select('availability_id, sfcom_service_name, sfcom_product_id, sfcom_variation_id, availability!inner(venue_id, service_id, services(service_code))')
const sfcomListings = (_sfcomRaw ?? []).map(r => ({
    id:                 r.availability_id,
    sfcom_service_name: r.sfcom_service_name,
    sfcom_product_id:   r.sfcom_product_id,
    sfcom_variation_id: r.sfcom_variation_id,
    venue_id:           r.availability?.venue_id,
    service_id:         r.availability?.service_id,
    service_code:       r.availability?.services?.service_code
})).filter(r => r.venue_id)
const _servicioIds            = (servicios ?? []).map(s => s.id)
let todasReservas             = _servicioIds.length > 0
    ? (await supabase.from('reservations').select('*').in('service_id', _servicioIds)).data ?? []
    : []

initPropuesta(supabase, servicios, venues, () => disponibilidad)
initAsistente(supabase, { getDisponibilidad: () => disponibilidad, getTodasReservas: () => todasReservas, onEmailSaved: cargarSolicitudes, esSfcom: _esSfcom })

function _getProviderIdFromVenue(venueId) {
    return venues?.find(v => v.id === venueId)?.provider_id ?? null
}

let clienteActual      = null
let reservaEditandoId  = null
let solicitudOriginRef = null   // origin_ref de la solicitud activa: WEB-ref para sfcom, UUID para web/email
let hitosClienteTemp   = []
let _cargandoSolicitud = false
let _limpiandoWebWeb   = false

// ===== ESTADO DEL BLOQUE DE CONVERSIÓN DE PROPUESTA =====
let _modoConversionActivo  = false
let _solicitudConversionId = null   // UUID de la solicitud en conversión
let _solicitudWEBRef       = null   // source WEB de la solicitud sfcom ('WEBxxx_yyy') — para charges y origin_ref
let _draftConversion       = []     // líneas con campo estado ('pendiente'|'hecha'|'descartada')
let _lineaActualIndex      = null   // índice de la línea cargada en bloque 2

// ===== ESTADO DEL ASISTENTE DE BIENVENIDAS =====
let _modoColaBienvenidas = false
let _colaClienteIds      = []       // IDs de cliente en orden de envío
let _colaSaltadas        = new Set()
const hoy             = new Date().toISOString().split('T')[0]

// ===== REFERENCIAS DOM =====
const inputId      = document.getElementById('inputClientId')
const inputName    = document.getElementById('inputName')
const inputCompany = document.getElementById('inputCompany')
const inputPhone   = document.getElementById('inputPhone')
const inputEmail   = document.getElementById('inputEmail')
const inputAddress = document.getElementById('inputAddress')
const inputNif        = document.getElementById('inputNif')
const inputComments   = document.getElementById('inputComments')
const inputIsBusiness = document.getElementById('inputIsBusiness')
const inputCountry    = document.getElementById('inputCountry')
const autoList            = document.getElementById('autocompleteList')
const statusDiv           = document.getElementById('cliente-status')
const btnRenombrarCliente = document.getElementById('btnRenombrarCliente')

const selectServicio  = document.getElementById('selectServicio')
const selectProveedor = document.getElementById('selectProveedor')
const inputPlazas     = document.getElementById('inputPlazas')
const inputPrecio     = document.getElementById('inputPrecio')
const inputPrecioFinal = document.getElementById('inputPrecioFinal')
initPrecioInput(inputPrecio)
initPrecioInput(inputPrecioFinal)
initPrecioInput(document.getElementById('cobroImporte'))
const selectEstado    = document.getElementById('selectEstado')
const precioStatus    = document.getElementById('precio-status')
const btnAnadir       = document.getElementById('btnAnadirReserva')

// ===== BLOQUE 1: CLIENTE =====

servicios.forEach(s => {
    const opt = document.createElement('option')
    opt.value = s.id
    opt.textContent = s.service_code
    selectServicio.appendChild(opt)
})

// ===== AUTOCOMPLETE SERVICIO =====
const _svcById  = new Map((servicios ?? []).map(s => [s.id, s]))
const _inputSvc = document.getElementById('selectServicioInput')
const _listSvc  = document.getElementById('autocomplete-servicio-list')

// Si el HTML no tiene los elementos del autocomplete (p.ej. caché antigua), muestra el select nativo
if (!_inputSvc || !_listSvc) { selectServicio.style.display = '' }

function _syncServicioInput() {
    if (!_inputSvc) return
    const val = parseInt(selectServicio.value) || null
    _inputSvc.value = val ? (_svcById.get(val)?.service_code ?? '') : ''
}

if (_inputSvc && _listSvc) {
    function _showSvcList(filter) {
        const items = servicios.filter(s => !filter || s.service_code.toLowerCase().includes(filter.toLowerCase()))
        _listSvc.innerHTML = items.map(s => `<div data-id="${s.id}">${s.service_code}</div>`).join('')
        _listSvc.style.display = items.length ? 'block' : 'none'
    }

    _inputSvc.addEventListener('focus', () => _showSvcList(_inputSvc.value))
    _inputSvc.addEventListener('input', () => {
        _showSvcList(_inputSvc.value)
        if (!_inputSvc.value) { selectServicio.value = ''; selectServicio.dispatchEvent(new Event('change')) }
    })
    _listSvc.addEventListener('click', e => {
        const div = e.target.closest('[data-id]')
        if (!div) return
        selectServicio.value = div.dataset.id
        _listSvc.style.display = 'none'
        _inputSvc.value = div.textContent.trim()
        selectServicio.dispatchEvent(new Event('change'))
    })
    document.addEventListener('click', e => {
        if (!e.target.closest('#selectServicioInput') && !e.target.closest('#autocomplete-servicio-list'))
            _listSvc.style.display = 'none'
    })
}

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
            inputAddress.value = inputNif.value = ''
            document.getElementById('bloque-reservas-cliente').style.display = 'none'
            document.getElementById('bloque-cobros-cliente').style.display   = 'none'
            limpiarFormularioReserva()
        }
        clienteActual = null
        btnRenombrarCliente.style.display = 'none'
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
    inputNif.value          = cliente.nif        ?? ''
    inputComments.value     = cliente.comments   ?? ''
    inputIsBusiness.checked = cliente.is_business ?? false
    inputCountry.value      = cliente.country    ?? 'ES'
    document.getElementById('nif-inferencia-sugerencia').innerHTML = ''
    statusDiv.textContent = '✅ Cliente existente — los cambios se guardan automáticamente'
    statusDiv.style.color = 'var(--accent-ok)'
    btnRenombrarCliente.style.display = 'inline-flex'
    limpiarFormularioReserva()
    cargarReservasCliente(cliente.id)
}

function limpiarCamposCliente() {
    clienteActual = null
    inputName.value = inputCompany.value = inputPhone.value =
    inputEmail.value = inputComments.value = inputAddress.value = inputNif.value = ''
    inputIsBusiness.checked = false
    inputCountry.value      = 'ES'
    document.getElementById('nif-inferencia-sugerencia').innerHTML = ''
    statusDiv.textContent = ''
    btnRenombrarCliente.style.display = 'none'
    document.getElementById('bloque-reservas-cliente').style.display = 'none'
    document.getElementById('bloque-cobros-cliente').style.display   = 'none'
    ;['btnCancelar', 'btnEliminar', 'btnGenerarPropuesta', 'btnEnviarBienvenida'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = ''
    })
    limpiarFormularioReserva()
    actualizarBotonBienvenida()
}

btnRenombrarCliente?.addEventListener('click', () => {
    const idViejo = clienteActual.id
    abrirRenombrarId({
        tabla: 'clients', idActual: idViejo, supabase,
        onSuccess: nuevoId => {
            const c = todosClientes.find(c => c.id === idViejo)
            if (c) c.id = nuevoId
            clienteActual.id = nuevoId
            inputId.value    = nuevoId
            mostrarToast(`Cliente renombrado: ${nuevoId}`)
        }
    })
})

function limpiarFormularioReserva() {
    reservaEditandoId = null
    solicitudOriginRef = null
    selectServicio.value      = ''
    selectServicio.disabled   = false
    _syncServicioInput()
    selectProveedor.innerHTML = '<option value="">— Selecciona servicio primero —</option>'
    selectProveedor.disabled  = true
    inputPlazas.value  = ''
    setPrecioValue(inputPrecio, '')
    setPrecioValue(inputPrecioFinal, '')
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

const camposCliente = [inputName, inputCompany, inputPhone, inputEmail, inputAddress, inputComments]
const camposDB      = ['name', 'company', 'phone', 'email', 'address', 'comments']
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

// ── Autosave manual para campos no-texto ─────────────────────────────────────

function _notificarGuardado() {
    statusDiv.textContent = '✅ Guardado'
    statusDiv.style.color = 'var(--accent-ok)'
    setTimeout(() => { statusDiv.textContent = '✅ Cliente existente — los cambios se guardan automáticamente' }, 2000)
}

// Comprueba si cambiar el tipo fiscal del cliente es seguro.
// Retorna: 'ok' | 'bloqueado' | 'cancelado' | { chargesParaAnular: [...] }
async function _guardFiscalCliente() {
    if (!clienteActual) return 'ok'

    const { data: chargesFacturados } = await supabase
        .from('charges')
        .select('id, invoice_number, invoice_path, amount')
        .eq('client_id', clienteActual.id)
        .not('invoice_number', 'is', null)

    if (!chargesFacturados?.length) return 'ok'

    const chargeIds = chargesFacturados.map(c => c.id)
    const [{ data: issuedRows }, { data: closings }] = await Promise.all([
        supabase.from('issued_invoices')
            .select('charge_id, accrual_date')
            .in('charge_id', chargeIds)
            .eq('is_void', false),
        supabase.from('fiscal_closings')
            .select('year, quarter')
            .eq('model', 'F69')
            .not('presented_at', 'is', null),
    ])

    const closedSet = new Set((closings ?? []).map(c => `${c.year}-${c.quarter}`))
    const hayEnCerrado = (issuedRows ?? []).some(r => {
        if (!r.accrual_date) return false
        const [y, m] = r.accrual_date.split('-').map(Number)
        return closedSet.has(`${y}-${Math.ceil(m / 3)}`)
    })

    if (hayEnCerrado) {
        const trimestres = [...new Set(
            (issuedRows ?? [])
                .filter(r => {
                    if (!r.accrual_date) return false
                    const [y, m] = r.accrual_date.split('-').map(Number)
                    return closedSet.has(`${y}-${Math.ceil(m / 3)}`)
                })
                .map(r => {
                    const [y, m] = r.accrual_date.split('-').map(Number)
                    return `T${Math.ceil(m / 3)} ${y}`
                })
        )].join(', ')
        mostrarModalTrimCerrado(null, null,
            `Este cliente tiene facturas en trimestres ya presentados a Hacienda (${trimestres}).<br><br>
             Para corregirlas hace falta una <strong>factura rectificativa</strong>.`)
        return 'bloqueado'
    }

    // Modal con lista: Reemitir las que quiera, anular las que no reemita
    const reemitidas = new Set()

    function _renderFilas() {
        return chargesFacturados.map(c => {
            const done = reemitidas.has(c.id)
            return `<tr style="font-size:12px">
                <td style="padding:4px 8px;font-weight:600">${c.invoice_number}</td>
                <td style="padding:4px 8px;text-align:right">${fmt(c.amount)}</td>
                <td style="padding:4px 8px;text-align:right;white-space:nowrap">
                    ${done
                        ? `<span style="color:var(--accent-ok);font-size:11px">✅ Reemitida</span>`
                        : `<button class="btn btn-primary" style="font-size:11px;padding:2px 8px"
                               data-hito-id="${c.id}">Reemitir</button>`}
                </td>
            </tr>`
        }).join('')
    }

    return new Promise(resolve => {
        const { overlay, panel } = crearModal('modal-guard-fiscal-aviso', { narrow: true })

        function renderModal() {
            const pendientes = chargesFacturados.filter(c => !reemitidas.has(c.id)).length
            panel.innerHTML = `
                <div>
                    <div class="modal-header-title">⚠️ ${chargesFacturados.length} factura${chargesFacturados.length > 1 ? 's' : ''} emitida${chargesFacturados.length > 1 ? 's' : ''}</div>
                    <div class="modal-header-desc" style="margin-bottom:12px">
                        Al cambiar el tipo fiscal quedan incorrectas. Reemite las que quieras conservar.
                        <strong>Las que no reemitas se anularán y quedará un hueco en la numeración.</strong>
                    </div>
                </div>
                <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
                    <thead><tr style="font-size:11px;color:var(--subtle)">
                        <th style="text-align:left;padding:4px 8px">Nº factura</th>
                        <th style="text-align:right;padding:4px 8px">Importe</th>
                        <th style="padding:4px 8px"></th>
                    </tr></thead>
                    <tbody>${_renderFilas()}</tbody>
                </table>
                <div class="modal-actions">
                    <button id="guard-fiscal-cancel" class="btn btn-secondary">Cancelar cambio</button>
                    <button id="guard-fiscal-ok" class="btn btn-danger" autofocus>
                        ${pendientes > 0 ? `Aceptar y anular ${pendientes}` : 'Aceptar cambio'}
                    </button>
                </div>`

            panel.querySelectorAll('[data-hito-id]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const hitoId  = parseInt(btn.dataset.hitoId)
                    const esSfcom = h => !!(h.comments?.startsWith('WEB') && h.comments?.includes('Cobrado v'))
                    const hitoTemp = hitosClienteTemp.find(h => h.id === hitoId)
                    if (!hitoTemp) return
                    const reservasParaFactura = reservasCliente.filter(r => !r.origin_ref?.startsWith('WEB'))
                    const hitosParaFactura    = hitosClienteTemp.filter(h => h.id && !esSfcom(h))
                    const reservasConCharges  = reservasParaFactura.map(r => ({
                        ...r, _charges: hitosParaFactura, _esFinal: hitoTemp.esFinal ?? false
                    }))
                    await abrirPanelReemision(hitoId, clienteActual, reservasConCharges)
                })
            })

            panel.querySelector('#guard-fiscal-cancel').onclick = () => { overlay.close(); resolve('cancelado') }
            panel.querySelector('#guard-fiscal-ok').onclick = () => {
                const parAnular = chargesFacturados.filter(c => !reemitidas.has(c.id))
                overlay.close()
                resolve({ chargesParaAnular: parAnular })
            }
        }

        renderModal()

        function onFacturaEmitida(e) { reemitidas.add(e.detail.hitoId); renderModal() }
        document.addEventListener('facturaEmitida', onFacturaEmitida)
        overlay.addEventListener('close', () => document.removeEventListener('facturaEmitida', onFacturaEmitida))
    })
}

// Anula las facturas de los charges indicados: borra asiento fiscal, PDF y limpia campos del hito.
// NUNCA borra la fila del charge — solo pone a null sus campos de facturación.
async function _anularFacturas(charges) {
    for (const c of charges) {
        const { data: issued } = await supabase
            .from('issued_invoices').select('id')
            .eq('charge_id', c.id).eq('is_void', false).maybeSingle()
        if (issued) {
            await supabase.from('issued_invoice_vat_lines').delete().eq('invoice_id', issued.id)
            await supabase.from('issued_invoices').delete().eq('id', issued.id)
        }
        if (c.invoice_path) await supabase.storage.from('invoices').remove([c.invoice_path])
        await supabase.from('charges').update({
            invoice_number: null, invoice_path: null, invoiced: false, invoiced_at: null,
        }).eq('id', c.id)
    }
}

inputIsBusiness.addEventListener('change', async () => {
    if (!clienteActual) return
    const newVal = inputIsBusiness.checked
    const result = await _guardFiscalCliente()
    if (result === 'bloqueado' || result === 'cancelado') { inputIsBusiness.checked = clienteActual.is_business ?? false; return }
    const { error } = await supabase.from('clients').update({ is_business: newVal }).eq('id', clienteActual.id)
    if (error) { console.error('Error guardando is_business:', error); inputIsBusiness.checked = clienteActual.is_business ?? false; return }
    clienteActual.is_business = newVal
    _notificarGuardado()
    actualizarTotal()
    const parAnular = typeof result === 'object' ? result.chargesParaAnular : []
    if (parAnular.length) { await _anularFacturas(parAnular); cargarReservasCliente(clienteActual.id) }
})

inputCountry.addEventListener('change', async () => {
    if (!clienteActual) return
    const newVal = inputCountry.value.trim().toUpperCase() || 'ES'
    inputCountry.value = newVal
    const result = await _guardFiscalCliente()
    if (result === 'bloqueado' || result === 'cancelado') { inputCountry.value = clienteActual.country ?? 'ES'; return }
    const { error } = await supabase.from('clients').update({ country: newVal }).eq('id', clienteActual.id)
    if (error) { console.error('Error guardando country:', error); inputCountry.value = clienteActual.country ?? 'ES'; return }
    clienteActual.country = newVal
    _notificarGuardado()
    actualizarTotal()
    const parAnular = typeof result === 'object' ? result.chargesParaAnular : []
    if (parAnular.length) { await _anularFacturas(parAnular); cargarReservasCliente(clienteActual.id) }
})

// Inferencia fiscal a partir del NIF — propone is_business y country, nunca los cambia sola
function _inferirFiscalDesdeNif(nif) {
    const n = nif.trim().toUpperCase()
    if (/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(n)) return { is_business: true,  country: 'ES' }  // CIF
    if (/^\d{8}[TRWAGMYFPDXBNJZSQVHLCKE]$/.test(n))       return { is_business: false, country: 'ES' }  // DNI
    if (/^[XYZ]\d{7}[TRWAGMYFPDXBNJZSQVHLCKE]$/.test(n))  return { is_business: false, country: 'ES' }  // NIE
    return { is_business: false, country: 'XX' }  // extranjero
}

inputNif.addEventListener('change', () => {
    const divSug = document.getElementById('nif-inferencia-sugerencia')
    if (!divSug) return
    divSug.innerHTML = ''
    const nif = inputNif.value.trim()
    if (!nif || !clienteActual) return

    const inferido    = _inferirFiscalDesdeNif(nif)
    const bizActual   = clienteActual.is_business ?? false
    const paisActual  = clienteActual.country     ?? 'ES'
    if (inferido.is_business === bizActual && inferido.country === paisActual) return

    const etiqueta = inferido.is_business        ? 'empresa española (CIF)'  :
                     inferido.country === 'XX'   ? 'NIF extranjero'          : 'particular español'
    divSug.innerHTML =
        `<span style="color:var(--accent)">⚠️ ${etiqueta} detectado.</span> ` +
        `<a href="#" id="btn-nif-aplicar" style="color:var(--accent-ok)">Aplicar</a>`

    document.getElementById('btn-nif-aplicar')?.addEventListener('click', async e => {
        e.preventDefault()
        const result = await _guardFiscalCliente()
        if (result === 'bloqueado' || result === 'cancelado') { divSug.innerHTML = ''; return }
        inputIsBusiness.checked = inferido.is_business
        inputCountry.value      = inferido.country
        divSug.innerHTML        = ''
        const { error } = await supabase.from('clients')
            .update({ is_business: inferido.is_business, country: inferido.country })
            .eq('id', clienteActual.id)
        if (error) { console.error('Error aplicando inferencia NIF:', error); return }
        clienteActual.is_business = inferido.is_business
        clienteActual.country     = inferido.country
        actualizarTotal()
        const parAnular = typeof result === 'object' ? result.chargesParaAnular : []
        if (parAnular.length) { await _anularFacturas(parAnular); cargarReservasCliente(clienteActual.id) }
    })
})

// Guardado de NIF con guard fiscal (separado de initAutoSave para poder interceptar)
inputNif.addEventListener('change', async () => {
    if (!clienteActual) return
    const newVal = inputNif.value.trim() || null
    const result = await _guardFiscalCliente()
    if (result === 'bloqueado' || result === 'cancelado') { inputNif.value = clienteActual.nif ?? ''; return }
    const { error } = await supabase.from('clients').update({ nif: newVal }).eq('id', clienteActual.id)
    if (error) {
        statusDiv.textContent = '❌ Error: ' + error.message
        statusDiv.style.color = 'var(--accent)'
        inputNif.value = clienteActual.nif ?? ''
        return
    }
    clienteActual.nif = newVal
    _notificarGuardado()
    const parAnular = typeof result === 'object' ? result.chargesParaAnular : []
    if (parAnular.length) { await _anularFacturas(parAnular); cargarReservasCliente(clienteActual.id) }
})

// Guarda un cliente nuevo en la BBDD sin necesidad de añadir una reserva
// Se llama desde el enlace del statusDiv cuando el ID no existe en la BBDD
window.guardarClienteNuevo = async function(e) {
    e.preventDefault()
    const clienteId = normalizarId(inputId.value)
    if (!clienteId) return

    const { error } = await supabase.from('clients').insert({
        id:          clienteId,
        name:        inputName.value.trim()     || null,
        company:     inputCompany.value.trim()  || null,
        phone:       inputPhone.value.trim()    || null,
        email:       inputEmail.value.trim()    || null,
        address:     inputAddress.value.trim()  || null,
        nif:         inputNif.value.trim()      || null,
        comments:    inputComments.value.trim() || null,
        is_business: inputIsBusiness.checked,
        country:     inputCountry.value.trim().toUpperCase() || 'ES',
    })
    if (error) { alert('Error al guardar el cliente: ' + error.message); return }

    clienteActual = {
        id: clienteId, name: inputName.value.trim() || null,
        is_business: inputIsBusiness.checked,
        country:     inputCountry.value.trim().toUpperCase() || 'ES',
    }
    todosClientes.push(clienteActual)
    statusDiv.innerHTML = ''
    statusDiv.textContent = '✅ Cliente guardado — los cambios se guardan automáticamente'
    statusDiv.style.color = 'var(--accent-ok)'
}

// ===== BLOQUE 2: RESERVA =====

function _svcCode(id) {
    const intId = typeof id === 'string' ? parseInt(id) : id
    return servicios.find(s => s.id === intId)?.service_code ?? id
}

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
        if (reservaActual && parseInt(selectServicio.value) !== reservaActual.service_id) {
            const servicioNuevo = selectServicio.value
            const decision      = await _preguntarCambioServicio(reservaEditandoId, _svcCode(servicioNuevo), _svcCode(reservaActual.service_id))
            if (decision === null) { selectServicio.value = reservaActual.service_id; _syncServicioInput(); return }
            if (decision === 'nueva') { limpiarFormularioReserva(); selectServicio.value = servicioNuevo; _syncServicioInput() }
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

// "Precio final facturado" es un ayudante: convierte hacia atrás al precio sin IVA/IRPF
// (el único que se persiste). _sincronizandoPrecioFinal evita que actualizarTotal()
// sobrescriba este campo mientras Paula está tecleando en él.
let _sincronizandoPrecioFinal = false

inputPrecioFinal.addEventListener('input', () => {
    const totalFacturado = parseFloat(inputPrecioFinal.value)
    const irpfRate       = irpfRateParaCliente(clienteActual)
    _sincronizandoPrecioFinal = true
    setPrecioValue(inputPrecio, isNaN(totalFacturado) ? '' : baseDesdeTotalFacturado(totalFacturado, irpfRate))
    validarPrecio()
    actualizarTotal()
    actualizarBtnAnadir()
    _sincronizandoPrecioFinal = false
})

selectProveedor.addEventListener('change', () => {
    validarPrecio()
    actualizarBtnAnadir()
    actualizarBloque3()

    // Si el proveedor seleccionado no tiene plazas suficientes, lanzar el dialog
    // de reorganización igual que si se hubiera pulsado en la cajita del panel
    const proveedorId = selectProveedor.value
    const servicioId  = parseInt(selectServicio.value) || null
    const plazas      = parseInt(inputPlazas.value) || 0
    if (proveedorId && servicioId && plazas > 0) {
        const { libres } = getPlazasInfo(proveedorId, servicioId, reservaEditandoId)
        if (libres < plazas) abrirPanelReorganizar(proveedorId, servicioId, plazas)
    }
})

function actualizarTotal() {
    const plazas   = parseInt(inputPlazas.value) || 0
    const precio   = getPrecioValue(inputPrecio)
    const total    = plazas * precio
    const irpfRate = irpfRateParaCliente(clienteActual)
    document.getElementById('inputTotal').value =
        total > 0 ? total.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }) : '—'
    if (!_sincronizandoPrecioFinal)
        setPrecioValue(inputPrecioFinal, precio > 0 ? totalFacturadoDesdeBase(precio, irpfRate) : '')
}

async function _limpiarPropuestaReserva(row) {
    if (!row.proposal_number && !row.proposal_path) return
    const { error } = row.proposal_number
        ? await supabase.from('reservations').update({ proposal_number: null, proposal_path: null }).eq('proposal_number', row.proposal_number)
        : await supabase.from('reservations').update({ proposal_number: null, proposal_path: null }).eq('proposal_path', row.proposal_path)
    if (error) console.error('Error limpiando propuesta:', error)
}

function getPlazasInfo(venueId, servicioId, excluirId = null) {
    const reservasPS  = todasReservas.filter(r =>
        r.venue_id   === venueId    &&
        r.service_id === servicioId &&
        r.status     !== 'Cancelada' &&
        r.id         !== excluirId
    )
    const confirmadas = reservasPS.filter(r => r.status === 'Confirmada').reduce((s, r) => s + r.slots, 0)
    const pendientes  = reservasPS.filter(r => r.status === 'Pendiente').reduce((s, r) => s + r.slots, 0)
    const disp        = disponibilidad.find(d => d.venue_id === venueId && d.service_id === servicioId)
    const total       = disp?.total_slots ?? 0
    const libres      = total - confirmadas - pendientes
    return { total, confirmadas, pendientes, libres }
}

function actualizarProveedores() {
    const servicioId      = parseInt(selectServicio.value) || null
    const plazas          = parseInt(inputPlazas.value) || 0
    const proveedorActual = selectProveedor.value

    selectProveedor.innerHTML = '<option value="">— Selecciona proveedor —</option>'
    if (!servicioId) { selectProveedor.disabled = true; return }

    const dispServicio = disponibilidad.filter(d => d.service_id === servicioId)
    if (dispServicio.length === 0) { selectProveedor.disabled = true; return }

    selectProveedor.disabled = false

    dispServicio.forEach(d => {
        const { total, pendientes, libres } = getPlazasInfo(d.venue_id, servicioId, reservaEditandoId)
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
        opt.value       = d.venue_id
        opt.textContent = `${d.venue_id} (${libres}/${total})${simbolo ? ' ' + simbolo : ''}`
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
        } else if (plazas > 0) {
            mostrarToast(`ℹ️ ${proveedorActual} no tiene capacidad para ${plazas} plaza${plazas !== 1 ? 's' : ''} — selecciona otro proveedor`)
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
    const servicioId  = parseInt(selectServicio.value) || null
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

    const disp = disponibilidad.find(d => d.service_id === servicioId && d.venue_id === proveedorId)
    if (!disp) return

    if (disp.billing_model === 'fixed') {
        const fixedCost = parseFloat(disp.price_per_slot) || 0
        const plazas    = parseInt(inputPlazas.value) || 0
        const ingresoExistente = todasReservas
            .filter(r => r.venue_id    === proveedorId &&
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
        precioStatus.textContent = `❌ Por debajo del coste (${fmt(coste)}/plaza)`
    } else if (precio === coste) {
        inputPrecio.className    = 'warn'
        precioStatus.style.color = 'var(--accent-warn)'
        precioStatus.textContent = `⚠️ Al coste exacto, sin margen`
    } else if (margen < 0.15) {
        inputPrecio.className    = 'warn'
        precioStatus.style.color = 'var(--accent-warn)'
        precioStatus.textContent = `⚠️ Margen bajo — coste: ${fmt(coste)}/plaza`
    } else {
        inputPrecio.className    = 'ok'
        precioStatus.style.color = 'var(--accent-ok)'
        precioStatus.textContent = `✅ Margen OK — coste: ${fmt(coste)}/plaza`
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
    if (_servicioIds.length === 0) return
    const { data: reservasRaw } = await supabase
        .from('reservations')
        .select('*, services(description, name, day), venues(display_name)')
        .eq('client_id', clienteId)
        .in('service_id', _servicioIds)
        .order('id')
    const reservas = (reservasRaw ?? []).map(r => ({
        ...r,
        service_description:  r.services?.description  ?? null,
        service_name:         r.services?.name         ?? null,
        service_day:          r.services?.day          ?? null,
        venue_display_name:   r.venues?.display_name   ?? null,
        services: undefined,
        venues:   undefined
    }))

    // Sincronizar todasReservas con datos frescos del cliente cargado
    todasReservas = [
        ...todasReservas.filter(r => r.client_id !== clienteId),
        ...reservas
    ]

    const bloque = document.getElementById('bloque-reservas-cliente')

    if (clienteId === 'SFCOM') {
        const sfcomReservas = todasReservas.filter(r => r.origin_ref?.startsWith('WEB') && r.status !== 'Cancelada')
        const totalVentas   = sfcomReservas.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
        const virtualRow = {
            id: 'SFCOM_CANAL', client_id: 'SFCOM',
            service_id: 'Canal sfcom', venue_id: `${sfcomReservas.length} reservas`,
            slots: sfcomReservas.length, price_per_slot: null,
            total_amount: totalVentas.toFixed(2),
            status: 'Confirmada', proposal_number: null
        }
        reservasCliente = [virtualRow]
        bloque.style.display = 'block'
        renderTablaReservas()
        document.getElementById('btnCancelar').style.display      = 'none'
        document.getElementById('btnEliminar').style.display      = 'none'
        document.getElementById('btnGenerarPropuesta').style.display = 'none'
        document.getElementById('btnEnviarBienvenida').style.display = 'none'
        await cargarCobrosCliente(clienteId, reservasCliente)
        return
    }

    if (!reservas || reservas.length === 0) {
        bloque.style.display = 'none'
        document.getElementById('bloque-cobros-cliente').style.display = 'none'
        return
    }

    reservasCliente = reservas
    bloque.style.display = 'block'
    renderTablaReservas()
    await cargarCobrosCliente(clienteId, reservas)
    actualizarBotonBienvenida()
}

function renderTablaReservas() {
    const cols = [
        { label: 'ID',          campo: 'id' },
        { label: 'Servicio',    campo: 'service_id' },
        { label: 'Venue',       campo: 'venue_id' },
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
            <td>${servicios.find(s => s.id === r.service_id)?.service_code ?? '—'}</td>
            <td>${r.venue_id}</td>
            <td>${r.slots}</td>
            <td>${r.price_per_slot != null ? fmt(r.price_per_slot) : '—'}</td>
            <td>${fmt(r.total_amount)}</td>
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
    _syncServicioInput()
    actualizarProveedores()

    setTimeout(() => {
        selectProveedor.value = reserva.venue_id
        validarPrecio()
        actualizarBloque3()
        actualizarBtnAnadir()
    }, 50)

    inputPlazas.value  = reserva.slots
    setPrecioValue(inputPrecio, reserva.price_per_slot)
    selectEstado.value = reserva.status
    document.getElementById('inputReservaComments').value = reserva.comments ?? ''
    document.getElementById('titulo-bloque-reserva').textContent = `✏️ Editando ${reserva.id}`
    actualizarTotal()
    actualizarBtnAnadir()

    btnAnadir.textContent = '💾 Guardar cambios'
    document.getElementById('btnCancelarEdicion').style.display = 'inline-block'
    document.getElementById('bloque-reserva').scrollIntoView({ behavior: 'smooth' })
}

async function _syncAndWarn(venueId, servicioId) {
    const sr = await syncStockToSfcom(supabase, venueId, servicioId)
    if (sr?.sobrereserva) mostrarToast(`⚠️ Sobrereserva en ${sr.serviceName ?? venueId}: más reservas que plazas disponibles`)
    if (sr && !sr.ok) mostrarToast(`⚠️ Error al sincronizar stock sfcom (${venueId}/${servicioId}): ${sr.error ?? 'error desconocido'}`)
}

async function cambiarEstadoSeleccionadas(nuevoEstado) {
    const ids = [...document.querySelectorAll('.chk-reserva:checked')]
        .map(chk => chk.closest('tr').dataset.id)
    if (ids.length === 0) return

    const afectadas = [...new Map(
        todasReservas.filter(r => ids.includes(r.id))
            .map(r => [`${r.venue_id}|${r.service_id}`, { venueId: r.venue_id, servicioId: r.service_id }])
    ).values()]

    // Modal consultivo cuando el cambio altera el conteo de reservas activas en sfcom.
    // pairsConCambio recoge solo los pares con delta real — Pendiente↔Confirmada no aparece.
    let pairsConCambio = []
    let sfcomResultEstado = 'sync'
    if (nuevoEstado === 'Cancelada') {
        // Cancelar reservas activas → stock sube (deltas negativos de plazas activas)
        pairsConCambio = [...new Map(
            todasReservas.filter(r => ids.includes(r.id) && r.status !== 'Cancelada')
                .map(r => [`${r.venue_id}|${r.service_id}`, { venueId: r.venue_id, serviceId: r.service_id }])
        ).values()].map(p => {
            const activas    = todasReservas.filter(r => ids.includes(r.id) && r.venue_id === p.venueId && r.service_id === p.serviceId && r.status !== 'Cancelada')
            const allDelta   = -activas.reduce((s, r) => s + (r.slots ?? 0), 0)
            const sfcomDelta = -activas.filter(r => r.origin_ref?.startsWith('WEB')).reduce((s, r) => s + (r.slots ?? 0), 0)
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
                .map(r => [`${r.venue_id}|${r.service_id}`, { venueId: r.venue_id, serviceId: r.service_id }])
        ).values()].map(p => {
            const reactivadas = todasReservas.filter(r => ids.includes(r.id) && r.venue_id === p.venueId && r.service_id === p.serviceId && r.status === 'Cancelada')
            const allDelta    = reactivadas.reduce((s, r) => s + (r.slots ?? 0), 0)
            const sfcomDelta  = reactivadas.filter(r => r.origin_ref?.startsWith('WEB')).reduce((s, r) => s + (r.slots ?? 0), 0)
            return { ...p, sfcomDelta, allDelta }
        })
        // Verificar capacidad interna antes de permitir la reactivación
        const sinCapacidad = pairsConCambio
            .filter(p => p.allDelta > 0)
            .map(p => {
                const { libres } = getPlazasInfo(p.venueId, p.serviceId)
                return libres < p.allDelta
                    ? { pair: p, libres, reserva: todasReservas.find(r => ids.includes(r.id) && r.status === 'Cancelada' && r.venue_id === p.venueId && r.service_id === p.serviceId) }
                    : null
            })
            .filter(Boolean)
        if (sinCapacidad.length > 0) {
            const primera = sinCapacidad[0]
            await new Promise(resolve => {
                const { overlay, panel: mp } = crearModal('modal-sin-capacidad', { narrow: true })
                mp.innerHTML = `
                    <h2 style="margin-bottom:12px">Sin plazas disponibles</h2>
                    <p style="font-size:13px;color:var(--text);margin-bottom:8px">
                        No hay plazas suficientes en <strong>${primera.pair.venueId}</strong> / <strong>${primera.pair.serviceId}</strong>
                        (disponibles: ${primera.libres}, necesarias: ${primera.pair.allDelta}).
                    </p>
                    <p style="font-size:13px;color:var(--text);margin-bottom:16px">
                        Se abre <strong>${primera.reserva?.id ?? 'la reserva'}</strong> en modo edición para que reasignes el venue.
                        Si cancelas la edición, la reserva permanece cancelada.
                    </p>
                    <div style="display:flex;gap:8px;justify-content:flex-end">
                        <button id="btn-sc-ok" class="btn btn-primary">Entendido</button>
                    </div>`
                mp.querySelector('#btn-sc-ok').addEventListener('click', () => { overlay.close(); resolve() })
                overlay.addEventListener('close', resolve)
            })
            if (primera.reserva) {
                cargarReservaEnFormulario(primera.reserva)
                selectEstado.value = nuevoEstado
            }
            return
        }
        for (const p of pairsConCambio) {
            if (p.allDelta <= 0) continue
            const sfcomResult = await checkAvailabilityBeforeSave(supabase, p.venueId, p.serviceId, p.allDelta)
            if (sfcomResult.sfcomCheck && sfcomResult.warning) {
                if (!confirm(`Aviso de sfcom:\n\n${sfcomResult.warning}\n\n¿Deseas continuar igualmente?`)) return
            }
        }
        if (pairsConCambio.length > 0) {
            sfcomResultEstado = await confirmarStockSfcom(supabase, pairsConCambio)
            if (sfcomResultEstado === 'cancel') return
        }
    }

    const haySfcomEstado = todasReservas.some(r => ids.includes(r.id) && r.origin_ref?.startsWith('WEB'))
    const { error } = await supabase.from('reservations').update({ status: nuevoEstado }).in('id', ids)
    if (!error && clienteActual) {
        if (nuevoEstado === 'Cancelada') {
            const sfcomCanceladas = todasReservas.filter(r => ids.includes(r.id) && r.origin_ref?.startsWith('WEB'))
            for (const r of sfcomCanceladas) {
                await supabase.from('charges').delete()
                    .eq('client_id', r.client_id)
                    .eq('comments', `${r.origin_ref} Cobrado vía sfcom`)
            }
        }
        todasReservas = todasReservas.map(r =>
            ids.includes(r.id) ? { ...r, status: nuevoEstado } : r
        )
        await persistirCobrosCliente(supabase, clienteActual.id, todasReservas)
        if (haySfcomEstado) await persistirCobrosCliente(supabase, 'SFCOM', todasReservas)
        const pairsConCambioSet = new Set(pairsConCambio.map(p => `${p.venueId}|${p.serviceId}`))
        for (const { venueId, servicioId } of afectadas) {
            const provId = _getProviderIdFromVenue(venueId)
            if (provId) await persistirPagosProveedor(supabase, provId, todasReservas, disponibilidad)
            if (pairsConCambioSet.has(`${venueId}|${servicioId}`) && sfcomResultEstado === 'sync') {
                await _syncAndWarn(venueId, servicioId)
            }
        }
        cargarReservasCliente(clienteActual.id)
        actualizarProveedores()
    }
}

function _modalEliminacionUltimaReserva(clienteId, conHistorial) {
    return new Promise(resolve => {
        const { overlay, panel } = crearModal('modal-elim-ultima', { narrow: true })
        if (conHistorial.length > 0) {
            const facturas = conHistorial.filter(c => c.invoice_number).length
            const cobrados = conHistorial.filter(c => c.collected && !c.invoice_number).length
            const desc = [
                facturas > 0 && `${facturas} cobro(s) facturado(s)`,
                cobrados > 0 && `${cobrados} cobro(s) recibido(s) sin facturar`
            ].filter(Boolean).join(' y ')
            panel.innerHTML = `
                <h2 style="color:var(--accent);margin-bottom:12px">⚠️ Última reserva — cobros con historial</h2>
                <p style="margin-bottom:8px">Es la última reserva activa de <strong>${clienteId}</strong>.</p>
                <p style="font-size:13px;color:var(--text);margin-bottom:16px">
                    El cliente tiene ${desc}. Se recomienda resolver el historial (ej: nota de crédito) antes de eliminar.
                </p>
                <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button id="btn-elim-cancelar" class="btn btn-primary" autofocus>Cancelar</button>
                    <button id="btn-elim-cobros" class="btn btn-secondary" style="border-color:var(--accent);color:var(--accent)">Eliminar reserva y cobros</button>
                    <button id="btn-elim-todo" class="btn btn-secondary" style="border-color:var(--accent);color:var(--accent)">Eliminar Todo (incl. cliente)</button>
                </div>`
            panel.querySelector('#btn-elim-cancelar').addEventListener('click', () => { overlay.close(); resolve('cancelar') })
            panel.querySelector('#btn-elim-cobros').addEventListener('click', () => { overlay.close(); resolve('reserva-y-cobros') })
            panel.querySelector('#btn-elim-todo').addEventListener('click', () => { overlay.close(); resolve('todo') })
        } else {
            panel.innerHTML = `
                <h2 style="margin-bottom:12px">Última reserva de ${clienteId}</h2>
                <p style="font-size:13px;color:var(--text);margin-bottom:16px">Esta es la última reserva activa del cliente.</p>
                <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button id="btn-elim-cancelar" class="btn btn-secondary">Cancelar</button>
                    <button id="btn-elim-solo" class="btn btn-primary">Eliminar reserva</button>
                    <button id="btn-elim-cliente" class="btn btn-danger">Eliminar reserva y cliente</button>
                </div>`
            panel.querySelector('#btn-elim-cancelar').addEventListener('click', () => { overlay.close(); resolve('cancelar') })
            panel.querySelector('#btn-elim-solo').addEventListener('click', () => { overlay.close(); resolve('solo-reserva') })
            panel.querySelector('#btn-elim-cliente').addEventListener('click', () => { overlay.close(); resolve('reserva-y-cliente') })
        }
    })
}

async function eliminarSeleccionadas() {
    const ids = [...document.querySelectorAll('.chk-reserva:checked')]
        .map(chk => chk.closest('tr').dataset.id)
    if (ids.length === 0) return

    // Pre-check: ¿será la última reserva activa del cliente?
    const isLastReservation = clienteActual !== null &&
        todasReservas.filter(r => r.client_id === clienteActual.id && r.status !== 'Cancelada' && !ids.includes(r.id)).length === 0

    let decisionElim = null
    if (isLastReservation) {
        const { data: cargos } = await supabase.from('charges').select('id, collected, invoice_number').eq('client_id', clienteActual.id).eq('season', getTemporadaActiva())
        const conHistorial = (cargos ?? []).filter(c => c.collected || c.invoice_number)
        decisionElim = await _modalEliminacionUltimaReserva(clienteActual.id, conHistorial)
        if (decisionElim === 'cancelar') return
    } else {
        if (!confirm(`¿Eliminar ${ids.length} reserva(s) definitivamente?`)) return
    }

    // Modal consultivo: eliminar reservas activas sube el stock en sfcom
    const pairsParaModal = [...new Map(
        todasReservas.filter(r => ids.includes(r.id) && r.status !== 'Cancelada')
            .map(r => [`${r.venue_id}|${r.service_id}`, { venueId: r.venue_id, serviceId: r.service_id }])
    ).values()].map(p => {
        const activas    = todasReservas.filter(r => ids.includes(r.id) && r.venue_id === p.venueId && r.service_id === p.serviceId && r.status !== 'Cancelada')
        const allDelta   = -activas.reduce((s, r) => s + (r.slots ?? 0), 0)
        const sfcomDelta = -activas.filter(r => r.origin_ref?.startsWith('WEB')).reduce((s, r) => s + (r.slots ?? 0), 0)
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
            const key  = `${r.venue_id}|${r.service_id}`
            const prev = map.get(key)
            map.set(key, {
                venueId:    r.venue_id,
                servicioId: r.service_id,
                cancelada:  prev ? (prev.cancelada && r.status === 'Cancelada') : r.status === 'Cancelada'
            })
            return map
        }, new Map()).values()]

    const haySfcomEliminado = todasReservas.some(r => ids.includes(r.id) && r.origin_ref?.startsWith('WEB'))
    const { error: errReservas } = await supabase.from('reservations').delete().in('id', ids)
    if (errReservas) { alert('Error al borrar reservas: ' + errReservas.message); return }

    todasReservas = todasReservas.filter(r => !ids.includes(r.id))

    if (clienteActual) {
        if (isLastReservation) {
            await supabase.from('charges').delete().eq('client_id', clienteActual.id)
            if (decisionElim === 'reserva-y-cliente' || decisionElim === 'todo') {
                await supabase.from('clients').delete().eq('id', clienteActual.id)
                todosClientes.splice(todosClientes.findIndex(c => c.id === clienteActual.id), 1)
                limpiarCamposCliente()
                inputId.value = ''
                if (haySfcomEliminado) await persistirCobrosCliente(supabase, 'SFCOM', todasReservas)
                return
            }
        } else {
            await persistirCobrosCliente(supabase, clienteActual.id, todasReservas)
        }
        if (haySfcomEliminado) await persistirCobrosCliente(supabase, 'SFCOM', todasReservas)
    }

    for (const { venueId, servicioId, cancelada } of afectadas) {
        const provId = _getProviderIdFromVenue(venueId)
        if (provId) await persistirPagosProveedor(supabase, provId, todasReservas, disponibilidad)
        if (!cancelada && sfcomResultElim === 'sync') {
            await _syncAndWarn(venueId, servicioId)
        }
    }

    limpiarFormularioReserva()
    await cargarReservasCliente(clienteActual.id)
    actualizarProveedores()
}

document.getElementById('btnCancelar').addEventListener('click', () => confirmarSiTemporadaNoActiva('el cambio de estado de la reserva', () => cambiarEstadoSeleccionadas('Cancelada')))
document.getElementById('btnEliminar').addEventListener('click', () => confirmarSiTemporadaNoActiva('la eliminación de la reserva', eliminarSeleccionadas))
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

// ===== BIENVENIDA AL CLIENTE =====

// Días naturales entre hoy y el 6 de julio del año en curso.
// Nunca salta al año siguiente (a diferencia de fechaCobroDefault), porque
// durante y tras San Fermín seguimos en el caso "ya estamos en San Fermín".
function diasParaSanFermin() {
    const hoy = new Date()
    const hoyMidnight = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
    const sf = new Date(hoy.getFullYear(), 6, 6)
    return Math.round((sf - hoyMidnight) / 864e5)
}

function componerMensajeBienvenida(cliente, reservasIncluidas, pendientesNoMarcadas, disponibilidad, { lang = 'es', incluirNotaPendientes = false } = {}) {
    const nombre = cliente.name || cliente.id
    const dias   = diasParaSanFermin()
    const plural = reservasIncluidas.length > 1

    let intro
    if (dias > 1) {
        intro = plural
            ? `¡Hola ${nombre}!\n\nQuedan ${dias} días para San Fermín 🎉 Queremos dejarte ya toda la información de tus experiencias para que las tengas a mano.`
            : `¡Hola ${nombre}!\n\nQuedan ${dias} días para San Fermín 🎉 Queremos dejarte ya toda la información de tu experiencia para que la tengas a mano.`
    } else if (dias === 1) {
        intro = plural
            ? `¡Hola ${nombre}!\n\n¡Mañana empieza San Fermín! 🔴⚪ Te dejamos otra vez los detalles de tus experiencias para que lo tengas todo claro:`
            : `¡Hola ${nombre}!\n\n¡Mañana empieza San Fermín! 🔴⚪ Te dejamos otra vez los detalles de tu experiencia para que lo tengas todo claro:`
    } else {
        intro = plural
            ? `¡Hola ${nombre}!\n\n¡Ya estamos en San Fermín! 🎉 Te dejamos toda la información de tus experiencias confirmadas:`
            : `¡Hola ${nombre}!\n\n¡Ya estamos en San Fermín! 🎉 Te dejamos toda la información de tu experiencia confirmada:`
    }

    const bloques = reservasIncluidas.map(r => {
        const srv  = servicios.find(s => s.id === r.service_id)
        const disp = disponibilidad.find(d => d.venue_id === r.venue_id && d.service_id === r.service_id)
        const nombreEvento = srv?.name ?? srv?.service_code ?? '—'
        const dia          = srv?.day   ?? '?'
        const hora         = srv?.start_time ?? '?'
        const venue        = disp?.venue_display_name ?? r.venue_id
        const direccion    = disp?.venue_address ?? null
        const acceso       = disp?.access_instructions ?? null

        let bloque = `📍 ${nombreEvento} — ${dia} de julio, ${hora}h\n${venue}${direccion ? ` (${direccion})` : ''}\n${r.slots} personas`
        if (acceso) bloque += `\n\nCómo llegar e instrucciones de acceso:\n${acceso}`
        return bloque
    })

    const cierre = `Cualquier duda, aquí me tienes.\n\nUn abrazo,\nPaula\nExperiencias San Fermín`
    const sep    = bloques.length > 1 ? '\n\n— — — — —\n\n' : '\n\n'
    let texto = `${intro}\n\n${bloques.join(sep)}\n\n${cierre}`

    if (incluirNotaPendientes && pendientesNoMarcadas.length > 0) {
        if (pendientesNoMarcadas.length === 1) {
            const r            = pendientesNoMarcadas[0]
            const srv          = servicios.find(s => s.id === r.service_id)
            const nombreEvento = srv?.name ?? srv?.service_code ?? '—'
            const dia          = srv?.day  ?? '?'
            texto += `\n\n—\nPor cierto, sigue pendiente de confirmar tu reserva de ${nombreEvento} (${dia} de julio). Si sigues interesado/a, escríbenos y te la confirmamos.`
        } else {
            const lista = pendientesNoMarcadas.map(r => {
                const srv = servicios.find(s => s.id === r.service_id)
                return `- ${srv?.name ?? srv?.service_code ?? '—'} (${srv?.day ?? '?'} de julio)`
            }).join('\n')
            texto += `\n\n—\nPor cierto, tienes estas reservas pendientes de confirmar:\n${lista}\nSi sigues interesado/a, escríbenos y te las confirmamos.`
        }
    }

    return texto
}

const WELCOME_SKIP_SENTINEL = '0001-01-01T00:00:00.000Z'
const _isWelcomeSkipped = r => r.welcome_sent_at?.startsWith('0001-01-01')

function actualizarBotonBienvenida() {
    const btn      = document.getElementById('btnEnviarBienvenida')
    const statusEl = document.getElementById('bienvenida-status')
    if (!btn) return

    if (!clienteActual) { btn.style.display = 'none'; return }

    const resDelCliente = todasReservas.filter(r => r.client_id === clienteActual.id)
    const tieneActivas  = resDelCliente.some(r => r.status === 'Confirmada' || r.status === 'Pendiente')
    btn.style.display   = tieneActivas ? 'flex' : 'none'

    if (!statusEl) return
    const confirmadas = resDelCliente.filter(r => r.status === 'Confirmada')
    if (confirmadas.length > 0 && confirmadas.every(r => r.welcome_sent_at)) {
        if (confirmadas.every(_isWelcomeSkipped)) {
            statusEl.textContent = '⛔ Sin bienvenida'
        } else {
            const enviadas = confirmadas.filter(r => !_isWelcomeSkipped(r))
            const fechaMax = new Date(Math.max(...enviadas.map(r => new Date(r.welcome_sent_at).getTime())))
            const dd = String(fechaMax.getDate()).padStart(2, '0')
            const mm = String(fechaMax.getMonth() + 1).padStart(2, '0')
            statusEl.textContent = `✅ Enviado el ${dd}/${mm}`
        }
    } else {
        statusEl.textContent = ''
    }
}

function abrirModalBienvenida(reservasIncluidas, pendientesNoMarcadas) {
    const { overlay, panel } = crearModal('modal-bienvenida', { wide: true, scroll: true })
    const nombre             = clienteActual.name || clienteActual.id

    const bannerHtml = pendientesNoMarcadas.length > 0 ? `
        <div class="modal-header-desc" style="background:#fff8e1;border:1px solid var(--accent-warn);padding:10px;border-radius:6px;margin-bottom:12px">
            ⚠️ Este cliente tiene reservas pendientes que no se incluyen en la bienvenida:
            <ul style="margin:6px 0 8px 18px">
                ${pendientesNoMarcadas.map(r => {
                    const srv = servicios.find(s => s.id === r.service_id)
                    return `<li>${srv?.name ?? srv?.service_code ?? '—'} (${srv?.day ?? '?'} de julio)</li>`
                }).join('')}
            </ul>
            <label style="display:flex;align-items:center;gap:6px;font-weight:normal">
                <input type="checkbox" id="chkIncluirNotaPendientes">
                Añadir nota recordando estas reservas pendientes
            </label>
        </div>` : ''

    const textoInicial = componerMensajeBienvenida(clienteActual, reservasIncluidas, pendientesNoMarcadas, disponibilidad)

    panel.innerHTML = `
        ${bannerHtml}
        <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="modal-header-title">Bienvenida — ${nombre}</div>
            <button id="btnCerrarBienvenida" class="btn btn-secondary" style="padding:4px 10px">✕</button>
        </div>
        <textarea id="textoBienvenida" class="modal-email-textarea" style="height:320px">${textoInicial}</textarea>
        <div id="bienvenida-botones-envio"></div>
        <div id="bienvenida-botones-skip" style="margin-top:8px"></div>
    `

    panel.querySelector('#btnCerrarBienvenida').addEventListener('click', () => overlay.close())

    if (pendientesNoMarcadas.length > 0) {
        panel.querySelector('#chkIncluirNotaPendientes').addEventListener('change', e => {
            panel.querySelector('#textoBienvenida').value = componerMensajeBienvenida(
                clienteActual, reservasIncluidas, pendientesNoMarcadas, disponibilidad,
                { incluirNotaPendientes: e.target.checked }
            )
        })
    }

    const idsIncluidas = reservasIncluidas.map(r => r.id)
    mostrarOpcionesEnvio({
        email:     clienteActual.email || null,
        telefono:  clienteActual.phone || null,
        asunto:    'Tu bienvenida a San Fermín — toda la información de acceso',
        getTexto:  () => panel.querySelector('#textoBienvenida').value,
        container: panel.querySelector('#bienvenida-botones-envio'),
        onUsado:   async () => {
            const ts = new Date().toISOString()
            const { error } = await supabase.from('reservations')
                .update({ welcome_sent_at: ts })
                .in('id', idsIncluidas)
            if (error) { console.error('[bienvenida] welcome_sent_at:', error); return }
            todasReservas = todasReservas.map(r =>
                idsIncluidas.includes(r.id) ? { ...r, welcome_sent_at: ts } : r
            )
            actualizarBotonBienvenida()
            mostrarToast('✅ Bienvenida enviada')
            _onBienvenidaEnviada()
            overlay.close()
        }
    })

    const btnSkip = panel.querySelector('#bienvenida-botones-skip')
    btnSkip.innerHTML = `<button id="btnNoEnviarBienvenida" class="btn btn-secondary">⛔ No enviar bienvenida</button>`
    btnSkip.querySelector('#btnNoEnviarBienvenida').addEventListener('click', async () => {
        if (!confirm('¿Marcar la bienvenida de este cliente como "no enviar"? Dejará de aparecer en el aviso. Puedes revertirlo abriendo este mismo modal y enviando la bienvenida.')) return
        const { error } = await supabase.from('reservations')
            .update({ welcome_sent_at: WELCOME_SKIP_SENTINEL })
            .in('id', idsIncluidas)
        if (error) { console.error('[bienvenida] skip:', error); return }
        todasReservas = todasReservas.map(r =>
            idsIncluidas.includes(r.id) ? { ...r, welcome_sent_at: WELCOME_SKIP_SENTINEL } : r
        )
        actualizarBotonBienvenida()
        mostrarToast('⛔ Bienvenida marcada como no enviar')
        overlay.close()
    })
}

document.getElementById('btnEnviarBienvenida').addEventListener('click', () => {
    if (!clienteActual) return

    const resDelCliente    = todasReservas.filter(r => r.client_id === clienteActual.id)
    const confirmadas      = resDelCliente.filter(r => r.status === 'Confirmada')
    const checkedIds       = new Set(
        [...document.querySelectorAll('.chk-reserva:checked')]
            .map(chk => chk.closest('tr').dataset.id)
    )
    const pendientesMarcadas   = resDelCliente.filter(r => r.status === 'Pendiente' && checkedIds.has(r.id))
    const pendientesNoMarcadas = resDelCliente.filter(r => r.status === 'Pendiente' && !checkedIds.has(r.id))
    const reservasIncluidas    = [...confirmadas, ...pendientesMarcadas]

    if (reservasIncluidas.length === 0) {
        mostrarToast('No hay reservas confirmadas para incluir en la bienvenida', '#6b7280')
        return
    }

    abrirModalBienvenida(reservasIncluidas, pendientesNoMarcadas)
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

btnAnadir.addEventListener('click', () => confirmarSiTemporadaNoActiva('la reserva', async () => {
    const clienteId  = inputId.value.trim().toUpperCase()
    const servicioId = parseInt(selectServicio.value) || null
    const venueId    = selectProveedor.value
    const plazas     = parseInt(inputPlazas.value)
    const precio     = getPrecioValue(inputPrecio)
    const estado     = selectEstado.value
    const comments   = document.getElementById('inputReservaComments').value.trim() || null

    if (plazas < 0) { alert('El número de plazas no puede ser negativo.'); return }
    if (plazas === 0) { if (!confirm('¿Crear una reserva con 0 plazas?')) return }

    setGuardando(true)
    try {

    if (reservaEditandoId) {
        const reservaOriginal   = todasReservas.find(r => r.id === reservaEditandoId)
        const venueIdAnterior   = reservaOriginal?.venue_id
        const servicioIdAnterior = reservaOriginal?.service_id

        // Calcular deltas para el modal consultivo antes de guardar
        const pairsParaModal = []
        const parCambia  = venueId !== venueIdAnterior || servicioId !== servicioIdAnterior
        const esSfcomRes = Boolean(reservaOriginal?.origin_ref?.startsWith('WEB'))
        if (reservaOriginal?.status === 'Cancelada' && estado !== 'Cancelada') {
            const { libres } = getPlazasInfo(venueId, servicioId)
            if (libres < plazas) {
                alert(`No hay plazas disponibles en ${venueId} para ${_svcCode(servicioId)}.\nDisponibles: ${libres}, necesarias: ${plazas}.`)
                return
            }
        }
        if (parCambia) {
            const eraActiva  = reservaOriginal?.status !== 'Cancelada'
            const seraActiva = estado !== 'Cancelada'
            if (eraActiva) pairsParaModal.push({
                venueId: venueIdAnterior, serviceId: servicioIdAnterior,
                sfcomDelta: esSfcomRes ? -(reservaOriginal?.slots ?? 0) : 0,
                allDelta:   -(reservaOriginal?.slots ?? 0)
            })
            if (seraActiva) pairsParaModal.push({
                venueId: venueId, serviceId: servicioId,
                sfcomDelta: esSfcomRes ? plazas : 0,
                allDelta:   plazas
            })
        } else {
            const eraActiva  = reservaOriginal?.status !== 'Cancelada'
            const seraActiva = estado !== 'Cancelada'
            const allDelta   = (seraActiva ? plazas : 0) - (eraActiva ? (reservaOriginal?.slots ?? 0) : 0)
            const sfcomDelta = esSfcomRes ? allDelta : 0
            if (allDelta !== 0) pairsParaModal.push({ venueId, serviceId: servicioId, sfcomDelta, allDelta })
        }
        for (const p of pairsParaModal) {
            if (p.allDelta <= 0) continue
            const sfcomResult = await checkAvailabilityBeforeSave(supabase, p.venueId, p.serviceId, p.allDelta)
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
            service_id: servicioId, venue_id: venueId,
            slots: plazas, price_per_slot: precio, status: estado, comments
        }).eq('id', reservaEditandoId)
        if (error) { alert('Error al guardar: ' + error.message); return }

        if (plazas !== reservaOriginal?.slots || precio !== reservaOriginal?.price_per_slot) {
            await _limpiarPropuestaReserva(reservaOriginal)
        }

        const { data: reservasActualizadas } = await supabase.from('reservations').select('*').in('service_id', _servicioIds)
        todasReservas = reservasActualizadas ?? []

        await persistirCobrosCliente(supabase, clienteActual.id, todasReservas)
        const provId = _getProviderIdFromVenue(venueId)
        if (provId) await persistirPagosProveedor(supabase, provId, todasReservas, disponibilidad)
        if (venueIdAnterior !== undefined && venueIdAnterior !== venueId) {
            const provIdAnterior = _getProviderIdFromVenue(venueIdAnterior)
            if (provIdAnterior) await persistirPagosProveedor(supabase, provIdAnterior, todasReservas, disponibilidad)
        }
        for (const p of pairsParaModal) {
            if (sfcomResultEdit === 'sync') {
                await _syncAndWarn(p.venueId, p.serviceId)
            }
        }
        await cargarReservasCliente(clienteActual.id)
        actualizarProveedores()
        limpiarFormularioReserva()

    } else {
        const { libres } = getPlazasInfo(venueId, servicioId)
        if (libres < plazas) {
            alert(`No hay suficientes plazas libres. Disponibles: ${libres}, necesitas: ${plazas}`)
            return
        }

        const sfcomResult = await checkAvailabilityBeforeSave(supabase, venueId, servicioId, plazas)
        if (!sfcomResult.ok) {
            alert(`No se puede guardar la reserva:\n\n${sfcomResult.message}`)
            return
        }
        if (sfcomResult.sfcomCheck && sfcomResult.warning) {
            const brechaExplicada = solicitudOriginRef?.startsWith('WEB') &&
                (sfcomResult.stockEsperado - sfcomResult.stockSfcom) <= plazas
            if (!brechaExplicada && !confirm(`Aviso de sfcom:\n\n${sfcomResult.warning}\n\n¿Deseas continuar igualmente?`)) return
        }

        const sfcomResultNuevo = await confirmarStockSfcom(supabase, [{
            venueId, serviceId: servicioId,
            sfcomDelta: solicitudOriginRef?.startsWith('WEB') ? plazas : 0,
            allDelta:   plazas
        }])
        if (sfcomResultNuevo === 'cancel') return

        if (!clienteActual) {
            const nombre = inputName.value.trim()
            const esSolicitudSfcom = _cargandoSolicitud && solicitudOriginRef?.startsWith('WEB')
            if (!esSolicitudSfcom && !confirm(`¿Crear cliente nuevo "${clienteId}"${nombre ? ' (' + nombre + ')' : ''}?`)) return
            const { error: errCliente } = await supabase.from('clients').insert({
                id:          clienteId,
                name:        nombre || null,
                company:     inputCompany.value.trim()  || null,
                phone:       inputPhone.value.trim()    || null,
                email:       inputEmail.value.trim()    || null,
                address:     inputAddress.value.trim()  || null,
                nif:         inputNif.value.trim()      || null,
                comments:    inputComments.value.trim() || null,
                is_business: inputIsBusiness.checked,
                country:     inputCountry.value.trim().toUpperCase() || 'ES',
            })
            if (errCliente) { alert('Error al crear cliente: ' + errCliente.message); return }
            clienteActual = {
                id: clienteId, name: nombre,
                is_business: inputIsBusiness.checked,
                country:     inputCountry.value.trim().toUpperCase() || 'ES',
            }
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
            venue_id: venueId, service_id: servicioId,
            slots: plazas, price_per_slot: precio, status: estado, comments,
            origin_ref: solicitudOriginRef || null
        })
        if (errReserva) { alert('Error al crear reserva: ' + errReserva.message); return }

        const { data: reservasActualizadas } = await supabase.from('reservations').select('*').in('service_id', _servicioIds)
        todasReservas = reservasActualizadas ?? []

        if (solicitudOriginRef?.startsWith('WEB')) {
            const { error: errChargeSfcom } = await supabase.from('charges').insert({
                client_id:      clienteActual.id,
                amount:         plazas * precio,
                due_date:       hoy,
                collected:      true,
                collected_date: hoy,
                comments:       `${solicitudOriginRef} Cobrado vía sfcom`,
                charge_type:    'prepago',
                season:         _temporada
            })
            if (errChargeSfcom) console.error('Error al crear cargo sfcom:', errChargeSfcom.message)
        }

        await persistirCobrosCliente(supabase, clienteActual.id, todasReservas)
        if (solicitudOriginRef?.startsWith('WEB')) await persistirCobrosCliente(supabase, 'SFCOM', todasReservas)
        const provIdNuevo = _getProviderIdFromVenue(venueId)
        if (provIdNuevo) await persistirPagosProveedor(supabase, provIdNuevo, todasReservas, disponibilidad)
        if (sfcomResultNuevo === 'sync') {
            await _syncAndWarn(venueId, servicioId)
        }
        await cargarReservasCliente(clienteActual.id)
        actualizarProveedores()
        if (_modoConversionActivo && _lineaActualIndex !== null) {
            await _onLineaGuardada()
        } else {
            const _refParaCerrar = solicitudOriginRef
            limpiarFormularioReserva()
            if (_refParaCerrar) await _ofrecerCerrarSolicitud(_refParaCerrar)
        }
    }
    } finally {
        setGuardando(false)
    }
}))

// ===== BLOQUE 3: DISPONIBILIDAD =====

function actualizarBloque3() {
    const servicioId  = parseInt(selectServicio.value) || null
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
        d, ...getPlazasInfo(d.venue_id, servicioId, reservaEditandoId)
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

        const esSeleccionado = proveedorSeleccionado && d.venue_id === proveedorSeleccionado
        const esAtenuado     = proveedorSeleccionado && !esSeleccionado

        const reservasCol = todasReservas.filter(r =>
            r.venue_id === d.venue_id && r.service_id === servicioId && r.status !== 'Cancelada'
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
                    onclick="seleccionarProveedorDesdeCajita('${d.venue_id}')">
            <div class="proveedor-col-header">
                <div class="nombre">${simbolo} ${d.venue_id}</div>
                <div class="plazas">${libres}/${total} libres</div>
            </div>
            <div class="proveedor-col-body">${filasReservas}</div>
        </div>`
    }).join('')
}

window.seleccionarProveedorDesdeCajita = function(proveedorId) {
    const servicioId = parseInt(selectServicio.value) || null
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
    if (clienteId === 'SFCOM') {
        return todasReservas
            .filter(r => r.origin_ref?.startsWith('WEB') && r.status !== 'Cancelada')
            .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
    }
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
        .eq('season', getTemporadaActiva())
        .is('invoice_number', null)
    if (errLeer) throw new Error('Error al leer cobros existentes: ' + errLeer.message)

    // Actualizar o insertar cada hito de memoria
    for (const h of hitosClienteTemp) {
        if (h.invoice_number) {
            // Facturado: actualizar solo el estado de cobro; nunca tocar importe ni campos de facturación.
            // Sin este bloque, toggleCobroCliente actualizaría la UI pero el cambio nunca llegaría a Supabase.
            if (!h.id) continue
            const { data: updRows, error } = await supabase
                .from('charges')
                .update({ collected: h.collected ?? false, collected_date: h.collected_date ?? null })
                .eq('id', h.id)
                .select('id')
            if (error) throw new Error(`Error al actualizar cobro facturado ${h.id}: ` + error.message)
            if (!updRows || updRows.length === 0) throw new Error(`Sin permiso para modificar cobro ${h.id} (comprueba RLS en charges)`)
            continue
        }

        const payload = {
            client_id:      clienteId,
            amount:         parseFloat(h.amount),
            due_date:       h.due_date ?? null,
            collected:      h.collected ?? false,
            collected_date: h.collected_date ?? null,
            comments:       h.comments ?? null,
            charge_type:    h.esAjuste ? 'ajuste' : (h.esFinal ? 'final' : 'prepago'),
            season:         getTemporadaActiva()
        }

        if (h.id) {
            // Hito existente no facturado — actualizar
            const { data: updRows, error } = await supabase
                .from('charges').update(payload).eq('id', h.id).select('id')
            if (error) throw new Error(`Error al actualizar cobro ${h.id}: ` + error.message)
            if (!updRows || updRows.length === 0) throw new Error(`Sin permiso para modificar cobro ${h.id} (comprueba RLS en charges)`)
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
        .from('charges').select('*').eq('client_id', clienteId).eq('season', getTemporadaActiva()).order('due_date')

    hitosClienteTemp = (charges ?? []).map(h => ({ ...h, esFinal: h.charge_type === 'final', esAjuste: h.charge_type === 'ajuste' }))

    const total      = calcularTotalCobrarCliente(clienteId)
    const prepagos   = hitosClienteTemp.filter(h => !h.esFinal && !h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
    const ajustes    = hitosClienteTemp.filter(h => h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
    const cobroFinal = total + ajustes - prepagos

    if (!hitosClienteTemp.find(h => h.esFinal)) {
        if (cobroFinal >= 0.01) {
            // No existe en BBDD — crear y persistir inmediatamente
            hitosClienteTemp.push({
                esFinal:     true,
                esAjuste:    false,
                charge_type: 'final',
                comments:    'Cobro final',
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
        const btnFacturar = h.esAjuste
            ? ''
            : !yaFacturado && h.id
            ? `<button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;margin-right:4px"
                   onclick="facturarHito('${h.id}')">📄 Facturar</button>`
            : yaFacturado
                ? `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:4px">
                       ${h.invoice_path
                           ? `<span style="font-size:11px;color:var(--accent-ok);cursor:pointer;text-decoration:underline"
                                  onclick="descargarFactura('${h.invoice_path}', '${h.invoice_number}')"
                                  title="Descargar ${h.invoice_number}">📄 ${h.invoice_number}</span>`
                           : `<span style="font-size:11px;color:var(--accent-ok)">📄 ${h.invoice_number}</span>`}
                       <button class="btn btn-secondary" style="padding:2px 5px;font-size:10px"
                           title="Reemitir factura" onclick="reemitirHito('${h.id}')">🔄</button>
                       <button class="btn btn-danger" style="padding:2px 5px;font-size:10px"
                           title="Anular factura" onclick="anularHito('${h.id}', '${h.invoice_number}')">✕</button>
                   </span>`
                : ''

        return `<tr>
            <td>${h.comments}${h.esAjuste ? ' <span style="font-size:10px;background:var(--accent-warn);color:#fff;border-radius:3px;padding:1px 4px;margin-left:4px">AJUSTE</span>' : ''}</td>
            <td>${fmt(h.amount)}${h.esFinal ? ' <span style="font-size:11px;color:var(--subtle)">(calculado)</span>' : ''}</td>
            <td>${fmt(totalFacturadoDesdeBase(h.amount, irpfRateParaCliente(clienteActual)))}</td>
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

function _pedirFechaCobro() {
    return new Promise(resolve => {
        const { overlay, panel } = crearModal('modal-fecha-cobro-cliente', { narrow: true })
        panel.innerHTML = `
            <div>
                <div class="modal-header-title">Fecha de cobro</div>
                <div class="modal-header-desc">Dejar vacío para registrar hoy (${hoy}).</div>
            </div>
            <div style="padding:8px 0">
                <input id="modal-fecha-cobro-input" type="date" value="${hoy}"
                    style="width:100%;padding:8px;border:1px solid var(--border);border-radius:4px;font-size:14px">
            </div>
            <div class="modal-actions">
                <button id="modal-fecha-cobro-cancel" class="btn btn-secondary">Cancelar</button>
                <button id="modal-fecha-cobro-ok" class="btn btn-primary" autofocus>Confirmar</button>
            </div>`
        const input = panel.querySelector('#modal-fecha-cobro-input')
        panel.querySelector('#modal-fecha-cobro-cancel').onclick = () => { overlay.close(); resolve(null) }
        panel.querySelector('#modal-fecha-cobro-ok').onclick = () => {
            overlay.close(); resolve(input.value || hoy)
        }
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { overlay.close(); resolve(input.value || hoy) }
        })
        setTimeout(() => input.focus(), 50)
    })
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
        const fecha = await _pedirFechaCobro()
        if (fecha === null) return
        h.collected      = true
        h.collected_date = fecha
    } else {
        h.collected      = false
        h.collected_date = null
    }

    const total    = calcularTotalCobrarCliente(clienteActual.id)
    const prepagos = hitosClienteTemp.filter(h => !h.esFinal && !h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
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
        // Verificar asiento fiscal y trimestre antes de permitir el borrado
        const { data: issued } = await supabase
            .from('issued_invoices')
            .select('id, accrual_date, file_path')
            .eq('charge_id', h.id)
            .eq('is_void', false)
            .maybeSingle()

        if (issued) {
            const trim = await checkTrimCerrado(supabase, issued.accrual_date)
            if (trim.cerrado) { mostrarModalTrimCerrado(trim.year, trim.quarter); return }
            if (!confirm(`Se borrará el cobro de ${fmt(h.amount)}, su factura del libro fiscal (${h.invoice_number}) y el PDF de almacenamiento. ¿Continuar?`)) return
            if (issued.file_path) await supabase.storage.from('invoices').remove([issued.file_path])
        } else {
            if (!confirm(`Se borrará el cobro de ${fmt(h.amount)}${h.invoice_path ? ' y su PDF asociado' : ''}. ¿Continuar?`)) return
            if (h.invoice_path) await supabase.storage.from('invoices').remove([h.invoice_path])
        }

        const { error: errDel } = await supabase.from('charges').delete().eq('id', h.id)
        if (errDel) { alert('Error al eliminar el cobro: ' + errDel.message); return }

        const { data: reservasCli } = await supabase.from('reservations')
            .select('client_id, status, total_amount, origin_ref').eq('client_id', clienteActual.id)
        await persistirCobrosCliente(supabase, clienteActual.id, reservasCli ?? [])
        cargarReservasCliente(clienteActual.id)
        return
    }

    // Sin factura — flujo existente con reversión en memoria
    const hitoEliminado = hitosClienteTemp.splice(idx, 1)[0]
    const total    = calcularTotalCobrarCliente(clienteActual.id)
    const prepagos = hitosClienteTemp.filter(h => !h.esFinal && !h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
    const ajustesD = hitosClienteTemp.filter(h => h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
    const idxFinal = hitosClienteTemp.findIndex(h => h.esFinal)
    if (idxFinal >= 0) hitosClienteTemp[idxFinal].amount = total + ajustesD - prepagos
    actualizarResumenCobros(clienteActual.id, total, prepagos, total + ajustesD - prepagos)
    renderCobrosCliente()
    try {
        await persistirHitosCliente(clienteActual.id)
    } catch (err) {
        hitosClienteTemp.splice(idx, 0, hitoEliminado)
        const totalRev    = calcularTotalCobrarCliente(clienteActual.id)
        const prepagosRev = hitosClienteTemp.filter(h => !h.esFinal && !h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
        const ajustesRev  = hitosClienteTemp.filter(h => h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
        const idxFinalRev = hitosClienteTemp.findIndex(h => h.esFinal)
        if (idxFinalRev >= 0) hitosClienteTemp[idxFinalRev].amount = totalRev + ajustesRev - prepagosRev
        actualizarResumenCobros(clienteActual.id, totalRev, prepagosRev, totalRev + ajustesRev - prepagosRev)
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

document.getElementById('btnGuardarNuevoCobro').addEventListener('click', () => confirmarSiTemporadaNoActiva('el cobro', async () => {
    const concepto = document.getElementById('cobroConcepto').value.trim() || 'Prepago'
    const importe  = getPrecioValue(document.getElementById('cobroImporte'))
    const fecha    = document.getElementById('cobroFecha').value || null
    const cobrado  = document.getElementById('cobroCobrado').value === 'true'
    if (!importe || importe <= 0) { alert('Introduce un importe válido'); return }

    const idxFinal = hitosClienteTemp.findIndex(h => h.esFinal)
    const posInsercion = idxFinal >= 0 ? idxFinal : hitosClienteTemp.length
    hitosClienteTemp.splice(posInsercion, 0, {
        esFinal:   false,
        esAjuste:  false,
        comments:  concepto,
        client_id: clienteActual.id,
        amount:    importe,
        due_date:  fecha,
        collected: cobrado
    })

    const total    = calcularTotalCobrarCliente(clienteActual.id)
    const prepagos = hitosClienteTemp.filter(h => !h.esFinal && !h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
    const ajustesG = hitosClienteTemp.filter(h => h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
    const idxF     = hitosClienteTemp.findIndex(h => h.esFinal)
    if (idxF >= 0) hitosClienteTemp[idxF].amount = total + ajustesG - prepagos

    document.getElementById('cobroConcepto').value = ''
    setPrecioValue(document.getElementById('cobroImporte'), '')
    document.getElementById('cobroFecha').value    = ''
    document.getElementById('cobroCobrado').value  = 'false'
    document.getElementById('form-nuevo-cobro-cliente').style.display = 'none'
    document.getElementById('btnNuevoCobroCliente').style.display     = 'inline-block'

    actualizarResumenCobros(clienteActual.id, total, prepagos, total + ajustesG - prepagos)
    renderCobrosCliente()

    try {
        await persistirHitosCliente(clienteActual.id)
        renderCobrosCliente()  // re-render para mostrar el botón Facturar, que requiere h.id asignado por el INSERT
    } catch (err) {
        // Revertir: eliminar el hito recién insertado de memoria
        hitosClienteTemp.splice(posInsercion, 1)
        const totalRev    = calcularTotalCobrarCliente(clienteActual.id)
        const prepagosRev = hitosClienteTemp.filter(h => !h.esFinal && !h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
        const ajustesRev  = hitosClienteTemp.filter(h => h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
        const idxFinalRev = hitosClienteTemp.findIndex(h => h.esFinal)
        if (idxFinalRev >= 0) hitosClienteTemp[idxFinalRev].amount = totalRev + ajustesRev - prepagosRev
        actualizarResumenCobros(clienteActual.id, totalRev, prepagosRev, totalRev + ajustesRev - prepagosRev)
        renderCobrosCliente()
        alert('Error al guardar el cobro: ' + err.message)
    }
}))


document.getElementById('btnNuevoAjusteCliente').addEventListener('click', () => {
    document.getElementById('form-nuevo-ajuste-cliente').style.display = 'block'
    document.getElementById('btnNuevoAjusteCliente').style.display     = 'none'
})

document.getElementById('btnCancelarNuevoAjuste').addEventListener('click', () => {
    document.getElementById('form-nuevo-ajuste-cliente').style.display = 'none'
    document.getElementById('btnNuevoAjusteCliente').style.display     = 'inline-block'
})

document.getElementById('btnGuardarNuevoAjuste').addEventListener('click', () => confirmarSiTemporadaNoActiva('el ajuste', async () => {
    const concepto = document.getElementById('ajusteConcepto').value.trim() || 'Ajuste'
    const importe  = getPrecioValue(document.getElementById('ajusteImporte'))
    if (!importe || importe <= 0) { alert('Introduce un importe válido'); return }

    const idxFinal = hitosClienteTemp.findIndex(h => h.esFinal)
    const posInsercion = idxFinal >= 0 ? idxFinal : hitosClienteTemp.length
    hitosClienteTemp.splice(posInsercion, 0, {
        esFinal:   false,
        esAjuste:  true,
        comments:  concepto,
        client_id: clienteActual.id,
        amount:    importe,
        due_date:  null,
        collected: false
    })

    const total    = calcularTotalCobrarCliente(clienteActual.id)
    const prepagos = hitosClienteTemp.filter(h => !h.esFinal && !h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
    const ajustesA = hitosClienteTemp.filter(h => h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
    const idxF     = hitosClienteTemp.findIndex(h => h.esFinal)
    if (idxF >= 0) hitosClienteTemp[idxF].amount = total + ajustesA - prepagos

    document.getElementById('ajusteConcepto').value = ''
    setPrecioValue(document.getElementById('ajusteImporte'), '')
    document.getElementById('form-nuevo-ajuste-cliente').style.display = 'none'
    document.getElementById('btnNuevoAjusteCliente').style.display     = 'inline-block'

    actualizarResumenCobros(clienteActual.id, total, prepagos, total + ajustesA - prepagos)
    renderCobrosCliente()

    try {
        await persistirHitosCliente(clienteActual.id)
        renderCobrosCliente()
    } catch (err) {
        hitosClienteTemp.splice(posInsercion, 1)
        const totalRev    = calcularTotalCobrarCliente(clienteActual.id)
        const prepagosRev = hitosClienteTemp.filter(h => !h.esFinal && !h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
        const ajustesRev  = hitosClienteTemp.filter(h => h.esAjuste).reduce((s, h) => s + parseFloat(h.amount), 0)
        const idxFinalRev = hitosClienteTemp.findIndex(h => h.esFinal)
        if (idxFinalRev >= 0) hitosClienteTemp[idxFinalRev].amount = totalRev + ajustesRev - prepagosRev
        actualizarResumenCobros(clienteActual.id, totalRev, prepagosRev, totalRev + ajustesRev - prepagosRev)
        renderCobrosCliente()
        alert('Error al guardar el ajuste: ' + err.message)
    }
}))

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

    // Charges sfcom: identificados por comments 'WEB-xxx Cobrado vía sfcom' (sin FK a reservation)
    const _esSfcomCharge = h => !!(h.comments?.startsWith('WEB') && h.comments?.includes('Cobrado v'))

    if (esHitoFinal) {
        const sinFacturar = hitosClienteTemp.filter(h =>
            h.id && h.id !== hitoId && !h.invoice_number && !h.esAjuste && !_esSfcomCharge(h)
        )
        if (sinFacturar.length > 0) {
            const continuar = await new Promise(resolve => {
                const { overlay, panel } = crearModal('modal-absorber-hitos', { narrow: true })
                const lista = sinFacturar.map(h =>
                    `<li>${h.comments ?? 'Sin concepto'}: <strong>${fmt(h.amount)}</strong></li>`
                ).join('')
                panel.innerHTML = `
                    <div>
                        <div class="modal-header-title">Cobros previos sin facturar</div>
                        <div class="modal-header-desc">
                            Los siguientes cobros no tienen factura propia y quedarán absorbidos en la factura final:
                            <ul style="margin:8px 0 0 16px;padding:0">${lista}</ul>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button id="btn-absorber-cancel" class="btn btn-secondary">Cancelar</button>
                        <button id="btn-absorber-ok" class="btn btn-primary" autofocus>Proceder</button>
                    </div>`
                panel.querySelector('#btn-absorber-cancel').onclick = () => { overlay.close(); resolve(false) }
                panel.querySelector('#btn-absorber-ok').onclick    = () => { overlay.close(); resolve(true) }
            })
            if (!continuar) return
        }
    }

    const reservasParaFactura = reservasCliente.filter(r => !r.origin_ref?.startsWith('WEB'))
    const hitosParaFactura    = hitosClienteTemp.filter(h => h.id && !_esSfcomCharge(h))

    const reservasConCharges = reservasParaFactura.map(r => ({
        ...r,
        _charges: hitosParaFactura,
        _esFinal: esHitoFinal
    }))
    await abrirPanelFactura(hitoId, clienteActual, reservasConCharges)
}

window.reemitirHito = async function(hitoId) {
    if (!clienteActual) return
    hitoId = parseInt(hitoId)
    const hitoTemp = hitosClienteTemp.find(h => h.id === hitoId)
    if (!hitoTemp) return

    const { overlay, panel } = crearModal('modal-reemitir-factura', { narrow: true })
    panel.innerHTML = `
        <div>
            <div class="modal-header-title">🔄 Reemitir factura</div>
            <div class="modal-header-desc">
                Se anulará el registro de <strong>${hitoTemp.invoice_number}</strong> y se generará
                una nueva factura con el mismo número.<br><br>
                ⚠️ Si ya enviaste esta factura al cliente, deberás informarle de la corrección.
            </div>
        </div>
        <div class="modal-actions">
            <button id="modal-reemitir-cancel" class="btn btn-secondary">Cancelar</button>
            <button id="modal-reemitir-ok" class="btn btn-primary">Continuar</button>
        </div>`
    panel.querySelector('#modal-reemitir-cancel').onclick = () => overlay.close()
    panel.querySelector('#modal-reemitir-ok').onclick = async () => {
        overlay.close()
        const esHitoFinal = hitoTemp?.esFinal ?? false
        const _esSfcomCharge = h => !!(h.comments?.startsWith('WEB') && h.comments?.includes('Cobrado v'))
        const reservasParaFactura = reservasCliente.filter(r => !r.origin_ref?.startsWith('WEB'))
        const hitosParaFactura    = hitosClienteTemp.filter(h => h.id && !_esSfcomCharge(h))
        const reservasConCharges  = reservasParaFactura.map(r => ({
            ...r,
            _charges: hitosParaFactura,
            _esFinal: esHitoFinal
        }))
        await abrirPanelReemision(hitoId, clienteActual, reservasConCharges)
    }
}

window.anularHito = async function(hitoId, invoiceNumber) {
    if (!clienteActual) return
    hitoId = parseInt(hitoId)

    const { overlay, panel } = crearModal('modal-anular-factura', { narrow: true })
    panel.innerHTML = `
        <div>
            <div class="modal-header-title">⚠️ Anular factura</div>
            <div class="modal-header-desc">
                Se anulará <strong>${invoiceNumber}</strong>, se eliminará su asiento del libro fiscal y el hito quedará sin facturar. El PDF no se borrará.<br><br>
                <strong>Esta acción no notifica al cliente.</strong>
                Si ya se envió la factura, deberás gestionarlo manualmente.
            </div>
        </div>
        <div class="modal-actions">
            <button id="modal-anular-cancel" class="btn btn-secondary">Cancelar</button>
            <button id="modal-anular-ok" class="btn btn-danger">Anular factura</button>
        </div>`
    panel.querySelector('#modal-anular-cancel').onclick = () => overlay.close()
    panel.querySelector('#modal-anular-ok').onclick = async () => {
        overlay.close()
        await anularFacturaDeHito(hitoId)
    }
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

function abrirPanelReorganizar(venueId, servicioId, plazasNecesarias) {
    reorgContexto = { venueId, servicioId, plazasNecesarias }
    reorgCambios  = {}

    const reservasBloquean = todasReservas.filter(r =>
        r.venue_id   === venueId    &&
        r.service_id === servicioId &&
        r.status     !== 'Cancelada'
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
    const { venueId, servicioId, plazasNecesarias } = reorgContexto

    const plazasOcupadas = reorgFilas
        .filter(r => r.venue_id === venueId && r.service_id === servicioId)
        .reduce((s, r) => s + r.slots, 0)

    const dispObj     = disponibilidad.find(d => d.venue_id === venueId && d.service_id === servicioId)
    const totalSlots  = dispObj?.total_slots ?? 0
    const libresAhora = totalSlots - plazasOcupadas

    document.getElementById('panel-reorg-cabecera').textContent =
        `Quieres meter ${plazasNecesarias} plaza(s) en ${venueId} / ${servicioId}`

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
            `<option value="${s.id}" ${r.service_id === s.id ? 'selected' : ''}>${s.service_code}</option>`
        ).join('')

        const dispDeServicio = disponibilidad.filter(d => d.service_id === r.service_id)
        const optsProveedor = dispDeServicio.map(d => {
            const ocupadasEnPanel = reorgFilas
                .filter(f => f.venue_id === d.venue_id && f.service_id === d.service_id && f.id !== r.id)
                .reduce((s, f) => s + f.slots, 0)
            const reservasReales = todasReservas
                .filter(res => res.venue_id === d.venue_id && res.service_id === d.service_id &&
                               res.status !== 'Cancelada' && !reorgFilas.find(f => f.id === res.id))
                .reduce((s, res) => s + res.slots, 0)
            const totalOcupadas = ocupadasEnPanel + reservasReales
            const libres        = (d.total_slots ?? 0) - totalOcupadas

            let simbolo = ''
            if      (libres >= r.slots) simbolo = '✅'
            else if (libres > 0)        simbolo = '⚠️'
            else                         simbolo = '❌'

            return `<option value="${d.venue_id}" ${r.venue_id === d.venue_id ? 'selected' : ''}>
                ${d.venue_id} (${libres} libres) ${simbolo}
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
                    onchange="reorgCambiarPrecio(${idx}, this.dataset.rawValue ?? this.value)">
            </td>
        </tr>`
    }).join('')
    tbody.querySelectorAll('input[type=number]').forEach(inp => initPrecioInput(inp))
}

window.reorgCambiarServicio = function(idx, nuevoServicio) {
    const r              = reorgFilas[idx]
    const original       = todasReservas.find(res => res.id === r.id)
    const nuevoServicioId = parseInt(nuevoServicio, 10)

    reorgFilas[idx].service_id = nuevoServicioId

    const dispNuevoServicio      = disponibilidad.filter(d => d.service_id === nuevoServicioId)
    const venueSigueDisponible   = dispNuevoServicio.some(d => d.venue_id === r.venue_id)
    if (!venueSigueDisponible && dispNuevoServicio.length > 0) {
        reorgFilas[idx].venue_id = dispNuevoServicio[0].venue_id
        mostrarToast(`ℹ️ Venue cambiado a ${dispNuevoServicio[0].venue_id} (el anterior no ofrece este servicio)`)
    }

    registrarCambioReorg(idx, original)
    renderPanelReorganizar()
}

window.reorgCambiarProveedor = function(idx, nuevoProveedor) {
    const r        = reorgFilas[idx]
    const original = todasReservas.find(res => res.id === r.id)

    reorgFilas[idx].venue_id = nuevoProveedor

    const yaEnPanel = reorgFilas.some(f =>
        f.venue_id === nuevoProveedor && f.service_id === r.service_id && f.id !== r.id
    )
    if (!yaEnPanel) {
        const reservasNuevoVenue = todasReservas.filter(res =>
            res.venue_id    === nuevoProveedor &&
            res.service_id  === r.service_id   &&
            res.status      !== 'Cancelada'    &&
            !reorgFilas.find(f => f.id === res.id)
        )
        const dispNuevoVenue     = disponibilidad.find(d =>
            d.venue_id === nuevoProveedor && d.service_id === r.service_id
        )
        const totalNuevoVenue    = dispNuevoVenue?.total_slots ?? 0
        const ocupadasNuevoVenue = reservasNuevoVenue.reduce((s, res) => s + res.slots, 0) + r.slots
        if (ocupadasNuevoVenue > totalNuevoVenue) {
            reorgFilas.push(...reservasNuevoVenue.map(res => ({ ...res })))
        }
    }

    registrarCambioReorg(idx, original)
    renderPanelReorganizar()
}

function registrarCambioReorg(idx, original) {
    const r = reorgFilas[idx]
    const precioModificado = reorgCambios[r.id]?.price_per_slot

    if (r.service_id !== original.service_id || r.venue_id !== original.venue_id) {
        reorgCambios[r.id] = {
            service_id: r.service_id,
            venue_id:   r.venue_id,
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
        // Hay cambio de precio — registrar, preservando service_id y venue_id si ya cambiaron
        reorgCambios[r.id] = {
            service_id:     reorgCambios[r.id]?.service_id ?? r.service_id,
            venue_id:       reorgCambios[r.id]?.venue_id   ?? r.venue_id,
            price_per_slot: precio
        }
    } else {
        // Precio volvió al original — eliminar solo price_per_slot
        if (reorgCambios[r.id]) {
            delete reorgCambios[r.id].price_per_slot
            // Si tampoco hay cambio de servicio ni venue, eliminar la entrada completa
            if (reorgCambios[r.id].service_id === original.service_id &&
                reorgCambios[r.id].venue_id   === original.venue_id) {
                delete reorgCambios[r.id]
            }
        }
    }

    // Recalcular estado del botón sin re-renderizar la tabla (evita perder el foco del input)
    const { plazasNecesarias, venueId, servicioId } = reorgContexto
    const plazasOcupadas = reorgFilas
        .filter(f => f.venue_id === venueId && f.service_id === servicioId)
        .reduce((s, f) => s + f.slots, 0)
    const dispObj     = disponibilidad.find(d => d.venue_id === venueId && d.service_id === servicioId)
    const libresAhora = (dispObj?.total_slots ?? 0) - plazasOcupadas
    document.getElementById('btnConfirmarReorg').disabled =
        libresAhora < plazasNecesarias || Object.keys(reorgCambios).length === 0
}

window.confirmarReorganizacion = async function() {
    if (Object.keys(reorgCambios).length === 0) return

    const _svcCode = id => servicios.find(s => s.id === id)?.service_code ?? String(id)
    const lineas = Object.entries(reorgCambios).map(([id, cambio]) => {
        const original = todasReservas.find(r => r.id === id)
        const partes   = []
        if (cambio.service_id !== undefined && cambio.service_id !== original.service_id)
            partes.push(`${_svcCode(original.service_id)} → ${_svcCode(cambio.service_id)}`)
        if (cambio.venue_id !== undefined && cambio.venue_id !== original.venue_id)
            partes.push(`${original.venue_id} → ${cambio.venue_id}`)
        if (cambio.price_per_slot !== undefined)
            partes.push(`precio ${fmt(original.price_per_slot)} → ${fmt(cambio.price_per_slot)}`)
        return `${id}  ${original.client_id}  ${partes.join('  |  ')}`
    })

    const confirmado = confirm(`¿Confirmar los siguientes cambios?\n\n${lineas.join('\n')}`)
    if (!confirmado) return

    const originales = Object.fromEntries(
        Object.entries(reorgCambios).map(([id]) => {
            const r = todasReservas.find(r => r.id === id)
            return [id, { service_id: r.service_id, venue_id: r.venue_id, price_per_slot: r.price_per_slot }]
        })
    )

    // Modal consultivo de sfcom para los pares afectados por la reorganización
    const sfcomDeltasMap = new Map()
    Object.entries(reorgCambios).forEach(([id, cambio]) => {
        const r = todasReservas.find(r => r.id === id)
        if (!r) return
        const newVenueId   = cambio.venue_id   ?? r.venue_id
        const newServiceId = cambio.service_id ?? r.service_id
        if (newVenueId === r.venue_id && newServiceId === r.service_id) return
        const isSfcom = Boolean(r.origin_ref?.startsWith('WEB'))
        const slots   = r.slots ?? 0
        const origKey = `${r.venue_id}|${r.service_id}`
        const newKey  = `${newVenueId}|${newServiceId}`
        const orig = sfcomDeltasMap.get(origKey) ?? { venueId: r.venue_id, serviceId: r.service_id, sfcomDelta: 0, allDelta: 0 }
        orig.allDelta   -= slots
        orig.sfcomDelta -= isSfcom ? slots : 0
        sfcomDeltasMap.set(origKey, orig)
        const dest = sfcomDeltasMap.get(newKey) ?? { venueId: newVenueId, serviceId: newServiceId, sfcomDelta: 0, allDelta: 0 }
        dest.allDelta   += slots
        dest.sfcomDelta += isSfcom ? slots : 0
        sfcomDeltasMap.set(newKey, dest)
    })
    const sfcomPairsReorg = [...sfcomDeltasMap.values()].filter(p => p.allDelta !== 0 || p.sfcomDelta !== 0)
    for (const p of sfcomPairsReorg) {
        if (p.allDelta <= 0) continue
        const sfcomResult = await checkAvailabilityBeforeSave(supabase, p.venueId, p.serviceId, p.allDelta)
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
        if (cambio.venue_id       !== undefined) updateData.venue_id       = cambio.venue_id
        if (cambio.price_per_slot !== undefined) updateData.price_per_slot = cambio.price_per_slot

        const { error } = await supabase.from('reservations')
            .update(updateData)
            .eq('id', id)
        if (error) {
            const reversiones = await Promise.allSettled(aplicados.map(rid =>
                supabase.from('reservations').update(originales[rid]).eq('id', rid)
            ))
            const fallidas = reversiones
                .map((r, i) => (r.status === 'rejected' || r.value?.error) ? aplicados[i] : null)
                .filter(Boolean)
            if (fallidas.length > 0) {
                alert(`Error al reorganizar (${id}).\n\n⚠️ La reversión también falló en: ${fallidas.join(', ')}.\nEstas reservas pueden quedar inconsistentes — corrígelas manualmente en Supabase.`)
            } else {
                alert(`Error al reorganizar (${id}). Los cambios anteriores han sido revertidos correctamente.`)
            }
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
        const provIdNuevo = cambio.venue_id ? _getProviderIdFromVenue(cambio.venue_id) : null
        const provIdOrig  = original?.venue_id ? _getProviderIdFromVenue(original.venue_id) : null
        if (provIdNuevo) proveedoresAfectados.add(provIdNuevo)
        if (provIdOrig)  proveedoresAfectados.add(provIdOrig)
    })
    for (const proveedorId of proveedoresAfectados) {
        await persistirPagosProveedor(supabase, proveedorId, todasReservas, disponibilidad)
    }

    const sfcomPares = new Set()
    Object.entries(reorgCambios).forEach(([id, cambio]) => {
        const orig = originales[id]
        const newVenueId   = cambio.venue_id   ?? orig.venue_id
        const newServiceId = cambio.service_id ?? orig.service_id
        if (newVenueId !== orig.venue_id || newServiceId !== orig.service_id) {
            sfcomPares.add(`${orig.venue_id}|${orig.service_id}`)
            sfcomPares.add(`${newVenueId}|${newServiceId}`)
        }
    })
    for (const par of sfcomPares) {
        const [venId, svcId] = par.split('|')
        if (sfcomResultReorg === 'sync') await _syncAndWarn(venId, svcId)
    }

    cerrarPanelReorganizar()
    actualizarBloque3()
    actualizarProveedores()
    if (clienteActual) await cargarReservasCliente(clienteActual.id)

    alert('✅ Cambios guardados. Ahora puedes añadir la reserva.')
}

// Infiere service_id y venue_id desde el mapeo de availability.
// El nombre (sfcom_service_name) es la búsqueda primaria.
// Fallback de prefix-scan para solicitudes antiguas donde level contiene
// el nombre completo de variación ("Balcón Estafeta - Viernes 10 de Julio...").
function _inferirDesdeSfcom(level, day) {
    if (!level) return { serviceId: null, venueId: null }

    const norm = s => s.toLowerCase()
    let filas = sfcomListings.filter(d =>
        d.sfcom_service_name && norm(d.sfcom_service_name) === norm(level)
    )

    // Fallback para registros antiguos con nombre completo de variación
    if (!filas.length) {
        const nombres        = [...new Set(sfcomListings.map(d => d.sfcom_service_name).filter(Boolean))]
        const nombreExtraido = extraerNombreProducto(level, nombres)
        if (nombreExtraido) {
            filas = sfcomListings.filter(d =>
                d.sfcom_service_name && norm(d.sfcom_service_name) === norm(nombreExtraido)
            )
        }
    }

    if (!filas.length) return { serviceId: null, venueId: null }

    // Varias filas con el mismo nombre (e.g. "Balcón Estafeta" con varios días):
    // intentar filtrar por día
    if (filas.length > 1 && day) {
        const filaDia = filas.find(d => d.service_code === 'ENCIERRO_' + day)
        if (filaDia) return { serviceId: filaDia.service_id, venueId: filaDia.venue_id }
    }

    return { serviceId: filas[0].service_id, venueId: filas[0].venue_id }
}

// Infiere el service_id probable a partir del slug (level) y el día
// Solo se usa en admin al cargar una solicitud web — nunca en la web pública
function _inferirServiceId(slug, day) {
    const p = parsearNivel(slug)
    if (!p) return null
    if (p.tipo === 'encierro') return day ? 'ENCIERRO_' + day : null
    return TIPO_SERVICIO_ID[p.tipo] ?? null
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
    if (!_limpiandoWebWeb) {
        _limpiandoWebWeb = true
        await supabase.from('reservation_requests').delete().like('source', 'WEBWEB%')
    }

    const { data: solicitudes, error } = await supabase
        .from('reservation_requests')
        .select('*')
        .not('status', 'in', '("convertida","descartada")')
        .order('created_at', { ascending: true })

    if (error) { console.error('Error cargando solicitudes:', error); return }

    const bloque    = document.getElementById('bloque-solicitudes')
    const tbody     = document.getElementById('tbody-solicitudes')
    const tablaWrap = document.getElementById('tabla-solicitudes-wrapper')
    const avisoEl   = document.getElementById('bloque-solicitudes-empty')

    const sfcomPendientes = (solicitudes ?? []).filter(s => _esSfcom(s.source) && s.status === 'nueva')
    const otrasActivas    = (solicitudes ?? []).filter(s => !_esSfcom(s.source) && !s.source?.startsWith('sfcom_c:') && s.status === 'nueva')

    if (sfcomPendientes.length === 0 && otrasActivas.length === 0) {
        if (bloque) bloque.style.display = 'none'
        return
    }
    if (bloque) bloque.style.display = ''

    if (avisoEl) {
        if (otrasActivas.length > 0) {
            const nNuevas  = otrasActivas.filter(s => s.status === 'nueva').length
            const nGestion = otrasActivas.filter(s => s.status !== 'nueva').length
            const partes   = []
            if (nNuevas  > 0) partes.push(`${nNuevas} nueva${nNuevas > 1 ? 's' : ''}`)
            if (nGestion > 0) partes.push(`${nGestion} en gestión`)
            avisoEl.style.display = 'block'
            avisoEl.innerHTML = `${partes.join(', ')} — <a href="solicitudes.html">ver en solicitudes</a>`
        } else {
            avisoEl.style.display = 'none'
        }
    }

    if (tablaWrap) tablaWrap.style.display = sfcomPendientes.length > 0 ? '' : 'none'
    if (sfcomPendientes.length === 0) return

    tbody.innerHTML = sfcomPendientes.map(s => {
        const d0       = s.proposal_draft?.[0] ?? null
        const fecha    = s.created_at
            ? new Date(s.created_at).toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
            : '—'
        const contacto   = [s.client_email, s.client_phone].filter(Boolean).join(' / ') || '—'
        const dia        = d0?.day ? d0.day + '/jul' : '—'
        const comentario = s.comments || '—'
        const experiencia = d0?.service_name || s.comments || '—'
        const importe = d0?.price && d0?.slots
            ? `${(d0.price * d0.slots).toFixed(0)}€ bruto<br><strong>${(d0.price * d0.slots / 1.15).toFixed(0)}€ neto</strong>`
            : '—'

        return `<tr class="fila-solicitud" style="cursor:pointer;background:#fff0f0;border-left:3px solid #dc2626"
            data-id="${s.id}"
            data-source="${(s.source || '').replace(/"/g, '&quot;')}"
            data-nombre="${(s.client_name || '').replace(/"/g, '&quot;')}"
            data-email="${(s.client_email || '').replace(/"/g, '&quot;')}"
            data-telefono="${(s.client_phone || '').replace(/"/g, '&quot;')}"
            data-address="${(s.client_address || '').replace(/"/g, '&quot;')}"
            data-level="${(d0?.service_name || '').replace(/"/g, '&quot;')}"
            data-service-id="${d0?.service_id ?? ''}"
            data-day="${d0?.day || ''}"
            data-slots="${d0?.slots || ''}"
            data-price-per-slot="${d0?.price || ''}"
            data-comments="${comentario.replace(/"/g, '&quot;')}">
            <td><span style="font-size:10px;background:#dc2626;color:#fff;padding:1px 5px;border-radius:3px;margin-right:4px">sfcom</span>${fecha}</td>
            <td>${s.client_name || '—'}</td>
            <td>${contacto}</td>
            <td>${experiencia}</td>
            <td>${d0?.slots || '—'}</td>
            <td>${dia}</td>
            <td style="font-size:12px">${importe}</td>
            <td>${comentario}</td>
            <td class="td-acciones" onclick="event.stopPropagation()">
                <button class="btn-sm btn-ok btn-atendida" data-id="${s.id}">✅ Procesado</button>
            </td>
        </tr>`
    }).join('')

    tbody.querySelectorAll('.fila-solicitud').forEach(tr => {
        tr.addEventListener('click', () => cargarDesdeSolicitud(tr.dataset))
    })

    tbody.querySelectorAll('.btn-atendida').forEach(btn => {
        btn.addEventListener('click', () => marcarAtendida(btn.dataset.id))
    })
}

function _confirmarClienteAmbiguo(candidatos) {
    return new Promise(resolve => {
        const { overlay, panel } = crearModal('modal-resolver-cliente', { narrow: true })
        const filas = candidatos.map(c => {
            const detalle = [c.name, c.phone, c.email].filter(Boolean).join(' · ')
            return `<button class="btn btn-secondary" style="text-align:left;width:100%;margin-bottom:6px" data-id="${c.id}">
                <strong>${c.id}</strong>${detalle ? `<br><span style="font-size:11px;font-weight:400;color:var(--subtle)">${detalle}</span>` : ''}
            </button>`
        }).join('')
        panel.innerHTML = `
            <div class="modal-header">
                <span class="modal-header-icon">👤</span>
                <div>
                    <div class="modal-header-title">¿Es alguno de estos clientes?</div>
                    <div class="modal-header-desc">El nombre coincide parcialmente con ${candidatos.length === 1 ? 'un cliente existente' : `${candidatos.length} clientes existentes`}.</div>
                </div>
            </div>
            <div style="margin:12px 0">${filas}</div>
            <div class="modal-actions">
                <button id="btnClienteNinguno" class="btn btn-secondary">No, es persona nueva</button>
            </div>`
        panel.querySelectorAll('[data-id]').forEach(btn => {
            btn.onclick = () => { overlay.close(); resolve(candidatos.find(c => c.id === btn.dataset.id) ?? null) }
        })
        panel.querySelector('#btnClienteNinguno').onclick = () => { overlay.close(); resolve(null) }
    })
}

async function cargarDesdeSolicitud(data) {
    limpiarCamposCliente()

    const esSfcom   = _esSfcom(data.source)
    const originRef = esSfcom ? (data.source || null) : null

    const nombreBase = (data.nombre || 'CLIENTE')
        .toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '_')

    const resolucion = resolverCliente(
        { nombre: data.nombre, email: data.email, telefono: data.telefono },
        todosClientes
    )

    let clienteResuelto = null
    if (resolucion.match === 'exacto') {
        clienteResuelto = resolucion.cliente
    } else if (resolucion.match === 'ambiguo') {
        clienteResuelto = await _confirmarClienteAmbiguo(resolucion.candidatos)
    }

    _cargandoSolicitud = true

    if (clienteResuelto) {
        inputId.value = clienteResuelto.id
        cargarCliente(clienteResuelto)
        solicitudOriginRef = originRef  // cargarCliente -> limpiarFormularioReserva lo resetea
        mostrarToast(`Cliente existente: ${clienteResuelto.id}`)
    } else {
        let clienteId = nombreBase, sufijo = 2
        while (todosClientes.find(c => c.id === clienteId)) { clienteId = nombreBase + '_' + sufijo; sufijo++ }
        solicitudOriginRef = originRef
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
    }

    if (esSfcom) {
        if (data.slots) inputPlazas.value = data.slots
        // Nombre como búsqueda primaria; service_id almacenado solo como verificación
        const { serviceId, venueId: venueInferido } = _inferirDesdeSfcom(data.level, data.day)

        // Cross-check: si hay service_id guardado y no coincide con el inferido por nombre → modal de aviso
        if (serviceId && data.serviceId && serviceId !== parseInt(data.serviceId)) {
            _mostrarModalAvisoSolicitud(
                `Inconsistencia detectada en esta solicitud: el servicio inferido por el nombre del producto (${_svcCode(serviceId)}) ` +
                `no coincide con el que estaba guardado (${_svcCode(data.serviceId)}). ` +
                `Se usará el inferido por nombre — verifica manualmente.`
            )
        }

        if (serviceId) {
            selectServicio.value = serviceId
            selectServicio.dispatchEvent(new Event('change'))
            if (venueInferido) {
                setTimeout(() => {
                    selectProveedor.value = venueInferido
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
                    setPrecioValue(inputPrecio, bruto / 1.15)
                    validarPrecio()
                    actualizarTotal()
                }, 150)
            }
        }
    } else {
        // Solicitud web/email — determinar caso A (0 o 1 línea) o caso B (2+ líneas)
        let draft = Array.isArray(data.proposal_draft) ? data.proposal_draft : []

        // Si el borrador llega vacío pero hay datos para inferir, construir la línea aquí
        // y persistirla — el borrador es la fuente de verdad única para solicitudes no-sfcom
        if (draft.length === 0) {
            // _inferirServiceId returns text service_code; data.serviceId is integer string after migración
            const serviceCode = _inferirServiceId(data.level, data.day) || null
            const svc = serviceCode
                ? servicios.find(s => s.service_code === serviceCode)
                : (data.serviceId ? servicios.find(s => s.id === parseInt(data.serviceId)) : null)
            if (svc) {
                const dispServicio = disponibilidad.filter(d => d.service_id === svc.id)
                const venueDisp    = dispServicio.find(d => d.venue_id === data.venueId)
                const catUrl       = dispServicio[0]?.venue_slug && dispServicio[0]?.event_type
                    ? `https://www.experienciasanfermin.com/catalogo/balcon.html?v=${dispServicio[0].venue_slug}&et=${dispServicio[0].event_type}`
                    : null
                draft = [{
                    service_id:         svc.id,
                    service_name:       svc.name || svc.service_code,
                    day:                svc.day || parseInt(data.day) || null,
                    venue_id:           data.venueId || null,
                    venue_display_name: venueDisp?.venue_display_name || null,
                    slots:              parseInt(data.slots) || null,
                    price:              null,
                    catalogo_url:       catUrl
                }]
                supabase.from('reservation_requests').update({ proposal_draft: draft }).eq('id', data.id)
            }
        }

        if (draft.length >= 2) {
            // CASO B: bloque de conversión — no se rellena el bloque 2 ahora
            const nombreMostrar = clienteResuelto?.name || clienteResuelto?.id || data.nombre || 'cliente'
            _initBloqueConversion(data.id, data.source || null, draft, nombreMostrar)
            // Si todas las líneas ya estaban resueltas (entrada desde sesión anterior), finalizar directamente
            if (draft.every(l => l.estado === 'hecha' || l.estado === 'descartada')) {
                await _finalizarConversion()
            }
        } else if (draft.length === 1) {
            // CASO A: rellenar bloque 2 desde el borrador (única fuente de verdad)
            const linea = draft[0]
            if (linea.service_id && servicios.find(s => s.id === linea.service_id)) {
                selectServicio.value = linea.service_id
                selectServicio.dispatchEvent(new Event('change'))
                if (linea.slots != null) inputPlazas.value = linea.slots
                setTimeout(() => {
                    if (linea.venue_id) {
                        selectProveedor.value = linea.venue_id
                        selectProveedor.dispatchEvent(new Event('change'))
                    } else {
                        const soloUno = disponibilidad.filter(d => d.service_id === linea.service_id)
                        if (soloUno.length === 1) {
                            selectProveedor.value = soloUno[0].venue_id
                            selectProveedor.dispatchEvent(new Event('change'))
                        }
                    }
                    if (linea.price != null) {
                        setPrecioValue(inputPrecio, linea.price)
                        validarPrecio()
                        actualizarTotal()
                        actualizarBtnAnadir()
                    }
                }, 100)
            }
        }
        // draft.length === 0 tras el intento de auto-creación: solicitud sin datos de servicio,
        // bloque 2 queda en blanco para relleno manual

        // Comentarios de reserva (solo si no hay bloque de conversión activo)
        if (!_modoConversionActivo) {
            const inputComentariosReserva = document.getElementById('inputReservaComments')
            if (inputComentariosReserva && data.comments) {
                inputComentariosReserva.value = data.comments
            }
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
    const nuevos = pedidos.filter(p => !sourcesRegistrados.has(p.origin_ref))
    if (!nuevos.length) return

    for (const pedido of nuevos) {

        if ((pedido.productos?.length ?? 0) > 1) {
            _mostrarModalAvisoSolicitud(
                `El pedido <strong>${pedido.origin_ref}</strong> contiene ${pedido.productos.length} productos — ` +
                `solo se procesa el primero automáticamente. Los demás requieren revisión manual.`
            )
        }
        const li = pedido.productos?.[0]
        if (!li) continue

        const { filaByName, filaById, levelToSave: levelToSaveBase } = resolverProductoSfcom(li, sfcomListings)

        // Tres casos según coincidencia de nombre vs IDs
        let serviceId   = null
        let venueId     = null
        let levelToSave = levelToSaveBase

        if (filaByName && (!filaById || filaById.id === filaByName.id)) {
            // Caso 1: nombre encontrado, IDs consistentes
            serviceId = filaByName.service_id
            venueId   = filaByName.venue_id ?? null

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
                const local = sfcomListings.find(d => d.id === filaByName.id)
                if (local) {
                    local.sfcom_product_id   = li.product_id
                    local.sfcom_variation_id = li.variation_id || null
                }
            }
            serviceId = filaByName.service_id
            venueId   = filaByName.venue_id ?? null

        } else if (!filaByName && filaById) {
            // Caso 3: IDs apuntan a una fila pero el nombre no se reconoce
            _mostrarModalNombreNoReconocido(li.nombre, pedido.origin_ref)
            levelToSave = li.nombre  // guardar nombre raw para revisión manual
            venueId     = filaById.venue_id ?? null
        }
        // Caso 4 (ninguno encontrado): serviceId=null, levelToSave=li.nombre raw

        const slots           = li.cantidad ?? 1
        const totalBruto      = parseFloat(pedido.total ?? 0)
        const precioSlotBruto = slots > 0 ? totalBruto / slots : totalBruto
        const dia             = extraerDia(li.nombre)
        const hoy = new Date()
        const dd  = String(hoy.getDate()).padStart(2, '0')
        const mm  = String(hoy.getMonth() + 1).padStart(2, '0')
        const yy  = String(hoy.getFullYear()).slice(-2)
        const detalleProd = [
            levelToSave         && `Producto: ${levelToSave}`,
                                   `Personas: ${slots}`,
            precioSlotBruto > 0 && `Precio: ${Math.round(precioSlotBruto)}€/p`
        ].filter(Boolean).join(' · ')
        const proposal_draft = (serviceId || venueId || levelToSave) ? [{
            service_name: levelToSave,
            service_id:   serviceId,
            venue_id:     venueId,
            day:          dia,
            slots:        slots || null,
            price:        precioSlotBruto || null
        }] : null

        await supabase.from('reservation_requests').insert({
            client_name:        pedido.cliente.nombre    || 'Sin nombre',
            client_email:       pedido.cliente.email     || null,
            client_phone:       pedido.cliente.telefono  || null,
            client_address:     pedido.cliente.direccion || null,
            comments:           pedido.cliente.comentarios || null,
            proposal_draft,
            conversation_notes: `---${dd}/${mm}/${yy}---\n<Cliente>\n[Sfcom confirmado] ${detalleProd}`,
            created_at:         pedido.fecha || undefined,
            source:             pedido.origin_ref,
            status:             'nueva'
        })
    }
}

async function marcarAtendida(id) {
    const confirmado = await new Promise(resolve => {
        const { overlay, panel } = crearModal('modal-marcar-atendida', { narrow: true })
        panel.innerHTML = `
            <h2 style="margin-bottom:12px">¿Marcar como procesada?</h2>
            <p style="font-size:13px;color:var(--text);margin-bottom:16px">
                Esta solicitud no tiene ninguna reserva creada. Al marcarla como procesada
                desaparecerá de las listas activas sin haber generado ninguna reserva.<br><br>
                Úsalo solo si ya atendiste al cliente por otro medio o si descartarás la solicitud.
            </p>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button id="btn-atendida-cancelar" class="btn btn-secondary" autofocus>Cancelar</button>
                <button id="btn-atendida-confirmar" class="btn btn-primary">Marcar como procesada</button>
            </div>`
        panel.querySelector('#btn-atendida-cancelar').addEventListener('click', () => { overlay.close(); resolve(false) })
        panel.querySelector('#btn-atendida-confirmar').addEventListener('click', () => { overlay.close(); resolve(true) })
        overlay.addEventListener('close', () => resolve(false))
    })
    if (!confirmado) return
    const { error } = await supabase
        .from('reservation_requests')
        .update({ status: 'convertida' })
        .eq('id', id)
    if (error) console.error('Error marcando como atendida:', error)
    await cargarSolicitudes()
}

async function descartarSolicitud(id) {
    if (!confirm('¿Descartar esta solicitud? No se podrá recuperar.')) return

    const { error } = await supabase
        .from('reservation_requests')
        .update({ status: 'descartada' })
        .eq('id', id)

    if (error) console.error('Error descartando solicitud:', error)
    await cargarSolicitudes()
}

async function _ofrecerCerrarSolicitud(ref) {
    if (typeof ref === 'string' && ref.startsWith('WEB')) {
        const [{ data: pendientes }, { data: reservasSaved }] = await Promise.all([
            supabase.from('reservation_requests').select('id').eq('source', ref).neq('status', 'descartada'),
            supabase.from('reservations').select('id').eq('origin_ref', ref)
        ])
        if ((pendientes?.length ?? 0) > (reservasSaved?.length ?? 0)) return
        await supabase.from('reservation_requests').update({ status: 'convertida' }).match({ source: ref })
        await cargarSolicitudes()
        return
    }
    if (!confirm('¿Marcar la solicitud como convertida?')) return
    const { error } = await supabase.from('reservation_requests')
        .update({ status: 'convertida' })
        .match({ id: ref })
    if (error) { console.error('Error al cerrar solicitud:', error); return }
    await cargarSolicitudes()
}

document.getElementById('btnCerrarReorg').addEventListener('click', cerrarPanelReorganizar)
document.getElementById('btnCancelarReorg').addEventListener('click', cerrarPanelReorganizar)
document.getElementById('btnConfirmarReorg').addEventListener('click', confirmarReorganizacion)
document.getElementById('btnProcesarEmail').addEventListener('click', () => { location.href = 'solicitudes.html' })

// ===== BLOQUE DE CONVERSIÓN DE PROPUESTA =====

function _resumeLinea(l) {
    const partes = []
    if (l.service_name)       partes.push(l.service_name)
    if (l.day)                partes.push(`día ${l.day}`)
    if (l.venue_display_name) partes.push(l.venue_display_name)
    if (l.slots)              partes.push(`${l.slots} plazas`)
    if (l.price)              partes.push(`${l.price}€/plaza`)
    const total = (l.slots || 0) * (l.price || 0)
    if (total > 0)            partes.push(`${total.toLocaleString('es-ES')}€`)
    return partes.join(' · ') || '—'
}

function _initBloqueConversion(solicitudId, webRef, draft, nombreCliente) {
    _modoConversionActivo  = true
    _solicitudConversionId = solicitudId
    _solicitudWEBRef       = webRef || null
    _draftConversion       = draft.map(l => ({ ...l, estado: l.estado || 'pendiente' }))
    _lineaActualIndex      = null

    let bloque = document.getElementById('bloque-conversion-propuesta')
    if (!bloque) {
        bloque = document.createElement('div')
        bloque.id        = 'bloque-conversion-propuesta'
        bloque.className = 'bloque'
        document.getElementById('bloque-cliente').before(bloque)
    }
    bloque.style.cssText = 'background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:16px'

    const n = _draftConversion.length
    bloque.innerHTML = `
        <h2 style="margin:0 0 12px;font-size:16px;color:#1d4ed8">
            📋 Convirtiendo propuesta de ${nombreCliente} — ${n} línea${n !== 1 ? 's' : ''}
        </h2>
        <div id="conv-tabla-wrapper" style="overflow-x:auto"></div>
    `
    _renderTablaConversion()
}

function _renderTablaConversion() {
    const wrapper = document.getElementById('conv-tabla-wrapper')
    if (!wrapper) return

    const filas = _draftConversion.map((l, idx) => {
        const estado = l.estado || 'pendiente'
        const resumen = _resumeLinea(l)

        let badgeStyle, badgeText
        if (estado === 'hecha') {
            badgeStyle = 'color:#15803d;background:#dcfce7;border-radius:4px;padding:2px 8px;font-size:11px;white-space:nowrap'
            badgeText  = '✅ Hecha'
        } else if (estado === 'descartada') {
            badgeStyle = 'color:#6b7280;background:#f3f4f6;border-radius:4px;padding:2px 8px;font-size:11px;white-space:nowrap;text-decoration:line-through'
            badgeText  = '❌ Descartada'
        } else {
            badgeStyle = 'color:#92400e;background:#fef3c7;border-radius:4px;padding:2px 8px;font-size:11px;white-space:nowrap'
            badgeText  = '⏳ Pendiente'
        }

        const esCargada     = idx === _lineaActualIndex
        const btnCargarStyle = `font-size:12px;min-height:44px;padding:6px 12px${esCargada ? ';background:var(--accent);color:#fff;border-color:var(--accent)' : ''}`
        const acciones = estado === 'pendiente'
            ? `<div style="display:flex;gap:6px">
                   <button class="btn btn-secondary conv-cargar" data-idx="${idx}" style="${btnCargarStyle}">↓ Cargar</button>
                   <button class="btn btn-secondary conv-descartar" data-idx="${idx}" style="font-size:12px;min-height:44px;padding:6px 10px;color:var(--accent)">✕</button>
               </div>`
            : ''

        return `<tr style="border-bottom:1px solid #dbeafe">
            <td style="padding:8px;font-size:13px">${resumen}</td>
            <td style="padding:8px;white-space:nowrap"><span style="${badgeStyle}">${badgeText}</span></td>
            <td style="padding:8px;white-space:nowrap">${acciones}</td>
        </tr>`
    }).join('')

    wrapper.innerHTML = `
        <table style="width:100%;border-collapse:collapse">
            <thead>
                <tr style="border-bottom:2px solid #bfdbfe">
                    <th style="text-align:left;padding:6px 8px;font-size:11px;color:#3b82f6;font-weight:600;text-transform:uppercase">Línea</th>
                    <th style="text-align:left;padding:6px 8px;font-size:11px;color:#3b82f6;font-weight:600;text-transform:uppercase;white-space:nowrap">Estado</th>
                    <th style="padding:6px 8px;width:130px"></th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    `

    wrapper.querySelectorAll('.conv-cargar').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx)
            _lineaActualIndex = idx
            _cargarLineaEnBloque2(_draftConversion[idx])
            _renderTablaConversion()
            document.getElementById('bloque-reserva')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
    })

    wrapper.querySelectorAll('.conv-descartar').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idx = parseInt(btn.dataset.idx)
            if (!confirm('¿Descartar esta línea?')) return
            _draftConversion[idx].estado = 'descartada'
            if (_lineaActualIndex === idx) {
                _lineaActualIndex = null
                limpiarFormularioReserva()
                solicitudOriginRef = _solicitudWEBRef
            }
            await _persistirEstadoLineas()
            const todasResueltas = _draftConversion.every(l => l.estado === 'hecha' || l.estado === 'descartada')
            if (todasResueltas) {
                await _finalizarConversion()
            } else {
                _renderTablaConversion()
            }
        })
    })
}

function _cargarLineaEnBloque2(linea) {
    limpiarFormularioReserva()
    solicitudOriginRef = _solicitudWEBRef  // restaurar tras limpiar

    if (linea.service_id) {
        selectServicio.value = linea.service_id
        selectServicio.dispatchEvent(new Event('change'))
    }
    if (linea.slots != null) inputPlazas.value = linea.slots

    setTimeout(() => {
        if (linea.venue_id) {
            selectProveedor.value = linea.venue_id
            selectProveedor.dispatchEvent(new Event('change'))
        }
        if (linea.price != null) {
            setPrecioValue(inputPrecio, linea.price)
            validarPrecio()
            actualizarTotal()
            actualizarBtnAnadir()
        }
    }, 100)
}

async function _persistirEstadoLineas() {
    await supabase.from('reservation_requests')
        .update({ proposal_draft: _draftConversion })
        .eq('id', _solicitudConversionId)
}

async function _onLineaGuardada() {
    _draftConversion[_lineaActualIndex].estado = 'hecha'
    await _persistirEstadoLineas()

    const todasResueltas = _draftConversion.every(l => l.estado === 'hecha' || l.estado === 'descartada')
    limpiarFormularioReserva()
    _lineaActualIndex = null

    if (todasResueltas) {
        solicitudOriginRef = null
        await _finalizarConversion()
    } else {
        solicitudOriginRef = _solicitudWEBRef  // mantener para próximas líneas
        _renderTablaConversion()
    }
}

async function _finalizarConversion() {
    await supabase.from('reservation_requests')
        .update({ status: 'convertida' })
        .eq('id', _solicitudConversionId)

    const hechas     = _draftConversion.filter(l => l.estado === 'hecha').length
    const descartadas = _draftConversion.filter(l => l.estado === 'descartada').length
    const sufHechas   = hechas !== 1 ? 's' : ''
    const textoDesc   = descartadas > 0 ? `, ${descartadas} descartada${descartadas !== 1 ? 's' : ''}` : ''
    const resumen     = `✅ Conversión completada — ${hechas} reserva${sufHechas} creada${sufHechas}${textoDesc}`

    const bloque = document.getElementById('bloque-conversion-propuesta')
    if (bloque) {
        bloque.style.cssText = 'background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin-bottom:16px'
        bloque.innerHTML = `
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                <span style="font-size:14px">${resumen}</span>
                <a href="solicitudes.html" class="btn btn-secondary"
                   style="font-size:13px;text-decoration:none;display:inline-flex;align-items:center;min-height:44px">
                    Volver a solicitudes
                </a>
            </div>
        `
    }

    _modoConversionActivo  = false
    _solicitudConversionId = null
    _solicitudWEBRef       = null
}

// ===== ASISTENTE DE BIENVENIDAS =====

function _initBloqueColaBienvenidas(ids) {
    _modoColaBienvenidas = true
    _colaClienteIds      = ids
    _colaSaltadas        = new Set()

    let bloque = document.getElementById('bloque-cola-bienvenidas')
    if (!bloque) {
        bloque = document.createElement('div')
        bloque.id        = 'bloque-cola-bienvenidas'
        bloque.className = 'bloque'
        document.getElementById('bloque-cliente').before(bloque)
    }
    _renderTablaColaBienvenidas()
}

function _renderTablaColaBienvenidas() {
    const bloque = document.getElementById('bloque-cola-bienvenidas')
    if (!bloque) return

    const pendientes = _colaClienteIds.filter(id => {
        if (_colaSaltadas.has(id)) return false
        const confirmadas = todasReservas.filter(r => r.client_id === id && r.status === 'Confirmada')
        return confirmadas.length > 0 && !confirmadas.every(r => r.welcome_sent_at)
    })
    const enviadas = _colaClienteIds.filter(id => {
        const confirmadas = todasReservas.filter(r => r.client_id === id && r.status === 'Confirmada')
        return confirmadas.length > 0 && confirmadas.every(r => r.welcome_sent_at)
    })

    if (pendientes.length === 0) {
        bloque.style.cssText = 'background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin-bottom:16px'
        const nEnv  = enviadas.length
        const nSalt = _colaSaltadas.size
        bloque.innerHTML = `
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                <span style="font-size:20px">✅</span>
                <div>
                    <strong>Bienvenidas completadas</strong>
                    <div style="font-size:13px;color:var(--subtle);margin-top:2px">${nEnv} enviada${nEnv !== 1 ? 's' : ''}${nSalt > 0 ? `, ${nSalt} saltada${nSalt !== 1 ? 's' : ''}` : ''}</div>
                </div>
                <button id="cola-btn-cerrar" class="btn btn-secondary" style="margin-left:auto">Cerrar</button>
            </div>`
        bloque.querySelector('#cola-btn-cerrar').addEventListener('click', () => {
            _modoColaBienvenidas = false
            bloque.remove()
        })
        return
    }

    bloque.style.cssText = 'background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:16px'

    const filas = _colaClienteIds.map(id => {
        const esSfcom = todasReservas.some(r => r.client_id === id && r.origin_ref?.startsWith('WEB'))
        const canal   = esSfcom ? ' <span style="color:#dc2626;font-size:11px">[sfcom]</span>' : ''
        const confirmadas = todasReservas.filter(r => r.client_id === id && r.status === 'Confirmada')
        const yaEnviada   = confirmadas.length > 0 && confirmadas.every(r => r.welcome_sent_at)

        if (yaEnviada) {
            return `<tr style="color:var(--subtle)">
                <td><code>${id}</code>${canal}</td>
                <td style="color:#16a34a;white-space:nowrap">✅ Enviada</td>
                <td></td>
            </tr>`
        }
        if (_colaSaltadas.has(id)) {
            return `<tr style="color:var(--subtle)">
                <td><code>${id}</code>${canal}</td>
                <td style="white-space:nowrap">— Saltada</td>
                <td></td>
            </tr>`
        }
        const esCargada  = clienteActual?.id === id
        const btnCargar  = `background:${esCargada ? 'var(--accent);color:#fff;border-color:var(--accent)' : 'inherit'}`
        return `<tr>
            <td><code>${id}</code>${canal}</td>
            <td style="white-space:nowrap;color:var(--accent-warn)">⏳ Pendiente</td>
            <td style="display:flex;gap:6px">
                <button class="btn btn-secondary cola-cargar" data-id="${id}" style="font-size:12px;${btnCargar}">↓ Cargar</button>
                <button class="btn btn-secondary cola-saltar" data-id="${id}" style="font-size:12px">Saltar</button>
            </td>
        </tr>`
    }).join('')

    const total = _colaClienteIds.length
    const n     = pendientes.length
    bloque.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h2 style="margin:0;font-size:16px;color:#1d4ed8">📩 Asistente de bienvenidas — ${n} pendiente${n !== 1 ? 's' : ''} de ${total}</h2>
            <button id="cola-btn-cancelar" class="btn btn-secondary" style="font-size:12px">✕ Cancelar</button>
        </div>
        <div class="table-wrapper"><table><tbody>${filas}</tbody></table></div>`

    bloque.querySelector('#cola-btn-cancelar').addEventListener('click', () => {
        if (!confirm('¿Cancelar el asistente de bienvenidas?')) return
        _modoColaBienvenidas = false
        bloque.remove()
    })
    bloque.querySelectorAll('.cola-cargar').forEach(btn => {
        btn.addEventListener('click', () => {
            const c = todosClientes.find(c => c.id === btn.dataset.id)
            if (c) {
                inputId.value = c.id
                cargarCliente(c)
                _renderTablaColaBienvenidas()
                document.getElementById('bloque-cliente')?.scrollIntoView({ behavior: 'smooth' })
            }
        })
    })
    bloque.querySelectorAll('.cola-saltar').forEach(btn => {
        btn.addEventListener('click', () => {
            _colaSaltadas.add(btn.dataset.id)
            if (clienteActual?.id === btn.dataset.id) limpiarFormularioReserva()
            _renderTablaColaBienvenidas()
        })
    })
}

function _onBienvenidaEnviada() {
    if (!_modoColaBienvenidas) return
    _renderTablaColaBienvenidas()
}

// Si venimos de solicitudes.html con ?solicitud_id=uuid, pre-cargar datos
;(async () => {
    const solicitudId = new URLSearchParams(location.search).get('solicitud_id')
    if (!solicitudId) return
    const { data: sol } = await supabase.from('reservation_requests').select('*').eq('id', solicitudId).single()
    if (!sol) return
    const d0 = sol.proposal_draft?.[0] ?? null
    await cargarDesdeSolicitud({
        id:             sol.id,
        source:         sol.source || '',
        nombre:         sol.client_name    || '',
        email:          sol.client_email   || '',
        telefono:       sol.client_phone   || '',
        address:        sol.client_address || '',
        level:          d0?.service_name || '',
        serviceId:      d0?.service_id || '',
        day:            String(d0?.day || ''),
        slots:          String(d0?.slots || ''),
        pricePerSlot:   String(d0?.price || ''),
        comments:       sol.comments || '',
        proposal_draft: sol.proposal_draft || []
    })
    // Para web/email (no sfcom): cargarDesdeSolicitud deja solicitudOriginRef = null,
    // así que guardamos el UUID de la solicitud como referencia.
    // Para sfcom: cargarDesdeSolicitud ya puso el WEB ref — no sobreescribir.
    // Para multi-línea: _modoConversionActivo = true — no aplica.
    if (!_modoConversionActivo && !solicitudOriginRef) solicitudOriginRef = sol.id
})()

// Cola de bienvenidas enviada desde el panel de control
{
    const raw = sessionStorage.getItem('colaBienvenidas')
    if (raw) {
        sessionStorage.removeItem('colaBienvenidas')
        try {
            const ids = JSON.parse(raw)
            if (Array.isArray(ids) && ids.length > 0) _initBloqueColaBienvenidas(ids)
        } catch {}
    }
}

// Comprobar pedidos nuevos en sfcom y luego verificar coherencia.
// El orden es importante: los pedidos registrados por checkSfcomOrders influyen
// en pendingExplains de verificarCoherencia (solicitudes sfcom pendientes que
// explican discrepancias de stock). Si se ejecutaran en paralelo, la verificación
// podría reportar discrepancias reales que en realidad están explicadas por pedidos
// que aún no se habían registrado.
checkSfcomOrders(supabase)
    .then(async resultado => {
        if (resultado.ok && resultado.cancelados?.length) {
            await importarCanceladosSfcom(supabase, sfcomListings, resultado.cancelados)
        }
        if (resultado.ok && resultado.nuevos?.length) {
            await registrarPedidosSfcom(resultado.nuevos)
        }
        await cargarSolicitudes()
    })
    .catch(e => {
        console.warn('[sfcom] checkSfcomOrders al inicio:', e.message)
        cargarSolicitudes()
    })
    .finally(() => {
        ejecutarVerificacion(supabase, { modoManual: false, incluirSfcom: true, incluirFinanciero: false, season: getTemporadaActiva() })
            .catch(e => console.error('[verificacion] Error al inicio:', e.message))
    })

document.getElementById('btnVerificarDatos').addEventListener('click', () => {
    ejecutarVerificacion(supabase, { modoManual: true, incluirSfcom: true, incluirFinanciero: true, persistirCobros: persistirCobrosCliente, persistirPagos: persistirPagosProveedor, season: getTemporadaActiva() })
        .catch(e => console.error('[verificacion] Error:', e.message))
})

document.getElementById('btnExportReservasCliente')?.addEventListener('click', () => {
    const id = clienteActual?.id ?? 'cliente'
    exportTable(reservasCliente, [
        { key: 'id',             label: 'ID reserva' },
        { key: 'service_id',     label: 'Servicio' },
        { key: 'venue_id',       label: 'Venue' },
        { key: 'slots',          label: 'Plazas' },
        { key: 'price_per_slot', label: '€/plaza',    fmt: v => fmt(v) },
        { key: 'total_amount',   label: 'Total',      fmt: v => fmt(v) },
        { key: 'status',         label: 'Estado' },
        { key: 'comments',       label: 'Comentarios' },
        { key: 'origin_ref',label: 'Ref. sfcom' },
    ], `reservas_${id}.xlsx`)
})

// Precarga de cliente desde parámetro URL (ej: panel.html → formulario.html?cliente=GARCIA_PEDRO)
const _clienteParam = new URLSearchParams(location.search).get('cliente')
if (_clienteParam) {
    const _clientePreload = todosClientes.find(c => c.id === _clienteParam.toUpperCase())
    if (_clientePreload) { inputId.value = _clientePreload.id; cargarCliente(_clientePreload) }
}

// Precarga desde solicitudes.html via query params
// Se activa cuando hay client_name o service_id pero no el parámetro ?cliente= de panel.html
const _solP         = new URLSearchParams(location.search)
const _solName      = _solP.get('client_name')
const _solServiceId = _solP.get('service_id')

if (!_clienteParam && (_solName || _solServiceId)) {
    _cargandoSolicitud = true

    if (_solName) {
        const nombreBase = _solName.toUpperCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^A-Z0-9\s]/g, '').trim().replace(/\s+/g, '_')

        const resolucion = resolverCliente(
            { nombre: _solName, email: _solP.get('client_email'), telefono: _solP.get('client_phone') },
            todosClientes
        )

        let _clienteResuelto = null
        if (resolucion.match === 'exacto') {
            _clienteResuelto = resolucion.cliente
        } else if (resolucion.match === 'ambiguo') {
            _clienteResuelto = await _confirmarClienteAmbiguo(resolucion.candidatos)
        }

        if (_clienteResuelto) {
            inputId.value = _clienteResuelto.id
            cargarCliente(_clienteResuelto)
            mostrarToast(`Cliente existente: ${_clienteResuelto.id}`)
        } else {
            let clienteId = nombreBase, sufijo = 2
            while (todosClientes.find(c => c.id === clienteId)) { clienteId = nombreBase + '_' + sufijo; sufijo++ }
            inputId.value      = clienteId
            inputName.value    = _solName
            inputEmail.value   = _solP.get('client_email') || ''
            inputPhone.value   = _solP.get('client_phone') || ''
            clienteActual = null
            statusDiv.innerHTML = '✨ Cliente nuevo &nbsp;—&nbsp; '
                + '<a href="#" style="font-size:inherit;color:inherit;text-decoration:underline;cursor:pointer"'
                + ' onclick="guardarClienteNuevo(event)">Guardar cliente</a>'
                + ' o se guardará al añadir una reserva'
            statusDiv.style.color = 'var(--accent-warn)'
        }
    }
    if (_solServiceId) {
        const svcUpper = _solServiceId.toUpperCase()
        const existe   = servicios.find(s => s.service_code === svcUpper)
        if (existe) {
            selectServicio.value = existe.id
            selectServicio.dispatchEvent(new Event('change'))

            const _solVenueId = _solP.get('venue_id')
            if (_solVenueId) {
                setTimeout(() => {
                    selectProveedor.value = _solVenueId
                    selectProveedor.dispatchEvent(new Event('change'))
                }, 100)
            } else {
                // Auto-seleccionar si solo hay un venue para este servicio
                const venuesServicio = disponibilidad.filter(d => d.service_id === existe.id)
                if (venuesServicio.length === 1) {
                    setTimeout(() => {
                        selectProveedor.value = venuesServicio[0].venue_id
                        selectProveedor.dispatchEvent(new Event('change'))
                    }, 100)
                }
            }
        }
    }

    if (_solP.get('slots')) inputPlazas.value = _solP.get('slots')

    _cargandoSolicitud = false
    setTimeout(() => actualizarBtnAnadir(), 200)
    document.getElementById('bloque-cliente').scrollIntoView({ behavior: 'smooth' })
}

