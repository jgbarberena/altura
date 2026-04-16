// ======================================================
// 1. DETECTAR BASE_URL (local, GitHub Pages, dominio)
// ======================================================

// Este script está en /js/include.js dentro del proyecto.
// Eliminamos "/js/include.js" de su URL absoluta para obtener
// la raíz real del proyecto en cualquier entorno.
window.BASE_URL = document.currentScript.src.replace(/\/js\/include\.js.*/, '');


// ======================================================
// 2. FUNCIONES UNIVERSALES DE RESOLUCIÓN DE RUTAS
// ======================================================

// Archivos dentro del proyecto (imágenes, JSON, etc.)
window.resolveAsset = function(path) {
    // path es relativo al proyecto, por ejemplo:
    // "img/logos/logoSF.png"
    return `${window.BASE_URL}/${path}`;
};

// Páginas internas del proyecto
window.resolvePage = function(path) {
    // path es relativo al proyecto, por ejemplo:
    // "galeria/index.html"
    return `${window.BASE_URL}/${path}`;
};


// ======================================================
// 3. CARGADOR UNIVERSAL DE COMPONENTES
// ======================================================

function loadComponent(placeholderId, componentPath, initFn) {
    const container = document.getElementById(placeholderId);
    if (!container) return;

    const url = `${window.BASE_URL}/${componentPath}`;

    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error(`Error ${res.status} cargando ${componentPath}`);
            return res.text();
        })
        .then(html => {
            container.innerHTML = html;

            // Llamamos al init del componente, pasándole:
            // - root: el nodo raíz del componente
            // - resolveAsset: función universal para archivos
            // - resolvePage: función universal para páginas
            if (typeof initFn === "function") {
                initFn(container, window.resolveAsset, window.resolvePage);
            }

            // --- COPIAR ATRIBUTOS DEL PLACEHOLDER AL COMPONENTE ---
            const root = placeholder.firstElementChild;

            for (const attr of placeholder.attributes) {
                if (attr.name.startsWith("data-")) {
                    root.setAttribute(attr.name, attr.value);
                }
            }
        })
        .catch(err => {
            console.error(`Error cargando componente ${componentPath}:`, err);
        });
    
        setTimeout(() => {
            if (typeof initContactoFromURL === "function") {
                initContactoFromURL();
            }
        }, 100);
}


// ======================================================
// 4. LISTA DE COMPONENTES A CARGAR
// ======================================================

loadComponent("header-placeholder",      "components/header.html",      initHeader);
loadComponent("sticky-placeholder",      "components/stickyNav.html",   initStickyNav);
loadComponent("miniGallery-placeholder", "components/miniGallery.html", initMiniGallery);
loadComponent("toko-placeholder",        "components/toko.html",        initTokoSection);
loadComponent("contact-placeholder",     "components/contact.html",     initFormulario);
loadComponent("whatsapp-placeholder",    "components/whatsapp.html",    initWhatsappIcon);
loadComponent("footer-placeholder",      "components/footer.html",      initFooter);
