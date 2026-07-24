import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, initTemporada, getTemporadaActiva, fmt, initPrecioInput, getPrecioValue, setPrecioValue } from './utils.js'
import { mostrarToast } from './verificacion.js'
import { abrirDlgGasto } from './dlg-gasto.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

const { data: _seasonsRaw } = await supabase.from('services').select('season').order('season', { ascending: false })
const _seasonsList = [...new Set((_seasonsRaw ?? []).map(r => r.season))]
await initTemporada(_seasonsList)

const HOY = new Date().toISOString().split('T')[0]

// ===== ESTADO =====
let _archivoSeleccionado  = null
let _aiData               = null
let _editingDocId         = null
let _editingOrigFile      = null
let _editingOrigHasInv    = null
let _editingSignedUrl     = null   // URL de storage del archivo existente
let _editingAiYaExtraido  = false  // true si el doc ya tenía datos extraídos por IA
let _docsMap              = new Map()
let _viewerObjectUrl      = null   // object URL del archivo local en preview

// ===== FORM =====
const btnNuevo      = document.getElementById('btnNuevoGasto')
const formGasto     = document.getElementById('form-nuevo-gasto')
const gastoLayout   = document.getElementById('form-gasto-layout')
const gastoViewer   = document.getElementById('gasto-viewer')
const formTitulo    = document.getElementById('gastoFormTitulo')
const selectSeason  = document.getElementById('gastoSeason')
const btnGuardar    = document.getElementById('btnGuardarGasto')
const btnCancelar   = document.getElementById('btnCancelarGasto')
const inputConcepto = document.getElementById('gastoConcepto')
const inputFecha    = document.getElementById('gastoFecha')
const inputImporte  = document.getElementById('gastoImporte')
const inputHasInv   = document.getElementById('gastoHasInvoice')
const inputArchivo  = document.getElementById('gastoArchivo')
const lblArchivo    = document.getElementById('gastoArchivoNombre')
const btnLeerIA     = document.getElementById('btnLeerIA')

// Campos que la IA puede haber rellenado — se marcan como "potencialmente desfasados"
// cuando se carga un nuevo archivo sobre un doc que ya tenía datos de IA.
const _camposIA = [inputConcepto, inputFecha, inputImporte]

_seasonsList.forEach(s => {
    const opt = document.createElement('option')
    opt.value = s; opt.textContent = s
    selectSeason.appendChild(opt)
})

initPrecioInput(inputImporte)
inputFecha.value = HOY

// ===== HELPERS DE ESTADO IA =====
function _setBtnIA(estado) {
    // estados: 'disabled' | 'listo' | 'ya-extraido' | 'leyendo' | 'leido'
    switch (estado) {
        case 'disabled':
            btnLeerIA.disabled      = true
            btnLeerIA.textContent   = '🤖 Leer con IA'
            btnLeerIA.title         = ''
            btnLeerIA.style.opacity = ''
            break
        case 'listo':
            btnLeerIA.disabled      = false
            btnLeerIA.textContent   = '🤖 Leer con IA'
            btnLeerIA.title         = ''
            btnLeerIA.style.opacity = ''
            break
        case 'ya-extraido':
            btnLeerIA.disabled      = false
            btnLeerIA.textContent   = '⚠️ Re-leer con IA'
            btnLeerIA.title         = 'Datos ya extraídos de este documento. Releer tiene coste — solo si el archivo ha cambiado.'
            btnLeerIA.style.opacity = '0.55'
            break
        case 'leyendo':
            btnLeerIA.disabled      = true
            btnLeerIA.textContent   = '⏳ Leyendo…'
            btnLeerIA.title         = ''
            btnLeerIA.style.opacity = ''
            break
        case 'leido':
            btnLeerIA.disabled      = false
            btnLeerIA.textContent   = '✅ Leído'
            btnLeerIA.title         = ''
            btnLeerIA.style.opacity = ''
            break
    }
}

function _setCamposStale(stale) {
    _camposIA.forEach(el => {
        el.style.borderColor      = stale ? '#f59e0b' : ''
        el.style.backgroundColor  = stale ? '#fffbeb' : ''
        el.title = stale ? 'Valor del documento anterior — comprueba o relée con IA' : ''
    })
}

// ===== VISOR DE ARCHIVO =====
function _mostrarViewer(url, ext) {
    const isImg = ['jpg', 'jpeg', 'png', 'webp'].includes(ext)
    const media = isImg
        ? `<img src="${url}" class="dlg-img" id="gasto-viewer-media" alt="documento" style="cursor:zoom-in">`
        : `<iframe src="${url}" class="dlg-img" title="documento" style="height:100%"></iframe>`
    gastoViewer.innerHTML =
        media +
        `<a href="${url}" target="_blank"
           style="display:block;text-align:right;font-size:11px;color:var(--subtle);padding:3px 8px;border-top:1px solid var(--border);flex-shrink:0">⤢ Abrir en pestaña</a>`
    gastoViewer.style.display = ''
    gastoLayout.classList.add('dlg-gasto-layout')
    if (isImg) {
        const imgEl = document.getElementById('gasto-viewer-media')
        imgEl?.addEventListener('click', () => {
            imgEl._z = !imgEl._z
            imgEl.style.objectFit = imgEl._z ? 'none' : 'contain'
            imgEl.style.cursor    = imgEl._z ? 'zoom-out' : 'zoom-in'
        })
    }
}

function _ocultarViewer() {
    gastoViewer.innerHTML = ''
    gastoViewer.style.display = 'none'
    gastoLayout.classList.remove('dlg-gasto-layout')
    if (_viewerObjectUrl) { URL.revokeObjectURL(_viewerObjectUrl); _viewerObjectUrl = null }
}

// ===== FORM HANDLERS =====
btnNuevo.addEventListener('click', () => {
    if (_editingDocId !== null) {
        resetForm()
        formGasto.style.display = 'block'
        selectSeason.value = getTemporadaActiva()
        setTimeout(() => inputConcepto.focus(), 50)
        return
    }
    formGasto.style.display = formGasto.style.display === 'none' ? 'block' : 'none'
    if (formGasto.style.display === 'block') {
        selectSeason.value = getTemporadaActiva()
        setTimeout(() => inputConcepto.focus(), 50)
    }
})

btnCancelar.addEventListener('click', resetForm)

function _onNuevoArchivo(file) {
    _archivoSeleccionado = file
    _editingSignedUrl    = null   // ya no se usa la URL de storage
    lblArchivo.textContent = file.name
    _setCamposStale(_editingAiYaExtraido)
    _setBtnIA('listo')
    // Preview del archivo recién seleccionado
    if (_viewerObjectUrl) URL.revokeObjectURL(_viewerObjectUrl)
    const ext = file.name.split('.').pop().toLowerCase()
    if (['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(ext)) {
        _viewerObjectUrl = URL.createObjectURL(file)
        _mostrarViewer(_viewerObjectUrl, ext)
    } else {
        _ocultarViewer()
    }
}

inputArchivo.addEventListener('change', () => {
    const file = inputArchivo.files[0] ?? null
    if (file) {
        _onNuevoArchivo(file)
    } else {
        _archivoSeleccionado = null
        lblArchivo.textContent = _archivoNombreDoc()
        _setCamposStale(false)
        _setBtnIA(_editingSignedUrl ? (_editingAiYaExtraido ? 'ya-extraido' : 'listo') : 'disabled')
        // Si hay archivo en storage, mantener su preview; si no, ocultar
        if (_editingSignedUrl) {
            const ext = (_editingOrigFile ?? '').split('.').pop().toLowerCase()
            if (['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(ext)) {
                _mostrarViewer(_editingSignedUrl, ext)
            }
        } else {
            _ocultarViewer()
        }
    }
})

const dzGasto = document.getElementById('dropzone-gasto')
dzGasto.addEventListener('dragover',  e => { e.preventDefault(); dzGasto.classList.add('st-dz--over') })
dzGasto.addEventListener('dragleave', () => dzGasto.classList.remove('st-dz--over'))
dzGasto.addEventListener('drop', e => {
    e.preventDefault()
    dzGasto.classList.remove('st-dz--over')
    const file = e.dataTransfer.files[0]
    if (file) _onNuevoArchivo(file)
})

function _archivoNombreDoc() {
    if (!_editingOrigFile || _editingOrigFile.endsWith('_sin_archivo')) return ''
    return '📎 ' + _editingOrigFile.split('/').pop().replace(/^\d+_/, '')
}

// ===== LEER CON IA =====
btnLeerIA.addEventListener('click', async () => {
    const hasLocalFile   = !!_archivoSeleccionado
    const hasStorageFile = !!_editingSignedUrl
    if (!hasLocalFile && !hasStorageFile) return

    const ext = hasLocalFile
        ? _archivoSeleccionado.name.split('.').pop().toLowerCase()
        : (_editingOrigFile ?? '').split('.').pop().toLowerCase()

    const isImg = ['jpg', 'jpeg', 'png', 'webp'].includes(ext)
    const isPdf = ext === 'pdf'
    if (!isImg && !isPdf) { mostrarToast('Solo se pueden leer PDFs e imágenes con IA', '#d97706'); return }

    _setBtnIA('leyendo')

    try {
        let buffer
        if (hasLocalFile) {
            buffer = await _archivoSeleccionado.arrayBuffer()
        } else {
            const resp = await fetch(_editingSignedUrl)
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
            buffer = await resp.arrayBuffer()
        }

        const bytes = new Uint8Array(buffer)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
        const b64 = btoa(binary)

        let mediaType, cType
        if (isPdf)                             { mediaType = 'application/pdf'; cType = 'document' }
        else if (['jpg','jpeg'].includes(ext)) { mediaType = 'image/jpeg';      cType = 'image'    }
        else if (ext === 'png')                { mediaType = 'image/png';       cType = 'image'    }
        else                                   { mediaType = 'image/webp';      cType = 'image'    }

        const { data: res, error: errIA } = await supabase.functions.invoke('claude-proxy', {
            body: {
                model:      'claude-haiku-4-5-20251001',
                max_tokens: 600,
                messages: [{
                    role: 'user',
                    content: [
                        { type: cType, source: { type: 'base64', media_type: mediaType, data: b64 } },
                        { type: 'text', text:
                            'Extrae los datos fiscales de esta factura. ' +
                            'IMPORTANTE: issuer_name e issuer_nif son del EMISOR (quien vende/presta el servicio), ' +
                            'NO del destinatario ni del cliente. ' +
                            'Si aparece "Paula Díaz" o NIF "72694758S", ese es el DESTINATARIO — ignóralo para issuer. ' +
                            'Para suggested_category elige entre: proveedores, arrendamiento, servicios, suministros, otros. ' +
                            'Para concept, infiere un concepto corto y descriptivo del gasto (ej: "Hosting web anual", "Material oficina"); ' +
                            'si no puedes inferirlo con confianza, deja el campo vacío. ' +
                            'Responde SOLO JSON sin texto adicional:\n' +
                            '{"issuer_name":"","issuer_nif":"","invoice_number":"",' +
                            '"issue_date":"YYYY-MM-DD","vat_lines":[{"base":0,"rate":21,"vat":0}],' +
                            '"irpf_rate":0,"irpf_amount":0,"total":0,"suggested_category":"","concept":""}' }
                    ]
                }]
            }
        })
        if (errIA) throw new Error(errIA.message)

        const match = (res?.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/)
        if (!match) throw new Error('Sin JSON en respuesta')
        const d = JSON.parse(match[0])
        _aiData = d

        if (_editingDocId !== null) {
            if (d.issue_date) inputFecha.value = d.issue_date
            if (d.total)      setPrecioValue(inputImporte, d.total)
            if (d.concept)    inputConcepto.value = d.concept
        } else {
            if (d.issue_date && (!inputFecha.value || inputFecha.value === HOY))
                inputFecha.value = d.issue_date
            if (d.total   && !getPrecioValue(inputImporte))  setPrecioValue(inputImporte, d.total)
            if (d.concept && !inputConcepto.value.trim())    inputConcepto.value = d.concept
        }

        // Limpiar marcado de desfase una vez relleído
        _setCamposStale(false)
        _setBtnIA('leido')
    } catch (e) {
        console.error('IA gastos:', e)
        mostrarToast('No se pudo extraer automáticamente', '#d97706')
        _setBtnIA(hasLocalFile ? 'listo' : (_editingAiYaExtraido ? 'ya-extraido' : 'listo'))
    }
})

// ===== FISCAL CHECK (dos niveles) =====
async function _guardarFiscalCheck(docId, accion = 'editar') {
    const { data: inv } = await supabase
        .from('supplier_invoices')
        .select('id, invoice_number, booked_date')
        .eq('document_id', docId)
        .maybeSingle()
    if (!inv) return 'libre'

    const { data: closings } = await supabase
        .from('fiscal_closings').select('year, quarter')
        .eq('model', 'F69').not('presented_at', 'is', null)
    const closedSet = new Set((closings ?? []).map(c => `${c.year}-${c.quarter}`))
    const [y, m] = (inv.booked_date ?? HOY).split('-').map(Number)
    const q = Math.ceil(m / 3)

    if (closedSet.has(`${y}-${q}`)) {
        const verbo = accion === 'eliminar' ? 'eliminado' : 'modificado'
        alert(`Este gasto está en el ${q}T${y}, ya presentado a Hacienda. No puede ser ${verbo}.`)
        return 'bloqueado'
    }

    const msg = accion === 'eliminar'
        ? `Este gasto está anotado en el libro fiscal (${inv.invoice_number ?? 'sin nº'}). Si lo eliminas, el asiento también se borrará. ¿Continuar?`
        : `Este gasto está anotado en el libro fiscal (${inv.invoice_number ?? 'sin nº'}). Si continúas, el asiento se eliminará y tendrás que volver a anotar. ¿Continuar?`
    if (!confirm(msg)) return 'cancelado'

    await supabase.from('supplier_invoices').delete().eq('id', inv.id)
    return 'ok'
}

// ===== CARGAR DOC EN FORMULARIO (modo edición) =====
async function _cargarEnFormulario(doc) {
    _editingDocId         = doc.id
    _editingOrigFile      = doc.file_path
    _editingOrigHasInv    = doc.has_invoice
    _editingSignedUrl     = null
    _editingAiYaExtraido  = !!(doc.issuer_nif || doc.ai_vat_lines?.length)
    _archivoSeleccionado  = null
    _aiData               = null

    inputConcepto.value = doc.concept ?? ''
    inputFecha.value    = doc.expense_date ?? HOY
    setPrecioValue(inputImporte, doc.amount ?? '')
    inputHasInv.checked = doc.has_invoice !== false
    selectSeason.value  = doc.season ?? getTemporadaActiva()

    inputArchivo.value    = ''
    lblArchivo.textContent = _archivoNombreDoc()
    _setCamposStale(false)
    _setBtnIA('disabled')

    formTitulo.textContent  = 'Editar gasto'
    btnGuardar.textContent  = 'Actualizar'
    btnGuardar.disabled     = false
    formGasto.style.display = 'block'
    setTimeout(() => formGasto.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)

    // Obtener URL firmada para habilitar IA y preview del archivo existente
    const sinArch = !doc.file_path || doc.file_path.endsWith('_sin_archivo')
    if (!sinArch) {
        const { data } = await supabase.storage.from('supplier-invoices').createSignedUrl(doc.file_path, 3600)
        if (data?.signedUrl) {
            _editingSignedUrl = data.signedUrl
            _setBtnIA(_editingAiYaExtraido ? 'ya-extraido' : 'listo')
            const ext = doc.file_path.split('.').pop().toLowerCase()
            if (['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(ext)) {
                _mostrarViewer(data.signedUrl, ext)
            }
        }
    }
}

// ===== GUARDAR =====
btnGuardar.addEventListener('click', async () => {
    const concepto   = inputConcepto.value.trim()
    const fecha      = inputFecha.value
    const importe    = getPrecioValue(inputImporte)
    const hasInvoice = inputHasInv.checked
    const season     = selectSeason.value

    if (!concepto)                      { inputConcepto.focus(); mostrarToast('Falta el concepto', '#b91c1c'); return }
    if (!fecha)                         { inputFecha.focus();    mostrarToast('Falta la fecha del gasto', '#b91c1c'); return }
    if (isNaN(importe) || importe <= 0) { inputImporte.focus();  mostrarToast('El importe debe ser mayor que 0', '#b91c1c'); return }

    if (_editingDocId !== null) {
        const check = await _guardarFiscalCheck(_editingDocId)
        if (check === 'bloqueado' || check === 'cancelado') return

        if (!hasInvoice && check === 'libre' && _editingOrigHasInv !== false) {
            if (!confirm('¿Marcar este gasto como "sin factura"? No aparecerá el botón "Anotar".')) return
        }
    }

    btnGuardar.disabled    = true
    btnGuardar.textContent = 'Guardando…'

    let filePath = _editingOrigFile

    if (_archivoSeleccionado) {
        const path = `_gastos/${season}/${Date.now()}_${_archivoSeleccionado.name}`
        const { error: errUp } = await supabase.storage.from('supplier-invoices').upload(path, _archivoSeleccionado)
        if (errUp) {
            mostrarToast('Error al subir el archivo: ' + errUp.message, '#b91c1c')
            btnGuardar.disabled    = false
            btnGuardar.textContent = _editingDocId ? 'Actualizar' : 'Guardar'
            return
        }
        if (_editingOrigFile && !_editingOrigFile.endsWith('_sin_archivo')) {
            await supabase.storage.from('supplier-invoices').remove([_editingOrigFile])
        }
        filePath = path
    }

    const payload = {
        concept:      concepto,
        expense_date: fecha,
        amount:       importe,
        has_invoice:  hasInvoice,
        season,
    }

    if (_aiData) {
        payload.issuer_name        = _aiData.issuer_name        || null
        payload.issuer_nif         = _aiData.issuer_nif         || null
        payload.invoice_number     = _aiData.invoice_number     || null
        payload.issue_date         = _aiData.issue_date         || null
        payload.irpf_rate          = _aiData.irpf_rate          || null
        payload.irpf_amount        = _aiData.irpf_amount        || null
        payload.suggested_category = _aiData.suggested_category || null
        payload.ai_vat_lines       = _aiData.vat_lines?.length  ? _aiData.vat_lines : null
    } else if (_editingDocId !== null && _archivoSeleccionado) {
        // Nuevo archivo subido sin releer con IA → limpiar datos de IA del archivo anterior
        payload.issuer_name        = null
        payload.issuer_nif         = null
        payload.invoice_number     = null
        payload.issue_date         = null
        payload.irpf_rate          = null
        payload.irpf_amount        = null
        payload.suggested_category = null
        payload.ai_vat_lines       = null
    }

    let error
    if (_editingDocId !== null) {
        payload.file_path = filePath
        ;({ error } = await supabase.from('supplier_documents').update(payload).eq('id', _editingDocId))
    } else {
        payload.provider_id = null
        payload.file_path   = filePath ?? `_gastos/${season}/${Date.now()}_sin_archivo`
        ;({ error } = await supabase.from('supplier_documents').insert(payload))
    }

    if (error) {
        mostrarToast('Error al guardar: ' + error.message, '#b91c1c')
        btnGuardar.disabled    = false
        btnGuardar.textContent = _editingDocId ? 'Actualizar' : 'Guardar'
        return
    }

    mostrarToast(_editingDocId ? '✅ Gasto actualizado' : '✅ Gasto registrado')
    resetForm()
    cargarGastos()
})

function resetForm() {
    formGasto.style.display  = 'none'
    inputConcepto.value      = ''
    inputFecha.value         = HOY
    setPrecioValue(inputImporte, '')
    inputHasInv.checked      = true
    inputArchivo.value       = ''
    lblArchivo.textContent   = ''
    _setCamposStale(false)
    _setBtnIA('disabled')
    _archivoSeleccionado     = null
    _aiData                  = null
    _editingDocId            = null
    _editingOrigFile         = null
    _editingOrigHasInv       = null
    _editingSignedUrl        = null
    _editingAiYaExtraido     = false
    formTitulo.textContent   = 'Nuevo gasto'
    btnGuardar.disabled      = false
    btnGuardar.textContent   = 'Guardar'
    _ocultarViewer()
}

// ===== CARGA Y RENDER =====
async function cargarGastos() {
    const season = getTemporadaActiva()
    const [{ data: docs }, { data: invoices }, { data: closings }] = await Promise.all([
        supabase.from('supplier_documents')
            .select('*')
            .is('provider_id', null)
            .eq('season', season)
            .order('uploaded_at', { ascending: false }),
        supabase.from('supplier_invoices')
            .select('document_id, invoice_number, booked_date')
            .is('provider_id', null),
        supabase.from('fiscal_closings')
            .select('year, quarter')
            .eq('model', 'F69')
            .not('presented_at', 'is', null)
    ])

    const invoiceMap = new Map((invoices ?? []).map(i => [i.document_id, i]))
    const closedSet  = new Set((closings  ?? []).map(c => `${c.year}-${c.quarter}`))
    _docsMap = new Map((docs ?? []).map(d => [d.id, d]))

    const tbody = document.getElementById('tbody-gastos')
    const vacio = document.getElementById('gastos-vacio')

    if (!docs || docs.length === 0) {
        tbody.innerHTML = ''
        vacio.style.display = 'block'
        return
    }
    vacio.style.display = 'none'

    tbody.innerHTML = docs.map(d => {
        const inv        = invoiceMap.get(d.id)
        const sinArchivo = !d.file_path || d.file_path.endsWith('_sin_archivo')
        const nombreArch = sinArchivo ? null : d.file_path.split('/').pop().replace(/^\d+_/, '')
        const fecha      = d.expense_date ?? d.uploaded_at.split('T')[0]

        let isClosed = false
        if (inv?.booked_date) {
            const [y, m] = inv.booked_date.split('-').map(Number)
            isClosed = closedSet.has(`${y}-${Math.ceil(m / 3)}`)
        }

        let estadoCell
        if (inv?.invoice_number) {
            estadoCell = `<span style="font-size:11px;color:var(--accent-ok)">✅ ${inv.invoice_number}</span>`
        } else if (d.has_invoice === false) {
            estadoCell = `<span style="color:var(--subtle);font-size:12px">Sin factura</span>`
        } else {
            estadoCell = isClosed || sinArchivo
                ? `<span style="color:var(--subtle);font-size:12px">${sinArchivo ? 'Sin archivo' : 'Sin anotar'}</span>`
                : `<button class="btn btn-primary" style="font-size:11px;padding:3px 8px"
                       onclick="event.stopPropagation();_anotarGastoRow(${d.id})">Anotar</button>`
        }

        const delCell = isClosed
            ? `<span title="Trimestre cerrado" style="font-size:13px;color:var(--subtle);padding:0 4px">🔒</span>`
            : `<button class="btn btn-danger" style="font-size:11px;padding:3px 8px"
                   onclick="event.stopPropagation();eliminarGasto(${d.id},'${d.file_path}',${sinArchivo})">🗑</button>`

        const rowAttrs = isClosed
            ? `style="opacity:0.7"`
            : `onclick="window.editarGasto(${d.id})" style="cursor:pointer"`

        return `<tr ${rowAttrs}>
            <td><strong>${d.concept ?? '—'}</strong></td>
            <td style="white-space:nowrap">${fecha}</td>
            <td style="text-align:right;white-space:nowrap">${d.amount != null ? fmt(d.amount) : '—'}</td>
            <td>${sinArchivo || !nombreArch
                ? '<span style="color:var(--subtle);font-size:12px">Sin archivo</span>'
                : `<a href="#" onclick="event.stopPropagation();verGasto('${d.file_path}');return false" style="font-size:12px">📎 ${nombreArch}</a>`
            }</td>
            <td>${estadoCell}</td>
            <td style="white-space:nowrap;text-align:center">${delCell}</td>
        </tr>`
    }).join('')
}

window.verGasto = async function (path) {
    const { data, error } = await supabase.storage.from('supplier-invoices').createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) { alert('No se pudo abrir el archivo'); return }
    window.open(data.signedUrl, '_blank')
}

window.eliminarGasto = async function (docId, filePath, sinArchivo) {
    if (!confirm('¿Eliminar este gasto? La acción no se puede deshacer.')) return
    const check = await _guardarFiscalCheck(docId, 'eliminar')
    if (check === 'bloqueado' || check === 'cancelado') return
    if (!sinArchivo) await supabase.storage.from('supplier-invoices').remove([filePath])
    const { error } = await supabase.from('supplier_documents').delete().eq('id', docId)
    if (error) { alert('Error al eliminar: ' + error.message); return }
    mostrarToast('Gasto eliminado')
    cargarGastos()
}

window.editarGasto = async function (docId) {
    const doc = _docsMap.get(docId)
    if (!doc) return
    await _cargarEnFormulario(doc)
}

window._anotarGastoRow = (docId) =>
    abrirDlgGasto(docId, null, () => cargarGastos())

// ===== ARRANQUE =====
cargarGastos()
document.addEventListener('temporadaCambiada', cargarGastos)
