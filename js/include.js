// Aseguramos BASE_URL también desde este script (por si se carga antes que main.js)
if (!window.BASE_URL) {
    window.BASE_URL = document.currentScript.src.replace(/\/js\/include\.js.*/, '');
}

function loadComponent(id, file) {
    const container = document.getElementById(id);
    if (!container) return;

    const url = `${window.BASE_URL}/${file}`;

    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error(res.status);
            return res.text();
        })
        .then(html => {
            container.innerHTML = html;

            if (id === "header-placeholder") {
                initHeader();
                initHeaderAssetsAndLinks();
            }

            if (id === "contact-placeholder") {
                initFormulario();
                initContactoFromURL();
            }
            
            if (id === "whatsapp-placeholder") {
                initWhatsappIcon();
            }

            if (id === "toko-placeholder") {
                initTokoSection();
            }
        })
        .catch(err => {
            console.error("Error cargando:", file, err);
        });
}

loadComponent("header-placeholder", "components/header.html");
loadComponent("toko-placeholder", "components/toko.html");
loadComponent("contact-placeholder", "components/contact.html");
loadComponent("whatsapp-placeholder", "components/whatsapp.html");
loadComponent("footer-placeholder", "components/footer.html");

function initHeaderAssetsAndLinks() {
    const base = window.BASE_URL || '';

    // LOGOS
    document.querySelectorAll('.logo-white').forEach(img => {
        img.src = base + '/img/sanfermin-logo-white.png';
    });
    document.querySelectorAll('.logo-black').forEach(img => {
        img.src = base + '/img/sanfermin-logo-black.png';
    });
    document.querySelectorAll('.logo-red').forEach(img => {
        img.src = base + '/img/sanfermin-logo-red.png';
    });

    // LOGO → HOME o scroll arriba si ya estamos en la home
    const logoLink = document.getElementById('logo-link');
    if (logoLink) {
    const base = window.BASE_URL || '';
    const homePath = new URL(base + '/', window.location.origin).pathname;
    const currentPath = window.location.pathname;
    const isHome = currentPath === homePath;

    // Aseguramos href siempre a la home real
    logoLink.href = homePath;

    // Si estamos en la home, interceptamos el clic para scroll suave
    logoLink.addEventListener('click', function(e){
        if (!isHome) return; // fuera de la home dejamos la navegación por defecto
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, false);

    // Accesibilidad: Enter / Space también hacen scroll en la home
    logoLink.addEventListener('keydown', function(e){
        if (!isHome) return;
        if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
    }

    // ENLACES DEL MENÚ
    document.querySelectorAll('.menu a').forEach(a => {
        const type = a.getAttribute('data-link');

        if (type === 'empresa') {
            a.href = base + '/empresa/index.html';
            return;
        }

        const isHome =
            window.location.pathname.endsWith('/index.html') ||
            window.location.pathname.endsWith('/altura/') ||
            window.location.pathname === '/' ||
            window.location.pathname === '/altura';

        const hash = '#' + type;

        if (isHome) {
            a.href = hash;
        } else {
            a.href = base + '/index.html' + hash;
        }
    });
}

function initWhatsappIcon() {
    const base = window.BASE_URL || '';
    const icon = document.querySelector('.my-float');
    if (icon) {
        icon.src = base + '/img/WhatsApp.svg.webp';
    }
}

function initTokoSection() {
    const base = window.BASE_URL || '';

    // Asignar imágenes de fondo
    document.querySelectorAll('.toko-slide').forEach(slide => {
        const file = slide.getAttribute('data-img');
        slide.style.backgroundImage = `url('${base}/img/${file}')`;
    });

    // Botón 1 → contacto con interés preseleccionado
    document.querySelectorAll('[data-toko-btn="contacto"]').forEach(btn => {
        btn.href = '?interes=toko#contacto';
    });

    // Botón 2 → página de colección
    document.querySelectorAll('[data-toko-btn="coleccion"]').forEach(btn => {
        btn.href = base + '/toko/index.html';
    });
}
