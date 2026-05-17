// ======================================================
// DISPONIBILIDAD.JS
// Lee service_availability desde Supabase y actualiza
// los badges de disponibilidad en las cards de experiencias.
// Script clásico (no módulo) — requiere window.supabasePublic
// cargado antes desde supabase-global.js.
//
// Uso en HTML — un badge por card, directamente dentro de .card
// (fuera del card-overlay), el JS lee el slug del botón
// data-solicitud dentro de la misma card:
//   <span class="disponibilidad-badge"></span>
//
// FASE 2 (pendiente): usar disponibilidad por día en el
// dialog cuando el usuario selecciona un día del encierro.
// ======================================================

// ---- Configuración ----
const _DISP_UMBRAL_ULTIMAS = 5
const _DISP_DIAS_ENCIERRO  = [7, 8, 9, 10, 11, 12, 13, 14]

// ---- Infiere el evento base a partir de un slug ----
// Misma lógica que _inferirServiceId en formulario.js (admin)
function _dispDetectarEvento(slug) {
    if (!slug) return null
    var partes = slug.toLowerCase().split('-')
    if (partes.indexOf('encierro')  !== -1) return 'encierro'
    if (partes.indexOf('chupinazo') !== -1) return 'chupinazo'
    if (partes.indexOf('procesion') !== -1) return 'procesion'
    if (partes.indexOf('gigantes')  !== -1) return 'gigantes'
    if (partes.indexOf('pobre')     !== -1) return 'pobre-de-mi'
    return null
}

// ---- Devuelve los service_ids a consultar para un evento ----
function _dispServiceIds(evento) {
    if (evento === 'encierro') {
        return _DISP_DIAS_ENCIERRO.map(function(d) { return 'ENCIERRO_' + d })
    }
    var fijo = {
        'chupinazo':   'CHUPINAZO_6',
        'procesion':   'PROCESION_7',
        'gigantes':    'DESPEDIDA_GIGANTES_14',
        'pobre-de-mi': 'POBRE_DE_MI'
    }
    return fijo[evento] ? [fijo[evento]] : []
}

// ---- Mensaje para evento de un solo día ----
function _dispMensajeSimple(freeSlots) {
    if (freeSlots <= 0)                    return { texto: 'Agotado' }
    if (freeSlots <= _DISP_UMBRAL_ULTIMAS) return { texto: 'Últimas plazas' }
    return                                        { texto: 'Plazas disponibles' }
}

// ---- Mensaje para el encierro (múltiples días) ----
function _dispMensajeEncierro(disponibilidad) {
    var diasLibres   = []
    var diasUltimas  = []
    var diasAgotados = []

    _DISP_DIAS_ENCIERRO.forEach(function(dia) {
        var sid  = 'ENCIERRO_' + dia
        var item = disponibilidad.find(function(d) { return d.service_id === sid })
        var free = item ? item.free_slots : 0
        if (free <= 0)                         diasAgotados.push(dia)
        else if (free <= _DISP_UMBRAL_ULTIMAS) diasUltimas.push(dia)
        else                                   diasLibres.push(dia)
    })

    var totalDias = _DISP_DIAS_ENCIERRO.length
    var diasDisp  = diasLibres.length + diasUltimas.length
    var numAgot   = diasAgotados.length

    if (numAgot === totalDias) {
        return { texto: 'Agotado' }
    }

    if (numAgot === 0) {
        if (diasUltimas.length === 0) {
            return { texto: 'Plazas disponibles' }
        }
        if (diasLibres.length === 0) {
            return { texto: 'Últimas plazas' }
        }
        if (diasUltimas.length <= 2) {
            return { texto: 'Plazas disponibles · Últimas plazas ' + _dispFormatDias(diasUltimas, true) }
        }
        return { texto: 'Últimas plazas · Plazas disponibles ' + _dispFormatDias(diasLibres, true) }
    }

    if (diasDisp >= 5) {
        return { texto: 'Plazas disponibles · Agotado ' + _dispFormatDias(diasAgotados, true) }
    }
    if (diasDisp >= 2) {
        var diasMostrar = diasLibres.concat(diasUltimas)
        var prefijo = diasLibres.length > 0 ? 'Plazas disponibles' : 'Últimas plazas'
        return { texto: prefijo + ' ' + _dispFormatDias(diasMostrar, true) }
    }
    if (diasDisp === 1) {
        var dia = diasLibres.length > 0 ? diasLibres[0] : diasUltimas[0]
        var pre = diasLibres.length > 0 ? 'Plazas disponibles' : 'Últimas plazas'
        return { texto: pre + ' día ' + dia }
    }

    return { texto: 'Últimas plazas' }
}

// ---- Formatea lista de días: [7,8,12] → "días 7, 8 y 12" ----
function _dispFormatDias(dias, conPrefijo) {
    if (!dias || dias.length === 0) return ''
    var sorted  = dias.slice().sort(function(a, b) { return a - b })
    var prefijo = conPrefijo ? (sorted.length === 1 ? 'día ' : 'días ') : ''
    if (sorted.length === 1) return prefijo + sorted[0]
    var ultimo = sorted.pop()
    return prefijo + sorted.join(', ') + ' y ' + ultimo
}

// ---- Determina la clase de color según el contenido de la línea ----
function _dispClaseLinea(texto) {
    var t = texto.toLowerCase()
    if (t.indexOf('agotado') !== -1) return 'disp-linea-agotado'
    if (t.indexOf('ltimas')  !== -1) return 'disp-linea-ultimas'  // cubre "últimas" y "ultimas"
    return 'disp-linea-disponible'
}

// ---- Actualiza un badge con una o dos líneas coloreadas ----
function _dispActualizarBadge(badge, resultado) {
    badge.className = 'disponibilidad-badge'
    badge.innerHTML = ''

    var partes = resultado.texto.split(' · ')
    partes.forEach(function(parte) {
        var span       = document.createElement('span')
        span.textContent = parte
        span.className   = _dispClaseLinea(parte)
        badge.appendChild(span)
    })
}

// ---- Aplica el fallback a todos los badges ----
function _dispAplicarFallback() {
    window._dispDisponibilidad = []  // ← añadir esta línea
    document.querySelectorAll('.disponibilidad-badge').forEach(function(badge) {
        badge.className = 'disponibilidad-badge'
        badge.innerHTML = '<span class="disp-linea-ultimas">Últimas plazas</span>'
    })
}

// ======================================================
// FUNCIÓN PRINCIPAL
// ======================================================

async function initDisponibilidad() {
    if (!window.supabasePublic) {
        console.warn('disponibilidad.js: supabasePublic no disponible')
        _dispAplicarFallback()
        return
    }

    var badges = Array.from(document.querySelectorAll('.disponibilidad-badge'))
    if (badges.length === 0) return

    // Para cada badge leer el slug del botón data-solicitud de la misma card
    var badgeSlugs = badges.map(function(badge) {
        var card = badge.closest('.card')
        if (!card) return null
        var btn  = card.querySelector('[data-solicitud]')
        return btn ? btn.dataset.solicitud : null
    })

    // Inferir los service_ids únicos a consultar
    var serviceIdsAConsultar = []
    badgeSlugs.forEach(function(slug) {
        if (!slug) return
        var evento = _dispDetectarEvento(slug)
        var ids    = _dispServiceIds(evento)
        ids.forEach(function(id) {
            if (serviceIdsAConsultar.indexOf(id) === -1) serviceIdsAConsultar.push(id)
        })
    })

    if (serviceIdsAConsultar.length === 0) {
        _dispAplicarFallback()
        return
    }

    // Consultar Supabase
    var disponibilidad = []
    try {
        var result = await window.supabasePublic
            .from('service_availability')
            .select('service_id, free_slots')
            .in('service_id', serviceIdsAConsultar)

        if (result.error) throw result.error
        disponibilidad = result.data || []
    } catch (err) {
        console.error('disponibilidad.js: error consultando Supabase:', err)
        _dispAplicarFallback()
        return
    }

    // Actualizar cada badge
    badges.forEach(function(badge, i) {
        var slug = badgeSlugs[i]

        if (!slug) {
            _dispActualizarBadge(badge, { texto: 'Últimas plazas' })
            return
        }

        var evento = _dispDetectarEvento(slug)

        if (!evento) {
            _dispActualizarBadge(badge, { texto: 'Últimas plazas' })
            return
        }

        var resultado

        if (evento === 'encierro') {
            resultado = _dispMensajeEncierro(disponibilidad)
        } else {
            var ids  = _dispServiceIds(evento)
            var item = ids.length > 0
                ? disponibilidad.find(function(d) { return d.service_id === ids[0] })
                : null
            resultado = item ? _dispMensajeSimple(item.free_slots) : { texto: 'Últimas plazas' }
        }

        _dispActualizarBadge(badge, resultado)
    })

    // Exponer datos para uso en el dialog
    window._dispDisponibilidad = disponibilidad
}

// ---- Ejecutar al cargar el DOM ----
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDisponibilidad)
} else {
    initDisponibilidad()
}