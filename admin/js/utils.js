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