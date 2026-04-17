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
    const placeholder = document.getElementById(placeholderId);
    if (!placeholder) return;

    const url = `${window.BASE_URL}/${componentPath}`;

    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error(`Error ${res.status} cargando ${componentPath}`);
            return res.text();
        })
        .then(html => {
            // Insertar el HTML del componente dentro del placeholder
            placeholder.innerHTML = html;

            // Root real del componente (primer hijo)
            const root = placeholder.firstElementChild;

            // Copiar data-attributes del placeholder al root
            for (const attr of placeholder.attributes) {
                if (attr.name.startsWith("data-")) {
                    root.setAttribute(attr.name, attr.value);
                }
            }

            // Mantener el comportamiento anterior:
            // initFn recibe el placeholder (como antes), no el root
            if (typeof initFn === "function") {
                initFn(placeholder, window.resolveAsset, window.resolvePage);
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
loadComponent("miniGuias-placeholder",   "components/miniGuias.html",   initMiniGuias);
loadComponent("miniFAQ-placeholder",     "components/miniFAQ.html",     initMiniFAQ);
loadComponent("toko-placeholder",        "components/toko.html",        initTokoSection);
loadComponent("contact-placeholder",     "components/contact.html",     initFormulario);
loadComponent("whatsapp-placeholder",    "components/whatsapp.html",    initWhatsappIcon);
loadComponent("footer-placeholder",      "components/footer.html",      initFooter);
