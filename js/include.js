function loadComponent(id, file) {
    fetch(file)
        .then(res => res.text())
        .then(data => {
            document.getElementById(id).innerHTML = data;

            if (id === "header-placeholder") {
                initHeader();
            }
        });
}

// detectar si estamos en subcarpeta
const basePath = window.location.pathname.includes('/toko/')
    ? '../'
    : '';

loadComponent("header-placeholder", basePath + "components/header.html");
loadComponent("footer-placeholder", basePath + "components/footer.html");