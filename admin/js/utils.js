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
    const total = todasReservas
        .filter(r => r.client_id === clienteId && r.status !== 'Cancelada')
        .reduce((s, r) => s + parseFloat(r.total_amount || 0), 0)

    const { data: charges, error: errSelect } = await supabase
        .from('charges').select('*').eq('client_id', clienteId)
    if (errSelect) { console.error('persistirCobrosCliente: error leyendo charges:', errSelect); return }

    const hitoFinal  = (charges ?? []).find(c => c.is_final)
    const prepagos   = (charges ?? []).filter(c => !c.is_final).reduce((s, c) => s + parseFloat(c.amount), 0)
    const cobroFinal = total - prepagos

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

// Recalcula y persiste en Supabase el pago final de un proveedor
// Llama siempre que cambie cualquier reserva o servicio del proveedor
export async function persistirPagosProveedor(supabase, proveedorId, todasReservas, todaDisponibilidad) {
    const dispProv  = todaDisponibilidad.filter(d => d.provider_id === proveedorId)
    const costTotal = dispProv.reduce((total, d) => {
        if (d.billing_model === 'capacity') {
            return total + (d.total_slots ?? 0) * parseFloat(d.price_per_slot ?? 0)
        } else if (d.billing_model === 'fixed') {
            const tieneReserva = todasReservas.some(r =>
                r.provider_id === proveedorId &&
                r.service_id  === d.service_id &&
                r.status      !== 'Cancelada'
            )
            return total + (tieneReserva ? parseFloat(d.price_per_slot ?? 0) : 0)
        } else {
            const plazasRes = todasReservas
                .filter(r => r.provider_id === proveedorId &&
                             r.service_id  === d.service_id &&
                             r.status      !== 'Cancelada')
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