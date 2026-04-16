// ======================================================
// MAIN.JS — LÓGICA GENERAL + INIT DE COMPONENTES
// (sin rutas, sin includes, sin BASE_URL)
// ======================================================



// ======================================================
// 1. HEADER (comportamiento + assets + links)
// ======================================================

function initHeader(root, resolveAsset, resolvePage) {

    // --- Reescritura de rutas de LOGOS ---
    root.querySelectorAll('[data-file]').forEach(img => {
        img.src = resolveAsset(img.dataset.file);
    });

    // --- Reescritura de enlaces del menú ---
    root.querySelectorAll('[data-page]').forEach(a => {
        a.href = resolvePage(a.dataset.page);
    });

    // --- Comportamiento del header ---
    const header = root.querySelector("#header");
    const hamburger = root.querySelector("#hamburger");
    const menu = root.querySelector(".menu");
    const menuLinks = root.querySelectorAll(".menu a");

    if (!header || !hamburger || !menu) return;

    window.addEventListener("scroll", function () {

        if (window.scrollY > 50) {
            header.classList.add("scrolled");
        } else {
            header.classList.remove("scrolled");
        }

        const contacto = document.querySelector(".contacto");

        if (contacto) {
            const rect = contacto.getBoundingClientRect();

            if (rect.top <= 80 && rect.bottom >= 80) {
                header.classList.add("dark");
            } else {
                header.classList.remove("dark");
            }
        }
    });

    hamburger.addEventListener("click", function () {
        menu.classList.toggle("active");
    });

    menuLinks.forEach(link => {
        link.addEventListener("click", () => {
            menu.classList.remove("active");
        });
    });
}


// ======================================================
// 2. STICKY NAV
// ======================================================

function initStickyNav(root, resolveAsset, resolvePage) {

    const nav = root.querySelector('[data-sticky-nav]');
    if (!nav) return;

    const sections = [...document.querySelectorAll('[data-sticky-section]')];
    if (sections.length === 0) return;

    const ul = nav.querySelector('ul');
    ul.innerHTML = sections.map(sec => {
        const id = sec.id;
        const title = sec.dataset.stickySection || sec.querySelector('h2')?.textContent || id;
        return `<li><a href="#${id}">${title}</a></li>`;
    }).join('');

    function updateStickyHeight() {
        const height = nav.offsetHeight;
        document.documentElement.style.setProperty('--sticky-height', `${height}px`);
    }

    updateStickyHeight();
    window.addEventListener('resize', updateStickyHeight);
}


// ======================================================
// 3. MINI GALLERY (comportamiento + carga dinámica)
// ======================================================

async function initMiniGallery(root, resolveAsset, resolvePage) {

    if (!root) return;

    // --- Cargar imágenes desde JSON ---
    await loadMiniGalleryImages(root, resolveAsset);

    const track = root.querySelector('.carousel-track');
    if (!track) return;

    const slides = Array.from(root.querySelectorAll('.carousel-track picture'));
    const prevBtn = root.querySelector('.carousel-btn.prev');
    const nextBtn = root.querySelector('.carousel-btn.next');

    if (slides.length === 0) return;

    let isJumping = false;
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

    goToIndex(currentIndex, false);

    nextBtn.addEventListener('click', () => {
        const lastIndex = slides.length - 3;
        if (currentIndex >= lastIndex) {
            currentIndex = 2;
            goToIndex(currentIndex, false);
        } else {
            currentIndex++;
            goToIndex(currentIndex, true);
        }
    });

    prevBtn.addEventListener('click', () => {
        const firstIndex = 2;
        if (currentIndex <= firstIndex) {
            currentIndex = slides.length - 3;
            goToIndex(currentIndex, false);
        } else {
            currentIndex--;
            goToIndex(currentIndex, true);
        }
    });

    track.addEventListener('scroll', () => {
        if (isJumping) return;

        const slideWidth = getSlideWidth();
        const approxIndex = Math.round(track.scrollLeft / slideWidth);

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

    track.addEventListener('click', (e) => {
        const active = root.querySelector('.carousel-track picture.active');
        if (!active) return;

        const path = window.location.pathname;
        if (path.includes("galeria")) return;

        if (active.contains(e.target)) {
            window.location.href = resolvePage("galeria/index.html");
        }
    });
}



// --- Carga dinámica de imágenes desde JSON ---
async function loadMiniGalleryImages(root, resolveAsset) {

    const track = root.querySelector('.carousel-track');
    if (!track) return;

    const jsonPath = track.dataset.json;
    const res = await fetch(resolveAsset(jsonPath));
    const images = await res.json();

    const categoryAttr = root.dataset.miniGalleryId;

    // Si no hay categoría → mostrar todas
    if (!categoryAttr || categoryAttr.trim() === "") {
        filtered = images;
    } else {
        // Convertir categorías del HTML en array
        const requested = categoryAttr
            .split(";")
            .map(c => c.trim().toLowerCase());

        filtered = images.filter(img => {
            if (!img.clasificacion) return false;

            // Convertir clasificacion del JSON en array
            const tags = img.clasificacion
                .split(";")
                .map(t => t.trim().toLowerCase());

            // Coincidencia si al menos una coincide
            return tags.some(tag => requested.includes(tag));
        });
    }

    // Si no hay imágenes, salimos
    if (filtered.length === 0) {
        console.warn("MiniGallery: no hay imágenes para la categoría:", category);
        return;
    }
    // Si no hay suficientes imágenes para clones, salimos
    if (filtered.length === 1 || filtered.length === 2) {
        // Mostrar imágenes tal cual, sin carrusel ni clones
        filtered.forEach(img => {
            const picture = document.createElement('picture');
            picture.innerHTML = `
                <source media="(max-width: 768px)" srcset="${resolveAsset('img/galeria/' + img.mobile)}">
                <source media="(min-width: 769px)" srcset="${resolveAsset('img/galeria/' + img.desktop)}">
                <img src="${resolveAsset('img/galeria/' + img.desktop)}" alt="${img.alt}" loading="lazy">
            `;
            track.appendChild(picture);
        });
        // No clones, no carrusel
        return;
    }

    // --- 3. Imágenes reales ---
    filtered.forEach(img => {
        const picture = document.createElement('picture');

        picture.innerHTML = `
            <source media="(max-width: 768px)" srcset="${resolveAsset('img/galeria/' + img.mobile)}">
            <source media="(min-width: 769px)" srcset="${resolveAsset('img/galeria/' + img.desktop)}">
            <img src="${resolveAsset('img/galeria/' + img.desktop)}" alt="${img.alt}" loading="lazy">
        `;

        track.appendChild(picture);
    });

    // --- 4. Clones para loop infinito ---
    const last1 = filtered[filtered.length - 2];
    const last2 = filtered[filtered.length - 1];

    [last1, last2].forEach(img => {
        const picture = document.createElement('picture');
        picture.classList.add('clone');

        picture.innerHTML = `
            <source media="(max-width: 768px)" srcset="${resolveAsset('img/galeria/' + img.mobile)}">
            <source media="(min-width: 769px)" srcset="${resolveAsset('img/galeria/' + img.desktop)}">
            <img src="${resolveAsset('img/galeria/' + img.desktop)}" alt="${img.alt}" loading="lazy">
        `;

        track.insertBefore(picture, track.firstChild);
    });

    const first1 = filtered[0];
    const first2 = filtered[1];

    [first1, first2].forEach(img => {
        const picture = document.createElement('picture');
        picture.classList.add('clone');

        picture.innerHTML = `
            <source media="(max-width: 768px)" srcset="${resolveAsset('img/galeria/' + img.mobile)}">
            <source media="(min-width: 769px)" srcset="${resolveAsset('img/galeria/' + img.desktop)}">
            <img src="${resolveAsset('img/galeria/' + img.desktop)}" alt="${img.alt}" loading="lazy">
        `;

        track.appendChild(picture);
    });
}

// ======================================================
// 4. MINI FAQ SECTION
// ======================================================

async function initMiniFAQ(root, resolveAsset) {

    const container = root.querySelector('.miniFAQ__list');
    const categoriesAttr = root.dataset.miniFaqId;

    // Convertir categorías del HTML en array
    const categories = categoriesAttr
        ? categoriesAttr.split(";").map(c => c.trim().toLowerCase())
        : null;

    // Cargar el HTML de faq/index.html
    const res = await fetch(resolveAsset("faq/index.html"));
    const html = await res.text();

    // Crear DOM temporal
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Seleccionar todas las secciones FAQ
    const sections = temp.querySelectorAll('.faq-section');

    sections.forEach(section => {

        const sectionId = section.id.toLowerCase();

        // Si hay categorías, filtrar
        if (categories && !categories.includes(sectionId)) return;

        // Copiar solo los faq-item
        section.querySelectorAll('.faq-item').forEach(item => {
            container.appendChild(item.cloneNode(true));
        });
    });

    // Si no hay FAQ, no romper nada
    if (!container.children.length) {
        container.innerHTML = "<p>No hay preguntas frecuentes disponibles.</p>";
    }

    // Aquí activamos el acordeón SOLO dentro de miniFAQ
    initFAQAccordionIn(container);
}


// ======================================================
// 5. TOKO SECTION
// ======================================================

function initTokoSection(root, resolveAsset, resolvePage) {

    // --- Imágenes de fondo ---
    root.querySelectorAll('.toko-slide').forEach(slide => {
        const file = slide.dataset.file;
        slide.style.backgroundImage = `url('${resolveAsset(file)}')`;
    });

    // --- Botón contacto con interés preseleccionado ---
    root.querySelectorAll('[data-toko-btn="contacto"]').forEach(btn => {
        btn.href = resolvePage('index.html') + '?interes=toko#contacto';
    });

    // --- Botón colección ---
    root.querySelectorAll('[data-toko-btn="coleccion"]').forEach(btn => {
        const page = btn.dataset.page;
        btn.href = resolvePage(page);
    });
}




// ======================================================
// 6. FORMULARIO
// ======================================================

function initFormulario(root, resolveAsset, resolvePage) {

    const form = root.querySelector("#form-contacto");
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

    form.addEventListener("submit", function (e) {
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

    const emailBtn = root.querySelector("#btn-email");

    if (emailBtn) {
        emailBtn.addEventListener("click", function () {

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

// ======================================================
// 7. CONTACTO DESDE URL
// ======================================================

function initContactoFromURL() {
    const params = new URLSearchParams(window.location.search);

    const interesParam = params.get("interes");
    const hash = window.location.hash;

    const select = document.getElementById("interes");

    // Evitar que el navegador haga scroll automático al hash
    if (window.location.hash === "#contacto") {
        history.replaceState(null, "", window.location.pathname + window.location.search);
    }

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
            select.value = "";
        }
    }

    // ----------------------
    // 2. SCROLL A CONTACTO
    // ----------------------
    // NUEVO: si hay interesParam, SIEMPRE queremos ir a contacto
    const mustScroll = (hash === "#contacto") || (interesParam !== null);

    if (mustScroll) {
        const tryScroll = () => {
            const contacto = document.querySelector("#contacto");

            if (contacto) {
                contacto.scrollIntoView({ behavior: "smooth" });
                // Restaurar el hash después del scroll
                history.replaceState(null, "", window.location.pathname + window.location.search + "#contacto");
                return true;
            }
            return false;
        };

        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;

            if (tryScroll() || attempts > 20) {
                clearInterval(interval);
            }
        }, 50);
    }
}


// ======================================================
// 8. WHATSAPP ICON
// ======================================================

function initWhatsappIcon(root, resolveAsset, resolvePage) {

    const icon = root.querySelector('.my-float');
    if (icon) {
        const file = icon.dataset.file;
        icon.src = resolveAsset(file);
    }
}




// ======================================================
// 9. FOOTER
// ======================================================

function initFooter(root, resolveAsset, resolvePage) {

    root.querySelectorAll('[data-page]').forEach(a => {
        a.href = resolvePage(a.dataset.page);
    });
}




// ======================================================
// 9. HEADER HEIGHT SYSTEM (igual que antes)
// ======================================================

function setHeaderHeight() {
    const header = document.querySelector("header");
    if (!header) return;

    const height = header.offsetHeight;
    document.documentElement.style.setProperty("--header-height", `${height}px`);
}

let ticking = false;

function updateHeaderHeight() {
    if (ticking) return;

    ticking = true;
    requestAnimationFrame(() => {
        setHeaderHeight();
        ticking = false;
    });
}

function initHeaderHeightSystem() {
    setHeaderHeight();

    setTimeout(setHeaderHeight, 50);
    setTimeout(setHeaderHeight, 200);
    setTimeout(setHeaderHeight, 500);
    setTimeout(setHeaderHeight, 1000);
}

function observeHeaderChanges() {
    const header = document.querySelector("header");
    if (!header) return;

    const observer = new ResizeObserver(() => {
        setHeaderHeight();
    });

    observer.observe(header);
}

document.addEventListener("DOMContentLoaded", () => {
    initHeaderHeightSystem();
    observeHeaderChanges();
});

window.addEventListener("load", () => {
    initHeaderHeightSystem();
});

window.addEventListener("resize", updateHeaderHeight);
window.addEventListener("scroll", updateHeaderHeight);




// ======================================================
// 10. FAQ ACORDEÓN (igual que antes)
// ======================================================

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

function initFAQAccordionIn(root) {
    root.querySelectorAll(".faq-question").forEach(btn => {
        btn.addEventListener("click", () => {
            const item = btn.closest(".faq-item");

            root.querySelectorAll(".faq-item").forEach(i => {
                if (i !== item) i.classList.remove("active");
            });

            item.classList.toggle("active");
        });
    });
}
