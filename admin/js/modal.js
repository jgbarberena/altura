// modal.js — helper para construir modales JS con clases CSS de admin.css
// Uso: const { overlay, panel } = crearModal('mi-id', { wide, narrow, scroll })
// El caller rellena panel.innerHTML y gestiona los event listeners.
// overlay es un <dialog> nativo (top layer); overlay.remove() o overlay.close() lo cierran.

export function crearModal(id, { wide = false, narrow = false, scroll = false } = {}) {
    const prev = document.getElementById(id)
    if (prev) prev.remove()

    const dialog = document.createElement('dialog')
    dialog.id = id
    dialog.className = 'modal-dialog-overlay'

    const panel = document.createElement('div')
    panel.className = 'modal-panel'
    if (wide)   panel.classList.add('modal-panel--wide')
    if (narrow) panel.classList.add('modal-panel--narrow')
    if (scroll) panel.classList.add('modal-panel--scroll')

    dialog.appendChild(panel)
    document.body.appendChild(dialog)
    dialog.addEventListener('close', () => dialog.remove())
    dialog.showModal()

    return { overlay: dialog, panel }
}
