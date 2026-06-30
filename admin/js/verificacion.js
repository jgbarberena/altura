// verificacion.js
// Verificación unificada: integridad de BD, coherencia financiera y stock sfcom.
// Punto de entrada único: ejecutarVerificacion(supabase, opts).

import { syncStockToSfcom, verificarSfcom, verificarConfirmarSfcom } from './sfcom.js'
import { crearModal } from './modal.js'

// No importamos de utils.js — crearía dependencia circular (utils.js importa mostrarToast de aquí)
const _fmt = n => parseFloat(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })

// ─── Toast genérico ──────────────────────────────────────────────────────────

export function mostrarToast(mensaje, color = '#166534') {
    const prev = document.getElementById('toast-verificacion')
    if (prev) prev.remove()

    const toast = document.createElement('div')
    toast.id = 'toast-verificacion'
    toast.style.cssText = [
        'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
        `background:${color}`, 'color:#fff', 'border-radius:8px', 'padding:10px 22px',
        'font-size:14px', 'font-family:system-ui,sans-serif', 'font-weight:500',
        'box-shadow:0 4px 20px rgba(0,0,0,0.2)', 'z-index:9999',
        'transition:opacity 0.6s ease', 'opacity:1', 'white-space:nowrap',
        'pointer-events:none'
    ].join(';')
    toast.textContent = mensaje
    document.body.appendChild(toast)
    setTimeout(() => { toast.style.opacity = '0' }, 3500)
    setTimeout(() => { toast.remove() }, 4200)
    return toast
}

// ─── Carga de datos ───────────────────────────────────────────────────────────

async function _cargarDatos(supabase, season) {
    const [
        { data: allReservas,  error: eRes },
        { data: availability, error: eAvail },
        { data: clients,      error: eClients },
        { data: venues,       error: eVenues },
        { data: services,     error: eServices },
        { data: providers,    error: eProv },
        { data: solicitudes,  error: eSol },
        { data: charges,      error: eCharges },
        { data: payments,     error: ePayments }
    ] = await Promise.all([
        supabase.from('reservations').select('id, client_id, venue_id, service_id, status, slots, origin_ref, total_amount'),
        supabase.from('availability_with_sfcom').select('id, venue_id, service_id, service_code, total_slots, billing_model, price_per_slot, sfcom_status, sfcom_product_id, sfcom_variation_id, sfcom_slots_listed, sfcom_service_name').eq('season', season),
        supabase.from('clients').select('id, name'),
        supabase.from('venues').select('id, provider_id'),
        supabase.from('services').select('id'),
        supabase.from('providers').select('id'),
        supabase.from('reservation_requests').select('id, source, client_name, proposal_draft').eq('status', 'nueva'),
        supabase.from('charges').select('*').eq('season', season),
        supabase.from('payments').select('*').eq('season', season)
    ])
    // Reservas de la temporada activa (inferidas por service_id, que ya están filtrados por availability)
    const _svcIds = new Set((availability ?? []).map(a => a.service_id))
    const reservas = (allReservas ?? []).filter(r => _svcIds.has(r.service_id))
    return {
        reservas,
        availability: availability ?? [],
        clients:      clients      ?? [],
        venues:       venues       ?? [],
        services:     services     ?? [],
        providers:    providers    ?? [],
        solicitudes:  solicitudes  ?? [],
        charges:      charges      ?? [],
        payments:     payments     ?? [],
        error: eRes || eAvail || eClients || eVenues || eServices || eProv || eSol || eCharges || ePayments
    }
}

// ─── Integridad de BD ─────────────────────────────────────────────────────────
// errores     → críticos, abren modal incluso en auto
// avisos      → informativos, solo en modoManual
// advertencias → inconsistencias leves, solo en modoManual

function _verificarBD(dados) {
    const { reservas, availability, clients, venues, services, providers, solicitudes, charges, payments } = dados

    const errores      = []
    const avisos       = []
    const advertencias = []

    const clienteIds  = new Set(clients.map(c => c.id))
    const venueIds    = new Set(venues.map(v => v.id))
    const servicioIds = new Set(services.map(s => s.id))
    const providerIds = new Set(providers.map(p => p.id))
    const availKeys   = new Set(availability.map(a => `${a.venue_id}|${a.service_id}`))

    // FK y validaciones de reservas
    for (const r of reservas) {
        if (!clienteIds.has(r.client_id))
            errores.push(`Reserva ${r.id}: cliente "${r.client_id}" no existe en la BD`)
        if (!venueIds.has(r.venue_id))
            errores.push(`Reserva ${r.id}: venue "${r.venue_id}" no existe en la BD`)
        if (!servicioIds.has(r.service_id))
            errores.push(`Reserva ${r.id}: servicio "${r.service_id}" no existe en la BD`)
        if (r.status !== 'Cancelada' && !availKeys.has(`${r.venue_id}|${r.service_id}`))
            errores.push(`Reserva ${r.id}: sin fila availability para ${r.venue_id} / ${r.service_id}`)
        if ((r.slots ?? 0) <= 0)
            errores.push(`Reserva ${r.id}: plazas inválidas (${r.slots ?? 0})`)
    }

    // FK de cobros y pagos
    for (const c of charges) {
        if (c.client_id !== 'SFCOM' && !clienteIds.has(c.client_id))
            errores.push(`Cobro huérfano: cliente "${c.client_id}" no existe en la BD`)
    }
    for (const p of payments) {
        if (!providerIds.has(p.provider_id))
            errores.push(`Pago huérfano: proveedor "${p.provider_id}" no existe en la BD`)
    }

    // Sobrereserva por par venue/servicio
    for (const avail of availability) {
        const plazas = reservas
            .filter(r => r.venue_id === avail.venue_id && r.service_id === avail.service_id && r.status !== 'Cancelada')
            .reduce((s, r) => s + (r.slots ?? 0), 0)
        if (plazas > avail.total_slots)
            errores.push(`Sobrereserva: ${avail.venue_id} / ${avail.service_code ?? avail.service_id} — ${plazas} plazas sobre ${avail.total_slots} contratadas`)
    }

    // Variation_id duplicado en sfcom (dos pares con el mismo producto+variación)
    const _varPorProducto = new Map()
    for (const avail of availability) {
        if (!avail.sfcom_product_id || !avail.sfcom_variation_id) continue
        const pid = String(avail.sfcom_product_id)
        if (!_varPorProducto.has(pid)) _varPorProducto.set(pid, new Map())
        const varMap = _varPorProducto.get(pid)
        const vid    = String(avail.sfcom_variation_id)
        if (varMap.has(vid)) {
            const otro = varMap.get(vid)
            errores.push(
                `ID de variación duplicado: variation_id ${avail.sfcom_variation_id} ` +
                `asignado a ${avail.service_id} (${avail.venue_id}) ` +
                `y también a ${otro.service_id} (${otro.venue_id})`
            )
        } else {
            varMap.set(vid, { venue_id: avail.venue_id, service_id: avail.service_id })
        }
    }

    // Múltiples hitos finales por cliente
    const finalesPorCliente = new Map()
    for (const c of charges) {
        if (c.is_final) finalesPorCliente.set(c.client_id, (finalesPorCliente.get(c.client_id) ?? 0) + 1)
    }
    for (const [id, count] of finalesPorCliente) {
        if (count > 1)
            errores.push(`Cliente "${id}": ${count} cobros marcados como hito final (solo puede haber uno)`)
    }

    // Consistencia de fechas y estados (advertencias, modoManual)
    for (const c of charges) {
        if (c.collected && !c.collected_date)
            advertencias.push(`Cobro de "${c.client_id}": cobrado pero sin fecha de cobro`)
        else if (!c.collected && c.collected_date)
            advertencias.push(`Cobro de "${c.client_id}": tiene fecha de cobro pero no marcado como cobrado`)
        if (c.invoiced && !c.invoice_number)
            advertencias.push(`Cobro de "${c.client_id}": marcado como facturado pero sin número de factura`)
        else if (!c.invoiced && c.invoice_number)
            advertencias.push(`Cobro de "${c.client_id}": tiene factura ${c.invoice_number} pero no marcado como facturado`)
    }
    for (const p of payments) {
        if (p.paid && !p.paid_date)
            advertencias.push(`Pago a "${p.provider_id}": pagado pero sin fecha de pago`)
        else if (!p.paid && p.paid_date)
            advertencias.push(`Pago a "${p.provider_id}": tiene fecha de pago pero no marcado como pagado`)
    }

    // Solicitudes pendientes (avisos informativos, modoManual)
    const sfcomPend = solicitudes.filter(s => s.source && /^WEB\d+_\d+$/.test(s.source))
    const webPend   = solicitudes.filter(s => !s.source || !/^WEB\d+_\d+$/.test(s.source))
    if (sfcomPend.length > 0) avisos.push(`${sfcomPend.length} solicitud(es) de sfcom sin atender`)
    if (webPend.length > 0)   avisos.push(`${webPend.length} solicitud(es) web sin atender`)

    return { errores, avisos, advertencias }
}

// ─── Consistencia financiera ──────────────────────────────────────────────────
// problemasClientes/Proveedores → críticos si presentes, abren modal en auto
// advertencias → registros a cero, solo en modoManual

function _computarFinanciero(dados) {
    const { charges, reservas, payments, availability, venues } = dados
    const advertencias = []

    for (const c of charges) {
        if (Math.abs(parseFloat(c.amount || 0)) < 0.01) {
            // El cobro final a cero es el flujo normal para clientes que solo tienen reservas sfcom:
            // persistirCobrosCliente crea un is_final=0 porque el balance ya está cubierto por
            // los cargos "Cobrado vía sfcom". No avisar en ese caso.
            const esSfcomNormal = c.is_final && charges.some(x => x.client_id === c.client_id && x.comments?.includes('Cobrado vía sfcom'))
            if (!esSfcomNormal)
                advertencias.push(`Cobro a cero: cliente "${c.client_id}" — importe ${_fmt(c.amount)}`)
        }
    }
    for (const p of payments) {
        if (Math.abs(parseFloat(p.amount || 0)) < 0.01)
            advertencias.push(`Pago a cero: proveedor "${p.provider_id}" — importe ${_fmt(p.amount)}`)
    }

    const chargesTotales   = new Map()
    const chargesHistorial = new Map()
    for (const c of charges) {
        chargesTotales.set(c.client_id, (chargesTotales.get(c.client_id) ?? 0) + parseFloat(c.amount || 0))
        if (c.collected || c.invoice_number) chargesHistorial.set(c.client_id, true)
    }

    const reservasTotales = new Map()
    let sfcomReservasTotal = 0
    for (const r of reservas) {
        if (r.status === 'Cancelada') continue
        reservasTotales.set(r.client_id, (reservasTotales.get(r.client_id) ?? 0) + parseFloat(r.total_amount || 0))
        if (r.origin_ref?.startsWith('WEB'))
            sfcomReservasTotal += parseFloat(r.total_amount || 0)
    }

    const problemasClientes = []
    for (const id of new Set([...chargesTotales.keys(), ...reservasTotales.keys()])) {
        if (id === 'SFCOM') continue
        const c = Math.round((chargesTotales.get(id) ?? 0) * 100) / 100
        const r = Math.round((reservasTotales.get(id) ?? 0) * 100) / 100
        if (Math.abs(c - r) < 0.01) continue
        problemasClientes.push({
            id, enBD: c, deberiasSer: r,
            diff: Math.round((c - r) * 100) / 100,
            esHuerfano: r === 0 && c > 0,
            tieneHistorial: chargesHistorial.get(id) ?? false
        })
    }

    // Verificación SFCOM separada: cobros SFCOM vs total reservas de origen WEB
    const sfcomC = Math.round((chargesTotales.get('SFCOM') ?? 0) * 100) / 100
    const sfcomR = Math.round(sfcomReservasTotal * 100) / 100
    if (Math.abs(sfcomC - sfcomR) >= 0.01) {
        problemasClientes.push({
            id: 'SFCOM', enBD: sfcomC, deberiasSer: sfcomR,
            diff: Math.round((sfcomC - sfcomR) * 100) / 100,
            esHuerfano: sfcomR === 0 && sfcomC > 0,
            tieneHistorial: chargesHistorial.get('SFCOM') ?? false
        })
    }

    const venueAProveedor = new Map(venues.map(v => [v.id, v.provider_id]))
    const pagosTotales    = new Map()
    for (const p of payments)
        pagosTotales.set(p.provider_id, (pagosTotales.get(p.provider_id) ?? 0) + parseFloat(p.amount || 0))

    const costeTeorico = new Map()
    for (const d of availability) {
        const provId = venueAProveedor.get(d.venue_id)
        if (!provId) continue
        let coste = 0
        if (d.billing_model === 'capacity') {
            coste = (d.total_slots ?? 0) * parseFloat(d.price_per_slot ?? 0)
        } else if (d.billing_model === 'fixed') {
            const tieneRes = reservas.some(r => r.venue_id === d.venue_id && r.service_id === d.service_id && r.status !== 'Cancelada')
            coste = tieneRes ? parseFloat(d.price_per_slot ?? 0) : 0
        } else {
            const slots = reservas
                .filter(r => r.venue_id === d.venue_id && r.service_id === d.service_id && r.status !== 'Cancelada')
                .reduce((s, r) => s + r.slots, 0)
            coste = slots * parseFloat(d.price_per_slot ?? 0)
        }
        costeTeorico.set(provId, (costeTeorico.get(provId) ?? 0) + coste)
    }

    const problemasProveedores = []
    for (const id of new Set([...pagosTotales.keys(), ...costeTeorico.keys()])) {
        const p = Math.round((pagosTotales.get(id) ?? 0) * 100) / 100
        const t = Math.round((costeTeorico.get(id) ?? 0) * 100) / 100
        if (Math.abs(p - t) < 0.01) continue
        problemasProveedores.push({ id, enBD: p, deberiasSer: t, diff: Math.round((p - t) * 100) / 100 })
    }

    return { problemasClientes, problemasProveedores, advertencias }
}

// ─── Modal pre-corrección de idsMismatch ─────────────────────────────────────

function _mostrarModalPreCorreccion(mismatches) {
    return new Promise(resolve => {
        const prev = document.getElementById('modal-pre-correccion')
        if (prev) prev.remove()

        const lista = mismatches.map(m => `
            <div style="font-size:12px;color:#374151;padding:4px 0;border-bottom:1px solid #fecaca">
                <strong>${m.servicio}</strong>
                <span style="color:#6b7280"> · ${m.venueId} · ${m.serviceId}</span><br>
                Variación guardada: <span style="color:#991b1b">${m.storedVariationId} (día ${m.dayStored})</span>
                → esperado: día ${m.dayExpected}
            </div>`
        ).join('')

        const { overlay, panel } = crearModal('modal-pre-correccion')
        panel.innerHTML = `
            <div class="modal-header">
                <span class="modal-header-icon">⚠️</span>
                <div>
                    <div class="modal-header-title" style="color:#991b1b">IDs de variación incorrectos</div>
                    <div class="modal-header-desc">
                        Se ${mismatches.length === 1 ? 'ha detectado' : 'han detectado'}
                        ${mismatches.length} par${mismatches.length !== 1 ? 'es' : ''} con
                        una variación de sfcom asignada incorrectamente.
                        ¿Deseas corregirlos antes de ver los resultados?
                    </div>
                </div>
            </div>
            <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;
                        padding:10px 12px;display:flex;flex-direction:column;gap:4px">${lista}</div>
            <div style="font-size:12px;color:#6b7280;background:#f9fafb;border-radius:6px;padding:8px 10px;line-height:1.5">
                Si corriges, el sistema busca el producto correcto en sfcom por nombre y actualiza los IDs automáticamente.
                Si continúas sin corregir, la comparación de stock de esos pares se omitirá.
            </div>
            <div class="modal-actions">
                <button id="btn-precorr-continuar" class="btn btn-secondary">Continuar sin corregir</button>
                <button id="btn-precorr-corregir" class="btn btn-danger">🔧 Corregir y reverificar</button>
            </div>`

        panel.querySelector('#btn-precorr-continuar').addEventListener('click', () => { overlay.remove(); resolve('continuar') })
        panel.querySelector('#btn-precorr-corregir').addEventListener('click',  () => { overlay.remove(); resolve('corregir')  })
    })
}

// ─── Modal de corrección financiera ──────────────────────────────────────────

async function _corregirFinanciero(supabase, financiero, dados, persistirCobros, persistirPagos) {
    const { problemasClientes, problemasProveedores } = financiero
    const { reservas, availability } = dados

    const manuales = []
    for (const p of problemasClientes) {
        if (p.esHuerfano && p.tieneHistorial) { manuales.push(p); continue }
        if (p.esHuerfano) {
            const { error } = await supabase.from('charges').delete().eq('client_id', p.id)
            if (error) console.error('Error eliminando charges de', p.id, error)
        } else if (persistirCobros) {
            await persistirCobros(supabase, p.id, reservas)
        }
    }
    for (const p of problemasProveedores) {
        if (persistirPagos) await persistirPagos(supabase, p.id, reservas, availability)
    }
    return manuales
}

// ─── Modal principal de resultados ───────────────────────────────────────────

function _mostrarModal(resultado, supabase, onReverify, { modoManual, persistirCobros, persistirPagos, dados }) {
    const prev = document.getElementById('modal-verificacion')
    if (prev) prev.remove()

    const { bd, financiero, sfcom } = resultado

    const discrepanciasReales     = (sfcom?.discrepancias ?? []).filter(d => !d.pendingExplains)
    const discrepanciasPendientes = (sfcom?.discrepancias ?? []).filter(d =>  d.pendingExplains)

    const tieneErroresBD       = (bd?.errores?.length ?? 0) > 0
    const tieneDiscrepancias   = discrepanciasReales.length > 0
    const tieneIdsMismatch     = (sfcom?.idsMismatch?.length ?? 0) > 0
    const tienePendientes      = discrepanciasPendientes.length > 0
    const tieneFallos          = (sfcom?.fallos?.length ?? 0) > 0
    const tieneProblemasF      = (financiero?.problemasClientes?.length ?? 0) > 0 || (financiero?.problemasProveedores?.length ?? 0) > 0
    const tieneAdvertenciasBD  = modoManual && (bd?.advertencias?.length ?? 0) > 0
    const tieneAvisosBD        = modoManual && (bd?.avisos?.length ?? 0) > 0
    const tieneAvisosSfcom     = modoManual && (sfcom?.avisos?.length ?? 0) > 0
    const tieneAdvFinanciero   = modoManual && (financiero?.advertencias?.length ?? 0) > 0

    const hayProblema = tieneErroresBD || tieneDiscrepancias || tieneIdsMismatch || tieneProblemasF

    // ── Helpers de tarjetas sfcom ─────────────────────────────────────────────
    function _gridPlazas(d, borderColor) {
        const totalLibre = d.total_slots - d.todasOcupadas
        const sfcomLibre = d.sfcom_slots_listed - d.sfcomVendidas
        const ownSlots   = (d.reservasPar ?? []).filter(r => !r.sfcomRef).reduce((s, r) => s + r.slots, 0)
        const sfcSlots   = (d.reservasPar ?? []).filter(r =>  r.sfcomRef).reduce((s, r) => s + r.slots, 0)
        return `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;
                        background:rgba(0,0,0,0.03);border-radius:6px;padding:8px 10px;font-size:12px">
                <div style="color:#6b7280;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding-bottom:2px">Proveedor</div>
                <div style="color:#6b7280;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding-bottom:2px">Sfcom</div>
                <div style="color:#374151">${d.total_slots} plazas contratadas</div>
                <div style="color:#374151">${d.sfcom_slots_listed} plazas listadas</div>
                <div style="color:#374151">${d.todasOcupadas} ocupadas
                    ${ownSlots && sfcSlots ? `<span style="color:#9ca3af">(${ownSlots} propias + ${sfcSlots} sfcom)</span>`
                    : sfcSlots ? `<span style="color:#9ca3af">(${sfcSlots} sfcom)</span>`
                    : ownSlots ? `<span style="color:#9ca3af">(${ownSlots} propias)</span>` : ''}</div>
                <div style="color:#374151">${d.sfcomVendidas} vendidas por sfcom</div>
                <div style="color:#374151;font-weight:500">${totalLibre} libres</div>
                <div style="color:#374151;font-weight:500">${sfcomLibre} cuota disponible</div>
            </div>`
    }

    function _secReservas(d, borderColor) {
        if (!(d.reservasPar?.length)) {
            return `<div style="border-top:1px solid ${borderColor};padding-top:6px;margin-top:2px;font-size:12px;color:#6b7280">Sin reservas activas</div>`
        }
        const filas = d.reservasPar.map(r => {
            const origen = r.sfcomRef
                ? `<span style="background:#dbeafe;color:#1d4ed8;border-radius:3px;padding:1px 5px;font-size:10px;white-space:nowrap">${r.sfcomRef}</span>`
                : `<span style="background:#f3f4f6;color:#6b7280;border-radius:3px;padding:1px 5px;font-size:10px">propia</span>`
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:12px;color:#374151">
                        <span>${r.id} · ${r.clientName} · ${r.slots} plaza${r.slots !== 1 ? 's' : ''}</span>
                        ${origen}
                    </div>`
        }).join('')
        return `<div style="border-top:1px solid ${borderColor};padding-top:8px;margin-top:2px">
                    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;font-weight:600;margin-bottom:4px">
                        Reservas activas (${d.todasOcupadas} plazas)
                    </div>
                    <div style="display:flex;flex-direction:column;gap:2px">${filas}</div>
                </div>`
    }

    // ── Construcción de secciones ─────────────────────────────────────────────
    let secciones = ''

    // BD — errores críticos
    if (!tieneErroresBD) {
        secciones += `
            <div style="display:flex;align-items:center;gap:10px;padding:12px;
                        background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0">
                <span style="font-size:18px">✅</span>
                <div style="font-size:13px;color:#166534">No se han detectado inconsistencias en reservas, plazas ni relaciones de datos.</div>
            </div>`
    } else {
        secciones += `
            <div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#991b1b;font-weight:700;margin-bottom:8px">
                    ❌ Errores de coherencia en Supabase
                </div>
                <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.9">
                    ${bd.errores.map(e => `<li>${e}</li>`).join('')}
                </ul>
            </div>`
    }

    // sfcom — idsMismatch
    if (tieneIdsMismatch) {
        const tarjetas = (sfcom.idsMismatch ?? []).map(m => `
            <div style="border:1px solid #fca5a5;border-radius:8px;padding:12px;background:#fef2f2;display:flex;flex-direction:column;gap:5px">
                <div>
                    <span style="font-size:13px;font-weight:600;color:#1f2937">${m.servicio}</span>
                    <span style="font-size:11px;color:#6b7280;margin-left:6px">${m.venueId} · ${m.serviceId}</span>
                </div>
                <div style="font-size:12px;color:#374151">
                    Variación guardada: <strong style="color:#991b1b">${m.storedVariationId} (${m.variacionNombre ?? '?'})</strong> — día ${m.dayStored}.
                    Esperado: día ${m.dayExpected}.
                </div>
                <div style="font-size:12px;color:#6b7280">
                    ${sfcom._sinBotonCorregir
                        ? '⚠️ Elegiste continuar sin corregir — la comparación de stock para este par se ha omitido.'
                        : 'Los PUTs de stock se han enviado a la variación incorrecta. La comparación de stock se ha omitido.'}
                </div>
            </div>`
        ).join('')
        secciones += `
            <div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#991b1b;font-weight:700;margin-bottom:8px">
                    ❌ IDs de variación incorrectos
                </div>
                <div style="display:flex;flex-direction:column;gap:8px">${tarjetas}</div>
            </div>`
    }

    // sfcom — discrepancias reales
    if (tieneDiscrepancias) {
        const cartas = discrepanciasReales.map(d => {
            const esGrave    = d.diferencia > 0
            const bgCard     = esGrave ? '#fff7ed' : '#fffbeb'
            const borderCard = esGrave ? '#fed7aa' : '#fde68a'
            const colorDir   = esGrave ? '#991b1b' : '#92400e'
            const bgBadge    = esGrave ? '#fee2e2' : '#fef3c7'
            const titulo     = d.variacionNombre ? `${d.servicio} — ${d.variacionNombre}` : d.servicio
            const limitante  = (d.total_slots - d.todasOcupadas) <= (d.sfcom_slots_listed - d.sfcomVendidas) ? 'capacidad' : 'cuota sfcom'
            return `
                <div style="border:1px solid ${borderCard};border-radius:8px;padding:14px;background:${bgCard};display:flex;flex-direction:column;gap:8px">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                        <div>
                            <div style="font-size:13px;font-weight:600;color:#1f2937">${titulo}</div>
                            <div style="font-size:11px;color:#6b7280;margin-top:1px">${d.venueId} · ${d.serviceId}</div>
                        </div>
                        <button class="btn-sync-par" data-venue="${d.venueId}" data-service="${d.serviceId}"
                            style="background:transparent;border:1px solid ${borderCard};border-radius:5px;
                                   padding:3px 10px;font-size:11px;cursor:pointer;color:${colorDir};white-space:nowrap;flex-shrink:0">
                            🔄 Sincronizar
                        </button>
                    </div>
                    <div style="font-size:12px;font-weight:600;color:${colorDir};background:${bgBadge};padding:4px 8px;border-radius:4px;display:inline-block">
                        ${esGrave ? '⚠️ Riesgo de sobreventa:' : 'ℹ️'} sfcom muestra
                        ${Math.abs(d.diferencia)} plaza${Math.abs(d.diferencia) !== 1 ? 's' : ''}
                        ${esGrave ? 'de MÁS' : 'de menos'} de las esperadas
                    </div>
                    ${_gridPlazas(d, borderCard)}
                    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;border-top:1px solid ${borderCard};padding-top:8px">
                        <span style="color:#6b7280">Stock esperado (limitado por ${limitante}):</span>
                        <span style="font-weight:700;color:#166534;font-size:14px">${d.stockEsperado}</span>
                        <span style="color:#d1d5db">·</span>
                        <span style="color:#6b7280">En sfcom ahora:</span>
                        <span style="font-weight:700;color:${colorDir};font-size:14px">${d.stockSfcom}</span>
                    </div>
                    ${_secReservas(d, borderCard)}
                </div>`
        }).join('')
        secciones += `
            <div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#92400e;font-weight:700;margin-bottom:8px">
                    ⚠️ Discrepancias de stock en sfcom
                </div>
                <div style="display:flex;flex-direction:column;gap:8px">${cartas}</div>
            </div>`
    }

    // sfcom — discrepancias pendientes
    if (tienePendientes) {
        const cartasPend = discrepanciasPendientes.map(d => {
            const titulo = d.variacionNombre ? `${d.servicio} — ${d.variacionNombre}` : d.servicio
            const n      = d.pendingRequests?.length ?? 0
            const filasPend = (d.pendingRequests ?? []).map(pr =>
                `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:12px;color:#1d4ed8">
                     <span>${pr.clientName || '—'} · ${pr.slots} plaza${pr.slots !== 1 ? 's' : ''}</span>
                     <span style="background:#dbeafe;color:#1d4ed8;border-radius:3px;padding:1px 5px;font-size:10px;white-space:nowrap">${pr.source}</span>
                 </div>`
            ).join('')
            return `
                <div style="border:1px solid #bfdbfe;border-radius:8px;padding:14px;background:#eff6ff;display:flex;flex-direction:column;gap:8px">
                    <div>
                        <div style="font-size:13px;font-weight:600;color:#1f2937">${titulo}</div>
                        <div style="font-size:11px;color:#6b7280;margin-top:1px">${d.venueId} · ${d.serviceId}</div>
                    </div>
                    <div style="font-size:12px;font-weight:600;color:#1d4ed8;background:#dbeafe;padding:4px 8px;border-radius:4px;display:inline-block">
                        ℹ️ sfcom muestra ${Math.abs(d.diferencia)} plaza${Math.abs(d.diferencia) !== 1 ? 's' : ''} de menos
                        — explicado por ${n} pedido${n !== 1 ? 's' : ''} sfcom sin incorporar
                    </div>
                    ${_gridPlazas(d, '#bfdbfe')}
                    <div style="border-top:1px solid #bfdbfe;padding-top:8px">
                        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#1d4ed8;font-weight:600;margin-bottom:4px">
                            Pedido${n !== 1 ? 's' : ''} sfcom por procesar
                        </div>
                        <div style="display:flex;flex-direction:column;gap:2px">${filasPend}</div>
                    </div>
                    ${_secReservas(d, '#bfdbfe')}
                    <div style="font-size:12px;color:#6b7280;padding-top:2px">
                        Cuando incorpores ${n === 1 ? 'este pedido' : 'estos pedidos'} como reserva, la diferencia desaparecerá.
                        No sincronices el stock — sfcom ya ha vendido esas plazas.
                    </div>
                </div>`
        }).join('')
        secciones += `
            <div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#1d4ed8;font-weight:700;margin-bottom:8px">
                    ℹ️ Pedidos sfcom pendientes de incorporar
                </div>
                <div style="display:flex;flex-direction:column;gap:8px">${cartasPend}</div>
            </div>`
    }

    // sfcom — OK / fallos
    if (!tieneDiscrepancias && !tienePendientes && !tieneFallos && sfcom) {
        secciones += `
            <div style="font-size:13px;color:#166534;display:flex;align-items:center;gap:6px;padding:8px 0;border-top:1px solid #f3f4f6">
                <span>✅</span> Stock en sfcom verificado y correcto
            </div>`
    }
    if (tieneFallos) {
        const filasFallos = (sfcom.fallos ?? []).map(f => `
            <div style="font-size:12px;color:#374151;padding:2px 0">
                <span style="color:#6b7280">${f.servicio}</span>
                <span style="color:#9ca3af;margin-left:4px">· ${f.venueId} · ${f.serviceId}</span>
            </div>`).join('')
        secciones += `
            <div style="padding:10px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb">
                <div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:6px">
                    ⚠️ ${sfcom.fallos.length} par${sfcom.fallos.length !== 1 ? 'es' : ''} no pudo${sfcom.fallos.length !== 1 ? 'ieron' : ''} verificarse (timeout / CORS)
                </div>
                <div style="max-height:120px;overflow-y:auto">${filasFallos}</div>
            </div>`
    }

    // sfcom — avisos (confirmed sin product_id), solo modoManual
    if (tieneAvisosSfcom) {
        secciones += `
            <div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:700;margin-bottom:6px">
                    ℹ️ Avisos sfcom
                </div>
                <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.9">
                    ${sfcom.avisos.map(a => `<li>${a}</li>`).join('')}
                </ul>
            </div>`
    }

    // Financiero
    if (financiero) {
        const pcF = financiero.problemasClientes ?? []
        const ppF = financiero.problemasProveedores ?? []
        if (!tieneProblemasF) {
            secciones += `
                <div style="border-top:1px solid #f3f4f6;padding-top:12px">
                    <div style="font-size:13px;color:#166534;display:flex;align-items:center;gap:6px">
                        <span>✅</span> Cobros y pagos cuadran con las reservas activas
                    </div>
                </div>`
        } else {
            const hayHistorialF = pcF.some(p => p.tieneHistorial)
            const filaF = ({ tipo, id, diff, tieneHistorial }) => `<tr>
                <td style="font-size:12px">${tipo}</td>
                <td style="font-size:12px">${id}${tieneHistorial ? ' ⚠️' : ''}</td>
                <td style="font-size:12px;color:${diff > 0 ? '#92400e' : '#991b1b'}">${diff > 0 ? '+' : ''}${_fmt(diff)}</td>
            </tr>`
            secciones += `
                <div style="border-top:1px solid #f3f4f6;padding-top:12px">
                    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#991b1b;font-weight:700;margin-bottom:8px">
                        ⚠️ Inconsistencias financieras
                    </div>
                    <table class="tabla-admin" style="width:100%;margin-bottom:8px">
                        <thead><tr><th>Tipo</th><th>ID</th><th>Diferencia</th></tr></thead>
                        <tbody>
                            ${pcF.map(p => filaF({ ...p, tipo: 'Cliente' })).join('')}
                            ${ppF.map(p => filaF({ ...p, tipo: 'Proveedor' })).join('')}
                        </tbody>
                    </table>
                    ${hayHistorialF ? `<div style="font-size:12px;color:#92400e;margin-bottom:8px">⚠️ Hay cobros ya cobrados o facturados — revisa antes de corregir.</div>` : ''}
                    ${(persistirCobros || persistirPagos) ? `<button id="btn-corregir-financiero" class="btn btn-secondary" style="font-size:12px">🔧 Corregir automáticamente</button>` : ''}
                </div>`
        }
    }

    // BD — avisos informativos (solicitudes pendientes), solo modoManual
    if (tieneAvisosBD) {
        secciones += `
            <div style="border-top:1px solid #f3f4f6;padding-top:12px">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:700;margin-bottom:6px">
                    ℹ️ Solicitudes pendientes
                </div>
                <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.9">
                    ${bd.avisos.map(a => `<li>${a}</li>`).join('')}
                </ul>
            </div>`
    }

    // BD — advertencias de consistencia (fechas, estados), solo modoManual
    if (tieneAdvertenciasBD) {
        secciones += `
            <div style="border-top:1px solid #f3f4f6;padding-top:12px">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#92400e;font-weight:700;margin-bottom:6px">
                    ⚠️ Advertencias de consistencia
                </div>
                <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.9">
                    ${bd.advertencias.map(a => `<li>${a}</li>`).join('')}
                </ul>
            </div>`
    }

    // Financiero — advertencias de registros a cero, solo modoManual
    if (tieneAdvFinanciero) {
        secciones += `
            <div style="border-top:1px solid #f3f4f6;padding-top:12px">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#92400e;font-weight:700;margin-bottom:6px">
                    ⚠️ Registros financieros a cero
                </div>
                <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.9">
                    ${financiero.advertencias.map(a => `<li>${a}</li>`).join('')}
                </ul>
            </div>`
    }

    // ── Título y botones ──────────────────────────────────────────────────────
    const colorTitulo = (tieneErroresBD || tieneIdsMismatch || tieneProblemasF) ? '#991b1b'
        : tieneDiscrepancias ? '#92400e'
        : tienePendientes    ? '#1d4ed8'
        : tieneFallos        ? '#92400e'
        : '#166534'
    const iconoTitulo = (tieneErroresBD || tieneIdsMismatch || tieneProblemasF) ? '❌'
        : tieneDiscrepancias ? '⚠️'
        : tienePendientes    ? 'ℹ️'
        : tieneFallos        ? '⚠️'
        : '✅'
    const textoTitulo = (tieneErroresBD || tieneIdsMismatch || tieneDiscrepancias || tieneProblemasF)
        ? 'Inconsistencias detectadas'
        : tienePendientes ? 'Pedidos sfcom pendientes de incorporar'
        : tieneFallos     ? 'Verificación parcial de sfcom'
        : 'Verificación de datos'

    const { overlay, panel } = crearModal('modal-verificacion', { wide: true, scroll: true })
    panel.innerHTML = `
        <div style="font-size:16px;font-weight:600;color:${colorTitulo}">
            ${iconoTitulo} ${textoTitulo}
        </div>
        ${secciones}
        <div class="modal-actions">
            ${tieneDiscrepancias ? `
            <button id="btn-actualizar-stock-sfcom" class="btn btn-danger" style="white-space:nowrap">
                🔄 Sincronizar todos
            </button>` : ''}
            <button id="btn-verificacion-cerrar" class="${hayProblema ? 'btn btn-secondary' : 'btn btn-primary'}">
                ${hayProblema ? 'Cerrar' : 'OK'}
            </button>
        </div>`

    panel.querySelector('#btn-verificacion-cerrar').addEventListener('click', () => overlay.remove())

    // Botón corrección financiera
    if (tieneProblemasF && (persistirCobros || persistirPagos)) {
        const btnCorr = panel.querySelector('#btn-corregir-financiero')
        if (btnCorr) {
            btnCorr.addEventListener('click', async () => {
                btnCorr.disabled = true
                btnCorr.textContent = 'Corrigiendo…'
                const manuales = await _corregirFinanciero(supabase, financiero, dados, persistirCobros, persistirPagos)
                if (manuales.length > 0) {
                    const liManuales = manuales.map(p => `<li><strong>${p.id}</strong> — ${_fmt(p.enBD)} en cobros, sin reservas activas</li>`).join('')
                    btnCorr.closest('div[style*="border-top"]').innerHTML = `
                        <div style="font-size:13px;color:#92400e;font-weight:600;margin-bottom:8px">⚠️ Corrección parcial</div>
                        <p style="font-size:13px;margin-bottom:8px">Los demás problemas se han corregido. Estos clientes requieren acción manual (tienen cobros cobrados o facturados):</p>
                        <ul style="margin:0 0 8px 16px;font-size:13px">${liManuales}</ul>
                        <p style="font-size:12px;color:#6b7280">Abre cada cliente en el panel de reservas y resuelve el historial.</p>`
                } else {
                    btnCorr.textContent = '✓ Hecho — recargando…'
                    setTimeout(() => location.reload(), 1500)
                }
            })
        }
    }

    // Sincronizar todos / por par
    if (tieneDiscrepancias) {
        panel.querySelector('#btn-actualizar-stock-sfcom').addEventListener('click', async function () {
            this.disabled = true
            this.textContent = 'Actualizando…'
            for (const d of discrepanciasReales) {
                await syncStockToSfcom(supabase, d.venueId, d.serviceId)
            }
            overlay.remove()
            await onReverify()
        })
        overlay.querySelectorAll('.btn-sync-par').forEach(btn => {
            btn.addEventListener('click', async function () {
                this.disabled = true
                this.textContent = '…'
                await syncStockToSfcom(supabase, this.dataset.venue, this.dataset.service)
                overlay.remove()
                await onReverify()
            })
        })
    }
}

// ─── Lógica auto/manual: decide toast vs modal ────────────────────────────────

async function _mostrarResultado(resultado, supabase, onReverify, opts) {
    const { modoManual } = opts
    const { bd, financiero, sfcom } = resultado

    const discRepReal   = (sfcom?.discrepancias ?? []).filter(d => !d.pendingExplains)
    const hayPendientes = (sfcom?.discrepancias ?? []).some(d => d.pendingExplains)
    const nPendientes   = (sfcom?.discrepancias ?? []).filter(d => d.pendingExplains).length

    const hayProblemaAuto = (bd?.errores?.length ?? 0) > 0
        || discRepReal.length > 0
        || (sfcom?.idsMismatch?.length ?? 0) > 0
        || (financiero?.problemasClientes?.length ?? 0) > 0
        || (financiero?.problemasProveedores?.length ?? 0) > 0

    if (modoManual || hayProblemaAuto) {
        _mostrarModal(resultado, supabase, onReverify, opts)
        return
    }

    // Auto: solo toasts
    if (hayPendientes) {
        mostrarToast(`ℹ️ ${nPendientes} pedido(s) sfcom pendiente(s) de incorporar`, '#1d4ed8')
    } else if ((sfcom?.fallos?.length ?? 0) > 0 || (sfcom && !sfcom.verificado)) {
        mostrarToast('⚠️ Reservas verificadas — sfcom no disponible', '#92400e')
    } else {
        mostrarToast('✅ Coherencia verificada y correcta')
    }
}

// ─── Punto de entrada único ───────────────────────────────────────────────────

export async function ejecutarVerificacion(supabase, {
    modoManual        = false,
    incluirSfcom      = true,
    incluirFinanciero = true,
    persistirCobros   = null,
    persistirPagos    = null,
    season            = new Date().getFullYear()
} = {}) {
    const toastEl = mostrarToast('🔍 Verificando…', '#374151')

    let resultado
    try {
        const dados = await _cargarDatos(supabase, season)

        if (dados.error) {
            toastEl?.remove()
            mostrarToast('❌ Error al cargar datos — verifica la conexión', '#991b1b')
            return null
        }

        const bd         = _verificarBD(dados)
        const financiero = incluirFinanciero ? _computarFinanciero(dados) : null

        let sfcom = null
        if (incluirSfcom) {
            sfcom = await verificarSfcom({ reservas: dados.reservas, availability: dados.availability, solicitudes: dados.solicitudes })

            // Flujo idsMismatch (dead en la práctica — API no expone nombres de variaciones)
            if ((sfcom.idsMismatch?.length ?? 0) > 0) {
                toastEl?.remove()
                const decision = await _mostrarModalPreCorreccion(sfcom.idsMismatch)
                if (decision === 'corregir') {
                    for (const m of sfcom.idsMismatch) {
                        await verificarConfirmarSfcom(supabase, m.availId, m.servicio, m.serviceId)
                    }
                    sfcom = await verificarSfcom({ reservas: dados.reservas, availability: dados.availability, solicitudes: dados.solicitudes })
                } else {
                    sfcom = { ...sfcom, _sinBotonCorregir: true }
                }
            }
        }

        resultado = { bd, financiero, sfcom, _dados: dados }
    } finally {
        toastEl?.remove()
    }

    const onReverify = () => ejecutarVerificacion(supabase, {
        modoManual: true, incluirSfcom, incluirFinanciero, persistirCobros, persistirPagos, season
    })

    await _mostrarResultado(resultado, supabase, onReverify, {
        modoManual, persistirCobros, persistirPagos, dados: resultado._dados
    })

    return resultado
}
