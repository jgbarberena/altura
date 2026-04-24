document.addEventListener("DOMContentLoaded", async () => {

    const section = document.getElementById("testimonios");
    if (!section) return;

    const jsonPath = section.dataset.json;
    const initialBox = section.querySelector(".testimonios__initial");
    const expandedBox = section.querySelector(".testimonios__expanded");
    const btnExpand = section.querySelector(".testimonios__expand");

    // Controles: Cargar más + Contraer
    const controls = section.querySelector(".testimonios__controls");
    const btnMore = section.querySelector(".testimonios__more");
    const btnCollapse = section.querySelector(".testimonios__collapse");

    // ============================
    // Cargar JSON
    // ============================
    const allTestimonials = await fetch(resolveAsset(jsonPath))
        .then(r => r.json())
        .catch(() => []);

    if (!allTestimonials.length) return;

    // ============================
    // Renderizar testimonios
    // ============================
    function renderTestimonials(container, list) {
        list.forEach(t => {
            const art = document.createElement("article");
            art.className = "testimonio";
            art.innerHTML = `
                <p class="text-body">${t.texto}</p>
                <p class="text-small">${t.autor}</p>
            `;
            container.appendChild(art);
        });
    }

    // ============================
    // Control de duplicados (por índice)
    // ============================
    let usedIndexes = new Set();

    // ============================
    // 1) Vista inicial (3)
    // ============================
    const initial = selectWeightedByField(allTestimonials, 3, "weight");

    // Reemplazar los testimonios SEO por los reales
    initialBox.innerHTML = "";
    renderTestimonials(initialBox, initial);

    // Registrar índices usados
    initial.forEach(t => usedIndexes.add(allTestimonials.indexOf(t)));

    // ============================
    // 2) Vista expandida (20)
    // ============================
    btnExpand.addEventListener("click", () => {

        const remaining = allTestimonials.filter((t, i) => !usedIndexes.has(i));
        const next20 = selectWeightedByField(remaining, 20, "weight");

        renderTestimonials(expandedBox, next20);
        expandedBox.style.display = "block";

        // Registrar índices usados
        next20.forEach(t => usedIndexes.add(allTestimonials.indexOf(t)));

        // Mostrar controles completos
        btnExpand.style.display = "none";
        controls.style.display = "flex";

        // Scroll solo en la primera expansión
        expandedBox.scrollIntoView({ behavior: "smooth" });
    });

    // ============================
    // 3) Cargar más (otros 20)
    // ============================
    btnMore.addEventListener("click", () => {

        const remaining = allTestimonials.filter((t, i) => !usedIndexes.has(i));
        if (!remaining.length) return;

        const next20 = selectWeightedByField(remaining, 20, "weight");

        renderTestimonials(expandedBox, next20);

        // Registrar índices usados
        next20.forEach(t => usedIndexes.add(allTestimonials.indexOf(t)));

        // ❗ Importante: NO scroll aquí
    });

    // ============================
    // 4) Contraer → volver a los 3 iniciales
    // ============================
    btnCollapse.addEventListener("click", () => {

        expandedBox.innerHTML = "";
        expandedBox.style.display = "none";

        controls.style.display = "none";
        btnExpand.style.display = "inline-block";

        // Scroll hacia la sección de testimonios
        section.scrollIntoView({ behavior: "smooth" });
    });


});
