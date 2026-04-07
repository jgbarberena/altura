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
// CAROUSEL PRO (LOOP + SNAP)
// =========================

function initCarousel() {

    // 🔍 Selección de elementos
    const track = document.querySelector('.carousel-track');

    // 👉 Si no existe (en otras páginas), no hacer nada
    if (!track) return;

    const slides = document.querySelectorAll('.carousel-track img');
    const prevBtn = document.querySelector('.carousel-btn.prev');
    const nextBtn = document.querySelector('.carousel-btn.next');

    // 📏 Ancho de cada slide (incluyendo gap)
    let slideWidth = slides[0].clientWidth + 20;

    // 🔒 Flag para evitar "saltos visuales" durante el loop
    let isJumping = false;

    // =========================
    // POSICIÓN INICIAL
    // =========================
    // 👉 Empezamos en los slides reales (saltando los clones)
    track.scrollLeft = slideWidth * 2;


    // =========================
    // BOTONES
    // =========================

    nextBtn.addEventListener('click', () => {
        track.scrollBy({
            left: slideWidth,
            behavior: 'smooth'
        });
    });

    prevBtn.addEventListener('click', () => {
        track.scrollBy({
            left: -slideWidth,
            behavior: 'smooth'
        });
    });


    // =========================
    // LOOP INFINITO
    // =========================

    track.addEventListener('scroll', () => {

        // 🚫 Evita ejecutar lógica mientras reposicionamos
        if (isJumping) return;

        const maxScroll = track.scrollWidth - track.clientWidth;

        // ⬅️ LLEGAMOS AL PRINCIPIO (zona clones izquierda)
        if (track.scrollLeft <= slideWidth) {

            isJumping = true;

            // ⚡ Quitamos animación para salto invisible
            track.style.scrollBehavior = "auto";
            track.style.scrollSnapType = "none";

            // 👉 Saltamos al final real
            track.scrollLeft = maxScroll - (slideWidth * 3);

            // 🔁 Restauramos comportamiento normal
            setTimeout(() => {
                track.style.scrollBehavior = "smooth";
                track.style.scrollSnapType = "x mandatory";
                isJumping = false;
            }, 50);
        }

        // ➡️ LLEGAMOS AL FINAL (zona clones derecha)
        if (track.scrollLeft >= maxScroll - slideWidth) {

            isJumping = true;

            track.style.scrollBehavior = "auto";
            track.style.scrollSnapType = "none";

            // 👉 Saltamos al inicio real
            track.scrollLeft = slideWidth * 2;

            setTimeout(() => {
                track.style.scrollBehavior = "smooth";
                track.style.scrollSnapType = "x mandatory";
                isJumping = false;
            }, 50);
        }

        // 🎯 Actualizamos cuál está activa (zoom / efecto visual)
        updateActive();
    });


    // =========================
    // DETECTAR IMAGEN ACTIVA
    // =========================

    function updateActive() {

        // 📍 Centro del viewport del carrusel
        const center = track.scrollLeft + track.clientWidth / 2;

        slides.forEach(slide => {

            const slideCenter = slide.offsetLeft + slide.clientWidth / 2;

            // 👉 Si está cerca del centro → activa
            if (Math.abs(center - slideCenter) < slide.clientWidth / 2) {
                slide.classList.add('active');
            } else {
                slide.classList.remove('active');
            }
        });
    }


    // =========================
    // RESIZE (MUY IMPORTANTE)
    // =========================

    window.addEventListener('resize', () => {

        // 🔄 recalculamos ancho
        slideWidth = slides[0].clientWidth + 20;

        // 📍 recolocamos correctamente en zona real
        track.scrollLeft = slideWidth * 2;
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