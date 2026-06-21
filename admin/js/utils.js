import { crearModal } from './modal.js'
import { mostrarToast } from './verificacion.js'

// ===== UTILIDADES COMPARTIDAS DEL ADMIN =====

// Formatea un número como moneda EUR
export const fmt = n => parseFloat(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })

// Fecha por defecto para cobros al cliente: 6 de julio
// del anio en curso si estamos antes del 15 de julio, del siguiente si no
export function fechaCobroDefault() {
    const hoy  = new Date()
    const anio = hoy.getMonth() < 6 || (hoy.getMonth() === 6 && hoy.getDate() < 15)
        ? hoy.getFullYear()
        : hoy.getFullYear() + 1
    return `${anio}-07-06`
}

// Fecha por defecto para pagos al proveedor: 15 de julio (misma logica)
export function fechaPagoDefault() {
    const hoy  = new Date()
    const anio = hoy.getMonth() < 6 || (hoy.getMonth() === 6 && hoy.getDate() < 15)
        ? hoy.getFullYear()
        : hoy.getFullYear() + 1
    return `${anio}-07-15`
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
            return `<span style="color:${color};white-space:nowrap">${id}(${slots})</span>`
        }).join(' ')
}

// Recalcula y persiste en Supabase el cobro final de un cliente
// Llama siempre que cambie cualquier reserva del cliente
export async function persistirCobrosCliente(supabase, clienteId, todasReservas) {
    const total = clienteId === 'SFCOM'
        ? todasReservas.filter(r => r.origin_ref?.startsWith('WEB') && r.status !== 'Cancelada')
                       .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)
        : todasReservas.filter(r => r.client_id === clienteId && r.status !== 'Cancelada')
                       .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)

    const { data: charges, error: errSelect } = await supabase
        .from('charges').select('*').eq('client_id', clienteId)
    if (errSelect) { console.error('persistirCobrosCliente: error leyendo charges:', errSelect); return }

    const hitoFinal  = (charges ?? []).find(c => c.is_final)
    const prepagos   = (charges ?? []).filter(c => !c.is_final).reduce((s, c) => s + parseFloat(c.amount), 0)
    const cobroFinal = total - prepagos

    if (!hitoFinal && cobroFinal < 0.01) return

    if (!hitoFinal) {
        const { error } = await supabase.from('charges').insert({
            client_id: clienteId, amount: cobroFinal, due_date: fechaCobroDefault(),
            collected: false, collected_date: null, comments: 'Cobro final', is_final: true
        })
        if (error) { console.error('persistirCobrosCliente: error creando cobro final:', error); return }
        console.log(`💰 Cobro final creado para ${clienteId}: ${cobroFinal}€`)
    } else if (Math.abs(parseFloat(hitoFinal.amount) - cobroFinal) >= 0.01) {
        if (hitoFinal.invoice_number) {
            const diferencia = cobroFinal - parseFloat(hitoFinal.amount)
            const { error: e1 } = await supabase.from('charges')
                .update({ is_final: false }).eq('id', hitoFinal.id)
            if (e1) { console.error('persistirCobrosCliente: error degradando hito facturado:', e1); return }
            const { error: e2 } = await supabase.from('charges').insert({
                client_id: clienteId, amount: diferencia, due_date: fechaCobroDefault(),
                collected: false, collected_date: null,
                comments: 'Ajuste s/ factura ' + hitoFinal.invoice_number, is_final: true
            })
            if (e2) { console.error('persistirCobrosCliente: error creando ajuste:', e2); return }
            alert(`⚠️ El cobro final de ${clienteId} ya estaba facturado (${hitoFinal.invoice_number}).\n\nSe ha creado un hito de ajuste por ${diferencia > 0 ? '+' : ''}${diferencia}€ que queda pendiente de cobro.`)
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

    const dispProv  = todaDisponibilidad.filter(d => venueIds.has(d.venue_id))
    const costTotal = dispProv.reduce((total, d) => {
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

    const { data: payments, error: errSelect } = await supabase
        .from('payments').select('*').eq('provider_id', proveedorId)
    if (errSelect) { console.error('persistirPagosProveedor: error leyendo payments:', errSelect); return }

    const prepagos  = (payments ?? []).filter(p => p.comments !== 'Pago final')
        .reduce((s, p) => s + parseFloat(p.amount), 0)
    const pagoFinal = costTotal - prepagos
    const hitoFinal = (payments ?? []).find(p => p.comments === 'Pago final')

    if (!hitoFinal) {
        const { error } = await supabase.from('payments').insert({
            provider_id: proveedorId, amount: pagoFinal,
            due_date: fechaPagoDefault(), paid: false, comments: 'Pago final'
        })
        if (error) { console.error('persistirPagosProveedor: error creando pago final:', error); return }
        console.log(`💸 Pago final creado para ${proveedorId}: ${pagoFinal}€`)
    } else if (Math.abs(parseFloat(hitoFinal.amount) - pagoFinal) >= 0.01) {
        const { error } = await supabase.from('payments')
            .update({ amount: pagoFinal }).eq('id', hitoFinal.id)
        if (error) { console.error('persistirPagosProveedor: error actualizando pago final:', error); return }
        console.log(`💸 Pago final actualizado para ${proveedorId}: ${hitoFinal.amount}€ → ${pagoFinal}€`)
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