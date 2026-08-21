// ===== MÓDULO DE FACTURACIÓN =====
// Gestiona la generación, previsualización y emisión de facturas desde los hitos de cobro.
// Se importa desde formulario.js y necesita acceso al cliente supabase y a los datos globales.

import { mostrarOpcionesEnvio, valorO, esVacio, anioTemporada, checkTrimCerrado, mostrarModalTrimCerrado } from './utils.js'
import { PERFIL_FISCAL, irpfRateParaCliente, esFacturaSimplificada } from './fiscal-config.js'

// ===== CONFIGURACIÓN — editar aquí cuando cambien datos del emisor =====
const FACTURA_CONFIG = {
    emisor_nombre:    'Paula Díaz Echalecu',
    emisor_nif:       '72694758S',
    emisor_direccion: 'Calle Adela Bazo 2, 2G',
    emisor_cp_ciudad: '31006 Pamplona',
    iban:             'ES44 2100 2174 2502 0022 5124',
    web:              'experienciasanfermin.com',
    serie:            'VSF',    // Prefijo de serie: VSF-NN/AAAA
    email_asunto_tpl: (num, fecha) =>
        `Factura ${num} — ${fecha} — Vive San Fermín desde dentro (www.experienciasanfermin.com)`,
    email_cuerpo_tpl: (nombreCliente, numFactura, totalAPagar) =>
        `Estimado/a ${nombreCliente},\n\nAdjunto encontrará la factura ${numFactura} por importe de ${totalAPagar}.\n\nQuedamos a su disposición para cualquier consulta.\n\nUn saludo,\nPaula Díaz Echalecu\nVive San Fermín desde dentro\nwww.experienciasanfermin.com`,
}

// URL del logo — ruta relativa desde /admin/
const LOGO_URL = '../img/logos/sanfermin-logo-red.png'

// Conversión precio final ↔ base imponible. irpfRate en puntos porcentuales (0, 15…).
// Único punto de esta fórmula en todo el proyecto — formulario.js y factura.js pasan por aquí.
export function baseDesdeTotalFacturado(totalFacturado, irpfRate = 0) {
    return totalFacturado / (1 + PERFIL_FISCAL.iva_rate / 100 - irpfRate / 100)
}
export function totalFacturadoDesdeBase(base, irpfRate = 0) {
    return base * (1 + PERFIL_FISCAL.iva_rate / 100 - irpfRate / 100)
}

// ===== ESTADO DEL MÓDULO =====
let _supabase      = null   // cliente Supabase inyectado al inicializar
let _hitoActual    = null   // charge completo que se está facturando
let _reservas      = []     // reservas del cliente actual (con sus charges)
let _charges       = []     // todos los charges del cliente (para ajustes y liquidación)
let _cliente       = null   // objeto cliente actual
let _numFacturaSig = null   // número de factura calculado (o existente en re-emisión)
let _logoBase64    = null   // logo en base64 para el PDF (se carga al inicializar)
let _modoReemision     = false  // true cuando se reabre el panel para re-emitir una factura ya emitida
let _simplificadaManual = null  // null = auto-detect, true/false = elección explícita del usuario

// ===== TIPOS DE FACTURA =====
// 'adelanto'   — pago parcial, quedan hitos pendientes
// 'liquidacion'— pago final con adelantos previos ya facturados
// 'unico'      — pago único sin adelantos previos (cobro total en un solo hito)
function tipoFactura() {
    const esHitoFinal    = _hitoActual.charge_type === 'final'
    const facturadosPrev = _charges.filter(c => c.invoiced && c.id !== _hitoActual.id && c.invoice_number && c.charge_type !== 'ajuste')
    if (!esHitoFinal)              return 'adelanto'
    if (facturadosPrev.length > 0) return 'liquidacion'
    return 'unico'
}

// ===== INICIALIZACIÓN =====
export function initFacturacion(supabaseClient) {
    _supabase = supabaseClient
    _cargarLogoBase64()

    const dialog = document.getElementById('dialogFactura')

    document.getElementById('btnCerrarFactura').addEventListener('click', cerrarPanel)
    document.getElementById('btnCancelarFactura').addEventListener('click', cerrarPanel)

    // Cerrar al pulsar en el backdrop (fuera del contenido del dialog)
    dialog.addEventListener('click', e => {
        const r = dialog.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX > r.right ||
            e.clientY < r.top  || e.clientY > r.bottom)
            dialog.close()
    })
}

// ===== PUNTOS DE ENTRADA =====
export async function abrirPanelFactura(hitoId, clienteObj, reservasCliente) {
    _modoReemision      = false
    _simplificadaManual = null
    _cliente  = clienteObj
    _reservas = reservasCliente

    const { data: hito, error } = await _supabase
        .from('charges').select('*').eq('id', hitoId).single()
    if (error || !hito) { alert('Error al cargar el hito: ' + (error?.message ?? 'no encontrado')); return }
    _hitoActual = hito

    const { data: chargesData } = await _supabase.from('charges').select('*').eq('client_id', hito.client_id)
    _charges = chargesData ?? []

    _numFacturaSig = await calcularSiguienteNumero()
    renderPanelFactura()
    abrirPanel()

    const irpfRate     = irpfRateParaCliente(_cliente)
    const base         = parseFloat(_hitoActual.amount)
    const totalPagar   = totalFacturadoDesdeBase(base, irpfRate)
    const nombreSaludo = valorO(_cliente.name, _cliente.id)
    mostrarOpcionesEnvio({
        tipo:      'pdf',
        email:     _cliente.email ?? null,
        telefono:  _cliente.phone ?? null,
        asunto:    FACTURA_CONFIG.email_asunto_tpl(_numFacturaSig, new Date().toLocaleDateString('es-ES')),
        getTexto:  () => FACTURA_CONFIG.email_cuerpo_tpl(nombreSaludo, _numFacturaSig, fmt(totalPagar)),
        onGenerar: _emitir,
        onUsado:   cerrarPanel,
        container: document.getElementById('factura-botones-envio')
    })
}

// Re-emitir: conserva el número de factura existente, anula el registro anterior al emitir
export async function abrirPanelReemision(hitoId, clienteObj, reservasCliente) {
    _modoReemision      = true
    _simplificadaManual = null
    _cliente  = clienteObj
    _reservas = reservasCliente

    const { data: hito, error } = await _supabase
        .from('charges').select('*').eq('id', hitoId).single()
    if (error || !hito) { alert('Error al cargar el hito: ' + (error?.message ?? 'no encontrado')); _modoReemision = false; return }
    _hitoActual    = hito
    _numFacturaSig = hito.invoice_number  // conservar número existente

    const { data: chargesData } = await _supabase.from('charges').select('*').eq('client_id', hito.client_id)
    _charges = chargesData ?? []

    const { data: issuedActiva } = await _supabase
        .from('issued_invoices').select('accrual_date')
        .eq('charge_id', hitoId).eq('is_void', false).maybeSingle()
    if (issuedActiva) {
        const trim = await checkTrimCerrado(_supabase, issuedActiva.accrual_date)
        if (trim.cerrado) { mostrarModalTrimCerrado(trim.year, trim.quarter); _modoReemision = false; return }
    }

    renderPanelFactura()
    abrirPanel()

    const irpfRate     = irpfRateParaCliente(_cliente)
    const base         = parseFloat(_hitoActual.amount)
    const totalPagar   = totalFacturadoDesdeBase(base, irpfRate)
    const nombreSaludo = valorO(_cliente.name, _cliente.id)
    mostrarOpcionesEnvio({
        tipo:      'pdf',
        email:     _cliente.email ?? null,
        telefono:  _cliente.phone ?? null,
        asunto:    FACTURA_CONFIG.email_asunto_tpl(_numFacturaSig, new Date().toLocaleDateString('es-ES')),
        getTexto:  () => FACTURA_CONFIG.email_cuerpo_tpl(nombreSaludo, _numFacturaSig, fmt(totalPagar)),
        onGenerar: _emitir,
        onUsado:   cerrarPanel,
        container: document.getElementById('factura-botones-envio')
    })
}

// Anular sin re-emitir: elimina el asiento fiscal y limpia el charge. El PDF queda huérfano (intencional).
export async function anularFacturaDeHito(hitoId) {
    const { data: existente } = await _supabase
        .from('issued_invoices')
        .select('id, accrual_date')
        .eq('charge_id', hitoId)
        .eq('is_void', false)
        .maybeSingle()

    if (existente) {
        const trim = await checkTrimCerrado(_supabase, existente.accrual_date)
        if (trim.cerrado) { mostrarModalTrimCerrado(trim.year, trim.quarter); return }

        await _supabase.from('issued_invoice_vat_lines').delete().eq('invoice_id', existente.id)
        const { error: errDel } = await _supabase.from('issued_invoices').delete().eq('id', existente.id)
        if (errDel) { alert('Error al eliminar el asiento fiscal: ' + errDel.message); return }
    }

    const { error: errCharge } = await _supabase
        .from('charges')
        .update({ invoiced: false, invoice_number: null, invoice_path: null, invoiced_at: null })
        .eq('id', hitoId)
    if (errCharge) { alert('Error al actualizar el hito: ' + errCharge.message); return }

    document.dispatchEvent(new CustomEvent('facturaEmitida', { detail: { hitoId } }))
}

// ===== CÁLCULO DEL SIGUIENTE NÚMERO DE FACTURA =====
async function calcularSiguienteNumero() {
    const anio = new Date().getFullYear()
    const { data } = await _supabase
        .from('charges')
        .select('invoice_number')
        .like('invoice_number', `${FACTURA_CONFIG.serie}-%/${anio}`)
        .not('invoice_number', 'is', null)

    if (!data || data.length === 0) return `${FACTURA_CONFIG.serie}-01/${anio}`

    const maxNum = data.reduce((max, row) => {
        const match = row.invoice_number?.match(/-(\d+)\//)
        const n     = match ? parseInt(match[1]) : 0
        return n > max ? n : max
    }, 0)
    return `${FACTURA_CONFIG.serie}-${String(maxNum + 1).padStart(2, '0')}/${anio}`
}

// Devuelve si la factura es simplificada, respetando la elección manual si existe
function _efectivaSimplificada() {
    if (_simplificadaManual !== null) return _simplificadaManual
    const base       = parseFloat(_hitoActual.amount)
    const totalConIva = Math.round((base + base * PERFIL_FISCAL.iva_rate / 100) * 100) / 100
    return esFacturaSimplificada(_cliente, totalConIva)
}

window.facturaTipoChange = function(tipo) {
    _simplificadaManual = (tipo === 'simplificada')
    renderPanelFactura()
}

// ===== RENDERIZADO DEL PANEL =====
function renderPanelFactura() {
    const prefijo = _modoReemision ? '🔄 RE-EMISIÓN — ' : ''
    document.getElementById('panel-factura-subtitulo').textContent =
        `${prefijo}${valorO(_hitoActual.comments, '—')}  ·  ${fmt(_hitoActual.amount)}`

    const base        = parseFloat(_hitoActual.amount)
    const totalConIva = Math.round((base + base * PERFIL_FISCAL.iva_rate / 100) * 100) / 100
    const autoSimp    = esFacturaSimplificada(_cliente, totalConIva)
    const simplified  = _efectivaSimplificada()

    // Toolbar de tipo (solo cuando la simplificada es aplicable)
    const toolbar = document.getElementById('panel-factura-toolbar')
    if (autoSimp) {
        toolbar.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:6px 0 4px;font-size:13px;border-bottom:1px solid var(--border);margin-bottom:8px">
            <span style="color:var(--subtle);font-size:12px">Tipo de documento:</span>
            <label style="cursor:pointer;display:flex;align-items:center;gap:4px">
                <input type="radio" name="tipo-factura" value="simplificada" ${simplified ? 'checked' : ''}
                    onchange="facturaTipoChange('simplificada')"> Simplificada
            </label>
            <label style="cursor:pointer;display:flex;align-items:center;gap:4px">
                <input type="radio" name="tipo-factura" value="completa" ${!simplified ? 'checked' : ''}
                    onchange="facturaTipoChange('completa')"> Completa (con datos cliente)
            </label>
        </div>`
    } else {
        toolbar.innerHTML = ''
    }

    const alerta          = document.getElementById('panel-factura-alerta')
    const camposFaltantes = []
    if (!simplified) {
        if (esVacio(_cliente.nif))     camposFaltantes.push('NIF/CIF del cliente')
        if (esVacio(_cliente.address)) camposFaltantes.push('dirección del cliente')
    }
    if (camposFaltantes.length > 0) {
        alerta.style.display = 'block'
        alerta.textContent   = `⚠️ Faltan datos editables: ${camposFaltantes.join(', ')}. Puedes completarlos directamente en la factura.`
    } else if (simplified && base >= 400 && esVacio(_cliente.nif)) {
        alerta.style.display = 'block'
        alerta.textContent   = `ⓘ Simplificada con base ≥400€ sin NIF del cliente — el receptor puede solicitar factura completa.`
    } else {
        alerta.style.display = 'none'
    }

    document.getElementById('panel-factura-contenido').innerHTML = buildFacturaHTML()
}

// ===== HTML DE LA FACTURA (previsualización en panel) =====
function buildFacturaHTML() {
    const tipo        = tipoFactura()
    const irpfRate    = irpfRateParaCliente(_cliente)
    const base        = parseFloat(_hitoActual.amount)
    const iva         = base * PERFIL_FISCAL.iva_rate / 100
    const irpf        = base * irpfRate / 100
    const totalPagar  = base + iva - irpf
    const fechaHoy    = new Date().toLocaleDateString('es-ES')
    const simplified  = _efectivaSimplificada()

    const etiquetaTipo  = tipo === 'adelanto' ? 'Pago anticipado' : 'Cobro final'
    const etiquetaDocto = simplified ? 'FACTURA SIMPLIFICADA' : 'FACTURA'

    return `
    <div class="factura-doc" id="factura-preview">
        <img class="factura-watermark" src="${LOGO_URL}" alt="">
        <div class="factura-inner">

            <div class="factura-header">
                <div class="factura-brand">
                    <img class="factura-logo" src="${LOGO_URL}" alt="Logo Vive San Fermín" style="height:52px;width:auto">
                    <div>
                        <div class="factura-brand-name">Vive San Fermín desde dentro</div>
                        <div class="factura-brand-web">${FACTURA_CONFIG.web}</div>
                    </div>
                </div>
                <div class="factura-meta" style="align-self:flex-start;padding-top:2px">
                    <div class="factura-num">${_numFacturaSig}</div>
                    <div>Fecha: <span class="factura-editable" contenteditable="true">${fechaHoy}</span></div>
                    <div class="factura-tipo">${etiquetaDocto}</div>
                </div>
            </div>

            <div class="factura-parties">
                <div class="factura-party">
                    <div class="factura-party-label">Emisor</div>
                    <div class="factura-party-name">${FACTURA_CONFIG.emisor_nombre}</div>
                    <div class="factura-party-detail">
                        NIF: ${FACTURA_CONFIG.emisor_nif}<br>
                        ${FACTURA_CONFIG.emisor_direccion}<br>
                        ${FACTURA_CONFIG.emisor_cp_ciudad}
                    </div>
                </div>
                ${!simplified ? `
                <div class="factura-party">
                    <div class="factura-party-label">Cliente</div>
                    <div class="factura-party-name factura-editable" contenteditable="true"
                        data-field="name">${valorO(_cliente.company, valorO(_cliente.name, _cliente.id))}</div>
                    <div class="factura-party-detail">
                        NIF/CIF: <span class="factura-editable" contenteditable="true"
                            data-field="nif">${valorO(_cliente.nif, '— introducir NIF —')}</span><br>
                        <span class="factura-editable" contenteditable="true"
                            data-field="address">${valorO(_cliente.address, '— introducir dirección —')}</span>
                    </div>
                </div>` : ''}
            </div>

            <div class="factura-section">
                <div class="factura-section-label">${etiquetaTipo}</div>
                <table class="factura-lineas">
                    <thead><tr>
                        <th style="width:70%">Descripción</th><th>Importe</th>
                    </tr></thead>
                    <tbody><tr>
                        <td>
                            <span class="factura-editable" contenteditable="true"
                                data-field="concepto">${valorO(_hitoActual.comments, 'Pago')}</span>
                            <span style="font-size:10px;color:#aaa;margin-left:6px">(editable)</span>
                        </td>
                        <td>${fmt(base)}</td>
                    </tr></tbody>
                </table>

                <div style="margin-top:14px;display:flex;align-items:center;gap:12px">
                    <select id="selectNivelDetalle" style="font-size:11px;padding:2px 6px;border:1px solid #ccc;border-radius:4px" onchange="actualizarNivelDetalle()">
                        <option value="detalle">Mostrar detalle</option>
                        <option value="resumen">Mostrar resumen</option>
                        <option value="omitir">Omitir</option>
                    </select>
                    <div class="factura-section-label" id="titulo-detalle-servicios" style="margin:0">Detalle de servicios contratados</div>
                </div>
                <div id="contenedor-detalle-servicios">${buildTablaReservas()}</div>
                ${tipo === 'adelanto' ? buildNota() : tipo === 'liquidacion' ? buildLiquidacion() : ''}
            </div>

            <div class="factura-totales">
                <div class="factura-totales-grid">
                    <div class="factura-tot-row"><span>Base imponible</span><span>${fmt(base)}</span></div>
                    <div class="factura-tot-row">
                        <span>IVA (${PERFIL_FISCAL.iva_rate}%)</span>
                        <span>+ ${fmt(iva)}</span>
                    </div>
                    ${irpfRate > 0 ? `
                    <div class="factura-tot-row">
                        <span>Retención IRPF (${irpfRate}%)</span>
                        <span>- ${fmt(irpf)}</span>
                    </div>` : ''}
                    <div class="factura-tot-row factura-tot-final">
                        <span>TOTAL A PAGAR</span><span>${fmt(totalPagar)}</span>
                    </div>
                </div>
            </div>

            <div class="factura-footer">
                <div>Transferencia bancaria ·
                    <span class="factura-footer-iban">${FACTURA_CONFIG.iban}</span>
                </div>
                <div class="factura-footer-web">${FACTURA_CONFIG.web}</div>
            </div>
        </div>
    </div>`
}

// Muestra u oculta la tabla de detalle según el selector
window.actualizarNivelDetalle = function() {
    const nivel      = document.getElementById('selectNivelDetalle')?.value ?? 'detalle'
    const contenedor = document.getElementById('contenedor-detalle-servicios')
    const titulo     = document.getElementById('titulo-detalle-servicios')
    if (!contenedor) return
    const tipo    = tipoFactura()
    const ajustes = tipo === 'unico' ? _charges.filter(c => c.charge_type === 'ajuste') : []
    if (nivel === 'detalle') {
        if (titulo) titulo.textContent = 'Detalle de servicios contratados'
        contenedor.innerHTML    = buildTablaReservas()  // ya incluye filas de ajuste para 'unico'
        contenedor.style.display = ''
    } else if (nivel === 'resumen') {
        if (titulo) titulo.textContent = 'Resumen de servicios contratados'
        const rsv         = _reservas.filter(r => r.status !== 'Cancelada')
        const numEventos  = new Set(rsv.map(r => r.service_id)).size
        const plazasTotal = rsv.reduce((s, r) => s + (parseInt(r.slots) || 0), 0)
        const precioTotal = rsv.reduce((s, r) => s + parseFloat(r.total_amount ?? 0), 0)
        const resumenTabla = rsv.length > 0 ? `
            <table class="factura-rsv-table" style="margin-top:8px">
                <thead><tr>
                    <th>Nº de eventos</th>
                    <th style="text-align:center">Plazas totales</th>
                    <th style="text-align:right">Precio total</th>
                </tr></thead>
                <tbody><tr>
                    <td>${numEventos}</td>
                    <td style="text-align:center">${plazasTotal}</td>
                    <td style="text-align:right">${fmt(precioTotal)}</td>
                </tr></tbody>
            </table>` : ''
        const ajusteRows = ajustes.map(c => `
            <div class="factura-liq-row" style="margin-top:4px">
                <span style="font-style:italic;color:#666">${valorO(c.comments, 'Ajuste')}</span>
                <span>+ ${fmt(parseFloat(c.amount))}</span>
            </div>`).join('')
        contenedor.innerHTML = resumenTabla + ajusteRows
        contenedor.style.display = ''
    } else {
        // omitir: ocultar título y contenido
        if (titulo) titulo.textContent = ''
        contenedor.innerHTML    = ''
        contenedor.style.display = 'none'
    }
}

function _serviceLabel(r) {
    const venue = r.venue_display_name || r.venue_id || ''
    if (r.service_name) return venue ? `${r.service_name} — ${venue}` : r.service_name
    return r.service_description ?? String(r.service_id)
}

// Tabla de reservas — usada en HTML (incluye filas de ajuste para tipo 'unico')
function buildTablaReservas() {
    const tipo         = tipoFactura()
    const ajustes      = tipo === 'unico' ? _charges.filter(c => c.charge_type === 'ajuste') : []
    const reservasValidas = _reservas.filter(r => r.status !== 'Cancelada')
    if (reservasValidas.length === 0 && ajustes.length === 0) return ''
    const totalGlobal = reservasValidas.reduce((s, r) => s + parseFloat(r.total_amount ?? 0), 0)
    const filas = reservasValidas.map((r, i) => `
        <tr>
            <td><span class="factura-editable" contenteditable="true" data-field="concepto-svc" data-idx="${i}"
                style="display:block">${_serviceLabel(r)}</span></td>
            <td style="text-align:center">${r.slots}</td>
            <td style="text-align:right">${fmt(parseFloat(r.price_per_slot))}</td>
            <td style="text-align:right">${fmt(parseFloat(r.total_amount ?? 0))}</td>
        </tr>`).join('')
    const ajusteFilas = ajustes.map(c => `
        <tr class="factura-rsv-ajuste">
            <td colspan="3" style="text-align:right;font-style:italic;color:#666">${valorO(c.comments, 'Ajuste')}</td>
            <td style="text-align:right">+ ${fmt(parseFloat(c.amount))}</td>
        </tr>`).join('')
    return `
    <table class="factura-rsv-table">
        <thead><tr>
            <th>Servicio</th>
            <th style="text-align:center">Plazas</th>
            <th style="text-align:right">€/plaza</th>
            <th style="text-align:right">Subtotal</th>
        </tr></thead>
        <tbody>
            ${filas}
            ${ajusteFilas}
            ${reservasValidas.length > 0 ? `<tr class="factura-rsv-subtotal">
                <td colspan="3" style="text-align:right;font-size:11px;color:#777">Total servicios contratados</td>
                <td style="text-align:right">${fmt(totalGlobal)}</td>
            </tr>` : ''}
        </tbody>
    </table>`
}

// Nota para adelantos
function buildNota() {
    const totalGlobal = _reservas
        .filter(r => r.status !== 'Cancelada')
        .reduce((s, r) => s + parseFloat(r.total_amount ?? 0), 0)
    return `
    <div class="factura-nota">
        Pago parcial a cuenta del total de servicios contratados (${fmt(totalGlobal)}).
        Este anticipo no incluye la prestación del servicio, que se realizará
        durante San Fermín ${anioTemporada()} (6–14 de julio).
    </div>`
}

// Bloque liquidación: cuando hay adelantos previos facturados (y opcionalmente ajustes)
function buildLiquidacion() {
    const totalGlobal    = _reservas
        .filter(r => r.status !== 'Cancelada')
        .reduce((s, r) => s + parseFloat(r.total_amount ?? 0), 0)
    const ajustesCharges = _charges.filter(c => c.charge_type === 'ajuste')
    const facturados     = _charges.filter(c => c.invoiced && c.id !== _hitoActual.id && c.invoice_number && c.charge_type !== 'ajuste')
    const filasAj        = ajustesCharges.map(c => `
        <div class="factura-liq-row">
            <span class="factura-liq-label">${valorO(c.comments, 'Ajuste')}</span>
            <span>+ ${fmt(parseFloat(c.amount))}</span>
        </div>`).join('')
    const filasF         = facturados.map(c => `
        <div class="factura-liq-row">
            <span class="factura-liq-label">
                ${valorO(c.comments, 'Prepago')} (${c.invoice_number} · ${formatFecha(c.invoiced_at)})
            </span>
            <span>- ${fmt(parseFloat(c.amount))}</span>
        </div>`).join('')
    return `
    <div class="factura-section-label" style="margin-top:14px">Liquidación y pagos anteriores</div>
    <div class="factura-liq">
        <div class="factura-liq-row">
            <span class="factura-liq-label">Total servicios contratados</span>
            <span>${fmt(totalGlobal)}</span>
        </div>
        ${filasAj}
        ${filasF}
        <div class="factura-liq-row">
            <span><strong>Saldo pendiente (este hito)</strong></span>
            <span><strong>${fmt(parseFloat(_hitoActual.amount))}</strong></span>
        </div>
    </div>`
}


// ===== EMISIÓN: GENERA PDF, SUBE A STORAGE Y MARCA EL HITO COMO FACTURADO =====
async function _emitir() {
    const preview   = document.getElementById('factura-preview')
    const concepto  = preview.querySelector('[data-field="concepto"]')?.textContent?.trim() || _hitoActual.comments
    const nifEdit   = preview.querySelector('[data-field="nif"]')?.textContent?.trim()
    const addrEdit  = preview.querySelector('[data-field="address"]')?.textContent?.trim()
    const nameEdit  = preview.querySelector('[data-field="name"]')?.textContent?.trim()
    const svcLabels = [...preview.querySelectorAll('[data-field="concepto-svc"]')].map(el => el.textContent.trim())

    const updates = {}
    if (!esVacio(nifEdit)  && nifEdit  !== _cliente.nif    && !nifEdit.includes('—'))  updates.nif     = nifEdit
    if (!esVacio(addrEdit) && addrEdit !== _cliente.address && !addrEdit.includes('—')) updates.address = addrEdit
    if (!esVacio(nameEdit) && nameEdit !== valorO(_cliente.company, valorO(_cliente.name, _cliente.id))) updates.name = nameEdit

    if (Object.keys(updates).length > 0) {
        const { error } = await _supabase.from('clients').update(updates).eq('id', _cliente.id)
        if (error) { alert('Error al guardar datos del cliente: ' + error.message); return }
        Object.assign(_cliente, updates)
    }

    const hoy = new Date().toISOString().split('T')[0]
    const trimHoy = await checkTrimCerrado(_supabase, hoy)
    if (trimHoy.cerrado) { mostrarModalTrimCerrado(trimHoy.year, trimHoy.quarter); return }

    const pdfResult = await generarPDF({ svcLabels })

    let invoicePath = null
    if (pdfResult?.blob) {
        const { data: uploadData, error: errUpload } = await _supabase.storage
            .from('invoices')
            .upload(pdfResult.nombreArchivo, pdfResult.blob, { contentType: 'application/pdf', upsert: true })
        if (errUpload) {
            alert(`Error al subir la factura a Storage: ${errUpload.message}\n\nEl PDF se ha descargado correctamente. Puedes subirlo manualmente al bucket si es necesario.`)
            throw new Error(errUpload.message)
        } else {
            invoicePath = uploadData.path
        }
    }

    const camposFactura = { invoiced: true, invoiced_at: hoy, invoice_number: _numFacturaSig, comments: concepto }
    if (invoicePath) camposFactura.invoice_path = invoicePath
    const { error: errCharge } = await _supabase
        .from('charges')
        .update(camposFactura)
        .eq('id', _hitoActual.id)
    if (errCharge) { alert('Error al marcar como facturado: ' + errCharge.message); return }

    // Registrar en libro de facturas emitidas
    const irpfRate   = irpfRateParaCliente(_cliente)
    const base       = parseFloat(_hitoActual.amount)
    const totalNet   = Math.round(totalFacturadoDesdeBase(base, irpfRate) * 100) / 100
    const simplified = _efectivaSimplificada()

    const issuedPayload = {
        invoice_number: _numFacturaSig,
        issue_date:     hoy,
        accrual_date:   hoy,
        client_id:      _cliente.id,
        client_name:    valorO(_cliente.company, valorO(_cliente.name, _cliente.id)),
        client_nif:     _cliente.nif     ?? null,
        client_address: _cliente.address ?? null,
        total:          totalNet,
        file_path:      invoicePath,
        charge_id:      _hitoActual.id,
        season:         _hitoActual.season,
        irpf_rate:      irpfRate,
        irpf_amount:    Math.round(base * irpfRate / 100 * 100) / 100,
        invoice_type:   tipoFactura(),
        operation_type: 'interior',
        is_simplified:  simplified,
    }

    // Guard: si ya existe una factura activa para este hito, actualizar en lugar de duplicar.
    // (re-emisión con anulación explícita se gestiona desde BLOQUE 4)
    const { data: existente } = await _supabase
        .from('issued_invoices')
        .select('id')
        .eq('charge_id', _hitoActual.id)
        .eq('is_void', false)
        .maybeSingle()

    let issuedRow = null
    if (_modoReemision && existente) {
        // Re-emisión: anular registro anterior e insertar el nuevo con el mismo número
        await _supabase.from('issued_invoices').update({ is_void: true }).eq('id', existente.id)
        const { data, error: errIns } = await _supabase
            .from('issued_invoices').insert(issuedPayload).select('id').single()
        if (errIns) console.error('Error al registrar re-emisión en libro de facturas:', errIns.message)
        else issuedRow = data
    } else if (existente) {
        const { data, error: errUpd } = await _supabase
            .from('issued_invoices').update(issuedPayload).eq('id', existente.id).select('id').single()
        if (errUpd) { alert('Error al actualizar el registro de factura: ' + errUpd.message); return }
        else issuedRow = data
    } else {
        const { data, error: errIns } = await _supabase
            .from('issued_invoices').insert(issuedPayload).select('id').single()
        if (errIns) console.error('Error al registrar en libro de facturas emitidas:', errIns.message)
        else issuedRow = data
    }

    if (issuedRow) {
        await _supabase.from('issued_invoice_vat_lines').delete().eq('invoice_id', issuedRow.id)
        await _supabase.from('issued_invoice_vat_lines').insert({
            invoice_id:  issuedRow.id,
            base_amount: base,
            vat_rate:    PERFIL_FISCAL.iva_rate,
            vat_amount:  Math.round(base * PERFIL_FISCAL.iva_rate / 100 * 100) / 100,
        })
    }

    _modoReemision = false
    document.dispatchEvent(new CustomEvent('facturaEmitida', { detail: { hitoId: _hitoActual.id } }))
}

// ===== GENERACIÓN DEL PDF con jsPDF puro =====
async function generarPDF({ svcLabels = [] } = {}) {
    if (!window.jspdf) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
    }

    const { jsPDF } = window.jspdf
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

    // Leer campos editables de la previsualización
    const preview  = document.getElementById('factura-preview')
    const concepto = preview.querySelector('[data-field="concepto"]')?.textContent?.trim() || _hitoActual.comments
    const nifCli   = preview.querySelector('[data-field="nif"]')?.textContent?.trim()     || _cliente.nif     || ''
    const addrCli  = preview.querySelector('[data-field="address"]')?.textContent?.trim() || _cliente.address || ''
    const nameCli  = preview.querySelector('[data-field="name"]')?.textContent?.trim()    || _cliente.company || _cliente.name || _cliente.id
    const fechaTxt = preview.querySelector('.factura-meta .factura-editable')?.textContent?.trim() || new Date().toLocaleDateString('es-ES')

    const irpfRate   = irpfRateParaCliente(_cliente)
    const base       = parseFloat(_hitoActual.amount)
    const iva        = base * PERFIL_FISCAL.iva_rate / 100
    const irpf       = base * irpfRate / 100
    const totalPagar = base + iva - irpf
    const tipo       = tipoFactura()
    const simplified  = _efectivaSimplificada()

    // Colores
    const ROJO     = [179, 0, 0]
    const NEGRO    = [34, 34, 34]
    const GRIS     = [119, 119, 119]
    const BGFOOTER = [249, 240, 240]

    const W     = 210
    const H     = 297
    const M     = 14
    const CW    = W - M * 2
    const PIE_H = 12   // altura del pie
    const PIE_Y = H - M - PIE_H  // Y donde empieza el pie en cada página
    let y       = M

    // ── Helpers ───────────────────────────────────────────────────────────────
    const setColor = rgb => doc.setTextColor(...rgb)
    const setFill  = rgb => doc.setFillColor(...rgb)
    const setDraw  = rgb => doc.setDrawColor(...rgb)
    const rectFill = (x, yy, w, h, rgb) => { setFill(rgb); doc.rect(x, yy, w, h, 'F') }
    const line     = (x1, y1, x2, y2, rgb, lw = 0.3) => {
        doc.setLineWidth(lw); setDraw(rgb); doc.line(x1, y1, x2, y2)
    }

    // ── Marca de agua (logo semitransparente esquina inferior derecha) ─────────
    const dibujarMarcaAgua = () => {
        if (!_logoBase64) return
        try {
            doc.saveGraphicsState()
            doc.setGState(new doc.GState({ opacity: 0.07 }))
            const lw = 90
            const lh = lw / 0.537
            doc.addImage(_logoBase64, 'PNG', W - M - lw + 10, H - lh - 5, lw, lh)
            doc.restoreGraphicsState()
        } catch { /* sin marca de agua si GState no disponible */ }
    }

    // ── Cabecera (dos líneas rojas + logo + meta) ─────────────────────────────
    const CAB_H = 30  // altura total de la cabecera incluyendo ambas líneas rojas
    const dibujarCabecera = () => {
        rectFill(M, y, CW, 0.6, ROJO)
        y += 3

        const AREA_H  = 22
        const yMid    = y + AREA_H / 2
        const yMetaT  = y + 2

        // Meta derecha — pegada arriba
        doc.setFontSize(15); doc.setFont('helvetica', 'bold'); setColor(ROJO)
        doc.text(_numFacturaSig, W - M, yMetaT + 5, { align: 'right' })
        doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(GRIS)
        doc.text(`Fecha: ${fechaTxt}`, W - M, yMetaT + 11, { align: 'right' })
        doc.text(simplified ? 'FACTURA SIMPLIFICADA' : 'FACTURA', W - M, yMetaT + 15.5, { align: 'right' })

        // Logo + nombre izquierda — centrado verticalmente
        if (_logoBase64) {
            const lh = 18
            const lw = lh * 0.537
            doc.addImage(_logoBase64, 'PNG', M, y + (AREA_H - lh) / 2, lw, lh)
            const tx = M + lw + 3
            doc.setFontSize(13); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
            doc.text('Vive San Fermin desde dentro', tx, yMid)
            doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(ROJO)
            doc.text(FACTURA_CONFIG.web, tx, yMid + 5)
        } else {
            doc.setFontSize(14); doc.setFont('helvetica', 'bold'); setColor(ROJO)
            doc.text('Vive San Fermin desde dentro', M, yMid)
            doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(ROJO)
            doc.text(FACTURA_CONFIG.web, M, yMid + 5)
        }

        y += AREA_H
        line(M, y, W - M, y, ROJO, 0.8)
        y += 5
    }

    // ── Pie (en cada página) ──────────────────────────────────────────────────
    const dibujarPie = () => {
        rectFill(M, PIE_Y, CW, PIE_H, BGFOOTER)
        doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(GRIS)
        doc.text(`Transferencia bancaria · ${FACTURA_CONFIG.iban}`, M + 3, PIE_Y + 7)
        setColor(ROJO)
        doc.text(FACTURA_CONFIG.web, W - M - 3, PIE_Y + 7, { align: 'right' })
    }

    // ── Salto de página con cabecera y pie ────────────────────────────────────
    // needed: mm que necesita el siguiente bloque
    const checkPage = (needed) => {
        if (y + needed > PIE_Y - 4) {
            dibujarPie()
            doc.addPage()
            y = M
            dibujarMarcaAgua()
            dibujarCabecera()
        }
    }

    // ── Cabecera tabla de reservas (se repite al saltar de página) ────────────
    const dibujarCabTablaRsv = () => {
        line(M, y, W - M, y, [180, 180, 180], 0.4)
        doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(GRIS)
        doc.text('SERVICIO',  M + 2,        y + 5)
        doc.text('PLAZAS',   M + CW * 0.6,  y + 5, { align: 'center' })
        doc.text('EURO/PZA', M + CW * 0.78, y + 5, { align: 'right' })
        doc.text('SUBTOTAL', W - M - 2,     y + 5, { align: 'right' })
        y += 7
        line(M, y, W - M, y, [180, 180, 180], 0.4)
        y += 1
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PÁGINA 1
    // ═══════════════════════════════════════════════════════════════════════════
    dibujarMarcaAgua()
    dibujarCabecera()

    // ── Partes: Emisor | Cliente ──────────────────────────────────────────────
    const colMid = M + CW / 2
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
    doc.text('EMISOR', M, y)
    if (!simplified) doc.text('CLIENTE', colMid, y)
    y += 4

    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
    doc.text(FACTURA_CONFIG.emisor_nombre, M, y)
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(GRIS)
    doc.text(`NIF: ${FACTURA_CONFIG.emisor_nif}`, M, y + 5)
    doc.text(FACTURA_CONFIG.emisor_direccion,      M, y + 9)
    doc.text(FACTURA_CONFIG.emisor_cp_ciudad,      M, y + 13)

    if (!simplified) {
        doc.setFontSize(10); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
        doc.text(nameCli, colMid, y)
        doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(GRIS)
        doc.text(`NIF/CIF: ${nifCli}`, colMid, y + 5)
        const addrLines = doc.splitTextToSize(addrCli, CW / 2 - 4)
        doc.text(addrLines, colMid, y + 9)
    }

    y += 22
    line(M, y, W - M, y, [200, 200, 200], 0.35)
    y += 6

    // ── Tipo de hito ──────────────────────────────────────────────────────────
    const etiquetaTipo = tipo === 'adelanto' ? 'PAGO ANTICIPADO' : 'COBRO FINAL'
    checkPage(20)
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
    doc.text(etiquetaTipo, M, y)
    y += 4

    // Cabecera tabla concepto
    rectFill(M, y, CW, 7, [240, 240, 240])
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(ROJO)
    doc.text('DESCRIPCIÓN', M + 2, y + 4.5)
    doc.text('IMPORTE', W - M - 2, y + 4.5, { align: 'right' })
    y += 7

    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); setColor(NEGRO)
    const concLines = doc.splitTextToSize(concepto, CW - 30)
    doc.text(concLines, M + 2, y + 5)
    doc.text(fmt(base), W - M - 2, y + 5, { align: 'right' })
    y += Math.max(8, concLines.length * 5) + 4

    line(M, y, W - M, y, [200, 200, 200], 0.35)
    y += 5

    // ── Detalle de reservas (con paginación fila a fila) ──────────────────────
    const nivelDetalle    = document.getElementById('selectNivelDetalle')?.value ?? 'detalle'
    const reservasValidas = _reservas.filter(r => r.status !== 'Cancelada')
    const totalGlobal     = reservasValidas.reduce((s, r) => s + parseFloat(r.total_amount ?? 0), 0)

    if (nivelDetalle === 'detalle' && reservasValidas.length > 0) {
        checkPage(20)
        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
        doc.text('DETALLE DE SERVICIOS CONTRATADOS', M, y)
        y += 4

        dibujarCabTablaRsv()

        reservasValidas.forEach((r, i) => {
            // Si no cabe la fila, saltar página y repetir cabecera de tabla
            if (y + 7 > PIE_Y - 4) {
                dibujarPie()
                doc.addPage()
                y = M
                dibujarMarcaAgua()
                dibujarCabecera()
                doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
                doc.text('DETALLE DE SERVICIOS CONTRATADOS (cont.)', M, y)
                y += 4
                dibujarCabTablaRsv()
            }

            doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(NEGRO)
            const svcLabel = svcLabels[i] || _serviceLabel(r)
            const svcLines = doc.splitTextToSize(svcLabel, CW * 0.55)
            doc.text(svcLines,                             M + 2,         y + 4)
            doc.text(String(r.slots),                      M + CW * 0.6,  y + 4, { align: 'center' })
            doc.text(fmt(parseFloat(r.price_per_slot)),    M + CW * 0.78, y + 4, { align: 'right' })
            doc.text(fmt(parseFloat(r.total_amount ?? 0)), W - M - 2,     y + 4, { align: 'right' })
            y += 6
            line(M, y, W - M, y, [200, 200, 200], 0.35)
        })

        // Subtotal
        checkPage(14)
        line(M, y, W - M, y, ROJO, 0.4)
        y += 5
        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
        doc.text('Total servicios contratados', M + 2, y)
        doc.text(fmt(totalGlobal), W - M - 2, y, { align: 'right' })
        y += 8

    } else if (nivelDetalle === 'resumen' && reservasValidas.length > 0) {
        // ── Resumen de reservas ──────────────────────────────
        checkPage(20)
        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
        doc.text('RESUMEN DE SERVICIOS CONTRATADOS', M, y)
        y += 4

        const numEventos  = new Set(reservasValidas.map(r => r.service_id)).size
        const plazasTotal = reservasValidas.reduce((s, r) => s + (parseInt(r.slots) || 0), 0)

        const colW = CW / 3
        doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
        line(M, y, W - M, y, ROJO, 0.4)
        y += 5
        doc.text('Nº de eventos',   M + 2,            y)
        doc.text('Plazas totales',  M + colW + 2,     y)
        doc.text('Precio total',    M + colW * 2 + 2, y)
        y += 4
        line(M, y, W - M, y, [200, 200, 200], 0.35)
        y += 5

        doc.setFont('helvetica', 'normal')
        doc.text(String(numEventos),  M + 2,            y)
        doc.text(String(plazasTotal), M + colW + 2,     y)
        doc.text(fmt(totalGlobal),    M + colW * 2 + 2, y)
        y += 6
        line(M, y, W - M, y, ROJO, 0.4)
        y += 8
    }

    // Nota de anticipo o liquidación — siempre se muestran, independiente del nivel de detalle
    if (tipo === 'adelanto') {
        checkPage(18)
        rectFill(M, y, 0.8, 14, ROJO)
        doc.setFontSize(8); doc.setFont('helvetica', 'italic'); setColor(GRIS)
        const nota = `Pago parcial a cuenta del total de servicios contratados (${fmt(totalGlobal)}). Este anticipo no incluye la prestacion del servicio, que se realizara durante San Fermin ${anioTemporada()} (6-14 de julio).`
        const notaLines = doc.splitTextToSize(nota, CW - 8)
        doc.text(notaLines, M + 4, y + 4)
        y += notaLines.length * 4.5 + 6

    } else if (tipo === 'unico') {
        const ajustes = _charges.filter(c => c.charge_type === 'ajuste')
        if (ajustes.length > 0 && (nivelDetalle === 'detalle' || nivelDetalle === 'resumen')) {
            checkPage(8 + ajustes.length * 6)
            ajustes.forEach(c => {
                doc.setFontSize(8); doc.setFont('helvetica', 'italic'); setColor(GRIS)
                doc.text(valorO(c.comments, 'Ajuste'), M + 2, y + 4)
                doc.text(`+ ${fmt(parseFloat(c.amount))}`, W - M - 2, y + 4, { align: 'right' })
                y += 6
                line(M, y - 1, W - M, y - 1, [220, 220, 220], 0.2)
            })
            y += 2
        }
    } else if (tipo === 'liquidacion') {
        const facturados = _charges.filter(c => c.invoiced && c.id !== _hitoActual.id && c.invoice_number && c.charge_type !== 'ajuste')

        checkPage(10 + facturados.length * 6 + 20)

        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
        doc.text('LIQUIDACION Y PAGOS ANTERIORES', M, y)
        y += 5
        line(M, y, W - M, y, [200, 200, 200], 0.35)
        y += 4

        doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(GRIS)
        doc.text('Total servicios contratados', M + 2, y)
        doc.text(fmt(totalGlobal), W - M - 2, y, { align: 'right' })
        y += 6

        facturados.forEach(c => {
            line(M, y - 1, W - M, y - 1, [220, 220, 220], 0.2)
            doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(GRIS)
            doc.text(`${valorO(c.comments, 'Prepago')} (${c.invoice_number} · ${formatFecha(c.invoiced_at)})`, M + 2, y + 4)
            doc.text(`- ${fmt(parseFloat(c.amount))}`, W - M - 2, y + 4, { align: 'right' })
            y += 6
        })

        line(M, y, W - M, y, ROJO, 0.4)
        y += 5
        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
        doc.text('Saldo pendiente (este hito)', M + 2, y)
        doc.text(fmt(base), W - M - 2, y, { align: 'right' })
        y += 8
    }

    // ── Totales ───────────────────────────────────────────────────────────────
    checkPage(40)
    line(M, y, W - M, y, [180, 180, 180], 0.4)
    y += 4

    const xL = W - M - 75
    const xV = W - M - 2

    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(GRIS)
    doc.text('Base imponible',                           xL, y + 6)
    doc.text(fmt(base),                                  xV, y + 6,  { align: 'right' })
    doc.text(`IVA (${PERFIL_FISCAL.iva_rate}%)`,         xL, y + 12)
    doc.text(`+ ${fmt(iva)}`,                            xV, y + 12, { align: 'right' })

    let yOff = 18
    if (irpfRate > 0) {
        doc.text(`Retencion IRPF (${irpfRate}%)`,        xL, y + yOff)
        doc.text(`- ${fmt(irpf)}`,                       xV, y + yOff, { align: 'right' })
        yOff += 6
    }

    line(xL, y + yOff, W - M, y + yOff, ROJO, 0.6)
    yOff += 2

    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
    doc.text('TOTAL A PAGAR',  xL, y + yOff + 6)
    doc.text(fmt(totalPagar),  xV, y + yOff + 6, { align: 'right' })
    y += yOff + 11

    // ── Pie en la última página ───────────────────────────────────────────────
    dibujarPie()

    // ── Guardar ───────────────────────────────────────────────────────────────
    const nombreArchivo = `${_numFacturaSig.replace('/', '-')}_${valorO(_cliente.company, valorO(_cliente.name, _cliente.id)).replace(/\s+/g, '_')}.pdf`
    doc.save(nombreArchivo)
    return { blob: doc.output('blob'), nombreArchivo }
}

// ── Logo base64 ───────────────────────────────────────────────────────────────
function _cargarLogoBase64() {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
        try {
            const canvas  = document.createElement('canvas')
            canvas.width  = img.naturalWidth
            canvas.height = img.naturalHeight
            canvas.getContext('2d').drawImage(img, 0, 0)
            _logoBase64 = canvas.toDataURL('image/png')
        } catch { _logoBase64 = null }
    }
    img.onerror = () => { _logoBase64 = null }
    img.src = LOGO_URL
}

// ===== APERTURA / CIERRE DEL PANEL =====
function abrirPanel() {
    document.getElementById('dialogFactura').showModal()
}

function cerrarPanel() {
    _modoReemision      = false
    _simplificadaManual = null
    document.getElementById('dialogFactura').close()
}

// ===== UTILIDADES =====
const fmt = n => parseFloat(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })

function formatFecha(iso) {
    if (!iso) return '-'
    const [, m, d] = iso.split('-')
    const y = iso.split('-')[0]
    return `${d}/${m}/${y}`
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s  = document.createElement('script')
        s.src    = src
        s.onload = resolve
        s.onerror = reject
        document.head.appendChild(s)
    })
}
