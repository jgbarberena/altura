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
    const contacto = document.getElementById("contacto");

    if (!header || !hamburger || !menu) return;

    window.addEventListener("scroll", function() {

        if (window.scrollY > 50) {
            header.classList.add("scrolled");
        } else {
            header.classList.remove("scrolled");
        }

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
