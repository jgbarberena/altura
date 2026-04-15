// URL base del proyecto (local, GitHub Pages, dominio…)
window.BASE_URL = document.currentScript.src.replace(/\/js\/main\.js.*/, '');

document.addEventListener("DOMContentLoaded", () => {

    initHeader();
    initCarousel();

});


// =========================
// HEADER
// =========================

function initHeader() {

    const header = document.getElementById("header");
    const hamburger = document.getElementById("hamburger");
    const menu = document.querySelector(".menu");
    const menuLinks = document.querySelectorAll(".menu a");

    if (!header || !hamburger || !menu) return;

    window.addEventListener("scroll", function() {

        if (window.scrollY > 50) {
            header.classList.add("scrolled");
        } else {
            header.classList.remove("scrolled");
        }

        const contacto = document.querySelector(".contacto"); //Posible cambio a IntersectionObserver

        if (contacto) {
            const rect = contacto.getBoundingClientRect();

            if (rect.top <= 80 && rect.bottom >= 80) {
                header.classList.add("dark");
            } else {
                header.classList.remove("dark");
            }
        }
    });

    hamburger.addEventListener("click", function() {
        menu.classList.toggle("active");
    });

    menuLinks.forEach(link => {
        link.addEventListener("click", () => {
            menu.classList.remove("active");
        });
    });
}

// =========================
// MENU STICKY
// =========================
function initStickyNav() {
    
    // 1. Detecta el componente
    const nav = document.querySelector('[data-sticky-nav]');
    if (!nav) return;
    
    // 2. Detecta las secciones sticky
    const sections = [...document.querySelectorAll('[data-sticky-section]')];
    if (sections.length === 0) return;
    
    // 3. Genera el menú automáticamente
    const ul = nav.querySelector('ul');
    ul.innerHTML = sections.map(sec => {
            const id = sec.id;
            const title = sec.dataset.stickySection || sec.querySelector('h2')?.textContent || id;
            return `<li><a href="#${id}">${title}</a></li>`;
    }).join('');

    // 4. Medir la altura real del sticky nav
    function updateStickyHeight() {
        const height = nav.offsetHeight;
        document.documentElement.style.setProperty('--sticky-height', `${height}px`);
    }

    // 6. Inicializar
    updateStickyHeight();

    // 7. Recalcular en resize
        window.addEventListener('resize', () => {
        updateStickyHeight();
    });
}


// =========================
// CAROUSEL PRO (LOOP + SNAP)
// =========================

function initCarousel() {
    const track = document.querySelector('.carousel-track');
    if (!track) return;

    const slides = Array.from(document.querySelectorAll('.carousel-track picture'));
    const prevBtn = document.querySelector('.carousel-btn.prev');
    const nextBtn = document.querySelector('.carousel-btn.next');

    if (slides.length === 0) return;

    let isJumping = false;

    // índice lógico (empezamos en el primer real, que en tu estructura es el 2)
    let currentIndex = 2;

    function getSlideWidth() {
        return slides[0].getBoundingClientRect().width;
    }

    function goToIndex(index, smooth = true) {
        const slideWidth = getSlideWidth();
        const targetScroll = slideWidth * index;

        isJumping = !smooth;

        track.style.scrollBehavior = smooth ? "smooth" : "auto";
        track.style.scrollSnapType = smooth ? "x mandatory" : "none";

        track.scrollLeft = targetScroll;

        if (!smooth) {
            setTimeout(() => {
                track.style.scrollBehavior = "smooth";
                track.style.scrollSnapType = "x mandatory";
                isJumping = false;
            }, 20);
        }

        updateActive();
    }

    function updateActive() {
        const center = track.scrollLeft + track.clientWidth / 2;

        slides.forEach(slide => {
            const rect = slide.getBoundingClientRect();
            const slideCenter = slide.offsetLeft + rect.width / 2;
            if (Math.abs(center - slideCenter) < rect.width / 2) {
                slide.classList.add('active');
            } else {
                slide.classList.remove('active');
            }
        });
    }

    // posición inicial
    goToIndex(currentIndex, false);

    nextBtn.addEventListener('click', () => {
        const lastIndex = slides.length - 3; // antes de clones finales
        if (currentIndex >= lastIndex) {
            // estamos en el último real → saltamos al primero real
            currentIndex = 2;
            goToIndex(currentIndex, false);
        } else {
            currentIndex++;
            goToIndex(currentIndex, true);
        }
    });

    prevBtn.addEventListener('click', () => {
        const firstIndex = 2; // primer real
        if (currentIndex <= firstIndex) {
            // estamos en el primero real → saltamos al último real
            currentIndex = slides.length - 3;
            goToIndex(currentIndex, false);
        } else {
            currentIndex--;
            goToIndex(currentIndex, true);
        }
    });

    // sincronizar en scroll manual (táctil / ratón)
    track.addEventListener('scroll', () => {
        if (isJumping) return;

        const slideWidth = getSlideWidth();
        const approxIndex = Math.round(track.scrollLeft / slideWidth);

        // límites reales
        const firstReal = 2;
        const lastReal = slides.length - 3;

        if (approxIndex <= 1) {
            currentIndex = lastReal;
            goToIndex(currentIndex, false);
            return;
        }

        if (approxIndex >= slides.length - 2) {
            currentIndex = firstReal;
            goToIndex(currentIndex, false);
            return;
        }

        currentIndex = approxIndex;
        updateActive();
    });

    window.addEventListener('resize', () => {
        goToIndex(currentIndex, false);
    });

    // =========================
    // CLICK SOLO EN LA ACTIVA
    // =========================

    track.addEventListener('click', (e) => {
        const active = document.querySelector('.carousel-track picture.active');
        if (!active) return;

        // Si ya estamos en la galería, no hacemos nada
        const path = window.location.pathname;
        if (path.includes("galeria")) return;

        // Si el click fue dentro de la imagen activa → navegar
        if (active.contains(e.target)) {
            window.location.href = "galeria/index.html";
        }
    });


}


// =========================
// FORMULARIO → WHATSAPP + EMAIL (MEJORADO)
// =========================

function initFormulario() {

    const form = document.getElementById("form-contacto");
    if (!form) return;

    const getFormData = () => {
        return {
            nombre: form.querySelector('input[type="text"]').value.trim(),
            email: form.querySelector('input[type="email"]').value.trim(),
            telefono: form.querySelector('input[type="tel"]').value.trim(),
            interes: form.querySelector('select').value,
            mensaje: form.querySelector('textarea').value.trim()
        };
    };

    const buildMensaje = (data) => {

        let texto = `Hola, quiero vivir una experiencia en San Fermín:\n\n`;

        if (data.nombre) texto += `Nombre: ${data.nombre}\n`;
        if (data.email) texto += `Email: ${data.email}\n`;
        if (data.telefono) texto += `Teléfono: ${data.telefono}\n`;
        if (data.interes && data.interes !== "Quiero vivir...") {
            texto += `Interés: ${data.interes}\n`;
        }

        if (data.mensaje) {
            texto += `\nMensaje:\n${data.mensaje}`;
        }

        return texto;
    };

    // =========================
    // WHATSAPP (submit)
    // =========================

    form.addEventListener("submit", function(e) {
        e.preventDefault();

        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const data = getFormData();
        const texto = buildMensaje(data);

        const url = `https://wa.me/34625638977?text=${encodeURIComponent(texto)}`;
        window.open(url, "_blank");
    });

    // =========================
    // EMAIL
    // =========================

    const emailBtn = document.getElementById("btn-email");

    if (emailBtn) {
        emailBtn.addEventListener("click", function() {

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const data = getFormData();
            const cuerpo = buildMensaje(data);

            const asunto = "Solicitud experiencia San Fermín";

            const mailto = `mailto:paula@lemonmilk.es?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;

            window.location.href = mailto;
        });
    }
}

// =========================
// PRESELECCION INTERES EN FORMULARIO
// =========================

function initContactoFromURL() {
    const params = new URLSearchParams(window.location.search);

    const interesParam = params.get("interes");
    const hash = window.location.hash;

    const select = document.getElementById("interes");

    // ----------------------
    // 1. PRESELECCIÓN SELECT
    // ----------------------
    if (select) {
        const mapping = {
            encierros: "Encierros",
            chupinazo: "Chupinazo, procesion, gigantes",
            toko: "To-Ko Collection",
            personalizada: "Experiencia personalizada"
        };

        if (interesParam && mapping[interesParam.toLowerCase()]) {
            select.value = mapping[interesParam.toLowerCase()];
        } else {
            // RESET
            select.value = "";
        }
    }

    // ----------------------
    // 2. SCROLL A CONTACTO
    // ----------------------
    if (hash === "#contacto") {
        const tryScroll = () => {
            const contacto = document.querySelector("#contacto");

            if (contacto) {
                contacto.scrollIntoView({ behavior: "smooth" });
                return true;
            }
            return false;
        };

        // intentamos varias veces por timing de includes
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;

            if (tryScroll() || attempts > 10) {
                clearInterval(interval);
            }
        }, 50);
    }
}

// ----------------------
// FUNCION PARA MEDIR ALTURA DEL SCROLL
// ----------------------

    // ----------------------
    // HEADER HEIGHT SYSTEM (ROBUSTO)
    // ----------------------

    function setHeaderHeight() {
        const header = document.querySelector("header");
        if (!header) return;

        const height = header.offsetHeight;
        document.documentElement.style.setProperty("--header-height", `${height}px`);
    }


    // ----------------------
    // OPTIMIZADOR DE RESIZE / SCROLL
    // ----------------------

    let ticking = false;

    function updateHeaderHeight() {
        if (ticking) return;

        ticking = true;
        requestAnimationFrame(() => {
            setHeaderHeight();
            ticking = false;
        });
    }


    // ----------------------
    // INIT SEGURO (INCLUDES + LAYOUT + FONTS)
    // ----------------------

    function initHeaderHeightSystem() {

        // mediciones escalonadas (CLAVE para includes + fonts + render)
        setHeaderHeight();

        setTimeout(setHeaderHeight, 50);
        setTimeout(setHeaderHeight, 200);
        setTimeout(setHeaderHeight, 500);
        setTimeout(setHeaderHeight, 1000);
    }


    // ----------------------
    // OBSERVER (ULTRA ROBUSTO - CAMBIOS REALES DEL HEADER)
    // ----------------------

    function observeHeaderChanges() {
        const header = document.querySelector("header");
        if (!header) return;

        const observer = new ResizeObserver(() => {
            setHeaderHeight();
        });

        observer.observe(header);
    }


    // ----------------------
    // EVENTOS GLOBALES
    // ----------------------

    document.addEventListener("DOMContentLoaded", () => {
        initHeaderHeightSystem();
        observeHeaderChanges();
    });

    window.addEventListener("load", () => {
        initHeaderHeightSystem();
    });

    window.addEventListener("resize", updateHeaderHeight);
    window.addEventListener("scroll", updateHeaderHeight);

// ----------------------
// ACORDEON DEL FAQ
// ----------------------
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".faq-question").forEach(btn => {
        btn.addEventListener("click", () => {
            const item = btn.closest(".faq-item");

            document.querySelectorAll(".faq-item").forEach(i => {
                if (i !== item) i.classList.remove("active");
            });

            item.classList.toggle("active");
        });
    });
});