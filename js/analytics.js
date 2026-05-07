// ======================================================
// ANALYTICS.JS — CARGA CONDICIONAL GA4 + EVENTOS AUTOMÁTICOS
// Se incluye en todas las páginas públicas (nunca en /admin/).
// Solo actúa si el usuario ha aceptado cookies.
// ======================================================

const ANALYTICS_MEASUREMENT_ID = 'G-L44JNZMWQR';
const CONSENT_KEY               = 'cookie_consent';
const CONSENT_TTL_DAYS          = 90;


// ======================================================
// 1. LEER CONSENTIMIENTO
// Devuelve true si existe, está aceptado y no ha caducado.
// ======================================================

function hasAnalyticsConsent() {
    try {
        const raw = localStorage.getItem(CONSENT_KEY);
        if (!raw) return false;

        const data = JSON.parse(raw);
        if (data.decision !== 'accepted') return false;

        const ageMs  = Date.now() - data.timestamp;
        const maxMs  = CONSENT_TTL_DAYS * 24 * 60 * 60 * 1000;
        if (ageMs > maxMs) {
            localStorage.removeItem(CONSENT_KEY);
            return false;
        }

        return true;
    } catch (e) {
        return false;
    }
}


// ======================================================
// 2. CARGAR GA4 DINÁMICAMENTE
// Inyecta el script de gtag.js y configura la propiedad.
// Se llama solo si hay consentimiento.
// ======================================================

function loadGA4() {
    if (window.__ga4Loaded) return;
    window.__ga4Loaded = true;

    // Script de carga de gtag.js
    const script = document.createElement('script');
    script.async = true;
    script.src   = `https://www.googletagmanager.com/gtag/js?id=${ANALYTICS_MEASUREMENT_ID}`;
    document.head.appendChild(script);

    // Inicialización del dataLayer y configuración
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;

    gtag('js', new Date());
    gtag('config', ANALYTICS_MEASUREMENT_ID);

    // Activar eventos automáticos una vez GA4 está listo
    script.addEventListener('load', initAutoEvents);
}


// ======================================================
// 3. EVENTOS AUTOMÁTICOS POR CLASES
// Se registran una sola vez, usando delegación de eventos.
// ======================================================

function initAutoEvents() {

    // --- 3a. CLICS EN ELEMENTOS DE ACCIÓN ---
    // Captura clics en btn-primary, btn-secondary, btn-link, text-link y whatsapp-float
    // desde cualquier punto de la página, incluyendo componentes cargados dinámicamente.

    const ACTION_CLASSES = ['btn-primary', 'btn-secondary', 'btn-link', 'text-link', 'whatsapp-float'];

    document.addEventListener('click', function (e) {
        if (!window.gtag) return;

        const el = e.target.closest(
            '.btn-primary, .btn-secondary, .btn-link, .text-link, .whatsapp-float'
        );
        if (!el) return;

        // Tipo: la primera clase de acción que tenga el elemento
        const type = ACTION_CLASSES.find(c => el.classList.contains(c)) || 'unknown';

        // Sección más cercana con id (para saber dónde estaba el botón)
        const section = el.closest('section[id]');

        window.gtag('event', 'cta_click', {
            element_type: type,
            element_text: el.innerText.trim().substring(0, 60),
            section_id:   section ? section.id : 'sin-seccion'
        });
    });


    // --- 3b. VISIBILIDAD DE SECCIONES ---
    // Registra un evento la primera vez que cada sección es visible en pantalla.
    // Útil para saber hasta dónde llegan los usuarios en cada página.

    if (!('IntersectionObserver' in window)) return;

    const sectionObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting || !window.gtag) return;

            window.gtag('event', 'section_view', {
                section_id:    entry.target.id || entry.target.className.split(' ')[0],
                section_title: entry.target.querySelector('h1, h2')
                                    ?.innerText.trim().substring(0, 60) || ''
            });

            // Solo una vez por sección por sesión
            sectionObserver.unobserve(entry.target);
        });
    }, {
        threshold: 0.3   // La sección debe estar al menos un 30% visible
    });

    document.querySelectorAll('section[id]').forEach(function (s) {
        sectionObserver.observe(s);
    });
}


// ======================================================
// 4. EVENTO DE ENVÍO DE FORMULARIO DE CONTACTO
// Se llama desde initFormulario() en main.js, que ya controla
// cuándo y cómo se envía el formulario. Se exporta como función global.
// ======================================================

// Registra el canal usado: 'whatsapp' o 'email'
window.trackFormSubmit = function (canal, interes) {
    if (!window.gtag) return;

    window.gtag('event', 'form_submit', {
        canal:   canal,          // 'whatsapp' | 'email'
        interes: interes || ''   // valor del select en el momento del envío
    });
};


// ======================================================
// 5. API PÚBLICA — para el banner de cookies
// Permite que el banner active GA4 en el momento de aceptación,
// sin necesidad de recargar la página.
// ======================================================

window.activateAnalytics = function () {
    if (hasAnalyticsConsent()) {
        loadGA4();
    }
};


// ======================================================
// 6. PUNTO DE ENTRADA
// Al cargar la página: si ya hay consentimiento, carga GA4 directamente.
// Si no, espera a que el banner llame a window.activateAnalytics().
// ======================================================

(function init() {
    if (hasAnalyticsConsent()) {
        // Esperar a que el DOM esté listo para los eventos de sección
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', loadGA4);
        } else {
            loadGA4();
        }
    }
})();