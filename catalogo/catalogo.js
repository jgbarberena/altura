// catalogo.js — Lógica del catálogo de venues para compartir con clientes
// Página: catalogo/index.html  (listado interno con secciones por event_type)
//         catalogo/balcon.html (ficha individual por slug+event_type)
// El cliente Supabase viene de window.supabasePublic (supabase-global.js).
// Datos: vista catalogo_publico — devuelve una fila por par venue+service_id.
// La agrupación por event_type se hace en cliente; la BD no cambia.
// El trigger trg_sync_photos_event_type en Supabase garantiza que todas las filas
// del mismo venue_id+event_type tienen siempre las mismas fotos.

var VENUE_TYPE_LABELS = {
    balcon:            'Balcón privado',
    barrera:           'Barrera del recorrido',
    guia:              'Visita guiada',
    servicio_especial: 'Experiencia especial'
}

var EVENT_TYPE_ORDER = ['encierro', 'chupinazo', 'procesion', 'despedida_gigantes', 'pobre_de_mi', 'visita_guiada', 'otro']

var EVENT_TYPE_LABELS = {
    encierro:           'Encierros',
    chupinazo:          'Chupinazo',
    procesion:          'Procesión de San Fermín',
    despedida_gigantes: 'Despedida de Gigantes',
    pobre_de_mi:        'Pobre de Mí',
    visita_guiada:      'Visitas Guiadas',
    otro:               'Otras Experiencias'
}

// Detectar página y arrancar
if (document.getElementById('catalogo-balcon-main')) {
    initFichaBalcon()
}
if (document.getElementById('catalogo-index-main')) {
    initListadoCatalogo()
}

// ============================================================
// FICHA DE VENUE (balcon.html?v=SLUG&et=EVENT_TYPE)
// ============================================================

async function initFichaBalcon() {
    var main = document.getElementById('catalogo-balcon-main')
    var params = new URLSearchParams(window.location.search)
    var slug = params.get('v')
    var et   = params.get('et')  // si está presente, muestra solo ese event_type

    if (!slug) {
        main.innerHTML = renderError('No se ha especificado un venue. Comprueba que la URL es correcta.')
        return
    }

    if (!window.supabasePublic) {
        main.innerHTML = renderError('Error al inicializar la conexión.')
        return
    }

    var result = await window.supabasePublic
        .from('catalogo_publico')
        .select('*')
        .eq('slug', slug)

    if (result.error) {
        console.error('[catalogo] Error cargando venue:', result.error)
        main.innerHTML = renderError('Error al cargar los datos del venue.')
        return
    }

    if (!result.data || result.data.length === 0) {
        main.innerHTML = renderError('No se ha encontrado este venue. Puede que la URL haya cambiado.')
        return
    }

    var filas = result.data

    var venue = {
        slug:         filas[0].slug,
        display_name: filas[0].display_name,
        address:      filas[0].address,
        venue_type:   filas[0].venue_type
    }

    if (et) {
        // Ficha de evento concreto
        var filasEt = filas.filter(function(r) { return (r.event_type || 'otro') === et })
        if (filasEt.length === 0) filasEt = filas  // fallback si el et no existe en este venue
        actualizarOGTags(venue, filasEt, et)
        renderFichaSimple(main, venue, filasEt, et)
    } else {
        // Ficha completa con todas las secciones (fallback para URLs sin &et=)
        actualizarOGTags(venue, filas, null)
        renderFichaMulti(main, venue, filas)
    }

    initCarruseles()
}

// Ficha de un único event_type (URL con &et=)
function renderFichaSimple(main, venue, filas, et) {
    var nombre    = venue.display_name || venue.slug
    var tipoLabel = VENUE_TYPE_LABELS[venue.venue_type] || venue.venue_type
    var etLabel   = EVENT_TYPE_LABELS[et] || et

    // Recopilar fotos y textos de todas las filas del event_type (trigger las sincroniza)
    var photos = []
    var vistos = {}
    var description = null
    var access_instructions = null

    filas.forEach(function(row) {
        if (Array.isArray(row.photos)) {
            row.photos.forEach(function(url) {
                if (url && !vistos[url]) { vistos[url] = true; photos.push(url) }
            })
        }
        if (!description && row.description) description = row.description
        if (!access_instructions && row.access_instructions) access_instructions = row.access_instructions
    })

    main.innerHTML = ''

    var dossier = document.createElement('div')
    dossier.className = 'catalogo-dossier'

    var card = document.createElement('div')
    card.className = 'catalogo-dossier-card'

    var layout = document.createElement('div')
    layout.className = 'catalogo-dossier-layout'

    // --- CABECERA: tipo + nombre + evento + dirección ---
    var headerCol = document.createElement('div')
    headerCol.className = 'catalogo-dossier-header'

    var headerHtml = ''
    if (tipoLabel) {
        headerHtml += '<p class="text-tag catalogo-dossier-tipo">' + escHtml(tipoLabel) + '</p>'
    }
    headerHtml += '<h1 class="catalogo-dossier-nombre">' + escHtml(nombre) + '</h1>'
    if (etLabel) {
        headerHtml += '<p class="catalogo-dossier-evento">' + escHtml(etLabel) + '</p>'
    }
    if (venue.address) {
        headerHtml += '<div class="catalogo-meta-item">'
        headerHtml += '<span class="catalogo-meta-icon">&#128205;</span>'
        headerHtml += '<span>' + escHtml(venue.address) + '</span>'
        headerHtml += '</div>'
    }
    headerCol.innerHTML = headerHtml

    // --- CUERPO: fotos + descripción + acceso ---
    var bodyCol = document.createElement('div')
    bodyCol.className = 'catalogo-dossier-body'

    var bodyHtml = '<div class="catalogo-servicio-bloque">'

    if (photos.length > 1) {
        bodyHtml += renderCarouselHtml(photos, true)
    } else if (photos.length === 1) {
        bodyHtml += '<img class="catalogo-grupo-foto-unica" src="' + escAttr(photos[0]) + '" alt="" loading="eager">'
    }

    if (description) {
        bodyHtml += '<p class="text-body catalogo-descripcion">' + escHtml(description) + '</p>'
    }
    if (access_instructions) {
        bodyHtml += '<div class="catalogo-acceso">'
        bodyHtml += '<span class="catalogo-acceso-icon">&#128204;</span>'
        bodyHtml += '<div>'
        bodyHtml += '<p class="text-small catalogo-acceso-label">Instrucciones de acceso</p>'
        bodyHtml += '<p class="text-body">' + escHtml(access_instructions) + '</p>'
        bodyHtml += '</div>'
        bodyHtml += '</div>'
    }

    bodyHtml += '</div>'
    bodyCol.innerHTML = bodyHtml

    layout.appendChild(headerCol)
    layout.appendChild(bodyCol)
    card.appendChild(layout)
    dossier.appendChild(card)
    main.appendChild(dossier)
}

// Ficha completa con todas las secciones por event_type (fallback sin &et=)
function renderFichaMulti(main, venue, filas) {
    var nombre    = venue.display_name || venue.slug
    var tipoLabel = VENUE_TYPE_LABELS[venue.venue_type] || venue.venue_type

    // Agrupar filas por event_type; fotos del primer row con fotos de ese grupo
    var grupos = {}
    filas.forEach(function(row) {
        var et = row.event_type || 'otro'
        if (!grupos[et]) {
            grupos[et] = {
                service_name:        row.service_name || et,
                event_type:          et,
                description:         null,
                access_instructions: null,
                photos:              []
            }
        }
        if (grupos[et].photos.length === 0 && Array.isArray(row.photos) && row.photos.length > 0) {
            var vistos = {}
            grupos[et].photos = row.photos.filter(function(url) {
                if (!url || vistos[url]) return false
                vistos[url] = true
                return true
            })
        }
        if (!grupos[et].description && row.description) {
            grupos[et].description = row.description
        }
        if (!grupos[et].access_instructions && row.access_instructions) {
            grupos[et].access_instructions = row.access_instructions
        }
    })

    main.innerHTML = ''

    var dossier = document.createElement('div')
    dossier.className = 'catalogo-dossier'

    var card = document.createElement('div')
    card.className = 'catalogo-dossier-card'

    var layout = document.createElement('div')
    layout.className = 'catalogo-dossier-layout'

    var headerCol = document.createElement('div')
    headerCol.className = 'catalogo-dossier-header'

    var headerHtml = ''
    if (tipoLabel) {
        headerHtml += '<p class="text-tag catalogo-dossier-tipo">' + escHtml(tipoLabel) + '</p>'
    }
    headerHtml += '<h1 class="catalogo-dossier-nombre">' + escHtml(nombre) + '</h1>'
    if (venue.address) {
        headerHtml += '<div class="catalogo-meta-item">'
        headerHtml += '<span class="catalogo-meta-icon">&#128205;</span>'
        headerHtml += '<span>' + escHtml(venue.address) + '</span>'
        headerHtml += '</div>'
    }
    headerCol.innerHTML = headerHtml

    var bodyCol = document.createElement('div')
    bodyCol.className = 'catalogo-dossier-body'

    var bodyHtml = ''
    var esPrimero = true
    EVENT_TYPE_ORDER.forEach(function(et) {
        if (grupos[et]) {
            bodyHtml += renderGrupoBloque(grupos[et], esPrimero)
            esPrimero = false
        }
    })
    Object.keys(grupos).forEach(function(et) {
        if (EVENT_TYPE_ORDER.indexOf(et) === -1) {
            bodyHtml += renderGrupoBloque(grupos[et], false)
        }
    })
    bodyCol.innerHTML = bodyHtml

    layout.appendChild(headerCol)
    layout.appendChild(bodyCol)
    card.appendChild(layout)
    dossier.appendChild(card)
    main.appendChild(dossier)
}

// Sección de un event_type: titulo + carousel propio + descripción + acceso
function renderGrupoBloque(grupo, eagerFirst) {
    var html = '<div class="catalogo-servicio-bloque">'
    html += '<h2 class="catalogo-servicio-titulo">' + escHtml(grupo.service_name) + '</h2>'

    if (grupo.photos.length > 1) {
        html += renderCarouselHtml(grupo.photos, eagerFirst)
    } else if (grupo.photos.length === 1) {
        html += '<img class="catalogo-grupo-foto-unica" src="' + escAttr(grupo.photos[0]) + '" alt="" loading="' + (eagerFirst ? 'eager' : 'lazy') + '">'
    }

    if (grupo.description) {
        html += '<p class="text-body catalogo-descripcion">' + escHtml(grupo.description) + '</p>'
    }
    if (grupo.access_instructions) {
        html += '<div class="catalogo-acceso">'
        html += '<span class="catalogo-acceso-icon">&#128204;</span>'
        html += '<div>'
        html += '<p class="text-small catalogo-acceso-label">Instrucciones de acceso</p>'
        html += '<p class="text-body">' + escHtml(grupo.access_instructions) + '</p>'
        html += '</div>'
        html += '</div>'
    }

    html += '</div>'
    return html
}

function renderCarouselHtml(fotos, eagerFirst) {
    var html = '<div class="catalogo-carousel">'
    html += '<div class="catalogo-carousel-track">'
    fotos.forEach(function(url, i) {
        html += '<div class="catalogo-carousel-slide' + (i === 0 ? ' active' : '') + '">'
        html += '<img src="' + escAttr(url) + '" alt="" loading="' + (eagerFirst && i === 0 ? 'eager' : 'lazy') + '">'
        html += '</div>'
    })
    html += '</div>'
    html += '<button class="catalogo-carousel-btn catalogo-carousel-btn--prev" aria-label="Foto anterior">&#8249;</button>'
    html += '<button class="catalogo-carousel-btn catalogo-carousel-btn--next" aria-label="Foto siguiente">&#8250;</button>'
    html += '<div class="catalogo-carousel-counter"><span class="catalogo-carousel-cur">1</span>/<span class="catalogo-carousel-tot">' + fotos.length + '</span></div>'
    html += '</div>'
    return html
}

// ============================================================
// LISTADO INTERNO (index.html) — secciones por event_type
// ============================================================

async function initListadoCatalogo() {
    var main = document.getElementById('catalogo-index-main')

    if (!window.supabasePublic) {
        main.innerHTML = '<p class="text-body">Error al inicializar la conexión.</p>'
        return
    }

    var result = await window.supabasePublic
        .from('catalogo_publico')
        .select('slug, display_name, address, venue_type, photos, event_type, service_name, service_image_fallback')
        .order('display_name')

    if (result.error || !result.data || result.data.length === 0) {
        main.innerHTML = '<p class="text-body">No hay venues disponibles o no se pudo cargar el catálogo.</p>'
        return
    }

    // secciones[event_type][slug] = venueData
    // Un venue puede aparecer en varias secciones si ofrece varios event_types
    var secciones = {}
    result.data.forEach(function(row) {
        if (!row.slug) return
        var et = row.event_type || 'otro'
        if (!secciones[et]) secciones[et] = {}
        if (!secciones[et][row.slug]) {
            secciones[et][row.slug] = {
                slug:        row.slug,
                display_name: row.display_name,
                address:     row.address,
                venue_type:  row.venue_type,
                event_type:  et,
                photo:       _primeraFotoReal(row) || row.service_image_fallback || null
            }
        } else if (!secciones[et][row.slug].photo) {
            secciones[et][row.slug].photo = _primeraFotoReal(row) || row.service_image_fallback || null
        }
    })

    var fragment = document.createDocumentFragment()

    EVENT_TYPE_ORDER.forEach(function(et) {
        if (!secciones[et]) return
        var venuesList = []
        for (var s in secciones[et]) {
            if (secciones[et].hasOwnProperty(s)) venuesList.push(secciones[et][s])
        }
        if (venuesList.length === 0) return

        var section = document.createElement('div')
        section.className = 'catalogo-seccion'

        var heading = document.createElement('h2')
        heading.className = 'catalogo-seccion-titulo'
        heading.textContent = EVENT_TYPE_LABELS[et] || et
        section.appendChild(heading)

        var grid = document.createElement('div')
        grid.className = 'cards-grid cards-grid--3 catalogo-grid'

        venuesList.forEach(function(venue) {
            var nombre    = venue.display_name || venue.slug
            var tipoLabel = VENUE_TYPE_LABELS[venue.venue_type] || venue.venue_type
            // URL incluye &et= para que la ficha muestre solo este event_type
            var url       = 'balcon.html?v=' + encodeURIComponent(venue.slug) + '&et=' + encodeURIComponent(venue.event_type)

            var card = document.createElement('div')
            card.className = 'card catalogo-card'

            var inner = ''
            if (venue.photo) {
                inner += '<img src="' + escAttr(venue.photo) + '" alt="' + escAttr(nombre) + '" loading="lazy">'
            } else {
                inner += '<div class="catalogo-card-placeholder"></div>'
            }
            inner += '<div class="card-overlay">'
            inner += '<p class="text-tag">' + escHtml(tipoLabel) + '</p>'
            inner += '<h2>' + escHtml(nombre) + '</h2>'
            if (venue.address) {
                inner += '<p>' + escHtml(venue.address) + '</p>'
            }
            inner += '</div>'
            inner += '<a href="' + escAttr(url) + '" class="catalogo-card-link" aria-label="Ver ficha de ' + escAttr(nombre) + '"></a>'

            card.innerHTML = inner
            grid.appendChild(card)
        })

        section.appendChild(grid)
        fragment.appendChild(section)
    })

    main.innerHTML = ''
    main.appendChild(fragment)
}

function _primeraFotoReal(row) {
    if (Array.isArray(row.photos)) {
        for (var i = 0; i < row.photos.length; i++) {
            if (row.photos[i]) return row.photos[i]
        }
    }
    return null
}

// ============================================================
// CARRUSEL DE FOTOS
// ============================================================

function initCarruseles() {
    document.querySelectorAll('.catalogo-carousel').forEach(function(carousel) {
        var slides    = carousel.querySelectorAll('.catalogo-carousel-slide')
        var counterEl = carousel.querySelector('.catalogo-carousel-cur')
        var total     = slides.length
        var actual    = 0

        if (total === 0) return

        function irA(idx) {
            slides[actual].classList.remove('active')
            actual = (idx + total) % total
            slides[actual].classList.add('active')
            if (counterEl) counterEl.textContent = actual + 1
        }

        carousel.querySelector('.catalogo-carousel-btn--prev').addEventListener('click', function() {
            irA(actual - 1)
        })
        carousel.querySelector('.catalogo-carousel-btn--next').addEventListener('click', function() {
            irA(actual + 1)
        })

        var startX = 0
        carousel.addEventListener('touchstart', function(e) {
            startX = e.touches[0].clientX
        }, { passive: true })
        carousel.addEventListener('touchend', function(e) {
            var diff = startX - e.changedTouches[0].clientX
            if (Math.abs(diff) > 40) {
                irA(diff > 0 ? actual + 1 : actual - 1)
            }
        }, { passive: true })
    })
}

// ============================================================
// OG TAGS DINÁMICOS
// ============================================================

function actualizarOGTags(venue, filas, et) {
    var nombre  = venue.display_name || venue.slug
    var etLabel = et ? (EVENT_TYPE_LABELS[et] || et) : null
    var titulo  = etLabel
        ? nombre + ' · ' + etLabel + ' — Vive San Fermín desde dentro'
        : nombre + ' — Vive San Fermín desde dentro'

    var desc = 'Conoce este espacio y sus características para los grandes momentos de San Fermín.'
    if (filas.length > 0 && filas[0].description) {
        desc = filas[0].description.slice(0, 160)
        if (filas[0].description.length > 160) desc += '…'
    }

    var img = obtenerImagenHero(filas)

    setMetaOG('og:title', titulo)
    setMetaOG('og:description', desc)
    if (img) setMetaOG('og:image', img)
    setMetaOG('og:url', window.location.href)

    document.title = titulo
}

function obtenerImagenHero(filas) {
    for (var i = 0; i < filas.length; i++) {
        var photos = filas[i].photos
        if (Array.isArray(photos)) {
            for (var j = 0; j < photos.length; j++) {
                if (photos[j]) return photos[j]
            }
        }
        if (filas[i].service_image_fallback) return filas[i].service_image_fallback
    }
    return null
}

function setMetaOG(property, content) {
    var el = document.querySelector('meta[property="' + property + '"]')
    if (el) el.setAttribute('content', content)
}

// ============================================================
// HELPERS
// ============================================================

function escHtml(str) {
    if (!str) return ''
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

function escAttr(str) {
    if (!str) return ''
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function renderError(msg) {
    return '<section class="section section--first"><p class="text-body">' + escHtml(msg) + '</p></section>'
}
