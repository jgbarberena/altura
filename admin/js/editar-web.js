import { requireAuth, logout } from './auth.js'
import { initSidebar } from './utils.js'

requireAuth()
initSidebar()
document.getElementById('btnLogout').addEventListener('click', logout)

// ─── Mapa de rutas a nombres legibles ────────────────────────────────────────
const NOMBRES = {
    '/':                                              'Inicio',
    '/experiencias/':                                 'Experiencias — índice',
    '/experiencias/encierro/':                        'Encierro',
    '/experiencias/chupinazo/':                       'Chupinazo',
    '/experiencias/procesion/':                       'Procesión',
    '/experiencias/pobre-de-mi/':                     'Pobre de Mí',
    '/experiencias/gigantes/':                        'Despedida Gigantes',
    '/experiencias/personalizadas/':                  'Personalizadas',
    '/empresa/':                                      'Empresa',
    '/equipo/':                                       'Equipo',
    '/toko/':                                         'Toko Collection',
    '/faq/':                                          'FAQ',
    '/momenticos/':                                   'Momenticos',
    '/legal/':                                        'Legal',
    '/guias/':                                        'Guías — índice',
    '/guias/ver-procesion-san-fermin.html':            'Guía: Procesión',
    '/guias/ver-encierro-pamplona.html':               'Guía: Ver encierro',
    '/guias/san-fermin-mas-alla.html':                 'Guía: Más allá',
    '/guias/san-fermin-desde-dentro.html':             'Guía: Desde dentro',
    '/guias/san-fermin-autentico.html':                'Guía: San Fermín auténtico',
    '/guias/que-hacer-san-fermin.html':                'Guía: Qué hacer',
    '/guias/programa-san-fermin.html':                 'Guía: Programa',
    '/guias/primera-vez-san-fermin.html':              'Guía: Primera vez',
    '/guias/mananas-sanfermineras.html':               'Guía: Mañanas sanfermineras',
    '/guias/hospitality-corporativo.html':             'Guía: Hospitality',
    '/guias/experiencias-personalizadas.html':         'Guía: Personalizadas',
    '/guias/experiencias-exclusivas-san-fermin.html':  'Guía: Experiencias exclusivas',
    '/guias/encierro-balcon-privado.html':             'Guía: Balcón encierro',
    '/guias/chupinazo-exclusivo.html':                 'Guía: Chupinazo exclusivo',
}

const BASE_URL = 'https://www.experienciasanfermin.com'

function urlToPath(url) {
    let path = url.replace(BASE_URL, '') || '/'
    if (path === '/') return '../index.html'
    if (path.endsWith('/')) return '..' + path + 'index.html'
    return '..' + path
}

function urlToKey(url) {
    return url.replace(BASE_URL, '') || '/'
}

// ─── Elementos del DOM ───────────────────────────────────────────────────────
const iframe      = document.getElementById('editorIframe')
const pagLabel    = document.getElementById('pageLabel')
const statusEl    = document.getElementById('iframeStatus')
const navEl       = document.getElementById('pagesNav')
const placeholder = document.getElementById('iframePlaceholder')

let activeItem = null

function setStatus(state, text) {
    statusEl.className = 'iframe-status ' + state
    statusEl.textContent = text
}

function loadPage(path, label, item) {
    if (activeItem) activeItem.classList.remove('active')
    activeItem = item
    item.classList.add('active')

    pagLabel.textContent = label
    setStatus('loading', 'Cargando…')
    placeholder.style.display = 'none'
    iframe.style.display = 'block'
    iframe.src = path
}

iframe.addEventListener('load', () => {
    if (!iframe.src || iframe.src === location.href) return
    try {
        const doc = iframe.contentDocument
        if (!doc || !doc.body) { setStatus('error', 'Sin acceso al documento'); return }

        // Las imágenes con loading="lazy" no cargan fuera del viewport del iframe.
        // Cambiamos a eager y reseteamos src para que el navegador las encole.
        doc.querySelectorAll('img[loading="lazy"]').forEach(img => {
            img.loading = 'eager'
            const src = img.getAttribute('src')
            if (src) { img.removeAttribute('src'); img.setAttribute('src', src) }
        })

        setStatus('ok', 'Cargado (sin JS)')
    } catch (e) {
        setStatus('error', 'Error de acceso al iframe')
    }
})

iframe.addEventListener('error', () => setStatus('error', 'No se pudo cargar la página'))

// ─── Carga y renderizado del selector de páginas ─────────────────────────────
async function init() {
    let urls
    try {
        const res  = await fetch('../sitemap.xml')
        const text = await res.text()
        const xml  = new DOMParser().parseFromString(text, 'application/xml')
        urls = [...xml.querySelectorAll('url loc')].map(el => el.textContent.trim())
    } catch (e) {
        navEl.innerHTML = `<p style="padding:16px;color:var(--accent);font-size:12px">Error al leer sitemap.xml</p>`
        return
    }

    // Clasificar por grupo
    const groups = { inicio: [], experiencias: [], guias: [], otros: [] }
    for (const url of urls) {
        const key = urlToKey(url)
        if (key === '/') {
            groups.inicio.push(url)
        } else if (key.startsWith('/experiencias')) {
            groups.experiencias.push(url)
        } else if (key.startsWith('/guias')) {
            groups.guias.push(url)
        } else {
            groups.otros.push(url)
        }
    }

    const groupDefs = [
        { id: 'inicio',       label: 'Inicio' },
        { id: 'experiencias', label: 'Experiencias' },
        { id: 'otros',        label: 'Otros' },
        { id: 'guias',        label: 'Guías' },
    ]

    navEl.innerHTML = ''

    for (const gd of groupDefs) {
        const groupUrls = groups[gd.id]
        if (!groupUrls.length) continue

        const groupEl = document.createElement('div')
        groupEl.className = 'pages-group'
        groupEl.innerHTML = `<div class="pages-group-title">${gd.label}</div>`

        for (const url of groupUrls) {
            const key   = urlToKey(url)
            const label = NOMBRES[key] || key
            const path  = urlToPath(url)

            const a = document.createElement('a')
            a.className  = 'page-item'
            a.textContent = label
            a.title      = key
            a.addEventListener('click', () => loadPage(path, label, a))
            groupEl.appendChild(a)
        }

        navEl.appendChild(groupEl)
    }
}

init()
