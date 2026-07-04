import { crearModal } from './modal.js'
import { mostrarToast } from './verificacion.js'

// ===== UTILIDADES COMPARTIDAS DEL ADMIN =====

// Formatea un número como moneda EUR
export const fmt = n => parseFloat(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })

// ===== SISTEMA DE TEMPORADAS =====

let _todasTemporadas = []

// Traduce una fecha al año de temporada: julio 15+ o agosto+ → año siguiente.
export function temporadaDeFecha(fecha) {
    const d = new Date(fecha)
    const m = d.getMonth()
    return (m > 6 || (m === 6 && d.getDate() >= 15)) ? d.getFullYear() + 1 : d.getFullYear()
}

// Calcula la temporada por defecto según la fecha y las temporadas disponibles.
// Puro cálculo, no lee localStorage.
export function calcularTemporadaDefault(todasTemporadas) {
    const hoy          = new Date()
    const anioHoy      = hoy.getFullYear()
    const esPostAgosto = hoy.getMonth() >= 7
    const anioSig      = anioHoy + 1

    if (todasTemporadas.length === 0) return anioHoy

    const maxT = Math.max(...todasTemporadas)
    if (esPostAgosto && todasTemporadas.includes(anioSig)) return anioSig
    return maxT
}

// Devuelve la temporada activa (integer). Lee localStorage; si no hay nada, usa calcularTemporadaDefault.
export function getTemporadaActiva() {
    const guardada = localStorage.getItem('vsf_temporada_activa')
    if (guardada) return parseInt(guardada)
    return calcularTemporadaDefault(_todasTemporadas)
}

// Guarda la temporada activa en localStorage y recarga la página.
export function setTemporadaActiva(season) {
    localStorage.setItem('vsf_temporada_activa', season)
    window.location.reload()
}

// Inicializa el sistema de temporadas: renderiza el selector en el sidebar y muestra el toast.
// todasTemporadas: array de integers con las temporadas que tienen datos (más reciente primero).
export async function initTemporada(todasTemporadas, onReady) {
    _todasTemporadas = todasTemporadas

    const temporadaDefault = calcularTemporadaDefault(todasTemporadas)
    if (!localStorage.getItem('vsf_temporada_activa')) {
        localStorage.setItem('vsf_temporada_activa', temporadaDefault)
    }
    const temporadaActiva = getTemporadaActiva()

    // Opciones del selector: próxima temporada vacía (max+1) + todas con datos
    const maxConDatos     = todasTemporadas.length > 0 ? Math.max(...todasTemporadas) : new Date().getFullYear()
    const proximaTemp     = maxConDatos + 1
    const opciones        = todasTemporadas.includes(proximaTemp)
        ? [...todasTemporadas]
        : [proximaTemp, ...todasTemporadas]

    // Selector en el sidebar
    const pHeader = document.querySelector('.sidebar-header p')
    if (pHeader) {
        pHeader.className = 'sidebar-temporada'
        if (temporadaActiva !== temporadaDefault) pHeader.classList.add('temporada-no-activa')
        pHeader.innerHTML = `Gestión · <select id="selectTemporada" class="sidebar-season-select"></select>`
        const select = pHeader.querySelector('#selectTemporada')
        opciones.forEach(t => {
            const opt = document.createElement('option')
            opt.value       = t
            opt.textContent = todasTemporadas.includes(t) ? String(t) : `${t} →`
            if (!todasTemporadas.includes(t)) opt.className = 'season-next'
            if (t === temporadaActiva) opt.selected = true
            select.appendChild(opt)
        })
        select.addEventListener('change', () => setTemporadaActiva(parseInt(select.value)))
    }

    // Toast si la temporada activa no es la por defecto
    if (temporadaActiva !== temporadaDefault) {
        const content = document.querySelector('.content')
        if (content) {
            const toast       = document.createElement('div')
            toast.className   = 'toast-temporada'
            toast.id          = 'toastTemporada'
            const sinDatos    = !todasTemporadas.includes(temporadaActiva)
            toast.textContent = sinDatos
                ? `Temporada ${temporadaActiva} — Próxima temporada (sin datos aún)`
                : `Temporada ${temporadaActiva} — Estás viendo datos de una temporada anterior`
            content.insertBefore(toast, content.firstChild)
        }
    }

    onReady?.()
}

// Muestra un modal de confirmación antes de ejecutar onConfirmar si la temporada activa no es la default.
// tipoCosa: texto descriptivo que aparece en el modal ("la reserva", "el cobro", etc.).
export async function confirmarSiTemporadaNoActiva(tipoCosa, onConfirmar) {
    const temporadaActiva  = getTemporadaActiva()
    const temporadaDefault = calcularTemporadaDefault(_todasTemporadas)
    if (temporadaActiva === temporadaDefault) { await onConfirmar(); return }

    const { overlay, panel } = crearModal('modal-confirm-temporada', { narrow: true })
    panel.innerHTML = `
        <h2 style="margin-bottom:12px">Temporada no activa</h2>
        <p style="font-size:13px;color:var(--subtle);margin-bottom:20px">
            Estás modificando ${tipoCosa} en la temporada <strong>${temporadaActiva}</strong>,
            que no es la temporada actual. ¿Confirmar?
        </p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn btn-secondary" id="btnCancelConfirmTemp">Cancelar</button>
            <button class="btn btn-primary"   id="btnOkConfirmTemp">Confirmar</button>
        </div>`
    overlay.showModal()
    panel.querySelector('#btnCancelConfirmTemp').addEventListener('click', () => overlay.close())
    panel.querySelector('#btnOkConfirmTemp').addEventListener('click', async () => {
        overlay.close()
        await onConfirmar()
    })
}

// Año de la temporada activa (alias de getTemporadaActiva para compatibilidad con propuesta/factura/asistente).
export function anioTemporada() {
    return getTemporadaActiva()
}

// Fecha por defecto para cobros al cliente: 6 de julio de la temporada activa.
export function fechaCobroDefault() {
    return `${getTemporadaActiva()}-07-06`
}

// Fecha por defecto para pagos al proveedor: 15 de julio de la temporada activa.
export function fechaPagoDefault() {
    return `${getTemporadaActiva()}-07-15`
}

// Inicializa hamburger y overlay del sidebar
export function initSidebar() {
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
}

// Normaliza un string para búsqueda: mayúsculas, sin acentos
export function normalizar(str) {
    return (str ?? '').toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Convierte espacios en guiones bajos y pone en mayúsculas
export function normalizarId(str) {
    return str.trim().toUpperCase().replace(/\s+/g, '_')
}

// Devuelve true si v es null, undefined o cadena que al recortar queda vacía
export function esVacio(v) {
    return v == null || String(v).trim() === ''
}

// Devuelve v recortado si tiene contenido, o fallback en caso contrario.
// Trata null, undefined y cadenas de solo espacios como ausencia de valor.
export function valorO(v, fallback) {
    if (v == null) return fallback
    const t = String(v).trim()
    return t === '' ? fallback : t
}

// Ordena un array por columna índice y dirección; getKey(item, colIdx) → valor comparable
export function sortArr(arr, col, dir, getKey) {
    if (col === null) return arr
    return [...arr].sort((a, b) => {
        const cmp = String(getKey(a, col) ?? '').localeCompare(String(getKey(b, col) ?? ''), 'es', { numeric: true })
        return dir === 'asc' ? cmp : -cmp
    })
}

// Renderiza un thead con iconos de sort clicables
export function renderThead(thead, columnas, sortCol, sortDir, onClick) {
    thead.innerHTML = '<tr>' + columnas.map((label, i) => {
        const activa = sortCol === i
        return `<th style="cursor:pointer;user-select:none">${label} <span style="font-size:10px;opacity:${activa ? 1 : 0.4}">${activa ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span></th>`
    }).join('') + '</tr>'
    thead.querySelectorAll('th').forEach((th, i) => th.addEventListener('click', () => onClick(i)))
}

// Registra guardado automático en Supabase para un array de inputs de texto.
// campos: array de input elements; camposDB: array de nombres de columna (mismo orden).
// getEntity(): devuelve el objeto en memoria (con .id). Si devuelve falsy, no hace nada.
// Actualiza el objeto local tras guardar. onSaved/onError son callbacks opcionales.
export function initAutoSave(supabase, campos, camposDB, tabla, getEntity, { onSaved, onError } = {}) {
    campos.forEach((input, i) => {
        input.addEventListener('change', async () => {
            const entity = getEntity()
            if (!entity) return
            const { error } = await supabase
                .from(tabla)
                .update({ [camposDB[i]]: input.value.trim() || null })
                .eq('id', entity.id)
            if (error) {
                if (onError) onError(error)
                else console.error(`[initAutoSave] ${tabla}.${camposDB[i]}:`, error)
                return
            }
            entity[camposDB[i]] = input.value.trim() || null
            onSaved?.()
        })
    })
}

// Busca en una lista con prioridades:
// 1. Empieza por id, 2. Empieza por campo2, 3. Empieza por campo3, 4. Contiene en cualquier campo
// lista: array de objetos, campos: [campoId, campo2, campo3]
export function buscarConPrioridad(lista, texto, campos) {
    const q = normalizar(texto)
    if (!q) return []

    const grupos = [[], [], [], []]

    lista.forEach(item => {
        const vals = campos.map(c => normalizar(item[c] ?? ''))
        if (vals[0].startsWith(q))                          grupos[0].push(item)
        else if (vals[1]?.startsWith(q))                    grupos[1].push(item)
        else if (vals[2]?.startsWith(q))                    grupos[2].push(item)
        else if (vals.some(v => v.includes(q)))             grupos[3].push(item)
    })

    return [...grupos[0], ...grupos[1], ...grupos[2], ...grupos[3]]
}

// Genera y descarga un CSV con BOM UTF-8 (compatible con Excel en Windows y Mac).
// columns: [{ key, label, fmt? }] donde fmt(val, row) → string para la celda.
// Usa punto y coma como separador (Excel en español usa coma como decimal).
// Genera y descarga un .xlsx usando SheetJS (carga dinámica bajo demanda, ~900KB, solo al primer click).
// columns: [{ key, label, fmt? }] donde fmt(val, row) → string/número para la celda.
export async function exportTable(rows, columns, filename) {
    const { utils, writeFile } = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
    const header = columns.map(c => c.label)
    const data   = rows.map(r =>
        columns.map(c => {
            const raw = c.fmt ? c.fmt(r[c.key], r) : (r[c.key] ?? '')
            return raw ?? ''
        })
    )
    const ws = utils.aoa_to_sheet([header, ...data])
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Datos')
    writeFile(wb, filename.replace(/\.csv$/, '.xlsx'))
}

// Renderiza chips de clientes con color por estado y plazas entre paréntesis.
// Agrupa por client_id (suma slots, peor estado: si cualquier reserva es Pendiente, el chip es naranja).
// Recibe array de reservas { client_id, slots, status }. Devuelve HTML o '—' si vacío.
export function renderClientChips(reservas) {
    const map = new Map()
    for (const r of reservas) {
        if (!map.has(r.client_id)) map.set(r.client_id, { slots: 0, status: 'Confirmada' })
        const e = map.get(r.client_id)
        e.slots += r.slots ?? 0
        if (r.status === 'Pendiente') e.status = 'Pendiente'
    }
    if (map.size === 0) return '—'
    return [...map.entries()]
        .map(([id, { slots, status }]) => {
            const color = status === 'Confirmada' ? 'var(--accent-ok)' : 'var(--accent-warn)'
            return `<span style="color:${color};white-space:nowrap;cursor:pointer" onclick="event.stopPropagation();location.href='formulario.html?cliente=${id}'">${id}(${slots})</span>`
        }).join(' ')
}

// Calcula el saldo de cobros de un cliente: total reservas − prepagos. Función pura, sin queries.
export function calcularSaldoCobro(clienteId, reservas, charges) {
    const total = clienteId === 'SFCOM'
        ? reservas.filter(r => r.origin_ref?.startsWith('WEB') && r.status !== 'Cancelada')
                  .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
        : reservas.filter(r => r.client_id === clienteId && r.status !== 'Cancelada')
                  .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
    const hitoFinal = charges.find(c => c.is_final) ?? null
    const prepagos  = charges.filter(c => !c.is_final).reduce((s, c) => s + parseFloat(c.amount || 0), 0)
    return { total, prepagos, cuantiaCorrecta: total - prepagos, hitoFinal }
}

// Calcula el coste total de un proveedor según billing_model. Función pura, sin queries.
export function calcularCostoPago(venueIds, reservas, disponibilidad) {
    const dispProv = disponibilidad.filter(d => venueIds.has(d.venue_id))
    return dispProv.reduce((total, d) => {
        if (d.billing_model === 'capacity') {
            return total + (d.total_slots ?? 0) * parseFloat(d.price_per_slot ?? 0)
        } else if (d.billing_model === 'fixed') {
            const tieneReserva = reservas.some(r =>
                r.venue_id === d.venue_id && r.service_id === d.service_id && r.status !== 'Cancelada')
            return total + (tieneReserva ? parseFloat(d.price_per_slot ?? 0) : 0)
        } else {
            const plazasRes = reservas
                .filter(r => r.venue_id === d.venue_id && r.service_id === d.service_id && r.status !== 'Cancelada')
                .reduce((s, r) => s + r.slots, 0)
            return total + plazasRes * parseFloat(d.price_per_slot ?? 0)
        }
    }, 0)
}

// Calcula el saldo de pagos de un proveedor: coste total − prepagos. Función pura, sin queries.
export function calcularSaldoPago(venueIds, reservas, disponibilidad, payments) {
    const costTotal = calcularCostoPago(venueIds, reservas, disponibilidad)
    const hitoFinal = payments.find(p => p.is_final) ?? null
    const prepagos  = payments.filter(p => !p.is_final).reduce((s, p) => s + parseFloat(p.amount || 0), 0)
    return { costTotal, prepagos, cuantiaCorrecta: costTotal - prepagos, hitoFinal }
}

// Recalcula y persiste en Supabase el cobro final de un cliente
// Llama siempre que cambie cualquier reserva del cliente
export async function persistirCobrosCliente(supabase, clienteId, todasReservas) {
    const { data: charges, error: errSelect } = await supabase
        .from('charges').select('*').eq('client_id', clienteId).eq('season', getTemporadaActiva())
    if (errSelect) { console.error('persistirCobrosCliente: error leyendo charges:', errSelect); return }

    const { cuantiaCorrecta: cobroFinal, hitoFinal } = calcularSaldoCobro(clienteId, todasReservas, charges ?? [])

    if (cobroFinal < -0.01) {
        const { overlay, panel } = crearModal('aviso-cobro-negativo')
        panel.innerHTML = `
            <div>
                <div class="modal-header-title">⚠️ Cobro final negativo</div>
                <div class="modal-header-desc">El cobro final de <strong>${clienteId}</strong> ha resultado <strong>${fmt(cobroFinal)}</strong>.<br><br>
                Esto suele ocurrir cuando se cancelan reservas después de haber registrado cobros o adelantos. Revisa los cobros de este cliente.</div>
            </div>
            <div class="modal-actions">
                <button id="btn-cobro-neg-ok" class="btn btn-primary" autofocus>Entendido</button>
            </div>`
        panel.querySelector('#btn-cobro-neg-ok').onclick = () => overlay.close()
    }

    if (!hitoFinal && cobroFinal < 0.01) return

    if (!hitoFinal) {
        const { error } = await supabase.from('charges').insert({
            client_id: clienteId, amount: cobroFinal, due_date: fechaCobroDefault(),
            collected: false, collected_date: null, comments: 'Cobro final', is_final: true,
            season: getTemporadaActiva()
        })
        if (error) { console.error('persistirCobrosCliente: error creando cobro final:', error); return }
        console.log(`💰 Cobro final creado para ${clienteId}: ${cobroFinal}€`)
    } else if (Math.abs(parseFloat(hitoFinal.amount) - cobroFinal) >= 0.01) {
        const bloqueado = !!(hitoFinal.invoice_number || hitoFinal.collected)
        if (bloqueado) {
            const diferencia = cobroFinal - parseFloat(hitoFinal.amount)
            const { error: e1 } = await supabase.from('charges')
                .update({ is_final: false }).eq('id', hitoFinal.id)
            if (e1) { console.error('persistirCobrosCliente: error degradando hito bloqueado:', e1); return }
            const comentario = hitoFinal.invoice_number
                ? 'Ajuste s/ factura ' + hitoFinal.invoice_number
                : 'Ajuste s/ cobro previo'
            const { error: e2 } = await supabase.from('charges').insert({
                client_id: clienteId, amount: diferencia, due_date: fechaCobroDefault(),
                collected: false, collected_date: null,
                comments: comentario, is_final: true,
                season: getTemporadaActiva()
            })
            if (e2) { console.error('persistirCobrosCliente: error creando ajuste:', e2); return }
            const motivo = hitoFinal.invoice_number
                ? `ya estaba facturado (${hitoFinal.invoice_number})`
                : 'ya estaba cobrado'
            alert(`⚠️ El cobro final de ${clienteId} ${motivo}.\n\nSe ha creado un hito de ajuste por ${diferencia > 0 ? '+' : ''}${fmt(diferencia)} que queda pendiente de cobro.`)
        } else {
            const { error } = await supabase.from('charges')
                .update({ amount: cobroFinal }).eq('id', hitoFinal.id)
            if (error) { console.error('persistirCobrosCliente: error actualizando cobro final:', error); return }
            console.log(`💰 Cobro final actualizado para ${clienteId}: ${hitoFinal.amount}€ → ${cobroFinal}€`)
        }
    }
}

// Formatea un venue para mostrar en UI: "PROV — VENUE" solo si tienen IDs distintos.
// Ocurre cuando un proveedor tiene más de un venue (AMAYA_SABATE_1, AMAYA_SABATE_2…).
// En el 95%+ de casos venueId === venueProviderId y se muestra solo venueId.
export function formatVenueLabel(venueId, venueProviderId) {
    if (!venueProviderId || venueId === venueProviderId) return venueId
    return `${venueProviderId} — ${venueId}`
}

// Recalcula y persiste en Supabase el pago final de un proveedor
// Llama siempre que cambie cualquier reserva o servicio del proveedor
export async function persistirPagosProveedor(supabase, proveedorId, todasReservas, todaDisponibilidad) {
    // Buscar los venues del proveedor para agregar disponibilidad y reservas de todos ellos
    const { data: venuesProv } = await supabase.from('venues').select('id').eq('provider_id', proveedorId)
    const venueIds = new Set((venuesProv ?? []).map(v => v.id))

    const { data: payments, error: errSelect } = await supabase
        .from('payments').select('*').eq('provider_id', proveedorId).eq('season', getTemporadaActiva())
    if (errSelect) { console.error('persistirPagosProveedor: error leyendo payments:', errSelect); return }

    const { cuantiaCorrecta: pagoFinal, hitoFinal } = calcularSaldoPago(venueIds, todasReservas, todaDisponibilidad, payments ?? [])

    if (!hitoFinal && pagoFinal < 0.01) return

    if (!hitoFinal) {
        const { error } = await supabase.from('payments').insert({
            provider_id: proveedorId, amount: pagoFinal,
            due_date: fechaPagoDefault(), paid: false, comments: 'Pago final', is_final: true,
            season: getTemporadaActiva()
        })
        if (error) { console.error('persistirPagosProveedor: error creando pago final:', error); return }
        console.log(`💸 Pago final creado para ${proveedorId}: ${pagoFinal}€`)
    } else if (Math.abs(parseFloat(hitoFinal.amount) - pagoFinal) >= 0.01) {
        if (hitoFinal.paid) {
            // El hito ya fue pagado — no se puede editar su importe sin perder el historial.
            // Se degrada a prepago histórico y se crea un nuevo hito con el saldo pendiente.
            const nuevoSaldo = pagoFinal - parseFloat(hitoFinal.amount)
            if (nuevoSaldo < -0.01) {
                const { overlay, panel } = crearModal('aviso-pago-negativo')
                panel.innerHTML = `
                    <div>
                        <div class="modal-header-title">⚠️ Pago final negativo</div>
                        <div class="modal-header-desc">El saldo pendiente con <strong>${proveedorId}</strong> ha resultado <strong>${fmt(nuevoSaldo)}</strong>.<br><br>
                        El proveedor ya recibió más de lo que le corresponde. Revisa los pagos o reclama el exceso.</div>
                    </div>
                    <div class="modal-actions">
                        <button id="btn-pago-neg-ok" class="btn btn-primary" autofocus>Entendido</button>
                    </div>`
                panel.querySelector('#btn-pago-neg-ok').onclick = () => overlay.close()
            }
            const { error: e1 } = await supabase.from('payments')
                .update({ is_final: false }).eq('id', hitoFinal.id)
            if (e1) { console.error('persistirPagosProveedor: error degradando hito pagado:', e1); return }
            if (Math.abs(nuevoSaldo) >= 0.01) {
                const { error: e2 } = await supabase.from('payments').insert({
                    provider_id: proveedorId, amount: nuevoSaldo,
                    due_date: fechaPagoDefault(), paid: false, paid_date: null,
                    comments: 'Pago final', is_final: true,
                    season: getTemporadaActiva()
                })
                if (e2) { console.error('persistirPagosProveedor: error creando nuevo pago final:', e2); return }
                console.log(`💸 Pago final recalculado para ${proveedorId}: ${fmt(hitoFinal.amount)} (pagado) → saldo pendiente ${fmt(nuevoSaldo)}`)
            } else {
                console.log(`💸 Pago final para ${proveedorId} saldado exactamente (${fmt(hitoFinal.amount)} pagado)`)
            }
        } else {
            const { error } = await supabase.from('payments')
                .update({ amount: pagoFinal }).eq('id', hitoFinal.id)
            if (error) { console.error('persistirPagosProveedor: error actualizando pago final:', error); return }
            console.log(`💸 Pago final actualizado para ${proveedorId}: ${fmt(hitoFinal.amount)} → ${fmt(pagoFinal)}`)
        }
    }
}

// Resuelve si los datos de contacto de una solicitud corresponden a un cliente existente.
// Prioridad: 1) email exacto, 2) teléfono exacto (normaliza prefijo +34), 3) nombre similar (ambiguo).
export function resolverCliente(datos, todosClientes) {
    const email = (datos.email || '').trim().toLowerCase()
    const tel   = (datos.telefono || '').replace(/\D/g, '')

    if (email) {
        const c = todosClientes.find(c => c.email && c.email.trim().toLowerCase() === email)
        if (c) return { match: 'exacto', cliente: c }
    }

    if (tel && tel.length >= 9) {
        const c = todosClientes.find(c => {
            const ct = (c.phone || '').replace(/\D/g, '')
            return ct && (ct === tel || ct === '34' + tel || tel === '34' + ct)
        })
        if (c) return { match: 'exacto', cliente: c }
    }

    const normNom = s => (s || '').toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Z0-9 ]/g, '').trim().replace(/\s+/g, ' ')

    const dNom = normNom(datos.nombre)
    if (dNom) {
        const c = todosClientes.find(c => {
            const cn = normNom(c.name) || normNom(c.id.replace(/_/g, ' '))
            if (!cn) return false
            if (dNom === cn) return true
            if (dNom.length < 5 || cn.length < 5) return false
            return dNom.includes(cn) || cn.includes(dNom)
        })
        if (c) return { match: 'ambiguo', cliente: c }
    }

    return { match: 'ninguno', cliente: null }
}

export function buildCatalogUrl(slug, eventType) {
    if (!slug || !eventType) return null
    return `https://www.experienciasanfermin.com/catalogo/balcon.html?v=${slug}&et=${eventType}`
}

// Abre un modal para renombrar el ID de un registro (clients, providers, venues, services).
// Las FKs con ON UPDATE CASCADE propagan el cambio automáticamente en Supabase.
export async function abrirRenombrarId({ tabla, idActual, supabase, onSuccess }) {
    const { overlay, panel } = crearModal(`modal-renombrar-${tabla}`, { narrow: true })
    panel.innerHTML = `
        <h3 class="modal-title">Editar ID</h3>
        <p style="font-size:13px;color:var(--subtle);margin:8px 0 14px">
            Renombrar <strong>${idActual}</strong>.<br>Todas las referencias se actualizan automáticamente.
        </p>
        <div class="form-field">
            <label>Nuevo ID</label>
            <input type="text" id="inputNuevoId" value="${idActual}" autocomplete="off"
                   style="font-family:monospace;text-transform:uppercase">
        </div>
        <p id="renombrar-error" style="color:var(--accent);font-size:12px;min-height:18px;margin-top:6px"></p>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
            <button class="btn btn-secondary" id="btnRenCancelar">Cancelar</button>
            <button class="btn btn-primary"   id="btnRenAceptar">Aceptar</button>
        </div>
    `
    const input = panel.querySelector('#inputNuevoId')
    const error = panel.querySelector('#renombrar-error')
    const btnOk = panel.querySelector('#btnRenAceptar')

    input.addEventListener('keydown', e => {
        if (e.key === ' ') {
            e.preventDefault()
            const pos = input.selectionStart
            input.value = input.value.slice(0, pos) + '_' + input.value.slice(pos)
            input.setSelectionRange(pos + 1, pos + 1)
        }
    })
    input.addEventListener('input', () => { input.value = normalizarId(input.value) })

    panel.querySelector('#btnRenCancelar').addEventListener('click', () => overlay.close())

    btnOk.addEventListener('click', async () => {
        const nuevoId = normalizarId(input.value)
        error.textContent = ''
        if (!nuevoId)           { error.textContent = 'El ID no puede estar vacío.'; return }
        if (nuevoId === idActual) { overlay.close(); return }
        const { data: existe } = await supabase.from(tabla).select('id').eq('id', nuevoId).maybeSingle()
        if (existe) { error.textContent = `Ya existe un registro con ID "${nuevoId}".`; return }
        btnOk.disabled = true
        btnOk.textContent = 'Guardando…'
        const { error: err } = await supabase.from(tabla).update({ id: nuevoId }).eq('id', idActual)
        if (err) {
            error.textContent = `Error: ${err.message}`
            btnOk.disabled = false
            btnOk.textContent = 'Aceptar'
            return
        }
        overlay.close()
        onSuccess(nuevoId)
    })

    setTimeout(() => input.select(), 50)
}

// Renderiza botones de acción de envío en un contenedor DOM.
//
// tipo: 'texto' (default) — para mensajes sin adjunto (asistente).
//   Botones: Copiar al portapapeles · Enviar por correo · Enviar por WhatsApp.
//
// tipo: 'pdf' — para documentos con PDF adjunto (propuesta, factura).
//   Botones: Solo generar PDF · Generar PDF y preparar correo · Generar PDF y enviar por WhatsApp.
//   onGenerar: async () => void — genera y descarga el PDF antes de abrir el canal.
//   Mientras onGenerar corre, todos los botones se deshabilitan con "⏳ Generando…".
//
// El botón con btn-primary (foco visual) es: WhatsApp si hay teléfono,
// Email si hay email, o la opción base (Solo PDF / Copiar) si no hay contacto.
// getTexto: () => string — se llama en el momento del clic, no en el render.
// onUsado: callback opcional (para tipo='texto' recibe el texto; para 'pdf' sin argumento).
export function mostrarOpcionesEnvio({ tipo = 'texto', email, telefono, asunto, getTexto, onGenerar, container, onUsado }) {
    container.innerHTML = ''
    container.style.display  = 'flex'
    container.style.gap      = '8px'
    container.style.flexWrap = 'wrap'

    const primaryRole = telefono ? 'wa' : email ? 'email' : 'default'
    const cls = role => `btn ${primaryRole === role ? 'btn-primary' : 'btn-secondary'}`

    if (tipo === 'pdf') {
        const allBtns = []

        async function handlePdf(btn, openChannel) {
            const orig = btn.textContent
            allBtns.forEach(b => { b.disabled = true })
            btn.textContent = '⏳ Generando…'
            try {
                await onGenerar()
                openChannel()
                onUsado?.()
            } catch (e) {
                console.error('[mostrarOpcionesEnvio] onGenerar error:', e)
            } finally {
                allBtns.forEach(b => { b.disabled = false })
                btn.textContent = orig
            }
        }

        const btnPdf = document.createElement('button')
        btnPdf.className = cls('default')
        btnPdf.style.minHeight = '44px'
        btnPdf.textContent = '⬇ Solo generar PDF'
        btnPdf.addEventListener('click', () => handlePdf(btnPdf, () => {}))
        allBtns.push(btnPdf)
        container.appendChild(btnPdf)

        if (email) {
            const btnEmail = document.createElement('button')
            btnEmail.className = cls('email')
            btnEmail.style.minHeight = '44px'
            btnEmail.textContent = '⬇ Generar PDF y preparar correo'
            btnEmail.addEventListener('click', () => handlePdf(btnEmail, () => {
                const texto = getTexto()
                const qs = [
                    asunto && `subject=${encodeURIComponent(asunto)}`,
                    `body=${encodeURIComponent(texto)}`
                ].filter(Boolean).join('&')
                window.open(`mailto:${email}?${qs}`, '_blank')
            }))
            allBtns.push(btnEmail)
            container.appendChild(btnEmail)
        }

        if (telefono) {
            const digits = telefono.replace(/\D/g, '')
            const intl   = digits.length <= 9 ? '34' + digits : digits
            const btnWA  = document.createElement('button')
            btnWA.className = cls('wa')
            btnWA.style.minHeight = '44px'
            btnWA.textContent = '⬇ Generar PDF y enviar por WhatsApp'
            btnWA.addEventListener('click', () => handlePdf(btnWA, () => {
                const texto = getTexto()
                window.open(`https://wa.me/${intl}?text=${encodeURIComponent(texto)}`, '_blank')
            }))
            allBtns.push(btnWA)
            container.appendChild(btnWA)
        }

    } else {
        const btnCopiar = document.createElement('button')
        btnCopiar.className = cls('default')
        btnCopiar.style.minHeight = '44px'
        btnCopiar.textContent = '📋 Copiar al portapapeles'
        btnCopiar.addEventListener('click', async () => {
            const texto = getTexto()
            try {
                await navigator.clipboard.writeText(texto)
                mostrarToast('📋 Copiado al portapapeles')
            } catch {
                mostrarToast('❌ No se pudo copiar', '#991b1b')
            }
            onUsado?.(texto)
        })
        container.appendChild(btnCopiar)

        if (email) {
            const btnEmail = document.createElement('button')
            btnEmail.className = cls('email')
            btnEmail.style.minHeight = '44px'
            btnEmail.textContent = '📧 Enviar por correo'
            btnEmail.addEventListener('click', () => {
                const texto = getTexto()
                const qs = [
                    asunto && `subject=${encodeURIComponent(asunto)}`,
                    `body=${encodeURIComponent(texto)}`
                ].filter(Boolean).join('&')
                window.open(`mailto:${email}?${qs}`, '_blank')
                onUsado?.(texto)
            })
            container.appendChild(btnEmail)
        }

        if (telefono) {
            const digits = telefono.replace(/\D/g, '')
            const intl   = digits.length <= 9 ? '34' + digits : digits
            const btnWA  = document.createElement('button')
            btnWA.className = cls('wa')
            btnWA.style.minHeight = '44px'
            btnWA.textContent = '💬 Enviar por WhatsApp'
            btnWA.addEventListener('click', () => {
                const texto = getTexto()
                window.open(`https://wa.me/${intl}?text=${encodeURIComponent(texto)}`, '_blank')
                onUsado?.(texto)
            })
            container.appendChild(btnWA)
        }
    }
}

// ===== INFERENCIA DE TIPO DE SERVICIO =====

// Mapeo fijo tipo → service_code (texto). Encierro no está: depende del día.
// Para obtener el integer id usa serviceCodesToIds([TIPO_SERVICIO_ID[tipo]], disponibilidad).
export const TIPO_SERVICIO_ID = {
    chupinazo:   'CHUPINAZO_6',
    procesion:   'PROCESION_7',
    gigantes:    'DESPEDIDA_GIGANTES_14',
    pobre_de_mi: 'POBRE_DE_MI'
}

// Convierte un array de service_codes (ej. ['ENCIERRO_7', 'CHUPINAZO_6']) al array
// de integer ids correspondiente, usando los campos service_code/service_id del array
// de rows de availability_panel (o cualquier array con esos dos campos).
// Elimina duplicados y nulls.
export function serviceCodesToIds(codes, disponibilidad) {
    if (!codes?.length || !disponibilidad?.length) return []
    const codeToId = new Map(disponibilidad.map(d => [d.service_code, d.service_id]))
    return [...new Set(codes.map(c => codeToId.get(c)).filter(id => id != null))]
}

// Normaliza un slug/level/sfcom_service_name a { tipo, day } o null.
// day: número extraído del slug si figura (ej. 'encierro-8' → 8), o null si no.
export function parsearNivel(level) {
    if (!level) return null
    const partes = level.toLowerCase().split('-')
    if (partes.includes('encierro'))  return { tipo: 'encierro',    day: _diaDesdePartes(partes) }
    if (partes.includes('chupinazo')) return { tipo: 'chupinazo',   day: 6 }
    if (partes.includes('procesion')) return { tipo: 'procesion',   day: 7 }
    if (partes.includes('gigantes'))  return { tipo: 'gigantes',    day: 14 }
    if (partes.includes('pobre'))     return { tipo: 'pobre_de_mi', day: null }
    return null
}

function _diaDesdePartes(partes) {
    const n = partes.map(p => parseInt(p)).find(n => !isNaN(n) && n >= 6 && n <= 14)
    return n ?? null
}

// Extrae el qualifier de lead (vivir/ver/entender) del slug del formulario web.
// Devuelve 'vivir' | 'ver' | 'entender' | null.
export function extraerQualifier(slug) {
    if (!slug) return null
    const primera = slug.toLowerCase().split('-')[0]
    return ['vivir', 'ver', 'entender'].includes(primera) ? primera : null
}

// Construye un item vacío/parcial de proposal_draft con todos los campos presentes.
// Úsalo como único punto de creación de items para garantizar estructura consistente.
export function construirItemBorrador({
    service_name        = null,
    service_id          = null,
    venue_id            = null,
    venue_display_name  = null,
    day                 = null,
    slots               = null,
    price               = null,
    catalogo_url        = null
} = {}) {
    return { service_name, service_id, venue_id, venue_display_name, day, slots, price, catalogo_url, estado: 'pendiente' }
}