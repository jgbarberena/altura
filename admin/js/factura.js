// ===== MÓDULO DE FACTURACIÓN =====
// Gestiona la generación, previsualización y emisión de facturas desde los hitos de cobro.
// Se importa desde formulario.js y necesita acceso al cliente supabase y a los datos globales.

// ===== CONFIGURACIÓN — editar aquí cuando cambien datos del emisor =====
const FACTURA_CONFIG = {
    emisor_nombre:   'Paula Díaz Echalecu',
    emisor_nif:      '72694758S',
    emisor_direccion: 'Calle Adela Bazo 2, 2G',
    emisor_cp_ciudad: '31006 Pamplona',
    iban:            'ES44 2100 2174 2502 0022 5124',
    web:             'experienciasanfermin.com',
    serie:           'VSF',           // Prefijo de serie: VSF-NN/AAAA
    iva:             0.21,            // 21% — cambiar aquí si varía
    irpf:            0.15,            // 15% — cambiar aquí si varía
    email_asunto_tpl: (num, fecha) =>
        `Factura ${num} — ${fecha} — Vive San Fermín a medida (www.experienciasanfermin.com)`,
    email_cuerpo_tpl: (nombreCliente, numFactura, totalAPagar) =>
        `Estimado/a ${nombreCliente},\n\nAdjunto encontrará la factura ${numFactura} por importe de ${totalAPagar}.\n\nQuedamos a su disposición para cualquier consulta.\n\nUn saludo,\nPaula Díaz Echalecu\nVive San Fermín a medida\nwww.experienciasanfermin.com`,
}

// URL del logo — ruta relativa desde /admin/
const LOGO_URL = '../img/logos/sanfermin-logo-red.png'

// ===== ESTADO DEL MÓDULO =====
let _supabase       = null   // cliente Supabase inyectado al inicializar
let _hitoActual     = null   // charge completo que se está facturando
let _reservas       = []     // reservas del cliente actual (con sus charges)
let _cliente        = null   // objeto cliente actual
let _numFacturaSig  = null   // número de factura calculado para este ejercicio

// ===== INICIALIZACIÓN =====
// Debe llamarse desde formulario.js pasando el cliente supabase
export function initFacturacion(supabaseClient) {
    _supabase = supabaseClient
    _cargarLogoBase64()

    document.getElementById('btnCerrarFactura').addEventListener('click', cerrarPanel)
    document.getElementById('btnCancelarFactura').addEventListener('click', cerrarPanel)
    document.getElementById('overlay-factura').addEventListener('click', cerrarPanel)
    document.getElementById('btnEmitirFactura').addEventListener('click', emitirFactura)
}

// ===== PUNTO DE ENTRADA — llamado desde la tabla de cobros =====
// hitoId: id del charge; clienteObj: objeto cliente; reservasCliente: array de reservas con charges
export async function abrirPanelFactura(hitoId, clienteObj, reservasCliente) {
    _cliente  = clienteObj
    _reservas = reservasCliente

    // Cargar el hito completo desde Supabase
    const { data: hito, error } = await _supabase
        .from('charges').select('*').eq('id', hitoId).single()
    if (error || !hito) { alert('Error al cargar el hito: ' + (error?.message ?? 'no encontrado')); return }
    _hitoActual = hito

    // Calcular número de factura siguiente para la serie VSF en el año actual
    _numFacturaSig = await calcularSiguienteNumero()

    // Renderizar la previsualización
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

    // Extraer el número secuencial máximo y sumar 1
    const maxNum = data.reduce((max, row) => {
        const match = row.invoice_number?.match(/-(\d+)\//)
        const n     = match ? parseInt(match[1]) : 0
        return n > max ? n : max
    }, 0)

    return `${FACTURA_CONFIG.serie}-${String(maxNum + 1).padStart(2, '0')}/${anio}`
}

// ===== RENDERIZADO DEL PANEL =====
function renderPanelFactura() {
    // Subtítulo del panel
    document.getElementById('panel-factura-subtitulo').textContent =
        `Hito: ${_hitoActual.comments ?? '—'}  ·  ${fmt(_hitoActual.amount)}`

    // Alerta de campos pendientes si el cliente no tiene NIF o dirección
    const alerta = document.getElementById('panel-factura-alerta')
    const camposFaltantes = []
    if (!_cliente.nif)     camposFaltantes.push('NIF/CIF del cliente')
    if (!_cliente.address) camposFaltantes.push('dirección del cliente')
    if (camposFaltantes.length > 0) {
        alerta.style.display = 'block'
        alerta.textContent   = `⚠️ Faltan datos editables: ${camposFaltantes.join(', ')}. Puedes completarlos directamente en la factura.`
    } else {
        alerta.style.display = 'none'
    }

    // Generar HTML de la factura
    document.getElementById('panel-factura-contenido').innerHTML = buildFacturaHTML()
}

// ===== CONSTRUCCIÓN DEL HTML DE LA FACTURA =====
function buildFacturaHTML() {
    const esLiqFinal = detectarLiquidacionFinal()
    const base       = parseFloat(_hitoActual.amount)
    const iva        = base * FACTURA_CONFIG.iva
    const irpf       = base * FACTURA_CONFIG.irpf
    const totalPagar = base + iva - irpf
    const fechaHoy   = new Date().toLocaleDateString('es-ES')

    return `
    <div class="factura-doc" id="factura-preview">
        <img class="factura-watermark" src="${LOGO_URL}" alt="">

        <div class="factura-inner">

            <!-- CABECERA -->
            <div class="factura-header">
                <div class="factura-brand">
                    <img class="factura-logo" src="${LOGO_URL}" alt="Logo Vive San Fermín">
                    <div>
                        <div class="factura-brand-name">Vive San Fermín a medida</div>
                        <div class="factura-brand-web">${FACTURA_CONFIG.web}</div>
                    </div>
                </div>
                <div class="factura-meta">
                    <div class="factura-num">${_numFacturaSig}</div>
                    <div>Fecha: <span class="factura-editable" contenteditable="true">${fechaHoy}</span></div>
                    <div class="factura-tipo">FACTURA</div>
                </div>
            </div>

            <!-- PARTES -->
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

            <!-- LÍNEA PRINCIPAL -->
            <div class="factura-section">
                <div class="factura-section-label">${esLiqFinal ? 'Liquidación final' : 'Pago anticipado'}</div>
                <table class="factura-lineas">
                    <thead><tr>
                        <th style="width:70%">Descripción</th>
                        <th>Importe</th>
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

                <!-- DETALLE DE RESERVAS -->
                <div class="factura-section-label" style="margin-top:14px">Detalle de servicios contratados</div>
                ${buildTablaReservas()}

                <!-- NOTA o LIQUIDACIÓN -->
                ${esLiqFinal ? buildLiquidacion() : buildNota()}
            </div>

            <!-- TOTALES -->
            <div class="factura-totales">
                <div class="factura-totales-grid">
                    <div class="factura-tot-row">
                        <span>Base imponible</span><span>${fmt(base)}</span>
                    </div>
                    <div class="factura-tot-row">
                        <span>IVA (${Math.round(FACTURA_CONFIG.iva * 100)}%)</span>
                        <span>+ ${fmt(iva)}</span>
                    </div>
                    <div class="factura-tot-row">
                        <span>Retención IRPF (${Math.round(FACTURA_CONFIG.irpf * 100)}%)</span>
                        <span>− ${fmt(irpf)}</span>
                    </div>
                    <div class="factura-tot-row factura-tot-final">
                        <span>TOTAL A PAGAR</span><span>${fmt(totalPagar)}</span>
                    </div>
                </div>
            </div>

            <!-- PIE -->
            <div class="factura-footer">
                <div>
                    Transferencia bancaria ·
                    <span class="factura-footer-iban">${FACTURA_CONFIG.iban}</span>
                </div>
                <div class="factura-footer-web">${FACTURA_CONFIG.web}</div>
            </div>

        </div>
    </div>`
}

// Construye la tabla de reservas del cliente con sus totales
function buildTablaReservas() {
    // Mostrar todas las reservas no canceladas del cliente
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
                <td colspan="3" style="text-align:right;font-size:11px;color:#777">
                    Total servicios contratados
                </td>
                <td style="text-align:right">${fmt(totalGlobal)}</td>
            </tr>
        </tbody>
    </table>`
}

// Nota informativa para facturas de adelanto
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

// Bloque de liquidación final: muestra prepagos ya facturados y calcula saldo
function buildLiquidacion() {
    const totalGlobal = _reservas
        .filter(r => r.status !== 'Cancelada')
        .reduce((s, r) => s + parseFloat(r.total_amount ?? 0), 0)

    // Los charges de todos el cliente vienen en _reservas[0]._charges
    // (se pasan como array completo de hitosClienteTemp desde formulario.js)
    const todosCharges = _reservas[0]?._charges ?? []
    const facturados   = todosCharges.filter(c =>
        c.invoiced && c.id !== _hitoActual.id && c.invoice_number
    )

    const totalFacturado = facturados.reduce((s, c) => s + parseFloat(c.amount), 0)

    const filasFacturados = facturados.map(c => `
        <div class="factura-liq-row">
            <span class="factura-liq-label">
                ${c.comments ?? 'Prepago'} (${c.invoice_number} · ${formatFecha(c.invoiced_at)})
            </span>
            <span>− ${fmt(parseFloat(c.amount))}</span>
        </div>`).join('')

    return `
    <div class="factura-liq">
        <div class="factura-liq-row">
            <span class="factura-liq-label">Total servicios contratados</span>
            <span>${fmt(totalGlobal)}</span>
        </div>
        ${filasFacturados}
        <div class="factura-liq-row">
            <span><strong>Saldo pendiente (este hito)</strong></span>
            <span><strong>${fmt(parseFloat(_hitoActual.amount))}</strong></span>
        </div>
    </div>`
}

// ===== DETECCIÓN DE TIPO DE HITO =====

// Determina si es liquidación final: suma de hitos facturados + éste ≈ total de reservas
function detectarLiquidacionFinal() {
    const todosCharges   = _reservas[0]?._charges ?? []
    const totalGlobal    = _reservas
        .filter(r => r.status !== 'Cancelada')
        .reduce((s, r) => s + parseFloat(r.total_amount ?? 0), 0)
    const totalFacturado = todosCharges
        .filter(c => c.invoiced && c.id !== _hitoActual.id)
        .reduce((s, c) => s + parseFloat(c.amount), 0)
    const saldo = totalGlobal - totalFacturado
    return Math.abs(saldo - parseFloat(_hitoActual.amount)) < 0.01
}

// ===== EMISIÓN =====

async function emitirFactura() {
    // Recoger campos editables que el usuario puede haber modificado
    const preview   = document.getElementById('factura-preview')
    const concepto  = preview.querySelector('[data-field="concepto"]')?.textContent?.trim() || _hitoActual.comments
    const nifEdit   = preview.querySelector('[data-field="nif"]')?.textContent?.trim()
    const addrEdit  = preview.querySelector('[data-field="address"]')?.textContent?.trim()
    const nameEdit  = preview.querySelector('[data-field="name"]')?.textContent?.trim()

    // Guardar datos editados del cliente si han cambiado
    const updates = {}
    if (nifEdit  && nifEdit  !== _cliente.nif     && !nifEdit.includes('—'))  updates.nif     = nifEdit
    if (addrEdit && addrEdit !== _cliente.address  && !addrEdit.includes('—')) updates.address = addrEdit
    if (nameEdit && nameEdit !== (_cliente.name ?? _cliente.id))               updates.name    = nameEdit

    if (Object.keys(updates).length > 0) {
        const { error } = await _supabase.from('clients').update(updates).eq('id', _cliente.id)
        if (error) { alert('Error al guardar datos del cliente: ' + error.message); return }
        Object.assign(_cliente, updates)
    }

    // Guardar en el hito: invoiced, invoiced_at, invoice_number
    const hoy = new Date().toISOString().split('T')[0]
    const { error: errCharge } = await _supabase
        .from('charges')
        .update({
            invoiced:        true,
            invoiced_at:     hoy,
            invoice_number:  _numFacturaSig,
            comments:        concepto,
        })
        .eq('id', _hitoActual.id)

    if (errCharge) { alert('Error al marcar como facturado: ' + errCharge.message); return }

    // Generar y descargar PDF
    await generarPDF()

    // Abrir cliente de correo
    abrirMailto()

    // Cerrar panel y notificar para que formulario.js recargue la tabla
    cerrarPanel()
    document.dispatchEvent(new CustomEvent('facturaEmitida', { detail: { hitoId: _hitoActual.id } }))
}

// ===== GENERACIÓN DEL PDF con jsPDF puro (sin html2canvas) =====
async function generarPDF() {
    if (!window.jspdf) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
    }

    const { jsPDF } = window.jspdf
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

    // Recoger campos editables tal como quedaron en la previsualización
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
    const esLiqFinal = detectarLiquidacionFinal()

    // Colores
    const ROJO    = [179, 0, 0]
    const NEGRO   = [34, 34, 34]
    const GRIS    = [119, 119, 119]
    const BGLIGHT = [252, 245, 245]
    const BGFOOTER= [249, 240, 240]

    const W  = 210   // ancho A4
    const M  = 14    // margen lateral
    const CW = W - M * 2  // ancho útil
    let y    = 14    // cursor vertical

    // ── Helpers ──────────────────────────────────────────────────────────────

    const setColor  = (rgb) => { doc.setTextColor(...rgb) }
    const setFill   = (rgb) => { doc.setFillColor(...rgb) }
    const setDraw   = (rgb) => { doc.setDrawColor(...rgb) }
    const rectFill  = (x, yy, w, h, rgb) => { setFill(rgb); doc.rect(x, yy, w, h, 'F') }
    const line      = (x1, y1, x2, y2, rgb, lw = 0.3) => {
        doc.setLineWidth(lw); setDraw(rgb); doc.line(x1, y1, x2, y2)
    }
    const txt = (text, x, yy, size, rgb, opts = {}) => {
        doc.setFontSize(size); setColor(rgb)
        doc.text(String(text ?? ''), x, yy, opts)
    }

    // ── LÍNEA ROJA SUPERIOR ───────────────────────────────────────────────────
    rectFill(M, y, CW, 0.6, ROJO)
    y += 6

    // ── CABECERA: marca + meta ────────────────────────────────────────────────
    // Marca izquierda
// Marca izquierda — con logo si está disponible, texto si no
    if (_logoBase64) {
        // Logo: alto 14mm, ancho proporcional (logo es aprox 0.54 de ratio ancho/alto)
        doc.addImage(_logoBase64, 'PNG', M, y - 8, 8, 14)
        doc.setFontSize(13); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
        doc.text('Vive San Fermín a medida', M + 10, y)
        doc.setFontSize(9); doc.setFont('helvetica', 'normal'); setColor(ROJO)
        doc.text(FACTURA_CONFIG.web, M + 10, y + 5)
    } else {
        doc.setFontSize(16); doc.setFont('helvetica', 'bold'); setColor(ROJO)
        doc.text('Vive San Fermín a medida', M, y)
        doc.setFontSize(9); doc.setFont('helvetica', 'normal'); setColor(ROJO)
        doc.text(FACTURA_CONFIG.web, M, y + 5)
    }

    // Meta derecha
    doc.setFontSize(15); doc.setFont('helvetica', 'bold'); setColor(ROJO)
    doc.text(_numFacturaSig, W - M, y, { align: 'right' })
    doc.setFontSize(9);  doc.setFont('helvetica', 'normal'); setColor(GRIS)
    doc.text(`Fecha: ${fechaTxt}`, W - M, y + 5, { align: 'right' })
    doc.text('FACTURA', W - M, y + 9, { align: 'right' })

    y += 16

    // ── LÍNEA ROJA SEPARADORA ─────────────────────────────────────────────────
    line(M, y, W - M, y, ROJO, 0.8)
    y += 5

    // ── PARTES: EMISOR | CLIENTE ──────────────────────────────────────────────
    const colMid = M + CW / 2

    // Etiquetas
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
    doc.text('EMISOR', M, y)
    doc.text('CLIENTE', colMid, y)
    y += 4

    // Emisor
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
    doc.text(FACTURA_CONFIG.emisor_nombre, M, y)
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(GRIS)
    doc.text(`NIF: ${FACTURA_CONFIG.emisor_nif}`, M, y + 5)
    doc.text(FACTURA_CONFIG.emisor_direccion,       M, y + 9)
    doc.text(FACTURA_CONFIG.emisor_cp_ciudad,        M, y + 13)

    // Cliente
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
    doc.text(nameCli, colMid, y)
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(GRIS)
    doc.text(`NIF/CIF: ${nifCli}`, colMid, y + 5)

    // Dirección del cliente puede ser larga — wrap
    const addrLines = doc.splitTextToSize(addrCli, CW / 2 - 4)
    doc.text(addrLines, colMid, y + 9)

    y += 22
    line(M, y, W - M, y, [220, 215, 210], 0.3)
    y += 6

    // ── SECCIÓN: TIPO DE HITO ─────────────────────────────────────────────────
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
    doc.text(esLiqFinal ? 'LIQUIDACIÓN FINAL' : 'PAGO ANTICIPADO', M, y)
    y += 4

    // Tabla de línea principal
    rectFill(M, y, CW, 7, BGLIGHT)
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(ROJO)
    doc.text('DESCRIPCIÓN', M + 2, y + 4.5)
    doc.text('IMPORTE', W - M - 2, y + 4.5, { align: 'right' })
    y += 7

    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); setColor(NEGRO)
    // Concepto puede ser largo
    const concLines = doc.splitTextToSize(concepto, CW - 30)
    doc.text(concLines, M + 2, y + 5)
    doc.text(fmt(base), W - M - 2, y + 5, { align: 'right' })
    y += Math.max(8, concLines.length * 5) + 4

    line(M, y, W - M, y, [220, 215, 210], 0.2)
    y += 5

    // ── DETALLE DE RESERVAS ───────────────────────────────────────────────────
    const reservasValidas = _reservas.filter(r => r.status !== 'Cancelada')
    if (reservasValidas.length > 0) {
        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
        doc.text('DETALLE DE SERVICIOS CONTRATADOS', M, y)
        y += 4

        // Cabecera tabla
        rectFill(M, y, CW, 6.5, BGLIGHT)
        doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(ROJO)
        doc.text('SERVICIO',  M + 2,       y + 4)
        doc.text('PLAZAS',   M + CW * 0.6, y + 4, { align: 'center' })
        doc.text('€/PLAZA',  M + CW * 0.78,y + 4, { align: 'right' })
        doc.text('SUBTOTAL', W - M - 2,    y + 4, { align: 'right' })
        y += 6.5

        let totalGlobal = 0
        reservasValidas.forEach((r, i) => {
            if (i % 2 === 0) rectFill(M, y, CW, 6, [250, 248, 248])
            doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(NEGRO)
            const svcLines = doc.splitTextToSize(r.service_id, CW * 0.55)
            doc.text(svcLines,                       M + 2,        y + 4)
            doc.text(String(r.slots),                M + CW * 0.6, y + 4, { align: 'center' })
            doc.text(fmt(parseFloat(r.price_per_slot)), M + CW * 0.78, y + 4, { align: 'right' })
            const sub = parseFloat(r.total_amount ?? 0)
            doc.text(fmt(sub),                       W - M - 2,    y + 4, { align: 'right' })
            totalGlobal += sub
            y += 6
        })

        // Subtotal
        line(M, y, W - M, y, ROJO, 0.3)
        y += 5
        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
        doc.text('Total servicios contratados', M + 2, y)
        doc.text(fmt(totalGlobal), W - M - 2, y, { align: 'right' })
        y += 8

        // Nota o liquidación
        if (esLiqFinal) {
            const todosCharges   = _reservas[0]?._charges ?? []
            const facturados     = todosCharges.filter(c => c.invoiced && c.id !== _hitoActual.id && c.invoice_number)
            const totalFacturado = facturados.reduce((s, c) => s + parseFloat(c.amount), 0)

            rectFill(M, y, CW, 6, BGLIGHT)
            doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(GRIS)
            doc.text('Total servicios contratados', M + 2, y + 4)
            doc.text(fmt(totalGlobal), W - M - 2, y + 4, { align: 'right' })
            y += 6

            facturados.forEach(c => {
                rectFill(M, y, CW, 6, [255, 255, 255])
                doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(GRIS)
                doc.text(`${c.comments ?? 'Prepago'} (${c.invoice_number} · ${formatFecha(c.invoiced_at)})`, M + 2, y + 4)
                doc.text(`− ${fmt(parseFloat(c.amount))}`, W - M - 2, y + 4, { align: 'right' })
                y += 6
            })

            line(M, y, W - M, y, ROJO, 0.4)
            y += 5
            doc.setFontSize(9); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
            doc.text('Saldo pendiente (este hito)', M + 2, y)
            doc.text(fmt(base), W - M - 2, y, { align: 'right' })
            y += 8
        } else {
            // Nota de pago anticipado
            rectFill(M, y, 0.8, 14, ROJO)
            doc.setFontSize(8); doc.setFont('helvetica', 'italic'); setColor(GRIS)
            const nota = `Pago parcial a cuenta del total de servicios contratados (${fmt(totalGlobal)}). Este anticipo no incluye la prestación del servicio, que se realizará durante San Fermín 2026 (6–14 de julio).`
            const notaLines = doc.splitTextToSize(nota, CW - 8)
            doc.text(notaLines, M + 4, y + 4)
            y += notaLines.length * 4.5 + 6
        }
    }

    // ── TOTALES ───────────────────────────────────────────────────────────────
    line(M, y, W - M, y, [220, 215, 210], 0.3)
    y += 4
    rectFill(M, y, CW, 28, BGLIGHT)

    const xL = W - M - 70   // columna izquierda de totales
    const xR = W - M - 2    // columna derecha

    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(GRIS)
    doc.text('Base imponible',                             xL, y + 6)
    doc.text(fmt(base),                                    xR, y + 6,  { align: 'right' })
    doc.text(`IVA (${Math.round(FACTURA_CONFIG.iva * 100)}%)`, xL, y + 12)
    doc.text(`+ ${fmt(iva)}`,                              xR, y + 12, { align: 'right' })
    doc.text(`Retención IRPF (${Math.round(FACTURA_CONFIG.irpf * 100)}%)`, xL, y + 18)
    doc.text(`− ${fmt(irpf)}`,                             xR, y + 18, { align: 'right' })

    line(xL, y + 20, W - M, y + 20, ROJO, 0.6)

    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
    doc.text('TOTAL A PAGAR',  xL, y + 27)
    doc.text(fmt(totalPagar),  xR, y + 27, { align: 'right' })
    y += 32

    // ── PIE ───────────────────────────────────────────────────────────────────
    rectFill(M, y, CW, 10, BGFOOTER)
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(GRIS)
    doc.text(`Transferencia bancaria · ${FACTURA_CONFIG.iban}`, M + 3, y + 6)
    doc.setFontSize(8); setColor(ROJO)
    doc.text(FACTURA_CONFIG.web, W - M - 3, y + 6, { align: 'right' })

    // ── GUARDAR ───────────────────────────────────────────────────────────────
    const nombreArchivo = `${_numFacturaSig.replace('/', '-')}_${(_cliente.name ?? _cliente.id).replace(/\s+/g, '_')}.pdf`
    doc.save(nombreArchivo)
}

// ===== APERTURA DEL CLIENTE DE CORREO =====
function abrirMailto() {
    const base       = parseFloat(_hitoActual.amount)
    const totalPagar = base + base * FACTURA_CONFIG.iva - base * FACTURA_CONFIG.irpf
    const email      = _cliente.email ?? ''
    const nombre     = _cliente.name  ?? _cliente.id
    const asunto     = encodeURIComponent(FACTURA_CONFIG.email_asunto_tpl(_numFacturaSig, new Date().toLocaleDateString('es-ES')))
    const cuerpo     = encodeURIComponent(FACTURA_CONFIG.email_cuerpo_tpl(nombre, _numFacturaSig, fmt(totalPagar)))

    window.open(`mailto:${email}?subject=${asunto}&body=${cuerpo}`, '_blank')
}

// ===== APERTURA / CIERRE DEL PANEL =====

function abrirPanel() {
    // Mover el panel al body para evitar problemas de position:fixed en Safari
    if (document.getElementById('panel-factura').parentElement !== document.body) {
        document.body.appendChild(document.getElementById('panel-factura'))
        document.body.appendChild(document.getElementById('overlay-factura'))
    }
    document.getElementById('panel-factura').style.display    = 'flex'
    document.getElementById('overlay-factura').style.display  = 'block'
    document.body.style.overflow = 'hidden'
}

function cerrarPanel() {
    document.getElementById('panel-factura').style.display   = 'none'
    document.getElementById('overlay-factura').style.display = 'none'
    document.body.style.overflow = ''
}

// ===== UTILIDADES =====

const fmt = n => parseFloat(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })

function formatFecha(iso) {
    if (!iso) return '—'
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s   = document.createElement('script')
        s.src     = src
        s.onload  = resolve
        s.onerror = reject
        document.head.appendChild(s)
    })
}

// Carga el logo como base64 al inicializar para que jsPDF pueda usarlo
let _logoBase64 = null
function _cargarLogoBase64() {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
        const canvas  = document.createElement('canvas')
        canvas.width  = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d').drawImage(img, 0, 0)
        _logoBase64 = canvas.toDataURL('image/png')
    }
    img.onerror = () => { _logoBase64 = null }  // si falla, sin logo
    img.src = LOGO_URL
}