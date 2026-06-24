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
    // cerrar al hacer click fuera
    document.addEventListener("click", function (e) {
        if (menu.classList.contains("active") &&
            !menu.contains(e.target) &&
            !hamburger.contains(e.target)) {
            menu.classList.remove("active");
        }
    });

    // cerrar al hacer scroll
    window.addEventListener("scroll", function () {
        menu.classList.remove("active");
    }, { passive: true });

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

    // === MODO COMPACTO ===
    const section = root.querySelector('.miniGallery');
    if (section && root.dataset.compact === "true") {
        section.classList.add('miniGallery--compact');
    }

    // ======================================================
    // 0) ELIMINAR IMAGEN Y TESTIMONIO ESTÁTICOS (SEO) SI EXISTE
    // ======================================================
    // Eliminar imagen estática si existe
    const staticImg = root.querySelector('.miniGallery__staticImage');
    if (staticImg) staticImg.remove();

    // Eliminar testimonio estático si existe
    const staticBox = root.querySelector('.miniGallery__testimonial--static');
    if (staticBox) {
        root._miniGalleryTestimonials.static = {
            text: staticBox.querySelector('.miniGallery__testimonial-text')?.textContent.trim() || "",
            author: staticBox.querySelector('.miniGallery__testimonial-author')?.textContent.trim() || ""
        };
        staticBox.remove();
    }

    // ======================================================
    // 1) CARGAR IMÁGENES 
    // ======================================================
    await loadMiniGalleryImages(root, resolveAsset);

    const track = root.querySelector('.carousel-track');
    if (!track) return;

    const slides = Array.from(track.querySelectorAll('picture'));
    const prevBtn = root.querySelector('.carousel-btn.prev');
    const nextBtn = root.querySelector('.carousel-btn.next');
    const realCount = slides.filter(s => !s.classList.contains('clone')).length;

    // ======================================================
    // 2) CARGAR Y SELECCIONAR TESTIMONIOS (NUEVO)
    // ======================================================

    // 2.1 Cargar testimonios filtrados por categoría
    const allTestimonials = await loadMiniGalleryTestimonials(root, resolveAsset);

    // 2.2 Calcular cuántos testimonios queremos (3 por imagen, min 3, max 20)
    let desiredCount = realCount * 3;
    if (desiredCount < 3) desiredCount = 3;
    if (desiredCount > 20) desiredCount = 20;

    // 2.3 Selección ponderada por "peso"
    const selectedTestimonials = selectWeightedByField(allTestimonials, desiredCount, "peso");

    // 2.4 Guardar para la siguiente fase (asignación + rotación)
    root._miniGalleryTestimonials = {
        all: allTestimonials,
        selected: selectedTestimonials,
        realSlidesCount: realCount
    };

    // 2.5 ASIGNAR TESTIMONIOS A CADA IMAGEN (NUEVO)
    const realSlides = slides.filter(s => !s.classList.contains('clone'));
    const testimonialGroups = assignTestimonialsToImages(realSlides, selectedTestimonials);

    // Guardamos los grupos para la fase de rotación
    root._miniGalleryTestimonials.groups = testimonialGroups;

    // Índice de testimonio actual por imagen real
    root._miniGalleryTestimonials.currentIndexes = testimonialGroups.map(() => 0);

    // Intervalo de rotación (lo guardamos para poder pausarlo si hace falta)
    root._miniGalleryTestimonials.rotationInterval = null;


    // 2.6 CREAR CONTENEDORES HTML EN CADA SLIDE (NUEVO)

    injectTestimonialContainers(slides);

    // 2.7 MOSTRAR EL PRIMER TESTIMONIO DE CADA IMAGEN (NUEVO)
    const groups = root._miniGalleryTestimonials.groups || [];
    const realSlidesOnly = slides.filter(s => !s.classList.contains('clone'));

    realSlidesOnly.forEach((slide, index) => {
        const group = groups[index];
        if (!group || group.length === 0) return;

        const first = group[0]; // primer testimonio asignado
        const box = slide.querySelector('.miniGallery__testimonial');
        if (!box) return;

        // Rellenar contenido
        box.querySelector('.miniGallery__testimonial-text').textContent = first.texto;
        box.querySelector('.miniGallery__testimonial-author').textContent = first.autor;

        // Mostrarlo
        box.style.display = "block";
    });

    // ======================================================
    // 3) CASOS ESPECIALES DE IMÁGENES (TU CÓDIGO ORIGINAL)
    // ======================================================

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

    // ======================================================
    // 4) CASO NORMAL: 3+ IMÁGENES CON LOOP INFINITO (TU CÓDIGO ORIGINAL)
    // ======================================================

    // Los clones ya fueron insertados en loadMiniGalleryImages
    // 2 clones al inicio (últimas 2 reales) + reales + 2 clones al final (primeras 2 reales)
    const allSlides = Array.from(track.querySelectorAll('picture'));
    const clonesBefore = 2;
    let currentIndex = clonesBefore; // empieza en la primera real

    // ROTACIÓN AUTOMÁTICA DE TESTIMONIOS (3+ IMÁGENES)
    const tData = root._miniGalleryTestimonials;
    if (tData && tData.groups && tData.groups.length > 0) {
        // Mostrar el testimonio inicial de la primera imagen real
        updateActiveTestimonial(root, currentIndex, clonesBefore, realCount);
        showOnlyActiveTestimonial(root, currentIndex, clonesBefore, realCount);

        // Limpiar intervalo previo si lo hubiera
        if (tData.rotationInterval) {
            clearInterval(tData.rotationInterval);
        }

        // Rotar cada 6 segundos el testimonio de la imagen activa
        tData.rotationInterval = setInterval(() => {
            const data = root._miniGalleryTestimonials;
            if (!data || !data.groups) return;

            // Índice real de la imagen activa
            const realIndex = (currentIndex - clonesBefore + realCount) % realCount;

            // Avanzar índice de testimonio para esa imagen
            data.currentIndexes[realIndex] =
                ((data.currentIndexes[realIndex] || 0) + 1) % data.groups[realIndex].length;

            updateActiveTestimonial(root, currentIndex, clonesBefore, realCount);
            showOnlyActiveTestimonial(root, currentIndex, clonesBefore, realCount);
        }, 3500);
    }

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
            updateActiveTestimonial(root, currentIndex, clonesBefore, realCount);
            showOnlyActiveTestimonial(root, currentIndex, clonesBefore, realCount);
            return;
        }
        // Si estamos en un clon del inicio → saltar al real del final
        if (currentIndex < clonesBefore) {
            currentIndex = lastReal;
            goToIndex(currentIndex, false);
            updateActiveTestimonial(root, currentIndex, clonesBefore, realCount);
            showOnlyActiveTestimonial(root, currentIndex, clonesBefore, realCount);
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
        updateActiveTestimonial(root, currentIndex, clonesBefore, realCount);
        showOnlyActiveTestimonial(root, currentIndex, clonesBefore, realCount);
    });

    prevBtn.addEventListener('click', () => {
        currentIndex--;
        goToIndex(currentIndex, true);
        updateActiveTestimonial(root, currentIndex, clonesBefore, realCount);
        showOnlyActiveTestimonial(root, currentIndex, clonesBefore, realCount);
    });

    window.addEventListener('resize', () => goToIndex(currentIndex, false));

    // Click en imagen activa → galería
    track.addEventListener('click', (e) => {
        const active = track.querySelector('picture.active');
        if (!active || !active.contains(e.target)) return;
        const path = window.location.pathname;
        if (path.includes("momenticos")) {
            const img = active.querySelector("img");
            if (img) window.open(img.src, "_blank");
            return;
        };
        const link = track.dataset.link;
        if (link) window.location.href = resolvePage(link);
    });

    // Swipe
    addSwipe(track,
        () => { currentIndex++; goToIndex(currentIndex, true); updateActiveTestimonial(root, currentIndex, clonesBefore, realCount); showOnlyActiveTestimonial(root, currentIndex, clonesBefore, realCount); },
        () => { currentIndex--; goToIndex(currentIndex, true); updateActiveTestimonial(root, currentIndex, clonesBefore, realCount); showOnlyActiveTestimonial(root, currentIndex, clonesBefore, realCount); }
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

    const categoryAttr = root.dataset.imgCat;
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

    // Limitar número de imágenes con selección ponderada por weight
    const maxImg = parseInt(root.dataset.maxImg, 10);
    if (!isNaN(maxImg) && maxImg > 0 && filtered.length > maxImg) {
        filtered = selectWeightedByField(filtered, maxImg, "weight");
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

// --- Carga dinámica de testimonios desde JSON ---
async function loadMiniGalleryTestimonials(root, resolveAsset) {
    const track = root.querySelector('.carousel-track');
    if (!track) return [];

    const testJson = track.dataset.testimonios;
    if (!testJson) return [];

    const url = resolveAsset(testJson);

    let all;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Error ${res.status} cargando testimonios`);
        all = await res.json();
    } catch (err) {
        console.error("Error cargando testimonios de miniGallery:", err);
        return [];
    }

    // Filtrado por categoría (data-test-cat)
    const catAttr = root.dataset.testCat || "";
    if (!catAttr.trim()) return all;

    const requested = catAttr
        .split(";")
        .map(c => c.trim().toLowerCase())
        .filter(Boolean);

    if (requested.length === 0) return all;

    const filtered = all.filter(t => {
        if (!t.categoria) return false;

        const tags = t.categoria
            .split(";")
            .map(x => x.trim().toLowerCase());

        return tags.some(tag => requested.includes(tag));
    });

    return filtered;
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

    // Imágenes de fondo
    root.querySelectorAll('.toko-slide').forEach(slide => {
        slide.style.backgroundImage = `url('${resolveAsset(slide.dataset.file)}')`;
    });

    // Enlaces con data-page → resuelve ruta
    root.querySelectorAll('[data-page]').forEach(a => {
        a.href = resolvePage(a.dataset.page);
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

		if (window.trackFormSubmit) window.trackFormSubmit('whatsapp', data.interes);

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

			if (window.trackFormSubmit) window.trackFormSubmit('email', data.interes);

            const asunto = "Solicitud experiencia San Fermín";

            const mailto = `mailto:paula@experienciasanfermin.com?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;

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
            personalizadas: "Experiencia personalizada",
            empresa: "Empresa"
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

// ======================================================
// 11. COOKIE BANNER
// ======================================================

function initCookieBanner(root, resolveAsset, resolvePage) {

    // --- Reescritura de enlaces ---
    root.querySelectorAll('[data-page]').forEach(a => {
        a.href = resolvePage(a.dataset.page);
    });

    const banner  = root.querySelector('#cookie-banner');
    const btnAcept = root.querySelector('#cookie-accept');
    const btnReject = root.querySelector('#cookie-reject');

    if (!banner || !btnAcept || !btnReject) return;

    // --- Leer preferencia guardada ---
    const STORAGE_KEY = 'cookie_consent';
    const EXPIRY_DAYS = 90;

    function getConsent() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const { decision, timestamp } = JSON.parse(raw);
            const age = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
            if (age > EXPIRY_DAYS) {
                localStorage.removeItem(STORAGE_KEY);
                return null;
            }
            return decision; // 'accepted' | 'rejected'
        } catch {
            return null;
        }
    }

    function saveConsent(decision) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            decision,
            timestamp: Date.now()
        }));
    }

    function hideBanner() {
        banner.style.display = 'none';
    }

    // --- Decisión al cargar ---
    const consent = getConsent();
	if (consent === 'accepted') {
		if (typeof window.activateAnalytics === 'function') {
			window.activateAnalytics();
		}
		hideBanner();
		return;
	}
    if (consent === 'rejected') {
        hideBanner();
        return;
    }
    // Sin decisión: mostrar banner (no hace falta hacer nada, está visible por defecto)

    // --- Botones ---
	btnAcept.addEventListener('click', function () {
		saveConsent('accepted');
		if (typeof window.activateAnalytics === 'function') {
			window.activateAnalytics();
		}
		hideBanner();
	});

    btnReject.addEventListener('click', function () {
        saveConsent('rejected');
        hideBanner();
    });
}

// --- Función global para resetear desde el footer ---
function resetCookieConsent() {
    localStorage.removeItem('cookie_consent');
    // Volver a mostrar el banner sin recargar la página
    const banner = document.querySelector('#cookie-banner');
    if (banner) banner.style.display = '';
}


// ======================================================
// SOLICITUD DIALOG
// Gestiona el dialog de solicitud de experiencia.
// Se inicializa al cargar el componente y escucha clicks
// en todos los botones con data-solicitud de la página.
// Escribe en reservation_requests via window.supabasePublic.
// Si falla, ofrece fallback por WhatsApp o Email.
// ======================================================

// ---- Configuración ----
const _SD_WHATSAPP = '34625638977'
const _SD_EMAIL    = 'paula@experienciasanfermin.com'
const _SD_ASUNTO   = 'Solicitud experiencia San Fermín'

// Día fijo por evento (para pre-seleccionar y ocultar el selector)
const _SD_DIA_FIJO = {
    'chupinazo':   '6',
    'procesion':   '7',
    'gigantes':    '14',
    'pobre-de-mi': '14'
}

// Eventos sin concepto de día: el selector se oculta sin asignar valor
const _SD_SIN_DIA = ['toko']

// Detecta la palabra clave del evento dentro del slug.
// Se usa solo para saber si hay día fijo — no para inferir service_id.
function _sdDetectarEvento(slug) {
    var partes = slug.toLowerCase().split('-')
    if (partes.indexOf('chupinazo') !== -1) return 'chupinazo'
    if (partes.indexOf('procesion') !== -1) return 'procesion'
    if (partes.indexOf('gigantes')  !== -1) return 'gigantes'
    if (partes.indexOf('pobre')     !== -1) return 'pobre-de-mi'
    if (partes.indexOf('toko')      !== -1) return 'toko'
    return null  // encierro y cualquier otro: sin día fijo
}

// ---- Convierte slug a etiqueta legible ----
// "ver-el-encierro" → "Ver El Encierro"
function _sdSlugToLabel(slug) {
    return slug.split('-').map(function(w) {
        return w.charAt(0).toUpperCase() + w.slice(1)
    }).join(' ')
}

function initSolicitudDialog(root) {

    // ---- Referencias DOM ----
    var dialog         = document.getElementById('solicitud-dialog')
    var pantForma      = document.getElementById('solicitud-pantalla-form')
    var pantOk         = document.getElementById('solicitud-pantalla-ok')
    var pantError      = document.getElementById('solicitud-pantalla-error')
    var form           = document.getElementById('solicitud-form')
    var inputNombre    = document.getElementById('solicitud-nombre')
    var inputEmail     = document.getElementById('solicitud-email')
    var inputTel       = document.getElementById('solicitud-telefono')
    var selectNivel    = document.getElementById('solicitud-nivel')
    var inputPersonas  = document.getElementById('solicitud-personas')
    var selectDia      = document.getElementById('solicitud-dia')
    var inputComents   = document.getElementById('solicitud-comentarios')
    var errorMsg       = document.getElementById('solicitud-error')
    var okTexto        = document.getElementById('solicitud-ok-texto')
    var fallbackMotivo = document.getElementById('solicitud-fallback-motivo')

    if (!dialog) return

    // Mover el dialog al body para que showModal() funcione correctamente
    if (dialog.parentElement !== document.body) {
        document.body.appendChild(dialog)
    }

    // ---- Construir select dinámicamente desde los botones de la página ----
    var slugsEnPagina = []
    document.querySelectorAll('[data-solicitud]').forEach(function(btn) {
        var s = btn.dataset.solicitud
        if (slugsEnPagina.indexOf(s) === -1) slugsEnPagina.push(s)
    })

    // Vaciar opciones existentes (menos la primera: placeholder)
    while (selectNivel.options.length > 1) selectNivel.remove(1)

    // Añadir una opción por cada slug encontrado
    slugsEnPagina.forEach(function(s) {
        var opt = document.createElement('option')
        opt.value = s
        opt.textContent = _sdSlugToLabel(s)
        selectNivel.appendChild(opt)
    })

    // ======================================================
    // FUNCIÓN PARA ABRIR EL DIALOG CON UN SLUG CONCRETO
    // ======================================================

    function abrirDialog(slug) {

        var eventoBase = _sdDetectarEvento(slug)

        // Pre-seleccionar nivel
        selectNivel.value = slug

        selectDia.disabled = false
        selectDia.value = ''

        if (eventoBase && _SD_DIA_FIJO[eventoBase]) {
            selectDia.value = _SD_DIA_FIJO[eventoBase]
            selectDia.classList.add('solicitud-campo-oculto')
        } else if (eventoBase && _SD_SIN_DIA.indexOf(eventoBase) !== -1) {
            selectDia.classList.add('solicitud-campo-oculto')
        } else {
            selectDia.classList.remove('solicitud-campo-oculto')
        }

        // Limpiar estado anterior
        errorMsg.textContent = ''
        mostrar(pantForma)

        // Actualizar URL sin navegar ni hacer scroll
        var url = new URL(window.location)
        url.searchParams.set('solicitud', slug)
        history.pushState(null, '', url.pathname + url.search)

        if (!dialog.open) dialog.showModal()
        // Colorear opciones según disponibilidad y limpiar aviso
        _dispColorearOpciones()
        _dispActualizarAviso(selectDia.value)
    }

    // ---- Disponibilidad por día en el selector ----
    var diaAviso = document.getElementById('solicitud-dia-aviso')

    function _dispGetFreeSlots(dia) {
        if (!window._dispDisponibilidad || !dia) return null
        var sid  = 'ENCIERRO_' + dia
        var item = window._dispDisponibilidad.find(function(d) { return d.service_id === sid })
        return item ? item.free_slots : null
    }

    function _dispColorearOpciones() {
        Array.from(selectDia.options).forEach(function(opt) {
            if (!opt.value) return
            var free = _dispGetFreeSlots(opt.value)
            if (free === null) return
            opt.style.color = free <= 0 ? '#888' : ''
            opt.textContent = free <= 0
                ? opt.value + ' de julio (sin plazas)'
                : opt.value + ' de julio'
        })
    }

    function _dispActualizarAviso(dia) {
        if (!diaAviso) return
        if (!dia) { diaAviso.style.display = 'none'; return }

        var free = _dispGetFreeSlots(dia)
        if (free === null || free > 5) {
            diaAviso.style.display = 'none'
            return
        }

        diaAviso.style.display = 'block'

        if (free <= 0) {
            diaAviso.style.color = '#cc8888'
            diaAviso.textContent = 'Sin plazas confirmadas para este día. Puedes solicitarlo igualmente — si tienes flexibilidad de fechas, indícanoslo en el mensaje.'
        } else {
            diaAviso.style.color = '#ccaa66'
            diaAviso.textContent = 'Quedan pocas plazas. Te recomendamos solicitarlo cuanto antes.'
        }
    }
    // ---- Listeners en botones de solicitud ----
    document.querySelectorAll('[data-solicitud]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            abrirDialog(btn.dataset.solicitud)
        })
    })

    // ---- Si la página carga con ?solicitud= en la URL, abrir el dialog ----
    var params = new URLSearchParams(window.location.search)
    var slugInicial = params.get('solicitud')
    if (slugInicial) abrirDialog(slugInicial)

    // ======================================================
    // NAVEGACIÓN ENTRE PANTALLAS
    // ======================================================

    function mostrar(pantalla) {
        [pantForma, pantOk, pantError].forEach(function(p) {
            p.classList.add('solicitud-oculta')
        })
        pantalla.classList.remove('solicitud-oculta')
    }

    function cerrarDialog() {
        dialog.close()
        var url = new URL(window.location)
        url.searchParams.delete('solicitud')
        var search = url.search === '?' ? '' : url.search
        history.replaceState(null, '', url.pathname + search)
    }

    document.getElementById('solicitud-cerrar-form').addEventListener('click', cerrarDialog)
    document.getElementById('solicitud-cancelar').addEventListener('click', cerrarDialog)
    document.getElementById('solicitud-ok-cerrar').addEventListener('click', cerrarDialog)
    document.getElementById('solicitud-cerrar-fallback').addEventListener('click', cerrarDialog)
    document.getElementById('solicitud-fallback-volver').addEventListener('click', function() {
        mostrar(pantForma)
    })

    dialog.addEventListener('click', function(e) {
        if (e.target === dialog) cerrarDialog()
    })

    selectDia.addEventListener('change', function() {
        _dispActualizarAviso(selectDia.value)
    })
    // ======================================================
    // VALIDACIÓN
    // ======================================================

    function validar() {
        var nombre = inputNombre.value.trim()
        var email  = inputEmail.value.trim()
        var tel    = inputTel.value.trim()

        if (!nombre) return {
            tipo: 'campo',
            msg:  'Escribe tu nombre para que podamos contactarte.'
        }

        if (!email && !tel) return {
            tipo: 'sin-contacto',
            msg:  'No hemos podido registrar tu solicitud porque no tienes datos de contacto. Cierra, añade tu email o teléfono y vuelve a solicitar la experiencia.'
        }

        if (email && (!email.includes('@') || email.lastIndexOf('.') < email.indexOf('@'))) return {
            tipo: 'contacto-invalido',
            msg:  'El formato del email no parece correcto. Cierra, corrígelo y vuelve a solicitar la experiencia.'
        }

        if (tel) {
            var soloNum = tel.replace(/[\s\-\+\(\)]/g, '')
            if (!/^\d{7,15}$/.test(soloNum)) return {
                tipo: 'contacto-invalido',
                msg:  'El formato del teléfono no parece correcto. Cierra, corrígelo y vuelve a solicitar la experiencia.'
            }
        }

        return null
    }

    // ======================================================
    // CONSTRUCCIÓN DEL MENSAJE FALLBACK (WhatsApp / Email)
    // ======================================================

    function buildMensaje() {
        var slugVal  = selectNivel.value
        var personas = inputPersonas.value
        var dia      = selectDia.value
        var nombre   = inputNombre.value.trim()
        var email    = inputEmail.value.trim()
        var tel      = inputTel.value.trim()
        var coments  = inputComents.value.trim()

        var texto = 'Hola, quiero solicitar una experiencia en San Fermín:\n\n'
        if (nombre)   texto += 'Nombre: '      + nombre + '\n'
        if (email)    texto += 'Email: '       + email  + '\n'
        if (tel)      texto += 'Teléfono: '    + tel    + '\n'
        if (slugVal)  texto += 'Experiencia: ' + _sdSlugToLabel(slugVal) + '\n'
        if (personas) texto += 'Personas: '    + personas + '\n'
        if (dia)      texto += 'Día: '         + dia + ' de julio\n'
        if (coments)  texto += '\nComentarios:\n' + coments
        return texto
    }

    // ======================================================
    // FALLBACK: WHATSAPP Y EMAIL
    // ======================================================

    function mostrarFallback(motivo) {
        fallbackMotivo.textContent = motivo
        mostrar(pantError)
    }

    document.getElementById('solicitud-fallback-whatsapp').addEventListener('click', function() {
        window.open('https://wa.me/' + _SD_WHATSAPP + '?text=' + encodeURIComponent(buildMensaje()), '_blank')
    })

    document.getElementById('solicitud-fallback-email').addEventListener('click', function() {
        window.open('mailto:' + _SD_EMAIL +
            '?subject=' + encodeURIComponent(_SD_ASUNTO) +
            '&body='    + encodeURIComponent(buildMensaje()))
    })

    // ======================================================
    // ENVÍO DEL FORMULARIO
    // ======================================================

    form.addEventListener('submit', async function(e) {
        e.preventDefault()
        errorMsg.textContent = ''

        var errorVal = validar()

        if (errorVal && errorVal.tipo === 'campo') {
            errorMsg.textContent = errorVal.msg
            return
        }

        if (errorVal) {
            mostrarFallback(errorVal.msg)
            return
        }

        var nombre   = inputNombre.value.trim()
        var email    = inputEmail.value.trim()
        var tel      = inputTel.value.trim()
        var slugVal  = selectNivel.value
        var personas = inputPersonas.value ? parseInt(inputPersonas.value) : null
        var dia      = selectDia.value     ? parseInt(selectDia.value)     : null

        // ---- Guardar en Supabase ----
        // Los datos del formulario se guardan en conversation_notes como JSON.
        // El panel de administración los procesa al cargar y construye proposal_draft.
        var guardadoOk = false
        if (window.supabasePublic) {
            try {
                var rawData = JSON.stringify({
                    slug:  slugVal || null,
                    day:   dia,
                    slots: personas
                })
                var result = await window.supabasePublic
                    .from('reservation_requests')
                    .insert({
                        client_name:        nombre,
                        client_email:       email    || null,
                        client_phone:       tel      || null,
                        comments:           inputComents.value.trim() || null,
                        conversation_notes: rawData
                    })
                if (result.error) throw result.error
                guardadoOk = true
            } catch (err) {
                console.error('Error guardando solicitud:', err)
            }
        }

        // ---- Resultado ----
        if (guardadoOk) {
            var contacto = email || tel
            okTexto.textContent = contacto
                ? 'Hemos recibido tu solicitud. Nos pondremos en contacto contigo en 24-48 horas en ' + contacto + '.'
                : 'Hemos recibido tu solicitud. Nos pondremos en contacto contigo en 24-48 horas.'
            mostrar(pantOk)
        } else {
            mostrarFallback('Ha habido un problema técnico al registrar tu solicitud. Puedes contactarnos directamente:')
        }
    })
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

// ======================================================
// XX. SELECCIÓN ALEATORIA PONDERADA POR CAMPO NUMÉRICO
// ======================================================
function selectWeightedByField(items, count, field = "peso") {
    if (!Array.isArray(items) || items.length === 0 || count <= 0) {
        return [];
    }

    const pool = [];

    items.forEach(item => {
        const raw = item[field];
        const w = Number(raw);
        const weight = Number.isFinite(w) && w > 0 ? Math.floor(w) : 1;

        for (let i = 0; i < weight; i++) {
            pool.push(item);
        }
    });

    if (pool.length === 0) return [];

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

// ======================================================
// XX. ASIGNAR TESTIMONIOS A IMÁGENES (con afinidad)
// ======================================================
function assignTestimonialsToImages(slides, testimonials) {
    const groups = [];
    const realSlides = slides.filter(s => !s.classList.contains('clone'));

    // Preprocesar categorías de testimonios
    const tByCategory = {};
    testimonials.forEach(t => {
        const cats = t.categoria
            .split(";")
            .map(c => c.trim().toLowerCase());
        cats.forEach(cat => {
            if (!tByCategory[cat]) tByCategory[cat] = [];
            tByCategory[cat].push(t);
        });
    });

    // Para cada imagen real, asignamos 3 testimonios
    realSlides.forEach(slide => {
        const imgCats = (slide.dataset.clasificacion || "")
            .split(";")
            .map(c => c.trim().toLowerCase())
            .filter(Boolean);

        let pool = [];

        // 1) Afinidad: testimonios que coinciden con alguna categoría de la imagen
        imgCats.forEach(cat => {
            if (tByCategory[cat]) {
                pool.push(...tByCategory[cat]);
            }
        });

        // 2) Si no hay suficientes, rellenar con aleatorios del total
        if (pool.length < 3) {
            const needed = 3 - pool.length;
            const remaining = testimonials.filter(t => !pool.includes(t));
            const extra = selectWeightedByField(remaining, needed, "peso");
            pool.push(...extra);
        }

        // 3) Si aún así hay menos de 3 (caso extremo), repetir sin duplicar dentro del grupo
        // Evitar bucles infinitos si no hay suficientes testimonios únicos
        let safety = 20;
        while (pool.length < 3 && testimonials.length > 0 && safety > 0) {
            const extra = testimonials[Math.floor(Math.random() * testimonials.length)];
            if (!pool.includes(extra)) {
                pool.push(extra);
            }
            safety--;
        }

        // Si aún así no hay suficientes, duplicamos los que haya (sin romper nada)
        while (pool.length < 3 && pool.length > 0) {
            pool.push(pool[pool.length - 1]); // duplicar último
        }


        // 4) Si hay más de 3, seleccionar 3 aleatorios
        if (pool.length > 3) {
            pool = selectWeightedByField(pool, 3, "peso");
        }

        groups.push(pool);
    });

    return groups;
}

// ======================================================
// XX. CREAR CONTENEDOR DE TESTIMONIO EN CADA SLIDE
// (Aún no mostramos nada, solo preparamos el HTML)
// ======================================================
function injectTestimonialContainers(slides) {
    slides.forEach(slide => {
        if (slide.classList.contains('clone')) return;

        // Evitar duplicados si se reinicializa
        if (slide.querySelector('.miniGallery__testimonial')) return;

        const box = document.createElement('div');
        box.className = "miniGallery__testimonial";
        box.style.display = "none"; // Aún no mostramos nada

        // Estructura interna (vacía por ahora)
        box.innerHTML = `
            <p class="miniGallery__testimonial-text"></p>
            <p class="miniGallery__testimonial-author"></p>
        `;

        slide.appendChild(box);
    });
}

// ======================================================
// ACTUALIZAR TESTIMONIO DE LA IMAGEN ACTIVA
// ======================================================
function updateActiveTestimonial(root, currentIndex, clonesBefore, realCount) {
    const data = root._miniGalleryTestimonials;
    if (!data || !data.groups || data.groups.length === 0) return;

    const track = root.querySelector('.carousel-track');
    if (!track) return;

    const allSlides = Array.from(track.querySelectorAll('picture'));
    const realSlides = allSlides.filter(s => !s.classList.contains('clone'));

    if (realSlides.length === 0) return;

    // Mapear índice actual (con clones) a índice real [0..realCount-1]
    const realIndex = (currentIndex - clonesBefore + realCount) % realCount;

    const group = data.groups[realIndex];
    if (!group || group.length === 0) return;

    const box = realSlides[realIndex].querySelector('.miniGallery__testimonial');
    if (!box) return;

    const idx = data.currentIndexes[realIndex] || 0;
    const t = group[idx % group.length];

    box.querySelector('.miniGallery__testimonial-text').textContent = t.texto;
    box.querySelector('.miniGallery__testimonial-author').textContent = t.autor;
    box.style.display = "block";
}

// ======================================================
// MOSTRAR SOLO EL TESTIMONIO DE LA IMAGEN ACTIVA
// ======================================================
function showOnlyActiveTestimonial(root, currentIndex, clonesBefore, realCount) {
    const track = root.querySelector('.carousel-track');
    if (!track) return;

    const allSlides = Array.from(track.querySelectorAll('picture'));
    const realSlides = allSlides.filter(s => !s.classList.contains('clone'));

    // Ocultar todos
    realSlides.forEach(slide => {
        const box = slide.querySelector('.miniGallery__testimonial');
        if (box) box.style.display = "none";
    });

    // Calcular índice real
    const realIndex = (currentIndex - clonesBefore + realCount) % realCount;

    // Mostrar solo el activo
    const activeSlide = realSlides[realIndex];
    if (!activeSlide) return;

    const activeBox = activeSlide.querySelector('.miniGallery__testimonial');
    if (activeBox) activeBox.style.display = "block";
}

// =========================
// SLIDESHOW GENÉRICO
// =========================
function initSlideshows() {
    document.querySelectorAll('.slideshow').forEach(container => {
        // Seleccionamos solo los picture que son hijos directos
        const slides = Array.from(container.querySelectorAll(':scope > picture'));

        if (slides.length === 0) return;

        // Evitar duplicados: Si ya hay un spacer, no creamos otro
        if (container.querySelector('.slideshow-spacer')) return;

        // Crear spacer
        // Crear spacer clonando el picture completo (con sources) para respetar proporción en cada breakpoint
        const spacer = document.createElement('div');
        spacer.classList.add('slideshow-spacer');
        const firstPicture = slides[0].cloneNode(true);
        spacer.appendChild(firstPicture);
        // Insertamos al principio del contenedor
        container.prepend(spacer);

        if (slides.length === 1) {
            slides[0].style.opacity = '1';
            return;
        }

        const perSlide = 5;
        const total = perSlide * slides.length;

        slides.forEach((slide, i) => {
            slide.style.animationName = 'slideshowFade';
            slide.style.animationDuration = `${total}s`;
            slide.style.animationTimingFunction = 'linear';
            slide.style.animationIterationCount = 'infinite';
            
            // Mantenemos tu delay positivo
            slide.style.animationDelay = `${perSlide * i}s`;
            
            // Forzamos que la primera imagen sea la que se vea al cargar
            if (i === 0) {
                slide.style.opacity = '1';
            }
        });
    });
}

// Ejecución segura
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSlideshows);
} else {
    initSlideshows();
}