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
let _docsMap              = new Map()

// ===== FORM =====
const btnNuevo      = document.getElementById('btnNuevoGasto')
const formGasto     = document.getElementById('form-nuevo-gasto')
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

_seasonsList.forEach(s => {
    const opt = document.createElement('option')
    opt.value = s; opt.textContent = s
    selectSeason.appendChild(opt)
})

initPrecioInput(inputImporte)
inputFecha.value = HOY

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

inputArchivo.addEventListener('change', () => {
    _archivoSeleccionado = inputArchivo.files[0] ?? null
    if (_archivoSeleccionado) {
        lblArchivo.textContent = _archivoSeleccionado.name
        btnLeerIA.disabled     = false
        btnLeerIA.textContent  = '🤖 Leer con IA'
    } else {
        lblArchivo.textContent = _archivoNombreDoc()
        btnLeerIA.disabled     = true
    }
})

const dzGasto = document.getElementById('dropzone-gasto')
dzGasto.addEventListener('dragover',  e => { e.preventDefault(); dzGasto.classList.add('st-dz--over') })
dzGasto.addEventListener('dragleave', () => dzGasto.classList.remove('st-dz--over'))
dzGasto.addEventListener('drop', e => {
    e.preventDefault()
    dzGasto.classList.remove('st-dz--over')
    const file = e.dataTransfer.files[0]
    if (!file) return
    _archivoSeleccionado  = file
    lblArchivo.textContent = file.name
    btnLeerIA.disabled     = false
    btnLeerIA.textContent  = '🤖 Leer con IA'
})

function _archivoNombreDoc() {
    if (!_editingOrigFile || _editingOrigFile.endsWith('_sin_archivo')) return ''
    return '📎 ' + _editingOrigFile.split('/').pop().replace(/^\d+_/, '')
}

// ===== LEER CON IA =====
btnLeerIA.addEventListener('click', async () => {
    if (!_archivoSeleccionado) return
    const ext   = _archivoSeleccionado.name.split('.').pop().toLowerCase()
    const isImg = ['jpg', 'jpeg', 'png', 'webp'].includes(ext)
    const isPdf = ext === 'pdf'
    if (!isImg && !isPdf) { mostrarToast('Solo se pueden leer PDFs e imágenes con IA', '#d97706'); return }

    btnLeerIA.disabled    = true
    btnLeerIA.textContent = '⏳ Leyendo…'

    try {
        const buffer = await _archivoSeleccionado.arrayBuffer()
        const bytes  = new Uint8Array(buffer)
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
            // Edit mode: overwrite all fields unconditionally
            if (d.issue_date) inputFecha.value = d.issue_date
            if (d.total)      setPrecioValue(inputImporte, d.total)
            if (d.concept)    inputConcepto.value = d.concept
        } else {
            // New mode: only fill if empty / still at default
            if (d.issue_date && (!inputFecha.value || inputFecha.value === HOY))
                inputFecha.value = d.issue_date
            if (d.total   && !getPrecioValue(inputImporte))  setPrecioValue(inputImporte, d.total)
            if (d.concept && !inputConcepto.value.trim())    inputConcepto.value = d.concept
        }

        btnLeerIA.textContent = '✅ Leído'
        btnLeerIA.disabled    = false
    } catch (e) {
        console.error('IA gastos:', e)
        mostrarToast('No se pudo extraer automáticamente', '#d97706')
        btnLeerIA.textContent = '🤖 Leer con IA'
        btnLeerIA.disabled    = false
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
function _cargarEnFormulario(doc) {
    _editingDocId      = doc.id
    _editingOrigFile   = doc.file_path
    _editingOrigHasInv = doc.has_invoice
    _archivoSeleccionado = null
    _aiData              = null

    inputConcepto.value = doc.concept ?? ''
    inputFecha.value    = doc.expense_date ?? HOY
    setPrecioValue(inputImporte, doc.amount ?? '')
    inputHasInv.checked = doc.has_invoice !== false
    selectSeason.value  = doc.season ?? getTemporadaActiva()

    inputArchivo.value    = ''
    lblArchivo.textContent = _archivoNombreDoc()
    btnLeerIA.disabled    = true
    btnLeerIA.textContent = '🤖 Leer con IA'

    formTitulo.textContent  = 'Editar gasto'
    btnGuardar.textContent  = 'Actualizar'
    btnGuardar.disabled     = false
    formGasto.style.display = 'block'
    setTimeout(() => formGasto.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
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

        // Only ask about has_invoice=false if it was previously true
        if (!hasInvoice && check === 'libre' && _editingOrigHasInv !== false) {
            if (!confirm('¿Marcar este gasto como "sin factura"? No aparecerá el botón "Anotar".')) return
        }
    }

    btnGuardar.disabled    = true
    btnGuardar.textContent = 'Guardando…'

    let filePath = _editingOrigFile  // preserved in edit mode if no new file

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
    }

    let error
    if (_editingDocId !== null) {
        payload.file_path = filePath  // may be unchanged or new
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
    btnLeerIA.disabled       = true
    btnLeerIA.textContent    = '🤖 Leer con IA'
    _archivoSeleccionado     = null
    _aiData                  = null
    _editingDocId            = null
    _editingOrigFile         = null
    _editingOrigHasInv       = null
    formTitulo.textContent   = 'Nuevo gasto'
    btnGuardar.disabled      = false
    btnGuardar.textContent   = 'Guardar'
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
            estadoCell = isClosed
                ? `<span style="color:var(--subtle);font-size:12px">Sin anotar</span>`
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

window.editarGasto = function (docId) {
    const doc = _docsMap.get(docId)
    if (!doc) return
    _cargarEnFormulario(doc)
}

window._anotarGastoRow = (docId) =>
    abrirDlgGasto(docId, null, () => cargarGastos())

// ===== ARRANQUE =====
cargarGastos()
document.addEventListener('temporadaCambiada', cargarGastos)
