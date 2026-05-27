// verificacion.js
// UI de verificación de coherencia de datos + stock sfcom.
// Exporta las funciones de modal y toast para reutilizarlas en
// formulario.js y sfcom-panel.js sin duplicar código.

import { syncStockToSfcom } from './sfcom.js'
import { crearModal } from './modal.js'

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

// ─── Modal de resultados de verificación ─────────────────────────────────────
// supabase  : cliente Supabase del módulo llamante
// onReverify: callback () => Promise — se llama al pulsar Sincronizar para reverificar

export function mostrarModalVerificacion(resultado, supabase, onReverify, opts = {}) {
    const prev = document.getElementById('modal-verificacion')
    if (prev) prev.remove()

    const discrepanciasReales      = (resultado.sfcom.discrepancias ?? []).filter(d => !d.pendingExplains)
    const discrepanciasPendientes  = (resultado.sfcom.discrepancias ?? []).filter(d =>  d.pendingExplains)

    const tieneErrores                 = resultado.errores.length > 0
    const tieneDiscrepancias           = discrepanciasReales.length > 0
    const tieneDiscrepanciasPendientes = discrepanciasPendientes.length > 0
    const tieneIdsMismatch             = (resultado.sfcom.idsMismatch?.length ?? 0) > 0
    const tieneFallos                  = (resultado.sfcom.fallos?.length ?? 0) > 0
    const hayProblema                  = tieneErrores || tieneDiscrepancias || tieneIdsMismatch || tieneFallos

    let secciones = ''

    if (!tieneErrores) {
        secciones += `
            <div style="display:flex;align-items:center;gap:10px;padding:12px;
                        background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0">
                <span style="font-size:18px">✅</span>
                <div style="font-size:13px;color:#166534">
                    No se han detectado inconsistencias en reservas, plazas ni relaciones de datos.
                </div>
            </div>`
    } else {
        secciones += `
            <div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;
                            color:#991b1b;font-weight:700;margin-bottom:8px">
                    ❌ Errores de coherencia en Supabase
                </div>
                <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.9">
                    ${resultado.errores.map(e => `<li>${e}</li>`).join('')}
                </ul>
            </div>`
    }

    if (tieneIdsMismatch) {
        const tarjetasMismatch = (resultado.sfcom.idsMismatch ?? []).map(m => `
            <div style="border:1px solid #fca5a5;border-radius:8px;padding:12px;background:#fef2f2;
                        display:flex;flex-direction:column;gap:5px">
                <div>
                    <span style="font-size:13px;font-weight:600;color:#1f2937">${m.servicio}</span>
                    <span style="font-size:11px;color:#6b7280;margin-left:6px">${m.providerId} · ${m.serviceId}</span>
                </div>
                <div style="font-size:12px;color:#374151">
                    Variación guardada: <strong style="color:#991b1b">${m.storedVariationId}
                    (${m.variacionNombre ?? '?'})</strong> — día ${m.dayStored}.
                    Esperado: día ${m.dayExpected}.
                </div>
                <div style="font-size:12px;color:#6b7280">
                    ${opts.sinBotonCorregir
                        ? '⚠️ Elegiste continuar sin corregir — la comparación de stock para este par se ha omitido.'
                        : 'Los PUTs de stock se han enviado a la variación incorrecta. La comparación de stock se ha omitido.'}
                </div>
            </div>`
        ).join('')

        secciones += `
            <div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;
                            color:#991b1b;font-weight:700;margin-bottom:8px">
                    ❌ IDs de variación incorrectos
                </div>
                <div style="display:flex;flex-direction:column;gap:8px">${tarjetasMismatch}</div>
            </div>`
    }

    function _gridPlazas(d, borderColor) {
        const totalLibre  = d.total_slots - d.todasOcupadas
        const sfcomLibre  = d.sfcom_slots_listed - d.sfcomVendidas
        const ownReservas = (d.reservasPar ?? []).filter(r => !r.sfcomRef)
        const sfcReservas = (d.reservasPar ?? []).filter(r =>  r.sfcomRef)
        const ownSlots    = ownReservas.reduce((s, r) => s + r.slots, 0)
        const sfcSlots    = sfcReservas.reduce((s, r) => s + r.slots, 0)
        return `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;
                        background:rgba(0,0,0,0.03);border-radius:6px;padding:8px 10px;font-size:12px">
                <div style="color:#6b7280;font-size:10px;font-weight:600;text-transform:uppercase;
                            letter-spacing:.05em;padding-bottom:2px">Proveedor</div>
                <div style="color:#6b7280;font-size:10px;font-weight:600;text-transform:uppercase;
                            letter-spacing:.05em;padding-bottom:2px">Sfcom</div>
                <div style="color:#374151">${d.total_slots} plazas contratadas</div>
                <div style="color:#374151">${d.sfcom_slots_listed} plazas listadas</div>
                <div style="color:#374151">${d.todasOcupadas} ocupadas
                    ${ownSlots && sfcSlots
                        ? `<span style="color:#9ca3af">(${ownSlots} propias + ${sfcSlots} sfcom)</span>`
                        : sfcSlots  ? `<span style="color:#9ca3af">(${sfcSlots} sfcom)</span>`
                        : ownSlots  ? `<span style="color:#9ca3af">(${ownSlots} propias)</span>` : ''}</div>
                <div style="color:#374151">${d.sfcomVendidas} vendidas por sfcom</div>
                <div style="color:#374151;font-weight:500">${totalLibre} libres</div>
                <div style="color:#374151;font-weight:500">${sfcomLibre} cuota disponible</div>
            </div>`
    }

    function _secReservas(d, borderColor) {
        if (!(d.reservasPar?.length)) {
            return `<div style="border-top:1px solid ${borderColor};padding-top:6px;margin-top:2px;
                               font-size:12px;color:#6b7280">Sin reservas activas</div>`
        }
        const filas = d.reservasPar.map(r => {
            const origen = r.sfcomRef
                ? `<span style="background:#dbeafe;color:#1d4ed8;border-radius:3px;
                                padding:1px 5px;font-size:10px;white-space:nowrap">${r.sfcomRef}</span>`
                : `<span style="background:#f3f4f6;color:#6b7280;border-radius:3px;
                                padding:1px 5px;font-size:10px">propia</span>`
            return `<div style="display:flex;justify-content:space-between;align-items:center;
                                padding:2px 0;font-size:12px;color:#374151">
                        <span>${r.id} · ${r.clientName} · ${r.slots} plaza${r.slots !== 1 ? 's' : ''}</span>
                        ${origen}
                    </div>`
        }).join('')
        return `<div style="border-top:1px solid ${borderColor};padding-top:8px;margin-top:2px">
                    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;
                                color:#6b7280;font-weight:600;margin-bottom:4px">
                        Reservas activas (${d.todasOcupadas} plazas)
                    </div>
                    <div style="display:flex;flex-direction:column;gap:2px">${filas}</div>
                </div>`
    }

    if (tieneDiscrepancias) {
        const cartas = discrepanciasReales.map(d => {
            const esGrave    = d.diferencia > 0
            const bgCard     = esGrave ? '#fff7ed' : '#fffbeb'
            const borderCard = esGrave ? '#fed7aa' : '#fde68a'
            const colorDir   = esGrave ? '#991b1b' : '#92400e'
            const bgBadge    = esGrave ? '#fee2e2' : '#fef3c7'
            const titulo     = d.variacionNombre ? `${d.servicio} — ${d.variacionNombre}` : d.servicio
            const limitante  = (d.total_slots - d.todasOcupadas) <= (d.sfcom_slots_listed - d.sfcomVendidas)
                ? 'capacidad' : 'cuota sfcom'

            return `
                <div style="border:1px solid ${borderCard};border-radius:8px;padding:14px;
                            background:${bgCard};display:flex;flex-direction:column;gap:8px">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                        <div>
                            <div style="font-size:13px;font-weight:600;color:#1f2937">${titulo}</div>
                            <div style="font-size:11px;color:#6b7280;margin-top:1px">${d.providerId} · ${d.serviceId}</div>
                        </div>
                        <button class="btn-sync-par"
                            data-provider="${d.providerId}" data-service="${d.serviceId}"
                            style="background:transparent;border:1px solid ${borderCard};border-radius:5px;
                                   padding:3px 10px;font-size:11px;cursor:pointer;color:${colorDir};
                                   white-space:nowrap;flex-shrink:0">
                            🔄 Sincronizar
                        </button>
                    </div>
                    <div style="font-size:12px;font-weight:600;color:${colorDir};background:${bgBadge};
                                padding:4px 8px;border-radius:4px;display:inline-block">
                        ${esGrave ? '⚠️ Riesgo de sobreventa:' : 'ℹ️'} sfcom muestra
                        ${Math.abs(d.diferencia)} plaza${Math.abs(d.diferencia) !== 1 ? 's' : ''}
                        ${esGrave ? 'de MÁS' : 'de menos'} de las esperadas
                    </div>
                    ${_gridPlazas(d, borderCard)}
                    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;
                                border-top:1px solid ${borderCard};padding-top:8px">
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
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;
                            color:#92400e;font-weight:700;margin-bottom:8px">
                    ⚠️ Discrepancias de stock en sfcom
                </div>
                <div style="display:flex;flex-direction:column;gap:8px">${cartas}</div>
            </div>`
    }

    if (tieneDiscrepanciasPendientes) {
        const cartasPend = discrepanciasPendientes.map(d => {
            const titulo = d.variacionNombre ? `${d.servicio} — ${d.variacionNombre}` : d.servicio
            const n      = d.pendingRequests?.length ?? 0
            const filasPend = (d.pendingRequests ?? []).map(pr =>
                `<div style="display:flex;justify-content:space-between;align-items:center;
                             padding:2px 0;font-size:12px;color:#1d4ed8">
                     <span>${pr.clientName || '—'} · ${pr.slots} plaza${pr.slots !== 1 ? 's' : ''}</span>
                     <span style="background:#dbeafe;color:#1d4ed8;border-radius:3px;
                                  padding:1px 5px;font-size:10px;white-space:nowrap">${pr.source}</span>
                 </div>`
            ).join('')

            return `
                <div style="border:1px solid #bfdbfe;border-radius:8px;padding:14px;
                            background:#eff6ff;display:flex;flex-direction:column;gap:8px">
                    <div>
                        <div style="font-size:13px;font-weight:600;color:#1f2937">${titulo}</div>
                        <div style="font-size:11px;color:#6b7280;margin-top:1px">${d.providerId} · ${d.serviceId}</div>
                    </div>
                    <div style="font-size:12px;font-weight:600;color:#1d4ed8;background:#dbeafe;
                                padding:4px 8px;border-radius:4px;display:inline-block">
                        ℹ️ sfcom muestra ${Math.abs(d.diferencia)} plaza${Math.abs(d.diferencia) !== 1 ? 's' : ''} de menos
                        — explicado por ${n} pedido${n !== 1 ? 's' : ''} sfcom sin incorporar
                    </div>
                    ${_gridPlazas(d, '#bfdbfe')}
                    <div style="border-top:1px solid #bfdbfe;padding-top:8px">
                        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;
                                    color:#1d4ed8;font-weight:600;margin-bottom:4px">
                            Pedido${n !== 1 ? 's' : ''} sfcom por procesar
                        </div>
                        <div style="display:flex;flex-direction:column;gap:2px">${filasPend}</div>
                    </div>
                    ${_secReservas(d, '#bfdbfe')}
                    <div style="font-size:12px;color:#6b7280;padding-top:2px">
                        Cuando incorpores ${n === 1 ? 'este pedido' : 'estos pedidos'} como reserva,
                        la diferencia desaparecerá. No sincronices el stock — sfcom ya ha vendido esas plazas
                        y poner más disponibilidad sería incorrecto.
                    </div>
                </div>`
        }).join('')

        secciones += `
            <div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;
                            color:#1d4ed8;font-weight:700;margin-bottom:8px">
                    ℹ️ Pedidos sfcom pendientes de incorporar
                </div>
                <div style="display:flex;flex-direction:column;gap:8px">${cartasPend}</div>
            </div>`
    }

    if (!tieneDiscrepancias && !tieneDiscrepanciasPendientes && !tieneFallos) {
        secciones += `
            <div style="font-size:13px;color:#166534;display:flex;align-items:center;gap:6px;
                        padding:8px 0;border-top:1px solid #f3f4f6">
                <span>✅</span> Stock en sfcom verificado y correcto
            </div>`
    }

    if (tieneFallos) {
        const filasFallos = (resultado.sfcom.fallos ?? []).map(f => `
            <div style="font-size:12px;color:#374151;padding:2px 0">
                <span style="color:#6b7280">${f.servicio}</span>
                <span style="color:#9ca3af;margin-left:4px">· ${f.providerId} · ${f.serviceId}</span>
            </div>`).join('')
        secciones += `
            <div style="padding:10px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb">
                <div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:6px">
                    ⚠️ ${resultado.sfcom.fallos.length} par${resultado.sfcom.fallos.length !== 1 ? 'es' : ''}
                    no pudo${resultado.sfcom.fallos.length !== 1 ? 'ieron' : ''} verificarse
                    (timeout / CORS)
                </div>
                <div style="max-height:120px;overflow-y:auto">${filasFallos}</div>
            </div>`
    }

    if (resultado.avisos.length > 0) {
        secciones += `
            <div>
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;
                            color:#6b7280;font-weight:700;margin-bottom:6px">
                    ℹ️ Avisos
                </div>
                <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.9">
                    ${resultado.avisos.map(a => `<li>${a}</li>`).join('')}
                </ul>
            </div>`
    }

    const colorTitulo = tieneErrores || tieneIdsMismatch
        ? '#991b1b'
        : tieneDiscrepancias
            ? '#92400e'
            : tieneDiscrepanciasPendientes
                ? '#1d4ed8'
                : tieneFallos
                    ? '#92400e'
                    : '#166534'
    const iconoTitulo = tieneErrores || tieneIdsMismatch ? '❌'
        : tieneDiscrepancias                             ? '⚠️'
        : tieneDiscrepanciasPendientes                   ? 'ℹ️'
        : tieneFallos                                    ? '⚠️'
        : '✅'
    const textoTitulo = (tieneErrores || tieneIdsMismatch || tieneDiscrepancias)
        ? 'Inconsistencias detectadas'
        : tieneDiscrepanciasPendientes
            ? 'Pedidos sfcom pendientes de incorporar'
            : tieneFallos
                ? 'Verificación parcial de sfcom'
                : 'Verificación de datos'
    const colorBtn    = hayProblema ? '#f3f4f6' : '#166534'
    const colorBtnTxt = hayProblema ? '#374151' : '#fff'
    const bordeBtn    = hayProblema ? '1px solid #d1d5db' : 'none'

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

    if (tieneDiscrepancias) {
        panel.querySelector('#btn-actualizar-stock-sfcom').addEventListener('click', async function () {
            this.disabled = true
            this.textContent = 'Actualizando…'
            for (const d of discrepanciasReales) {
                await syncStockToSfcom(supabase, d.providerId, d.serviceId)
            }
            overlay.remove()
            await onReverify()
        })

        overlay.querySelectorAll('.btn-sync-par').forEach(btn => {
            btn.addEventListener('click', async function () {
                this.disabled = true
                this.textContent = '…'
                await syncStockToSfcom(supabase, this.dataset.provider, this.dataset.service)
                overlay.remove()
                await onReverify()
            })
        })
    }
}

// ─── Modal de pre-corrección de idsMismatch ───────────────────────────────────

export function mostrarModalPreCorreccion(mismatches) {
    return new Promise(resolve => {
        const prev = document.getElementById('modal-pre-correccion')
        if (prev) prev.remove()

        const lista = mismatches.map(m => `
            <div style="font-size:12px;color:#374151;padding:4px 0;border-bottom:1px solid #fecaca">
                <strong>${m.servicio}</strong>
                <span style="color:#6b7280"> · ${m.providerId} · ${m.serviceId}</span><br>
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
                        ¿Deseas corregirlos antes de ver los resultados de la verificación?
                    </div>
                </div>
            </div>
            <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;
                        padding:10px 12px;display:flex;flex-direction:column;gap:4px">
                ${lista}
            </div>
            <div style="font-size:12px;color:#6b7280;background:#f9fafb;border-radius:6px;padding:8px 10px;line-height:1.5">
                Si corriges, el sistema busca el producto correcto en sfcom por nombre y actualiza los IDs automáticamente,
                luego re-ejecuta la verificación completa.
                Si continúas sin corregir, la comparación de stock de esos pares se omitirá en los resultados.
            </div>
            <div class="modal-actions">
                <button id="btn-precorr-continuar" class="btn btn-secondary">Continuar sin corregir</button>
                <button id="btn-precorr-corregir" class="btn btn-danger">🔧 Corregir y reverificar</button>
            </div>`

        panel.querySelector('#btn-precorr-continuar').addEventListener('click', () => { overlay.remove(); resolve('continuar') })
        panel.querySelector('#btn-precorr-corregir').addEventListener('click',  () => { overlay.remove(); resolve('corregir')  })
    })
}
