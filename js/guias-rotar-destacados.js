document.addEventListener("DOMContentLoaded", () => {

    // Leer JSON
    const raw = document.getElementById("guias-data");
    if (!raw) return;

    const data = JSON.parse(raw.textContent);

    // Contenedores
    const destacados = document.getElementById("guias-destacados");
    const listado = document.getElementById("guias-listado");
    if (!destacados || !listado) return;

    // Función de selección ponderada
    function pickWeighted(items) {
        if (!items.length) return null;

        const weights = {
            fixed: Infinity,
            high: 3,
            medium: 2,
            low: 1,
            "": 1
        };

        const fixed = items.find(i => i.Feature === "fixed");
        if (fixed) return fixed;

        const bag = [];
        for (const item of items) {
            const w = weights[item.Feature] ?? 1;
            for (let i = 0; i < w; i++) bag.push(item);
        }

        return bag[Math.floor(Math.random() * bag.length)];
    }

    // 1. Fijos
    const fixed = data.filter(g => g.Feature === "fixed");

    // 2. Candidatos restantes
    const candidates = data.filter(g => !fixed.some(f => f.File === g.File));

    // 3. Core ponderado
    const coreCandidates = candidates.filter(g => g.Category === "core");
    const corePick = pickWeighted(coreCandidates);

    // 4. Rest ponderado
    const restCandidates = candidates.filter(g => g.Category === "rest");
    const restPick = pickWeighted(restCandidates);

    // 5. Destacados finales
    const picks = [...fixed];
    if (corePick) picks.push(corePick);
    if (restPick) picks.push(restPick);

    // Función para generar <picture>
    function pictureHTML(g) {
        return `
            <picture>
                <source media="(max-width: 768px)" srcset="${g.ImgMobile}">
                <source media="(min-width: 769px)" srcset="${g.ImgDesktop}">
                <img src="${g.ImgMobile}" alt="${g.Alt}" loading="lazy">
            </picture>
        `;
    }

    // Pintar destacados
    destacados.innerHTML = picks.map(g => `
        <article class="card guia-destacada">
            ${pictureHTML(g)}
            <div class="card-overlay">
                <h2>${g.Title}</h2>
                <p>${g.Resumen}</p>
                <a href="${g.Url}" class="btn btn-primary btn-mini">Leer guía</a>
            </div>
        </article>
    `).join("");

    // 6. Listado = todos los demás
    const used = new Set(picks.map(g => g.File));
    const restantes = data.filter(g => !used.has(g.File));

    // Separar por categoría
    const restantesCore = restantes.filter(g => g.Category === "core");
    const restantesRest = restantes.filter(g => g.Category === "rest");

    // Mezcla aleatoria (Fisher–Yates)
    function shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    const coreShuffled = shuffle(restantesCore);
    const restShuffled = shuffle(restantesRest);

    const ordenFinal = [...coreShuffled, ...restShuffled];

    // Pintar listado
    listado.innerHTML = ordenFinal.map(g => `
        <article class="guia-card">
            ${pictureHTML(g)}
            <div class="guia-content">
                <h3>${g.Title}</h3>
                <p>${g.Resumen}</p>
                <a href="${g.Url}">Leer más</a>
            </div>
        </article>
    `).join("");
});
