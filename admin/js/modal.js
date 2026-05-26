// modal.js — helper para construir modales JS con clases CSS de admin.css
// Uso: const { overlay, panel } = crearModal('mi-id', { wide, narrow, scroll })
// El caller rellena panel.innerHTML y gestiona los event listeners.

export function crearModal(id, { wide = false, narrow = false, scroll = false } = {}) {
    const prev = document.getElementById(id)
    if (prev) prev.remove()

    const overlay = document.createElement('div')
    overlay.id = id
    overlay.className = 'modal-overlay'

    const panel = document.createElement('div')
    panel.className = 'modal-panel'
    if (wide)   panel.classList.add('modal-panel--wide')
    if (narrow) panel.classList.add('modal-panel--narrow')
    if (scroll) panel.classList.add('modal-panel--scroll')

    overlay.appendChild(panel)
    document.body.appendChild(overlay)

    return { overlay, panel }
}
