function loadComponent(id, file, callback) {
    fetch(file)
        .then(res => res.text())
        .then(data => {
            const container = document.getElementById(id);

            if (!container) return;

            container.innerHTML = data;

            if (id === "header-placeholder") {
                initHeader();
            }

            if (id === "contact-placeholder") {
                initFormulario();
                initContactoFromURL();
            }

            // 🔥 NUEVO: callback opcional
            if (callback) callback();
        })
        .catch(err => {
            console.error("Error cargando componente:", file, err);
        });
}

// detectar si estamos en subcarpeta
const basePath = window.location.pathname.includes('/toko/')
    ? '../'
    : '';

loadComponent("header-placeholder", basePath + "components/header.html");
loadComponent("contact-placeholder", basePath + "components/contact.html");
loadComponent("whatsapp-placeholder", basePath + "components/whatsapp.html");
loadComponent("footer-placeholder", basePath + "components/footer.html");