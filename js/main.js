// ======================================================
// MAIN.JS — INIT DE COMPONENTES + LÓGICA GENERAL
// (sin rutas, sin includes, sin BASE_URL)
// ======================================================

// ================================ INIT DE COMPONENTES =====================================//


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

    await loadMiniGalleryImages(root, resolveAsset);

    const track = root.querySelector('.carousel-track');
    if (!track) return;

    const slides = Array.from(track.querySelectorAll('picture'));
    const prevBtn = root.querySelector('.carousel-btn.prev');
    const nextBtn = root.querySelector('.carousel-btn.next');
    const realCount = slides.filter(s => !s.classList.contains('clone')).length;

    // --- Casos especiales: 0 o 1 imagen ---
    if (realCount === 0) return;

    if (realCount === 1) {
        prevBtn.classList.add('hidden');
        nextBtn.classList.add('hidden');
        slides[0].classList.add('active');
        return;
    }

    // --- Caso 2 imágenes: sin clones, sin loop ---
    if (realCount === 2) {
        let idx = 0;

        function scrollTo2(i, smooth = true) {
            idx = i;
            const currentSlides = Array.from(track.querySelectorAll('picture'));
            const slideWidth = currentSlides[0]?.offsetWidth ?? 0;
            track.style.transition = smooth ? 'transform 0.45s cubic-bezier(0.4,0,0.2,1)' : 'none';
            track.style.transform = `translateX(${-slideWidth * idx}px)`;
            currentSlides.forEach((s, j) => s.classList.toggle('active', j === idx));
            prevBtn.classList.toggle('disabled', idx === 0);
            nextBtn.classList.toggle('disabled', idx === 1);
        }

        function initPosition2() {
            if (track.querySelector('picture')?.offsetWidth > 0) {
                scrollTo2(0, false);
            } else {
                const ro = new ResizeObserver(() => {
                    if (track.querySelector('picture')?.offsetWidth > 0) {
                        ro.disconnect();
                        scrollTo2(0, false);
                    }
                });
                ro.observe(track);
            }
        }
        initPosition2();

        prevBtn.addEventListener('click', () => { if (idx > 0) scrollTo2(idx - 1); });
        nextBtn.addEventListener('click', () => { if (idx < 1) scrollTo2(idx + 1); });

        window.addEventListener('resize', () => scrollTo2(idx, false));

        // Swipe
        addSwipe(track, () => { if (idx < 1) scrollTo2(idx + 1); }, () => { if (idx > 0) scrollTo2(idx - 1); });
        return;
    }

    // --- Caso normal: 3+ imágenes con loop infinito ---
    // Los clones ya fueron insertados en loadMiniGalleryImages
    // 2 clones al inicio (últimas 2 reales) + reales + 2 clones al final (primeras 2 reales)
    const allSlides = Array.from(track.querySelectorAll('picture'));
    const clonesBefore = 2;
    let currentIndex = clonesBefore; // empieza en la primera real

    function getSlideWidth() {
        return track.querySelector('picture')?.offsetWidth ?? 0;
    }

    function goToIndex(index, smooth = true) {
        const slideWidth = getSlideWidth();
        const offset = slideWidth * index;

        track.style.transition = smooth ? 'transform 0.45s cubic-bezier(0.4,0,0.2,1)' : 'none';
        track.style.transform = `translateX(${-offset}px)`;

        updateActive(index);
    }

    function updateActive(index) {
        allSlides.forEach((s, i) => s.classList.toggle('active', i === index));
    }

    function afterTransition() {
        const lastReal = clonesBefore + realCount - 1;

        // Si estamos en un clon del final → saltar al real del inicio
        if (currentIndex > lastReal) {
            currentIndex = clonesBefore;
            goToIndex(currentIndex, false);
            return;
        }
        // Si estamos en un clon del inicio → saltar al real del final
        if (currentIndex < clonesBefore) {
            currentIndex = lastReal;
            goToIndex(currentIndex, false);
            return;
        }
    }

    track.addEventListener('transitionend', afterTransition);

    // Ir al inicio sin animación
    function initPosition() {
        if (getSlideWidth() > 0) {
            goToIndex(currentIndex, false);
        } else {
            // Layout aún no listo, esperar
            const ro = new ResizeObserver(() => {
                if (getSlideWidth() > 0) {
                    ro.disconnect();
                    goToIndex(currentIndex, false);
                }
            });
            ro.observe(track);
        }
    }
    initPosition();

    nextBtn.addEventListener('click', () => {
        currentIndex++;
        goToIndex(currentIndex, true);
    });

    prevBtn.addEventListener('click', () => {
        currentIndex--;
        goToIndex(currentIndex, true);
    });

    window.addEventListener('resize', () => goToIndex(currentIndex, false));

    // Click en imagen activa → galería
    track.addEventListener('click', (e) => {
        const active = track.querySelector('picture.active');
        if (!active || !active.contains(e.target)) return;
        const path = window.location.pathname;
        if (path.includes("galeria")) return;
        window.location.href = resolvePage("galeria/index.html");
    });

    // Swipe
    addSwipe(track,
        () => { currentIndex++; goToIndex(currentIndex, true); },
        () => { currentIndex--; goToIndex(currentIndex, true); }
    );
}

// --- Swipe helper ---
function addSwipe(el, onLeft, onRight) {
    let startX = 0;
    el.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', e => {
        const diff = startX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 40) {
            if (diff > 0) onLeft();
            else onRight();
        }
    }, { passive: true });
}

// --- Carga dinámica de imágenes desde JSON ---
async function loadMiniGalleryImages(root, resolveAsset) {
    const track = root.querySelector('.carousel-track');
    if (!track) return;

    const jsonPath = track.dataset.json;
    const res = await fetch(resolveAsset(jsonPath));
    const images = await res.json();

    const categoryAttr = root.dataset.miniGalleryId;
    let filtered;

    if (!categoryAttr || categoryAttr.trim() === "") {
        filtered = images;
    } else {
        const requested = categoryAttr.split(";").map(c => c.trim().toLowerCase());
        filtered = images.filter(img => {
            if (!img.clasificacion) return false;
            const tags = img.clasificacion.split(";").map(t => t.trim().toLowerCase());
            return tags.some(tag => requested.includes(tag));
        });
    }

    if (filtered.length === 0) {
        console.warn("MiniGallery: no hay imágenes para:", categoryAttr);
        return;
    }

    function makePicture(img, isClone = false) {
        const picture = document.createElement('picture');
        if (isClone) picture.classList.add('clone');
        picture.innerHTML = `
            <source media="(max-width: 768px)" srcset="${resolveAsset('img/galeria/' + img.mobile)}">
            <source media="(min-width: 769px)" srcset="${resolveAsset('img/galeria/' + img.desktop)}">
            <img src="${resolveAsset('img/galeria/' + img.desktop)}" alt="${img.alt}" loading="lazy">
        `;
        return picture;
    }

    // Casos 1 y 2: sin clones
    if (filtered.length <= 2) {
        filtered.forEach(img => track.appendChild(makePicture(img)));
        return;
    }

    // 3+: clones al inicio (últimas 2) y al final (primeras 2)
    track.appendChild(makePicture(filtered[filtered.length - 2], true));
    track.appendChild(makePicture(filtered[filtered.length - 1], true));
    filtered.forEach(img => track.appendChild(makePicture(img)));
    track.appendChild(makePicture(filtered[0], true));
    track.appendChild(makePicture(filtered[1], true));
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

    // Resolver enlaces internos
    root.querySelectorAll('[data-page]').forEach(a => {
        a.href = resolvePage(a.dataset.page);
    });
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
// 10. MINI GUIAS
// ======================================================

async function initMiniGuias(root, resolveAsset, resolvePage) {

    const container = root.querySelector('.miniGuias__list');
    const filterAttr = root.dataset.miniGuiasId;

    // Convertir filtros en array
    const filters = filterAttr
        ? filterAttr.split(";").map(f => f.trim().toLowerCase())
        : [];

    // Cargar guias/index.html
    const res = await fetch(resolveAsset("guias/index.html"));
    const html = await res.text();

    // DOM temporal
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Extraer JSON
    const script = temp.querySelector("#guias-data");
    if (!script) {
        console.error("miniGuias: no se encontró #guias-data");
        return;
    }

    const guias = JSON.parse(script.textContent);

    // Preselección por Topic o Category
    let preselected = guias.filter(g => {

        const topicList = g.Topic
            ? g.Topic.split(";").map(t => t.trim().toLowerCase())
            : [];

        const category = g.Category ? g.Category.toLowerCase() : "";

        // Si no hay filtros → todas
        if (filters.length === 0) return true;

        // Coincidencia por categoría
        if (filters.includes(category)) return true;

        // Coincidencia por topic
        return topicList.some(t => filters.includes(t));
    });

    if (preselected.length === 0) {
        container.innerHTML = "<p>No hay guías disponibles.</p>";
        return;
    }

    const selected = selectEditorialItems(preselected, 2);

    // Renderizado
    selected.forEach(g => {
        const url = resolvePage(g.Url);
        const img = resolveAsset(g.ImgDesktop || g.Img || g.ImgMobile);

        const card = document.createElement("div");
        card.className = "guia-card";

        card.innerHTML = `
            <img src="${img}" alt="${g.Alt || g.Title}">
            <div class="guia-content">
                <h3 class="text-small">${g.Title}</h3>
                <p class="text-small">${g.Resumen}</p>
                <a href="${url}">Leer más</a>
            </div>
        `;

        container.appendChild(card);
    });

    root.querySelectorAll('[data-page]').forEach(a => {
        a.href = resolvePage(a.dataset.page);
    });
}



// ================================ LOGICA =====================================//


// ======================================================
// 20. HEADER HEIGHT SYSTEM 
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
// 21. FAQ ACORDEÓN 
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

// ======================================================
// 22. SELECCION ALEATORIA PONDERADA (con fixed, high, medium, low)
// ======================================================

function selectEditorialItems(items, count) {

    const weights = {
        high: 3,
        medium: 2,
        low: 1
    };

    // --- 1. Separar fixed ---
    const fixed = items.filter(i => i.Feature === "fixed");
    const nonFixed = items.filter(i => i.Feature !== "fixed");

    // --- 2. Caso A: suficientes fixed ---
    if (fixed.length >= count) {
        const pool = [...fixed];
        const selected = [];

        for (let i = 0; i < count; i++) {
            const idx = Math.floor(Math.random() * pool.length);
            selected.push(pool[idx]);
            pool.splice(idx, 1);
        }

        return selected;
    }

    // --- 3. Caso B: 1 fixed ---
    if (fixed.length === 1) {
        const selected = [fixed[0]];

        // Seleccionar el resto ponderado
        const remaining = count - 1;

        if (remaining > 0 && nonFixed.length > 0) {
            const pool = [];

            nonFixed.forEach(item => {
                const w = weights[item.Feature] || 1;
                for (let i = 0; i < w; i++) pool.push(item);
            });

            const used = new Set();

            while (selected.length < count && pool.length > 0) {
                const idx = Math.floor(Math.random() * pool.length);
                const candidate = pool[idx];

                if (!used.has(candidate)) {
                    selected.push(candidate);
                    used.add(candidate);
                }

                pool.splice(idx, 1);
            }
        }

        return selected;
    }

    // --- 4. Caso C: 0 fixed → ponderado puro ---
    const pool = [];

    items.forEach(item => {
        const w = weights[item.Feature] || 1;
        for (let i = 0; i < w; i++) pool.push(item);
    });

    const selected = [];
    const used = new Set();

    while (selected.length < count && pool.length > 0) {
        const idx = Math.floor(Math.random() * pool.length);
        const candidate = pool[idx];

        if (!used.has(candidate)) {
            selected.push(candidate);
            used.add(candidate);
        }

        pool.splice(idx, 1);
    }

    return selected;
}

