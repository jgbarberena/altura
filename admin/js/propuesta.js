// ===== MÓDULO DE PROPUESTA COMERCIAL =====
// Genera una propuesta en PDF para reservas seleccionadas de un cliente.
// Se importa desde formulario.js igual que factura.js.

import { mostrarOpcionesEnvio, valorO, esVacio, anioTemporada } from './utils.js'

// ===== CONFIGURACIÓN =====
const PROPUESTA_CONFIG = {
    empresa_nombre:   'Vive San Fermín a medida',
    web:              'experienciasanfermin.com',
    serie:            'PRP',
    email_asunto_tpl: () => `Tu propuesta San Fermín ${anioTemporada()} — experienciasanfermin.com`,
    email_cuerpo_tpl: (nombreCliente) =>
        `Estimado/a ${nombreCliente},\n\nAdjunto encontrará su propuesta personalizada para San Fermín ${anioTemporada()}.\n\nEstamos a su disposición para cualquier consulta o ajuste.\n\nUn saludo,\nPaula Díaz Echalecu\nVive San Fermín a medida\nwww.experienciasanfermin.com`,
}

const LOGO_URL_P     = '../img/logos/sanfermin-logo-red.png'
const LOGO_BLACK_URL = '../img/logos/sanfermin-logo-black.png'

// Textos por defecto — todos editables en el mock-up
const TEXTO_TITULO = 'Una propuesta a la altura de la fiesta más grande del mundo'
const TEXTO_INTRO  = 'San Fermín no es solo una fiesta. Es una experiencia que marca para siempre. Esta propuesta está pensada para vivirla de verdad: con acceso privilegiado, guía experto y la tranquilidad de que cada detalle está cuidado.'
const TEXTO_CIERRE = 'Las plazas son limitadas. No esperes más.'
const TEXTO_CTA    = 'Confírmanos tu reserva y prepárate para vivir San Fermín como nunca.'

// ===== ESTADO DEL MÓDULO =====
let _supabase           = null
let _cliente            = null
let _reservas           = []
let _servicios          = []
let _venues             = []
let _getDisponibilidad  = null
let _logoBase64         = null
let _logoBlackBase64    = null
let _logoWhiteBase64    = null
let _numPropuesta       = null
let _modoPropuesta      = 'compacto'

// ===== INICIALIZACIÓN =====
export function initPropuesta(supabaseClient, serviciosData, venuesData, getDisponibilidad) {
    _supabase          = supabaseClient
    _servicios         = serviciosData ?? []
    _getDisponibilidad = getDisponibilidad ?? null
    _venues    = venuesData ?? []
    _cargarLogos()

    const dialog = document.getElementById('dialogPropuesta')
    document.getElementById('btnCerrarPropuesta').addEventListener('click', cerrarPanel)
    document.getElementById('btnCancelarPropuesta').addEventListener('click', cerrarPanel)

    dialog.addEventListener('click', e => {
        const r = dialog.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX > r.right ||
            e.clientY < r.top  || e.clientY > r.bottom)
            dialog.close()
    })
}

// ===== PUNTO DE ENTRADA =====
export async function abrirPanelPropuesta(clienteObj, reservasSeleccionadas) {
    _cliente  = clienteObj
    _reservas = reservasSeleccionadas
    _numPropuesta = await _calcularSiguienteNumero()

    renderPanelPropuesta()
    document.getElementById('dialogPropuesta').showModal()
    requestAnimationFrame(() => _cargarImagenesPreview())

    const nombre = valorO(_cliente.name, _cliente.id)
    mostrarOpcionesEnvio({
        tipo:      'pdf',
        email:     _cliente.email ?? null,
        telefono:  _cliente.phone ?? null,
        asunto:    PROPUESTA_CONFIG.email_asunto_tpl(),
        getTexto:  () => PROPUESTA_CONFIG.email_cuerpo_tpl(nombre),
        onGenerar: _generarYSubir,
        container: document.getElementById('propuesta-botones-envio')
    })
}

// ===== NÚMERO DE PROPUESTA =====
async function _calcularSiguienteNumero() {
    const anio = new Date().getFullYear()
    const { data } = await _supabase
        .from('reservations')
        .select('proposal_number')
        .like('proposal_number', `${PROPUESTA_CONFIG.serie}-%/${anio}`)
        .not('proposal_number', 'is', null)

    if (!data || data.length === 0) return `${PROPUESTA_CONFIG.serie}-01/${anio}`

    const maxNum = data.reduce((max, row) => {
        const match = row.proposal_number?.match(/-(\d+)\//)
        const n     = match ? parseInt(match[1]) : 0
        return n > max ? n : max
    }, 0)
    return `${PROPUESTA_CONFIG.serie}-${String(maxNum + 1).padStart(2, '0')}/${anio}`
}

// ===== TOTAL =====
function _calcularTotal() {
    return _reservas.reduce((s, r) => s + parseFloat(r.total_amount ?? 0), 0)
}

// ===== DIRECCIÓN DEL PROVEEDOR =====
function _dirProveedor(reserva) {
    const venue = _venues.find(v => v.id === reserva.venue_id)
    return valorO(venue?.address, '')
}

// ===== RENDERIZADO DEL PANEL =====
function renderPanelPropuesta() {
    document.getElementById('panel-propuesta-subtitulo').textContent =
        `${_numPropuesta}  ·  ${_reservas.length} servicio(s)  ·  ${fmt(_calcularTotal())}`

    const toolbar = document.getElementById('propuesta-toolbar')
    if (toolbar) toolbar.innerHTML = `
        <div class="propuesta-toolbar">
            <label class="propuesta-toolbar-label">Formato:</label>
            <select id="selectModoPropuesta" class="propuesta-toolbar-select" onchange="cambiarModoPropuesta()">
                <option value="compacto">Compacto — tabla de precios</option>
                <option value="completo">Completo — presentación visual</option>
            </select>
        </div>`
    const sel = document.getElementById('selectModoPropuesta')
    if (sel) sel.value = _modoPropuesta

    document.getElementById('panel-propuesta-contenido').innerHTML = _buildPropuestaHTML()
}

window.cambiarModoPropuesta = function() {
    const modo = document.getElementById('selectModoPropuesta')?.value ?? 'compacto'
    if (modo === _modoPropuesta) return
    const guardados = _leerEditables()
    _modoPropuesta = modo
    document.getElementById('panel-propuesta-contenido').innerHTML = _buildPropuestaHTML(guardados)
    requestAnimationFrame(() => _cargarImagenesPreview())
}

// ===== HTML DEL MOCK-UP =====
function _buildPropuestaHTML(guardados = null) {
    const fecha           = guardados?.fecha           ?? new Date().toLocaleDateString('es-ES')
    const tituloInit      = guardados?.titulo          ?? TEXTO_TITULO
    const introInit       = guardados?.intro           ?? TEXTO_INTRO
    const cierreInit      = guardados?.cierre          ?? TEXTO_CIERRE
    const ctaInit         = guardados?.cta             ?? TEXTO_CTA
    const bannerClaimInit = guardados?.bannerClaim     ?? 'Reserva tu experiencia'
    const destInit        = guardados?.destinatario    ?? valorO(_cliente.company, valorO(_cliente.name, _cliente.id))
    const destSubInit     = guardados?.destinatarioSub ?? (!esVacio(_cliente.company) ? valorO(_cliente.name, '') : '')
    const destDirInit     = guardados?.destinatarioDir ?? valorO(_cliente.address, '')
    const total           = _calcularTotal()

    // ── Cabecera cliente (derecha del header) ─────────────────────────────────
    const cabeceraDest = `
        <div class="prop-destinatario prop-editable" contenteditable="true"
            data-field="destinatario" title="Editar nombre">${destInit}</div>
        ${destSubInit ? `<div class="prop-dest-sub prop-editable" contenteditable="true"
            data-field="destinatario-sub" title="Editar contacto">${destSubInit}</div>` : ''}
        ${destDirInit ? `<div class="prop-dest-dir prop-editable" contenteditable="true"
            data-field="destinatario-dir" title="Editar dirección">${destDirInit}</div>` : ''}`

    // ── Sección de servicios (distinta por modo) ──────────────────────────────
    const seccionServicios = _modoPropuesta === 'completo'
        ? _buildSeccionCompleta(guardados)
        : _buildSeccionCompacta(guardados)

    return `
    <div class="prop-doc" id="propuesta-preview">
        <img class="factura-watermark" src="${LOGO_URL_P}" alt="">
        <div class="prop-inner">

            <div class="prop-header">
                <div class="factura-brand">
                    <img class="factura-logo" src="${LOGO_URL_P}" alt="Logo">
                    <div>
                        <div class="factura-brand-name">${PROPUESTA_CONFIG.empresa_nombre}</div>
                        <div class="factura-brand-web">${PROPUESTA_CONFIG.web}</div>
                    </div>
                </div>
                <div class="prop-header-meta">
                    <div class="prop-num">${_numPropuesta}</div>
                    <div class="prop-fecha prop-editable" contenteditable="true"
                        data-field="fecha" title="Editar fecha">${fecha}</div>
                    <div class="prop-etiqueta">PROPUESTA</div>
                    ${cabeceraDest}
                </div>
            </div>

            <div class="prop-intro">
                <div class="prop-titulo prop-editable" contenteditable="true"
                    data-field="titulo" title="Editar título">${tituloInit}</div>
                <div class="prop-cuerpo prop-editable" contenteditable="true"
                    data-field="intro" title="Editar introducción">${introInit}</div>
            </div>

            ${seccionServicios}

            <div class="prop-cierre">
                <div class="prop-cierre-frase prop-editable" contenteditable="true"
                    data-field="cierre" title="Editar frase de cierre">${cierreInit}</div>
                <div class="prop-cierre-cta prop-editable" contenteditable="true"
                    data-field="cta" title="Editar llamada a la acción">${ctaInit}</div>
            </div>

            <div class="prop-banner">
                <div class="prop-banner-claim prop-editable" contenteditable="true"
                    data-field="banner-claim" title="Editar texto del banner">${bannerClaimInit}</div>
                <div class="prop-banner-web">${PROPUESTA_CONFIG.web}</div>
            </div>

            <div class="prop-footer">
                <img class="prop-footer-logo" src="${LOGO_BLACK_URL}"
                    onerror="this.style.display='none'" alt="">
                <span>${PROPUESTA_CONFIG.empresa_nombre}</span>
                <span class="prop-footer-web">${PROPUESTA_CONFIG.web}</span>
            </div>

        </div>
    </div>`
}

// ── Modo COMPACTO: tabla con imagen pequeña ───────────────────────────────────
function _buildSeccionCompacta(guardados) {
    const total = _calcularTotal()
    const filas = _reservas.map(r => {
        const svc      = _servicios.find(s => s.id === r.service_id) ?? {}
        const venue    = _venues.find(v => v.id === r.venue_id) ?? {}
        const filaSaved = guardados?.filas?.find(f => f.id === r.id) ?? {}

        const tipo    = filaSaved.tipo   ?? svc.name ?? ''
        const nombre  = filaSaved.nombre ?? valorO(venue.display_name, svc.name ?? r.venue_id)
        const dia     = svc.day ? `${svc.day} de julio` : '—'
        const hora    = svc.start_time ?? '—'
        const meta    = filaSaved.meta   ?? `${dia} · ${hora}h`
        const dir     = filaSaved.dir    ?? _dirProveedor(r)

        const disp    = _getDisponibilidad?.()?.find(d => d.venue_id === r.venue_id && d.service_id === r.service_id)
        const realImg = disp?.photos?.[0] ?? svc.image_url ?? ''

        return `
        <tr class="prop-tabla-fila">
            <td class="prop-col-img">
                <img class="prop-img" src="${LOGO_URL_P}" data-real="${realImg}" alt="${nombre}">
            </td>
            <td class="prop-col-desc">
                <div class="prop-svc-tipo prop-editable" contenteditable="true"
                    data-field="svc-tipo-${r.id}" title="Editar tipo">${tipo}</div>
                <div class="prop-svc-nombre prop-editable" contenteditable="true"
                    data-field="svc-nombre-${r.id}" title="Editar nombre">${nombre}</div>
                <div class="prop-svc-meta prop-editable" contenteditable="true"
                    data-field="svc-meta-${r.id}" title="Editar fecha y hora">${meta}</div>
                <div class="prop-svc-dir prop-editable" contenteditable="true"
                    data-field="svc-dir-${r.id}" title="Editar dirección">${dir}</div>
            </td>
            <td class="prop-col-num" style="text-align:right">${fmt(parseFloat(r.price_per_slot))}</td>
            <td class="prop-col-num" style="text-align:center">${r.slots}</td>
            <td class="prop-col-num" style="text-align:right">${fmt(parseFloat(r.total_amount ?? 0))}</td>
        </tr>`
    }).join('')

    return `
    <div class="prop-seccion">
        <div class="factura-section-label">Tu experiencia San Fermín ${anioTemporada()}</div>
        <table class="prop-tabla">
            <thead><tr>
                <th class="prop-col-img"></th>
                <th>Servicio</th>
                <th style="text-align:right">€/persona</th>
                <th style="text-align:center">Personas</th>
                <th style="text-align:right">Total</th>
            </tr></thead>
            <tbody>${filas}</tbody>
            <tfoot><tr class="prop-total-row">
                <td colspan="4" style="text-align:right">Total propuesta</td>
                <td style="text-align:right">${fmt(total)}</td>
            </tfoot>
        </table>
    </div>`
}

// ── Modo COMPLETO: bloques con fotos grandes ──────────────────────────────────
function _buildSeccionCompleta(guardados) {
    const total  = _calcularTotal()
    const bloques = _reservas.map(r => {
        const svc       = _servicios.find(s => s.id === r.service_id) ?? {}
        const venue     = _venues.find(v => v.id === r.venue_id) ?? {}
        const filaSaved = guardados?.filas?.find(f => f.id === r.id) ?? {}
        const disp      = _getDisponibilidad?.()?.find(d => d.venue_id === r.venue_id && d.service_id === r.service_id)

        const tipo    = filaSaved.tipo   ?? svc.name ?? ''
        const nombre  = filaSaved.nombre ?? valorO(venue.display_name, svc.name ?? r.venue_id)
        const dia     = svc.day ? `${svc.day} de julio` : '—'
        const hora    = svc.start_time ?? '—'
        const meta    = filaSaved.meta   ?? `${dia} · ${hora}h`
        const dir     = filaSaved.dir    ?? _dirProveedor(r)
        const desc    = filaSaved.desc || disp?.description || svc.description || ''

        const fotos   = disp?.photos ?? []
        const foto0   = fotos[0] ?? svc.image_url ?? ''
        const foto1   = fotos[1] ?? ''
        const foto2   = fotos[2] ?? ''
        const hasMini = foto1 !== ''

        const miniHTML = hasMini ? `
            <div class="prop-fotos-mini">
                <img class="prop-foto-mini" src="${LOGO_URL_P}" data-real="${foto1}" alt="">
                ${foto2 ? `<img class="prop-foto-mini" src="${LOGO_URL_P}" data-real="${foto2}" alt="">` : ''}
            </div>` : ''

        const bottomHTML = `
            <div class="prop-bloque-bottom">
                <div class="prop-svc-desc prop-editable" contenteditable="true"
                    data-field="svc-desc-${r.id}" title="Editar descripción">${desc}</div>
            </div>`

        return `
        <div class="prop-bloque">
            <div class="prop-bloque-top">
                <div class="prop-fotos">
                    <img class="prop-foto-ppal" src="${LOGO_URL_P}" data-real="${foto0}" alt="${nombre}">
                    ${miniHTML}
                </div>
                <div class="prop-datos">
                    <div class="prop-svc-tipo prop-editable" contenteditable="true"
                        data-field="svc-tipo-${r.id}" title="Editar tipo">${tipo}</div>
                    <div class="prop-svc-nombre prop-editable" contenteditable="true"
                        data-field="svc-nombre-${r.id}" title="Editar nombre">${nombre}</div>
                    <div class="prop-svc-meta prop-editable" contenteditable="true"
                        data-field="svc-meta-${r.id}" title="Editar fecha y hora">${meta}</div>
                    <div class="prop-svc-dir prop-editable" contenteditable="true"
                        data-field="svc-dir-${r.id}" title="Editar dirección">${dir}</div>
                    <div class="prop-datos-nums">${r.slots} personas &nbsp;·&nbsp; ${fmt(parseFloat(r.price_per_slot))}/persona &nbsp;·&nbsp; ${fmt(parseFloat(r.total_amount ?? 0))}</div>
                </div>
            </div>
            ${bottomHTML}
        </div>`
    }).join('')

    return `
    <div class="prop-seccion">
        <div class="factura-section-label">Tu experiencia San Fermín ${anioTemporada()}</div>
        ${bloques}
        <div class="prop-total-completo">
            <span>Total propuesta</span>
            <span>${fmt(total)}</span>
        </div>
    </div>`
}

// ===== CARGA DE IMÁGENES REALES EN EL MOCK-UP =====
function _cargarImagenesPreview() {
    document.querySelectorAll('#propuesta-preview [data-real]').forEach(img => {
        const src = img.dataset.real
        if (!src) return
        const base = window.BASE_URL ?? window.location.origin
        const url  = src.startsWith('http') ? src : `${base}/${src}`
        const test = new Image()
        test.onload  = () => { img.src = url }
        test.onerror = () => { /* logo ya puesto como fallback */ }
        test.src = url
    })
}

// ===== LEER TODOS LOS CAMPOS EDITABLES =====
function _leerEditables() {
    const preview = document.getElementById('propuesta-preview')
    const get = field => preview?.querySelector(`[data-field="${field}"]`)?.textContent?.trim() ?? ''

    const svcFallback = r => {
        const svc   = _servicios.find(s => s.id === r.service_id) ?? {}
        const venue = _venues.find(v => v.id === r.venue_id) ?? {}
        return valorO(venue.display_name, svc.name ?? svc.service_code ?? r.service_id)
    }

    return {
        titulo:          get('titulo')          || TEXTO_TITULO,
        intro:           get('intro')           || TEXTO_INTRO,
        cierre:          get('cierre')          || TEXTO_CIERRE,
        cta:             get('cta')             || TEXTO_CTA,
        fecha:           get('fecha')           || new Date().toLocaleDateString('es-ES'),
        destinatario:    get('destinatario')    || valorO(_cliente.company, valorO(_cliente.name, _cliente.id)),
        destinatarioSub: get('destinatario-sub') || (!esVacio(_cliente.company) ? valorO(_cliente.name, '') : ''),
        destinatarioDir: get('destinatario-dir') || valorO(_cliente.address, ''),
        bannerClaim:     get('banner-claim')    || 'Reserva tu experiencia',
        filas: _reservas.map(r => ({
            id:     r.id,
            tipo:   get(`svc-tipo-${r.id}`)   || (_servicios.find(s => s.id === r.service_id)?.name ?? ''),
            nombre: get(`svc-nombre-${r.id}`) || svcFallback(r),
            meta:   get(`svc-meta-${r.id}`)   || '',
            dir:    get(`svc-dir-${r.id}`)    || _dirProveedor(r),
            desc:   get(`svc-desc-${r.id}`)   || '',
        })),
    }
}

// ===== GENERAR PDF, SUBIR A STORAGE Y GUARDAR EN BD =====
async function _generarYSubir() {
    const pdfResult = await _generarPDF()

    let propPath = null
    if (pdfResult?.blob) {
        const { data: uploadData, error: errUp } = await _supabase.storage
            .from('proposals')
            .upload(pdfResult.nombreArchivo, pdfResult.blob, { contentType: 'application/pdf', upsert: true })
        if (errUp) {
            console.error('Error al subir propuesta a Storage:', errUp.message)
        } else {
            propPath = uploadData.path
        }
    }

    const ids = _reservas.map(r => r.id)
    const camposUpdate = { proposal_number: _numPropuesta }
    if (propPath) camposUpdate.proposal_path = propPath

    const { error: errUpdate } = await _supabase
        .from('reservations')
        .update(camposUpdate)
        .in('id', ids)
    if (errUpdate) { alert('Error al guardar propuesta en reservas: ' + errUpdate.message); return }

    document.dispatchEvent(new CustomEvent('propuestaEmitida', {
        detail: { ids, numero: _numPropuesta, path: propPath }
    }))
}

// ===== GENERACIÓN DEL PDF =====
async function _generarPDF() {
    if (!window.jspdf) {
        await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
    }

    const { jsPDF } = window.jspdf
    const doc    = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const campos = _leerEditables()

    // Pre-cargar imágenes en base64 (foto principal + minis en modo completo)
    const imgCache = {}
    for (const r of _reservas) {
        const svc  = _servicios.find(s => s.id === r.service_id) ?? {}
        const disp = _getDisponibilidad?.()?.find(d => d.venue_id === r.venue_id && d.service_id === r.service_id)
        const fotos = disp?.photos ?? []
        const url0  = fotos[0] ?? svc.image_url
        if (url0) imgCache[`${r.venue_id}__${r.service_id}`] = await _imgToBase64(url0)
        if (_modoPropuesta === 'completo') {
            for (let i = 1; i <= 2; i++) {
                if (fotos[i]) imgCache[`${r.venue_id}__${r.service_id}__${i}`] = await _imgToBase64(fotos[i])
            }
        }
    }

    // ── Constantes ────────────────────────────────────────────────────────────
    const ROJO   = [179, 0, 0]
    const ROJO_D = [128, 0, 0]
    const NEGRO  = [34, 34, 34]
    const GRIS   = [119, 119, 119]
    const BGFOOT = [249, 240, 240]
    const BGDESC = [253, 248, 248]

    const W     = 210
    const H     = 297
    const M     = 14
    const CW    = W - M * 2
    const PIE_H = 14
    const PIE_Y = H - M - PIE_H
    let y       = M

    // ── Helpers ───────────────────────────────────────────────────────────────
    const setColor = rgb => doc.setTextColor(...rgb)
    const setFill  = rgb => doc.setFillColor(...rgb)
    const setDraw  = rgb => doc.setDrawColor(...rgb)
    const rectFill = (x, yy, w, h, rgb) => { setFill(rgb); doc.rect(x, yy, w, h, 'F') }
    const line     = (x1, y1, x2, y2, rgb, lw = 0.3) => {
        doc.setLineWidth(lw); setDraw(rgb); doc.line(x1, y1, x2, y2)
    }

    // ── Marca de agua ─────────────────────────────────────────────────────────
    const dibujarMarcaAgua = () => {
        if (!_logoBase64) return
        try {
            doc.saveGraphicsState()
            doc.setGState(new doc.GState({ opacity: 0.05 }))
            const lw = 90; const lh = lw / 0.537
            doc.addImage(_logoBase64, 'PNG', W - M - lw + 10, H - lh - 5, lw, lh)
            doc.restoreGraphicsState()
        } catch {}
    }

    // ── Cabecera ──────────────────────────────────────────────────────────────
    const dibujarCabecera = () => {
        line(M, y, W - M, y, ROJO, 1.2)
        y += 4

        // Altura dinámica según datos del cliente
        const AREA_H = 26
            + (campos.destinatarioSub ? 5   : 0)
            + (campos.destinatarioDir ? 4.5 : 0)
        const yMid = y + AREA_H / 2

        // Derecha: número, fecha, etiqueta, destinatario(s)
        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); setColor(ROJO)
        doc.text(_numPropuesta, W - M, y + 6, { align: 'right' })
        doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(GRIS)
        doc.text(campos.fecha, W - M, y + 12, { align: 'right' })
        doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(GRIS)
        doc.text('PROPUESTA PERSONALIZADA', W - M, y + 17, { align: 'right' })

        let yDest = y + 23
        doc.setFontSize(10); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
        doc.text(campos.destinatario, W - M, yDest, { align: 'right' })
        if (campos.destinatarioSub) {
            yDest += 5
            doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); setColor(NEGRO)
            doc.text(campos.destinatarioSub, W - M, yDest, { align: 'right' })
        }
        if (campos.destinatarioDir) {
            yDest += 4.5
            doc.setFontSize(7.5); doc.setFont('helvetica', 'italic'); setColor(GRIS)
            doc.text(campos.destinatarioDir, W - M, yDest, { align: 'right' })
        }

        // Izquierda: logo + empresa
        if (_logoBase64) {
            const lh = 18; const lw = lh * 0.537
            doc.addImage(_logoBase64, 'PNG', M, y + (AREA_H - lh) / 2, lw, lh)
            const tx = M + lw + 3
            doc.setFontSize(12); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
            doc.text('Vive San Fermin a medida', tx, yMid - 1)
            doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(ROJO)
            doc.text(PROPUESTA_CONFIG.web, tx, yMid + 5)
        } else {
            doc.setFontSize(13); doc.setFont('helvetica', 'bold'); setColor(ROJO)
            doc.text('Vive San Fermin a medida', M, yMid)
            doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(ROJO)
            doc.text(PROPUESTA_CONFIG.web, M, yMid + 5)
        }

        y += AREA_H
        line(M, y, W - M, y, ROJO, 1.2)
        y += 5
    }

    // ── Pie ───────────────────────────────────────────────────────────────────
    const dibujarPie = () => {
        rectFill(M, PIE_Y, CW, PIE_H, BGFOOT)
        const logoFooter = _logoBlackBase64 ?? _logoBase64
        if (logoFooter) {
            const lh = 8; const lw = lh * 0.537
            try { doc.addImage(logoFooter, 'PNG', M + 3, PIE_Y + (PIE_H - lh) / 2, lw, lh) } catch {}
            doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); setColor(GRIS)
            doc.text(PROPUESTA_CONFIG.empresa_nombre, M + lw + 5, PIE_Y + PIE_H / 2 + 1)
        } else {
            doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); setColor(GRIS)
            doc.text(PROPUESTA_CONFIG.empresa_nombre, M + 3, PIE_Y + PIE_H / 2 + 1)
        }
        setColor(ROJO)
        doc.text(PROPUESTA_CONFIG.web, W - M - 3, PIE_Y + PIE_H / 2 + 1, { align: 'right' })
    }

    // ── Salto de página ───────────────────────────────────────────────────────
    const checkPage = (needed) => {
        if (y + needed > PIE_Y - 4) {
            dibujarPie()
            doc.addPage()
            y = M
            dibujarMarcaAgua()
            dibujarCabecera()
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONTENIDO
    // ═══════════════════════════════════════════════════════════════════════════
    dibujarMarcaAgua()
    dibujarCabecera()

    // ── Título e intro ────────────────────────────────────────────────────────
    checkPage(50)
    y += 10
    rectFill(M, y, CW, 0.8, ROJO)
    y += 12

    doc.setFontSize(16); doc.setFont('helvetica', 'bold'); setColor(ROJO_D)
    const tituloLines = doc.splitTextToSize(campos.titulo, CW)
    doc.text(tituloLines, M, y)
    y += tituloLines.length * 8 + 8

    doc.setFontSize(10.5); doc.setFont('helvetica', 'italic'); setColor(GRIS)
    const introLines = doc.splitTextToSize(campos.intro, CW)
    doc.text(introLines, M, y)
    y += introLines.length * 5.5 + 8

    line(M, y, W - M, y, [220, 220, 220], 0.35)
    y += 7

    // ── Sección servicios ─────────────────────────────────────────────────────
    checkPage(24)
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
    doc.text(`TU EXPERIENCIA SAN FERMIN ${anioTemporada()}`, M, y)
    y += 5

    let totalGlobal = 0

    if (_modoPropuesta === 'completo') {
        // ── MODO COMPLETO: bloques con foto grande ────────────────────────────
        const FOTO_ZONA_W = 54   // zona total para fotos (foto ppal + mini si la hay)
        const DATO_X      = M + FOTO_ZONA_W + 4
        const DATO_W      = CW - FOTO_ZONA_W - 4
        const FOTO_H      = 38  // altura foto principal

        for (const r of _reservas) {
            const fila     = campos.filas.find(f => f.id === r.id) ?? {}
            const subtotal = parseFloat(r.total_amount ?? 0)
            totalGlobal   += subtotal

            const imgPpal = imgCache[`${r.venue_id}__${r.service_id}`]   ?? _logoBase64
            const imgMini1 = imgCache[`${r.venue_id}__${r.service_id}__1`]
            const imgMini2 = imgCache[`${r.venue_id}__${r.service_id}__2`]
            const hasMini  = !!imgMini1

            // Precalcular líneas de texto
            doc.setFontSize(7.5); doc.setFont('helvetica', 'bold')
            const tipoLines   = fila.tipo   ? doc.splitTextToSize(fila.tipo.toUpperCase(), DATO_W) : []
            doc.setFontSize(11); doc.setFont('helvetica', 'bold')
            const nombreLines = doc.splitTextToSize(fila.nombre ?? '', DATO_W)
            doc.setFontSize(8); doc.setFont('helvetica', 'normal')
            const metaLines   = doc.splitTextToSize(fila.meta   ?? '', DATO_W)
            doc.setFontSize(7.5); doc.setFont('helvetica', 'italic')
            const dirLines    = doc.splitTextToSize(fila.dir    ?? '', DATO_W)

            const topTextH = (tipoLines.length   *  3.8)
                           + (nombreLines.length *  5.5) + 2
                           + (metaLines.length   *  4.2) + 1
                           + (dirLines.length    *  3.8)
                           + 10  // separador + fila de precio

            const topH = Math.max(FOTO_H, topTextH) + 4

            doc.setFontSize(8); doc.setFont('helvetica', 'normal')
            const descLines = fila.desc ? doc.splitTextToSize(fila.desc, CW - 6) : []
            const hasBottom = descLines.length > 0
            const bottomH   = hasBottom ? descLines.length * 4.2 + 10 : 0

            checkPage(topH + bottomH + 8)
            const yBloque = y

            // Foto principal
            const fotoPpalW = hasMini ? 38 : FOTO_ZONA_W - 2
            if (imgPpal) try { doc.addImage(imgPpal, 'PNG', M, yBloque, fotoPpalW, FOTO_H) } catch {}

            // Fotos mini apiladas
            if (hasMini) {
                const miniX = M + fotoPpalW + 2
                const miniW = FOTO_ZONA_W - fotoPpalW - 4
                const miniH = (FOTO_H - 2) / 2
                try { doc.addImage(imgMini1, 'PNG', miniX, yBloque,          miniW, miniH) } catch {}
                if (imgMini2) try { doc.addImage(imgMini2, 'PNG', miniX, yBloque + miniH + 2, miniW, miniH) } catch {}
            }

            // Datos prácticos (columna derecha)
            let yD = yBloque + 4
            if (tipoLines.length > 0) {
                doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
                doc.text(tipoLines[0], DATO_X, yD)
                yD += tipoLines.length * 3.8 + 1
            }
            doc.setFontSize(11); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
            doc.text(nombreLines, DATO_X, yD)
            yD += nombreLines.length * 5.5 + 2

            doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(ROJO)
            doc.text(metaLines, DATO_X, yD)
            yD += metaLines.length * 4.2 + 1

            doc.setFontSize(7.5); doc.setFont('helvetica', 'italic'); setColor(GRIS)
            doc.text(dirLines, DATO_X, yD)

            // Precio en la parte baja de la zona de datos
            const yPrecio = yBloque + topH - 7
            line(DATO_X, yPrecio - 3, W - M, yPrecio - 3, [220, 220, 220], 0.25)
            doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
            doc.text(
                `${r.slots} personas  ·  ${fmt(parseFloat(r.price_per_slot))}/persona  ·  ${fmt(subtotal)}`,
                DATO_X, yPrecio
            )

            y = yBloque + topH

            // Bloque descripción comercial
            if (hasBottom) {
                y += 2
                rectFill(M, y, CW, bottomH, BGDESC)
                doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor([80, 80, 80])
                doc.text(descLines, M + 4, y + 6)
                y += bottomH
            }

            y += 5
            line(M, y, W - M, y, [220, 220, 220], 0.3)
            y += 4
        }

    } else {
        // ── MODO COMPACTO: tabla con imagen pequeña ───────────────────────────
        const COL_IMG  = 24
        const COL_DESC = CW * 0.46
        const COL_EUR  = 24
        const COL_PZS  = 20

        line(M, y, W - M, y, ROJO, 0.6)
        y += 5
        doc.setFontSize(7); doc.setFont('helvetica', 'bold'); setColor(GRIS)
        doc.text('SERVICIO',  M + COL_IMG + 2,                                y)
        doc.text('€/PERSONA', M + COL_IMG + COL_DESC + COL_EUR,               y, { align: 'right' })
        doc.text('PERSONAS',  M + COL_IMG + COL_DESC + COL_EUR + COL_PZS / 2, y, { align: 'center' })
        doc.text('TOTAL',     W - M,                                           y, { align: 'right' })
        y += 3
        line(M, y, W - M, y, [200, 200, 200], 0.3)
        y += 3

        for (const r of _reservas) {
            const fila     = campos.filas.find(f => f.id === r.id) ?? {}
            const subtotal = parseFloat(r.total_amount ?? 0)
            totalGlobal   += subtotal

            doc.setFontSize(7.5); doc.setFont('helvetica', 'bold')
            const tipoLines   = fila.tipo   ? doc.splitTextToSize(fila.tipo.toUpperCase(), COL_DESC - 4) : []
            doc.setFontSize(9); doc.setFont('helvetica', 'bold')
            const _svc = _servicios.find(s => s.id === r.service_id)
            const nombreLines = doc.splitTextToSize(fila.nombre ?? _svc?.name ?? _svc?.service_code ?? '—', COL_DESC - 4)
            doc.setFontSize(7.5); doc.setFont('helvetica', 'normal')
            const metaLines   = doc.splitTextToSize(fila.meta   ?? '', COL_DESC - 4)
            doc.setFontSize(7); doc.setFont('helvetica', 'italic')
            const dirLines    = doc.splitTextToSize(fila.dir    ?? '', COL_DESC - 4)

            const IMG_H = 20
            const textH = (tipoLines.length   * 3.5)
                        + (nombreLines.length * 4.5) + 1
                        + (metaLines.length   * 4)
                        + (dirLines.length    * 3.5) + 2
            const filaH = Math.max(IMG_H, textH) + 6

            checkPage(filaH + 4)
            const yFila = y

            const imgB64 = imgCache[`${r.venue_id}__${r.service_id}`] ?? _logoBase64
            if (imgB64) try { doc.addImage(imgB64, 'PNG', M, yFila + 1, COL_IMG - 2, IMG_H) } catch {}

            let yT = yFila + 4
            if (tipoLines.length > 0) {
                doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); setColor(ROJO)
                doc.text(tipoLines[0], M + COL_IMG + 2, yT)
                yT += tipoLines.length * 3.5 + 1
            }
            doc.setFontSize(9); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
            doc.text(nombreLines, M + COL_IMG + 2, yT)
            yT += nombreLines.length * 4.5 + 1

            doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); setColor(ROJO)
            doc.text(metaLines, M + COL_IMG + 2, yT)
            yT += metaLines.length * 4

            doc.setFontSize(7); doc.setFont('helvetica', 'italic'); setColor(GRIS)
            doc.text(dirLines, M + COL_IMG + 2, yT)

            const yCols = yFila + filaH / 2
            doc.setFontSize(9); doc.setFont('helvetica', 'normal'); setColor(NEGRO)
            doc.text(fmt(parseFloat(r.price_per_slot)),
                M + COL_IMG + COL_DESC + COL_EUR, yCols, { align: 'right' })
            doc.text(String(r.slots),
                M + COL_IMG + COL_DESC + COL_EUR + COL_PZS / 2, yCols, { align: 'center' })
            doc.setFont('helvetica', 'bold')
            doc.text(fmt(subtotal), W - M, yCols, { align: 'right' })

            y = yFila + filaH
            line(M, y, W - M, y, [220, 220, 220], 0.25)
            y += 2
        }
    }

    // ── Fila total ────────────────────────────────────────────────────────────
    checkPage(16)
    line(M, y, W - M, y, ROJO, 0.7)
    y += 6
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); setColor(NEGRO)
    doc.text('TOTAL', M + 2, y)
    doc.text(fmt(totalGlobal), W - M, y, { align: 'right' })
    y += 12

    // ── Bloque final: cierre + banner (siempre juntos) ────────────────────────
    doc.setFontSize(13)
    const cierreLinesPrev = doc.splitTextToSize(campos.cierre, CW)
    doc.setFontSize(10.5)
    const ctaLinesPrev    = doc.splitTextToSize(campos.cta, CW)
    const BANNER_H        = 22
    const BLOQUE_FINAL_H  = 14
        + cierreLinesPrev.length * 6.5 + 3
        + ctaLinesPrev.length * 5.5 + 5
        + BANNER_H + 6

    checkPage(BLOQUE_FINAL_H)

    line(M, y, W - M, y, ROJO, 0.7)
    y += 10

    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); setColor(ROJO_D)
    const cierreLines = doc.splitTextToSize(campos.cierre, CW)
    doc.text(cierreLines, W / 2, y, { align: 'center' })
    y += cierreLines.length * 6.5 + 3

    doc.setFontSize(10.5); doc.setFont('helvetica', 'normal'); setColor(GRIS)
    const ctaLines = doc.splitTextToSize(campos.cta, CW)
    doc.text(ctaLines, W / 2, y, { align: 'center' })
    y += ctaLines.length * 5.5 + 5

    rectFill(M, y, CW, BANNER_H, ROJO)
    if (_logoWhiteBase64) {
        const lh = 12; const lw = lh * 0.537
        const yLogo = y + (BANNER_H - lh) / 2
        try {
            doc.addImage(_logoWhiteBase64, 'PNG', M + 4,          yLogo, lw, lh)
            doc.addImage(_logoWhiteBase64, 'PNG', W - M - lw - 4, yLogo, lw, lh)
        } catch {}
    }
    doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); setColor([255, 255, 255])
    doc.text(campos.bannerClaim.toUpperCase(), W / 2, y + 8, { align: 'center' })
    doc.setLineWidth(0.3); doc.setDrawColor(255, 255, 255)
    doc.line(M + 30, y + 11, W - M - 30, y + 11)
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); setColor([255, 255, 255])
    doc.text(PROPUESTA_CONFIG.web, W / 2, y + 18, { align: 'center' })
    y += BANNER_H + 6

    dibujarPie()

    const nombreArchivo = `${_numPropuesta.replace('/', '-')}_${valorO(_cliente.company, valorO(_cliente.name, _cliente.id)).replace(/\s+/g, '_')}.pdf`
    doc.save(nombreArchivo)
    return { blob: doc.output('blob'), nombreArchivo }
}

// ===== CIERRE DEL PANEL =====
function cerrarPanel() {
    document.getElementById('dialogPropuesta').close()
}

// ===== CARGA DE IMAGEN A BASE64 =====
async function _imgToBase64(relPath) {
    const base = window.BASE_URL ?? window.location.origin
    const url  = relPath.startsWith('http') ? relPath : `${base}/${relPath}`
    return new Promise(resolve => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
            try {
                const c = document.createElement('canvas')
                c.width = img.naturalWidth; c.height = img.naturalHeight
                c.getContext('2d').drawImage(img, 0, 0)
                resolve(c.toDataURL('image/png'))
            } catch { resolve(_logoBase64) }
        }
        img.onerror = () => resolve(_logoBase64)
        img.src = url
    })
}

// ===== CARGA DE LOGOS =====
function _cargarLogos() {
    const cargar = (src, setter) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
            try {
                const c = document.createElement('canvas')
                c.width = img.naturalWidth; c.height = img.naturalHeight
                c.getContext('2d').drawImage(img, 0, 0)
                setter(c.toDataURL('image/png'))
            } catch { setter(null) }
        }
        img.onerror = () => setter(null)
        img.src = src
    }
    cargar(LOGO_URL_P,     v => { _logoBase64      = v })
    cargar(LOGO_BLACK_URL, v => { _logoBlackBase64 = v })
    cargar('../img/logos/sanfermin-logo-white.png', v => { _logoWhiteBase64 = v })
}

// ===== SCRIPT LOADER =====
function _loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script')
        s.src = src; s.onload = resolve; s.onerror = reject
        document.head.appendChild(s)
    })
}

// ===== UTILIDADES =====
const fmt = n => parseFloat(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })