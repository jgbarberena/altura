document.addEventListener("DOMContentLoaded", () => {

    // 1. Leer JSON generado por PowerShell
    const raw = document.getElementById("guias-data");
    if (!raw) {
        console.warn("Destacados: no se encontró #guias-data");
        return;
    }

    let data;
    try {
        data = JSON.parse(raw.textContent);
    } catch (e) {
        console.error("Destacados: JSON inválido", e);
        return;
    }

    if (!Array.isArray(data) || data.length === 0) {
        console.warn("Destacados: JSON vacío");
        return;
    }

    // 2. Contenedores
    const destacadosCards = document.getElementById("guias-destacados-cards");
    const listadoCards = document.getElementById("guias-listado-cards");

    if (!destacadosCards || !listadoCards) {
        console.error("Destacados: contenedores no encontrados");
        return;
    }

    // 3. Función ponderada (igual que tu lógica original)
    function pickWeighted(items) {
        if (!items.length) return null;

        const weights = {
            high: 3,
            medium: 2,
            low: 1,
            "": 1
        };

        const bag = [];
        for (const item of items) {
            const w = weights[item.Feature] ?? 1;
            for (let i = 0; i < w; i++) bag.push(item);
        }

        return bag[Math.floor(Math.random() * bag.length)];
    }

    // 4. Lógica editorial EXACTA que querías mantener

    // A) Fijos (van siempre)
    const fixed = data.filter(g => g.Feature === "fixed");

    // B) Resto de candidatos
    const remaining = data.filter(g => !fixed.some(f => f.File === g.File));

    // C) Core ponderado
    const coreCandidates = remaining.filter(g => g.Category === "core");
    const corePick = pickWeighted(coreCandidates);

    // D) Rest ponderado
    const restCandidates = remaining.filter(g => g.Category === "rest");
    const restPick = pickWeighted(restCandidates);

    // E) Destacados finales (orden: fixed → core → rest)
    const picks = [...fixed];
    if (corePick) picks.push(corePick);
    if (restPick) picks.push(restPick);

    // 5. Renderizar destacados (HTML usa rutas relativas)
    destacadosCards.innerHTML = picks.map(g => `
        <article class="card guia-destacada">
            <picture>
                <source media="(max-width: 768px)" srcset="${g.ImgMobileHtml}">
                <source media="(min-width: 769px)" srcset="${g.ImgDesktopHtml}">
                <img src="${g.ImgMobileHtml}" alt="${g.Alt}" loading="lazy">
            </picture>
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

    // 7. Mezcla aleatoria (Fisher–Yates)
    function shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    const ordenFinal = shuffle(restantes);

    // 8. Renderizar listado (HTML usa rutas relativas)
    listadoCards.innerHTML = ordenFinal.map(g => `
        <article class="guia-card">
            <picture>
                <source media="(max-width: 768px)" srcset="${g.ImgMobileHtml}">
                <source media="(min-width: 769px)" srcset="${g.ImgDesktopHtml}">
                <img src="${g.ImgMobileHtml}" alt="${g.Alt}" loading="lazy">
            </picture>

            <div class="guia-content">
                <h3>${g.Title}</h3>
                <p>${g.Resumen}</p>
                <a href="${g.Url}">Leer más</a>
            </div>
        </article>
    `).join("");
});
