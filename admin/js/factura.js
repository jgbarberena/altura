// ===== MÓDULO DE FACTURACIÓN =====
// Gestiona la generación, previsualización y emisión de facturas desde los hitos de cobro.
// Se importa desde formulario.js y necesita acceso al cliente supabase y a los datos globales.

// ===== CONFIGURACIÓN — editar aquí cuando cambien datos del emisor =====
const FACTURA_CONFIG = {
    emisor_nombre:    'Paula Díaz Echalecu',
    emisor_nif:       '72694758S',
    emisor_direccion: 'Calle Adela Bazo 2, 2G',
    emisor_cp_ciudad: '31006 Pamplona',
    iban:             'ES44 2100 2174 2502 0022 5124',
    web:              'experienciasanfermin.com',
    serie:            'VSF',    // Prefijo de serie: VSF-NN/AAAA
    iva:              0.21,     // 21% — cambiar aquí si varía
    irpf:             0.15,     // 15% — cambiar aquí si varía
    email_asunto_tpl: (num, fecha) =>
        `Factura ${num} — ${fecha} — Vive San Fermín a medida (www.experienciasanfermin.com)`,
    email_cuerpo_tpl: (nombreCliente, numFactura, totalAPagar) =>
        `Estimado/a ${nombreCliente},\n\nAdjunto encontrará la factura ${numFactura} por importe de ${totalAPagar}.\n\nQuedamos a su disposición para cualquier consulta.\n\nUn saludo,\nPaula Díaz Echalecu\nVive San Fermín a medida\nwww.experienciasanfermin.com`,
}

// URL del logo — ruta relativa desde /admin/
const LOGO_URL = '../img/logos/sanfermin-logo-red.png'

// ===== ESTADO DEL MÓDULO =====
let _supabase      = null  // cliente Supabase inyectado al inicializar
let _hitoActual    = null  // charge completo que se está facturando
let _reservas      = []    // reservas del cliente actual (con sus charges)
let _cliente       = null  // objeto cliente actual
let _numFacturaSig = null  // número de factura calculado para este ejercicio
let _logoBase64    = null  // logo en base64 para el PDF (se carga al inicializar)

// ===== TIPOS DE FACTURA =====
// 'adelanto'   — pago parcial, quedan hitos pendientes
// 'liquidacion'— pago final con adelantos previos ya facturados
// 'unico'      — pago único sin adelantos previos (cobro total en un solo hito)
function tipoFactura() {
    const esHitoFinal    = _reservas[0]?._esFinal ?? false
    const todosCharges   = _reservas[0]?._charges ?? []
    const facturadosPrev = todosCharges.filter(c => c.invoiced && c.id !== _hitoActual.id)
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
    document.getElementById('btnEmitirFactura').addEventListener('click', emitirFactura)

    // Cerrar al pulsar en el backdrop (fuera del contenido del dialog)
    dialog.addEventListener('click', e => {
        const r = dialog.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX > r.right ||
            e.clientY < r.top  || e.clientY > r.bottom)
            dialog.close()
    })
}

// ===== PUNTO DE ENTRADA =====
export async function abrirPanelFactura(hitoId, clienteObj, reservasCliente) {
    _cliente  = clienteObj
    _reservas = reservasCliente

    const { data: hito, error } = await _supabase
        .from('charges').select('*').eq('id', hitoId).single()
    if (error || !hito) { alert('Error al cargar el hito: ' + (error?.message ?? 'no encontrado')); return }
    _hitoActual = hito

    _numFacturaSig = await calcularSiguienteNumero()
    renderPanelFactura()
    abrirPanel()
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

// ===== RENDERIZADO DEL PANEL =====
function renderPanelFactura() {
    document.getElementById('panel-factura-subtitulo').textContent =
        `Hito: ${_hitoActual.comments ?? '—'}  ·  ${fmt(_hitoActual.amount)}`

    const alerta          = document.getElementById('panel-factura-alerta')
    const camposFaltantes = []
    if (!_cliente.nif)     camposFaltantes.push('NIF/CIF del cliente')
    if (!_cliente.address) camposFaltantes.push('dirección del cliente')
    if (camposFaltantes.length > 0) {
        alerta.style.display = 'block'
        alerta.textContent   = `⚠️ Faltan datos editables: ${camposFaltantes.join(', ')}. Puedes completarlos directamente en la factura.`
    } else {
        alerta.style.display = 'none'
    }

    document.getElementById('panel-factura-contenido').innerHTML = buildFacturaHTML()
}

// ===== HTML DE LA FACTURA (previsualización en panel) =====
function buildFacturaHTML() {
    const tipo       = tipoFactura()
    const base       = parseFloat(_hitoActual.amount)
    const iva        = base * FACTURA_CONFIG.iva
    const irpf       = base * FACTURA_CONFIG.irpf
    const totalPagar = base + iva - irpf
    const fechaHoy   = new Date().toLocaleDateString('es-ES')

    const etiquetaTipo = tipo === 'adelanto' ? 'Pago anticipado' : 'Cobro final'

    return `
    <div class="factura-doc" id="factura-preview">
        <img class="factura-watermark" src="${LOGO_URL}" alt="">
        <div class="factura-inner">

            <div class="factura-header">
                <div class="factura-brand">
                    <img class="factura-logo" src="${LOGO_URL}" alt="Logo Vive San Fermín" style="height:52px;width:auto">
                    <div>
                        <div class="factura-brand-name">Vive San Fermín a medida</div>
                        <div class="factura-brand-web">${FACTURA_CONFIG.web}</div>
                    </div>
                </div>
                <div class="factura-meta" style="align-self:flex-start;padding-top:2px">
                    <div class="factura-num">${_numFacturaSig}</div>
                    <div>Fecha: <span class="factura-editable" contenteditable="true">${fechaHoy}</span></div>
                    <div class="factura-tipo">FACTURA</div>
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
                <div class="factura-party">
                    <div class="factura-party-label">Cliente</div>
                    <div class="factura-party-name factura-editable" contenteditable="true"
                        data-field="name">${_cliente.name ?? _cliente.id}</div>
                    <div class="factura-party-detail">
                        NIF/CIF: <span class="factura-editable" contenteditable="true"
                            data-field="nif">${_cliente.nif ?? '— introducir NIF —'}</span><br>
                        <span class="factura-editable" contenteditable="true"
                            data-field="address">${_cliente.address ?? '— introducir dirección —'}</span>
                    </div>
                </div>
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
                                data-field="concepto">${_hitoActual.comments ?? 'Pago'}</span>
                            <span style="font-size:10px;color:#aaa;margin-left:6px">(editable)</span>
                        </td>
                        <td>${fmt(base)}</td>
                    </tr></tbody>
                </table>

                <div class="factura-section-label" style="margin-top:14px">Detalle de servicios contratados</div>
                ${buildTablaReservas()}
                ${tipo === 'adelanto' ? buildNota() : tipo === 'liquidacion' ? buildLiquidacion() : ''}
            </div>

            <div class="factura-totales">
                <div class="factura-totales-grid">
                    <div class="factura-tot-row"><span>Base imponible</span><span>${fmt(base)}</span></div>
                    <div class="factura-tot-row">
                        <span>IVA (${Math.round(FACTURA_CONFIG.iva * 100)}%)</span>
                        <span>+ ${fmt(iva)}</span>
                    </div>
                    <div class="factura-tot-row">
                        <span>Retención IRPF (${Math.round(FACTURA_CONFIG.irpf * 100)}%)</span>
                        <span>- ${fmt(irpf)}</span>
                    </div>
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

// Tabla de reservas — usada en HTML y en PDF
function buildTablaReservas() {
    const reservasValidas = _reservas.filter(r => r.status !== 'Cancelada')
    if (reservasValidas.length === 0) return ''
    const totalGlobal = reservasValidas.reduce((s, r) => s + parseFloat(r.total_amount ?? 0), 0)
    const filas = reservasValidas.map(r => `
        <tr>
            <td>${r.service_id}</td>
            <td style="text-align:center">${r.slots}</td>
            <td style="text-align:right">${fmt(parseFloat(r.price_per_slot))}</td>
            <td style="text-align:right">${fmt(parseFloat(r.total_amount ?? 0))}</td>
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
            <tr class="factura-rsv-subtotal">
                <td colspan="3" style="text-align:right;font-size:11px;color:#777">Total servicios contratados</td>
                <td style="text-align:right">${fmt(totalGlobal)}</td>
            </tr>
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
        durante San Fermín 2026 (6–14 de julio).
    </div>`
}

// Bloque liquidación: solo cuando hay adelantos previos facturados
function buildLiquidacion() {
    const totalGlobal  = _reservas
        .filter(r => r.status !== 'Cancelada')
        .reduce((s, r) => s + parseFloat(r.total_amount ?? 0), 0)
    const todosCharges = _reservas[0]?._charges ?? []
    const facturados   = todosCharges.filter(c => c.invoiced && c.id !== _hitoActual.id && c.invoice_number)
    const filasF       = facturados.map(c => `
        <div class="factura-liq-row">
            <span class="factura-liq-label">
                ${c.comments ?? 'Prepago'} (${c.invoice_number} · ${formatFecha(c.invoiced_at)})
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
        ${filasF}
        <div class="factura-liq-row">
            <span><strong>Saldo pendiente (este hito)</strong></span>
            <span><strong>${fmt(parseFloat(_hitoActual.amount))}</strong></span>
        </div>
    </div>`
}

// ===== EMISIÓN =====
async function emitirFactura() {
    const preview  = document.getElementById('factura-preview')
    const concepto = preview.querySelector('[data-field="concepto"]')?.textContent?.trim() || _hitoActual.comments
    const nifEdit  = preview.querySelector('[data-field="nif"]')?.textContent?.trim()
    const addrEdit = preview.querySelector('[data-field="address"]')?.textContent?.trim()
    const nameEdit = preview.querySelector('[data-field="name"]')?.textContent?.trim()

    const updates = {}
    if (nifEdit  && nifEdit  !== _cliente.nif    && !nifEdit.includes('—'))  updates.nif     = nifEdit
    if (addrEdit && addrEdit !== _cliente.address && !addrEdit.includes('—')) updates.address = addrEdit
    if (nameEdit && nameEdit !== (_cliente.name ?? _cliente.id))              updates.name    = nameEdit

    if (Object.keys(updates).length > 0) {
        const { error } = await _supabase.from('clients').update(updates).eq('id', _cliente.id)
        if (error) { alert('Error al guardar datos del cliente: ' + error.message); return }
        Object.assign(_cliente, updates)
    }

    const hoy = new Date().toISOString().split('T')[0]
    const { error: errCharge } = await _supabase
        .from('charges')
        .update({ invoiced: true, invoiced_at: hoy, invoice_number: _numFacturaSig, comments: concepto })
        .eq('id', _hitoActual.id)
    if (errCharge) { alert('Error al marcar como facturado: ' + errCharge.message); return }

    await generarPDF()
    abrirMailto()
    document.dispatchEvent(new CustomEvent('facturaEmitida', { detail: { hitoId: _hitoActual.id } }))
    cerrarPanel()
}

// ===== GENERACIÓN DEL PDF con jsPDF puro =====
async function generarPDF() {
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
    const nameCli  = preview.querySelector('[data-field="name"]')?.textContent?.trim()    || _cliente.name    || _cliente.id
    const fechaTxt = preview.querySelector('.factura-meta .factura-editable')?.textContent?.trim() || new Date().toLocaleDateString('es-ES')

    const base       = parseFloat(_hitoActual.amount)
    const iva        = base * FACTURA_CONFIG.iva
    const irpf       = base * FACTURA_CONFIG.irpf
    const totalPagar = base + iva - irpf
    const tipo       = tipoFactura()

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
        doc.text('FACTURA', W - M, yMetaT + 15.5, { align: 'right' })

        // Logo + nombre izquierda — centrado verticalmente
        if (_logoBase64) {
            const lh = 18
            const lw = lh * 0.537
            doc.addImage(_logoBase64, 'PNG', M, y + (AREA_H - lh) / 2, lw, lh)
            const tx = M + lw + 3
            doc.setFontSize(13); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
            doc.text('Vive San Fermin a medida', tx, yMid)
            doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(ROJO)
            doc.text(FACTURA_CONFIG.web, tx, yMid + 5)
        } else {
            doc.setFontSize(14); doc.setFont('helvetica', 'bold'); setColor(ROJO)
            doc.text('Vive San Fermin a medida', M, yMid)
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
    doc.text('CLIENTE', colMid, y)
    y += 4

    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
    doc.text(FACTURA_CONFIG.emisor_nombre, M, y)
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(GRIS)
    doc.text(`NIF: ${FACTURA_CONFIG.emisor_nif}`, M, y + 5)
    doc.text(FACTURA_CONFIG.emisor_direccion,      M, y + 9)
    doc.text(FACTURA_CONFIG.emisor_cp_ciudad,      M, y + 13)

    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
    doc.text(nameCli, colMid, y)
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(GRIS)
    doc.text(`NIF/CIF: ${nifCli}`, colMid, y + 5)
    const addrLines = doc.splitTextToSize(addrCli, CW / 2 - 4)
    doc.text(addrLines, colMid, y + 9)

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
    const reservasValidas = _reservas.filter(r => r.status !== 'Cancelada')
    if (reservasValidas.length > 0) {
        checkPage(20)
        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
        doc.text('DETALLE DE SERVICIOS CONTRATADOS', M, y)
        y += 4

        dibujarCabTablaRsv()

        let totalGlobal = 0
        reservasValidas.forEach(r => {
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
            const svcLines = doc.splitTextToSize(r.service_id, CW * 0.55)
            doc.text(svcLines,                          M + 2,         y + 4)
            doc.text(String(r.slots),                   M + CW * 0.6,  y + 4, { align: 'center' })
            doc.text(fmt(parseFloat(r.price_per_slot)), M + CW * 0.78, y + 4, { align: 'right' })
            const sub = parseFloat(r.total_amount ?? 0)
            doc.text(fmt(sub),                          W - M - 2,     y + 4, { align: 'right' })
            totalGlobal += sub
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

        // Bloque inferior según tipo
        if (tipo === 'adelanto') {
            checkPage(18)
            rectFill(M, y, 0.8, 14, ROJO)
            doc.setFontSize(8); doc.setFont('helvetica', 'italic'); setColor(GRIS)
            const nota = `Pago parcial a cuenta del total de servicios contratados (${fmt(totalGlobal)}). Este anticipo no incluye la prestacion del servicio, que se realizara durante San Fermin 2026 (6-14 de julio).`
            const notaLines = doc.splitTextToSize(nota, CW - 8)
            doc.text(notaLines, M + 4, y + 4)
            y += notaLines.length * 4.5 + 6

        } else if (tipo === 'liquidacion') {
            const todosCharges = _reservas[0]?._charges ?? []
            const facturados   = todosCharges.filter(c => c.invoiced && c.id !== _hitoActual.id && c.invoice_number)

            checkPage(10 + facturados.length * 6 + 20)

            // Título del bloque
            doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
            doc.text('LIQUIDACION Y PAGOS ANTERIORES', M, y)
            y += 5
            line(M, y, W - M, y, [200, 200, 200], 0.35)
            y += 4

            // Total contratado
            doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(GRIS)
            doc.text('Total servicios contratados', M + 2, y)
            doc.text(fmt(totalGlobal), W - M - 2, y, { align: 'right' })
            y += 6

            facturados.forEach(c => {
                line(M, y - 1, W - M, y - 1, [220, 220, 220], 0.2)
                doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(GRIS)
                doc.text(`${c.comments ?? 'Prepago'} (${c.invoice_number} · ${formatFecha(c.invoiced_at)})`, M + 2, y + 4)
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
        // tipo === 'unico': sin bloque adicional, el detalle ya es suficiente
    }

    // ── Totales ───────────────────────────────────────────────────────────────
    checkPage(40)
    line(M, y, W - M, y, [180, 180, 180], 0.4)
    y += 4

    const xL = W - M - 75
    const xV = W - M - 2

    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(GRIS)
    doc.text('Base imponible',                                     xL, y + 6)
    doc.text(fmt(base),                                            xV, y + 6,  { align: 'right' })
    doc.text(`IVA (${Math.round(FACTURA_CONFIG.iva  * 100)}%)`,   xL, y + 12)
    doc.text(`+ ${fmt(iva)}`,                                      xV, y + 12, { align: 'right' })
    doc.text(`Retencion IRPF (${Math.round(FACTURA_CONFIG.irpf * 100)}%)`, xL, y + 18)
    doc.text(`- ${fmt(irpf)}`,                                     xV, y + 18, { align: 'right' })

    line(xL, y + 20, W - M, y + 20, ROJO, 0.6)

    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
    doc.text('TOTAL A PAGAR', xL, y + 27)
    doc.text(fmt(totalPagar), xV, y + 27, { align: 'right' })
    y += 32

    // ── Pie en la última página ───────────────────────────────────────────────
    dibujarPie()

    // ── Guardar ───────────────────────────────────────────────────────────────
    const nombreArchivo = `${_numFacturaSig.replace('/', '-')}_${(_cliente.name ?? _cliente.id).replace(/\s+/g, '_')}.pdf`
    doc.save(nombreArchivo)
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

// ===== APERTURA DEL CLIENTE DE CORREO =====
function abrirMailto() {
    const base       = parseFloat(_hitoActual.amount)
    const totalPagar = base + base * FACTURA_CONFIG.iva - base * FACTURA_CONFIG.irpf
    const email      = _cliente.email ?? ''
    const nombre     = _cliente.name  ?? _cliente.id
    const asunto     = encodeURIComponent(FACTURA_CONFIG.email_asunto_tpl(_numFacturaSig, new Date().toLocaleDateString('es-ES')))
    const cuerpo     = encodeURIComponent(FACTURA_CONFIG.email_cuerpo_tpl(nombre, _numFacturaSig, fmt(totalPagar)))
    window.location.href = `mailto:${email}?subject=${asunto}&body=${cuerpo}`
}

// ===== APERTURA / CIERRE DEL PANEL =====
function abrirPanel() {
    document.getElementById('dialogFactura').showModal()
}

function cerrarPanel() {
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