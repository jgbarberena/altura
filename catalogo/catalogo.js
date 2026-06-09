// catalogo.js — Lógica del catálogo de venues para compartir con clientes
// Página: catalogo/index.html  (listado interno)
//         catalogo/balcon.html (ficha individual por slug)
// El cliente Supabase viene de window.supabasePublic (supabase-global.js).
// Datos: vista catalogo_publico — devuelve una fila por servicio del venue.

var VENUE_TYPE_LABELS = {
    balcon:            'Balcón privado',
    barrera:           'Barrera del recorrido',
    guia:              'Visita guiada',
    servicio_especial: 'Experiencia especial'
}

// Detectar página y arrancar
if (document.getElementById('catalogo-balcon-main')) {
    initFichaBalcon()
}
if (document.getElementById('catalogo-index-main')) {
    initListadoCatalogo()
}

// ============================================================
// FICHA DE VENUE (balcon.html?v=SLUG)
// ============================================================

async function initFichaBalcon() {
    var main = document.getElementById('catalogo-balcon-main')
    var params = new URLSearchParams(window.location.search)
    var slug = params.get('v')

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
    // Datos del venue — iguales en todas las filas
    var venue = {
        slug:         filas[0].slug,
        display_name: filas[0].display_name,
        address:      filas[0].address,
        venue_type:   filas[0].venue_type
    }
    var servicios = filas  // una fila por servicio

    actualizarOGTags(venue, servicios)

    var nombre    = venue.display_name || venue.slug
    var tipoLabel = VENUE_TYPE_LABELS[venue.venue_type] || venue.venue_type

    // Reunir todas las fotos de todos los servicios para el carrusel izquierdo
    var todasFotos = []
    servicios.forEach(function(svc) {
        var ps = Array.isArray(svc.photos) ? svc.photos.filter(Boolean) : []
        todasFotos = todasFotos.concat(ps)
    })
    if (todasFotos.length === 0) {
        for (var i = 0; i < servicios.length; i++) {
            if (servicios[i].service_image_fallback) {
                todasFotos.push(servicios[i].service_image_fallback)
                break
            }
        }
    }

    main.innerHTML = ''

    var dossier = document.createElement('div')
    dossier.className = 'catalogo-dossier'

    var card = document.createElement('div')
    card.className = 'catalogo-dossier-card'

    var layout = document.createElement('div')
    layout.className = 'catalogo-dossier-layout'

    // --- COLUMNA DE FOTOS (izquierda en desktop, centro en mobile) ---
    var fotosCol = document.createElement('div')
    fotosCol.className = 'catalogo-dossier-fotos'

    if (todasFotos.length > 1) {
        var carouselHtml = '<div class="catalogo-carousel">'
        carouselHtml += '<div class="catalogo-carousel-track">'
        todasFotos.forEach(function(url, i) {
            carouselHtml += '<div class="catalogo-carousel-slide' + (i === 0 ? ' active' : '') + '">'
            carouselHtml += '<img src="' + escAttr(url) + '" alt="" loading="' + (i === 0 ? 'eager' : 'lazy') + '">'
            carouselHtml += '</div>'
        })
        carouselHtml += '</div>'
        carouselHtml += '<button class="catalogo-carousel-btn catalogo-carousel-btn--prev" aria-label="Foto anterior">&#8249;</button>'
        carouselHtml += '<button class="catalogo-carousel-btn catalogo-carousel-btn--next" aria-label="Foto siguiente">&#8250;</button>'
        carouselHtml += '<div class="catalogo-carousel-counter"><span class="catalogo-carousel-cur">1</span>/<span class="catalogo-carousel-tot">' + todasFotos.length + '</span></div>'
        carouselHtml += '</div>'
        fotosCol.innerHTML = carouselHtml
    } else if (todasFotos.length === 1) {
        fotosCol.innerHTML = '<img class="catalogo-dossier-foto-unica" src="' + escAttr(todasFotos[0]) + '" alt="" loading="eager">'
    } else {
        fotosCol.innerHTML = '<div class="catalogo-dossier-foto-placeholder"></div>'
    }

    // --- CABECERA: tipo + nombre + dirección ---
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

    // --- CUERPO: bloques de servicio + contacto ---
    var bodyCol = document.createElement('div')
    bodyCol.className = 'catalogo-dossier-body'

    var bodyHtml = ''
    servicios.forEach(function(svc) {
        bodyHtml += renderServicioBloque(svc)
    })
    bodyCol.innerHTML = bodyHtml

    // DOM order = orden visual mobile: cabecera → fotos → cuerpo
    // En desktop el grid los recoloca visualmente sin tocar el DOM
    layout.appendChild(headerCol)
    layout.appendChild(fotosCol)
    layout.appendChild(bodyCol)
    card.appendChild(layout)
    dossier.appendChild(card)
    main.appendChild(dossier)

    initCarruseles()
}

// Bloque de un servicio dentro del panel de info (sin fotos — van todas en el carrusel izquierdo)
function renderServicioBloque(svc) {
    var nombre = svc.service_name || svc.service_id
    var html = '<div class="catalogo-servicio-bloque">'

    var titulo = svc.day
        ? (escHtml(nombre) + ' <span class="catalogo-servicio-dia">&mdash; ' + svc.day + ' de julio</span>')
        : escHtml(nombre)
    html += '<h2 class="catalogo-servicio-titulo">' + titulo + '</h2>'

    if (svc.description) {
        html += '<p class="text-body catalogo-descripcion">' + escHtml(svc.description) + '</p>'
    }

    if (svc.access_instructions) {
        html += '<div class="catalogo-acceso">'
        html += '<span class="catalogo-acceso-icon">&#128204;</span>'  // 📌 chincheta
        html += '<div>'
        html += '<p class="text-small catalogo-acceso-label">Instrucciones de acceso</p>'
        html += '<p class="text-body">' + escHtml(svc.access_instructions) + '</p>'
        html += '</div>'
        html += '</div>'
    }

    html += '</div>'
    return html
}

// ============================================================
// LISTADO INTERNO (index.html)
// ============================================================

async function initListadoCatalogo() {
    var main = document.getElementById('catalogo-index-main')

    if (!window.supabasePublic) {
        main.innerHTML = '<p class="text-body">Error al inicializar la conexión.</p>'
        return
    }

    var result = await window.supabasePublic
        .from('catalogo_publico')
        .select('slug, display_name, address, venue_type, photos, service_image_fallback')
        .order('slug')

    if (result.error || !result.data || result.data.length === 0) {
        main.innerHTML = '<p class="text-body">No hay venues disponibles o no se pudo cargar el catálogo.</p>'
        return
    }

    // Deduplicar por slug — puede haber varias filas por venue (un servicio por fila)
    var idxMap = {}  // slug → índice en venues[]
    var venues = []
    result.data.forEach(function(row) {
        if (!idxMap.hasOwnProperty(row.slug)) {
            idxMap[row.slug] = venues.length
            venues.push({
                slug:         row.slug,
                display_name: row.display_name,
                address:      row.address,
                venue_type:   row.venue_type,
                foto:         _primeraFoto(row)
            })
        } else if (!venues[idxMap[row.slug]].foto) {
            venues[idxMap[row.slug]].foto = _primeraFoto(row)
        }
    })

    var grid = document.createElement('div')
    grid.className = 'cards-grid cards-grid--3 catalogo-grid'

    venues.forEach(function(venue) {
        var nombre    = venue.display_name || venue.slug
        var tipoLabel = VENUE_TYPE_LABELS[venue.venue_type] || venue.venue_type
        var url       = 'balcon.html?v=' + encodeURIComponent(venue.slug)

        var card = document.createElement('div')
        card.className = 'card catalogo-card'

        var inner = ''
        if (venue.foto) {
            inner += '<img src="' + escAttr(venue.foto) + '" alt="' + escAttr(nombre) + '" loading="lazy">'
        } else {
            inner += '<div class="catalogo-card-placeholder"></div>'
        }
        inner += '<div class="card-overlay">'
        inner += '<p class="text-tag">' + escHtml(tipoLabel) + '</p>'
        inner += '<h2 class="text-title">' + escHtml(nombre) + '</h2>'
        if (venue.address) {
            inner += '<p class="text-small">' + escHtml(venue.address) + '</p>'
        }
        inner += '<a href="' + escAttr(url) + '" class="btn btn-primary btn-mini">Ver ficha</a>'
        inner += '</div>'

        card.innerHTML = inner
        grid.appendChild(card)
    })

    main.innerHTML = ''
    main.appendChild(grid)
}

function _primeraFoto(row) {
    if (Array.isArray(row.photos)) {
        for (var i = 0; i < row.photos.length; i++) {
            if (row.photos[i]) return row.photos[i]
        }
    }
    return row.service_image_fallback || null
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

function actualizarOGTags(venue, servicios) {
    var nombre = venue.display_name || venue.slug
    var titulo = nombre + ' — Vive San Fermín desde dentro'

    var desc = 'Conoce este espacio y sus características para los grandes momentos de San Fermín.'
    if (servicios.length > 0 && servicios[0].description) {
        desc = servicios[0].description.slice(0, 160)
        if (servicios[0].description.length > 160) desc += '…'
    }

    var img = obtenerImagenHero(servicios)

    setMetaOG('og:title', titulo)
    setMetaOG('og:description', desc)
    if (img) setMetaOG('og:image', img)
    setMetaOG('og:url', window.location.href)

    document.title = titulo
}

function obtenerImagenHero(servicios) {
    for (var i = 0; i < servicios.length; i++) {
        var photos = servicios[i].photos
        if (Array.isArray(photos)) {
            for (var j = 0; j < photos.length; j++) {
                if (photos[j]) return photos[j]
            }
        }
        if (servicios[i].service_image_fallback) return servicios[i].service_image_fallback
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
