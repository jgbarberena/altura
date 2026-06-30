import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { fmt, initSidebar, normalizarId, buscarConPrioridad, persistirCobrosCliente, persistirPagosProveedor, initAutoSave, renderClientChips, exportTable, buildCatalogUrl, abrirRenombrarId, initTemporada, getTemporadaActiva, confirmarSiTemporadaNoActiva, fechaPagoDefault } from './utils.js'
import { mostrarToast, ejecutarVerificacion } from './verificacion.js'
import { crearModal } from './modal.js'
import { syncStockToSfcom, computeExpectedStock, mostrarModalConfirmacionSfcom, confirmarStockSfcom, verificarConfirmarSfcom, editarNombreSfcom, mostrarModalCorreoHilario, mostrarModalCorreoCancelacionSfcom, mostrarModalCorreoBajaSfcom, verificarBajaSfcom } from './sfcom.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
document.getElementById('btnVerificarDatos')?.addEventListener('click', () => ejecutarVerificacion(supabase, { modoManual: true, incluirSfcom: true, incluirFinanciero: true, persistirCobros: persistirCobrosCliente, persistirPagos: persistirPagosProveedor, season: getTemporadaActiva() }))
initSidebar()

// ===== DATOS GLOBALES =====

// Inicializar sistema de temporadas
const { data: _tmpSeason }  = await supabase.from('services').select('season').order('season', { ascending: false })
const _todasTemporadas      = [...new Set((_tmpSeason ?? []).map(r => r.season))]
await initTemporada(_todasTemporadas)
const _temporada            = getTemporadaActiva()

let todosProveedores   = (await supabase.from('providers').select('*').order('id')).data
let todosVenues        = (await supabase.from('venues').select('*').order('id')).data
let todosServicios     = (await supabase.from('services').select('*').eq('season', _temporada).order('service_code')).data
let todaDisponibilidad = (await supabase.from('availability_panel').select('*').eq('season', _temporada)).data
let todosPayments      = (await supabase.from('payments').select('*').eq('season', _temporada)).data
const _servicioIds     = (todosServicios ?? []).map(s => s.id)
let todasReservas      = _servicioIds.length > 0
    ? (await supabase.from('reservations').select('*').in('service_id', _servicioIds)).data ?? []
    : []

// Enriquecer con datos sfcom desde sfcom_listings (availability_panel no los incluye)
const { data: _sfcomRaw } = await supabase.from('sfcom_listings')
    .select('id, availability_id, sfcom_service_name, sfcom_slots_listed, sfcom_product_id, sfcom_variation_id, sfcom_status, sfcom_public_price')
const _sfcomByAvailId = new Map((_sfcomRaw || []).map(r => [r.availability_id, r]))
for (const d of (todaDisponibilidad || [])) {
    const sl = _sfcomByAvailId.get(d.id)
    d.sfcom_service_name  = sl?.sfcom_service_name  ?? null
    d.sfcom_slots_listed  = sl?.sfcom_slots_listed  ?? null
    d.sfcom_product_id    = sl?.sfcom_product_id    ?? null
    d.sfcom_variation_id  = sl?.sfcom_variation_id  ?? null
    d.sfcom_status        = sl?.sfcom_status        ?? null
    d.sfcom_public_price  = sl?.sfcom_public_price  ?? null
    d.sfcom_listing_id    = sl?.id                  ?? null
}

// venue_provider_id no está en ninguna vista — se deriva desde venues para la UI del panel
const _venueProv = new Map((todosVenues || []).map(v => [v.id, v.provider_id]))
for (const d of (todaDisponibilidad || [])) d.venue_provider_id = _venueProv.get(d.venue_id) ?? null

let proveedorActual      = null
let servicioEditandoId   = null
let serviciosEditandoIds = []
let hitosProvTemp        = []
let ultimoCampoActivo    = 'precio'
let venuesDelProveedor   = []
let venueActual          = null
let _wizardFilas         = []
let _wizardVenueActivo   = null
let _wizardVenueGroups   = {}
let _wizardSortCol       = 'day'
let _wizardSortDir       = 'asc'

const hoy = new Date().toISOString().split('T')[0]


// ===== REFERENCIAS DOM =====
const inputProveedorId         = document.getElementById('inputProveedorId')
const inputNombre              = document.getElementById('inputNombre')
const inputDireccion           = document.getElementById('inputDireccion')
const inputVenueDireccion      = document.getElementById('inputVenueDireccion')
const inputVenueDisplayName    = document.getElementById('inputVenueDisplayName')
const inputVenueComments       = document.getElementById('inputVenueComments')
const selectVenueType          = document.getElementById('selectVenueType')
const selectFormaPago          = document.getElementById('selectFormaPago')
const checkFactura             = document.getElementById('checkFactura')
const inputProveedorEmail      = document.getElementById('inputProveedorEmail')
const inputProveedorPhone      = document.getElementById('inputProveedorPhone')
const inputProveedorComments   = document.getElementById('inputProveedorComments')
const autoProvList             = document.getElementById('autocompleteProveedorList')
const proveedorStatus          = document.getElementById('proveedor-status')
const btnRenombrarProveedor    = document.getElementById('btnRenombrarProveedor')
const servicioDescStatus       = document.getElementById('servicio-desc-status')
const inputServicioId          = document.getElementById('inputServicioId')
const inputPlazas              = document.getElementById('inputPlazas')
const inputPrecio              = document.getElementById('inputPrecio')
const inputServicioNombre      = document.getElementById('inputServicioNombre')
const inputServicioDescription = document.getElementById('inputServicioDescription')
const inputServicioImageUrl    = document.getElementById('inputServicioImageUrl')
const servicioImgPreview       = document.getElementById('servicioImgPreview')
const servicioImgEmpty         = document.getElementById('servicioImgEmpty')
const inputAvailDesc           = document.getElementById('inputAvailDesc')
const inputAccessInstructions  = document.getElementById('inputAccessInstructions')
const inputServicioComments    = document.getElementById('inputServicioComments')
const btnRenombrarServicio     = document.getElementById('btnRenombrarServicio')
const inputServicioDia         = document.getElementById('selectServicioDia')
const inputServicioHora        = document.getElementById('inputServicioHora')

inputServicioNombre.addEventListener('change',      guardarDescripcionServicio)
inputServicioDescription.addEventListener('change', guardarDescripcionServicio)
inputServicioImageUrl.addEventListener('change',    guardarDescripcionServicio)
inputServicioImageUrl.addEventListener('input',     _syncServicioImgPreview)
inputServicioHora.addEventListener('change',        guardarDescripcionServicio)

btnRenombrarProveedor.addEventListener('click', () => {
    const idViejo = proveedorActual.id
    abrirRenombrarId({
        tabla: 'providers', idActual: idViejo, supabase,
        onSuccess: nuevoId => {
            const p = todosProveedores.find(p => p.id === idViejo)
            if (p) p.id = nuevoId
            todosVenues.filter(v => v.provider_id === idViejo).forEach(v => v.provider_id = nuevoId)
            proveedorActual.id = nuevoId
            inputProveedorId.value = nuevoId
            mostrarToast(`Proveedor renombrado: ${nuevoId}`)
        }
    })
})

btnRenombrarServicio.addEventListener('click', () => {
    if (!servicioEditandoId) return
    const disp = todaDisponibilidad.find(d => d.id === servicioEditandoId)
    if (!disp) return
    const svcIntId  = disp.service_id
    const svc       = todosServicios.find(s => s.id === svcIntId)
    if (!svc) return
    const codeViejo = svc.service_code
    const { overlay, panel } = crearModal('modal-renombrar-servicio', { narrow: true })
    panel.innerHTML = `
        <h2 style="margin-bottom:12px">Renombrar código de servicio</h2>
        <div style="margin-bottom:12px">
            <label style="font-size:13px;display:block;margin-bottom:4px">Nuevo código (actual: <strong>${codeViejo}</strong>)</label>
            <input type="text" id="inputNuevoCodeSvc" class="form-input" value="${codeViejo}" style="text-transform:uppercase;width:100%;box-sizing:border-box">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="btnCancelarRenSvc" class="btn btn-secondary">Cancelar</button>
            <button id="btnConfirmarRenSvc" class="btn btn-primary">Renombrar</button>
        </div>`
    panel.querySelector('#btnCancelarRenSvc').addEventListener('click', () => overlay.close())
    panel.querySelector('#btnConfirmarRenSvc').addEventListener('click', async () => {
        const nuevoCode = panel.querySelector('#inputNuevoCodeSvc').value.trim().toUpperCase()
        if (!nuevoCode || nuevoCode === codeViejo) { overlay.close(); return }
        if (todosServicios.find(s => s.service_code === nuevoCode)) {
            alert(`Ya existe un servicio con el código ${nuevoCode}.`)
            return
        }
        const { error } = await supabase.from('services').update({ service_code: nuevoCode }).eq('id', svcIntId)
        if (error) { alert('Error al renombrar: ' + error.message); return }
        svc.service_code = nuevoCode
        todaDisponibilidad.forEach(d => { if (d.service_id === svcIntId) d.service_code = nuevoCode })
        inputServicioId.value = nuevoCode
        if (proveedorActual) renderTablaServicios(proveedorActual.id)
        overlay.close()
        mostrarToast(`Servicio renombrado: ${nuevoCode}`)
    })
})

function _renombrarVenueActual() {
    if (!venueActual) return
    const idViejo = venueActual.id
    abrirRenombrarId({
        tabla: 'venues', idActual: idViejo, supabase,
        onSuccess: nuevoId => {
            const v = todosVenues.find(v => v.id === idViejo)
            if (v) v.id = nuevoId
            const vp = venuesDelProveedor.find(v => v.id === idViejo)
            if (vp) vp.id = nuevoId
            venueActual.id = nuevoId
            renderVenueTabs(venuesDelProveedor, nuevoId)
            mostrarToast(`${(_VENUE_LABELS[venueActual?.venue_type] ?? _VENUE_LABELS.balcon).toast}: ${nuevoId}`)
        }
    })
}

document.getElementById('venue-sep').addEventListener('click', e => {
    if (e.target.closest('.btn-rename-venue')) { _renombrarVenueActual(); return }
    if (e.target.closest('.btn-add-venue'))    { abrirDialogNuevoVenue(); return }
    const tab = e.target.closest('.venue-tab')
    if (tab) selectVenueTab(tab.dataset.venueId)
})

// ===== FOTOS DEL BALCÓN (carousel) =====
let _photos  = []
let _photoIdx = 0

function _renderCarousel() {
    const img      = document.getElementById('photoCarouselImg')
    const empty    = document.getElementById('photoCarouselEmpty')
    const counter  = document.getElementById('photoCarouselCounter')
    const btnPrev  = document.getElementById('btnPhotoPrev')
    const btnNext  = document.getElementById('btnPhotoNext')
    const btnDel   = document.getElementById('btnPhotoDel')
    const btnUp    = document.getElementById('btnPhotoUp')
    if (_photos.length === 0) {
        img.style.display    = 'none'
        empty.style.display  = 'block'
        counter.textContent  = '0 / 0'
        btnPrev.disabled     = true
        btnNext.disabled     = true
        btnDel.style.display = 'none'
        btnUp.style.display  = 'none'
        return
    }
    _photoIdx = Math.max(0, Math.min(_photoIdx, _photos.length - 1))
    img.src             = _photos[_photoIdx]
    img.style.display   = 'block'
    empty.style.display = 'none'
    counter.textContent  = `${_photoIdx + 1} / ${_photos.length}`
    btnPrev.disabled     = _photoIdx === 0
    btnNext.disabled     = _photoIdx === _photos.length - 1
    btnDel.style.display = 'inline-block'
    btnUp.style.display  = 'inline-block'
    btnUp.disabled       = _photoIdx === 0
}

async function _savePhotos(esPrimeraFoto = false) {
    if (!servicioEditandoId) return
    const payload = _photos.length ? _photos : null
    const { error } = await supabase.from('availability')
        .update({ photos: payload })
        .eq('id', servicioEditandoId)
    if (error) { console.error('Error al guardar fotos:', error.message); return }
    const d = todaDisponibilidad.find(d => d.id === servicioEditandoId)
    if (d) d.photos = payload
    mostrarGuardado()
    if (esPrimeraFoto && _photos.length === 1 && !inputServicioImageUrl.value.trim()) {
        const svc = todosServicios.find(s => s.service_code === inputServicioId.value.trim().toUpperCase())
        if (svc && !svc.image_url) {
            inputServicioImageUrl.value = _photos[0]
            _syncServicioImgPreview()
            await supabase.from('services').update({ image_url: _photos[0] }).eq('id', svc.id)
            svc.image_url = _photos[0]
        }
    }
}

document.getElementById('btnPhotoPrev').addEventListener('click', () => {
    _photoIdx = Math.max(0, _photoIdx - 1)
    _renderCarousel()
})
document.getElementById('btnPhotoNext').addEventListener('click', () => {
    _photoIdx = Math.min(_photos.length - 1, _photoIdx + 1)
    _renderCarousel()
})
document.getElementById('btnPhotoDel').addEventListener('click', async () => {
    if (_photos.length === 0) return
    _photos.splice(_photoIdx, 1)
    if (_photoIdx > 0 && _photoIdx >= _photos.length) _photoIdx--
    _renderCarousel()
    await _savePhotos()
})
document.getElementById('btnPhotoUp').addEventListener('click', async () => {
    if (_photoIdx === 0 || _photos.length < 2) return
    _photos.splice(_photoIdx - 1, 0, _photos.splice(_photoIdx, 1)[0])
    _photoIdx--
    _renderCarousel()
    await _savePhotos()
})
document.getElementById('btnPhotoAdd').addEventListener('click', async () => {
    const url = document.getElementById('inputPhotoUrl').value.trim()
    if (!url) return
    const esPrimera = _photos.length === 0
    _photos.push(url)
    _photoIdx = _photos.length - 1
    document.getElementById('inputPhotoUrl').value = ''
    _renderCarousel()
    await _savePhotos(esPrimera)
})

// ── Upload foto desde archivo (FTP vía Edge Function) ──────────────────────
async function _subirFotoArchivo(file) {
    const form = new FormData()
    form.append('file', file)
    const { data, error } = await supabase.functions.invoke('upload-venue-photo', { body: form })
    if (error) throw error
    if (!data?.url) throw new Error('Sin URL en la respuesta')
    return data.url
}
document.getElementById('btnUploadFoto').addEventListener('click', () => {
    document.getElementById('inputFotoArchivo').click()
})
document.getElementById('inputFotoArchivo').addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const btn = document.getElementById('btnUploadFoto')
    btn.disabled = true
    btn.textContent = '⏳'
    try {
        const url = await _subirFotoArchivo(file)
        const esPrimera = _photos.length === 0
        _photos.push(url)
        _photoIdx = _photos.length - 1
        document.getElementById('photoCarouselField').style.display = 'flex'
        _renderCarousel()
        await _savePhotos(esPrimera)
    } catch (err) {
        alert('Error al subir la foto: ' + err.message)
    } finally {
        btn.disabled = false
        btn.textContent = '📁'
        e.target.value = ''
    }
})

function _syncServicioImgPreview() {
    const url = inputServicioImageUrl.value.trim()
    if (url) {
        servicioImgPreview.src           = url
        servicioImgPreview.style.display = 'block'
        servicioImgEmpty.style.display   = 'none'
    } else {
        servicioImgPreview.src           = ''
        servicioImgPreview.style.display = 'none'
        servicioImgEmpty.style.display   = 'block'
    }
}

// ===== TABS PAR / SERVICIO =====

function _seleccionarTabAvail(tabName, mostrarAviso = true) {
    document.querySelectorAll('.avail-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.availTab === tabName)
    })
    document.getElementById('avail-panel-par').style.display      = tabName === 'par'      ? '' : 'none'
    document.getElementById('avail-panel-servicio').style.display = tabName === 'servicio' ? '' : 'none'
    const avisoDiv   = document.getElementById('avail-tab-aviso')
    const avisoTexto = document.getElementById('avail-tab-aviso-texto')
    if (mostrarAviso) {
        const esBalcon   = venueActual?.venue_type === 'balcon'
        const esNoDefault = (esBalcon && tabName === 'servicio') || (!esBalcon && tabName === 'par')
        if (esNoDefault) {
            avisoTexto.textContent = esBalcon
                ? 'Editar aquí afecta a TODOS los venues y días de este servicio, no solo a este balcón.'
                : 'Si hay contenido aquí, anula la información general del servicio para este caso concreto.'
            avisoDiv.style.display = 'flex'
        } else {
            avisoDiv.style.display = 'none'
        }
    } else {
        avisoDiv.style.display = 'none'
    }
}

function _actualizarBadgesTabs() {
    const hasPar      = !!(inputAvailDesc.value.trim() || inputAccessInstructions.value.trim() || _photos.length > 0)
    const hasServicio = !!(inputServicioNombre.value.trim() || inputServicioDescription.value.trim() || inputServicioImageUrl.value.trim())
    document.getElementById('badge-tab-par').style.display      = hasPar      ? '' : 'none'
    document.getElementById('badge-tab-servicio').style.display = hasServicio ? '' : 'none'
}

function _initAvailTabs(isBalcon) {
    _seleccionarTabAvail(isBalcon ? 'par' : 'servicio', false)
    _actualizarBadgesTabs()
}

document.getElementById('avail-sep').addEventListener('click', e => {
    const tab = e.target.closest('.avail-tab')
    if (!tab) return
    _seleccionarTabAvail(tab.dataset.availTab)
    _actualizarBadgesTabs()
})

document.getElementById('avail-tab-aviso-cerrar').addEventListener('click', () => {
    document.getElementById('avail-tab-aviso').style.display = 'none'
})

inputServicioDia.addEventListener('change', () => {
    const val     = inputServicioId.value.trim().toUpperCase()
    const warning = document.getElementById('servicio-dia-warning')
    if (!val) return

    if (servicioEditandoId) {
        const diaId  = _extraerDiaDeId(val)
        const diaSel = inputServicioDia.value ? parseInt(inputServicioDia.value) : null
        if (diaId && diaSel && diaId !== diaSel) {
            warning.textContent  = `⚠ El ID tiene _${diaId} pero seleccionaste día ${diaSel}. El ID no se cambia en modo edición.`
            warning.style.display = 'block'
        } else {
            warning.style.display = 'none'
        }
        return
    }

    const existe = todosServicios.find(s => s.service_code === val)
    const base   = val.replace(/_(6|7|8|9|10|11|12|13|14)$/i, '')
    const diaSel = inputServicioDia.value ? parseInt(inputServicioDia.value) : null
    const newId  = diaSel ? `${base}_${diaSel}` : base
    warning.style.display = 'none'

    if (!existe && newId !== val) {
        inputServicioId.value = newId
        inputServicioId.dispatchEvent(new Event('input'))
    }
})

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
        .filter(d => d.venue_provider_id === proveedorActual?.id &&
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
        const venueId     = disp?.venue_id ?? proveedorActual.id
        const svcIntIdSfcom = disp?.service_id ?? serviceId
        const sfcomOk = await confirmarStockSfcom(supabase, [{ venueId, serviceId: svcIntIdSfcom }])
        if (sfcomOk === 'sync') await syncStockToSfcom(supabase, venueId, svcIntIdSfcom)
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
        .filter(d => d.venue_provider_id === proveedorActual?.id &&
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
    inputProveedorEmail.value    = p.email           ?? ''
    inputProveedorPhone.value    = p.phone           ?? ''
    inputProveedorComments.value = p.comments        ?? ''
    venuesDelProveedor = todosVenues.filter(v => v.provider_id === p.id)
    venueActual        = venuesDelProveedor[0] ?? null
    inputVenueDireccion.value   = venueActual?.address      ?? ''
    inputVenueDisplayName.value = venueActual?.display_name ?? ''
    inputVenueComments.value    = venueActual?.comments     ?? ''
    selectVenueType.value       = venueActual?.venue_type   ?? 'balcon'
    renderVenueTabs(venuesDelProveedor, venueActual?.id ?? null)
    proveedorStatus.textContent  = '✅ Proveedor existente — los cambios se guardan automáticamente'
    proveedorStatus.style.color  = 'var(--accent-ok)'
    btnRenombrarProveedor.style.display = 'inline-flex'
    document.getElementById('bloque-servicio').style.display = 'block'
    limpiarFormularioServicio()
    document.getElementById('btnAsistenteNuevo').style.display = 'inline-block'
    document.getElementById('btnAbrirMultiple').style.display = 'inline-block'
    cargarServiciosProveedor(p.id)
    cargarPagosProveedor(p.id)
    const _dispTotales = todaDisponibilidad.filter(d => venuesDelProveedor.some(v => v.id === d.venue_id))
    const _wizDiv = document.getElementById('bloque-wizard')
    if (_dispTotales.length === 0) {
        document.getElementById('wizard-temporada-txt').textContent = _temporada
        _wizDiv.style.display = 'block'
    } else {
        _wizDiv.style.display = 'none'
    }
}

function limpiarProveedor() {
    proveedorActual = null
    btnRenombrarProveedor.style.display = 'none'
    limpiarCamposProveedor()
    proveedorStatus.textContent = ''
    document.getElementById('bloque-servicio').style.display            = 'none'
    document.getElementById('bloque-servicios-proveedor').style.display = 'none'
    document.getElementById('bloque-pagos-proveedor').style.display     = 'none'
    document.getElementById('bloque-wizard').style.display              = 'none'
    limpiarFormularioServicio()
}

function limpiarCamposProveedor() {
    inputNombre.value              = ''
    inputDireccion.value           = ''
    inputVenueDireccion.value      = ''
    inputVenueDisplayName.value    = ''
    inputVenueComments.value       = ''
    selectVenueType.value          = 'balcon'
    selectFormaPago.value          = ''
    checkFactura.checked           = false
    inputProveedorEmail.value      = ''
    inputProveedorPhone.value      = ''
    inputProveedorComments.value   = ''
    venuesDelProveedor = []
    venueActual        = null
    renderVenueTabs([], null)
}

const camposProveedor = [inputNombre, inputDireccion, inputProveedorEmail, inputProveedorPhone, inputProveedorComments]
const camposProvDB    = ['name', 'address', 'email', 'phone', 'comments']
initAutoSave(supabase, camposProveedor, camposProvDB, 'providers', () => proveedorActual, {
    onSaved: mostrarGuardado
})

initAutoSave(supabase, [inputVenueDireccion, inputVenueDisplayName, inputVenueComments],
    ['address', 'display_name', 'comments'], 'venues',
    () => venueActual,
    { onSaved: mostrarGuardado })

initAutoSave(supabase,
    [inputAvailDesc, inputAccessInstructions, inputServicioComments],
    ['description', 'access_instructions', 'comments'],
    'availability',
    () => servicioEditandoId ? { id: servicioEditandoId } : null,
    { onSaved: mostrarGuardado })

selectVenueType.addEventListener('change', async () => {
    if (!venueActual) return
    await supabase.from('venues').update({ venue_type: selectVenueType.value }).eq('id', venueActual.id)
    venueActual.venue_type = selectVenueType.value
    const v = todosVenues.find(v => v.id === venueActual.id)
    if (v) v.venue_type = selectVenueType.value
    _actualizarLabelsVenue(selectVenueType.value)
    mostrarGuardado()
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

function renderVenueTabs(venues, activeId) {
    const sep  = document.getElementById('venue-sep')
    const area = document.getElementById('venue-sep-area')
    if (venues.length === 0) { area.style.display = 'none'; return }
    area.style.display = 'block'
    const renameBtn = activeId
        ? `<button class="btn btn-secondary btn-rename-venue" style="font-size:11px;padding:2px 7px">✏️ ID</button>`
        : ''
    if (venues.length === 1) {
        sep.innerHTML = `<hr class="venue-sep-hr">
            <span class="venue-sep-id">${venues[0].id}</span>
            ${renameBtn}
            <button class="btn-add-venue">+</button>`
    } else {
        const tabs = venues.map(v =>
            `<button class="venue-tab${v.id === activeId ? ' active' : ''}" data-venue-id="${v.id}">${v.id}</button>`
        ).join('')
        sep.innerHTML = `<hr class="venue-sep-hr">` + tabs + renameBtn + `<button class="btn-add-venue">+</button>`
    }
}

function selectVenueTab(venueId) {
    const venue = venuesDelProveedor.find(v => v.id === venueId)
    if (!venue) return
    venueActual = venue
    inputVenueDireccion.value   = venue.address      ?? ''
    inputVenueDisplayName.value = venue.display_name ?? ''
    inputVenueComments.value    = venue.comments     ?? ''
    selectVenueType.value       = venue.venue_type   ?? 'balcon'
    _actualizarLabelsVenue(venue.venue_type ?? 'balcon')
    renderVenueTabs(venuesDelProveedor, venueActual.id)
    cargarServiciosProveedor(proveedorActual.id, venueId)
}

const _VENUE_LABELS = {
    balcon:            { dir: 'Dirección del balcón',    name: 'Nombre del balcón',    desc: 'Descripción del balcón',    dlgTitulo: 'Añadir balcón',   dlgId: 'ID Balcón',   dlgDir: 'Dirección física del balcón',    toast: 'Balcón renombrado',   errorId: 'Ese ID de balcón ya está en uso.'   },
    barrera:           { dir: 'Dirección de la barrera', name: 'Nombre de la barrera', desc: 'Descripción de la barrera', dlgTitulo: 'Añadir barrera',  dlgId: 'ID Barrera',  dlgDir: 'Dirección física de la barrera', toast: 'Barrera renombrada',  errorId: 'Ese ID de barrera ya está en uso.'  },
    guia:              { dir: 'Zona / ruta',             name: 'Nombre del guía',      desc: 'Descripción del guía',      dlgTitulo: 'Añadir guía',     dlgId: 'ID Guía',     dlgDir: 'Zona o ruta del guía',           toast: 'Guía renombrado',     errorId: 'Ese ID de guía ya está en uso.'     },
    servicio_especial: { dir: 'Lugar / ubicación',       name: 'Nombre del servicio',  desc: 'Descripción del espacio',   dlgTitulo: 'Añadir espacio',  dlgId: 'ID Espacio',  dlgDir: 'Lugar o ubicación',              toast: 'Espacio renombrado',  errorId: 'Ese ID de espacio ya está en uso.'  },
}
function _actualizarLabelsVenue(tipo) {
    const lbl = _VENUE_LABELS[tipo] ?? _VENUE_LABELS.balcon
    document.getElementById('labelVenueDireccion').textContent   = lbl.dir
    document.getElementById('labelVenueDisplayName').textContent = lbl.name
    document.getElementById('labelAvailDesc').textContent        = lbl.desc
}
function _actualizarLabelsDlgVenue(tipo) {
    const lbl = _VENUE_LABELS[tipo] ?? _VENUE_LABELS.balcon
    document.getElementById('dlgVenueTitulo').textContent     = lbl.dlgTitulo
    document.getElementById('dlgVenueIdLabel').textContent    = lbl.dlgId
    document.getElementById('dlgVenueDireccion').placeholder  = lbl.dlgDir
}

function _cargarDispParaServicio(serviceId) {
    const targetVenueId = venueActual?.id
    if (!targetVenueId) return  // sin venue seleccionada no podemos mostrar datos de disponibilidad

    // Caso 1: el par venue+servicio ya existe → modo edición completo
    const disp = todaDisponibilidad.find(d => d.service_id === serviceId && d.venue_id === targetVenueId)
    if (disp) {
        cargarServicioEnFormulario([disp.id])
        return
    }

    // Caso 2: servicio existe globalmente pero no en esta venue → modo añadir, mostrar sección
    // Pre-rellenar desde otro par mismo venue + event_type (trigger garantiza que son iguales)
    const svc = todosServicios.find(s => s.id === serviceId)
    const prefill = svc?.event_type
        ? todaDisponibilidad.find(d => d.venue_id === targetVenueId && d.event_type === svc.event_type)
        : null

    servicioEditandoId            = null
    inputAvailDesc.value          = prefill?.description         ?? ''
    inputAccessInstructions.value = prefill?.access_instructions ?? ''
    inputServicioComments.value   = ''  // comments no está sincronizado por el trigger
    _photos  = Array.isArray(prefill?.photos) ? [...prefill.photos] : []
    _photoIdx = 0
    _renderCarousel()
    document.getElementById('photoCarouselField').style.display = (_photos.length > 0) ? 'flex' : 'none'
    inputServicioNombre.value       = svc?.name        ?? ''
    inputServicioDescription.value  = svc?.description ?? ''
    inputServicioImageUrl.value     = svc?.image_url   ?? ''
    _syncServicioImgPreview()
    const _codeDisplay = svc?.service_code ?? serviceId
    document.getElementById('avail-sep-service-id').textContent  = _codeDisplay
    document.getElementById('avail-sep-venue-id').textContent    = targetVenueId
    document.getElementById('avail-tab-servicio-id').textContent = _codeDisplay
    document.getElementById('avail-sep').style.display          = 'flex'
    document.getElementById('avail-section').style.display      = 'block'
    _initAvailTabs(venueActual?.venue_type === 'balcon')
    btnRenombrarServicio.style.display = 'none'  // solo se muestra en edición de par existente
    actualizarSeccionSfcom(null, true)
    _mostrarUrlCatalogoServicio(null)
}

function abrirDialogNuevoVenue() {
    if (!proveedorActual) return
    const existingIds = new Set(venuesDelProveedor.map(v => v.id))
    let n = 2
    while (existingIds.has(`${proveedorActual.id}_${n}`)) n++
    document.getElementById('dlgVenueId').value        = `${proveedorActual.id}_${n}`
    document.getElementById('dlgVenueType').value      = 'balcon'
    document.getElementById('dlgVenueDireccion').value = ''
    document.getElementById('dlgVenueError').style.display = 'none'
    _actualizarLabelsDlgVenue('balcon')
    document.getElementById('dlgNuevoVenue').showModal()
}

document.getElementById('dlgVenueType').addEventListener('change', () => {
    _actualizarLabelsDlgVenue(document.getElementById('dlgVenueType').value)
})

document.getElementById('dlgVenueCancelar').addEventListener('click', () =>
    document.getElementById('dlgNuevoVenue').close()
)

document.getElementById('dlgVenueCrear').addEventListener('click', async () => {
    const venueId   = document.getElementById('dlgVenueId').value.trim().toUpperCase()
    const venueType = document.getElementById('dlgVenueType').value || 'balcon'
    const venueDir  = document.getElementById('dlgVenueDireccion').value.trim() || null
    const errEl     = document.getElementById('dlgVenueError')
    if (!venueId) {
        errEl.textContent = 'El ID no puede estar vacío.'
        errEl.style.display = 'block'
        return
    }
    if (todosVenues.find(v => v.id === venueId)) {
        errEl.textContent = (_VENUE_LABELS[venueType] ?? _VENUE_LABELS.balcon).errorId
        errEl.style.display = 'block'
        return
    }
    const { error } = await supabase.from('venues').insert({
        id: venueId, provider_id: proveedorActual.id, venue_type: venueType, address: venueDir
    })
    if (error) { errEl.textContent = 'Error: ' + error.message; errEl.style.display = 'block'; return }
    const newVenue = { id: venueId, provider_id: proveedorActual.id, venue_type: venueType, address: venueDir,
        display_name: null, comments: null }
    todosVenues.push(newVenue)
    venuesDelProveedor.push(newVenue)
    venueActual = newVenue
    inputVenueDireccion.value   = venueDir ?? ''
    inputVenueDisplayName.value = ''
    inputVenueComments.value    = ''
    selectVenueType.value       = venueType
    document.getElementById('dlgNuevoVenue').close()
    renderVenueTabs(venuesDelProveedor, venueActual.id)
    mostrarGuardado()
})

// Guarda un proveedor nuevo sin necesidad de anadir un servicio
window.guardarProveedorNuevo = async function(e) {
    e.preventDefault()
    const proveedorId = normalizarId(inputProveedorId.value)
    if (!proveedorId) return
    const { error } = await supabase.from('providers').insert({
        id:       proveedorId,
        name:     document.getElementById('inputNombre').value.trim()              || null,
        address:  document.getElementById('inputDireccion').value.trim()           || null,
        email:    document.getElementById('inputProveedorEmail').value.trim()      || null,
        phone:    document.getElementById('inputProveedorPhone').value.trim()      || null,
        comments: document.getElementById('inputProveedorComments').value.trim()   || null
    })
    if (error) { alert('Error al guardar el proveedor: ' + error.message); return }
    const venueAddress = inputVenueDireccion.value.trim() || null
    const venueType    = selectVenueType.value || 'balcon'
    const { error: venueErr } = await supabase.from('venues').insert({
        id:          proveedorId,
        provider_id: proveedorId,
        address:     venueAddress,
        venue_type:  venueType
    })
    if (venueErr) console.error('Error al crear venue:', venueErr.message)
    else todosVenues.push({ id: proveedorId, provider_id: proveedorId, address: venueAddress, venue_type: venueType,
        display_name: null, comments: null })
    const nuevo = { id: proveedorId, name: document.getElementById('inputNombre').value.trim() || null }
    todosProveedores.push(nuevo)
    cargarProveedor(nuevo)
}

// Guarda un servicio nuevo en la BBDD sin necesidad de anadirlo a un proveedor
window.guardarServicioNuevo = async function(e) {
    e.preventDefault()
    const servicioId = inputServicioId.value.trim().toUpperCase()
    if (!servicioId) return
    const dia    = inputServicioDia.value  ? parseInt(inputServicioDia.value) : null
    const hora   = inputServicioHora.value || null
    const name   = inputServicioNombre.value.trim()      || null
    const desc   = inputServicioDescription.value.trim() || null
    const imgUrl = inputServicioImageUrl.value.trim()    || null
    const { data: newSvcG, error } = await supabase.from('services')
        .insert({ service_code: servicioId, day: dia, start_time: hora, name, description: desc, image_url: imgUrl })
        .select().single()
    if (error) { alert('Error al guardar el servicio: ' + error.message); return }
    todosServicios.push({ id: newSvcG.id, service_code: servicioId, day: dia, start_time: hora, name, description: desc, image_url: imgUrl })
    servicioDescStatus.innerHTML   = '✅ Servicio existente — los cambios en info del servicio se guardan automáticamente'
    servicioDescStatus.style.color = 'var(--accent-ok)'
}

// Guardado automático de campos services al cambiar los inputs correspondientes
async function guardarDescripcionServicio() {
    const servicioId = inputServicioId.value.trim().toUpperCase()
    if (!servicioId) return
    const svc = todosServicios.find(s => s.service_code.toUpperCase() === servicioId)
    if (!svc) return
    const name     = inputServicioNombre.value.trim()      || null
    const desc     = inputServicioDescription.value.trim() || null
    const imgUrl   = inputServicioImageUrl.value.trim()    || null
    const hora     = inputServicioHora.value               || null
    const { error } = await supabase.from('services')
        .update({ name, description: desc, image_url: imgUrl, start_time: hora })
        .eq('id', svc.id)
    if (error) { console.error('Error al guardar descripción del servicio:', error.message); return }
    Object.assign(svc, { name, description: desc, image_url: imgUrl, start_time: hora })
    todosServicios = todosServicios.map(s => s.id === svc.id ? svc : s)
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
    // Resetear estado de edición en cada pulsación
    servicioEditandoId = null
    document.getElementById('avail-sep').style.display     = 'none'
    document.getElementById('avail-section').style.display = 'none'
    btnRenombrarServicio.style.display = 'none'
    if (!val) { autoList.style.display = 'none'; servicioDescStatus.textContent = ''; return }
    const coincidencias = todosServicios.filter(s => s.service_code.toUpperCase().startsWith(val))
    autoList.innerHTML  = coincidencias.map(s => `<div data-id="${s.service_code}">${s.service_code}</div>`).join('')
    autoList.style.display = coincidencias.length > 0 ? 'block' : 'none'
    // Limpiar siempre los campos de availability (son del par proveedor-servicio)
    inputPlazas.value     = ''
    inputPrecio.value     = ''
    inputCosteTotal.value = ''
    selectModelo.value    = 'capacity'
    document.getElementById('inputCosteServicio').value = '—'
    // Si el valor coincide exactamente con un servicio existente, cargar sus campos
    const exacto = todosServicios.find(s => s.service_code.toUpperCase() === val)
    if (exacto) {
        inputServicioNombre.value      = exacto.name        ?? ''
        inputServicioDescription.value = exacto.description ?? ''
        inputServicioImageUrl.value    = exacto.image_url   ?? ''
        inputServicioDia.value         = exacto.day         ? String(exacto.day) : ''
        inputServicioHora.value        = exacto.start_time  ?? ''
        servicioDescStatus.innerHTML   = '✅ Servicio existente — los cambios en info del servicio se guardan automáticamente'
        servicioDescStatus.style.color = 'var(--accent-ok)'
        _cargarDispParaServicio(exacto.id)
    } else {
        inputServicioNombre.value      = ''
        inputServicioDescription.value = ''
        inputServicioImageUrl.value    = ''
        _syncServicioImgPreview()
        inputServicioDia.value         = _extraerDiaDeId(val) ? String(_extraerDiaDeId(val)) : ''
        inputServicioHora.value        = ''
        servicioDescStatus.innerHTML   = '✨ Servicio nuevo — '
            + '<a href="#" style="font-size:inherit;color:inherit;text-decoration:underline;cursor:pointer"'
            + ' onclick="guardarServicioNuevo(event)">Guardar servicio</a>'
            + ' o se creará al añadir al proveedor'
        servicioDescStatus.style.color = 'var(--accent-warn)'
    }
    document.getElementById('servicio-dia-warning').style.display = 'none'
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
        ? todosServicios.filter(s => s.service_code.toUpperCase().startsWith(val))
        : todosServicios
    autoList.innerHTML  = lista.map(s => `<div data-id="${s.service_code}">${s.service_code}</div>`).join('')
    autoList.style.display = lista.length > 0 ? 'block' : 'none'
})

document.getElementById('autocompleteServicioList').addEventListener('click', e => {
    const div = e.target.closest('[data-id]')
    if (!div) return
    inputServicioId.value = div.dataset.id
    document.getElementById('autocompleteServicioList').style.display = 'none'
    // Resetear estado de edición
    servicioEditandoId = null
    document.getElementById('avail-sep').style.display     = 'none'
    document.getElementById('avail-section').style.display = 'none'
    btnRenombrarServicio.style.display = 'none'
    // Limpiar siempre los campos de availability (son del par proveedor-servicio)
    inputPlazas.value     = ''
    inputPrecio.value     = ''
    inputCosteTotal.value = ''
    selectModelo.value    = 'capacity'
    document.getElementById('inputCosteServicio').value = '—'
    // Cargar campos del servicio seleccionado
    const svcSel = todosServicios.find(s => s.service_code === div.dataset.id)
    if (svcSel) {
        inputServicioNombre.value      = svcSel.name        ?? ''
        inputServicioDescription.value = svcSel.description ?? ''
        inputServicioImageUrl.value    = svcSel.image_url   ?? ''
        inputServicioDia.value         = svcSel.day         ? String(svcSel.day) : ''
        inputServicioHora.value        = svcSel.start_time  ?? ''
        servicioDescStatus.innerHTML   = '✅ Servicio existente — los cambios en info del servicio se guardan automáticamente'
        servicioDescStatus.style.color = 'var(--accent-ok)'
        _cargarDispParaServicio(svcSel.id)
    } else {
        inputServicioNombre.value      = ''
        inputServicioDescription.value = ''
        inputServicioImageUrl.value    = ''
        _syncServicioImgPreview()
        inputServicioDia.value         = ''
        inputServicioHora.value        = ''
        servicioDescStatus.innerHTML   = '✨ Servicio nuevo — '
            + '<a href="#" style="font-size:inherit;color:inherit;text-decoration:underline;cursor:pointer"'
            + ' onclick="guardarServicioNuevo(event)">Guardar servicio</a>'
            + ' o se creará al añadir al proveedor'
        servicioDescStatus.style.color = 'var(--accent-warn)'
    }
    document.getElementById('servicio-dia-warning').style.display = 'none'
    actualizarBtnServicio()
    actualizarCosteServicio()
})

inputPrecio.addEventListener('input', () => {
    ultimoCampoActivo = 'precio'
    if (selectModelo.value !== 'fixed') {
        const plazas = parseInt(inputPlazas.value) || 0
        const precio  = parseFloat(inputPrecio.value) || 0
        if (plazas > 0 && precio >= 0) inputCosteTotal.value = (plazas * precio).toFixed(2)
    }
    actualizarBtnServicio()
    actualizarCosteServicio()
})

inputCosteTotal.addEventListener('input', () => {
    ultimoCampoActivo = 'total'
    if (selectModelo.value !== 'fixed') {
        const plazas = parseInt(inputPlazas.value) || 0
        const total  = parseFloat(inputCosteTotal.value) || 0
        if (plazas > 0) inputPrecio.value = (total / plazas).toFixed(2)
    }
    actualizarBtnServicio()
    actualizarCosteServicio()
})

inputPlazas.addEventListener('input', () => {
    const plazas = parseInt(inputPlazas.value) || 0
    if (selectModelo.value !== 'fixed') {
        if (ultimoCampoActivo === 'precio') {
            const precio = parseFloat(inputPrecio.value) || 0
            if (plazas > 0) inputCosteTotal.value = (plazas * precio).toFixed(2)
        } else {
            const total = parseFloat(inputCosteTotal.value) || 0
            if (plazas > 0) inputPrecio.value = (total / plazas).toFixed(2)
            else inputPrecio.value = ''
        }
    }
    actualizarBtnServicio()
    actualizarCosteServicio()
})

selectModelo.addEventListener('change', () => {
    if (selectModelo.value === 'fixed') {
        inputPrecio.disabled = true
        inputPrecio.value    = ''
    } else {
        inputPrecio.disabled = false
    }
    actualizarCosteServicio()
})

function actualizarCosteServicio() {
    const plazas    = parseInt(inputPlazas.value) || 0
    const precio    = parseFloat(inputPrecio.value) || 0
    const modelo    = selectModelo.value
    const servCode  = inputServicioId.value.trim().toUpperCase()
    const servIntId = todosServicios.find(s => s.service_code === servCode)?.id ?? null
    let coste       = 0

    const currentVenueId = servicioEditandoId
        ? (todaDisponibilidad.find(d => d.id === servicioEditandoId)?.venue_id ?? proveedorActual?.id)
        : proveedorActual?.id

    if (modelo === 'capacity') {
        coste = plazas * precio
        document.getElementById('inputCosteServicio').value = fmt(coste)
    } else if (modelo === 'fixed') {
        const costoFijo = parseFloat(inputCosteTotal.value) || 0
        if (currentVenueId && servIntId) {
            const tieneReserva = todasReservas.some(r =>
                r.venue_id   === currentVenueId &&
                r.service_id === servIntId &&
                r.status     !== 'Cancelada'
            )
            coste = tieneReserva ? costoFijo : 0
        }
        document.getElementById('inputCosteServicio').value = fmt(coste) + ' (cuota fija)'
    } else {
        if (currentVenueId && servIntId) {
            const plazasRes = todasReservas
                .filter(r => r.venue_id   === currentVenueId &&
                             r.service_id === servIntId &&
                             r.status     !== 'Cancelada')
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
    sfcomNombreVariacion.value = _variacionAuto(disp?.service_code ?? inputServicioId.value.trim().toUpperCase())
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
            .filter(d => d.venue_provider_id === proveedorActual.id &&
                         d.id               !== servicioEditandoId &&
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

function _mostrarUrlCatalogoServicio(url) {
    const el = document.getElementById('url-catalogo-servicio')
    if (!el) return
    if (!url) { el.innerHTML = ''; return }
    el.innerHTML = `<span style="word-break:break-all">${url}</span>
        <button id="btn-copiar-url-servicio" class="btn btn-secondary" style="font-size:11px;padding:3px 8px;flex-shrink:0">📋 Copiar</button>`
    document.getElementById('btn-copiar-url-servicio').addEventListener('click', async () => {
        await navigator.clipboard.writeText(url)
        mostrarToast('URL copiada')
    })
}

function limpiarFormularioServicio() {
    servicioEditandoId   = null
    serviciosEditandoIds = []
    ultimoCampoActivo    = 'precio'
    inputServicioId.value    = ''
    inputServicioId.disabled = false
    inputPlazas.value        = ''
    inputPrecio.value        = ''
    inputPrecio.disabled     = false
    inputCosteTotal.value    = ''
    selectModelo.value              = 'capacity'
    inputServicioNombre.value       = ''
    inputServicioDescription.value  = ''
    inputServicioImageUrl.value     = ''
    _syncServicioImgPreview()
    inputAvailDesc.value            = ''
    inputAccessInstructions.value   = ''
    inputServicioComments.value     = ''
    inputServicioDia.value          = ''
    inputServicioHora.value         = ''
    _photos  = []
    _photoIdx = 0
    _renderCarousel()
    document.getElementById('photoCarouselField').style.display = 'none'
    document.getElementById('avail-sep').style.display  = 'none'
    document.getElementById('avail-section').style.display = 'none'
    btnRenombrarServicio.style.display = 'none'
    if (servicioDescStatus) servicioDescStatus.textContent = ''
    document.getElementById('servicio-dia-warning').style.display = 'none'
    document.getElementById('inputCosteServicio').value = '—'
    document.getElementById('titulo-bloque-servicio').textContent = '➕ Añadir / Editar servicio'
    servicioStatus.textContent             = ''
    btnGuardarServicio.textContent         = 'Añadir servicio'
    btnGuardarServicio.disabled            = true
    btnCancelarServicio.style.display      = 'none'
    document.getElementById('btnAsistenteNuevo').style.display = proveedorActual ? 'inline-block' : 'none'
    document.getElementById('btnAbrirMultiple').style.display  = proveedorActual ? 'inline-block' : 'none'
    document.querySelectorAll('.chk-servicio:checked').forEach(c => c.checked = false)
    sortServiciosCol = null
    sortServiciosDir = 'asc'
    actualizarSeccionSfcom(null)
    _mostrarUrlCatalogoServicio(null)
}

// ===== GUARDAR SERVICIO(S) =====
btnGuardarServicio.addEventListener('click', () => confirmarSiTemporadaNoActiva('la disponibilidad del proveedor', async () => {
    const proveedorId = inputProveedorId.value.trim().toUpperCase()
    const plazas      = parseInt(inputPlazas.value)
    const modelo      = selectModelo.value
    const precio      = modelo === 'fixed'
        ? parseFloat(inputCosteTotal.value)
        : parseFloat(inputPrecio.value)

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
        const venueAddress = inputVenueDireccion.value.trim() || null
        const venueType    = selectVenueType.value || 'balcon'
        const { error: venueErr } = await supabase.from('venues').insert({
            id:          proveedorId,
            provider_id: proveedorId,
            address:     venueAddress,
            venue_type:  venueType
        })
        if (venueErr) console.error('Error al crear venue:', venueErr.message)
        else {
            const _newVenue = { id: proveedorId, provider_id: proveedorId, address: venueAddress,
                venue_type: venueType, display_name: null, comments: null }
            todosVenues.push(_newVenue)
            venuesDelProveedor = [_newVenue]
            venueActual        = venuesDelProveedor[0]
            renderVenueTabs(venuesDelProveedor, venueActual.id)
        }
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
            .map(d => ({ venueId: d.venue_id, serviceId: d.service_id }))
        const sfcomOkMulti = await confirmarStockSfcom(supabase, paresMulti)
        if (sfcomOkMulti === 'cancel') return

        for (const dispId of serviciosEditandoIds) {
            const dispActual = todaDisponibilidad.find(d => d.id === dispId)
            if (!dispActual) continue
            const updateData = {}
            if (inputPlazas.value !== '' && !isNaN(plazas)) updateData.total_slots = plazas
            if (modelo === 'fixed') {
                if (inputCosteTotal.value !== '' && !isNaN(precio)) updateData.price_per_slot = precio
            } else {
                if (inputPrecio.value !== '' && !isNaN(precio)) updateData.price_per_slot = precio
            }
            updateData.billing_model = modelo

            const { error } = await supabase.from('availability')
                .update(updateData).eq('id', dispId)
            if (error) { alert('Error al actualizar ' + dispActual.service_code + ': ' + error.message); continue }
            todaDisponibilidad = todaDisponibilidad.map(d =>
                d.id === dispId ? { ...d, ...updateData } : d
            )
        }
        await persistirPagosProveedor(supabase, proveedorActual.id, todasReservas, todaDisponibilidad)
        for (const { venueId, serviceId } of paresMulti) {
            if (sfcomOkMulti === 'sync') await syncStockToSfcom(supabase, venueId, serviceId)
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

    const servicioExiste = todosServicios.find(s => s.service_code.toUpperCase() === servicioId)
    if (!servicioExiste) {
        if (!confirm(`¿Crear servicio nuevo "${servicioId}"?`)) return
        const nameSvc    = inputServicioNombre.value.trim()      || null
        const descSvc    = inputServicioDescription.value.trim() || null
        const imgUrlSvc  = inputServicioImageUrl.value.trim()    || null
        const diaSvc     = inputServicioDia.value ? parseInt(inputServicioDia.value) : null
        const horaSvc    = inputServicioHora.value || null
        const { data: newSvc, error } = await supabase.from('services')
            .insert({ service_code: servicioId, day: diaSvc, start_time: horaSvc, name: nameSvc, description: descSvc, image_url: imgUrlSvc })
            .select().single()
        if (error) { alert('Error al crear servicio: ' + error.message); return }
        todosServicios.push({ id: newSvc.id, service_code: servicioId, day: diaSvc, start_time: horaSvc, name: nameSvc, description: descSvc, image_url: imgUrlSvc })
    }

    const nameSvc   = inputServicioNombre.value.trim()      || null
    const descSvc   = inputServicioDescription.value.trim() || null
    const imgUrlSvc = inputServicioImageUrl.value.trim()    || null
    const horaSvc   = inputServicioHora.value || null

    // Obtener el integer id del servicio (ya existe o acaba de crearse)
    const svcIntId = todosServicios.find(s => s.service_code.toUpperCase() === servicioId)?.id

    // Actualizar campos del servicio en la tabla services
    await supabase.from('services')
        .update({ name: nameSvc, description: descSvc, image_url: imgUrlSvc, start_time: horaSvc })
        .eq('id', svcIntId)
    todosServicios = todosServicios.map(s =>
        s.id === svcIntId ? { ...s, name: nameSvc, description: descSvc, image_url: imgUrlSvc, start_time: horaSvc } : s
    )

    // Modal consultivo antes de escribir (para edición: muestra stock actual; para creación: silencioso)
    const venueId = servicioEditandoId
        ? (todaDisponibilidad.find(d => d.id === servicioEditandoId)?.venue_id ?? proveedorActual.id)
        : (venueActual?.id ?? proveedorActual.id)
    const sfcomOkSingle = await confirmarStockSfcom(supabase, [{ venueId, serviceId: svcIntId }])
    if (sfcomOkSingle === 'cancel') return

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
        const _targetVenueId = venueActual?.id ?? proveedorActual.id
        const yaExiste = todaDisponibilidad.find(d =>
            d.venue_id === _targetVenueId && d.service_id === svcIntId
        )
        if (yaExiste) {
            alert(`Este proveedor ya tiene el servicio ${servicioId}. Selecciónalo en la tabla para editarlo.`)
            return
        }
        const { data: nuevaDisp, error } = await supabase.from('availability').insert({
            venue_id:       _targetVenueId,
            service_id:     svcIntId,
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
        const _svcCached   = todosServicios.find(s => s.id === svcIntId)
        const _venueCached = todosVenues.find(v => v.id === _targetVenueId)
        todaDisponibilidad.push({
            ...nuevaDisp,
            service_code:       servicioId,
            event_type:         _svcCached?.event_type      ?? null,
            day:                _svcCached?.day              ?? null,
            start_time:         _svcCached?.start_time       ?? null,
            venue_display_name: _venueCached?.display_name   ?? null,
            venue_address:      _venueCached?.address        ?? null,
            venue_slug:         _venueCached?.slug            ?? null,
            venue_provider_id:  proveedorActual?.id           ?? null,
            photos:             null,
            access_instructions: null,
            description:        null,
            sfcom_product_id:   null,
            sfcom_variation_id: null,
            sfcom_public_price: null,
            sfcom_listing_id:   null,
            ...sfcomInsert
        })
    }

    await persistirPagosProveedor(supabase, proveedorActual.id, todasReservas, todaDisponibilidad)
    if (sfcomOkSingle === 'sync') await syncStockToSfcom(supabase, venueId, svcIntId)

    limpiarFormularioServicio()
    cargarServiciosProveedor(proveedorActual.id)
    cargarPagosProveedor(proveedorActual.id)

    if (_sfcomSinSolicitar) {
        servicioStatus.textContent = 'ℹ️ Servicio guardado. Alta en sfcom no solicitada.'
        servicioStatus.style.color = 'var(--subtle)'
        setTimeout(() => { servicioStatus.textContent = '' }, 5000)
    }
}))

btnCancelarServicio.addEventListener('click', limpiarFormularioServicio)

// ===== BLOQUE 3: SERVICIOS DEL PROVEEDOR =====

let sortServiciosCol   = null
let sortServiciosDir   = 'asc'
let serviciosProveedor      = []
let _datosServiciosExport   = []  // copia del último render para export

async function cargarServiciosProveedor(proveedorId, venueId) {
    const vid      = venueId ?? venueActual?.id
    const dispProv = todaDisponibilidad.filter(d => d.venue_id === vid)
    const bloque   = document.getElementById('bloque-servicios-proveedor')
    if (dispProv.length === 0) { bloque.style.display = 'none'; return }
    serviciosProveedor = dispProv
    bloque.style.display = 'block'
    renderTablaServicios(proveedorId)
}

function renderTablaServicios(proveedorId) {
    const cols = [
        { label: 'Servicio',     campo: 'service_code' },
        { label: 'Reservadas',   campo: '_reservadas' },
        { label: 'Plazas',       campo: 'total_slots' },
        { label: 'Precio/plaza', campo: 'price_per_slot' },
        { label: 'Modelo',       campo: 'billing_model' },
        { label: 'Coste',        campo: '_coste' },
        { label: 'Clientes',     campo: '_clientes' },
    ]

    let datos = serviciosProveedor.map(d => {
        let coste = 0
        if (d.billing_model === 'capacity') {
            coste = (d.total_slots ?? 0) * parseFloat(d.price_per_slot ?? 0)
        } else if (d.billing_model === 'fixed') {
            const tieneReserva = todasReservas.some(r =>
                r.venue_id   === d.venue_id &&
                r.service_id === d.service_id &&
                r.status     !== 'Cancelada'
            )
            coste = tieneReserva ? parseFloat(d.price_per_slot ?? 0) : 0
        } else {
            const plazasRes = todasReservas
                .filter(r => r.venue_id   === d.venue_id &&
                             r.service_id === d.service_id &&
                             r.status     !== 'Cancelada')
                .reduce((s, r) => s + r.slots, 0)
            coste = plazasRes * parseFloat(d.price_per_slot ?? 0)
        }
        const reservasServicio = todasReservas.filter(r =>
            r.venue_id   === d.venue_id &&
            r.service_id === d.service_id &&
            r.status     !== 'Cancelada'
        )
        const plazasReservadas = reservasServicio.reduce((s, r) => s + r.slots, 0)
        const clientes     = [...new Set(reservasServicio.map(r => r.client_id))].join('; ')
        const clientesHTML = renderClientChips(reservasServicio)
        return { ...d, _coste: coste, _reservadas: plazasReservadas, _clientes: clientes, _clientesHTML: clientesHTML }
    })

    _datosServiciosExport = datos

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
            <td>${d.service_code}</td>
            <td>${d._reservadas > 0 ? d._reservadas : '—'}</td>
            <td>${d.total_slots}</td>
            <td>${fmt(d.price_per_slot)}</td>
            <td>${d.billing_model === 'consumption'
                ? '<span style="color:var(--accent-warn)">Consumo</span>'
                : d.billing_model === 'fixed'
                ? '<span style="color:var(--subtle)">Cuota fija</span>'
                : 'Capacidad'}</td>
            <td>${fmt(d._coste)}</td>
            <td style="font-size:11px">${d._clientesHTML || '—'}</td>
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
        inputServicioId.value    = disps[0].service_code
        inputServicioId.disabled = false
        inputPlazas.value        = disps[0].total_slots
        selectModelo.value       = disps[0].billing_model
        if (disps[0].billing_model === 'fixed') {
            inputPrecio.value    = ''
            inputPrecio.disabled = true
            inputCosteTotal.value = parseFloat(disps[0].price_per_slot || 0).toFixed(2)
        } else {
            inputPrecio.value    = disps[0].price_per_slot
            inputPrecio.disabled = false
            inputCosteTotal.value = (disps[0].total_slots * parseFloat(disps[0].price_per_slot)).toFixed(2)
        }
        // campos de services (compartidos entre venues)
        const svc = todosServicios.find(s => s.id === disps[0].service_id)
        inputServicioNombre.value       = svc?.name        ?? ''
        inputServicioDescription.value  = svc?.description ?? ''
        inputServicioImageUrl.value     = svc?.image_url   ?? ''
        _syncServicioImgPreview()
        inputServicioDia.value          = svc?.day         ? String(svc.day) : ''
        inputServicioHora.value         = svc?.start_time  ?? ''
        // campos de availability (específicos del par venue+service)
        inputAvailDesc.value          = disps[0].description        ?? ''
        inputAccessInstructions.value = disps[0].access_instructions ?? ''
        inputServicioComments.value   = disps[0].comments            ?? ''
        _photos  = Array.isArray(disps[0].photos) ? [...disps[0].photos] : []
        _photoIdx = 0
        _renderCarousel()
        document.getElementById('photoCarouselField').style.display = 'flex'
        document.getElementById('servicio-dia-warning').style.display = 'none'
        document.getElementById('titulo-bloque-servicio').textContent = '✏️ Editando servicio'
        document.getElementById('avail-sep-service-id').textContent  = disps[0].service_code
        document.getElementById('avail-sep-venue-id').textContent    = disps[0].venue_id
        document.getElementById('avail-tab-servicio-id').textContent = disps[0].service_code
        document.getElementById('avail-sep').style.display     = 'flex'
        document.getElementById('avail-section').style.display = 'block'
        _initAvailTabs(venueActual?.venue_type === 'balcon')
        btnRenombrarServicio.style.display = 'inline-flex'
        actualizarSeccionSfcom(disps[0])
        _mostrarUrlCatalogoServicio(buildCatalogUrl(disps[0].venue_slug, disps[0].event_type))
    } else {
        servicioEditandoId       = null
        inputServicioId.value    = 'Varios servicios'
        inputServicioId.disabled = true

        const plazasIguales = disps.every(d => d.total_slots    === disps[0].total_slots)
        const precioIgual   = disps.every(d => d.price_per_slot === disps[0].price_per_slot)
        const modeloIgual   = disps.every(d => d.billing_model  === disps[0].billing_model)

        inputPlazas.value     = plazasIguales ? disps[0].total_slots    : ''
        selectModelo.value    = modeloIgual   ? disps[0].billing_model  : 'capacity'
        if (modeloIgual && disps[0].billing_model === 'fixed') {
            inputPrecio.value     = ''
            inputPrecio.disabled  = true
            inputCosteTotal.value = precioIgual ? parseFloat(disps[0].price_per_slot || 0).toFixed(2) : ''
        } else {
            inputPrecio.value     = precioIgual   ? disps[0].price_per_slot : ''
            inputPrecio.disabled  = false
            inputCosteTotal.value = (plazasIguales && precioIgual)
                ? (disps[0].total_slots * parseFloat(disps[0].price_per_slot)).toFixed(2) : ''
        }

        inputServicioNombre.value      = ''
        inputServicioDescription.value = ''
        inputServicioImageUrl.value    = ''
        _syncServicioImgPreview()
        inputAvailDesc.value           = ''
        inputAccessInstructions.value  = ''
        inputServicioComments.value    = ''
        inputServicioDia.value         = ''
        inputServicioHora.value        = ''
        _photos  = []
        _photoIdx = 0
        _renderCarousel()
        document.getElementById('photoCarouselField').style.display = 'none'
        document.getElementById('avail-sep').style.display          = 'none'
        document.getElementById('avail-section').style.display      = 'none'
        btnRenombrarServicio.style.display = 'none'
        document.getElementById('titulo-bloque-servicio').textContent =
            `✏️ Editando ${disps.length} servicios`
        actualizarSeccionSfcom(null)
        const urlComun = disps.every(d => d.venue_slug === disps[0].venue_slug && d.event_type === disps[0].event_type)
            ? buildCatalogUrl(disps[0].venue_slug, disps[0].event_type)
            : null
        _mostrarUrlCatalogoServicio(urlComun)
    }

    actualizarCosteServicio()
    btnGuardarServicio.textContent    = '💾 Guardar cambios'
    btnGuardarServicio.disabled       = false
    btnCancelarServicio.style.display = 'inline-block'
    document.getElementById('btnAsistenteNuevo').style.display = 'none'
    document.getElementById('btnAbrirMultiple').style.display = 'none'
    document.getElementById('bloque-servicio').scrollIntoView({ behavior: 'smooth' })
}

document.getElementById('btnEditarServicios').addEventListener('click', () => {
    const checks = [...document.querySelectorAll('.chk-servicio:checked')]
    if (checks.length === 0) { alert('Selecciona al menos un servicio para editar'); return }
    const ids = checks.map(chk => parseInt(chk.closest('tr').dataset.dispId))
    cargarServicioEnFormulario(ids)
})

function _modalOpcionesEliminar(venueId, venueType, proveedorId, puedeElimVenue, puedeElimTodo) {
    const tipo = (_VENUE_LABELS[venueType] ?? _VENUE_LABELS.balcon).dlgTitulo.replace('Añadir ', '')
    const notaVenue = !puedeElimVenue ? `<p style="margin:8px 0 0; font-size:12px; color:var(--accent-warn)">⚠ ${venueId} tiene reservas — no se puede eliminar.</p>` : ''
    const notaTodo  = (puedeElimVenue && !puedeElimTodo) ? `<p style="margin:8px 0 0; font-size:12px; color:var(--accent-warn)">⚠ Otras ubicaciones del proveedor tienen reservas — no se puede eliminar el proveedor.</p>` : ''
    return new Promise(resolve => {
        let done = false
        const finish = v => { if (!done) { done = true; resolve(v) } }
        const dlg = document.createElement('dialog')
        dlg.style.width = 'min(420px, 92vw)'
        dlg.innerHTML = `
            <h3 class="dialog-titulo" style="margin-bottom:10px">${venueId} sin servicios</h3>
            <p style="margin:0 0 12px; font-size:13px; color:var(--subtle)">
                Es el único ${tipo} de <strong>${proveedorId}</strong>. La disponibilidad ya ha sido eliminada.
                ¿Qué más quieres borrar?
            </p>
            <div style="display:flex; flex-direction:column; gap:8px">
                <button class="btn btn-secondary">Nada más — mantener ${tipo} y proveedor</button>
                <button class="btn btn-secondary" ${!puedeElimVenue ? 'disabled' : `style="border-color:var(--accent-warn);color:var(--accent-warn)"`}>
                    Eliminar también el ${tipo} <strong>${venueId}</strong>
                </button>
                ${notaVenue}
                <button class="btn btn-danger" ${!puedeElimTodo ? 'disabled' : ''}>
                    Eliminar ${tipo} y proveedor <strong>${proveedorId}</strong>
                </button>
                ${notaTodo}
            </div>`
        document.body.appendChild(dlg)
        dlg.showModal()
        const btns = [...dlg.querySelectorAll('button')]
        btns[0].onclick = () => { dlg.close(); finish('solo') }
        if (puedeElimVenue) btns[1].onclick = () => { dlg.close(); finish('venue') }
        if (puedeElimTodo)  btns[2].onclick = () => { dlg.close(); finish('todo') }
        dlg.addEventListener('close', () => { dlg.remove(); finish('solo') })
    })
}

document.getElementById('btnEliminarServicio').addEventListener('click', () => confirmarSiTemporadaNoActiva('la eliminación de servicios', async () => {
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

        const { service_id: servicioId, venue_id: venueId } = disp

        if (disp.sfcom_status !== null && disp.sfcom_status !== undefined) {
            noEliminados.push(`${servicioId} (tiene sfcom activo: "${disp.sfcom_status}" — da de baja en sfcom primero)`)
            continue
        }

        const reservasActivas = todasReservas.filter(r =>
            r.venue_id   === venueId    &&
            r.service_id === servicioId &&
            r.status     !== 'Cancelada'
        )
        if (reservasActivas.length > 0) {
            const clientes = [...new Set(reservasActivas.map(r => r.client_id))].join(', ')
            noEliminados.push(`${servicioId} (reservado por: ${clientes})`)
            continue
        }

        await supabase.from('availability').delete().eq('id', dispId)
        todaDisponibilidad = todaDisponibilidad.filter(d => d.id !== dispId)
        eliminados.push({ servicioId, venueId, dispId })

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

    // ─── Cascade: venue vacía → ofrecer borrar venue; última venue → ofrecer también el proveedor
    const venuesAfectadas = [...new Set(eliminados.map(e => e.venueId))]
    for (const venueId of venuesAfectadas) {
        if (todaDisponibilidad.some(d => d.venue_id === venueId)) continue

        const venue = venuesDelProveedor.find(v => v.id === venueId)
        const tipo  = (_VENUE_LABELS[venue?.venue_type] ?? _VENUE_LABELS.balcon).dlgTitulo.replace('Añadir ', '')
        const hayOtrasConServicios = todaDisponibilidad.some(
            d => d.venue_provider_id === proveedorActual.id && d.venue_id !== venueId
        )

        const venueConReservas  = todasReservas.some(r => r.venue_id === venueId)
        const otrasConReservas  = venuesDelProveedor
            .filter(v => v.id !== venueId)
            .some(v => todasReservas.some(r => r.venue_id === v.id))
        const puedeElimVenue = !venueConReservas
        const puedeElimTodo  = !venueConReservas && !otrasConReservas

        if (hayOtrasConServicios) {
            if (!puedeElimVenue) {
                mostrarToast(`"${venueId}" tiene reservas — se mantiene aunque ya no tenga servicios`)
            } else {
                const borrar = confirm(`"${venueId}" ya no ofrece ningún servicio.\n¿Eliminar también el ${tipo}?`)
                if (borrar) {
                    await supabase.from('venues').delete().eq('id', venueId)
                    todosVenues        = todosVenues.filter(v => v.id !== venueId)
                    venuesDelProveedor = venuesDelProveedor.filter(v => v.id !== venueId)
                    if (venueActual?.id === venueId) venueActual = venuesDelProveedor[0] ?? null
                }
            }
        } else {
            const opcion = await _modalOpcionesEliminar(venueId, venue?.venue_type ?? 'balcon', proveedorActual.id, puedeElimVenue, puedeElimTodo)
            if (opcion === 'venue' || opcion === 'todo') {
                await supabase.from('venues').delete().eq('id', venueId)
                todosVenues        = todosVenues.filter(v => v.id !== venueId)
                venuesDelProveedor = venuesDelProveedor.filter(v => v.id !== venueId)
                venueActual        = null
            }
            if (opcion === 'todo') {
                for (const v of venuesDelProveedor) {
                    if (todasReservas.some(r => r.venue_id === v.id)) continue
                    await supabase.from('venues').delete().eq('id', v.id)
                    todosVenues = todosVenues.filter(vv => vv.id !== v.id)
                }
                venuesDelProveedor = venuesDelProveedor.filter(v =>
                    todasReservas.some(r => r.venue_id === v.id)
                )
                if (venuesDelProveedor.length === 0) {
                    await supabase.from('payments').delete().eq('provider_id', proveedorActual.id)
                    const { error: errDelProv } = await supabase.from('providers').delete().eq('id', proveedorActual.id)
                    if (errDelProv) {
                        mostrarToast(`⚠️ No se pudo eliminar el proveedor: ${errDelProv.message}`)
                        return
                    }
                    todosProveedores = todosProveedores.filter(p => p.id !== proveedorActual.id)
                    limpiarProveedor()
                    inputProveedorId.value = ''
                    if (noEliminados.length > 0) alert('No se pudieron eliminar:\n' + noEliminados.join('\n'))
                    return
                }
            }
        }
    }

    const proveedorId = proveedorActual?.id
    if (proveedorId) {
        renderVenueTabs(venuesDelProveedor, venueActual?.id ?? null)
        await persistirPagosProveedor(supabase, proveedorId, todasReservas, todaDisponibilidad)
        limpiarFormularioServicio()
        cargarServiciosProveedor(proveedorId)
        cargarPagosProveedor(proveedorId)
    }

    if (noEliminados.length > 0) {
        alert('No se pudieron eliminar los siguientes servicios (tienen reservas activas):\n\n' +
              noEliminados.join('\n'))
    }
}))

// ===== BLOQUE 4: PAGOS AL PROVEEDOR =====

function calcularCosteTotalProveedor(proveedorId) {
    const dispProv = todaDisponibilidad.filter(d => d.venue_provider_id === proveedorId)
    return dispProv.reduce((total, d) => {
        if (d.billing_model === 'capacity') {
            return total + (d.total_slots ?? 0) * parseFloat(d.price_per_slot ?? 0)
        } else if (d.billing_model === 'fixed') {
            const tieneReserva = todasReservas.some(r =>
                r.venue_id   === d.venue_id &&
                r.service_id === d.service_id &&
                r.status     !== 'Cancelada'
            )
            return total + (tieneReserva ? parseFloat(d.price_per_slot ?? 0) : 0)
        } else {
            const plazasRes = todasReservas
                .filter(r => r.venue_id   === d.venue_id &&
                             r.service_id === d.service_id &&
                             r.status     !== 'Cancelada')
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
        hitosProvTemp.push({ esFinal: true, is_final: true, comments: 'Pago final', amount: pagoFinal, due_date: fechaPagoDefault(), paid: false })
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

async function persistirHitosProveedor(proveedorId) {
    const idsEnMemoria = hitosProvTemp.filter(h => h.id).map(h => h.id)
    const pagosEnBD    = todosPayments.filter(p => p.provider_id === proveedorId).map(p => p.id)

    for (const id of pagosEnBD.filter(id => !idsEnMemoria.includes(id))) {
        const { error } = await supabase.from('payments').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }

    for (const h of hitosProvTemp) {
        const payload = {
            provider_id: proveedorId,
            amount:      parseFloat(h.amount),
            due_date:    h.due_date ?? null,
            paid:        h.paid ?? false,
            paid_date:   h.paid_date ?? null,
            comments:    h.comments ?? null,
            is_final:    h.esFinal ?? false,
            season:      getTemporadaActiva()
        }
        if (h.id) {
            const { error } = await supabase.from('payments').update(payload).eq('id', h.id)
            if (error) throw new Error(error.message)
        } else {
            const { data, error } = await supabase.from('payments').insert(payload).select().single()
            if (error) throw new Error(error.message)
            h.id = data.id
        }
    }

    todosPayments = (await supabase.from('payments').select('*').eq('season', getTemporadaActiva())).data
}

async function cargarPagosProveedor(proveedorId) {
    const { data } = await supabase
        .from('payments').select('*').eq('provider_id', proveedorId).eq('season', getTemporadaActiva()).order('due_date')

    hitosProvTemp = (data ?? []).map(h => ({ ...h, esFinal: h.is_final ?? false }))

    const costTotal = calcularCosteTotalProveedor(proveedorId)
    const prepagos  = hitosProvTemp.filter(h => !h.esFinal).reduce((s, h) => s + parseFloat(h.amount), 0)
    const pagoFinal = costTotal - prepagos

    if (!hitosProvTemp.find(h => h.esFinal)) {
        hitosProvTemp.push({ esFinal: true, is_final: true, comments: 'Pago final', amount: pagoFinal, due_date: fechaPagoDefault(), paid: false })
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

window.cambiarFechaPagoFinal = async function(idx, valor) {
    hitosProvTemp[idx].due_date = valor || null
    try {
        await persistirHitosProveedor(proveedorActual.id)
    } catch (err) {
        console.error('Error al guardar fecha de pago:', err.message)
    }
}

function _pedirFechaPago() {
    return new Promise(resolve => {
        const { overlay, panel } = crearModal('modal-fecha-pago-prov', { narrow: true })
        panel.innerHTML = `
            <div>
                <div class="modal-header-title">Fecha de pago</div>
            </div>
            <div style="padding:8px 0">
                <input id="modal-fecha-pago-input" type="date" value="${hoy}"
                    style="width:100%;padding:8px;border:1px solid var(--border);border-radius:4px;font-size:14px">
            </div>
            <div class="modal-actions">
                <button id="modal-fecha-pago-cancel" class="btn btn-secondary">Cancelar</button>
                <button id="modal-fecha-pago-ok" class="btn btn-primary" autofocus>Confirmar</button>
            </div>`
        const input = panel.querySelector('#modal-fecha-pago-input')
        panel.querySelector('#modal-fecha-pago-cancel').onclick = () => { overlay.close(); resolve(null) }
        panel.querySelector('#modal-fecha-pago-ok').onclick = () => {
            overlay.close(); resolve(input.value || hoy)
        }
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { overlay.close(); resolve(input.value || hoy) }
        })
        setTimeout(() => input.focus(), 50)
    })
}

window.togglePagoProvCobrado = async function(idx) {
    const h        = hitosProvTemp[idx]
    const prevPaid = h.paid
    const prevDate = h.paid_date
    if (!h.paid) {
        const fecha = await _pedirFechaPago()
        if (fecha === null) return
        h.paid = true; h.paid_date = fecha
    } else {
        h.paid = false; h.paid_date = null
    }
    renderHitosProveedor()
    try {
        await persistirHitosProveedor(proveedorActual.id)
        mostrarToast(h.paid ? '✅ Pago registrado' : 'Pago marcado como pendiente')
    } catch (err) {
        h.paid = prevPaid; h.paid_date = prevDate
        renderHitosProveedor()
        alert('Error al guardar: ' + err.message)
    }
}

window.eliminarHitoProv = async function(idx) {
    const hitoEliminado = hitosProvTemp.splice(idx, 1)[0]
    if (proveedorActual) {
        await recalcularPagoFinalProveedor(proveedorActual.id)
        try {
            await persistirHitosProveedor(proveedorActual.id)
        } catch (err) {
            hitosProvTemp.splice(idx, 0, hitoEliminado)
            await recalcularPagoFinalProveedor(proveedorActual.id)
            alert('Error al eliminar el hito de pago: ' + err.message)
        }
    }
}

document.getElementById('btnNuevoPagoProveedor').addEventListener('click', () => {
    document.getElementById('form-nuevo-pago-proveedor').style.display = 'block'
    document.getElementById('btnNuevoPagoProveedor').style.display     = 'none'
})

document.getElementById('btnCancelarPagoProveedor').addEventListener('click', () => {
    document.getElementById('form-nuevo-pago-proveedor').style.display = 'none'
    document.getElementById('btnNuevoPagoProveedor').style.display     = 'inline-block'
})

document.getElementById('btnGuardarPagoProveedor').addEventListener('click', () => confirmarSiTemporadaNoActiva('el pago al proveedor', async () => {
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
    if (proveedorActual) {
        await recalcularPagoFinalProveedor(proveedorActual.id)
        try {
            await persistirHitosProveedor(proveedorActual.id)
            mostrarToast('✅ Pago añadido')
        } catch (err) {
            console.error('Error al guardar nuevo pago:', err.message)
        }
    }
}))


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
    const svc = todosServicios.find(s => s.service_code === servicioId)
    return svc?.description ?? ''
}

function abrirAsistenteMultiple() {
    if (!proveedorActual) return

    const existingDisp = todaDisponibilidad.filter(d => d.venue_provider_id === proveedorActual.id)
    const assignedIds  = new Set(existingDisp.map(d => d.service_id))
    const unassigned   = todosServicios.filter(s => !assignedIds.has(s.id))

    sfcomMultipleOpen = false
    multipleRows = [
        ...existingDisp.map(d => ({
            dispId:              d.id,
            serviceId:           d.service_code,
            _svcIntId:           d.service_id,
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
            sfcomNombreVariacion: _variacionAuto(d.service_code),
            sfcomPlazas:         d.sfcom_slots_listed ?? '',
            sfcomPrecio:         '',  // nunca de la BD
        })),
        ...unassigned.map(s => ({
            dispId:              null,
            serviceId:           s.service_code,
            _svcIntId:           s.id,
            isExisting:          false,
            active:              false,
            total_slots:         null,
            price_per_slot:      null,
            billing_model:       'capacity',
            modified:            false,
            sfcom_status:        null,
            sfcomListar:         false,
            sfcomNombreProducto: '',
            sfcomNombreVariacion: _variacionAuto(s.service_code),
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
                    <option value="fixed">Cuota fija</option>
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
                    <option value="fixed" ${row.billing_model === 'fixed' ? 'selected' : ''}>Cuota fija</option>
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
            const enUnassigned = todosServicios.find(s => s.service_code === input.value)
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
            if (row.modified) {
                const _disp = todaDisponibilidad.find(d => d.id === row.dispId)
                pairsSync.push({ venueId: _disp?.venue_id ?? proveedorId, serviceId: row._svcIntId })
            }
        } else if (!row.isExisting && row.active && row.serviceId) {
            // INSERT nuevo servicio
            let servicioExiste = todosServicios.find(s => s.service_code === row.serviceId)
            let newSvc = null
            if (!servicioExiste) {
                const { data: svcData, error: errSvc } = await supabase.from('services')
                    .insert({ service_code: row.serviceId })
                    .select().single()
                if (errSvc) { alert(`Error al crear servicio ${row.serviceId}: ${errSvc.message}`); continue }
                newSvc = svcData
                todosServicios.push({ id: newSvc.id, service_code: row.serviceId })
            }
            const svcIntId = servicioExiste?.id ?? newSvc?.id
            row._svcIntId  = svcIntId
            const _newVenueId = venueActual?.id ?? proveedorId
            const yaExiste = todaDisponibilidad.find(d => d.venue_id === _newVenueId && d.service_id === svcIntId)
            if (yaExiste) continue
            const insertData = {
                venue_id:       _newVenueId,
                service_id:     svcIntId,
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
            const _svcCachedMulti   = todosServicios.find(s => s.id === svcIntId)
            const _venueCachedMulti = todosVenues.find(v => v.id === _newVenueId)
            todaDisponibilidad.push({
                ...data[0],
                service_code:       row.serviceId,
                event_type:         _svcCachedMulti?.event_type      ?? null,
                day:                _svcCachedMulti?.day              ?? null,
                start_time:         _svcCachedMulti?.start_time       ?? null,
                venue_display_name: _venueCachedMulti?.display_name   ?? null,
                venue_address:      _venueCachedMulti?.address        ?? null,
                venue_slug:         _venueCachedMulti?.slug            ?? null,
                venue_provider_id:  proveedorActual?.id                ?? null,
                photos:             null,
                access_instructions: null,
                description:        null,
                sfcom_product_id:   null,
                sfcom_variation_id: null,
                sfcom_public_price: null,
                sfcom_listing_id:   null,
                ...sfcomInsertMulti
            })
            pairsSync.push({ venueId: _newVenueId, serviceId: svcIntId })
        }
    }

    await persistirPagosProveedor(supabase, proveedorId, todasReservas, todaDisponibilidad)

    if (pairsSync.length > 0) {
        const sfcomOkMultiple = await confirmarStockSfcom(supabase, pairsSync)
        if (sfcomOkMultiple === 'sync') {
            for (const pair of pairsSync) await syncStockToSfcom(supabase, pair.venueId, pair.serviceId)
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
    document.getElementById('btnAsistenteNuevo').style.display = 'inline-block'
    document.getElementById('btnAbrirMultiple').style.display = 'inline-block'
})

// ===== ASISTENTE NUEVO SERVICIO =====

// Extrae el día del sufijo de un ID de servicio (ENCIERRO_7 → 7, POBRE_DE_MI → null)
function _extraerDiaDeId(id) {
    const m = (id || '').match(/_(6|7|8|9|10|11|12|13|14)$/i)
    return m ? parseInt(m[1]) : null
}

let nuevoDlgDias      = new Set()
let nuevoDlgUnchecked = new Set()  // IDs explícitamente desmarcados por el usuario
let nuevoDlgUltimoCampoAsig = 'precio'

function _getNuevoBase() {
    const raw = (document.getElementById('dlgNuevoBase')?.value ?? '').trim()
    return normalizarId(raw).replace(/_(6|7|8|9|10|11|12|13|14)$/i, '')
}

function _computeNuevosIds() {
    const base = _getNuevoBase()
    if (!base) return []
    if (nuevoDlgDias.size === 0) return [base]
    return [...nuevoDlgDias].sort((a, b) => a - b).map(d => `${base}_${d}`)
}

function _actualizarDiaChips() {
    const todosActivos = [7, 8, 9, 10, 11, 12, 13, 14].every(d => nuevoDlgDias.has(d))
    document.querySelectorAll('#dlgNuevoDias .dia-chip').forEach(chip => {
        const dia = chip.dataset.dia
        if (dia === 'diario') chip.classList.toggle('active', todosActivos)
        else                  chip.classList.toggle('active', nuevoDlgDias.has(parseInt(dia)))
    })
}

function _actualizarBtnNuevo(accionCount) {
    const btn = document.getElementById('btnNuevoCrear')
    if (!btn) return
    btn.disabled    = accionCount === 0
    btn.textContent = accionCount <= 0 ? 'Crear servicios'
        : accionCount === 1 ? 'Crear/asignar 1 servicio'
        : `Crear/asignar ${accionCount} servicios`
}

function _actualizarNuevoAsignacion() {
    const allIds           = _computeNuevosIds()
    const provNombre       = proveedorActual?.id ?? (inputProveedorId.value.trim() ? normalizarId(inputProveedorId.value) : null)
    const candidateVenueId = venueActual?.id ?? (proveedorActual?.id ?? provNombre)
    const hayAccion = !!provNombre && allIds.some(id => {
        const esNuevo = !todosServicios.find(s => s.id === id)
        if (esNuevo) return !nuevoDlgUnchecked.has(id)
        return !!candidateVenueId && !todaDisponibilidad.find(d => d.venue_id === candidateVenueId && d.service_id === id)
    })
    document.getElementById('nuevo-asignacion').style.display = hayAccion ? 'block' : 'none'
}

function renderNuevoPreview() {
    const preview = document.getElementById('nuevo-preview')
    if (!preview) return

    const allIds           = _computeNuevosIds()
    const provNombre       = proveedorActual?.id ?? (inputProveedorId.value.trim() ? normalizarId(inputProveedorId.value) : null)
    const candidateVenueId = venueActual?.id ?? (proveedorActual?.id ?? provNombre)

    const allSet = new Set(allIds)
    for (const id of nuevoDlgUnchecked) {
        if (!allSet.has(id)) nuevoDlgUnchecked.delete(id)
    }

    if (allIds.length === 0) {
        preview.innerHTML = '<p style="font-size:12px;color:var(--subtle)">Introduce un nombre base para ver la vista previa.</p>'
        _actualizarBtnNuevo(0)
        _actualizarNuevoAsignacion()
        return
    }

    let accionCount = 0
    let html = `<div style="font-size:12px;font-weight:600;color:var(--subtle);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Servicios</div>
    <div style="display:flex;flex-direction:column;gap:4px">`

    for (const id of allIds) {
        const existe     = !!todosServicios.find(s => s.id === id)
        const tieneAvail = existe && !!candidateVenueId &&
            !!todaDisponibilidad.find(d => d.venue_id === candidateVenueId && d.service_id === id)
        const esNuevo    = !existe
        const esSinAvail = existe && !tieneAvail && !!provNombre
        const isChecked  = esNuevo && !nuevoDlgUnchecked.has(id)

        if (isChecked)   accionCount++
        if (esSinAvail)  accionCount++

        const label = esNuevo ? 'nuevo' : esSinAvail ? 'sin asignar' : 'ya asignado'
        const color = esNuevo ? 'var(--accent-ok)' : esSinAvail ? '#b45309' : 'var(--subtle)'

        html += `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px">
            ${esNuevo && provNombre
                ? `<input type="checkbox" class="chk-nuevo-asig" data-id="${id}" ${isChecked ? 'checked' : ''} style="flex-shrink:0;width:14px;height:14px">`
                : `<span style="display:inline-block;width:14px;flex-shrink:0"></span>`
            }
            <span style="font-family:monospace;font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${id}</span>
            <span style="font-size:11px;color:${color};flex-shrink:0;white-space:nowrap">${label}</span>
        </div>`
    }
    html += '</div>'
    preview.innerHTML = html

    preview.querySelectorAll('.chk-nuevo-asig').forEach(chk => {
        chk.addEventListener('change', () => {
            if (chk.checked) nuevoDlgUnchecked.delete(chk.dataset.id)
            else             nuevoDlgUnchecked.add(chk.dataset.id)
            _actualizarBtnNuevo(
                [...allIds].filter(id => {
                    const ex = !!todosServicios.find(s => s.id === id)
                    const tv = ex && !!candidateVenueId && !!todaDisponibilidad.find(d => d.venue_id === candidateVenueId && d.service_id === id)
                    if (!ex) return !nuevoDlgUnchecked.has(id)
                    return !tv && !!provNombre
                }).length
            )
            _actualizarNuevoAsignacion()
        })
    })

    _actualizarBtnNuevo(accionCount)
    _actualizarNuevoAsignacion()
}

function abrirAsistenteNuevo() {
    nuevoDlgDias.clear()
    nuevoDlgUnchecked.clear()
    nuevoDlgUltimoCampoAsig = 'precio'

    document.getElementById('dlgNuevoBase').value    = ''
    document.getElementById('dlgNuevoNombre').value  = ''
    document.getElementById('dlgNuevoHora').value    = ''
    document.getElementById('dlgNuevoDesc').value    = ''
    document.getElementById('dlgNuevoImg').value     = ''
    _setDlgImgPicker(null)
    document.getElementById('dlgNuevoPlazas').value  = ''
    document.getElementById('dlgNuevoPrecio').value  = ''
    document.getElementById('dlgNuevoPrecio').disabled = false
    document.getElementById('dlgNuevoCoste').value   = ''
    document.getElementById('dlgNuevoModelo').value  = 'capacity'
    document.getElementById('nuevo-asignacion').style.display = 'none'

    _actualizarDiaChips()

    const provNombre = proveedorActual?.id ?? (inputProveedorId.value.trim() ? normalizarId(inputProveedorId.value) : null)
    document.getElementById('nuevo-asig-prov-label').textContent = provNombre ? `[${provNombre}]` : ''

    renderNuevoPreview()
    document.getElementById('dlgNuevoServicio').showModal()
}

// Chips de día
document.getElementById('dlgNuevoDias').addEventListener('click', e => {
    const chip = e.target.closest('.dia-chip')
    if (!chip) return
    const dia = chip.dataset.dia

    if (dia === 'diario') {
        const todosActivos = [7, 8, 9, 10, 11, 12, 13, 14].every(d => nuevoDlgDias.has(d))
        if (todosActivos) [7, 8, 9, 10, 11, 12, 13, 14].forEach(d => nuevoDlgDias.delete(d))
        else              [7, 8, 9, 10, 11, 12, 13, 14].forEach(d => nuevoDlgDias.add(d))
    } else {
        const d = parseInt(dia)
        if (nuevoDlgDias.has(d)) nuevoDlgDias.delete(d)
        else                     nuevoDlgDias.add(d)
    }

    _actualizarDiaChips()
    nuevoDlgUnchecked.clear()
    renderNuevoPreview()
})

// Nombre base — convierte espacio a _ sin .trim() para que se vea mientras se escribe
document.getElementById('dlgNuevoBase').addEventListener('input', e => {
    const normalized = e.target.value.toUpperCase().replace(/\s/g, '_')
    if (e.target.value !== normalized) {
        const pos = e.target.selectionStart
        e.target.value = normalized
        e.target.setSelectionRange(pos, pos)
    }
    nuevoDlgUnchecked.clear()
    renderNuevoPreview()
})

// Imagen preview del dialog
function _setDlgImgPicker(url) {
    const u    = url || ''
    const prev  = document.getElementById('dlgNuevoImgPreview')
    const box   = document.getElementById('dlgNuevoImgBox')
    const empty = document.getElementById('dlgNuevoImgEmpty')
    prev.src           = u
    prev.style.display = u ? 'block' : 'none'
    box.classList.toggle('has-image', !!u)
    empty.style.display = u ? 'none' : 'flex'
}
document.getElementById('dlgNuevoImg').addEventListener('input', () => {
    _setDlgImgPicker(document.getElementById('dlgNuevoImg').value.trim())
})

document.getElementById('dlgNuevoImgBox').addEventListener('click', () => {
    if (!document.getElementById('dlgNuevoImgBox').classList.contains('has-image'))
        document.getElementById('dlgNuevoImg').focus()
})

document.getElementById('dlgNuevoImgClear').addEventListener('click', e => {
    e.stopPropagation()
    _setDlgImgPicker(null)
})

// Bidireccionalidad precio/coste en asignación
document.getElementById('dlgNuevoPlazas').addEventListener('input', () => {
    const p = parseFloat(document.getElementById('dlgNuevoPlazas').value) || 0
    const r = parseFloat(document.getElementById('dlgNuevoPrecio').value) || 0
    if (document.getElementById('dlgNuevoModelo').value !== 'fixed' && p && r)
        document.getElementById('dlgNuevoCoste').value = (p * r).toFixed(2)
})

document.getElementById('dlgNuevoPrecio').addEventListener('input', () => {
    nuevoDlgUltimoCampoAsig = 'precio'
    const p = parseFloat(document.getElementById('dlgNuevoPlazas').value) || 0
    const r = parseFloat(document.getElementById('dlgNuevoPrecio').value) || 0
    if (p && r) document.getElementById('dlgNuevoCoste').value = (p * r).toFixed(2)
})

document.getElementById('dlgNuevoCoste').addEventListener('input', () => {
    nuevoDlgUltimoCampoAsig = 'coste'
    const p = parseFloat(document.getElementById('dlgNuevoPlazas').value) || 0
    const c = parseFloat(document.getElementById('dlgNuevoCoste').value) || 0
    if (document.getElementById('dlgNuevoModelo').value !== 'fixed' && p > 0)
        document.getElementById('dlgNuevoPrecio').value = (c / p).toFixed(2)
})

document.getElementById('dlgNuevoModelo').addEventListener('change', () => {
    const m     = document.getElementById('dlgNuevoModelo').value
    const inpR  = document.getElementById('dlgNuevoPrecio')
    if (m === 'fixed') {
        inpR.value    = ''
        inpR.disabled = true
    } else {
        inpR.disabled = false
        const p = parseFloat(document.getElementById('dlgNuevoPlazas').value) || 0
        const c = parseFloat(document.getElementById('dlgNuevoCoste').value) || 0
        if (p > 0 && c) inpR.value = (c / p).toFixed(2)
    }
})

// Cerrar dialog
document.getElementById('btnAsistenteNuevo').addEventListener('click', abrirAsistenteNuevo)
document.getElementById('dlgNuevoCerrar').addEventListener('click', () => document.getElementById('dlgNuevoServicio').close())
document.getElementById('btnNuevoCancelar').addEventListener('click', () => document.getElementById('dlgNuevoServicio').close())

// Modal 3 botones: proveedor nuevo
function _mostrarModalNuevoProveedor(proveedorId) {
    return new Promise(resolve => {
        const { overlay, panel } = crearModal('modal-nuevo-proveedor', { narrow: true })
        let resuelto = false
        const doResolve = val => { if (!resuelto) { resuelto = true; resolve(val) } overlay.close() }
        overlay.addEventListener('close', () => { if (!resuelto) resolve('cancel') }, { once: true })
        panel.innerHTML = `
            <h3 style="font-size:15px;margin-bottom:10px">Proveedor nuevo</h3>
            <p style="font-size:13px;color:var(--subtle);margin-bottom:20px">
                El proveedor <strong>${proveedorId}</strong> aún no está guardado en la BD.<br>
                ¿Qué quieres hacer?
            </p>
            <div style="display:flex;flex-direction:column;gap:8px">
                <button id="btnNPCrearTodo" class="btn btn-primary" style="width:100%">Crear proveedor y servicios</button>
                <button id="btnNPSoloSvc"   class="btn btn-secondary" style="width:100%">Crear solo los servicios</button>
                <button id="btnNPCancelar"  class="btn btn-secondary" style="width:100%">Cancelar</button>
            </div>`
        panel.querySelector('#btnNPCrearTodo').addEventListener('click', () => doResolve('create-all'))
        panel.querySelector('#btnNPSoloSvc').addEventListener('click',   () => doResolve('services-only'))
        panel.querySelector('#btnNPCancelar').addEventListener('click',  () => doResolve('cancel'))
    })
}

// Crear servicios
document.getElementById('btnNuevoCrear').addEventListener('click', async () => {
    const allIds     = _computeNuevosIds()
    const provNombre = proveedorActual?.id ?? (inputProveedorId.value.trim() ? normalizarId(inputProveedorId.value) : null)
    const nuevos     = allIds.filter(id => !todosServicios.find(s => s.id === id))

    // Candidate venue ID (best estimate before potential provider creation)
    const _candidateVenueId = venueActual?.id ?? (proveedorActual?.id ?? provNombre)

    // Todos los IDs seleccionados (nuevos o existentes) sin entrada en availability para este venue
    const idsSinAvail = allIds.filter(id =>
        !nuevoDlgUnchecked.has(id) &&
        !!provNombre &&
        !todaDisponibilidad.find(d => d.venue_id === _candidateVenueId && d.service_id === id)
    )

    if (nuevos.length === 0 && idsSinAvail.length === 0) {
        mostrarToast('⚠ Todos los servicios ya tienen disponibilidad asignada', '#b45309')
        return
    }

    const modelo = document.getElementById('dlgNuevoModelo').value
    const plazas = parseInt(document.getElementById('dlgNuevoPlazas').value) || 0
    const precio = modelo === 'fixed'
        ? parseFloat(document.getElementById('dlgNuevoCoste').value) || 0
        : parseFloat(document.getElementById('dlgNuevoPrecio').value) || 0
    const hora      = document.getElementById('dlgNuevoHora').value || null
    const img       = document.getElementById('dlgNuevoImg').value.trim() || null
    const name      = document.getElementById('dlgNuevoNombre').value.trim() || null
    const desc      = document.getElementById('dlgNuevoDesc').value.trim() || null
    const eventType = document.getElementById('dlgNuevoEventType').value || null

    let crearProveedor = false
    let soloServicios  = false

    if (idsSinAvail.length > 0 && !proveedorActual && provNombre) {
        const result = await _mostrarModalNuevoProveedor(provNombre)
        if (result === 'cancel') return
        if (result === 'services-only') soloServicios = true
        if (result === 'create-all')    crearProveedor = true
    }

    if (crearProveedor && provNombre) {
        const { error } = await supabase.from('providers').insert({
            id:       provNombre,
            name:     inputNombre.value.trim()            || null,
            address:  inputDireccion.value.trim()         || null,
            comments: inputProveedorComments.value.trim() || null
        })
        if (error) { alert('Error al crear proveedor: ' + error.message); return }
        const venueAddress = inputVenueDireccion.value.trim() || null
        const venueType    = selectVenueType.value || 'balcon'
        const { error: venueErr } = await supabase.from('venues').insert({
            id:          provNombre,
            provider_id: provNombre,
            address:     venueAddress,
            venue_type:  venueType
        })
        if (venueErr) console.error('Error al crear venue:', venueErr.message)
        else {
            const _nv = { id: provNombre, provider_id: provNombre, address: venueAddress,
                venue_type: venueType, display_name: null, comments: null }
            todosVenues.push(_nv)
            venuesDelProveedor = [_nv]
            venueActual        = venuesDelProveedor[0]
            renderVenueTabs(venuesDelProveedor, venueActual.id)
        }
        proveedorActual = { id: provNombre, name: inputNombre.value.trim() || null }
        todosProveedores.push(proveedorActual)
        proveedorStatus.textContent = '✅ Proveedor creado'
        proveedorStatus.style.color = 'var(--accent-ok)'
    }

    // Crear los registros de servicio que no existen aún
    const errores = []
    for (const id of nuevos) {
        const dia = _extraerDiaDeId(id)
        const { error } = await supabase.from('services')
            .insert({ id, day: dia, start_time: hora, image_url: img, name, description: desc, event_type: eventType, comments: null })
        if (error) errores.push(`${id}: ${error.message}`)
        else todosServicios.push({ id, day: dia, start_time: hora, image_url: img, name, description: desc, event_type: eventType, comments: null })
    }
    if (errores.length > 0) alert('Errores al crear servicios:\n' + errores.join('\n'))

    // Crear entradas de availability para TODOS los IDs seleccionados sin availability (nuevos y existentes)
    let asignados = 0
    if (!soloServicios && proveedorActual) {
        const _venueIdFinal = venueActual?.id ?? proveedorActual.id
        for (const id of idsSinAvail) {
            if (nuevos.includes(id) && !todosServicios.find(s => s.id === id)) continue
            if (todaDisponibilidad.find(d => d.venue_id === _venueIdFinal && d.service_id === id)) continue
            const { data: nd, error } = await supabase.from('availability').insert({
                venue_id:       _venueIdFinal,
                service_id:     id,
                total_slots:    plazas,
                price_per_slot: isNaN(precio) ? 0 : precio,
                billing_model:  modelo
            }).select().single()
            if (error) console.error('Error al asignar', id, ':', error.message)
            else {
                todaDisponibilidad.push({ ...nd, venue_provider_id: proveedorActual?.id ?? null, photos: null, access_instructions: null, description: null, event_type: eventType, sfcom_status: null, sfcom_slots_listed: null, sfcom_service_name: null, sfcom_product_id: null, sfcom_variation_id: null, sfcom_public_price: null, sfcom_listing_id: null })
                asignados++
            }
        }
        if (asignados > 0) await persistirPagosProveedor(supabase, proveedorActual.id, todasReservas, todaDisponibilidad)
    }

    const creados = nuevos.filter(id => todosServicios.find(s => s.id === id))
    document.getElementById('dlgNuevoServicio').close()
    limpiarFormularioServicio()
    if (proveedorActual) {
        cargarServiciosProveedor(proveedorActual.id)
        cargarPagosProveedor(proveedorActual.id)
    }
    const msg = []
    if (creados.length) msg.push(`${creados.length} servicio${creados.length !== 1 ? 's' : ''} creado${creados.length !== 1 ? 's' : ''}`)
    if (asignados)      msg.push(`${asignados} disponibilidad${asignados !== 1 ? 'es' : ''} asignada${asignados !== 1 ? 's' : ''}`)
    mostrarToast(`✅ ${msg.length ? msg.join(', ') : 'Sin cambios'}`)
})

document.getElementById('btnExportServicios')?.addEventListener('click', () => {
    const id = proveedorActual?.id ?? 'proveedor'
    exportTable(_datosServiciosExport, [
        { key: 'service_code',  label: 'Servicio' },
        { key: 'total_slots',   label: 'Plazas' },
        { key: 'price_per_slot',label: '€/plaza',  fmt: v => fmt(v) },
        { key: 'billing_model', label: 'Modelo',
          fmt: v => v === 'fixed' ? 'Cuota fija' : v === 'consumption' ? 'Consumo' : 'Capacidad' },
        { key: '_coste',        label: 'Coste',    fmt: v => fmt(v) },
        { key: '_reservadas',   label: 'Reservadas' },
        { key: '_clientes',     label: 'Clientes' },
    ], `servicios_${id}.xlsx`)
})

// Precarga de proveedor desde parámetro URL (ej: panel.html → proveedores.html?proveedor=BALCON_1)
const _proveedorParam = new URLSearchParams(location.search).get('proveedor')
if (_proveedorParam) {
    const _proveedorPreload = todosProveedores.find(p => p.id === _proveedorParam.toUpperCase())
    if (_proveedorPreload) { inputProveedorId.value = _proveedorPreload.id; cargarProveedor(_proveedorPreload) }
}

// ===== WIZARD: IMPORTAR DISPONIBILIDAD DESDE TEMPORADA ANTERIOR =====

document.getElementById('btnAbrirWizard').addEventListener('click', _abrirWizardDisponibilidad)
document.getElementById('dlgWizardCerrar').addEventListener('click', () => document.getElementById('dlgWizard').close())
document.getElementById('dlgWizardCancelar').addEventListener('click', () => document.getElementById('dlgWizard').close())

window._wizardActivarVenue = function(venueId) {
    _wizardVenueActivo = venueId
    _renderWizardTabs()
    _renderWizardTabla()
}

window._wizardToggleAll = function(venue, checked) {
    ;(_wizardVenueGroups[venue] ?? []).forEach(f => f.checked = checked)
    _renderWizardTabla()
    _actualizarBtnWizard()
}

window._wizardToggle = function(venue, code, checked) {
    const fila = _wizardFilas.find(f => f.venueId === venue && f.serviceCode === code)
    if (fila) fila.checked = checked
    const rows = _wizardVenueGroups[venue] ?? []
    const allChk = document.getElementById('wizardChkAll')
    if (allChk) allChk.checked = rows.every(r => r.checked)
    _actualizarBtnWizard()
}

window._wizardSort = function(col) {
    if (_wizardSortCol === col) {
        _wizardSortDir = _wizardSortDir === 'asc' ? 'desc' : 'asc'
    } else {
        _wizardSortCol = col
        _wizardSortDir = 'asc'
    }
    _renderWizardTabla()
}

function _renderWizardTabs() {
    const tabsEl = document.getElementById('wizardVenueTabs')
    const venueIds = Object.keys(_wizardVenueGroups)
    if (venueIds.length <= 1) { tabsEl.style.display = 'none'; return }
    tabsEl.style.display = 'flex'
    tabsEl.innerHTML = venueIds.map(vid =>
        `<button class="venue-tab${vid === _wizardVenueActivo ? ' active' : ''}" onclick="window._wizardActivarVenue('${vid}')">${vid}</button>`
    ).join('')
}

function _renderWizardTabla() {
    const tablaEl = document.getElementById('wizardTabla')
    const allRows = _wizardVenueGroups[_wizardVenueActivo] ?? []
    if (allRows.length === 0) {
        tablaEl.innerHTML = '<p style="color:var(--subtle);text-align:center;padding:20px 0">Sin historial para este venue.</p>'
        return
    }

    const cols = [
        { key: 'serviceCode',   label: 'Servicio'     },
        { key: 'day',           label: 'Día'          },
        { key: 'billing_model', label: 'Modelo'       },
        { key: 'total_slots',   label: 'Plazas'       },
        { key: 'price_per_slot',label: 'Precio/plaza' },
        { key: 'sourceSeason',  label: 'Temp. origen' },
    ]

    const rows = [...allRows].sort((a, b) => {
        const av = a[_wizardSortCol] ?? ''
        const bv = b[_wizardSortCol] ?? ''
        const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
        return _wizardSortDir === 'asc' ? cmp : -cmp
    })

    const arrow = col => col === _wizardSortCol ? (_wizardSortDir === 'asc' ? ' ↑' : ' ↓') : ''
    const allChecked = allRows.every(r => r.checked)
    const v = _wizardVenueActivo

    tablaEl.innerHTML = `
        <table class="admin-table" style="width:100%">
            <thead><tr>
                <th style="width:28px"><input type="checkbox" id="wizardChkAll" ${allChecked ? 'checked' : ''}
                    onchange="window._wizardToggleAll('${v}', this.checked)"></th>
                ${cols.map(c => `<th style="cursor:pointer;user-select:none" onclick="window._wizardSort('${c.key}')">${c.label}${arrow(c.key)}</th>`).join('')}
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr>
                    <td><input type="checkbox" ${r.checked ? 'checked' : ''}
                        onchange="window._wizardToggle('${r.venueId}', '${r.serviceCode}', this.checked)"></td>
                    <td>
                        <span style="font-family:monospace;font-size:12px">${r.serviceCode}</span>
                        ${!r.hasService ? `<span style="font-size:11px;color:var(--subtle);margin-left:6px">(Servicio nuevo en ${_temporada})</span>` : ''}
                    </td>
                    <td>${r.day ?? '—'}</td>
                    <td style="font-size:11px;color:var(--subtle)">${r.billing_model ?? '—'}</td>
                    <td>${r.total_slots ?? '—'}</td>
                    <td>${r.price_per_slot != null ? fmt(r.price_per_slot) : '—'}</td>
                    <td style="font-size:11px;color:var(--subtle)">${r.sourceSeason}</td>
                </tr>
            `).join('')}</tbody>
        </table>
    `
}

function _actualizarBtnWizard() {
    const n = _wizardFilas.filter(f => f.checked).length
    const btn = document.getElementById('btnWizardConfirmar')
    btn.textContent = `📥 Importar ${n} servicios`
    btn.disabled    = n === 0
}

async function _abrirWizardDisponibilidad() {
    const dlg = document.getElementById('dlgWizard')
    document.getElementById('dlgWizardTemporada').textContent = _temporada
    document.getElementById('wizardTabla').innerHTML = '<p style="color:var(--subtle);padding:20px 0">Cargando…</p>'
    document.getElementById('btnWizardConfirmar').disabled = true
    dlg.showModal()

    const venueIds = venuesDelProveedor.map(v => v.id)
    const { data: historial, error: errHist } = await supabase
        .from('availability_panel')
        .select('venue_id, service_id, service_code, season, total_slots, price_per_slot, billing_model, description, access_instructions, photos, event_type, day, start_time')
        .in('venue_id', venueIds)
        .neq('season', _temporada)
        .order('season', { ascending: false })

    if (errHist || !historial?.length) {
        document.getElementById('wizardTabla').innerHTML =
            '<p style="color:var(--subtle);text-align:center;padding:20px 0">No hay historial de disponibilidad para importar.</p>'
        return
    }

    const historicalSeasons = [...new Set(historial.map(r => r.season))]
    const { data: serviciosHistoricos } = await supabase
        .from('services')
        .select('id, service_code, season, name, description, image_url, event_type, day, start_time')
        .in('season', historicalSeasons)

    // Deduplicar por (venue_id, service_code): historial ya viene ordenado desc por season
    const seen = new Set()
    _wizardFilas = []
    for (const row of historial) {
        const key = `${row.venue_id}|${row.service_code}`
        if (seen.has(key)) continue
        seen.add(key)
        const svcMeta   = (serviciosHistoricos ?? []).find(s => s.service_code === row.service_code && s.season === row.season)
        const svcActivo = (todosServicios ?? []).find(s => s.service_code === row.service_code)
        _wizardFilas.push({
            venueId:             row.venue_id,
            serviceCode:         row.service_code,
            sourceSeason:        row.season,
            total_slots:         row.total_slots,
            price_per_slot:      row.price_per_slot,
            billing_model:       row.billing_model,
            availDesc:           row.description,
            access_instructions: row.access_instructions,
            photos:              row.photos,
            event_type:          row.event_type,
            day:                 row.day,
            start_time:          row.start_time,
            name:                svcMeta?.name        ?? null,
            image_url:           svcMeta?.image_url   ?? null,
            serviceDesc:         svcMeta?.description ?? null,
            hasService:          !!svcActivo,
            serviceId:           svcActivo?.id ?? null,
            checked:             true
        })
    }

    _wizardVenueGroups = {}
    for (const f of _wizardFilas) {
        if (!_wizardVenueGroups[f.venueId]) _wizardVenueGroups[f.venueId] = []
        _wizardVenueGroups[f.venueId].push(f)
    }
    _wizardVenueActivo = Object.keys(_wizardVenueGroups)[0]

    _renderWizardTabs()
    _renderWizardTabla()
    _actualizarBtnWizard()
}

document.getElementById('btnWizardConfirmar').addEventListener('click', async () => {
    const seleccionados = _wizardFilas.filter(f => f.checked)
    if (seleccionados.length === 0) return

    const btn = document.getElementById('btnWizardConfirmar')
    btn.disabled    = true
    btn.textContent = 'Importando…'

    // Paso 1: crear services que no existen en _temporada
    const errores = []
    for (const fila of seleccionados.filter(f => !f.hasService)) {
        const { data: newSvc, error } = await supabase.from('services').insert({
            service_code: fila.serviceCode,
            season:       _temporada,
            day:          fila.day,
            start_time:   fila.start_time,
            event_type:   fila.event_type,
            name:         fila.name,
            description:  fila.serviceDesc,
            image_url:    fila.image_url,
            comments:     null
        }).select().single()
        if (error) {
            errores.push(`${fila.serviceCode}: ${error.message}`)
        } else {
            fila.serviceId  = newSvc.id
            fila.hasService = true
        }
    }
    if (errores.length) {
        alert('Errores al crear servicios:\n' + errores.join('\n'))
        btn.disabled = false
        _actualizarBtnWizard()
        return
    }

    // Paso 2: crear filas de availability
    const erroresAvail = []
    for (const fila of seleccionados) {
        if (!fila.serviceId) { erroresAvail.push(`${fila.serviceCode}: sin service_id`); continue }
        const { error } = await supabase.from('availability').insert({
            venue_id:            fila.venueId,
            service_id:          fila.serviceId,
            total_slots:         fila.total_slots,
            price_per_slot:      fila.price_per_slot,
            billing_model:       fila.billing_model,
            description:         fila.availDesc,
            access_instructions: fila.access_instructions,
            photos:              fila.photos
        })
        if (error) erroresAvail.push(`${fila.serviceCode} @ ${fila.venueId}: ${error.message}`)
    }
    if (erroresAvail.length) alert('Errores al crear disponibilidad:\n' + erroresAvail.join('\n'))

    // Refrescar estado global
    todosServicios     = (await supabase.from('services').select('*').eq('season', _temporada).order('service_code')).data ?? []
    todaDisponibilidad = (await supabase.from('availability_panel').select('*').eq('season', _temporada)).data ?? []
    const { data: _sfcomFresh } = await supabase.from('sfcom_listings')
        .select('id, availability_id, sfcom_service_name, sfcom_slots_listed, sfcom_product_id, sfcom_variation_id, sfcom_status, sfcom_public_price')
    const _sfcomFreshMap = new Map((_sfcomFresh ?? []).map(r => [r.availability_id, r]))
    for (const d of todaDisponibilidad) {
        const sl = _sfcomFreshMap.get(d.id)
        d.sfcom_service_name  = sl?.sfcom_service_name  ?? null
        d.sfcom_slots_listed  = sl?.sfcom_slots_listed  ?? null
        d.sfcom_product_id    = sl?.sfcom_product_id    ?? null
        d.sfcom_variation_id  = sl?.sfcom_variation_id  ?? null
        d.sfcom_status        = sl?.sfcom_status        ?? null
        d.sfcom_public_price  = sl?.sfcom_public_price  ?? null
        d.sfcom_listing_id    = sl?.id                  ?? null
        d.venue_provider_id   = _venueProv.get(d.venue_id) ?? null
    }

    document.getElementById('dlgWizard').close()
    document.getElementById('bloque-wizard').style.display = 'none'
    cargarServiciosProveedor(proveedorActual.id)
    mostrarToast(`✅ ${seleccionados.length - erroresAvail.length} servicios importados`)
})