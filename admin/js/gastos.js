import { supabase } from './supabase.js'
import { requireAuth, logout } from './auth.js'
import { initSidebar, initTemporada, getTemporadaActiva } from './utils.js'
import { mostrarToast } from './verificacion.js'

await requireAuth()
document.getElementById('btnLogout').addEventListener('click', logout)
initSidebar()

const { data: _seasons } = await supabase.from('services').select('season').order('season', { ascending: false })
await initTemporada([...new Set((_seasons ?? []).map(r => r.season))])

// ===== ESTADO =====
let _archivoSeleccionado = null

// ===== FORM =====
const btnNuevo   = document.getElementById('btnNuevoGasto')
const formGasto  = document.getElementById('form-nuevo-gasto')
const btnGuardar = document.getElementById('btnGuardarGasto')
const btnCancelar = document.getElementById('btnCancelarGasto')
const inputConcepto = document.getElementById('gastoConcepto')
const inputNotas    = document.getElementById('gastoNotas')
const inputArchivo  = document.getElementById('gastoArchivo')
const lblArchivo    = document.getElementById('gastoArchivoNombre')

btnNuevo.addEventListener('click', () => {
    formGasto.style.display = formGasto.style.display === 'none' ? 'block' : 'none'
    if (formGasto.style.display === 'block') setTimeout(() => inputConcepto.focus(), 50)
})

btnCancelar.addEventListener('click', resetForm)

inputArchivo.addEventListener('change', () => {
    _archivoSeleccionado = inputArchivo.files[0] ?? null
    lblArchivo.textContent = _archivoSeleccionado ? _archivoSeleccionado.name : ''
})

btnGuardar.addEventListener('click', async () => {
    const concepto = inputConcepto.value.trim()
    if (!concepto) { inputConcepto.focus(); return }

    btnGuardar.disabled = true
    btnGuardar.textContent = 'Guardando…'

    const season = getTemporadaActiva()
    let filePath = null

    if (_archivoSeleccionado) {
        const path = `_gastos/${season}/${Date.now()}_${_archivoSeleccionado.name}`
        const { error: errUp } = await supabase.storage
            .from('supplier-invoices')
            .upload(path, _archivoSeleccionado)
        if (errUp) {
            alert('Error al subir el archivo: ' + errUp.message)
            btnGuardar.disabled = false
            btnGuardar.textContent = 'Guardar'
            return
        }
        filePath = path
    }

    const { error } = await supabase.from('supplier_documents').insert({
        provider_id: null,
        concept:     concepto,
        notes:       inputNotas.value.trim() || null,
        file_path:   filePath ?? `_gastos/${season}/${Date.now()}_sin_archivo`,
        season,
    })

    if (error) {
        alert('Error al guardar: ' + error.message)
        btnGuardar.disabled = false
        btnGuardar.textContent = 'Guardar'
        return
    }

    mostrarToast('✅ Gasto registrado')
    resetForm()
    cargarGastos()
})

function resetForm() {
    formGasto.style.display = 'none'
    inputConcepto.value = ''
    inputNotas.value    = ''
    inputArchivo.value  = ''
    lblArchivo.textContent = ''
    _archivoSeleccionado   = null
    btnGuardar.disabled    = false
    btnGuardar.textContent = 'Guardar'
}

// ===== CARGA Y RENDER =====
async function cargarGastos() {
    const season = getTemporadaActiva()
    const [{ data: docs }, { data: invoices }] = await Promise.all([
        supabase.from('supplier_documents')
            .select('*')
            .is('provider_id', null)
            .eq('season', season)
            .order('uploaded_at', { ascending: false }),
        supabase.from('supplier_invoices')
            .select('document_id, invoice_number')
            .is('provider_id', null)
    ])

    const registradoMap = new Map((invoices ?? []).map(i => [i.document_id, i.invoice_number]))
    const tbody = document.getElementById('tbody-gastos')
    const vacio = document.getElementById('gastos-vacio')

    if (!docs || docs.length === 0) {
        tbody.innerHTML = ''
        vacio.style.display = 'block'
        return
    }
    vacio.style.display = 'none'

    tbody.innerHTML = docs.map(d => {
        const numFactura = registradoMap.get(d.id)
        const fecha      = d.uploaded_at.split('T')[0]
        const sinArchivo = d.file_path.endsWith('_sin_archivo')
        const nombreArchivo = sinArchivo ? '—' : d.file_path.split('/').pop().replace(/^\d+_/, '')
        return `<tr>
            <td><strong>${d.concept ?? '—'}</strong></td>
            <td style="white-space:nowrap">${fecha}</td>
            <td>${sinArchivo
                ? '<span style="color:var(--subtle);font-size:12px">Sin archivo</span>'
                : `<a href="#" onclick="verGasto('${d.file_path}');return false" style="font-size:12px">📎 ${nombreArchivo}</a>`
            }</td>
            <td style="font-size:12px;color:var(--subtle)">${d.notes ?? ''}</td>
            <td>${numFactura
                ? `<span style="font-size:11px;color:var(--accent-ok)">✅ ${numFactura}</span>`
                : `<span style="font-size:11px;color:var(--subtle)">Pendiente</span>`
            }</td>
            <td style="white-space:nowrap">
                <button class="btn btn-danger" style="font-size:11px;padding:3px 8px"
                    onclick="eliminarGasto(${d.id},'${d.file_path}',${sinArchivo})">🗑</button>
            </td>
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
    const { data: inv } = await supabase.from('supplier_invoices').select('id').eq('document_id', docId).maybeSingle()
    if (inv) { alert('Este gasto está registrado en el libro fiscal. Elimina la entrada del libro antes de borrarlo.'); return }
    if (!sinArchivo) await supabase.storage.from('supplier-invoices').remove([filePath])
    const { error } = await supabase.from('supplier_documents').delete().eq('id', docId)
    if (error) { alert('Error al eliminar: ' + error.message); return }
    mostrarToast('Gasto eliminado')
    cargarGastos()
}

// ===== ARRANQUE =====
cargarGastos()
document.addEventListener('temporadaCambiada', cargarGastos)
